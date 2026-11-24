# Iron Sector

An original first-person survival shooter that runs in any modern browser. Hold a war-torn district, the Old Quarter, against waves of hostile soldiers. Earn cash for every kill and spend it at three armories on new weapons, attachments, armor, perks and air support.

Everything is made by the game's own code: the city, the textures, the soldiers, the weapons and every sound. There are no downloaded art or audio files. The only third-party pieces are Three.js (MIT licence) and two typefaces (SIL Open Font Licence), and both are bundled in `vendor/`, so the game runs offline.

## Playing

- **Online:** the GitHub Pages site links to it from the Night Arcade home page.
- **Locally:** the game uses JavaScript modules, so it has to be served over HTTP rather than opened as a file. From the repository root, run `python3 -m http.server 8000` and open http://localhost:8000/iron-sector/.

### Controls

| Action | Keyboard and mouse | Controller |
| --- | --- | --- |
| Move / look | WASD / mouse | Left stick / right stick |
| Fire / aim down sights | Left click / right click | RT / LT |
| Sprint | Shift (hold breath while scoped) | Click left stick |
| Jump, vault | Space | A |
| Crouch / prone | C / Z | B (hold for prone) |
| Reload | R | X |
| Use armory, swap weapon | F | Hold X |
| Switch weapon | 1, 2, mouse wheel | Y |
| Frag (hold to cook) / flashbang | G / Q | RB / LB |
| Knife | V | Click right stick |
| Call in air support | 4 | D-pad up |
| Fire mode | B | D-pad left |
| Pause | Esc | Start |

On phones and tablets, the left thumb moves (push far forward to sprint) and the right thumb looks. You can keep dragging on the Fire button to steer while shooting. The other actions have their own on-screen buttons.

## What's in it

- **Weapons:** AR-7 Vanguard, SMG-9 Wasp, M88 Breacher (pump shotgun), LMG-60 Mauler, SR-50 Longbow (bolt-action, 7.5× scope, hold breath), DMR-14 Ranger (4× scope), P9 Sidearm and LR-1 Torch (rocket launcher).
- **Weapon handling:** spring-driven recoil and sway, aiming down sights through working red-dot and holographic reticles, scope overlays, and full reload animations with magazine swaps, bolt pulls, pump actions and shell-by-shell loading. Shell casings eject, and hands follow the gun with two-bone inverse kinematics.
- **Attachments:** red dot, holographic sight, 4× scope, suppressor (keeps you off the enemy minimap), extended magazines and a foregrip.
- **Ballistics:** headshots, damage falloff, and bullets that punch through wood, plaster and thin metal but not concrete. Glass shatters. Red barrels catch fire, then explode in chain reactions.
- **Enemies:**
  - Riflemen pick cover that faces you, peek and shoot, and throw grenades when you camp.
  - Rushers sprint in with SMGs and shotguns.
  - Rooftop marksmen give themselves away with a laser and a scope glint.
  - Armored juggernauts carry machine guns.
  - Every enemy navigates with A* path-finding and falls as a physics ragdoll.
- **Survival loop:** escalating waves, intermissions, a cash economy, three armory stations, perks, and four difficulty levels.
- **Air support:** recon drone (radar), precision airstrike, attack helicopter and sentry gun. You earn them with 3-, 5- and 8-kill streaks or buy them at the armory.
- **Presentation:**
  - Rendering: physically based materials, a sky and sun with soft shadows, ambient occlusion, bloom, SMAA, colour grading, and damage and flashbang effects.
  - Audio: positional 3D sound with reverb and distance filtering.
  - HUD: minimap, killfeed, hit markers, and damage and grenade indicators.
  - Progression: rank XP that persists between sessions.
- **Settings:**
  - Graphics: quality presets (low to ultra), adaptive quality that sheds detail when the frame rate drops, and field of view.
  - Controls: separate mouse, aim and controller sensitivity, invert look, and controller aim assist.
  - Audio: volume mixer.

## Code layout

| File | Purpose |
| --- | --- |
| `js/main.js` | Boot, loading, screens, pointer lock, frame loop, adaptive quality |
| `js/core.js` | Shared state, maths helpers, settings, keyboard/mouse, controller and touch input |
| `js/render.js` | Renderer, sky and lighting, post-processing chain |
| `js/textures.js` | Procedural PBR textures (albedo, normal and roughness maps) |
| `js/world.js` | Collision, ray casts, static geometry batching, navigation grid with A* and cover points |
| `js/map.js` | The Old Quarter map |
| `js/fx.js` | Particles, decals, tracers, shell casings, muzzle lights |
| `js/audio.js` | Synthesised sound effects, reverb, 3D positioning |
| `js/weapons.js` | Weapon data, first-person models, arms, animation and firing |
| `js/player.js` | Movement, stances, vaulting, health and armor, camera, aim assist |
| `js/soldiers.js` | Instanced soldier bodies, procedural animation, ragdolls, enemy AI |
| `js/systems.js` | Bullets and explosions, grenades, barrels and glass, pickups, air support, armory, waves |
| `js/ui.js` | HUD, minimap, menus, settings, rank display |

Add `#debug` to the address to expose `window.__G` (game state plus `__G.main.sim(seconds)` for fixed-step headless testing).

## Taking it to Steam

The game is already self-contained and works offline, which is the main requirement. The remaining steps:

1. **Wrap it as a desktop app** with Electron, Tauri or NW.js. Serve the folder through the wrapper's custom protocol or a tiny local server rather than `file://`, because browsers block JavaScript modules loaded from files.
2. **Add Steam features** (achievements, cloud saves) with a Steamworks binding such as `steamworks.js`. Progress currently lives in `localStorage` under `iron.profile` and `iron.settings`.
3. **Sign up for Steamworks** (one Steam Direct fee per game) and prepare the store page: capsule art, screenshots, a trailer and a description.
4. **Test on your target hardware.** Steam Deck is a good fit because the game already supports controllers.
