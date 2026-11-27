import QRCode from 'qrcode';
import type {
  BotDifficulty,
  CharacterId,
  GameModeId,
  LanNetworkInfo,
  LeaderboardEntry,
  NetworkMode,
  NetworkPlayerSync,
  RoomState,
  RoomSummary,
  SharedFileInfo
} from './LobbyProtocol';
import { SHARED_FILE_LIMITS } from './LobbyProtocol';

export type ConnectionState = 'OFFLINE' | 'CONNECTING' | 'CONNECTED' | 'RECONNECTING' | 'ERROR';

function isLocalOrLanHostname(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h.startsWith('192.168.') ||
    h.startsWith('10.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(h) ||
    h.endsWith('.local')
  );
}

function hostOnly(hostWithPort: string): string {
  const h = hostWithPort.trim().toLowerCase();
  if (h.startsWith('[')) {
    const end = h.indexOf(']');
    return end > 0 ? h.slice(1, end) : h;
  }
  return h.split(':')[0];
}

function isPrivateLanTarget(hostWithPort: string): boolean {
  return isLocalOrLanHostname(hostOnly(hostWithPort));
}

export class LobbyClient {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private resumeToken: string | null = null;
  private pendingResumeToken: string | null = null;
  private wasInRoomCode: string | null = null;
  private intentionalDisconnect = false;
  private userSelectedOffline = false;
  private manualLanHost: string = '';

  public networkMode: NetworkMode = 'LAN';
  public connectionState: ConnectionState = 'OFFLINE';
  public clientId: string = 'local_' + Math.random().toString(36).slice(2, 7);
  public isConnected = false;
  public currentRoom: RoomState | null = null;
  public lanInfo: LanNetworkInfo | null = null;

  public onConnectionChange: (connected: boolean) => void = () => {};
  public onStatusChange: (state: ConnectionState, detail?: string) => void = () => {};
  public onRoomList: (rooms: RoomSummary[]) => void = () => {};
  public onRoomState: (room: RoomState | null) => void = () => {};
  public onChatMessage: (sender: string, text: string, isSystem: boolean, senderId?: string) => void = () => {};
  public onGameStart: (room: RoomState) => void = () => {};
  public onWorldState: (states: Record<string, NetworkPlayerSync>) => void = () => {};
  public onEmojiFx: (senderId: string, senderName: string, emoji: string) => void = () => {};
  public onMeleeHit: (data: { attackerId: string; targetId: string; damage: number; dirX: number; dirZ: number }) => void = () => {};
  public onBallSync: (data: { x: number; y: number; z: number; vx: number; vy: number; vz: number }) => void = () => {};
  public onLeaderboardUpdate: (data: { mode: GameModeId; entries: LeaderboardEntry[] }) => void = () => {};
  public onFileShare: (file: SharedFileInfo) => void = () => {};
  public onFileList: (files: SharedFileInfo[]) => void = () => {};
  public onError: (msg: string) => void = () => {};

