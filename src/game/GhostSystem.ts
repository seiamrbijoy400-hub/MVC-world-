import * as THREE from 'three';
import { CarMesh } from '../graphics/CarMesh';
import type { GhostFrame } from './SaveManager';

export class GhostSystem {
  public ghostMesh: CarMesh;
  private recording: GhostFrame[] = [];
  private playback: GhostFrame[] = [];
  private recordAccum = 0;
  private playbackIndex = 0;
  public hasGhost = false;

  constructor(scene: THREE.Scene, savedGhost: GhostFrame[]) {
    this.ghostMesh = new CarMesh(false, true);
    this.ghostMesh.root.visible = false;
    scene.add(this.ghostMesh.root);

    this.loadFrames(savedGhost);
  }

  /** Replace the replay frames after a save import, with defensive numeric checks. */
  public loadFrames(frames: GhostFrame[] | undefined): void {
    this.playback = Array.isArray(frames) ? frames.filter(
      (f) => f && [f.t, f.x, f.y, f.z, f.yaw, f.pitch, f.roll, f.steer].every((n) => Number.isFinite(n))
    ).slice() : [];
    this.playbackIndex = 0;
    this.hasGhost = this.playback.length > 4;
    if (!this.hasGhost) this.ghostMesh.root.visible = false;
  }

  public startRecording(): void {
    this.recording = [];
    this.recordAccum = 0;
    this.playbackIndex = 0;
  }

  public recordStep(
    dt: number,
    lapTime: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    pitch: number,
    roll: number,
    steer: number
  ): void {
    this.recordAccum += dt;
    if (this.recordAccum < 0.066) return; // ~15 Hz compact sampling
    this.recordAccum = 0;
    if (this.recording.length < 3600) {
      this.recording.push({
        t: Number(lapTime.toFixed(2)),
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        z: Number(z.toFixed(2)),
        yaw: Number(yaw.toFixed(3)),
        pitch: Number(pitch.toFixed(3)),
        roll: Number(roll.toFixed(3)),
        steer: Number(steer.toFixed(3))
      });
    }
  }

  public commitBestLap(): GhostFrame[] | null {
    if (this.recording.length < 10) return null;
    this.playback = this.recording.slice();
    this.hasGhost = true;
    return this.playback;
  }

  public updatePlayback(active: boolean, lapTime: number): void {
    if (!active || !this.hasGhost || this.playback.length < 2) {
      this.ghostMesh.root.visible = false;
      return;
    }

    this.ghostMesh.root.visible = true;
    while (
      this.playbackIndex < this.playback.length - 2 &&
      this.playback[this.playbackIndex + 1].t < lapTime
    ) {
      this.playbackIndex++;
    }

    const a = this.playback[this.playbackIndex];
    const b = this.playback[Math.min(this.playback.length - 1, this.playbackIndex + 1)];
    const span = Math.max(0.001, b.t - a.t);
    const alpha = THREE.MathUtils.clamp((lapTime - a.t) / span, 0, 1);

    const x = THREE.MathUtils.lerp(a.x, b.x, alpha);
    const y = THREE.MathUtils.lerp(a.y, b.y, alpha);
    const z = THREE.MathUtils.lerp(a.z, b.z, alpha);

    let dYaw = b.yaw - a.yaw;
    while (dYaw > Math.PI) dYaw -= Math.PI * 2;
    while (dYaw < -Math.PI) dYaw += Math.PI * 2;
    const yaw = a.yaw + dYaw * alpha;

    const pitch = THREE.MathUtils.lerp(a.pitch, b.pitch, alpha);
    const roll = THREE.MathUtils.lerp(a.roll, b.roll, alpha);
    const steer = THREE.MathUtils.lerp(a.steer, b.steer, alpha);

    this.ghostMesh.setGhostPose(x, y, z, yaw, pitch, roll, steer);
  }
}
