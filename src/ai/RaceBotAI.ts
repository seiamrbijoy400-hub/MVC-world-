import * as THREE from 'three';
import { CarPhysics, CarInputs } from '../physics/CarPhysics';
import { CarMesh } from '../graphics/CarMesh';
import { TrackEnvironment } from '../graphics/TrackEnvironment';
import { OpenWorldMap } from '../graphics/OpenWorldMap';
import { HumanCharacterMesh } from '../graphics/HumanCharacterMesh';
import { CharacterController } from '../physics/CharacterController';
import type { BotDifficulty, CharacterId } from '../network/LobbyProtocol';

export class RaceBot {
  public id: string;
  public name: string;
  public physics: CarPhysics;
  public mesh: CarMesh;
  public difficulty: BotDifficulty;
  private track: TrackEnvironment;
  public currentWaypoint = 0;
  public lapCount = 1;
  private hasClearedMidLap = false;
  private laneOffset: number;
  private stuckTimer = 0;

  constructor(
    id: string,
    name: string,
    color: string,
    difficulty: BotDifficulty,
    track: TrackEnvironment,
    openWorld: OpenWorldMap,
    spawnIdx: number,
    scene: THREE.Scene
  ) {
    this.id = id;
    this.name = name;
    this.difficulty = difficulty;
    this.track = track;
    this.laneOffset = (spawnIdx % 2 === 0 ? -1 : 1) * (2.6 + (spawnIdx % 3) * 1.1);

    this.physics = new CarPhysics();
    this.physics.enforceTrackWalls = true;
    this.physics.trackMaxHalfWidth = track.wallOffset;
    this.physics.groundHeightSampler = (x, z) => track.sampleGround(x, z);
    this.physics.worldCollider = (pos, vel, rad) => openWorld.resolveCollision(pos, vel, rad);

    // Spawn staggered behind start gantry
    const startPt = new THREE.Vector3(spawnIdx % 2 === 0 ? -3.2 : 3.2, 0, 5 + spawnIdx * 5.2);
    this.physics.resetToTrack(startPt, 0);

    // Initialize currentWaypoint accurately behind start line without falsely tripping lap 2
    const pts = this.track.trackPoints;
    const total = pts.length - 1;
    let bestD = Infinity;
    for (let i = 0; i < total; i++) {
      const d = Math.hypot(pts[i].x - startPt.x, pts[i].z - startPt.z);
      if (d < bestD) {
        bestD = d;
        this.currentWaypoint = i;
      }
    }

    this.mesh = new CarMesh();
    this.mesh.setColor(color);
    scene.add(this.mesh.root);
  }

  /** Normalized lap progress for race ranking (counts pre-start grid cleanly as < lap 1 start) */
  public getRaceProgress(): number {
    const total = this.track.trackPoints.length - 1;
    const effectiveLap = !this.hasClearedMidLap && this.currentWaypoint > total * 0.8
      ? this.lapCount - 1
      : this.lapCount;
    return effectiveLap * total + this.currentWaypoint;
  }

