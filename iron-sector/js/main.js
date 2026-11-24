// Main: boot and loading, screen flow (splash, menus, pause, armory, mission report), pointer lock, the frame loop and the menu flyover.
import * as THREE from 'three';
import { G, settings, saveSettings, Input, isTouch, clamp, lerp, rand, pick } from './core.js';
import { AudioEngine } from './audio.js';
import { buildMaterials } from './textures.js';
import { Renderer } from './render.js';
import { World, Nav } from './world.js';
import { buildMap } from './map.js';
import { FX } from './fx.js';
import { Arsenal } from './weapons.js';
import { Player } from './player.js';
import { Soldiers } from './soldiers.js';
import { Combat, Throwables, Props, Pickups, Support, Game } from './systems.js';
import { UI } from './ui.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const SCREENS = ['splash', 'menu', 'play', 'settings', 'controls', 'credits', 'loading', 'pause', 'armory', 'over'];
const TIPS = [
  'Headshots pay double cash.',
  'Hold G to cook a frag grenade, then let go before it cooks off in your hand.',
  'Red barrels burn for a couple of seconds after they are hit, then explode.',
  'Bullets punch through wood, plaster and thin metal. Concrete and brick stop them.',
  'Kill 3, 5 and 8 hostiles without dropping below a third of your health to earn air support.',
  'Enemy marksmen give themselves away with a red laser and a scope glint.',
  'Juggernauts shrug off body shots. Aim high or bring explosives.',
  'Walk over a dropped weapon you already carry to take its ammo.',
  'Suppressed weapons keep you off the enemy minimap.',
  'Hold your breath with Shift while scoped to steady a sniper rifle.',
  'Press Space next to a low wall to vault over it.'
];

let mode = 'boot', paused = false, backTo = 'menu', armType = null, armTab = null, menuT = 0, ambT = 0, wantResume = false;
const loops = {};

function show(id) { for (const s of SCREENS) { const el = $(s); if (el) el.hidden = s !== id; } }
function hud(on) { $('hud').hidden = !on; $('touch').hidden = !(on && isTouch); }

async function boot() {
  const press = $('splashPress'), note = $('splashNote');
  show('splash');
  let renderer;
  try { renderer = new Renderer($('view')); }
  catch (e) { press.textContent = 'WebGL is not available'; note.textContent = 'Iron Sector needs a browser with WebGL 2 and hardware acceleration turned on.'; return; }
  G.renderer = renderer; G.scene = renderer.scene; G.camera = renderer.camera;
  G.audio = new AudioEngine(); G.input = new Input(); G.ui = new UI();
  const step = async (label, frac) => { press.textContent = `${label} · ${Math.round(frac * 100)}%`; await new Promise((r) => setTimeout(r, 0)); };
  await buildMaterials(settings.texSize, (f) => { press.textContent = `Building materials · ${Math.round(f * 60)}%`; });
  await step('Constructing the Old Quarter', 0.62);
  G.world = new World(); const { info } = buildMap(renderer.scene, G.world); G.mapInfo = info;
  await step('Surveying routes', 0.72);
  G.nav = new Nav(); G.nav.build(G.world);
  await step('Deploying', 0.86);
  G.fx = new FX(renderer.scene, settings.lights);
  G.enemies = new Soldiers(renderer.scene);
  G.arsenal = new Arsenal(renderer.vmScene, renderer.vmCam);
  G.player = new Player();
  G.combat = new Combat(); G.throwables = new Throwables(renderer.scene); G.props = new Props(renderer.scene, info); G.pickups = new Pickups(renderer.scene); G.support = new Support(renderer.scene);
  G.game = new Game(); G.stats = { shots: 0, hits: 0, kills: 0, heads: 0, score: 0, cashEarned: 0 };
  G.ui.buildMinimap(G.world);
  G.main = { gameOver, openArmory, startGame, show, sim, tick, pauseGame, resume, get mode() { return mode; }, get paused() { return paused; } };
  await step('Compiling shaders', 0.94);
  menuCamera(0);
  try { renderer.r.compile(renderer.scene, renderer.camera); renderer.r.compile(renderer.vmScene, renderer.vmCam); } catch (e) { /* compile is only a warm-up */ }
  if (isTouch) { G.input.attachTouch($('touch')); document.body.classList.add('touch'); }
  const fitTouch = () => $('touch').style.setProperty('--k', String(clamp(innerHeight / 520, 0.62, 1.2)));
  fitTouch(); addEventListener('resize', fitTouch);
  wireMenus();
  G.input.onLockChange = onLock;
  addEventListener('blur', () => { if (mode === 'game' && !paused && !G.debug) pauseGame(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'game' && !paused) pauseGame(); });
  if (G.debug) window.__G = G;
  press.textContent = isTouch ? 'Tap to start' : 'Click to start';
  note.textContent = 'Best with headphones. Keyboard and mouse, controller or touch.';
  const go = () => { $('splash').removeEventListener('pointerdown', go); removeEventListener('keydown', go); G.audio.init(); startAmbience(); toMenu(); };
  $('splash').addEventListener('pointerdown', go); addEventListener('keydown', go);
  mode = 'splash';
  requestAnimationFrame(frame);
}

