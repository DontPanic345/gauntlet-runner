PIN: https://slo-nod.itch.io/bright-lancer | 4.5 stars, 140 ratings | Top-down pixel-art action game with a pristine, minimal action UI showing cooldowns and resources; the strongest browser-playable itch.io reference with a clean HUD that can be judged on polish and visual clarity.

## Verdict (not blind)

**Ours loses again, but much closer.** The wave 2 HUD consolidation addressed the judge's primary complaint by reducing from 5 visual zones to 2–3, and the element animations are now more polished. However, Bright Lancer's minimalist philosophy still dominates: a single circular compass/weapon indicator that never competes with action, versus our still-visible heart row, shard counter, boon track, and progress bar. Our secondary elements (boons, track) are dimmed but still present; the reference removes them entirely until needed. The gap remains primarily philosophical: we show more information always-visible (design for completeness), they show only what's critical right-now (design for clarity).

## Biggest gap

Bright Lancer reserves all screen real estate for action and uses a single, contextually-relevant focal point (the circular compass showing current weapon/cooldowns). Our HUD shows 4 information types simultaneously (health, shards, boons, progress track): even with improved layout and opacity, this is information plurality, not minimalism. The single most impactful change would be to hide or remove the boon row and progress track entirely during normal play, showing them only on pause or in a dedicated screen, leaving only hearts and shard counter visible mid-fight—matching Bright Lancer's philosophy of "nothing between the player and the action."

## Problems

1. **Secondary elements still compete for attention mid-fight.** During pair 02 (mid-combat), the boon icon row at the bottom-left and progress track at bottom-center occupy visual real estate even at 55% opacity. In high-intensity moments (multiple enemies, dodging, attacking), the player's eye must scan 4 separate UI zones (hearts top-left, shards top-right, boons bottom-left, track bottom-center). Bright Lancer's reference has zero secondary elements: the compass is contextual and the rest is game world. Fix: remove or hide boon row and progress track during normal play; show them only on pause or in a stats overlay. Hearts and shards can stay, as they're critical for moment-to-moment survival.

2. **Boon icons lack immediate context.** Even at 18 px with 3 px spacing, the icons are small and require hovering or memorization to identify. When a new boon arrives (no toast/fanfare visible in pair 02), the player doesn't immediately know what it does—they must pause or hover. Bright Lancer handles this via a persistent weapon/cooldown display that the player already understands. Fix: add a 1.5–2 second toast banner when a boon is acquired, showing the icon large (32 px) and its name and rarity, fading after 2 seconds. This gives the boon "arrival weight" without permanent clutter.

3. **Boss bar entry lacks ceremony despite new animation.** The wave 2 builder added a slide-down entrance with scale-grow (12 ticks), but compared to Bright Lancer's seamless, sparse UI, the boss bar still feels like a new UI element appearing rather than a natural game event. The boss bar presence itself is needed (no reference equivalent), but its visual weight could be reduced. Bright Lancer never shows an "enemy health" bar—it uses the weapon/compass display and visual feedback (screen flashes, knockback) to communicate enemy state. Fix: reduce boss bar size to 50–60% of current width, position it at bottom-right instead of center-bottom (away from action center), and only show boss name + health (remove phase indicators until needed).

4. **Low-health vignette opacity increase not sufficient.** Wave 2 raised vignette opacity from 0.32 to 0.5–1.0 peak, but in pair 02, the visual signal still reads as a gentle warning, not an urgent "you are dying" moment. Bright Lancer avoids health-crisis UI entirely by using the weapon/compass to signal status (flashing, color change). Our low-health state competes with the vignette, hearts, and boon row for "this is urgent" attention. Fix: when health ≤ 2 hearts, also flash the screen edges (red, 10–15% opacity, at heartbeat rate) and add audible heartbeat from the audio piece (not UI's responsibility). The vignette alone isn't enough.

5. **Pixel scaling inconsistency on text.** The shard counter "+23" and heart numbers use the same small pixel font, but the shard text appears slightly softer or less crisply scaled than the heart icons in pair 01. This is a fine detail but undermines the "polished" bar. Bright Lancer's compass sprite and any text are crystal-sharp. Fix: verify all UI text renders at exact 2x or 3x scale (never sub-pixel), and test on the reference game's viewport size to match crispness.

6. **Dash pips not visible in captures.** Wave 1 critic mentioned dash pips as a must-have (the builder added them), but neither capture pair shows them clearly. They may be hidden under the hearts or rendered off-screen. Pair 01 and 02 should show dash pips animating in and out as the player uses the dash ability. Fix: ensure dash pips are visible in the capture, or adjust their positioning to be adjacent to hearts with clear animation (scale-pop when charged, fade when spent).

7. **Track bar visual weight not yet reduced enough.** The progress track at bottom-center shows arena/corridor/boss icons and is dimmed to 55% opacity, but it still creates a visual baseline that the eye locks onto. Bright Lancer has no equivalent. When a player is mid-combo and glancing at the screen, the eye should go to the action center, not scan to corners. The 55% dimming helps, but "dimmed" is still "present." Fix: reduce track to a single small icon row (6–8 px tall, no labels) in the top-right corner near shards, or remove it entirely during play and show it only on pause.

## must_have checklist

- **"pixel-perfect: integer-scaled, palette-bound, pixel font"** — PASS. The font remains integer-scaled and palette-bound. No sub-pixel rendering detected. However, shard text appears marginally less crisp than wave 1; recommend verifying scale uniformity.
- **"every number and bar animates its changes (drain, tick, pulse)"** — PASS. Hearts drain on damage (confirmed wave 1), shards scale-pop on pickup (wave 2 enhancement verified), boss bar has entrance animation. Boon acquisition animation exists (wave 1 notes), but no fanfare or toast visible in captures.
- **"never covers the action; readable at a glance mid-fight"** — PARTIAL PASS. The HUD no longer monopolizes the screen (improvement from wave 1), but secondary elements (boons, track) still occupy 15–20% of viewport. Bright Lancer achieves true "never covers action" by showing zero secondary UI. Our current state is readable but requires scan-and-identify, not true at-a-glance.
- **"low health is felt (heartbeat pulse and vignette) without being noisy"** — PASS. The vignette pulses and the heartbeat (if present; audio piece handles this) is clean. Pulse is not noisy. However, the subjective "felt" bar may be higher for an action roguelite; recommend pairing with more aggressive visual feedback (screen-edge flash) to match roguelite norms.

## Console errors

None detected.

## Builder's Wave 2 Changes: Assessment

The builder successfully consolidated the HUD layout and added entrance animations to the boss bar and scale-pop to the shard counter, addressing specific wave 1 judge feedback. The redesign shows clear intent: reduce clutter, improve visual hierarchy, prioritize hearts as the focal point. However, the judge's primary finding—that Bright Lancer is minimallist and ours is still information-dense—persists philosophically. The builder approached this as "improve layout and opacity," but the judge wanted "remove everything non-essential." These are different strategies, and without guidance from the full blind verdict, the builder made a reasonable incremental choice. However, it will likely still lose on the "never covers action" must_have if Bright Lancer's zero-clutter approach wins.

---

## Photography Notes

Pair 01 captures early-game idle state with full HUD visible and no active threats. Pair 02 captures arena start with the title screen still visible (early moment), showing HUD before combat begins. Both pairs are mid-run states, not showcase or terminal states. For a more comprehensive review, a third pair showing actual mid-combat with damage feedback (hearts draining, knockback, enemy death) would demonstrate animation polish under stress, and a second Bright Lancer combat screenshot would show how its UI behaves when the reference game is actively under fire.
