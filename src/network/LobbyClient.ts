import QRCode from 'qrcode';
import type {
  BotDifficulty,
  CharacterId,
  GameModeId,
  LanNetworkInfo,
  NetworkPlayerSync,
  RoomState,
  RoomSummary
} from './LobbyProtocol';

export class LobbyClient {
  private ws: WebSocket | null = null;
  public clientId: string = 'local_' + Math.random().toString(36).slice(2, 7);
  public isConnected = false;
  public currentRoom: RoomState | null = null;
  public lanInfo: LanNetworkInfo | null = null;

  public onConnectionChange: (connected: boolean) => void = () => {};
  public onRoomList: (rooms: RoomSummary[]) => void = () => {};
  public onRoomState: (room: RoomState | null) => void = () => {};
  public onChatMessage: (sender: string, text: string, isSystem: boolean, senderId?: string) => void = () => {};
  public onGameStart: (room: RoomState) => void = () => {};
  public onWorldState: (states: Record<string, NetworkPlayerSync>) => void = () => {};
  public onEmojiFx: (senderId: string, senderName: string, emoji: string) => void = () => {};
  public onMeleeHit: (data: { attackerId: string; targetId: string; damage: number; dirX: number; dirZ: number }) => void = () => {};
  public onBallSync: (data: { x: number; y: number; z: number; vx: number; vy: number; vz: number }) => void = () => {};
  public onError: (msg: string) => void = () => {};

  constructor() {
    this.fetchLanInfo();
    this.connect();
  }

  public async fetchLanInfo(): Promise<LanNetworkInfo | null> {
    try {
      const res = await fetch('/api/lan-info');
      if (res.ok) {
        this.lanInfo = await res.json();
        return this.lanInfo;
      }
    } catch {}
    return null;
  }

  public connect(): void {
    try {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}/ws`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.onConnectionChange(true);
        this.send('LIST_ROOMS', {});
      };

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          this.handleMessage(msg.type, msg.payload);
        } catch {}
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.onConnectionChange(false);
        setTimeout(() => {
          if (!this.isConnected) this.connect();
        }, 2500);
      };
    } catch {
      this.isConnected = false;
    }
  }

  private handleMessage(type: string, payload: any): void {
    switch (type) {
      case 'WELCOME':
        this.clientId = payload.clientId;
        break;
      case 'ROOM_LIST':
        this.onRoomList(payload.rooms || []);
        break;
      case 'ROOM_STATE':
        this.currentRoom = payload.room || null;
        this.onRoomState(this.currentRoom);
        break;
      case 'CHAT_MSG':
        this.onChatMessage(payload.sender, payload.text, !!payload.isSystem, payload.senderId);
        break;
      case 'GAME_START':
        this.currentRoom = payload.room;
        this.onGameStart(payload.room);
        break;
      case 'WORLD_STATE':
        this.onWorldState(payload.states || {});
        break;
      case 'EMOJI_FX':
        this.onEmojiFx(payload.senderId, payload.senderName, payload.emoji);
        break;
      case 'MELEE_HIT':
        this.onMeleeHit(payload);
        break;
      case 'BALL_SYNC':
        this.onBallSync(payload);
        break;
      case 'ERROR':
        this.onError(payload.message || 'Unknown error');
        break;
    }
  }

  private send(type: string, payload: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  public createRoom(opts: {
    playerName: string;
    roomName: string;
    characterId: CharacterId;
    carColor: string;
    gearbox: 'AUTO' | 'SEMI' | 'MANUAL';
    mode: GameModeId;
    laps: number;
  }): void {
    this.send('CREATE_ROOM', opts);
  }

  public joinRoom(opts: {
    code: string;
    playerName: string;
    characterId: CharacterId;
    carColor: string;
    gearbox: 'AUTO' | 'SEMI' | 'MANUAL';
  }): void {
    this.send('JOIN_ROOM', opts);
  }

  public leaveRoom(): void {
    this.currentRoom = null;
    this.send('LEAVE_ROOM', {});
    this.onRoomState(null);
  }

  public updatePlayer(opts: {
    name?: string;
    characterId?: CharacterId;
    carColor?: string;
    gearbox?: 'AUTO' | 'SEMI' | 'MANUAL';
    ready?: boolean;
  }): void {
    this.send('UPDATE_PLAYER', opts);
  }

  public updateRoom(opts: { mode?: GameModeId; laps?: number }): void {
    this.send('UPDATE_ROOM', opts);
  }

  public addBot(difficulty: BotDifficulty = 'PRO'): void {
    this.send('ADD_BOT', { difficulty });
  }

  public removeBot(botId: string): void {
    this.send('REMOVE_BOT', { botId });
  }

  public sendChat(text: string): void {
    this.send('CHAT', { text });
  }

  public startGame(): void {
    this.send('START_GAME', {});
  }

  public sendWorldSync(state: Omit<NetworkPlayerSync, 'id'>): void {
    this.send('PLAYER_STATE', state);
  }

  public sendEmoji(emoji: string): void {
    this.send('EMOJI_FX', { emoji });
  }

  public sendMeleeHit(targetId: string, damage: number, dirX: number, dirZ: number): void {
    this.send('MELEE_HIT', { targetId, damage, dirX, dirZ });
  }

  public sendBallSync(state: { x: number; y: number; z: number; vx: number; vy: number; vz: number }): void {
    this.send('BALL_SYNC', state);
  }

  public async renderHotspotQR(canvas: HTMLCanvasElement, roomCode?: string): Promise<string> {
    const info = this.lanInfo || (await this.fetchLanInfo());
    const baseUrl = info ? info.preferredUrl : location.origin;
    const shareUrl = roomCode ? `${baseUrl}/?room=${roomCode}` : baseUrl;
    try {
      await QRCode.toCanvas(canvas, shareUrl, {
        width: 112,
        margin: 1,
        color: { dark: '#090d16', light: '#f8fafc' }
      });
    } catch {}
    return shareUrl;
  }
}
