// The collapse (piece `gauntlet`): the wall of falling rock and embers that chases the hero down a
// corridor and kills on contact.
//
//   const c = new Collapse(root, { x: -3.5, D: 5, lights: true });
//   c.start();                              // it begins to advance
//   c.tick(heroX, heroSpeed, progress);     // each sim tick; returns nothing, updates c.x (the leading edge), c.gap, c.speed
//   c.render(alpha);                        // each render frame
//   c.halt(x);                              // it stops with a slam at x (the gate); then settles and goes quiet
//   c.caught(heroX)                         // true when the leading edge has reached the hero
//   c.dispose();
//
// What you see: a heap of dark, ember-cracked rubble with a lumpy leading edge, a long dark tail behind it
// (the corridor already buried), rocks falling onto the heap and just ahead of it, dust rolling off the front,
// embers streaming ahead in the draught, and a hot ember light on the floor in front. The whole thing shakes
// the screen through `feedback`, more the closer it gets.
//
// Speed rule (the tension curve): base speed grows with progress; it multiplies by how close the hero is.
// Dawdle and it surges toward (and past) run speed; stay far ahead and it eases to about half.

import * as THREE from 'three';
import { voxelMesh, getModel, defineModel, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/index.js';
import { ramp, F_STRETCH, F_BOUNCE, F_TWINKLE } from '../vfx/particles.js';
import { hex } from '../render/palette.js';
import { Rng } from '../core/rng.js';
import { display } from '../core/display.js';

const V = VOXEL;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const R = new Rng('gauntlet/collapse');
const rnd = (a, b) => a + (b - a) * R.next();

export const TUNING = {
  base: 3.1,          // u/s at the start
  growth: 0.25,        // extra fraction of base by the end of the corridor
  near: 7.5,           // gap (units) at which the multiplier is 1
  surge: 0.1,         // multiplier per unit of gap closer than `near`
  minMult: 0.75,       // eases to this when far ahead
  maxMult: 1.9,
  maxSpeed: 4.3,       // u/s: a touch above run speed, so a stalled hero is caught but a running one is not
  accel: 0.05,         // how fast the speed follows its target, per tick
  kill: 0.55,          // the leading edge reaches the hero when hero.x - front < this
  ahead: 15,           // gap where the easing is fully on
};

/** Shared read-only state for sound and UI. */
export const chase = { level: 0, gap: 99, speed: 0, active: false };

// ---- rubble models -----------------------------------------------------------------------------------------

const HEAP_LEN = 40, HEAP_H = 36, YOFF = 8, TAIL_LEN = 16;
const hash2 = (a, b, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const BODY = ['stone', 'dusk', 'stoneLight', 'slate', 'stone', 'stoneDark', 'stoneLight'];
const LIT = { stoneDark: 'stone', dusk: 'slate', stone: 'stoneLight', slate: 'mist', stoneLight: 'mist' };
const DEEP = { stoneLight: 'stone', stone: 'stoneDark', slate: 'dusk', dusk: 'stoneDark', stoneDark: 'shadow' };
const baseH = (x) => smooth(x / 34) * 27;

function heapName(zs, variant) {
  const name = `gauntlet.heap.${zs}.${variant}`;
  if (made.has(name)) return name;
  made.add(name);
  const g = new VoxelGrid(HEAP_LEN, HEAP_H + YOFF, zs);
  const rr = new Rng(`heap/${zs}`);
  // a pile of boulders: the height at each column is the tallest one over it, and each column remembers whose it is
  const boulders = [];
  for (let i = 0; i < 90; i++) {
    const x = Math.pow(rr.next(), 0.85) * 38, z = rr.range(-2, zs + 2);
    const r = 2.6 + smooth(x / 30) * 3.5 + rr.range(0, 2.4);
    boulders.push({ x, z, r, yc: baseH(x) * 0.8 + r * 0.25 + rr.range(-1, 2), tone: rr.pick(BODY), id: i });
  }
  const H = new Int16Array(HEAP_LEN * zs), O = new Int16Array(HEAP_LEN * zs);
  for (let z = 0; z < zs; z++) for (let x = 0; x < HEAP_LEN; x++) {
    let h = baseH(x) * 0.7 + (x < 6 ? 0 : 1), own = -1;
    for (const b of boulders) {
      const d = Math.hypot(x - b.x, z - b.z);
      if (d >= b.r) continue;
      const hh = b.yc + Math.sqrt(b.r * b.r - d * d) * 0.95;
      if (hh > h) { h = hh; own = b.id; }
    }
    H[x + z * HEAP_LEN] = clamp(Math.round(h), 1, HEAP_H); O[x + z * HEAP_LEN] = own;
  }
  const at = (x, z) => (x < 0 || z < 0 || z >= zs ? -9 : x >= HEAP_LEN ? 0 : O[x + z * HEAP_LEN]);
  for (let z = 0; z < zs; z++) for (let x = 0; x < HEAP_LEN; x++) {
    const h = H[x + z * HEAP_LEN], own = O[x + z * HEAP_LEN];
    const tone = own >= 0 ? boulders[own].tone : 'stoneDark';
    // a seam where two boulders meet, or where the pile steps down at its front: glows
    const seam = x < 30 && own !== at(x + 1, z) && own !== at(x, z + 1) ? 1 : (own !== at(x - 1, z) && x < 30 ? 1 : 0);
    const hot = hash2(x * 5 + variant * 13, z * 3 + variant * 7) < 0.5 - x * 0.012;
    const stepDown = x > 0 ? h - H[x - 1 + z * HEAP_LEN] : h;
    for (let y = -YOFF; y < h; y++) {
      const s = h - y;
      let c = s === 1 ? LIT[tone] : s > 5 ? DEEP[tone] : tone;
      let em = false;
      if (seam && s <= 2 && x < 26) {
        if (hot) { c = x < 9 ? 'flame' : 'ember'; em = true; } else if (s === 1) { c = 'red'; em = false; }
      } else if (seam && s <= 4 && x < 22) c = 'blood';
      else if (stepDown > 1 && y >= h - stepDown && x < 24) c = hash2(x, y, z) < 0.35 ? 'plum' : tone;       // the lit front face
      g.set(x, y + YOFF, z, c, em);
    }
  }
  defineModel(name, { grid: g, origin: [0, YOFF, zs / 2] });
  return name;
}
const made = new Set();

function tailName(zs) {
  const name = `gauntlet.tail.${zs}`;
  if (made.has(name)) return name;
  made.add(name);
  const g = new VoxelGrid(TAIL_LEN, HEAP_H + YOFF, zs);
  for (let z = 0; z < zs; z++) for (let x = 0; x < TAIL_LEN; x++) {
    const cx = x >> 2, cz = z >> 2;
    const h = 29 + Math.round(hash2(cx, cz, 9) * 5 + hash2(x, z, 2) * 1.6);
    const tone = BODY[(hash2(cx, cz, 5) * BODY.length) | 0];
    for (let y = -YOFF; y < h; y++) {
      const s = h - y;
      const seam = ((x & 3) === 0 || (z & 3) === 0) && hash2(x, z, 8) < 0.16;
      if (s <= 2 && seam) { g.set(x, y + YOFF, z, 'ember', true); continue; }
      g.set(x, y + YOFF, z, s === 1 ? LIT[tone] : s > 4 ? DEEP[tone] : tone);
    }
  }
  defineModel(name, { grid: g, origin: [TAIL_LEN, YOFF, zs / 2] });
  return name;
}

/** Height of the heap's slope at `d` units behind the leading edge, in units (matches the model closely enough for landing rocks). */
function slopeAt(d) { return (smooth((d * 8) / 30) * 31) / 8; }

// ---- the collapse -----------------------------------------------------------------------------------------------

const ROCKS = 150;
const ROCK_COLORS = ['stoneDark', 'stone', 'dusk', 'stoneLight', 'slate', 'stoneDark'].map((n) => new THREE.Color(hex(n)));

export class Collapse {
  constructor(root, { x = -3.5, D = 5, lights = true } = {}) {
    this.root = root;
    this.D = D;
    this.x = x;               // leading edge
    this.speed = 0; this.target = 0;
    this.active = false; this.halted = false;
    this.gap = 99; this.calm = 1;    // 1 = raging, fades to 0 after a halt
    this.mult = 1; this.tickN = 0; this.settleT = 0; this.hitGate = null; this.haltX = undefined;
    const zs = Math.round((D + 1.6) * 8);
    this.group = new THREE.Group();
    this.group.position.set(x, 0, 0.1);
    root.add(this.group);
    this.variants = [heapName(zs, 0), heapName(zs, 1)];
    this.heap = voxelMesh(this.variants[0]);
    this.heap.scale.x = -1;          // the model climbs toward +x; the pile climbs away from the front, toward -x
    this.group.add(this.heap);
    this.tails = [];
    const tn = tailName(zs);
    for (let i = 0; i < 12; i++) { const m = voxelMesh(tn); m.position.x = -HEAP_LEN * V - i * TAIL_LEN * V; this.group.add(m); this.tails.push(m); }
    look.noShadow(this.group);
    this.light = lights && look.lights ? look.torch(this.group, { x: 2.0, y: 1.6, z: 0, color: 'ember', intensity: 1.35, radius: 9, haze: 0, flicker: 0.8 }) : null;
    this.light2 = lights && look.lights ? look.torch(this.group, { x: 0.4, y: 3.4, z: 0, color: 'flame', intensity: 0.6, radius: 6, haze: 0, flicker: 1 }) : null;

    // falling rocks: one InstancedMesh
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.rocks = new THREE.InstancedMesh(geo, mat, ROCKS);
    this.rocks.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(ROCKS * 3), 3);
    this.rocks.frustumCulled = false;
    this.rocks.count = 0;
    this.rocks.castShadow = false;
    root.add(this.rocks);
    this.rk = { x: new Float32Array(ROCKS), y: new Float32Array(ROCKS), z: new Float32Array(ROCKS), px: new Float32Array(ROCKS), py: new Float32Array(ROCKS), vy: new Float32Array(ROCKS), s: new Float32Array(ROCKS), rx: new Float32Array(ROCKS), rz: new Float32Array(ROCKS), wx: new Float32Array(ROCKS), wz: new Float32Array(ROCKS), c: new Uint8Array(ROCKS), st: new Uint8Array(ROCKS), t: new Float32Array(ROCKS), o: new Float32Array(ROCKS) };
    this.nRocks = 0;
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._col = new THREE.Color();
    this.rain = 0;   // how hard it rains (0..1)
  }

  start() { this.active = true; this.halted = false; this.calm = 1; events.emit('gauntlet:collapseStart', { x: this.x }); }

  /** A wall (the gate) at x: the collapse keeps coming, and stops there with a slam. */
  halt(x) {
    if (this.halted) return;
    this.haltX = x; this.hitGate = x;
  }

  caught(heroX) { return this.active && heroX - this.x < TUNING.kill; }

  setRain(v) { this.rain = v; }

  tick(heroX, heroSpeed = 0, progress = 0) {
    this.tickN++;
    const gap = heroX - this.x;
    this.gap = gap;
    if (this.active) {
      const base = TUNING.base * (1 + TUNING.growth * clamp(progress, 0, 1));
      let mult = 1 + (TUNING.near - gap) * TUNING.surge;
      // a long way ahead: ease smoothly (the multiplier sinks toward minMult over the last few units)
      if (gap > TUNING.near) mult = lerp(1, TUNING.minMult, smooth((gap - TUNING.near) / (TUNING.ahead - TUNING.near)));
      mult = clamp(mult, TUNING.minMult, TUNING.maxMult);
      // dawdling: standing nearly still with the wall close makes it lunge
      if (heroSpeed < 0.8 && gap < TUNING.near + 1) mult = Math.min(TUNING.maxMult, mult * 1.18);
      this.mult = mult;
      this.target = Math.min(TUNING.maxSpeed, base * mult);
      this.speed += (this.target - this.speed) * TUNING.accel;
      this.x += this.speed / 60;
      if (this.haltX !== undefined && this.x > this.haltX) this.x = this.haltX;
    } else if (this.halted) {
      this.speed *= 0.8;
      this.settleT++;
    }
    if (this.halted) this.calm = Math.max(0, this.calm - 1 / 150);
    // hitting the gate: the collapse arrives, everything lets go at once
    if (this.hitGate !== null && this.x >= this.hitGate - 0.05) { this.slam(); this.active = false; this.halted = true; }
    const near = clamp((11 - gap) / 11, 0, 1);
    chase.gap = gap; chase.speed = this.speed; chase.active = this.active || this.calm > 0.02;
    chase.level = this.calm * (this.active || this.halted ? 0.35 + 0.65 * (this.active ? near : 0.5) : 0);
    this.emit(heroX, near);
    this.stepRocks();
  }

  slam() {
    this.hitGate = null;
    const x = this.x + 0.2;
    feedback.shake(8, 500); feedback.flash('ember', 160, 0.28);
    vfx.shockwave({ x, z: 0, radius: 4.2, style: 'dust' });
    vfx.flash({ x, y: 1.5, z: 0, color: 'ember', radius: 4, ms: 260 });
    for (let i = 0; i < 6; i++) vfx.dust({ x: x + rnd(-0.6, 0.2), z: rnd(-1.9, 1.9), dx: -1, dz: 0, n: 6, size: 8, speed: 1.6 });
    const pp = vfx.pool;
    if (pp) for (let i = 0; i < 46; i++) pp.add(x - rnd(0, 0.6), rnd(0.3, 3), rnd(-2, 2), -rnd(1, 6), rnd(2, 6), rnd(-1.5, 1.5), rnd(0.6, 1.2), rnd(3, 5), 1, ramp(i % 3 ? 'stone,stoneDark' : 'white,gold,ember'), F_BOUNCE | (i % 3 ? 0 : F_TWINKLE), 0.97, 16);
    events.emit('gauntlet:collapseSlam', { x });
  }

  // ---- particles and rocks ---------------------------------------------------------------------------------------
  emit(heroX, near) {
    const pp = vfx.pool;
    if (!pp) return;
    const k = this.calm * (this.active ? 1 : 0.6);
    if (k < 0.03) return;
    const fx = this.x, zr = this.D / 2 - 0.3;
    // embers: torn off the heap and dragged forward in the draught
    const nE = (this.tickN % 2 === 0 ? 3 : 2) * k * (0.6 + near * 0.6);
    for (let i = 0; i < nE; i++) {
      pp.add(fx - rnd(0, 3.2), rnd(0.3, 3.8), rnd(-zr, zr), rnd(0.8, 3.6) + this.speed * 0.4, rnd(0.6, 2.6), rnd(-0.6, 0.6), rnd(0.9, 1.9), rnd(2, 4), 1, ramp('white,gold,flame,ember,red'), F_TWINKLE, 0.985, -0.5);
    }
    // dust rolling off the front
    if (this.tickN % 3 === 0) vfx.dust({ x: fx + 0.1, z: rnd(-zr, zr), dx: 1, dz: 0, n: 3, size: 7, speed: 1.2 });
    // chips thrown forward
    if (this.tickN % 4 === 0) pp.add(fx + rnd(0, 0.5), rnd(0.2, 1.4), rnd(-zr, zr), rnd(2.5, 6), rnd(2, 4.5), rnd(-1, 1), 0.9, rnd(3, 5), 2, ramp(R.chance(0.5) ? 'stone' : 'stoneDark'), F_BOUNCE, 0.98, 15);
    // grit hanging in the air over the heap
    if (this.tickN % 2 === 0) pp.add(fx - rnd(0, 4), rnd(3, 5.5), rnd(-zr, zr), rnd(-0.3, 0.9), -rnd(1, 3), 0, 0.7, 2, 1, ramp('stoneLight,mist'), 0, 0.98, 8);
    // rumble: a steady tremor, harder the closer it is
    if (this.tickN % 5 === 0) feedback.shake((0.7 + 2.0 * near) * k, 150);
  }

  spawnRock(front) {
    const rk = this.rk;
    let i = this.nRocks;
    if (i >= ROCKS) {
      i = -1;
      for (let j = 0; j < ROCKS; j++) if (rk.st[j] === 3) { i = j; break; }
      if (i < 0) return;
    } else this.nRocks++;
    const o = rnd(-4.2, 3.0) + (R.chance(0.35) ? rnd(0.4, 2.6) : 0);
    rk.o[i] = o;
    rk.x[i] = rk.px[i] = front + o;
    rk.y[i] = rk.py[i] = rnd(8.5, 12);
    rk.z[i] = rnd(-this.D / 2 - 0.2, this.D / 2 + 0.2);
    rk.vy[i] = -rnd(0, 2);
    rk.s[i] = rnd(0.13, 0.36);
    rk.rx[i] = rnd(0, 6); rk.rz[i] = rnd(0, 6); rk.wx[i] = rnd(-5, 5); rk.wz[i] = rnd(-5, 5);
    rk.c[i] = (R.next() * ROCK_COLORS.length) | 0;
    rk.st[i] = 0; rk.t[i] = 0;
    this.rocks.count = this.nRocks;
  }

  stepRocks() {
    const rk = this.rk, front = this.x;
    const rate = (this.active ? 0.5 : 0.28 * this.calm) * this.calm * (0.3 + 0.7 * this.rain);
    let want = rate;
    while (want > 0) { if (want >= 1 || R.next() < want) this.spawnRock(front); want -= 1; }
    for (let i = 0; i < this.nRocks; i++) {
      const st = rk.st[i];
      rk.px[i] = rk.x[i]; rk.py[i] = rk.y[i];
      if (st === 3) continue;
      if (st === 0) {
        rk.vy[i] -= 0.028;
        rk.y[i] += rk.vy[i];
        rk.rx[i] += rk.wx[i] * 0.02; rk.rz[i] += rk.wz[i] * 0.02;
        const off = rk.x[i] - front;
        const floorY = off < -0.1 ? slopeAt(-off) : 0;
        const halfS = rk.s[i] / 2;
        if (rk.y[i] - halfS <= floorY) {
          rk.y[i] = floorY + halfS;
          if (off >= -0.1) {
            // ahead of the wall: bounce, dust, a tick of screen kick if it is a big one
            rk.vy[i] = -rk.vy[i] * 0.32; rk.st[i] = 1; rk.t[i] = 0;
            if (rk.s[i] > 0.24 && this.calm > 0.3) { vfx.dust({ x: rk.x[i], z: rk.z[i], n: 3, size: 4, speed: 0.7 }); if (rk.s[i] > 0.31) feedback.shake(1.2, 90); }
            const pp = vfx.pool;
            if (pp && this.calm > 0.1) for (let n = 0; n < 3; n++) pp.add(rk.x[i], 0.1, rk.z[i], rnd(-1.5, 1.5), rnd(1, 2.5), rnd(-1.5, 1.5), 0.5, 3, 1, ramp('stone,stoneDark'), F_BOUNCE, 0.97, 14);
          } else {
            rk.st[i] = 2; rk.t[i] = 0;
            if (R.chance(0.3) && this.calm > 0.2) vfx.dust({ x: rk.x[i], z: rk.z[i], y: floorY, n: 2, size: 5, speed: 0.6 });
          }
        }
      } else if (st === 1) {
        // bounced ahead of the wall: it rolls a little, then the wall swallows it
        rk.vy[i] -= 0.028; rk.y[i] += rk.vy[i];
        if (rk.y[i] < rk.s[i] / 2) { rk.y[i] = rk.s[i] / 2; rk.vy[i] = 0; }
        rk.t[i]++;
        if (rk.x[i] - front < -0.15 || rk.t[i] > 90) rk.st[i] = 3;
      } else {
        // landed on the heap: rides with it, then is absorbed
        rk.x[i] += this.speed / 60;
        rk.t[i]++;
        if (rk.t[i] > 6) rk.st[i] = 3;
      }
    }
    // compact
    while (this.nRocks > 0 && rk.st[this.nRocks - 1] === 3) this.nRocks--;
    this.rocks.count = this.nRocks;
  }

  render(alpha) {
    this.group.position.x = this.x;
    look.snap(this.group.position);   // whole-texel positions: the heap edge never swims
    // flicker the cracks: swap between two lit variants
    const v = Math.floor(this.tickN / 7) % 2;
    if (this._v !== v) { this._v = v; this.heap.geometry = getModel(this.variants[v]).geometry; }
    if (this.light) {
      const surge = this.calm * (0.85 + 0.35 * clamp((9 - this.gap) / 9, 0, 1));
      this.light.intensity = 1.35 * surge;
      this.light2.intensity = 0.6 * surge;
    }
    const m = this._m, q = this._q, e = this._e, p = this._p, s = this._s, col = this._col;
    for (let i = 0; i < this.nRocks; i++) {
      const rk = this.rk;
      if (rk.st[i] === 3) { s.setScalar(0); m.compose(p.set(0, -50, 0), q.identity(), s); this.rocks.setMatrixAt(i, m); continue; }
      const x = lerp(rk.px[i], rk.x[i], alpha), y = lerp(rk.py[i], rk.y[i], alpha);
      p.set(x, y, rk.z[i]);
      look.snap(p);
      e.set(rk.rx[i], 0, rk.rz[i]);
      q.setFromEuler(e);
      const sz = Math.max(1 / 32, Math.round(rk.s[i] * 32) / 32);
      s.setScalar(sz);
      m.compose(p, q, s);
      this.rocks.setMatrixAt(i, m);
      this.rocks.setColorAt(i, col.copy(ROCK_COLORS[rk.c[i]]));
    }
    this.rocks.instanceMatrix.needsUpdate = true;
    if (this.rocks.instanceColor) this.rocks.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.light?.remove(); this.light2?.remove();
    this.group.parent?.remove(this.group);
    this.rocks.parent?.remove(this.rocks);
    this.rocks.geometry.dispose(); this.rocks.material.dispose(); this.rocks.dispose();
    chase.level = 0; chase.active = false;
  }
}