function startAmbience() {
  if (!G.audio.ready || loops.wind) return;
  loops.wind = G.audio.loop('wind'); if (loops.wind) loops.wind.set(0.18);
  loops.music = G.audio.loop('drone'); if (loops.music) loops.music.set(0.5);
  loops.fires = G.mapInfo.fires.slice(0, 6).map((p) => { const l = G.audio.loop('fire', p); if (l) l.set(0.22, p); return l; });
}

// ---------------------------------------------------------------- menus
function wireMenus() {
  document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => {
    const go = b.dataset.go; G.audio.uiSound('select');
    backTo = mode === 'game' ? 'pause' : 'menu';
    if (go === 'play') { selectDiff(settings.difficulty); show('play'); }
    else { if (go === 'settings') G.ui.syncSettings(); show(go); }
  }));
  document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => { G.audio.uiSound('select'); show(backTo); }));
  document.querySelectorAll('#diffCards .card').forEach((c) => c.addEventListener('click', () => { selectDiff(c.dataset.diff); G.audio.uiSound('select'); }));
  $('deploy').addEventListener('click', () => { G.audio.uiSound('select'); deploy(); });
  $('pResume').addEventListener('click', () => resume());
  $('pRestart').addEventListener('click', () => { G.audio.uiSound('select'); deploy(); });
  $('pQuit').addEventListener('click', () => { G.audio.uiSound('select'); G.game.running = false; toMenu(); });
  $('oAgain').addEventListener('click', () => { G.audio.uiSound('select'); deploy(); });
  $('oMenu').addEventListener('click', () => { G.audio.uiSound('select'); toMenu(); });
  $('armClose').addEventListener('click', () => closeArmory());
  document.querySelectorAll('button').forEach((b) => b.addEventListener('pointerenter', () => { if (G.audio.ready) G.audio.uiSound('hover'); }));
  G.ui.bindSettings(() => G.renderer.applyQuality());
  addEventListener('keydown', (e) => {
    if (e.code !== 'Escape' && e.code !== 'KeyP') return;
    if (mode === 'game' && paused) { if (!$('armory').hidden) closeArmory(); else if (!$('pause').hidden) resume(); else show('pause'); }
  });
}
function selectDiff(d) { settings.difficulty = d; saveSettings(); document.querySelectorAll('#diffCards .card').forEach((c) => c.classList.toggle('sel', c.dataset.diff === d)); }
function toMenu() {
  mode = 'menu'; paused = false; hud(false); G.input.exitLock(); G.input.capture = false;
  G.enemies.clear(); G.throwables.clear(); G.pickups.clear(); G.support.reset(); G.props.reset(); G.fx.clear();
  G.renderer.vmPass.enabled = false;
  const prof = G.game.profile; G.ui.showRank('m', prof.xp);
  $('bestLine').textContent = prof.bestWave ? `Best: wave ${prof.bestWave} · ${fmt(prof.bestScore)} points` : 'No missions flown yet.';
  if (loops.music) loops.music.set(0.5);
  show('menu');
  const first = document.querySelector('#menu .item'); if (first && !isTouch) first.focus({ preventScroll: true });
}
function deploy() {
  G.input.requestLock(G.renderer.r.domElement);
  show('loading'); hud(false);
  $('loadTip').textContent = pick(TIPS); $('loadText').textContent = `Survival · ${settings.difficulty}`;
  const bar = $('loadBar'); bar.style.width = '0%';
  let p = 0; const t = setInterval(() => { p = Math.min(1, p + 0.22); bar.style.width = `${p * 100}%`; if (p >= 1) { clearInterval(t); startGame(); } }, 120);
}
function startGame() {
  G.game.start(); mode = 'game'; paused = false; perf.skip = 3; perf.acc = 0; perf.n = 0; G.input.capture = true; G.input.clear();
  G.renderer.vmPass.enabled = true; show(null); hud(true);
  if (loops.music) loops.music.set(0.18);
  if (!G.input.locked && !isTouch && !G.debug) G.input.requestLock(G.renderer.r.domElement);
}
function pauseGame() {
  if (mode !== 'game' || paused) return;
  paused = true; wantResume = false; G.input.exitLock(); G.input.clear(); hud(false);
  $('pauseKicker').textContent = `Survival · Wave ${Math.max(1, G.game.wave)}`; backTo = 'pause'; show('pause');
  const first = $('pResume'); if (!isTouch) first.focus({ preventScroll: true });
}
function resume() {
  if (mode !== 'game') return;
  G.audio.uiSound('select');
  if (isTouch || G.debug || G.input.locked) { unpause(); return; }
  wantResume = true; G.input.requestLock(G.renderer.r.domElement);
  setTimeout(() => { if (wantResume && !G.input.locked) { wantResume = false; unpause(); } }, 900);
}
function unpause() { paused = false; wantResume = false; show(null); hud(true); G.input.clear(); }
function onLock(locked) {
  if (locked && wantResume) unpause();
  if (!locked && mode === 'game' && !paused && !G.debug) pauseGame();
}

