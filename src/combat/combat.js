// Combat feel (piece `combat`): the hero's 3-hit combo, hitboxes that follow the swing,
// hit resolution with hitstop / flash / knockback / sparks / sound / screen kick all scaled
// by damage, the hero's hurt and death rules, and a base class for anything that can be hit.
//
//   import { HeroCombat, HeroHealth, Hurtable, COMBO, strike } from './combat/combat.js';
//
//   const health = new HeroHealth({ ctl, anim, rig, hp: 5 });   // also a valid world.hero
//   const combat = new HeroCombat({ ctl, anim, health, targets: () => world.enemies });
//   world.hero = health;
//   // every sim tick (instead of ctl.tick()):
//   combat.tick();            // = combat.pre(); ctl.tick(); combat.post(); health.tick();
//   // every render frame, after anim.render(alpha):
//   health.render();          // i-frame blink
//
// Targets are anything with { x, z, r, dead, takeHit(hit) -> bool }. Hurtable (below) is a
// ready-made base with knockback, launch, tilt wobble and a stepped hit flash; enemies can
// extend it or copy its takeHit contract.
//
// Events (core/events.js):
//   'combat:attack'    { step, name, x, z, yaw }                 an attack starts (windup)
//   'combat:hit'       { target, x, y, z, dx, dz, tx, tz, dmg, power, finisher, step, stopMs }
//                      one per target struck. (x,y,z) is the contact point, (dx,dz) the push
//                      direction, (tx,tz) the blade's travel direction there. power ~0.8..2.2
//   'combat:damage'    { x, y, z, amount, crit, side: 'enemy'|'hero' }   damage-number hook (hud)
//   'combat:kill'      { target, x, z }                          a target's hp reached 0
//   'combat:heroHurt'  { x, z, amount, hp, maxHp, dx, dz, source }
//   'combat:dodge'     { x, z, source }                          an attack met dash i-frames
//   'combat:heroDeath' { x, z }
//   'combat:whiff'     { step }                                  a swing ended having hit nothing
//
// Hitstop is global (the whole sim freezes). One hitstop per tick, however many targets
// were struck: the longest, plus a little per extra target.

import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { world } from '../core/world.js';
import { debug } from '../core/debug.js';
import { loop, DT } from '../core/loop.js';
import { look } from '../render/look.js';
import { ATTACKS } from '../hero/anim.js';

const D2R = Math.PI / 180;
const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };

// Leading edge of the smear per active tick, degrees from forward toward the sword side
// (+x). Mirrors SMEAR_SPEC in hero/model.js: the hitbox sweeps exactly where the smear is drawn.
const SMEAR_LEAD = [55, -25, -95, -120];
const SMEAR_TAIL = 125;
const SMEAR_REACH = 10.6 / 8;   // outer rim of the smear, world units from the hero's centre

/**
 * The combo. Tuning lives here (boons may edit it). Timings come from hero/anim.js ATTACKS.
 *   dmg        base damage (numbers are ~10s so damage numbers read; enemies size hp to match)
 *   reach      units beyond the target's radius the blade still connects
 *   arc        'h' horizontal sweep following the smear (mirror = backhand), or [from, to] cone in degrees
 *   hitFrom    first active tick that can hit (the overhead connects as the blade comes down)
 *   knock      knockback speed given to a weight-1 target, units/s
 *   lift       upward pop, units/s (launch)
 *   stop       hitstop, ms, for the first target
 *   kick/shake screen kick along the hit, px / shake px
 */
export const COMBO = [
  { name: 'slash', dmg: 10, spread: 1, reach: SMEAR_REACH + 0.12, arc: 'h', mirror: false, hitFrom: 0,
    knock: 1.7, lift: 0, stop: 55, kick: 1.5, shake: 0, sparks: 7 },
  { name: 'backhand', dmg: 11, spread: 1, reach: SMEAR_REACH + 0.12, arc: 'h', mirror: true, hitFrom: 0,
    knock: 2.1, lift: 0, stop: 62, kick: 2, shake: 0.8, sparks: 8 },
  { name: 'overhead', dmg: 24, spread: 2, reach: SMEAR_REACH + 0.22, arc: [-42, 42], mirror: false, hitFrom: 1,
    knock: 8.5, lift: 3.4, stop: 95, kick: 4, shake: 3, sparks: 16, finisher: true },
];

