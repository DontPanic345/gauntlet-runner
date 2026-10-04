PIN: https://ember-paw-games.itch.io/gaunt-valkyr | 4.9 stars (94 ratings) | top-down pixel roguelite on itch's top-rated roguelite and dungeon-crawler lists, built on loud juice (silhouette hit flashes, floor-lighting muzzle flashes, starburst explosions, gore and casings that stay on the floor); already the pinned reference for look

# Critic review: vfx (VFX and juice), wave 1

## Reference

**Gaunt Valkyr** by Ember Paw Games, https://ember-paw-games.itch.io/gaunt-valkyr. Its page shows 4.9 stars ("4.88 average
rating from 94 total ratings", checked today). It is on itch top-rated under `tag-roguelite` and `tag-dungeon-crawler`.

**Why it is the right comparison:** it is a top-down pixel action roguelite fought in sealed rooms with the same framing as
ours, and juice is what it is known for. Every shot throws a muzzle flash that lights the floor. Every hit flips the whole
enemy silhouette to solid black, then solid white. Kills end in a black smoke puff and an orange starburst, and blood,
debris and brass casings stay on the floor for the rest of the room. It is also the pinned reference for `look`, so the
game is measured against one bar. **Candidates I rejected:** Bright Lancer (4.5 from 140) is HTML5 and could be played live,
but its effects are restrained. It would be an easier bar, not the strongest one. Nuclear Throne (4.7 from 511) has only
stills on its itch page. Of the itch `tag-particles` and `tag-juicy` top-rated lists, no action game has 50 or more ratings.

**How it was captured:**
- **Reference:** it is not HTML5. I used its three 400x225 gameplay GIFs (`img.itch.zone`, 10 fps), downloaded to
  `shots/critic/vfx/gv/` and split into frames with ffmpeg. Each panel is a 160x90 window around the action, scaled 4x with
  nearest-neighbour to 640x360. Hits come from GIF 2, frames 11 to 18. The kill comes from GIF 2, frames 52 to 59. The dash
  comes from GIF 3, frames 3 to 10.
- **Ours:** real play at `/?scene=run&seed=3` (arena 1, the first wave of two husks), with god mode on. I used a scratch
  driver, `shots/critic/vfx/clk.cjs`. It runs the page under Playwright's paused fake clock and advances it frame by frame
  at 60 Hz, so the slow SwiftShader screenshots do not eat effects or hitstop. I took one screenshot every 100 ms of game
  time (10 fps, matching the GIFs). The input script is `shots/critic/vfx/play/s4.json`: walk in, walk to the left husk,
  tap J at frames 1, 4, 7 and 10, then hold D and tap K. Each panel is a native 640x360 window cut from the 1280x720 frame,
  so the characters are about the same size as in the reference panels.
- **Fairness:** the reference frames are GIF-dithered and soft, which favours us. The reference is a gun game and ours is
  melee, so the criteria tell the judge to ignore the weapon type. The reference media has no enemy-spawn moment, so there
  is no spawn pair. Our spawn is reviewed below from `shots/critic/vfx/strip/ours-spawn.png`.

Pairs: `01-hit-spark-strip`, `02-death-burst-strip`, `03-dash-strip` (8 frames, 0.8 s each), `04-hit-contact-still`.

## Verdict (not blind)

**The reference is better, clearly.** Ours is tidy, on-palette and well engineered, but its effects are small, mostly
white-on-warm, gone within about 300 ms, and they leave nothing behind. In the reference every hit and kill makes a big,
high-contrast shape and a mark that stays on the floor.

## Biggest gap

**Kills are not events. Make the death burst big, dark against light, and lasting.** Today a husk kill is the same white
blob as a normal hit, then a thin white floor ring, three or four tiny cyan cubes and a falling corpse
(`ours/02-death-burst-strip.png`, frames 2 to 8). Nothing says "this one died" beyond a hit, and nothing stays. In the
reference a kill is a black smoke puff, then an orange starburst about twice the enemy's size, then embers, with a blood
splat that stays on the floor (`ref/02-death-burst-strip.png`, frames 6 to 8).

