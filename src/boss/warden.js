// The Warden himself (piece `boss`): a jailer-knight three times the hero's height. A combat
// `Hurtable` (so HeroCombat hits him through takeHit), with a small state machine:
//
//   intro -> move <-> attack -> recover (the punish window) -> move ...
//   any state -> transition (phase 1 -> 2 -> 3, he cannot be hurt) ;  -> dying -> dead
//
// Phase 1  the chain: a full-circle SWEEP and a thrown LASH.
// Phase 2  the maul: he wraps the chain round his fist. SLAM (ground shockwave), double slam, LEAP.
// Phase 3  the cage closes and he SUMMONS husks, and mixes everything, faster.
//
// Every attack has a windup that shows a pose change, a body pulse and a floor marker; the marker
// is the hitbox (the ring of a sweep, the disc of a slam, the lane of a lash). The last ~22 ticks
// before it lands the marker is locked, so a dash on reaction always works: the hero's dash is
// invulnerable for 9 ticks. Numbers live in TUNE, in ticks (60 per second) and world units.

import * as THREE from 'three';
import { Hurtable } from '../combat/combat.js';
import { voxelMesh, makeVoxelMaterial, VOXEL as V } from '../render/voxel/index.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { vfx } from '../vfx/index.js';
import { buildEnemyModels } from '../enemies/models.js';
import { buildBossModels } from './models.js';
import { ARENA_R } from './arena.js';

const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _z = new THREE.Vector3(0, 0, 1);

export const TUNE = {
  hp: 640, r: 1.1, scale: 1.32, walk: [1.25, 1.6, 1.85], gap: [72, 56, 44], ideal: [3.6, 3.2, 3.0],
  sweep: { wind: 54, inner: 1.6, outer: 4.3, reach: 3.7, dmg: 1, recover: 88, revs: [1, 1, 2] },
  lash: { wind: 44, lock: 22, speed: 24, w: 0.95, dmg: 1, stuck: 22, recover: 30 },
  slam: { wind: 58, lock: 26, R: 1.6, dmg: 2, stuck: 64, ringSpeed: 3.6, ringDmg: 1 },
  leap: { wind: 46, lockAt: 14, flight: 30, R: 1.75, dmg: 2, kneel: 68, ringSpeed: 3.3 },
  summon: { wind: 80, cap: 3, count: 2 },
  punish: { sweep: 1.7, slam: 1.7, leap: 1.8, lash: 1.35, summon: 1.0 },
  armor: 0.6,           // damage taken while he is not in a punish window
  poise: 110,           // chip damage in 3 s that staggers him
};
const THRESH = [2 / 3, 1 / 3];

export class Warden extends Hurtable {
  constructor(fight, x, z, o = {}) {
    super({ id: 'warden', type: 'warden', x, z, r: TUNE.r, h: 3.7, hp: Math.round(TUNE.hp * (o.hpMul ?? 1)), weight: 999, friction: 0.5 });
    buildBossModels(); buildEnemyModels();
    this.f = fight; this.kind = 'warden'; this.managed = true;
    this.hitY = 1.9; this.debris = ['stone', 'slate', 'mist', 'bone'];
    this.yaw = o.yaw ?? 0; this.pyaw = this.yaw;
    this.phase = 1; this.state = 'intro'; this.st = 0; this.t = 0;
    this.cool = 40; this.a = null; this.queue = []; this.seq = 0;
    this.vulnMul = 1; this.recoverMax = 0; this.recoverName = '';
    this.poise = 0; this.sweepDir = 1;
    this.tflash = 0; this.hitPop = 999; this.shud = 0;
    this.eyeK = 0; this.crackK = 0; this.crackBackK = 0; this.eyeBoost = 0;
    this.override = null;
    this.walk = 0; this.stepPh = 0; this.lastStep = 0;
    this.pose = { legA: 0, legB: 0, armLX: 0.1, armLZ: 0.1, armRX: 0.1, armRZ: 0.1, lean: 0.04, twist: 0, dip: 0, headX: 0.25, headY: 0, kneel: 0, sway: 0, bob: 0, rise: 0 };
    this.ppose = { ...this.pose };
    this.tp = { ...this.pose };
    this.rate = 0.15;
    this.airY = 0; this.pairY = 0;
    this.deadFlag = false; this.gone = false;
    this.ball = { x, y: 0.6, z, px: x, py: 0.6, pz: z, mode: 'hang', chain: 3.4, flash: 0 };
    this.handW = new THREE.Vector3(x, 1.4, z); this.phandW = this.handW.clone();
    this.stars = null;
    this.build();
    this.mat = this.matBody;
    fight.root.add(this.g, this.shadow);
    // he is a solid body for the hero and the husks
    this.body = fight.cw ? fight.cw.addCircle(x, z, TUNE.r * 0.92, 'boss') : null;
  }

  // ---- model ------------------------------------------------------------------------------------
  part(model, parent, mat = this.matBody) { const m = voxelMesh(model); m.material = mat; parent.add(m); return m; }
  build() {
    this.matBody = makeVoxelMaterial(); this.matBall = makeVoxelMaterial(); this.matGlow = makeVoxelMaterial();
    this.g = new THREE.Group(); this.yg = new THREE.Group(); this.g.add(this.yg);
    this.shadow = voxelMesh('enemy.shadow'); this.shadow.scale.set(4, 0.06, 4);
    this.legL = this.part('boss.leg', this.yg); this.legR = this.part('boss.leg', this.yg);
    this.legL.position.set(-3.4 * V, 12 * V, 0); this.legR.position.set(3.4 * V, 12 * V, 0);
    this.bodyG = new THREE.Group(); this.bodyG.position.y = 12 * V; this.yg.add(this.bodyG);
    this.torso = this.part('boss.torso', this.bodyG);
    this.cracks = this.part('boss.cracks', this.bodyG, this.matGlow); this.cracksBack = this.part('boss.cracksBack', this.bodyG, this.matGlow);
    this.cracks.visible = this.cracksBack.visible = false;
    this.headG = new THREE.Group(); this.headG.position.set(0, 13 * V, 0.5 * V); this.bodyG.add(this.headG);
    this.head = this.part('boss.head', this.headG);
    this.eyes = this.part('boss.eyes', this.headG, this.matGlow);
    this.eyes.position.set(0, 6 * V, 5.02 * V); this.eyes.visible = false;
    this.armL = this.part('boss.armL', this.bodyG); this.armR = this.part('boss.armR', this.bodyG);
    this.armL.position.set(-9.2 * V, 11.4 * V, 0); this.armR.position.set(9.2 * V, 11.4 * V, 0);
    this.handA = new THREE.Object3D(); this.handA.position.set(0, -13 * V, 1 * V); this.armR.add(this.handA);
    this.keys = this.part('boss.keys', this.bodyG); this.keys.position.set(-6.2 * V, 3 * V, 5.3 * V);
    this.tabard = this.part('boss.tabard', this.bodyG); this.tabard.position.set(0, 2.2 * V, 5.0 * V);
    // a cool fill light that rides with him, so the armour reads against the floor
    this.fillLight = look.lights ? look.torch(this.yg, { y: 5.2, z: 2.2, color: 'sky', intensity: 0.85, radius: 8.5, flicker: 0.1, haze: 0 }) : null;
    // light in his eyes
    this.eyeLight = look.lights ? look.torch(this.headG, { y: 0.9, z: 0.9, color: 'ember', intensity: 0, radius: 3.2, flicker: 0.4, haze: 0 }) : null;
    // the chain: interlocked links, and the ball
    this.chainG = new THREE.Group(); this.f.root.add(this.chainG);
    this.links = [];
    for (let i = 0; i < 20; i++) { const m = voxelMesh(i & 1 ? 'boss.linkB' : 'boss.linkA'); m.visible = false; this.chainG.add(m); this.links.push(m); }
    this.ballM = voxelMesh('boss.ball'); this.ballM.material = this.matBall; this.ballM.scale.setScalar(1.05);
    this.chainG.add(this.ballM); this.ballM.visible = false;
    // stars for the punish window
    this.stars = [0, 1, 2].map(() => { const m = this.part('enemy.star', this.g, this.matGlow); m.visible = false; m.scale.setScalar(1.5); return m; });
    // eye and crack pulses use the emissive parts; hide until called on
  }

