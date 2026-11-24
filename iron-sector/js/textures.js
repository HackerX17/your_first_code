// Procedural PBR materials: every surface is generated here as albedo + normal + roughness maps (tileable).
import * as THREE from 'three';
import { clamp, mulberry32 } from './core.js';

const fract = (x) => x - Math.floor(x);
function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653);
  h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296;
}
class Noise {
  constructor(seed) { this.seed = seed; this.rng = mulberry32(seed); this.L = new Map(); }
  lat(pu, pv) { const k = pu * 4096 + pv; let a = this.L.get(k); if (!a) { a = new Float32Array(pu * pv); for (let i = 0; i < a.length; i++) a[i] = this.rng(); this.L.set(k, a); } return a; }
  // periodic value noise; pu/pv = lattice cells across the tile in u/v
  v(u, v, pu, pv = pu) {
    const L = this.lat(pu, pv), x = u * pu, y = v * pv, xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const x0 = ((xi % pu) + pu) % pu, y0 = ((yi % pv) + pv) % pv, x1 = (x0 + 1) % pu, y1 = (y0 + 1) % pv;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = L[y0 * pu + x0], b = L[y0 * pu + x1], c = L[y1 * pu + x0], d = L[y1 * pu + x1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  fbm(u, v, p, oct = 4, gain = 0.5, pv = p) { let s = 0, amp = 1, n = 0, a = p, b = pv; for (let o = 0; o < oct; o++) { s += this.v(u, v, a, b) * amp; n += amp; amp *= gain; a *= 2; b *= 2; } return s / n; }
  // periodic worley: returns [F1, F2, cellId]
  cell(u, v, p) {
    const x = u * p, y = v * p, xi = Math.floor(x), yi = Math.floor(y); let f1 = 9, f2 = 9, id = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy, wx = ((cx % p) + p) % p, wy = ((cy % p) + p) % p;
      const px = cx + hash2(wx, wy, this.seed), py = cy + hash2(wx, wy, this.seed + 7);
      const d = (x - px) * (x - px) + (y - py) * (y - py);
      if (d < f1) { f2 = f1; f1 = d; id = hash2(wx, wy, this.seed + 13); } else if (d < f2) f2 = d;
    }
    return [Math.sqrt(f1), Math.sqrt(f2), id];
  }
}
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

function bake(N, fn) {
  const col = new Uint8Array(N * N * 4), h = new Float32Array(N * N), ro = new Uint8Array(N * N * 4), o = { r: 0, g: 0, b: 0, h: 0.5, ro: 0.8, m: 0 };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    o.h = 0.5; o.ro = 0.8; fn((x + 0.5) / N, (y + 0.5) / N, o);
    const i = y * N + x, ao = 0.72 + 0.28 * clamp(o.h * 1.4 - 0.1, 0, 1); // bake cavity darkening into albedo
    col[i * 4] = clamp(o.r * ao, 0, 1) * 255; col[i * 4 + 1] = clamp(o.g * ao, 0, 1) * 255; col[i * 4 + 2] = clamp(o.b * ao, 0, 1) * 255; col[i * 4 + 3] = 255;
    h[i] = o.h; const r = clamp(o.ro, 0.02, 1) * 255; ro[i * 4] = r; ro[i * 4 + 1] = r; ro[i * 4 + 2] = r; ro[i * 4 + 3] = 255;
  }
  return { col, h, ro, N };
}
function dataTex(arr, N, srgb) {
  const t = new THREE.DataTexture(arr, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t;
}
function toMaps(b, strength) {
  const N = b.N, H = b.h, nor = new Uint8Array(N * N * 4), s = strength * N / 256;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = H[y * N + ((x - 1 + N) % N)], r = H[y * N + ((x + 1) % N)], d = H[((y - 1 + N) % N) * N + x], u = H[((y + 1) % N) * N + x];
    let nx = (l - r) * s, ny = (d - u) * s, nz = 1; const m = 1 / Math.hypot(nx, ny, nz); nx *= m; ny *= m; nz *= m;
    const i = (y * N + x) * 4; nor[i] = (nx * 0.5 + 0.5) * 255; nor[i + 1] = (ny * 0.5 + 0.5) * 255; nor[i + 2] = (nz * 0.5 + 0.5) * 255; nor[i + 3] = 255;
  }
  return { map: dataTex(b.col, N, true), normalMap: dataTex(nor, N, false), roughnessMap: dataTex(b.ro, N, false) };
}

