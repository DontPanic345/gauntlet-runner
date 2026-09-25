# Gauntlet-Runner — design bible

Every builder reads this before touching code. It exists so fourteen separately built
pieces add up to one game. Change it only with a reason, logged in `hurdles/LOG.md`.

## The bar

Highly rated pixel-art games on itch.io. Tactile and alive: every input answers within
one frame, every hit lands with weight, and every surface has a little motion or light.
"Works" is not the bar. The bar is "a stranger would pick ours over the reference".

## Concept

A fixed-camera, three-quarter view voxel action roguelite. A small hooded runner fights
down through **the Gauntlet**, a collapsing crypt beneath a mountain. A run is a chain of:

    [arena] -> boon choice -> [gauntlet corridor] -> [arena] -> ... -> [boss]

- **Arenas** seal their doors and throw enemy waves at you. You clear them to open the exit.
- **Gauntlet corridors** are short, trap-filled runs chased by the collapse: a wall of
  falling rock and embers that advances behind you. This is where the name comes from,
  and it sets the game apart. It turns "walk to the next room" into the tensest part of the run.
- **Boons** (pick 1 of 3 after each arena) change how you play, and you can see them work.
- **Boss**: The Warden, at the bottom of zone 1.

Scope for v1 is one zone: 5 arenas, 4 corridors, the boss, and a run of about 8 to 12 minutes.
A second zone is out of scope until every piece wins its blind comparison.

## Controls

| Action   | Keyboard            | Mouse          | Gamepad |
|----------|---------------------|----------------|---------|
| Move     | WASD / arrows       |                | L-stick |
| Attack   | J                   | LMB (aims at cursor) | X |
| Dash     | K / Space           | RMB            | A       |
| Interact | E                   |                | Y       |
| Pause    | Esc / P             |                | Start   |

Keyboard-only play must be fully viable. With no mouse movement in the last 2 s,
attacks aim along the facing direction. Critics drive the game with scripted
keyboard input, so anything that only works with a mouse cannot be judged.

## Look

- **Voxel pixel art.** The scene renders at a low internal resolution (about 320 to
  400 px tall) and is upscaled with nearest-neighbour filtering. The camera is
  orthographic and fixed at a three-quarter angle. Camera motion snaps to the texel
  grid so pixels never swim.
- Chunky voxels (hero about 10 voxels tall) with baked per-vertex ambient occlusion
  and one-pixel dark outlines. Dithered or flat shading, never smooth gradients.
- **Palette**: one limited palette (32 colours at most), defined once in
  `src/render/palette.js` and used everywhere, UI included. Mood is cool
  blue-violet shadow against warm torch and ember light. Ember orange (#ff7a2f-ish)
  is the signature accent, reserved for danger, fire, and the collapse.
- **Readability first.** Player, enemies, projectiles, and hazards must separate from
  the floor at a glance, even in a thumbnail.

## Feel rules (every piece)

- Input to visible response in 1 frame or less. No input dropped; buffer attack and
  dash for about 120 ms.
- Hits get hitstop (40 to 90 ms), a flash, knockback, particles, sound, and a small
  screen kick. Scale all of it with impact.
- Everything that appears animates in: spawn, pop, dust. Nothing blinks into existence.
- The world is never fully still: torch flicker, dust motes, idle breathing, embers.
- Screen shake and flashes go through one settings-scaled channel (accessibility).

## Sound

Everything is synthesised in WebAudio at runtime: SFX (jsfxr-style) and music. No
third-party audio files.

## Assets and licensing

No third-party art, models, or audio. Voxel models are authored in code or in text
formats checked into `src/`. The only exception is fonts: an OFL pixel font may be
vendored into `assets/fonts/` with its licence file next to it.
