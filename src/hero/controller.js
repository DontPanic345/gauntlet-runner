// How the hooded runner moves (piece `movement`): acceleration and friction, 8-way movement
// with smooth facing, a buffered dash with i-frames, cooldown and afterimages, wall sliding,
// a corner assist, and the aim vector combat reads.
//
//   import { HeroController, MOVE } from './hero/controller.js';
//   const ctl = new HeroController({ x, z, yaw, anim, collision });   // anim: HeroAnim (optional)
//   // every sim tick (after combat has called ctl.attack(...) if it wants to swing):
//   ctl.tick();              // reads input, moves, collides, then ticks the animator
//   // every render frame:
//   ctl.at(alpha)            // interpolated {x, z}; anim.render(alpha) is still yours to call
//
//   ctl.x, ctl.z, ctl.vx, ctl.vz, ctl.speed    position (units) and velocity (units/s)
//   ctl.face                 yaw the hero wants to look along (0 = +z, screen down)
//   ctl.aim                  {x, z} unit vector: attacks go here (cursor if the mouse moved
//                            in the last 2 s, else the facing direction). ctl.aimSource: 'mouse'|'facing'
//   ctl.state                'move' | 'dash' | 'attack' | 'stun'
//   ctl.invulnerable         true during the dash's i-frames (and ctl.iframes(n) grants)
//   ctl.dashReady            cooldown over
//
//   ctl.attack(step)         start an attack through the animator and lock movement for its
//                            windup and active ticks; recovery can be cancelled by a dash.
//                            Returns ATTACKS[step] (or null if it could not start).
//   ctl.lockAttack(a)        same lock without the animator: a = {windup, active, recover}
//   ctl.impulse(vx, vz)      knockback: added to velocity, friction bleeds it off
//   ctl.stun(ticks)          ignore movement input for n ticks (hurt flinch)
//   ctl.iframes(ticks)       extra invulnerability (e.g. after a hit)
//   ctl.teleport(x, z, yaw?) move without interpolation or collision sweep
//   ctl.source = src         input source: anything with move(), consume(a), buffered(a)
//                            (default: core/input.js). The showcase autopilot swaps this.
//
// Events (core/events.js), payload always has { ctl, x, z }:
//   'move:start'      left a standstill            'move:stop'   came to rest
//   'move:turn'       sharp reversal while running  { yaw }
//   'move:dash'       dash started { dx, dz }       'move:dashEnd' { dx, dz }
//   'move:dashReady'  cooldown finished            'move:bonk'   dash hit a wall head-on { nx, nz }
//
// All numbers are in MOVE, so boons can change them (MOVE is the default; pass
// { tuning: {...} } to override per controller).

import { DT, Interp } from '../core/loop.js';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { display } from '../core/display.js';
import { debug } from '../core/debug.js';
import { getCollision } from '../core/collision.js';
import { ATTACKS } from './anim.js';
import * as THREE from 'three';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { VOXEL } from '../render/voxel/index.js';
import { vfx } from '../vfx/vfx.js';

/** Movement's own effects. Set a flag false to hand that effect to another piece. */
export const MOVE_FX = {
  streak: true,         // the dash streak (DashStreak below)
  turnDust: true,       // a dust kick on a sharp reversal (vfx.dust)
  stopDust: true,       // a small skid puff when a full-speed run stops (vfx.dust)
  landDust: true,       // the dash's landing skid: dust thrown forward and out as it plants (vfx.dust)
};

