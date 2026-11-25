import * as THREE from 'three';
import type { CarArchetypeId } from '../game/SaveManager';

export enum GearboxType {
  AUTO = 'AUTO',
  SEMI = 'SEMI',
  MANUAL = 'MANUAL'
}

export interface CarInputs {
  throttle: number; // 0 to 1
  brake: number;    // 0 to 1
  steer: number;    // -1 (Left) to +1 (Right)
  handbrake: boolean;
  clutch: boolean;
  shiftUp: boolean;
  shiftDown: boolean;
  reset: boolean;
  nitro?: boolean;
}

export interface WheelState {
  position: THREE.Vector3;
  compression: number;      // 0 to 1
  steerAngle: number;       // radians (+ = turning right)
  angularVelocity: number;  // rad/s
  rotationAngle: number;    // accumulated roll radians
  slipLateral: number;
  isGrounded: boolean;
  skidAmount: number;       // 0 to 1
  isOffroad: boolean;
  isCurb: boolean;
}

export interface GroundSample {
  height: number;
  normal: THREE.Vector3;
  isRoad: boolean;
  isCurb: boolean;
  distToCenter: number;
  tangent: THREE.Vector3;
  closestPoint: THREE.Vector3;
}

export class CarPhysics {
  // Zenvo TS1 Dimensions & Specs (matched to car 1203.fbx wheel arches)
  public mass = 1450; // kg
  public frontAxleDist = 1.192; // m ahead of center
  public rearAxleDist = 1.353;  // m behind center
  public get wheelbase(): number { return this.frontAxleDist + this.rearAxleDist; } // 2.545 m
  public trackWidth = 1.62; // m

  // ZenvoTS1.asset steering curve
  public maxSteerAngle = 31 * (Math.PI / 180);
  public highSpeedSteerAngle = 7.5 * (Math.PI / 180);

  // Engine & Transmission (Zenvo TS1 Twin-Supercharged V8)
  public idleRpm = 1000;
  public maxRpm = 9500;
  public redlineRpm = 8200;
  public revLimiterBounce = false;
  public currentRpm = 1000;
  public gear = 1; // -1 = Reverse, 0 = Neutral, 1..7 = Forward
  public reverseRatio = 3.1;
  public forwardGearRatios = [3.35, 2.38, 1.82, 1.44, 1.18, 0.98, 0.82];
  public finalDrive = 3.65;
  public gearboxType: GearboxType = GearboxType.AUTO;
  public wheelRadiusFront = 0.325;
  public wheelRadiusRear = 0.338;

  // Vehicle World State (Three.js: -Z forward, +X right, +Y up)
  public position = new THREE.Vector3(0, 0, 0);
  public velocity = new THREE.Vector3();
  public rotation = new THREE.Euler(0, 0, 0, 'YXZ');
  public quaternion = new THREE.Quaternion();
  public yawRate = 0; // rad/s (+ = turning left / CCW around +Y)

  // Visual Suspension / Pitch / Roll
  public bodyPitch = 0;
  public bodyRoll = 0;
  public verticalVel = 0;
  public antiRollStiffness = 0.65; // reduces body roll by 65%

  // Wheels: [FL, FR, RL, RR]
  public wheels: WheelState[] = [];
  public wheelOffsets: THREE.Vector3[] = [];

  // Drift, Nitro, Archetype, Assist & Steering smoothing
  private currentSteer = 0;
  public assistMode: 'ARCADE' | 'PRO' = 'ARCADE';
  public archetype: CarArchetypeId = 'HYPER';
  public torqueScale = 1.0;
  public gripScale = 1.0;
  public weatherGripMultiplier = 1.0;
  public rearGripFactor = 1.0;
  public minDriftGrip = 0.34;
  public driftAngle = 0; // degrees
  public isDrifting = false;
  public topSpeedKmh = 0;

  // Nitrous Overdrive (0..100)
  public nitro = 100;
  public isNitroActive = false;

  // Airborne Stunt Telemetry
  public isAirborne = false;
  public airTime = 0;
  public onAirLanding: (airSeconds: number) => void = () => {};

