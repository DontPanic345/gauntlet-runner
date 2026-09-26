// Procedural animation for the hooded runner (piece `hero`).
//
//   import { createHeroRig } from './hero/model.js';
//   import { HeroAnim, ATTACKS } from './hero/anim.js';
//   const rig = createHeroRig(); root.add(rig.group);
//   const anim = new HeroAnim(rig, { x, z, yaw });
//
//   // every sim tick, after the controller has moved the hero:
//   anim.tick({ x, z, face });          // face: yaw the hero wants to look along (radians, 0 = +z)
//                                       // optional: vx, vz (units/s; default from position delta),
//                                       //           speed (override for run-in-place)
//   // one-shots (call inside a tick; each answers on that same tick):
//   anim.attack(step)       // step 0, 1, 2 of the combo. Returns ATTACKS[step] (timings in ticks)
//   anim.dash(ticks = 10)   // lunge pose, streaming cloth, afterimages
//   anim.hurt(fromYaw?)     // flinch away from the hit; flash, wince
//   anim.die()              // collapse; ends lying down. anim.dead stays true
//   anim.spawn()            // drop in from above, land, sword flourish
//   anim.reset(x, z, yaw)   // teleport, clear everything
//   // every render frame:
//   anim.render(alpha)
//
// Events on the shared bus (core/events.js), payload always has { anim, x, z, yaw }:
//   'hero:step'  { foot: 'L'|'R', speed }  a foot hits the floor (footstep dust, sound)
//   'hero:swing' { step }                  first active tick of an attack (hitbox on, whoosh)
//   'hero:slam'  { step: 2 }               the overhead finisher hits the floor
//   'hero:dash'  {}                        dash started (burst of dust)
//   'hero:land'  {}                        spawn landing
//   'hero:thud'  {}                        body hits the floor on death
//   'hero:dead'  {}                        death animation finished
//   'hero:ready' {}                        spawn animation finished
//
// Everything runs on sim ticks and is interpolated at render, so hitstop freezes the pose
// (smear and all) and slow motion is exact.

import * as THREE from 'three';
import { DT, Interp, lerp } from '../core/loop.js';
import { events } from '../core/events.js';
import { look } from '../render/look.js';
import { debug } from '../core/debug.js';
import { VOXEL, } from '../render/voxel/index.js';
import { SMEAR_FRAMES } from './model.js';

const V = VOXEL;
const TAU = Math.PI * 2;
export const RUN_SPEED = 4.2;          // units/s the run cycle is tuned for (placeholder hero speed)
const STRIDE = 1.5;                    // world units per full run cycle (two steps)

// ---- pose channels -----------------------------------------------------------------------
// Offsets and lifts are in voxels, angles in radians. Signs: leanX > 0 tips forward (+z),
// arm/leg rotation x < 0 swings forward, arm rotation y turns the (raised) arm toward +x.
const CH = ['offF', 'offY', 'sx', 'sy', 'sz', 'bob', 'lean', 'roll', 'twist', 'pitch',
  'tLean', 'tTwist', 'headX', 'headY', 'headZ',
  'aLx', 'aLy', 'aLz', 'aRx', 'aRy', 'aRz', 'swX', 'swY', 'swZ',
  'lLx', 'lLy', 'lLz', 'lRx', 'lRy', 'lRz'];

const ZERO = Object.fromEntries(CH.map((c) => [c, 0]));
/** Ready stance: weight settled, sword held low and forward. */
const STANCE = { ...ZERO, sx: 1, sy: 1, sz: 1, aLz: -0.14, aLx: 0.05, aRz: 0.16, aRx: -0.35, swX: 1.75, lLz: -0.05, lRz: 0.05 };
const P = (o) => ({ ...STANCE, ...o });

// ---- keyframed one-shots -----------------------------------------------------------------
// [tick, pose, ease into this key]. Missing channels are the stance value.
const E = {
  lin: (u) => u,
  out: (u) => 1 - (1 - u) * (1 - u),
  in: (u) => u * u,
  io: (u) => (u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u)),
  snap: (u) => 1 - Math.pow(1 - u, 4),
  hold: () => 0,
};

// The 3-hit combo. Sword in the +x hand. windup/active/recover are tick counts; combat reads
// them from ATTACKS. `cancel` is the first tick the next attack may interrupt the recovery.
export const ATTACKS = [
  { name: 'slash', windup: 5, active: 4, recover: 12, cancel: 12, smear: 'h', mirror: false, tilt: 0.22 },
  { name: 'backhand', windup: 4, active: 4, recover: 12, cancel: 11, smear: 'h', mirror: true, tilt: -0.28 },
  { name: 'overhead', windup: 10, active: 4, recover: 18, cancel: 24, smear: 'v', mirror: false, tilt: 0 },
];
ATTACKS.forEach((a) => { a.total = a.windup + a.active + a.recover; });

