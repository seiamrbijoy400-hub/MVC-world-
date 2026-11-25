import * as THREE from 'three';
import type { WeatherMode } from '../game/SaveManager';

export class WeatherSystem {
  public mode: WeatherMode = 'CLEAR';
  public lightningFlash = 0;

  private rainMesh: THREE.LineSegments;
  private rainPositions: Float32Array;
  private dropCount = 420;
  private drops: { x: number; y: number; z: number; speed: number }[] = [];
  private stormTimer = 4.0;

  public onThunderFlash: () => void = () => {};

  constructor(scene: THREE.Scene) {
    this.rainPositions = new Float32Array(this.dropCount * 6);
    for (let i = 0; i < this.dropCount; i++) {
      this.drops.push({
        x: (Math.random() - 0.5) * 60,
        y: Math.random() * 28,
        z: (Math.random() - 0.5) * 60,
        speed: 28 + Math.random() * 14
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xbae6fd,
      transparent: true,
      opacity: 0.48,
      depthWrite: false
    });

    this.rainMesh = new THREE.LineSegments(geo, mat);
    this.rainMesh.frustumCulled = false;
    this.rainMesh.visible = false;
    scene.add(this.rainMesh);
  }

  public setMode(mode: WeatherMode): void {
    this.mode = mode;
    this.rainMesh.visible = mode !== 'CLEAR';
    const mat = this.rainMesh.material as THREE.LineBasicMaterial;
    mat.opacity = mode === 'STORM' ? 0.62 : 0.42;
  }

  public get gripMultiplier(): number {
    if (this.mode === 'STORM') return 0.74;
    if (this.mode === 'RAIN') return 0.82;
    return 1.0;
  }

  public get driftScoreMultiplier(): number {
    if (this.mode === 'STORM') return 1.5;
    if (this.mode === 'RAIN') return 1.3;
    return 1.0;
  }

  public get rainIntensity(): number {
    if (this.mode === 'STORM') return 1.0;
    if (this.mode === 'RAIN') return 0.55;
    return 0.0;
  }

  public update(dt: number, focusPos: THREE.Vector3, forward: THREE.Vector3): void {
    if (this.lightningFlash > 0) {
      this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.8);
    }

    if (this.mode === 'CLEAR') return;

    if (this.mode === 'STORM') {
      this.stormTimer -= dt;
      if (this.stormTimer <= 0) {
        this.stormTimer = 6 + Math.random() * 9;
        this.lightningFlash = 1.0;
        this.onThunderFlash();
      }
    }

    const activeCount = this.mode === 'STORM' ? this.dropCount : Math.floor(this.dropCount * 0.55);
    const centerX = focusPos.x + forward.x * 10;
    const centerZ = focusPos.z + forward.z * 10;
    const baseY = focusPos.y;

    for (let i = 0; i < this.dropCount; i++) {
      const idx = i * 6;
      if (i >= activeCount) {
        this.rainPositions[idx + 1] = -999;
        this.rainPositions[idx + 4] = -999;
        continue;
      }

      const d = this.drops[i];
      d.y -= d.speed * dt;
      d.x -= 2.8 * dt;
      if (d.y < -1) {
        d.x = (Math.random() - 0.5) * 58;
        d.y = 22 + Math.random() * 8;
        d.z = (Math.random() - 0.5) * 58;
      }

      const wx = centerX + d.x;
      const wy = baseY + d.y;
      const wz = centerZ + d.z;

      this.rainPositions[idx] = wx;
      this.rainPositions[idx + 1] = wy;
      this.rainPositions[idx + 2] = wz;

      this.rainPositions[idx + 3] = wx + 0.14;
      this.rainPositions[idx + 4] = wy + 1.05;
      this.rainPositions[idx + 5] = wz + 0.12;
    }

    this.rainMesh.geometry.attributes.position.needsUpdate = true;
  }
}
