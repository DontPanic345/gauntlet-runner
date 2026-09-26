// ?showcase=vfx : an effects reel. Each effect of the shared vfx system plays in turn on a lit
// crypt floor, labelled, looping. A stand-in runner is the target / actor so scale and timing read.
//
// Params:  &fx=<id|index>   start on (and stay on) one effect: hit smear dust dash death portal
//                           embers flash shockwave pickup stress ambient
//          &auto=0          hold on the first effect instead of advancing
//          &zoom=1..3       (default 2; 1 = game scale)
//          &slow=<s>        time scale, e.g. 0.25
//          &hud=0           no labels (clean stills)      &feel=0  no shake / screen flash
//          &mood=crypt|collapse|boss|calm|off   ambient layer for the reel (default crypt)
//          &n=<count>       stress: particles spawned per tick (default 40, about 2000 alive)
// Keys:    Right/D next   Left/A previous   1-9,0 jump (10 = pickup)   Q stress   E ambient
//          Space hold on this effect   R replay it   T slow-mo   Z zoom   H hud   P/Esc pause

import * as THREE from 'three';
import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { rng } from '../core/rng.js';
import { buildStage } from '../core/stage.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { voxelMesh, VOXEL } from '../render/voxel/index.js';
import '../render/voxel/testmodels.js';
import { vfx } from './index.js';
import { ramp, F_TWINKLE, F_BOUNCE, F_STRETCH } from './particles.js';

const SLOWS = [1, 0.5, 0.25, 0.1];
const RUNNER_COLORS = ['blue', 'violet', 'dusk', 'navy', 'red', 'gold'];

// A reel entry: id, label, note, length in ticks, and a script of [tick, fn(ctx)].
const REEL = [
  { id: 'hit', label: 'HIT SPARK', note: 'CORE POP, STREAKS, CHIPS, STAR. LIGHT, HEAVY, HURT', len: 150, steps: [
    [4, (c) => c.hit(1, 1, 0, 'hit')], [50, (c) => c.hit(2, 1, 0.2, 'hit')], [100, (c) => c.hit(1.3, -1, 0.1, 'hurt')] ] },
  { id: 'smear', label: 'SLASH SMEAR', note: 'HEAD RACES, TAIL CATCHES UP. SIDE, SIDE, OVERHEAD', len: 150, steps: [
    [4, (c) => c.slash(1, 2.5)], [50, (c) => c.slash(-1, 2.8)], [100, (c) => c.slash(1, 2.9, true)] ] },
  { id: 'dust', label: 'DUST PUFF', note: 'LANDING, SKID, FOOTFALL', len: 130, steps: [
    [4, (c) => c.actorLand()], [46, (c) => c.actorSkid()], [88, (c) => c.dust(0, 0, 0, 3, 4)], [100, (c) => c.dust(0.15, 0.1, 0, 3, 3)] ] },
  { id: 'dash', label: 'DASH AFTER-IMAGES', note: 'GHOSTS STEP DOWN A COLOUR RAMP AND DITHER OUT', len: 120, steps: [[6, (c) => c.dash(1)], [66, (c) => c.dash(-1)]] },
  { id: 'death', label: 'DEATH BURST', note: 'WHITE FRAME, OWN-COLOUR CHUNKS, SMOKE, EMBERS', len: 130, steps: [[8, (c) => c.kill()], [90, (c) => c.actorPop()]] },
  { id: 'portal', label: 'SPAWN PORTAL', note: 'RUNE RING, SPIRAL MOTES, COLUMN, POP. VOID THEN EMBER', len: 300, steps: [
    [4, (c) => c.portal('void')], [64, (c) => c.actorPop()], [150, (c) => c.actorHide()], [156, (c) => c.portal('ember')], [216, (c) => c.actorPop()] ] },
  { id: 'embers', label: 'EMBERS', note: 'BURST, THEN A FOUNTAIN', len: 200, steps: [
    [4, (c) => vfx.embers({ x: 0, y: 0.1, z: 0, n: 22 })], [50, (c) => vfx.embers({ x: 0, y: 0.1, z: 0, dur: 2.2 })] ] },
  { id: 'flash', label: 'LIGHT FLASH', note: 'DITHERED GLOW BANDS AND A REAL LIGHT POP', len: 160, steps: [
    [4, (c) => c.flash('torch', 2.2)], [56, (c) => c.flash('ember', 2.6)], [108, (c) => c.flash('cyan', 2.2, true)] ] },
  { id: 'shockwave', label: 'SHOCKWAVE RING', note: 'FAST RING THAT BRAKES, DUST BEHIND IT', len: 150, steps: [
    [4, (c) => c.shock(3, 'ring')], [80, (c) => c.shock(1.6, 'ember')] ] },
  { id: 'pickup', label: 'PICKUP SPARKLE', note: 'RISING RING, TWINKLES, STAR SPRITES', len: 170, steps: [
    [4, (c) => c.pickup('gold')], [60, (c) => c.pickup('magic')], [116, (c) => c.pickup('hurt')] ] },
  { id: 'stress', label: 'STRESS: 2000 PARTICLES', note: 'RAW POOL LOAD. WATCH ALIVE AND FPS', len: 360, stress: true, steps: [] },
  { id: 'ambient', label: 'AMBIENT LAYER', note: 'EMBERS AND DUST MOTES. CRYPT, COLLAPSE, BOSS, CALM', len: 480, steps: [
    [0, () => vfx.ambient.mood('crypt')], [120, () => vfx.ambient.mood('collapse')], [240, () => vfx.ambient.mood('boss')], [360, () => vfx.ambient.mood('calm')] ] },
];

