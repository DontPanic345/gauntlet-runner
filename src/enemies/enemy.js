// The enemy base class and the four archetypes (piece `enemies`).
//
// Every enemy is a combat `Hurtable` (so `HeroCombat` hits it through `takeHit`), with a
// small state machine:  pending -> spawn -> move <-> windup -> strike -> recover,  plus
// stagger, dying, and the brute's charge and stun.  Every attack has a windup that shows a
// pose change, a flash pulse and a floor marker, and the marker is the hitbox.
//
// Numbers come from data.js. Nothing in here is tuned by hand except through those tables.

import * as THREE from 'three';
import { Hurtable } from '../combat/combat.js';
import { voxelMesh, makeVoxelMaterial, VOXEL as V } from '../render/voxel/index.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { DT } from '../core/loop.js';
import { vfx } from '../vfx/index.js';
import { ENEMIES, knobs } from './data.js';
import { buildEnemyModels } from './models.js';
import { makeTele, sectorCells, laneCells, discCells } from './telegraph.js';

const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const HERO_R = 0.3;
const SPAWN_POP = 26, SPAWN_LEN = 46;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _ax = new THREE.Vector3();

export class Enemy extends Hurtable {
  constructor(sys, kind, x, z, o = {}) {
    const d = ENEMIES[kind];
    const hp = Math.max(1, Math.round(d.hp * knobs.hp * (o.hpMul ?? 1)));
    super({ id: o.id ?? kind, type: kind, x, z, r: d.r, h: d.h, hp, weight: d.weight, friction: 0.84, bounds: sys.bounds });
    buildEnemyModels();
    this.sys = sys; this.d = d; this.kind = kind; this.managed = true;
    this.collision = sys.collision;
    this.hitY = d.h * 0.55;
    this.debris = d.palette;
    const h = sys.hero;
    this.yaw = o.yaw ?? (h ? Math.atan2(h.x - x, h.z - z) : 0);
    this.pyaw = this.yaw;
    this.state = o.delay ? 'pending' : 'spawn';
    this.delay = o.delay || 0;
    this.st = 0; this.t = (Math.random() * 100) | 0;
    this.cool = 40 + ((Math.random() * 40) | 0);
    this.forced = false;         // showcase: an attack started by hand does not track or need a slot
    this.slot = null;            // attack slot category held right now
    this.hitPop = 999; this.gone = false;
    this.pose = { bob: 0, lean: 0, glow: 0 }; this.ppose = { ...this.pose };
    this.fallAng = 0; this.pfallAng = 0; this.fallDir = { x: 0, z: 1 };
    this.spawnK = 0; this.pspawnK = 0;
    this.tflash = 0;             // telegraph flash 0..1 (ember pulse on the body)
    this.mat = makeVoxelMaterial();
    this.g = new THREE.Group();
    this.yg = new THREE.Group();
    this.g.add(this.yg);
    this.shadow = voxelMesh('enemy.shadow');
    this.shadow.scale.set(d.r * 2.8, 0.06, d.r * 2.8);
    this.tele = null;
    this.build();
    sys.root.add(this.g, this.shadow);
    this.g.visible = false; this.shadow.visible = false;
    this.spawnAt = { x, z };
  }

  /** Add a voxel part that shares this enemy's material (so one flash hits every part). */
  part(model, parent = this.yg) {
    const m = voxelMesh(model);
    m.material = this.mat;
    parent.add(m);
    return m;
  }
  build() {}
  get vulnerable() { return this.state !== 'pending' && this.state !== 'spawn' && this.state !== 'dying' && !this.dead; }
  get solid() { return this.vulnerable && !this.gone; }
  get hero() { const h = this.sys.hero; return h && !h.dead ? h : null; }
  aiOn() { return this.sys.ai; }

  setState(s) { this.state = s; this.st = 0; }
  claim() { return this.forced || this.sys.claim(this, this.d.cat); }
  release() { this.sys.release(this); }
  ease(k, target, rate) { this.pose[k] += (target - this.pose[k]) * rate; }

  face(tx, tz, rate) {
    const d = wrap(Math.atan2(tx - this.x, tz - this.z) - this.yaw);
    this.yaw = wrap(this.yaw + clamp(d, -rate, rate));
  }
  /** Move under our own power: slides along walls, clamps to the room. */
  moveBy(dx, dz) {
    const want = Math.hypot(dx, dz);
    if (want < 1e-6) return { moved: 0, want: 0, blocked: false };
    const b = { x: this.x, z: this.z, r: this.r };
    if (this.collision) this.collision.move(b, dx, dz); else { b.x += dx; b.z += dz; }
    const B = this.bounds;
    if (B) {
      b.x = clamp(b.x, B.minX + this.r, B.maxX - this.r);
      b.z = clamp(b.z, B.minZ + this.r, B.maxZ - this.r);
    }
    const moved = Math.hypot(b.x - this.x, b.z - this.z);
    this.x = b.x; this.z = b.z;
    return { moved, want, blocked: moved < want * 0.55 };
  }
  speed() { return this.d.speed * knobs.speed * DT; }
  cooldown(n = this.d.cooldown) { return Math.round(n / knobs.aggression); }

  // ---- hits ---------------------------------------------------------------------------------
  hitMult() { return 1; }
  takeHit(hit) {
    if (!this.vulnerable) return false;
    const m = this.hitMult();
    if (m !== 1) hit.dmg = Math.round(hit.dmg * m);
    const ok = super.takeHit(hit);
    if (!ok) return false;
    this.hitPop = 0;
    this.fallDir = { x: hit.dx || 0, z: hit.dz || 1 };
    if (this.dead) { this.die(hit); return true; }
    this.onHurt(hit);
    events.emit('enemy:hurt', { enemy: this, kind: this.kind, x: this.x, z: this.z, dmg: hit.dmg, hp: this.hp });
    return true;
  }
  onHurt() {}
  /** Kill outright (showcase, debug). Returns true if it was alive. */
  kill(dx = 0, dz = 1) {
    if (!this.vulnerable) return false;
    return this.takeHit({ dmg: this.hp + 999, dx, dz, tx: dx, tz: dz, power: 1.6, step: 2, finisher: false, knock: 3, lift: 0, stopMs: 0, flashTicks: 5 });
  }
  die(hit) {
    this.release();
    this.tele?.hide();
    this.state = 'dying'; this.st = 0;
    this.forced = false;
    events.emit('enemy:die', { enemy: this, kind: this.kind, x: this.x, z: this.z, hit });
    this.onDie(hit);
  }
  onDie() {}
  burst(power = 1, y = this.h * 0.4) {
    vfx.death({ x: this.x, y: this.y + y, z: this.z, power, colors: this.d.palette });
  }
  finish() { this.gone = true; this.g.visible = false; this.shadow.visible = false; }

