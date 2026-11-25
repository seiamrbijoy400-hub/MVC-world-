import * as THREE from 'three';
import type {
  AccessoryId,
  CharAnimState,
  CharacterAppearance,
  CharacterId,
  HairStyleId
} from '../network/LobbyProtocol';

/**
 * Procedural human character model.
 *
 * Built from anatomical primitives with PBR materials: a tapered lathe skull
 * with brow ridge, nose bridge and lips, natural eye textures, ears, hands with
 * fingers, fabric seams and grounded streetwear. No cel outlines or toon ramps,
 * so the character reads as a person under the scene's real-time lighting while
 * staying fully offline and customizable.
 */

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
    hairColor: '#1c1917',
    eyeColor: '#4a2f1b',
    jacketColor: '#ff5500',
    accentColor: '#f8fafc',
    pantsColor: '#18181b',
    skinColor: '#e0b48c',
    accessory: 'headphones'
  },
  mika: {
    hairStyle: 'twintails',
    hairColor: '#3b2a20',
    eyeColor: '#6b4423',
    jacketColor: '#1e1b4b',
    accentColor: '#f43f5e',
    pantsColor: '#0f172a',
    skinColor: '#f2d3b6',
    accessory: 'none'
  },
  ren: {
    hairStyle: 'cyber',
    hairColor: '#2f3e46',
    eyeColor: '#1e3a8a',
    jacketColor: '#1d4ed8',
    accentColor: '#22d3ee',
    pantsColor: '#0f172a',
    skinColor: '#c68a5e',
    accessory: 'visor'
  },
  sora: {
    hairStyle: 'ponytail',
    hairColor: '#a16207',
    eyeColor: '#3f6212',
    jacketColor: '#dc2626',
    accentColor: '#fef08a',
    pantsColor: '#1e293b',
    skinColor: '#e0b48c',
    accessory: 'sunglasses'
  }
};

