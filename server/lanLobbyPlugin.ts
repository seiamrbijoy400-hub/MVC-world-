import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  BotDifficulty,
  CharAnimState,
  CharacterAppearance,
  CharacterId,
  GameModeId,
  LanNetworkInfo,
  LeaderboardEntry,
  NetworkPlayerSync,
  PlayerSlot,
  RoomState,
  RoomSummary,
  SharedFileInfo
} from '../src/network/LobbyProtocol.js';
import { SHARED_FILE_LIMITS } from '../src/network/LobbyProtocol.js';

interface ClientSession {
  id: string;
  resumeToken: string;
  ws: WebSocket;
  roomCode: string | null;
  isAlive: boolean;
  msgWindowStart: number;
  msgCount: number;
  stateWindowStart: number;
  stateCount: number;
  chatWindowStart: number;
  chatCount: number;
  createWindowStart: number;
  createCount: number;
  joinFailWindowStart: number;
  joinFailCount: number;
  lastMeleeAt: number;
  lastResultAt: number;
}

interface RecoverableSession {
  clientId: string;
  resumeToken: string;
  roomCode: string;
  slot: PlayerSlot;
  wasHost: boolean;
  expiresAt: number;
  timer: NodeJS.Timeout;
}

interface InternalRoom extends RoomState {
  hostId: string;
  playerStates: Record<string, NetworkPlayerSync>;
  leaderboard: Map<string, LeaderboardEntry>;
}

interface StoredFile extends SharedFileInfo {
  roomCode: string;
  data: Buffer;
  expiresAt: number;
}

const MAX_PAYLOAD_BYTES = 8192;
const MAX_ROOMS = 200;
const MAX_TOTAL_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_FILES = 200;
const SESSION_GRACE_MS = 15_000;
const HEARTBEAT_INTERVAL_MS = 25_000;

const VALID_CHARACTERS = new Set<CharacterId>(['kaito', 'mika', 'ren', 'sora']);
const VALID_MODES = new Set<GameModeId>(['OPEN_WORLD', 'CIRCUIT_RACE', 'DRIFT_ARENA']);
const VALID_GEARBOX = new Set<PlayerSlot['gearbox']>(['AUTO', 'SEMI', 'MANUAL']);
const VALID_DIFFICULTIES = new Set<BotDifficulty>(['CHILL', 'PRO', 'INSANE']);
const VALID_ANIMS = new Set<CharAnimState>(['IDLE', 'WALK', 'RUN', 'JUMP', 'PUNCH', 'HIT', 'FLEE', 'KO', 'DRIVE']);
const VALID_HAIR = new Set(['spiky', 'twintails', 'ponytail', 'bob', 'cyber']);
const VALID_ACCESSORIES = new Set(['none', 'visor', 'headphones', 'sunglasses', 'wing']);

const BOT_PROFILES: { name: string; characterId: CharacterId; color: string }[] = [
  { name: 'BOT Takumi', characterId: 'kaito', color: '#f8fafc' },
  { name: 'BOT Mika', characterId: 'mika', color: '#dc2626' },
  { name: 'BOT Ren', characterId: 'ren', color: '#2563eb' },
  { name: 'BOT Sora', characterId: 'sora', color: '#eab308' },
  { name: 'BOT Ryosuke', characterId: 'kaito', color: '#18181b' }
];

function sanitizeName(raw: unknown, fallback: string, maxLen: number): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, maxLen);
  return cleaned.length > 0 ? cleaned : fallback;
}

function sanitizeHexColor(raw: unknown, fallback: string): string {
  if (typeof raw === 'string' && /^#[0-9a-fA-F]{6}$/.test(raw.trim())) {
    return raw.trim().toLowerCase();
  }
  return fallback;
}

function finiteNum(raw: unknown, fallback: number, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback;
  return Math.max(min, Math.min(max, raw));
}

function sanitizeAppearance(raw: unknown): CharacterAppearance | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return {
    hairStyle: (VALID_HAIR.has(String(obj.hairStyle)) ? obj.hairStyle : 'spiky') as CharacterAppearance['hairStyle'],
    hairColor: sanitizeHexColor(obj.hairColor, '#18181b'),
    eyeColor: sanitizeHexColor(obj.eyeColor, '#38bdf8'),
    jacketColor: sanitizeHexColor(obj.jacketColor, '#ff5500'),
    accentColor: sanitizeHexColor(obj.accentColor, '#f8fafc'),
    pantsColor: sanitizeHexColor(obj.pantsColor, '#1e293b'),
    skinColor: sanitizeHexColor(obj.skinColor, '#f1c27d'),
    accessory: (VALID_ACCESSORIES.has(String(obj.accessory)) ? obj.accessory : 'none') as CharacterAppearance['accessory']
  };
}

function decodeHeaderValue(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function sanitizeFileName(raw: unknown): string {
  const base = typeof raw === 'string' ? raw : '';
  const stripped = base.replace(/\\/g, '/').split('/').pop() || '';
  const cleaned = stripped
    .replace(/[\u0000-\u001F\u007F<>:"|?*]/g, '')
    .trim()
    .slice(0, 80);
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..' ? cleaned : 'shared-file';
}

const UNSAFE_MIME = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'application/javascript',
  'text/javascript'
]);

function sanitizeMime(raw: unknown): string {
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(value)) return 'application/octet-stream';
  return UNSAFE_MIME.has(value) ? 'application/octet-stream' : value;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getLocalLanIps(): string[] {
  const ifaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.family === 'IPv4' && !info.internal) {
        if (name.startsWith('ap') || info.address.startsWith('192.168.43.')) {
          ips.unshift(info.address);
        } else {
          ips.push(info.address);
        }
      }
    }
  }
  return ips.length > 0 ? ips : ['127.0.0.1'];
}

