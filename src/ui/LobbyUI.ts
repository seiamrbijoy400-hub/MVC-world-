import { LobbyClient } from '../network/LobbyClient';
import { checkOfflinePackStatus, downloadOfflinePack } from '../game/OfflinePack';
import type {
  BotDifficulty,
  CharacterId,
  GameModeId,
  NetworkMode,
  RoomState,
  RoomSummary,
  SharedFileInfo
} from '../network/LobbyProtocol';
import { GearboxType } from '../physics/CarPhysics';

export interface LobbyConfig {
  playerName: string;
  characterId: CharacterId;
  carColor: string;
  gearbox: GearboxType;
  mode: GameModeId;
  laps: number;
  room: RoomState | null;
}

export class LobbyUI {
  private overlay: HTMLElement;
  private homeView: HTMLElement;
  private roomView: HTMLElement;
  private statusBadge: HTMLElement;

  private nameInput: HTMLInputElement;
  private codeInput: HTMLInputElement;
  private roomListBox: HTMLElement;
  private globalBoard: HTMLElement;

  private qrCanvas: HTMLCanvasElement;
  private roomTitleText: HTMLElement;
  private roomCodeBadge: HTMLElement;
  private hotspotUrlText: HTMLElement;
  private hostControlsBox: HTMLElement;
  private rosterCountLabel: HTMLElement;
  private rosterList: HTMLElement;
  private chatBox: HTMLElement;
  private chatInput: HTMLInputElement;
  private fileListBox: HTMLElement;
  private shareFileBtn: HTMLButtonElement;
  private shareFileInput: HTMLInputElement;
  private launchBtn: HTMLButtonElement;

  public config: LobbyConfig = {
    playerName: 'Kaito_01',
    characterId: 'kaito',
    carColor: '#ff5500',
    gearbox: GearboxType.AUTO,
    mode: 'OPEN_WORLD',
    laps: 3,
    room: null
  };

  public onCharacterPreview: (charId: CharacterId) => void = () => {};
  public onColorPreview: (color: string) => void = () => {};
  public onGearboxChange: (gb: GearboxType) => void = () => {};
  public onLaunchSession: (config: LobbyConfig) => void = () => {};
  /** Lets the host pause gameplay and block hotkeys while the lobby is open. */
  public onVisibilityChange: (visible: boolean) => void = () => {};
  /** In-app replacement for blocking native alert() dialogs. */
  public onErrorToast: (message: string) => void = () => {};

  private hostIpText: HTMLElement;
  private lanTargetRow: HTMLElement | null;
  private lanHostInput: HTMLInputElement | null;
  private lanHelpText: HTMLElement | null;
  private apkBtn: HTMLButtonElement;
  private offlineStatusBtn: HTMLButtonElement;
  private offlineDownloading = false;
  private installBtn: HTMLButtonElement;

