// Audio: everything is synthesised at runtime with WebAudio (no samples).
// Layered gunshots, convolution reverb, HRTF-positioned world sounds with distance filtering and speed-of-sound delay.
import { G, settings, rand, clamp } from './core.js';

const GUN = {
  ar:      { crack: 3800, body: 1500, sub: 70,  dur: 0.22, vol: 1.0,  tail: 0.35 },
  smg:     { crack: 4600, body: 1900, sub: 95,  dur: 0.15, vol: 0.85, tail: 0.25 },
  shotgun: { crack: 2500, body: 850,  sub: 52,  dur: 0.36, vol: 1.2,  tail: 0.55 },
  lmg:     { crack: 3300, body: 1150, sub: 60,  dur: 0.26, vol: 1.08, tail: 0.42 },
  sniper:  { crack: 2900, body: 760,  sub: 44,  dur: 0.5,  vol: 1.35, tail: 0.8 },
  dmr:     { crack: 3400, body: 1000, sub: 55,  dur: 0.3,  vol: 1.12, tail: 0.5 },
  pistol:  { crack: 4300, body: 1700, sub: 105, dur: 0.14, vol: 0.8,  tail: 0.25 },
  launcher:{ crack: 1300, body: 520,  sub: 40,  dur: 0.7,  vol: 1.1,  tail: 0.6 },
  turret:  { crack: 4800, body: 2000, sub: 110, dur: 0.12, vol: 0.7,  tail: 0.2 },
  heli:    { crack: 3000, body: 1000, sub: 60,  dur: 0.2,  vol: 0.9,  tail: 0.4 }
};

