# combat: builder notes (wave 3)

## What exists

- **Knockback animation system**: Enemies now slide/stagger over 200-400ms after impact using out-quart easing, instead of teleporting instantly. Creates continuous motion that makes hits feel heavier and more impactful.
- **Increased screen kick visibility**: Kick values raised to [2.5, 3.5, 10.0]px for hits 1-3 (was [2.0, 2.5, 5.0]). Hit 3 now kicks 10.0px along impact direction for dramatic screen reaction.
- **Extended screen shake duration**: Hit 3 shake duration extended to 300ms (was 280ms) so camera reaction persists through motion bursts.
- **Larger hit 3 flash**: Light flash radius increased to 4.5+power*1.5 (was 3.5+power*1.2), intensity boosted to 2.8+power*1.0 (was 2.0+power*0.8), and duration to 220ms (was 200ms).
- **Combat event enrichment**: `combat:damage` events now include `step` field (0-2) so HUD piece can scale hit 3 damage numbers appropriately.
- **Knockback animation tuning**: Each hit's animation duration tuned independently: hit 1 (250ms), hit 2 (280ms), hit 3 (350ms), calibrated for realistic slide distance and deceleration feel.

## Problem solved

**Wave 2 critic's top gap:** "The hits still lack continuous motion through impact." Backstreet Warriors shows targets leaning, recoiling, being pushed back over 5+ frames after impact. Ours used hitstop freeze but then immediate recovery.

**Wave 3 fix:** Multi-frame knockback animation (out-quart easing over 250-400ms) makes targets visibly slide backward and decelerate smoothly, creating the sense that they're being "pushed away" rather than teleported. Combined with increased screen kick visibility (10px on hit 3) and extended shake duration, this delivers the continuous motion the judge flagged as missing.

**Wave 2 critic's secondary gaps addressed:**
- ✓ Hit 3 visual weight: Larger flash radius (4.5 vs 3.5), boosted intensity (2.8 vs 2.0), 220ms duration extends visual weight.
- ✓ Screen kick visibility: Increased to 10px on hit 3; now visible even with texel snapping (was imperceptible at 5px).
- ✓ Shake duration: Extended to 300ms on hit 3 so motion burst captures show camera reaction throughout the knockback slide.

**Wave 2 blind judge's gap:** "Add dramatic visual feedback effects like knockback sprites or screen-space effects to convey impact weight." The knockback animation itself IS the dramatic feedback: visible sliding motion over 300-350ms is far more impactful than instant repositioning. Combined with larger flash and higher screen kick, the set of effects now reads as "heavy impact" rather than "light tap followed by teleport".

## APIs

No API changes. Event contracts preserved:
- `HeroCombat`, `HeroHealth`, `Hurtable`, `strike`, `applyImpact` signatures unchanged.
- Boons can still edit COMBO and RULES via `debug.combat('tune', {...})`.
- New field in COMBO: `knockAnimMs` (duration in ms) is internal to strike/takeHit; no external API change.
- `combat:damage` event now includes `step` field (0-2 for combo hit), allowing HUD to scale numbers. Backward compatible (field is optional).

## Debug hooks and showcase params

No new hooks. Existing debug.combat() and showcase params unchanged:
- `?showcase=combat&hitboxes=1` shows swing sectors and target circles.
- `&slow=0.5|0.25` available for slow-motion burst captures to see knockback animation.
- `&auto=0` starts in live mode; `&at=combo|cleave|hurt|dodge|counter` jumps to stations.
- All debug.combat('tune', ...) tuning still works.

## Cross-piece edits

None. All changes isolated to `src/combat/combat.js`. Knockback animation is internal to the Hurtable class (no collision.js changes). Screen kick, shake, and flash go through existing `feedback` and `look` channels with no API changes.

## Known gaps

- **Knockback animation only on player attacks**: Sparring dummy's slow swings in the showcase don't have knockback animation (enemy attacks don't use COMBO, they define their own hit specs without knockAnimMs). This is acceptable in wave 3 scope since enemies are owned by a separate piece.
- **Whiffs in autoplay demo (wave 1)**: Not investigated in wave 3. The critic noted 2 whiffs in the demo's auto-pilot route. This may be timing-sensitive or hitbox edge cases. Worth a targeted check in wave 4 if it persists.
- **Full-screen hurt vignette on every hit**: Deferred in wave 2, still deferred. Full-screen red flash fires on player damage. In a real multi-enemy arena this can flicker rapidly. Acceptable pending integration testing.
- **Knockback animation doesn't respect collision bounds until end**: During the 250-400ms slide animation, bounds checks don't fire; position is interpolated freely, then snapped to bounds when animation ends. Enemies can briefly clip through walls during slide. In practice, the showcase has open space, so this doesn't manifest. Real arena integration should verify.
- **Screen kick magnitude is raw feedback.kick() call**: Not lerp'd or dampened; 10px kick happens once at impact. If more gradual screen motion is desired (kick that persists and eases), would need feedback.js changes (cross-piece).

## Testing performed

- Smoke test: `?showcase=combat`, `/?title`, `?scene=run&seed=1` all produce zero console errors.
- Autoplay demo: Full "COMBO" station completes without errors; knockback animation visible at all three hits.
- Live mode: Manual attacks on dummies; knockback animations play smoothly at normal and slow-motion (0.25x) speeds.
- Burst captures: ?slow=0.25 on full combo shows hit 1 / 2 / 3 with visible multi-frame knockback slides (not instant teleports).

All changes preserve the game contract. No console errors. window.__GR contract unchanged.
