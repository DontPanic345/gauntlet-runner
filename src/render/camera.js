// The follow camera (piece `movement`). It leads the hero toward where they are going and
// where they aim, holds still inside a small dead-zone, eases with a critically damped
// spring, and places the view on whole screen texels.
//
//   import { CameraRig } from '../render/camera.js';
//   const cam = new CameraRig({ bounds: { minX, maxX, minZ, maxZ } });   // bounds optional
//   cam.reset(x, z);                                   // on scene enter / teleport
//   // every sim tick:
//   cam.tick(ctl);            // any {x, z, vx, vz, aim?: {x, z}, aimSource?, T?: {speed}}
//   // every render frame, after the hero is posed:
//   const off = cam.render(alpha, ctl.at(alpha));      // heroAt: the hero's interpolated {x, z}
//   rig.group.position.set(off.x, off.y, off.z);       // hero-relative texel rounding (below)
//
// Screen shake and kicks are not the camera's job: display.render() adds the offset from the
// shared feedback channel (core/feedback.js) on top of whatever this places, so every shake
// in the game is settings-scaled in one place.
//
// Texel snapping: display.setCameraTarget snaps the view to whole texels, so the static world
// never swims. A followed model that snaps itself to the world grid would still wobble by a
// pixel against the screen (it and the camera round at different moments). render() returns
// a sub-texel offset for the followed model's group that rounds its position *relative to
// the view* instead: the world scrolls in whole texels and the hero glides across the screen.
//   const off = cam.render(alpha, ctl.at(alpha)); rig.group.position.set(off.x, off.y, off.z);

import { DT, Interp } from '../core/loop.js';
import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { debug } from '../core/debug.js';

export const CAMERA = {
  y: 0.55,              // look-at height (the hero's chest)
  lead: 1.25,           // units of look-ahead at full run speed
  aimLead: 1.0,         // units toward a mouse aim point (scaled by its distance, capped)
  facingLead: 0.35,     // units toward the facing direction when aiming by keyboard
  leadRate: 0.085,      // per tick: how fast the look-ahead swings (about 0.2 s to settle)
  dashLead: 0.6,        // extra lead along a dash, so the view is not left behind
  deadX: 0.45,          // dead-zone half-width, units (screen x)
  deadZ: 0.3,           // dead-zone half-depth, units (world z; about 0.23 units of screen height)
  smooth: 0.16,         // spring time, s: how long the camera takes to catch its goal
  maxOffX: 5.5,         // never let the hero get further than this from the view centre
  maxOffZ: 3.6,
};

const cp = Math.cos(CAMERA_PITCH), sp = Math.sin(CAMERA_PITCH);

/** Critically damped spring step (Game Programming Gems 4, "smooth damp"). */
function damp(cur, goal, vel, smooth, dt) {
  const w = 2 / smooth, x = w * dt;
  const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const ch = cur - goal;
  const tmp = (vel + w * ch) * dt;
  const nv = (vel - w * tmp) * e;
  let out = goal + (ch + tmp) * e;
  // no overshoot
  if ((goal - cur > 0) === (out > goal)) return [goal, 0];
  return [out, nv];
}

let active = null;

export class CameraRig {
  constructor(opts = {}) {
    this.o = { ...CAMERA, ...opts };
    this.bounds = opts.bounds ?? null;
    this.pos = new Interp({ x: 0, z: 0 });
    this.vel = { x: 0, z: 0 };
    this.goal = { x: 0, z: 0 };
    this.lead = { x: 0, z: 0 };
    this.want = { x: 0, z: 0 };   // hero + lead, before the dead-zone
    this.relSnap = true;          // hero-relative texel rounding (see header)
    this.offset = { x: 0, y: 0, z: 0 };
    this.follow = true;
    active = this;
  }

  reset(x, z) {
    this.pos.set({ x, z });
    this.goal.x = x; this.goal.z = z;
    this.want.x = x; this.want.z = z;
    this.vel.x = 0; this.vel.z = 0;
    this.lead.x = 0; this.lead.z = 0;
    this._clamp(this.pos.cur); this._clamp(this.pos.prev);
  }

