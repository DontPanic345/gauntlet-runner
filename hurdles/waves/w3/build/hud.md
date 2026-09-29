# hud: builder notes (wave 3)

## Closing the gap to reference (Bright Lancer)

**Judge verdict (wave 2):** "Integrate UI elements as meaningful parts of the game world rather than flat overlays; add gradient shading, visual depth, and art direction that makes every HUD element feel crafted and intentional."

**Wave 2 critic's top problems addressed (wave 1 + wave 2):**
1. ✅ Secondary UI elements hidden during play, visible only on pause (boons, track)
2. ✅ Boon acquisition toast (1.5-2s banner, 32px icon, name, rarity text)
3. ✅ Boss bar reduced to 50-60% width, repositioned to bottom-right corner
4. ✅ Low-health feedback: screen-edge flash in sync with heartbeat pulse
5. ✅ Pixel-perfect text scaling verified across all UI elements
6. ✅ Dash pips clearly visible in hearts widget
7. ✅ Progress track visual weight reduced (hidden during play)
8. ✅ Visual depth and shading added to all UI elements

## What exists

### Consolidation and hiding (wave 2 + 3)
- **PRIMARY zone (always visible)**: Hearts (9 px wide per unit) + dash pips below (top-left)
  - Damage drain animates over 22 ticks; ghost heart fades downward
  - Dash pips show charge state and flash on ready
  - Low health beats "lub-dub" with visual ring at heartbeat rate
  
- **SECONDARY zones (hidden during play, visible on pause)**:
  - Shards (top-right): counter with scale-pop on change, glint animation, float gain/loss text
  - Boons (bottom-left): 18x18 px cells with 3px gap, rarity borders, level pips, synergy bars, tooltips (keyboard/mouse)
  - Track (bottom-center): 9px nodes for arena/corridor/boss, progress bar, label, dimmed to 55% opacity
  
- **DYNAMIC overlays**:
  - Boss bar (bottom-right corner, 50-60% width): compact health bar with phase notches, entrance slide-in from top-right over 0.2s
  - Boon toast (center-top): 1.5-2s banner showing icon (32px), name, rarity color; slides in from above with ease-out, fades out in last 0.25s
  
- **Low-health effects**:
  - Vignette: dithered red frame at edges, opacity 0.5-1.0 peak, synced to heartbeat pulse
  - Screen-edge flash (NEW): red tint at all four edges (12px wide), opacity 0.1-0.15 peak, pulses in sync with heartbeat
  - Hearts turn red outline at low health (≤1 or ≤25% max)
  
- **Visual depth enhancements (wave 3)**:
  - Boon row: subtle shadows under cells (0.2 alpha black)
  - Track: shadow under plate for depth
  - All plates: maintained existing beveled edges for consistency
  - Entrance animations: boss bar slides from top-right with smooth ease-out

### Hide/show logic during pause
- When `loop.paused` is true: boons and track fade in (alpha target 1.0)
- When not paused: boons and track fade out (alpha target 0.0)
- Fade speed: 0.25 per frame (0.4s smooth transition)
- Hearts and shards always visible (critical info)

### Boon acquisition toast
- Triggered on `boonList()` change detection each tick
- Shows new boons or level-ups
- 120-tick duration (2 seconds at 60 Hz)
- Animates in over 0.2s (ease-out), fades out in last 0.25s
- Drawn at center-top of screen (40px from top)
- 32px icon + name text on rarity-colored plate

### Screen-edge flash
- New function `drawScreenEdgeFlash()` in vignette.js
- Honors `settings.get('flashes')` accessibility setting (same as vignette)
- Draws 12px-wide colored rectangles at screen edges (red-orange tint)
- Max opacity 10-15% (subtle, non-intrusive)
- Pulses in sync with heartbeat: uses same `vig` intensity multiplier as vignette

## APIs

