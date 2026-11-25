import os from 'os';
import type { IncomingMessage, ServerResponse } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  BotDifficulty,
  CharacterId,
  GameModeId,
  PlayerSlot,
  RoomState,
  RoomSummary
} from '../src/network/LobbyProtocol';

interface ClientSession {
  id: string;
  ws: WebSocket;
  roomCode: string | null;
}

interface InternalRoom extends RoomState {
  hostId: string;
  playerStates: Record<string, unknown>;
}

const BOT_PROFILES: { name: string; characterId: CharacterId; color: string }[] = [
  { name: 'BOT Takumi', characterId: 'kaito', color: '#f8fafc' },
  { name: 'BOT Mika', characterId: 'mika', color: '#dc2626' },
  { name: 'BOT Ren', characterId: 'ren', color: '#2563eb' },
  { name: 'BOT Sora', characterId: 'sora', color: '#eab308' },
  { name: 'BOT Ryosuke', characterId: 'kaito', color: '#18181b' }
];

function getLocalLanIps(): string[] {
  const ifaces = os.networkInterfaces();
  const ips: string[] = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    for (const info of list) {
      if (info.family === 'IPv4' && !info.internal) {
        // Prioritize Android hotspot subnets (192.168.43.x / ap0 / wlan)
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

function generateRoomCode(existing: Map<string, InternalRoom>): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!existing.has(code)) return code;
  }
  return String(Date.now()).slice(-4);
}

export interface LanLobbyServerLike {
  httpServer: any;
  middlewares: {
    use: (route: string, handler: (req: IncomingMessage, res: ServerResponse) => void) => unknown;
  };
}

