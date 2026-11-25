import * as THREE from 'three';
import { HumanCharacterMesh } from './HumanCharacterMesh';
import type { CharAnimState, CharacterAppearance } from '../network/LobbyProtocol';
import {
  mapAnimStateToClip,
  MODEL_URLS,
  modelForCharacter,
  usesProceduralPose,
  type CharacterModelId
} from './CharacterAnimationMap';
import {
  applyCharacterAppearance,
  disposeCharacterInstance,
  instantiateCharacter,
  loadCharacterTemplate,
  type CharacterInstance,
  type CharacterTemplate
} from './GLTFCharacterCache';

/**
 * Rigged GLB character with the same public surface as HumanCharacterMesh.
 *
 * Geometry, textures and animation clips are loaded once per model and shared
 * by the player, sparring fighters and every pedestrian. Each character gets
 * its own cloned materials (color variants) and AnimationMixer. If a GLB is
 * missing or cannot be parsed, the procedural HumanCharacterMesh takes over.
 */
export class GLTFCharacterMesh {
  public root: THREE.Group;

  private model: CharacterModelId;
  private charId: string;
  private template: CharacterTemplate | null = null;
  private instance: CharacterInstance | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentAction: THREE.AnimationAction | null = null;
  private currentClipName = '';
  private desiredState: CharAnimState = 'IDLE';
  private poseTime = 0;
  private touchedBones = new Set<THREE.Bone>();
  private restQuats = new Map<THREE.Bone, THREE.Quaternion>();
  private animatedQuats = new Set<THREE.Bone>();

  private loaded = false;
  private failed = false;
  private fallback: HumanCharacterMesh | null = null;
  private appearance: CharacterAppearance | null;
  private pendingName: string;
  private pendingHp = 100;
  private showNameTag: boolean;
  private nameSprite: THREE.Sprite | null = null;
  private nameCanvas: HTMLCanvasElement | null = null;
  private nameCtx: CanvasRenderingContext2D | null = null;
  private lastDrawnName = '';
  private lastDrawnHp = -1;
  private bubble: THREE.Sprite | null = null;
  private bubbleTimer: number | null = null;
  private disposed = false;
  private loadGeneration = 0;
  private static statusListeners = new Set<(ready: boolean) => void>();

  constructor(
    modelUrlOrId: string = MODEL_URLS.male,
    charId = 'kaito',
    name = '',
    appearance: CharacterAppearance | null = null,
    _variantSeed = 0,
    showNameTag = true
  ) {
    this.root = new THREE.Group();
    this.model = modelUrlOrId === 'male' || modelUrlOrId === MODEL_URLS.male ? 'male'
      : modelUrlOrId === 'female' || modelUrlOrId === MODEL_URLS.female ? 'female'
        : modelForCharacter(charId);
    this.charId = charId;
    this.appearance = appearance;
    this.pendingName = name;
    this.showNameTag = showNameTag;
    void this.load();
  }

  public static onModelStatus(listener: (ready: boolean) => void): void {
    GLTFCharacterMesh.statusListeners.add(listener);
  }

  private notifyStatus(): void {
    for (const listener of GLTFCharacterMesh.statusListeners) listener(this.loaded);
  }

  private useProceduralFallback(reason: unknown): void {
    if (this.disposed) return;
    this.failed = true;
    this.root.clear();
    this.nameSprite = null;
    this.fallback = new HumanCharacterMesh(this.charId as never, this.pendingName, this.appearance ?? undefined);
    this.root.add(this.fallback.root);
    this.fallback.setNameAndHp(this.pendingName, this.pendingHp);
    console.warn('[characters] GLB fallback active for', this.model, reason);
    this.notifyStatus();
  }

  private async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    const model = this.model;
    const template = await loadCharacterTemplate(model);
    if (this.disposed || generation !== this.loadGeneration) return;
    if (!template) {
      this.useProceduralFallback('GLB not available');
      return;
    }

    let instance: CharacterInstance;
    try {
      instance = instantiateCharacter(template);
    } catch (error) {
      this.useProceduralFallback(error);
      return;
    }
    if (this.disposed || generation !== this.loadGeneration) {
      disposeCharacterInstance(instance);
      return;
    }

