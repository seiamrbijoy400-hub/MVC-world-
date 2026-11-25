import * as THREE from 'three';
import { CharacterController } from '../physics/CharacterController';
import { HumanCharacterMesh, DEFAULT_APPEARANCE_BY_ID } from '../graphics/HumanCharacterMesh';
import type { CharacterAppearance, CharacterId, HairStyleId, AccessoryId } from '../network/LobbyProtocol';
import type { OpenWorldMap } from '../graphics/OpenWorldMap';
import { hasLineOfSight } from '../game/RoadGraph';

export type PedestrianState = 'WALK' | 'IDLE_LOOK' | 'WITNESS' | 'FLEE' | 'KO';

export interface PedestrianAgent {
  id: number;
  name: string;
  controller: CharacterController;
  mesh: HumanCharacterMesh;
  state: PedestrianState;
  stateTimer: number;
  patrolA: THREE.Vector3;
  patrolB: THREE.Vector3;
  headingToB: boolean;
  threatPos: THREE.Vector3;
  pendingCrimeReason: string;
  witnessReported: boolean;
}

const SKIN_POOL = ['#f2d3b6', '#e0b48c', '#c68a5e', '#a1663f', '#6b4529'];
const HAIR_COLOR_POOL = ['#1c1917', '#3b2a20', '#6b4a2f', '#a16207', '#475569'];
const JACKET_POOL = ['#334155', '#1e3a8a', '#0f766e', '#7c2d12', '#4c1d95', '#3f6212', '#be123c', '#18181b'];
const PANTS_POOL = ['#0f172a', '#1e293b', '#334155', '#292524'];
const HAIR_STYLES: HairStyleId[] = ['spiky', 'twintails', 'ponytail', 'bob', 'cyber'];
const ACCESSORIES: AccessoryId[] = ['none', 'none', 'sunglasses', 'headphones', 'visor'];
const NAMES = ['Sora', 'Hana', 'Riku', 'Yui', 'Taro', 'Kana', 'Nori', 'Mai', 'Jin', 'Aya', 'Koji', 'Rei', 'Mina', 'Sho'];

const PATROL_ROUTES: Array<[[number, number], [number, number]]> = [
  [[57, -140], [57, -52]],
  [[57, -26], [57, 16]],
  [[57, 19], [112, 19]],
  [[133, 19], [210, 19]],
  [[133, -140], [133, -52]],
  [[133, -26], [133, 16]],
  [[212, -140], [212, 16]],
  [[35, -24], [35, 36]],
  [[129, 52], [129, 126]],
  [[60, 164], [208, 164]],
  [[60, 212], [208, 212]],
  [[60, 238], [132, 238]],
  [[202, 238], [282, 238]],
  [[236, -142], [236, 18]]
];

function makePedestrianAppearance(seed: number): CharacterAppearance {
  const baseId: CharacterId = (['kaito', 'mika', 'ren', 'sora'] as CharacterId[])[seed % 4];
  const base = DEFAULT_APPEARANCE_BY_ID[baseId];
  return {
    ...base,
    hairStyle: HAIR_STYLES[seed % HAIR_STYLES.length],
    hairColor: HAIR_COLOR_POOL[(seed * 3) % HAIR_COLOR_POOL.length],
    jacketColor: JACKET_POOL[(seed * 5) % JACKET_POOL.length],
    pantsColor: PANTS_POOL[(seed * 7) % PANTS_POOL.length],
    skinColor: SKIN_POOL[(seed * 2) % SKIN_POOL.length],
    accessory: ACCESSORIES[(seed * 3) % ACCESSORIES.length]
  };
}

export class PedestrianSystem {
  public agents: PedestrianAgent[] = [];
  private scene: THREE.Scene;
  private openWorld: OpenWorldMap;
  private groundSampler: (x: number, z: number) => number;

  public onCrimeReported: (reason: string, reporterPos: THREE.Vector3) => void = () => {};
  public onPedestrianKnockedOut: (ped: PedestrianAgent) => void = () => {};