  public update(dt: number, canDrive: boolean, otherCars: THREE.Vector3[], playerProgress?: number): void {
    const pts = this.track.trackPoints;
    const total = pts.length - 1;

    const prevWp = this.currentWaypoint;
    let bestDist = Infinity;
    for (let offset = -12; offset <= 24; offset++) {
      const idx = (prevWp + offset + total) % total;
      const d = Math.hypot(pts[idx].x - this.physics.position.x, pts[idx].z - this.physics.position.z);
      if (d < bestDist) {
        bestDist = d;
        this.currentWaypoint = idx;
      }
    }

    if (this.currentWaypoint > total * 0.2 && this.currentWaypoint < total * 0.8) {
      this.hasClearedMidLap = true;
    }
    if (this.hasClearedMidLap && prevWp > total * 0.85 && this.currentWaypoint < total * 0.15) {
      this.lapCount++;
      this.hasClearedMidLap = false;
    }

    const speed = this.physics.speedKmh;
    const lookSteps = Math.max(8, Math.min(26, Math.round(speed * 0.12)));
    const targetIdx = (this.currentWaypoint + lookSteps) % total;
    const farIdx = (this.currentWaypoint + lookSteps + 14) % total;

    const tangent = this.track.trackTangents[targetIdx];
    const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
    const targetPos = pts[targetIdx].clone().addScaledVector(right, this.laneOffset);

    const toTarget = targetPos.sub(this.physics.position);
    toTarget.y = 0;
    toTarget.normalize();

    const fwd = this.physics.getForwardVector();
    const rgt = this.physics.getRightVector();
    const steerDot = toTarget.x * rgt.x + toTarget.z * rgt.z;

    let steer = THREE.MathUtils.clamp(steerDot * 2.3, -1, 1);
    let trafficBrake = 0;

    // Smart lane-aware overtaking & braking radar
    const reactionDist = 6.5 + speed * 0.05;
    for (const other of otherCars) {
      if (other === this.physics.position) continue;
      const d = other.distanceTo(this.physics.position);
      if (d < reactionDist) {
        const toOther = other.clone().sub(this.physics.position);
        const forwardProj = toOther.dot(fwd);
        const sideProj = toOther.dot(rgt);
        if (forwardProj > 0.5 && Math.abs(sideProj) < 3.6) {
          steer += sideProj >= 0 ? -0.58 : 0.58;
          if (forwardProj < 6.5 && Math.abs(sideProj) < 1.9) {
            trafficBrake = Math.max(trafficBrake, 0.65);
          }
        }
      }
    }
    steer = THREE.MathUtils.clamp(steer, -1, 1);

    // Curvature braking + gentle rubber-banding for pack closeness
    const curveAlign = tangent.dot(this.track.trackTangents[farIdx]);
    let diffScale = this.difficulty === 'CHILL' ? 0.68 : (this.difficulty === 'PRO' ? 0.87 : 0.99);
    if (playerProgress !== undefined) {
      const gap = this.getRaceProgress() - playerProgress;
      if (gap > 32) diffScale *= 0.91;
      else if (gap < -32) diffScale = Math.min(1.04, diffScale * 1.07);
    }

    const cornerMaxSpeed = (curveAlign < 0.85 ? 78 : (curveAlign < 0.94 ? 135 : 285)) * diffScale;

    let throttle = speed < cornerMaxSpeed && trafficBrake === 0 ? Math.min(1, diffScale) : 0;
    let brake = Math.max(trafficBrake, speed > cornerMaxSpeed + 18 ? 0.85 : 0);

    // Unstuck reverse check
    if (canDrive && speed < 3) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 2.4) {
        throttle = 0;
        brake = 1.0;
        steer = -steer;
        if (this.stuckTimer > 3.6) this.stuckTimer = 0;
      }
    } else {
      this.stuckTimer = 0;
    }

    const inputs: CarInputs = {
      throttle,
      brake,
      steer,
      handbrake: false,
      clutch: false,
      shiftUp: false,
      shiftDown: false,
      reset: false
    };

    this.physics.update(dt, inputs, canDrive);
    this.mesh.update(this.physics, brake, dt);
  }

  public dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh.root);
  }
}

/** Friendly Open-World City Traffic Bot: obeys lanes, yields to pedestrians, & waves/challenges on horn! */
export class CityCruiserBot {
  public id: string;
  public name: string;
  public physics: CarPhysics;
  public mesh: CarMesh;
  private route: THREE.Vector3[];
  private wpIndex = 0;
  private emojiSprite: THREE.Sprite;
  private emojiTimer = 0;
  private friendlyCooldown = 0;
  private challengeTimer = 0;

