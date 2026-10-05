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
//   'hero:skid'  {}                        dash travel ended, the braking skid starts (dust)
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
import { SMEAR_FRAMES, SMEAR_FADE } from './model.js';

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

// The body stays within about 30 degrees of the aim through the whole combo (twist + tTwist):
// the sword arm does the sweeping, the blade alternates sides, and each hit lunges forward
// (offF). The finisher is a hop: about 4 voxels up, the shadow stays on the floor, and it
// lands into a held squash.
const KEYS = {
  attack0: [
    [0, P({}), 'lin'],
    [2, P({ sy: 0.93, sx: 1.05, bob: -0.4, tTwist: 0.28, twist: 0.08, aRx: -1.0, aRy: 1.5, swX: 2.7, offF: -0.4, lLx: -0.2, lRx: 0.2 }), 'out'],
    [5, P({ sy: 0.86, sx: 1.09, bob: -0.8, lean: -0.14, tTwist: 0.42, twist: 0.12, aRx: -1.4, aRy: 2.35, aRz: 0.2, swX: 3.05, swZ: 0.35,
      aLx: -0.8, aLz: -0.7, headY: -0.15, offF: -0.9, lLx: -0.35, lRx: 0.3 }), 'out'],
    [7, P({ sy: 1.1, sx: 0.94, lean: 0.24, headX: -0.18, tTwist: -0.12, twist: -0.04, aRx: -1.5, aRy: 0.1, swX: 3.1, aLx: -0.1, aLz: -0.5,
      offF: 1.8, lLx: -0.55, lRx: 0.5, headY: 0.05 }), 'snap'],
    [9, P({ sy: 0.92, sx: 1.07, bob: -0.5, lean: 0.26, tTwist: -0.4, twist: -0.12, headX: -0.2, aRx: -1.25, aRy: -1.75, swX: 3.1, swZ: -0.2,
      aLx: 0.5, aLz: -0.75, offF: 2.4, lLx: -0.6, lRx: 0.55, headY: 0.12 }), 'out'],
    [13, P({ sy: 0.97, bob: -0.4, lean: 0.16, headX: -0.12, tTwist: -0.42, twist: -0.12, aRx: -0.95, aRy: -1.95, swX: 2.9, aLx: 0.4, aLz: -0.6,
      offF: 2.2, lLx: -0.5, lRx: 0.45, headY: 0.1 }), 'out'],
    [21, P({ offF: 0 }), 'io'],
  ],
  attack1: [
    [0, P({}), 'lin'],
    [4, P({ sy: 0.88, sx: 1.08, bob: -0.7, lean: -0.1, tTwist: -0.42, twist: -0.12, aRx: -1.55, aRy: -1.7, aRz: -0.2, swX: 3.0, swZ: -0.3,
      aLx: 0.35, aLz: -0.45, headY: 0.15, offF: -0.6, lLx: 0.3, lRx: -0.35 }), 'out'],
    [6, P({ sy: 1.1, sx: 0.94, lean: 0.22, headX: -0.18, tTwist: 0.12, aRx: -1.65, aRy: 0.35, swX: 3.1, aLx: 0.1, aLz: -0.55,
      offF: 1.8, lLx: 0.45, lRx: -0.55 }), 'snap'],
    [8, P({ sy: 0.92, sx: 1.06, bob: -0.5, lean: 0.25, headX: -0.2, tTwist: 0.4, twist: 0.12, aRx: -1.35, aRy: 2.0, swX: 3.1, swZ: 0.25,
      aLx: -0.3, aLz: -0.8, offF: 2.4, lLx: 0.5, lRx: -0.6, headY: -0.12 }), 'out'],
    [12, P({ sy: 0.97, bob: -0.4, lean: 0.15, headX: -0.12, tTwist: 0.42, twist: 0.12, aRx: -1.05, aRy: 2.15, swX: 2.9, aLx: -0.2, aLz: -0.6,
      offF: 2.2, lLx: 0.45, lRx: -0.5, headY: -0.1 }), 'out'],
    [20, P({ offF: 0 }), 'io'],
  ],
  attack2: [
    [0, P({}), 'lin'],
    [3, P({ sy: 0.74, sx: 1.18, bob: -1.4, lean: 0.14, aRx: -0.5, aLx: -0.4, swX: 2.4, lLx: -0.25, lRx: 0.25, offF: -0.4 }), 'out'],
    [6, P({ sy: 1.22, sx: 0.86, bob: 0.3, offY: 3.0, lean: -0.2, headX: -0.2, aRx: -2.7, aRz: -0.25, swX: 3.2, aLx: -2.6, aLz: 0.3,
      offF: 0.4, lLx: -0.5, lRx: 0.45, lLy: 0.8, lRy: 0.4 }), 'out'],
    [10, P({ sy: 1.12, sx: 0.92, bob: 0.4, offY: 4.2, lean: -0.32, tTwist: 0.08, headX: -0.25,
      aRx: -3.35, aRz: -0.32, swX: 3.2, aLx: -3.2, aLz: 0.36, offF: 1.0, lLx: -0.55, lRx: 0.3, lLy: 1.0, lRy: 0.6 }), 'io'],
    [12, P({ sy: 1.08, lean: 0.3, headX: -0.2, aRx: -1.6, aRz: -0.2, aLx: -1.6, aLz: 0.25, swX: 3.1, offY: 2.0, offF: 2.0,
      lLx: -0.5, lRx: 0.4 }), 'snap'],
    [13, P({ sy: 0.68, sx: 1.28, bob: -1.5, lean: 0.3, headX: -0.25, aRx: -0.75, aRz: -0.15, aLx: -0.8, aLz: 0.2, swX: 2.55,
      offY: 0, offF: 2.6, lLx: -0.7, lRx: 0.6 }), 'in'],
    [16, P({ sy: 0.7, sx: 1.25, bob: -1.5, lean: 0.3, headX: -0.25, aRx: -0.7, aRz: -0.15, aLx: -0.78, aLz: 0.2, swX: 2.55,
      offF: 2.6, lLx: -0.7, lRx: 0.6 }), 'lin'],
    [22, P({ sy: 0.82, sx: 1.15, bob: -1.2, lean: 0.26, headX: -0.2, aRx: -0.65, aRz: -0.15, aLx: -0.75, aLz: 0.2, swX: 2.55,
      offF: 2.6, lLx: -0.65, lRx: 0.55 }), 'out'],
    [25, P({ sy: 1.07, sx: 0.96, bob: 0.1, lean: 0.1, aRx: -0.9, aLx: -0.3, offF: 2.2, lLx: -0.3, lRx: 0.3 }), 'out'],
    [32, P({}), 'io'],
  ],
  // hurt: a jolt, then a lean away from the blow held for 6 ticks, then the recovery.
  // lean is "back"; tick() turns it away from the hit's direction.
  hurt: [
    [0, P({ sy: 1.16, sx: 0.88, bob: 0.4, lean: -0.55, headX: -0.5, aLz: -1.2, aLx: -0.5, aRz: 1.1, aRx: -0.6, swX: 2.4, offF: -1.2,
      lLx: -0.35, lRx: 0.2 }), 'lin'],
    [2, P({ sy: 0.84, sx: 1.12, bob: -0.8, lean: -0.42, headX: -0.15, aLz: -0.9, aRz: 0.85, aLx: -0.3, offF: -2.2, lLx: -0.4, lRx: 0.4 }), 'snap'],
    [8, P({ sy: 0.88, sx: 1.08, bob: -0.6, lean: -0.36, headX: -0.1, aLz: -0.75, aRz: 0.7, offF: -2.4, lLx: -0.35, lRx: 0.35 }), 'lin'],
    [13, P({ sy: 1.05, sx: 0.97, lean: 0.06, offF: -2.4 }), 'out'],
    [22, P({ offF: 0 }), 'io'],
  ],
  death: [
    [0, P({ sy: 1.2, sx: 0.86, bob: 0.4, lean: -0.6, headX: -0.55, aLz: -1.3, aRz: 1.2, aRx: -0.5, swX: 2.4, offF: -1.4 }), 'lin'],
    [7, P({ sy: 0.9, sx: 1.08, bob: -0.5, lean: -0.25, headX: -0.2, aLz: -0.6, aRz: 0.6, offF: -2.4, lLx: 0.35, lRx: -0.3 }), 'out'],
    [18, P({ sy: 0.95, bob: -2.0, lean: 0.25, headX: 0.55, aLz: -0.25, aLx: 0.2, aRz: 0.35, aRx: 0.1, swX: 1.2, offF: -2.4,
      lLx: -1.35, lRx: -1.25, lLz: -0.2, lRz: 0.2 }), 'in'],
    [30, P({ sy: 0.97, bob: -2.1, lean: 0.35, headX: 0.7, aLz: -0.2, aRz: 0.3, swX: 1.2, offF: -2.4,
      lLx: -1.35, lRx: -1.25, lLz: -0.2, lRz: 0.2 }), 'lin'],
    [40, P({ sy: 1, bob: -2.5, pitch: 1.5, offY: 2.4, lean: 0.1, headX: 0.2, aLx: -2.6, aLz: -0.4, aRx: -2.5, aRz: 0.5, swX: 1.6,
      offF: -2.4, lLx: -0.2, lRx: -0.1 }), 'in'],
    [42, P({ sy: 0.8, sx: 1.16, bob: -2.5, pitch: 1.5, offY: 2.2, headX: 0.1, aLx: -2.8, aLz: -0.6, aRx: -2.7, aRz: 0.7, swX: 1.6,
      offF: -2.4, lLx: 0.1, lRx: 0.15 }), 'out'],
    [46, P({ sy: 1.04, sx: 0.98, bob: -2.5, pitch: 1.3, offY: 4.0, headX: 0.25, aLx: -2.6, aLz: -0.5, aRx: -2.5, aRz: 0.6, swX: 1.6,
      offF: -2.4, lLx: -0.1, lRx: 0.2 }), 'out'],
    [50, P({ sy: 0.9, sx: 1.08, bob: -2.5, pitch: 1.5, offY: 2.2, headX: 0.15, aLx: -2.8, aLz: -0.6, aRx: -2.7, aRz: 0.7, swX: 1.6,
      offF: -2.4, lLx: 0.1, lRx: 0.15 }), 'in'],
    [54, P({ sy: 1, bob: -2.5, pitch: 1.5, offY: 2.2, headX: 0.15, aLx: -2.8, aLz: -0.6, aRx: -2.7, aRz: 0.7, swX: 1.6,
      offF: -2.4, lLx: 0.1, lRx: 0.15 }), 'out'],
  ],
  spawn: [
    [0, P({ offY: 18, sy: 1.35, sx: 0.8, aLz: -0.4, aRz: 0.4, aLx: -0.3, headX: -0.3, lLy: 0.6, lRx: 0.4 }), 'lin'],
    [8, P({ offY: 0, sy: 1.4, sx: 0.8, aLz: -0.6, aRz: 0.6, headX: -0.3, lLy: 0.3 }), 'in'],
    [10, P({ sy: 0.66, sx: 1.28, bob: -1.2, lean: 0.05, aLz: -1.0, aRz: 1.0, aLx: -0.3, headX: -0.05, lLz: -0.35, lRz: 0.35 }), 'snap'],
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

const CLOTH0 = { capeA: 0, capeB: 0, capeC: 0, capeRoll: 0, tip: -0.7, tip2: -0.4 };

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
    this.pose = new Interp({ x, z, yaw, ...STANCE, ...CLOTH0 }).angle('yaw');
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
    this.capeA = new Spring(0.2, 0.3);
    this.capeB = new Spring(0.24, 0.26);
    this.capeC = new Spring(0.28, 0.22);
    this.tip = new Spring(0.24, 0.24);
    this.tip2 = new Spring(0.3, 0.2);
    this.head = new Spring(0.35, 0.45);
    this.ghostN = 0;
    this.capeKick = 0;
    this.capeRollV = 0;
    this.smear = -1;
    this.smearShow = null;     // { kind, frame, mirror, roll, age }: what render draws (lingers past the active ticks)
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
    this.capeKick = 0.5;
    this._emit('hero:dash', {});
  }
  hurt(fromYaw = null) {
    if (this.dead) return;
    this.hurtYaw = fromYaw;
    this._enter('hurt', 1);
    this.capeKick = 0.55;
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
    this._holdSword();
    const c = this.pose.cur;
    this.pose.set({ ...KEYS.spawn[0][1], x: c.x, z: c.z, yaw: c.yaw, ...CLOTH0 }); // up in the air from the first frame
    this.rig.setFace('open');
    this._flash('frost', 12);
    this.scarfInit = false;
  }
  reset(x = 0, z = 0, yaw = 0) {
    this.dead = false;
    this.state = 'loco'; this.t = 0; this.smear = -1; this.smearShow = null; this.capeKick = 0;
    this._holdSword();
    this.faceYaw = yaw; this.runW = 0; this.speed = 0;
    this.pose.set({ x, z, yaw, ...STANCE, ...CLOTH0 });
    this.last = { x, z };
    this.rig.setFace('open');
    this.flashT = 0; this.rig.flash('white', 0);
    this.scarfInit = false;
    for (const g of this.rig.ghosts) g.group.visible = false;
  }

  _ageSmear() {
    const sm = this.smearShow;
    if (!sm || this.smear >= 0) return;
    if (this.state !== 'attack' && this.state !== 'loco') { this.smearShow = null; return; }
    sm.age++;
    // after the last active frame: hold it 2 ticks, rim 3 ticks, hairline 2 ticks
    if (sm.age <= 2) sm.frame = SMEAR_FRAMES - 1;
    else if (sm.age <= 5) sm.frame = SMEAR_FRAMES;
    else if (sm.age <= 7 && SMEAR_FADE > 1) sm.frame = SMEAR_FRAMES + 1;
    else this.smearShow = null;
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
        this.smear = k >= 0 && k < a.active ? k : -1;   // combat's hitbox reads this: active ticks only
        if (this.smear >= 0) this.smearShow = { kind: a.smear, frame: Math.min(SMEAR_FRAMES - 1, k), mirror: a.mirror, tilt: a.tilt, age: 0 };
        if (k === 0) { this._emit('hero:swing', { step: this.step, attack: a }); this.capeKick = this.step === 2 ? 0.2 : 0.4; }
        if (this.step === 2 && k === 3) this._emit('hero:slam', { step: 2 });
        if (this.t >= a.total) done = true;
        break;
      }
      case 'dash': done = this._dash(w); break;
      case 'hurt': {
        samplePose(KEYS.hurt, this.t, w);
        if (this.hurtYaw !== null) {
          // lean away from the hit, whichever side it came from: the keyed lean is "back",
          // so split it into pitch (front/back) and roll (sides) by the blow's direction
          const rel = wrap(this.hurtYaw - c.yaw);
          const back = Math.cos(rel), side = Math.sin(rel);
          const L = w.lean;
          w.lean = L * back;
          w.roll -= L * side;
          w.offF *= back;
          w.headZ = -w.headX * side * 0.5;
        }
        if (this.t === 14) this.rig.setFace('open');
        if (this.t === 3) this._flash('red', 3);
        if (this.t >= 22) done = true;
        break;
      }
      case 'death':
        samplePose(KEYS.death, this.t, w);
        if (this.t === 4) this._flash('red', 4);
        if (this.t === 40) { this.rig.setFace('dead'); this._emit('hero:thud', {}); this.swordDrop = { t: 0, need: true }; }
        if (this.swordDrop) this.swordDrop.t++;
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

    this._ageSmear();
    this._secondary();
    if (this.flashT > 0) this.flashT--;
    this.rig.ageGhosts();
    if (this.state === 'dash' && this.t >= 2 && this.t % 2 === 0 && this.t <= this.dashLen - 4) this._wantGhost = true; // none near the end: the skid stays clean
  }

  _loco(w) {
    const c = this.pose.cur;
    const target = clamp(this.speed / RUN_SPEED, 0, 1.3);
    this.runW += (Math.min(1, target) - this.runW) * (target > this.runW ? 0.35 : 0.22);
    const rw = this.runW;
    const time = this.tick_ * DT;

    // idle: breathing (one texel), a slow weight shift, blinks, a look around now and then
    // breathing on a 1.6 s period: the shoulders and hood rise a voxel, the head lags a beat
    const br = Math.sin(time * TAU / 1.6);
    const brLag = Math.sin(time * TAU / 1.6 - 0.9);
    Object.assign(w, STANCE);
    w.bob = br * 0.55 - 0.2;
    w.sy = 1 + br * 0.03; w.sx = 1 - br * 0.015;
    w.aLz += br * 0.08; w.aRz -= br * 0.08;
    w.headX = -brLag * 0.07;
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
        lean: 0.24 + 0.06 * (1 - up),
        twist: s * 0.22, tTwist: -s * 0.3,
        headX: -0.38 - up * 0.05, headY: s * 0.08,
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
    // 2-tick launch crouch, then the body stretched 1.4x along travel with the head kept up
    // (the face stays readable), then a 5-tick braking skid into a crouch.
    const C = P({ sy: 0.8, sx: 1.1, sz: 0.95, bob: -1.1, lean: 0.18, headX: -0.15, aLx: 0.6, aLz: -0.4, aRx: 0.5, aRz: 0.4, swX: 2.6,
      lLx: -0.4, lRx: 0.4 });
    const D = P({ sy: 0.86, sx: 0.9, sz: 1.42, bob: -0.6, lean: 0.3, headX: -0.32, tTwist: 0,
      aLx: 1.25, aLz: -0.35, aRx: 1.05, aRz: 0.35, swX: 2.9, lLx: 0.85, lRx: -0.6, lLy: 1.0, lRy: 0.2 });
    const S = P({ sy: 0.8, sx: 1.14, sz: 0.92, bob: -1.1, lean: -0.28, headX: 0.12, aLz: -0.75, aRz: 0.7, aLx: -0.5, aRx: -0.6,
      lLx: -0.6, lRx: 0.4, offF: 0 });
    if (t < 2) { Object.assign(w, C); return false; }
    if (t < n) {
      const k = Math.min(1, (t - 1) / 2);
      for (const ch of CH) w[ch] = C[ch] + (D[ch] - C[ch]) * E.snap(k);
      return false;
    }
    if (t === n) this._emit('hero:skid', {});
    const u = (t - n) / 5;
    for (const ch of CH) w[ch] = D[ch] + (S[ch] - D[ch]) * E.snap(Math.min(1, u * 2.5));
    return t >= n + 5;
  }

  _holdSword() {
    const r = this.rig;
    this.swordDrop = null;
    if (r.sword.parent !== r.armR) {
      r.armR.add(r.sword);
      r.sword.position.set(0, -2.5 * V, 0);
      r.sword.rotation.set(STANCE.swX, 0, 0);
    }
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
    // cape: three panels, each one a spring on its angle to the panel above. The top panel
    // follows drag (forward speed), lean and vertical speed; each lower panel adds its own
    // lift and lags the one above it, so a burst of speed travels down the cape as a wave.
    const idle = clamp(1 - moving, 0, 1);
    const flutter = noise(time * 3.1) * (0.05 + moving * 0.14);
    const sway = Math.sin(time * TAU / 1.6 + 0.8) * 0.05 * idle;       // the hem never hangs dead
    const lying = clamp((c.pitch - 0.4) / 0.8, 0, 1);
    const kick = this.capeKick; this.capeKick *= 0.7;
    let tA = clamp(vF * 0.085, -0.15, 0.5) + lean * 0.3 + clamp(vy * 0.3, -0.25, 0.7) + flutter + 0.06 + kick;
    let tB = clamp(moving * 0.24, 0, 0.42) - this.capeA.v * 1.6 + noise(time * 4.3 + 7) * 0.08 * (0.4 + moving) + sway + kick * 0.6;
    let tC = clamp(moving * 0.3, 0, 0.5) - this.capeB.v * 1.8 + noise(time * 5.7 + 2) * 0.12 * (0.5 + moving) + sway * 1.6 + kick * 0.4;
    if (lying > 0) {
      // lying face down: the cape settles over the back, slowly
      tA = lerp(tA, 0.1, lying); tB = lerp(tB, -0.05, lying); tC = lerp(tC, -0.1, lying);
    }
    const soft = this.dead && this.t > 40 ? 0.35 : 1;
    this.capeA.k = 0.2 * soft; this.capeB.k = 0.24 * soft; this.capeC.k = 0.28 * soft;
    c.capeA = this.capeA.step(tA);
    c.capeB = this.capeB.step(tB);
    c.capeC = this.capeC.step(tC);
    // a sideways swing of the cape when turning (it lags the body's yaw)
    c.capeRoll = clamp(this.yawVel * 1.6 + this.capeRollV, -0.45, 0.45);
    this.capeRollV = (this.capeRollV ?? 0) * 0.85 + this.yawVel * 0.4;
    // hood point: droops behind at rest, streams level when running, flicks on jumps
    const tipT = -0.72 + clamp(vF * 0.1, -0.2, 0.42) - clamp(vy * 0.25, -0.5, 0.5) - lean * 0.6 + noise(time * 2 + 3) * 0.06
      + Math.sin(time * TAU / 1.6) * 0.04 * idle;
    c.tip = this.tip.step(tipT);
    c.tip2 = this.tip2.step(-0.4 - this.tip.v * 2.2 + clamp(vF * 0.04, -0.1, 0.2) + noise(time * 3.7 + 5) * 0.1 * (0.3 + moving));

    // scarf: verlet in world space, pinned to the knot at the back of the neck
    this._poseRig(c);
    rig.group.updateMatrixWorld(true);
    const sd = this.swordDrop;
    if (sd && sd.need) {
      // the sword leaves the hand on the thud and skitters away across the floor
      sd.need = false;
      rig.sword.getWorldPosition(_v);
      sd.x = _v.x; sd.z = _v.z; sd.y = _v.y;
      const a = c.yaw + 0.7;
      sd.dx = Math.sin(a); sd.dz = Math.cos(a); sd.yaw = c.yaw + 1.2;
      rig.group.attach(rig.sword);
    }
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
    // plus a draught toward the off-hand side, so at rest the tail shows beside the body
    const side = 0.0009 * (1 - clamp(moving, 0, 1) * 0.6);
    const windX = -this.vel.x * 0.0011 + noise(time * 1.7) * 0.0009 - fx * 0.00015 - fz * side;
    const windZ = -this.vel.z * 0.0011 + noise(time * 1.7 + 11) * 0.0009 - fz * 0.00015 + fx * side;
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
          if (Math.abs(rx * fz - rz * fx) > 0.34 && f < 0.1) continue; // beside the body: hangs free
          const lim = -0.4 + (this.floorY + 1.05 - q.y) * 0.1 * Math.max(0, c.capeA);
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
    if (!this.swordDrop) r.sword.rotation.set(p.swX, p.swY, p.swZ);
    r.legL.rotation.set(p.lLx, 0, p.lLz);
    r.legR.rotation.set(p.lRx, 0, p.lRz);
    r.legL.position.y = p.lLy * V;
    r.legR.position.y = p.lRy * V;
    r.capeA.rotation.set(p.capeA, 0, p.capeRoll ?? 0);
    r.capeB.rotation.x = p.capeB;
    r.capeC.rotation.set(p.capeC, 0, -(p.capeRoll ?? 0) * 0.6);
    r.hoodTip.rotation.x = p.tip;
    r.hoodTip2.rotation.x = p.tip2;
  }

  // ---- render -----------------------------------------------------------------------------
  render(alpha) {
    const p = this.pose.at(alpha);
    const r = this.rig;
    this._poseRig(p, true);

    // smear frame (held through hitstop because ticks stop). It lingers after the active
    // ticks: the last arc holds, then thins to its rim and a hairline (see _ageSmear).
    const sm = this.smearShow;
    if (sm) {
      r.setSmear(sm.kind, sm.frame);
      r.smear.scale.x = sm.mirror ? -1 : 1;
      // the overhead's arc is tilted off the vertical plane so it never goes edge-on to the camera
      r.smear.rotation.set(0, 0, sm.kind === 'v' ? Math.PI / 2 - 0.62 : sm.tilt);
    } else r.setSmear('h', -1);

    // hit flash: full, then a stepped falloff (no smooth fades)
    if (this.flashT > 0) r.flash(this.flashColor, this.flashT > this.flashLen / 2 ? 1 : 0.5);
    else r.flash(this.flashColor, 0);

    const sd = this.swordDrop;
    if (sd && !sd.need) {
      // slides 3 voxels, one hop, settles flat; spins a little as it goes
      const u = clamp((sd.t - 1 + alpha) / 9, 0, 1), e = E.out(u);
      const hop = Math.sin(clamp(u * 1.6, 0, 1) * Math.PI) * 1.5 * V;
      r.sword.position.set(sd.x + sd.dx * 3 * V * e, lerp(sd.y, this.floorY + 0.5 * V, E.out(clamp(u * 2, 0, 1))) + hop, sd.z + sd.dz * 3 * V * e);
      look.snap(r.sword.position);
      r.sword.rotation.set(Math.PI / 2, sd.yaw + e * 0.9, 0, 'YXZ');
    }
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
