import * as THREE from 'three';
import { TrackEnvironment } from '../graphics/TrackEnvironment';
import { SoundManager } from '../audio/SoundManager';

export interface LapStats {
  currentLap: number;
  totalLaps: number; // 0 = Free Roam (unlimited)
  currentLapTime: number;
  totalRaceTime: number;
  bestLapTime: number | null;
  lastLapTime: number | null;
  lapTimes: number[];
  sectorTimes: (number | null)[];
  isRaceFinished: boolean;
  driftScore: number;
  currentDriftPoints: number;
  driftMultiplier: number;
}

export class LapManager {
  public stats: LapStats = {
    currentLap: 1,
    totalLaps: 3,
    currentLapTime: 0,
    totalRaceTime: 0,
    bestLapTime: null,
    lastLapTime: null,
    lapTimes: [],
    sectorTimes: [null, null, null],
    isRaceFinished: false,
    driftScore: 0,
    currentDriftPoints: 0,
    driftMultiplier: 1.0
  };

  private track: TrackEnvironment;
  private sound: SoundManager;
  public nextCheckpointIndex = 1;
  private onNotification: (title: string, desc: string) => void;
  private onRaceFinished: (stats: LapStats) => void;
  public onDriftBanked: (bankedPoints: number, multiplier: number) => void = () => {};
  public onDriftLost: (lostPoints: number) => void = () => {};
  public onLapRecorded: (lapTime: number, isNewBest: boolean) => void = () => {};

  private driftBankTimer = 0;
  private driftSustainedTimer = 0;
  public lastDriftRate = 0;

  constructor(
    track: TrackEnvironment,
    sound: SoundManager,
    onNotification: (title: string, desc: string) => void,
    onRaceFinished: (stats: LapStats) => void
  ) {
    this.track = track;
    this.sound = sound;
    this.onNotification = onNotification;
    this.onRaceFinished = onRaceFinished;
  }

  public resetRace(totalLaps = this.stats.totalLaps): void {
    this.stats.currentLap = 1;
    this.stats.totalLaps = totalLaps;
    this.stats.currentLapTime = 0;
    this.stats.totalRaceTime = 0;
    this.stats.lastLapTime = null;
    this.stats.lapTimes = [];
    this.stats.sectorTimes = [null, null, null];
    this.stats.isRaceFinished = false;
    this.stats.driftScore = 0;
    this.stats.currentDriftPoints = 0;
    this.stats.driftMultiplier = 1.0;
    this.nextCheckpointIndex = 1;
    this.driftBankTimer = 0;
    this.driftSustainedTimer = 0;
    this.lastDriftRate = 0;

    for (const cp of this.track.checkpoints) {
      cp.passed = false;
    }
  }

  public addStyleBonus(points: number, multBump = 0): void {
    this.stats.currentDriftPoints += points;
    this.stats.driftMultiplier = Math.min(10.0, Number((this.stats.driftMultiplier + multBump).toFixed(1)));
    this.driftBankTimer = Math.max(this.driftBankTimer, 2.2);
  }

  public handleDriftCrash(impactKmh: number): void {
    if (impactKmh > 42 && this.stats.currentDriftPoints > 80) {
      const lost = Math.round(this.stats.currentDriftPoints);
      this.stats.currentDriftPoints = 0;
      this.stats.driftMultiplier = 1.0;
      this.driftSustainedTimer = 0;
      this.driftBankTimer = 0;
      this.onDriftLost(lost);
    }
  }