  constructor(
    id: string,
    name: string,
    color: string,
    route: THREE.Vector3[],
    startWpIndex: number,
    openWorld: OpenWorldMap,
    track: TrackEnvironment,
    scene: THREE.Scene
  ) {
    this.id = id;
    this.name = name;
    this.route = route;
    this.wpIndex = startWpIndex % route.length;

    this.physics = new CarPhysics();
    this.physics.enforceTrackWalls = false;
    this.physics.groundHeightSampler = (x, z) => {
      const g = track.sampleGround(x, z);
      return { ...g, isRoad: g.isRoad || openWorld.isInsideCityOrPlayground(x, z) };
    };
    this.physics.worldCollider = (pos, vel, rad) => openWorld.resolveCollision(pos, vel, rad);

    const start = this.route[this.wpIndex];
    const next = this.route[(this.wpIndex + 1) % this.route.length];
    const heading = Math.atan2(-(next.x - start.x), -(next.z - start.z));
    this.physics.resetToTrack(start, heading);

    this.mesh = new CarMesh();
    this.mesh.setColor(color);
    scene.add(this.mesh.root);

    this.emojiSprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ transparent: true, depthTest: false })
    );
    this.emojiSprite.position.set(0, 2.35, 0);
    this.emojiSprite.scale.set(1.3, 1.3, 1);
    this.emojiSprite.visible = false;
    this.mesh.root.add(this.emojiSprite);
  }

  public showReaction(emoji: string): void {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(9, 13, 22, 0.82)';
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 4;
    ctx.stroke();
    ctx.font = '62px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 68);

    const mat = this.emojiSprite.material as THREE.SpriteMaterial;
    mat.map = new THREE.CanvasTexture(c);
    mat.needsUpdate = true;
    this.emojiSprite.visible = true;
    this.emojiTimer = 2.6;
  }

  public startFriendlySprint(): void {
    this.challengeTimer = 14.0;
    this.showReaction('🏁');
  }

  public update(
    dt: number,
    playerCarPos: THREE.Vector3,
    playerFootPos: THREE.Vector3 | null,
    otherTraffic: THREE.Vector3[]
  ): void {
    if (this.friendlyCooldown > 0) this.friendlyCooldown -= dt;
    if (this.challengeTimer > 0) this.challengeTimer -= dt;
    if (this.emojiTimer > 0) {
      this.emojiTimer -= dt;
      this.emojiSprite.position.y = 2.35 + Math.sin(this.emojiTimer * 6) * 0.12;
      if (this.emojiTimer <= 0) this.emojiSprite.visible = false;
    }

    // Friendly wave when player pulls alongside in city
    const playerRef = playerFootPos || playerCarPos;
    if (this.friendlyCooldown <= 0 && this.physics.position.distanceTo(playerRef) < 9.5) {
      const icons = ['👋', '🔥', '😎', '💨'];
      this.showReaction(icons[Math.floor(Math.random() * icons.length)]);
      this.friendlyCooldown = 9.0;
    }

    const wp = this.route[this.wpIndex];
    if (Math.hypot(wp.x - this.physics.position.x, wp.z - this.physics.position.z) < 9.5) {
      this.wpIndex = (this.wpIndex + 1) % this.route.length;
    }

    const target = this.route[this.wpIndex];
    const toTarget = target.clone().sub(this.physics.position);
    toTarget.y = 0;
    toTarget.normalize();

    const fwd = this.physics.getForwardVector();
    const rgt = this.physics.getRightVector();
    let steer = THREE.MathUtils.clamp(toTarget.dot(rgt) * 2.1, -1, 1);

    // Yield gracefully for on-foot pedestrians and nearby cars
    let mustYield = false;
    let slowDown = false;
    const actors: { pos: THREE.Vector3; isFoot: boolean }[] = [
      { pos: playerCarPos, isFoot: false },
      ...(playerFootPos ? [{ pos: playerFootPos, isFoot: true }] : []),
      ...otherTraffic.filter(p => p !== this.physics.position).map(pos => ({ pos, isFoot: false }))
    ];

    for (const a of actors) {
      const d = a.pos.distanceTo(this.physics.position);
      const safeRange = a.isFoot ? 15.0 : 12.0;
      if (d < safeRange) {
        const toA = a.pos.clone().sub(this.physics.position);
        const fProj = toA.dot(fwd);
        const sProj = toA.dot(rgt);
        if (fProj > 0 && Math.abs(sProj) < (a.isFoot ? 3.5 : 2.8)) {
          if (fProj < (a.isFoot ? 11.5 : 8.0)) mustYield = true;
          else slowDown = true;
          if (!a.isFoot) steer += sProj >= 0 ? -0.35 : 0.35;
        }
      }
    }

    steer = THREE.MathUtils.clamp(steer, -1, 1);
    const targetSpeedKmh = this.challengeTimer > 0 ? 118 : (slowDown ? 26 : 52);
    const speed = this.physics.speedKmh;

    let throttle = 0;
    let brake = 0;
    if (mustYield) {
      throttle = 0;
      brake = speed > 2 ? 0.9 : 0.4;
    } else if (speed < targetSpeedKmh) {
      throttle = this.challengeTimer > 0 ? 0.92 : 0.48;
    } else if (speed > targetSpeedKmh + 8) {
      brake = 0.55;
    }

    this.physics.update(dt, {
      throttle,
      brake,
      steer,
      handbrake: false,
      clutch: false,
      shiftUp: false,
      shiftDown: false,
      reset: false
    }, true);
    this.mesh.update(this.physics, brake, dt);
  }
}

