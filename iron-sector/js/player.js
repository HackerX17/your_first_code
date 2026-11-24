// Player: first-person movement (stand / crouch / prone, sprint, jump, vault), health and armor, camera feel and controller aim assist.
import * as THREE from 'three';
import { G, settings, clamp, lerp, damp, Spring, rand } from './core.js';

const V3 = THREE.Vector3;
const EYE = { stand: 1.62, crouch: 1.08, prone: 0.42 }, HEIGHT = { stand: 1.8, crouch: 1.25, prone: 0.62 }, SPEED = { stand: 4.6, crouch: 2.5, prone: 0.95 };
const R = 0.32, GRAV = 17, JUMP = 5.3, SPRINT = 6.8;

export class Player {
  constructor() {
    this.pos = new V3(); this.vel = new V3(); this.fwd = new V3(); this.right = new V3(); this.chest = new V3();
    this.punchP = new Spring(170, 15); this.punchY = new Spring(170, 15); this.dip = new Spring(95, 11);
    this._p = new V3(); this._d = new V3();
    this.reset(new V3(), 0);
  }
  reset(p, yaw) {
    this.pos.copy(p); this.vel.set(0, 0, 0); this.yaw = yaw; this.pitch = 0; this.kickP = 0; this.kickY = 0;
    this.stance = 'stand'; this.eye = EYE.stand; this.camY = p.y; this.onGround = true; this.sprinting = false; this.stamina = 1;
    this.health = 100; this.armor = 0; this.lastDamageT = -99; this.alive = true; this.deathT = 0;
    this.frags = 2; this.flashes = 2; this.claymores = 0; this.lethalType = 'frag';
    this.moveFrac = 0; this.speed2d = 0; this.stepAcc = 0; this.mantle = null; this.shake = 0; this.breath = 1; this.breathHeld = false;
    this.lastShotT = -9; this.coyote = 0; this.adsPrev = false; this.snap = null; this.assistScale = 1; this.bobPhase = 0; this.roll = 0;
    this.stationaryT = 0; this.lastPos = p.clone();
  }
  get height() { return HEIGHT[this.stance]; }
  get eyePos() { return G.camera.position; }
  aimScale() { return this.assistScale; }

  setStance(s) {
    if (s === this.stance) return true;
    if (HEIGHT[s] > HEIGHT[this.stance]) { const c = G.world.ceilingAt(this.pos.x, this.pos.z, this.pos.y + 0.1, R * 0.9); if (this.pos.y + HEIGHT[s] > c - 0.02) return false; }
    this.stance = s; if (G.audio) G.audio.foley('land'); return true;
  }
  addRecoil(up, side) { this.pitch += up * 0.55; this.yaw -= side * 0.55; this.kickP += up * 0.45; this.kickY -= side * 0.45; this.lastShotT = G.t; }
  addShake(a) { this.shake = Math.min(1.2, this.shake + a); }

