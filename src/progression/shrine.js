// The boon shrine and the pick-1-of-3 choice screen (piece `boons`).
//
// Shrine (3D): a stepped stone altar with a soul crystal floating over its bowl. It rises out
// of the floor (shake, dust), idles (crystal bob, motes, a cold light), shows a prompt when the
// hero is near, and on use flares and opens the choice. After the pick the crystal shatters and
// the runes go dark.
//
//   const sh = createShrine(root, { x, z, collision, hero: () => ctl, rise: true })
//   sh.tick(); sh.render(alpha); sh.ui(g); sh.state 'rising'|'ready'|'open'|'spent'; sh.near; sh.use(); sh.spend(); sh.dispose()
//
// Choice screen (2D, internal resolution, real time so it animates under hitstop):
//   const ch = createChoice({ heroScreen, anchorScreen, onPick(id), onOpen(), onClose(), lock(on) })
//   ch.open(['chain-spark', 'leech', 'reaper'])   ch.frame()  (input)   ch.ui(g)   ch.active   ch.info()
//   ch.select(i)  ch.confirm()   (scripts and the showcase pilot)
//
// Sequence: letterbox bars and a dither dim come in; three motes leave the shrine and land as
// card backs (drop, overshoot, a thunk); each flips to its face in turn (white flash frame,
// rarity flare). Left/Right (A/D, 1-3, mouse hover) moves a lifted, outlined, shimmering
// selection with a tick per move; J / E / Enter / click takes it: the card presses in and
// pops, the others fall away dissolving, the chosen one folds into its icon and flies into
// the hero, who bursts in its colour. A banner names what you gained.

import * as THREE from 'three';
import { loop, DT } from '../core/loop.js';
import { input } from '../core/input.js';
import { display } from '../core/display.js';
import { feedback } from '../core/feedback.js';
import { events } from '../core/events.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { defineModel, voxelMesh, VoxelGrid } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { BOONS, RARITY, stacks } from './boons.js';
import { cardFace, cardBack, silhouette, ditherPattern, bevel, CW, CH, MED } from './cards.js';
import { drawIcon, iconCanvas } from './icons.js';
import { boonSfx } from './sfx.js';

const { add, addShape, P, SPRITE, STREAK, RING, STAR, FLOOR, FACING } = vfx.core;

// ---- the shrine model -------------------------------------------------------------------------
let built = false;
function buildModels() {
  if (built) return;
  built = true;
  for (const lit of [true, false]) {
    const N = 15, c = 7;
    const g = new VoxelGrid(N, 15, N);
    const rune = (x, y, z) => g.set(x, y, z, lit ? 'sky' : 'slate', lit);
    const h = (x, z, s) => { let v = (x * 374761393 + z * 668265263 + s * 1442695) | 0; v = (v ^ (v >>> 13)) * 1274126177; return ((v ^ (v >>> 16)) >>> 0) / 4294967295; };
    // three steps
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const d = Math.max(Math.abs(x - c), Math.abs(z - c));
      g.set(x, 0, z, h(x, z, 1) < 0.25 ? 'stoneDark' : 'stone');
      if (d <= 6) g.set(x, 1, z, d === 6 ? 'stoneLight' : 'stone');
      if (d <= 5) g.set(x, 2, z, d === 5 ? 'stoneLight' : h(x, z, 2) < 0.2 ? 'stoneLight' : 'stone');
    }
    // a rune ring inlaid in the top step
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const r = Math.hypot(x - c, z - c);
      if (r > 3.9 && r < 4.7 && (Math.round(Math.atan2(z - c, x - c) * 4) % 2 === 0)) rune(x, 2, z);
    }
    // the pillar
    for (let y = 3; y <= 10; y++) for (let z = c - 2; z <= c + 2; z++) for (let x = c - 2; x <= c + 2; x++) {
      const corner = Math.abs(x - c) === 2 && Math.abs(z - c) === 2;
      g.set(x, y, z, corner ? 'stoneLight' : h(x, y * 7 + z, 3) < 0.15 ? 'stoneDark' : 'stone');
    }
    // carved runes down the front and sides of the pillar
    for (const y of [4, 5, 7, 8]) { rune(c, y, c + 2); rune(c - 2, y, c); rune(c + 2, y, c); }
    rune(c - 1, 6, c + 2); rune(c + 1, 6, c + 2);
    // the bowl
    for (let z = c - 4; z <= c + 4; z++) for (let x = c - 4; x <= c + 4; x++) {
      const d = Math.max(Math.abs(x - c), Math.abs(z - c));
      const r = Math.hypot(x - c, z - c);
      if (r > 4.6) continue;
      g.set(x, 11, z, r > 3.4 ? 'stoneLight' : 'stone');
      if (r > 3.4) g.set(x, 12, z, d === 4 || r > 4 ? 'stoneLight' : 'stone');
      else g.set(x, 11, z, lit ? (r < 1.6 ? 'cyan' : 'navy') : 'dusk', lit && r < 1.6);
    }
    defineModel(lit ? 'boons.shrine.lit' : 'boons.shrine.dark', { grid: g });
  }
  // the soul crystal: an octahedron, 5 x 9 x 5
  {
    const g = new VoxelGrid(5, 9, 5);
    for (let y = 0; y < 9; y++) {
      const r = y <= 4 ? y * 0.55 : (8 - y) * 0.55;
      for (let z = 0; z < 5; z++) for (let x = 0; x < 5; x++) {
        const d = Math.abs(x - 2) + Math.abs(z - 2);
        if (d > r + 0.3) continue;
        const face = x < 2 || z > 2 ? 'white' : y > 4 ? 'sky' : 'cyan';
        g.set(x, y, z, d === 0 && y > 2 && y < 7 ? 'sky' : face, true);
      }
    }
    defineModel('boons.shrine.crystal', { grid: g, origin: [2.5, 4.5, 2.5] });
  }
}

