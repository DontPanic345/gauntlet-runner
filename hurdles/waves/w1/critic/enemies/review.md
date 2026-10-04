PIN: https://playwithfurcifer.itch.io/furcifers-fungeon | 4.7 stars (126 ratings) | top-down pixel-art action roguelite (itch tags roguelite, bullet-hell, pixel-art; on the top-rated bullet-hell list) with a large, loud, characterful enemy roster that telegraphs with flashes and poses and dies in big bursts; HTML5 (Godot), so it can be played live

# Critic review: enemies (Enemies), wave 1

## Reference

**Furcifer's Fungeon** by Play With Furcifer, https://playwithfurcifer.itch.io/furcifers-fungeon. Its page shows
"4.69 average rating from 126 total ratings" (checked today). It is on itch top-rated under `tag-bullet-hell` and is tagged
roguelite and pixel-art.

**Why it is the right comparison:** it is a top-down pixel action roguelite fought room by room, and its enemy cast is
what it is known for: wasps, mushroom men with pitchforks, pop-up flower turrets, bees, slimes and ghosts, each with its
own silhouette, colour and attack tell. It runs in the browser, so I played it live instead of judging marketing GIFs.
**Candidates I rejected:** Gaunt Valkyr (4.9 from 94, pinned for look and vfx) has only GIFs, and its enemies are small
shooters seen at GIF quality. Its strength is juice, not the cast. Bright Lancer (4.5 from 140) is HTML5, but its early
enemies are tiny beetles, which is an easier bar. Nuclear Throne (4.7 from 511) has only stills. Lucah, Unsung Warriors and
Berserk Survivor are not HTML5. Enter the Chronosphere (4.8 from 62) is HTML5 but a bullet-hell shooter with mostly
abstract enemies.

**How it was captured:**
- **Reference:** the Godot build (`html-classic.itch.zone/html/8189862/`), downloaded to the scratchpad and served locally,
  because Chromium rejects the proxy certificate for itch's CDN. I drove it with a long-lived Playwright session
  (`shots/critic/enemies/live.cjs` and `lc.sh`) at 960x540, played the tutorial, walked into the first forest room, and
  fought with the mouse (the game is mouse-aimed). For the strips I switched to Playwright's paused fake clock and
  stepped 100 ms of game time per frame, the same as ours.
- **Ours:** real play at `/?scene=run&seed=3` (arena 1), with enemies placed via `__GR.debug.spawn` and the hero driven by
  keyboard, using the fake-clock driver `shots/critic/enemies/clk.cjs` at 1280x720. Panels are cut so the enemies are
  about the same fraction of the panel height as the reference's (ours 640x360 windows of the 1280 frame, theirs 480x270
  of the 960 frame; ours cast still is a 960x540 window, theirs the full 960x540 frame).
- **Fairness:** both sides are live frames, 10 fps, 8 frames per strip. The reference has a spell-casting hero whose
  lightning fills a lot of its frames. The criteria tell the judge to ignore player effects. The reference's tutorial
  also shows a dialogue banner, so I used only frames after it. Ours pair 01 shows the wave banner, as it is in play.
  The showcase lineup (`?showcase=enemies`) is reviewed below but not used in the packet, because the reference has no
  equivalent screen.

Pairs: `01-cast-in-a-fight-still`, `02-telegraph-strip` (ours: Brute charge; theirs: wasp rears and flashes, then lunges),
`03-death-strip` (ours: Husk; theirs: bee), `04-hit-reaction-strip`.

## Verdict (not blind)

**The reference is better.** Ours has the stronger telegraph *system* (the Brute's charge lane and the red-to-yellow ground
markers are clearer than anything the reference draws on the floor), but in play our enemies are dark, low-contrast and
small inside a dark violet room, while the reference's cast is bright, thickly outlined and full of personality, and its
deaths are bigger.

## Biggest gap

**In play, our enemies do not separate from the floor. Lift their values and give each one a bright signature accent and
a hard outline.** In `ours/01-cast-in-a-fight-still.png` the Husk is dark olive on dark slate, the Brute is plum on a
violet floor (and sits on a brazier, so its top half melts into orange light), the Wisp is orange inside a torch pool,
under the wave banner, and only the cyan Mites pop. In `ref/01` every enemy is saturated and light-valued, with a 1 px
near-black outline and a white specular edge, against a mid-value green floor. It reads at thumbnail size, and ours does not.

