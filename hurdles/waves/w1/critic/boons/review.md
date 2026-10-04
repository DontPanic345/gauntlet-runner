PIN: https://poncle.itch.io/vampire-survivors | 4.8 stars (1,656 ratings) | the itch roguelite most known for its upgrade loop: pick-1-of-N level-up choices, upgrades that each have a distinct, screen-filling visual, gem pickups that vacuum to the player, and weapon+passive evolutions as synergies; its HTML5 build can be played live

# Critic review: boons (wave 1)

## Reference
**Vampire Survivors** (poncle), https://poncle.itch.io/vampire-survivors, 4.8 stars from 1,656 ratings.
It does every job in this piece: a pick-one level-up screen, about 30 upgrades that each look different
on screen (whip arcs, orbiting bibles, lightning bolts, garlic aura, fire wands), XP gems that drop from
kills and vacuum to the player, and paired upgrades that combine (evolutions). It is the game players
think of when they hear "upgrade choice roguelite". The itch HTML5 build (html-classic.itch.zone/html/5185382)
was downloaded, served locally through a caching proxy, and played live on Playwright's paused fake clock.
To reach the same moments on both sides I exposed its core object (a one-line patch to a local copy) and
used its own debug methods (`SwapToLevelUpScene`, `debug_AddAllWeapons`, `AddWeapon('HOLYBOOK')`, `TurnOnVacuum`).
Ours was driven by `?showcase=boons` (choice demo and `&give=<id>` dummy room) and by `/?scene=run&seed=4`
(enter, `debug.enemies('killall')` twice, walk to the shrine, E, D, J).

## Verdict (not blind)
Split, reference ahead overall: our choice screen is clearly better looking than the reference's plain grey
panel, but in combat our boons are small, same-coloured flecks on top of the base combo, while every
reference upgrade is a big, separate shape you can name from a thumbnail. The judge question is "which
looks more exciting", and pairs 04 to 06 go to the reference.

## Biggest gap
In combat, the boons do not read. Give each boon one big, unique, hero-scale silhouette in its own colour
that persists for at least 300 ms, sized at gameplay zoom (zoom=1), not at showcase zoom 2:
EMBER ORBIT embers become 3x3-voxel fireballs with a 4-frame flame trail on a ring of radius 2 tiles (today
two 1-2 px yellow squares hugging the hero); CHAIN SPARK becomes a 2 px-thick jagged bolt with a white core and
a cyan halo plus a flash on each struck foe; MOON WAVE becomes a crescent at least as wide as the hero is tall
that travels 6+ tiles; LEECH motes become 3 px red droplets with a trail that pop into the heart HUD;
KEEN EDGE crits get a gold full-body flash on the foe and a larger gold number; HEAVY HAND's quake becomes a
visible cracked-floor ring of debris; FLEET FOOT shows wind streak lines behind the hero while moving.
Then re-capture `?showcase=boons&give=<id>&zoom=1&hud=0` per boon and check that each frame strip is
recognisable without the boon's name on screen.

## Problems
1. **Boons are nearly invisible at play scale and look like each other.** `shots/critic/boons/f-orb.png`,
   `g-leech.png`, `g-heavy-hand.png`, `g-keen-edge.png`, `g-fleet-foot.png`, `h-all1.png` (zoom 1).
   With `?showcase=boons&give=ember-orbit`, the only sign of the epic boon is two tiny yellow squares near the hero
   (`hurdles/waves/w1/critic/boons/ours/04-...png`). LEECH, HEAVY HAND, KEEN EDGE and FLEET FOOT strips are
   almost frame-for-frame identical to the plain combo: the same white slash, the same gold star ring, the same
   white ring on the third hit. The reference's King Bible (`ref/04-...png`) is four big blue books
   orbiting at three hero-widths, impossible to miss. Why it hurts: the goal is "you can SEE them work", and
   picking a boon does not change what the screen looks like. Fix: see Biggest gap; also give every boon its
   own colour from the palette (card `color` already exists: gold, sky, flame, red, cyan, rose) and use only
   that colour for its effect, so effects stop collapsing into white and gold.
