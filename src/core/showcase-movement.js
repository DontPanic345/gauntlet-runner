// ?showcase=movement : the hero in an obstacle-course room: round pillars to slalom, an inner
// corner, a long wall to slide along, two narrow gaps (0.9 and 0.7 units, the body is 0.6),
// and a field of square pillars to dash around. A ghost trail on the floor shows the last
// 2 s of positions, one dot per tick (dot spacing = speed); every 6th dot is bigger (0.1 s).
//
// It starts in DEMO: an autopilot drives the same controller with 8-way (keyboard-style)
// input through every station, in a loop. Any key or click takes over (LIVE). B restarts it.
//
// Params:  &auto=0          start LIVE (no autopilot)
//          &at=start|turns|slalom|corner|gap|pillars|cancel|slide|dashgap   start the demo at a station
//          &zoom=1..3       (default 2; 1 = game scale)
//          &slow=<s>        time scale, e.g. 0.25
//          &colliders=1     draw the collision shapes        &cam=1  draw the camera dead-zone and lead
//          &trail=0         no ghost trail                   &hud=0  no labels at all (clean stills)
// Keys:    WASD/arrows move  K/Space dash  J attack  B restart demo  C colliders  V camera
//          G trail  Z zoom  T slow-mo  H hud  P/Esc pause

import * as THREE from 'three';
import { display, PPU, CAMERA_PITCH } from './display.js';
import { input } from './input.js';
import { loop, DT } from './loop.js';
import { world } from './world.js';
import { rng, Rng } from './rng.js';
import { events } from './events.js';
import { buildStage } from './stage.js';
import { drawText, textWidth } from './pixelfont.js';
import { css, hex } from '../render/palette.js';
import { defineModel, voxelMesh, VoxelGrid, VOXEL } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { CollisionWorld, setCollision } from './collision.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController, MOVE } from '../hero/controller.js';
import { CameraRig } from '../render/camera.js';

const V = VOXEL;
const ROOM = { minX: -16, maxX: 16, minZ: -10, maxZ: 10 };
const SLOWS = [1, 0.5, 0.25, 0.1];
const TRAIL = 120; // 2 s of ticks

// ---- the course ----------------------------------------------------------------------------
// boxes: [minX, minZ, maxX, maxZ, heightVoxels]
const WALLS = [
  [-16.6, -10.6, 16.6, -10, 18],   // back
  [-16.6, -10, -16, 10, 12],       // left
  [16, -10, 16.6, 10, 12],         // right
  [-16.6, 10, 16.6, 10.6, 3],      // front ledge (low, so it never hides the hero)
];
const BLOCKS = [
  [-11, 2, -6, 2.6, 10],           // the L: bar
  [-6.6, 2.6, -6, 6.5, 10],        // the L: leg (inner corner at -6.6, 2.6)
  [3.7, -10, 4.3, -4.45, 12],      // partition, with a 0.9 gap ...
  [3.7, -3.55, 4.3, 3.65, 12],     // ... and a 0.7 gap
  [3.7, 4.35, 4.3, 10, 12],
];
for (const x of [7.5, 10.5, 13.5]) for (const z of [-6.5, -2.5, 1.5, 5.5]) BLOCKS.push([x - 0.5, z - 0.5, x + 0.5, z + 0.5, 12]);
const PILLARS = [-6, -8, -10, -12, -14].map((x) => [x, -6, 0.45]);
const TORCHES = [[2.2, -2], [-10, -8.4], [-7.6, 7.2], [2.2, 6.6], [2.2, -6], [12, -4.5], [9, 7.6], [6.2, -7.6]];
const LABELS = [
  ['START / STOP', 0, 1.3], ['SLALOM', -10, -4.2], ['INNER CORNER', -8.8, 7.2],
  ['GAP 0.9', 2.3, -2.7], ['GAP 0.7', 2.3, 5.2], ['PILLARS', 10.5, 8.2], ['WALL SLIDE', 6.2, -9.2],
];

