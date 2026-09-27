# audio: builder notes (wave 1)

## What exists

- **Mixer** (`src/audio/mixer.js`): one shared `AudioContext` for the whole game (there used to be
  six, one per stand-in piece; see "Cross-piece edits"). Two buses: an SFX bus and a music bus
  (lowpass filter for muffling + a duck gain for telegraph clarity), both through one shared
  `DynamicsCompressor`, an `AnalyserNode` (for the showcase meter/scope), and a
  `MediaStreamAudioDestinationNode` tapped in parallel for a critic's `MediaRecorder`. Exposes the
  generic synth helpers (`tone`, `noise`, `env`, `makeNoiseBuffer`) every SFX module in the game
  now shares, `vary(key, opts)` (a seeded, "never twice in a row" pitch/gain jitter, one RNG
  stream per key, forked off the live `?seed`-driven `rng`), and `duckMusic()` / `muffleMusic()`.
- **SFX bank** (`src/audio/bank.js`): this piece's own new SFX — footsteps (voiced by
  `world.room.kind`: arena stone, gauntlet rubble, boss floor with a metallic tail, since there is
  no per-tile surface material anywhere in the codebase yet), the dash whoosh, and a short vocal
  bark per enemy kind on spawn (layered on top of, not instead of, the enemies stand-in's
  mechanical "pop").