export const MOVE = {
  speed: 4.2,           // top run speed, units/s (the run cycle in hero/anim.js is tuned to it)
  radius: 0.3,          // body radius, units (the hood is 7 voxels wide)
  accel: 0.55,          // fraction of the speed gap closed per tick when speeding up: 90% on tick 3
  decel: 0.5,           // ... when slowing down (release): at rest on tick 4
  turn: 0.62,           // ... when the new direction opposes the current velocity
  snapGap: 0.35,        // units/s: a remaining gap smaller than this closes at once (no creeping tail)
  dashTicks: 10,        // dash length in ticks: dashFlat ticks at full speed, then a short brake
  dashFlat: 7,          // ticks held at peak speed (the burst covers ~90% of the distance here)
  dashBrake: [0.5, 0.26, 0.12], // per-tick speed (fraction of peak) for the braking ticks after the flat part
  dashDist: 4.0,        // units covered by the dash itself (peak ~30 u/s)
  dashIframes: 10,      // invulnerable for the first n ticks of the dash
  dashCooldown: 14,     // ticks after the dash ends before the next one
  dashBuffer: 8,        // ticks a dash press stays alive (longer if pressed during cooldown: see dashHold)
  dashHold: 30,         // a press during a dash or its cooldown is held until it can fire, up to this many ticks
  dashRecover: 4,       // ticks after the dash where run speed is capped (the plant / recovery pose)
  dashRecoverMove: 0.35,// ... to this fraction of run speed
  dashExit: 0.35,       // exit speed as a fraction of run speed when a direction is held
  dashExitIdle: 0.25,   // ... when nothing is held (it then skids to a stop)
  dashBumpCooldown: 6,  // cooldown after a dash that could not move at all (into a wall)
  attackMove: 0.12,     // move-speed factor during attack windup and active ticks
  recoverMove: 0.45,    // ... during attack recovery
  lunge: 2.2,           // units/s forward push on the first active tick of a swing
  cornerAssist: 0.34,   // units: slip round an edge if moving sideways this far clears it
  turnKick: 2.4,        // rad: a reversal this sharp while running emits move:turn
  rollOff: 0.6,         // fraction of run speed: tangential push off a round pillar hit dead-on
  slideKeep: 0.9,       // wall slide: tangential speed is raised toward this fraction of run speed
};

const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const len = Math.hypot;

/**
 * Per-tick dash speeds (units/s): flat at peak for dashFlat ticks, then the dashBrake fractions,
 * summing to dashDist. Flat-then-brake reads as one burst (most of the ground goes in the
 * first 6 ticks, one 10 fps frame) instead of a fast run that fades.
 */
export function dashProfile(T) {
  const n = Math.max(1, T.dashTicks | 0);
  const brake = T.dashBrake ?? [];
  const shape = Array.from({ length: n }, (_, t) => (t < T.dashFlat ? 1 : brake[t - T.dashFlat] ?? brake[brake.length - 1] ?? 0.2));
  const sum = shape.reduce((a, b) => a + b, 0);
  const peak = T.dashDist / DT / sum;
  return shape.map((k) => peak * k);
}

let active = null;

export class HeroController {
  constructor({ x = 0, z = 0, yaw = 0, anim = null, collision = null, source = input, tuning = null } = {}) {
    this.T = { ...MOVE, ...(tuning || {}) };
    this.anim = anim;
    this._collision = collision;
    this.source = source;
    this.body = { x, z, r: this.T.radius };
    this.pos = new Interp({ x, z });
    this.vx = 0; this.vz = 0;
    this.face = yaw;
    this.moveYaw = yaw;
    this.aim = { x: Math.sin(yaw), z: Math.cos(yaw) };
    this.aimSource = 'facing';
    this.state = 'move';
    this.t = 0;                   // ticks in the current state
    this.dash = null;             // {dx, dz, speeds}
    this.cooldown = 0;
    this.dashQ = 0;               // ticks a queued dash press stays alive
    this.iframeT = 0;
    this.atk = null;              // {windup, active, recover, total, t}
    this.stunT = 0;
    this.moving = false;
    this.contact = null;          // last wall normal [nx, nz] this tick, or null
    this.sliding = false;
    this.assist = 0;              // corner-assist nudge this tick (units)
    this.wish = { x: 0, z: 0 };   // input direction this tick
    this.recoverT = 0;            // ticks left of the post-dash plant (speed capped)
    this.rollSide = 0;            // side chosen to roll off a round pillar (kept while in contact)
    this.dashFrom = null;         // {x, z} where the current / last dash started (for the streak)
    this.fx = null;               // DashStreak, made on the first dash when there is a rig
    this.tick_ = 0;
    // honest numbers for the showcase: ticks from input to 90% speed, and release to rest
    this.meter = { startAt: -1, startTicks: 0, stopAt: -1, stopTicks: 0 };
    active = this;
  }