// The demo: 8-way input only (what a keyboard can do). Steps run in order and loop.
const U = [0, -1], D = [0, 1], L = [-1, 0], R = [1, 0];
const UL = [-1, -1], UR = [1, -1], DL = [-1, 1], DR = [1, 1];
const ROUTE = [
  { st: 'start', label: 'START AND STOP' },
  { wait: 30 }, { hold: R, t: 36 }, { wait: 30 }, { hold: L, t: 36 }, { wait: 30 },
  { st: 'turns', label: 'TURNS' },
  { hold: R, t: 26 }, { hold: L, t: 26 }, { hold: R, t: 18 }, { hold: U, t: 18 }, { hold: DL, t: 22 }, { wait: 24 },
  { st: 'slalom', label: 'SLALOM' },
  { to: [-4, -4.9] }, { to: [-6, -4.9] }, { to: [-8, -7.1] }, { to: [-10, -4.9] }, { to: [-12, -7.1] }, { to: [-14, -4.9] },
  { label: 'DASH' }, { hold: D, t: 2 }, { dash: true }, { hold: D, t: 16 }, { wait: 16 },
  { st: 'corner', label: 'INNER CORNER' },
  { to: [-12.5, 3.6] }, { to: [-8.5, 4.6] },
  { hold: UR, t: 45 }, { wait: 14 },
  { label: 'SLIDE OFF THE END' }, { hold: UL, t: 100 }, { wait: 16 },
  { st: 'gap', label: 'GAP 0.7 (BODY 0.6)' },
  { to: [-12, 0.8] }, { to: [-2, 0.8] }, { to: [-2, 4.62], tol: 0.1 }, { wait: 12 }, { hold: R, t: 110 }, { wait: 10 },
  { st: 'pillars', label: 'DASH ROUND CORNERS' },
  { to: [5.8, 3.5] }, { hold: R, t: 2 }, { dash: true }, { hold: R, t: 12 },
  { to: [12, 3.5] }, { hold: U, t: 2 }, { dash: true }, { hold: U, t: 12 },
  { to: [12, -0.5] }, { hold: L, t: 2 }, { dash: true }, { hold: L, t: 16 }, { wait: 20 },
  { st: 'cancel', label: 'ATTACK, DASH CANCELS RECOVERY' },
  { attack: true }, { wait: 13 }, { hold: D, t: 1 }, { dash: true }, { hold: D, t: 12 }, { wait: 14 },
  { attack: true }, { wait: 13 }, { hold: UL, t: 1 }, { dash: true }, { hold: UL, t: 10 }, { wait: 20 },
  { st: 'slide', label: 'WALL SLIDE' },
  { to: [6, -0.5] }, { to: [5.6, -6] }, { hold: UL, t: 72 }, { wait: 10 }, { hold: UR, t: 50 }, { wait: 12 },
  { st: 'dashgap', label: 'DASH THROUGH GAP 0.9' },
  { to: [6.5, -4] }, { hold: L, t: 2 }, { dash: true }, { hold: L, t: 30 },
  { label: 'BACK TO START' }, { to: [0, 0] }, { wait: 30 },
];

// ---- models ----------------------------------------------------------------------------------
const hash = (a, b, c = 0) => { const s = Math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453; return s - Math.floor(s); };

function brickModel(name, w, d, h) {
  // w, d, h in voxels. Coursed brick on every face, a lighter worn cap.
  const g = new VoxelGrid(w, h, d);
  for (let y = 0; y < h; y++) for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
    const edge = x === 0 || z === 0 || x === w - 1 || z === d - 1;
    if (!edge && y < h - 1) { g.set(x, y, z, 'stoneDark'); continue; }
    if (y === h - 1) {
      const f = hash(x, z, 9);
      g.set(x, y, z, f < 0.12 ? 'stone' : f < 0.2 ? 'fog' : 'stoneLight');
      continue;
    }
    const row = Math.floor(y / 3);
    if (y % 3 === 2) { g.set(x, y, z, 'stoneDark'); continue; }   // mortar course
    const along = (x === 0 || x === w - 1) ? z : x;
    const off = row % 2 ? 3 : 0;
    const bi = Math.floor((along + off) / 6);
    if ((along + off) % 6 === 5) { g.set(x, y, z, 'stoneDark'); continue; } // head joint
    const f = hash(bi, row, x === 0 || x === w - 1 ? 1 : 2);
    let c = f < 0.5 ? 'stone' : f < 0.8 ? 'stoneLight' : 'dusk';
    if (y === 0 && hash(x, z, 4) < 0.3) c = 'moss';
    g.set(x, y, z, c);
  }
  defineModel(name, { grid: g });
}

