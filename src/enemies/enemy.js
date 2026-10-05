// Enemy base (piece `enemies`): the shared body, hit reaction, locomotion and render plumbing
// that the four archetypes (husk.js, wisp.js, brute.js, mite.js) build on.
//
// An Enemy is a combat target (it extends combat's Hurtable: knockback, launch, tilt wobble,
// hit flash) with:
//   - a state machine: 'spawn' -> 'move' <-> attack states -> ... ; 'hurt' (hit-stun) and
//     'death' interrupt anything. `st` counts ticks in the current state.
//   - locomotion: the AI sets `want` (a desired velocity, units/s); the body accelerates toward
//     it, adds the manager's separation push, and slides along walls (CollisionWorld).
//   - a pose: a flat object of numbers the archetype writes every tick. The render lerps it
//     between the previous and current tick, so animation is smooth at any frame rate and
//     freezes cleanly in hitstop.
//   - its own voxel material, so a hit flash or a telegraph pulse lights only this enemy.
//
// Hit-stun (combat leaves it to us): every hit adds to `poiseDmg`, which drains over a second.
// When it reaches the archetype's `poise`, or on the combo finisher, the enemy is staggered:
// its attack is cancelled (the telegraph vanishes) and it flinches for `hurt` ticks. Below
// poise (the brute), a hit only rocks and flashes it.
//
// The telegraph is the hitbox: an attack's floor marker is drawn from the same numbers the
// hit test uses, from an origin locked when the windup ends.

import * as THREE from 'three';
import { Hurtable } from '../combat/combat.js';
import { voxelMesh, VOXEL } from '../render/voxel/index.js';
import { makeEnemyMaterial } from './material.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { events } from '../core/events.js';
import { DT, lerpAngle } from '../core/loop.js';
import { ENEMY_DATA, stat, cooldown, aggro } from './data.js';

export const V = VOXEL;
export const TAU = Math.PI * 2;
export const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
export const ease = (a, b, k) => a + (b - a) * k;
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };

const _v = new THREE.Vector3();

/** A mesh of a registered part with the enemy's own material. */
export function part(name, mat) { const m = voxelMesh(name); m.material = mat; return m; }
/** A pivot group at voxel coordinates inside a parent. */
export function pivot(parent, x, y, z, ...children) {
  const g = new THREE.Group();
  g.position.set(x * V, y * V, z * V);
  parent.add(g);
  for (const c of children) g.add(c);
  return g;
}

let nextId = 1;

export class Enemy extends Hurtable {
  constructor(mgr, kind, { id = null, x = 0, z = 0, yaw = 0, spawn = 'default', delay = 0, from = null } = {}) {
    const D = ENEMY_DATA[kind];
    super({ id: id ?? `${kind[0].toUpperCase()}${nextId++}`, type: kind, x, z, r: D.radius, h: D.height, hp: stat(kind, 'hp'), weight: D.weight, friction: 0.8 });
    this.mgr = mgr;
    this.kind = kind;
    this.D = D;
    this.hitY = D.height * 0.5;
    this.debris = D.debris;
    this.ownDeath = true;                 // vfx's generic death burst skips us: we play our own
    this.collision = mgr.collision;       // knockback slides along walls (Hurtable)
    this.bounds = mgr.bounds;
    this.yaw = yaw; this.pyaw = yaw;
    this.state = 'spawn'; this.st = 0; this.t = 0;
    this.mvx = 0; this.mvz = 0;           // locomotion velocity (units/s), separate from knockback
    this.want = { x: 0, z: 0 };
    this.sepX = 0; this.sepZ = 0;         // separation push from the manager (units/s)
    this.slot = null;                     // flanking slot angle round the hero (manager)
    this.token = 0;                       // melee attack tokens held
    this.poiseDmg = 0;
    this.stunT = 0;
    this.recoil = 0; this.recoilX = 0; this.recoilZ = 0;   // hit recoil for the pose (decays)
    this.tell = 0; this.tellColor = 'red';                 // telegraph body pulse
    this.pose = {}; this.ppose = {};
    this.lp = {};                         // lerped pose scratch (render)
    this.spawnKind = spawn; this.spawnDelay = delay; this.spawnFrom = from;
    this.visible = true;
    this.remove = false;                  // the manager drops us when true (death finished)
    this.home = { x, z };
    this.ai = true;                       // false: a puppet (the lineup drives it with act())
    this.target = null;                   // a stand-in hero (lineup); null = the real hero
    this.attacks = 0; this.landed = 0; this.dodged = 0;
    this.seed = (this.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0) || 1;
    this.cool = this.cooldownTicks(0.2 + 0.6 * this.rand());
    this.material = makeEnemyMaterial();
    this.group = new THREE.Group();       // world position and yaw
    this.body = new THREE.Group();        // tilt and squash, pivot at the feet
    this.group.add(this.body);
    this.build();
    this.group.visible = false;
    mgr.root.add(this.group);
    this.beginSpawn();
    this.snapPose();
  }

