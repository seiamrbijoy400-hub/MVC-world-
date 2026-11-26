import * as THREE from 'three';
import { CarPhysics } from '../physics/CarPhysics';
import { CarMesh } from '../graphics/CarMesh';
import { TrackEnvironment } from '../graphics/TrackEnvironment';
import { OpenWorldMap } from '../graphics/OpenWorldMap';
import { RoadGraph, hasLineOfSight } from './RoadGraph';

export interface PoliceHooks {
  /** Fired whenever the wanted level changes. */
  onHeatChanged: (level: number, label: string) => void;
  /** Fired each frame when arrest progress changes (0..1). */
  onBustProgress: (progress: number) => void;
  /** Player was caught on foot — pay the fine and get hauled to the station. */
  onBusted: (fine: number, heat: number) => void;
  /** Player evaded police cleanly after having heat. */
  onEscaped: () => void;
  /** A police cruiser slammed into something. */
  onImpact: (impactKmh: number, pos: THREE.Vector3) => void;
}

export interface PoliceUnit {
  physics: CarPhysics;
  mesh: CarMesh;
  lightA: THREE.Mesh;
  lightB: THREE.Mesh;
  sirenPhase: number;
  stuckTimer: number;
  reverseTimer: number;
  age: number;
  mode: 'PURSUING' | 'SEARCHING';
}

const HEAT_LABELS = ['CLEAN', 'SUSPECT', 'WANTED', 'HIGH RISK', 'MOST WANTED', 'CITY LOCKDOWN'];

/** Safe road-side spawn points around the city loops. */
const SPAWN_POINTS: Array<[number, number]> = [
  [46, -160], [122, -160], [224, -160], [296, -160],
  [296, -40], [296, 30], [296, 150], [224, 150],
  [122, 150], [46, 150], [46, 30], [46, -40],
  [122, -40], [224, -40], [224, 30], [122, 30],
  [122, 224], [224, 224], [46, 224]
];

export class PoliceSystem {
  public heat = 0;
  public units: PoliceUnit[] = [];
  public nearestDistance = 999;
  public isSpotted = false;
  public bustProgress = 0;
  public onHooks: PoliceHooks = {
    onHeatChanged: () => {},
    onBustProgress: () => {},
    onBusted: () => {},
    onEscaped: () => {},
    onImpact: () => {}
  };

  private scene: THREE.Scene;
  private track: TrackEnvironment;
  private openWorld: OpenWorldMap;
  private roadGraph = new RoadGraph();

  private spawnCooldown = 0;
  private crimeCooldown = 0;
  private decayTimer = 0;
  private bustCooldown = 0;
  private lastKnownPos = new THREE.Vector3();
  private scratch = new THREE.Vector3();
  private navScratch = new THREE.Vector3();
  private bodyMat: THREE.MeshStandardMaterial;
  private barMat: THREE.MeshStandardMaterial;
  private barGeo: THREE.BoxGeometry;
  private lightGeo: THREE.BoxGeometry;
  private stripeGeo: THREE.BoxGeometry;