  // ---- convenience ------------------------------------------------------------------------------------
  get hero() { const h = this.f.hero; return h && !h.dead ? h : null; }
  get vulnerable() { return ['move', 'attack', 'recover'].includes(this.state); }
  get punishing() { return this.state === 'recover' && this.vulnMul > 1.05; }
  angTo(x, z) { return Math.atan2(x - this.x, z - this.z); }
  faceRate(ang, rate) { this.yaw = wrap(this.yaw + clamp(wrap(ang - this.yaw), -rate, rate)); }
  setState(s) { this.state = s; this.st = 0; }
  emit(name, extra = {}) { events.emit(`boss:${name}`, { boss: this, x: this.x, z: this.z, phase: this.phase, ...extra }); }
  keep(rad = TUNE.r) {                       // stay inside the arena
    const d = Math.hypot(this.x, this.z), lim = ARENA_R - rad * 0.9;
    if (d > lim) { this.x *= lim / d; this.z *= lim / d; }
  }
  moveBy(dx, dz) { this.x += dx; this.z += dz; this.keep(); }

  // ---- hits ------------------------------------------------------------------------------------------
  takeHit(hit) {
    if (this.dead || this.state === 'dying') return false;
    if (!this.vulnerable) {                                              // intro, transition: a clang and nothing else
      this.f.clang(this, hit, 'ward');
      return false;
    }
    const armored = !this.punishing;
    const mul = armored ? TUNE.armor : this.vulnMul;
    let dmg = Math.max(1, Math.round(hit.dmg * mul));
    hit.dmg = dmg;
    // hold the phase line: he cannot be pushed past a threshold in one hit
    const line = this.phase < 3 ? this.maxHp * THRESH[this.phase - 1] : 0;
    const wouldDie = this.hp - dmg <= 0 && this.phase === 3;
    const weight = this.weight;
    this.weight = 999;
    const ok = super.takeHit({ ...hit, knock: 0, lift: 0 });
    this.weight = weight;
    if (!ok) return false;
    this.dead = false;
    this.hitPop = 0; this.shud = 8;
    this.tflash = 0.3;
    this.f.onBossHit(this, hit, armored);
    this.poise += dmg;
    if (this.phase < 3 && this.hp <= line) {
      this.hp = Math.round(line);
      this.beginTransition(this.phase + 1);
    } else if (wouldDie || this.hp <= 0) {
      this.hp = 0; this.dead = true;
      this.f.beginDeath(hit);
    } else if (this.poise > TUNE.poise && this.state === 'move') {
      this.beginStagger();
    }
    events.emit('boss:hurt', { boss: this, hp: this.hp, dmg, armored, x: this.x, z: this.z });
    return true;
  }
  beginStagger() {
    this.poise = 0; this.cancelAttack();
    this.vulnMul = 1.6; this.recoverMax = 66; this.recoverName = 'stagger';
    this.setState('recover');
    this.f.say?.('STAGGERED');
    vfx.hit({ x: this.x, y: 3.1, z: this.z, dx: 0, dz: 1, power: 1.4, style: 'gold' });
    feedback.shake(3, 160);
    this.emit('stagger');
  }
  kill() { if (this.dead) return false; this.hp = 0; this.dead = true; this.f.beginDeath({ dx: 0, dz: 1 }); return true; }

  // ---- per tick ------------------------------------------------------------------------------------------
  tick() {
    this.px = this.x; this.pz = this.z; this.pyaw = this.yaw; this.pairY = this.airY;
    Object.assign(this.ppose, this.pose);
    this.ball.px = this.ball.x; this.ball.py = this.ball.y; this.ball.pz = this.ball.z;
    this.t++; this.st++; this.hitPop++;
    if (this.tflash > 0) this.tflash = Math.max(0, this.tflash - 0.08);
    if (this.shud > 0) this.shud--;
    if (this.poise > 0) this.poise -= 0.5;
    this.psquash = this.squash; this.squash *= 0.72; if (this.squash < 0.01) this.squash = 0;
    if (this.flashT > 0) this.flashT--;
    this.tp = this.defaultPose();
    switch (this.state) {
      case 'intro': case 'dying': case 'dead': break;
      case 'move': this.tickMove(); break;
      case 'attack': this.tickAttack(); break;
      case 'recover': this.tickRecover(); break;
      case 'transition': this.tickTransition(); break;
    }
    this.tickPose();
    if (this.body) { this.body.x = this.x; this.body.z = this.z; this.body.r = this.airY > 0.4 ? 0.01 : TUNE.r * 0.92; }
    // ember life: he smoulders once his armour cracks
    if (this.phase >= 2 && this.t % (this.phase === 3 ? 9 : 16) === 0 && this.state !== 'dead') {
      const a = this.yaw;
      vfx.embers({ x: this.x + Math.sin(a) * 0.5 + (Math.random() - 0.5) * 0.8, y: 2.0 + Math.random() * 0.8, z: this.z + Math.cos(a) * 0.5 + (Math.random() - 0.5) * 0.4, n: 1 });
    }
  }

  tickMove() {
    const h = this.hero, ph = this.phase - 1;
    this.vulnMul = 1;
    if (!h) { this.walk *= 0.9; return; }
    const dx = h.x - this.x, dz = h.z - this.z, dist = Math.hypot(dx, dz) || 1;
    this.faceRate(this.angTo(h.x, h.z), 0.05);
    if (this.queue.length === 0) this.queue = this.nextSet();
    const next = this.queue[0];
    const ideal = TUNE.ideal[ph];
    let want = 0;
    if (dist > ideal + 0.5) want = 1; else if (dist < ideal - 1.1) want = -0.35;
    if (next === 'lash' && dist < 2.4) want = -0.6;
    if (next === 'slam' || next === 'slam2') { if (dist > 3.0) want = 1.2; }
    const sp = TUNE.walk[ph] / 60 * want;
    this.moveBy(Math.sin(this.yaw) * sp, Math.cos(this.yaw) * sp);
    this.walk += (Math.abs(want) - this.walk) * 0.12;
    this.cool--;
    const ok = next === 'slam' || next === 'slam2' ? dist < 3.6 : next === 'sweep' ? dist < 5.6 : next === 'lash' ? dist > 2.0 : true;
    if (this.cool <= 0 && (ok || this.cool < -170)) { this.queue.shift(); this.startAttack(next); }
  }

