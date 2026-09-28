# Combat Feel — Wave 2 Critique

## Reference

**Backstreet Warriors** by SebagamesDev  
https://sebagamesdev.itch.io/backstreet-warriors  
**4.8 stars / 60 ratings**

A browser-playable (PICO-8/HTML5) beat-'em-up whose entire premise is landing satisfying punch combos on a stream of enemies. The closest itch.io match to the judge_focus ("bursts through a full combo landing on a target"). The reference showcases every punch as a self-contained moment: the attacker rocks back from impact, the target staggers visibly in response, and the screen feels like it's reacting. In Backstreet Warriors, even the first punch reads as consequential.

## Verdict (not blind)

The reference is better. Backstreet Warriors lands every punch with consistent, readable weight—each frame communicates force. Ours now shows clearer escalation from hit 1 to hit 3 and stronger visual feedback, but the punches still feel like impacts rather than living exchanges. The reference's fighters *dance* with each hit; ours *flash and recover*.

## Biggest gap

**The hits still lack continuous motion through impact.** Wave 2 improved peak-moment feedback (bigger flash, more hitstop, higher numbers), but the exchange still reads as "white flash, then idle." Backstreet Warriors shows the target leaning, recoiling, being pushed back over 5+ frames *after* impact. Ours uses 120ms of hitstop on hit 3, but that freeze doesn't translate to visible target motion in the aftermath: the dummy returns to standing pose almost immediately, with no knockback *animation* (slide, stagger pose, weight shift). The damage values now escalate (10→18→25), which helps, but the absence of a visible multi-frame recoil sequence means hits feel momentary rather than devastating. **Fix: add a 200–300ms knockback travel animation on the target (eased slide toward the edge of the screen) so hits feel like they *push* enemies away, not just move them teleport-style.**

## Problems

1. **Hit 3 damage doesn't feel disproportionate to the eye.** Wave 2 tuned damage numbers (1→10, 1→18, 1→25 raw damage), which is a 2.5× escalation from hit 1 to hit 3. However, the white flash on hit 3 is only ~1.4× larger by eye compared to hit 1 (`radius 2.5+power` vs. `3.5+power*1.2` is not visually dramatic at the scale of these tiny voxels), and there's no additional particle burst or sound cue listed in the build notes. Compare to Backstreet Warriors: the final punch in every combo sends the target *flying* backward with a much more pronounced screen effect. **Verdict: partial pass on "third hit feels heavier"—the number escalates, but the visual weight is subtle.** The must-have is barely met; a stranger comparing frame-for-frame might not immediately see why hit 3 is "heavier."

2. **Knockback animation is absent—enemies teleport, don't slide.** Wave 1 captured a 600ms moment where a dummy remained overlapping the hero after a hit (KNOCK 0.14), indicating low knockback. Wave 2 increased values (1.7→2.5, 8.5→12 u/s) but did not add a visible knockback *animation*. Captures show: impact frame → hitstop flash → dummy at new position. There is no multi-frame slide or lean visible between those states. Backstreet Warriors keeps enemies in-motion during every exchange—they stagger back continuously. **Ours feels like: sword swings, flash happens, enemy teleports to new spot. Reference feels like: punch lands, target is *thrown* backward over multiple frames.** This is the core "weight" difference. **Fix: Implement a 250–400ms eased (out-expo or out-quart) slide animation on impact, not just an instantaneous position jump.**

3. **Screen kick is either absent or imperceptible.** Wave 1 critic noted: "tile positions are pixel-identical across all 8 raw frames—no screen kick is visible in stills despite the must-have list requiring one." Wave 2 build notes claim increases ("1.5→2.0px", "4.0→5.0px" on hit 3), but reviewing 40ms-interval bursts of the showcase at slow motion, the camera does not visibly shift. Texel snapping may be hiding small kicks (2px on a 320px internal resolution is sub-texel at 1/16px grid), or the kick is working but the hitstop duration is so short the camera hasn't moved before the next frame. **Fix: Either increase screen kick magnitude substantially (5px → 8–10px on hit 3) for texel-snapped visibility, or extend the kick duration so it persists through the flash window, not just during the 40–65ms hitstop.**

4. **Whiffs reported in wave 1 demo were not investigated.** Wave 1 noted "HITS 9  WHIFFS 2" in the stock autoplay demo. Wave 2 build notes state: "Hitbox sector math is unchanged; may be timing (smear vs active tick mismatch) or dummy movement. Worth checking in wave 3." This is unresolved. Running the auto-pilot showcase now will either produce zero whiffs (fixed, unreported) or still show 2+ (still broken). **This must be verified before moving forward: run the exact same autoplay sequence and confirm the HUD reads WHIFFS 0 or justify why whiffs are acceptable in a canned demo.**

