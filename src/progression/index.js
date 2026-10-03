// Progression (piece `boons`): one call wires boons, pickups, the shrine, the choice screen
// and the HUD into a scene that has a hero.
//
//   import { createProgression } from '../progression/index.js';
//   const prog = createProgression(root, { ctl, anim, rig, health, combat });
//   // tick (after combat.tick() and the room/enemies' tick):  prog.tick()
//   // frame (menus, every rendered frame):                     prog.frame()
//   // render:  prog.render(alpha)      ui:  prog.ui(g)        exit: prog.dispose()
//   prog.spawnShrine(x, z, { rise })   prog.openChoice(ids?)   prog.pickups.drop(kind, x, z, n)
//   prog.choosing    true while the choice screen holds the hero
//
// Options: hud (draw the shard counter and boon bar, default true), drops (enemies and props
// drop shards and hearts, default true), shrineOnClear (an arena clear raises a shrine,
// default false; run-flow decides), arena (for finding a clear spot for the shrine).
//
// The held boons and shards live in `progress` (boons.js) and survive scene changes within a
// run. They reset on entering title, gameover or victory.

import { events } from '../core/events.js';
import { input } from '../core/input.js';
import { display } from '../core/display.js';
import { feedback } from '../core/feedback.js';
import { debug } from '../core/debug.js';
import { world } from '../core/world.js';
import { Rng, rng } from '../core/rng.js';
import { getCollision } from '../core/collision.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { BOONS, BOON_IDS, RARITY, SYNERGIES, progress, giveBoon, takeBoon, resetProgress, rollChoice, synergiesOf, activeSynergies, syncWorld } from './boons.js';
import { createPickups } from './pickups.js';
import { createBoonRuntime } from './effects.js';
import { createShrine, createChoice, choiceTiming } from './shrine.js';
import { createProgressionHud } from './hud.js';

export { BOONS, BOON_IDS, RARITY, SYNERGIES, progress, giveBoon, resetProgress, rollChoice } from './boons.js';
export { createPickups } from './pickups.js';
export { createBoonRuntime, procHit } from './effects.js';
export { createShrine, createChoice } from './shrine.js';
export { boonSfx } from './sfx.js';

const NULL_SOURCE = { move: () => ({ x: 0, z: 0 }), consume: () => false, buffered: () => false };
const DROPS = {
  husk: { shards: 3, heart: 0.1 }, wisp: { shards: 3, heart: 0.1 }, mite: { shards: 1, heart: 0.03 }, brute: { shards: 9, heart: 0.5 },
};

let active = null;