const KEYS = {
  attack0: [
    [0, P({}), 'lin'],
    [2, P({ sy: 0.94, sx: 1.04, bob: -0.3, tTwist: 0.25, aRx: -0.9, aRy: 1.1, swX: 2.6 }), 'out'],
    [5, P({ sy: 0.88, sx: 1.08, bob: -0.7, lean: -0.12, tTwist: 0.6, twist: 0.2, aRx: -1.35, aRy: 2.0, aRz: 0.15, swX: 3.0, swZ: 0.3,
      aLx: -0.7, aLz: -0.6, headY: -0.25, offF: -0.6, lLx: -0.3, lRx: 0.25 }), 'out'],
    [7, P({ sy: 1.1, sx: 0.94, lean: 0.24, headX: -0.18, tTwist: -0.25, twist: -0.05, aRx: -1.5, aRy: 0.1, swX: 3.1, aLx: -0.1, aLz: -0.5,
      offF: 1.6, lLx: -0.5, lRx: 0.45, headY: 0.05 }), 'snap'],
    [9, P({ sy: 0.93, sx: 1.06, bob: -0.4, lean: 0.26, tTwist: -0.5, twist: -0.18, headX: -0.2, aRx: -1.25, aRy: -1.55, swX: 3.1, swZ: -0.2,
      aLx: 0.5, aLz: -0.75, offF: 2.0, lLx: -0.55, lRx: 0.5, headY: 0.2 }), 'out'],
    [13, P({ sy: 0.98, bob: -0.3, lean: 0.16, headX: -0.12, tTwist: -0.6, twist: -0.2, aRx: -0.95, aRy: -1.8, swX: 2.9, aLx: 0.4, aLz: -0.6,
      offF: 1.8, lLx: -0.45, lRx: 0.4, headY: 0.15 }), 'out'],
    [21, P({ offF: 0 }), 'io'],
  ],
  attack1: [
    [0, P({}), 'lin'],
    [4, P({ sy: 0.9, sx: 1.07, bob: -0.6, lean: -0.08, tTwist: -0.65, twist: -0.22, aRx: -1.55, aRy: -1.45, aRz: -0.2, swX: 3.0, swZ: -0.3,
      aLx: 0.35, aLz: -0.45, headY: 0.25, offF: -0.4, lLx: 0.3, lRx: -0.35 }), 'out'],
    [6, P({ sy: 1.1, sx: 0.94, lean: 0.22, headX: -0.18, tTwist: 0.2, aRx: -1.65, aRy: 0.35, swX: 3.1, aLx: 0.1, aLz: -0.55,
      offF: 1.4, lLx: 0.4, lRx: -0.5 }), 'snap'],
    [8, P({ sy: 0.93, sx: 1.05, bob: -0.4, lean: 0.25, headX: -0.2, tTwist: 0.55, twist: 0.2, aRx: -1.35, aRy: 1.85, swX: 3.1, swZ: 0.25,
      aLx: -0.3, aLz: -0.8, offF: 1.8, lLx: 0.45, lRx: -0.55, headY: -0.2 }), 'out'],
    [12, P({ sy: 0.98, bob: -0.3, lean: 0.15, headX: -0.12, tTwist: 0.62, twist: 0.22, aRx: -1.05, aRy: 2.05, swX: 2.9, aLx: -0.2, aLz: -0.6,
      offF: 1.6, lLx: 0.4, lRx: -0.45, headY: -0.15 }), 'out'],
    [20, P({ offF: 0 }), 'io'],
  ],
  attack2: [
    [0, P({}), 'lin'],
    [3, P({ sy: 0.8, sx: 1.14, bob: -1.2, lean: 0.12, aRx: -0.6, aLx: -0.4, swX: 2.4, lLx: -0.2, lRx: 0.2 }), 'out'],
    [10, P({ sy: 1.16, sx: 0.9, bob: 0.4, offY: 1.6, lean: -0.32, tTwist: 0.1, headX: -0.25,
      aRx: -3.3, aRz: -0.32, swX: 3.2, aLx: -3.2, aLz: 0.36, offF: -0.4, lLx: -0.35, lRx: 0.35, lLy: 0.6 }), 'out'],
    [12, P({ sy: 1.05, lean: 0.28, headX: -0.2, aRx: -1.6, aRz: -0.2, aLx: -1.6, aLz: 0.25, swX: 3.1, offY: 0.8, offF: 1.6,
      lLx: -0.5, lRx: 0.4 }), 'snap'],
    [14, P({ sy: 0.7, sx: 1.26, bob: -1.6, lean: 0.34, headX: -0.3, aRx: -0.75, aRz: -0.15, aLx: -0.8, aLz: 0.2, swX: 2.55,
      offY: 0, offF: 2.4, lLx: -0.7, lRx: 0.6 }), 'in'],
    [21, P({ sy: 0.8, sx: 1.17, bob: -1.3, lean: 0.3, headX: -0.25, aRx: -0.65, aRz: -0.15, aLx: -0.75, aLz: 0.2, swX: 2.55,
      offF: 2.4, lLx: -0.7, lRx: 0.6 }), 'lin'],
    [25, P({ sy: 1.07, sx: 0.96, bob: 0.1, lean: 0.12, aRx: -0.9, aLx: -0.3, offF: 2.0, lLx: -0.3, lRx: 0.3 }), 'out'],
    [32, P({}), 'io'],
  ],
  hurt: [
    [0, P({ sy: 1.18, sx: 0.88, bob: 0.4, lean: -0.55, headX: -0.5, aLz: -1.2, aLx: -0.5, aRz: 1.1, aRx: -0.6, swX: 2.4, offF: -1.2,
      lLx: -0.35, lRx: 0.2 }), 'lin'],
    [5, P({ sy: 0.82, sx: 1.12, bob: -0.8, lean: -0.2, headX: 0.1, aLz: -0.7, aRz: 0.7, offF: -2.0, lLx: -0.3, lRx: 0.3 }), 'out'],
    [11, P({ sy: 1.04, sx: 0.98, lean: 0.06, offF: -2.0 }), 'io'],
    [22, P({ offF: 0 }), 'io'],
  ],
  death: [
    [0, P({ sy: 1.2, sx: 0.86, bob: 0.4, lean: -0.6, headX: -0.55, aLz: -1.3, aRz: 1.2, aRx: -0.5, swX: 2.4, offF: -1.4 }), 'lin'],
    [7, P({ sy: 0.9, sx: 1.08, bob: -0.5, lean: -0.25, headX: -0.2, aLz: -0.6, aRz: 0.6, offF: -2.4, lLx: 0.35, lRx: -0.3 }), 'out'],
    [18, P({ sy: 0.95, bob: -2.4, lean: 0.25, headX: 0.55, aLz: -0.25, aLx: 0.2, aRz: 0.35, aRx: 0.1, swX: 1.2, offF: -2.4,
      lLx: -1.35, lRx: -1.25, lLz: -0.2, lRz: 0.2 }), 'in'],
    [30, P({ sy: 0.97, bob: -2.5, lean: 0.35, headX: 0.7, aLz: -0.2, aRz: 0.3, swX: 1.2, offF: -2.4,
      lLx: -1.35, lRx: -1.25, lLz: -0.2, lRz: 0.2 }), 'lin'],
    [40, P({ sy: 1, bob: -2.5, pitch: 1.5, offY: 2.2, lean: 0.1, headX: 0.2, aLx: -2.6, aLz: -0.4, aRx: -2.5, aRz: 0.5, swX: 1.6,
      offF: -2.4, lLx: -0.2, lRx: -0.1 }), 'in'],
    [43, P({ sy: 0.82, sx: 1.15, bob: -2.5, pitch: 1.5, offY: 2.2, headX: 0.1, aLx: -2.8, aLz: -0.6, aRx: -2.7, aRz: 0.7, swX: 1.6,
      offF: -2.4, lLx: 0.1, lRx: 0.15 }), 'out'],
    [47, P({ sy: 1.02, sx: 1.0, bob: -2.5, pitch: 1.42, offY: 2.6, headX: 0.15, aLx: -2.75, aLz: -0.55, aRx: -2.65, aRz: 0.65, swX: 1.6,
      offF: -2.4, lLx: 0.05, lRx: 0.1 }), 'out'],
    [52, P({ sy: 1, bob: -2.5, pitch: 1.5, offY: 2.2, headX: 0.15, aLx: -2.8, aLz: -0.6, aRx: -2.7, aRz: 0.7, swX: 1.6,
      offF: -2.4, lLx: 0.1, lRx: 0.15 }), 'in'],
  ],
  spawn: [
    [0, P({ offY: 18, sy: 1.4, sx: 0.78, aLz: -0.4, aRz: 0.4, aLx: -0.3, headX: -0.3, lLy: 0.6, lRx: 0.4 }), 'lin'],
    [8, P({ offY: 0, sy: 1.45, sx: 0.76, aLz: -0.6, aRz: 0.6, headX: -0.3, lLy: 0.3 }), 'in'],
    [10, P({ sy: 0.6, sx: 1.32, bob: -1.4, lean: 0.25, aLz: -1.0, aRz: 1.0, aLx: -0.3, headX: 0.2, lLz: -0.35, lRz: 0.35 }), 'snap'],
    [15, P({ sy: 1.12, sx: 0.93, bob: 0.3, lean: -0.05, aLz: -0.3, aRz: 0.3 }), 'out'],
    [19, P({ sy: 0.97, sx: 1.02 }), 'io'],
    [23, P({ aRx: -1.35, aRz: 0.3, swX: 1.6, headY: 0.25, headX: 0.1 }), 'out'],
    [33, P({ aRx: -1.35, aRz: 0.3, swX: 1.6 - TAU, headY: 0.25, headX: 0.1 }), 'io'],
    [37, P({ aRx: -0.2, aRz: 0.22, swX: 2.3 - TAU, sy: 0.95, sx: 1.03, bob: -0.3 }), 'out'],
    [42, P({ swX: STANCE.swX - TAU }), 'io'],
  ],
};