Concretely, in `src/enemies/models.js` (and the palette, if a slot is missing):
1. **Husk:** move the body from the dark moss greens to `leaf` as the main mass, with one lighter green on the top faces
   (head, shoulders, arms). Make the eyes the brightest pixels on screen for it (2x2 `gold`/`bone`, unlit). Keep the dark
   moss only as the AO and the underside.
2. **Brute:** make the main mass a lighter `rose`/`plum` and the horns and fists `bone`. Give the central maw a 1-voxel `ember`
   glow ring so its face reads from across the room. Today the face is a black hole on a dark-red box.
3. **Ember Wisp:** it shares the torch hue, so it vanishes in brazier pools (`shots/critic/enemies/play-wisp-strip.png`,
   frames 1 to 12). Give it a cool core: a `white`/`sky` centre with an `ink` 1 px ring, and keep the flame as the outer
   layer. Make its orbs a different colour from torch light (white-hot core with a `rose` or `plum` rim) so a projectile is
   never mistaken for an ember.
4. **All four:** draw a screen-space 1 internal-pixel `ink` outline around the enemy silhouette, on the enemy layer only,
   so it survives against dark floor. Today the voxel edge AO gives only a partial dark edge that disappears on the slate.
   Add a 1-pixel light rim on the top/left faces (`bone` at about 50% dither) for the same "sticker" separation as the reference.
5. **Contact shadow:** a darker, 1-voxel-larger `ink` blob shadow under every enemy (the hero already has one), so floating
   enemies (the Wisp) and dark ones (the Husk) are anchored.

Check: a 320x180 downscale of `/?scene=run&seed=3` arena 1 wave 2 must show each enemy as a distinct, light blob against
the floor.

## Problems

1. **Low value contrast in play** (see Biggest gap). `ours/01-cast-in-a-fight-still.png`, `shots/critic/enemies/play-spawn-mix.png`.
   The showcase lineup, at zoom 2 on a neutral strip of floor, makes the cast look better than it does in a lit arena.
2. **The Wisp is camouflaged by torch light, and its attack tell is a thin dotted red line.** In
   `shots/critic/enemies/play-wisp-strip.png` (frames 18 to 26), the Wisp hovers next to the left brazier. Its windup is a
   1 px dotted red line to the hero, and the orb is an orange ball on an orange-lit floor. On a thumbnail you cannot tell the
   Wisp is about to fire. Fix: during the 42-tick windup, swell the Wisp by 20% and pulse its core white at 6 Hz. Draw the aim
   line 2 px wide, solid, in `rose` with an `ink` edge, growing from the Wisp toward the hero over the windup. Keep its kiting
   destinations out of brazier light (treat the lit radius as a soft avoid zone), and keep it out of the top band where the
   wave banner is drawn.
3. **Husk and Mite tells in play are small and late.** In `shots/critic/enemies/play-husk-windup-strip.png` (last row), the
   Husk's red wedge appears only about 2 frames (200 ms) before the hit, under the hero's feet, where the hero's body covers
   it. The Husk's own pose barely changes. Fix: start the marker at the start of the windup (30 ticks), place it in front
   of the Husk (not centred on the hero), and give the Husk a readable anticipation pose: arms raised above the head and the
   torso tilted back 15 degrees, plus a 2-frame white eye flash at windup start. The lineup's raised-arms pose
   (`shots/critic/enemies/lineup-attack-strip.png`, frames 5 to 8) is right. Make the in-play windup show the same thing.
   Mites: the red hop rings are fine in the lineup, but in a crowd five overlapping rings read as one red mess. Give each
   Mite a 1-voxel body crouch plus a white flash, and draw only the ring of the Mite that holds an attack token.
4. **Deaths are smaller and dimmer than the reference's.** `ours/03-death-strip.png`: the Husk flops, flashes one yellow
   disc, then shrinks into a ring and a few dark-green specks that are almost floor-coloured. In `ref/03` the bee bursts
   into a cloud of saturated red pieces about twice its size that scatter and settle. Fix (with `vfx`): the death debris
   should use each archetype's *lightest* colours (Husk `leaf`, Brute `rose`/`bone`, Mite `cyan`, Wisp `flame`/`gold`),
   12 to 20 chunks of 1 to 2 voxels, thrown 1 to 1.5 enemy-heights out, landing and staying for at least 8 s. Make the Husk's
   flop last 6 to 8 frames on the floor before it shatters, so the "flop" is visible. Today it shatters about 2 frames
   after it lands.