// ------------------------------------------------------------------ recipes
function brickAt(u, v, rows, cols, n, mortar = 0.06) {
  const by = v * rows, row = Math.floor(by), fy = by - row, bx = u * cols + (row % 2) * 0.5, col = Math.floor(bx), fx = bx - col;
  const id = hash2(((col % cols) + cols) % cols, row, 99), edge = Math.min(fx, 1 - fx) * 3.2, edgeY = Math.min(fy, 1 - fy);
  const isMortar = edge < mortar || edgeY < mortar * 1.6;
  return { isMortar, id, fx, fy, edge: Math.min(edge, edgeY * 0.5) };
}
const R = {
  concrete(n) { return (u, v, o) => {
    const st = n.fbm(u, v, 3, 5), f = n.v(u, v, 96), f2 = n.v(u, v, 200), pit = n.v(u, v, 140) > 0.85 ? 1 : 0;
    const [f1, f2c] = n.cell(u, v, 5), crack = (f2c - f1 < 0.02 && n.v(u, v, 6) > 0.55) ? 1 : 0;
    const seam = Math.abs(fract(v * 2) - 0.5) > 0.493 ? 1 : 0;
    const b = 0.58 + (st - 0.5) * 0.26 + (f - 0.5) * 0.07 - pit * 0.12 - seam * 0.07 - crack * 0.2;
    o.r = b; o.g = b * 0.985; o.b = b * 0.955; o.h = 0.55 + (f2 - 0.5) * 0.3 - pit * 0.35 - seam * 0.25 - crack * 0.5; o.ro = 0.86 + (0.5 - st) * 0.12;
  }; },
  brick(n) { return (u, v, o) => {
    const B = brickAt(u, v, 26, 9, n), g = n.v(u, v, 180), soot = n.fbm(u, v, 2, 3);
    if (B.isMortar) { const m = 0.6 + (g - 0.5) * 0.1; o.r = m; o.g = m * 0.96; o.b = m * 0.9; o.h = 0.2 + g * 0.1; o.ro = 0.95; }
    else {
      const t = B.id, chip = n.v(u, v, 70) > 0.78 ? 0.25 : 0;
      o.r = mix(0.52, 0.66, t) - chip * 0.2; o.g = mix(0.24, 0.32, t) - chip * 0.1; o.b = mix(0.17, 0.22, t) - chip * 0.05;
      o.r += (g - 0.5) * 0.08; o.g += (g - 0.5) * 0.05; o.h = 0.62 + (g - 0.5) * 0.25 - chip * 0.4 + clamp(B.edge, 0, 0.3) * 0.4; o.ro = 0.82 + chip * 0.1;
    }
    const s = 1 - (soot - 0.4) * 0.35; o.r *= s; o.g *= s; o.b *= s;
  }; },
  plaster(n, tint = [0.76, 0.68, 0.54]) { return (u, v, o) => {
    const m = n.fbm(u, v, 5, 4) * 0.8 + n.v(u, v, 2) * 0.2, blot = n.fbm(u + 0.37, v, 4, 4), g = n.v(u, v, 160), streak = n.fbm(u, v, 24, 2, 0.5, 2);
    if (m > 0.74) { // plaster has fallen off: brick underneath
      const B = brickAt(u, v, 26, 9, n); const k = B.isMortar ? 0.55 : mix(0.5, 0.62, B.id);
      o.r = k; o.g = B.isMortar ? k * 0.95 : k * 0.48; o.b = B.isMortar ? k * 0.9 : k * 0.34; o.h = B.isMortar ? 0.08 : 0.25; o.ro = 0.9;
    } else {
      const e = sstep(0.66, 0.74, m), b = (0.9 + (blot - 0.5) * 0.16) * (1 - e * 0.22) * (1 - (streak - 0.5) * 0.2);
      o.r = tint[0] * b + (g - 0.5) * 0.05; o.g = tint[1] * b + (g - 0.5) * 0.05; o.b = tint[2] * b + (g - 0.5) * 0.04;
      o.h = 0.6 + (g - 0.5) * 0.22 + e * 0.2; o.ro = 0.9;
    }
  }; },
  asphalt(n) { return (u, v, o) => {
    const g = n.v(u, v, 220), agg = n.v(u, v, 300) > 0.72 ? 1 : 0, st = n.fbm(u, v, 3, 4);
    const [f1, f2, id] = n.cell(u, v, 4), crack = f2 - f1 < 0.018 && n.v(u, v, 5) > 0.45 ? 1 : 0, patch = id > 0.86 && f1 < 0.35 ? 1 : 0;
    const b = 0.2 + (st - 0.5) * 0.08 + agg * 0.09 + (g - 0.5) * 0.04 - crack * 0.1 - patch * 0.05;
    o.r = b; o.g = b; o.b = b * 1.02; o.h = 0.5 + agg * 0.25 + (g - 0.5) * 0.2 - crack * 0.5; o.ro = 0.9 - agg * 0.1 + patch * 0.05;
  }; },
  dirt(n) { return (u, v, o) => {
    const st = n.fbm(u, v, 3, 5), g = n.v(u, v, 180), [f1, , id] = n.cell(u, v, 28), peb = f1 < 0.32 && id > 0.35 ? 1 - f1 / 0.32 : 0;
    o.r = mix(0.36, 0.48, st) + (g - 0.5) * 0.06; o.g = mix(0.29, 0.38, st) + (g - 0.5) * 0.05; o.b = mix(0.21, 0.27, st) + (g - 0.5) * 0.04;
    if (peb > 0) { const k = mix(0.42, 0.6, id); o.r = mix(o.r, k, 0.8); o.g = mix(o.g, k * 0.95, 0.8); o.b = mix(o.b, k * 0.88, 0.8); }
    o.h = 0.4 + st * 0.2 + peb * 0.45 + (g - 0.5) * 0.12; o.ro = 0.95 - peb * 0.15;
  }; },
  paving(n) { return (u, v, o) => {
    const bx = u * 4, by = v * 4, fx = fract(bx), fy = fract(by), id = hash2(Math.floor(bx) % 4, Math.floor(by) % 4, 5);
    const e = Math.min(fx, 1 - fx, fy, 1 - fy), grout = e < 0.025, g = n.v(u, v, 160), st = n.fbm(u, v, 4, 4);
    if (grout) { o.r = 0.3; o.g = 0.29; o.b = 0.27; o.h = 0.1; o.ro = 0.95; }
    else { const k = mix(0.55, 0.68, id) * (0.9 + st * 0.2) + (g - 0.5) * 0.05; o.r = k; o.g = k * 0.95; o.b = k * 0.87; o.h = 0.55 + Math.min(e * 6, 0.3) + (g - 0.5) * 0.15; o.ro = 0.82; }
  }; },
  tiles(n) { return (u, v, o) => {
    const bx = u * 6, by = v * 6, fx = fract(bx), fy = fract(by), chk = (Math.floor(bx) + Math.floor(by)) % 2, e = Math.min(fx, 1 - fx, fy, 1 - fy), g = n.v(u, v, 120), dirt = n.fbm(u, v, 3, 3);
    if (e < 0.03) { o.r = o.g = o.b = 0.25; o.h = 0.1; o.ro = 0.9; }
    else { const k = chk ? 0.62 : 0.3; o.r = k * (0.9 + dirt * 0.2) + (g - 0.5) * 0.03; o.g = k * 0.97 * (0.9 + dirt * 0.2); o.b = k * 0.9 * (0.9 + dirt * 0.2); o.h = 0.6; o.ro = 0.35 + dirt * 0.4; }
  }; },
  roof(n) { return (u, v, o) => {
    const g = n.v(u, v, 256), sp = n.v(u, v, 330) > 0.66 ? 1 : 0, st = n.fbm(u, v, 3, 4);
    const b = 0.26 + sp * 0.12 + (st - 0.5) * 0.1 + (g - 0.5) * 0.05; o.r = b; o.g = b * 0.98; o.b = b * 0.95; o.h = 0.45 + sp * 0.3 + (g - 0.5) * 0.2; o.ro = 0.95;
  }; },
  wood(n) { return (u, v, o) => {
    const rows = 6, by = v * rows, row = Math.floor(by), fy = fract(by), id = hash2(row % rows, 0, 3);
    const grain = Math.sin((u * 30 + n.fbm(u, v, 4, 3) * 6 + id * 10) * Math.PI * 2) * 0.5 + 0.5, gap = fy < 0.05 || fy > 0.95;
    const k = mix(0.42, 0.56, id) * (0.85 + grain * 0.2);
    if (gap) { o.r = 0.12; o.g = 0.09; o.b = 0.06; o.h = 0.05; o.ro = 0.95; }
    else { o.r = k; o.g = k * 0.74; o.b = k * 0.5; o.h = 0.6 + grain * 0.1; o.ro = 0.78 + grain * 0.1; }
  }; },
  sandbag(n) { return (u, v, o) => {
    const w = Math.sin(u * Math.PI * 2 * 90) * Math.sin(v * Math.PI * 2 * 90), lump = n.fbm(u, v, 4, 3), st = n.fbm(u, v, 3, 3);
    const b = 0.86 + (st - 0.5) * 0.25; o.r = 0.56 * b; o.g = 0.49 * b; o.b = 0.34 * b; o.h = 0.5 + w * 0.08 + (lump - 0.5) * 0.5; o.ro = 0.95;
  }; },
  painted(n, c) { return (u, v, o) => {
    const st = n.fbm(u, v, 3, 5), rust = st > 0.64 ? sstep(0.64, 0.72, st) : 0, scr = n.v(u, v, 6, 400) > 0.93 ? 1 : 0, g = n.v(u, v, 200);
    o.r = mix(c[0], 0.42, rust) + scr * 0.15; o.g = mix(c[1], 0.22, rust) + scr * 0.15; o.b = mix(c[2], 0.1, rust) + scr * 0.15;
    o.r *= 0.92 + g * 0.12; o.g *= 0.92 + g * 0.12; o.b *= 0.92 + g * 0.12;
    o.h = 0.6 - rust * 0.15 + (g - 0.5) * 0.08 - scr * 0.1; o.ro = mix(0.42, 0.92, rust) + scr * 0.1;
  }; },
  corrugated(n, c) { return (u, v, o) => {
    const ridge = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 18), streak = n.fbm(u, v, 40, 3, 0.5, 2), st = n.fbm(u, v, 3, 4);
    const rust = clamp((streak - 0.55) * 3, 0, 1) * (v < 0.25 ? 1 : 0.6) + (st > 0.68 ? 0.6 : 0);
    o.r = mix(c[0], 0.4, rust); o.g = mix(c[1], 0.2, rust); o.b = mix(c[2], 0.1, rust);
    o.h = 0.3 + ridge * 0.6; o.ro = mix(0.5, 0.9, rust);
  }; },
  burnt(n) { return (u, v, o) => {
    const st = n.fbm(u, v, 3, 5), g = n.v(u, v, 220), rust = sstep(0.45, 0.7, st);
    o.r = mix(0.08, 0.36, rust) + (g - 0.5) * 0.05; o.g = mix(0.075, 0.18, rust); o.b = mix(0.07, 0.09, rust); o.h = 0.5 + (g - 0.5) * 0.4 + rust * 0.1; o.ro = 0.85;
  }; },
  rubber(n) { return (u, v, o) => { const g = n.v(u, v, 150); o.r = o.g = o.b = 0.07 + g * 0.03; o.h = 0.5 + Math.sin(v * Math.PI * 2 * 24) * 0.15; o.ro = 0.95; }; },
  camo(n) { return (u, v, o) => {
    const a = n.fbm(u, v, 3, 3), b = n.fbm(u + 0.5, v + 0.2, 5, 3), w = Math.sin(u * Math.PI * 2 * 140) * Math.sin(v * Math.PI * 2 * 140);
    let c = [0.62, 0.58, 0.47]; if (a > 0.56) c = [0.42, 0.4, 0.31]; if (b > 0.6) c = [0.3, 0.28, 0.22]; if (a < 0.38) c = [0.74, 0.7, 0.58];
    o.r = c[0]; o.g = c[1]; o.b = c[2]; o.h = 0.5 + w * 0.06 + (a - 0.5) * 0.1; o.ro = 0.92;
  }; },
  gunmetal(n) { return (u, v, o) => { const g = n.v(u, v, 256), s = n.fbm(u, v, 4, 3); const k = 0.17 + (g - 0.5) * 0.03 + (s - 0.5) * 0.04; o.r = k; o.g = k; o.b = k * 1.04; o.h = 0.5 + (g - 0.5) * 0.1; o.ro = 0.38 + s * 0.22; }; },
  polymer(n) { return (u, v, o) => { const g = n.v(u, v, 300), s = n.fbm(u, v, 3, 3); const k = 0.13 + (s - 0.5) * 0.03; o.r = k; o.g = k * 0.98; o.b = k * 0.94; o.h = 0.5 + (g - 0.5) * 0.3; o.ro = 0.72 + (g - 0.5) * 0.1; }; },
  cloth(n, a, b) { return (u, v, o) => { const s = fract(u * 6) < 0.5, w = Math.sin(u * Math.PI * 2 * 120) * Math.sin(v * Math.PI * 2 * 120), d = n.fbm(u, v, 3, 3); const c = s ? a : b, k = 0.8 + d * 0.3; o.r = c[0] * k; o.g = c[1] * k; o.b = c[2] * k; o.h = 0.5 + w * 0.08; o.ro = 0.95; }; }
};