function samplePose(keys, t, out) {
  let i = 0;
  while (i < keys.length - 1 && keys[i + 1][0] <= t) i++;
  const [t0, a] = keys[i];
  if (i === keys.length - 1) { Object.assign(out, a); return out; }
  const [t1, b, ease] = keys[i + 1];
  const u = E[ease](Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
  for (const c of CH) out[c] = a[c] + (b[c] - a[c]) * u;
  return out;
}

const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// deterministic value noise for flutter and blinks: no RNG stream consumed
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const noise = (t) => { const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f); return lerp(hash(i), hash(i + 1), u) * 2 - 1; };

/** Critically-ish damped spring on one angle, integrated per tick. */
class Spring {
  constructor(k, d) { this.k = k; this.d = d; this.v = 0; this.x = 0; }
  step(target) { this.v += (target - this.x) * this.k - this.v * this.d; this.x += this.v; return this.x; }
}

const SCARF_N = 5;          // points, including the anchor
const SCARF_L = 0.19;       // world units between points
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _m = new THREE.Matrix4();

export class HeroAnim {
  constructor(rig, { x = 0, z = 0, yaw = 0, floorY = 0 } = {}) {
    this.rig = rig;
    this.floorY = floorY;     // world height of the ground the hero stands on
    active = this;
    this.pose = new Interp({ x, z, yaw, ...STANCE, cloakU: 0, cloakL: 0, tip: 0 }).angle('yaw');
    this.state = 'loco';      // loco | attack | dash | hurt | death | spawn
    this.t = 0;               // ticks in the current state
    this.tick_ = 0;           // ticks since creation (idle clocks)
    this.step = 0;            // attack step
    this.dashLen = 10;
    this.hurtYaw = null;
    this.dead = false;
    this.phase = 0;           // run cycle phase, radians
    this.runW = 0;            // 0 idle .. 1 full run
    this.speed = 0;
    this.faceYaw = yaw;       // where the controller wants to face
    this.yawVel = 0;
    this.turnKick = 0;        // ticks left of a sharp-turn squash
    this.idleT = 0;           // ticks standing still (fidgets)
    this.blinkAt = 90;
    this.fade = { from: null, t: 0, len: 1 };
    this.work = { ...STANCE };
    this.last = { x, z };
    this.vel = { x: 0, z: 0 };
    this.cloakU = new Spring(0.22, 0.32);
    this.cloakL = new Spring(0.2, 0.26);
    this.tip = new Spring(0.28, 0.24);
    this.head = new Spring(0.35, 0.45);
    this.ghostN = 0;
    this.smear = -1;
    this.flashT = 0; this.flashColor = 'white'; this.flashLen = 1;
    this.scarf = Array.from({ length: SCARF_N }, () => ({ c: new THREE.Vector3(), p: new THREE.Vector3() }));
    this.scarfInit = false;
    this.snapped = new THREE.Vector3();
    rig.setFace('open');
  }