  // ---- per tick -----------------------------------------------------------------------------
  tick() {
    this.pyaw = this.yaw; this.ppose = Object.assign(this.ppose, this.pose);
    this.pfallAng = this.fallAng; this.pspawnK = this.spawnK;
    this.t++; this.st++; this.hitPop++;
    if (this.startIn > 0 && --this.startIn === 0 && this.state === 'move') this.startAttack();
    if (this.tflash > 0) this.tflash = Math.max(0, this.tflash - 0.12);
    if (this.state === 'pending') {
      this.px = this.x; this.pz = this.z;
      if (this.st >= this.delay) this.setState('spawn');
      return;
    }
    this.tickBody();
    if (this.state === 'spawn') { this.tickSpawn(); return; }
    if (this.state === 'dying') { this.tickDying(); this.updatePose(); return; }
    this.think();
    this.updatePose();
  }
  tickSpawn() {
    const s = this.st;
    if (s === 1) { vfx.portal({ x: this.x, z: this.z, radius: this.r * 2.4 + 0.35, dur: SPAWN_POP / 60, style: 'ember' }); events.emit('enemy:spawn', { enemy: this, kind: this.kind, x: this.x, z: this.z }); }
    if (s === SPAWN_POP) {
      this.squash = 0.6;
      vfx.dust({ x: this.x, z: this.z, n: 8, size: 4, speed: 0.8 });
      vfx.flash({ x: this.x, y: 0.3, z: this.z, color: 'flame', radius: 1.3, ms: 140 });
      events.emit('enemy:pop', { enemy: this, kind: this.kind, x: this.x, z: this.z });
    }
    this.spawnK = s < SPAWN_POP ? 0 : Math.min(1, (s - SPAWN_POP) / 14);
    this.updatePose();
    if (s >= SPAWN_LEN) { this.setState('move'); this.spawnK = 1; }
  }
  tickDying() {}
  think() {}
  updatePose() {}
  // showcase: begin an attack right now, in the direction we face, without tracking
  startAttack() {}

  // ---- render -------------------------------------------------------------------------------
  render(alpha) {
    const hidden = this.state === 'pending' || this.gone || (this.state === 'spawn' && this.st < SPAWN_POP) || this.hidden;
    this.g.visible = !hidden;
    this.shadow.visible = !hidden && this.state !== 'dying';
    if (hidden) return;
    const s = this.at(alpha);
    _v.set(s.x, s.y, s.z);
    look.snap(_v);
    this.g.position.copy(_v);
    const L = (a, b) => a + (b - a) * alpha;
    _e.set(s.tiltX, 0, s.tiltZ);
    this.g.quaternion.setFromEuler(_e);
    const fa = L(this.pfallAng, this.fallAng);
    if (fa) { _ax.set(this.fallDir.z, 0, -this.fallDir.x).normalize(); _q2.setFromAxisAngle(_ax, fa); this.g.quaternion.premultiply(_q2); }
    this.yg.rotation.y = this.pyaw + wrap(this.yaw - this.pyaw) * alpha;
    const q = s.squash, pop = L(this.pspawnK, this.spawnK);
    const sp = this.state === 'spawn' ? (0.15 + 0.85 * (1 - Math.pow(1 - pop, 3)) + Math.sin(pop * Math.PI) * 0.18) : 1;
    const ms = this.d.scale ?? 1;
    this.yg.scale.set((1 + q * 0.18) * sp * ms, (1 - q * 0.22) * sp * ms, (1 + q * 0.18) * sp * ms);
    const p = {};
    for (const k in this.pose) p[k] = L(this.ppose[k] ?? this.pose[k], this.pose[k]);
    this.applyPose(p, alpha);
    // flash: hit flash (white) wins; a telegraph pulse tints ember
    const f = this.flashLevel();
    this.mat.userData.flash.value = f || this.tflash * 0.5;
    this.mat.userData.flashColor.value.setHex(f ? hex('white') : hex('ember'));
    const gh = 1 - Math.min(0.6, s.y * 0.4);
    this.shadow.position.set(_v.x, 0.006, _v.z);
    const ss = this.d.r * 2.8 * gh * (this.shadowScale ?? 1);
    this.shadow.scale.set(ss, 0.06, ss);
  }
  applyPose() {}

  dispose() {
    this.release();
    this.sys.root.remove(this.g, this.shadow);
    this.tele?.dispose();
  }
  info() {
    return { id: this.id, type: this.kind, state: this.state, x: +this.x.toFixed(2), z: +this.z.toFixed(2), hp: this.hp, maxHp: this.maxHp, st: this.st, slot: this.slot };
  }
}

