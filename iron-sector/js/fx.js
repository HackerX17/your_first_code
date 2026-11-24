// Effects: GPU point particles (atlas), decals, travelling tracers, physical shell casings, pooled flash lights.
import * as THREE from 'three';
import { G, rand, clamp } from './core.js';
import { MAT } from './textures.js';

function atlas() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64; const g = c.getContext('2d');
  // 0 smoke puff
  for (let i = 0; i < 40; i++) { const x = 32 + rand(-12, 12), y = 32 + rand(-12, 12), r = rand(8, 20), gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }
  // 1 spark
  let gr = g.createRadialGradient(96, 32, 0, 96, 32, 30); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.15, 'rgba(255,255,255,.9)'); gr.addColorStop(0.4, 'rgba(255,255,255,.2)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(64, 0, 64, 64);
  // 2 flame
  for (let i = 0; i < 18; i++) { const x = 160 + rand(-8, 8), y = 34 + rand(-10, 8), r = rand(10, 22); gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(128, 0, 64, 64); }
  // 3 chunk
  g.fillStyle = '#fff'; g.beginPath(); for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2, r = rand(14, 26); g.lineTo(224 + Math.cos(a) * r, 32 + Math.sin(a) * r); } g.closePath(); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const VS = `attribute vec4 aColor; attribute float aSize; attribute float aTile; attribute float aRot;
varying vec4 vColor; varying float vTile; varying float vRot; varying float vDepth; uniform float uScale;
void main(){ vColor = aColor; vTile = aTile; vRot = aRot; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDepth = -mv.z;
  gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 512.0); gl_Position = projectionMatrix * mv; }`;
const FS = `uniform sampler2D uTex; uniform vec3 uFog; uniform float uDensity; uniform float uAdd;
varying vec4 vColor; varying float vTile; varying float vRot; varying float vDepth;
void main(){ vec2 p = gl_PointCoord - 0.5; float c = cos(vRot), s = sin(vRot); p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) discard;
  vec4 t = texture2D(uTex, vec2((p.x + vTile) * 0.25, 1.0 - p.y)); vec4 col = t * vColor;
  float f = 1.0 - exp(-uDensity * uDensity * vDepth * vDepth);
  if (uAdd > 0.5) col.rgb *= col.a * (1.0 - f); else col.rgb = mix(col.rgb, uFog, f);
  if (col.a < 0.004 && uAdd < 0.5) discard; gl_FragColor = col; }`;