  get collision() { return this._collision ?? getCollision(); }
  set collision(w) { this._collision = w; }
  get x() { return this.body.x; }
  get z() { return this.body.z; }
  get speed() { return len(this.vx, this.vz); }
  get invulnerable() { return this.iframeT > 0; }
  get dashReady() { return this.cooldown <= 0 && this.state !== 'dash'; }
  /** In attack recovery (the part a dash may cancel)? */
  get recovering() { return !!this.atk && this.atk.t >= this.atk.windup + this.atk.active; }

  at(alpha) {
    const p = this.pos.at(alpha);
    if (this.fx) this.fx.render(p, this);
    return p;
  }

  teleport(x, z, yaw = this.face) {
    this.body.x = x; this.body.z = z;
    this.collision?.resolve(this.body);
    this.pos.set({ x: this.body.x, z: this.body.z });
    this.vx = 0; this.vz = 0; this.face = yaw; this.moveYaw = yaw;
    this.state = 'move'; this.dash = null; this.atk = null; this.t = 0; this.recoverT = 0;
    this.fx?.hide();
    this.anim?.reset(this.body.x, this.body.z, yaw);
  }

  impulse(vx, vz) { this.vx += vx; this.vz += vz; }
  stun(ticks) { this.stunT = Math.max(this.stunT, ticks | 0); if (this.state === 'attack') this._endAttack(); }
  iframes(ticks) { this.iframeT = Math.max(this.iframeT, ticks | 0); }

  /** Start an attack through the animator (combat calls this). Returns ATTACKS[step] or null. */
  attack(step = 0) {
    if (this.state === 'dash' || this.stunT > 0) return null;
    const a = this.anim ? this.anim.attack(step) : ATTACKS[step];
    if (!a) return null;
    this.lockAttack(a);
    return a;
  }
  lockAttack(a) {
    this.atk = { windup: a.windup, active: a.active, recover: a.recover, total: a.windup + a.active + a.recover, t: -1 };
    this.state = 'attack';
    this.t = -1;
    // swing where you aim; the body turns there fast (the animator's attack turn rate)
    this.face = Math.atan2(this.aim.x, this.aim.z);
  }
  _endAttack() { this.atk = null; if (this.state === 'attack') { this.state = 'move'; this.t = 0; } }

  // ---- per tick ------------------------------------------------------------------------
  tick() {
    const T = this.T;
    this.pos.snap();
    this.tick_++;
    this.t++;
    this.contact = null; this.sliding = false; this.assist = 0;
    const sp0 = this.speed;

    const src = this.source;
    let m = src.move();
    if (this.stunT > 0) { this.stunT--; m = { x: 0, z: 0 }; }
    if (this.anim && (this.anim.state === 'spawn' || this.anim.dead)) m = { x: 0, z: 0 };
    const ml = len(m.x, m.z);
    this.wish.x = m.x; this.wish.z = m.z;
    if (ml > 0.1) this.moveYaw = Math.atan2(m.x, m.z);

    this._updateAim();

    // attack bookkeeping
    if (this.atk) {
      this.atk.t++;
      if (this.atk.t === this.atk.windup) {
        // a small committed step into the swing
        this.vx += this.aim.x * T.lunge; this.vz += this.aim.z * T.lunge;
      }
      if (this.atk.t >= this.atk.total) this._endAttack();
    }

    // dash: buffered, and it cancels attack recovery
    if (src.consume('dash')) {
      // never drop a press: one made during a dash or its cooldown waits until the dash can fire
      const wait = this.state === 'dash' ? (T.dashTicks - this.t) + T.dashCooldown : this.cooldown;
      this.dashQ = Math.max(this.dashQ, Math.min(T.dashHold, Math.max(T.dashBuffer, wait + 2)));
    }
    const inWindup = this.state === 'attack' && !this.recovering;
    const canDash = this.cooldown <= 0 && this.state !== 'dash' && this.stunT <= 0 && !inWindup
      && !(this.anim && (this.anim.dead || this.anim.state === 'spawn'));
    if (this.dashQ > 0 && canDash) this._startDash(m, ml);
    else if (this.dashQ > 0 && !inWindup) this.dashQ--; // a press during windup is held until recovery starts

    if (this.cooldown > 0 && this.state !== 'dash') {
      this.cooldown--;
      if (this.cooldown === 0) this._emit('move:dashReady', {});
    }
    if (this.iframeT > 0) this.iframeT--;

    if (this.state === 'dash') this._tickDash(m, ml);
    else this._tickMove(m, ml);

    // facing
    if (this.state === 'dash') this.face = Math.atan2(this.dash.dx, this.dash.dz);
    else if (this.state === 'attack') { /* locked to the aim taken at the swing */ }
    else if (ml > 0.1) {
      // sliding along a wall: face the way the body actually goes, not into the stone
      this.face = this.sliding && this.speed > 1.2 ? Math.atan2(this.vx, this.vz) : this.moveYaw;
    }

    this.pos.cur.x = this.body.x; this.pos.cur.z = this.body.z;
    this._meter(ml, sp0);

    this.fx?.tick(this);
    if (this.anim) this.anim.tick({ x: this.body.x, z: this.body.z, face: this.face, vx: this.vx, vz: this.vz });
  }

