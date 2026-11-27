import { GearboxType } from '../physics/CarPhysics';
import type { CharacterId } from '../network/LobbyProtocol';
import type { TimeOfDay } from '../graphics/TrackEnvironment';

export type CarArchetypeId = 'HYPER' | 'DRIFT' | 'TOUGE';
export type WeatherMode = 'CLEAR' | 'RAIN' | 'STORM';
export type GraphicsQuality = 'HIGH' | 'MED' | 'LOW';
export type AtmospherePref = TimeOfDay | 'AUTO';

export interface GhostFrame {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  steer: number;
}

export interface SaveData {
  version: number;
  playerName: string;
  characterId: CharacterId;
  carColor: string;
  underglowColor: string;
  unlockedUnderglows: string[];
  engineStage: number;
  nitroStage: number;
  carArchetype: CarArchetypeId;
  gearbox: GearboxType;
  assistMode: 'ARCADE' | 'PRO';
  graphicsQuality: GraphicsQuality;
  weatherMode: WeatherMode;
  atmospherePref: AtmospherePref;
  musicEnabled: boolean;

  legendXp: number;
  credits: number;
  bestLapTime: number | null;
  bestDriftCombo: number;
  totalDriftPoints: number;
  maxSpeedKmh: number;
  maxAirTime: number;
  goalsScored: number;
  carsStolen: number;
  knockouts: number;
  timesBusted: number;

  speedTrapRecords: Record<string, number>;
  driftZoneRecords: Record<string, number>;
  courierRecords: Record<string, number>;
  discoveredShards: string[];
  discoveredDistricts: string[];
  rivalsDefeated: string[];
  bestLapGhost: GhostFrame[];
  ghostReplayEnabled: boolean;
}

export interface LegendRank {
  level: number;
  title: string;
  jpTitle: string;
  minXp: number;
  color: string;
}

export const LEGEND_RANKS: LegendRank[] = [
  { level: 1, title: 'Street Rookie', jpTitle: '新米ドライバー', minXp: 0, color: '#94a3b8' },
  { level: 2, title: 'Neon Runner', jpTitle: 'ネオンランナー', minXp: 500, color: '#38bdf8' },
  { level: 3, title: 'Drift Disciple', jpTitle: 'ドリフト侍', minXp: 1500, color: '#facc15' },
  { level: 4, title: 'Touge Phantom', jpTitle: '峠の亡霊', minXp: 3500, color: '#f97316' },
  { level: 5, title: 'District Sovereign', jpTitle: '街の覇者', minXp: 7000, color: '#ec4899' },
  { level: 6, title: 'APEX ZERO', jpTitle: '頂点・零', minXp: 14000, color: '#22d3ee' }
];

const SAVE_KEY = 'apex_zero_save_v1';
export const CURRENT_SAVE_VERSION = 2;

function safeNonNeg(val: unknown, fallback = 0): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function safeRecordOfNumbers(val: unknown): Record<string, number> {
  if (!val || typeof val !== 'object' || Array.isArray(val)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
    const n = Number(v);
    if (typeof k === 'string' && k.length > 0 && k.length <= 64 && Number.isFinite(n)) {
      out[k] = n;
    }
  }
  return out;
}

function safeUnderglow(val: unknown, fallback: string): string {
  if (val === 'OFF') return 'OFF';
  return typeof val === 'string' && /^#[0-9a-fA-F]{6}$/.test(val) ? val : fallback;
}

function safeGhostFrames(val: unknown): GhostFrame[] {
  if (!Array.isArray(val)) return [];
  const keys: (keyof GhostFrame)[] = ['t', 'x', 'y', 'z', 'yaw', 'pitch', 'roll', 'steer'];
  const frames: GhostFrame[] = [];
  for (const raw of val) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const obj = raw as Record<string, unknown>;
    if (!keys.every((key) => typeof obj[key] === 'number' && Number.isFinite(obj[key]))) continue;
    const t = Number(obj.t);
    if (t < 0 || t > 3_600_000) continue;
    frames.push({
      t,
      x: Number(obj.x), y: Number(obj.y), z: Number(obj.z),
      yaw: Number(obj.yaw), pitch: Number(obj.pitch), roll: Number(obj.roll), steer: Number(obj.steer)
    });
    if (frames.length >= 3600) break;
  }
  frames.sort((a, b) => a.t - b.t);
  return frames;
}

