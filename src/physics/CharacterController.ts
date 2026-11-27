import * as THREE from 'three';
import type { CharAnimState } from '../network/LobbyProtocol';

export interface CharacterInputs {
  moveX: number;     // -1 left, +1 right
  moveY: number;     // +1 forward, -1 backward
  sprint: boolean;
  jump: boolean;
  punch: boolean;
  /** Optional dodge-dash roll / parkour burst. */
  dash?: boolean;
  /** Edge-triggered context action (sit/stand, enter building). */
  interact?: boolean;
}

export class CharacterController {
  public position = new THREE.Vector3(-2.0, 0, 2.0);
  public velocity = new THREE.Vector3();
  public yaw = 0; // facing angle in radians (-Z when 0)
  public hp = 100;
  public maxHp = 100;
  public stamina = 100;
  public maxStamina = 100;

  public isGrounded = true;
  public isSwimming = false;
  public isDashing = false;
  public isGliding = false;
  public animState: CharAnimState = 'IDLE';

  /** 0 = Right Cross, 1 = Left Jab, 2 = Power Uppercut. */
  public comboStep = 0;
  /** Active consumable buffs in seconds (Ramen / Espresso / Soda). */
  public speedBuffTimer = 0;
  public powerBuffTimer = 0;

  /** True while knocked out / dead. Character stays down until the respawn timer ends. */
  public isDead = false;
  /** Seconds spent on the ground before reviving. */
  public respawnDelay = 4.0;
  /** HP recovered per second once out of combat (0 disables regen). */
  public regenRate = 3.0;
  /** Seconds without taking damage before regen kicks in. */
  public regenDelay = 12;
  /** Optional respawn location (hospital / home / police station). Falls back to death spot. */
  public respawnPoint: THREE.Vector3 | null = null;

  private punchTimer = 0;
  private punchCooldown = 0;
  private comboResetTimer = 0;
  private dashTimer = 0;
  private dashCooldown = 0;
  private hitStunTimer = 0;
  private koTimer = 0;
  private sinceDamage = 0;
  private wasJump = false;
  private coyoteTimer = 0;
  private jumpBufferTimer = 0;
  private wasPunch = false;
  private wasDash = false;
  private wasGrounded = true;

  public groundHeightSampler: (x: number, z: number, currentY?: number) => number = () => 0;
  /** Returns water surface elevation (e.g. -0.8 ocean, -1.2 lake) or null on dry land. */
  public waterSurfaceSampler: (x: number, z: number) => number | null = () => null;
  public worldCollider: (pos: THREE.Vector3, vel: THREE.Vector3, radius: number) => boolean = () => false;
  public onPunchStrike: (origin: THREE.Vector3, forward: THREE.Vector3) => void = () => {};
  public onLand: (impactSpeed: number) => void = () => {};
  public onDash: () => void = () => {};
  public onSplash: (pos: THREE.Vector3) => void = () => {};
  /** Fired once when HP hits zero. */
  public onDeath: (pos: THREE.Vector3) => void = () => {};
  /** Fired after the respawn timer expires and HP is restored. */
  public onRespawn: (pos: THREE.Vector3) => void = () => {};

  public resetAt(pos: THREE.Vector3, yaw = 0): void {
    this.position.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.isDead = false;
    this.isSwimming = false;
    this.isDashing = false;
    this.isGliding = false;
    this.koTimer = 0;
    this.punchTimer = 0;
    this.punchCooldown = 0;
    this.comboStep = 0;
    this.comboResetTimer = 0;
    this.dashTimer = 0;
    this.dashCooldown = 0;
    this.hitStunTimer = 0;
    this.isGrounded = true;
    this.wasGrounded = true;
    this.wasJump = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.animState = 'IDLE';
  }

