// Lighting (owned by `look`): a cool ambient rig with one shadow-casting key light, plus a
// fixed pool of warm point lights that the game's torches, braziers and fire borrow.
//
// The pool size never changes (MAX_LIGHTS point lights always exist, idle ones at zero
// intensity), so adding or removing a torch never recompiles a shader. Each frame the
// torches nearest the camera target get the lights.
//
//   const t = lights.torch(anchorObject3D, { y: 1.1, color: 'flame', intensity: 1, radius: 6 });
//   t.intensity = 0.5;  t.remove();
//   lights.flash(x, y, z, { color: 'torch', ms: 120, intensity: 2, radius: 4 });  // hit / explosion pop
//   lights.mood('crypt' | 'collapse' | 'boss');
//
// Torches follow their anchor's world position every frame, and go dark (and are dropped)
// when the anchor leaves the scene, so scene teardown needs no extra bookkeeping.

import * as THREE from 'three';
import { hex, PALETTE } from './palette.js';
import { loop } from '../core/loop.js';

export const MAX_LIGHTS = 8;
const tmp = new THREE.Vector3();

// Mood presets: ambient sky/ground, key light, and how warm/strong torches are.
export const MOODS = {
  crypt: {
    sky: 'mist', ground: 'violet', hemi: 1.9,
    key: 'frost', keyI: 1.1, keyDir: [-3, 9, 5],
    rim: 'blue', rimI: 0.9,
    torch: 1,
  },
  // the collapse: ember-lit dust, the ceiling coming down
  collapse: {
    sky: 'plum', ground: 'shadow', hemi: 2.0,
    key: 'rose', keyI: 0.7, keyDir: [-2, 9, 5],
    rim: 'ember', rimI: 0.9,
    torch: 1.2,
  },
  boss: {
    sky: 'violet', ground: 'ink', hemi: 1.8,
    key: 'fog', keyI: 0.9, keyDir: [1, 9, 5],
    rim: 'teal', rimI: 1.1,
    torch: 1.1,
  },
};

// deterministic value noise for flicker
function hash(n) { n = Math.sin(n * 127.1 + 311.7) * 43758.5453; return n - Math.floor(n); }
function noise1(t) { const i = Math.floor(t), f = t - i; const u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; }

