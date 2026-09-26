// Boon runtime (piece `boons`): what each boon actually does in combat, and how it looks.
//
//   import { createBoonSystem, drawBoonStrip } from './progression/effects.js';
//   const boons = createBoonSystem({ root, ctl, health, rig, rng, pickups });
//   boons.give('chain-spark')      // level up / acquire, with the acquire flourish
//   boons.tick();  boons.render(alpha);  boons.ui(g);  boons.dispose();
//   boons.has(id)  boons.level(id)  boons.list()  boons.synergies()  boons.refresh()
//
// It is event driven: it listens to `combat:hit`, `combat:heroHurt`, `enemy:die`, `hero:slam`,
// `move:dash` and `arena:clear`, so any scene that runs HeroCombat (and the enemy system)
// gets working boons by creating one system and ticking it after `combat.tick()`.
// Extra damage goes through the target's own `takeHit` contract, so enemies flinch, flash and
// die the normal way. Damage-over-time bypasses `takeHit` (no permanent stagger).
//
// Events out: 'boon:acquire' {id, level, rarity}, 'boon:synergy' {name}, 'boon:hit' {target, dmg, src},
//             'boon:proc' {id, x, z}.

import * as THREE from 'three';
import { events } from '../core/events.js';
import { world } from '../core/world.js';
import { feedback } from '../core/feedback.js';
import { display } from '../core/display.js';
import { DT } from '../core/loop.js';
import { css } from '../render/palette.js';
import { look } from '../render/look.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { defineModel, voxelMesh, VoxelGrid } from '../render/voxel/index.js';
import { vfx } from '../vfx/index.js';
import { ramp, F_TWINKLE } from '../vfx/particles.js';
import { hooks, COMBO } from '../combat/combat.js';
import { BOONS, RARITY, SYNERGIES, activeSynergies } from './boons.js';
import { drawIcon } from './icons.js';
import { boonSfx } from './sfx.js';

const TAU = Math.PI * 2;

let modelsBuilt = false;
function buildModels() {
  if (modelsBuilt) return;
  modelsBuilt = true;
  const g = new VoxelGrid(3, 2, 13);
  for (let z = 1; z <= 9; z++) { g.set(1, 0, z, z < 3 ? 'white' : 'sky', true); g.set(1, 1, z, z < 3 ? 'white' : 'cyan', true); }
  g.set(1, 0, 0, 'white', true);
  for (let x = 0; x < 3; x++) g.set(x, 0, 10, 'cyan', true);
  g.set(1, 0, 11, 'blue'); g.set(1, 0, 12, 'blue');
  defineModel('boon.blade', { grid: g, origin: [1.5, 0, 6.5] });
}

// ---- small helpers -----------------------------------------------------------------------
const R = (list) => ramp(list);
const RAMPS = {
  fire: () => R('white,gold,flame,ember,red'),
  fireSoft: () => R('gold,flame,ember,red'),
  spark: () => R('white,sky,cyan,blue'),
  blood: () => R('white,rose,red,blood'),
  gold: () => R('white,torch,gold,flame'),
  wind: () => R('white,frost,fog,mist'),
  haste: () => R('white,rose,red,blood'),
  ice: () => R('white,sky,cyan,teal'),
};

/** Bresenham line of square dots on the UI canvas. */
function line(g, a, b, w = 1) {
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y), 1);
  const o = w >> 1;
  for (let i = 0; i <= n; i++) g.fillRect(Math.round(a.x + ((b.x - a.x) * i) / n) - o, Math.round(a.y + ((b.y - a.y) * i) / n) - o, w, w);
}

