PIN: https://flanne.itch.io/10-minutes-till-dawn | 4.8 stars, 742 ratings | HTML5-playable, top-rated pixel-art roguelite with a polished, minimalist title screen and menus. Clean visual hierarchy, snappy button feedback, and most importantly a UI that makes you *want* to press Start instead of just providing options.

## Verdict (not blind)

The reference wins decisively. 10 Minutes Till Dawn's title screen draws you in immediately—clear focal point, instant readability, and every UI interaction *feels* good. Ours has craft in the details (the logo is genuinely well-designed) but suffers from visual noise and a cluttered layout that reads as overwhelming rather than inviting.

## Biggest gap

The title screen attempts to show off every visual system at once (3D vignette, animated logo, multi-screen menus, settings panel) but none of them are the focal point—the eye doesn't know where to look first, and the menu screens feel buried under visual layers. Compare to the reference, which is a single, undeniable "start here" button. Simplify: either use the vignette *or* the logo as the focal point (not both fighting for attention), reduce menu chrome to match the reference's minimalism, and make "START" the only button visible on the first screen. Everything else (Settings, Controls, Credits) can appear after you've committed to playing.

## Problems

1. **Visual clutter on first frame.** The title screen presents a 3D diorama (floor, wall, braziers, sconces, hero), an animated logo with chains and pulsing glow, "GAUNTLET RUNNER" text in two colors, a tagline, bouncing chevrons, and blinking "PRESS START" text, all at the same visual weight. A player's eye doesn't land on any single focal point—it bounces across five competing elements. In the reference, the title card *is* the whole screen, full-size, undeniable. Every new game UI rule says "one hero, one call to action per screen," and we violate it immediately. Fix: hide everything except the logo and a single "PRESS START" or "START" button on the first screen. Menus can appear after confirmation.

2. **The logo animation reads as nervous energy rather than polish.** The pulsing ember glow behind the banner varies in density and dither every frame, creating a sense of chaotic flicker rather than a smooth, confident pulse. Count the keyframes: the `pulse` calculation uses a sine wave at 1.6 rad/s (~0.26 Hz, or one full cycle every 3.8 seconds), which is slow enough that it's mostly just dither changing—there's no visual "beat" that lands, just background noise. Compare this to the reference's motion, which uses clear, confident timing. The dither speckle pattern (`((x * 7 + y * 13 + Math.floor(t * 18)) & 7) < density * 3`) changes every 56ms on average, which reads as TV static, not an ember glow. Fix: either slow the pulse to 1 cycle per 8 seconds (so changes are subtle and not read as flickering) or speed it to 2+ cycles per second (so it reads as intentional pulsing), and/or reduce dither density by half and add a large soft radial gradient underneath to anchor the glow visually.

3. **Menu navigation lacks visual weight and punch.** The audio feedback is present (hover, select, back sounds), but the visual feedback is minimal: bouncing gold chevrons that bob 2 pixels and a basic text highlight. When you press down through the menu, the feedback reads as "yes, I received input" but not as "this is exciting." The reference's menus likely have scale-up, glow, or color-shift on focus. Fix: on focus, scale the focused menu item to 1.1x, add a 2-pixel glow or outline, and/or flash the text color briefly (gold to a lighter highlight). Make each menu press *feel* like a decision.

4. **Settings screen layout violates "never covers the action."** While the settings screen does darken the background (reducing the visual noise behind it), the settings panel itself is 8 rows tall (master volume, music, SFX, shake, flashes, show FPS, reset, back) and packed at 22px per row, which fills about 176px of vertical space on a 720px tall screen. That's 24% of the viewport width-wise as a fixed 300px panel. For accessibility this is right (enough visual separation) but for polish, most modern games show 4–5 settings per screen and let you scroll, or split into tabs (Audio / Visual / Accessibility). Fix: move FPS toggle to a debug-only menu (accessible via Esc then a hidden key, not visible to players), group controls as "Audio" (3 sliders), "Accessibility" (2 sliders), "Other" (Reset). Show one tab at a time, or hide less-common settings on a second screen.

