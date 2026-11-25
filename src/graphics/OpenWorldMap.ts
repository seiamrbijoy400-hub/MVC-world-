import * as THREE from 'three';
import { createAnimeWaterMaterial, type AnimeWaterUniforms } from './Shaders';
import type { TimeOfDay } from './TrackEnvironment';

export interface AABBCollider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
}

export interface RampBox {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  height: number;
  dir: 'NORTH' | 'SOUTH' | 'EAST' | 'WEST'; // direction ascending
}

export interface BoostPad {
  x: number;
  z: number;
  radius: number;
  dirX: number;
  dirZ: number;
}

export type DistrictId =
  | 'GP_CIRCUIT'
  | 'NEON_CORE'
  | 'STUNT_ARENA'
  | 'HARBOR_COAST'
  | 'MOUNTAIN_TOUGE';

export interface DistrictInfo {
  id: DistrictId;
  name: string;
  jpName: string;
  subtitle: string;
  accentColor: string;
}

export const DISTRICTS: Record<DistrictId, DistrictInfo> = {
  GP_CIRCUIT: {
    id: 'GP_CIRCUIT',
    name: 'Zenvo GP Circuit',
    jpName: 'ゼノボ・サーキット',
    subtitle: 'High-Speed Lake Grand Prix',
    accentColor: '#38bdf8'
  },
  NEON_CORE: {
    id: 'NEON_CORE',
    name: 'Neo Velo Core',
    jpName: 'ネオベロ都心',
    subtitle: 'Cyber Boulevards & Sakura Plaza',
    accentColor: '#ec4899'
  },
  STUNT_ARENA: {
    id: 'STUNT_ARENA',
    name: 'Apex Stunt & Soccer Park',
    jpName: 'スタント・アリーナ',
    subtitle: 'Mega Ramps & Rocket-Soccer Pitch',
    accentColor: '#f97316'
  },
  HARBOR_COAST: {
    id: 'HARBOR_COAST',
    name: 'Harbor & Coastal Strip',
    jpName: '湾岸ハーバー',
    subtitle: 'Container Yards, Pier Jump & Ocean Highway',
    accentColor: '#22d3ee'
  },
  MOUNTAIN_TOUGE: {
    id: 'MOUNTAIN_TOUGE',
    name: 'Apex Mountain Touge',
    jpName: '頂点・峠パス',
    subtitle: 'Elevated Drift Switchbacks & Summit Overlook',
    accentColor: '#facc15'
  }
};

interface SmashProp {
  mesh: THREE.Mesh;
  homePos: THREE.Vector3;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  rotVel: THREE.Vector3;
  smashed: boolean;
  respawnTimer: number;
}

export const WORLD_BOUNDS = {
  minX: -385,
  maxX: 330,
  minZ: -355,
  maxZ: 335
};

export class OpenWorldMap {
  public scene: THREE.Scene;
  public group: THREE.Group;
  public colliders: AABBCollider[] = [];
  public ramps: RampBox[] = [];
  public boostPads: BoostPad[] = [];

  // Giant Physics Soccer Ball in Playground
  public ballMesh: THREE.Mesh;
  public ballPos = new THREE.Vector3(174, 2.0, 90);
  public ballVel = new THREE.Vector3(0, 0, 0);
  public ballRadius = 2.0;

  public onGoalScored: (side: 'WEST' | 'EAST') => void = () => {};
  public onPropSmashed: (pos: THREE.Vector3) => void = () => {};
  private goalCooldown = 0;

  private buildingMats: THREE.MeshStandardMaterial[] = [];
  private roadMats: THREE.MeshStandardMaterial[] = [];
  private oceanUniforms: AnimeWaterUniforms | null = null;
  private smashProps: SmashProp[] = [];
  private tougeDeckZone = { minX: 60, maxX: 250, minZ: -340, maxZ: -252, height: 6.0 };

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.scene.add(this.group);