  /** The order of attacks: a short list per phase, so a fight has a rhythm the player can learn. */
  nextSet() {
    const ph = this.phase;
    if (this.forced?.length) return this.forced.splice(0);
    if (ph === 1) return this.seq++ % 2 === 0 ? ['sweep', 'lash', 'lash', 'sweep', 'lash'] : ['lash', 'sweep', 'lash', 'lash', 'sweep'];
    if (ph === 2) return ['slam', 'leap', 'slam2', 'slam', 'leap'];
    const husks = this.f.huskCount();
    return husks < 2 ? ['summon', 'sweep', 'slam2', 'leap', 'lash', 'sweep'] : ['sweep', 'slam2', 'leap', 'lash', 'slam'];
  }

  startAttack(name) {
    this.a = { name, t: 0 };
    this.setState('attack');
    this.vulnMul = 1;
  }
  cancelAttack() { this.a = null; this.f.zone.shapes.length = 0; this.ball.mode = 'hang'; this.override = null; }
  tickAttack() {
    const a = this.a; a.t++;
    const fn = this['atk_' + a.name];
    if (fn.call(this, a)) this.endAttack();
  }
  endAttack() {
    const name = this.a.name, R = this.a.recover ?? 30, mul = TUNE.punish[name.replace('2', '')] ?? 1;
    this.a = null;
    this.vulnMul = mul; this.recoverMax = R; this.recoverName = name;
    this.setState('recover');
    this.cool = Math.round(TUNE.gap[this.phase - 1] * (this.f.knobs?.aggression ? 1 / this.f.knobs.aggression : 1));
  }
  tickRecover() {
    this.walk *= 0.85;
    const k = this.st / this.recoverMax;
    if (this.punishing && this.st === 6) this.emit('punish', { attack: this.recoverName });
    if (this.punishing && this.st % 7 === 0 && this.st < this.recoverMax - 8) vfx.hit({ x: this.x + (Math.random() - 0.5) * 0.8, y: 3.4, z: this.z + (Math.random() - 0.5) * 0.4, dx: 0, dz: 0, power: 0.4, style: 'gold' });
    if (this.st >= this.recoverMax) { this.setState('move'); this.ball.mode = 'hang'; this.vulnMul = 1; }
  }

  // ==============================================================================================
  //  ATTACKS
  // ==============================================================================================

  // ---- sweep: a full circle of chain. Windup: he pulls the ball out to the side, a red ring fills,
  // a bright wedge marks where it starts. Slip inside the ring, run outside it, or dash through.
  atk_sweep(a) {
    const T = TUNE.sweep, h = this.hero, B = this.ball, W = T.wind;
    const zone = this.f.zone;
    if (a.t === 1) {
      a.dir = this.sweepDir = -this.sweepDir; a.rev = T.revs[this.phase - 1];
      const ha = h ? this.angTo(h.x, h.z) : this.yaw;
      a.th0 = ha - a.dir * 2.0; a.trav = 0; a.w = 0; a.stage = 'wind';
      a.start = { x: B.x, y: B.y, z: B.z }; B.mode = 'free';
      this.emit('windup', { attack: 'sweep' });
    }
    const orbit = (r, ang, y) => ({ x: this.x + Math.sin(ang) * r, y, z: this.z + Math.cos(ang) * r });
    if (a.stage === 'wind') {
      const k = a.t / W, e = sstep(k);
      const angW = a.th0 - a.dir * 0.6 * e;
      this.faceRate(Math.PI / 2 - angW, 0.16);
      const o = orbit(lerp(1.6, T.reach, e), angW, 0.4 + 0.3 * e);
      const bl = sstep(a.t / 26);
      B.x = lerp(a.start.x, o.x, bl); B.y = lerp(a.start.y, o.y, bl); B.z = lerp(a.start.z, o.z, bl);
      this.tp.armRZ = 1.45; this.tp.armRX = 0.25; this.tp.armLX = -0.5; this.tp.armLZ = 0.5; this.tp.lean = -0.16 * e; this.tp.twist = 0.3 * a.dir * e; this.tp.headX = 0.1;
      this.rate = 0.14;
      this.tflash = Math.max(this.tflash, a.t > W - 16 ? ((a.t >> 1) & 1 ? 0.9 : 0.2) : 0.28 * k);
      B.flash = this.tflash;
      zone.add({ kind: 'ring', x: this.x, z: this.z, r0: T.inner, r1: T.outer, p: k, st: a.t, mark: a.th0, markW: 0.2, firing: false });
      if (a.t === W) { a.stage = 'spin'; a.ang = a.th0; this.emit('attack', { attack: 'sweepGo' }); this.tflash = 0; B.flash = 0; feedback.shake(1.5, 120); }
      return false;
    }
    if (a.stage === 'spin') {
      a.w++;
      const sp = 0.05 + 0.088 * Math.min(1, a.w / 20);
      const om = sp * a.dir;
      const prev = a.ang;
      a.ang += om; a.trav += sp;
      B.mode = 'free';
      const o = orbit(T.reach, a.ang, 0.62 + Math.sin(a.w * 0.5) * 0.02);
      B.x = o.x; B.y = o.y; B.z = o.z;
      this.yaw = Math.PI / 2 - a.ang;
      this.tp.armRZ = 1.5; this.tp.armRX = 0.1; this.tp.armLZ = 0.7; this.tp.armLX = -0.4; this.tp.lean = 0.14; this.tp.twist = 0; this.rate = 0.4;
      zone.add({ kind: 'ring', x: this.x, z: this.z, r0: T.inner, r1: T.outer, p: 1, st: a.t, mark: a.ang, markW: 0.28, firing: true });
      // it scrapes the floor: dust and sparks trail behind
      if (a.w % 2 === 0) vfx.dust({ x: o.x, z: o.z, dx: Math.cos(a.ang) * a.dir, dz: -Math.sin(a.ang) * a.dir, n: 2, size: 4, speed: 1.1 });
      if (a.w % 3 === 0) vfx.hit({ x: o.x, y: 0.15, z: o.z, dx: Math.cos(a.ang) * a.dir, dz: -Math.sin(a.ang) * a.dir, power: 0.35, style: 'hit' });
      if (a.w === 1) { vfx.shockwave({ x: this.x, z: this.z, radius: 2.4, style: 'dust' }); feedback.shake(2.5, 500); }
      if (a.w % 20 === 5) this.emit('sweepPass');
      if (h) {
        const dx = h.x - this.x, dz = h.z - this.z, rho = Math.hypot(dx, dz);
        if (rho >= T.inner - 0.05 && rho <= T.outer) {
          const d = wrap(Math.atan2(dx, dz) - a.ang) * a.dir;        // > 0: the hero is ahead of the ball
          const hw = 0.55 / Math.max(rho, 1);
          if (d <= hw && d >= -(sp + hw)) this.f.hurtHero(T.dmg, { x: B.x, z: B.z }, 'sweep');
        }
      }
      if (a.trav >= a.rev * TAU) { a.stage = 'decel'; a.w = 0; a.om = om; }
      return false;
    }
    // decel: the ball slows, drops, drags; he staggers round dizzy
    a.w++;
    a.ang += a.om * Math.pow(0.86, a.w);
    const k = sstep(a.w / 18);
    const o = orbit(lerp(T.reach, 2.5, k), a.ang, lerp(0.62, 0.5, k));
    B.x = o.x; B.y = o.y; B.z = o.z;
    this.yaw = Math.PI / 2 - a.ang;
    this.tp.armRZ = lerp(1.5, 0.5, k); this.tp.lean = lerp(0.14, 0.4, k); this.rate = 0.2;
    if (a.w === 4) { vfx.dust({ x: this.x, z: this.z, n: 10, size: 5, speed: 1 }); this.emit('sweepEnd'); }
    if (a.w >= 18) { a.recover = T.recover; B.mode = 'drag'; B.dragA = a.ang; return true; }
    return false;
  }

