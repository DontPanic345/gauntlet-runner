// The effects library (piece `vfx`). Each effect is a small choreographed sequence on the
// core pools: a hard first frame (flare, flash disc, white core), a fast burst, then slow
// settling pieces (falling chips, rising motes, a fading ring). Sizes are in screen pixels at
// zoom 1 (1 world unit = 32 px, 1 voxel = 4 px); positions are world units, y up.
//
// All randomness comes from the vfx stream (seedVfx), never from the game's rng, so effects
// never change gameplay determinism.

import { look } from '../render/look.js';
import { settings } from '../core/settings.js';
import {
  P, S, add, addShape, ramp, later, stampGhost, colorIndex,
  SPRITE, CUBE, STREAK, RING, DISC, STAR, ARC, PORTAL, BURST, FLOOR, FACING,
} from './core.js';

// ---- ramps (palette only, stepped) -----------------------------------------------------------
ramp('spark', [['white', 0.12], ['torch', 0.3], ['gold', 0.55], ['flame', 0.8], ['ember', 1]]);
ramp('sparkHurt', [['white', 0.15], ['rose', 0.4], ['red', 0.7], ['blood', 1]]);
ramp('sparkCool', [['white', 0.15], ['sky', 0.45], ['cyan', 0.75], ['teal', 1]]);
ramp('sparkRose', [['white', 0.12], ['rose', 0.45], ['plum', 0.8], ['violet', 1]]);
ramp('ember', [['torch', 0.1], ['gold', 0.35], ['flame', 0.65], ['ember', 1]]);
ramp('emberDim', [['flame', 0.3], ['ember', 0.75], ['red', 1]]);
ramp('dust', [['frost', 0.12], ['fog', 0.45], ['mist', 0.8], ['slate', 1]]);
ramp('dustDark', [['fog', 0.2], ['mist', 0.55], ['slate', 0.85], ['violet', 1]]);
ramp('dustWarm', [['bone/stoneLight', 0.2], ['stoneLight', 0.6], ['stone', 1]]);
ramp('soul', [['white', 0.1], ['frost', 0.3], ['fog', 0.6], ['mist', 0.85], ['slate', 1]]);
ramp('ghost', [['white', 0.08], ['sky', 0.3], ['cyan', 0.6], ['teal', 0.85], ['navy', 1]]);
ramp('ghostRed', [['white', 0.08], ['rose', 0.3], ['red', 0.6], ['blood', 1]]);
ramp('ghostGold', [['white', 0.08], ['torch', 0.3], ['gold', 0.6], ['flame', 1]]);
ramp('portalMote', [['white', 0.1], ['rose', 0.4], ['plum', 0.8], ['violet', 1]]);
ramp('gold', [['white', 0.15], ['torch', 0.35], ['gold', 0.75], ['flame', 1]]);
ramp('heal', [['white', 0.15], ['sky', 0.4], ['leaf', 0.75], ['moss', 1]]);
ramp('fire', [['torch/gold', 0.08], ['gold/flame', 0.25], ['flame/ember', 0.55], ['ember/red', 0.85], ['red/blood', 1]]);
ramp('mote', [['fog', 1]]);
ramp('moteLight', [['frost', 1]]);
ramp('moteDark', [['mist', 1]]);
ramp('grit', [['stoneLight', 0.5], ['stone', 1]]);
ramp('smoke', [['ink', 0.35], ['night', 0.7], ['shadow', 1]]);
ramp('smokeHi', [['shadow/ink', 0.4], ['dusk/night', 0.75], ['violet/shadow', 1]]);
ramp('flashWhite', [['white', 1]]);
ramp('flashInk', [['ink', 1]]);
ramp('killSpark', [['white', 0.15], ['torch', 0.35], ['flame', 0.65], ['ember', 1]]);

/** Palette sets for the multi-part effects: [flare col, flare hot, spark ramp, ring col]. */
const SETS = {
  hit: { col: 'gold', rim: 'ember', hot: 'white', spark: 'spark', ring: 'torch', chip: 'ember', light: 'torch' },
  hurt: { col: 'red', rim: 'red', hot: 'white', spark: 'sparkHurt', ring: 'rose', chip: 'sparkHurt', light: 'red' },
  cool: { col: 'cyan', rim: 'cyan', hot: 'white', spark: 'sparkCool', ring: 'sky', chip: 'sparkCool', light: 'sky' },
  rose: { col: 'rose', rim: 'rose', hot: 'white', spark: 'sparkRose', ring: 'rose', chip: 'sparkRose', light: 'rose' },
  ember: { col: 'flame', rim: 'ember', hot: 'torch', spark: 'spark', ring: 'ember', chip: 'emberDim', light: 'flame' },
};
const set = (name) => SETS[name] || SETS.hit;

