import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { CarPhysics } from '../physics/CarPhysics';

export class CarMesh {
  private static fbxCache = new Map<string, Promise<THREE.Group>>();
  private static sharedShadowTex: THREE.CanvasTexture | null = null;
  private static sharedGlowTex: THREE.CanvasTexture | null = null;
  private static sharedBeamTex: THREE.CanvasTexture | null = null;

  private static loadCachedFBX(url: string): Promise<THREE.Group> {
    let cached = CarMesh.fbxCache.get(url);
    if (!cached) {
      const loader = new FBXLoader();
      cached = loader.loadAsync(url).then((group) => {
        group.traverse((c) => {
          const m = c as THREE.Mesh;
          if (m.geometry) m.geometry.userData.shared = true;
        });
        return group;
      });
      CarMesh.fbxCache.set(url, cached);
    }
    return cached.then((tpl) => tpl.clone(true));
  }

  public root: THREE.Group;
  public bodyGroup: THREE.Group;
  public fallbackGroup: THREE.Group;
  public hqBodyGroup: THREE.Group | null = null;

  // Each wheel has an outer steerGroup (Y-axis steer) and inner spinGroup (X-axis roll)
  public wheelSteerGroups: THREE.Group[] = [];
  public wheelSpinGroups: THREE.Group[] = [];

  // Materials for live customization
  public bodyMaterials: THREE.MeshPhysicalMaterial[] = [];
  public brakeLightMaterials: THREE.MeshBasicMaterial[] = [];
  public reverseLightMaterials: THREE.MeshBasicMaterial[] = [];
  private currentColor = new THREE.Color(0xff5500);
  public currentColorHex = '#ff5500';

  // Active spoiler, contact shadow, neon underglow, nitro jets & working headlights
  public spoiler: THREE.Group | null = null;
  private contactShadow: THREE.Mesh | null = null;
  private underglowMesh: THREE.Mesh | null = null;
  private underglowMat: THREE.MeshBasicMaterial | null = null;
  private headlightBeamMesh: THREE.Mesh | null = null;
  private nitroFlameL: THREE.Mesh | null = null;
  private nitroFlameR: THREE.Mesh | null = null;
  private headSpotLights: THREE.SpotLight[] = [];
  private headlightBulbMat: THREE.MeshStandardMaterial | null = null;
  public isGhost = false;

  constructor(withHeadlights = false, isGhost = false) {
    this.isGhost = isGhost;
    this.root = new THREE.Group();
    this.bodyGroup = new THREE.Group();
    this.fallbackGroup = new THREE.Group();
    this.bodyGroup.add(this.fallbackGroup);
    this.root.add(this.bodyGroup);

    if (!isGhost) {
      this.createContactShadow();
      this.createUnderglow();
      this.createNitroFlames();
    }
    this.createFallbackCar();
    this.createBrakeAndReverseBars();
    this.createActiveSpoiler();
    this.createFallbackWheels();
    if (withHeadlights && !isGhost) this.createHeadlights();

    // Asynchronously load the authentic HQ FBX Racing Car & Wheels
    this.loadHQModels();
  }