function pillarModel(name, rUnits, h) {
  const R = rUnits * 8;
  const S = Math.ceil(R + 1) * 2 + 1, c = (S - 1) / 2;
  const g = new VoxelGrid(S, h, S);
  for (let y = 0; y < h; y++) for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
    const d = Math.hypot(x - c, z - c);
    const base = y < 2 || y >= h - 2;
    const rr = base ? R + 0.9 : R;
    if (d > rr) continue;
    let col;
    if (y === h - 1) col = d < rr - 1 ? 'stone' : 'stoneLight';
    else if (base) col = y === 1 || y === h - 2 ? 'stoneLight' : 'stone';
    else {
      const band = Math.floor((y - 2) / 3);
      col = (y - 2) % 3 === 2 ? 'stoneDark' : hash(Math.floor(Math.atan2(z - c, x - c) * 2), band) < 0.5 ? 'stone' : 'stoneLight';
      if (y === 2 && hash(x, z) < 0.4) col = 'moss';
    }
    g.set(x, y, z, col);
  }
  defineModel(name, { grid: g });
}

let modelsBuilt = false;
function buildModels() {
  if (modelsBuilt) return;
  modelsBuilt = true;
  // floor: 2-unit flagstones with recessed grout; a strong grid so speed reads against it
  const W = (ROOM.maxX - ROOM.minX) * 8, Dp = (ROOM.maxZ - ROOM.minZ) * 8;
  const g = new VoxelGrid(W, 3, Dp);
  const r = new Rng('move.floor');
  g.box(0, 0, 0, W - 1, 1, Dp - 1, 'stoneDark');
  for (let tz = 0; tz < Dp / 16; tz++) for (let tx = 0; tx < W / 16; tx++) {
    const shade = r.weighted([['stone', 8], ['dusk', 3], ['stoneLight', 1]]);
    for (let z = 1; z < 16; z++) for (let x = 1; x < 16; x++) {
      const X = tx * 16 + x, Z = tz * 16 + z;
      const cx = x === 1 || x === 15, cz = z === 1 || z === 15;
      if (cx && cz && r.chance(0.5)) continue;
      let c = shade;
      const f = r.next();
      if (f < 0.02) c = 'stoneLight'; else if (f < 0.04) c = 'stoneDark';
      if (z === 15 && shade === 'stone' && r.chance(0.3)) c = 'stoneLight';
      g.set(X, 2, Z, c);
    }
  }
  // a painted start mark
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2;
    const X = Math.round(W / 2 + Math.cos(t) * 5.5), Z = Math.round(Dp / 2 + Math.sin(t) * 5.5);
    if (g.get(X, 2, Z)) g.set(X, 2, Z, 'slate');
  }
  defineModel('move.floor', { grid: g, origin: [W / 2, 3, Dp / 2] });
  for (const [x0, z0, x1, z1, h] of [...WALLS, ...BLOCKS]) {
    const w = Math.round((x1 - x0) * 8), d = Math.round((z1 - z0) * 8);
    const name = `move.block.${w}x${d}x${h}`;
    brickModel(name, w, d, h);
  }
  pillarModel('move.pillar', 0.45, 14);
}

