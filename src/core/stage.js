// A small lit "stage" used by foundation's showcase and placeholder scenes: flagstone floor,
// standing torches with voxel flames, rising embers and drifting dust. It keeps the
// engine's own screens alive (GAME.md: "the world is never fully still").
// Not the game's environment or particle system: `arenas` and `vfx` own those.
//
//   const stage = buildStage(root, { torches: [[-3, -2], [3, -2]], rng });
//   tick: stage.tick();     render: stage.render(alpha);

import * as THREE from 'three';
import { voxelMesh, VOXEL } from '../render/voxel/index.js';
import '../render/voxel/testmodels.js';
import { hex } from '../render/palette.js';
import { Rng } from './rng.js';
import { display, PPU } from './display.js';
import { look } from '../render/look.js';

const FLAME_CUBES = 6;
const EMBERS = 48;
const DUST = 36;

export function buildStage(root, { torches = [[-3.2, -2.4], [3.2, -2.4]], floor = true, rng = new Rng('stage'), dustBox = [8, 3, 6] } = {}) {
  if (floor) {
    const f = voxelMesh('test.floor');
    f.position.y = -3 * VOXEL;
    root.add(f);
  }
  const torchTops = [];
  for (const [x, z] of torches) {
    const t = voxelMesh('test.torch');
    t.position.set(x, 0, z);
    root.add(t);
    if (look.lights) look.torch(t, { y: 9 * VOXEL, intensity: 0.9, radius: 6 }); // real flickering light (look)
    torchTops.push(new THREE.Vector3(x, 8 * VOXEL, z));
  }

  const box = new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const count = torchTops.length * FLAME_CUBES + EMBERS + DUST;
  const inst = new THREE.InstancedMesh(box, mat, Math.max(1, count));
  inst.frustumCulled = false;
  look.noOutline(inst);
  root.add(inst);
  const col = new THREE.Color();
  const tmpM = new THREE.Matrix4();
  const cEmber = hex('ember'), cFlame = hex('flame'), cTorch = hex('torch'), cGold = hex('gold');
  const cDust = hex('mist'), cDust2 = hex('fog');

  // particle state (prev/cur for interpolation)
  const P = [];
  const mk = (kind) => ({ kind, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s: 1, c: cEmber });
  for (let i = 0; i < torchTops.length * FLAME_CUBES; i++) P.push(mk('flame'));
  for (let i = 0; i < EMBERS; i++) P.push(mk('ember'));
  for (let i = 0; i < DUST; i++) {
    const d = mk('dust');
    d.x = d.px = rng.range(-dustBox[0], dustBox[0]);
    d.y = d.py = rng.range(0.2, dustBox[1]);
    d.z = d.pz = rng.range(-dustBox[2], dustBox[2]);
    d.vx = rng.range(-0.1, 0.1); d.vz = rng.range(-0.05, 0.05); d.vy = rng.range(-0.03, 0.05);
    d.s = rng.chance(0.3) ? 1 : 0.5;
    d.c = rng.chance(0.5) ? cDust : cDust2;
    d.phase = rng.range(0, 6.28);
    P.push(d);
  }
  let t = 0;
  let emberIndex = torchTops.length * FLAME_CUBES;

  function layoutFlames() {
    torchTops.forEach((top, ti) => {
      // a flickering stack: 2 ember at the base, 2 flame, 1 gold, 1 torch-white tip
      const h = rng.int(0, 1);
      const spec = [
        [0, 0, 0, cEmber], [rng.int(-1, 1) * 0.5, 0, rng.int(-1, 1) * 0.5, cEmber],
        [0, 1, 0, cFlame], [rng.int(-1, 1) * 0.5, 1, 0, cFlame],
        [rng.int(-1, 1) * 0.5, 2, 0, cGold], [rng.int(-1, 1) * 0.5, 2 + h, 0, cTorch],
      ];
      spec.forEach(([dx, dy, dz, c], k) => {
        const p = P[ti * FLAME_CUBES + k];
        p.x = p.px = top.x + dx * VOXEL;
        p.y = p.py = top.y + dy * VOXEL;
        p.z = p.pz = top.z + dz * VOXEL;
        p.c = c;
        p.s = k === 5 ? 0.7 : 1;
      });
    });
  }
  layoutFlames();

  return {
    torchTops,
    tick() {
      t++;
      if (t % 5 === 0) layoutFlames();
      // spawn embers from torch tops
      if (torchTops.length && t % 7 === 0) {
        const top = rng.pick(torchTops);
        const e = P[emberIndex];
        emberIndex = torchTops.length * FLAME_CUBES + ((emberIndex - torchTops.length * FLAME_CUBES + 1) % EMBERS);
        e.x = e.px = top.x + rng.range(-0.1, 0.1);
        e.y = e.py = top.y + 2 * VOXEL;
        e.z = e.pz = top.z + rng.range(-0.1, 0.1);
        e.vx = rng.range(-0.25, 0.25); e.vy = rng.range(0.5, 1.0); e.vz = rng.range(-0.15, 0.15);
        e.life = 0; e.max = rng.range(0.9, 1.8);
        e.phase = rng.range(0, 6.28);
      }
      const dt = 1 / 60;
      for (const p of P) {
        p.px = p.x; p.py = p.y; p.pz = p.z;
        if (p.kind === 'ember') {
          if (p.life >= p.max) continue;
          p.life += dt;
          p.vx += Math.sin(p.life * 5 + p.phase) * 0.02;
          p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          const k = p.life / p.max;
          p.c = k < 0.3 ? cGold : k < 0.7 ? cFlame : cEmber;
          p.s = k < 0.75 ? 0.6 : 0.4;
        } else if (p.kind === 'dust') {
          p.x += (p.vx + Math.sin(t * 0.01 + p.phase) * 0.05) * dt;
          p.y += (p.vy + Math.cos(t * 0.013 + p.phase) * 0.03) * dt;
          p.z += p.vz * dt;
          if (p.x > dustBox[0]) p.x = p.px = -dustBox[0];
          if (p.x < -dustBox[0]) p.x = p.px = dustBox[0];
          if (p.y > dustBox[1] || p.y < 0.1) p.vy = -p.vy;
        }
      }
    },
    render(alpha) {
      const m = tmpM;
      const px = 1 / (PPU * display.zoom * VOXEL); // one screen texel, in voxel units
      P.forEach((p, i) => {
        const dead = p.kind === 'ember' && p.life >= p.max;
        // dust is 1-2 texels whatever the zoom; flames and embers stay voxel-sized
        const s = dead ? 0 : p.kind === 'dust' ? px * (p.s === 1 ? 2 : 1) : p.s;
        m.makeScale(s, s, s);
        m.setPosition(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, col.setHex(p.c));
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },
  };
}
