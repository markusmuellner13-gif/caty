// Fully procedural WebAudio: music, ambience and SFX are synthesized at
// runtime so the game ships with zero audio assets.
import { clamp, rand, pick } from './util.js';

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.started = false;
    this.musicVol = 0.6;
    this.sfxVol = 0.8;
    this._musicTimer = null;
    this._birdTimer = null;
    this._purr = null;
    this._engine = null;
  }

  // Must be called from a user gesture.
  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(this.ctx.destination);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicVol;
    this.musicBus.connect(this.master);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.sfxVol;
    this.sfxBus.connect(this.master);

    // Gentle reverb-ish delay for music glue.
    const delay = this.ctx.createDelay(0.5);
    delay.delayTime.value = 0.31;
    const fb = this.ctx.createGain();
    fb.gain.value = 0.28;
    const wet = this.ctx.createGain();
    wet.gain.value = 0.22;
    this.musicBus.connect(delay);
    delay.connect(fb);
    fb.connect(delay);
    delay.connect(wet);
    wet.connect(this.master);

    this._noiseBuf = this._makeNoise();
    this.started = true;
    this._startAmbience();
    this._startMusic();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }

  setMusicVol(v) { this.musicVol = v; if (this.musicBus) this.musicBus.gain.value = v; }
  setSfxVol(v) { this.sfxVol = v; if (this.sfxBus) this.sfxBus.gain.value = v; }

  _makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noise(dur, filterFreq, gainVal, bus, type = 'lowpass', q = 1) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf;
    src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filterFreq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(bus);
    src.start(t); src.stop(t + dur + 0.05);
    return { src, f, g };
  }

  _tone({ freq = 440, dur = 0.2, type = 'sine', vol = 0.2, attack = 0.005, slideTo = null, bus = null, when = 0 }) {
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus || this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
    return o;
  }

  // ---------- Ambience ----------
  _startAmbience() {
    // Wind: looping filtered noise with slow LFO.
    const wind = this.ctx.createBufferSource();
    wind.buffer = this._noiseBuf; wind.loop = true;
    const wf = this.ctx.createBiquadFilter();
    wf.type = 'lowpass'; wf.frequency.value = 380; wf.Q.value = 0.4;
    const wg = this.ctx.createGain(); wg.gain.value = 0.035;
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.13;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 130;
    lfo.connect(lfoG); lfoG.connect(wf.frequency);
    wind.connect(wf); wf.connect(wg); wg.connect(this.musicBus);
    wind.start(); lfo.start();

    const birds = () => {
      if (!this.started) return;
      if (Math.random() < 0.75) this.birdChirp();
      this._birdTimer = setTimeout(birds, rand(1800, 6500));
    };
    this._birdTimer = setTimeout(birds, 1500);
  }

  birdChirp() {
    const base = rand(2100, 3400);
    const n = Math.floor(rand(2, 5));
    for (let i = 0; i < n; i++) {
      this._tone({ freq: base * rand(0.9, 1.15), slideTo: base * rand(1.2, 1.5), dur: 0.09, type: 'sine', vol: 0.03, when: i * rand(0.09, 0.14), bus: this.musicBus });
    }
  }

  // ---------- Music: generative pentatonic lullaby ----------
  _startMusic() {
    const scale = [0, 3, 5, 7, 10, 12, 15, 17]; // minor pentatonic-ish on A
    const root = 220;
    let step = 0;
    const beat = 0.42;
    const loop = () => {
      if (!this.started) return;
      const t = step % 32;
      // Soft pad every 8 beats
      if (t % 8 === 0) {
        const chordRoot = root / 2 * Math.pow(2, pick([0, 3, 5, 7]) / 12);
        [1, 1.5, 2].forEach((m) => {
          this._tone({ freq: chordRoot * m, dur: beat * 8, type: 'triangle', vol: 0.035, attack: 1.2, bus: this.musicBus });
        });
      }
      // Plucks
      if (Math.random() < 0.62) {
        const f = root * Math.pow(2, pick(scale) / 12);
        this._tone({ freq: f, dur: 0.5, type: 'sine', vol: 0.055, attack: 0.004, bus: this.musicBus });
        this._tone({ freq: f * 2, dur: 0.25, type: 'sine', vol: 0.02, attack: 0.004, bus: this.musicBus });
      }
      step++;
      this._musicTimer = setTimeout(loop, beat * 1000);
    };
    loop();
  }

  // ---------- SFX ----------
  jump() { this._tone({ freq: 300, slideTo: 620, dur: 0.16, type: 'triangle', vol: 0.12 }); }
  doubleJump() { this._tone({ freq: 420, slideTo: 900, dur: 0.18, type: 'triangle', vol: 0.13 }); }
  land(hard = false) { this._noise(hard ? 0.16 : 0.08, hard ? 300 : 500, hard ? 0.22 : 0.09, this.sfxBus); }
  footstep(grass = true) { this._noise(0.045, grass ? 900 : 1800, 0.028, this.sfxBus, grass ? 'lowpass' : 'highpass'); }
  climb() { this._noise(0.07, 1200, 0.05, this.sfxBus, 'bandpass', 2); }

  meow(excited = false) {
    const t = this.ctx.currentTime;
    const f0 = excited ? 620 : 480;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f0 * 0.7, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.25, t + 0.14);
    o.frequency.exponentialRampToValueAtTime(f0 * 0.65, t + 0.42);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2.2;
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(1900, t + 0.12);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.42);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(f); f.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.5);
  }

  purr(on) {
    if (on && !this._purr) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth'; o.frequency.value = 26;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 140;
      const g = this.ctx.createGain(); g.gain.value = 0.0;
      g.gain.setTargetAtTime(0.14, this.ctx.currentTime, 0.4);
      o.connect(f); f.connect(g); g.connect(this.sfxBus);
      o.start();
      this._purr = { o, g };
    } else if (!on && this._purr) {
      const { o, g } = this._purr;
      g.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.2);
      o.stop(this.ctx.currentTime + 0.8);
      this._purr = null;
    }
  }

  pickup() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.14, type: 'sine', vol: 0.09, when: i * 0.06 }));
  }
  eat() {
    this._noise(0.12, 700, 0.1, this.sfxBus, 'bandpass', 1.5);
    this._tone({ freq: 300, slideTo: 200, dur: 0.1, vol: 0.06, when: 0.08 });
  }
  checkpoint() {
    [392, 523, 659, 784, 1047].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.35, type: 'triangle', vol: 0.1, when: i * 0.09 }));
  }
  levelUp() {
    [523, 659, 784, 1047, 1319].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.3, type: 'square', vol: 0.045, when: i * 0.07 }));
  }
  hurt() {
    this._tone({ freq: 260, slideTo: 120, dur: 0.25, type: 'sawtooth', vol: 0.16 });
    this._noise(0.18, 500, 0.14, this.sfxBus);
  }
  death() {
    [440, 392, 330, 262, 196].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.5, type: 'triangle', vol: 0.12, when: i * 0.22 }));
  }
  bark() {
    for (let i = 0; i < 2; i++) {
      this._tone({ freq: 160, slideTo: 90, dur: 0.14, type: 'sawtooth', vol: 0.2, when: i * 0.22 });
      this._noise(0.1, 800, 0.16, this.sfxBus, 'bandpass', 1.2);
    }
  }
  honk() {
    this._tone({ freq: 370, dur: 0.28, type: 'square', vol: 0.09 });
    this._tone({ freq: 466, dur: 0.28, type: 'square', vol: 0.09 });
  }
  splash() {
    this._noise(0.5, 900, 0.2, this.sfxBus);
    this._tone({ freq: 320, slideTo: 90, dur: 0.3, type: 'sine', vol: 0.1 });
  }
  fishCatch() {
    this.splash();
    [659, 784, 1047, 1319].forEach((f, i) =>
      this._tone({ freq: f, dur: 0.2, type: 'sine', vol: 0.1, when: 0.15 + i * 0.07 }));
  }
  pounce() { this._tone({ freq: 200, slideTo: 480, dur: 0.14, type: 'triangle', vol: 0.1 }); }
  win() {
    const seq = [523, 659, 784, 1047, 784, 1047, 1319, 1568];
    seq.forEach((f, i) => {
      this._tone({ freq: f, dur: 0.42, type: 'triangle', vol: 0.12, when: i * 0.16 });
      this._tone({ freq: f / 2, dur: 0.42, type: 'sine', vol: 0.07, when: i * 0.16 });
    });
  }
  uiClick() { this._tone({ freq: 700, dur: 0.06, type: 'sine', vol: 0.06 }); }

  // Distance-based car rumble, call every frame with nearest car distance.
  carProximity(dist) {
    if (!this.started) return;
    if (dist < 30) {
      if (!this._engine) {
        const o = this.ctx.createOscillator();
        o.type = 'sawtooth'; o.frequency.value = 55;
        const o2 = this.ctx.createOscillator();
        o2.type = 'square'; o2.frequency.value = 110;
        const f = this.ctx.createBiquadFilter();
        f.type = 'lowpass'; f.frequency.value = 240;
        const g = this.ctx.createGain(); g.gain.value = 0;
        o.connect(f); o2.connect(f); f.connect(g); g.connect(this.sfxBus);
        o.start(); o2.start();
        this._engine = { o, o2, g };
      }
      const v = clamp(1 - dist / 30, 0, 1);
      this._engine.g.gain.setTargetAtTime(v * v * 0.14, this.ctx.currentTime, 0.1);
    } else if (this._engine) {
      this._engine.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
  }
}