export const RULES = {
  queueTicks: 12,        // an attack press waits this long for the hero to be free (dash, hurt stun)
  linger: 14,            // ticks after an attack ends in which the next press still continues the combo
  assistRange: 2.3,      // keyboard aim assist: snap the swing toward a target this close ...
  assistAngle: 55,       // ... within this many degrees of the facing
  stepIn: 0.5,           // max units the hero steps toward that target as a swing starts
  stepGap: 0.72,         // ... to leave this much between the hero's centre and the target's edge
  heroIframes: 60,       // ticks of invulnerability after the hero is hurt (1 s)
  heroStun: 8,           // ticks the hurt flinch takes movement away
  heroKnock: 5.5,        // units/s pushed away from the hit
  heroStop: 80,          // ms hitstop when the hero is hurt
};

// ---- hitbox maths ----------------------------------------------------------------------

/** Covered angular range (degrees, relative to facing, + toward the hero's +x side) at active tick k. */
export function swingRange(spec, k) {
  if (spec.arc === 'h') {
    const lead = SMEAR_LEAD[Math.min(k, SMEAR_LEAD.length - 1)] - 10;  // a little ahead of the drawn edge
    return spec.mirror ? [-SMEAR_TAIL, -lead] : [lead, SMEAR_TAIL];
  }
  return spec.arc;
}

/** Does a swing from (hx,hz) facing yaw, covering [a0,a1] degrees out to reach, touch circle (x,z,r)? */
export function sectorHits(hx, hz, yaw, a0, a1, reach, x, z, r) {
  const dx = x - hx, dz = z - hz;
  const d = Math.hypot(dx, dz);
  if (d - r > reach) return false;
  if (d < r + 0.3) return true;   // overlapping the hero's body: always in reach
  const rel = wrap(Math.atan2(dx, dz) - yaw) / D2R;
  const half = Math.asin(Math.min(1, r / d)) / D2R;
  return rel + half >= a0 && rel - half <= a1;
}

// ---- striking ----------------------------------------------------------------------------

/**
 * Hit one target. Everything a hit needs except the hitstop, which the caller applies once per
 * tick (see applyImpact). Returns the resolved hit, or null if the target ignored it.
 *   src {x, z}  where the blow comes from;  spec: a COMBO entry (or an enemy's own attack spec)
 */
export function strike(target, src, spec, { step = -1, tx = 0, tz = 0, dmg = null } = {}) {
  if (!target || target.dead) return null;
  let dx = target.x - src.x, dz = target.z - src.z;
  const l = Math.hypot(dx, dz) || 1;
  dx /= l; dz /= l;
  const amount = dmg ?? spec.dmg;
  const power = Math.max(0.6, amount / 10) * (spec.finisher ? 1.1 : 1);
  const hit = {
    dmg: amount, dx, dz, tx, tz, power, step, finisher: !!spec.finisher,
    knock: spec.knock ?? 4, lift: spec.lift ?? 0, stopMs: spec.stop ?? 50, flashTicks: spec.finisher ? 5 : 3,
  };
  if (target.takeHit(hit) === false) return null;
  const r = target.r ?? 0.35;
  const cx = target.x - dx * r * 0.8, cz = target.z - dz * r * 0.8;
  const cy = (target.hitY ?? 0.6);
  const out = { target, x: cx, y: cy, z: cz, ...hit };
  events.emit('combat:hit', out);
  events.emit('combat:damage', { x: target.x, y: (target.h ?? 1.2) + 0.1, z: target.z, amount, crit: hit.finisher, side: 'enemy' });
  look.flash(cx, cy + 0.2, cz, { color: hit.finisher ? 'gold' : 'torch', ms: hit.finisher ? 150 : 90, intensity: 1.2 + power, radius: 2.5 + power });
  if (target.dead) events.emit('combat:kill', { target, x: target.x, z: target.z });
  return out;
}

/** Hitstop + screen kick + shake for all targets struck on one tick. */
export function applyImpact(hits, spec) {
  if (!hits.length) return;
  let stop = 0, kx = 0, kz = 0;
  for (const h of hits) { stop = Math.max(stop, h.stopMs); kx += h.dx; kz += h.dz; }
  stop = Math.min(110, stop + (hits.length - 1) * 8);
  feedback.hitstop(stop);
  // screen y grows toward +z, foreshortened by the camera pitch
  feedback.kick(kx, kz * 0.77, spec.kick ?? 1.5);
  if (spec.shake) feedback.shake(spec.shake, spec.finisher ? 220 : 120);
}

