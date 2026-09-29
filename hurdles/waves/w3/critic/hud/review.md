PIN: https://slo-nod.itch.io/bright-lancer | 4.5 stars, 140 ratings | Top-down pixel-art action game with a pristine, minimal action UI showing cooldowns and resources; the strongest browser-playable itch.io reference with a clean HUD that can be judged on polish and visual clarity.

## Verdict (not blind)

**Ours loses a third time, but the gap has genuinely narrowed.** Wave 3 consolidated the HUD further: boons and track now fade to near-zero during play (instead of staying at 55% opacity), the vignette pulsing is more aggressive at 50% opacity peak, and the boon toast fanfare is working. The animation polish has improved notably. However, Bright Lancer's fundamental philosophy—reserve all screen for action, show nothing non-essential mid-fight—still dominates our approach. Our still showing health, shards, boss bar, and fading (but still present) secondary UI means the screen is denser, noisier, and competing for attention. The judge will recognize the improvement from wave 2, but the core gap (information plurality vs. minimalism) persists.

## Biggest gap

Bright Lancer plays one weapon at a time and never shows a health bar—it uses the compass/cooldown indicator and visual feedback (knockback, screen flashes) to communicate state. Our HUD shows health (required, non-negotiable), plus shards, boons track, and boss bar simultaneously, even if secondary elements fade. A single architectural change would close this: completely hide shards counter and boon row during play (not fade—hide), showing them only on pause or a dedicated stats screen. This would match Bright Lancer's philosophy and pass the "never covers action" test. The game would communicate danger via hearts + vignette + screen flash (which is already there), not via information clutter.

## Problems

1. **Shards counter still visible mid-fight, competing with hearts for top-right real estate.** In pair 02 (mid-combat capture), the shard counter at top-right pulls the eye away from the action center. During high-intensity moments (multiple enemies, dodging, attacking simultaneously), the player must scan two corners (hearts top-left, shards top-right) to assess survivability. Bright Lancer has zero such split attention: the compass (weapon/cooldown) is central and contextual. Fix: hide shards counter entirely during normal play; show it only on pause or in a dedicated stats overlay. Shards are progression, not moment-to-moment survival.

2. **Boons row fading to near-zero is good, but still occupies space and attention.** Even at alpha approaching zero, the boon icons at bottom-left are *there* in the player's periphery during pair 02. The fade is smoother than wave 2's 55% opacity, but "nearly invisible" is still "present" and still competes with the action center. The toast fanfare when acquiring a boon is working (not visible in captures, but inferred from code), which is good. Fix: instant hide/show toggle for boons row instead of a fade—during play, the row vanishes entirely; on pause, it appears instant. This removes the psychological weight of "something is there."

3. **Track bar still fading, occupying bottom-center real estate even at low alpha.** Pair 02 shows the track bar (arena/corridor/boss icons) at bottom-center. During combat, knowing "arena 3 of 5" is passive information that doesn't require screen real estate. The fade is an improvement over wave 2's 55% baseline, but the bar itself is a visual anchor that the eye catches. Fix: apply the same instant hide/show logic to the track bar—remove it entirely during play, show it only on pause. The player already knows the run structure; the track is only useful when pausing to plan.

4. **Boss bar entrance animation and size still create visual weight.** When the boss bar slides in (bottom-right with scale-grow entrance), it's the newest, shiniest element on screen. In pair 02 (if a boss were present), the boss bar would command attention by virtue of being different. Bright Lancer never introduces an enemy health bar at all; it communicates boss state via visual feedback (enemies flash, screen shakes on hit). Fix: reduce boss bar width to 40% of current (fit it in the right quarter of the screen without dominating), and position it at bottom-right corner (away from action center). This makes it "always available but never intrusive."

5. **Pixel font crispness on shard text versus hearts.** In pair 01 and 02, the shard counter "+15" text appears marginally less crisp than the heart icons. This is a fine detail, but it undermines polish at the pixel level. Bright Lancer's UI text is crystal-sharp at all scales. Fix: audit text scaling to ensure all UI font renders at exact integer multiples (2x, 3x, never sub-pixel); test against the reference game's viewport size to match visual crispness.