  // ---- one-shots --------------------------------------------------------------------------
  _enter(state, fadeLen) {
    this.fade.from = { ...this.pose.cur };
    this.fade.t = 0;
    this.fade.len = fadeLen;
    this.state = state;
    this.t = -1; // tick() advances to 0 on this same sim tick: call one-shots before anim.tick()
    this.smear = -1;
  }

  get busy() { return this.state !== 'loco' && this.state !== 'dash'; }
  /** true once the current attack may be interrupted by the next one */
  get canChain() { return this.state !== 'attack' || this.t >= ATTACKS[this.step].cancel; }

  attack(step = 0) {
    if (this.dead) return null;
    this.step = clamp(step | 0, 0, 2);
    this._enter('attack', 2);
    this.rig.setFace('open');
    return ATTACKS[this.step];
  }
  dash(ticks = 10) {
    if (this.dead) return;
    this.dashLen = Math.max(4, ticks | 0);
    this._enter('dash', 1);
    this.ghostN = 0;
    this._emit('hero:dash', {});
  }
  hurt(fromYaw = null) {
    if (this.dead) return;
    this.hurtYaw = fromYaw;
    this._enter('hurt', 1);
    this.rig.setFace('hurt');
    this._flash('white', 3);
  }
  die() {
    if (this.dead) return;
    this.dead = true;
    this._enter('death', 1);
    this.rig.setFace('hurt');
    this._flash('white', 4);
  }
  spawn() {
    this.dead = false;
    this._enter('spawn', 0);
    const c = this.pose.cur;
    this.pose.set({ ...KEYS.spawn[0][1], x: c.x, z: c.z, yaw: c.yaw, cloakU: 0, cloakL: 0, tip: 0 }); // up in the air from the first frame
    this.rig.setFace('open');
    this._flash('frost', 12);
    this.scarfInit = false;
  }
  reset(x = 0, z = 0, yaw = 0) {
    this.dead = false;
    this.state = 'loco'; this.t = 0; this.smear = -1;
    this.faceYaw = yaw; this.runW = 0; this.speed = 0;
    this.pose.set({ x, z, yaw, ...STANCE, cloakU: 0, cloakL: 0, tip: 0 });
    this.last = { x, z };
    this.rig.setFace('open');
    this.flashT = 0; this.rig.flash('white', 0);
    this.scarfInit = false;
    for (const g of this.rig.ghosts) g.group.visible = false;
  }

