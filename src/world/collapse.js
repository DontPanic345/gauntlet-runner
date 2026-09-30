// The collapse (piece `gauntlet`): the wall of falling rock and embers that chases the hero
// down a corridor and kills on contact.
//
//   import { Collapse, COLLAPSE } from './collapse.js';
//   const col = new Collapse(group, { x: startX, D, v0, stopX, rng });
//   col.start();                       // the ceiling gives way: the chase begins
//   per tick:  col.tick(hero)          // hero: { x, z, dead } (a HeroController works)
//   render:    col.render(alpha)
//   col.front                          // x of the killing edge; everything behind it is buried
//   col.speed, col.dawdle (0..1), col.gap (hero x - front), col.info()
//   col.stop()                         // the gate shut: the rock piles against it, the rumble dies
//   col.dispose()
//
// Pacing (the tension ramp):
//   - it moves at v0 (per corridor) while the hero is within COLLAPSE.near units;
//   - far ahead of it (gap > COLLAPSE.far) it eases down to COLLAPSE.vMin, so a clean run
//     earns breathing room, but never so slow that a stall is free;
//   - dawdling (no forward progress for COLLAPSE.stallTicks) fills `dawdle`, which adds up to
//     COLLAPSE.dawdleBoost units/s; moving forward drains it again.
//   Rumble, shake, ember light and falling-rock density all scale with how close it is and
//   with `dawdle`, so the speed-up is something you see and hear, not just a number.
//
// Look: boulders are voxel blocks in one lit InstancedMesh (outlined and shadowed by look),
// hot ones in an unlit ember mesh; they drop from above the view, land on a pile that grows
// behind the front, and some tumble ahead of it. Grit streaks, rolling dust, embers, two
// ember lights and the shared shake channel do the rest. Rock that falls past the corridor's
// open front edge drops into the abyss.

import * as THREE from 'three';
import { defineModel, getModel, voxelMaterial, VoxelGrid } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { feedback } from '../core/feedback.js';
import { DT } from '../core/loop.js';
import { gauntletSfx, near } from './traps.js';

export const COLLAPSE = {
  vMin: 3.2,           // units/s when the hero is far ahead
  near: 5,             // gap below which it runs at full v0
  far: 14,             // gap above which it has eased all the way to vMin
  stallTicks: 50,      // ticks without forward progress before dawdle starts to fill
  dawdleFill: 1 / 80,  // per tick while stalling
  dawdleDrain: 1 / 50, // per tick while making progress
  dawdleBoost: 2.4,    // extra units/s at full dawdle
  accel: 2.5,          // units/s^2: how fast the speed changes (no snapping)
};

const CAP = 1000;           // rocks alive at once (the oldest buried ones are recycled)
const V = 1 / 8;

// ---- rock models: lumpy voxel boulders in a few sizes, cold and hot --------------------------
// Rocks are drawn at exactly one voxel per voxel (never scaled), so they sit on the same pixel
// grid as everything else; they turn in quarter turns only.
const CLASSES = { S: 3, M: 5, L: 7, X: 12 };
const PER = { S: 240, M: 180, L: 110, X: 24 };      // instances per model
const VARIANTS = 2;
let rocksBuilt = false;
function hash(n) { n = Math.sin(n * 91.7 + 12.3) * 43758.5453; return n - Math.floor(n); }
function rockGrid(cls, v, hot) {
  const n = CLASSES[cls];
  const slab = cls === 'X';
  const sx = n, sy = slab ? 4 : Math.max(2, n - 1), sz = slab ? 10 : n;
  const g = new VoxelGrid(sx, sy, sz);
  const cx = (sx - 1) / 2, cy = (sy - 1) / 2, cz = (sz - 1) / 2;
  let q = v * 17 + n * 5 + (hot ? 101 : 0);
  const r = () => hash(q++);
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const dx = (x - cx) / (sx / 2), dy = (y - cy) / (sy / 2), dz = (z - cz) / (sz / 2);
    const d = slab ? Math.max(Math.abs(dx), Math.abs(dz)) * 0.9 + Math.abs(dy) * 0.2 : Math.hypot(dx, dy * 1.1, dz);
    if (d > 1.05 - r() * 0.3) continue;
    const top = y === sy - 1 || d > 0.75;
    let c = top && y >= cy ? (r() < 0.3 ? 'stoneLight' : 'stone') : r() < 0.35 ? 'dusk' : 'stone';
    if (y === 0) c = 'stoneDark';
    if (v === 1 && !hot && r() < 0.25) c = 'violet';
    let em = false;
    if (hot) {
      const inner = d < 0.7;
      c = inner || r() < 0.45 ? (r() < 0.25 ? 'flame' : 'ember') : r() < 0.5 ? 'stoneDark' : 'red';
      em = c === 'flame' || c === 'ember';
    }
    g.set(x, y, z, c, em);
  }
  if (slab) for (let x = 0; x < sx; x += 3) g.set(x, sy - 1, Math.floor(r() * sz), 'stoneDark');   // cracks on the slab
  return g;
}
function buildRocks() {
  if (rocksBuilt) return;
  rocksBuilt = true;
  for (const cls of Object.keys(CLASSES)) for (let v = 0; v < VARIANTS; v++) {
    defineModel(`gauntlet.rock.${cls}${v}`, { grid: rockGrid(cls, v, false) });
    if (v === 0 && cls !== 'X') defineModel(`gauntlet.rock.${cls}hot`, { grid: rockGrid(cls, 0, true) });
  }
}
const classOf = (s) => (s >= 10 * V ? 'X' : s <= 3 * V ? 'S' : s <= 5 * V ? 'M' : 'L');

