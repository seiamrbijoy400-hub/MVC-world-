/**
 * Adaptive render-resolution governor for mobile GPUs.
 *
 * Watches the presented frame budget over short windows and nudges the
 * renderer pixel ratio down when the device cannot hold a playable frame
 * rate, then back up once headroom returns. Hysteresis (several consecutive
 * windows before a step) prevents visible resolution pumping.
 */
export interface AdaptiveResolutionOptions {
  /** Never scale below this device pixel ratio (>= 0.5). */
  minRatio?: number;
  /** Never scale above this device pixel ratio. */
  maxRatio?: number;
  /** Pixel-ratio change per adjustment. */
  step?: number;
  /** Seconds of frames averaged per decision window. */
  windowSec?: number;
  /** Seconds to ignore at startup / after a context change. */
  warmupSec?: number;
  /** Drop resolution below this frame rate. */
  downFps?: number;
  /** Raise resolution above this frame rate. */
  upFps?: number;
  /** Consecutive slow windows required before stepping down. */
  downWindows?: number;
  /** Consecutive fast windows required before stepping up. */
  upWindows?: number;
}

const DEFAULTS: Required<AdaptiveResolutionOptions> = {
  minRatio: 0.7,
  maxRatio: 2,
  step: 0.1,
  windowSec: 1,
  warmupSec: 3,
  downFps: 45,
  upFps: 57,
  downWindows: 2,
  upWindows: 4
};

export class AdaptiveResolution {
  private readonly opts: Required<AdaptiveResolutionOptions>;
  private ratio: number;
  private windowTime = 0;
  private windowFrames = 0;
  private warmupLeft: number;
  private downStreak = 0;
  private upStreak = 0;

  constructor(initialRatio: number, options: AdaptiveResolutionOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
    this.opts.minRatio = Math.max(0.4, Math.min(this.opts.minRatio, this.opts.maxRatio));
    this.ratio = this.clamp(initialRatio);
    this.warmupLeft = Math.max(0, this.opts.warmupSec);
  }

  public get currentRatio(): number {
    return this.ratio;
  }

  public get maxRatio(): number {
    return this.opts.maxRatio;
  }

  public get minRatio(): number {
    return this.opts.minRatio;
  }

  /** Re-applies bounds after a manual quality change and restarts the warmup. */
  public setBounds(minRatio: number, maxRatio: number, currentRatio: number): void {
    this.opts.minRatio = Math.max(0.4, Math.min(minRatio, maxRatio));
    this.opts.maxRatio = Math.max(this.opts.minRatio, maxRatio);
    this.ratio = this.clamp(currentRatio);
    this.reset();
  }

  /** Clears accumulated samples (pause, tab switch, context restore). */
  public reset(): void {
    this.windowTime = 0;
    this.windowFrames = 0;
    this.warmupLeft = Math.max(0, this.opts.warmupSec);
    this.downStreak = 0;
    this.upStreak = 0;
  }

  /**
   * Feeds one rendered frame. Returns the new pixel ratio when a step is due,
   * otherwise null. Long stalls (tab return, shader compile, GC) are ignored.
   */
  public sample(dt: number): number | null {
    // Ignore paused frames and one-off stalls so a single hitch cannot
    // permanently soften the image.
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.25) {
      this.windowTime = 0;
      this.windowFrames = 0;
      return null;
    }

    if (this.warmupLeft > 0) {
      this.warmupLeft = Math.max(0, this.warmupLeft - dt);
      return null;
    }

    this.windowTime += dt;
    this.windowFrames++;
    if (this.windowTime < this.opts.windowSec) return null;

    const fps = this.windowFrames / this.windowTime;
    this.windowTime = 0;
    this.windowFrames = 0;

    if (fps < this.opts.downFps) {
      this.downStreak++;
      this.upStreak = 0;
      if (this.downStreak >= this.opts.downWindows) {
        this.downStreak = 0;
        const next = this.clamp(this.ratio - this.opts.step);
        if (next < this.ratio) {
          this.ratio = next;
          return this.ratio;
        }
      }
      return null;
    }

    if (fps > this.opts.upFps) {
      this.upStreak++;
      this.downStreak = 0;
      if (this.upStreak >= this.opts.upWindows) {
        this.upStreak = 0;
        const next = this.clamp(this.ratio + this.opts.step);
        if (next > this.ratio) {
          this.ratio = next;
          return this.ratio;
        }
      }
      return null;
    }

    this.downStreak = 0;
    this.upStreak = 0;
    return null;
  }

  private clamp(value: number): number {
    const stepped = Math.round(value * 100) / 100;
    return Math.max(this.opts.minRatio, Math.min(this.opts.maxRatio, stepped));
  }
}
