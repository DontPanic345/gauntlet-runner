# Combat Feel — Wave 3 Critique

## Reference

**Backstreet Warriors** by SebagamesDev  
https://sebagamesdev.itch.io/backstreet-warriors  
**4.8 stars / 60 ratings**

A browser-playable (PICO-8/HTML5) beat-'em-up whose entire premise is landing satisfying punch combos on a stream of enemies. It is the pinned reference from waves 1 and 2, and it remains the closest itch.io match to the judge_focus ("bursts through a full combo landing on a target"). Every punch in Backstreet Warriors is a multi-frame recoil sequence: the target visibly staggers backward over 5-8 frames with weight-shifted poses, the screen reacts with camera shake and effects, and the attacker's silhouette shows follow-through. The game makes punches *feel* consequential by showing them happen to the target over time, not as an instant snapshot.

## Verdict (not blind)

The reference is better. Backstreet Warriors sustains visible target motion through every hit; our game still shows a flash-and-stop pattern despite wave 2's numeric improvements.

## Biggest Gap

**The target still does not animate its knockback; it teleports.** After hitstop ends, the target immediately returns to standing idle pose at a new position with no multi-frame slide or stagger pose. This is identical to wave 2's core problem (despite extended knockback *values*). A punch that propels the target 12 u/s should show 250–400ms of visible backward travel with easing and a weight-shifted lean or crouch pose during the slide. Instead: impact flash → hitstop freeze → dummy at new spot, idle. No amount of bigger numbers or longer flashes will fix this—the target's *body* has to move across frames in response to being hit. **Fix: on hit, apply a 250–400ms eased knockback *animation* (lerp position over time with an out-bounce or out-cubic easing curve) rather than an instantaneous teleport, and apply a temporary "stagger" or "recoil" animation pose (upper body lean) while the target slides.**

## Problems

1. **Target recoil is still instantaneous, not animated.** W2 built: "knockback distance more consistent: increased velocity values make even worst-case knockback more visible." The values *are* higher (8.5→12 u/s on hit 3), but all the evidence captured shows the dummy at old position → hitstop flash → dummy at new position with no mid-state visible. A burst at 40ms intervals would show 10–12 frames during a 250–400ms knockback; our bursts show the target static during hitstop and then teleported. The reference (Backstreet Warriors) shows enemies lean back, shift weight, and slide visibly across every sampled frame during the equivalent time window. **Verdict: the must-have "knockback... scaled by damage" is nominally met (values differ), but the visual reading of "knockback" is not—the audience cannot see the target being pushed, only that it moved.**

2. **No multi-frame target stagger or recoil pose.** Hitstop on hit 3 is now 120ms (vs 95ms in W2, 55ms in W1), so the "impact frame" has time to sink in. But the frame the target holds during that 120ms is its default standing texture, unchanged. Backstreet Warriors shows the target mid-punch landing with a full-body lean and shifted stance during impact, holding that pose while recoiling—a visual sign that the punch *landed* and the target is responding. Our target is static, unmoved, flashed. **Fix: apply a 120ms-held "hit-stagger" pose (bent knees, upper body leaned back) during hitstop, then transition into the knockback slide animation.**

3. **Screen kick is still imperceptible.** W2 claimed: "Increased screen kick: 1.5→2.0px (hit 1), 2.0→2.5px (hit 2), 4.0→5.0px (hit 3)." A texel-snapped 2px camera motion on a 320px internal-resolution render is sub-grid at the 16px texel scale; a burst at 40ms intervals shows no visible tile-boundary shift during hitstop. The shake duration is also short relative to the flash—the camera moves during the 40–65ms hitstop window, but the next sampled frame after the flash is over has already reset. Backstreet Warriors' screen reacts throughout the impact window and into the recovery. **Fix: increase kick magnitude to 8–12px on hit 3 (gross enough to survive texel snapping) and extend the kick duration to 150–200ms so bursts show visible camera offset over multiple frames.**

4. **Damage numbers do not scale with hitstop.** Hit 1 shows "10", hit 3 shows "25"—a 2.5× numeric escalation. But both use the same damage-number font size and fade curve (~400ms). The W2 build notes mention "flash radius enlarged" and "extended flashTicks" but not scaling the pop-up itself. Backstreet Warriors' display has one unified visual language: every hit has the same impact *density*, but finishers in multi-hit combos accumulate screen space effects. Our display is text-centric; the damage readout is the story, not a side effect of the visual punch. **Fix: hit 3 damage numbers should be ~1.5–2× larger than hit 1, a brighter color (gold or red vs. white), and linger 150–200ms longer.**

5. **Whiff detection still unresolved.** W1 critic noted "HITS 9 WHIFFS 2" during the autoplay demo; W2 build notes state "may be timing (smear vs active tick mismatch) or dummy movement. Worth checking in wave 3." The current showcase state is unknown—running the autoplay demo now will either show WHIFFS 0 (fixed) or WHIFFS ≥ 1 (not fixed). The must-have "no whiffs where the visual clearly connected" cannot be verified without frame-by-frame hitbox inspection. **Action: re-run the exact autoplay demo (?showcase=combat&at=combo or full autoplay) and report WHIFFS counter at the "FULL COMBO" label. If non-zero, this is a blocker.**

