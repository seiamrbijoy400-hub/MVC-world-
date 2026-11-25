import * as THREE from 'three';
import type {
  AccessoryId,
  CharAnimState,
  CharacterAppearance,
  CharacterId,
  HairStyleId
} from '../network/LobbyProtocol';

export interface CharacterPreset {
  id: CharacterId;
  name: string;
  role: string;
  hairColor: number;
  hairShadow: number;
  eyeColor: string;
  jacketColor: number;
  accentColor: number;
  pantsColor: number;
  skinColor: number;
}

export const CHARACTER_PRESETS: Record<CharacterId, CharacterPreset> = {
  kaito: {
    id: 'kaito',
    name: 'Kaito',
    role: 'Street Racer',
    hairColor: 0x1e293b,
    hairShadow: 0x0f172a,
    eyeColor: '#f97316',
    jacketColor: 0xff5500,
    accentColor: 0xf8fafc,
    pantsColor: 0x18181b,
    skinColor: 0xffe0c8
  },
  mika: {
    id: 'mika',
    name: 'Mika',
    role: 'Drift Queen',
    hairColor: 0xf472b6,
    hairShadow: 0xdb2777,
    eyeColor: '#ec4899',
    jacketColor: 0x1e1b4b,
    accentColor: 0xf43f5e,
    pantsColor: 0x0f172a,
    skinColor: 0xffeadb
  },
  ren: {
    id: 'ren',
    name: 'Ren',
    role: 'Cyber Pilot',
    hairColor: 0x38bdf8,
    hairShadow: 0x0284c7,
    eyeColor: '#06b6d4',
    jacketColor: 0x1d4ed8,
    accentColor: 0x22d3ee,
    pantsColor: 0x0f172a,
    skinColor: 0xffe2ca
  },
  sora: {
    id: 'sora',
    name: 'Sora',
    role: 'Stunt Ace',
    hairColor: 0xfacc15,
    hairShadow: 0xca8a04,
    eyeColor: '#eab308',
    jacketColor: 0xdc2626,
    accentColor: 0xfef08a,
    pantsColor: 0x1e293b,
    skinColor: 0xffe3c8
  }
};

export const DEFAULT_APPEARANCE_BY_ID: Record<CharacterId, CharacterAppearance> = {
  kaito: {
    hairStyle: 'spiky',
    hairColor: '#1e293b',
    eyeColor: '#f97316',
    jacketColor: '#ff5500',
    accentColor: '#f8fafc',
    pantsColor: '#18181b',
    skinColor: '#ffe0c8',
    accessory: 'headphones'
  },
  mika: {
    hairStyle: 'twintails',
    hairColor: '#f472b6',
    eyeColor: '#ec4899',
    jacketColor: '#1e1b4b',
    accentColor: '#f43f5e',
    pantsColor: '#0f172a',
    skinColor: '#ffeadb',
    accessory: 'none'
  },
  ren: {
    hairStyle: 'cyber',
    hairColor: '#38bdf8',
    eyeColor: '#06b6d4',
    jacketColor: '#1d4ed8',
    accentColor: '#22d3ee',
    pantsColor: '#0f172a',
    skinColor: '#ffe2ca',
    accessory: 'visor'
  },
  sora: {
    hairStyle: 'ponytail',
    hairColor: '#facc15',
    eyeColor: '#eab308',
    jacketColor: '#dc2626',
    accentColor: '#fef08a',
    pantsColor: '#1e293b',
    skinColor: '#ffe3c8',
    accessory: 'sunglasses'
  }
};

function createToonGradientMap(): THREE.DataTexture {
  const colors = new Uint8Array([102, 102, 118, 255, 198, 198, 208, 255, 255, 255, 255, 255]);
  const tex = new THREE.DataTexture(colors, 3, 1, THREE.RGBAFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function createAnimeEyeTexture(eyeColor: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 128);

  // Soft almond anime sclera
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.ellipse(64, 68, 43, 40, 0, 0, Math.PI * 2);
  ctx.fill();

  // Deep multi-stop anime iris
  const grad = ctx.createLinearGradient(0, 32, 0, 106);
  grad.addColorStop(0, '#090d16');
  grad.addColorStop(0.35, eyeColor);
  grad.addColorStop(0.85, '#fef08a');
  grad.addColorStop(1, '#ffffff');
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(64, 70, 27, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pupil + subtle upper iris shadow
  ctx.fillStyle = '#090d16';
  ctx.beginPath();
  ctx.ellipse(64, 68, 12, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  // Glossy anime catchlights
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(48, 52, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(78, 86, 5.5, 0, Math.PI * 2);
  ctx.fill();

  // Upper eyelash arc + brow accent
  ctx.strokeStyle = '#090d16';
  ctx.lineWidth = 11;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(64, 76, 45, Math.PI * 1.12, Math.PI * 1.88);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function createAnimeHeadGeometry(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.044, 0.015),
    new THREE.Vector2(0.102, 0.055),
    new THREE.Vector2(0.142, 0.12),
    new THREE.Vector2(0.152, 0.19),
    new THREE.Vector2(0.144, 0.255),
    new THREE.Vector2(0.105, 0.30),
    new THREE.Vector2(0.0, 0.315)
  ];
  const geo = new THREE.LatheGeometry(pts, 24);
  geo.scale(0.95, 1.0, 0.91);
  geo.computeVertexNormals();
  return geo;
}

function createHairLockGeometry(length: number, width: number, curveOut: number): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  shape.moveTo(-width * 0.5, 0);
  shape.quadraticCurveTo(-width * 0.45, -length * 0.55, 0, -length);
  shape.quadraticCurveTo(width * 0.45, -length * 0.55, width * 0.5, 0);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.026,
    bevelEnabled: true,
    bevelSegments: 2,
    steps: 1,
    bevelSize: 0.008,
    bevelThickness: 0.008
  });

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = Math.min(1, Math.abs(y) / Math.max(0.01, length));
    pos.setZ(i, pos.getZ(i) + Math.sin(t * Math.PI * 0.85) * curveOut);
  }
  geo.computeVertexNormals();
  return geo;
}