// ---- things that can be hit -------------------------------------------------------------

/**
 * Base for dummies and enemies: position with knockback velocity and friction, a launch
 * (y) with gravity, a springy tilt that wobbles away from hits, and a stepped hit flash.
 * Subclasses call tickBody() each sim tick and read flashLevel()/tilt when rendering.
 */
export class Hurtable {
  constructor({ id = null, type = 'target', x = 0, z = 0, r = 0.35, h = 1.2, hp = Infinity, weight = 1, friction = 0.82, bounds = null } = {}) {
    this.id = id; this.type = type;
    this.x = x; this.z = z; this.y = 0;
    this.px = x; this.pz = z; this.py = 0;           // previous tick (render interpolation)
    this.r = r; this.h = h; this.hitY = h * 0.5;
    this.hp = hp; this.maxHp = hp; this.dead = false;
    this.weight = weight; this.friction = friction;
    this.vx = 0; this.vz = 0; this.vy = 0;
    this.tiltX = 0; this.tiltZ = 0; this.tvx = 0; this.tvz = 0;   // tilt (rad) about x and z axes
    this.ptiltX = 0; this.ptiltZ = 0;
    this.flashT = 0; this.flashLen = 1;
    this.squash = 0; this.psquash = 0;               // 1 = fully squashed by a hit, springs back
    this.hits = 0; this.lastHit = null; this.invulnT = 0;
    this.bounds = bounds;                            // {minX, maxX, minZ, maxZ} keep-inside box
    this.collision = null;                           // optional CollisionWorld to slide against
  }

  get invuln() { return this.invulnT > 0; }

  /** The combat contract: apply a hit, return false to ignore it. */
  takeHit(hit) {
    if (this.dead || this.invulnT > 0) return false;
    this.hp -= hit.dmg;
    const k = hit.knock / this.weight;
    this.vx += hit.dx * k; this.vz += hit.dz * k;
    if (hit.lift) this.vy = Math.max(this.vy, hit.lift / Math.sqrt(this.weight));
    // tip away from the blow; a finisher rocks it hard
    const tk = (0.09 + 0.05 * hit.power) / this.weight;
    this.tvz += -hit.dx * tk * 6; this.tvx += hit.dz * tk * 6;
    this.flashT = hit.flashTicks; this.flashLen = hit.flashTicks;
    this.squash = Math.min(1, 0.5 + 0.25 * hit.power);
    this.hits++;
    this.lastHit = { ...hit, tick: loop.tick, fromX: this.x, fromZ: this.z };
    if (this.hp <= 0 && Number.isFinite(this.hp)) { this.hp = 0; this.dead = true; }
    return true;
  }

  tickBody() {
    this.px = this.x; this.pz = this.z; this.py = this.y;
    this.ptiltX = this.tiltX; this.ptiltZ = this.tiltZ; this.psquash = this.squash;
    if (this.invulnT > 0) this.invulnT--;
    if (this.flashT > 0) this.flashT--;
    // slide
    const air = this.y > 0.001;
    const f = air ? 0.93 : this.friction;
    let mx = this.vx * DT, mz = this.vz * DT;
    if (this.collision) {
      const b = { x: this.x, z: this.z, r: this.r };
      this.collision.move(b, mx, mz);
      this.x = b.x; this.z = b.z;
    } else { this.x += mx; this.z += mz; }
    const B = this.bounds;
    if (B) {
      if (this.x < B.minX + this.r) { this.x = B.minX + this.r; this.vx = Math.abs(this.vx) * 0.3; }
      if (this.x > B.maxX - this.r) { this.x = B.maxX - this.r; this.vx = -Math.abs(this.vx) * 0.3; }
      if (this.z < B.minZ + this.r) { this.z = B.minZ + this.r; this.vz = Math.abs(this.vz) * 0.3; }
      if (this.z > B.maxZ - this.r) { this.z = B.maxZ - this.r; this.vz = -Math.abs(this.vz) * 0.3; }
    }
    this.vx *= f; this.vz *= f;
    if (Math.hypot(this.vx, this.vz) < 0.05) { this.vx = 0; this.vz = 0; }
    // launch
    if (air || this.vy > 0) {
      this.vy -= 22 * DT;
      this.y += this.vy * DT;
      if (this.y <= 0) {
        this.y = 0;
        const impact = -this.vy;
        this.vy = impact > 2 ? impact * 0.3 : 0;
        if (impact > 1.5) { this.squash = Math.max(this.squash, Math.min(0.8, impact * 0.12)); this.onLand?.(impact); }
      }
    }
    // tilt: a damped spring back to upright
    const K = 0.16 * (this.tiltStiff ?? 1), Dm = 0.8;
    this.tvx = (this.tvx - this.tiltX * K) * Dm; this.tvz = (this.tvz - this.tiltZ * K) * Dm;
    this.tiltX += this.tvx; this.tiltZ += this.tvz;
    const lim = 0.7;
    this.tiltX = Math.max(-lim, Math.min(lim, this.tiltX));
    this.tiltZ = Math.max(-lim, Math.min(lim, this.tiltZ));
    this.squash *= 0.72;
    if (this.squash < 0.01) this.squash = 0;
  }

