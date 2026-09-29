// Floor telegraphs and decals (piece `enemies`): flat voxel tiles on the world voxel grid,
// drawn in one instanced draw call and rebuilt every sim tick.
//
//   const tele = createFloorTiles(root);
//   tick:   tele.begin(); ...shapes...; tele.end();
//   tele.sector(x, z, yaw, reach, arcDeg, p, { firing, t, inner })   a swipe's reach (arc each side)
//   tele.lane(x, z, yaw, length, width, p, { firing, t })             a charge's path
//   tele.disc(x, z, r, p, { firing, t })                              a slam or a hop's landing
//   tele.dot(x, z, color)                                             one tile (decals, orb shadows)
//
// The look is one language for every enemy, so a player learns it once:
//   - the outline of the danger zone appears at once, in red;
//   - the fill grows from the enemy outward as a 50% checker of blood (the floor shows
//     through), with a solid red front line: how full it is = how soon it hits;
//   - over the last quarter the outline blinks gold;
//   - the frame it hits, the whole zone flashes gold and red.
// `ember` is not used: unlit ember does not survive look's quantise (see combat's notes).

import * as THREE from 'three';
import { VOXEL } from '../render/voxel/index.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';

const V = VOXEL;
const CAP = 6000;
const D2R = Math.PI / 180;

export function createFloorTiles(root) {
  const geo = new THREE.BoxGeometry(V, 0.01, V);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(geo, mat, CAP);
  inst.frustumCulled = false;
  inst.count = 0;
  look.noOutline(inst);
  root.add(inst);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const COL = {};
  for (const n of ['red', 'blood', 'gold', 'plum', 'torch', 'rose']) COL[n] = hex(n);
  let n = 0;

  function put(ix, iz, col, y = 0.012) {
    if (n >= CAP) return;
    m.makeTranslation((ix + 0.5) * V, y, (iz + 0.5) * V);
    inst.setMatrixAt(n, m);
    inst.setColorAt(n, c.setHex(COL[col] ?? hex(col)));
    n++;
  }

  /**
   * Generic zone: walk the grid cells in a box, keep the cells `inside(lx, lz)` in the shape's
   * own frame, and colour them by `depth(lx, lz)` (0 at the enemy, 1 at the far edge) against
   * the fill progress p.
   */
  function zone(x, z, yaw, box, inside, depth, p, { firing = false, t = 0 } = {}, span = 1) {
    const cs = Math.cos(yaw), sn = Math.sin(yaw);
    const [bx0, bx1, bz0, bz1] = typeof box === 'number' ? [x - box, x + box, z - box, z + box] : box;
    const ix0 = Math.floor(bx0 / V), ix1 = Math.floor(bx1 / V);
    const iz0 = Math.floor(bz0 / V), iz1 = Math.floor(bz1 / V);
    const late = !firing && p > 0.75;
    const blink = late && ((t >> 1) & 1);
    const front = 1.6 * V;
    const test = (wx, wz) => {
      const rx = wx - x, rz = wz - z;
      const lx = rx * cs - rz * sn, lz = rx * sn + rz * cs;   // into the shape's frame (+z forward)
      return inside(lx, lz) ? [lx, lz] : null;
    };
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const wx = (ix + 0.5) * V, wz = (iz + 0.5) * V;
      const L = test(wx, wz);
      if (!L) continue;
      const edge = !test(wx + V, wz) || !test(wx - V, wz) || !test(wx, wz + V) || !test(wx, wz - V);
      if (firing) { put(ix, iz, edge ? 'gold' : ((ix + iz) & 1 ? 'red' : 'gold')); continue; }
      if (edge) { put(ix, iz, blink ? 'gold' : 'red'); continue; }
      const dep = depth(L[0], L[1]);
      const fill = p;
      if (dep > fill) continue;
      if ((fill - dep) * span < front && p < 1) put(ix, iz, 'red');
      else if ((ix + iz) & 1) put(ix, iz, 'blood');
    }
  }

  return {
    begin() { n = 0; },
    end() {
      inst.count = n;
      inst.visible = n > 0;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },
    /** A swipe: everything within reach, arcDeg either side of yaw (0 = +z). */
    sector(x, z, yaw, reach, arcDeg, p, o = {}) {
      const inner = o.inner ?? 0.25;
      const half = arcDeg * D2R;
      zone(x, z, yaw, reach + V, (lx, lz) => {
        const d = Math.hypot(lx, lz);
        if (d > reach || d < inner) return false;
        return Math.abs(Math.atan2(lx, lz)) <= half;
      }, (lx, lz) => (Math.hypot(lx, lz) - inner) / (reach - inner), p, o, reach - inner);
    },
    /** A charge: a strip `width` wide from the enemy out to `length`. */
    lane(x, z, yaw, length, width, p, o = {}) {
      const start = o.start ?? 0.2;
      const fx = Math.sin(yaw), fz = Math.cos(yaw), w = width / 2 + V;
      const xs = [], zs = [];
      for (const [a, b] of [[-w, 0], [w, 0], [-w, length + V], [w, length + V]]) { xs.push(x + a * fz + b * fx); zs.push(z - a * fx + b * fz); }
      const box = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
      zone(x, z, yaw, box, (lx, lz) => lz >= start && lz <= length && Math.abs(lx) <= width / 2,
        (lx, lz) => (lz - start) / (length - start), p, o, length - start);
    },
    /** A slam or landing: a disc, filling from the centre. */
    disc(x, z, r, p, o = {}) {
      zone(x, z, 0, r + V, (lx, lz) => Math.hypot(lx, lz) <= r, (lx, lz) => Math.hypot(lx, lz) / r, p, o, r);
    },
    /** One tile at a world point. */
    dot(x, z, col, y) { put(Math.floor(x / V), Math.floor(z / V), col, y); },
    get count() { return n; },
    dispose() { inst.removeFromParent(); geo.dispose(); mat.dispose(); },
  };
}
