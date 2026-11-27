import crypto from 'crypto';
import os from 'os';
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
  RoomSummary
} from '../src/network/LobbyProtocol';

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

const MAX_PAYLOAD_BYTES = 8192;
const MAX_ROOMS = 200;
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
  const fwdHost = typeof req?.headers['x-forwarded-host'] === 'string' ? req.headers['x-forwarded-host'].split(',')[0].trim() : '';
  const fwdProto = typeof req?.headers['x-forwarded-proto'] === 'string' ? req.headers['x-forwarded-proto'].split(',')[0].trim() : 'https';
  const reqHost = typeof req?.headers.host === 'string' ? req.headers.host.trim() : '';
  const isCloudEnv = Boolean(
    process.env.RENDER ||
    process.env.RENDER_EXTERNAL_URL ||
    process.env.FLY_APP_NAME ||
    process.env.RAILWAY_ENVIRONMENT ||
    envPublic ||
    fwdHost
  );

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

export interface LobbyBackend {
  attachWebSocket(httpServer: any): void;
  attachMiddlewares(middlewares: NonNullable<LanLobbyServerLike['middlewares']>, getPort: () => number): void;
  getNetworkInfo(req: IncomingMessage | undefined, port: number): LanNetworkInfo;
  getStats(): { rooms: number; clients: number; recoverable: number; uptimeSec: number };
  shutdown(): void;
}

export interface LobbyBackendOptions {
  sessionGraceMs?: number;
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
        lastMeleeAt: 0
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

          const attackerState = room.playerStates[session.id];
          const targetState = room.playerStates[targetId];
          if (attackerState && targetState) {
            const dist = Math.hypot(
              attackerState.x - targetState.x,
              attackerState.y - targetState.y,
              attackerState.z - targetState.z
            );
            if (dist > 6.5) return;
          }

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

  const attachMiddlewares = (middlewares: NonNullable<LanLobbyServerLike['middlewares']>, getPort: () => number) => {
    middlewares.use('/api/lan-info', (req: IncomingMessage, res: ServerResponse) => {
      const info = resolveNetworkInfo(req, getPort());
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(info));
    });
    middlewares.use('/api/health', (_req: IncomingMessage, res: ServerResponse) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        ok: true,
        rooms: rooms.size,
        clients: clients.size,
        recoverable: recoverable.size,
        uptimeSec: Math.round((Date.now() - startedAt) / 1000)
      }));
    });
  };

  const shutdown = () => {
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
    getStats: () => ({
      rooms: rooms.size,
      clients: clients.size,
      recoverable: recoverable.size,
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
  const backend = createLobbyBackend();

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