  _updateAim() {
    const src = this.source;
    let ax = Math.sin(this.face), az = Math.cos(this.face);
    this.aimSource = 'facing';
    if (src === input && input.mouseActive() && input.mouse.inside && display.renderer) {
      const g = display.screenToGround(input.mouse.x, input.mouse.y, 0);
      if (g) {
        const dx = g.x - this.body.x, dz = g.z - this.body.z;
        const l = len(dx, dz);
        if (l > 0.2) { ax = dx / l; az = dz / l; this.aimSource = 'mouse'; this.aimDist = l; }
      }
    } else if (src.aim) {
      const a = src.aim(this);
      if (a) { const l = len(a.x, a.z) || 1; ax = a.x / l; az = a.z / l; this.aimSource = 'script'; }
    }
    this.aim.x = ax; this.aim.z = az;
  }

  _startDash(m, ml) {
    const T = this.T;
    let dx, dz;
    if (ml > 0.1) { dx = m.x / ml; dz = m.z / ml; }
    else { dx = Math.sin(this.face); dz = Math.cos(this.face); }
    this.dashQ = 0;
    // starting against a wall: run the dash along it if the input has any sideways part,
    // else a short bump (dust, recoil, a tiny shake) instead of a silent wasted dash
    const cw = this.collision;
    if (cw && cw.raycast(this.body.x, this.body.z, dx, dz, 0.2, this.body.r) < 0.06) {
      const probe = cw.move({ x: this.body.x, z: this.body.z, r: this.body.r }, dx * 0.1, dz * 0.1);
      const nx = probe.nx, nz = probe.nz;
      const into = dx * nx + dz * nz;
      const tx = dx - into * nx, tz = dz - into * nz, tl = len(tx, tz);
      if (probe.hit && tl > 0.3) { dx = tx / tl; dz = tz / tl; }
      else {
        if (this.atk) this.atk = null;
        this._emit('move:bonk', { nx: probe.hit ? nx : -dx, nz: probe.hit ? nz : -dz, start: true });
        feedback.kick(-dx, -dz * 0.77, 1.5);
        feedback.shake(1, 90);
        this.vx = -dx * 2.2; this.vz = -dz * 2.2;   // a one-voxel recoil, bled off by friction
        this.face = Math.atan2(dx, dz);
        this.cooldown = T.dashBumpCooldown;
        if (this.anim) this.anim.capeKick = 0.4;
        return;
      }
    }
    if (this.atk) this.atk = null;          // cancels the attack's recovery
    this.state = 'dash';
    this.t = 0;
    this.recoverT = 0;
    this.dash = { dx, dz, speeds: dashProfile(T) };
    this.dashFrom = { x: this.body.x, z: this.body.z };
    this.iframeT = Math.max(this.iframeT, T.dashIframes);
    this.face = Math.atan2(dx, dz);
    // the animator's skid starts when the brake does
    this.anim?.dash(Math.min(T.dashTicks, T.dashFlat + 1));
    if (!this.fx && MOVE_FX.streak && this.anim?.rig?.group) this.fx = new DashStreak(this.anim.rig.group);
    this.fx?.start(this);
    feedback.kick(dx, dz * 0.77, 2);        // a lurch along the dash (shared, settings-scaled channel)
    this._emit('move:dash', { dx, dz });
  }