// ---- showcase ----------------------------------------------------------------------------------
export default function movementShowcase(params) {
  let hud = params.get('hud') !== '0';
  let zoom = Math.max(1, Math.min(3, parseInt(params.get('zoom') ?? '2', 10) || 2));
  const slowParam = parseFloat(params.get('slow') ?? '1');
  let slowIdx = Math.max(0, SLOWS.indexOf(slowParam));
  let showColliders = params.get('colliders') === '1';
  let showCam = params.get('cam') === '1';
  let showTrail = params.get('trail') !== '0';
  let auto = params.get('auto') !== '0';
  const at = params.get('at');

  let root, stage, rig, anim, ctl, cam, cw, trail, dust, offs = [];
  const hist = [];   // per tick: {x, z, speed, state, inv}
  let status = { text: '', until: 0 };
  const say = (text) => { status = { text, until: loop.realTime + 1.4 }; };

  // ---- autopilot ----
  const pilot = {
    i: 0, t: 0, label: '', dir: null, dashPress: false, attackPress: false, timeouts: [],
    reset(from = 0) { this.i = from; this.t = 0; this.label = ''; this.dir = null; this.dashPress = false; this.attackPress = false; },
    move() { return this.cur ?? { x: 0, z: 0 }; },
    consume(a) {
      if (a === 'dash' && this.dashPress) { this.dashPress = false; return true; }
      return false;
    },
    buffered(a) { return a === 'dash' && this.dashPress; },
    cur: { x: 0, z: 0 },
    // run steps until one needs time; called once per tick before the controller ticks
    step() {
      let guard = 0;
      this.cur = { x: 0, z: 0 };
      while (guard++ < 40) {
        const s = ROUTE[this.i];
        if (!s) { this.i = 0; this.t = 0; continue; }
        if (s.label !== undefined && s.st === undefined && !s.hold && !s.to && !s.wait && !s.dash && !s.attack) { this.label = s.label; this._next(); continue; }
        if (s.st !== undefined) { if (s.label) this.label = s.label; this._next(); continue; }
        if (s.dash) { this.dashPress = true; this._next(); continue; }
        if (s.attack) { this.attackPress = true; this._next(); continue; }
        if (s.wait) { if (this.t++ >= s.wait) { this._next(); continue; } return; }
        if (s.hold) {
          if (this.t++ >= s.t) { this._next(); continue; }
          const l = Math.hypot(s.hold[0], s.hold[1]);
          this.cur = { x: s.hold[0] / l, z: s.hold[1] / l };
          return;
        }
        if (s.to) {
          const dx = s.to[0] - ctl.x, dz = s.to[1] - ctl.z;
          const d = Math.hypot(dx, dz);
          if (d < (s.tol ?? 0.18) || this.t++ > 240) { if (d >= 0.18) this.timeouts.push(this.i); this.dir = null; this._next(); continue; }
          // 8-way with hysteresis: keep the key combo until it is 30 degrees off
          const want = Math.atan2(dx, dz);
          const q = Math.round(want / (Math.PI / 4)) * (Math.PI / 4);
          const errCur = this.dir === null ? 9 : Math.abs(Math.atan2(Math.sin(want - this.dir), Math.cos(want - this.dir)));
          if (errCur > Math.PI / 6 || d < 0.6) this.dir = q;
          this.cur = { x: Math.round(Math.sin(this.dir)), z: Math.round(Math.cos(this.dir)) };
          const l = Math.hypot(this.cur.x, this.cur.z) || 1;
          this.cur.x /= l; this.cur.z /= l;
          return;
        }
        this._next();
      }
    },
    _next() { this.i = (this.i + 1) % ROUTE.length; this.t = 0; },
  };
  const stationIndex = (id) => Math.max(0, ROUTE.findIndex((s) => s.st === id));
  const STATION_POS = { start: [0, 0], turns: [0, 0], slalom: [-2, -3], corner: [-13, -2], gap: [-9, 1.2], pillars: [2, 4.2], cancel: [7.5, -0.5], slide: [8, -0.5], dashgap: [5, -8] };

  function startDemo(id = 'start') {
    auto = true;
    ctl.source = pilot;
    pilot.reset(stationIndex(id));
    const p = STATION_POS[id] ?? [0, 0];
    ctl.teleport(p[0], p[1], 0);
    cam.reset(p[0], p[1]);
    hist.length = 0;
  }
  function goLive() {
    if (!auto) return;
    auto = false;
    ctl.source = input;
    pilot.cur = { x: 0, z: 0 };
    say('LIVE: YOUR CONTROLS');
  }

  function camBounds() {
    const P = PPU * display.zoom;
    const hw = display.width / 2 / P, hz = display.height / 2 / P / Math.sin(CAMERA_PITCH);
    const m = 0.6;
    const b = { minX: ROOM.minX - m + hw, maxX: ROOM.maxX + m - hw, minZ: ROOM.minZ - 1.4 + hz, maxZ: ROOM.maxZ + m - hz * 0.9 };
    if (b.minX > b.maxX) b.minX = b.maxX = 0;
    if (b.minZ > b.maxZ) b.minZ = b.maxZ = 0;
    return b;
  }
  function setZoom(z) {
    zoom = z;
    display.setZoom(zoom);
    if (cam) cam.bounds = camBounds();
  }

  let combo = 0;
  function doAttack() {
    if (!anim.canChain || ctl.state === 'dash') return;
    combo = anim.state === 'attack' ? (anim.step + 1) % 3 : 0;
    ctl.attack(combo);
  }

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      buildModels();
      loop.setTimeScale(SLOWS[slowIdx]);

      // room
      const floor = voxelMesh('move.floor');
      floor.position.set((ROOM.minX + ROOM.maxX) / 2, 0, (ROOM.minZ + ROOM.maxZ) / 2);
      root.add(floor);
      cw = new CollisionWorld();
      for (const [x0, z0, x1, z1, h] of [...WALLS, ...BLOCKS]) {
        const w = Math.round((x1 - x0) * 8), d = Math.round((z1 - z0) * 8);
        const m = voxelMesh(`move.block.${w}x${d}x${h}`);
        m.position.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
        root.add(m);
        cw.addBox(x0, z0, x1, z1, h <= 3 ? 'ledge' : 'wall');
      }
      for (const [x, z, pr] of PILLARS) {
        const m = voxelMesh('move.pillar');
        m.position.set(x, 0, z);
        root.add(m);
        cw.addCircle(x, z, pr, 'pillar');
      }
      stage = buildStage(root, { floor: false, torches: TORCHES, rng: rng.fork('move-stage'), dustBox: [16, 2.5, 10] });
      for (const [x, z] of TORCHES) cw.addCircle(x, z, 0.22, 'torch');
      setCollision(cw);

      // hero
      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: 0, z: 0, yaw: 0 });
      ctl = new HeroController({ x: 0, z: 0, yaw: 0, anim, collision: cw, source: auto ? pilot : input });
      cam = new CameraRig({});
      setZoom(zoom);
      cam.reset(0, 0);
      world.hero = { get x() { return ctl.x; }, get z() { return ctl.z; }, hp: 5, maxHp: 5, get invuln() { return ctl.invulnerable; } };
      world.room = { index: 0, kind: 'showcase', id: 'movement' };

      trail = makeTrail(root);
      dust = makeDust(root, rng.fork('move-dust'));
      const on = (name, fn) => offs.push(events.on(name, fn));
      on('move:dash', (e) => dust.puff(e.x, e.z, -e.dx, -e.dz, 8, 1.2));
      on('move:bonk', (e) => { dust.ring(e.x - e.nx * 0.3, e.z - e.nz * 0.3, 8, 0.9); });
      on('move:dashEnd', (e) => dust.puff(e.x, e.z, e.dx, e.dz, 4, 0.7));
      on('move:turn', (e) => dust.puff(e.x, e.z, -Math.sin(e.yaw), -Math.cos(e.yaw), 5, 0.9));
      on('move:stop', (e) => dust.puff(e.x, e.z, Math.sin(e.ctl.face), Math.cos(e.ctl.face), 3, 0.5));
      on('hero:step', (e) => dust.puff(e.x, e.z, -Math.sin(e.yaw), -Math.cos(e.yaw), 2, 0.4));
      on('input:press', () => { if (auto) goLive(); });

      if (auto) startDemo(at && STATION_POS[at] ? at : 'start');
      else if (at && STATION_POS[at]) { const p = STATION_POS[at]; ctl.teleport(p[0], p[1], 0); cam.reset(p[0], p[1]); }
    },

    exit() {
      offs.forEach((f) => f());
      offs = [];
      loop.setTimeScale(1);
      setCollision(null);
    },

    frame() {
      const k = input.ui.key;
      if (k('KeyB')) { startDemo('start'); say('DEMO'); }
      if (k('KeyC')) { showColliders = !showColliders; say(showColliders ? 'COLLIDERS ON' : 'COLLIDERS OFF'); }
      if (k('KeyV')) { showCam = !showCam; say(showCam ? 'CAMERA OVERLAY ON' : 'CAMERA OVERLAY OFF'); }
      if (k('KeyG')) { showTrail = !showTrail; say(showTrail ? 'TRAIL ON' : 'TRAIL OFF'); }
      if (k('KeyZ')) { setZoom(zoom >= 3 ? 1 : zoom + 1); say(`ZOOM ${zoom}X`); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) hud = !hud;
    },

    tick() {
      stage.tick();
      if (auto) {
        pilot.step();
        if (pilot.attackPress) { pilot.attackPress = false; doAttack(); }
      } else if (input.consume('attack')) doAttack();
      ctl.tick();
      cam.tick(ctl);
      dust.tick();
      hist.push({ x: ctl.x, z: ctl.z, speed: ctl.speed, state: ctl.state, inv: ctl.invulnerable, rec: ctl.recovering });
      if (hist.length > TRAIL) hist.shift();
    },

    render(alpha) {
      anim.render(alpha);
      const h = ctl.at(alpha);
      const off = cam.render(alpha, h);
      rig.group.position.set(off.x, off.y, off.z);
      stage.render(alpha);
      dust.render(alpha);
      trail.update(showTrail ? hist : []);
    },

    ui(g) {
      const W = display.width, H = display.height;
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, 30, 'gold', { align: 'center', outline: 'ink' });
      if (showColliders) drawColliders(g, cw, ctl);
      if (showCam) drawCamera(g, cam, ctl);
      if (!hud) return;

      // station labels on the floor
      for (const [text, x, z] of LABELS) {
        const p = display.worldToScreen(x, 0, z);
        if (p.x < -40 || p.x > W + 40 || p.y < 0 || p.y > H) continue;
        drawText(g, text, p.x, p.y, 'slate', { align: 'center', shadow: 'ink' });
      }

      drawText(g, 'MOVEMENT', 8, 8, 'bone', { outline: 'ink' });
      if (auto) {
        drawText(g, 'DEMO  (ANY KEY: TAKE OVER)', 8, 18, 'mist', { shadow: 'ink' });
        if (pilot.label) drawText(g, pilot.label, W / 2, 8, 'bone', { align: 'center', scale: 2, outline: 'ink' });
      } else drawText(g, 'LIVE  (B: DEMO)', 8, 18, 'leaf', { shadow: 'ink' });

      // numbers, top right
      const i = ctl.info();
      const rows = [
        [`SPEED ${ctl.speed.toFixed(1)}`, ctl.state === 'dash' ? 'cyan' : 'frost'],
        [`START ${i.startTicks}F  STOP ${i.stopTicks}F`, 'mist'],
        [ctl.state === 'dash' ? `DASH ${ctl.t + 1}/${ctl.T.dashTicks}` : ctl.cooldown > 0 ? 'DASH COOLDOWN' : 'DASH READY', ctl.state === 'dash' ? 'cyan' : ctl.cooldown > 0 ? 'slate' : 'leaf'],
      ];
      rows.forEach(([t, c], k) => drawText(g, t, W - 8, 8 + k * 10, c, { align: 'right', shadow: 'ink' }));
      // cooldown bar and i-frame pip
      const bw = 48, bx = W - 8 - bw, by = 40;
      g.fillStyle = css('ink'); g.fillRect(bx - 1, by - 1, bw + 2, 5);
      const frac = ctl.state === 'dash' ? 0 : 1 - ctl.cooldown / ctl.T.dashCooldown;
      g.fillStyle = css(frac >= 1 ? 'leaf' : 'slate'); g.fillRect(bx, by, Math.round(bw * frac), 3);
      if (ctl.invulnerable) drawText(g, 'I-FRAMES', W - 8, by + 7, 'cyan', { align: 'right', outline: 'ink' });
      if (ctl.sliding && ctl.state === 'move') drawText(g, 'SLIDING', W - 8, by + 17, 'fog', { align: 'right', shadow: 'ink' });
      else if (ctl.assist > 0) drawText(g, 'CORNER ASSIST', W - 8, by + 17, 'gold', { align: 'right', shadow: 'ink' });
      if (loop.timeScale !== 1) drawText(g, `X${loop.timeScale}`, W - 8, by + 27, 'gold', { align: 'right', shadow: 'ink' });

      // speed over the last 2 s, one column per tick
      drawSpeedGraph(g, hist, 8, H - 46, ctl.T);

      const help = 'WASD MOVE  K DASH  J ATTACK  B DEMO  C COLLIDERS  V CAMERA  G TRAIL  Z ZOOM  T SLOW  H HUD';
      const w = textWidth(help) + 8;
      g.fillStyle = css('ink');
      g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
      drawText(g, help, W / 2, H - 10, 'slate', { align: 'center' });
    },

    state() {
      return { showcase: { id: 'movement', mode: auto ? 'demo' : 'live', step: pilot.i, label: pilot.label, timeouts: pilot.timeouts.slice(-8), zoom: display.zoom,
        ...ctl.info(), camera: cam.info() } };
    },
  };
}

