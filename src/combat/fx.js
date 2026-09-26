// Combat effects (piece `combat`): what a hit looks like, driven only by combat:* events so
// the `vfx` and `hud` pieces can take any part over without touching combat.js.
//
//   const cfx = createCombatFx(root, { numbers: true });   // numbers: stand-in damage numbers
//   tick: cfx.tick();   render: cfx.render(alpha);   ui: cfx.ui(g);   exit: cfx.dispose();
//
// 3D (voxel cubes, unlit palette colours, no outline):
//   - sparks: streaks stretched along their velocity, white -> torch -> gold, sprayed along the
//     blade's travel and away from the hero; count and speed scale with the hit's power
//   - debris: chunks in the target's own colours (straw from a dummy) that bounce on the floor
//   - slam ring: a ring of floor dust that runs out from the overhead's impact
// 2D (UI canvas, on the pixel grid, tick-driven so it holds through hitstop):
//   - a slash cut along the blade's travel, and an impact star at the contact point
//   - stand-in damage numbers (the `hud` piece owns the real ones: src/ui/damage-numbers.js)
//   - the hurt vignette: red edges for ~0.4 s, scaled by the `flashes` setting

import * as THREE from 'three';
import { events } from '../core/events.js';
import { display, PPU } from '../core/display.js';
import { settings } from '../core/settings.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css, hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { DT } from '../core/loop.js';

const MAX = 320;
const G = 14;              // gravity for sparks, units/s^2
const Z_SCREEN = 0.77;     // world z -> screen y foreshortening at the camera pitch

