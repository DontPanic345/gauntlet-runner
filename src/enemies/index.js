// The enemy system (piece `enemies`): spawning, the attack-slot rule that makes a crowd take
// turns, separation so nothing stacks into one blob, the wisp's orbs, and debug hooks.
//
//   import { createEnemySystem } from '../enemies/index.js';
//   const sys = createEnemySystem(root, { hero: world.hero, collision, bounds, list: world.enemies });
//   sys.spawn('husk', x, z);   sys.spawnGroup('mite', x, z, 5);
//   tick: sys.tick();   render: sys.render(alpha);   ui: sys.ui(g);   exit: sys.dispose();
//
// It pushes every enemy it makes into `list` (pass world.enemies) and removes them again when
// their death animation has finished. A dying enemy has `dead = true` (combat ignores it) but
// stays in the list until `gone`; use `sys.alive()` to count the living.

import * as THREE from 'three';
import { voxelMesh, makeVoxelMaterial } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { display } from '../core/display.js';
import { DT } from '../core/loop.js';
import { css } from '../render/palette.js';
import { vfx } from '../vfx/index.js';
import { ENEMIES, ATTACK_SLOTS, knobs, setKnobs } from './data.js';
import { CLASSES, Enemy } from './enemy.js';
import { buildEnemyModels } from './models.js';
import './sfx.js';

export { ENEMIES, ATTACK_SLOTS, knobs, setKnobs, Enemy };
export const TYPES = Object.keys(ENEMIES);
const HERO_R = 0.3;
const ALIASES = { mites: 'mite', swarm: 'mite', ember: 'wisp', 'ember-wisp': 'wisp', embers: 'wisp' };

let current = null;   // the newest system, for the debug hook

class Orb {
  constructor(sys, x, y, z, dx, dz, speed, life, dmg, owner) {
    this.sys = sys; this.x = this.px = x; this.y = y; this.z = this.pz = z;
    this.vx = dx * speed; this.vz = dz * speed; this.life = life; this.dmg = dmg; this.r = 0.16;
    this.spent = false; this.dead = false; this.t = 0;
    this.mesh = voxelMesh('enemy.orb');
    this.mesh.material = sys.orbMat;
    sys.root.add(this.mesh);
    this.mesh.scale.setScalar(0.2);
  }
  tick() {
    this.px = this.x; this.pz = this.z;
    this.t++;
    this.x += this.vx * DT; this.z += this.vz * DT;
    if (this.t % 4 === 0) vfx.embers({ x: this.x, y: this.y, z: this.z, n: 1 });
    if (this.t % 9 === 0) vfx.flash({ x: this.x, y: this.y, z: this.z, color: 'ember', radius: 0.7, ms: 110, intensity: 1.0 });
    const s = this.sys, h = s.hero;
    if (h && !h.dead && !this.spent && Math.hypot(h.x - this.x, h.z - this.z) < this.r + HERO_R) {
      const res = h.hurt(this.dmg, { x: this.x - this.vx * 0.2, z: this.z - this.vz * 0.2 });
      if (res.ok) return this.burst(true);
      if (res.reason === 'dodged') this.spent = true;   // it passes harmlessly through a dash
    }
    const B = s.bounds;
    if ((s.collision && s.collision.blocked(this.x, this.z, this.r * 0.7)) || (B && (this.x < B.minX || this.x > B.maxX || this.z < B.minZ || this.z > B.maxZ))) return this.burst(false);
    if (--this.life <= 0) this.burst(false, true);
  }
  burst(onHero, fizzle = false) {
    if (this.dead) return;
    this.dead = true;
    const l = Math.hypot(this.vx, this.vz) || 1;
    vfx.hit({ x: this.x, y: this.y, z: this.z, dx: -this.vx / l, dz: -this.vz / l, power: fizzle ? 0.4 : onHero ? 1 : 0.7, style: onHero ? 'hurt' : 'ember' });
    vfx.embers({ x: this.x, y: this.y, z: this.z, n: fizzle ? 6 : 10 });
    events.emit('enemy:orbBurst', { x: this.x, z: this.z, onHero, fizzle });
  }
  render(alpha) {
    const x = this.px + (this.x - this.px) * alpha, z = this.pz + (this.z - this.pz) * alpha;
    const v = new THREE.Vector3(x, this.y + Math.sin(this.t * 0.25) * 0.02, z);
    look.snap(v);
    this.mesh.position.copy(v);
    const k = Math.min(1, this.t / 8), f = 1 + Math.sin(this.t * 0.6) * 0.1;
    const fade = this.life < 30 ? this.life / 30 : 1;
    this.mesh.scale.setScalar((0.2 + 0.8 * k) * f * fade);
    this.mesh.rotation.y = this.t * 0.1;
  }
  dispose() { this.sys.root.remove(this.mesh); }
}

