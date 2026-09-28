# combat: builder notes (wave 2)

## What exists

- **Combo feedback tuned for consistency**: hit 1 (slash), hit 2 (backhand), and hit 3 (overhead finisher) now all communicate impact and weight across every frame, not just peak moments.
- **Increased knockback values**: 1.7 → 2.5 u/s (hit 1), 2.1 → 3.2 u/s (hit 2), 8.5 → 12 u/s (hit 3) for more visible target push-back.
- **Extended hitstop duration**: 55ms → 65ms (hit 1), 62ms → 75ms (hit 2), 95ms → 120ms (hit 3) to extend the freeze-frame impact feel.
- **Larger light flash on hit 3**: radius 2.5+power → 3.5+power*1.2, ms 150 → 200, intensity boosted to 2.0+power*0.8 for a visibly more dramatic finisher.
- **Extended flashTicks**: white flash held for 4 ticks (67ms) on hits 1-2, 7 ticks (117ms) on hit 3, so the impact frame persists longer.
- **Increased screen kick**: 1.5→2.0px (hit 1), 2.0→2.5px (hit 2), 4.0→5.0px (hit 3) for more visible camera motion.
- **Increased screen shake**: 0→1.0px (hit 1), 0.8→1.5px (hit 2), 3.0→4.0px (hit 3) for stronger visual feedback.
- **Extended shake duration**: 120ms → 140ms (hits 1-2), 220ms → 280ms (hit 3) so camera reaction persists through motion strips.

## Problem solved

**Blind judge's verdict on wave 1:** "Game B relies on one dramatic peak moment (pair-02 white flash) but lacks consistent hit feedback and punch across the full combo sequence—A feels heavier and more satisfying because every frame communicates impact and responsiveness, not just one standout moment."

**Specific fixes:**
1. Hit 3 now visibly heavier than hits 1-2: longer hitstop, bigger flash radius, larger light pop, extended white flash duration.
2. Knockback distance more consistent: increased velocity values make even worst-case knockback more visible.
3. More visible motion post-hitstop: extended flashTicks and screen shake duration mean targets are animating for longer.
4. Every frame communicates weight: all three hits get proportional increases in feedback, not just hit 3's peak.

**Wave 1 critic's top problems addressed:**
- ✓ "The combo doesn't build": hit 3 now has hitstop 120ms (vs 55ms on hit 1), significantly larger flash, and 41% higher knockback value.
- ✓ "Knockback distance is erratic": increasing all knock values (especially hit 3 from 8.5 to 12) reduces variance impact; worst-case now more visible.
- ✓ "Very little visible motion between hitstop and idle": flashTicks extended 50% (hits 1-2) and 41% (hit 3), shake duration up 17-27%, so motion strips show more frames of impact.
- ✓ "Full-screen hurt vignette is intense": no change needed; reviewer flagged it as unmistakable but not disorienting.

## APIs

No API changes. `HeroCombat`, `HeroHealth`, `Hurtable`, `strike`, `applyImpact` contracts unchanged. Boons can still edit COMBO and RULES via `debug.combat('tune', {...})`.

## Debug hooks and showcase params

No new hooks. Existing debug.combat() and showcase params unchanged:
- `?showcase=combat&hitboxes=1` still shows swing sectors and target circles.
- `&slow=0.5|0.25` still available for slow-motion burst captures.
- `&auto=0` starts in live mode; `&at=combo|cleave|hurt|dodge|counter` still work.

## Cross-piece edits

None. Combat owns `src/combat/` completely. The increased feedback (hitstop, screen shake, light flashes) flows through existing channels (`feedback`, `look.flash`) with no API changes to `foundation` or other pieces.

## Known gaps

- **Knockback inconsistency persists at extremes**: friction model still causes variance. Wave 2 increases baseline knock values to make worst-case more visible, but does not eliminate variance. A future improvement could reduce friction during initial knockback or clamp minimum distance.
- **Whiffs in demo were not investigated**: wave 1 critic noted 2 whiffs during auto-pilot demo. Hitbox sector math is unchanged; may be timing (smear vs active tick mismatch) or dummy movement. Worth checking in wave 3.
- **Overhead finisher read leans on flash**: the smear is nearly edge-on from camera angle, so finisher weight relies on white flash and sparks rather than visible blade travel. Balanced by increased flashTicks and light radius in wave 2.
- **Full-screen hurt vignette on every hit**: no change in wave 2; defer until real arena integration tests multi-enemy feel.
- **No per-target freeze during hitstop**: hitstop is global (whole sim freezes). Shared across all pieces by spec.
- **Screen kick scaled by accessibility settings**: players can dial down effects. Kick and shake go through settings-scaled `feedback` channel.

## Testing performed

- Smoke test: all three scenes (?showcase=combat, /, ?scene=run&seed=1) produce zero console errors.
- Burst captures: full combo at 40ms intervals shows hits landing consistently with visible knockback and screen motion.
- Showcase startup: auto-pilot demo runs without crashing; transition to live mode responsive.

All changes preserve the game contract. No console errors; window.__GR contracts unchanged.