  // ---- overridables ------------------------------------------------------------------
  build() {}
  beginSpawn() { this.visible = true; this.setState('move'); }
  tickSpawn() {}
  think() {}
  animate() {}
  tickDeath() { if (this.st > 30) this.remove = true; }
  apply() {}              // write the lerped pose (this.lp) onto the rig
  onStagger() {}          // an attack was cancelled by a stagger
  get primaryAttack() { return null; }

  // ---- helpers -----------------------------------------------------------------------
  rand() { let t = (this.seed = (this.seed + 0x6D2B79F5) | 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  cooldownTicks(r = this.rand(), range = this.D.attack?.cooldown ?? [60, 120]) { return cooldown(this.kind, range, r); }
  get aggression() { return aggro(this.kind); }
  get speed() { return stat(this.kind, 'speed'); }
  get hero() { return this.target ?? this.mgr.hero(); }
  setState(s) { this.state = s; this.st = 0; }
  get alive() { return !this.dead && !this.dying; }
  get attacking() { return false; }

  /** Distance and unit direction to the hero (or a stand-in), or null. */
  toHero() {
    const h = this.hero;
    if (!h || h.dead) return null;
    const dx = h.x - this.x, dz = h.z - this.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    return { h, d, dx: dx / d, dz: dz / d, yaw: Math.atan2(dx, dz) };
  }
  turnTo(yaw, rate) { const d = wrap(yaw - this.yaw); this.yaw = wrap(this.yaw + Math.max(-rate, Math.min(rate, d))); return Math.abs(d); }
  /** Set `want` toward a point at up to `speed`, easing in over the last `soft` units. */
  seek(x, z, speed, soft = 0.4) {
    const w = this.mgr.nav?.(this, x, z);   // the room's pathing (arenas): a waypoint round pits and walls
    if (w) { x = w[0]; z = w[1]; }
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz);
    if (d < 0.02) { this.want.x = 0; this.want.z = 0; return d; }
    const k = Math.min(1, d / soft) * speed;
    this.want.x = dx / d * k; this.want.z = dz / d * k;
    return d;
  }
  stop() { this.want.x = 0; this.want.z = 0; }
  /** The flanking point this enemy is heading for: its slot round the hero at `dist`. */
  slotPoint(dist) {
    const h = this.hero;
    const a = this.slot ?? Math.atan2(this.x - h.x, this.z - h.z);
    return { x: h.x + Math.sin(a) * dist, z: h.z + Math.cos(a) * dist };
  }
  takeToken(cost = this.D.token) { if (!cost) return true; if (this.mgr.takeToken(this, cost)) { this.token = cost; return true; } return false; }
  dropToken() { if (this.token) { this.mgr.giveToken(this, this.token); this.token = 0; } }
  /** Hit the hero (or stand-in). Returns the result from HeroHealth.hurt. */
  hurtHero(n, from = this) {
    const h = this.hero;
    if (!h || h.dead || !h.hurt) return { ok: false };
    const r = h.hurt(n, { x: from.x, z: from.z });
    if (r.ok) this.landed++; else if (r.reason === 'dodged') this.dodged++;
    events.emit('enemy:attackHit', { enemy: this, ok: !!r.ok, reason: r.reason });
    return r;
  }
  /** Is the hero's body (radius 0.3) inside a sector from (ox, oz) facing yaw? */
  heroInSector(ox, oz, yaw, reach, arcDeg) {
    const h = this.hero; if (!h || h.dead) return false;
    const dx = h.x - ox, dz = h.z - oz, d = Math.hypot(dx, dz);
    if (d - 0.3 > reach) return false;
    if (d < 0.3 + this.r) return true;
    const rel = Math.abs(wrap(Math.atan2(dx, dz) - yaw)) * 180 / Math.PI;
    const half = Math.asin(Math.min(1, 0.3 / d)) * 180 / Math.PI;
    return rel - half <= arcDeg;
  }
  heroInDisc(x, z, r) { const h = this.hero; if (!h || h.dead) return false; return Math.hypot(h.x - x, h.z - z) <= r + 0.3; }
  /** Clear straight line to a point for a body of radius r? */
  clearTo(x, z, r = this.r) {
    const cw = this.mgr.collision; if (!cw) return true;
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz);
    return cw.raycast(this.x, this.z, dx / d, dz / d, d, r * 0.8) >= d - 0.05;
  }