export class Collapse {
  constructor(group, { x = 0, D = 5, v0 = 2.4, stopX = Infinity, rng = Math.random, edgeZ = null } = {}) {
    this.group = group;
    this.D = D;
    this.front = x;
    this.pfront = x;
    this.v0 = v0;
    this.speed = 0;
    this.want = 0;
    this.stopX = stopX;
    this.edgeZ = edgeZ ?? D / 2 + 0.4;   // past this z, rock falls into the abyss
    this.r = rng;
    this.active = false;
    this.stopped = false;
    this.t = 0;
    this.dawdle = 0;
    this.best = -Infinity;       // furthest x the hero has reached
    this.stall = 0;
    this.gap = Infinity;
    this.caught = 0;

    // ---- boulders: one InstancedMesh per rock model, all on the shared voxel material
    buildRocks();
    this.meshes = {};
    for (const cls of Object.keys(CLASSES)) {
      const names = [...Array(VARIANTS).keys()].map((v) => `${cls}${v}`);
      if (cls !== 'X') names.push(`${cls}hot`);
      for (const k of names) {
        const cap = k.endsWith('hot') ? Math.round(PER[cls] * 0.4) : PER[cls];
        const m = new THREE.InstancedMesh(getModel(`gauntlet.rock.${k}`).geometry, voxelMaterial, cap);
        m.frustumCulled = false; m.count = 0; m.userData.cap = cap; m.userData.n = 0;
        group.add(m);
        this.meshes[k] = m;
      }
    }
    this.rocks = [];            // { x, y, z, vx, vy, vz, s, cls, v, hot, heat, rest, px, py, pz, rx, ry, rz, spin, age }
    // the pile: height per 0.25 unit of x and per unit of z
    this.pileW = 0.25;
    this.pile = new Map();
    this.m4 = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.e = new THREE.Euler(); this.v = new THREE.Vector3(); this.sv = new THREE.Vector3();

    // ---- lights: an ember glow at the front and a flame high in the falling rock
    this.anchor = new THREE.Object3D(); group.add(this.anchor);
    this.anchor2 = new THREE.Object3D(); group.add(this.anchor2);
    this.light = null; this.light2 = null;
    this.amb = null;
    this.acc = 0;
    this.nextSlab = 30;
    this.rumble = null;
  }

  // ---- the pile ---------------------------------------------------------------------------
  pk(x, z) { return `${Math.floor(x / this.pileW)},${Math.floor(z)}`; }
  pileAt(x, z) {
    // the base shape: rising out of the floor behind the front, capped
    const back = Math.max(0, this.front - x);
    const base = Math.min(2.6, back * 0.7);
    return Math.max(base * 0.6, Math.min(3.2, this.pile.get(this.pk(x, z)) ?? 0));
  }
  addPile(x, z, h) { const k = this.pk(x, z); this.pile.set(k, Math.min(3.2, (this.pile.get(k) ?? 0) + h)); }

