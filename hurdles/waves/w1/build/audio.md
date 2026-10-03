# audio: builder notes (wave 1)

## What exists

- **One AudioContext, one mixer, one master bus** (`src/audio/engine.js`). Every sound in the game goes through it, including the other pieces' stand-in voices.
  - Buses: `music`, `sfx`, `cue`, `ui` and `amb`.
  - Music path: a lowpass for low health, pause and death, then a 2.2 kHz −3 dB dip that leaves room for cues, then a duck gain, then `musicVolume`.
  - `sfx`, `cue` and `ui` share `sfxVolume`. `amb` has its own duck.
  - A synthetic crypt reverb (a convolver with a generated IR) gets sends from music (0.2), sfx (0.1) and amb (0.35).
  - Master chain: sum, 36 Hz highpass, `masterVolume`, limiter (−4 dB threshold, ratio 20), `masterOut`, destination.
  - Settings volumes use a squared taper and apply live, through `settings.onChange` with 30 ms smoothing.
  - The context is created on the first keydown, pointerdown or touchstart, or when `userActivation` is seen, so there is no autoplay warning.
  - Ducking: one envelope per ducked bus. A new duck never makes an ongoing deeper one shallower.
- **jsfxr-style synth** (`src/audio/synth.js`). Per-layer oscillator: square with duty and duty sweep, saw, sine, triangle, sfxr sample-and-hold noise, or white noise.
  - Pitch: slide and slide acceleration, vibrato with delay, one arpeggio jump, repeat.
  - Envelope: attack, sustain with punch, decay with a curve.
  - Filters: a resonant state-variable lowpass clamped to its stable region, and a one-pole highpass. Both have sweeps.
  - Phaser, bit crush, rate crush, drive.
  - Units are physical: Hz, seconds, octaves per second.
  - Output safety: a minimum 1.5 ms attack per layer, a 20 Hz DC blocker, 1 ms and 6 ms edge fades, and a guard against non-finite samples.
  - Oversampling is 4x for square, saw and triangle, 2x for noise and filtered layers, and 1x otherwise.
- **SFX bank** (`src/audio/bank.js`): 43 sounds, each a layer list, with 4–8 pre-rendered variants that `mutate()` nudges by up to ±8 %.
  - Every play picks a variant other than the last one and adds its own pitch and level jitter. `gap` rate-limits a sound, `max` limits polyphony (the oldest voice fades in 15 ms), and `duck` ducks the music.
  - Sounds are panned by world x relative to the camera.
  - Rendering happens in a module Worker (`synth-worker.js`) after unlock: 195 renders, most frequent first, done in about 2 s headless. If no Worker is available, it renders in idle slices.
  - The groups:
    - HERO: 3 swings, slam, dash, dash-ready, bonk, land, perfect dodge, hurt, death.
    - HITS by weight: light, mid and heavy chosen by combat's `power` (thresholds 0.9 and 1.5), a finisher layer on top, and a kill confirm.
    - STEPS on 7 surfaces: stone, tile, grit, wet, bone, carpet, iron. The R foot plays 6 % lower.
    - ENEMY barks: spawn, hurt and death for husk, wisp, brute and mite.
    - PICKUPS: the shard ladder on D minor pentatonic, in key with the music, and the heart.
    - WORLD: the arena clear sting (D minor to D major), the death sting, the collapse quake hit, debris, drip, and torch crackle.
- **Music** (`src/audio/music.js`): a lookahead sequencer (25 ms timer, 0.6 s lookahead) with oscillator instruments.
  - Instruments: PeriodicWave pulses at 12.5, 25 and 50 % duty, triangle, sub, detuned-saw pad, drawbar organ, formant choir, FM bell, and a filter-snapped saw "chug". The drums (kick, snare, hat, open hat, tom, crash, tick) are rendered by the synth, and their velocities are humanised by ±10 %.
  - A tempo-synced dotted-eighth echo runs per song.
  - Stems come in at the next half bar. Leaving stems fade out (tau 0.5 s) and their tails ring. Stem levels are continuous and smoothed.
  - Songs crossfade. If the main thread stalls past the lookahead, late notes are skipped rather than bunched together.
  - All three songs are in D minor:
    - **title** ("Beneath the Mountain", 76 BPM): bed, bass, arp and lead. The FM-bell melody plays every other 8-bar pass.
    - **crypt** ("The Gauntlet", 132 BPM): bed, drums, bass, arp and lead are the arena layers, which come in by intensity at 0.2, 0.36, 0.55 and 0.78. Above 0.7 the drums add kicks and 16th hats. Corridors use chase (16th chug plus tom fills) and alarm (an A5/B♭5 siren whose level rises as the collapse closes in).
    - **warden** ("The Warden", 148 BPM): intro (drone and bell tolls), then organ, drums, bass and bell from phase I, arp and choir from phase II, lead and double kicks in phase III.