  /** Smoothly turns the fighter to face a world target when punching. */
  public faceTarget(tx: number, tz: number): void {
    const dx = tx - this.position.x;
    const dz = tz - this.position.z;
    if (dx * dx + dz * dz < 0.001) return;
    this.yaw = Math.atan2(-dx, -dz);
  }

  /** Applies damage and returns true when this hit killed the character. */
  public takeDamage(damage: number, dirX: number, dirZ: number): boolean {
    if (this.isDead || this.koTimer > 0 || this.isDashing) return false;
    this.hp = Math.max(0, this.hp - damage);
    this.sinceDamage = 0;
    this.punchTimer = 0;
    this.velocity.x += dirX * 7.5;
    this.velocity.z += dirZ * 7.5;
    this.velocity.y = Math.max(this.velocity.y, 2.8);
    this.isGrounded = false;
    if (this.hp <= 0) {
      this.isDead = true;
      this.isDashing = false;
      this.isGliding = false;
      this.hitStunTimer = 0;
      this.koTimer = Math.max(1.0, this.respawnDelay);
      this.animState = 'KO';
      this.onDeath(this.position.clone());
      return true;
    }
    this.hitStunTimer = 0.28;
    this.animState = 'HIT';
    return false;
  }

  /** Forces an immediate knockdown (used by police / scripted events). */
  public knockOut(): void {
    if (this.isDead) return;
    this.hp = 0;
    this.isDead = true;
    this.isDashing = false;
    this.isGliding = false;
    this.hitStunTimer = 0;
    this.punchTimer = 0;
    this.koTimer = Math.max(1.0, this.respawnDelay);
    this.animState = 'KO';
    this.onDeath(this.position.clone());
  }

  /** Restores the character at the respawn point (or at `at` when supplied). */
  public revive(at?: THREE.Vector3): void {
    const spawn = at ?? this.respawnPoint ?? this.position;
    this.position.copy(spawn);
    this.velocity.set(0, 0, 0);
    this.hp = this.maxHp;
    this.stamina = this.maxStamina;
    this.isDead = false;
    this.isSwimming = false;
    this.isDashing = false;
    this.isGliding = false;
    this.koTimer = 0;
    this.hitStunTimer = 0;
    this.sinceDamage = 0;
    this.punchTimer = 0;
    this.punchCooldown = 0;
    this.isGrounded = true;
    this.wasGrounded = true;
    this.wasJump = false;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.animState = 'IDLE';
    this.onRespawn(this.position.clone());
  }

