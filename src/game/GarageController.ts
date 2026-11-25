import type { CarPhysics } from '../physics/CarPhysics';
import type { CarMesh } from '../graphics/CarMesh';
import type { SaveManager } from './SaveManager';

export interface GarageDeps {
  save: SaveManager;
  getPlayerZenvo: () => { physics: CarPhysics; mesh: CarMesh };
  getActiveMesh: () => CarMesh;
  getHeat: () => number;
  clearHeat: () => void;
  onRefreshProfile: () => void;
  onNotify: (title: string, desc: string, duration?: number) => void;
  onPlayBeep: (freq: number, dur: number) => void;
  onPlaySuccess: () => void;
  onPlayChime: () => void;
  onPlayDoor: () => void;
  onPauseChange: (paused: boolean) => void;
  clearAllInputs: () => void;
}

const ENGINE_COSTS = [500, 1200, 2400];
const NITRO_COSTS = [450, 1000, 2000];
const UNDERGLOW_COST = 350;
const RESPRAY_COST = 400;

const UNDERGLOW_PALETTE = [
  { hex: '#22d3ee', label: 'Cyan' },
  { hex: '#ec4899', label: 'Pink' },
  { hex: '#facc15', label: 'Gold' },
  { hex: '#22c55e', label: 'Neon' },
  { hex: '#ff5500', label: 'Apex' },
  { hex: '#a855f7', label: 'Violet' },
  { hex: 'OFF', label: 'Off' }
];

/** Manages the Drift Garage modal UI, performance upgrades, neon underglow unlocks, and career stats. */
export class GarageController {
  private deps: GarageDeps;
  private modal: HTMLElement;

  constructor(deps: GarageDeps) {
    this.deps = deps;
    this.modal = document.getElementById('garage-modal')!;
    this.bindHandlers();
  }

  public get isOpen(): boolean {
    return this.modal.classList.contains('open');
  }

  public open(): void {
    this.deps.clearAllInputs();
    this.refresh();
    this.modal.classList.add('open');
    this.deps.onPauseChange(true);
  }

  public close(): void {
    this.modal.classList.remove('open');
    this.deps.onPauseChange(false);
  }

