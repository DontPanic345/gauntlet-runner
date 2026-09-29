// ?showcase=enemies : the cast.
//
// LINEUP (default): all four archetypes side by side in a lit crypt, named, looping through
// the same beats together so they can be compared: SPAWN, IDLE, MOVE, ATTACK (telegraph then
// strike; the windups are timed so all four tells are on screen at once, then all four land
// together), HURT (two hits each; the second is a finisher, which staggers even the brute),
// DEATH. Each one's current state is labelled under its name. They are puppets here: the
// real archetype code, driven by the showcase instead of by their AI.
//
// FIGHT (&fight=<type>): the hero in the arena against real AI: husk | wisp | brute | mite
// (one) | mites (a swarm of 5) | wave (2 husks, a swarm, a wisp and a brute: separation,
// flanking and attack tokens). A DEMO autopilot fights with keyboard-style input: it attacks,
// dashes out of most telegraphs, and lets some land so you see both. Any key takes over (LIVE).
// When everything is dead, the same group spawns again.
//
// Params:  &phase=spawn|idle|move|attack|hurt|death   lineup: hold one beat, looping
//          &only=husk|wisp|brute|mite                 lineup: one archetype, centred, closer
//          &fight=husk|wisp|brute|mite|mites|wave     the fight mode
//          &auto=0              fight: start LIVE (default DEMO)
//          &zoom=1..3           (lineup default 2, only 3; fight default 2)
//          &slow=<s>            time scale, e.g. 0.25
//          &hud=0               no labels (clean stills)      &numbers=0  no damage numbers
// Keys:    lineup: 1-6 pick a beat, L hold/loop, Space restart the beat
//          fight:  WASD move, J attack, K dash, B demo, R respawn, 1-6 pick the fight
//          both:   Z zoom, T slow-mo, H hud, P/Esc pause
// state().showcase = { id, mode, phase, t, hold, fight, enemies: [...info] }

import * as THREE from 'three';
import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { input } from '../core/input.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { feedback } from '../core/feedback.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { defineModel, voxelMesh, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import '../render/showcase-models.js';
import { CollisionWorld, setCollision } from '../core/collision.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import '../combat/sfx.js';
import { vfx } from '../vfx/vfx.js';
import { createEnemies, spawnHandler, ENEMY_DATA } from './index.js';

const V = VOXEL;
const ROOM = { minX: -7, maxX: 7, minZ: -4.6, maxZ: 3.0 };   // walkable floor
const SLOWS = [1, 0.5, 0.25, 0.1];
const PHASES = [
  { id: 'spawn', label: 'SPAWN', note: 'EACH ARRIVES ITS OWN WAY', dur: 150 },
  { id: 'idle', label: 'IDLE', note: 'NOTHING IS EVER STILL', dur: 140 },
  { id: 'move', label: 'MOVE', note: 'SHAMBLE, DRIFT, STOMP, SCUTTLE', dur: 230 },
  { id: 'attack', label: 'TELEGRAPH + ATTACK', note: 'THE FLOOR MARK IS THE HITBOX. FILL = TIME LEFT', dur: 330 },
  { id: 'hurt', label: 'HURT', note: 'A HIT, THEN A FINISHER (EVEN THE BRUTE STAGGERS)', dur: 150 },
  { id: 'death', label: 'DEATH', note: 'FLOP, GUTTER, TOPPLE, POP', dur: 150 },
];
const CAST = [
  { kind: 'husk', x: -3.8 },
  { kind: 'wisp', x: -1.3 },
  { kind: 'brute', x: 1.3 },
  { kind: 'mite', x: 3.85 },
];
const LINE_Z = -2.0;
const FIGHTS = ['husk', 'wisp', 'brute', 'mites', 'wave', 'mite'];

const hash = (x, y, z = 0) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

// a low stone curb across the front of the arena (the brute crashes into it)
let built = false;
function buildModels() {
  if (built) return;
  built = true;
  const W = 116, D = 4, H = 4;
  const g = new VoxelGrid(W, H, D);
  for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) {
    const h = 3 + (hash(Math.floor(x / 6), 1) < 0.3 ? 1 : 0);
    for (let y = 0; y < h; y++) {
      const course = y, joint = (x + (course % 2) * 3) % 6 === 5;
      g.set(x, y, z, y === h - 1 ? (hash(x, z, 2) < 0.2 ? 'stone' : 'stoneLight') : joint ? 'stoneDark' : (hash(Math.floor(x / 6), y) < 0.5 ? 'stone' : 'dusk'));
    }
  }
  defineModel('enemies.sc.curb', { grid: g, origin: [W / 2, 0, 0] });
  const post = new VoxelGrid(6, 7, 6);
  post.box(0, 0, 0, 5, 5, 5, 'stone'); post.box(0, 6, 0, 5, 6, 5, 'stoneLight'); post.box(1, 0, 5, 4, 5, 5, 'dusk');
  defineModel('enemies.sc.post', { grid: post, origin: [3, 0, 3] });
}

