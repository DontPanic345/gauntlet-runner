// The run director (piece `run-flow`): routes every scene change inside a run, styles the
// transitions, runs the death sequence's slow motion, and owns the one-key restart.
//
//   import { flow } from './run/flow.js';
//   flow.draw(g, realDt)     main.js calls it every frame, after the scene UI (before the title's iris)
//   flow.restart({ sameSeed })   a new run now (R on the death and summary screens)
//   flow.covered             true while a transition wall hides the screen (the run scene holds its drop-in)
//   flow.info()              state for debug.run()
//
// Routing (scenes.router, see core/scenes.js): a change requested between two gameplay scenes
// (run / gauntlet / boss) is held while a wall of stone blocks drops in and covers the screen,
// with a carved card naming the next segment; the switch happens behind it, then the wall
// falls away. The hero's hp and the run seed are carried in the scene data and re-applied
// on entry (the gauntlet and boss scenes create their own HeroHealth at full hp).
// A 'gameover' asked for by a scene is held: the death sequence decides when it happens.
// A 'victory' is held for one frame so the last frame of the pit can be captured.
//
// Death sequence (real time; any of J / Enter / Space skips ahead, R restarts at once):
//   0.00  combat:heroDeath. Slow motion (x0.18), letterbox bars and a dithered vignette close in
//   0.45  time eases back toward x0.7; "[R] RISE AGAIN" and "[J] SKIP" sit in the bottom bar
//   1.05  the frame is captured and the 'gameover' scene takes over: it cracks from the hero
//         and falls apart into the dark, then the summary slab drops in (src/run/endings.js)

import { scenes } from '../core/scenes.js';
import { loop } from '../core/loop.js';
import { input } from '../core/input.js';
import { events } from '../core/events.js';
import { display } from '../core/display.js';
import { world } from '../core/world.js';
import { debug } from '../core/debug.js';
import { feedback } from '../core/feedback.js';
import { css } from '../render/palette.js';
import { drawText } from '../core/pixelfont.js';
import { ditherRect, drawKey, drawPrompt } from '../ui/menus.js';
import { generateArena, ARENA_COUNT } from '../world/arena.js';
import { director } from '../audio/director.js';
import { createWall } from './wall.js';
import { runSound } from './sfx.js';
import { cropPortrait } from './summary.js';
import { run, meta, GAMEPLAY, startRun, endRun, abandonRun, snapshotBoons, fmtTime, resetMeta, placeText } from './record.js';

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;

export const DEATH = {
  slow: 0.18,        // time scale at the moment of death
  holdSlow: 0.45,    // real seconds at that scale
  ease: 0.6,         // then eases to `to` over this long
  to: 0.7,
  capture: 1.05,     // real seconds until the frame cracks (the gameover scene)
  portrait: 0.5,     // when the summary's portrait is cut (the 3D frame only: the hero going down)
  skipAfter: 0.12,   // a skip press is honoured after this (a held attack does not skip by accident)
};

/**
 * The clock every run-flow animation runs on (real time). scale slows or speeds it; fixed > 0
 * advances exactly that many seconds per rendered frame (deterministic strips in a slow
 * headless browser: debug.run('clock', { fixed: 1 / 30 })).
 */
export const CLOCK = { scale: 1, fixed: 0, manual: false, budget: 0 };
let clockFrame = -1, clockDt = 0;
/** This frame's run-flow dt (the same value for every caller within one rendered frame). */
export function rdt(realDt) {
  if (clockFrame === loop.frameCount) return clockDt;
  clockFrame = loop.frameCount;
  if (CLOCK.manual) {
    // manual: only advance what debug.run('advance', s) handed out, 1/30 s per frame
    clockDt = Math.min(CLOCK.budget, 1 / 30);
    CLOCK.budget = Math.max(0, CLOCK.budget - clockDt);
  } else clockDt = CLOCK.fixed > 0 ? CLOCK.fixed : Math.min(realDt, 0.1) * CLOCK.scale;
  return clockDt;
}

const wall = createWall({ sound: (n, o) => runSound(n, o) });
let pendingScene = null, pendingFrames = 0, holdT = 0;
let death = null;          // { t, base, x, z, skip }
let capture = null;        // { kind: 'death' | 'victory', data }
let firstRun = true;
let lastSnapshot = null;   // the last captured frame (debug / showcase)
const listeners = [];

export const randomSeed = () => 10000 + Math.floor(Math.random() * 89999);