  private createUnderglow(): void {
    if (!CarMesh.sharedGlowTex) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      const grad = ctx.createRadialGradient(64, 128, 18, 64, 128, 64);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
      grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.38)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 256);

      const tex = new THREE.CanvasTexture(canvas);
      tex.userData.shared = true;
      CarMesh.sharedGlowTex = tex;
    }

    const geo = new THREE.PlaneGeometry(3.1, 5.6);
    geo.rotateX(-Math.PI * 0.5);
    this.underglowMat = new THREE.MeshBasicMaterial({
      map: CarMesh.sharedGlowTex,
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.underglowMesh = new THREE.Mesh(geo, this.underglowMat);
    this.underglowMesh.position.y = 0.055;
    this.root.add(this.underglowMesh);
  }

  private createNitroFlames(): void {
    const geo = new THREE.ConeGeometry(0.11, 0.95, 10);
    geo.rotateX(Math.PI * 0.5); // Tip pointing backward (+Z)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.nitroFlameL = new THREE.Mesh(geo, mat);
    this.nitroFlameR = new THREE.Mesh(geo, mat);
    this.nitroFlameL.position.set(-0.36, 0.28, 2.55);
    this.nitroFlameR.position.set(0.36, 0.28, 2.55);
    this.nitroFlameL.visible = false;
    this.nitroFlameR.visible = false;
    this.bodyGroup.add(this.nitroFlameL, this.nitroFlameR);
  }

  public setUnderglowColor(hex: string): void {
    if (!this.underglowMesh || !this.underglowMat) return;
    if (hex === 'OFF') {
      this.underglowMesh.visible = false;
      return;
    }
    this.underglowMesh.visible = true;
    this.underglowMat.color.set(hex);
  }

  private createHeadlights(): void {
    for (const sideX of [-0.62, 0.62]) {
      const spot = new THREE.SpotLight(0xe0f2fe, 0, 62, Math.PI * 0.24, 0.45, 1.2);
      spot.position.set(sideX, 0.56, -2.05);
      const target = new THREE.Object3D();
      target.position.set(sideX * 0.7, 0.0, -24);
      this.bodyGroup.add(spot, target);
      spot.target = target;
      this.headSpotLights.push(spot);
    }

    // Ground volumetric-style headlight beam projection (cheap, high visual impact at night/sunset)
    if (!CarMesh.sharedBeamTex) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 256;
      const ctx = c.getContext('2d')!;
      const grad = ctx.createLinearGradient(0, 256, 0, 0);
      grad.addColorStop(0, 'rgba(224, 242, 254, 0.42)');
      grad.addColorStop(0.5, 'rgba(186, 230, 253, 0.14)');
      grad.addColorStop(1, 'rgba(186, 230, 253, 0.0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(46, 256);
      ctx.lineTo(82, 256);
      ctx.lineTo(126, 0);
      ctx.lineTo(2, 0);
      ctx.closePath();
      ctx.fill();
      const bTex = new THREE.CanvasTexture(c);
      bTex.userData.shared = true;
      CarMesh.sharedBeamTex = bTex;
    }

    const beamGeo = new THREE.PlaneGeometry(9.5, 22);
    beamGeo.rotateX(-Math.PI * 0.5);
    const beamMat = new THREE.MeshBasicMaterial({
      map: CarMesh.sharedBeamTex,
      transparent: true,
      opacity: 0.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });
    this.headlightBeamMesh = new THREE.Mesh(beamGeo, beamMat);
    this.headlightBeamMesh.position.set(0, 0.07, -13.0);
    this.root.add(this.headlightBeamMesh);
  }

  public setHeadlights(enabled: boolean): void {
    const intensity = enabled ? 56 : 0;
    for (const s of this.headSpotLights) {
      s.intensity = intensity;
    }
    if (this.headlightBulbMat) {
      this.headlightBulbMat.emissiveIntensity = enabled ? 3.5 : 1.1;
    }
    if (this.headlightBeamMesh) {
      (this.headlightBeamMesh.material as THREE.MeshBasicMaterial).opacity = enabled ? 0.55 : 0.0;
    }
  }

  public setColor(hexColor: string | number): void {
    this.currentColor.set(hexColor);
    this.currentColorHex = '#' + this.currentColor.getHexString();
    for (const mat of this.bodyMaterials) {
      mat.color.copy(this.currentColor);
    }
  }

  public dispose(): void {
    this.root.traverse((obj) => {
      const m = obj as THREE.Mesh;
      if (m.geometry && !m.geometry.userData?.shared) m.geometry.dispose();
      if (m.material) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          const anyMat = mat as THREE.MeshStandardMaterial;
          if (anyMat.map && !anyMat.map.userData?.shared) anyMat.map.dispose();
          mat.dispose();
        }
      }
    });
  }

  private createContactShadow(): void {
    if (!CarMesh.sharedShadowTex) {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 256;
      const ctx = canvas.getContext('2d')!;
      const grad = ctx.createRadialGradient(64, 128, 12, 64, 128, 64);
      grad.addColorStop(0, 'rgba(0, 0, 0, 0.72)');
      grad.addColorStop(0.6, 'rgba(0, 0, 0, 0.35)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 128, 256);

      const tex = new THREE.CanvasTexture(canvas);
      tex.userData.shared = true;
      CarMesh.sharedShadowTex = tex;
    }

    const geo = new THREE.PlaneGeometry(2.5, 5.1);
    geo.rotateX(-Math.PI * 0.5);
    const mat = new THREE.MeshBasicMaterial({
      map: CarMesh.sharedShadowTex,
      transparent: true,
      depthWrite: false
    });
    this.contactShadow = new THREE.Mesh(geo, mat);
    this.contactShadow.position.y = 0.045;
    this.root.add(this.contactShadow);
  }

  private createPaintMaterial(): THREE.MeshPhysicalMaterial {
    const mat = new THREE.MeshPhysicalMaterial({
      color: this.currentColor,
      metalness: 0.65,
      roughness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06
    });
    this.bodyMaterials.push(mat);
    return mat;
  }

  private loadHQModels(): void {
    // 1. Load Car 1203 Body (cached once across all vehicles)
    CarMesh.loadCachedFBX('/assets/models/car 1203.fbx').then((fbx) => {
      const container = new THREE.Group();
      fbx.scale.setScalar(0.01);
      // Car 1203 faces +Z in FBX -> rotate 180 deg so front faces -Z
      fbx.rotation.y = Math.PI;

      const paintMat = this.createPaintMaterial();
      const carbonMat = new THREE.MeshStandardMaterial({ color: 0x16181d, roughness: 0.48, metalness: 0.35 });
      const chromeMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, metalness: 0.92, roughness: 0.12 });
      const glassMat = new THREE.MeshPhysicalMaterial({
        color: 0x0f172a,
        metalness: 0.15,
        roughness: 0.06,
        transparent: true,
        opacity: 0.78
      });
      const interiorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85, metalness: 0.1 });
      const headlightMat = new THREE.MeshStandardMaterial({
        color: 0xe0f2fe,
        emissive: 0xbae6fd,
        emissiveIntensity: 1.5,
        roughness: 0.1
      });
      this.headlightBulbMat = headlightMat;

      const ghostMat = this.isGhost
        ? new THREE.MeshBasicMaterial({
            color: 0x22d3ee,
            transparent: true,
            opacity: 0.34,
            blending: THREE.AdditiveBlending,
            depthWrite: false
          })
        : null;

      fbx.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const name = mesh.name.toLowerCase();

          if (name.includes('collider')) {
            mesh.visible = false;
            return;
          }

          if (ghostMat) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.material = ghostMat;
            return;
          }

          mesh.castShadow = true;
          mesh.receiveShadow = true;

          if (name === 'body') {
            mesh.material = paintMat;
          } else if (name.includes('glass')) {
            mesh.material = glassMat;
          } else if (name.includes('chrome')) {
            mesh.material = chromeMat;
          } else if (name.includes('light')) {
            mesh.material = headlightMat;
          } else if (name.includes('interior') || name.includes('dashboard') || name.includes('roll')) {
            mesh.material = interiorMat;
          } else {
            mesh.material = carbonMat;
          }
        }
      });

      container.add(fbx);
      this.hqBodyGroup = container;
      this.bodyGroup.add(container);
      this.fallbackGroup.visible = false;
    }).catch((err) => {
      console.warn('Could not load HQ car FBX, keeping procedural model:', err);
    });

    // 2. Load Front & Rear HQ Wheels (cached once across all vehicles)
    const assignWheelMaterials = (wheelObj: THREE.Object3D) => {
      const tireMat = new THREE.MeshStandardMaterial({ color: 0x141416, roughness: 0.85, metalness: 0.08 });
      const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.22, metalness: 0.88 });
      const brakeDiscMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.35, metalness: 0.8 });
      const caliperMat = new THREE.MeshStandardMaterial({ color: 0xef4444, roughness: 0.3, metalness: 0.5 });

      wheelObj.traverse((c) => {
        if ((c as THREE.Mesh).isMesh) {
          const m = c as THREE.Mesh;
          m.castShadow = true;
          const n = m.name.toLowerCase();
          if (n.includes('3')) m.material = tireMat;
          else if (n.includes('1') || n.includes('5')) m.material = rimMat;
          else if (n.includes('2')) m.material = brakeDiscMat;
          else m.material = caliperMat;
        }
      });
    };

    CarMesh.loadCachedFBX('/assets/models/wheel_front_right.fbx').then((frontFbx) => {
      frontFbx.scale.setScalar(0.01);
      assignWheelMaterials(frontFbx);

      // Replace FL (0) and FR (1) spin children
      for (let i = 0; i < 2; i++) {
        const spin = this.wheelSpinGroups[i];
        spin.clear();
        const clone = i === 0 ? frontFbx.clone(true) : frontFbx;
        // Front right faces +X; mirror left wheel 180 deg around Y
        if (i === 0) clone.rotation.y = Math.PI;
        spin.add(clone);
      }
    }).catch(() => {});

    CarMesh.loadCachedFBX('/assets/models/wheel_back_right.fbx').then((rearFbx) => {
      rearFbx.scale.setScalar(0.01);
      assignWheelMaterials(rearFbx);

      // Replace RL (2) and RR (3) spin children
      for (let i = 2; i < 4; i++) {
        const spin = this.wheelSpinGroups[i];
        spin.clear();
        const clone = i === 2 ? rearFbx.clone(true) : rearFbx;
        if (i === 2) clone.rotation.y = Math.PI;
        spin.add(clone);
      }
    }).catch(() => {});
  }

  private createFallbackCar(): void {
    const paintMat = this.isGhost
      ? new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.3, wireframe: true })
      : this.createPaintMaterial();
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.45, metalness: 0.35 });
    const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0f172a, roughness: 0.1, transparent: true, opacity: 0.85 });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.38, 4.35), paintMat);
    chassis.position.set(0, 0.38, 0);
    chassis.castShadow = !this.isGhost;
    this.fallbackGroup.add(chassis);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.36, 0.4, 1.8), this.isGhost ? paintMat : glassMat);
    cabin.position.set(0, 0.72, 0.12);
    cabin.castShadow = !this.isGhost;
    this.fallbackGroup.add(cabin);

    const splitter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.5), this.isGhost ? paintMat : carbonMat);
    splitter.position.set(0, 0.16, -2.05);
    this.fallbackGroup.add(splitter);
  }

  public setGhostPose(x: number, y: number, z: number, yaw: number, pitch: number, roll: number, steer: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(0, yaw, 0);
    this.bodyGroup.rotation.set(pitch, 0, roll);
    if (this.wheelSteerGroups[0]) this.wheelSteerGroups[0].rotation.y = -steer;
    if (this.wheelSteerGroups[1]) this.wheelSteerGroups[1].rotation.y = -steer;
  }

  private createBrakeAndReverseBars(): void {
    const tailMat = new THREE.MeshBasicMaterial({ color: 0x7f1d1d });
    this.brakeLightMaterials.push(tailMat);
    const tlGeo = new THREE.BoxGeometry(0.44, 0.06, 0.05);
    const tlL = new THREE.Mesh(tlGeo, tailMat);
    tlL.position.set(-0.62, 0.68, 2.15);
    const tlR = new THREE.Mesh(tlGeo, tailMat);
    tlR.position.set(0.62, 0.68, 2.15);
    this.bodyGroup.add(tlL, tlR);

    const revMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
    this.reverseLightMaterials.push(revMat);
    const revGeo = new THREE.BoxGeometry(0.16, 0.045, 0.05);
    const revL = new THREE.Mesh(revGeo, revMat);
    revL.position.set(-0.3, 0.54, 2.17);
    const revR = new THREE.Mesh(revGeo, revMat);
    revR.position.set(0.3, 0.54, 2.17);
    this.bodyGroup.add(revL, revR);
  }

  private createActiveSpoiler(): void {
    const carbonMat = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.35, metalness: 0.5 });
    const wingGroup = new THREE.Group();
    wingGroup.position.set(0, 0.96, 1.96);

    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.04, 0.32), carbonMat);
    blade.castShadow = true;
    wingGroup.add(blade);

    // Side endplates
    const plateGeo = new THREE.BoxGeometry(0.03, 0.16, 0.36);
    const plateL = new THREE.Mesh(plateGeo, carbonMat);
    plateL.position.set(-0.89, -0.02, 0);
    const plateR = new THREE.Mesh(plateGeo, carbonMat);
    plateR.position.set(0.89, -0.02, 0);
    wingGroup.add(plateL, plateR);

    this.spoiler = wingGroup;
    this.bodyGroup.add(wingGroup);

    // Struts mounted to body
    const strutGeo = new THREE.BoxGeometry(0.04, 0.28, 0.16);
    const strutL = new THREE.Mesh(strutGeo, carbonMat);
    strutL.position.set(-0.46, 0.82, 1.92);
    const strutR = new THREE.Mesh(strutGeo, carbonMat);
    strutR.position.set(0.46, 0.82, 1.92);
    this.bodyGroup.add(strutL, strutR);
  }

  private createFallbackWheels(): void {
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.85 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.25, metalness: 0.85 });

    for (let i = 0; i < 4; i++) {
      const steerGroup = new THREE.Group();
      const spinGroup = new THREE.Group();
      steerGroup.add(spinGroup);

      const radius = i < 2 ? 0.325 : 0.338;
      const width = i < 2 ? 0.24 : 0.32;

      const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 20);
      tireGeo.rotateZ(Math.PI * 0.5);
      const tire = new THREE.Mesh(tireGeo, rubberMat);
      tire.castShadow = true;

      const rimGeo = new THREE.CylinderGeometry(radius * 0.65, radius * 0.65, width + 0.01, 12);
      rimGeo.rotateZ(Math.PI * 0.5);
      const rim = new THREE.Mesh(rimGeo, rimMat);

      spinGroup.add(tire, rim);

      this.wheelSteerGroups.push(steerGroup);
      this.wheelSpinGroups.push(spinGroup);
      this.root.add(steerGroup);
    }
  }

  public update(physics: CarPhysics, brakeInput: number, dt: number): void {
    this.root.position.copy(physics.position);
    // Apply yaw only on root, pitch & roll on bodyGroup so wheels stay grounded cleanly
    this.root.rotation.set(0, physics.rotation.y, 0);
    this.bodyGroup.rotation.set(physics.bodyPitch, 0, physics.bodyRoll);

    // Brake & Reverse lights
    const isBraking = brakeInput > 0.05 || physics.wheels[2].skidAmount > 0.45;
    for (const mat of this.brakeLightMaterials) {
      mat.color.setHex(isBraking ? 0xff1e1e : 0x691010);
    }
    const isReverse = physics.gear === -1;
    for (const mat of this.reverseLightMaterials) {
      mat.color.setHex(isReverse ? 0xf8fafc : 0x1e293b);
    }

    // Continuous Twin Nitro Jet Flames
    if (this.nitroFlameL && this.nitroFlameR) {
      const showNitro = physics.isNitroActive;
      this.nitroFlameL.visible = showNitro;
      this.nitroFlameR.visible = showNitro;
      if (showNitro) {
        const flicker = 0.85 + Math.random() * 0.48;
        this.nitroFlameL.scale.set(1.0, 1.0, flicker);
        this.nitroFlameR.scale.set(1.0, 1.0, flicker);
      }
    }

    // Active rear aero wing / airbrake tilt
    if (this.spoiler) {
      const targetAngle = isBraking && physics.speedKmh > 55
        ? 0.42
        : (physics.speedKmh > 130 ? 0.16 : 0.04);
      this.spoiler.rotation.x = THREE.MathUtils.damp(this.spoiler.rotation.x, targetAngle, 12, dt);
    }

    // Update all 4 wheels: Ackermann steering (Y) + forward spin (X)
    for (let i = 0; i < 4; i++) {
      const wPhys = physics.wheels[i];
      const steerGrp = this.wheelSteerGroups[i];
      const spinGrp = this.wheelSpinGroups[i];
      const offset = physics.wheelOffsets[i];

      // Suspension travel around rest offset
      const suspDrop = (wPhys.compression - 0.5) * 0.08;
      steerGrp.position.set(offset.x, offset.y + suspDrop, offset.z);

      // Right turn (+steerAngle) = negative Y rotation in Three.js!
      steerGrp.rotation.y = -wPhys.steerAngle;

      // Forward roll = negative X rotation
      spinGrp.rotation.x = -wPhys.rotationAngle;
    }
  }
}
