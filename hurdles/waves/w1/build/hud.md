# hud: builder notes (wave 1)

## What exists

All in `src/ui/`. 640x360 internal, integer pixels, palette colours only, the foundation 5x7 pixel font. Animations run on sim ticks: they hold through hitstop and step with `debug.step`. Hp changes are also picked up in the draw pass, so a hit shows on the same frame even during hitstop.

- **Hearts** (`widgets/hearts.js`, top left): one 11x10 outlined heart per hp.
  - **Lose:** white flash and a 1px hop, then the red drains top-down with a bright surface line. Then the heart cracks: 7 pixel shards burst and fall, and a cracked empty container is left. The row shakes. A multi-hp loss is staggered 5 ticks per heart. The panel rim flashes red.
  - **Gain:** refills bottom-up in gold, cooling to red, with a 1px pop and a 4-point sparkle. The rim flashes gold.
  - **Max hp up:** new empty containers blink in.
  - **Low** (hp 1, or at most 25% of max): the last heart beats lub-dub (a bigger sprite) at about 69 bpm.
- **Dash pip** (`widgets/dash.js`): a chevron and a capsule.
  - White during the dash's i-frames.
  - Empties, then refills navy/blue over the cooldown.
  - A white flash, hop and glint sweep when it is ready again, plus an idle glint.
- **Shard counter** (`widgets/shards.js`, top right): a crystal and an odometer.
  - The shown value chases `progress.shards` one step at a time, faster when far behind.
  - The changed digits roll over 2 ticks, and the crystal flashes.
  - A `+n` tally hangs under the panel.
  - A decrease rolls down, in rose.
- **Room track** (`widgets/track.js`, top centre): 5 arena squares, 4 corridor diamonds, and a skull.
  - Passed nodes are slate with a tick. The current one pulses: gold for an arena, ember and shaking for a corridor, a red-eyed skull for the boss.
  - A hooded runner marker hops from the last room it stood on. The last room is kept across scenes, at module level.
  - In an arena, wave pips sit under the node: cleared waves gold, the live one blinking.
- **Boon row and tooltips** (`widgets/boons.js`, bottom left). This replaces the boons piece's stand-in bar in normal play, and it uses that piece's icons, rarity table and runtime.
  - Rarity frames and stack pips.
  - New slots drop in, and a new level flashes the slot and its pip.
  - On a proc, the icon flashes white and hops. A spent phoenix or a down ward greys out, and the ward shows a regrow bar.
  - Synergy members get a gold gem. Leech motes and the starfall count show as pips.
  - **Tooltip:** a framed card with the icon, name, rarity, `LV n/max`, the boon's own card text at its current stack, and its synergy or partner. It opens for each new boon (about 3 s), on Tab (cycles through held boons, about 5 s) and on mouse hover.
  - The SYNERGY banner (centre) is ported from the boons stand-in.
- **Boss bar** (`widgets/bossbar.js`, bottom centre): works for any boss through a source object.
  - A name plate and a phase plate, an iron frame with end studs, and a red fill with a slow dithered sheen.
  - **On a hit:** the slice flashes white, holds as a torch-coloured chunk for 24 ticks, then drains. A big hit shakes the frame by 1px.
  - **Phase notches:** gold pins that snap off in sparks when crossed, and the plates flash.
  - **Poise:** a bar that goes flame, then gold. A stagger pulses with STAGGERED; while poise is locked the bar is grey.
  - It slides up with `show`.
- **Damage numbers** (`damage-numbers.js`): these are the real ones. Combat's stand-ins are switched off where this runs; see "Cross-piece edits".
  - Pop white and one size bigger for 2 ticks, hop up and sideways, hang, then blink out (no alpha).
  - Crits are gold at scale 2, with a 4-point star and a jitter. Hero damage is a red `-n` at scale 2. Procs are small and frost-coloured. DODGE is sky.
  - Numbers that land on the same spot push older ones up, so they do not overlap.
  - They are anchored to their world point.
- **Low-health vignette** (`widgets/vignette.js`): an ordered-dither band of blood that closes in from the edges.
  - The band is a superellipse, so the corners are heavier than the middle of each edge.
  - At rest it is about 4 px; it swells to about 14 px on each lub, smaller on the dub, and stronger for the first second at low hp.
  - The beat is scaled by the `flashes` setting. Masks are cached per level.