// key: [recipe, args, normalStrength, metalness, metersPerTile, surfaceType, sizeScale]
const SPEC = {
  concrete:   ['concrete', [], 2.2, 0, 2.5, 'concrete', 1],
  brick:      ['brick', [], 3.2, 0, 2, 'concrete', 1],
  plaster:    ['plaster', [[0.78, 0.7, 0.55]], 2.6, 0, 2.2, 'concrete', 1],
  plasterW:   ['plaster', [[0.82, 0.8, 0.74]], 2.6, 0, 2.2, 'concrete', 1],
  plasterR:   ['plaster', [[0.74, 0.55, 0.46]], 2.6, 0, 2.2, 'concrete', 1],
  asphalt:    ['asphalt', [], 2.4, 0, 4, 'concrete', 1],
  dirt:       ['dirt', [], 3.0, 0, 4, 'dirt', 1],
  paving:     ['paving', [], 2.6, 0, 2, 'concrete', 1],
  tiles:      ['tiles', [], 2.0, 0, 1.8, 'concrete', 0.5],
  roof:       ['roof', [], 2.0, 0, 3, 'concrete', 0.5],
  wood:       ['wood', [], 2.0, 0, 1.2, 'wood', 0.5],
  sandbag:    ['sandbag', [], 3.0, 0, 1.0, 'dirt', 0.5],
  metalGreen: ['painted', [[0.27, 0.31, 0.22]], 1.2, 0.35, 2, 'metal', 0.5],
  metalWhite: ['painted', [[0.72, 0.72, 0.7]], 1.2, 0.3, 2, 'metal', 0.5],
  metalBlue:  ['painted', [[0.2, 0.3, 0.42]], 1.2, 0.3, 2, 'metal', 0.5],
  metalRed:   ['painted', [[0.5, 0.15, 0.12]], 1.2, 0.3, 2, 'metal', 0.5],
  metalGrey:  ['painted', [[0.35, 0.36, 0.37]], 1.2, 0.5, 2, 'metal', 0.5],
  contRed:    ['corrugated', [[0.55, 0.16, 0.12]], 2.0, 0.3, 2.6, 'metal', 0.5],
  contBlue:   ['corrugated', [[0.14, 0.27, 0.45]], 2.0, 0.3, 2.6, 'metal', 0.5],
  contGreen:  ['corrugated', [[0.22, 0.36, 0.25]], 2.0, 0.3, 2.6, 'metal', 0.5],
  contOrange: ['corrugated', [[0.7, 0.38, 0.12]], 2.0, 0.3, 2.6, 'metal', 0.5],
  burnt:      ['burnt', [], 2.0, 0.4, 2, 'metal', 0.5],
  rubber:     ['rubber', [], 1.5, 0, 0.8, 'dirt', 0.25],
  camo:       ['camo', [], 1.6, 0, 0.7, 'flesh', 0.5],
  gunmetal:   ['gunmetal', [], 0.8, 0.85, 0.25, 'metal', 0.5],
  polymer:    ['polymer', [], 1.0, 0, 0.25, 'metal', 0.5],
  clothA:     ['cloth', [[0.62, 0.18, 0.14], [0.85, 0.8, 0.7]], 1.2, 0, 2, 'wood', 0.25],
  clothB:     ['cloth', [[0.18, 0.36, 0.5], [0.82, 0.8, 0.72]], 1.2, 0, 2, 'wood', 0.25],
  clothC:     ['cloth', [[0.36, 0.42, 0.22], [0.7, 0.62, 0.42]], 1.2, 0, 2, 'wood', 0.25]
};