function buildRoom(root) {
  buildModels();
  const place = (name, x, z, yaw = 0) => { const m = voxelMesh(name); m.position.set(x, 0, z); m.rotation.y = yaw; root.add(m); return m; };
  place('look.floor', 0, -5);
  place('look.wall', 0, -5);
  const L = place('look.sidewall', ROOM.minX - 0.65, -5.4);
  const R = place('look.sidewall', ROOM.maxX + 0.65, -5.4); R.scale.x = -1;
  void L;
  place('enemies.sc.curb', 0, ROOM.maxZ + 0.02);
  for (const x of [ROOM.minX - 0.3, ROOM.maxX + 0.3]) place('enemies.sc.post', x, ROOM.maxZ + 0.25);
  place('look.bones', -5.8, -3.6, 0.6);
  place('look.rubble', 5.9, -3.9, 1.4);
  place('look.candles', -2.9, -4.5);
  place('look.candles', 3.1, -4.5);
  // lights: four wall sconces (look's wall model has the cups), two braziers
  const fires = [];
  for (const sx of [-30, 30]) {
    const a = new THREE.Object3D(); a.position.set(sx * V, 18 * V, -5 + 2.5 * V); root.add(a);
    look.torch(a, { y: 0.3, z: 0.35, color: 'flame', intensity: 1.25, radius: 7 });
  }
  for (const bx of [-5.9, 5.9]) {
    const b = place('look.brazier', bx, 1.9);
    look.torch(b, { y: 1.6, color: 'flame', intensity: 1.7, radius: 8 });
    fires.push([bx, 7 * V, 1.9, 1.5]);
  }
  // cold light down through cracks in the vault, over the middle of the room
  for (const [x, z] of [[-3.2, -1.4], [0, -0.6], [3.2, -1.4]]) {
    const shaft = new THREE.Object3D(); shaft.position.set(x, 0, z); root.add(shaft);
    look.torch(shaft, { y: 2.8, color: 'frost', intensity: 1.1, radius: 4.8, flicker: 0, haze: 0 });
  }
  const cw = new CollisionWorld();
  cw.addBox(ROOM.minX - 2, ROOM.minZ - 2, ROOM.maxX + 2, ROOM.minZ, 'wall');
  cw.addBox(ROOM.minX - 2, ROOM.maxZ, ROOM.maxX + 2, ROOM.maxZ + 2, 'wall');
  cw.addBox(ROOM.minX - 2, ROOM.minZ, ROOM.minX, ROOM.maxZ, 'wall');
  cw.addBox(ROOM.maxX, ROOM.minZ, ROOM.maxX + 2, ROOM.maxZ, 'wall');
  for (const bx of [-5.9, 5.9]) cw.addCircle(bx, 1.9, 0.42, 'brazier');
  setCollision(cw);
  const amb = vfx.ambient({ preset: 'crypt', box: [ROOM.minX, ROOM.maxX, 0.2, 2.6, ROOM.minZ, ROOM.maxZ], sources: fires.map((f) => [f[0], f[1] + 0.2, f[2]]), fires });
  return { cw, amb };
}

