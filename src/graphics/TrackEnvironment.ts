import * as THREE from 'three';
import { GroundSample } from '../physics/CarPhysics';
import {
  createAnimeSkyMaterial,
  createAnimeWaterMaterial,
  type AnimeSkyUniforms,
  type AnimeWaterUniforms
} from './Shaders';

export type TimeOfDay = 'DAY' | 'SUNSET' | 'NIGHT';

export interface Checkpoint {
  id: number;
  center: THREE.Vector3;
  forward: THREE.Vector3;
  width: number;
  passed: boolean;
  gateGroup?: THREE.Group;
  gateMat?: THREE.MeshBasicMaterial;
}

export class TrackEnvironment {
  public scene: THREE.Scene;
  public trackSpline: THREE.CatmullRomCurve3;
  public trackPoints: THREE.Vector3[] = [];
  public trackTangents: THREE.Vector3[] = [];
  public trackWidth = 17.0; // Wide grand prix asphalt
  public curbWidth = 1.6;
  public wallOffset = 10.4; // HalfWidth (8.5) + Curb (1.6) + Margin (0.3)
  public checkpoints: Checkpoint[] = [];

  public trackMesh: THREE.Mesh | null = null;
  public curbsMesh: THREE.Mesh | null = null;
  public startGridMesh: THREE.Mesh | null = null;
  public barriersGroup: THREE.Group;
  public sceneryGroup: THREE.Group;
  public waterMesh: THREE.Mesh | null = null;
  public skyDomeMesh: THREE.Mesh | null = null;
  private skyUniforms!: AnimeSkyUniforms;
  private waterUniforms!: AnimeWaterUniforms;
  public gantryLights: THREE.Mesh[] = [];
  public raceStartPortal: THREE.Mesh | null = null;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.barriersGroup = new THREE.Group();
    this.sceneryGroup = new THREE.Group();
    this.scene.add(this.barriersGroup);
    this.scene.add(this.sceneryGroup);

