// Game systems: bullets (with wall penetration), explosions, grenades / rockets / claymores, explosive barrels and breakable glass,
// weapon drops, air support (recon drone, airstrike, attack helicopter, sentry gun), the armory catalog and the survival wave director.
import * as THREE from 'three';
import { G, settings, clamp, lerp, damp, rand, randInt, pick, store } from './core.js';
import { MAT } from './textures.js';
import { WEAPONS, OPTICS, ATTACH, makeWeapon, magSize, worldGun, cone } from './weapons.js';
import { TYPES, DIFF, segDist } from './soldiers.js';

const V3 = THREE.Vector3, UP = new V3(0, 1, 0);
// penetration cost per metre of material (bullets carry a budget: AR 1, LMG 1.4, DMR 1.6, sniper 2.2)
const PEN = { wood: 1.4, clothA: 0.3, clothB: 0.3, clothC: 0.3, foliage: 0.3, plaster: 3.6, plasterW: 3.6, plasterR: 3.6, roof: 3, tiles: 3.2, rubber: 2, frame: 2.2,
  metalGreen: 5, metalWhite: 5, metalBlue: 5, metalRed: 5, metalGrey: 5, contRed: 4, contBlue: 4, contGreen: 4, contOrange: 4, burnt: 5, glass: 0, darkGlass: 0.6 };
const PART = { head: 2.6, torso: 1, arm: 0.8, leg: 0.8 };
const FORCE = { sniper: 10, dmr: 6, lmg: 5, ar: 4, smg: 3.5, pistol: 3, shotgun: 2.2 };
const P3 = (v) => ({ x: v.x, y: v.y, z: v.z });

// ====================================================================== combat
export class Combat {
  constructor() { this._o = new V3(); this.shotHit = false; }
  falloff(def, d) { const [a, b] = def.range, [n, f] = def.dmg; return d <= a ? n : d >= b ? f : lerp(n, f, (d - a) / (b - a)); }
  playerShot(origin, dir, w, first) {
    const def = w.def, W = G.world, o = this._o.copy(origin), pl = G.player;
    if (first) this.shotHit = false;
    let budget = def.pen || 0.4, mul = pl.perkPower ? 1.25 : 1, travel = 0, end = null;
    for (let k = 0; k < 5; k++) {
      const max = 400 - travel, h = W.raycast(o, dir, max);
      const hit = h ? { t: h.t, x: h.x, y: h.y, z: h.z, n: { x: h.nx, y: h.ny, z: h.nz }, solid: h.solid, exit: h.exit } : null;
      const eh = G.enemies.rayHit(o, dir, hit ? hit.t : max);
      if (eh) {
        const p = o.clone().addScaledVector(dir, eh.t), dist = travel + eh.t;
        const dmg = this.falloff(def, dist) * mul * (PART[eh.part] || 1);
        const killed = G.enemies.hurt(eh.s, dmg, dir, eh.part, 'bullet', FORCE[def.cls] || 4);
        G.fx.impact('flesh', p, { x: -dir.x, y: -dir.y, z: -dir.z });
        const bh = W.raycast(p, dir, 2.2); if (bh && bh.solid.surf !== 'glass') G.fx.decal('blood', { x: bh.x, y: bh.y, z: bh.z }, { x: bh.nx, y: bh.ny, z: bh.nz }, rand(0.3, 0.55));
        if (!this.shotHit) { this.shotHit = true; G.stats.hits++; }
        G.ui.hitmarker(killed, eh.part === 'head');
        G.audio.uiSound(killed ? 'kill' : eh.part === 'head' ? 'head' : 'hit');
        if (killed && def.cls === 'sniper' && budget > 1) { budget -= 1; travel += eh.t + 0.3; o.copy(p).addScaledVector(dir, 0.3); continue; }
        end = p; break;
      }
      if (!hit) { end = o.clone().addScaledVector(dir, max); break; }
      const p = new V3(hit.x, hit.y, hit.z), s = hit.solid, surf = s.surf;
      if (s.flags && s.flags.barrel) s.flags.barrel.damage(this.falloff(def, travel + hit.t) * mul);
      if (s.flags && s.flags.pane) { G.props.breakGlass(s.flags.pane); travel += hit.t + 0.08; o.copy(p).addScaledVector(dir, 0.08); continue; }
      G.fx.impact(surf, p, hit.n, 1); G.audio.impact(surf, p);
      if (surf !== 'glass') G.fx.decal(surf === 'metal' ? 'holeMetal' : 'hole', p, hit.n, surf === 'metal' ? 0.06 : rand(0.07, 0.1));
      const cost = s.ground ? 99 : (hit.exit - hit.t) * (PEN[s.mat] ?? 99);
      if (cost < budget) {
        budget -= cost; mul *= clamp(1 - 0.55 * cost / (def.pen || 1), 0.3, 1);
        const ex = o.clone().addScaledVector(dir, hit.exit);
        G.fx.impact(surf, ex, P3(dir), 0.6);
        travel += hit.exit + 0.02; o.copy(ex).addScaledVector(dir, 0.02); continue;
      }
      end = p; break;
    }
    G.enemies.nearMiss(origin, dir, end.distanceTo(origin));
    return end;
  }
  melee() {
    const cam = G.camera, f = new V3(0, 0, -1).applyQuaternion(cam.quaternion), pl = G.player;
    let best = null, bd = 2.7;
    for (const s of G.enemies.list) {
      if (!s.alive) continue; const d = s.chest.distanceTo(cam.position); if (d > bd) continue;
      const dir = s.chest.clone().sub(cam.position).normalize(); if (dir.dot(f) < 0.5 || !G.world.clear(cam.position, s.chest)) continue;
      best = s; bd = d;
    }
    if (best) {
      const dir = best.chest.clone().sub(cam.position).setY(0).normalize(); pl.vel.addScaledVector(dir, 5);
      G.enemies.hurt(best, 1000, f, 'torso', 'melee', 5);
      G.fx.impact('flesh', best.chest, P3(f.clone().negate())); G.audio.impact('flesh', best.chest);
      G.ui.hitmarker(true, false); G.audio.uiSound('kill');
      return;
    }
    const h = G.world.raycast(cam.position, f, 1.7);
    if (h) { const p = { x: h.x, y: h.y, z: h.z }, n = { x: h.nx, y: h.ny, z: h.nz }, sol = h.solid; G.fx.impact(sol.surf, p, n, 0.5); G.audio.impact(sol.surf, p); if (sol.flags.pane) G.props.breakGlass(sol.flags.pane); if (sol.flags.barrel) sol.flags.barrel.damage(15); }
  }
  explode(p, R = 6, dmg = 220, owner = 'player', kind = 'explosion') {
    const pos = new V3(p.x, p.y, p.z), W = G.world, pl = G.player;
    G.fx.explosion(pos, clamp(R / 6, 0.6, 1.6)); G.fx.light(pos.clone().setY(pos.y + 1), 0xffa040, 40, 0.45, R * 4);
    G.audio.explosion(pos, clamp(R / 6, 0.7, 1.6));
    const gy = W.groundAt(pos.x, pos.z, pos.y + 0.3, 0.2, 1);
    if (pos.y - gy < 1.2) G.fx.decal('scorch', { x: pos.x, y: gy + 0.015, z: pos.z }, { x: 0, y: 1, z: 0 }, R * 0.6);
    const eye = pos.clone(); eye.y += 0.4;
    for (const s of G.enemies.list.slice()) {
      if (!s.alive) { if (s.rag && s.rag.P[0].distanceTo(pos) < R) G.enemies.push(s, pos, 35); continue; }
      const d = s.chest.distanceTo(pos); if (d > R) continue;
      if (!W.clear(eye, s.chest) && !W.clear(eye, s.J[2])) continue;
      const k = 1 - d / R, dir = s.chest.clone().sub(pos).normalize().addScaledVector(UP, 0.7).normalize();
      const killed = G.enemies.hurt(s, dmg * (0.25 + 0.75 * k), dir, 'torso', owner === 'enemy' ? 'enemyNade' : kind, 8 + 16 * k);
      if (owner === 'player') G.ui.hitmarker(killed, false);
    }
    if (pl.alive) {
      const pd = pl.chest.distanceTo(pos);
      pl.addShake(clamp(1.3 - pd / 35, 0, 1.1));
      if (pd < R && (W.clear(eye, pl.chest) || W.clear(eye, G.camera.position))) {
        const k = 1 - pd / R; pl.damage(dmg * (owner === 'player' ? 0.5 : 0.75) * (0.15 + 0.85 * k) * (pl.stance === 'prone' ? 0.6 : 1), pos, 'explosion');
      }
      if (pd < R * 1.7) { G.audio.tinnitus(clamp(3 - pd / R, 0.6, 2.6)); G.renderer.grade.uniforms.uAberr.value = 1; }
    }
    G.props.blast(pos, R); G.pickups.blast(pos, R);
  }
  flashbang(p) {
    const pos = new V3(p.x, p.y, p.z), cam = G.camera;
    G.fx.light(pos, 0xffffff, 80, 0.3, 30); G.fx.flash(pos, 4); G.audio.explosion(pos, 0.45);
    const d = cam.position.distanceTo(pos);
    if (G.player.alive && d < 22 && G.world.clear(pos, cam.position)) {
      const f = new V3(0, 0, -1).applyQuaternion(cam.quaternion), dir = pos.clone().sub(cam.position).divideScalar(Math.max(d, 0.01));
      const facing = clamp((f.dot(dir) + 0.35) / 1.35, 0.25, 1), amt = clamp(1.25 - d / 17, 0, 1) * facing;
      if (amt > 0.05) { G.ui.flashbang(amt); G.audio.tinnitus(1 + amt * 3); }
    }
    for (const s of G.enemies.list) { if (!s.alive) continue; const dd = s.J[2].distanceTo(pos); if (dd < 16 && G.world.clear(pos, s.J[2])) G.enemies.flash(s, clamp(1.3 - dd / 13, 0.35, 1)); }
  }
}

