# hud: builder notes (wave 2)

## Consolidation from feedback

**Judge verdict (wave 1):** "Game B must reduce information clutter dramatically—consolidate the 5 competing UI elements (hearts, shards, boons, track, boss bar) into 2-3 visual zones with clear priority hierarchy, hide secondary information unless it's actively relevant, and adopt A's principle that the action must never be obscured."

**Critic's main problems:**
1. Screen clutter mid-fight: 5 competing clusters occupying 25% of viewport
2. Boon row readability: small, tight icons with no separation or labels
3. Track bar visual weight: competing with hearts for scan priority
4. Boss bar entrance: no animation or fanfare
5. Shard counter animation: less snappy than hearts
6. Low-health vignette: too subtle at 0.32 opacity
7. Visual hierarchy: no clear focal point, eye bounces between corners

## What exists

**Consolidation layout (wave 2):**
- **PRIMARY zone (top-left)**: Hearts (9 px wide per unit) + dash pips below. Unchanged from wave 1; remains the most prominent and draws attention first.
- **SECONDARY zones**: 
  - Shards (top-right): smaller counter, right-aligned, now with scale-pop animation
  - Boons (bottom-left): larger cells (18x18 px, up from 16x16), 3 px gap (up from 2 px), improved readability
  - Track (bottom-center): reduced visual weight via opacity 0.55 (down from 1.0), smaller nodes (STEP=9 down from 13), smaller label (scale 1), no longer competes with hearts
- **DYNAMIC overlay (center-bottom)**: Boss bar animates in from top with slide, scale, and brief shake (12-tick entrance)

**Animation improvements (wave 2):**
- **Shard counter**: Scale-pop on change (0.2 s grow: 1.0 → 1.2 → 1.0) using canvas transform
- **Boss bar entrance**: Slides down 30 px over 12 ticks with quadratic ease-out, scales alpha from 0 to 1, brief shake for impact
- **Low-health vignette**: Increased from 0.32 peak to 0.5 baseline + 0.5 * beat (0.5–1.0 range), much more aggressive danger signal
- **Damage numbers**: Enabled in HUD (inherited from wave 1 system)

**Visual hierarchy fixes:**
- Track bar at 55% opacity no longer dominates; a secondary info source
- Boon icons 12% larger with 50% more breathing room between them
- Hearts dominate top-left with no competing elements
- Boss bar centered at bottom only when active, doesn't intrude until needed
- Each zone has a clear purpose: survival (left), resources (right), progress (center bottom)

## APIs

No API changes. All existing hooks maintained:
- `hud.tick()`, `hud.ui(g)`, `hud.dispose()` unchanged
- `hud.hearts`, `hud.shards`, `hud.boons`, `hud.track`, `hud.boss`, `hud.numbers` all accessible
- Events: arena/gauntlet/boss lifecycle still wired (no changes to listeners)
- Debug: `hud.info()` returns same schema

**New property (internal):**
- `hud.vignetteIntensity`: multiplier for vignette opacity; defaults to 1, can be tweaked live (e.g., for accessibility during intense moments)

## Debug hooks and showcase params

No new debug hooks. Showcase params unchanged; demo automatically exercises:
- Damage (hurt key)
- Shard tick-up (shards key, now with scale-pop animation)
- Boon arrival (boon key, now with larger, clearer icons)
- Track advance (route key, now at 55% opacity in new position)
- Low health (low key, now with 50% opacity vignette, much more visible)
- Boss bar (boss key, enters with slide animation)

Capture guidance: Boon row improvements and low-health vignette are most visually distinct changes. Damage numbers continue to show from combat system (enabled in HUD by default).

## Cross-piece edits

None. HUD piece owns all modified files. No hooks needed in other pieces.

## Known gaps

- **Vignette intensity tweak**: Currently hardcoded at 1.0; could add live tuning for accessibility (e.g., reduce for photosensitivity, keep low health readable but less aggressive)
- **Track bar repositioning**: Moved to bottom-center; some scenes (gauntlet corridor) might benefit from a "escape progress" bar that fades in dynamically. Current approach treats track as always-passive.
- **Boon cell expansion**: Icons grew from 16x16 to 18x18; at zoom 0.5 or on tiny screens, may still feel tight. No responsive scaling implemented.
- **Boss bar slide-in**: Entrance animation triggers on `show()`, not on phase changes; no per-phase entrance fanfare beyond the white flash.
- **Damage number merging**: Wave 1 system supports stacking and merging; showcase could better highlight this with a multi-enemy combo, but current script focuses on single-hit demo.
- **Shard scale-pop vs. hearts drain**: Both animate, but at different tempos (pop: 0.2 s, drain: 22 ticks ≈ 0.37 s). Could unify for visual consistency, but trade-off: hearts need the longer drain for feedback on damage, shards benefit from quick pop for satisfying feedback on pickup.