Concretely, in `src/vfx/effects.js` (`death`):
1. **Frame 0 (contact):** keep the 1-frame white silhouette pop, then on the next frame flip the silhouette to solid `ink`
   (black) for 1 frame. The black and white alternation is what makes the reference read at thumbnail size.
2. **Frames 1 to 3:** a starburst or STAR shape at about 2.5x the enemy's footprint, `torch` core and `ember` rim,
   scaling up 0 to 100% in 2 ticks and shrinking over 6. Behind it, a puff of 6 to 10 `ink` and `shadow` CUBE particles that
   expand and rise slowly over 0.6 to 0.8 s. A dark puff reads against both the dark floor and the torch light, so it does
   not vanish inside a brazier pool the way white does.
3. **Chunks:** 10 to 16 CUBE particles in the enemy's own body colours (husk: the greens and its ink outline), 1 to 2
   voxels each. Launch them upward and outward, let them bounce once and then **rest on the floor**. Fade them only when the
   room is cleared, or after at least 8 s.
4. **Floor mark:** a FLOOR-oriented splat decal (ichor or `blood`, dithered edge, about 1.5x the footprint) that stays until
   the room ends. The pool already has `rest`, so this is a matter of giving death a long-lived tail, not new systems.
5. Scale all of it by enemy size. The boss version is three times bigger and adds a shockwave ring.

## Problems

1. **Nothing persists.** All four judged effects are fully gone within about 300 to 500 ms
   (`ours/01-hit-spark-strip.png`, `ours/02-death-burst-strip.png`, `ours/03-dash-strip.png`, last frames). The reference
   floor fills with blood, casings and debris as the fight goes on (`ref/01`, `ref/02`, every frame), so the room tells the
   story of the fight. Fix: give `hit` 2 to 4 resting chips that stay for 4 s or more, give `death` a lasting decal and debris
   (see Biggest gap), and leave a faint scuff decal where a dash starts.
2. **Hit flashes merge into one white blob with the hero and the slash.** At contact the enemy's white silhouette, the white
   slash smear and the white damage number overlap into a single shape bigger than the enemy, and the hero's outline is
   swallowed (`ours/04-hit-contact-still.png`, `ours/01-hit-spark-strip.png` frames 5 and 6, `/?scene=run&seed=3` then walk to
   the left husk and press J). The reference flashes only the enemy, and its silhouette stays crisp
   (`ref/04-hit-contact-still.png`). Fix: flash the enemy for 1 frame white, then 1 frame `ink`, keeping its outline. Draw the
   slash smear in a pale cool tint (`sky`), not pure white, and never on the same pixels as the flash. The combat critic
   raised the same issue, so coordinate with `combat`.
3. **The hit spark is too small and the wrong value for the room.** It is a thin gold four-point star plus a 1-pixel ring
   (`ours/01-hit-spark-strip.png`, frame 7). Gold on a torch-lit orange floor has almost no contrast. In the brazier pools,
   where arena fights happen, it disappears. Fix: make the core flare 2 to 3 internal pixels thick and about 0.6x the enemy's
   height, white-hot core with an `ember` rim. Add 4 to 6 directional streaks that are 6 to 10 pixels long along the blow,
   and a 1-frame `ink` outline around the flare whenever it overlaps a lit area.
4. **The dash is barely visible.** The kick-off is a 1-pixel white ring about the size of a foot. The afterimage is one cyan
   dithered ghost, then a dark-blue smear in the hero's own blue that sinks into the violet floor
   (`ours/03-dash-strip.png`, frames 3 and 4). After that there is nothing. The reference lays a long, wide, light dust streak
   over the whole dash path that stays for 3 frames (`ref/03-dash-strip.png`, frames 5 to 8). Fix: spawn a FLOOR-oriented
   dust streak covering the full dash path, `bone` or `stoneLight`, dithered, 3 to 4 voxels wide, fading over 0.4 s from the
   start end. Draw the afterimages in a light value (`sky` and `bone`), not the hero's body blue. Put 3 of them along the
   path, not one.