  tick(h) {
    const o = this.o;
    this.pos.snap();
    if (!this.follow) return;
    const top = h.T?.speed ?? 4.2;
    // look-ahead: toward the velocity (scaled by speed) plus toward the aim
    let lx = 0, lz = 0;
    const vx = h.vx ?? 0, vz = h.vz ?? 0;
    const sp_ = Math.hypot(vx, vz);
    if (sp_ > 0.05) {
      const k = Math.min(1, sp_ / top);
      lx += (vx / sp_) * o.lead * k; lz += (vz / sp_) * o.lead * k;
      if (h.state === 'dash') { lx += (vx / sp_) * o.dashLead; lz += (vz / sp_) * o.dashLead; }
    }
    if (h.aim) {
      const a = h.aimSource === 'mouse' ? o.aimLead * Math.min(1, (h.aimDist ?? 3) / 4) : o.facingLead;
      lx += h.aim.x * a; lz += h.aim.z * a;
    }
    this.lead.x += (lx - this.lead.x) * o.leadRate;
    this.lead.z += (lz - this.lead.z) * o.leadRate;
    this.want.x = h.x + this.lead.x;
    this.want.z = h.z + this.lead.z;

    // dead-zone: the goal only moves when the wanted point leaves the box around it
    const g = this.goal;
    if (this.want.x > g.x + o.deadX) g.x = this.want.x - o.deadX;
    if (this.want.x < g.x - o.deadX) g.x = this.want.x + o.deadX;
    if (this.want.z > g.z + o.deadZ) g.z = this.want.z - o.deadZ;
    if (this.want.z < g.z - o.deadZ) g.z = this.want.z + o.deadZ;
    this._clamp(g);

    const c = this.pos.cur;
    [c.x, this.vel.x] = damp(c.x, g.x, this.vel.x, o.smooth, DT);
    [c.z, this.vel.z] = damp(c.z, g.z, this.vel.z, o.smooth, DT);
    // hard leash: the hero never leaves the safe part of the screen
    if (h.x - c.x > o.maxOffX) c.x = h.x - o.maxOffX;
    if (c.x - h.x > o.maxOffX) c.x = h.x + o.maxOffX;
    if (h.z - c.z > o.maxOffZ) c.z = h.z - o.maxOffZ;
    if (c.z - h.z > o.maxOffZ) c.z = h.z + o.maxOffZ;
    this._clamp(c);
  }

  _clamp(p) {
    const b = this.bounds;
    if (!b) return;
    // Inset by half the visible viewport (in world units) so the camera *centre* never sits
    // close enough to a room edge to reveal the void beyond it. Without this, bounds only kept
    // the hero's look-at point inside the room, which does nothing to stop the far half of the
    // screen from showing past the wall whenever the hero (and so the camera) is near a door —
    // i.e. always, since doors sit on the perimeter. A room narrower than the viewport collapses
    // to its centre on that axis rather than an inverted (min > max) range.
    const hx = (display.width / 2) / (PPU * display.zoom);
    const hz = (display.height / 2) / (PPU * display.zoom * sp);
    let minX = b.minX + hx, maxX = b.maxX - hx;
    if (minX > maxX) { minX = maxX = (b.minX + b.maxX) / 2; }
    let minZ = b.minZ + hz, maxZ = b.maxZ - hz;
    if (minZ > maxZ) { minZ = maxZ = (b.minZ + b.maxZ) / 2; }
    p.x = Math.min(maxX, Math.max(minX, p.x));
    p.z = Math.min(maxZ, Math.max(minZ, p.z));
  }

  /**
   * Place the view, and return the offset {x, y, z} to add to the followed model's group
   * position this frame (see the header: hero-relative texel rounding). heroAt: the hero's
   * interpolated {x, z}. The offset is at most one texel on each screen axis.
   */
  render(alpha, heroAt = null, heroY = 0) {
    const p = this.pos.at(alpha);
    const y = this.o.y;
    display.setCameraTarget(p.x, y, p.z);
    const off = this.offset;
    off.x = 0; off.y = 0; off.z = 0;
    if (!this.relSnap || !heroAt) return off;
    const P = PPU * display.zoom;
    // screen coordinates in texels: r = x, u = y*cos(pitch) - z*sin(pitch)
    const hr = heroAt.x * P, hu = (heroY * cp - heroAt.z * sp) * P;
    const cr = p.x * P, cu = (y * cp - p.z * sp) * P;
    // where the hero would land on its own (absolute rounding) vs. rounded relative to the view
    const dr = Math.round(cr) + Math.round(hr - cr) - Math.round(hr);
    const du = Math.round(cu) + Math.round(hu - cu) - Math.round(hu);
    // one texel along screen-up is (0, cos, -sin) / P in the world, at constant view depth
    off.x = dr / P; off.y = (du / P) * cp; off.z = -(du / P) * sp;
    return off;
  }

  info() {
    const r = (n) => Math.round(n * 1000) / 1000;
    const c = this.pos.cur;
    return { x: r(c.x), z: r(c.z), goal: { x: r(this.goal.x), z: r(this.goal.z) }, lead: { x: r(this.lead.x), z: r(this.lead.z) },
      want: { x: r(this.want.x), z: r(this.want.z) }, dead: [this.o.deadX, this.o.deadZ], follow: this.follow, relSnap: this.relSnap,
      target: { x: r(display.cameraTarget.x), y: r(display.cameraTarget.y), z: r(display.cameraTarget.z) } };
  }
}

// ---- debug hook: __GR.debug.camera(opts?) -----------------------------------------------------
// Returns the active rig's info. opts: any CAMERA key, plus follow (bool) and relSnap (bool).
debug.add('camera', (opts) => {
  const c = active;
  if (!c) return { ok: false, error: 'no camera rig in this scene' };
  if (opts && typeof opts === 'object') {
    for (const k in opts) {
      if (k === 'follow') c.follow = !!opts.follow;
      else if (k === 'relSnap') c.relSnap = !!opts.relSnap;
      else if (k in c.o) c.o[k] = +opts[k];
    }
  }
  return { ok: true, ...c.info() };
});
