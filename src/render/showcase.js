// ?showcase=look : a lit crypt arena at game scale. Wall sconces and braziers (real
// flickering point lights), props, rising embers and dust, and a slow camera pan that
// exercises texel snapping. By default a real fight runs in it: the game's hero rig,
// controller and combat against the game's enemies (husks, a brute, mites), driven by an
// autopilot through the same input path as a keyboard, so the frame shows the look under
// combat: hit flashes, droplets, stains and debris that stay on the floor, contact shadows,
// and the kill frame. Any movement/attack key takes the hero over (LIVE).
//
// Params:  &fight=0    the still vignette instead: look's stand-in hero and two enemies, idle
//          &pan=0      hold the camera still (default: slow sideways pan)
//          &t=<s>      start the pan this many seconds in (deterministic captures)
//          &zoom=1..3  integer zoom (default 1 = game scale)
//          &mood=crypt|collapse|boss
//          &hud=0      no labels at all (clean stills)
//          &raw=1      post-processing off (the unprocessed frame, for comparison)
//          &seed=<n>   fight randomness (enemy AI, effect scatter); default 1
// Keys:    1 post on/off   2 outlines   3 palette quantise   4 dither   5 creases   6 haze
//          M mood   Space pan on/off   Z zoom   H labels   P/Esc pause   B fight autopilot
//          WASD/J/K take the hero (LIVE)

import * as THREE from 'three';
import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { rng } from '../core/rng.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css, hex } from './palette.js';
import { voxelMesh, VOXEL } from './voxel/index.js';
import { look } from './look.js';
import { FLOOR, WALL, SCONCES } from './showcase-models.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { CollisionWorld, setCollision } from '../core/collision.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import { createEnemies, spawnHandler } from '../enemies/index.js';
import { createHud } from '../ui/hud.js';
import { vfx } from '../vfx/vfx.js';

const FLOOR_BACK = -5;   // world z of the back wall face
const PAN_AMP = 2.2;     // world units either side
const PAN_PERIOD = 24;   // seconds for a full left-right-left sweep
const MOODS = ['crypt', 'collapse', 'boss'];