export function createShrine(root, { x = 0, z = 0, collision = null, hero = () => null, rise = true, onUse = null } = {}) {
  buildModels();
  const group = new THREE.Group();
  group.name = 'shrine';
  group.position.set(x, 0, z);
  root.add(group);
  const lit = voxelMesh('boons.shrine.lit');
  const dark = voxelMesh('boons.shrine.dark');
  dark.visible = false;
  const crystal = voxelMesh('boons.shrine.crystal', { ownMaterial: true });
  const body = new THREE.Group();
  body.add(lit, dark);
  group.add(body, crystal);
  const lamp = new THREE.Object3D();
  lamp.position.set(0, 2.2, 0.3);
  group.add(lamp);
  const light = look.torch(lamp, { color: 'sky', intensity: 0.2, radius: 5.5, flicker: 0.25, haze: 1 });
  let collider = null;
  const S = {
    state: rise ? 'rising' : 'ready', t: 0, near: false, y: rise ? -2.7 : 0, py: rise ? -2.7 : 0, flare: 0, spentT: 0,
  };
  crystal.visible = !rise;
  if (!rise && collision) collider = collision.addCircle(x, z, 0.72, 'shrine');
  const TOP = 1.65;

  function setState(s) { S.state = s; S.t = 0; }

  return {
    x, z,
    get state() { return S.state; },
    get near() { return S.near; },
    /** World point the cards rise from (the crystal). */
    get anchor() { return { x, y: TOP + 0.5, z }; },
    use() {
      if (S.state !== 'ready') return false;
      setState('open');
      S.flare = 1;
      vfx.flash(x, TOP + 0.5, z, { color: 'sky', size: 1.2 });
      addShape(RING, FLOOR, x, 0.03, z, 0.4, 'sky', 'white', 0.4, 2.2, 0.4, 1);
      boonSfx.shrine();
      onUse?.();
      return true;
    },
    /** The pick is done: the crystal shatters into the hero, the runes go dark. */
    spend() {
      if (S.state === 'spent') return;
      setState('spent');
      crystal.visible = false;
      lit.visible = false; dark.visible = true;
      vfx.death(x, TOP + 0.5, z, { colors: ['sky', 'white', 'cyan'], power: 0.6, soul: false, ring: 'sky' });
      light.intensity = 0;
    },
    /** Re-arm (showcase loops). */
    rearm() {
      setState('ready');
      crystal.visible = true; lit.visible = true; dark.visible = false;
      vfx.flash(x, TOP + 0.5, z, { color: 'sky', size: 0.8, light: false });
    },
    tick() {
      S.t++;
      S.py = S.y;
      const h = hero();
      if (S.state === 'rising') {
        const k = Math.min(1, S.t / 54);
        S.y = -2.7 * Math.pow(1 - k, 2.2);
        if (S.t % 6 === 0 && k < 1) {
          vfx.dust(x + (Math.random() - 0.5) * 1.6, z + 0.8, { n: 4, size: 1.1, palette: 'dustWarm' });
          vfx.dust(x + (Math.random() - 0.5) * 1.6, z - 0.7, { n: 3, size: 1, palette: 'dustWarm' });
          feedback.shake(1.2, 90);
        }
        if (S.t === 1) feedback.shake(2, 200);
        if (k >= 1) {
          setState('ready');
          crystal.visible = true;
          vfx.flash(x, TOP + 0.5, z, { color: 'sky', size: 1 });
          vfx.land(x, z, { size: 1.5, palette: 'dustWarm' });
          addShape(RING, FLOOR, x, 0.03, z, 0.35, 'sky', 'white', 0.5, 1.8, 0.4, 1);
          feedback.shake(3, 180);
          if (collision && !collider) collider = collision.addCircle(x, z, 0.72, 'shrine');
          boonSfx.wardGrow();
          events.emit('shrine:ready', { x, z });
        }
      }
      S.near = !!h && S.state === 'ready' && Math.hypot(h.x - x, h.z - z) < 1.75;
      if (S.flare > 0) S.flare = Math.max(0, S.flare - 0.02);
      const live = S.state === 'ready' || S.state === 'open';
      light.intensity = live ? 1.25 + S.flare * 2 + Math.sin(S.t * 0.07) * 0.1 : S.state === 'rising' ? 0.3 : 0;
      // motes rising off the crystal and the rune ring
      if (live && S.t % (S.state === 'open' ? 2 : 5) === 0) {
        const a = Math.random() * Math.PI * 2, r = 0.25 + Math.random() * 0.4;
        const i = add(x + Math.sin(a) * r, TOP + 0.2 + Math.random() * 0.3, z + Math.cos(a) * r * 0.7, 0, 0.6 + Math.random() * 0.8, 0, 0.9 + Math.random() * 0.6, Math.random() < 0.3 ? 2 : 1, 'shardTrail', SPRITE);
        if (i >= 0) { P.wob[i] = 2; P.ph[i] = a; P.fadeAt[i] = 0.5; P.drag[i] = 0.98; }
      }
      if (live && S.t % 70 === 0) vfx.twinkle(x + 0.1, TOP + 0.75, z, { color: 'sky', size: 0.9 });
    },
    render(alpha) {
      const y = S.py + (S.y - S.py) * alpha;
      body.position.y = y;
      const bob = Math.sin((loop.tick + alpha) * 0.06) * 0.08;
      crystal.position.set(0, TOP + 0.45 + bob + (S.state === 'open' ? 0.15 : 0), 0);
      crystal.rotation.y = Math.round((loop.tick + alpha) * 0.02 / (Math.PI / 4)) * (Math.PI / 4);
      crystal.material.userData.flash.value = S.flare > 0.7 ? 0.8 : (loop.tick % 90 < 3 ? 0.35 : 0);
    },
    ui(g) {
      if (!S.near || S.state !== 'ready') return;
      const p = display.worldToScreen(x, TOP + 1.25, z);
      const bob = Math.round(Math.sin(loop.realTime * 5) * 1.5);
      const z2 = display.zoom >= 2 ? 2 : 1;
      const key = 'E', label = 'OFFER';
      const kw = 11 * z2, w = kw + 4 * z2 + textWidth(label, z2);
      const x0 = Math.round(p.x - w / 2), y0 = p.y - 14 * z2 + bob;
      bevel(g, 'ink', x0 - 1, y0 - 1, kw + 2, kw + 2, 2);
      bevel(g, 'bone', x0, y0, kw, kw, 2);
      g.fillStyle = css('fog'); g.fillRect(x0 + 1, y0 + kw - 2, kw - 2, 1);
      drawText(g, key, x0 + kw / 2, y0 + 2 * z2, 'night', { align: 'center', scale: z2 });
      drawText(g, label, x0 + kw + 4 * z2, y0 + 2 * z2, 'sky', { scale: z2, outline: 'ink' });
    },
    info() { return { state: S.state, t: S.t, near: S.near, x, z }; },
    dispose() { if (collider && collision) collision.remove(collider); light.remove?.(); root.remove(group); },
  };
}