  // ---- combat contract ---------------------------------------------------------------
  takeHit(hit) {
    if (this.dying || this.dead) return false;
    if (this.state === 'spawn') return false;          // spawn protection: untouchable until it has arrived
    if (!super.takeHit(hit)) return false;
    this.recoil = 1; this.recoilX = hit.dx; this.recoilZ = hit.dz;
    events.emit('enemy:hurt', { enemy: this, x: this.x, z: this.z, dmg: hit.dmg, hp: this.hp });
    if (this.dead) { this.die(hit); return true; }
    this.poiseDmg += hit.dmg;
    const staggered = this.poiseDmg >= this.D.poise || (hit.finisher && this.D.poise < 40);
    if (staggered && this.canStagger()) {
      this.poiseDmg = 0;
      this.interrupt();
      this.stunT = Math.round(this.D.hurt * (hit.finisher ? 1.6 : 1));
      this.setState('hurt');
      this.onStagger(hit);
    }
    return true;
  }
  canStagger() { return this.state !== 'spawn'; }
  /** Cancel whatever attack is under way: give the token back, drop the telegraph. */
  interrupt() { this.dropToken(); this.cool = Math.max(this.cool, 20); }

  die(hit) {
    this.dying = true;
    this.dropToken();
    this.deathDX = hit?.dx ?? 0; this.deathDZ = hit?.dz ?? 1;
    this.setState('death');
    this.onDeath?.(hit);
    events.emit('enemy:death', { enemy: this, x: this.x, z: this.z, kind: this.kind });
  }

  /**
   * Which way a body falls over: along (dx, dz), but bent sideways when that is mostly along
   * the camera's axis, because a body falling straight toward or away from a high camera looks
   * like it is still standing. Returns a unit vector.
   */
  fallDir(dx, dz) {
    let fx = dx, fz = dz;
    if (Math.abs(fx) < 0.75) { fx = (fx > 0.02 ? 1 : fx < -0.02 ? -1 : (this.rand() < 0.5 ? -1 : 1)) * 0.85; fz *= 0.55; }
    const l = Math.hypot(fx, fz) || 1;
    return [fx / l, fz / l];
  }

  /** Lineup: back on the home mark, calm, full hp, whatever it was doing. */
  reset() {
    this.dropToken();
    this.x = this.px = this.home.x; this.z = this.pz = this.home.z; this.y = this.py = 0;
    this.vx = this.vz = this.vy = 0; this.mvx = this.mvz = 0; this.stop();
    this.tiltX = this.tiltZ = this.tvx = this.tvz = 0; this.squash = 0; this.flashT = 0; this.recoil = 0;
    this.hp = this.maxHp; this.poiseDmg = 0; this.stunT = 0;
    this.visible = true; this.walkLoop = null;
    this.yaw = this.pyaw = 0;
    this.setState('move');
    this.onReset?.();
  }

  /** Debug / lineup: a hit that hurts nothing, for showing the flinch. */
  flinch(dx = 0, dz = 1, power = 1) {
    return this.takeHit({ dmg: 0, dx, dz, tx: 0, tz: 0, power, step: 0, finisher: false, knock: 1.6 * power, lift: 0, stopMs: 50, flashTicks: 3 });
  }

  // ---- the tick ------------------------------------------------------------------------
  snapPose() { Object.assign(this.ppose, this.pose); this.pyaw = this.yaw; this.px = this.x; this.pz = this.z; this.py = this.y; }

  tick() {
    this.t++; this.st++;
    Object.assign(this.ppose, this.pose);
    this.pyaw = this.yaw;
    this.tickBody();
    if (this.poiseDmg > 0) this.poiseDmg = Math.max(0, this.poiseDmg - Math.max(1, this.D.poise) / 60);
    this.recoil *= 0.8;
    this.tell = 0;
    if (this.dying) { this.stop(); this.mvx *= 0.7; this.mvz *= 0.7; this.tickDeath(); this.animate(); return; }
    if (this.state === 'spawn') { this.stop(); this.tickSpawn(); }
    else if (this.state === 'hurt') {
      this.stop();
      if (--this.stunT <= 0) this.setState('move');
    } else this.think();            // each archetype's 'move' state calls idleHome() when it is a puppet
    this.locomote();
    this.animate();
  }

  /** Puppet idle: walk back to the home mark and face the stand-in. */
  idleHome() {
    if (this.walkLoop) {   // lineup: pace a small ellipse round the home mark, to show the gait
      const L = this.walkLoop;
      L.a = (L.a ?? 0) + (L.rate ?? 0.022);
      const px = this.home.x + Math.sin(L.a) * L.r, pz = this.home.z + Math.cos(L.a) * L.r * 0.55;
      this.seek(px, pz, this.speed * (L.k ?? 1), 0.25);
      if (this.moveSpeed > 0.05) this.turnTo(Math.atan2(this.mvx, this.mvz), 0.16);
      return;
    }
    const d = this.seek(this.home.x, this.home.z, this.speed * 0.8, 0.5);
    if (d > 0.08) this.turnTo(Math.atan2(this.want.x, this.want.z), 0.2);
    else { this.stop(); const t = this.toHero(); if (t) this.turnTo(t.yaw, 0.08); }
  }

