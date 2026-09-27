# hud: builder notes (wave 1)

## What exists
- **Hearts** (one per hp, 9x8 sprite, framed plate): a lost heart flashes white, shakes and bursts into bits; a pale ghost holds ~0.4 s then drains downward. Heals refill bottom-up with a hop and sparkle, staggered. Max-hp changes pop hearts in.
- **Low health** (hp <= 1 or <= 25%): last heart beats lub-dub with an echo ring and brighter colour; dithered red vignette (pre-baked Bayer layers) pulses with the beat. Scaled by the `flashes` setting; heart shake by `shake`.
- **Dash pip**: pill under the hearts, empties on dash, fills left to right during cooldown, flashes and rings when ready. Reads `ctl.T.dashCooldown` / `ctl.cooldown` (supports `ctl.T.dashCharges`, default 1).
- **Shard counter** (top right): shown value rolls toward the real total, digits pop, +N / -N floater merges, glint on the gem.
- **Boon row** (bottom left): framed cells with rarity edge, level pips, drop-in with burst on gain, pip flash on level-up, gold synergy bars. Tooltip (name, rarity, level, description, synergy text) on mouse hover, Tab to cycle (works keyboard-only), and auto for ~3 s when a boon is gained.
- **Route track** (top center): 10 nodes (arena, corridor, ..., boss), done/current/next states, ember corridor nodes, link fill by progress, label line ("ARENA 2/5  WAVE 2/3", "RUN! THE ROOF IS COMING DOWN" flashing ember).
- **Boss bar** widget (bottom center): iron frame, gold drain trail, white flash on hit, phase notches and tag, fill-in.
- **Damage numbers** (`src/ui/damage-numbers.js`): pop, arc, cool through fog/mist; chip damage <= 4 merges into a tally; crits gold/large with shake; hero damage red `-N`; DODGE. Projected from world coords each frame.
- **Dimming**: any element the hero stands behind eases to 35% alpha.
- `?showcase=hud`: real fight (bot vs enemies + dummies) with a looping 2500-tick script hitting every element.

## APIs
```js
import { createHud } from './ui/hud.js';
const hud = createHud({ hero: () => world.hero, ctl, prog, boons?, shards?, numbers: true, route?, track: true });
hud.tick();  hud.ui(g);  hud.dispose();       // tick per sim tick; ui after world-space UI
hud.visible = false;  hud.info();
hud.track.goto(n) / clear(n) / setProgress(0..1) / label = '...' / alarm = bool / set(route, index)
hud.boss.show('NAME', { phases: 3 }); hud.boss.set(fracHp); hud.boss.hide();
hud.boons.cycle();  hud.numbers.spawn({ x, y, z, text, color, scale, crit });
import { drawBossBar } from './ui/widgets/bossbar.js';   // stateless renderer (boss fight uses it)
```
Events consumed: `combat:damage`, `combat:dodge`, `arena:enter|wave|wavesDone|clear`, `gauntlet:enter|go|escape`, `boss:intro|fightStart`. Node mapping: arena index i -> node 2i, gauntlet index i -> node 2i+1, boss -> last. Events emitted: `hud:heartbeat {strong}` (for audio). Numbers default node route is 5 arenas + 4 corridors + boss; pass `route` to change.
run-flow: create one hud per scene with `createHud({ ctl, prog })`; pass `numbers` default (and create combat fx with `{ numbers: false }`).

## Debug hooks and showcase params
- `__GR.debug.hud(action, arg)`: `state`, `hurt n`, `heal n`, `fullheal`, `low`, `shards n`, `spend`, `boon`, `route` (advance), `route n` -> use action `route` with arg to jump, `boss`, `bosshit f`, `bossat frac`, `bossoff`, `maxup`, `hp n`, `reset`, `zoom n`. `state().showcase.hud` mirrors `hud.info()`.
- Params: `&auto=0 &bot=0 &hp= &max= &shards= &held=id,id &route=0..9 &boss=1 &low=1 &enemies=0 &zoom= &slow= &help=0`.
- Keys: 1 hurt, 2 heal, 3 shards, 4 spend, 5 boon, 6 next room, 7 boss hit, 8 low, 9 max+1, 0 reset, Tab tooltips, B bot, R restart, H hide HUD, Z zoom, T slow-mo.
- For stills of animation: `debug.freeze(true)` then `debug.step(n)` (HUD is tick-driven).

## Cross-piece edits
- `src/core/showcase.js`: `hud` row load wired.
- `src/core/placeholders.js`: run/boss placeholder uses `createHud`, combat fx numbers off, removed the stand-in HP text and `prog.hud` call.
- `src/boss/scene.js`: replaced hero hp pips with `createHud` (track pinned to boss node), combat fx numbers off.
- `src/boss/fight.js`: `drawBar` now calls `drawBossBar` (same state, new look).

## Known gaps
- Uses the engine 5x7 font; no vendored pixel font. Boon icons are 12px at 1x and small at a glance.
- Boon row (bottom left) can reach the boss bar with 10+ boons.
- Track node art is small; arena icon is plain. Arena/gauntlet index base (0 vs 1) is assumed 0-based; run-flow should confirm.
- Room progress in a corridor is not fed by collapse distance (call `hud.track.setProgress`).
- Heartbeat has no sound (event only). Dim uses alpha blending (not palette-pure). Nothing tested with a gamepad or on window sizes other than 1280x720.
- Boss bar in the boss scene is fed by boss state; `hud.boss` is only used in the showcase. No heal/pickup floaters over the hero.
