# gauntlet: builder notes (wave 1)

## What exists

- **Corridors** (`src/world/corridor.js`). A corridor runs left to right across the screen. It is 6 tiles deep (z), and a back wall faces the camera. The front edge is a low broken parapet over a cliff face that drops into the dark.
  - **Intro**: the hero drops in (the hero's spawn animation) beside the caved-in arch they came from, with a rubble dead end behind them. The traps are already cycling. After 75 ticks the ceiling gives way: the arch bursts, a RUN! banner shows, and the chase begins.
  - **The run**: 3 to 5 **beats** with 3-unit rests between them, then the gate.
  - **The end gate**: an iron-bound stone slab drops from above the view across the corridor as the hero passes, then slams. You get hitstop, a big shake, dust and sparks, and the slab's rune lights gold. The collapse throws itself at the slab with a last boom, shake, ember shockwave and a burst of rock, then stills. The rumble fades out, the ember light dies, and a gold light and a low chord come up. Then "SAFE" and "THE GAUNTLET HOLDS. THE STAIR GOES DOWN." show. Walking into the stair arch in the small safe room fires `gauntlet:exit`.
- **Beats** (`BEATS`) are hand-authored trap rhythms:
  - `spikeWave`: three full-width plates that fire in sequence;
  - `spikeWeave`: half-width plates out of step, so you weave between lanes;
  - `blades`: two pendulums out of phase;
  - `jetRipple`: three fire jets firing in a ripple;
  - `jetFlank`: short jets you can pass along the front edge, plus one long jet;
  - `crumble`: a bridge with a 1-tile gap you must dash;
  - `gapSpikes`: a 2-tile gap, then a plate straight after the landing;
  - `bladeJet`: a blade in front of a jet.
- **Tiers**: corridors 1-4 draw 3/4/4/5 beats from growing pools. The later tiers use shorter periods (x0.94, x0.9) and a faster collapse (v0 3.4 / 3.6 / 3.75 / 3.9 u/s; the hero runs at 4.2). Per seed you get the beat order and a small per-beat timing shift. The first beat is never a gap.
- **Traps** (`src/world/traps.js`). Each periodic trap is a pure function of the corridor clock, so the pilot and the overlay can ask where it will be at any future tick.
  - **Spike plate**:
    - The floor under it is an iron-framed plate with visible holes.
    - Warning (32 ticks): the tips peek out and rattle, with a rattle sound, grit from the holes and the telegraph fill.
    - Up (44 ticks): the spikes shoot up with an overshoot, a shink sound, grit and a small shake.
    - Then a 6-tick drop. It hurts while the pins stand above about half height.
  - **Blade**:
    - A crescent axe on a rod, hung from an iron arm out of the back wall. It swings across the corridor's depth.
    - Its floor shows scrape gouges at all times.
    - A shadow bar follows the head: red while the head is low enough to cut, plum otherwise.
    - It whooshes, with a streak, at the bottom of each swing.
  - **Fire jet**:
    - A bone skull nozzle in the wall, with a soot stain above it and a scorch fan on the floor. The fan shows its reach, full or short.
    - Warning (38 ticks): the eyes and mouth glow, it hisses, drips embers, then sputters flame. The telegraph lane fills from the wall.
    - Fire (56 ticks): a 4-tick extension to full reach, a column of voxel fire, a real light, a roar and a small shake.
  - **Crumbling floor**:
    - Cracked slabs sit over a pit. They look different from sound floor from the start.
    - Standing on a column (not while dashing) makes it crack. It shakes, with dust and a red outline filling, then drops 26 ticks later, and the tiles tumble into the pit.
    - Broken columns are open pits from the start.
    - Falling in: the hero sinks behind the pit walls. They come back on the last safe floor behind the pit, never on a crumbling tile, and at least 1.4 units ahead of the collapse. They lose 1 hp.
    - A dash crosses pits (the dash covers 2.5 units).
  - **Telegraphs** use the enemies' floor language (`enemies/telegraph.js`): a red outline, a growing blood checker fill, a gold blinking outline over the last quarter, and a gold/red flash on the firing frame.
  - **Hurts** go through `HeroHealth.hurt`, so dash i-frames dodge traps (you get the dodge sparkle) and the post-hurt i-frames apply.
- **The collapse** (`src/world/collapse.js`):
  - **Rock**: voxel boulders in 4 size classes (3, 5, 7 voxels, and 12x4x10 ceiling slabs), each with cold and hot (emissive ember) variants. They are drawn in instanced meshes on the shared voxel material, so they get AO, outlines and shadows. They are never scaled and turn only in quarter turns.
  - **How the rock moves**: it falls from above the view onto a pile that grows behind the front, and some spills and rolls ahead of it. Rock past the front edge drops into the abyss. Every 45-95 ticks a whole ceiling slab lands, with a ring, dust and a shake near the view. Hot rocks cool to plain stone.
  - **Around it**: grit streaks, big dust billows rolling ahead, embers, two ember/flame lights that pulse, the `collapse` ambient preset following it, and a synthesised rumble loop with a 5.5 Hz wobble.
  - **Scaling**: shake (every 5 ticks), rumble volume, light and rock density all scale with `intensity()`, which combines closeness and dawdle.
  - **The killing edge** is drawn on the floor as a ragged red/blood crack line just ahead of the rock.
  - **The camera** keeps that edge in frame whenever it is within about 6 units of the view. When it is off screen to the left, dithered ember bands creep in from the left edge with a `< N` distance.
  - **Pacing** (`COLLAPSE`):
    - it runs at the tier's v0 while the gap is at most 5;
    - it eases linearly to 3.2 u/s at a gap of 14 or more;
    - 50 ticks with no forward progress starts filling `dawdle`, which adds up to +2.4 u/s; moving forward drains it.
  - **Contact**: it kills (`gauntlet:caught`, a full-hp forced hurt). In god mode (the showcase DEMO) the hero is instead hurt and thrown 2.5 units ahead, and it is counted in `stats.caught`.
- **Normal play**:
  - The new `gauntlet` scene (defined in `corridor.js`) plays corridor `index` and, on the stair, goes to `run {room}`.
  - The run placeholder now goes arena -> gauntlet -> arena (see cross-piece edits), and a death goes to gameover.
  - The corridor uses the `crypt` mood (cool) with the collapse's own ember light.
  - Sconces every 6.5 units and timber props along the wall; the wall is masonry below and rough rock above.
- **`?showcase=gauntlet`** (`src/world/showcase-gauntlet.js`): one corridor played start to finish by a DEMO pilot, then again. Any key takes over.
  - **The pilot** gives only keyboard-style input (8-way moves and dash presses).
    - Each plan is "wait w ticks (moving only across lanes), then run right with an optional dash at an x".
    - Plans are simulated tick by tick against the traps' pure timing, the pits and the collapse's predicted edge, and the cheapest safe one wins. It re-plans every 3 ticks.
    - At the start of each beat it pauses 30-50 ticks to "READ" (skipped if the collapse is within 3.2), like a first-time player. Without that pause it outran the collapse and the demo had no tension.
    - If no plan is safe it shows `PUSH ON` and takes the plan that survives longest.
  - **Test results** (`state().showcase.results`): 12 corridors (seeds 1-3, corridors 1-4) all ended at the exit, with 0 falls and 0 catches. Corridors 1-3 had 0 hurts. With the READ pause, seed 1 corridor 4 took 2 hurts; its closest gap was 1.67 units, and seed 1 corridor 2's was 3.07.

## APIs

```js
import { generateCorridor, Corridor, createCorridorRun, buildCorridorModels, setActiveCorridor, getActiveCorridor,
         CORRIDOR_COUNT, CORRIDOR_D, BEATS } from '../world/corridor.js';
const L = generateCorridor(index /*0..3*/, seed, { beats?: ['blades', ...] });   // pure
const cor = new Corridor(root, L, { hero: () => ctl, health: () => heroHealth, anim: () => heroAnim, banners = true, autoStart = true });
setCollision(cor.collision);
// tick (after combat.tick()):  cor.tickCamera(cam, ctl); cor.tick();     render: cor.render(alpha)   ui: cor.ui(g)   exit: cor.dispose()
cor.state   // 'intro' | 'run' | 'safe' | 'exited' | 'caught'
cor.begin(); cor.slamGate(); cor.info(); cor.stats {hurts, falls, caught, dodges, time}; cor.minGap
cor.hazard(x, z, r, t) -> {trap, source, cause} | null;  cor.pitAt(x, z, t);  cor.crumbly(x);  cor.trapsIn(x0, x1)
// whole bundle (hero rig, controller, health, combat, camera, corridor), what the scene and showcase use:
const run = createCorridorRun(root, { index, seed, layout?, source? = input, hp = 5, autoStart, banners });
run.tick(); run.render(alpha); run.ui(g); run.dispose();   // run.cor, run.ctl, run.anim, run.health, run.cam
scenes.go('gauntlet', { index, room /* the arena to load after */, seed? })

import { createTrap, gauntletSfx, near, SPIKE, JET, CRUMBLE, BLADE, pinAt } from '../world/traps.js';
trap.hits(x, z, r, t); trap.phase(t) /* 'rest'|'warn'|'hot'|'cool' */; trap.timing() -> {period, offset, segs}; trap.untilHot(t)
gauntletSfx.enabled = false   // `audio` can take over; listen to the events below

import { Collapse, COLLAPSE } from '../world/collapse.js';   // COLLAPSE tunables are live
```

- `world.room` = `{index, kind: 'corridor', id, name, seed, state, beats, collapse: {...}, cleared}`.
- Events:
  - `gauntlet:enter {corridor}`
  - `gauntlet:start`
  - `gauntlet:hurt {cause: 'spikes'|'blade'|'fire', x, z}`
  - `gauntlet:fall {x, z}`
  - `gauntlet:crumble {x}`
  - `gauntlet:caught {x, z}`
  - `gauntlet:safe`
  - `gauntlet:exit`
- `run-flow` should replace the placeholder's use of the `gauntlet` scene with its own sequencing; `createCorridorRun` is the easy way in. `hud` can pass `banners: false` and draw its own RUN!/SAFE.

## Debug hooks and showcase params

- `__GR.debug.corridor(action?, ...)`:
  - no action: the active corridor's info;
  - `'plan', seed?`: the 4 corridors' beats, lengths and speeds;
  - `'go', index, room?`: play a corridor in the `gauntlet` scene, from anywhere;
  - `'start'`: start the collapse now;
  - `'safe'`: teleport the hero past the gate and slam it;
  - `'collapse', {v0}`: tune the speed.
- `__GR.debug.gauntletPilot()`: the pilot's current plan and every lane x dash option at wait 0 (showcase only).
- `debug.goto(i)`:
  - in the showcase it loads corridor i+1;
  - in the `gauntlet` scene it goes to arena i.
- `state().corridor` in the `gauntlet` scene.
- `state().showcase` = `{id, mode, corridor: info, overlay, zoom, runs, results: [{corridor, beats, end, mode, time, hurts, falls, caught, dodges, minGap}], hero, pilot}`.
- `?showcase=gauntlet` params:
  - `&seed=N`;
  - `&corridor=1..4` (default 2);
  - `&beats=a,b,c`;
  - `&auto=0` (LIVE; the hero can die);
  - `&overlay=1`;
  - `&hold=1`: the collapse waits for `debug.corridor('start')`;
  - `&zoom=1..3` (default 1);
  - `&slow=<s>`;
  - `&hud=0`.
- Keys:
  - T: the timing overlay. It shows:
    - a bar over every trap: its cycle in rest/warning/hot/cool colours, a white playhead, the period, and HOT or "IN x.xS";
    - "HOLDS / DROPS x.xS" for crumbling floor;
    - the collapse panel: speed, wanted speed, gap, the dawdle meter, and hurts/falls/caught/dodges;
    - a map strip of the whole corridor;
    - the pilot's planned path as cyan dots, with the dash point.
  - B demo, R restart, N next corridor, Z zoom, L slow-mo, H hud, P/Esc pause.
  - (T is the overlay here, so slow-mo is on L, not T as in the other showcases.)
- **Strip recipes**:
  - **Normal play**: load `?showcase=gauntlet` (optionally `&overlay=1`), wait about 1.5 s, run `debug.freeze(true)`, then `debug.step(N)` in 20-40 tick steps with a shot after each (allow about 1-2 s of wall time per step call). The collapse starts about 75 ticks after load, and a corridor takes about 700-1000 ticks. The gate slam is at `state().showcase.corridor.state === 'safe'`, and the collapse hits the slab about 40-90 ticks later.
  - **The collapse up close**: `?showcase=gauntlet&auto=0`, then `debug.god(true)` and `debug.move('teleport', 9, 0)`, then step about 150.
  - **A fall**: `?showcase=gauntlet&auto=0`, then freeze, then `debug.move('teleport', 27.5, 0)` and `debug.input('right', true)`, then step 70 and release. On seed 1 corridor 2 the pit is at x = 33.
  - **Normal play from anywhere**: `?scene=run`, then `debug.corridor('go', 0)`.

## Cross-piece edits

- `src/core/showcase.js` (foundation): set `load` on the `gauntlet` row.
- `src/core/placeholders.js` (foundation):
  - one import of `../world/corridor.js`, which defines the `gauntlet` scene;
  - the run scene's `arena:exit` now goes to `gauntlet {room: index+1, index}` instead of straight to the next arena (the last arena still goes to `boss`).
  - `run-flow` replaces this anyway.

## Known gaps

- **Sound is unverified.** Every sound is a first-pass WebAudio stand-in (rumble loop, rattle, shink, whoosh, hiss, roar, crack, drop, thud, quake, slam, boom, release chord). They were checked for console errors only; nobody has listened to them. The rumble loop ducks via `setTargetAtTime`, and its level has not been tuned against the other pieces' sounds.
- **The demo pilot is near-perfect.** It pauses at each beat to "READ", which is what keeps the collapse close in the demo. A real player will be slower. The collapse speeds are tuned from the pilot's runs, not from human play. The DEMO is god-moded.
- **The collapse is off screen for much of a clean run.** It is only in frame when it is close; otherwise the left-edge ember bands and `< N` stand in. At the start of a corridor and after each READ pause it is in view.
- **Blades read as "rod from the top of the screen".** The arm out of the wall projects as a vertical line at this camera angle. The head is clear, but the mechanism is not.
- **The end gate is a thin shape at this camera.** A slab across the corridor shows only its top and front end, so it reads as a tall band with a gold rune rather than a door. It is clear once the collapse piles against it.
- **Lighting**:
  - The upper rock face above the masonry is dark and mostly unlit.
  - The floor reads as dark flagstones with dark grout dots, and gets busy near the spike plates.
  - Stone-light rocks right next to the ember light quantise to near white, so there are a few pale blocks in the pile.
- **Performance**: 9 fps headless, the same as other showcases. There are up to 1000 rock instances. The pilot re-plans every 3 ticks, about 300 plan simulations, which has not been profiled on real hardware.
- **Content**:
  - There are only 8 beats and one corridor look (no themes).
  - The rest segments between beats are empty floor: no pickups or props.
  - Enemies never appear in corridors.
- **Other rough edges**:
  - Traps behind the collapse stop ticking, but traps behind the gate keep firing during the release beat.
  - Trap hurts are not suppressed during the intro (a hero who walks into a plate before RUN! gets hurt).
  - The `safe` beat relies on the collapse reaching the slab; with a huge lead that takes a second or two at 12 u/s.
- **Showcase files outside `owns`**: none. All four owned files are used, and `corridor.js` also holds the `gauntlet` scene.
