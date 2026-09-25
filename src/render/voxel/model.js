// Voxel model format.
//
// A model is a small dense grid of palette colours. Author it as text layers or build it
// in code, then register it by name; it is meshed once, on first use, and cached.
//
// Text form (every piece's hand-authored models look like this):
//
//   defineModel('crate', {
//     key: { '#': 'wood', '=': 'woodLight', 'o': 'ember!' },   // '!' suffix = emissive (unlit)
//     layers: [                  // y = 0 (bottom) first
//       `###
//        #=#
//        ###`,
//       ...
//     ],
//   });
//
//   - Within a layer, rows run back (-z, far from camera) to front (+z); characters run -x to +x.
//   - '.' and ' ' are empty. Lines are trimmed, blank lines ignored. Rows may differ in length.
//   - `origin`: 'bottom-center' (default: x/z centred, y = 0 at the bottom) or [x, y, z] in voxels.
//   - `scale`: world units per voxel. Default VOXEL (1/8: one world unit = 8 voxels).
//
// Code form, for generated shapes:
//
//   const g = new VoxelGrid(16, 4, 16);
//   g.set(x, y, z, 'stone'); g.box(0, 0, 0, 15, 0, 15, 'stoneDark'); g.set(3, 2, 3, 'ember', true);
//   defineModel('plinth', { grid: g });

import { PALETTE } from '../palette.js';

export const VOXEL = 1 / 8;

export class VoxelGrid {
  constructor(sx, sy, sz) {
    this.size = [sx, sy, sz];
    this.data = new Uint8Array(sx * sy * sz); // 0 = empty, else 1-based index into colors
    this.colors = [null];                     // [{name, emissive}], index 0 unused
    this._lookup = new Map();
  }
  index(name, emissive = false) {
    if (!(name in PALETTE)) throw new Error(`voxel: "${name}" is not a palette colour`);
    const k = name + (emissive ? '!' : '');
    let i = this._lookup.get(k);
    if (i === undefined) {
      i = this.colors.length;
      if (i > 255) throw new Error('voxel: more than 255 colours in one model');
      this.colors.push({ name, emissive });
      this._lookup.set(k, i);
    }
    return i;
  }
  inBounds(x, y, z) {
    const [sx, sy, sz] = this.size;
    return x >= 0 && y >= 0 && z >= 0 && x < sx && y < sy && z < sz;
  }
  set(x, y, z, name, emissive = false) {
    if (!this.inBounds(x, y, z)) return;
    this.data[x + this.size[0] * (y + this.size[1] * z)] = name ? this.index(name, emissive) : 0;
  }
  clear(x, y, z) { this.set(x, y, z, null); }
  get(x, y, z) {
    if (!this.inBounds(x, y, z)) return 0;
    return this.data[x + this.size[0] * (y + this.size[1] * z)];
  }
  /** Fill an inclusive box. name null clears. */
  box(x0, y0, z0, x1, y1, z1, name, emissive = false) {
    for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, name, emissive);
  }
  count() { let n = 0; for (const v of this.data) if (v) n++; return n; }
}

/** Parse the text form into a VoxelGrid. */
export function parseLayers(layers, key) {
  const parsed = layers.map((layer) => layer.split('\n').map((l) => l.trim()).filter((l) => l.length));
  const sy = parsed.length;
  let sz = 0, sx = 0;
  for (const rows of parsed) {
    sz = Math.max(sz, rows.length);
    for (const r of rows) sx = Math.max(sx, r.length);
  }
  const g = new VoxelGrid(sx, sy, sz);
  parsed.forEach((rows, y) => {
    rows.forEach((row, z) => {
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const entry = key[ch];
        if (!entry) throw new Error(`voxel: character "${ch}" has no key entry`);
        const emissive = entry.endsWith('!');
        g.set(x, y, z, emissive ? entry.slice(0, -1) : entry, emissive);
      }
    });
  });
  return g;
}

const specs = new Map();

/**
 * Register a model by name. spec: { layers, key } or { grid }, plus optional origin, scale.
 * Registering is cheap; meshing happens on first getModel().
 */
export function defineModel(name, spec) {
  specs.set(name, spec); // redefining replaces; the cache notices the new spec and re-meshes
}

export function getSpec(name) { return specs.get(name); }
export function modelNames() { return [...specs.keys()]; }

export function gridFromSpec(spec) {
  if (spec.grid) return spec.grid;
  return parseLayers(spec.layers, spec.key);
}