export default function lookShowcase(params) {
  let hud = params.get('hud') !== '0';
  let panning = params.get('pan') !== '0';
  const t0 = parseFloat(params.get('t') ?? '0') || 0;
  const zoomParam = Math.max(1, Math.min(3, parseInt(params.get('zoom') ?? '1', 10) || 1));
  let zoom = zoomParam;
  let moodIndex = Math.max(0, MOODS.indexOf(params.get('mood') ?? 'crypt'));
  const fightOn = params.get('fight') !== '0';
  const fightSeed = parseInt(params.get('seed') ?? '1', 10) || 1;
  const saved = { ...look.options };
  let fight = null;

  let root, fx, hero, skel, ooze, panT = t0, prevPanT = t0;
  let t = 0;
  const statusMsg = { text: '', until: 0 };
  const say = (text) => { statusMsg.text = text; statusMsg.until = loop.realTime + 1.6; };

  function place(name, x, z, yaw = 0, y = 0) {
    const m = voxelMesh(name);
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    root.add(m);
    return m;
  }

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      if (params.get('raw') === '1') look.options.enabled = false;
      look.mood(MOODS[moodIndex]);
      display.setZoom(zoom);

      // room
      place('look.floor', 0, FLOOR_BACK);
      place('look.wall', 0, FLOOR_BACK);
      const L = place('look.sidewall', -12 + 0.6, FLOOR_BACK - 0.4);
      const R = place('look.sidewall', 12 - 0.6, FLOOR_BACK - 0.4);
      R.scale.x = -1;
      void L;

      // props
      place('look.barrel', -9.6, -4.1);
      place('look.barrel', -8.3, -4.4, 0.4);
      place('look.barrel', -9.1, -3.0, 1.1);
      place('look.crate', 7.4, -4.3, 0.1);
      place('look.crate', 6.3, -4.5, -0.2);
      place('look.crate', 7.1, -3.2, 0.5);
      place('look.candles', -4.6, -4.3);
      place('look.bones', 7.4, -1.6, 0.6);
      place('look.bones', -6.8, 3.4, 2.2);
      place('look.rubble', -10.2, 2.6);
      place('look.rubble', 10.1, 1.8, 1.9);
      place('look.rubble', 1.6, -4.4, 0.8);

      // fire sources: [x, y, z, size, anchor mesh]
      const fires = [];
      for (const [sx, sy] of SCONCES) {
        const x = sx * VOXEL, y = (sy + 1) * VOXEL, z = FLOOR_BACK + 2 * VOXEL + VOXEL / 2;
        const anchor = new THREE.Object3D();
        anchor.position.set(x, y, z);
        root.add(anchor);
        look.torch(anchor, { y: 0.3, z: 0.35, color: 'flame', intensity: 1.2, radius: 7 });
        fires.push({ x, y: y + VOXEL, z, size: 1 });
      }
      for (const bx of [-5.6, 5.6]) {
        const b = place('look.brazier', bx, 2.2);
        look.torch(b, { y: 1.6, color: 'flame', intensity: 1.9, radius: 9 });
        fires.push({ x: bx, y: 7 * VOXEL, z: 2.2, size: 2 });
      }
      // candles: a faint warm light, no particles (their flames are emissive voxels)
      const cand = root.children.find((o) => o.name === 'look.candles');
      look.torch(cand, { y: 1.8, color: 'gold', intensity: 0.35, radius: 3, flicker: 0.6 });

      // a shaft of cold light through a crack in the vault, over the middle of the arena
      const shaft = new THREE.Object3D();
      shaft.position.set(-0.4, 0, 0.9);
      root.add(shaft);
      look.torch(shaft, { y: 2.4, color: 'frost', intensity: 2.4, radius: 4.6, flicker: 0, haze: 0 });

      fx = makeFireFx(root, fires, rng.fork('look-fx'));
      t = 0;
      if (fightOn) { fight = makeFight(root, fightSeed); return; }

      // cast (the still vignette: look's own stand-ins)
      hero = place('look.hero', 0.2, 1.2, 0.55);
      skel = place('look.skeleton', 3.5, 0.0, -1.2);
      ooze = place('look.ooze', -3.3, 2.2, 1.05);
      hero.userData.base = hero.position.clone();
      skel.userData.base = skel.position.clone();
      ooze.userData.base = ooze.position.clone();
    },

    exit() {
      fight?.dispose(); fight = null;
      Object.assign(look.options, saved);
      look.mood('crypt');
    },

    frame() {
      const k = input.ui.key;
      const o = look.options;
      const tog = (key, label) => { o[key] = !o[key]; say(`${label} ${o[key] ? 'ON' : 'OFF'}`); };
      if (k('Digit1')) tog('enabled', 'POST');
      if (k('Digit2')) tog('outline', 'OUTLINES');
      if (k('Digit3')) tog('quantize', 'PALETTE QUANTISE');
      if (k('Digit4')) tog('dither', 'DITHER');
      if (k('Digit5')) tog('crease', 'CREASE LIGHT');
      if (k('Digit6')) { o.glow = o.glow > 0 ? 0 : saved.glow || 0.22; say(`HAZE ${o.glow > 0 ? 'ON' : 'OFF'}`); }
      if (k('KeyM')) { moodIndex = (moodIndex + 1) % MOODS.length; look.mood(MOODS[moodIndex]); say(`MOOD ${MOODS[moodIndex].toUpperCase()}`); }
      if (k('Space')) { panning = !panning; say(panning ? 'PAN ON' : 'PAN OFF'); }
      if (k('KeyZ')) { zoom = zoom >= 3 ? 1 : zoom + 1; display.setZoom(zoom); say(`ZOOM ${zoom}X`); }
      if (k('KeyH')) hud = !hud;
      if (k('KeyB') && fight) { fight.autopilot(); say('FIGHT AUTOPILOT'); }
    },

    tick() {
      t++;
      prevPanT = panT;
      if (panning) panT += DT;
      fx.tick();
      fight?.tick();
    },

    render(alpha) {
      const time = (t + alpha) * DT;
      // slow sinusoidal pan: the camera target glides, display snaps it to whole texels
      const pt = prevPanT + (panT - prevPanT) * alpha;
      const cx = Math.sin((pt / PAN_PERIOD) * Math.PI * 2) * PAN_AMP;
      // zoomed in on a fight, the camera follows the hero (the pan rides on top, smaller)
      const fz = fight && display.zoom > 1 ? fight.focus(alpha) : null;
      if (fz) display.setCameraTarget(fz.x + cx * 0.25, 0.5, fz.z - 0.4);
      else display.setCameraTarget(cx, 0.5, -0.6);
      fx.render(alpha);
      if (fight) { fight.render(alpha); return; }

      // idle life, in whole-texel steps (pixel-art timing, not smooth tweening)
      const texel = 1 / (display.PPU * display.zoom);
      const breathe = Math.floor(time * 1.6) % 2;              // hero chest rises one texel
      hero.position.copy(hero.userData.base);
      hero.position.y += breathe * texel;
      look.snap(hero.position);
      const rattle = Math.floor(time * 5) % 7 === 0 ? 1 : 0;  // skeleton twitches now and then
      skel.position.copy(skel.userData.base);
      skel.position.x += rattle * texel;
      skel.rotation.z = rattle ? 0.03 : 0;
      look.snap(skel.position);
      const q = [1, 0.96, 0.92, 0.96][Math.floor(time * 4) % 4]; // ooze squash cycle
      ooze.scale.set(1 / Math.sqrt(q), q, 1 / Math.sqrt(q));
      ooze.position.copy(ooze.userData.base);
      look.snap(ooze.position);
    },

    ui(g) {
      const W = display.width, H = display.height;
      if (statusMsg.text && loop.realTime < statusMsg.until) {
        drawText(g, statusMsg.text, W / 2, 8, 'gold', { align: 'center', outline: 'ink' });
      }
      fight?.ui(g);
      if (!hud) return;
      const ly = fight ? 34 : 6;
      drawText(g, 'RENDER LOOK', 6, ly, 'bone', { outline: 'ink' });
      drawText(g, `${look.lights.moodName.toUpperCase()}  ${W}X${H}  ${display.zoom}X${fight ? (fight.live ? '  LIVE' : '  AUTOPILOT') : ''}`, 6, ly + 10, 'mist', { shadow: 'ink' });
      const help = (fight ? 'WASD J K FIGHT  B AUTO  ' : '') + '1 POST  2 OUTLINE  3 PALETTE  4 DITHER  5 CREASE  6 HAZE  M MOOD  SPACE PAN  Z ZOOM  H HIDE';
      const w = textWidth(help) + 8;
      g.fillStyle = css('ink');
      g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
      drawText(g, help, W / 2, H - 10, 'slate', { align: 'center' });
    },

    state() {
      const o = look.options;
      return { showcase: { id: 'look', panning, panT: +panT.toFixed(3), camX: +display.cameraTarget.x.toFixed(4),
        zoom: display.zoom, mood: look.lights.moodName, post: o.enabled, outline: o.outline, quantize: o.quantize,
        torches: look.lights.torches.size, impact: look.impact.stats(), fight: fight ? fight.state() : null } };
    },
  };
}


