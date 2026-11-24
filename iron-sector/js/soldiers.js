// Soldiers: instanced procedural bodies (rigid segments), walk cycles with two-bone IK, verlet ragdolls,
// and enemy AI: riflemen who fight from cover, rushers, rooftop marksmen and armored heavies.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { G, clamp, lerp, damp, rand, randInt, pick, wrapAngle, settings } from './core.js';
import { MAT } from './textures.js';
import { worldGun, WEAPONS } from './weapons.js';

const V3 = THREE.Vector3, UP = new V3(0, 1, 0);
export const DIFF = {
  recruit:  { acc: 0.5, dmg: 0.55, hp: 0.85, react: 1.45, cash: 1.0 },
  regular:  { acc: 0.78, dmg: 0.8, hp: 1, react: 1, cash: 1.0 },
  hardened: { acc: 1.0, dmg: 1.0, hp: 1.1, react: 0.8, cash: 1.1 },
  veteran:  { acc: 1.25, dmg: 1.3, hp: 1.2, react: 0.62, cash: 1.25 }
};
export const TYPES = {
  rifleman: { name: 'Rifleman', hp: 100, walk: 2.2, run: 4.3, guns: ['ar7'], burst: [3, 6], pause: [0.45, 1.1], rpm: 620, dmg: 17, acc: 0.42, settle: 0.6, range: 55, mag: 30, cover: true, nades: true, cash: 50, xp: 50, tint: 0xd9caa6, vest: 0x8a7a5a, helmet: 0x6d6a50, head: 0x3c3632 },
  rusher:   { name: 'Rusher', hp: 90, walk: 3.0, run: 5.5, guns: ['smg9', 'smg9', 'm88'], burst: [4, 8], pause: [0.3, 0.7], rpm: 860, dmg: 13, acc: 0.34, settle: 0.3, range: 24, mag: 32, rush: true, cash: 60, xp: 60, tint: 0x7a7f82, vest: 0x34383e, helmet: 0x2d3033, head: 0x26221f },
  marksman: { name: 'Marksman', hp: 90, walk: 2.0, run: 3.8, guns: ['sr50', 'dmr14'], burst: [1, 1], pause: [2.2, 3.2], rpm: 60, dmg: 55, acc: 0.85, settle: 1.6, range: 150, mag: 5, perch: true, cash: 100, xp: 100, tint: 0xa3ad86, vest: 0x5b6640, helmet: 0x5f6a43, head: 0x47493a },
  heavy:    { name: 'Juggernaut', hp: 460, walk: 1.75, run: 2.4, guns: ['lmg60'], burst: [12, 24], pause: [0.7, 1.4], rpm: 640, dmg: 15, acc: 0.3, settle: 0.9, range: 50, mag: 100, armored: true, hip: true, cash: 250, xp: 250, tint: 0x5a5f56, vest: 0x24272c, helmet: 0x1e2023, head: 0x1c1c1c, scale: 1.1, bulk: 1.32 }
};
const GUNS = ['ar7', 'smg9', 'm88', 'lmg60', 'sr50', 'dmr14'];
// joints: 0 pelvis 1 chest 2 head 3 shL 4 elL 5 haL 6 shR 7 elR 8 haR 9 hipL 10 knL 11 ftL 12 hipR 13 knR 14 ftR
const LINKS = [[0, 1], [1, 2], [1, 3], [1, 6], [3, 6], [3, 4], [4, 5], [6, 7], [7, 8], [0, 9], [0, 12], [9, 12], [9, 10], [10, 11], [12, 13], [13, 14],
  [3, 0], [6, 0], [9, 1], [12, 1], [2, 3], [2, 6], [3, 12], [6, 9]];
const MINL = [[9, 11, 0.34], [12, 14, 0.34], [3, 5, 0.18], [6, 8, 0.18], [11, 14, 0.12], [5, 8, 0.1], [2, 5, 0.12], [2, 8, 0.12]];
const SPINE = 0.44, NECK = 0.21, UARM = 0.3, FARM = 0.33, THIGH = 0.45, SHIN = 0.45;

// ------------------------------------------------------------------ math helpers
const _u = new V3(), _w = new V3();
function ik(a, target, l1, l2, pole, outMid, outTip) {
  _u.subVectors(target, a); let d = _u.length(); if (d < 1e-5) { _u.set(0, -1, 0); d = 1e-5; } else _u.divideScalar(d);
  d = clamp(d, Math.abs(l1 - l2) + 0.01, (l1 + l2) * 0.999);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d), h = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
  _w.copy(pole).addScaledVector(_u, -pole.dot(_u)); if (_w.lengthSq() < 1e-8) _w.set(0, 0, 1); _w.normalize();
  outMid.copy(a).addScaledVector(_u, x).addScaledVector(_w, h);
  outTip.copy(a).addScaledVector(_u, d);
}
function raySphere(o, d, c, r) {
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z, b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r, h = b * b - cc;
  if (h < 0) return -1; return -b - Math.sqrt(h);
}
function rayCapsule(o, d, pa, pb, r) {
  const bax = pb.x - pa.x, bay = pb.y - pa.y, baz = pb.z - pa.z, oax = o.x - pa.x, oay = o.y - pa.y, oaz = o.z - pa.z;
  const baba = bax * bax + bay * bay + baz * baz, bard = bax * d.x + bay * d.y + baz * d.z, baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = d.x * oax + d.y * oay + d.z * oaz, oaoa = oax * oax + oay * oay + oaz * oaz;
  const a = baba - bard * bard, b = baba * rdoa - baoa * bard, c = baba * oaoa - baoa * baoa - r * r * baba; let h = b * b - a * c;
  if (h >= 0) {
    const t = (-b - Math.sqrt(h)) / a, y = baoa + t * bard;
    if (y > 0 && y < baba) return t;
    const ocx = y <= 0 ? oax : o.x - pb.x, ocy = y <= 0 ? oay : o.y - pb.y, ocz = y <= 0 ? oaz : o.z - pb.z;
    const bb = d.x * ocx + d.y * ocy + d.z * ocz, cc = ocx * ocx + ocy * ocy + ocz * ocz - r * r; h = bb * bb - cc;
    if (h > 0) return -bb - Math.sqrt(h);
  }
  return -1;
}
// distance from point p to the segment o + d*t, t in [0, len]
export function segDist(o, d, len, p) { const t = clamp((p.x - o.x) * d.x + (p.y - o.y) * d.y + (p.z - o.z) * d.z, 0, len); return Math.hypot(o.x + d.x * t - p.x, o.y + d.y * t - p.y, o.z + d.z * t - p.z); }