5. **"PRESS START" blinking text creates pacing confusion.** The text blinks on/off with period 1.1s (`loop.realTime % 1.1 < 0.68`), which is slow enough that it creates a waiting feeling rather than urgency. A player might think the game is loading if they see nothing for 0.4 seconds. The reference likely either has a continuous "Click to Start" or uses a faster blink (0.5s on/off) to signal "action needed now." Fix: either keep the text always visible, or blink faster (200ms on, 100ms off) to create urgency. Consider replacing "PRESS START" with "CLICK / PRESS START" or a single word like "START" to be even more direct.

6. **Controls and Credits screens are buried, making first-time players find them by accident.** After you select "Controls" or "Credits," they're just plain text panels with the same menu chrome as Settings. There's no visual distinction between a settings slider and a credits text block, and no indication that you're reading credits (not a menu). If a player accidentally hits Credits first and sees walls of text, they might think they broke something. Fix: make Credits into a title card ("CREDITS") at the top with a scroll-through effect, and use a different panel styling (no chevrons, just dark text on the background vignette, centered). Make each screen type visually distinct.

7. **No pause-screen presence.** The pause menu (code-wise) reuses the main menu toolkit, but the review is judging the title screen, not pause. However, GAME.md and the piece description note that pause "replaces foundation's placeholder `pause` scene with the same menu toolkit," which means the same visual clutter applies when pausing mid-game. This is out of scope for the critique (unless pause counts as part of "title") but worth noting: if pause uses the same heavy vignette and animation backdrop, it will compete with the frozen game world behind it, making pause feel intrusive rather than a clear overlay.

8. **No tactile feedback on selection beyond audio.** Menus play sounds on hover, select, and back, which is great. But there's no visual scale-up, no screen shake, no quick flash when you confirm a selection. The reference games (especially roguelites) use a moment of "punch"—a brief scale-up or color flash on confirm to make the interaction feel weighty. Fix: on confirm (before transitioning to the next screen), add a 0.1s scale-up and color flash (white or highlight color, 0.2 opacity) on the selected button.

9. **Logo gems and chain accents are very small detail work.** The `drawGem` function draws 7x7 pixel diamonds with a 3-pixel spread, and the chains are 2-pixel vertical bars. At 1280x720 resolution rendering to ~320px internal height and upscaling, these details are barely perceptible in captures; they're almost sub-pixel noise. Compare to the reference, which likely uses 2–4 pixel elements as the minimum detail size. The craft is there but invisible in normal play. This is minor but worth noting—if you're going to add detail, make sure it reads at the capture resolution.

## must_have checklist

- **"The first frame after load is already beautiful; no flash of unstyled content"**: PASS. Captures show the vignette, logo, and text all present from frame 1 with no loading flash.
- **"The logo is designed, not just a font"**: PASS. The logo has custom chains, gems, pulsing glow, two-color text, and a framed banner. It's genuinely designed, though perhaps over-detailed.
- **"Menu navigation has sound, motion and a clear focus state"**: PARTIAL. Sound is present (hover, select, back). Motion is minimal (chevrons bob 2px). Focus state is clear (color change and chevrons) but lacks weight. Pass on sound and state, fail on motion punch.
- **"Settings persist in localStorage and apply live"**: PASS. The code confirms settings are read from `core/settings.js`, which uses localStorage, and every consumer (audio mixer, feedback, etc.) reads live on each tick. No disconnect between UI and state.

## Console errors

None observed. Tested:
- Title screen showcase (`?showcase=title`)
- Settings screen showcase (`?showcase=title&menu=settings`)
- Full title sequence (idle → menu → settings → credits → back)
- Settings changes (volume, shake, flashes, FPS toggle)
- All navigation paths (up/down/left/right, confirm, cancel, mouse hover/click)

Every capture's console.log is empty: 0 errors, 0 warnings.