5. **Hurt reaction is a white blob that hides the enemy.** `ours/04-hit-reaction-strip.png`, frames 2 and 6: the Husk becomes
   a solid white shape larger than itself, merged with the hero and the slash, and on the next frame is back to normal.
   In `ref/04` the enemy keeps its silhouette, tints, and is knocked back. Fix: 1 frame white, 1 frame `ink` or
   archetype-tinted, outline kept. Squash the enemy 20% along the hit direction for 3 frames. The knockback distance on
   normal hits should be visible (at least 0.25 units). The combat and vfx critics raised the same issue.
6. **Characterful animation is thin at play scale.** The reference's enemies all bob, flap or squash in idle. Ours have idle
   motion in the lineup, but at play scale the Husk's shamble and the Brute's stomp are 1 to 2 px of movement
   (`shots/critic/enemies/play-spawn-mix.png`). Exaggerate: Husk head bob of 2 voxels and an arm swing of 30 degrees; Brute
   body drop of 2 voxels on each stomp, with a dust puff; Mites leg flicker plus a 1-voxel hop every 0.4 s while moving.
7. **The Brute's tell is all floor, and no body.** The charge lane (`shots/critic/enemies/play-brute-lane.png`) is the best
   telegraph in the game, but the Brute itself only turns. Add a crouch (body down 2 voxels, fists back) and a flashing
   `ember` maw over the 50-tick windup. Also, the lane outline is a stair-stepped polygon when it is diagonal. Draw it as a
   rasterised line in the low-res pass, or snap it to 8 directions, so the edge is clean.
8. **The Brute stood overlapping a brazier pillar** (`ours/01-cast-in-a-fight-still.png`, top right;
   `shots/critic/enemies/play-spawn-mix.png`, frames 3 to 6). Whether this comes from collision or from my debug spawn
   position, the result is an enemy half lost in torch light. Check that the Brute's radius (0.58) is respected against
   brazier props.
9. **Showcase lineup layout bugs.** At `?showcase=enemies&zoom=1` the blurbs collide into one line ("SHAMBLING
   CHASERRANGEDCHARGES, STUNS ITSELF..."): `shots/critic/enemies/lineup-zoom1.png`. At the default zoom 2, the Mite swarm
   is cut off at the right edge and overlaps the Brute (`shots/critic/enemies/lineup-zoom2.png`). Fix: space the slots by
   the widest label, or wrap blurbs at the slot width, and fit the four slots to the view width at every zoom.

## must_have checklist

- **Every attack has a telegraph readable before it hits: PASS (weak for Husk and Wisp in play).** The Brute's charge lane
  fills red then yellow for about 0.8 s (`shots/critic/enemies/play-brute-lane.png`, `ours/02-telegraph-strip.png`), and its slam
  has a ring. In the lineup, every archetype shows a marker that ramps red to yellow before landing
  (`shots/critic/enemies/lineup-attack-strip.png`). In play, the Husk wedge shows late and under the hero, and the Wisp line
  is faint (problems 2 and 3).
- **Enemies never stack into one blob; separation and flanking: PASS.** In a wave of 2 Husks, a Brute, a Wisp and 5 Mites,
  the Mites ring the hero at about 1.8 units and the Husks come from different sides (`ours/01`,
  `shots/critic/enemies/play-spawn-mix.png`). `__GR.debug.enemies()` shows separate slot angles and an attack-token cap of 3.
  No two enemies overlapped in any frame I took.
- **Deaths are satisfying: burst, flop or shatter, never just vanish: PASS, but below the reference.** Every archetype
  flops or shatters and leaves debris (`shots/critic/enemies/lineup-death-strip.png`, `ours/03-death-strip.png`). The debris is
  dark and small, though, and fades (problem 4).
- **Difficulty knobs (hp, speed, aggression) are data, not code: PASS.** `src/enemies/data.js` holds `ENEMY_DATA` per
  archetype and the global `DIFFICULTY` multipliers (hp, speed, aggression, damage). `__GR.debug.enemies('data')` returns
  them, and `('tune', ...)` and `('difficulty', ...)` edit them live.

## Console errors

- Ours: none, in any run (showcase lineup, every `&phase=`, `&fight=husk|wisp|brute|mites|wave`, and `/?scene=run&seed=3`
  with spawns). Every `console.log` reported 0 errors.
- Reference: a failed WebSocket to its leaderboard server (certificate rejected by the capture proxy) and one 404 for a
  missing optional file. Neither came from the game itself.