  // ---- lash: the ball is thrown along a red lane, hits the far end, then he reels it in. -----------------
  atk_lash(a) {
    const T = TUNE.lash, h = this.hero, B = this.ball, zone = this.f.zone;
    if (a.t === 1) { a.n = this.phase === 3 ? 2 : 1; a.i = 0; a.stage = 'wind'; a.st = 0; a.start = { x: B.x, y: B.y, z: B.z }; B.mode = 'free'; a.dir = { x: Math.sin(this.yaw), z: Math.cos(this.yaw) }; this.emit('windup', { attack: 'lash' }); }
    a.st++;
    const W = a.i === 0 ? T.wind : 32;
    if (a.stage === 'wind') {
      const k = a.st / W, e = sstep(k);
      if (a.st < W - T.lock && h) { const d = Math.hypot(h.x - this.x, h.z - this.z) || 1; a.dir = { x: (h.x - this.x) / d, z: (h.z - this.z) / d }; }
      this.faceRate(Math.atan2(a.dir.x, a.dir.z), 0.18);
      // the far edge: where the lane meets the wall
      const bx = this.x, bz = this.z, dd = a.dir.x * bx + a.dir.z * bz;
      const disc = dd * dd - (bx * bx + bz * bz - (ARENA_R - 0.35) ** 2);
      a.len = Math.min(7.2, -dd + Math.sqrt(Math.max(0, disc)));
      const behind = { x: this.x - a.dir.x * 1.2 + a.dir.z * 1.2, y: 1.2 + 0.5 * e, z: this.z - a.dir.z * 1.2 - a.dir.x * 1.2 };
      const bl = sstep(a.st / 22);
      B.x = lerp(a.start.x, behind.x, bl); B.y = lerp(a.start.y, behind.y, bl); B.z = lerp(a.start.z, behind.z, bl);
      this.tp.armRX = 1.6 * e + 0.1; this.tp.armRZ = 0.5; this.tp.lean = -0.3 * e; this.tp.twist = -0.4 * e; this.tp.armLX = -0.9; this.tp.headX = 0.05; this.rate = 0.14;
      this.tflash = Math.max(this.tflash, a.st > W - T.lock ? ((a.st >> 1) & 1 ? 0.9 : 0.2) : 0.3 * k); B.flash = this.tflash;
      zone.add({ kind: 'lane', x: this.x, z: this.z, dx: a.dir.x, dz: a.dir.z, len: a.len, w: T.w, p: k, st: a.st, firing: false });
      if (a.st >= W) { a.stage = 'fly'; a.s = 1.2; a.st = 0; a.hit = false; this.emit('attack', { attack: 'lash' }); this.tflash = 0; B.flash = 0; a.p0 = { x: this.x + a.dir.x * 0.3, z: this.z + a.dir.z * 0.3 }; }
      return false;
    }
    if (a.stage === 'fly') {
      a.s += T.speed / 60;
      const s = Math.min(a.s, a.len);
      B.x = a.p0.x + a.dir.x * s; B.z = a.p0.z + a.dir.z * s; B.y = lerp(1.2, 0.6, Math.min(1, s / 2));
      this.tp.armRX = lerp(1.6, -1.4, sstep(a.st / 5)); this.tp.lean = 0.4; this.tp.twist = 0.25; this.rate = 0.5;
      zone.add({ kind: 'lane', x: this.x, z: this.z, dx: a.dir.x, dz: a.dir.z, len: a.len, w: T.w, p: 1, st: a.st, firing: true });
      if (h && !a.hit && Math.hypot(h.x - B.x, h.z - B.z) < 0.62 + 0.3) { const r = this.f.hurtHero(T.dmg, { x: B.x - a.dir.x, z: B.z - a.dir.z }, 'lash'); if (r && (r.ok || r.reason === 'iframes')) a.hit = true; }
      if (a.st % 2 === 0) vfx.hit({ x: B.x, y: 0.5, z: B.z, dx: -a.dir.x, dz: -a.dir.z, power: 0.3, style: 'ember' });
      if (a.s >= a.len) { a.stage = 'stuck'; a.st = 0; this.lashImpact(B); }
      return false;
    }
    if (a.stage === 'stuck') {
      B.y = 0.5;
      this.tp.armRX = -1.0; this.tp.lean = 0.45; this.rate = 0.3;
      if (a.st >= (a.i + 1 < a.n ? 12 : T.stuck)) {
        if (a.i + 1 < a.n) {                                    // again, at where you are now
          a.i++; a.stage = 'wind'; a.st = 0; a.start = { x: B.x, y: B.y, z: B.z };
          return false;
        }
        a.stage = 'reel'; a.st = 0; a.sR = Math.hypot(B.x - this.x, B.z - this.z);
      }
      return false;
    }
    // reel: the ball drags back across the floor, and he leans into it
    a.sR = Math.max(1.4, a.sR - (0.06 + a.st * 0.009));
    const ang = Math.atan2(B.x - this.x, B.z - this.z);
    B.x = this.x + Math.sin(ang) * a.sR; B.z = this.z + Math.cos(ang) * a.sR; B.y = 0.5;
    this.tp.armRX = lerp(-1.0, 0.2, sstep(a.st / 30)); this.tp.lean = 0.25; this.rate = 0.15;
    if (a.st % 3 === 0) vfx.dust({ x: B.x, z: B.z, dx: Math.sin(ang), dz: Math.cos(ang), n: 2, size: 4, speed: 0.8 });
    if (a.sR <= 1.5 || a.st > 60) { a.recover = T.recover; B.mode = 'hang'; return true; }
    return false;
  }
  lashImpact(B) {
    vfx.hit({ x: B.x, y: 0.6, z: B.z, dx: 0, dz: 1, power: 1.5, style: 'hit' });
    vfx.dust({ x: B.x, z: B.z, n: 14, size: 6, speed: 1.3 });
    vfx.shockwave({ x: B.x, z: B.z, radius: 1.7, style: 'dust' });
    vfx.flash({ x: B.x, y: 0.5, z: B.z, color: 'flame', radius: 2.2, ms: 150 });
    feedback.shake(3.5, 200);
    this.emit('lashHit', { x: B.x, z: B.z });
  }