export default function vfxShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  let zoom = Math.max(1, Math.min(3, parseInt(P('zoom', '2'), 10) || 2));
  let hud = P('hud', '1') !== '0';
  const feel = P('feel', '1') !== '0';
  const baseMood = P('mood', 'crypt');
  const stressN = Math.max(1, parseInt(P('n', '26'), 10) || 40);
  const fxp = P('fx', null);
  let hold = P('auto', '1') === '0' || fxp !== null;
  let idx = 0;
  if (fxp !== null) { const i = REEL.findIndex((r) => r.id === fxp); idx = i >= 0 ? i : Math.max(0, Math.min(REEL.length - 1, parseInt(fxp, 10) - 1 || 0)); }
  const slowP = parseFloat(P('slow', '1'));
  let slowIdx = Math.max(0, SLOWS.indexOf(slowP));

  let root, stage, actor, mat;
  let T = 0;                 // ticks into the current effect
  let stepI = 0;
  let fpsAvg = 60, lastT = 0;
  const A = { x: 0, z: 0, px: 0, z0: 0, sx: 1, sy: 1, vis: 1, flash: 0, kick: 0, vk: 0, hidden: false, popT: -1, y: 0 };
  let heldTicks = 0;

  const ctx = {
    hit(power, dir, dz, style) {
      const y = 0.55;
      vfx.hit({ x: -0.15 * dir, y, z: 0, dx: dir, dz, power, style, feel });
      A.flash = 3; A.vk = dir * (0.05 + power * 0.04); A.sx = 1.12; A.sy = 0.9;
      if (feel) loop.hitstop(40 + power * 25);
    },
    slash(side, sweep, over) {
      vfx.smear({ x: 0, y: 0.6, z: 0, yaw: over ? Math.PI : Math.PI / 2 - 0.0, radius: 0.95, sweep, side, power: over ? 1.4 : 1 });
      // the blow lands two ticks into the swing
      pending.push({ t: 3, fn: () => ctx.hit(over ? 2 : 1, side > 0 ? 1 : -1, 0.15, 'hit') });
    },
    dust(x, z, dz, n, size) { vfx.dust({ x, z, n: n * 2, size }); },
    actorLand() { A.y = 0.9; A.vy = 0; A.landing = true; },
    actorSkid() { A.x = -1.2; A.px = -1.2; A.skid = 10; },
    dash(dir) {
      A.dash = { dir, t: 0, n: 10 };
      vfx.dash({ x: -dir * 2.4, z: 0, dx: dir, dz: 0, feel });
    },
    kill() {
      vfx.death({ x: 0, y: 0.45, z: 0, power: 1.2, colors: RUNNER_COLORS, feel });
      A.hidden = true;
      if (feel) loop.hitstop(90);
    },
    actorPop() { A.hidden = false; A.popT = 0; vfx.dust({ x: 0, z: 0, n: 8, size: 4 }); },
    actorHide() { A.hidden = true; },
    portal(style) { A.hidden = true; vfx.portal({ x: 0, z: 0, radius: 0.9, dur: 0.85, style, feel }); },
    flash(color, radius, screen) { vfx.flash({ x: 0, y: 0.6, z: 0, color, radius, ms: 200, screen: screen && feel }); },
    shock(radius, style) { vfx.shockwave({ x: 0, z: 0, radius, style, feel }); },
    pickup(style) { vfx.pickup({ x: 1.0, y: 0.45, z: 0.3, style }); },
  };
  const pending = [];

  function startEffect(i) {
    idx = (i + REEL.length) % REEL.length;
    T = 0; stepI = 0; pending.length = 0;
    vfx.clear();
    vfx.resetPeak();
    if (idx !== REEL.findIndex((r) => r.id === 'ambient')) vfx.ambient.mood(baseMood);
    Object.assign(A, { x: 0, px: 0, sx: 1, sy: 1, hidden: false, flash: 0, kick: 0, vk: 0, popT: -1, y: 0, dash: null, skid: 0, landing: false });
    if (REEL[idx].id === 'ambient') vfx.ambient.mood('crypt');
  }

  function stressTick() {
    const pool = vfx.pool;
    const c1 = ramp('white,torch,gold,flame,blood'), c2 = ramp('white,sky,cyan,teal,navy'), c3 = ramp('frost,fog,mist,slate');
    for (let i = 0; i < stressN; i++) {
      const a = Math.random() * 6.283, sp = 1 + Math.random() * 5;
      const r = i % 3;
      pool.add(Math.sin(T * 0.13) * 2.5, 0.3, Math.cos(T * 0.09) * 1.5, Math.sin(a) * sp, 2 + Math.random() * 5, Math.cos(a) * sp,
        0.6 + Math.random() * 0.7, r === 2 ? 4 : 2, 1, r === 0 ? c1 : r === 1 ? c2 : c3, r === 0 ? F_BOUNCE | F_TWINKLE : r === 1 ? F_STRETCH | F_BOUNCE : 0, 0.96, 12);
    }
    if (T % 24 === 0) vfx.shockwave({ x: (Math.random() - 0.5) * 4, z: (Math.random() - 0.5) * 2, radius: 1.6 });
  }

  function tickActor() {
    A.px = A.x; A.pz = A.z;
    // squash and stretch settle
    A.sx += (1 - A.sx) * 0.3; A.sy += (1 - A.sy) * 0.3;
    A.kick += A.vk; A.vk *= 0.7; A.kick *= 0.85;
    if (A.flash > 0) A.flash--;
    if (A.landing) {
      A.vy -= 0.08; A.y += A.vy;
      if (A.y <= 0) { A.y = 0; A.landing = false; A.sx = 1.3; A.sy = 0.7; vfx.dust({ x: 0, z: 0, n: 16, size: 6, speed: 1.4 }); vfx.shockwave({ x: 0, z: 0, radius: 0.9, style: 'dust' }); }
    }
    if (A.skid > 0) {
      A.x += 0.09 * (A.skid / 10); A.skid--;
      if (A.skid % 2 === 0) vfx.dust({ x: A.x, z: 0, dx: 1, dz: 0, n: 3, size: 3 });
      if (A.skid === 0) { A.x = 0; A.px = 0; }
    }
    if (A.popT >= 0) {
      A.popT++;
      const k = A.popT;
      A.sx = k < 4 ? 0.5 + k * 0.25 : 1.2 - Math.min(0.2, (k - 4) * 0.04); A.sy = k < 4 ? 1.5 - k * 0.1 : 0.8 + Math.min(0.2, (k - 4) * 0.05);
      if (k > 12) A.popT = -1;
    }
    if (A.dash) {
      const d = A.dash;
      d.t++;
      const k = d.t / d.n;
      A.x = -d.dir * 2.4 + d.dir * 4.8 * (1 - (1 - Math.min(1, k)) ** 2);
      if (d.t <= d.n) { A.sx = 1.3; A.sy = 0.85; if (d.t % 2 === 0) pendingGhost = true; }
      if (d.t === d.n) { vfx.dust({ x: A.x, z: 0, dx: d.dir, dz: 0, n: 8, size: 4, speed: 1.3 }); A.sx = 0.8; A.sy = 1.2; }
      if (d.t > d.n + 10) { A.dash = null; A.x = 0; A.px = 0; }
    }
  }
  let pendingGhost = false;

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      display.setZoom(zoom);
      display.setCameraTarget(0, 0.35, 0);
      stage = buildStage(root, { torches: [[-3.4, -2.2], [3.4, -2.2], [-3.2, 2.6], [3.2, 2.6]], rng: rng.fork('vfx-stage'), dustBox: [2, 1, 2] });
      vfx.attach(root, { ambient: baseMood });
      actor = voxelMesh('test.runner', { ownMaterial: true });
      root.add(actor);
      mat = actor.material;
      startEffect(idx);
      if (slowIdx) loop.setTimeScale(SLOWS[slowIdx]);
    },
    exit() { vfx.detach(); loop.setTimeScale(1); },

    frame(dt) {
      fpsAvg += (Math.min(120, 1 / Math.max(dt, 1e-4)) - fpsAvg) * 0.05;
      const k = input.ui.key;
      const go = (i) => { startEffect(i); };
      if (k('ArrowRight') || k('KeyD')) go(idx + 1);
      if (k('ArrowLeft') || k('KeyA')) go(idx - 1);
      for (let n = 1; n <= 9; n++) if (k('Digit' + n)) go(n - 1);
      if (k('Digit0')) go(9);
      if (k('KeyQ')) go(REEL.findIndex((r) => r.id === 'stress'));
      if (k('KeyE')) go(REEL.findIndex((r) => r.id === 'ambient'));
      if (k('KeyR')) go(idx);
      if (k('Space')) hold = !hold;
      if (k('KeyZ')) { zoom = zoom % 3 + 1; display.setZoom(zoom); }
      if (k('KeyH')) hud = !hud;
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); }
    },

    tick() {
      const e = REEL[idx];
      T++;
      while (stepI < e.steps.length && e.steps[stepI][0] <= T) { e.steps[stepI][1](ctx); stepI++; }
      for (let i = pending.length - 1; i >= 0; i--) if (--pending[i].t <= 0) { pending[i].fn(); pending.splice(i, 1); }
      if (e.stress) stressTick();
      tickActor();
      if (pendingGhost) { pendingGhost = false; actor.updateMatrixWorld(true); vfx.afterImage(actor, { life: 0.34 }); }
      stage.tick();
      vfx.tick();
      if (T >= e.len) { if (hold) { const hi = idx; startEffect(hi); } else startEffect(idx + 1); }
    },

    render(alpha) {
      const ix = A.px + (A.x - A.px) * alpha;
      actor.visible = !A.hidden;
      actor.position.set(ix + A.kick, A.y, 0);
      actor.scale.set(A.sx, A.sy, A.sx);
      mat.userData.flash.value = A.flash > 0 ? 1 : 0;
      stage.render(alpha);
      vfx.render(alpha);
    },

    ui(g) {
      vfx.ui(g);
      if (!hud) return;
      const W = display.width, H = display.height, e = REEL[idx];
      const title = `${idx + 1}/${REEL.length}  ${e.label}`;
      drawText(g, title, 8, 8, 'gold', { shadow: 'ink', scale: 2 });
      drawText(g, e.note, 8, 28, 'frost', { shadow: 'ink' });
      // reel pips + the current effect's own progress
      for (let i = 0; i < REEL.length; i++) {
        g.fillStyle = css(i === idx ? 'gold' : 'slate');
        g.fillRect(8 + i * 9, 42, 7, i === idx ? 4 : 3);
      }
      g.fillStyle = css('gold'); g.fillRect(8, 48, Math.round((T / e.len) * (REEL.length * 9 - 2)), 1);
      const s = vfx.stats;
      const line = `PARTICLES ${s.alive}/${s.capacity}  PEAK ${s.peak}  MARKS ${s.marks}  VFX ${(s.msTick + s.msRender).toFixed(1)}MS  FPS ${Math.round(fpsAvg)}${hold ? '  HOLD' : ''}`;
      drawText(g, line, 8, H - 22, e.stress && s.peak >= 1900 ? 'leaf' : 'bone', { shadow: 'ink' });
      drawText(g, 'A/D CYCLE  1-9,0 JUMP  Q STRESS  E AMBIENT  SPACE HOLD  R REPLAY  T SLOW  Z ZOOM  H HUD', 8, H - 12, 'mist', { shadow: 'ink' });
    },

    state() {
      return { showcase: { effect: REEL[idx].id, index: idx, t: T, hold, zoom, vfx: vfx.stats } };
    },
  };
}
