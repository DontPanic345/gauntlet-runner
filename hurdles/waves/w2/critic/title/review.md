# Title Screen Review - Wave 2

## Reference

**10 Minutes Till Dawn** — https://flanne.itch.io/10-minutes-till-dawn — 4.8 stars, 742 ratings

HTML5-playable, top-rated pixel-art roguelite with a polished, minimalist title screen and menus. The reference establishes the standard: clean visual hierarchy, undeniable focal point, snappy button feedback, and most importantly a UI that makes you *want* to press Start instead of just providing options. It's the benchmark this piece must clear.

## Verdict (not blind)

**The reference still wins decisively.** Our title screen has improved in visual craft and animation, but it remains fundamentally over-cluttered. The 3D diorama backdrop, animated logo banner, tagline, and "PRESS START" text all compete for the player's eye instead of creating a single, clear call-to-action. Where the reference's minimalism creates confidence ("Click here, now"), ours creates visual noise ("Look here... or maybe here... or here?"). A player encountering this for the first time feels overwhelmed, not invited.

## Biggest gap

**The title screen still tries to be three things at once (a 3D scene, a logo reveal, and a menu) when it should be one undeniable thing: "START HERE."** Strip the screen down to a single focal element—either the logo alone on a dark background, or a minimal text button reading just "START"—and remove the competing 3D vignette, the tagline, and the hero model. Let everything else (Settings, Controls, Credits) appear only after the player commits to playing. This is not a cosmetic fix; it's a fundamental reframing of what the first screen communicates.

## Problems

1. **Visual hierarchy still unclear on first frame.** Three layers fight for attention: a detailed 3D voxel scene (hero, torch braziers, floor tiles, wall detail), an animated golden banner with the "GAUNTLET RUNNER" logo and pulsing glow, and large "PRESS START" text below it. None is obviously the focal point. The vignette lighting creates a warm, inviting mood, but mood is not hierarchy—a player's eye bounces across all three elements with equal weight. The reference solves this by having *only* a title card and a character; nothing else competes. **Fix:** Pick one focal element. If you keep the 3D diorama, remove the logo banner and replace it with centered text "PRESS ANY KEY TO START" in a large, simple font over the diorama. If you keep the logo, remove the diorama and use pure dark background. Do not do both.

2. **The logo animation still lacks confident timing.** The pulsing glow behind the "GAUNTLET RUNNER" banner uses fine dither that changes every frame, which reads as visual TV static rather than a pulse. The pulse itself is slow (~3.8 second cycle), so it's mostly a change in dither density rather than a visible light beat. A player watching this for 5+ seconds doesn't see confidence; they see the game struggling with the effect. **Fix:** Either slow the pulse to 1 cycle per 8 seconds (so dither changes are barely noticeable and the overall glow is calm) *or* speed it to 2 cycles per second (so the pulse reads as a clear, intentional rhythm). Reduce dither density by 30-50% and anchor it with a large soft radial gradient so the glow feels like light, not static.

3. **"PRESS START" text timing creates a waiting feeling instead of urgency.** The text blinks on/off with a period of 1.1s, which is slow enough that players see a 0.4s blank window and think "Is it loading?" The reference likely uses either a continuous, always-visible prompt or a fast blink (200ms on, 100ms off) to signal "Act now." **Fix:** Either remove the blink entirely (keep text always visible), or blink much faster (200ms on / 100ms off) to create urgency rather than a waiting feeling. Better yet, replace "PRESS START" with just "START" or "PLAY" (fewer syllables, faster read, clearer call-to-action).

4. **Menu screen layout still lacks visual distinction and simplicity.** When you navigate to Settings, the screen adds a dark overlay panel with sliders and options, but the background vignette remains visible and animated behind it. This creates visual competition: the player's eye is drawn to the still-animated 3D scene rather than the settings panel. Additionally, the Settings screen shows 5 sliders (Master Volume, Music, SFX, Screen Shake, Flashes) plus a Reset button, which is dense for a settings UI. Most modern games show 3-4 options per tab or split them across screens (Audio tab, Visual tab, Accessibility tab). **Fix:** When the settings panel opens, fully darken or blur the background (not a translucent overlay). Group settings into clear tabs: "Audio" (3 sliders), "Accessibility" (2 toggles), "Display" (brightness, etc.). Show one tab at a time and let the player arrow-key or click between tabs. This is both more scannable and more professional.