// ====================================================================== grenades, rockets, claymores, bombs
export class Throwables {
  constructor(scene) {
    this.scene = scene; this.list = [];
    const ring = new THREE.TorusGeometry(0.03, 0.006, 6, 12).rotateX(Math.PI / 2).translate(0, 0.05, 0);
    this.geo = { frag: mergeSimple([new THREE.SphereGeometry(0.042, 12, 9).scale(1, 1.15, 1), new THREE.CylinderGeometry(0.014, 0.014, 0.03, 8).translate(0, 0.055, 0), ring]),
      flash: new THREE.CylinderGeometry(0.028, 0.028, 0.12, 12), rocket: new THREE.ConeGeometry(0.045, 0.45, 10).rotateX(Math.PI / 2),
      bomb: mergeSimple([new THREE.CapsuleGeometry(0.16, 0.9, 4, 10).rotateX(Math.PI / 2), new THREE.BoxGeometry(0.5, 0.02, 0.2).translate(0, 0, -0.5), new THREE.BoxGeometry(0.02, 0.5, 0.2).translate(0, 0, -0.5)]),
      claymore: mergeSimple([new THREE.BoxGeometry(0.22, 0.13, 0.05).translate(0, 0.1, 0), new THREE.CylinderGeometry(0.006, 0.006, 0.08, 4).translate(-0.08, 0.02, 0), new THREE.CylinderGeometry(0.006, 0.006, 0.08, 4).translate(0.08, 0.02, 0)]) };
    this.mat = { frag: MAT.metalGreen, flash: MAT.metalGrey, rocket: MAT.metalGrey, bomb: MAT.metalGrey, claymore: MAT.metalGreen };
    this.warn = [];
  }
  _mesh(kind) { const m = new THREE.Mesh(this.geo[kind], this.mat[kind]); m.castShadow = kind !== 'claymore'; this.scene.add(m); return m; }
  clear() { for (const n of this.list) this.scene.remove(n.mesh); this.list.length = 0; }
  throwNade(kind, from, vel, cook, owner) {
    this.list.push({ kind, pos: from.clone(), vel: vel.clone(), fuse: kind === 'frag' ? Math.max(0.05, 3.4 - cook) : 1.5, owner, mesh: this._mesh(kind), rest: false, spin: new V3(rand(-12, 12), rand(-12, 12), rand(-12, 12)), bounces: 0 });
  }
  rocket(from, dir) {
    this.list.push({ kind: 'rocket', pos: from.clone(), vel: dir.clone().multiplyScalar(55), fuse: 4, owner: 'player', mesh: this._mesh('rocket'), trailT: 0 });
  }
  claymore(p, yaw) {
    const m = this._mesh('claymore'); m.position.copy(p); m.rotation.y = yaw;
    this.list.push({ kind: 'claymore', pos: p.clone(), fwd: new V3(-Math.sin(yaw), 0, -Math.cos(yaw)), mesh: m, armT: 1.2, trig: -1, owner: 'player' });
    if (G.audio) G.audio.foley('pin');
  }
  bomb(p, vel) { this.list.push({ kind: 'bomb', pos: p.clone(), vel: vel.clone(), mesh: this._mesh('bomb'), owner: 'player', fuse: 8 }); }
  update(dt) {
    const W = G.world, pl = G.player; this.warn.length = 0;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i]; let boom = false;
      if (n.kind === 'frag' || n.kind === 'flash') {
        n.fuse -= dt; this._ballistic(n, dt);
        n.mesh.position.copy(n.pos); if (!n.rest) { n.mesh.rotation.x += n.spin.x * dt; n.mesh.rotation.z += n.spin.z * dt; }
        if (n.kind === 'frag' && pl.alive && n.pos.distanceTo(pl.pos) < 9) this.warn.push(n.pos);
        if (n.fuse <= 0) { boom = true; if (n.kind === 'frag') G.combat.explode(n.pos.clone().setY(n.pos.y + 0.15), 6.5, 240, n.owner); else G.combat.flashbang(n.pos); }
      } else if (n.kind === 'rocket') {
        n.fuse -= dt; n.vel.y -= 1.5 * dt; const step = n.vel.length() * dt, d = n.vel.clone().normalize();
        const h = W.raycast(n.pos, d, step), eh = G.enemies.rayHit(n.pos, d, h ? h.t : step);
        if (eh || h || n.fuse <= 0) { const t = eh ? eh.t : h ? h.t : step; n.pos.addScaledVector(d, Math.max(0, t - 0.15)); if (h && h.solid.flags.pane) G.props.breakGlass(h.solid.flags.pane); G.combat.explode(n.pos, 7, 300, 'player'); boom = true; }
        else n.pos.addScaledVector(d, step);
        n.mesh.position.copy(n.pos); n.mesh.lookAt(n.pos.clone().add(d));
        n.trailT -= dt; if (n.trailT <= 0) { n.trailT = 0.012; G.fx.alpha.spawn(n.pos.x, n.pos.y, n.pos.z, rand(-0.3, 0.3), rand(0, 0.5), rand(-0.3, 0.3), rand(1.2, 2), 0.3, 0.75, 0.73, 0.7, 0.45, 0, { grow: 1.6, drag: 1.2 }); G.fx.add.spawn(n.pos.x, n.pos.y, n.pos.z, 0, 0, 0, 0.06, 0.35, 1, 0.7, 0.3, 1, 2, {}); }
      } else if (n.kind === 'bomb') {
        n.fuse -= dt; n.vel.y -= 25 * dt; const step = n.vel.length() * dt, d = n.vel.clone().normalize();
        const h = W.raycast(n.pos, d, step + 0.2);
        if (h || n.fuse <= 0) { if (h) n.pos.set(h.x, h.y + 0.3, h.z); G.combat.explode(n.pos, 9, 650, 'player', 'airstrike'); boom = true; }
        else n.pos.addScaledVector(d, step);
        n.mesh.position.copy(n.pos); n.mesh.lookAt(n.pos.clone().add(d));
      } else if (n.kind === 'claymore') {
        n.armT -= dt;
        if (n.trig > 0) { n.trig -= dt; if (n.trig <= 0) { G.combat.explode(n.pos.clone().addScaledVector(n.fwd, 0.7).setY(n.pos.y + 0.4), 5.5, 320, 'player'); boom = true; } }
        else if (n.armT <= 0) for (const s of G.enemies.list) {
          if (!s.alive) continue; const dx = s.pos.x - n.pos.x, dz = s.pos.z - n.pos.z, d = Math.hypot(dx, dz);
          if (d < 3.4 && Math.abs(s.pos.y - n.pos.y) < 1.5 && (dx * n.fwd.x + dz * n.fwd.z) / Math.max(d, 0.01) > 0.25) { n.trig = 0.18; if (G.audio) G.audio.foley('pin', n.pos); break; }
        }
      }
      if (boom) { this.scene.remove(n.mesh); this.list.splice(i, 1); }
    }
  }
  _ballistic(n, dt) {
    const W = G.world;
    if (n.rest) {
      const k = Math.exp(-5 * dt); n.vel.x *= k; n.vel.z *= k; n.pos.x += n.vel.x * dt; n.pos.z += n.vel.z * dt;
      const g = W.groundAt(n.pos.x, n.pos.z, n.pos.y + 0.1, 0.05, 0.3); if (n.pos.y - 0.045 - g > 0.08) n.rest = false; else n.pos.y = g + 0.045;
      return;
    }
    n.vel.y -= 9.8 * dt; const sp = n.vel.length(), step = sp * dt; if (step < 1e-5) return;
    const d = n.vel.clone().divideScalar(sp), h = W.raycast(n.pos, d, step + 0.05);
    if (h) {
      if (h.solid.flags.pane) { G.props.breakGlass(h.solid.flags.pane); n.pos.addScaledVector(d, step); return; }
      const nn = new V3(h.nx, h.ny, h.nz), vn = n.vel.dot(nn);
      n.vel.addScaledVector(nn, -1.42 * vn).multiplyScalar(0.62); n.pos.set(h.x, h.y, h.z).addScaledVector(nn, 0.05);
      if (sp > 2.5 && G.audio && n.bounces++ < 4) G.audio.impact('metal', n.pos);
      if (nn.y > 0.6 && Math.abs(n.vel.y) < 1.2) { n.vel.y = 0; n.rest = true; }
    } else n.pos.addScaledVector(d, step);
  }
}

