import { CarPhysics, CarInputs, GearboxType } from '../physics/CarPhysics';
import type { CharacterInputs } from '../physics/CharacterController';
import { LapManager } from '../game/LapManager';
import { TrackEnvironment } from '../graphics/TrackEnvironment';
import { FloatingJoystick } from './FloatingJoystick';

export type TouchMode = 'AUTO' | 'ON' | 'OFF';

export interface MinimapActor {
  x: number;
  z: number;
  color: string;
  /** Optional shape: 'dot' (default), 'diamond' (shards), 'square' (traps), 'ring' (rivals/portals) */
  shape?: 'dot' | 'diamond' | 'square' | 'ring';
  size?: number;
}

export class HUD {
  private hudOverlay: HTMLElement;
  private mobileControls: HTMLElement;
  private footControls: HTMLElement;
  private bottomHudWrap: HTMLElement;
  private manualTouchBox: HTMLElement;
  private touchClutchBtn: HTMLElement;
  private footDriveBtn: HTMLElement;
  private footInteractBtn: HTMLButtonElement;
  private useLabel = 'USE';
  private enterExitBtn: HTMLElement;
  private enterExitLabel: HTMLElement;
  private racePromptEl: HTMLElement;
  private moreDrawer: HTMLElement;
  private joystick: FloatingJoystick;

  private chatPanel: HTMLElement;
  private chatLog: HTMLElement;
  private chatInput: HTMLInputElement;

  private tachCanvas: HTMLCanvasElement;
  private tachCtx: CanvasRenderingContext2D;
  private mapCanvas: HTMLCanvasElement;
  private mapCtx: CanvasRenderingContext2D;

  private lapNumEl: HTMLElement;
  private lapTimeEl: HTMLElement;
  private bestTimeEl: HTMLElement;
  private posEl: HTMLElement;
  private hpEl: HTMLElement;
  private driftPillEl: HTMLElement;

  private rankTitleEl: HTMLElement;
  private rankLvEl: HTMLElement;
  private xpEl: HTMLElement;
  private xpFillEl: HTMLElement;
  private creditsEl: HTMLElement;

  private wantedEl: HTMLElement;
  private wantedStars: HTMLElement[] = [];
  private lastWanted = -1;
  private districtEl: HTMLElement | null;
  private lastDistrict = '';
  private bustedMeterEl: HTMLElement | null;
  private bustedMeterFill: HTMLElement | null;
  private stealPromptEl: HTMLElement;
  private stealPromptName: HTMLElement;
  private koOverlay: HTMLElement;
  private koTitle: HTMLElement;
  private koDesc: HTMLElement;

  private barGas: HTMLElement;
  private barBrake: HTMLElement;
  private barNitro: HTMLElement | null;
  private barClutch: HTMLElement;
  private clutchWrap: HTMLElement;

  private noticeEl: HTMLElement;
  private noticeTitle: HTMLElement;
  private noticeDesc: HTMLElement;
  private noticeTimer = 0;
  private noticeExpiresAt = 0;
  private toastLayer: HTMLElement | null = null;