// ---- capture: the composed frame (3D + scene UI) as a canvas -------------------------------------
let capCanvas = null;
/** The 3D frame only (no HUD, no numbers): what the summary's portrait is cut from. */
function captureGL() {
  const W = display.width, H = display.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  try { g.drawImage(display.renderer.domElement, 0, 0, W, H); } catch { g.fillStyle = css('night'); g.fillRect(0, 0, W, H); }
  return c;
}
function captureFrame() {
  const W = display.width, H = display.height;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;
  try { g.drawImage(display.renderer.domElement, 0, 0, W, H); } catch { g.fillStyle = css('night'); g.fillRect(0, 0, W, H); }
  g.drawImage(display.uiCanvas, 0, 0);
  capCanvas = c;
  return c;
}

// ---- cards for the transition wall ------------------------------------------------------------------
function cardFor(name, data) {
  if (name === 'gauntlet') {
    const i = data.index | 0;
    return { kicker: `DEPTH ${i * 2 + 2} OF 10`, title: `CORRIDOR ${i + 1}`, sub: 'RUN. THE MOUNTAIN IS FALLING.', color: 'flame', subColor: 'ember', accent: 'ember' };
  }
  if (name === 'run') {
    const i = Math.max(0, Math.min(ARENA_COUNT - 1, data.room | 0));
    let L = null;
    try { L = generateArena(i, run.seed); } catch { L = null; }
    return { kicker: `ARENA ${i + 1} OF ${ARENA_COUNT}  •  DEPTH ${i * 2 + 1} OF 10`, title: L?.name ?? `ARENA ${i + 1}`, sub: L?.themeLabel ?? null, color: 'bone', accent: 'gold' };
  }
  if (name === 'boss') return { kicker: 'THE BOTTOM OF THE GAUNTLET', title: "THE WARDEN'S PIT", sub: 'THERE IS NO WAY BACK UP', color: 'red', subColor: 'rose', accent: 'red' };
  return null;
}

function carry(data) {
  const h = world.hero;
  if (h && h.hp > 0) { run.hp = h.hp; run.maxHp = h.maxHp; }
  data.hp = run.hp; data.maxHp = run.maxHp; data.seed = run.seed; data.carry = true;
  snapshotBoons();
  return data;
}

// ---- the router --------------------------------------------------------------------------------------
function route(name, data, from) {
  const fromPlay = GAMEPLAY.has(from);
  if (name === 'title') {
    if (run.active && !run.ended) abandonRun();
    stopDeath();
    return false;
  }
  if (!fromPlay) return false;
  if (name === 'gameover') {
    if (death || capture) return true;          // the death sequence decides when
    startDeath(world.hero ?? { x: 0, z: 0 });
    death.t = DEATH.capture;                     // nobody saw it coming: go now
    return true;
  }
  if (name === 'victory') {
    if (capture) return true;
    capture = { kind: 'victory', data };
    return true;
  }
  if (GAMEPLAY.has(name)) {
    if (death || capture) return true;          // no room changes while dying
    if (wall.state === 'closing' || wall.state === 'closed') return true;   // already on the way
    carry(data);
    const card = cardFor(name, data);
    wall.close({ card, onCovered: () => { pendingScene = name; pendingFrames = 0; holdT = 0; scenes.goNow(name, data); } });
    return true;
  }
  return false;
}
scenes.router = route;

// ---- scene entry: re-apply the carried hp (scenes that build their own hero) ----------------------
listeners.push(events.on('scene:enter', (e) => {
  const n = e.name;
  if (n === 'pause') return;
  if (GAMEPLAY.has(n)) {
    if (!run.active || run.ended) {
      // entering play with no run (e.g. ?scene=boss, debug.scene): start one so stats count
      startRun(window.__GR?.seed ?? 1);
      run.hp = world.hero?.hp ?? 5; run.maxHp = world.hero?.maxHp ?? 5;
    }
    const d = e.data ?? {};
    if (d.carry && n !== 'run' && world.hero && Number.isFinite(d.hp)) {
      world.hero.maxHp = d.maxHp ?? world.hero.maxHp;
      world.hero.hp = Math.max(1, Math.min(world.hero.maxHp, d.hp));
    }
  }
}));

// ---- death -------------------------------------------------------------------------------------------
function startDeath(at) {
  if (death) return;
  death = { t: 0, base: loop.timeScale || 1, x: at.x ?? 0, z: at.z ?? 0, skip: false, scene: scenes.base };
  snapshotBoons();
}
function stopDeath() {
  if (!death) return;
  loop.setTimeScale(death.base);
  death = null;
}
listeners.push(events.on('combat:heroDeath', (e) => {
  if (!run.active || run.ended || !GAMEPLAY.has(scenes.base)) return;
  startDeath(e);
}));