// readable state names for the labels
function stateTag(e) {
  if (!e.visible && e.state === 'spawn') return 'SPAWN';
  switch (e.state) {
    case 'spawn': case 'roar': return 'SPAWN';
    case 'move': return e.moveSpeed > 0.12 ? 'MOVE' : 'IDLE';
    case 'windup': case 'aim': case 'raise': return 'TELEGRAPH';
    case 'attack': case 'charge': case 'slam': case 'hop': return 'ATTACK';
    case 'recover': case 'skid': return 'RECOVER';
    case 'dazed': return 'DAZED';
    case 'hurt': return 'HURT';
    case 'death': return 'DEATH';
    default: return e.state.toUpperCase();
  }
}
const TAG_COLOR = { SPAWN: 'sky', IDLE: 'mist', MOVE: 'fog', TELEGRAPH: 'gold', ATTACK: 'red', RECOVER: 'leaf', DAZED: 'gold', HURT: 'white', DEATH: 'rose' };

export default function enemiesShowcase(params) {
  const fight = params.get('fight');
  return fight ? fightScene(params, FIGHTS.includes(fight) ? fight : 'husk') : lineupScene(params);
}

function common(params, defZoom) {
  const o = {
    hud: params.get('hud') !== '0',
    zoom: Math.max(1, Math.min(3, parseInt(params.get('zoom') ?? String(defZoom), 10) || defZoom)),
    slow: parseFloat(params.get('slow') ?? '1') || 1,
    status: { text: '', until: 0 },
  };
  o.say = (t) => { o.status.text = t; o.status.until = loop.realTime + 1.3; };
  return o;
}

function helpBar(g, text) {
  const W = display.width, H = display.height;
  const w = textWidth(text) + 8;
  g.fillStyle = css('ink');
  g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
  drawText(g, text, W / 2, H - 10, 'slate', { align: 'center' });
}

