import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { assetUrl } from './assetUrl';
import type { HelicopterPhysics } from '../physics/HelicopterPhysics';

interface CachedHeliTemplate {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  groundOffset: number;
  scale: number;
}

/**
 * Loads and drives the Apex Skyhawk helicopter (`helicopter.glb`) with:
 * - Normalized `-Z` forward orientation & flush landing skid ground alignment
 * - Spinning main & tail rotors + high-RPM rotor-blur disc
 * - Cockpit door animation on board/exit + nav tail strobes + spotlight searchlight
 */
export class HelicopterMesh {
  private static templatePromise: Promise<CachedHeliTemplate | null> | null = null;
  private static sharedBlurTex: THREE.CanvasTexture | null = null;

  public root: THREE.Group;
  public tiltGroup: THREE.Group;
  private fallbackGroup: THREE.Group;
  private glbGroup: THREE.Group | null = null;
  private mixer: THREE.AnimationMixer | null = null;
  private mainRotorAction: THREE.AnimationAction | null = null;
  private doorAction: THREE.AnimationAction | null = null;
  private mainRotorNode: THREE.Object3D | null = null;
  private rearRotorNode: THREE.Object3D | null = null;
  private fallbackMainRotor: THREE.Object3D | null = null;
  private fallbackTailRotor: THREE.Object3D | null = null;
  private rotorBlurDisc: THREE.Mesh;
  private searchLight: THREE.SpotLight;
  private searchTarget: THREE.Object3D;
  private searchConeMesh: THREE.Mesh;
  private strobeMeshL: THREE.Mesh;
  private strobeMeshR: THREE.Mesh;
  private pilotGroup: THREE.Group;
  private isSearchlightOn = false;
  private wasPiloted = false;
  private animPhase = 0;

  public isLoaded = false;

  private static loadTemplate(): Promise<CachedHeliTemplate | null> {
    if (!HelicopterMesh.templatePromise) {
      const loader = new GLTFLoader();
      HelicopterMesh.templatePromise = loader
        .loadAsync(assetUrl('/assets/models/helicopter.glb'))
        .then((gltf) => {
          const box = new THREE.Box3().setFromObject(gltf.scene);
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxLen = Math.max(size.x, size.z, 1);
          // Target realistic ~8.4m fuselage+rotor footprint to fit Zenith Helipad cleanly
          const scale = 8.4 / maxLen;
          const groundOffset = -box.min.y * scale;
          gltf.scene.traverse((o) => {
            const m = o as THREE.Mesh;
            if (m.isMesh) {
              m.castShadow = true;
              m.receiveShadow = true;
            }
          });
          return {
            scene: gltf.scene,
            animations: gltf.animations ?? [],
            groundOffset,
            scale
          };
        })
        .catch(() => {
          // A transient fetch/decode failure must not permanently disable the real GLB.
          HelicopterMesh.templatePromise = null;
          return null;
        });
    }
    return HelicopterMesh.templatePromise;
  }