export function createProgression(root, { ctl, anim, rig, health, combat, hud = true, drops = true, shrineOnClear = false, arena = null } = {}) {
  const offs = [];
  const on = (n, f) => offs.push(events.on(n, f));
  const dropRng = new Rng(`${rng.seed}/boons/drops`);
  const pickups = createPickups(root, { hero: () => health, collision: () => getCollision() });
  const runtime = createBoonRuntime(root, { ctl, anim, rig, health, combat, pickups });
  const hudObj = hud ? createProgressionHud({ runtime, pickups }) : null;
  let shrine = null;
  let savedSource = null;
  const timers = [];
  let tick = 0;
  const later = (n, fn) => timers.push({ at: tick + n, fn });

  function lockHero(onLock) {
    if (onLock) { if (ctl.source !== NULL_SOURCE) savedSource = ctl.source; ctl.source = NULL_SOURCE; }
    else if (ctl.source === NULL_SOURCE) ctl.source = savedSource ?? input;
  }
  const choice = createChoice({
    heroScreen: () => display.worldToScreen(ctl.x, 0.75, ctl.z),
    anchorScreen: () => (shrine ? display.worldToScreen(shrine.anchor.x, shrine.anchor.y, shrine.anchor.z) : null),
    lock: (onLock) => lockHero(onLock),
    onPick: (id) => {
      giveBoon(id);
      progress.picks++;
      const R = RARITY[BOONS[id].rarity];
      vfx.sparkle(ctl.x, 0.9, ctl.z, { palette: 'gold', color: R.glow });
      vfx.shockwave(ctl.x, ctl.z, { radius: 1.6, color: R.glow, hot: 'white', dust: false });
      vfx.flash(ctl.x, 0.7, ctl.z, { color: R.glow, size: 0.8, light: false });
      look.flash(ctl.x, 1, ctl.z, { color: R.glow, ms: 260, intensity: 3, radius: 5 });
      feedback.shake(2.5, 160);
      shrine?.spend();
      events.emit('boon:picked', { id });
    },
  });

  on('boon:gain', () => runtime.apply());
  runtime.apply();

  if (drops) {
    on('enemy:death', (e) => {
      const D = DROPS[e.kind];
      if (!D) return;
      const extra = progress.held.get('soul-hunger') ? BOONS['soul-hunger'].lv(progress.held.get('soul-hunger')).extra : 0;
      const n = D.shards + (e.kind === 'mite' ? Math.ceil(extra / 2) : extra);
      pickups.drop('shard', e.x, e.z, n, { y: 0.7, speed: e.kind === 'brute' ? 1.3 : 1 });
      if (dropRng.chance(D.heart)) pickups.drop('heart', e.x, e.z, 1, { y: 0.8 });
    });
    on('prop:break', (e) => {
      if (!['urn', 'crate', 'barrel'].includes(e.kind)) return;
      if (dropRng.chance(e.kind === 'urn' ? 0.55 : 0.7)) pickups.drop('shard', e.x, e.z, dropRng.int(1, e.kind === 'urn' ? 2 : 3), { y: 0.4, speed: 0.8 });
      if (dropRng.chance(0.06)) pickups.drop('heart', e.x, e.z, 1, { y: 0.5 });
    });
  }
  on('arena:clear', (e) => {
    later(70, () => pickups.vacuum());
    if (shrineOnClear) later(110, () => {
      const p = findSpot(e.arena ?? arena);
      api.spawnShrine(p.x, p.z);
    });
  });

  function findSpot(ar) {
    const cw = getCollision();
    for (let r = 0; r < 5; r += 0.5) for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = Math.round(Math.sin(a) * r * 2) / 2, z = Math.round((Math.cos(a) * r - 0.5) * 2) / 2;
      if (cw && cw.blocked(x, z, 1.0)) continue;
      if (Math.hypot(ctl.x - x, ctl.z - z) < 1.6) continue;
      return { x, z };
    }
    return { x: 0, z: -1 };
  }

  const api = {
    pickups, runtime, choice,
    get shrine() { return shrine; },
    get choosing() { return choice.active; },
    spawnShrine(x, z, { rise = true } = {}) {
      shrine?.dispose();
      shrine = createShrine(root, { x, z, collision: getCollision(), hero: () => ctl, rise });
      return shrine;
    },
    /** Open the choice now (from the shrine if there is one). ids default to a fresh roll. */
    openChoice(ids = null, { delay = 26 } = {}) {
      if (choice.active) return false;
      const offer = ids ?? rollChoice(3);
      if (!offer.length) return false;
      if (shrine && shrine.state === 'ready') shrine.use();
      lockHero(true);
      later(shrine ? delay : 0, () => choice.open(offer));
      return offer;
    },
    tick() {
      tick++;
      for (let i = timers.length - 1; i >= 0; i--) if (timers[i].at <= tick) timers.splice(i, 1)[0].fn();
      shrine?.tick();
      if (shrine?.near && ctl.source === input && input.pressed('interact') && !choice.active) api.openChoice();
      pickups.tick();
      runtime.tick();
    },
    frame() { choice.frame(); },
    render(alpha) { shrine?.render(alpha); pickups.render(alpha); runtime.render(alpha); },
    ui(g) {
      runtime.ui(g);
      pickups.ui(g);
      if (!choice.active) shrine?.ui(g);
      hudObj?.ui(g);
      choice.ui(g);
    },
    info() {
      return {
        held: Object.fromEntries(progress.held), order: [...progress.order], shards: progress.shards, picks: progress.picks,
        synergies: activeSynergies().map((s) => s.id), spent: [...progress.spent],
        runtime: runtime.info(), pickups: pickups.info(), shrine: shrine?.info() ?? null, choice: choice.info(),
      };
    },
    dispose() {
      offs.forEach((f) => f()); offs.length = 0;
      choice.close();
      lockHero(false);
      runtime.dispose(); pickups.dispose(); hudObj?.dispose(); shrine?.dispose();
      if (active === api) active = null;
    },
  };
  active = api;
  return api;
}

