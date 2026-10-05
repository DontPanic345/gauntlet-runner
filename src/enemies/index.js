// Enemies (piece `enemies`): the public API. Other pieces import from here.
//
//   import { createEnemies, ENEMY_DATA, DIFFICULTY } from '../enemies/index.js';
//   const foes = createEnemies(root, { collision: cw, bounds });   // one per scene
//   foes.spawn('husk' | 'wisp' | 'brute' | 'mite' | 'mites', x, z, { instant? })
//   tick: foes.tick()  (after the hero's combat.tick())    render: foes.render(alpha)    exit: foes.dispose()
//   foes.alive -> number still fighting (0 = room clear)
//
// Four archetypes (see each file's header): husk.js, wisp.js, brute.js, mite.js.
// Tuning is data: data.js (ENEMY_DATA per archetype, DIFFICULTY global multipliers).
//
// Events (core/events.js):
//   'enemy:spawn'       { enemy, kind, x, z }         created (its spawn-in is starting)
//   'combat:enemyWindup'{ enemy, x, z }               an attack's telegraph starts (same event as combat's dummy)
//   'enemy:commit'      { enemy }                     a husk/mite windup is about to land (for audio stings)
//   'enemy:fire'        { enemy, x, z, yaw }          a wisp fires
//   'enemy:charge'      { enemy, x, z, yaw, length }  a brute starts its run
//   'enemy:crash'       { enemy, x, z }               a brute hit a wall (dazed)
//   'enemy:slam'        { enemy, x, z }               a brute's fists hit the floor
//   'enemy:land'        { enemy, x, z }               a brute landed from its spawn drop
//   'enemy:attackHit'   { enemy, ok, reason }         an attack reached the hero (ok false: dodged / i-frames)
//   'enemy:orbPop'      { x, z, why: 'hit'|'wall'|'fizzle' }
//   'enemy:hurt'        { enemy, x, z, dmg, hp }
//   'enemy:death'       { enemy, x, z, kind }         hp reached 0 (the death animation starts; combat:kill also fires)
//
// Debug: __GR.debug.enemies(action?, ...)  see below.  __GR.debug.spawn(type, x, z) spawns
// these types in any scene that made a manager (the run/boss placeholder, ?showcase=enemies).

import { debug } from '../core/debug.js';
import { EnemyManager, createEnemies, activeEnemies, SPAWN_TYPES, CLASSES } from './manager.js';
import { ENEMY_DATA, DIFFICULTY, TOKENS, TYPES } from './data.js';
import { enemySfx } from './sfx.js';
import { enemyLook } from './material.js';

export { EnemyManager, createEnemies, activeEnemies, SPAWN_TYPES, CLASSES, ENEMY_DATA, DIFFICULTY, TOKENS, TYPES, enemySfx };

/**
 * A debug.spawn handler for a scene: our types go to the manager, anything else to `fallback`
 * (e.g. combat's dummies), so neither registration clobbers the other.
 */
export function spawnHandler(mgr, fallback = null) {
  return (type, x = 0, z = 0) => {
    const r = mgr.spawnCommand(type, x, z);
    if (r) return r;
    if (fallback) return fallback(type, x, z);
    return { ok: false, error: `no enemy type "${type}" (try ${SPAWN_TYPES.join(', ')})` };
  };
}

// __GR.debug.enemies(action?, ...):
//   ()                              the live manager's info: every enemy's state, tokens, kills
//   ('data')                        ENEMY_DATA, DIFFICULTY and TOKENS
//   ('tune', type, {key: value})    live-edit one archetype, e.g. ('tune', 'husk', {speed: 2})
//                                   nested: ('tune', 'brute', {charge: {speed: 14}})
//   ('difficulty', {hp, speed, aggression, damage})   the global knobs (hp applies to new spawns)
//   ('freeze', on)                  AI and movement stop (animation poses hold)
//   ('killall')                     every live enemy dies (with its death animation)
//   ('clear')                       remove every enemy at once, no deaths
//   ('lit', v)                      the self-light floor under every enemy's lighting (0..1.2, 0 = off)
debug.add('enemies', (action, a, b) => {
  const m = activeEnemies();
  if (action === 'data') return { data: ENEMY_DATA, difficulty: DIFFICULTY, tokens: TOKENS };
  if (action === 'tune') {
    const row = ENEMY_DATA[a];
    if (!row || !b || typeof b !== 'object') return { ok: false, error: `tune: ('tune', ${TYPES.join('|')}, {key: value})` };
    for (const k in b) { if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && row[k]) Object.assign(row[k], b[k]); else row[k] = b[k]; }
    return { ok: true, [a]: row };
  }
  if (action === 'lit') { if (typeof a === 'number') enemyLook.selfLit.value = a; return { ok: true, selfLit: enemyLook.selfLit.value }; }
  if (action === 'difficulty') { if (a && typeof a === 'object') Object.assign(DIFFICULTY, a); return { ok: true, difficulty: DIFFICULTY }; }
  if (!m) return { ok: false, error: 'no enemy manager in this scene' };
  if (action === 'freeze') { m.frozen = a ?? !m.frozen; return { ok: true, frozen: m.frozen }; }
  if (action === 'killall') {
    for (const e of m.list) if (!e.dying && !e.dead) { e.hp = 0; e.dead = true; e.die({ dx: 0, dz: 1 }); }
    return { ok: true };
  }
  if (action === 'clear') { m.clear(); return { ok: true }; }
  return { ok: true, ...m.info() };
});