  constructor() {
    this.root = new THREE.Group();
    this.tiltGroup = new THREE.Group();
    this.fallbackGroup = new THREE.Group();
    this.root.add(this.tiltGroup);
    this.tiltGroup.add(this.fallbackGroup);

    this.buildFallbackHeli();
    this.pilotGroup = this.buildPilotSilhouette();
    this.pilotGroup.visible = false;
    this.tiltGroup.add(this.pilotGroup);

    this.rotorBlurDisc = this.buildRotorBlurDisc();
    this.tiltGroup.add(this.rotorBlurDisc);

    // Tail nav strobes (green starboard, red port)
    const strobeGeo = new THREE.SphereGeometry(0.11, 8, 8);
    this.strobeMeshL = new THREE.Mesh(strobeGeo, new THREE.MeshBasicMaterial({ color: 0xef4444 }));
    this.strobeMeshR = new THREE.Mesh(strobeGeo, new THREE.MeshBasicMaterial({ color: 0x22c55e }));
    this.strobeMeshL.position.set(-0.95, 1.55, -0.4);
    this.strobeMeshR.position.set(0.95, 1.55, -0.4);
    this.tiltGroup.add(this.strobeMeshL, this.strobeMeshR);

    // High-power nose searchlight + subtle volumetric cone
    this.searchLight = new THREE.SpotLight(0xe0f2fe, 0, 120, Math.PI * 0.2, 0.55, 1.1);
    this.searchLight.position.set(0, 0.8, -2.1);
    this.searchTarget = new THREE.Object3D();
    this.searchTarget.position.set(0, -18, -22);
    this.searchConeMesh = new THREE.Mesh(
      new THREE.ConeGeometry(4.5, 22, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xbae6fd,
        transparent: true,
        opacity: 0.11,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    this.searchConeMesh.rotation.x = Math.PI * 0.25;
    this.searchConeMesh.position.set(0, -7, -9.5);
    this.searchConeMesh.visible = false;
    this.tiltGroup.add(this.searchLight, this.searchTarget, this.searchConeMesh);
    this.searchLight.target = this.searchTarget;

    void this.attachGLB();
  }

  private async attachGLB(): Promise<void> {
    const tpl = await HelicopterMesh.loadTemplate();
    if (!tpl) return;
    const grp = tpl.scene.clone(true);
    // Helicopter.glb nose faces +Z; rotate PI around Y so forward aligns with -Z
    grp.rotation.y = Math.PI;
    grp.scale.setScalar(tpl.scale);
    grp.position.y = tpl.groundOffset;

    grp.traverse((o) => {
      if (o.name === 'main_rotor_') this.mainRotorNode = o;
      else if (o.name === 'rear_rotor') this.rearRotorNode = o;
      // Brighten cockpit/tail nav spheres so they glow cleanly at night
      if ((o as THREE.Mesh).isMesh) {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial;
        if (mat && mat.name === 'lights') {
          mat.emissive = new THREE.Color(0x38bdf8);
          mat.emissiveIntensity = 1.4;
        }
      }
    });

    if (tpl.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(grp);
      const rotorClip = tpl.animations.find((a) => /rotor/i.test(a.name));
      if (rotorClip) {
        this.mainRotorAction = this.mixer.clipAction(rotorClip);
        this.mainRotorAction.setLoop(THREE.LoopRepeat, Infinity);
        this.mainRotorAction.play();
        this.mainRotorAction.timeScale = 0;
      }
      const doorClip = tpl.animations.find((a) => /door/i.test(a.name));
      if (doorClip) {
        this.doorAction = this.mixer.clipAction(doorClip);
        this.doorAction.setLoop(THREE.LoopOnce, 1);
        this.doorAction.clampWhenFinished = true;
      }
    }

    // Align procedural rotor-blur disc height cleanly with the GLB rotor mast
    if (this.mainRotorNode) {
      grp.updateMatrixWorld(true);
      const wp = new THREE.Vector3();
      this.mainRotorNode.getWorldPosition(wp);
      this.rotorBlurDisc.position.y = wp.y;
    }

    this.glbGroup = grp;
    this.tiltGroup.add(grp);
    this.fallbackGroup.visible = false;
    this.isLoaded = true;
  }

  private buildFallbackHeli(): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35, metalness: 0.65 });
    const glassMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.12, metalness: 0.9, transparent: true, opacity: 0.7 });
    const trimMat = new THREE.MeshStandardMaterial({ color: 0xec4899, emissive: 0xec4899, emissiveIntensity: 0.6 });

    const pod = new THREE.Mesh(new THREE.BoxGeometry(1.7, 1.35, 3.6), bodyMat);
    pod.position.set(0, 1.15, 0);
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(1.48, 0.85, 1.5), glassMat);
    cockpit.position.set(0, 1.25, -1.6);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.45, 3.8), bodyMat);
    tail.position.set(0, 1.45, 3.1);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.15, 0.7), trimMat);
    fin.position.set(0, 1.85, 4.75);

    const skidGeo = new THREE.BoxGeometry(0.12, 0.1, 3.4);
    const skidL = new THREE.Mesh(skidGeo, bodyMat);
    skidL.position.set(-0.95, 0.05, 0);
    const skidR = new THREE.Mesh(skidGeo, bodyMat);
    skidR.position.set(0.95, 0.05, 0);

    const rotorHub = new THREE.Group();
    rotorHub.position.set(0, 2.5, 0);
    const bladeA = new THREE.Mesh(new THREE.BoxGeometry(8.2, 0.05, 0.24), bodyMat);
    const bladeB = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.05, 8.2), bodyMat);
    rotorHub.add(bladeA, bladeB);
    this.fallbackMainRotor = rotorHub;

    const tailHub = new THREE.Group();
    tailHub.position.set(0.26, 1.85, 4.75);
    tailHub.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.14), trimMat));
    this.fallbackTailRotor = tailHub;

    this.fallbackGroup.add(pod, cockpit, tail, fin, skidL, skidR, rotorHub, tailHub);
  }

  private buildPilotSilhouette(): THREE.Group {
    const grp = new THREE.Group();
    grp.position.set(-0.28, 1.05, -0.75);
    const suitMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 });
    const helmetMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.25, metalness: 0.4 });
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.2), suitMat);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), helmetMat);
    head.position.y = 0.28;
    grp.add(torso, head);
    return grp;
  }

  private buildRotorBlurDisc(): THREE.Mesh {
    if (!HelicopterMesh.sharedBlurTex) {
      const c = document.createElement('canvas');
      c.width = 128;
      c.height = 128;
      const ctx = c.getContext('2d')!;
      const g = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
      g.addColorStop(0, 'rgba(56, 189, 248, 0.32)');
      g.addColorStop(0.7, 'rgba(226, 232, 240, 0.16)');
      g.addColorStop(0.92, 'rgba(56, 189, 248, 0.28)');
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 128, 128);
      HelicopterMesh.sharedBlurTex = new THREE.CanvasTexture(c);
    }
    const geo = new THREE.PlaneGeometry(7.8, 7.8);
    geo.rotateX(-Math.PI * 0.5);
    const mat = new THREE.MeshBasicMaterial({
      map: HelicopterMesh.sharedBlurTex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = 2.6;
    return m;
  }

  public setSearchlight(enabled: boolean): void {
    this.isSearchlightOn = enabled;
    this.searchLight.intensity = enabled ? 85 : 0;
    this.searchConeMesh.visible = enabled;
  }

  public toggleSearchlight(): boolean {
    this.setSearchlight(!this.isSearchlightOn);
    return this.isSearchlightOn;
  }

  public get searchlightActive(): boolean {
    return this.isSearchlightOn;
  }

  public update(physics: HelicopterPhysics, dt: number): void {
    this.animPhase += dt;
    this.root.position.copy(physics.position);
    this.root.rotation.y = physics.yaw;
    this.tiltGroup.rotation.order = 'YXZ';
    this.tiltGroup.rotation.x = physics.pitch;
    this.tiltGroup.rotation.z = physics.roll;

    this.pilotGroup.visible = physics.isPiloted && !this.glbGroup;

    // Trigger door swing visual briefly when pilot boards or steps out
    if (physics.isPiloted !== this.wasPiloted) {
      this.wasPiloted = physics.isPiloted;
      if (this.doorAction) {
        this.doorAction.reset();
        this.doorAction.timeScale = physics.isPiloted ? 1.8 : -1.8;
        if (!physics.isPiloted) this.doorAction.time = this.doorAction.getClip().duration;
        this.doorAction.play();
      }
    }

    // Drive GLB animations & rotor speeds
    const rpm = physics.rotorRpm;
    if (this.mixer) {
      if (this.mainRotorAction) {
        this.mainRotorAction.timeScale = rpm * 5.2;
      }
      this.mixer.update(dt);
    }
    if (this.mainRotorNode && !this.mainRotorAction) {
      this.mainRotorNode.rotation.y += rpm * 32 * dt;
    }
    if (this.rearRotorNode) {
      this.rearRotorNode.rotation.x += rpm * 42 * dt;
    }
    if (this.fallbackMainRotor) {
      this.fallbackMainRotor.rotation.y += rpm * 30 * dt;
    }
    if (this.fallbackTailRotor) {
      this.fallbackTailRotor.rotation.x += rpm * 40 * dt;
    }

    // High-RPM blur disc fade-in
    const blurMat = this.rotorBlurDisc.material as THREE.MeshBasicMaterial;
    blurMat.opacity = rpm > 0.6 ? Math.min(0.72, (rpm - 0.6) * 1.8) : 0;
    this.rotorBlurDisc.rotation.y += rpm * 12 * dt;

    // Blinking aviation tail strobes when powered
    const strobeOn = physics.isPiloted || rpm > 0.05;
    const blink = Math.sin(this.animPhase * 8.0) > 0.55;
    this.strobeMeshL.visible = strobeOn && blink;
    this.strobeMeshR.visible = strobeOn && blink;
  }
}
