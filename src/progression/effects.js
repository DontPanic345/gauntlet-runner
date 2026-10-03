// Boon runtime (piece `boons`): what each held boon does, and how you see it.
//
//   const rt = createBoonRuntime(root, { ctl, anim, rig, health, combat, pickups });
//   rt.tick()  (after combat.tick() and the enemies' tick)   rt.render(alpha)   rt.ui(g)   rt.dispose()
//   rt.apply()        re-read the held boons (call after a boon is gained; boon:gain does it)
//   rt.procs          { [boonId]: count }   rt.lastProc { [boonId]: tick }   (HUD flashes)
//
// It hooks into the rest of the game through events, plus three small hooks:
//   combat.modHit({target, spec, dmg, step}) -> {dmg, spec}   crits and knockback (combat.js)
//   health.guard(amount, source) -> true to refuse a hurt       the ward and the phoenix (combat.js)
//   ctl.T                                                       live movement tuning (fleet foot)
//
// Every proc goes through procHit(): takeHit on the target, a damage number, and combat:kill
// when it dies, but NOT combat:hit, so procs never trigger each other in a loop and never play
// the sword's own hit effects. Each boon draws its own.
//
// Events emitted: 'boon:proc' {id, x, z}, 'boon:synergy' {id}.

import * as THREE from 'three';
import { DT, loop } from '../core/loop.js';
import { events } from '../core/events.js';
import { world } from '../core/world.js';
import { feedback } from '../core/feedback.js';
import { display } from '../core/display.js';
import { getCollision } from '../core/collision.js';
import { Rng } from '../core/rng.js';
import { drawText } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { defineModel, voxelMesh, VoxelGrid } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import { COMBO, swingRange, sectorHits } from '../combat/combat.js';
import { BOONS, stacks, has, level, synergyActive, progress } from './boons.js';
import { boonSfx } from './sfx.js';
import { drawIcon } from './icons.js';

const { add, addShape, ramp, P, S, SPRITE, CUBE, STREAK, RING, DISC, STAR, FLOOR, FACING } = vfx.core;
const TAU = Math.PI * 2;

ramp('bolt', [['white', 0.2], ['sky', 0.55], ['cyan', 0.85], ['teal', 1]]);
ramp('boltGold', [['white', 0.2], ['torch', 0.5], ['gold', 0.85], ['flame', 1]]);
ramp('leechMote', [['rose', 0.25], ['red', 0.7], ['blood', 1]]);
ramp('wind', [['white', 0.1], ['frost', 0.4], ['sky', 0.75], ['teal', 1]]);
ramp('reap', [['white', 0.12], ['rose', 0.4], ['plum', 0.8], ['violet', 1]]);
ramp('moon', [['white', 0.2], ['sky', 0.6], ['cyan', 1]]);
ramp('rune', [['white', 0.15], ['frost', 0.45], ['sky', 1]]);

// ---- models ---------------------------------------------------------------------------------
let built = false;
function buildModels() {
  if (built) return;
  built = true;
  // ember orb: a 3x3x3 rounded coal with a white-hot heart
  {
    const g = new VoxelGrid(3, 3, 3);
    for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) for (let x = 0; x < 3; x++) {
      const edge = (x !== 1) + (y !== 1) + (z !== 1);
      if (edge === 3) continue;
      // gold and torch only: emissive flame/ember would not survive look's quantise (reserved colours)
      g.set(x, y, z, edge === 0 ? 'white' : y === 2 ? 'torch' : y === 0 ? 'red' : 'gold', true);
    }
    g.set(1, 2, 2, 'torch', true);
    defineModel('boons.orb', { grid: g, origin: [1.5, 1.5, 1.5] });
  }
  // ward rune: a little upright tablet of light
  {
    const g = new VoxelGrid(3, 4, 1);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 3; x++) g.set(x, y, 0, (x === 1 && y > 0 && y < 3) ? 'white' : (y === 3 || x === 0) ? 'frost' : 'sky', true);
    defineModel('boons.rune', { grid: g, origin: [1.5, 2, 0.5] });
  }
  // moon wave: a crescent bowed forward (+z), 15 voxels across, 3 tall
  {
    const W = 15, D = 6;
    const g = new VoxelGrid(W, 3, D);
    for (let x = 0; x < W; x++) {
      const u = (x - 7) / 7;
      const zf = Math.round((1 - u * u) * 4) + 1;          // the leading edge
      const th = Math.max(1, Math.round((1 - Math.abs(u)) * 2.2));
      for (let k = 0; k < th + 1; k++) {
        const z = zf - k;
        if (z < 0) continue;
        for (let y = 0; y < 3; y++) {
          if ((y === 0 || y === 2) && Math.abs(u) > 0.8) continue;
          g.set(x, y, z, k === 0 ? 'white' : k === 1 ? 'sky' : 'cyan', true);
        }
      }
    }
    defineModel('boons.moon', { grid: g, origin: [7.5, 1.5, 3] });
  }
  // falling star: a fat 5-point star, 7x7, 2 thick
  {
    const rows = ['...#...', '...#...', '#######', '.#####.', '..###..', '.##.##.', '##...##'];
    const g = new VoxelGrid(7, 7, 2);
    rows.forEach((r, i) => { for (let x = 0; x < 7; x++) if (r[x] === '#') for (let z = 0; z < 2; z++) {
      const core = Math.abs(x - 3) <= 1 && i >= 2 && i <= 4;
      g.set(x, 6 - i, z, core ? 'white' : z === 1 ? 'torch' : 'gold', true);
    } });
    defineModel('boons.star', { grid: g, origin: [3.5, 3.5, 1] });
  }
}

// ---- small helpers ----------------------------------------------------------------------------
let seed = 0x2b0;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const rr = (a, b) => a + (b - a) * rnd();

/** Live enemies that procs may strike (not props, not spawning-in, not dying). */
function foes() {
  return (world.enemies || []).filter((e) => e && !e.dead && !e.dying && e.state !== 'spawn' && e.takeHit);
}

/**
 * A boon's own hit: damage, a number, a kill event. No combat:hit (see header).
 *   from {x, z}: the push comes from here.  knock: units/s.  crit: gold number.
 */
export function procHit(t, dmg, { from = null, knock = 1.2, power = 0.6, crit = false, flash = 2 } = {}) {
  if (!t || t.dead || t.dying || !t.takeHit) return false;
  let dx = t.x - (from?.x ?? t.x), dz = t.z - (from?.z ?? t.z - 1);
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  dmg = Math.max(1, Math.round(dmg));
  const hit = { dmg, dx, dz, tx: 0, tz: 0, power, step: -1, finisher: false, knock, lift: 0, stopMs: 0, flashTicks: flash, proc: true };
  if (t.takeHit(hit) === false) return false;
  events.emit('combat:damage', { x: t.x, y: (t.h ?? 1.2) + 0.1, z: t.z, amount: dmg, crit, side: 'enemy', proc: true });
  if (t.dead) events.emit('combat:kill', { target: t, x: t.x, z: t.z, proc: true });
  return true;
}

