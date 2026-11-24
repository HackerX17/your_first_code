// The Old Quarter: an original war-torn district built from code. Everything static is merged into a few meshes.
import * as THREE from 'three';
import { Builder } from './world.js';
import { MAT } from './textures.js';
import { mulberry32 } from './core.js';

const T = 0.3, FH = 3.2, SL = 0.25;

export function buildMap(scene, world) {
  const B = new Builder(world), rnd = mulberry32(4242), r = (a, b) => a + rnd() * (b - a);
  const info = { spawns: [], perches: [], armories: [], fires: [], barrels: [], glass: [], smoke: [], playerSpawn: new THREE.Vector3(0, 0.06, -9), playerYaw: Math.PI, signs: [] };
  const box = (x, y0, z, w, h, d, mat, o) => B.box(x, y0, z, w, h, d, mat, o);
  const rect = (x0, y0, z0, x1, y1, z1, mat, o) => B.box((x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, mat, o);
  const M4 = new THREE.Matrix4(), E = new THREE.Euler(), Q = new THREE.Quaternion(), V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1);
  const place = (g, mat, x, y, z, rx = 0, ry = 0, rz = 0, o = {}) => { E.set(rx, ry, rz); Q.setFromEuler(E); M4.compose(V.set(x, y, z), Q, S); B.geo(g, mat, M4, o); };

  // ---------------- ground, streets, plaza ----------------
  box(0, -0.5, 0, 420, 0.5, 420, 'dirt', { uv: 4, shadow: false, noCollide: true });
  rect(-7, 0, -57, 7, 0.03, 57, 'asphalt', { shadow: false });
  rect(-57, 0, -6, -7, 0.03, 6, 'asphalt', { shadow: false }); rect(7, 0, -6, 57, 0.03, 6, 'asphalt', { shadow: false });
  rect(-14, 0, -13, 14, 0.06, 13, 'paving', { shadow: false });
  for (const s of [-1, 1]) {
    rect(s > 0 ? 7 : -9.5, 0, -57, s > 0 ? 9.5 : -7, 0.15, -13, 'paving', { shadow: false }); rect(s > 0 ? 7 : -9.5, 0, 13, s > 0 ? 9.5 : -7, 0.15, 57, 'paving', { shadow: false });
    rect(-57, 0, s > 0 ? 6 : -8.5, -14, 0.15, s > 0 ? 8.5 : -6, 'paving', { shadow: false }); rect(14, 0, s > 0 ? 6 : -8.5, 57, 0.15, s > 0 ? 8.5 : -6, 'paving', { shadow: false });
  }
  // lane markings and potholes as thin dark/light strips
  for (let z = -54; z < 54; z += 6) if (Math.abs(z) > 14) box(0, 0.031, z, 0.15, 0.005, 2.6, 'concrete', { noCollide: true, shadow: false });
  // fountain
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; box(Math.cos(a) * 3.1, 0.06, Math.sin(a) * 3.1, 0.5, 0.75, 2.6, 'concrete', { yaw: -a }); }
  B.cyl(0, 0.06, 0, 0.55, 2.1, 'concrete'); B.cyl(0, 2.1, 0, 1.4, 0.25, 'concrete', { noCollide: true, r2: 1.2 });
  box(0, 2.35, 0, 0.7, 1.6, 0.7, 'brick', { noCollide: true }); box(0, 3.95, 0, 0.45, 0.5, 0.45, 'concrete', { noCollide: true });
  box(0, 0.06, 0, 5.2, 0.12, 5.2, 'dirt', { noCollide: true, shadow: false });
  // benches, planters, lamps
  for (const [x, z, yaw] of [[-9, -11, 0], [9, -11, 0], [-11.5, 4, Math.PI / 2], [11.5, -4, Math.PI / 2]]) bench(x, z, yaw);
  for (const [x, z] of [[-12, -12], [12, 12], [-12, 12], [12, -12]]) { box(x, 0.06, z, 1.6, 0.6, 1.6, 'concrete'); deadShrub(x, 0.66, z); }
  for (const [x, z] of [[-8.3, -20], [8.3, -30], [-8.3, 24], [8.3, 34], [-22, -7.2], [26, 7.2], [-40, 7.2], [40, -7.2], [-13, 0], [13, 0]]) lamp(x, z);

  // ---------------- buildings ----------------
  building({ x0: 16, z0: 16, x1: 32, z1: 30, floors: 3, mat: 'plaster', doors: { s: [0.3], w: [0.55] }, stairs: 'ne', roof: true, sign: { text: 'HOTEL MERIDIAN', side: 's', color: '#e9dcc0', bg: '#3b2a20' } });
  building({ x0: 38, z0: 14, x1: 50, z1: 24, floors: 1, mat: 'brick', doors: { w: [0.5], s: [0.6] }, sign: { text: 'CAFÉ LUNA', side: 's', color: '#f4d9a0', bg: '#5a2219' }, awning: 's' });
  building({ x0: 14, z0: 38, x1: 28, z1: 52, floors: 2, mat: 'concrete', doors: { s: [0.5], e: [0.4] }, stairs: 'nw', roof: true });
  building({ x0: -32, z0: 16, x1: -16, z1: 28, floors: 3, mat: 'brick', doors: { s: [0.62], e: [0.4] }, stairs: 'nw', roof: true, balconies: 's' });
  building({ x0: -30, z0: 36, x1: -14, z1: 52, floors: 2, mat: 'plasterR', doors: { s: [0.4], e: [0.6] }, stairs: 'sw', roof: true, sign: { text: 'APTEKA', side: 's', color: '#d8f0d0', bg: '#1f4a2a' } });
  ruin(-54, 38, -40, 54);
  building({ x0: -34, z0: -28, x1: -18, z1: -16, floors: 1, mat: 'concrete', doors: { e: [0.5], n: [0.3] }, wideDoor: 'e', floorH: 4.4, sign: { text: 'AUTO SERVIS', side: 'e', color: '#ffe9a8', bg: '#22313f' } });
  building({ x0: -54, z0: -32, x1: -40, z1: -14, floors: 2, mat: 'brick', doors: { e: [0.5], n: [0.6] }, stairs: 'se', roof: true });
  building({ x0: 16, z0: -30, x1: 34, z1: -16, floors: 2, mat: 'plasterW', doors: { w: [0.5], n: [0.5] }, stairs: 'se', roof: true, sign: { text: 'CLINIC', side: 'n', color: '#e6f6ea', bg: '#1d5a3c' } });
  building({ x0: 40, z0: -26, x1: 54, z1: -12, floors: 1, mat: 'brick', doors: { w: [0.5], n: [0.5] } });
  // interior props in the garage
  car(-27, -23, 0.1, 'metalBlue', false); for (const [x, z] of [[-21, -18], [-20, -19], [-32, -26]]) drum(x, z, 'metalRed');
  box(-33, 0, -18, 0.5, 2.2, 3, 'metalGrey'); box(-22, 0, -27, 3, 1, 0.8, 'wood');

  // ---------------- market (NW) ----------------
  for (let i = 0; i < 4; i++) for (const zz of [17, 26]) stall(-51 + i * 4.4, zz, zz > 20 ? Math.PI : 0, ['clothA', 'clothB', 'clothC'][(i + (zz > 20 ? 1 : 0)) % 3]);
  for (const [x, z] of [[-38, 21], [-46, 30], [-52, 13], [-40, 14]]) crates(x, z, 2 + Math.floor(rnd() * 3));
  info.fires.push(new THREE.Vector3(-44, 0.9, 21.5)); drum(-44, 21.5, 'burnt');

  // ---------------- container yard (NE) ----------------
  container(40, 0, 34, 0, 'contRed'); container(40, 2.6, 34, 0.04, 'contBlue'); container(40, 0, 37.6, 0, 'contGreen');
  container(48, 0, 41, Math.PI / 2, 'contOrange'); container(37, 0, 47, 0.35, 'contBlue'); container(47.5, 0, 49.5, 0, 'contRed'); container(52.5, 0, 33, Math.PI / 2, 'contGreen');
  crates(44, 31, 3); crates(34, 41, 2); for (const [x, z] of [[43, 44], [51, 45]]) drum(x, z, 'metalBlue');
  fence(32, 30, 56, 30, 1.1);

  // ---------------- parking lot (SW) ----------------
  rect(-52, 0, -54, -14, 0.035, -36, 'asphalt', { shadow: false });
  for (let i = 0; i < 6; i++) box(-48 + i * 6, 0.036, -45, 0.12, 0.004, 4.5, 'concrete', { noCollide: true, shadow: false });
  car(-44, -40, 0.15, 'metalWhite', false); car(-37, -50, -0.4, 'metalRed', false); car(-22, -40, 1.2, 'burnt', true); car(-16, -50, 0.6, 'metalGreen', false); car(-48, -51, 1.4, 'metalBlue', false);
  bus(-30, -45, 0.3); for (let i = 0; i < 4; i++) jersey(-50 + i * 3.2, -35, 0);

  // ---------------- construction site (SE) ----------------
  frameBuilding(30, -52, 46, -40); scaffold(14.5, -53, 24, -53);
  crane(20, -47); for (let i = 0; i < 3; i++) B.cyl(36 + i * 2.2, 0.75, -36.5, 0.75, 2.2, 'concrete', { rz: Math.PI / 2, uvScale: 2 });
  world.add(38.2, 0, -36.5, 6.6, 1.5, 1.6, 0, 'concrete');
  for (const [x, z, s] of [[50, -38, 2], [52, -48, 1.6], [25, -38, 1.4]]) sandpile(x, z, s);
  crates(48, -44, 2); info.fires.push(new THREE.Vector3(24, 0.9, -38.5)); drum(24, -38.5, 'burnt');
  fence(14, -35, 56, -35, 1.6, 0.4);

  // ---------------- avenue & cross street ----------------
  car(3, -24, 0.2, 'burnt', true); car(-4, 30, -0.3, 'burnt', false); car(2.5, 45, 1.2, 'metalWhite', false); car(-30, 2, 1.6, 'metalGreen', false); car(44, 3.2, -1.5, 'burnt', false);
  apc(-2, -42, 0.1); truck(35, -2.2, Math.PI / 2 + 0.06);
  for (let i = 0; i < 3; i++) jersey(-6 + i * 3.2, -30.5, 0); sandbags(4.6, -31, 3.4, 0);
  booth(5.5, -34.5);
  sandbags(8.5, -9.5, 3, Math.PI / 2); sandbags(7, -11.5, 3, 0.3); sandbags(-24, 10, 4, 0); sandbags(26, -10, 4, 0); sandbags(-2, 22, 4, 0.1);
  jersey(-40, -5, Math.PI / 2); jersey(-40, -1.6, Math.PI / 2); jersey(40, 1.6, Math.PI / 2); jersey(-1, 50, 0.1); jersey(2.2, 50.2, -0.1);
  for (const [x, z] of [[-11, 16], [11, 33], [12, -36], [-12, -44], [33, 12], [-36, -12]]) dumpster(x, z, rnd() * 0.3);
  for (const [x, z] of [[-10.5, 14.5], [10.6, 31], [-10.7, -45.5], [33, 10.6]]) trash(x, z);
  for (const [x, z] of [[-3, -6], [6, 18], [-18, -2], [30, 2], [-5, 38], [2, -48]]) crater(x, z);
  for (let i = 0; i < 26; i++) { const x = r(-54, 54), z = r(-54, 54); if (Math.abs(x) < 4 && Math.abs(z) < 4) continue; rubble(x, z, r(0.3, 0.9)); }
  tree(-9.2, -30); tree(9.2, 22); tree(-24, 9.4); tree(36, -9.4);
  powerline(-9.4, -52, -9.4, 52); powerline(9.4, -52, 9.4, 52);

  // explosive barrels (dynamic, created by the systems module)
  for (const [x, z] of [[-6, 12], [6.5, -16], [14.5, 9.6], [-14.6, -9.8], [-28, -33], [30, -14.5], [-36, 30], [44, 28]]) info.barrels.push(new THREE.Vector3(x, 0, z));

  // ---------------- perimeter ----------------
  const P = 57;
  for (const [x0, z0, x1, z1] of [[-P, P, P, P + 1], [-P, -P - 1, P, -P], [-P - 1, -P, -P, P], [P, -P, P + 1, P]]) {
    const L = Math.max(x1 - x0, z1 - z0), along = x1 - x0 > z1 - z0, n = Math.ceil(L / 9);
    for (let i = 0; i < n; i++) {
      const a = (along ? x0 : z0) + i * (L / n), b = a + L / n, h = r(9, 19), mat = ['plaster', 'brick', 'plasterW', 'concrete', 'plasterR'][Math.floor(rnd() * 5)];
      if (along) rect(a, 0, z0, b, h, z1, mat, { uv: 2.2 }); else rect(x0, 0, a, x1, h, b, mat, { uv: 2.2 });
      for (let f = 1; f * FH + 1.6 < h; f++) for (let w = 0; w < 2; w++) { const c = a + (L / n) * (0.3 + w * 0.4), y = f * FH + 0.9; if (along) box(c, y, z0 + (z0 > 0 ? -0.02 : 1.02), 1.2, 1.4, 0.04, 'darkGlass', { noCollide: true, shadow: false }); else box(x0 + (x0 > 0 ? -0.02 : 1.02), y, c, 0.04, 1.4, 1.2, 'darkGlass', { noCollide: true, shadow: false }); }
    }
  }
  // street ends: rubble and barriers so the roads read as blocked
  for (const [x, z, yaw] of [[0, 55.5, 0], [0, -55.5, 0], [55.5, 0, Math.PI / 2], [-55.5, 0, Math.PI / 2]]) { for (let i = -2; i <= 2; i++) jersey(x + Math.cos(yaw) * i * 3.1, z - Math.sin(yaw) * i * 3.1, yaw); }
  // distant skyline (no collision), swallowed by haze
  for (let i = 0; i < 70; i++) { const a = rnd() * Math.PI * 2, d = r(70, 150), w = r(8, 22), h = r(12, 48); box(Math.cos(a) * d, 0, Math.sin(a) * d, w, h, r(8, 20), ['concrete', 'plaster', 'brick'][Math.floor(rnd() * 3)], { yaw: rnd() * 0.4, noCollide: true, uv: 3 }); }
  info.smoke.push(new THREE.Vector3(80, 0, 60), new THREE.Vector3(-95, 0, -30), new THREE.Vector3(30, 0, -110), new THREE.Vector3(-40, 0, 95));

  // ---------------- gameplay points ----------------
  info.spawns = [[0, 52], [0, -52], [52, 0], [-52, 0], [50, 52], [-50, 22], [-46, -48], [50, -46], [30, 53], [-30, -53], [53, 30], [-53, -24], [24, -54], [-24, 54]].map(([x, z]) => new THREE.Vector3(x, 0, z));
  info.perches = [[24, 9.6, 17.2], [-24, 9.6, 17.2], [25, 6.4, -16.8], [21, 6.4, 39], [38, 6.4, -41], [-22, 6.4, 37.2], [-47, 6.4, -15.2]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  info.armories = [
    { type: 'weapons', pos: new THREE.Vector3(11.4, 0.15, 10.4), yaw: -Math.PI / 4 },
    { type: 'equipment', pos: new THREE.Vector3(-11.4, 0.15, 10.4), yaw: Math.PI / 4 },
    { type: 'support', pos: new THREE.Vector3(11.4, 0.15, -10.4), yaw: -Math.PI * 0.75 }
  ];
  for (const a of info.armories) armory(a);

  const meshes = B.build(scene);
  buildGlass(scene, world, info);
  buildSigns(scene, info);
  return { info, meshes };

  // ======================================================== builders
  function building(o) {
    const { x0, z0, x1, z1, floors, mat } = o, fh = o.floorH || FH, top = floors * fh;
    const st = o.stairs ? stairRect(o.stairs, x0, z0, x1, z1) : null;
    const levels = o.stairs ? floors - 1 + (o.roof ? 1 : 0) : 0; // number of flights
    for (let f = 0; f < floors; f++) {
      const yb = f * fh;
      for (const side of ['s', 'n', 'w', 'e']) {
        const alongX = side === 's' || side === 'n', L = alongX ? x1 - x0 : z1 - z0 - 2 * T, ops = [];
        if (f === 0 && o.doors[side]) for (const fr of o.doors[side]) { const c = fr * L, hw = o.wideDoor === side ? 2.2 : 0.8; ops.push({ a: c - hw, b: c + hw, lo: 0, hi: o.wideDoor === side ? 3.4 : 2.4, door: true }); }
        const n = Math.max(0, Math.floor((L - 1.6) / 3.1));
        for (let i = 0; i < n; i++) { const c = ((i + 0.5) * L) / n; if (ops.some((p) => Math.abs((p.a + p.b) / 2 - c) < 2.1)) continue; if (st && f > 0 && hitsStair(side, c, st, x0, z0, x1, z1)) continue; ops.push({ a: c - 0.65, b: c + 0.65, lo: 0.95, hi: 2.35, win: true }); }
        wallSide(side, x0, z0, x1, z1, yb, fh, ops, mat, f, o);
      }
      // cornice band at each floor line and a darker plinth at street level
      if (f > 0) band(x0, z0, x1, z1, yb - 0.12, 0.2, 0.12);
    }
    band(x0, z0, x1, z1, 0, 0.45, 0.05, 'concrete');
    band(x0, z0, x1, z1, top - 0.05, 0.3, 0.16, 'concrete');
    // floors
    const ix0 = x0 + T, ix1 = x1 - T, iz0 = z0 + T, iz1 = z1 - T;
    rect(ix0, 0, iz0, ix1, 0.06, iz1, 'tiles', { shadow: false });
    for (let f = 1; f <= floors; f++) {
      const y = f * fh, roofLevel = f === floors, hole = st && f <= levels ? [st.x0, st.z0 + 0.4, st.x1, st.z1 - 0.4] : null;
      const mats = roofLevel ? 'roof' : 'concrete', X0 = roofLevel ? x0 : ix0, X1 = roofLevel ? x1 : ix1, Z0 = roofLevel ? z0 : iz0, Z1 = roofLevel ? z1 : iz1;
      if (hole) { rect(X0, y - SL, Z0, X1, y, hole[1], mats); rect(X0, y - SL, hole[3], X1, y, Z1, mats); rect(X0, y - SL, hole[1], hole[0], y, hole[3], mats); rect(hole[2], y - SL, hole[1], X1, y, hole[3], mats); }
      else rect(X0, y - SL, Z0, X1, y, Z1, mats);
      if (!roofLevel) { if (hole) { rect(ix0, y, iz0, ix1, y + 0.02, hole[1], 'tiles', { noCollide: true, shadow: false }); rect(ix0, y, hole[3], ix1, y + 0.02, iz1, 'tiles', { noCollide: true, shadow: false }); } else rect(ix0, y, iz0, ix1, y + 0.02, iz1, 'tiles', { noCollide: true, shadow: false }); }
    }
    // roof parapet + clutter
    for (const [a, b, c, d] of [[x0, z0, x1, z0 + 0.25], [x0, z1 - 0.25, x1, z1], [x0, z0 + 0.25, x0 + 0.25, z1 - 0.25], [x1 - 0.25, z0 + 0.25, x1, z1 - 0.25]]) rect(a, top, b, c, top + 1.0, d, mat);
    if (o.roof || floors > 1) { box(x0 + 3, top, z0 + 3, 1.6, 0.9, 1.1, 'metalWhite'); B.cyl(x1 - 2.5, top, z0 + 2.5, 0.9, 1.8, 'metalGrey'); box(x0 + 2, top, z1 - 2, 0.12, 3, 0.12, 'metalGrey', { noCollide: true }); }
    // stairs
    if (st) {
      const n = 13, rise = fh / n, run = (st.z1 - st.z0 - 0.8) / n, lw = (st.x1 - st.x0) / 2;
      for (let f = 0; f < levels; f++) {
        const lane = f % 2, lx0 = st.x0 + lane * lw, base = f * fh;
        for (let k = 0; k < n; k++) { const za = lane === 0 ? st.z0 + 0.4 + k * run : st.z1 - 0.4 - (k + 1) * run; rect(lx0 + 0.05, base, za, lx0 + lw - 0.05, base + (k + 1) * rise, za + run, 'concrete'); }
      }
      const topY = levels * fh + 1.0; rect(st.x0 + lw - 0.05, 0, st.z0 + 0.4, st.x0 + lw + 0.05, topY, st.z1 - 0.4, 'concrete', { uv: 1 });
      const ix = st.inner === 'w' ? st.x0 : st.x1;
      for (let L = 1; L <= levels; L++) {
        const y = L * fh; rect(ix - 0.05, y, st.z0 + 0.4, ix + 0.05, y + 1.0, st.z1 - 0.4, 'metalGrey');
        const arr = (L - 1) % 2, dep = L < levels ? L % 2 : -1;
        for (const lane of [0, 1]) {
          const lx0 = st.x0 + lane * lw, ends = [];
          const arrEnd = lane === arr ? (lane === 0 ? 'n' : 's') : null, depEnd = lane === dep ? (lane === 0 ? 's' : 'n') : null;
          for (const e of ['s', 'n']) if (e !== arrEnd && e !== depEnd) ends.push(e);
          for (const e of ends) { const z = e === 's' ? st.z0 + 0.4 : st.z1 - 0.4; rect(lx0, y, z - 0.05, lx0 + lw, y + 1.0, z + 0.05, 'metalGrey'); }
        }
      }
    }
    // furniture so rooms read as rooms
    for (let f = 0; f < floors; f++) {
      const y = f * fh + (f === 0 ? 0.06 : 0.02);
      for (let k = 0; k < 2; k++) {
        const fx = r(ix0 + 1.5, ix1 - 1.5), fz = r(iz0 + 1.5, iz1 - 1.5);
        if (st && fx > st.x0 - 1 && fx < st.x1 + 1 && fz > st.z0 - 1 && fz < st.z1 + 1) continue;
        if (rnd() < 0.5) table(fx, y, fz, rnd() * 3); else crates(fx, fz, 1 + Math.floor(rnd() * 2), y);
      }
    }
    if (o.sign) info.signs.push({ ...o.sign, x0, z0, x1, z1, y: (o.floorH || FH) * 0.95 + (o.wideDoor ? 0.6 : 0) });
    if (o.awning) awning(x0, z0, x1, z1, o.awning);
    if (o.balconies) for (let f = 1; f < floors; f++) for (let i = 0; i < 2; i++) { const cx = x0 + (x1 - x0) * (0.3 + i * 0.4), y = f * fh; box(cx, y - 0.12, z0 - 0.6, 2.4, 0.14, 1.2, 'concrete'); rect(cx - 1.2, y, z0 - 1.2, cx + 1.2, y + 1.0, z0 - 1.14, 'metalGrey'); }
  }
  function stairRect(c, x0, z0, x1, z1) {
    const w = 2.6, l = 5.0, east = c[1] === 'e', north = c[0] === 'n';
    const sx1 = east ? x1 - T : x0 + T + w, sx0 = sx1 - w, sz1 = north ? z1 - T : z0 + T + l, sz0 = sz1 - l;
    return { x0: sx0, x1: sx1, z0: sz0, z1: sz1, inner: east ? 'w' : 'e' };
  }
  function hitsStair(side, c, st, x0, z0, x1, z1) {
    if (side === 's' || side === 'n') { const x = x0 + c; const z = side === 's' ? z0 : z1; return x > st.x0 - 0.8 && x < st.x1 + 0.8 && Math.abs(z - (side === 's' ? st.z0 : st.z1)) < 0.5; }
    const z = z0 + T + c, x = side === 'w' ? x0 : x1; return z > st.z0 - 0.8 && z < st.z1 + 0.8 && Math.abs(x - (side === 'w' ? st.x0 : st.x1)) < 0.5;
  }
  function wallSide(side, x0, z0, x1, z1, yb, fh, ops, mat, floor, o) {
    const alongX = side === 's' || side === 'n', L = alongX ? x1 - x0 : z1 - z0 - 2 * T, start = alongX ? x0 : z0 + T;
    const fixed = side === 's' ? z0 + T / 2 : side === 'n' ? z1 - T / 2 : side === 'w' ? x0 + T / 2 : x1 - T / 2, out = side === 's' || side === 'w' ? -1 : 1;
    const seg = (a, b, lo, hi, m = mat, depth = T, off = 0, opts = {}) => {
      if (b - a < 0.02 || hi - lo < 0.02) return; const c = start + (a + b) / 2;
      if (alongX) box(c, yb + lo, fixed + off * out, b - a, hi - lo, depth, m, opts); else box(fixed + off * out, yb + lo, c, depth, hi - lo, b - a, m, opts);
    };
    ops.sort((p, q) => p.a - q.a); let cur = 0;
    for (const p of ops) {
      const a = Math.max(p.a, 0), b = Math.min(p.b, L);
      if (a > cur) seg(cur, a, 0, fh);
      seg(a, b, 0, p.lo); seg(a, b, p.hi, fh);
      if (p.win) {
        seg(a - 0.08, b + 0.08, p.lo - 0.06, p.lo, 'concrete', T + 0.14, 0, { noCollide: true });               // sill
        seg(a - 0.05, b + 0.05, p.hi, p.hi + 0.12, 'concrete', T + 0.06, 0, { noCollide: true });              // lintel
        if (rnd() < 0.45) info.glass.push(alongX ? { x: start + (a + b) / 2, y: yb + p.lo, z: fixed, w: b - a, h: p.hi - p.lo, d: 0.03 } : { x: fixed, y: yb + p.lo, z: start + (a + b) / 2, w: 0.03, h: p.hi - p.lo, d: b - a });
        else if (rnd() < 0.5) seg(a, b, p.lo, p.hi, 'wood', 0.04, T / 2 - 0.02, { noCollide: true });       // boarded / shuttered
      }
      if (p.door) { seg(a - 0.1, a, 0, p.hi + 0.1, 'frame', T + 0.08, 0, { noCollide: true }); seg(b, b + 0.1, 0, p.hi + 0.1, 'frame', T + 0.08, 0, { noCollide: true }); }
      cur = b;
    }
    if (cur < L) seg(cur, L, 0, fh);
  }
  function band(x0, z0, x1, z1, y, h, d, m = 'concrete') {
    box((x0 + x1) / 2, y, z0 - d / 2, x1 - x0 + 2 * d, h, d, m, { noCollide: true }); box((x0 + x1) / 2, y, z1 + d / 2, x1 - x0 + 2 * d, h, d, m, { noCollide: true });
    box(x0 - d / 2, y, (z0 + z1) / 2, d, h, z1 - z0, m, { noCollide: true }); box(x1 + d / 2, y, (z0 + z1) / 2, d, h, z1 - z0, m, { noCollide: true });
  }
  function awning(x0, z0, x1, z1, side) {
    const g = new THREE.BoxGeometry(x1 - x0 - 2, 0.05, 2.2); place(g, 'clothA', (x0 + x1) / 2, 2.9, z0 - 1.0, -0.32, 0, 0, { uvScale: 2 }); g.dispose();
    for (const x of [x0 + 1.2, x1 - 1.2]) box(x, 0.15, z0 - 2.0, 0.08, 2.5, 0.08, 'metalGrey', { noCollide: true });
  }
  function ruin(x0, z0, x1, z1) {
    const segs = [[x0, z0, x1, z0 + T], [x0, z1 - T, x1, z1], [x0, z0 + T, x0 + T, z1 - T], [x1 - T, z0 + T, x1, z1 - T]];
    for (const [a, b, c, d] of segs) {
      const along = c - a > d - b, L = along ? c - a : d - b, n = Math.ceil(L / 1.2);
      for (let i = 0; i < n; i++) { if (rnd() < 0.18) continue; const h = r(0.6, 4.2), s = (along ? a : b) + i * (L / n); if (along) rect(s, 0, b, s + L / n, h, d, 'brick'); else rect(a, 0, s, c, h, s + L / n, 'brick'); }
    }
    for (let i = 0; i < 9; i++) rubble(r(x0 + 2, x1 - 2), r(z0 + 2, z1 - 2), r(0.6, 1.3));
    box((x0 + x1) / 2, 2.6, z1 - 3, 5, 0.25, 5.5, 'concrete', { yaw: 0.2 });
  }
  function frameBuilding(x0, z0, x1, z1) {
    for (let x = x0; x <= x1 + 0.01; x += 4) for (let z = z0; z <= z1 + 0.01; z += 4) box(x, 0, z, 0.45, 6.4 + 1.2, 0.45, 'concrete');
    for (const y of [3.2, 6.4]) { rect(x0 - 0.3, y - 0.25, z0 - 0.3, x1 + 0.3, y, z0 + 4.5, 'concrete'); rect(x0 - 0.3, y - 0.25, z0 + 7.5, x1 + 0.3, y, z1 + 0.3, 'concrete'); rect(x0 - 0.3, y - 0.25, z0 + 4.5, x0 + 4, y, z0 + 7.5, 'concrete'); rect(x0 + 7, y - 0.25, z0 + 4.5, x1 + 0.3, y, z0 + 7.5, 'concrete'); }
    // two flights in the gap
    const n = 13, rise = 3.2 / n, run = 2.6 / n;
    for (let k = 0; k < n; k++) { const xa = x0 + 4.05 + k * (2.9 / n); rect(xa, 0, z0 + 4.6, xa + 2.9 / n, (k + 1) * rise, z0 + 5.9, 'concrete'); }
    for (let k = 0; k < n; k++) { const xa = x0 + 6.95 - (k + 1) * (2.9 / n); rect(xa, 3.2, z0 + 6.1, xa + 2.9 / n, 3.2 + (k + 1) * rise, z0 + 7.4, 'concrete'); }
    rect(x0 + 4.05, 0, z0 + 5.95, x0 + 6.95, 7.4, z0 + 6.05, 'metalGrey');
    for (let k = 0; k < 6; k++) box(r(x0, x1), 6.4, r(z0, z1), 0.08, r(0.8, 1.6), 0.08, 'metalGrey', { noCollide: true }); // rebar
    rect(x0 - 0.3, 6.4, z0 - 0.3, x1 + 0.3, 7.4, z0 - 0.2, 'concrete'); rect(x0 - 0.3, 6.4, z1 + 0.2, x1 + 0.3, 7.4, z1 + 0.3, 'concrete');
  }
  function scaffold(x0, z, x1) {
    for (let x = x0; x <= x1; x += 2.4) for (const dz of [0, 1.2]) B.cyl(x, 0, z + dz, 0.04, 6.6, 'metalGrey', { noCollide: true, seg: 6 });
    for (const y of [2.1, 4.2]) rect(x0, y, z - 0.1, x1, y + 0.06, z + 1.3, 'wood');
  }
  function crane(x, z) {
    for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) box(x + dx, 0, z + dz, 0.18, 30, 0.18, 'hazard', { noCollide: dz > 0 || dx > 0 });
    for (let y = 2; y < 30; y += 2.5) { box(x, y, z - 0.8, 1.7, 0.1, 0.1, 'hazard', { noCollide: true }); box(x, y, z + 0.8, 1.7, 0.1, 0.1, 'hazard', { noCollide: true }); box(x - 0.8, y, z, 0.1, 0.1, 1.7, 'hazard', { noCollide: true }); box(x + 0.8, y, z, 0.1, 0.1, 1.7, 'hazard', { noCollide: true }); }
    box(x + 9, 30, z, 26, 1.0, 1.0, 'hazard', { noCollide: true }); box(x - 5, 29.2, z, 4, 1.8, 2.2, 'concrete', { noCollide: true }); box(x + 1.2, 28.5, z, 2.4, 2.6, 2.4, 'metalGrey', { noCollide: true });
    world.add(x, 0, z, 1.9, 30, 1.9, 0, 'metalGrey');
  }
  function sandpile(x, z, s) { const g = new THREE.ConeGeometry(s * 1.6, s, 10); place(g, 'dirt', x, s / 2, z, 0, rnd(), 0, { uvScale: 2 }); g.dispose(); world.add(x, 0, z, s * 1.6, s * 0.75, s * 1.6, 0, 'dirt'); }
  function car(x, z, yaw, mat, onFire) {
    const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx, lz) => [x + c * lx + s * lz, z - s * lx + c * lz];
    box(x, 0.32, z, 4.3, 0.72, 1.86, mat, { yaw, noCollide: true });
    let [cx, cz] = at(-0.3, 0); box(cx, 1.04, cz, 2.3, 0.64, 1.68, mat === 'burnt' ? 'burnt' : 'darkGlass', { yaw, noCollide: true });
    box(cx, 1.66, cz, 2.0, 0.08, 1.6, mat, { yaw, noCollide: true });
    for (const lx of [-2.17, 2.17]) { const [bx, bz] = at(lx, 0); box(bx, 0.36, bz, 0.12, 0.28, 1.9, 'black', { yaw, noCollide: true }); }
    for (const [lx, lz] of [[-1.35, -0.86], [1.35, -0.86], [-1.35, 0.86], [1.35, 0.86]]) { const [wx, wz] = at(lx, lz); const g = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14); place(g, 'rubber', wx, 0.34, wz, 0, yaw, Math.PI / 2, { uvScale: 1 }); g.dispose(); }
    if (mat !== 'burnt') for (const lz of [-0.6, 0.6]) { const [hx, hz] = at(2.16, lz); box(hx, 0.62, hz, 0.06, 0.12, 0.28, 'lamp', { yaw, noCollide: true, shadow: false }); }
    world.add(x, 0, z, 4.35, 1.04, 1.9, yaw, 'metalGrey'); [cx, cz] = at(-0.3, 0); world.add(cx, 1.04, cz, 2.3, 0.7, 1.7, yaw, 'metalGrey');
    if (onFire) info.fires.push(new THREE.Vector3(x, 1.2, z));
  }
  function truck(x, z, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw), at = (lx) => [x + c * lx, z - s * lx];
    let [a, b] = at(2.8); box(a, 0.5, b, 2.0, 2.2, 2.3, 'metalBlue', { yaw }); box(a + c * 0.98, 1.6, b - s * 0.98, 0.06, 0.8, 2.0, 'darkGlass', { yaw, noCollide: true });
    [a, b] = at(-1.2); box(a, 0.6, b, 5.4, 2.5, 2.4, 'contOrange', { yaw }); box(a, 0.35, b, 7.6, 0.3, 2.2, 'metalGrey', { yaw, noCollide: true });
    for (const lx of [-3, -1.8, 2.8]) for (const lz of [-1, 1]) { const g = new THREE.CylinderGeometry(0.48, 0.48, 0.34, 14); place(g, 'rubber', x + c * lx + s * lz, 0.48, z - s * lx + c * lz, 0, yaw, Math.PI / 2); g.dispose(); }
  }
  function apc(x, z, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    box(x, 0.55, z, 2.7, 1.5, 6.4, 'burnt', { yaw }); box(x, 2.05, z - c * 0 , 2.3, 0.5, 4.6, 'burnt', { yaw, noCollide: true });
    box(x, 2.55, z, 1.4, 0.6, 1.6, 'burnt', { yaw, noCollide: true });
    const g = new THREE.CylinderGeometry(0.07, 0.07, 2.4, 8); place(g, 'burnt', x + s * 1.9, 2.85, z + c * 1.9, Math.PI / 2 - 0.1, yaw, 0); g.dispose();
    for (const lz of [-2.2, -0.7, 0.8, 2.3]) for (const lx of [-1.35, 1.35]) { const g2 = new THREE.CylinderGeometry(0.55, 0.55, 0.4, 14); place(g2, 'rubber', x + c * lx + s * lz, 0.55, z - s * lx + c * lz, 0, yaw, Math.PI / 2); g2.dispose(); }
  }
  function bus(x, z, yaw) {
    box(x, 0.45, z, 2.6, 2.4, 10.5, 'burnt', { yaw }); box(x, 1.7, z, 2.66, 0.8, 9.6, 'darkGlass', { yaw, noCollide: true });
    for (const lz of [-3.6, 3.4]) for (const lx of [-1.3, 1.3]) { const c = Math.cos(yaw), s = Math.sin(yaw); const g = new THREE.CylinderGeometry(0.5, 0.5, 0.3, 14); place(g, 'rubber', x + c * lx + s * lz, 0.5, z - s * lx + c * lz, 0, yaw, Math.PI / 2); g.dispose(); }
  }
  function container(x, y0, z, yaw, mat) {
    box(x, y0, z, 6.06, 2.59, 2.44, mat, { yaw, uv: 2.6 });
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const lx of [-3.04, 3.04]) box(x + c * lx, y0, z - s * lx, 0.08, 2.59, 2.5, 'metalGrey', { yaw, noCollide: true });
  }
  function crates(x, z, n, y0 = 0) { for (let i = 0; i < n; i++) { const sz = r(0.8, 1.2), stack = i >= 2 ? 1 : 0; box(x + (i % 2) * 1.15 + r(-0.1, 0.1), y0 + stack * 1.0, z + (stack ? 0.3 : 0) + r(-0.1, 0.1), sz, sz, sz, 'wood', { yaw: r(-0.2, 0.2), uv: 1.2, flags: { pen: 0.5 } }); } }
  function drum(x, z, mat) { B.cyl(x, 0, z, 0.3, 0.88, mat, { uvScale: 1 }); }
  function jersey(x, z, yaw) { box(x, 0, z, 0.8, 0.3, 3, 'concrete', { yaw, noCollide: true }); box(x, 0.3, z, 0.38, 0.75, 3, 'concrete', { yaw, noCollide: true }); world.add(x, 0, z, 0.7, 1.05, 3, yaw, 'concrete'); }
  function sandbags(x, z, len, yaw) {
    const c = Math.cos(yaw), s = Math.sin(yaw), n = Math.round(len / 0.55);
    for (let row = 0; row < 4; row++) for (let i = 0; i < n - (row % 2); i++) { const lx = -len / 2 + 0.28 + i * 0.55 + (row % 2) * 0.27; box(x + c * lx, row * 0.22, z - s * lx, 0.52, 0.22, 0.34, 'sandbag', { yaw: yaw + r(-0.08, 0.08), noCollide: true, uv: 1 }); }
    world.add(x, 0, z, len, 0.9, 0.5, yaw, 'sandbag');
  }
  function booth(x, z) { rect(x - 1.1, 0, z - 1.1, x + 1.1, 2.5, z - 0.95, 'metalWhite'); rect(x - 1.1, 0, z + 0.95, x + 1.1, 1.0, z + 1.1, 'metalWhite'); rect(x - 1.1, 0, z - 0.95, x - 0.95, 2.5, z + 0.95, 'metalWhite'); rect(x - 1.3, 2.5, z - 1.3, x + 1.3, 2.62, z + 1.3, 'metalGrey'); }
  function bench(x, z, yaw) { box(x, 0.4, z, 1.8, 0.08, 0.45, 'wood', { yaw, noCollide: true }); for (const d of [-0.7, 0.7]) box(x + Math.cos(yaw) * d, 0.06, z - Math.sin(yaw) * d, 0.08, 0.36, 0.4, 'metalGrey', { yaw, noCollide: true }); world.add(x, 0, z, 1.8, 0.48, 0.45, yaw, 'wood'); }
  function deadShrub(x, y, z) { for (let i = 0; i < 4; i++) { const g = new THREE.CylinderGeometry(0.01, 0.035, r(0.6, 1.1), 5); place(g, 'wood', x + r(-0.3, 0.3), y + 0.35, z + r(-0.3, 0.3), r(-0.4, 0.4), 0, r(-0.4, 0.4)); g.dispose(); } }
  function lamp(x, z) { B.cyl(x, 0, z, 0.08, 6, 'metalGrey', { noCollide: false, seg: 8 }); box(x, 5.9, z, 1.2, 0.08, 0.12, 'metalGrey', { noCollide: true }); box(x + 0.55, 5.72, z, 0.4, 0.16, 0.22, 'lamp', { noCollide: true }); }
  function table(x, y, z, yaw) { box(x, y + 0.72, z, 1.4, 0.06, 0.8, 'wood', { yaw, noCollide: true }); for (const [a, b] of [[-0.6, -0.32], [0.6, -0.32], [-0.6, 0.32], [0.6, 0.32]]) box(x + Math.cos(yaw) * a + Math.sin(yaw) * b, y, z - Math.sin(yaw) * a + Math.cos(yaw) * b, 0.06, 0.72, 0.06, 'wood', { noCollide: true }); world.add(x, y, z, 1.4, 0.78, 0.8, yaw, 'wood', { pen: 0.6 }); }
  function stall(x, z, yaw, cloth) {
    for (const [a, b] of [[-1.6, -0.9], [1.6, -0.9], [-1.6, 0.9], [1.6, 0.9]]) box(x + a, 0, z + b, 0.08, 2.4, 0.08, 'wood', { noCollide: true });
    box(x, 0, z + (yaw ? 0.6 : -0.6), 3.2, 0.95, 0.7, 'wood', { flags: { pen: 0.6 } });
    const g = new THREE.BoxGeometry(3.6, 0.04, 2.3); place(g, cloth, x, 2.45, z, yaw ? -0.18 : 0.18, 0, 0, { uvScale: 2 }); g.dispose();
    for (let i = 0; i < 3; i++) box(x - 1 + i, 0.95, z + (yaw ? 0.6 : -0.6), 0.5, 0.2, 0.4, ['clothA', 'wood', 'clothC'][i], { noCollide: true });
  }
  function fence(x0, z0, x1, z1, h = 1.1, gap = 0) {
    const L = Math.hypot(x1 - x0, z1 - z0), n = Math.ceil(L / 2.5), yaw = Math.atan2(-(z1 - z0), x1 - x0);
    for (let i = 0; i <= n; i++) { if (gap && Math.abs(i / n - 0.5) < gap * 0.5) continue; const t = i / n; B.cyl(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t, 0.04, h, 'metalGrey', { noCollide: true, seg: 6 }); }
    for (const y of [h * 0.45, h - 0.05]) for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; if (gap && Math.abs(t - 0.5) < gap * 0.5) continue; box(x0 + (x1 - x0) * t, y, z0 + (z1 - z0) * t, L / n, 0.05, 0.04, 'metalGrey', { yaw, noCollide: true }); }
  }
  function dumpster(x, z, yaw) { box(x, 0, z, 1.9, 1.2, 1.1, 'metalGreen', { yaw }); box(x, 1.2, z, 2.0, 0.08, 1.2, 'metalGreen', { yaw: yaw + 0.02, noCollide: true }); }
  function trash(x, z) { for (let i = 0; i < 4; i++) { const g = new THREE.SphereGeometry(r(0.22, 0.32), 8, 6); place(g, 'black', x + r(-0.5, 0.5), 0.2, z + r(-0.5, 0.5), 0, rnd() * 3, 0); g.dispose(); } }
  function crater(x, z) { const g = new THREE.CircleGeometry(r(1.6, 2.4), 18); place(g, 'burnt', x, 0.045, z, -Math.PI / 2, 0, 0, { uvScale: 2, shadow: false }); g.dispose(); for (let i = 0; i < 5; i++) rubble(x + r(-2, 2), z + r(-2, 2), r(0.2, 0.45)); }
  function rubble(x, z, s) { for (let i = 0; i < 4; i++) box(x + r(-s, s), 0, z + r(-s, s), r(0.2, 0.6) * s * 1.6, r(0.1, 0.4) * s, r(0.2, 0.6) * s * 1.6, rnd() < 0.5 ? 'concrete' : 'brick', { yaw: rnd() * 3, noCollide: s < 0.8 }); }
  function tree(x, z) { B.cyl(x, 0, z, 0.18, 5.5, 'wood', { r2: 0.06, seg: 8 }); for (let i = 0; i < 6; i++) { const g = new THREE.CylinderGeometry(0.015, 0.06, r(1.2, 2.4), 5); g.translate(0, 0.9, 0); place(g, 'wood', x, r(2.6, 5), z, r(-1, 1), rnd() * 6, r(-1, 1)); g.dispose(); } }
  function powerline(x0, z0, x1, z1) {
    const n = 6; for (let i = 0; i <= n; i++) { const x = x0 + (x1 - x0) * (i / n), z = z0 + (z1 - z0) * (i / n); B.cyl(x, 0, z, 0.12, 8, 'wood', { seg: 8 }); box(x, 7.4, z, 1.6, 0.1, 0.1, 'wood', { noCollide: true }); }
    for (let i = 0; i < n; i++) for (const off of [-0.7, 0.7]) {
      const ax = x0 + (x1 - x0) * (i / n) + off, az = z0 + (z1 - z0) * (i / n), bx = x0 + (x1 - x0) * ((i + 1) / n) + off, bz = z0 + (z1 - z0) * ((i + 1) / n);
      const pts = []; for (let k = 0; k <= 10; k++) { const t = k / 10; pts.push(new THREE.Vector3(ax + (bx - ax) * t, 7.5 - Math.sin(t * Math.PI) * 1.2, az + (bz - az) * t)); }
      const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 10, 0.018, 4); B.geo(g, 'black', new THREE.Matrix4(), { shadow: false }); g.dispose();
    }
  }
  function armory(a) {
    const { x, z } = a.pos, yaw = a.yaw;
    box(x, 0.15, z, 1.6, 1.1, 0.9, 'armory', { yaw }); box(x, 1.25, z, 1.7, 0.1, 1.0, 'metalGrey', { yaw, noCollide: true });
    const c = Math.cos(yaw), s = Math.sin(yaw); box(x + s * 0.46, 0.55, z + c * 0.46, 0.9, 0.45, 0.02, 'screen', { yaw, noCollide: true, shadow: false });
  }
}

