// Boons and pickups (piece `boons`): the one module a scene imports.
//
//   import { createProgression } from '../progression/index.js';
//   const prog = createProgression(root, { ctl, health, rig, rng, bounds });
//   // scene hooks:
//   frame(dt) { prog.frame(dt); }            // shrine input (runs while paused)
//   tick()    { if (prog.blocking) return;   // the shrine freezes the sim behind it
//               ...combat.tick(); ...; prog.tick(); }        // after combat.tick()
//   render(a) { prog.render(a); }
//   ui(g)     { ...; prog.ui(g); }           // last: the shrine draws over everything
//   exit()    { prog.dispose(); }
//
//   prog.boons     boon system   .give(id) .has(id) .level(id) .list() .synergies()
//   prog.pickups   soul shards and hearts  .drop({x,z,shards,hearts}) .total .spend(n) .vacuumAll()
//   prog.shrine    the pick-1-of-3 screen  .open() .active
//   prog.offerShrine({ onClose })            open the shrine; the pick is applied to the hero
//   prog.hud(g, x, y)                        held-boon strip + shard counter (for the `hud` piece)
//
// Wiring done for you: enemy deaths drop shards (and sometimes hearts), 'arena:clear' pulls every
// pickup to the hero and refills Phoenix Spark / Aegis. debug.give(id) and __GR.debug.boons(...)
// point at the newest progression.

import { debug } from '../core/debug.js';
import { events } from '../core/events.js';
import { world } from '../core/world.js';
import { createBoonSystem, drawBoonStrip } from './effects.js';
import { createPickups, drawShardCounter } from './pickups.js';
import { createShrine } from './shrine.js';
import { BOONS, IDS, RARITY, SYNERGIES, rollOffers, activeSynergies, synergiesFor } from './boons.js';
import './sfx.js';

export { BOONS, IDS, RARITY, SYNERGIES, rollOffers, activeSynergies, synergiesFor, drawBoonStrip, drawShardCounter };
export { boonSfx } from './sfx.js';
export { drawIcon, drawGlyph } from './icons.js';

let current = null;

export function createProgression(root, { ctl, health, rig = null, rng, bounds = null, targets = null, autoDrops = true } = {}) {
  const pickups = createPickups(root, { hero: () => world.hero ?? health, rng: rng.fork('pickups'), bounds });
  const boons = createBoonSystem({ root, ctl, health, rig, rng: rng.fork('boons'), pickups, targets });
  let closeCb = null;
  const shrine = createShrine({
    rng: rng.fork('shrine'), held: () => boons.held, pickups,
    onPick: (o) => { boons.give(o.id); },
    onClose: () => { const f = closeCb; closeCb = null; f?.(); },
  });
  const offs = [];
  if (autoDrops) {
    offs.push(events.on('enemy:die', (e) => { pickups.dropForEnemy(e.kind, e.x, e.z); }));
  }
  let clearT = -1;
  offs.push(events.on('arena:clear', () => { clearT = 40; }));

  const prog = {
    boons, pickups, shrine,
    /** true while the shrine is up: the scene should not run its sim tick. */
    get blocking() { return shrine.active; },
    offerShrine({ onClose = null, offers = null, luck = 0 } = {}) {
      closeCb = onClose;
      shrine.open({ offers, luck });
      events.emit('shrine:open', {});
    },
    frame(dt) { shrine.frame(dt); },
    tick() {
      boons.tick();
      pickups.tick();
      if (clearT >= 0 && --clearT < 0) pickups.vacuumAll();
    },
    render(a) { boons.render(a); pickups.render(a); },
    ui(g) { boons.ui(g); shrine.ui(g); },
    /** Held boons and the shard count, for a HUD. Returns the strip size. */
    hud(g, x, y, opts = {}) {
      const s = drawBoonStrip(g, boons, x, y, opts);
      drawShardCounter(g, x, y + s.h + 4, pickups);
      return s;
    },
    dispose() {
      for (const f of offs) f();
      shrine.close();
      boons.dispose();
      pickups.dispose();
      if (current === prog) { current = null; debug.handle('give', () => ({ ok: false, error: 'no boons in this scene' })); }
    },
  };
  current = prog;
  return prog;
}

// ---- debug hooks ------------------------------------------------------------------------------
// debug.give('chain-spark')                    acquire (or level up) a boon on the hero
// __GR.debug.boons()                           held boons with levels, shards, synergies
// __GR.debug.boons('shrine')                   open the choice screen now
// __GR.debug.boons('pick', i)                  take card i (0..2)
// __GR.debug.boons('reroll')                   spend shards on new cards
// __GR.debug.boons('drop', shards, hearts)     drop pickups at the hero's feet
// __GR.debug.boons('shards', n)                add n shards
// __GR.debug.boons('reset')                    drop every boon
// __GR.debug.boons('ids')                      all boon ids
debug.handle('give', (id) => {
  if (!current) return { ok: false, error: 'no boons in this scene' };
  if (!BOONS[id]) return { ok: false, error: `unknown boon "${id}"; try ${IDS.join(', ')}` };
  const level = current.boons.give(id);
  return { ok: true, id, level, boons: [...world.boons] };
});
debug.add('boons', (action, a, b) => {
  const p = current;
  if (action === 'ids') return { ok: true, ids: IDS };
  if (!p) return { ok: false, error: 'no boons in this scene' };
  const info = () => ({ ok: true, held: p.boons.list().map((x) => ({ id: x.id, level: x.level })), synergies: p.boons.synergies().map((s) => s.name),
    shards: p.pickups.total, shrine: p.shrine.active ? p.shrine.cards.map((c) => c.id) : null, shrinePhase: p.shrine.phase });
  switch (action) {
    case undefined: return info();
    case 'shrine': p.offerShrine({}); return info();
    case 'pick': return { ok: p.shrine.pick(a ?? p.shrine.selected), ...info() };
    case 'reroll': return { ok: p.shrine.reroll(), ...info() };
    case 'drop': { const h = world.hero; p.pickups.drop({ x: h.x + 0.4, z: h.z + 1.2, shards: a ?? 5, hearts: b ?? 0 }); return info(); }
    case 'shards': p.pickups.add(a ?? 10); return info();
    case 'reset': p.boons.reset(); return info();
    default: return { ok: false, error: `unknown action "${action}"` };
  }
});