  /** Interpolated render state. */
  at(alpha) {
    const L = (a, b) => a + (b - a) * alpha;
    return { x: L(this.px, this.x), z: L(this.pz, this.z), y: L(this.py, this.y),
      tiltX: L(this.ptiltX, this.tiltX), tiltZ: L(this.ptiltZ, this.tiltZ), squash: L(this.psquash, this.squash) };
  }

  /** 0 (none), 0.5 or 1: a hard white frame, then a stepped falloff. Held through hitstop. */
  flashLevel() { return this.flashT <= 0 ? 0 : this.flashT > this.flashLen / 2 ? 1 : 0.5; }
}

// ---- the hero's health, hurt and death rules --------------------------------------------

let activeHealth = null;

/**
 * The hero's hp. Doubles as world.hero (x, z, hp, maxHp, invuln).
 *   health.hurt(amount, source?, { force })   source {x, z} or null. force ignores i-frames (debug)
 *   health.heal(n); health.revive()
 * Rules: dash i-frames and post-hurt i-frames (RULES.heroIframes) make the hero immune.
 * world.god keeps hp from dropping but still plays the hurt. At 0 hp the hero dies.
 */
export class HeroHealth {
  constructor({ ctl, anim, rig, hp = 5, maxHp = hp }) {
    this.ctl = ctl; this.anim = anim; this.rig = rig;
    this.hp = hp; this.maxHp = maxHp;
    this.iframeT = 0;        // post-hurt i-frames (ours; the dash's live on ctl)
    this.hurtT = 0;          // ticks since the last hurt (overlay)
    this.lastHurt = null;
    this.deaths = 0;
    activeHealth = this;
  }
  get x() { return this.ctl.x; }
  get z() { return this.ctl.z; }
  get dead() { return this.hp <= 0 || !!this.anim?.dead; }
  get invuln() { return this.ctl.invulnerable || this.iframeT > 0; }
  get dashing() { return this.ctl.state === 'dash' && this.ctl.invulnerable; }