function createHumanEyeTexture(eyeColor: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 96;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 128, 96);

  // Sclera — slightly warm off-white, almond shaped
  ctx.fillStyle = '#efece6';
  ctx.beginPath();
  ctx.moveTo(9, 54);
  ctx.bezierCurveTo(26, 22, 100, 20, 119, 49);
  ctx.bezierCurveTo(103, 80, 27, 82, 9, 54);
  ctx.closePath();
  ctx.fill();

  // Iris — real radial falloff, no anime gradient stripe
  const cx = 67;
  const cy = 51;
  const iris = ctx.createRadialGradient(cx, cy, 3, cx, cy, 21);
  iris.addColorStop(0, '#1b1208');
  iris.addColorStop(0.34, eyeColor);
  iris.addColorStop(0.8, eyeColor);
  iris.addColorStop(1, '#120c07');
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.ellipse(cx, cy, 20, 20, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pupil
  ctx.fillStyle = '#080604';
  ctx.beginPath();
  ctx.ellipse(cx, cy, 8.5, 9, 0, 0, Math.PI * 2);
  ctx.fill();

  // Catchlight (one small, one faint — photographic, not cartoon sparkle)
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.beginPath();
  ctx.ellipse(cx - 7, cy - 8, 4.2, 3.2, -0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.beginPath();
  ctx.ellipse(cx + 8, cy + 7, 2.2, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();

  // Upper eyelid crease (thin, human scale)
  ctx.strokeStyle = '#1b1512';
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(9, 54);
  ctx.bezierCurveTo(28, 24, 98, 21, 119, 49);
  ctx.stroke();

  // Lower lid shadow
  ctx.strokeStyle = 'rgba(70, 45, 35, 0.32)';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(14, 60);
  ctx.bezierCurveTo(38, 78, 96, 76, 114, 57);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

function createHeadGeometry(): THREE.LatheGeometry {
  // Human skull: narrow chin, defined jaw, cheekbones, tapered forehead.
  const pts = [
    new THREE.Vector2(0.0, 0.0),
    new THREE.Vector2(0.032, 0.012),
    new THREE.Vector2(0.064, 0.042),
    new THREE.Vector2(0.088, 0.082),
    new THREE.Vector2(0.104, 0.132),
    new THREE.Vector2(0.110, 0.185),
    new THREE.Vector2(0.101, 0.238),
    new THREE.Vector2(0.072, 0.278),
    new THREE.Vector2(0.0, 0.298)
  ];
  const geo = new THREE.LatheGeometry(pts, 32);
  geo.scale(0.92, 1.0, 0.9);
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

export class HumanCharacterMesh {
  private static sharedShadowTex: THREE.CanvasTexture | null = null;
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

  private hairMat: THREE.MeshStandardMaterial;
  private jacketMat: THREE.MeshStandardMaterial;
  private accentMat: THREE.MeshStandardMaterial;
  private pantsMat: THREE.MeshStandardMaterial;
  private skinMat: THREE.MeshStandardMaterial;
  private shoeMat: THREE.MeshStandardMaterial;
  private browMat: THREE.MeshStandardMaterial;
  private lipMat: THREE.MeshStandardMaterial;
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
    this.hips.position.y = 0.84;
    this.root.add(this.hips);

    this.hairMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.appearance.hairColor),
      roughness: 0.66,
      metalness: 0.06
    });
    this.jacketMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.appearance.jacketColor),
      roughness: 0.78,
      metalness: 0.04
    });
    this.accentMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.appearance.accentColor),
      roughness: 0.52,
      metalness: 0.12
    });
    this.pantsMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.appearance.pantsColor),
      roughness: 0.88,
      metalness: 0
    });
    this.skinMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.appearance.skinColor),
      roughness: 0.6,
      metalness: 0
    });
    this.shoeMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.appearance.accentColor).multiplyScalar(0.42),
      roughness: 0.72,
      metalness: 0.06
    });
    this.browMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.appearance.hairColor).multiplyScalar(0.45),
      roughness: 0.92,
      metalness: 0
    });
    this.lipMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#a86258'),
      roughness: 0.5,
      metalness: 0
    });

    // --- Articulated Pelvis + Dynamic Jacket Coat Tail ---
    const pelvisGeo = new THREE.CapsuleGeometry(0.118, 0.08, 8, 14);
    const pelvis = this.addPart(this.hips, pelvisGeo, this.pantsMat, 0.008);
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
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(this.appearance.jacketColor),
        roughness: 0.8,
        metalness: 0.03,
        side: THREE.DoubleSide
      })
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
    const chest = this.addPart(this.torso, chestGeo, this.jacketMat, 0.009);
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

    // Canvas belt breaks up the silhouette and grounds the outfit
    const belt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.126, 0.128, 0.035, 18),
      new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.55, metalness: 0.18 })
    );
    belt.scale.set(1.08, 1, 0.84);
    belt.position.y = 0.075;
    this.hips.add(belt);

    const buckle = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.032, 0.012),
      new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.28, metalness: 0.85 })
    );
    buckle.position.set(0, 0.075, -0.104);
    this.hips.add(buckle);

    // --- Human head: real skull proportions, ears, brows, lips ---
    this.head = new THREE.Group();
    this.head.position.y = 0.40;
    this.head.scale.setScalar(0.82);
    this.torso.add(this.head);

    const neck = this.addPart(this.head, new THREE.CylinderGeometry(0.042, 0.052, 0.11, 12), this.skinMat, 0);
    neck.position.y = 0.045;

    const headGeo = createHeadGeometry();
    const face = this.addPart(this.head, headGeo, this.skinMat, 0);
    face.position.y = 0.056;
    face.castShadow = true;

    // Ears
    const earGeo = new THREE.SphereGeometry(0.022, 10, 10);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, this.skinMat);
      ear.scale.set(0.52, 1.15, 0.8);
      ear.position.set(side * 0.100, 0.170, -0.004);
      ear.rotation.y = side * -0.16;
      this.head.add(ear);
    }

    // Nose: bridge + tip instead of a cone
    const noseBridge = new THREE.Mesh(new THREE.CapsuleGeometry(0.0092, 0.042, 4, 8), this.skinMat);
    noseBridge.rotation.x = -0.26;
    noseBridge.position.set(0, 0.166, -0.100);
    this.head.add(noseBridge);
    const noseTip = new THREE.Mesh(new THREE.SphereGeometry(0.0128, 10, 8), this.skinMat);
    noseTip.scale.set(1.05, 0.72, 0.9);
    noseTip.position.set(0, 0.145, -0.112);
    this.head.add(noseTip);

    const eyeTex = createHumanEyeTexture(this.appearance.eyeColor);
    for (const side of [-1, 1]) {
      const eyeMat = new THREE.MeshBasicMaterial({ map: eyeTex, transparent: true, depthWrite: false });
      this.eyeMats.push(eyeMat);
      const eye = new THREE.Mesh(new THREE.PlaneGeometry(0.055, 0.040), eyeMat);
      eye.position.set(side * 0.046, 0.197, -0.098);
      eye.rotation.y = Math.PI + side * 0.26;
      this.head.add(eye);
      this.eyeMeshes.push(eye);

      const brow = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), this.browMat);
      brow.scale.set(0.024, 0.0044, 0.006);
      brow.position.set(side * 0.048, 0.222, -0.096);
      brow.rotation.y = Math.PI + side * 0.26;
      brow.rotation.z = side * -0.09;
      this.head.add(brow);
    }

    // Subdued two-part mouth
    const upperLip = new THREE.Mesh(new THREE.BoxGeometry(0.040, 0.0062, 0.010), this.lipMat);
    upperLip.position.set(0, 0.104, -0.092);
    this.head.add(upperLip);
    this.mouthMesh = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.0085, 0.011), this.lipMat);
    this.mouthMesh.position.set(0, 0.096, -0.092);
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

    this.leftArm = new THREE.Group();
    this.leftArm.position.set(-0.195, 0.355, 0);
    this.addPart(this.leftArm, shoulderCapGeo, this.jacketMat, 0);
    this.addPart(this.leftArm, upperArmGeo, this.jacketMat, 0);
    this.leftForearm = new THREE.Group();
    this.leftForearm.position.y = -0.22;
    this.addPart(this.leftForearm, elbowCapGeo, this.jacketMat, 0);
    this.addPart(this.leftForearm, forearmGeo, this.jacketMat, 0);
    const lHand = this.buildHand(-1);
    lHand.position.y = -0.235;
    this.leftForearm.add(lHand);
    this.leftArm.add(this.leftForearm);
    this.torso.add(this.leftArm);

    this.rightArm = new THREE.Group();
    this.rightArm.position.set(0.195, 0.355, 0);
    this.addPart(this.rightArm, shoulderCapGeo, this.jacketMat, 0);
    this.addPart(this.rightArm, upperArmGeo, this.jacketMat, 0);
    this.rightForearm = new THREE.Group();
    this.rightForearm.position.y = -0.22;
    this.addPart(this.rightForearm, elbowCapGeo, this.jacketMat, 0);
    this.addPart(this.rightForearm, forearmGeo, this.jacketMat, 0);
    const rHand = this.buildHand(1);
    rHand.position.y = -0.235;
    this.rightForearm.add(rHand);
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
    this.addPart(this.leftLeg, thighGeo, this.pantsMat, 0.0075);
    this.leftShin = new THREE.Group();
    this.leftShin.position.y = -0.40;
    this.addPart(this.leftShin, kneeCapGeo, this.pantsMat, 0.006);
    this.addPart(this.leftShin, shinGeo, this.pantsMat, 0.007);
    this.leftFoot = new THREE.Group();
    this.leftFoot.position.set(0, -0.385, -0.01);
    const lShoe = this.addPart(this.leftFoot, shoeGeo, this.shoeMat, 0);
    lShoe.position.set(0, 0, -0.015);
    const lSole = new THREE.Mesh(
      new THREE.BoxGeometry(0.102, 0.018, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.85 })
    );
    lSole.position.set(0, -0.046, -0.01);
    this.leftFoot.add(lSole);
    this.leftShin.add(this.leftFoot);
    this.leftLeg.add(this.leftShin);
    this.hips.add(this.leftLeg);

    this.rightLeg = new THREE.Group();
    this.rightLeg.position.set(0.086, 0, 0);
    this.addPart(this.rightLeg, thighGeo, this.pantsMat, 0.0075);
    this.rightShin = new THREE.Group();
    this.rightShin.position.y = -0.40;
    this.addPart(this.rightShin, kneeCapGeo, this.pantsMat, 0.006);
    this.addPart(this.rightShin, shinGeo, this.pantsMat, 0.007);
    this.rightFoot = new THREE.Group();
    this.rightFoot.position.set(0, -0.385, -0.01);
    const rShoe = this.addPart(this.rightFoot, shoeGeo, this.shoeMat, 0);
    rShoe.position.set(0, 0, -0.015);
    const rSole = new THREE.Mesh(
      new THREE.BoxGeometry(0.102, 0.018, 0.24),
      new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.85 })
    );
    rSole.position.set(0, -0.046, -0.01);
    this.rightFoot.add(rSole);
    this.rightShin.add(this.rightFoot);
    this.rightLeg.add(this.rightShin);
    this.hips.add(this.rightLeg);

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

  private addPart(
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    _outlineThickness = 0
  ): THREE.Mesh {
    // Realistic shading: no cel outline shells, just solid shadow-casting geometry.
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  private buildHand(side: number): THREE.Group {
    const hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.072, 0.032), this.skinMat);
    palm.position.y = -0.022;
    palm.castShadow = true;
    hand.add(palm);

    const fingerGeo = new THREE.CapsuleGeometry(0.0072, 0.034, 3, 6);
    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(fingerGeo, this.skinMat);
      finger.position.set(-0.026 + i * 0.0173, -0.069, 0.001);
      finger.rotation.z = (i - 1.5) * 0.055;
      finger.castShadow = true;
      hand.add(finger);
    }

    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.0085, 0.026, 3, 6), this.skinMat);
    thumb.position.set(side * 0.042, -0.026, 0.006);
    thumb.rotation.z = side * -0.85;
    thumb.rotation.x = 0.25;
    hand.add(thumb);

    return hand;
  }

  private createContactShadow(): void {
    if (!HumanCharacterMesh.sharedShadowTex) {
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

      const tex = new THREE.CanvasTexture(canvas);
      tex.userData.shared = true;
      HumanCharacterMesh.sharedShadowTex = tex;
    }

    const geo = new THREE.PlaneGeometry(0.95, 0.95);
    geo.rotateX(-Math.PI * 0.5);
    const mat = new THREE.MeshBasicMaterial({
      map: HumanCharacterMesh.sharedShadowTex,
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

    // Hair follows the skull closely instead of sitting on it like a helmet
    const capGeo = new THREE.SphereGeometry(0.120, 20, 18, 0, Math.PI * 2, 0, Math.PI * 0.52);
    const cap = this.addPart(this.hairGroup, capGeo, this.hairMat, 0);
    cap.position.set(0, 0.178, 0.012);
    cap.rotation.x = 0.18;
    cap.scale.set(1.02, 0.98, 1.0);

    // Dynamic back hair pivot
    const backPivot = new THREE.Group();
    backPivot.position.set(0, 0.22, 0.105);
    const backLen = style === 'bob' ? 0.22 : (style === 'ponytail' ? 0.145 : 0.17);
    const backLockGeo = createHairLockGeometry(backLen, 0.13, 0.035);
    for (let i = -1; i <= 1; i++) {
      const lock = new THREE.Mesh(backLockGeo, this.hairMat);
      lock.position.set(i * 0.058, 0, 0);
      lock.rotation.z = i * 0.1;
      backPivot.add(lock);
    }
    this.hairGroup.add(backPivot);
    this.backHairPivot = backPivot;

    // Sweeping front bangs pivot
    const bangsPivot = new THREE.Group();
    bangsPivot.position.set(0, 0.285, -0.112);
    const bangGeo = createHairLockGeometry(0.105, 0.055, -0.02);
    for (let b = -2; b <= 2; b++) {
      const bang = new THREE.Mesh(bangGeo, this.hairMat);
      bang.position.set(b * 0.039, 0, Math.abs(b) * 0.013);
      bang.rotation.z = b * 0.15;
      bang.rotation.x = -0.12;
      bangsPivot.add(bang);
    }
    this.hairGroup.add(bangsPivot);
    this.bangsPivot = bangsPivot;

    // Side face-framing cheek locks
    const sideLockGeo = createHairLockGeometry(style === 'bob' ? 0.19 : 0.145, 0.048, -0.012);
    for (const side of [-1, 1]) {
      const sl = new THREE.Mesh(sideLockGeo, this.hairMat);
      sl.position.set(side * 0.128, 0.24, -0.04);
      sl.rotation.z = side * 0.1;
      sl.rotation.y = side * 0.35;
      this.hairGroup.add(sl);
    }

    if (style === 'spiky') {
      // Short textured crop instead of anime spikes
      const cropGeo = createHairLockGeometry(0.085, 0.05, 0.014);
      for (let s = -3; s <= 3; s++) {
        const lock = new THREE.Mesh(cropGeo, this.hairMat);
        lock.position.set(s * 0.037, 0.285 - Math.abs(s) * 0.006, 0.01 + Math.abs(s) * 0.004);
        lock.rotation.y = s * 0.16;
        lock.rotation.x = -1.32;
        lock.rotation.z = s * 0.05;
        this.hairGroup.add(lock);
      }
    } else if (style === 'twintails') {
      const tailGeo = createHairLockGeometry(0.34, 0.09, 0.06);
      for (const side of [-1, 1]) {
        const tailGrp = new THREE.Group();
        tailGrp.position.set(side * 0.148, 0.22, 0.07);
        const ribbon = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), this.accentMat);
        const tailMesh = new THREE.Mesh(tailGeo, this.hairMat);
        tailMesh.rotation.z = side * 0.3;
        tailMesh.rotation.x = 0.22;
        tailGrp.add(ribbon, tailMesh);
        this.hairGroup.add(tailGrp);
        if (side === -1) this.tailPivotL = tailGrp;
        else this.tailPivotR = tailGrp;
      }
    } else if (style === 'ponytail') {
      const tailGrp = new THREE.Group();
      tailGrp.position.set(0, 0.25, 0.14);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.011, 8, 12), this.accentMat);
      const ponyMesh = new THREE.Mesh(createHairLockGeometry(0.31, 0.1, 0.07), this.hairMat);
      ponyMesh.rotation.x = 0.34;
      tailGrp.add(band, ponyMesh);
      this.hairGroup.add(tailGrp);
      this.tailPivotL = tailGrp;
    } else if (style === 'bob') {
      const puffGeo = createHairLockGeometry(0.19, 0.1, -0.015);
      for (const side of [-1, 1]) {
        const cheekBob = new THREE.Mesh(puffGeo, this.hairMat);
        cheekBob.position.set(side * 0.14, 0.24, 0.03);
        cheekBob.rotation.z = side * 0.07;
        this.hairGroup.add(cheekBob);
      }
    } else if (style === 'cyber') {
      const finGeo = createHairLockGeometry(0.13, 0.06, 0.045);
      for (let s = -1; s <= 1; s++) {
        const fin = new THREE.Mesh(finGeo, this.hairMat);
        fin.position.set(s * 0.06, 0.285, 0.025);
        fin.rotation.x = -0.95;
        fin.rotation.z = s * 0.18;
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
    const prevEyeColor = this.appearance.eyeColor;
    this.appearance = { ...this.appearance, ...app };

    this.hairMat.color.set(this.appearance.hairColor);
    this.jacketMat.color.set(this.appearance.jacketColor);
    this.accentMat.color.set(this.appearance.accentColor);
    this.pantsMat.color.set(this.appearance.pantsColor);
    this.skinMat.color.set(this.appearance.skinColor);
    this.shoeMat.color.set(new THREE.Color(this.appearance.accentColor).multiplyScalar(0.42));
    this.browMat.color.set(new THREE.Color(this.appearance.hairColor).multiplyScalar(0.45));

    this.coatTailPivot.traverse((c) => {
      if ((c as THREE.Mesh).isMesh && c.userData.isCoatTail) {
        ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).color.set(this.appearance.jacketColor);
      }
    });

    if (app.eyeColor && app.eyeColor !== prevEyeColor) {
      const oldEyeTex = this.eyeMats[0]?.map;
      const newEyeTex = createHumanEyeTexture(this.appearance.eyeColor);
      for (const m of this.eyeMats) {
        m.map = newEyeTex;
        m.needsUpdate = true;
      }
      if (oldEyeTex && oldEyeTex !== newEyeTex) oldEyeTex.dispose();
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
      const mat = this.bubbleSprite.material as THREE.SpriteMaterial;
      if (mat.map) mat.map.dispose();
      mat.map = tex;
      mat.needsUpdate = true;
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
      const mat = this.emojiSprite.material as THREE.SpriteMaterial;
      if (mat.map) mat.map.dispose();
      mat.map = tex;
      mat.needsUpdate = true;
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
    // Grounded fighter: no anime crescent slash overlay.
  }

  public updateAnimation(dt: number, state: CharAnimState): void {
    if (this.bubbleTimer > 0) {
      this.bubbleTimer -= dt;
      if (this.bubbleTimer <= 0 && this.bubbleSprite) this.bubbleSprite.visible = false;
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

    let tHipsY = 0.84;
    let tHipsX = 0;
    let tHipsRotX = 0;
    let tHipsYaw = 0;
    let tWaistYaw = 0;
    let tTorsoX = 0;
    let tTorsoY = 0;
    let tTorsoZ = 0;
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
    let blendRate = 16;

    if (state === 'IDLE') {
      this.animPhase += dt * 2.3;
      const breath = Math.sin(this.animPhase);
      tHipsY = 0.84 + breath * 0.010;
      tHipsX = Math.sin(this.animPhase * 0.5) * 0.010;
      tTorsoX = breath * 0.018;
      tHeadX = -breath * 0.012;
      tLArmX = Math.sin(this.animPhase * 0.5) * 0.035;
      tRArmX = -Math.sin(this.animPhase * 0.5) * 0.035;
    } else if (state === 'WALK') {
      this.animPhase += dt * 8.4;
      const swing = Math.sin(this.animPhase);
      const legAmp = 0.52;
      tHipsY = 0.83 + Math.abs(Math.sin(this.animPhase)) * 0.032;
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
    } else if (state === 'RUN' || state === 'FLEE') {
      const isFlee = state === 'FLEE';
      this.animPhase += dt * (isFlee ? 16.5 : 14.2);
      const swing = Math.sin(this.animPhase);
      const legAmp = isFlee ? 1.05 : 0.96;
      tHipsY = 0.81 + Math.abs(Math.sin(this.animPhase)) * 0.075;
      tHipsX = swing * 0.028;
      tHipsYaw = swing * 0.15;
      tWaistYaw = -swing * 0.12;
      tTorsoX = isFlee ? 0.34 : 0.28;
      tTorsoY = -swing * 0.15;
      tHeadY = isFlee ? Math.sin(this.animPhase * 0.5) * 0.25 : swing * 0.10;
      tHeadX = -0.14;
      tLLegX = swing * legAmp;
      tRLegX = -swing * legAmp;
      tLShinX = Math.max(0, -swing) * 1.12;
      tRShinX = Math.max(0, swing) * 1.12;
      tLFootX = -(tLLegX + tLShinX) * 0.50 + Math.max(0, -swing) * 0.28;
      tRFootX = -(tRLegX + tRShinX) * 0.50 + Math.max(0, swing) * 0.28;
      tLArmX = isFlee ? -1.45 + swing * 0.45 : -swing * 0.84;
      tRArmX = isFlee ? -1.45 - swing * 0.45 : swing * 0.84;
      tLArmZ = isFlee ? 0.32 : 0.18;
      tRArmZ = isFlee ? -0.32 : -0.18;
      tLForeX = isFlee ? -0.75 : -1.05;
      tRForeX = isFlee ? -0.75 : -1.05;
    } else if (state === 'JUMP') {
      tHipsY = 0.86;
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
      blendRate = 28;
      tHipsY = 0.80;
      if (this.comboStep === 2) {
        tTorsoX = 0.05;
        tTorsoY = 0.78;
        tRLegX = 1.32;
        tRShinX = 0.12;
        tRFootX = -0.30;
        tLArmZ = 0.72;
        tRArmZ = -0.72;
      } else if (this.comboStep === 1) {
        tTorsoX = 0.16;
        tTorsoY = 0.58;
        tLArmX = -1.55;
        tLForeX = -0.15;
        tRArmX = -0.85;
        tRForeX = -1.15;
      } else {
        tTorsoX = 0.16;
        tTorsoY = -0.58;
        tRArmX = -1.55;
        tRForeX = -0.15;
        tLArmX = -0.85;
        tLForeX = -1.15;
      }
    } else if (state === 'HIT') {
      blendRate = 24;
      tHipsY = 0.81;
      tTorsoX = -0.34;
      tHeadX = -0.24;
      tLArmX = -0.45;
      tRArmX = -0.45;
      tLArmZ = 0.45;
      tRArmZ = -0.45;
      tLForeX = -0.65;
      tRForeX = -0.65;
    } else if (state === 'KO') {
      blendRate = 7.5;
      // Flat prone collapse on the ground: straight legs & relaxed arms so nothing clips the floor
      tHipsY = 0.13;
      tHipsRotX = Math.PI * 0.48;
      tTorsoX = 0.04;
      tHeadX = -0.18;
      tLArmX = -0.25;
      tRArmX = -0.15;
      tLArmZ = 0.52;
      tRArmZ = -0.58;
      tLForeX = -0.35;
      tRForeX = -0.45;
      tLLegX = 0.05;
      tRLegX = -0.04;
      tLShinX = 0.08;
      tRShinX = 0.05;
    }

    const s = 1 - Math.exp(-blendRate * dt);
    this.hips.position.y += (tHipsY - this.hips.position.y) * s;
    this.hips.position.x += (tHipsX - this.hips.position.x) * s;
    this.hips.rotation.y += (tHipsYaw - this.hips.rotation.y) * s;
    this.hips.rotation.x += (tHipsRotX - this.hips.rotation.x) * s;
    this.waist.rotation.y += (tWaistYaw - this.waist.rotation.y) * s;
    this.torso.rotation.x += (tTorsoX - this.torso.rotation.x) * s;
    this.torso.rotation.y += (tTorsoY - this.torso.rotation.y) * s;
    this.torso.rotation.z += (tTorsoZ - this.torso.rotation.z) * s;
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

  public dispose(): void {
    this.root.traverse((obj) => {
      const m = obj as THREE.Mesh | THREE.Sprite;
      if ((m as THREE.Mesh).geometry && !(m as THREE.Mesh).geometry.userData?.shared) {
        (m as THREE.Mesh).geometry.dispose();
      }
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
    if (this.emojiTimer > 0 || state === 'HIT' || state === 'FLEE') {
      this.mouthMesh.scale.set(1.8, 1.45, 1.2);
    } else if (state === 'PUNCH' || state === 'RUN') {
      this.mouthMesh.scale.set(1.4, 1.1, 1.1);
    } else {
      this.mouthMesh.scale.set(0.9, 0.9, 1);
    }
  }

  private applySecondarySprings(dt: number, state: CharAnimState): void {
    const springK = 22;
    const dampC = 0.68;
    const isRunning = state === 'RUN' || state === 'FLEE';
    const isMoving = isRunning || state === 'WALK';
    const baseTrail = isRunning ? 0.48 : (state === 'WALK' ? 0.22 : (state === 'JUMP' ? 0.35 : 0.06));
    const bounce = Math.sin(this.animPhase * 2) * (isRunning ? 0.11 : (isMoving ? 0.04 : 0.015));

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
