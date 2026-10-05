# audio: builder notes (wave 2)

This wave rewrote the music. Everything else (engine, SFX bank, ambience, footsteps, the
stand-in voice takeover) is as in `hurdles/waves/w1/build/audio.md`, except where noted below.

## What exists

- **Music synth on the audio thread** (`src/audio/music-worklet.js`): an AudioWorkletProcessor runs
  the sequencer, every voice, the drum kit and a ping-pong dotted-eighth echo, sample-accurately.
  The main thread only sends song, stem gates and stem levels. Main-thread stalls (scene builds) no
  longer drop or bunch notes. `music.info().skipped` is always 0 now.
  - Voices: polyBLEP pulse (any duty, unison) and saw, triangle, sine, organ wavetable, 2-op FM
    (electric piano, chime, toll), Karplus-Strong pluck (harp), and a formant choir. Each voice has an
    ADSR envelope that starts from 0 and ends with an exponential release, plus its own TPT lowpass
    with a filter envelope, velocity brightness and key tracking. Monophonic leads have delayed
    vibrato and optional legato glide.
  - Kit: kick, snare, rim, hat, open hat, shaker, tom (pitched), crash, boom, swell (a
    reversed-cymbal rise). The noise is low-passed to about 10 kHz, and transients have a
    sub-millisecond fade-in.
  - Stems gate in on the next beat. Sustained stems (pads, organ, choir, drone) catch up on notes that
    are already sounding, so a layer never waits a bar to enter.
- **Scores** (`src/audio/songs.js`): composed, sectioned and all in D minor. Every song has a lead
  melody, a counter-line, pads, bass and an arpeggio as separate stems. The notation is a small
  parser (`mel('D5.6 E5.2 F5.4 A5.4 | ...')`, `grid('X...x...')`), and bar lines are checked.
  - **title** "Beneath the Mountain", 84 BPM, 34 bars. Form: intro 2 | A 8 | A2 8 | B 8 | A3 8, and
    it loops from A.
    - The intro is the arrival: a noise swell into a deep boom, with a chime and the harp starting.
      The lead melody comes in at bar 3 (about 5.7 s).
    - A2 adds the counter-line on electric piano. B moves to F major with soft kick and shaker. A3
      adds rim, a 16th-note harp and a tom fill.
  - **crypt** "The Gauntlet", 132 BPM, 32 bars. Form: A | B | A2 | B2. It has a square lead and a
    25%-pulse counter-line that moves when the lead holds. The harp arp plays 16ths. The drums go
    half-time in B. There is also an octave-up flute double (`lead2`), plus `chase` (a filtered saw
    chug) and `alarm` (A4/B♭4, 2 beats on and 2 off, lowpassed at 2.4 kHz) for corridors.
  - **warden** "The Warden", 148 BPM, 24 bars. Form: A | B | A2, in Phrygian colour.
    - Stems: intro (an organ drone, bell tolls every 4 bars, low toms), organ, saw lead, bells, harp
      arp, choir, a flute double, and perc (8th-note double kicks and fills).
  - **dirge** "Fallen", 72 BPM, 6 bars, played once: the title's opening phrase, slowed and darkened.
- **Director** (`src/audio/director.js`):
  - **Arena** (crypt): `bed`, `bass` and `lead` play from the moment the gate seals, and the lead's
    level grows with intensity (0.62 to 1).
    - The other layers enter at these intensities: drums 0.30, counter 0.45, arp 0.58, perc 0.70,
      lead2 0.82. Each layer has 0.08 of hysteresis.
    - The intensity formula is wider than in wave 1. Kills now feed it and hits feed it more.
    - Measured on `?scene=run&seed=3` in god mode: wave 1 (2 husks) idle = 0.48, which plays bed,
      bass, lead, drums and counter. Wave 2 while attacking = 0.83, which plays every layer.
  - **Corridor**:
    - intro: bed, bass, lead.
    - run: adds drums and chase, and alarm when the collapse is close.
    - safe: bed and counter.
  - **Boss**:
    - intro phase: the drone.
    - Phase I: organ, drums, bass, lead (the melody starts here).
    - Phase II: adds bell, arp and choir.
    - Phase III: adds lead2 and perc.
  - **Game over**: the death sting plays. 1.6 s after the gameover scene starts, "Fallen" plays once.
    Then the title's bed and harp fade in under the summary (`music.onEnd`).
  - **Victory**: after 2.5 s, the full title theme plays from the top.
  - **Telegraphs**: every tell now goes through `audio.cue()`, which ducks the music 8 to 9 dB with
    an 8 ms attack and dips 4 dB at 2.6 kHz for the tell's length. Tells are trimmed 5 dB higher
    than in wave 1 (`TELL_DB`).
- **Mix**: the music bus is 6 dB lower than wave 1 (`G.music` 0.62), with per-song gain in
  songs.js. Stem gains were set from measured per-stem RMS.

## Measurements (headless, WAV via the worklet tap, default settings)

