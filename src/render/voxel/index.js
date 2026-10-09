// Voxel models: public API. Import from here, not from the individual files.
//
//   import { defineModel, voxelMesh, getModel, VoxelGrid, VOXEL } from '../render/voxel/index.js';
//
//   defineModel('skull', { key: {...}, layers: [...] });   // register (cheap)
//   const m = voxelMesh('skull');                          // THREE.Mesh, one draw call
//   scene.add(m);
//   getModel('skull').stats  -> { voxels, quads, triangles, vertices, size }
//
// Geometry is meshed once per model on first use and shared by every mesh of that model.
// Never dispose a model's geometry from a scene; call disposeModel(name) if you truly must.

import * as THREE from 'three';
import { getSpec, gridFromSpec, VOXEL } from './model.js';
import { meshGrid } from './mesher.js';
import { voxelMaterial, makeVoxelMaterial } from './material.js';

export { VoxelGrid, defineModel, modelNames, parseLayers, VOXEL } from './model.js';
export { voxelMaterial, makeVoxelMaterial, voxelUniforms } from './material.js';
export { meshGrid } from './mesher.js';

const cache = new Map(); // name -> { spec, geometry, grid, ms }

/** Meshed model (cached). Throws on an unknown name. */
export function getModel(name) {
  const spec = getSpec(name);
  if (!spec) throw new Error(`voxel: no model named "${name}"`);
  let entry = cache.get(name);
  if (!entry || entry.spec !== spec) {
    entry?.geometry.dispose();
    const t0 = performance.now();
    const grid = gridFromSpec(spec);
    const geometry = meshGrid(grid, { origin: spec.origin ?? 'bottom-center', scale: spec.scale ?? VOXEL });
    geometry.name = name;
    entry = { spec, grid, geometry, ms: performance.now() - t0, get stats() { return geometry.userData.stats; } };
    cache.set(name, entry);
  }
  return entry;
}

/**
 * A mesh of a registered model. Shares geometry (and by default the material) with every
 * other mesh of that model. opts.ownMaterial gives it a private material (for per-entity flash).
 */
export function voxelMesh(name, { ownMaterial = false } = {}) {
  const mesh = new THREE.Mesh(getModel(name).geometry, ownMaterial ? makeVoxelMaterial() : voxelMaterial);
  mesh.name = name;
  return mesh;
}

/** Height of a model in world units. */
export function modelHeight(name) {
  const e = getModel(name);
  return e.geometry.boundingBox.max.y - e.geometry.boundingBox.min.y;
}

export function disposeModel(name) {
  const e = cache.get(name);
  if (e) { e.geometry.dispose(); cache.delete(name); }
}

/** For debug overlays: every cached model and its stats. */
export function cacheStats() {
  return [...cache.entries()].map(([name, e]) => ({ name, ms: +e.ms.toFixed(2), ...e.stats }));
}