- **Heartbeat sound** (`widgets/sfx.js`): a quiet lowpassed sine thump, lub and dub. `hudSfx.enabled`.
- **Composer** (`hud.js`):
  - Panels are drawn to a layer. When the hero or an enemy is under a panel (tooltip included), that panel dithers away up to 10/16 so the action shows through.
  - Panels slide in when a scene starts.
  - Tab is `preventDefault`ed so the browser keeps focus.
- **Wired into normal play:** the `run` placeholder scene, the `gauntlet` scene and the `boss` scene.

## APIs

```js
import { createHud, wardenSource, activeHud } from './ui/hud.js';
const hud = createHud({ health, runtime: prog.runtime, boss: wardenSource(fight) /* or () => src|null */,
                        numbers: true, track: true, intro: true, shards: true, boons: true, waves: null /* () => {wave,total,done} */ });
// ui (after world-space UI such as cfx.ui/arena.ui, BEFORE prog.ui so the choice screen covers it): hud.ui(g)
// exit: hud.dispose()    // it ticks itself on the 'tick' event; scenes don't call tick()
hud.setBoss(fn|null); hud.hidden = true|false; hud.info(); hud.boons.inspect(i?)
// boss source: { name, hp, maxHp, phase, phaseName, phaseColor, notches: [2/3, 1/3], poise 0..1,
//                stagger 0..1|null (time left), locked 0..1|null, show 0..1 }
import { createDamageNumbers } from './ui/damage-numbers.js';   // standalone, if a scene wants numbers only
import { hudSfx } from './ui/widgets/sfx.js';                   // hudSfx.enabled = false when `audio` takes over
```

- **For `run-flow`:**
  - Create one HUD per scene, as the three scenes do now.
  - Pass `hud: false` to `createProgression` and `numbers: false` to `createCombatFx` / `createBossFight`.
  - The room track reads `world.room` (`{kind: 'arena'|'corridor'|'boss', index}`), and arena wave pips come from `getActiveArena().waves`.
- The HUD emits no events. It listens to `tick`, `combat:damage`, `combat:dodge` and `boon:gain`, and reads `progress` and the boons runtime.

## Debug hooks and showcase params

- **`__GR.debug.hud(action?)`:**
  - no action: info `{hp, maxHp, low, vignette, shards, node, boons, tip, boss, numbers (live texts), faded}`;
  - `'hide'` / `'show'`;
  - `'inspect', i?`.
- **`?showcase=hud`** (`src/ui/showcase-hud.js`): the Antechamber at zoom 1. The room holds:
  - three puppet husks, which attack only on the demo's cue and respawn;
  - an iron training dummy standing in for a boss. Hits on it drain a showcase-only boss pool, "IRON DUMMY" (420 hp, three phases, poise and stagger), so the boss bar can be judged outside the pit.
- **DEMO** (a 1860-tick loop, labelled under the hearts panel):
  1. fight;
  2. boon plus tooltip;
  3. husk hit;
  4. boon;
  5. husk hit;
  6. third boon plus THUNDERHEAD synergy;
  7. a scripted 2-hp hit;
  8. next room on the track;
  9. the boss pool;
  10. ONE HEART LEFT (heartbeat and vignette);
  11. heart pickups;
  12. shards and vacuum;
  13. Tab inspect.

  Husk kills also drop real shards and hearts, so hp can recover between beats.
- **Params:**
  - `&auto=0`, `&hud=0` (no showcase labels);
  - `&hp=1..5`, `&boons=a,b`, `&shards=n`;
  - `&node=0..9` (track position; the default is 2, arena 2);
  - `&boss=0`, `&slow=s`, `&zoom=1..3`, `&at=<script tick>`.
- **Keys:**
  - 1 hit, 2 heal, 3 shards (a real drop, then a vacuum), 4 add a boon, 5 down to one heart;
  - 6 next room, 7 boss bar on/off, 8 a 40-damage crit on the boss pool;
  - Tab tooltips, B demo/live, R reset, T slow, Z zoom, H labels, P/Esc pause;
  - WASD, J and K when LIVE.
