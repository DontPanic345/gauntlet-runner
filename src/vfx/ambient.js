// Ambient scene layer (piece `vfx`): dust motes hanging in the air and embers rising from fire
// sources, so the world is never fully still (GAME.md feel rules). Everything is drawn by the
// shared particle pool; a layer only decides when to spawn.
//
//   const amb = ambient({ box: [-8, 8, 0.2, 3, -5, 5], dust: 60, sources: [[x, y, z], ...], embers: 6,
//                         fires: [[x, y, z, size], ...] });   // fires: voxel flames that lick up and die
//   amb.set({ embers: 20 }); amb.stop();           // stopped automatically when the scene exits
//
// Presets: ambient({ preset: 'crypt' | 'collapse' | 'boss', box }) fill in the counts and colours.
//   crypt     slow cool motes, a few embers off any sources
//   collapse  embers rise from the whole floor and grit falls from above (gauntlet corridors)
//   boss      violet-rose motes, sparse embers

import { P, add, ownerSlot, freeOwner, onTick, SPRITE, STREAK, CUBE } from './core.js';
import { events } from '../core/events.js';

const PRESETS = {
  crypt: { dust: 56, dustRamps: ['mote', 'mote', 'moteLight', 'moteDark'], embers: 4, floorEmbers: 0, grit: 0, drift: 0.08 },
  collapse: { dust: 40, dustRamps: ['moteDark', 'mote', 'emberDim'], embers: 6, floorEmbers: 24, grit: 16, drift: 0.2 },
  boss: { dust: 60, dustRamps: ['mote', 'moteDark', 'portalMote'], embers: 3, floorEmbers: 2, grit: 0, drift: 0.06 },
};

let seed = 77;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const rr = (a, b) => a + (b - a) * rnd();

/**
 * Start an ambient layer. box = [x0, x1, y0, y1, z0, z1] in world units (the air to fill).
 * dust: motes kept alive. embers: per second from each source. floorEmbers: per second from
 * random floor points in the box. grit: per second falling from the top of the box.
 */
export function ambient(opts = {}) {
  const cfg = { ...PRESETS[opts.preset || 'crypt'], box: [-8, 8, 0.2, 3, -5, 5], sources: [], fires: [], ...opts };
  let alive = 0;   // dust motes alive (the only particles the layer keeps a count of)
  let running = true;
  const id = ownerSlot(() => { alive--; });
  const acc = { embers: 0, floor: 0, grit: 0 };

  function mote(prewarm) {
    const [x0, x1, y0, y1, z0, z1] = cfg.box;
    const life = rr(4, 9);
    const i = add(rr(x0, x1), rr(y0, y1), rr(z0, z1), rr(-1, 1) * cfg.drift, rr(-0.03, 0.06), rr(-0.5, 0.5) * cfg.drift,
      life, rnd() < 0.25 ? 2 : 1, cfg.dustRamps[Math.floor(rnd() * cfg.dustRamps.length)], SPRITE);
    if (i < 0) return;
    P.owner[i] = id; alive++;
    P.wob[i] = 0.35; P.ph[i] = rr(0, 6.28); P.pop[i] = 1;
    P.fadeIn[i] = 0.15; P.fadeAt[i] = 0.75; P.shrinkAt[i] = 1;
    if (prewarm) P.age[i] = rr(0.15, 0.7) * life;
  }
  function ember(x, y, z) {
    const i = add(x + rr(-0.12, 0.12), y, z + rr(-0.1, 0.1), rr(-0.25, 0.25), rr(0.5, 1.3), rr(-0.15, 0.15), rr(1, 2.4), rnd() < 0.2 ? 2 : 1, 'ember', SPRITE);
    if (i < 0) return;
    P.wob[i] = 2.4; P.ph[i] = rr(0, 6.28); P.pop[i] = 1; P.fadeAt[i] = 0.65; P.shrinkAt[i] = 0.7;
  }
  function grit() {
    const [x0, x1, , y1, z0, z1] = cfg.box;
    const i = add(rr(x0, x1), y1 + 0.5, rr(z0, z1), rr(-0.2, 0.2), rr(-2, -1), 0, rr(0.6, 1.1), 1, 'grit', STREAK);
    if (i < 0) return;
    P.grav[i] = 6; P.stretch[i] = 0.04; P.pop[i] = 1; P.fadeAt[i] = 0.8; P.floorY[i] = 0.02; P.bounce[i] = 0.2;
  }

  function flame(f, t) {
    // a voxel flame: cubes born on the coals that rise, lean and burn down the ramp in ~0.4 s
    const size = f[3] ?? 1;
    const w = 0.12 * size;
    const i = add(f[0] + rr(-w, w), f[1] + rr(0, 0.05), f[2] + rr(-w, w) * 0.6, rr(-0.15, 0.15), rr(1.1, 1.9) * (0.8 + size * 0.2), 0,
      rr(0.2, 0.36) * (0.8 + size * 0.2), rnd() < 0.5 ? 4 : 3, 'fire', CUBE);
    if (i < 0) return;
    P.wob[i] = 3; P.ph[i] = t * 0.37 + rr(0, 1); P.pop[i] = 1.2; P.shrinkAt[i] = 0.15; P.fadeAt[i] = 0.8;
    if (rnd() < 0.1) ember(f[0], f[1] + 0.3, f[2]);
  }
  let t = 0;

  for (let k = 0; k < cfg.dust; k++) mote(true);

  const off = onTick((dt) => {
    if (!running) return;
    t++;
    for (const f of cfg.fires) { const n = Math.round((f[3] ?? 1) * 1.6); for (let k = 0; k < n; k++) flame(f, t); }
    while (alive < cfg.dust && P.n < P.x.length - 64) { mote(false); if (rnd() < 0.5) break; }
    const nS = cfg.sources.length;
    if (nS && cfg.embers > 0) {
      acc.embers += cfg.embers * nS * dt;
      while (acc.embers >= 1) { acc.embers--; const s = cfg.sources[Math.floor(rnd() * nS)]; ember(s[0], s[1], s[2]); }
    }
    if (cfg.floorEmbers > 0) {
      acc.floor += cfg.floorEmbers * dt;
      const [x0, x1, , , z0, z1] = cfg.box;
      while (acc.floor >= 1) { acc.floor--; ember(rr(x0, x1), 0.05, rr(z0, z1)); }
    }
    if (cfg.grit > 0) {
      acc.grit += cfg.grit * dt;
      while (acc.grit >= 1) { acc.grit--; grit(); }
    }
  });

  const handle = {
    get alive() { return alive; },
    get config() { return cfg; },
    /** Change any option live (dust count, rates, sources, box). */
    set(o) { Object.assign(cfg, o); if (o.preset) Object.assign(cfg, PRESETS[o.preset], o); return handle; },
    stop() {
      if (!running) return;
    t++;
    for (const f of cfg.fires) { const n = Math.round((f[3] ?? 1) * 1.6); for (let k = 0; k < n; k++) flame(f, t); }
      running = false;
      off(); offClear();
      freeOwner(id);   // its particles live out their lives, then the slot is free
    },
    get running() { return running; },
  };
  const offClear = events.on('vfx:clear', () => handle.stop());
  return handle;
}

export const AMBIENT_PRESETS = PRESETS;
