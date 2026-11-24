// World: collision (yaw-rotated boxes in a spatial hash), static geometry batching, and a 2.5D navigation grid with A* and cover points.
import * as THREE from 'three';
import { clamp } from './core.js';
import { MAT, UVS, SURF } from './textures.js';

const GROUND = { surf: 'dirt', mat: 'dirt', flags: {}, ground: true };

export class World {
  constructor(bound = 56.5) {
    this.solids = []; this.cs = 4; this.cells = new Map(); this.stampN = 0; this.B = bound;
    this._qa = []; this._qb = []; this._qc = [];
    this.hit = { t: 0, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, solid: null, exit: 0 };
  }
  _key(ix, iz) { return (ix + 1024) * 4096 + (iz + 1024); }
  add(x, y0, z, w, h, d, yaw = 0, mat = 'concrete', flags = {}) {
    const s = { x, z, y0, y1: y0 + h, hx: w / 2, hz: d / 2, c: Math.cos(yaw), s: Math.sin(yaw), yaw, mat, surf: SURF[mat] || 'concrete', flags,
      r: Math.hypot(w / 2, d / 2), stamp: 0, id: this.solids.length, alive: true };
    this.solids.push(s);
    const cs = this.cs, ix0 = Math.floor((x - s.r) / cs), ix1 = Math.floor((x + s.r) / cs), iz0 = Math.floor((z - s.r) / cs), iz1 = Math.floor((z + s.r) / cs);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) { const k = this._key(ix, iz); let c = this.cells.get(k); if (!c) this.cells.set(k, (c = [])); c.push(s); }
    return s;
  }
  remove(s) { s.alive = false; }
  query(x, z, rad, out) {
    out.length = 0; const st = ++this.stampN, cs = this.cs;
    const ix0 = Math.floor((x - rad) / cs), ix1 = Math.floor((x + rad) / cs), iz0 = Math.floor((z - rad) / cs), iz1 = Math.floor((z + rad) / cs);
    for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) {
      const c = this.cells.get(this._key(ix, iz)); if (!c) continue;
      for (const s of c) if (s.alive && s.stamp !== st) { s.stamp = st; out.push(s); }
    }
    return out;
  }
  // signed distance squared from point to box footprint (0 when inside)
  static d2(s, x, z) { const dx = x - s.x, dz = z - s.z, lx = s.c * dx - s.s * dz, lz = s.s * dx + s.c * dz, ex = Math.max(Math.abs(lx) - s.hx, 0), ez = Math.max(Math.abs(lz) - s.hz, 0); return ex * ex + ez * ez; }
  static inside(s, x, z, m = 0) { const dx = x - s.x, dz = z - s.z, lx = s.c * dx - s.s * dz, lz = s.s * dx + s.c * dz; return Math.abs(lx) <= s.hx + m && Math.abs(lz) <= s.hz + m; }

  // push a vertical cylinder (feet at p.y) out of solids; returns true if it touched a wall
  resolve(p, r, h, stepH = 0.45) {
    const list = this.query(p.x, p.z, r + 1, this._qa); let hit = false;
    for (let it = 0; it < 2; it++) for (const s of list) {
      if (s.flags.ghost || p.y + h <= s.y0 || p.y >= s.y1 - 0.01 || s.y1 - p.y <= stepH) continue;
      const dx = p.x - s.x, dz = p.z - s.z, lx = s.c * dx - s.s * dz, lz = s.s * dx + s.c * dz;
      const cx = clamp(lx, -s.hx, s.hx), cz = clamp(lz, -s.hz, s.hz), ex = lx - cx, ez = lz - cz, d2 = ex * ex + ez * ez;
      if (d2 >= r * r) continue;
      let px = 0, pz = 0;
      if (d2 > 1e-10) { const d = Math.sqrt(d2), k = (r - d) / d; px = ex * k; pz = ez * k; }
      else { const pl = lx + s.hx + r, pr = s.hx - lx + r, pb = lz + s.hz + r, pf = s.hz - lz + r, m = Math.min(pl, pr, pb, pf); if (m === pl) px = -pl; else if (m === pr) px = pr; else if (m === pb) pz = -pb; else pz = pf; }
      p.x += s.c * px + s.s * pz; p.z += -s.s * px + s.c * pz; hit = true;
    }
    p.x = clamp(p.x, -this.B + r, this.B - r); p.z = clamp(p.z, -this.B + r, this.B - r);
    return hit;
  }
  groundAt(x, z, y, r = 0.3, stepH = 0.45) {
    let g = 0, gs = GROUND; const list = this.query(x, z, r + 1, this._qb), m = (r * 0.6) * (r * 0.6);
    for (const s of list) { if (s.flags.ghost || s.flags.noFloor || s.y1 > y + stepH || s.y1 <= g) continue; if (World.d2(s, x, z) < m) { g = s.y1; gs = s; } }
    this.groundSolid = gs; return g;
  }
  ceilingAt(x, z, y, r = 0.3) {
    let c = Infinity; const list = this.query(x, z, r + 1, this._qb);
    for (const s of list) { if (s.flags.ghost || s.y0 < y || s.y0 >= c) continue; if (World.d2(s, x, z) < r * r) c = s.y0; }
    return c;
  }
  _rayBox(s, o, d) {
    const ox = o.x - s.x, oz = o.z - s.z, lox = s.c * ox - s.s * oz, loz = s.s * ox + s.c * oz, ldx = s.c * d.x - s.s * d.z, ldz = s.s * d.x + s.c * d.z;
    let tmin = -Infinity, tmax = Infinity, ax = -1, sg = 0;
    if (Math.abs(ldx) < 1e-9) { if (lox < -s.hx || lox > s.hx) return false; }
    else { let t1 = (-s.hx - lox) / ldx, t2 = (s.hx - lox) / ldx, g = -1; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; g = 1; } if (t1 > tmin) { tmin = t1; ax = 0; sg = g; } if (t2 < tmax) tmax = t2; }
    if (Math.abs(d.y) < 1e-9) { if (o.y < s.y0 || o.y > s.y1) return false; }
    else { let t1 = (s.y0 - o.y) / d.y, t2 = (s.y1 - o.y) / d.y, g = -1; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; g = 1; } if (t1 > tmin) { tmin = t1; ax = 1; sg = g; } if (t2 < tmax) tmax = t2; }
    if (Math.abs(ldz) < 1e-9) { if (loz < -s.hz || loz > s.hz) return false; }
    else { let t1 = (-s.hz - loz) / ldz, t2 = (s.hz - loz) / ldz, g = -1; if (t1 > t2) { const t = t1; t1 = t2; t2 = t; g = 1; } if (t1 > tmin) { tmin = t1; ax = 2; sg = g; } if (t2 < tmax) tmax = t2; }
    if (tmax < tmin || tmin < 0) return false;
    this._te = tmin; this._tx = tmax; this._ax = ax; this._sg = sg; return true;
  }
  // nearest hit along a ray (d normalised). opts.glass=false skips glass (sight lines), opts.skip = solid to ignore
  raycast(o, d, maxT, opts = {}) {
    let best = maxT, bs = null, ax = 0, sg = 0, exit = 0;
    if (d.y < -1e-6) { const t = -o.y / d.y; if (t > 0 && t < best) { best = t; bs = GROUND; ax = 1; sg = 1; exit = t + 0.02; } }
    const cs = this.cs, st = ++this.stampN, skipGlass = opts.glass === false, skip = opts.skip;
    let ix = Math.floor(o.x / cs), iz = Math.floor(o.z / cs);
    const sx = d.x > 0 ? 1 : -1, sz = d.z > 0 ? 1 : -1, adx = Math.abs(d.x), adz = Math.abs(d.z);
    const tdx = adx > 1e-9 ? cs / adx : Infinity, tdz = adz > 1e-9 ? cs / adz : Infinity;
    let tmx = adx > 1e-9 ? (d.x > 0 ? (ix + 1) * cs - o.x : o.x - ix * cs) / adx : Infinity, tmz = adz > 1e-9 ? (d.z > 0 ? (iz + 1) * cs - o.z : o.z - iz * cs) / adz : Infinity;
    let t = 0;
    for (let n = 0; n < 160 && t <= best; n++) {
      const c = this.cells.get(this._key(ix, iz));
      if (c) for (const s of c) {
        if (!s.alive || s.stamp === st) continue; s.stamp = st;
        if (s.flags.ghost || (skipGlass && s.flags.glass) || s === skip) continue;
        if (this._rayBox(s, o, d) && this._te < best) { best = this._te; bs = s; ax = this._ax; sg = this._sg; exit = this._tx; }
      }
      if (tmx < tmz) { t = tmx; tmx += tdx; ix += sx; } else { t = tmz; tmz += tdz; iz += sz; }
    }
    if (!bs) return null;
    const h = this.hit; h.t = best; h.x = o.x + d.x * best; h.y = o.y + d.y * best; h.z = o.z + d.z * best; h.solid = bs; h.exit = exit;
    if (bs === GROUND || ax === 1) { h.nx = 0; h.ny = sg; h.nz = 0; }
    else if (ax === 0) { h.nx = bs.c * sg; h.ny = 0; h.nz = -bs.s * sg; }
    else { h.nx = bs.s * sg; h.ny = 0; h.nz = bs.c * sg; }
    return h;
  }
  clear(a, b, glass = false) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, L = Math.hypot(dx, dy, dz); if (L < 1e-4) return true;
    const d = this._dd || (this._dd = { x: 0, y: 0, z: 0 }); d.x = dx / L; d.y = dy / L; d.z = dz / L;
    return !this.raycast(a, d, L - 0.05, { glass });
  }
}