function buildGlass(scene, world, info) {
  const n = info.glass.length; if (!n) return;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), MAT.glass, n), m = new THREE.Matrix4();
  info.glass.forEach((g, i) => { m.makeScale(g.w, g.h, g.d).setPosition(g.x, g.y + g.h / 2, g.z); mesh.setMatrixAt(i, m); g.index = i; g.solid = world.add(g.x, g.y, g.z, g.w, g.h, Math.max(g.d, 0.06), 0, 'glass', { glass: true, pane: g }); });
  mesh.renderOrder = 2; scene.add(mesh); info.glassMesh = mesh;
}
function buildSigns(scene, info) {
  for (const s of info.signs) {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; const g = cv.getContext('2d');
    g.fillStyle = s.bg; g.fillRect(0, 0, 512, 96); g.strokeStyle = 'rgba(255,255,255,.25)'; g.lineWidth = 4; g.strokeRect(6, 6, 500, 84);
    g.fillStyle = s.color; g.font = '600 54px Teko, "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(s.text, 256, 52);
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.25})`; g.fillRect(Math.random() * 512, Math.random() * 96, 3, 3); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const w = 4.2, mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 96 / 512), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    const cx = (s.x0 + s.x1) / 2, cz = (s.z0 + s.z1) / 2;
    if (s.side === 's') { mesh.position.set(cx, s.y, s.z0 - 0.06); mesh.rotation.y = Math.PI; }
    if (s.side === 'n') mesh.position.set(cx, s.y, s.z1 + 0.06);
    if (s.side === 'e') { mesh.position.set(s.x1 + 0.06, s.y, cz); mesh.rotation.y = Math.PI / 2; }
    if (s.side === 'w') { mesh.position.set(s.x0 - 0.06, s.y, cz); mesh.rotation.y = -Math.PI / 2; }
    scene.add(mesh);
  }
}