  public updateDriftOnly(
    dt: number,
    isDrifting: boolean,
    speedKmh: number,
    driftAngle: number,
    weatherBonus = 1.0
  ): void {
    this.lastDriftRate = 0;
    if (isDrifting && speedKmh >= 36 && driftAngle >= 10 && driftAngle <= 68) {
      const speedFactor = Math.min(1.5, Math.max(0.25, (speedKmh - 36) / 140));
      let angleFactor = 0.5;
      if (driftAngle >= 20 && driftAngle <= 50) angleFactor = 1.0;
      else if (driftAngle > 50) angleFactor = 0.85;

      this.driftSustainedTimer += dt;
      if (this.driftSustainedTimer >= 0.48) {
        this.driftSustainedTimer = 0;
        this.stats.driftMultiplier = Math.min(10.0, Number((this.stats.driftMultiplier + 0.1).toFixed(1)));
      }

      const rate = 185 * speedFactor * angleFactor * this.stats.driftMultiplier * weatherBonus;
      this.lastDriftRate = rate;
      this.stats.currentDriftPoints += rate * dt;
      this.driftBankTimer = 2.2; // 2.2s chain grace window between corners
    } else if (this.stats.currentDriftPoints > 0) {
      this.driftBankTimer -= dt;
      if (this.driftBankTimer <= 0) {
        const banked = Math.round(this.stats.currentDriftPoints);
        const mult = this.stats.driftMultiplier;
        this.stats.driftScore += banked;
        this.stats.currentDriftPoints = 0;
        this.stats.driftMultiplier = 1.0;
        this.driftSustainedTimer = 0;
        if (banked >= 50) {
          this.onDriftBanked(banked, mult);
        }
      }
    }
  }

  public update(
    dt: number,
    carPos: THREE.Vector3,
    isDrifting: boolean,
    speedKmh: number,
    driftAngle: number,
    weatherBonus = 1.0
  ): void {
    if (this.stats.isRaceFinished) return;

    this.stats.currentLapTime += dt;
    this.stats.totalRaceTime += dt;

    this.updateDriftOnly(dt, isDrifting, speedKmh, driftAngle, weatherBonus);

    // Check distance to next expected checkpoint
    const targetCp = this.track.checkpoints[this.nextCheckpointIndex];
    if (!targetCp) return;

    const dist = Math.hypot(targetCp.center.x - carPos.x, targetCp.center.z - carPos.z);
    if (dist < targetCp.width * 0.58) {
      targetCp.passed = true;

      if (this.nextCheckpointIndex === 0) {
        this.onLapCompleted();
        this.nextCheckpointIndex = 1;
      } else {
        this.sound.playBeep(920, 0.08);
        const secNum = this.nextCheckpointIndex;
        this.stats.sectorTimes[secNum - 1] = this.stats.currentLapTime;
        if (this.stats.totalLaps > 0) {
          this.onNotification(`SECTOR ${secNum}`, `Split: ${this.formatTime(this.stats.currentLapTime)}`);
        }
        this.nextCheckpointIndex++;
        if (this.nextCheckpointIndex >= this.track.checkpoints.length) {
          this.nextCheckpointIndex = 0;
        }
      }
    }
  }

  private onLapCompleted(): void {
    const completedLapTime = this.stats.currentLapTime;
    this.stats.lastLapTime = completedLapTime;
    this.stats.lapTimes.push(completedLapTime);

    let isNewBest = false;
    if (this.stats.bestLapTime === null || completedLapTime < this.stats.bestLapTime) {
      this.stats.bestLapTime = completedLapTime;
      isNewBest = true;
    }

    this.sound.playBeep(isNewBest ? 1200 : 880, 0.25);
    this.onLapRecorded(completedLapTime, isNewBest);

    if (this.stats.totalLaps === 0 || this.stats.currentLap < this.stats.totalLaps) {
      this.stats.currentLap++;
      this.stats.currentLapTime = 0;
      this.stats.sectorTimes = [null, null, null];

      const noticeTitle = isNewBest ? 'NEW BEST LAP!' : (this.stats.currentLap === this.stats.totalLaps ? 'FINAL LAP!' : `LAP ${this.stats.currentLap}`);
      const noticeDesc = `Lap Time: ${this.formatTime(completedLapTime)}`;
      this.onNotification(noticeTitle, noticeDesc);
    } else {
      if (this.stats.currentDriftPoints > 0) {
        this.stats.driftScore += Math.round(this.stats.currentDriftPoints);
        this.stats.currentDriftPoints = 0;
      }
      this.stats.isRaceFinished = true;
      this.onNotification('FINISH!', `Best Lap: ${this.formatTime(this.stats.bestLapTime!)}`);
      this.onRaceFinished(this.stats);
    }

    for (const cp of this.track.checkpoints) {
      cp.passed = false;
    }
  }

  public formatTime(seconds: number): string {
    if (seconds <= 0 || !isFinite(seconds)) return '--:--.--';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }
}