export function createCombatFx(root, { numbers = true } = {}) {
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(geo, mat, MAX);
  inst.frustumCulled = false;
  inst.count = 0;
  look.noOutline(inst);
  root.add(inst);

  const P = [];          // particles
  const marks = [];      // 2D impact marks
  const nums = [];       // damage numbers
  let hurtT = 99, hurtLen = 24;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rr = (a, b) => a + (b - a) * rnd();
  let side = 1;

  const C = {
    white: hex('white'), torch: hex('torch'), gold: hex('gold'), flame: hex('flame'), red: hex('red'),
    blood: hex('blood'), frost: hex('frost'), fog: hex('fog'), mist: hex('mist'), sky: hex('sky'), cyan: hex('cyan'),
  };

  function add(p) {
    if (P.length >= MAX) P.shift();
    p.px = p.x; p.py = p.y; p.pz = p.z; p.life = 0;
    P.push(p);
  }

  function sparks(x, y, z, dx, dz, tx, tz, n, power, palette = 'hit') {
    for (let i = 0; i < n; i++) {
      // spray: mostly along the blade's travel, pushed away from the hero, fanned out
      const along = 0.55 + rnd() * 0.6;
      let vx = tx * along + dx * (0.6 + rnd() * 0.7) + rr(-0.45, 0.45);
      let vz = tz * along + dz * (0.6 + rnd() * 0.7) + rr(-0.45, 0.45);
      const l = Math.hypot(vx, vz) || 1;
      const sp = (5 + rnd() * 5) * (0.8 + power * 0.35);
      vx = (vx / l) * sp; vz = (vz / l) * sp;
      add({ kind: 'spark', x, y: y + rr(-0.1, 0.15), z, vx, vy: rr(0.5, 4.5) * (0.7 + power * 0.3), vz,
        max: rr(0.14, 0.3) * (0.8 + power * 0.25), w: i < 2 ? 0.07 : 0.05, pal: palette });
    }
  }
  function debris(x, y, z, dx, dz, colors, n, power) {
    for (let i = 0; i < n; i++) {
      const a = Math.atan2(dx, dz) + rr(-1.1, 1.1);
      const sp = rr(1.5, 3.5) * (0.7 + power * 0.3);
      add({ kind: 'chunk', x: x + rr(-0.1, 0.1), y: y + rr(-0.15, 0.2), z: z + rr(-0.1, 0.1),
        vx: Math.sin(a) * sp, vy: rr(2, 5), vz: Math.cos(a) * sp, max: rr(0.5, 0.9), w: rnd() < 0.3 ? 0.125 : 0.0625,
        c: hex(colors[i % colors.length]), bounce: 0 });
    }
  }
  function ring(x, z, radius, n, color = 'fog', speed = 5) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rr(-0.05, 0.05);
      add({ kind: 'ring', x: x + Math.sin(a) * radius * 0.3, y: 0.03, z: z + Math.cos(a) * radius * 0.3,
        vx: Math.sin(a) * speed * rr(0.85, 1.1), vy: 0, vz: Math.cos(a) * speed * rr(0.85, 1.1), max: rr(0.22, 0.32),
        w: 0.0625, c: hex(color) });
    }
  }

  const offs = [];
  const on = (n, f) => offs.push(events.on(n, f));
  on('combat:hit', (h) => {
    const p = h.power;
    let tx = h.tx, tz = h.tz;
    const chop = !tx && !tz;
    if (chop) { tx = h.dx; tz = h.dz; }   // the overhead chops straight in
    sparks(h.x, h.y, h.z, h.dx, h.dz, tx, tz, Math.round(5 + p * 4), p);
    const cols = h.target?.debris;
    if (cols) debris(h.x, h.y, h.z, h.dx, h.dz, cols, Math.round(2 + p * 2), p);
    marks.push({ x: h.x, y: h.y, z: h.z, tx, tz, t: 0, power: p, finisher: h.finisher, color: 'white', chop });
  });
  on('hero:slam', (e) => {
    const fx = e.x + Math.sin(e.yaw) * 0.9, fz = e.z + Math.cos(e.yaw) * 0.9;
    ring(fx, fz, 1, 22, 'fog', 5.5);
    debris(fx, 0.05, fz, Math.sin(e.yaw), Math.cos(e.yaw), ['stoneLight', 'stone', 'fog'], 6, 1);
  });
  on('combat:heroHurt', (e) => {
    hurtT = 0;
    const x = e.x, z = e.z;
    sparks(x - e.dx * 0.2, 0.7, z - e.dz * 0.2, e.dx, e.dz, -e.dz, e.dx, 9, 1.3, 'hurt');
    marks.push({ x: x - e.dx * 0.2, y: 0.7, z: z - e.dz * 0.2, tx: -e.dz, tz: e.dx, t: 0, power: 1.4, finisher: false, color: 'red' });
  });
  on('combat:dodge', (e) => {
    if (numbers) nums.push({ x: e.x, y: 1.6, z: e.z, text: 'DODGE', color: 'sky', t: 0, scale: 1, dx: 0 });
    for (let i = 0; i < 6; i++) add({ kind: 'spark', x: e.x, y: 0.7, z: e.z, vx: rr(-2, 2), vy: rr(1, 3), vz: rr(-2, 2), max: 0.25, w: 0.05, pal: 'dodge' });
  });
  on('combat:damage', (e) => {
    if (!numbers) return;
    side = -side;
    nums.push({ x: e.x, y: e.y, z: e.z, text: String(e.amount), t: 0, scale: e.crit || e.side === 'hero' ? 2 : 1,
      color: e.side === 'hero' ? 'red' : e.crit ? 'gold' : 'bone', dx: side * (e.crit ? 0 : 5), crit: e.crit });
  });

  const tmpM = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), pos = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const col = new THREE.Color();

  function colorOf(p) {
    const k = p.life / p.max;
    if (p.pal === 'hit') return k < 0.2 ? C.white : k < 0.5 ? C.torch : k < 0.8 ? C.gold : C.flame;
    if (p.pal === 'hurt') return k < 0.25 ? C.white : k < 0.6 ? C.red : C.blood;
    if (p.pal === 'dodge') return k < 0.4 ? C.white : C.sky;
    if (p.kind === 'ring') return k < 0.5 ? C.frost : p.c;
    return p.c;
  }

  return {
    tick() {
      for (const p of P) {
        p.px = p.x; p.py = p.y; p.pz = p.z;
        p.life += DT;
        if (p.kind === 'spark') {
          p.vy -= G * DT; p.vx *= 0.9; p.vz *= 0.9;
        } else if (p.kind === 'chunk') {
          p.vy -= 20 * DT;
          if (p.y + p.vy * DT < p.w / 2) { p.vy = p.bounce++ < 2 ? -p.vy * 0.35 : 0; p.vx *= 0.5; p.vz *= 0.5; p.y = p.w / 2; }
        } else if (p.kind === 'ring') { p.vx *= 0.86; p.vz *= 0.86; }
        p.x += p.vx * DT; p.y += p.vy * DT; p.z += p.vz * DT;
        if (p.kind === 'spark' && p.y < 0.02) { p.y = 0.02; p.vy = Math.abs(p.vy) * 0.3; }
      }
      for (let i = P.length - 1; i >= 0; i--) if (P[i].life >= P[i].max) P.splice(i, 1);
      for (const m of marks) m.t++;
      for (let i = marks.length - 1; i >= 0; i--) if (marks[i].t > 7) marks.splice(i, 1);
      for (const n of nums) n.t++;
      for (let i = nums.length - 1; i >= 0; i--) if (nums[i].t > 52) nums.splice(i, 1);
      hurtT++;
    },

    render(alpha) {
      let i = 0;
      for (const p of P) {
        if (i >= MAX) break;
        pos.set(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
        const k = p.life / p.max;
        if (p.kind === 'spark') {
          v.set(p.vx, p.vy, p.vz);
          const sp = v.length();
          if (sp > 1e-3) q.setFromUnitVectors(zAxis, v.multiplyScalar(1 / sp)); else q.identity();
          const w = p.w * (k > 0.7 ? 0.7 : 1);
          s.set(w, w, Math.max(w, sp * DT * 1.6));
        } else if (p.kind === 'ring') {
          q.identity();
          const w = p.w * (k > 0.6 ? 0.6 : 1);
          s.set(w * 1.6, 0.02, w * 1.6);
        } else {
          q.identity();
          const w = p.w * (k > 0.8 ? 0.5 : 1);
          s.set(w, w, w);
        }
        tmpM.compose(pos, q, s);
        inst.setMatrixAt(i, tmpM);
        inst.setColorAt(i, col.setHex(colorOf(p)));
        i++;
      }
      inst.count = i;
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },

    ui(g) {
      const z = display.zoom;
      // impact marks
      for (const m of marks) {
        const p = display.worldToScreen(m.x, m.y, m.z);
        let sx = m.tx, sy = m.tz * Z_SCREEN;
        if (m.chop) { sx = 0.12; sy = 1; }          // a downward chop cuts vertically on screen
        const l = Math.hypot(sx, sy) || 1; sx /= l; sy /= l;
        const zs = 0.6 + z * 0.4;
        const size = Math.round((5 + m.power * 4) * zs);
        const ink = css('ink'), main = css(m.color), hot = css(m.color === 'red' ? 'rose' : 'torch');
        if (m.t <= 2) {
          // slash cut: a line along the blade's travel through the contact point
          const len = size * (m.t === 0 ? 2.2 : 2.8), wdt = (m.t === 0 ? 2 : 1) + (z >= 2 ? 1 : 0);
          line(g, p.x - sx * len, p.y - sy * len, p.x + sx * len, p.y + sy * len, wdt + 2, ink);
          line(g, p.x - sx * len, p.y - sy * len, p.x + sx * len, p.y + sy * len, wdt, m.t === 0 ? main : hot);
        }
        if (m.t <= 1) star(g, p.x, p.y, Math.round(size * (m.t === 0 ? 1 : 1.3)), m.t === 0 ? main : hot, ink, m.finisher);
        else if (m.t <= 4) ringPx(g, p.x, p.y, Math.round(size * (0.9 + m.t * 0.35)), m.t <= 2 ? main : css('gold'), z >= 2 ? 2 : 1);
        else if (m.t <= 6) for (let a = 0; a < 4; a++) {
          const ang = a * Math.PI / 2 + Math.PI / 4, rd = size * (1.6 + (m.t - 4) * 0.5);
          g.fillStyle = css('gold');
          g.fillRect(Math.round(p.x + Math.cos(ang) * rd), Math.round(p.y + Math.sin(ang) * rd), z >= 2 ? 3 : 2, z >= 2 ? 3 : 2);
        }
      }
      // damage numbers (stand-in)
      for (const n of nums) {
        const p = display.worldToScreen(n.x, n.y, n.z);
        const t = n.t;
        // pop up with an overshoot, hang, then drift and blink out
        const rise = t < 6 ? (t / 6) * 16 : t < 10 ? 16 - (t - 6) * 1 : 12 + (t - 10) * 0.25;
        if (t > 40 && t % 4 < 2) continue;
        const base = z >= 2 ? n.scale + 1 : n.scale;
        const sc = base + (t < 3 ? 1 : 0);          // pops one size bigger for its first frames
        const y = Math.round(p.y - rise * (z >= 2 ? 1.5 : 1) - (n.crit ? 6 : 0));
        drawText(g, n.text, p.x + n.dx, y, t < 2 ? 'white' : n.color, { align: 'center', scale: Math.min(4, sc), outline: 'ink' });
      }
      // hurt vignette
      const fl = settings.get('flashes');
      if (hurtT < hurtLen && fl > 0) {
        const W = display.width, H = display.height;
        const k = 1 - hurtT / hurtLen;
        const th = Math.round((hurtT < 3 ? 14 : 10) * k * fl) + 2;
        g.fillStyle = css(hurtT < 3 ? 'red' : 'blood');
        g.fillRect(0, 0, W, th); g.fillRect(0, H - th, W, th); g.fillRect(0, 0, th, H); g.fillRect(W - th, 0, th, H);
        // a dithered inner band so the edge steps down instead of a soft gradient
        g.fillStyle = css('blood');
        const band = Math.round(th * 0.8);
        for (let yy = th; yy < th + band; yy += 2) for (let xx = (yy >> 1) & 1 ? 0 : 1; xx < W; xx += 2) { g.fillRect(xx, yy, 1, 1); g.fillRect(xx, H - 1 - yy, 1, 1); }
        for (let xx = th; xx < th + band; xx += 2) for (let yy = th + ((xx >> 1) & 1); yy < H - th; yy += 2) { g.fillRect(xx, yy, 1, 1); g.fillRect(W - 1 - xx, yy, 1, 1); }
      }
    },

    /** Direct calls, for pieces that want an effect without an event. */
    sparks, debris, ring,
    get count() { return P.length; },
    dispose() { offs.forEach((f) => f()); offs.length = 0; root.remove(inst); geo.dispose(); mat.dispose(); },
  };
}

