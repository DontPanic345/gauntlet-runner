// Floor telegraphs (piece `enemies`): flat voxel tiles on the world voxel grid that fill in
// front of an attack and ARE its hitbox. Same look as combat's sparring dummy so the danger
// language is shared: dim blood/plum fill, red edge and fill front, gold for the last
// frames (and while firing). Unlit palette colours, no outline.
//
//   const tele = makeTele(root, sectorCells(1.4, 68));
//   tele.set(progress /*0..1, <0 hides*/, firing, x, z, yaw, tick);   tele.hide();  tele.dispose();

import * as THREE from 'three';
import { VOXEL as V } from '../render/voxel/index.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';

export function sectorCells(R, halfDeg, inner = 0.3) {
  const cells = [];
  for (let z = -R; z <= R; z += V) for (let x = -R; x <= R; x += V) {
    const d = Math.hypot(x, z);
    if (d > R || d < inner) continue;
    const a = Math.atan2(x, z) * 180 / Math.PI;
    if (Math.abs(a) > halfDeg) continue;
    const edge = d > R - V * 1.2 || Math.abs(a) > halfDeg - (V / d) * 180 / Math.PI * 1.2;
    cells.push({ x, z, u: d / R, edge });
  }
  return cells;
}
export function laneCells(len, width, { dotted = false, from = 0.4 } = {}) {
  const cells = [];
  for (let z = from; z <= len; z += V) for (let x = -width / 2; x <= width / 2 + 1e-6; x += V) {
    if (dotted && Math.floor(z / V) % 3 !== 0) continue;
    const edge = !dotted && (Math.abs(x) >= width / 2 - V * 0.6 || z > len - V * 1.3);
    cells.push({ x, z, u: z / len, edge });
  }
  return cells;
}
export function discCells(R) {
  const cells = [];
  for (let z = -R; z <= R; z += V) for (let x = -R; x <= R; x += V) {
    const d = Math.hypot(x, z);
    if (d > R) continue;
    cells.push({ x, z, u: d / R, edge: d > R - V * 1.2 });
  }
  return cells;
}

export function makeTele(root, cells) {
  const geo = new THREE.BoxGeometry(V, 0.01, V);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(geo, mat, cells.length);
  inst.frustumCulled = false;
  look.noOutline(inst);
  inst.visible = false;
  root.add(inst);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  const cRed = hex('red'), cBlood = hex('blood'), cGold = hex('gold'), cPlum = hex('plum'), cWhite = hex('white');
  return {
    cells,
    clip: 1,          // 0..1: cut the marker short (a lane that ends at a wall)
    set(progress, firing, x, z, yaw, st = 0) {
      if (progress < 0) { inst.visible = false; return; }
      inst.visible = true;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const late = progress > 0.78 && !firing;
      let n = 0;
      const clip = this.clip;
      for (const cell of cells) {
        if (cell.u > clip) { m.makeScale(0, 0, 0); inst.setMatrixAt(n, m); inst.setColorAt(n++, c.setHex(cBlood)); continue; }
        const edge = cell.edge || cell.u > clip - 0.02;
        const show = edge || firing || cell.u <= progress;
        if (!show) { m.makeScale(0, 0, 0); inst.setMatrixAt(n, m); inst.setColorAt(n++, c.setHex(cBlood)); continue; }
        const wx = Math.round((x + cell.x * cs + cell.z * sn) / V) * V;
        const wz = Math.round((z - cell.x * sn + cell.z * cs) / V) * V;
        m.makeTranslation(wx, 0.014, wz);
        inst.setMatrixAt(n, m);
        let col;
        if (firing) col = edge ? cWhite : cGold;
        else if (edge) col = late && (st >> 1) % 2 ? cGold : cRed;
        else if (Math.abs(cell.u - progress) < 0.06) col = cRed;
        else col = (Math.round(cell.x / V) + Math.round(cell.z / V)) & 1 ? cBlood : cPlum;
        inst.setColorAt(n++, c.setHex(col));
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },
    hide() { inst.visible = false; },
    get visible() { return inst.visible; },
    dispose() { root.remove(inst); geo.dispose(); mat.dispose(); },
  };
}