    this.createWorldBoundaryWall();
    this.createCityRoads();
    this.createCityBuildings();
    this.createHarborCoastDistrict();
    this.createMountainTougeDistrict();
    this.createStuntPlayground();
    this.ballMesh = this.createSoccerPlayground();
    this.createSmashableProps();
  }

  public getDistrictAt(x: number, z: number): DistrictId {
    if (x < 14 && z > -245) return 'GP_CIRCUIT';
    if (z <= -225) return 'MOUNTAIN_TOUGE';
    if (z >= 158) return 'HARBOR_COAST';
    if (x >= 48 && x <= 228 && z >= 42 && z <= 145) return 'STUNT_ARENA';
    return 'NEON_CORE';
  }

  public setTimeOfDay(tod: TimeOfDay): void {
    const emissiveBoost = tod === 'NIGHT' ? 1.45 : (tod === 'SUNSET' ? 0.95 : 0.28);
    for (const m of this.buildingMats) {
      m.emissiveIntensity = emissiveBoost;
    }
    if (this.oceanUniforms) {
      if (tod === 'NIGHT') {
        this.oceanUniforms.uShallowColor.value.set('#0284c7');
        this.oceanUniforms.uDeepColor.value.set('#020617');
        this.oceanUniforms.uFoamColor.value.set('#38bdf8');
        this.oceanUniforms.uSunDir.value.set(-0.4, 0.42, -0.82).normalize();
      } else if (tod === 'SUNSET') {
        this.oceanUniforms.uShallowColor.value.set('#0891b2');
        this.oceanUniforms.uDeepColor.value.set('#1e1b4b');
        this.oceanUniforms.uFoamColor.value.set('#fed7aa');
        this.oceanUniforms.uSunDir.value.set(0.55, 0.14, -0.82).normalize();
      } else {
        this.oceanUniforms.uShallowColor.value.set('#06b6d4');
        this.oceanUniforms.uDeepColor.value.set('#0c4a6e');
        this.oceanUniforms.uFoamColor.value.set('#e0f2fe');
        this.oceanUniforms.uSunDir.value.set(0.42, 0.48, -0.77).normalize();
      }
    }
  }

  public setWetSurface(wet: boolean): void {
    for (const m of this.roadMats) {
      m.roughness = wet ? 0.18 : 0.82;
      m.metalness = wet ? 0.35 : 0.08;
    }
  }

  private createWorldBoundaryWall(): void {
    const { minX, maxX, minZ, maxZ } = WORLD_BOUNDS;
    const width = maxX - minX;
    const depth = maxZ - minZ;
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;

    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.16,
      side: THREE.DoubleSide
    });
    const trimMat = new THREE.MeshBasicMaterial({ color: 0x0ea5e9 });

    const walls: [number, number, number, number][] = [
      [cx, minZ, width, 0.3],
      [cx, maxZ, width, 0.3],
      [minX, cz, 0.3, depth],
      [maxX, cz, 0.3, depth]
    ];

    for (const [wx, wz, sx, sz] of walls) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, 3.6, sz), wallMat);
      m.position.set(wx, 1.8, wz);
      this.group.add(m);

      const topRail = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.1, 0.24, sz + 0.1), trimMat);
      topRail.position.set(wx, 3.6, wz);
      this.group.add(topRail);
    }
  }

  private createCityRoadTexture(isHorizontal: boolean): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#1b1f27';
    ctx.fillRect(0, 0, 256, 256);

    ctx.fillStyle = '#94a3b8';
    if (isHorizontal) {
      ctx.fillRect(0, 0, 256, 12);
      ctx.fillRect(0, 244, 256, 12);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(0, 124, 256, 3);
      ctx.fillRect(0, 130, 256, 3);
    } else {
      ctx.fillRect(0, 0, 12, 256);
      ctx.fillRect(244, 0, 12, 256);
      ctx.fillStyle = '#facc15';
      ctx.fillRect(124, 0, 3, 256);
      ctx.fillRect(130, 0, 3, 256);
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  private createCityPlazaTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#2d3748';
    ctx.fillRect(0, 0, 256, 256);

    ctx.strokeStyle = 'rgba(15, 23, 42, 0.42)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 256; i += 32) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 256); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(256, i); ctx.stroke();
    }
    for (let i = 0; i < 650; i++) {
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.06)';
      ctx.fillRect(Math.random() * 252, Math.random() * 252, 4, 4);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(22, 42);
    return tex;
  }

  private createCityRoads(): void {
    // Base city deck ends cleanly at z = 232 where the Harbor Concrete Quay begins
    const plazaGeo = new THREE.PlaneGeometry(315, 576);
    plazaGeo.rotateX(-Math.PI * 0.5);
    const plazaMat = new THREE.MeshStandardMaterial({ map: this.createCityPlazaTexture(), roughness: 0.88 });
    this.roadMats.push(plazaMat);
    const plaza = new THREE.Mesh(plazaGeo, plazaMat);
    plaza.position.set(174, -0.02, -56);
    plaza.receiveShadow = true;
    this.group.add(plaza);

    const nsRoadMat = new THREE.MeshStandardMaterial({ map: this.createCityRoadTexture(false), roughness: 0.8 });
    const ewRoadMat = new THREE.MeshStandardMaterial({ map: this.createCityRoadTexture(true), roughness: 0.8 });
    this.roadMats.push(nsRoadMat, ewRoadMat);

    const avenues = [46, 122, 224, 296];
    for (const ax of avenues) {
      const roadGeo = new THREE.PlaneGeometry(16, 540);
      roadGeo.rotateX(-Math.PI * 0.5);
      const road = new THREE.Mesh(roadGeo, nsRoadMat);
      road.position.set(ax, 0.02, -35);
      road.receiveShadow = true;
      this.group.add(road);
    }

    const streets = [-160, -40, 30, 150, 224];
    for (const sz of streets) {
      const isConnector = sz === -160 || sz === -40 || sz === 30;
      const startX = isConnector ? 7 : 38;
      const endX = 312;
      const len = endX - startX;
      const roadGeo = new THREE.PlaneGeometry(len, 16);
      roadGeo.rotateX(-Math.PI * 0.5);
      const road = new THREE.Mesh(roadGeo, ewRoadMat);
      road.position.set(startX + len * 0.5, 0.03, sz);
      road.receiveShadow = true;
      this.group.add(road);
    }

    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xe2e8f0 });
    const stripeGeo = new THREE.PlaneGeometry(1.1, 3.2);
    stripeGeo.rotateX(-Math.PI * 0.5);
    const matrices: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();
    for (const ax of avenues) {
      for (const sz of streets) {
        for (let s = -2; s <= 2; s++) {
          dummy.position.set(ax + s * 2.3, 0.042, sz - 9.2);
          dummy.updateMatrix();
          matrices.push(dummy.matrix.clone());
          dummy.position.set(ax + s * 2.3, 0.042, sz + 9.2);
          dummy.updateMatrix();
          matrices.push(dummy.matrix.clone());
        }
      }
    }
    const zebraInst = new THREE.InstancedMesh(stripeGeo, stripeMat, matrices.length);
    matrices.forEach((m, i) => zebraInst.setMatrixAt(i, m));
    zebraInst.instanceMatrix.needsUpdate = true;
    this.group.add(zebraInst);
  }

  private createBuildingTexture(accentHex: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 512;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, 256, 512);

    for (let y = 24; y < 480; y += 26) {
      for (let x = 16; x < 240; x += 26) {
        const lit = Math.random() > 0.3;
        ctx.fillStyle = lit ? (Math.random() > 0.78 ? accentHex : '#bae6fd') : '#162033';
        ctx.fillRect(x, y, 16, 16);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    return tex;
  }

  private createCityBuildings(): void {
    const neonColors = ['#38bdf8', '#ff5500', '#ec4899', '#facc15', '#22c55e'];

    const buildingSpecs: { x: number; z: number; w: number; d: number; h: number; label?: string }[] = [
      { x: 84, z: -200, w: 38, d: 34, h: 48, label: 'APEX ZERO' },
      { x: 172, z: -200, w: 48, d: 36, h: 66, label: 'AKIBA CYBER' },
      { x: 260, z: -200, w: 36, d: 34, h: 52, label: 'TOUGE CLUB' },
      { x: 84, z: -100, w: 40, d: 52, h: 38, label: 'ANIME CAFE' },
      { x: 158, z: -100, w: 34, d: 50, h: 58 },
      { x: 196, z: -100, w: 26, d: 44, h: 44 },
      { x: 260, z: -100, w: 34, d: 52, h: 60, label: 'NEO RAMEN' },
      { x: 84, z: -5, w: 42, d: 28, h: 30, label: 'DRIFT GARAGE' },
      { x: 162, z: -5, w: 42, d: 28, h: 46, label: 'METRO ARCADE' },
      { x: 204, z: -5, w: 24, d: 28, h: 36 },
      { x: 260, z: -5, w: 36, d: 28, h: 50, label: 'ZENITH CORP' },
      { x: 84, z: 188, w: 44, d: 30, h: 32, label: 'HARBOR INN' },
      { x: 172, z: 188, w: 50, d: 30, h: 52, label: 'STADIUM HOTEL' },
      { x: 318, z: -100, w: 18, d: 62, h: 72 },
      { x: 318, z: -5, w: 18, d: 34, h: 48 },
      { x: 318, z: 90, w: 18, d: 70, h: 58 }
    ];

    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.65, metalness: 0.2 });
    const plinthMat = new THREE.MeshStandardMaterial({ color: 0x161e2e, roughness: 0.78, metalness: 0.15 });
    const canopyMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5, metalness: 0.4 });
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.8 });
    const baseTexCache = new Map<string, THREE.CanvasTexture>();
    const facadeMatCache = new Map<string, THREE.MeshStandardMaterial>();
    const neonMatCache = new Map<string, THREE.MeshBasicMaterial>();

    const getFacadeMat = (accent: string, span: number, height: number): THREE.MeshStandardMaterial => {
      const rx = Math.max(1, Math.round(span / 24));
      const ry = Math.max(1, Math.round(height / 36));
      const key = `${accent}:${rx}:${ry}`;
      let mat = facadeMatCache.get(key);
      if (!mat) {
        let baseTex = baseTexCache.get(accent);
        if (!baseTex) {
          baseTex = this.createBuildingTexture(accent);
          baseTexCache.set(accent, baseTex);
        }
        const scaledTex = baseTex.clone();
        scaledTex.repeat.set(rx, ry);
        scaledTex.needsUpdate = true;
        mat = new THREE.MeshStandardMaterial({
          map: scaledTex,
          emissiveMap: scaledTex,
          emissive: new THREE.Color('#ffffff'),
          emissiveIntensity: 0.85,
          roughness: 0.42,
          metalness: 0.25
        });
        facadeMatCache.set(key, mat);
        this.buildingMats.push(mat);
      }
      return mat;
    };

    const getNeonMat = (accent: string): THREE.MeshBasicMaterial => {
      let mat = neonMatCache.get(accent);
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({ color: accent });
        neonMatCache.set(accent, mat);
      }
      return mat;
    };

    buildingSpecs.forEach((b, idx) => {
      const accent = neonColors[idx % neonColors.length];
      const fbMat = getFacadeMat(accent, b.w, b.h);
      const sideMat = getFacadeMat(accent, b.d, b.h);
      const neonMat = getNeonMat(accent);

      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.w, b.h, b.d),
        [sideMat, sideMat, roofMat, roofMat, fbMat, fbMat]
      );
      mesh.position.set(b.x, b.h * 0.5, b.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);

      // Ground-floor architectural plinth / sidewalk & storefront awning so buildings feel grounded
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(b.w + 2.4, 0.32, b.d + 2.4), plinthMat);
      plinth.position.set(b.x, 0.16, b.z);
      plinth.receiveShadow = true;
      this.group.add(plinth);

      if (b.label) {
        for (const faceZ of [1, -1]) {
          const canopy = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.78, 0.35, 2.2), canopyMat);
          canopy.position.set(b.x, 4.4, b.z + faceZ * (b.d * 0.5 + 1.0));
          const shopBand = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.66, 2.9, 0.22), neonMat);
          shopBand.position.set(b.x, 1.8, b.z + faceZ * (b.d * 0.5 + 0.08));
          this.group.add(canopy, shopBand);
        }
      }

      if (b.h >= 44) {
        const tierH = 10;
        const tier = new THREE.Mesh(
          new THREE.BoxGeometry(b.w * 0.65, tierH, b.d * 0.65),
          [sideMat, sideMat, roofMat, roofMat, fbMat, fbMat]
        );
        tier.position.set(b.x, b.h + tierH * 0.5, b.z);
        tier.castShadow = true;
        this.group.add(tier);
      } else {
        // Low-rise rooftop HVAC / utility unit for silhouette variety
        const hvac = new THREE.Mesh(new THREE.BoxGeometry(b.w * 0.26, 2.2, b.d * 0.26), roofMat);
        hvac.position.set(b.x - b.w * 0.18, b.h + 1.1, b.z + b.d * 0.14);
        this.group.add(hvac);
      }

      const neonTrim = new THREE.Mesh(new THREE.BoxGeometry(b.w + 0.45, 0.7, b.d + 0.45), neonMat);
      neonTrim.position.set(b.x, b.h - 0.5, b.z);
      this.group.add(neonTrim);

      if (idx % 2 === 0) {
        const stripGeo = new THREE.BoxGeometry(0.42, b.h - 2, 0.42);
        const s1 = new THREE.Mesh(stripGeo, neonMat);
        s1.position.set(b.x - b.w * 0.5 - 0.1, b.h * 0.5, b.z + b.d * 0.5 + 0.1);
        const s2 = new THREE.Mesh(stripGeo, neonMat);
        s2.position.set(b.x + b.w * 0.5 + 0.1, b.h * 0.5, b.z - b.d * 0.5 - 0.1);
        this.group.add(s1, s2);
      }

      this.colliders.push({
        minX: b.x - b.w * 0.5 - 0.4,
        maxX: b.x + b.w * 0.5 + 0.4,
        minZ: b.z - b.d * 0.5 - 0.4,
        maxZ: b.z + b.d * 0.5 + 0.4,
        height: b.h
      });

      if (b.label) {
        const sCanvas = document.createElement('canvas');
        sCanvas.width = 256;
        sCanvas.height = 64;
        const sCtx = sCanvas.getContext('2d')!;
        sCtx.fillStyle = '#090d16';
        sCtx.fillRect(0, 0, 256, 64);
        sCtx.strokeStyle = accent;
        sCtx.lineWidth = 5;
        sCtx.strokeRect(3, 3, 250, 58);
        sCtx.fillStyle = '#ffffff';
        sCtx.font = 'bold 26px sans-serif';
        sCtx.textAlign = 'center';
        sCtx.textBaseline = 'middle';
        sCtx.fillText(b.label, 128, 32);

        const sTex = new THREE.CanvasTexture(sCanvas);
        const signMat = new THREE.MeshBasicMaterial({ map: sTex });
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(b.w * 0.72, 4.5),
          signMat
        );
        sign.position.set(b.x, Math.min(b.h - 4, 12), b.z + b.d * 0.5 + 0.25);
        this.group.add(sign);

        // Rotate north-facing sign 180° around Y so text never renders mirrored!
        const signBack = new THREE.Mesh(new THREE.PlaneGeometry(b.w * 0.72, 4.5), signMat);
        signBack.position.set(b.x, Math.min(b.h - 4, 12), b.z - b.d * 0.5 - 0.25);
        signBack.rotation.y = Math.PI;
        this.group.add(signBack);
      }

      if (b.h > 44) {
        const spire = new THREE.Mesh(
          new THREE.CylinderGeometry(0.15, 0.45, 11, 6),
          spireMat
        );
        spire.position.set(b.x, b.h + 15.5, b.z);
        this.group.add(spire);
      }
    });

    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 2.7, 6);
    trunkGeo.translate(0, 1.35, 0);
    const crownGeo = new THREE.DodecahedronGeometry(1.8, 0);
    crownGeo.translate(0, 3.6, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x452f21, roughness: 0.9 });
    const sakuraMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.72 });

    const treeSpots: [number, number][] = [];
    for (const tz of [-115, -75, 5, 165, 206]) {
      for (const tx of [33, 59, 109, 135, 238, 282]) {
        treeSpots.push([tx, tz]);
      }
    }
    const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
    const crownInst = new THREE.InstancedMesh(crownGeo, sakuraMat, treeSpots.length);
    crownInst.castShadow = true;
    const dummy = new THREE.Object3D();
    treeSpots.forEach(([tx, tz], i) => {
      dummy.position.set(tx, 0, tz);
      dummy.rotation.set(0, i * 1.1, 0);
      dummy.scale.setScalar(0.9 + (i % 3) * 0.14);
      dummy.updateMatrix();
      trunkInst.setMatrixAt(i, dummy.matrix);
      crownInst.setMatrixAt(i, dummy.matrix);
    });
    trunkInst.instanceMatrix.needsUpdate = true;
    crownInst.instanceMatrix.needsUpdate = true;
    this.group.add(trunkInst, crownInst);

    const poleGeo = new THREE.CylinderGeometry(0.14, 0.18, 6.4, 8);
    poleGeo.translate(0, 3.2, 0);
    const bulbGeo = new THREE.BoxGeometry(1.1, 0.25, 0.45);
    bulbGeo.translate(0.5, 6.2, 0);
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7 });
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });

    const lampCoords: [number, number][] = [];
    for (const ax of [37, 131, 233]) {
      for (let z = -190; z <= 210; z += 44) {
        lampCoords.push([ax, z]);
      }
    }
    const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, lampCoords.length);
    const bulbInst = new THREE.InstancedMesh(bulbGeo, bulbMat, lampCoords.length);
    lampCoords.forEach(([lx, lz], i) => {
      dummy.position.set(lx, 0, lz);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      poleInst.setMatrixAt(i, dummy.matrix);
      bulbInst.setMatrixAt(i, dummy.matrix);
    });
    poleInst.instanceMatrix.needsUpdate = true;
    bulbInst.instanceMatrix.needsUpdate = true;
    this.group.add(poleInst, bulbInst);
  }

  private createHarborCoastDistrict(): void {
    // Ocean starts cleanly south of the Harbor Concrete Quay (z = 268)
    const oceanGeo = new THREE.PlaneGeometry(360, 110, 40, 16);
    oceanGeo.rotateX(-Math.PI * 0.5);
    const oceanSetup = createAnimeWaterMaterial(0.0);
    this.oceanUniforms = oceanSetup.uniforms;
    const oceanMesh = new THREE.Mesh(oceanGeo, oceanSetup.material);
    oceanMesh.position.set(175, -0.8, 323);
    this.group.add(oceanMesh);

    // Harbor Concrete Quay spanning full waterfront (houses cargo containers, shards #08/#10, lighthouse)
    const quayMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.82 });
    this.roadMats.push(quayMat);
    const quay = new THREE.Mesh(new THREE.BoxGeometry(282, 0.4, 38), quayMat);
    quay.position.set(176, -0.15, 250);
    quay.receiveShadow = true;
    this.group.add(quay);

    // Waterfront safety rail along z = 268 (gap at x = 140..196 for the South Stunt Pier)
    const railMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.5, metalness: 0.35 });
    const westRail = new THREE.Mesh(new THREE.BoxGeometry(105, 0.7, 0.45), railMat);
    westRail.position.set(87.5, 0.35, 268);
    const eastRail = new THREE.Mesh(new THREE.BoxGeometry(121, 0.7, 0.45), railMat);
    eastRail.position.set(256.5, 0.35, 268);
    this.group.add(westRail, eastRail);

    const pierGeo = new THREE.BoxGeometry(56, 0.4, 34);
    const pierMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 });
    const pier = new THREE.Mesh(pierGeo, pierMat);
    pier.position.set(168, -0.15, 282);
    pier.receiveShadow = true;
    this.group.add(pier);

    const containerSpecs: { x: number; z: number; w: number; d: number; h: number; color: number }[] = [
      { x: 64, z: 248, w: 16, d: 6, h: 6.5, color: 0xdc2626 },
      { x: 84, z: 248, w: 16, d: 6, h: 3.4, color: 0x2563eb },
      { x: 256, z: 248, w: 18, d: 7, h: 6.5, color: 0xf97316 },
      { x: 278, z: 248, w: 16, d: 7, h: 3.4, color: 0x16a34a }
    ];
    for (const c of containerSpecs) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(c.w, c.h, c.d),
        new THREE.MeshStandardMaterial({ color: c.color, roughness: 0.55, metalness: 0.35 })
      );
      m.position.set(c.x, c.h * 0.5, c.z);
      m.castShadow = true;
      m.receiveShadow = true;
      this.group.add(m);
      this.colliders.push({
        minX: c.x - c.w * 0.5,
        maxX: c.x + c.w * 0.5,
        minZ: c.z - c.d * 0.5,
        maxZ: c.z + c.d * 0.5,
        height: c.h
      });
    }

    const lhBase = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 3.8, 22, 12),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 })
    );
    lhBase.position.set(298, 11, 258);
    lhBase.castShadow = true;
    const lhBand = new THREE.Mesh(
      new THREE.CylinderGeometry(2.9, 3.2, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xef4444 })
    );
    lhBand.position.set(298, 13, 258);
    const lhBeacon = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 2.6, 12),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );
    lhBeacon.position.set(298, 23, 258);
    this.group.add(lhBase, lhBand, lhBeacon);
    this.colliders.push({ minX: 294, maxX: 302, minZ: 254, maxZ: 262, height: 24 });

    this.addRamp(168, 278, 12, 16, 4.2, 'SOUTH', 0x22d3ee);
    this.boostPads.push({ x: 168, z: 256, radius: 3.8, dirX: 0, dirZ: 1 });
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(5.5, 7.5),
      new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide })
    );
    pad.rotation.x = -Math.PI * 0.5;
    pad.position.set(168, 0.08, 256);
    this.group.add(pad);
  }

  private createMountainTougeDistrict(): void {
    // Ramps span x=38..60 (EAST) and x=250..272 (WEST) so they meet tougeDeckZone [60..250] seamlessly!
    this.addRamp(49, -296, 24, 22, 6.0, 'EAST', 0x334155);
    this.addRamp(261, -296, 24, 22, 6.0, 'WEST', 0x334155);

    const deckGeo = new THREE.BoxGeometry(190, 6.0, 88);
    const deckMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.78 });
    this.roadMats.push(deckMat);
    const deck = new THREE.Mesh(deckGeo, deckMat);
    deck.position.set(155, 3.0, -296);
    deck.receiveShadow = true;
    deck.castShadow = true;
    this.group.add(deck);

    // Touge centerline stripe on the deck so players can read the racing line
    const tougeLine = new THREE.Mesh(
      new THREE.PlaneGeometry(186, 0.45),
      new THREE.MeshBasicMaterial({ color: 0xfacc15 })
    );
    tougeLine.rotation.x = -Math.PI * 0.5;
    tougeLine.position.set(155, 6.02, -296);
    this.group.add(tougeLine);

    const edgeMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const northRail = new THREE.Mesh(new THREE.BoxGeometry(190, 0.7, 0.4), edgeMat);
    northRail.position.set(155, 6.35, -340);
    const southRail = new THREE.Mesh(new THREE.BoxGeometry(190, 0.7, 0.4), edgeMat);
    southRail.position.set(155, 6.35, -252);
    this.group.add(northRail, southRail);

    const toriiMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 });
    const pL = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 9, 10), toriiMat);
    pL.position.set(155, 10.5, -308);
    const pR = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 9, 10), toriiMat);
    pR.position.set(155, 10.5, -284);
    const topBeam = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.1, 28), toriiMat);
    topBeam.position.set(155, 14.8, -296);
    this.group.add(pL, pR, topBeam);
    this.colliders.push(
      { minX: 154.3, maxX: 155.7, minZ: -308.7, maxZ: -307.3, height: 15 },
      { minX: 154.3, maxX: 155.7, minZ: -284.7, maxZ: -283.3, height: 15 }
    );

    const ewRoadMat = new THREE.MeshStandardMaterial({ map: this.createCityRoadTexture(false), roughness: 0.8 });
    this.roadMats.push(ewRoadMat);
    for (const ax of [32, 278]) {
      const roadGeo = new THREE.PlaneGeometry(16, 152);
      roadGeo.rotateX(-Math.PI * 0.5);
      const road = new THREE.Mesh(roadGeo, ewRoadMat);
      road.position.set(ax, 0.03, -234);
      road.receiveShadow = true;
      this.group.add(road);

      // Paved turning apron connecting N-S road to ramp entrance
      const apronGeo = new THREE.PlaneGeometry(20, 26);
      apronGeo.rotateX(-Math.PI * 0.5);
      const apron = new THREE.Mesh(apronGeo, deckMat);
      apron.position.set(ax === 32 ? 34 : 276, 0.035, -296);
      apron.receiveShadow = true;
      this.group.add(apron);
    }
  }

  private addRamp(cx: number, cz: number, w: number, l: number, h: number, dir: RampBox['dir'], color: number): void {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(l, 0);
    shape.lineTo(l, h);
    shape.closePath();

    const geo = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
    geo.translate(-l * 0.5, 0, -w * 0.5);

    const rampMat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.2 });
    const mesh = new THREE.Mesh(geo, rampMat);
    mesh.position.set(cx, 0, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    if (dir === 'NORTH') mesh.rotation.y = Math.PI * 0.5;
    else if (dir === 'SOUTH') mesh.rotation.y = -Math.PI * 0.5;
    else if (dir === 'WEST') mesh.rotation.y = Math.PI;

    this.group.add(mesh);

    const halfX = (dir === 'EAST' || dir === 'WEST') ? l * 0.5 : w * 0.5;
    const halfZ = (dir === 'EAST' || dir === 'WEST') ? w * 0.5 : l * 0.5;
    this.ramps.push({
      minX: cx - halfX,
      maxX: cx + halfX,
      minZ: cz - halfZ,
      maxZ: cz + halfZ,
      height: h,
      dir
    });
  }

  private createStuntPlayground(): void {
    const floorGeo = new THREE.PlaneGeometry(56, 92);
    floorGeo.rotateX(-Math.PI * 0.5);
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
    this.roadMats.push(floorMat);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.position.set(84, 0.03, 90);
    floor.receiveShadow = true;
    this.group.add(floor);

    this.addRamp(72, 65, 9, 14, 3.4, 'SOUTH', 0xf97316);
    this.addRamp(96, 115, 9, 14, 3.4, 'NORTH', 0x38bdf8);
    this.addRamp(84, 90, 10, 12, 2.8, 'EAST', 0xec4899);

    const addBoost = (x: number, z: number, dx: number, dz: number) => {
      const pad = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 7),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, side: THREE.DoubleSide })
      );
      pad.rotation.x = -Math.PI * 0.5;
      pad.position.set(x, 0.06, z);
      this.group.add(pad);
      this.boostPads.push({ x, z, radius: 3.6, dirX: dx, dirZ: dz });
    };
    addBoost(72, 52, 0, 1);
    addBoost(96, 128, 0, -1);
  }

  private createSoccerPlayground(): THREE.Mesh {
    const pitchGeo = new THREE.PlaneGeometry(80, 84);
    pitchGeo.rotateX(-Math.PI * 0.5);
    const pitchMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.85 });
    const pitch = new THREE.Mesh(pitchGeo, pitchMat);
    pitch.position.set(174, 0.03, 90);
    pitch.receiveShadow = true;
    this.group.add(pitch);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(9.5, 10.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xf8fafc, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI * 0.5;
    ring.position.set(174, 0.05, 90);
    this.group.add(ring);

    const wallMat = new THREE.MeshBasicMaterial({
      color: 0x4ade80,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide
    });
    const northWall = new THREE.Mesh(new THREE.PlaneGeometry(80, 2.2), wallMat);
    northWall.position.set(174, 1.1, 48);
    const southWall = new THREE.Mesh(new THREE.PlaneGeometry(80, 2.2), wallMat);
    southWall.position.set(174, 1.1, 132);
    this.group.add(northWall, southWall);

    const postMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, emissive: 0xca8a04, emissiveIntensity: 0.5 });
    for (const gx of [134, 214]) {
      const crossbar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 18), postMat);
      crossbar.position.set(gx, 6.0, 90);
      const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6.0, 0.6), postMat);
      p1.position.set(gx, 3.0, 81);
      const p2 = new THREE.Mesh(new THREE.BoxGeometry(0.6, 6.0, 0.6), postMat);
      p2.position.set(gx, 3.0, 99);
      this.group.add(crossbar, p1, p2);
    }

    const ballCanvas = document.createElement('canvas');
    ballCanvas.width = 256;
    ballCanvas.height = 128;
    const ctx = ballCanvas.getContext('2d')!;
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#0f172a';
    for (let x = 16; x < 256; x += 48) {
      for (let y = 16; y < 128; y += 48) {
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const ballTex = new THREE.CanvasTexture(ballCanvas);
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(this.ballRadius, 24, 24),
      new THREE.MeshStandardMaterial({ map: ballTex, roughness: 0.4 })
    );
    ball.position.copy(this.ballPos);
    ball.castShadow = true;
    this.group.add(ball);
    return ball;
  }

  private createSmashableProps(): void {
    const coneGeo = new THREE.ConeGeometry(0.45, 1.15, 8);
    coneGeo.translate(0, 0.57, 0);
    const coneMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      emissive: 0xea580c,
      emissiveIntensity: 0.35,
      roughness: 0.4
    });

    const coords: [number, number][] = [
      [42, -32], [50, -32], [42, 22], [50, 22],
      [118, -32], [126, -32], [118, 22], [126, 22],
      [68, 56], [76, 56], [92, 124], [100, 124],
      [148, 220], [156, 220], [180, 220], [188, 220],
      [220, -155], [228, -155], [42, -155], [50, -155]
    ];

    for (const [cx, cz] of coords) {
      const m = new THREE.Mesh(coneGeo, coneMat);
      m.position.set(cx, 0, cz);
      m.castShadow = true;
      this.group.add(m);
      this.smashProps.push({
        mesh: m,
        homePos: new THREE.Vector3(cx, 0, cz),
        pos: new THREE.Vector3(cx, 0, cz),
        vel: new THREE.Vector3(),
        rotVel: new THREE.Vector3(),
        smashed: false,
        respawnTimer: 0
      });
    }
  }

  public updateWorldDynamics(
    dt: number,
    timeSec: number,
    playerPos: THREE.Vector3,
    playerVel: THREE.Vector3,
    inCar: boolean
  ): void {
    if (this.oceanUniforms) {
      this.oceanUniforms.uTime.value = timeSec;
    }

    const playerSpeed = Math.hypot(playerVel.x, playerVel.z);
    for (const p of this.smashProps) {
      if (p.smashed) {
        p.respawnTimer -= dt;
        p.vel.y -= 24 * dt;
        p.pos.addScaledVector(p.vel, dt);
        if (p.pos.y < 0) {
          p.pos.y = 0;
          p.vel.y *= -0.4;
          p.vel.x *= 0.82;
          p.vel.z *= 0.82;
        }
        p.mesh.position.copy(p.pos);
        p.mesh.rotation.x += p.rotVel.x * dt;
        p.mesh.rotation.z += p.rotVel.z * dt;

        if (p.respawnTimer <= 0) {
          p.smashed = false;
          p.pos.copy(p.homePos);
          p.vel.set(0, 0, 0);
          p.mesh.position.copy(p.homePos);
          p.mesh.rotation.set(0, 0, 0);
        }
      } else {
        const dx = p.pos.x - playerPos.x;
        const dz = p.pos.z - playerPos.z;
        const hitRad = inCar ? 2.1 : 1.0;
        if (dx * dx + dz * dz < hitRad * hitRad && playerSpeed > 2.5) {
          p.smashed = true;
          p.respawnTimer = 18.0;
          const d = Math.max(0.1, Math.hypot(dx, dz));
          p.vel.set(
            playerVel.x * 1.3 + (dx / d) * 6,
            4.5 + Math.min(8, playerSpeed * 0.25),
            playerVel.z * 1.3 + (dz / d) * 6
          );
          p.rotVel.set((Math.random() - 0.5) * 14, 0, (Math.random() - 0.5) * 14);
          this.onPropSmashed(p.pos);
        }
      }
    }
  }

  public isInsideCityOrPlayground(x: number, z: number): boolean {
    if (x >= 6 && x <= WORLD_BOUNDS.maxX && z >= -345 && z <= 296) return true;
    return false;
  }

  public sampleRampHeight(x: number, z: number): number {
    let maxH = 0;
    const td = this.tougeDeckZone;
    if (x >= td.minX && x <= td.maxX && z >= td.minZ && z <= td.maxZ) {
      maxH = td.height;
    }
    for (const r of this.ramps) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) {
        let t = 0;
        if (r.dir === 'EAST') t = (x - r.minX) / (r.maxX - r.minX);
        else if (r.dir === 'WEST') t = (r.maxX - x) / (r.maxX - r.minX);
        else if (r.dir === 'SOUTH') t = (z - r.minZ) / (r.maxZ - r.minZ);
        else if (r.dir === 'NORTH') t = (r.maxZ - z) / (r.maxZ - r.minZ);
        maxH = Math.max(maxH, Math.max(0, Math.min(1, t)) * r.height);
      }
    }
    return maxH;
  }

  private resolveCircleVsAABB(
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    radius: number,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number
  ): boolean {
    const closestX = Math.max(minX, Math.min(pos.x, maxX));
    const closestZ = Math.max(minZ, Math.min(pos.z, maxZ));
    const dx = pos.x - closestX;
    const dz = pos.z - closestZ;
    const distSq = dx * dx + dz * dz;
    if (distSq >= radius * radius) return false;

    const dist = Math.sqrt(distSq);
    if (dist > 0.0001) {
      const nx = dx / dist;
      const nz = dz / dist;
      const overlap = radius - dist;
      pos.x += nx * overlap;
      pos.z += nz * overlap;
      const vDot = vel.x * nx + vel.z * nz;
      if (vDot < 0) {
        vel.x -= 1.35 * vDot * nx;
        vel.z -= 1.35 * vDot * nz;
      }
    } else {
      pos.x += radius;
    }
    return true;
  }

  public clampCameraToWorld(focus: THREE.Vector3, desiredCam: THREE.Vector3, margin = 0.55): THREE.Vector3 {
    const out = desiredCam.clone();
    out.x = THREE.MathUtils.clamp(out.x, WORLD_BOUNDS.minX + margin, WORLD_BOUNDS.maxX - margin);
    out.z = THREE.MathUtils.clamp(out.z, WORLD_BOUNDS.minZ + margin, WORLD_BOUNDS.maxZ - margin);

    const dir = out.clone().sub(focus);
    const totalLen = dir.length();
    if (totalLen < 0.1) return out;
    dir.divideScalar(totalLen);

    for (let step = 1; step <= 6; step++) {
      const d = (step / 6) * totalLen;
      const sx = focus.x + dir.x * d;
      const sy = focus.y + dir.y * d;
      const sz = focus.z + dir.z * d;
      for (const b of this.colliders) {
        if (sy < b.height && sx > b.minX - margin && sx < b.maxX + margin && sz > b.minZ - margin && sz < b.maxZ + margin) {
          const safeDist = Math.max(1.2, ((step - 1) / 6) * totalLen);
          return focus.clone().addScaledVector(dir, safeDist);
        }
      }
    }
    return out;
  }

  public resolveCollision(pos: THREE.Vector3, vel: THREE.Vector3, radius: number): boolean {
    let hit = false;

    if (pos.x < WORLD_BOUNDS.minX + radius) { pos.x = WORLD_BOUNDS.minX + radius; if (vel.x < 0) vel.x *= -0.4; hit = true; }
    if (pos.x > WORLD_BOUNDS.maxX - radius) { pos.x = WORLD_BOUNDS.maxX - radius; if (vel.x > 0) vel.x *= -0.4; hit = true; }
    if (pos.z < WORLD_BOUNDS.minZ + radius) { pos.z = WORLD_BOUNDS.minZ + radius; if (vel.z < 0) vel.z *= -0.4; hit = true; }
    if (pos.z > WORLD_BOUNDS.maxZ - radius) { pos.z = WORLD_BOUNDS.maxZ - radius; if (vel.z > 0) vel.z *= -0.4; hit = true; }

    // Harbor seawall at z = 268 (open across pier x = 140..196 up to z = 296)
    if (pos.z > 268 - radius && !(pos.x >= 140 && pos.x <= 196 && pos.z <= 296)) {
      pos.z = 268 - radius;
      if (vel.z > 0) vel.z *= -0.35;
      hit = true;
    }

    for (const b of this.colliders) {
      if (pos.y < b.height && this.resolveCircleVsAABB(pos, vel, radius, b.minX, b.maxX, b.minZ, b.maxZ)) {
        hit = true;
      }
    }

    const td = this.tougeDeckZone;
    const onTougeRampMouth = pos.z >= -308 && pos.z <= -284;
    if (pos.y < td.height - 0.8 && !(onTougeRampMouth && pos.y >= 4.2)) {
      if (this.resolveCircleVsAABB(pos, vel, radius, td.minX, td.maxX, td.minZ, td.maxZ)) {
        hit = true;
      }
    } else if (pos.x >= td.minX && pos.x <= td.maxX && pos.z >= td.minZ && pos.z <= td.maxZ) {
      if (pos.z < td.minZ + 1.4) { pos.z = td.minZ + 1.4; if (vel.z < 0) vel.z *= -0.5; hit = true; }
      if (pos.z > td.maxZ - 1.4) { pos.z = td.maxZ - 1.4; if (vel.z > 0) vel.z *= -0.5; hit = true; }
    }

    for (const r of this.ramps) {
      const onEntrySide = (r.dir === 'SOUTH' && pos.z <= r.minZ + 2.5)
        || (r.dir === 'NORTH' && pos.z >= r.maxZ - 2.5)
        || (r.dir === 'EAST' && pos.x <= r.minX + 2.5)
        || (r.dir === 'WEST' && pos.x >= r.maxX - 2.5);
      const insideXZ = pos.x >= r.minX && pos.x <= r.maxX && pos.z >= r.minZ && pos.z <= r.maxZ;
      const rampSurfaceHere = this.sampleRampHeight(pos.x, pos.z);
      if (onEntrySide || (insideXZ && pos.y >= rampSurfaceHere - 0.65) || rampSurfaceHere < 0.65) {
        continue;
      }
      if (this.resolveCircleVsAABB(pos, vel, radius, r.minX, r.maxX, r.minZ, r.maxZ)) {
        hit = true;
      }
    }
    return hit;
  }

  public updateSoccerBall(
    dt: number,
    actors: { pos: THREE.Vector3; vel: THREE.Vector3; radius: number; kickPower: number }[]
  ): void {
    if (this.goalCooldown > 0) this.goalCooldown -= dt;

    this.ballVel.y -= 18.0 * dt;
    this.ballPos.addScaledVector(this.ballVel, dt);
    if (this.ballPos.y < this.ballRadius) {
      this.ballPos.y = this.ballRadius;
      if (this.ballVel.y < -1.5) this.ballVel.y *= -0.68;
      else this.ballVel.y = 0;
    }

    this.ballVel.x *= Math.max(0, 1 - 0.8 * dt);
    this.ballVel.z *= Math.max(0, 1 - 0.8 * dt);

    if (this.goalCooldown <= 0 && this.ballPos.z > 81 && this.ballPos.z < 99) {
      if (this.ballPos.x < 134) {
        this.onGoalScored('WEST');
        this.resetBall();
        return;
      }
      if (this.ballPos.x > 214) {
        this.onGoalScored('EAST');
        this.resetBall();
        return;
      }
    }

    if (this.ballPos.x < 134 + this.ballRadius) { this.ballPos.x = 134 + this.ballRadius; this.ballVel.x = Math.abs(this.ballVel.x) * 0.78; }
    if (this.ballPos.x > 214 - this.ballRadius) { this.ballPos.x = 214 - this.ballRadius; this.ballVel.x = -Math.abs(this.ballVel.x) * 0.78; }
    if (this.ballPos.z < 48 + this.ballRadius) { this.ballPos.z = 48 + this.ballRadius; this.ballVel.z = Math.abs(this.ballVel.z) * 0.78; }
    if (this.ballPos.z > 132 - this.ballRadius) { this.ballPos.z = 132 - this.ballRadius; this.ballVel.z = -Math.abs(this.ballVel.z) * 0.78; }

    for (const a of actors) {
      const dx = this.ballPos.x - a.pos.x;
      const dz = this.ballPos.z - a.pos.z;
      const minDist = this.ballRadius + a.radius;
      const dSq = dx * dx + dz * dz;
      if (dSq < minDist * minDist && dSq > 0.0001) {
        const d = Math.sqrt(dSq);
        const nx = dx / d;
        const nz = dz / d;
        this.ballPos.x += nx * (minDist - d);
        this.ballPos.z += nz * (minDist - d);
        const impactSpeed = Math.hypot(a.vel.x, a.vel.z) + a.kickPower;
        this.ballVel.x += nx * impactSpeed * 1.18;
        this.ballVel.z += nz * impactSpeed * 1.18;
        this.ballVel.y = Math.max(this.ballVel.y, Math.min(11, impactSpeed * 0.36));
      }
    }

    this.ballMesh.position.copy(this.ballPos);
    this.ballMesh.rotation.z -= (this.ballVel.x * dt) / this.ballRadius;
    this.ballMesh.rotation.x += (this.ballVel.z * dt) / this.ballRadius;
  }

  public resetBall(): void {
    this.ballPos.set(174, 6.0, 90);
    this.ballVel.set(0, 0, 0);
    this.goalCooldown = 2.0;
  }
}
