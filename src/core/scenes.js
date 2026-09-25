// Scene state machine: title, run, boss, pause, gameover, victory, showcase (and any others
// a piece defines). One scene is active at a time; `pause` is special: it sits on top of a
// pausable scene, freezes the sim completely (loop.paused), and the scene underneath keeps
// rendering its frozen frame.
//
//   scenes.define('run', {
//     pausable: true,             // pause action (Esc/P/Start) opens the pause scene
//     enter(data, root) {},       // root: a THREE.Group already in display.scene, removed on exit
//     exit() {},
//     tick() {},                  // one 60 Hz sim step (never called while paused)
//     frame(realDt) {},           // every rendered frame, even paused (UI, menus)
//     render(alpha, realDt) {},   // before the GL draw: place meshes from interpolated state
//     ui(g, alpha) {},            // after the GL draw: 2D pixel UI into g = display.ui
//     state() {},                 // optional extra fields for window.__GR.state()
//   });
//   scenes.go('run', { seed: 4 });    // switch at the next safe point (between ticks)
//
// Defining a scene that already exists replaces it (pieces override foundation's placeholders).

import * as THREE from 'three';
import { display } from './display.js';
import { loop } from './loop.js';
import { events } from './events.js';

const defs = new Map();
let current = null;     // { name, def, root }
let under = null;       // scene beneath 'pause'
let pending = null;     // { name, data }

export const scenes = {
  define(name, def) { defs.set(name, def); return def; },
  has: (name) => defs.has(name),
  names: () => [...defs.keys()],
  /** Name of the active scene ('pause' while paused). */
  get current() { return current?.name ?? null; },
  /** The scene under the pause screen, or the active one. */
  get base() { return (under ?? current)?.name ?? null; },
  get paused() { return current?.name === 'pause'; },
  get def() { return current?.def ?? null; },

  /** Request a scene change. Applied between ticks, so a tick never runs half in one scene. */
  go(name, data = {}) {
    if (!defs.has(name)) throw new Error(`scenes.go: no scene named "${name}"`);
    pending = { name, data };
  },

  /** Apply a pending change now. Called by main between frames/ticks. */
  flush() {
    if (!pending) return;
    const { name, data } = pending;
    pending = null;
    if (under) { closeScene(current, name); current = under; under = null; loop.paused = false; }
    const prev = current?.name ?? null;
    if (current) closeScene(current, name);
    current = openScene(name, data, prev);
  },

  pause() {
    if (!current || current.name === 'pause' || !current.def.pausable || !defs.has('pause')) return false;
    under = current;
    loop.paused = true;
    current = openScene('pause', { under: under.name }, under.name);
    events.emit('pause', { paused: true });
    return true;
  },
  resume() {
    if (current?.name !== 'pause') return false;
    closeScene(current, under.name);
    current = under;
    under = null;
    loop.paused = false;
    events.emit('pause', { paused: false });
    return true;
  },
  togglePause() { return scenes.paused ? scenes.resume() : scenes.pause(); },

  // ---- driven by main.js --------------------------------------------------------------
  tick() { if (current && !scenes.paused) current.def.tick?.(); },
  frame(realDt) {
    under?.def.frame?.(realDt);
    current?.def.frame?.(realDt);
  },
  render(alpha, realDt) {
    under?.def.render?.(alpha, realDt);
    current?.def.render?.(alpha, realDt);
  },
  ui(g, alpha) {
    under?.def.ui?.(g, alpha);
    current?.def.ui?.(g, alpha);
  },
  extraState() {
    const s = (under ?? current)?.def.state?.();
    return s || {};
  },
};

function openScene(name, data, prev) {
  const def = defs.get(name);
  const root = new THREE.Group();
  root.name = `scene:${name}`;
  display.scene.add(root);
  const s = { name, def, root };
  def.enter?.(data, root);
  events.emit('scene:enter', { name, prev, data });
  return s;
}

function closeScene(s, next) {
  events.emit('scene:exit', { name: s.name, next });
  s.def.exit?.();
  display.scene.remove(s.root);
}