// ---------------------------------------------------------------------------------------
// The fight: the real hero, combat and enemies in this room, so the look is judged under
// combat. An autopilot walks up to the nearest enemy, runs the 3-hit combo, and now and then
// dashes out; enemies are topped back up through their own spawn-in. God mode: the hero takes
// hits (flash, knockback, numbers) but never dies.
const ARENA = { minX: -10.2, maxX: 10.2, minZ: -3.7, maxZ: 5.0 };
const CYCLE = ['husk', 'husk', 'brute', 'husk', 'husk', 'mites'];
const ZONE = { minX: -6.2, maxX: 6.2, minZ: -2.4, maxZ: 3.4 };   // where the fight is kept: the lit middle of the room

function makeFight(root, seed) {
  const r = rng.fork(`look-fight-${seed}`);
  look.impact.seed(seed * 7919);
  vfx.seed?.(seed);
  const cw = new CollisionWorld();
  cw.addBox(ARENA.minX - 2, ARENA.minZ - 2, ARENA.maxX + 2, ARENA.minZ, 'wall');
  cw.addBox(ARENA.minX - 2, ARENA.maxZ, ARENA.maxX + 2, ARENA.maxZ + 2, 'wall');
  cw.addBox(ARENA.minX - 2, ARENA.minZ, ARENA.minX, ARENA.maxZ, 'wall');
  cw.addBox(ARENA.maxX, ARENA.minZ, ARENA.maxX + 2, ARENA.maxZ, 'wall');
  for (const bx of [-5.6, 5.6]) cw.addCircle(bx, 2.2, 0.55, 'prop');
  cw.addBox(-10.3, -4.9, -7.6, -2.5, 'prop');   // barrels
  cw.addBox(5.6, -5, 8.1, -2.6, 'prop');        // crates
  setCollision(cw);

  const pilot = {
    mv: { x: 0, z: 0 }, want: {},
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };
  const start = { x: 0.2, z: 1.4, yaw: 0.6 };
  const rig = createHeroRig();
  root.add(rig.group);
  const anim = new HeroAnim(rig, { x: start.x, z: start.z, yaw: start.yaw });
  const ctl = new HeroController({ ...start, anim, collision: cw, source: pilot });
  const health = new HeroHealth({ ctl, anim, rig, hp: 5 });
  const combat = new HeroCombat({ ctl, anim, health, targets: () => world.enemies });
  world.hero = health;
  world.god = true;
  world.room = { index: 0, kind: 'showcase', id: 'look' };
  const foes = createEnemies(root, { collision: cw, bounds: ARENA });
  const cfx = createCombatFx(root, { numbers: false });   // hud draws the numbers; particles go to vfx
  vfx.bind(['move', 'kill']);
  const hud = createHud({ health, track: false, shards: false, boons: false, intro: false });
  debug.handle('spawn', spawnHandler(foes));

  foes.spawn('husk', 2.4, 0.6, { instant: true, yaw: -1.6 });
  foes.spawn('husk', -2.6, 2.6, { instant: true, yaw: 1.2 });
  let cyc = 0, spawnCool = 90;
  let live = false;
  // pilot state
  const P = { combo: 0, gap: 0, rest: 0, combos: 0, dashT: 0 };

  const offs = [events.on('input:press', (e) => {
    if (live || !['attack', 'dash', 'up', 'down', 'left', 'right', 'move'].includes(e.action)) return;
    live = true; ctl.source = input;
  })];

  function fighting(e) { return !e.dead && !e.dying && e.state !== 'spawn' && e.state !== 'spawning'; }

  function pilotTick() {
    pilot.mv = { x: 0, z: 0 };
    const foesNow = world.enemies.filter(fighting);
    let tgt = null, best = 1e9;
    for (const e of foesNow) { const d = Math.hypot(e.x - ctl.x, e.z - ctl.z); if (d < best) { best = d; tgt = e; } }
    if (P.rest > 0) { P.rest--; return; }
    if (P.dashT > 0) { P.dashT--; return; }
    if (P.combo === 0 && (ctl.x < ZONE.minX - 0.8 || ctl.x > ZONE.maxX + 0.8 || ctl.z < ZONE.minZ - 0.8 || ctl.z > ZONE.maxZ + 0.8)) {
      const dx = 0 - ctl.x, dz = 0.8 - ctl.z, d = Math.hypot(dx, dz);
      pilot.mv = { x: dx / d, z: dz / d };
      return;
    }
    if (!tgt) {   // nothing to fight: drift back toward the middle of the light
      const dx = 0 - ctl.x, dz = 1.2 - ctl.z, d = Math.hypot(dx, dz);
      if (d > 0.5) pilot.mv = { x: dx / d * 0.6, z: dz / d * 0.6 };
      return;
    }
    const dx = (tgt.x - ctl.x) / (best || 1), dz = (tgt.z - ctl.z) / (best || 1);
    if (P.combo > 0) {
      if (--P.gap <= 0) {
        pilot.mv = { x: dx * 0.2, z: dz * 0.2 };
        pilot.want.attack = true;
        P.combo--; P.gap = 13;
        if (P.combo === 0) {
          P.combos++;
          P.rest = 24;
          if (P.combos % 3 === 0) {   // break off: a dash to the side, then come back in
            P.rest = 18; P.dashT = 24;
            let side = r.chance(0.5) ? 1 : -1;
            const ex = ctl.x - dz * side * 2, ez = ctl.z + dx * side * 2;
            if (ex < ZONE.minX || ex > ZONE.maxX || ez < ZONE.minZ || ez > ZONE.maxZ) side = -side;
            pilot.mv = { x: -dz * side, z: dx * side };
            pilot.want.dash = true;
          }
        }
      }
      return;
    }
    const reach = 0.95 + (tgt.r ?? 0.35);
    if (best > reach) { const k = Math.min(1, (best - reach) / 0.4 + 0.35); pilot.mv = { x: dx * k, z: dz * k }; return; }
    P.combo = 3; P.gap = 1;
  }

  function spawnTick() {
    if (spawnCool > 0) { spawnCool--; return; }
    if (foes.alive >= 2 || (foes.alive >= 1 && cyc % 2)) return;
    const kind = CYCLE[cyc++ % CYCLE.length];
    // a spot 2.6 to 3.6 units from the hero, inside the room and off the braziers
    for (let tries = 0; tries < 30; tries++) {
      const a = r.range(0, Math.PI * 2), d = r.range(2.4, 3.4);
      const x = ctl.x + Math.sin(a) * d, z = ctl.z + Math.cos(a) * d;
      if (x < ZONE.minX || x > ZONE.maxX || z < ZONE.minZ || z > ZONE.maxZ) continue;
      if (Math.abs(Math.abs(x) - 5.6) < 1.1 && Math.abs(z - 2.2) < 1.1) continue;
      if (Math.abs(x) > 5 && z < -1.8) continue;
      foes.spawn(kind, x, z);
      break;
    }
    spawnCool = 70;
  }

  return {
    get live() { return live; },
    autopilot() { live = false; ctl.source = pilot; },
    focus(alpha) { const p = ctl.at(alpha); return { x: Math.max(-6, Math.min(6, p.x)), z: Math.max(-1.5, Math.min(2.5, p.z)) }; },
    tick() {
      if (!live) pilotTick();
      combat.tick();
      foes.tick();
      cfx.tick();
      spawnTick();
    },
    render(alpha) {
      anim.render(alpha);
      health.render();
      const p = ctl.at(alpha);
      rig.group.position.set(p.x, 0, p.z);
      look.snap(rig.group.position);
      foes.render(alpha);
      cfx.render(alpha);
    },
    ui(g) { cfx.ui(g); hud.ui(g); },
    state() { return { live, combos: P.combos, alive: foes.alive, kills: foes.kills, hero: { x: +ctl.x.toFixed(2), z: +ctl.z.toFixed(2) } }; },
    dispose() {
      offs.forEach((f) => f());
      hud.dispose(); cfx.dispose(); foes.dispose();
      setCollision(null);
      world.god = false;
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },
  };
}