function finishDeath() {
  // capture the frame, freeze the run, hand over to the gameover scene
  const h = world.hero;
  const p = display.worldToScreen(h?.x ?? death.x, 0.6, h?.z ?? death.z);
  const img = captureFrame();
  lastSnapshot = img;
  const result = endRun('death');
  const skip = death.skip;
  const portrait = death.portrait ?? cropPortrait(img, p.x, p.y);
  loop.setTimeScale(death.base);
  death = null;
  scenes.goNow('gameover', { snapshot: img, ex: p.x, ey: p.y, result, skip, portrait });
}

function finishVictory() {
  const h = world.hero;
  const p = h ? display.worldToScreen(h.x, 0.7, h.z) : { x: display.width / 2, y: display.height / 2 };
  const img = captureFrame();
  lastSnapshot = img;
  const portrait = cropPortrait(captureGL(), p.x, p.y);
  const result = endRun('victory');
  const data = capture.data;
  capture = null;
  scenes.goNow('victory', { ...data, snapshot: img, result, portrait });
}

// ---- restart -----------------------------------------------------------------------------------------
function restart({ sameSeed = false, seed = null } = {}) {
  if (wall.state === 'closing' || wall.state === 'closed') return false;
  if (restarting) return false;
  const s = seed ?? (sameSeed ? run.seed : randomSeed());
  if (death) { endRun('death'); stopDeath(); }
  capture = null;
  runSound('run.rise');
  try { director.enterMode('silent'); } catch { /* audio is optional */ }
  // the screen as it is now breaks up and falls away over the new run, which starts at once
  restarting = { seed: s, sameSeed };
  return true;
}
let restarting = null;
function doRestart() {
  const { seed: s, sameSeed } = restarting;
  restarting = null;
  const img = captureFrame();
  wall.shatter(img, { fast: true });   // the run scene shows its own RUN n / SEED card
  scenes.goNow('run', { fresh: true, seed: s, room: 0 });
}

// ---- per frame -------------------------------------------------------------------------------------------
function draw(g, realDt) {
  const dt = rdt(realDt);

  // a held victory: capture this frame (it is the pit, drawn and lit), then switch
  if (capture?.kind === 'victory') finishVictory();

  // the death sequence's slow motion and overlay
  if (death) {
    if (!scenes.paused) death.t += dt;
    const t = death.t;
    const k = t < DEATH.holdSlow ? DEATH.slow : DEATH.slow + (DEATH.to - DEATH.slow) * easeOut((t - DEATH.holdSlow) / DEATH.ease);
    if (!scenes.paused) loop.setTimeScale(death.base * k);
    if (!scenes.paused && t > DEATH.skipAfter && (input.ui.pressed('confirm') || input.ui.pressed('attack') || input.ui.pressed('dash'))) death.skip = true;
    // the portrait for the summary: a clean frame a beat after the blow, before the shade
    if (!death.portrait && (t >= DEATH.portrait || death.skip || t >= DEATH.capture)) {
      const h = world.hero;
      const p = display.worldToScreen(h?.x ?? death.x, 0.55, h?.z ?? death.z);
      death.portrait = cropPortrait(captureGL(), p.x, p.y);
    }
    drawDeathShade(g, t);
    // the frame that cracks keeps the shade and the bars, not the prompts
    if (!scenes.paused && (t >= DEATH.capture || death.skip)) finishDeath();
    else drawDeathText(g, t);
  }

  // restart: R anywhere a run is over or ending (never under the pause menu)
  const over = death || scenes.current === 'gameover' || scenes.current === 'victory';
  if (over && !scenes.paused && input.ui.key('KeyR')) restart();
  if (restarting) doRestart();   // after this frame's scene UI is drawn, so the capture has it

  // the transition wall: reveal once the next scene has drawn a frame behind it
  if (wall.state === 'closed') {
    holdT += dt;
    if (pendingScene && scenes.current === pendingScene) pendingFrames++;
    if (pendingFrames >= 2 && holdT >= (wall.fast ? 0.08 : 0.16)) { pendingScene = null; wall.open(); }
    else if (!pendingScene && holdT > 2) wall.open();   // nothing to wait for
  }
  wall.draw(g, dt);
  flow.onDraw?.(g, dt);
}

