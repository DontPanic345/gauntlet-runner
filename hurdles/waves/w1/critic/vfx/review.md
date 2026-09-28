PIN: https://flanne.itch.io/10-minutes-till-dawn | 4.8 stars / 744 ratings | Top-rated, browser-playable pixel-art action roguelite whose hit, kill and enemy-entry effects are few, bold, two-tone and precisely timed. That is the "crafted and punchy" bar for hit-spark and death-burst strips, and live 30 fps frames can be captured from it.

# Critic review: vfx (wave 1)

## Reference

**10 Minutes Till Dawn** by flanne (https://flanne.itch.io/10-minutes-till-dawn), 4.8 stars from 744
ratings (itch page JSON-LD, read 2026-09-28). It is a top-down pixel-art action roguelite with an
HTML5 build (`html-classic.itch.zone/html/5833734/10MinutesTillDawnWebGL/index.html`). Its hit
feedback is well known: a cream silhouette flash held for several frames, then a spiky star burst on
the kill and a flat splat that breaks up and fades. It is the same genre and job as ours (enemies
swarm, you hit them, they burst), and it clears the rating bar by a wide margin.

Other candidates I checked:
- Bright Lancer (4.5 stars, 140 ratings, pinned for movement): it has a dash, but its tutorial
  NPC blocked my progress and I could not reach combat under scripted input.
- Nuclear Throne (pinned for look): there is no browser build and no GIFs, so no motion captures.
- itch's top-rated browse pages are behind Cloudflare, so I could not do a wider tag search.

The pinned reference has no dash, so the packet has no dash pair. I judge our dash below
without a comparison.

How the captures were made:
- **Reference:** I played it live with a small Playwright driver. It holds fire and auto-aims at
  the nearest green enemy by sampling the canvas. I recorded the canvas itself with
  `canvas.captureStream` + MediaRecorder, then sampled it at 30 fps. Playwright's page video was
  corrupted by screenshots taken during recording, so I did not use it.
  - Caveat, noted for fairness: under SwiftShader the reference renders about 15 unique fps, so
    some consecutive frames in its strips repeat.
- **Ours:** I used `/?scene=run&seed=3` with `debug.freeze` and `debug.step(2)`, one frame per
  33 ms of game time, and `debug.enemies('ai', false)` so the husk stands still to be hit.
- **Framing:** crops are chosen so enemies appear about the same size on both sides. Ours is a
  native 640x360 crop. The reference is a 320x180 crop scaled 2x with nearest-neighbour.

## Verdict (not blind)

The reference is better on hit-spark and death burst, which are the two effects players see
hundreds of times a run. Ours is better on spawn. Overall the reference wins.

## Biggest gap

**Our kill has no single strong "pop" frame, and the burst plays late and off-target.** The
killing blow (`ours/02`, and `evidence/ingame-kill-to-death-delay.png`) goes like this:
- The husk is knocked about 1.5 tiles away, lies as grey-white chunks inside a faint dotted ring
  for about 10 frames (330 ms), and only then gets a small pale-yellow dithered disc.
- The remains are a handful of grey cubes the same value as the floor, plus orange crumbs.

The reference kill (`ref/02`) is one bold, spiky, cream star (about 1.5x the enemy's size) on
the exact frame of the kill. It spins and shrinks over 4 to 5 frames, then leaves a flat
enemy-coloured splat that breaks into 4 to 6 blobs and fades.

What to change:
- **Timing:** fire the death burst on the killing-blow frame, at the point of impact, not when
  the knockback slide ends. The corpse can still slide, but the pop must be instant.
- **Pop shape:** replace the dithered light disc with one hard-edged, 8 to 12-point star or
  spiky polygon, 1.5 to 2x the enemy's bounding box.
  - Colour: `#fbf7ef` core with a `#ffd86b` rim.
  - Timing: full size on frame 0, shrinking and rotating about 20 degrees per frame, gone by
    frame 5.
- **Remains:** make the burst chunks the enemy's own body colours (husk greens and browns, not
  generic grey and white), 2 to 3 px cubes. They should fly outward fast, land and bounce once,
  then sit on the floor for about 1 s before shrinking away.
- **Scale with impact:** a heavy kill gets a bigger star and more chunks.

## Problems

1. **The death burst is delayed and weak (see Biggest gap).** To reproduce: `/?scene=run&seed=3`,
   `debug.enemies('ai',false)`, spawn a husk 1.15 units right of the hero, and combo it with J.
   See `evidence/ingame-kill-to-death-delay.png`: the kill number is shown at frame 53, but the
   burst disc only appears around frame 70. In the showcase (`?showcase=vfx`, key 5,
   `evidence/showcase-death-grid.png`) the burst reads better, because a yellow disc and white
   chunks sit on an empty floor. In game, against the husk's own chunks and the busy floor, it is
   lost. It hurts because every kill in a run looks like this.

2. **The hit spark is buried under the damage number and lasts one frame.** At the moment of
   impact (`ours/01`, frame 3), the "23!" damage number is drawn as a large inverted white box
   right over the contact point. The actual spark (a white cloud plus streaks) is hidden behind
   it, and by the next frame the spark is a few 1 px yellow crumbs.
   - The enemy's white flash also lasts only 1 frame. The reference holds a clean cream
     silhouette of the enemy for 4 frames (about 130 ms, `ref/01`), which is what makes each
     hit read as a hit.
   - Fixes:
     - Hold the enemy flash for 3 to 4 frames: white, then white, then 50% dither, then off.
     - Push the damage number up and away from the contact point (spawn it 12 or more px above
       the enemy's head).
     - Make the hit-spark core a hard 4 or 8-point star 16 to 24 px across in `#fbf7ef`/`#ffd86b`
       that stays 2 frames before breaking into streaks.
   - The number is combat/ui territory, but VFX owns the spark's placement and duration.

3. **The light flash is drawn as an opaque orange or yellow disc in front of the characters.**
   See `evidence/ingame-flash-disc-over-hero.png`, top row, frames 2 and 3. When the hero is hit
   or lands a strike, a big dithered orange ellipse about 3x the hero's size covers the hero, the
   enemy, and the moment of contact.
   - The same flat disc is the midpoint of the spawn (`ours/03`, frame 8) and the core of the
     death burst. It reads as a sticker, not as light.
   - Fix: draw the light flash on the floor plane, under the characters. Make it a dithered
     additive tint that brightens the floor tiles (a ring falloff over 2 to 3 dither steps), not
     a solid shape. Keep only a small, hard white core above the characters, and only for
     1 frame.

4. **Effects are mostly one pale colour.** Portal ring, shockwave, dust, dash ghost start and
   spawn chunks are all `#8f93b3`/`#bfc6dc`/`#fbf7ef` pale grey-white. See
   `evidence/showcase-shockwave-grid.png`, `evidence/showcase-spawn-grid.png`, and showcase keys
   3, 6 and 9.
   - On our blue-violet floor these pale greys have little value contrast, so dust and chunks
     read as grey mush. In game they are larger cube clouds that hang in the air for more than
     0.5 s.
   - The reference gets its punch from exactly two colours on a dark field: cream effects and
     the enemy's own green.
   - Fix: give each effect family a 3-step ramp that goes from hot to cold as it ages.
     - Impacts: `#fbf7ef` → `#ffd86b` → `#ff7a2f`.
     - Dust: `#8f93b3` → `#4f4a6e` → gone.
     - Enemy remains: the enemy's own palette.
     - Make dust fall and settle rather than float.

5. **The dash after-images are opaque cardboard copies (showcase).** In `?showcase=vfx`, key 4
   (`evidence/showcase-dash-grid.png`), the dash leaves four solid, full-silhouette hero copies.
   They are pure white, then cyan, then teal, with no detail, and they overlap into a long cyan
   slab.
   - In game (`evidence/ingame-dash-strip.png`) it is a flat teal smear, which is better, but:
     - there is no dust puff or launch ring when the dash starts;
     - there is no skid dust when it ends;
     - the smear hides the hero's legs.
   - Fix:
     - Keep at most 3 ghosts, each a 1-colour silhouette with a 50% dither checkerboard, fading
       over 4 frames.
     - Add a 4 to 6-cube dust kick at the start, going backwards along the dash.
     - Add a small skid puff at the end.

6. **The showcase spawn portal never spawns anything and does not match the in-game spawn.** In
   `?showcase=vfx`, key 6 (`evidence/showcase-spawn-grid.png`), the portal is a grey-white dotted
   ring that swirls and dissolves with nothing emerging. In game (`ours/03`) the portal is gold
   and red with an orange disc, and a husk pops in. The showcase should demo the real effect on a
   real enemy model, or builders tune the wrong thing.
   - The in-game spawn is the strongest effect we have, and I expect it to win its pair.
   - Its weak point is the flat orange disc on frame 8 (see 3). Replace that with a vertical
     column of light (a 2 to 3 px wide `#fff1b0` pillar, 1.5x enemy height) that collapses into
     the enemy.

7. **The stress test never reaches 2,000 particles.** In `?showcase=vfx`, key Q (also with Space
   held), `debug.vfxStats()` shows alive reaching a steady state around 1,530 to 1,560 and peaking
   at 1,598, while the title says "STRESS: 2000 PARTICLES" (`evidence/stress-1530-alive.png`).
   - Emit enough to hold 2,000 or more alive, so the must_have is actually demonstrated.
   - CPU cost is fine (msTick about 0.1 ms, msRender 0.3 to 0.6 ms).
   - FPS under SwiftShader fell from about 33 to 13 during stress. That is a software rasteriser
     and not conclusive, but it suggests the particle draw is fill-rate heavy (large overlapping
     quads). Check the draw on a real GPU, and keep particle quads small.

8. **Hit-spark streaks are rotated rectangles with a stair-step look** (showcase key 1,
   `evidence/showcase-hitspark-closeup.png`). They are pale `#fff1b0`, all the same length, and
   thrown to one side in a fan. They don't taper and don't change colour as they age, so they
   look like confetti rather than sparks.
   - Fix: taper each streak (2 px wide at the head, 1 px at the tail) and shorten it every frame.
   - Colour ramp: `#fbf7ef` → `#ffd86b` → `#ff7a2f` over 3 to 4 frames.

## must_have checklist

- **Pooled, no allocation per frame, 2,000 particles at 60 fps in the showcase: FAIL (partial).**
  - The pool is fixed at a capacity of 2,600 with `recycled 0`, and the JS heap stayed flat at
    15.2 MB over 3 s of stress. Pooling and allocation pass.
  - But alive tops out at about 1,600, not 2,000.
  - 60 fps could not be verified headless (SwiftShader: 13 to 22 fps under stress, against about
    33 idle).
- **Every effect uses the palette and snaps to the pixel grid: PASS.**
  - I sampled pixels from the showcase hit spark, the death burst, and an in-game spawn frame.
    100% of the effect pixels match `src/render/palette.js` entries exactly (0% off-palette).
  - Rings and dots land on the texel grid, with no sub-pixel lines at 2x.
- **Effects have shape and timing (a fast pop then a slow fade), not a uniform spray:
  PARTIAL / FAIL in game.**
  - The showcase hit spark has a real 1-frame flash and then streaks.
  - Spawn has a clear build, pop, and settle.
  - In game, the kill's pop comes about 330 ms late, the hit's pop is hidden under the damage
    number, and dust and chunk clouds hang evenly in the air.
- **Ambient embers and dust motes available as a scene layer: PASS.**
  - Present in the showcase (`vfxStats().ambient`: embers 34, dust 44) and in normal play.
  - Warm ember specks drift over the arena and torches, and there are dust motes (`r1/start.png`).

## Console errors

None. 0 console errors and 0 page errors across every showcase and `/?scene=run&seed=3` capture
(about 12 runs).
