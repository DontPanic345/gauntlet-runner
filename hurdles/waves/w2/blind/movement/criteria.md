# Blind comparison: movement and camera

**Question:** Bursts of starts, stops, turns and dashes around corners. Which movement looks tighter and more responsive?

Each strip is sampled at 10 frames per second and is read left to right, top to bottom. Every frame is the same fixed window at the centre of the game screen, so the camera's own motion shows up as the background shifting. The windows are sized so the character appears at about the same height on both sides. Judge how the character moves and how the camera frames it: how quickly it starts and stops, how cleanly it turns and dashes, and how it moves along walls. Ignore art style, colour, backgrounds, other characters and on-screen prompts.

- **Pair 01:** both panels show the character standing, running in one direction for about 0.6 s, then stopping and settling (16 frames, 1.6 s).
- **Pair 02:** both panels show the character running right, reversing to the left, then reversing to the right again, about 0.45 s per leg (16 frames).
- **Pair 03:** both panels show the character tracing a box with 8-way input (down, down-left, left, up-left, up, up-right, right), about 0.35 s per direction (24 frames).
- **Pair 04:** both panels show the character running right and dashing, then turning up-right and dashing again, then stopping (24 frames).
- **Pair 05:** both panels show the character holding a diagonal into a wall and sliding along it (24 frames).