// ---- the colour drains out: the 3D frame remapped to the cool ramp, blood kept --------------------
const RAMP = ['ink', 'night', 'shadow', 'dusk', 'violet', 'slate', 'mist', 'fog', 'frost', 'bone'];
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
let monoC = null, monoG = null, rampLUT = null;
function drainFrame(g, k) {
  const W = display.width, H = display.height;
  if (!monoC) { monoC = document.createElement('canvas'); monoG = monoC.getContext('2d', { willReadFrequently: true }); }
  if (monoC.width !== W || monoC.height !== H) { monoC.width = W; monoC.height = H; }
  if (!rampLUT) {
    rampLUT = new Uint32Array(256);
    const cols = RAMP.map((n) => { const h = css(n); return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; });
    for (let l = 0; l < 256; l++) {
      const i = Math.min(RAMP.length - 1, Math.floor(Math.pow(l / 255, 0.7) * RAMP.length));
      const [r, gg, b] = cols[i];
      rampLUT[l] = (255 << 24) | (b << 16) | (gg << 8) | r;
    }
  }
  try { monoG.drawImage(display.renderer.domElement, 0, 0, W, H); } catch { return; }
  const img = monoG.getImageData(0, 0, W, H);
  const px = new Uint32Array(img.data.buffer);
  const lvl = k * 16;
  for (let y = 0; y < H; y++) {
    const row = y * W, by = (y & 3) * 4;
    for (let x = 0; x < W; x++) {
      if (BAYER[by + (x & 3)] >= lvl) continue;
      const v = px[row + x];
      const r = v & 255, gg = (v >> 8) & 255, b = (v >> 16) & 255;
      if (r > 90 && r > gg * 1.7 && r > b * 1.4) continue;   // blood stays red
      px[row + x] = rampLUT[(r * 77 + gg * 150 + b * 29) >> 8];
    }
  }
  monoG.putImageData(img, 0, 0);
  g.drawImage(monoC, 0, 0);
}

function drawDeathShade(g, t) {
  const W = display.width, H = display.height;
  drainFrame(g, easeOut(t / 0.5));
  // vignette: dithered ink frames closing in
  const v = easeOut(t / 0.7);
  for (let i = 0; i < 6; i++) {
    const th = 10, inset = i * th;
    const lvl = Math.max(0, (v * 11 - i * 2));
    if (lvl <= 0) continue;
    ditherRect(g, inset, inset, W - inset * 2, th, 'ink', lvl);
    ditherRect(g, inset, H - inset - th, W - inset * 2, th, 'ink', lvl);
    ditherRect(g, inset, inset + th, th, H - inset * 2 - th * 2, 'ink', lvl);
    ditherRect(g, W - inset - th, inset + th, th, H - inset * 2 - th * 2, 'ink', lvl);
  }
  // letterbox bars
  const bar = Math.round(28 * easeOut(t / 0.3));
  g.fillStyle = css('ink');
  g.fillRect(0, 0, W, bar); g.fillRect(0, H - bar, W, bar);
  g.fillStyle = css('blood');
  if (bar > 2) { g.fillRect(0, bar - 1, W, 1); g.fillRect(0, H - bar, W, 1); }
}

function drawDeathText(g, t) {
  const W = display.width, H = display.height;
  const bar = Math.round(28 * easeOut(t / 0.3));
  if (t > 0.25 && bar > 20) {
    const y = H - bar + 8;
    const k = Math.min(1, (t - 0.25) / 0.15);
    const dx = Math.round((1 - k) * 12);
    let x = 14 - dx;
    x += drawKey(g, 'KeyR', x, y) + 5;
    drawText(g, 'RISE AGAIN', x, y + 2, 'bone', { shadow: 'ink' });
    const lw = 92;
    drawPrompt(g, 'attack', 'SKIP', W - 14 - lw + dx, y, 'mist');
    drawText(g, fmtTime(run.ticks), W / 2, y + 2, 'slate', { align: 'center' });
  }
}

