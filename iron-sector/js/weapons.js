// Weapons: data, procedural first-person models with IK arms, animation (ADS, recoil, reload, bolt, pump, sprint, melee, throw) and firing.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, settings, clamp, lerp, rand, damp, Spring, smoothstep } from './core.js';
import { MAT } from './textures.js';

export const WEAPONS = {
  ar7:   { name: 'AR-7 Vanguard', cls: 'ar', model: 'ar', sound: 'ar', auto: true, semiToggle: true, rpm: 760, dmg: [34, 24], range: [32, 70], mag: 30, reserve: 180, reload: 2.1, reloadEmpty: 2.75, adsTime: 0.24, hip: 3.0, adsMul: 0.12, move: 1.0, recoil: [0.0115, 0.0055], pen: 1, optic: 'reddot', price: 0, drop: 'ar7' },
  smg9:  { name: 'SMG-9 Wasp', cls: 'smg', model: 'smg', sound: 'smg', auto: true, rpm: 920, dmg: [27, 16], range: [16, 38], mag: 32, reserve: 224, reload: 1.85, reloadEmpty: 2.3, adsTime: 0.17, hip: 2.2, adsMul: 0.22, move: 1.08, recoil: [0.0085, 0.0068], pen: 0.5, optic: 'holo', price: 900 },
  m88:   { name: 'M88 Breacher', cls: 'shotgun', model: 'shotgun', sound: 'shotgun', auto: false, rpm: 72, pellets: 9, dmg: [22, 7], range: [7, 22], mag: 7, reserve: 42, shell: 0.52, adsTime: 0.22, hip: 4.6, adsMul: 0.75, move: 1.0, recoil: [0.05, 0.012], pen: 0.3, optic: null, price: 1200, pump: 0.62 },
  lmg60: { name: 'LMG-60 Mauler', cls: 'lmg', model: 'lmg', sound: 'lmg', auto: true, rpm: 660, dmg: [38, 28], range: [45, 90], mag: 100, reserve: 300, reload: 4.6, reloadEmpty: 5.2, adsTime: 0.38, hip: 3.8, adsMul: 0.16, move: 0.86, recoil: [0.0125, 0.009], pen: 1.4, optic: 'reddot', price: 2200 },
  sr50:  { name: 'SR-50 Longbow', cls: 'sniper', model: 'sniper', sound: 'sniper', auto: false, rpm: 46, dmg: [150, 130], range: [90, 160], mag: 5, reserve: 30, reload: 3.1, reloadEmpty: 3.5, adsTime: 0.42, hip: 8, adsMul: 0.0, move: 0.9, recoil: [0.06, 0.012], pen: 2.2, optic: 'sniper', price: 2800, bolt: 1.0 },
  dmr14: { name: 'DMR-14 Ranger', cls: 'dmr', model: 'dmr', sound: 'dmr', auto: false, rpm: 340, dmg: [62, 50], range: [60, 110], mag: 15, reserve: 90, reload: 2.35, reloadEmpty: 2.9, adsTime: 0.3, hip: 3.4, adsMul: 0.04, move: 0.95, recoil: [0.03, 0.008], pen: 1.6, optic: 'acog', price: 1800 },
  p9:    { name: 'P9 Sidearm', cls: 'pistol', model: 'pistol', sound: 'pistol', auto: false, rpm: 450, dmg: [34, 20], range: [14, 32], mag: 15, reserve: 60, reload: 1.45, reloadEmpty: 1.75, adsTime: 0.14, hip: 1.9, adsMul: 0.3, move: 1.1, recoil: [0.022, 0.008], pen: 0.5, optic: null, price: 0, secondary: true },
  lr1:   { name: 'LR-1 Torch', cls: 'launcher', model: 'launcher', sound: 'launcher', auto: false, rpm: 30, rocket: true, dmg: [0, 0], range: [1, 1], mag: 1, reserve: 3, reload: 3.0, reloadEmpty: 3.0, adsTime: 0.35, hip: 2.5, adsMul: 0.4, move: 0.9, recoil: [0.05, 0.01], pen: 0, optic: null, price: 2500, secondary: true }
};
export const OPTICS = { reddot: { name: 'Red dot', zoom: 1.25, price: 300 }, holo: { name: 'Holographic', zoom: 1.3, price: 350 }, acog: { name: '4x scope', zoom: 3.2, price: 600, overlay: 'acog' }, sniper: { name: 'Sniper scope', zoom: 7.5, overlay: 'sniper' } };
export const ATTACH = { suppressor: { name: 'Suppressor', price: 600 }, extmag: { name: 'Extended mags', price: 500 }, grip: { name: 'Foregrip', price: 400 } };

export function makeWeapon(id, full = true) {
  const d = WEAPONS[id];
  return { id, def: d, mag: d.mag, reserve: full ? d.reserve : Math.floor(d.reserve / 3), att: { optic: d.optic, suppressor: false, extmag: false, grip: false }, semi: false };
}
export const magSize = (w) => (w.att.extmag ? Math.round(w.def.mag * 1.5) : w.def.mag);

// one merged mesh per weapon for third-person use (soldiers, pickups); cached
const _wg = new Map();
export function worldGun(id) {
  if (_wg.has(id)) return _wg.get(id);
  LITE = true; const g = buildModel(makeWeapon(id)); LITE = false; g.updateMatrixWorld(true);
  const parts = [];
  g.traverse((o) => {
    if (!o.isMesh || o.material.isShaderMaterial || o.material.transparent || o.geometry.type === 'TorusGeometry' || o.geometry.type === 'CircleGeometry') return;
    let vis = true; for (let p = o; p; p = p.parent) if (!p.visible) vis = false;
    if (!vis) return;
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone(); geo.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
    parts.push(geo);
  });
  const info = { geo: mergeGeometries(parts, false), fore: g.userData.fore.clone(), muzzle: g.userData.muzzle.clone() };
  for (const p of parts) p.dispose();
  _wg.set(id, info); return info;
}