  constructor(
    scene: THREE.Scene,
    openWorld: OpenWorldMap,
    groundSampler: (x: number, z: number) => number,
    count = 14
  ) {
    this.scene = scene;
    this.openWorld = openWorld;
    this.groundSampler = groundSampler;

    const total = Math.min(count, PATROL_ROUTES.length);
    for (let i = 0; i < total; i++) {
      const [a, b] = PATROL_ROUTES[i];
      const start = new THREE.Vector3(
        THREE.MathUtils.lerp(a[0], b[0], 0.25 + (i % 3) * 0.25),
        0,
        THREE.MathUtils.lerp(a[1], b[1], 0.25 + (i % 3) * 0.25)
      );
      start.y = this.groundSampler(start.x, start.z);

      const ctrl = new CharacterController();
      ctrl.groundHeightSampler = this.groundSampler;
      ctrl.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
      ctrl.respawnDelay = 22;
      ctrl.respawnPoint = start.clone();
      ctrl.maxHp = 50;
      ctrl.resetAt(start, 0);

      const app = makePedestrianAppearance(i + 1);
      // Pass empty playerName so ambient civilians don't clutter screen with floating HP bars
      const mesh = new HumanCharacterMesh('kaito', '', app);
      mesh.root.position.copy(start);
      mesh.root.scale.setScalar(0.92 + (i % 5) * 0.035);
      this.scene.add(mesh.root);

      const agent: PedestrianAgent = {
        id: i,
        name: NAMES[i % NAMES.length],
        controller: ctrl,
        mesh,
        state: 'WALK',
        stateTimer: 0,
        patrolA: new THREE.Vector3(a[0], 0, a[1]),
        patrolB: new THREE.Vector3(b[0], 0, b[1]),
        headingToB: i % 2 === 0,
        threatPos: new THREE.Vector3(),
        pendingCrimeReason: '',
        witnessReported: false
      };

      ctrl.onDeath = () => {
        agent.state = 'KO';
        agent.stateTimer = 0;
        agent.witnessReported = false;
        this.onPedestrianKnockedOut(agent);
      };
      ctrl.onRespawn = (spawn) => {
        agent.state = 'WALK';
        agent.stateTimer = 0;
        agent.witnessReported = false;
        mesh.root.position.copy(spawn);
      };

      this.agents.push(agent);
    }
  }

  /**
   * Checks if any living pedestrian within witness range & line-of-sight sees a crime.
   * Returns true if at least one witness starts calling police.
   */
  public notifyCrime(crimePos: THREE.Vector3, reason: string, radius = 30, exclude?: PedestrianAgent): boolean {
    let witnessed = false;
    for (const a of this.agents) {
      if (a === exclude || a.controller.isDead || a.state === 'KO') continue;
      const d = Math.hypot(a.controller.position.x - crimePos.x, a.controller.position.z - crimePos.z);
      if (d > radius) continue;
      if (!hasLineOfSight(a.controller.position.x, a.controller.position.z, crimePos.x, crimePos.z, this.openWorld.colliders)) {
        continue;
      }
      if (a.state !== 'WITNESS') {
        a.state = 'WITNESS';
        a.stateTimer = 1.65;
        a.witnessReported = false;
        a.pendingCrimeReason = reason;
        a.threatPos.copy(crimePos);
        a.mesh.showSpeechBubble('! CALLING COPS');
        witnessed = true;
      }
    }
    return witnessed;
  }

  /** Switches a struck civilian directly into terrified FLEE rather than freezing as a witness. */
  public markVictimFlee(victim: PedestrianAgent, attackerPos: THREE.Vector3): void {
    if (victim.controller.isDead) return;
    victim.state = 'FLEE';
    victim.stateTimer = 5.5;
    victim.witnessReported = false;
    victim.threatPos.copy(attackerPos);
  }

  /** Alerts nearby pedestrians to flee away from danger (active sirens, crashes, fights). */
  public alertDanger(dangerPos: THREE.Vector3, radius = 20): void {
    for (const a of this.agents) {
      if (a.controller.isDead || a.state === 'KO' || a.state === 'WITNESS') continue;
      const d = Math.hypot(a.controller.position.x - dangerPos.x, a.controller.position.z - dangerPos.z);
      if (d <= radius) {
        a.state = 'FLEE';
        a.stateTimer = 4.5;
        a.threatPos.copy(dangerPos);
      }
    }
  }