  // ---- slam: the maul comes down where you stand. Then a shockwave ring races out from the crater:
  // dash through it, or be gone before it arrives. ---------------------------------------------------
  atk_slam(a) { return this.slamLike(a, 1); }
  atk_slam2(a) { return this.slamLike(a, 2); }
  slamLike(a, count) {
    const T = TUNE.slam, h = this.hero, B = this.ball, zone = this.f.zone;
    if (a.t === 1) { a.count = count; a.k = 0; a.stage = 'wind'; a.st = 0; a.T = h ? this.clampReach(h.x, h.z) : { x: this.x, z: this.z + 2 }; B.mode = 'mace'; this.emit('windup', { attack: 'slam' }); }
    a.st++;
    const W = a.k === 0 ? T.wind : 36;
    if (a.stage === 'wind') {
      const k = a.st / W, e = sstep(k);
      if (a.st < W - T.lock && h) a.T = this.clampReach(h.x, h.z);
      this.faceRate(this.angTo(a.T.x, a.T.z), 0.1);
      this.tp.armRX = lerp(0.1, -2.95, sstep(a.st / 26)); this.tp.armLX = lerp(0.1, -2.7, sstep(a.st / 26)); this.tp.armRZ = 0.1; this.tp.armLZ = 0.1;
      this.tp.lean = -0.3 * e; this.tp.headX = -0.15; this.tp.dip = 0.06 * e; this.rate = 0.16;
      this.tflash = Math.max(this.tflash, a.st > W - T.lock ? ((a.st >> 1) & 1 ? 0.9 : 0.2) : 0.3 * k); B.flash = this.tflash;
      zone.add({ kind: 'disc', x: a.T.x, z: a.T.z, R: T.R, p: k, st: a.st, firing: false });
      if (a.st >= W) { a.stage = 'strike'; a.st = 0; this.emit('attack', { attack: 'slam' }); }
      return false;
    }
    if (a.stage === 'strike') {
      const k = a.st / 7;
      B.mode = 'free';
      const from = this.handWorldGuess();
      B.x = lerp(from.x, a.T.x, sstep(k)); B.z = lerp(from.z, a.T.z, sstep(k)); B.y = lerp(from.y, 0.62, k * k);
      this.tp.armRX = lerp(-2.95, -0.2, k); this.tp.armLX = lerp(-2.7, -0.2, k); this.tp.lean = lerp(-0.3, 0.75, k); this.tp.headX = 0.4; this.tp.dip = -0.1 * k; this.rate = 0.6;
      this.tflash = 0; B.flash = 0;
      zone.add({ kind: 'disc', x: a.T.x, z: a.T.z, R: T.R, p: 1, st: a.st, firing: true });
      if (a.st >= 7) { this.slamImpact(a); a.stage = 'stuck'; a.st = 0; }
      return false;
    }
    // stuck: the ball is in the floor. Between slams a beat; after the last, he heaves it out (the punish window)
    B.x = a.T.x; B.z = a.T.z; B.y = 0.5; B.mode = 'free';
    const last = a.k + 1 >= a.count;
    this.tp.armRX = -0.3; this.tp.armLX = -0.3; this.tp.lean = last ? 0.7 - 0.12 * Math.sin(a.st * 0.45) : 0.7; this.tp.dip = -0.1; this.rate = 0.25;
    if (!last && a.st >= 26) { a.k++; a.stage = 'wind'; a.st = 0; a.T = h ? this.clampReach(h.x, h.z) : a.T; return false; }
    if (last && a.st >= 2) { a.recover = T.stuck; B.mode = 'stuck'; B.stuckAt = { x: a.T.x, z: a.T.z }; return true; }
    return false;
  }
  clampReach(x, z) {
    const dx = x - this.x, dz = z - this.z, d = Math.hypot(dx, dz) || 1, m = Math.min(d, 3.9);
    return { x: this.x + dx / d * m, z: this.z + dz / d * m };
  }
  handWorldGuess() {
    return { x: this.handW.x, y: Math.max(0.6, this.handW.y), z: this.handW.z };
  }
  slamImpact(a) {
    const T = TUNE.slam, h = this.hero, P = a.T;
    if (h && Math.hypot(h.x - P.x, h.z - P.z) < T.R + 0.3) this.f.hurtHero(T.dmg, { x: P.x, z: P.z }, 'slam');
    vfx.hit({ x: P.x, y: 0.4, z: P.z, dx: 0, dz: 1, power: 2.4, style: 'hit' });
    vfx.dust({ x: P.x, z: P.z, n: 22, size: 7, speed: 1.6 });
    vfx.embers({ x: P.x, y: 0.4, z: P.z, n: 22 });
    vfx.shockwave({ x: P.x, z: P.z, radius: 2.6, style: 'dust' });
    vfx.flash({ x: P.x, y: 0.5, z: P.z, color: 'flame', radius: 3.6, ms: 260, screen: 0.12 });
    look.flash(P.x, 0.6, P.z, { color: 'flame', ms: 220, intensity: 3, radius: 5 });
    feedback.hitstop(90); feedback.shake(6.5, 320); feedback.kick(0, 0.7, 3);
    this.f.floorCrack(P.x, P.z, 1.5);
    this.f.ring({ x: P.x, z: P.z, r0: T.R - 0.1, speed: T.ringSpeed, dmg: T.ringDmg, tag: 'slam' });
    this.emit('slam', { x: P.x, z: P.z });
  }