- **Ambience** (`src/audio/ambience.js`):
  - A wind bed: looped noise through a highpass and a slowly wandering bandpass, with gust modulation. The loop seam is crossfaded so it never clicks.
  - Poisson-timed torch crackles and drips, at random pan and pitch.
  - Collapse debris patter in corridors. Its density and pan follow the collapse.
- **Director** (`src/audio/director.js`): connects everything to the game.
  - Scene to music:
    - `title`: the title theme.
    - `run`: arena.
    - `gauntlet`: corridor.
    - `boss`: Warden intro.
    - `gameover`: title, bed and bass only.
    - `victory`: the title theme after 2.5 s.
    - Other pieces' showcases: silence.
  - Arena intensity: the threat of living enemies (husk 1, mite 0.45, wisp 1.2, brute 3), plus the wave number, plus recent hits and hurts. It is smoothed: rising tau 0.7 s, falling 3.5 s. Layers use hysteresis (they leave 0.08 below their threshold).
  - Corridors: `intro` plays bed and bass. `run` with an active collapse adds drums and chase, and the alarm when the gap is under 8 (full at a gap of 2). `safe` plays the bed only.
  - Boss: the phase comes from `boss:fight` and `boss:phase`, and the music stops on `boss:death`.
  - Low health (hp ≤ 1 or ≤ 25 %): the music lowpass drops to 950 Hz with Q 1.6.
  - Pause: lowpass at 520 Hz and a duck.
  - Hero death: the death sound, the music lowpass at 260 Hz and a fade, then the death sting.
  - Footstep surface comes from the arena theme: crypt is stone (tile in tile-style rooms), sunken is wet, ossuary is bone, hall is tile with carpet along the gate-to-exit runner, and deep is grit. Corridors are grit and the boss pit is stone.
- **Showcase** `?showcase=audio` (`src/audio/showcase.js`): the sound board.
  - Sound rows: 13 groups and 149 rows covering every bank sound and every stand-in voice, with its source piece shown.
  - Music panel: song, BPM and bar; each stem with a live RMS meter and an on marker; intensity with the layer thresholds; chase, alarm, low health and boss phase.
  - Last 5 plays with variant, pitch and gain, so per-play variation shows on screen.
  - Master oscilloscope, a 48-band log spectrum, peak and RMS in dBFS with hold, the music duck in dB, and a clip lamp.
  - A scripted 79 s **tour** that fires the same calls the game makes, in order: title, arena seal, two waves with hits and tells, the clear sting, the corridor chase with traps, the gate, the Warden intro and phases I–III, low health, and death.

## APIs

```js
import { audio, sfx, music, ambience, director } from './audio/index.js';   // main.js imports it once

// engine
audio.ctx / audio.unlocked / audio.time
audio.bus('music'|'sfx'|'cue'|'ui'|'amb')       // input node (null before unlock)
audio.duck(db = 6, hold = 0.2, release = 0.5, attack = 0.015)   // music (and 0.7x on ambience)
audio.onUnlock(fn(ctx))
audio.stream()      // master bus as a MediaStream   audio.record(ms) / audio.recordWav(ms) -> Promise
audio.meter()       // {peak, rms, wave, spec}
// for stand-in voice modules (already wired in the 7 files listed below):
import { audioContext, legacyBus, legacyVol, withBoost } from './audio/engine.js';

// bank
sfx.play(name, { x, pan, rate, gain, delay, bus })   // -> true if it played
sfx.hit(power, finisher, opt); sfx.step(surface, foot, opt); sfx.shard(step)
sfx.names(); SFX (the definitions: add a sound by adding an entry)

// music
music.play('title'|'crypt'|'warden'|null, { fade }); music.stop(fade)
music.want({ stem: bool }); music.only([stems]); music.level(stem, 0..1)
music.intensity = 0..1; music.chase = bool; music.filter('normal'|'lowhp'|'pause'|'dead')
music.info(); music.meters()

// ambience
ambience.set({ wind, crackle /*per s*/, drip /*per s*/, debris /*0..1*/, debrisPan })
```