| state | LUFS (music only unless noted) | notes |
|---|---|---|
| title scene `/` (14 s, includes intro) | −22.4 | LRA 4.6, the intro swell gives it a shape |
| arena wave 1, 2 husks idle (game) | −23.9 | bed+bass+lead+drums+counter |
| arena wave 2 attacking (game, with SFX) | −18.7 | hit peaks −1 dBFS, music p10 −26 |
| corridor run (game, with SFX) | −20.1 | |
| dirge plus title return | −22.4 | LRA 15.6 |

- **Tell masking** (`?showcase=audio&song=crypt&intensity=0.75&group=TELLS`, keys 1 and 3): the husk
  wind-up peaks at −15 dBFS against a music median of −26 dB, and the music drops to about −35
  under the tell. In wave 1 the tell sat at the music's level.
- **Clicks** (second-difference outliers): 0 in every music-only recording after the fixes, across
  all four songs. The remaining candidates in game and tour recordings are other pieces' sounds:
  the fire-jet roar (white noise), the brute charge wind-up, and a boss noise burst.
- **No dropped blocks** in any recording, including scene changes (`fl-boss`: the music runs
  through the wall transition; the Warden drone bridges the intro into the fight).
- **CPU**: an offline Node benchmark of the worklet runs at 6–9 % of real time (crypt, every
  layer), 14 % (warden phase III) and 8 % (title A3) of one core. Occasional single blocks take
  2–4 ms, which is over the 2.67 ms budget at 48 kHz. That is not verified in a real browser's
  audio thread.

## APIs

```js
import { music, SONGS } from './audio/music.js';
music.play('title'|'crypt'|'warden'|'dirge'|null, { fade, restart, from })  // from: section name ('B') or 16th step
music.want({ stem: bool }); music.only([stems]); music.level(stem, 0..1)
music.filter('normal'|'lowhp'|'pause'|'dead'); music.onEnd(fn(name)) -> unsubscribe
music.lengthOf(name)   // seconds per pass
music.info()           // song, bpm, bar, step, bars, section, loop, stems, live, voices, engine
music.meters()         // per-stem RMS from the worklet
import { arenaStems, corridorStems, bossStems, TITLE_STEMS, ARENA_LAYERS } from './audio/director.js';
audio.cue(db = 8, hold = 0.35, release = 0.35, dipDb = 4)   // a telegraph: duck + 1.5-4 kHz dip
```

- **Adding a song:** write it in `songs.js` as `{name, bpm, form, stems, parts}` and add it to
  `RAW`. The stem `inst` objects use the voice parameters documented at `class Voice` in
  `music-worklet.js`.
- **Events listened to:** unchanged from wave 1. `music.intensity` and `music.chase` are now
  informational only. The director picks the layers itself.

## Debug hooks and showcase params

- `__GR.debug.audio('music', song, { from: 'B' })` starts a song at a section, and `'dirge'` is
  accepted. The other `debug.audio` actions are unchanged.
- `debug.audio().music` now includes `section`, `bars`, `step`, `live` (the worklet's actual stem
  levels), `voices` and `engine` (`worklet`, or `off (reason)` if AudioWorklet failed).
- **Board** (`?showcase=audio`):
  - The song list has the dirge: `&song=dirge`.
  - Rows 10–19 are on keys Q–P.
  - Select moves to ↑/↓ (and S).
  - **Repeat moved from R to Z, and the tour from T to V** (R and T are now row keys).
  - Every key press counts: the board keeps its own key queue, so fast presses are never merged.
  - The owner is shown once in the group header. Per-row owner tags appear only in mixed groups.
  - The music header shows the section and the bar out of the song's length.
  - X fires an `audio.cue`.
- **Tour**: 104 s. The title now gets 16 s (its arrival and first phrase), the arena and boss use
  the director's stem sets, and it ends with the game-over dirge.

## Cross-piece edits

None this wave. All changes are in `src/audio/`: `music.js` was rewritten, and `music-worklet.js`
and `songs.js` are new. `engine.js`, `director.js`, `showcase.js` and `index.js` were edited.

## Known gaps

- **Nobody has listened.** The melodies were written to the chord charts by theory, and balance was
  set by per-stem RMS and spectrograms. Whether the themes are catchy is unverified.
- **No AudioWorklet means no music.** It logs one console warning and the game stays silent
  musically. There is no oscillator fallback.
- **Real-browser audio-thread load is unmeasured.** Underruns would not show in the tap recording.
- **The loops are short.** Arena music repeats every 58 s and the boss every 39 s. There are no
  transitions or stings synced to section boundaries; stems simply gate in on the beat.
- **Stand-in tells are still buzzy sawtooths** owned by other pieces, now 5 dB louder. Replacing
  them with bank sounds on the `cue` bus is still open.
- **Corridor low end is busy:** the chase chug, bass and debris all sit at 60–250 Hz.
- **Unchanged from wave 1:** footstep surfaces are per room theme, and the low-health heartbeat is
  not synced to the tempo.