class PS {
  constructor(scene, max, additive, tex) {
    this.max = max; this.n = 0; this.add = additive;
    const F = (k) => new Float32Array(max * k);
    this.p = F(3); this.v = F(3); this.c = F(4); this.life = F(1); this.lmax = F(1); this.size = F(1); this.grow = F(1); this.tile = F(1); this.rot = F(1); this.spin = F(1); this.grav = F(1); this.drag = F(1); this.a0 = F(1); this.fin = F(1);
    const g = (this.g = new THREE.BufferGeometry());
    this.aP = new THREE.BufferAttribute(F(3), 3); this.aC = new THREE.BufferAttribute(F(4), 4); this.aS = new THREE.BufferAttribute(F(1), 1); this.aT = new THREE.BufferAttribute(F(1), 1); this.aR = new THREE.BufferAttribute(F(1), 1);
    for (const a of [this.aP, this.aC, this.aS, this.aT, this.aR]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aP); g.setAttribute('aColor', this.aC); g.setAttribute('aSize', this.aS); g.setAttribute('aTile', this.aT); g.setAttribute('aRot', this.aR);
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uTex: { value: tex }, uScale: { value: 600 }, uFog: { value: new THREE.Color() }, uDensity: { value: 0.01 }, uAdd: { value: additive ? 1 : 0 } } });
    this.pts = new THREE.Points(g, this.mat); this.pts.frustumCulled = false; this.pts.renderOrder = additive ? 4 : 3; scene.add(this.pts);
  }
  spawn(x, y, z, vx, vy, vz, life, size, r, gg, b, a, tile, o = {}) {
    if (this.n >= this.max) return; const i = this.n++;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.v[i * 3] = vx; this.v[i * 3 + 1] = vy; this.v[i * 3 + 2] = vz;
    this.c[i * 4] = r; this.c[i * 4 + 1] = gg; this.c[i * 4 + 2] = b; this.a0[i] = a; this.life[i] = life; this.lmax[i] = life; this.size[i] = size;
    this.grow[i] = o.grow || 0; this.tile[i] = tile; this.rot[i] = Math.random() * 6.28; this.spin[i] = o.spin != null ? o.spin : rand(-1, 1); this.grav[i] = o.grav || 0; this.drag[i] = o.drag || 0; this.fin[i] = o.fadeIn || 0;
  }
  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this._copy(this.n - 1, i); this.n--; continue; }
      const d = Math.exp(-this.drag[i] * dt);
      this.v[i * 3] *= d; this.v[i * 3 + 1] = this.v[i * 3 + 1] * d - this.grav[i] * dt; this.v[i * 3 + 2] *= d;
      this.p[i * 3] += this.v[i * 3] * dt; this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt; this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.grav[i] > 0 && this.p[i * 3 + 1] < 0.02) { this.p[i * 3 + 1] = 0.02; this.v[i * 3 + 1] *= -0.25; this.v[i * 3] *= 0.6; this.v[i * 3 + 2] *= 0.6; }
      this.size[i] += this.grow[i] * dt; this.rot[i] += this.spin[i] * dt;
      i++;
    }
    const P = this.aP.array, C = this.aC.array, S = this.aS.array, T = this.aT.array, Rr = this.aR.array;
    for (let k = 0; k < this.n; k++) {
      const u = this.life[k] / this.lmax[k], fi = this.fin[k] > 0 ? clamp((1 - u) / this.fin[k], 0, 1) : 1;
      P[k * 3] = this.p[k * 3]; P[k * 3 + 1] = this.p[k * 3 + 1]; P[k * 3 + 2] = this.p[k * 3 + 2];
      C[k * 4] = this.c[k * 4]; C[k * 4 + 1] = this.c[k * 4 + 1]; C[k * 4 + 2] = this.c[k * 4 + 2]; C[k * 4 + 3] = this.a0[k] * Math.min(1, u * 2.2) * fi;
      S[k] = this.size[k]; T[k] = this.tile[k]; Rr[k] = this.rot[k];
    }
    for (const a of [this.aP, this.aC, this.aS, this.aT, this.aR]) { a.needsUpdate = true; a.clearUpdateRanges ? (a.clearUpdateRanges(), a.addUpdateRange(0, this.n * a.itemSize)) : null; }
    this.g.setDrawRange(0, this.n);
  }
  _copy(from, to) {
    if (from === to) return;
    for (const [arr, k] of [[this.p, 3], [this.v, 3], [this.c, 4]]) for (let j = 0; j < k; j++) arr[to * k + j] = arr[from * k + j];
    for (const arr of [this.life, this.lmax, this.size, this.grow, this.tile, this.rot, this.spin, this.grav, this.drag, this.a0, this.fin]) arr[to] = arr[from];
  }
}