// ==============================================================================================
// HUSK: shambling chaser. Lurches, curves round to flank, raises both arms, slams.
// ==============================================================================================
export class Husk extends Enemy {
  constructor(sys, x, z, o = {}) {
    super(sys, 'husk', x, z, o);
    this.flankSide = o.flank ?? (Math.random() < 0.5 ? -1 : 1);
    this.orbit = this.flankSide;
    this.swingHit = false;
  }
  build() {
    this.legL = this.part('enemy.husk.leg'); this.legR = this.part('enemy.husk.leg');
    this.legL.position.set(-1.6 * V, 4 * V, 0); this.legR.position.set(1.6 * V, 4 * V, 0);
    this.bodyG = new THREE.Group(); this.bodyG.position.y = 4 * V; this.yg.add(this.bodyG);
    this.part('enemy.husk.body', this.bodyG);
    this.armL = this.part('enemy.husk.arm', this.bodyG); this.armR = this.part('enemy.husk.arm', this.bodyG);
    this.armL.position.set(-3.4 * V, 4.2 * V, 1 * V); this.armR.position.set(3.4 * V, 4.2 * V, 1 * V);
    Object.assign(this.pose, { legA: 0, legB: 0, armA: 0.1, armB: 0.1, sway: 0 });
    this.shadowScale = 0.9;
  }
  onHurt(hit) {
    if (this.state === 'strike') return;
    this.release(); this.tele?.hide();
    this.setState('stagger'); this.forced = false;
    this.staggerLen = hit.finisher ? this.d.stagger * 2 : this.d.stagger;
    this.cool = Math.max(this.cool, 22);
  }
  startAttack() { this.forced = true; this.setState('windup'); this.swingHit = false; this.beginWindup(); }
  beginWindup() {
    if (!this.tele) this.tele = makeTele(this.sys.root, sectorCells(this.d.reach + HERO_R, this.d.arc));
    events.emit('enemy:windup', { enemy: this, kind: 'husk', x: this.x, z: this.z });
  }
  think() {
    const d = this.d, h = this.hero;
    const hx = h ? h.x : this.x, hz = h ? h.z : this.z + 5;
    const dx = hx - this.x, dz = hz - this.z, dist = Math.hypot(dx, dz);
    switch (this.state) {
      case 'move': {
        this.cool--;
        if (!this.aiOn() || !h) { this.face(hx, hz, 0.02); break; }
        const near = dist < d.reach + HERO_R + 0.28;
        if (near && this.cool <= 0 && this.claim()) { this.setState('windup'); this.swingHit = false; this.beginWindup(); break; }
        // flank: while far, aim for a point off to one side of the hero, and close in as we arrive
        const ang = Math.atan2(this.x - hx, this.z - hz);
        const bend = this.flankSide * d.flank * clamp((dist - 1.5) / 3.5, 0, 1);
        let tx, tz, spd;
        if (dist < 2.6 && (this.cool > 0 || !near)) {
          if (this.cool > 0 || this.sys.slotsFull(d.cat)) {         // hold the ring: circle and wait for a turn
            const a = ang + this.orbit * 0.5;
            tx = hx + Math.sin(a) * 1.9; tz = hz + Math.cos(a) * 1.9; spd = 0.55;
          } else { tx = hx; tz = hz; spd = 1; }
        } else {
          const a = ang + bend;
          const rr = Math.max(0.6, Math.min(dist, 1.0));
          tx = hx + Math.sin(a) * rr * 0.4; tz = hz + Math.cos(a) * rr * 0.4; spd = 1;
          if (dist > 3.2) { tx = hx + Math.sin(a) * 1.0; tz = hz + Math.cos(a) * 1.0; }
        }
        this.face(tx, tz, d.turn);
        const lurch = 0.3 + 0.7 * Math.max(0, Math.sin(this.t * 0.14 + 0.6));
        const r = this.moveBy(Math.sin(this.yaw) * this.speed() * lurch * spd * 1.5, Math.cos(this.yaw) * this.speed() * lurch * spd * 1.5);
        if (r.blocked) this.orbit = -this.orbit;
        this.walk = lurch * spd;
        break;
      }
      case 'windup': {
        if (!this.forced && this.st < d.windup - 12 && h) this.face(hx, hz, d.turn * 0.7);
        const p = this.st / d.windup;
        this.tele.set(p, false, this.x, this.z, this.yaw, this.st);
        this.tflash = this.st > d.windup - 14 ? ((this.st >> 1) & 1 ? 1 : 0.2) : Math.max(this.tflash, 0.25 * p);
        if (this.st >= d.windup) { this.setState('strike'); this.swingHit = false; events.emit('enemy:attack', { enemy: this, kind: 'husk', x: this.x, z: this.z }); }
        break;
      }
      case 'strike': {
        this.tele.set(1, true, this.x, this.z, this.yaw, this.st);
        if (this.st === 1) { this.vx += Math.sin(this.yaw) * 2.2; this.vz += Math.cos(this.yaw) * 2.2; }
        if (this.st === 2) {
          const fx = this.x + Math.sin(this.yaw) * d.reach, fz = this.z + Math.cos(this.yaw) * d.reach;
          vfx.dust({ x: fx, z: fz, dx: Math.sin(this.yaw), dz: Math.cos(this.yaw), n: 7, size: 4, speed: 1.1 });
          feedback.shake(1.2, 90);
          if (h && !this.swingHit && !this.forced) {
            const rel = Math.abs(wrap(Math.atan2(dx, dz) - this.yaw)) * 180 / Math.PI;
            if (dist - HERO_R <= d.reach && rel <= d.arc) { this.swingHit = true; h.hurt(d.dmg, { x: this.x, z: this.z }); }
          }
        }
        if (this.st >= d.strike) { this.tele.hide(); this.setState('recover'); }
        break;
      }
      case 'recover':
        if (this.st >= d.recover) { this.setState('move'); this.forced = false; this.release(); this.cool = this.cooldown(); }
        break;
      case 'stagger':
        this.tele?.hide();
        if (this.st >= this.staggerLen) { this.setState('move'); }
        break;
    }
    if (this.state !== 'move') this.walk = 0;
  }
  updatePose() {
    const s = this.state, P = this.pose, t = this.t;
    const ph = t * 0.14 + 0.6;
    const walk = this.walk ?? 0;
    P.legA = Math.sin(ph) * 0.65 * walk; P.legB = -Math.sin(ph) * 0.65 * walk;
    P.sway = Math.sin(t * 0.045) * 0.05;
    let armT = 0.1 + Math.sin(t * 0.06) * 0.12, leanT = 0.12 + Math.max(0, Math.sin(ph)) * 0.1 * walk, bobT = Math.abs(Math.sin(ph)) * 0.02 * walk, r = 0.25;
    if (s === 'windup') { const p = this.st / this.d.windup; armT = -2.7 * Math.min(1, p * 1.5); leanT = -0.35 * Math.min(1, p * 1.5); bobT = 0.03 * p; r = 0.22; }
    else if (s === 'strike') { armT = 0.9; leanT = 0.5; bobT = -0.05; r = 0.7; }
    else if (s === 'recover') { armT = 0.6 - 0.5 * (this.st / this.d.recover); leanT = 0.4 - 0.3 * (this.st / this.d.recover); r = 0.1; }
    else if (s === 'stagger') { armT = -1.3 + Math.sin(this.st * 0.8) * 0.3; leanT = -0.5; r = 0.5; }
    this.ease('armA', armT, r); this.ease('armB', armT + Math.sin(t * 0.09 + 1) * 0.06, r);
    this.ease('lean', leanT, r); this.ease('bob', bobT, 0.3);
  }
  applyPose(p) {
    this.legL.rotation.x = p.legA; this.legR.rotation.x = p.legB;
    this.armL.rotation.x = p.armA; this.armR.rotation.x = p.armB;
    this.bodyG.rotation.set(p.lean, 0, p.sway);
    this.bodyG.position.y = 4 * V + p.bob;
  }
  onDie(hit) {
    this.vx += (hit.dx || 0) * 1.5; this.vz += (hit.dz || 0) * 1.5;
    this.staggerLen = 0;
  }
  tickDying() {
    const s = this.st;
    this.walk = 0;
    // flop: the whole corpse falls over away from the blow, bounces once, lies there, then crumbles
    const k = clamp(s / 13, 0, 1);
    this.fallAng = (Math.PI / 2) * (k * k) * 0.97 + (s > 13 ? Math.max(0, Math.sin((s - 13) * 0.9)) * 0.06 * Math.max(0, 1 - (s - 13) / 8) : 0);
    if (s === 13) {
      this.squash = 0.5;
      vfx.dust({ x: this.x, z: this.z, dx: this.fallDir.x, dz: this.fallDir.z, n: 10, size: 5, speed: 1.1 });
      vfx.shockwave({ x: this.x + this.fallDir.x * 0.5, z: this.z + this.fallDir.z * 0.5, radius: 0.9, style: 'dust' });
      feedback.shake(1.6, 110);
      events.emit('enemy:flop', { enemy: this, x: this.x, z: this.z });
    }
    this.pose.armA = this.pose.armB = -1.6 + Math.min(1, s / 12) * 1.2;
    this.tflash = s > 24 ? ((s >> 1) & 1) : 0;
    if (s === 34) { this.burst(1.1, 0.25); vfx.dust({ x: this.x, z: this.z, n: 10, size: 6, speed: 0.9 }); this.finish(); }
  }
}

