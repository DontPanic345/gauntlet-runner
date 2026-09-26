// ?showcase=combat : the hero in a crypt training yard against three straw dummies and one
// sparring dummy that hits back, slowly. Each dummy shows its hit count and how far the last
// hit knocked it; the combo timeline (bottom left) shows the attack phases, the chain window
// and every press.
//
// It starts in DEMO: an autopilot drives the real controller and combat code with keyboard-
// style presses: full combos on one dummy, one swing through two dummies, getting hit, dashing
// through a swing on i-frames, and a counter-combo. Any key or click takes over (LIVE).
//
// Params:  &auto=0            start LIVE, hero facing dummy A
//          &at=combo|cleave|hurt|dodge|counter   start the demo at a station
//          &zoom=1..3         (default 2; 1 = game scale)
//          &slow=<s>          time scale, e.g. 0.25
//          &hitboxes=1        draw the active swing's hitbox and the targets' hurt circles
//          &spar=0            the sparring dummy never attacks
//          &numbers=0         no damage numbers       &hud=0  no labels at all (clean stills)
// Keys:    WASD/arrows move  J attack  K/Space dash  B restart demo  X hitboxes  R reset dummies
//          Z zoom  T slow-mo  H hud  P/Esc pause

import * as THREE from 'three';
import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { input } from '../core/input.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { rng, Rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { buildStage } from '../core/stage.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { defineModel, voxelMesh, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { CollisionWorld, setCollision } from '../core/collision.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim, ATTACKS } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth, COMBO, RULES } from './combat.js';
import { createCombatFx } from './fx.js';
import './sfx.js';
import { TrainingDummy, SparringDummy, SPAR } from './dummy.js';

const V = VOXEL;
const ROOM = { minX: -6.5, maxX: 6.5, minZ: -4.5, maxZ: 4.5 };
const SLOWS = [1, 0.5, 0.25, 0.1];
const TORCHES = [[-5.7, -3.8], [5.7, -3.8], [-5.7, 3.7], [5.7, 3.7], [-1.2, -4.0], [1.9, 3.9]];
const DUMMIES = [
  { id: 'A', x: -2.6, z: -0.5 },
  { id: 'B', x: 0.45, z: -1.95 },
  { id: 'C', x: 1.65, z: -1.95 },
];
const SPAR_AT = { id: 'S', x: 3.1, z: 1.25 };
const START = [-1.35, -0.5, -Math.PI / 2];

const hash = (x, y, z = 0) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

let modelsBuilt = false;
function buildModels() {
  if (modelsBuilt) return;
  modelsBuilt = true;
  const W = (ROOM.maxX - ROOM.minX) * 8, Dp = (ROOM.maxZ - ROOM.minZ) * 8;
  const g = new VoxelGrid(W, 5, Dp);
  const r = new Rng('combat.floor');
  g.box(0, 0, 0, W - 1, 1, Dp - 1, 'stoneDark');
  for (let tz = 0; tz < Math.ceil(Dp / 12); tz++) for (let tx = 0; tx < Math.ceil(W / 12); tx++) {
    const shade = r.weighted([['stone', 8], ['dusk', 3], ['stoneLight', 1]]);
    for (let z = 1; z < 12; z++) for (let x = 1; x < 12; x++) {
      const X = tx * 12 + x + ((tz % 2) ? 6 : 0) - 6, Z = tz * 12 + z;
      if (X < 0 || X >= W || Z >= Dp) continue;
      const cx = x === 1 || x === 11, cz = z === 1 || z === 11;
      if (cx && cz && r.chance(0.5)) continue;
      let c = shade;
      const f = r.next();
      if (f < 0.025) c = 'stoneLight'; else if (f < 0.05) c = 'stoneDark';
      g.set(X, 2, Z, c);
    }
  }
  // sawdust scuffs under the dummies (worn training ground)
  for (const d of [...DUMMIES, SPAR_AT]) {
    const X0 = Math.round((d.x - ROOM.minX) * 8), Z0 = Math.round((d.z - ROOM.minZ) * 8);
    for (let z = -12; z <= 12; z++) for (let x = -14; x <= 14; x++) {
      const dd = Math.hypot(x / 1.2, z);
      if (dd > 11 || hash(X0 + x, Z0 + z, 3) > (1 - dd / 11) * 0.55) continue;
      if (g.get(X0 + x, 2, Z0 + z)) g.set(X0 + x, 2, Z0 + z, hash(x, z, 8) < 0.5 ? 'dirt' : 'wood');
    }
  }
  // curb: a low stone lip round the yard
  for (let z = 0; z < Dp; z++) for (let x = 0; x < W; x++) {
    const e = x < 2 || z < 2 || x >= W - 2 || z >= Dp - 2;
    if (!e) continue;
    const h = z >= Dp - 2 ? 3 : 4;   // the front lip is lower so it never hides feet
    for (let y = 2; y <= h; y++) g.set(x, y, z, y === h ? (hash(x, z, 1) < 0.2 ? 'stone' : 'stoneLight') : 'stone');
  }
  defineModel('combat.floor', { grid: g, origin: [W / 2, 3, Dp / 2] });
}

export default function combatShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  let auto = P('auto', '1') !== '0';
  const at = P('at', null);
  let zoom = Math.max(1, Math.min(3, parseInt(P('zoom', '2'), 10) || 2));
  let hud = P('hud', '1') !== '0';
  let showHit = P('hitboxes', '0') === '1';
  const sparOn = P('spar', '1') !== '0';
  const numbersOn = P('numbers', '1') !== '0';
  const slowP = parseFloat(P('slow', '1'));
  let slowIdx = Math.max(0, SLOWS.indexOf(slowP));
  let customSlow = SLOWS.includes(slowP) ? null : slowP;

  let root, stage, rig, anim, ctl, cam, health, combat, cfx, cw;
  let dummies = [], spar = null;
  let offs = [];
  let deadT = -1;
  const status = { text: '', until: 0 };
  const say = (t) => { status.text = t; status.until = loop.realTime + 1.2; };
  const hurtFlash = { t: 99 };

  // ---- autopilot ------------------------------------------------------------------------
  const pilot = {
    i: 0, t: 0, label: '', mv: { x: 0, z: 0 }, want: {}, timeouts: [],
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };
  const U = [0, -1], R = [1, 0], L = [-1, 0];
  const combo = [{ atk: 1 }, { wait: 13 }, { atk: 1 }, { wait: 13 }, { atk: 1 }];
  const ROUTE = [
    { st: 'combo', label: 'FULL COMBO' },
    { tp: START }, { heal: 1 }, { wait: 40 }, ...combo, { wait: 45 }, { near: 'A' }, { wait: 8 }, ...combo, { wait: 45 },
    { label: 'SLOW MOTION  X0.25' }, { near: 'A' }, { slow: 0.25 }, { wait: 6 }, ...combo, { wait: 60 }, { slow: 1 }, { wait: 20 },
    { st: 'cleave', label: 'ONE SWING, TWO TARGETS' },
    { to: [1.05, -0.62] }, { face: U }, { wait: 24 }, ...combo, { wait: 70 },
    { st: 'hurt', label: 'GETTING HIT' },
    { to: [2.15, 0.35] }, { face: R }, { until: () => spar.state === 'recover', max: 400 }, { wait: 50 },
    { st: 'dodge', label: 'DASH THROUGH THE SWING' },
    { until: () => spar.state === 'windup' && spar.st >= SPAR.windup - 3, max: 400 }, { dash: R }, { wait: 40 },
    { st: 'counter', label: 'COUNTER' },
    { to: [3.05, 0.08] }, { face: U }, { wait: 6 }, ...combo, { wait: 50 }, { to: [START[0], START[1]] },
  ];
  const STATIONS = Object.fromEntries(ROUTE.map((s, i) => [s.st, i]).filter(([k]) => k));
  const STATION_POS = { combo: START, cleave: [1.05, -0.62, Math.PI], hurt: [2.15, 0.35, Math.PI / 2], dodge: [2.15, 0.35, Math.PI / 2], counter: [3.05, 0.08, Math.PI] };

  function startDemo(st = 'combo') {
    auto = true;
    ctl.source = pilot;
    pilot.i = STATIONS[st] ?? 0; pilot.t = 0; pilot.mv = { x: 0, z: 0 }; pilot.want = {};
    const p = STATION_POS[st] ?? START;
    ctl.teleport(p[0], p[1], p[2]);
    cam.reset(p[0], p[1]);
    health.hp = health.maxHp;
  }
  function goLive() {
    if (!auto) return;
    auto = false;
    ctl.source = input;
    pilot.mv = { x: 0, z: 0 };
    if (customSlow === null) loop.setTimeScale(SLOWS[slowIdx]);
    say('LIVE');
  }
  function pilotStep() {
    const s = ROUTE[pilot.i];
    pilot.mv = { x: 0, z: 0 };
    const next = () => { pilot.i = (pilot.i + 1) % ROUTE.length; pilot.t = 0; };
    pilot.t++;
    if (s.label !== undefined && !s.to) { pilot.label = s.label; next(); return pilotStep(); }
    if (s.tp) { ctl.teleport(s.tp[0], s.tp[1], s.tp[2]); next(); return; }
    if (s.heal) { health.hp = health.maxHp; next(); return pilotStep(); }
    if (s.slow) { loop.setTimeScale(s.slow); next(); return pilotStep(); }
    if (s.wait) { if (pilot.t >= s.wait) next(); return; }
    if (s.atk) { pilot.want.attack = true; next(); return; }
    if (s.face) { pilot.mv = { x: s.face[0], z: s.face[1] }; next(); return; }
    if (s.dash) { pilot.mv = { x: s.dash[0], z: s.dash[1] }; pilot.want.dash = true; next(); return; }
    if (s.until) { if (s.until() || pilot.t > s.max) { if (pilot.t > s.max) pilot.timeouts.push(pilot.i); next(); } return; }
    if (s.near) {
      // walk up to a dummy, stopping at a comfortable swing distance, then face it
      const d = world.enemies.find((e) => e.id === s.near);
      let dx = d.x - ctl.x, dz = d.z - ctl.z;
      const dist = Math.hypot(dx, dz);
      dx /= dist; dz /= dist;
      if (dist < 1.25 || pilot.t > 300) { pilot.mv = { x: dx, z: dz }; next(); return; }
      const k = Math.min(1, (dist - 1.2) / 0.35);
      pilot.mv = { x: dx * Math.max(0.3, k), z: dz * Math.max(0.3, k) };
      return;
    }
    if (s.to) {
      const dx = s.to[0] - ctl.x, dz = s.to[1] - ctl.z, d = Math.hypot(dx, dz);
      if (d < 0.08 || pilot.t > 400) { if (pilot.t > 400) pilot.timeouts.push(pilot.i); next(); return; }
      const k = Math.min(1, d / 0.35);   // ease in like a stick being let off
      pilot.mv = { x: (dx / d) * k, z: (dz / d) * k };
    }
  }

  // ---- camera limits for the zoom -----------------------------------------------------
  function camBounds() {
    const hw = display.width / (2 * PPU * zoom), hd = display.height / (2 * PPU * zoom * Math.sin(CAMERA_PITCH));
    const bx = Math.max(0, (ROOM.maxX - ROOM.minX) / 2 - hw + 0.4), bz = Math.max(0, (ROOM.maxZ - ROOM.minZ) / 2 - hd + 0.6);
    return { minX: -bx, maxX: bx, minZ: -bz - 0.2, maxZ: bz };
  }
  function setZoom(z) { zoom = z; display.setZoom(zoom); if (cam) cam.bounds = camBounds(); }

  function resetDummies() {
    for (const d of [...dummies, spar]) { d.x = d.px = d.home.x; d.z = d.pz = d.home.z; d.vx = d.vz = d.vy = d.y = 0; d.hits = 0; d.knockDist = 0; d.hop = null; d.lastDmg = 0; }
  }

  const targets = () => world.enemies;

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      buildModels();
      if (customSlow !== null && Number.isFinite(customSlow)) loop.setTimeScale(customSlow); else loop.setTimeScale(SLOWS[slowIdx]);

      const floor = voxelMesh('combat.floor');
      root.add(floor);
      cw = new CollisionWorld();
      cw.addBox(ROOM.minX - 1, ROOM.minZ - 1, ROOM.maxX + 1, ROOM.minZ + 0.25, 'wall');
      cw.addBox(ROOM.minX - 1, ROOM.maxZ - 0.25, ROOM.maxX + 1, ROOM.maxZ + 1, 'wall');
      cw.addBox(ROOM.minX - 1, ROOM.minZ, ROOM.minX + 0.25, ROOM.maxZ, 'wall');
      cw.addBox(ROOM.maxX - 0.25, ROOM.minZ, ROOM.maxX + 1, ROOM.maxZ, 'wall');
      stage = buildStage(root, { floor: false, torches: TORCHES, rng: rng.fork('combat-stage'), dustBox: [6.5, 2.5, 4.5] });
      for (const [x, z] of TORCHES) cw.addCircle(x, z, 0.22, 'torch');
      setCollision(cw);

      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: START[0], z: START[1], yaw: START[2] });
      ctl = new HeroController({ x: START[0], z: START[1], yaw: START[2], anim, collision: cw, source: auto ? pilot : input });
      health = new HeroHealth({ ctl, anim, rig, hp: 5 });
      combat = new HeroCombat({ ctl, anim, health, targets });
      world.hero = health;
      world.room = { index: 0, kind: 'showcase', id: 'combat' };
      cam = new CameraRig({});
      setZoom(zoom);
      cam.reset(START[0], START[1]);

      const bounds = { minX: ROOM.minX + 0.3, maxX: ROOM.maxX - 0.3, minZ: ROOM.minZ + 0.3, maxZ: ROOM.maxZ - 0.3 };
      dummies = DUMMIES.map((d) => new TrainingDummy(root, { ...d, bounds }));
      spar = new SparringDummy(root, { ...SPAR_AT, yaw: -2.3, bounds, health });
      if (!sparOn) spar.cool = Infinity;
      for (const d of [...dummies, spar]) d.attachCollider(cw);
      world.enemies = [...dummies, spar];

      cfx = createCombatFx(root, { numbers: numbersOn });

      const on = (name, fn) => offs.push(events.on(name, fn));
      on('input:press', (e) => { if (auto && e.action !== 'pause') goLive(); });
      on('hero:dead', () => { deadT = 0; });
      on('combat:heroHurt', () => { hurtFlash.t = 0; });
      on('combat:dummyLand', (e) => { if (e.v > 1.5) cfx.ring(e.x, e.z, 0.5, 10, 'mist', 2.5); });

      // debug.spawn('dummy' | 'sparring', x, z) while this showcase runs
      debug.handle('spawn', (type, x, z) => {
        if (type !== 'dummy' && type !== 'sparring') return { ok: false, error: `the combat showcase spawns 'dummy' or 'sparring', not "${type}"` };
        const d = type === 'dummy' ? new TrainingDummy(root, { id: `D${world.enemies.length}`, x, z, bounds })
          : new SparringDummy(root, { id: `S${world.enemies.length}`, x, z, bounds, health });
        d.attachCollider(cw);
        if (type === 'dummy') dummies.push(d);
        world.enemies.push(d);
        return { ok: true, id: d.id };
      });

      if (auto) startDemo(at && STATIONS[at] !== undefined ? at : 'combo');
      else if (at && STATION_POS[at]) { const p = STATION_POS[at]; ctl.teleport(p[0], p[1], p[2]); cam.reset(p[0], p[1]); }
    },

    exit() {
      offs.forEach((f) => f()); offs = [];
      cfx?.dispose();
      for (const d of world.enemies) d.dispose?.();
      loop.setTimeScale(1);
      setCollision(null);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },

    frame() {
      const k = input.ui.key;
      if (k('KeyB')) { startDemo('combo'); say('DEMO'); }
      if (k('KeyX')) { showHit = !showHit; say(showHit ? 'HITBOXES ON' : 'HITBOXES OFF'); }
      if (k('KeyR')) { resetDummies(); say('DUMMIES RESET'); }
      if (k('KeyZ')) { setZoom(zoom >= 3 ? 1 : zoom + 1); say(`ZOOM ${zoom}X`); }
      if (k('KeyT')) { customSlow = null; slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) hud = !hud;
    },

    tick() {
      stage.tick();
      if (auto) pilotStep();
      combat.tick();
      cam.tick(ctl);
      for (const d of world.enemies) d.tick();
      cfx.tick();
      hurtFlash.t++;
      if (deadT >= 0 && ++deadT > 50) {
        deadT = -1;
        ctl.teleport(START[0], START[1], START[2]);
        health.revive();
        say('BACK ON YOUR FEET');
      }
    },

    render(alpha) {
      anim.render(alpha);
      health.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y, off.z);
      for (const d of world.enemies) d.render(alpha);
      stage.render(alpha);
      cfx.render(alpha);
    },

    ui(g) {
      const W = display.width, H = display.height;
      if (showHit) drawHitboxes(g, combat, spar);
      cfx.ui(g);
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, 30, 'gold', { align: 'center', outline: 'ink' });
      if (!hud) return;

      // dummy plates: hit count (pops on a hit) and the last knockback distance
      for (const d of world.enemies) {
        const p = display.worldToScreen(d.x, 2.45 + d.y, d.z);
        const f = display.worldToScreen(d.x, 0, d.z + 0.55);
        const pop = d.hitPop < 4 && d.hits > 0;
        drawText(g, `${d.hits}`, p.x, p.y - (pop ? 16 : 10), pop ? 'white' : 'bone', { align: 'center', scale: pop ? 2 : 1, outline: 'ink' });
        drawText(g, d === spar ? `SPARRING ${d.id}` : `DUMMY ${d.id}`, f.x, f.y + 2, 'slate', { align: 'center', shadow: 'ink' });
        if (d.knockDist > 0.01) drawText(g, `KNOCK ${d.knockDist.toFixed(2)}`, f.x, f.y + 11, 'mist', { align: 'center', shadow: 'ink' });
      }

      drawText(g, 'COMBAT', 8, 8, 'bone', { outline: 'ink' });
      if (auto) {
        drawText(g, 'DEMO  (ANY KEY: TAKE OVER)', 8, 18, 'mist', { shadow: 'ink' });
        if (pilot.label) drawText(g, pilot.label, W / 2, 8, 'bone', { align: 'center', scale: 2, outline: 'ink' });
      } else drawText(g, 'LIVE  (B: DEMO)', 8, 18, 'leaf', { shadow: 'ink' });

      // hero hp, top right: pips that shake and flash on a hurt
      const hp = health.hp, mx = health.maxHp;
      const pw = 9, gap = 3, px0 = W - 8 - mx * (pw + gap) + gap;
      const shakeX = hurtFlash.t < 8 ? ((hurtFlash.t % 2) ? 1 : -1) : 0;
      for (let i = 0; i < mx; i++) {
        const x = px0 + i * (pw + gap) + shakeX, y = 8;
        g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, pw + 2, pw + 2);
        const lost = i >= hp, justLost = i === hp && hurtFlash.t < 10;
        g.fillStyle = css(justLost ? (hurtFlash.t % 4 < 2 ? 'white' : 'red') : lost ? 'shadow' : 'red');
        g.fillRect(x, y, pw, pw);
        if (!lost) { g.fillStyle = css('rose'); g.fillRect(x + 1, y + 1, 3, 2); }
      }
      const inf = combat.info();
      let ry = 22;
      const row = (t, c) => { drawText(g, t, W - 8, ry, c, { align: 'right', shadow: 'ink' }); ry += 10; };
      if (health.dead) row('DOWN', 'red');
      else if (health.iframeT > 0) row('I-FRAMES (HURT)', 'rose');
      else if (ctl.invulnerable) row('I-FRAMES (DASH)', 'cyan');
      else ry += 10;
      row(`HITS ${inf.hits}  WHIFFS ${inf.whiffs}`, 'mist');
      if (loop.timeScale !== 1) row(`X${loop.timeScale}`, 'gold');

      drawTimeline(g, 8, H - 58, combat, anim, combat.log.filter((e) => e.kind === 'press').map((e) => e.tick));

      const help = 'WASD MOVE  J ATTACK  K DASH  B DEMO  X HITBOXES  R RESET  Z ZOOM  T SLOW  H HUD';
      const w = textWidth(help) + 8;
      g.fillStyle = css('ink');
      g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
      drawText(g, help, W / 2, H - 10, 'slate', { align: 'center' });
    },

    state() {
      return { showcase: { id: 'combat', mode: auto ? 'demo' : 'live', step: pilot.i, label: pilot.label, timeouts: pilot.timeouts.slice(-8), zoom: display.zoom,
        combat: combat.info(), health: health.info(), hero: ctl.info(), anim: anim.info(),
        dummies: world.enemies.map((d) => d.info()) } };
    },
  };
}

