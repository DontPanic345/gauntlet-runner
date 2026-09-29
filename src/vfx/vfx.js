// VFX and juice (piece `vfx`): the public API. Other pieces call this; they never make their
// own particles.
//
//   import { vfx } from '../vfx/vfx.js';
//   vfx.hitSpark(x, y, z, { dx, dz, power, palette })     vfx.slash(x, y, z, yaw, { span, radius, palette, mirror })
//   vfx.dust(x, z, { dx, dz, n, size })   vfx.step(x, z)   vfx.land(x, z)
//   vfx.dash(x, z, dx, dz, { obj })       vfx.afterimage(obj, { palette, life })
//   vfx.death(x, y, z, { colors, power }) vfx.spawnPortal(x, z, { dur }) -> { popTick }
//   vfx.embers(x, y, z, { n })            vfx.flash(x, y, z, { color, size })
//   vfx.shockwave(x, z, { radius, color }) vfx.sparkle(x, y, z)  vfx.twinkle(x, y, z)  vfx.heal(x, y, z)
//   vfx.ambient({ preset, box, sources }) -> layer   (dust motes + embers, see ambient.js)
//   vfx.bind(['move', 'combat', 'kill'])  -> unbind  (drive effects from game events, see below)
//
// Low level (for effects of your own, still pooled and on-palette): vfx.core.add(...),
// vfx.core.addShape(...), vfx.core.ramp(name, steps). See core.js.
//
// The system ticks itself on the sim 'tick' event and main.js calls vfx.render(alpha) each
// frame. Everything is cleared when the base scene exits: no teardown needed by callers.

import * as core from './core.js';
import * as fx from './effects.js';
import { ambient } from './ambient.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';

// ---- event bindings: one line for a scene to get the standard effects --------------------------
const BINDINGS = {
  // movement and hero animation events (movement and hero pieces)
  move: {
    'move:dash': (e) => fx.dash(e.x, e.z, e.dx, e.dz),
    'move:bonk': (e) => { fx.dust(e.x - e.nx * 0.3, e.z - e.nz * 0.3, { dx: e.nx, dz: e.nz, n: 6, size: 1 }); fx.hitSpark(e.x - e.nx * 0.35, 0.5, e.z - e.nz * 0.35, { dx: e.nx, dz: e.nz, power: 0.4, palette: 'cool', light: false }); },
    'hero:step': (e) => fx.step(e.x, e.z, { dx: Math.sin(e.yaw), dz: Math.cos(e.yaw) }),
    'hero:land': (e) => fx.land(e.x, e.z),
    'hero:thud': (e) => fx.land(e.x, e.z, { size: 0.8 }),
  },
  // the full combat set: replaces combat/fx.js's 3D particles (its 2D marks and numbers stay there)
  combat: {
    'combat:hit': (h) => {
      fx.hitSpark(h.x, h.y, h.z, { dx: h.tx || h.dx, dz: h.tz || h.dz, power: h.power, light: false });
      const cols = h.target?.debris;
      if (cols) chips(h, cols);
    },
    'hero:slam': (e) => fx.shockwave(e.x + Math.sin(e.yaw) * 0.9, e.z + Math.cos(e.yaw) * 0.9, { radius: 1.4 }),
    'combat:heroHurt': (e) => fx.hitSpark(e.x - e.dx * 0.2, 0.7, e.z - e.dz * 0.2, { dx: e.dx, dz: e.dz, power: 1.3, palette: 'hurt', light: false }),
    'combat:dodge': (e) => fx.sparkle(e.x, 0.8, e.z, { palette: 'sparkCool', color: 'sky' }),
  },
  // deaths only (safe to add next to combat/fx.js, which has no death effect)
  kill: {
    'combat:kill': (e) => fx.death(e.x, (e.target?.h ?? 1) * 0.5, e.z, { colors: e.target?.debris ?? ['bone', 'frost', 'stone'] }),
    'combat:heroDeath': (e) => fx.death(e.x, 0.5, e.z, { colors: ['navy', 'blue', 'bone'], power: 0.8, ring: 'sky' }),
  },
};
function chips(h, cols) {
  const n = Math.round(2 + h.power * 2);
  for (let k = 0; k < n; k++) {
    const a = Math.atan2(h.dx, h.dz) + (k / n - 0.5) * 2;
    const i = core.add(h.x, h.y, h.z, Math.sin(a) * (1.5 + k % 3), 2.5 + (k % 4), Math.cos(a) * (1.5 + k % 3), 0.7, 2 + (k % 2), cols[k % cols.length], core.CUBE);
    if (i < 0) break;
    core.P.grav[i] = 20; core.P.bounce[i] = 0.35; core.P.floorY[i] = 0.04; core.P.pop[i] = 1; core.P.shrinkAt[i] = 0.8; core.P.fadeAt[i] = 0.8;
  }
}

/** Drive standard effects from game events. groups: 'move' | 'combat' | 'kill'. Returns unbind. Unbinds on scene exit. */
function bind(groups = ['move', 'kill']) {
  const offs = [];
  for (const g of [].concat(groups)) {
    const b = BINDINGS[g];
    if (!b) continue;
    for (const name in b) offs.push(events.on(name, b[name]));
  }
  const unbind = () => { offs.forEach((f) => f()); offs.length = 0; offClear(); };
  const offClear = events.on('vfx:clear', unbind);
  return unbind;
}

export const vfx = {
  ...fx.EFFECTS,
  ambient,
  bind,
  BINDINGS,
  seed: fx.seedVfx,
  render: core.render,
  clear: core.clear,
  later: core.later,
  core,
  get count() { return core.P.n; },
  get shapes() { return core.S.n; },
  stats() {
    return { particles: core.P.n, cap: core.CAP, shapes: core.S.n, shapeCap: core.SHAPES, ...core.stats,
      tickMs: +core.stats.tickMs.toFixed(3), renderMs: +core.stats.renderMs.toFixed(3) };
  },
};

// __GR.debug.vfx(action?, ...args):
//   ()                        -> stats {particles, cap, shapes, spawned, dropped, peak, tickMs, renderMs}
//   ('play', name, x, y, z, opts) trigger any effect by name at a point (yaw for slash goes in opts.yaw)
//   ('clear')                 remove everything     ('seed', n)  reseed the vfx stream
//   ('list')                  effect names
debug.add('vfx', (action, ...a) => {
  if (!action) return vfx.stats();
  if (action === 'list') return Object.keys(fx.EFFECTS);
  if (action === 'clear') { core.clear(); return vfx.stats(); }
  if (action === 'seed') { fx.seedVfx(a[0]); return true; }
  if (action === 'play') {
    const [name, x = 0, y = 0.6, z = 0, opts = {}] = a;
    const f = fx.EFFECTS[name];
    if (!f) return { ok: false, error: `no effect "${name}"`, effects: Object.keys(fx.EFFECTS) };
    if (name === 'afterimage') return { ok: false, error: 'afterimage needs an Object3D: call vfx.afterimage(obj) from code' };
    if (name === 'slash') f(x, y, z, opts.yaw ?? 0, opts);
    else if (['dust', 'step', 'land', 'shockwave', 'spawnPortal'].includes(name)) f(x, z, opts);
    else if (name === 'dash') f(x, z, opts.dx ?? 1, opts.dz ?? 0, opts);
    else f(x, y, z, opts);
    return { ok: true, ...vfx.stats() };
  }
  return { ok: false, error: `unknown vfx action "${action}"` };
});