  constructor(public client: LobbyClient) {
    this.overlay = document.getElementById('lobby-overlay')!;
    this.homeView = document.getElementById('lobby-home-view')!;
    this.roomView = document.getElementById('lobby-room-view')!;
    this.statusBadge = document.getElementById('lan-status-badge')!;

    this.nameInput = document.getElementById('input-player-name') as HTMLInputElement;
    this.codeInput = document.getElementById('input-room-code') as HTMLInputElement;
    this.roomListBox = document.getElementById('room-list-box')!;
    this.globalBoard = document.getElementById('global-leaderboard')!;

    this.qrCanvas = document.getElementById('lobby-qr-canvas') as HTMLCanvasElement;
    this.roomTitleText = document.getElementById('room-title-text')!;
    this.roomCodeBadge = document.getElementById('room-code-badge')!;
    this.hotspotUrlText = document.getElementById('hotspot-url-text')!;
    this.hostIpText = document.getElementById('host-ip-text')!;
    this.lanTargetRow = document.getElementById('lan-target-row');
    this.lanHostInput = document.getElementById('input-lan-host') as HTMLInputElement | null;
    this.lanHelpText = document.getElementById('lan-help-text');
    this.hostControlsBox = document.getElementById('host-controls-box')!;
    this.rosterCountLabel = document.getElementById('roster-count-label')!;
    this.rosterList = document.getElementById('roster-list')!;
    this.chatBox = document.getElementById('lobby-chat-box')!;
    this.chatInput = document.getElementById('input-chat') as HTMLInputElement;
    this.fileListBox = document.getElementById('room-file-list')!;
    this.shareFileBtn = document.getElementById('btn-share-file') as HTMLButtonElement;
    this.shareFileInput = document.getElementById('input-share-file') as HTMLInputElement;
    this.launchBtn = document.getElementById('btn-launch-room') as HTMLButtonElement;
    this.apkBtn = document.getElementById('btn-download-apk') as HTMLButtonElement;
    this.offlineStatusBtn = document.getElementById('btn-offline-status') as HTMLButtonElement;
    this.installBtn = document.getElementById('btn-install-app') as HTMLButtonElement;

    this.bindEvents();
    this.bindNetworkCallbacks();
    this.syncNetworkModeUI();
    this.checkUrlRoomParam();
    this.applyCapabilityGates();
    this.updateOfflineStatus();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => this.updateOfflineStatus());
    }
  }

  private applyCapabilityGates(): void {
    // Bluetooth: only show if supported (none implemented yet -> keep hidden).
    // APK download: only show if a URL is configured.
    const apkUrl = (window as unknown as { __APK_URL__?: string }).__APK_URL__ || '';
    if (apkUrl) {
      this.apkBtn.style.display = 'inline-flex';
      this.apkBtn.addEventListener('click', () => window.open(apkUrl, '_blank'));
    } else {
      this.apkBtn.style.display = 'none';
    }

    // Install button is toggled by beforeinstallprompt in main.ts; hide by default.
    this.installBtn.style.display = 'none';

    // Capability: Bluetooth (not implemented) -> ensure no dangling button.
  }

  private updateOfflineStatus(): void {
    const el = this.offlineStatusBtn;
    if (this.offlineDownloading) return;
    if (!('serviceWorker' in navigator) || typeof caches === 'undefined') {
      el.textContent = 'Offline Pack: unsupported';
      el.disabled = true;
      el.style.opacity = '0.55';
      return;
    }
    el.disabled = false;
    void checkOfflinePackStatus().then((status) => {
      if (status.ready) {
        el.textContent = `Offline Pack Ready (${status.cachedCount}/${status.totalCount})`;
        el.classList.add('selected');
        el.style.opacity = '1';
      } else if (!status.swActive) {
        el.textContent = `Download Offline Pack (${status.cachedCount}/${status.totalCount})`;
        el.classList.remove('selected');
        el.style.opacity = '0.9';
      } else {
        el.textContent = `Download Offline Pack (${status.cachedCount}/${status.totalCount})`;
        el.classList.remove('selected');
        el.style.opacity = '0.95';
      }
    }).catch(() => {
      el.textContent = 'Offline Pack: check failed';
      el.style.opacity = '0.6';
    });
  }

  private syncNetworkModeUI(): void {
    const mode = this.client.networkMode;
    document.querySelectorAll('.netmode-options .option-btn').forEach((b) => {
      b.classList.toggle('selected', b.getAttribute('data-netmode') === mode);
    });
    if (this.lanTargetRow) {
      this.lanTargetRow.style.display = mode === 'LAN' ? 'flex' : 'none';
    }
    if (this.lanHelpText) {
      if (mode === 'OFFLINE') {
        this.lanHelpText.textContent = 'Offline Solo mode — zero network connections, full world & AI bots.';
      } else if (mode === 'ONLINE') {
        this.lanHelpText.textContent = 'Online public multiplayer — share Room Code or URL with players anywhere.';
      } else {
        this.lanHelpText.textContent = 'Local Wi-Fi / Android Hotspot LAN — connect devices on the same network or enter Host IP:Port.';
      }
    }
  }

  public setVisible(visible: boolean): void {
    this.overlay.classList.toggle('hidden', !visible);
    if (visible) {
      this.overlay.querySelector<HTMLElement>('button, input')?.focus();
      void this.refreshGlobalBoard();
    }
    this.onVisibilityChange(visible);
  }

  private async refreshGlobalBoard(): Promise<void> {
    this.globalBoard.replaceChildren();
    try {
      const res = await fetch(`${location.origin}/api/leaderboard`, { cache: 'no-store' });
      if (!res.ok) throw new Error('unavailable');
      const data = (await res.json()) as { entries?: { name: string; score: number }[] };
      const entries = Array.isArray(data?.entries) ? data.entries.slice(0, 5) : [];
      if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.style.cssText = 'color:#64748b;';
        empty.textContent = 'No scores yet. Finish a race to set a record.';
        this.globalBoard.appendChild(empty);
        return;
      }
      entries.forEach((entry, index) => {
        const row = document.createElement('div');
        row.className = 'board-row';
        const who = document.createElement('span');
        who.className = 'board-rank';
        who.textContent = `#${index + 1} ${entry.name}`;
        const score = document.createElement('span');
        score.className = 'board-score';
        score.textContent = String(entry.score);
        row.append(who, score);
        this.globalBoard.appendChild(row);
      });
    } catch {
      const empty = document.createElement('div');
      empty.style.cssText = 'color:#64748b;';
      empty.textContent = 'Leaderboard unavailable offline.';
      this.globalBoard.replaceChildren(empty);
    }
  }

  private checkUrlRoomParam(): void {
    const params = new URLSearchParams(location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      this.codeInput.value = roomParam;
    }
  }

  private bindEvents(): void {
    document.getElementById('btn-close-lobby')?.addEventListener('click', () => {
      this.setVisible(false);
    });

    // Connection mode tabs (Offline / Local LAN / Online)
    document.querySelectorAll('.netmode-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-netmode') as NetworkMode;
        const customHost = this.lanHostInput?.value.trim() || '';
        this.client.setNetworkMode(mode, mode === 'LAN' ? customHost : undefined);
        this.syncNetworkModeUI();
      });
    });

    document.getElementById('btn-connect-lan')?.addEventListener('click', () => {
      const host = this.lanHostInput?.value.trim() || '';
      this.client.setNetworkMode('LAN', host);
      this.syncNetworkModeUI();
    });

    this.offlineStatusBtn.addEventListener('click', async () => {
      if (this.offlineDownloading) return;
      this.offlineDownloading = true;
      this.offlineStatusBtn.disabled = true;
      const res = await downloadOfflinePack((p) => {
        const pct = Math.round((p.completed / Math.max(1, p.total)) * 100);
        this.offlineStatusBtn.textContent = `Caching Offline Pack ${pct}% (${p.completed}/${p.total})`;
      });
      this.offlineDownloading = false;
      this.offlineStatusBtn.disabled = false;
      if (!res.ok) {
        this.onErrorToast(res.error || 'Could not cache all offline assets. Check connection or storage space.');
      }
      this.updateOfflineStatus();
    });

    this.nameInput.addEventListener('input', () => {
      this.config.playerName = this.nameInput.value.trim() || 'Racer';
      if (this.client.currentRoom) {
        this.client.updatePlayer({ name: this.config.playerName });
      }
    });

    // Character cards
    document.querySelectorAll('.char-card').forEach((card) => {
      card.addEventListener('click', () => {
        const charId = card.getAttribute('data-char') as CharacterId;
        this.config.characterId = charId;
        document.querySelectorAll('.char-card').forEach(c => {
          const selected = c === card;
          c.classList.toggle('selected', selected);
          c.setAttribute('aria-pressed', String(selected));
        });
        this.onCharacterPreview(charId);
        if (this.client.currentRoom) {
          this.client.updatePlayer({ characterId: charId });
        }
      });
    });

    // Color swatches
    document.querySelectorAll('.color-swatch').forEach((sw) => {
      sw.addEventListener('click', () => {
        const color = sw.getAttribute('data-color')!;
        this.config.carColor = color;
        document.querySelectorAll('.color-swatch').forEach(s => {
          const selected = s.getAttribute('data-color') === color;
          s.classList.toggle('selected', selected);
          s.setAttribute('aria-pressed', String(selected));
        });
        this.onColorPreview(color);
        if (this.client.currentRoom) {
          this.client.updatePlayer({ carColor: color });
        }
      });
    });

    // Gearbox options
    document.querySelectorAll('.gearbox-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const gb = btn.getAttribute('data-gearbox') as GearboxType;
        this.config.gearbox = gb;
        document.querySelectorAll('.gearbox-options .option-btn').forEach(b => {
          b.classList.toggle('selected', b.getAttribute('data-gearbox') === gb);
        });
        this.onGearboxChange(gb);
        if (this.client.currentRoom) {
          this.client.updatePlayer({ gearbox: gb });
        }
      });
    });

    // Host Multiplayer Room
    document.getElementById('btn-host-room')!.addEventListener('click', () => {
      this.config.playerName = this.nameInput.value.trim() || 'Host';
      if (this.client.networkMode === 'OFFLINE') {
        this.onErrorToast('Switch Connection Mode to Local LAN or Online to host multiplayer, or use Quick Solo.');
        return;
      }
      if (!this.client.isConnected) {
        this.onErrorToast('Server not connected yet. Check your LAN IP:Port / network and retry.');
        return;
      }
      this.client.createRoom({
        playerName: this.config.playerName,
        roomName: `${this.config.playerName}'s Room`,
        characterId: this.config.characterId,
        carColor: this.config.carColor,
        gearbox: this.config.gearbox,
        mode: this.config.mode,
        laps: this.config.laps
      });
    });

    // Quick Solo / Bots
    document.getElementById('btn-solo-play')!.addEventListener('click', () => {
      this.config.playerName = this.nameInput.value.trim() || 'Racer';
      this.config.room = null;
      this.setVisible(false);
      this.onLaunchSession(this.config);
    });

    // Join by 4-digit Code
    document.getElementById('btn-join-code')!.addEventListener('click', () => {
      const code = this.codeInput.value.trim();
      if (!code) return;
      this.joinByCode(code);
    });

    // Leave Room
    document.getElementById('btn-leave-room')!.addEventListener('click', () => {
      this.client.leaveRoom();
    });

    // Copy Hotspot Link
    document.getElementById('btn-copy-link')!.addEventListener('click', async () => {
      const url = this.hotspotUrlText.textContent || location.href;
      try {
        await navigator.clipboard.writeText(url);
        const btn = document.getElementById('btn-copy-link')!;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy Hotspot Link'; }, 1500);
      } catch {}
    });

    // Host Mode Selector
    document.querySelectorAll('.mode-options .option-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.getAttribute('data-mode') as GameModeId;
        this.config.mode = mode;
        this.config.laps = mode === 'CIRCUIT_RACE' ? 3 : 0;
        document.querySelectorAll('.mode-options .option-btn').forEach(b => {
          b.classList.toggle('selected', b.getAttribute('data-mode') === mode);
        });
        this.client.updateRoom({ mode, laps: this.config.laps });
      });
    });

    // Add Race Bot
    document.getElementById('btn-add-bot')!.addEventListener('click', () => {
      const diff = (document.getElementById('select-bot-diff') as HTMLSelectElement).value as BotDifficulty;
      this.client.addBot(diff);
    });

    // Lobby Chat
    const sendChat = () => {
      const txt = this.chatInput.value.trim();
      if (!txt) return;
      this.client.sendChat(txt);
      this.chatInput.value = '';
    };
    document.getElementById('btn-send-chat')!.addEventListener('click', sendChat);
    this.chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') sendChat();
    });

    this.shareFileBtn.addEventListener('click', () => this.shareFileInput.click());
    this.shareFileInput.addEventListener('change', () => {
      const file = this.shareFileInput.files?.[0];
      this.shareFileInput.value = '';
      if (file) void this.uploadSharedFile(file);
    });

    // Launch / Ready button
    this.launchBtn.addEventListener('click', () => {
      const room = this.client.currentRoom;
      if (!room) return;
      const me = room.players.find(p => p.id === this.client.clientId);
      if (!me) return;
      if (me.isHost) {
        this.client.startGame();
      } else {
        this.client.updatePlayer({ ready: !me.ready });
      }
    });
  }

  private joinByCode(code: string): void {
    if (this.client.networkMode === 'OFFLINE') {
      this.onErrorToast('Switch Connection Mode to Local LAN or Online to join a room.');
      return;
    }
    if (!this.client.isConnected) {
      this.onErrorToast('Not connected to multiplayer host yet. Check connection and retry.');
      return;
    }
    this.config.playerName = this.nameInput.value.trim() || 'Racer';
    this.client.joinRoom({
      code,
      playerName: this.config.playerName,
      characterId: this.config.characterId,
      carColor: this.config.carColor,
      gearbox: this.config.gearbox
    });
  }

  private bindNetworkCallbacks(): void {
    const refreshBadge = () => {
      const state = this.client.connectionState;
      const mode = this.client.networkMode;
      if (state === 'CONNECTED') {
        if (mode === 'ONLINE' || this.client.lanInfo?.mode === 'ONLINE') {
          this.statusBadge.textContent = 'ONLINE LOBBY READY';
        } else {
          const ipText = this.client.lanInfo?.ips?.[0] || location.hostname;
          this.statusBadge.textContent = `LAN READY (${ipText})`;
        }
        this.statusBadge.classList.remove('offline');
      } else if (state === 'RECONNECTING') {
        this.statusBadge.textContent = 'RECONNECTING...';
        this.statusBadge.classList.add('offline');
      } else if (state === 'CONNECTING') {
        this.statusBadge.textContent = 'CONNECTING...';
        this.statusBadge.classList.add('offline');
      } else if (state === 'ERROR') {
        this.statusBadge.textContent = `${mode} UNREACHABLE`;
        this.statusBadge.classList.add('offline');
      } else {
        this.statusBadge.textContent = 'OFFLINE SOLO MODE';
        this.statusBadge.classList.add('offline');
      }
      this.syncNetworkModeUI();
    };

    this.client.onStatusChange = () => refreshBadge();
    this.client.onConnectionChange = (connected) => {
      refreshBadge();
      if (connected) {
        const roomParam = new URLSearchParams(location.search).get('room');
        if (roomParam && !this.client.currentRoom) {
          this.joinByCode(roomParam);
        }
      }
    };
    refreshBadge();

    this.client.onRoomList = (rooms) => {
      this.renderRoomList(rooms);
    };

    this.client.onRoomState = (room) => {
      this.config.room = room;
      if (!room) {
        this.homeView.style.display = 'flex';
        this.roomView.style.display = 'none';
        this.chatBox.innerHTML = '';
        this.fileListBox.replaceChildren();
        return;
      }
      this.homeView.style.display = 'none';
      this.roomView.style.display = 'flex';
      this.renderRoomView(room);
      void this.refreshRoomFiles();
    };

    this.client.onChatMessage = (sender, text, isSystem) => {
      const line = document.createElement('div');
      if (isSystem) {
        line.style.color = '#38bdf8';
        line.textContent = `* ${text}`;
      } else {
        // Peer names arrive over the LAN and must stay literal text.
        const who = document.createElement('strong');
        who.style.color = '#facc15';
        who.textContent = `${sender}: `;
        line.append(who, document.createTextNode(text));
      }
      this.chatBox.appendChild(line);
      this.chatBox.scrollTop = this.chatBox.scrollHeight;
    };

    this.client.onGameStart = (room) => {
      this.config.room = room;
      this.config.mode = room.mode;
      this.config.laps = room.laps;
      this.setVisible(false);
      this.onLaunchSession(this.config);
    };

    this.client.onError = (msg) => {
      this.onErrorToast(msg);
    };

    this.client.onFileList = (files) => {
      this.renderRoomFiles(files);
    };

    this.client.onFileShare = () => {
      void this.refreshRoomFiles();
    };
  }

  private async uploadSharedFile(file: File): Promise<void> {
    try {
      const info = await this.client.uploadFile(file);
      this.onErrorToast(`Shared "${info.name}" with the room.`);
    } catch (err) {
      this.onErrorToast(err instanceof Error ? err.message : 'File sharing failed.');
    }
  }

  private async refreshRoomFiles(): Promise<void> {
    const files = await this.client.fetchRoomFiles();
    this.renderRoomFiles(files);
  }

  private renderRoomFiles(files: SharedFileInfo[]): void {
    this.fileListBox.replaceChildren();
    if (!this.client.currentRoom) return;
    if (files.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:10px;color:#64748b;padding:2px;';
      empty.textContent = 'No shared files yet.';
      this.fileListBox.appendChild(empty);
      return;
    }
    for (const f of files) {
      const row = document.createElement('div');
      row.className = 'room-file-item';
      const link = document.createElement('a');
      link.href = '#';
      link.textContent = `⬇ ${f.name}`;
      link.title = `Download ${f.name}`;
      link.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
          const { blob, name } = await this.client.downloadFile(f.id);
          const url = URL.createObjectURL(blob);
          const temp = document.createElement('a');
          temp.href = url;
          temp.download = name;
          temp.click();
          window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
        } catch (err) {
          this.onErrorToast(err instanceof Error ? err.message : 'Download failed.');
        }
      });
      const meta = document.createElement('span');
      meta.className = 'file-meta';
      meta.textContent = `${f.ownerName} · ${this.formatFileSize(f.size)}`;
      row.append(link, meta);
      this.fileListBox.appendChild(row);
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private renderRoomList(rooms: RoomSummary[]): void {
    // Room names/codes arrive over LAN: build text nodes, never parse HTML.
    this.roomListBox.replaceChildren();
    if (rooms.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'font-size:11px;color:#94a3b8;text-align:center;padding:8px;';
      empty.textContent = 'No active hotspot rooms yet. Tap "Host Hotspot Room" to create one!';
      this.roomListBox.appendChild(empty);
      return;
    }

    for (const r of rooms) {
      const item = document.createElement('div');
      item.className = 'room-item';
      const info = document.createElement('div');
      const name = document.createElement('div');
      name.style.cssText = 'font-weight:800;color:#f8fafc;';
      name.append(document.createTextNode(`${r.name} `));
      const code = document.createElement('span');
      code.style.color = '#ff5500';
      code.textContent = `#${r.code}`;
      name.appendChild(code);
      const meta = document.createElement('div');
      meta.style.cssText = 'font-size:11px;color:#cbd5e1;';
      meta.textContent = `${r.mode.replace('_', ' ')} • ${r.playerCount} Players, ${r.botCount} Bots`;
      info.append(name, meta);

      const joinBtn = document.createElement('button');
      joinBtn.className = 'room-join-btn';
      joinBtn.textContent = 'JOIN';
      joinBtn.addEventListener('click', () => this.joinByCode(r.code));
      item.append(info, joinBtn);
      this.roomListBox.appendChild(item);
    }
  }

  private async renderRoomView(room: RoomState): Promise<void> {
    this.roomTitleText.textContent = room.name;
    this.roomCodeBadge.textContent = `#${room.code}`;
    const shareUrl = await this.client.renderHotspotQR(this.qrCanvas, room.code);
    this.hotspotUrlText.textContent = shareUrl;
    if (this.client.networkMode === 'ONLINE' || this.client.lanInfo?.mode === 'ONLINE') {
      this.hostIpText.textContent = `Online Public Lobby • Code #${room.code}`;
    } else {
      const ip = this.client.lanInfo?.ips?.[0] || location.hostname;
      this.hostIpText.textContent = `LAN Host: ${ip}:${this.client.lanInfo?.port ?? (location.port || 80)} (Same Wi-Fi / Hotspot required)`;
    }

    const me = room.players.find(p => p.id === this.client.clientId);
    const isHost = !!me?.isHost;

    this.hostControlsBox.style.display = isHost ? 'block' : 'none';
    document.querySelectorAll('.mode-options .option-btn').forEach(b => {
      b.classList.toggle('selected', b.getAttribute('data-mode') === room.mode);
    });

    this.rosterCountLabel.textContent = `Players & Bots (${room.players.length}/${room.maxPlayers})`;
    this.rosterList.innerHTML = '';

    for (const p of room.players) {
      const row = document.createElement('div');
      row.className = `roster-slot${p.isBot ? ' bot' : ''}${p.id === this.client.clientId ? ' me' : ''}`;

      const identity = document.createElement('div');
      identity.style.cssText = 'display:flex;align-items:center;gap:8px;';
      const swatch = document.createElement('span');
      swatch.style.cssText = 'width:12px;height:12px;border-radius:3px;display:inline-block;';
      // Peer-supplied colour must be a plain hex value, never injected CSS.
      swatch.style.background = /^#[0-9a-f]{3,8}$/i.test(p.carColor) ? p.carColor : '#64748b';
      const name = document.createElement('span');
      name.style.fontWeight = '800';
      name.textContent = p.name;
      const character = document.createElement('span');
      character.style.cssText = 'font-size:11px;color:#cbd5e1;text-transform:uppercase;';
      character.textContent = p.characterId;
      identity.append(swatch, name, character);

      const status = document.createElement('div');
      status.style.cssText = 'display:flex;align-items:center;gap:6px;';
      const badge = document.createElement('span');
      if (p.isHost) {
        badge.className = 'badge-tag';
        badge.style.cssText = 'background:rgba(255,85,0,0.3);color:#fdba74;';
        badge.textContent = 'HOST';
      } else if (p.isBot) {
        badge.className = 'badge-tag badge-bot';
        badge.textContent = `BOT • ${p.botDifficulty || 'PRO'}`;
      } else {
        badge.className = `badge-tag${p.ready ? ' badge-ready' : ''}`;
        badge.textContent = p.ready ? 'READY' : 'WAITING';
      }
      status.appendChild(badge);

      if (isHost && p.isBot) {
        const rmBtn = document.createElement('button');
        rmBtn.className = 'roster-remove-btn';
        rmBtn.type = 'button';
        rmBtn.setAttribute('aria-label', `Remove bot ${p.name}`);
        rmBtn.textContent = '×';
        rmBtn.addEventListener('click', () => this.client.removeBot(p.id));
        status.appendChild(rmBtn);
      }

      row.append(identity, status);
      this.rosterList.appendChild(row);
    }

    if (isHost) {
      this.launchBtn.textContent = 'Launch World & Race!';
      this.launchBtn.style.background = 'linear-gradient(135deg, #ff5500, #ea580c)';
    } else {
      this.launchBtn.textContent = me?.ready ? 'Ready! (Tap to Cancel)' : 'Ready Up!';
      this.launchBtn.style.background = me?.ready
        ? 'linear-gradient(135deg, #16a34a, #15803d)'
        : 'linear-gradient(135deg, #2563eb, #1d4ed8)';
    }
  }
}
