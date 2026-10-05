// Enemy material (piece `enemies`): the shared voxel material, plus a per-enemy "self light"
// so a body never sinks into the floor's value range in a dark room.
//
// Readability first (GAME.md): the crypt is lit by a few warm pools, and away from them a
// lit voxel falls one or two palette steps darker, onto the floor's own colours. Each enemy's
// material therefore has a floor under its lighting: a voxel is never darker than
//   palette colour x AO x selfLit x face
// where `face` is a fixed toon ramp (top faces 1.0, faces turned to the camera and to the
// upper-left key a little less, the rest darker). Lit by a torch it still gets brighter; in
// the dark it stays on its own colours instead of the floor's. The ramp is flat per face and
// AO keeps its dithered bands, so nothing becomes a smooth gradient.
//
//   import { makeEnemyMaterial, enemyLook } from './material.js';
//   const m = makeEnemyMaterial();            // same flash API as makeVoxelMaterial()
//   enemyLook.selfLit.value = 0.85;           // live, every enemy (debug.enemies('lit', v))

import { makeVoxelMaterial } from '../render/voxel/index.js';

export const enemyLook = {
  selfLit: { value: 0.9 },     // 0 = plain scene lighting
};

const EMIT_LINE = 'outgoingLight = mix(outgoingLight, voxelBase * emitBoost, vEmit);';

export function makeEnemyMaterial() {
  const m = makeVoxelMaterial();
  const base = m.onBeforeCompile;
  m.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.uniforms.selfLit = enemyLook.selfLit;
    shader.fragmentShader = shader.fragmentShader
      .replace('uniform float aoMin;', 'uniform float aoMin;\nuniform float selfLit;')
      .replace(EMIT_LINE, `{
  vec3 wN = inverseTransformDirection(normal, viewMatrix);
  float face = wN.y > 0.5 ? 1.0 : (wN.z > 0.5 ? 0.78 : (wN.x < -0.5 ? 0.7 : 0.56));
  if (wN.y < -0.5) face = 0.4;
  outgoingLight = max(outgoingLight, diffuseColor.rgb * selfLit * face);
}
${EMIT_LINE}`);
  };
  m.customProgramCacheKey = () => 'gr-voxel-v2-enemy';
  return m;
}
