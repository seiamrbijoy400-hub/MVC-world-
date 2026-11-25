import * as THREE from 'three';
import { CarPhysics } from '../physics/CarPhysics';
import { CarMesh } from '../graphics/CarMesh';
import { TrackEnvironment } from '../graphics/TrackEnvironment';
import { OpenWorldMap } from '../graphics/OpenWorldMap';

export interface PoliceHooks {
  /** Fired whenever the wanted level changes. */
  onHeatChanged: (level: number, label: string) => void;
  /** Player was caught on foot — pay the fine and get hauled to the station. */
  onBusted: (fine: number, heat: number) => void;
  /** A police cruiser slammed into something. */
  onImpact: (impactKmh: number, pos: THREE.Vector3) => void;
}

interface PoliceUnit {
  physics: CarPhysics;
  mesh: CarMesh;
  lightA: THREE.Mesh;
  lightB: THREE.Mesh;
  sirenPhase: number;
  stuckTimer: number;
  reverseTimer: number;
  age: number;
}

const HEAT_LABELS = ['CLEAN', 'SUSPECT', 'WANTED', 'HIGH RISK', 'MOST WANTED', 'CITY LOCKDOWN'];

/** Safe road-side spawn points around the city loops. */
const SPAWN_POINTS: Array<[number, number]> = [
  [46, -160], [110, -160], [180, -160], [224, -160],
  [224, -90], [224, 30], [224, 150],
  [160, 150], [90, 150], [46, 150],
  [46, 80], [46, 10], [46, -40], [46, -95],
  [84, -40], [122, -40], [122, 0], [122, 30], [84, 30]
];

export class PoliceSystem {
  public heat = 0;
  public units: PoliceUnit[] = [];
  public nearestDistance = 999;
  public onHooks: PoliceHooks = {
    onHeatChanged: () => {},
    onBusted: () => {},
    onImpact: () => {}
  };

  private scene: THREE.Scene;
  private track: TrackEnvironment;
  private openWorld: OpenWorldMap;

  private spawnCooldown = 0;
  private crimeCooldown = 0;
  private decayTimer = 0;
  private bustCooldown = 0;
  private scratch = new THREE.Vector3();
  private bodyMat: THREE.MeshStandardMaterial;

