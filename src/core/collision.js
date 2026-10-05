// Static collision for bodies that move on the floor plane (piece `movement`).
//
// Everything is 2D on (x, z). Moving bodies are circles. The world is a list of solid
// shapes that never move:
//
//   box     axis-aligned rectangle          addBox(minX, minZ, maxX, maxZ, tag?)
//   circle  round pillar, post, brazier     addCircle(x, z, r, tag?)
//   ring    keep-inside circle (round arena) addRing(x, z, R, tag?)
//
//   import { CollisionWorld, setCollision, getCollision } from '../core/collision.js';
//   const cw = new CollisionWorld();
//   cw.addBox(-6, -4, 6, -3.5);             // a wall
//   setCollision(cw);                        // the room's world; enemies and the hero share it
//   const r = cw.move(body, dx, dz);         // body {x, z, r}: moves it, slides on contact
//   // r = { hit, nx, nz, normals: [[nx, nz], ...], moved }   nx/nz: the last contact normal
//   cw.blocked(x, z, r)  -> true if a circle there overlaps anything
//   cw.resolve(body)     -> push a body out of anything it overlaps (after a teleport)
//   cw.raycast(x, z, dx, dz, maxDist, r = 0) -> distance to the first hit (or maxDist)
//
// Why it does not snag:
//   - a circle against a box corner meets a rounded contact, so clipping a corner deflects
//     the body along the corner instead of stopping it;
//   - fast moves are split into substeps no longer than half the body radius, so a dash
//     never tunnels through a thin wall, and every substep keeps only the part of the
//     remaining motion that is tangent to what it touched (a slide, not a stop);
//   - overlaps are resolved in several passes, so inner (concave) corners settle without jitter.
// The "slip round an edge you nearly cleared" assist lives in the hero controller, which
// knows what the player meant; see HeroController.cornerAssist.

const EPS = 1e-6;

let current = null;
/** The collision world of the current room, or null. */
export const getCollision = () => current;
export const setCollision = (w) => { current = w; return w; };

export class CollisionWorld {
  constructor() {
    this.shapes = [];
  }
  clear() { this.shapes.length = 0; return this; }

  addBox(minX, minZ, maxX, maxZ, tag = 'wall') {
    const s = { kind: 'box', minX: Math.min(minX, maxX), minZ: Math.min(minZ, maxZ), maxX: Math.max(minX, maxX), maxZ: Math.max(minZ, maxZ), tag };
    this.shapes.push(s);
    return s;
  }
  /** Box from a centre and full size. */
  addRect(cx, cz, w, d, tag = 'wall') { return this.addBox(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, tag); }
  addCircle(x, z, r, tag = 'pillar') {
    const s = { kind: 'circle', x, z, r, tag };
    this.shapes.push(s);
    return s;
  }
  addRing(x, z, R, tag = 'bounds') {
    const s = { kind: 'ring', x, z, R, tag };
    this.shapes.push(s);
    return s;
  }
  remove(shape) {
    const i = this.shapes.indexOf(shape);
    if (i >= 0) this.shapes.splice(i, 1);
  }