// ---- rng -----------------------------------------------------------------------------------
let seed = 0x9e3779b9;
/** Reseed the vfx stream (captures that need identical effects call this before triggering). */
export function seedVfx(n) { seed = (n | 0) || 1; }
function rnd() {   // mulberry32
  seed = (seed + 0x6D2B79F5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const TAU = Math.PI * 2;

function light(x, y, z, color, intensity, radius, ms) {
  if (look.lights) look.flash(x, y, z, { color, intensity, radius, ms });
}

// ---- effects ---------------------------------------------------------------------------------

/**
 * Hit spark: a star flare that holds through hitstop, a thin ring, a fan of streaks along the
 * hit direction, and a few hot chips that fall and bounce.
 *   dx, dz: the direction the hit pushes (sparks fly that way). power: 0.5 .. 3.
 *   palette: 'hit' | 'hurt' | 'cool' | 'rose' | 'ember'
 */
export function hitSpark(x, y, z, { dx = 1, dz = 0, power = 1, palette = 'hit', light: lit = true } = {}) {
  const st = set(palette);
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const p = Math.max(0.3, power);
  // the flare: a small jagged burst, white-hot core, coloured rim, fat ink outline, so it reads
  // inside a torch pool. It sits a touch past the contact point, along the blow, so it does
  // not land on the same pixels as the target's own white flash.
  const fx = x + dx * 0.12, fz = z + dz * 0.12;
  const b = addShape(BURST, FACING, fx, y, fz, 0.13 + p * 0.025, st.rim, 'white', 0.42 + p * 0.1, 0.55, 8, rr(0, 50));
  if (b >= 0) S.col3[b] = colorIndex('ink');
  addShape(RING, FACING, fx, y, fz, 0.2, st.ring, st.hot, 0.18, 0.5 + p * 0.18, 0.3, 1);
  // directional streaks along the blow: the first few long and 2 px thick
  const n = Math.round(6 + p * 6);
  for (let k = 0; k < n; k++) {
    const lead = k < 4;
    const a = Math.atan2(dx, dz) + rr(-0.7, 0.7) * (lead ? 0.35 : 1);
    const spd = rr(7, 15) * (0.75 + p * 0.25) * (lead ? 1.25 : 1);
    const i = add(x, y + rr(-0.06, 0.1), z, Math.sin(a) * spd, rr(0.5, 5.5) * (0.7 + p * 0.2), Math.cos(a) * spd,
      rr(0.14, 0.32) * (0.85 + p * 0.15), lead ? 2 : 1, st.spark, STREAK);
    if (i < 0) break;
    P.stretch[i] = lead ? 0.085 : 0.055; P.drag[i] = 0.86; P.grav[i] = 16; P.pop[i] = 1; P.shrinkAt[i] = 0.75; P.fadeAt[i] = 0.7;
    P.floorY[i] = 0.02; P.bounce[i] = 0.3;
  }
  // a little back-spray against the hit, so it reads as an impact, not a jet
  for (let k = 0; k < 3; k++) {
    const a = Math.atan2(-dx, -dz) + rr(-0.9, 0.9);
    const i = add(x, y, z, Math.sin(a) * rr(3, 6), rr(1, 3), Math.cos(a) * rr(3, 6), rr(0.08, 0.14), 1, st.spark, STREAK);
    if (i < 0) break;
    P.stretch[i] = 0.03; P.drag[i] = 0.8; P.pop[i] = 1;
  }
  const chips = Math.round(1 + p * 1.5);
  for (let k = 0; k < chips; k++) {
    const a = Math.atan2(dx, dz) + rr(-1, 1);
    const i = add(x, y, z, Math.sin(a) * rr(1.5, 3.5), rr(3, 6), Math.cos(a) * rr(1.5, 3.5), rr(0.6, 0.9), 2, st.chip, CUBE);
    if (i < 0) break;
    P.grav[i] = 24; P.bounce[i] = 0.4; P.floorY[i] = 1 / 32; P.pop[i] = 1.5; P.shrinkAt[i] = 0.85; P.fadeAt[i] = 0.8;
  }
  // a white-hot, tight light: brighter than the torch pool it lands in, so it reads as a new source
  if (lit) light(x, y, z, palette === 'hit' ? 'white' : st.light, 2.2 + p * 0.6, 1.2 + p * 0.3, 50 + p * 15);
}

/**
 * Silhouette flash: a solid flat-colour copy of obj's pose drawn OVER the live body for a tick
 * or two. ink after a white hit flash gives the white / black alternation that makes a hit read
 * at thumbnail size. Skipped when the flashes setting is under half.
 */
export function silhouette(obj, { color = 'ink', ticks = 2, delay = 0 } = {}) {
  if (!obj || flashesLow()) return null;
  return stampGhost(obj, color === 'white' ? 'flashWhite' : color === 'ink' ? 'flashInk' : color, ticks / 60 - 0.001, delay > 0 ? delay / 60 - 0.001 : 0, { front: true, hard: true });
}
function flashesLow() { try { return (settings.get('flashes') ?? 1) < 0.5; } catch { return false; } }

/**
 * Slash smear: a crescent swept in a flat plane at height y. It sweeps in over the first
 * 30% of its life and is eaten from the tail for the rest.
 *   yaw: the facing the swing is centred on (0 = +z). span: arc in radians. radius: world.
 *   mirror: -1 swings the other way. palette: 'blade' | 'enemy' | 'ember' | 'cool'
 */
const SLASH = {
  blade: ['frost', 'white', 'mist'], enemy: ['red', 'rose', 'blood'], ember: ['flame', 'torch', 'ember'],
  cool: ['cyan', 'white', 'teal'], rose: ['rose', 'white', 'plum'],
};
export function slash(x, y, z, yaw, { span = 2.4, radius = 1.2, thick = 0.38, palette = 'blade', mirror = 1, life = 0.2, sparks = true } = {}) {
  const [c1, c2, c3] = SLASH[palette] || SLASH.blade;
  const i = addShape(ARC, FLOOR, x, y, z, life, c1, c2, radius, span, thick, 0.3);
  if (i < 0) return;
  S.col3[i] = colorIndex(c3);
  S.mirror[i] = mirror;
  S.yaw[i] = mirror > 0 ? yaw - Math.PI / 2 - span / 2 : yaw - Math.PI / 2 + span / 2;
  if (!sparks) return;
  // flecks thrown off the leading edge as it sweeps
  const ramp = palette === 'enemy' ? 'sparkHurt' : palette === 'ember' ? 'spark' : palette === 'cool' ? 'sparkCool' : 'soul';
  for (let k = 0; k < 5; k++) {
    const f = (k + 1) / 6;
    const th = yaw - mirror * (span / 2) + mirror * span * f;   // world angle along the sweep
    const px = x + Math.sin(th) * radius, pz = z + Math.cos(th) * radius;
    const tx = Math.cos(th) * mirror, tz = -Math.sin(th) * mirror;   // tangent, along the swing
    const j = add(px, y, pz, tx * rr(3, 6) + Math.sin(th) * 1.5, rr(0, 1.5), tz * rr(3, 6) + Math.cos(th) * 1.5, rr(0.12, 0.22), 1, ramp, STREAK);
    if (j < 0) break;
    P.delay[j] = life * 0.3 * f;
    P.stretch[j] = 0.03; P.drag[j] = 0.85; P.pop[j] = 1;
  }
}

/**
 * Dust puff: voxel cubes of dust that burst out low, rise a little, shrink and dissolve.
 *   dx, dz: push direction (a dash kicks dust backwards: pass the reverse). n: cubes. size: scale.
 */
export function dust(x, z, { dx = 0, dz = 0, n = 6, size = 1, y = 0.05, palette = 'dust', spread = 1 } = {}) {
  const dir = Math.hypot(dx, dz) > 0.01;
  const base = dir ? Math.atan2(dx, dz) : 0;
  for (let k = 0; k < n; k++) {
    const a = dir ? base + rr(-0.9, 0.9) * spread : (k / n) * TAU + rr(-0.3, 0.3);
    const spd = rr(0.8, 2.4) * (0.7 + size * 0.3);
    const i = add(x + Math.sin(a) * 0.1, y + rr(0, 0.1), z + Math.cos(a) * 0.1, Math.sin(a) * spd, rr(0.3, 1.3), Math.cos(a) * spd,
      rr(0.35, 0.65) * (0.8 + size * 0.2), Math.round(rr(3, 6) * size), palette, CUBE);
    if (i < 0) break;
    P.drag[i] = 0.88; P.grav[i] = -0.8; P.pop[i] = 1.25; P.shrinkAt[i] = 0.2; P.fadeAt[i] = 0.72;
  }
  // a couple of fine specks that hang a little longer
  for (let k = 0; k < Math.ceil(n / 3); k++) {
    const a = rr(0, TAU);
    const i = add(x, y + 0.1, z, Math.sin(a) * rr(0.5, 1.5), rr(0.4, 1.2), Math.cos(a) * rr(0.5, 1.5), rr(0.6, 1), 1, palette, SPRITE);
    if (i < 0) break;
    P.drag[i] = 0.93; P.grav[i] = -0.3; P.wob[i] = 1.5; P.ph[i] = rr(0, TAU); P.fadeAt[i] = 0.5;
  }
}

/** Footstep scuff: 2-3 tiny puffs behind the foot. */
export function step(x, z, { dx = 0, dz = 0, size = 1 } = {}) { dust(x - dx * 0.1, z - dz * 0.1, { dx: -dx, dz: -dz, n: 3, size: 0.85 * size, spread: 1.1 }); }

/** Landing: a flat ring of dust cubes running out along the floor, plus a faint floor ring. */
export function land(x, z, { size = 1, palette = 'dust' } = {}) {
  const n = Math.round(10 * size);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rr(-0.15, 0.15);
    const spd = rr(2.5, 3.6) * size;
    const i = add(x + Math.sin(a) * 0.2, 0.06, z + Math.cos(a) * 0.2, Math.sin(a) * spd, rr(0.2, 0.8), Math.cos(a) * spd, rr(0.35, 0.55), Math.round(rr(3, 5) * Math.sqrt(size)), palette, CUBE);
    if (i < 0) break;
    P.drag[i] = 0.84; P.grav[i] = -0.4; P.pop[i] = 1.3; P.shrinkAt[i] = 0.2; P.fadeAt[i] = 0.7;
  }
  addShape(RING, FLOOR, x, 0.02, z, 0.22, 'mist', 'fog', 0.2, 0.9 * size, 0.2, 1);
}

/**
 * Dash burst: a kick of dust behind, speed lines peeling off the body, and (if obj is given)
 * a trail of afterimages stamped every `every` ticks for `ticks` ticks.
 */
export function dash(x, z, dx, dz, { obj = null, ticks = 10, every = 4, palette = 'ghost', y = 0.5 } = {}) {
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  dust(x, z, { dx: -dx, dz: -dz, n: 7, size: 1.1, spread: 0.8 });
  // a faint scuff left on the floor where the dash kicked off (stays for the room)
  if (look.impact) look.impact.splat(x - dx * 0.12, z - dz * 0.12, { r: 0.13, colors: ['stoneLight', 'stone'], grow: 0.5, ragged: 0.55 });
  addShape(RING, FLOOR, x, 0.02, z, 0.18, 'mist', 'frost', 0.15, 0.7, 0.3, 1);
  for (let k = 0; k < 6; k++) {
    const i = add(x + rr(-0.25, 0.25), y + rr(-0.35, 0.45), z + rr(-0.15, 0.15), -dx * rr(6, 10), 0, -dz * rr(6, 10), rr(0.14, 0.24), 1, 'soul', STREAK);
    if (i < 0) break;
    P.delay[i] = k * 0.02;
    P.stretch[i] = 0.06; P.drag[i] = 0.82; P.pop[i] = 1;
  }
  if (obj) for (let k = 0; k * every < ticks; k++) {
    if (k === 0) afterimage(obj, { palette });
    else later(k * every, ghostCall, { obj, palette });
  }
}
function ghostCall(a) { afterimage(a.obj, { palette: a.palette }); }

/** One afterimage of obj's current pose, stepping down a colour ramp and dissolving. */
export function afterimage(obj, { palette = 'ghost', life = 0.24 } = {}) { return stampGhost(obj, palette, life); }

/**
 * Kill burst: the moment something dies. Played on combat:kill for every target (the enemies'
 * own death animation and crumble run alongside it). In order:
 *   tick 0     the target's own white hit flash holds through hitstop; a white-hot pin light
 *   tick 2-3   the body flips to a solid ink silhouette; a black smoke puff blows out
 *   tick 2     a jagged ember starburst ~2.5x the body pops past full size, then is eaten from
 *              the inside; a hot floor shockwave; sparks; a big flame light pop
 *   tick 4+    chunks in the body's colours (half bounce and vanish, half stay on the floor),
 *              smoke that rises and swells, embers that drift up for a second or two
 *   floor      a scorch of radiating spokes that glows ember and cools to shadow, and resting
 *              debris (look.impact), next to the blood pool look's impact layer lays
 *   size: 1 = a husk (scales everything; mites ~0.5, the brute ~1.4, the Warden 3).
 *   colors: the body's palette names.  obj: the body's Object3D (for the silhouette).
 *   dx, dz: the killing blow's direction.  decals: false for no floor marks.
 */
export function kill(x, y, z, { size = 1, colors = ['bone', 'frost', 'stone'], obj = null, dx = 0, dz = 1, decals = true, palette = 'ember' } = {}) {
  const s = Math.max(0.4, Math.min(3, size));
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const low = flashesLow();
  const K = { x, y, z, s, colors, obj, dx, dz, decals, low, palette };
  light(x, y, z, 'white', 3.5, 1.4 * s, 60);
  later(2, killPop, K);
  later(5, killDebris, K);
  later(9, killSmoke, K);
  if (decals) later(3, killScorch, K);
}
const KILL_COLS = {
  ember: { body: 'ember', core: 'torch', inner: 'white', ring: 'flame', light: 'flame' },
  cool: { body: 'cyan', core: 'sky', inner: 'white', ring: 'sky', light: 'sky' },
  rose: { body: 'rose', core: 'torch', inner: 'white', ring: 'rose', light: 'rose' },
};
function killPop(K) {
  const { x, y, z, s } = K;
  const c = KILL_COLS[K.palette] || KILL_COLS.ember;
  if (K.obj && !K.low) silhouette(K.obj, { color: 'ink', ticks: 2 });
  // the starburst: an outer ember burst and a smaller white-hot one inside it, at different seeds
  const life = 0.2 + 0.03 * s;
  const b = addShape(BURST, FACING, x, y, z, life, c.body, c.core, 1.3 * s, K.low ? 0.4 : 0.5, 12, rr(0, 100));
  const b2 = addShape(BURST, FACING, x, y + 0.02, z, life * 0.7, c.core, K.low ? c.core : c.inner, 0.62 * s, 0.6, 8, rr(0, 100));
  if (b2 >= 0) S.delay[b2] = 1 / 60;
  // floor: a hot shockwave out to about twice the burst, and an ink ring chasing it
  addShape(RING, FLOOR, x, 0.02, z, 0.3, c.body, c.core, 0.4 * s, 1.9 * s, 0.25, 2);
  const r2 = addShape(RING, FLOOR, x, 0.02, z, 0.26, 'ink', 'night', 0.2 * s, 1.35 * s, 0.35, 1);
  if (r2 >= 0) S.delay[r2] = 3 / 60;
  light(x, y, z, c.light, 3.2 + s * 0.5, 3 * s, 140 + 40 * s);
  // black smoke puff, blown out round the body (dark reads on the dark floor AND in a torch pool)
  const nSmoke = Math.round(9 + 5 * s);
  for (let k = 0; k < nSmoke; k++) {
    const a = (k / nSmoke) * TAU + rr(-0.3, 0.3);
    const sp = rr(1.6, 2.8) * Math.sqrt(s);
    const i = add(x + Math.sin(a) * 0.15 * s, y + rr(-0.2, 0.25) * s, z + Math.cos(a) * 0.12 * s, Math.sin(a) * sp, rr(0.2, 1.4), Math.cos(a) * sp * 0.8,
      rr(0.45, 0.7), Math.round(rr(4, 7) * Math.sqrt(s)), 'smoke', CUBE);
    if (i < 0) break;
    P.drag[i] = 0.86; P.grav[i] = -1.2; P.pop[i] = 0.6; P.grow[i] = 0.5; P.shrinkAt[i] = 0.6; P.fadeAt[i] = 0.55;
    P.delay[i] = 3 / 60 + (k % 3) / 60;   // out from behind the burst as it starts to break up
  }
  // sparks: fast radial streaks, biased along the blow
  const nSp = Math.round(10 + 6 * s);
  for (let k = 0; k < nSp; k++) {
    const along = k < nSp / 3;
    const a = along ? Math.atan2(K.dx, K.dz) + rr(-0.6, 0.6) : rr(0, TAU);
    const spd = rr(7, 13) * Math.sqrt(s);
    const i = add(x, y, z, Math.sin(a) * spd, rr(1, 7), Math.cos(a) * spd, rr(0.16, 0.32), along ? 2 : 1, 'killSpark', STREAK);
    if (i < 0) break;
    P.stretch[i] = 0.06; P.drag[i] = 0.86; P.grav[i] = 14; P.pop[i] = 1; P.floorY[i] = 0.02; P.bounce[i] = 0.3;
  }
}
function killDebris(K) {
  const { x, y, z, s, colors } = K;
  // chunks in the body's colours: they fly, bounce and dissolve ...
  const n = Math.round(8 + 6 * s);
  for (let k = 0; k < n; k++) {
    const a = rr(0, TAU);
    const spd = rr(1.5, 4.5) * Math.sqrt(s);
    const i = add(x + rr(-0.15, 0.15) * s, y + rr(-0.2, 0.3) * s, z + rr(-0.15, 0.15) * s, Math.sin(a) * spd, rr(3, 7), Math.cos(a) * spd,
      rr(0.9, 1.5), pick([3, 4, 4, 5]), colors[k % colors.length], CUBE);
    if (i < 0) break;
    P.grav[i] = 22; P.bounce[i] = 0.4; P.floorY[i] = 0.06; P.pop[i] = 1; P.shrinkAt[i] = 0.85; P.fadeAt[i] = 0.85;
  }
  // ... and these stay on the floor for the rest of the room (look's impact layer)
  if (K.decals && look.impact) look.impact.chips(x, y * 0.8, z, K.dx, K.dz, { n: Math.round(4 + 3 * s), colors, speed: 3.5 * Math.sqrt(s), spread: 2.6 });
  // embers drifting up off the body for a second or two
  embers(x, y * 0.6, z, { n: Math.round(10 + 6 * s), spread: 0.3 * s, up: 0.9 + 0.2 * s });
}
function killSmoke(K) {
  const { x, y, z, s } = K;
  // a slow column of smoke that rises and swells off the body
  const n = Math.round(4 + 3 * s);
  for (let k = 0; k < n; k++) {
    const i = add(x + rr(-0.25, 0.25) * s, y + rr(0, 0.3) * s, z + rr(-0.15, 0.15) * s, rr(-0.3, 0.3), rr(0.6, 1.3) * Math.sqrt(s), rr(-0.2, 0.2),
      rr(0.9, 1.4), Math.round(rr(4, 7) * Math.sqrt(s)), 'smokeHi', CUBE);
    if (i < 0) break;
    P.delay[i] = k * 0.06; P.drag[i] = 0.97; P.wob[i] = 1.5; P.ph[i] = rr(0, TAU); P.pop[i] = 0.5; P.grow[i] = 0.7;
    P.shrinkAt[i] = 0.7; P.fadeAt[i] = 0.45;
  }
}
function killScorch(K) {
  if (!look.impact) return;
  const { x, z, s } = K;
  // a blast mark: radiating soot spokes that glow ember for a moment, then cool to black
  const spokes = Math.round(7 + 2 * s);
  const a0 = rr(0, TAU);
  for (let k = 0; k < spokes; k++) {
    const a = a0 + (k / spokes) * TAU + rr(-0.22, 0.22);
    const len = (k % 2 ? 0.8 : 1.25) * rr(0.85, 1.15) * s;
    const ux = Math.sin(a), uz = Math.cos(a);
    for (let d = 0.3 * s; d < len; d += 0.12) {
      const t = (d - 0.3 * s) / Math.max(0.01, len - 0.3 * s);
      look.impact.splat(x + ux * d, z + uz * d * 0.95, { r: (0.12 * (1 - t * 0.75) + 0.03) * Math.sqrt(s), colors: t < 0.45 ? ['ember', 'night'] : ['flame', 'shadow'], delay: Math.round(t * 4), grow: 0.5, ragged: 0.35 });
    }
  }
  // soot under the body (look's blood pool spreads over its middle)
  look.impact.splat(x, z, { r: 0.44 * s, colors: ['night', 'ink'], delay: 1, grow: 1, ragged: 0.45 });
}

/**
 * Death crumble: what a body does when it finally breaks apart (the enemies' own death
 * animations call this a beat after the kill burst, when the corpse crumbles). Chunks in the
 * body's colours that bounce (some stay on the floor), a small burst, a dark puff, a floor ring
 * and dust, then soul wisps drifting up.
 *   colors: palette names of the body (bone and stone for a skeleton). power: size of the burst.
 */
export function death(x, y, z, { colors = ['bone', 'frost', 'stone'], power = 1, soul = true, ring = 'mist' } = {}) {
  const b = addShape(BURST, FACING, x, y, z, 0.16, 'flame', 'torch', 0.5 * power + 0.1, 0.5, 9, rr(0, 100));
  if (b >= 0) S.delay[b] = 1 / 60;
  light(x, y, z, 'torch', 2.2 * power, 3 + power, 120);
  const n = Math.round(14 + 8 * power);
  for (let k = 0; k < n; k++) {
    const a = rr(0, TAU);
    const spd = rr(1.2, 4.5) * (0.8 + power * 0.2);
    const c = colors[k % colors.length];
    const i = add(x + rr(-0.15, 0.15), y + rr(-0.3, 0.3), z + rr(-0.15, 0.15), Math.sin(a) * spd, rr(2.5, 7) * (0.8 + power * 0.2), Math.cos(a) * spd,
      rr(0.9, 1.6), pick([3, 4, 4, 5]), c, CUBE);
    if (i < 0) break;
    P.grav[i] = 22; P.bounce[i] = 0.42; P.floorY[i] = 0.06; P.pop[i] = 1; P.shrinkAt[i] = 0.82; P.fadeAt[i] = 0.82;
  }
  if (look.impact) look.impact.chips(x, y, z, 0, 1, { n: Math.round(3 + 3 * power), colors, speed: 3, spread: 3.2 });
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU + rr(-0.3, 0.3);
    const i = add(x, y, z, Math.sin(a) * rr(1.2, 2), rr(0.3, 1.2), Math.cos(a) * rr(1, 1.6), rr(0.5, 0.8), Math.round(rr(5, 7) * Math.sqrt(power)), 'smoke', CUBE);
    if (i < 0) break;
    P.drag[i] = 0.88; P.grav[i] = -1; P.pop[i] = 0.6; P.grow[i] = 0.5; P.shrinkAt[i] = 0.6; P.fadeAt[i] = 0.55;
  }
  for (let k = 0; k < 10; k++) {
    const a = rr(0, TAU);
    const spd = rr(6, 12);
    const i = add(x, y, z, Math.sin(a) * spd, rr(1, 6), Math.cos(a) * spd, rr(0.15, 0.3), 1, 'spark', STREAK);
    if (i < 0) break;
    P.stretch[i] = 0.035; P.drag[i] = 0.86; P.grav[i] = 12; P.pop[i] = 1;
  }
  later(3, deathRing, { x, z, power, ring });
  if (soul) later(8, deathSoul, { x, y, z, power });
}
function deathRing(a) {
  addShape(RING, FLOOR, a.x, 0.02, a.z, 0.34, a.ring, 'frost', 0.2, 0.9 + a.power * 0.4, 0.3, 1);
  dust(a.x, a.z, { n: 8, size: 1 });
}
function deathSoul(a) {
  for (let k = 0; k < 7; k++) {
    const i = add(a.x + rr(-0.3, 0.3), a.y + rr(-0.2, 0.3), a.z + rr(-0.2, 0.2), rr(-0.3, 0.3), rr(1, 2.2), rr(-0.2, 0.2), rr(0.8, 1.5), pick([1, 2, 2]), 'soul', SPRITE);
    if (i < 0) break;
    P.delay[i] = k * 0.05; P.wob[i] = 4; P.ph[i] = rr(0, TAU); P.drag[i] = 0.98; P.fadeAt[i] = 0.55; P.shrinkAt[i] = 0.7;
  }
}

