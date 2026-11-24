// Core: shared game context, math helpers, persistent settings, and input (keyboard/mouse, gamepad, touch).
export const G = { t: 0, dt: 0, debug: /debug/.test(location.hash) };

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => a + (b - a) * (1 - Math.exp(-lambda * dt));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// critically damped spring used for weapon/camera motion
export class Spring {
  constructor(k = 120, d = 18) { this.x = 0; this.v = 0; this.k = k; this.d = d; }
  kick(v) { this.v += v; }
  update(dt, target = 0) { const a = -this.k * (this.x - target) - this.d * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; }
}

export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked: settings just won't persist */ } }
};

export const isTouch = (matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1) && 'ontouchstart' in window;

// ---------------- settings ----------------
export const PRESETS = {
  low:    { renderScale: 0.75, shadows: false, ao: false, bloom: false, aa: false, shadowRes: 1024, texSize: 256, lights: 2 },
  medium: { renderScale: 1.0,  shadows: true,  ao: false, bloom: true,  aa: true,  shadowRes: 1024, texSize: 512, lights: 4 },
  high:   { renderScale: 1.0,  shadows: true,  ao: true,  bloom: true,  aa: true,  shadowRes: 2048, texSize: 512, lights: 6 },
  ultra:  { renderScale: 1.25, shadows: true,  ao: true,  bloom: true,  aa: true,  shadowRes: 4096, texSize: 1024, lights: 8 }
};
const DEFAULTS = { preset: isTouch ? 'low' : 'high', fov: 80, sens: 1, adsSens: 0.85, invertY: false, padSens: 1, aimAssist: true,
  master: 0.8, sfx: 1, music: 0.5, showFps: false, difficulty: 'regular', autoQuality: true };
export const settings = Object.assign({}, DEFAULTS, PRESETS[DEFAULTS.preset], store.get('iron.settings', {}));
export function saveSettings() { store.set('iron.settings', settings); }
export function applyPreset(name) { Object.assign(settings, PRESETS[name], { preset: name }); saveSettings(); }

// ---------------- input ----------------
const KEYMAP = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], crouch: ['KeyC', 'ControlLeft'], prone: ['KeyZ'], reload: ['KeyR'],
  interact: ['KeyF'], lethal: ['KeyG'], tactical: ['KeyQ'], melee: ['KeyV'], streak: ['Digit4'], fireMode: ['KeyB'],
  w1: ['Digit1'], w2: ['Digit2'], pause: ['Escape', 'KeyP']
};