// ---- ghost trail: one flat voxel per tick on the floor ------------------------------------------
function makeTrail(root) {
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(V, V * 0.25, V), new THREE.MeshBasicMaterial(), TRAIL);
  inst.frustumCulled = false;
  look.noOutline(inst);
  root.add(inst);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const RUN = ['frost', 'fog', 'mist', 'slate'].map(hex);
  const DASH = ['sky', 'cyan', 'teal', 'navy'].map(hex);
  const ATK = ['rose', 'rose', 'plum', 'plum'].map(hex);
  return {
    update(h) {
      const n = h.length;
      for (let i = 0; i < TRAIL; i++) {
        const s = h[i];
        if (!s) { m.makeScale(0, 0, 0); inst.setMatrixAt(i, m); continue; }
        const age = n - 1 - i;                    // 0 = newest
        const band = Math.min(3, Math.floor((age / TRAIL) * 4));
        const tickMark = (n - 1 - i) % 6 === 0;
        const tex = 1 / (PPU * display.zoom * V);     // one screen texel, in voxels
        const sc = (tickMark ? 3 : 2) * tex;
        m.makeScale(sc, 1, sc);
        m.setPosition(s.x, 0.01 + (tickMark ? 0.004 : 0), s.z);
        inst.setMatrixAt(i, m);
        const ramp = s.state === 'dash' ? DASH : s.state === 'attack' ? ATK : RUN;
        inst.setColorAt(i, col.setHex(ramp[band]));
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },
  };
}

