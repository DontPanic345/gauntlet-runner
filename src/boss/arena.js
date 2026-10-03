// The Warden's Pit (piece `boss`): the round arena the boss is fought in.
//
//   const pit = new BossPit(root, { lit: false });   // lit: braziers and runes already burning
//   pit.collision        the room's CollisionWorld (call setCollision(pit.collision))
//   pit.seal()           the gate of bars slams up behind the hero; the ring wall closes
//   pit.ignite(k)        light brazier k (0..5): a whoosh, a flare, its fire and light
//   pit.wakeRune(k)      rune segment k (0..11) lights up, cold blue
//   pit.runesHot()       every rune turns red (phase III)
//   pit.flare(color?, k?) every brazier flares (a roar, a phase change, the death)
//   pit.cageUp() / pit.cageDown()   the eight arcs of bars burst up / sink (phase III / death)
//   tick: pit.tick()     render: pit.render(alpha)     exit: pit.dispose()
//
// Layout (world units): a stone drum of radius 6.4 hanging over darkness, play inside r 5.65.
// North: the back wall of cells and the Warden's niche. South: the bridge in, and its gate.
// Six iron cage-braziers stand round the rim. A ring of runes at r 3.15. The cage at r 4.3.

import * as THREE from 'three';
import { voxelMesh } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { hex } from '../render/palette.js';
import { vfx } from '../vfx/vfx.js';
import { feedback } from '../core/feedback.js';
import { events } from '../core/events.js';
import { CollisionWorld } from '../core/collision.js';
import { PIT } from './models.js';
import { bossSfx } from './sfx.js';

const TAU = Math.PI * 2;
const BRAZIER_R = 6.02;
// six braziers round the rim, clear of the bridge (south) and the niche (north)
export const BRAZIERS = [35, 85, 140, 220, 275, 325].map((d) => { const a = d * Math.PI / 180; return { x: Math.sin(a) * BRAZIER_R, z: Math.cos(a) * BRAZIER_R }; });
// the order they light in the intro: from the niche outward, alternating sides
export const IGNITE_ORDER = [2, 3, 1, 4, 0, 5];

export class BossPit {
  constructor(root, { lit = false } = {}) {
    this.root = root;
    this.group = new THREE.Group();
    root.add(this.group);
    const add = (name, x, y, z, yaw = 0) => { const m = voxelMesh(name); m.position.set(x, y, z); m.rotation.y = yaw; this.group.add(m); return m; };
    this.floor = add('boss.floor', 0, 0, 0);
    this.wall = add('boss.wall', 0, 0, PIT.wallZ);
    this.bridge = add('boss.bridge', 0, 0, PIT.RF - 0.25);
    this.gate = add('boss.gate', 0, -2.4, PIT.RF + 0.15);
    this.gate.visible = false;
    this.gateY = -2.4; this.pgateY = -2.4; this.gateV = 0; this.gateUp = false;
    for (const [x, z, yaw] of [[-5.7, -3.4, 0.4], [5.2, 3.9, 2.0], [-2.6, 5.75, 1.1], [3.4, -5.1, 2.6]]) add('boss.rubble', x, 0, z, yaw);

    // braziers: a dark and a lit model each, a light that wakes with them, a pop that decays
    this.braziers = BRAZIERS.map((p, k) => {
      const g = new THREE.Group();
      g.position.set(p.x, 0, p.z);
      this.group.add(g);
      const dark = voxelMesh('boss.brazier.dark'), litM = voxelMesh('boss.brazier.lit');
      g.add(dark); g.add(litM);
      litM.visible = false;
      const light = look.torch(g, { y: 2.3, color: 'flame', intensity: 0, radius: 8.5, flicker: 1 });
      return { k, x: p.x, z: p.z, g, dark, lit: litM, light, on: false, pop: 0, base: 1.25 };
    });
    // a cold shaft of light down through the vault onto the middle of the pit
    this.shaftAnchor = new THREE.Object3D();
    this.shaftAnchor.position.set(0, 0, -0.6);
    this.group.add(this.shaftAnchor);
    this.shaft = look.torch(this.shaftAnchor, { y: 4.2, color: 'frost', intensity: 0.75, radius: 7.5, flicker: 0, haze: 0 });

    // runes: 12 segments of the ring, each dark / lit / hot
    this.runes = [];
    for (let k = 0; k < 12; k++) {
      const a = (k + 0.5) / 12 * TAU;
      const x = Math.sin(a) * PIT.RUNE, z = Math.cos(a) * PIT.RUNE;
      const seg = { k, state: 'dark', meshes: {} };
      for (const m of ['dark', 'lit', 'hot']) { seg.meshes[m] = add(`boss.rune.${k}.${m}`, x, -0.115, z); seg.meshes[m].visible = m === 'dark'; }
      this.runes.push(seg);
    }

    // the cage: eight arcs of bars, sunk under the floor until phase III
    this.cage = [];
    for (let k = 0; k < 8; k++) {
      const am = (k + 0.5) / 8 * TAU;
      const m = add(`boss.cage.${k}`, Math.sin(am) * PIT.CAGE, -3.2, Math.cos(am) * PIT.CAGE);
      m.visible = false;
      this.cage.push({ m, y: -3.2, py: -3.2, vy: 0, goal: -3.2, delay: 0, a: am, landed: true });
    }
    this.caged = false;

    // collision: the ring wall of the pit (closed by seal()), and the braziers on the rim
    this.collision = new CollisionWorld();
    for (const b of this.braziers) this.collision.addCircle(b.x, b.z, 0.32, 'brazier');
    this.ring = null;

    // ambient: violet motes, embers off whatever is burning
    this.amb = vfx.ambient({ preset: 'boss', box: [-6.2, 6.2, 0.2, 3.8, -6.6, 6.2], sources: [], fires: [], dust: 70 });
    this.t = 0;
    if (lit) { for (const b of this.braziers) this.ignite(b.k, true); for (let k = 0; k < 12; k++) this.wakeRune(k, true); }
  }