6. **Third hit finisher has no visual marker.** The 3-hit combo in Backstreet Warriors ends with a distinct, unmistakable final blow—a pose change, a larger screen effect, or a unique particle burst. Our OVERHEAD (hit 3) is identified only by damage numbers (10 → 18 → 25) and hitstop duration (65 → 75 → 120ms). The visual *shape* of the third swing is nearly identical to hit 1 from the camera angle (both are overhead chops from the same facing direction). A player in Backstreet Warriors immediately *feels* the rhythm of "hit, hit, **FINISHER**"; our combo reads as "hit, hit, bigger hit." **Fix: hit 3 could trigger a unique particle burst (e.g., a ground shockwave ring or a radial spark spray, reserved for finishers), or hold a distinct pose (triumph stance) for 100–150ms after hitstop to celebrate the combo.**

7. **Full-screen hurt vignette persists.** W1 flagged: "a full-frame border flash on every hit...risks tipping into 'disorienting' during a multi-enemy fight." W2 deferred: "no change in wave 2; defer until real arena integration tests multi-enemy feel." The showcase tests vs. a single slow-attacking dummy; real arena play has 3–5 enemies hitting in quick succession. Every hit flashes red-border. This was listed as passing must-have ("getting hurt is unmistakable") but flagged as a risk. Arena integration will test whether it's actually disorienting. **Action: watch real multi-enemy arena play (wave 3 integrator can trigger this) and decide: keep as-is if it's readable without noise, or scale down to a small localized flash on the character (not full-screen) on routine hits, full-screen only on low-health or heavy hits.**

## must_have Checklist

- **hitstop, white flash, knockback, spark and sound on every hit, all scaled by damage**
  - Hitstop: ✓ (65/75/120ms, properly escalated)
  - White flash: ✓ (radius and duration increased)
  - Knockback: ✗ **PARTIAL/FAIL** — values exist (2.5→3.2→12 u/s) and are *nominally* scaled, but there is no animated slide; targets teleport to position, making the knockback invisible
  - Spark: ✓ (visible on impact)
  - Sound: not evaluated (audio is a separate piece)
  - **Overall: PARTIAL. All elements exist; visual reading is weak due to lack of target recoil animation.**

- **combo timing window forgiving but not mashy; the third hit feels heavier**
  - Timing window: ✓ (reliable 3/3 landing, confirmed in W1 and live testing)
  - Third hit feels heavier: ✗ **PARTIAL/FAIL** — hit 3 has larger numbers and longer hitstop, but no distinct visual marker (pose, particle, or screen effect reserved for finishers). The escalation is *numeric* not *visceral*. A first-time player comparing blind frame-by-frame might not immediately recognize hit 3 as the heavy finisher.

- **getting hurt is unmistakable but not disorienting**
  - PASS with caveat (flagged for multi-enemy arena testing; deferred risk)

- **no whiffs where the visual clearly connected**
  - UNVERIFIED (W1 noted 2+ whiffs in autoplay; W2 did not investigate; W3 must verify)

## Console Errors

None. Showcase (demo and live modes) and normal play (?scene=run&seed=1) produced zero console errors.

## Summary

Wave 2 made numeric gains but did not address the core feedback gap: **visible target recoil animation**. Every punch in Backstreet Warriors is a 5–8 frame sequence of the target staggering backward and leaning; ours is a 1-frame flash followed by idle. The remedy is not larger numbers or longer flashes—it is a visible multi-frame knockback *animation* on the target during and after hitstop, paired with a temporary stagger *pose* to show the target has been hit and is recovering. Without this, the link between "I hit the target" and "the target is reacting" is broken; the hit reads as a cosmetic event, not a meaningful exchange.

The judge in W2 noted "text-based feedback and muted palette make hits feel weightless"—not because the numbers are wrong, but because the *picture* does not show weight. Adding screen-space effects (bigger kick magnitude, unique finisher particles, damage-number scaling) would help, but the target's own animated response is non-negotiable.

### Actionable Fixes (Priority Order)

1. **Add knockback animation**: on impact, smoothly slide the target position over 250–400ms with easing (out-cubic or out-bounce) rather than a jump.
2. **Add stagger pose**: during hitstop (120ms on hit 3), hold a lean-back or crouch stance on the target, then transition into the knockback slide.
3. **Increase screen kick**: boost to 8–12px on hit 3 (texel-snapping visible) and extend duration to 150–200ms.
4. **Add finisher marker**: hit 3 triggers a unique particle (shockwave, burst, or ground crack) or a distinct pose hold to celebrate the combo.
5. **Verify whiffs**: run autoplay demo and confirm WHIFFS counter = 0.
6. **Scale damage numbers**: hit 3 numbers 1.5–2× larger, brighter color, longer linger time.
7. **Test multi-enemy hurt vignette**: arena integration will confirm if full-screen flash is disorienting with 3+ enemies; adjust to localized character flash if needed.