  _tickDash(m, ml) {
    const T = this.T, d = this.dash;
    const v = d.speeds[Math.min(this.t, d.speeds.length - 1)];
    this.vx = d.dx * v; this.vz = d.dz * v;
    const want = v * DT;
    const res = this._move(this.vx * DT, this.vz * DT);
    // a head-on wall ends the dash early; a glancing one just slides
    if (res.hit && res.moved < want * 0.3) {
      this._emit('move:bonk', { nx: res.nx, nz: res.nz });
      feedback.kick(-d.dx, -d.dz * 0.77, 1.5);
      feedback.shake(1, 90);
      this._endDash(ml, m, 0.1);
      return;
    }
    if (res.hit) this._clipVelocity(res);
    if (this.t >= T.dashTicks - 1) this._endDash(ml, m);
  }

  _endDash(ml, m, exitScale = null) {
    const T = this.T, d = this.dash;
    // exit: plant (a few ticks at a capped speed, the animator's skid pose), then run on
    let k = ml > 0.1 ? T.dashExit : T.dashExitIdle;
    if (exitScale !== null) k = exitScale;
    const sp = T.speed * k;
    const hx = ml > 0.1 ? m.x / ml : d.dx, hz = ml > 0.1 ? m.z / ml : d.dz;
    this.vx = hx * sp; this.vz = hz * sp;
    this._emit('move:dashEnd', { dx: d.dx, dz: d.dz });
    this.fx?.end(this);
    if (MOVE_FX.landDust && exitScale === null) {
      vfx.dust(this.body.x + d.dx * 0.25, this.body.z + d.dz * 0.25, { dx: d.dx, dz: d.dz, n: 7, size: 1.1, spread: 1.0 });
    }
    this.state = 'move'; this.t = 0;
    this.recoverT = T.dashRecover;
    this.cooldown = T.dashCooldown;
  }

  _tickMove(m, ml) {
    const T = this.T;
    let scale = 1;
    if (this.atk) scale = this.recovering ? T.recoverMove : T.attackMove;
    if (this.recoverT > 0) { this.recoverT--; scale = Math.min(scale, T.dashRecoverMove); }
    const tx = m.x * T.speed * scale, tz = m.z * T.speed * scale;
    const gx = tx - this.vx, gz = tz - this.vz;
    const gap = len(gx, gz);
    if (gap > 0) {
      const tl = len(tx, tz), vl = this.speed;
      let rate;
      if (tl < 1e-3) rate = T.decel;
      else if (tx * this.vx + tz * this.vz < 0) rate = T.turn;
      else rate = tl >= vl ? T.accel : T.decel;
      const left = gap * (1 - rate);
      const k = left < T.snapGap ? 1 : rate;
      this.vx += gx * k; this.vz += gz * k;
    }
    const was = this.speed > 0.5 ? Math.atan2(this.vx, this.vz) : null;
    const res = this._move(this.vx * DT, this.vz * DT);
    if (res.hit) this._clipVelocity(res);
    if (res.hit && ml > 0.1) this._slideKeep(m, ml, res, T.speed * scale);
    if (ml > 0.1) this._cornerAssist(m, ml, res);
    if (ml > 0.1) this._rollOff(m, ml, res, scale); else this.rollSide = 0;
    if (was !== null && ml > 0.1 && this.state === 'move' && Math.abs(wrap(this.moveYaw - this.face)) > T.turnKick && this.speed > 2) {
      this._emit('move:turn', { yaw: this.moveYaw });
      if (MOVE_FX.turnDust) vfx.dust(this.body.x, this.body.z, { dx: -Math.sin(this.moveYaw), dz: -Math.cos(this.moveYaw), n: 6, size: 1, spread: 0.8 });
    }
  }

  _move(dx, dz) {
    const cw = this.collision;
    if (!cw) { this.body.x += dx; this.body.z += dz; return { hit: false, moved: len(dx, dz), nx: 0, nz: 0, normals: [] }; }
    const res = cw.move(this.body, dx, dz);
    if (res.hit) this.contact = [res.nx, res.nz];
    return res;
  }