function resolveNetworkInfo(req: IncomingMessage | undefined, port: number): LanNetworkInfo {
  const envPublic = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  const knownCloud = Boolean(
    process.env.RENDER ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.FLY_APP_NAME ||
    process.env.RAILWAY_ENVIRONMENT
  );
  const trustProxy =
    knownCloud || /^(1|true|yes)$/i.test((process.env.TRUST_PROXY || '').trim());
  const rawFwdHost = typeof req?.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'].split(',')[0].trim() : '';
  const rawFwdProto = typeof req?.headers['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'].split(',')[0].trim() : 'https';
  // Forwarded headers are only meaningful behind a trusted proxy; a direct client must not
  // be able to poison the public URL advertised to other players.
  const validFwdHost = /^[a-z0-9.-]+(:\d{1,5})?$/i.test(rawFwdHost) ? rawFwdHost : '';
  const fwdHost = trustProxy ? validFwdHost : '';
  const fwdProto = trustProxy && /^https?$/.test(rawFwdProto) ? rawFwdProto : 'https';
  const reqHost = typeof req?.headers.host === 'string' ? req.headers.host.trim() : '';
  const isCloudEnv = Boolean(knownCloud || envPublic || fwdHost);

  if (isCloudEnv) {
    const derivedOrigin = envPublic || (fwdHost ? `${fwdProto}://${fwdHost}` : `https://${reqHost}`);
    return {
      mode: 'ONLINE',
      ips: [],
      port,
      preferredUrl: derivedOrigin,
      publicUrl: derivedOrigin,
      lanWarning: 'Running on cloud Online server. Share the Online URL or Room Code instead of local container IPs.'
    };
  }

  const ips = getLocalLanIps();
  const preferredUrl = `http://${ips[0]}:${port}`;
  return {
    mode: 'LAN',
    ips,
    port,
    preferredUrl
  };
}