    this.template = template;
    this.instance = instance;
    this.root.add(instance.group);
    for (const clip of template.animations) {
      if (!clip.tracks.length) continue;
      this.actions.set(clip.name, instance.mixer!.clipAction(clip));
    }
    for (const bone of instance.bones.values()) {
      this.restQuats.set(bone, bone.quaternion.clone());
    }
    for (const clip of template.animations) {
      for (const track of clip.tracks) {
        if (!track.name.endsWith('.quaternion')) continue;
        const boneName = track.name.slice(0, -'.quaternion'.length);
        for (const bone of instance.bones.values()) {
          if (bone.name === boneName) this.animatedQuats.add(bone);
        }
      }
    }
    this.loaded = true;
    if (this.appearance) applyCharacterAppearance(instance, template, this.appearance);
    if (this.showNameTag) this.setNameAndHp(this.pendingName, this.pendingHp);
    this.playState(this.desiredState);
    instance.mixer!.update(0);
    this.notifyStatus();
  }

  /** Swap male/female rig when a different driver is selected in the lobby. */
  public setModel(modelOrId: string): void {
    const next = modelOrId === 'male' || modelOrId === MODEL_URLS.male ? 'male'
      : modelOrId === 'female' || modelOrId === MODEL_URLS.female ? 'female'
        : modelForCharacter(modelOrId);
    if (next === this.model) return;
    this.model = next;
    this.loadGeneration++;
    this.loaded = false;
    this.template = null;
    this.instance = null;
    this.actions.clear();
    this.currentAction = null;
    this.currentClipName = '';
    this.touchedBones.clear();
    this.fallback?.dispose();
    this.fallback = null;
    this.root.clear();
    this.nameSprite = null;
    void this.load();
  }

  private playState(state: CharAnimState): void {
    if (!this.instance?.mixer) return;
    const clipName = mapAnimStateToClip(state, [...this.actions.keys()], this.model);
    if (!clipName || clipName === this.currentClipName) return;
    const action = this.actions.get(clipName);
    if (!action) return;
    if (this.currentAction) this.currentAction.fadeOut(0.12);
    action.reset().fadeIn(0.12).play();
    this.currentAction = action;
    this.currentClipName = clipName;
  }

  /** Add a short procedural combat pose on top of the GLB locomotion clip. */
  private applyCombatPose(dt: number, state: CharAnimState): void {
    const instance = this.instance;
    if (!instance) return;
    const procedural = usesProceduralPose(state);
    this.poseTime = procedural ? this.poseTime + dt : 0;

    // Bones not driven by the base clip keep last frame's additive rotation,
    // so clear those before layering this frame's pose.
    const bone = (key: string): THREE.Bone | null => instance.bones.get(key) ?? null;
    const rotate = (key: string, axis: THREE.Vector3, angle: number): void => {
      const b = bone(key);
      if (!b || Math.abs(angle) < 1e-4) return;
      const base = this.animatedQuats.has(b) ? b.quaternion : (this.restQuats.get(b) ?? b.quaternion);
      b.quaternion.copy(base).multiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      this.touchedBones.add(b);
    };

    for (const b of this.touchedBones) {
      if (!this.animatedQuats.has(b)) {
        const rest = this.restQuats.get(b);
        if (rest) b.quaternion.copy(rest);
      }
    }

    if (state === 'PUNCH') {
      const swing = Math.sin(Math.min(1, this.poseTime / 0.36) * Math.PI);
      // Both rigs face -Z (eye bones sit at -Z). A negative local-Z swing drives
      // the right hand forward, toward the direction the controller hits in.
      rotate('upperArmR', new THREE.Vector3(0, 0, 1), -swing * 1.18);
      rotate('lowerArmR', new THREE.Vector3(0, 0, 1), -swing * 0.22);
      rotate('chest', new THREE.Vector3(0, 1, 0), swing * 0.16);
      rotate('head', new THREE.Vector3(0, 1, 0), -swing * 0.1);
    } else if (state === 'HIT') {
      const recoil = Math.exp(-this.poseTime * 5.5);
      rotate('upperArmL', new THREE.Vector3(0, 0, 1), recoil * 0.5);
      rotate('upperArmR', new THREE.Vector3(0, 0, 1), recoil * 0.5);
      rotate('head', new THREE.Vector3(1, 0, 0), recoil * 0.3);
      rotate('chest', new THREE.Vector3(1, 0, 0), recoil * 0.16);
    } else if (state === 'KO') {
      const t = Math.min(1, this.poseTime / 0.6);
      const settle = 1 - (1 - t) * (1 - t);
      rotate('hips', new THREE.Vector3(1, 0, 0), (this.model === 'male' ? -1.35 : 1.45) * settle);
      rotate('head', new THREE.Vector3(1, 0, 0), 0.22 * settle);
      instance.group.position.y = (this.model === 'male' ? -0.02 : -0.42) * settle;
      return;
    }
    instance.group.position.y = 0;
  }

  public updateAnimation(dt: number, state: CharAnimState): void {
    if (this.disposed) return;
    this.desiredState = state;
    if (this.fallback) {
      this.fallback.updateAnimation(dt, state);
      return;
    }
    if (!this.loaded || !this.instance?.mixer) return;
    this.playState(state);
    this.instance.mixer.update(dt);
    this.applyCombatPose(dt, state);
  }

  public setAppearance(app: CharacterAppearance): void {
    this.appearance = { ...app };
    if (this.fallback) {
      this.fallback.setAppearance(app);
      return;
    }
    if (this.loaded && this.template && this.instance) {
      applyCharacterAppearance(this.instance, this.template, this.appearance);
    }
  }

  public getAppearance(): CharacterAppearance | null {
    if (this.fallback) return this.fallback.getAppearance();
    return this.appearance ? { ...this.appearance } : null;
  }

  public get isRealistic(): boolean {
    return this.loaded && !this.failed;
  }

  public setNameAndHp(name: string, hp: number): void {
    this.pendingName = name;
    this.pendingHp = hp;
    if (this.fallback) {
      this.fallback.setNameAndHp(name, hp);
      return;
    }
    if (!this.loaded || !this.showNameTag || !name) return;
    if (typeof document === 'undefined') return;
    if (!this.nameCanvas) {
      this.nameCanvas = document.createElement('canvas');
      this.nameCanvas.width = 256;
      this.nameCanvas.height = 64;
      this.nameCtx = this.nameCanvas.getContext('2d');
      if (!this.nameCtx) return;
      const tex = new THREE.CanvasTexture(this.nameCanvas);
      this.nameSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      this.nameSprite.scale.set(1.6, 0.4, 1);
      this.nameSprite.position.set(0, 2.05, 0);
      this.nameSprite.renderOrder = 20;
      this.root.add(this.nameSprite);
    }
    if (!this.nameCtx || name === this.lastDrawnName && hp === this.lastDrawnHp) return;
    this.lastDrawnName = name;
    this.lastDrawnHp = hp;
    const ctx = this.nameCtx;
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(9,13,22,0.72)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(18, 8, 220, 48, 12);
      ctx.fill();
    } else {
      ctx.fillRect(18, 8, 220, 48);
    }
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 21px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name.slice(0, 14), 128, 30);
    const pct = Math.max(0, Math.min(1, hp / 100));
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.fillRect(38, 41, 180, 7);
    ctx.fillStyle = pct > 0.4 ? '#22c55e' : '#ef4444';
    ctx.fillRect(38, 41, 180 * pct, 7);
    const map = (this.nameSprite?.material as THREE.SpriteMaterial | undefined)?.map;
    if (map) map.needsUpdate = true;
  }

  private showSprite(text: string, color: string, seconds: number, y: number): void {
    if (typeof document === 'undefined') return;
    if (this.bubble) {
      this.root.remove(this.bubble);
      this.bubble.material.map?.dispose();
      this.bubble.material.dispose();
      this.bubble = null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = 'rgba(9,13,22,0.88)';
    ctx.beginPath();
    if (ctx.roundRect) {
      ctx.roundRect(8, 8, 496, 104, 22);
      ctx.fill();
    } else {
      ctx.fillRect(8, 8, 496, 104);
    }
    ctx.fillStyle = color;
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text.slice(0, 22), 256, 74);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false
    }));
    sprite.scale.set(2.1, 0.53, 1);
    sprite.position.set(0, y, 0);
    sprite.renderOrder = 21;
    this.root.add(sprite);
    this.bubble = sprite;
    if (this.bubbleTimer !== null) clearTimeout(this.bubbleTimer);
    this.bubbleTimer = setTimeout(() => {
      if (this.bubble === sprite) {
        this.root.remove(sprite);
        sprite.material.map?.dispose();
        sprite.material.dispose();
        this.bubble = null;
      }
      this.bubbleTimer = null;
    }, seconds * 1000) as unknown as number;
  }

  public showSpeechBubble(text: string): void {
    if (this.fallback) {
      this.fallback.showSpeechBubble(text);
      return;
    }
    this.showSprite(text, '#f8fafc', 2.6, 2.5);
  }

  public triggerEmoji(emoji: string): void {
    if (this.fallback) {
      this.fallback.triggerEmoji(emoji);
      return;
    }
    this.showSprite(emoji, '#facc15', 1.6, 2.7);
  }

  public triggerPunchVisual(): void {
    if (this.fallback) this.fallback.triggerPunchVisual();
    else if (this.desiredState === 'PUNCH') this.poseTime = 0;
  }

  public dispose(): void {
    this.disposed = true;
    this.loadGeneration++;
    if (this.bubbleTimer !== null) clearTimeout(this.bubbleTimer);
    if (this.fallback) this.fallback.dispose();
    else if (this.instance) disposeCharacterInstance(this.instance);
    const spriteMat = this.nameSprite?.material as THREE.SpriteMaterial | undefined;
    spriteMat?.map?.dispose();
    spriteMat?.dispose();
    if (this.bubble) {
      this.bubble.material.map?.dispose();
      this.bubble.material.dispose();
    }
    this.root.clear();
    this.actions.clear();
    this.touchedBones.clear();
    this.restQuats.clear();
    this.animatedQuats.clear();
    GLTFCharacterMesh.statusListeners.delete(this.notifyStatus);
  }
}