// ---- run lifecycle ------------------------------------------------------------------------------
events.on('scene:enter', (e) => {
  if (['title', 'gameover', 'victory'].includes(e.name)) resetProgress();
  else syncWorld();
});

// ---- debug hooks ----------------------------------------------------------------------------------
// Contract: debug.give(boonId) adds one stack ('all' gives every boon once; 'a,b' several).
debug.handle('give', (id) => {
  if (!id) return { ok: false, error: 'give(boonId)', boons: BOON_IDS };
  const ids = id === 'all' ? BOON_IDS : String(id).split(',').map((s) => s.trim()).filter(Boolean);
  const res = ids.map((b) => giveBoon(b));
  const bad = res.find((r) => !r.ok && r.error?.startsWith('no boon'));
  if (bad) return { ...bad, boons: BOON_IDS };
  return { ok: res.some((r) => r.ok), results: res, boons: [...world.boons] };
});

// __GR.debug.boons(action?, ...):
//   ()                       held boons, shards, synergies, runtime/pickup/shrine/choice state
//   ('list')                 every boon: id, name, rarity, max, synergies
//   ('choice', ids?)         open the choice screen now (a fresh roll, or these ids)
//   ('select', i) ('pick', i)   move the selection / take card i (0-2)
//   ('take', id)  ('reset')  ('shards', n)
//   ('drop', 'shard'|'heart', x, z, n)    ('vacuum')
//   ('shrine', x, z, rise?)  raise a shrine      ('roll', n)  roll without opening
//   ('star')                 call a falling star now (starfall's proc)
//   ('uiSpeed', s)           slow (s < 1) the choice screen's clock, for frame strips
debug.add('boons', (action, ...a) => {
  const P = active;
  if (!action) return P ? P.info() : { held: Object.fromEntries(progress.held), shards: progress.shards, note: 'no progression in this scene' };
  if (action === 'list') return BOON_IDS.map((id) => ({ id, name: BOONS[id].name, rarity: BOONS[id].rarity, max: BOONS[id].max, synergies: synergiesOf(id).map((s) => `${s.id}(${s.partner})`) }));
  if (action === 'uiSpeed') { choiceTiming.speed = Math.max(0.02, +a[0] || 1); return { ok: true, speed: choiceTiming.speed }; }
  if (action === 'reset') { resetProgress(); P?.runtime.apply(); return { ok: true }; }
  if (action === 'roll') return rollChoice(a[0] ?? 3, { salt: a[1] ?? 0 });
  if (action === 'take') { const ok = takeBoon(a[0]); P?.runtime.apply(); return { ok }; }
  if (action === 'shards') { progress.shards = a[0] | 0; return { ok: true, shards: progress.shards }; }
  if (!P) return { ok: false, error: 'no progression in this scene' };
  if (action === 'choice') return { ok: true, ids: P.openChoice(a[0] ?? null) };
  if (action === 'select') { P.choice.select(a[0] | 0); return P.choice.info(); }
  if (action === 'pick') { P.choice.select(a[0] | 0); P.choice.confirm(); return P.choice.info(); }
  if (action === 'drop') { P.pickups.drop(a[0] ?? 'shard', a[1] ?? 0, a[2] ?? 0, a[3] ?? 5); return P.pickups.info(); }
  if (action === 'vacuum') { P.pickups.vacuum(); return P.pickups.info(); }
  if (action === 'shrine') { P.spawnShrine(a[0] ?? 0, a[1] ?? 0, { rise: a[2] ?? true }); return P.shrine.info(); }
  if (action === 'star') return { ok: P.runtime.callStar() };
  return { ok: false, error: `unknown action "${action}"` };
});
