PIN: https://maddymakesgamesinc.itch.io/celesteclassic | 4.69 stars (1,000+ ratings) | the best-known top-rated HTML5 trap gauntlet: spikes and crumbling blocks laid out in readable screens that reward precise dashing, which is exactly this piece's job

# Critic review: gauntlet (Gauntlet corridors), wave 1

## Reference

**Celeste Classic** by Maddy Thorson and Noel Berry (https://maddymakesgamesinc.itch.io/celesteclassic). It has a 4.69 average from
1,000+ ratings (the page caps the count display), and it is HTML5, so it can be played live.

**Why it is the right comparison:** the piece hint asks for "a chase or escape sequence, or trap-gauntlet platforming". Celeste Classic is the
canonical trap gauntlet on itch. Every screen is a short run of spikes, crumbling blocks and gaps, and you cross it with a dash. That is what our
`goal` asks for ("traps ... laid out in readable rhythms that reward dashing"). Each dash is unmistakable: the hair changes colour, it leaves a
trail and the screen kicks. I looked for a highly rated HTML5 game built around a chasing wall. The candidates I could verify (lava-jam entries,
"Dread Chase", "Lava Only Up") all have only a handful of ratings. itch's listing pages return 403 or a Cloudflare challenge to curl and
WebFetch, so I could not browse further. The reference has no chasing wall, which works in our favour on the "chase" half of the question.
Keep that in mind when you read the blind result.

**How it was captured:**
- **Reference:** I downloaded the build (`html-classic.itch.zone/html/235259/Celeste/`) to `shots/critic/gauntlet/cel/` and served it
  locally. It ran under Playwright's paused fake clock (`shots/critic/gauntlet/clk.cjs`). The route was scripted with keys and found by iteration
  (`shots/critic/gauntlet/cel.py`, runs t4/t5). Frames were taken every 100 ms of game time.
- **Ours:** `/?showcase=gauntlet&seed=1&hud=0` (the demo pilot) and `/?scene=run&seed=4` with `__GR.debug.corridor('go', n)`, on the same
  fake-clock driver, 100 ms per frame. Our panels use a fixed 720x720 crop at the left of the 1280x720 view, so they match the reference's square
  aspect and the collapse front stays in frame. The hero is about the same fraction of screen height on both sides.

Pairs: 01 crossing spikes (12-frame strip), 02 dashing past a hazard (strip), 03 killed by a hazard (strip), 04 a mid-section still.

## Verdict (not blind)

**The reference is better as a trap gauntlet**, and ours is only more spectacular when you play slowly. Ours has a wall of fire behind the hero,
which the reference cannot match. But our traps are murky and their danger states are hard to read. The dash lets you ignore the traps. And once
you play well, the collapse falls off screen and the tension goes with it.

## Biggest gap

**The chase only exists for a player who plays badly. Make the traps hold up a dash-spammer, and keep the collapse in frame.**

What I saw: on `/?scene=run&seed=4`, `__GR.debug.corridor('go',1)`, I held D and pressed K every 400 ms. That cleared the whole corridor in
6.5 s (392 ticks). The run logged 21 "DODGE"s through raised spikes and 3 hits from fire jets, which is not enough to stop the run. The
collapse ended **33 units** behind, well off screen from the second second on (see `shots/critic/gauntlet/rush.png`). The only sign of it is a
small orange "< 22" at the left edge. The collapse "eases" to its floor of 3.2 u/s (down from 3.5) while that happens.

What to do:
1. **Dashes must not phase through traps.** Dash i-frames should not apply to spikes, fire jets or blades (keep them against enemies). A raised
   spike block (about 3.5 units deep) must be wider than one dash, so the only way across is to time the gap. The reward for dashing should be
   crossing a warn-phase gap the instant it opens. Give it a "perfect" flash and a small bonus, such as pushing the collapse back 1 unit, instead
   of free passage.
2. **Clamp the lead.** When the gap is more than about 9 units, have the collapse surge to close it to about 7, rather than letting it drift to
   33. A brief rumble spike and a "the ceiling surges" camera kick would sell it. "Eases if far ahead" should mean it stops accelerating at
   about 6–8 units, where it is still on screen and visibly roaring. It should not mean "goes away".
3. **Frame it.** Bias the camera so the collapse front sits in the left 20–25% of the screen whenever it is within about 12 units. When it is
   farther back, swap the tiny "< 22" for a full-height ember glow and a debris spray on the left edge that grows as it approaches.

## Problems

1. **The traps don't hold the player, so the chase evaporates** (see Biggest gap). Evidence: `shots/critic/gauntlet/rush/` r00–r15 and the eval log
   (gap 7.6 → 33.2 units, 21 dodges, 3 hurts, cleared in 6.5 s). The piece's whole identity is "the tensest part of the run", and a skilled
   player never sees the threat.

2. **The spike danger states are inverted and hard to read on first sight.** In the spike weave (`?showcase=gauntlet&seed=1&overlay=1`,
   `shots/critic/gauntlet/ovl/end-01.png`), each half-lane has three looks:
   - grey spikes on a grey-violet grid: **raised, deadly**;
   - a red-outlined red and black checkerboard: **warning, safe for now**;
   - a flat yellow and red checkerboard fill: the flash as they rise (`shots/critic/gauntlet/demo1/demo-08.png`).

   The loudest colour marks the safe state. The deadly state is the lowest-contrast thing on screen. The yellow checker fill looks like a debug
   texture, not like spikes punching up. The warning comes 0.2–0.7 s ahead ("IN 0.2S" in the overlay), which is short for a first sight.

   **Fix:** make raised spikes bright: pale steel tips with an ember-red base glow and a 1-texel dark outline. Make the warn state subtle but
   animated: tips poking 1 voxel up, rattling, with dust puffs and a rising tick sound, for at least 0.5 s. Animate the rise itself: 2 frames of
   spikes shooting up past full height, then settling. Drop the flat checker fills entirely.

3. **The collapse reads as a static curtain of noise, not a falling ceiling.** In every frame of `shots/critic/gauntlet/o1-all.png` and
   `hurdles/waves/w1/critic/gauntlet/ours/0*.png`, it is the same full-height band of near-black cubes at the left edge, with ember specks and
   grey cubes at the foot. Nothing visibly falls from the top of the frame, and there are no vertical streaks. No dust front rolls along the
   floor ahead of it, and nothing cracks or drops in the corridor ahead to warn you. It is also nearly the same colour as the dark wall
   behind it.

   **Fix:**
   - Spawn chunks above the top of the screen, 1–3 voxels across, falling fast with 2–3-frame smear trails, each landing with a dust puff and a
     bounce.
   - Run a low dust wave along the floor, 1–2 units ahead of the front.
   - Drop pebbles and dust trickles 3–5 units ahead, and draw a crack line on the ceiling or back wall racing ahead.
   - Give the front edge an ember-lit rim (#ff7a2f) so its silhouette separates from the wall. Let the silhouette lurch, bulging forward
     unevenly, instead of moving as a flat vertical line.

4. **The swinging blades read as sliding pistons.** Seen from the fixed camera, the blade swings along the depth axis. It shows as a dark disc
   on a rod that slides up and down the screen, with a red bar on the floor (`shots/critic/gauntlet/blades.png`, bottom rows, and
   `demo1-b.png`). There is no arc, no blur and no glint, and nothing marks the dangerous end of the swing. **Fix:** swing the blades across the
   corridor's length (along x) so the arc is visible from this camera. Add a 2-frame motion smear and a bright edge glint at the bottom of the
   swing, and draw the floor shadow as an arc-shaped sweep that brightens as the blade passes.

5. **Low contrast everywhere.** Our hero is dark navy on a dark violet floor. Traps are dark grey. The corridor is lit by four dim torches. In
   pair 02 the hero is hard to find in several frames (`hurdles/waves/w1/critic/gauntlet/ours/02-dash-past-hazard.png`, frames 2, 3 and 9). The
   reference reads at thumbnail size: a red-haired player on black, white spikes on blue. **Fix:** give the hero a rim light, or a light
   floor-pool under them, in every corridor. Raise floor value contrast between tiles and hazards. Keep hazard states on a strict ramp:
   neutral, then warn, then lethal, each brighter than the last.

6. **Stacked "DODGE" text spam.** A dash through a trap row stacks up to four "DODGE" labels (`shots/critic/gauntlet/rush/r07.png`). This
   clutters the action and means nothing to the player. **Fix:** show one tag per trap crossed and merge repeats ("DODGE x3"). Better still,
   replace it with an in-world flash on the trap the player beat.

7. **Being caught is anticlimactic to watch.** In normal play, once the collapse reaches the hero, the screen dims and the hero disappears into
   the noise. The next 1.5 s are cubes jittering over where the hero was, then a shatter wipe (`shots/critic/gauntlet/o2-sheet.png`, rows 2–4).
   You never see the hero being hit or buried. **Fix:** on catch, add 80 ms of hitstop on a frame where the hero is clearly lit and a rock is
   visibly landing on them. Show a white flash silhouette, then cut to the shatter within about 0.6 s.

8. **No grace at the corridor entrance.** If you stand still, the collapse kills you about 1.5 s after "RUN!" (`/?scene=run&seed=4`, `__GR.debug.corridor('go',0)`, no
   input: caught at 3 s after `go`, `shots/critic/gauntlet/idle.png`). The hero spawns with the collapse already on screen while the title card
   is still up. That is fine for tension, but a first-time player reading the card gets killed. **Fix:** hold the collapse until the player's
   first input, or give 2 s after "RUN!", and show it rumbling in place, already on screen, during that window.

9. **The gate slam release is good but buried.** The gate drops with yellow chevrons, "SAFE" appears, the rock piles against the gate and the
   rumble stops (`shots/critic/gauntlet/ovl-c.png`). But ember debris fills two-thirds of the screen, so the hero and the gate are hard to pick
   out (`ovl/end-34.png`). **Fix:** pan the camera so the gate sits left of centre and the hero right of it. Darken the rubble side once the gate
   shuts, and give the safe side a cool, quiet light so the release reads as a change of mood.

## must_have checklist

| Item | Result | Evidence |
|---|---|---|
| The collapse is spectacular: falling voxels, dust, rumbling shake, ember glow | **Fail (partial)** | Ember glow and a dense voxel mass are present, and shake is on the shared channel. But nothing reads as *falling*: there is no top-of-frame rockfall and no dust front. It is a static band in every strip (`o1-all.png`), and in skilled play it is off screen (`rush.png`). |
| Every trap telegraphs its timing and is fair on first sight | **Fail** | Spike states are inverted (the warn state is loud red, the deadly state dull grey), and the warning is 0.2–0.7 s (`ovl/end-01.png`). Blades read as vertical pistons (`blades.png`). The fire jets are fine: the skull nozzle glows before it fires (`ovl/end-21.png`). |
| Tension ramps: the collapse speeds up if you dawdle and eases if you are far ahead | **Pass (technically), weak in feel** | Dawdling works: after a 9.6-unit lead and stopping, speed went 3.7 → 6.3 u/s in about 1.5 s and the hero was caught (`daw` eval log). Easing goes only to a 3.2 floor while the gap reaches 33 units, so a lead removes the threat instead of tempering it. |
| Reaching the end has a release beat: door slams, the rumble stops | **Pass** | The gate drops, "SAFE" appears, the collapse speed goes to 0, rock piles against the gate and the "THE GAUNTLET HOLDS. THE STAIR GOES DOWN." line plays (`ovl-c.png`, `ovl/end-39.png`). The composition is cluttered (Problem 9). |

The showcase works as specified: `?showcase=gauntlet&seed=N` plays one corridor start to finish, and T (or `&overlay=1`) shows per-trap
timing bars plus the collapse speed, gap and dawdle readout.

## Console errors

None. Every capture (showcase, overlay, normal play in corridors 0, 1 and 3) logged 0 errors and 0 page errors.