// ---------------------------------------------------------------- armory
const ARM = { weapons: { title: 'Weapons', tabs: [['weapons', 'Weapons'], ['attachments', 'Attachments']] }, equipment: { title: 'Equipment', tabs: [['equipment', 'Gear'], ['perks', 'Perks']] }, support: { title: 'Air support', tabs: [['support', 'Support']] } };
function openArmory(type) {
  if (mode !== 'game' || paused) return;
  paused = true; armType = type; armTab = ARM[type].tabs[0][0];
  G.input.exitLock(); G.input.clear(); $('armNote').textContent = G.game.intermission ? 'The district is quiet. Take your time.' : 'Hostiles are still out there. The fight is paused while you shop.';
  renderArmory(); show('armory'); G.audio.uiSound('select');
}
function renderArmory() {
  const A = ARM[armType];
  $('armTitle').textContent = A.title; $('armCash').textContent = `$${fmt(G.game.cash)}`;
  $('armTabs').innerHTML = ''; for (const [k, label] of A.tabs) { const b = document.createElement('button'); b.textContent = label; b.classList.toggle('on', k === armTab); b.onclick = () => { armTab = k; renderArmory(); G.audio.uiSound('select'); }; $('armTabs').appendChild(b); }
  const grid = $('armGrid'); grid.innerHTML = '';
  for (const it of G.game.armory(armType, armTab)) {
    const b = document.createElement('button'), off = !it.own && (G.game.cash < it.price || it.full);
    b.className = `buy${it.own ? ' own' : ''}${off ? ' off' : ''}`;
    b.innerHTML = `<b>${it.name}</b><span>${it.desc}</span><em>${it.own ? 'Owned' : it.full ? 'Inventory full' : `$${fmt(it.price)}`}</em>`;
    b.onclick = () => { $('armNote').textContent = G.game.purchase(it); renderArmory(); };
    grid.appendChild(b);
  }
}
function closeArmory() { if ($('armory').hidden) return; G.audio.uiSound('select'); armType = null; resume(); if (paused && !wantResume) unpause(); }

// ---------------------------------------------------------------- mission report
function gameOver() {
  mode = 'over'; paused = false; hud(false); G.input.exitLock(); G.input.capture = false; G.renderer.vmPass.enabled = false;
  const st = G.stats, g = G.game, waves = Math.max(0, g.state === 'wave' ? g.wave - 1 : g.wave);
  $('oWave').textContent = waves; $('oKills').textContent = st.kills; $('oHead').textContent = st.heads;
  $('oAcc').textContent = `${st.shots ? Math.round((st.hits / st.shots) * 100) : 0}%`; $('oScore').textContent = fmt(st.score); $('oCash').textContent = `$${fmt(st.cashEarned)}`;
  $('overKicker').textContent = `Survival · ${settings.difficulty} · ${waves} wave${waves === 1 ? '' : 's'}`;
  G.ui.showRank('o', g.profile.xp); $('oXp').textContent += ` · +${fmt(g.xp)} this mission`;
  if (loops.music) loops.music.set(0.5);
  show('over');
}

// ---------------------------------------------------------------- cameras
function menuCamera(dt) {
  menuT += dt; const cam = G.camera, a = menuT * 0.045 + 0.6;
  cam.position.set(Math.cos(a) * 34, 13 + Math.sin(menuT * 0.2) * 1.5, Math.sin(a) * 34);
  cam.lookAt(Math.cos(a + 0.9) * 6, 3, Math.sin(a + 0.9) * 6);
  if (cam.fov !== 62) { cam.fov = 62; cam.updateProjectionMatrix(); }
  cam.updateMatrixWorld();
}