// ------------------------------------------------------------------ models
// slightly lighter, less mirror-like finishes than the world materials so the guns read clearly up close
let VM = null;
function vmMats() {
  if (VM) return VM;
  const metal = MAT.gunmetal.clone(); metal.color.setScalar(1.6); metal.metalness = 0.7; metal.envMapIntensity = 1.3;
  const poly = MAT.polymer.clone(); poly.color.setScalar(1.75); poly.envMapIntensity = 0.9;
  const tube = metal.clone(); tube.side = THREE.DoubleSide;
  const glove = new THREE.MeshStandardMaterial({ color: 0x6f6149, roughness: 0.88, normalMap: MAT.camo.normalMap });
  const sleeve = MAT.camo.clone(); sleeve.color.setScalar(1.05);
  VM = { metal, poly, tube, glove, sleeve }; return VM;
}
// LITE: third-person guns use plain boxes and few segments (they are tiny on screen)
let LITE = false;
const rb = (w, h, d, r = 0.004) => (LITE ? new THREE.BoxGeometry(w, h, d) : new RoundedBoxGeometry(w, h, d, 2, Math.min(r, w / 2.2, h / 2.2, d / 2.2)));
function P(parent, geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; }
const cylZ = (r, l, s = 12, r2 = r) => new THREE.CylinderGeometry(r2, r, l, LITE ? 6 : s).rotateX(Math.PI / 2);
function reticleMat(kind) {
  return new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { k: { value: kind === 'holo' ? 1 : 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform float k; void main(){ vec2 p = (vUv - 0.5) * 2.0; float r = length(p); float d = smoothstep(0.12, 0.06, r); float ring = k > 0.5 ? smoothstep(0.06, 0.0, abs(r - 0.66)) : 0.0; float a = max(d, ring * 0.9); gl_FragColor = vec4(vec3(1.0, 0.16, 0.1) * a * 2.4, a); }' });
}
function optic(group, kind, y, z) {
  const g = new THREE.Group(); g.position.set(0, y, z); group.add(g); let sightY = 0.04;
  const M = vmMats().metal;
  if (kind === 'reddot') {
    P(g, rb(0.03, 0.014, 0.05), M, 0, 0.007, 0); P(g, new THREE.CylinderGeometry(0.019, 0.019, 0.055, 22, 1, true).rotateX(Math.PI / 2), vmMats().tube, 0, 0.035, 0);
    P(g, new THREE.TorusGeometry(0.019, 0.0035, 6, 22), M, 0, 0.035, -0.0275); P(g, new THREE.TorusGeometry(0.019, 0.0035, 6, 22), M, 0, 0.035, 0.0275);
    const ret = P(g, new THREE.PlaneGeometry(0.02, 0.02), reticleMat('dot'), 0, 0.035, 0.03); ret.renderOrder = 5; sightY = 0.035;
    const lens = P(g, new THREE.CircleGeometry(0.016, 20), new THREE.MeshStandardMaterial({ color: 0x5a7f9a, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.5, depthWrite: false }), 0, 0.035, -0.024); lens.renderOrder = 4;
  } else if (kind === 'holo') {
    P(g, rb(0.045, 0.012, 0.075), M, 0, 0.006, 0);
    for (const [x, yy, w, h] of [[-0.022, 0.036, 0.006, 0.05], [0.022, 0.036, 0.006, 0.05], [0, 0.062, 0.05, 0.006]]) P(g, rb(w, h, 0.07, 0.002), M, x, yy, 0);
    P(g, rb(0.05, 0.022, 0.02), M, 0, 0.022, 0.03);
    const ret = P(g, new THREE.PlaneGeometry(0.03, 0.03), reticleMat('holo'), 0, 0.037, 0.0); ret.renderOrder = 5; sightY = 0.037;
  } else if (kind === 'acog' || kind === 'sniper') {
    const L = kind === 'sniper' ? 0.32 : 0.15, R = kind === 'sniper' ? 0.019 : 0.018;
    P(g, rb(0.025, 0.02, L * 0.6), M, 0, 0.01, 0);
    P(g, cylZ(R, L, 18), M, 0, 0.042, 0); P(g, cylZ(R * 1.5, 0.05, 18, R), M, 0, 0.042, -L / 2 - 0.02); P(g, cylZ(R * 1.3, 0.04, 18, R * 1.1), M, 0, 0.042, L / 2 + 0.015);
    P(g, new THREE.CircleGeometry(R * 1.2, 20), MAT.darkGlass, 0, 0.042, L / 2 + 0.036);
    if (kind === 'sniper') P(g, cylZ(0.012, 0.03, 10), M, 0.022, 0.042, 0).rotation.set(0, 0, Math.PI / 2);
    sightY = 0.042;
  }
  g.userData.sightY = y + sightY; g.userData.z = z; return g;
}
// every weapon: group facing -Z, origin at the pistol grip. Anchors: grip, fore, mag, eject, muzzle, sightY, bolt
function buildModel(w) {
  const d = w.def, g = new THREE.Group(), V = vmMats(), M = V.metal, Pm = V.poly, A = {};
  const part = (name) => { const o = new THREE.Group(); o.name = name; g.add(o); A[name] = o; return o; };
  let fore = new THREE.Vector3(0, -0.005, -0.33), muzzle = new THREE.Vector3(0, 0.045, -0.75), eject = new THREE.Vector3(0.03, 0.06, -0.03), sightY = 0.115, railY = 0.093, railZ = -0.05, magPos = new THREE.Vector3(0, -0.03, -0.11), bolt = new THREE.Vector3(0.0, 0.075, 0.08);
  const mag = part('mag'), boltG = part('bolt');
  switch (d.model) {
    case 'ar': case 'dmr': {
      const long = d.model === 'dmr';
      P(g, rb(0.05, 0.07, 0.26), M, 0, 0.0, -0.04); P(g, rb(0.056, 0.05, 0.32), M, 0, 0.056, -0.08);
      P(g, rb(0.026, 0.012, 0.3, 0.002), M, 0, 0.087, -0.09); for (let i = 0; i < 12; i++) P(g, new THREE.BoxGeometry(0.03, 0.004, 0.008), M, 0, 0.094, -0.22 + i * 0.024);
      P(g, rb(0.064, 0.066, long ? 0.38 : 0.3, 0.008), Pm, 0, 0.046, long ? -0.4 : -0.36);
      P(g, cylZ(0.011, long ? 0.34 : 0.24), M, 0, 0.046, long ? -0.74 : -0.62); P(g, cylZ(0.016, 0.06, 8), M, 0, 0.046, long ? -0.93 : -0.76);
      P(g, rb(0.032, 0.1, 0.045), Pm, 0, -0.07, 0.04, -0.3); P(g, rb(0.006, 0.03, 0.06, 0.002), M, 0, -0.042, -0.02);
      P(g, cylZ(0.016, 0.18), M, 0, 0.046, 0.17); P(g, rb(0.046, 0.085, 0.17, 0.01), Pm, 0, 0.03, 0.27); P(g, rb(0.046, 0.03, 0.06), Pm, 0, -0.01, 0.33);
      P(g, rb(0.01, 0.02, 0.05), M, 0.03, 0.06, -0.03);
      P(mag, rb(0.03, long ? 0.12 : 0.17, 0.068, 0.006), M, 0, long ? -0.06 : -0.085, 0, 0.18); mag.position.copy(magPos);
      P(boltG, rb(0.02, 0.012, 0.03, 0.002), M, 0, 0, 0); boltG.position.copy(bolt);
      if (!w.att.optic) { P(g, rb(0.02, 0.025, 0.02), M, 0, 0.105, 0.02); P(g, rb(0.006, 0.03, 0.006), M, 0, 0.1, long ? -0.6 : -0.48); }
      muzzle.set(0, 0.046, long ? -0.96 : -0.79); fore.set(0, -0.005, long ? -0.4 : -0.35); break;
    }
    case 'smg': {
      P(g, rb(0.05, 0.085, 0.27), M, 0, 0.03, -0.06); P(g, rb(0.026, 0.012, 0.22, 0.002), M, 0, 0.078, -0.07);
      P(g, rb(0.055, 0.06, 0.16, 0.008), Pm, 0, 0.04, -0.27); P(g, cylZ(0.012, 0.12), M, 0, 0.045, -0.4); P(g, cylZ(0.016, 0.04, 8), M, 0, 0.045, -0.47);
      P(g, rb(0.032, 0.1, 0.045), Pm, 0, -0.06, 0.03, -0.25); P(g, rb(0.03, 0.09, 0.035), Pm, 0, -0.04, -0.29, 0.1);
      P(g, rb(0.012, 0.04, 0.2, 0.004), M, 0, 0.03, 0.17); P(g, rb(0.03, 0.06, 0.03), Pm, 0, 0.02, 0.27);
      P(mag, rb(0.026, 0.16, 0.045, 0.005), M, 0, -0.08, 0, 0.05); magPos.set(0, -0.02, -0.1); mag.position.copy(magPos);
      P(boltG, rb(0.016, 0.012, 0.025, 0.002), M, 0, 0, 0); bolt.set(-0.03, 0.06, -0.03); boltG.position.copy(bolt);
      if (!w.att.optic) { P(g, rb(0.02, 0.02, 0.02), M, 0, 0.095, 0.03); P(g, rb(0.006, 0.026, 0.006), M, 0, 0.09, -0.32); }
      muzzle.set(0, 0.045, -0.5); fore.set(0, -0.06, -0.29); railY = 0.084; railZ = -0.06; sightY = 0.105; eject.set(0.03, 0.06, -0.06); break;
    }
    case 'shotgun': {
      P(g, rb(0.055, 0.075, 0.24), M, 0, 0.03, -0.04); P(g, cylZ(0.016, 0.62), M, 0, 0.06, -0.46); P(g, cylZ(0.014, 0.52), M, 0, 0.022, -0.42);
      P(g, rb(0.032, 0.1, 0.045), Pm, 0, -0.06, 0.04, -0.3); P(g, rb(0.048, 0.08, 0.26, 0.012), Pm, 0, 0.02, 0.22); P(g, rb(0.05, 0.1, 0.06), Pm, 0, -0.005, 0.34);
      const pump = part('pump'); P(pump, rb(0.05, 0.05, 0.18, 0.012), Pm, 0, 0, 0); pump.position.set(0, 0.022, -0.34);
      P(g, rb(0.004, 0.026, 0.006, 0.0015), M, 0, 0.088, -0.74); P(g, new THREE.SphereGeometry(0.0035, 8, 6), MAT.brass, 0, 0.1, -0.74);
      P(g, rb(0.024, 0.018, 0.03, 0.003), M, 0, 0.074, 0.02); P(g, new THREE.TorusGeometry(0.009, 0.0028, 6, 16), M, 0, 0.1, 0.02); P(g, rb(0.004, 0.02, 0.006, 0.0015), M, -0.009, 0.088, 0.02); P(g, rb(0.004, 0.02, 0.006, 0.0015), M, 0.009, 0.088, 0.02);
      muzzle.set(0, 0.06, -0.78); fore.set(0, -0.015, -0.34); sightY = 0.1; magPos.set(0, -0.005, -0.08); eject.set(0.03, 0.04, -0.05); mag.visible = false; break;
    }
    case 'lmg': {
      P(g, rb(0.07, 0.09, 0.34), M, 0, 0.03, -0.06); P(g, rb(0.06, 0.03, 0.3), M, 0, 0.085, -0.06);
      P(g, rb(0.072, 0.07, 0.28, 0.008), Pm, 0, 0.04, -0.38); P(g, cylZ(0.014, 0.42), M, 0, 0.045, -0.7); P(g, cylZ(0.02, 0.07, 8), M, 0, 0.045, -0.93);
      P(g, rb(0.02, 0.06, 0.12), M, 0, 0.12, -0.08); P(g, rb(0.032, 0.1, 0.045), Pm, 0, -0.07, 0.05, -0.3);
      P(g, rb(0.05, 0.1, 0.22, 0.01), Pm, 0, 0.02, 0.26); P(g, cylZ(0.006, 0.25), M, 0.015, -0.01, -0.5); P(g, cylZ(0.006, 0.25), M, -0.015, -0.01, -0.5);
      P(mag, rb(0.09, 0.1, 0.12, 0.008), MAT.metalGreen, -0.02, -0.07, 0); magPos.set(0, -0.01, -0.12); mag.position.copy(magPos);
      P(boltG, rb(0.02, 0.014, 0.03), M, 0, 0, 0); bolt.set(0.04, 0.06, 0.0); boltG.position.copy(bolt);
      muzzle.set(0, 0.045, -0.97); fore.set(0, -0.01, -0.4); railY = 0.1; railZ = -0.12; sightY = 0.14; break;
    }
    case 'sniper': {
      P(g, rb(0.05, 0.065, 0.3), M, 0, 0.03, -0.05); P(g, cylZ(0.013, 0.62), M, 0, 0.045, -0.5); P(g, cylZ(0.018, 0.08, 10), M, 0, 0.045, -0.83);
      P(g, rb(0.06, 0.07, 0.34, 0.01), MAT.metalGreen, 0, 0.0, -0.36); P(g, rb(0.032, 0.1, 0.045), Pm, 0, -0.06, 0.05, -0.35);
      P(g, rb(0.05, 0.09, 0.3, 0.012), MAT.metalGreen, 0, 0.015, 0.25); P(g, rb(0.04, 0.03, 0.12), MAT.metalGreen, 0, 0.07, 0.22);
      P(mag, rb(0.04, 0.07, 0.08, 0.005), M, 0, -0.04, 0); magPos.set(0, -0.02, -0.08); mag.position.copy(magPos);
      P(boltG, cylZ(0.008, 0.05, 8), M, 0, 0, 0); P(boltG, new THREE.SphereGeometry(0.011, 10, 8), M, 0.045, -0.012, 0.01); P(boltG, cylZ(0.004, 0.045, 6).rotateY(Math.PI / 2), M, 0.024, -0.006, 0.01);
      bolt.set(0.0, 0.06, 0.05); boltG.position.copy(bolt);
      muzzle.set(0, 0.045, -0.87); fore.set(0, -0.03, -0.38); railY = 0.07; railZ = -0.05; break;
    }
    case 'pistol': {
      const slide = part('slide'); P(slide, rb(0.032, 0.035, 0.19, 0.005), M, 0, 0, 0); slide.position.set(0, 0.045, -0.06);
      P(g, rb(0.03, 0.025, 0.16, 0.004), Pm, 0, 0.018, -0.05); P(g, rb(0.031, 0.11, 0.05, 0.008), Pm, 0, -0.04, 0.02, -0.2);
      P(g, rb(0.008, 0.012, 0.008), M, 0, 0.068, -0.145); P(g, rb(0.022, 0.01, 0.008), M, 0, 0.068, 0.025);
      P(mag, rb(0.024, 0.1, 0.04, 0.004), M, 0, -0.05, 0, -0.2); magPos.set(0, -0.03, 0.02); mag.position.copy(magPos);
      muzzle.set(0, 0.045, -0.16); fore.set(-0.01, -0.06, 0.02); sightY = 0.074; eject.set(0.02, 0.06, -0.03); bolt.copy(slide.position); break;
    }
    case 'launcher': {
      P(g, cylZ(0.045, 0.95, 16), MAT.metalGreen, 0.0, 0.07, -0.18); P(g, cylZ(0.05, 0.08, 16), M, 0, 0.07, -0.66); P(g, cylZ(0.05, 0.08, 16), M, 0, 0.07, 0.3);
      P(g, rb(0.032, 0.1, 0.045), Pm, 0, -0.04, 0.0, -0.2); P(g, rb(0.03, 0.09, 0.04), Pm, 0, -0.03, -0.3); P(g, rb(0.02, 0.05, 0.05), M, -0.05, 0.14, -0.15);
      const rk = part('rocket'); P(rk, new THREE.ConeGeometry(0.04, 0.16, 12).rotateX(-Math.PI / 2), MAT.metalGrey, 0, 0, 0); rk.position.set(0, 0.07, -0.78);
      muzzle.set(0, 0.07, -0.8); fore.set(0, -0.03, -0.3); sightY = 0.165; mag.visible = false; break;
    }
  }
  if (w.att.optic && d.model !== 'pistol' && d.model !== 'launcher' && d.model !== 'shotgun') { const o = optic(g, w.att.optic, railY, railZ); sightY = o.userData.sightY; A.optic = o; }
  if (w.att.suppressor) { P(g, cylZ(0.022, 0.19, 14), MAT.gunmetal, 0, muzzle.y, muzzle.z - 0.09); muzzle.z -= 0.18; }
  if (w.att.extmag && A.mag && A.mag.children[0]) A.mag.children[0].scale.y = 1.35;
  if (w.att.grip && (d.model === 'ar' || d.model === 'dmr' || d.model === 'lmg')) { P(g, rb(0.026, 0.08, 0.03, 0.008), Pm, 0, -0.03, fore.z); fore.set(0.0, -0.07, fore.z); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
  g.userData = { A, fore, muzzle, eject, sightY, magPos: magPos.clone(), bolt: bolt.clone(), boltPos: A.bolt ? A.bolt.position.clone() : null };
  return g;
}

// ------------------------------------------------------------------ arms (rigid segments + two-bone IK)
function cap(r, l) { const g = new THREE.CapsuleGeometry(r, l, 4, 10); g.translate(0, l / 2, 0); g.userData = { len: l }; return g; }
class Arms {
  constructor(scene) {
    const sleeve = vmMats().sleeve, glove = vmMats().glove;
    this.parts = {};
    for (const side of ['L', 'R']) {
      const up = new THREE.Mesh(cap(0.05, 0.3), sleeve), lo = new THREE.Mesh(cap(0.044, 0.28), sleeve), hand = new THREE.Group();
      const palm = new THREE.Mesh(rb(0.084, 0.04, 0.095, 0.012), glove); hand.add(palm);
      const fing = new THREE.Mesh(rb(0.08, 0.03, 0.065, 0.01), glove); fing.position.set(0, -0.022, -0.055); fing.rotation.x = 0.7; hand.add(fing);
      const thumb = new THREE.Mesh(rb(0.026, 0.026, 0.06, 0.01), glove); thumb.position.set(side === 'R' ? -0.045 : 0.045, 0.012, -0.03); thumb.rotation.y = side === 'R' ? 0.5 : -0.5; hand.add(thumb);
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.05, 0.05, 12), glove); cuff.position.set(0, 0, 0.06); cuff.rotation.x = Math.PI / 2; hand.add(cuff);
      for (const m of [up, lo, palm, fing, thumb, cuff]) { m.frustumCulled = false; }
      scene.add(up, lo, hand); this.parts[side] = { up, lo, hand };
    }
    this._u = new THREE.Vector3(); this._w = new THREE.Vector3(); this._e = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._x = new THREE.Vector3(); this._y = new THREE.Vector3(); this._z = new THREE.Vector3();
  }
  _seg(mesh, a, b, roll) {
    const y = this._y.subVectors(b, a); const L = y.length(); y.divideScalar(L || 1);
    const x = this._x.copy(roll).addScaledVector(y, -roll.dot(y)).normalize(), z = this._z.crossVectors(x, y);
    const k = L / mesh.geometry.userData.len;
    this._m.makeBasis(x, y.multiplyScalar(k), z).setPosition(a); mesh.matrixAutoUpdate = false; mesh.matrix.copy(this._m); mesh.matrixWorldNeedsUpdate = true;
  }
  solve(side, shoulder, hand, pole, handQuat, a = 0.3, b = 0.27) {
    const P = this.parts[side], u = this._u.subVectors(hand, shoulder); let d = u.length(); u.divideScalar(d || 1); d = Math.min(d, (a + b) * 0.995);
    const x = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(a * a - x * x, 0));
    const w = this._w.copy(pole).addScaledVector(u, -pole.dot(u)).normalize();
    const e = this._e.copy(shoulder).addScaledVector(u, x).addScaledVector(w, h);
    const tip = new THREE.Vector3().copy(shoulder).addScaledVector(u, d);
    this._seg(P.up, shoulder, e, w); this._seg(P.lo, e, tip, w);
    P.hand.position.copy(hand); P.hand.quaternion.copy(handQuat);
  }
  setVisible(v) { for (const s of ['L', 'R']) for (const m of Object.values(this.parts[s])) m.visible = v; }
}

