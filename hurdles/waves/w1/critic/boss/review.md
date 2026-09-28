PIN: https://stepford.itch.io/gun-knight | 4.5 stars, 496 ratings | Top-down pixel-art dungeon-crawler roguelite with multiple telegraphed boss fights and an on-screen boss health bar, browser-playable, the strongest itch.io match found for a fixed-camera pixel/voxel boss encounter at 4.5+/50+ ratings (the `boss-rush`/`boss-battle` tag intersections with pixel art all topped out well under 50 ratings).

## Reference

**Gun Knight** by Stepford — https://stepford.itch.io/gun-knight — 4.5 stars, 496 ratings.
A top-down pixel-art dungeon-crawler roguelite (Gungeon/Isaac-inspired) with a run of
distinct telegraphed bosses, each with an on-screen boss health bar. It is the closest
fit on itch.io to "fixed-camera pixel-art boss fight" that clears the 4.5-star/50-rating
bar: every `boss-rush` and `boss-battle` tag combined with `pixel-art` topped out at 98
ratings or fewer for anything not this well-established. The HTML5 web build on the
itch page is explicitly flagged by the developer as a broken test port ("missing
features and some graphical issues") and could not be driven past its own splash-loop
with scripted input, so this review uses the developer's own official screenshots and
promotional GIF (downloaded from `img.itch.zone`) rather than live capture — those
assets represent the shipped, rated version fairly, which the broken web port would not.

## Verdict (not blind)

The reference wins: Gun Knight's bosses read faster (tighter telegraph shapes, a full-height health bar, more distinct per-boss silhouettes), and our biggest must_have failure — phase transitions that are barely more than a stat change — has no equivalent weakness on their side.

## Biggest gap

Phase transitions are not events. Captured at `hurdles/waves/w1/critic/boss/notes` (see Problems #1): when hp crosses a phase threshold, `state.showcase.boss.state` flips to `"transition"` and the boss simply freezes in place for well under a second with no camera work, no re-announcement, no colour or particle change, and no pause in the ambient combat — then attacks resume. Build a real transition: cut the player's control briefly, punch the camera in on the Warden, replay a shortened version of the intro's light-up/roar beat with a phase-specific colour (e.g. the phase II ground-slam telegraph red should bloom across the arena), and hold it for at least 700–900ms before returning control. Right now a player who isn't staring at the HP bar would not notice a phase changed until the moveset does.

## Problems

1. **Phase transitions are visually a no-op.** Forced the boss from phase 1 to phase 2 by fast-forwarding a bot fight (`window.__GR.debug.timeScale`) and polling `state().showcase.boss.state` until it read `"transition"`, then slowed to real time and burst-captured 7 frames 250ms apart. Reproduce: load `?showcase=boss&phase=1`, run `window.__GR.debug.timeScale(8)` in the console, poll `window.__GR.state().showcase.boss.state` until it reports `"transition"`, then drop the time scale back down and watch — the boss geometry, camera, lighting, and HUD stay static except for a floating "24" damage number left over from the last hit. This directly fails must_have #3 ("phase transitions are events, not just a stat change"). Fix: give the transition state its own camera beat and VFX, not just a frozen pose.

2. **Sweep telegraph lead time looks short.** Comparing `p1/sweep-03.png` → `sweep-04.png` → `sweep-06.png` (150ms apart), the only pre-swing warning is a small dashed white arc that appears at the flail head one frame before the full red/white "danger wedge" already covers the floor the hero is standing in. That's roughly 150-300ms of warning before the area is live, which is tight for a first-time player reacting with a dash (must_have #2 asks for "dodgeable on reaction"). I did not instrument exact hit-frame timing (showcase is bot-driven and debug hooks don't expose a boss-hurt call), so this is a flag, not a confirmed fail — but it's worth the builder measuring the actual reaction window against the dash's startup + i-frame timing.

3. **HUD "H" toggle appears to do nothing.** The showcase overlay advertises `H HUD` as a control, but pressing it (`?showcase=boss&phase=1`, `KeyH`) left the full debug/HUD text stack on screen in every capture. Not a must_have item, but it made getting clean reference-style screenshots harder and suggests the hotkey is dead or scoped to something invisible.

4. **Single boss silhouette reads as visually flatter than the reference's variety.** The reference (a roguelite with several distinct bosses — a bat-winged shade, a skull-serpent, a green ooze) gets silhouette variety "for free" by having different bosses. The Warden is one boss across three phases, and its grey hunched-knight silhouette stays close to the same read (see `pair-01`, `pair-02`, `pair-03` — same basic mass, different limb configuration) across phases 1–3. This isn't a must_have failure, but it's a real reason a blind judge could call the reference "more epic": theirs keeps surprising the eye, ours is the same grey block getting angrier. Consider a stronger silhouette swap or added ember/light-state change per phase (the palette rule already reserves ember orange for danger — phase 2/3 could claim more of it on the boss body itself, not just the floor telegraphs).

5. **Could not verify hitstop/knockback/screen-kick on a landed boss hit.** All captures used `debug.timeScale`, `debug.hurt`, and the auto-playing bot rather than a manually-timed dodge/hit in real time, so I did not personally confirm the "Feel rules" (hitstop 40-90ms, flash, knockback, screen kick) actually fire when the boss connects. The one hero-death capture (`debug.hurt(9999)`) showed a "-9999" damage number, red vignette, and "YOU FELL" text, which is promising, but that's a debug-forced kill, not a real telegraphed hit landing. Recommend the next critique pass drive the fight with real scripted dashes/attacks rather than the bot to confirm this must_have-adjacent feel rule on the boss specifically.

## must_have checklist

1. "The intro makes you nervous: camera, name card, roar, arena lights up" — **PASS** (visual). `?showcase=boss&intro=1`: torches light up one at a time across 3 frames, the camera pushes in toward the dais, and a name card ("THE WARDEN") with a phase-pip HUD animates in. Roar is audio and out of scope for this (silent) capture pass.
2. "Every attack is learnable and dodgeable on reaction with a dash" — **PARTIAL**. Telegraphs exist and are readable (wedge for the chain sweep, ring for the ground slam — see `ours/02-attack-a.png`, `ours/03-attack-b.png`), but see Problem #2: the pre-attack warning window looked short in the captured frames and was not independently timed against dash i-frames.
3. "Phase transitions are events, not just a stat change" — **FAIL**. See Problem #1.
4. "The death sequence is the best-looking moment in the game" — **PASS**. `?showcase=boss&phase=3` + `X` (kill): a full-screen explosion, a ring-flash across the arena, then a "THE WARDEN FALLS / THE WAY DOWN IS OPEN" banner over the boss's corpse with a "TAKE THE KEY" prompt. This is the strongest sequence in the piece and plausibly does clear the bar.

## Console errors

None. Every capture (`intro=1`, `phase=1`, `phase=2`, `phase=3`, the forced transition, and the forced death) reported 0 console lines/errors from `tools/capture.cjs`.