  constructor() {
    this.installOnlineRecovery();
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.networkMode = 'OFFLINE';
      this.setStatus('OFFLINE', 'Device offline — Offline Solo active');
      return;
    }
    this.networkMode = typeof location !== 'undefined' && isLocalOrLanHostname(location.hostname) ? 'LAN' : 'ONLINE';
    void this.fetchLanInfo().then((info) => {
      if (info?.mode === 'ONLINE' && this.networkMode !== 'OFFLINE' && !this.manualLanHost) {
        this.networkMode = 'ONLINE';
      }
    });
    this.connect();
  }

  private setStatus(state: ConnectionState, detail?: string): void {
    this.connectionState = state;
    this.onStatusChange(state, detail);
  }

  /** Regain connectivity automatically when the app started while offline. */
  private installOnlineRecovery(): void {
    if (typeof window === 'undefined') return;
    window.addEventListener('online', () => {
      if (this.userSelectedOffline || this.networkMode !== 'OFFLINE') return;
      this.networkMode = typeof location !== 'undefined' && isLocalOrLanHostname(location.hostname) ? 'LAN' : 'ONLINE';
      this.setStatus('CONNECTING', 'Connection restored — reconnecting...');
      void this.fetchLanInfo().then((info) => {
        if (info?.mode === 'ONLINE' && this.networkMode !== 'OFFLINE' && !this.manualLanHost) {
          this.networkMode = 'ONLINE';
        }
      });
      this.connect();
    });
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public setNetworkMode(mode: NetworkMode, customHost?: string): void {
    this.networkMode = mode;
    this.userSelectedOffline = mode === 'OFFLINE';
    this.manualLanHost = (customHost || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    this.resumeToken = null;
    this.wasInRoomCode = null;
    this.currentRoom = null;
    this.onRoomState(null);

    if (mode === 'OFFLINE') {
      this.disconnect();
      return;
    }

    if (this.lanMixedContentBlocked()) {
      this.disconnect(false);
      const target = `http://${this.manualLanHost}`;
      this.setStatus('ERROR', `Open ${target} directly — HTTPS blocks ws:// LAN hosts.`);
      this.onError(`This page is HTTPS, so Chrome blocks ws://${this.manualLanHost}. Open ${target} on this device (or serve the game over http).`);
      return;
    }

    this.disconnect(false);
    void this.fetchLanInfo();
    this.connect();
  }

  /** Browsers block insecure ws:// / http:// requests from an HTTPS page. */
  private lanMixedContentBlocked(): boolean {
    if (typeof location === 'undefined' || location.protocol !== 'https:') return false;
    if (this.networkMode !== 'LAN' || !this.manualLanHost) return false;
    return isPrivateLanTarget(this.manualLanHost);
  }

  public disconnect(emitOfflineStatus = true): void {
    this.intentionalDisconnect = true;
    this.clearReconnectTimer();
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onmessage = null;
        this.ws.onerror = null;
        this.ws.onclose = null;
        this.ws.close(1000, 'Client disconnected');
      } catch {}
      this.ws = null;
    }
    const changed = this.isConnected;
    this.isConnected = false;
    if (changed) this.onConnectionChange(false);
    if (emitOfflineStatus) {
      this.setStatus('OFFLINE', 'Offline Solo mode — zero network dependency');
    }
  }

  private buildHttpBase(): string {
    if (this.networkMode === 'LAN' && this.manualLanHost) {
      const secure = typeof location !== 'undefined' && location.protocol === 'https:';
      return `${secure ? 'https' : 'http'}://${this.manualLanHost}`;
    }
    return location.origin;
  }

  private buildWsUrl(): string {
    if (this.networkMode === 'LAN' && this.manualLanHost) {
      const secure = typeof location !== 'undefined' && location.protocol === 'https:';
      return `${secure ? 'wss' : 'ws'}://${this.manualLanHost}/ws`;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  public async fetchLanInfo(): Promise<LanNetworkInfo | null> {
    if (this.networkMode === 'OFFLINE' || this.lanMixedContentBlocked()) return null;
    try {
      const res = await fetch(`${this.buildHttpBase()}/api/lan-info`);
      if (res.ok) {
        this.lanInfo = await res.json();
        return this.lanInfo;
      }
    } catch {}
    return null;
  }

  public connect(): void {
    if (this.networkMode === 'OFFLINE') {
      this.setStatus('OFFLINE', 'Offline Solo active');
      return;
    }
    if (this.lanMixedContentBlocked()) {
      this.setStatus('ERROR', `Open http://${this.manualLanHost} directly — HTTPS blocks ws:// LAN hosts.`);
      this.onError(`This page is HTTPS, so Chrome blocks ws://${this.manualLanHost}. Open http://${this.manualLanHost} instead.`);
      return;
    }
    this.clearReconnectTimer();
    this.intentionalDisconnect = false;
    this.setStatus(this.wasInRoomCode ? 'RECONNECTING' : 'CONNECTING');

    try {
      const url = this.buildWsUrl();
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.onConnectionChange(true);
        if (this.wasInRoomCode && this.resumeToken) {
          const tokenForResume = this.resumeToken;
          this.pendingResumeToken = tokenForResume;
          this.setStatus('RECONNECTING', `Resuming room #${this.wasInRoomCode}...`);
          this.send('RESUME_SESSION', { resumeToken: tokenForResume });
        } else {
          this.setStatus('CONNECTED', this.networkMode === 'ONLINE' ? 'Online lobby ready' : 'LAN lobby ready');
          this.send('LIST_ROOMS', {});
        }
      };

      this.ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          this.handleMessage(msg.type, msg.payload);
        } catch {}
      };

      this.ws.onerror = () => {
        if (!this.intentionalDisconnect) {
          this.setStatus('ERROR', this.networkMode === 'LAN' ? 'Cannot reach LAN host. Check hotspot & IP:port.' : 'Online server unreachable.');
        }
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.pendingResumeToken = null;
        this.isConnected = false;
        this.onConnectionChange(false);
        if (this.intentionalDisconnect || this.networkMode === 'OFFLINE') {
          this.setStatus('OFFLINE', 'Offline Solo active');
          return;
        }
        this.setStatus('RECONNECTING', this.wasInRoomCode ? `Reconnecting to #${this.wasInRoomCode}...` : 'Reconnecting...');
        this.reconnectTimer = window.setTimeout(() => {
          this.reconnectTimer = null;
          if (!this.isConnected && !this.intentionalDisconnect && this.networkMode !== 'OFFLINE') {
            this.connect();
          }
        }, 2500);
      };
    } catch {
      this.isConnected = false;
      this.setStatus('ERROR', 'Failed to initialize WebSocket');
    }
  }

  private handleMessage(type: string, payload: any): void {
    switch (type) {
      case 'WELCOME':
        this.clientId = payload.clientId;
        // Keep a fresh token issued for this socket even while an old-token resume is
        // in flight; the expired attempt must not poison later reconnects.
        if (
          typeof payload.resumeToken === 'string' &&
          (!this.wasInRoomCode || (this.pendingResumeToken && payload.resumeToken !== this.pendingResumeToken))
        ) {
          this.resumeToken = payload.resumeToken;
        }
        break;
      case 'SESSION_RESUMED':
        this.clientId = payload.clientId;
        if (typeof payload.resumeToken === 'string') {
          this.resumeToken = payload.resumeToken;
        }
        this.pendingResumeToken = null;
        this.currentRoom = payload.room || null;
        this.wasInRoomCode = this.currentRoom?.code || null;
        this.setStatus('CONNECTED', `Rejoined room #${this.currentRoom?.code || ''}`);
        this.onRoomState(this.currentRoom);
        break;
      case 'SESSION_EXPIRED':
        if (this.resumeToken === this.pendingResumeToken) this.resumeToken = null;
        this.pendingResumeToken = null;
        this.wasInRoomCode = null;
        this.currentRoom = null;
        this.setStatus('CONNECTED', 'Previous room expired');
        this.onRoomState(null);
        this.onError(payload?.reason || 'Previous multiplayer session expired.');
        this.send('LIST_ROOMS', {});
        break;
      case 'ROOM_LIST':
        this.onRoomList(payload.rooms || []);
        break;
      case 'ROOM_STATE':
        this.currentRoom = payload.room || null;
        this.wasInRoomCode = this.currentRoom?.code || null;
        this.onRoomState(this.currentRoom);
        break;
      case 'CHAT_MSG':
        this.onChatMessage(payload.sender, payload.text, !!payload.isSystem, payload.senderId);
        break;
      case 'GAME_START':
        this.currentRoom = payload.room;
        this.wasInRoomCode = this.currentRoom?.code || null;
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
      case 'LEADERBOARD_UPDATE':
        this.onLeaderboardUpdate({
          mode: payload.mode,
          entries: payload.entries || []
        });
        break;
      case 'FILE_SHARE':
        if (payload?.file) this.onFileShare(payload.file as SharedFileInfo);
        break;
      case 'ERROR':
        this.onError(payload.message || 'Unknown server error');
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
    this.wasInRoomCode = null;
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

  public returnToLobby(): void {
    this.send('RETURN_TO_LOBBY', {});
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

  public submitModeResult(opts: { mode: GameModeId; score: number; bestTimeMs?: number; combo?: number }): void {
    this.send('RESULT_SUBMIT', opts);
  }

  /** Download through an authenticated fetch; room codes are public, resume tokens are not. */
  public async downloadFile(fileId: string): Promise<{ blob: Blob; name: string }> {
    const room = this.currentRoom?.code || '';
    if (!room || this.networkMode === 'OFFLINE' || this.lanMixedContentBlocked()) {
      throw new Error('Join a room before downloading files.');
    }
    const res = await fetch(`${this.buildHttpBase()}/api/files/${encodeURIComponent(fileId)}?room=${encodeURIComponent(room)}`, {
      headers: { 'x-resume-token': this.resumeToken || '' },
      cache: 'no-store'
    });
    if (!res.ok) {
      let message = `Download failed (${res.status}).`;
      try {
        const data = await res.json();
        if (typeof data?.error === 'string') message = data.error;
      } catch {}
      throw new Error(message);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('content-disposition') || '';
    const utf8Name = /filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];
    const name = utf8Name ? decodeURIComponent(utf8Name) : (/filename="([^"]+)"/i.exec(disposition)?.[1] || fileId);
    return { blob, name };
  }

  public async fetchRoomFiles(): Promise<SharedFileInfo[]> {
    const room = this.currentRoom?.code;
    if (!room || this.networkMode === 'OFFLINE' || this.lanMixedContentBlocked()) return [];
    try {
      const res = await fetch(`${this.buildHttpBase()}/api/files?room=${encodeURIComponent(room)}`, {
        headers: { 'x-resume-token': this.resumeToken || '' },
        cache: 'no-store'
      });
      if (!res.ok) return [];
      const data = await res.json();
      const files = Array.isArray(data?.files) ? (data.files as SharedFileInfo[]) : [];
      this.onFileList(files);
      return files;
    } catch {
      return [];
    }
  }

  public async uploadFile(file: File): Promise<SharedFileInfo> {
    const room = this.currentRoom?.code;
    if (!room) throw new Error('Join a room before sharing files.');
    if (this.networkMode === 'OFFLINE') throw new Error('File sharing needs a LAN or Online room.');
    if (this.lanMixedContentBlocked()) {
      throw new Error(`Open http://${this.manualLanHost} directly — HTTPS blocks LAN uploads.`);
    }
    if (file.size === 0) throw new Error('File is empty.');
    if (file.size > SHARED_FILE_LIMITS.maxFileBytes) {
      const mb = Math.round(SHARED_FILE_LIMITS.maxFileBytes / (1024 * 1024));
      throw new Error(`File too large (max ${mb} MB).`);
    }
    const res = await fetch(`${this.buildHttpBase()}/api/files?room=${encodeURIComponent(room)}`, {
      method: 'POST',
      headers: {
        'x-resume-token': this.resumeToken || '',
        'x-file-name': encodeURIComponent(file.name),
        'x-file-type': file.type || 'application/octet-stream'
      },
      body: file
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status}).`);
    const info = data?.file as SharedFileInfo | undefined;
    if (!info) throw new Error('Upload failed: invalid server response.');
    this.onFileShare(info);
    return info;
  }

  public async renderHotspotQR(canvas: HTMLCanvasElement, roomCode?: string): Promise<string> {
    const info = this.lanInfo || (await this.fetchLanInfo());
    let baseUrl = location.origin;
    if (this.networkMode === 'LAN') {
      if (this.manualLanHost) {
        baseUrl = `http://${this.manualLanHost}`;
      } else if (info?.mode === 'LAN' && info.preferredUrl) {
        baseUrl = info.preferredUrl;
      }
    } else if (this.networkMode === 'ONLINE') {
      baseUrl = info?.publicUrl || location.origin;
    }

    const shareUrl = roomCode ? `${baseUrl}/?room=${encodeURIComponent(roomCode)}` : baseUrl;
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
