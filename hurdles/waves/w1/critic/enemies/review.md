PIN: https://flanne.itch.io/10-minutes-till-dawn | 4.8 stars / 744 ratings | Top-rated, browser-playable pixel-art action roguelite (#7 in itch's top-rated HTML5 roguelites) whose horde enemies are the genre's benchmark for reading instantly at a tiny size: dark bodies, glowing eyes, one bold hit flash and a splat. It is the only top-rated action roguelite on itch that can be played live here, so its enemies can be captured in real motion.

# Critic review: enemies (wave 1)

## Reference

**10 Minutes Till Dawn** by flanne (https://flanne.itch.io/10-minutes-till-dawn), 4.8 stars
from 744 ratings. It is the same pin as `hero` and `vfx`. I captured it live from its HTML5 build
(`html-classic.itch.zone/html/5833734/10MinutesTillDawnWebGL/index.html`), using a canvas
MediaRecorder driver that plays automatically. The recording was sampled at 10 fps.

How I chose it, and what I rejected:
- **Furcifer's Fungeon** (4.7 / 126, HTML5) has the richer and more characterful roster (mushroom
  pitchfork men, bees, fire maws, dashed-line aim telegraphs, ground-circle tells). I tried hard to
  use it. Headless SwiftShader runs its Godot build so slowly that four driven runs of about 7
  minutes each never got past the tutorial, and tutorial progress does not persist. Comparing
  against its tutorial slimes would have been unfair to it, so I did not use it.
- **Bright Lancer** (4.5 / 140): the driver cannot get past the airship start area, so no
  enemies could be reached. The `vfx` critic hit the same wall.
- **Nuclear Throne** (pinned for `look`): the best roster in the genre, but it has no browser
  build and no GIFs, so motion cannot be captured.
- The Lair, Curse of the Lich King, and NIMRODS were rejected as a side-view brawler, a
  turn-based game, and a gun-crafting shooter respectively.

A fairness caveat to record: in the first 30 s the reference shows mostly one enemy type (the
tentacled brain monster). So the reference wins or loses on readability and craft, not on
variety. Ours has four distinct archetypes on screen, which is a real advantage on "varied".

Packet: 4 pairs. 01 is a gameplay still of the cast around the player, 02 is a close still of
the cast, 03 is a 12-frame strip of an enemy attacking the player, and 04 is a 12-frame strip of
an enemy death. Both sides are at about 10 fps. The frames are cropped so enemies appear at
roughly the same size. Ours was captured with `debug.freeze` / `debug.step(6)`.

## Verdict (not blind)

The reference wins on readability, though not on character. Its enemies separate from the floor
and from the hero in every frame. Ours have more personality and better telegraphs on paper, but
in play they turn into a single voxel heap on top of the hero.

## Biggest gap

Enemies do not keep a visible personal space. They visually overlap each other and the hero, so
in real play the cast collapses into one grey-green-red lump and the telegraphs are drawn
*under* the hero, where they cannot be seen. The collision radii in `src/enemies/data.js` (husk
`r: 0.3`, mite `r: 0.17`, brute `r: 0.5`) are about half the rendered voxel footprint. Separation
therefore "works" numerically (I measured 0 collider overlaps after the crowd settled) while the
models interpenetrate on screen (`evidence/play-heap-over-hero.png`,
`evidence/play-crowd-sequence.png`, `evidence/mite-pile-on-hero.png`).

The fix has three parts:
1. Set each archetype's separation radius to its rendered half-width. For the husk that is about
   0.5 to 0.55, for the brute about 0.8, and for mites about 0.3. Keep a separate, smaller
   `hitR` for damage if needed.
2. Add a minimum standoff from the hero equal to hero radius plus enemy radius, so a husk
   attacks from arm's length and never stands inside the hero sprite.
3. Draw telegraph decals (husk arc, brute lane, mite spot) *after* the characters, with depth
   test off, or at least on top of the hero. Then the tell stays visible when it overlaps the
   player, which is exactly when it matters.

## Problems

1. **The crowd becomes one blob, and the hero disappears under it.** To reproduce:
   `/?scene=run&seed=3`, hold S for 1.8 s, then `debug.god(true)`, then spawn 4 husks, 2 brutes,
   2 wisps and 5 mites around the hero. Within about 1 s, husks, a brute and mites are drawn on
   top of each other and on top of the hero, a pile of green and grey voxels in which the hero
   cannot be found (`evidence/play-heap-over-hero.png`, `evidence/play-crowd-sequence.png`
   frames 2 and 4). Pair 01 of the packet shows the same thing in a milder form. This fails the
   `must_have` "never stack into one blob" as the player sees it, and it is the main reason we
   lose on readability. Fix: see Biggest gap.
2. **Telegraphs are hidden by the hero at the moment they matter.** Husk: the red arc is drawn
   on the floor under the hero, and only its tips show on either side of the hood
   (`ours/03-enemy-attack-strip.png` frames 4 to 10, and the full-resolution
   `evidence/husk-arc-under-hero.png` from `?showcase=enemies&fight=husk&bot=0&hud=0`). Brute: the red charge
   lane runs straight under the hero, and the hero sprite covers the lane where it matters most,
   right at the impact point (`evidence/brute-charge-lane-under-hero.png`). Fix: draw telegraph
   decals over the characters, or outline the part under the hero. Make the husk's arc a filled
   wedge that brightens as it charges, not a one-pixel outline.