export function createEnemySystem(root, { hero = null, collision = null, bounds = null, list = [], ai = true, bars = true } = {}) {
  buildEnemyModels();
  const sys = {
    root, hero, collision, bounds, ai, bars,
    list,                    // the shared list (usually world.enemies)
    mine: [],                // enemies this system owns
    orbs: [],
    slots: Object.fromEntries(Object.keys(ATTACK_SLOTS).map((k) => [k, new Set()])),
    orbMat: makeVoxelMaterial(),
    n: 0,
    knobs,

    allowed(cat) { return (ATTACK_SLOTS[cat] ?? 1) + (knobs.aggression >= 1.5 ? 1 : 0); },
    slotsFull(cat) { return sys.slots[cat].size >= sys.allowed(cat); },
    claim(e, cat) {
      if (e.slot === cat) return true;
      const s = sys.slots[cat];
      if (!s || s.size >= sys.allowed(cat)) return false;
      s.add(e); e.slot = cat; return true;
    },
    release(e) { if (e.slot) { sys.slots[e.slot]?.delete(e); e.slot = null; } },

    /** Spawn one enemy (with its portal and rise). opts: {id, yaw, delay, hpMul, flank}. */
    spawn(type, x = 0, z = 0, opts = {}) {
      type = ALIASES[type] ?? type;
      const C = CLASSES[type];
      if (!C) return null;
      const e = new C(sys, x, z, { id: `${type}${sys.n++}`, ...opts });
      sys.mine.push(e); sys.list.push(e);
      return e;
    },
    /** A group scattered round (x, z): the mite swarm is five. */
    spawnGroup(type = 'mite', x = 0, z = 0, n = 5, opts = {}) {
      type = ALIASES[type] ?? type;
      const out = [];
      const a0 = Math.random() * Math.PI * 2, rad = opts.radius ?? (type === 'mite' ? 0.55 : 1.1);
      for (let i = 0; i < n; i++) {
        const a = a0 + (i / n) * Math.PI * 2, rr = rad * (i === 0 && n > 3 ? 0.2 : 1);
        const e = sys.spawn(type, x + Math.sin(a) * rr, z + Math.cos(a) * rr, { delay: opts.delay ?? i * 3, ...opts });
        if (e) out.push(e);
      }
      return out;
    },
    spawnOrb(x, y, z, dx, dz, speed, life, dmg, owner) { const o = new Orb(sys, x, y, z, dx, dz, speed, life, dmg, owner); sys.orbs.push(o); return o; },

    alive() { return sys.mine.filter((e) => !e.dead); },
    kill(id) {
      let n = 0;
      for (const e of sys.mine) if ((id === 'all' || id === undefined || e.id === id || e.type === id) && e.kill()) n++;
      return n;
    },
    clear() {
      for (const e of sys.mine) { e.dispose(); const i = sys.list.indexOf(e); if (i >= 0) sys.list.splice(i, 1); }
      sys.mine.length = 0;
      for (const o of sys.orbs) o.dispose();
      sys.orbs.length = 0;
      for (const s of Object.values(sys.slots)) s.clear();
    },

    tick() {
      for (const e of [...sys.mine]) e.tick();
      for (const o of sys.orbs) o.tick();
      sys.orbs = sys.orbs.filter((o) => { if (o.dead) o.dispose(); return !o.dead; });
      separate();
      sys.mine = sys.mine.filter((e) => {
        if (!e.gone) return true;
        e.dispose();
        const i = sys.list.indexOf(e); if (i >= 0) sys.list.splice(i, 1);
        return false;
      });
    },
    render(alpha) { for (const e of sys.mine) e.render(alpha); for (const o of sys.orbs) o.render(alpha); },
    ui(g) {
      if (!sys.bars) return;
      for (const e of sys.mine) {
        if (!e.solid || e.dead) continue;
        const stunned = e.state === 'stunned';
        if (e.hitPop > 150 && !stunned) continue;
        const p = display.worldToScreen(e.x, e.h + e.y + 0.28 + (e.kind === 'wisp' ? 0.35 : 0), e.z);
        const w = e.kind === 'brute' ? 26 : e.kind === 'mite' ? 10 : 16, k = Math.max(0, e.hp / e.maxHp);
        const pop = e.hitPop < 6 ? 1 : 0;
        const x = p.x - (w >> 1), y = p.y - pop;
        g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, w + 2, 5);
        g.fillStyle = css('shadow'); g.fillRect(x, y, w, 3);
        g.fillStyle = css(e.hitPop < 4 ? 'white' : 'red'); g.fillRect(x, y, Math.max(1, Math.round(w * k)), 3);
        if (stunned) { g.fillStyle = css('gold'); g.fillRect(x, y + 4, Math.max(1, Math.round(w * (1 - e.st / e.d.stun))), 1); }
      }
    },
    dispose() { sys.clear(); sys.orbMat.dispose?.(); if (current === sys) current = null; },
    /** debug.spawn('husk'|'wisp'|'brute'|'mite'|'mites', x, z) for scenes that own an enemy system. */
    handleSpawn(type, x = 0, z = 0) {
      const t = ALIASES[type] ?? type;
      if (!CLASSES[t]) return null;
      if (type === 'mites' || type === 'swarm') return { ok: true, ids: sys.spawnGroup('mite', x, z, 5).map((e) => e.id) };
      return { ok: true, id: sys.spawn(t, x, z).id };
    },
    info() { return sys.mine.map((e) => e.info()); },
  };

  // separation: nothing stands inside anything else. Lighter bodies give way to heavier ones;
  // a charging brute is not pushed at all.
  function separate() {
    const L = sys.mine.filter((e) => e.solid);
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        const dx = b.x - a.x, dz = b.z - a.z;
        const min = (a.r + b.r) * 1.12 + 0.06;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 1e-4;
        const nx = d < 1e-3 ? Math.cos(i * 2.4) : dx / d, nz = d < 1e-3 ? Math.sin(i * 2.4) : dz / d;
        const push = Math.min(0.06, (min - d) * 0.5);
        const fa = a.state === 'charge' ? 0 : 1 / a.weight, fb = b.state === 'charge' ? 0 : 1 / b.weight;
        const tot = fa + fb || 1;
        if (fa) a.moveBy(-nx * push * 2 * fa / tot, -nz * push * 2 * fa / tot);
        if (fb) b.moveBy(nx * push * 2 * fb / tot, nz * push * 2 * fb / tot);
      }
      const h = sys.hero;
      if (h && !h.dead && a.state !== 'charge' && a.state !== 'leap') {
        const dx = a.x - h.x, dz = a.z - h.z, min = a.r + HERO_R + 0.04, d = Math.hypot(dx, dz);
        if (d < min && d > 1e-4) a.moveBy((dx / d) * (min - d) * 0.35, (dz / d) * (min - d) * 0.35);
      }
    }
  }

  current = sys;
  return sys;
}