export function createLights(display) {
  const scene = display.scene;
  const { hemi, key, rim } = display.lights;
  const pool = [];
  for (let i = 0; i < MAX_LIGHTS; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 6, 1.15);
    l.name = `look:point${i}`;
    scene.add(l);
    pool.push(l);
  }
  scene.add(key.target);

  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  const SH = 16; // shadow camera half-size in world units: 32 units / 1024 texels = 32 texels per unit
  Object.assign(key.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 0.5, far: 60 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0015;
  key.shadow.normalBias = 0.03;

  const torches = new Set();
  const flashes = [];
  let seq = 0;
  let moodName = 'crypt';
  let mood = MOODS.crypt;

  const api = {
    MAX_LIGHTS,
    pool,
    torches,
    get moodName() { return moodName; },
    /** false holds every torch at its base intensity (for pixel-exact capture diffs). */
    flickerOn: true,

    /**
     * Register a flickering warm light that follows `anchor` (any Object3D in the scene).
     * opts: y (height above the anchor, world units, default 1), x/z offsets, color (palette
     * name, default 'flame'), intensity (default 1), radius (world units, default 6),
     * flicker (0..1, default 1), haze (0..1 screen-space glow around the source, default 1;
   * use 0 for lights hung high above the floor, whose glow would float in mid-air).
     */
    torch(anchor, opts = {}) {
      const t = {
        id: ++seq,
        anchor,
        offset: new THREE.Vector3(opts.x ?? 0, opts.y ?? 1, opts.z ?? 0),
        color: new THREE.Color(hex(opts.color ?? 'flame')),
        intensity: opts.intensity ?? 1,
        radius: opts.radius ?? 6,
        flicker: opts.flicker ?? 1,
        haze: opts.haze ?? 1,
        phase: hash(seq * 7.13) * 100,
        world: new THREE.Vector3(),
        live: 0,       // flickered intensity this frame
        remove() { torches.delete(t); },
      };
      torches.add(t);
      return t;
    },

    /** A short point-light pop (hits, explosions, spell casts). Takes a pool slot for its life. */
    flash(x, y, z, { color = 'torch', ms = 120, intensity = 2, radius = 4 } = {}) {
      flashes.push({ pos: new THREE.Vector3(x, y, z), color: new THREE.Color(hex(color)), ms, left: ms, intensity, radius });
    },

    /** Switch the ambient rig: 'crypt' (default), 'collapse', 'boss'. */
    mood(name) {
      if (!MOODS[name]) throw new Error(`look: unknown mood "${name}"`);
      moodName = name; mood = MOODS[name];
      hemi.color.setHex(hex(mood.sky));
      hemi.groundColor.setHex(hex(mood.ground));
      hemi.intensity = mood.hemi;
      key.color.setHex(hex(mood.key));
      key.intensity = mood.keyI;
      rim.color.setHex(hex(mood.rim));
      rim.intensity = mood.rimI;
      rim.position.set(6, 3, -8);
      return name;
    },

    /** Flicker value (about 0.75..1.08) for a torch at sim time t. Stepped at 12 Hz: pixel-art flicker. */
    flickerAt(phase, t) {
      const s = Math.floor(t * 12) / 12;
      const slow = noise1(s * 1.3 + phase);
      const fast = hash(Math.floor(s * 12) + phase * 13.7);
      const gust = noise1(s * 0.35 + phase * 2.1);
      return 0.8 + 0.18 * slow + 0.08 * fast - 0.12 * Math.max(0, 0.55 - gust);
    },

    /** Per frame, before the colour pass: flicker, assign pool lights, aim the shadow light. */
    update(realDt, target) {
      const t = loop.simTime;
      // key light and its shadow camera follow the camera target, snapped to shadow texels
      const d = mood.keyDir;
      const texel = (SH * 2) / key.shadow.mapSize.x;
      key.position.set(d[0], d[1], d[2]).normalize().multiplyScalar(30);
      // snap in the light's own view plane so shadow edges never crawl while the camera pans
      const lightDir = tmp.copy(key.position).normalize();
      const right = new THREE.Vector3(0, 1, 0).cross(lightDir).normalize();
      const up = lightDir.clone().cross(right).normalize();
      const rx = Math.round(target.dot(right) / texel) * texel;
      const uy = Math.round(target.dot(up) / texel) * texel;
      const fwd = target.dot(lightDir);
      const snapped = right.multiplyScalar(rx).add(up.multiplyScalar(uy)).add(lightDir.clone().multiplyScalar(fwd));
      key.target.position.copy(snapped);
      key.position.add(snapped);
      key.target.updateMatrixWorld();
      key.updateMatrixWorld();

      // candidates: live torches in the scene graph, plus flashes
      const cands = [];
      for (const tc of torches) {
        let o = tc.anchor, attached = false;
        while (o) { if (o === scene) { attached = true; break; } o = o.parent; }
        if (!attached) { torches.delete(tc); continue; }
        tc.anchor.updateWorldMatrix(true, false);
        tc.world.copy(tc.offset).applyMatrix4(tc.anchor.matrixWorld);
        const f = api.flickerOn ? 1 + (api.flickerAt(tc.phase, t) - 1) * tc.flicker : 1;
        tc.live = tc.intensity * f * mood.torch;
        // flame tip jitters by up to one voxel; light moves with it
        const jf = api.flickerOn ? tc.flicker : 0;
        const jx = (hash(Math.floor(t * 12) + tc.phase) - 0.5) * 0.08 * jf;
        const jz = (hash(Math.floor(t * 12) + tc.phase + 3.3) - 0.5) * 0.08 * jf;
        cands.push({ pos: tmp.copy(tc.world).add(new THREE.Vector3(jx, 0, jz)).clone(), color: tc.color, i: tc.live, r: tc.radius, haze: tc.haze, src: tc });
      }
      for (let k = flashes.length - 1; k >= 0; k--) {
        const f = flashes[k];
        f.left -= realDt * 1000;
        if (f.left <= 0) { flashes.splice(k, 1); continue; }
        const e = f.left / f.ms;
        cands.push({ pos: f.pos, color: f.color, i: f.intensity * e * e, r: f.radius, haze: 1, src: null });
      }
      // nearest to the camera target first (flashes win ties by being bright)
      cands.sort((a, b) => a.pos.distanceToSquared(target) - b.pos.distanceToSquared(target));
      for (let k = 0; k < MAX_LIGHTS; k++) {
        const L = pool[k], c = cands[k];
        if (!c) { L.intensity = 0; continue; }
        L.position.copy(c.pos);
        L.color.copy(c.color);
        // point light intensity is in candela; 3.2 per unit of torch intensity lights floor ~1.5 units below to about full
        L.intensity = c.i * 3.2;
        L.distance = c.r;
        L.decay = 1.15;
      }
      api.active = cands.slice(0, MAX_LIGHTS);
    },
    active: [],
  };
  api.mood('crypt');
  return api;
}

export { PALETTE };