const _m = new THREE.Matrix4(), _x = new V3(), _y = new V3(), _z = new V3(), ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function seg(mesh, slot, a, b, roll, rest, sx = 1, stretch = true) {
  _y.subVectors(b, a); const L = _y.length() || 1e-4; _y.divideScalar(L);
  _x.copy(roll).addScaledVector(_y, -roll.dot(_y)); if (_x.lengthSq() < 1e-8) { _x.set(1, 0, 0).addScaledVector(_y, -_y.x); } _x.normalize();
  _z.crossVectors(_x, _y);
  const k = stretch ? L / rest : sx;
  _m.set(_x.x * sx, _y.x * k, _z.x * sx, a.x, _x.y * sx, _y.y * k, _z.y * sx, a.y, _x.z * sx, _y.z * k, _z.z * sx, a.z, 0, 0, 0, 1);
  mesh.setMatrixAt(slot, _m);
}

// ------------------------------------------------------------------ soldier
class Soldier {
  constructor(i) {
    this.i = i; this.active = false; this.alive = false;
    this.pos = new V3(); this.vel = new V3(); this.J = []; for (let k = 0; k < 15; k++) this.J.push(new V3());
    this.chest = new V3(); this.muzzle = new V3(); this.gunM = new THREE.Matrix4(); this.lastSeen = new V3(); this.goal = new V3(); this.R = new V3(1, 0, 0);
    this.stuckP = new V3(); this.rag = null;
  }
}

export class Soldiers {
  constructor(scene) {
    this.scene = scene; this.cap = 34; this.pool = []; for (let i = 0; i < this.cap; i++) this.pool.push(new Soldier(i));
    this.list = []; this.nadeT = 0; this.pathBudget = 0; this.deadOrder = [];
    this._meshes(); this._marksmanFx();
    this._D = new V3(); this._Rw = new V3(); this._Dl = new V3(); this._Dg = new V3(); this._g = new V3(); this._g2 = new V3(); this._r = new V3(); this._up = new V3();
    this._t = new V3(); this._t2 = new V3(); this._pole = new V3(); this._c = new THREE.Color();
  }
  get alive() { let n = 0; for (const s of this.list) if (s.alive) n++; return n; }