  public toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private bindHandlers(): void {
    document.getElementById('btn-garage')?.addEventListener('click', () => {
      document.getElementById('more-drawer')?.classList.remove('open');
      this.open();
    });
    document.getElementById('btn-open-garage-prompt')?.addEventListener('click', () => this.open());
    document.getElementById('garage-close-btn')?.addEventListener('click', () => this.close());
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal) this.close();
    });

    document.getElementById('btn-upgrade-engine')?.addEventListener('click', () => this.upgradeEngine());
    document.getElementById('btn-upgrade-nitro')?.addEventListener('click', () => this.upgradeNitro());
    document.getElementById('btn-garage-clear-heat')?.addEventListener('click', () => this.emergencyRespray());
  }

  private upgradeEngine(): void {
    const { save } = this.deps;
    const st = save.data.engineStage;
    if (st >= 3) return;
    const cost = ENGINE_COSTS[st];
    if (save.data.credits < cost) {
      this.deps.onPlayBeep(200, 0.16);
      this.deps.onNotify('INSUFFICIENT CREDITS', `Need ₡${cost.toLocaleString()} for Engine Stage ${st + 1}`, 1.8);
      return;
    }
    save.spendCredits(cost);
    save.data.engineStage = st + 1;
    save.saveNow();
    this.deps.getPlayerZenvo().physics.applyTuning(save.data.engineStage, save.data.nitroStage);
    this.deps.onPlaySuccess();
    this.deps.onRefreshProfile();
    this.refresh();
    this.deps.onNotify(`ENGINE STAGE ${st + 1}`, `+${(st + 1) * 8}% Supercharger Torque installed!`, 2.0);
  }

  private upgradeNitro(): void {
    const { save } = this.deps;
    const st = save.data.nitroStage;
    if (st >= 3) return;
    const cost = NITRO_COSTS[st];
    if (save.data.credits < cost) {
      this.deps.onPlayBeep(200, 0.16);
      this.deps.onNotify('INSUFFICIENT CREDITS', `Need ₡${cost.toLocaleString()} for Nitro Stage ${st + 1}`, 1.8);
      return;
    }
    save.spendCredits(cost);
    save.data.nitroStage = st + 1;
    save.saveNow();
    this.deps.getPlayerZenvo().physics.applyTuning(save.data.engineStage, save.data.nitroStage);
    this.deps.onPlaySuccess();
    this.deps.onRefreshProfile();
    this.refresh();
    this.deps.onNotify(`NITRO STAGE ${st + 1}`, 'Stronger boost thrust & faster bottle recharge!', 2.0);
  }

  private emergencyRespray(): void {
    const { save } = this.deps;
    if (this.deps.getHeat() <= 0) {
      this.deps.onNotify('CLEAN RECORD', 'Police are not chasing you right now.', 1.4);
      return;
    }
    if (save.data.credits < RESPRAY_COST) {
      this.deps.onPlayBeep(200, 0.16);
      this.deps.onNotify('INSUFFICIENT CREDITS', `Need ₡${RESPRAY_COST} for fresh plates & respray`, 1.8);
      return;
    }
    save.spendCredits(RESPRAY_COST);
    save.saveNow();
    this.deps.clearHeat();
    this.deps.onPlayDoor();
    this.deps.onPlayChime();
    this.deps.onRefreshProfile();
    this.refresh();
    this.deps.onNotify('FRESH RESPRAY', 'Police scanners cleared!', 2.0);
  }

  public refresh(): void {
    const { save } = this.deps;
    const crEl = document.getElementById('garage-credits');
    if (crEl) crEl.textContent = Math.round(save.data.credits).toLocaleString();

    const engSt = save.data.engineStage;
    const engLv = document.getElementById('garage-engine-lv');
    const engDesc = document.getElementById('garage-engine-desc');
    const engBtn = document.getElementById('btn-upgrade-engine') as HTMLButtonElement | null;
    if (engLv) engLv.textContent = `Stage ${engSt}/3`;
    if (engDesc) {
      engDesc.textContent = engSt === 0 ? 'Stock V8 Output (+0% torque)' : `Twin-Supercharged Stage ${engSt} (+${engSt * 8}% torque)`;
    }
    if (engBtn) {
      engBtn.textContent = engSt >= 3 ? 'MAXED' : `Upgrade ₡${ENGINE_COSTS[engSt].toLocaleString()}`;
      engBtn.disabled = engSt >= 3 || save.data.credits < ENGINE_COSTS[engSt];
      engBtn.style.opacity = engBtn.disabled ? '0.5' : '1';
    }

    const nitSt = save.data.nitroStage;
    const nitLv = document.getElementById('garage-nitro-lv');
    const nitDesc = document.getElementById('garage-nitro-desc');
    const nitBtn = document.getElementById('btn-upgrade-nitro') as HTMLButtonElement | null;
    if (nitLv) nitLv.textContent = `Stage ${nitSt}/3`;
    if (nitDesc) {
      nitDesc.textContent = nitSt === 0 ? 'Standard N2O Bottle' : `High-Flow Stage ${nitSt} (+${nitSt * 6}% boost & faster regen)`;
    }
    if (nitBtn) {
      nitBtn.textContent = nitSt >= 3 ? 'MAXED' : `Upgrade ₡${NITRO_COSTS[nitSt].toLocaleString()}`;
      nitBtn.disabled = nitSt >= 3 || save.data.credits < NITRO_COSTS[nitSt];
      nitBtn.style.opacity = nitBtn.disabled ? '0.5' : '1';
    }

    const heatBtn = document.getElementById('btn-garage-clear-heat') as HTMLButtonElement | null;
    if (heatBtn) {
      const heat = this.deps.getHeat();
      heatBtn.disabled = heat <= 0 || save.data.credits < RESPRAY_COST;
      heatBtn.style.opacity = heatBtn.disabled ? '0.45' : '1';
      heatBtn.textContent = heat > 0 ? `Respray ₡${RESPRAY_COST}` : 'Clean';
    }

    const glowRow = document.getElementById('garage-underglow-row');
    if (glowRow) {
      glowRow.innerHTML = '';
      for (const item of UNDERGLOW_PALETTE) {
        const unlocked = save.data.unlockedUnderglows.includes(item.hex);
        const equipped = save.data.underglowColor === item.hex;
        const btn = document.createElement('button');
        btn.className = `option-btn${equipped ? ' selected' : ''}`;
        btn.style.flex = '0 0 auto';
        btn.style.padding = '6px 10px';
        btn.style.fontSize = '11px';
        if (item.hex !== 'OFF') btn.style.borderBottom = `3px solid ${item.hex}`;
        btn.textContent = unlocked ? item.label : `${item.label} ₡${UNDERGLOW_COST}`;
        btn.addEventListener('click', () => {
          if (!save.data.unlockedUnderglows.includes(item.hex)) {
            if (save.data.credits < UNDERGLOW_COST) {
              this.deps.onPlayBeep(200, 0.16);
              this.deps.onNotify('INSUFFICIENT CREDITS', `Need ₡${UNDERGLOW_COST} to unlock this neon kit`, 1.6);
              return;
            }
            save.spendCredits(UNDERGLOW_COST);
            save.data.unlockedUnderglows.push(item.hex);
          }
          save.data.underglowColor = item.hex;
          save.saveNow();
          this.deps.getPlayerZenvo().mesh.setUnderglowColor(item.hex);
          this.deps.getActiveMesh().setUnderglowColor(item.hex);
          this.deps.onPlayChime();
          this.deps.onRefreshProfile();
          this.refresh();
        });
        glowRow.appendChild(btn);
      }
    }

    const statsEl = document.getElementById('garage-stats-grid');
    if (statsEl) {
      const s = save.data;
      const cards: Array<[string, string]> = [
        ['Top Speed', `${s.maxSpeedKmh} km/h`],
        ['Best Drift Combo', `${s.bestDriftCombo.toLocaleString()} pts`],
        ['Apex Logs', `${s.discoveredShards.length} / 12`],
        ['Rivals Defeated', `${s.rivalsDefeated.length} / 4`],
        ['Courier Runs', `${Object.keys(s.courierRecords).length} / 3`],
        ['Districts', `${s.discoveredDistricts.length} / 5`],
        ['Longest Airtime', `${s.maxAirTime.toFixed(1)}s`],
        ['Goals / Steals / KOs', `${s.goalsScored} / ${s.carsStolen} / ${s.knockouts}`]
      ];
      statsEl.innerHTML = cards
        .map(([k, v]) => `<div class="result-card"><span>${k}</span><strong style="font-size:14px;">${v}</strong></div>`)
        .join('');
    }
  }
}