export class SparringFighter {
  public controller: CharacterController;
  public mesh: HumanCharacterMesh;
  public readonly name: string;
  public onKilled: (fighter: SparringFighter) => void = () => {};
  private homePos: THREE.Vector3;
  private wanderTarget: THREE.Vector3;
  private timer = 0;

  constructor(
    name: string,
    charId: CharacterId,
    pos: THREE.Vector3,
    scene: THREE.Scene
  ) {
    this.name = name;
    this.homePos = pos.clone();
    this.wanderTarget = pos.clone();
    this.controller = new CharacterController();
    this.controller.resetAt(pos, 0);
    // Fighters stay down for a long time so a knockout actually reads as a kill,
    // then walk back into the plaza as a fresh opponent.
    this.controller.respawnDelay = 24;
    this.controller.respawnPoint = pos.clone();
    this.controller.onDeath = () => this.onKilled(this);
    this.controller.onRespawn = (spawn) => {
      this.mesh.root.rotation.x = 0;
      this.mesh.root.position.copy(spawn);
      this.mesh.setNameAndHp(this.name, this.controller.maxHp);
    };

    this.mesh = new HumanCharacterMesh(charId, name);
    this.mesh.root.position.copy(pos);
    scene.add(this.mesh.root);
  }

  public get isDead(): boolean {
    return this.controller.isDead;
  }

  public update(dt: number, playerPos: THREE.Vector3, playerOnFoot: boolean): void {
    if (this.controller.isDead) {
      this.controller.update(dt, { moveX: 0, moveY: 0, sprint: false, jump: false, punch: false }, 0);
      this.mesh.root.position.copy(this.controller.position);
      this.mesh.root.rotation.y = this.controller.yaw;
      this.mesh.updateAnimation(dt, 'KO');
      this.mesh.setNameAndHp(this.name, 0);
      return;
    }

    this.timer -= dt;
    const distToPlayer = this.controller.position.distanceTo(playerPos);

    let moveX = 0;
    let moveY = 0;
    let sprint = false;
    let punch = false;

    if (playerOnFoot && distToPlayer < 12 && this.controller.hp > 0) {
      const dx = playerPos.x - this.controller.position.x;
      const dz = playerPos.z - this.controller.position.z;
      const len = Math.hypot(dx, dz) || 1;
      if (distToPlayer > 1.75) {
        moveX = dx / len;
        moveY = -dz / len;
        sprint = distToPlayer > 5;
      } else if (this.timer <= 0) {
        punch = true;
        this.timer = 1.4;
      }
    } else {
      if (this.timer <= 0) {
        this.timer = 3 + Math.random() * 3;
        this.wanderTarget.set(
          this.homePos.x + (Math.random() - 0.5) * 14,
          0,
          this.homePos.z + (Math.random() - 0.5) * 14
        );
      }
      const dx = this.wanderTarget.x - this.controller.position.x;
      const dz = this.wanderTarget.z - this.controller.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 1.2) {
        moveX = dx / d;
        moveY = -dz / d;
      }
    }

    this.controller.update(dt, { moveX, moveY, sprint, jump: false, punch }, 0);
    this.mesh.root.position.copy(this.controller.position);
    this.mesh.root.rotation.y = this.controller.yaw;
    this.mesh.updateAnimation(dt, this.controller.animState);
    this.mesh.setNameAndHp(this.name, this.controller.hp);
  }
}