export class AudioEngine {
  constructor() { this.ctx = null; this.loops = new Set(); this.battleT = 4; this.beatT = 0; this.lowHealth = 0; }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    let ctx;
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master = ctx.createGain(); this.master.connect(comp); comp.connect(ctx.destination);
    this.sfxFilter = ctx.createBiquadFilter(); this.sfxFilter.type = 'lowpass'; this.sfxFilter.frequency.value = 20000;
    this.sfx = ctx.createGain(); this.sfx.connect(this.sfxFilter); this.sfxFilter.connect(this.master);
    this.music = ctx.createGain(); this.music.connect(this.master);
    this.ui = ctx.createGain(); this.ui.connect(this.master);
    // reverb: generated stereo impulse with early reflections
    this.reverb = ctx.createConvolver(); this.reverb.buffer = this._impulse(2.4, 2.6);
    this.reverbIn = ctx.createGain(); this.reverbIn.gain.value = 0.6; this.reverbIn.connect(this.reverb); this.reverb.connect(this.sfxFilter);
    const mk = (len) => { const b = ctx.createBuffer(1, ctx.sampleRate * len, ctx.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; };
    this.noise = mk(2); this.noiseLong = mk(4);
    this.setVolumes();
  }
  get ready() { return !!this.ctx; }
  setVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = settings.master; this.sfx.gain.value = settings.sfx; this.ui.gain.value = settings.sfx * 0.8; this.music.gain.value = settings.music * 0.7;
  }
  _impulse(len, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * len), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * 0.5;
      for (const ms of [11, 19, 31, 47, 67, 89]) { const i = Math.floor((ms + c * 3) / 1000 * ctx.sampleRate); if (i < n) d[i] += (Math.random() < 0.5 ? -1 : 1) * 0.6 * (1 - ms / 120); }
    }
    return b;
  }

  listener(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = cam.position, f = this._f || (this._f = { x: 0, y: 0, z: 0 });
    const e = cam.matrixWorld.elements; f.x = -e[8]; f.y = -e[9]; f.z = -e[10];
    this.lp = p;
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z; L.upX.value = e[4]; L.upY.value = e[5]; L.upZ.value = e[6];
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, e[4], e[5], e[6]); }
  }
  // routing for one sound: positional (panner + air absorption + delay) or straight to the bus
  _dest(pos, bus, wet = 0.2) {
    const ctx = this.ctx, g = ctx.createGain();
    let delay = 0, dist = 0;
    if (pos) {
      const lp = this.lp || { x: 0, y: 0, z: 0 };
      dist = Math.hypot(pos.x - lp.x, pos.y - lp.y, pos.z - lp.z);
      delay = Math.min(dist / 343, 0.7);
      const lpF = ctx.createBiquadFilter(); lpF.type = 'lowpass'; lpF.frequency.value = clamp(20000 * Math.exp(-dist / 55), 500, 20000);
      const pan = ctx.createPanner(); pan.panningModel = dist < 60 ? 'HRTF' : 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 3; pan.rolloffFactor = 1.1; pan.maxDistance = 400;
      if (pan.positionX) { pan.positionX.value = pos.x; pan.positionY.value = pos.y; pan.positionZ.value = pos.z; } else pan.setPosition(pos.x, pos.y, pos.z);
      g.connect(lpF); lpF.connect(pan); pan.connect(bus || this.sfx);
      if (wet > 0) { const s = ctx.createGain(); s.gain.value = wet * (1 + Math.min(dist / 60, 1.5)); lpF.connect(s); s.connect(this.reverbIn); }
    } else {
      g.connect(bus || this.sfx);
      if (wet > 0) { const s = ctx.createGain(); s.gain.value = wet; g.connect(s); s.connect(this.reverbIn); }
    }
    return { node: g, t: ctx.currentTime + delay, dist };
  }
  _noise(dest, t, dur, { type = 'bandpass', freq = 1000, q = 0.7, gain = 1, attack = 0.002, rate = 1, sweep = 0, long = false } = {}) {
    const ctx = this.ctx, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = long ? this.noiseLong : this.noise; s.playbackRate.value = rate;
    f.type = type; f.frequency.setValueAtTime(freq, t); if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur); f.Q.value = q;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  _tone(dest, t, dur, { freq = 440, type = 'sine', gain = 0.5, slide = 0, attack = 0.002 } = {}) {
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest); o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------------- world sounds ----------------
  gun(name, pos = null, { suppressed = false, player = false, vol = 1 } = {}) {
    if (!this.ctx) return;
    const p = GUN[name] || GUN.ar, s = suppressed ? 0.22 : 1, r = rand(0.94, 1.06);
    const d = this._dest(pos, null, p.tail * (suppressed ? 0.25 : 1));
    const v = p.vol * vol * (player ? 0.9 : 1.6);
    this._noise(d.node, d.t, 0.045, { freq: p.crack * r, q: 0.9, gain: 0.9 * v * s });
    this._noise(d.node, d.t, p.dur * (suppressed ? 0.5 : 1), { type: 'lowpass', freq: p.body * r * (suppressed ? 0.6 : 1), q: 0.6, gain: 0.85 * v * (suppressed ? 0.45 : 1), rate: r });
    this._tone(d.node, d.t, 0.14 + p.dur * 0.3, { freq: p.sub * 2.2 * r, slide: 0.45, gain: 0.95 * v * s });
    if (player) this._tone(d.node, d.t, 0.02, { freq: 2200 * r, type: 'square', gain: 0.05 });
    if (!player && !suppressed && d.dist > 25) this._noise(d.node, d.t + 0.06, 0.6, { type: 'lowpass', freq: 500, gain: 0.25 * v, long: true }); // distant rumble
  }
  explosion(pos, size = 1) {
    if (!this.ctx) return;
    const d = this._dest(pos, null, 0.9);
    this._noise(d.node, d.t, 0.12, { freq: 2200, q: 0.5, gain: 1.2 * size });
    this._noise(d.node, d.t, 1.8 * size, { type: 'lowpass', freq: 520, q: 0.4, gain: 1.6 * size, long: true });
    this._tone(d.node, d.t, 1.1, { freq: 70, slide: 0.45, gain: 1.4 * size });
    for (let i = 0; i < 6; i++) this._noise(d.node, d.t + 0.15 + Math.random() * 0.8, 0.05, { freq: rand(1500, 5000), q: 2, gain: 0.12 * size });
  }
  impact(mat, pos) {
    if (!this.ctx || !pos) return;
    const d = this._dest(pos, null, 0.08); if (d.dist > 45) return;
    const t = d.t, n = d.node;
    switch (mat) {
      case 'metal': this._tone(n, t, 0.25, { freq: rand(1600, 3200), gain: 0.18 }); this._noise(n, t, 0.04, { freq: 5000, gain: 0.25 }); break;
      case 'wood': this._noise(n, t, 0.09, { freq: 700, q: 1.2, gain: 0.45 }); break;
      case 'glass': for (let i = 0; i < 5; i++) this._tone(n, t + i * 0.025, 0.12, { freq: rand(3000, 6500), gain: 0.07 }); this._noise(n, t, 0.12, { type: 'highpass', freq: 5000, gain: 0.35 }); break;
      case 'flesh': this._noise(n, t, 0.08, { type: 'lowpass', freq: 380, gain: 0.7 }); this._tone(n, t, 0.06, { freq: 140, slide: 0.6, gain: 0.3 }); break;
      case 'dirt': this._noise(n, t, 0.08, { type: 'lowpass', freq: 650, gain: 0.45 }); break;
      default: this._noise(n, t, 0.05, { freq: 2600, q: 1, gain: 0.35 }); this._noise(n, t, 0.07, { type: 'lowpass', freq: 420, gain: 0.3 });
    }
  }
  whiz(pos) {
    if (!this.ctx) return;
    const d = this._dest(pos, null, 0);
    this._noise(d.node, this.ctx.currentTime, 0.14, { freq: 1300, q: 3, gain: 0.8, sweep: 2.6, attack: 0.03 });
  }
  step(surface, pos = null, vol = 1) {
    if (!this.ctx) return;
    const d = this._dest(pos, null, 0.02), t = d.t, v = vol * rand(0.7, 1);
    if (surface === 'metal') { this._noise(d.node, t, 0.09, { freq: 1800, q: 4, gain: 0.12 * v }); this._tone(d.node, t, 0.12, { freq: rand(300, 420), gain: 0.04 * v }); }
    else if (surface === 'wood') this._noise(d.node, t, 0.1, { type: 'lowpass', freq: 500, gain: 0.25 * v });
    else if (surface === 'dirt') this._noise(d.node, t, 0.11, { freq: 900, q: 0.6, gain: 0.16 * v });
    else this._noise(d.node, t, 0.07, { freq: 1400, q: 0.8, gain: 0.13 * v });
  }
  foley(name, pos = null) {
    if (!this.ctx) return;
    const d = this._dest(pos, null, 0.03), t = d.t, n = d.node;
    switch (name) {
      case 'magOut': this._tone(n, t, 0.03, { freq: 900, type: 'square', gain: 0.08 }); this._noise(n, t + 0.02, 0.07, { freq: 2800, q: 2, gain: 0.25 }); break;
      case 'magIn': this._noise(n, t, 0.06, { freq: 2000, q: 1.5, gain: 0.45 }); this._tone(n, t, 0.03, { freq: 600, type: 'square', gain: 0.1 }); break;
      case 'bolt': this._noise(n, t, 0.12, { freq: 1800, q: 1, gain: 0.3, sweep: 1.8 }); this._tone(n, t + 0.12, 0.03, { freq: 1500, type: 'square', gain: 0.08 }); break;
      case 'pump': this._noise(n, t, 0.09, { freq: 1200, q: 1, gain: 0.45, sweep: 1.6 }); this._noise(n, t + 0.16, 0.08, { freq: 1600, q: 1, gain: 0.45, sweep: 0.7 }); break;
      case 'shell': this._noise(n, t, 0.05, { freq: 2400, q: 2, gain: 0.3 }); break;
      case 'switch': this._noise(n, t, 0.22, { type: 'lowpass', freq: 1300, gain: 0.12 }); this._tone(n, t + 0.15, 0.03, { freq: 1200, type: 'square', gain: 0.05 }); break;
      case 'dry': this._tone(n, t, 0.025, { freq: 2600, type: 'square', gain: 0.07 }); break;
      case 'pin': this._tone(n, t, 0.25, { freq: 2600, gain: 0.1 }); this._noise(n, t, 0.04, { freq: 4000, gain: 0.15 }); break;
      case 'knife': this._noise(n, t, 0.18, { freq: 900, q: 1.2, gain: 0.35, sweep: 3 }); break;
      case 'land': this._noise(n, t, 0.12, { type: 'lowpass', freq: 260, gain: 0.5 }); break;
      case 'casing': this._tone(n, t, 0.09, { freq: rand(3800, 5200), gain: 0.05 }); this._tone(n, t + 0.08, 0.06, { freq: rand(3800, 5200), gain: 0.03 }); break;
      case 'barrelHit': this._tone(n, t, 0.4, { freq: rand(200, 280), gain: 0.18 }); break;
    }
  }
  uiSound(name) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, n = this.ui;
    switch (name) {
      case 'hit': this._tone(n, t, 0.05, { freq: 1900, type: 'triangle', gain: 0.18 }); break;
      case 'head': this._tone(n, t, 0.1, { freq: 2700, type: 'triangle', gain: 0.22 }); this._tone(n, t, 0.12, { freq: 4100, gain: 0.08 }); break;
      case 'kill': this._tone(n, t, 0.07, { freq: 1300, type: 'triangle', gain: 0.2 }); this._tone(n, t + 0.05, 0.12, { freq: 1700, type: 'triangle', gain: 0.18 }); break;
      case 'buy': this._tone(n, t, 0.08, { freq: 880, type: 'triangle', gain: 0.2 }); this._tone(n, t + 0.07, 0.14, { freq: 1320, type: 'triangle', gain: 0.2 }); break;
      case 'deny': this._tone(n, t, 0.18, { freq: 160, type: 'sawtooth', gain: 0.12 }); break;
      case 'hover': this._tone(n, t, 0.03, { freq: 1500, type: 'triangle', gain: 0.05 }); break;
      case 'select': this._tone(n, t, 0.05, { freq: 900, type: 'square', gain: 0.06 }); break;
      case 'streak': [523, 659, 784, 1046].forEach((f, i) => this._tone(n, t + i * 0.08, 0.3, { freq: f, type: 'triangle', gain: 0.14 })); break;
      case 'pickup': this._tone(n, t, 0.06, { freq: 700, type: 'triangle', gain: 0.15 }); this._tone(n, t + 0.05, 0.08, { freq: 1050, type: 'triangle', gain: 0.15 }); break;
      case 'armor': this._noise(n, t, 0.2, { freq: 900, q: 1, gain: 0.3 }); this._tone(n, t, 0.2, { freq: 300, slide: 1.5, gain: 0.15 }); break;
    }
  }
  sting(kind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, n = this.music;
    const drum = (at, f = 70, g = 0.8) => { this._tone(n, at, 0.5, { freq: f * 2, slide: 0.35, gain: g }); this._noise(n, at, 0.15, { type: 'lowpass', freq: 900, gain: g * 0.4 }); };
    const chord = (at, freqs, dur, g = 0.1) => freqs.forEach((f) => { this._tone(n, at, dur, { freq: f, type: 'sawtooth', gain: g, attack: 0.08 }); this._tone(n, at, dur, { freq: f * 1.005, type: 'sawtooth', gain: g * 0.7, attack: 0.08 }); });
    if (kind === 'wave') { drum(t, 55, 1); drum(t + 0.45, 55, 0.8); drum(t + 0.7, 60, 0.9); chord(t + 0.7, [110, 164.8, 220], 1.8, 0.07); }
    if (kind === 'clear') { chord(t, [196, 246.9, 293.7], 1.2, 0.06); chord(t + 0.4, [220, 277.2, 329.6, 440], 1.8, 0.06); }
    if (kind === 'death') { drum(t, 45, 1.1); chord(t + 0.1, [98, 116.5, 146.8], 3, 0.08); }
  }
  tinnitus(dur = 3) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime; this._tone(this.ui, t, dur, { freq: 3600, gain: 0.08, attack: 0.05 });
    this.sfxFilter.frequency.cancelScheduledValues(t); this.sfxFilter.frequency.setValueAtTime(500, t); this.sfxFilter.frequency.exponentialRampToValueAtTime(20000, t + dur);
  }

  // ---------------- loops ----------------
  loop(kind, pos = null) {
    if (!this.ctx) return null;
    const ctx = this.ctx, out = ctx.createGain(); out.gain.value = 0;
    let pan = null;
    if (pos) { pan = ctx.createPanner(); pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = kind === 'rotor' ? 12 : 4; pan.rolloffFactor = 1; out.connect(pan); pan.connect(this.sfx); }
    else out.connect(kind === 'drone' ? this.music : this.sfx);
    const src = ctx.createBufferSource(); src.buffer = this.noiseLong; src.loop = true;
    const nodes = [src];
    if (kind === 'wind') {
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 0.35; src.connect(f); f.connect(out);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.frequency.value = 0.09; lg.gain.value = 0.025; lfo.connect(lg); lg.connect(out.gain); lfo.start(); nodes.push(lfo);
    } else if (kind === 'fire') {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1100; src.connect(f); f.connect(out);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.type = 'square'; lfo.frequency.value = 7.3; lg.gain.value = 0.18; lfo.connect(lg); lg.connect(out.gain); lfo.start(); nodes.push(lfo);
    } else if (kind === 'rotor') {
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380; src.connect(f);
      const am = ctx.createGain(); am.gain.value = 0.2; f.connect(am); am.connect(out);
      const lfo = ctx.createOscillator(), lg = ctx.createGain(); lfo.type = 'sawtooth'; lfo.frequency.value = 17; lg.gain.value = 0.8; lfo.connect(lg); lg.connect(am.gain); lfo.start(); nodes.push(lfo);
      const hum = ctx.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 68; const hg = ctx.createGain(); hg.gain.value = 0.05; hum.connect(hg); hg.connect(out); hum.start(); nodes.push(hum);
    } else if (kind === 'drone') {
      for (const [fr, g] of [[55, 0.05], [82.4, 0.035], [110.6, 0.03]]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; const og = ctx.createGain(); og.gain.value = g; o.connect(og); og.connect(out); o.start(); nodes.push(o); }
      const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; src.connect(f); const ng = ctx.createGain(); ng.gain.value = 0.01; f.connect(ng); ng.connect(out);
    } else if (kind === 'jet') {
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.5; src.connect(f); f.connect(out);
    }
    src.start();
    const h = { out, pan, nodes, kind,
      set: (v, p) => { if (p && pan) { if (pan.positionX) { pan.positionX.value = p.x; pan.positionY.value = p.y; pan.positionZ.value = p.z; } else pan.setPosition(p.x, p.y, p.z); } out.gain.setTargetAtTime(v, ctx.currentTime, 0.15); },
      stop: () => { out.gain.setTargetAtTime(0, ctx.currentTime, 0.2); setTimeout(() => { for (const n of nodes) { try { n.stop(); } catch (e) { /* already stopped */ } } out.disconnect(); }, 800); this.loops.delete(h); } };
    if (pos) h.set(0, pos);
    this.loops.add(h);
    return h;
  }

  update(dt, inGame) {
    if (!this.ctx) return;
    // distant battle ambience: far-off bursts and explosions in random directions
    this.battleT -= dt;
    if (inGame && this.battleT <= 0) {
      this.battleT = rand(3, 9);
      const lp = this.lp || { x: 0, y: 0, z: 0 }, a = Math.random() * Math.PI * 2, r = rand(160, 320);
      const pos = { x: lp.x + Math.cos(a) * r, y: 20, z: lp.z + Math.sin(a) * r };
      if (Math.random() < 0.25) this.explosion(pos, 0.7);
      else { const n = 3 + Math.floor(Math.random() * 6), gun = Math.random() < 0.5 ? 'ar' : 'lmg'; for (let i = 0; i < n; i++) setTimeout(() => this.gun(gun, pos, { vol: 0.8 }), i * rand(90, 140)); }
    }
    // heartbeat when badly hurt
    if (this.lowHealth > 0) {
      this.beatT -= dt;
      if (this.beatT <= 0) { this.beatT = 0.85; const t = this.ctx.currentTime; this._tone(this.ui, t, 0.12, { freq: 62, gain: 0.5 * this.lowHealth }); this._tone(this.ui, t + 0.18, 0.12, { freq: 55, gain: 0.4 * this.lowHealth }); }
    }
  }
}