  public inputs: CarInputs = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    clutch: false,
    shiftUp: false,
    shiftDown: false,
    reset: false,
    nitro: false
  };

  public charInputs: CharacterInputs = {
    moveX: 0,
    moveY: 0,
    sprint: false,
    jump: false,
    punch: false,
    interact: false
  };

  private keysDown: Set<string> = new Set();
  private touchSteerLeft = false;
  private touchSteerRight = false;
  private touchGas = false;
  private touchBrake = false;
  private touchHandbrake = false;
  private touchNitro = false;
  private touchClutch = false;
  private touchShiftUp = false;
  private touchShiftDown = false;

  // On-foot touch state (analog joystick + jump/punch)
  private footJump = false;
  private footPunch = false;
  private footInteract = false;

  private keyShiftUp = false;
  private keyShiftDown = false;
  private keyReset = false;

  public touchMode: TouchMode = 'AUTO';
  private isTouchDevice: boolean;
  private isOnFoot = false;
  private isPaused = false;
  private lastCanEnter = false;
  private lastHpShown = -1;
  private lastGearboxShown: GearboxType = GearboxType.AUTO;
  private lastFootAction = '';
  private lastRacePrompt = false;

  public onToggleEnterExit: () => void = () => {};
  public onStartCircuitRace: () => void = () => {};
  public onHorn: () => void = () => {};
  public onSendChat: (text: string) => void = () => {};
  public onSendEmoji: (emoji: string) => void = () => {};

  constructor() {
    this.hudOverlay = document.getElementById('hud-overlay')!;
    this.mobileControls = document.getElementById('mobile-controls')!;
    this.footControls = document.getElementById('foot-controls')!;
    this.bottomHudWrap = document.getElementById('bottom-hud-wrap')!;
    this.manualTouchBox = document.getElementById('manual-touch-box')!;
    this.touchClutchBtn = document.getElementById('touch-clutch')!;
    this.footDriveBtn = document.getElementById('foot-drive')!;
    this.footInteractBtn = document.getElementById('foot-interact') as HTMLButtonElement;
    this.enterExitBtn = document.getElementById('btn-enter-exit')!;
    this.enterExitLabel = document.getElementById('enter-exit-label')!;
    this.racePromptEl = document.getElementById('race-prompt')!;
    this.moreDrawer = document.getElementById('more-drawer')!;
    this.joystick = new FloatingJoystick('foot-joystick-zone');

    this.chatPanel = document.getElementById('ingame-chat-panel')!;
    this.chatLog = document.getElementById('ingame-chat-log')!;
    this.chatInput = document.getElementById('ingame-chat-input') as HTMLInputElement;

    this.tachCanvas = document.getElementById('tachometer-canvas') as HTMLCanvasElement;
    this.tachCtx = this.tachCanvas.getContext('2d')!;

    this.mapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
    this.mapCtx = this.mapCanvas.getContext('2d')!;

    this.lapNumEl = document.getElementById('hud-lap-num')!;
    this.lapTimeEl = document.getElementById('hud-lap-time')!;
    this.bestTimeEl = document.getElementById('hud-best-time')!;
    this.posEl = document.getElementById('hud-pos')!;
    this.hpEl = document.getElementById('hud-hp')!;
    this.driftPillEl = document.getElementById('drift-pill')!;

    this.rankTitleEl = document.getElementById('hud-rank-title')!;
    this.rankLvEl = document.getElementById('hud-rank-lv')!;
    this.xpEl = document.getElementById('hud-xp')!;
    this.xpFillEl = document.getElementById('hud-xp-fill')!;
    this.creditsEl = document.getElementById('hud-credits')!;

    this.wantedEl = document.getElementById('wanted-hud')!;
    this.wantedStars = Array.from(document.querySelectorAll('#wanted-hud .wanted-star')) as HTMLElement[];
    this.districtEl = document.getElementById('hud-district');
    this.bustedMeterEl = document.getElementById('busted-meter');
    this.bustedMeterFill = document.getElementById('busted-meter-fill');
    this.stealPromptEl = document.getElementById('steal-prompt')!;
    this.stealPromptName = document.getElementById('steal-prompt-name')!;
    this.koOverlay = document.getElementById('ko-overlay')!;
    this.koTitle = document.getElementById('ko-title')!;
    this.koDesc = document.getElementById('ko-desc')!;

    this.barGas = document.getElementById('bar-gas')!;
    this.barBrake = document.getElementById('bar-brake')!;
    this.barNitro = document.getElementById('bar-nitro');
    this.barClutch = document.getElementById('bar-clutch')!;
    this.clutchWrap = document.getElementById('clutch-bar-wrap')!;

    this.noticeEl = document.getElementById('center-notice')!;
    this.noticeTitle = document.getElementById('notice-title')!;
    this.noticeDesc = document.getElementById('notice-desc')!;
    this.toastLayer = document.getElementById('toast-layer');

    this.isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

    // Immediately detect touch on any touch event
    window.addEventListener('touchstart', () => {
      if (!this.isTouchDevice) {
        this.isTouchDevice = true;
        this.updateTouchVisibility(this.lastGearboxShown);
      }
    }, { passive: true });

    // Prevent stuck keys/touch buttons on tab switch, blur, or OS gesture interruption
    window.addEventListener('blur', () => this.clearAllInputs());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.clearAllInputs();
      // The main loop skips frames while hidden, so expire hero notices by
      // wall clock on return instead of leaving a stale title on screen.
      if (!document.hidden && this.noticeTimer > 0 && performance.now() >= this.noticeExpiresAt) {
        this.noticeTimer = 0;
        this.noticeEl.classList.remove('show');
      }
    });

    this.setupKeyboardListeners();
    this.setupTouchListeners();
    this.setupSocialListeners();
  }

  public setPaused(paused: boolean): void {
    if (this.isPaused === paused) return;
    this.isPaused = paused;
    if (paused) this.clearAllInputs();
  }

  public clearAllInputs(): void {
    this.keysDown.clear();
    this.touchSteerLeft = false;
    this.touchSteerRight = false;
    this.touchGas = false;
    this.touchBrake = false;
    this.touchHandbrake = false;
    this.touchNitro = false;
    this.touchClutch = false;
    this.touchShiftUp = false;
    this.touchShiftDown = false;
    this.footJump = false;
    this.footPunch = false;
    this.footInteract = false;
    this.keyShiftUp = false;
    this.keyShiftDown = false;
    this.keyReset = false;
    this.joystick.forceReset();
    document.querySelectorAll('.touch-btn.pressed').forEach((el) => el.classList.remove('pressed'));
  }

  public setDistrict(name: string, accentColor = '#38bdf8'): void {
    if (!this.districtEl || name === this.lastDistrict) return;
    this.lastDistrict = name;
    this.districtEl.textContent = name.toUpperCase();
    this.districtEl.style.borderColor = accentColor;
  }

  public setBustedProgress(pct: number): void {
    if (!this.bustedMeterEl || !this.bustedMeterFill) return;
    const clamped = Math.max(0, Math.min(1, pct));
    this.bustedMeterEl.style.display = clamped > 0.01 ? 'flex' : 'none';
    this.bustedMeterFill.style.width = `${Math.round(clamped * 100)}%`;
  }

  public isTypingChat(): boolean {
    // Only the in-game chat field should suppress driving. Lobby inputs are
    // unrelated to gameplay and may stay focused after a panel is hidden.
    return document.activeElement === this.chatInput;
  }

  public setVisible(visible: boolean, gearbox: GearboxType): void {
    this.lastGearboxShown = gearbox;
    if (visible) {
      this.hudOverlay.classList.remove('hidden');
      this.updateTouchVisibility(gearbox);
    } else {
      this.hudOverlay.classList.add('hidden');
      this.mobileControls.classList.add('hidden');
      this.footControls.classList.add('hidden');
      // A focused hidden input would suppress driving inputs forever.
      this.chatInput?.blur();
    }
  }

  public setRacePrompt(visible: boolean): void {
    if (visible !== this.lastRacePrompt) {
      this.lastRacePrompt = visible;
      this.racePromptEl.style.display = visible ? 'flex' : 'none';
    }
  }

  public setProfile(
    title: string,
    level: number,
    color: string,
    xp: number,
    progress: number,
    credits: number
  ): void {
    this.rankTitleEl.textContent = title;
    this.rankTitleEl.style.color = color;
    this.rankLvEl.textContent = `LV.${level}`;
    this.xpEl.textContent = xp.toLocaleString();
    this.xpFillEl.style.width = `${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%`;
    this.creditsEl.textContent = Math.round(credits).toLocaleString();
  }

  /** 0 = clean, 1..5 = wanted stars. */
  public setWanted(level: number): void {
    const n = Math.max(0, Math.min(5, Math.round(level)));
    if (n === this.lastWanted) return;
    this.lastWanted = n;
    this.wantedEl.style.display = n > 0 ? 'flex' : 'none';
    this.wantedEl.classList.toggle('hot', n >= 4);
    for (let i = 0; i < this.wantedStars.length; i++) {
      this.wantedStars[i].classList.toggle('active', i < n);
    }
  }

  public setStealPrompt(carName: string | null): void {
    if (carName) {
      this.stealPromptName.textContent = carName;
      this.stealPromptEl.style.display = 'flex';
    } else {
      this.stealPromptEl.style.display = 'none';
    }
  }

  public showKoOverlay(title: string, desc: string, accent = '#ef4444'): void {
    this.koTitle.textContent = title;
    this.koTitle.style.color = accent;
    this.koDesc.textContent = desc;
    this.koOverlay.classList.add('open');
  }

  public hideKoOverlay(): void {
    this.koOverlay.classList.remove('open');
  }

  /** Label the context USE button (SIT / STAND / USE) for touch players. */
  public setUseLabel(label: string): void {
    if (label === this.useLabel) return;
    this.useLabel = label;
    this.footInteractBtn.textContent = label;
  }

  public setFootAction(enabled: boolean, label: string): void {
    const key = `${enabled}|${label}`;
    if (key === this.lastFootAction) return;
    this.lastFootAction = key;
    this.enterExitLabel.textContent = label;
    this.enterExitBtn.style.opacity = enabled ? '1' : '0.45';
    this.enterExitBtn.style.background = enabled ? 'rgba(22, 163, 74, 0.92)' : 'rgba(30, 41, 59, 0.8)';
    this.footDriveBtn.style.display = enabled ? 'flex' : 'none';
  }

  public setOnFootMode(onFoot: boolean, canEnterCar: boolean, hp: number, gearbox: GearboxType): void {
    const roundedHp = Math.round(hp);
    const changed = (
      onFoot !== this.isOnFoot ||
      canEnterCar !== this.lastCanEnter ||
      roundedHp !== this.lastHpShown ||
      gearbox !== this.lastGearboxShown
    );
    if (!changed) return;

    if (onFoot !== this.isOnFoot) {
      this.clearAllInputs();
    }
    this.isOnFoot = onFoot;
    this.lastCanEnter = canEnterCar;
    this.lastHpShown = roundedHp;
    this.lastGearboxShown = gearbox;

    this.bottomHudWrap.style.display = onFoot ? 'none' : 'flex';
    this.hpEl.textContent = `${roundedHp}`;
    this.hpEl.style.color = roundedHp > 40 ? '#4ade80' : '#ef4444';

    if (onFoot) {
      this.enterExitLabel.textContent = canEnterCar ? 'Drive Car' : 'Walk to Car';
      this.enterExitBtn.style.opacity = canEnterCar ? '1' : '0.45';
      this.enterExitBtn.style.background = canEnterCar ? 'rgba(22, 163, 74, 0.92)' : 'rgba(30, 41, 59, 0.8)';
      this.footDriveBtn.style.display = canEnterCar ? 'flex' : 'none';
    } else {
      this.enterExitLabel.textContent = 'Exit Car';
      this.enterExitBtn.style.opacity = '1';
      this.enterExitBtn.style.background = 'rgba(255, 85, 0, 0.88)';
      // Force the on-foot action label to refresh next time we step out.
      this.lastFootAction = '';
    }

    this.updateTouchVisibility(gearbox);
  }

  public updateTouchVisibility(gearbox: GearboxType): void {
    this.lastGearboxShown = gearbox;
    const showTouch = this.touchMode === 'ON' || (this.touchMode === 'AUTO' && this.isTouchDevice);
    if (!showTouch || this.hudOverlay.classList.contains('hidden')) {
      this.mobileControls.classList.add('hidden');
      this.footControls.classList.add('hidden');
      return;
    }

    if (this.isOnFoot) {
      this.mobileControls.classList.add('hidden');
      this.footControls.classList.remove('hidden');
    } else {
      this.footControls.classList.add('hidden');
      this.mobileControls.classList.remove('hidden');
      this.manualTouchBox.style.display = gearbox !== GearboxType.AUTO ? 'flex' : 'none';
      this.touchClutchBtn.style.display = gearbox === GearboxType.MANUAL ? 'flex' : 'none';
    }
  }

  public appendChatMessage(sender: string, text: string, isSystem: boolean): void {
    const row = document.createElement('div');
    if (isSystem) {
      row.style.color = '#38bdf8';
      row.textContent = `* ${text}`;
    } else {
      // Network sender names are untrusted: build nodes, never parse HTML.
      const who = document.createElement('strong');
      who.style.color = '#facc15';
      who.textContent = `${sender}: `;
      row.append(who, document.createTextNode(text));
    }
    this.chatLog.appendChild(row);
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  /**
   * Routine feedback goes to a compact root toast portal so it never looks
   * like a login title and never overwrites another message. Race-critical
   * announcements can still opt into the large centred hero notice.
   */
  public showNotification(
    title: string,
    desc: string,
    duration = 2.2,
    opts: { hero?: boolean; kind?: 'notice' | 'collectible' | 'error' } = {}
  ): void {
    if (opts.hero) {
      this.noticeTitle.textContent = title;
      this.noticeDesc.textContent = desc;
      this.noticeEl.classList.add('show');
      this.noticeTimer = duration;
      this.noticeExpiresAt = performance.now() + duration * 1000;
      return;
    }
    this.pushToast(title, desc, opts.kind ?? 'notice', duration);
  }

  /** Dedicated collectible toast: APEX LOG progress + lore at a glance. */
  public showCollectible(found: number, total: number, lore: string): void {
    const layer = this.toastLayer;
    if (!layer) return;
    const toast = this.createToast(`APEX LOG ${found}/${total}`, lore, 'collectible');
    const icon = document.createElement('span');
    icon.className = 'toast-icon';
    icon.textContent = '◆';
    const title = toast.querySelector('.toast-title');
    title?.prepend(icon);
    const progress = document.createElement('div');
    progress.className = 'toast-progress';
    const fill = document.createElement('i');
    fill.style.width = `${Math.round((Math.max(0, found) / Math.max(1, total)) * 100)}%`;
    progress.appendChild(fill);
    toast.appendChild(progress);
    this.mountToast(layer, toast, 3.6);
  }

  /** Modal-local status without blocking gameplay toasts. */
  public showModalStatus(elementId: string, message: string): void {
    const el = document.getElementById(elementId);
    if (el) el.textContent = message;
  }

  private createToast(
    title: string,
    desc: string,
    kind: 'notice' | 'collectible' | 'error'
  ): HTMLElement {
    const toast = document.createElement('div');
    toast.className = `toast toast--${kind}`;
    const titleEl = document.createElement('div');
    titleEl.className = 'toast-title';
    titleEl.textContent = title;
    const descEl = document.createElement('div');
    descEl.className = 'toast-desc';
    descEl.textContent = desc;
    toast.append(titleEl, descEl);
    return toast;
  }

  private pushToast(
    title: string,
    desc: string,
    kind: 'notice' | 'collectible' | 'error',
    duration: number
  ): void {
    const layer = this.toastLayer;
    if (!layer) return;
    this.mountToast(layer, this.createToast(title, desc, kind), duration);
  }

  private mountToast(layer: HTMLElement, toast: HTMLElement, duration: number): void {
    layer.appendChild(toast);
    // Keep the stack readable: drop the oldest toast first.
    while (layer.childElementCount > 4) layer.firstElementChild?.remove();
    window.setTimeout(() => toast.remove(), Math.max(900, duration * 1000));
  }

  private setupSocialListeners(): void {
    this.enterExitBtn.addEventListener('click', () => this.onToggleEnterExit());
    document.getElementById('touch-exit')?.addEventListener('click', () => this.onToggleEnterExit());
    document.getElementById('btn-start-gp-race')?.addEventListener('click', () => this.onStartCircuitRace());
    document.getElementById('btn-horn')?.addEventListener('click', () => this.onHorn());
    document.getElementById('btn-more')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.moreDrawer.classList.toggle('open');
      // Never let the emote strip stick out behind the drawer.
      document.querySelector('.social-bar')?.classList.toggle(
        'drawer-open', this.moreDrawer.classList.contains('open')
      );
    });
    window.addEventListener('click', (e) => {
      if (!this.moreDrawer.contains(e.target as Node) && (e.target as HTMLElement)?.id !== 'btn-more') {
        this.moreDrawer.classList.remove('open');
      }
    });

    document.getElementById('btn-chat-toggle')!.addEventListener('click', () => {
      this.chatPanel.classList.toggle('open');
      if (this.chatPanel.classList.contains('open')) this.chatInput.focus();
    });

    const submitChat = () => {
      const txt = this.chatInput.value.trim();
      if (txt) {
        this.onSendChat(txt);
        this.chatInput.value = '';
      }
      this.chatInput.blur();
    };
    document.getElementById('ingame-chat-send')!.addEventListener('click', submitChat);
    this.chatInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') submitChat();
      if (e.key === 'Escape') {
        this.chatPanel.classList.remove('open');
        this.chatInput.blur();
      }
    });

    document.querySelectorAll('.emoji-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const emoji = btn.getAttribute('data-emoji') || '🔥';
        this.onSendEmoji(emoji);
      });
    });
  }

  private setupKeyboardListeners(): void {
    const emojis = ['🔥', '😂', '💨', '❤️', '👊', '👑'];
    window.addEventListener('keydown', (e) => {
      if (this.isTypingChat() || this.isPaused) return;

      this.keysDown.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
        e.preventDefault();
      }
      // Key repeat must not re-trigger one-shot actions like enter/exit or theft.
      if (e.repeat) return;
      // E is the on-foot interact key; do not latch a gearbox upshift from it.
      if (e.code === 'KeyE' && !this.isOnFoot) this.keyShiftUp = true;
      if (e.code === 'KeyQ') this.keyShiftDown = true;
      if (e.code === 'KeyR') this.keyReset = true;
      if (e.code === 'KeyF' && !this.hudOverlay.classList.contains('hidden')) {
        this.onToggleEnterExit();
      }
      if (e.code === 'KeyG' && this.lastRacePrompt) {
        this.onStartCircuitRace();
      }
      if (e.code === 'KeyH' && !this.hudOverlay.classList.contains('hidden')) {
        this.onHorn();
      }
      if (e.code === 'KeyT' && !this.hudOverlay.classList.contains('hidden')) {
        e.preventDefault();
        this.chatPanel.classList.add('open');
        this.chatInput.focus();
      }
      if (e.code.startsWith('Digit') && !this.hudOverlay.classList.contains('hidden')) {
        const idx = parseInt(e.code.replace('Digit', ''), 10) - 1;
        if (idx >= 0 && idx < emojis.length) this.onSendEmoji(emojis[idx]);
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keysDown.delete(e.code);
      if (e.code === 'KeyE') this.keyShiftUp = false;
      if (e.code === 'KeyQ') this.keyShiftDown = false;
      if (e.code === 'KeyR') this.keyReset = false;
    });
  }

  private setupTouchListeners(): void {
    const bindBtn = (id: string, onPress: () => void, onRelease: () => void) => {
      const el = document.getElementById(id);
      if (!el) return;
      const press = (e: Event) => {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        el.classList.add('pressed');
        onPress();
      };
      const release = (e: Event) => {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        el.classList.remove('pressed');
        onRelease();
      };
      el.addEventListener('touchstart', press, { passive: false });
      el.addEventListener('touchend', release, { passive: false });
      el.addEventListener('touchcancel', release, { passive: false });
      el.addEventListener('mousedown', press);
      el.addEventListener('mouseup', release);
      el.addEventListener('mouseleave', () => release(new Event('mouseleave')));
    };

    bindBtn('touch-left', () => { this.touchSteerLeft = true; }, () => { this.touchSteerLeft = false; });
    bindBtn('touch-right', () => { this.touchSteerRight = true; }, () => { this.touchSteerRight = false; });
    bindBtn('touch-gas', () => { this.touchGas = true; }, () => { this.touchGas = false; });
    bindBtn('touch-brake', () => { this.touchBrake = true; }, () => { this.touchBrake = false; });
    bindBtn('touch-handbrake', () => { this.touchHandbrake = true; }, () => { this.touchHandbrake = false; });
    bindBtn('touch-nitro', () => { this.touchNitro = true; }, () => { this.touchNitro = false; });
    bindBtn('touch-clutch', () => { this.touchClutch = true; }, () => { this.touchClutch = false; });
    bindBtn('touch-shift-up', () => { this.touchShiftUp = true; }, () => { this.touchShiftUp = false; });
    bindBtn('touch-shift-down', () => { this.touchShiftDown = true; }, () => { this.touchShiftDown = false; });

    bindBtn('foot-jump', () => { this.footJump = true; }, () => { this.footJump = false; });
    bindBtn('foot-punch', () => { this.footPunch = true; }, () => { this.footPunch = false; });
    bindBtn('foot-interact', () => { this.footInteract = true; }, () => { this.footInteract = false; });
    this.footDriveBtn.addEventListener('click', () => this.onToggleEnterExit());
  }

  public pollCharacterInputs(): CharacterInputs {
    if (this.isTypingChat()) {
      return { moveX: 0, moveY: 0, sprint: false, jump: false, punch: false, interact: false };
    }
    let mx = this.joystick.value.x;
    let my = this.joystick.value.y;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) mx -= 1;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) mx += 1;
    if (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) my += 1;
    if (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) my -= 1;

    this.charInputs.moveX = Math.max(-1, Math.min(1, mx));
    this.charInputs.moveY = Math.max(-1, Math.min(1, my));
    this.charInputs.sprint = this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight') || this.joystick.value.sprint;
    this.charInputs.jump = this.keysDown.has('Space') || this.footJump;
    this.charInputs.punch = this.keysDown.has('KeyJ') || this.keysDown.has('KeyK') || this.footPunch;
    this.charInputs.interact = this.keysDown.has('KeyE') || this.footInteract;
    return this.charInputs;
  }

  public pollInputs(gearbox: GearboxType): CarInputs {
    if (this.isTypingChat()) {
      return { throttle: 0, brake: 0, steer: 0, handbrake: false, clutch: false, shiftUp: false, shiftDown: false, reset: false, nitro: false };
    }
    let kbThrottle = (this.keysDown.has('KeyW') || this.keysDown.has('ArrowUp')) ? 1.0 : 0;
    let kbBrake = (this.keysDown.has('KeyS') || this.keysDown.has('ArrowDown')) ? 1.0 : 0;
    let kbSteer = 0;
    if (this.keysDown.has('KeyA') || this.keysDown.has('ArrowLeft')) kbSteer -= 1.0;
    if (this.keysDown.has('KeyD') || this.keysDown.has('ArrowRight')) kbSteer += 1.0;

    const kbHandbrake = this.keysDown.has('Space');
    const kbNitro = this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight') || this.keysDown.has('KeyN');
    const kbClutch = this.keysDown.has('KeyC');

    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gpThrottle = 0, gpBrake = 0, gpSteer = 0, gpHandbrake = false, gpNitro = false, gpShiftUp = false, gpShiftDown = false;

    if (gamepads && gamepads[0]) {
      const gp = gamepads[0];
      if (Math.abs(gp.axes[0]) > 0.1) gpSteer = gp.axes[0];
      if (gp.buttons[7]) gpThrottle = gp.buttons[7].value;
      if (gp.buttons[6]) gpBrake = gp.buttons[6].value;
      if (gp.buttons[0] && gp.buttons[0].pressed) gpHandbrake = true;
      if (gp.buttons[1] && gp.buttons[1].pressed) gpNitro = true;
      if (gp.buttons[5] && gp.buttons[5].pressed) gpShiftUp = true;
      if (gp.buttons[4] && gp.buttons[4].pressed) gpShiftDown = true;
    }

    if (this.touchSteerLeft) kbSteer -= 1.0;
    if (this.touchSteerRight) kbSteer += 1.0;

    this.inputs.throttle = Math.max(kbThrottle, gpThrottle, this.touchGas ? 1.0 : 0);
    this.inputs.brake = Math.max(kbBrake, gpBrake, this.touchBrake ? 1.0 : 0);
    this.inputs.steer = Math.max(-1, Math.min(1, kbSteer + gpSteer));
    this.inputs.handbrake = kbHandbrake || gpHandbrake || this.touchHandbrake;
    this.inputs.nitro = kbNitro || gpNitro || this.touchNitro;
    this.inputs.clutch = kbClutch || this.touchClutch;
    this.inputs.shiftUp = this.keyShiftUp || this.touchShiftUp || gpShiftUp;
    this.inputs.shiftDown = this.keyShiftDown || this.touchShiftDown || gpShiftDown;
    this.inputs.reset = this.keyReset;

    if (gearbox === GearboxType.MANUAL) {
      this.clutchWrap.style.display = 'flex';
      this.barClutch.style.width = `${this.inputs.clutch ? 100 : 0}%`;
    } else {
      this.clutchWrap.style.display = 'none';
    }

    this.barGas.style.width = `${Math.round(this.inputs.throttle * 100)}%`;
    this.barBrake.style.width = `${Math.round(this.inputs.brake * 100)}%`;

    return this.inputs;
  }

  public render(
    physics: CarPhysics,
    lapManager: LapManager,
    track: TrackEnvironment,
    dt: number,
    playerPos: { x: number; z: number; yaw: number },
    isTimedRace: boolean,
    racePosText: string,
    extraMarkers: MinimapActor[] = []
  ): void {
    this.keyReset = false;

    if (this.noticeTimer > 0) {
      this.noticeTimer -= dt;
      if (this.noticeTimer <= 0 || performance.now() >= this.noticeExpiresAt) {
        this.noticeTimer = 0;
        this.noticeEl.classList.remove('show');
      }
    }

    const stats = lapManager.stats;
    if (isTimedRace) {
      this.lapNumEl.textContent = `${stats.currentLap} / ${stats.totalLaps}`;
      this.lapTimeEl.textContent = lapManager.formatTime(stats.currentLapTime);
      this.posEl.textContent = racePosText;
    } else {
      this.lapNumEl.textContent = 'ROAM';
      this.lapTimeEl.textContent = '--:--.--';
      this.posEl.textContent = '--';
    }
    this.bestTimeEl.textContent = stats.bestLapTime ? lapManager.formatTime(stats.bestLapTime) : '--:--.--';

    const promptVisible = ['race-prompt', 'rival-prompt', 'courier-prompt', 'steal-prompt']
      .some((id) => {
        const el = document.getElementById(id);
        return !!el && el.style.display !== 'none';
      });
    if (!this.isOnFoot && stats.currentDriftPoints > 5 && !promptVisible) {
      this.driftPillEl.textContent = `DRIFTING +${Math.round(stats.currentDriftPoints)} PTS • ${Math.round(physics.driftAngle)}°`;
      this.driftPillEl.classList.add('active');
    } else {
      this.driftPillEl.classList.remove('active');
    }

    if (!this.isOnFoot) {
      if (this.barNitro) {
        this.barNitro.style.width = `${Math.round(Math.max(0, Math.min(100, physics.nitro)))}%`;
      }
      this.renderTachometer(physics);
    }
    this.renderMinimap(playerPos, track, extraMarkers);
  }

  private renderTachometer(physics: CarPhysics): void {
    const ctx = this.tachCtx;
    const w = this.tachCanvas.width;
    const h = this.tachCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.5;
    const radius = 94;

    ctx.beginPath();
    ctx.arc(cx, cy, radius + 8, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(9, 13, 22, 0.88)';
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
    ctx.stroke();

    const startAngle = Math.PI * 0.75;
    const endAngle = Math.PI * 2.25;
    const totalSweep = endAngle - startAngle;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineCap = 'round';
    ctx.stroke();

    const redlineStart = startAngle + totalSweep * 0.82;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, redlineStart, endAngle);
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.65)';
    ctx.stroke();

    const rpmNorm = Math.min(1.0, Math.max(0, (physics.currentRpm - physics.idleRpm) / (physics.maxRpm - physics.idleRpm)));
    const activeAngle = startAngle + totalSweep * rpmNorm;

    const grad = ctx.createLinearGradient(0, h, w, 0);
    grad.addColorStop(0, '#38bdf8');
    grad.addColorStop(0.65, '#eab308');
    grad.addColorStop(1, '#ef4444');

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, activeAngle);
    ctx.lineWidth = 10;
    ctx.strokeStyle = grad;
    ctx.stroke();

    const nx = cx + Math.cos(activeAngle) * (radius - 13);
    const ny = cy + Math.sin(activeAngle) * (radius - 13);

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = physics.currentRpm >= physics.redlineRpm ? '#ef4444' : '#f8fafc';
    ctx.lineCap = 'round';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, 32, 0, Math.PI * 2);
    ctx.fillStyle = '#090d16';
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.stroke();

    ctx.fillStyle = physics.currentRpm >= physics.redlineRpm ? '#f87171' : '#ffffff';
    ctx.font = 'bold 28px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let gearText = '1';
    if (physics.gear === -1) gearText = 'R';
    else if (physics.gear === 0) gearText = 'N';
    else gearText = `${physics.gear}`;
    ctx.fillText(gearText, cx, cy - 3);

    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 9px sans-serif';
    ctx.fillText(physics.gearboxType, cx, cy + 17);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(`${Math.round(physics.speedKmh)}`, cx, cy + 54);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('KM/H', cx, cy + 69);

    // Bottom arc Nitrous gauge directly inside tachometer so mobile users see Nitro too
    const nNorm = Math.max(0, Math.min(1, physics.nitro / 100));
    const nStart = Math.PI * 0.28;
    const nEnd = Math.PI * 0.72;
    ctx.beginPath();
    ctx.arc(cx, cy, radius - 4, nStart, nEnd);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.stroke();
    if (nNorm > 0.01) {
      ctx.beginPath();
      ctx.arc(cx, cy, radius - 4, nEnd - (nEnd - nStart) * nNorm, nEnd);
      ctx.lineWidth = 4;
      ctx.strokeStyle = physics.isNitroActive ? '#facc15' : '#38bdf8';
      ctx.stroke();
    }
  }

  private renderMinimap(
    playerPos: { x: number; z: number; yaw: number },
    track: TrackEnvironment,
    extraMarkers: MinimapActor[]
  ): void {
    const ctx = this.mapCtx;
    const w = this.mapCanvas.width;
    const h = this.mapCanvas.height;
    ctx.clearRect(0, 0, w, h);

    const mapScale = 0.16;
    const mapOffsetX = w * 0.5 + 10;
    const mapOffsetY = h * 0.5 + 6;
    const toX = (wx: number) => wx * mapScale + mapOffsetX;
    const toY = (wz: number) => wz * mapScale + mapOffsetY;

    // Harbor Ocean Water (south of Harbor Quay)
    ctx.fillStyle = 'rgba(6, 182, 212, 0.22)';
    ctx.fillRect(toX(30), toY(268), 300 * mapScale, 70 * mapScale);

    // Metro City Blocks Footprint
    ctx.fillStyle = 'rgba(148, 163, 184, 0.14)';
    ctx.fillRect(toX(32), toY(-220), 282 * mapScale, 452 * mapScale);

    // Mountain Touge Elevated Deck (z = -340..-252)
    ctx.fillStyle = 'rgba(250, 204, 21, 0.20)';
    ctx.fillRect(toX(38), toY(-340), 234 * mapScale, 88 * mapScale);

    // Harbor Quay & South Stunt Pier
    ctx.fillStyle = 'rgba(148, 163, 184, 0.26)';
    ctx.fillRect(toX(35), toY(231), 282 * mapScale, 38 * mapScale);
    ctx.fillRect(toX(140), toY(265), 56 * mapScale, 34 * mapScale);

    // Stunt Park & Soccer Pitch
    ctx.fillStyle = 'rgba(249, 115, 22, 0.24)';
    ctx.fillRect(toX(56), toY(44), 56 * mapScale, 92 * mapScale);
    ctx.fillStyle = 'rgba(34, 197, 94, 0.36)';
    ctx.fillRect(toX(134), toY(48), 80 * mapScale, 84 * mapScale);

    // City Road Network (Avenues, Streets, GP Connectors, Touge Access)
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.42)';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    for (const ax of [46, 122, 224, 296]) {
      ctx.moveTo(toX(ax), toY(-215));
      ctx.lineTo(toX(ax), toY(232));
    }
    for (const sz of [-160, -40, 30, 150, 224]) {
      const startX = sz <= 30 ? 7 : 38;
      ctx.moveTo(toX(startX), toY(sz));
      ctx.lineTo(toX(312), toY(sz));
    }
    // Touge Switchback Roads
    ctx.moveTo(toX(32), toY(-160));
    ctx.lineTo(toX(32), toY(-296));
    ctx.lineTo(toX(278), toY(-296));
    ctx.lineTo(toX(278), toY(-160));
    ctx.stroke();

    // GP Circuit Loop
    ctx.beginPath();
    for (let i = 0; i < track.trackPoints.length; i++) {
      const pt = track.trackPoints[i];
      const mx = toX(pt.x);
      const my = toY(pt.z);
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    }
    ctx.closePath();
    ctx.lineWidth = 3.8;
    ctx.strokeStyle = '#38bdf8';
    ctx.stroke();

    // Start Gate green dot & Drift Garage orange dot
    ctx.beginPath();
    ctx.arc(toX(0), toY(-4), 4.0, 0, Math.PI * 2);
    ctx.fillStyle = '#22c55e';
    ctx.fill();
    ctx.fillStyle = '#f97316';
    ctx.fillRect(toX(84) - 2.5, toY(15) - 2.5, 5, 5);

    for (const m of extraMarkers) {
      ctx.fillStyle = m.color;
      ctx.strokeStyle = m.color;
      const mx = m.x * mapScale + mapOffsetX;
      const mz = m.z * mapScale + mapOffsetY;
      const sz = m.size ?? 3.2;

      if (m.shape === 'diamond') {
        // Apex shard: yellow diamond
        ctx.beginPath();
        ctx.moveTo(mx, mz - sz * 1.4);
        ctx.lineTo(mx + sz, mz);
        ctx.lineTo(mx, mz + sz * 1.4);
        ctx.lineTo(mx - sz, mz);
        ctx.closePath();
        ctx.fill();
      } else if (m.shape === 'square') {
        // Speed trap: cyan square
        ctx.fillRect(mx - sz, mz - sz, sz * 2, sz * 2);
      } else if (m.shape === 'ring') {
        // Rival sprint portal: open ring
        ctx.beginPath();
        ctx.arc(mx, mz, sz * 1.3, 0, Math.PI * 2);
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        // Default dot
        ctx.beginPath();
        ctx.arc(mx, mz, sz, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const px = playerPos.x * mapScale + mapOffsetX;
    const py = playerPos.z * mapScale + mapOffsetY;

    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(-playerPos.yaw);
    ctx.beginPath();
    ctx.moveTo(0, -6.5);
    ctx.lineTo(4.2, 4.5);
    ctx.lineTo(-4.2, 4.5);
    ctx.closePath();
    ctx.fillStyle = '#ff5500';
    ctx.fill();
    ctx.restore();
  }
}
