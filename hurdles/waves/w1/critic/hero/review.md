PIN: https://flanne.itch.io/10-minutes-till-dawn | 4.8 stars from 742 ratings | Top-rated, itch-native, HTML5-playable pixel-art action roguelite with a small, consistently expressive hero (idle, run, shoot, hurt, death all read cleanly at tiny on-screen size), which is exactly the "expressive small player character" bar this piece needs to clear. Chosen over Vlambeer's Nuclear Throne (4.7★/511 ratings, no browser build, no free motion capture possible) and Dungreed (4.8★ but only 32 ratings, under the 50-rating bar) because it is both browser-playable — so captures are live frames, not stills — and clears the rating bar by a wide margin.

# Critic review — hero (wave 1)

## Verdict (not blind)

The reference wins clearly: it has no rendering bugs and a consistently readable character at every moment tested, while ours has a broken dash and a broken attack-smear frame that actively destroy the character's silhouette.

## Biggest gap

Fix the dash animation. Right now (`?showcase=hero`, press `4`) the hero rockets almost entirely off the plinth toward the right edge of frame, and partway through the travel the model visibly comes apart into detached floating pieces — a stray red plane, a disconnected pair of legs, a flat teal smear — before reassembling into the skid pose (see `evidence/dash-08.png`, `evidence/dash-09.png` in the capture set). This reads as a mesh/transform bug, not a stylized stretch-and-smear. A builder should: (1) clamp the travel distance so the hero stays inside the showcase frame like every other animation, and (2) check whatever is driving the per-part transforms during dash (likely scale/skew applied per-voxel-cluster rather than to the whole rig) — the limbs and cloak should never separate from the torso.

## Problems

1. **Dash animation disassembles the model mid-travel.** `?showcase=hero`, press `4` (DASH), burst-captured every 50 ms. Frames 8-9 of the burst show the hood, legs, sword and a red cloak fragment as disconnected floating shapes rather than one stretched body (`evidence/dash-08.png`, `evidence/dash-09.png`). It reassembles by frame 10, so it's transient, but a transient "the character falls apart" frame is worse than no dash smear at all. This is the single most damaging bug in the piece — it would lose a blind comparison on sight if shown moving. Fix the per-part transform driving the stretch/smear so the rig stays connected throughout.

2. **Attack combo's third hit ("OVERHEAD") smear frame is a solid white blob with no character visible.** `?showcase=hero`, press `5` (ATTACK), during the "SMEAR" phase of hit 3 (`evidence/attack-15.png`, labelled "3 OVERHEAD / SMEAR 4"). The entire hero is replaced by an opaque white silhouette shaped like the sword arc; none of the character reads through it. A smear should suggest speed while keeping the character legible (compare hit 1 and 2's smear, which stay readable, e.g. `evidence/attack-01.png`). This looks like the smear layer's opacity/blend is maxed out only on hit 3. Reduce its alpha or use an additive streak that doesn't fully occlude the model.

3. **Run cycle's leg motion is barely perceptible.** `?showcase=hero`, press `2` (RUN), burst-captured. Across 10 frames (`evidence/grid-run.png`) the torso bobs slightly but the legs — already tiny relative to the oversized hood — don't show a clear contact/passing alternation; several consecutive frames look almost identical. The `must_have` calls for "contact and passing poses," and at present a viewer would struggle to tell this is a run cycle rather than an idle sway from stills alone.

4. **Secondary motion (scarf/cloak) is inconsistent, not lagging.** Across the run and dash captures, a red cloak/scarf fragment appears sharply in some frames (e.g. `evidence/run-08.png`) and is completely absent in the adjacent frames of the same cycle (e.g. `evidence/run-01.png`, `evidence/run-03.png`). A lagging cloak should ease in and out continuously; here it looks like it pops in and out of existence, which reads as a missing interpolation step rather than physically-lagging cloth.

5. **Silhouette reads poorly at actual gameplay scale.** `/?scene=run&seed=1` (normal play, not showcase). At the camera's real zoom level the hero is a small blue smudge with two cyan pixel dots for eyes and a thin sword line (`evidence/play-start.png`, `evidence/play-moving-right.png`); the hood and body don't separate into a recognizable "hooded runner" silhouette the way the showcase close-up suggests. The `must_have` explicitly requires readability "at 1x internal resolution," and this is the resolution that matters — the showcase's forgiving close-up zoom is flattering ours in a way normal play isn't.

6. **Spawn-in's mid-air pose is an unreadable white blob**, the same failure mode as problem 2. `?showcase=hero`, press `8` (SPAWN), early frames (`evidence/spawn-03.png`) show an all-white silhouette falling from off-frame with no character detail, before the hero resolves into a normal pose on landing. Minor next to the dash and attack bugs, but it's the same underlying issue (a flash/smear treatment set to full opacity) showing up a third time.

## must_have checklist

- **silhouette readable at 1x internal resolution** — FAIL. In showcase close-up the silhouette is passable if oversized (huge slab hood, very long sword); in actual play scale (`evidence/play-start.png`) the hero is a small blob distinguished mainly by two cyan eye-dots, not a readable hooded silhouette.
- **scarf or cloak with lagging secondary motion** — FAIL. A cloak/scarf fragment exists but pops in and out between frames instead of continuously lagging (see problem 4).
- **run cycle with contact and passing poses, footstep dust hook** — PARTIAL. A small dust/footstep blob is visible near the feet in some frames (`evidence/run-01.png`), which is good, but contact/passing leg poses are barely distinguishable frame to frame (problem 3).
- **each attack swing has anticipation, smear and recovery frames** — FAIL. Anticipation and recovery read fine on hits 1-2, but hit 3's smear frame is a solid white blob that erases the character (problem 2).
- **facing changes turn quickly but never pop** — PASS. The turn cycle (`?showcase=hero`, press `3`, `evidence/grid-turn.png`) shows a fast, clean flip with the sword crossing sides smoothly and no popping.

## Console errors

None. Every capture (`showcase=hero` in all 9 modes, `scene=run`) reported "0 console lines, 0 errors."