5. **Menu navigation lacks visual punch and weight on selection.** When you arrow down through the menu, the focused item gets a text-color change (to gold/highlight) and the gold chevrons bob slightly (2 pixels). This feedback is visual confirmation ("I received your input") but not satisfying (no scale-up, no flash, no momentary emphasis). The reference menus likely have a clear scale-up or glow effect on focus. **Fix:** On focus, scale the focused menu item to 1.1x size, add a 2-pixel highlight glow (1.5-2 pixels around the text), and/or give it a brief color pulse (200ms flash to a brighter tone). On confirm (before the transition), add a 0.1s scale-up to 1.2x plus a white or gold flash (0.3 opacity) to make the selection feel weighty.

6. **Controls and Credits screens are not visually distinct.** After you select "Controls" from the menu, the screen changes to a dark panel with text, styled identically to the Settings panel. If a player is unfamiliar with the menu, they might not immediately realize they're reading a reference instead of adjusting something, and the visual uniformity makes the menus feel generic. **Fix:** Give each screen type a unique visual treatment. "Controls" should have a title card ("CONTROLS") at the top in a larger font, and the text should be laid out clearly with key names on the left and actions on the right, separated by a line or grid. "Credits" should be even more distinct—a centered scroll-through of names on a clean dark background, with no chevrons or menu chrome. Use typography and layout to make the purpose of each screen immediately clear.

7. **Logo detail (gems, chains) is nearly invisible.** The `drawGem` function renders 7x7 pixel diamonds and 2-pixel chain bars. At the final render resolution (1280x720) after upscaling from the internal 320x180 res, these details are sub-pixel noise. You've added craft that renders invisible. **Fix:** Either scale up the gem and chain sizes (use 10x10 or 14x14 pixel gems), or accept that at this render scale, the logo should rely on bold colors and large shapes instead of fine detail. Pixel art detail must be readable at the capture resolution.

8. **No tactile feedback on menu confirm beyond audio.** The menus play audio on hover, select, and back—good—but there's no visual "punch" when you confirm a selection. In the reference and other polished roguelites (like Hades or Dead Cells), confirming a menu choice gives a momentary scale-up, flash, or screen shake to confirm the decision feels weighty. **Fix:** On confirm, apply a 0.15s scale-up animation (1.0 to 1.15x) and a white flash (0.25 opacity) over the entire button. Consider a tiny screen-shake (2-3 pixels) on confirm to add impact.

9. **No visual or audio feedback when transitioning from title to gameplay.** After pressing Start on a new run, the screen cuts to black and then fades in the first arena. There's no "whoosh" sound, no transition effect, no sense of commitment being made. Compare to the reference, which likely has a clear, satisfying transition. **Fix:** Add a 0.3-0.5s transition: fade the title screen to black with a "whoop" or descend sound, then fade in the arena. This moment should feel like crossing a threshold into the gauntlet, not just a technical cut.

10. **Settings do not persist or apply immediately to audio.** The review notes from wave 1 said settings persist in localStorage and apply live, which is good. However, during testing, changes to volume sliders don't produce immediate audio feedback—players can't hear that their volume change took effect. **Fix:** On every volume slider movement, play a test beep or a short chime at the new volume level so the player hears the change live.

## Must-have checklist

- **"The first frame after load is already beautiful; no flash of unstyled content"**: PASS. The vignette, logo, and text are all present and styled from frame 1.
- **"The logo is designed, not just a font"**: PASS. The logo has chains, gems (though tiny), pulsing glow, two-color text, and a framed banner. It is designed, though the animation lacks polish.
- **"Menu navigation has sound, motion and a clear focus state"**: PARTIAL. Sound is present (hover, select, back). Motion is minimal (chevrons bob 2px). Focus state is clear (color change) but lacks weight. The motion and feedback together feel timid rather than polished.
- **"Settings persist in localStorage and apply live"**: PASS. Settings are read/written to localStorage and consumers (audio mixer, accessibility settings) read live each tick.

## Console errors observed

None. Tested:
- Title screen (`/`)
- Title showcase (`?showcase=title`)
- Settings menu navigation and adjustment
- Full menu traverse (down, up, confirm, back)
- Settings changes (volume, shake, flashes, FPS toggle)
- All navigation paths (keyboard, mouse, gamepad simulation)

Every capture's console.log is empty: 0 errors, 0 warnings. The foundation is sound; the issue is design, not implementation.

