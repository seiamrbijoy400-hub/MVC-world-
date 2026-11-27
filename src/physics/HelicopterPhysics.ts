import * as THREE from 'three';

export interface HelicopterInputs {
  /** +1 = nose down / fly forward, -1 = flare / fly backward */
  pitch: number;
  /** +1 = yaw right, -1 = yaw left */
  yaw: number;
  /** +1 = bank right strafe, -1 = bank left strafe */
  strafe: number;
  ascend: boolean;
  descend: boolean;
}

/**
 * Semi-arcade twin-turbine helicopter flight controller ("weighty mastery" feel):
 * - Smooth rotor spool-up / wind-down inertia
 * - Coordinated roll banking into turns + pitch tilt into thrust
 * - Automatic hover vertical damping when collective isn't pressed
 * - Universal rooftop, ground, and helipad landing with water splashdown recovery
 */
export class HelicopterPhysics {
  public position = new THREE.Vector3(258, 50.0, -5);
  public velocity = new THREE.Vector3();
  public yaw = 0.35;
  public pitch = 0;
  public roll = 0;
  public yawRate = 0;

  /** 0..1 main & tail rotor normalized RPM. Flight lift begins above 0.58. */
  public rotorRpm = 0;
  public isGrounded = true;
  public isPiloted = false;
  public speedKmh = 0;
  public agl = 0;

  public lastSafeLanding = new THREE.Vector3(258, 50.0, -5);

  public groundHeightSampler: (x: number, z: number, currentY?: number) => number = () => 0;
  public waterSurfaceSampler: (x: number, z: number) => number | null = () => null;
  public worldCollider: (pos: THREE.Vector3, vel: THREE.Vector3, radius: number) => boolean = () => false;
  public onImpact: (speedKmh: number) => void = () => {};
  public onWaterSplash: () => void = () => {};

  public resetAt(pos: THREE.Vector3, yaw = 0.35): void {
    this.position.copy(pos);
    this.lastSafeLanding.copy(pos);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.yawRate = 0;
    this.rotorRpm = 0;
    this.isGrounded = true;
    this.speedKmh = 0;
    this.agl = 0;
  }

  public getForwardVector(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }

