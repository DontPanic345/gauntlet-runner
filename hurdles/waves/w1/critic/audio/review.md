PIN: https://playwithfurcifer.itch.io/furcifers-fungeon | 4.7 stars (126 ratings) | top-down action roguelite (HTML5, Godot) whose players single out its soundtrack ("the soundtrack is amazing", "the music is so catchy"): a full composed score under constant combat SFX, which is the job of this piece; it is already the pinned reference for enemies and arenas, so it can be played and recorded live

# Critic review: audio (Audio), wave 1

## Reference

**Furcifer's Fungeon** by Play With Furcifer, https://playwithfurcifer.itch.io/furcifers-fungeon. It has 4.7 stars from
126 ratings (from the page's aggregateRating). Its comment thread praises the music without being asked: "the music is
so catchy", "the soundtrack is amazing", "the music, gameplay and many more are amazing".

**Why it is the right comparison:** it is a top-down action roguelite. It has a combat loop of attack spam against
waves, room music that runs under fights, and spell and impact SFX, and it is known for its audio. It runs in the browser,
so its master bus could be recorded live instead of guessed from a trailer. It is also the pinned reference for
`enemies` and `arenas`, so the game is measured against one bar.

**Other candidates I checked:**
- Bright Lancer (4.5 from 140). Its comments are mixed on the music ("music is very annoying", "music is boring").
- Just One Boss (4.7 from 557). A comment complains about its music and SFX.
- Gaunt Valkyr (4.9 from 94). No audio praise on the page.
- Celeste Classic (4.69, 1,000+). It has a famous chiptune score, but it is a platformer with no combat SFX to compare.

**How it was captured.** Both games were served locally (the reference's Godot build was downloaded with curl from
`html-classic.itch.zone/html/8189862/`). Both were driven in Playwright at a 480x270 viewport, so that headless
swiftshader rendering would not starve the audio thread; at 1280x720 the reference underran badly. Both were recorded
with the same injected tap: every node connected to `ctx.destination` was also routed to an AudioWorklet that wrote
lossless 16-bit WAV. The scripts are in `shots/critic/audio/` (`tap.js`, `live.cjs`, `lc.sh`, `panel.sh`, `clicks.cjs`,
`lev.cjs`).
- **Ours:** the title screen at `/` (no autoplay flag, first key S), and `/?scene=run&seed=3` with `__GR.debug.god(true)`:
  hold W for 1.8 s into arena 1, wait for wave 1, stand still (pair 02); then wave 2 with J attacks every 0.33 s, plus K
  dashes (pair 03). Also recorded: the corridor via `__GR.debug.run('next')` (`O/ours-chase.wav`), the boss via
  `__GR.debug.scene('boss')` (`O/ours-boss.wav`), low HP via `__GR.debug.hurt(4)`, and every music stem solo via
  `__GR.debug.audio('stems',[x])` on `?showcase=audio` (`S/title-*.wav`, `S/crypt-*.wav`).
- **Reference:** recorded from the moment its AudioContext existed (pair 01). Then its tutorial room, which is a real
  fight against slimes: 10 s idle (pair 02), then mouse-aimed fireball clicks every 0.35 s, with S taps (pair 03).
- Integrated loudness is matched within 2.1 LU in every pair (ours / ref: 01 -25.1 / -25.7, 02 -25.6 / -23.5,
  03 -21.2 / -21.1 LUFS), so the brightness of the panels is comparable.

Pairs: `01-opening-first-10s`, `02-fight-room-no-input`, `03-combat-10s`, `04-combat-3s-strip` (a 3 s close-up of 03,
seconds 3 to 6, which is the motion strip).

## Verdict (not blind)

**The reference is better.** It plays a composed, full-band score with melody and harmony all the time. Ours, in an
ordinary fight, is a kick drum, bass and drone grid with no melody, its arpeggios click on every note, and its SFX,
though punchier and clearer than the reference's, cannot carry the soundscape alone.

## Biggest gap

**The arena music has no tune at the intensities a player actually hears.** In a normal wave (the director holds intensity
at 0.41 to 0.56 for both waves of arena 1, attacking or not), only `bed + drums + bass` play, with `arp` flickering in
around 0.56. `lead` only joined after I spawned 4 extra enemies (intensity 0.72 or more). So pair 02 (ours) is a kick
pulse and short bass notes over a quiet drone, with a median level of -32 dBFS, while the reference plays a full melody
in the same moment. Do this:
1. Give the crypt loop a **melody in a stem that is on from intensity 0**: a lead or counter-melody, quieter at low
   intensity and fuller at high. The layers above it (arp, a second lead, the drum fills) should add energy, not supply
   the tune. Write at least a 16-bar loop with an A and a B section (or 2 loops that alternate), so the 8-bar cycle does
   not repeat every 14.5 s at 132 bpm.
2. **Widen the director's intensity range in normal play.** Two husks plus the player attacking should reach about 0.6
   (arp in), and a full wave 2 with mites should reach about 0.75 or more (lead in). Today, standing idle (0.41) and
   fighting hard (0.45) sound almost the same. Recent hits and kills should push intensity up, not only the enemy count.
3. While doing this, fix the arp voice (Problem 2), because the arp is the stem that carries most of the pitch content
   once it is on.

## Problems

1. **Ordinary combat music is a drum and bass skeleton.** It sounds almost the same idle as fighting.
   - Where: `O/ours-idle.wav` and `O/ours-combat2.wav`; `/?scene=run&seed=3`, enter arena 1 and stand still, then fight.
     The stems reported in `__GR.debug.audio().music.stems` are `{bed:1,drums:1,bass:1,arp:0,lead:0}` both times, at
     intensity 0.41 and 0.45.
   - Why it hurts: this is 80% of a run's listening time, and it is the moment the reference beats us most clearly
     (pair 02).
   - Fix: see Biggest gap.

2. **The arp voice clicks on every note.** This is a fail against the must_have "no clicks or pops".
   - Seen: soloing stems on `?showcase=audio` (`__GR.debug.audio('stems',['arp'])`), the arp has a hard discontinuity
     at every note onset: 13 per 5 s in the title song (every eighth note at 76 bpm) and 42 per 5 s in the crypt song
     (every sixteenth at 132 bpm). None of bed, bass, chase or alarm has any. In the title mix you can see each onset as a
     rectangular pulse about 6 samples wide (+0.07), followed by a level step of about 0.03 (samples printed from
     `G/gesture.wav` at 0.478 s: `0.042 0.104 0.099 0.091 0.093 0.097 0.089 0.024`). It also shows as a full-height
     hairline at every note in `O/ours-title-spec.png`. `crypt-lead` (11 per 5 s) and `crypt-drums` (5 per 5 s) show
     some too.
   - Why it hurts: it is a tick riding on the music's most exposed stem, at up to 8 per second, from the title screen on.
   - Fix: give every music voice an amplitude envelope. Ramp from 0 with `setValueAtTime(0,t)` and
     `linearRampToValueAtTime(v, t+0.003)` (2 to 5 ms attack), and release with `setTargetAtTime(0, tEnd, 0.008)` before
     `stop(tEnd+0.05)`. Never start or stop an oscillator, or change a shared gain, at non-zero amplitude. Use
     band-limited `PeriodicWave` pulse tables instead of naive square or pulse samples, and if notes share a voice, ramp
     between them instead of stepping.

3. **Music masks enemy telegraph cues, and nothing ducks for them.** This fails the must_have "music never masks
   telegraph cues".
   - Seen: on `?showcase=audio`, group TELLS, I played key 1 (Husk wind-up) and key 3 (Brute charge wind-up) with
     `crypt` playing (chase on, intensity 75%, ambience on), then again with music off (`S/tell-mix.wav` and
     `S/tell-alone.wav`, image `S/chk-tell2.png`). Alone, the tells peak at -19.7 dBFS. Under the music, the 50 ms
     levels are p90 -21.3 and max -16.7 dBFS, so the wind-ups sit at or below the music's own kick peaks. In the mixed
     waveform the husk wind-up makes no visible bump at all. `__GR.debug.audio().duck` stayed 1.0 (0 dB) the whole time.
   - Why it hurts: in a melee roguelite, the wind-up sound is a gameplay signal. If it is buried, a player who is
     watching the hero misses the cue to dodge.
   - Fix: route every tell (enemy wind-ups, boss tells, trap rattle and hiss) through a "cue" bus that triggers
     `audio.duck(5, 0.35)` on the music bus (40 ms attack). Raise the tell sounds by 4 to 6 dB. Also cut about 3 dB at
     1.5 to 4 kHz on the music bus while a tell plays, because that band is where the arp harmonics and the tells collide.

4. **Music events are dropped when the main thread stalls, which leaves holes in the score.**
   - Seen: `__GR.debug.audio().music.skipped` climbed 2, then 18, then 51 across scene changes (run start, room goto,
     arena to corridor). The boss entry has a gap of about 4 s with almost no music, between the intro sweep and the
     fight theme (`O/ours-boss.wav`, 3.4 to 7.7 s, image `O/chk-boss.png`).
   - Why it hurts: scene changes are exactly when music should swell or sting. A real browser stalls less than headless
     does, but loading a room or building a voxel mesh will still hitch.
   - Fix: schedule further ahead (a 250 to 400 ms lookahead from a Worker-driven timer, not rAF), and on a stall,
     resync to the bar grid instead of skipping. Better still, pre-render each stem's loop to an AudioBuffer in the
     existing synth worker, as the bank already does for 288 SFX, and play the loops with sample-accurate `start(when)`
     times, so that main-thread hitches cannot touch the music.

5. **The title theme is static.**
   - Seen: pair 01 (ours) is 10 s of one slow block-chord arpeggio. Every note has the same envelope and brightness, and
     the loudness range is 0.3 LU (the reference's opening is 2.2 LU). The `lead` stem reports on, but no line separates
     from the arp grid in the spectrogram (`O/ours-title-spec.png`, `pair-01` in the critic folder).
   - Why it hurts: the title is the first impression, and the reference's opening has a beat, harmony and a tune at once.
   - Fix: bring the lead melody in by bar 2, at least 3 dB above the arp. Vary note velocity (accent beats 1 and 3, and
     ghost the off-beats), and add a slow filter sweep or swell over each 4 bars, so it breathes.

6. **The chase mix is a wall.**
   - Seen: corridor run (`O/ours-chase.wav`, `O/chk-chase.png`): chase plus alarm plus drums, with a constant
     broadband spectrum and an LRA of 1.3 LU. The alarm's siren sweeps fill the top octaves continuously.
   - Why it hurts: it is tiring, and the trap tells (spikes rattle, fire jet hiss) have to cut through it. That is
     Problem 3 at its worst.
   - Fix: pulse the alarm (2 beats on, 2 off), keep it below 4 kHz, and duck it with the cue bus from Problem 3.

7. **The game-over music is an anticlimax.**
   - Seen: after death, the director switches to `title` with only the `bass` stem, at -30 LUFS (`O/ours-death.wav`).
   - Why it hurts: the death sting itself is good, but what follows is close to silence.
   - Fix: play a short, dedicated game-over phrase (4 to 8 bars, a slower version of the main melody), then let the
     title bed fade in.

8. **Sound board usability.**
   - Seen: number keys reach only rows 1 to 9. HERO HURT, HERO DEATH and 19 of the 28 boss sounds need arrow navigation.
     Every row also carries a right-aligned "AUDIO" or owner label that adds noise. Navigation with ArrowRight drops
     presses that come within 100 ms of each other (I landed on HITS instead of TELLS).
   - Fix: map keys Q to P for rows 10 to 19, show the owner once in the group header, and make page changes immediate.

**What is good (keep it):**
- The SFX bank is clean and punchy. In combat, hits peak 14 to 16 dB above the music's median (crest 16.5 dB, against
  the reference's 7.9). They read better than the reference's long, broadband explosions, which smear over its music
  (pair 04).
- The low-HP state low-passes the whole score clearly (`O/ours-lowhp-spec.png`).
- The variant and pitch system covers all 65 bank sounds.
- Audio stays locked until the first gesture, and then starts without a thump.

## must_have checklist

- **No sound repeats identically twice in a row: PASS.** I played all 65 `__GR.debug.audio('names')` sounds 3 times
  each, 300 ms apart. Every consecutive pair differed in variant, rate or gain (rates about 0.88 to 1.15, 4 to 8
  variants). Retriggers of the same name within 30 ms are suppressed rather than repeated, which is acceptable voice
  limiting.
- **Music reacts to game state: PASS, weakly.** Stems layer with intensity (arp at about 0.56, lead at about 0.72). The
  corridor turns on the `chase` and `alarm` stems. At 1 HP the filter switches to `lowhp`, an obvious low-pass. The boss
  plays `warden`, with phases. Game over switches to the title song. But in normal arena play, intensity barely moves
  (0.41 idle, 0.45 fighting), so the reaction is mostly not audible where it matters (Problem 1).
- **Mix is balanced; hits cut through; music never masks telegraph cues: FAIL.** Hits cut through, as noted above.
  Enemy wind-up tells are masked by the music, with no ducking (Problem 3).
- **Audio starts cleanly after the first user gesture; no clicks or pops: FAIL.** Without the autoplay flag, no
  AudioContext exists before the first key (`state: none`). On the key it is created and running, and the first 50 ms
  ramps in without a thump. But the arp voice puts a discontinuity on every note (Problem 2), and that is audible from
  the title screen on.

## Console errors

- **Ours:** none. There were 0 errors on `?showcase=audio`, `/` (title), `/?scene=run&seed=3` (arenas 1 and 2, corridor,
  death), or the boss scene, across all sessions.
- **Reference (not ours):** a 404 for a resource, and `ERR_CERT_AUTHORITY_INVALID` for its online leaderboard WebSocket
  (`wss://ws.silentwolfmp.com`), which is blocked by the sandbox proxy. Neither affects audio.