  // ---- leap: he crouches, jumps, and lands on the red disc with a shockwave. -----------------------------
  atk_leap(a) {
    const T = TUNE.leap, h = this.hero, B = this.ball, zone = this.f.zone;
    if (a.t === 1) { a.stage = 'wind'; a.st = 0; a.T = h ? { x: h.x, z: h.z } : { x: this.x, z: this.z + 3 }; a.from = { x: this.x, z: this.z }; B.mode = 'mace'; this.emit('windup', { attack: 'leap' }); }
    a.st++;
    if (a.stage === 'wind') {
      const k = a.st / T.wind, e = sstep(k);
      if (a.st < T.wind - T.lockAt && h) { a.T = { x: h.x, z: h.z }; }
      const c = Math.hypot(a.T.x, a.T.z), lim = ARENA_R - 0.9; if (c > lim) { a.T.x *= lim / c; a.T.z *= lim / c; }
      this.faceRate(this.angTo(a.T.x, a.T.z), 0.14);
      this.tp.dip = -0.5 * e; this.tp.lean = 0.35 * e; this.tp.armRX = lerp(0.1, 0.9, e); this.tp.armLX = lerp(0.1, 0.9, e); this.tp.headX = 0.3; this.tp.legA = -0.7 * e; this.tp.legB = 0.7 * e; this.rate = 0.18;
      this.tflash = Math.max(this.tflash, a.st > T.wind - 18 ? ((a.st >> 1) & 1 ? 0.9 : 0.2) : 0.25 * k); this.ball.flash = this.tflash;
      zone.add({ kind: 'disc', x: a.T.x, z: a.T.z, R: T.R, p: k, st: a.st, firing: false });
      if (a.st >= T.wind) { a.stage = 'air'; a.st = 0; this.emit('attack', { attack: 'leap' }); vfx.dust({ x: this.x, z: this.z, n: 14, size: 6, speed: 1.3 }); vfx.shockwave({ x: this.x, z: this.z, radius: 1.8, style: 'dust' }); feedback.shake(3, 140); this.tflash = 0; this.ball.flash = 0; }
      return false;
    }
    if (a.stage === 'air') {
      const k = a.st / T.flight, e = sstep(k);
      this.x = lerp(a.from.x, a.T.x, e); this.z = lerp(a.from.z, a.T.z, e);
      this.airY = 3.6 * 4 * k * (1 - k);
      this.faceRate(this.angTo(a.T.x, a.T.z), 0.2);
      this.tp.dip = lerp(-0.72, 0.05, Math.min(1, k * 3)); this.tp.legA = 0.4; this.tp.legB = -0.3; this.tp.armRX = -2.6; this.tp.armLX = -2.4; this.tp.lean = 0.1 + 0.5 * k; this.rate = 0.3;
      zone.add({ kind: 'disc', x: a.T.x, z: a.T.z, R: T.R, p: 1, st: a.st, firing: k > 0.85 });
      if (a.st >= T.flight) {
        this.airY = 0; this.x = a.T.x; this.z = a.T.z; this.keep();
        if (h && Math.hypot(h.x - this.x, h.z - this.z) < T.R + 0.3) this.f.hurtHero(T.dmg, { x: this.x, z: this.z }, 'leap');
        const P = { x: this.x, z: this.z };
        vfx.hit({ x: P.x, y: 0.3, z: P.z, dx: 0, dz: 1, power: 2.6, style: 'hit' });
        vfx.dust({ x: P.x, z: P.z, n: 26, size: 7, speed: 1.8 });
        vfx.embers({ x: P.x, y: 0.3, z: P.z, n: 20 });
        vfx.shockwave({ x: P.x, z: P.z, radius: 3, style: 'dust' });
        look.flash(P.x, 0.6, P.z, { color: 'flame', ms: 240, intensity: 3.2, radius: 5.5 });
        feedback.hitstop(100); feedback.shake(8, 380); feedback.kick(0, 1, 3.5);
        this.f.floorCrack(P.x, P.z, 1.9);
        this.f.ring({ x: P.x, z: P.z, r0: T.R - 0.2, speed: T.ringSpeed, dmg: 1, tag: 'leap' });
        this.emit('land', { x: P.x, z: P.z });
        this.squash = 0.9;
        a.stage = 'kneel'; a.st = 0;
      }
      return false;
    }
    // kneel: he is down on one knee, the maul at his side. Hit him.
    this.tp.dip = -0.72; this.tp.lean = 0.42; this.tp.legA = -1.1; this.tp.legB = 1.0; this.tp.armRX = -0.4; this.tp.armLX = 0.4; this.tp.headX = 0.5; this.rate = 0.25;
    B.mode = 'free'; { const hw = this.handWorldGuess(); B.x = hw.x; B.y = 0.55; B.z = hw.z; }
    if (a.st >= 2) { a.recover = T.kneel; this.kneeling = true; return true; }
    return false;
  }

  // ---- summon: he plants the maul and calls his jailed dead up through the floor. -------------------------
  atk_summon(a) {
    const T = TUNE.summon, h = this.hero, zone = this.f.zone;
    if (a.t === 1) { a.spots = null; this.ball.mode = 'mace'; this.emit('windup', { attack: 'summon' }); this.emit('roar', { big: false }); }
    const k = a.t / T.wind;
    this.tp.armRX = -2.9; this.tp.armLX = -2.9; this.tp.armRZ = 0.5; this.tp.armLZ = 0.5; this.tp.headX = -0.6; this.tp.lean = -0.25; this.tp.dip = 0.04 + Math.sin(a.t * 0.4) * 0.01; this.rate = 0.12;
    this.tflash = Math.max(this.tflash, 0.35 + 0.3 * Math.sin(a.t * 0.35)); this.ball.flash = this.tflash;
    zone.add({ kind: 'dots', x: this.x, z: this.z, R: 1.5 * Math.min(1, a.t / 14) });
    if (a.t % 4 === 0) vfx.embers({ x: this.x + (Math.random() - 0.5) * 1.6, y: 0.1, z: this.z + (Math.random() - 0.5) * 1.2, n: 1 });
    if (a.t === 12) {
      a.spots = [];
      const n = Math.min(T.count, Math.max(0, T.cap - this.f.huskCount()));
      let tries = 0;
      while (a.spots.length < n && tries++ < 60) {
        const ang = Math.random() * TAU, r = 2.4 + Math.random() * 2.6, x = Math.sin(ang) * r, z = Math.cos(ang) * r;
        if (Math.hypot(x, z) > ARENA_R - 0.9) continue;
        if (Math.hypot(x - this.x, z - this.z) < 2.0) continue;
        if (h && Math.hypot(x - h.x, z - h.z) < 2.2) continue;
        if (a.spots.some((s) => Math.hypot(s.x - x, s.z - z) < 2.3)) continue;
        a.spots.push({ x, z });
      }
    }
    if (a.spots && a.t < 40) for (const s of a.spots) zone.add({ kind: 'dots', x: s.x, z: s.z, R: 0.7 * sstep((a.t - 12) / 10) });
    if (a.t === 40 && a.spots) {
      for (const s of a.spots) this.f.spawnHusk(s.x, s.z);
      feedback.shake(3, 200); vfx.shockwave({ x: this.x, z: this.z, radius: 3.2, style: 'ember' });
      look.flash(this.x, 1.5, this.z, { color: 'ember', ms: 260, intensity: 2.6, radius: 6 });
      this.emit('summon', { n: a.spots.length });
    }
    if (a.t >= T.wind) { a.recover = 34; return true; }
    return false;
  }