  /** Pre-fill the dead end behind the start with settled rock. */
  prefill(x0, x1, n = 160) {
    for (let k = 0; k < n; k++) {
      const x = x0 + this.r() * (x1 - x0), z = -this.D / 2 + 0.2 + this.r() * (this.D - 0.4);
      const s = [2, 3, 3, 4, 5, 6][Math.floor(this.r() * 6)] * V;
      const y = this.pileAt(x, z);
      const rk = this.spawnRock(x, y, z, 0, 0, 0, s, this.r() < 0.06);
      rk.rest = true;
      this.addPile(x, z, s * 0.7);
    }
  }

  spawnRock(x, y, z, vx, vy, vz, s, hot = false) {
    const list = this.rocks;
    let rk;
    if (list.length < CAP) { rk = {}; list.push(rk); }
    else {
      // recycle the rock furthest behind the front (buried long ago)
      let best = 0, bx = Infinity;
      for (let i = 0; i < list.length; i++) if (list[i].rest && list[i].x < bx) { bx = list[i].x; best = i; }
      rk = list[best];
    }
    const cls = classOf(s);
    if (cls === 'X') hot = false;
    Object.assign(rk, { x, y, z, px: x, py: y, pz: z, vx, vy, vz, s: CLASSES[cls] * V, cls, v: Math.floor(this.r() * VARIANTS), hot, rest: false, heat: hot ? 1 : 0,
      rx: 0, ry: Math.floor(this.r() * 4) * Math.PI / 2, rz: 0, spin: (this.r() - 0.5) * 0.4, age: 0, abyss: z > this.edgeZ, slab: false });
    return rk;
  }

  // ---- control ----------------------------------------------------------------------------
  start() {
    if (this.active) return;
    this.active = true;
    this.speed = this.v0 * 0.6;
    if (look.lights) {
      this.light = look.torch(this.anchor, { y: 0.9, color: 'ember', intensity: 2.6, radius: 7.5, flicker: 1.6 });
      this.light2 = look.torch(this.anchor2, { y: 2.6, color: 'flame', intensity: 1.4, radius: 6, flicker: 2, haze: 0.6 });
    }
    this.amb = vfx.ambient({ preset: 'collapse', box: [this.front, this.front + 16, 0.2, 3.5, -this.D / 2, this.D / 2], dust: 30, embers: 0, floorEmbers: 14, grit: 10 });
    // the burst that opens the chase: a slab of ceiling comes down all at once
    for (let k = 0; k < 40; k++) {
      const x = this.front - 1.5 + this.r() * 2.2, z = -this.D / 2 + this.r() * (this.D + 1.2);
      this.spawnRock(x, 5 + this.r() * 4, z, (this.r() - 0.3) * 1.5, -2 - this.r() * 3, 0, [3, 4, 5, 6, 7][Math.floor(this.r() * 5)] * V, this.r() < 0.25);
    }
    vfx.shockwave(this.front + 0.5, 0, { radius: 3, color: 'ember', hot: 'torch' });
    feedback.shake(7, 500);
    feedback.flash('ember', 120, 0.18);
    gauntletSfx.quake();
    this.startRumble();
  }