  /** Remove the part of the velocity that points into what we touched: slide, keep the rest. */
  _clipVelocity(res) {
    for (const [nx, nz] of res.normals) {
      const into = this.vx * nx + this.vz * nz;
      if (into < 0) { this.vx -= into * nx; this.vz -= into * nz; this.sliding = true; }
    }
  }

  /**
   * Wall slide with diagonal input: the plain projection keeps only ~71% of run speed, which
   * reads as the wall slowing the hero. Raise the tangential speed toward slideKeep x run speed
   * (never above it, never lowering it).
   */
  _slideKeep(m, ml, res, top) {
    if (!this.sliding || !res.normals.length) return;
    const [nx, nz] = res.normals[res.normals.length - 1];
    const ix = m.x / ml, iz = m.z / ml;
    const into = ix * nx + iz * nz;
    if (into >= 0) return;
    const tin = len(ix - into * nx, iz - into * nz);   // how much of the input runs along the wall
    if (tin < 0.3 || tin > 0.95) return;
    const sp = this.speed;
    if (sp < 0.05) return;
    const want = Math.min(sp * (this.T.slideKeep / tin), top * this.T.slideKeep);
    if (want <= sp) return;
    this.vx *= want / sp; this.vz *= want / sp;
  }

  /**
   * Running dead-on into a round pillar: the contact normal is (almost) the input, so the
   * slide has no tangent and the body would stop forever. Push it round the side that is
   * more open (kept while in contact, so it never dithers).
   */
  _rollOff(m, ml, res, scale) {
    const cw = this.collision;
    let hit = null;
    if (res.hit) for (const n of res.normals) if (n[2]?.kind === 'circle') hit = n;
    if (!cw || !hit) { this.rollSide = 0; return; }
    const ix = m.x / ml, iz = m.z / ml;
    if (ix * hit[0] + iz * hit[1] > -0.99) return;    // not within ~8 degrees of head-on: it slides by itself
    if (!this.rollSide) {
      const s = hit[2];
      // which way round: the side the body is already off-centre to, else the more open one
      const off = (this.body.x - s.x) * -iz + (this.body.z - s.z) * ix;
      if (Math.abs(off) > 1e-3) this.rollSide = off > 0 ? 1 : -1;
      else {
        const a = cw.raycast(this.body.x, this.body.z, -iz, ix, 1.2, this.body.r);
        const b = cw.raycast(this.body.x, this.body.z, iz, -ix, 1.2, this.body.r);
        this.rollSide = b > a + 0.05 ? -1 : 1;
      }
    }
    const tx = -iz * this.rollSide, tz = ix * this.rollSide;
    const v = this.T.speed * scale * this.T.rollOff;
    this.vx = tx * v; this.vz = tz * v;
    cw.move(this.body, tx * v * DT, tz * v * DT);
    this.assist = v * DT;
  }

  /**
   * The player pushed straight into an edge they only just missed (a pillar corner, the lip
   * of a narrow gap). If a small sideways step would clear it, take that step, so the body
   * slips round instead of stopping dead.
   */
  cornerAssist(m, ml, res) { return this._cornerAssist(m, ml, res); }
  _cornerAssist(m, ml, res) {
    const cw = this.collision;
    if (!cw || !res.hit) return;
    const dx = m.x / ml, dz = m.z / ml;
    // only when the push is (nearly) head-on
    if (dx * res.nx + dz * res.nz > -0.8) return;
    const r = this.body.r, ahead = 0.1;
    let best = null;
    for (let s = 0.04; s <= this.T.cornerAssist + 1e-6; s += 0.04) {
      for (const side of [1, -1]) {
        const px = -dz * side, pz = dx * side;
        const x = this.body.x + px * s, z = this.body.z + pz * s;
        if (!cw.blocked(x, z, r * 0.98) && !cw.blocked(x + dx * ahead, z + dz * ahead, r * 0.98)) { best = { px, pz, s }; break; }
      }
      if (best) break;
    }
    if (!best) return;
    const step = Math.min(best.s, this.T.speed * DT * 0.9);
    cw.move(this.body, best.px * step, best.pz * step);
    this.assist = step;
  }