  public update(
    dt: number,
    focusPos: THREE.Vector3,
    playerCarPos: THREE.Vector3,
    playerCarSpeedKmh: number,
    playerInCar: boolean
  ): void {
    for (const a of this.agents) {
      const distToFocus = Math.hypot(
        a.controller.position.x - focusPos.x,
        a.controller.position.z - focusPos.z
      );

      // Cull distant animations & simulation for mobile performance
      if (distToFocus > 110 && a.state === 'WALK') {
        a.mesh.root.visible = false;
        continue;
      }
      a.mesh.root.visible = true;

      if (a.controller.isDead) {
        a.controller.update(dt, { moveX: 0, moveY: 0, sprint: false, jump: false, punch: false }, 0);
        a.mesh.root.position.copy(a.controller.position);
        a.mesh.root.rotation.y = a.controller.yaw;
        a.mesh.updateAnimation(dt, 'KO');
        continue;
      }

      // Vehicle vs pedestrian impact check (player car speeding into pedestrian)
      if (playerInCar && playerCarSpeedKmh > 18) {
        const dCar = Math.hypot(a.controller.position.x - playerCarPos.x, a.controller.position.z - playerCarPos.z);
        if (dCar < 2.2 && Math.abs(a.controller.position.y - playerCarPos.y) < 2.0) {
          const awayX = a.controller.position.x - playerCarPos.x;
          const awayZ = a.controller.position.z - playerCarPos.z;
          const len = Math.hypot(awayX, awayZ) || 1;
          const dmg = Math.min(55, Math.round(playerCarSpeedKmh * 0.85));
          const killed = a.controller.takeDamage(dmg, awayX / len, awayZ / len);
          this.markVictimFlee(a, playerCarPos);
          this.notifyCrime(a.controller.position, killed ? 'HIT AND RUN' : 'RECKLESS DRIVING', 34, a);
          this.alertDanger(playerCarPos, 22);
        } else if (dCar < 9 && playerCarSpeedKmh > 48 && a.state !== 'WITNESS') {
          // Near miss makes pedestrian jump/flee out of the road!
          a.state = 'FLEE';
          a.stateTimer = 3.2;
          a.threatPos.copy(playerCarPos);
        }
      }

      let moveX = 0;
      let moveY = 0;
      let sprint = false;

      if (a.state === 'WITNESS') {
        a.stateTimer -= dt;
        const dx = a.threatPos.x - a.controller.position.x;
        const dz = a.threatPos.z - a.controller.position.z;
        a.controller.yaw = Math.atan2(-dx, -dz);

        if (a.stateTimer <= 0 && !a.witnessReported) {
          a.witnessReported = true;
          this.onCrimeReported(a.pendingCrimeReason || 'CRIME REPORTED', a.controller.position.clone());
          a.state = 'FLEE';
          a.stateTimer = 5.0;
        }
      } else if (a.state === 'FLEE') {
        a.stateTimer -= dt;
        const dx = a.controller.position.x - a.threatPos.x;
        const dz = a.controller.position.z - a.threatPos.z;
        const d = Math.hypot(dx, dz) || 1;
        moveX = dx / d;
        moveY = -dz / d;
        sprint = true;
        if (a.stateTimer <= 0) {
          a.state = 'WALK';
        }
      } else if (a.state === 'IDLE_LOOK') {
        a.stateTimer -= dt;
        if (a.stateTimer <= 0) {
          a.state = 'WALK';
          a.headingToB = !a.headingToB;
        }
      } else {
        // WALK along sidewalk patrol segment
        const target = a.headingToB ? a.patrolB : a.patrolA;
        const dx = target.x - a.controller.position.x;
        const dz = target.z - a.controller.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 1.2) {
          a.state = 'IDLE_LOOK';
          a.stateTimer = 1.6 + Math.random() * 2.2;
        } else {
          // Half-speed natural casual stroll
          moveX = (dx / d) * 0.65;
          moveY = (-dz / d) * 0.65;
        }
      }

      a.controller.update(dt, { moveX, moveY, sprint, jump: false, punch: false }, 0);
      a.mesh.root.position.copy(a.controller.position);
      a.mesh.root.rotation.y = a.controller.yaw;

      const anim = a.state === 'FLEE' && a.controller.animState === 'RUN' ? 'FLEE' : a.controller.animState;
      if (distToFocus < 80) {
        a.mesh.updateAnimation(dt, anim);
      }
    }
  }

  public dispose(): void {
    for (const a of this.agents) {
      this.scene.remove(a.mesh.root);
      a.mesh.dispose();
    }
    this.agents = [];
  }
}