    this.createSkyDome();
    this.trackSpline = this.buildCircuitSpline();
    this.createRoadAndCurbs();
    this.createLakeAndTerrain();
    this.createDualBarriersAndSigns();
    this.createStartGantryAndGrandstand();
    this.setupCheckpoints();
  }

  private createSkyDome(): void {
    const { material, uniforms } = createAnimeSkyMaterial();
    this.skyUniforms = uniforms;
    const skyGeo = new THREE.SphereGeometry(980, 32, 24);
    this.skyDomeMesh = new THREE.Mesh(skyGeo, material);
    this.scene.add(this.skyDomeMesh);
  }

  public setWetSurface(wet: boolean): void {
    if (this.trackMesh) {
      const mat = this.trackMesh.material as THREE.MeshStandardMaterial;
      mat.roughness = wet ? 0.22 : 0.78;
      mat.metalness = wet ? 0.32 : 0.1;
    }
    if (this.curbsMesh) {
      const mat = this.curbsMesh.material as THREE.MeshStandardMaterial;
      mat.roughness = wet ? 0.28 : 0.68;
    }
    if (this.startGridMesh) {
      const mat = this.startGridMesh.material as THREE.MeshStandardMaterial;
      mat.roughness = wet ? 0.22 : 0.75;
      mat.metalness = wet ? 0.3 : 0;
    }
  }

  public setTimeOfDay(tod: TimeOfDay): void {
    if (tod === 'SUNSET') {
      this.skyUniforms.uTopColor.value.set('#1e1b4b');
      this.skyUniforms.uMidColor.value.set('#9a3412');
      this.skyUniforms.uHorizonColor.value.set('#fb923c');
      this.skyUniforms.uSunDir.value.set(0.55, 0.14, -0.82).normalize();
      this.skyUniforms.uSunColor.value.set('#fde047');
      this.skyUniforms.uCloudLitColor.value.set('#fed7aa');
      this.skyUniforms.uCloudShadowColor.value.set('#581c87');
      this.skyUniforms.uStarIntensity.value = 0.25;
    } else if (tod === 'NIGHT') {
      this.skyUniforms.uTopColor.value.set('#020617');
      this.skyUniforms.uMidColor.value.set('#090d16');
      this.skyUniforms.uHorizonColor.value.set('#1e1b4b');
      this.skyUniforms.uSunDir.value.set(-0.4, 0.42, -0.82).normalize();
      this.skyUniforms.uSunColor.value.set('#bae6fd');
      this.skyUniforms.uCloudLitColor.value.set('#334155');
      this.skyUniforms.uCloudShadowColor.value.set('#090d16');
      this.skyUniforms.uStarIntensity.value = 1.0;
    } else {
      this.skyUniforms.uTopColor.value.set('#0f2d5e');
      this.skyUniforms.uMidColor.value.set('#2563eb');
      this.skyUniforms.uHorizonColor.value.set('#bae6fd');
      this.skyUniforms.uSunDir.value.set(0.42, 0.48, -0.77).normalize();
      this.skyUniforms.uSunColor.value.set('#fffbeb');
      this.skyUniforms.uCloudLitColor.value.set('#ffffff');
      this.skyUniforms.uCloudShadowColor.value.set('#93c5fd');
      this.skyUniforms.uStarIntensity.value = 0.0;
    }

    if (this.waterUniforms) {
      this.waterUniforms.uSunDir.value.copy(this.skyUniforms.uSunDir.value);
      this.waterUniforms.uSunColor.value.copy(this.skyUniforms.uSunColor.value);
      if (tod === 'NIGHT') {
        this.waterUniforms.uShallowColor.value.set('#0369a1');
        this.waterUniforms.uDeepColor.value.set('#020617');
        this.waterUniforms.uFoamColor.value.set('#38bdf8');
      } else if (tod === 'SUNSET') {
        this.waterUniforms.uShallowColor.value.set('#0891b2');
        this.waterUniforms.uDeepColor.value.set('#1e1b4b');
        this.waterUniforms.uFoamColor.value.set('#fed7aa');
      } else {
        this.waterUniforms.uShallowColor.value.set('#06b6d4');
        this.waterUniforms.uDeepColor.value.set('#0c4a6e');
        this.waterUniforms.uFoamColor.value.set('#e0f2fe');
      }
    }
  }

  private buildCircuitSpline(): THREE.CatmullRomCurve3 {
    const rawWaypoints = [
      new THREE.Vector3(0, 0, 0),         // Start / Finish straight
      new THREE.Vector3(0, 0, -135),      // High speed main straight
      new THREE.Vector3(-28, 0.4, -215),  // Turn 1 braking zone
      new THREE.Vector3(-88, 1.1, -275),  // Turn 2 sweeping left
      new THREE.Vector3(-190, 2.0, -300), // Fast outer sweeper
      new THREE.Vector3(-280, 1.5, -245), // Sweeper exit
      new THREE.Vector3(-320, 0.8, -155), // Back straight
      new THREE.Vector3(-285, 0.4, -85),  // Chicane right
      new THREE.Vector3(-318, 0.6, -12),  // Chicane left
      new THREE.Vector3(-325, 1.2, 75),   // Uphill climb
      new THREE.Vector3(-282, 2.0, 155),  // Crest
      new THREE.Vector3(-195, 1.2, 215),  // Hairpin entry
      new THREE.Vector3(-110, 0.5, 222),  // Drift Hairpin apex
      new THREE.Vector3(-42, 0.2, 172),   // Hairpin exit
      new THREE.Vector3(-12, 0.0, 90),    // Final corner onto main straight
    ];

    const curve = new THREE.CatmullRomCurve3(rawWaypoints, true, 'centripetal', 0.5);
    const count = 480;
    this.trackPoints = curve.getSpacedPoints(count);
    for (let i = 0; i <= count; i++) {
      this.trackTangents.push(curve.getTangentAt((i % count) / count).normalize());
    }
    return curve;
  }

  private createAsphaltTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // Base dark charcoal asphalt
    ctx.fillStyle = '#24272f';
    ctx.fillRect(0, 0, 512, 512);

    // Fine aggregate grain speckles
    for (let i = 0; i < 16000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const shade = 25 + Math.floor(Math.random() * 35);
      ctx.fillStyle = `rgb(${shade},${shade + 2},${shade + 6})`;
      ctx.fillRect(x, y, 2, 2);
    }

    // Subtle dark rubber racing line down center lanes
    const laneGrad = ctx.createLinearGradient(0, 0, 512, 0);
    laneGrad.addColorStop(0.0, 'rgba(0,0,0,0.2)');
    laneGrad.addColorStop(0.25, 'rgba(10,10,12,0.38)');
    laneGrad.addColorStop(0.5, 'rgba(0,0,0,0.05)');
    laneGrad.addColorStop(0.75, 'rgba(10,10,12,0.38)');
    laneGrad.addColorStop(1.0, 'rgba(0,0,0,0.2)');
    ctx.fillStyle = laneGrad;
    ctx.fillRect(0, 0, 512, 512);

    // Crisp white edge lines
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(14, 0, 10, 512);
    ctx.fillRect(488, 0, 10, 512);

    // Subtle dashed center line
    ctx.fillStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.fillRect(253, 32, 6, 180);
    ctx.fillRect(253, 288, 6, 180);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    return tex;
  }

  private createGrassTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#2d5324';
    ctx.fillRect(0, 0, 256, 256);

    // Broad organic tonal patches instead of 1px moire noise
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const rad = 8 + Math.random() * 20;
      const g = ctx.createRadialGradient(x, y, 1, x, y, rad);
      const tone = Math.random() > 0.5 ? 'rgba(74, 130, 52, 0.14)' : 'rgba(22, 48, 20, 0.16)';
      g.addColorStop(0, tone);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(36, 36);
    tex.anisotropy = 4;
    return tex;
  }

  private createRoadAndCurbs(): void {
    const segments = 480;
    const roadVertices: number[] = [];
    const roadNormals: number[] = [];
    const roadUVs: number[] = [];
    const roadIndices: number[] = [];

    const curbVertices: number[] = [];
    const curbNormals: number[] = [];
    const curbUVs: number[] = [];
    const curbIndices: number[] = [];

    const halfW = this.trackWidth * 0.5;
    const curbW = this.curbWidth;

    for (let i = 0; i <= segments; i++) {
      const idx = i % segments;
      const pt = this.trackPoints[idx];
      const tangent = this.trackTangents[idx];
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

      const pLeft = pt.clone().addScaledVector(right, -halfW);
      const pRight = pt.clone().addScaledVector(right, halfW);

      const vIndex = i * 2;
      roadVertices.push(pLeft.x, pLeft.y + 0.03, pLeft.z);
      roadVertices.push(pRight.x, pRight.y + 0.03, pRight.z);
      roadNormals.push(0, 1, 0, 0, 1, 0);
      // Sample the painted white edge stripes (u≈0.035 / 0.965) instead of
      // the plain asphalt texels at the clamped 0/1 edges.
      roadUVs.push(0.035, i * 0.3, 0.965, i * 0.3);

      if (i < segments) {
        roadIndices.push(vIndex, vIndex + 1, vIndex + 2);
        roadIndices.push(vIndex + 1, vIndex + 3, vIndex + 2);
      }

      const curbLeftOuter = pLeft.clone().addScaledVector(right, -curbW);
      const curbRightOuter = pRight.clone().addScaledVector(right, curbW);

      const cIndex = i * 4;
      curbVertices.push(curbLeftOuter.x, curbLeftOuter.y + 0.07, curbLeftOuter.z);
      curbVertices.push(pLeft.x, pLeft.y + 0.03, pLeft.z);
      curbVertices.push(pRight.x, pRight.y + 0.03, pRight.z);
      curbVertices.push(curbRightOuter.x, curbRightOuter.y + 0.07, curbRightOuter.z);
      curbNormals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      curbUVs.push(0, i * 1.2, 1, i * 1.2, 0, i * 1.2, 1, i * 1.2);

      if (i < segments) {
        curbIndices.push(cIndex, cIndex + 1, cIndex + 4);
        curbIndices.push(cIndex + 1, cIndex + 5, cIndex + 4);
        curbIndices.push(cIndex + 2, cIndex + 3, cIndex + 6);
        curbIndices.push(cIndex + 3, cIndex + 7, cIndex + 6);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadVertices, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUVs, 2));
    roadGeo.setIndex(roadIndices);

    const roadMat = new THREE.MeshStandardMaterial({
      map: this.createAsphaltTexture(),
      roughness: 0.78,
      metalness: 0.1
    });

    this.trackMesh = new THREE.Mesh(roadGeo, roadMat);
    this.trackMesh.receiveShadow = true;
    this.scene.add(this.trackMesh);

    // Curbs
    const curbGeo = new THREE.BufferGeometry();
    curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbVertices, 3));
    curbGeo.setAttribute('normal', new THREE.Float32BufferAttribute(curbNormals, 3));
    curbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(curbUVs, 2));
    curbGeo.setIndex(curbIndices);

    const curbCanvas = document.createElement('canvas');
    curbCanvas.width = 128;
    curbCanvas.height = 128;
    const ctx = curbCanvas.getContext('2d')!;
    ctx.fillStyle = '#dc2626';
    ctx.fillRect(0, 0, 128, 64);
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 64, 128, 64);
    // Subtle weathering noise on curbs
    for (let i = 0; i < 400; i++) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(Math.random() * 128, Math.random() * 128, 3, 3);
    }

    const curbTex = new THREE.CanvasTexture(curbCanvas);
    curbTex.wrapS = THREE.RepeatWrapping;
    curbTex.wrapT = THREE.RepeatWrapping;
    curbTex.repeat.set(1, 1);

    const curbMat = new THREE.MeshStandardMaterial({
      map: curbTex,
      roughness: 0.68,
      metalness: 0.08
    });

    this.curbsMesh = new THREE.Mesh(curbGeo, curbMat);
    this.curbsMesh.receiveShadow = true;
    this.scene.add(this.curbsMesh);
  }

  private createLakeAndTerrain(): void {
    const terrainGeo = new THREE.PlaneGeometry(1400, 1400, 80, 80);
    terrainGeo.rotateX(-Math.PI * 0.5);

    const posAttr = terrainGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i);
      const vz = posAttr.getZ(i);
      const distFromLake = Math.hypot(vx + 165, vz + 20);

      let height = -0.18; // Sit safely just beneath road elevation
      if (vx < -385 || vx > 265 || vz < -350 || vz > 285) {
        // Mountains outside the open-world perimeter zone
        height = 18 + Math.abs(Math.sin(vx * 0.02) * Math.cos(vz * 0.02)) * 45;
      } else if (distFromLake < 82) {
        height = -4.5;
      }
      posAttr.setY(i, height);
    }
    terrainGeo.computeVertexNormals();

    const terrainMat = new THREE.MeshStandardMaterial({
      map: this.createGrassTexture(),
      roughness: 0.92,
      metalness: 0.02
    });
    const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
    terrainMesh.receiveShadow = true;
    this.scene.add(terrainMesh);

    // Lake water safely nestled inside inner perimeter (Custom Anime Shader!)
    const waterGeo = new THREE.CircleGeometry(82, 48);
    waterGeo.rotateX(-Math.PI * 0.5);
    const waterSetup = createAnimeWaterMaterial(82.0);
    this.waterUniforms = waterSetup.uniforms;
    this.waterMesh = new THREE.Mesh(waterGeo, waterSetup.material);
    this.waterMesh.position.set(-165, -1.2, -20);
    this.scene.add(this.waterMesh);

    // Instanced Mountain Rock Formations (1 draw call!)
    const rockGeo = new THREE.DodecahedronGeometry(14, 1);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.95 });
    const rockCount = 34;
    const rockInst = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
    const dummy = new THREE.Object3D();
    for (let r = 0; r < rockCount; r++) {
      const angle = (r / rockCount) * Math.PI * 2;
      const rad = 390 + Math.random() * 110;
      dummy.position.set(Math.cos(angle) * rad - 130, Math.random() * 14 + 12, Math.sin(angle) * rad);
      dummy.scale.set(1.2 + Math.random() * 2.5, 1.8 + Math.random() * 3.2, 1.2 + Math.random() * 2.5);
      dummy.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      dummy.updateMatrix();
      rockInst.setMatrixAt(r, dummy.matrix);
    }
    rockInst.instanceMatrix.needsUpdate = true;
    this.sceneryGroup.add(rockInst);

    // Instanced Pine Trees outside barriers (2 draw calls total for 150 trees!)
    const trunkGeo = new THREE.CylinderGeometry(0.3, 0.45, 3.8, 6);
    trunkGeo.translate(0, 1.9, 0);
    const foliageGeo = new THREE.ConeGeometry(2.5, 6.8, 7);
    foliageGeo.translate(0, 5.6, 0);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x543d2b, roughness: 0.9 });
    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1b4332, roughness: 0.82 });

    const treeTransforms: THREE.Matrix4[] = [];
    for (let i = 0; i < 160; i++) {
      const idx = Math.floor((i / 160) * (this.trackPoints.length - 1));
      const pt = this.trackPoints[idx];
      const tangent = this.trackTangents[idx];
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

      const side = (i % 2 === 0 ? 1 : -1);
      const dist = 19 + Math.random() * 24;
      const treePos = pt.clone().addScaledVector(right, side * dist);

      // Avoid planting trees inside the lake or Metro City / Harbor East zone
      if (Math.hypot(treePos.x + 165, treePos.z + 20) < 92 || treePos.x > 14) continue;

      dummy.position.set(treePos.x, treePos.y, treePos.z);
      const scale = 0.85 + Math.random() * 0.72;
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.updateMatrix();
      treeTransforms.push(dummy.matrix.clone());
    }

    if (treeTransforms.length > 0) {
      const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, treeTransforms.length);
      const foliageInst = new THREE.InstancedMesh(foliageGeo, foliageMat, treeTransforms.length);
      foliageInst.castShadow = true;
      treeTransforms.forEach((m, i) => {
        trunkInst.setMatrixAt(i, m);
        foliageInst.setMatrixAt(i, m);
      });
      trunkInst.instanceMatrix.needsUpdate = true;
      foliageInst.instanceMatrix.needsUpdate = true;
      this.sceneryGroup.add(trunkInst, foliageInst);
    }
  }

  private createDualBarriersAndSigns(): void {
    // Instanced Armco steel guardrails + posts on BOTH sides of the track (2 draw calls total!)
    const railMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.75, roughness: 0.35 });
    const postMat = new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.6, roughness: 0.5 });
    const railGeo = new THREE.BoxGeometry(0.28, 0.55, 5.2);
    const postGeo = new THREE.BoxGeometry(0.18, 0.85, 0.18);

    const barrierDist = this.wallOffset + 0.6;
    const total = this.trackPoints.length - 1;
    const railMatrices: THREE.Matrix4[] = [];
    const postMatrices: THREE.Matrix4[] = [];
    const dummy = new THREE.Object3D();

    for (let i = 0; i < total; i += 2) {
      const pt = this.trackPoints[i];
      const tangent = this.trackTangents[i];
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

      for (const side of [-1, 1]) {
        const bPos = pt.clone().addScaledVector(right, side * barrierDist);
        // Open wide boulevard gaps on the East side of main straight into Metro City, Harbor & Touge!
        if (bPos.x > 4 && ((bPos.z > -185 && bPos.z < -135) || (bPos.z > -56 && bPos.z < -24) || (bPos.z > 14 && bPos.z < 46))) {
          continue;
        }
        dummy.position.set(bPos.x, bPos.y + 0.52, bPos.z);
        dummy.scale.set(1, 1, 1);
        dummy.lookAt(bPos.x + tangent.x, bPos.y + 0.52 + tangent.y, bPos.z + tangent.z);
        dummy.updateMatrix();
        railMatrices.push(dummy.matrix.clone());

        if (i % 4 === 0) {
          dummy.position.set(bPos.x, bPos.y + 0.42, bPos.z);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          postMatrices.push(dummy.matrix.clone());
        }
      }
    }

    if (railMatrices.length > 0) {
      const railInst = new THREE.InstancedMesh(railGeo, railMat, railMatrices.length);
      railInst.castShadow = true;
      railMatrices.forEach((m, i) => railInst.setMatrixAt(i, m));
      railInst.instanceMatrix.needsUpdate = true;
      this.barriersGroup.add(railInst);
    }
    if (postMatrices.length > 0) {
      const postInst = new THREE.InstancedMesh(postGeo, postMat, postMatrices.length);
      postMatrices.forEach((m, i) => postInst.setMatrixAt(i, m));
      postInst.instanceMatrix.needsUpdate = true;
      this.barriersGroup.add(postInst);
    }

    // Chevron Corner Warning Signs at major braking zones
    const chevronCanvas = document.createElement('canvas');
    chevronCanvas.width = 128;
    chevronCanvas.height = 64;
    const cCtx = chevronCanvas.getContext('2d')!;
    cCtx.fillStyle = '#0f172a';
    cCtx.fillRect(0, 0, 128, 64);
    cCtx.fillStyle = '#facc15';
    cCtx.font = 'bold 46px sans-serif';
    cCtx.textAlign = 'center';
    cCtx.textBaseline = 'middle';
    cCtx.fillText('<<<', 64, 34);
    const chevronTex = new THREE.CanvasTexture(chevronCanvas);
    const signMat = new THREE.MeshBasicMaterial({ map: chevronTex, side: THREE.DoubleSide });
    const signGeo = new THREE.PlaneGeometry(3.2, 1.4);

    // Place warning chevrons at Turn 1, Sweeper, Chicane, Hairpin
    for (const frac of [0.10, 0.22, 0.45, 0.72]) {
      const idx = Math.floor(frac * total);
      const pt = this.trackPoints[idx];
      const tangent = this.trackTangents[idx];
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();
      const signPos = pt.clone().addScaledVector(right, barrierDist + 0.5);
      const sign = new THREE.Mesh(signGeo, signMat);
      sign.position.set(signPos.x, signPos.y + 1.6, signPos.z);
      sign.lookAt(pt.clone().addScaledVector(tangent, -15));
      this.sceneryGroup.add(sign);
    }
  }

  private createStartGantryAndGrandstand(): void {
    const gantry = new THREE.Group();
    const trussMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.75, roughness: 0.28 });

    const pillarGeo = new THREE.BoxGeometry(0.9, 8.2, 0.9);
    const pillarL = new THREE.Mesh(pillarGeo, trussMat);
    pillarL.position.set(-this.trackWidth * 0.5 - 2.2, 4.1, 0);
    const pillarR = new THREE.Mesh(pillarGeo, trussMat);
    pillarR.position.set(this.trackWidth * 0.5 + 2.2, 4.1, 0);

    const beamGeo = new THREE.BoxGeometry(this.trackWidth + 5.6, 1.3, 1.1);
    const beam = new THREE.Mesh(beamGeo, trussMat);
    beam.position.set(0, 7.6, 0);

    const bannerCanvas = document.createElement('canvas');
    bannerCanvas.width = 512;
    bannerCanvas.height = 128;
    const bCtx = bannerCanvas.getContext('2d')!;
    bCtx.fillStyle = '#090d16';
    bCtx.fillRect(0, 0, 512, 128);
    bCtx.fillStyle = '#ff5500';
    bCtx.fillRect(0, 114, 512, 14);
    bCtx.fillStyle = '#f8fafc';
    bCtx.font = 'bold 42px sans-serif';
    bCtx.textAlign = 'center';
    bCtx.textBaseline = 'middle';
    bCtx.fillText('APEX ZERO // GP CIRCUIT', 256, 58);

    const bannerTex = new THREE.CanvasTexture(bannerCanvas);
    const bannerMat = new THREE.MeshBasicMaterial({ map: bannerTex, side: THREE.DoubleSide });
    const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(13.5, 1.8), bannerMat);
    bannerMesh.position.set(0, 7.6, 0.58);

    // 5 Race Countdown Gantry Lights (facing driver starting behind z=0 looking toward -Z)
    const lightGeo = new THREE.SphereGeometry(0.32, 16, 16);
    for (let c = -2; c <= 2; c++) {
      const lMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
      const gLight = new THREE.Mesh(lightGeo, lMat);
      gLight.position.set(c * 1.4, 6.4, 0.58);
      this.gantryLights.push(gLight);
      gantry.add(gLight);
    }

    gantry.add(pillarL, pillarR, beam, bannerMesh);
    gantry.position.set(0, 0, -4);
    this.sceneryGroup.add(gantry);

    // Checkerboard Start/Finish Strip
    const startGridCanvas = document.createElement('canvas');
    startGridCanvas.width = 256;
    startGridCanvas.height = 64;
    const sCtx = startGridCanvas.getContext('2d')!;
    for (let x = 0; x < 16; x++) {
      for (let y = 0; y < 4; y++) {
        sCtx.fillStyle = (x + y) % 2 === 0 ? '#f8fafc' : '#0f172a';
        sCtx.fillRect(x * 16, y * 16, 16, 16);
      }
    }
    const gridTex = new THREE.CanvasTexture(startGridCanvas);
    const gridGeo = new THREE.PlaneGeometry(this.trackWidth, 2.2);
    gridGeo.rotateX(-Math.PI * 0.5);
    const gridMesh = new THREE.Mesh(gridGeo, new THREE.MeshStandardMaterial({ map: gridTex, roughness: 0.75 }));
    gridMesh.position.set(0, 0.045, -4);
    gridMesh.receiveShadow = true;
    this.startGridMesh = gridMesh;
    this.scene.add(gridMesh);

    // Main Straight Spectator Grandstand (West side so East opens to Metro City!)
    const standGroup = new THREE.Group();
    const concreteMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.4 });
    for (let tier = 0; tier < 4; tier++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 48), concreteMat);
      step.position.set(-17 - tier * 2.5, 0.6 + tier * 1.2, -55);
      step.castShadow = true;
      step.receiveShadow = true;
      standGroup.add(step);
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(12, 0.4, 50), roofMat);
    canopy.position.set(-21, 7.5, -55);
    canopy.rotation.z = 0.15;
    canopy.castShadow = true;
    standGroup.add(canopy);
    this.sceneryGroup.add(standGroup);
  }

  public setCountdownLights(redCount: number, greenGo: boolean): void {
    for (let i = 0; i < this.gantryLights.length; i++) {
      const mat = this.gantryLights[i].material as THREE.MeshBasicMaterial;
      if (greenGo) {
        mat.color.setHex(0x22c55e); // All Green!
      } else if (i < redCount) {
        mat.color.setHex(0xef4444); // Bright Red
      } else {
        mat.color.setHex(0x1e293b); // Off
      }
    }
  }

  private setupCheckpoints(): void {
    // Glowing In-World Race Event Trigger Portal at Start/Finish (0, 0.08, -4)
    const portalGeo = new THREE.RingGeometry(4.2, 5.2, 36);
    portalGeo.rotateX(-Math.PI * 0.5);
    this.raceStartPortal = new THREE.Mesh(
      portalGeo,
      new THREE.MeshBasicMaterial({ color: 0x22c55e, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
    );
    this.raceStartPortal.position.set(0, 0.09, -4);
    this.scene.add(this.raceStartPortal);

    const checkpointSamples = [
      { t: 0.0, id: 0 },
      { t: 0.25, id: 1 },
      { t: 0.52, id: 2 },
      { t: 0.78, id: 3 },
    ];

    for (const cp of checkpointSamples) {
      const pt = this.trackSpline.getPointAt(cp.t);
      const tangent = this.trackSpline.getTangentAt(cp.t).normalize();
      const right = new THREE.Vector3().crossVectors(tangent, new THREE.Vector3(0, 1, 0)).normalize();

      // Glowing 3D Checkpoint Gate Pillars & Arch (visible during race!)
      const gateGroup = new THREE.Group();
      const gateMat = new THREE.MeshBasicMaterial({
        color: cp.id === 0 ? 0xfacc15 : 0x38bdf8,
        transparent: true,
        opacity: 0.0
      });

      if (cp.id !== 0) {
        const pillarGeo = new THREE.CylinderGeometry(0.35, 0.35, 6.5, 10);
        const pL = new THREE.Mesh(pillarGeo, gateMat);
        pL.position.copy(pt).addScaledVector(right, -this.trackWidth * 0.52);
        pL.position.y += 3.25;
        const pR = new THREE.Mesh(pillarGeo, gateMat);
        pR.position.copy(pt).addScaledVector(right, this.trackWidth * 0.52);
        pR.position.y += 3.25;

        const arch = new THREE.Mesh(new THREE.BoxGeometry(this.trackWidth + 1, 0.45, 0.45), gateMat);
        arch.position.copy(pt);
        arch.position.y += 6.5;
        arch.lookAt(arch.position.clone().add(tangent));

        gateGroup.add(pL, pR, arch);
        this.scene.add(gateGroup);
      }

      this.checkpoints.push({
        id: cp.id,
        center: pt,
        forward: tangent,
        width: this.trackWidth + 8.0,
        passed: false,
        gateGroup,
        gateMat
      });
    }
  }

  public updateCheckpointVisuals(nextCpIndex: number, isTimedRace: boolean, timeSec: number): void {
    if (this.skyUniforms) {
      this.skyUniforms.uTime.value = timeSec;
    }
    if (this.waterUniforms) {
      this.waterUniforms.uTime.value = timeSec;
    }
    if (this.raceStartPortal) {
      this.raceStartPortal.visible = !isTimedRace;
      if (!isTimedRace) {
        const pulse = 0.92 + Math.sin(timeSec * 4) * 0.08;
        this.raceStartPortal.scale.set(pulse, 1, pulse);
      }
    }

    for (let i = 0; i < this.checkpoints.length; i++) {
      const cp = this.checkpoints[i];
      if (!cp.gateMat) continue;
      if (!isTimedRace) {
        cp.gateMat.opacity = 0;
      } else if (i === nextCpIndex) {
        cp.gateMat.color.setHex(0x22d3ee);
        cp.gateMat.opacity = 0.72 + Math.sin(timeSec * 6) * 0.22;
      } else {
        cp.gateMat.opacity = 0.12;
      }
    }
  }

  // Smooth segment-interpolated ground & track boundary sampler
  public sampleGround(x: number, z: number): GroundSample {
    const count = this.trackPoints.length - 1;
    let minDistSq = Infinity;
    let bestClosest = this.trackPoints[0];
    let bestTangent = this.trackTangents[0];

    for (let i = 0; i < count; i++) {
      const a = this.trackPoints[i];
      const b = this.trackPoints[i + 1];

      const abX = b.x - a.x;
      const abZ = b.z - a.z;
      const abLenSq = abX * abX + abZ * abZ;
      if (abLenSq < 0.0001) continue;

      const t = Math.max(0, Math.min(1, ((x - a.x) * abX + (z - a.z) * abZ) / abLenSq));
      const projX = a.x + t * abX;
      const projZ = a.z + t * abZ;
      const dx = projX - x;
      const dz = projZ - z;
      const dSq = dx * dx + dz * dz;

      if (dSq < minDistSq) {
        minDistSq = dSq;
        const projY = a.y + t * (b.y - a.y);
        bestClosest = new THREE.Vector3(projX, projY, projZ);
        bestTangent = this.trackTangents[i];
      }
    }

    const distToCenter = Math.sqrt(minDistSq);
    const halfRoad = this.trackWidth * 0.5;
    const isRoad = distToCenter <= halfRoad;
    const isCurb = distToCenter > halfRoad && distToCenter <= (halfRoad + this.curbWidth);

    return {
      height: bestClosest.y,
      normal: new THREE.Vector3(0, 1, 0),
      isRoad,
      isCurb,
      distToCenter,
      tangent: bestTangent,
      closestPoint: bestClosest
    };
  }
}
