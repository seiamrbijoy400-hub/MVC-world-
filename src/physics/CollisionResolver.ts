import * as THREE from 'three';
import type { CarPhysics } from '../physics/CarPhysics';
import type { CharacterController } from '../physics/CharacterController';

export interface VehicleCollisionEvent {
  pos: THREE.Vector3;
  impactKmh: number;
  involvesPrimary: boolean;
}

/**
 * Separates overlapping vehicle hulls and resolves relative closing impulse.
 * Returns impact metadata when two moving cars collide hard enough for SFX/sparks.
 */
export function separateVehiclePair(
  a: CarPhysics,
  b: CarPhysics,
  primary: CarPhysics
): VehicleCollisionEvent | null {
  const minDist = 3.1;
  const dx = a.position.x - b.position.x;
  const dz = a.position.z - b.position.z;
  const dSq = dx * dx + dz * dz;
  if (dSq >= minDist * minDist || dSq <= 0.0001) return null;

  const d = Math.sqrt(dSq);
  const nx = dx / d;
  const nz = dz / d;
  const overlap = (minDist - d) * 0.5;
  a.position.x += nx * overlap;
  a.position.z += nz * overlap;
  b.position.x -= nx * overlap;
  b.position.z -= nz * overlap;

  const rvx = a.velocity.x - b.velocity.x;
  const rvz = a.velocity.z - b.velocity.z;
  const relDot = rvx * nx + rvz * nz;
  if (relDot >= 0) return null;

  const impulse = -relDot * 0.68;
  a.velocity.x += nx * impulse;
  a.velocity.z += nz * impulse;
  b.velocity.x -= nx * impulse;
  b.velocity.z -= nz * impulse;

  const relSpeed = Math.abs(relDot);
  if (relSpeed <= 5) return null;

  return {
    pos: a.position,
    impactKmh: relSpeed * 3.6,
    involvesPrimary: a === primary || b === primary
  };
}

/**
 * Resolves solid hull pushback for an on-foot character against a list of vehicles,
 * followed by a world collider clamp so cars cannot force the character inside buildings.
 */
export function pushCharacterOutOfVehicles(
  charCtrl: CharacterController,
  hulls: readonly CarPhysics[],
  worldCollider: (pos: THREE.Vector3, vel: THREE.Vector3, radius: number) => boolean
): boolean {
  let pushed = false;
  const carRad = 1.75;
  for (const hull of hulls) {
    if (Math.abs(charCtrl.position.y - hull.position.y) > 2.4) continue;
    const dx = charCtrl.position.x - hull.position.x;
    const dz = charCtrl.position.z - hull.position.z;
    const dSq = dx * dx + dz * dz;
    if (dSq < carRad * carRad && dSq > 0.0001) {
      const d = Math.sqrt(dSq);
      charCtrl.position.x = hull.position.x + (dx / d) * carRad;
      charCtrl.position.z = hull.position.z + (dz / d) * carRad;
      pushed = true;
    }
  }
  if (pushed) {
    worldCollider(charCtrl.position, charCtrl.velocity, 0.45);
  }
  return pushed;
}

/** Checks whether a fast-moving vehicle strikes an on-foot character and applies damage + knockback. */
export function resolveMovingVehicleImpactOnCharacter(
  charCtrl: CharacterController,
  vehicles: readonly CarPhysics[],
  minSpeedKmh = 22,
  hitRadius = 2.6,
  damageScale = 0.45,
  maxDamage = 40
): { hit: boolean; killed: boolean; speedKmh: number } {
  if (charCtrl.isDead) return { hit: false, killed: false, speedKmh: 0 };
  for (const v of vehicles) {
    const spd = v.speedKmh;
    if (spd < minSpeedKmh) continue;
    const d = Math.hypot(v.position.x - charCtrl.position.x, v.position.z - charCtrl.position.z);
    if (d < hitRadius && Math.abs(v.position.y - charCtrl.position.y) < 2.2) {
      let ax = charCtrl.position.x - v.position.x;
      let az = charCtrl.position.z - v.position.z;
      const len = Math.hypot(ax, az) || 1;
      ax /= len;
      az /= len;
      const dmg = Math.min(maxDamage, Math.max(12, Math.round(spd * damageScale)));
      const killed = charCtrl.takeDamage(dmg, ax, az);
      return { hit: true, killed, speedKmh: spd };
    }
  }
  return { hit: false, killed: false, speedKmh: 0 };
}