2. **With many boons the screen turns to mush instead of a power fantasy.** `ours/05-...png` (`give=all`):
   overlapping white slashes, rings, floating labels ("CRIT! WILDFIRE", "FULL", "BLOCKED", "DODGE") stack on
   the hero, and you cannot tell which effect is which. Reference `ref/05-...png`: each weapon occupies its
   own space (whip horizontal, bibles orbit, fire rains, lightning strikes far away, garlic aura) and the
   screen fills outward from the player. Fix: push effects away from the hero (orbits at radius 2+, moon
   waves travel, storm bolts land at range, starfall from above), cap floating text to one label at a time
   per foe, and drop the "FULL" label for leech at full health.
3. **Choice screen blacks out the world.** `shots/critic/boons/run3-o.png` row 2, frames o-07 to o-09
   (in normal play after E at the shrine): for about 200 ms the screen is nearly pure black with a few stray
   dots, then card backs appear. The reference pauses over the live scene. Why it hurts: the moment loses
   its link to the room and the hero; it reads as a scene cut. Fix: dim the room to about 35% with the
   dither instead of black, keep the hero and shrine visible, and start the first card back flying in on the
   first dark frame.
4. **Unselected cards lose their art.** `run3-o.png` rows 4 to 6, and `ours/03-...png`: when STORM DASH is
   highlighted, the FLEET FOOT and BULWARK icon disks go empty and their names dim, so you cannot compare
   the three offers at a glance. Fix: keep every card's icon and title fully drawn; mark the selection with
   lift, scale, frame glow and the corner brackets only.
5. **Common cards are visually identical.** `ours/01-...png`: two COMMON cards in the same grey frame with
   the same layout; only the icon differs, and the icons are small (about 50 px of a 280 px card). Fix: tint
   each card's art panel with the boon's own colour, double the icon size, and put a one-line mini-preview
   of the effect (a 3-frame looping vignette) in the empty lower third of the card, which is now blank
   between the text and "NEW".
6. **Pickups are specks.** `ours/06-...png` (normal play, after the clear): soul shards are 2 to 3 px cyan
   dots that are hard to follow at full screen; the counter top right ticks up but the flight is invisible.
   The reference's gems (`ref/06-...png`) are larger, brighter and stream toward the player as a visible
   line. Fix: make shards a 3x5 px crystal with a 1 px white highlight and a 3-frame trail while pulled, and
   add a small pop-and-flash on the player plus a tick bump on the HUD counter for each one absorbed.
7. **The pick moment ends on a white rectangle.** `shots/critic/boons/tk-flick.png` frame 1: the chosen card
   is a flat white slab for one frame. It reads as a missing texture rather than a flash. Fix: flash the
   card's frame and art panel to the boon colour and white over 2 frames, keeping the outline and icon
   visible.
8. **Shards have nothing to buy** (HUD counter only). Out of scope to judge visually, but a currency with no
   sink makes the satisfying pickup meaningless; at least show it on the shrine (reroll cost) so it matters.

## must_have checklist
- **Every boon changes something you can SEE in combat, not just a number: FAIL.** Strips for all 16 in
  `shots/critic/boons/g-*.png`. MOON WAVE, STARFALL, STORM DASH, EMBER TRAIL, BULWARK and the synergy labels
  are visible at zoom 2; LEECH, HEAVY HAND, KEEN EDGE (apart from "CRIT!" text), FLEET FOOT and SOUL HUNGER are
  indistinguishable from no boon in the strips, and EMBER ORBIT is two specks. At zoom 1 (real play scale,
  `h-all1.png`) almost nothing reads.
- **The choice screen is a moment: cards animate in, hover and select feel tactile: PASS (with problems 3, 4, 7).**
  Card backs fly in, flip to reveal the face, a shine sweeps the highlighted card, the taken card bursts with
  rays and flies into the hero, and a "STORM DASH" banner shows on return (`run3-o.png`, `cards-in.png`).
- **Pickups vacuum toward the player with a sound ladder: PASS on motion, sound unheard.** After the clear,
  shards fly to the hero and `debug.boons().pickups` reports `vacuum:true, ladder:14, shards:15`. The pitch
  ladder could not be heard by me.
- **Synergies exist between at least 4 pairs of boons: PASS.** Six are defined (THUNDERHEAD, WILDFIRE, TWIN MOONS,
  HARVEST, LIGHTNING ROD, SOLAR FLARE); `give=all` lists all six active; cards show "PAIRS WITH CHAIN SPARK";
  WILDFIRE labels appear in combat (`f-all.png`).

## Console errors
None in any of our captures (showcase choice, 16 single-boon rooms, `give=all`, three normal-play runs).
Reference: one certificate error from its itch analytics script, which is irrelevant.