// ---- the combo timeline: phases of the current attack, the chain window, presses -----------
function drawTimeline(g, x, y, combat, anim, presses) {
  const inf = combat.info();
  const names = ['SLASH', 'BACKHAND', 'OVERHEAD'];
  // three step pips
  let cx = x;
  for (let i = 0; i < 3; i++) {
    const on = inf.step === i, last = inf.step < 0 && inf.lastStep === i && inf.chainOpen;
    const w = textWidth(names[i]) + 8;
    g.fillStyle = css('ink'); g.fillRect(cx - 1, y - 1, w + 2, 12);
    g.fillStyle = css(on ? (i === 2 ? 'gold' : 'frost') : last ? 'slate' : 'shadow');
    g.fillRect(cx, y, w, 10);
    drawText(g, names[i], cx + 4, y + 2, on ? 'ink' : last ? 'bone' : 'mist');
    cx += w + 4;
  }
  // bar: windup / active / recover of the current (or last) attack, one px column per tick, x2
  const step = inf.step >= 0 ? inf.step : inf.lastStep;
  if (step < 0) return;
  const a = ATTACKS[step];
  const S = 3;  // px per tick
  const by = y + 16, total = a.total + RULES.linger;
  g.fillStyle = css('ink'); g.fillRect(x - 1, by - 1, total * S + 2, 9);
  const seg = (t0, t1, c, h = 7, dy = 0) => { g.fillStyle = css(c); g.fillRect(x + t0 * S, by + dy, (t1 - t0) * S, h); };
  seg(0, a.windup, 'slate');
  seg(a.windup, a.windup + a.active, 'white');
  seg(a.windup + a.active, a.total, 'dusk');
  // chain window: from the cancel tick through the linger (a press anywhere during the attack queues)
  if (step < 2) seg(a.cancel, total, 'leaf', 2, 5);
  else seg(a.cancel, a.total, 'gold', 2, 5);
  drawText(g, step < 2 ? 'NEXT HIT CHAINS HERE' : 'COMBO RESETS', x + a.cancel * S, by + 10, step < 2 ? 'leaf' : 'gold', { shadow: 'ink' });
  // playhead
  const t = inf.t >= 0 ? inf.t : a.total + Math.min(RULES.linger, inf.sinceEnd);
  g.fillStyle = css('gold'); g.fillRect(x + Math.min(total, t) * S, by - 3, 1, 13);
  // presses since this attack began (relative ticks)
  const startTick = loop.tick - Math.max(0, t);
  g.fillStyle = css('rose');
  for (const p of presses) {
    const rt = p - startTick;
    if (rt < 0 || rt > total) continue;
    g.fillRect(x + rt * S - 1, by - 5, 3, 3);
  }
}