5. **Full-screen hurt vignette still fires on every hit.** Wave 1 noted: "a full-frame border flash on every hit, not just low-health, risks tipping into 'disorienting' during a multi-enemy fight." Wave 2 build notes explicitly state: "no change in wave 2; defer until real arena integration tests multi-enemy feel." This is not a blocker for the piece in isolation, but it's a known risk that hasn't been addressed. During the arena with 3+ enemies, this will flash repeatedly. **Deferred is acceptable only if integration testing in wave 3 will revisit it; flag this for the integrator.**

6. **Damage number scaling is disconnected from hitstop duration.** Hit 1 shows a small "10" that sits on screen for ~400ms (hitstop 65ms + natural fade). Hit 3 shows "25" with the same fade curve—same visual weight in the display. The damage numbers themselves don't escalate in size, color, or display duration to match the hitstop escalation (55→120ms on hit 3). Backstreet Warriors uses bold, single-color pixel numbers that pop with the same intensity for all hits, but the *overall* visual impact of the hit (enemy stagger + camera reaction) makes the third punch feel heavier. Our damage numbers don't compensate for the lack of target motion. **Fix: damage numbers on hit 3 could be ~1.5× larger, a brighter color (e.g., gold vs. white), and linger 50ms longer to reinforce the escalation.**

7. **Combo reset delay is not tuned for Backstreet Warriors pacing.** Backstreet Warriors punches land and chain with very short windows—the combo feels urgent and responsive. Our showcase demo completes a 3-hit combo and shows "COMBO RESETS" text immediately after. The timing window itself is fine (builders noted "timing feel itself is fine" in wave 1), but the visual pacing *after* the combo ends is not as snappy as the reference. This is minor and may be an artifact of slow-motion captures, but Backstreet Warriors' screen resets faster and feels tighter. **Lower priority; verify in normal-speed capture.**

## must_have checklist

- **hitstop, white flash, knockback, spark and sound on every hit, all scaled by damage** — PASS with caveats.
  - Hitstop: ✓ present (65/75/120ms, properly escalated)
  - White flash: ✓ present (radius 2.5→3.5, flashTicks extended)
  - Knockback: ✓ present but not *animated* (values 2.5→3.2→12, but no multi-frame slide) — *satisfies the must-have letter but not spirit*
  - Spark: ✓ visible (captured in "impact-moment" frame)
  - Sound: not evaluated (audio is a separate piece)
  - **Scaling: partial.** Damage numbers escalate (10→18→25). Flash radius and hitstop escalate. Knockback values escalate. But the visual *reading* of "escalation" is weak because the target doesn't move continuously—it jumps into position.

- **combo timing window forgiving but not mashy; the third hit feels heavier** — PARTIAL/FAIL.
  - Timing window: ✓ fine (builders noted this works; wave 1 critic confirmed 3/3 hits landed reliably)
  - Third hit feels heavier: ✗ barely met on damage numbers, not met on visual impact. Frame-for-frame, hit 3's white flash is noticeably larger than hit 1's, but the difference is subtle and might not register as "heavy" to a stranger comparing blind captures. The reference's third punch is *unmistakably* heavier.

- **getting hurt is unmistakable but not disorienting** — PASS (no change from wave 1; full-screen vignette is indeed unmistakable, and deferred disorientation check is reasonable pending multi-enemy integration).

- **no whiffs where the visual clearly connected** — UNVERIFIED (flagged in wave 1, not investigated in wave 2).

## Console errors

None. Showcase (demo and live modes) and normal play (`?scene=run&seed=1`) produced zero console errors across 3 separate capture runs.

## Summary

Wave 2 made measurable improvements: knockback values jumped 50% (8.5→12 u/s on hit 3), hitstop extended (95→120ms), flash radius enlarged, and shake durations increased. These changes made hit 3 *numerically* heavier and the escalation *visible* in damage pop-ups and visual flash size. However, the core weakness persists: **the target does not move in response to being hit.** It teleports to a new position after hitstop ends. A punch in Backstreet Warriors is a 6-frame sequence of visible recoil; our punch is a 1-frame flash followed by idle. Adding a 250–400ms knockback *animation* (visible slide backward with easing) would close most of the gap. The biggest gap from the review is actionable: implement multi-frame knockback travel animation rather than instantaneous position updates.