  // ==============================================================================================
  //  PHASE TRANSITIONS: events, not stat changes.
  // ==============================================================================================
  beginTransition(to) {
    this.cancelAttack(); this.queue = [];
    this.f.rings.clear();
    this.trans = { to, t: 0 };
    this.vulnMul = 1;
    this.setState('transition');
    this.emit('phase', { to });
  }
  tickTransition() {
    const tr = this.trans, B = this.ball, to = tr.to; tr.t++;
    const t = tr.t;
    const first = to === 2;
    this.f.zone.shapes.length = 0;
    if (t === 1) {
      feedback.hitstop(140); feedback.flash('white', 180, 0.55); feedback.shake(5, 300);
      this.eyeBoost = 1; B.mode = 'free'; { const hw = this.handWorldGuess(); B.x = hw.x; B.y = 0.6; B.z = hw.z; }
      this.f.setSlow?.(0.35, 50);
    }
    // 1..50 staggered back, down on a knee; cracks split open
    if (t <= 56) {
      const k = sstep(t / 24);
      this.tp.dip = -0.72 * k; this.tp.lean = 0.5 * k; this.tp.legA = -1.1 * k; this.tp.legB = 1.0 * k; this.tp.headX = 0.7; this.tp.armRX = 0.3; this.tp.armLX = 0.3; this.rate = 0.2;
      if (t === 6) { this.crackFlash = 1; this.crackBackK = 1; }
      if (t % 5 === 0) { vfx.embers({ x: this.x + Math.sin(this.yaw) * 0.4, y: 2.2, z: this.z + Math.cos(this.yaw) * 0.4, n: 6 }); }
      if (t === 10 || t === 30) { vfx.shockwave({ x: this.x, z: this.z, radius: 2.4 + t * 0.03, style: 'ember' }); look.flash(this.x, 2.2, this.z, { color: 'ember', ms: 300, intensity: 3.2, radius: 7 }); feedback.shake(3.5, 240); this.emit('crack'); }
      if (!first) this.transCage(t);
    }
    // 56..100 he rises; the chain is reeled to his fist (phase 2) / the cage crashes shut (phase 3)
    else if (t <= 100) {
      const k = sstep((t - 56) / 30);
      this.tp.dip = -0.72 * (1 - k); this.tp.lean = 0.5 * (1 - k); this.tp.legA = -1.1 * (1 - k); this.tp.legB = 1.0 * (1 - k); this.tp.headX = lerp(0.7, -0.2, k);
      this.tp.armRX = lerp(0.3, -0.9, k); this.tp.armLX = lerp(0.3, -0.9, k); this.rate = 0.14;
      if (first && t % 4 === 0) { this.emit('reel'); vfx.hit({ x: this.handW.x, y: this.handW.y, z: this.handW.z, dx: 0, dz: 0, power: 0.5, style: 'hit' }); }
      if (!first) this.transCage(t);
    }
    // 100..150 the roar: arms wide, head back, a ring of fire that throws you back
    else if (t <= 150) {
      const k = sstep((t - 100) / 8);
      this.tp.headX = -0.75 * k; this.tp.armRZ = 1.2 * k; this.tp.armLZ = 1.2 * k; this.tp.armRX = -0.4 * (1 - k); this.tp.armLX = -0.4 * (1 - k); this.tp.lean = -0.3 * k; this.rate = 0.3;
      if (t === 100) {
        this.f.roar(this, to);
        this.eyeBoost = 2;
      }
      if (t % 6 === 0 && t < 135) vfx.embers({ x: this.x, y: 3.4, z: this.z, n: 6 });
    } else {
      this.phase = to; this.poise = 0; this.cool = 30; this.queue = []; this.eyeBoost = 0;
      B.mode = 'hang'; this.trans = null; this.setState('move');
      this.emit('phaseStart', { to });
    }
  }
  transCage(t) {
    if (t === 22) { this.f.arena.raiseCage(); this.emit('cage'); }
    if (t === 60) this.f.arena.ignite(0, 5);
    if (t === 34) { feedback.shake(8, 500); feedback.hitstop(60); }
  }

  // ---- poses ---------------------------------------------------------------------------------------------
  defaultPose() {
    const t = this.t;
    this.rate = 0.15;
    return { legA: 0, legB: 0, armLX: 0.12 + Math.sin(t * 0.045 + 1) * 0.03, armLZ: 0.16, armRX: 0.12 + Math.sin(t * 0.045) * 0.03, armRZ: 0.16, lean: 0.05 + Math.sin(t * 0.045) * 0.012, twist: 0, dip: 0, headX: 0.22, headY: 0, kneel: 0, sway: 0, bob: 0, rise: 0 };
  }
  tickPose() {
    const s = this.state, P = this.pose, D = this.tp, t = this.t, walk = this.walk;
    const ph = t * 0.085;
    if (s === 'move' || ((s === 'recover' || s === 'intro') && walk > 0.05)) {
      D.legA = Math.sin(ph) * 0.5 * walk; D.legB = -Math.sin(ph) * 0.5 * walk;
      D.armLX += Math.sin(ph) * 0.18 * walk; D.armRX -= Math.sin(ph) * 0.18 * walk; D.lean += 0.06 * walk;
    }
    if (s === 'move') {
      const h = this.hero; if (h) D.headY = clamp(wrap(this.angTo(h.x, h.z) - this.yaw), -0.7, 0.7) * 0.7;
      this.rate = 0.12;
    }
    if (s === 'recover') {
      const k = this.st / this.recoverMax, name = this.recoverName;
      this.rate = 0.18;
      const up = (k0) => (k > k0 ? 1 - (k - k0) / (1 - k0) : 1);        // 1 while down, easing back to 0 at the end
      if (name === 'sweep') { D.lean = 0.42 - 0.3 * k + Math.sin(t * 0.3) * 0.04; D.dip = -0.1 + Math.sin(t * 0.3) * 0.015; D.armRZ = 0.4; D.armLZ = 0.4; D.armRX = 0.4; D.armLX = 0.35; D.headX = 0.6; D.twist = Math.sin(t * 0.12) * 0.25; }
      else if (name === 'slam' || name === 'slam2') {
        // wrestling the maul out of the floor: he heaves, then it comes free
        const heave = k < 0.72, r = clamp((k - 0.72) / 0.28, 0, 1);
        D.lean = heave ? 0.7 - 0.1 * Math.sin(this.st * 0.5) : lerp(0.7, 0.05, r); D.armRX = heave ? -0.3 : lerp(-0.3, 0.1, r); D.armLX = D.armRX; D.dip = heave ? -0.1 : 0; D.headX = 0.5;
        if (heave) this.freed = false;
        else if (!this.freed) { this.freed = true; this.ball.mode = 'hang'; vfx.dust({ x: this.ball.x, z: this.ball.z, n: 10, size: 5, speed: 1 }); vfx.hit({ x: this.ball.x, y: 0.4, z: this.ball.z, dx: 0, dz: 1, power: 0.8, style: 'hit' }); feedback.shake(2, 120); }
      } else if (name === 'leap') { const u = up(0.75); D.dip = -0.72 * u; D.lean = 0.42; D.legA = -1.1 * u; D.legB = 1.0 * u; D.armRX = -0.4; D.armLX = 0.4; D.headX = 0.5; }
      else if (name === 'stagger') { const u = sstep(this.st / 10) * up(0.85); D.dip = -0.72 * u; D.legA = -1.1 * u; D.legB = 1.0 * u; D.lean = 0.5; D.headX = 0.7; D.armRX = 0.3; D.armLX = 0.3; }
      else if (name === 'lash') { D.lean = 0.2; D.armRX = 0.4; D.headX = 0.4; }
      else if (name === 'summon') { D.lean = 0.1; D.armRX = -0.6; D.armLX = -0.6; }
      if (this.ball.mode === 'mace' && name !== 'leap') this.ball.mode = 'hang';
    }
    if (this.override) { Object.assign(D, this.override); if (this.override.rate) this.rate = this.override.rate; }
    for (const k in P) if (k in D) P[k] += (D[k] - P[k]) * this.rate;
    // footsteps: a heavy foot lands each half stride
    if (walk > 0.25 && s === 'move') {
      const cyc = Math.sin(ph);
      if (Math.sign(cyc) !== Math.sign(this.stepPh) && this.t - this.lastStep > 8) {
        this.lastStep = this.t;
        this.emit('step');
        vfx.dust({ x: this.x + (cyc > 0 ? 0.4 : -0.4), z: this.z, dx: 0, dz: -1, n: 3, size: 4, speed: 0.7 });
        feedback.shake(0.9, 90);
      }
      this.stepPh = cyc;
    }
    if (this.state !== 'intro') this.eyeK += (1 - this.eyeK) * 0.1;
  }

