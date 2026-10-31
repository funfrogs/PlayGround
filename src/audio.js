// Fully procedural WebAudio sound design. No audio assets required.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = 0.7;
    this.muted = false;
    this.ambience = null;
    this.combatGain = null;
    this.heartTimer = 0;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 7;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    // reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.4, 2.8);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.32;
    this.reverb.connect(this.wet);
    this.wet.connect(this.master);

    this.noiseBuf = this._noiseBuffer(2.5);
    this.ready = true;
    this._startAmbience();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  _impulse(dur, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (1 - t * 0.3);
      }
    }
    return buf;
  }

  _noiseBuffer(dur) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _noise(dur = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    s.loop = true;
    s.loopEnd = this.noiseBuf.duration;
    return s;
  }

  _env(gain, t0, attack, peak, decay, end = 0.0001) {
    gain.gain.cancelScheduledValues(t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    gain.gain.exponentialRampToValueAtTime(Math.max(end, 0.0001), t0 + attack + decay);
  }

  _pan(value = 0) {
    const p = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (p) { p.pan.value = Math.max(-1, Math.min(1, value)); p.connect(this.master); return p; }
    return this.master;
  }

  // ---------------------------------------------------------------- ambience
  _startAmbience() {
    const ctx = this.ctx, t = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(this.master);
    this.ambience = bus;

    // rain bed
    const rain = this._noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420;
    const g = ctx.createGain(); g.gain.value = 0.055;
    rain.connect(lp); lp.connect(hp); hp.connect(g); g.connect(bus);
    rain.start(t);

    // wind
    const wind = this._noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 280; bp.Q.value = 0.7;
    const wg = ctx.createGain(); wg.gain.value = 0.05;
    wind.connect(bp); bp.connect(wg); wg.connect(bus);
    wind.start(t);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain(); lfoG.gain.value = 130;
    lfo.connect(lfoG); lfoG.connect(bp.frequency); lfo.start(t);

    // dread drone
    const droneGain = ctx.createGain(); droneGain.gain.value = 0.028;
    const droneFilter = ctx.createBiquadFilter(); droneFilter.type = 'lowpass'; droneFilter.frequency.value = 170;
    droneGain.connect(droneFilter); droneFilter.connect(bus);
    [41.2, 55, 82.4].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth';
      o.frequency.value = f * (1 + (i - 1) * 0.002);
      const og = ctx.createGain(); og.gain.value = i === 2 ? 0.18 : 0.5;
      o.connect(og); og.connect(droneGain); o.start(t);
    });
    const dLfo = ctx.createOscillator(); dLfo.frequency.value = 0.045;
    const dLfoG = ctx.createGain(); dLfoG.gain.value = 55;
    dLfo.connect(dLfoG); dLfoG.connect(droneFilter.frequency); dLfo.start(t);

    // combat pulse bus (faded in during waves)
    this.combatGain = ctx.createGain();
    this.combatGain.gain.value = 0;
    this.combatGain.connect(bus);
    this._combatTimer = 0;
  }

  setCombat(on) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.combatGain.gain.cancelScheduledValues(t);
    this.combatGain.gain.linearRampToValueAtTime(on ? 1 : 0, t + 2.0);
  }

  update(dt) {
    if (!this.ready) return;
    this._combatTimer -= dt;
    if (this.combatGain && this._combatTimer <= 0 && this.combatGain.gain.value > 0.05) {
      this._combatTimer = 1.35;
      this._pulse();
    }
  }

  _pulse() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    const g = ctx.createGain(); this._env(g, t, 0.01, 0.09, 0.4);
    o.connect(g); g.connect(this.combatGain);
    o.start(t); o.stop(t + 0.45);
    // off-beat tick
    const n = this._noise(); const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 2;
    const ng = ctx.createGain(); this._env(ng, t + 0.66, 0.005, 0.02, 0.09);
    n.connect(bp); bp.connect(ng); ng.connect(this.combatGain);
    n.start(t + 0.66); n.stop(t + 0.8);
  }

  // ------------------------------------------------------------------ weapons
  gunshot(pan = 0, type = 'rifle') {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._pan(pan);
    const isShotgun = type === 'shotgun';

    // crack
    const n = this._noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(isShotgun ? 5200 : 7000, t);
    lp.frequency.exponentialRampToValueAtTime(isShotgun ? 700 : 1200, t + 0.16);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 140;
    const g = ctx.createGain();
    this._env(g, t, 0.002, isShotgun ? 0.85 : 0.55, isShotgun ? 0.34 : 0.17);
    n.connect(hp); hp.connect(lp); lp.connect(g); g.connect(out); g.connect(this.reverb);
    n.start(t); n.stop(t + 0.5);

    // body thump
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(isShotgun ? 150 : 190, t);
    o.frequency.exponentialRampToValueAtTime(isShotgun ? 34 : 48, t + (isShotgun ? 0.28 : 0.14));
    const og = ctx.createGain(); this._env(og, t, 0.002, isShotgun ? 0.7 : 0.42, isShotgun ? 0.38 : 0.15);
    o.connect(og); og.connect(out);
    o.start(t); o.stop(t + 0.6);

    // metallic transient
    const c = ctx.createOscillator(); c.type = 'square'; c.frequency.value = isShotgun ? 380 : 720;
    const cg = ctx.createGain(); this._env(cg, t, 0.001, 0.06, 0.035);
    c.connect(cg); cg.connect(out); c.start(t); c.stop(t + 0.06);
  }

  reload(stage = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._pan(0.1);
    const n = this._noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = stage === 0 ? 1100 : 1900; bp.Q.value = 3;
    const g = ctx.createGain(); this._env(g, t, 0.002, stage === 0 ? 0.13 : 0.16, 0.06);
    n.connect(bp); bp.connect(g); g.connect(out);
    n.start(t); n.stop(t + 0.1);
    if (stage === 2) {
      const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 260;
      const og = ctx.createGain(); this._env(og, t, 0.001, 0.05, 0.05);
      o.connect(og); og.connect(out); o.start(t); o.stop(t + 0.07);
    }
  }

  empty() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 1250;
    const g = ctx.createGain(); this._env(g, t, 0.001, 0.07, 0.03);
    o.connect(g); g.connect(this._pan(0.1)); o.start(t); o.stop(t + 0.05);
  }

  hit(headshot = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const freqs = headshot ? [1480, 2220] : [880];
    freqs.forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); this._env(g, t + i * 0.035, 0.002, 0.075, 0.07);
      o.connect(g); g.connect(this._pan(0)); o.start(t + i * 0.035); o.stop(t + i * 0.035 + 0.1);
    });
  }

  kill() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [440, 660].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
      const g = ctx.createGain(); this._env(g, t + i * 0.05, 0.002, 0.05, 0.12);
      o.connect(g); g.connect(this._pan(0)); o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.15);
    });
  }

  // ------------------------------------------------------------------ zombies
  growl(pan = 0, vol = 0.5, pitch = 1, kind = 'walker') {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._pan(pan);
    const base = (kind === 'boomer' ? 52 : kind === 'climber' ? 105 : 78) * pitch;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 1.25, t);
    o.frequency.linearRampToValueAtTime(base * 0.82, t + 0.65);
    const vib = ctx.createOscillator(); vib.frequency.value = 6.5 + Math.random() * 3;
    const vg = ctx.createGain(); vg.gain.value = base * 0.12;
    vib.connect(vg); vg.connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = kind === 'boomer' ? 260 : 620; lp.Q.value = 2;
    const g = ctx.createGain(); this._env(g, t, 0.08, 0.16 * vol, 0.55, 0.0001);
    o.connect(lp); lp.connect(g); g.connect(out);
    const n = this._noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 420; bp.Q.value = 1.2;
    const ng = ctx.createGain(); this._env(ng, t + 0.03, 0.05, 0.05 * vol, 0.5);
    n.connect(bp); bp.connect(ng); ng.connect(out);
    o.start(t); o.stop(t + 0.8); vib.start(t); vib.stop(t + 0.8); n.start(t); n.stop(t + 0.75);
  }

  scratch(pan = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1600;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3000; bp.Q.value = 1.4;
    const g = ctx.createGain(); this._env(g, t, 0.01, 0.06, 0.25);
    n.connect(hp); hp.connect(bp); bp.connect(g); g.connect(this._pan(pan));
    n.start(t); n.stop(t + 0.3);
  }

  boomerBeep(pan = 0, rate = 1) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square'; o.frequency.value = 520 * rate;
    const g = ctx.createGain(); this._env(g, t, 0.005, 0.05, 0.08);
    o.connect(g); g.connect(this._pan(pan)); o.start(t); o.stop(t + 0.1);
  }

  explosion(pan = 0, big = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._pan(pan);
    const n = this._noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(big ? 1800 : 2600, t);
    lp.frequency.exponentialRampToValueAtTime(90, t + (big ? 1.2 : 0.7));
    const g = ctx.createGain(); this._env(g, t, 0.004, big ? 1.0 : 0.7, big ? 1.3 : 0.75);
    n.connect(lp); lp.connect(g); g.connect(out); g.connect(this.reverb);
    n.start(t); n.stop(t + 1.6);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(big ? 90 : 120, t);
    o.frequency.exponentialRampToValueAtTime(24, t + (big ? 1.0 : 0.6));
    const og = ctx.createGain(); this._env(og, t, 0.005, big ? 0.9 : 0.6, big ? 1.2 : 0.7);
    o.connect(og); og.connect(out); o.start(t); o.stop(t + 1.5);
  }

  // -------------------------------------------------------------------- player
  footstep(sprint = false) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260 + Math.random() * 120;
    const g = ctx.createGain(); this._env(g, t, 0.002, sprint ? 0.1 : 0.06, 0.11);
    n.connect(lp); lp.connect(g); g.connect(this._pan(rand(-0.15, 0.15)));
    n.start(t); n.stop(t + 0.16);
    // wet splash
    const n2 = this._noise();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2200;
    const g2 = ctx.createGain(); this._env(g2, t, 0.002, 0.022, 0.08);
    n2.connect(hp); hp.connect(g2); g2.connect(this._pan(0));
    n2.start(t); n2.stop(t + 0.12);
  }

  jump() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900;
    const g = ctx.createGain(); this._env(g, t, 0.005, 0.04, 0.12);
    n.connect(bp); bp.connect(g); g.connect(this._pan(0)); n.start(t); n.stop(t + 0.15);
  }

  hurt() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this._noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
    const g = ctx.createGain(); this._env(g, t, 0.005, 0.16, 0.22);
    n.connect(lp); lp.connect(g); g.connect(this._pan(0)); n.start(t); n.stop(t + 0.3);
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.3);
    const og = ctx.createGain(); this._env(og, t, 0.01, 0.14, 0.3);
    o.connect(og); og.connect(this._pan(0)); o.start(t); o.stop(t + 0.35);
  }

  heartbeat() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator(); o.type = 'sine';
      o.frequency.setValueAtTime(58, t + i * 0.16);
      o.frequency.exponentialRampToValueAtTime(38, t + i * 0.16 + 0.12);
      const g = ctx.createGain(); this._env(g, t + i * 0.16, 0.01, i ? 0.12 : 0.2, 0.14);
      o.connect(g); g.connect(this._pan(0)); o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.2);
    }
  }

  pickup() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    [660, 990].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); this._env(g, t + i * 0.07, 0.005, 0.07, 0.14);
      o.connect(g); g.connect(this._pan(0)); o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.18);
    });
  }

  waveHorn() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = this._pan(0);
    [55, 82.5, 110].forEach((f, i) => {
      const o = ctx.createOscillator(); o.type = i === 0 ? 'sawtooth' : 'triangle';
      o.frequency.setValueAtTime(f, t);
      o.frequency.linearRampToValueAtTime(f * 0.94, t + 2.2);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      o.connect(lp); lp.connect(g); g.connect(out); g.connect(this.reverb);
      o.start(t); o.stop(t + 2.7);
    });
  }

  thunder() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + rand(0.15, 0.6);
    const n = this._noise();
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.8);
    n.connect(lp); lp.connect(g); g.connect(this._pan(rand(-0.5, 0.5))); g.connect(this.reverb);
    n.start(t); n.stop(t + 3.0);
    // crack
    const n2 = this._noise();
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.6;
    const g2 = ctx.createGain(); this._env(g2, t, 0.005, 0.12, 0.3);
    n2.connect(bp); bp.connect(g2); g2.connect(this._pan(0)); n2.start(t); n2.stop(t + 0.4);
  }

  ui() {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = 520;
    const g = ctx.createGain(); this._env(g, t, 0.003, 0.05, 0.06);
    o.connect(g); g.connect(this._pan(0)); o.start(t); o.stop(t + 0.08);
  }
}

function rand(a, b) { return a + Math.random() * (b - a); }