export function createBoonSystem({ root, ctl, health, rig = null, rng, pickups = null, targets = null }) {
  buildModels();
  const group = new THREE.Group();
  group.name = 'boons';
  root.add(group);

  const held = new Map();       // id -> level
  const later = [];             // { t, fn }
  const bolts = [];             // 2D lightning: { pts, t, life, col, core }
  const pops = [];              // floating words: { text, x, y, z, t, life, col, big }
  const fires = [];             // ember trail patches
  const burning = new Map();    // target -> { t, next, dmg }
  const waves = [];             // third-wave shockwaves
  const motes = [];             // life motes in flight
  const blades = [];            // orbit blades { mesh, ang, pang, k }
  const shield = { up: false, cd: 0, k: 0, meshes: [], ang: 0, pang: 0 };
  const phoenix = { charges: 0 };
  const st = {
    tick: 0, hitCount: 0, stormPips: 0, charge: 0, chargeT: 999, haste: 0, hasteK: 0, dashHit: new Set(), wasDash: false,
    bladeHit: new Map(), depth: 0, lastStrike: -99, meterT: 999,
  };
  const base = { speed: ctl.T.speed, cooldown: ctl.T.dashCooldown, iframes: ctl.T.dashIframes };
  const offs = [];
  const on = (n, f) => offs.push(events.on(n, f));

  const has = (id) => held.has(id);
  const lvl = (id) => held.get(id) ?? 0;
  const val = (id, k) => { const v = BOONS[id].val[k]; return typeof v === 'function' ? v(lvl(id)) : v; };
  const syn = (name) => { const s = SYNERGIES.find((q) => q.name === name); return !!s && has(s.a) && has(s.b); };
  const foes = () => (targets ? targets() : world.enemies).filter((e) => e && !e.dead && !e.noAssist && e.takeHit && e.vulnerable !== false && !e.gone);
  const hx = () => ctl.x, hz = () => ctl.z;
  const pool = () => vfx.pool;
  const after = (t, fn) => later.push({ t, fn });
  const pop = (text, x, y, z, col = 'white', life = 44, big = false) => pops.push({ text, x, y, z, t: 0, life, col, big });
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

  /** Deal boon damage through the target's takeHit (flinch, flash, knockback, death). */
  function zap(t, dmg, o = {}) {
    if (!t || t.dead) return false;
    const sx = o.x ?? hx(), sz = o.z ?? hz();
    let dx = t.x - sx, dz = t.z - sz;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const hit = { dmg: Math.max(1, Math.round(dmg)), dx, dz, tx: 0, tz: 0, power: Math.max(0.6, dmg / 12), step: -1, finisher: false,
      knock: o.knock ?? 1.6, lift: o.lift ?? 0, stopMs: 0, flashTicks: o.flash ?? 3, boon: o.src ?? true };
    if (t.takeHit(hit) === false) return false;
    events.emit('combat:damage', { x: t.x, y: (t.h ?? 1.2) + 0.1, z: t.z, amount: hit.dmg, crit: !!o.crit, side: 'enemy' });
    if (t.dead) events.emit('combat:kill', { target: t, x: t.x, z: t.z });
    events.emit('boon:hit', { target: t, dmg: hit.dmg, src: o.src });
    return true;
  }
  /** Damage over time: no flinch. Kills go through takeHit so death plays normally. */
  function dot(t, dmg, fromIgnite = false) {
    if (!t || t.dead || !Number.isFinite(t.hp)) return;
    if (t.hp > dmg + 0.5) {
      t.hp -= dmg;
      t.flashT = Math.max(t.flashT || 0, 2); t.flashLen = Math.max(t.flashLen || 1, 2);
      t.hitPop = 0;
      events.emit('combat:damage', { x: t.x, y: (t.h ?? 1.2) + 0.1, z: t.z, amount: dmg, crit: false, side: 'enemy' });
    } else zap(t, Math.max(1, t.hp), { knock: 0.4, flash: 2, src: fromIgnite ? 'burn' : 'dot' });
  }

  const bodyY = (t) => (t.hitY ?? 0.6);

  // ---- lightning (2D) --------------------------------------------------------------------
  function mkBolt(a, b, { life = 9, segs = 6, jag = 0.2, col = 'cyan', core = 'white', delay = 0 } = {}) {
    const pts = [];
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1, px = -dz / l, pz = dx / l;
    for (let i = 0; i <= segs; i++) {
      const u = i / segs, j = i === 0 || i === segs ? 0 : rng.signed() * jag;
      pts.push({ x: a.x + dx * u + px * j, y: a.y + dy * u + rng.signed() * jag * 0.4 * (i > 0 && i < segs ? 1 : 0), z: a.z + dz * u + pz * j });
    }
    bolts.push({ pts, t: -delay, life, col, core });
  }
  const at = (t) => ({ x: t.x, y: bodyY(t) + 0.25, z: t.z });
  function crackle(t, n = 2, col = 'cyan') {
    const c = at(t);
    for (let i = 0; i < n; i++) {
      const a = rng.next() * TAU, r = 0.45 + rng.next() * 0.3;
      mkBolt(c, { x: c.x + Math.sin(a) * r, y: c.y + rng.range(-0.15, 0.4), z: c.z + Math.cos(a) * r }, { life: 6, segs: 3, jag: 0.1, col });
    }
  }
  function sparkAt(t, style = 'magic', power = 0.8) {
    if (!vfx.attached) return;
    vfx.hit({ x: t.x, y: bodyY(t) + 0.2, z: t.z, dx: 0, dz: 0, power, style, spread: 3 });
  }

  // ---- burning ----------------------------------------------------------------------------
  function ignite(t, ticks = null, dmg = null) {
    if (!t || t.dead) return;
    const have = has('searing-brand');
    const d = dmg ?? (have ? val('searing-brand', 'dmg') : 2);
    const life = ticks ?? (have ? val('searing-brand', 'ticks') : 120);
    let b = burning.get(t);
    if (!b) { b = { t: life, next: 8, dmg: d, born: st.tick }; burning.set(t, b); igniteBurst(t); }
    else { b.t = Math.max(b.t, life); b.dmg = Math.max(b.dmg, d); }
  }
  function igniteBurst(t) {
    if (!pool()) return;
    for (let i = 0; i < 9; i++) {
      const a = rng.next() * TAU;
      pool().add(t.x + Math.sin(a) * t.r * 0.8, bodyY(t) * 0.6, t.z + Math.cos(a) * t.r * 0.8, Math.sin(a) * 0.6, 1.4 + rng.next() * 1.4, Math.cos(a) * 0.6, 0.42, 5, 1, RAMPS.fire(), 0, 0.93, 0);
    }
    boonSfx.fire();
  }
  function tickBurning() {
    for (const [t, b] of burning) {
      if (t.dead || t.gone) { burning.delete(t); continue; }
      b.t--;
      if (b.t <= 0) { burning.delete(t); continue; }
      if (pool() && (st.tick + b.born) % 2 === 0) {
        const a = rng.next() * TAU, r = t.r * rng.next() * 0.9;
        pool().add(t.x + Math.sin(a) * r, 0.1 + rng.next() * (t.h ?? 1.2) * 0.8, t.z + Math.cos(a) * r, 0, 1 + rng.next() * 1.2, 0, 0.4, 4, 1, RAMPS.fireSoft(), F_TWINKLE, 0.94, 0);
      }
      if (--b.next <= 0) { b.next = 20; dot(t, b.dmg, true); }
    }
  }

  // ---- boon: chain spark -------------------------------------------------------------------
  function chain(target) {
    const n = val('chain-spark', 'targets'), dmg = val('chain-spark', 'dmg'), range = val('chain-spark', 'range');
    const visited = new Set([target]);
    let cur = target;
    crackle(target, 2);
    if (syn('WILDFIRE')) ignite(target);
    for (let i = 0; i < n; i++) {
      let best = null, bd = range;
      for (const f of foes()) { if (visited.has(f)) continue; const d = dist(f, cur); if (d < bd) { bd = d; best = f; } }
      if (!best) break;
      visited.add(best);
      const from = cur, to = best;
      after(3 + i * 3, () => {
        if (to.dead) return;
        mkBolt(at(from), at(to), { life: 10, segs: 7, jag: 0.22 });
        zap(to, dmg, { x: from.x, z: from.z, knock: 2.2, flash: 3, src: 'chain' });
        sparkAt(to, 'magic', 0.9);
        crackle(to, 1);
        look.flash(to.x, 0.9, to.z, { color: 'sky', ms: 110, intensity: 1.6, radius: 2.6 });
        boonSfx.zap();
        if (syn('WILDFIRE')) ignite(to);
      });
      cur = best;
    }
    if (visited.size === 1) boonSfx.zap();
  }

  // ---- boon: storm call ----------------------------------------------------------------------
  function skyStrike(target, dmg, { small = false } = {}) {
    if (!target || target.dead) return;
    const tx = target.x, tz = target.z;
    // a crackle of light above the head, then the bolt
    if (pool()) for (let i = 0; i < 10; i++) pool().add(tx + rng.signed() * 0.3, 1.8 + rng.next() * 0.8, tz + rng.signed() * 0.3, 0, -0.4, 0, 0.16, 4, 1, RAMPS.spark(), F_TWINKLE, 0.9, 0);
    after(small ? 4 : 9, () => {
      const top = { x: tx + rng.signed() * 0.6, y: 7, z: tz + rng.signed() * 0.3 };
      const foot = { x: tx, y: 0.05, z: tz };
      mkBolt(top, foot, { life: 12, segs: 12, jag: 0.4, col: 'sky', core: 'white' });
      mkBolt(top, foot, { life: 9, segs: 10, jag: 0.5, col: 'cyan', core: 'white' });
      if (!small) { feedback.flash('white', 70, 0.28); feedback.shake(3, 200); }
      look.flash(tx, 1.2, tz, { color: 'white', ms: 170, intensity: 3.4, radius: 5 });
      if (vfx.attached) { vfx.shockwave({ x: tx, z: tz, radius: small ? 1.1 : 1.7, style: 'ring' }); vfx.hit({ x: tx, y: 0.6, z: tz, dx: 0, dz: 0, power: 1.6, style: 'magic' }); }
      boonSfx.thunder();
      for (const f of foes()) {
        const d = dist(f, { x: tx, z: tz });
        if (f === target) zap(f, dmg, { x: tx, z: tz - 0.1, knock: 3.5, lift: 1.4, flash: 5, src: 'storm', crit: true });
        else if (d < 1.3) zap(f, dmg * 0.5, { x: tx, z: tz, knock: 4, flash: 4, src: 'storm' });
      }
      crackle(target, 3, 'sky');
    });
  }

  // ---- boon: volatile soul -------------------------------------------------------------------
  function explode(x, z, depth, pyre) {
    const r = val('volatile-soul', 'r') * (pyre ? 1.4 : 1), dmg = val('volatile-soul', 'dmg') * (pyre ? 1.3 : 1);
    if (vfx.attached) {
      vfx.shockwave({ x, z, radius: r * 1.15, style: 'ember' });
      vfx.embers({ x, y: 0.5, z, n: 24 });
      vfx.flash({ x, y: 0.7, z, color: 'flame', radius: r * 1.5, ms: 220 });
      vfx.dust({ x, z, n: 8, size: 6, speed: 1.4 });
      if (pool()) for (let i = 0; i < 18; i++) {
        const a = rng.next() * TAU, sp = 2 + rng.next() * 3.4;
        pool().add(x, 0.3, z, Math.sin(a) * sp, 1.5 + rng.next() * 2.5, Math.cos(a) * sp, 0.45, 6, 1, RAMPS.fire(), 0, 0.92, 6);
      }
    }
    look.flash(x, 0.8, z, { color: 'ember', ms: 240, intensity: 3.2, radius: r * 2.6 });
    feedback.shake(3 + depth * 0.5, 220);
    boonSfx.boom(1 + Math.min(1, depth * 0.3));
    events.emit('boon:proc', { id: 'volatile-soul', x, z });
    st.depth = depth + 1;
    for (const f of foes()) {
      const d = dist(f, { x, z }) - (f.r ?? 0.3);
      if (d > r) continue;
      zap(f, dmg * (1 - Math.max(0, d / r) * 0.35), { x, z, knock: 6, lift: 1.6, flash: 4, src: 'volatile' });
      if (pyre) ignite(f);
    }
    st.depth = 0;
  }

  // ---- boon: life motes --------------------------------------------------------------------
  function shedMotes(x, z, n) {
    for (let i = 0; i < n; i++) {
      const a = rng.next() * TAU, sp = 1.2 + rng.next() * 2;
      motes.push({ x, y: 0.5, z, vx: Math.sin(a) * sp, vy: 2 + rng.next() * 2.2, vz: Math.cos(a) * sp, age: -i * 2, seek: 0 });
    }
  }
  function tickMotes() {
    const need = val('life-motes', 'need');
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i];
      m.age++;
      if (m.age < 0) continue;
      if (m.age < 12) {
        m.vy -= 10 * DT; m.x += m.vx * DT; m.y += m.vy * DT; m.z += m.vz * DT; m.vx *= 0.94; m.vz *= 0.94;
        if (m.y < 0.15) { m.y = 0.15; m.vy = Math.abs(m.vy) * 0.3; }
      } else {
        const dx = hx() - m.x, dz = hz() - m.z, dy = 0.75 - m.y, d = Math.hypot(dx, dy, dz) || 1e-3;
        m.seek++;
        const sp = Math.min(14, 3 + m.seek * 0.6);
        const s = sp * DT;
        if (d < s + 0.2 || m.seek > 160) {
          motes.splice(i, 1);
          st.charge++; st.chargeT = 0;
          boonSfx.mote(st.charge);
          if (pool()) for (let k = 0; k < 3; k++) pool().add(hx(), 0.8, hz(), rng.signed() * 1.2, 0.8 + rng.next(), rng.signed() * 1.2, 0.3, 3, 0, RAMPS.blood(), 0, 0.9, 5);
          if (st.charge >= need) {
            st.charge -= need;
            if (health.hp < health.maxHp) {
              health.heal(1);
              if (vfx.attached) { vfx.pickup({ x: hx(), y: 0.9, z: hz(), style: 'hurt' }); vfx.shockwave({ x: hx(), z: hz(), radius: 1.1, style: 'ring' }); }
              look.flash(hx(), 1, hz(), { color: 'rose', ms: 240, intensity: 2.4, radius: 3 });
              pop('+1 HEART', hx(), 1.9, hz(), 'rose', 50, true);
              boonSfx.heart();
            } else st.charge = Math.min(st.charge + need, need);   // full: keep it banked
          }
          continue;
        }
        const sw = Math.max(0, 1 - m.seek / 14) * 0.5;
        m.x += (dx / d - (dz / d) * sw * (i % 2 ? 1 : -1)) * s; m.z += (dz / d + (dx / d) * sw * (i % 2 ? 1 : -1)) * s; m.y += (dy / d) * s;
      }
      if (pool()) {
        pool().add(m.x, m.y, m.z, 0, 0.15, 0, 0.16, 4, 1, RAMPS.blood(), 0, 0.9, 0);
        pool().add(m.x, m.y, m.z, 0, 0, 0, 0.05, 5, 3, R('white,white'), 0, 1, 0);
      }
    }
  }

  // ---- boon: ember trail ------------------------------------------------------------------
  function addFire(x, z) {
    const life = val('ember-trail', 'life') * (syn('FIRE WRAITH') ? 1.4 : 1);
    fires.push({ x, z, age: 0, life, r: val('ember-trail', 'r') });
    if (fires.length > 60) fires.shift();
  }
  function tickFires() {
    for (let i = fires.length - 1; i >= 0; i--) {
      const f = fires[i];
      f.age++;
      const u = f.age / f.life;
      if (u >= 1) { fires.splice(i, 1); continue; }
      const k = u < 0.75 ? 1 : (1 - u) / 0.25;
      if (pool()) {
        const cnt = rng.chance(k) ? 2 : 0;
        for (let n = 0; n < cnt; n++) {
          const a = rng.next() * TAU, rr = Math.sqrt(rng.next()) * f.r * 0.9;
          pool().add(f.x + Math.sin(a) * rr, 0.04, f.z + Math.cos(a) * rr, rng.signed() * 0.15, 0.9 + rng.next() * 1.5 * k, rng.signed() * 0.15, 0.32 + rng.next() * 0.25, 5 * (0.5 + k * 0.5), 1, RAMPS.fireSoft(), F_TWINKLE, 0.94, 0);
        }
        if (f.age % 14 === 0) pool().add(f.x + rng.signed() * f.r * 0.5, 0.02, f.z + rng.signed() * f.r * 0.5, 0, 0, 0, Math.min(1.5, (f.life - f.age) / 60), 7, 5, R('ink,night'), 4, 1, 0);
      }
      if (f.age % 10 === 0) {
        const dmg = val('ember-trail', 'dmg');
        for (const e of foes()) if (dist(e, f) < f.r + (e.r ?? 0.3)) { dot(e, dmg); if (syn('FIRE WRAITH')) ignite(e); }
      }
    }
  }

  // ---- boon: third wave ---------------------------------------------------------------------
  function launchWave(x, z, yaw) {
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    waves.push({ x: x + dx * 0.5, z: z + dz * 0.5, dx, dz, d: 0, max: val('third-wave', 'reach'), hit: new Set(), dmg: val('third-wave', 'dmg') });
    feedback.shake(2, 180);
    boonSfx.wave();
    if (vfx.attached) vfx.shockwave({ x: x + dx * 0.6, z: z + dz * 0.6, radius: 1.3, style: 'dust' });
  }
  function tickWaves() {
    for (let i = waves.length - 1; i >= 0; i--) {
      const w = waves[i];
      w.d += 0.19;
      const fx = w.x + w.dx * w.d, fz = w.z + w.dz * w.d;
      const px = -w.dz, pz = w.dx;
      const fade = w.d > w.max - 1 ? Math.max(0.15, (w.max - w.d) / 1) : 1;
      if (pool()) {
        for (let k = -7; k <= 7; k++) {
          if (Math.abs(k) > 7 * fade + 1) continue;
          const lat = k * 0.15, back = k * k * 0.014;
          const x = fx + px * lat - w.dx * back, z = fz + pz * lat - w.dz * back;
          const h = 0.1 + (1 - Math.abs(k) / 8) * 0.28;
          pool().add(x, h, z, w.dx * 1.2, 0.3, w.dz * 1.2, 0.3, Math.abs(k) < 3 ? 6 : 4, 1, RAMPS.fire(), 0, 0.9, 0);
          if (Math.abs(k) === 7 || (k % 3 === 0 && st.tick % 2 === 0)) pool().add(x, 0.06, z, px * k * 0.1, 0.5, pz * k * 0.1, 0.4, 5, 1, R('bone,fog,mist'), 0, 0.92, 0);
        }
      }
      if (w.d < 1.4 || st.tick % 5 === 0) look.flash(fx, 0.6, fz, { color: 'flame', ms: 110, intensity: 1.6, radius: 3 });
      for (const f of foes()) {
        if (w.hit.has(f)) continue;
        const along = (f.x - fx) * w.dx + (f.z - fz) * w.dz, lat = Math.abs((f.x - fx) * px + (f.z - fz) * pz);
        if (Math.abs(along) < 0.55 + (f.r ?? 0.3) && lat < 1.15 + (f.r ?? 0.3)) {
          w.hit.add(f);
          zap(f, w.dmg, { x: fx - w.dx, z: fz - w.dz, knock: 5.5, lift: 1.5, flash: 4, src: 'wave' });
          sparkAt(f, 'ember', 1.1);
          if (syn('THUNDER WAVE')) skyStrike(f, w.dmg * 0.7, { small: true });
        }
      }
      if (w.d >= w.max) waves.splice(i, 1);
    }
  }

  // ---- boon: ghost dash -------------------------------------------------------------------------
  function tickDash() {
    const dashing = ctl.state === 'dash';
    if (dashing && !st.wasDash) {
      st.dashHit.clear();
      if (has('ember-trail')) look.flash(hx(), 0.6, hz(), { color: 'ember', ms: 200, intensity: 2, radius: 3 });
    }
    st.wasDash = dashing;
    if (!dashing) return;
    if (has('ember-trail') && st.tick % 2 === 0) addFire(hx(), hz());
    if (has('ghost-dash')) {
      const fire = syn('FIRE WRAITH');
      if (st.tick % 2 === 0 && rig) {
        vfx.afterImage(rig.group, { life: 0.34, ramp: fire ? ['torch', 'gold', 'flame', 'ember', 'red'] : ['white', 'sky', 'cyan', 'teal', 'navy'] });
        if (fire && pool()) pool().add(hx(), 0.5, hz(), 0, 1, 0, 0.35, 5, 1, RAMPS.fireSoft(), F_TWINKLE, 0.94, 0);
      }
      const dmg = val('ghost-dash', 'dmg');
      for (const f of foes()) {
        if (st.dashHit.has(f) || dist(f, ctl) > 0.7 + (f.r ?? 0.3)) continue;
        st.dashHit.add(f);
        zap(f, dmg, { knock: 4.5, flash: 4, src: 'ghost' });
        sparkAt(f, fire ? 'ember' : 'ice', 1.1);
        look.flash(f.x, 0.8, f.z, { color: fire ? 'ember' : 'cyan', ms: 130, intensity: 2, radius: 3 });
        feedback.shake(1.5, 100);
        boonSfx.blade();
        if (fire) ignite(f);
      }
    }
  }

  // ---- boon: orbit blades -----------------------------------------------------------------------
  function rebuildBlades() {
    for (const b of blades) group.remove(b.mesh);
    blades.length = 0;
    if (!has('orbit-blades')) return;
    const n = val('orbit-blades', 'count');
    for (let i = 0; i < n; i++) {
      const mesh = voxelMesh('boon.blade');
      mesh.scale.setScalar(0.8);
      group.add(mesh);
      blades.push({ mesh, k: i, ang: (i / n) * TAU, pang: (i / n) * TAU, r: 0.2, pr: 0.2, y: 0.55 });
    }
  }
  function tickBlades() {
    if (!blades.length) return;
    const spin = 0.085, dmg = val('orbit-blades', 'dmg');
    for (const b of blades) {
      b.pang = b.ang; b.pr = b.r;
      b.ang += spin;
      b.r += (1.05 - b.r) * 0.16;
      b.y = 0.6 + Math.sin(st.tick * 0.08 + b.k * 2) * 0.08;
      const bx = hx() + Math.sin(b.ang) * b.r, bz = hz() + Math.cos(b.ang) * b.r;
      if (pool() && st.tick % 1 === 0) {
        pool().add(bx, b.y + 0.05, bz, 0, 0.1, 0, 0.22, 4, 1, RAMPS.spark(), 0, 0.9, 0);
        const back = b.ang - 0.16;
        pool().add(hx() + Math.sin(back) * b.r, b.y, hz() + Math.cos(back) * b.r, 0, 0.1, 0, 0.16, 3, 1, R('sky,cyan,blue'), 0, 0.9, 0);
      }
      for (const f of foes()) {
        if (Math.hypot(f.x - bx, f.z - bz) > 0.42 + (f.r ?? 0.3)) continue;
        const last = st.bladeHit.get(f) ?? -99;
        if (st.tick - last < 26) continue;
        st.bladeHit.set(f, st.tick);
        zap(f, dmg, { x: hx(), z: hz(), knock: 3.2, flash: 3, src: 'blade' });
        sparkAt(f, 'ice', 0.9);
        boonSfx.blade();
        if (syn('BLOODBLADES') && rng.chance(0.6)) shedMotes(f.x, f.z, 1);
      }
    }
  }

  // ---- boon: aegis -------------------------------------------------------------------------------
  function buildShield() {
    for (const m of shield.meshes) group.remove(m);
    shield.meshes.length = 0;
    if (!has('aegis')) return;
    for (let i = 0; i < 3; i++) { const m = voxelMesh('boon.shard'); m.scale.setScalar(1.5); group.add(m); shield.meshes.push(m); }
  }
  function raiseShield(quiet = false) {
    shield.up = true; shield.cd = 0; shield.k = 0;
    if (!quiet) { boonSfx.shield(); if (vfx.attached) vfx.pickup({ x: hx(), y: 0.8, z: hz(), style: 'magic' }); pop('AEGIS READY', hx(), 1.9, hz(), 'sky', 40); }
  }
  function breakShield(source) {
    shield.up = false; shield.cd = val('aegis', 'recharge');
    ctl.iframes?.(26);
    feedback.hitstop(70); feedback.flash('sky', 90, 0.22); feedback.shake(2.5, 160);
    boonSfx.glass();
    look.flash(hx(), 0.9, hz(), { color: 'sky', ms: 220, intensity: 3, radius: 4 });
    if (pool()) for (let i = 0; i < 28; i++) {
      const a = (i / 28) * TAU + rng.signed() * 0.2, sp = 3 + rng.next() * 3;
      pool().add(hx() + Math.sin(a) * 0.7, 0.6 + rng.signed() * 0.2, hz() + Math.cos(a) * 0.7, Math.sin(a) * sp, rng.next() * 2, Math.cos(a) * sp, 0.5, 5, 0, RAMPS.ice(), 0, 0.9, 6);
    }
    if (vfx.attached) vfx.shockwave({ x: hx(), z: hz(), radius: 2, style: 'ring' });
    pop('BLOCKED', hx(), 1.9, hz(), 'sky', 44, true);
    if (syn('SHATTER')) nova(val('retribution', 'dmg') * 0.8, val('retribution', 'r'), 'sky');
    void source;
  }

  // ---- boon: retribution / phoenix novas ----------------------------------------------------
  function nova(dmg, r, col = 'ember', crit = false) {
    if (vfx.attached) {
      vfx.shockwave({ x: hx(), z: hz(), radius: r * 1.1, style: col === 'sky' ? 'ring' : 'ember' });
      vfx.flash({ x: hx(), y: 0.8, z: hz(), color: col === 'sky' ? 'sky' : 'flame', radius: r * 1.4, ms: 200 });
    }
    if (pool()) for (let i = 0; i < 24; i++) {
      const a = (i / 24) * TAU, sp = 4 + rng.next() * 2;
      pool().add(hx() + Math.sin(a) * 0.4, 0.4, hz() + Math.cos(a) * 0.4, Math.sin(a) * sp, 0.4, Math.cos(a) * sp, 0.4, 5, 0, col === 'sky' ? RAMPS.ice() : RAMPS.fire(), 0, 0.9, 0);
    }
    feedback.shake(crit ? 5 : 3.5, 240);
    boonSfx.boom(crit ? 2 : 1);
    for (const f of foes()) {
      const d = dist(f, ctl) - (f.r ?? 0.3);
      if (d > r) continue;
      zap(f, dmg, { x: hx(), z: hz(), knock: crit ? 10 : 8, lift: 2, flash: 5, src: 'nova', crit });
      if (col !== 'sky') ignite(f, 90, 2);
    }
  }
  function phoenixSave() {
    ctl.iframes?.(90);
    feedback.hitstop(140); feedback.flash('flame', 260, 0.5); feedback.shake(6, 420);
    boonSfx.phoenix();
    look.flash(hx(), 1, hz(), { color: 'gold', ms: 500, intensity: 4.5, radius: 7 });
    if (vfx.attached) {
      vfx.embers({ x: hx(), y: 0.3, z: hz(), dur: 1.4, rate: 60 });
      vfx.shockwave({ x: hx(), z: hz(), radius: 4.5, style: 'ember' });
      vfx.shockwave({ x: hx(), z: hz(), radius: 3, style: 'ring' });
    }
    if (pool()) for (let i = 0; i < 46; i++) {
      const a = rng.next() * TAU, sp = 2 + rng.next() * 5;
      pool().add(hx(), 0.8, hz(), Math.sin(a) * sp, 1 + rng.next() * 5, Math.cos(a) * sp, 0.9, 6, 1, i % 3 ? RAMPS.fire() : RAMPS.gold(), F_TWINKLE, 0.95, 4);
    }
    pop('PHOENIX SPARK', hx(), 2.1, hz(), 'gold', 90, true);
    nova(val('phoenix-spark', 'dmg'), 3.6, 'ember', true);
  }

  // ---- speed / wind -------------------------------------------------------------------------------
  function applyMods() {
    let mul = 1;
    if (has('gale-boots')) mul += val('gale-boots', 'speed');
    if (st.haste > 0) mul *= 1 + st.hasteK * (syn('STORMRUNNER') ? 2 : 1);
    ctl.T.speed = base.speed * mul;
    ctl.T.dashCooldown = Math.round(base.cooldown * (has('ghost-dash') ? val('ghost-dash', 'cd') : 1));
    ctl.T.dashIframes = base.iframes + (has('ghost-dash') ? val('ghost-dash', 'iframes') : 0);
  }
  function tickWind() {
    const sp = ctl.speed ?? Math.hypot(ctl.vx, ctl.vz);
    const p = pool(); if (!p) return;
    const gale = has('gale-boots'), rush = st.haste > 0;
    if ((!gale && !rush) || sp < 1.6 || ctl.state === 'attack') return;
    const dx = ctl.vx / (sp || 1), dz = ctl.vz / (sp || 1);
    const every = rush ? 2 : 3;
    if (st.tick % every) return;
    const n = 1 + (gale ? lvl('gale-boots') > 2 ? 1 : 0 : 0) + (rush ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const side = rng.signed() * 0.35, y = 0.15 + rng.next() * 0.75;
      const x = hx() - dx * 0.25 + -dz * side, z = hz() - dz * 0.25 + dx * side;
      if (rush && i === n - 1) p.add(x, y, z, -dx * 2.5, 0.2, -dz * 2.5, 0.28, 5, 1, RAMPS.haste(), 1, 0.9, 0);
      else p.add(x, y, z, -dx * 3, 0.1, -dz * 3, 0.26, 4, 1, RAMPS.wind(), 1, 0.9, 0);
    }
    if (gale && st.tick % 9 === 0) vfx.dust({ x: hx() - dx * 0.3, z: hz() - dz * 0.3, dx, dz, n: 2, size: 4, speed: 0.9 });
  }

  // ---- damage hook (headsman) ------------------------------------------------------------------
  hooks.damage = (amount, spec) => {
    if (has('headsman') && COMBO.includes(spec) && spec.finisher) return Math.round(amount * val('headsman', 'mul'));
    return amount;
  };

  // ---- health wrapper (aegis, phoenix) -----------------------------------------------------------
  const origHurt = health.hurt.bind(health);
  health.hurt = (amount = 1, source = null, opts = {}) => {
    if (!opts.force && !health.dead && !health.invuln) {
      if (has('aegis') && shield.up) { breakShield(source); return { ok: false, reason: 'aegis' }; }
      if (phoenix.charges > 0 && !world.god && health.hp - amount <= 0) {
        phoenix.charges--;
        const r = origHurt(Math.max(0, health.hp - 1), source, opts);
        phoenixSave();
        return r;
      }
    }
    return origHurt(amount, source, opts);
  };

  // ---- events -----------------------------------------------------------------------------------
  on('combat:hit', (e) => {
    if (e.boon) return;
    const t = e.target;
    if (has('chain-spark')) chain(t);
    if (has('searing-brand')) ignite(t);
    if (has('storm-call')) {
      st.hitCount++;
      st.stormPips = st.hitCount; st.meterT = 0;
      if (st.hitCount >= val('storm-call', 'every')) {
        st.hitCount = 0;
        const pick = t && !t.dead ? t : foes().sort((a, b) => dist(a, ctl) - dist(b, ctl))[0];
        skyStrike(pick ?? t, val('storm-call', 'dmg'));
      }
    }
    if (has('life-motes') && e.finisher) shedMotes(t.x, t.z, 2);
    if (has('headsman') && e.finisher) {
      if (vfx.attached) {
        vfx.hit({ x: e.x, y: e.y + 0.3, z: e.z, dx: e.dx, dz: e.dz, power: 2.4, style: 'gold', spread: 3 });
        vfx.flash({ x: e.x, y: e.y + 0.4, z: e.z, color: 'gold', radius: 2.6, ms: 200 });
        vfx.shockwave({ x: e.x, z: e.z, radius: 1.5, style: 'ring' });
      }
      feedback.shake(2.2, 200);
      feedback.flash('gold', 70, 0.14);
      pop('CRIT', t.x, (t.h ?? 1.2) + 0.7, t.z, 'gold', 40, true);
      boonSfx.crit();
    }
  });
  on('combat:heroHurt', () => {
    if (has('retribution')) { nova(val('retribution', 'dmg'), val('retribution', 'r')); events.emit('boon:proc', { id: 'retribution', x: hx(), z: hz() }); }
  });
  on('enemy:die', (e) => {
    const t = e.enemy;
    const depth = st.depth;
    if (has('life-motes')) shedMotes(t.x, t.z, 3);
    if (has('bloodrush')) {
      const fresh = st.haste <= 0;
      st.haste = val('bloodrush', 'ticks'); st.hasteK = val('bloodrush', 'speed');
      if (fresh) { boonSfx.haste(); pop('BLOODRUSH', hx(), 1.9, hz(), 'rose', 40); }
      if (pool()) for (let i = 0; i < 10; i++) { const a = rng.next() * TAU; pool().add(hx(), 0.5, hz(), Math.sin(a) * 3, 0.5 + rng.next(), Math.cos(a) * 3, 0.3, 4, 0, RAMPS.haste(), 0, 0.9, 0); }
    }
    if (has('volatile-soul') && depth < 3) {
      const pyre = syn('PYRE') && burning.has(t);
      // a fuse: the corpse flashes, then it goes off
      if (pool()) for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; pool().add(t.x + Math.sin(a) * 0.3, 0.5, t.z + Math.cos(a) * 0.3, -Math.sin(a) * 1.5, 0.5, -Math.cos(a) * 1.5, 0.16, 4, 1, R('white,flame'), 0, 0.9, 0); }
      after(9, () => explode(t.x, t.z, depth, pyre));
    }
    burning.delete(t);
  });
  on('hero:slam', (e) => { if (has('third-wave')) launchWave(e.x, e.z, e.yaw); });
  on('arena:clear', () => refresh());
  on('combat:heroDeath', () => { motes.length = 0; });

  function refresh() {
    phoenix.charges = has('phoenix-spark') ? val('phoenix-spark', 'charges') : 0;
    if (has('aegis') && !shield.up) raiseShield(false);
  }

  // ---- acquire ------------------------------------------------------------------------------------
  function give(id) {
    const b = BOONS[id];
    if (!b) return 0;
    const cur = lvl(id);
    if (cur >= b.max) return cur;
    const before = new Set(activeSynergies(held).map((s) => s.name));
    held.set(id, cur + 1);
    world.boons.length = 0; world.boons.push(...held.keys());
    // per-boon setup
    if (id === 'orbit-blades') rebuildBlades();
    if (id === 'aegis') { buildShield(); raiseShield(true); }
    if (id === 'phoenix-spark') phoenix.charges = val(id, 'charges');
    if (id === 'lodestone' && pickups) { pickups.magnetMul = val(id, 'radius') / 2; pickups.dropBonus = val(id, 'bonus'); pickups.vacuumAll?.(); }
    applyMods();
    flourish(b, cur + 1);
    events.emit('boon:acquire', { id, level: cur + 1, rarity: b.rarity });
    for (const s of activeSynergies(held)) if (!before.has(s.name)) after(28, () => {
      pop(`SYNERGY: ${s.name}`, hx(), 2.3, hz(), 'gold', 110, true);
      if (vfx.attached) vfx.flash({ x: hx(), y: 1, z: hz(), color: 'gold', radius: 3, ms: 300 });
      feedback.flash('gold', 100, 0.12);
      boonSfx.crit();
      events.emit('boon:synergy', { name: s.name, a: s.a, b: s.b });
    });
    return cur + 1;
  }
  function flourish(b, level) {
    const k = b.rarity === 'epic' ? 2 : b.rarity === 'rare' ? 1 : 0;
    const col = RARITY[b.rarity];
    if (vfx.attached) {
      vfx.flash({ x: hx(), y: 1, z: hz(), color: col.glow, radius: 1.5 + k * 0.4, ms: 260 });
      vfx.shockwave({ x: hx(), z: hz(), radius: 1.8 + k, style: 'ring' });
      vfx.pickup({ x: hx(), y: 0.9, z: hz(), style: k === 2 ? 'gold' : 'magic' });
    }
    if (pool()) {
      const r = R(k === 2 ? 'white,torch,gold,flame' : k === 1 ? 'white,sky,cyan,blue' : 'white,frost,fog,mist');
      for (let i = 0; i < 18 + k * 12; i++) {
        const a = (i / (18 + k * 12)) * TAU;
        pool().add(hx() + Math.sin(a) * 0.5, 0.1, hz() + Math.cos(a) * 0.5, Math.sin(a) * 0.6, 2.2 + rng.next() * 2.4, Math.cos(a) * 0.6, 0.6 + rng.next() * 0.3, 4, 1, r, F_TWINKLE, 0.95, 0);
      }
    }
    look.flash(hx(), 1.2, hz(), { color: col.glow, ms: 300, intensity: 2.6 + k, radius: 4 });
    feedback.shake(1 + k, 160);
    pop(b.name + (level > 1 ? ` LV${level}` : ''), hx(), 2.0, hz(), col.hi, 70, true);
    boonSfx.acquire(b.rarity);
  }

  // ---- per-tick / render / ui ---------------------------------------------------------------------
  const sys = {
    held, bolts, fires, waves, motes, burning, shield, phoenix, st,
    has, level: lvl,
    list: () => [...held].map(([id, level]) => ({ id, level, ...BOONS[id] })),
    synergies: () => activeSynergies(held),
    give, refresh,
    reset() {
      held.clear(); world.boons.length = 0; fires.length = 0; waves.length = 0; motes.length = 0; burning.clear();
      rebuildBlades(); buildShield(); shield.up = false; phoenix.charges = 0; st.haste = 0; applyMods();
      if (pickups) { pickups.magnetMul = 1; pickups.dropBonus = 0; }
    },
    /** Run the callbacks queued by chains, fuses and strikes right now (tests). */
    flush() { for (const q of later.splice(0)) q.fn(); },

    tick() {
      st.tick++;
      if (st.haste > 0) { st.haste--; if (st.haste === 0) applyMods(); }
      st.chargeT++; st.meterT++;
      for (let i = later.length - 1; i >= 0; i--) if (--later[i].t <= 0) { const q = later.splice(i, 1)[0]; q.fn(); }
      applyMods();
      tickDash();
      tickFires(); tickBurning(); tickWaves(); tickMotes(); tickBlades(); tickWind();
      // aegis timer and orbit
      if (has('aegis')) {
        shield.pang = shield.ang; shield.ang += 0.05;
        if (!shield.up) { shield.cd--; if (shield.cd <= 0) raiseShield(); }
        shield.k += (1 - shield.k) * 0.15;
      }
      for (const b of bolts) b.t++;
      for (let i = bolts.length - 1; i >= 0; i--) if (bolts[i].t >= bolts[i].life) bolts.splice(i, 1);
      for (const p of pops) p.t++;
      for (let i = pops.length - 1; i >= 0; i--) if (pops[i].t >= pops[i].life) pops.splice(i, 1);
    },

    render(alpha) {
      for (const b of blades) {
        const ang = b.pang + (b.ang - b.pang) * alpha, r = b.pr + (b.r - b.pr) * alpha;
        b.mesh.position.set(hx() + Math.sin(ang) * r, b.y, hz() + Math.cos(ang) * r);
        b.mesh.rotation.y = ang - Math.PI / 2;
      }
      const n = shield.meshes.length;
      for (let i = 0; i < n; i++) {
        const m = shield.meshes[i];
        m.visible = shield.up;
        if (!shield.up) continue;
        const a = shield.pang + (shield.ang - shield.pang) * alpha + (i / n) * TAU;
        const rr = 0.72 * (0.5 + 0.5 * shield.k);
        m.position.set(hx() + Math.sin(a) * rr, 0.62 + Math.sin(a * 2 + st.tick * 0.05) * 0.06, hz() + Math.cos(a) * rr);
        m.rotation.y = -a;
      }
    },

    ui(g) {
      // lightning
      for (const b of bolts) {
        if (b.t < 0) continue;
        const u = b.t / b.life, thick = u < 0.5 ? 3 : 2, flick = b.t % 2 === 0;
        const P = b.pts.map((p) => display.worldToScreen(p.x, p.y, p.z));
        g.fillStyle = css('ink'); for (let i = 1; i < P.length; i++) line(g, P[i - 1], P[i], thick + 2);
        g.fillStyle = css(u > 0.7 && !flick ? 'blue' : b.col); for (let i = 1; i < P.length; i++) line(g, P[i - 1], P[i], thick);
        g.fillStyle = css(u > 0.75 ? 'sky' : b.core); for (let i = 1; i < P.length; i++) line(g, P[i - 1], P[i], 1);
      }
      // floating words
      for (const p of pops) {
        const u = p.t / p.life, e = Math.min(1, p.t / 6);
        const s = p.big ? 1 : 1;
        const sp = display.worldToScreen(p.x, p.y + Math.min(0.9, p.t * 0.012), p.z);
        const w = textWidth(p.text, s);
        const y = sp.y - Math.round(Math.sin(e * Math.PI) * 2);
        if (u > 0.8 && p.t % 2) continue;
        drawText(g, p.text, sp.x - (w >> 1), y, p.col, { outline: 'ink', scale: s });
      }
      // small meters by the hero's feet
      const feet = display.worldToScreen(hx(), 0, hz());
      let mx = feet.x, my = feet.y + 10;
      if (has('life-motes') && st.chargeT < 120) meter(g, mx, my, st.charge, val('life-motes', 'need'), 'red', 'rose'), my += 6;
      if (has('storm-call') && st.meterT < 120) meter(g, mx, my, st.hitCount, val('storm-call', 'every'), 'cyan', 'sky'), my += 6;
      if (has('aegis') && !shield.up) {
        const k = 1 - shield.cd / val('aegis', 'recharge'), w = 20;
        g.fillStyle = css('ink'); g.fillRect(mx - 11, my - 1, w + 2, 4);
        g.fillStyle = css('navy'); g.fillRect(mx - 10, my, w, 2);
        g.fillStyle = css('sky'); g.fillRect(mx - 10, my, Math.round(w * k), 2);
      }
    },

    dispose() {
      for (const f of offs) f();
      offs.length = 0;
      hooks.damage = null;
      health.hurt = origHurt;
      ctl.T.speed = base.speed; ctl.T.dashCooldown = base.cooldown; ctl.T.dashIframes = base.iframes;
      for (const b of blades) group.remove(b.mesh);
      root.remove(group);
    },
  };
  return sys;
}

