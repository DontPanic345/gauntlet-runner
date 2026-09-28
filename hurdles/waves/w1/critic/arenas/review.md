PIN: https://playwithfurcifer.itch.io/furcifers-fungeon | 4.7 stars / 126 ratings | Top-rated, browser-playable pixel-art dungeon-crawler roguelite whose stone-and-torch crypt rooms and overgrown biome rooms are the closest handcrafted-room match to this piece's judge_focus; it is the same pin the `enemies` critic already vetted and rejected only for motion-capture reasons that do not block a still-room comparison.

# Critic review: arenas (wave 1)

## Reference

**Furcifer's Fungeon** by PlayWithFurcifer (https://playwithfurcifer.itch.io/furcifers-fungeon), 4.7 stars
from 126 ratings, tagged Roguelite/Dungeon Crawler, Godot HTML5.

How I chose it, and what I rejected:
- I tried to capture it live and play it into a real dungeon room, the way the `enemies` critic
  did. Across two separate live-capture attempts (one with generous per-step waits, one over
  100+ seconds of scripted input), the headless build never got past its tutorial hub — a
  checkerboard lobby with a repeating "just a few quick steps" prompt. This matches the
  `enemies` critique's finding about this build's SwiftShader performance. Tutorial progress
  does not persist between runs, so a longer session would not help.
- Per PROTOCOL.md's fallback for this case, I used the game's own store-page screenshots
  (`img.itch.zone`, downloaded with curl) for the two room stills instead of a live capture.
  Both are real in-editor screenshots the developer chose to represent the game, not cherry-picked
  by me: one crypt room (torches, a stone coffin, stone floor tiles) and one overgrown/forest room
  (moss, pines, a pool). For the required motion strip, I used a 10-frame live burst from the
  tutorial hub itself, since it was the only real-time gameplay I could reach. This is a
  **fairness caveat**: the tutorial hub is a plain checkerboard lobby, not one of the game's
  actual dungeon rooms, so pair 03 under-sells the reference's room art specifically, even
  though it fairly shows combat feel and screen composition. I flagged this in `criteria.md` by
  describing the moment neutrally as "combat shortly after a run begins" rather than claiming it
  is a dungeon room.
- I did not consider **10 Minutes Till Dawn** (pinned for `hero`/`enemies`/`vfx`) because it has
  no distinct rooms at all — a single open field — so it cannot answer this piece's judge_focus
  about room composition.

Packet: 3 pairs. 01 and 02 are static room stills (crypt-styled, then overgrown/vegetated).
03 is a 10-frame, same-rate motion strip of early combat on both sides.

## Verdict (not blind)

The reference wins. Its two rooms read as deliberately composed spaces with depth (coffins,
rock ledges, a pool, layered foliage) at a glance; ours reads as one competently-dressed
template with the same rug-and-column skeleton repeated with new labels, and its two biggest
"room drama" beats — the door sealing behind you, and escalating danger room to room — are
either barely visible or actively broken.

## Biggest gap

Give every arena a composition that is visibly different from every other arena, and make
seeds actually reshuffle that composition. Right now `src/world/arena.js`/`tiles.js` produce
five fixed templates (`vestibule`, `ossuary`, `hall`, `gallery`, `antechamber`) whose prop
layout, rug/column skeleton, and rubble placement are nearly pixel-identical across different
seeds (compare `evidence/seed1-room1.png`, `evidence/seed2-room1.png`, and
`evidence/seed999-room1.png` — same statue, same banners, same crate positions, same skeleton
pile positions; only a `mirror` flip and one or two decorative reskins differ). A player who
replays the game will recognize "room 1" instantly every time rather than feeling like the
Gauntlet reshuffled itself. Widen what the seed actually randomizes: prop selection *and*
placement within each template, floor rubble/scorch decals, and ideally a second layout variant
per room slot so five arenas do not collapse into five fixed stage sets.

## Problems

