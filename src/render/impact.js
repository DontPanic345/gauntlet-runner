// What a fight leaves on the floor (piece `look`): a render-level impact layer that every scene
// gets for free, driven only by combat events. look.install() creates it.
//
//   - Droplets: chunky voxel drops thrown along each blow. They arc, land, and splat.
//   - Stains: flat floor cells on the voxel grid (half-voxel and voxel squares) that stay for
//     the whole scene. A fresh stain is wet (one palette step brighter) and dries after ~1.5 s.
//     A kill spreads a pool ring by ring under the body.
//   - Chips: voxel debris in the target's colours that bounce, skid and then lie where they
//     stop, for the rest of the scene.
//   - Contact shadows: a solid `night` ellipse under the hero and every target in
//     world.enemies, so actors sit on the floor instead of floating on the grout.
//
// Everything is pooled (fixed instanced meshes, no per-frame allocation), palette-only, lit by
// the scene's lights (torches warm a stain), on LAYER_NO_OUTLINE, and cleared when the base
// scene exits. The sim side runs on the core `tick` event, so it holds through hitstop and pause.
//
//   look.impact.splat(x, z, { r, colors, delay })     a stain blob (decals for other pieces)
//   look.impact.spray(x, y, z, dx, dz, { n, speed, colors, spread })
//   look.impact.chips(x, y, z, dx, dz, { n, colors, speed })
//   look.impact.options    { stains, chips, shadows, killFrame, killShake }  (all true by default)
//   look.impact.clear()    look.impact.stats()

import * as THREE from 'three';
import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { events } from '../core/events.js';
import { world } from '../core/world.js';
import { loop } from '../core/loop.js';
import { feedback } from '../core/feedback.js';
import { hex } from './palette.js';
import { LAYER_NO_OUTLINE } from './post.js';

const V = 1 / 8;           // one voxel, world units
const H = V / 2;           // stain grid step
const G = 34;              // gravity, units/s^2
const DT = 1 / 60;
const STAIN_CAP = 6144, DROP_CAP = 320, CHIP_CAP = 480, SHADOW_CAP = 48;
const DRY_TICKS = 90;

// what bleeds what. A target can override with `stain: ['name', ...]` (wet first, dry second).
const STAINS = {
  default: ['red', 'blood'],
  husk: ['red', 'blood'],
  brute: ['red', 'blood'],
  warden: ['rose', 'plum'],
  mite: ['teal', 'navy'],
  wisp: ['slate', 'dusk'],
  target: ['gold', 'woodLight'],     // training dummies: straw
  sparring: ['woodLight', 'wood'],
  hero: ['red', 'blood'],
};
// one palette step down: what a wet colour dries to
const DRY = { teal: 'navy', red: 'blood', rose: 'plum', cyan: 'teal', slate: 'dusk', gold: 'woodLight', woodLight: 'wood', leaf: 'moss', bone: 'fog' };

// a resting chip sits one step darker than a flying one, so the floor stays quieter than the actors
const CHIP_DIM = { bone: 'fog', frost: 'mist', white: 'fog', leaf: 'moss', gold: 'woodLight', torch: 'gold', cyan: 'teal', sky: 'teal', rose: 'plum', flame: 'ember', stoneLight: 'stone', fog: 'slate', woodLight: 'wood' };

const cp = Math.cos(CAMERA_PITCH), sp = Math.sin(CAMERA_PITCH);
function snapTo(x, y, z, out) {
  const P = PPU * display.zoom;
  const u = y * cp - z * sp, b = y * sp + z * cp;
  const rs = Math.round(x * P) / P, us = Math.round(u * P) / P;
  out.set(rs, us * cp + b * sp, -us * sp + b * cp);
  return out;
}

let seed = 9157;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const rr = (a, b) => a + (b - a) * rnd();
const pick = (a) => a[Math.floor(rnd() * a.length) % a.length];
const colorCache = new Map();
const col = (name) => { let c = colorCache.get(name); if (!c) { c = new THREE.Color(hex(name)); colorCache.set(name, c); } return c; };