function meter(g, cx, y, n, of, col, hi) {
  const w = of * 4 - 1, x = Math.round(cx - w / 2);
  g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, w + 2, 4);
  for (let i = 0; i < of; i++) { g.fillStyle = css(i < n ? (i === n - 1 ? hi : col) : 'shadow'); g.fillRect(x + i * 4, y, 3, 2); }
}

/**
 * HUD helper: the held boons as a row of icons with stack pips; synergies link with a gold bar.
 *   drawBoonStrip(g, boons, x, y, { scale: 2, vertical: false }) -> { w, h }
 */
export function drawBoonStrip(g, boons, x, y, { scale = 2, gap = 2, vertical = false } = {}) {
  const cell = 12 * scale;
  const items = boons.list();
  const syn = boons.synergies();
  const pos = {};
  items.forEach((it, i) => {
    const cx = vertical ? x : x + i * (cell + gap + 2), cy = vertical ? y + i * (cell + gap + 3) : y;
    pos[it.id] = { x: cx, y: cy };
    const r = RARITY[it.rarity];
    g.fillStyle = css('ink'); g.fillRect(cx - 2, cy - 2, cell + 4, cell + 4);
    g.fillStyle = css(r.edgeDark); g.fillRect(cx - 1, cy - 1, cell + 2, cell + 2);
    g.fillStyle = css('night'); g.fillRect(cx, cy, cell, cell);
    drawIcon(g, it.id, cx, cy, scale, { outline: false });
    g.fillStyle = css(r.edge);
    for (let k = 0; k < it.level; k++) g.fillRect(cx + 1 + k * 3, cy + cell - 2, 2, 1 + (scale > 1 ? 1 : 0));
  });
  for (const s of syn) {
    const a = pos[s.a], b = pos[s.b];
    if (!a || !b) continue;
    g.fillStyle = css('gold');
    if (vertical) g.fillRect(a.x + cell + 3, Math.min(a.y, b.y) + cell / 2, 1, Math.abs(a.y - b.y));
    else g.fillRect(Math.min(a.x, b.x) + cell / 2, y + cell + 3, Math.abs(a.x - b.x), 1);
  }
  return { w: vertical ? cell + 4 : items.length * (cell + gap + 2), h: vertical ? items.length * (cell + gap + 3) : cell + 4 };
}