export function migrateSave(rawObj: unknown): SaveData {
  const defaults = createDefaultSave();
  if (!rawObj || typeof rawObj !== 'object' || Array.isArray(rawObj)) {
    return defaults;
  }
  const parsed = rawObj as Record<string, any>;
  const charId = (['kaito', 'mika', 'ren', 'sora'].includes(String(parsed.characterId))
    ? String(parsed.characterId)
    : defaults.characterId) as CharacterId;

  return {
    ...defaults,
    ...parsed,
    version: CURRENT_SAVE_VERSION,
    playerName: typeof parsed.playerName === 'string' && parsed.playerName.trim()
      ? parsed.playerName.replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 16)
      : defaults.playerName,
    characterId: charId,
    carColor: typeof parsed.carColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(parsed.carColor) ? parsed.carColor : defaults.carColor,
    underglowColor: safeUnderglow(parsed.underglowColor, defaults.underglowColor),
    engineStage: Math.max(0, Math.min(3, Math.round(safeNonNeg(parsed.engineStage, 0)))),
    nitroStage: Math.max(0, Math.min(3, Math.round(safeNonNeg(parsed.nitroStage, 0)))),
    legendXp: Math.round(safeNonNeg(parsed.legendXp, 0)),
    credits: Math.round(safeNonNeg(parsed.credits, defaults.credits)),
    bestLapTime: typeof parsed.bestLapTime === 'number' && Number.isFinite(parsed.bestLapTime) && parsed.bestLapTime > 0 ? parsed.bestLapTime : null,
    bestDriftCombo: Math.round(safeNonNeg(parsed.bestDriftCombo, 0)),
    totalDriftPoints: Math.round(safeNonNeg(parsed.totalDriftPoints, 0)),
    maxSpeedKmh: Math.round(safeNonNeg(parsed.maxSpeedKmh, 0)),
    maxAirTime: safeNonNeg(parsed.maxAirTime, 0),
    goalsScored: Math.round(safeNonNeg(parsed.goalsScored, 0)),
    carsStolen: Math.round(safeNonNeg(parsed.carsStolen, 0)),
    knockouts: Math.round(safeNonNeg(parsed.knockouts, 0)),
    timesBusted: Math.round(safeNonNeg(parsed.timesBusted, 0)),
    graphicsQuality: (['HIGH', 'MED', 'LOW'].includes(String(parsed.graphicsQuality)) ? parsed.graphicsQuality : 'HIGH') as GraphicsQuality,
    weatherMode: (['CLEAR', 'RAIN', 'STORM'].includes(String(parsed.weatherMode)) ? parsed.weatherMode : 'CLEAR') as WeatherMode,
    assistMode: (parsed.assistMode === 'PRO' ? 'PRO' : 'ARCADE'),
    carArchetype: (['HYPER', 'DRIFT', 'TOUGE'].includes(String(parsed.carArchetype)) ? parsed.carArchetype : 'HYPER') as CarArchetypeId,
    atmospherePref: (['DAY', 'SUNSET', 'NIGHT', 'AUTO'].includes(String(parsed.atmospherePref)) ? parsed.atmospherePref : 'SUNSET') as AtmospherePref,
    gearbox: (['AUTO', 'SEMI', 'MANUAL'].includes(parsed.gearbox) ? parsed.gearbox as GearboxType : GearboxType.AUTO),
    unlockedUnderglows: Array.isArray(parsed.unlockedUnderglows) && parsed.unlockedUnderglows.length > 0
      ? parsed.unlockedUnderglows.filter((u): u is string => typeof u === 'string' && (u === 'OFF' || /^#[0-9a-fA-F]{6}$/.test(u)))
      : ['#22d3ee', 'OFF'],
    speedTrapRecords: safeRecordOfNumbers(parsed.speedTrapRecords),
    driftZoneRecords: safeRecordOfNumbers(parsed.driftZoneRecords),
    courierRecords: safeRecordOfNumbers(parsed.courierRecords),
    discoveredShards: Array.isArray(parsed.discoveredShards) ? parsed.discoveredShards.filter((s): s is string => typeof s === 'string') : [],
    discoveredDistricts: Array.isArray(parsed.discoveredDistricts) ? parsed.discoveredDistricts.filter((s): s is string => typeof s === 'string') : [],
    rivalsDefeated: Array.isArray(parsed.rivalsDefeated) ? parsed.rivalsDefeated.filter((s): s is string => typeof s === 'string') : [],
    bestLapGhost: safeGhostFrames(parsed.bestLapGhost),
    musicEnabled: typeof parsed.musicEnabled === 'boolean' ? parsed.musicEnabled : defaults.musicEnabled,
    ghostReplayEnabled: typeof parsed.ghostReplayEnabled === 'boolean' ? parsed.ghostReplayEnabled : true
  };
}

export function createDefaultSave(): SaveData {
  return {
    version: CURRENT_SAVE_VERSION,
    playerName: 'Kaito_01',
    characterId: 'kaito',
    carColor: '#ff5500',
    underglowColor: '#22d3ee',
    unlockedUnderglows: ['#22d3ee', 'OFF'],
    engineStage: 0,
    nitroStage: 0,
    carArchetype: 'HYPER',
    gearbox: GearboxType.AUTO,
    assistMode: 'ARCADE',
    graphicsQuality: 'HIGH',
    weatherMode: 'CLEAR',
    atmospherePref: 'SUNSET',
    musicEnabled: false,

    legendXp: 0,
    credits: 1000,
    bestLapTime: null,
    bestDriftCombo: 0,
    totalDriftPoints: 0,
    maxSpeedKmh: 0,
    maxAirTime: 0,
    goalsScored: 0,
    carsStolen: 0,
    knockouts: 0,
    timesBusted: 0,

    speedTrapRecords: {},
    driftZoneRecords: {},
    courierRecords: {},
    discoveredShards: [],
    discoveredDistricts: [],
    rivalsDefeated: [],
    bestLapGhost: [],
    ghostReplayEnabled: true
  };
}

export class SaveManager {
  public data: SaveData;
  private saveQueued = false;

  constructor() {
    this.data = this.load();
  }

  private load(): SaveData {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        return migrateSave(JSON.parse(raw));
      }
    } catch {}
    return createDefaultSave();
  }

  public exportJson(): string {
    return JSON.stringify(this.data, null, 2);
  }

  public importJson(raw: string): { ok: boolean; error?: string } {
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'Backup file does not contain a valid APEX ZERO save object.' };
      }
      this.data = migrateSave(parsed);
      this.saveNow();
      return { ok: true };
    } catch {
      return { ok: false, error: 'Malformed JSON in save backup.' };
    }
  }

  public saveNow(): void {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data));
      this.saveQueued = false;
    } catch {}
  }

  public scheduleSave(): void {
    if (this.saveQueued) return;
    this.saveQueued = true;
    setTimeout(() => this.saveNow(), 600);
  }

  public resetAll(): void {
    this.data = createDefaultSave();
    this.saveNow();
  }

  public getRank(xp = this.data.legendXp): LegendRank {
    let current = LEGEND_RANKS[0];
    for (const r of LEGEND_RANKS) {
      if (xp >= r.minXp) current = r;
    }
    return current;
  }

  public getNextRank(xp = this.data.legendXp): LegendRank | null {
    for (const r of LEGEND_RANKS) {
      if (xp < r.minXp) return r;
    }
    return null;
  }

  /** Grants Legend XP & Credits, returning newly achieved Rank if player leveled up! */
  public grantReward(xp: number, credits: number): LegendRank | null {
    const prevRank = this.getRank();
    this.data.legendXp += Math.max(0, Math.round(xp));
    this.data.credits += Math.max(0, Math.round(credits));
    this.scheduleSave();
    const nextRank = this.getRank();
    return nextRank.level > prevRank.level ? nextRank : null;
  }

  /** Deducts credits up to the current balance and returns the amount actually paid. */
  public spendCredits(amount: number): number {
    const paid = Math.max(0, Math.min(this.data.credits, Math.round(amount)));
    this.data.credits -= paid;
    this.scheduleSave();
    return paid;
  }
}