function createSneakerGeometry(): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.052, -0.075);
  s.lineTo(0.052, -0.075);
  s.quadraticCurveTo(0.06, 0.03, 0.05, 0.125);
  s.quadraticCurveTo(0.0, 0.16, -0.05, 0.125);
  s.quadraticCurveTo(-0.06, 0.03, -0.052, -0.075);

  const geo = new THREE.ExtrudeGeometry(s, {
    depth: 0.068,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.011,
    bevelThickness: 0.011
  });
  geo.rotateX(Math.PI * 0.5);
  geo.rotateY(Math.PI);
  return geo;
}

/** Normal-extruded cel outline geometry so limbs/hair/jacket share crisp anime linework */
function createOutlineGeometry(base: THREE.BufferGeometry, thickness = 0.008): THREE.BufferGeometry {
  const geo = base.clone();
  const pos = geo.attributes.position;
  const norm = geo.attributes.normal;
  if (norm) {
    for (let i = 0; i < pos.count; i++) {
      pos.setXYZ(
        i,
        pos.getX(i) + norm.getX(i) * thickness,
        pos.getY(i) + norm.getY(i) * thickness,
        pos.getZ(i) + norm.getZ(i) * thickness
      );
    }
  }
  return geo;
}

export class AnimeCharacterMesh {
  public root: THREE.Group;
  private hips: THREE.Group;
  private waist: THREE.Group;
  private torso: THREE.Group;
  private head: THREE.Group;
  private leftArm: THREE.Group;
  private rightArm: THREE.Group;
  private leftForearm: THREE.Group;
  private rightForearm: THREE.Group;
  private leftLeg: THREE.Group;
  private rightLeg: THREE.Group;
  private leftShin: THREE.Group;
  private rightShin: THREE.Group;
  private leftFoot: THREE.Group;
  private rightFoot: THREE.Group;

  private hairGroup: THREE.Group;
  private accessoryGroup: THREE.Group;
  private tailPivotL: THREE.Group | null = null;
  private tailPivotR: THREE.Group | null = null;
  private backHairPivot: THREE.Group | null = null;
  private bangsPivot: THREE.Group | null = null;
  private coatTailPivot: THREE.Group;

  private eyeMeshes: THREE.Mesh[] = [];
  private mouthMesh: THREE.Mesh;

  private tailVelL = 0;
  private tailVelR = 0;
  private coatTailVel = 0;
  private backHairVel = 0;

  private hairMat: THREE.MeshToonMaterial;
  private jacketMat: THREE.MeshToonMaterial;
  private accentMat: THREE.MeshToonMaterial;
  private pantsMat: THREE.MeshToonMaterial;
  private skinMat: THREE.MeshToonMaterial;
  private outlineMat: THREE.MeshBasicMaterial;
  private eyeMats: THREE.MeshBasicMaterial[] = [];

  private appearance: CharacterAppearance;

  private nameSprite: THREE.Sprite | null = null;
  private nameCanvas: HTMLCanvasElement;
  private nameCtx: CanvasRenderingContext2D;
  private nameTex: THREE.CanvasTexture;

  private bubbleSprite: THREE.Sprite | null = null;
  private bubbleTimer = 0;

  private emojiSprite: THREE.Sprite | null = null;
  private emojiSparkles: THREE.Mesh[] = [];
  private emojiTimer = 0;

  private punchSlashMesh: THREE.Mesh;
  private punchSlashTimer = 0;
  private comboStep = 0;

  private animPhase = 0;
  private blinkCooldown = 2.8;
  private blinkProgress = -1;
  private displayName = 'Racer';
  private lastHp = 100;
  private lastNameDrawn = '';
  private lastHpDrawn = -1;