/**
 * Spawn portal: a floor portal snaps open with an overshoot and spins, motes stream up off its
 * rim, then it collapses with a flare, a pillar of sparks and a ring. The enemy should appear
 * on the returned `popTick` (ticks from now).
 */
const PORTALS = {
  rose: ['plum', 'rose', 'portalMote', 'sparkRose', 'rose'],
  ember: ['red', 'flame', 'ember', 'spark', 'flame'],
  cool: ['teal', 'sky', 'sparkCool', 'sparkCool', 'sky'],
};
export function spawnPortal(x, z, { dur = 1.1, radius = 0.85, palette = 'rose' } = {}) {
  const [c1, c2, mote, spark, lightCol] = PORTALS[palette] || PORTALS.rose;
  const close = 0.14;
  // snaps open in ~5 ticks with an overshoot (back ease), then spins
  addShape(PORTAL, FLOOR, x, 0.03, z, dur, c1, c2, radius, 0.09, close, 2.2);
  // the opening: a flat ring flung out past the rim, and a light under it
  addShape(RING, FLOOR, x, 0.025, z, 0.18, c2, 'white', radius * 0.5, radius * 1.35, 0.4, 1);
  const ticks = Math.round(dur * 60);
  const popTick = Math.round((dur - close) * 60);
  const st = { x, z, radius, mote, spark, lightCol, c2, t: 0 };
  for (let t = 4; t < popTick - 2; t += 3) later(t, portalMotes, st);
  for (let t = 2; t < popTick - 4; t += 4) later(t, portalPull, st);
  for (let t = 0; t < popTick - 4; t += 12) later(t || 1, portalGlow, st);
  later(popTick, portalPop, st);
  return { ticks, popTick };
}
function portalMotes(s) {
  for (let k = 0; k < 3; k++) {
    const a = rr(0, TAU), r = s.radius * rr(0.75, 0.95);
    const i = add(s.x + Math.sin(a) * r, 0.08, s.z + Math.cos(a) * r * 0.9, Math.cos(a) * 0.6, rr(1.6, 3), -Math.sin(a) * 0.6, rr(0.4, 0.7), pick([1, 1, 2]), s.mote, SPRITE);
    if (i < 0) break;
    P.drag[i] = 0.97; P.wob[i] = 2; P.ph[i] = rr(0, TAU); P.fadeAt[i] = 0.55;
  }
}
function portalPull(s) {
  // motes drawn in along the spiral, from well outside the rim toward the hole
  for (let k = 0; k < 3; k++) {
    const a = rr(0, TAU), r = s.radius * rr(1.3, 1.8);
    const life = rr(0.32, 0.45);
    const inward = r * 0.85 / life, swirl = 2.4;
    const i = add(s.x + Math.sin(a) * r, rr(0.05, 0.3), s.z + Math.cos(a) * r,
      -Math.sin(a) * inward + Math.cos(a) * swirl, rr(-0.2, 0.2), -Math.cos(a) * inward - Math.sin(a) * swirl,
      life, pick([1, 1, 2]), s.mote, STREAK);
    if (i < 0) break;
    P.stretch[i] = 0.04; P.drag[i] = 0.99; P.fadeIn[i] = 0.2; P.fadeAt[i] = 0.75; P.pop[i] = 1;
  }
}
function portalGlow(s) {
  // the floor light under the portal pulses while it is open
  light(s.x, 0.25, s.z, s.lightCol, 1.4, 2.2 * s.radius + 0.6, 150);
}
function portalPop(s) {
  addShape(STAR, FACING, s.x, 0.55, s.z, 0.16, s.c2, 'white', 0.75, 0.22);
  addShape(RING, FLOOR, s.x, 0.02, s.z, 0.32, s.c2, 'white', s.radius * 0.6, s.radius * 1.7, 0.4, 1);
  light(s.x, 0.6, s.z, s.lightCol, 2.2, 4.5, 160);
  for (let k = 0; k < 14; k++) {
    const a = rr(0, TAU), r = rr(0, s.radius * 0.6);
    const i = add(s.x + Math.sin(a) * r, 0.1, s.z + Math.cos(a) * r, Math.sin(a) * rr(0.3, 1.2), rr(5, 10), Math.cos(a) * rr(0.3, 1.2), rr(0.22, 0.4), k < 4 ? 2 : 1, s.spark, STREAK);
    if (i < 0) break;
    P.stretch[i] = 0.04; P.drag[i] = 0.9; P.grav[i] = 10; P.pop[i] = 1;
  }
  dust(s.x, s.z, { n: 10, size: 1.1 });
}