// ==============================================================================================
// EMBER WISP: a floating flame that keeps its distance and lobs slow orbs.
// ==============================================================================================
export class Wisp extends Enemy {
  constructor(sys, x, z, o = {}) {
    super(sys, 'wisp', x, z, o);
    this.orbit = Math.random() < 0.5 ? -1 : 1;
    this.orbitT = 120 + ((Math.random() * 120) | 0);
    this.aim = this.yaw; this.hover = 0.42;
  }
  build() {
    this.tail = this.part('enemy.wisp.tail');
    this.head = this.part('enemy.wisp.head');
    this.core = this.part('enemy.wisp.core');
    this.head.position.y = 3 * V; this.tail.position.y = 5 * V;
    this.core.position.set(0, 7.4 * V, 1.3 * V);
    Object.assign(this.pose, { flick: 0, swell: 0, hov: 0 });
    this.shadowScale = 1.1;
    this.y0 = 0;
  }
  onHurt(hit) {
    this.release(); this.tele?.hide();
    this.setState('stagger'); this.forced = false;
    this.cool = Math.max(this.cool, 45);
  }
  startAttack() { this.forced = true; this.aim = this.yaw; this.setState('charge'); this.beginCharge(); }
  beginCharge() {
    if (!this.tele) this.tele = makeTele(this.sys.root, laneCells(6.2, 0.16, { dotted: true, from: 0.5 }));
    events.emit('enemy:windup', { enemy: this, kind: 'wisp', x: this.x, z: this.z });
  }
  think() {
    const d = this.d, h = this.hero;
    const hx = h ? h.x : this.x, hz = h ? h.z : this.z + 5;
    const dx = hx - this.x, dz = hz - this.z, dist = Math.hypot(dx, dz) || 1;
    const B = this.bounds;
    switch (this.state) {
      case 'move': {
        this.cool--; this.orbitT--;
        if (!this.aiOn() || !h) { this.face(hx, hz, 0.03); break; }
        if (this.orbitT <= 0) { this.orbit = -this.orbit; this.orbitT = 140 + ((Math.random() * 140) | 0); }
        // radial: back off inside keepMin, close in outside keepMax, otherwise drift round the hero
        let rad = 0;
        if (dist < d.keepMin) rad = -1.15; else if (dist > d.keepMax) rad = 0.9; else rad = (dist - (d.keepMin + d.keepMax) / 2) * 0.25;
        const tan = dist < d.keepMin ? 0.7 : 0.55;
        let mx = (dx / dist) * rad + (dz / dist) * -this.orbit * tan;
        let mz = (dz / dist) * rad + (dx / dist) * this.orbit * tan;
        if (B) {   // stay off the walls: lean toward the middle of the room
          const cx = (B.minX + B.maxX) / 2, cz = (B.minZ + B.maxZ) / 2, m = 0.9;
          if (this.x < B.minX + m) mx += 0.9; if (this.x > B.maxX - m) mx -= 0.9;
          if (this.z < B.minZ + m) mz += 0.9; if (this.z > B.maxZ - m) mz -= 0.9;
        }
        const l = Math.hypot(mx, mz) || 1;
        const s = this.speed();
        const r = this.moveBy((mx / l) * s * Math.min(1, l), (mz / l) * s * Math.min(1, l));
        if (r.blocked) this.orbit = -this.orbit;
        this.face(hx, hz, d.turn);
        if (this.cool <= 0 && dist > 2.0 && dist < 7.5 && this.claim()) { this.aim = Math.atan2(dx, dz); this.setState('charge'); this.beginCharge(); }
        break;
      }
      case 'charge': {
        const lock = d.windup - 16;
        if (!this.forced && this.st < lock && h) { this.aim = Math.atan2(dx, dz); this.face(hx, hz, 0.2); }
        else this.yaw = wrap(this.yaw + clamp(wrap(this.aim - this.yaw), -0.2, 0.2));
        const p = this.st / d.windup;
        // the aim dots fill along the shot; after the lock they hold and blink
        this.tele.set(this.st < lock ? 0.25 + p * 0.5 : Math.min(1, 0.9 + (this.st - lock) / 16 * 0.1), false, this.x, this.z, this.aim, this.st);
        this.tflash = this.st >= lock ? ((this.st >> 1) & 1 ? 1 : 0.3) : 0.2 + 0.4 * p;
        this.moveBy(-Math.sin(this.aim) * 0.15 * DT, -Math.cos(this.aim) * 0.15 * DT);
        if (this.st >= d.windup) { this.setState('fire'); this.fireOrb(); }
        break;
      }
      case 'fire':
        this.tele.set(1, true, this.x, this.z, this.aim, this.st);
        if (this.st >= d.strike) { this.tele.hide(); this.setState('recover'); }
        break;
      case 'recover':
        if (this.st >= d.recover) { this.setState('move'); this.forced = false; this.release(); this.cool = this.cooldown(); }
        break;
      case 'stagger':
        this.tele?.hide();
        if (this.st >= d.stagger) this.setState('move');
        break;
    }
  }
  fireOrb() {
    const d = this.d, sn = Math.sin(this.aim), cs = Math.cos(this.aim);
    this.sys.spawnOrb(this.x + sn * 0.45, this.hover + 0.32, this.z + cs * 0.45, sn, cs, d.orbSpeed * Math.sqrt(knobs.aggression), d.orbLife, d.dmg, this);
    this.vx -= sn * 3.2; this.vz -= cs * 3.2;
    this.squash = 0.5;
    this.tflash = 1;
    vfx.embers({ x: this.x + sn * 0.4, y: this.hover + 0.3, z: this.z + cs * 0.4, n: 6 });
    vfx.flash({ x: this.x + sn * 0.4, y: this.hover + 0.3, z: this.z + cs * 0.4, color: 'flame', radius: 1.2, ms: 120 });
    events.emit('enemy:attack', { enemy: this, kind: 'wisp', x: this.x, z: this.z });
  }
  updatePose() {
    const s = this.state, P = this.pose, t = this.t;
    const swellT = s === 'charge' ? 0.35 + 0.65 * (this.st / this.d.windup) : s === 'fire' ? 0 : s === 'stagger' ? -0.2 : 0;
    this.ease('swell', swellT, 0.18);
    P.flick = Math.sin(t * 0.37) * 0.5 + Math.sin(t * 0.91) * 0.3;
    const hovT = 0.42 + Math.sin(t * 0.07) * 0.06 + (s === 'charge' ? -0.06 : 0) + (s === 'spawn' ? 0 : 0);
    this.ease('hov', hovT, 0.2);
    P.lean = (P.lean ?? 0);
    this.hover = P.hov;
    // hit height for combat: a wisp floats, so the spark centre rises with it
    this.hitY = P.hov + 0.45;
  }
  applyPose(p) {
    this.yg.position.y = p.hov;
    const sw = 1 + p.swell * 0.22;
    this.head.scale.set(sw, sw * (1 + p.flick * 0.05), sw);
    this.tail.scale.set(1 + p.flick * 0.06, 1 + p.flick * 0.12 + p.swell * 0.1, 1 + p.flick * 0.06);
    this.tail.rotation.set(0.95 + Math.sin(this.t * 0.12) * 0.12, 0, Math.cos(this.t * 0.1) * 0.12);
    const cs = 1 + p.swell * 1.5 + p.flick * 0.1;
    this.core.scale.set(cs, cs, cs);
    this.core.position.set(0, 7.4 * V, (1.3 + p.swell * 2.2) * V);
  }
  onDie() {
    // shatter: a white frame, then the burst (in tickDying)
    this.tflash = 1; this.vx *= 0.2; this.vz *= 0.2;
    vfx.flash({ x: this.x, y: this.hover + 0.4, z: this.z, color: 'flame', radius: 2.2, ms: 220 });
    vfx.embers({ x: this.x, y: this.hover + 0.3, z: this.z, n: 16 });
    vfx.shockwave({ x: this.x, z: this.z, radius: 1.3, style: 'ember' });
  }
  tickDying() {
    const s = this.st;
    this.hidden = false;
    this.mat.userData.flash.value = 1;
    if (s === 3) { vfx.death({ x: this.x, y: this.hover + 0.45, z: this.z, power: 1, colors: this.d.palette }); this.hidden = true; this.shadow.visible = false; }
    if (s >= 4) this.finish();
  }
}

