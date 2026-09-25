// The shared voxel material: Lambert (flat per-face light, since greedy quads carry face
// normals) with the baked AO applied in 4 ordered-dithered bands instead of a smooth
// gradient (GAME.md: "Dithered or flat shading, never smooth gradients"), and emissive
// voxels drawn unlit at their palette colour.
//
// Tunables live in voxelUniforms and apply to every voxel mesh live:
//   voxelUniforms.aoMin.value     brightness of a fully occluded corner (default 0.3)
//   voxelUniforms.emitBoost.value multiplier on emissive voxels (default 1)
// Per-entity hit flash: give the mesh its own material (voxelMesh(name, {ownMaterial: true})
// or makeVoxelMaterial()) and set material.userData.flash.value (0..1) and
// material.userData.flashColor.value (THREE.Color).

import * as THREE from 'three';

export const voxelUniforms = {
  aoMin: { value: 0.3 },
  emitBoost: { value: 1.0 },
};

function patch(material, perMesh) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.aoMin = voxelUniforms.aoMin;
    shader.uniforms.emitBoost = voxelUniforms.emitBoost;
    shader.uniforms.flashAmount = perMesh.flash;
    shader.uniforms.flashColor = perMesh.flashColor;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ao;\nattribute float emit;\nvarying float vAo;\nvarying float vEmit;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvAo = ao;\nvEmit = emit;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float aoMin;
uniform float emitBoost;
uniform float flashAmount;
uniform vec3 flashColor;
varying float vAo;
varying float vEmit;
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x) + int(q.y) * 4;
  int m[16] = int[16](0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5);
  return (float(m[i]) + 0.5) / 16.0;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 voxelBase = diffuseColor.rgb;
float aoLevel = clamp(floor(vAo * 3.0 + bayer4(gl_FragCoord.xy)), 0.0, 3.0) / 3.0;
diffuseColor.rgb *= mix(aoMin, 1.0, aoLevel);`)
      .replace('#include <opaque_fragment>', `outgoingLight = mix(outgoingLight, voxelBase * emitBoost, vEmit);
outgoingLight = mix(outgoingLight, flashColor, flashAmount);
#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'gr-voxel-v1';
  material.userData.flash = perMesh.flash;
  material.userData.flashColor = perMesh.flashColor;
  return material;
}

/**
 * A new voxel material with its own flash uniform (for hit flashes on one entity).
 *   const m = makeVoxelMaterial(); mesh.material = m; m.userData.flash.value = 1;
 * Shares the compiled program with every other voxel material.
 */
export function makeVoxelMaterial() {
  return patch(new THREE.MeshLambertMaterial({ vertexColors: true }), {
    flash: { value: 0 },
    flashColor: { value: new THREE.Color(1, 1, 1) },
  });
}

/** The default shared material used by voxelMesh(). Do not set its flash; clone per entity. */
export const voxelMaterial = makeVoxelMaterial();