- **Events listened to:**
  - `scene:enter`, `pause`;
  - `hero:swing`, `hero:slam`, `hero:dash`, `hero:land`, `hero:step`;
  - `move:dashReady`, `move:bonk`;
  - `combat:hit`, `combat:heroHurt`, `combat:dodge`, `combat:kill`, `combat:heroDeath`;
  - `enemy:spawn`, `enemy:hurt`, `enemy:death`;
  - `arena:wave`, `arena:clear`;
  - `gauntlet:start`;
  - `boss:fight`, `boss:phase`, `boss:death`.
- **Reads:** `world.room` (`kind`, `state`, `wave`, `collapse.gap`, `collapse.front`), `world.enemies`, `world.hero.hp` and `maxHp`, and `getActiveArena().L`.
- **Taking over a stand-in voice** is done in `director.js`, with no edits to the owners' files. The director replaces or wraps methods on the exported voice objects:
  - Replaced by the bank and played from events, so they can be panned: `combatSfx.swing`, `hit`, `slam`, `hurt` and `dodge`; `enemySfx.spawn` and `death`; `boonSfx.shard` and `heart`; `arenaSfx.clear`.
  - Telegraph tells are trimmed in dB and duck the music by 5–7 dB for their length: `enemySfx.windup` (+16 to +22 dB per kind); boss whirl, drawback, creak, inhale and keys (+17 to +20); bell, roar and rumble; trap rattle (+28) and hiss (+14); the dummy creak.
  - Other quiet stand-in sounds are trimmed per sound (table in `director.js`).
  - A piece that wants different behaviour can still call its own object as before.

## Debug hooks and showcase params

- `__GR.debug.audio()` returns info: context state, `music.info()` (song, bar, stems, intensity, filter, skipped notes), director mode, ambience, recent plays, render progress, master peak and RMS, and the duck value.
- `__GR.debug.audio(action, ...)` actions:
  - `'play', name, opts`, `'shard', step`, `'step', surface, foot`;
  - `'music', song|null`, `'stems', [..]`, `'intensity', v`, `'level', stem, v`, `'filter', mode`;
  - `'duck', db, hold`, `'amb', {...}`, `'mode', directorMode`, `'names'`, `'unlock'`;
  - `'record', ms` resolves to `{ok, mime, bytes, b64}`, using **MediaRecorder on the master bus** (webm/opus);
  - `'wav', ms` resolves to `{ok, sampleRate, samples, b64}`, a lossless 16-bit stereo WAV from an AudioWorklet tap on the master bus. Use it for measuring clicks, DC and peaks.
- `__GR.debug.audioStream()` returns the master bus as a `MediaStream`, if the critic prefers their own MediaRecorder.
- **How a critic records:**
  1. Load `?showcase=audio&tour=1`. Press a real key: Shift alone is not a user gesture in Chromium.
  2. In the page: `const r = await __GR.debug.audio('record', 80000)`.
  3. Write `Buffer.from(r.b64, 'base64')` to `clip.webm`.
  4. Run `ffmpeg -i clip.webm -lavfi showspectrumpic=s=1024x256:legend=0 spec.png`. I checked this exact path.
  5. In normal play, call the same hook on `?scene=run` or `?scene=boss` after a key press.
- **Showcase params:**
  - `&tour=1`, with `&t=<s>` to start part-way;
  - `&song=title|crypt|warden|off`, `&intensity=0..1`, `&chase=1`, `&alarm=0..1`, `&lowhp=1`, `&phase=0..3`;
  - `&group=<HERO|HITS|STEPS|ENEMIES|TELLS|...>`, `&play=<bank sound>` (repeats every 0.7 s);
  - `&unlock=1` creates the context without a gesture. Use it only with an autoplay flag.
- **Showcase keys:**
  - Sounds: A/D or ←/→ switch group, W/S or ↑/↓ select, J/Space/Enter play, 1–9 play a row, R repeats the selected sound.
  - Music: M next song, [ and ] intensity, C chase, G alarm step, L low health, B boss phase, X duck now.
  - T starts or stops the tour.
  - The first key only unlocks audio.

## Cross-piece edits

