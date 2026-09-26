// The ambient scene layer: rising embers and drifting dust motes that make a room never fully
// still (GAME.md feel rules). One InstancedMesh, a fixed set of motes that live in a box around
// the camera target and wrap round it, so the layer follows the camera and costs the same
// anywhere. Motion is analytic (a function of time), so it holds through hitstop and pause
// without state, and it draws on whole texels like everything else.
//
//   vfx.ambient.set({ embers: 40, dust: 50 })          // or a preset: vfx.ambient.mood('crypt')
//   moods: 'crypt' (few slow embers, dust), 'collapse' (many embers blown sideways, falling grit),
//          'boss' (embers thick and hot), 'calm' (dust only), 'off'

import * as THREE from 'three';
import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { DT } from '../core/loop.js';

const MAX = 220;
const cp = Math.cos(CAMERA_PITCH), sp = Math.sin(CAMERA_PITCH);
const MOODS = {
  crypt: { embers: 34, dust: 44, wind: [0.12, 0.02], rise: 0.42, grit: 0 },
  calm: { embers: 0, dust: 40, wind: [0.05, 0.01], rise: 0.3, grit: 0 },
  collapse: { embers: 120, dust: 30, wind: [-1.4, 0.2], rise: 0.25, grit: 26 },
  boss: { embers: 80, dust: 28, wind: [0.2, -0.1], rise: 0.8, grit: 0 },
  off: { embers: 0, dust: 0, wind: [0, 0], rise: 0, grit: 0 },
};

