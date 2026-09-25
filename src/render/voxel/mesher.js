// Greedy mesher with baked per-vertex ambient occlusion.
//
// Faces between a solid and an empty cell are collected per slice, then merged into the
// largest rectangles whose colour AND four corner AO values match (so merging never
// changes the shading). Each quad's diagonal is chosen from its AO values so dark corners
// do not smear across the face. Output is one indexed BufferGeometry (one draw call) with:
//   position, normal, color (linear, palette), ao (0..1: 0 = fully occluded corner),
//   emit (1 = emissive voxel, drawn unlit)

import * as THREE from 'three';
import { PALETTE } from '../palette.js';

/**
 * @param {import('./model.js').VoxelGrid} grid
 * @param {{origin?: 'bottom-center'|number[], scale?: number}} opts
 */
export function meshGrid(grid, { origin = 'bottom-center', scale = 1 / 8 } = {}) {
  const dims = grid.size;
  const [SX, SY, SZ] = dims;
  const data = grid.data;
  const solid = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ && data[x + SX * (y + SY * z)] !== 0;
  const get = (x, y, z) => (x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ ? data[x + SX * (y + SY * z)] : 0);

  const o = origin === 'bottom-center' ? [SX / 2, 0, SZ / 2] : origin;

  const lin = grid.colors.map((c) => (c ? new THREE.Color(PALETTE[c.name]) : null));
  const pos = [], nor = [], col = [], aoA = [], emA = [], idx = [];
  let quads = 0;

  const x = [0, 0, 0];
  const q = [0, 0, 0];
  const c = [0, 0, 0];

  for (let d = 0; d < 3; d++) {
    const u = (d + 1) % 3, v = (d + 2) % 3;
    const W = dims[u], H = dims[v];
    const mask = new Int32Array(W * H);
    q[0] = q[1] = q[2] = 0; q[d] = 1;

    for (x[d] = -1; x[d] < dims[d];) {
      // 1. build the face mask for the plane between slice x[d] and x[d]+1
      let n = 0;
      for (x[v] = 0; x[v] < H; x[v]++) {
        for (x[u] = 0; x[u] < W; x[u]++, n++) {
          const a = x[d] >= 0 ? get(x[0], x[1], x[2]) : 0;
          const b = x[d] < dims[d] - 1 ? get(x[0] + q[0], x[1] + q[1], x[2] + q[2]) : 0;
          if ((a !== 0) === (b !== 0)) { mask[n] = 0; continue; }
          let colorIdx, sign;
          if (a) { colorIdx = a; sign = 1; c[0] = x[0] + q[0]; c[1] = x[1] + q[1]; c[2] = x[2] + q[2]; }
          else { colorIdx = b; sign = 0; c[0] = x[0]; c[1] = x[1]; c[2] = x[2]; }
          // AO at the 4 corners of this face, sampled in the empty cell c the face looks into.
          // corner order: (-u,-v), (+u,-v), (+u,+v), (-u,+v)
          let key = colorIdx | (sign << 8);
          for (let k = 0; k < 4; k++) {
            const su = k === 1 || k === 2 ? 1 : -1;
            const sv = k >= 2 ? 1 : -1;
            const p1 = [c[0], c[1], c[2]]; p1[u] += su;
            const p2 = [c[0], c[1], c[2]]; p2[v] += sv;
            const p3 = [c[0], c[1], c[2]]; p3[u] += su; p3[v] += sv;
            const s1 = solid(p1[0], p1[1], p1[2]) ? 1 : 0;
            const s2 = solid(p2[0], p2[1], p2[2]) ? 1 : 0;
            const s3 = solid(p3[0], p3[1], p3[2]) ? 1 : 0;
            const ao = s1 && s2 ? 0 : 3 - (s1 + s2 + s3);
            key |= ao << (9 + k * 2);
          }
          mask[n] = key;
        }
      }
      x[d]++;

      // 2. greedy-merge equal keys into rectangles
      n = 0;
      for (let j = 0; j < H; j++) {
        for (let i = 0; i < W;) {
          const key = mask[n];
          if (!key) { i++; n++; continue; }
          let w = 1;
          while (i + w < W && mask[n + w] === key) w++;
          let h = 1;
          outer: for (; j + h < H; h++) {
            for (let k = 0; k < w; k++) if (mask[n + k + h * W] !== key) break outer;
          }
          x[u] = i; x[v] = j;
          emitQuad(d, u, v, x, w, h, key);
          for (let l = 0; l < h; l++) for (let k = 0; k < w; k++) mask[n + k + l * W] = 0;
          i += w; n += w;
        }
      }
    }
  }

  function emitQuad(d, u, v, at, w, h, key) {
    quads++;
    const colorIdx = key & 0xff;
    const sign = (key >> 8) & 1;
    const ao = [0, 1, 2, 3].map((k) => (key >> (9 + k * 2)) & 3);
    const corners = [];
    for (let k = 0; k < 4; k++) {
      const p = [at[0], at[1], at[2]];
      if (k === 1 || k === 2) p[u] += w;
      if (k >= 2) p[v] += h;
      corners.push(p);
    }
    // +d faces: 0,1,2,3 is counter-clockwise seen from +d (u x v = d). -d faces: reverse.
    const order = sign ? [0, 1, 2, 3] : [0, 3, 2, 1];
    const normal = [0, 0, 0]; normal[d] = sign ? 1 : -1;
    const base = pos.length / 3;
    const color = lin[colorIdx];
    const emissive = grid.colors[colorIdx].emissive ? 1 : 0;
    const vAo = [];
    for (const k of order) {
      const p = corners[k];
      pos.push((p[0] - o[0]) * scale, (p[1] - o[1]) * scale, (p[2] - o[2]) * scale);
      nor.push(normal[0], normal[1], normal[2]);
      col.push(color.r, color.g, color.b);
      aoA.push(ao[k] / 3);
      emA.push(emissive);
      vAo.push(ao[k]);
    }
    // choose the diagonal along the brighter pair so a lone dark corner stays in its corner
    if (vAo[1] + vAo[3] > vAo[0] + vAo[2]) idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
    else idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('ao', new THREE.Float32BufferAttribute(aoA, 1));
  geo.setAttribute('emit', new THREE.Float32BufferAttribute(emA, 1));
  geo.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  geo.userData.stats = { voxels: grid.count(), quads, triangles: quads * 2, vertices: pos.length / 3, size: [...dims] };
  return geo;
}