  /**
   * Penetration of a circle (x, z, r) into one shape: writes out.nx/nz (the push direction)
   * and returns the depth, or 0 if they do not overlap.
   */
  _pen(s, x, z, r, out) {
    if (s.kind === 'box') {
      const cx = x < s.minX ? s.minX : x > s.maxX ? s.maxX : x;
      const cz = z < s.minZ ? s.minZ : z > s.maxZ ? s.maxZ : z;
      const dx = x - cx, dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) return 0;
      if (d2 > EPS * EPS) {
        const d = Math.sqrt(d2);
        out.nx = dx / d; out.nz = dz / d;
        return r - d;
      }
      // centre inside the box: leave by the nearest face
      const l = x - s.minX, rr = s.maxX - x, b = z - s.minZ, f = s.maxZ - z;
      const m = Math.min(l, rr, b, f);
      if (m === l) { out.nx = -1; out.nz = 0; } else if (m === rr) { out.nx = 1; out.nz = 0; }
      else if (m === b) { out.nx = 0; out.nz = -1; } else { out.nx = 0; out.nz = 1; }
      return m + r;
    }
    if (s.kind === 'circle') {
      const dx = x - s.x, dz = z - s.z;
      const R = s.r + r;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) return 0;
      const d = Math.sqrt(d2);
      if (d < EPS) { out.nx = 0; out.nz = 1; return R; }
      out.nx = dx / d; out.nz = dz / d;
      return R - d;
    }
    // ring: stay inside
    const dx = x - s.x, dz = z - s.z;
    const lim = s.R - r;
    const d2 = dx * dx + dz * dz;
    if (d2 <= lim * lim) return 0;
    const d = Math.sqrt(d2);
    out.nx = -dx / d; out.nz = -dz / d;
    return d - lim;
  }

  /**
   * True if a circle at (x, z) of radius r overlaps any shape (touching does not count).
   * overLow: ignore shapes marked `low` (pits and water: they stop feet, not things in the air).
   */
  blocked(x, z, r, overLow = false) {
    const o = { nx: 0, nz: 0 };
    for (const s of this.shapes) if (!(overLow && s.low) && this._pen(s, x, z, r, o) > 1e-4) return true;
    return false;
  }

  /**
   * Push body {x, z, r} out of everything it overlaps. Several passes, so a body wedged in
   * an inner corner settles. Returns the contact normals it was pushed along (may be empty).
   */
  resolve(body, normals = []) {
    const o = { nx: 0, nz: 0 };
    for (let pass = 0; pass < 4; pass++) {
      let any = false;
      for (const s of this.shapes) {
        const p = this._pen(s, body.x, body.z, body.r, o);
        if (p <= 0) continue;
        body.x += o.nx * (p + 1e-5);
        body.z += o.nz * (p + 1e-5);
        normals.push([o.nx, o.nz, s]);
        any = true;
      }
      if (!any) break;
    }
    return normals;
  }

  /**
   * Move body {x, z, r} by (dx, dz), sliding along whatever it touches.
   * Returns { hit, nx, nz, normals, moved } (moved: distance actually travelled).
   */
  move(body, dx, dz) {
    const len = Math.hypot(dx, dz);
    const res = { hit: false, nx: 0, nz: 0, normals: [], moved: 0 };
    if (len < EPS) { this.resolve(body, res.normals); this._finish(res); return res; }
    const n = Math.max(1, Math.ceil(len / Math.max(0.02, body.r * 0.5)));
    let sx = dx / n, sz = dz / n;
    const x0 = body.x, z0 = body.z;
    for (let i = 0; i < n; i++) {
      body.x += sx; body.z += sz;
      const before = res.normals.length;
      this.resolve(body, res.normals);
      // keep only the tangent part of the remaining motion for the next substeps
      for (let k = before; k < res.normals.length; k++) {
        const [nx, nz] = res.normals[k];
        const into = sx * nx + sz * nz;
        if (into < 0) { sx -= into * nx; sz -= into * nz; }
      }
    }
    res.moved = Math.hypot(body.x - x0, body.z - z0);
    this._finish(res);
    return res;
  }

  _finish(res) {
    if (!res.normals.length) return;
    res.hit = true;
    const last = res.normals[res.normals.length - 1];
    res.nx = last[0]; res.nz = last[1];
  }

  /**
   * March a circle of radius r from (x, z) along the unit direction (dx, dz). Returns the
   * distance it can travel before touching something, up to maxDist. Coarse (step r/2 or 0.05).
   */
  raycast(x, z, dx, dz, maxDist, r = 0) {
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    const step = Math.max(0.05, r * 0.5);
    let d = 0;
    while (d < maxDist) {
      const nd = Math.min(maxDist, d + step);
      if (this.blocked(x + dx * nd, z + dz * nd, r)) {
        // refine by bisection
        let a = d, b = nd;
        for (let i = 0; i < 8; i++) { const m = (a + b) / 2; if (this.blocked(x + dx * m, z + dz * m, r)) b = m; else a = m; }
        return a;
      }
      d = nd;
    }
    return maxDist;
  }

  /** Plain data for debug and overlays. */
  describe() {
    return this.shapes.map((s) => ({ ...s }));
  }
}