  _meter(ml, sp0) {
    // ticks counted from the first tick the input is seen (that tick is frame 1)
    const M = this.meter, T = this.T, tick = this.tick_;
    const sp = this.speed;
    const was = this.moving;
    const hadInput = this._hadInput; this._hadInput = ml > 0.1;
    if (this.state === 'dash' || this.atk) { M.startAt = -1; M.stopAt = -1; this.moving = sp > 0.05; return; }
    if (ml > 0.1 && !hadInput && M.startAt < 0 && sp0 < 0.05) M.startAt = tick - 1;
    if (ml < 0.1) M.startAt = -1;
    if (M.startAt >= 0 && sp >= T.speed * 0.9) { M.startTicks = tick - M.startAt; M.startAt = -1; }
    if (ml < 0.1 && hadInput && sp0 > T.speed * 0.8 && M.stopAt < 0) M.stopAt = tick - 1;
    if (ml > 0.1) M.stopAt = -1;
    if (M.stopAt >= 0 && sp < 0.05) {
      M.stopTicks = tick - M.stopAt; M.stopAt = -1;
      if (MOVE_FX.stopDust && this.recoverT <= 0) vfx.dust(this.body.x + Math.sin(this.face) * 0.15, this.body.z + Math.cos(this.face) * 0.15,
        { dx: Math.sin(this.face), dz: Math.cos(this.face), n: 4, size: 0.8, spread: 0.7 });
    }
    this.moving = sp > 0.05;
    if (this.moving && !was) this._emit('move:start', {});
    if (!this.moving && was) this._emit('move:stop', {});
  }

  _emit(name, extra) { events.emit(name, { ctl: this, x: this.body.x, z: this.body.z, ...extra }); }

  info() {
    const r = (n) => Math.round(n * 1000) / 1000;
    return {
      x: r(this.x), z: r(this.z), vx: r(this.vx), vz: r(this.vz), speed: r(this.speed),
      state: this.state, t: this.t, face: r(this.face), aim: { x: r(this.aim.x), z: r(this.aim.z) }, aimSource: this.aimSource,
      dashT: this.state === 'dash' ? this.t : -1, cooldown: this.cooldown, invulnerable: this.invulnerable, iframes: this.iframeT,
      dashQueued: this.dashQ, recover: this.recoverT, streak: this.fx ? this.fx.info() : null, sliding: this.sliding, contact: this.contact && this.contact.map(r), assist: r(this.assist),
      attack: this.atk ? { t: this.atk.t, recovering: this.recovering } : null,
      startTicks: this.meter.startTicks, stopTicks: this.meter.stopTicks,
    };
  }
}

// ---- the dash streak ------------------------------------------------------------------------
// A bright, flat-coloured band at chest height from where the dash started to the hero's back,
// stepped thicker toward the hero (a pixel-art taper) with a white core. It grows with the
// dash, then the tail runs up to the head and the band thins out a step at a time, so a
// 10 fps strip sees one long smear during the burst and a short one on the landing frame.
// Made by the controller on its first dash (when it has an animator with a rig), parented to
// the rig's group, so every scene that uses HeroController gets it with no setup.
const V = VOXEL;
export const STREAK = {
  y: 5 * V,             // centre height of the band (the torso)
  // layers, head to tail: [fraction of the length, height, width (voxels), colour]
  layers: [
    [1.0, 1.5, 1.5, 'sky'],
    [0.66, 4, 2, 'sky'],
    [0.33, 8, 2.5, 'frost'],
    [0.85, 1.5, 2.8, 'white'],
  ],
  stick: 3,             // ticks after the dash during which the band's head still follows the hero
  headBack: 0.18,       // units: the band stops this far behind the hero's centre
  chase: 0.34,          // per tick, after the burst: the tail closes this much of the gap
  fade: [3, 6, 10],     // ticks after the dash: drop the fat layer, then the middle, then all
};