  /** The gate is shut: the collapse throws itself at it, then stills. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.stopT = 0;
  }

  // ---- per tick ---------------------------------------------------------------------------
  tick(hero) {
    this.t++;
    this.pfront = this.front;
    for (const rk of this.rocks) { rk.px = rk.x; rk.py = rk.y; rk.pz = rk.z; }
    if (!this.active) { this.tickRocks(); return; }
    const hx = hero ? hero.x : this.front + 5;
    // ---- pacing
    if (this.stopped) {
      this.stopT++;
      this.want = this.front < this.stopX ? 12 : 0;
      this.dawdle = Math.max(0, this.dawdle - 0.02);
    } else {
      if (hx > this.best + 0.4) { this.best = hx; this.stall = 0; } else this.stall++;
      if (this.stall > COLLAPSE.stallTicks) this.dawdle = Math.min(1, this.dawdle + COLLAPSE.dawdleFill);
      else this.dawdle = Math.max(0, this.dawdle - COLLAPSE.dawdleDrain);
      const gap = hx - this.front;
      const k = Math.max(0, Math.min(1, (gap - COLLAPSE.near) / (COLLAPSE.far - COLLAPSE.near)));
      this.want = this.v0 + (COLLAPSE.vMin - this.v0) * k + COLLAPSE.dawdleBoost * this.dawdle;
    }
    const dv = this.want - this.speed, lim = COLLAPSE.accel * DT * (this.stopped ? 4 : 1);
    this.speed += Math.max(-lim, Math.min(lim, dv));
    this.front = Math.min(this.stopX, this.front + this.speed * DT);
    this.gap = hx - this.front;
    const heat = this.intensity();

    // ---- rock falling at the front (denser when it is close or angry)
    const quiet = this.stopped && this.slammed && this.stopT > 50;
    const rate = quiet ? Math.max(0, 1.2 - this.stopT * 0.01) : 2 + this.speed * 0.5 + heat * 1.6;
    this.acc += rate;
    while (this.acc >= 1) {
      this.acc--;
      const x = this.front - 1.6 + this.r() * 2.0;
      const z = -this.D / 2 + 0.1 + this.r() * (this.D + (this.r() < 0.2 ? 1.6 : -0.2));
      const big = this.r() < 0.18;
      const s = (big ? [6, 7, 8] : [2, 3, 3, 4, 5])[Math.floor(this.r() * (big ? 3 : 5))] * V;
      this.spawnRock(x, 5.5 + this.r() * 3.5, z, (this.r() - 0.35) * 1.2, -3 - this.r() * 4, (this.r() - 0.5) * 0.4, s, this.r() < 0.12 + heat * 0.1);
    }
    if (!quiet) {
      // a curtain of grit streaks and dust at the edge
      for (let k = 0; k < 3; k++) {
        const i = vfx.core.add(this.front - 0.8 + this.r() * 1.3, 4.5 + this.r() * 2, -this.D / 2 + this.r() * this.D, 0, -7 - this.r() * 4, 0, 0.9, 1, this.r() < 0.3 ? 'emberDim' : 'grit', vfx.core.STREAK);
        if (i < 0) break;
        const P = vfx.core.P; P.stretch[i] = 0.05; P.grav[i] = 8; P.floorY[i] = 0.02; P.bounce[i] = 0.1; P.pop[i] = 1; P.fadeAt[i] = 0.7;
      }
      // billows of dust rolling out ahead of the rock, big and slow
      for (let k = 0; k < 2; k++) {
        const i = vfx.core.add(this.front - 0.4 + this.r() * 0.8, 0.2 + this.r() * 2.2, -this.D / 2 + this.r() * this.D, 0.8 + this.r() * 1.6, 0.2 + this.r() * 0.6, (this.r() - 0.5) * 0.4,
          0.9 + this.r() * 0.8, 6 + Math.floor(this.r() * 7), this.r() < 0.35 ? 'dustWarm' : this.r() < 0.5 ? 'dust' : 'dustDark');
        if (i < 0) break;
        const P = vfx.core.P; P.drag[i] = 0.97; P.pop[i] = 1; P.fadeIn[i] = 0.1; P.fadeAt[i] = 0.45; P.shrinkAt[i] = 0.5; P.wob[i] = 0.6; P.ph[i] = this.r() * 6;
      }
      // now and then a slab of the ceiling comes down whole
      if (this.t >= this.nextSlab) {
        this.nextSlab = this.t + 45 + Math.floor(this.r() * 50 * (1 - heat * 0.5));
        const z = -this.D / 2 + 0.6 + this.r() * (this.D - 1.2);
        const rk = this.spawnRock(this.front - 0.2 + this.r() * 0.6, 8 + this.r() * 2, z, 0.3, -6, 0, 10 * V, false);
        rk.slab = true;
      }
      if (this.t % 3 === 0) vfx.dust(this.front + 0.3, -this.D / 2 + this.r() * this.D, { dx: 1, n: 2, size: 1.3 + heat * 0.5, palette: this.r() < 0.5 ? 'dustWarm' : 'dust', spread: 0.8 });
      if (this.t % 7 === 0) vfx.embers(this.front + 0.2, 0.4 + this.r(), -this.D / 2 + this.r() * this.D, { n: 3 + Math.round(heat * 4), spread: 0.5, up: 1.4 });
      // the shake: a steady rumble that grows as it closes in
      if (this.t % 5 === 0 && !this.stopped) feedback.shake(0.7 + heat * 2.6, 160);
    }
    this.tickRocks();

    // ---- lights and ambient follow the front
    this.anchor.position.set(this.front + 0.4, 0, 0.3);
    this.anchor2.position.set(this.front - 0.6, 0, -0.8);
    const pulse = 1 + 0.25 * Math.sin(this.t * 0.31) + 0.15 * Math.sin(this.t * 0.83);
    const fade = quiet ? Math.max(0, 1 - (this.stopT - 50) / 70) : 1;
    if (this.light) this.light.intensity = (2.2 + heat * 1.6) * pulse * fade;
    if (this.light2) this.light2.intensity = (1.1 + heat) * pulse * fade;
    this.amb?.set({ box: [this.front + 0.5, this.front + 18, 0.2, 3.5, -this.D / 2, this.D / 2], floorEmbers: quiet ? 2 : 10 + heat * 16, grit: quiet ? 0 : 6 + heat * 14 });
    this.setRumble(quiet ? 0 : 0.35 + heat * 0.65);
    // the rock reaches the shut gate: one last blow, then it stills
    if (this.stopped && !this.slammed && this.front >= this.stopX - 0.01) {
      this.slammed = true; this.stopT = Math.min(this.stopT, 10);
      gauntletSfx.boom();
      feedback.shake(5, 450);
      vfx.shockwave(this.stopX, 0, { radius: 2.4, color: 'ember', hot: 'torch' });
      for (let k = 0; k < 10; k++) vfx.dust(this.stopX + 0.3, -this.D / 2 + 0.3 + k * (this.D - 0.6) / 9, { dx: 1, n: 3, size: 1.6, palette: k % 2 ? 'dustWarm' : 'dust', spread: 0.7 });
      vfx.embers(this.stopX, 1, 0, { n: 20, spread: 1.5, up: 1.5 });
      for (let k = 0; k < 16; k++) this.spawnRock(this.stopX - 1.2 + this.r(), 6 + this.r() * 3, -this.D / 2 + this.r() * this.D, 0.5, -5, 0, [3, 5, 7][k % 3] * V, k % 4 === 0);
    }

    // ---- the kill
    if (hero && !hero.dead && !this.stopped && hero.x - 0.3 < this.front + 0.15) return 'caught';
    return null;
  }

  /** 0..1: how close and angry it is (drives shake, rumble, light). */
  intensity() {
    const g = Math.max(0, Math.min(1, 1 - (this.gap - 1) / 9));
    return Math.min(1, g * 0.8 + this.dawdle * 0.5);
  }