  // Ground sampler & Barrier collision
  public enforceTrackWalls = true;
  public trackMaxHalfWidth = 10.2;
  public groundHeightSampler: (x: number, z: number) => GroundSample = () => ({
    height: 0,
    normal: new THREE.Vector3(0, 1, 0),
    isRoad: true,
    isCurb: false,
    distToCenter: 0,
    tangent: new THREE.Vector3(0, 0, -1),
    closestPoint: new THREE.Vector3()
  });

  public worldCollider: (pos: THREE.Vector3, vel: THREE.Vector3, radius: number) => boolean = () => false;
  public onWallCollision: (impactSpeedKmh: number) => void = () => {};

  // Safe checkpoint respawn
  public lastSafePosition = new THREE.Vector3(0, 0, 0);
  public lastSafeRotation = 0;

  private _limiterTimer = 0;
  private _autoShiftTimer = 0;
  private _reverseHoldTimer = 0;
  private _collisionCooldown = 0;
  private _wasShiftDown = false;
  private _wasShiftUp = false;

  // Pre-allocated scratch vectors (zero-allocation 180Hz sub-step loop)
  private readonly _fwd = new THREE.Vector3();
  private readonly _rgt = new THREE.Vector3();
  private readonly _toCenter = new THREE.Vector3();

  constructor() {
    const halfFrontW = 0.792;
    const halfRearW = 0.833;

    // Facing -Z: Front is -frontAxleDist, Rear is +rearAxleDist
    this.wheelOffsets = [
      new THREE.Vector3(-halfFrontW, 0.325, -this.frontAxleDist), // 0: FL
      new THREE.Vector3(halfFrontW, 0.325, -this.frontAxleDist),  // 1: FR
      new THREE.Vector3(-halfRearW, 0.338, this.rearAxleDist),    // 2: RL
      new THREE.Vector3(halfRearW, 0.338, this.rearAxleDist)      // 3: RR
    ];

    for (let i = 0; i < 4; i++) {
      this.wheels.push({
        position: new THREE.Vector3(),
        compression: 0.5,
        steerAngle: 0,
        angularVelocity: 0,
        rotationAngle: 0,
        slipLateral: 0,
        isGrounded: true,
        skidAmount: 0,
        isOffroad: false,
        isCurb: false
      });
    }
  }

  public get speedKmh(): number {
    return Math.hypot(this.velocity.x, this.velocity.z) * 3.6;
  }

  public get forwardVelocity(): number {
    const fwd = this.getForwardVector();
    return this.velocity.x * fwd.x + this.velocity.z * fwd.z;
  }

  public getForwardVector(): THREE.Vector3 {
    const yaw = this.rotation.y;
    return new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  }

  public getRightVector(): THREE.Vector3 {
    const yaw = this.rotation.y;
    return new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  }

  public getUpVector(): THREE.Vector3 {
    return new THREE.Vector3(0, 1, 0).applyQuaternion(this.quaternion).normalize();
  }

  public resetToTrack(pos?: THREE.Vector3, heading?: number): void {
    if (pos) {
      this.position.copy(pos);
    } else {
      this.position.copy(this.lastSafePosition);
    }
    const g = this.groundHeightSampler(this.position.x, this.position.z);
    this.position.y = g.height;

    const angle = heading !== undefined ? heading : this.lastSafeRotation;
    this.rotation.set(0, angle, 0);
    this.quaternion.setFromEuler(this.rotation);

    this.velocity.set(0, 0, 0);
    this.yawRate = 0;
    this.verticalVel = 0;
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.currentSteer = 0;
    this.currentRpm = this.idleRpm;
    this.gear = 1;
    this.driftAngle = 0;
    this.isDrifting = false;

    for (const w of this.wheels) {
      w.angularVelocity = 0;
      w.skidAmount = 0;
      w.slipLateral = 0;
    }
  }