  hurt(amount = 1, source = null, { force = false } = {}) {
    if (this.dead) return { ok: false, reason: 'dead' };
    if (!force && this.invuln) {
      if (this.ctl.invulnerable) events.emit('combat:dodge', { x: this.x, z: this.z, source });
      return { ok: false, reason: this.ctl.invulnerable ? 'dodged' : 'iframes' };
    }
    // boons hook: a ward or a phoenix may refuse the hurt (src/progression/effects.js)
    if (this.guard?.(amount, source)) return { ok: false, reason: 'guarded' };
    const sx = source?.x ?? this.x - Math.sin(this.ctl.face), sz = source?.z ?? this.z - Math.cos(this.ctl.face);
    let dx = this.x - sx, dz = this.z - sz;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    if (!world.god) this.hp = Math.max(0, this.hp - amount);
    this.iframeT = RULES.heroIframes;
    this.hurtT = 0;
    this.lastHurt = { amount, dx, dz, tick: loop.tick };
    const fromYaw = Math.atan2(-dx, -dz);
    feedback.hitstop(RULES.heroStop);
    feedback.flash('red', 110, 0.16);
    feedback.shake(2.5, 200);
    feedback.kick(dx, dz * 0.77, 2);
    look.flash(this.x, 0.8, this.z, { color: 'red', ms: 160, intensity: 2.2, radius: 3.5 });
    events.emit('combat:heroHurt', { x: this.x, z: this.z, amount, hp: this.hp, maxHp: this.maxHp, dx, dz, source });
    events.emit('combat:damage', { x: this.x, y: 1.5, z: this.z, amount, crit: false, side: 'hero' });
    if (this.hp <= 0) {
      this.anim?.die();
      this.ctl.stun(9999);
      this.ctl.impulse(dx * RULES.heroKnock * 0.8, dz * RULES.heroKnock * 0.8);
      this.deaths++;
      events.emit('combat:heroDeath', { x: this.x, z: this.z });
    } else {
      this.anim?.hurt(fromYaw);
      this.ctl.stun(RULES.heroStun);
      this.ctl.impulse(dx * RULES.heroKnock, dz * RULES.heroKnock);
    }
    return { ok: true, hp: this.hp };
  }
  heal(n = 1) { this.hp = Math.min(this.maxHp, this.hp + n); return this.hp; }
  /** Back to full hp and on your feet (showcase / checkpoint). */
  revive() {
    this.hp = this.maxHp; this.iframeT = RULES.heroIframes; this.hurtT = 999;
    this.ctl.stunT = 0;
    this.anim?.spawn();
  }

  tick() {
    if (this.iframeT > 0) this.iframeT--;
    this.hurtT++;
  }

  /**
   * After anim.render: flicker the body while the post-hurt i-frames run (3 ticks lit pale,
   * 3 normal). The hero never disappears, so you never lose track of yourself.
   */
  render() {
    const on = this.iframeT > 0 && !this.dead && this.hurtT > 6 && (Math.floor(loop.tick / 3) % 2 === 1);
    if (on) this.rig.flash('frost', 0.55);
  }

  info() { return { hp: this.hp, maxHp: this.maxHp, iframes: this.iframeT, dashIframes: this.ctl.invulnerable, dead: this.dead, deaths: this.deaths }; }
}

// ---- the hero's combo -------------------------------------------------------------------

let activeCombat = null;

/**
 * Input -> combo -> hits. One per hero.
 *   combat.pre()   read the attack press; start the next attack when the hero is free
 *   combat.post()  after ctl.tick(): test the active swing against targets and resolve hits
 *   combat.tick()  pre + ctl.tick + post + health.tick, in that order
 *
 * Combo rules: a press any time during an attack queues the next one, which starts on the
 * attack's cancel tick (so the tempo is fixed: mashing is no faster than pressing in rhythm).
 * After an attack ends, a press within RULES.linger ticks continues the chain; after that, or
 * after the overhead, it starts again at the slash. A press during a dash or a hurt stun
 * waits up to RULES.queueTicks.
 */
export class HeroCombat {
  constructor({ ctl, anim, health = null, targets = () => world.enemies, source = null }) {
    this.ctl = ctl; this.anim = anim; this.health = health;
    this.targets = targets;
    this._source = source;
    this.queued = -1;          // tick the pending press arrived, or -1
    this.step = -1;            // step of the current / last attack
    this.sinceEnd = 999;       // ticks since the last attack finished
    this.swing = 0;            // swing counter (id)
    this.struck = new Set();   // targets hit by the current swing
    this.swingHits = 0;
    this.tick_ = 0;
    this.log = [];             // recent presses & attacks for the showcase timeline
    this.lastHits = [];        // hits resolved on the most recent hitting tick
    this.debugHitbox = null;   // {x, z, yaw, a0, a1, reach} of the active swing (overlay)
    this.stats = { swings: 0, hits: 0, whiffs: 0, combos: 0 };
    activeCombat = this;
  }
  get source() { return this._source ?? this.ctl.source; }
  get attacking() { return this.anim.state === 'attack'; }

  /** Force a press (scripts, AI). */
  press() { this.queued = this.tick_; this.log.push({ kind: 'press', tick: loop.tick }); }