  constructor(scene: THREE.Scene, track: TrackEnvironment, openWorld: OpenWorldMap) {
    this.scene = scene;
    this.track = track;
    this.openWorld = openWorld;
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.55,
      metalness: 0.25
    });
  }

  public get isActive(): boolean {
    return this.heat > 0 || this.units.length > 0;
  }

  public addHeat(amount: number, reason = ''): void {
    if (amount <= 0) return;
    const before = this.heat;
    this.heat = Math.min(5, this.heat + amount);
    this.crimeCooldown = 18;
    this.decayTimer = 0;
    this.spawnCooldown = Math.min(this.spawnCooldown, 0.8);
    if (this.heat !== before) {
      this.onHooks.onHeatChanged(this.heat, reason || HEAT_LABELS[this.heat]);
    }
  }

  public clearHeat(): void {
    if (this.heat === 0 && this.units.length === 0) return;
    this.heat = 0;
    this.crimeCooldown = 0;
    this.decayTimer = 0;
    this.onHooks.onHeatChanged(0, HEAT_LABELS[0]);
    this.despawnAll();
  }

  public despawnAll(): void {
    for (const unit of this.units) {
      this.scene.remove(unit.mesh.root);
    }
    this.units = [];
    this.nearestDistance = 999;
  }

  public update(
    dt: number,
    playerPos: THREE.Vector3,
    playerInCar: boolean,
    playerCar: CarPhysics | null
  ): void {
    if (this.spawnCooldown > 0) this.spawnCooldown -= dt;
    if (this.bustCooldown > 0) this.bustCooldown -= dt;

    // Heat decay: lay low, away from every cruiser, and the city forgets you.
    if (this.crimeCooldown > 0) {
      this.crimeCooldown -= dt;
    } else if (this.heat > 0) {
      if (this.nearestDistance > 55) this.decayTimer += dt;
      else this.decayTimer = Math.max(0, this.decayTimer - dt * 2);

      if (this.decayTimer > 7) {
        this.decayTimer = 0;
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
    let bustedThisFrame = false;

    for (let i = this.units.length - 1; i >= 0; i--) {
      const unit = this.units[i];
      unit.age += dt;

      const dx = playerPos.x - unit.physics.position.x;
      const dz = playerPos.z - unit.physics.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < this.nearestDistance) this.nearestDistance = dist;

      // Lost the player completely? The unit retires and heat will decay.
      if (dist > 340) {
        this.removeUnit(i);
        continue;
      }

      this.driveUnit(unit, dt, playerPos, dist, playerInCar, playerCar);

      // On-foot arrest check: cruiser has to be close and slow.
      if (
        !playerInCar &&
        !bustedThisFrame &&
        this.heat > 0 &&
        this.bustCooldown <= 0 &&
        dist < 6.5 &&
        unit.physics.speedKmh < 34
      ) {
        bustedThisFrame = true;
        this.bustCooldown = 4;
        const fine = Math.min(2500, 250 + this.heat * 250);
        const heatAtBust = this.heat;
        this.clearHeat();
        this.onHooks.onBusted(fine, heatAtBust);
        return;
      }
    }
  }

  private spawnUnit(playerPos: THREE.Vector3): void {
    // Pick the safest ring point far enough away to not teleport on top of the player.
    let best: [number, number] = SPAWN_POINTS[0];
    let bestScore = -Infinity;
    for (const p of SPAWN_POINTS) {
      const d = Math.hypot(p[0] - playerPos.x, p[1] - playerPos.z);
      const score = (d > 55 && d < 140 ? 100 : 0) - Math.abs(d - 85);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    const heading = Math.atan2(-(playerPos.x - best[0]), -(playerPos.z - best[1]));
    const ground = this.track.sampleGround(best[0], best[1]);
    const spawn = new THREE.Vector3(best[0], ground.height, best[1]);

    const physics = new CarPhysics();
    physics.enforceTrackWalls = false;
    physics.groundHeightSampler = (x, z) => {
      const g = this.track.sampleGround(x, z);
      return { ...g, isRoad: g.isRoad || this.openWorld.isInsideCityOrPlayground(x, z) };
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

    // Roof light bar
    const barBase = new THREE.Mesh(
      new THREE.BoxGeometry(1.05, 0.075, 0.26),
      new THREE.MeshStandardMaterial({ color: 0x0b1120, roughness: 0.5, metalness: 0.4 })
    );
    barBase.position.set(0, 1.0, 0.12);
    mesh.root.add(barBase);

    const lightGeo = new THREE.BoxGeometry(0.34, 0.11, 0.2);
    const lightA = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0xff2a3c }));
    lightA.position.set(-0.24, 1.075, 0.12);
    const lightB = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: 0x2563eb }));
    lightB.position.set(0.24, 1.075, 0.12);
    mesh.root.add(lightA, lightB);

    // Black/white livery stripe
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(1.9, 0.34, 1.1),
      this.bodyMat
    );
    stripe.position.set(0, 0.56, 0.0);
    mesh.root.add(stripe);

    this.units.push({
      physics,
      mesh,
      lightA,
      lightB,
      sirenPhase: Math.random() * Math.PI * 2,
      stuckTimer: 0,
      reverseTimer: 0,
      age: 0
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

    // Aim at the player, with a tiny pursuit offset so units don't stack perfectly.
    const toPlayer = this.scratch.set(
      playerPos.x - unit.physics.position.x,
      0,
      playerPos.z - unit.physics.position.z
    );
    if (dist > 0.001) toPlayer.divideScalar(dist);

    const steerDot = toPlayer.x * rgt.x + toPlayer.z * rgt.z;
    let steer = THREE.MathUtils.clamp(steerDot * 2.6, -1, 1);

    let throttle = 0;
    let brake = 0;

    if (unit.reverseTimer > 0) {
      unit.reverseTimer -= dt;
      throttle = 0.55;
      brake = 0;
      steer = -steer;
    } else {
      const tooClose = playerInCar ? dist < 6.5 : dist < 7.5;
      const targetSpeed = tooClose ? 0 : (dist > 40 ? 145 : 95);

      if (unit.physics.speedKmh < targetSpeed - 6) {
        throttle = dist > 60 ? 1.0 : 0.82;
      } else if (unit.physics.speedKmh > targetSpeed + 10) {
        // Only brake while actually moving: a held brake at a standstill would
        // make the automatic gearbox drop into reverse.
        brake = unit.physics.speedKmh > 12 ? 0.7 : 0;
      }

      if (!playerInCar && dist < 14) {
        // Creep up to arrest range, then hold the car still instead of running the player over.
        if (dist > 6) {
          throttle = unit.physics.speedKmh < 20 ? 0.34 : 0;
          brake = unit.physics.speedKmh > 30 ? 0.6 : 0;
        } else {
          throttle = 0;
          brake = unit.physics.speedKmh > 6 ? 0.45 : 0;
        }
      }

      // Stuck on a wall / traffic: reverse out with opposite lock.
      if (unit.physics.speedKmh < 3 && throttle > 0.2) {
        unit.stuckTimer += dt;
      } else {
        unit.stuckTimer = Math.max(0, unit.stuckTimer - dt * 2);
      }
      if (unit.stuckTimer > 1.8) {
        unit.stuckTimer = 0;
        unit.reverseTimer = 1.15;
      }
    }

    // Small push-away if the player car is directly in front, avoids endless gridlock.
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

    // Flashing red / blue bar
    unit.sirenPhase += dt * 9.0;
    const red = Math.sin(unit.sirenPhase) > 0;
    (unit.lightA.material as THREE.MeshBasicMaterial).color.setHex(red ? 0xff2a3c : 0x3b0a0f);
    (unit.lightB.material as THREE.MeshBasicMaterial).color.setHex(red ? 0x1e3a8a : 0x3b82f6);
  }

  private removeUnit(index: number): void {
    const unit = this.units[index];
    if (!unit) return;
    this.scene.remove(unit.mesh.root);
    this.units.splice(index, 1);
  }
}
