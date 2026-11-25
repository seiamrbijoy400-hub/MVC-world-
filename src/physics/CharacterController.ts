import * as THREE from 'three';
import type { CharAnimState } from '../network/LobbyProtocol';

export interface CharacterInputs {
  moveX: number;     // -1 left, +1 right
  moveY: number;     // +1 forward, -1 backward
  sprint: boolean;
  jump: boolean;
  punch: boolean;
}

export class CharacterController {
  public position = new THREE.Vector3(-2.0, 0, 2.0);
  public velocity = new THREE.Vector3();
  public yaw = 0; // facing angle in radians (-Z when 0)
  public hp = 100;
  public maxHp = 100;

  public isGrounded = true;
  public animState: CharAnimState = 'IDLE';

  private punchTimer = 0;
  private punchCooldown = 0;
  private koTimer = 0;
  private wasJump = false;
  private wasPunch = false;

  public groundHeightSampler: (x: number, z: number) => number = () => 0;
  public worldCollider: (pos: THREE.Vector3, vel: THREE.Vector3, radius: number) => boolean = () => false;
  public onPunchStrike: (origin: THREE.Vector3, forward: THREE.Vector3) => void = () => {};

  public resetAt(pos: THREE.Vector3, yaw = 0): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.hp = this.maxHp;
    this.koTimer = 0;
    this.punchTimer = 0;
    this.animState = 'IDLE';
  }

  public takeDamage(damage: number, dirX: number, dirZ: number): void {
    if (this.koTimer > 0) return;
    this.hp = Math.max(0, this.hp - damage);
    this.velocity.x += dirX * 9.5;
    this.velocity.z += dirZ * 9.5;
    this.velocity.y = 4.2;
    this.isGrounded = false;
    if (this.hp <= 0) {
      this.koTimer = 2.8;
      this.animState = 'KO';
    }
  }

  public getForwardVector(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  public update(dt: number, inputs: CharacterInputs, cameraYaw: number): void {
    dt = Math.min(dt, 0.04);

    if (this.punchCooldown > 0) this.punchCooldown -= dt;
    if (this.punchTimer > 0) this.punchTimer -= dt;

    if (this.koTimer > 0) {
      this.koTimer -= dt;
      this.velocity.y -= 22 * dt;
      this.position.addScaledVector(this.velocity, dt);
      const gy = this.groundHeightSampler(this.position.x, this.position.z);
      if (this.position.y <= gy) {
        this.position.y = gy;
        this.velocity.y = 0;
        this.velocity.x *= 0.85;
        this.velocity.z *= 0.85;
      }
      this.worldCollider(this.position, this.velocity, 0.45);
      this.animState = 'KO';
      if (this.koTimer <= 0) {
        this.hp = this.maxHp;
      }
      return;
    }

    // Trigger Punch (edge-triggered)
    const punchTrig = inputs.punch && !this.wasPunch;
    this.wasPunch = inputs.punch;
    if (punchTrig && this.punchCooldown <= 0 && this.isGrounded) {
      this.punchTimer = 0.34;
      this.punchCooldown = 0.42;
      const fwd = this.getForwardVector();
      this.velocity.x += fwd.x * 3.5;
      this.velocity.z += fwd.z * 3.5;
      this.onPunchStrike(this.position.clone(), fwd);
    }

    // Camera-Relative Direction
    const camFwdX = -Math.sin(cameraYaw);
    const camFwdZ = -Math.cos(cameraYaw);
    const camRgtX = Math.cos(cameraYaw);
    const camRgtZ = -Math.sin(cameraYaw);

    let wishX = camFwdX * inputs.moveY + camRgtX * inputs.moveX;
    let wishZ = camFwdZ * inputs.moveY + camRgtZ * inputs.moveX;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.01) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    const moveMag = Math.min(1, Math.hypot(inputs.moveX, inputs.moveY));
    const maxSpeed = inputs.sprint ? 9.6 : 4.8;
    const targetVx = wishX * maxSpeed * moveMag;
    const targetVz = wishZ * maxSpeed * moveMag;

    const accel = this.isGrounded ? 15 : 6;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, targetVx, accel, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, targetVz, accel, dt);

    // Smoothly turn anime character toward running direction
    if (moveMag > 0.1) {
      const targetYaw = Math.atan2(-wishX, -wishZ);
      let diff = targetYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, 12 * dt);
    }

    // Jump
    const jumpTrig = inputs.jump && !this.wasJump;
    this.wasJump = inputs.jump;
    if (jumpTrig && this.isGrounded) {
      this.velocity.y = 8.8;
      this.isGrounded = false;
    }

    // Gravity
    this.velocity.y -= 22.0 * dt;
    this.position.addScaledVector(this.velocity, dt);

    // Solid City Buildings & World Zone Clamp
    this.worldCollider(this.position, this.velocity, 0.45);

    // Ground & Ramp Height Snap
    const groundY = this.groundHeightSampler(this.position.x, this.position.z);
    if (this.position.y <= groundY + 0.08 && this.velocity.y <= 0.5) {
      this.position.y = groundY;
      this.velocity.y = 0;
      this.isGrounded = true;
    } else if (this.position.y > groundY + 0.12) {
      this.isGrounded = false;
    }

    // Determine Animation State
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.punchTimer > 0) {
      this.animState = 'PUNCH';
    } else if (!this.isGrounded) {
      this.animState = 'JUMP';
    } else if (horizSpeed > 6.2) {
      this.animState = 'RUN';
    } else if (horizSpeed > 0.6) {
      this.animState = 'WALK';
    } else {
      this.animState = 'IDLE';
    }
  }
}
