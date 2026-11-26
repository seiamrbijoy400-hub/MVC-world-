import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinnedScene } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { CharacterAppearance } from '../network/LobbyProtocol';
import { MODEL_URLS, type CharacterModelId } from './CharacterAnimationMap';

export type CharacterPart = 'outfit' | 'skin' | 'hair' | 'eyes' | 'accent' | 'pants';

export interface CharacterTemplate {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  /** Model height in source units, used to normalize every instance to ~1.78m. */
  height: number;
  /** Distance from source origin to the lowest mesh vertex. */
  groundOffset: number;
  parts: WeakMap<THREE.Object3D, CharacterPart>;
  boneNames: string[];
}

export interface CharacterInstance {
  group: THREE.Group;
  mixer: THREE.AnimationMixer | null;
  bones: Map<string, THREE.Bone>;
  /** Materials cloned for this instance; source textures stay shared. */
  materials: THREE.MeshStandardMaterial[];
  /** Part lookup for cloned meshes (template lookup keys are the original nodes). */
  parts: WeakMap<THREE.Object3D, CharacterPart>;
}

const templates = new Map<CharacterModelId, Promise<CharacterTemplate | null>>();

function normalizedBoneKey(name: string): string | null {
  const n = name.toLowerCase();
  const patterns: Array<[RegExp, string]> = [
    [/^upper_arm_l/, 'upperArmL'],
    [/^upper_arm_r/, 'upperArmR'],
    [/^lower_arm_l/, 'lowerArmL'],
    [/^lower_arm_r/, 'lowerArmR'],
    [/^hand_l/, 'handL'],
    [/^hand_r/, 'handR'],
    [/^upper_leg_l/, 'upperLegL'],
    [/^upper_leg_r/, 'upperLegR'],
    [/^hips?/, 'hips'],
    [/^spine 1/, 'spine1'],
    [/^spine/, 'spine'],
    [/^chest/, 'chest'],
    [/^neck/, 'neck'],
    [/^head/, 'head']
  ];
  for (const [pattern, key] of patterns) if (pattern.test(n)) return key;
  return null;
}

interface ParsedCharacterGLTF {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  parser?: {
    associations?: WeakMap<THREE.Object3D, { meshes?: number }>;
    json?: { meshes?: Array<{ name?: string }> };
  };
}

/** Identify a skinned mesh part from its glTF mesh name and its rig parents. */
function partForMesh(mesh: THREE.Object3D, sourceName = ''): CharacterPart {
  const names: string[] = sourceName ? [sourceName.toLowerCase()] : [];
  let node: THREE.Object3D | null = mesh;
  for (let i = 0; i < 5 && node; i++, node = node.parent) {
    if (node.name) names.push(node.name.toLowerCase());
  }
  const chain = names.join(' ');
  if (/hair|hat/.test(chain)) return 'hair';
  if (/eye/.test(chain)) return 'eyes';
  if (/internal|accent|tie|shirt/.test(chain)) return 'accent';
  if (/body|skin|face|mouth|lip/.test(chain)) return 'skin';
  if (/pants|skirt|shoe|boot/.test(chain)) return 'pants';
  return 'outfit';
}

function buildTemplate(gltf: ParsedCharacterGLTF): CharacterTemplate {
  const box = new THREE.Box3().setFromObject(gltf.scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  const parts = new WeakMap<THREE.Object3D, CharacterPart>();
  const boneNames: string[] = [];
  gltf.scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) boneNames.push(o.name);
    if (!(o as THREE.Mesh).isMesh) return;
    // Sketchfab exports often name mesh nodes `Object_79`; the descriptive
    // name lives in glTF mesh metadata and must be read via parser associations.
    const meshIndex = gltf.parser?.associations?.get(o)?.meshes;
    const sourceName = meshIndex !== undefined ? gltf.parser?.json?.meshes?.[meshIndex]?.name ?? '' : '';
    parts.set(o, partForMesh(o, sourceName));
  });
  return {
    scene: gltf.scene,
    animations: gltf.animations,
    height: Math.max(size.y, 0.01),
    groundOffset: box.min.y,
    parts,
    boneNames
  };
}

/**
 * Load a rigged character GLB once and share the parsed geometry, textures and
 * clips between the player, fighters and every NPC. Each visible copy gets its
 * own materials (for color variants) and its own AnimationMixer.
 */