  public getForwardVector(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  public update(dt: number, inputs: CharacterInputs, cameraYaw: number): void {
    dt = Math.min(dt, 0.04);

    if (this.punchCooldown > 0) this.punchCooldown -= dt;
    if (this.punchTimer > 0) this.punchTimer -= dt;
    if (this.comboResetTimer > 0) {
      this.comboResetTimer -= dt;
      if (this.comboResetTimer <= 0) this.comboStep = 0;
    }
    if (this.dashCooldown > 0) this.dashCooldown -= dt;
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      if (this.dashTimer <= 0) this.isDashing = false;
    }
    if (this.hitStunTimer > 0) this.hitStunTimer -= dt;
    if (this.speedBuffTimer > 0) this.speedBuffTimer = Math.max(0, this.speedBuffTimer - dt);
    if (this.powerBuffTimer > 0) this.powerBuffTimer = Math.max(0, this.powerBuffTimer - dt);

    // Out-of-combat recovery & stamina recharge
    this.sinceDamage += dt;
    if (!this.isDead && this.regenRate > 0 && this.hp < this.maxHp && this.sinceDamage > this.regenDelay) {
      this.hp = Math.min(this.maxHp, this.hp + this.regenRate * dt);
    }
    if (!this.isDead && !this.isDashing) {
      this.stamina = Math.min(this.maxStamina, this.stamina + 20 * dt);
    }

    if (this.isDead) {
      this.koTimer -= dt;
      this.velocity.y -= 22 * dt;
      this.position.addScaledVector(this.velocity, dt);
      const gy = this.groundHeightSampler(this.position.x, this.position.z, this.position.y);
      if (this.position.y <= gy) {
        this.position.y = gy;
        this.velocity.y = 0;
        this.velocity.x *= 0.85;
        this.velocity.z *= 0.85;
      }
      this.worldCollider(this.position, this.velocity, 0.45);
      this.animState = 'KO';
      if (this.koTimer <= 0) {
        this.revive();
      }
      this.wasPunch = Boolean(inputs.punch);
      this.wasJump = Boolean(inputs.jump);
      this.coyoteTimer = 0;
      this.jumpBufferTimer = 0;
      this.wasDash = Boolean(inputs.dash);
      return;
    }

    // Trigger Punch (3-hit snappy combo, usable grounded & out of water)
    const punchTrig = inputs.punch && !this.wasPunch;
    this.wasPunch = inputs.punch;
    if (punchTrig && this.punchCooldown <= 0 && this.hitStunTimer <= 0 && !this.isSwimming) {
      if (this.comboResetTimer > 0) {
        this.comboStep = (this.comboStep + 1) % 3;
      } else {
        this.comboStep = 0;
      }
      this.punchTimer = 0.28;
      this.punchCooldown = 0.26;
      this.comboResetTimer = 0.95;
      this.onPunchStrike(this.position.clone(), this.getForwardVector());
      const lungeFwd = this.getForwardVector();
      const lungeSpeed = this.comboStep === 2 ? 5.2 : 3.6;
      this.velocity.x += lungeFwd.x * lungeSpeed;
      this.velocity.z += lungeFwd.z * lungeSpeed;
    }

    // Camera-Relative Direction (suppressed briefly during hit stagger)
    const canSteer = this.hitStunTimer <= 0;
    const camFwdX = -Math.sin(cameraYaw);
    const camFwdZ = -Math.cos(cameraYaw);
    const camRgtX = Math.cos(cameraYaw);
    const camRgtZ = -Math.sin(cameraYaw);

    let wishX = canSteer ? (camFwdX * inputs.moveY + camRgtX * inputs.moveX) : 0;
    let wishZ = canSteer ? (camFwdZ * inputs.moveY + camRgtZ * inputs.moveX) : 0;
    const wishLen = Math.hypot(wishX, wishZ);
    if (wishLen > 0.01) {
      wishX /= wishLen;
      wishZ /= wishLen;
    }

    // Dodge-Dash (burst forward with invulnerability frames)
    const dashTrig = Boolean(inputs.dash) && !this.wasDash;
    this.wasDash = Boolean(inputs.dash);
    if (dashTrig && canSteer && !this.isSwimming && this.dashCooldown <= 0 && this.stamina >= 22) {
      this.stamina -= 22;
      this.isDashing = true;
      this.dashTimer = 0.22;
      this.dashCooldown = 0.72;
      const dirX = wishLen > 0.1 ? wishX : -Math.sin(this.yaw);
      const dirZ = wishLen > 0.1 ? wishZ : -Math.cos(this.yaw);
      this.yaw = Math.atan2(-dirX, -dirZ);
      this.velocity.x = dirX * 15.0;
      this.velocity.z = dirZ * 15.0;
      this.onDash();
    }

    const moveMag = canSteer ? Math.min(1, Math.hypot(inputs.moveX, inputs.moveY)) : 0;
    const buffMult = this.speedBuffTimer > 0 ? 1.28 : 1.0;
    const maxSpeed = (this.isSwimming
      ? (inputs.sprint ? 6.2 : 4.1)
      : (inputs.sprint ? 9.8 : 5.0)) * buffMult;

    if (!this.isDashing) {
      const targetVx = wishX * maxSpeed * moveMag;
      const targetVz = wishZ * maxSpeed * moveMag;
      const accel = this.hitStunTimer > 0 ? 4 : (this.isSwimming ? 7 : (this.isGrounded ? 16 : 6));
      this.velocity.x = THREE.MathUtils.damp(this.velocity.x, targetVx, accel, dt);
      this.velocity.z = THREE.MathUtils.damp(this.velocity.z, targetVz, accel, dt);
    }

    // Smoothly turn the character toward the running direction
    if (moveMag > 0.1 && !this.isDashing) {
      const targetYaw = Math.atan2(-wishX, -wishZ);
      let diff = targetYaw - this.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.yaw += diff * Math.min(1, 13 * dt);
    }

    // Jump / Shore Vault / Swim Hop — buffered to stay responsive near ledges/landings.
    const jumpTrig = inputs.jump && !this.wasJump;
    this.wasJump = inputs.jump;
    if (this.isGrounded) this.coyoteTimer = 0.12;
    else this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    if (jumpTrig) this.jumpBufferTimer = 0.13;
    else this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    if (this.jumpBufferTimer > 0 && canSteer) {
      if (this.isGrounded || this.coyoteTimer > 0) {
        this.velocity.y = 8.9;
        this.isGrounded = false;
        this.coyoteTimer = 0;
        this.jumpBufferTimer = 0;
      } else if (this.isSwimming) {
        this.velocity.y = 7.4;
        this.jumpBufferTimer = 0;
      }
    }

    // Gravity vs Water Buoyancy / Gliding
    const waterY = this.waterSurfaceSampler(this.position.x, this.position.z);
    const groundPre = this.groundHeightSampler(this.position.x, this.position.z, this.position.y);
    const deepWater = waterY !== null && groundPre < waterY - 0.35;
    const wasSwimming = this.isSwimming;
    this.isSwimming = deepWater && this.position.y <= waterY + 0.15;

    if (this.isSwimming && waterY !== null) {
      if (!wasSwimming) {
        this.isGliding = false;
        this.onSplash(this.position.clone());
      }
      const floatTarget = waterY - 1.05;
      const springVy = (floatTarget - this.position.y) * 12;
      this.velocity.y = THREE.MathUtils.damp(this.velocity.y, springVy, 8, dt);
      this.isGrounded = false;
    } else {
      const grav = this.isGliding && this.velocity.y < 0 ? 4.2 : 22.0;
      this.velocity.y -= grav * dt;
      if (this.isGliding && this.velocity.y < -5.8) {
        this.velocity.y = -5.8;
      }
    }

    this.position.addScaledVector(this.velocity, dt);

    // Solid City Buildings & World Zone Clamp
    this.worldCollider(this.position, this.velocity, 0.45);

    // Ground & Ramp Height Snap
    const groundY = this.groundHeightSampler(this.position.x, this.position.z, this.position.y);
    if (this.position.y <= groundY + 0.08 && this.velocity.y <= 0.5) {
      const impactVy = Math.abs(this.velocity.y);
      this.position.y = groundY;
      this.velocity.y = 0;
      this.isGliding = false;
      if (!this.wasGrounded && impactVy > 3.5 && !this.isSwimming) {
        this.onLand(impactVy);
      }
      this.isGrounded = true;
    } else if (this.position.y > groundY + 0.12 && !this.isSwimming) {
      this.isGrounded = false;
    }
    this.wasGrounded = this.isGrounded;

    // Determine Animation State
    const horizSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.hitStunTimer > 0) {
      this.animState = 'HIT';
    } else if (this.punchTimer > 0) {
      this.animState = 'PUNCH';
    } else if (this.isSwimming) {
      this.animState = horizSpeed > 1.2 ? 'RUN' : 'IDLE';
    } else if (!this.isGrounded) {
      this.animState = 'JUMP';
    } else if (horizSpeed > 6.2 || this.isDashing) {
      this.animState = 'RUN';
    } else if (horizSpeed > 0.6) {
      this.animState = 'WALK';
    } else {
      this.animState = 'IDLE';
    }
  }
}
