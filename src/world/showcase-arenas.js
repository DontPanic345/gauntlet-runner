// ?showcase=arenas&seed=N : the five arenas of a seeded run, then one of them played.
//
// TOUR (first): a slow fly-through of arenas 1-5 for the seed, each lit and alive, with a card
// naming its template, theme, mirror and the waves it will throw. A shutter wipe between rooms.
// PLAY (after the tour): one arena played for real by a keyboard-style DEMO pilot: the hero
// walks in from the landing, the gate slams, the room wakes, the waves come, the clear moment,
// the portcullis goes up, the hero smashes a few pots and walks out. Then the tour again.
// Any key takes over the hero (LIVE); B gives it back to the demo.
//
// Params:  &seed=N             the run seed (the contract's ?seed; default 1)
//          &mode=tour|play     start in the tour (default) or go straight to play
//          &room=1..5          tour: hold on this arena (a still for stills)
//          &play=1..5          which arena is played (default 3: the first brute)
//          &at=clear           play: the waves are cut to one husk, for a quick clear moment
//          &at=seal            play: the hero starts just inside; the gate slams at tick 150, or
//                              when debug.arena('seal') is called (freeze first for strips)
//          &auto=0             play: start LIVE
//          &dur=<s>            tour: seconds per room (default 5)
//          &zoom=1..3          (default 1, game scale)      &slow=<s>   time scale
//          &hud=0              no showcase labels (the arena's own banners still show)
//          &tpl=<id>[,<id>..]  force templates onto arenas 1.. (one id: every arena uses it);
//                              ids: antechamber cistern shrine ossuary hall crossing maw
//          &var=0|1            force a template's layout variant (the Maw has two)
//          &cam=x,z            tour: hold the camera on a world point (close-up stills with &zoom=2)
// Keys:    tour: Left/Right room, Space hold, Enter/P2 play this room
//          play: WASD J K, B demo, R restart the room, N next room
//          both: M tour/play, Z zoom, T slow-mo, H hud, P/Esc pause
// state().showcase = { id, mode, room, hold, auto, arena: arena.info(), hero }

import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { look } from '../render/look.js';
import { setCollision } from '../core/collision.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import '../combat/sfx.js';
import { vfx } from '../vfx/vfx.js';
import { spawnHandler } from '../enemies/index.js';
import { Arena, generateArena, cameraBounds, setActiveArena, ARENA_COUNT, TEMPLATES } from './arena.js';
import { describeUnits } from './waves.js';
import { THEMES, SOLID_TILES } from './tiles.js';

const SLOWS = [1, 0.5, 0.25, 0.1];