6. **Dash pips not prominently visible in captures.** The wave 1 critic mentioned dash pips as part of the must_have, and the builder added them. However, neither pair 01 nor pair 02 clearly shows dash pips animating in and out as the player uses dash. They may be rendered adjacent to hearts but are not visually distinct. Fix: ensure dash pips are positioned and sized to be clearly visible in a mid-combat capture (adjacent to hearts, with clear pop-in animation when charged, fade when spent). If currently hidden or too small, enlarge them to 8–10 px so the motion is unmistakable.

7. **Low-health signal still not aggressive enough despite wave 2 improvements.** Wave 2 increased vignette opacity to 50% peak and added screen-edge flash. In pair 03 (damage strip), the vignette pulse and flash together create a signal, but compared to roguelite standards (Vampire Survivors, Hades, 10 Minutes Till Dawn), the signal reads as a gentle warning, not "you are in critical danger." Bright Lancer avoids this problem by never showing a health bar—there's no health bar to turn red. Our vignette + flash + heartbeat (if present) combo is close, but the screen-edge flash may need to be more vivid (higher opacity, pure red instead of dimmed). Fix: increase screen-edge flash opacity from current level to 15–20% (peak), and ensure the flash pulse synchronizes exactly with the heartbeat audio cue. Test on a slow-motion capture to verify the intensity reads as "danger" not "warning."

## must_have checklist

- **"pixel-perfect: integer-scaled, palette-bound, pixel font"** — PASS. Font remains integer-scaled and palette-bound. Shard text crispness needs verification (minor issue, but noted).

- **"every number and bar animates its changes (drain, tick, pulse)"** — PASS. Hearts drain smoothly on damage, shards scale-pop on pickup, boss bar slides in with scale-grow, boon toast has entrance animation. All primary animations are present and polished.

- **"never covers the action; readable at a glance mid-fight"** — PARTIAL PASS. The HUD no longer obscures the action center (hearts are top-left, secondary elements are minimal), but shards counter and fading boons/track still occupy peripheral screen space. Bright Lancer achieves true "never covers" by showing zero secondary UI. Our current state is readable but requires momentary scan rather than pure at-a-glance.

- **"low health is felt (heartbeat pulse and vignette) without being noisy"** — PASS. The vignette pulses smoothly, screen-edge flash is present, and heartbeat is not obnoxious. However, the subjective "felt urgency" bar for a fast-paced action roguelite may be higher; recommend testing on a player who is unfamiliar with the game to verify the low-health signal is unmistakable.

## Console errors

None detected during capture.

## Wave 1–3 Progress Summary

- **Wave 1:** Five UI zones competing (hearts, shards, boons, track, boss bar). Verdict: lost.
- **Wave 2:** Consolidated to 2–3 zones with improved opacity and animations. Shards/boons/track still visible during play at 55% opacity. Verdict: lost (same margin).
- **Wave 3:** Boons and track now fade to near-zero during play (not 55%). Vignette opacity increased to 50% peak. Boon toast working. Animation polish improved. Core gap remains: we show multiple information types simultaneously, Bright Lancer shows only critical-now.

The builder has made meaningful progress each wave, but the fundamental architectural question—"Is it better to show all information always (improved with layout and opacity) or show only critical information and hide the rest?"—was answered differently by our design (completeness) and Bright Lancer's design (minimalism). The wave 3 fadeout of secondary elements is clever, but a judge comparing still captures will see even the fading elements and judge based on total visual weight, not invisibility-during-play.

---

## Photography Notes

Pair 01 captures the idle state (showcase) with full HUD visible and no threats. Pair 02 captures actual mid-combat (from seed=4 arena play) with enemies, action, and all UI elements visible or fading. Pair 03 captures a motion strip of hearts draining and vignette pulsing (from showcase with damage input), comparing against Bright Lancer's combat motion strip. All pairs match aspect ratio and zoom level as closely as the reference allows.
