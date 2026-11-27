import * as THREE from 'three';
import { CarPhysics } from '../physics/CarPhysics';

interface SmokeParticle {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  startScale: number;
  scaleGrowth: number;
  baseOpacity: number;
  isSpark: boolean;
}

function createSoftSmokeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);

  // Soft multi-lobe volumetric cloud puff (no polygon silhouettes!)
  const lobes = [
    { x: 64, y: 64, r: 54, a: 0.55 },
    { x: 46, y: 56, r: 36, a: 0.35 },
    { x: 82, y: 58, r: 34, a: 0.35 },
    { x: 64, y: 78, r: 38, a: 0.30 }
  ];
  for (const lobe of lobes) {
    const grad = ctx.createRadialGradient(lobe.x, lobe.y, 2, lobe.x, lobe.y, lobe.r);
    grad.addColorStop(0, `rgba(255,255,255,${lobe.a})`);
    grad.addColorStop(0.55, `rgba(255,255,255,${lobe.a * 0.4})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(lobe.x, lobe.y, lobe.r, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.userData.shared = true;
  return tex;
}

export class ParticleSystem {
  public scene: THREE.Scene;

  private particlePool: SmokeParticle[] = [];
  private static sharedSmokeTex: THREE.CanvasTexture | null = null;

  private exhaustFlameL: THREE.Mesh;
  private exhaustFlameR: THREE.Mesh;
  private flameTimer = 0;

  private skidMesh: THREE.LineSegments;
  private skidPositions: Float32Array;
  private skidColors: Float32Array;
  private skidIndex = 0;
  private maxSkidPoints = 5000;
  private lastWheelContact: THREE.Vector3[] = [
    new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
  ];

  constructor(scene: THREE.Scene) {
    this.scene = scene;

    if (!ParticleSystem.sharedSmokeTex) {
      ParticleSystem.sharedSmokeTex = createSoftSmokeTexture();
    }

    for (let i = 0; i < 120; i++) {
      const mat = new THREE.SpriteMaterial({
        map: ParticleSystem.sharedSmokeTex,
        color: 0xe2e8f0,
        transparent: true,
        opacity: 0.4,
        depthWrite: false
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      this.scene.add(sprite);
      this.particlePool.push({
        sprite,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1.0,
        startScale: 0.45,
        scaleGrowth: 1.8,
        baseOpacity: 0.32,
        isSpark: false
      });
    }

    const flameGeo = new THREE.ConeGeometry(0.08, 0.45, 8);
    flameGeo.rotateX(-Math.PI * 0.5);
    const flameMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.95
    });

    this.exhaustFlameL = new THREE.Mesh(flameGeo, flameMat);
    this.exhaustFlameR = new THREE.Mesh(flameGeo, flameMat);
    this.exhaustFlameL.visible = false;
    this.exhaustFlameR.visible = false;
    this.scene.add(this.exhaustFlameL, this.exhaustFlameR);

    this.skidPositions = new Float32Array(this.maxSkidPoints * 3);
    this.skidColors = new Float32Array(this.maxSkidPoints * 3);

    const skidGeo = new THREE.BufferGeometry();
    skidGeo.setAttribute('position', new THREE.BufferAttribute(this.skidPositions, 3));
    skidGeo.setAttribute('color', new THREE.BufferAttribute(this.skidColors, 3));

    const skidMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.78,
      depthWrite: false
    });

    this.skidMesh = new THREE.LineSegments(skidGeo, skidMat);
    this.skidMesh.frustumCulled = false;
    this.scene.add(this.skidMesh);
  }

  public emitSmoke(pos: THREE.Vector3, vel: THREE.Vector3, isOffroad = false, driftMult = 1): void {
    for (const p of this.particlePool) {
      if (!p.sprite.visible) {
        p.sprite.visible = true;
        p.isSpark = false;
        p.sprite.position.copy(pos);
        p.sprite.position.y += 0.14;
        p.startScale = isOffroad ? 0.55 : 0.42;
        p.sprite.scale.setScalar(p.startScale);
        p.velocity.copy(vel).multiplyScalar(0.16).add(new THREE.Vector3(
          (Math.random() - 0.5) * 1.1,
          Math.random() * 1.15 + 0.45,
          (Math.random() - 0.5) * 1.1
        ));
        p.life = 0;
        p.maxLife = Math.random() * 0.45 + 0.48;
        p.scaleGrowth = isOffroad ? 1.9 : 2.2;

        const mat = p.sprite.material as THREE.SpriteMaterial;
        mat.blending = THREE.NormalBlending;
        mat.rotation = Math.random() * Math.PI * 2;
        if (isOffroad) {
          mat.color.setHex(0x8c6d53);
          p.baseOpacity = 0.28;
        } else if (driftMult >= 5) {
          mat.color.setHex(Math.random() > 0.4 ? 0xf97316 : 0x38bdf8);
          p.baseOpacity = 0.32;
        } else if (driftMult >= 2.5) {
          mat.color.setHex(0xfde047);
          p.baseOpacity = 0.28;
        } else {
          mat.color.setHex(0xe2e8f0);
          p.baseOpacity = 0.26;
        }
        mat.opacity = p.baseOpacity;
        break;
      }
    }
  }

  public emitSparks(pos: THREE.Vector3, count = 12): void {
    let spawned = 0;
    for (const p of this.particlePool) {
      if (!p.sprite.visible) {
        p.sprite.visible = true;
        p.isSpark = true;
        p.sprite.position.copy(pos).add(new THREE.Vector3(0, 0.35, 0));
        p.startScale = 0.22;
        p.sprite.scale.setScalar(0.22);
        p.velocity.set(
          (Math.random() - 0.5) * 14,
          Math.random() * 6 + 2,
          (Math.random() - 0.5) * 14
        );
        p.life = 0;
        p.maxLife = 0.25 + Math.random() * 0.2;
        p.scaleGrowth = 0;
        p.baseOpacity = 1.0;

        const mat = p.sprite.material as THREE.SpriteMaterial;
        mat.blending = THREE.AdditiveBlending;
        mat.color.setHex(Math.random() > 0.4 ? 0xfbbf24 : 0xf97316);
        mat.opacity = 1.0;
        spawned++;
        if (spawned >= count) break;
      }
    }
  }

  public triggerBackfire(carPos: THREE.Vector3, carForward: THREE.Vector3, carRight: THREE.Vector3): void {
    this.flameTimer = 0.14;
    const backPos = carPos.clone().addScaledVector(carForward, -2.18).add(new THREE.Vector3(0, 0.28, 0));

    this.exhaustFlameL.position.copy(backPos).addScaledVector(carRight, -0.36);
    this.exhaustFlameR.position.copy(backPos).addScaledVector(carRight, 0.36);

    this.exhaustFlameL.lookAt(backPos.clone().addScaledVector(carForward, -4));
    this.exhaustFlameR.quaternion.copy(this.exhaustFlameL.quaternion);

    this.exhaustFlameL.visible = true;
    this.exhaustFlameR.visible = true;
  }

  public addSkidmark(p1: THREE.Vector3, p2: THREE.Vector3, intensity: number): void {
    if (this.skidIndex + 6 >= this.maxSkidPoints * 3) {
      this.skidIndex = 0;
    }

    const idx = this.skidIndex;
    const yOffset = 0.015;

    this.skidPositions[idx] = p1.x;
    this.skidPositions[idx + 1] = p1.y + yOffset;
    this.skidPositions[idx + 2] = p1.z;

    this.skidPositions[idx + 3] = p2.x;
    this.skidPositions[idx + 4] = p2.y + yOffset;
    this.skidPositions[idx + 5] = p2.z;

    const c = 0.08 * (1.0 - intensity);
    for (let i = 0; i < 2; i++) {
      this.skidColors[idx + i * 3] = c;
      this.skidColors[idx + i * 3 + 1] = c;
      this.skidColors[idx + i * 3 + 2] = c;
    }

    this.skidIndex += 6;
    this.skidMesh.geometry.attributes.position.needsUpdate = true;
    this.skidMesh.geometry.attributes.color.needsUpdate = true;
  }

  public update(dt: number, physics: CarPhysics, driftMult = 1): void {
    for (const p of this.particlePool) {
      if (p.sprite.visible) {
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.sprite.visible = false;
        } else {
          if (p.isSpark) p.velocity.y -= 18 * dt;
          p.sprite.position.addScaledVector(p.velocity, dt);
          const progress = p.life / p.maxLife;
          const mat = p.sprite.material as THREE.SpriteMaterial;
          if (!p.isSpark) {
            const currentScale = p.startScale + progress * p.scaleGrowth;
            p.sprite.scale.setScalar(currentScale);
            mat.opacity = (1.0 - progress) * p.baseOpacity;
            mat.rotation += dt * 0.8;
          } else {
            p.sprite.scale.setScalar(p.startScale * (1.0 - progress * 0.5));
            mat.opacity = 1.0 - progress;
          }
        }
      }
    }

    if (this.flameTimer > 0) {
      this.flameTimer -= dt;
      if (this.flameTimer <= 0) {
        this.exhaustFlameL.visible = false;
        this.exhaustFlameR.visible = false;
      }
    }

    for (let i = 0; i < 4; i++) {
      const w = physics.wheels[i];
      if (w.skidAmount > 0.22) {
        if (i >= 2 && Math.random() < 0.65) {
          this.emitSmoke(w.position, physics.velocity, w.isOffroad, driftMult);
        }

        const lastPos = this.lastWheelContact[i];
        const dist = lastPos.lengthSq() > 0 ? lastPos.distanceTo(w.position) : 0;
        if (dist > 0.15 && dist < 2.5) {
          this.addSkidmark(lastPos, w.position, w.skidAmount);
        }
        this.lastWheelContact[i].copy(w.position);
      } else {
        if (w.isOffroad && physics.speedKmh > 25 && Math.random() < 0.35) {
          this.emitSmoke(w.position, physics.velocity, true, 1);
        }
        this.lastWheelContact[i].set(0, 0, 0);
      }
    }
  }
}