export default function arenasShowcase(params) {
  const seed = window.__GR?.seed ?? 1;
  let hud = params.get('hud') !== '0';
  let zoom = Math.max(1, Math.min(3, parseInt(params.get('zoom') ?? '1', 10) || 1));
  const slow = parseFloat(params.get('slow') ?? '1') || 1;
  let slowIdx = Math.max(0, SLOWS.indexOf(slow));
  const roomParam = parseInt(params.get('room') ?? '', 10);
  let hold = Number.isFinite(roomParam);
  let room = hold ? Math.max(0, Math.min(ARENA_COUNT - 1, roomParam - 1)) : 0;
  let playIdx = Math.max(0, Math.min(ARENA_COUNT - 1, (parseInt(params.get('play') ?? '3', 10) || 3) - 1));
  const at = params.get('at');
  const dur = Math.max(1.5, parseFloat(params.get('dur') ?? '5') || 5) * 60;
  let auto = params.get('auto') !== '0';
  let mode = params.get('mode') === 'play' || at === 'clear' || at === 'seal' ? 'play' : 'tour';

  let root, arena = null, t = 0;
  let wipe = null;          // { t, then }  shutter transition (ticks)
  let hero = null;          // play-mode bundle
  let offs = [];
  const status = { text: '', until: 0 };
  const say = (s) => { status.text = s; status.until = loop.realTime + 1.3; };
  const layouts = [];
  // &tpl=<id>[,<id>...]: force templates onto arenas 1.. (to see every template); &var=0|1 a layout
  const tplList = (params.get('tpl') ?? '').split(',').filter((t) => TEMPLATES[t]);
  const varParam = params.get('var');
  const layout = (i) => (layouts[i] ??= generateArena(i, seed, { template: tplList[i] ?? (tplList.length === 1 ? tplList[0] : null), variant: varParam === null ? null : (parseInt(varParam, 10) || 0) }));

  // ---- building rooms --------------------------------------------------------------------
  function clearRoom(rebind = true) {
    if (hero) { hero.cfx.dispose(); root.remove(hero.rig.group); hero = null; }
    if (arena) { arena.dispose(); arena = null; }
    vfx.clear();                 // (this also unbinds vfx.bind, so each room binds again)
    world.enemies = [];
    world.hero = null;
    setCollision(null);
    if (rebind) vfx.bind(['move', 'kill']);
  }

  function buildTour(i) {
    clearRoom();
    room = i;
    arena = setActiveArena(new Arena(root, layout(i), { waves: false, awake: true, banners: false }));
    setCollision(arena.collision);
    debug.handle('spawn', spawnHandler(arena.foes));
    t = 0;
    display.setZoom(zoom);
  }

  function buildPlay(i) {
    clearRoom();
    playIdx = i;
    const L = layout(i);
    const H = {};
    arena = setActiveArena(new Arena(root, L, { hero: () => H.ctl, autoSeal: at !== 'seal' }));
    if (at === 'clear') arena.waves.plan = { ...arena.waves.plan, waves: [{ units: ['husk'], budget: 2, cost: 2 }] };
    setCollision(arena.collision);
    const s = at === 'seal' ? { x: 0, z: L.D / 2 - 1.7, yaw: Math.PI } : arena.start;
    H.rig = createHeroRig();
    root.add(H.rig.group);
    H.anim = new HeroAnim(H.rig, { x: s.x, z: s.z, yaw: s.yaw });
    H.anim.spawn();
    H.ctl = new HeroController({ x: s.x, z: s.z, yaw: s.yaw, anim: H.anim, collision: arena.collision, source: auto ? pilot : input });
    H.health = new HeroHealth({ ctl: H.ctl, anim: H.anim, rig: H.rig, hp: 5 });
    H.combat = new HeroCombat({ ctl: H.ctl, anim: H.anim, health: H.health, targets: () => [...world.enemies, ...arena.targets()] });
    H.cam = new CameraRig({ bounds: cameraBounds(L, zoom) });
    H.cam.reset(s.x, s.z);
    H.cfx = createCombatFx(root);
    H.deadT = -1;
    world.hero = H.health;
    world.god = auto;
    hero = H;
    debug.handle('spawn', spawnHandler(arena.foes));
    pilot.reset();
    t = 0;
    display.setZoom(zoom);
  }

  function go(m, i) {
    mode = m;
    if (m === 'tour') buildTour(i); else buildPlay(i);
  }
  function transition(fn) { if (!wipe) wipe = { t: 0, then: fn }; }

  // ---- the demo pilot: keyboard-style input, tile-grid paths -------------------------------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, n: 0, dashCool: 0, atkCool: 0, label: '', path: null, pathFor: null, pathT: 0, smashes: 0,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
    reset() { this.mv = { x: 0, z: 0 }; this.want = {}; this.n = 0; this.dashCool = 0; this.atkCool = 0; this.path = null; this.smashes = 0; this.label = ''; },
  };
  // walkable tiles: not a block, not under a solid prop
  function walkGrid() {
    const L = arena.L;
    const g = L.tiles.map((row) => [...row].map((c) => !SOLID_TILES[c === 'Z' ? '^' : c]));
    for (const p of arena.props.list) {
      if (!p.def.solid || p.dead || p.y || p.kind === 'urn' || p.kind === 'crate' || p.kind === 'barrel' || p.kind === 'candles') continue;
      const i = Math.floor(p.x + L.W / 2), j = Math.floor(p.z + L.D / 2);
      if (g[j]?.[i] !== undefined) g[j][i] = false;
      if (p.kind === 'sarcophagus') { const i2 = Math.floor(p.x - 0.5 + L.W / 2); if (g[j]?.[i2] !== undefined) g[j][i2] = false; }
      if (p.def.setPiece) {
        // a set-piece covers several tiles: block every tile its body reaches
        const hx = (p.def.boxW ?? p.def.r ?? 1) + 0.2, hz = (p.def.boxD ?? p.def.r ?? 1) + 0.2;
        for (let jj = 0; jj < L.D; jj++) for (let ii = 0; ii < L.W; ii++) {
          const cx = ii - L.W / 2 + 0.5, cz = jj - L.D / 2 + 0.5;
          if (Math.abs(cx - p.x) < hx && Math.abs(cz - p.z) < hz) g[jj][ii] = false;
        }
      }
    }
    return g;
  }
  function pathTo(x, z) {
    const L = arena.L, g = walkGrid();
    const ti = (v, n, h) => Math.max(0, Math.min(n - 1, Math.floor(v + h)));
    const si = ti(hero.ctl.x, L.W, L.W / 2), sj = ti(hero.ctl.z, L.D, L.D / 2);
    const gi = ti(x, L.W, L.W / 2), gj = ti(z, L.D, L.D / 2);
    const key = (i, j) => j * L.W + i;
    const prev = new Map([[key(si, sj), -1]]);
    const q = [[si, sj]];
    while (q.length) {
      const [i, j] = q.shift();
      if (i === gi && j === gj) break;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= L.W || nj >= L.D || !g[nj][ni] || prev.has(key(ni, nj))) continue;
        if (di && dj && (!g[j][ni] || !g[nj][i])) continue;   // no corner cutting
        prev.set(key(ni, nj), key(i, j));
        q.push([ni, nj]);
      }
    }
    if (!prev.has(key(gi, gj))) return [[x, z]];
    const out = [];
    for (let k = key(gi, gj); k !== -1; k = prev.get(k)) out.push([(k % L.W) - L.W / 2 + 0.5, Math.floor(k / L.W) - L.D / 2 + 0.5]);
    out.reverse();
    out[out.length - 1] = [x, z];
    return out.slice(1);
  }
  function steer(x, z, speed = 1, reach = 0.3) {
    const c = hero.ctl;
    const k = `${x.toFixed(1)},${z.toFixed(1)}`;
    if (pilot.pathFor !== k || pilot.pathT++ > 40) { pilot.path = pathTo(x, z); pilot.pathFor = k; pilot.pathT = 0; }
    while (pilot.path.length > 1 && Math.hypot(pilot.path[0][0] - c.x, pilot.path[0][1] - c.z) < 0.45) pilot.path.shift();
    const [wx, wz] = pilot.path[0] ?? [x, z];
    const dx = wx - c.x, dz = wz - c.z, d = Math.hypot(dx, dz);
    if (Math.hypot(x - c.x, z - c.z) < reach) return true;
    pilot.mv = { x: dx / d * speed, z: dz / d * speed };
    return false;
  }
  function threatDir() {
    const c = hero.ctl;
    for (const e of arena.foes.list) {
      if (e.dying || !e.visible) continue;
      const A = e.D.attack;
      if (e.kind === 'husk' && e.state === 'windup' && e.st >= A.windup - 9 && e.heroInSector(e.x, e.z, e.yaw, A.reach + 0.25, A.arc)) return away(e.x, e.z);
      if (e.kind === 'mite' && e.state === 'windup' && e.st >= A.windup - 5 && e.heroInDisc(e.lx, e.lz, A.radius + 0.2)) return away(e.lx, e.lz);
      if (e.kind === 'brute' && e.state === 'aim' && e.st >= e.D.charge.windup - 10) {
        const dx = Math.sin(e.yaw), dz = Math.cos(e.yaw), rx = c.x - e.x, rz = c.z - e.z;
        const along = rx * dx + rz * dz, side = rx * dz - rz * dx;
        if (along > 0 && along < e.lane + 1 && Math.abs(side) < e.D.charge.width / 2 + 0.4) return { x: dz * (side >= 0 ? 1 : -1), z: -dx * (side >= 0 ? 1 : -1) };
      }
      if (e.kind === 'brute' && e.state === 'raise' && e.st >= e.D.slam.windup - 9) return away(e.x, e.z);
    }
    for (const o of arena.foes.orbs) {
      const rx = c.x - o.x, rz = c.z - o.z, sp = Math.hypot(o.vx, o.vz), d = Math.hypot(rx, rz);
      if (d > 1.4) continue;
      if ((rx * o.vx + rz * o.vz) / sp > 0) return { x: -o.vz / sp, z: o.vx / sp };
    }
    return null;
  }
  function away(x, z) {
    const c = hero.ctl;
    let dx = c.x - x, dz = c.z - z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    // bias toward the room's middle so a dodge never pins the hero on a wall
    return { x: dx * 0.8 - c.x * 0.03, z: dz * 0.8 - c.z * 0.03 };
  }
  const isOpen = (e) => ['recover', 'dazed', 'hurt', 'skid', 'roar'].includes(e.state) || e.kind === 'wisp';
  function smashNearest(maxD = 99) {
    const c = hero.ctl;
    let best = null, bd = maxD;
    for (const p of arena.props.list) {
      if (!p.breakable || p.dead || p.kind === 'bones') continue;
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      if (d < bd) { bd = d; best = p; }
    }
    if (!best) return false;
    const dx = best.x - c.x, dz = best.z - c.z, d = Math.hypot(dx, dz);
    if (d > best.r + 0.75) { steer(best.x - dx / d * (best.r + 0.5), best.z - dz / d * (best.r + 0.5), 0.85, 0.2); pilot.label = 'SMASH'; }
    else {
      pilot.mv = { x: dx / d * 0.15, z: dz / d * 0.15 };
      if (pilot.atkCool <= 0) { pilot.want.attack = true; pilot.atkCool = 16; }
      pilot.label = 'SMASH';
    }
    return true;
  }
  function pilotStep() {
    pilot.mv = { x: 0, z: 0 };
    if (pilot.dashCool > 0) pilot.dashCool--;
    if (pilot.atkCool > 0) pilot.atkCool--;
    const c = hero.ctl, A = arena, L = A.L;
    if (hero.health.dead || hero.anim.state === 'spawn') return;
    if (A.state === 'waiting') { pilot.label = 'ENTER'; steer(0, L.D / 2 - 2.2, 0.8, 0.2); return; }
    if (A.state === 'sealing') { pilot.label = ''; if (c.z > L.D / 2 - 2.4) steer(0, L.D / 2 - 2.6, 0.5, 0.2); return; }
    if (A.state === 'clearing') { pilot.label = ''; return; }
    if (A.state === 'open' || A.state === 'exited') {
      if (pilot.smashes < 2 && smashNearest(4.5)) return;
      pilot.label = 'EXIT';
      steer(A.exitX, -L.D / 2 - 0.8, 0.9, 0.1);
      return;
    }
    // fight
    const th = threatDir();
    if (th && pilot.dashCool <= 0 && c.dashReady) {
      pilot.n++;
      pilot.dashCool = 30;
      if (pilot.n % 3 !== 0) { pilot.mv = th; pilot.want.dash = true; pilot.label = 'DODGE'; return; }
      pilot.label = 'TANK IT';
    }
    let best = null, bs = Infinity;
    for (const e of A.foes.list) {
      if (e.dying || e.dead || !e.visible || e.state === 'spawn') continue;
      const d = Math.hypot(e.x - c.x, e.z - c.z) - (e.state === 'dazed' ? 6 : isOpen(e) ? 2 : 0);
      if (d < bs) { bs = d; best = e; }
    }
    if (!best) {
      // between waves (nothing alive, nothing arriving): break a pot; otherwise hold the middle
      if (A.foes.alive > 0 || !smashNearest(5)) steer(0, 0.5, 0.5, 1);
      return;
    }
    const dx = best.x - c.x, dz = best.z - c.z, d = Math.hypot(dx, dz);
    const reach = best.r + 0.9;
    if (isOpen(best)) {
      if (best.state === 'dazed') pilot.label = 'PUNISH';
      if (d > reach) steer(best.x, best.z, Math.min(1, (d - reach) / 0.4 + 0.3), reach);
      else {
        if (hero.anim.state !== 'attack') pilot.mv = { x: dx / d * 0.2, z: dz / d * 0.2 };
        if (pilot.atkCool <= 0) { pilot.want.attack = true; pilot.atkCool = 13; }
      }
      return;
    }
    const keep = best.kind === 'brute' ? 3.4 : best.kind === 'mite' ? 1.9 : 1.75;
    if (d < keep - 0.4) pilot.mv = { x: -dx / d * 0.8 - c.x * 0.02, z: -dz / d * 0.8 - c.z * 0.02 };
    else if (d > keep + 1.2) steer(best.x, best.z, 0.7, keep);
    else pilot.mv = { x: dx / d * 0.12, z: dz / d * 0.12 };
  }
  function goLive() { if (!auto || !hero) return; auto = false; hero.ctl.source = input; world.god = false; say('LIVE'); }
  function goDemo() { if (!hero) return; auto = true; hero.ctl.source = pilot; world.god = true; say('DEMO'); }

  // ---- tour camera ---------------------------------------------------------------------------
  const camParam = (params.get('cam') ?? '').split(',').map(Number);
  function tourCamera() {
    const L = arena.L;
    if (camParam.length === 2 && camParam.every(Number.isFinite)) { display.setCameraTarget(camParam[0], 0.5, camParam[1]); return; }
    const k = t / dur;
    const b = cameraBounds(L, zoom);
    // a slow drift across the room, from the back wall toward the gate
    const x = b.minX + (b.maxX - b.minX) * (0.5 + 0.5 * Math.sin(k * 2.2 - 1.1)) + Math.sin(k * 3) * 0.4;
    const zc = -1.2 - Math.max(0, L.D - 10) * 0.25;
    const z = zc + Math.sin(k * 1.7) * 0.5;
    display.setCameraTarget(x, 0.5, z);
  }

  // =====================================================================================
  return {
    pausable: true,
    enter(_d, r) {
      root = r;
      world.reset();
      look.mood('crypt');
      loop.setTimeScale(SLOWS.includes(slow) ? SLOWS[slowIdx] : slow);
      const on = (n, f) => offs.push(events.on(n, f));
      on('input:press', (e) => { if (mode === 'play' && auto && e.action !== 'pause' && !['KeyB', 'KeyM', 'KeyZ', 'KeyT', 'KeyH', 'KeyR', 'KeyN'].includes(e.code)) goLive(); });
      on('arena:exit', () => { if (mode === 'play') transition(() => (params.get('mode') === 'play' || at ? go('play', playIdx) : go('tour', 0))); });
      on('prop:break', () => { if (hero && pilot.label === 'SMASH' && arena.state === 'open') pilot.smashes++; });
      debug.handle('goto', (i) => {
        const n = Math.max(0, Math.min(ARENA_COUNT - 1, (i | 0)));
        go(mode, n);
        return { ok: true, room: n, id: arena.L.id };
      });
      go(mode, mode === 'play' ? playIdx : room);
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      clearRoom(false);
      world.god = false;
      loop.setTimeScale(1);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
      debug.handle('goto', () => ({ ok: false, error: 'no rooms in this scene' }));
    },
    frame() {
      const k = input.ui.key;
      if (k('KeyZ')) { zoom = zoom >= 3 ? 1 : zoom + 1; display.setZoom(zoom); if (hero) hero.cam.bounds = cameraBounds(arena.L, zoom); say(`ZOOM ${zoom}X`); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) hud = !hud;
      if (k('KeyM')) transition(() => (mode === 'tour' ? go('play', room) : go('tour', playIdx)));
      if (mode === 'tour') {
        if (k('ArrowRight') || k('KeyD')) transition(() => go('tour', (room + 1) % ARENA_COUNT));
        if (k('ArrowLeft') || k('KeyA')) transition(() => go('tour', (room + ARENA_COUNT - 1) % ARENA_COUNT));
        if (k('Space')) { hold = !hold; say(hold ? 'HOLD THIS ROOM' : 'TOUR'); }
        if (k('Enter')) transition(() => go('play', room));
      } else {
        if (k('KeyB')) goDemo();
        if (k('KeyR')) transition(() => go('play', playIdx));
        if (k('KeyN')) transition(() => go('play', (playIdx + 1) % ARENA_COUNT));
      }
    },
    tick() {
      t++;
      if (wipe) {
        wipe.t++;
        if (wipe.t === 9) wipe.then();
        if (wipe.t >= 18) wipe = null;
      }
      if (!arena) return;
      if (mode === 'tour') {
        arena.tick();
        if (!hold && t >= dur && !wipe) transition(() => (room + 1 < ARENA_COUNT ? go('tour', room + 1) : go('play', playIdx)));
        return;
      }
      if (at === 'seal' && t === 150) arena.seal();
      if (auto) pilotStep();
      hero.combat.tick();
      arena.tickCamera(hero.cam, hero.ctl);
      arena.tick();
      hero.cfx.tick();
      if (hero.health.dead && hero.deadT < 0) hero.deadT = 0;
      if (hero.deadT >= 0 && ++hero.deadT > 70) { hero.deadT = -1; hero.health.revive(); say('BACK ON YOUR FEET'); }
    },
    render(alpha) {
      if (!arena) return;
      if (mode === 'tour') tourCamera();
      else {
        hero.anim.render(alpha);
        hero.health.render();
        const off = hero.cam.render(alpha, hero.ctl.at(alpha));
        hero.rig.group.position.set(off.x, off.y, off.z);
        hero.cfx.render(alpha);
      }
      arena.render(alpha);
    },
    ui(g) {
      const W = display.width, H = display.height;
      if (arena) arena.ui(g);
      if (hero) hero.cfx.ui(g);
      if (hud && arena) {
        const L = arena.L;
        if (mode === 'tour') {
          drawText(g, `ARENAS  SEED ${seed}`, 6, 6, 'mist', { shadow: 'ink' });
          // progress pips
          for (let i = 0; i < ARENA_COUNT; i++) {
            const x = W - 8 - (ARENA_COUNT - i) * 12;
            g.fillStyle = css('ink'); g.fillRect(x - 1, 5, 10, 8);
            g.fillStyle = css(i === room ? 'gold' : i < room ? 'slate' : 'dusk'); g.fillRect(x, 6, 8, 6);
          }
          if (hold) drawText(g, 'HOLD', W - 8, 16, 'gold', { align: 'right', shadow: 'ink' });
          // the room card
          const lines = [
            [`${THEMES[L.theme].label}  ${TEMPLATES[L.id] ? L.id.toUpperCase() : ''}${L.variant ? ' B' : ''}${L.mirror ? '  MIRRORED' : ''}  ${L.W}X${L.D}`, 'mist'],
            ...L.plan.waves.map((w, k) => [`W${k + 1}  ${describeUnits(w.units)}`, 'fog']),
          ];
          const cw = Math.max(textWidth(L.name) * 2, ...lines.map(([s]) => textWidth(s))) + 16;
          const ch = 30 + lines.length * 10;
          const x0 = 6, y0 = H - 16 - ch;
          g.fillStyle = css('ink'); g.fillRect(x0, y0, cw, ch);
          g.fillStyle = css('ember'); g.fillRect(x0, y0, 2, ch);
          drawText(g, `ARENA ${room + 1}/${ARENA_COUNT}`, x0 + 8, y0 + 5, 'gold');
          drawText(g, L.name, x0 + 8, y0 + 15, 'bone', { scale: 2 });
          lines.forEach(([s, c], k) => drawText(g, s, x0 + 8, y0 + 34 + k * 10, c));
          helpBar(g, W, H, '< > ROOM  SPACE HOLD  ENTER PLAY IT  M PLAY  Z ZOOM  H HUD');
        } else {
          drawText(g, `ARENA ${L.index + 1}/${ARENA_COUNT}  ${L.name}`, 6, 6, 'mist', { shadow: 'ink' });
          drawText(g, auto ? 'DEMO  (HERO CANNOT DIE; ANY KEY: TAKE OVER)' : 'LIVE  (B: DEMO)', 6, 16, auto ? 'slate' : 'leaf', { shadow: 'ink' });
          if (auto && pilot.label) drawText(g, pilot.label, 6, 26, pilot.label === 'DODGE' ? 'sky' : pilot.label === 'TANK IT' ? 'rose' : 'fog', { shadow: 'ink' });
          const w = arena.waves;
          const st = arena.state === 'fight' ? `WAVE ${w.n}/${w.total}  ALIVE ${arena.foes.alive}` : arena.state.toUpperCase();
          drawText(g, st, W - 6, 6, 'fog', { align: 'right', shadow: 'ink' });
          // hero hp pips
          const hp = hero.health.hp, mx = hero.health.maxHp;
          for (let i = 0; i < mx; i++) {
            const x = W - 6 - (mx - i) * 10, y = 16;
            g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, 9, 9);
            g.fillStyle = css(i < hp ? 'red' : 'shadow'); g.fillRect(x, y, 7, 7);
          }
          helpBar(g, W, H, 'WASD MOVE  J ATTACK  K DASH  B DEMO  R RESTART  N NEXT ROOM  M TOUR  Z ZOOM  H HUD');
        }
      }
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, H - 28, 'gold', { align: 'center', outline: 'ink' });
      // the shutter: ink blinds close, the room swaps, they open
      if (wipe) {
        const k = wipe.t < 9 ? wipe.t / 8 : (17 - wipe.t) / 8;
        const bw = 16, cover = Math.round(Math.max(0, Math.min(1, k)) * bw);
        g.fillStyle = css('ink');
        for (let x = 0; x < W; x += bw) g.fillRect(x, 0, cover, H);
      }
    },
    state() {
      return {
        showcase: {
          id: 'arenas', mode, room: mode === 'tour' ? room + 1 : playIdx + 1, hold, auto, t, zoom: display.zoom,
          arena: arena?.info() ?? null,
          hero: hero ? { x: +hero.ctl.x.toFixed(2), z: +hero.ctl.z.toFixed(2), hp: hero.health.hp } : null,
          pilot: hero ? pilot.label : null,
        },
      };
    },
  };
}

function helpBar(g, W, H, text) {
  const w = textWidth(text) + 8;
  g.fillStyle = css('ink');
  g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
  drawText(g, text, W / 2, H - 10, 'slate', { align: 'center' });
}
