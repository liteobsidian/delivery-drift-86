/**
 * AudioSystem — all sound is synthesized with Web Audio (no assets).
 * Engine hum, tire skid, impact thuds, chimes, UI blips and a light
 * synthwave loop. Autoplay-safe: the context resumes on first gesture.
 */

export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private skidGain: GainNode | null = null;
  private skidSrc: AudioBufferSourceNode | null = null;
  private musicTimer: number | null = null;
  private musicStep = 0;
  muted = false;
  volume = 1; // 0..1 master multiplier

  ensure(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5 * this.volume;
      this.master.connect(this.ctx.destination);
      this.buildEngine();
      this.buildSkid();
    } catch {
      this.ctx = null;
    }
  }

  private applyGain(): void {
    if (this.master && this.ctx) {
      this.master.gain.linearRampToValueAtTime(
        this.muted ? 0 : 0.5 * this.volume,
        this.ctx.currentTime + 0.1
      );
    }
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyGain();
  }

  private buildEngine(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = "sawtooth";
    this.engineOsc.frequency.value = 60;
    this.engineOsc2 = ctx.createOscillator();
    this.engineOsc2.type = "square";
    this.engineOsc2.frequency.value = 30;
    const g2 = ctx.createGain();
    g2.gain.value = 0.4;
    this.engineOsc.connect(filter);
    this.engineOsc2.connect(g2);
    g2.connect(filter);
    filter.connect(this.engineGain);
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    this.engineOsc2.start();
  }

  private buildSkid(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const len = ctx.sampleRate * 1;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.skidSrc = ctx.createBufferSource();
    this.skidSrc.buffer = buf;
    this.skidSrc.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 800;
    bp.Q.value = 1.2;
    this.skidGain = ctx.createGain();
    this.skidGain.gain.value = 0;
    this.skidSrc.connect(bp);
    bp.connect(this.skidGain);
    this.skidGain.connect(this.master);
    this.skidSrc.start();
  }

  /** rpm01: 0..1, load: 0..1 throttle; drift: 0..1 slip amount */
  updateEngine(rpm01: number, load: number, drift: number): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.engineOsc && this.engineOsc2 && this.engineGain) {
      const f = 55 + rpm01 * 210 + load * 25;
      this.engineOsc.frequency.setTargetAtTime(f, t, 0.05);
      this.engineOsc2.frequency.setTargetAtTime(f * 0.5, t, 0.05);
      this.engineGain.gain.setTargetAtTime(0.05 + rpm01 * 0.1 + load * 0.06, t, 0.08);
    }
    if (this.skidGain) {
      this.skidGain.gain.setTargetAtTime(drift * 0.22, t, 0.06);
    }
  }

  private blip(freq: number, dur: number, type: OscillatorType, vol: number, slide = 0): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    if (slide !== 0) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), ctx.currentTime + dur);
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.connect(g);
    g.connect(this.master);
    o.start();
    o.stop(ctx.currentTime + dur + 0.02);
  }

  private noise(dur: number, vol: number, cutoff: number): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(this.master);
    src.start();
  }

  uiClick(): void {
    this.blip(660, 0.07, "triangle", 0.18);
  }
  cash(): void {
    this.blip(880, 0.1, "triangle", 0.22);
    setTimeout(() => this.blip(1320, 0.16, "triangle", 0.22), 90);
  }
  success(): void {
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.22, "triangle", 0.2), i * 110)
    );
  }
  fail(): void {
    [392, 330, 262].forEach((f, i) =>
      setTimeout(() => this.blip(f, 0.3, "sawtooth", 0.14), i * 160)
    );
  }
  fine(): void {
    this.blip(220, 0.25, "square", 0.2, -120);
    setTimeout(() => this.blip(180, 0.3, "square", 0.18, -80), 140);
  }
  thud(strength: number): void {
    this.noise(0.18, Math.min(0.5, 0.12 + strength * 0.3), 500);
    this.blip(70, 0.15, "sine", 0.25, -30);
  }
  splash(): void {
    this.noise(0.35, 0.2, 2400);
  }
  crack(): void {
    this.noise(0.12, 0.3, 3500);
    this.blip(1400, 0.08, "square", 0.1, -600);
  }

  /** Light synthwave-ish loop, started once per driving session. */
  startMusic(): void {
    if (!this.ctx || this.musicTimer !== null) return;
    const bass = [55, 55, 65.4, 49]; // A A C G
    const arp = [220, 277, 330, 440, 330, 277];
    this.musicStep = 0;
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx) return;
      const s = this.musicStep++;
      const bar = Math.floor(s / 8) % 4;
      if (s % 2 === 0) this.blip(bass[bar], 0.22, "sawtooth", 0.05, 0);
      if (s % 2 === 1) this.blip(arp[s % arp.length], 0.14, "triangle", 0.045, 0);
      if (s % 16 === 0) this.noise(0.05, 0.04, 6000);
    }, 140);
  }

  stopMusic(): void {
    if (this.musicTimer !== null) {
      clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  dispose(): void {
    this.stopMusic();
    try {
      this.engineOsc?.stop();
      this.skidSrc?.stop();
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineOsc2 = null;
    this.engineGain = null;
    this.skidGain = null;
    this.skidSrc = null;
  }
}