export class DashStreak {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.meshes = STREAK.layers.map(([, , , c]) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: hex(c) }));
      m.frustumCulled = false;
      this.group.add(m);
      return m;
    });
    look.noOutline(this.group);
    parent.add(this.group);
    this.tail = { x: 0, z: 0 }; this.head = { x: 0, z: 0 };
    this.prevTail = { x: 0, z: 0 };
    this.dir = { x: 0, z: 1 };
    this.phase = 'off'; this.age = 0; this.dashT = 0;
  }
  start(ctl) {
    this.phase = 'dash'; this.age = 0; this.dashT = 0;
    this.dir.x = ctl.dash.dx; this.dir.z = ctl.dash.dz;
    this.tail.x = this.prevTail.x = ctl.dashFrom.x; this.tail.z = this.prevTail.z = ctl.dashFrom.z;
    this.head.x = ctl.x; this.head.z = ctl.z;
    this.meshes.forEach((m, i) => m.material.color.setHex(hex(STREAK.layers[i][3])));
  }
  end(ctl) {
    if (this.phase !== 'dash') return;
    this.phase = 'fade'; this.age = 0;
    this.head.x = ctl.x; this.head.z = ctl.z;
  }
  hide() { this.phase = 'off'; this.group.visible = false; }
  tick(ctl) {
    this.prevTail.x = this.tail.x; this.prevTail.z = this.tail.z;
    if (this.phase === 'off') return;
    if (this.phase === 'dash') {
      this.dashT++;
      this.head.x = ctl.x; this.head.z = ctl.z;
      if (this.dashT > ctl.T.dashFlat) this._chase();
      return;
    }
    this.age++;
    if (this.age <= STREAK.stick) { this.head.x = ctl.x; this.head.z = ctl.z; }
    this._chase();
    if (this.age === STREAK.fade[1]) this.meshes[3].material.color.setHex(hex('sky'));
    if (this.age >= STREAK.fade[2]) this.hide();
  }
  _chase() {
    this.tail.x += (this.head.x - this.tail.x) * STREAK.chase;
    this.tail.z += (this.head.z - this.tail.z) * STREAK.chase;
  }
  /** Per render frame: p = the hero's interpolated position. */
  render(p, ctl) {
    if (this.phase === 'off') return;
    const live = this.phase === 'dash';
    const follow = live || this.age < STREAK.stick;
    const hx = (follow ? p.x : this.head.x) - this.dir.x * STREAK.headBack;
    const hz = (follow ? p.z : this.head.z) - this.dir.z * STREAK.headBack;
    const tx = this.tail.x, tz = this.tail.z;
    const L = (hx - tx) * this.dir.x + (hz - tz) * this.dir.z;   // along the dash (slides can bend the path; the band stays straight)
    if (L < 0.08) { this.group.visible = false; return; }
    this.group.visible = true;
    const yaw = Math.atan2(this.dir.x, this.dir.z);
    STREAK.layers.forEach(([f, h, w], i) => {
      const m = this.meshes[i];
      let vis = true;
      if (!live) {
        if (i === 2 && this.age >= STREAK.fade[0]) vis = false;
        if (i === 1 && this.age >= STREAK.fade[1]) vis = false;
      }
      const l = f * L;
      if (!vis || l < 0.06) { m.visible = false; return; }
      m.visible = true;
      // thinner as it fades: one voxel off the height per fade step
      const step = live ? 0 : this.age >= STREAK.fade[1] ? 2 : this.age >= STREAK.fade[0] ? 1 : 0;
      const hh = Math.max(1, h - step) * V;
      m.scale.set(w * V, hh, l);
      m.rotation.set(0, yaw, 0);
      m.position.set(hx - this.dir.x * l / 2, STREAK.y, hz - this.dir.z * l / 2);
    });
  }
  info() { return { phase: this.phase, age: this.age, visible: this.group.visible }; }
}

// ---- debug hook: __GR.debug.move(action?, ...args) --------------------------------------------
// Acts on the most recently created HeroController. No action: returns ctl.info().
//   'teleport', x, z   'dash' (queue a dash press)   'impulse', vx, vz   'tune', {key: value}
//   'tuning' (returns the numbers in use)
debug.add('move', (action, a, b) => {
  const c = active;
  if (!c) return { ok: false, error: 'no hero controller in this scene' };
  if (action === 'teleport') c.teleport(+a || 0, +b || 0);
  else if (action === 'dash') c.dashQ = c.T.dashBuffer;
  else if (action === 'impulse') c.impulse(+a || 0, +b || 0);
  else if (action === 'tune' && a && typeof a === 'object') Object.assign(c.T, a);
  else if (action === 'tuning') return { ...c.T };
  return { ok: true, ...c.info() };
});
