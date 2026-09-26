// ?showcase=arenas : five generated rooms, then one played with waves.
//
//   ?showcase=arenas&seed=N          a fly-through of rooms 1 to 5 (each with its name card), then the
//                                    camera settles on one room, a bot walks in, the gate slams, waves come
//                                    (and props get smashed between them), the room clears and the door opens.
//   &arena=N (1..5)                  skip the fly-through: play room N (bot on)
//   &play=N (1..5)                   which room the reel plays after the fly-through (default 2)
//   &fly=1                           fly-through only, looping
//   &bot=0                           you play (WASD, J attack, K dash); any key takes over from the bot
//   &t=<seconds>                     start the fly-through at that time
//   &zoom=1..3  &slow=<s>  &hud=0    presentation
// Keys: 1-5 play that room   F fly-through   C clear the room now   R restart the room   V kill all
//       B bot   H hud   Z zoom   T slow-mo   P/Esc pause   WASD/J/K play

import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { CollisionWorld, setCollision } from '../core/collision.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import '../combat/sfx.js';
import { vfx } from '../vfx/index.js';
import { createEnemySystem } from '../enemies/index.js';
import { generateLayout, Arena, TEMPLATES } from './arena.js';
import { describePlan } from './waves.js';

const STEP = 30;            // world units between rooms
const CAM_Z = -0.75;        // where the camera looks, relative to a room's centre
const DWELL = 236, TRAVEL = 78;
const ROOMS = 5;
const SLOWS = [1, 0.5, 0.25];
const ease = (k) => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;