export function loadCharacterTemplate(model: CharacterModelId): Promise<CharacterTemplate | null> {
  let pending = templates.get(model);
  if (!pending) {
    pending = new Promise<CharacterTemplate | null>((resolve) => {
      try {
        const loader = new GLTFLoader();
        loader.load(
          MODEL_URLS[model],
          (gltf) => resolve(buildTemplate(gltf)),
          undefined,
          (error) => {
            console.warn(`[characters] ${model} GLB unavailable, procedural fallback stays active`, error);
            resolve(null);
          }
        );
      } catch (error) {
        console.warn(`[characters] ${model} GLB loader failed`, error);
        resolve(null);
      }
    });
    // A failed load is not cached forever: the next character can retry.
    pending = pending.then((result) => {
      if (!result && templates.get(model) === pending) templates.delete(model);
      return result;
    });
    templates.set(model, pending);
  }
  return pending;
}

export function instantiateCharacter(template: CharacterTemplate): CharacterInstance {
  // Object3D.clone() shares the SkinnedMesh skeleton with the template, which
  // leaves cloned meshes bound to bones outside their own scene (frozen/invisible
  // rigs). SkeletonUtils.clone remaps bones into each instance.
  const scene = cloneSkinnedScene(template.scene) as THREE.Group;
  const scale = 1.78 / template.height;
  scene.scale.setScalar(scale);
  scene.position.y = -template.groundOffset * scale;
  // Both source rigs face +Z in world space, while CharacterController treats
  // yaw=0 / controller forward as -Z. Turn the visual rig around so walking,
  // running and punches follow the movement direction instead of moonwalking.
  scene.rotation.y = Math.PI;

  const group = new THREE.Group();
  group.add(scene);

  // Clone traversal order matches the template traversal order, so part tags
  // can be transferred from the original nodes onto the cloned meshes.
  const originalMeshes: THREE.Mesh[] = [];
  template.scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) originalMeshes.push(o as THREE.Mesh);
  });
  const clonedMeshes: THREE.Mesh[] = [];
  const bones = new Map<string, THREE.Bone>();
  const materials: THREE.MeshStandardMaterial[] = [];
  const parts = new WeakMap<THREE.Object3D, CharacterPart>();
  scene.traverse((o) => {
    if ((o as THREE.Bone).isBone) {
      const key = normalizedBoneKey(o.name);
      if (key && !bones.has(key)) bones.set(key, o as THREE.Bone);
    }
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    parts.set(mesh, template.parts.get(originalMeshes[clonedMeshes.length]) ?? 'outfit');
    clonedMeshes.push(mesh);
    const cloneMaterial = (source: THREE.Material): THREE.MeshStandardMaterial => {
      const mat = source.clone() as THREE.MeshStandardMaterial;
      mat.userData.characterInstanceOwned = true;
      mat.userData.baseColor = mat.color ? mat.color.clone() : new THREE.Color(0xffffff);
      materials.push(mat);
      return mat;
    };
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map(cloneMaterial)
      : cloneMaterial(mesh.material);
  });

  return { group, mixer: new THREE.AnimationMixer(scene), bones, materials, parts };
}

function partColor(part: CharacterPart, app: CharacterAppearance): THREE.Color {
  switch (part) {
    case 'hair': return new THREE.Color(app.hairColor);
    case 'eyes': return new THREE.Color(app.eyeColor);
    case 'skin': return new THREE.Color(app.skinColor);
    case 'accent': return new THREE.Color(app.accentColor);
    case 'pants': return new THREE.Color(app.pantsColor);
    default: return new THREE.Color(app.jacketColor);
  }
}

/**
 * Tint the cloned per-instance materials. GLB base-color textures are kept
 * (so faces, seams and fabric detail survive) and only softly color-shifted,
 * which gives NPCs distinct outfits without an extra texture download.
 */
export function applyCharacterAppearance(
  instance: CharacterInstance,
  template: CharacterTemplate,
  app: CharacterAppearance
): void {
  const byMaterial = new Map<THREE.Material, CharacterPart[]>();
  instance.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const part = instance.parts.get(o) ?? 'outfit';
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const list = byMaterial.get(mat) ?? [];
      if (!list.includes(part)) list.push(part);
      byMaterial.set(mat, list);
    }
  });
  for (const [mat, parts] of byMaterial) {
    const std = mat as THREE.MeshStandardMaterial;
    const base = (std.userData.baseColor as THREE.Color | undefined) ?? new THREE.Color(0xffffff);
    // Pick the strongest part tint; blending keeps the original texture readable.
    const target = parts
      .map((p) => partColor(p, app))
      .reduce((a, b) => (b.getHSL({ h: 0, s: 0, l: 0 }).s > a.getHSL({ h: 0, s: 0, l: 0 }).s ? b : a));
    std.color.copy(base).lerp(target, 0.42);
    std.needsUpdate = true;
  }
}

/** Only per-instance materials are disposed; template geometry/textures are shared. */
export function disposeCharacterInstance(instance: CharacterInstance): void {
  instance.mixer?.stopAllAction();
  for (const mat of instance.materials) mat.dispose();
}