// ---------------------------------------------------------------- gamepad navigation for menus
const padNav = { prev: [], t: 0 };
function menuPad(dt) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []; let gp = null; for (const p of pads) if (p && p.connected) { gp = p; break; }
  if (!gp) return;
  const on = (i) => gp.buttons[i] && gp.buttons[i].value > 0.5, edge = (i) => on(i) && !padNav.prev[i];
  const ay = gp.axes[1] || 0, ax = gp.axes[0] || 0; padNav.t -= dt;
  let dir = 0; if (edge(13) || edge(15)) dir = 1; if (edge(12) || edge(14)) dir = -1;
  if (!dir && padNav.t <= 0 && (Math.abs(ay) > 0.6 || Math.abs(ax) > 0.6)) { dir = (Math.abs(ay) > Math.abs(ax) ? ay : ax) > 0 ? 1 : -1; padNav.t = 0.22; }
  const screen = SCREENS.map($).find((el) => el && !el.hidden);
  if (screen) {
    const items = [...screen.querySelectorAll('button, input')].filter((b) => b.offsetParent !== null);
    if (dir && items.length) { const i = items.indexOf(document.activeElement); const n = items[(i + dir + items.length) % items.length]; n.focus({ preventScroll: false }); G.audio.uiSound('hover'); }
    if (edge(0)) { const el = document.activeElement; if (el && items.includes(el)) { if (el.type === 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new Event('change')); } else el.click(); } }
    if (edge(1)) { const back = screen.querySelector('[data-back]') || (screen.id === 'armory' ? $('armClose') : screen.id === 'pause' ? $('pResume') : null); if (back) back.click(); }
    if (edge(9) && screen.id === 'pause') resume();
    const el = document.activeElement; if (el && el.type === 'range' && Math.abs(ax) > 0.5 && padNav.t <= 0) { el.value = +el.value + Math.sign(ax) * +el.step * 2; el.dispatchEvent(new Event('input')); padNav.t = 0.08; }
  }
  padNav.prev = gp.buttons.map((b) => b && b.value > 0.5);
}

// ---------------------------------------------------------------- frame loop
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, Math.max(0.0005, (now - last) / 1000)); last = now;
  if (G.hold) return;
  tick(dt); G.renderer.render(dt);
  if (mode === 'game' && !paused && !G.debug) adapt(dt);
}
function tick(dt) {
  G.dt = dt;
  const R = G.renderer, playing = mode === 'game' && !paused;
  if (playing) {
    G.t += dt;
    const ar = G.arsenal, e = ar.ads * ar.ads * (3 - 2 * ar.ads), zoomK = 1 / lerp(1, ar.zoom(), e);
    const A = G.input.poll(dt, G.player.aimScale() * zoomK * lerp(1, settings.adsSens, e));
    if (A.pause) pauseGame();
    else {
      G.player.update(dt, A);
      ar.update(dt, A, G.player);
      if (A.streak) G.support.useNext();
      G.ui.promptText = G.game.interact(A);
      G.game.update(dt); G.enemies.update(dt); G.throwables.update(dt); G.props.update(dt); G.pickups.update(dt); G.support.update(dt);
    }
  } else if (mode !== 'game') {
    G.t += dt; menuCamera(dt);
    if (G.input) menuPad(dt);
  } else if (G.input) menuPad(dt);
  // ambience: burning wrecks and distant smoke columns
  if (!paused && G.fx) {
    for (const p of G.mapInfo.fires) G.fx.fire(p, 1);
    ambT -= dt; if (ambT <= 0) { ambT = 0.55; for (const p of G.mapInfo.smoke) G.fx.smokeColumn(p); }
    G.fx.update(dt, G.camera, R);
  }
  if (G.player && mode === 'game') R.follow(G.player.pos); else R.follow(G.camera.position);
  if (G.audio && G.audio.ready) { G.audio.listener(G.camera); G.audio.update(dt, playing); }
  if (G.ui) G.ui.update(dt, mode === 'game' && G.game && G.game.running !== undefined);
}
// adaptive quality: shed ambient occlusion first, then resolution, when frames run long; recover slowly
const perf = { acc: 0, n: 0, good: 0, skip: 3 };
function adapt(dt) {
  const R = G.renderer; if (!settings.autoQuality) { if (R.dynScale !== 1 || R.aoShed) { R.dynScale = 1; R.aoShed = false; R.applyQuality(); } return; }
  if (perf.skip > 0) { perf.skip -= dt; return; }
  perf.acc += dt; perf.n++; if (perf.acc < 2) return;
  const fps = perf.n / perf.acc; perf.acc = 0; perf.n = 0;
  if (fps < 44) { perf.good = 0; if (settings.ao && !R.aoShed) R.aoShed = true; else if (R.dynScale > 0.55) R.dynScale = Math.max(0.55, R.dynScale - 0.1); else return; R.applyQuality(); }
  else if (fps > 58) { if (++perf.good >= 4 && R.dynScale < 1) { perf.good = 0; R.dynScale = Math.min(1, R.dynScale + 0.1); R.applyQuality(); } }
  else perf.good = 0;
}
// debug: run the simulation for a while at a fixed step without drawing (headless tests)
function sim(seconds, step = 1 / 30) { const n = Math.round(seconds / step); for (let i = 0; i < n; i++) tick(step); }

boot();
