PIN: https://poncle.itch.io/vampire-survivors | 4.8 stars, 1652 ratings | Browser-playable HTML5 roguelite with the cleanest game-over summary screen in the genre: stats displayed beautifully, instant restart, and every death makes you want to try again immediately.

## Reference
**Vampire Survivors** (poncle.itch.io) — 4.8 stars, 1652 ratings

A browser-playable HTML5 roguelite where the entire design philosophy revolves around replayability: death → clean stats screen → one-key restart loops in under 1 second. The game-over screen is styled with care (art direction, clear typography, visual hierarchy), and stats are displayed as rewards rather than a chore. It's the genre's benchmark for "which ending makes you want to play again immediately?"

## Verdict (not blind)
**Reference wins.** Our run-flow is functional but joyless compared to what roguelites at this rating tier deliver for endings and replayability.

## Biggest gap
**The death sequence is instant, not cinematic:** The spec in the goal says "slow-mo, collapse of the screen," but what renders is a black fade to summary. The reference shows the death as a moment—screen shakes, effects linger, the camera pulls back—before cutting to the summary. Our version feels like a loading screen, not an ending. Add 300-500ms of slow-motion (0.3x time scale) as the hero falls, with the collapse rumble ramping up, before the fade-to-black. Make dying feel like a moment the player experiences, not a bug that snaps them to a menu.

## Problems

1. **No slow-motion effect on death (spec: "slow-mo, collapse of the screen")**
   - What you see: Instant black fade after hero falls
   - Happens: Every death (all test runs)
   - Why it hurts: Death reads as a punishment, not a climax. In Vampire Survivors, the screen shakes and effects play out over 400ms before summary appears—it feels like your run matters. Here, the hero simply vanishes. 
   - Fix: On death, set time scale to 0.3 and play a 400ms death sequence (rumble, screen effects, collapse audio ramp) before fading to summary. Reference: `src/core/` has time scale hooks already; this is a 30-line addition to `src/run/`.

2. **Summary screen is text-only, no visual design**
   - What you see: Plain dark background, centered text box, control legend at bottom
   - Happens: Every game-over screen
   - Why it hurts: This is the last image the player sees before restarting. It should be memorable or at least visually appealing. Compare to reference (Vampire Survivors): stats are framed beautifully, icons are prominent, a character portrait or scene art anchors the screen. Ours is a form. Zero reason to screenshot or remember it.
   - Fix: Add a voxel scene or silhouette behind the summary (e.g., the hero's last stand, or the arena they fell in, dimmed and blurred). Frame the stats with accent colors (use the palette's warm orange for high scores, cool blue for low). Make it a moment worth looking at.

3. **Summary-to-restart transition is abrupt; no "journey complete" moment**
   - What you see: Summary pops up instantly; pressing Space/Numpad returns to title with no transition
   - Why it hurts: Strong roguelites celebrate a run ending (even in death) with a brief, styled moment—a wipe, a camera pull, a fade through an effect. Ours cuts from summary → title with a black screen, same as quitting. Kills the "I'm eager to run again" feeling.
   - Fix: When summary appears, play a 500ms wipe (horizontal or vertical, matching the arena door wipes used elsewhere in the game). When player presses restart, fade through the collapse effect before cutting to title, not black. Reuse the door-slam vfx as a callback.

4. **Lore unlock text dominates the summary, competes with stats**
   - What you see: The lore message takes up 4+ lines and is in the same frame as the run stats
   - Why it hurts: The summary looks cluttered. Your eye doesn't know what to read first. Compare to reference: the stats are the star; lore is a small badge or footnote.
   - Fix: Move lore unlock to a separate small "LORE UNLOCKED" badge (like an achievement notification), or show it after the summary as a 2-second overlay that fades in and out. Keep the summary frame focused on stats.

5. **Victory sequence is missing cinematic setup (spec: "triumphant")**
   - What you see: Boss defeated, text overlay "THE WARDEN" and "THE GAUNTLET", boss health bar at bottom, seed shown
   - Why it hurts: This reads as the boss-end screen, not a victory celebration. The must_have says "victory sequence," but what's rendered is more like "boss phase end." There's no peak moment—no camera zoom on the hero, no explosion, no triumphant music swell visible.
   - Fix: On victory, trigger a 1-second sequence: slow-mo (0.5x), camera zoom-out showing the arena, a bright flash, particles burst from the center, then cut to a victory summary (same frame as death summary, but with "VICTORY" in gold, "THE GAUNTLET CONQUERED" as the subtitle). This is 1.5-2 seconds of pure "you did it" before showing stats.

6. **Restart speed is good (~1s per interaction) but no progress persistence**
   - What you see: After death, press Space → instant title, no best-time counter update shown
   - Why it hurts: If you beat your best time, there's no acknowledgement between runs. Vampire Survivors flags this instantly ("NEW RECORD" in the summary).
   - Fix: Add a small "★ NEW BEST TIME" indicator in the summary frame if time > best time. Highlight the best-time stat in gold when beaten. One line of logic, huge replay motivation boost.

## must_have checklist

- ✗ **death to back in control takes under 3 s if the player wants** — PASS on speed (1s to summary, 1s to start new run from there). FAIL on experience: should be death sequence → summary, not instant fade. The summary itself appears correctly, but the transition lacks the cinematic weight the spec implies.

- ✗ **transitions between segments are seamless and styled (wipes, camera moves)** — FAIL. Transitions are black fades. No wipes, no camera work, no visual interest. Every section cuts instantly to black then pops back in.

- ✗ **the run summary is a satisfying screen worth screenshotting** — FAIL. It's functional and readable, but not beautiful. No player would screenshot this unless showing stats. Compare to Hades or Vampire Survivors, where the summary screen is itself an artwork moment.

- ✓ **a full run is completable, and the seed is shown so runs can be shared** — PASS. Seed is displayed, seed persists across runs if you use "SAME SEED" option shown in summary.

## Console errors seen
None.

---

**One more thing:** The piece depends on `title`, `hud`, `boss`, `boons`, `gauntlet`, and `arenas`. When these pieces win their blind comparisons, the run-flow's gaps will feel sharper because every other piece will have done the work to make moments *feel* premium. A death sequence that's just a fade reads as "we ran out of time" when the boons piece has beautiful card animations. The summary needs to be a visual destination, not a loading screen.