// ---- pixel drawing helpers (integer coordinates, no anti-aliasing) ---------------------------

function line(g, x0, y0, x1, y1, w, color) {
  g.fillStyle = color;
  const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)));
  const o = Math.floor(w / 2);
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    g.fillRect(Math.round(x0 + (x1 - x0) * t) - o, Math.round(y0 + (y1 - y0) * t) - o, w, w);
  }
}

function star(g, cx, cy, r, color, ink, big) {
  cx = Math.round(cx); cy = Math.round(cy);
  // 4 long rays (a diamond-tapered cross) + 4 short diagonals
  const ray = (dx, dy, len, thick) => {
    for (let i = 0; i <= len; i++) {
      const t = Math.max(1, Math.round(thick * (1 - i / (len + 1))));
      const x = cx + dx * i, y = cy + dy * i;
      if (dx) g.fillRect(x, y - Math.floor(t / 2), 1, t); else g.fillRect(x - Math.floor(t / 2), y, t, 1);
    }
  };
  const drawAll = (grow, c) => {
    g.fillStyle = c;
    const th = (big ? 5 : 3) + grow * 2;
    ray(1, 0, r + grow, th); ray(-1, 0, r + grow, th); ray(0, 1, r + grow, th); ray(0, -1, r + grow, th);
    const d = Math.round(r * 0.45) + grow;
    for (let i = 0; i <= d; i++) {
      const w = 1 + grow * 2;
      g.fillRect(cx + i - grow, cy + i - grow, w, w); g.fillRect(cx - i - grow, cy + i - grow, w, w);
      g.fillRect(cx + i - grow, cy - i - grow, w, w); g.fillRect(cx - i - grow, cy - i - grow, w, w);
    }
  };
  drawAll(1, ink);
  drawAll(0, color);
  g.fillStyle = css('white');
  g.fillRect(cx - 1, cy - 1, 3, 3);
}

function ringPx(g, cx, cy, r, color, w = 1) {
  g.fillStyle = color;
  const n = Math.max(12, Math.round(r * 5));
  let lx = null, ly = null;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r * 0.8);
    if (x === lx && y === ly) continue;
    g.fillRect(x, y, w, w);
    lx = x; ly = y;
  }
}