// ====================================================================== explosive barrels and breakable glass
export class Props {
  constructor(scene, info) {
    this.scene = scene; this.info = info; this.barrels = [];
    const body = new THREE.CylinderGeometry(0.3, 0.3, 0.9, 18).translate(0, 0.45, 0), band = new THREE.CylinderGeometry(0.306, 0.306, 0.07, 18);
    for (const p of info.barrels) {
      const g = new THREE.Group(); g.position.copy(p);
      const m = new THREE.Mesh(body, MAT.barrelRed); m.castShadow = true; m.receiveShadow = true; g.add(m);
      for (const y of [0.22, 0.68]) { const b = new THREE.Mesh(band, MAT.hazard); b.position.y = y; g.add(b); }
      scene.add(g);
      const bar = { pos: p.clone(), group: g, hp: 60, burn: -1, alive: true };
      bar.solid = G.world.add(p.x, 0, p.z, 0.6, 0.9, 0.6, 0, 'barrelRed', { barrel: bar });
      bar.damage = (amt) => this._damage(bar, amt);
      this.barrels.push(bar);
    }
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0); this._m = new THREE.Matrix4();
  }
  reset() {
    for (const b of this.barrels) { b.alive = true; b.hp = 60; b.burn = -1; b.solid.alive = true; b.group.visible = true; }
    const gm = this.info.glassMesh; if (!gm) return;
    for (const g of this.info.glass) { g.solid.alive = true; this._m.makeScale(g.w, g.h, g.d).setPosition(g.x, g.y + g.h / 2, g.z); gm.setMatrixAt(g.index, this._m); }
    gm.instanceMatrix.needsUpdate = true;
  }
  _damage(b, amt) {
    if (!b.alive) return; b.hp -= amt; if (G.audio) G.audio.foley('barrelHit', b.pos);
    if (b.burn < 0) b.burn = rand(1.8, 2.6);
    if (b.hp <= 0) b.burn = Math.min(b.burn, 0.05);
  }
  breakGlass(g) {
    if (!g || !g.solid.alive) return;
    G.world.remove(g.solid); const gm = this.info.glassMesh; gm.setMatrixAt(g.index, this._zero); gm.instanceMatrix.needsUpdate = true;
    G.fx.glassBurst(g.x, g.y + g.h / 2, g.z, Math.max(g.w, g.d), g.h);
    if (G.audio) { const p = { x: g.x, y: g.y + g.h / 2, z: g.z }; G.audio.impact('glass', p); setTimeout(() => G.audio.impact('glass', p), 90); }
  }
  blast(p, R) {
    for (const b of this.barrels) if (b.alive && b.pos.distanceTo(p) < R * 0.9 && b.burn !== 0) { b.hp = 0; b.burn = Math.min(b.burn < 0 ? 9 : b.burn, rand(0.12, 0.35)); }
    for (const g of this.info.glass) if (g.solid.alive && Math.hypot(g.x - p.x, g.y + g.h / 2 - p.y, g.z - p.z) < R * 1.6) this.breakGlass(g);
  }
  update(dt) {
    for (const b of this.barrels) {
      if (!b.alive || b.burn < 0) continue;
      b.burn -= dt; G.fx.fire(new V3(b.pos.x, b.pos.y + 0.95, b.pos.z), 0.8);
      if (b.burn <= 0) { b.alive = false; b.solid.alive = false; b.group.visible = false; G.combat.explode(new V3(b.pos.x, b.pos.y + 0.5, b.pos.z), 6.5, 260, 'player', 'barrel'); }
    }
  }
}