export const MAT = {}, UVS = {}, SURF = {};
export async function buildMaterials(texSize, onProgress) {
  const keys = Object.keys(SPEC);
  let i = 0;
  for (const key of keys) {
    const [recipe, args, nStr, metal, uvs, surf, sizeScale] = SPEC[key];
    const N = Math.max(128, Math.min(1024, Math.round(texSize * sizeScale)));
    const n = new Noise(1000 + i * 77);
    const maps = toMaps(bake(N, R[recipe](n, ...args)), nStr);
    MAT[key] = new THREE.MeshStandardMaterial({ ...maps, roughness: 1, metalness: metal, envMapIntensity: metal > 0.5 ? 1.0 : 0.65 });
    UVS[key] = uvs; SURF[key] = surf;
    i++; if (onProgress) onProgress(i / keys.length, key);
    await new Promise((r) => setTimeout(r, 0));
  }
  // flat materials
  const flat = (key, color, o = {}) => { const { surf, ...p } = o; MAT[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...p }); UVS[key] = 1; SURF[key] = surf || 'concrete'; };
  flat('glass', 0x1c2a33, { roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.32, envMapIntensity: 1.4, depthWrite: false, surf: 'glass' });
  flat('darkGlass', 0x0b0f12, { roughness: 0.12, metalness: 0.4, envMapIntensity: 1.2, surf: 'glass' });
  flat('black', 0x121212, { roughness: 0.7 });
  flat('frame', 0x2b2621, { roughness: 0.75 });
  flat('lamp', 0xfff1c8, { emissive: 0xffd08a, emissiveIntensity: 0.4 });
  flat('fire', 0xff8a3a, { emissive: 0xff6a1a, emissiveIntensity: 2 });
  flat('skin', 0x8a6a55, { roughness: 0.75, surf: 'flesh' });
  flat('glove', 0x2a2a26, { roughness: 0.85, surf: 'flesh' });
  flat('brass', 0xc9a24a, { roughness: 0.3, metalness: 1, surf: 'metal' });
  flat('foliage', 0x4c4a2e, { roughness: 0.95, surf: 'wood' });
  flat('barrelRed', 0x8a1d14, { roughness: 0.55, metalness: 0.4, surf: 'metal' });
  flat('hazard', 0xd9a520, { roughness: 0.6, metalness: 0.3, surf: 'metal' });
  flat('armory', 0x3a4a2e, { roughness: 0.6, metalness: 0.4, surf: 'metal' });
  flat('screen', 0x0a1a10, { emissive: 0x6dff7a, emissiveIntensity: 0.9 });
  return MAT;
}