// ---- dust puffs (showcase only; the vfx piece owns the game's particles) --------------------------
function makeDust(root, r) {
  const N = 80;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(V, V, V), new THREE.MeshBasicMaterial(), N);
  inst.frustumCulled = false;
  look.noOutline(inst);
  root.add(inst);
  const cols = ['frost', 'fog', 'mist', 'slate'].map(hex);
  const P = Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, life: 1, max: 0 }));
  let next = 0;
  const spawn = (x, z, vx, vy, vz, max) => {
    const p = P[next]; next = (next + 1) % N;
    Object.assign(p, { x, y: 0.05, z, vx, vy, vz, life: 0, max, px: x, py: 0.05, pz: z });
  };
  const m = new THREE.Matrix4(), col = new THREE.Color();
  return {
    puff(x, z, bx, bz, n, power) {
      for (let i = 0; i < n; i++) {
        spawn(x + r.range(-0.08, 0.08), z + r.range(-0.08, 0.08),
          bx * r.range(0.4, 1.2) * power + r.range(-0.5, 0.5) * power, r.range(0.3, 0.8) * power,
          bz * r.range(0.4, 1.2) * power + r.range(-0.5, 0.5) * power, r.range(0.22, 0.42));
      }
    },
    ring(x, z, n, power) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        spawn(x, z, Math.sin(a) * 1.4 * power, r.range(0.3, 0.7) * power, Math.cos(a) * 1.4 * power, r.range(0.25, 0.4));
      }
    },
    tick() {
      for (const p of P) {
        p.px = p.x; p.py = p.y; p.pz = p.z;
        if (p.life >= p.max) continue;
        p.life += DT;
        p.x += p.vx * DT; p.y += p.vy * DT; p.z += p.vz * DT;
        p.vx *= 0.85; p.vz *= 0.85; p.vy = p.vy * 0.9;
      }
    },
    render(alpha) {
      P.forEach((p, i) => {
        const k = p.life / p.max;
        const s = p.life >= p.max ? 0 : k < 0.35 ? 1 : k < 0.7 ? 0.75 : 0.5;
        m.makeScale(s, s, s);
        m.setPosition(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, col.setHex(cols[Math.min(3, Math.floor(k * 4))]));
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },
  };
}