  /** The ring wall: the hero is inside from now on. Optionally the gate slams. */
  seal(withGate = true) {
    if (!this.ring) this.ring = this.collision.addRing(0, 0, PIT.RP, 'pit');
    if (!withGate || this.gateUp) return;
    this.gateUp = true;
    this.gate.visible = true;
    this.gateV = 26;
    bossSfx.gate();
    feedback.shake(5, 260); feedback.kick(0, 1, 3);
    vfx.dust(0, PIT.RF + 0.1, { n: 14, size: 1.3, palette: 'dustWarm' });
    vfx.hitSpark(0, 0.4, PIT.RF + 0.1, { dx: 0, dz: -1, power: 1.5, palette: 'hit' });
    for (const s of [-1, 1]) vfx.dust(s * 1.0, PIT.RF + 0.2, { dx: s, n: 4, size: 1, palette: 'dustWarm' });
    events.emit('boss:seal', {});
  }

  ignite(k, instant = false) {
    const b = this.braziers[k];
    if (!b || b.on) return;
    b.on = true;
    b.dark.visible = false; b.lit.visible = true;
    b.pop = instant ? 0 : 1.6;
    this.amb.config.fires.push([b.x, 15.5 / 8, b.z, 1.2]);
    this.amb.config.sources.push([b.x, 2.1, b.z]);
    if (instant) return;
    bossSfx.ignite(this.braziers.filter((x) => x.on).length);
    vfx.flash(b.x, 2.0, b.z, { color: 'gold', size: 0.9, light: false });
    vfx.embers(b.x, 2.0, b.z, { n: 18, spread: 0.25, up: 1.8 });
    feedback.shake(1.2, 90);
  }

  wakeRune(k, instant = false) {
    const r = this.runes[k];
    if (!r || r.state !== 'dark') return;
    this.setRune(r, 'lit');
    if (instant) return;
    const a = (k + 0.5) / 12 * TAU;
    vfx.twinkle(Math.sin(a) * PIT.RUNE, 0.15, Math.cos(a) * PIT.RUNE, { color: 'sky', size: 1 });
    bossSfx.rune(k);
  }
  runesHot() {
    this.runes.forEach((r, k) => vfx.later(k * 2, () => { this.setRune(r, 'hot'); const a = (k + 0.5) / 12 * TAU; vfx.twinkle(Math.sin(a) * PIT.RUNE, 0.15, Math.cos(a) * PIT.RUNE, { color: 'red', size: 1 }); }));
  }
  runesGold() { this.runes.forEach((r) => this.setRune(r, 'lit')); }
  setRune(r, st) { r.state = st; for (const m in r.meshes) r.meshes[m].visible = m === st; }