export function createBoonRuntime(root, { ctl, anim, rig, health, combat, pickups = null }) {
  buildModels();
  const group = new THREE.Group();
  group.name = 'boons';
  root.add(group);
  const offs = [];
  const on = (n, f) => offs.push(events.on(n, f));
  const critRng = new Rng(`boons/crit/${progress.picks}`);
  const queue = [];                                   // [{at, fn}] sim-tick timers
  const later = (ticks, fn) => queue.push({ at: tick + ticks, fn });
  let tick = 0;

  const procs = {}, lastProc = {};
  const proc = (id, x = ctl.x, z = ctl.z) => { procs[id] = (procs[id] ?? 0) + 1; lastProc[id] = loop.tick; events.emit('boon:proc', { id, x, z }); };

  const bolts = [];          // 2D lightning: {a:{x,y,z}, b:{x,y,z}, t, life, gold, seed}
  const labels = [];         // world-anchored words: CRIT!, REAPED, BLOCKED ...
  const burns = new Map();   // target -> {t, dmg, next}
  const trail = [];          // ember trail points {x, z, t, life}
  const trailCd = new Map(); // target -> tick it may be scorched again
  const orbCd = new Map();
  const waves = [];          // moon waves in flight
  const stars = [];          // falling stars
  const motes = [];          // leech motes
  const marked = new Set();  // reaper marks
  const crits = new Set();   // targets critted this tick (for the hit's visuals)
  let hitCount = 0;
  let leechMotes = 0;

  const say = (text, x, y, z, color = 'gold', scale = 1, life = 40) => labels.push({ text, x, y, z, color, scale, t: 0, life });

  // ---- tuning that lives on other objects (restored on dispose) -----------------------------
  const baseT = { speed: ctl.T.speed, dashCooldown: ctl.T.dashCooldown };
  function apply() {
    const ff = stacks('fleet-foot') ? level('fleet-foot') : { speed: 0, cool: 0 };
    ctl.T.speed = baseT.speed * (1 + ff.speed);
    ctl.T.dashCooldown = Math.round(baseT.dashCooldown * (1 - ff.cool));
    if (pickups) pickups.magnet = has('soul-hunger') ? level('soul-hunger').magnet : 1;
    syncOrbs();
    if (has('bulwark') && !ward.meshes.length) buildWard();
    if (!has('bulwark') && ward.meshes.length) clearWard();
  }

  // ---- combat hooks ----------------------------------------------------------------------------
  combat.modHit = ({ target, spec, dmg }) => {
    let out = null;
    if (has('heavy-hand')) out = { spec: { ...spec, knock: spec.knock * level('heavy-hand').knock, kick: (spec.kick ?? 1.5) * 1.3 } };
    if (has('keen-edge') && critRng.chance(level('keen-edge').chance) && !target.noAssist) {
      crits.add(target);
      out = { ...(out || {}), dmg: dmg * 2 };
    }
    return out;
  };
  health.guard = (amount, source) => {
    if (health.dead) return false;
    if (has('bulwark') && ward.up) { wardBlock(source); return true; }
    if (has('phoenix') && !progress.spent.has('phoenix') && !world.god && amount >= health.hp) { rekindle(); return true; }
    return false;
  };

  // ---- lightning (chain spark, storm dash) ----------------------------------------------------
  function bolt(a, b, gold = false, life = 10) {
    bolts.push({ a: { ...a }, b: { ...b }, t: 0, life, gold, seed: Math.floor(rnd() * 1e6) });
  }
  const chest = (t) => ({ x: t.x, y: (t.hitY ?? 0.6) + 0.1, z: t.z });
  /** Arc from a point to up to `jumps` foes, each from the last, `delay` ticks apart. */
  function chain(from, jumps, { exclude = new Set(), dmg = 5, range = 3.4, gold = false, fork = false, id = 'chain-spark' } = {}) {
    let src = from;
    const hitSet = new Set(exclude);
    const step = (k) => {
      if (k >= jumps) return;
      const cand = foes().filter((e) => !hitSet.has(e) && Math.hypot(e.x - src.x, e.z - src.z) < range)
        .sort((p, q) => Math.hypot(p.x - src.x, p.z - src.z) - Math.hypot(q.x - src.x, q.z - src.z));
      const targets = fork ? cand : cand.slice(0, 1);
      if (!targets.length) return;
      for (const t of targets) {
        hitSet.add(t);
        const to = chest(t);
        bolt(src, to, gold);
        const crit = synergyActive('lightning-rod') && has('keen-edge') && critRng.chance(level('keen-edge').chance);
        procHit(t, crit ? dmg * 2 : dmg, { from: src, knock: 1.4, crit });
        vfx.hitSpark(to.x, to.y, to.z, { dx: to.x - src.x, dz: to.z - src.z, power: 0.55, palette: crit || gold ? 'hit' : 'cool', light: false });
        if (crit) say('CRIT!', to.x, to.y + 0.9, to.z, 'gold');
        proc(id, t.x, t.z);
      }
      boonSfx.zap();
      look.flash(targets[0].x, 0.8, targets[0].z, { color: gold ? 'gold' : 'sky', ms: 80, intensity: 1.6, radius: 3 });
      src = chest(targets[targets.length - 1]);
      later(3, () => step(k + 1));
    };
    later(2, () => step(0));
  }

  // ---- burning (kindling, wildfire, solar flare, phoenix) -------------------------------------
  function ignite(t, dmg = null) {
    if (!t || t.dead || t.dying) return;
    const d = dmg ?? (has('kindling') ? level('kindling').dmg : 2);
    const b = burns.get(t);
    if (b) { b.t = 0; b.dmg = Math.max(b.dmg, d); return; }
    burns.set(t, { t: 0, dmg: d, next: 30, dur: 180 });
    vfx.embers(t.x, 0.5, t.z, { n: 6, spread: 0.25 });
    boonSfx.burn();
  }
  function tickBurns() {
    for (const [t, b] of burns) {
      b.t++;
      if (t.dead || t.dying) {
        burns.delete(t);
        if (synergyActive('wildfire') && t.dead) wildfire(t);
        continue;
      }
      if (b.t >= b.dur) { burns.delete(t); continue; }
      const h = t.h ?? 1.2;
      // tongues of flame licking up the body: big hot sprites low, small embers high
      for (let k = 0; k < 2; k++) {
        const low = k === 0;
        const i = add(t.x + rr(-0.25, 0.25), low ? rr(0.05, h * 0.45) : rr(h * 0.4, h * 0.9), t.z + rr(-0.12, 0.18), rr(-0.25, 0.25), rr(1.4, 2.8), 0,
          rr(0.28, 0.45), low ? (b.t % 3 ? 4 : 5) : 3, 'fire', SPRITE);
        if (i >= 0) { P.wob[i] = 3; P.ph[i] = rr(0, TAU); P.drag[i] = 0.95; P.fadeAt[i] = 0.5; P.shrinkAt[i] = 0.3; P.pop[i] = 1.3; }
      }
      if (b.t % 9 === 0) {
        const i = add(t.x + rr(-0.2, 0.2), h * 0.7, t.z, rr(-0.5, 0.5), rr(2.5, 4), 0, rr(0.5, 0.9), 1, 'ember', STREAK);
        if (i >= 0) { P.stretch[i] = 0.04; P.wob[i] = 4; P.drag[i] = 0.96; }
      }
      if (b.t % b.next === 0) {
        procHit(t, b.dmg, { knock: 0.1, flash: 1 });
        proc('kindling', t.x, t.z);
        boonSfx.burn();
      }
    }
  }
  function wildfire(t) {
    const x = t.x, z = t.z;
    vfx.flash(x, 0.6, z, { color: 'flame', size: 1.1 });
    vfx.shockwave(x, z, { radius: 1.7, color: 'ember', hot: 'torch', dust: false });
    vfx.embers(x, 0.4, z, { n: 22, spread: 0.6, up: 1.4 });
    feedback.shake(2.5, 160);
    boonSfx.quake();
    for (const e of foes()) if (Math.hypot(e.x - x, e.z - z) < 1.8) { procHit(e, 6, { from: { x, z }, knock: 4 }); ignite(e); }
    say('WILDFIRE', x, 1.6, z, 'flame', 1, 46);
    proc('ember-trail', x, z);
  }

  // ---- ember trail: burning floor tiles ------------------------------------------------------
  const TILE = 1 / 8;
  const tileGeo = new THREE.BoxGeometry(TILE, TILE / 4, TILE);
  const tileMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const tiles = new THREE.InstancedMesh(tileGeo, tileMat, 1400);
  tiles.count = 0;
  tiles.frustumCulled = false;
  look.noOutline(tiles);
  group.add(tiles);
  const tileCols = ['torch', 'gold', 'flame', 'ember', 'red', 'blood'].map((n) => new THREE.Color(css(n)));
  const m4 = new THREE.Matrix4();
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };
  function addTrailPoint(x, z) {
    const lv = level('ember-trail');
    const lastP = trail[trail.length - 1];
    if (lastP && lastP.fresh && Math.hypot(lastP.x - x, lastP.z - z) < 0.28) return;
    trail.push({ x, z, t: 0, life: lv.life, fresh: true });
  }
  function tickTrail() {
    if (ctl.state === 'dash' && has('ember-trail')) addTrailPoint(ctl.x, ctl.z);
    for (const p of trail) {
      p.t++;
      if (ctl.state !== 'dash') p.fresh = false;
      const k = p.t / p.life;
      if ((p.t + Math.floor(p.x * 7)) % (k < 0.7 ? 3 : 6) === 0) {
        const i = add(p.x + rr(-0.2, 0.2), 0.05, p.z + rr(-0.15, 0.15), rr(-0.2, 0.2), rr(1, 2.2) * (1 - k * 0.6), 0, rr(0.25, 0.45), rnd() < 0.3 ? 3 : 2, 'fire', SPRITE);
        if (i >= 0) { P.wob[i] = 3; P.ph[i] = rr(0, TAU); P.fadeAt[i] = 0.5; }
      }
    }
    for (let i = trail.length - 1; i >= 0; i--) if (trail[i].t >= trail[i].life) trail.splice(i, 1);
    if (!trail.length) return;
    const dmg = level('ember-trail').dmg;
    for (const e of foes()) {
      if ((trailCd.get(e) ?? 0) > tick) continue;
      if (!trail.some((p) => Math.hypot(e.x - p.x, e.z - p.z) < 0.34 + (e.r ?? 0.35))) continue;
      trailCd.set(e, tick + 24);
      procHit(e, dmg, { knock: 0.3, flash: 1 });
      if (has('kindling')) ignite(e);
      vfx.embers(e.x, 0.2, e.z, { n: 5, spread: 0.2 });
      proc('ember-trail', e.x, e.z);
    }
  }
  function renderTrail() {
    let n = 0;
    const seen = new Set();
    for (const p of trail) {
      const k = p.t / p.life;
      const R = 0.3 * (k < 0.08 ? 0.6 + k * 5 : 1);
      const cx = Math.floor(p.x / TILE), cz = Math.floor(p.z / TILE), rt = Math.ceil(R / TILE);
      for (let dz = -rt; dz <= rt; dz++) for (let dx = -rt; dx <= rt; dx++) {
        const tx = cx + dx, tz = cz + dz;
        const d = Math.hypot(dx, dz) * TILE;
        const hsh = hash(tx, tz);
        if (d > R * (0.75 + hsh * 0.35)) continue;
        // tiles die from the outside in, raggedly, in the last 40%
        if (k > 0.6 && hsh < (k - 0.6) / 0.4 + d / R * 0.4) continue;
        const key = tx * 73856093 ^ tz;
        if (seen.has(key) || n >= 1400) continue;
        seen.add(key);
        // colour: hot core, flickering, cooling to blood with age
        const flick = Math.floor((tick + hsh * 40) / 5) % 3 === 0 ? 1 : 0;
        let ci = Math.min(5, Math.floor(d / R * 3 + k * 3.2 + (1 - flick) * 0.6 + hsh * 0.8));
        if (k < 0.1) ci = Math.max(0, ci - 2);
        m4.makeTranslation((tx + 0.5) * TILE, 0.012, (tz + 0.5) * TILE);
        tiles.setMatrixAt(n, m4);
        tiles.setColorAt(n, tileCols[ci]);
        n++;
      }
    }
    tiles.count = n;
    tiles.instanceMatrix.needsUpdate = true;
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
  }

  // ---- ember orbit ---------------------------------------------------------------------------
  const orbs = [];
  let orbA = 0;
  function syncOrbs() {
    const want = has('ember-orbit') ? level('ember-orbit').orbs : 0;
    while (orbs.length < want) {
      const m = voxelMesh('boons.orb');
      group.add(m);
      orbs.push({ m, x: ctl.x, z: ctl.z, y: 0.6, px: ctl.x, pz: ctl.z, py: 0.6, born: tick });
      vfx.flash(ctl.x, 0.6, ctl.z, { color: 'flame', size: 0.5, light: false });
    }
    while (orbs.length > want) group.remove(orbs.pop().m);
  }
  function tickOrbs() {
    if (!orbs.length) return;
    orbA += 0.085;
    const dmg = level('ember-orbit').dmg;
    orbs.forEach((o, i) => {
      o.px = o.x; o.pz = o.z; o.py = o.y;
      const a = orbA + (i / orbs.length) * TAU;
      const grow = Math.min(1, (tick - o.born) / 14);
      const R = 1.15 * grow;
      o.x = ctl.x + Math.sin(a) * R; o.z = ctl.z + Math.cos(a) * R;
      o.y = 0.55 + Math.sin(a * 2 + tick * 0.05) * 0.08;
      // a short fire tail behind each orb
      const j = add(o.px, o.py, o.pz, 0, rr(0.2, 0.8), 0, 0.22, rnd() < 0.4 ? 2 : 1, 'fire', SPRITE);
      if (j >= 0) { P.fadeAt[j] = 0.4; P.pop[j] = 1; }
      for (const e of foes()) {
        if ((orbCd.get(e) ?? 0) > tick) continue;
        if (Math.hypot(e.x - o.x, e.z - o.z) > 0.2 + (e.r ?? 0.35)) continue;
        orbCd.set(e, tick + 30);
        procHit(e, dmg, { from: { x: ctl.x, z: ctl.z }, knock: 2.2 });
        vfx.hitSpark(o.x, o.y, o.z, { dx: e.x - ctl.x, dz: e.z - ctl.z, power: 0.5, palette: 'ember', light: false });
        if (synergyActive('solar-flare')) ignite(e);
        boonSfx.burn();
        proc('ember-orbit', e.x, e.z);
      }
    });
  }

  // ---- bulwark ward ---------------------------------------------------------------------------
  const ward = { meshes: [], up: false, regrowT: 0, growK: 0 };
  function buildWard() {
    for (let i = 0; i < 3; i++) { const m = voxelMesh('boons.rune'); m.visible = false; group.add(m); ward.meshes.push(m); }
    ward.up = true; ward.growK = 0;
    ward.meshes.forEach((m, i) => later(i * 4, () => { m.visible = true; vfx.twinkle(ctl.x, 0.6, ctl.z, { color: 'sky' }); boonSfx.wardGrow(); }));
  }
  function clearWard() { for (const m of ward.meshes) group.remove(m); ward.meshes.length = 0; ward.up = false; }
  function wardBlock(source) {
    ward.up = false;
    ward.regrowT = level('bulwark').regrow;
    for (const m of ward.meshes) {
      m.visible = false;
      vfx.death(m.position.x, m.position.y, m.position.z, { colors: ['sky', 'frost', 'white'], power: 0.35, soul: false, ring: 'sky' });
    }
    vfx.shockwave(ctl.x, ctl.z, { radius: 1.5, color: 'sky', hot: 'white', dust: false });
    feedback.hitstop(70);
    feedback.flash('sky', 90, 0.12);
    feedback.shake(2, 140);
    ctl.iframes(30);
    look.flash(ctl.x, 0.8, ctl.z, { color: 'sky', ms: 160, intensity: 2.4, radius: 4 });
    for (const e of foes()) {
      const d = Math.hypot(e.x - ctl.x, e.z - ctl.z);
      if (d < 1.6 && d > 1e-3) { e.vx += (e.x - ctl.x) / d * 6 / (e.weight ?? 1); e.vz += (e.z - ctl.z) / d * 6 / (e.weight ?? 1); }
    }
    boonSfx.wardBlock();
    say('BLOCKED', ctl.x, 1.7, ctl.z, 'sky', 1, 44);
    events.emit('combat:dodge', { x: ctl.x, z: ctl.z, source, ward: true });
    proc('bulwark');
  }
  function tickWard() {
    if (!ward.meshes.length) return;
    if (!ward.up && --ward.regrowT <= 0) {
      ward.up = true;
      ward.meshes.forEach((m, i) => later(i * 5, () => { m.visible = true; vfx.sparkle(ctl.x, 0.6, ctl.z, { palette: 'rune', color: 'sky' }); boonSfx.wardGrow(); }));
    }
  }
  function renderWard(alpha) {
    if (!ward.meshes.length) return;
    const t = (loop.tick + alpha) * 0.05;
    const c = ctl.at(alpha);
    ward.meshes.forEach((m, i) => {
      const a = t + (i / 3) * TAU;
      m.position.set(c.x + Math.sin(a) * 0.62, 0.55 + Math.sin(t * 2.3 + i) * 0.06, c.z + Math.cos(a) * 0.62);
      look.snap(m.position);
      m.rotation.y = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
    });
  }

  // ---- phoenix -------------------------------------------------------------------------------
  function rekindle() {
    progress.spent.add('phoenix');
    const x = ctl.x, z = ctl.z;
    health.hp = Math.min(health.maxHp, level('phoenix').hp);
    health.iframeT = 150; health.hurtT = 0;
    feedback.hitstop(160);
    feedback.flash('flame', 260, 0.32);
    feedback.shake(6, 380);
    look.flash(x, 1, z, { color: 'flame', ms: 420, intensity: 4, radius: 7 });
    vfx.flash(x, 0.8, z, { color: 'flame', size: 2 });
    vfx.shockwave(x, z, { radius: 3.4, color: 'ember', hot: 'torch' });
    later(4, () => vfx.shockwave(x, z, { radius: 2.2, color: 'flame', hot: 'white', dust: false }));
    vfx.embers(x, 0.3, z, { n: 40, spread: 0.9, up: 2 });
    // a column of fire, rising wings of flame either side
    for (let k = 0; k < 40; k++) {
      const side = k % 2 ? 1 : -1, f = (k >> 1) / 20;
      const i = add(x + side * f * 1.4, 0.3 + f * 1.4, z + rr(-0.1, 0.1), side * rr(0.5, 1.5), rr(2, 4) * (1 - f * 0.5), 0, rr(0.4, 0.7), rnd() < 0.3 ? 4 : 3, 'fire', CUBE);
      if (i >= 0) { P.delay[i] = f * 0.12; P.drag[i] = 0.9; P.fadeAt[i] = 0.6; P.shrinkAt[i] = 0.5; }
    }
    for (const e of foes()) if (Math.hypot(e.x - x, e.z - z) < 3.6) { procHit(e, 10, { from: { x, z }, knock: 8 }); ignite(e, 3); }
    boonSfx.phoenix();
    say('REKINDLED', x, 1.9, z, 'flame', 2, 70);
    proc('phoenix');
  }

  // ---- moon wave -----------------------------------------------------------------------------
  function moonWave(x, z, yaw, ghost = false) {
    const lv = level('moon-wave');
    const m = voxelMesh('boons.moon');
    group.add(m);
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    waves.push({ m, x: x + dx * 0.6, z: z + dz * 0.6, px: x, pz: z, yaw, dx, dz, t: 0, life: Math.round(lv.range / 10 * 60), hit: new Set(), dmg: lv.dmg, ghost });
    vfx.flash(x + dx * 0.7, 0.5, z + dz * 0.7, { color: 'sky', size: 0.7, light: false });
    look.flash(x + dx, 0.6, z + dz, { color: 'sky', ms: 140, intensity: 2.2, radius: 4 });
    boonSfx.wave();
    proc('moon-wave');
  }
  function tickWaves() {
    const cw = getCollision();
    for (const w of waves) {
      w.px = w.x; w.pz = w.z; w.t++;
      const sp = 10 * DT;
      w.x += w.dx * sp; w.z += w.dz * sp;
      // a spray of light off the edge
      for (let k = 0; k < 2; k++) {
        const u = rr(-1, 1);
        const ox = Math.cos(w.yaw) * u * 0.85, oz = -Math.sin(w.yaw) * u * 0.85;
        const i = add(w.x + ox, rr(0.12, 0.4), w.z + oz, -w.dx * 2, rr(0, 0.6), -w.dz * 2, rr(0.15, 0.3), 1, 'moon', STREAK);
        if (i >= 0) { P.stretch[i] = 0.05; P.drag[i] = 0.88; }
      }
      for (const e of foes()) {
        if (w.hit.has(e)) continue;
        const rx = e.x - w.x, rz = e.z - w.z;
        const along = rx * w.dx + rz * w.dz, side = Math.abs(rx * w.dz - rz * w.dx);
        if (Math.abs(along) > 0.45 + (e.r ?? 0.35) || side > 0.95 + (e.r ?? 0.35) * 0.5) continue;
        w.hit.add(e);
        procHit(e, w.dmg, { from: { x: w.x - w.dx, z: w.z - w.dz }, knock: 5, power: 1 });
        vfx.hitSpark(e.x, 0.6, e.z, { dx: w.dx, dz: w.dz, power: 0.9, palette: 'cool', light: false });
        feedback.hitstop(30);
      }
      const blocked = cw && cw.blocked(w.x + w.dx * 0.3, w.z + w.dz * 0.3, 0.08);
      if (blocked || w.t >= w.life) {
        w.dead = true;
        vfx.sparkle(w.x, 0.4, w.z, { palette: 'moon', color: 'sky' });
        addShape(RING, FLOOR, w.x, 0.02, w.z, 0.25, 'sky', 'white', 0.2, 1, 0.3, 1);
        group.remove(w.m);
      }
    }
    for (let i = waves.length - 1; i >= 0; i--) if (waves[i].dead) waves.splice(i, 1);
  }

  // ---- starfall ------------------------------------------------------------------------------
  function callStar() {
    const lv = level('starfall');
    const cands = foes().filter((e) => Math.hypot(e.x - ctl.x, e.z - ctl.z) < 7).sort((a, b) => Math.hypot(a.x - ctl.x, a.z - ctl.z) - Math.hypot(b.x - ctl.x, b.z - ctl.z));
    if (!cands.length) return false;
    const t = cands[0];
    const m = voxelMesh('boons.star');
    m.visible = false;
    group.add(m);
    stars.push({ m, target: t, tx: t.x, tz: t.z, t: 0, aim: 22, fall: 14, sx: 1.6, sy: 7, sz: -1.2, dmg: lv.dmg, r: lv.r });
    boonSfx.starFall();
    proc('starfall', t.x, t.z);
    return true;
  }
  function tickStars() {
    for (const s of stars) {
      s.t++;
      if (s.t <= s.aim) {
        if (s.t < s.aim * 0.7 && s.target && !s.target.dead) { s.tx = s.target.x; s.tz = s.target.z; }
        if (s.t % 4 === 1) addShape(RING, FLOOR, s.tx, 0.02, s.tz, 0.2, 'gold', 'torch', s.r * 1.25, s.r * 0.35, 0.35, 1);
        continue;
      }
      const k = (s.t - s.aim) / s.fall;
      const x = s.tx + s.sx * (1 - k), y = s.sy * (1 - k) + 0.3, z = s.tz + s.sz * (1 - k);
      s.m.visible = true;
      s.pos = { x, y, z };
      for (let j = 0; j < 3; j++) {
        const i = add(x + rr(-0.1, 0.1), y + rr(-0.1, 0.1), z, s.sx * 2, s.sy * 1.2, s.sz * 2, rr(0.25, 0.45), j === 0 ? 2 : 1, 'boltGold', STREAK);
        if (i >= 0) { P.stretch[i] = 0.04; P.drag[i] = 0.9; }
      }
      if (k >= 1) {
        s.dead = true;
        group.remove(s.m);
        vfx.flash(s.tx, 0.6, s.tz, { color: 'gold', size: 1.5 });
        vfx.shockwave(s.tx, s.tz, { radius: s.r * 1.3, color: 'gold', hot: 'white' });
        vfx.embers(s.tx, 0.3, s.tz, { n: 20, spread: 0.5, up: 1.6, palette: 'gold' });
        later(3, () => vfx.shockwave(s.tx, s.tz, { radius: s.r * 0.8, color: 'torch', hot: 'white', dust: false }));
        feedback.shake(4.5, 260);
        feedback.hitstop(70);
        boonSfx.starHit();
        for (const e of foes()) if (Math.hypot(e.x - s.tx, e.z - s.tz) < s.r + (e.r ?? 0.35)) procHit(e, s.dmg, { from: { x: s.tx, z: s.tz }, knock: 6, power: 1.6, crit: true });
      }
    }
    for (let i = stars.length - 1; i >= 0; i--) if (stars[i].dead) stars.splice(i, 1);
  }

  // ---- leech motes ---------------------------------------------------------------------------
  function bleed(x, z, n) {
    for (let k = 0; k < n; k++) {
      const a = rr(0, TAU);
      motes.push({ x, y: 0.7, z, vx: Math.sin(a) * rr(2, 3.5), vy: rr(2.5, 4), vz: Math.cos(a) * rr(2, 3.5), t: -k * 3, pull: 0 });
    }
  }
  function tickMotes() {
    for (const m of motes) {
      m.t++;
      if (m.t < 0) continue;
      if (m.t < 16) {   // burst out and hang
        m.vx *= 0.86; m.vz *= 0.86; m.vy = m.vy * 0.86 - 0.1;
      } else {          // home in
        m.pull = Math.min(14, m.pull + 0.9);
        const dx = ctl.x - m.x, dy = 0.7 - m.y, dz = ctl.z - m.z;
        const d = Math.hypot(dx, dy, dz) || 1;
        m.vx += (dx / d * m.pull - m.vx) * 0.3; m.vy += (dy / d * m.pull - m.vy) * 0.3; m.vz += (dz / d * m.pull - m.vz) * 0.3;
        if (d < 0.3) { m.dead = true; moteIn(); continue; }
      }
      m.x += m.vx * DT; m.y = Math.max(0.1, m.y + m.vy * DT); m.z += m.vz * DT;
      const i = add(m.x, m.y, m.z, 0, 0, 0, 0.04, 3, 'leechMote', SPRITE);
      if (i >= 0) { P.pop[i] = 1; P.fadeAt[i] = 1; P.shrinkAt[i] = 1; }
      const j = add(m.x, m.y, m.z, 0, 0, 0, 0.2, 1, 'leechMote', SPRITE);
      if (j >= 0) { P.pop[j] = 1; P.fadeAt[j] = 0.4; }
    }
    for (let i = motes.length - 1; i >= 0; i--) if (motes[i].dead) motes.splice(i, 1);
  }
  function moteIn() {
    leechMotes++;
    boonSfx.mote();
    addShape(STAR, FACING, ctl.x, 0.75, ctl.z, 0.1, 'red', 'rose', 0.2, 0.3);
    const per = level('leech').per;
    if (leechMotes >= per) {
      leechMotes = 0;
      healHero('leech');
    }
  }
  function healHero(id) {
    const before = health.hp;
    health.heal(1);
    vfx.heal(ctl.x, 0.4, ctl.z, { n: 18 });
    addShape(RING, FLOOR, ctl.x, 0.03, ctl.z, 0.3, 'rose', 'white', 0.2, 1, 0.4, 1);
    look.flash(ctl.x, 0.8, ctl.z, { color: 'rose', ms: 160, intensity: 1.8, radius: 3 });
    boonSfx.heart();
    say(health.hp > before ? '+1 HEART' : 'FULL', ctl.x, 1.8, ctl.z, 'rose', 1, 46);
    proc(id);
  }

  // ---- echo blade ----------------------------------------------------------------------------
  function echo(step, x, z, yaw) {
    const pct = level('echo-blade').pct;
    const spec = COMBO[step];
    const [a0, a1] = swingRange(spec, 3);
    const mirror = spec.mirror ? -1 : 1;
    if (step === 2) vfx.slash(x + Math.sin(yaw) * 0.4, 0.5, z + Math.cos(yaw) * 0.4, yaw, { span: 1.6, radius: 1.1, thick: 0.45, palette: 'cool', life: 0.22 });
    else vfx.slash(x, 0.55, z, yaw, { span: 2.6, radius: 1.25, thick: 0.4, palette: 'cool', mirror, life: 0.22 });
    boonSfx.echo();
    let n = 0;
    for (const e of foes()) {
      if (!sectorHits(x, z, yaw, a0, a1, spec.reach + 0.1, e.x, e.z, e.r ?? 0.35)) continue;
      if (procHit(e, spec.dmg * pct, { from: { x, z }, knock: spec.knock * 0.6, power: 0.8 })) {
        vfx.hitSpark(e.x, 0.6, e.z, { dx: e.x - x, dz: e.z - z, power: 0.7, palette: 'cool', light: false });
        n++;
      }
    }
    if (n) { feedback.hitstop(28); proc('echo-blade', x, z); }
    if (step === 2 && has('moon-wave') && synergyActive('twin-moons')) moonWave(x, z, yaw, true);
  }

  // ---- reaper --------------------------------------------------------------------------------
  function reap(t, from) {
    const x = t.x, z = t.z;
    if (!t.dead && !t.dying) procHit(t, Math.max(1, t.hp), { from, knock: 3, power: 1.5, crit: true });
    const yaw = Math.atan2(x - from.x, z - from.z);
    vfx.slash(x, 0.9, z, yaw + Math.PI / 2, { span: 3.4, radius: 0.85, thick: 0.55, palette: 'rose', life: 0.32 });
    vfx.flash(x, 0.9, z, { color: 'rose', size: 0.9 });
    for (let k = 0; k < 14; k++) {
      const i = add(x + rr(-0.3, 0.3), rr(0.4, 1.2), z + rr(-0.2, 0.2), rr(-0.5, 0.5), rr(1.5, 3.2), rr(-0.3, 0.3), rr(0.7, 1.2), rnd() < 0.3 ? 2 : 1, 'reap', SPRITE);
      if (i >= 0) { P.wob[i] = 4; P.ph[i] = rr(0, TAU); P.drag[i] = 0.96; P.fadeAt[i] = 0.5; P.delay[i] = k * 0.015; }
    }
    feedback.hitstop(60);
    feedback.shake(2.5, 160);
    boonSfx.reap();
    say('REAPED', x, (t.h ?? 1.2) + 0.9, z, 'rose', 1, 50);
    proc('reaper', x, z);
    if (has('leech') && synergyActive('harvest')) { bleed(x, z, 5); healHero('reaper'); }
  }

  // ---- event wiring --------------------------------------------------------------------------
  on('combat:hit', (h) => {
    const t = h.target;
    if (!t || t.noAssist) return;        // props (pots) are not foes
    const crit = crits.delete(t);
    if (crit) {
      addShape(STAR, FACING, h.x, h.y + 0.1, h.z, 0.2, 'gold', 'white', 0.75, 0.25);
      addShape(RING, FACING, h.x, h.y + 0.1, h.z, 0.24, 'torch', 'white', 0.2, 0.9, 0.35, 1);
      vfx.slash(t.x, h.y, t.z, Math.atan2(h.dx, h.dz) + Math.PI / 2, { span: 1.4, radius: 0.5, thick: 0.25, palette: 'ember', life: 0.14, sparks: false });
      look.flash(h.x, h.y, h.z, { color: 'gold', ms: 130, intensity: 2.6, radius: 4 });
      feedback.kick(h.dx, h.dz * 0.77, 2.5);
      boonSfx.crit();
      say('CRIT!', t.x, (t.h ?? 1.2) + 0.8, t.z, 'gold', 1, 38);
      proc('keen-edge', t.x, t.z);
    }
    if (has('kindling')) { ignite(t); proc('kindling', t.x, t.z); }
    if (has('chain-spark')) {
      const lv = level('chain-spark');
      const rod = crit && synergyActive('lightning-rod');
      chain(chest(t), lv.jumps, { exclude: new Set([t]), dmg: lv.dmg, range: lv.range, gold: rod, fork: rod });
    }
    // marks are taken at the start of the tick, so this hit landed on a foe already marked
    if (has('reaper') && marked.has(t)) { marked.delete(t); reap(t, { x: ctl.x, z: ctl.z }); }
    if (has('starfall') && !t.dead) {
      hitCount++;
      if (hitCount >= level('starfall').every) { if (callStar()) hitCount = 0; else hitCount--; }
    }
  });
  on('hero:swing', (e) => {
    if (!has('echo-blade')) return;
    const st = e.step, yaw = anim.pose?.cur?.yaw ?? ctl.face;
    // the ghost stands half a step behind and to the side, so it reads as a second self
    const bx = -Math.sin(yaw) * 0.45 + Math.cos(yaw) * 0.2, bz = -Math.cos(yaw) * 0.45 - Math.sin(yaw) * 0.2;
    const x = ctl.x + bx, z = ctl.z + bz;
    const delay = level('echo-blade').delay;
    const g0 = rig.group.position.clone();
    rig.group.position.x += bx; rig.group.position.z += bz;
    rig.group.updateMatrixWorld(true);
    vfx.core.stampGhost(rig.group, 'ghost', 0.32, delay * DT);
    rig.group.position.copy(g0);
    rig.group.updateMatrixWorld(true);
    later(delay, () => echo(st, x, z, yaw));
  });
  on('hero:slam', (e) => {
    const yaw = anim.pose?.cur?.yaw ?? ctl.face;
    if (has('moon-wave')) moonWave(ctl.x, ctl.z, yaw);
    if (has('heavy-hand')) {
      const lv = level('heavy-hand');
      const x = ctl.x + Math.sin(yaw) * 0.9, z = ctl.z + Math.cos(yaw) * 0.9;
      vfx.shockwave(x, z, { radius: lv.r, color: 'bone', hot: 'white' });
      vfx.land(x, z, { size: 1.3, palette: 'dustWarm' });
      feedback.shake(3.5, 200);
      boonSfx.quake();
      let n = 0;
      for (const f of foes()) if (Math.hypot(f.x - x, f.z - z) < lv.r + (f.r ?? 0.35)) { if (procHit(f, lv.quake, { from: { x, z }, knock: 5 })) n++; }
      if (n) proc('heavy-hand', x, z);
    }
  });
  on('move:dash', (e) => {
    if (has('ember-trail')) { addTrailPoint(e.x, e.z); vfx.embers(e.x, 0.1, e.z, { n: 8, spread: 0.2 }); boonSfx.burn(); }
    if (has('fleet-foot')) vfx.dash(e.x, e.z, e.dx, e.dz, { obj: rig.group, ticks: 9, every: 3, palette: 'ghost' });
  });
  on('move:dashEnd', (e) => {
    if (!has('storm-dash')) return;
    const lv = level('storm-dash');
    const thunder = synergyActive('thunderhead') && has('chain-spark');
    const R = lv.r * (thunder ? 1.5 : 1);
    const x = e.x, z = e.z;
    bolt({ x: x + 0.5, y: 6, z: z - 0.6 }, { x, y: 0.3, z }, false, 12);
    vfx.flash(x, 0.4, z, { color: 'sky', size: 0.9, light: false });
    vfx.shockwave(x, z, { radius: R, color: 'sky', hot: 'white', dust: true });
    look.flash(x, 1.2, z, { color: 'sky', ms: 160, intensity: 3, radius: 5 });
    feedback.shake(2.5, 160);
    boonSfx.zap();
    const hit = foes().filter((f) => Math.hypot(f.x - x, f.z - z) < R).sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z)).slice(0, lv.n);
    for (const f of hit) {
      const to = chest(f);
      bolt({ x, y: 0.6, z }, to);
      bolt({ x: f.x + 0.3, y: 5, z: f.z - 0.4 }, to, false, 9);
      procHit(f, lv.dmg, { from: { x, z }, knock: 3, power: 1 });
      vfx.hitSpark(to.x, to.y, to.z, { dx: f.x - x, dz: f.z - z, power: 0.8, palette: 'cool', light: false });
      if (thunder) chain(to, 1, { exclude: new Set(hit), dmg: level('chain-spark').dmg, range: 3.4, id: 'storm-dash' });
    }
    proc('storm-dash', x, z);
  });
  on('hero:step', (e) => {
    if (!has('fleet-foot')) return;
    for (let k = 0; k < 2; k++) {
      const i = add(e.x + rr(-0.1, 0.1), 0.06, e.z + rr(-0.1, 0.1), rr(-0.8, 0.8), rr(0.8, 1.6), rr(-0.8, 0.8), 0.25, 1, 'wind', SPRITE);
      if (i >= 0) { P.drag[i] = 0.9; P.pop[i] = 1; }
    }
  });
  const onDeath = (e) => {
    const t = e.enemy ?? e.target;
    if (!t || t.noAssist || !Number.isFinite(t.maxHp)) return;
    if (has('leech')) { bleed(e.x, e.z, level('leech').motes); proc('leech', e.x, e.z); }
  };
  on('enemy:death', onDeath);
  on('pickup:shard', (e) => {
    if (has('soul-hunger') && e.step % 3 === 0) addShape(RING, FLOOR, ctl.x, 0.03, ctl.z, 0.22, 'sky', 'white', 0.25, 0.8, 0.3, 1);
  });

  // ---- tick / render / ui --------------------------------------------------------------------
  const v3 = new THREE.Vector3();
  return {
    procs, lastProc, apply, procHit, ignite, chain, moonWave, callStar,
    get ward() { return ward; },
    get leechMotes() { return leechMotes; },
    get hitCount() { return hitCount; },
    get marked() { return marked; },
    get burning() { return burns.size; },
    tick() {
      tick++;
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].at <= tick) { const q = queue.splice(i, 1)[0]; q.fn(); }
      crits.clear();
      // reaper marks
      marked.clear();
      if (has('reaper')) for (const e of foes()) if (Number.isFinite(e.maxHp) && e.maxHp > 0 && e.hp / e.maxHp <= level('reaper').under) marked.add(e);
      tickBurns();
      tickTrail();
      tickOrbs();
      tickWard();
      tickWaves();
      tickStars();
      tickMotes();
      // fleet foot: wind peeling off the hero while running
      if (has('fleet-foot') && ctl.speed > 2.4 && tick % 2 === 0) {
        const sp = Math.hypot(ctl.vx, ctl.vz) || 1;
        const i = add(ctl.x + rr(-0.2, 0.2), rr(0.25, 1.05), ctl.z + rr(-0.15, 0.15), -ctl.vx / sp * 3, 0, -ctl.vz / sp * 3, rr(0.12, 0.2), 1, 'wind', STREAK);
        if (i >= 0) { P.stretch[i] = 0.06; P.drag[i] = 0.9; }
      }
      for (const b of bolts) { b.t++; if (b.t % 2 === 0) b.seed = Math.floor(rnd() * 1e6); }
      for (let i = bolts.length - 1; i >= 0; i--) if (bolts[i].t >= bolts[i].life) bolts.splice(i, 1);
      for (const l of labels) l.t++;
      for (let i = labels.length - 1; i >= 0; i--) if (labels[i].t >= labels[i].life) labels.splice(i, 1);
    },
    render(alpha) {
      for (const o of orbs) {
        v3.set(o.px + (o.x - o.px) * alpha, o.py + (o.y - o.py) * alpha, o.pz + (o.z - o.pz) * alpha);
        look.snap(v3);
        o.m.position.copy(v3);
        o.m.rotation.y = Math.round(((loop.tick + alpha) * 0.15) / (Math.PI / 2)) * (Math.PI / 2);
      }
      renderWard(alpha);
      for (const w of waves) {
        v3.set(w.px + (w.x - w.px) * alpha, 0.25, w.pz + (w.z - w.pz) * alpha);
        look.snap(v3);
        w.m.position.copy(v3);
        w.m.rotation.y = w.yaw;
      }
      for (const s of stars) if (s.pos) {
        v3.set(s.pos.x, s.pos.y, s.pos.z);
        look.snap(v3);
        s.m.position.copy(v3);
        s.m.rotation.z = Math.round(s.t * 0.6) * 0.4;
      }
      renderTrail();
    },
    ui(g) {
      const z = display.zoom;
      // lightning
      for (const b of bolts) {
        if (b.t > b.life * 0.6 && b.t % 2) continue;      // it flickers out
        const A = display.worldToScreen(b.a.x, b.a.y, b.a.z), B = display.worldToScreen(b.b.x, b.b.y, b.b.z);
        const pts = jag(A, B, b.seed);
        const hot = b.t < 2;
        const main = css(hot ? 'white' : b.gold ? 'gold' : b.t < b.life * 0.5 ? 'sky' : 'cyan');
        const w = (z >= 2 ? 3 : 2) + (hot ? 1 : 0);
        poly(g, pts, w + 2, css('ink'));
        poly(g, pts, w, main);
        if (!hot && b.t < 5) poly(g, pts, Math.max(1, w - 2), css('white'));
        if (hot) { g.fillStyle = css('white'); for (const p of [pts[0], pts[pts.length - 1]]) g.fillRect(p.x - 3 * z, p.y - 3 * z, 6 * z + 1, 6 * z + 1); }
        // a fork off the middle
        if (b.t < b.life * 0.5 && pts.length > 4) {
          const m = pts[3], ang = Math.atan2(B.y - A.y, B.x - A.x) + ((b.seed & 1) ? 0.7 : -0.7);
          const L = Math.hypot(B.x - A.x, B.y - A.y) * 0.25;
          const f = jag(m, { x: m.x + Math.cos(ang) * L, y: m.y + Math.sin(ang) * L }, b.seed + 7, 2);
          poly(g, f, w + 2, css('ink')); poly(g, f, w, main);
        }
      }
      // reaper marks: a skull hanging over each marked foe
      if (marked.size) for (const e of marked) {
        const p = display.worldToScreen(e.x, (e.h ?? 1.2) + 0.55, e.z);
        const bob = Math.round(Math.sin(loop.tick * 0.15) * 1);
        const blink = loop.tick % 30 < 4;
        drawIcon(g, 'skull', p.x - 9 * z, p.y - 12 * z + bob, { scale: z, tint: blink ? 'white' : null, outline: 'plum' });
      }
      // words
      for (const l of labels) {
        const p = display.worldToScreen(l.x, l.y, l.z);
        const rise = l.t < 5 ? l.t * 3 : 15 + (l.t - 5) * 0.25;
        if (l.t > l.life - 10 && l.t % 4 < 2) continue;
        const sc = Math.min(4, (l.scale + (z >= 2 ? 1 : 0)) + (l.t < 3 ? 1 : 0));
        drawText(g, l.text, p.x, Math.round(p.y - rise), l.t < 2 ? 'white' : l.color, { align: 'center', scale: sc, outline: 'ink' });
      }
    },
    info() {
      return {
        procs: { ...procs }, burning: burns.size, trail: trail.length, orbs: orbs.length, ward: ward.meshes.length ? (ward.up ? 'up' : `regrow ${ward.regrowT}`) : null,
        waves: waves.length, stars: stars.length, motes: motes.length, leechMotes, hitCount, marked: marked.size,
      };
    },
    dispose() {
      offs.forEach((f) => f()); offs.length = 0;
      ctl.T.speed = baseT.speed; ctl.T.dashCooldown = baseT.dashCooldown;
      if (combat.modHit) combat.modHit = null;
      if (health.guard) health.guard = null;
      root.remove(group);
      tileGeo.dispose(); tileMat.dispose();
    },
  };
}

// ---- 2D lightning helpers -------------------------------------------------------------------
function jag(A, B, sd, depth = 4) {
  let s = sd | 0 || 1;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647 - 0.5; };
  let pts = [{ x: A.x, y: A.y }, { x: B.x, y: B.y }];
  let amp = Math.hypot(B.x - A.x, B.y - A.y) * 0.3;
  for (let d = 0; d < depth; d++) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      const nx = -(q.y - p.y), ny = q.x - p.x, l = Math.hypot(nx, ny) || 1;
      const o = (r() < 0 ? -1 : 1) * (0.45 + Math.abs(r())) * amp;   // always kink, never a gentle curve
      out.push({ x: mx + nx / l * o, y: my + ny / l * o }, q);
    }
    pts = out;
    amp *= 0.5;
  }
  return pts.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}
function poly(g, pts, w, color) {
  g.fillStyle = color;
  const o = Math.floor(w / 2);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    for (let k = 0; k <= n; k++) {
      const t = n ? k / n : 0;
      g.fillRect(Math.round(a.x + (b.x - a.x) * t) - o, Math.round(a.y + (b.y - a.y) * t) - o, w, w);
    }
  }
}