  _flash(color, ticks) { this.flashColor = color; this.flashT = ticks; this.flashLen = ticks; }
  _emit(name, extra) {
    const c = this.pose.cur;
    events.emit(name, { anim: this, x: c.x, z: c.z, yaw: c.yaw, ...extra });
  }

  // ---- per tick ---------------------------------------------------------------------------
  /** ctl: { x, z, face?, vx?, vz?, speed? } */
  tick(ctl = {}) {
    this.pose.snap();
    const c = this.pose.cur;
    const x = ctl.x ?? c.x, z = ctl.z ?? c.z;
    this.vel.x = ctl.vx ?? (x - this.last.x) / DT;
    this.vel.z = ctl.vz ?? (z - this.last.z) / DT;
    this.last.x = x; this.last.z = z;
    c.x = x; c.z = z;
    this.speed = ctl.speed ?? Math.hypot(this.vel.x, this.vel.z);
    if (ctl.face !== undefined && ctl.face !== null) this.faceYaw = ctl.face;
    else if (this.speed > 0.3 && ctl.speed === undefined) this.faceYaw = Math.atan2(this.vel.x, this.vel.z);
    this.tick_++;
    this.t++;
    this._tickState();
  }

  _tickState() {
    const c = this.pose.cur;
    const w = this.work;

    // facing: fast but never a pop. Big reversals get a squash so they read as a pivot.
    if (this.state !== 'death') {
      const d = wrap(this.faceYaw - c.yaw);
      const rate = this.state === 'attack' || this.state === 'dash' ? 0.7 : 0.5;
      let stepYaw = clamp(d * rate, -0.62, 0.62);
      if (Math.abs(d) < 0.02) stepYaw = d;
      if (Math.abs(d) > 2.3 && this.turnKick <= 0 && this.state === 'loco' && this.speed > 0.5) this.turnKick = 6;
      c.yaw = wrap(c.yaw + stepYaw);
      this.yawVel = stepYaw;
    } else this.yawVel = 0;
    if (this.turnKick > 0) this.turnKick--;

    // the main pose for this state
    let done = false;
    switch (this.state) {
      case 'loco': this._loco(w); break;
      case 'attack': {
        const a = ATTACKS[this.step];
        samplePose(KEYS[`attack${this.step}`], this.t, w);
        const k = this.t - a.windup;
        this.smear = k >= 0 && k < a.active ? k : -1;
        if (k === 0) this._emit('hero:swing', { step: this.step, attack: a });
        if (this.step === 2 && k === 3) this._emit('hero:slam', { step: 2 });
        if (this.t >= a.total) done = true;
        break;
      }
      case 'dash': done = this._dash(w); break;
      case 'hurt': {
        samplePose(KEYS.hurt, this.t, w);
        if (this.hurtYaw !== null) {
          // lean away from the hit, whichever side it came from
          const rel = wrap(this.hurtYaw - c.yaw);
          const back = Math.cos(rel), side = Math.sin(rel);
          const k = 1 - this.t / 22;
          w.lean = w.lean * back;
          w.offF *= back;
          w.roll += side * 0.35 * k;
        }
        if (this.t === 14) this.rig.setFace('open');
        if (this.t === 3) this._flash('red', 3);
        if (this.t >= 22) done = true;
        break;
      }
      case 'death':
        samplePose(KEYS.death, this.t, w);
        if (this.t === 4) this._flash('red', 4);
        if (this.t === 40) { this.rig.setFace('dead'); this._emit('hero:thud', {}); }
        if (this.t === 60) this._emit('hero:dead', {});
        break;
      case 'spawn':
        samplePose(KEYS.spawn, this.t, w);
        if (this.t === 9) this._emit('hero:land', {});
        if (this.t >= 42) { done = true; this._emit('hero:ready', {}); }
        break;
    }
    if (this.state !== 'loco') this.idleT = 0;

    // crossfade out of whatever the body was doing
    if (this.fade.from && this.fade.t < this.fade.len) {
      this.fade.t++;
      const u = E.out(this.fade.t / this.fade.len);
      for (const ch of CH) w[ch] = this.fade.from[ch] + (w[ch] - this.fade.from[ch]) * u;
    }

    // sharp-turn pivot squash and roll into turns (additive)
    if (this.turnKick > 0) {
      const k = Math.sin((this.turnKick / 6) * Math.PI);
      w.sy -= 0.12 * k; w.sx += 0.08 * k; w.lean -= 0.3 * k; w.bob -= 0.5 * k;
    }
    w.roll += clamp(-this.yawVel * 0.9 * (0.3 + this.runW), -0.3, 0.3);

    for (const ch of CH) c[ch] = w[ch];
    if (done) {
      // spins that ended a full turn round: fold back so the blend home does not unwind them
      for (const ch of ['swX', 'swY', 'swZ']) {
        const n = Math.round(c[ch] / TAU) * TAU;
        c[ch] -= n; this.pose.prev[ch] -= n;
      }
      this._enter('loco', 6);
    }

    this._secondary();
    if (this.flashT > 0) this.flashT--;
    this.rig.ageGhosts();
    if (this.state === 'dash' && this.t % 3 === 1 && this.t < this.dashLen) this._wantGhost = true;
  }

