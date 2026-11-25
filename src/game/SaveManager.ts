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

  speedTrapRecords: Record<string, number>;
  driftZoneRecords: Record<string, number>;
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

export function createDefaultSave(): SaveData {
  return {
    version: 1,
    playerName: 'Kaito_01',
    characterId: 'kaito',
    carColor: '#ff5500',
    underglowColor: '#22d3ee',
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

    speedTrapRecords: {},
    driftZoneRecords: {},
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
        const parsed = JSON.parse(raw);
        return {
          ...createDefaultSave(),
          ...parsed,
          speedTrapRecords: { ...(parsed.speedTrapRecords || {}) },
          driftZoneRecords: { ...(parsed.driftZoneRecords || {}) },
          discoveredShards: Array.isArray(parsed.discoveredShards) ? parsed.discoveredShards : [],
          discoveredDistricts: Array.isArray(parsed.discoveredDistricts) ? parsed.discoveredDistricts : [],
          rivalsDefeated: Array.isArray(parsed.rivalsDefeated) ? parsed.rivalsDefeated : [],
          bestLapGhost: Array.isArray(parsed.bestLapGhost) ? parsed.bestLapGhost : []
        };
      }
    } catch {}
    return createDefaultSave();
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
    setTimeout(() => this.saveNow(), 300);
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
}
