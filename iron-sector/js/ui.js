// UI: the in-game HUD (minimap, ammo, cash, wave status, killfeed, hit markers, damage and grenade indicators, scope overlay),
// menus, the settings screen, the armory and the end-of-mission report.
import * as THREE from 'three';
import { G, settings, saveSettings, applyPreset, clamp, lerp, wrapAngle } from './core.js';
import { magSize } from './weapons.js';
import { SUPPORT, rankFor } from './systems.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');

export class UI {
  constructor() {
    this.e = {};
    for (const id of ['hud', 'bloodCv', 'scope', 'scopeCv', 'dmgDir', 'nadeInd', 'xh', 'hitm', 'minimap', 'killfeed', 'waveNum', 'waveSub', 'cash', 'score', 'armorWrap', 'armorBar',
      'streakHint', 'streakIcons', 'wName', 'ammoBox', 'ammoMag', 'ammoRes', 'equip', 'prompt', 'cmsg', 'xpFeed', 'banner', 'bannerTitle', 'bannerSub', 'subs', 'flash', 'fps', 'tUse', 'tStreak'])
      this.e[id] = $(id);
    this.xh = { t: this.e.xh.querySelector('.t'), b: this.e.xh.querySelector('.b'), l: this.e.xh.querySelector('.l'), r: this.e.xh.querySelector('.r'), d: this.e.xh.querySelector('.d') };
    this.mm = this.e.minimap.getContext('2d');
    this.cache = {}; this.dmg = []; this.nadeEls = []; this.hitT = 0; this.flashAmt = 0; this.flashHold = 0; this.bannerT = 0; this.subT = 0; this.cmsgT = 0; this.damageK = 0; this.suppressK = 0; this.fpsAcc = 0; this.fpsN = 0;
    for (let i = 0; i < 4; i++) { const d = document.createElement('div'); d.style.opacity = 0; this.e.dmgDir.appendChild(d); this.dmg.push({ el: d, t: 0, from: new THREE.Vector3() }); }
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div'); d.style.opacity = 0;
      d.innerHTML = '<svg viewBox="0 0 32 32"><circle cx="16" cy="18" r="8" fill="#1d1f1a" stroke="#e5483a" stroke-width="2"/><rect x="13" y="6" width="6" height="5" fill="#e5483a"/><path d="M16 0 L22 6 H10 Z" fill="#e5483a"/></svg>';
      this.e.nadeInd.appendChild(d); this.nadeEls.push(d);
    }
    this._bloodArt(); addEventListener('resize', () => { this._bloodArt(); this.scopeKind = null; });
  }

  // ---------------------------------------------------------------- minimap
  buildMinimap(world) {
    const S = 6, N = 120 * S, c = document.createElement('canvas'); c.width = c.height = N; const g = c.getContext('2d');
    g.translate(N / 2, N / 2); g.scale(S, S);
    for (const s of world.solids) {
      if (!s.alive || s.flags.glass || s.flags.barrel) continue;
      const tall = s.y1 > 2.4, low = s.y1 > 0.55 && s.y1 <= 2.4; if (!tall && !low) continue;
      if (s.hx * s.hz < 0.08) continue;
      g.save(); g.translate(s.x, s.z); g.rotate(-s.yaw);
      g.fillStyle = tall ? 'rgba(206,214,200,.30)' : 'rgba(206,214,200,.16)'; g.fillRect(-s.hx, -s.hz, s.hx * 2, s.hz * 2);
      if (tall) { g.strokeStyle = 'rgba(230,236,226,.42)'; g.lineWidth = 0.18; g.strokeRect(-s.hx, -s.hz, s.hx * 2, s.hz * 2); }
      g.restore();
    }
    this.mmBase = c;
  }
  _minimap() {
    const g = this.mm, W = 352, pl = G.player, cam = G.camera; if (!this.mmBase) return;
    const yaw = pl.yaw, sc = 3.8;
    g.clearRect(0, 0, W, W); g.save(); g.beginPath(); g.rect(0, 0, W, W); g.clip();
    g.translate(W / 2, W / 2); g.rotate(yaw); g.scale(sc, sc); g.translate(-pl.pos.x, -pl.pos.z);
    g.drawImage(this.mmBase, -60, -60, 120, 120);
    // armories
    for (const a of G.mapInfo.armories) { g.fillStyle = '#f2a93b'; g.fillRect(a.pos.x - 1, a.pos.z - 1, 2, 2); }
    // support assets
    for (const a of G.support.active) {
      if (a.kind === 'sentry') { g.fillStyle = '#9fd2ff'; g.beginPath(); g.arc(a.mesh.position.x, a.mesh.position.z, 1, 0, 7); g.fill(); }
      if (a.kind === 'heli') { g.strokeStyle = '#9fd2ff'; g.lineWidth = 0.5; g.beginPath(); g.arc(a.mesh.position.x, a.mesh.position.z, 1.8, 0, 7); g.stroke(); }
      if (a.kind === 'airstrike' && a.marker > 0) { g.strokeStyle = '#e5483a'; g.lineWidth = 0.6; g.beginPath(); g.arc(a.target.x, a.target.z, 6, 0, 7); g.stroke(); }
    }
    for (const c of G.throwables.list) if (c.kind === 'claymore') { g.fillStyle = '#8fd16a'; g.fillRect(c.pos.x - 0.6, c.pos.z - 0.6, 1.2, 1.2); }
    // hostiles show when they fire, or always while the recon drone is up
    const radar = G.support.radarT > 0, t = G.t;
    for (const s of G.enemies.list) {
      if (!s.alive) continue; const fired = t - s.firedT < 1.6;
      if (!radar && !fired) continue;
      g.fillStyle = fired ? '#ff4a3a' : 'rgba(255,74,58,.75)'; g.beginPath(); g.arc(s.pos.x, s.pos.z, s.def.armored ? 1.4 : 1.05, 0, 7); g.fill();
    }
    g.restore();
    // field of view wedge and player arrow
    const fov = THREE.MathUtils.degToRad(cam.fov) * cam.aspect * 0.5;
    g.save(); g.translate(W / 2, W / 2);
    const gr = g.createRadialGradient(0, 0, 0, 0, 0, 150); gr.addColorStop(0, 'rgba(255,255,255,.16)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, 150, -Math.PI / 2 - Math.min(fov, 1.2), -Math.PI / 2 + Math.min(fov, 1.2)); g.closePath(); g.fill();
    g.fillStyle = '#ffe48a'; g.beginPath(); g.moveTo(0, -11); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill();
    if (radar) { g.strokeStyle = 'rgba(255,74,58,.35)'; g.lineWidth = 2; const r = ((G.t * 120) % 200); g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); }
    g.restore();
  }

  // ---------------------------------------------------------------- overlays
  _bloodArt() {
    const c = this.e.bloodCv, w = (c.width = Math.round(innerWidth / 2)), h = (c.height = Math.round(innerHeight / 2)), g = c.getContext('2d');
    const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.7);
    gr.addColorStop(0, 'rgba(120,0,0,0)'); gr.addColorStop(0.65, 'rgba(120,8,4,.35)'); gr.addColorStop(1, 'rgba(70,0,0,.85)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      const a = Math.random() * Math.PI * 2, r = 0.42 + Math.random() * 0.35, x = w / 2 + Math.cos(a) * w * r, y = h / 2 + Math.sin(a) * h * r, s = 6 + Math.random() * 28;
      const sg = g.createRadialGradient(x, y, 0, x, y, s); sg.addColorStop(0, 'rgba(110,4,2,.55)'); sg.addColorStop(1, 'rgba(110,4,2,0)'); g.fillStyle = sg; g.fillRect(x - s, y - s, s * 2, s * 2);
    }
    c.style.opacity = 0;
  }
  _scopeArt(kind) {
    const c = this.e.scopeCv, w = (c.width = innerWidth), h = (c.height = innerHeight), g = c.getContext('2d'), cx = w / 2, cy = h / 2;
    const R = Math.min(w, h) * (kind === 'sniper' ? 0.47 : 0.4);
    g.fillStyle = '#030404'; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill(); g.globalCompositeOperation = 'source-over';
    const vg = g.createRadialGradient(cx, cy, R * 0.82, cx, cy, R); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.88)'); g.fillStyle = vg; g.beginPath(); g.arc(cx, cy, R, 0, 7); g.fill();
    if (kind === 'sniper') {
      g.strokeStyle = 'rgba(8,8,8,.95)'; g.lineWidth = Math.max(1, R / 300);
      g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
      g.lineWidth = Math.max(3, R / 60); g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx - R * 0.32, cy); g.moveTo(cx + R * 0.32, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy + R * 0.32); g.lineTo(cx, cy + R); g.stroke();
      g.fillStyle = 'rgba(8,8,8,.95)'; for (let i = 1; i <= 4; i++) for (const s of [-1, 1]) { g.beginPath(); g.arc(cx + s * i * R * 0.07, cy, R / 260 + 1.5, 0, 7); g.fill(); g.beginPath(); g.arc(cx, cy + s * i * R * 0.07, R / 260 + 1.5, 0, 7); g.fill(); }
    } else {
      g.strokeStyle = 'rgba(8,8,8,.9)'; g.lineWidth = Math.max(2, R / 160); g.beginPath(); g.moveTo(cx - R, cy + R * 0.12); g.lineTo(cx - R * 0.2, cy + R * 0.12); g.moveTo(cx + R * 0.2, cy + R * 0.12); g.lineTo(cx + R, cy + R * 0.12); g.moveTo(cx, cy + R * 0.2); g.lineTo(cx, cy + R); g.stroke();
      g.strokeStyle = '#ff5a3a'; g.lineWidth = Math.max(2, R / 120); g.shadowColor = '#ff3a1a'; g.shadowBlur = 8;
      g.beginPath(); g.moveTo(cx - R * 0.06, cy + R * 0.07); g.lineTo(cx, cy); g.lineTo(cx + R * 0.06, cy + R * 0.07); g.stroke(); g.shadowBlur = 0;
    }
    this.scopeKind = kind;
  }

  // ---------------------------------------------------------------- events from the game
  reset() {
    this.e.killfeed.innerHTML = ''; this.e.xpFeed.innerHTML = ''; this.e.subs.innerHTML = ''; this.flashAmt = 0; this.flashHold = 0; this.damageK = 0; this.bannerT = 0;
    for (const d of this.dmg) { d.t = 0; d.el.style.opacity = 0; } this.cache = {}; this.e.flash.style.opacity = 0;
  }
  hitmarker(kill, head) { this.hitT = 1; this.e.hitm.classList.toggle('kill', !!kill); this.hitScale = kill ? 1.35 : head ? 1.2 : 1; }
  damage(from, amount) {
    this.damageK = Math.min(1, this.damageK + amount / 40);
    if (!from) return;
    let d = this.dmg.find((x) => x.t <= 0) || this.dmg.reduce((a, b) => (a.t < b.t ? a : b));
    d.t = 1.6; d.from.set(from.x, from.y, from.z);
  }
  flashbang(amt) { this.flashAmt = Math.max(this.flashAmt, amt); this.flashHold = Math.max(this.flashHold, amt * 2.6); }
  suppress(a) { this.suppressK = Math.min(1, this.suppressK + a); }
  sub(html, dur = 3) { this.e.subs.innerHTML = html; this.subT = dur; }
  cmsg(text, color = '') { this.e.cmsg.textContent = text; this.e.cmsg.style.color = color; this.cmsgT = 1.4; }
  banner(title, sub, dur = 3) { this.e.bannerTitle.textContent = title; this.e.bannerSub.textContent = sub || ''; this.bannerT = dur; this.bannerDur = dur; }
  cash(v) { if (v > 0) { this.cashFlash = 1; } }
  xp(text) {
    const d = document.createElement('div'); d.textContent = text; this.e.xpFeed.prepend(d);
    d.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none', offset: 0.12 }, { opacity: 1, offset: 0.75 }, { opacity: 0, transform: 'translateY(-10px)' }], { duration: 1700, easing: 'ease-out' }).onfinish = () => d.remove();
    while (this.e.xpFeed.children.length > 4) this.e.xpFeed.lastChild.remove();
  }
  killfeed(who, victim, weapon, head) {
    const d = document.createElement('div');
    d.innerHTML = who ? `<b>${who}</b> <span>[${weapon}]</span> <em>${victim}</em>${head ? ' <span>· headshot</span>' : ''}` : `<em>${victim}</em> <span>[own grenade]</span>`;
    this.e.killfeed.appendChild(d);
    d.animate([{ opacity: 0 }, { opacity: 1, offset: 0.05 }, { opacity: 1, offset: 0.85 }, { opacity: 0 }], { duration: 6000 }).onfinish = () => d.remove();
    while (this.e.killfeed.children.length > 5) this.e.killfeed.firstChild.remove();
  }
  streakReady(kind) { const s = SUPPORT[kind]; this.sub(`<em>${s.name}</em> ready · ${G.input.source === 'pad' ? 'D-pad up' : G.input.source === 'touch' ? 'tap Call' : 'press 4'}`, 3); }

  _set(key, el, prop, val) { if (this.cache[key] !== val) { this.cache[key] = val; el[prop] = val; } }

  // ---------------------------------------------------------------- per frame
  update(dt, inGame) {
    const e = this.e, pl = G.player, ar = G.arsenal, game = G.game;
    // fps
    this.fpsAcc += dt; this.fpsN++; if (this.fpsAcc > 0.5) { if (settings.showFps) e.fps.textContent = `${Math.round(this.fpsN / this.fpsAcc)} fps`; this.fpsAcc = 0; this.fpsN = 0; }
    e.fps.hidden = !settings.showFps;
    if (!inGame) return;
    const gr = G.renderer.grade.uniforms;
    // weapon panel
    const w = ar.w, d = w.def, mode = d.pump ? 'PUMP' : d.bolt ? 'BOLT' : d.rocket ? 'ROCKET' : d.auto ? (w.semi ? 'SEMI' : 'AUTO') : 'SEMI';
    this._set('wName', e.wName, 'innerHTML', `${d.name}<small>${mode}</small>`);
    this._set('mag', e.ammoMag, 'textContent', String(w.mag)); this._set('res', e.ammoRes, 'textContent', String(w.reserve));
    const low = w.mag <= Math.ceil(magSize(w) * 0.25); if (this.cache.low !== low) { this.cache.low = low; e.ammoBox.classList.toggle('low', low); }
    const lethal = pl.lethalType === 'claymore' ? `CLAYMORE<b>${pl.claymores}</b>` : `FRAG<b>${pl.frags}</b>`;
    this._set('equip', e.equip, 'innerHTML', `<span>${lethal}</span><span>FLASH<b>${pl.flashes}</b></span>`);
    // cash, score, wave
    this._set('cash', e.cash, 'textContent', `$${fmt(game.cash)}`); this._set('score', e.score, 'textContent', `SCORE ${fmt(G.stats.score)}`);
    if (this.cashFlash > 0) { this.cashFlash -= dt * 2; e.cash.style.transform = `scale(${1 + Math.max(0, this.cashFlash) * 0.12})`; }
    this._set('wave', e.waveNum, 'textContent', game.wave ? `Wave ${game.wave}` : 'Get ready');
    const remain = game.queue.length + G.enemies.alive;
    this._set('waveSub', e.waveSub, 'textContent', game.intermission ? `Next wave in ${Math.ceil(game.timer)}` : `${remain} hostile${remain === 1 ? '' : 's'} remain`);
    // armor
    const showArmor = pl.armor > 0; if (this.cache.arm !== showArmor) { this.cache.arm = showArmor; e.armorWrap.hidden = !showArmor; }
    if (showArmor) this._set('armW', e.armorBar.firstElementChild.style, 'width', `${(pl.armor / 250) * 100}%`);
    // streaks and support inventory
    const inv = G.support.inv, streak = game.streak;
    const icons = ['drone', 'airstrike', 'heli'].map((k) => { const s = SUPPORT[k], ready = inv.includes(k), p = Math.min(1, streak / s.streak); return `<div class="${ready ? 'ready' : ''}">${s.short}${ready ? '' : `<i style="width:${p * 100}%"></i>`}</div>`; }).join('') + (inv.includes('sentry') ? '<div class="ready">SNTY</div>' : '');
    this._set('icons', e.streakIcons, 'innerHTML', icons);
    const nextK = inv[inv.length - 1];
    this._set('hint', e.streakHint, 'textContent', nextK ? `${G.input.source === 'pad' ? 'D-pad up' : G.input.source === 'touch' ? 'Call' : '[4]'} · ${SUPPORT[nextK].name}` : '');
    if (e.tStreak) { const v = !nextK; if (this.cache.tStreak !== v) { this.cache.tStreak = v; e.tStreak.hidden = v; } }
    // interaction prompt
    const pr = this.promptText || null; if (this.cache.prompt !== pr) { this.cache.prompt = pr; e.prompt.hidden = !pr; if (pr) e.prompt.textContent = pr; if (e.tUse) e.tUse.hidden = !pr; }
    // centre messages: ammo warnings
    this.cmsgT -= dt;
    if (this.cmsgT <= 0) {
      let msg = '', col = '';
      if (pl.alive && ar.state !== 'reload' && !ar.state.startsWith('shell')) { if (w.mag === 0 && w.reserve === 0) { msg = 'No ammo'; col = '#e5483a'; } else if (low && w.reserve > 0) { msg = G.input.source === 'pad' ? 'Reload [X]' : G.input.source === 'touch' ? 'Reload' : 'Reload [R]'; col = '#f2a93b'; } else if (w.reserve === 0 && low) { msg = 'Low ammo'; col = '#e5483a'; } }
      if (this.cache.cm !== msg) { this.cache.cm = msg; e.cmsg.textContent = msg; e.cmsg.style.color = col; }
    } else this.cache.cm = null;
    // crosshair
    const hideX = ar.ads > 0.45 || ar.sprint > 0.4 || !pl.alive || ar.state === 'lower' || ar.state === 'raise' && ar.st < 0.15;
    const cam = G.camera, focal = innerHeight / 2 / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);
    const gap = clamp(Math.tan(THREE.MathUtils.degToRad(ar.currentSpread(pl)) * 0.5) * focal, 3, 120);
    if (Math.abs((this.cache.gap || 0) - gap) > 0.4 || this.cache.hideX !== hideX) {
      this.cache.gap = gap; this.cache.hideX = hideX; e.xh.style.opacity = hideX ? 0 : 1;
      this.xh.t.style.top = `${-gap - 9}px`; this.xh.b.style.top = `${gap}px`; this.xh.l.style.left = `${-gap - 9}px`; this.xh.r.style.left = `${gap}px`;
      this.xh.d.style.opacity = d.cls === 'shotgun' ? 0 : 1;
    }
    // hit marker
    if (this.hitT > 0) { this.hitT = Math.max(0, this.hitT - dt * 4); e.hitm.style.opacity = this.hitT; e.hitm.style.transform = `scale(${(this.hitScale || 1) * (1 + (1 - this.hitT) * 0.25)})`; }
    // damage direction indicators
    for (const k of this.dmg) {
      if (k.t <= 0) continue; k.t -= dt;
      const dx = k.from.x - pl.pos.x, dz = k.from.z - pl.pos.z, rel = wrapAngle(Math.atan2(-dx, -dz) - pl.yaw);
      k.el.style.transform = `rotate(${-rel}rad)`; k.el.style.opacity = clamp(k.t / 0.8, 0, 1);
    }
    // grenade indicators
    const warn = G.throwables.warn;
    this.nadeEls.forEach((el, i) => {
      const p = warn[i]; if (!p) { if (el.style.opacity !== '0') el.style.opacity = 0; return; }
      const dx = p.x - pl.pos.x, dz = p.z - pl.pos.z, rel = wrapAngle(Math.atan2(-dx, -dz) - pl.yaw);
      el.style.opacity = 0.6 + 0.4 * Math.abs(Math.sin(G.t * 9)); el.style.transform = `rotate(${-rel}rad)`;
    });
    // screen effects
    this.damageK = Math.max(0, this.damageK - dt * 1.3); gr.uDamage.value = this.damageK;
    this.suppressK = Math.max(0, this.suppressK - dt * 0.9); gr.uSuppress.value = this.suppressK;
    gr.uAberr.value = Math.max(0, gr.uAberr.value - dt * 0.8);
    const hurt = pl.alive ? clamp((1 - pl.health / 100) * 1.25, 0, 0.92) : 0.92;
    if (Math.abs((this.cache.blood || 0) - hurt) > 0.01) { this.cache.blood = hurt; e.bloodCv.style.opacity = hurt; }
    if (this.flashHold > 0) this.flashHold -= dt; else this.flashAmt = Math.max(0, this.flashAmt - dt * 0.55);
    const fl = clamp(this.flashAmt * (this.flashHold > 0 ? 1 : 1), 0, 1);
    if (Math.abs((this.cache.fl || 0) - fl) > 0.005) { this.cache.fl = fl; e.flash.style.opacity = fl; }
    // scope overlay
    const scoped = ar.scoped, kind = w.att.optic === 'sniper' ? 'sniper' : 'acog';
    if (scoped && this.scopeKind !== kind) this._scopeArt(kind);
    const so = scoped ? 1 : 0; if (this.cache.scope !== so) { this.cache.scope = so; e.scope.style.opacity = so; }
    // banner and subtitles
    if (this.bannerT > 0) { this.bannerT -= dt; const t = this.bannerDur - this.bannerT; e.banner.style.opacity = clamp(Math.min(t / 0.3, this.bannerT / 0.6), 0, 1); e.banner.style.transform = `translateY(${(1 - clamp(t / 0.4, 0, 1)) * 10}px)`; }
    else if (e.banner.style.opacity !== '0') e.banner.style.opacity = 0;
    if (this.subT > 0) { this.subT -= dt; if (this.subT <= 0) e.subs.innerHTML = ''; }
    this._minimap();
  }

  // ---------------------------------------------------------------- menus
  bindSettings(onQuality) {
    const S = settings, sync = () => {
      for (const b of $('presetSeg').children) b.classList.toggle('on', b.dataset.preset === S.preset);
      const r = (id, v, out, txt) => { $(id).value = v; if (out) $(out).textContent = txt; };
      r('sScale', Math.round(S.renderScale * 100), 'vScale', `${Math.round(S.renderScale * 100)}%`); r('sFov', S.fov, 'vFov', `${S.fov}°`);
      r('sSens', Math.round(S.sens * 100), 'vSens', S.sens.toFixed(2)); r('sAds', Math.round(S.adsSens * 100), 'vAds', S.adsSens.toFixed(2)); r('sPad', Math.round(S.padSens * 100), 'vPad', S.padSens.toFixed(2));
      r('sMaster', Math.round(S.master * 100), 'vMaster', `${Math.round(S.master * 100)}`); r('sSfx', Math.round(S.sfx * 100), 'vSfx', `${Math.round(S.sfx * 100)}`); r('sMusic', Math.round(S.music * 100), 'vMusic', `${Math.round(S.music * 100)}`);
      for (const [id, k] of [['sShadows', 'shadows'], ['sAO', 'ao'], ['sBloom', 'bloom'], ['sAA', 'aa'], ['sAuto', 'autoQuality'], ['sInvert', 'invertY'], ['sAssist', 'aimAssist'], ['sFps', 'showFps']]) $(id).checked = !!S[k];
    };
    this.syncSettings = sync;
    for (const b of $('presetSeg').children) b.addEventListener('click', () => { applyPreset(b.dataset.preset); sync(); onQuality(); if (G.audio) G.audio.uiSound('select'); });
    const slider = (id, fn) => $(id).addEventListener('input', (ev) => { fn(+ev.target.value); saveSettings(); sync(); });
    slider('sScale', (v) => { S.renderScale = v / 100; S.preset = 'custom'; onQuality(); });
    slider('sFov', (v) => { S.fov = v; });
    slider('sSens', (v) => { S.sens = v / 100; }); slider('sAds', (v) => { S.adsSens = v / 100; }); slider('sPad', (v) => { S.padSens = v / 100; });
    slider('sMaster', (v) => { S.master = v / 100; G.audio.setVolumes(); }); slider('sSfx', (v) => { S.sfx = v / 100; G.audio.setVolumes(); }); slider('sMusic', (v) => { S.music = v / 100; G.audio.setVolumes(); });
    const check = (id, k, q) => $(id).addEventListener('change', (ev) => { S[k] = ev.target.checked; if (q) { S.preset = 'custom'; onQuality(); } saveSettings(); sync(); });
    check('sAuto', 'autoQuality', true); check('sShadows', 'shadows', true); check('sAO', 'ao', true); check('sBloom', 'bloom', true); check('sAA', 'aa', true); check('sInvert', 'invertY'); check('sAssist', 'aimAssist'); check('sFps', 'showFps');
    sync();
  }
  rankSVG(el, i) {
    const enlisted = i < 11, n = enlisted ? Math.min(3, 1 + Math.floor(i / 2) % 3 + (i >= 6 ? 0 : 0)) : 1 + ((i - 11) % 4);
    let s = '';
    if (enlisted) { for (let k = 0; k < n; k++) s += `<path d="M10 ${18 + k * 9} L27 ${8 + k * 9} L44 ${18 + k * 9}" fill="none" stroke="#f2a93b" stroke-width="5" stroke-linejoin="round"/>`; if (i >= 6) s += `<path d="M10 40 Q27 50 44 40" fill="none" stroke="#f2a93b" stroke-width="4"/>`; }
    else if (i < 14) { for (let k = 0; k < n; k++) s += `<rect x="${12 + k * 12}" y="12" width="7" height="30" fill="#f2a93b"/>`; }
    else { for (let k = 0; k < n; k++) { const cx = 27 + (k - (n - 1) / 2) * 13; s += `<path d="M${cx} 17 l3 7 h7 l-6 4 2 7 -6 -4 -6 4 2 -7 -6 -4 h7 z" fill="#f2a93b"/>`; } }
    el.innerHTML = `<rect x="1" y="1" width="52" height="52" fill="rgba(242,169,59,.08)" stroke="rgba(242,169,59,.45)"/>` + s;
  }
  showRank(prefix, xp) {
    const r = rankFor(xp);
    this.rankSVG($(prefix === 'o' ? 'oRankIcon' : 'rankIcon'), r.i);
    $(prefix === 'o' ? 'oRankName' : 'rankName').textContent = r.name;
    $(prefix === 'o' ? 'oXpFill' : 'xpFill').style.width = `${r.frac * 100}%`;
    $(prefix === 'o' ? 'oXp' : 'xpText').textContent = r.max ? `${fmt(xp)} XP · max rank` : `${fmt(xp)} / ${fmt(r.next)} XP`;
    return r;
  }
}