// ---- debug hooks ---------------------------------------------------------------------------------
// __GR.debug.enemies()                      -> list and knobs
// __GR.debug.enemies('knobs', {hp, speed, aggression})
// __GR.debug.enemies('kill', 'all' | id | type)
// __GR.debug.enemies('attack', id | type)   force a telegraphed attack now
// __GR.debug.enemies('ai', false)           turn chasing off / on
// __GR.debug.enemies('group', 'mite', x, z, n)
// __GR.debug.enemies('clear')
debug.add('enemies', (action, a, b, c, d) => {
  const s = current;
  if (!s) return { ok: false, error: 'no enemy system in this scene' };
  switch (action) {
    case undefined: case 'list': return { ok: true, types: TYPES, knobs: { ...knobs }, slots: Object.fromEntries(Object.entries(s.slots).map(([k, v]) => [k, v.size])), ai: s.ai, enemies: s.info() };
    case 'knobs': return { ok: true, knobs: setKnobs(a) };
    case 'kill': return { ok: true, killed: s.kill(a) };
    case 'attack': { let n = 0; for (const e of s.mine) if (e.vulnerable && (a === undefined || a === 'all' || e.id === a || e.type === a) && e.state === 'move') { e.startAttack(); n++; } return { ok: true, started: n }; }
    case 'ai': s.ai = a !== false; return { ok: true, ai: s.ai };
    case 'group': { const g = s.spawnGroup(a ?? 'mite', b ?? 0, c ?? 0, d ?? 5); return { ok: true, ids: g.map((e) => e.id) }; }
    case 'clear': s.clear(); return { ok: true };
    default: return { ok: false, error: `unknown action "${action}"` };
  }
});