// ====================================================================== weapon drops
export class Pickups {
  constructor(scene) { this.scene = scene; this.list = []; }
  clear() { for (const p of this.list) this.scene.remove(p.mesh); this.list.length = 0; }
  drop(w, pos, yaw = 0, vel = new V3()) {
    if (typeof w === 'string') w = makeWeapon(w, false);
    const mesh = new THREE.Mesh(worldGun(w.id).geo, MAT.gunmetal); mesh.castShadow = true; this.scene.add(mesh);
    const pk = { w, id: w.id, mesh, pos: pos.clone(), vel: vel.clone().add(new V3(rand(-0.8, 0.8), rand(0.5, 1.5), rand(-0.8, 0.8))), yaw, roll: 0, rest: false, t: 0 };
    mesh.position.copy(pk.pos); this.list.push(pk);
    while (this.list.length > 9) this._remove(this.list[0]);
    return pk;
  }
  _remove(pk) { this.scene.remove(pk.mesh); const i = this.list.indexOf(pk); if (i >= 0) this.list.splice(i, 1); }
  take(pk) { this._remove(pk); return pk.w; }
  nearest(p, r) { let best = null, bd = r; for (const pk of this.list) { if (!pk.rest) continue; const d = Math.hypot(pk.pos.x - p.x, pk.pos.z - p.z); if (d < bd && Math.abs(pk.pos.y - p.y) < 1.3) { bd = d; best = pk; } } return best; }
  blast(p, R) { for (const pk of this.list) { const d = pk.pos.distanceTo(p); if (d < R) { const k = (1 - d / R) * 7; pk.vel.add(pk.pos.clone().sub(p).normalize().multiplyScalar(k)).add(new V3(0, k * 0.6, 0)); pk.rest = false; } } }
  update(dt) {
    const W = G.world;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const pk = this.list[i]; pk.t += dt;
      if (pk.t > 60) { this._remove(pk); continue; }
      if (!pk.rest) {
        pk.vel.y -= 12 * dt; pk.pos.addScaledVector(pk.vel, dt); pk.roll = Math.min(Math.PI / 2, pk.roll + dt * 5);
        const tmp = pk.pos.clone(); W.resolve(tmp, 0.15, 0.1, 0.05); pk.pos.x = tmp.x; pk.pos.z = tmp.z;
        const g = W.groundAt(pk.pos.x, pk.pos.z, pk.pos.y + 0.2, 0.1, 0.4);
        if (pk.pos.y <= g + 0.035) { pk.pos.y = g + 0.035; if (Math.abs(pk.vel.y) < 2) { pk.rest = true; pk.roll = Math.PI / 2; pk.vel.set(0, 0, 0); } else { pk.vel.y *= -0.3; pk.vel.x *= 0.5; pk.vel.z *= 0.5; } }
      }
      pk.mesh.position.copy(pk.pos); pk.mesh.rotation.set(0, pk.yaw, pk.roll);
    }
  }
}