  _loco(w) {
    const c = this.pose.cur;
    const target = clamp(this.speed / RUN_SPEED, 0, 1.3);
    this.runW += (Math.min(1, target) - this.runW) * (target > this.runW ? 0.35 : 0.22);
    const rw = this.runW;
    const time = this.tick_ * DT;

    // idle: breathing (one texel), a slow weight shift, blinks, a look around now and then
    const br = Math.sin(time * TAU / 2.8);
    Object.assign(w, STANCE);
    w.bob = br * 0.25 - 0.1;
    w.sy = 1 + br * 0.015; w.sx = 1 - br * 0.008;
    w.aLz += br * 0.05; w.aRz -= br * 0.05;
    w.headX = -br * 0.05;
    w.swX = 0.3 + br * 0.04; w.swZ = -2.4; // idle: blade low, out to the side, trailing
    w.roll = Math.sin(time * TAU / 5.3) * 0.03;
    if (rw < 0.2) {
      this.idleT++;
      const f = this.idleT % 420; // every 7 s: look left, look right, back
      if (this.idleT > 240 && f > 300) {
        const u = (f - 300) / 120;
        w.headY = Math.sin(u * TAU) * 0.5 * Math.sin(u * Math.PI);
        w.tTwist = w.headY * 0.2;
      }
    } else this.idleT = 0;
    if (this.tick_ >= this.blinkAt) {
      const b = this.tick_ - this.blinkAt;
      this.rig.setFace(b < 7 ? 'blink' : 'open');
      if (b >= 7) this.blinkAt = this.tick_ + 120 + Math.floor(hash(this.tick_) * 170);
    }

    if (rw > 0.001) {
      // run: contact, down, passing, up. Phase advances with ground speed so feet do not skate.
      const prev = this.phase;
      const dphi = (Math.max(this.speed, 1.2 * rw) * DT / STRIDE) * TAU;
      this.phase = (this.phase + dphi) % TAU;
      // contact when a leg reaches its front extreme: phase PI/2 (L) and 3PI/2 (R)
      for (const [at, foot] of [[Math.PI / 2, 'L'], [Math.PI * 1.5, 'R']]) {
        const d = (at - prev + TAU) % TAU;
        if (d > 0 && d <= dphi && rw > 0.5) this._emit('hero:step', { foot, speed: this.speed });
      }
      const s = Math.sin(this.phase), cph = Math.cos(this.phase);
      const psi = this.phase * 2;
      const up = Math.cos(psi - 0.7);            // +1 at "up" (after passing), -1 at "down" (after contact)
      const R = {
        ...STANCE,
        bob: up * 0.75 - 0.2,
        sy: 1 + up * 0.07, sx: 1 - up * 0.035,
        lean: 0.3 + 0.06 * (1 - up),
        twist: s * 0.22, tTwist: -s * 0.3,
        headX: -0.22 - up * 0.05, headY: s * 0.08,
        lLx: -s * 0.95, lRx: s * 0.95,
        lLy: Math.max(0, cph) * 1.3, lRy: Math.max(0, -cph) * 1.3,
        aLx: s * 1.0, aLz: -0.28,
        aRx: -s * 0.5 - 0.15, aRz: 0.32,
        swX: 0.35 + s * 0.2, swZ: -2.75,
        roll: 0,
      };
      for (const ch of CH) w[ch] = w[ch] + (R[ch] - w[ch]) * rw;
      void c;
    }
  }

  _dash(w) {
    const n = this.dashLen, t = this.t;
    const D = P({ sy: 0.82, sx: 0.96, sz: 1.3, bob: -1.0, lean: 0.5, headX: -0.45, tTwist: 0,
      aLx: 1.3, aLz: -0.35, aRx: 1.1, aRz: 0.35, swX: 2.9, lLx: 0.75, lRx: 1.0, lLy: 1.2, lRy: 0.4 });
    const S = P({ sy: 0.84, sx: 1.12, sz: 0.9, bob: -0.9, lean: -0.25, headX: 0.1, aLz: -0.6, aRz: 0.6, aLx: -0.4, aRx: -0.5,
      lLx: -0.5, lRx: 0.35, offF: 0 });
    if (t < n) {
      Object.assign(w, D);
      // small stretch pulse on the first ticks, then hold the dive
      const k = Math.max(0, 1 - t / 3);
      w.sz += 0.15 * k; w.sy -= 0.05 * k;
      return false;
    }
    // skid out of it
    const u = (t - n) / 5;
    for (const ch of CH) w[ch] = D[ch] + (S[ch] - D[ch]) * E.snap(Math.min(1, u * 2));
    return t >= n + 5;
  }