export function lanLobbyPlugin(): {
  name: string;
  configureServer(server: LanLobbyServerLike): void;
  configurePreviewServer(server: LanLobbyServerLike): void;
} {
  const rooms = new Map<string, InternalRoom>();
  const clients = new Map<string, ClientSession>();
  const attachedServers = new WeakSet<object>();

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

  const broadcastToRoom = (roomCode: string, type: string, payload: unknown, exceptId?: string) => {
    for (const c of clients.values()) {
      if (c.roomCode === roomCode && c.id !== exceptId) {
        send(c.ws, type, payload);
      }
    }
  };

  const leaveCurrentRoom = (session: ClientSession) => {
    if (!session.roomCode) return;
    const room = rooms.get(session.roomCode);
    const oldCode = session.roomCode;
    session.roomCode = null;

    if (!room) return;
    const leavingPlayer = room.players.find(p => p.id === session.id);
    room.players = room.players.filter(p => p.id !== session.id);
    delete room.playerStates[session.id];

    const humanCount = room.players.filter(p => !p.isBot).length;
    if (humanCount === 0) {
      rooms.delete(oldCode);
      broadcastRoomList();
      return;
    }

    // Migrate host if host left
    if (room.hostId === session.id) {
      const nextHost = room.players.find(p => !p.isBot);
      if (nextHost) {
        nextHost.isHost = true;
        nextHost.ready = true;
        room.hostId = nextHost.id;
      }
    }

    broadcastToRoom(oldCode, 'ROOM_STATE', { room: sanitizeRoom(room) });
    broadcastToRoom(oldCode, 'WORLD_STATE', { states: room.playerStates });
    if (leavingPlayer) {
      broadcastToRoom(oldCode, 'CHAT_MSG', {
        sender: 'System',
        text: `${leavingPlayer.name} left the lobby.`,
        isSystem: true
      });
    }
    broadcastRoomList();
  };

  const attachWebSocket = (httpServer: any) => {
    if (!httpServer || attachedServers.has(httpServer)) return;
    attachedServers.add(httpServer);

    const wss = new WebSocketServer({ noServer: true });

    httpServer.on('upgrade', (req: IncomingMessage, socket: any, head: Buffer) => {
      const url = req.url || '';
      if (url.startsWith('/ws')) {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      }
    });

    wss.on('connection', (ws: WebSocket) => {
      const clientId = 'p_' + Math.random().toString(36).slice(2, 9);
      const session: ClientSession = { id: clientId, ws, roomCode: null };
      clients.set(clientId, session);

      send(ws, 'WELCOME', { clientId });
      send(ws, 'ROOM_LIST', { rooms: getRoomSummaries() });

      ws.on('message', (raw) => {
        let msg: { type: string; payload?: any };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        const { type, payload = {} } = msg;

        if (type === 'LIST_ROOMS') {
          send(ws, 'ROOM_LIST', { rooms: getRoomSummaries() });
          return;
        }

        if (type === 'CREATE_ROOM') {
          leaveCurrentRoom(session);
          const code = generateRoomCode(rooms);
          const hostSlot: PlayerSlot = {
            id: clientId,
            name: String(payload.playerName || 'Host').slice(0, 16),
            isHost: true,
            isBot: false,
            characterId: payload.characterId || 'kaito',
            carColor: payload.carColor || '#ff5500',
            gearbox: payload.gearbox || 'AUTO',
            ready: true
          };
          const room: InternalRoom = {
            code,
            name: String(payload.roomName || `${hostSlot.name}'s Hotspot`).slice(0, 24),
            mode: (payload.mode as GameModeId) || 'OPEN_WORLD',
            laps: Number.isFinite(payload.laps) ? payload.laps : 3,
            status: 'LOBBY',
            players: [hostSlot],
            maxPlayers: 8,
            hostId: clientId,
            playerStates: {}
          };
          rooms.set(code, room);
          session.roomCode = code;
          send(ws, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastRoomList();
          return;
        }

        if (type === 'JOIN_ROOM') {
          const code = String(payload.code || '').trim();
          const room = rooms.get(code);
          if (!room) {
            send(ws, 'ERROR', { message: `Room #${code} not found on this hotspot.` });
            return;
          }
          if (room.players.length >= room.maxPlayers) {
            send(ws, 'ERROR', { message: 'Room is full (8/8).' });
            return;
          }
          leaveCurrentRoom(session);
          const slot: PlayerSlot = {
            id: clientId,
            name: String(payload.playerName || 'Racer').slice(0, 16),
            isHost: false,
            isBot: false,
            characterId: payload.characterId || 'mika',
            carColor: payload.carColor || '#2563eb',
            gearbox: payload.gearbox || 'AUTO',
            ready: false
          };
          room.players.push(slot);
          session.roomCode = code;
          broadcastToRoom(code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastToRoom(code, 'CHAT_MSG', {
            sender: 'System',
            text: `${slot.name} joined via Hotspot LAN!`,
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
        if (!room) return;

        if (type === 'UPDATE_PLAYER') {
          const slot = room.players.find(p => p.id === clientId);
          if (!slot) return;
          if (payload.name) slot.name = String(payload.name).slice(0, 16);
          if (payload.characterId) slot.characterId = payload.characterId;
          if (payload.carColor) slot.carColor = payload.carColor;
          if (payload.gearbox) slot.gearbox = payload.gearbox;
          if (typeof payload.ready === 'boolean' && !slot.isHost) slot.ready = payload.ready;
          broadcastToRoom(room.code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          return;
        }

        if (type === 'UPDATE_ROOM' && room.hostId === clientId) {
          if (payload.mode) room.mode = payload.mode;
          if (Number.isFinite(payload.laps)) room.laps = payload.laps;
          broadcastToRoom(room.code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastRoomList();
          return;
        }

        if (type === 'ADD_BOT' && room.hostId === clientId) {
          if (room.players.length >= room.maxPlayers) return;
          const botIndex = room.players.filter(p => p.isBot).length;
          const profile = BOT_PROFILES[botIndex % BOT_PROFILES.length];
          const botSlot: PlayerSlot = {
            id: 'bot_' + Math.random().toString(36).slice(2, 7),
            name: `${profile.name}${botIndex >= BOT_PROFILES.length ? ' ' + (botIndex + 1) : ''}`,
            isHost: false,
            isBot: true,
            botDifficulty: (payload.difficulty as BotDifficulty) || 'PRO',
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

        if (type === 'REMOVE_BOT' && room.hostId === clientId) {
          room.players = room.players.filter(p => !(p.isBot && p.id === payload.botId));
          broadcastToRoom(room.code, 'ROOM_STATE', { room: sanitizeRoom(room) });
          broadcastRoomList();
          return;
        }

        if (type === 'CHAT') {
          const sender = room.players.find(p => p.id === clientId);
          const text = String(payload.text || '').trim().slice(0, 120);
          if (sender && text) {
            broadcastToRoom(room.code, 'CHAT_MSG', {
              senderId: clientId,
              sender: sender.name,
              text,
              isSystem: false
            });
          }
          return;
        }

        if (type === 'START_GAME' && room.hostId === clientId) {
          room.status = 'PLAYING';
          broadcastToRoom(room.code, 'GAME_START', { room: sanitizeRoom(room) });
          broadcastRoomList();
          return;
        }

        if (type === 'PLAYER_STATE') {
          room.playerStates[clientId] = { ...payload, id: clientId };
          broadcastToRoom(room.code, 'WORLD_STATE', { states: room.playerStates }, clientId);
          return;
        }

        if (type === 'EMOJI_FX') {
          const sender = room.players.find(p => p.id === clientId);
          broadcastToRoom(room.code, 'EMOJI_FX', {
            senderId: clientId,
            senderName: sender?.name || 'Player',
            emoji: String(payload.emoji || '🔥').slice(0, 6)
          });
          return;
        }

        if (type === 'MELEE_HIT') {
          broadcastToRoom(room.code, 'MELEE_HIT', {
            attackerId: clientId,
            targetId: payload.targetId,
            damage: Number(payload.damage) || 20,
            dirX: Number(payload.dirX) || 0,
            dirZ: Number(payload.dirZ) || -1
          });
          return;
        }

        if (type === 'BALL_SYNC' && room.hostId === clientId) {
          broadcastToRoom(room.code, 'BALL_SYNC', payload, clientId);
          return;
        }
      });

      ws.on('close', () => {
        leaveCurrentRoom(session);
        clients.delete(clientId);
      });
    });
  };

  const attachMiddlewares = (middlewares: any, getPort: () => number) => {
    middlewares.use('/api/lan-info', (_req: IncomingMessage, res: ServerResponse) => {
      const ips = getLocalLanIps();
      const port = getPort();
      const preferredUrl = `http://${ips[0]}:${port}`;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ips, port, preferredUrl }));
    });
  };

  return {
    name: 'vite-plugin-lan-lobby',
    configureServer(server) {
      attachMiddlewares(server.middlewares, () => {
        const addr = server.httpServer?.address();
        return typeof addr === 'object' && addr ? addr.port : 5173;
      });
      if (server.httpServer) attachWebSocket(server.httpServer);
    },
    configurePreviewServer(server) {
      attachMiddlewares(server.middlewares, () => {
        const addr = server.httpServer?.address();
        return typeof addr === 'object' && addr ? addr.port : 5174;
      });
      if (server.httpServer) attachWebSocket(server.httpServer);
    }
  };
}
