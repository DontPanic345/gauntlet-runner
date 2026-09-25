// window.__GR: the debug and test contract (hurdles/PROTOCOL.md, "Game contract").
// Never remove a hook. Add new ones with debug.handle() from the piece that owns the behaviour.
//
//   debug.handle('spawn', (type, x, z) => ...)   // a piece implements a contract hook
//   debug.add('shake', (n) => ...)                // a piece adds a brand-new hook
//
// Hooks with no implementation yet return { ok: false, error } and log nothing, so a
// critic's script never trips a console error on an unbuilt piece.

import { loop } from './loop.js';
import { scenes } from './scenes.js';
import { world } from './world.js';
import { input } from './input.js';
import { display } from './display.js';
import { drawText, LINE_H } from './pixelfont.js';
import { cacheStats } from '../render/voxel/index.js';

const handlers = new Map();
const r3 = (n) => (typeof n === 'number' ? Math.round(n * 1000) / 1000 : n);

function call(name, args) {
  const fn = handlers.get(name);
  if (!fn) return { ok: false, error: `no handler for "${name}" yet (the owning piece has not registered one)` };
  const out = fn(...args);
  return out === undefined ? { ok: true } : out;
}

export const debug = {
  // ---- contract hooks ----
  timeScale(s) { return loop.setTimeScale(s); },
  god(on = true) { world.god = !!on; handlers.get('god')?.(world.god); return world.god; },
  spawn(type, x = 0, z = 0) { return call('spawn', [type, x, z]); },
  goto(roomIndex) { return call('goto', [roomIndex]); },
  give(boonId) { return call('give', [boonId]); },
  hurt(n = 1) {
    if (handlers.has('hurt')) return call('hurt', [n]);
    const h = world.hero;
    if (!h) return { ok: false, error: 'no hero in this scene' };
    if (!world.god) h.hp = Math.max(0, h.hp - n);
    return { ok: true, hp: h.hp };
  },
  kill() {
    if (handlers.has('kill')) return call('kill', []);
    const h = world.hero;
    if (!h) return { ok: false, error: 'no hero in this scene' };
    h.hp = 0;
    return { ok: true };
  },

  // ---- foundation extras ----
  /** Pause (true) / resume (false) the sim via the pause scene; returns paused state. */
  pause(on = true) { on ? scenes.pause() : scenes.resume(); return scenes.paused; },
  /** Freeze the sim without the pause scene (for clean captures). Returns frozen state. */
  freeze(on = true) { loop.paused = !!on; return loop.paused; },
  /** Run exactly n sim ticks on the next frame, even while paused or frozen. */
  step(n = 1) { loop.step(n); return loop.tick + n; },
  /** Switch scene: debug.scene('run', {seed: 3}). */
  scene(name, data = {}) { scenes.go(name, data); return name; },
  /** Hold (true) / release (false) an action as if a bound key were held. */
  input(action, down = true) { input.inject(action, down); return down; },
  /** Tap an action for n ticks (default 2). */
  tap(action, ticks = 2) {
    input.inject(action, true);
    const release = loop.tick + ticks;
    const off = setInterval(() => { if (loop.tick >= release) { input.inject(action, false); clearInterval(off); } }, 5);
    return true;
  },
  /** Hitstop test: freeze the sim for ms real milliseconds. */
  hitstop(ms = 80) { loop.hitstop(ms); return ms; },
  /** Voxel mesh cache stats. */
  models() { return cacheStats(); },
  /** Toggle the ?debug=1 overlay. */
  overlay(on) { overlayOn = on ?? !overlayOn; return overlayOn; },

  // ---- registration ----
  handle(name, fn) { handlers.set(name, fn); },
  add(name, fn) {
    if (name in debug) throw new Error(`debug.add: "${name}" already exists`);
    debug[name] = fn;
  },
  handlers: () => [...handlers.keys()],
};

let overlayOn = new URLSearchParams(location.search).get('debug') === '1';

/** Serialisable snapshot for window.__GR.state(). */
export function snapshot() {
  const h = world.hero;
  return {
    scene: scenes.current,
    paused: scenes.paused,
    tick: loop.tick,
    timeScale: loop.timeScale,
    hero: h ? { x: r3(h.x), z: r3(h.z), hp: h.hp, maxHp: h.maxHp } : null,
    room: world.room ? { ...world.room } : null,
    enemies: (world.enemies || []).map((e) => ({ id: e.id, type: e.type, x: r3(e.x), z: r3(e.z), hp: e.hp })),
    boons: [...(world.boons || [])],
    ...scenes.extraState(),
  };
}

/** Build window.__GR. Called once by main.js. */
export function installContract(seed) {
  const GR = {
    ready: false,
    get frame() { return loop.tick; },
    get scene() { return scenes.current; },
    seed,
    state: snapshot,
    debug,
    // read-only conveniences for scripts
    get paused() { return scenes.paused; },
    get fps() { return Math.round(loop.fps); },
    get renderFrame() { return loop.frameCount; },
  };
  window.__GR = GR;
  return GR;
}

/** Draw the ?debug=1 overlay (bottom centre; backquote toggles). Called by main after the scene renders. */
export function drawDebugOverlay() {
  if (input.ui.key('Backquote')) overlayOn = !overlayOn;
  if (!overlayOn) return;
  const g = display.ui;
  const s = snapshot();
  const lines = [
    `${Math.round(loop.fps)} FPS  ${loop.frameMs.toFixed(1)} MS`,
    `TICK ${loop.tick}  X${loop.timeScale}${loop.paused ? '  PAUSED' : ''}`,
    `SCENE ${s.scene}`,
    s.hero ? `HERO X${s.hero.x.toFixed(2)} Z${s.hero.z.toFixed(2)} HP ${s.hero.hp}/${s.hero.maxHp}` : 'HERO -',
    `ENEMIES ${s.enemies.length}  BOONS ${s.boons.length}`,
    `DRAWS ${display.renderer.info.render.calls}  TRIS ${display.renderer.info.render.triangles}`,
  ];
  // bottom-centre, above any help bar: the corners belong to HUDs and showcase panels
  const w = 150, x = Math.round((display.width - w) / 2), y = display.height - lines.length * LINE_H - 5 - 18;
  g.fillStyle = 'rgba(11,10,18,0.8)';
  g.fillRect(x, y, w, lines.length * LINE_H + 5);
  lines.forEach((l, i) => drawText(g, l, x + 4, y + 4 + i * LINE_H, i === 0 ? 'gold' : 'frost'));
}
