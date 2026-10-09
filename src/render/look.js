// The render look (piece `look`). Importing this module once (main.js does) installs it:
// the post chain goes into display.pipeline, the light rig is retuned, shadows are turned on.
// Every other piece just builds voxel meshes; they come out lit, outlined and on-palette.
//
//   import { look } from '../render/look.js';
//   look.torch(obj, { y: 1.1 })         flickering warm point light following obj (see lights.js)
//   look.flash(x, y, z, { color, ms })  a brief point-light pop (hits, explosions)
//   look.mood('crypt'|'collapse'|'boss')
//   look.noOutline(obj)                 obj (and children) drawn without outline or shadow (particles, glows)
//   look.noShadow(obj)                  obj (and children) cast no shadow
//   look.snap(vec3)                     snap a world position to the screen texel grid (moving sprites)
//   look.options                        live tunables (post.js postOptions)
//
// Shadows are automatic: every mesh with a lit material (Lambert / Phong / Standard) casts
// and receives, unless it (or an ancestor) has userData.noShadow.

import * as THREE from 'three';
import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { debug } from '../core/debug.js';
import { voxelUniforms } from './voxel/index.js';
import { createPost, postOptions, LAYER_NO_OUTLINE } from './post.js';
import { createLights, MOODS } from './lights.js';

const cp = Math.cos(CAMERA_PITCH), sp = Math.sin(CAMERA_PITCH);
const origin = { x: 0, y: 0 };
const v = new THREE.Vector3();

let post = null;
let lights = null;
let installed = false;
let frameMs = 0;

function markShadows(scene) {
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const lit = m && (m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshStandardMaterial);
    let off = !lit || o.layers.mask === (1 << LAYER_NO_OUTLINE);
    for (let p = o; p && !off; p = p.parent) if (p.userData.noShadow) off = true;
    o.castShadow = !off;
    o.receiveShadow = !!lit;
  });
}

function pipeline(renderer, scene, camera) {
  const t0 = performance.now();
  if (!postOptions.enabled) { renderer.shadowMap.needsUpdate = true; renderer.render(scene, camera); return; }
  const P = PPU * camera.zoom;
  const c = camera.position;
  origin.x = Math.round(c.x * P);
  origin.y = Math.round((c.y * cp - c.z * sp) * P);
  voxelUniforms.ditherOrigin?.value.set(origin.x, origin.y);

  lights.update(Math.min(0.1, (t0 - (pipeline.last ?? t0)) / 1000), display.cameraTarget);
  pipeline.last = t0;
  markShadows(scene);

  // torch haze positions in pixels (bottom-left origin, like gl_FragCoord)
  const w = display.width, h = display.height;
  for (let i = 0; i < post.glowPos.length; i++) {
    const a = lights.active[i];
    if (!a) { post.glowPos[i].set(0, 0, 1, 0); continue; }
    v.copy(a.pos).project(camera);
    post.glowPos[i].set((v.x + 1) / 2 * w, (v.y + 1) / 2 * h, a.r * P * 0.24, a.i * a.haze);
    post.glowColor[i].copy(a.color);
  }
  post.render(scene, camera, origin);
  frameMs = performance.now() - t0;
}

export const look = {
  options: postOptions,
  MOODS,
  LAYER_NO_OUTLINE,
  get lights() { return lights; },
  get frameMs() { return frameMs; },

  install() {
    if (installed) return;
    installed = true;
    const r = display.renderer;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.BasicShadowMap; // hard, pixel-edged shadows
    r.shadowMap.autoUpdate = false;          // post.js renders the map once per frame
    lights = createLights(display);
    post = createPost(r);
    display.pipeline = pipeline;

    debug.add('look', (opts) => {
      if (opts && typeof opts === 'object') {
        for (const k in opts) {
          if (k === 'mood') lights.mood(opts.mood);
          else if (k === 'flicker') lights.flickerOn = !!opts.flicker;
          else if (k in postOptions) postOptions[k] = opts[k];
        }
      }
      return { ...postOptions, mood: lights.moodName, flicker: lights.flickerOn, torches: lights.torches.size, lightsUsed: lights.active.length, ms: +frameMs.toFixed(2) };
    });
  },

  torch(anchor, opts) { return lights.torch(anchor, opts); },
  flash(x, y, z, opts) { return lights.flash(x, y, z, opts); },
  mood(name) { return lights.mood(name); },

  noOutline(obj) {
    obj.traverse((o) => o.layers.set(LAYER_NO_OUTLINE));
    obj.userData.noShadow = true;
    return obj;
  },
  noShadow(obj) { obj.userData.noShadow = true; return obj; },

  /**
   * Snap a world position so it lands on whole screen texels (keeps its depth along the
   * view axis). Use for moving models' render positions so their pixels do not boil.
   */
  snap(p, out = p) {
    const P = PPU * display.zoom;
    const r = p.x;
    const u = p.y * cp - p.z * sp;
    const b = p.y * sp + p.z * cp;
    const rs = Math.round(r * P) / P, us = Math.round(u * P) / P;
    out.set(rs, us * cp + b * sp, -us * sp + b * cp);
    return out;
  },
};

// main.js calls look.install() right after display.init(); a late import installs itself.
if (display.renderer) look.install();