function stainColors(target, kind) {
  if (target?.stain) return target.stain;
  const k = kind ?? target?.kind ?? target?.type;
  if (target?.variant === 'iron' || k === 'sparring') return STAINS.sparring;
  return STAINS[k] ?? STAINS.default;
}

function contactTexture() {
  // a 64x64 hard ellipse mask; alphaTest at the internal resolution makes a crisp pixel edge
  const N = 64, data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x + 0.5) / N * 2 - 1, dy = (y + 0.5) / N * 2 - 1;
    const o = (y * N + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = 255;
    data[o + 3] = dx * dx + dy * dy <= 1 ? 255 : 0;
  }
  const t = new THREE.DataTexture(data, N, N);
  t.magFilter = t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

export function createImpact() {
  const options = { stains: true, chips: true, shadows: true, killFrame: true, killShake: true };

  // ---- meshes ------------------------------------------------------------------------
  const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const stainMat = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const stainMesh = new THREE.InstancedMesh(flat, stainMat, STAIN_CAP);
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const dropMesh = new THREE.InstancedMesh(cube, new THREE.MeshLambertMaterial({ color: 0xffffff }), DROP_CAP);
  const chipMesh = new THREE.InstancedMesh(cube, new THREE.MeshLambertMaterial({ color: 0xffffff }), CHIP_CAP);
  const shadowMat = new THREE.MeshBasicMaterial({ color: hex('night'), map: contactTexture(), alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  const shadowMesh = new THREE.InstancedMesh(flat, shadowMat, SHADOW_CAP);
  const meshes = [shadowMesh, stainMesh, dropMesh, chipMesh];
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  for (const m of meshes) {
    m.frustumCulled = false;
    m.layers.set(LAYER_NO_OUTLINE);
    m.userData.noShadow = true;
    m.name = 'look:impact';
    for (let i = 0; i < m.count; i++) m.setMatrixAt(i, zero);
    m.setColorAt(0, col('blood'));
    m.count = 0;
  }
  stainMesh.renderOrder = 1; shadowMesh.renderOrder = 2;
  display.scene.add(...meshes);

  // ---- state ---------------------------------------------------------------------------
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), T = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  let stainN = 0, stainHead = 0;
  const wet = [];                 // [index, dryAtTick, dryName]
  const pending = [];             // stains waiting to appear: {x, z, s, c, dry, at}
  const drops = [];               // airborne droplets
  const chips = [];               // chips; settled ones stay with .rest = true
  let chipHead = 0, tick = 0;
  let killAt = -1e9, killX = 0, killY = 0, killZ = 0;

  // one cell per grid square: a new stain on a stained square recolours it (bounded by area,
  // and no two cells ever fight for the same depth)
  const cellAt = new Map();
  const cellKey = new Array(STAIN_CAP);
  function putStain(x, z, s, c, dryName) {
    if (!options.stains) return;
    if (s > H) {   // a voxel-sized drop is four half cells
      putStain(x - H / 2, z - H / 2, H, c, dryName); putStain(x + H / 2, z - H / 2, H, c, dryName);
      putStain(x - H / 2, z + H / 2, H, c, dryName); putStain(x + H / 2, z + H / 2, H, c, dryName);
      return;
    }
    const ix = Math.round(x / H), iz = Math.round(z / H);
    const key = ix * 65536 + iz;
    let i = cellAt.get(key);
    if (i === undefined) {
      i = stainHead;
      stainHead = (stainHead + 1) % STAIN_CAP;
      stainN = Math.min(STAIN_CAP, stainN + 1);
      if (cellKey[i] !== undefined) cellAt.delete(cellKey[i]);
      cellKey[i] = key; cellAt.set(key, i);
    }
    const gx = ix * H, gz = iz * H;
    M.makeScale(H, 1, H);
    M.setPosition(gx, 0.003, gz);
    stainMesh.setMatrixAt(i, M);
    stainMesh.setColorAt(i, col(c));
    stainMesh.count = stainN;
    stainMesh.instanceMatrix.needsUpdate = true;
    stainMesh.instanceColor.needsUpdate = true;
    if (dryName && dryName !== c) wet.push([i, tick + DRY_TICKS + Math.floor(rnd() * 40), dryName]);
  }

  /** A stain blob on the voxel grid: an irregular disc of cells, spreading ring by ring. */
  function splat(x, z, { r = 0.3, colors = STAINS.default, delay = 0, grow = 1.5, ragged = 0.35 } = {}) {
    const wetC = colors[0], dryC = colors[1] ?? DRY[wetC] ?? wetC;
    const n = Math.ceil(r / H) + 1;
    const ax = rr(0.8, 1.25), az = 1 / ax;
    for (let iz = -n; iz <= n; iz++) for (let ix = -n; ix <= n; ix++) {
      const d = Math.hypot(ix * H * ax, iz * H * az);
      const edge = r * (1 - ragged * rnd());
      if (d > edge) continue;
      const inner = d < r * 0.45;
      pending.push({ x: x + ix * H, z: z + iz * H, s: H, c: inner || rnd() < 0.5 ? wetC : dryC, dry: dryC, at: tick + delay + Math.floor((d / r) * grow * n) });
    }
  }

  /** Droplets thrown from (x,y,z) along (dx,dz); each one splats where it lands. */
  function spray(x, y, z, dx, dz, { n = 8, speed = 4, colors = STAINS.default, spread = 0.7, up = 2.5 } = {}) {
    const base = Math.atan2(dx, dz);
    for (let k = 0; k < n; k++) {
      if (drops.length >= DROP_CAP) break;
      const a = base + rr(-spread, spread);
      const v = speed * rr(0.45, 1.15);
      drops.push({ x, y, z, px: x, py: y, pz: z, vx: Math.sin(a) * v, vy: rr(0.3, 1) * up, vz: Math.cos(a) * v,
        s: rnd() < 0.55 ? V : H, c: colors[0], dry: colors[1] ?? DRY[colors[0]] ?? colors[0], streak: rnd() < 0.5 });
    }
  }

  /** Voxel debris that bounces, skids and stays where it stops. */
  function chipBurst(x, y, z, dx, dz, { n = 3, colors = ['stone'], speed = 3, spread = 1.1 } = {}) {
    if (!options.chips) return;
    const base = Math.atan2(dx, dz);
    for (let k = 0; k < n; k++) {
      const a = base + rr(-spread, spread);
      const v = speed * rr(0.4, 1.1);
      const c = { x, y, z, px: x, py: y, pz: z, vx: Math.sin(a) * v, vy: rr(2, 5), vz: Math.cos(a) * v,
        s: pick([V * 0.75, V, V]), c: pick(colors), rest: false, yaw: 0, spin: rr(-1, 1) > 0 ? 1 : -1 };
      if (chips.length < CHIP_CAP) chips.push(c);
      else { chips[chipHead] = c; chipHead = (chipHead + 1) % CHIP_CAP; }
    }
  }

  // ---- events --------------------------------------------------------------------------
  const onHit = (e) => {
    const t = e.target;
    const cols = stainColors(t);
    const p = e.power ?? 1;
    const fin = !!e.finisher;
    const dx = e.dx ?? 0, dz = e.dz ?? 1;
    // a spray thrown out the far side of the target, along the blow
    spray(e.x + dx * 0.25, e.y ?? 0.6, e.z + dz * 0.25, dx, dz, { n: Math.round(3 + 3 * p + (fin ? 6 : 0)), speed: 3 + 1.4 * p + (fin ? 2 : 0), colors: cols, spread: fin ? 0.8 : 0.5 });
    // a small splat right under the contact point, a beat later
    splat(t.x + dx * 0.3, t.z + dz * 0.3, { r: 0.1 + 0.06 * p + (fin ? 0.1 : 0), colors: cols, delay: 3 });
    const deb = t.debris ?? ['stone', 'stoneLight'];
    if (fin || rnd() < 0.5) chipBurst(e.x, e.y ?? 0.6, e.z, dx, dz, { n: fin ? 3 : 1, colors: deb, speed: 2.5 + p });
  };
  const onKill = (e) => {
    const t = e.target;
    const cols = stainColors(t);
    const dx = t?.lastHit?.dx ?? 0, dz = t?.lastHit?.dz ?? 1;
    splat(e.x + dx * 0.2, e.z + dz * 0.2, { r: 0.2 + (t?.r ?? 0.35) * 0.7, colors: cols, delay: 4, grow: 2.2 });
    const small = (t?.r ?? 0.35) < 0.3;   // mites: a smaller mark, no kill frame
    spray(e.x, (t?.h ?? 1) * 0.6, e.z, dx, dz, { n: small ? 5 : 14, speed: small ? 3.5 : 5.5, colors: cols, spread: 1.2, up: 4 });
    if (!small) spray(e.x, (t?.h ?? 1) * 0.6, e.z, -dx, -dz, { n: 4, speed: 2.5, colors: cols, spread: 1.2, up: 4 });
    chipBurst(e.x, (t?.h ?? 1) * 0.5, e.z, dx, dz, { n: small ? 2 : 6, colors: t?.debris ?? ['bone', 'stone'], speed: 4, spread: 2 });
    if (!small && options.killShake) feedback.shake(2.5, 200);   // the settings-scaled channel
    if (!small) { killAt = performance.now(); killX = e.x; killY = (t?.h ?? 1) * 0.5; killZ = e.z; }
  };
  const onHurt = (e) => {
    const dx = e.dx ?? 0, dz = e.dz ?? 1;
    spray(e.x, 0.8, e.z, dx, dz, { n: 10, speed: 3.5, colors: STAINS.hero, spread: 0.9 });
    splat(e.x + dx * 0.2, e.z + dz * 0.2, { r: 0.14, colors: STAINS.hero, delay: 3 });
  };
  events.on('combat:hit', onHit);
  events.on('combat:kill', onKill);
  events.on('combat:heroHurt', onHurt);
  events.on('tick', step);
  events.on('scene:exit', (e) => { if (e.name !== 'pause') clear(); });

  // ---- sim ------------------------------------------------------------------------------
  function step() {
    tick++;
    for (let k = pending.length - 1; k >= 0; k--) {
      const p = pending[k];
      if (p.at > tick) continue;
      putStain(p.x, p.z, p.s, p.c, p.dry);
      pending[k] = pending[pending.length - 1]; pending.pop();
    }
    for (let k = wet.length - 1; k >= 0; k--) {
      const w = wet[k];
      if (w[1] > tick) continue;
      stainMesh.setColorAt(w[0], col(w[2]));
      stainMesh.instanceColor.needsUpdate = true;
      wet[k] = wet[wet.length - 1]; wet.pop();
    }
    for (let k = drops.length - 1; k >= 0; k--) {
      const d = drops[k];
      d.px = d.x; d.py = d.y; d.pz = d.z;
      d.vy -= G * DT;
      d.x += d.vx * DT; d.y += d.vy * DT; d.z += d.vz * DT;
      if (d.y > 0) continue;
      // landed: a small blob, smeared a cell or two along the travel for the faster ones
      putStain(d.x, d.z, d.s, d.c, d.dry);
      const sp = Math.hypot(d.vx, d.vz);
      if (d.streak && sp > 3) {
        const ux = d.vx / sp, uz = d.vz / sp;
        const len = Math.min(3, Math.floor(sp / 2.2));
        for (let j = 1; j <= len; j++) putStain(d.x + ux * H * j, d.z + uz * H * j, H, d.c, d.dry);
      }
      drops[k] = drops[drops.length - 1]; drops.pop();
    }
    for (const c of chips) {
      if (c.rest) continue;
      c.px = c.x; c.py = c.y; c.pz = c.z;
      c.vy -= G * DT;
      c.x += c.vx * DT; c.y += c.vy * DT; c.z += c.vz * DT;
      if (tick % 3 === 0) c.yaw += c.spin * Math.PI / 4;
      const floor = c.s / 2;
      if (c.y <= floor) {
        c.y = floor;
        if (Math.abs(c.vy) < 1.2) { c.vy = 0; c.vx *= 0.6; c.vz *= 0.6; } else { c.vy = -c.vy * 0.35; c.vx *= 0.7; c.vz *= 0.7; }
        if (c.vy === 0 && Math.hypot(c.vx, c.vz) < 0.25) { c.rest = true; c.c = CHIP_DIM[c.c] ?? c.c; c.yaw = Math.round(c.yaw / (Math.PI / 4)) * (Math.PI / 4); c.px = c.x; c.py = c.y; c.pz = c.z; }
      }
    }
  }

  function clear() {
    stainN = 0; stainHead = 0; stainMesh.count = 0;
    cellAt.clear(); cellKey.fill(undefined);
    wet.length = 0; pending.length = 0; drops.length = 0; chips.length = 0; chipHead = 0;
    killAt = -1e9;
  }

  // ---- render (called by look's pipeline every frame) ------------------------------------
  function render() {
    const a = loop.alpha ?? 0;
    // droplets
    let n = 0;
    for (const d of drops) {
      snapTo(d.px + (d.x - d.px) * a, Math.max(0, d.py + (d.y - d.py) * a), d.pz + (d.z - d.pz) * a, T);
      M.makeScale(d.s, d.s, d.s); M.setPosition(T);
      dropMesh.setMatrixAt(n, M); dropMesh.setColorAt(n, col(d.c)); n++;
    }
    dropMesh.count = n;
    if (n) { dropMesh.instanceMatrix.needsUpdate = true; dropMesh.instanceColor.needsUpdate = true; }
    // chips
    n = 0;
    if (options.chips) for (const c of chips) {
      snapTo(c.rest ? c.x : c.px + (c.x - c.px) * a, c.rest ? c.y : c.py + (c.y - c.py) * a, c.rest ? c.z : c.pz + (c.z - c.pz) * a, T);
      Q.setFromAxisAngle(UP, c.yaw); S.set(c.s, c.s, c.s);
      M.compose(T, Q, S);
      chipMesh.setMatrixAt(n, M); chipMesh.setColorAt(n, col(c.c)); n++;
    }
    chipMesh.count = n;
    if (n) { chipMesh.instanceMatrix.needsUpdate = true; chipMesh.instanceColor.needsUpdate = true; }
    // contact shadows
    n = 0;
    if (options.shadows) {
      const h = world.hero;
      if (h && !h.dead && Number.isFinite(h.x)) {
        const p = h.ctl?.at ? h.ctl.at(a) : h;
        n = shadowAt(n, p.x, p.z, 0.3, 0);
      }
      for (const e of world.enemies ?? []) {
        if (n >= SHADOW_CAP) break;
        if (!e || e.kind === 'wisp' || e.noContactShadow || e.hidden || e.visible === false || e.group?.visible === false || !Number.isFinite(e.x)) continue;
        if (e.state === 'spawn' || e.spawning || e.dead || e.dying) continue;   // a falling body is not standing on its shadow
        const p = e.at ? e.at(a) : e;
        n = shadowAt(n, p.x, p.z, e.r ?? 0.35, Math.max(0, e.y ?? 0));
      }
    }
    shadowMesh.count = n;
    shadowLog.length = n;
    if (n) shadowMesh.instanceMatrix.needsUpdate = true;
  }
  const shadowLog = [];
  function shadowAt(n, x, z, r, y) {
    shadowLog[n] = [+x.toFixed(2), +z.toFixed(2)];
    const k = Math.max(0.45, 1 - y * 0.35);
    const w = r * 2.3 * k;
    snapTo(x, 0.006, z + 0.04, T);
    M.makeScale(w, 1, w * 0.62); M.setPosition(T.x, 0.006, T.z);
    shadowMesh.setMatrixAt(n, M);
    return n + 1;
  }

  /** 0..1 strength of the kill frame this frame (real time, so it reads through hitstop). */
  function killFrame() {
    if (!options.killFrame) return null;
    const ms = performance.now() - killAt;
    if (ms > 75) return null;
    return { x: killX, y: killY, z: killZ, k: ms < 40 ? 1 : 0.5, ms };
  }

  return {
    options,
    splat, spray, chips: chipBurst, clear, render, killFrame, STAINS,
    stats: () => ({ stains: stainN, pending: pending.length, wet: wet.length, drops: drops.length, chips: chips.length, chipsResting: chips.filter((c) => c.rest).length, shadows: shadowMesh.count, shadowAt: shadowLog.slice() }),
    seed(n) { seed = Math.max(1, n | 0); },
  };
}