// ---- the choice screen --------------------------------------------------------------------------
/** speed < 1 slows the whole choice screen (frame strips: debug.boons('uiSpeed', 0.25), &uislow=). */
export const choiceTiming = { speed: 1 };
const GAP = 16;
const T_LAND = (i) => 0.34 + i * 0.11;
const T_FLIP = (i) => T_LAND(i) + 0.3 + i * 0.07;
const FLIP_LEN = 0.15;
const T_READY = T_FLIP(2) + FLIP_LEN + 0.05;
const DROP = [-22, -12, -4, 3, 2, 0];   // per 1/30 s after landing: drop, overshoot, settle

export function createChoice({ heroScreen = () => ({ x: display.width / 2, y: display.height / 2 }), anchorScreen = null, onPick = null, onOpen = null, onClose = null, lock = null } = {}) {
  const C = {
    active: false, phase: 'closed', ids: [], sel: 1, t0: 0, tChosen: 0, chosen: -1, lift: [0, 0, 0], selT: 0,
    landed: [false, false, false], flipped: [false, false, false], flared: [false, false, false],
    mouseAt: -1, lastConfirm: -9, banner: null, closeT: 0,
  };
  const parts = [];   // 2D pixel particles {x, y, vx, vy, t, life, c, s, g}
  let lastReal = loop.realTime;
  let clock = 0;   // the screen's own seconds: real time, clamped per frame, times choiceTiming.speed
  const tmp = document.createElement('canvas');
  tmp.width = CW; tmp.height = CH;
  const tg = tmp.getContext('2d');

  const slotX = (i) => Math.round(display.width / 2 - (3 * CW + 2 * GAP) / 2 + i * (CW + GAP));
  const slotY = () => Math.round(display.height / 2 - CH / 2 + 14);
  const now = () => clock - C.t0;
  const R = (i) => RARITY[BOONS[C.ids[i]].rarity];

  function spark(x, y, c, { vx = 0, vy = 0, life = 0.5, s = 1, g = 0 } = {}) { if (parts.length < 400) parts.push({ x, y, vx, vy, t: 0, life, c, s, g }); }
  function burst(x, y, c, n, sp = 60, s = 1) {
    for (let k = 0; k < n; k++) { const a = Math.random() * Math.PI * 2, v = sp * (0.4 + Math.random() * 0.8); spark(x, y, c, { vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.35, s: Math.random() < 0.3 ? s + 1 : s, g: 60 }); }
  }

  function open(ids) {
    C.ids = ids.slice(0, 3);
    while (C.ids.length < 3) C.ids.push(null);
    C.active = true; C.phase = 'intro'; C.t0 = clock; C.sel = 1; C.chosen = -1;
    C.lift = [0, 0, 0]; C.landed = [false, false, false]; C.flipped = [false, false, false]; C.flared = [false, false, false];
    C.mouseAt = performance.now(); C.lastConfirm = -9; C.banner = null;
    lock?.(true);
    onOpen?.();
    events.emit('boon:choice', { ids: C.ids.filter(Boolean) });
  }
  function select(i) {
    if (!C.active || C.phase === 'chosen' || C.phase === 'fly' || i < 0 || i > 2 || !C.ids[i] || i === C.sel) return;
    C.sel = i; C.selT = now();
    boonSfx.hover(i);
    const x = slotX(i) + CW / 2, y = slotY();
    burst(x, y + 2, css(R(i).glow), 6, 50);
  }
  function confirm() {
    if (!C.active) return false;
    if (C.phase !== 'pick') { C.lastConfirm = now(); return false; }
    if (!C.ids[C.sel]) return false;
    C.phase = 'chosen'; C.chosen = C.sel; C.tChosen = now();
    boonSfx.select(BOONS[C.ids[C.sel]].rarity);
    feedback.shake(1.5, 120);
    const x = slotX(C.sel) + CW / 2, y = slotY() + CH / 2;
    burst(x, y, css('white'), 18, 140, 1);
    burst(x, y, css(R(C.sel).glow), 24, 110, 1);
    return true;
  }

  function frame() {
    if (!C.active || C.phase === 'closing') return;
    const L = input.ui.pressed('left'), Rr = input.ui.pressed('right');
    if (C.phase === 'intro' || C.phase === 'pick') {
      if (L) select(Math.max(0, C.sel - 1));
      if (Rr) select(Math.min(2, C.sel + 1));
      for (let k = 0; k < 3; k++) if (input.ui.key('Digit' + (k + 1))) select(k);
      // mouse hover (only after the mouse has moved since the screen opened)
      const m = input.mouse;
      const hoverOk = m.lastMove > C.mouseAt && m.inside !== false;
      let over = -1;
      if (hoverOk) {
        const rect = display.uiCanvas?.getBoundingClientRect?.();
        if (rect) {
          const ux = (m.x - rect.left) / display.scale, uy = (m.y - rect.top) / display.scale;
          for (let k = 0; k < 3; k++) if (ux >= slotX(k) && ux < slotX(k) + CW && uy >= slotY() - 12 && uy < slotY() + CH) over = k;
          if (over >= 0) select(over);
        }
      }
      const click = input.ui.key('Mouse0');
      const key = input.ui.pressed('interact') || input.ui.pressed('confirm') || (input.ui.pressed('attack') && !click);
      if (key || (click && over >= 0)) confirm();
    }
  }

  // ---- drawing ------------------------------------------------------------------------------
  function drawCard(g, i, x, y, { face = true, wScale = 1, alpha = 1, white = false } = {}) {
    const id = C.ids[i];
    if (!id) return;
    const src = white ? silhouette('white') : face ? cardFace(id) : cardBack(BOONS[id].rarity);
    const w = Math.max(2, Math.round(CW * wScale));
    const dx = Math.round(x + (CW - w) / 2);
    if (alpha >= 1) {
      g.drawImage(src, 0, 0, CW, CH, dx, y, w, CH);
      if (face && !white && wScale >= 1) drawFaceIcon(g, i, x, y);
      return;
    }
    // dissolve: draw into a scratch canvas, punch a growing Bayer hole pattern, blit
    tg.clearRect(0, 0, CW, CH);
    tg.drawImage(src, 0, 0);
    if (face && !white) drawFaceIcon(tg, i, 0, 0);
    tg.globalCompositeOperation = 'destination-out';
    tg.fillStyle = ditherPattern(tg, Math.round((1 - alpha) * 16), 'ink');
    tg.fillRect(0, 0, CW, CH);
    tg.globalCompositeOperation = 'source-over';
    g.drawImage(tmp, dx, y);
  }
  function drawFaceIcon(g, i, x, y) {
    const sel = i === C.sel && C.phase === 'pick';
    const bob = sel ? Math.round(Math.sin(now() * 5) * 1.2) : 0;
    drawIcon(g, C.ids[i], x + MED.x - 27, y + MED.y - 27 + bob, { scale: 3 });
  }
  function outline(g, x, y, i, t) {
    const Rr = R(i);
    const blink = t - C.selT < 0.07;
    bevel(g, 'ink', x - 4, y - 4, CW + 8, CH + 8, 5);
    bevel(g, blink ? 'white' : Rr.glow, x - 3, y - 3, CW + 6, CH + 6, 4);
    bevel(g, 'ink', x - 1, y - 1, CW + 2, CH + 2, 4);
    // corner brackets that breathe
    const o = 6 + Math.round((Math.sin(t * 6) + 1) * 1.2);
    g.fillStyle = css('white');
    for (const [cx, cy, sx, sy] of [[x - o, y - o, 1, 1], [x + CW + o - 1, y - o, -1, 1], [x - o, y + CH + o - 1, 1, -1], [x + CW + o - 1, y + CH + o - 1, -1, -1]]) {
      g.fillRect(sx > 0 ? cx : cx - 7, cy, 8, 2 * 1); g.fillRect(cx, sy > 0 ? cy : cy - 7, 2, 8);
      if (sy < 0) g.fillRect(sx > 0 ? cx : cx - 7, cy - 1, 8, 1);
      if (sx < 0) g.fillRect(cx - 1, sy > 0 ? cy : cy - 7, 1, 8);
    }
  }
  function shimmer(g, x, y, t) {
    const period = 1.9, k = ((t - C.selT) % period) / 0.5;
    if (k > 1) return;
    const b = Math.round(-CH * 0.5 + k * (CW + CH * 0.5));
    g.fillStyle = ditherPattern(g, 8, 'white');
    for (let yy = 6; yy < CH - 6; yy++) {
      const sx = b + Math.round((CH - yy) * 0.5);
      const x0 = Math.max(6, sx), x1 = Math.min(CW - 6, sx + 5);
      if (x1 > x0) g.fillRect(x + x0, y + yy, x1 - x0, 1);
      const s2 = sx + 9;
      if (s2 >= 6 && s2 < CW - 6) { g.fillStyle = css('white'); g.fillRect(x + s2, y + yy, 1, 1); g.fillStyle = ditherPattern(g, 8, 'white'); }
    }
  }
  // the cards you are not on sink back: their art dims, their text stays crisp
  function dimCard(g, x, y, level) {
    g.fillStyle = ditherPattern(g, level, 'ink');
    g.fillRect(x + 5, y + 12, CW - 10, 70);
  }

  function ui(g) {
    const dt = Math.min(1 / 30, Math.max(0, loop.realTime - lastReal)) * choiceTiming.speed;
    lastReal = loop.realTime;
    clock += dt;
    // particles always tick (so the burst on arrival finishes after the screen closes)
    for (const p of parts) { p.t += dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].t >= parts[i].life) parts.splice(i, 1);
    if (C.active) drawScreen(g);
    for (const p of parts) {
      if (p.t > p.life * 0.7 && Math.floor(p.t * 30) % 2) continue;
      g.fillStyle = p.c;
      g.fillRect(Math.round(p.x), Math.round(p.y), p.s, p.s);
    }
    drawBanner(g);
  }

  function drawScreen(g) {
    const t = now();
    const W = display.width, H = display.height;
    const x0 = slotX(0), y0 = slotY();
    // backdrop: letterbox bars and a dither dim
    let k = Math.min(1, t / 0.25);
    if (C.phase === 'chosen' || C.phase === 'fly') k = Math.min(k, 1 - Math.max(0, (t - C.tChosen - 0.55) / 0.4));
    if (C.phase === 'closing') k = 0;
    if (k > 0) {
      g.fillStyle = ditherPattern(g, Math.round(6 * k), 'ink');
      g.fillRect(0, 0, W, H);
      const bar = Math.round(22 * k);
      g.fillStyle = css('ink');
      g.fillRect(0, 0, W, bar); g.fillRect(0, H - bar, W, bar);
      g.fillStyle = css('violet');
      g.fillRect(0, bar, W, 1); g.fillRect(0, H - bar - 1, W, 1);
    }
    // title
    if (C.phase === 'intro' || C.phase === 'pick') {
      const tk = Math.min(1, t / 0.3);
      const oy = Math.round((1 - tk) * -24 + (tk > 0.75 ? Math.sin((tk - 0.75) * 12) * 2 : 0));
      drawText(g, 'THE SHRINE OFFERS', W / 2, y0 - 44 + oy, 'mist', { align: 'center', shadow: 'ink' });
      drawText(g, 'CHOOSE A BOON', W / 2, y0 - 34 + oy, 'bone', { align: 'center', scale: 2, outline: 'ink' });
    }
    // motes from the shrine to each slot
    const A = anchorScreen?.() ?? { x: W / 2, y: H * 0.7 };
    for (let i = 0; i < 3; i++) {
      if (!C.ids[i]) continue;
      const ts = T_LAND(i) - 0.24, tl = T_LAND(i);
      if (t >= ts && t < tl) {
        const u = (t - ts) / (tl - ts);
        const ex = slotX(i) + CW / 2, ey = y0 + CH / 2;
        const cx = (A.x + ex) / 2, cy = Math.min(A.y, ey) - 70;
        const x = (1 - u) * (1 - u) * A.x + 2 * u * (1 - u) * cx + u * u * ex;
        const y = (1 - u) * (1 - u) * A.y + 2 * u * (1 - u) * cy + u * u * ey;
        const col = css(R(i).glow);
        g.fillStyle = css('ink'); g.fillRect(Math.round(x) - 3, Math.round(y) - 3, 7, 7);
        g.fillStyle = col; g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, 5);
        g.fillStyle = css('white'); g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
        spark(x, y, col, { life: 0.25, vx: (Math.random() - 0.5) * 20, vy: (Math.random() - 0.5) * 20 });
      }
    }
    // cards
    const order = [0, 1, 2].filter((i) => i !== C.sel).concat([C.sel]);
    for (const i of order) {
      if (!C.ids[i]) continue;
      const x = slotX(i);
      let y = y0;
      if (t < T_LAND(i)) continue;
      if (!C.landed[i]) {
        C.landed[i] = true;
        boonSfx.cardLand(i);
        feedback.shake(0.8, 70);
        for (let k2 = 0; k2 < 10; k2++) spark(x + 6 + Math.random() * (CW - 12), y0 + CH, css('fog'), { vx: (Math.random() - 0.5) * 50, vy: -20 - Math.random() * 30, life: 0.3, g: 120 });
      }
      const fr = Math.floor((t - T_LAND(i)) * 30);
      if (fr < DROP.length) y += DROP[fr];
      // flip
      const tf = T_FLIP(i);
      let face = t >= tf + FLIP_LEN / 2, wS = 1, white = false;
      if (t >= tf && t < tf + FLIP_LEN) {
        const u = (t - tf) / FLIP_LEN;
        wS = Math.abs(Math.cos(u * Math.PI));
        white = Math.abs(u - 0.5) < 0.12;
        if (!C.flipped[i] && u >= 0.5) { C.flipped[i] = true; boonSfx.cardFlip(i); }
      }
      if (t >= tf + FLIP_LEN && !C.flared[i]) {
        C.flared[i] = true; C.flipped[i] = true;
        const Rr = R(i);
        burst(x + CW / 2, y + MED.y, css(Rr.glow), 10 + Rr.order * 10, 70 + Rr.order * 30);
        if (Rr.order >= 3) { feedback.flash('gold', 140, 0.18); burst(x + CW / 2, y + MED.y, css('white'), 20, 160); }
      }
      if (C.phase === 'chosen' || C.phase === 'fly') { drawChosen(g, i, x, y, t - C.tChosen); continue; }
      // hover lift
      const want = i === C.sel && C.flipped[i] ? -8 : 0;
      C.lift[i] += Math.round((want - C.lift[i]) * 0.5) || Math.sign(want - C.lift[i]);
      y += C.lift[i];
      if (i === C.sel && C.flipped[i] && C.phase === 'pick') outline(g, x, y, i, t);
      // the legendary card's rays turn slowly behind it
      if (face && R(i).order >= 3) legendRays(g, x + CW / 2, y + MED.y, t);
      drawCard(g, i, x, y, { face, wScale: wS, white });
      if (face && wS >= 1) {
        if (i === C.sel && C.phase === 'pick') shimmer(g, x, y, t);
        else if (C.phase === 'pick') dimCard(g, x, y, 6);
        if (R(i).order >= 2 && Math.random() < 0.3) spark(x + Math.random() * CW, y + Math.random() * CH, css(Math.random() < 0.5 ? 'white' : R(i).glow), { vy: -12, life: 0.45 });
      }
    }
    // hints
    if (C.phase === 'intro' || C.phase === 'pick') {
      const ready = C.phase === 'pick';
      const hy = y0 + CH + 16;
      const blink = !ready || Math.floor(t * 2) % 4 !== 0;
      const hint = 'A/D  CHOOSE      J / E  TAKE';
      if (blink) drawText(g, hint, W / 2, hy, ready ? 'fog' : 'slate', { align: 'center', shadow: 'ink' });
      if (ready && C.ids[C.sel]) {
        const id = C.ids[C.sel];
        const s = stacks(id);
        const label = s ? `UPGRADE ${BOONS[id].name}` : BOONS[id].name;
        drawText(g, label, W / 2, hy + 11, RARITY[BOONS[id].rarity].text, { align: 'center', shadow: 'ink' });
      }
    }
    // state machine on real time
    if (C.phase === 'intro' && t >= T_READY) {
      C.phase = 'pick';
      if (t - C.lastConfirm < 0.15) confirm();
    }
    if (C.phase === 'chosen' && t - C.tChosen >= 0.62) { C.phase = 'fly'; boonSfx.fly(); }
    if (C.phase === 'fly' && t - C.tChosen >= 1.0) arrive();
  }

  function legendRays(g, cx, cy, t) {
    g.fillStyle = css('gold');
    for (let k = 0; k < 10; k++) {
      const a = t * 0.6 + k * Math.PI / 5;
      for (let r = 40; r < 96; r += 2) {
        if ((r + k * 3) % 8 > 4) continue;
        const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
        g.fillRect(x, y, 2, 2);
      }
    }
  }

  function drawChosen(g, i, x, y, tc) {
    const id = C.ids[i];
    const Rr = R(i);
    if (i !== C.chosen) {
      // fall away and dissolve
      const fy = Math.round(y + 260 * tc * tc + 30 * tc);
      const a = Math.max(0, 1 - tc / 0.4);
      if (a > 0) drawCard(g, i, x, fy, { face: true, alpha: a });
      return;
    }
    const cx = x + CW / 2;
    if (tc < 0.06) { drawCard(g, i, x, y + 2, { white: true }); return; }
    if (tc < 0.4) {
      const lift = Math.round(Math.min(1, (tc - 0.06) / 0.1) * -14);
      raysAround(g, cx, y + lift + MED.y, tc, Rr);
      outline(g, x, y + lift, i, now());
      drawCard(g, i, x, y + lift, { face: true });
      return;
    }
    // fold down into the medallion, in hard steps
    const fold = [CH, 150, 96, 54];
    const f = Math.floor((tc - 0.4) / 0.045);
    const my = y - 14 + MED.y;
    if (f < fold.length) {
      const h = fold[f];
      const src = cardFace(id);
      g.drawImage(src, 0, 0, CW, CH, x + Math.round((CW - CW * h / CH) / 2), Math.round(my - h * MED.y / CH), Math.round(CW * h / CH), h);
      drawIcon(g, id, cx - 27, my - 27, { scale: 3 });
      return;
    }
    // fly into the hero along an arc
    const u = Math.min(1, (tc - 0.62) / 0.38);
    const e = u < 0 ? 0 : u * u * (3 - 2 * u);
    const Hs = heroScreen();
    const ctrl = { x: (cx + Hs.x) / 2 + (Hs.x < cx ? -40 : 40), y: Math.min(my, Hs.y) - 60 };
    const px = (1 - e) * (1 - e) * cx + 2 * e * (1 - e) * ctrl.x + e * e * Hs.x;
    const py = (1 - e) * (1 - e) * my + 2 * e * (1 - e) * ctrl.y + e * e * Hs.y;
    const sc = u < 0.4 ? 3 : u < 0.75 ? 2 : 1;
    drawIcon(g, id, px - 9 * sc, py - 9 * sc, { scale: sc });
    spark(px + (Math.random() - 0.5) * 6, py + (Math.random() - 0.5) * 6, css(Math.random() < 0.4 ? 'white' : Rr.glow), { vy: 10, life: 0.35, s: 2 });
    spark(px, py, css(Rr.frame), { vx: (Math.random() - 0.5) * 30, vy: (Math.random() - 0.5) * 30, life: 0.3 });
  }
  function raysAround(g, cx, cy, tc, Rr) {
    g.fillStyle = css(Rr.glow);
    const n = 14;
    for (let k = 0; k < n; k++) {
      const a = k / n * Math.PI * 2 + tc * 2;
      const r0 = 70 + (k % 2) * 10, r1 = r0 + 30 + tc * 80;
      for (let r = r0; r < r1; r += 3) g.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r * 1.1), 2, 2);
    }
  }

  function arrive() {
    const id = C.ids[C.chosen];
    const Hs = heroScreen();
    const Rr = RARITY[BOONS[id].rarity];
    burst(Hs.x, Hs.y, css('white'), 16, 160);
    burst(Hs.x, Hs.y, css(Rr.glow), 24, 120, 2);
    const before = stacks(id);
    C.phase = 'closing';
    C.active = false;
    C.banner = { id, t0: clock, lv: before + 1, max: BOONS[id].max };
    lock?.(false);
    boonSfx.gain(BOONS[id].rarity);
    onPick?.(id);
    onClose?.(id);
  }

  function drawBanner(g) {
    const b = C.banner;
    if (!b) return;
    const t = clock - b.t0;
    if (t > 2.2) { C.banner = null; return; }
    if (t > 1.9 && Math.floor(t * 20) % 2) return;
    const B = BOONS[b.id], Rr = RARITY[B.rarity];
    const W = display.width;
    const k = Math.min(1, t / 0.18);
    const y = Math.round(34 - (1 - k) * 18 + (k >= 1 && t < 0.3 ? Math.sin((t - 0.18) * 30) * 2 : 0));
    const name = B.name;
    const sub = b.lv > 1 ? `LV ${b.lv}${b.lv >= b.max ? '  MAX' : ''}` : 'BOON GAINED';
    const w = Math.max(textWidth(name, 2), textWidth(sub)) + 42;
    const x0 = Math.round(W / 2 - w / 2);
    bevel(g, 'ink', x0 - 2, y - 6, w + 4, 34, 3);
    bevel(g, Rr.frame, x0 - 1, y - 5, w + 2, 32, 3);
    bevel(g, 'night', x0, y - 4, w, 30, 2);
    drawIcon(g, b.id, x0 + 4, y - 1, { scale: 1 });
    drawText(g, name, x0 + 26, y - 1, t < 0.1 ? 'white' : Rr.text, { scale: 2, outline: 'ink' });
    drawText(g, sub, x0 + 26, y + 15, 'bone');
  }

  return {
    open, select, confirm, frame, ui,
    get active() { return C.active; },
    get phase() { return C.phase; },
    get sel() { return C.sel; },
    get ids() { return C.ids; },
    get busy() { return C.active || !!C.banner; },
    info() { return { active: C.active, phase: C.phase, ids: C.ids, sel: C.sel, chosen: C.chosen >= 0 ? C.ids[C.chosen] : null, t: +now().toFixed(2) }; },
    close() { if (C.active) { C.active = false; C.phase = 'closed'; lock?.(false); } },
  };
}