export class Input {
  constructor() {
    this.down = new Set(); this.hit = new Set();
    this.mdx = 0; this.mdy = 0; this.mbuttons = 0; this.mhit = 0; this.wheel = 0;
    this.locked = false; this.lockEl = null; this.skipMoves = 0; this.onLockChange = null;
    this.capture = false;               // true while playing (prevents page scrolling keys)
    this.source = isTouch ? 'touch' : 'kbm';
    this.pad = { prev: [], prevRT: 0, bHeld: 0, xHeld: 0, proneSent: false, useSent: false, sprintToggle: false };
    this.t = { stick: null, sx: 0, sy: 0, vx: 0, vy: 0, look: null, lx: 0, ly: 0, dx: 0, dy: 0, fire: false, ads: false, hits: new Set(), sprint: false };
    this.A = {};
    addEventListener('keydown', (e) => {
      if (this.capture && ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (!e.repeat) this.hit.add(e.code);
      this.down.add(e.code); this.source = 'kbm';
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => { this.down.clear(); this.mbuttons = 0; });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      // browsers sometimes report one huge bogus jump right after capture: drop it
      if (this.skipMoves > 0) { this.skipMoves--; if (Math.abs(e.movementX) + Math.abs(e.movementY) > 40) return; }
      if (Math.abs(e.movementX) > 300 || Math.abs(e.movementY) > 300) return;
      this.mdx += e.movementX; this.mdy += e.movementY; this.source = 'kbm';
    });
    addEventListener('mousedown', (e) => { if (!this.locked) return; this.mbuttons |= 1 << e.button; this.mhit |= 1 << e.button; this.source = 'kbm'; });
    addEventListener('mouseup', (e) => { this.mbuttons &= ~(1 << e.button); });
    addEventListener('wheel', (e) => { if (this.locked) this.wheel += Math.sign(e.deltaY); }, { passive: true });
    addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.locked = !!this.lockEl && document.pointerLockElement === this.lockEl;
      this.skipMoves = 2; if (!this.locked) this.mbuttons = 0;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }
  requestLock(el) {
    if (isTouch) return;
    this.lockEl = el;
    try { const r = el.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { /* not available: menus still work */ }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  clear() { this.down.clear(); this.hit.clear(); this.mdx = this.mdy = 0; this.mbuttons = this.mhit = 0; this.wheel = 0; this.t.hits.clear(); this.t.fire = false; }

  attachTouch(root) {
    const T = this.t, $ = (id) => document.getElementById(id);
    const stick = $('tStick'), knob = $('tKnob');
    root.addEventListener('touchstart', (e) => {
      for (const p of e.changedTouches) {
        if (p.clientX < innerWidth * 0.42 && T.stick === null) {
          T.stick = p.identifier; T.sx = p.clientX; T.sy = p.clientY;
          stick.style.cssText = `left:${p.clientX}px;top:${p.clientY}px;opacity:1`; knob.style.cssText = `left:${p.clientX}px;top:${p.clientY}px;opacity:1`;
        } else if (T.look === null) { T.look = p.identifier; T.lx = p.clientX; T.ly = p.clientY; }
      }
      this.source = 'touch';
    }, { passive: true });
    root.addEventListener('touchmove', (e) => {
      for (const p of e.changedTouches) {
        if (p.identifier === T.stick) {
          let dx = p.clientX - T.sx, dy = p.clientY - T.sy; const d = Math.hypot(dx, dy), m = 58;
          T.sprint = d > m * 1.3 && dy < -m * 0.8;
          if (d > m) { dx *= m / d; dy *= m / d; }
          knob.style.left = `${T.sx + dx}px`; knob.style.top = `${T.sy + dy}px`; T.vx = dx / m; T.vy = dy / m;
        } else if (p.identifier === T.look) { T.dx += p.clientX - T.lx; T.dy += p.clientY - T.ly; T.lx = p.clientX; T.ly = p.clientY; }
      }
    }, { passive: true });
    const end = (e) => {
      for (const p of e.changedTouches) {
        if (p.identifier === T.stick) { T.stick = null; T.vx = T.vy = 0; T.sprint = false; stick.style.opacity = 0; knob.style.opacity = 0; }
        if (p.identifier === T.look) T.look = null;
      }
    };
    root.addEventListener('touchend', end); root.addEventListener('touchcancel', end);
    const btn = (id, down, up) => {
      const el = $(id);
      el.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('on'); down(e); }, { passive: false });
      el.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.remove('on'); if (up) up(e); }, { passive: false });
      el.addEventListener('touchcancel', (e) => { el.classList.remove('on'); if (up) up(e); });
    };
    // fire button doubles as a look pad so you can steer while shooting
    const fire = $('tFire'); let fid = null, fx = 0, fy = 0;
    fire.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); const p = e.changedTouches[0]; fid = p.identifier; fx = p.clientX; fy = p.clientY; T.fire = true; T.hits.add('fire'); fire.classList.add('on'); }, { passive: false });
    fire.addEventListener('touchmove', (e) => { e.preventDefault(); e.stopPropagation(); for (const p of e.changedTouches) if (p.identifier === fid) { T.dx += p.clientX - fx; T.dy += p.clientY - fy; fx = p.clientX; fy = p.clientY; } }, { passive: false });
    const fend = (e) => { e.preventDefault(); T.fire = false; fid = null; fire.classList.remove('on'); };
    fire.addEventListener('touchend', fend, { passive: false }); fire.addEventListener('touchcancel', fend);
    btn('tAds', () => { T.ads = !T.ads; }, () => $('tAds').classList.toggle('on', T.ads));
    for (const [id, name] of [['tJump', 'jump'], ['tCrouch', 'crouch'], ['tReload', 'reload'], ['tSwap', 'swap'], ['tNade', 'lethal'], ['tTac', 'tactical'],
      ['tMelee', 'melee'], ['tUse', 'interact'], ['tStreak', 'streak'], ['tPause', 'pause']]) btn(id, () => T.hits.add(name));
  }

  poll(dt, aimScale = 1) {
    const A = this.A, k = (n) => KEYMAP[n].some((c) => this.down.has(c)), h = (n) => KEYMAP[n].some((c) => this.hit.has(c));
    A.moveX = (k('right') ? 1 : 0) - (k('left') ? 1 : 0);
    A.moveY = (k('forward') ? 1 : 0) - (k('back') ? 1 : 0);
    A.lookX = this.mdx * 0.0022 * settings.sens * aimScale;
    A.lookY = this.mdy * 0.0022 * settings.sens * aimScale;
    A.fire = !!(this.mbuttons & 1); A.firePressed = !!(this.mhit & 1); A.ads = !!(this.mbuttons & 4);
    A.sprint = k('sprint'); A.holdBreath = A.sprint;
    A.jump = h('jump'); A.crouch = h('crouch'); A.prone = h('prone'); A.reload = h('reload');
    A.interact = h('interact'); A.interactHeld = k('interact');
    A.lethal = h('lethal'); A.lethalHeld = k('lethal'); A.tactical = h('tactical'); A.melee = h('melee'); A.streak = h('streak');
    A.fireMode = h('fireMode'); A.pause = h('pause');
    A.weapon = h('w1') ? 0 : h('w2') ? 1 : -1; A.swap = this.wheel !== 0;

    // ---- gamepad ----
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = null; for (const p of pads) if (p && p.connected) { gp = p; break; }
    if (gp) {
      const P = this.pad, val = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0), on = (i) => val(i) > 0.5, edge = (i) => on(i) && !P.prev[i];
      const dz = (x, y, d) => { const m = Math.hypot(x, y); if (m < d) return [0, 0]; const s = (m - d) / (1 - d) / m; return [x * s, y * s]; };
      const [lx, ly] = dz(gp.axes[0] || 0, gp.axes[1] || 0, 0.16), [rx, ry] = dz(gp.axes[2] || 0, gp.axes[3] || 0, 0.12);
      const active = lx || ly || rx || ry || gp.buttons.some((b) => b && b.value > 0.5);
      if (active) this.source = 'pad';
      if (this.source === 'pad') {
        A.moveX += lx; A.moveY += -ly;
        const curve = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.7);
        A.lookX += curve(rx) * 3.6 * settings.padSens * dt * aimScale;
        A.lookY += curve(ry) * 2.7 * settings.padSens * dt * aimScale;
        const rt = val(7); A.fire = A.fire || rt > 0.3; A.firePressed = A.firePressed || (rt > 0.3 && P.prevRT <= 0.3); P.prevRT = rt;
        A.ads = A.ads || val(6) > 0.3;
        if (edge(0)) A.jump = true;
        // B: tap = crouch, hold = prone
        if (on(1)) { P.bHeld += dt; if (P.bHeld > 0.35 && !P.proneSent) { A.prone = true; P.proneSent = true; } }
        else { if (P.bHeld > 0 && P.bHeld <= 0.35) A.crouch = true; P.bHeld = 0; P.proneSent = false; }
        // X: tap = reload, hold = use
        if (on(2)) { P.xHeld += dt; if (P.xHeld > 0.3 && !P.useSent) { A.interact = true; P.useSent = true; } A.interactHeld = true; }
        else { if (P.xHeld > 0 && P.xHeld <= 0.3) A.reload = true; P.xHeld = 0; P.useSent = false; }
        if (edge(3)) A.swap = true;
        if (edge(5)) A.lethal = true; A.lethalHeld = A.lethalHeld || on(5);
        if (edge(4)) A.tactical = true;
        if (edge(11)) A.melee = true;
        if (edge(10)) P.sprintToggle = !P.sprintToggle;
        if (Math.hypot(lx, ly) < 0.3 || ly > 0.2) P.sprintToggle = false;
        A.sprint = A.sprint || P.sprintToggle; A.holdBreath = A.holdBreath || on(10);
        if (edge(12)) A.streak = true;
        if (edge(14)) A.fireMode = true;
        if (edge(9)) A.pause = true;
      }
      P.prev = gp.buttons.map((b) => b && b.value > 0.5);
    }

    // ---- touch ----
    if (this.source === 'touch') {
      const T = this.t;
      A.moveX += T.vx; A.moveY += -T.vy; A.sprint = A.sprint || T.sprint;
      A.lookX += T.dx * 0.0042 * settings.sens * aimScale; A.lookY += T.dy * 0.0042 * settings.sens * aimScale; T.dx = T.dy = 0;
      A.fire = A.fire || T.fire; A.firePressed = A.firePressed || T.hits.has('fire'); A.ads = A.ads || T.ads;
      for (const n of ['jump', 'crouch', 'reload', 'lethal', 'tactical', 'melee', 'interact', 'streak', 'pause']) if (T.hits.has(n)) A[n] = true;
      if (T.hits.has('swap')) A.swap = true;
      T.hits.clear();
    }
    const m = Math.hypot(A.moveX, A.moveY); if (m > 1) { A.moveX /= m; A.moveY /= m; }
    if (settings.invertY) A.lookY = -A.lookY;
    this.hit.clear(); this.mdx = this.mdy = 0; this.mhit = 0; this.wheel = 0;
    return A;
  }
}