// =====================================================================================
// LINEUP
// =====================================================================================
function lineupScene(params) {
  const O = common(params, params.get('only') ? 3 : 2);
  const only = CAST.find((c) => c.kind === params.get('only'))?.kind ?? null;
  const holdId = params.get('phase');
  let hold = PHASES.some((p) => p.id === holdId);
  let pi = Math.max(0, PHASES.findIndex((p) => p.id === holdId));
  let t = 0;
  let root, mgr, offs = [];
  let slowIdx = Math.max(0, SLOWS.indexOf(O.slow));
  const cast = () => (only ? CAST.filter((c) => c.kind === only).map((c) => ({ ...c, x: 0 })) : CAST);
  let actors = [];       // { kind, x, list: [enemy...], standins: [...] }

  function spawnActor(c, instant) {
    const a = { kind: c.kind, x: c.x, list: [] };
    const make = (x, z, opts = {}) => {
      const e = mgr.spawn(c.kind, x, z, { instant, yaw: 0, ...opts });
      e.ai = false;
      e.home = { x, z };
      e.target = { x: x + (c.kind === 'wisp' ? 0 : 0), z: ROOM.maxZ - 0.35, dead: false, hurt: () => ({ ok: false, reason: 'standin' }) };
      e.yaw = e.pyaw = 0;
      return e;
    };
    if (c.kind === 'mite') {
      const pts = [[0, 0.1], [-0.78, -0.45], [0.76, -0.48], [-0.66, 0.62], [0.7, 0.6]];
      if (!instant) {
        const list = mgr.spawn('mites', c.x, LINE_Z, {});
        list.forEach((e, k) => {
          e.ai = false; e.home = { x: c.x + pts[k][0], z: LINE_Z + pts[k][1] };
          e.spawnFrom.tx = e.home.x; e.spawnFrom.tz = e.home.z;
          e.target = { x: e.home.x * 1 + pts[k][0] * 0.5, z: ROOM.maxZ - 0.35, dead: false, hurt: () => ({ ok: false, reason: 'standin' }) };
          e.yaw = e.pyaw = 0;
        });
        a.list = list;
      } else a.list = pts.map(([dx, dz]) => make(c.x + dx, LINE_Z + dz));
    } else a.list = [make(c.x, LINE_Z)];
    return a;
  }

  function ensureCast(instant = true) {
    for (const c of cast()) {
      let a = actors.find((x) => x.kind === c.kind);
      if (a && a.list.every((e) => !e.dying && !e.remove)) continue;
      if (a) { for (const e of a.list) e.remove = true; actors = actors.filter((x) => x !== a); }
      actors.push(spawnActor(c, instant));
    }
  }
  const all = () => actors.flatMap((a) => a.list).filter((e) => !e.remove);
  const actor = (k) => actors.find((a) => a.kind === k);

  function begin(i) {
    pi = (i + PHASES.length) % PHASES.length;
    t = 0;
    const id = PHASES[pi].id;
    if (id === 'spawn') { mgr.clear(); actors = []; }
    else { ensureCast(true); for (const e of all()) e.reset(); }
    vfx.seed(pi * 101 + 7);
  }

  function run() {
    const id = PHASES[pi].id;
    const C = cast();
    if (id === 'spawn') {
      C.forEach((c, k) => { if (t === k * 12 + 4) actors.push(spawnActor(c, false)); });
    }
    if (id === 'move' && t === 1) for (const e of all()) e.walkLoop = { r: e.kind === 'mite' ? 0.35 : e.kind === 'brute' ? 0.7 : 0.6, a: 0, k: e.kind === 'wisp' ? 0.45 : e.kind === 'mite' ? 0.35 : 0.9, rate: e.kind === 'mite' ? 0.045 : 0.022 };
    if (id === 'move' && t === PHASES[pi].dur - 40) for (const e of all()) e.walkLoop = null;
    if (id === 'attack') {
      // windups timed so every tell is on the floor at once and all four land together
      const at = { brute: 2, wisp: 10, husk: 22, mite: 36 };
      for (const a of actors) if (t === at[a.kind]) for (const e of a.list) e.act?.('charge');
    }
    if (id === 'hurt') {
      for (const e of all()) {
        if (t === 20) { e.flinch(0, -1, 1); vfx.hitSpark(e.x, e.hitY, e.z + e.r, { dx: 0, dz: -1, power: 1, light: false }); }
        if (t === 80) {
          e.takeHit({ dmg: 0, dx: 0.3, dz: -1, tx: 0, tz: 0, power: 2, step: 2, finisher: true, knock: 2.5, lift: 0, stopMs: 90, flashTicks: 5 });
          vfx.hitSpark(e.x, e.hitY, e.z + e.r, { dx: 0, dz: -1, power: 2, light: false });
        }
      }
      if (t === 20 || t === 80) feedback.hitstop(t === 80 ? 85 : 55);
    }
    if (id === 'death' && t === 18) {
      for (const e of all()) {
        if (e.dying) continue;
        e.takeHit({ dmg: e.hp, dx: 0.15, dz: -1, tx: 0, tz: 0, power: 2.2, step: 2, finisher: true, knock: e.kind === 'mite' ? 3 : 2.4, lift: e.kind === 'mite' ? 2 : 0, stopMs: 95, flashTicks: 5 });
        vfx.hitSpark(e.x, e.hitY, e.z + e.r, { dx: 0, dz: -1, power: 1.8, light: false });
      }
      feedback.hitstop(95); feedback.shake(2.5, 160);
    }
  }

  // the full lineup holds still; a single archetype (&only) is followed, so a brute's charge
  // into the curb stays in frame
  let camZ = LINE_Z + 0.75;
  function camera() {
    if (!only) { display.setCameraTarget(0.05, 0.6, LINE_Z + 1.2); return; }
    const e = all()[0];
    const want = e && e.visible ? Math.max(LINE_Z + 0.75, Math.min(ROOM.maxZ - 1.6, e.z + 0.75)) : LINE_Z + 0.75;
    camZ += (want - camZ) * 0.12;
    display.setCameraTarget(0, 0.6, camZ);
  }

  return {
    pausable: true,
    enter(_d, r) {
      root = r;
      world.reset();
      display.setZoom(O.zoom);
      loop.setTimeScale(SLOWS.includes(O.slow) ? SLOWS[slowIdx] : O.slow);
      look.mood('crypt');
      const { cw } = buildRoom(root);
      mgr = createEnemies(root, { collision: cw, bounds: ROOM, hero: () => null });
      world.room = { index: 0, kind: 'showcase', id: 'enemies' };
      debug.handle('spawn', spawnHandler(mgr));
      offs.push(events.on('input:press', () => {}));
      begin(pi);
      camera();
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      mgr?.dispose();
      setCollision(null);
      loop.setTimeScale(1);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },
    frame() {
      const k = input.ui.key;
      ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].forEach((d, i) => { if (k(d)) { begin(i); O.say(PHASES[i].label); } });
      if (k('KeyL')) { hold = !hold; O.say(hold ? 'HOLD THIS BEAT' : 'LOOP ALL BEATS'); }
      if (k('Space')) begin(pi);
      if (k('ArrowRight') || k('KeyD')) begin(pi + 1);
      if (k('ArrowLeft') || k('KeyA')) begin(pi - 1);
      if (k('KeyZ')) { O.zoom = O.zoom >= 3 ? 1 : O.zoom + 1; display.setZoom(O.zoom); O.say(`ZOOM ${O.zoom}X`); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); O.say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) O.hud = !O.hud;
    },
    tick() {
      run();
      mgr.tick();
      t++;
      if (t >= PHASES[pi].dur) begin(hold ? pi : pi + 1);
    },
    render(alpha) {
      camera();
      mgr.render(alpha);
    },
    ui(g) {
      const W = display.width, H = display.height;
      if (O.status.text && loop.realTime < O.status.until) drawText(g, O.status.text, W / 2, 44, 'gold', { align: 'center', outline: 'ink' });
      if (!O.hud) return;
      const P = PHASES[pi];
      drawText(g, 'ENEMIES', 6, 6, 'mist', { shadow: 'ink' });
      drawText(g, P.label, W / 2, 6, 'bone', { align: 'center', scale: 2, outline: 'ink' });
      drawText(g, P.note, W / 2, 25, 'fog', { align: 'center', shadow: 'ink' });
      const bw = 120, p = Math.min(1, t / P.dur), bx = Math.round(W / 2 - bw / 2);
      g.fillStyle = css('ink'); g.fillRect(bx - 1, 34, bw + 2, 4);
      g.fillStyle = css(hold ? 'gold' : 'slate'); g.fillRect(bx, 35, Math.round(bw * p), 2);
      // beats, left
      PHASES.forEach((ph, i) => {
        const on = i === pi;
        if (on) { g.fillStyle = css('ink'); g.fillRect(4, 16 + i * 9, 58, 9); }
        drawText(g, `${i + 1} ${ph.id.toUpperCase()}`, 6, 17 + i * 9, on ? 'gold' : 'slate', { shadow: on ? null : 'ink' });
      });
      if (hold) drawText(g, 'HOLD', 6, 17 + PHASES.length * 9 + 2, 'gold', { shadow: 'ink' });
      // name plates on the floor in front of each
      for (const c of cast()) {
        const D = ENEMY_DATA[c.kind];
        const a = actor(c.kind);
        const s = display.worldToScreen(c.x, 0, LINE_Z + 1.25);
        const name = c.kind === 'mite' ? 'MITE SWARM' : D.name;
        drawText(g, name, s.x, s.y, 'bone', { align: 'center', outline: 'ink' });
        drawText(g, D.blurb, s.x, s.y + 10, 'mist', { align: 'center', shadow: 'ink' });
        const e = a?.list.find((x) => !x.remove);
        if (e) {
          const tag = stateTag(e);
          drawText(g, tag, s.x, s.y + 20, TAG_COLOR[tag] ?? 'fog', { align: 'center', shadow: 'ink' });
          const hp = `HP ${D.hp}`;
          drawText(g, hp, s.x, s.y + 30, 'slate', { align: 'center', shadow: 'ink' });
        }
      }
      helpBar(g, '1-6 BEAT  < > PREV/NEXT  L HOLD  SPACE RESTART  Z ZOOM  T SLOW  H HUD   ?FIGHT=HUSK|WISP|BRUTE|MITES|WAVE');
    },
    state() {
      return { showcase: { id: 'enemies', mode: 'lineup', phase: PHASES[pi].id, t, hold, only, zoom: display.zoom, enemies: mgr.list.map((e) => e.info()) } };
    },
  };
}