function generateRoomCode(existing: Map<string, InternalRoom>): string {
  for (let attempt = 0; attempt < 150; attempt++) {
    const code = String(crypto.randomInt(1000, 10000));
    if (!existing.has(code)) return code;
  }
  return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function generateToken(bytes: number): string {
  return crypto.randomBytes(bytes).toString('hex');
}

function hitRateLimit(now: number, startField: number, count: number, windowMs: number, limit: number): { reset: boolean; exceeded: boolean } {
  if (now - startField > windowMs) {
    return { reset: true, exceeded: false };
  }
  return { reset: false, exceeded: count >= limit };
}

export interface LanLobbyServerLike {
  httpServer: any;
  middlewares?: {
    use: (route: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => unknown;
  };
}

/** A durable best score kept on the host server across restarts. */
export interface GlobalScore {
  playerId?: string;
  name: string;
  score: number;
  bestTimeMs?: number;
  mode: GameModeId;
  updatedAt: number;
}

export interface LobbyBackend {
  attachWebSocket(httpServer: any): void;
  attachMiddlewares(middlewares: NonNullable<LanLobbyServerLike['middlewares']>, getPort: () => number): void;
  handleFileRequest(
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    searchParams: URLSearchParams
  ): void;
  getNetworkInfo(req: IncomingMessage | undefined, port: number): LanNetworkInfo;
  getGlobalLeaderboard(limit?: number): GlobalScore[];
  getStats(): { rooms: number; clients: number; recoverable: number; files: number; uptimeSec: number };
  shutdown(): void;
}

export interface LobbyBackendOptions {
  sessionGraceMs?: number;
  /** Directory for durable leaderboard storage. Omit for memory-only. */
  dataDir?: string;
}

export function createLobbyBackend(options: LobbyBackendOptions = {}): LobbyBackend {
  const sessionGraceMs = options.sessionGraceMs ?? SESSION_GRACE_MS;
  const startedAt = Date.now();
  const rooms = new Map<string, InternalRoom>();
  const clients = new Map<string, ClientSession>();
  const recoverable = new Map<string, RecoverableSession>();
  const attachedServers = new WeakSet<object>();
  const intervals = new Set<NodeJS.Timeout>();
  const sockets = new Set<WebSocketServer>();
  const files = new Map<string, StoredFile>();
  const pendingFileBytes = new Map<string, number>();

  const getRoomFiles = (roomCode: string): SharedFileInfo[] => {
    const now = Date.now();
    const list: SharedFileInfo[] = [];
    for (const f of files.values()) {
      if (f.roomCode !== roomCode || f.expiresAt <= now) continue;
      list.push({
        id: f.id,
        name: f.name,
        mime: f.mime,
        size: f.size,
        ownerName: f.ownerName,
        createdAt: f.createdAt
      });
    }
    return list.sort((a, b) => b.createdAt - a.createdAt);
  };

  const fileCleanup = setInterval(() => {
    const now = Date.now();
    for (const [id, f] of files) {
      if (f.expiresAt <= now) files.delete(id);
    }
  }, 60_000);
  fileCleanup.unref?.();
  intervals.add(fileCleanup);

  const sessionByResumeToken = (token: string): ClientSession | undefined => {
    for (const session of clients.values()) {
      if (session.resumeToken === token) return session;
    }
    return undefined;
  };

  const scoresFile = options.dataDir ? path.join(path.resolve(options.dataDir), 'leaderboard.json') : '';
  const globalScores = new Map<string, GlobalScore>();
  let scoreSaveTimer: NodeJS.Timeout | null = null;

  const loadGlobalScores = () => {
    if (!scoresFile) return;
    try {
      const parsed = JSON.parse(fs.readFileSync(scoresFile, 'utf8')) as { entries?: unknown };
      if (!Array.isArray(parsed?.entries)) return;
      for (const raw of parsed.entries) {
        if (!raw || typeof raw !== 'object') continue;
        const e = raw as Record<string, unknown>;
        if (typeof e.name !== 'string') continue;
        const score = Number(e.score);
        if (!Number.isFinite(score)) continue;
        const name = sanitizeName(e.name, 'Player', 16);
        const mode = VALID_MODES.has(e.mode as GameModeId) ? (e.mode as GameModeId) : 'OPEN_WORLD';
        const playerId = typeof e.playerId === 'string' && e.playerId.trim() ? e.playerId.trim().slice(0, 48) : undefined;
        globalScores.set(playerId || name.toLowerCase(), {
          playerId,
          name,
          score: Math.max(0, Math.round(score)),
          bestTimeMs: Number.isFinite(e.bestTimeMs) ? Math.max(0, Math.round(Number(e.bestTimeMs))) : undefined,
          mode,
          updatedAt: Number.isFinite(e.updatedAt) ? Number(e.updatedAt) : Date.now()
        });
      }
    } catch {}
  };

  const getGlobalLeaderboard = (limit = 20): GlobalScore[] =>
    Array.from(globalScores.values())
      .sort((a, b) => b.score - a.score || a.updatedAt - b.updatedAt)
      .slice(0, Math.max(1, Math.min(200, limit)));

  const flushGlobalScores = () => {
    if (!scoresFile) return;
    if (scoreSaveTimer) {
      clearTimeout(scoreSaveTimer);
      scoreSaveTimer = null;
    }
    try {
      fs.mkdirSync(path.dirname(scoresFile), { recursive: true });
      const tmp = `${scoresFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: Date.now(), entries: getGlobalLeaderboard(200) }, null, 2));
      fs.renameSync(tmp, scoresFile);
    } catch {}
  };

  const scheduleScoreSave = () => {
    if (!scoresFile || scoreSaveTimer) return;
    scoreSaveTimer = setTimeout(() => {
      scoreSaveTimer = null;
      flushGlobalScores();
    }, 300);
    scoreSaveTimer.unref?.();
  };

  loadGlobalScores();

  const send = (ws: WebSocket, type: string, payload: unknown) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  };

  const getRoomSummaries = (): RoomSummary[] => {
    const list: RoomSummary[] = [];
    for (const r of rooms.values()) {
      const host = r.players.find(p => p.isHost);
      list.push({
        code: r.code,
        name: r.name,
        mode: r.mode,
        playerCount: r.players.filter(p => !p.isBot).length,
        botCount: r.players.filter(p => p.isBot).length,
        maxPlayers: r.maxPlayers,
        status: r.status,
        hostName: host ? host.name : 'Host'
      });
    }
    return list;
  };

  const broadcastRoomList = () => {
    const summary = getRoomSummaries();
    for (const c of clients.values()) {
      if (!c.roomCode) {
        send(c.ws, 'ROOM_LIST', { rooms: summary });
      }
    }
  };

  const sanitizeRoom = (r: InternalRoom): RoomState => ({
    code: r.code,
    name: r.name,
    mode: r.mode,
    laps: r.laps,
    status: r.status,
    players: r.players,
    maxPlayers: r.maxPlayers
  });

  const getLeaderboardEntries = (r: InternalRoom): LeaderboardEntry[] => {
    const entries = Array.from(r.leaderboard.values());
    if (r.mode === 'CIRCUIT_RACE') {
      return entries.sort((a, b) => (a.bestTimeMs ?? Number.MAX_SAFE_INTEGER) - (b.bestTimeMs ?? Number.MAX_SAFE_INTEGER));
    }
    return entries.sort((a, b) => b.score - a.score);
  };

  const broadcastToRoom = (roomCode: string, type: string, payload: unknown, exceptId?: string) => {
    for (const c of clients.values()) {
      if (c.roomCode === roomCode && c.id !== exceptId) {
        send(c.ws, type, payload);
      }
    }
  };

  const finalizePlayerRemoval = (roomCode: string, playerId: string, systemNotice?: string) => {
    const room = rooms.get(roomCode);
    if (!room) return;
    const leavingPlayer = room.players.find(p => p.id === playerId);
    room.players = room.players.filter(p => p.id !== playerId);
    delete room.playerStates[playerId];
    room.leaderboard.delete(playerId);

    const humanCount = room.players.filter(p => !p.isBot).length;
    if (humanCount === 0) {
      rooms.delete(roomCode);
      broadcastRoomList();
      return;
    }

    if (room.hostId === playerId) {
      const nextHost = room.players.find(p => !p.isBot);
      if (nextHost) {
        nextHost.isHost = true;
        nextHost.ready = true;
        room.hostId = nextHost.id;
      }
    }

    broadcastToRoom(roomCode, 'ROOM_STATE', { room: sanitizeRoom(room) });
    broadcastToRoom(roomCode, 'WORLD_STATE', { states: room.playerStates });
    if (leavingPlayer) {
      broadcastToRoom(roomCode, 'CHAT_MSG', {
        sender: 'System',
        text: systemNotice || `${leavingPlayer.name} left the lobby.`,
        isSystem: true
      });
    }
    broadcastRoomList();
  };

  const leaveCurrentRoom = (session: ClientSession) => {
    if (!session.roomCode) return;
    const oldCode = session.roomCode;
    session.roomCode = null;
    finalizePlayerRemoval(oldCode, session.id);
  };

  const sanitizePlayerState = (clientId: string, payload: Record<string, unknown>, slot: PlayerSlot): NetworkPlayerSync => {
    const rawAnim = String(payload.animState || 'IDLE');
    return {
      id: clientId,
      name: slot.name,
      x: finiteNum(payload.x, 0, -1200, 1200),
      y: finiteNum(payload.y, 0, -25, 450),
      z: finiteNum(payload.z, 0, -1200, 1200),
      yaw: finiteNum(payload.yaw, 0, -100, 100),
      carX: finiteNum(payload.carX, 0, -1200, 1200),
      carY: finiteNum(payload.carY, 0, -25, 450),
      carZ: finiteNum(payload.carZ, 0, -1200, 1200),
      carYaw: finiteNum(payload.carYaw, 0, -100, 100),
      speedKmh: finiteNum(payload.speedKmh, 0, 0, 420),
      inCar: Boolean(payload.inCar),
      animState: (VALID_ANIMS.has(rawAnim as CharAnimState) ? rawAnim : 'IDLE') as CharAnimState,
      steer: finiteNum(payload.steer, 0, -1.5, 1.5),
      hp: finiteNum(payload.hp, 100, 0, 100),
      carColor: slot.carColor,
      characterId: slot.characterId,
      appearance: slot.appearance
    };
  };

  const attachWebSocket = (httpServer: any) => {
    if (!httpServer || attachedServers.has(httpServer)) return;
    attachedServers.add(httpServer);

    const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES });
    sockets.add(wss);

    const heartbeat = setInterval(() => {
      for (const session of clients.values()) {
        if (!session.isAlive) {
          session.ws.terminate();
          continue;
        }
        session.isAlive = false;
        if (session.ws.readyState === WebSocket.OPEN) {
          session.ws.ping();
        }
      }
    }, HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();
    intervals.add(heartbeat);

    httpServer.on('upgrade', (req: IncomingMessage, socket: any, head: Buffer) => {
      const url = req.url || '';
      if (url.startsWith('/ws')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } else {
        socket.destroy();
      }
    });

    wss.on('connection', (ws: WebSocket) => {
      const clientId = 'p_' + generateToken(6);
      const resumeToken = generateToken(24);
      const now = Date.now();
      const session: ClientSession = {
        id: clientId,
        resumeToken,
        ws,
        roomCode: null,
        isAlive: true,
        msgWindowStart: now,
        msgCount: 0,
        stateWindowStart: now,
        stateCount: 0,
        chatWindowStart: now,
        chatCount: 0,
        createWindowStart: now,
        createCount: 0,
        joinFailWindowStart: now,
        joinFailCount: 0,
        lastMeleeAt: 0,
        lastResultAt: 0
      };
      clients.set(clientId, session);

      send(ws, 'WELCOME', { clientId, resumeToken });
      send(ws, 'ROOM_LIST', { rooms: getRoomSummaries() });

      ws.on('pong', () => {
        session.isAlive = true;
      });

      ws.on('error', () => {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.close(1009, 'Protocol error');
          }
        } catch {}
      });

      ws.on('message', (raw) => {
        const byteLen = Buffer.isBuffer(raw) ? raw.byteLength : Buffer.byteLength(String(raw));
        if (byteLen > MAX_PAYLOAD_BYTES) {
          send(ws, 'ERROR', { message: 'Message exceeds 8KB limit.' });
          ws.close(1009, 'Message too large');
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw.toString());
        } catch {
          send(ws, 'ERROR', { message: 'Malformed JSON message.' });
          return;
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          send(ws, 'ERROR', { message: 'Invalid message frame.' });
          return;
        }

        const frame = parsed as Record<string, unknown>;
        if (typeof frame.type !== 'string' || frame.type.length === 0 || frame.type.length > 32) {
          send(ws, 'ERROR', { message: 'Invalid message type.' });
          return;
        }

        const type = frame.type;
        const rawPayload = frame.payload === undefined ? {} : frame.payload;
        if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
          send(ws, 'ERROR', { message: 'Invalid message payload.' });
          return;
        }
        const payload = rawPayload as Record<string, unknown>;

        const ts = Date.now();
        if (type === 'PLAYER_STATE') {
          const r = hitRateLimit(ts, session.stateWindowStart, session.stateCount, 2000, 140);
          if (r.reset) {
            session.stateWindowStart = ts;
            session.stateCount = 1;
          } else if (r.exceeded) {
            return;
          } else {
            session.stateCount++;
          }
        } else {
          const r = hitRateLimit(ts, session.msgWindowStart, session.msgCount, 5000, 45);
          if (r.reset) {
            session.msgWindowStart = ts;
            session.msgCount = 1;
          } else if (r.exceeded) {
            send(ws, 'ERROR', { message: 'Rate limit exceeded. Slow down requests.' });
            return;
          } else {
            session.msgCount++;
          }
        }

        if (type === 'LIST_ROOMS') {
          send(ws, 'ROOM_LIST', { rooms: getRoomSummaries() });
          return;
        }

        if (type === 'RESUME_SESSION') {
          const token = typeof payload.resumeToken === 'string' ? payload.resumeToken.trim() : '';
          if (token.length < 16 || token.length > 128) {
            send(ws, 'SESSION_EXPIRED', { reason: 'Invalid session token.' });
            return;
          }
          const rec = recoverable.get(token);
          if (!rec || rec.expiresAt < Date.now()) {
            recoverable.delete(token);
            send(ws, 'SESSION_EXPIRED', { reason: 'Previous session expired.' });
            return;
          }
          const room = rooms.get(rec.roomCode);
          if (!room) {
            clearTimeout(rec.timer);
            recoverable.delete(token);
            send(ws, 'SESSION_EXPIRED', { reason: 'Previous room no longer exists.' });
            return;
          }

          clearTimeout(rec.timer);
          recoverable.delete(token);

          const oldSocketId = session.id;
          clients.delete(oldSocketId);
          session.id = rec.clientId;
          session.resumeToken = token;
          session.roomCode = rec.roomCode;
          clients.set(rec.clientId, session);

          const existingIdx = room.players.findIndex(p => p.id === rec.clientId);
          if (existingIdx === -1) {
            if (rec.wasHost && !room.players.some(p => p.isHost && !p.isBot)) {
              rec.slot.isHost = true;
              room.hostId = rec.clientId;
            } else {
              rec.slot.isHost = room.hostId === rec.clientId;
            }
            room.players.push(rec.slot);
          }

          send(ws, 'SESSION_RESUMED', {
            clientId: session.id,
            resumeToken: session.resumeToken,
            room: sanitizeRoom(room)
          });
          broadcastToRoom(room.code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastToRoom(room.code, 'CHAT_MSG', {
            sender: 'System',
            text: `${rec.slot.name} reconnected.`,
            isSystem: true
          });
          broadcastRoomList();
          return;
        }

        if (type === 'CREATE_ROOM') {
          const r = hitRateLimit(ts, session.createWindowStart, session.createCount, 30_000, 6);
          if (r.reset) {
            session.createWindowStart = ts;
            session.createCount = 1;
          } else if (r.exceeded) {
            send(ws, 'ERROR', { message: 'Too many room creations. Please wait.' });
            return;
          } else {
            session.createCount++;
          }

          if (rooms.size >= MAX_ROOMS) {
            send(ws, 'ERROR', { message: 'Server room capacity reached.' });
            return;
          }

          leaveCurrentRoom(session);
          const code = generateRoomCode(rooms);
          const charId = VALID_CHARACTERS.has(payload.characterId as CharacterId) ? (payload.characterId as CharacterId) : 'kaito';
          const gearbox = VALID_GEARBOX.has(payload.gearbox as PlayerSlot['gearbox']) ? (payload.gearbox as PlayerSlot['gearbox']) : 'AUTO';
          const mode = VALID_MODES.has(payload.mode as GameModeId) ? (payload.mode as GameModeId) : 'OPEN_WORLD';
          const hostName = sanitizeName(payload.playerName, 'Host', 16);

          const hostSlot: PlayerSlot = {
            id: session.id,
            name: hostName,
            isHost: true,
            isBot: false,
            characterId: charId,
            appearance: sanitizeAppearance(payload.appearance),
            carColor: sanitizeHexColor(payload.carColor, '#ff5500'),
            gearbox,
            ready: true
          };

          const room: InternalRoom = {
            code,
            name: sanitizeName(payload.roomName, `${hostSlot.name}'s Lobby`, 28),
            mode,
            laps: Math.round(finiteNum(payload.laps, 3, 1, 10)),
            status: 'LOBBY',
            players: [hostSlot],
            maxPlayers: 8,
            hostId: session.id,
            playerStates: {},
            leaderboard: new Map()
          };
          rooms.set(code, room);
          session.roomCode = code;
          send(ws, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastRoomList();
          return;
        }

        if (type === 'JOIN_ROOM') {
          const jf = hitRateLimit(ts, session.joinFailWindowStart, session.joinFailCount, 30_000, 10);
          if (!jf.reset && jf.exceeded) {
            send(ws, 'ERROR', { message: 'Too many room join attempts. Wait before retrying.' });
            return;
          }

          const code = typeof payload.code === 'string' ? payload.code.trim().toUpperCase().slice(0, 8) : '';
          const room = rooms.get(code);
          if (!room) {
            if (jf.reset) {
              session.joinFailWindowStart = ts;
              session.joinFailCount = 1;
            } else {
              session.joinFailCount++;
            }
            send(ws, 'ERROR', { message: `Room #${code || '????'} not found.` });
            return;
          }
          if (room.status === 'PLAYING') {
            send(ws, 'ERROR', { message: 'Match already started. Wait for lobby or create a new room.' });
            return;
          }
          if (room.players.length >= room.maxPlayers) {
            send(ws, 'ERROR', { message: 'Room is full (8/8).' });
            return;
          }

          leaveCurrentRoom(session);
          const charId = VALID_CHARACTERS.has(payload.characterId as CharacterId) ? (payload.characterId as CharacterId) : 'mika';
          const gearbox = VALID_GEARBOX.has(payload.gearbox as PlayerSlot['gearbox']) ? (payload.gearbox as PlayerSlot['gearbox']) : 'AUTO';
          const slot: PlayerSlot = {
            id: session.id,
            name: sanitizeName(payload.playerName, 'Racer', 16),
            isHost: false,
            isBot: false,
            characterId: charId,
            appearance: sanitizeAppearance(payload.appearance),
            carColor: sanitizeHexColor(payload.carColor, '#2563eb'),
            gearbox,
            ready: false
          };
          room.players.push(slot);
          session.roomCode = code;
          broadcastToRoom(code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastToRoom(code, 'CHAT_MSG', {
            sender: 'System',
            text: `${slot.name} joined the lobby!`,
            isSystem: true
          });
          broadcastRoomList();
          return;
        }

        if (type === 'LEAVE_ROOM') {
          leaveCurrentRoom(session);
          send(ws, 'ROOM_LIST', { rooms: getRoomSummaries() });
          return;
        }

        if (!session.roomCode) return;
        const room = rooms.get(session.roomCode);
        if (!room) {
          session.roomCode = null;
          return;
        }

        if (type === 'UPDATE_PLAYER') {
          const slot = room.players.find(p => p.id === session.id);
          if (!slot) return;
          if (payload.name !== undefined) slot.name = sanitizeName(payload.name, slot.name, 16);
          if (VALID_CHARACTERS.has(payload.characterId as CharacterId)) slot.characterId = payload.characterId as CharacterId;
          if (payload.appearance !== undefined) slot.appearance = sanitizeAppearance(payload.appearance);
          if (payload.carColor !== undefined) slot.carColor = sanitizeHexColor(payload.carColor, slot.carColor);
          if (VALID_GEARBOX.has(payload.gearbox as PlayerSlot['gearbox'])) slot.gearbox = payload.gearbox as PlayerSlot['gearbox'];
          if (typeof payload.ready === 'boolean' && !slot.isHost) slot.ready = payload.ready;
          broadcastToRoom(room.code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          return;
        }

        if (type === 'UPDATE_ROOM') {
          if (room.hostId !== session.id) {
            send(ws, 'ERROR', { message: 'Only room host can update match settings.' });
            return;
          }
          if (VALID_MODES.has(payload.mode as GameModeId)) room.mode = payload.mode as GameModeId;
          if (Number.isFinite(payload.laps)) room.laps = Math.round(finiteNum(payload.laps, room.laps, 1, 10));
          broadcastToRoom(room.code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastRoomList();
          return;
        }

        if (type === 'ADD_BOT') {
          if (room.hostId !== session.id) {
            send(ws, 'ERROR', { message: 'Only room host can add bots.' });
            return;
          }
          if (room.players.length >= room.maxPlayers) return;
          const botIndex = room.players.filter(p => p.isBot).length;
          const profile = BOT_PROFILES[botIndex % BOT_PROFILES.length];
          const difficulty = VALID_DIFFICULTIES.has(payload.difficulty as BotDifficulty) ? (payload.difficulty as BotDifficulty) : 'PRO';
          const botSlot: PlayerSlot = {
            id: 'bot_' + generateToken(4),
            name: `${profile.name}${botIndex >= BOT_PROFILES.length ? ' ' + (botIndex + 1) : ''}`,
            isHost: false,
            isBot: true,
            botDifficulty: difficulty,
            characterId: profile.characterId,
            carColor: profile.color,
            gearbox: 'AUTO',
            ready: true
          };
          room.players.push(botSlot);
          broadcastToRoom(room.code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastRoomList();
          return;
        }

        if (type === 'REMOVE_BOT') {
          if (room.hostId !== session.id) return;
          const botId = typeof payload.botId === 'string' ? payload.botId : '';
          room.players = room.players.filter(p => !(p.isBot && p.id === botId));
          broadcastToRoom(room.code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastRoomList();
          return;
        }

        if (type === 'CHAT') {
          const cr = hitRateLimit(ts, session.chatWindowStart, session.chatCount, 5000, 5);
          if (cr.reset) {
            session.chatWindowStart = ts;
            session.chatCount = 1;
          } else if (cr.exceeded) {
            send(ws, 'ERROR', { message: 'Chat throttled. Please wait a second.' });
            return;
          } else {
            session.chatCount++;
          }
          const sender = room.players.find(p => p.id === session.id);
          const text = sanitizeName(payload.text, '', 120);
          if (sender && text) {
            broadcastToRoom(room.code, 'CHAT_MSG', {
              senderId: session.id,
              sender: sender.name,
              text,
              isSystem: false
            });
          }
          return;
        }

        if (type === 'START_GAME') {
          if (room.hostId !== session.id) {
            send(ws, 'ERROR', { message: 'Only host can start the match.' });
            return;
          }
          room.status = 'PLAYING';
          room.leaderboard.clear();
          broadcastToRoom(room.code, 'GAME_START', { room: sanitizeRoom(room) });
          broadcastRoomList();
          return;
        }

        if (type === 'RETURN_TO_LOBBY') {
          if (room.hostId !== session.id) return;
          room.status = 'LOBBY';
          room.leaderboard.clear();
          broadcastToRoom(room.code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastRoomList();
          return;
        }

        if (type === 'PLAYER_STATE') {
          const slot = room.players.find(p => p.id === session.id);
          if (!slot) return;
          room.playerStates[session.id] = sanitizePlayerState(session.id, payload, slot);
          broadcastToRoom(room.code, 'WORLD_STATE', { states: room.playerStates }, session.id);
          return;
        }

        if (type === 'EMOJI_FX') {
          const sender = room.players.find(p => p.id === session.id);
          broadcastToRoom(room.code, 'EMOJI_FX', {
            senderId: session.id,
            senderName: sender?.name || 'Player',
            emoji: sanitizeName(payload.emoji, 'GO', 12)
          });
          return;
        }

        if (type === 'MELEE_HIT') {
          const targetId = typeof payload.targetId === 'string' ? payload.targetId.trim().slice(0, 48) : '';
          if (!targetId || targetId === session.id) return;
          if (ts - session.lastMeleeAt < 220) return;
          session.lastMeleeAt = ts;

          // A hit is only credible when both live states exist, the target is a real
          // room participant, and the match is actually running. Without these guards
          // a client could damage anyone by omitting PLAYER_STATE or targeting a
          // reconnecting player whose state is temporarily absent.
          if (room.status !== 'PLAYING') return;
          if (!room.players.some((p) => p.id === targetId)) return;
          const attackerState = room.playerStates[session.id];
          const targetState = room.playerStates[targetId];
          if (!attackerState || !targetState) return;
          const dist = Math.hypot(
            attackerState.x - targetState.x,
            attackerState.y - targetState.y,
            attackerState.z - targetState.z
          );
          if (dist > 6.5) return;

          const rawDx = finiteNum(payload.dirX, 0, -1, 1);
          const rawDz = finiteNum(payload.dirZ, -1, -1, 1);
          const len = Math.hypot(rawDx, rawDz) || 1;
          broadcastToRoom(room.code, 'MELEE_HIT', {
            attackerId: session.id,
            targetId,
            damage: Math.round(finiteNum(payload.damage, 20, 5, 45)),
            dirX: rawDx / len,
            dirZ: rawDz / len
          });
          return;
        }

        if (type === 'RESULT_SUBMIT') {
          const slot = room.players.find(p => p.id === session.id);
          if (!slot) return;
          // Scores only count for a match that actually started, in the mode the room
          // was created with. Otherwise any lobby member could post a fake global best.
          if (room.status !== 'PLAYING') return;
          const mode = VALID_MODES.has(payload.mode as GameModeId) ? payload.mode as GameModeId : room.mode;
          if (mode !== room.mode) return;
          if (ts - session.lastResultAt < 1000) return;
          session.lastResultAt = ts;

          const score = Math.round(finiteNum(payload.score, 0, 0, 10_000_000));
          const bestTimeMs = Number.isFinite(payload.bestTimeMs)
            ? Math.round(finiteNum(payload.bestTimeMs, 0, 500, 3_600_000))
            : undefined;
          const combo = Number.isFinite(payload.combo)
            ? Math.round(finiteNum(payload.combo, 1, 1, 500))
            : undefined;
          room.leaderboard.set(session.id, {
            playerId: session.id,
            name: slot.name,
            score,
            bestTimeMs,
            combo,
            finishedAt: ts
          });
          broadcastToRoom(room.code, 'LEADERBOARD_UPDATE', {
            mode: room.mode,
            entries: getLeaderboardEntries(room)
          });
          if (scoresFile) {
            // Identity is the server-issued session id, not a client-supplied display name.
            // Legacy entries without playerId are adopted once by matching name.
            const key = session.id;
            const legacyKey = slot.name.toLowerCase();
            const legacy = globalScores.get(legacyKey);
            if (legacy && !legacy.playerId) globalScores.delete(legacyKey);
            const prev = globalScores.get(key) || (legacy && !legacy.playerId ? legacy : undefined);
            if (!prev || score > prev.score) {
              globalScores.set(key, {
                playerId: session.id,
                name: slot.name,
                score,
                bestTimeMs,
                mode: room.mode,
                updatedAt: ts
              });
              scheduleScoreSave();
            }
          }
          return;
        }

        if (type === 'BALL_SYNC' && room.hostId === session.id) {
          const safeBall = {
            x: finiteNum(payload.x, 0, -1200, 1200),
            y: finiteNum(payload.y, 0.5, -20, 200),
            z: finiteNum(payload.z, 0, -1200, 1200),
            vx: finiteNum(payload.vx, 0, -120, 120),
            vy: finiteNum(payload.vy, 0, -120, 120),
            vz: finiteNum(payload.vz, 0, -120, 120)
          };
          broadcastToRoom(room.code, 'BALL_SYNC', safeBall, session.id);
        }
      });

      ws.on('close', (code) => {
        const activeCode = session.roomCode;
        clients.delete(session.id);

        // Normal clean close (1000/1005) removes immediately so tests & explicit leaves leave zero stale ghosts;
        // Abnormal network drop (1006, 1001, heartbeat timeout) keeps a 15s reconnect grace reservation while still clearing live WORLD_STATE ghost immediately.
        if (activeCode && code !== 1000 && code !== 1005) {
          const room = rooms.get(activeCode);
          const slot = room?.players.find(p => p.id === session.id);
          if (room && slot) {
            delete room.playerStates[session.id];
            broadcastToRoom(activeCode, 'WORLD_STATE', { states: room.playerStates });
            broadcastToRoom(activeCode, 'CHAT_MSG', {
              sender: 'System',
              text: `${slot.name} disconnected (15s recovery window)...`,
              isSystem: true
            });
            const wasHost = room.hostId === session.id;
            const timer = setTimeout(() => {
              recoverable.delete(session.resumeToken);
              finalizePlayerRemoval(activeCode, session.id, `${slot.name} timed out.`);
            }, sessionGraceMs);
            timer.unref?.();
            recoverable.set(session.resumeToken, {
              clientId: session.id,
              resumeToken: session.resumeToken,
              roomCode: activeCode,
              slot: { ...slot },
              wasHost,
              expiresAt: Date.now() + sessionGraceMs,
              timer
            });
            return;
          }
        }

        session.roomCode = activeCode;
        leaveCurrentRoom(session);
      });
    });
  };

  const handleFileRequest = (
    req: IncomingMessage,
    res: ServerResponse,
    pathname: string,
    searchParams: URLSearchParams
  ): void => {
    const roomCode = (searchParams.get('room') || '').trim().toUpperCase().slice(0, 8);
    const sendJson = (status: number, body: unknown) => {
      if (res.headersSent) return;
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    const totalStoredBytes = () => {
      let sum = 0;
      for (const f of files.values()) sum += f.size;
      for (const n of pendingFileBytes.values()) sum += n;
      return sum;
    };
    const releaseRoomReservation = (code: string, bytes: number) => {
      const left = (pendingFileBytes.get(code) || 0) - bytes;
      if (left > 0) pendingFileBytes.set(code, left);
      else pendingFileBytes.delete(code);
    };

    const downloadMatch = /^\/([a-f0-9]{16})$/.exec(pathname);
    const tokenHeader = req.headers['x-resume-token'];
    const requestToken = typeof tokenHeader === 'string' ? tokenHeader.trim() : '';
    const requestingSession = requestToken ? sessionByResumeToken(requestToken) : undefined;
    const requestingRoom = requestingSession?.roomCode ? rooms.get(requestingSession.roomCode) : undefined;
    const isRoomMember = Boolean(requestingSession && requestingRoom && requestingRoom.code === roomCode);

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (!isRoomMember) {
        sendJson(403, { error: 'Join the room before reading shared files.' });
        return;
      }
      if (downloadMatch) {
        const file = files.get(downloadMatch[1]);
        if (!file || file.expiresAt <= Date.now() || !roomCode || file.roomCode !== roomCode) {
          sendJson(404, { error: 'File not found or expired.' });
          return;
        }
        const asciiName = file.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
        res.writeHead(200, {
          'Content-Type': file.mime,
          'Content-Length': file.size,
          'Content-Disposition': `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store'
        });
        if (req.method === 'HEAD') res.end();
        else res.end(file.data);
        return;
      }

      if (pathname === '/' || pathname === '') {
        const room = roomCode ? rooms.get(roomCode) : undefined;
        if (!room) {
          sendJson(404, { error: 'Room not found.' });
          return;
        }
        sendJson(200, { files: getRoomFiles(room.code) });
        return;
      }

      sendJson(404, { error: 'Not found.' });
      return;
    }

    if (req.method !== 'POST') {
      sendJson(405, { error: 'Method not allowed.' });
      return;
    }

    if (pathname !== '/' && pathname !== '') {
      sendJson(404, { error: 'Not found.' });
      return;
    }

    const session = requestingSession;
    const room = requestingRoom;
    if (!session || !room || room.code !== roomCode) {
      sendJson(403, { error: 'Join the room before sharing files.' });
      return;
    }

    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > SHARED_FILE_LIMITS.maxFileBytes) {
      sendJson(413, { error: `File too large (max ${formatBytes(SHARED_FILE_LIMITS.maxFileBytes)}).` });
      req.resume();
      return;
    }

    const existing = getRoomFiles(room.code);
    if (existing.length >= SHARED_FILE_LIMITS.maxFilesPerRoom || files.size >= MAX_TOTAL_FILES) {
      sendJson(429, { error: `Room file limit reached (${SHARED_FILE_LIMITS.maxFilesPerRoom}). Wait for old files to expire.` });
      return;
    }
    const reservation = Number.isFinite(declared) && declared > 0 ? Math.floor(declared) : 0;
    if (totalStoredBytes() + reservation > MAX_TOTAL_FILE_BYTES) {
      sendJson(413, { error: `Server file storage full (max ${formatBytes(MAX_TOTAL_FILE_BYTES)}).` });
      req.resume();
      return;
    }
    pendingFileBytes.set(room.code, (pendingFileBytes.get(room.code) || 0) + reservation);
    let reservationReleased = false;
    const releaseReservation = () => {
      if (reservationReleased) return;
      reservationReleased = true;
      releaseRoomReservation(room.code, reservation);
    };
    const usedBytes = existing.reduce((sum, f) => sum + f.size, 0) + (pendingFileBytes.get(room.code) || 0) - reservation;

    const chunks: Buffer[] = [];
    let total = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      total += chunk.length;
      if (total > SHARED_FILE_LIMITS.maxFileBytes) {
        aborted = true;
        releaseReservation();
        sendJson(413, { error: `File too large (max ${formatBytes(SHARED_FILE_LIMITS.maxFileBytes)}).` });
        req.resume();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) return;
      releaseReservation();
      if (total === 0) {
        sendJson(400, { error: 'Empty file.' });
        return;
      }
      if (usedBytes + total > SHARED_FILE_LIMITS.maxRoomBytes) {
        sendJson(413, { error: `Room storage full (max ${formatBytes(SHARED_FILE_LIMITS.maxRoomBytes)}).` });
        return;
      }
      if (files.size >= MAX_TOTAL_FILES || totalStoredBytes() + total > MAX_TOTAL_FILE_BYTES) {
        sendJson(413, { error: 'Server file storage full.' });
        return;
      }

      const name = sanitizeFileName(decodeHeaderValue(req.headers['x-file-name']));
      const mime = sanitizeMime(decodeHeaderValue(req.headers['x-file-type']));
      const ownerName = room.players.find(p => p.id === session.id)?.name || 'Player';
      const info: SharedFileInfo = {
        id: crypto.randomBytes(8).toString('hex'),
        name,
        mime,
        size: total,
        ownerName,
        createdAt: Date.now()
      };

      files.set(info.id, {
        ...info,
        roomCode: room.code,
        data: Buffer.concat(chunks),
        expiresAt: Date.now() + SHARED_FILE_LIMITS.ttlMs
      });

      broadcastToRoom(room.code, 'FILE_SHARE', { file: info });
      broadcastToRoom(room.code, 'CHAT_MSG', {
        sender: 'System',
        text: `📎 ${ownerName} shared "${name}" (${formatBytes(total)})`,
        isSystem: true
      });
      sendJson(201, { file: info, url: `/api/files/${info.id}?room=${room.code}` });
    });

    req.on('aborted', () => {
      aborted = true;
      releaseReservation();
    });
    req.on('error', () => {
      if (aborted) return;
      aborted = true;
      releaseReservation();
      sendJson(400, { error: 'Upload failed.' });
    });
  };

  const attachMiddlewares = (middlewares: NonNullable<LanLobbyServerLike['middlewares']>, getPort: () => number) => {
    middlewares.use('/api/lan-info', (req: IncomingMessage, res: ServerResponse) => {
      const info = resolveNetworkInfo(req, getPort());
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(info));
    });
    middlewares.use('/api/files', (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', 'http://localhost');
      handleFileRequest(req, res, url.pathname, url.searchParams);
    });
    middlewares.use('/api/leaderboard', (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ entries: getGlobalLeaderboard(20), persistent: Boolean(scoresFile) }));
    });
    middlewares.use('/api/health', (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        rooms: rooms.size,
        clients: clients.size,
        recoverable: recoverable.size,
        files: files.size,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000)
      }));
    });
  };

  const shutdown = () => {
    flushGlobalScores();
    for (const timer of intervals) clearInterval(timer);
    intervals.clear();
    for (const rec of recoverable.values()) clearTimeout(rec.timer);
    recoverable.clear();
    for (const wss of sockets) wss.close();
    sockets.clear();
  };

  return {
    attachWebSocket,
    attachMiddlewares,
    getNetworkInfo: resolveNetworkInfo,
    handleFileRequest,
    getGlobalLeaderboard,
    getStats: () => ({
      rooms: rooms.size,
      clients: clients.size,
      recoverable: recoverable.size,
      files: files.size,
      uptimeSec: Math.round((Date.now() - startedAt) / 1000)
    }),
    shutdown
  };
}

export function lanLobbyPlugin(): {
  name: string;
  configureServer(server: LanLobbyServerLike): void;
  configurePreviewServer(server: LanLobbyServerLike): void;
} {
  const backend = createLobbyBackend({ dataDir: process.env.APEX_DATA_DIR || undefined });

  return {
    name: 'vite-plugin-lan-lobby',
    configureServer(server) {
      if (server.middlewares) {
        backend.attachMiddlewares(server.middlewares, () => {
          const addr = server.httpServer?.address();
          return typeof addr === 'object' && addr ? addr.port : 5173;
        });
      }
      if (server.httpServer) backend.attachWebSocket(server.httpServer);
    },
    configurePreviewServer(server) {
      if (server.middlewares) {
        backend.attachMiddlewares(server.middlewares, () => {
          const addr = server.httpServer?.address();
          return typeof addr === 'object' && addr ? addr.port : 5174;
        });
      }
      if (server.httpServer) backend.attachWebSocket(server.httpServer);
    }
  };
}