  constructor(scene: THREE.Scene, track: TrackEnvironment, openWorld: OpenWorldMap) {
    this.scene = scene;
    this.track = track;
    this.openWorld = openWorld;
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.55,
      metalness: 0.25
    });
    this.barMat = new THREE.MeshStandardMaterial({ color: 0x0b1120, roughness: 0.5, metalness: 0.4 });
    // Every dispatched cruiser used to allocate fresh geometries. Share the
    // immutable shapes; CarMesh.dispose() honours userData.shared.
    this.barGeo = new THREE.BoxGeometry(1.05, 0.075, 0.26);
    this.lightGeo = new THREE.BoxGeometry(0.34, 0.11, 0.2);
    this.stripeGeo = new THREE.BoxGeometry(1.9, 0.34, 1.1);
    for (const res of [this.bodyMat, this.barMat, this.barGeo, this.lightGeo, this.stripeGeo]) {
      res.userData.shared = true;
    }
  }

  public get isActive(): boolean {
    return this.heat > 0 || this.units.length > 0;
  }

  public addHeat(amount: number, reason = '', crimePos?: THREE.Vector3): void {
    if (amount <= 0) return;
    const before = this.heat;
    this.heat = Math.min(5, this.heat + amount);
    this.crimeCooldown = 14;
    this.decayTimer = 0;
    this.spawnCooldown = Math.min(this.spawnCooldown, 0.8);
    if (crimePos) this.lastKnownPos.copy(crimePos);
    if (this.heat !== before) {
      this.onHooks.onHeatChanged(this.heat, reason || HEAT_LABELS[this.heat]);
    }
  }

  public clearHeat(escaped = false): void {
    const hadHeat = this.heat > 0;
    if (!hadHeat && this.units.length === 0) return;
    this.heat = 0;
    this.crimeCooldown = 0;
    this.decayTimer = 0;
    this.spawnCooldown = 0;
    this.isSpotted = false;
    this.setBustProgress(0);
    this.onHooks.onHeatChanged(0, HEAT_LABELS[0]);
    if (escaped && hadHeat) {
      this.onHooks.onEscaped();
    }
    this.despawnAll();
  }

  public despawnAll(): void {
    for (const unit of this.units) {
      this.scene.remove(unit.mesh.root);
      unit.mesh.dispose();
    }
    this.units = [];
    this.nearestDistance = 999;
  }

  /** Allows the player to steal a nearby stopped police cruiser cleanly without dual ownership. */
  public takeNearestUnit(
    pos: THREE.Vector3,
    maxRadius = 4.4
  ): { physics: CarPhysics; mesh: CarMesh; lightA: THREE.Mesh; lightB: THREE.Mesh } | null {
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      if (u.physics.speedKmh > 22) continue;
      const d = Math.hypot(u.physics.position.x - pos.x, u.physics.position.z - pos.z);
      if (d <= maxRadius) {
        this.units.splice(i, 1);
        this.setBustProgress(0);
        u.physics.onWallCollision = () => {};
        return { physics: u.physics, mesh: u.mesh, lightA: u.lightA, lightB: u.lightB };
      }
    }
    return null;
  }

  private setBustProgress(next: number): void {
    const clamped = Math.max(0, Math.min(1, next));
    if (Math.abs(clamped - this.bustProgress) > 0.005 || (clamped === 0 && this.bustProgress !== 0)) {
      this.bustProgress = clamped;
      this.onHooks.onBustProgress(clamped);
    }
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    playerInCar: boolean,
    playerCar: CarPhysics | null,
    playerIsDead = false
  ): void {
    if (this.spawnCooldown > 0) this.spawnCooldown -= dt;
    if (this.bustCooldown > 0) this.bustCooldown -= dt;

    let spottedNow = false;
    for (const unit of this.units) {
      const d = Math.hypot(playerPos.x - unit.physics.position.x, playerPos.z - unit.physics.position.z);
      const los = hasLineOfSight(
        unit.physics.position.x,
        unit.physics.position.z,
        playerPos.x,
        playerPos.z,
        this.openWorld.colliders
      );
      if (d < 95 && los) {
        spottedNow = true;
        unit.mode = 'PURSUING';
      } else {
        unit.mode = 'SEARCHING';
      }
    }
    if (spottedNow) {
      this.lastKnownPos.copy(playerPos);
    }
    this.isSpotted = spottedNow;

    if (this.crimeCooldown > 0) {
      this.crimeCooldown -= dt;
    } else if (this.heat > 0) {
      if (!spottedNow || this.nearestDistance > 65) {
        this.decayTimer += dt * (this.nearestDistance > 90 ? 1.35 : 1.0);
      } else {
        this.decayTimer = Math.max(0, this.decayTimer - dt * 2.0);
      }

      if (this.decayTimer > 6.5) {
        this.decayTimer = 0;
        if (this.heat <= 1) {
          this.clearHeat(true);
          return;
        }
        this.heat = Math.max(0, this.heat - 1);
        this.onHooks.onHeatChanged(this.heat, HEAT_LABELS[this.heat]);
      }
    }

    const targetUnits = Math.min(4, this.heat);
    if (this.heat > 0 && this.units.length < targetUnits && this.spawnCooldown <= 0) {
      this.spawnUnit(playerPos);
      this.spawnCooldown = 2.6;
    }

    this.nearestDistance = 999;
    let closestSlowCop = false;

    for (let i = this.units.length - 1; i >= 0; i--) {
      const unit = this.units[i];
      unit.age += dt;

      const dx = playerPos.x - unit.physics.position.x;
      const dz = playerPos.z - unit.physics.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < this.nearestDistance) this.nearestDistance = dist;

      if (dist > 340) {
        this.removeUnit(i);
        continue;
      }

      this.driveUnit(unit, dt, playerPos, dist, playerInCar, playerCar);

      if (
        !playerInCar &&
        !playerIsDead &&
        this.heat > 0 &&
        this.bustCooldown <= 0 &&
        dist < 6.8 &&
        unit.physics.speedKmh < 32 &&
        Math.abs(playerPos.y - unit.physics.position.y) < 3.0
      ) {
        closestSlowCop = true;
      }
    }

    if (closestSlowCop) {
      const next = this.bustProgress + dt * 0.52;
      if (next >= 1.0) {
        this.bustCooldown = 4;
        const fine = Math.min(2500, 250 + this.heat * 250);
        const heatAtBust = this.heat;
        this.clearHeat(false);
        this.onHooks.onBusted(fine, heatAtBust);
        return;
      }
      this.setBustProgress(next);
    } else if (this.bustProgress > 0) {
      this.setBustProgress(this.bustProgress - dt * 0.75);
    }
  }

  private spawnUnit(playerPos: THREE.Vector3): void {
    // Dispatched units home on lastKnownPos unless player is actively spotted
    const dispatchTarget = (this.isSpotted || this.lastKnownPos.lengthSq() < 1) ? playerPos : this.lastKnownPos;
    let best: [number, number] = SPAWN_POINTS[0];
    let bestScore = -Infinity;
    for (const p of SPAWN_POINTS) {
      const dTarget = Math.hypot(p[0] - dispatchTarget.x, p[1] - dispatchTarget.z);
      const dPlayer = Math.hypot(p[0] - playerPos.x, p[1] - playerPos.z);
      const overlapsUnit = this.units.some(
        (u) => Math.hypot(u.physics.position.x - p[0], u.physics.position.z - p[1]) < 9
      );
      const insideBuilding = this.openWorld.colliders.some(
        (c) => p[0] > c.minX - 2 && p[0] < c.maxX + 2 && p[1] > c.minZ - 2 && p[1] < c.maxZ + 2
      );
      let score = (dTarget > 50 && dTarget < 145 ? 100 : 0) - Math.abs(dTarget - 85);
      // Avoid magically popping in right next to a hidden player
      if (dPlayer < 52) score -= 240;
      if (overlapsUnit) score -= 500;
      if (insideBuilding) score -= 1000;
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    const heading = Math.atan2(-(dispatchTarget.x - best[0]), -(dispatchTarget.z - best[1]));
    const ground = this.track.sampleGround(best[0], best[1]);
    const rampH = this.openWorld.sampleRampHeight(best[0], best[1]);
    const spawn = new THREE.Vector3(best[0], Math.max(ground.height, rampH), best[1]);
    this.openWorld.resolveCollision(spawn, new THREE.Vector3(), 1.8);

    const physics = new CarPhysics();
    physics.enforceTrackWalls = false;
    physics.groundHeightSampler = (x, z) => {
      const g = this.track.sampleGround(x, z);
      const rH = this.openWorld.sampleRampHeight(x, z);
      return {
        ...g,
        height: Math.max(g.height, rH),
        isRoad: g.isRoad || this.openWorld.isInsideCityOrPlayground(x, z) || rH > 0
      };
    };
    physics.worldCollider = (pos, vel, rad) => this.openWorld.resolveCollision(pos, vel, rad);
    physics.resetToTrack(spawn, heading);
    physics.onWallCollision = (impact) => {
      if (impact > 24) this.onHooks.onImpact(impact, physics.position);
    };

    const mesh = new CarMesh();
    mesh.setColor('#e2e8f0');
    mesh.setHeadlights(true);
    this.scene.add(mesh.root);

    const barBase = new THREE.Mesh(this.barGeo, this.barMat);
    barBase.position.set(0, 1.0, 0.12);
    mesh.root.add(barBase);

    // Beacon materials stay per-unit: the player can steal a cruiser and
    // toggle its strobes without changing every other unit's lights.
    const lightA = new THREE.Mesh(this.lightGeo, new THREE.MeshBasicMaterial({ color: 0xff2a3c }));
    lightA.position.set(-0.24, 1.075, 0.12);
    const lightB = new THREE.Mesh(this.lightGeo, new THREE.MeshBasicMaterial({ color: 0x2563eb }));
    lightB.position.set(0.24, 1.075, 0.12);
    mesh.root.add(lightA, lightB);

    const stripe = new THREE.Mesh(this.stripeGeo, this.bodyMat);
    stripe.position.set(0, 0.56, 0.0);
    mesh.root.add(stripe);

    if (this.lastKnownPos.lengthSq() < 1) {
      this.lastKnownPos.copy(playerPos);
    }
    const spawnLOS = hasLineOfSight(spawn.x, spawn.z, playerPos.x, playerPos.z, this.openWorld.colliders)
      && Math.hypot(spawn.x - playerPos.x, spawn.z - playerPos.z) < 95;
    this.units.push({
      physics,
      mesh,
      lightA,
      lightB,
      sirenPhase: Math.random() * Math.PI * 2,
      stuckTimer: 0,
      reverseTimer: 0,
      age: 0,
      mode: spawnLOS ? 'PURSUING' : 'SEARCHING'
    });
  }

  private driveUnit(
    unit: PoliceUnit,
    dt: number,
    playerPos: THREE.Vector3,
    dist: number,
    playerInCar: boolean,
    playerCar: CarPhysics | null
  ): void {
    const fwd = unit.physics.getForwardVector();
    const rgt = unit.physics.getRightVector();

    const goalPos = unit.mode === 'PURSUING' ? playerPos : this.lastKnownPos;
    const goalDist = Math.hypot(goalPos.x - unit.physics.position.x, goalPos.z - unit.physics.position.z);
    const hasLOS = hasLineOfSight(
      unit.physics.position.x,
      unit.physics.position.z,
      goalPos.x,
      goalPos.z,
      this.openWorld.colliders,
      1.6
    );

    const steerTarget = hasLOS || goalDist < 18
      ? goalPos
      : this.roadGraph.findNextWaypoint(unit.physics.position, goalPos, this.navScratch);

    const toTarget = this.scratch.set(
      steerTarget.x - unit.physics.position.x,
      0,
      steerTarget.z - unit.physics.position.z
    );
    const targetDist = toTarget.length();
    if (targetDist > 0.001) toTarget.divideScalar(targetDist);

    const steerDot = toTarget.x * rgt.x + toTarget.z * rgt.z;
    let steer = THREE.MathUtils.clamp(steerDot * 2.4, -1, 1);

    let throttle = 0;
    let brake = 0;

    if (unit.reverseTimer > 0) {
      unit.reverseTimer -= dt;
      throttle = 0;
      brake = 0.72;
      steer = -steer;
    } else {
      const tooClose = playerInCar ? dist < 6.5 : dist < 6.0;
      const targetSpeed = tooClose ? 0 : (hasLOS ? (dist > 40 ? 148 : 96) : 78);

      if (unit.physics.speedKmh < targetSpeed - 6) {
        throttle = dist > 60 ? 1.0 : 0.84;
      } else if (unit.physics.speedKmh > targetSpeed + 10) {
        brake = unit.physics.speedKmh > 12 ? 0.7 : 0;
      }

      if (!playerInCar && dist < 14 && hasLOS) {
        if (dist > 5.2) {
          throttle = unit.physics.speedKmh < 20 ? 0.34 : 0;
          brake = unit.physics.speedKmh > 30 ? 0.6 : 0;
        } else {
          throttle = 0;
          brake = unit.physics.speedKmh > 6 ? 0.45 : 0;
        }
      }

      if (unit.physics.speedKmh < 3.5 && throttle > 0.2) {
        unit.stuckTimer += dt;
      } else {
        unit.stuckTimer = Math.max(0, unit.stuckTimer - dt * 2);
      }
      if (unit.stuckTimer > 1.6) {
        unit.stuckTimer = 0;
        unit.reverseTimer = 1.1;
      }
    }

    if (playerInCar && playerCar && dist < 8) {
      const closing = (playerCar.velocity.x - unit.physics.velocity.x) * fwd.x
        + (playerCar.velocity.z - unit.physics.velocity.z) * fwd.z;
      if (closing > 8) brake = 0.9;
    }

    unit.physics.update(dt, {
      throttle,
      brake,
      steer,
      handbrake: false,
      clutch: false,
      shiftUp: false,
      shiftDown: false,
      reset: false
    }, true);

    unit.mesh.update(unit.physics, brake, dt);

    unit.sirenPhase += dt * 9.0;
    const red = Math.sin(unit.sirenPhase) > 0;
    (unit.lightA.material as THREE.MeshBasicMaterial).color.setHex(red ? 0xff2a3c : 0x3b0a0f);
    (unit.lightB.material as THREE.MeshBasicMaterial).color.setHex(red ? 0x1e3a8a : 0x3b82f6);
  }

  private removeUnit(index: number): void {
    const unit = this.units[index];
    if (!unit) return;
    this.scene.remove(unit.mesh.root);
    unit.mesh.dispose();
    this.units.splice(index, 1);
  }
}