  canThrow(kind) {
    if (!this.alive) return false;
    if (kind === 'tactical') return this.flashes > 0;
    return this.lethalType === 'claymore' ? this.claymores > 0 : this.frags > 0;
  }
  useThrowable(kind, cook, dropped) {
    const cam = G.camera, dir = new V3(0, 0, -1).applyQuaternion(cam.quaternion), up = new V3(0, 1, 0);
    const from = cam.position.clone().addScaledVector(dir, 0.4).addScaledVector(this.right, -0.15).add(new V3(0, -0.1, 0));
    if (kind === 'tactical') { this.flashes--; G.throwables.throwNade('flash', from, dir.clone().add(up.clone().multiplyScalar(0.22)).normalize().multiplyScalar(dropped ? 2 : 16).add(this.vel), 0, 'player'); return; }
    if (this.lethalType === 'claymore') {
      this.claymores--; if (this.claymores <= 0 && this.frags > 0) this.lethalType = 'frag';
      const f = new V3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), p = this.pos.clone().addScaledVector(f, 0.9);
      p.y = G.world.groundAt(p.x, p.z, this.pos.y + 0.4, 0.1, 0.6); G.throwables.claymore(p, this.yaw); return;
    }
    this.frags--; if (this.frags <= 0 && this.claymores > 0) this.lethalType = 'claymore';
    G.throwables.throwNade('frag', from, dir.clone().add(up.multiplyScalar(0.2)).normalize().multiplyScalar(dropped ? 1.5 : 17).add(this.vel), cook, 'player');
  }

  damage(amount, from, kind = 'bullet') {
    if (!this.alive || G.god) return;
    if (this.armor > 0 && kind !== 'fall') { const absorb = Math.min(this.armor, amount * 0.6); this.armor -= absorb; amount -= absorb; if (this.armor <= 0 && G.audio) G.audio.uiSound('armor'); }
    this.health -= amount; this.lastDamageT = G.t;
    this.punchP.kick(rand(1.2, 2.2) * Math.min(1, amount / 25)); this.punchY.kick(rand(-1.5, 1.5) * Math.min(1, amount / 25));
    if (G.ui) G.ui.damage(from, amount);
    if (this.health <= 0) this.die();
  }
  die() {
    if (!this.alive) return;
    this.alive = false; this.health = 0; this.deathT = 0; this.vel.set(0, 0, 0);
    if (G.audio) { G.audio.sting('death'); G.audio.lowHealth = 0; }
    if (G.game) G.game.onPlayerDeath();
  }

  update(dt, A) {
    const W = G.world, ar = G.arsenal, ads = ar ? ar.ads : 0;
    if (!this.alive) { this.deathT += dt; this._camera(dt, A, ads); return; }
    // ---------------- look ----------------
    this.yaw -= A.lookX; this.pitch = clamp(this.pitch - A.lookY, -1.52, 1.52);
    if (G.t - this.lastShotT > 0.09) { this.kickP = damp(this.kickP, 0, 7, dt); this.kickY = damp(this.kickY, 0, 7, dt); }
    // ---------------- stance ----------------
    if (A.crouch) this.setStance(this.stance === 'crouch' ? 'stand' : 'crouch');
    if (A.prone) this.setStance(this.stance === 'prone' ? 'stand' : 'prone');
    // ---------------- sprint and stamina ----------------
    const fwdIn = A.moveY > 0.45 && Math.abs(A.moveX) < 0.8;
    let sprint = A.sprint && fwdIn && ads < 0.3 && this.stamina > 0.02 && !this.mantle;
    if (sprint && this.stance !== 'stand') { if (!this.setStance('stand')) sprint = false; }
    this.sprinting = sprint && this.onGround || (this.sprinting && !this.onGround && sprint);
    this.stamina = clamp(this.stamina + (this.sprinting ? -dt / (this.perkMarathon ? 13 : 6.5) : dt / 4), 0, 1);
    // ---------------- movement ----------------
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    this.fwd.set(-sy, 0, -cy); this.right.set(cy, 0, -sy);
    const wx = this.right.x * A.moveX + this.fwd.x * A.moveY, wz = this.right.z * A.moveX + this.fwd.z * A.moveY;
    const mul = (ar ? ar.w.def.move : 1) * lerp(1, 0.6, ads);
    const top = (this.sprinting ? SPRINT : SPEED[this.stance]) * mul;
    if (this.mantle) this._mantle(dt);
    else {
      if (this.onGround) { const k = 1 - Math.exp(-14 * dt); this.vel.x += (wx * top - this.vel.x) * k; this.vel.z += (wz * top - this.vel.z) * k; }
      else { const k = 1 - Math.exp(-2.2 * dt); this.vel.x += (wx * top - this.vel.x) * k * 0.6; this.vel.z += (wz * top - this.vel.z) * k * 0.6; }
      // jump / vault
      this.coyote = this.onGround ? 0.12 : this.coyote - dt;
      if (A.jump) {
        if (this.stance !== 'stand') this.setStance('stand');
        else if (!this._tryMantle() && this.coyote > 0) { this.vel.y = JUMP; this.onGround = false; this.coyote = 0; if (G.audio) G.audio.step(W.groundSolid ? W.groundSolid.surf : 'concrete', null, 1.3); }
      }
      this.vel.y -= GRAV * dt;
      this.pos.addScaledVector(this.vel, dt);
      W.resolve(this.pos, R, this.height, 0.45);
      const c = W.ceilingAt(this.pos.x, this.pos.z, this.pos.y + 0.3, R * 0.9);
      if (this.pos.y + this.height > c) { this.pos.y = Math.max(this.pos.y - 0.02, c - this.height); if (this.vel.y > 0) this.vel.y = 0; }
      const g = W.groundAt(this.pos.x, this.pos.z, this.pos.y, R, 0.45);
      if (this.pos.y <= g + 0.002) {
        if (!this.onGround && this.vel.y < -5.5) { this.dip.kick(clamp(-this.vel.y * 0.7, 0, 9)); if (G.audio) G.audio.foley('land'); if (this.vel.y < -14) this.damage((-this.vel.y - 14) * 9, null, 'fall'); }
        this.pos.y = g; this.vel.y = 0; this.onGround = true;
      } else if (this.onGround && this.vel.y <= 0 && this.pos.y - g < 0.5) { this.pos.y = g; this.vel.y = 0; }
      else this.onGround = false;
      if (this.pos.y < -2) { this.pos.y = 0.1; this.vel.y = 0; }
    }
    this.speed2d = Math.hypot(this.vel.x, this.vel.z); this.moveFrac = clamp(this.speed2d / 4.6, 0, 1.5);
    // footsteps
    if (this.onGround && this.speed2d > 0.6) {
      this.stepAcc += this.speed2d * dt;
      const stride = this.sprinting ? 2.3 : this.stance === 'crouch' ? 1.5 : 1.85;
      if (this.stepAcc > stride) { this.stepAcc = 0; if (G.audio) G.audio.step(W.groundSolid ? W.groundSolid.surf : 'concrete', null, this.stance === 'stand' ? (this.sprinting ? 1 : 0.7) : 0.35); }
    }
    // camping detector (enemy grenades flush campers)
    if (this.pos.distanceTo(this.lastPos) > 3) { this.lastPos.copy(this.pos); this.stationaryT = 0; } else this.stationaryT += dt;
    // ---------------- health ----------------
    if (G.t - this.lastDamageT > 4.2 && this.health < 100) this.health = Math.min(100, this.health + 34 * dt);
    const low = clamp(1 - this.health / 45, 0, 1);
    if (G.audio) G.audio.lowHealth = low;
    G.renderer.grade.uniforms.uLowHP.value = damp(G.renderer.grade.uniforms.uLowHP.value, low, 4, dt);
    // ---------------- breath (sniper scopes) ----------------
    const scoped = ar && ar.scoped;
    if (scoped && A.holdBreath && this.breath > 0) { this.breathHeld = true; this.breath = Math.max(0, this.breath - dt / 4.5); }
    else { if (this.breathHeld && G.audio && scoped) G.audio.foley('land'); this.breathHeld = false; this.breath = Math.min(1, this.breath + dt / (scoped ? 6 : 2.5)); }
    this._assist(dt, A, ads);
    this._camera(dt, A, ads);
  }

  _tryMantle() {
    const W = G.world, f = this.fwd, p = this.pos;
    if (!this.onGround && this.vel.y < -4) return false;
    for (const reach of [0.55, 0.8]) {
      const x = p.x + f.x * reach, z = p.z + f.z * reach;
      const top = W.groundAt(x, z, p.y + 1.35, 0.22, 0);
      const h = top - p.y;
      if (h < 0.5 || h > 1.35) continue;
      const ceil = W.ceilingAt(x, z, top + 0.05, 0.3);
      if (ceil - top < 1.05) continue;
      // make sure the landing spot isn't inside a wall
      const q = this._p.set(x + f.x * 0.25, top + 0.02, z + f.z * 0.25), before = q.clone(); W.resolve(q, 0.3, 1.0, 0.1);
      if (q.distanceTo(before) > 0.25) continue;
      this.mantle = { t: 0, dur: 0.42 + h * 0.12, from: p.clone(), to: new V3(q.x, top, q.z), h };
      this.vel.set(0, 0, 0); if (G.audio) G.audio.foley('land');
      this.dip.kick(-3);
      return true;
    }
    return false;
  }
  _mantle(dt) {
    const m = this.mantle; m.t += dt; const k = clamp(m.t / m.dur, 0, 1);
    const up = Math.min(1, k / 0.6), fw = Math.max(0, (k - 0.35) / 0.65);
    this.pos.set(lerp(m.from.x, m.to.x, fw * fw * (3 - 2 * fw)), lerp(m.from.y, m.to.y + 0.05, Math.sin(up * Math.PI / 2)), lerp(m.from.z, m.to.z, fw * fw * (3 - 2 * fw)));
    if (k >= 1) { this.pos.copy(m.to); this.mantle = null; this.onGround = true; this.vel.copy(this.fwd).multiplyScalar(2.5); }
  }

  // controller / touch aim assist: slowdown over targets, a small snap when aiming down sights
  _assist(dt, A, ads) {
    this.assistScale = 1;
    const adsOn = ads > 0.05;
    if (!settings.aimAssist || !G.input || G.input.source === 'kbm' || !G.enemies) { this.adsPrev = adsOn; return; }
    const cam = G.camera, fwd = this._d.set(0, 0, -1).applyQuaternion(cam.quaternion);
    let best = null, bestA = 1, bestP = null;
    for (const s of G.enemies.list) {
      if (!s.alive) continue;
      const c = s.chest, dx = c.x - cam.position.x, dy = c.y - cam.position.y, dz = c.z - cam.position.z, d = Math.hypot(dx, dy, dz);
      if (d > 80) continue;
      const ang = Math.acos(clamp((dx * fwd.x + dy * fwd.y + dz * fwd.z) / d, -1, 1)), thr = clamp(1.3 / d, 0.035, 0.14) * (adsOn ? 1.6 : 1);
      if (ang < thr && ang < bestA && G.world.clear(cam.position, c)) { best = s; bestA = ang; bestP = c; }
    }
    if (best) this.assistScale = adsOn ? 0.5 : 0.65;
    if (adsOn && !this.adsPrev && best && bestA < 0.16) this.snap = { s: best, t: 0.14 };
    this.adsPrev = adsOn;
    if (this.snap) {
      const s = this.snap.s; this.snap.t -= dt;
      if (!s.alive || this.snap.t <= 0) this.snap = null;
      else {
        const c = s.chest, dx = c.x - cam.position.x, dy = c.y - cam.position.y, dz = c.z - cam.position.z;
        const yaw = Math.atan2(-dx, -dz), pitch = Math.atan2(dy, Math.hypot(dx, dz)) - this.kickP;
        const k = 1 - Math.exp(-28 * dt); let dyaw = Math.atan2(Math.sin(yaw - this.yaw), Math.cos(yaw - this.yaw));
        this.yaw += dyaw * k; this.pitch += (pitch - this.pitch) * k;
      }
    }
  }

  _camera(dt, A, ads) {
    const cam = G.camera, ar = G.arsenal;
    this.punchP.update(dt); this.punchY.update(dt); this.dip.update(dt);
    this.eye = damp(this.eye, EYE[this.stance], 11, dt);
    this.camY = Math.abs(this.camY - this.pos.y) > 0.7 ? this.pos.y : damp(this.camY, this.pos.y, 20, dt);
    const mv = this.onGround ? clamp(this.speed2d / 5, 0, 1.4) : 0, adsK = 1 - ads * 0.85;
    this.bobPhase += dt * this.speed2d * (this.sprinting ? 1.45 : 1.75);
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.045 * mv * adsK, bobX = Math.cos(this.bobPhase) * 0.025 * mv * adsK;
    this.roll = damp(this.roll, -A.moveX * 0.012 * (this.onGround ? 1 : 0.3) - (this.sprinting ? Math.sin(this.bobPhase) * 0.008 : 0), 6, dt);
    let x = this.pos.x + this.right.x * bobX, y = this.camY + this.eye + bobY - this.dip.x * 0.012, z = this.pos.z + this.right.z * bobX;
    let rp = this.pitch + this.kickP + this.punchP.x * 0.012, ry = this.yaw + this.kickY + this.punchY.x * 0.012, rr = this.roll;
    // scope sway, steadied by holding breath
    if (ar && ar.scoped) { const amp = this.breathHeld ? 0.0004 : 0.0035 * (this.stance === 'prone' ? 0.4 : this.stance === 'crouch' ? 0.7 : 1); rp += Math.sin(G.t * 1.1) * amp + Math.sin(G.t * 2.3) * amp * 0.4; ry += Math.cos(G.t * 0.8) * amp * 1.2; }
    // explosion shake
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 1.6); const s = this.shake * this.shake * 0.03; rp += rand(-s, s); ry += rand(-s, s); rr += rand(-s, s); }
    if (!this.alive) { const k = clamp(this.deathT / 1.1, 0, 1); y = lerp(y, this.pos.y + 0.28, k * k); rr += k * 0.55; rp = lerp(rp, -0.2, k); }
    cam.position.set(x, y, z); cam.rotation.set(rp, ry, rr, 'YXZ');
    // field of view: zoom while aiming, widen a touch while sprinting
    const zoom = ar ? ar.zoom() : 1, adsE = ads * ads * (3 - 2 * ads), sprintK = ar ? ar.sprint : 0;
    const fov = settings.fov / lerp(1, zoom, adsE) + sprintK * 5;
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();
    this.chest.set(this.pos.x, this.pos.y + this.eye - 0.32, this.pos.z);
  }
}