  constructor(characterId: CharacterId = 'kaito', playerName = '', customAppearance?: CharacterAppearance) {
    this.displayName = playerName;
    this.appearance = customAppearance ? { ...customAppearance } : { ...DEFAULT_APPEARANCE_BY_ID[characterId] };

    this.root = new THREE.Group();
    this.createContactShadow();

    this.hips = new THREE.Group();
    this.hips.position.y = 0.88;
    this.root.add(this.hips);

    const toonGrad = createToonGradientMap();
    this.hairMat = new THREE.MeshToonMaterial({ color: this.appearance.hairColor, gradientMap: toonGrad });
    this.jacketMat = new THREE.MeshToonMaterial({ color: this.appearance.jacketColor, gradientMap: toonGrad });
    this.accentMat = new THREE.MeshToonMaterial({ color: this.appearance.accentColor, gradientMap: toonGrad });
    this.pantsMat = new THREE.MeshToonMaterial({ color: this.appearance.pantsColor, gradientMap: toonGrad });
    this.skinMat = new THREE.MeshToonMaterial({ color: this.appearance.skinColor, gradientMap: toonGrad });
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x090d16, side: THREE.BackSide });

    // --- Articulated Pelvis + Dynamic Jacket Coat Tail ---
    const pelvisGeo = new THREE.CapsuleGeometry(0.118, 0.08, 8, 14);
    const pelvis = this.addCelMesh(this.hips, pelvisGeo, this.pantsMat, 0.008);
    pelvis.scale.set(1.1, 1, 0.84);
    pelvis.position.y = 0.03;

    // Waist articulation between hips and upper ribcage
    this.waist = new THREE.Group();
    this.waist.position.y = 0.11;
    this.hips.add(this.waist);

    this.coatTailPivot = new THREE.Group();
    this.coatTailPivot.position.y = 0.06;
    this.waist.add(this.coatTailPivot);

    const coatTailGeo = new THREE.CylinderGeometry(0.135, 0.185, 0.21, 16, 1, true, Math.PI * 0.14, Math.PI * 1.72);
    const coatTail = new THREE.Mesh(
      coatTailGeo,
      new THREE.MeshToonMaterial({ color: this.appearance.jacketColor, gradientMap: toonGrad, side: THREE.DoubleSide })
    );
    coatTail.scale.set(1.12, 1, 0.82);
    coatTail.position.y = -0.09;
    coatTail.rotation.y = Math.PI;
    // Link coatTail color updates via same color sync in setAppearance
    coatTail.userData.isCoatTail = true;
    this.coatTailPivot.add(coatTail);

    // --- Athletic Ribcage / Hoodie Torso ---
    this.torso = new THREE.Group();
    this.waist.add(this.torso);

    const chestGeo = new THREE.CylinderGeometry(0.158, 0.118, 0.34, 16);
    const chest = this.addCelMesh(this.torso, chestGeo, this.jacketMat, 0.009);
    chest.scale.set(1.14, 1, 0.78);
    chest.position.y = 0.21;
    chest.castShadow = true;

    // Accent racing stripe / zipper placket down chest center
    const zipper = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.31, 0.025), this.accentMat);
    zipper.position.set(0, 0.21, -0.12);
    this.torso.add(zipper);

    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.033, 8, 18), this.accentMat);
    collar.rotation.x = Math.PI * 0.5;
    collar.position.y = 0.39;
    this.torso.add(collar);

    // --- Sculpted Anime Head, Blinking Eyes & Expressive Mouth ---
    this.head = new THREE.Group();
    this.head.position.y = 0.40;
    this.torso.add(this.head);

    const neck = this.addCelMesh(this.head, new THREE.CylinderGeometry(0.045, 0.054, 0.11, 12), this.skinMat, 0.006);
    neck.position.y = 0.04;

    const headGeo = createAnimeHeadGeometry();
    const face = this.addCelMesh(this.head, headGeo, this.skinMat, 0.0085);
    face.position.y = 0.06;
    face.castShadow = true;

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.025, 5), this.skinMat);
    nose.rotation.x = -Math.PI * 0.42;
    nose.position.set(0, 0.165, -0.141);
    this.head.add(nose);

    const eyeTex = createAnimeEyeTexture(this.appearance.eyeColor);
    for (const side of [-1, 1]) {
      const eyeMat = new THREE.MeshBasicMaterial({ map: eyeTex, transparent: true });
      this.eyeMats.push(eyeMat);
      const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.070), eyeMat);
      eye.position.set(side * 0.054, 0.20, -0.130);
      eye.rotation.y = Math.PI + side * 0.26;
      this.head.add(eye);
      this.eyeMeshes.push(eye);

      const blush = new THREE.Mesh(
        new THREE.CircleGeometry(0.018, 10),
        new THREE.MeshBasicMaterial({ color: 0xfb7185, transparent: true, opacity: 0.38 })
      );
      blush.position.set(side * 0.076, 0.15, -0.123);
      blush.rotation.y = Math.PI + side * 0.38;
      this.head.add(blush);
    }

    this.mouthMesh = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.005, 0.024, 4, 8),
      new THREE.MeshBasicMaterial({ color: 0x9f1239 })
    );
    this.mouthMesh.rotation.z = Math.PI * 0.5;
    this.mouthMesh.position.set(0, 0.115, -0.127);
    this.head.add(this.mouthMesh);

    // Hair & Accessory Groups
    this.hairGroup = new THREE.Group();
    this.hairGroup.position.y = 0.06;
    this.head.add(this.hairGroup);

    this.accessoryGroup = new THREE.Group();
    this.accessoryGroup.position.y = 0.06;
    this.head.add(this.accessoryGroup);

    this.buildHairStyle(this.appearance.hairStyle);
    this.buildAccessory(this.appearance.accessory);

    // --- Articulated Arms with Shoulder & Elbow Bridging Caps ---
    const upperArmGeo = new THREE.CapsuleGeometry(0.042, 0.165, 6, 10);
    upperArmGeo.translate(0, -0.105, 0);
    const forearmGeo = new THREE.CapsuleGeometry(0.036, 0.155, 6, 10);
    forearmGeo.translate(0, -0.105, 0);
    const shoulderCapGeo = new THREE.SphereGeometry(0.052, 10, 10);
    const elbowCapGeo = new THREE.SphereGeometry(0.041, 10, 10);
    const handGeo = new THREE.SphereGeometry(0.043, 10, 10);

    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.195, 0.355, 0);
    this.addCelMesh(this.leftArm, shoulderCapGeo, this.jacketMat, 0.006);
    this.addCelMesh(this.leftArm, upperArmGeo, this.jacketMat, 0.007);
    this.leftForearm = new THREE.Group();
    this.leftForearm.position.y = -0.22;
    this.addCelMesh(this.leftForearm, elbowCapGeo, this.jacketMat, 0.006);
    this.addCelMesh(this.leftForearm, forearmGeo, this.jacketMat, 0.007);
    const lHand = this.addCelMesh(this.leftForearm, handGeo, this.skinMat, 0.005);
    lHand.position.y = -0.23;
    this.leftArm.add(this.leftForearm);
    this.torso.add(this.leftArm);

    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.195, 0.355, 0);
    this.addCelMesh(this.rightArm, shoulderCapGeo, this.jacketMat, 0.006);
    this.addCelMesh(this.rightArm, upperArmGeo, this.jacketMat, 0.007);
    this.rightForearm = new THREE.Group();
    this.rightForearm.position.y = -0.22;
    this.addCelMesh(this.rightForearm, elbowCapGeo, this.jacketMat, 0.006);
    this.addCelMesh(this.rightForearm, forearmGeo, this.jacketMat, 0.007);
    const rHand = this.addCelMesh(this.rightForearm, handGeo, this.skinMat, 0.005);
    rHand.position.y = -0.23;
    this.rightArm.add(this.rightForearm);
    this.torso.add(this.rightArm);

    // --- Articulated Legs with Knee Caps + True Ankle Foot Pivots ---
    const thighGeo = new THREE.CapsuleGeometry(0.060, 0.29, 6, 12);
    thighGeo.translate(0, -0.195, 0);
    const shinGeo = new THREE.CapsuleGeometry(0.048, 0.29, 6, 12);
    shinGeo.translate(0, -0.195, 0);
    const kneeCapGeo = new THREE.SphereGeometry(0.054, 10, 10);
    const shoeGeo = createSneakerGeometry();

    this.leftLeg = new THREE.Group();
    this.leftLeg.position.set(-0.086, 0, 0);
    this.addCelMesh(this.leftLeg, thighGeo, this.pantsMat, 0.0075);
    this.leftShin = new THREE.Group();
    this.leftShin.position.y = -0.40;
    this.addCelMesh(this.leftShin, kneeCapGeo, this.pantsMat, 0.006);
    this.addCelMesh(this.leftShin, shinGeo, this.pantsMat, 0.007);
    this.leftFoot = new THREE.Group();
    this.leftFoot.position.set(0, -0.385, -0.01);
    const lShoe = this.addCelMesh(this.leftFoot, shoeGeo, this.accentMat, 0.006);
    lShoe.position.set(0, 0, -0.015);
    this.leftShin.add(this.leftFoot);
    this.leftLeg.add(this.leftShin);
    this.hips.add(this.leftLeg);

    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.086, 0, 0);
    this.addCelMesh(this.rightLeg, thighGeo, this.pantsMat, 0.0075);
    this.rightShin = new THREE.Group();
    this.rightShin.position.y = -0.40;
    this.addCelMesh(this.rightShin, kneeCapGeo, this.pantsMat, 0.006);
    this.addCelMesh(this.rightShin, shinGeo, this.pantsMat, 0.007);
    this.rightFoot = new THREE.Group();
    this.rightFoot.position.set(0, -0.385, -0.01);
    const rShoe = this.addCelMesh(this.rightFoot, shoeGeo, this.accentMat, 0.006);
    rShoe.position.set(0, 0, -0.015);
    this.rightShin.add(this.rightFoot);
    this.rightLeg.add(this.rightShin);
    this.hips.add(this.rightLeg);

    // --- Anime Combat Punch Slash Crescent Arc ---
    const slashGeo = new THREE.RingGeometry(0.35, 0.72, 16, 1, -Math.PI * 0.35, Math.PI * 0.7);
    slashGeo.rotateX(-Math.PI * 0.5);
    this.punchSlashMesh = new THREE.Mesh(
      slashGeo,
      new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
    );
    this.punchSlashMesh.position.set(0, 1.15, -0.45);
    this.punchSlashMesh.visible = false;
    this.root.add(this.punchSlashMesh);

    // --- Overhead Nameplate + HP Bar ---
    this.nameCanvas = document.createElement('canvas');
    this.nameCanvas.width = 256;
    this.nameCanvas.height = 64;
    this.nameCtx = this.nameCanvas.getContext('2d')!;
    this.nameTex = new THREE.CanvasTexture(this.nameCanvas);
    if (playerName) {
      this.nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.nameTex, depthTest: false }));
      this.nameSprite.position.set(0, 2.12, 0);
      this.nameSprite.scale.set(1.5, 0.38, 1);
      this.root.add(this.nameSprite);
      this.setNameAndHp(playerName, 100);
    }

    // --- Emoji FX Sparkles ---
    const sparkGeo = new THREE.OctahedronGeometry(0.075, 0);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        sparkGeo,
        new THREE.MeshBasicMaterial({ color: i % 2 === 0 ? 0xfacc15 : 0x38bdf8, transparent: true })
      );
      m.visible = false;
      this.root.add(m);
      this.emojiSparkles.push(m);
    }
  }

  private addCelMesh(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    outlineThickness: number
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    parent.add(mesh);
    if (outlineThickness > 0) {
      const outline = new THREE.Mesh(createOutlineGeometry(geo, outlineThickness), this.outlineMat);
      mesh.add(outline);
    }
    return mesh;
  }

  private createContactShadow(): void {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 10, 64, 64, 60);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.52)');
    grad.addColorStop(0.55, 'rgba(0, 0, 0, 0.22)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    const geo = new THREE.PlaneGeometry(0.95, 0.95);
    geo.rotateX(-Math.PI * 0.5);
    const mat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(canvas),
      transparent: true,
      depthWrite: false
    });
    const shadow = new THREE.Mesh(geo, mat);
    shadow.position.y = 0.035;
    this.root.add(shadow);
  }

  private buildHairStyle(style: HairStyleId): void {
    this.hairGroup.clear();
    this.tailPivotL = null;
    this.tailPivotR = null;
    this.backHairPivot = null;
    this.bangsPivot = null;
    this.tailVelL = 0;
    this.tailVelR = 0;
    this.backHairVel = 0;

    // Smooth scalp hair dome with ink outline
    const capGeo = new THREE.SphereGeometry(0.163, 20, 18, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const cap = this.addCelMesh(this.hairGroup, capGeo, this.hairMat, 0.008);
    cap.position.set(0, 0.175, 0.01);
    cap.rotation.x = 0.28;
    cap.scale.set(0.98, 1.0, 0.96);

    // Dynamic back hair pivot
    const backPivot = new THREE.Group();
    backPivot.position.set(0, 0.22, 0.105);
    const backLen = style === 'bob' ? 0.28 : (style === 'ponytail' ? 0.19 : 0.24);
    const backLockGeo = createHairLockGeometry(backLen, 0.155, 0.045);
    for (let i = -1; i <= 1; i++) {
      const lock = new THREE.Mesh(backLockGeo, this.hairMat);
      lock.position.set(i * 0.062, 0, 0);
      lock.rotation.z = i * 0.12;
      backPivot.add(lock);
    }
    this.hairGroup.add(backPivot);
    this.backHairPivot = backPivot;

    // Sweeping front bangs pivot
    const bangsPivot = new THREE.Group();
    bangsPivot.position.set(0, 0.285, -0.112);
    const bangGeo = createHairLockGeometry(0.145, 0.062, -0.025);
    for (let b = -2; b <= 2; b++) {
      const bang = new THREE.Mesh(bangGeo, this.hairMat);
      bang.position.set(b * 0.041, 0, Math.abs(b) * 0.015);
      bang.rotation.z = b * 0.18;
      bang.rotation.x = -0.14;
      bangsPivot.add(bang);
    }
    this.hairGroup.add(bangsPivot);
    this.bangsPivot = bangsPivot;

    // Side face-framing cheek locks
    const sideLockGeo = createHairLockGeometry(style === 'bob' ? 0.25 : 0.20, 0.054, -0.015);
    for (const side of [-1, 1]) {
      const sl = new THREE.Mesh(sideLockGeo, this.hairMat);
      sl.position.set(side * 0.132, 0.24, -0.04);
      sl.rotation.z = side * 0.12;
      sl.rotation.y = side * 0.4;
      this.hairGroup.add(sl);
    }

    if (style === 'spiky') {
      const sweepGeo = createHairLockGeometry(0.18, 0.072, 0.055);
      for (let s = 0; s < 7; s++) {
        const ang = (s / 7) * Math.PI * 2;
        const lock = new THREE.Mesh(sweepGeo, this.hairMat);
        lock.position.set(Math.sin(ang) * 0.08, 0.30, Math.cos(ang) * 0.08);
        lock.rotation.y = ang;
        lock.rotation.x = -1.05;
        this.hairGroup.add(lock);
      }
    } else if (style === 'twintails') {
      const tailGeo = createHairLockGeometry(0.42, 0.11, 0.08);
      for (const side of [-1, 1]) {
        const tailGrp = new THREE.Group();
        tailGrp.position.set(side * 0.155, 0.24, 0.06);
        const ribbon = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), this.accentMat);
        const tailMesh = new THREE.Mesh(tailGeo, this.hairMat);
        tailMesh.rotation.z = side * 0.38;
        tailMesh.rotation.x = 0.22;
        tailGrp.add(ribbon, tailMesh);
        this.hairGroup.add(tailGrp);
        if (side === -1) this.tailPivotL = tailGrp;
        else this.tailPivotR = tailGrp;
      }
    } else if (style === 'ponytail') {
      const tailGrp = new THREE.Group();
      tailGrp.position.set(0, 0.27, 0.14);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.036, 0.012, 8, 12), this.accentMat);
      const ponyMesh = new THREE.Mesh(createHairLockGeometry(0.38, 0.12, 0.10), this.hairMat);
      ponyMesh.rotation.x = 0.32;
      tailGrp.add(band, ponyMesh);
      this.hairGroup.add(tailGrp);
      this.tailPivotL = tailGrp;
    } else if (style === 'bob') {
      const puffGeo = createHairLockGeometry(0.24, 0.12, -0.02);
      for (const side of [-1, 1]) {
        const cheekBob = new THREE.Mesh(puffGeo, this.hairMat);
        cheekBob.position.set(side * 0.145, 0.25, 0.03);
        cheekBob.rotation.z = side * 0.08;
        this.hairGroup.add(cheekBob);
      }
    } else if (style === 'cyber') {
      const finGeo = createHairLockGeometry(0.21, 0.075, 0.07);
      for (let s = -2; s <= 2; s++) {
        const fin = new THREE.Mesh(finGeo, this.hairMat);
        fin.position.set(s * 0.055, 0.295, 0.02);
        fin.rotation.x = -0.75;
        fin.rotation.z = s * 0.22;
        this.hairGroup.add(fin);
      }
    }
  }

  private buildAccessory(accessory: AccessoryId): void {
    this.accessoryGroup.clear();

    if (accessory === 'visor') {
      const visor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.150, 0.150, 0.052, 16, 1, true, Math.PI * 0.72, Math.PI * 0.56),
        new THREE.MeshBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.78, side: THREE.DoubleSide })
      );
      visor.position.set(0, 0.145, 0);
      this.accessoryGroup.add(visor);
    } else if (accessory === 'sunglasses') {
      const frameMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.2, metalness: 0.6 });
      const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x111827, roughness: 0.08, metalness: 0.85, clearcoat: 1 });
      const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.012, 0.014), frameMat);
      bridge.position.set(0, 0.15, -0.146);
      this.accessoryGroup.add(bridge);
      for (const side of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.034, 0.012), lensMat);
        lens.position.set(side * 0.048, 0.146, -0.144);
        lens.rotation.y = side * 0.2;
        this.accessoryGroup.add(lens);
      }
    } else if (accessory === 'headphones') {
      const bandMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.5 });
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.168, 0.016, 8, 22, Math.PI), bandMat);
      arc.position.set(0, 0.16, 0);
      this.accessoryGroup.add(arc);
      for (const side of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.046, 0.028, 12), this.accentMat);
        cup.rotation.z = Math.PI * 0.5;
        cup.position.set(side * 0.166, 0.14, 0);
        this.accessoryGroup.add(cup);
      }
    } else if (accessory === 'wing') {
      // Compact nitro aero booster pack mounted onto back of torso
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.21, 0.07), this.accentMat);
      pack.position.set(0, 0.16, 0.13);
      for (const side of [-1, 1]) {
        const winglet = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.05, 0.02), this.jacketMat);
        winglet.position.set(side * 0.16, 0.22, 0.14);
        winglet.rotation.z = side * 0.38;
        this.accessoryGroup.add(winglet);
      }
      this.accessoryGroup.add(pack);
    }
  }

  public getAppearance(): CharacterAppearance {
    return { ...this.appearance };
  }

  public setAppearance(app: Partial<CharacterAppearance>): void {
    const prevHair = this.appearance.hairStyle;
    const prevAcc = this.appearance.accessory;
    this.appearance = { ...this.appearance, ...app };

    this.hairMat.color.set(this.appearance.hairColor);
    this.jacketMat.color.set(this.appearance.jacketColor);
    this.accentMat.color.set(this.appearance.accentColor);
    this.pantsMat.color.set(this.appearance.pantsColor);
    this.skinMat.color.set(this.appearance.skinColor);

    this.coatTailPivot.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.userData.isCoatTail) {
        ((c as THREE.Mesh).material as THREE.MeshToonMaterial).color.set(this.appearance.jacketColor);
      }
    });

    if (app.eyeColor) {
      const newEyeTex = createAnimeEyeTexture(this.appearance.eyeColor);
      for (const m of this.eyeMats) {
        m.map = newEyeTex;
        m.needsUpdate = true;
      }
    }
    if (this.appearance.hairStyle !== prevHair) {
      this.buildHairStyle(this.appearance.hairStyle);
    }
    if (this.appearance.accessory !== prevAcc) {
      this.buildAccessory(this.appearance.accessory);
    }
  }

  public setCharacter(characterId: CharacterId): void {
    this.setAppearance(DEFAULT_APPEARANCE_BY_ID[characterId]);
  }

  public setNameAndHp(name: string, hp: number): void {
    this.displayName = name;
    this.lastHp = hp;
    if (!this.nameSprite) return;
    if (name === this.lastNameDrawn && hp === this.lastHpDrawn) return;
    this.lastNameDrawn = name;
    this.lastHpDrawn = hp;

    const ctx = this.nameCtx;
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(9, 13, 22, 0.72)';
    ctx.beginPath();
    ctx.roundRect(18, 8, 220, 48, 12);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 21px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.displayName.slice(0, 14), 128, 30);

    const pct = Math.max(0, Math.min(1, this.lastHp / 100));
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(38, 41, 180, 7);
    ctx.fillStyle = pct > 0.4 ? '#22c55e' : '#ef4444';
    ctx.fillRect(38, 41, 180 * pct, 7);
    this.nameTex.needsUpdate = true;
  }

  public showSpeechBubble(text: string): void {
    const c = document.createElement('canvas');
    c.width = 320;
    c.height = 96;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(10, 8, 300, 66, 18);
    ctx.fill();
    ctx.strokeStyle = '#090d16';
    ctx.lineWidth = 4;
    ctx.stroke();

    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 23px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text.slice(0, 22), 160, 41);

    const tex = new THREE.CanvasTexture(c);
    if (!this.bubbleSprite) {
      this.bubbleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
      this.bubbleSprite.position.set(0, 2.55, 0);
      this.bubbleSprite.scale.set(2.0, 0.62, 1);
      this.root.add(this.bubbleSprite);
    } else {
      (this.bubbleSprite.material as THREE.SpriteMaterial).map = tex;
    }
    this.bubbleSprite.visible = true;
    this.bubbleTimer = 4.0;
  }

  public triggerEmoji(emoji: string): void {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d')!;
    const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 60);
    grad.addColorStop(0, 'rgba(250, 204, 21, 0.9)');
    grad.addColorStop(0.6, 'rgba(255, 85, 0, 0.4)');
    grad.addColorStop(1, 'rgba(255, 85, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    ctx.font = '74px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 68);

    const tex = new THREE.CanvasTexture(c);
    if (!this.emojiSprite) {
      this.emojiSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      this.root.add(this.emojiSprite);
    } else {
      (this.emojiSprite.material as THREE.SpriteMaterial).map = tex;
    }

    this.emojiSprite.position.set(0, 2.25, 0);
    this.emojiSprite.scale.set(0.2, 0.2, 1);
    this.emojiSprite.visible = true;
    this.emojiTimer = 2.0;

    for (const s of this.emojiSparkles) {
      s.visible = true;
      s.position.set(0, 2.25, 0);
    }
  }

  public triggerPunchVisual(): void {
    this.comboStep = (this.comboStep + 1) % 3;
    this.punchSlashTimer = 0.22;
    this.punchSlashMesh.visible = true;
    this.punchSlashMesh.rotation.z = (this.comboStep - 1) * 0.4;
    this.punchSlashMesh.scale.setScalar(0.75);
  }

  public updateAnimation(dt: number, state: CharAnimState): void {
    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0 && this.bubbleSprite) this.bubbleSprite.visible = false;
    }

    if (this.punchSlashTimer > 0) {
      this.punchSlashTimer -= dt;
      const p = 1 - this.punchSlashTimer / 0.22;
      this.punchSlashMesh.scale.setScalar(0.75 + p * 0.65);
      (this.punchSlashMesh.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.9;
      if (this.punchSlashTimer <= 0) this.punchSlashMesh.visible = false;
    }

    if (this.emojiTimer > 0 && this.emojiSprite) {
      this.emojiTimer -= dt;
      const t = 1 - this.emojiTimer / 2.0;
      const popScale = t < 0.2 ? THREE.MathUtils.lerp(0.2, 1.45, t / 0.2) : THREE.MathUtils.lerp(1.45, 1.0, (t - 0.2) / 0.8);
      this.emojiSprite.scale.set(popScale, popScale, 1);
      this.emojiSprite.position.y = 2.25 + t * 1.15 + Math.sin(t * 14) * 0.08;
      (this.emojiSprite.material as THREE.SpriteMaterial).opacity = t > 0.7 ? (1 - t) / 0.3 : 1;

      for (let i = 0; i < this.emojiSparkles.length; i++) {
        const s = this.emojiSparkles[i];
        const ang = (i / this.emojiSparkles.length) * Math.PI * 2 + t * 5;
        const r = t * 1.1;
        s.position.set(Math.cos(ang) * r, 2.25 + t * 1.2 + Math.sin(t * 8 + i) * 0.2, Math.sin(ang) * r);
        s.rotation.y += dt * 6;
        (s.material as THREE.MeshBasicMaterial).opacity = 1 - t;
        if (this.emojiTimer <= 0) s.visible = false;
      }
      if (this.emojiTimer <= 0) this.emojiSprite.visible = false;
    }

    // Natural eye blink & expressive mouth
    this.updateFacialExpression(dt, state);

    let tHipsY = 0.88;
    let tHipsX = 0;
    let tHipsYaw = 0;
    let tWaistYaw = 0;
    let tTorsoX = 0;
    let tTorsoY = 0;
    let tHeadY = 0;
    let tHeadX = 0;
    let tLLegX = 0;
    let tRLegX = 0;
    let tLShinX = 0;
    let tRShinX = 0;
    let tLFootX = 0;
    let tRFootX = 0;
    let tLArmX = 0;
    let tRArmX = 0;
    let tLArmZ = 0.11;
    let tRArmZ = -0.11;
    let tLForeX = -0.22;
    let tRForeX = -0.22;

    if (state === 'IDLE') {
      this.animPhase += dt * 2.3;
      const breath = Math.sin(this.animPhase);
      tHipsY = 0.88 + breath * 0.012;
      tHipsX = Math.sin(this.animPhase * 0.5) * 0.012;
      tTorsoX = breath * 0.018;
      tHeadX = -breath * 0.012;
      tLArmX = Math.sin(this.animPhase * 0.5) * 0.035;
      tRArmX = -Math.sin(this.animPhase * 0.5) * 0.035;
    } else if (state === 'WALK') {
      this.animPhase += dt * 8.4;
      const swing = Math.sin(this.animPhase);
      const legAmp = 0.52;
      tHipsY = 0.87 + Math.abs(Math.sin(this.animPhase)) * 0.036;
      tHipsX = swing * 0.022;
      tHipsYaw = swing * 0.10;
      tWaistYaw = -swing * 0.08;
      tTorsoX = 0.08;
      tTorsoY = -swing * 0.11;
      tHeadY = swing * 0.07;
      tLLegX = swing * legAmp;
      tRLegX = -swing * legAmp;
      tLShinX = Math.max(0, -swing) * 0.68;
      tRShinX = Math.max(0, swing) * 0.68;
      // Ankle counter-pitch keeps soles grounded on stance and rolls off toe
      tLFootX = -(tLLegX + tLShinX) * 0.55 + Math.max(0, -swing) * 0.18;
      tRFootX = -(tRLegX + tRShinX) * 0.55 + Math.max(0, swing) * 0.18;
      tLArmX = -swing * 0.42;
      tRArmX = swing * 0.42;
      tLForeX = -0.36 - Math.max(0, -swing) * 0.25;
      tRForeX = -0.36 - Math.max(0, swing) * 0.25;
    } else if (state === 'RUN') {
      this.animPhase += dt * 14.2;
      const swing = Math.sin(this.animPhase);
      const legAmp = 0.96;
      tHipsY = 0.84 + Math.abs(Math.sin(this.animPhase)) * 0.085;
      tHipsX = swing * 0.028;
      tHipsYaw = swing * 0.15;
      tWaistYaw = -swing * 0.12;
      tTorsoX = 0.28;
      tTorsoY = -swing * 0.15;
      tHeadY = swing * 0.10;
      tHeadX = -0.14;
      tLLegX = swing * legAmp;
      tRLegX = -swing * legAmp;
      tLShinX = Math.max(0, -swing) * 1.12;
      tRShinX = Math.max(0, swing) * 1.12;
      tLFootX = -(tLLegX + tLShinX) * 0.50 + Math.max(0, -swing) * 0.28;
      tRFootX = -(tRLegX + tRShinX) * 0.50 + Math.max(0, swing) * 0.28;
      tLArmX = -swing * 0.84;
      tRArmX = swing * 0.84;
      tLArmZ = 0.18;
      tRArmZ = -0.18;
      tLForeX = -1.05;
      tRForeX = -1.05;
    } else if (state === 'JUMP') {
      tHipsY = 0.90;
      tTorsoX = 0.12;
      tLArmX = -1.15;
      tRArmX = -1.15;
      tLArmZ = 0.28;
      tRArmZ = -0.28;
      tLForeX = -0.55;
      tRForeX = -0.55;
      tLLegX = 0.55;
      tLShinX = 0.90;
      tLFootX = -0.35;
      tRLegX = -0.22;
      tRShinX = 0.45;
      tRFootX = 0.25;
    } else if (state === 'PUNCH') {
      this.animPhase += dt * 18.0;
      this.hips.position.y = 0.84;
      this.hips.position.x = 0;
      if (this.comboStep === 2) {
        this.torso.rotation.set(0.05, 0.78, 0);
        this.rightLeg.rotation.x = 1.42;
        this.rightShin.rotation.x = 0.12;
        this.rightFoot.rotation.x = -0.3;
        this.leftArm.rotation.set(0, 0, 0.8);
        this.rightArm.rotation.set(0, 0, -0.8);
      } else if (this.comboStep === 1) {
        this.torso.rotation.set(0.16, 0.58, 0);
        this.leftArm.rotation.x = -1.55;
        this.leftForearm.rotation.x = -0.15;
        this.rightArm.rotation.x = -0.85;
        this.rightForearm.rotation.x = -1.15;
      } else {
        this.torso.rotation.set(0.16, -0.58, 0);
        this.rightArm.rotation.x = -1.55;
        this.rightForearm.rotation.x = -0.15;
        this.leftArm.rotation.x = -0.85;
        this.leftForearm.rotation.x = -1.15;
      }
      this.head.rotation.set(0, 0, 0);
      this.applySecondarySprings(dt, state);
      return;
    } else if (state === 'KO') {
      const ks = 1 - Math.exp(-6.5 * dt);
      this.hips.rotation.x += (Math.PI * 0.48 - this.hips.rotation.x) * ks;
      this.hips.position.y += (0.24 - this.hips.position.y) * ks;
      this.applySecondarySprings(dt, state);
      return;
    }

    const s = 1 - Math.exp(-16 * dt);
    this.hips.position.y += (tHipsY - this.hips.position.y) * s;
    this.hips.position.x += (tHipsX - this.hips.position.x) * s;
    this.hips.rotation.y += (tHipsYaw - this.hips.rotation.y) * s;
    this.hips.rotation.x += (0 - this.hips.rotation.x) * s;
    this.waist.rotation.y += (tWaistYaw - this.waist.rotation.y) * s;
    this.torso.rotation.x += (tTorsoX - this.torso.rotation.x) * s;
    this.torso.rotation.y += (tTorsoY - this.torso.rotation.y) * s;
    this.head.rotation.y += (tHeadY - this.head.rotation.y) * s;
    this.head.rotation.x += (tHeadX - this.head.rotation.x) * s;
    this.leftLeg.rotation.x += (tLLegX - this.leftLeg.rotation.x) * s;
    this.rightLeg.rotation.x += (tRLegX - this.rightLeg.rotation.x) * s;
    this.leftShin.rotation.x += (tLShinX - this.leftShin.rotation.x) * s;
    this.rightShin.rotation.x += (tRShinX - this.rightShin.rotation.x) * s;
    this.leftFoot.rotation.x += (tLFootX - this.leftFoot.rotation.x) * s;
    this.rightFoot.rotation.x += (tRFootX - this.rightFoot.rotation.x) * s;
    this.leftArm.rotation.x += (tLArmX - this.leftArm.rotation.x) * s;
    this.rightArm.rotation.x += (tRArmX - this.rightArm.rotation.x) * s;
    this.leftArm.rotation.z += (tLArmZ - this.leftArm.rotation.z) * s;
    this.rightArm.rotation.z += (tRArmZ - this.rightArm.rotation.z) * s;
    this.leftForearm.rotation.x += (tLForeX - this.leftForearm.rotation.x) * s;
    this.rightForearm.rotation.x += (tRForeX - this.rightForearm.rotation.x) * s;

    this.applySecondarySprings(dt, state);
  }

  private updateFacialExpression(dt: number, state: CharAnimState): void {
    // Periodic natural blink cycle
    if (this.blinkProgress >= 0) {
      this.blinkProgress += dt * 7.5;
      const blinkScale = state === 'KO'
        ? 0.12
        : Math.max(0.08, Math.abs(Math.cos(this.blinkProgress * Math.PI)));
      for (const eye of this.eyeMeshes) eye.scale.y = blinkScale;
      if (this.blinkProgress >= 1) {
        this.blinkProgress = -1;
        this.blinkCooldown = 2.6 + Math.random() * 2.2;
        for (const eye of this.eyeMeshes) eye.scale.y = 1.0;
      }
    } else {
      this.blinkCooldown -= dt;
      for (const eye of this.eyeMeshes) eye.scale.y = state === 'KO' ? 0.14 : 1.0;
      if (this.blinkCooldown <= 0 && state !== 'KO') {
        this.blinkProgress = 0;
      }
    }

    // Mouth reactiveness
    if (this.emojiTimer > 0) {
      this.mouthMesh.scale.set(1.8, 1.35, 1.2);
    } else if (state === 'PUNCH' || state === 'RUN') {
      this.mouthMesh.scale.set(1.4, 1.1, 1.1);
    } else {
      this.mouthMesh.scale.set(0.9, 0.9, 1);
    }
  }

  private applySecondarySprings(dt: number, state: CharAnimState): void {
    const springK = 22;
    const dampC = 0.68;
    const isMoving = state === 'RUN' || state === 'WALK';
    const baseTrail = state === 'RUN' ? 0.48 : (state === 'WALK' ? 0.22 : (state === 'JUMP' ? 0.35 : 0.06));
    const bounce = Math.sin(this.animPhase * 2) * (state === 'RUN' ? 0.11 : (isMoving ? 0.04 : 0.015));

    if (this.tailPivotL) {
      this.tailVelL += ((baseTrail + bounce) - this.tailPivotL.rotation.x) * springK * dt;
      this.tailVelL *= Math.pow(dampC, dt * 60);
      this.tailPivotL.rotation.x += this.tailVelL * dt;
    }
    if (this.tailPivotR) {
      this.tailVelR += ((baseTrail - bounce) - this.tailPivotR.rotation.x) * springK * dt;
      this.tailVelR *= Math.pow(dampC, dt * 60);
      this.tailPivotR.rotation.x += this.tailVelR * dt;
    }
    if (this.backHairPivot) {
      this.backHairVel += ((baseTrail * 0.72 + bounce * 0.6) - this.backHairPivot.rotation.x) * springK * dt;
      this.backHairVel *= Math.pow(dampC, dt * 60);
      this.backHairPivot.rotation.x += this.backHairVel * dt;
    }
    if (this.bangsPivot) {
      this.bangsPivot.rotation.x = THREE.MathUtils.damp(this.bangsPivot.rotation.x, bounce * 0.35, 12, dt);
    }

    this.coatTailVel += ((baseTrail * 0.85 + bounce * 0.5) - this.coatTailPivot.rotation.x) * springK * dt;
    this.coatTailVel *= Math.pow(dampC, dt * 60);
    this.coatTailPivot.rotation.x += this.coatTailVel * dt;
  }
}