3. **The husk's windup "flash" is a muddy brown, not a danger colour.** During the windup the
   whole husk tints flat tan/brown (`ours/03-enemy-attack-strip.png` frames 7 to 10), which
   reads as "turned into cardboard" rather than "about to hit". GAME.md reserves ember orange for
   danger. Fix: flash the husk with a 2-frame white pop at windup start, then pulse the rim or
   eyes ember orange (#ff7a2f) with the arc. Leave the body colour alone so the silhouette still
   reads as the green husk.
4. **The Brute is not brute-sized.** In the lineup (`evidence/lineup.png`) the brute is a grey
   slab about as tall as the hero, only wider, and it is the same slate grey-violet as the floor
   tiles. Seen from the three-quarter camera it reads as a rock or crate, not a charging monster.
   Its only features are two dim red eye dots. Fix: raise `scale` from 0.72 to about 1.0 to 1.1,
   so it stands clearly taller than the hero (about 1.5 times). Give it a head-down horned
   silhouette and a warm accent (glowing chest or eyes) so it separates from the slate floor. A
   brute must be identifiable from the thumbnail.
5. **The Husk silhouette is a sprawled bundle from this camera.** At rest (`evidence/lineup.png`,
   and pair 02) the husk lies at a diagonal with its arms out, and it reads as a crumpled
   green-brown shape rather than a standing shambler. Only its yellow eyes say "creature". Fix:
   keep the torso upright in idle and walk, and give it a clearer head separate from the
   shoulders (a darker neck gap). Keep the lurch in the walk cycle, not in the rest pose.
6. **Brute "stuns itself on walls" is not what the showcase shows.** In the reel and in
   `fight=brute&bot=0`, the brute charges into the hero, stops at the hero's feet, and plays its
   stun there for about 2 s (`evidence/brute-fight-grid.png` rows 3 to 5). The hero's combo then
   lands on it while it sits inside the hero sprite. Wall stuns do work when the hero dodges
   (`fight=brute&bot=1`: the brute crashes into the south wall and gets stars). But the reel, the
   first thing anyone sees, never shows a wall stun. Fix: in the reel, have the hero side-step
   so the brute hits the back wall. In the AI, make a charge that connects with the hero carry
   through, not stop dead and stun on the player.
7. **Mites stack on each other and on the hero.** `?showcase=enemies&fight=mite&bot=0`: the five
   mites converge into a single red mass on the hero's head and body, and the hero is hurt
   continuously until death in about 6 s (`evidence/mite-pile-on-hero.png`,
   `evidence/mite-fight-grid.png`). The "red spot marks the leap" tell is barely visible at play
   zoom, because a few red pixels on a dark floor get lost under five red bodies. Fix: use a
   larger mite separation radius (see Biggest gap) and cap simultaneous mite leaps at 2, which
   the attack slots already allow. Draw the leap spot as a bright ring 2 px thick, over the
   characters.
8. **Deaths are good but busy, and they last longer than they read.** The husk death goes white
   pop, topple, dotted ring, shatter into grey and green cubes, then a yellow burst
   (`ours/04-death-strip.png`, `evidence/reel-deaths-grid.png`), and the debris lingers for
   about 1 s. It is satisfying, and better than "just vanishes". But next to the reference's
   single white flash and one green splat, ours has four separate effects stacked in 0.7 s, so no
   single frame reads as "the kill". Fix: make the white pop 2 frames long and 30% larger, drop
   the dotted ring, and have the debris settle and fade by 0.5 s. Keep one signature per
   archetype (husk crumbles, wisp flares, mites pop confetti, brute crumbles into rocks).
9. **Normal-play framing makes the cast tiny and hides the hero.** `/?scene=run&seed=3`: the hero
   starts behind the statue plinth against the back wall and is hard to find
   (hero at x 4.7, z -5.6 on load, tucked under the back wall). At
   arena zoom, enemies are about 40 to 60 px tall on a 720p frame. This mostly belongs to
   `arenas` and `movement`/camera, but it makes every enemy problem above worse.

## must_have checklist

- **Every attack has a telegraph readable before it hits: PASS, but weak.** Husk: an arc outline
  plus arms raised, 30 ticks (`evidence/husk-fight-grid.png`). Wisp: glow swell plus aim dots,
  then a slow orb (`evidence/wisp-fight-grid.png`). Brute: the lane fills red over about 1 s,
  with a body flash (`evidence/brute-charge-lane-under-hero.png`). Mite: a squat plus a red spot.
  Every attack has one, but the husk arc and brute lane are covered by the hero, and the mite
  spot is too small (Problems 2 and 7).
- **Enemies never stack into one blob; separation and flanking: FAIL (visually).** The
  collider-level separation holds (0 collider overlaps after about 3 s, measured from
  `state().enemies`). Husks do spread around the hero. But the rendered models overlap each other
  and the hero heavily (`evidence/play-heap-over-hero.png`, `evidence/mite-pile-on-hero.png`).
- **Deaths are satisfying: burst, flop or shatter, never just vanish: PASS.** The husk topples
  and shatters, the wisp flares, mites burst into confetti, and the brute crumbles into rubble
  (`evidence/reel-deaths-grid.png`, `ours/04-death-strip.png`).
- **Difficulty knobs (hp, speed, aggression) are data, not code: PASS.** There is an `ENEMIES`
  table and `knobs`/`setKnobs` in `src/enemies/data.js`, URL params `&hp= &speed= &aggr=`, and the
  showcase `G` key cycles EASY, NORMAL and HARD.

## Console errors

None. Every capture reported 0 console errors and 0 page errors: `?showcase=enemies` (reel,
`at=` variants, `fight=husk|wisp|brute|mite`, bot on and off) and `/?scene=run&seed=3` with
debug spawns.