  // ---- render ----------------------------------------------------------------------------------------------
  render(alpha) {
    const L = (a, b) => a + (b - a) * alpha;
    const hidden = this.gone;
    this.g.visible = !hidden; this.shadow.visible = !hidden; this.chainG.visible = !hidden;
    if (hidden) return;
    const x = L(this.px, this.x), z = L(this.pz, this.z), ay = L(this.pairY, this.airY);
    _v.set(x, ay, z); look.snap(_v);
    this.g.position.copy(_v);
    this.yg.rotation.y = this.pyaw + wrap(this.yaw - this.pyaw) * alpha;
    const sq = L(this.psquash ?? 0, this.squash);
    const S = TUNE.scale;
    this.yg.scale.set(S * (1 + sq * 0.05), S * (1 - sq * 0.07), S * (1 + sq * 0.05));
    const p = {}; for (const k in this.pose) p[k] = L(this.ppose[k] ?? this.pose[k], this.pose[k]);
    const t = this.t + alpha, sh = this.shud > 0 ? Math.sin(this.shud * 2.4) * 0.03 * this.shud / 8 : 0;
    const dip = p.dip + Math.sin(t * 0.045) * 0.012;
    this.legL.rotation.x = p.legA; this.legR.rotation.x = p.legB;
    this.legL.position.y = this.legR.position.y = 12 * V + dip;
    this.bodyG.position.set(sh, 12 * V + dip, 0);
    this.bodyG.rotation.set(p.lean, p.twist, Math.sin(t * 0.03) * 0.012);
    this.headG.rotation.set(p.headX + Math.sin(t * 0.05) * 0.02, p.headY, 0);
    this.armL.rotation.set(p.armLX, 0, -p.armLZ);
    this.armR.rotation.set(p.armRX, 0, p.armRZ);
    this.keys.rotation.set(Math.sin(t * 0.09) * 0.12 + p.lean * 0.3, 0, Math.sin(t * 0.07) * 0.1 + Math.sin(t * 0.3) * 0.02 * (this.walk));
    this.tabard.rotation.x = Math.sin(t * 0.06) * 0.06 - this.walk * 0.25 * Math.abs(Math.sin(t * 0.085));
    // the light of him: eyes, cracks
    const eyeOn = this.state !== 'intro' || this.eyeK > 0.02;
    this.eyes.visible = eyeOn && this.eyeK > 0.05;
    const eb = 1.2 + this.eyeBoost * 0.3 + (this.tflash > 0.5 ? 0.2 : 0);
    this.eyes.scale.set(eb, eb, 1);
    if (this.eyeLight) this.eyeLight.intensity = this.eyeK * (0.35 + this.eyeBoost * 0.5 + this.tflash * 0.6);
    const cracked = !!(this.phase >= 2 || this.crackK > 0.02 || this.crackForce);
    this.cracks.visible = cracked && ((Math.floor(t / 4) % 9) !== 0);
    this.cracksBack.visible = !!(this.crackBackK > 0.5 || this.phase >= 3 || this.crackForce);
    // hit flash / telegraph pulse (white wins)
    const f = this.flashLevel();
    this.matBody.userData.flash.value = f || this.tflash * 0.5;
    this.matBody.userData.flashColor.value.setHex(f ? hex('white') : hex('ember'));
    this.matBall.userData.flash.value = this.ball.flash * 0.6;
    this.matBall.userData.flashColor.value.setHex(hex('ember'));
    const gh = 1 - Math.min(0.55, ay * 0.16);
    this.shadow.position.set(_v.x, 0.006, _v.z);
    const ss = 4.6 * gh; this.shadow.scale.set(ss, 0.06, ss);
    // stars circle his head while he is open
    this.g.updateMatrixWorld(true);
    for (let i = 0; i < 3; i++) {
      const m = this.stars[i], on = this.punishing && this.st > 4;
      m.visible = on; if (!on) continue;
      const a = this.t * 0.09 + i * TAU / 3;
      m.position.set(Math.sin(a) * 0.9, 4.35 + Math.sin(this.t * 0.2 + i) * 0.05, Math.cos(a) * 0.6);
      m.rotation.y = -this.yg.rotation.y;
    }
    this.renderChain(alpha);
  }

  renderChain(alpha) {
    const B = this.ball;
    this.handA.getWorldPosition(_a);
    this.phandW.copy(this.handW); this.handW.copy(_a);
    const hand = _a;
    let bx = lerp(B.px, B.x, alpha), by = lerp(B.py, B.y, alpha), bz = lerp(B.pz, B.z, alpha);
    let chain = 3.6;
    if (B.mode === 'hang' || B.mode === 'mace') {
      const t = this.t + alpha;
      if (B.mode === 'mace') { bx = hand.x + Math.sin(this.yaw) * 0.05; by = hand.y + 0.42; bz = hand.z + Math.cos(this.yaw) * 0.05; chain = 0.9; }
      else {                                            // hangs from the fist, sways a little, rests on the floor
        bx = hand.x + Math.sin(t * 0.06) * 0.06; bz = hand.z + Math.cos(t * 0.05) * 0.06; by = Math.max(0.6, hand.y - 1.0); chain = 1.7;
        if (this.phase >= 2 && B.mode === 'hang') { chain = 1.1; by = Math.max(0.6, hand.y - 0.7); }
      }
      B.x = B.px = bx; B.y = B.py = by; B.z = B.pz = bz;
    } else if (B.mode === 'stuck') { chain = 1.4; }
    else if (B.mode === 'drag') { chain = 3.2; }
    this.ballM.visible = true;
    _v.set(bx, by, bz); look.snap(_v);
    this.ballM.position.copy(_v);
    this.ballM.rotation.set(this.t * 0.02, this.t * 0.035, 0);
    // links along a sagging curve from the fist to the ball
    const dx = bx - hand.x, dy = by - hand.y, dz = bz - hand.z, dist = Math.hypot(dx, dy, dz);
    const slack = Math.max(0, chain - dist);
    const sag = Math.min(1.2, slack * 0.6);
    const n = clamp(Math.ceil(dist / 0.4), 4, this.links.length);
    for (let i = 0; i < this.links.length; i++) {
      const m = this.links[i];
      if (i >= n) { m.visible = false; continue; }
      m.visible = true;
      const u = (i + 0.5) / n;
      const c = (k) => {
        const cx = lerp(hand.x, bx, k), cy = lerp(hand.y, by, k) - 4 * sag * k * (1 - k), cz = lerp(hand.z, bz, k);
        return [cx, Math.max(0.07, cy), cz];
      };
      const [px, py, pz] = c(u), [qx, qy, qz] = c(Math.min(1, u + 0.02));
      _v.set(px, py, pz); look.snap(_v);
      m.position.copy(_v);
      _b.set(qx - px, qy - py, qz - pz);
      if (_b.lengthSq() < 1e-8) _b.set(0, -1, 0);
      _b.normalize();
      _q.setFromUnitVectors(_z, _b);
      m.quaternion.copy(_q);
    }
  }

  dispose() {
    this.f.root.remove(this.g, this.shadow, this.chainG);
    this.eyeLight?.remove(); this.fillLight?.remove();
    if (this.body && this.f.cw) this.f.cw.remove(this.body);
  }
  info() { return { id: this.id, type: 'warden', state: this.state, phase: this.phase, attack: this.a?.name ?? null, stage: this.a?.stage ?? null, x: +this.x.toFixed(2), z: +this.z.toFixed(2), hp: this.hp, maxHp: this.maxHp, punish: this.punishing, t: this.t }; }
}