  pre() {
    this.tick_++;
    const a = this.anim, ctl = this.ctl;
    if (this.source.consume('attack')) this.press();
    if (!this.attacking) this.sinceEnd++;
    if (this.queued < 0) return;
    if (a.dead || a.state === 'spawn') { this.queued = -1; return; }
    const age = this.tick_ - this.queued;
    if (this.attacking) {
      if (!a.canChain) return;                     // hold it for the cancel tick
    } else if (ctl.state === 'dash' || ctl.stunT > 0) {
      if (age > RULES.queueTicks + (ctl.state === 'dash' ? ctl.T.dashTicks : 0)) this.queued = -1;
      return;
    }
    let step;
    if (this.attacking) step = a.step >= 2 ? 0 : a.step + 1;
    else step = this.step >= 0 && this.step < 2 && this.sinceEnd <= RULES.linger ? this.step + 1 : 0;
    const tgt = this._aimAssist();
    const atk = ctl.attack(step);
    if (!atk) { if (age > RULES.queueTicks) this.queued = -1; return; }
    if (tgt) {
      // close the gap a little so a chain doesn't walk itself out of reach (friction halves
      // the impulse each tick, so it covers ~2 * v * DT)
      const want = Math.min(RULES.stepIn, Math.max(0, tgt.d - (tgt.t.r ?? 0.35) - RULES.stepGap));
      if (want > 0.01) ctl.impulse(tgt.x * want / (2 * DT), tgt.z * want / (2 * DT));
    }
    this._finishSwing();
    this.queued = -1;
    this.step = step;
    this.sinceEnd = 0;
    this.swing++;
    this.struck.clear();
    this.swingHits = 0;
    this.stats.swings++;
    if (step === 2) this.stats.combos++;
    this.log.push({ kind: 'attack', tick: loop.tick, step });
    if (this.log.length > 40) this.log.splice(0, this.log.length - 40);
    events.emit('combat:attack', { step, name: COMBO[step].name, x: ctl.x, z: ctl.z, yaw: ctl.face });
  }

  /** Keyboard play: turn the swing toward the nearest target roughly ahead. Mouse aim is left alone. */
  _aimAssist() {
    const ctl = this.ctl;
    const mouse = ctl.aimSource === 'mouse';
    const fx = mouse ? ctl.aim.x : Math.sin(ctl.face), fz = mouse ? ctl.aim.z : Math.cos(ctl.face);
    let best = null, bestScore = Infinity;
    for (const t of this.targets() || []) {
      if (!t || t.dead || t.noAssist) continue;   // noAssist: props (arenas) are hittable but never pull the aim
      const dx = t.x - ctl.x, dz = t.z - ctl.z;
      const d = Math.hypot(dx, dz);
      if (d > RULES.assistRange + (t.r ?? 0.35) || d < 1e-3) continue;
      const ang = Math.acos(Math.max(-1, Math.min(1, (dx * fx + dz * fz) / d))) / D2R;
      if (ang > RULES.assistAngle) continue;
      const score = d + ang * 0.02;
      if (score < bestScore) { bestScore = score; best = { x: dx / d, z: dz / d, d, t }; }
    }
    if (best && !mouse) { ctl.aim.x = best.x; ctl.aim.z = best.z; }
    return best;
  }