function decalTex(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.translate(64, 64);
  if (kind === 'hole' || kind === 'holeMetal') {
    let gr = g.createRadialGradient(0, 0, 2, 0, 0, 60); gr.addColorStop(0, kind === 'hole' ? 'rgba(30,26,22,.85)' : 'rgba(40,40,44,.7)'); gr.addColorStop(0.3, 'rgba(70,64,58,.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(-64, -64, 128, 128);
    g.fillStyle = kind === 'hole' ? '#0b0908' : '#121214'; g.beginPath(); for (let i = 0; i < 9; i++) { const a = (i / 9) * Math.PI * 2, r = rand(9, 15); g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.fill();
    if (kind === 'holeMetal') { g.strokeStyle = 'rgba(210,205,195,.8)'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 15, 0, Math.PI * 2); g.stroke(); }
    else { g.strokeStyle = 'rgba(20,18,16,.6)'; g.lineWidth = 2; for (let i = 0; i < 6; i++) { const a = rand(0, 6.28); g.beginPath(); g.moveTo(Math.cos(a) * 12, Math.sin(a) * 12); g.lineTo(Math.cos(a + rand(-0.3, 0.3)) * rand(28, 50), Math.sin(a + rand(-0.3, 0.3)) * rand(28, 50)); g.stroke(); } }
  } else if (kind === 'blood') {
    g.fillStyle = 'rgba(90,6,4,.92)'; for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(rand(-30, 30), rand(-30, 30), rand(4, 22), 0, Math.PI * 2); g.fill(); }
    for (let i = 0; i < 18; i++) { g.beginPath(); g.arc(rand(-60, 60), rand(-60, 60), rand(1, 4), 0, Math.PI * 2); g.fill(); }
  } else {
    const gr = g.createRadialGradient(0, 0, 4, 0, 0, 64); gr.addColorStop(0, 'rgba(8,7,6,.95)'); gr.addColorStop(0.55, 'rgba(18,15,12,.7)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(-64, -64, 128, 128);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${rand(0.1, 0.4)})`; g.beginPath(); g.arc(rand(-60, 60), rand(-60, 60), rand(2, 8), 0, Math.PI * 2); g.fill(); }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export class FX {
  constructor(scene, lights = 4) {
    this.scene = scene; const tex = atlas();
    this.add = new PS(scene, 2500, true, tex); this.alpha = new PS(scene, 2500, false, tex);
    // decals
    this.dec = {}; const quad = new THREE.PlaneGeometry(1, 1);
    for (const [k, max, rough] of [['hole', 220, 0.95], ['holeMetal', 80, 0.5], ['blood', 90, 0.35], ['scorch', 30, 1]]) {
      const m = new THREE.MeshStandardMaterial({ map: decalTex(k), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, roughness: rough });
      const mesh = new THREE.InstancedMesh(quad, m, max); mesh.count = 0; mesh.frustumCulled = false; mesh.renderOrder = 1; scene.add(mesh);
      this.dec[k] = { mesh, max, i: 0, n: 0 };
    }
    // tracers
    this.tr = []; this.trMax = 80; const tg = new THREE.BufferGeometry();
    this.trPos = new Float32Array(this.trMax * 6); this.trCol = new Float32Array(this.trMax * 6);
    tg.setAttribute('position', new THREE.BufferAttribute(this.trPos, 3).setUsage(THREE.DynamicDrawUsage)); tg.setAttribute('color', new THREE.BufferAttribute(this.trCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.trLines = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trLines.frustumCulled = false; scene.add(this.trLines);
    // shells
    this.shellMax = 70; this.shells = [];
    const sg = new THREE.CylinderGeometry(0.0055, 0.0055, 0.026, 6); sg.rotateZ(Math.PI / 2);
    this.shellMesh = new THREE.InstancedMesh(sg, MAT.brass, this.shellMax); this.shellMesh.count = 0; this.shellMesh.frustumCulled = false; this.shellMesh.castShadow = false; scene.add(this.shellMesh);
    // flash light pool (constant light count so shaders never recompile)
    this.lights = []; for (let i = 0; i < lights; i++) { const l = new THREE.PointLight(0xffaa55, 0, 12, 2); l.userData = { t: 0, d: 0.1, i0: 0 }; scene.add(l); this.lights.push(l); }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(); this._z = new THREE.Vector3(0, 0, 1); this._e = new THREE.Euler();
  }
  // ---------------- emitters ----------------
  impact(surf, p, n, scale = 1) {
    const A = this.add, S = this.alpha;
    if (surf === 'flesh') {
      for (let i = 0; i < 3; i++) S.spawn(p.x, p.y, p.z, n.x * rand(0.5, 1.5) + rand(-0.4, 0.4), rand(0, 0.6), n.z * rand(0.5, 1.5) + rand(-0.4, 0.4), rand(0.25, 0.4), rand(0.15, 0.3), 0.42, 0.02, 0.01, 0.75, 0, { grow: 1.2, drag: 3 });
      for (let i = 0; i < 6; i++) S.spawn(p.x, p.y, p.z, n.x * rand(1, 3) + rand(-1, 1), rand(0, 2), n.z * rand(1, 3) + rand(-1, 1), rand(0.3, 0.6), 0.03, 0.35, 0.01, 0.01, 0.95, 3, { grav: 9 });
      return;
    }
    const dust = surf === 'dirt' ? [0.46, 0.38, 0.28] : surf === 'wood' ? [0.45, 0.36, 0.26] : [0.62, 0.6, 0.56];
    if (surf !== 'metal' && surf !== 'glass') for (let i = 0; i < 2; i++) S.spawn(p.x + n.x * 0.05, p.y + n.y * 0.05, p.z + n.z * 0.05, n.x * rand(0.6, 1.4) + rand(-0.3, 0.3), n.y * rand(0.6, 1.4) + rand(0, 0.4), n.z * rand(0.6, 1.4) + rand(-0.3, 0.3), rand(0.6, 1.1), rand(0.18, 0.3) * scale, dust[0], dust[1], dust[2], 0.6, 0, { grow: 0.9, drag: 2.5 });
    const chips = surf === 'metal' ? 0 : 6;
    for (let i = 0; i < chips; i++) S.spawn(p.x, p.y, p.z, n.x * rand(1, 4) + rand(-1.5, 1.5), n.y * rand(1, 4) + rand(0, 2), n.z * rand(1, 4) + rand(-1.5, 1.5), rand(0.4, 0.8), rand(0.02, 0.045), dust[0] * 0.7, dust[1] * 0.7, dust[2] * 0.7, 1, 3, { grav: 9.8, spin: rand(-12, 12) });
    if (surf === 'metal' || surf === 'concrete' && Math.random() < 0.3) for (let i = 0; i < (surf === 'metal' ? 10 : 3); i++) A.spawn(p.x, p.y, p.z, n.x * rand(2, 6) + rand(-2.5, 2.5), n.y * rand(2, 6) + rand(-1, 3), n.z * rand(2, 6) + rand(-2.5, 2.5), rand(0.12, 0.3), rand(0.03, 0.06), 1, 0.75, 0.35, 1, 1, { grav: 9.8 });
    if (surf === 'glass') for (let i = 0; i < 10; i++) A.spawn(p.x, p.y, p.z, rand(-1.5, 1.5) + n.x * 2, rand(-0.5, 2), rand(-1.5, 1.5) + n.z * 2, rand(0.4, 0.8), 0.03, 0.8, 0.9, 1, 0.8, 3, { grav: 9.8, spin: 10 });
  }
  glassBurst(cx, cy, cz, w, h) {
    for (let i = 0; i < 40; i++) this.add.spawn(cx + rand(-w, w) * 0.5, cy + rand(-h, h) * 0.5, cz + rand(-w, w) * 0.5, rand(-2, 2), rand(-1, 2), rand(-2, 2), rand(0.6, 1.4), rand(0.03, 0.07), 0.75, 0.85, 0.95, 0.9, 3, { grav: 9.8, spin: rand(-12, 12) });
  }
  muzzleSmoke(p, d) { this.alpha.spawn(p.x, p.y, p.z, d.x * 0.8 + rand(-0.15, 0.15), d.y * 0.8 + 0.2, d.z * 0.8 + rand(-0.15, 0.15), rand(0.5, 0.9), 0.12, 0.8, 0.78, 0.75, 0.22, 0, { grow: 0.8, drag: 2 }); }
  flash(p, scale = 1) { this.add.spawn(p.x, p.y, p.z, 0, 0, 0, 0.05, 0.6 * scale, 1, 0.78, 0.45, 1, 2, { spin: 0 }); }
  blood(p, d) { for (let i = 0; i < 5; i++) this.alpha.spawn(p.x, p.y, p.z, d.x * rand(1, 3) + rand(-0.5, 0.5), rand(-0.2, 1.2), d.z * rand(1, 3) + rand(-0.5, 0.5), rand(0.25, 0.45), rand(0.12, 0.25), 0.4, 0.02, 0.01, 0.8, 0, { grow: 1, drag: 3 }); }
  explosion(p, s = 1) {
    const A = this.add, S = this.alpha;
    A.spawn(p.x, p.y + 0.5, p.z, 0, 0, 0, 0.12, 6 * s, 1, 0.9, 0.7, 1, 1, { spin: 0 });
    for (let i = 0; i < 16; i++) A.spawn(p.x + rand(-0.5, 0.5), p.y + rand(0.2, 1), p.z + rand(-0.5, 0.5), rand(-3, 3) * s, rand(1, 5) * s, rand(-3, 3) * s, rand(0.35, 0.7), rand(1.2, 2.4) * s, 1, rand(0.45, 0.65), 0.18, 0.9, 2, { grow: 3 * s, drag: 3 });
    for (let i = 0; i < 40; i++) A.spawn(p.x, p.y + 0.4, p.z, rand(-14, 14) * s, rand(3, 16) * s, rand(-14, 14) * s, rand(0.4, 1.2), rand(0.04, 0.09), 1, 0.7, 0.3, 1, 1, { grav: 12 });
    for (let i = 0; i < 26; i++) S.spawn(p.x, p.y + 0.3, p.z, rand(-9, 9) * s, rand(4, 13) * s, rand(-9, 9) * s, rand(0.8, 1.6), rand(0.05, 0.14), 0.12, 0.1, 0.08, 1, 3, { grav: 11, spin: rand(-10, 10) });
    for (let i = 0; i < 16; i++) S.spawn(p.x + rand(-1, 1), p.y + rand(0.4, 2.2), p.z + rand(-1, 1), rand(-1.5, 1.5), rand(0.6, 2.2), rand(-1.5, 1.5), rand(3, 5.5), rand(1.8, 3) * s, 0.2, 0.18, 0.16, 0.7, 0, { grow: 1.6 * s, drag: 0.8, fadeIn: 0.15 });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * 6.28; S.spawn(p.x, p.y + 0.2, p.z, Math.cos(a) * 7 * s, 0.4, Math.sin(a) * 7 * s, rand(1, 1.6), 1.2 * s, 0.5, 0.42, 0.32, 0.5, 0, { grow: 2.4, drag: 3 }); }
  }
  fire(p, k = 1) {
    if (Math.random() < 0.7 * k) this.add.spawn(p.x + rand(-0.35, 0.35), p.y + rand(-0.1, 0.1), p.z + rand(-0.35, 0.35), rand(-0.2, 0.2), rand(1.2, 2.2), rand(-0.2, 0.2), rand(0.4, 0.75), rand(0.45, 0.8) * k, 1, rand(0.42, 0.6), 0.15, 0.85, 2, { grow: -0.4, drag: 0.5 });
    if (Math.random() < 0.18 * k) this.add.spawn(p.x, p.y + 0.2, p.z, rand(-0.6, 0.6), rand(1.5, 3.5), rand(-0.6, 0.6), rand(0.8, 1.6), 0.035, 1, 0.6, 0.2, 1, 1, { drag: 0.4 });
    if (Math.random() < 0.3 * k) this.alpha.spawn(p.x + rand(-0.3, 0.3), p.y + 0.9, p.z + rand(-0.3, 0.3), rand(-0.3, 0.3) + 0.25, rand(1.2, 2), rand(-0.3, 0.3), rand(3, 5), rand(0.6, 1.1), 0.1, 0.09, 0.08, 0.5, 0, { grow: 1.1, drag: 0.3, fadeIn: 0.2 });
  }
  smokeColumn(p) { this.alpha.spawn(p.x + rand(-3, 3), p.y + rand(0, 4), p.z + rand(-3, 3), 1.2 + rand(-0.5, 0.5), rand(2, 3.5), rand(-0.5, 0.5), rand(12, 18), rand(8, 14), 0.16, 0.15, 0.14, 0.55, 0, { grow: 2.2, drag: 0.05, fadeIn: 0.1 }); }
  // ---------------- decals ----------------
  decal(kind, p, n, size) {
    const D = this.dec[kind]; if (!D) return;
    this._v.set(n.x, n.y, n.z); this._q.setFromUnitVectors(this._z, this._v);
    const spin = new THREE.Quaternion().setFromAxisAngle(this._z, Math.random() * 6.28); this._q.multiply(spin);
    this._m.compose(this._s.set(p.x + n.x * 0.006, p.y + n.y * 0.006, p.z + n.z * 0.006), this._q, new THREE.Vector3(size, size, size));
    D.mesh.setMatrixAt(D.i, this._m); D.i = (D.i + 1) % D.max; D.n = Math.min(D.n + 1, D.max); D.mesh.count = D.n; D.mesh.instanceMatrix.needsUpdate = true;
  }
  // ---------------- tracers ----------------
  tracer(o, dir, dist, speed = 520, len = 3.5, col = [1, 0.75, 0.4]) {
    if (this.tr.length >= this.trMax) this.tr.shift();
    this.tr.push({ ox: o.x, oy: o.y, oz: o.z, dx: dir.x, dy: dir.y, dz: dir.z, dist, t: 0, speed, len, col });
  }
  // ---------------- shells ----------------
  shell(p, v) {
    if (this.shells.length >= this.shellMax) this.shells.shift();
    this.shells.push({ x: p.x, y: p.y, z: p.z, vx: v.x, vy: v.y, vz: v.z, rx: Math.random() * 6, ry: Math.random() * 6, wx: rand(-25, 25), wy: rand(-25, 25), life: 6, bounced: false, rest: false });
  }
  light(p, color = 0xffaa55, intensity = 6, dur = 0.06, dist = 12) {
    let best = this.lights[0];
    for (const l of this.lights) if (l.userData.t <= 0) { best = l; break; } else if (l.userData.t < best.userData.t) best = l;
    if (!best) return;
    best.position.set(p.x, p.y, p.z); best.color.setHex(color); best.distance = dist; best.userData.t = dur; best.userData.d = dur; best.userData.i0 = intensity; best.intensity = intensity;
  }
  update(dt, cam, renderer) {
    const sc = renderer.r.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    const fog = this.scene.fog;
    for (const ps of [this.add, this.alpha]) { ps.mat.uniforms.uScale.value = sc; ps.mat.uniforms.uFog.value.copy(fog.color); ps.mat.uniforms.uDensity.value = fog.density; ps.update(dt); }
    // tracers
    let k = 0; this.tr = this.tr.filter((t) => (t.t += t.speed * dt) - t.len < t.dist);
    for (const t of this.tr) {
      const a = Math.max(0, t.t - t.len), b = Math.min(t.dist, t.t), i = k * 6;
      this.trPos[i] = t.ox + t.dx * a; this.trPos[i + 1] = t.oy + t.dy * a; this.trPos[i + 2] = t.oz + t.dz * a;
      this.trPos[i + 3] = t.ox + t.dx * b; this.trPos[i + 4] = t.oy + t.dy * b; this.trPos[i + 5] = t.oz + t.dz * b;
      this.trCol[i] = t.col[0] * 0.15; this.trCol[i + 1] = t.col[1] * 0.15; this.trCol[i + 2] = t.col[2] * 0.15; this.trCol[i + 3] = t.col[0]; this.trCol[i + 4] = t.col[1]; this.trCol[i + 5] = t.col[2];
      k++;
    }
    for (let i = k * 6; i < this.trMax * 6; i++) this.trPos[i] = 0;
    this.trLines.geometry.attributes.position.needsUpdate = true; this.trLines.geometry.attributes.color.needsUpdate = true; this.trLines.geometry.setDrawRange(0, k * 2);
    // shells
    const W = G.world;
    this.shells = this.shells.filter((s) => (s.life -= dt) > 0);
    let j = 0;
    for (const s of this.shells) {
      if (!s.rest) {
        s.vy -= 9.8 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.rx += s.wx * dt; s.ry += s.wy * dt;
        const gy = W ? W.groundAt(s.x, s.z, s.y + 0.1, 0.02, 0.15) : 0;
        if (s.y < gy + 0.006) {
          s.y = gy + 0.006;
          if (!s.bounced && G.audio && G.player && Math.hypot(s.x - G.player.pos.x, s.z - G.player.pos.z) < 8) G.audio.foley('casing', { x: s.x, y: s.y, z: s.z });
          s.bounced = true; s.vy = -s.vy * 0.3; s.vx *= 0.5; s.vz *= 0.5; s.wx *= 0.5; s.wy *= 0.5;
          if (Math.abs(s.vy) < 0.3) { s.rest = true; s.rx = Math.PI / 2 * Math.round(s.rx / (Math.PI / 2)); }
        }
      }
      this._e.set(s.rx, s.ry, 0); this._q.setFromEuler(this._e); this._m.compose(this._s.set(s.x, s.y, s.z), this._q, this._v.set(1, 1, 1));
      this.shellMesh.setMatrixAt(j++, this._m);
    }
    this.shellMesh.count = j; this.shellMesh.instanceMatrix.needsUpdate = true;
    for (const l of this.lights) if (l.userData.t > 0) { l.userData.t -= dt; l.intensity = l.userData.i0 * Math.max(0, l.userData.t / l.userData.d); } else l.intensity = 0;
  }
  clear() {
    this.add.n = 0; this.alpha.n = 0; this.tr.length = 0; this.shells.length = 0;
    for (const D of Object.values(this.dec)) { D.n = 0; D.i = 0; D.mesh.count = 0; }
  }
}