/** A burst of rising embers (brazier knocked, fire hit, collapse gust). */
export function embers(x, y, z, { n = 14, spread = 0.35, up = 1, palette = 'ember' } = {}) {
  for (let k = 0; k < n; k++) {
    const fast = k % 3 === 0;
    const i = add(x + rr(-spread, spread), y + rr(0, 0.2), z + rr(-spread, spread) * 0.6, rr(-1, 1) * (fast ? 2 : 1), rr(1.2, 3.4) * up * (fast ? 1.8 : 1), rr(-0.4, 0.4),
      rr(0.8, 1.9), fast ? 1 : pick([1, 2, 2]), palette, fast ? STREAK : SPRITE);
    if (i < 0) break;
    if (fast) P.stretch[i] = 0.05;
    P.delay[i] = rr(0, 0.12); P.wob[i] = 5; P.ph[i] = rr(0, TAU); P.drag[i] = 0.97; P.grav[i] = -0.3; P.fadeAt[i] = 0.7; P.pop[i] = 2;
  }
}

/** Light flash: a light pop, a hot disc and flare, and 8 pixels thrown out in a star. */
export function flash(x, y, z, { color = 'torch', size = 1, light: lit = true } = {}) {
  const hot = 'white';
  addShape(DISC, FACING, x, y, z, 0.1, color, hot, 0.5 * size, 0.6, 1);
  const st = addShape(STAR, FACING, x, y, z, 0.16, color, hot, 0.75 * size, 0.2);
  if (st >= 0) S.delay[st] = 1 / 60;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    const spd = (k % 2 ? 5 : 8) * size;
    const i = add(x, y, z, Math.cos(a) * spd, Math.sin(a) * spd * 0.8, 0, 0.22, 2, 'spark', STREAK);
    if (i >= 0) P.stretch[i] = 0.04;
    if (i < 0) break;
    P.drag[i] = 0.82; P.pop[i] = 2; P.fadeAt[i] = 0.5;
  }
  if (lit) light(x, y, z, color, 3 * size, 5 * size, 180);
}