  post() {
    const a = this.anim, ctl = this.ctl;
    this.debugHitbox = null;
    if (!this.attacking) { this._finishSwing(); return; }
    const spec = COMBO[a.step];
    const k = a.smear;
    if (k < 0) { if (a.t > ATTACKS[a.step].windup) this._finishSwing(); return; }
    if (k < spec.hitFrom) return;
    const yaw = a.pose.cur.yaw;
    const [a0, a1] = swingRange(spec, k);
    this.debugHitbox = { x: ctl.x, z: ctl.z, yaw, a0, a1, reach: spec.reach, step: a.step, k };
    const hits = [];
    for (const t of this.targets() || []) {
      if (!t || t.dead || this.struck.has(t)) continue;
      if (!sectorHits(ctl.x, ctl.z, yaw, a0, a1, spec.reach, t.x, t.z, t.r ?? 0.35)) continue;
      // blade travel direction at the target: tangent of the sweep (sign by swing direction)
      const ang = Math.atan2(t.x - ctl.x, t.z - ctl.z);
      const s = spec.arc === 'h' ? (spec.mirror ? 1 : -1) : 0;
      let tx = Math.cos(ang) * s, tz = -Math.sin(ang) * s;
      if (!s) { tx = 0; tz = 0; }
      let dmg = spec.dmg + (spec.spread ? ((this.swing * 7 + hits.length * 3 + t.hits) % (spec.spread * 2 + 1)) - spec.spread : 0);
      let sp = spec;
      // boons hook: crits and knockback (src/progression/effects.js)
      const mod = this.modHit?.({ target: t, spec, dmg, step: a.step });
      if (mod) { dmg = mod.dmg ?? dmg; sp = mod.spec ?? spec; }
      const h = strike(t, { x: ctl.x, z: ctl.z }, sp, { step: a.step, tx, tz, dmg });
      this.struck.add(t);
      if (h) hits.push(h);
    }
    if (hits.length) {
      applyImpact(hits, spec);
      this.swingHits += hits.length;
      this.stats.hits += hits.length;
      this.lastHits = hits.map((h) => ({ id: h.target.id, dmg: h.dmg, tick: this.tick_ }));
      this.log.push({ kind: 'hit', tick: loop.tick, step: a.step, n: hits.length });
    }
  }

  _finishSwing() {
    if (this.swing > 0 && this._closed !== this.swing) {
      this._closed = this.swing;
      if (this.swingHits === 0) { this.stats.whiffs++; events.emit('combat:whiff', { step: this.step }); }
    }
  }

  tick() {
    this.pre();
    this.ctl.tick();
    this.post();
    this.health?.tick();
  }

  /** Where in the chain the hero is, for HUDs and the showcase timeline. */
  info() {
    const a = this.anim;
    const atk = this.attacking ? ATTACKS[a.step] : null;
    return {
      step: this.attacking ? a.step : -1, lastStep: this.step, t: this.attacking ? a.t : -1,
      phase: !atk ? 'idle' : a.t < atk.windup ? 'windup' : a.t < atk.windup + atk.active ? 'active' : 'recover',
      canChain: a.canChain, queued: this.queued >= 0, sinceEnd: this.sinceEnd,
      chainOpen: !this.attacking && this.step >= 0 && this.step < 2 && this.sinceEnd <= RULES.linger,
      swing: this.swing, swingHits: this.swingHits, ...this.stats,
    };
  }
}

// ---- debug hooks -------------------------------------------------------------------------
// __GR.debug.combat(action?, arg): no action returns combo info + hero health.
//   'press'           queue an attack press (same as J)
//   'tune', {step, key: value} or {rules: {...}}   live-edit COMBO[step] / RULES
//   'combo'           returns COMBO and RULES
debug.add('combat', (action, arg) => {
  const c = activeCombat;
  if (action === 'combo') return { combo: COMBO, rules: RULES };
  if (action === 'tune' && arg && typeof arg === 'object') {
    if (arg.rules) Object.assign(RULES, arg.rules);
    if (Number.isInteger(arg.step) && COMBO[arg.step]) { const { step, ...rest } = arg; Object.assign(COMBO[step], rest); }
    return { ok: true, combo: COMBO, rules: RULES };
  }
  if (!c) return { ok: false, error: 'no hero combat in this scene' };
  if (action === 'press') c.press();
  return { ok: true, ...c.info(), health: activeHealth?.info() ?? null };
});

// Contract hooks: hurt/kill go through the real rules (feedback, i-frames, death anim) when a
// HeroHealth is live in the current scene; otherwise foundation's default behaviour.
debug.handle('hurt', (n = 1) => {
  const h = activeHealth;
  if (h && world.hero === h) return { ...h.hurt(n, null, { force: true }), hp: h.hp };
  const w = world.hero;
  if (!w) return { ok: false, error: 'no hero in this scene' };
  if (!world.god) w.hp = Math.max(0, w.hp - n);
  return { ok: true, hp: w.hp };
});
debug.handle('kill', () => {
  const h = activeHealth;
  if (h && world.hero === h) {
    const god = world.god; world.god = false;
    const r = h.hurt(h.hp, null, { force: true });
    world.god = god;
    return r;
  }
  const w = world.hero;
  if (!w) return { ok: false, error: 'no hero in this scene' };
  w.hp = 0;
  return { ok: true };
});