  locomote(accel = this.D.accel) {
    let wx = this.want.x + this.sepX, wz = this.want.z + this.sepZ;
    this.mvx = ease(this.mvx, wx, accel); this.mvz = ease(this.mvz, wz, accel);
    if (Math.abs(this.mvx) < 0.01 && Math.abs(this.mvz) < 0.01) { this.mvx = 0; this.mvz = 0; this.lastMove = null; return; }
    this.lastMove = this.moveBy(this.mvx * DT, this.mvz * DT);
  }
  moveBy(dx, dz) {
    const cw = this.mgr.collision;
    let res = null;
    if (cw) { const b = { x: this.x, z: this.z, r: this.r }; res = cw.move(b, dx, dz); this.x = b.x; this.z = b.z; }
    else { this.x += dx; this.z += dz; }
    const B = this.bounds;
    if (B) { this.x = Math.max(B.minX + this.r, Math.min(B.maxX - this.r, this.x)); this.z = Math.max(B.minZ + this.r, Math.min(B.maxZ - this.r, this.z)); }
    return res;
  }
  get moveSpeed() { return Math.hypot(this.mvx, this.mvz); }

  // ---- render ----------------------------------------------------------------------------
  render(alpha) {
    const g = this.group;
    g.visible = this.visible;
    if (!this.visible) return;
    const s = this.at(alpha);
    _v.set(s.x, s.y, s.z);
    look.snap(_v);
    g.position.copy(_v);
    g.rotation.y = lerpAngle(this.pyaw, this.yaw, alpha);
    // tilt in world axes: undo the yaw so a hit from the left always rocks it right
    const cy = Math.cos(-g.rotation.y), sy = Math.sin(-g.rotation.y);
    this.body.rotation.set(s.tiltX * cy - s.tiltZ * sy, 0, s.tiltX * sy + s.tiltZ * cy);
    // squash: a landing squashes straight down; a hit squashes the body ALONG the blow (the
    // side that was struck flattens, the body widens across it), so it reads which way it went
    const q = s.squash, hd = Math.min(1, this.recoil * 1.6);
    if (hd > 0.05 && (this.recoilX || this.recoilZ)) {
      const yw = g.rotation.y, c = Math.cos(yw), sn = Math.sin(yw);
      const lx = this.recoilX * c - this.recoilZ * sn, lz = this.recoilX * sn + this.recoilZ * c;
      const l = Math.hypot(lx, lz) || 1, ax = (lx / l) ** 2, az = (lz / l) ** 2;
      const k = q * hd;
      this.body.scale.set(1 + q * 0.2 * (1 - hd) - k * 0.3 * ax + k * 0.15 * az, 1 - q * 0.24 * (1 - hd) - k * 0.08, 1 + q * 0.2 * (1 - hd) - k * 0.3 * az + k * 0.15 * ax);
    } else this.body.scale.set(1 + q * 0.2, 1 - q * 0.24, 1 + q * 0.2);
    const lp = this.lp, a = this.ppose, b = this.pose;
    for (const k in b) lp[k] = (a[k] ?? b[k]) + (b[k] - (a[k] ?? b[k])) * alpha;
    this.apply(lp, alpha);
    // hit flash in two tones: solid white for the first half, then the archetype's hurt tint
    // at half strength (the silhouette and its colours show through), then clear
    const f = this.flashLevel();
    const m = this.material.userData;
    if (f >= 1) { m.flash.value = 1; m.flashColor.value.setHex(hex('white')); }
    else if (f) { m.flash.value = 0.5; m.flashColor.value.setHex(hex(this.D.hurtTint ?? 'red')); }
    else if (this.tell > 0) { m.flash.value = this.tell; m.flashColor.value.setHex(hex(this.tellColor)); }
    else m.flash.value = 0;
  }

  dispose() { this.dropToken(); this.group.removeFromParent(); this.onDispose?.(); }

  info() {
    return { id: this.id, type: this.kind, state: this.state, st: this.st, x: +this.x.toFixed(2), z: +this.z.toFixed(2), hp: this.hp, maxHp: this.maxHp,
      dying: !!this.dying, cool: this.cool, token: this.token, attacks: this.attacks, landed: this.landed, dodged: this.dodged, slot: this.slot == null ? null : +this.slot.toFixed(2) };
  }
}