  // cloth, hood tip, scarf, run on sim ticks
  _secondary() {
    const c = this.pose.cur;
    const rig = this.rig;
    const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
    const vF = this.vel.x * fx + this.vel.z * fz;
    const time = this.tick_ * DT;
    const lean = c.lean + c.pitch;
    const moving = clamp(Math.abs(vF) / RUN_SPEED, 0, 1.6);
    const vy = (c.offY + c.bob - (this._lastY ?? 0)) * V / DT;
    this._lastY = c.offY + c.bob;
    const flutter = noise(time * 3.1) * (0.06 + moving * 0.14);
    const upU = clamp(vF * 0.11, -0.2, 0.5) + lean * 0.85 + clamp(vy * 0.3, -0.2, 0.6) + flutter + 0.04;
    c.cloakU = this.cloakU.step(upU);
    c.cloakL = this.cloakL.step(clamp(this.cloakU.v * 2.5 + moving * 0.22, -0.3, 0.55) + noise(time * 4.3 + 7) * 0.1 * (0.4 + moving));
    c.tip = this.tip.step(-clamp(vF * 0.1, -0.3, 0.7) - clamp(vy * 0.25, -0.5, 0.5) + lean * 0.5 + noise(time * 2 + 3) * 0.05);

    // scarf: verlet in world space, pinned to the knot at the back of the neck
    this._poseRig(c);
    rig.group.updateMatrixWorld(true);
    rig.scarfAnchor.getWorldPosition(_v);
    const P0 = this.scarf;
    if (!this.scarfInit) {
      this.scarfInit = true;
      for (let i = 0; i < SCARF_N; i++) {
        P0[i].c.set(_v.x - fx * SCARF_L * i, Math.max(this.floorY + 0.05, _v.y - SCARF_L * i * 0.6), _v.z - fz * SCARF_L * i);
        P0[i].p.copy(P0[i].c);
        P0[i].o = P0[i].c.clone();
      }
    }
    for (const q of P0) { q.p.copy(q.c); }
    P0[0].c.copy(_v);
    // relative wind: the air the body moves through, plus a faint draught so it never hangs dead
    const windX = -this.vel.x * 0.0011 + noise(time * 1.7) * 0.0009 - fx * 0.0003;
    const windZ = -this.vel.z * 0.0011 + noise(time * 1.7 + 11) * 0.0009 - fz * 0.0003;
    for (let i = 1; i < SCARF_N; i++) {
      const q = P0[i];
      const vx = (q.c.x - q.o.x) * 0.9, vy2 = (q.c.y - q.o.y) * 0.9, vz = (q.c.z - q.o.z) * 0.9;
      q.o.copy(q.c);
      q.c.x += vx + windX * (0.6 + i * 0.25);
      q.c.y += vy2 - 0.0035 + Math.abs(noise(time * 5 + i)) * 0.0012 * moving;
      q.c.z += vz + windZ * (0.6 + i * 0.25);
    }
    for (let it = 0; it < 3; it++) {
      for (let i = 1; i < SCARF_N; i++) {
        const a = P0[i - 1].c, b = P0[i].c;
        _w.subVectors(b, a);
        const d = _w.length() || 1e-6;
        const k = (d - SCARF_L) / d;
        if (i === 1) b.addScaledVector(_w, -k);
        else { a.addScaledVector(_w, k * 0.5); b.addScaledVector(_w, -k * 0.5); }
      }
      for (let i = 1; i < SCARF_N; i++) {
        const q = P0[i].c;
        if (q.y < this.floorY + 0.04) q.y = this.floorY + 0.04;
        // stay behind the cloak while the body is upright
        if (c.pitch < 0.5 && q.y < this.floorY + 1.05) {
          const rx = q.x - c.x, rz = q.z - c.z;
          const f = rx * fx + rz * fz;
          const lim = -0.36 + (this.floorY + 1.05 - q.y) * 0.1 * c.cloakU;
          if (f > lim) { q.x -= (f - lim) * fx; q.z -= (f - lim) * fz; }
        }
      }
    }
    for (let i = 0; i < SCARF_N; i++) P0[i].c.y = Math.max(this.floorY + 0.04, P0[i].c.y);
  }

