import type { CharAnimState, CharacterId } from '../network/LobbyProtocol';

/** Rigged GLB character variants bundled with the game. */
export type CharacterModelId = 'male' | 'female';

export const MODEL_URLS: Record<CharacterModelId, string> = {
  male: '/assets/models/male.glb',
  female: '/assets/models/female.glb'
};

/** Kaito/Ren use the business-man rig; Mika/Sora use the girl rig. */
export function modelForCharacter(id: CharacterId | string | undefined): CharacterModelId {
  return id === 'mika' || id === 'sora' ? 'female' : 'male';
}

export function modelUrlFor(id: CharacterId | string | undefined): string {
  return MODEL_URLS[modelForCharacter(id)];
}

/**
 * Both rigs ship their own animation clips (male uses a `Rig|` prefix, female
 * uses plain names). Keep the preference list explicit instead of downloading
 * or retargeting clips between incompatible skeletons.
 */
const CLIP_PREFERENCE: Record<CharacterModelId, Partial<Record<CharAnimState, string[]>>> = {
  male: {
    IDLE: ['rig|idle', 'idle'],
    WALK: ['rig|walk', 'walk'],
    RUN: ['rig|run', 'run'],
    FLEE: ['rig|run', 'run'],
    JUMP: ['rig|jump', 'jump'],
    // Combat clips are not present in the source GLBs: keep a grounded base
    // clip and layer a short procedural arm/torso pose on top (see GLTFCharacterMesh).
    PUNCH: ['rig|idle', 'idle'],
    HIT: ['rig|idle', 'idle'],
    KO: ['rig|idle', 'idle'],
    DRIVE: ['rig|idle', 'idle']
  },
  female: {
    IDLE: ['idle', 'idle 2', 'idle 3'],
    WALK: ['walk', 'walk_fast'],
    RUN: ['run', 'walk_fast'],
    FLEE: ['run', 'walk_fast'],
    JUMP: ['jump_fwd', 'jump_start', 'jump_loop'],
    PUNCH: ['idle', 'idle 3'],
    HIT: ['idle', 'idle 3'],
    KO: ['idle', 'idle 3'],
    DRIVE: ['idle', 'idle 3']
  }
};

/** States that receive an additive procedural pose over the GLB base clip. */
export function usesProceduralPose(state: CharAnimState): boolean {
  return state === 'PUNCH' || state === 'HIT' || state === 'KO';
}

const norm = (name: string) => name.toLowerCase().trim().replace(/\s+/g, ' ');

/**
 * Resolve a gameplay state to a clip name actually present in the loaded GLB.
 * Returns null when no suitable clip exists so callers can keep the previous
 * action instead of crashing.
 */
export function mapAnimStateToClip(
  state: CharAnimState,
  clipNames: readonly string[],
  model: CharacterModelId
): string | null {
  const available = clipNames.map(norm);
  const prefs = CLIP_PREFERENCE[model][state] ?? CLIP_PREFERENCE[model].IDLE ?? [];
  for (const pref of prefs) {
    const exact = available.indexOf(pref);
    if (exact >= 0) return clipNames[exact];
  }
  for (const pref of prefs) {
    const loose = available.findIndex((n) => n.includes(pref));
    if (loose >= 0) return clipNames[loose];
  }
  return null;
}
