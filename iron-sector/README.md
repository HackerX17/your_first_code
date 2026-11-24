# Iron Sector

An original modern-military first-person shooter that runs in the browser (Three.js r128 from cdnjs, everything else in one file).
Hold a ruined town at dusk against waves of hostile soldiers.

## Controls
**Desktop:** click to capture the mouse. WASD move, Shift sprint, Space jump, C crouch, mouse to look,
left click fire, right click aim down sights, R reload, Q swap weapon, G frag grenade, 4 call artillery, Esc pause.

**Phone:** left thumb moves (push far forward to sprint), right thumb drags to look; on-screen Fire, Aim, Reload,
Jump, Duck, Swap, Frag and Strike buttons. You can keep dragging on the Fire button to steer your aim.

## Features
- AR-7 rifle (full auto, red-dot sight) and P9 sidearm; recoil with recovery, hip vs aimed spread, headshots
- Hostiles patrol, react to gunfire, strafe, and fire in bursts; they show on your radar when they shoot
- Regenerating health with a red damage overlay and direction indicators
- Frag grenades, green ammo crates, wave bonuses
- Kill streaks: 3 = Recon Drone (all hostiles on radar for 30s), 5 = Artillery strike where you aim
- Quality drops automatically (shadows, then resolution) if the device is struggling

Needs an internet connection the first time to load Three.js. Add `#debug` to the address to expose a test hook.