- **Music engine** (`src/audio/music.js`): four tracks (`title`, `field`, `chase`, `boss`), each a
  handful of 16-step patterns ("layers") gated by a continuous 0..1 intensity so the arrangement
  thickens/thins instead of hard-switching. A standard lookahead scheduler (`setInterval` polling
  `ctx.currentTime`, ~120 ms ahead) drives it, independent of the render loop. Reactive wiring:
  `field`'s intensity follows arena state (`arena:enter/seal/wave/clear/exit`) plus a decaying
  "combat heat" bumped by `combat:hit`/`enemy:die`; `chase` follows `chase.level` from
  `world/collapse.js` every tick (the same 0..1 the collapse's own shake/visuals use);  `boss`
  switches layers on `boss:phase` and goes quiet-then-slams-back-in on `boss:nameCard`
  (`music.sting()`). Low health: `hud:heartbeat` (already gated to low hp by `hud`) muffles the
  music and adds a synced sub-bass thump, clearing ~1.4s after the last beat. Telegraph clarity:
  `enemy:windup`/`boss:windup`/big hits duck the music briefly so the stand-in's own cue reads.
  Pause: muffled, not silenced.
- **Showcase** (`src/audio/showcase.js`, `?showcase=audio`): a scrollable board of essentially
  every SFX in the game (combat, enemies, boss, pickups/boons, doors/arena, gauntlet, and this
  piece's own footsteps/dash/barks — about 140 entries), a music panel (pick a track, dial its
  intensity, stop/sting/duck/muffle demo keys), and a live meter + oscilloscope reading the
  master bus.
- **Every piece's existing stand-in SFX still plays its own sound design** (combat, enemies, boss,
  boons, and — not mentioned in the brief but built the same way — arenas' doors/props and
  gauntlet's traps/collapse rumble). None of that was replaced; each just synthesizes into this
  piece's shared mixer now instead of opening its own `AudioContext`. See "Cross-piece edits".

## APIs other pieces should call

```js
import { music } from '/src/audio/music.js';
music.play('title' | 'field' | 'chase' | 'boss', { intensity?: 0..1 });  // starts, or crossfades
                                                                          // at the next bar
music.setIntensity(0..1);      // nudge the current track's layering
music.sting(ms = 900);         // go quiet, then slam back in (name-card beats)
music.stop();

import { bank } from '/src/audio/bank.js';   // importing it is enough; it already listens to
bank.footstep(speed); bank.dash(dz); bank.bark(kind);   // hero:step, move:dash, enemy:spawn

import { sfxContext, musicContext, mixer, tone, noise, env, makeNoiseBuffer, vary,
         sfxVol, musicVol, duckMusic, muffleMusic } from '/src/audio/mixer.js';
// sfxContext() -> { ctx, out } | null : for any new stand-in SFX code (mirrors the pattern
// combat/enemies/boss/boons/arenas/gauntlet already use — see their `ac()` functions).
```

Nobody needs to call anything to get music or the existing stand-in SFX working in real play:
importing `src/audio/index.js` once (done in `main.js`) wires all of it to the event bus that
already exists. `run-flow` in particular does not need to touch audio at all — `arena:*`,
`gauntlet:*`, `boss:*` and `scene:enter` already drive the right track and intensity.

## Debug hooks and showcase params

- `window.__GR.debug.audio.state()` — `{ running, sampleRate, muffled, music: { track,
  intensity, target } }`.
- `window.__GR.debug.audio.music(name, intensity)` — force a track (scripted tests).
- `window.__GR.debug.audio.stopMusic()`.
- `window.__GR.debug.audio.stream()` — the `MediaStream` of the finished master mix. A critic's
  script can hand this straight to a `MediaRecorder` (PROTOCOL.md's "Blind comparison rules:
  Audio") without hunting for the node itself.
- `?showcase=audio&sel=<n>` start on entry n, `&hud=0` hide the legend/panel labels (clean
  stills), `&auto=1` auto-advance through the board (used for the 90s unattended traversal below).
  Keys are listed in the showcase's own header comment and drawn in its legend panel.

## Cross-piece edits

- `src/combat/sfx.js`, `src/enemies/sfx.js`, `src/boss/sfx.js`, `src/progression/sfx.js`,
  `src/world/arena.js`, `src/world/corridor.js` — each of these already had its own tiny stand-in
  `ac()` function that lazily opened its own `AudioContext` (with its own compressor, straight to
  `ctx.destination`) after the first user gesture. Each `ac()` body now calls this piece's
  `sfxContext()` instead and keeps its own noise-buffer seed, so the sound design in every one of
  those files is untouched — swings, hits, windups, boon jingles, doors, traps, the collapse
  rumble all still sound exactly as before. The only change is that the whole game now shares one
  `AudioContext`, one compressor and one set of volume/ducking behaviour instead of up to six
  independent ones. `arena.js`/`corridor.js` were not named in this piece's brief (only
  combat/enemies/boss/boons were), but they carry the identical stand-in pattern (down to the
  `enabled` flag), so they were routed through the mixer the same way; their sound design was
  left alone otherwise.
- `src/main.js` — added `import './audio/index.js';` (a side-effect import, next to the other
  piece imports at the top) so the mixer/bank/music engine are live in every scene, not just the
  showcase.
- `src/core/showcase.js` — the `audio` row's `load: null` now points at `../audio/showcase.js`
  (the one-line convention the file's own header documents).

## Known gaps

- **No per-tile floor material.** Footsteps are voiced by `world.room.kind` (arena/corridor/boss)
  because nothing else tracks a finer-grained surface; a wooden bridge tile in a corridor, for
  instance, still sounds like rubble.
- **Enemy barks are spawn-only.** There is no idle growl or aggro bark while an enemy is alive —
  only the one at spawn, layered over the existing mechanical "pop".
- **The collapse rumble and all of arenas'/gauntlet's own SFX are exactly as they were before
  this piece** (routed through the shared mixer, not redesigned). If a critic finds those thin or
  muddy, that is pre-existing sound design from `arenas`/`gauntlet`, not new work here.
- **Music reacts to game *events*, not full simulation.** `field`'s intensity is a decaying "heat"
  from `combat:hit`/`enemy:die` plus the arena's own wave/clear signals, not a read of exact
  enemy count or hero HP fraction; it tracks the shape of a fight well but is a heuristic.
- **No separate "explore" cue.** The `field` track is one continuous piece whose intensity runs
  from ~0.12 walking around to ~0.9+ mid-fight, rather than a distinct calm cue between arenas.
  This was a deliberate simplification (one coherent arrangement per zone-context beats a hard
  cut), but a critic used to a quieter "downtime" theme may notice its absence.
- **Only tested under headless Chromium and by ear via the showcase**, not on a real device
  speaker or with a human listening to a full run. The showcase's 90-second `&auto=1` traversal
  (all ~140 entries plus the four music tracks) produced zero console errors, and the interactive
  music/duck/muffle/pause/low-health paths were each exercised once via `debug.hurt()` /
  `debug.scene()` / key scripts, but nobody has sat and listened to a full 8-12 minute run.
- **No spatialisation.** Everything is 2D/non-positional except gauntlet's existing
  distance-based volume falloff (`near()` in `corridor.js`, untouched). A sound on the far side of
  a wide arena is exactly as loud as one at the hero's feet.
- **Gamepad rumble/haptics**: not implemented (no controller output is used anywhere in the game;
  this would be new scope, not a gap in what exists).
