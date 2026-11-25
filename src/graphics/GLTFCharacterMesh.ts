import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HumanCharacterMesh } from './HumanCharacterMesh';
import type { CharAnimState, CharacterAppearance } from '../network/LobbyProtocol';

/**
 * GLTF-based human character (rigged + animated).
 * Loads a GLB, drives it with AnimationMixer. Falls back gracefully if load fails.
 */
export class GLTFCharacterMesh {
  public root: THREE.Group;
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentAction: THREE.AnimationAction | null = null;
  private loaded = false;
  private loadFailed = false;
  private useFallback = false;
  private fallback: any = null;
  private charId: string;
  private desiredState: CharAnimState = 'IDLE';
  private nameSprite: THREE.Sprite | null = null;
  private nameCanvas: HTMLCanvasElement | null = null;
  private nameCtx: CanvasRenderingContext2D | null = null;
  private pendingName = '';
  private pendingHp = 100;
  private appearance: CharacterAppearance | null = null;
  private modelUrl: string;

  constructor(modelUrl: string, charId = 'kaito', name = '', appearance: CharacterAppearance | null = null) {
    this.root = new THREE.Group();
    this.modelUrl = modelUrl;
    this.charId = charId;
    this.pendingName = name;
    this.appearance = appearance;
    // Placeholder capsule so the mesh is visible immediately
    const ph = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.28, 1.1, 6, 12),
      new THREE.MeshStandardMaterial({ color: 0xff3355, transparent: true, opacity: 0.9 })
    );
    ph.position.y = 0.85;
    this.root.add(ph);
    this.load();
  }

  private async load(): Promise<void> {
    try {
      const loader = new GLTFLoader();
      const gltf: any = await new Promise((resolve, reject) => {
        loader.load(this.modelUrl, resolve, undefined, reject);
      });
      console.log('[GLTFCharacterMesh] loaded', this.modelUrl, 'anims:', (gltf.animations||[]).map((a:any)=>a.name));
      // remove placeholder
      while (this.root.children.length) this.root.remove(this.root.children[0]);
      const scene = gltf.scene.clone(true);
      // Normalize scale: many Sketchfab exports are in cm (scale 100) or arbitrary.
      const box = new THREE.Box3().setFromObject(scene);
      const size = new THREE.Vector3();
      box.getSize(size);
      const height = Math.max(size.y, 0.01);
      const scale = 1.75 / height;
      scene.scale.setScalar(scale);
      // Center on ground
      const box2 = new THREE.Box3().setFromObject(scene);
      scene.position.y -= box2.min.y;
      this.root.add(scene);
      this.mixer = new THREE.AnimationMixer(scene);
      for (const clip of gltf.animations || []) {
        try {
          const action = this.mixer.clipAction(clip);
          this.actions.set(clip.name, action);
        } catch {}
      }
      this.loaded = true;
      // apply tint
      if (this.appearance) this.setAppearance(this.appearance);
      this.setNameAndHp(this.pendingName, this.pendingHp);
      this.playState(this.desiredState);
    } catch (e) {
      this.loadFailed = true;
      this.useFallback = true;
      while (this.root.children.length) this.root.remove(this.root.children[0]);
      this.fallback = new HumanCharacterMesh(this.charId as any, this.pendingName, this.appearance || undefined);
      this.root.add(this.fallback.root);
      console.warn('GLTFCharacterMesh load failed, using procedural fallback:', this.modelUrl, e);
    }
  }

  private findClip(state: CharAnimState): THREE.AnimationClip | null {
    const names = [...this.actions.keys()];
    const lower = (s: string) => s.toLowerCase().trim();
    const match = (pred: (n: string) => boolean) => {
      // prefer exact match
      const exact = names.find(n => lower(n) === pred.toString().toLowerCase().replace(/^.*=>/, '').trim());
      // fallback: first matching
      const n = names.find(pred);
      const chosen = (exact && pred(exact)) ? exact : n;
      return chosen ? this.actions.get(chosen)!.getClip() : null;
    };
    const has = (kw: string) => names.find(n => lower(n).includes(kw));
    switch (state) {
      case 'IDLE': {
        const n = has('idle');
        return n ? this.actions.get(n)!.getClip() : null;
      }
      case 'WALK': {
        const exact = names.find(n => lower(n) === 'walk' || lower(n) === 'rig|walk');
        const n = exact || names.find(n => lower(n).includes('walk') && !lower(n).includes('stair'));
        return n ? this.actions.get(n)!.getClip() : null;
      }
      case 'RUN':
      case 'FLEE': {
        const exact = names.find(n => lower(n) === 'run' || lower(n) === 'rig|run');
        const n = exact || has('run');
        return n ? this.actions.get(n)!.getClip() : null;
      }
      case 'JUMP': {
        const n = names.find(n => lower(n).includes('jump') && (lower(n).includes('start') || lower(n).includes('loop'))) || has('jump');
        return n ? this.actions.get(n)!.getClip() : null;
      }
      default: {
        const n = has('idle');
        return n ? this.actions.get(n)!.getClip() : null;
      }
    }
  }

  private playState(state: CharAnimState): void {
    if (!this.mixer) return;
    const clip = this.findClip(state);
    if (!clip) return;
    const action = this.mixer.clipAction(clip);
    if (action === this.currentAction) return;
    if (this.currentAction) this.currentAction.fadeOut(0.15);
    action.reset().fadeIn(0.15).play();
    this.currentAction = action;
  }

  public updateAnimation(dt: number, state: CharAnimState): void {
    this.desiredState = state;
    if (this.useFallback && this.fallback) {
      this.fallback.updateAnimation(dt, state);
      return;
    }
    if (this.loaded) {
      this.playState(state);
      if (this.mixer) this.mixer.update(dt);
    }
  }

  public setAppearance(app: CharacterAppearance): void {
    this.appearance = app;
    if (this.useFallback && this.fallback) {
      this.fallback.setAppearance(app);
      return;
    }
    if (!this.loaded) return;
    // tint suit/body materials by jacket/accent color
    const jacket = new THREE.Color(app.jacketColor);
    const accent = new THREE.Color(app.accentColor);
    const skin = new THREE.Color(app.skinColor);
    this.root.traverse((o: any) => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m.color) continue;
        const n = (o.name || '').toLowerCase();
        if (n.includes('body') || n.includes('skin') || n.includes('face')) {
          m.color.copy(skin);
        } else if (n.includes('suit') || n.includes('jacket') || n.includes('shirt')) {
          m.color.copy(jacket);
        } else if (n.includes('accent') || n.includes('tie')) {
          m.color.copy(accent);
        }
      }
    });
  }

  public setNameAndHp(name: string, hp: number): void {
    this.pendingName = name;
    this.pendingHp = hp;
    if (this.useFallback && this.fallback) {
      this.fallback.setNameAndHp(name, hp);
      return;
    }
    if (!this.loaded) return;
    if (!this.nameCanvas) {
      this.nameCanvas = document.createElement('canvas');
      this.nameCanvas.width = 256;
      this.nameCanvas.height = 64;
      this.nameCtx = this.nameCanvas.getContext('2d')!;
      const tex = new THREE.CanvasTexture(this.nameCanvas);
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      this.nameSprite = new THREE.Sprite(mat);
      this.nameSprite.scale.set(1.6, 0.4, 1);
      this.nameSprite.position.set(0, 2.05, 0);
      this.root.add(this.nameSprite);
    }
    if (!this.nameCtx || !this.nameSprite) return;
    const ctx = this.nameCtx;
    ctx.clearRect(0, 0, 256, 64);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(4, 4, 248, 56);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(name || '', 128, 30);
    // hp bar
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(24, 40, 208, 8);
    ctx.fillStyle = hp > 50 ? '#22c55e' : (hp > 25 ? '#f59e0b' : '#ef4444');
    ctx.fillRect(24, 40, 208 * Math.max(0, Math.min(1, hp / 100)), 8);
    (this.nameSprite.material as THREE.SpriteMaterial).map!.needsUpdate = true;
  }

  public showSpeechBubble(_text: string): void {}
  public triggerEmoji(_emoji: string): void {}
  public triggerPunchVisual(): void {}

  public dispose(): void {
    if (this.mixer) this.mixer.stopAllAction();
    if (this.useFallback && this.fallback) this.fallback.dispose();
    this.root.traverse((o: any) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) {
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) m.dispose?.();
      }
    });
  }
}