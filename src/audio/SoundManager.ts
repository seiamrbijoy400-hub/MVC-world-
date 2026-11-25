export class SoundManager {
  private ctx: AudioContext | null = null;
  private isMuted = false;
  private masterGain: GainNode | null = null;

  // Sample-based multi-channel engine audio (from original Unity repo)
  private lowAccSource: AudioBufferSourceNode | null = null;
  private highAccSource: AudioBufferSourceNode | null = null;
  private highDecelSource: AudioBufferSourceNode | null = null;
  private lowAccGain: GainNode | null = null;
  private highAccGain: GainNode | null = null;
  private highDecelGain: GainNode | null = null;
  private crashBuffer: AudioBuffer | null = null;
  private samplesReady = false;

  // Procedural fallback synth & sub-bass punch
  private engineGain: GainNode | null = null;
  private subOsc: OscillatorNode | null = null;
  private midOsc: OscillatorNode | null = null;

  // Tire squeal, curb rumble, nitro jet & rain ambience
  private skidGain: GainNode | null = null;
  private skidFilter: BiquadFilterNode | null = null;
  private curbGain: GainNode | null = null;
  private curbOsc: OscillatorNode | null = null;
  private nitroGain: GainNode | null = null;
  private nitroFilter: BiquadFilterNode | null = null;
  private rainGain: GainNode | null = null;
  private wasNitroActive = false;

  // Music
  private musicAudio: HTMLAudioElement | null = null;
  public isMusicEnabled = false;

  private isInitialized = false;
  private lastPopTime = 0;

  constructor() {
    const unlock = () => {
      this.init();
      window.removeEventListener('click', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('touchstart', unlock);
  }

  public init(): void {
    if (this.isInitialized) {
      if (this.ctx && this.ctx.state === 'suspended') {
        this.ctx.resume().catch(() => {});
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.isMuted ? 0 : 0.85;
      this.masterGain.connect(this.ctx.destination);

      // Procedural Sub/Mid Engine Layer
      this.engineGain = this.ctx.createGain();
      this.engineGain.gain.value = 0.08;
      this.engineGain.connect(this.masterGain);

      this.subOsc = this.ctx.createOscillator();
      this.subOsc.type = 'sawtooth';
      this.subOsc.frequency.value = 40;
      const subFilter = this.ctx.createBiquadFilter();
      subFilter.type = 'lowpass';
      subFilter.frequency.value = 180;
      this.subOsc.connect(subFilter);
      subFilter.connect(this.engineGain);
      this.subOsc.start();

      this.midOsc = this.ctx.createOscillator();
      this.midOsc.type = 'triangle';
      this.midOsc.frequency.value = 80;
      const midGain = this.ctx.createGain();
      midGain.gain.value = 0.25;
      this.midOsc.connect(midGain);
      midGain.connect(this.engineGain);
      this.midOsc.start();

      // Tire screech, nitro jet & rain ambience synths
      this.createTireScreechSynth();
      this.createNitroAndRainSynths();

      // Curb rumble synth
      this.curbOsc = this.ctx.createOscillator();
      this.curbOsc.type = 'square';
      this.curbOsc.frequency.value = 28;
      this.curbGain = this.ctx.createGain();
      this.curbGain.gain.value = 0;
      const curbFilter = this.ctx.createBiquadFilter();
      curbFilter.type = 'lowpass';
      curbFilter.frequency.value = 140;
      this.curbOsc.connect(curbFilter);
      curbFilter.connect(this.curbGain);
      this.curbGain.connect(this.masterGain);
      this.curbOsc.start();

      // Background Eurobeat Music
      this.musicAudio = new Audio('/assets/sounds/step-inside-your-mind-instrumental-eurobeat-royalty-free-music.mp3');
      this.musicAudio.loop = true;
      this.musicAudio.volume = 0.22;
      if (this.isMusicEnabled && !this.isMuted) {
        this.musicAudio.play().catch(() => {});
      }

      this.isInitialized = true;

      // Load real engine & crash WAV samples
      this.loadSamples();
    } catch (e) {
      console.warn('Web Audio API unavailable:', e);
    }
  }

  private async loadSamples(): Promise<void> {
    if (!this.ctx || !this.masterGain) return;
    const loadBuf = async (url: string): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const ab = await res.arrayBuffer();
        return await this.ctx!.decodeAudioData(ab);
      } catch {
        return null;
      }
    };

    const [lowBuf, highAccBuf, highDecelBuf, crashBuf] = await Promise.all([
      loadBuf('/assets/sounds/low.wav'),
      loadBuf('/assets/sounds/high ACC.wav'),
      loadBuf('/assets/sounds/high Deacc.wav'),
      loadBuf('/assets/sounds/TrackColision.wav')
    ]);

    this.crashBuffer = crashBuf;

    if (lowBuf && highAccBuf && highDecelBuf && this.ctx && this.masterGain) {
      const startLoop = (buf: AudioBuffer, initialGain: number): [AudioBufferSourceNode, GainNode] => {
        const src = this.ctx!.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const g = this.ctx!.createGain();
        g.gain.value = initialGain;
        src.connect(g);
        g.connect(this.masterGain!);
        src.start();
        return [src, g];
      };

      [this.lowAccSource, this.lowAccGain] = startLoop(lowBuf, 0.25);
      [this.highAccSource, this.highAccGain] = startLoop(highAccBuf, 0.0);
      [this.highDecelSource, this.highDecelGain] = startLoop(highDecelBuf, 0.0);
      this.samplesReady = true;
    }
  }

  private createTireScreechSynth(): void {
    if (!this.ctx || !this.masterGain) return;

    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    this.skidFilter = this.ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.value = 1150;
    this.skidFilter.Q.value = 4.2;

    this.skidGain = this.ctx.createGain();
    this.skidGain.gain.value = 0;

    whiteNoise.connect(this.skidFilter);
    this.skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.masterGain);
    whiteNoise.start();
  }

  private createNitroAndRainSynths(): void {
    if (!this.ctx || !this.masterGain) return;
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const out = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) out[i] = Math.random() * 2 - 1;

    // Nitro Jet Synth
    const nitroSrc = this.ctx.createBufferSource();
    nitroSrc.buffer = noiseBuffer;
    nitroSrc.loop = true;
    this.nitroFilter = this.ctx.createBiquadFilter();
    this.nitroFilter.type = 'bandpass';
    this.nitroFilter.frequency.value = 620;
    this.nitroFilter.Q.value = 1.6;
    this.nitroGain = this.ctx.createGain();
    this.nitroGain.gain.value = 0;
    nitroSrc.connect(this.nitroFilter);
    this.nitroFilter.connect(this.nitroGain);
    this.nitroGain.connect(this.masterGain);
    nitroSrc.start();

    // Rain Ambience Synth
    const rainSrc = this.ctx.createBufferSource();
    rainSrc.buffer = noiseBuffer;
    rainSrc.loop = true;
    const rainFilter = this.ctx.createBiquadFilter();
    rainFilter.type = 'lowpass';
    rainFilter.frequency.value = 1600;
    this.rainGain = this.ctx.createGain();
    this.rainGain.gain.value = 0;
    rainSrc.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.masterGain);
    rainSrc.start();
  }

  public updateNitroAndRain(nitroActive: boolean, rainIntensity: number, eurobeatIntensity = 0): void {
    if (!this.ctx || !this.isInitialized || this.isMuted) return;
    const now = this.ctx.currentTime;

    if (this.nitroGain && this.nitroFilter) {
      if (nitroActive && !this.wasNitroActive) {
        this.playExhaustPop();
      }
      this.wasNitroActive = nitroActive;
      this.nitroGain.gain.setTargetAtTime(nitroActive ? 0.28 : 0, now, 0.05);
      this.nitroFilter.frequency.setTargetAtTime(nitroActive ? 1450 : 620, now, 0.08);
    }

    if (this.rainGain) {
      this.rainGain.gain.setTargetAtTime(rainIntensity * 0.14, now, 0.25);
    }

    if (this.musicAudio && this.isMusicEnabled) {
      const targetVol = 0.22 + Math.min(0.26, eurobeatIntensity * 0.26);
      this.musicAudio.volume = targetVol;
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(this.isMuted ? 0 : 0.85, this.ctx.currentTime, 0.03);
    }
    if (this.musicAudio) {
      if (this.isMuted || !this.isMusicEnabled) {
        this.musicAudio.pause();
      } else {
        this.musicAudio.play().catch(() => {});
      }
    }
    return this.isMuted;
  }

  public pauseAudio(): void {
    if (this.ctx && this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
    if (this.musicAudio) this.musicAudio.pause();
  }

  public resumeAudio(): void {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (this.musicAudio && this.isMusicEnabled && !this.isMuted) {
      this.musicAudio.play().catch(() => {});
    }
  }

  public toggleMusic(): boolean {
    this.isMusicEnabled = !this.isMusicEnabled;
    if (this.musicAudio) {
      if (this.isMusicEnabled && !this.isMuted) {
        this.musicAudio.play().catch(() => {});
      } else {
        this.musicAudio.pause();
      }
    }
    return this.isMusicEnabled;
  }

  public get muted(): boolean {
    return this.isMuted;
  }

  public updateEngineSound(
    rpm: number,
    maxRpm: number,
    throttle: number,
    isLimiter: boolean,
    onCurb: boolean,
    speedKmh: number
  ): void {
    if (!this.ctx || !this.isInitialized || this.isMuted) return;
    if (this.ctx.state === 'suspended') return;

    const now = this.ctx.currentTime;
    const rpmRatio = Math.max(0, Math.min(1, (rpm - 1000) / (maxRpm - 1000)));
    const baseFreq = (rpm * 4) / 60;

    // Crossfade authentic WAV engine channels
    if (this.samplesReady && this.lowAccSource && this.highAccSource && this.highDecelSource) {
      const lowPitch = 0.72 + rpmRatio * 0.85;
      const highPitch = 0.65 + rpmRatio * 1.15;

      this.lowAccSource.playbackRate.setTargetAtTime(lowPitch, now, 0.04);
      this.highAccSource.playbackRate.setTargetAtTime(highPitch, now, 0.04);
      this.highDecelSource.playbackRate.setTargetAtTime(highPitch, now, 0.04);

      const lowWeight = Math.max(0.05, 1.0 - rpmRatio * 1.15);
      const highWeight = Math.max(0, rpmRatio * 0.95);
      const accMix = throttle > 0.12 ? 1.0 : 0.15;
      const decelMix = 1.0 - accMix;

      this.lowAccGain!.gain.setTargetAtTime(lowWeight * 0.42, now, 0.04);
      this.highAccGain!.gain.setTargetAtTime(highWeight * accMix * 0.52, now, 0.04);
      this.highDecelGain!.gain.setTargetAtTime(highWeight * decelMix * 0.45, now, 0.04);
    }

    // Subtle procedural sub-bass punch
    if (this.subOsc && this.midOsc && this.engineGain) {
      this.subOsc.frequency.setTargetAtTime(Math.max(28, baseFreq * 0.5), now, 0.04);
      this.midOsc.frequency.setTargetAtTime(baseFreq, now, 0.04);
      const subVol = this.samplesReady ? (0.06 + throttle * 0.08) : (0.14 + throttle * 0.18 + rpmRatio * 0.1);
      this.engineGain.gain.setTargetAtTime(subVol, now, 0.04);
    }

    // Cooldown-gated limiter exhaust pops
    if (isLimiter && now - this.lastPopTime > 0.13) {
      this.playExhaustPop();
      this.lastPopTime = now;
    }

    // Curb rumble vibration audio
    if (this.curbGain && this.curbOsc) {
      if (onCurb && speedKmh > 12) {
        this.curbOsc.frequency.setTargetAtTime(22 + Math.min(40, speedKmh * 0.25), now, 0.03);
        this.curbGain.gain.setTargetAtTime(Math.min(0.16, speedKmh / 220), now, 0.02);
      } else {
        this.curbGain.gain.setTargetAtTime(0, now, 0.04);
      }
    }
  }

  public updateTireSkid(maxSkid: number): void {
    if (!this.ctx || !this.skidGain || !this.skidFilter || this.isMuted) return;

    const now = this.ctx.currentTime;
    if (maxSkid > 0.18) {
      const volume = Math.min(0.32, (maxSkid - 0.18) * 0.42);
      const freq = 950 + maxSkid * 550;
      this.skidGain.gain.setTargetAtTime(volume, now, 0.03);
      this.skidFilter.frequency.setTargetAtTime(freq, now, 0.03);
    } else {
      this.skidGain.gain.setTargetAtTime(0, now, 0.05);
    }
  }

  public playExhaustPop(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(160, now);
      osc.frequency.exponentialRampToValueAtTime(32, now + 0.07);
      gain.gain.setValueAtTime(0.22, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {}
  }

  public playGearShift(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(160, now + 0.07);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {}
  }

  public playCrash(impactSpeedKmh: number): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const vol = Math.min(0.75, Math.max(0.15, impactSpeedKmh / 110));

    if (this.crashBuffer) {
      try {
        const src = this.ctx.createBufferSource();
        src.buffer = this.crashBuffer;
        const g = this.ctx.createGain();
        g.gain.value = vol;
        src.connect(g);
        g.connect(this.masterGain);
        src.start();
        return;
      } catch {}
    }

    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(22, now + 0.25);
      gain.gain.setValueAtTime(vol * 0.6, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 0.26);
    } catch {}
  }

  public playBeep(freq = 880, duration = 0.14): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      osc.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch {}
  }

  /** Rich dual-tone automotive horn for signaling city traffic bots & friends */
  public playHorn(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18, now + 0.02);
      gain.gain.setValueAtTime(0.18, now + 0.22);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);

      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1800;
      filter.connect(gain);
      gain.connect(this.masterGain);

      for (const freq of [392, 494]) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now);
        osc.connect(filter);
        osc.start(now);
        osc.stop(now + 0.36);
      }
    } catch {}
  }

  /** Friendly street challenge chord when engaging a city cruiser bot */
  public playChallengeChime(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      try {
        const now = this.ctx!.currentTime + idx * 0.065;
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.14, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(now);
        osc.stop(now + 0.24);
      } catch {}
    });
  }

  public playSpeedTrapFlash(): void {
    this.playBeep(1480, 0.06);
    setTimeout(() => this.playBeep(1960, 0.11), 65);
  }

  public playDiscoveryChime(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const notes = [587.33, 739.99, 880, 1174.66];
    notes.forEach((freq, idx) => {
      try {
        const now = this.ctx!.currentTime + idx * 0.075;
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.16, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(now);
        osc.stop(now + 0.36);
      } catch {}
    });
  }

  public playRankUpFanfare(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
    notes.forEach((freq, idx) => {
      try {
        const now = this.ctx!.currentTime + idx * 0.09;
        const osc = this.ctx!.createOscillator();
        const gain = this.ctx!.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now);
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
        osc.connect(gain);
        gain.connect(this.masterGain!);
        osc.start(now);
        osc.stop(now + 0.48);
      } catch {}
    });
  }

  public playThunder(): void {
    if (!this.ctx || !this.masterGain || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(75, now);
      osc.frequency.exponentialRampToValueAtTime(24, now + 1.1);
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.15);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 180;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      osc.start(now);
      osc.stop(now + 1.2);
    } catch {}
  }
}