// ---- overlays ----------------------------------------------------------------------------------------
function px(g, x, y, c) { g.fillStyle = c; g.fillRect(x, y, 1, 1); }
function line(g, x0, y0, x1, y1, c) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy, n = 0;
  g.fillStyle = c;
  while (n++ < 4000) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
function groundPoly(g, pts, c) {
  const s = pts.map(([x, z]) => display.worldToScreen(x, 0, z));
  for (let i = 0; i < s.length; i++) { const a = s[i], b = s[(i + 1) % s.length]; line(g, a.x, a.y, b.x, b.y, c); }
}
function groundCircle(g, x, z, r, c, n = 24) {
  const pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
  groundPoly(g, pts, c);
}

function drawColliders(g, cw, ctl) {
  const c = css('rose');
  for (const s of cw.shapes) {
    if (s.kind === 'box') groundPoly(g, [[s.minX, s.minZ], [s.maxX, s.minZ], [s.maxX, s.maxZ], [s.minX, s.maxZ]], c);
    else if (s.kind === 'circle') groundCircle(g, s.x, s.z, s.r, c, 16);
  }
  groundCircle(g, ctl.x, ctl.z, ctl.body.r, css(ctl.contact ? 'gold' : 'leaf'), 16);
  if (ctl.contact) {
    const p = display.worldToScreen(ctl.x, 0, ctl.z);
    const q = display.worldToScreen(ctl.x + ctl.contact[0] * 0.7, 0, ctl.z + ctl.contact[1] * 0.7);
    line(g, p.x, p.y, q.x, q.y, css('gold'));
  }
}

