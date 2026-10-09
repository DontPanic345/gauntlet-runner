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

export const MOVE = {
  speed: 4.2,           // top run speed, units/s (the run cycle in hero/anim.js is tuned to it)
  radius: 0.3,          // body radius, units (the hood is 7 voxels wide)
  accel: 0.55,          // fraction of the speed gap closed per tick when speeding up: 90% on tick 3
  decel: 0.5,           // ... when slowing down (release): at rest on tick 4
  turn: 0.62,           // ... when the new direction opposes the current velocity
  snapGap: 0.35,        // units/s: a remaining gap smaller than this closes at once (no creeping tail)
  dashTicks: 11,        // dash length in ticks
  dashDist: 2.5,        // units covered by the dash itself
  dashIframes: 9,       // invulnerable for the first n ticks of the dash
  dashCooldown: 18,     // ticks after the dash ends before the next one
  dashBuffer: 8,        // ticks a dash press waits for cooldown to run out
  dashExit: 1.0,        // exit speed as a fraction of run speed when a direction is held
  dashExitIdle: 0.45,   // ... when nothing is held (it then skids to a stop)
  attackMove: 0.12,     // move-speed factor during attack windup and active ticks
  recoverMove: 0.45,    // ... during attack recovery
  lunge: 2.2,           // units/s forward push on the first active tick of a swing
  cornerAssist: 0.34,   // units: slip round an edge if moving sideways this far clears it
  turnKick: 2.4,        // rad: a reversal this sharp while running emits move:turn
};

const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const len = Math.hypot;

/** Per-tick dash speeds (units/s): a burst that eases out to the exit speed, summing to dashDist. */
function dashProfile(T, exitV) {
  const n = T.dashTicks;
  // v(u) = exit + (peak - exit) * (1 - u)^2, sampled mid-tick; solve peak for the distance
  let shape = 0;
  for (let t = 0; t < n; t++) shape += Math.pow(1 - (t + 0.5) / n, 2);
  const peak = exitV + (T.dashDist / DT - exitV * n) / shape;
  return Array.from({ length: n }, (_, t) => exitV + (peak - exitV) * Math.pow(1 - (t + 0.5) / n, 2));
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

  at(alpha) { return this.pos.at(alpha); }

  teleport(x, z, yaw = this.face) {
    this.body.x = x; this.body.z = z;
    this.collision?.resolve(this.body);
    this.pos.set({ x: this.body.x, z: this.body.z });
    this.vx = 0; this.vz = 0; this.face = yaw; this.moveYaw = yaw;
    this.state = 'move'; this.dash = null; this.atk = null; this.t = 0;
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
    if (src.consume('dash')) this.dashQ = Math.max(this.dashQ, T.dashBuffer);
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
    if (this.atk) this.atk = null;          // cancels the attack's recovery
    this.state = 'dash';
    this.t = 0;
    this.dash = { dx, dz, speeds: dashProfile(T, T.speed * T.dashExit), exit: T.speed * T.dashExit };
    this.iframeT = Math.max(this.iframeT, T.dashIframes);
    this.face = Math.atan2(dx, dz);
    this.anim?.dash(T.dashTicks);
    feedback.kick(dx, dz * 0.77, 1);        // one-pixel lurch along the dash (shared, settings-scaled channel)
    this._emit('move:dash', { dx, dz });
  }

  _tickDash(m, ml) {
    const T = this.T, d = this.dash;
    const v = d.speeds[Math.min(this.t, d.speeds.length - 1)];
    this.vx = d.dx * v; this.vz = d.dz * v;
    const want = v * DT;
    const res = this._move(this.vx * DT, this.vz * DT);
    // a head-on wall ends the dash early; a glancing one just slides
    if (res.hit && res.moved < want * 0.3 && this.t > 0) {
      this._emit('move:bonk', { nx: res.nx, nz: res.nz });
      feedback.kick(-d.dx, -d.dz * 0.77, 1.5);
      this._endDash(ml, m, 0.1);
      return;
    }
    if (res.hit) this._clipVelocity(res);
    if (this.t >= T.dashTicks - 1) this._endDash(ml, m);
  }

  _endDash(ml, m, exitScale = null) {
    const T = this.T, d = this.dash;
    // exit: keep running if a direction is held, else carry a little momentum into a skid
    let k = ml > 0.1 ? T.dashExit : T.dashExitIdle;
    if (exitScale !== null) k = exitScale;
    const sp = T.speed * k;
    const hx = ml > 0.1 ? m.x / ml : d.dx, hz = ml > 0.1 ? m.z / ml : d.dz;
    this.vx = hx * sp; this.vz = hz * sp;
    this._emit('move:dashEnd', { dx: d.dx, dz: d.dz });
    this.state = 'move'; this.t = 0;
    this.cooldown = T.dashCooldown;
  }

  _tickMove(m, ml) {
    const T = this.T;
    let scale = 1;
    if (this.atk) scale = this.recovering ? T.recoverMove : T.attackMove;
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
    if (ml > 0.1) this._cornerAssist(m, ml, res);
    if (was !== null && ml > 0.1 && this.state === 'move' && Math.abs(wrap(this.moveYaw - this.face)) > T.turnKick && this.speed > 2) {
      this._emit('move:turn', { yaw: this.moveYaw });
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
    if (M.stopAt >= 0 && sp < 0.05) { M.stopTicks = tick - M.stopAt; M.stopAt = -1; }
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
      dashQueued: this.dashQ, sliding: this.sliding, contact: this.contact && this.contact.map(r), assist: r(this.assist),
      attack: this.atk ? { t: this.atk.t, recovering: this.recovering } : null,
      startTicks: this.meter.startTicks, stopTicks: this.meter.stopTicks,
    };
  }
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