// ====================================================================== air support and sentry guns
function mergeSimple(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g)); let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return out;
}
export const SUPPORT = {
  drone: { name: 'Recon Drone', short: 'UAV', desc: 'Every hostile shows on your minimap for 30 seconds.', price: 1500, streak: 3 },
  airstrike: { name: 'Precision Airstrike', short: 'AIR', desc: 'Two jets carpet the spot you are aiming at.', price: 3000, streak: 5 },
  heli: { name: 'Attack Helicopter', short: 'HELI', desc: 'A gunship circles the district for 45 seconds.', price: 5000, streak: 8 },
  sentry: { name: 'Sentry Gun', short: 'SNTY', desc: 'An automated turret guards a spot for 90 seconds.', price: 2500 }
};
export class Support {
  constructor(scene) { this.scene = scene; this.inv = []; this.active = []; this.radarT = 0; this._models(); }
  _models() {
    const M = MAT;
    const heli = new THREE.Group();
    const body = new THREE.Mesh(mergeSimple([new THREE.CapsuleGeometry(0.85, 2.6, 6, 14).rotateX(Math.PI / 2), new THREE.BoxGeometry(1.2, 0.5, 1.8).translate(0, -0.55, 0.2)]), M.metalGreen); heli.add(body);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.8, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.85, 1.1).translate(0, 0.05, -1.75), M.darkGlass); heli.add(glass);
    heli.add(new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.4, 5).translate(0, 0.25, 3.6), M.metalGreen));
    heli.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.3, 0.9).translate(0, 0.9, 6), M.metalGreen));
    for (const x of [-0.75, 0.75]) heli.add(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 3.4).translate(x, -1.25, 0), M.metalGrey));
    heli.add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.5).translate(0, -0.3, 0.3), M.metalGreen));
    for (const x of [-1.2, 1.2]) heli.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1, 10).rotateX(Math.PI / 2).translate(x, -0.45, 0.3), M.metalGrey));
    const rotor = new THREE.Group(); rotor.name = 'rotor'; rotor.position.set(0, 1.05, 0); for (const r of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(11, 0.04, 0.32), M.black); b.rotation.y = r; rotor.add(b); } heli.add(rotor);
    const tail = new THREE.Group(); tail.name = 'tail'; tail.position.set(0.15, 1, 6.1); for (const r of [0, Math.PI / 2]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.04, 1.8, 0.14), M.black); b.rotation.x = r; tail.add(b); } heli.add(tail);
    heli.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.heliModel = heli;
    const jet = new THREE.Group();
    jet.add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 12, 12).rotateX(Math.PI / 2), M.metalGrey));
    jet.add(new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.6, 12).rotateX(-Math.PI / 2).translate(0, 0, -7.3), M.metalGrey));
    jet.add(new THREE.Mesh(new THREE.BoxGeometry(10, 0.15, 3.2).translate(0, 0, 0.8), M.metalGrey));
    jet.add(new THREE.Mesh(new THREE.BoxGeometry(4, 0.12, 1.4).translate(0, 0, 5.2), M.metalGrey));
    jet.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 1.6).translate(0, 1.1, 5.2), M.metalGrey));
    jet.add(new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8).scale(1, 0.8, 2.2).translate(0, 0.45, -3.4), M.darkGlass));
    const burner = new THREE.Mesh(new THREE.ConeGeometry(0.5, 3, 10, 1, true).rotateX(Math.PI / 2).translate(0, 0, 7.4), new THREE.MeshBasicMaterial({ color: 0xffa860, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    jet.add(burner); this.jetModel = jet;
    const sentry = new THREE.Group();
    for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2, l = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 6), M.metalGrey); l.position.set(Math.cos(a) * 0.25, 0.42, Math.sin(a) * 0.25); l.rotation.set(Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); sentry.add(l); }
    const head = new THREE.Group(); head.name = 'head'; head.position.y = 0.88; sentry.add(head);
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.28, 0.5), M.metalGreen));
    head.add(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8).rotateX(Math.PI / 2).translate(0, 0.02, -0.5), M.gunmetal));
    head.add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.22).translate(0.25, -0.02, 0.05), M.metalGrey));
    sentry.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.sentryModel = sentry;
    const drone = new THREE.Group(); drone.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.18, 0.6), M.metalGrey));
    for (const [x, z] of [[-0.45, -0.45], [0.45, -0.45], [-0.45, 0.45], [0.45, 0.45]]) drone.add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.02, 12).translate(x, 0.12, z), M.black));
    this.droneModel = drone;
  }
  reset() { for (const a of this.active) this._end(a); this.active.length = 0; this.inv.length = 0; this.radarT = 0; }
  add(kind) { if (this.inv.length >= 4) return false; this.inv.push(kind); if (G.ui) G.ui.streakReady(kind); if (G.audio) G.audio.uiSound('streak'); return true; }
  useNext() {
    if (!this.inv.length || !G.player.alive) return false;
    const k = this.inv[this.inv.length - 1];
    if (k === 'heli' && this.active.some((a) => a.kind === 'heli')) { G.ui.cmsg('Helicopter already on station'); return false; }
    this.inv.pop(); this.call(k); return true;
  }
  call(kind) {
    const pl = G.player, cam = G.camera;
    if (kind === 'drone') {
      this.radarT = 30; const m = this.droneModel.clone(); this.scene.add(m);
      this.active.push({ kind, t: 0, life: 30, mesh: m }); G.ui.sub('<em>Overlord:</em> Recon drone is up. Hostiles marked on your map.', 3);
    } else if (kind === 'airstrike') {
      const f = new V3(0, 0, -1).applyQuaternion(cam.quaternion), h = G.world.raycast(cam.position, f, 160);
      const target = h ? new V3(h.x, 0, h.z) : cam.position.clone().addScaledVector(new V3(f.x, 0, f.z).normalize(), 40).setY(0);
      target.y = G.world.groundAt(target.x, target.z, 30, 0.3, 0);
      const dir = new V3(target.x - pl.pos.x, 0, target.z - pl.pos.z); if (dir.lengthSq() < 4) dir.set(-Math.sin(pl.yaw), 0, -Math.cos(pl.yaw)); dir.normalize();
      const start = target.clone().addScaledVector(dir, -520).setY(58), side = new V3(-dir.z, 0, dir.x);
      const offs = [-10, 10], jets = offs.map((o) => { const m = this.jetModel.clone(); m.position.copy(start).addScaledVector(side, o); m.lookAt(m.position.clone().add(dir)); m.rotateY(Math.PI); this.scene.add(m); return m; });
      const drops = []; for (let i = 0; i < 7; i++) { const land = target.clone().addScaledVector(dir, -18 + i * 6).addScaledVector(side, rand(-3, 3)); const spawn = land.clone().addScaledVector(dir, -50).setY(55); drops.push({ spawn, at: 2.6 + spawn.distanceTo(start.clone().setY(55)) / 160, done: false }); }
      this.active.push({ kind, t: 0, life: 2.6 + 1040 / 160, jets, offs, side, dir, start, drops, target, snd: G.audio.loop('jet', start), marker: 2.6 });
      G.ui.sub('<em>Overlord:</em> Airstrike inbound. Danger close: clear the target area.', 3.5);
    } else if (kind === 'heli') {
      const m = this.heliModel.clone(), rotor = m.getObjectByName('rotor'), tail = m.getObjectByName('tail');
      this.scene.add(m);
      this.active.push({ kind, t: 0, life: 45, mesh: m, rotor, tail, ang: Math.atan2(pl.pos.z, pl.pos.x) + Math.PI, fireT: 0, target: null, retarget: 0, snd: G.audio.loop('rotor', new V3(0, 30, 0)) });
      G.ui.sub('<em>Gunship:</em> On station. Engaging hostiles.', 3);
    } else if (kind === 'sentry') {
      const f = new V3(-Math.sin(pl.yaw), 0, -Math.cos(pl.yaw)), p = pl.pos.clone().addScaledVector(f, 1.4);
      const t = p.clone(); G.world.resolve(t, 0.35, 1, 0.2); p.x = t.x; p.z = t.z; p.y = G.world.groundAt(p.x, p.z, pl.pos.y + 0.5, 0.2, 0.8);
      const m = this.sentryModel.clone(), head = m.getObjectByName('head'); m.position.copy(p); m.rotation.y = pl.yaw; this.scene.add(m);
      const solid = G.world.add(p.x, p.y, p.z, 0.55, 1.05, 0.55, 0, 'metalGreen', {});
      this.active.push({ kind, t: 0, life: 90, mesh: m, head, solid, yaw: pl.yaw, fireT: 0, target: null, retarget: 0, ammo: 400 });
      G.audio.foley('bolt', p);
    }
  }
  _end(a) {
    if (a.mesh) this.scene.remove(a.mesh); if (a.jets) for (const j of a.jets) this.scene.remove(j);
    if (a.snd) a.snd.stop(); if (a.solid) G.world.remove(a.solid);
  }
  _pickTarget(from, range) {
    let best = null, bd = range;
    for (const s of G.enemies.list) { if (!s.alive) continue; const d = s.chest.distanceTo(from); if (d < bd && G.world.clear(from, s.chest)) { bd = d; best = s; } }
    return best;
  }
  _gun(from, s, chance, dmg, sound) {
    const tgt = s.chest.clone().add(new V3(rand(-0.3, 0.3), rand(-0.3, 0.4), rand(-0.3, 0.3)));
    const dir = tgt.clone().sub(from); const L = dir.length(); dir.divideScalar(L);
    G.fx.flash(from, 0.7); G.audio.gun(sound, from, {});
    if (Math.random() < 0.6) G.fx.tracer(from, dir, L, 500, 3, [1, 0.8, 0.45]);
    if (Math.random() < chance) { G.enemies.hurt(s, dmg, dir, Math.random() < 0.12 ? 'head' : 'torso', 'support', 5); G.fx.impact('flesh', tgt, P3(dir.clone().negate())); }
    else { const h = G.world.raycast(from, dir, L + 8); if (h) { const p = { x: h.x, y: h.y, z: h.z }, n = { x: h.nx, y: h.ny, z: h.nz }; G.fx.impact(h.solid.surf, p, n, 0.8); G.fx.decal('hole', p, n, 0.08); } }
  }
  update(dt) {
    this.radarT = Math.max(0, this.radarT - dt);
    const pl = G.player;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i]; a.t += dt;
      if (a.kind === 'drone') { const ang = a.t * 0.35; a.mesh.position.set(pl.pos.x + Math.cos(ang) * 14, 26, pl.pos.z + Math.sin(ang) * 14); a.mesh.rotation.y = -ang; }
      else if (a.kind === 'airstrike') {
        if (a.marker > 0) { a.marker -= dt; if (Math.random() < 0.6) G.fx.alpha.spawn(a.target.x + rand(-0.2, 0.2), a.target.y + 0.2, a.target.z + rand(-0.2, 0.2), rand(-0.3, 0.3) + 0.3, rand(1.2, 2), rand(-0.3, 0.3), rand(2.5, 4), rand(0.5, 0.9), 0.55, 0.1, 0.07, 0.45, 0, { grow: 1.2, drag: 0.4 }); }
        const k = Math.max(0, a.t - 2.6);
        a.jets.forEach((j, n) => { j.position.copy(a.start).addScaledVector(a.dir, k * 160).addScaledVector(a.side, a.offs[n]); j.position.y = 58; });
        if (a.snd) a.snd.set(k > 0 ? 0.9 : 0, a.jets[0].position);
        for (const d of a.drops) if (!d.done && a.t >= d.at) { d.done = true; G.throwables.bomb(d.spawn, a.dir.clone().multiplyScalar(30).add(new V3(0, -5, 0))); }
      } else if (a.kind === 'heli') {
        const enter = clamp(a.t / 5, 0, 1), leave = clamp((a.t - (a.life - 5)) / 5, 0, 1), R = 26 + (1 - enter) * 120 + leave * 120;
        a.ang += dt * 0.24; const m = a.mesh;
        m.position.set(Math.cos(a.ang) * R, 30 + Math.sin(a.t * 0.5) * 1.5, Math.sin(a.ang) * R);
        const tang = new V3(-Math.sin(a.ang), 0, Math.cos(a.ang));
        a.retarget -= dt; if (a.retarget <= 0) { a.retarget = 0.6; a.target = a.t > 4 && leave <= 0 ? this._pickTarget(m.position, 90) : null; }
        const look = a.target ? a.target.pos : m.position.clone().add(tang);
        const yaw = Math.atan2(-(look.x - m.position.x), -(look.z - m.position.z)); m.rotation.set(0.1, yaw, Math.sin(a.t) * 0.04, 'YXZ');
        a.rotor.rotation.y += dt * 28; a.tail.rotation.x += dt * 40;
        if (a.snd) a.snd.set(1.4, m.position);
        if (a.target && a.target.alive) { a.fireT -= dt; if (a.fireT <= 0) { a.fireT = 0.085; const gp = m.localToWorld(new V3(0, -0.9, -2.4)); this._gun(gp, a.target, 0.42, 42, 'heli'); } }
      } else if (a.kind === 'sentry') {
        const head = a.head, hp = a.mesh.localToWorld(new V3(0, 0.9, 0));
        a.retarget -= dt; if (a.retarget <= 0) { a.retarget = 0.4; a.target = this._pickTarget(hp, 45); }
        if (a.target && a.target.alive) {
          const dx = a.target.pos.x - a.mesh.position.x, dz = a.target.pos.z - a.mesh.position.z, want = Math.atan2(-dx, -dz) - a.mesh.rotation.y;
          const cur = head.rotation.y, dif = Math.atan2(Math.sin(want - cur), Math.cos(want - cur)); head.rotation.y += clamp(dif, -5 * dt, 5 * dt);
          if (Math.abs(dif) < 0.12 && a.ammo > 0) { a.fireT -= dt; if (a.fireT <= 0) { a.fireT = 0.1; a.ammo--; const mp = head.localToWorld(new V3(0, 0.02, -0.82)); const d = mp.distanceTo(a.target.chest); this._gun(mp, a.target, d < 20 ? 0.45 : 0.3, 20, 'turret'); } }
        }
      }
      if (a.t >= a.life || (a.kind === 'sentry' && a.ammo <= 0)) { this._end(a); this.active.splice(i, 1); }
    }
  }
}