function drawCamera(g, cam, ctl) {
  const o = cam.o, gl = cam.goal;
  groundPoly(g, [[gl.x - o.deadX, gl.z - o.deadZ], [gl.x + o.deadX, gl.z - o.deadZ], [gl.x + o.deadX, gl.z + o.deadZ], [gl.x - o.deadX, gl.z + o.deadZ]], css('sky'));
  const w = display.worldToScreen(cam.want.x, 0, cam.want.z);
  const hp = display.worldToScreen(ctl.x, 0, ctl.z);
  line(g, hp.x, hp.y, w.x, w.y, css('cyan'));
  line(g, w.x - 2, w.y, w.x + 2, w.y, css('white'));
  line(g, w.x, w.y - 2, w.x, w.y + 2, css('white'));
  const cc = cam.pos.cur;
  const p = display.worldToScreen(cc.x, 0, cc.z);
  px(g, p.x, p.y, css('gold')); px(g, p.x - 1, p.y, css('gold')); px(g, p.x + 1, p.y, css('gold'));
  drawText(g, 'DEAD-ZONE', display.worldToScreen(gl.x - o.deadX, 0, gl.z - o.deadZ).x, display.worldToScreen(gl.x, 0, gl.z - o.deadZ).y - 9, 'sky', { shadow: 'ink' });
}

function drawSpeedGraph(g, hist, x, y, T) {
  const w = TRAIL, h = 24;
  g.fillStyle = css('ink'); g.fillRect(x - 2, y - 2, w + 4, h + 14);
  const top = T.speed * 1.6;
  // run-speed guide
  const gy = y + h - Math.round((T.speed / top) * h);
  g.fillStyle = css('shadow'); g.fillRect(x, gy, w, 1);
  const off = w - hist.length;
  hist.forEach((s, i) => {
    const v = Math.min(top, s.speed);
    const bh = Math.round((v / top) * h);
    const c = s.state === 'dash' ? (s.inv ? 'sky' : 'cyan') : s.state === 'attack' ? (s.rec ? 'plum' : 'rose') : 'frost';
    g.fillStyle = css(c);
    if (bh > 0) g.fillRect(x + off + i, y + h - bh, 1, bh);
    if (s.speed > top) { g.fillStyle = css('white'); g.fillRect(x + off + i, y, 1, 1); }
  });
  drawText(g, 'SPEED, LAST 2 S', x, y + h + 2, 'slate');
}