  _meshes() {
    const cap = this.cap, mk = (geo, mat, n, shadow = true) => { const m = new THREE.InstancedMesh(geo, mat, cap * n); m.frustumCulled = false; m.castShadow = shadow; m.receiveShadow = true;
      for (let i = 0; i < cap * n; i++) { m.setMatrixAt(i, ZERO); m.setColorAt(i, new THREE.Color(1, 1, 1)); } m.userData.n = n; m.count = 0; this.scene.add(m); return m; };
    const capsule = (r, L) => new THREE.CapsuleGeometry(r, L, 3, 8).translate(0, L / 2, 0);
    const uni = MAT.camo.clone(), vest = MAT.sandbag.clone(), helm = MAT.metalWhite.clone(), head = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
    const glove = MAT.glove.clone(), boot = new THREE.MeshStandardMaterial({ color: 0x2b251f, roughness: 0.75 });
    uni.color.set(0xffffff); vest.color.set(0xffffff); helm.color.set(0xffffff);
    // vest with front pouches
    const vg = new RoundedBoxGeometry(0.42, 0.34, 0.3, 2, 0.04).translate(0, 0.27, 0.01);
    const pouches = [vg]; for (const x of [-0.12, 0, 0.12]) pouches.push(new RoundedBoxGeometry(0.1, 0.12, 0.07, 1, 0.015).translate(x, 0.2, -0.17));
    const vestGeo = mergeAll(pouches);
    const headGeo = new THREE.SphereGeometry(0.105, 14, 10).scale(0.92, 1.12, 1).translate(0, NECK, -0.01);
    const helmGeo = mergeAll([new THREE.SphereGeometry(0.128, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.52).translate(0, NECK + 0.03, 0.005), new THREE.BoxGeometry(0.07, 0.035, 0.05).translate(0, NECK + 0.11, -0.12)]);
    this.M = {
      torso: mk(new RoundedBoxGeometry(0.36, 0.5, 0.22, 2, 0.05).translate(0, 0.22, 0), uni, 1),
      hips: mk(new RoundedBoxGeometry(0.34, 0.22, 0.24, 2, 0.05).translate(0, -0.02, 0), uni, 1),
      vest: mk(vestGeo, vest, 1),
      head: mk(headGeo, head, 1),
      helmet: mk(helmGeo, helm, 1),
      uarm: mk(capsule(0.066, 0.3), uni, 2),
      farm: mk(capsule(0.056, 0.24), uni, 2),
      hand: mk(new RoundedBoxGeometry(0.07, 0.1, 0.05, 1, 0.02).translate(0, FARM - 0.01, 0), glove, 2, false),
      thigh: mk(capsule(0.098, 0.42), uni, 2),
      shin: mk(capsule(0.074, 0.42), uni, 2),
      boot: mk(new RoundedBoxGeometry(0.11, 0.11, 0.27, 2, 0.03).translate(0, -0.03, -0.06), boot, 2, false)
    };
    this.GM = {}; this.gunInfo = {};
    for (const id of GUNS) { const info = worldGun(id); this.gunInfo[id] = info; this.GM[id] = mk(info.geo, MAT.gunmetal, 1, true); }
  }
  _marksmanFx() {
    this.lasers = []; this.glints = [];
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,240,200,.8)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64); g.fillStyle = 'rgba(255,255,255,.9)'; g.fillRect(0, 31, 64, 2); g.fillRect(31, 0, 2, 64);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    for (let i = 0; i < 4; i++) {
      const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1], 3));
      const l = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      l.frustumCulled = false; l.visible = false; this.scene.add(l); this.lasers.push(l);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
      sp.visible = false; this.scene.add(sp); this.glints.push(sp);
    }
  }

  clear() {
    for (const s of this.pool) { if (s.cover) s.cover.taken = null; s.active = false; s.alive = false; s.rag = null; this._hide(s); }
    this.list.length = 0; this.deadOrder.length = 0;
    for (const m of Object.values(this.M)) { m.count = 0; m.instanceMatrix.needsUpdate = true; }
    for (const m of Object.values(this.GM)) { m.count = 0; m.instanceMatrix.needsUpdate = true; }
  }
  _hide(s) {
    const i = s.i;
    for (const m of Object.values(this.M)) { const n = m.userData.n; for (let j = 0; j < n; j++) m.setMatrixAt(i * n + j, ZERO); }
    for (const m of Object.values(this.GM)) m.setMatrixAt(i, ZERO);
  }

  // ---------------------------------------------------------------- spawning
  spawn(type, at = null) {
    const T = TYPES[type], D = DIFF[settings.difficulty] || DIFF.regular, pl = G.player;
    let s = this.pool.find((x) => !x.active);
    if (!s) { const old = this.deadOrder.shift(); if (!old) return null; this._retire(old); s = old; }
    let p = at;
    if (!p && T.perch) {
      const free = G.mapInfo.perches.filter((q) => q.distanceTo(pl.pos) > 18 && !this.list.some((o) => o.alive && o.perch === q));
      if (free.length) { p = pick(free); s.perch = p; }
    }
    if (!p) {
      const sp = G.mapInfo.spawns.map((q) => ({ q, d: q.distanceTo(pl.pos) + rand(0, 14) - (G.world.clear(q.clone().setY(1.6), G.camera.position) ? 25 : 0) }));
      sp.sort((a, b) => b.d - a.d); p = pick(sp.slice(0, 5)).q.clone().add(new V3(rand(-1.5, 1.5), 0, rand(-1.5, 1.5)));
      s.perch = null;
    }
    s.pos.copy(p); s.pos.y = G.world.groundAt(p.x, p.z, p.y + 0.5, 0.25, 0.8);
    s.type = type; s.def = T; s.sc = T.scale || 1; s.bulk = (T.bulk || 1) * s.sc;
    s.hp = s.maxHp = T.hp * D.hp * (1 + 0.05 * Math.max(0, (G.game ? G.game.wave : 1) - 1)); s.alive = true; s.active = true; s.rag = null; s.deadT = 0;
    s.vel.set(0, 0, 0); s.yaw = Math.atan2(-(pl.pos.x - s.pos.x), -(pl.pos.z - s.pos.z)); s.aimYaw = s.yaw; s.aimPitch = 0; s.aimK = 0; s.crouchK = 0; s.phase = rand(0, 6);
    s.state = T.perch && s.perch ? 'perch' : 'advance'; s.stateT = 0; s.senseT = rand(0, 0.2); s.canSee = false; s.chestVis = false; s.visT = 0; s.knows = true;
    s.lastSeen.copy(pl.pos).add(new V3(rand(-8, 8), 0, rand(-8, 8))); s.lastSeenT = G.t; s.path = null; s.pathI = 0; s.repathT = 0; s.goalKind = null;
    s.burst = 0; s.nextShot = G.t + rand(0.5, 1.5); s.ammo = T.mag; s.reloadT = 0; s.suppress = 0; s.flinch = 0; s.flashT = 0; s.cover = null; s.peekT = 0; s.hide = false;
    s.nadeT = G.t + rand(10, 20); s.throwT = 0; s.firstBurstDone = false; s.wantCrouch = 0; s.firedT = -9; s.stuckT = 0; s.stuckP.copy(s.pos); s.speed = 0; s.lastHitT = -9; s.laser = 0;
    s.gun = pick(T.guns); s.gunDef = WEAPONS[s.gun];
    const c = this._c, M = this.M, i = s.i;
    const tint = (m, hex, n = 1, jit = 0.06) => { c.setHex(hex); c.offsetHSL(0, 0, rand(-jit, jit)); for (let j = 0; j < n; j++) m.setColorAt(i * n + j, c); m.instanceColor.needsUpdate = true; };
    tint(M.torso, T.tint); tint(M.hips, T.tint); tint(M.uarm, T.tint, 2); tint(M.farm, T.tint, 2); tint(M.thigh, T.tint, 2); tint(M.shin, T.tint, 2);
    tint(M.vest, T.vest); tint(M.helmet, T.helmet); tint(M.head, T.head, 1, 0.03);
    for (const id of GUNS) this.GM[id].setMatrixAt(i, ZERO);
    if (!this.list.includes(s)) this.list.push(s);
    this._pose(s, 0);
    return s;
  }
  _retire(s) {
    s.active = false; s.alive = false; s.rag = null; this._hide(s);
    const k = this.list.indexOf(s); if (k >= 0) this.list.splice(k, 1);
    const j = this.deadOrder.indexOf(s); if (j >= 0) this.deadOrder.splice(j, 1);
  }

  // ---------------------------------------------------------------- hits, damage and death
  rayHit(o, d, maxT) {
    let best = maxT, hit = null;
    for (const s of this.list) {
      if (!s.alive) continue;
      const cx = s.pos.x - o.x, cy = s.pos.y + 0.9 * s.sc - o.y, cz = s.pos.z - o.z, tc = cx * d.x + cy * d.y + cz * d.z;
      if (tc < -1.2 || tc - 1.3 > best) continue;
      if (cx * cx + cy * cy + cz * cz - tc * tc > 1.5 * 1.5) continue;
      const J = s.J, b = s.bulk;
      const test = (t, part) => { if (t > 0 && t < best) { best = t; hit = { s, t, part }; } };
      test(raySphere(o, d, J[2], 0.13 * s.sc), 'head');
      test(rayCapsule(o, d, J[0], J[1], 0.19 * b), 'torso');
      for (const [a, c, r, part] of [[3, 4, 0.07, 'arm'], [4, 5, 0.06, 'arm'], [6, 7, 0.07, 'arm'], [7, 8, 0.06, 'arm'], [9, 10, 0.095, 'leg'], [10, 11, 0.075, 'leg'], [12, 13, 0.095, 'leg'], [13, 14, 0.075, 'leg']]) test(rayCapsule(o, d, J[a], J[c], r * s.sc), part);
    }
    return hit;
  }
  hurt(s, amount, dir, part, kind = 'bullet', force = 5) {
    if (!s.alive) return false;
    if (s.def.armored && kind === 'bullet') amount *= part === 'head' ? 0.75 : 0.85;
    s.hp -= amount; s.lastHitT = G.t; s.flinch = Math.min(1, s.flinch + (s.def.armored ? 0.15 : 0.6)); s.knows = true;
    s.lastSeen.copy(G.player.pos); s.lastSeenT = G.t; s.suppress = Math.min(1, s.suppress + 0.4);
    if (s.state === 'cover' && !s.hide && Math.random() < 0.5) { s.hide = true; s.peekT = rand(0.8, 1.6); }
    if (s.hp <= 0) { this._die(s, dir, part, kind, force); return true; }
    return false;
  }
  _die(s, dir, part, kind, force) {
    s.alive = false; s.deadT = 0; if (s.cover) { s.cover.taken = null; s.cover = null; }
    const hitJ = part === 'head' ? 2 : part === 'leg' ? 10 : part === 'arm' ? 7 : 1;
    this._ragdoll(s, dir, force, hitJ);
    // drop the weapon where the hands were
    if (G.pickups) { const gp = this._t.setFromMatrixPosition(s.gunM); G.pickups.drop(s.gun, gp, s.aimYaw, s.vel); }
    for (const id of GUNS) this.GM[id].setMatrixAt(s.i, ZERO);
    this.deadOrder.push(s);
    if (G.game) G.game.onKill(s, part, kind);
  }
  _ragdoll(s, dir, force, hitJ) {
    const P = s.J.map((v) => v.clone()), Q = [], h = 1 / 60;
    for (let k = 0; k < 15; k++) {
      const w = k === hitJ ? 1 : k === 0 || k === 1 ? 0.6 : 0.35;
      Q.push(P[k].clone().addScaledVector(s.vel, -h).addScaledVector(dir, -force * w * h).add(new V3(0, -force * 0.15 * w * h, 0)));
    }
    const C = LINKS.map(([a, b]) => [a, b, P[a].distanceTo(P[b])]);
    s.rag = { P, Q, C, acc: 0, t: 0, sleep: false, still: 0, gnd: new Float32Array(15) };
  }
  // explosion / external impulse on a ragdoll
  push(s, from, strength) {
    if (!s.rag) return;
    for (let k = 0; k < 15; k++) { const p = s.rag.P[k], d = this._t.subVectors(p, from); const L = Math.max(0.5, d.length()); d.multiplyScalar(strength / (L * L) / 60); d.y += strength * 0.25 / (L * L) / 60; s.rag.Q[k].sub(d); }
    s.rag.sleep = false; s.rag.still = 0;
  }
  flash(s, amount) { if (!s.alive) return; s.flashT = Math.max(s.flashT, 4.5 * amount); s.burst = 0; s.knows = true; }
  hearShot(o, suppressed) {
    const R = suppressed ? 12 : 75;
    for (const s of this.list) if (s.alive && s.pos.distanceTo(o) < R) { s.knows = true; s.lastSeen.copy(G.player.pos).add(this._t.set(rand(-3, 3), 0, rand(-3, 3))); s.lastSeenT = Math.max(s.lastSeenT, G.t - 1); }
  }
  // the player's bullets passing close by make soldiers flinch and take cover
  nearMiss(o, d, len) {
    for (const s of this.list) { if (!s.alive) continue; if (segDist(o, d, len, s.J[2]) < 1.6) { s.suppress = Math.min(1, s.suppress + 0.25); s.knows = true; if (s.state === 'cover' && !s.hide && Math.random() < 0.25) { s.hide = true; s.peekT = rand(0.6, 1.2); } } }
  }

  // ---------------------------------------------------------------- per-frame
  update(dt) {
    this.pathBudget = 2;
    for (const s of this.list) { if (s.alive) this._think(s, dt); }
    // separation between soldiers and from the player
    const pl = G.player;
    for (let a = 0; a < this.list.length; a++) {
      const A = this.list[a]; if (!A.alive) continue;
      for (let b = a + 1; b < this.list.length; b++) {
        const B = this.list[b]; if (!B.alive || Math.abs(A.pos.y - B.pos.y) > 1.2) continue;
        const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.7 && d > 1e-4) { const k = (0.7 - d) / d * 0.5; A.pos.x -= dx * k; A.pos.z -= dz * k; B.pos.x += dx * k; B.pos.z += dz * k; }
      }
      if (pl.alive && Math.abs(A.pos.y - pl.pos.y) < 1.5) {
        const dx = A.pos.x - pl.pos.x, dz = A.pos.z - pl.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.65 && d > 1e-4) { const k = (0.65 - d) / d; A.pos.x += dx * k * 0.7; A.pos.z += dz * k * 0.7; pl.pos.x -= dx * k * 0.3; pl.pos.z -= dz * k * 0.3; }
      }
    }
    for (const s of this.list) {
      if (s.alive) { G.world.resolve(s.pos, 0.3, 1.7 * s.sc, 0.5); this._pose(s, dt); }
      else this._ragUpdate(s, dt);
    }
    // corpses: keep the newest few
    while (this.deadOrder.length > 12) this._retire(this.deadOrder[0]);
    this._render();
    this._marksmen(dt);
  }

  // ---------------------------------------------------------------- AI
  _sense(s) {
    const pl = G.player, W = G.world; s.canSee = false; s.chestVis = false;
    if (!pl.alive || s.flashT > 0) return;
    const eye = this._t.copy(s.J[2]); eye.y += 0.05;
    const head = G.camera.position, dx = head.x - eye.x, dz = head.z - eye.z, dy = head.y - eye.y, dist = Math.hypot(dx, dy, dz);
    if (dist > (s.def.perch ? 140 : 95)) return;
    const fwdx = -Math.sin(s.aimYaw), fwdz = -Math.cos(s.aimYaw), cosA = (dx * fwdx + dz * fwdz) / Math.max(0.01, Math.hypot(dx, dz));
    const aware = G.t - s.lastSeenT < 3 || G.t - s.lastHitT < 3;
    if (!aware && cosA < -0.2 && dist > 6) return;
    const headVis = W.clear(eye, head), chestVis = W.clear(eye, pl.chest);
    if (!headVis && !chestVis) return;
    // prone players are hard to spot at range
    if (pl.stance === 'prone' && dist > 30 && !aware && Math.random() < 0.6) return;
    s.canSee = true; s.chestVis = chestVis; s.knows = true; s.lastSeen.copy(pl.pos); s.lastSeenT = G.t;
  }
  _think(s, dt) {
    const T = s.def, pl = G.player, t = G.t;
    s.stateT += dt; s.senseT -= dt; s.repathT -= dt;
    if (s.senseT <= 0) { s.senseT = rand(0.14, 0.24); this._sense(s); }
    s.visT = s.canSee ? s.visT + dt : Math.max(0, s.visT - dt * 2);
    s.suppress = Math.max(0, s.suppress - dt * 0.3); s.flinch = damp(s.flinch, 0, 5, dt);
    if (s.flashT > 0) s.flashT -= dt;
    if (s.reloadT > 0) { s.reloadT -= dt; if (s.reloadT <= 0) s.ammo = T.mag; }
    if (s.throwT > 0) s.throwT -= dt;
    // survival hunters always drift toward the player's position
    if (!s.canSee && t - s.lastSeenT > 6) { s.lastSeen.copy(pl.pos).add(this._t.set(rand(-5, 5), 0, rand(-5, 5))); s.lastSeenT = t - 3; }
    const dx = pl.pos.x - s.pos.x, dz = pl.pos.z - s.pos.z, dist = Math.hypot(dx, dz);
    let moveTo = null, speed = 0, crouch = 0, aim = s.canSee;
    // ---------- behaviour ----------
    if (s.flashT > 0) { speed = 0; aim = false; }
    else if (T.perch && s.state === 'perch') {
      crouch = s.canSee ? 0 : 0.6;
    } else if (T.rush) {
      if (dist > 3.5 || !s.canSee) { moveTo = s.canSee || dist < 30 ? pl.pos : s.lastSeen; speed = s.canSee && dist < 12 ? T.walk * 1.3 : T.run; }
    } else if (T.armored) {
      if (!(s.canSee && dist < 11)) { moveTo = s.canSee ? pl.pos : s.lastSeen; speed = T.walk; }
    } else {
      // rifleman: find cover facing the player, then peek and shoot
      if (s.state === 'advance') {
        const cv = s.cover, cpx = cv ? pl.pos.x - cv.x : 0, cpz = cv ? pl.pos.z - cv.z : 0, cd = Math.hypot(cpx, cpz) || 1, bad = cv && ((cv.dx * cpx + cv.dz * cpz) / cd < 0.3 || cd < 6);
        if (!cv || bad || (s.stateT > 9 && Math.random() < 0.01)) { const c = this._pickCover(s); if (cv && (c || bad)) { cv.taken = null; s.cover = null; } if (c) { s.cover = c; c.taken = s; s.path = null; s.repathT = 0; s.stateT = 0; } }
        if (s.cover) {
          moveTo = this._g.set(s.cover.x, s.cover.y, s.cover.z); speed = s.canSee ? T.walk * 1.2 : T.run;
          if (Math.hypot(s.cover.x - s.pos.x, s.cover.z - s.pos.z) < 0.45) { s.state = 'cover'; s.stateT = 0; s.hide = Math.random() < 0.5; s.peekT = rand(0.8, 2); s.noSeeT = 0; }
        } else {
          moveTo = s.lastSeen; speed = s.canSee ? T.walk : T.run;
          if (s.canSee && dist < 26) { s.state = 'engage'; s.stateT = 0; s.engageFor = rand(2, 4); s.engCrouch = Math.random() < 0.5 ? 1 : 0; }
        }
        if (s.canSee && dist < 7 && !s.cover) { s.state = 'engage'; s.stateT = 0; s.engageFor = rand(1.5, 3); s.engCrouch = 0; }
      } else if (s.state === 'engage') {
        crouch = s.engCrouch; if (s.stateT > s.engageFor) { s.state = 'advance'; s.stateT = 0; }
        if (!s.canSee && s.stateT > 1.2) { s.state = 'advance'; s.stateT = 0; }
      } else if (s.state === 'cover') {
        const c = s.cover;
        if (!c) { s.state = 'advance'; }
        else {
          moveTo = Math.hypot(c.x - s.pos.x, c.z - s.pos.z) > 0.3 ? this._g.set(c.x, c.y, c.z) : null; speed = T.walk;
          s.peekT -= dt;
          if (s.peekT <= 0) { s.hide = !s.hide; s.peekT = s.hide ? rand(1, 2.4) * (1 + s.suppress) : rand(1.8, 3.8); }
          if (s.reloadT > 0) s.hide = true;
          crouch = s.hide ? 1 : (c.high ? 0 : 0);
          aim = !s.hide && s.canSee;
          // flanked, player too close, or nothing to shoot at: move on
          const facing = (c.dx * dx + c.dz * dz) / Math.max(dist, 0.01);
          s.noSeeT = !s.hide && !s.canSee ? (s.noSeeT || 0) + dt : 0;
          if (facing < 0.15 || dist < 5 || s.noSeeT > 3.5 || s.stateT > 22) { c.taken = null; s.cover = null; s.state = 'advance'; s.stateT = 0; }
        }
      }
      // grenades flush out campers
      if (T.nades && t > s.nadeT && t > this.nadeT && pl.stationaryT > 5 && dist > 9 && dist < 34 && s.knows && G.throwables && !s.hide) {
        s.nadeT = t + rand(16, 28);
        if (Math.random() < 0.55) { this.nadeT = t + rand(6, 11); this._throw(s); }
      }
    }
    if (s.flinch > 0.5 && !T.armored) speed *= 0.4;
    // ---------- movement ----------
    s.moving = false;
    if (moveTo && speed > 0) this._move(s, dt, moveTo, speed);
    else { s.vel.x = damp(s.vel.x, 0, 10, dt); s.vel.z = damp(s.vel.z, 0, 10, dt); s.pos.x += s.vel.x * dt; s.pos.z += s.vel.z * dt; }
    const gy = G.world.groundAt(s.pos.x, s.pos.z, s.pos.y + 0.1, 0.22, 0.5);
    s.pos.y = gy > s.pos.y ? damp(s.pos.y, gy, 18, dt) : Math.max(gy, s.pos.y - 9 * dt);
    s.crouchK = damp(s.crouchK, crouch, 7, dt);
    // ---------- facing / aiming ----------
    let tYaw = s.aimYaw, tPitch = 0;
    if (aim || (s.state === 'cover' && !s.hide) || (T.perch && s.state === 'perch')) {
      const tgt = s.canSee ? pl.chest : this._t2.copy(s.lastSeen).setY(s.lastSeen.y + 1.2);
      const ax = tgt.x - s.J[1].x, ay = tgt.y - s.J[1].y, az = tgt.z - s.J[1].z;
      tYaw = Math.atan2(-ax, -az); tPitch = Math.atan2(ay, Math.hypot(ax, az));
    } else if (s.moving) { tYaw = Math.atan2(-s.vel.x, -s.vel.z); }
    const turn = (s.canSee ? 5.5 : 4) * dt; let dy = wrapAngle(tYaw - s.aimYaw);
    s.aimYaw += clamp(dy, -turn, turn); s.aimPitch = damp(s.aimPitch, tPitch, 8, dt); s.yaw = s.aimYaw;
    const wantAim = (aim || (s.state === 'cover' && !s.hide && s.canSee) || (s.state === 'engage')) && s.flashT <= 0 && s.throwT <= 0;
    s.aimK = damp(s.aimK, wantAim ? 1 : 0, wantAim ? 9 : 5, dt);
    // ---------- shooting ----------
    this._shoot(s, dt, dist);
  }
  _pickCover(s) {
    const nav = G.nav, pl = G.player.pos; if (!nav || !nav.cover) return null;
    let best = null, bs = -1e9;
    for (const c of nav.cover) {
      if (c.taken && c.taken !== s) continue;
      if (c.y > 0.6) continue;
      const dpx = pl.x - c.x, dpz = pl.z - c.z, dp = Math.hypot(dpx, dpz);
      if (dp < 7 || dp > 34) continue;
      const facing = (c.dx * dpx + c.dz * dpz) / dp; if (facing < 0.5) continue;
      const ds = Math.hypot(c.x - s.pos.x, c.z - s.pos.z); if (ds > 28) continue;
      let sc = facing * 3 - ds * 0.22 - Math.abs(dp - 17) * 0.12 + (c.high ? -2 : 0) + Math.random() * 1.6;
      for (const o of this.list) if (o !== s && o.alive && o.cover && Math.hypot(o.cover.x - c.x, o.cover.z - c.z) < 3) sc -= 3;
      if (sc > bs) { bs = sc; best = c; }
    }
    return best;
  }
  _move(s, dt, to, speed) {
    const nav = G.nav;
    const goalMoved = !s.path || s.goal.distanceTo(to) > (s.def.rush ? 1.5 : 3);
    if ((goalMoved || s.repathT <= 0) && this.pathBudget > 0) {
      this.pathBudget--; s.goal.copy(to); s.repathT = rand(2.5, 4) * (s.def.rush ? 0.5 : 1);
      s.path = nav ? nav.path(s.pos, to, 6000) : [{ x: to.x, y: to.y, z: to.z }]; s.pathI = 1;
      if (!s.path || s.path.length < 1) s.path = [{ x: to.x, y: to.y, z: to.z }];
    }
    if (!s.path) return;
    let tgt = s.path[Math.min(s.pathI, s.path.length - 1)];
    if (Math.hypot(tgt.x - s.pos.x, tgt.z - s.pos.z) < 0.4 && s.pathI < s.path.length - 1) { s.pathI++; tgt = s.path[s.pathI]; }
    const dx = tgt.x - s.pos.x, dz = tgt.z - s.pos.z, d = Math.hypot(dx, dz);
    const last = s.pathI >= s.path.length - 1;
    let vx = 0, vz = 0;
    if (d > 0.15 || !last) { const sp = last ? Math.min(speed, d * 3) : speed; vx = (dx / Math.max(d, 1e-3)) * sp; vz = (dz / Math.max(d, 1e-3)) * sp; s.moving = sp > 0.4; }
    s.vel.x = damp(s.vel.x, vx, 8, dt); s.vel.z = damp(s.vel.z, vz, 8, dt);
    s.pos.x += s.vel.x * dt; s.pos.z += s.vel.z * dt;
    // stuck: try a detour
    s.stuckT += dt;
    if (s.stuckT > 1.6) { if (s.moving && s.pos.distanceTo(s.stuckP) < 0.35) { const r = nav && nav.randomNear(s.pos.x, s.pos.z, 5, 1.5); if (r) { s.path = [{ x: s.pos.x, y: s.pos.y, z: s.pos.z }, r]; s.pathI = 1; s.repathT = 1.2; } } s.stuckT = 0; s.stuckP.copy(s.pos); }
  }
  _throw(s) {
    const pl = G.player, from = s.J[2].clone().add(UP), to = this._t2.copy(pl.pos).add(new V3(rand(-1.8, 1.8), 0, rand(-1.8, 1.8)));
    const dx = to.x - from.x, dy = to.y + 0.2 - from.y, dz = to.z - from.z, dist = Math.hypot(dx, dz), T = clamp(dist / 13, 0.9, 1.9), g = 9.8;
    const v = new V3(dx / T, dy / T + 0.5 * g * T, dz / T);
    s.throwT = 0.6;
    setTimeout(() => { if (s.alive && G.throwables && G.game && G.game.running) G.throwables.throwNade('frag', from, v, rand(0.3, 0.8), 'enemy'); }, 350);
    if (G.ui) G.ui.sub('<em>Hostile:</em> Grenade out!', 1.6);
  }
  _shoot(s, dt, dist) {
    const T = s.def, pl = G.player, t = G.t, D = DIFF[settings.difficulty] || DIFF.regular;
    s.laser = 0;
    if (!s.canSee || !pl.alive || s.flashT > 0 || s.reloadT > 0 || s.aimK < 0.8 || s.throwT > 0 || (s.state === 'cover' && s.hide)) return;
    if (dist > T.range * 1.35) return;
    const yawTo = Math.atan2(-(pl.pos.x - s.pos.x), -(pl.pos.z - s.pos.z)); if (Math.abs(wrapAngle(yawTo - s.aimYaw)) > 0.3) return;
    if (T.perch) s.laser = clamp(s.visT / (T.settle * D.react), 0, 1);
    if (s.visT < (T.perch ? T.settle : 0.35) * D.react) return;
    if (t < s.nextShot) return;
    if (s.burst <= 0) { s.burst = randInt(T.burst[0], T.burst[1]); if (!s.firstBurstDone) { s.firstBurstDone = true; } else { s.nextShot = t + rand(T.pause[0], T.pause[1]) * D.react; return; } }
    s.burst--; s.ammo--; s.nextShot = t + (60 / T.rpm) * rand(0.95, 1.12); s.firedT = t;
    if (s.ammo <= 0) { s.reloadT = T.perch ? 3 : 2.6; s.burst = 0; if (s.state === 'cover') s.hide = true; }
    const mz = s.muzzle, tgt = pl.chest, dd = mz.distanceTo(tgt);
    let p = T.acc * D.acc * clamp(1.25 - dd / T.range, 0.12, 1.1) * clamp(s.visT / Math.max(T.settle, 0.01), 0.3, 1);
    p *= pl.sprinting ? 0.55 : pl.speed2d > 2.2 ? 0.78 : 1;
    p *= pl.stance === 'prone' ? 0.6 : pl.stance === 'crouch' ? 0.85 : 1;
    p *= (1 - s.suppress * 0.5) * (s.moving ? 0.7 : 1) * (s.chestVis ? 1 : 0.45);
    if (G.game) { if (G.game.graceT > 0) p *= 0.3; p *= Math.min(1, 0.66 + 0.07 * G.game.wave); }  // early waves ease you in
    const hit = Math.random() < p;
    // effects and sound
    const far = dd > 45;
    G.fx.flash(mz, T.armored ? 1 : 0.8); if (!far) G.fx.light(mz, 0xffaa55, 3.5, 0.05, 8);
    if (G.audio && dd < 110) G.audio.gun(s.gunDef.sound, mz, {});
    const aimP = this._t.copy(tgt);
    if (!hit) { const k = clamp(dd * 0.05, 0.5, 1.8); aimP.x += rand(-1, 1) * k; aimP.y += rand(-0.6, 1.2) * k; aimP.z += rand(-1, 1) * k; }
    const dir = this._t2.subVectors(aimP, mz).normalize();
    if (hit) {
      pl.damage(T.dmg * D.dmg * (s.gun === 'm88' ? clamp(2.4 - dd / 8, 0.4, 2.2) : 1), s.pos);
      if (Math.random() < 0.6) G.fx.tracer(mz, dir, dd, 420, 3, [1, 0.7, 0.4]);
    } else {
      const h = G.world.raycast(mz, dir, 140);
      const L = h ? h.t : 140;
      if (h) { const n = { x: h.nx, y: h.ny, z: h.nz }, pt = { x: h.x, y: h.y, z: h.z }, surf = h.solid.surf; if (pl.pos.distanceTo(pt) < 45) { G.fx.impact(surf, pt, n, 0.8); G.fx.decal(surf === 'metal' ? 'holeMetal' : 'hole', pt, n, 0.09); if (G.audio) G.audio.impact(surf, pt); } }
      if (Math.random() < 0.55) G.fx.tracer(mz, dir, L, 420, 3, [1, 0.7, 0.4]);
      const cam = G.camera.position;
      if (segDist(mz, dir, L, cam) < 2.2 && G.audio) { G.audio.whiz(this._t.copy(cam).addScaledVector(dir, 0.5)); if (G.ui) G.ui.suppress(0.25); }
    }
  }

  // ---------------------------------------------------------------- pose
  _pose(s, dt) {
    const J = s.J, sc = s.sc, T = s.def;
    const sy = Math.sin(s.yaw), cy = Math.cos(s.yaw), Fx = -sy, Fz = -cy, Rx = cy, Rz = -sy;
    s.R.set(Rx, 0, Rz);
    const px = s.pos.x, py = s.pos.y, pz = s.pos.z;
    const L = (o, x, y, z) => o.set(px + (Rx * x + Fx * z) * sc, py + y * sc, pz + (Rz * x + Fz * z) * sc);
    const v = Math.hypot(s.vel.x, s.vel.z); s.speed = v;
    const run = clamp((v - 1.6) / 3, 0, 1), walkK = clamp(v / 1.0, 0, 1), cyc = lerp(1.5, 2.4, run) * sc;
    s.phase += (Math.PI * 2 * v * dt) / cyc;
    let mx = 0, mz = 1; if (v > 0.15) { mx = (s.vel.x * Rx + s.vel.z * Rz) / v; mz = (s.vel.x * Fx + s.vel.z * Fz) / v; }
    const c = s.crouchK, A = (cyc / sc) / 4 * walkK, lift = lerp(0.1, 0.2, run) * walkK;
    const bob = 0.035 * walkK * Math.abs(Math.sin(s.phase));
    const pelY = lerp(0.98, 0.64, c) - bob, pelZ = -c * 0.04, lean = 0.05 + run * 0.2 + c * 0.3 - s.flinch * 0.45 + (s.flashT > 0 ? 0.25 : 0);
    L(J[0], 0, pelY, pelZ);
    const chY = pelY + SPINE * Math.cos(lean), chZ = pelZ + SPINE * Math.sin(lean);
    L(J[1], 0, chY, chZ);
    L(J[2], 0, chY + NECK, chZ + 0.03 + Math.sin(s.aimPitch) * 0.03);
    L(J[3], -0.18, chY - 0.03, chZ - 0.01); L(J[6], 0.18, chY - 0.03, chZ - 0.01);
    L(J[9], -0.1, pelY - 0.05, pelZ); L(J[12], 0.1, pelY - 0.05, pelZ);
    // legs
    const pole = this._pole;
    for (let side = -1; side <= 1; side += 2) {
      const hip = side < 0 ? 9 : 12, knee = hip + 1, foot = hip + 2, ph = s.phase + (side < 0 ? 0 : Math.PI);
      const sn = Math.sin(ph), cs = Math.cos(ph);
      const bx = side * lerp(0.12, 0.17, c), bz = side < 0 ? c * 0.2 : -c * 0.26;
      L(J[foot], bx + mx * A * sn, 0.09 + lift * Math.max(0, cs) + (side > 0 ? c * 0.02 : 0), bz + mz * A * sn);
      pole.set(Fx + Rx * side * 0.2, 0, Fz + Rz * side * 0.2);
      ik(J[hip], J[foot], THIGH * sc, SHIN * sc, pole, J[knee], J[foot]);
    }
    // weapon and arms
    const ay = s.aimYaw, ap = s.aimPitch, cp = Math.cos(ap), a = s.aimK;
    const D = this._D.set(-Math.sin(ay) * cp, Math.sin(ap), -Math.cos(ay) * cp), Rw = this._Rw.set(Math.cos(ay), 0, -Math.sin(ay));
    const ly = ay + 0.5, lp = -0.72, Dl = this._Dl.set(-Math.sin(ly) * Math.cos(lp), Math.sin(lp), -Math.cos(ly) * Math.cos(lp));
    const Dg = this._Dg.copy(Dl).lerp(D, a).normalize();
    const ch = J[1], g = this._g2;
    if (T.hip) g.copy(ch).addScaledVector(Rw, 0.16 * sc).addScaledVector(UP, -0.2 * sc).addScaledVector(D, 0.2 * sc);
    else g.copy(ch).addScaledVector(Rw, 0.1 * sc).addScaledVector(UP, 0.03 * sc).addScaledVector(D, 0.2 * sc);
    const gx = g.x, gyy = g.y, gz = g.z;
    g.copy(ch).addScaledVector(Rw, 0.08 * sc).addScaledVector(UP, -0.22 * sc); g.x += Fx * 0.22 * sc; g.z += Fz * 0.22 * sc;
    g.set(lerp(g.x, gx, a), lerp(g.y, gyy, a), lerp(g.z, gz, a));
    const right = this._r.crossVectors(Dg, UP).normalize(), up = this._up.crossVectors(right, Dg);
    s.gunM.set(right.x * sc, up.x * sc, -Dg.x * sc, g.x, right.y * sc, up.y * sc, -Dg.y * sc, g.y, right.z * sc, up.z * sc, -Dg.z * sc, g.z, 0, 0, 0, 1);
    const info = this.gunInfo[s.gun], f = info.fore, m = info.muzzle;
    const rh = this._t.copy(g).addScaledVector(up, -0.05 * sc).addScaledVector(Dg, -0.035 * sc);
    pole.copy(UP).multiplyScalar(-1).addScaledVector(Rw, 0.7).addScaledVector(D, -0.2);
    ik(J[6], rh, UARM * sc, FARM * sc, pole, J[7], J[8]);
    const lh = this._t2.copy(g).addScaledVector(right, f.x * sc).addScaledVector(up, f.y * sc).addScaledVector(Dg, -f.z * sc);
    if (s.flashT > 0) lh.copy(J[2]).addScaledVector(D, 0.12).addScaledVector(Rw, -0.04);
    if (s.throwT > 0) { const k = Math.sin(clamp(1 - s.throwT / 0.6, 0, 1) * Math.PI); lh.copy(J[3]).addScaledVector(UP, 0.25 * k + 0.05).addScaledVector(D, 0.1 + 0.3 * k).addScaledVector(Rw, -0.1); }
    pole.copy(UP).multiplyScalar(-1).addScaledVector(Rw, -0.6);
    ik(J[3], lh, UARM * sc, FARM * sc, pole, J[4], J[5]);
    s.muzzle.copy(g).addScaledVector(right, m.x * sc).addScaledVector(up, m.y * sc).addScaledVector(Dg, -m.z * sc);
    s.chest.copy(J[0]).lerp(J[1], 0.65);
  }

  // ---------------------------------------------------------------- ragdolls
  _ragUpdate(s, dt) {
    const r = s.rag; if (!r) return;
    r.t += dt; s.deadT += dt;
    if (r.sleep) return;
    r.acc = Math.min(r.acc + dt, 0.05); const h = 1 / 60, W = G.world, P = r.P, Q = r.Q;
    while (r.acc >= h) {
      r.acc -= h; let motion = 0;
      for (let k = 0; k < 15; k++) {
        const p = P[k], q = Q[k], vx = (p.x - q.x) * 0.992, vy = (p.y - q.y) * 0.992, vz = (p.z - q.z) * 0.992;
        motion += Math.abs(vx) + Math.abs(vy) + Math.abs(vz);
        q.copy(p); p.x += vx; p.y += vy - 13 * h * h; p.z += vz;
        r.gnd[k] = W.groundAt(p.x, p.z, p.y + 0.12, 0.04, 0.35);
      }
      for (let it = 0; it < 6; it++) {
        for (const [a, b, len] of r.C) {
          const A = P[a], B = P[b], dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, d = Math.hypot(dx, dy, dz) || 1e-5, k = (d - len) / d * 0.5;
          A.x += dx * k; A.y += dy * k; A.z += dz * k; B.x -= dx * k; B.y -= dy * k; B.z -= dz * k;
        }
        for (const [a, b, len] of MINL) {
          const A = P[a], B = P[b], dx = B.x - A.x, dy = B.y - A.y, dz = B.z - A.z, d = Math.hypot(dx, dy, dz) || 1e-5; if (d >= len) continue;
          const k = (d - len) / d * 0.5; A.x += dx * k; A.y += dy * k; A.z += dz * k; B.x -= dx * k; B.y -= dy * k; B.z -= dz * k;
        }
        for (let k = 0; k < 15; k++) { const p = P[k], g = r.gnd[k] + (k === 2 ? 0.11 : k === 0 || k === 1 ? 0.12 : 0.06); if (p.y < g) { p.y = g; const q = Q[k]; q.x = p.x - (p.x - q.x) * 0.6; q.z = p.z - (p.z - q.z) * 0.6; } }
      }
      for (let k = 0; k < 15; k += 1) { const p = P[k], t = this._t.set(p.x, p.y - 0.06, p.z); if (W.resolve(t, 0.07, 0.12, 0.02)) { p.x = t.x; p.z = t.z; } }
      r.still = motion < 0.02 ? r.still + h : 0;
      if (r.still > 0.6 || r.t > 8) { r.sleep = true; break; }
    }
  }

  // ---------------------------------------------------------------- rendering
  _render() {
    const M = this.M;
    for (const s of this.list) {
      const i = s.i, J = s.rag ? s.rag.P : s.J, sc = s.sc, b = s.bulk;
      let R = s.R; if (s.rag) { R = this._r.subVectors(J[6], J[3]).normalize(); }
      // sink old corpses into the ground before they're recycled
      const sink = s.rag && s.deadT > 30 ? Math.min(1, (s.deadT - 30) / 3) : 0;
      if (sink >= 1) { this._retire(s); continue; }
      seg(M.torso, i, J[0], J[1], R, SPINE * sc, b);
      seg(M.hips, i, J[0], J[1], R, SPINE * sc, b, false);
      seg(M.vest, i, J[0], J[1], R, SPINE * sc, b * 1.02);
      seg(M.head, i, J[1], J[2], R, NECK * sc, sc, false);
      seg(M.helmet, i, J[1], J[2], R, NECK * sc, sc * (s.def.armored ? 1.1 : 1), false);
      seg(M.uarm, i * 2, J[3], J[4], R, UARM * sc, sc); seg(M.uarm, i * 2 + 1, J[6], J[7], R, UARM * sc, sc);
      seg(M.farm, i * 2, J[4], J[5], R, FARM * sc, sc); seg(M.farm, i * 2 + 1, J[7], J[8], R, FARM * sc, sc);
      seg(M.hand, i * 2, J[4], J[5], R, FARM * sc, sc); seg(M.hand, i * 2 + 1, J[7], J[8], R, FARM * sc, sc);
      seg(M.thigh, i * 2, J[9], J[10], R, THIGH * sc, sc * (s.def.armored ? 1.15 : 1)); seg(M.thigh, i * 2 + 1, J[12], J[13], R, THIGH * sc, sc * (s.def.armored ? 1.15 : 1));
      seg(M.shin, i * 2, J[10], J[11], R, SHIN * sc, sc); seg(M.shin, i * 2 + 1, J[13], J[14], R, SHIN * sc, sc);
      if (s.alive) {
        const up = this._t2.copy(J[11]); up.y += SHIN; seg(M.boot, i * 2, J[11], up, R, SHIN, sc, false);
        up.copy(J[14]); up.y += SHIN; seg(M.boot, i * 2 + 1, J[14], up, R, SHIN, sc, false);
        this.GM[s.gun].setMatrixAt(i, s.gunM);
      } else { seg(M.boot, i * 2, J[11], J[10], R, SHIN, sc, false); seg(M.boot, i * 2 + 1, J[14], J[13], R, SHIN, sc, false); }
      if (sink > 0) for (const m of Object.values(M)) { const n = m.userData.n; for (let j = 0; j < n; j++) { m.getMatrixAt(i * n + j, _m); _m.elements[13] -= sink * 0.5; m.setMatrixAt(i * n + j, _m); } }
    }
    // only draw the slots that are in use
    let top = 0; for (const s of this.list) top = Math.max(top, s.i + 1);
    for (const m of Object.values(this.M)) { m.count = top * m.userData.n; m.instanceMatrix.needsUpdate = true; }
    for (const m of Object.values(this.GM)) { m.count = top; m.instanceMatrix.needsUpdate = true; }
  }
  _marksmen(dt) {
    let k = 0; const cam = G.camera;
    for (const s of this.list) {
      if (!s.alive || !s.def.perch || k >= this.lasers.length) continue;
      const l = this.lasers[k], gl = this.glints[k]; k++;
      const show = s.laser > 0.02 && s.canSee;
      l.visible = show; gl.visible = s.canSee && s.aimK > 0.6;
      if (show) {
        const pa = l.geometry.attributes.position, to = G.player.chest;
        const wob = (1 - s.laser) * 1.2;
        pa.setXYZ(0, s.muzzle.x, s.muzzle.y, s.muzzle.z); pa.setXYZ(1, to.x + Math.sin(G.t * 3.1 + s.i) * wob, to.y + Math.cos(G.t * 2.3) * wob * 0.6, to.z + Math.cos(G.t * 2.7 + s.i) * wob);
        pa.needsUpdate = true; l.material.opacity = 0.35 + s.laser * 0.55;
      }
      if (gl.visible) {
        const p = this._t.copy(s.J[2]).addScaledVector(this._D.set(-Math.sin(s.aimYaw), 0, -Math.cos(s.aimYaw)), 0.25); p.y -= 0.04;
        gl.position.copy(p); const d = cam.position.distanceTo(p); gl.scale.setScalar(clamp(d * 0.02, 0.3, 2.4) * (0.75 + 0.25 * Math.sin(G.t * 9)));
      }
    }
    for (; k < this.lasers.length; k++) { this.lasers[k].visible = false; this.glints[k].visible = false; }
  }
}

function mergeAll(list) {
  // merge a few simple geometries (all indexed or not) into one
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0;
  for (const g of geos) { pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