// ====================================================================== armory catalog
const WEAPON_SHOP = ['smg9', 'm88', 'dmr14', 'lmg60', 'sr50', 'ar7', 'lr1', 'p9'];
const CLASS_NAME = { ar: 'Assault rifle', smg: 'Submachine gun', shotgun: 'Shotgun', lmg: 'Light machine gun', sniper: 'Sniper rifle', dmr: 'Marksman rifle', pistol: 'Pistol', launcher: 'Rocket launcher' };
const PRICE = { smg9: 900, m88: 1200, dmr14: 1800, lmg60: 2200, sr50: 2800, ar7: 600, lr1: 2500, p9: 200 };
export const PERKS = {
  perkFast: { name: 'Sleight of Hand', desc: 'Reload 20% faster.', price: 1500 },
  perkSteady: { name: 'Steady Aim', desc: 'Hip-fire spread reduced by a third.', price: 1200 },
  perkMarathon: { name: 'Marathon', desc: 'Sprint twice as long.', price: 800 },
  perkPower: { name: 'Stopping Power', desc: 'Bullets deal 25% more damage.', price: 2500 }
};
function attachOK(def, key) {
  const c = def.cls;
  if (key === 'reddot' || key === 'holo') return ['ar', 'smg', 'lmg', 'dmr'].includes(c);
  if (key === 'acog') return ['ar', 'lmg', 'dmr'].includes(c);
  if (key === 'suppressor') return c !== 'launcher' && c !== 'shotgun';
  if (key === 'extmag') return c !== 'launcher' && c !== 'shotgun' && c !== 'sniper';
  if (key === 'grip') return ['ar', 'lmg', 'dmr'].includes(c);
  return false;
}