  public applyArchetype(type: CarArchetypeId): void {
    this.archetype = type;
    if (type === 'DRIFT') {
      this.mass = 1320;
      this.torqueScale = 1.06;
      this.gripScale = 0.94;
      this.minDriftGrip = 0.24;
      this.maxSteerAngle = 37 * (Math.PI / 180);
      this.antiRollStiffness = 0.72;
    } else if (type === 'TOUGE') {
      this.mass = 1220;
      this.torqueScale = 0.96;
      this.gripScale = 1.24;
      this.minDriftGrip = 0.40;
      this.maxSteerAngle = 33 * (Math.PI / 180);
      this.antiRollStiffness = 0.80;
    } else {
      // HYPER — Zenvo TS1 Apex
      this.mass = 1450;
      this.torqueScale = 1.0;
      this.gripScale = 1.0;
      this.minDriftGrip = 0.34;
      this.maxSteerAngle = 31 * (Math.PI / 180);
      this.antiRollStiffness = 0.65;
    }
  }

  public addNitro(amount: number): void {
    this.nitro = THREE.MathUtils.clamp(this.nitro + amount, 0, 100);
  }

  public shiftUp(): void {
    if (this.gear === -1) {
      this.gear = 0;
    } else if (this.gear === 0) {
      this.gear = 1;
    } else if (this.gear < this.forwardGearRatios.length) {
      this.gear++;
      this.currentRpm = Math.max(this.idleRpm, this.currentRpm * 0.78);
    }
  }

  public shiftDown(): void {
    if (this.gear > 1) {
      this.gear--;
      this.currentRpm = Math.min(this.maxRpm - 300, this.currentRpm * 1.25);
    } else if (this.gear === 1) {
      this.gear = 0;
    } else if (this.gear === 0 && this.speedKmh < 20) {
      this.gear = -1;
    }
  }

  // Twin-Supercharged V8 torque curve (instant boost off idle, peak 1150 Nm @ 7200 RPM)
  private evaluateEngineTorque(rpm: number): number {
    if (rpm < 1000) return 480;
    if (rpm < 2800) return THREE.MathUtils.lerp(480, 820, (rpm - 1000) / 1800);
    if (rpm < 5200) return THREE.MathUtils.lerp(820, 1060, (rpm - 2800) / 2400);
    if (rpm < 7600) return THREE.MathUtils.lerp(1060, 1150, (rpm - 5200) / 2400);
    if (rpm < 9000) return THREE.MathUtils.lerp(1150, 1020, (rpm - 7600) / 1400);
    return 350;
  }

  // ZenvoTS1.asset steering curve (km/h -> radians) — capped to prevent snap oversteer
  private evaluateMaxSteerAngle(speedKmh: number): number {
    // 30° at 0 km/h → 12° at 100 km/h → 5.5° at 250+ km/h
    if (speedKmh < 100) {
      return THREE.MathUtils.lerp(30.5, 12.0, speedKmh / 100) * (Math.PI / 180);
    }
    return THREE.MathUtils.lerp(12.0, 5.5, Math.min(1, (speedKmh - 100) / 150)) * (Math.PI / 180);
  }

  public update(dt: number, inputs: CarInputs, canDrive = true): void {
    if (dt <= 0) return;
    dt = Math.min(dt, 0.04);

    if (this._collisionCooldown > 0) this._collisionCooldown -= dt;

    if (inputs.reset) {
      this.resetToTrack();
      return;
    }

    // Edge-trigger shift buttons once per frame so sub-stepping never double-shifts
    const shiftUpTrigger = inputs.shiftUp && !this._wasShiftUp;
    const shiftDownTrigger = inputs.shiftDown && !this._wasShiftDown;
    this._wasShiftUp = inputs.shiftUp;
    this._wasShiftDown = inputs.shiftDown;

    if (canDrive && this.gearboxType !== GearboxType.AUTO) {
      const clutchOk = this.gearboxType === GearboxType.SEMI || inputs.clutch;
      if (shiftUpTrigger && clutchOk) this.shiftUp();
      if (shiftDownTrigger && clutchOk) this.shiftDown();
    }

    // Nitrous Overdrive consumption & passive trickle
    const wantsNitro = Boolean(canDrive && inputs.nitro && this.gear >= 1 && this.nitro > 1.5);
    if (wantsNitro) {
      this.isNitroActive = true;
      this.nitro = Math.max(0, this.nitro - 26 * dt);
    } else {
      this.isNitroActive = false;
      // Gentle passive trickle + bonus recharge when drifting
      const regen = this.isDrifting ? 14.5 : 3.2;
      this.nitro = Math.min(100, this.nitro + regen * dt);
    }

    // 180Hz-minimum fixed physics sub-stepping eliminates 30fps mobile tire oscillation
    const subSteps = Math.max(1, Math.min(4, Math.ceil(dt / (1 / 180))));
    const subDt = dt / subSteps;
    for (let s = 0; s < subSteps; s++) {
      this.stepSub(subDt, inputs, canDrive);
    }
  }