5. **Effect light disappears in the places where fights happen.** Hits do fire a light (`look.flash`, `torch`/`gold`,
   radius 2.5), but it has the same hue and value as the brazier pools that arena fights happen in, so in
   `ours/01-hit-spark-strip.png` (frames 5 to 7) the floor around the contact barely changes. The death adds no light pop of
   its own (`ours/02`). The reference's flashes are white-hot and clearly brighter than the room's ambient light, so each
   one reads as a new light source (`ref/01-hit-spark-strip.png`, frames 3 and 7). Fix: make the hit light 1 to 2 frames of
   `white`/`bone`, with a tighter radius of about 1.2 and a higher intensity, so it stands out even inside a torch pool.
   Give the kill a bigger `flame` light pop (radius about 3, 120 ms) that matches the starburst.
6. **The damage number is bigger than the effect.** At the kill, the "24" is about twice the size of the spark and covers the
   impact (`ours/02-death-burst-strip.png`, frames 2 and 3). That belongs to the HUD, but it is the loudest thing in the kill
   frame, so it steals the effect's moment. Fix: offset numbers up and away from the contact point by about 1 hero-height,
   and let the vfx burst own the contact frame.
7. **The spawn portal is static.** It appears at full size within one 100 ms frame, then shows the same flat pink spiral for
   about 0.6 s with almost no change, before a good pink flare and ring drop the husk in
   (`shots/critic/vfx/strip/ours-spawn.png`; `/?scene=run&seed=3`, walk up for 0.9 s, the portals open about 1.4 s later).
   It casts no light and draws in no particles. The finish is fine, but the wind-up is dead time. Fix: open it over 4 to 6
   ticks with an overshoot, pull 8 to 12 motes inward along the spiral throughout, and pulse a pink floor light under it.
8. **The showcase death burst does not match its label.** The note says "chunks in the body colours". In
   `/?showcase=vfx&fx=death` the skeleton vanishes in a single frame into a sparse cloud of pale grey specks of 1 to 2 pixels
   that drift off within 0.5 s (`shots/critic/vfx/sc/cg-death.png`). There are no visible chunks and no floor ring that holds.
   Fix: as in Biggest gap.

## must_have checklist

- **Pooled, no allocation per frame, 2000 particles at 60 fps in the showcase:** pass, with a caveat. In
  `/?showcase=vfx&fx=stress` the HUD reads `PARTICLES 2544/4096 ... SIM 0.10MS UPLOAD 0.30MS DROPPED 0`
  (`shots/critic/vfx/sc/stat.png`, real-time run). The particles are one InstancedMesh over typed-array pools in
  `src/vfx/core.js`, with no per-frame `new` in the tick or render path. The FPS here (6 to 11) is SwiftShader's software
  rendering of the whole scene, not the vfx. At 0.4 ms of CPU per frame, 60 fps on a real GPU is very likely, but I could
  not measure it.
- **Every effect uses the palette and snaps to the pixel grid:** pass. Across 10 sampled frames of the death reel
  (`/?showcase=vfx&fx=death&hud=0&ambient=0`), 100% of pixels are exact palette colours (30 distinct colours, palette of 32).
  Effects render at the internal resolution with nearest upscale, and no sub-pixel or smooth edges are visible.
- **Effects have shape and timing (a fast pop then a slow fade), not a uniform spray:** weak pass. The pop is there:
  white silhouette, then a star, then a ring (`ours/01`, frames 5 to 7). The "slow fade" is missing: the tails last 2 to 3
  frames at 10 fps, and the death residue is a few specks. These shapes are what the effects have, but they are too thin.
- **Ambient embers and dust motes available as a scene layer:** pass. `vfx.ambient()` is used by the arena, corridor,
  collapse, boss arena, title and enemy showcase. Motes and brazier embers are visible in every play capture
  (`shots/critic/vfx/play/f-f.png`).

## Console errors

None. Every capture (the showcase reel, the stress entry, real play with combat and dash, key cycling) logged 0 errors and
0 warnings. Key cycling works: Right moves the reel to 2/12 SLASH SMEAR and `5` jumps to 5/12 DEATH BURST
(`shots/critic/vfx/sc/keys/all.png`).