const hash = (i, s) => { let h = (i * 374761393 + s * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

function rgb(name) { const c = new THREE.Color(hex(name)); return [c.r, c.g, c.b]; }

export function createAmbient(root) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
  look.noOutline(mesh);
  root.add(mesh);
  const arr = mesh.instanceMatrix.array, carr = mesh.instanceColor.array;

  const EMBER_C = [rgb('gold'), rgb('flame'), rgb('ember'), rgb('red')];
  const DUST_C = [rgb('fog'), rgb('mist'), rgb('frost'), rgb('slate')];
  const GRIT_C = [rgb('stoneLight'), rgb('stone'), rgb('fog')];

  // box around the camera target: half extents in world units (a bit bigger than the screen)
  const BY = 3.2;
  let cfg = { ...MOODS.crypt };
  let name = 'crypt';
  let time = 0;      // seconds of sim time
  const opts = { area: null };
  const state = { embers: 0, dust: 0, grit: 0 };

  function set(o = {}) {
    cfg = { ...cfg, ...o };
    state.embers = Math.min(cfg.embers | 0, MAX);
    state.dust = Math.min(cfg.dust | 0, MAX - state.embers);
    state.grit = Math.min(cfg.grit | 0, MAX - state.embers - state.dust);
    return { ...state };
  }
  function mood(m) {
    if (!MOODS[m]) return false;
    name = m;
    cfg = { ...MOODS[m] };
    set({});
    return true;
  }
  mood('crypt');

  const wrap = (v, size) => ((v % size) + size) % size;

  function render(alpha) {
    const P = PPU * display.zoom;
    const t = time + alpha * DT;
    const tg = display.cameraTarget;
    // the box is the visible ground area plus a margin, so counts mean 'on screen' at any zoom
    const BX = 10.5 / display.zoom + 1.2, BZ = 7.6 / display.zoom + 1.2;
    const cx = tg.x, cz = tg.z;
    let m = 0;
    const put = (x, y, z, w, c) => {
      const s = Math.round(w * P);
      if (s < 1) return;
      const sz = s / P;
      const u = y * cp - z * sp, b = y * sp + z * cp;
      const us = Math.round(u * P) / P;
      x = Math.round(x * P) / P;
      const yy = us * cp + b * sp, zz = -us * sp + b * cp;
      const o = m * 16;
      arr[o] = sz; arr[o + 1] = 0; arr[o + 2] = 0; arr[o + 3] = 0;
      arr[o + 4] = 0; arr[o + 5] = sz; arr[o + 6] = 0; arr[o + 7] = 0;
      arr[o + 8] = 0; arr[o + 9] = 0; arr[o + 10] = sz; arr[o + 11] = 0;
      arr[o + 12] = x; arr[o + 13] = yy; arr[o + 14] = zz; arr[o + 15] = 1;
      carr[m * 3] = c[0]; carr[m * 3 + 1] = c[1]; carr[m * 3 + 2] = c[2];
      m++;
    };
    const [wx, wz] = cfg.wind;
    // embers: rise, sway, wink out at the top. Each has its own speed, lane and period.
    for (let i = 0; i < state.embers; i++) {
      const sx = hash(i, 1), sz = hash(i, 2), ph = hash(i, 3), spd = 0.6 + hash(i, 4) * 0.8;
      const life = 2.4 + hash(i, 5) * 2.6;                     // seconds to cross the box
      const age = wrap(t + ph * life, life) / life;            // 0..1
      const cyc = Math.floor((t + ph * life) / life);
      const lane = hash(i + cyc * 977, 6);
      const x = cx + (wrap(lane * BX * 2 + sx * 3 + wx * t * spd - cx, BX * 2) - BX) + Math.sin(t * 2.3 + i) * 0.12 * (1 + spd);
      const z = cz + (wrap(hash(i + cyc * 613, 7) * BZ * 2 + wz * t * spd - cz, BZ * 2) - BZ) + 0.0 * sz;
      const y = 0.15 + age * cfg.rise * spd * life * 0.9 + Math.sin(t * 3 + i * 1.7) * 0.03;
      // hot at birth, cooling, shrinking to a single pixel; a 1-in-4 flicker to the next colour
      const stage = age < 0.25 ? 0 : age < 0.6 ? 1 : age < 0.9 ? 2 : 3;
      const flick = ((Math.floor(t * 14) + i) & 7) === 0 ? 1 : 0;
      const c = EMBER_C[Math.min(3, stage + flick)];
      const w = (age < 0.7 ? (i % 3 === 0 ? 3 : 2) : 1.5) / PPU * (age > 0.95 ? 0.4 : 1);
      // fade in over the first few percent so nothing pops into being
      if (age < 0.04 && ((i + Math.floor(t * 30)) & 1)) continue;
      put(x, y, z, w, c);
    }
    // dust motes: slow drift on a lazy loop, one or two texels, dim
    for (let i = 0; i < state.dust; i++) {
      const bx = hash(i, 11) * BX * 2, bz = hash(i, 12) * BZ * 2, by = 0.3 + hash(i, 13) * BY;
      const x = cx + (wrap(bx + wx * t * 0.8 + Math.sin(t * 0.35 + i) * 0.5 - cx, BX * 2) - BX);
      const z = cz + (wrap(bz + wz * t * 0.8 + Math.cos(t * 0.27 + i * 2) * 0.35 - cz, BZ * 2) - BZ);
      const y = by + Math.sin(t * 0.4 + i * 3.1) * 0.25;
      const twinkle = ((Math.floor(t * 3) + i * 7) % 9) === 0;
      put(x, y, z, (i % 4 === 0 || twinkle ? 2 : 1) / PPU, DUST_C[twinkle ? 2 : i % 3]);
    }
    // grit: falling rubble motes for the collapse
    for (let i = 0; i < state.grit; i++) {
      const life = 1.1 + hash(i, 21) * 0.9;
      const age = wrap(t + hash(i, 22) * life, life) / life;
      const cyc = Math.floor((t + hash(i, 22) * life) / life);
      const x = cx + (wrap(hash(i + cyc * 31, 23) * BX * 2 + wx * t * 1.2 - cx, BX * 2) - BX);
      const z = cz + (wrap(hash(i + cyc * 57, 24) * BZ * 2 - cz, BZ * 2) - BZ);
      const y = 3.4 - age * age * 3.3;
      put(x, Math.max(0.03, y), z, (i % 3 === 0 ? 3 : 2) / PPU, GRIT_C[i % 3]);
    }
    mesh.count = m;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
  }

  return {
    set, mood,
    get name() { return name; },
    get counts() { return { ...state }; },
    tick() { time += DT; },
    render,
    dispose() { root.remove(mesh); geo.dispose(); mat.dispose(); mesh.dispose(); },
  };
}