  public getRightVector(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  public update(dt: number, inputs: HelicopterInputs, piloted: boolean): void {
    dt = Math.min(dt, 0.04);
    this.isPiloted = piloted;

    // 1. Spool rotors smoothly up when piloted, coast down slowly when exited
    if (piloted) {
      this.rotorRpm = Math.min(1.0, this.rotorRpm + dt * 0.52);
    } else {
      this.rotorRpm = Math.max(0.0, this.rotorRpm - dt * 0.22);
    }

    const liftAuthority = Math.max(0, Math.min(1, (this.rotorRpm - 0.52) / 0.38));

    // 2. Yaw steering (active once rotors carry tail authority)
    const targetYawRate = piloted ? -inputs.yaw * 1.95 * Math.max(0.25, liftAuthority) : 0;
    this.yawRate = THREE.MathUtils.damp(this.yawRate, targetYawRate, 6.5, dt);
    if (!this.isGrounded || liftAuthority > 0.35) {
      this.yaw += this.yawRate * dt;
    }

    // 3. Collective & Smart Auto-Hover Vertical Assist
    if (piloted && liftAuthority > 0.25) {
      if (inputs.ascend) {
        this.velocity.y += (17.5 * liftAuthority - 4.0) * dt;
        if (this.isGrounded && this.velocity.y > 0.5) {
          this.isGrounded = false;
        }
      } else if (inputs.descend) {
        this.velocity.y -= 15.0 * dt;
      } else if (!this.isGrounded) {
        // Gentle hover hold: damps vertical drift so hovering beside buildings feels effortless
        this.velocity.y = THREE.MathUtils.damp(this.velocity.y, 0, 5.2, dt);
      }
      this.velocity.y = THREE.MathUtils.clamp(this.velocity.y, -24, 22);
    } else {
      // Gravity pulls chopper back down when rotors wind down
      const grav = 19.5 * (1 - liftAuthority * 0.88);
      if (!this.isGrounded || this.velocity.y > 0) {
        this.velocity.y -= grav * dt;
      }
    }

    // 4. Cyclic Forward / Lateral Thrust + Coordinated Bank Attitude
    const fwdX = -Math.sin(this.yaw);
    const fwdZ = -Math.cos(this.yaw);
    const rgtX = Math.cos(this.yaw);
    const rgtZ = -Math.sin(this.yaw);

    if (piloted && !this.isGrounded && liftAuthority > 0.25) {
      const fwdThrust = inputs.pitch * 36.0 * liftAuthority;
      const strThrust = inputs.strafe * 22.0 * liftAuthority;
      this.velocity.x += (fwdX * fwdThrust + rgtX * strThrust) * dt;
      this.velocity.z += (fwdZ * fwdThrust + rgtZ * strThrust) * dt;
    }

    // Aerodynamic drag (stronger on ground skids)
    const hDrag = this.isGrounded ? 6.5 : 0.78;
    this.velocity.x = THREE.MathUtils.damp(this.velocity.x, 0, hDrag, dt);
    this.velocity.z = THREE.MathUtils.damp(this.velocity.z, 0, hDrag, dt);

    // Cap horizontal cruise speed around ~168 km/h (46.6 m/s)
    const hSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    const maxCruise = 46.6;
    if (hSpeed > maxCruise) {
      const s = maxCruise / hSpeed;
      this.velocity.x *= s;
      this.velocity.z *= s;
    }

    // Coordinated fuselage tilt (pitch into climb/speed, roll into turns/strafe)
    const targetPitch = piloted && !this.isGrounded ? -inputs.pitch * 0.34 : 0;
    const targetRoll = piloted && !this.isGrounded
      ? THREE.MathUtils.clamp(-this.yawRate * 0.32 - inputs.strafe * 0.24, -0.58, 0.58)
      : 0;
    this.pitch = THREE.MathUtils.damp(this.pitch, targetPitch, 5.5, dt);
    this.roll = THREE.MathUtils.damp(this.roll, targetRoll, 6.0, dt);

    // 5. Integrate position & enforce ceiling / skyscraper / ground collision
    this.position.addScaledVector(this.velocity, dt);
    if (this.position.y > 210) {
      this.position.y = 210;
      if (this.velocity.y > 0) this.velocity.y = 0;
    }

    const hitWall = this.worldCollider(this.position, this.velocity, 2.7);
    if (hitWall && hSpeed > 12) {
      this.onImpact(hSpeed * 3.6);
    }

    const groundY = this.groundHeightSampler(this.position.x, this.position.z, this.position.y);
    const waterY = this.waterSurfaceSampler(this.position.x, this.position.z);

    if (waterY !== null && groundY < waterY - 0.3 && this.position.y < waterY - 0.35) {
      this.onWaterSplash();
      this.position.copy(this.lastSafeLanding);
      this.velocity.set(0, 0, 0);
      this.isGrounded = true;
      this.agl = 0;
      this.speedKmh = 0;
      return;
    }

    if (this.position.y <= groundY + 0.04 && this.velocity.y <= 0.2) {
      const impactVy = Math.abs(this.velocity.y);
      if (!this.isGrounded && impactVy > 9.5) {
        this.onImpact(impactVy * 3.6);
      }
      this.position.y = groundY;
      this.velocity.y = 0;
      this.isGrounded = true;
      if (waterY === null || groundY >= waterY - 0.1) {
        this.lastSafeLanding.copy(this.position);
      }
    } else if (this.position.y > groundY + 0.15) {
      this.isGrounded = false;
    }

    this.agl = Math.max(0, this.position.y - groundY);
    this.speedKmh = Math.hypot(this.velocity.x, this.velocity.z) * 3.6;
  }
}
