export type CharacterId = 'kaito' | 'mika' | 'ren' | 'sora';
export type HairStyleId = 'spiky' | 'twintails' | 'ponytail' | 'bob' | 'cyber';
export type AccessoryId = 'none' | 'visor' | 'headphones' | 'sunglasses' | 'wing';
export type GameModeId = 'OPEN_WORLD' | 'CIRCUIT_RACE' | 'DRIFT_ARENA';
export type BotDifficulty = 'CHILL' | 'PRO' | 'INSANE';
export type CharAnimState = 'IDLE' | 'WALK' | 'RUN' | 'JUMP' | 'PUNCH' | 'HIT' | 'FLEE' | 'KO' | 'DRIVE';

export interface CharacterAppearance {
  hairStyle: HairStyleId;
  hairColor: string;
  eyeColor: string;
  jacketColor: string;
  accentColor: string;
  pantsColor: string;
  skinColor: string;
  accessory: AccessoryId;
}

export interface PlayerSlot {
  id: string;
  name: string;
  isHost: boolean;
  isBot: boolean;
  botDifficulty?: BotDifficulty;
  characterId: CharacterId;
  appearance?: CharacterAppearance;
  carColor: string;
  gearbox: 'AUTO' | 'SEMI' | 'MANUAL';
  ready: boolean;
}

export interface RoomState {
  code: string;
  name: string;
  mode: GameModeId;
  laps: number;
  status: 'LOBBY' | 'COUNTDOWN' | 'PLAYING';
  players: PlayerSlot[];
  maxPlayers: number;
}

export interface RoomSummary {
  code: string;
  name: string;
  mode: GameModeId;
  playerCount: number;
  botCount: number;
  maxPlayers: number;
  status: 'LOBBY' | 'COUNTDOWN' | 'PLAYING';
  hostName: string;
}

export interface NetworkPlayerSync {
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  carX: number;
  carY: number;
  carZ: number;
  carYaw: number;
  speedKmh: number;
  inCar: boolean;
  animState: CharAnimState;
  steer: number;
  hp: number;
  carColor: string;
  characterId: CharacterId;
  appearance?: CharacterAppearance;
}

export type NetworkMode = 'OFFLINE' | 'LAN' | 'ONLINE';

export interface LeaderboardEntry {
  playerId: string;
  name: string;
  score: number;
  bestTimeMs?: number;
  combo?: number;
  finishedAt: number;
}

export interface LanNetworkInfo {
  mode: 'LAN' | 'ONLINE';
  ips: string[];
  port: number;
  preferredUrl: string;
  publicUrl?: string;
  lanWarning?: string;
}

/** Metadata for a file shared inside a lobby room. Bytes stay on the host server. */
export interface SharedFileInfo {
  id: string;
  name: string;
  mime: string;
  size: number;
  ownerName: string;
  createdAt: number;
}

/** Hard limits enforced by both the client and the lobby server. */
export const SHARED_FILE_LIMITS = {
  maxFileBytes: 4 * 1024 * 1024,
  maxFilesPerRoom: 20,
  maxRoomBytes: 16 * 1024 * 1024,
  ttlMs: 30 * 60 * 1000
} as const;
