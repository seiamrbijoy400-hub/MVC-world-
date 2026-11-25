import * as THREE from 'three';
import { CarPhysics } from '../physics/CarPhysics';

interface SmokeParticle {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  scaleGrowth: number;
  isSpark: boolean;
}

export class ParticleSystem {
  public scene: THREE.Scene;

  private particlePool: SmokeParticle[] = [];
  private smokeGeo: THREE.DodecahedronGeometry;
  private smokeMat: THREE.MeshBasicMaterial;

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

    this.smokeGeo = new THREE.DodecahedronGeometry(0.28, 0);
    this.smokeMat = new THREE.MeshBasicMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.4
    });

    for (let i = 0; i < 120; i++) {
      const mesh = new THREE.Mesh(this.smokeGeo, this.smokeMat.clone());
      mesh.visible = false;
      this.scene.add(mesh);
      this.particlePool.push({
        mesh,
        velocity: new THREE.Vector3(),
        life: 0,
        maxLife: 1.0,
        scaleGrowth: 1.5,
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
      if (!p.mesh.visible) {
        p.mesh.visible = true;
        p.isSpark = false;
        p.mesh.position.copy(pos);
        p.mesh.scale.setScalar(0.3);
        p.velocity.copy(vel).multiplyScalar(0.18).add(new THREE.Vector3(
          (Math.random() - 0.5) * 1.4,
          Math.random() * 1.6 + 0.6,
          (Math.random() - 0.5) * 1.4
        ));
        p.life = 0;
        p.maxLife = Math.random() * 0.45 + 0.45;
        p.scaleGrowth = 2.8;

        const mat = p.mesh.material as THREE.MeshBasicMaterial;
        if (isOffroad) {
          mat.color.setHex(0x785338);
          mat.opacity = 0.48;
        } else if (driftMult >= 5) {
          mat.color.setHex(Math.random() > 0.4 ? 0xf97316 : 0x38bdf8);
          mat.opacity = 0.44;
        } else if (driftMult >= 2.5) {
          mat.color.setHex(0xfde047);
          mat.opacity = 0.38;
        } else {
          mat.color.setHex(0xd1d5db);
          mat.opacity = 0.34;
        }
        break;
      }
    }
  }

  public emitSparks(pos: THREE.Vector3, count = 12): void {
    let spawned = 0;
    for (const p of this.particlePool) {
      if (!p.mesh.visible) {
        p.mesh.visible = true;
        p.isSpark = true;
        p.mesh.position.copy(pos).add(new THREE.Vector3(0, 0.4, 0));
        p.mesh.scale.setScalar(0.18);
        p.velocity.set(
          (Math.random() - 0.5) * 14,
          Math.random() * 6 + 2,
          (Math.random() - 0.5) * 14
        );
        p.life = 0;
        p.maxLife = 0.25 + Math.random() * 0.2;
        p.scaleGrowth = 0;

        const mat = p.mesh.material as THREE.MeshBasicMaterial;
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
      if (p.mesh.visible) {
        p.life += dt;
        if (p.life >= p.maxLife) {
          p.mesh.visible = false;
        } else {
          if (p.isSpark) p.velocity.y -= 18 * dt;
          p.mesh.position.addScaledVector(p.velocity, dt);
          const progress = p.life / p.maxLife;
          if (!p.isSpark) {
            const currentScale = 0.3 + progress * p.scaleGrowth;
            p.mesh.scale.setScalar(currentScale);
            (p.mesh.material as THREE.MeshBasicMaterial).opacity = (1.0 - progress) * 0.34;
          } else {
            (p.mesh.material as THREE.MeshBasicMaterial).opacity = 1.0 - progress;
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
