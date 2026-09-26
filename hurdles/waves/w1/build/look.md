# look: builder notes (wave 1)

## What exists

- **Post chain** (`src/render/post.js`), installed into `display.pipeline`. Everything runs at the internal resolution:
  1. A colour pass of every layer into a half-float target.
  2. An edge pass of layer 0 only: view-space normals plus a depth texture.
  3. A composite that applies, in order:
     - a 1-px **outer outline** in ink on depth edges;
     - **crease light** on convex fold edges;
     - a **top-rim light** on silhouette top edges, so characters read against dark floors;
     - **torch haze**, a screen-space glow around each active light;
     - **pit fog** below y = 0, reconstructed from depth;
     - a 3-ring **vignette**;
     - a cool **shadow lift** and a highlight **shoulder**;
     - a **palette quantise**: every pixel is snapped to the 32 palette colours. The lookup is a 64^3 LUT built at startup with OKLab distance and extra chroma weight. **Ordered dithering** applies only between two colours of similar hue and not in the deep darks. `ember` and `flame` are reserved: lit surfaces never quantise into them, and pixels that already are exactly those colours (fire, emissive voxels) pass through.
- **World-anchored dither.** Both Bayer patterns, the quantise one and the voxel material's AO one, are offset by the camera's snapped texel position, so the pattern moves with the world. Pan test: two frames 40 ticks apart in a pan, with flicker frozen and vignette off. After shifting by the camera's texel delta, 98.8% of pixels are identical. The rest are the animated ooze and hero, plus dust. With the vignette on, the only extra differences are content crossing the fixed vignette rings at the screen edges.
- **Lighting** (`src/render/lights.js`):
  - The rig is a cool hemisphere, a cool key light from the front-left, and a rim light.
  - The key light casts hard `BasicShadowMap` shadows (1024 map, 32 texels per world unit). The shadow camera follows the view and is snapped to shadow texels in light space, so shadows do not crawl.
  - A **fixed pool of 8 point lights** means adding or removing a torch never recompiles a shader. Each frame the torches nearest the camera target get a light.
  - Torch flicker is deterministic, stepped at 12 Hz from sim time, with gusts and a jitter of up to one voxel in the light position.
  - Three **moods**: `crypt` (default), `collapse` (plum and ember), `boss` (violet and teal).
- **Automatic shadows.** Every mesh with a lit material casts and receives shadows. Other pieces do nothing to get them.
- **`?showcase=look`** (`src/render/showcase.js`, models in `src/render/showcase-models.js`): a crypt arena at game scale (640x360, zoom 1). It contains:
  - a flagstone floor with an inlaid arena ring, moss, cracks and a blood stain;
  - a brick back wall with a barred arch, keystone skull, banners and chains, plus side walls;
  - 4 wall sconces and 2 braziers, all real flickering lights, and a cold light shaft over the centre;
  - candles, barrels, crates, bone piles and rubble;
  - a stand-in hero, a skeleton and an ooze with ember eyes, each with a one-texel idle animation;
  - rising embers and 1-2 texel dust;
  - a slow sinusoidal camera pan (±2.2 units, 24 s period).
  The models are stand-ins; `hero`, `enemies` and `arenas` own the real ones.
- **Normal play** gets the look too. Foundation's placeholder stage torches now each register a light.

## APIs

```js
import { look } from '../render/look.js';          // main.js calls look.install() after display.init()
look.torch(anchorObject3D, { y, x, z, color: 'flame', intensity: 1, radius: 6, flicker: 1, haze: 1 }) -> handle
  // follows the anchor's world position every frame; handle.intensity = n; handle.remove()
  // dropped automatically once the anchor leaves display.scene (scene exit), so no teardown needed
  // haze: 0 for lights hung high above the floor (the screen-space glow would float in mid-air)
look.flash(x, y, z, { color: 'torch', ms: 120, intensity: 2, radius: 4 })  // short light pop: hits, explosions
look.mood('crypt' | 'collapse' | 'boss')           // gauntlet corridors: 'collapse'; the Warden: 'boss'
look.noOutline(obj)    // obj and its children on LAYER_NO_OUTLINE: drawn, but no outline, no edge, no shadow. Use for particles and glows.
look.noShadow(obj)     // obj casts no shadow (userData.noShadow = true, inherited by children)
look.snap(vec3)        // snap a render position to whole screen texels (keeps depth). Use on moving models so they don't boil.
look.options           // live tunables, see postOptions in post.js (outline, outlineDepth, rim, crease, quantize,
                       // dither, ditherBand, vignette, fog, fogDepth, glow, exposure, shoulder, shadowLift, enabled)
look.lights            // the pool: .torches (Set), .active, .flickerOn, .moodName, MAX_LIGHTS = 8
```