- `src/main.js`: one import line, `import './audio/index.js';`.
- `src/core/showcase.js`: the `audio` row's `load`.
- The stand-in voice modules, each with the same 3-line change. Their `ac()` now takes the shared context (`audioContext()`) and connects `out` to `legacyBus('<piece>')` instead of its own compressor and destination. Their `vol()` returns `legacyVol()` (a 0.8–1.0 random per layer, times a boost when `withBoost` is active), because the mixer applies the settings volumes. Before this there were 7 AudioContexts with 7 compressors and no master bus. The files:
  - `src/combat/sfx.js`
  - `src/enemies/sfx.js`
  - `src/progression/sfx.js`
  - `src/boss/sfx.js`
  - `src/ui/widgets/sfx.js`
  - `src/world/props.js` (`arenaSfx`)
  - `src/world/traps.js` (`gauntletSfx`). Its `vol` export, used only by the collapse rumble in `collapse.js`, now returns 1, so the rumble level is not randomised every tick.
- The `settings` imports in those files are now unused. I left them in place.

## Measurements (headless, WAV via the worklet tap, default settings)

- **Gameplay:** arena fight about −21.5 dBFS RMS with peaks −5 to −6; corridor chase −21 to −23 RMS; boss −21 to −22 RMS; no clipped samples anywhere; DC under 2e-5.
- **Band balance, arena music at intensity 0.8:**

  | <60 Hz | 60–250 Hz | 250 Hz–2 kHz | 2–8 kHz | >8 kHz |
  |---|---|---|---|---|
  | −36.9 | −26.9 | −29.2 | −36.4 | −42.6 dB |

  Before the rebalance, 60–250 Hz sat 7.6 dB over the mids and the arps were 20 dB under the bed.
- **Masking test:** full arena music plus 8 tells, measured in the 400 Hz–5 kHz band. Tell windows read −31 to −36 dB against ducked music at about −36. The arp and lead sit in the 2.2 kHz dip.
- **Click scan** (second-difference outliers):
  - All 43 bank sounds played alone: one marginal candidate (0.09) inside the slam tail.
  - Tour: the candidates come in ~30 ms trains during the stand-ins' low sawtooth tells (husk and charge wind-ups, the roar, the inhale). These are the reset edges of band-limited sawtooths, boosted by their trims, not discontinuities.
- **Variation:** every bank play logs a variant other than the last, plus its own rate and gain (visible in "LAST PLAYS" and in `debug.audio().sfx.recent`).

## Known gaps

- **Nobody has heard any of it.** Levels, balance and masking were set by measurement (band RMS, peaks, spectrograms), and the musical content was written on paper. Whether the melodies are good, whether the chiptune timbres are pleasant, and whether the stand-in tells are too buzzy after +20 dB are all unverified.
- **Most stand-in voices keep their original designs.** Only swings, hits, slam, hurt, dodge, enemy spawn and death, shard, heart and the clear sting were replaced. That leaves the boss sounds, boon procs and cards, traps, doors, enemy tells and enemy attack sounds as they were, just routed and trimmed. Their per-play variation is volume only (±1 dB per layer) where they had no pitch jitter of their own (most boss and boon sounds). Replacing the telegraph tells with bank sounds on the `cue` bus would be the next step. The `cue` bus exists but nothing uses it yet.
- **The music is 8-bar loops.** Over a 10-minute run they will repeat a lot: there are no B sections, no transitions or fills between states except the bar-8 snare and tom fills, and stings are not beat-synced.
- **Up to 0.6 s of latency on music changes.** Song switches can lag by up to 0.6 s because of the long lookahead, which was needed for 300 ms headless frame stalls. During the unlock burst, headless capture can drop one 16th (`music.info().skipped`).
- **Footstep surface is per room theme, not per tile.** The whole Drowned Shrine sounds wet, and the hall carpet is a straight-line approximation.
- **Panning only.** Bank sounds have no distance attenuation. The reverb is one room for the whole game, and the ambience is not positioned at the real torches.
- **Phase III boss music is untested in a real fight.** In my scene test, a second `debug.boss('phase')` stayed in phase 2, so phase III music was only exercised on the board and in the tour.
- **The low-health heartbeat is the HUD's,** routed through the bus but not synced to the music tempo.
- **Long stings need a Worker.** They take 50–120 ms to render. Without a Worker (fallback path), a first play before warm-up finishes would hitch.
- **Gamepad-only unlock is untested.** It polls `userActivation` every 250 ms.
- **No settings UI.** That belongs to `title`. The volumes respond live to `settings.set`.