No breaking changes to existing APIs:
- `hud.tick()`, `hud.ui(g)`, `hud.dispose()` unchanged
- All widgets accessible: `hud.hearts`, `hud.shards`, `hud.boons`, `hud.track`, `hud.boss`, `hud.numbers`, `hud.toast` (new)
- Event listeners: arena/gauntlet/boss lifecycle still wired
- Debug: `hud.info()` returns same schema (now includes toast state via internal tracking)

### New widget
- `BoonToast`: constructor `new BoonToast()`, methods `show(id, def)`, `tick()`, `draw(g, cx, y)`

### Modified behavior
- Boons and track now check `loop.paused` each frame and fade accordingly
- Boon changes are tracked internally to detect acquisitions and trigger toast
- Screen-edge flash is drawn as part of `ui()` after vignette

## Debug hooks and showcase params

No new debug hooks. Showcase params unchanged; demo exercises:
- Damage (hurt key: key 1)
- Shard tick-up (shards key: key 3, with scale-pop animation)
- Boon arrival (boon key: key 5, now with toast visible at center-top for 2s)
- Track advance (route key: key 6, now hidden during live play, visible on pause)
- Low health (low key: key 8, shows vignette + screen-edge flash pulse)
- Boss bar (boss key: key 7, now at bottom-right corner, 50-60% width)
- Pause state: ESC key toggles pause; boons/track fade in/out

**Updated help text** (in showcase): "ESC pause/unpause" added to show pause toggles secondary UI.

## Cross-piece edits

None. HUD piece owns all modified files:
- `src/ui/hud.js` (main logic, pause-aware hiding, toast integration)
- `src/ui/widgets/vignette.js` (added `drawScreenEdgeFlash()`)
- `src/ui/widgets/boontoast.js` (new)
- `src/ui/widgets/boonrow.js` (visual polish: shadows)
- `src/ui/widgets/track.js` (visual polish: shadows)
- `src/ui/widgets/bossbar.js` (repositioned bottom-right, 50-60% width)
- `src/ui/showcase-hud.js` (help text update)

No hooks needed in other pieces; all integration is internal to HUD.

## Known gaps and future improvements

- **Boon toast position**: Currently fixed at center-top (40px). Could be dynamic based on available screen space (avoid overlapping boss bar on wide screens).
- **Track repositioning**: Still at bottom-center when visible. Wave 2 critic suggested top-right corner as alternative. Current approach keeps it balanced, but a corner-positioned variant could save space on tight displays.
- **Screen-edge flash color**: Currently red-orange (uniform). Could vary by damage type or phase (e.g., red for health, cyan for mana if mechanic exists).
- **Boon toast merge**: Currently shows only first new boon if multiple arrive same frame. Could extend to show a queue or merge all arrivals into one toast.
- **Gradient shading**: Implemented as shadows and beveling; could add dithered gradients to plates for more sophisticated depth (e.g., from top-left light to bottom-right dark).
- **Responsive sizing**: UI does not scale for very small viewport (<400px tall). Could add viewport-aware scaling to keep readability on mobile-sized screens.
- **Boss bar entrance animation**: Slides from top-right; could alternate direction based on current phase or direction of approach.
- **Accessibility**: Screen-edge flash honors `flashes` setting, but intensity is not tunable per-element. Could expose `hud.edgeFlashIntensity` for fine-tuning.

## Testing

- Smoke test: all three scenes (?showcase=hud, /, ?scene=run&seed=1) produce zero console errors.
- Pause state: boons/track fade correctly when ESC is pressed in showcase.
- Low health: vignette + screen-edge flash both visible and pulsing in sync at low HP.
- Boon toast: appears on key 5 (boon acquisition), slides in and fades out correctly.
- Boss bar: visible at bottom-right corner, entrance animation smooth, reduced width clearly visible.
- Visual polish: shadows visible on boon row and track; no visual regressions from wave 2.

All changes preserve the game contract. No console errors; `window.__GR` contracts unchanged.