  tickRocks() {
    const heroNear = (x) => near(x);
    for (const rk of this.rocks) {
      rk.age++;
      if (rk.hot) {
        rk.heat -= rk.rest ? 0.004 : 0.0008;
        if (rk.heat <= 0) rk.hot = false;      // cooled: it turns to plain rock
      }
      if (rk.rest) continue;
      rk.vy -= 20 * DT;
      rk.x += rk.vx * DT; rk.y += rk.vy * DT; rk.z += rk.vz * DT;
      // tumbling in quarter turns (a rotated cube would shimmer off the pixel grid)
      if (rk.age % 7 === 0 && Math.abs(rk.spin) > 0.05) { rk.rx += Math.sign(rk.spin) * Math.PI / 2; if (rk.age % 14 === 0) rk.rz += Math.PI / 2; }
      const floor = rk.abyss ? -9 : this.pileAt(rk.x, rk.z);
      if (rk.y <= floor) {
        if (rk.abyss) { rk.rest = true; rk.y = -40; continue; }
        rk.y = floor;
        if (rk.vy < -5 && rk.age < 200) {
          // the first hit: bounce, throw dust, maybe tumble ahead of the front
          const big = rk.s >= 6 * V;
          if (rk.slab) {
            const v = heroNear(rk.x);
            vfx.shockwave(rk.x, rk.z, { radius: 1.6, color: 'fog', hot: 'bone' });
            vfx.dust(rk.x, rk.z, { n: 8, size: 1.6, palette: 'dustWarm', spread: 1.3 });
            if (v > 0.2) { feedback.shake(2 + 2 * v, 220); gauntletSfx.thud(v, true); }
            rk.slab = false;
          }
          const v = heroNear(rk.x);
          if (big && v > 0.3 && rk.x > this.front - 1.5 && this.r() < 0.5) gauntletSfx.thud(v * 0.8, true);
          if (big) vfx.dust(rk.x, rk.z, { n: 3, size: 1.2, palette: 'dustWarm', spread: 0.8 });
          if (rk.hot && this.r() < 0.5) vfx.embers(rk.x, rk.y + 0.2, rk.z, { n: 4, spread: 0.2, up: 1.3 });
          rk.vy = -rk.vy * 0.28;
          if (rk.x > this.front - 0.8 && this.r() < 0.4) rk.vx = 1.5 + this.r() * 2.5;   // spills forward
          rk.spin *= 0.5;
        } else if (rk.vx > 0.3 && rk.y < 0.05) {
          rk.vy = 0; rk.vx *= 0.9; rk.spin *= 0.8;         // rolling on the floor ahead of the front
          if (rk.x > this.stopX - 0.1) rk.vx = 0;
        } else {
          rk.rest = true; rk.vx = 0; rk.vy = 0; rk.vz = 0;
          rk.rx = 0; rk.rz = 0;
          this.addPile(rk.x, rk.z, rk.s * 0.55);
        }
        if (rk.z > this.edgeZ) rk.abyss = true;
      }
      rk.z = Math.max(-this.D / 2 + rk.s / 2, rk.z);
      if (rk.x > this.stopX - rk.s / 2) { rk.x = this.stopX - rk.s / 2; rk.vx = 0; }
    }
  }