// ==============================================================================================
// BRUTE: winds up, paws the ground, charges down a marked lane; a wall stuns it.
// ==============================================================================================
export class Brute extends Enemy {
  constructor(sys, x, z, o = {}) {
    super(sys, 'brute', x, z, o);
    this.dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) };
    this.travel = 0; this.hitHero = false; this.chargeV = 0;
  }
  build() {
    this.legL = this.part('enemy.brute.leg'); this.legR = this.part('enemy.brute.leg');
    this.legL.position.set(-2.6 * V, 5 * V, 0); this.legR.position.set(2.6 * V, 5 * V, 0);
    this.bodyG = new THREE.Group(); this.bodyG.position.y = 5 * V; this.yg.add(this.bodyG);
    this.part('enemy.brute.body', this.bodyG);
    this.armL = this.part('enemy.brute.arm', this.bodyG); this.armR = this.part('enemy.brute.arm', this.bodyG);
    this.armL.position.set(-6.9 * V, 8.6 * V, 0.6 * V); this.armR.position.set(6.9 * V, 8.6 * V, 0.6 * V);
    Object.assign(this.pose, { legA: 0, legB: 0, armA: 0, armB: 0, sway: 0, dip: 0 });
    // dizzy stars for the stun
    this.stars = [0, 1, 2].map(() => { const m = this.part('enemy.star', this.g); m.visible = false; m.scale.setScalar(1.3); return m; });
    this.shadowScale = 1.25;
  }
  hitMult() { return this.state === 'stunned' ? this.d.stunBonus : 1; }
  onHurt(hit) {
    // heavy: it does not flinch out of a charge or windup; only a stun leaves it open
    this.squash = Math.max(this.squash, 0.3);
    if (this.state === 'recover' && hit.finisher) { this.st = Math.max(this.st, this.d.recover - 10); }
  }
  startAttack() { this.forced = true; this.dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; this.beginTele(); }
  beginTele() {
    this.setState('telegraph');
    if (!this.tele) this.tele = makeTele(this.sys.root, laneCells(this.d.lane, this.d.laneW));
    events.emit('enemy:windup', { enemy: this, kind: 'brute', x: this.x, z: this.z });
  }
  think() {
    const d = this.d, h = this.hero;
    const hx = h ? h.x : this.x, hz = h ? h.z : this.z + 5;
    const dx = hx - this.x, dz = hz - this.z, dist = Math.hypot(dx, dz) || 1;
    switch (this.state) {
      case 'move': {
        this.cool--;
        if (!this.aiOn() || !h) { this.face(hx, hz, 0.02); this.walk = 0; break; }
        const ready = this.cool <= 0 && dist > 1.4 && dist < d.chargeMax;
        if (ready && this.claim()) { this.beginTele(); break; }
        this.face(hx, hz, d.turn);
        // too close to charge usefully: shoulder off to the side and turn. Otherwise plod in.
        const want = dist > 2.6 ? 1 : dist < 1.5 ? -0.4 : 0.2;
        this.moveBy(Math.sin(this.yaw) * this.speed() * want, Math.cos(this.yaw) * this.speed() * want);
        this.walk = Math.abs(want);
        break;
      }
      case 'telegraph': {
        const lock = d.windup - 22;
        if (!this.forced && this.st < lock && h) { this.face(hx, hz, 0.06); this.dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; }
        else this.yaw = wrap(this.yaw + clamp(wrap(Math.atan2(this.dir.x, this.dir.z) - this.yaw), -0.1, 0.1));
        const p = this.st / d.windup;
        if (this.collision) this.tele.clip = Math.min(1, this.collision.raycast(this.x, this.z, this.dir.x, this.dir.z, d.lane, this.r * 0.7) / d.lane);
        this.tele.set(p, false, this.x, this.z, Math.atan2(this.dir.x, this.dir.z), this.st);
        this.tflash = this.st >= lock ? ((this.st >> 1) & 1 ? 1 : 0.25) : 0.15 + 0.3 * p;
        // paw the ground three times
        if (this.st === 12 || this.st === 27 || this.st === 42) {
          this.squash = 0.5; this.pawSide = this.st === 27 ? 1 : -1;
          vfx.dust({ x: this.x, z: this.z + 0.0, dx: -this.dir.x, dz: -this.dir.z, n: 6, size: 5, speed: 0.9 });
          feedback.shake(1.1, 100);
          events.emit('enemy:paw', { enemy: this, x: this.x, z: this.z });
        }
        if (this.st >= d.windup) { this.setState('charge'); this.travel = 0; this.hitHero = false; this.chargeV = 2.5; this.tele.set(1, true, this.x, this.z, Math.atan2(this.dir.x, this.dir.z), 0); events.emit('enemy:attack', { enemy: this, kind: 'brute', x: this.x, z: this.z }); }
        break;
      }
      case 'charge': {
        this.chargeV = Math.min(d.chargeSpeed * knobs.speed, this.chargeV + 0.55);
        if (this.st > 1 && this.tele.visible && this.st > 6) this.tele.hide();
        else if (this.st <= 6) this.tele.set(1, true, this.x, this.z, Math.atan2(this.dir.x, this.dir.z), this.st);
        const step = this.chargeV * DT;
        const r = this.moveBy(this.dir.x * step, this.dir.z * step);
        this.travel += r.moved;
        this.yaw = Math.atan2(this.dir.x, this.dir.z);
        if (this.st % 3 === 0) vfx.dust({ x: this.x, z: this.z, dx: -this.dir.x, dz: -this.dir.z, n: 3, size: 4, speed: 1.2 });
        if (h && !this.hitHero && !this.forced && Math.hypot(hx - this.x, hz - this.z) < this.r + HERO_R + 0.05) {
          const res = h.hurt(d.dmg, { x: this.x - this.dir.x * 0.5, z: this.z - this.dir.z * 0.5 });
          if (res && (res.ok || res.reason === 'iframes')) { this.hitHero = true; }
        }
        if (r.blocked && this.st > 4) { this.wallHit(); break; }
        if (this.travel > d.lane + 1.5) { this.setState('recover'); }
        break;
      }
      case 'recover':
        this.walk = 0;
        if (this.st >= d.recover) { this.setState('move'); this.forced = false; this.release(); this.cool = this.cooldown(); }
        break;
      case 'stunned':
        this.walk = 0;
        if (this.st >= d.stun) { this.setState('move'); this.forced = false; this.release(); this.cool = this.cooldown(50); }
        break;
    }
    if (this.state !== 'move') this.walk = 0;
  }
  wallHit() {
    const d = this.d;
    this.release(); this.tele?.hide();
    const cx = this.x + this.dir.x * this.r, cz = this.z + this.dir.z * this.r;
    this.vx = -this.dir.x * 3.4; this.vz = -this.dir.z * 3.4;
    this.vy = 2.2; this.squash = 0.9;
    this.setState('stunned');
    vfx.hit({ x: cx, y: 0.9, z: cz, dx: -this.dir.x, dz: -this.dir.z, power: 1.6, style: 'hit' });
    vfx.dust({ x: cx, z: cz, dx: -this.dir.x, dz: -this.dir.z, n: 14, size: 6, speed: 1.4 });
    vfx.shockwave({ x: cx, z: cz, radius: 1.6, style: 'dust' });
    feedback.hitstop(70); feedback.shake(4.5, 260); feedback.kick(this.dir.x, this.dir.z * 0.77, 3);
    events.emit('enemy:wallStun', { enemy: this, x: cx, z: cz });
  }
  updatePose() {
    const s = this.state, P = this.pose, t = this.t;
    const ph = t * 0.09, walk = this.walk ?? 0;
    P.legA = Math.sin(ph) * 0.45 * walk; P.legB = -Math.sin(ph) * 0.45 * walk;
    P.sway = Math.sin(t * 0.05) * 0.03;
    let armA = 0.08 + Math.sin(t * 0.05) * 0.04 + Math.sin(ph) * 0.3 * walk, armB = 0.08 + Math.sin(t * 0.05 + 2) * 0.04 - Math.sin(ph) * 0.3 * walk;
    let leanT = 0.05 + Math.sin(t * 0.05) * 0.015, dipT = 0, r = 0.2;
    if (s === 'telegraph') {
      const p = this.st / this.d.windup;
      armA = -2.6 * Math.min(1, p * 2) + Math.sin(this.st * 0.7) * 0.15 * (p > 0.5);
      armB = armA + 0.05;
      leanT = -0.32 * Math.min(1, p * 2) + 0.1 * (p > 0.7); dipT = -0.05 * p; r = 0.25;
      if (this.pawSide && this.st % 15 < 5) { armA += 0.0; }
    } else if (s === 'charge') { armA = 1.1; armB = 1.1; leanT = 0.75; r = 0.5; }
    else if (s === 'recover') { const p = this.st / this.d.recover; armA = armB = 0.3; leanT = 0.4 - 0.3 * p + Math.sin(t * 0.35) * 0.04; dipT = -0.06 + Math.sin(t * 0.35) * 0.015; r = 0.15; }
    else if (s === 'stunned') { armA = 0.5 + Math.sin(t * 0.12) * 0.1; armB = 0.5 - Math.sin(t * 0.12) * 0.1; leanT = -0.12 + Math.sin(t * 0.14) * 0.16; dipT = -0.07; r = 0.15; P.sway = Math.sin(t * 0.14 + 1) * 0.16; }
    this.ease('armA', armA, r); this.ease('armB', armB, r); this.ease('lean', leanT, r); this.ease('dip', dipT, 0.2);
    this.ease('bob', Math.abs(Math.sin(ph)) * 0.025 * walk, 0.3);
    this.stunned = s === 'stunned';
  }
  applyPose(p) {
    this.legL.rotation.x = p.legA; this.legR.rotation.x = p.legB;
    this.armL.rotation.x = p.armA; this.armR.rotation.x = p.armB;
    this.bodyG.rotation.set(p.lean, 0, p.sway);
    this.bodyG.position.y = 5 * V + p.bob + p.dip;
    // stars circle above the head while stunned
    for (let i = 0; i < 3; i++) {
      const m = this.stars[i];
      m.visible = this.stunned;
      if (!this.stunned) continue;
      const a = this.t * 0.11 + i * TAU / 3;
      m.position.set(Math.sin(a) * 0.45, 1.75 + Math.sin(this.t * 0.2 + i) * 0.04, Math.cos(a) * 0.3);
      m.rotation.y = -this.yg.rotation.y + Math.sin(a) * 0.3;
    }
  }
  onDie(hit) { this.stunned = false; this.vx *= 0.3; this.vz *= 0.3; this.tflash = 0; for (const s of this.stars) s.visible = false; }
  tickDying() {
    const s = this.st, P = this.pose;
    P.armA = P.armB = 0.4 + Math.sin(s * 0.3) * 0.1; P.legA = P.legB = 0;
    // 0-26: it staggers and shakes, 26-44: sinks to its knees and topples, then lies still and crumbles
    if (s < 26) { P.sway = Math.sin(s * 0.9) * 0.1; this.pose.dip = -0.02 * s / 26; this.tflash = (s % 8 < 2) ? 0.6 : 0; if (s === 4 || s === 14) { feedback.shake(1.5, 90); vfx.dust({ x: this.x, z: this.z, n: 5, size: 5 }); } }
    else { this.pose.dip = -0.2; this.pose.lean = 0.35; }
    const k = clamp((s - 26) / 18, 0, 1);
    this.fallAng = (Math.PI / 2) * k * k * 0.97;
    if (s === 44) {
      this.squash = 0.8;
      vfx.shockwave({ x: this.x, z: this.z, radius: 2.4, style: 'dust' });
      vfx.dust({ x: this.x, z: this.z, dx: this.fallDir.x, dz: this.fallDir.z, n: 16, size: 6, speed: 1.4 });
      feedback.hitstop(60); feedback.shake(5, 320);
      events.emit('enemy:flop', { enemy: this, x: this.x, z: this.z });
    }
    this.tflash = s > 64 ? ((s >> 1) & 1) : this.tflash;
    if (s === 78) {
      this.burst(2.0, 0.4);
      vfx.flash({ x: this.x, y: 0.5, z: this.z, color: 'flame', radius: 1.7, ms: 150 });
      vfx.dust({ x: this.x, z: this.z, n: 14, size: 7, speed: 1.1 });
      this.finish();
    }
  }
}