// ------------------------------------------------------------------ static geometry batching
const FACES = [
  { k: 'px', n: [1, 0, 0], a: [0, 0, -1], b: [0, 1, 0] }, { k: 'nx', n: [-1, 0, 0], a: [0, 0, 1], b: [0, 1, 0] },
  { k: 'py', n: [0, 1, 0], a: [1, 0, 0], b: [0, 0, -1] }, { k: 'ny', n: [0, -1, 0], a: [1, 0, 0], b: [0, 0, 1] },
  { k: 'pz', n: [0, 0, 1], a: [1, 0, 0], b: [0, 1, 0] }, { k: 'nz', n: [0, 0, -1], a: [-1, 0, 0], b: [0, 1, 0] }
];
const CORNERS = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
const _m4 = new THREE.Matrix4(), _n3 = new THREE.Matrix3(), _v = new THREE.Vector3();

export class Builder {
  constructor(world) { this.world = world; this.B = new Map(); }
  _batch(mat, shadow) { const key = mat + (shadow ? '' : '#ns'); let b = this.B.get(key); if (!b) this.B.set(key, (b = { mat, shadow, p: [], n: [], u: [], i: [] })); return b; }
  // box with world-space texture coordinates (seamless across neighbouring boxes)
  box(x, y0, z, w, h, d, mat, o = {}) {
    if (w <= 0.001 || h <= 0.001 || d <= 0.001) return null;
    const yaw = o.yaw || 0, c = Math.cos(yaw), s = Math.sin(yaw), H = [w / 2, h / 2, d / 2], cy = y0 + h / 2, uvs = o.uv || UVS[mat] || 2;
    const b = this._batch(mat, o.shadow !== false);
    for (const F of FACES) {
      if (o.skip && o.skip.includes(F.k)) continue;
      const base = b.p.length / 3, n = F.n, A = F.a, Bv = F.b;
      const ha = Math.abs(A[0]) * H[0] + Math.abs(A[1]) * H[1] + Math.abs(A[2]) * H[2], hb = Math.abs(Bv[0]) * H[0] + Math.abs(Bv[1]) * H[1] + Math.abs(Bv[2]) * H[2], hn = Math.abs(n[0]) * H[0] + Math.abs(n[1]) * H[1] + Math.abs(n[2]) * H[2];
      const wa = [c * A[0] + s * A[2], A[1], -s * A[0] + c * A[2]], wb = [c * Bv[0] + s * Bv[2], Bv[1], -s * Bv[0] + c * Bv[2]];
      const wn = [c * n[0] + s * n[2], n[1], -s * n[0] + c * n[2]];
      for (const [sa, sb] of CORNERS) {
        const lx = n[0] * hn + A[0] * sa * ha + Bv[0] * sb * hb, ly = n[1] * hn + A[1] * sa * ha + Bv[1] * sb * hb, lz = n[2] * hn + A[2] * sa * ha + Bv[2] * sb * hb;
        const wx = x + c * lx + s * lz, wy = cy + ly, wz = z - s * lx + c * lz;
        b.p.push(wx, wy, wz); b.n.push(wn[0], wn[1], wn[2]);
        b.u.push((wx * wa[0] + wy * wa[1] + wz * wa[2]) / uvs + (o.uo || 0), (wx * wb[0] + wy * wb[1] + wz * wb[2]) / uvs);
      }
      b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    if (o.noCollide) return null;
    return this.world.add(x, y0, z, w, h, d, yaw, o.surfMat || mat, o.flags || {});
  }
  // append any indexed/non-indexed geometry with a transform
  geo(g, mat, matrix, o = {}) {
    const b = this._batch(mat, o.shadow !== false), base = b.p.length / 3, P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    _n3.getNormalMatrix(matrix); const us = o.uvScale || 1;
    for (let k = 0; k < P.count; k++) {
      _v.fromBufferAttribute(P, k).applyMatrix4(matrix); b.p.push(_v.x, _v.y, _v.z);
      _v.fromBufferAttribute(N, k).applyMatrix3(_n3).normalize(); b.n.push(_v.x, _v.y, _v.z);
      if (U) b.u.push(U.getX(k) * us, U.getY(k) * us); else b.u.push(0, 0);
    }
    if (g.index) for (let k = 0; k < g.index.count; k++) b.i.push(base + g.index.getX(k)); else for (let k = 0; k < P.count; k++) b.i.push(base + k);
  }
  cyl(x, y0, z, r, h, mat, o = {}) {
    const g = new THREE.CylinderGeometry(o.r2 != null ? o.r2 : r, r, h, o.seg || 14, 1, !!o.open);
    _m4.makeRotationFromEuler(new THREE.Euler(o.rx || 0, o.yaw || 0, o.rz || 0)).setPosition(x, y0 + h / 2, z);
    if (o.rx || o.rz) _m4.setPosition(x, y0, z);
    this.geo(g, mat, _m4, { uvScale: o.uvScale || 1, shadow: o.shadow }); g.dispose();
    if (!o.noCollide) return this.world.add(x, y0, z, r * 1.6, h, r * 1.6, 0, mat, o.flags || {});
    return null;
  }
  build(scene) {
    const meshes = [];
    for (const b of this.B.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      g.setIndex(b.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.i, 1) : new THREE.Uint16BufferAttribute(b.i, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, MAT[b.mat]); m.castShadow = b.shadow; m.receiveShadow = true; m.matrixAutoUpdate = false; m.updateMatrix();
      scene.add(m); meshes.push(m);
    }
    this.B.clear();
    return meshes;
  }
}

// ------------------------------------------------------------------ navigation
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
export class Nav {
  build(world, half = 56, cell = 0.5) {
    const N = Math.floor((2 * half) / cell); this.N = N; this.cell = cell; this.half = half; this.world = world;
    const colStart = new Int32Array(N * N + 1), xs = [], ys = [], zs = [], q = [], cand = [];
    for (let iz = 0; iz < N; iz++) for (let ix = 0; ix < N; ix++) {
      const x = -half + (ix + 0.5) * cell, z = -half + (iz + 0.5) * cell;
      colStart[iz * N + ix] = xs.length;
      world.query(x, z, 1, q); cand.length = 0; cand.push(0);
      for (const s of q) if (!s.flags.noFloor && !s.flags.ghost && World.inside(s, x, z)) cand.push(s.y1);
      cand.sort((a, b) => a - b);
      let last = -9;
      for (const y of cand) {
        if (y - last < 0.08) continue; last = y;
        let ok = true;
        for (const s of q) {
          if (s.flags.ghost) continue;
          if (s.y0 < y + 0.05 && s.y1 > y + 0.05 && World.inside(s, x, z)) { ok = false; break; }
          if (s.y1 > y + 0.42 && s.y0 < y + 1.7 && World.d2(s, x, z) < 0.34 * 0.34) { ok = false; break; }
        }
        if (ok) { xs.push(x); ys.push(y); zs.push(z); }
      }
    }
    colStart[N * N] = xs.length;
    const M = xs.length; this.M = M; this.colStart = colStart;
    this.x = Float32Array.from(xs); this.y = Float32Array.from(ys); this.z = Float32Array.from(zs);
    this.ix = new Int16Array(M); this.iz = new Int16Array(M);
    for (let i = 0; i < M; i++) { this.ix[i] = Math.floor((this.x[i] + half) / cell); this.iz[i] = Math.floor((this.z[i] + half) / cell); }
    this.nb = new Int32Array(M * 8).fill(-1);
    for (let i = 0; i < M; i++) for (let d = 0; d < 8; d++) {
      const [dx, dz] = DIRS[d], j = this._find(this.ix[i] + dx, this.iz[i] + dz, this.y[i]);
      if (j < 0) continue;
      if (dx && dz && (this._find(this.ix[i] + dx, this.iz[i], this.y[i]) < 0 || this._find(this.ix[i], this.iz[i] + dz, this.y[i]) < 0)) continue;
      this.nb[i * 8 + d] = j;
    }
    this.g = new Float32Array(M); this.f = new Float32Array(M); this.par = new Int32Array(M); this.gen = new Uint32Array(M); this.cls = new Uint32Array(M); this.G = 0;
    this.heap = new Int32Array(M + 1);
    this._buildCover();
  }
  _find(ix, iz, y) {
    if (ix < 0 || iz < 0 || ix >= this.N || iz >= this.N) return -1;
    const c = iz * this.N + ix; let best = -1, bd = 0.5;
    for (let k = this.colStart[c]; k < this.colStart[c + 1]; k++) { const dy = Math.abs(this.y[k] - y); if (dy <= bd) { bd = dy; best = k; } }
    return best;
  }
  nearest(x, y, z, maxR = 6) {
    const cx = Math.floor((x + this.half) / this.cell), cz = Math.floor((z + this.half) / this.cell); let best = -1, bd = Infinity;
    for (let r = 0; r <= maxR; r++) {
      for (let iz = cz - r; iz <= cz + r; iz++) for (let ix = cx - r; ix <= cx + r; ix++) {
        if (r && Math.abs(ix - cx) !== r && Math.abs(iz - cz) !== r) continue;
        if (ix < 0 || iz < 0 || ix >= this.N || iz >= this.N) continue;
        const c = iz * this.N + ix;
        for (let k = this.colStart[c]; k < this.colStart[c + 1]; k++) { const d = (this.x[k] - x) ** 2 + (this.z[k] - z) ** 2 + ((this.y[k] - y) * 3) ** 2; if (d < bd) { bd = d; best = k; } }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }
  path(from, to, maxIter = 9000) {
    const s = this.nearest(from.x, from.y, from.z), goal = this.nearest(to.x, to.y, to.z);
    if (s < 0 || goal < 0) return null;
    const G = ++this.G, g = this.g, f = this.f, par = this.par, gen = this.gen, cls = this.cls, H = this.heap, X = this.x, Y = this.y, Z = this.z;
    const h = (i) => Math.hypot(X[i] - X[goal], Z[i] - Z[goal]) + Math.abs(Y[i] - Y[goal]) * 2;
    let n = 0;
    const push = (i) => { let k = ++n; H[k] = i; while (k > 1 && f[H[k >> 1]] > f[H[k]]) { const t = H[k]; H[k] = H[k >> 1]; H[k >> 1] = t; k >>= 1; } };
    const pop = () => { const top = H[1]; H[1] = H[n--]; let k = 1; for (;;) { let m = k; const l = k * 2, r = l + 1; if (l <= n && f[H[l]] < f[H[m]]) m = l; if (r <= n && f[H[r]] < f[H[m]]) m = r; if (m === k) break; const t = H[k]; H[k] = H[m]; H[m] = t; k = m; } return top; };
    g[s] = 0; f[s] = h(s); par[s] = -1; gen[s] = G; push(s);
    let bestI = s, bestH = f[s], it = 0;
    while (n > 0 && it++ < maxIter) {
      const i = pop(); if (cls[i] === G) continue; cls[i] = G;
      if (i === goal) { bestI = i; break; }
      const hi = f[i] - g[i]; if (hi < bestH) { bestH = hi; bestI = i; }
      for (let d = 0; d < 8; d++) {
        const j = this.nb[i * 8 + d]; if (j < 0 || cls[j] === G) continue;
        const ng = g[i] + (d < 4 ? 1 : 1.414) * this.cell + Math.abs(Y[j] - Y[i]) * 1.5;
        if (gen[j] !== G || ng < g[j]) { gen[j] = G; g[j] = ng; par[j] = i; f[j] = ng + h(j); push(j); }
      }
    }
    const pts = []; for (let i = bestI; i >= 0; i = par[i]) pts.push({ x: X[i], y: Y[i], z: Z[i] });
    pts.reverse();
    return this._smooth(pts);
  }
  _walkable(a, b) {
    const W = this.world, A = this._a || (this._a = { x: 0, y: 0, z: 0 }), B = this._b || (this._b = { x: 0, y: 0, z: 0 });
    for (const hgt of [0.5, 1.3]) { A.x = a.x; A.y = a.y + hgt; A.z = a.z; B.x = b.x; B.y = b.y + hgt; B.z = b.z; if (!W.clear(A, B, true)) return false; }
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 1.2);
    for (let k = 1; k < steps; k++) { const t = k / steps, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, y = a.y + (b.y - a.y) * t, n = this.nearest(x, y, z, 1); if (n < 0 || Math.abs(this.y[n] - y) > 0.3 || Math.hypot(this.x[n] - x, this.z[n] - z) > 0.6) return false; }
    return true;
  }
  _smooth(p) {
    if (p.length <= 2) return p;
    const out = [p[0]]; let i = 0;
    while (i < p.length - 1) {
      let j = Math.min(p.length - 1, i + 20);
      for (; j > i + 1; j--) if (Math.abs(p[j].y - p[i].y) < 0.3 && this._walkable(p[i], p[j])) break;
      out.push(p[j]); i = j;
    }
    return out;
  }
  randomNear(x, z, rad, minR = 0) {
    for (let k = 0; k < 20; k++) { const a = Math.random() * Math.PI * 2, r = minR + Math.random() * (rad - minR), n = this.nearest(x + Math.cos(a) * r, 0, z + Math.sin(a) * r, 2); if (n >= 0 && this.y[n] < 0.5) return { x: this.x[n], y: this.y[n], z: this.z[n] }; }
    return null;
  }
  // cover: nav nodes with a solid blocking a crouched body in one of 8 directions
  _buildCover() {
    const W = this.world, q = []; this.cover = [];
    for (let i = 0; i < this.M; i++) {
      if ((this.ix[i] + this.iz[i]) % 2) continue;
      const x = this.x[i], y = this.y[i], z = this.z[i];
      for (let d = 0; d < 8; d++) {
        let [dx, dz] = DIRS[d]; const l = Math.hypot(dx, dz); dx /= l; dz /= l;
        const px = x + dx * 0.55, pz = z + dz * 0.55; W.query(px, pz, 1, q);
        let top = 0;
        for (const s of q) if (!s.flags.ghost && !s.flags.glass && s.y0 < y + 0.4 && s.y1 > y + 0.9 && World.d2(s, px, pz) < 0.02) top = Math.max(top, s.y1 - y);
        if (top >= 0.95) { this.cover.push({ i, x, y, z, dx, dz, high: top >= 1.75, taken: null }); break; }
      }
    }
  }
}