// ---- hitbox overlay ------------------------------------------------------------------------
function drawHitboxes(g, combat, spar) {
  for (const t of world.enemies) circle(g, t.x, t.z, t.r, 'fog');
  const hb = combat.debugHitbox;
  if (hb) sector(g, hb.x, hb.z, hb.yaw, hb.a0, hb.a1, hb.reach, 'gold');
  if (spar && (spar.state === 'windup' || spar.state === 'swing')) sector(g, spar.x, spar.z, spar.yaw, -SPAR.halfAngle, SPAR.halfAngle, SPAR.reach + 0.3, 'rose');
  const h = world.hero;
  if (h) circle(g, h.x, h.z, 0.3, 'cyan');
}
function sector(g, x, z, yaw, a0, a1, reach, color) {
  g.fillStyle = css(color);
  const pts = [];
  const n = Math.max(8, Math.round((a1 - a0) / 6));
  for (let i = 0; i <= n; i++) {
    const a = yaw + (a0 + (a1 - a0) * (i / n)) * Math.PI / 180;
    pts.push(display.worldToScreen(x + Math.sin(a) * reach, 0.05, z + Math.cos(a) * reach));
  }
  const c = display.worldToScreen(x, 0.05, z);
  dots(g, c, pts[0]); dots(g, c, pts[pts.length - 1]);
  for (let i = 1; i < pts.length; i++) dots(g, pts[i - 1], pts[i]);
}
function circle(g, x, z, r, color) {
  g.fillStyle = css(color);
  const pts = [];
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; pts.push(display.worldToScreen(x + Math.sin(a) * r, 0.05, z + Math.cos(a) * r)); }
  for (let i = 1; i < pts.length; i++) dots(g, pts[i - 1], pts[i]);
}
function dots(g, a, b) {
  const n = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  for (let i = 0; i <= n; i++) g.fillRect(Math.round(a.x + (b.x - a.x) * (i / (n || 1))), Math.round(a.y + (b.y - a.y) * (i / (n || 1))), 1, 1);
}