// ---------------------------------------------------------------------------------------
// fire, embers and dust for the vignette. Voxel cubes in one instanced draw, on the
// no-outline layer. (The `vfx` piece owns the game's real particle system.)
function makeFireFx(root, fires, r) {
  const FLAME = 9, EMBERS = 70, DUST = 70;
  const count = fires.length * FLAME + EMBERS + DUST;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL), new THREE.MeshBasicMaterial(), count);
  inst.frustumCulled = false;
  look.noOutline(inst);
  root.add(inst);
  const C = { ember: hex('ember'), flame: hex('flame'), gold: hex('gold'), torch: hex('torch'), mist: hex('mist'), fog: hex('fog'), frost: hex('frost') };
  const P = [];
  const mk = (kind) => ({ kind, x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, life: 1, max: 1, s: 1, c: C.ember, ph: 0 });
  for (let i = 0; i < fires.length * FLAME; i++) P.push(mk('flame'));
  const e0 = P.length;
  for (let i = 0; i < EMBERS; i++) P.push(mk('ember'));
  for (let i = 0; i < DUST; i++) {
    const d = mk('dust');
    d.x = d.px = r.range(-11, 11); d.y = d.py = r.range(0.2, 3); d.z = d.pz = r.range(-4.5, 5);
    d.vx = r.range(-0.08, 0.08); d.vy = r.range(-0.02, 0.04); d.vz = r.range(-0.03, 0.03);
    d.s = r.chance(0.25) ? 2 : 1;
    d.c = r.pick([C.mist, C.fog, C.fog, C.frost]);
    d.ph = r.range(0, 6.28);
    P.push(d);
  }
  let t = 0, next = e0;

  function layout() {
    // each fire: a stack of voxels that re-rolls every few ticks: coals, body, tongues, tip
    fires.forEach((f, fi) => {
      const w = f.size;
      const spec = [];
      const h = r.int(0, 1) + (w > 1 ? 1 : 0);
      for (let dx = -Math.floor(w / 2); dx <= Math.floor(w / 2); dx++) spec.push([dx, 0, 0, C.ember]);
      if (w > 1) spec.push([r.int(-1, 1), 0, r.pick([-1, 1]), C.ember]);
      spec.push([0, 1, 0, C.flame], [r.int(-1, 1) * (w > 1 ? 1 : 0.5), 1, 0, C.flame]);
      if (w > 1) spec.push([r.pick([-1, 1]), 1, 0, C.flame], [0, 2, 0, C.gold]);
      spec.push([r.int(-1, 1) * 0.5, 2 + (w > 1 ? 1 : 0), 0, C.gold], [r.int(-1, 1) * 0.5, 3 + h, 0, C.torch]);
      for (let k = 0; k < FLAME; k++) {
        const p = P[fi * FLAME + k];
        const s = spec[k];
        if (!s) { p.s = 0; continue; }
        p.x = p.px = f.x + s[0] * VOXEL;
        p.y = p.py = f.y + s[1] * VOXEL;
        p.z = p.pz = f.z + s[2] * VOXEL;
        p.c = s[3];
        p.s = k === spec.length - 1 ? 0.75 : 1;
      }
    });
  }
  layout();

  return {
    tick() {
      t++;
      if (t % 5 === 0) layout();
      if (t % 4 === 0) {
        const f = r.pick(fires);
        const e = P[next];
        next = e0 + ((next - e0 + 1) % EMBERS);
        e.x = e.px = f.x + r.range(-0.12, 0.12) * f.size;
        e.y = e.py = f.y + 3 * VOXEL;
        e.z = e.pz = f.z + r.range(-0.1, 0.1);
        e.vx = r.range(-0.2, 0.2); e.vy = r.range(0.45, 0.95); e.vz = r.range(-0.1, 0.1);
        e.life = 0; e.max = r.range(1.0, 2.4); e.ph = r.range(0, 6.28);
      }
      for (const p of P) {
        p.px = p.x; p.py = p.y; p.pz = p.z;
        if (p.kind === 'ember') {
          if (p.life >= p.max) continue;
          p.life += DT;
          p.vx += Math.sin(p.life * 4 + p.ph) * 0.015;
          p.x += p.vx * DT; p.y += p.vy * DT; p.z += p.vz * DT;
          const k = p.life / p.max;
          p.c = k < 0.25 ? C.torch : k < 0.5 ? C.gold : k < 0.8 ? C.flame : C.ember;
        } else if (p.kind === 'dust') {
          p.x += (p.vx + Math.sin(t * 0.011 + p.ph) * 0.04) * DT;
          p.y += (p.vy + Math.cos(t * 0.017 + p.ph) * 0.025) * DT;
          p.z += p.vz * DT;
          if (p.x > 11) p.x = p.px = -11;
          if (p.x < -11) p.x = p.px = 11;
          if (p.y > 3 || p.y < 0.15) p.vy = -p.vy;
        }
      }
    },
    render(alpha) {
      const m = new THREE.Matrix4();
      const col = new THREE.Color();
      const texel = 1 / (32 * display.zoom * VOXEL); // one screen texel, in voxel units
      P.forEach((p, i) => {
        const dead = p.kind === 'ember' && p.life >= p.max;
        let s = dead ? 0 : p.kind === 'dust' ? texel * p.s : p.kind === 'ember' ? texel * (p.life / p.max < 0.6 ? 2 : 1) : p.s;
        m.makeScale(s, s, s);
        m.setPosition(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, col.setHex(p.c));
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },
  };
}