// =====================================================================================
// FIGHT
// =====================================================================================
function fightScene(params, which) {
  const O = common(params, 2);
  let auto = params.get('auto') !== '0';
  const numbersOn = params.get('numbers') !== '0';
  let slowIdx = Math.max(0, SLOWS.indexOf(O.slow));
  let root, mgr, rig, anim, ctl, cam, health, combat, cfx, offs = [];
  let deadT = -1, clearT = -1, round = 0;
  const START = [-3.2, 0.3, Math.PI / 2];
  const hurtFlash = { t: 99 };
  const tally = { landed: 0, dodged: 0, kills: 0 };

  // spawn spots round the arena; each group goes to the ones farthest from the hero
  const SPOTS = [[3.6, -2.4], [-3.6, -2.4], [3.8, 1.2], [-3.8, 1.2], [0.2, -3.3], [5.2, -0.6], [-5.2, -0.6]];
  function spots() {
    const all = SPOTS.map(([x, z]) => ({ x, z, d: Math.hypot(x - ctl.x, z - ctl.z) })).sort((a, b) => b.d - a.d);
    const far = all.filter((p) => p.d > 3.5);
    return far.length >= 3 ? [...far, ...far] : all;   // never on top of the hero; spots may be shared
  }
  function spawnGroup() {
    round++;
    const P = spots();
    const S = (k, i = 0) => mgr.spawn(k, P[i].x, P[i].z);
    if (which === 'wave') { S('brute', 0); S('husk', 1); S('mites', 2); S('wisp', 3); S('husk', 4); }
    else S(which);
  }

  // ---- demo autopilot: keyboard-style input only --------------------------------------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, n: 0, dashCool: 0, atkCool: 0, spared: 0, label: '',
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };
  function threatDir() {
    // is anything about to hit us? returns a direction to dash, or null
    const hx = ctl.x, hz = ctl.z;
    for (const e of mgr.list) {
      if (e.dying || !e.visible) continue;
      const A = e.D.attack;
      if (e.kind === 'husk' && e.state === 'windup' && e.st >= A.windup - 9 && e.heroInSector(e.x, e.z, e.yaw, A.reach + 0.25, A.arc)) return away(e.x, e.z, 0);
      if (e.kind === 'mite' && e.state === 'windup' && e.st >= A.windup - 5 && e.heroInDisc(e.lx, e.lz, A.radius + 0.2)) return away(e.lx, e.lz, 1.2);
      if (e.kind === 'brute' && e.state === 'aim' && e.st >= e.D.charge.windup - 10) {
        const dx = Math.sin(e.yaw), dz = Math.cos(e.yaw), rx = hx - e.x, rz = hz - e.z;
        const along = rx * dx + rz * dz, side = rx * dz - rz * dx;
        if (along > 0 && along < e.lane + 1 && Math.abs(side) < e.D.charge.width / 2 + 0.4) return { x: dz * (side >= 0 ? 1 : -1), z: -dx * (side >= 0 ? 1 : -1) };
      }
      if (e.kind === 'brute' && e.state === 'raise' && e.st >= e.D.slam.windup - 9) return away(e.x, e.z, 0);
    }
    for (const o of mgr.orbs) {
      const rx = hx - o.x, rz = hz - o.z, sp = Math.hypot(o.vx, o.vz), d = Math.hypot(rx, rz);
      if (d > 1.4) continue;
      const along = (rx * o.vx + rz * o.vz) / sp;
      if (along > 0) return { x: -o.vz / sp, z: o.vx / sp };
    }
    return null;
  }
  function away(x, z, bend) {
    let dx = ctl.x - x, dz = ctl.z - z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    return { x: dx * (1 - bend * 0.5) + dz * bend * 0.5, z: dz * (1 - bend * 0.5) - dx * bend * 0.5 };
  }
  // The demo plays the way the enemies are meant to be played: hold your ground, read the
  // telegraph, dash out of it, punish the recovery. Wisps and mites it simply chases.
  const isOpen = (e) => ['recover', 'dazed', 'hurt', 'skid', 'roar'].includes(e.state) || e.kind === 'wisp';
  function pilotStep() {
    pilot.mv = { x: 0, z: 0 };
    if (pilot.dashCool > 0) pilot.dashCool--;
    if (pilot.atkCool > 0) pilot.atkCool--;
    if (health.dead) return;
    const th = threatDir();
    if (th && pilot.dashCool <= 0 && ctl.dashReady) {
      // it dodges two threats in three; the third it eats, so both outcomes are on show
      pilot.n++;
      pilot.dashCool = 30;
      if (pilot.n % 3 !== 0) { pilot.mv = th; pilot.want.dash = true; pilot.label = 'DODGE'; return; }
      pilot.label = 'TANK IT';
    }
    // target: open enemies first (dazed brutes above all), then the nearest
    let best = null, bs = Infinity;
    for (const e of mgr.list) {
      if (e.dying || e.dead || !e.visible || e.state === 'spawn') continue;
      const d = Math.hypot(e.x - ctl.x, e.z - ctl.z) - (e.state === 'dazed' ? 6 : isOpen(e) ? 2 : 0);
      if (d < bs) { bs = d; best = e; }
    }
    if (!best) return;
    const dx = best.x - ctl.x, dz = best.z - ctl.z, d = Math.hypot(dx, dz);
    const reach = best.r + 0.9;
    const go = (k, sx = dx / d, sz = dz / d) => { pilot.mv = { x: sx * k, z: sz * k }; };
    if (isOpen(best)) {
      pilot.label = best.state === 'dazed' ? 'PUNISH' : pilot.label;
      if (d > reach) go(Math.min(1, (d - reach) / 0.4 + 0.3));
      else {
        if (anim.state !== 'attack') go(0.2);
        if (pilot.atkCool <= 0) { pilot.want.attack = true; pilot.atkCool = 13; }
      }
      return;
    }
    // not open: keep a spacing and let it come (and commit)
    const keep = best.kind === 'brute' ? 3.4 : best.kind === 'mite' ? 1.9 : 1.75;
    if (d < keep - 0.4) go(-0.8);             // back off (a brute baited toward a wall)
    else if (d > keep + 1.2) go(0.7);
    else go(0.12);                            // face it
  }
  function goLive() { if (!auto) return; auto = false; ctl.source = input; O.say('LIVE'); }
  function goDemo() { auto = true; ctl.source = pilot; O.say('DEMO'); }

  function camBounds() {
    const hw = display.width / (2 * PPU * O.zoom), hd = display.height / (2 * PPU * O.zoom * Math.sin(CAMERA_PITCH));
    const cx = (ROOM.minX + ROOM.maxX) / 2, cz = (ROOM.minZ + ROOM.maxZ) / 2;
    const bx = Math.max(0, (ROOM.maxX - ROOM.minX) / 2 - hw + 0.8), bz = Math.max(0, (ROOM.maxZ - ROOM.minZ) / 2 - hd + 1.0);
    return { minX: cx - bx, maxX: cx + bx, minZ: cz - bz - 0.4, maxZ: cz + bz + 0.3 };
  }
  function setZoom(z) { O.zoom = z; display.setZoom(z); if (cam) cam.bounds = camBounds(); }

  function reset(w) {
    which = w;
    mgr.clear();
    vfx.clear();
    ctl.teleport(START[0], START[1], START[2]);
    cam.reset(START[0], START[1]);
    health.hp = health.maxHp;
    clearT = -1; round = 0;
    tally.landed = tally.dodged = tally.kills = 0;
    spawnGroup();
  }

  return {
    pausable: true,
    enter(_d, r) {
      root = r;
      world.reset();
      look.mood('crypt');
      loop.setTimeScale(SLOWS.includes(O.slow) ? SLOWS[slowIdx] : O.slow);
      const { cw } = buildRoom(root);
      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: START[0], z: START[1], yaw: START[2] });
      ctl = new HeroController({ x: START[0], z: START[1], yaw: START[2], anim, collision: cw, source: auto ? pilot : input });
      health = new HeroHealth({ ctl, anim, rig, hp: 5 });
      combat = new HeroCombat({ ctl, anim, health, targets: () => world.enemies });
      world.hero = health;
      world.room = { index: 0, kind: 'showcase', id: 'enemies', fight: which };
      cam = new CameraRig({});
      setZoom(O.zoom);
      cam.reset(START[0], START[1]);
      cfx = createCombatFx(root, { numbers: numbersOn });
      vfx.bind(['move']);
      mgr = createEnemies(root, { collision: cw, bounds: ROOM });
      debug.handle('spawn', spawnHandler(mgr));
      const on = (n, f) => offs.push(events.on(n, f));
      on('input:press', (e) => { if (auto && e.action !== 'pause') goLive(); });
      on('hero:dead', () => { deadT = 0; });
      on('combat:heroHurt', () => { hurtFlash.t = 0; tally.landed++; });
      on('combat:dodge', () => { tally.dodged++; });
      on('enemy:death', () => { tally.kills++; });
      spawnGroup();
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      cfx?.dispose();
      mgr?.dispose();
      setCollision(null);
      loop.setTimeScale(1);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },
    frame() {
      const k = input.ui.key;
      if (k('KeyB')) goDemo();
      if (k('KeyR')) { reset(which); O.say('RESPAWN'); }
      ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].forEach((d, i) => { if (k(d)) { reset(FIGHTS[i]); O.say(`FIGHT: ${FIGHTS[i].toUpperCase()}`); } });
      if (k('KeyZ')) { setZoom(O.zoom >= 3 ? 1 : O.zoom + 1); O.say(`ZOOM ${O.zoom}X`); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); O.say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) O.hud = !O.hud;
    },
    tick() {
      if (auto) pilotStep();
      combat.tick();
      cam.tick(ctl);
      mgr.tick();
      cfx.tick();
      hurtFlash.t++;
      if (mgr.alive === 0 && clearT < 0) clearT = 0;
      if (clearT >= 0 && ++clearT > 80) { clearT = -1; spawnGroup(); }
      if (deadT >= 0 && ++deadT > 60) {
        deadT = -1;
        ctl.teleport(START[0], START[1], START[2]);
        health.revive();
        O.say('BACK ON YOUR FEET');
      }
    },
    render(alpha) {
      anim.render(alpha);
      health.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y, off.z);
      mgr.render(alpha);
      cfx.render(alpha);
    },
    ui(g) {
      const W = display.width, H = display.height;
      cfx.ui(g);
      if (O.status.text && loop.realTime < O.status.until) drawText(g, O.status.text, W / 2, 40, 'gold', { align: 'center', outline: 'ink' });
      if (!O.hud) return;
      drawText(g, 'ENEMIES', 6, 6, 'mist', { shadow: 'ink' });
      drawText(g, `FIGHT: ${which === 'mites' ? 'MITE SWARM' : which === 'wave' ? 'MIXED WAVE' : ENEMY_DATA[which].name}`, W / 2, 6, 'bone', { align: 'center', scale: 2, outline: 'ink' });
      drawText(g, auto ? 'DEMO  (ANY KEY: TAKE OVER)' : 'LIVE  (B: DEMO)', 6, 16, auto ? 'mist' : 'leaf', { shadow: 'ink' });
      if (auto && pilot.label && pilot.dashCool > 10) drawText(g, pilot.label, 6, 26, pilot.label === 'DODGE' ? 'sky' : 'rose', { shadow: 'ink' });
      // per-enemy: state tag and an hp bar above each
      for (const e of mgr.list) {
        if (!e.visible || e.remove) continue;
        const s = display.worldToScreen(e.x, e.h + 0.25 + e.y, e.z);
        const tag = stateTag(e);
        if (e.kind !== 'mite' || tag !== 'MOVE') drawText(g, tag, s.x, s.y - 12, TAG_COLOR[tag] ?? 'fog', { align: 'center', shadow: 'ink' });
        if (!e.dying && e.hp < e.maxHp) {
          const w = Math.max(8, Math.round(e.maxHp / 4)), x = Math.round(s.x - w / 2), y = Math.round(s.y - 2);
          g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, w + 2, 4);
          g.fillStyle = css('blood'); g.fillRect(x, y, w, 2);
          g.fillStyle = css('red'); g.fillRect(x, y, Math.round(w * e.hp / e.maxHp), 2);
        }
      }
      // hero hp, top right
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
      let ry = 22;
      const row = (t, c) => { drawText(g, t, W - 8, ry, c, { align: 'right', shadow: 'ink' }); ry += 10; };
      row(`HITS TAKEN ${tally.landed}  DODGED ${tally.dodged}`, 'mist');
      row(`KILLS ${tally.kills}  ROUND ${round}`, 'mist');
      row(`TOKENS ${mgr.tokensUsed.toFixed(1)}/${mgr.tokenCap}`, 'slate');
      if (loop.timeScale !== 1) row(`X${loop.timeScale}`, 'gold');
      helpBar(g, 'WASD MOVE  J ATTACK  K DASH  B DEMO  R RESPAWN  1-6 FIGHT  Z ZOOM  T SLOW  H HUD');
    },
    state() {
      return { showcase: { id: 'enemies', mode: 'fight', fight: which, auto, round, tally: { ...tally }, zoom: display.zoom,
        hero: { x: +ctl.x.toFixed(2), z: +ctl.z.toFixed(2), hp: health.hp }, ...mgr.info() } };
    },
  };
}