// ====================================================================== the survival game
const RANKS = ['Recruit', 'Private', 'Private First Class', 'Specialist', 'Corporal', 'Sergeant', 'Staff Sergeant', 'Sergeant First Class', 'Master Sergeant', 'First Sergeant',
  'Sergeant Major', 'Warrant Officer', 'Second Lieutenant', 'First Lieutenant', 'Captain', 'Major', 'Lieutenant Colonel', 'Colonel', 'Brigadier', 'General'];
export function rankFor(xp) {
  let i = 0; while (i < RANKS.length - 1 && xp >= rankXP(i + 1)) i++;
  const a = rankXP(i), b = i < RANKS.length - 1 ? rankXP(i + 1) : a;
  return { i, name: RANKS[i], next: b, base: a, frac: b > a ? (xp - a) / (b - a) : 1, max: i === RANKS.length - 1 };
}
function rankXP(i) { return Math.round(400 * Math.pow(i, 1.65) / 50) * 50; }

export class Game {
  constructor() { this.running = false; this.profile = Object.assign({ xp: 0, bestWave: 0, bestScore: 0, games: 0 }, store.get('iron.profile', {})); }
  saveProfile() { store.set('iron.profile', this.profile); }
  start() {
    const info = G.mapInfo;
    G.stats = { shots: 0, hits: 0, kills: 0, heads: 0, score: 0, cashEarned: 0 };
    this.cash = 500; this.wave = 0; this.state = 'intermission'; this.timer = 10; this.streak = 0; this.xp = 0; this.queue = []; this.graceT = 0;
    this.running = true; this.overT = -1; this.maxAlive = 6;
    G.enemies.clear(); G.fx.clear(); G.throwables.clear(); G.pickups.clear(); G.props.reset(); G.support.reset();
    const pl = G.player; pl.reset(info.playerSpawn, info.playerYaw); pl.perkFast = pl.perkSteady = pl.perkMarathon = pl.perkPower = false;
    G.arsenal.reset();
    if (G.ui) { G.ui.reset(); G.ui.banner('Old Quarter', 'Hold the district. First wave in 10 seconds.', 3.5); }
  }
  get intermission() { return this.state === 'intermission'; }
  update(dt) {
    if (!this.running) return;
    if (this.overT >= 0) { this.overT += dt; if (this.overT > 3.4) { this.running = false; if (G.main) G.main.gameOver(); } return; }
    this.graceT = Math.max(0, this.graceT - dt);
    if (this.state === 'intermission') { this.timer -= dt; if (this.timer <= 0) this.startWave(); }
    else {
      this.spawnT -= dt; const alive = G.enemies.alive;
      if (this.queue.length && alive < this.maxAlive && this.spawnT <= 0) { const type = this.queue.shift(); if (!G.enemies.spawn(type)) this.queue.unshift(type); this.spawnT = rand(0.6, 1.6); }
      if (!this.queue.length && alive === 0) this.waveDone();
    }
    if (G.player.health < 35) this.streak = 0;
  }
  composition(n) {
    const total = Math.min(6 + 3 * n, 42);
    let heavy = n >= 5 ? Math.floor((n - 2) / 3) : 0; if (n % 5 === 0) heavy += 1;
    const marks = n >= 4 ? Math.min(3, Math.floor(n / 4) + (n >= 10 ? 1 : 0)) : 0;
    const rush = n >= 2 ? Math.round(total * (n >= 6 ? 0.3 : 0.22)) : 0;
    const rifle = Math.max(2, total - heavy - marks - rush);
    return { rifleman: rifle, rusher: rush, marksman: marks, heavy };
  }
  startWave() {
    this.wave++; const n = this.wave, c = this.composition(n);
    this.maxAlive = Math.min(5 + n, 14);
    const early = [], late = [];
    for (let i = 0; i < c.marksman; i++) early.push('marksman');
    for (let i = 0; i < c.rifleman; i++) early.push('rifleman');
    for (let i = 0; i < c.rusher; i++) early.push('rusher');
    for (let i = early.length - 1; i > 0; i--) { const j = randInt(c.marksman ? 1 : 0, i); const t = early[i]; early[i] = early[j]; early[j] = t; }
    for (let i = 0; i < c.heavy; i++) late.push('heavy');
    // heavies arrive two thirds of the way through
    const at = Math.floor(early.length * 0.66); this.queue = early.slice(0, at).concat(late, early.slice(at));
    this.state = 'wave'; this.spawnT = 0.5; this.graceT = 2.5;
    if (G.audio) G.audio.sting('wave');
    const sub = c.heavy && n % 5 === 0 ? 'Juggernaut sighted' : c.marksman ? 'Snipers on the rooftops' : c.rusher ? 'Hostiles closing fast' : 'Hostiles inbound';
    if (G.ui) G.ui.banner(`Wave ${n}`, sub, 3);
  }
  waveDone() {
    const n = this.wave, bonus = 500 + 100 * n;
    this.addCash(bonus); this.addScore(500 * n); this.addXP(100 * n, `Wave ${n} survived`);
    this.state = 'intermission'; this.timer = 22;
    this.profile.bestWave = Math.max(this.profile.bestWave, n); this.saveProfile();
    if (G.audio) G.audio.sting('clear');
    if (G.ui) G.ui.banner(`Wave ${n} survived`, `+$${bonus} · Resupply at the armories`, 3.5);
    // top up equipment a little
    const pl = G.player; if (pl.frags < 1) pl.frags = 1; if (pl.flashes < 1) pl.flashes = 1;
  }
  addCash(v) { this.cash += v; G.stats.cashEarned += Math.max(0, v); if (G.ui) G.ui.cash(v); }
  addScore(v) { G.stats.score += v; }
  addXP(v, label) { this.xp += v; this.profile.xp += v; if (G.ui && label) G.ui.xp(`+${v} ${label}`); }
  onKill(s, part, kind) {
    if (!this.running) return;
    G.stats.kills++; if (part === 'head') G.stats.heads++;
    const D = DIFF[settings.difficulty] || DIFF.regular, T = s.def;
    if (kind === 'enemyNade') { G.ui.killfeed(null, T.name, kind, false); return; }
    let cash = T.cash, label = '', xp = T.xp;
    if (part === 'head' && kind === 'bullet') { cash += T.cash; xp += 25; label = 'Headshot'; }
    if (kind === 'melee') { cash += 50; xp += 25; label = 'Melee'; }
    if (kind === 'explosion' || kind === 'barrel' || kind === 'airstrike') { cash += 25; xp += 10; label = kind === 'barrel' ? 'Barrel' : 'Explosive'; }
    if (kind === 'support') { cash = Math.round(cash * 0.5); label = 'Support'; }
    this.addCash(Math.round(cash * D.cash)); this.addScore(100 + (part === 'head' ? 50 : 0)); this.addXP(xp, label || 'Kill');
    G.ui.killfeed('You', T.name, kind === 'bullet' ? G.arsenal.w.def.name : kind === 'support' ? 'Support' : kind === 'melee' ? 'Knife' : 'Explosive', part === 'head');
    if (kind !== 'support') {
      this.streak++;
      for (const [k, v] of Object.entries(SUPPORT)) if (v.streak && this.streak === v.streak) G.support.add(k);
    }
  }
  onPlayerDeath() { this.overT = 0; this.profile.bestScore = Math.max(this.profile.bestScore, G.stats.score); this.profile.games++; this.saveProfile(); }