  // ---- rumble -----------------------------------------------------------------------------
  startRumble() {
    const c = gauntletSfx.ctx();
    if (!c || this.rumble) return;
    try {
      const src = c.createBufferSource(); src.buffer = gauntletSfx.noise(); src.loop = true;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140; lp.Q.value = 0.8;
      const lp2 = c.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 300;
      const g = c.createGain(); g.gain.value = 0.0001;
      const lfo = c.createOscillator(); lfo.frequency.value = 5.5;
      const lg = c.createGain(); lg.gain.value = 40;
      lfo.connect(lg).connect(lp.frequency);
      src.connect(lp).connect(lp2).connect(g).connect(gauntletSfx.out());
      src.start(); lfo.start();
      this.rumble = { src, g, lp, lfo };
    } catch { this.rumble = null; }
  }
  setRumble(level) {
    const R = this.rumble;
    if (!R) return;
    const c = gauntletSfx.ctx();
    if (!c) return;
    R.g.gain.setTargetAtTime(Math.max(0.0001, level * 0.9 * gauntletSfx.vol()), c.currentTime, 0.12);
  }
  stopRumble() {
    const R = this.rumble;
    if (!R) return;
    this.rumble = null;
    try { R.src.stop(); R.lfo.stop(); R.g.disconnect(); } catch { /* already stopped */ }
  }

  // ---- render -----------------------------------------------------------------------------
  render(alpha) {
    const { m4, q, e, v, sv } = this;
    for (const k in this.meshes) this.meshes[k].userData.n = 0;
    sv.set(1, 1, 1);
    for (const rk of this.rocks) {
      if (rk.y < -30) continue;
      const mesh = this.meshes[rk.hot ? `${rk.cls}hot` : `${rk.cls}${rk.v}`];
      const i = mesh.userData.n;
      if (i >= mesh.userData.cap) continue;
      mesh.userData.n++;
      v.set(rk.px + (rk.x - rk.px) * alpha, rk.py + (rk.y - rk.py) * alpha, rk.pz + (rk.z - rk.pz) * alpha);
      // on the voxel grid: whole voxels in x and z, like every other model
      v.x = Math.round(v.x * 8) / 8; v.z = Math.round(v.z * 8) / 8; v.y = Math.round(v.y * 8) / 8;
      e.set(rk.rx, rk.ry, rk.rz);
      q.setFromEuler(e);
      m4.compose(v, q, sv);
      mesh.setMatrixAt(i, m4);
    }
    for (const k in this.meshes) {
      const m = this.meshes[k];
      m.count = m.userData.n;
      m.instanceMatrix.needsUpdate = true;
    }
  }

  info() {
    const r = (n) => Math.round(n * 100) / 100;
    return { active: this.active, stopped: this.stopped, front: r(this.front), speed: r(this.speed), want: r(this.want), gap: r(this.gap), dawdle: r(this.dawdle), rocks: this.rocks.length, caught: this.caught };
  }

  dispose() {
    this.stopRumble();
    this.amb?.stop();
    this.light?.remove(); this.light2?.remove();
    for (const k in this.meshes) this.meshes[k].removeFromParent();
    this.anchor.removeFromParent(); this.anchor2.removeFromParent();
  }
}