  /** Put the rig into pose p (world space x, z, yaw plus channels). Used at tick and render. */
  _poseRig(p, snap = false) {
    const r = this.rig;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    const px = p.x + fx * p.offF * V, pz = p.z + fz * p.offF * V, py = this.floorY + p.offY * V;
    r.root.position.set(px, py, pz);
    if (snap) look.snap(r.root.position);
    r.root.rotation.set(0, p.yaw, 0);
    r.body.scale.set(p.sx, p.sy, p.sz * p.sx);
    r.body.rotation.set(p.pitch, 0, 0);
    r.pelvis.position.y = (3 + p.bob) * V;
    r.pelvis.rotation.set(p.lean, p.twist, p.roll, 'YXZ');
    r.torso.rotation.set(p.tLean, p.tTwist, 0, 'YXZ');
    r.head.rotation.set(p.headX + (p.headLag ?? 0), p.headY, p.headZ, 'YXZ');
    r.armL.rotation.set(p.aLx, p.aLy, p.aLz, 'YXZ');
    r.armR.rotation.set(p.aRx, p.aRy, p.aRz, 'YXZ');
    r.sword.rotation.set(p.swX, p.swY, p.swZ);
    r.legL.rotation.set(p.lLx, 0, p.lLz);
    r.legR.rotation.set(p.lRx, 0, p.lRz);
    r.legL.position.y = p.lLy * V;
    r.legR.position.y = p.lRy * V;
    r.cloakU.rotation.x = p.cloakU;
    r.cloakL.rotation.x = p.cloakL;
    r.hoodTip.rotation.x = p.tip;
  }

  // ---- render -----------------------------------------------------------------------------
  render(alpha) {
    const p = this.pose.at(alpha);
    const r = this.rig;
    this._poseRig(p, true);

    // smear frame (held through hitstop because ticks stop)
    if (this.state === 'attack' && this.smear >= 0) {
      const a = ATTACKS[this.step];
      r.setSmear(a.smear, Math.min(SMEAR_FRAMES - 1, this.smear));
      r.smear.scale.x = a.mirror ? -1 : 1;
      r.smear.rotation.set(0, 0, a.smear === 'v' ? Math.PI / 2 : a.tilt);
    } else r.setSmear('h', -1);

    // hit flash: full, then a stepped falloff (no smooth fades)
    if (this.flashT > 0) r.flash(this.flashColor, this.flashT > this.flashLen / 2 ? 1 : 0.5);
    else r.flash(this.flashColor, 0);

    r.group.updateMatrixWorld(true);

    // scarf segments between interpolated points
    const S = this.scarf;
    _m.copy(r.group.matrixWorld).invert();
    for (let i = 0; i < r.scarf.length; i++) {
      const a = S[i], b = S[i + 1];
      const m = r.scarf[i];
      _v.lerpVectors(a.p, a.c, alpha);
      _w.lerpVectors(b.p, b.c, alpha);
      if (i === 0) r.scarfAnchor.getWorldPosition(_v);
      m.position.copy(_v).applyMatrix4(_m);
      m.updateMatrixWorld();
      m.lookAt(_w.x, _w.y, _w.z); // lookAt takes world coordinates
      m.visible = true;
    }

    if (this._wantGhost) {
      this._wantGhost = false;
      r.stampGhost(this.ghostN++);
    }
  }

  /** Snapshot for state() and debug. */
  info() {
    const c = this.pose.cur;
    return {
      anim: this.state === 'attack' ? ATTACKS[this.step].name : this.state === 'loco' ? (this.runW > 0.5 ? 'run' : 'idle') : this.state,
      state: this.state, t: this.t, step: this.step, yaw: +c.yaw.toFixed(3), face: this.rig.face,
      runW: +this.runW.toFixed(2), phase: +this.phase.toFixed(2), smear: this.smear, dead: this.dead,
    };
  }
}

// ---- debug hook: __GR.debug.hero(action?, arg?) ----------------------------------------------
// Acts on the most recently created HeroAnim. action: 'attack' (arg = step), 'dash' (arg = ticks),
// 'hurt' (arg = fromYaw), 'die', 'spawn', 'reset', 'scarf' (returns the tail's points). Any other action is offered to
// anim.onDebug (the showcase uses it for 'mode'). Always returns anim.info().
let active = null;
debug.add('hero', (action, arg) => {
  const a = active;
  if (!a) return { ok: false, error: 'no hero animator in this scene' };
  if (action === 'attack') a.attack(arg ?? 0);
  else if (action === 'dash') a.dash(arg ?? 10);
  else if (action === 'hurt') a.hurt(arg ?? null);
  else if (action === 'die') a.die();
  else if (action === 'spawn') a.spawn();
  else if (action === 'scarf') return a.scarf.map((q) => [q.c.x, q.c.y, q.c.z].map((v) => +v.toFixed(3)));
  else if (action === 'reset') a.reset(a.pose.cur.x, a.pose.cur.z, a.pose.cur.yaw);
  else if (action && a.onDebug) { const r = a.onDebug(action, arg); if (r !== undefined) return r; }
  return { ok: true, ...a.info() };
});