  /** Every lit brazier flares (and optionally changes its light's colour). */
  flare(color = null, k = 1) {
    for (const b of this.braziers) {
      if (!b.on) continue;
      b.pop = Math.max(b.pop, 1.4 * k);
      if (color) b.light.color.setHex(hex(color));
      vfx.embers(b.x, 2.0, b.z, { n: 8, spread: 0.2, up: 2 });
    }
  }

  cageUp() {
    if (this.caged) return;
    this.caged = true;
    // the pit's wall becomes the bars
    if (this.ring) this.collision.remove(this.ring);
    this.ring = this.collision.addRing(0, 0, PIT.CAGE - 0.12, 'cage');
    this.cage.forEach((c, k) => { c.goal = 0; c.delay = k * 3; c.landed = false; c.m.visible = true; });
  }
  cageDown() {
    if (!this.caged) return;
    this.caged = false;
    if (this.ring) this.collision.remove(this.ring);
    this.ring = this.collision.addRing(0, 0, PIT.RP, 'pit');
    this.cage.forEach((c, k) => { c.goal = -3.2; c.delay = k * 4; c.landed = false; c.vy = 0; });
  }

  tick() {
    this.t++;
    // gate: shoots up with an overshoot, settles
    this.pgateY = this.gateY;
    if (this.gateUp) {
      this.gateY += this.gateV / 60;
      this.gateV -= 4.4;
      if (this.gateY > 0 && this.gateV < 0) { this.gateY = 0; this.gateV = -this.gateV * 0.25; if (this.gateV < 1) this.gateV = 0; }
      if (this.gateY >= 0 && this.gateV === 0) this.gateY = 0;
    }
    // cage bars: burst up (or sink) arc by arc
    for (const c of this.cage) {
      c.py = c.y;
      if (c.landed) continue;
      if (c.delay > 0) { c.delay--; continue; }
      if (c.goal === 0) {
        c.vy += 3.0;
        c.y += c.vy / 60;
        if (c.y >= 0.12) {
          c.y = 0; c.landed = true;
          const x = Math.sin(c.a) * PIT.CAGE, z = Math.cos(c.a) * PIT.CAGE;
          bossSfx.bars(this.cage.indexOf(c));
          vfx.dust(x, z, { n: 10, size: 1.2, palette: 'dustWarm' });
          vfx.hitSpark(x, 0.3, z, { dx: Math.sin(c.a), dz: Math.cos(c.a), power: 1.2, palette: 'hit', light: false });
          for (let k = 0; k < 5; k++) {
            const a = c.a + (k - 2) * 0.14, s = 2 + k % 3;
            const i = vfx.core.add(Math.sin(a) * PIT.CAGE, 0.1, Math.cos(a) * PIT.CAGE, Math.sin(a) * s * 0.4, 3 + k, Math.cos(a) * s * 0.4, 1, 3, k % 2 ? 'stone' : 'stoneLight', vfx.core.CUBE);
            if (i >= 0) { const P = vfx.core.P; P.grav[i] = 22; P.bounce[i] = 0.3; P.floorY[i] = 0.04; P.pop[i] = 1; P.fadeAt[i] = 0.85; }
          }
          feedback.shake(2.2, 110);
        }
      } else {
        c.vy -= 0.5;
        c.y += c.vy / 60;
        if (c.y <= c.goal) { c.y = c.goal; c.landed = true; c.m.visible = false; vfx.dust(Math.sin(c.a) * PIT.CAGE, Math.cos(c.a) * PIT.CAGE, { n: 4, size: 1, palette: 'dustWarm' }); }
      }
    }
    for (const b of this.braziers) b.pop *= 0.93;
  }

  render(alpha) {
    const gy = this.pgateY + (this.gateY - this.pgateY) * alpha;
    this.gate.position.y = gy;
    for (const c of this.cage) c.m.position.y = c.py + (c.y - c.py) * alpha;
    for (const b of this.braziers) b.light.intensity = b.on ? b.base * (1 + b.pop) : 0;
  }

  dispose() {
    this.amb.stop();
    for (const b of this.braziers) b.light.remove();
    this.shaft.remove();
    this.group.removeFromParent();
  }

  info() {
    return { lit: this.braziers.filter((b) => b.on).length, runes: this.runes.map((r) => r.state[0]).join(''), gate: this.gateUp, caged: this.caged, ring: this.ring ? (this.ring.R) : null };
  }
}