- **Damage-taken strip:** load `?showcase=hud&auto=0&hud=0`, wait about 1.5 s, run `debug.freeze(true)` and `debug.hurt(1)`, then repeat `debug.step(2)` and a shot (wait about 150 ms per step). The heart is white for ticks 0-2, drains over 3-14, and shatters at 15. Crop the top left, `0 0 170 70` at 2x screen coordinates.
- **Heartbeat:** the same setup with `debug.hurt(4)`, then step 3 at a time. A lub every 52 ticks; `debug.hud().vignette` goes from about 0.07 at rest to about 0.3 at a beat.

## Cross-piece edits

- `src/core/placeholders.js` (foundation), the run/boss placeholder scene:
  - imports and creates `createHud`;
  - `createCombatFx(root, { numbers: false })` and `createProgression(..., hud: false)`;
  - `hud.ui(g)` before `prog.ui(g)`, and `hud.dispose()` on exit;
  - removed the `HP x/y` text and the top-right `RUN (PLACEHOLDER)` label, which sat under the shard counter;
  - moved the placeholder help line to the bottom right, clear of the boon row.
- `src/world/corridor.js` (gauntlet), the `gauntlet` scene: the same wiring (one import, create, ui, dispose, `hud: false`), and removed its `HP x/y` text.
- `src/boss/scene.js` (boss): `createBossFight(..., numbers: false)`, `fight.externalHud = true`, `createProgression(..., hud: false)`, `createHud({ ..., boss: wardenSource(fight) })`. The ui order is `hud.ui`, `fight.ui`, `prog.ui`, so the name, phase and win cards draw over the HUD.
- `src/boss/fight.js` (boss): `api.externalHud` (default false) skips `drawHeroHp` and `drawBossBar`; `get bar()` exposes the bar state (its `show` drives the slide-up after the intro). `?showcase=boss` is unchanged and still draws its own bar.
- `src/core/showcase.js` (foundation): `load` on the `hud` row.
- **Switch-over:** `src/combat/fx.js` stand-in numbers and `src/progression/hud.js` are still used by the combat, boons and boss showcases, which I did not touch. In normal play (run, gauntlet, boss) only this piece's numbers and HUD draw. Heals already float `+1` from the boons pickups, so this piece draws no heal numbers.

## Known gaps

- **Hearts are small:** 11x10 px (22 CSS px at 2x). There are no half hearts, because hp is an integer. With more than about 10 max hp the row would run into the track; nothing wraps it.
- **The boon row wraps at 8 per row upward,** and the tooltip is about 176x80 px. With all 16 boons the row is two rows tall and the tooltip sits higher over the arena. The tooltip dithers aside when the hero is under it, but it still covers floor for about 3 s per new boon.
- **The boss bar only shows its show/slide with the Warden through `fight.bar`.** There is no boss portrait or icon. The trail chunk is very bright (`torch`). Notch sparks only fire on a hp drop seen by the HUD; a phase entered by `phase` start param shows those pins already gone with no animation.
- **The panel step-aside uses rough screen boxes** for the hero and enemies. The Warden's box is large, so the top track often dithers away during the boss fight, and in the intro it is mostly hidden.
- **The showcase:**
  - Its DEMO is partly scripted (labelled), and the pilot wanders when its target is knocked away.
  - The training dummy gets shoved around by combos, so the "boss" sometimes ends up out of frame.
  - Arena wave pips are faked there (2 of 3); real ones show in `?scene=run`.
- **The heartbeat sound** was checked for errors only, not listened to. It plays only after a user gesture.
- **Not tested on gamepad.** Tab inspect has no pad binding, and there is no menu to reread boons except Tab or hover.
- **The UI canvas is not quantised;** this piece uses no alpha, but pause dimming (foundation) dims it with alpha.
- **Damage numbers are anchored to world points,** not to the target, so a knocked-back enemy leaves its number behind (by design, but it reads as a trail with big knockback). Very dense proc bursts (chain plus burn) still stack tall.
- **Shard odometer:** fast bursts step every 2 ticks, so mid-burst frames often catch a rolling digit.
