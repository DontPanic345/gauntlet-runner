// The shared vfx system (piece `vfx`). Other pieces call this; they never make their own particles.
//
//   import { vfx } from '../vfx/index.js';
//
//   // once per scene, in enter(data, root):
//   vfx.attach(root, { ambient: 'crypt' });      // pool + ambient layer live under `root`
//   // in the scene's hooks:
//   tick()   { vfx.tick(); }                     // 60 Hz sim step (holds through hitstop and pause)
//   render(a){ vfx.render(a); }                  // place instances from interpolated state
//   ui(g)    { vfx.ui(g); }                      // 2D marks (stars, smears, glows, twinkles)
//   exit()   { vfx.detach(); }
//
//   // then anywhere:
//   vfx.hit({ x, y, z, dx, dz, power })          // hit-spark: core pop, streaks, chips, star
//   vfx.smear({ x, y, z, yaw, radius, sweep, side, power })   // slash crescent
//   vfx.dust({ x, z, dx, dz, n, size })          // dust puff
//   vfx.dash({ x, z, dx, dz })                   // kick-off dust, speed lines, floor ring
//   vfx.afterImage(object3D, { life, ramp })     // flat palette ghost of any object
//   vfx.death({ x, y, z, power, colors })        // death burst in the target's own palette names
//   vfx.portal({ x, z, radius, dur, style })     // spawn portal; pops at the end
//   vfx.embers({ x, y, z, n } | { dur })         // ember burst, or a fountain for dur seconds
//   vfx.flash({ x, y, z, color, radius, ms, screen })         // dithered glow + light pop
//   vfx.shockwave({ x, z, radius, style })       // decelerating floor ring
//   vfx.pickup({ x, y, z, style })               // rising ring, twinkling motes, star sprites
//   vfx.ambient.mood('crypt'|'collapse'|'boss'|'calm'|'off'); vfx.ambient.set({ embers, dust, grit, wind, rise })
//
// Every effect takes an options object. `feel: true` in it also fires shake / screen flash through
// the shared feedback channel (off by default so callers that do their own do not double up).
// Events: emit 'vfx:play' { name, ...opts } from anywhere, and it plays the named effect.
// `style` is one of: hit, hurt, magic, void, ember, gold, ice (or a comma list of palette names).

import * as THREE from 'three';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { createParticles } from './particles.js';
import { createAmbient } from './ambient.js';
import { createEffects } from './effects.js';
import { drawMarks, tickMarks, clearMarks, markCount } from './marks.js';

export const EFFECTS = ['hit', 'smear', 'dust', 'dash', 'death', 'portal', 'embers', 'flash', 'shockwave', 'pickup'];

let pp = null, amb = null, fx = null, root = null, tickN = 0;
let msTick = 0, msRender = 0;      // smoothed JS cost per call, for the stats readout
let holder = null;

function call(name, o) {
  if (!fx) return false;
  fx[name](o);
  return true;
}

export const vfx = {
  /** Attach to a scene root. Replaces any previous attachment (its pool is disposed). */
  attach(sceneRoot, { ambient = 'crypt', capacity = 2600 } = {}) {
    if (holder) vfx.detach();
    root = sceneRoot;
    holder = new THREE.Group();
    holder.name = 'vfx';
    root.add(holder);
    pp = createParticles(holder, capacity);
    fx = createEffects(pp, { root: holder });
    amb = createAmbient(holder);
    amb.mood(ambient || 'off');
    vfx.ambient = amb;
    clearMarks();
    tickN = 0;
    return vfx;
  },
  detach() {
    if (!holder) return;
    fx.dispose(); pp.dispose(); amb.dispose();
    root.remove(holder);
    clearMarks();
    pp = amb = fx = root = holder = null;
    vfx.ambient = nullAmbient;
  },
  get attached() { return !!holder; },

  tick() {
    if (!pp) return;
    const t0 = performance.now();
    tickN++; pp.tick(); fx.tick(); amb.tick(); tickMarks();
    msTick += (performance.now() - t0 - msTick) * 0.1;
  },
  render(alpha) {
    if (!pp) return;
    const t0 = performance.now();
    pp.render(alpha, (tickN + alpha) / 60); amb.render(alpha);
    msRender += (performance.now() - t0 - msRender) * 0.1;
  },
  ui(g) { if (holder) drawMarks(g); },
  clear() { if (!pp) return; pp.clear(); fx.clear(); clearMarks(); },

  play(name, o = {}) { return call(name, o); },
  ambient: null,
  get stats() { return pp ? { alive: pp.count, peak: pp.peak, capacity: pp.capacity, recycled: pp.recycled, marks: markCount(), emitters: fx.activeEmitters(), ambient: amb.counts, mood: amb.name, msTick: +msTick.toFixed(2), msRender: +msRender.toFixed(2) } : null; },
  resetPeak() { pp?.resetPeak(); },
  /** Raw pool access for effects authored elsewhere; see particles.js add(). */
  get pool() { return pp; },
};
const nullAmbient = { set() {}, mood() { return false; }, get counts() { return {}; }, get name() { return 'off'; } };
vfx.ambient = nullAmbient;
for (const name of [...EFFECTS, 'afterImage']) vfx[name] = (o, o2) => (fx ? fx[name](o, o2) : false);

events.on('vfx:play', (e) => { if (e?.name) vfx.play(e.name, e); });

debug.add('vfx', (name = 'hit', x = 0, z = 0, opts = {}) => {
  if (!vfx.attached) return { ok: false, error: 'no vfx attached to this scene' };
  if (!EFFECTS.includes(name)) return { ok: false, error: `unknown effect "${name}"; try ${EFFECTS.join(', ')}` };
  vfx.play(name, { x, z, ...opts });
  return { ok: true, stats: vfx.stats };
});
debug.add('vfxStats', () => vfx.stats ?? { ok: false, error: 'no vfx attached' });
