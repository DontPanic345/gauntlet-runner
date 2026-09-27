PIN: https://sebagamesdev.itch.io/backstreet-warriors | 4.8 stars / 60 ratings | A browser-playable (PICO-8/HTML5) beat-'em-up whose entire premise is landing satisfying punch combos on a stream of enemies — the closest itch.io match to `combat`'s judge_focus ("bursts through a full combo landing on a target"), and it clears the 4.5★/50-rating bar with real margin.

## Verdict (not blind)

The reference is better: its punches read as continuously alive across every sampled frame, while ours delivers one very good flash-frame and then goes nearly static.

## Biggest gap

**The combo doesn't build.** Hit 3 (the "OVERHEAD" finisher) looks and feels no heavier than
hit 1 — same size flash, same small damage-number pop, no distinct color/sound cue, no
extra hitstop or camera kick — and knockback distance is wildly inconsistent rather than
escalating (0.14 units on one clean live hit, 1.51 on a cleave hit, 9.18 on another hit in
the same combo, captured via the showcase's own `KNOCK` readout). Reference punches
visibly escalate: enemies stagger further back and lean further off-axis punch to punch.
Fix: give step 3 of `COMBO` a visibly larger hit-flash radius, a longer hitstop, and a
knockback value that is *reliably* bigger than steps 1–2 (right now the knockback formula
produces swings of 60x between similar-looking hits, which reads as random, not "heavier").

## Problems

1. **Third hit isn't heavier.** See Biggest gap above. Screenshot evidence:
   `hurdles/waves/w1/critic/combat/evidence/hit3-frame.png` shows the OVERHEAD (3rd)
   hit landing with only a small spark and a "10" — visually indistinguishable in weight
   from the very first hit of a fresh combo. Must-have "the third hit feels heavier" is not
   met on the evidence gathered.

2. **Knockback distance is erratic, not scaled.** In one live single-hit test (showcase,
   `?showcase=combat&auto=0&hud=1`, attacking dummy A from spawn) the HUD read
   `KNOCK 0.14` — the dummy barely moved and was still overlapping the hero's sword a
   full 600ms later (see `ours/04-aftermath.png`). In the built-in demo's cleave/full-combo
   moment the same dummy read `KNOCK 9.18` — nearly the width of the whole training yard.
   Neither the reference nor our own must-have ("knockback... scaled by damage") explains
   a 60x swing between two hits that look similar on screen. This makes the aftermath of a
   hit unpredictable: sometimes the target is glued to the hero, sometimes it's launched
   off-screen.

3. **Very little visible motion between hitstop and idle.** A fine burst (25ms interval)
   through a single hit landing (`ours/03-combo-strip.png`) shows: frame 1 = big white
   hitstop flash, frames 2–6 = the dummy already back to its default standing texture with
   almost no in-between recoil/stagger pose and no background/camera movement at all
   (tile positions are pixel-identical across all 8 raw frames — no screen kick is visible
   in stills despite the must-have list requiring one). The reference's motion strip
   (`ref/03-combo-strip.png`), sampled at a comparable real-time span, shows the fighter
   cluster visibly re-posing in every one of the 6 frames — punches connecting, arms
   retracting, the target leaning back further frame over frame. Ours reads as "flash then
   done"; the reference reads as a continuous scuffle. Fix: stretch the knockback
   travel/recoil animation over more frames (even a few hundred ms of eased slide) so a
   burst capture shows motion, and confirm screen-kick is actually wired to hit impact
   (or make it strong enough to survive a texel-snapped render).

4. **The showcase demo racks up real whiffs.** During the stock autoplay route (no
   manual input), the HUD's own counter read `HITS 9  WHIFFS 2` by the "FULL COMBO"
   label on the cleave station — see `evidence/whiffs-2-fullcombo.png`, top-right readout
   (not included in the blind packet since it's an internal HUD reading, not a matched
   moment, but reproducible via `?showcase=combat&at=cleave` and watching the HUD for
   ~4s). The scripted demo is tuned by the piece's own builder to hit
   dummies reliably, so two whiffs appearing in a few seconds of routine autoplay is a
   real signal, not a one-off input-timing mistake on my part. Must-have "no whiffs where
   the visual clearly connected" needs verification frame-by-frame against the swing
   hitbox; on the evidence available I cannot confirm the visual clearly connected on
   those two whiffs, but the non-zero counter during a canned demo is itself suspicious
   and worth a builder look.

5. **Aftermath is visually muddy.** In `ours/04-aftermath.png`, ~600ms after a clean hit
   the hero's blue sleeve and the dummy's torso occupy almost the same pixels — it's hard
   to tell, from a still, where the hero ends and the target begins. The reference's
   equivalent moment (`ref/04-aftermath.png`) keeps a clean silhouette gap between
   attacker and target even mid-exchange, which is part of why its hits read as
   connecting cleanly. This is a case where the near-zero knockback (see #2) directly
   hurts readability.

6. **Full-screen hurt vignette is intense.** Not a clear fail, but worth flagging: when
   the hero is hit, a solid red border fills the *entire* screen edge-to-edge (see
   `evidence/getting-hit-vignette.png`, captured during the "GETTING HIT" demo station,
   `?showcase=combat&at=hurt`). It is absolutely
   "unmistakable" (must-have met), but a full-frame border flash on every hit, not just
   low-health, risks tipping into "disorienting" during a multi-enemy fight where hits
   land in quick succession. Reference games in this genre generally use a smaller,
   localized flash on the character rather than a full-screen border for routine damage.
   Worth a second look once the piece is played in a real multi-enemy arena rather than
   the 1-attacker showcase station.

## must_have checklist

- **hitstop, white flash, knockback, spark and sound on every hit, all scaled by damage** —
  PARTIAL. Hitstop, white flash and spark are all present and look great in isolation
  (`ours/02-impact-flash.png`). Knockback is present but not reliably *scaled* (#2).
  Sound not evaluated by this critic (out of scope for the `combat` piece per
  `pieces.json` — audio is a separate piece).
- **combo timing window forgiving but not mashy; the third hit feels heavier** — FAIL on
  the second clause (#1). The window itself did chain reliably in every manual test
  I ran (3/3 hits landed, `combo.info()` showed `hits:3, whiffs:0, combos:1` for a
  deliberately-timed combo) — timing feel itself is fine.
- **getting hurt is unmistakable but not disorienting** — PASS with a caveat (#6).
- **no whiffs where the visual clearly connected** — UNVERIFIED / possible FAIL (#4).

## Console errors

None. Every capture (showcase in demo and live modes, at every station, plus normal play
via `?scene=run&seed=1` with `debug.spawn('husk', ...)`) produced zero console lines and
zero errors across ~10 separate capture runs.

## Evidence index

- `ours/`, `ref/`: the 4 matched pairs used for the blind packet (hit-connect,
  impact-flash, a 6-frame motion strip, and the post-exchange aftermath).
- `hurdles/waves/w1/blind/combat/`: the sealed A/B packet and `criteria.md`.
- Raw captures backing problems 1–6 are in `/tmp/gr_live2`, `/tmp/gr_fine`, `/tmp/gr_hurt`,
  `/tmp/gr_cleave`, `/tmp/gr_crit` (not checked in; reproducible via the `capture.cjs`
  invocations described above against `?showcase=combat`).