- Particle systems (`vfx`) should use `MeshBasicMaterial` with palette colours via `hex()`, and call `look.noOutline(mesh)`. Exact `ember` and `flame` survive quantise untouched. Other colours snap to their nearest palette entry.
- Emissive voxels (`'name!'` in model keys) draw unlit and outlined. They are the right choice for coals, eyes and runes.
- A hit flash through the voxel material's `flash` uniform, in a palette colour, quantises to that colour.

## Debug hooks and showcase params

- `__GR.debug.look(opts?)`: set any `postOptions` key, plus `mood` and `flicker` (false holds every torch at its base intensity, which makes pixel-exact diffs possible). It returns the current options with `mood`, `flicker`, `torches`, `lightsUsed`, and `ms` (JS time in the pipeline).
- `?showcase=look` params:
  - `&pan=0`: hold the camera still.
  - `&t=<s>`: start the pan phase at s seconds (at `t=0` it pans fastest).
  - `&zoom=1..3`.
  - `&mood=crypt|collapse|boss`.
  - `&hud=0`: no labels, for clean stills.
  - `&raw=1`: post off, the unprocessed frame for comparison.
- Keys:
  - 1 toggles post; 2 outlines; 3 palette quantise; 4 dither; 5 crease light; 6 haze.
  - M cycles the mood.
  - Space toggles the pan.
  - Z cycles the zoom.
  - H toggles the labels.
  - P or Esc pauses.
- `state().showcase` = `{id, panning, panT, camX, zoom, mood, post, outline, quantize, torches}`.
- Pan-snap test recipe: `debug.freeze(true)`, `debug.look({flicker:false, vignette:0})`, shoot, `debug.step(40)`, shoot. Then shift the second frame by `(round(camX2*32) - round(camX1*32)) * scale` px and diff. Static geometry matches exactly.

## Cross-piece edits

- `src/main.js` (foundation): one import, plus `look.install()` right after `display.init()`. `look` needs the renderer, and module imports run before init.
- `src/render/voxel/material.js` (foundation): added the `voxelUniforms.ditherOrigin` uniform and used it as the offset of the AO Bayer lookup. The program cache key moved to `gr-voxel-v2`. Without this the AO dither is screen-anchored and crawls over static geometry while the camera pans.
- `src/core/stage.js` (foundation): each stage torch registers `look.torch(...)`, and the particle InstancedMesh gets `look.noOutline`. The placeholder run, title and foundation showcase are now lit by their torches, and their 1-texel dust is not outlined.
- `src/core/showcase.js` (foundation): set `load` on the `look` row.

## Known gaps

- **Only 8 lights at once.** With more than 8 torches in a room, the ones farthest from the camera target get no light. A torch that loses or gains a slot pops rather than fading. Arenas with many torches need either a fade by rank or a larger pool.
- **Point lights cast no shadows.** Only the cool key light does. Characters standing next to a brazier have no warm shadow.
- **Palette gaps.** There is no dark red or dark warm-grey step. Dried blood and torch-lit stone at low light collapse into `dirt` or `shadow`. A palette retune (keeping the names) would widen what survives quantise. The mid-dark cool range is where most of the frame lives, and it has only 4 or 5 usable steps.
- **Flat surfaces sit between two colours.** Some lit flat surfaces (the skeleton's skull top, the pale slabs) land between two same-hue palette colours and render as a 50% checker. That reads as pixel-art texture at 1x but can look busy at zoom 2 or more.
- **The outline does not reach the ground.** It comes from depth edges, so a character's feet, where they meet the floor, have no outline. Sprites that hug the ground (the ooze's base) blend into dark floors at the bottom edge.
- **Moving models are not snapped automatically.** Pieces must call `look.snap()` on render positions. The showcase does, but a piece that forgets gets sub-texel boiling on its models.
- **The vignette is screen-fixed.** Its 3 rings change pixels as the world pans under them, at the screen edges only.
- **Showcase stand-ins.** The hero, enemies and props are the look piece's own stand-ins, authored quickly. The barrels read as boxes at 1x, and the bone piles read as small creatures.
- **Performance is untested on real hardware.** Headless software GL runs at about 22 fps both with and without post, so post is not the bottleneck there (0.6-1.5 ms of JS per frame). The two scene passes, 8 point lights and a shadow map have not been profiled on a real GPU.
- **The UI canvas is not quantised.** It uses palette colours through `css()`, but alpha blends (the pause dimmer, the feedback flash) produce off-palette mixes.
