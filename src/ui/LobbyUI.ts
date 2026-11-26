import { LobbyClient } from '../network/LobbyClient';
import type {
  BotDifficulty,
  CharacterId,
  GameModeId,
  RoomState,
  RoomSummary
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

  private qrCanvas: HTMLCanvasElement;
  private roomTitleText: HTMLElement;
  private roomCodeBadge: HTMLElement;
  private hotspotUrlText: HTMLElement;
  private hostControlsBox: HTMLElement;
  private rosterCountLabel: HTMLElement;
  private rosterList: HTMLElement;
  private chatBox: HTMLElement;
  private chatInput: HTMLInputElement;
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
  private apkBtn: HTMLButtonElement;
  private offlineStatusBtn: HTMLButtonElement;
  private installBtn: HTMLButtonElement;

  constructor(public client: LobbyClient) {
    this.overlay = document.getElementById('lobby-overlay')!;
    this.homeView = document.getElementById('lobby-home-view')!;
    this.roomView = document.getElementById('lobby-room-view')!;
    this.statusBadge = document.getElementById('lan-status-badge')!;

    this.nameInput = document.getElementById('input-player-name') as HTMLInputElement;
    this.codeInput = document.getElementById('input-room-code') as HTMLInputElement;
    this.roomListBox = document.getElementById('room-list-box')!;

    this.qrCanvas = document.getElementById('lobby-qr-canvas') as HTMLCanvasElement;
    this.roomTitleText = document.getElementById('room-title-text')!;
    this.roomCodeBadge = document.getElementById('room-code-badge')!;
    this.hotspotUrlText = document.getElementById('hotspot-url-text')!;
    this.hostIpText = document.getElementById('host-ip-text')!;
    this.hostControlsBox = document.getElementById('host-controls-box')!;
    this.rosterCountLabel = document.getElementById('roster-count-label')!;
    this.rosterList = document.getElementById('roster-list')!;
    this.chatBox = document.getElementById('lobby-chat-box')!;
    this.chatInput = document.getElementById('input-chat') as HTMLInputElement;
    this.launchBtn = document.getElementById('btn-launch-room') as HTMLButtonElement;
    this.apkBtn = document.getElementById('btn-download-apk') as HTMLButtonElement;
    this.offlineStatusBtn = document.getElementById('btn-offline-status') as HTMLButtonElement;
    this.installBtn = document.getElementById('btn-install-app') as HTMLButtonElement;

    this.bindEvents();
    this.bindNetworkCallbacks();
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
    if (!('serviceWorker' in navigator)) {
      el.textContent = 'Offline: unsupported';
      el.style.opacity = '0.5';
      return;
    }
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.active) {
        el.textContent = 'Offline: ready';
        el.style.opacity = '1';
      } else {
        el.textContent = 'Offline: installing…';
        el.style.opacity = '0.7';
      }
    }).catch(() => {
      el.textContent = 'Offline: unavailable';
      el.style.opacity = '0.5';
    });
  }

  public setVisible(visible: boolean): void {
    this.overlay.classList.toggle('hidden', !visible);
    if (visible) this.overlay.querySelector<HTMLElement>('button, input')?.focus();
    this.onVisibilityChange(visible);
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

    // Host Hotspot Room
    document.getElementById('btn-host-room')!.addEventListener('click', () => {
      this.config.playerName = this.nameInput.value.trim() || 'Host';
      if (!this.client.isConnected) {
        alert('Hotspot LAN server is not connected yet. Starting Quick Solo mode or wait 1s and retry.');
        return;
      }
      this.client.createRoom({
        playerName: this.config.playerName,
        roomName: `${this.config.playerName}'s Hotspot`,
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
    this.client.onConnectionChange = (connected) => {
      if (connected) {
        const ipText = this.client.lanInfo?.ips?.[0] || location.hostname;
        this.statusBadge.textContent = `HOTSPOT LAN READY (${ipText})`;
        this.statusBadge.classList.remove('offline');

        // Auto-join if ?room=CODE was passed via QR code!
        const roomParam = new URLSearchParams(location.search).get('room');
        if (roomParam && !this.client.currentRoom) {
          this.joinByCode(roomParam);
        }
      } else {
        this.statusBadge.textContent = 'SOLO OFFLINE MODE';
        this.statusBadge.classList.add('offline');
      }
    };

    this.client.onRoomList = (rooms) => {
      this.renderRoomList(rooms);
    };

    this.client.onRoomState = (room) => {
      this.config.room = room;
      if (!room) {
        this.homeView.style.display = 'flex';
        this.roomView.style.display = 'none';
        this.chatBox.innerHTML = '';
        return;
      }
      this.homeView.style.display = 'none';
      this.roomView.style.display = 'flex';
      this.renderRoomView(room);
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
    const ip = this.client.lanInfo?.ips?.[0] || location.hostname;
    this.hostIpText.textContent = `Host IP: ${ip} • Port ${this.client.lanInfo?.port ?? (location.port || 80)}`;

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