1. **Wave escalation is not monotonic** (must_have: "wave composition escalates across the 5
   arenas"). On seed 1, the showcase HUD reports kill targets of 5 (room 1), **13** (room 2),
   **9** (room 3), 19 (room 4), 28 (room 5) — room 3 asks for *fewer* kills than room 2, a visible
   step backward in difficulty. Seeds 2 and 999 happen to escalate monotonically (5/17/16/23/36
   and 5/17/21/22/40 respectively), so this is seed-dependent, not a design choice: the escalation
   curve is not actually enforced to be increasing. Evidence: `evidence/seed1-room2-kills13.png`,
   `evidence/seed1-room3-kills9.png` (captured via `?showcase=arenas&seed=1`, pressing `2` then
   `3`). Fix: clamp each room's kill total to be `>=` the previous room's, or generate the curve
   from a monotonic base sequence instead of per-room independent rolls.

2. **The door-seal-on-entry moment is nearly imperceptible** (must_have: "doors slam shut on
   entry with shake and dust"). Watching `room.state` go `ready` -> `sealing` -> `fight` in real
   play (`/?scene=run&seed=1`, walk into the vestibule), the only visible changes across ten
   frames at 150 ms are a text banner ("ARENA 1/5 WAVE 1/2 THE VESTIBULE") and a small red glow
   appearing at the base of the exit rug (`evidence/door-seal-moment.png`). There is no visible
   gate, grille, or door mesh, no screen shake, and no dust cloud. By contrast the *exit* side of
   the same mechanic — the "ROOM CLEARED" moment — is genuinely good: a bold banner, "THE SEAL
   BREAKS...", and a diagonal chain of golden ember/spark particles arcing out toward the exit
   (`evidence/room-cleared-celebration.png`). The clear celebration is doing real work; the seal
   is not. Fix: give the entry seal a matching physical beat — a visible gate or rubble fall
   across the doorway the hero just came through, paired with a screen-kick and a dust puff,
   scaled the same way hits are per the Feel rules in GAME.md.

3. **Room composition barely varies across seeds**, undercutting "rooms look hand-made, not
   random... floor variation" as a per-run experience. See Biggest gap above for the seed-to-seed
   comparison. The five hand-authored templates themselves are reasonably composed (a focal
   statue, symmetric banners/torches, a rug leading to the door, side alcoves with pillars or
   crates) — that part of the must_have is met on a single playthrough — but nothing meaningfully
   reshuffles between runs, so the "seeded generation with variation" half of this piece's stated
   goal is barely present.

## must_have checklist

1. "rooms look hand-made, not random: composition, focal props, floor variation" — **partial
   pass**. Each template is composed with a focal prop and symmetric dressing (pass on
   composition), but floor variation and prop placement barely change across seeds (fail on
   variation); see Problem 3.
2. "doors slam shut on entry with shake and dust; the clear moment is celebrated" — **fail on
   entry, pass on clear**. See Problem 2. The clear half is genuinely good.
3. "wave composition escalates across the 5 arenas and is seed-reproducible" — **fail on
   escalation, pass on reproducibility**. Reproducible per seed, yes (same seed always gives the
   same numbers), but not guaranteed to escalate; see Problem 1.
4. "props break or react when hit where it makes sense" — **pass**. Teleporting the hero onto a
   `candles` prop (id `candles9`, room 1) and attacking it three times flipped its state from
   `{hp:1, dead:false, hits:0}` to `{hp:-9, dead:true, hits:1}` in one hit, with a visible break
   (the prop's model disappears, leaving a small debris/ember trace): `evidence/prop-break-candles.png`.
   Reproducible via `?showcase=arenas&seed=1` -> press `1` -> `window.__GR.debug.move('teleport',
   0.08,-3.6)` -> press `J` three times.

## Console errors

None. `?showcase=arenas&seed=1`, `?showcase=arenas&seed=2`, `?showcase=arenas&seed=999`,
`/?scene=run&seed=1`, and normal play all reported 0 console lines / 0 errors across every
capture.