// ------------------------------------------------------------------ the arsenal: inventory + viewmodel + firing
const seg = (p, a, b) => clamp((p - a) / (b - a), 0, 1), sm = (t) => t * t * (3 - 2 * t);
const V3 = THREE.Vector3;
export class Arsenal {
  constructor(vmScene, vmCam) {
    this.scene = vmScene; this.cam = vmCam;
    this.root = new THREE.Group(); vmScene.add(this.root);
    this.pivot = new THREE.Group(); this.root.add(this.pivot);
    this.arms = new Arms(vmScene);
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTexture(), blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true }));
    this.flash.visible = false; this.flash.renderOrder = 10; vmScene.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 3, 2); vmScene.add(this.flashLight);
    this.knife = new THREE.Group(); P(this.knife, rb(0.02, 0.025, 0.11, 0.006), MAT.polymer, 0, 0, 0.0); P(this.knife, new THREE.BoxGeometry(0.004, 0.03, 0.16), MAT.gunmetal, 0, 0.004, -0.13); this.knife.visible = false; vmScene.add(this.knife);
    this.nade = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 10), MAT.metalGreen); this.nade.visible = false; vmScene.add(this.nade);
    this.models = new Map(); this.reset();
    this.kZ = new Spring(160, 16); this.kP = new Spring(140, 14); this.kY = new Spring(120, 14); this.kR = new Spring(110, 12); this.land = new Spring(90, 12); this.swayX = 0; this.swayY = 0;
  }
  reset() {
    this.slots = [makeWeapon('ar7'), makeWeapon('p9')]; this.cur = 0; this.state = 'raise'; this.st = 0; this.ads = 0; this.sprint = 0; this.bloom = 0; this.lastShot = -9; this.phase = 0;
    this.reloadApplied = false; this.wantReload = false; this.fireHeld = false; this.cook = 0; this.cooking = null; this.pendingFire = false; this.inspect = 0; this.switchTo = -1;
    this._equip();
  }
  get w() { return this.slots[this.cur]; }
  _sig(w) { return w.id + JSON.stringify(w.att); }
  _equip() {
    if (this.model) this.pivot.remove(this.model);
    const w = this.w, k = this._sig(w); let m = this.models.get(k); if (!m) { m = buildModel(w); this.models.set(k, m); }
    this.model = m; this.pivot.add(m); this.state = 'raise'; this.st = 0; this.reloadApplied = false; this.wantReload = false;
    if (G.audio) G.audio.foley('switch');
  }
  refreshModel() { this.models.delete(this._sig(this.w)); this._equip(); this.state = 'idle'; }
  give(id) {
    const d = WEAPONS[id], slot = d.secondary ? 1 : 0;
    this.slots[slot] = makeWeapon(id); this.cur = slot; this._equip();
  }
  pickup(w) { const slot = w.def.secondary ? 1 : 0; const old = this.slots[slot]; this.slots[slot] = w; this.cur = slot; this._equip(); return old; }
  refill() { for (const w of this.slots) { w.reserve = w.def.reserve * (w.att.extmag ? 1.5 : 1) | 0; } }
  get busy() { return this.state !== 'idle'; }
  get scoped() { const o = this.w.att.optic; return this.ads > 0.9 && (o === 'sniper' || o === 'acog') && this.state !== 'reload' && this.w.def.model !== 'pistol'; }
  zoom() { const o = this.w.att.optic; if (this.w.def.model === 'pistol' || this.w.def.model === 'shotgun' || this.w.def.model === 'launcher') return 1.15; return o ? OPTICS[o].zoom : 1.15; }

  startReload() {
    const w = this.w; if (this.state !== 'idle' || w.mag >= magSize(w) || w.reserve <= 0) return;
    this.state = w.def.cls === 'shotgun' ? 'shellStart' : 'reload'; this.st = 0; this.reloadEmpty = w.mag === 0; this.reloadApplied = false;
    this.reloadT = w.def.cls === 'shotgun' ? 0.35 : this.reloadEmpty ? w.def.reloadEmpty : w.def.reload;
    if (G.player && G.player.perkFast) this.reloadT *= 0.8;
  }
  switchWeapon(idx) {
    if (idx === this.cur || idx < 0 || idx > 1 || !this.slots[idx]) return;
    if (this.state === 'lower') return; this.switchTo = idx; this.state = 'lower'; this.st = 0;
  }

  update(dt, A, pl) {
    const w = this.w, d = w.def;
    this.st += dt;
    // ---------------- state machine ----------------
    if (A.swap) this.switchWeapon(1 - this.cur); else if (A.weapon >= 0) this.switchWeapon(A.weapon);
    if (A.fireMode && d.semiToggle) { w.semi = !w.semi; if (G.audio) G.audio.foley('dry'); }
    if (A.reload) this.wantReload = true;
    if (this.wantReload && this.state === 'idle') { this.wantReload = false; this.startReload(); }
    if (A.melee && (this.state === 'idle' || this.state === 'reload' || this.state.startsWith('shell'))) { this.state = 'melee'; this.st = 0; this.meleeHit = false; if (G.audio) G.audio.foley('knife'); }
    if ((A.lethal || A.tactical) && this.state === 'idle' && G.player.canThrow(A.lethal ? 'lethal' : 'tactical')) { this.state = 'throw'; this.st = 0; this.throwKind = A.lethal ? 'lethal' : 'tactical'; this.cook = 0; this.thrown = false; if (G.audio) G.audio.foley('pin'); }
    switch (this.state) {
      case 'raise': if (this.st > 0.32) this.state = 'idle'; break;
      case 'lower': if (this.st > 0.24) { this.cur = this.switchTo; this.switchTo = -1; this._equip(); } break;
      case 'reload': {
        const p = this.st / this.reloadT;
        if (!this.reloadApplied && p > 0.62) { this.reloadApplied = true; const need = magSize(w) - w.mag, take = Math.min(need, w.reserve); w.mag += take; w.reserve -= take; if (G.audio) G.audio.foley('magIn'); this.kZ.kick(0.3); }
        if (p > 0.12 && !this._mo) { this._mo = true; if (G.audio) G.audio.foley('magOut'); }
        if (this.reloadEmpty && p > 0.8 && !this._bo) { this._bo = true; if (G.audio) G.audio.foley(d.cls === 'sniper' ? 'bolt' : 'bolt'); }
        if (p >= 1) { this.state = 'idle'; this._mo = this._bo = false; }
        break;
      }
      case 'shellStart': if (this.st > 0.35) { this.state = 'shell'; this.st = 0; } break;
      case 'shell':
        if (this.st > d.shell) { if (w.reserve > 0 && w.mag < magSize(w)) { w.mag++; w.reserve--; if (G.audio) G.audio.foley('shell'); } this.st = 0; if (w.mag >= magSize(w) || w.reserve <= 0) { this.state = 'shellEnd'; } }
        if (A.firePressed && w.mag > 0) { this.state = 'idle'; this.pendingFire = true; }
        break;
      case 'shellEnd': if (this.st > 0.35) { this.state = 'idle'; if (G.audio) G.audio.foley('pump'); } break;
      case 'pump': if (this.st > d.pump) this.state = 'idle'; if (this.st > 0.1 && !this._pp) { this._pp = true; if (G.audio) G.audio.foley('pump'); } break;
      case 'bolt': if (this.st > d.bolt) this.state = 'idle'; if (this.st > 0.15 && !this._bp) { this._bp = true; if (G.audio) G.audio.foley('bolt'); } break;
      case 'melee': if (this.st > 0.16 && !this.meleeHit) { this.meleeHit = true; G.combat.melee(); } if (this.st > 0.6) this.state = 'idle'; break;
      case 'throw': {
        const held = this.throwKind === 'lethal' ? A.lethalHeld : false;
        if (this.st < 0.3 || (held && this.throwKind === 'lethal' && !this.thrown && this.cook < 3.2)) { this.cook += dt; if (this.cook > 3.5 && !this.thrown) { this.thrown = true; G.player.useThrowable(this.throwKind, this.cook, true); } }
        else if (!this.thrown) { this.thrown = true; this.throwAt = this.st; G.player.useThrowable(this.throwKind, this.cook, false); }
        if (this.thrown && this.st - (this.throwAt || this.st) > 0.35) this.state = 'idle';
        break;
      }
    }
    // ---------------- aim / sprint blending ----------------
    const wantAds = A.ads && !pl.sprinting && ['idle', 'pump', 'bolt', 'shell', 'shellStart', 'shellEnd'].includes(this.state) && pl.alive;
    this.ads = clamp(this.ads + (wantAds ? 1 : -1) * dt / d.adsTime, 0, 1);
    this.sprint = damp(this.sprint, pl.sprinting && this.state !== 'throw' ? 1 : 0, 10, dt);
    this.bloom = Math.max(0, this.bloom - dt * 2.5);
    // ---------------- firing ----------------
    const canFire = this.state === 'idle' && this.sprint < 0.3 && pl.alive;
    const trigger = A.fire && (d.auto && !w.semi ? true : (A.firePressed || this.pendingFire));
    this.pendingFire = false;
    if (trigger && canFire) {
      if (G.t - this.lastShot >= 60 / d.rpm) {
        if (w.mag > 0) this._fire(pl);
        else if (A.firePressed) { if (G.audio) G.audio.foley('dry'); this.lastShot = G.t; if (w.reserve > 0) this.startReload(); }
      }
    }
    if (w.mag === 0 && this.state === 'idle' && w.reserve > 0 && G.t - this.lastShot > 0.25) this.startReload();
    this._animate(dt, A, pl);
  }

  _fire(pl) {
    const w = this.w, d = w.def, cam = G.camera;
    w.mag--; this.lastShot = G.t; G.stats.shots++;
    const fwd = new V3(0, 0, -1).applyQuaternion(cam.quaternion), origin = cam.position.clone();
    const stance = pl.stance === 'prone' ? 0.55 : pl.stance === 'crouch' ? 0.75 : 1;
    const spread = THREE.MathUtils.degToRad(this.currentSpread(pl)) * 0.5;
    const muzzleW = this.muzzleWorld();
    if (d.rocket) {
      // rockets converge on whatever is under the crosshair
      const h = G.world.raycast(origin, fwd, 250), eh = G.enemies.rayHit(origin, fwd, h ? h.t : 250), t = eh ? eh.t : h ? h.t : 250;
      const aim = origin.clone().addScaledVector(fwd, t), dir = aim.sub(muzzleW).normalize();
      G.throwables.rocket(muzzleW, dir.dot(fwd) > 0.9 ? dir : fwd);
    }
    else {
      const n = d.pellets || 1;
      for (let i = 0; i < n; i++) {
        const dir = cone(fwd, spread);
        const end = G.combat.playerShot(origin, dir, w, i === 0);
        if (d.pellets ? i < 3 : (G.stats.shots % 2 === 0 || this.ads < 0.5)) {
          const td = new V3().subVectors(end, muzzleW); const L = td.length(); td.divideScalar(L);
          G.fx.tracer(muzzleW, td, L, 650, d.pellets ? 1.5 : 3);
        }
      }
    }
    // recoil: camera climb + spring kicks on the gun
    const rm = (this.ads > 0.5 ? 0.78 : 1) * (w.att.grip ? 0.78 : 1) * stance;
    pl.addRecoil(d.recoil[0] * rm, rand(-1, 1) * d.recoil[1] * rm);
    this.kZ.kick(d.cls === 'shotgun' || d.cls === 'sniper' ? 2.4 : 1.2); this.kP.kick(d.cls === 'sniper' || d.cls === 'shotgun' ? 3.2 : 1.0 + this.bloom); this.kR.kick(rand(-1.5, 1.5)); this.kY.kick(rand(-0.6, 0.6));
    this.bloom = Math.min(1, this.bloom + (d.auto ? 0.09 : 0.25));
    // flash, light, smoke, sound, shell
    const sup = w.att.suppressor;
    if (!sup) { this.flash.visible = true; this.flashT = 0.045; this.flash.material.rotation = Math.random() * 6.28; const s = d.cls === 'shotgun' || d.cls === 'lmg' ? 0.32 : d.cls === 'pistol' ? 0.16 : 0.24; this.flash.scale.setScalar(s * rand(0.8, 1.2)); this.flashLight.intensity = 3; G.fx.light(muzzleW, 0xffaa55, d.cls === 'sniper' ? 10 : 6, 0.06, 10); }
    if (Math.random() < 0.5) G.fx.muzzleSmoke(muzzleW, fwd);
    G.audio.gun(d.sound, null, { player: true, suppressed: sup });
    if (d.cls !== 'shotgun' && d.cls !== 'sniper' && d.cls !== 'launcher') this.ejectShell();
    G.enemies.hearShot(origin, sup);
    if (d.pump) { this.state = 'pump'; this.st = 0; this._pp = false; setTimeout(() => this.ejectShell(), 220); }
    if (d.bolt && w.mag > 0) { this.state = 'bolt'; this.st = 0; this._bp = false; setTimeout(() => this.ejectShell(), 300); }
  }
  // current cone of fire in degrees (full angle); also drives the crosshair
  currentSpread(pl) {
    const w = this.w, d = w.def, stance = pl.stance === 'prone' ? 0.55 : pl.stance === 'crouch' ? 0.75 : 1;
    let spread = d.hip * lerp(1, d.adsMul, this.ads) * (1 + pl.moveFrac * (this.ads > 0.5 ? 0.6 : 1.2) + (pl.onGround ? 0 : 2)) * stance * (w.att.grip ? 0.85 : 1) + this.bloom * (this.ads > 0.5 ? 0.6 : 2.2);
    if (d.cls === 'sniper' && this.ads < 0.9) spread = d.hip * 1.6;
    if (pl.perkSteady && this.ads < 0.5) spread *= 0.66;
    return spread;
  }
  // viewmodel space -> world space, keeping the point at the same place on screen (the gun uses its own, narrower field of view)
  _toWorld(p) {
    const k = Math.tan(THREE.MathUtils.degToRad(G.camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(this.cam.fov) / 2);
    p.x *= k; p.y *= k; return p.applyMatrix4(G.camera.matrixWorld);
  }
  muzzleWorld() {
    const ud = this.model.userData, p = ud.muzzle.clone(); this.model.updateWorldMatrix(true, false); this.model.localToWorld(p);
    return this._toWorld(p);
  }
  ejectShell() {
    const ud = this.model.userData, p = ud.eject.clone(); this.model.localToWorld(p); this._toWorld(p);
    const right = new V3(1, 0, 0).applyQuaternion(G.camera.quaternion), up = new V3(0, 1, 0).applyQuaternion(G.camera.quaternion);
    const v = right.multiplyScalar(rand(1.6, 2.6)).addScaledVector(up, rand(1.4, 2.4)).add(G.player.vel);
    G.fx.shell(p, v);
  }

  _animate(dt, A, pl) {
    const w = this.w, d = w.def, ud = this.model.userData, m = this.model;
    // springs, sway and bob
    this.kZ.update(dt); this.kP.update(dt); this.kR.update(dt); this.kY.update(dt); this.land.update(dt);
    this.swayX = damp(this.swayX, clamp(-A.lookX * 2.2, -0.05, 0.05), 9, dt); this.swayY = damp(this.swayY, clamp(A.lookY * 2.2, -0.05, 0.05), 9, dt);
    this.phase += dt * pl.speed2d * (pl.sprinting ? 1.45 : 1.75);
    const adsE = sm(this.ads), mv = clamp(pl.speed2d / 5, 0, 1.3) * (pl.onGround ? 1 : 0.2), hipK = 1 - adsE * 0.9;
    const pos = new V3(lerp(0.14, 0, adsE), lerp(-0.165, -ud.sightY, adsE), lerp(-0.35, -0.225, adsE));
    const rot = new THREE.Euler(lerp(0.02, 0, adsE), lerp(0.05, 0, adsE), lerp(0.035, 0, adsE));
    pos.x += Math.sin(this.phase) * 0.012 * mv * hipK + this.swayX * hipK; pos.y += -Math.abs(Math.cos(this.phase)) * 0.014 * mv * hipK + this.swayY * hipK + Math.sin(G.t * 1.6) * 0.0025 * hipK;
    rot.z += Math.sin(this.phase) * 0.02 * mv * hipK; rot.y += this.swayX * 1.2; rot.x += this.swayY * 0.8;
    // sprint pose
    const sp = this.sprint; pos.x += sp * 0.03; pos.y -= sp * 0.06; pos.z += sp * 0.03; rot.x -= sp * 0.3; rot.y += sp * 0.75; rot.z += sp * 0.4;
    // crouch tilt and landing dip
    if (pl.stance !== 'stand') { rot.z += 0.04 * hipK; pos.y += 0.008; }
    pos.y += this.land.x * 0.02;
    // recoil
    pos.z += this.kZ.x * 0.012; rot.x += this.kP.x * 0.02 * (1 - adsE * 0.4); rot.z += this.kR.x * 0.01; rot.y += this.kY.x * 0.01;
    // left-hand target defaults to the fore grip
    const foreL = ud.fore.clone(), gripR = new V3(0, -0.05, 0.035); let lhOverride = null, rhOverride = null;
    const A_ = ud.A; if (A_.mag) { A_.mag.position.copy(ud.magPos); A_.mag.rotation.set(0, 0, 0); A_.mag.visible = d.cls !== 'shotgun' && d.cls !== 'launcher'; }
    if (A_.bolt && ud.boltPos) A_.bolt.position.copy(ud.boltPos);
    if (A_.pump) A_.pump.position.z = -0.34; if (A_.slide) A_.slide.position.z = -0.06; if (A_.rocket) A_.rocket.visible = w.mag > 0 || this.state === 'reload';
    // state poses
    const s = this.state, t = this.st;
    if (s === 'raise') { const k = 1 - sm(clamp(t / 0.32, 0, 1)); pos.y -= k * 0.3; rot.x -= k * 0.7; }
    if (s === 'lower') { const k = sm(clamp(t / 0.24, 0, 1)); pos.y -= k * 0.3; rot.x -= k * 0.7; }
    if (s === 'reload') {
      const p = t / this.reloadT, tilt = sm(seg(p, 0, 0.12)) * (1 - sm(seg(p, 0.86, 1)));
      rot.z += tilt * 0.55; rot.x += tilt * 0.18; pos.y -= tilt * 0.035; pos.x -= tilt * 0.03;
      const out = sm(seg(p, 0.12, 0.3)), gone = seg(p, 0.3, 0.45), back = sm(seg(p, 0.45, 0.62)), slap = seg(p, 0.62, 0.72);
      const mp = ud.magPos.clone();
      if (p < 0.45) { mp.y -= out * 0.22 + gone * 0.3; A_.mag && A_.mag.position.copy(mp); if (A_.mag) A_.mag.rotation.x = out * 0.4; if (A_.mag && gone > 0.6) A_.mag.visible = false; lhOverride = mp.clone().add(new V3(0, -0.06, 0)); }
      else if (p < 0.62) { mp.y -= (1 - back) * 0.35; if (A_.mag) { A_.mag.position.copy(mp); A_.mag.visible = d.cls !== 'shotgun'; } lhOverride = mp.clone().add(new V3(0, -0.07, 0)); }
      else if (p < 0.75) { lhOverride = ud.magPos.clone().add(new V3(0, -0.09 - Math.sin(slap * Math.PI) * 0.02, 0)); }
      if (this.reloadEmpty && p >= 0.75 && p < 0.92 && ud.boltPos) {
        const k = seg(p, 0.75, 0.92), pull = Math.sin(k * Math.PI);
        if (A_.bolt) A_.bolt.position.z = ud.boltPos.z + pull * 0.06; if (A_.slide) A_.slide.position.z = -0.06 + pull * 0.04;
        lhOverride = ud.boltPos.clone().add(new V3(0.02, 0.01, pull * 0.06));
      }
      if (lhOverride && p >= 0.72 && !(this.reloadEmpty && p < 0.92)) lhOverride.lerp(foreL, sm(seg(p, 0.72, 0.85)));
    }
    if (s === 'shell' || s === 'shellStart' || s === 'shellEnd') {
      const tilt = s === 'shellStart' ? sm(clamp(t / 0.35, 0, 1)) : s === 'shellEnd' ? 1 - sm(clamp(t / 0.35, 0, 1)) : 1;
      rot.z -= tilt * 0.35; rot.x += tilt * 0.12; pos.y -= tilt * 0.02;
      if (s === 'shell') { const k = t / d.shell, dip = Math.sin(clamp(k, 0, 1) * Math.PI); lhOverride = new V3(0, -0.06 - dip * 0.1, -0.08 + dip * 0.02); }
    }
    if (s === 'pump' && A_.pump) { const k = Math.sin(clamp(t / d.pump, 0, 1) * Math.PI); A_.pump.position.z = -0.34 + k * 0.09; foreL.z += k * 0.09; rot.x += k * 0.05; }
    if (s === 'bolt' && A_.bolt) {
      const k = clamp(t / d.bolt, 0, 1), up = sm(seg(k, 0.1, 0.3)) * (1 - sm(seg(k, 0.7, 0.9))), back = Math.sin(seg(k, 0.3, 0.7) * Math.PI);
      A_.bolt.position.z = ud.boltPos.z + back * 0.07; A_.bolt.rotation.z = -up * 0.9; rot.z += 0.15 * Math.sin(k * Math.PI); rot.x += 0.05 * Math.sin(k * Math.PI);
      rhOverride = ud.boltPos.clone().add(new V3(0.05, -0.01 + up * 0.02, back * 0.07 + 0.02));
    }
    if (A_.slide && G.t - this.lastShot < 0.06) A_.slide.position.z = -0.06 + 0.03;
    if (A_.slide && w.mag === 0 && s !== 'reload') A_.slide.position.z = -0.06 + 0.035;
    if (s === 'melee') { const k = clamp(t / 0.6, 0, 1), jab = Math.sin(seg(k, 0, 0.5) * Math.PI); pos.x -= jab * 0.06; pos.y -= jab * 0.12; rot.y += jab * 0.5; rot.z -= jab * 0.4; }
    if (s === 'throw') { const k = this.thrown ? clamp((t - (this.throwAt || t)) / 0.35, 0, 1) : 0; pos.y -= 0.12 * (1 - k); rot.x -= 0.4 * (1 - k); }
    m.position.copy(pos); m.rotation.copy(rot); m.updateMatrixWorld(true);
    // muzzle flash sprite
    if (this.flashT > 0) { this.flashT -= dt; const mz = ud.muzzle.clone(); m.localToWorld(mz); this.flash.position.copy(mz); this.flashLight.position.copy(mz); if (this.flashT <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; } }
    // hide the gun body behind a scope so the overlay reads clean
    const scoped = this.scoped;
    m.visible = !scoped; this.arms.setVisible(!scoped);
    // arms IK
    const q = m.quaternion, toW = (v) => v.clone().applyMatrix4(m.matrixWorld);
    const rH = toW(rhOverride || gripR), lH = toW(lhOverride || foreL);
    const qR = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35, 0, -0.25)));
    const qL = q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0, 0.55)));
    let lhPos = lH, lhQ = qL;
    // knife jab / grenade throw use the left hand
    this.knife.visible = s === 'melee'; this.nade.visible = s === 'throw' && !this.thrown;
    if (s === 'melee') { const k = clamp(t / 0.6, 0, 1), sw = Math.sin(seg(k, 0.05, 0.55) * Math.PI); lhPos = new V3(-0.15 + sw * 0.18, -0.12 + sw * 0.05, -0.32 - sw * 0.25); lhQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, 0.6 - sw * 1.2, -0.5)); this.knife.position.copy(lhPos).add(new V3(0, 0.0, -0.05)); this.knife.quaternion.copy(lhQ); }
    if (s === 'throw') { const k = this.thrown ? clamp((t - (this.throwAt || t)) / 0.35, 0, 1) : 0, wind = this.thrown ? 0 : Math.min(1, t / 0.3); lhPos = new V3(-0.2 + k * 0.15, -0.12 + wind * 0.14 - k * 0.2, -0.28 - k * 0.3 + wind * 0.08); lhQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.4, 0.2, -0.2)); this.nade.position.copy(lhPos).add(new V3(0, 0.04, -0.03)); }
    if (!(scoped)) {
      this.arms.solve('R', new V3(0.27, -0.42, 0.02), rH, new V3(0.7, -1, 0.3).normalize(), qR, 0.32, 0.3);
      this.arms.solve('L', new V3(-0.17, -0.45, -0.04), lhPos, new V3(-0.5, -1, 0.1).normalize(), lhQ, 0.41, 0.39);
    }
    this.cam.fov = lerp(52, w.att.optic === 'acog' ? 34 : 44, adsE);
    this.cam.updateProjectionMatrix();
  }
}
function cone(fwd, a) {
  if (a <= 0) return fwd.clone();
  const u = Math.random() * 2 * Math.PI, r = Math.sqrt(Math.random()) * a;
  const t1 = Math.abs(fwd.y) < 0.9 ? new V3(0, 1, 0) : new V3(1, 0, 0), x = new V3().crossVectors(fwd, t1).normalize(), y = new V3().crossVectors(fwd, x);
  return fwd.clone().addScaledVector(x, Math.cos(u) * Math.tan(r)).addScaledVector(y, Math.sin(u) * Math.tan(r)).normalize();
}
export { cone };
function flashTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); g.translate(64, 64);
  for (let i = 0; i < 9; i++) { g.rotate((Math.PI * 2) / 9 + rand(-0.1, 0.1)); const gr = g.createLinearGradient(0, 0, 60, 0); gr.addColorStop(0, 'rgba(255,245,210,1)'); gr.addColorStop(0.5, 'rgba(255,170,60,.6)'); gr.addColorStop(1, 'rgba(255,90,20,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(0, -5); g.lineTo(rand(40, 62), 0); g.lineTo(0, 5); g.fill(); }
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 26); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(1, 'rgba(255,170,60,0)'); g.fillStyle = gr; g.fillRect(-30, -30, 60, 60);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
