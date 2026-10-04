# Blind comparison: movement and camera

**Question:** Bursts of starts, stops, turns and dashes around corners. Which movement looks tighter and more responsive?

Each strip is sampled at 10 frames per second, read left to right and top to bottom. Every frame is the same fixed window at the centre of the game screen (a 480x270 crop of a 1280x720 screen, shown at 320x180), so the camera's own motion shows as the background shifts. Judge the player character's motion and the camera's framing of it: how quickly it starts and stops, how cleanly it turns and dashes, and how it moves along walls. Ignore art style, colour, backgrounds, other characters, and on-screen prompts.

- **Pair 01:** both panels: the character standing, running in one direction for about 0.6 s, then stopping and settling (16 frames, 1.6 s).
- **Pair 02:** both panels: the character running right, reversing to left, then reversing to right again, about 0.45 s per leg (16 frames).
- **Pair 03:** both panels: the character tracing a box with 8-way input (down, down-left, left, up-left, up, up-right, right), about 0.35 s per direction (24 frames).
- **Pair 04:** both panels: the character running right and dashing, then turning up-right and dashing again, then stopping (24 frames).
- **Pair 05:** both panels: the character holding a diagonal into a wall and sliding along it (24 frames).