  private stepSub(dt: number, inputs: CarInputs, canDrive: boolean): void {
    const throttle = canDrive ? (this.isNitroActive ? Math.max(inputs.throttle, 1.0) : inputs.throttle) : 0;
    const brake = canDrive ? inputs.brake : 1.0;
    const rawSteer = canDrive ? inputs.steer : 0;
    const handbrake = canDrive ? inputs.handbrake : false;

    const yaw = this.rotation.y;
    const fwd = this._fwd.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    const rgt = this._rgt.set(Math.cos(yaw), 0, -Math.sin(yaw));

    let vFwd = this.velocity.x * fwd.x + this.velocity.z * fwd.z;
    const vLat = this.velocity.x * rgt.x + this.velocity.z * rgt.z;
    const speed = Math.hypot(vFwd, vLat);
    const speedKmh = speed * 3.6;
    if (speedKmh > this.topSpeedKmh) this.topSpeedKmh = speedKmh;

    // --- 1. Non-Linear Steering, Asymmetric Counter-Steer & Ackermann ---
    const maxSteer = this.evaluateMaxSteerAngle(speedKmh);
    const shapedSteer = Math.sign(rawSteer) * Math.pow(Math.abs(rawSteer), 1.55);
    const targetSteer = shapedSteer * maxSteer;
    const isCounterSteer = targetSteer * this.currentSteer < -0.0001;
    const isUnwinding = Math.abs(targetSteer) < Math.abs(this.currentSteer);
    const steerRate = isCounterSteer ? 15.5 : (isUnwinding ? 11.5 : 7.2);
    this.currentSteer = THREE.MathUtils.damp(this.currentSteer, targetSteer, steerRate, dt);

    let leftSteer = this.currentSteer;
    let rightSteer = this.currentSteer;

    if (Math.abs(this.currentSteer) > 0.005) {
      const radius = this.wheelbase / Math.tan(Math.abs(this.currentSteer));
      const halfW = this.trackWidth * 0.5;
      if (this.currentSteer > 0) {
        rightSteer = Math.atan(this.wheelbase / Math.max(0.5, radius - halfW));
        leftSteer = Math.atan(this.wheelbase / (radius + halfW));
      } else {
        leftSteer = -Math.atan(this.wheelbase / Math.max(0.5, radius - halfW));
        rightSteer = -Math.atan(this.wheelbase / (radius + halfW));
      }
    }

    this.wheels[0].steerAngle = leftSteer;
    this.wheels[1].steerAngle = rightSteer;
    this.wheels[2].steerAngle = 0;
    this.wheels[3].steerAngle = 0;

    // --- 2. Automatic Transmission & Debounced Smart Reverse ---
    if (canDrive && this.gearboxType === GearboxType.AUTO) {
      this._autoShiftTimer += dt;
      if (this.gear === -1 && throttle > 0.1 && vFwd > -0.8) {
        this.gear = 1;
        this._autoShiftTimer = 0;
        this._reverseHoldTimer = 0;
      } else if (this.gear >= 1 && brake > 0.25 && vFwd < 0.7) {
        this._reverseHoldTimer += dt;
        if (this._reverseHoldTimer >= 0.24) {
          this.gear = -1;
          this._autoShiftTimer = 0;
          this._reverseHoldTimer = 0;
        }
      } else {
        this._reverseHoldTimer = 0;
        if (this._autoShiftTimer > 0.22) {
          if (this.gear >= 1 && this.currentRpm > 7900 && this.gear < this.forwardGearRatios.length) {
            this.gear++;
            this.currentRpm = Math.max(this.idleRpm, this.currentRpm * 0.78);
            this._autoShiftTimer = 0;
          } else if (this.gear > 1 && this.currentRpm < 3600 && vFwd > 3) {
            this.gear--;
            this.currentRpm = Math.min(this.maxRpm - 300, this.currentRpm * 1.25);
            this._autoShiftTimer = 0;
          }
        }
      }
    }

    let effectiveThrottle = throttle;
    let effectiveBrake = brake;
    if (canDrive && this.gearboxType === GearboxType.AUTO && this.gear === -1) {
      effectiveThrottle = brake;
      effectiveBrake = throttle;
    }

    // --- 3. Engine RPM & Powertrain ---
    let gearRatio = 0;
    if (this.gear === -1) gearRatio = this.reverseRatio;
    else if (this.gear >= 1) gearRatio = this.forwardGearRatios[this.gear - 1];

    const clutchDisengaged = (this.gear === 0) || (this.gearboxType === GearboxType.MANUAL && inputs.clutch);
    const rearWheelRpm = (Math.abs(vFwd) / this.wheelRadiusRear) * (60 / (2 * Math.PI));
    const wheelDrivenRpm = rearWheelRpm * gearRatio * this.finalDrive;

    if (this.currentRpm >= this.maxRpm) {
      this.revLimiterBounce = true;
      this._limiterTimer = 0.07;
    }
    if (this._limiterTimer > 0) {
      this._limiterTimer -= dt;
      if (this._limiterTimer <= 0) this.revLimiterBounce = false;
    }

    if (this.revLimiterBounce) {
      this.currentRpm = THREE.MathUtils.damp(this.currentRpm, this.maxRpm - 550, 28, dt);
    } else if (clutchDisengaged || !canDrive) {
      const freeRevTarget = this.idleRpm + effectiveThrottle * (this.maxRpm - this.idleRpm);
      this.currentRpm = THREE.MathUtils.damp(this.currentRpm, freeRevTarget, effectiveThrottle > 0.1 ? 9 : 5, dt);
    } else {
      const slipSpinRpm = effectiveThrottle * (this.gear === 1 ? 1400 : 400);
      const targetRpm = Math.max(this.idleRpm, wheelDrivenRpm + slipSpinRpm);
      this.currentRpm = THREE.MathUtils.damp(this.currentRpm, targetRpm, 14, dt);
      this.currentRpm = THREE.MathUtils.clamp(this.currentRpm, this.idleRpm, this.maxRpm);
    }

    const nitroTorqueMult = this.isNitroActive ? 1.48 : 1.0;
    const engineTorque = (!canDrive || clutchDisengaged || this.revLimiterBounce)
      ? 0
      : this.evaluateEngineTorque(this.currentRpm) * effectiveThrottle * this.torqueScale * nitroTorqueMult;

    const drivetrainEfficiency = 0.86;
    const driveWheelTorque = engineTorque * gearRatio * this.finalDrive * drivetrainEfficiency;
    let driveForce = driveWheelTorque / this.wheelRadiusRear;
    if (this.gear === -1) driveForce = -driveForce;
    if (this.isNitroActive) {
      driveForce += 4800; // Direct jet thrust at high gears
    }

    // --- 4. Sample Ground for All 4 Wheels ---
    let avgGroundY = 0;
    let avgGrip = 0;
    let anyOffroad = false;
    const wheelHeights: number[] = [0, 0, 0, 0];

    for (let i = 0; i < 4; i++) {
      const off = this.wheelOffsets[i];
      const wx = this.position.x + off.x * rgt.x + (-off.z) * fwd.x;
      const wz = this.position.z + off.x * rgt.z + (-off.z) * fwd.z;
      const g = this.groundHeightSampler(wx, wz);

      wheelHeights[i] = g.height;
      avgGroundY += g.height * 0.25;

      const w = this.wheels[i];
      w.position.set(wx, g.height + 0.04, wz);
      w.isCurb = g.isCurb;
      w.isOffroad = !g.isRoad && !g.isCurb;

      const wGrip = (g.isRoad ? 1.0 : (g.isCurb ? 0.90 : 0.55)) * this.gripScale * this.weatherGripMultiplier;
      avgGrip += wGrip * 0.25;
      if (w.isOffroad) anyOffroad = true;
    }

    // --- 5. Drift & Tire Lateral Grip Model ---
    const driftBaseline = this.archetype === 'DRIFT' ? 0.84 : 1.0;
    if (handbrake) {
      this.rearGripFactor = THREE.MathUtils.damp(this.rearGripFactor, this.minDriftGrip, 14, dt);
    } else {
      const powerOversteer = (this.gear <= 2 && effectiveThrottle > 0.85 && Math.abs(this.currentSteer) > 0.15)
        ? 0.72 * driftBaseline
        : driftBaseline;
      this.rearGripFactor = THREE.MathUtils.damp(this.rearGripFactor, powerOversteer, 5.5, dt);
    }

    const aeroDownforce = 0.5 * 1.225 * 0.9 * (speed * speed);
    const totalNormalLoad = this.mass * 9.81 + aeroDownforce;
    const frontLoad = totalNormalLoad * 0.45;
    const rearLoad = totalNormalLoad * 0.55;

    const aeroDrag = 0.5 * 1.225 * 0.34 * 2.15 * speed * speed;
    const rollingResistance = (anyOffroad ? 650 : 180) + speed * 4.0;

    const maxBrakeForce = 18500;
    const brakeForce = effectiveBrake * maxBrakeForce + (handbrake ? 9000 : 0);

    let netLongForce = driveForce - Math.sign(vFwd) * (aeroDrag + rollingResistance);
    if (Math.abs(vFwd) > 0.2) {
      netLongForce -= Math.sign(vFwd) * brakeForce;
    } else if ((effectiveBrake > 0.1 || handbrake) && Math.abs(driveForce) < 120) {
      this.velocity.x = 0;
      this.velocity.z = 0;
      this.yawRate = 0;
      vFwd = 0;
      netLongForce = 0;
    }

    // Dynamic rear weight transfer under launch lets track tires hook up to ~1.65x static load
    const maxRearTraction = rearLoad * avgGrip * 1.65;
    const wheelspinRatio = Math.max(0, (Math.abs(driveForce) - maxRearTraction) / maxRearTraction);
    if (Math.abs(driveForce) > maxRearTraction) {
      // Brakes must still work when traction-limited — include brakeForce in capped calculation
      const cappedDrive = Math.sign(driveForce) * maxRearTraction;
      netLongForce = cappedDrive - Math.sign(vFwd) * (aeroDrag + rollingResistance + brakeForce);
    }

    // --- 6. Lateral Axle Tire Forces & Real Yaw Dynamics ---
    let lateralForceFront = 0;
    let lateralForceRear = 0;

    if (speed > 0.35) {
      const vLatFront = vLat - this.yawRate * this.frontAxleDist;
      const vLatRear = vLat + this.yawRate * this.rearAxleDist;

      const fwdSign = vFwd >= -0.2 ? 1 : -1;
      const denom = Math.max(2.5, Math.abs(vFwd));
      // Progressive tire grip onset: zero below 0.35 m/s, full above 3.5 m/s — no low-speed jitter
      const tireBlend = THREE.MathUtils.clamp((speed - 0.35) / 3.15, 0, 1);

      const slipFront = Math.atan2(vLatFront, denom) - this.currentSteer * fwdSign;
      const slipRear = Math.atan2(vLatRear, denom);

      // Counter-steer assist scales by assistMode (ARCADE helps catch slides, PRO stays raw)
      const assistGain = this.assistMode === 'ARCADE' ? 0.42 : 0.1;
      const counterAssist = THREE.MathUtils.clamp(-slipRear * assistGain, -0.32, 0.32);
      const slipRearAssisted = slipRear + counterAssist * (1 - this.rearGripFactor);

      const frontMu = 1.42 * avgGrip;
      const rearMu = 1.45 * avgGrip * this.rearGripFactor;

      const frontCurve = Math.sin(1.45 * Math.atan(6.5 * Math.max(-0.85, Math.min(0.85, slipFront))));
      const rearCurve = Math.sin(1.45 * Math.atan(6.0 * Math.max(-0.85, Math.min(0.85, slipRearAssisted))));

      lateralForceFront = -frontLoad * frontMu * frontCurve * tireBlend;
      lateralForceRear = -rearLoad * rearMu * rearCurve * tireBlend;
    } else {
      this.yawRate *= Math.max(0, 1 - 12 * dt);
    }

    const netLatForce = lateralForceFront + lateralForceRear;
    const yawTorque = -this.frontAxleDist * lateralForceFront + this.rearAxleDist * lateralForceRear;
    const yawInertia = 2650;

    const axLong = netLongForce / this.mass;
    const axLat = netLatForce / this.mass;

    const worldForceX = fwd.x * netLongForce + rgt.x * netLatForce;
    const worldForceZ = fwd.z * netLongForce + rgt.z * netLatForce;

    this.velocity.x += (worldForceX / this.mass) * dt;
    this.velocity.z += (worldForceZ / this.mass) * dt;

    if (effectiveThrottle < 0.05 && speed < 0.4) {
      this.velocity.x *= Math.max(0, 1 - 8 * dt);
      this.velocity.z *= Math.max(0, 1 - 8 * dt);
    }

    this.yawRate += (yawTorque / yawInertia) * dt;
    this.yawRate *= Math.max(0, 1 - 0.6 * dt);

    this.position.x += this.velocity.x * dt;
    this.position.z += this.velocity.z * dt;
    this.rotation.y += this.yawRate * dt;

    // --- 7. Solid Track Barrier & Open World City/Zone Collision Physics ---
    const centerGround = this.groundHeightSampler(this.position.x, this.position.z);
    if (this.enforceTrackWalls && centerGround.distToCenter > this.trackMaxHalfWidth) {
      const toCenter = this._toCenter.copy(centerGround.closestPoint).sub(this.position);
      toCenter.y = 0;
      const dist = toCenter.length();
      if (dist > 0.001) {
        const normal = toCenter.divideScalar(dist);
        const penetration = centerGround.distToCenter - this.trackMaxHalfWidth;
        this.position.x += normal.x * penetration;
        this.position.z += normal.z * penetration;

        const vDotN = this.velocity.x * normal.x + this.velocity.z * normal.z;
        if (vDotN < 0) {
          const impactKmh = Math.abs(vDotN) * 3.6;
          this.velocity.x = (this.velocity.x - 1.32 * vDotN * normal.x) * 0.86;
          this.velocity.z = (this.velocity.z - 1.32 * vDotN * normal.z) * 0.86;
          this.yawRate *= 0.5;

          if (impactKmh > 12 && this._collisionCooldown <= 0) {
            this.onWallCollision(impactKmh);
            this._collisionCooldown = 0.35;
          }
        }
      }
    }

    const hitWorld = this.worldCollider(this.position, this.velocity, 1.55);
    if (hitWorld && speedKmh > 14 && this._collisionCooldown <= 0) {
      this.onWallCollision(speedKmh * 0.65);
      this._collisionCooldown = 0.35;
    }

    // --- 8. Vertical Terrain Following, Stunt Ramp Jumps & Anti-Roll Suspension ---
    const prevY = this.position.y;
    const targetY = avgGroundY;
    const heightDiff = targetY - this.position.y;
    if (heightDiff >= -0.14) {
      // Climbing ramp or on road: track slope & store upward ramp velocity for jumps!
      const nextY = THREE.MathUtils.damp(this.position.y, targetY, 26, dt);
      const slopeVy = (nextY - prevY) / Math.max(0.001, dt);
      this.position.y = nextY;
      this.verticalVel = Math.max(0, slopeVy);
      if (this.isAirborne && this.airTime > 0.35) {
        this.onAirLanding(this.airTime);
      }
      this.isAirborne = false;
      this.airTime = 0;
    } else {
      // Airborne off a stunt ramp or crest! Apply gravity
      this.isAirborne = true;
      this.airTime += dt;
      this.verticalVel -= 15.5 * dt;
      this.position.y += this.verticalVel * dt;
      if (this.position.y <= targetY) {
        this.position.y = targetY;
        this.verticalVel = 0;
        if (this.airTime > 0.35) {
          this.onAirLanding(this.airTime);
        }
        this.isAirborne = false;
        this.airTime = 0;
      }
    }

    const frontGroundY = (wheelHeights[0] + wheelHeights[1]) * 0.5;
    const rearGroundY = (wheelHeights[2] + wheelHeights[3]) * 0.5;
    const leftGroundY = (wheelHeights[0] + wheelHeights[2]) * 0.5;
    const rightGroundY = (wheelHeights[1] + wheelHeights[3]) * 0.5;

    const terrainPitch = Math.atan2(frontGroundY - rearGroundY, this.wheelbase);
    const terrainRoll = Math.atan2(rightGroundY - leftGroundY, this.trackWidth);

    const squatDive = THREE.MathUtils.clamp(-axLong * 0.0045, -0.045, 0.045);
    const cornerRoll = THREE.MathUtils.clamp(axLat * 0.006 * (1 - this.antiRollStiffness), -0.05, 0.05);

    this.bodyPitch = THREE.MathUtils.damp(this.bodyPitch, terrainPitch + squatDive, 12, dt);
    this.bodyRoll = THREE.MathUtils.damp(this.bodyRoll, terrainRoll + cornerRoll, 12, dt);

    this.rotation.x = this.bodyPitch;
    this.rotation.z = this.bodyRoll;
    this.quaternion.setFromEuler(this.rotation);

    // --- 9. Drift Angle & Wheel Spin / Skid Telemetry ---
    const newFwd = this.getForwardVector();
    const newRgt = this.getRightVector();
    const newVFwd = this.velocity.x * newFwd.x + this.velocity.z * newFwd.z;
    const newVLat = this.velocity.x * newRgt.x + this.velocity.z * newRgt.z;

    if (speed > 4) {
      this.driftAngle = Math.atan2(Math.abs(newVLat), Math.max(1, Math.abs(newVFwd))) * (180 / Math.PI);
      this.isDrifting = this.driftAngle > 12 && Math.abs(newVLat) > 2.8;
    } else {
      this.driftAngle = 0;
      this.isDrifting = false;
    }

    for (let i = 0; i < 4; i++) {
      const w = this.wheels[i];
      const rad = i < 2 ? this.wheelRadiusFront : this.wheelRadiusRear;
      const isRear = i >= 2;

      const extraSpin = isRear ? wheelspinRatio * 18 * Math.sign(driveForce || 1) : 0;
      const lockFactor = (isRear && handbrake) ? 0.05 : 1.0;
      w.angularVelocity = (newVFwd / rad) * lockFactor + extraSpin;
      w.rotationAngle += w.angularVelocity * dt;
      w.slipLateral = Math.abs(newVLat);

      const sideSign = (i % 2 === 0) ? -1 : 1;
      const endSign = (i < 2) ? -1 : 1;
      w.compression = THREE.MathUtils.clamp(0.5 - this.bodyRoll * sideSign * 3.0 + this.bodyPitch * endSign * 3.0, 0.15, 0.9);

      if (isRear && handbrake && speed > 4) {
        w.skidAmount = THREE.MathUtils.clamp(speed / 14, 0.45, 1.0);
      } else if (isRear && wheelspinRatio > 0.2 && effectiveThrottle > 0.5) {
        w.skidAmount = THREE.MathUtils.clamp(wheelspinRatio, 0.35, 1.0);
      } else if (Math.abs(newVLat) > 3.2 && speed > 6) {
        w.skidAmount = THREE.MathUtils.clamp((Math.abs(newVLat) - 3.0) / 5.5, 0, 1.0);
      } else {
        w.skidAmount = THREE.MathUtils.damp(w.skidAmount, 0, 10, dt);
      }
    }

    if (centerGround.isRoad && speed > 2) {
      this.lastSafePosition.copy(this.position);
      this.lastSafeRotation = this.rotation.y;
    }

    // Defensive NaN / Infinity Guard
    if (
      !Number.isFinite(this.position.x) ||
      !Number.isFinite(this.position.y) ||
      !Number.isFinite(this.position.z) ||
      !Number.isFinite(this.velocity.x) ||
      !Number.isFinite(this.velocity.z) ||
      !Number.isFinite(this.yawRate)
    ) {
      this.resetToTrack();
    }
  }
}