export default function arenasShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  const seed = parseInt(P('seed', '1'), 10) || 1;
  const arenaP = parseInt(P('arena', '0'), 10) || 0;
  const flyOnly = P('fly', '0') === '1';
  let playIdx = Math.max(0, Math.min(ROOMS - 1, (parseInt(P('play', '2'), 10) || 2) - 1));
  let bot = P('bot', '1') !== '0';
  let hud = P('hud', '1') !== '0';
  let zoom = Math.max(1, Math.min(3, parseInt(P('zoom', '1'), 10) || 1));
  let slowIdx = Math.max(0, SLOWS.indexOf(parseFloat(P('slow', '1'))));
  const t0 = Math.round((parseFloat(P('t', '0')) || 0) * 60);

  let root, rig, anim, ctl, cam, health, combat, cfx, sys, cw0;
  const rooms = [];
  let mode = 'fly', flyT = t0, room = null, roomIdx = 0;
  let deadT = -1, exitT = -1, hurtFlash = 99, camX = 0, camZ = 0;
  let offs = [];
  const status = { text: '', until: 0 };
  const say = (t) => { status.text = t; status.until = loop.realTime + 1.4; };
  const ox = (i) => i * STEP;

  // ---- the bot: plays the hero. It walks in, fights, smashes props between waves and leaves. -------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, atkCd: 0, dashCd: 0, target: null, targetT: 0, skip: new Set(), clearWait: 0,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };
  const SMASH = ['barrel', 'crate', 'urn', 'bones', 'candles', 'brazier', 'pillar', 'pillarRuin', 'statue'];
  function walkTo(x, z, speed = 1, stop = 0.25) {
    const dx = x - ctl.x, dz = z - ctl.z, d = Math.hypot(dx, dz);
    if (d > stop) { const k = Math.min(speed, (d - stop) / 0.5 + 0.2); pilot.mv = { x: (dx / d) * k, z: (dz / d) * k }; return false; }
    return true;
  }
  function botStep() {
    pilot.mv = { x: 0, z: 0 };
    pilot.atkCd--; pilot.dashCd--;
    if (!room || health.dead || mode !== 'play') return;
    const hx = ctl.x, hz = ctl.z, st = room.state;
    const live = world.enemies.filter((e) => e.solid && !e.dead);
    if (st === 'ready' || st === 'sealing') { const c = room.w(room.layout.doors.entry * 0.55, 0.9); walkTo(c.x, c.z, 0.9, 0.5); return; }
    if (st === 'clear' || st === 'exited') {
      pilot.clearWait++;
      if (pilot.clearWait < 26) return;
      const e = room.exitPoint;
      walkTo(e.x, e.z - 0.9, 1, 0.1);
      return;
    }
    if (st === 'clearing') return;
    // fight: dodge telegraphs first
    let threat = null;
    for (const e of live) {
      const dx = hx - e.x, dz = hz - e.z, dist = Math.hypot(dx, dz);
      const late = e.st > (e.d.windup ?? 30) - 15;
      if (e.state === 'windup' && e.kind === 'husk' && dist < 1.9 && late) threat = { nx: dz / dist, nz: -dx / dist };
      else if (e.state === 'telegraph' && late && e.kind === 'brute') {
        const ux = e.dir.x, uz = e.dir.z, along = dx * ux + dz * uz, side = dx * uz - dz * ux;
        if (along > 0 && along < 8 && Math.abs(side) < 1.0) threat = { nx: uz * (side >= 0 ? -1 : 1) * -1, nz: -ux * (side >= 0 ? -1 : 1) * -1 };
      } else if (e.state === 'windup' && e.kind === 'mite' && e.landAt && Math.hypot(hx - e.landAt.x, hz - e.landAt.z) < 0.7 && e.st > 8) threat = { nx: dx / (dist || 1), nz: dz / (dist || 1) };
    }
    for (const o of sys.orbs) {
      const dx = hx - o.x, dz = hz - o.z, dist = Math.hypot(dx, dz), sp = Math.hypot(o.vx, o.vz) || 1;
      if (dist < 1.5 && (dx * o.vx + dz * o.vz) < 0 && Math.abs(dx * (o.vz / sp) - dz * (o.vx / sp)) < 0.6) threat = { nx: o.vz / sp, nz: -o.vx / sp };
    }
    if (threat && pilot.dashCd <= 0 && !combat.info().busy) { pilot.mv = { x: threat.nx, z: threat.nz }; pilot.want.dash = true; pilot.dashCd = 34; return; }
    if (threat) { pilot.mv = { x: threat.nx, z: threat.nz }; return; }
    if (live.length) {
      pilot.target = null;
      let best = null, bd = 1e9;
      for (const e of live) { const d = Math.hypot(e.x - hx, e.z - hz) - (e.kind === 'brute' && e.state === 'charge' ? 3 : 0); if (d < bd) { bd = d; best = e; } }
      const dx = best.x - hx, dz = best.z - hz, dist = Math.hypot(dx, dz);
      const stand = best.kind === 'brute' ? 1.25 : 1.0;
      if (dist > stand) { const k = Math.min(1, (dist - stand) / 0.4 + 0.25); pilot.mv = { x: dx / dist * k, z: dz / dist * k }; }
      else pilot.mv = { x: dx / dist * 0.05, z: dz / dist * 0.05 };
      if (dist < stand + 0.55 && pilot.atkCd <= 0) { pilot.want.attack = true; pilot.atkCd = 13; }
      return;
    }
    // nobody alive: smash things while the next wave gets ready
    if (!pilot.target || pilot.target.dead || pilot.targetT > 210) {
      if (pilot.target && !pilot.target.dead) pilot.skip.add(pilot.target);
      const opts = room.targets().filter((p) => SMASH.includes(p.kind) && !pilot.skip.has(p) && (p.hits < 1 || p.K.hp !== Infinity));
      opts.sort((a, b) => (Math.hypot(a.x - hx, a.z - hz) + (a.K.hp === Infinity ? 3 : 0)) - (Math.hypot(b.x - hx, b.z - hz) + (b.K.hp === Infinity ? 3 : 0)));
      pilot.target = opts[0] ?? null; pilot.targetT = 0;
    }
    const t = pilot.target;
    if (t) {
      pilot.targetT++;
      const dx = t.x - hx, dz = t.z - hz, dist = Math.hypot(dx, dz), stand = t.r + 0.78;
      if (dist > stand) { const k = Math.min(1, (dist - stand) / 0.4 + 0.3); pilot.mv = { x: dx / dist * k, z: dz / dist * k }; }
      else pilot.mv = { x: dx / dist * 0.05, z: dz / dist * 0.05 };
      if (dist < stand + 0.12 && pilot.atkCd <= 0) { pilot.want.attack = true; pilot.atkCd = 15; }
    } else {
      const c = room.w(0, 1.0);
      walkTo(c.x, c.z, 0.7, 0.6);
    }
  }
  function goLive() { if (!bot) return; bot = false; ctl.source = input; pilot.mv = { x: 0, z: 0 }; say('LIVE'); }

  // ---- rooms ------------------------------------------------------------------------------------------
  function buildRoom(i) {
    const layout = generateLayout(seed, i);
    const a = new Arena(root, layout, { origin: { x: ox(i), z: 0 }, title: true });
    rooms[i] = a;
    return a;
  }
  function rebuildRoom(i) {
    rooms[i]?.dispose();
    return buildRoom(i);
  }
  function startPlay(i, { fresh = true } = {}) {
    if (fresh && rooms[i].played) rebuildRoom(i);
    mode = 'play'; roomIdx = i; room = rooms[i]; room.played = true;
    sys.clear(); vfx.clear();
    ctl.collision = room.cw; setCollision(room.cw);
    const e = room.entryPoint;
    ctl.teleport(e.x, e.z, 0); anim.reset(e.x, e.z, 0); ctl.stunT = 0;
    health.revive(); health.iframeT = 0; deadT = -1; exitT = -1; pilot.target = null; pilot.skip.clear(); pilot.clearWait = 0;
    rig.group.visible = true;
    room.bind({ hero: health, sys });
    room.titleT = 0;
    cam.bounds = { minX: room.ox - 0.8, maxX: room.ox + 0.8, minZ: room.oz + CAM_Z - 0.5, maxZ: room.oz + CAM_Z + 0.5 };
    cam.follow = true;
    cam.reset(room.ox, room.oz + CAM_Z);
    world.room = { ...(world.room ?? {}) };
    room.syncRoom();
    ctl.source = bot ? pilot : input;
    pilot.mv = { x: 0, z: 0 };
  }
  function startFly(at = 0) {
    mode = 'fly'; flyT = at; room = null; sys.clear(); vfx.clear();
    rig.group.visible = false; cam.follow = false;
    for (let i = 0; i < ROOMS; i++) if (rooms[i].played) rebuildRoom(i);
    for (const r of rooms) r.titleT = -1;
    world.room = { index: 0, kind: 'showcase', id: 'arenas' };
  }
  const flyCam = (t) => {
    // returns {x, z, room} for tick t of the fly-through
    const seg = DWELL + TRAVEL;
    const i = Math.floor(t / seg), u = t - i * seg;
    if (i >= ROOMS) {
      const k = clamp01((t - ROOMS * seg) / 100);
      const fromX = ox(ROOMS - 1) + 1.4, toX = ox(playIdx);
      return { x: lerp(fromX, toX, ease(k)), z: CAM_Z, room: playIdx, done: k >= 1, dwelling: false, i: ROOMS };
    }
    if (u < DWELL) {
      const k = u / DWELL;
      return { x: ox(i) + lerp(-1.5, 1.5, ease(k)), z: CAM_Z + lerp(0.55, -0.25, ease(k)), room: i, dwelling: true, u, i };
    }
    const k = (u - DWELL) / TRAVEL, from = ox(i) + 1.5, to = i + 1 < ROOMS ? ox(i + 1) - 1.5 : ox(i) + 1.5;
    return { x: lerp(from, to, ease(k)), z: CAM_Z - 0.25 + 0.25 * ease(k), room: i, dwelling: false, i };
  };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  let lastFlyRoom = -1;

  function setZoom(z) { zoom = z; display.setZoom(zoom); }

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      loop.setTimeScale(SLOWS[slowIdx]);
      display.setZoom(zoom);
      vfx.attach(root, { ambient: 'crypt' });
      cw0 = new CollisionWorld();
      setCollision(cw0);
      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: 0, z: 0, yaw: 0 });
      ctl = new HeroController({ x: 0, z: 0, yaw: 0, anim, collision: cw0, source: bot ? pilot : input });
      health = new HeroHealth({ ctl, anim, rig, hp: 5 });
      world.hero = health;
      sys = createEnemySystem(root, { hero: health, collision: cw0, bounds: null, list: world.enemies, ai: true });
      combat = new HeroCombat({ ctl, anim, health, targets: () => (room ? [...world.enemies, ...room.targets()] : world.enemies) });
      cfx = createCombatFx(root, { numbers: false });
      cam = new CameraRig({});
      display.setZoom(zoom);
      for (let i = 0; i < ROOMS; i++) buildRoom(i);
      cam.reset(0, CAM_Z);

      const on = (n, fn) => offs.push(events.on(n, fn));
      on('input:press', (e) => { if (bot && mode === 'play' && e.action !== 'pause') goLive(); });
      on('hero:dead', () => { deadT = 0; });
      on('combat:heroHurt', () => { hurtFlash = 0; });
      on('arena:wave', (e) => { if (room) room.banner = { kind: 'wave', n: e.n, total: e.total, t: 0 }; });
      on('arena:exit', () => { exitT = 0; });
      debug.handle('spawn', (type, x, z) => sys.handleSpawn(type, x, z) ?? { ok: false, error: `no enemy type "${type}"` });
      debug.handle('goto', (i) => { const n = Math.max(0, Math.min(ROOMS - 1, (i | 0))); startPlay(n); return { ok: true, room: n }; });

      if (arenaP) { startPlay(Math.max(0, Math.min(ROOMS - 1, arenaP - 1)), { fresh: false }); }
      else startFly(t0);
    },

    exit() {
      offs.forEach((f) => f()); offs = [];
      for (const a of rooms) a?.dispose();
      rooms.length = 0;
      cfx?.dispose(); sys?.dispose(); vfx.detach();
      loop.setTimeScale(1);
      setCollision(null);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
      debug.handle('goto', () => ({ ok: false, error: 'no rooms in this scene' }));
    },

    frame() {
      const k = input.ui.key;
      if (k('KeyZ')) { setZoom(zoom >= 3 ? 1 : zoom + 1); say(`ZOOM ${zoom}X`); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) hud = !hud;
      if (k('KeyF')) { startFly(0); say('FLY-THROUGH'); }
      if (k('KeyB') && mode === 'play') { bot = !bot; ctl.source = bot ? pilot : input; say(bot ? 'BOT PLAYS' : 'LIVE'); }
      if (k('KeyC') && mode === 'play') { room.forceClear(); say('CLEARED'); }
      if (k('KeyV')) sys.kill('all');
      if (k('KeyR') && mode === 'play') { startPlay(roomIdx); say('RESTART'); }
      const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].findIndex((c) => k(c));
      if (digit >= 0) { startPlay(digit); say(`ROOM ${digit + 1}`); }
      // in the fly-through, any movement key takes over
      if (mode === 'fly' && (input.ui.pressed('attack') || input.ui.pressed('dash') || input.ui.pressed('up') || input.ui.pressed('down') || input.ui.pressed('left') || input.ui.pressed('right'))) {
        const near = Math.max(0, Math.min(ROOMS - 1, Math.round(camX / STEP)));
        bot = false; startPlay(near); say(`YOUR TURN: ROOM ${near + 1}`);
      }
    },

    tick() {
      if (mode === 'fly') {
        const c = flyCam(flyT++);
        camX = c.x; camZ = c.z;
        if (c.dwelling && c.u === 6 && lastFlyRoom !== c.i) { lastFlyRoom = c.i; rooms[c.i].enter(); }
        if (c.dwelling && c.u > 12 && c.u < 20 && c.i === lastFlyRoom) { /* title card is up */ }
        if (c.done && !flyOnly) { startPlay(playIdx); lastFlyRoom = -1; }
        if (c.done && flyOnly) { startFly(0); lastFlyRoom = -1; }
        for (const r of rooms) r.tick();
        vfx.tick();
        return;
      }
      if (bot) botStep();
      combat.tick();
      cam.tick(ctl);
      sys.tick();
      room.tick();
      cfx.tick();
      vfx.tick();
      hurtFlash++;
      if (deadT >= 0 && ++deadT > 90) { say('BACK ON YOUR FEET'); startPlay(roomIdx); }
      if (exitT >= 0 && ++exitT > 50) {
        exitT = -1;
        if (bot && !arenaP) { startFly(0); lastFlyRoom = -1; say('THE END OF THE REEL'); }
        else { const n = (roomIdx + 1) % ROOMS; startPlay(n); say(`ROOM ${n + 1}`); }
      }
    },

    render(alpha) {
      if (mode === 'fly') {
        display.setCameraTarget(camX + (0), 0.55, camZ);
        for (const r of rooms) r.render(alpha);
        vfx.render(alpha);
        return;
      }
      anim.render(alpha);
      health.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y, off.z);
      sys.render(alpha);
      for (const r of rooms) r.render(alpha);
      cfx.render(alpha);
      vfx.render(alpha);
    },

    ui(g) {
      const W = display.width, H = display.height;
      if (mode === 'play') { cfx.ui(g); sys.ui(g); }
      vfx.ui(g);
      // the rooms' own cards and banners
      if (mode === 'fly') { for (const r of rooms) if (r.titleT >= 0) r.ui(g); } else room?.ui(g);
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, H - 34, 'gold', { align: 'center', outline: 'ink' });
      if (!hud) return;
      drawText(g, 'ARENAS', 8, 8, 'bone', { outline: 'ink' });
      if (mode === 'fly') {
        const c = flyCam(Math.max(0, flyT - 1));
        const i = Math.min(ROOMS - 1, c.i ?? 0);
        drawText(g, `FLY-THROUGH  ROOM ${i + 1}/${ROOMS}  ${rooms[i].name}`, 8, 18, 'mist', { shadow: 'ink' });
        drawText(g, `SEED ${seed}  PLAN ${describePlan(rooms[i].layout.plan)}`, 8, 28, 'slate', { shadow: 'ink' });
      } else {
        const inf = room.info();
        drawText(g, `ROOM ${roomIdx + 1}/${ROOMS}  ${inf.name}  ${bot ? '(BOT PLAYS, ANY KEY TAKES OVER)' : '(LIVE)'}`, 8, 18, bot ? 'mist' : 'leaf', { shadow: 'ink' });
        drawText(g, `STATE ${inf.state.toUpperCase()}   WAVE ${inf.wave}/${inf.waves}   ALIVE ${inf.alive}   KILLS ${inf.kills}/${inf.total}   SEED ${seed}${inf.mirror ? ' M' : ''}`, 8, 28, 'mist', { shadow: 'ink' });
        drawText(g, `PLAN ${inf.plan}`, 8, 38, 'slate', { shadow: 'ink' });
        // hero hp pips
        const hp = health.hp, mx = health.maxHp;
        const pw = 9, gap = 3, px0 = W - 8 - mx * (pw + gap) + gap;
        const sx = hurtFlash < 8 ? ((hurtFlash % 2) ? 1 : -1) : 0;
        for (let i = 0; i < mx; i++) {
          const x = px0 + i * (pw + gap) + sx, y = 8;
          g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, pw + 2, pw + 2);
          g.fillStyle = css(i >= hp ? 'shadow' : 'red'); g.fillRect(x, y, pw, pw);
          if (i < hp) { g.fillStyle = css('rose'); g.fillRect(x + 1, y + 1, 3, 2); }
        }
      }
      const help = mode === 'fly' ? 'ANY KEY: PLAY   1-5 ROOM   Z ZOOM   T SLOW   H HUD' : 'WASD MOVE  J ATTACK  K DASH  1-5 ROOM  C CLEAR  R RESTART  F FLY  B BOT  Z ZOOM  H HUD';
      const w = textWidth(help) + 8;
      g.fillStyle = css('ink'); g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
      drawText(g, help, W / 2, H - 10, 'slate', { align: 'center' });
    },

    state() {
      return {
        showcase: {
          id: 'arenas', mode, seed, bot, zoom: display.zoom, flyT, room: room ? room.info() : null, roomIdx,
          rooms: rooms.map((r) => ({ index: r.index, name: r.name, template: r.layout.template, mirror: r.layout.mirror, state: r.state, plan: describePlan(r.layout.plan), props: r.props.length })),
          templates: TEMPLATES.map((t) => t.id), health: health.info(),
        },
      };
    },
  };
}