  // ---------------- armory ----------------
  armory(station, tab) {
    const pl = G.player, ar = G.arsenal, items = [];
    const add = (o) => items.push(o);
    if (station === 'weapons') {
      if (tab === 'attachments') {
        const w = ar.slots[0], d = w.def;
        for (const k of ['reddot', 'holo', 'acog']) if (attachOK(d, k)) add({ name: OPTICS[k].name, desc: `Optic for the ${d.name}.`, price: OPTICS[k].price, own: w.att.optic === k, buy: () => { w.att.optic = k; } });
        for (const k of ['suppressor', 'extmag', 'grip']) if (attachOK(d, k)) add({ name: ATTACH[k].name, desc: k === 'suppressor' ? 'Quieter shots; you stay off the enemy radar.' : k === 'extmag' ? '50% more rounds per magazine.' : 'Less recoil and tighter spread.', price: ATTACH[k].price, own: w.att[k], buy: () => { w.att[k] = true; if (k === 'extmag') { w.mag = magSize(w); } } });
        if (!items.length) add({ name: 'No attachments', desc: `The ${d.name} takes no attachments.`, price: 0, own: true, buy: () => {} });
      } else {
        add({ name: 'Ammo', desc: 'Refill both weapons.', price: 300, own: ar.slots.every((w) => w.reserve >= Math.floor(w.def.reserve * (w.att.extmag ? 1.5 : 1)) && w.mag >= magSize(w)), buy: () => { for (const w of ar.slots) { w.reserve = Math.floor(w.def.reserve * (w.att.extmag ? 1.5 : 1)); } } });
        for (const id of WEAPON_SHOP) {
          const d = WEAPONS[id], owned = ar.slots.some((w) => w.id === id);
          add({ name: d.name, desc: `${CLASS_NAME[d.cls]}${d.secondary ? ' · sidearm slot' : ''}. ${d.mag}-round ${d.cls === 'shotgun' ? 'tube' : 'magazine'}.`, price: PRICE[id], own: owned, buy: () => { ar.give(id); } });
        }
      }
    } else if (station === 'equipment') {
      if (tab === 'perks') {
        for (const [k, p] of Object.entries(PERKS)) add({ name: p.name, desc: p.desc, price: p.price, own: !!pl[k], buy: () => { pl[k] = true; } });
      } else {
        add({ name: 'Frag grenades ×2', desc: 'Hold to cook. Carry up to 4.', price: 350, own: pl.frags >= 4, buy: () => { pl.frags = Math.min(4, pl.frags + 2); pl.lethalType = 'frag'; } });
        add({ name: 'Flashbangs ×2', desc: 'Blind and deafen hostiles. Carry up to 4.', price: 250, own: pl.flashes >= 4, buy: () => { pl.flashes = Math.min(4, pl.flashes + 2); } });
        add({ name: 'Claymores ×2', desc: 'Directional mines that trigger on hostiles.', price: 600, own: pl.claymores >= 4, buy: () => { pl.claymores = Math.min(4, pl.claymores + 2); pl.lethalType = 'claymore'; } });
        add({ name: 'Body armor', desc: 'Absorbs 60% of incoming damage until it breaks.', price: 1000, own: pl.armor >= 249, buy: () => { pl.armor = 250; if (G.audio) G.audio.uiSound('armor'); } });
      }
    } else {
      for (const [k, v] of Object.entries(SUPPORT)) add({ name: v.name, desc: v.desc + (v.streak ? ` Also earned with a ${v.streak}-kill streak.` : ''), price: v.price, own: false, full: G.support.inv.length >= 4, buy: () => { G.support.add(k); } });
    }
    return items;
  }
  purchase(item) {
    if (item.own) return 'Already owned';
    if (item.full) return 'Support inventory is full';
    if (this.cash < item.price) { if (G.audio) G.audio.uiSound('deny'); return 'Not enough cash'; }
    this.cash -= item.price; item.buy(); if (G.audio) G.audio.uiSound('buy');
    if (G.arsenal) G.arsenal.refreshModel();
    return `Purchased ${item.name}`;
  }

  // ---------------- interaction (armories, weapon pickups) ----------------
  interact(A) {
    const pl = G.player; if (!pl.alive) return null;
    for (const a of G.mapInfo.armories) {
      if (Math.hypot(a.pos.x - pl.pos.x, a.pos.z - pl.pos.z) < 2.3 && Math.abs(a.pos.y - pl.pos.y) < 1.5) {
        const label = a.type === 'weapons' ? 'Weapons armory' : a.type === 'equipment' ? 'Equipment armory' : 'Air support';
        if (A.interact && G.main) G.main.openArmory(a.type);
        return `${G.input.source === 'pad' ? 'Hold X' : G.input.source === 'touch' ? 'Tap Use' : 'Press F'} · ${label}`;
      }
    }
    // same weapon on the ground: take its ammo automatically
    for (const pk of G.pickups.list) {
      if (!pk.rest || Math.hypot(pk.pos.x - pl.pos.x, pk.pos.z - pl.pos.z) > 1.3 || Math.abs(pk.pos.y - pl.pos.y) > 1.3) continue;
      const mine = G.arsenal.slots.find((w) => w.id === pk.id); if (!mine) continue;
      const cap = Math.floor(mine.def.reserve * (mine.att.extmag ? 1.5 : 1)); if (mine.reserve >= cap) continue;
      mine.reserve = Math.min(cap, mine.reserve + pk.w.mag + pk.w.reserve); G.pickups.take(pk);
      if (G.audio) G.audio.uiSound('pickup'); if (G.ui) G.ui.cmsg('+ Ammo'); break;
    }
    const pk = G.pickups.nearest(pl.pos, 1.5);
    if (pk && !G.arsenal.slots.some((w) => w.id === pk.id)) {
      if (A.interact) {
        const old = G.arsenal.pickup(G.pickups.take(pk));
        if (old) G.pickups.drop(old, G.camera.position.clone().add(new V3(0, -0.4, 0)), pl.yaw, pl.fwd.clone().multiplyScalar(2));
        if (G.audio) G.audio.uiSound('pickup');
        return null;
      }
      return `${G.input.source === 'pad' ? 'Hold X' : G.input.source === 'touch' ? 'Tap Use' : 'Press F'} · Swap for ${pk.w.def.name}`;
    }
    return null;
  }
}