// ---- the public face ---------------------------------------------------------------------------------------
export const flow = {
  draw,
  restart,
  route,
  wall,
  /** True while a transition wall hides the screen. */
  get covered() { return wall.state === 'closing' || wall.state === 'closed'; },
  get dying() { return !!death; },
  get lastSnapshot() { return lastSnapshot; },
  /** The seed for a fresh run entered from outside a run (the URL seed the first time). */
  freshSeed(data) {
    if (Number.isFinite(data?.seed)) return data.seed;
    if (firstRun) return window.__GR?.seed ?? 1;
    return randomSeed();
  },
  markStarted() { firstRun = false; },
  /** Drop any death sequence, held capture and transition (the showcase jumping between modes). */
  reset() { stopDeath(); capture = null; wall.cancel(); pendingScene = null; restarting = null; },
  onDraw: null,           // showcase overlay hook
  info() {
    return {
      active: run.active, ended: run.ended, outcome: run.outcome, number: run.number, seed: run.seed,
      time: fmtTime(run.ticks), ticks: run.ticks, kills: run.kills, killsBy: { ...run.killsBy }, dmg: Math.round(run.dmg), hurts: run.hurts, dodges: run.dodges,
      shards: run.shards, boons: run.boons.map((b) => b.id), hp: run.hp, maxHp: run.maxHp, node: run.node, deepest: run.deepest, place: placeText(),
      cause: run.cause, staged: run.staged,
      transition: wall.state, death: death ? +death.t.toFixed(2) : null, scene: scenes.current,
      meta: { ...meta, lore: meta.lore.length },
    };
  },
};

// __GR.debug.run(action?, ...):
//   ()                        the run: time, kills, damage, boons, depth, cause, transition and death state, meta
//   ('die', cause?)           kill the hero now (cause: husk|wisp|brute|mite|warden|collapse|spikes|blade|fire|pit)
//   ('restart') ('retry')     a new run on a new seed / on the same seed (as R / E on the summary)
//   ('next')                  go to the next segment as if the exit was reached (with the transition)
//   ('win')                   end the run in victory now (the victory sequence, from any scene)
//   ('summary', 'death'|'victory')   jump to the summary of the current run
//   ('skip')                  skip the death sequence / summary animation
//   ('clock', {scale, fixed, manual})  the run-flow animation clock: scale < 1 slows it; fixed = seconds
//                             per frame; manual: it stands still except for ('advance', seconds)
//   ('advance', s)            manual clock: run s more seconds of run-flow animation (1/30 s per frame).
//                             With debug.freeze(true) this gives exact frames of the death, wall and summary.
//   ('meta') ('resetMeta')    the persistent meta (best time, best depth, lore)
debug.add('run', (action, a) => {
  if (!action) return flow.info();
  if (action === 'die') {
    if (!world.hero || !GAMEPLAY.has(scenes.base)) return { ok: false, error: 'no hero in a run scene' };
    if (a) { run.cause = a; }
    const h = world.hero, god = world.god;
    world.god = false;
    const r = h.hurt ? h.hurt(h.hp, null, { force: true }) : (h.hp = 0, { ok: true });
    if (h.hp > 0 && h.hurt) h.hurt(h.hp, null, { force: true });   // a ward or phoenix ate the first
    world.god = god;
    if (a) run.cause = a;
    return { ok: true, ...r, cause: run.cause };
  }
  if (action === 'restart') return { ok: restart() };
  if (action === 'retry') return { ok: restart({ sameSeed: true }) };
  if (action === 'next') {
    const r = world.room;
    if (!r) return { ok: false, error: 'not in a run room' };
    if (r.kind === 'arena') scenes.go(r.index + 1 < ARENA_COUNT ? 'gauntlet' : 'boss', { index: r.index, room: r.index + 1 });
    else if (r.kind === 'corridor') scenes.go('run', { room: (r.index | 0) + 1 });
    else if (r.kind === 'boss') scenes.go('victory', {});
    return { ok: true, from: r.kind };
  }
  if (action === 'win') {
    if (GAMEPLAY.has(scenes.base)) { capture = { kind: 'victory', data: {} }; return { ok: true }; }
    const result = endRun('victory');
    scenes.goNow('victory', { result });
    return { ok: true };
  }
  if (action === 'summary') {
    const result = endRun(a === 'victory' ? 'victory' : 'death');
    stopDeath();
    scenes.goNow(a === 'victory' ? 'victory' : 'gameover', { result, skip: true, direct: true });
    return { ok: true };
  }
  if (action === 'skip') { if (death) death.skip = true; events.emit('run:skip', {}); return { ok: true }; }
  if (action === 'clock') { if (a && typeof a === 'object') Object.assign(CLOCK, a); return { ...CLOCK }; }
  if (action === 'advance') { CLOCK.manual = true; CLOCK.budget += Math.max(0, +a || 0); return { ...CLOCK }; }
  if (action === 'meta') return { ...meta };
  if (action === 'resetMeta') { resetMeta(); return { ok: true }; }
  return { ok: false, error: `unknown action "${action}"` };
});