// ==============================================================================================
// MITE: fist-sized, fast, erratic. Squats, marks a red spot, leaps at it.
// ==============================================================================================
export class Mite extends Enemy {
  constructor(sys, x, z, o = {}) {
    super(sys, 'mite', x, z, o);
    this.phase = Math.random() * TAU; this.bias = (Math.random() - 0.5) * 2.2;
    this.leapFrom = null; this.leapTo = null; this.leapHit = false;
    this.walk = 0;
  }
  build() {
    this.bodyG = new THREE.Group(); this.yg.add(this.bodyG);
    this.part('enemy.mite.body', this.bodyG).position.y = 0.5 * V;
    this.legsA = this.part('enemy.mite.legs.a', this.bodyG); this.legsB = this.part('enemy.mite.legs.b', this.bodyG);
    this.legsA.position.y = 0; this.legsB.position.y = 0;
    Object.assign(this.pose, { squat: 0, hop: 0 });
    this.shadowScale = 1;
  }
  onHurt(hit) {
    this.release(); this.tele?.hide(); this.forced = false;
    this.setState('stagger'); this.cool = Math.max(this.cool, 30);
  }
  startAttack() { this.forced = true; this.leapTarget = { x: this.x + Math.sin(this.yaw) * 1.0, z: this.z + Math.cos(this.yaw) * 1.0 }; this.setState('windup'); this.beginWindup(); }
  beginWindup() {
    if (!this.tele) this.tele = makeTele(this.sys.root, discCells(0.4));
    events.emit('enemy:windup', { enemy: this, kind: 'mite', x: this.x, z: this.z });
  }
  think() {
    const d = this.d, h = this.hero;
    const hx = h ? h.x : this.x, hz = h ? h.z : this.z + 5;
    const dx = hx - this.x, dz = hz - this.z, dist = Math.hypot(dx, dz) || 1;
    switch (this.state) {
      case 'move': {
        this.cool--;
        if (!this.aiOn() || !h) { this.walk = 0; this.face(hx, hz, 0.05); break; }
        if (dist < 1.45 && this.cool <= 0 && this.claim()) {
          this.leapTarget = { x: hx, z: hz };
          this.setState('windup'); this.beginWindup(); break;
        }
        // scurry in on a zigzag; each mite has its own bias so a group fans out round the hero
        const a = Math.atan2(this.x - hx, this.z - hz) + this.bias * clamp((dist - 1) / 3, 0, 1) * 0.6;
        const rr = dist > 2.5 ? 0.9 : 1.05 + (this.cool > 0 ? 0.5 : 0);
        const tx = hx + Math.sin(a) * rr, tz = hz + Math.cos(a) * rr;
        this.face(tx + Math.sin(this.t * 0.31 + this.phase) * 0.6, tz + Math.cos(this.t * 0.27 + this.phase) * 0.6, d.turn);
        const surge = 0.65 + 0.35 * Math.sin(this.t * 0.4 + this.phase);
        const wait = dist < 1.7 && this.cool > 0 ? 0.5 : 1;
        this.moveBy(Math.sin(this.yaw) * this.speed() * surge * wait, Math.cos(this.yaw) * this.speed() * surge * wait);
        this.walk = surge * wait;
        break;
      }
      case 'windup': {
        this.walk = 0;
        const p = this.st / d.windup;
        if (!this.forced && this.st < d.windup - 8 && h) this.leapTarget = { x: hx, z: hz };
        if (!this.forced) this.face(this.leapTarget.x, this.leapTarget.z, 0.3);
        // the leap lands at most `leap` away, along our facing
        const lx = this.leapTarget.x - this.x, lz = this.leapTarget.z - this.z, ll = Math.hypot(lx, lz) || 1, k = Math.min(1, d.leap / ll);
        this.landAt = { x: this.x + lx * k, z: this.z + lz * k };
        this.tele.set(p, false, this.landAt.x, this.landAt.z, 0, this.st);
        this.tflash = (this.st >> 1) & 1 ? 1 : 0.3;
        if (this.st >= d.windup) { this.leapFrom = { x: this.x, z: this.z }; this.leapHit = false; this.setState('leap'); events.emit('enemy:attack', { enemy: this, kind: 'mite', x: this.x, z: this.z }); }
        break;
      }
      case 'leap': {
        const u = Math.min(1, this.st / d.strike), L = this.landAt;
        this.tele.set(1, true, L.x, L.z, 0, this.st);
        const nx = this.leapFrom.x + (L.x - this.leapFrom.x) * u, nz = this.leapFrom.z + (L.z - this.leapFrom.z) * u;
        this.moveBy(nx - this.x, nz - this.z);
        this.y = Math.sin(u * Math.PI) * 0.4;
        if (h && !this.leapHit && !this.forced && u > 0.4) {
          if (Math.hypot(hx - this.x, hz - this.z) < this.r + HERO_R + 0.06 && this.y < 0.36) { this.leapHit = true; h.hurt(d.dmg, { x: this.x, z: this.z }); }
        }
        if (this.st >= d.strike) { this.y = 0; this.squash = 0.5; this.tele.hide(); vfx.dust({ x: this.x, z: this.z, n: 4, size: 3 }); this.setState('recover'); }
        break;
      }
      case 'recover':
        this.walk = 0.4;
        if (h && this.st < 20) this.moveBy(-dx / dist * this.speed() * 0.3, -dz / dist * this.speed() * 0.3);   // scuttle off after a leap
        if (this.st >= d.recover) { this.setState('move'); this.forced = false; this.release(); this.cool = this.cooldown(); }
        break;
      case 'stagger':
        this.tele?.hide();
        if (this.st >= d.stagger) this.setState('move');
        break;
    }
  }
  updatePose() {
    const s = this.state, P = this.pose;
    this.ease('squat', s === 'windup' ? 1 : s === 'recover' ? 0.3 : 0, 0.35);
    P.lean = s === 'leap' ? -0.4 : 0;
    P.bob = Math.abs(Math.sin(this.t * 0.7 + this.phase)) * 0.018 * this.walk;
  }
  applyPose(p) {
    this.bodyG.scale.set(1 + p.squat * 0.2, 1 - p.squat * 0.4, 1 + p.squat * 0.15);
    this.bodyG.rotation.x = p.lean;
    this.bodyG.position.y = p.bob;
    const flip = this.walk > 0.01 ? ((this.t / 3) | 0) % 2 : 0;
    this.legsA.visible = !flip; this.legsB.visible = !!flip;
  }
  onDie() { this.tflash = 1; }
  tickDying() {
    const s = this.st;
    this.mat.userData.flash.value = 1;
    if (s === 3) { vfx.death({ x: this.x, y: 0.25, z: this.z, power: 0.35, colors: this.d.palette }); this.hidden = true; }
    if (s >= 4) this.finish();
  }
}

export const CLASSES = { husk: Husk, wisp: Wisp, brute: Brute, mite: Mite };