/** Shockwave: a floor ring that snaps out and thins, a trailing second ring, and dust at the front. */
export function shockwave(x, z, { radius = 2, color = 'fog', hot = 'white', y = 0.02, dust: withDust = true } = {}) {
  addShape(RING, FLOOR, x, y, z, 0.36, color, hot, 0.2, radius, 0.5, 2);
  const j = addShape(RING, FLOOR, x, y, z, 0.3, 'mist', color, 0.1, radius * 0.72, 0.3, 1);
  if (j >= 0) S.delay[j] = 0.05;
  if (!withDust) return;
  const n = Math.round(10 + radius * 5);
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU + rr(-0.1, 0.1);
    const spd = radius * rr(3.8, 4.6);
    const i = add(x + Math.sin(a) * 0.2, 0.05, z + Math.cos(a) * 0.2, Math.sin(a) * spd, rr(0.6, 2), Math.cos(a) * spd, rr(0.35, 0.55), Math.round(rr(3, 5)), 'dust', CUBE);
    if (i < 0) break;
    P.drag[i] = 0.83; P.grav[i] = 3; P.pop[i] = 1; P.shrinkAt[i] = 0.3; P.fadeAt[i] = 0.6;
  }
}

/** Pickup sparkle: a flare, a spiral of motes rising and twinkling stars around the point. */
export function sparkle(x, y, z, { palette = 'gold', color = 'gold' } = {}) {
  addShape(STAR, FACING, x, y, z, 0.2, color, 'white', 0.5, 0.25);
  addShape(RING, FACING, x, y, z, 0.2, color, 'white', 0.1, 0.55, 0.3, 1);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    const i = add(x + Math.sin(a) * 0.3, y - 0.2, z + Math.cos(a) * 0.3, Math.cos(a) * 1.4, rr(1.2, 2.4), -Math.sin(a) * 1.4, rr(0.45, 0.75), k % 3 ? 1 : 2, palette, SPRITE);
    if (i < 0) break;
    P.delay[i] = k * 0.012; P.drag[i] = 0.93; P.fadeAt[i] = 0.5; P.pop[i] = 2;
  }
  for (let k = 0; k < 4; k++) {
    const a = rr(0, TAU), r = rr(0.3, 0.6);
    const j = addShape(STAR, FACING, x + Math.sin(a) * r, y + rr(-0.1, 0.5), z + Math.cos(a) * r * 0.5, 0.15, color, 'white', 0.18, 0.4);
    if (j >= 0) S.delay[j] = 0.06 + k * 0.07;
  }
}

/** A single small twinkle (idle shine on a pickup, a gem, a blade). */
export function twinkle(x, y, z, { color = 'gold', size = 1 } = {}) {
  addShape(STAR, FACING, x, y, z, 0.16, color, 'white', 0.2 * size, 0.35);
}

/** Heal: soft green-white motes rising around a point. */
export function heal(x, y, z, { n = 16 } = {}) {
  for (let k = 0; k < n; k++) {
    const a = rr(0, TAU), r = rr(0.1, 0.45);
    const i = add(x + Math.sin(a) * r, y + rr(0, 0.6), z + Math.cos(a) * r * 0.6, 0, rr(0.8, 1.8), 0, rr(0.5, 0.9), pick([1, 2]), 'heal', SPRITE);
    if (i < 0) break;
    P.delay[i] = rr(0, 0.25); P.wob[i] = 2; P.ph[i] = rr(0, TAU); P.fadeAt[i] = 0.5;
  }
}

export const EFFECTS = { hitSpark, silhouette, kill, slash, dust, step, land, dash, afterimage, death, spawnPortal, embers, flash, shockwave, sparkle, twinkle, heal };
