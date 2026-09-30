// ?showcase=arenas : the five arenas of a run, then one of them played.
//
// TOUR (default start): the five generated arenas of the seed stand side by side in the dark;
// the camera flies from one to the next and holds on each, with a card naming it and listing
// its seeded waves, so the escalation can be read off the screen. After arena 5 the showcase
// switches to PLAY.
//
// PLAY: the hero stands outside the entry gate of one arena (default: arena 3). The room is
// dark. A DEMO autopilot (keyboard-style input) walks in; the gate slams, the exit seals, the
// torches catch one by one, the waves come; it fights; the clear moment plays, the exit winds
// up, and it walks out, on to the next arena. Any key takes over (LIVE); B returns to DEMO.
//
// Params:  &seed=N              the run seed (arena choice, layout, surface and waves)
//          &mode=tour|play      where to start (default tour)
//          &arena=1..5          tour: start at / hold this arena; play: which arena (default 3)
//          &hold=1              tour: hold on one arena, no flight, no card (clean stills)
//          &lit=1               play: the room starts lit (default dark until the gate slams)
//          &auto=0              play: start LIVE
//          &zoom=1..3  &slow=<s>  &hud=0 (no showcase labels)  &banners=0 (no arena banners)
// Keys:    tour: Left/Right (A/D) previous/next arena, Space or Enter: play this arena
//          play: WASD move, J attack, K dash, B demo, R restart the arena, N next arena,
//                1-5 pick the arena, G replay the gate slam, C clear the room now
//          both: Tab switch tour/play, Z zoom, T slow-mo, H hud, P/Esc pause
// state().showcase = { id, mode, arena, order, stop, t, hero, room: arena.info() }

import * as THREE from 'three';
import { display, PPU, CAMERA_PITCH } from '../core/display.js';
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
import { createEnemies, spawnHandler } from '../enemies/index.js';
import { Arena, arenaOrder, TEMPLATES, setActiveArena } from './arena.js';
import { planRun, describeWave, arenaThreat } from './waves.js';

const SLOWS = [1, 0.5, 0.25, 0.1];
const SPACING = 27;
const FLY = 90, HOLD = 300;

export default function arenasShowcase(params) {
  const seed = parseInt(params.get('seed') ?? '1', 10) || 1;
  const O = {
    hud: params.get('hud') !== '0',
    banners: params.get('banners') !== '0',
    zoom: Math.max(1, Math.min(3, parseInt(params.get('zoom') ?? '1', 10) || 1)),
    slow: parseFloat(params.get('slow') ?? '1') || 1,
    hold: params.get('hold') === '1',
    lit: params.get('lit') === '1',
    status: { text: '', until: 0 },
  };
  const say = (t) => { O.status.text = t; O.status.until = loop.realTime + 1.3; };
  const arenaParam = Math.max(1, Math.min(5, parseInt(params.get('arena') ?? '0', 10) || 0)) - 1;   // -1: none
  let mode = params.get('mode') === 'play' ? 'play' : 'tour';
  let auto = params.get('auto') !== '0';
  let slowIdx = Math.max(0, SLOWS.indexOf(O.slow));
  const order = arenaOrder(seed);
  const plans = planRun(seed);

  let root = null, content = null;
  let offs = [];
  let wipe = null;              // {t, dur, fn}: an ink curtain; fn runs at the midpoint

  // ---------------------------------------------------------------------------------
  // TOUR
  // ---------------------------------------------------------------------------------
  const tour = { arenas: [], stop: 0, t: 0, from: 0, camX: 0, camZ: -0.9 };
  function buildTour(startAt = 0) {
    for (let i = 0; i < 5; i++) tour.arenas.push(new Arena(content, { index: i, seed, ox: i * SPACING, oz: 0, lit: true }));
    tour.stop = startAt; tour.t = O.hold ? FLY : 0;
    tour.from = startAt === 0 ? -SPACING * 0.55 : (startAt - 1) * SPACING;
    tour.camX = tour.from;
    world.room = { index: startAt, kind: 'arena', showcase: 'tour', id: order[startAt] };
    display.setZoom(O.zoom);
  }
  function tickTour() {
    for (const a of tour.arenas) a.tick();
    tour.t++;
    const to = tour.stop * SPACING;
    if (tour.t <= FLY) {
      const k = tour.t / FLY, e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      tour.camX = tour.from + (to - tour.from) * e;
    } else {
      // a slow drift while holding, so nothing is ever quite still
      const h = (tour.t - FLY) / HOLD;
      tour.camX = to + (O.hold ? 0 : Math.sin(h * Math.PI - Math.PI / 2) * 0.8);
    }
    if (!O.hold && tour.t >= FLY + HOLD) {
      if (tour.stop < 4) goStop(tour.stop + 1);
      else startWipe(() => enterPlay(arenaParam >= 0 ? arenaParam : 2));
    }
    world.room.index = tour.stop; world.room.id = order[tour.stop];
  }
  function goStop(i) {
    tour.from = tour.camX;
    tour.stop = (i + 5) % 5; tour.t = 0;
  }

  // ---------------------------------------------------------------------------------
  // PLAY
  // ---------------------------------------------------------------------------------
  const P = { arena: null, idx: 0, rig: null, anim: null, ctl: null, health: null, combat: null, cfx: null, mgr: null, cam: null, deadT: -1, exitT: -1, tally: { kills: 0, hurt: 0, broken: 0 } };
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, n: 0, dashCool: 0, atkCool: 0, label: '', stuck: 0, lx: 0, lz: 0, side: 1,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };

  function enterPlay(i) {
    clearContent();
    mode = 'play';
    P.idx = i;
    const A = P.arena = new Arena(content, { index: i, seed, lit: O.lit });
    setActiveArena(A);
    setCollision(A.cw);
    const S = A.start;
    P.rig = createHeroRig();
    content.add(P.rig.group);
    P.anim = new HeroAnim(P.rig, { x: S.x, z: S.z, yaw: S.yaw });
    P.ctl = new HeroController({ x: S.x, z: S.z, yaw: S.yaw, anim: P.anim, collision: A.cw, source: auto ? pilot : input });
    P.health = new HeroHealth({ ctl: P.ctl, anim: P.anim, rig: P.rig, hp: 5 });
    P.combat = new HeroCombat({ ctl: P.ctl, anim: P.anim, health: P.health, targets: () => [...world.enemies, ...A.targets()] });
    world.hero = P.health;
    world.enemies = [];
    P.mgr = createEnemies(content, { collision: A.cw, bounds: A.bounds });
    debug.handle('spawn', spawnHandler(P.mgr));
    P.cfx = createCombatFx(content, { numbers: true });
    vfx.bind(['move']);
    P.cam = new CameraRig({});
    setZoom(O.zoom);
    P.cam.reset(S.x, S.z - 2);
    A.play({ foes: P.mgr, hero: () => P.ctl, lit: O.lit });
    P.deadT = -1; P.exitT = -1;
    P.tally = { kills: 0, hurt: 0, broken: 0 };
    world.room = { index: i, kind: 'arena', showcase: 'play', id: A.id, title: A.title, mode: A.mode, wave: 0, total: A.plan.waves.length };
  }

  function camBounds() {
    const A = P.arena;
    const hw = display.width / (2 * PPU * O.zoom), hd = display.height / (2 * PPU * O.zoom * Math.sin(CAMERA_PITCH));
    const B = A.bounds;
    // the back wall stands ~3.75 units tall: keep its top in view
    const minZ = B.minZ - 3.2, maxZ = B.maxZ + 1.2;
    const cx = (B.minX + B.maxX) / 2, cz = (minZ + maxZ) / 2;
    const bx = Math.max(0, (B.maxX - B.minX) / 2 + 0.6 - hw), bz = Math.max(0, (maxZ - minZ) / 2 - hd);
    return { minX: cx - bx, maxX: cx + bx, minZ: cz - bz, maxZ: cz + bz };
  }
  function setZoom(z) { O.zoom = z; display.setZoom(z); if (P.cam && P.arena) P.cam.bounds = camBounds(); }

  // ---- demo autopilot: walk in, fight the way the enemies are meant to be fought, walk out
  function threatDir() {
    const ctl = P.ctl, hx = ctl.x, hz = ctl.z;
    for (const e of P.mgr.list) {
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
    for (const o of P.mgr.orbs) {
      const rx = hx - o.x, rz = hz - o.z, sp = Math.hypot(o.vx, o.vz), d = Math.hypot(rx, rz);
      if (d > 1.4) continue;
      if ((rx * o.vx + rz * o.vz) / sp > 0) return { x: -o.vz / sp, z: o.vx / sp };
    }
    return null;
  }
  function away(x, z, bend) {
    const ctl = P.ctl;
    let dx = ctl.x - x, dz = ctl.z - z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    return { x: dx * (1 - bend * 0.5) + dz * bend * 0.5, z: dz * (1 - bend * 0.5) - dx * bend * 0.5 };
  }
  const isOpen = (e) => ['recover', 'dazed', 'hurt', 'skid', 'roar'].includes(e.state) || e.kind === 'wisp';
  function steer(tx, tz, k = 1) {
    const ctl = P.ctl;
    let dx = tx - ctl.x, dz = tz - ctl.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    // stuck on a pillar or a pit edge: slide round it to one side for a while
    if (pilot.stuck > 14) { const s = pilot.side; const ox = dx; dx = dx * 0.35 + dz * s; dz = dz * 0.35 - ox * s; }
    pilot.mv = { x: dx * k, z: dz * k };
    return d;
  }
  function pilotStep() {
    const ctl = P.ctl, A = P.arena;
    pilot.mv = { x: 0, z: 0 };
    if (pilot.dashCool > 0) pilot.dashCool--;
    if (pilot.atkCool > 0) pilot.atkCool--;
    const moved = Math.hypot(ctl.x - pilot.lx, ctl.z - pilot.lz);
    pilot.lx = ctl.x; pilot.lz = ctl.z;
    if (P.health.dead) return;
    // a beat on the threshold, looking into the dark room, then in
    if (A.mode === 'waiting') { if (A.modeT < 50) return; pilot.label = 'ENTER'; steer(A.gateCenter.x, A.gateCenter.z - 2.2, 0.8); return; }
    if (A.mode === 'open' || A.mode === 'exited' || (A.mode === 'clearing' && A.exit.state !== 'closed' && A.modeT > 60)) {
      pilot.label = 'ONWARD';
      const e = A.exitPoint;
      // line up under the arch, then straight in
      if (Math.abs(ctl.x - e.x) > 0.25 && ctl.z < e.z + 2.2) steer(e.x, e.z + 1.6, 0.9); else steer(e.x, e.z - 1, 0.9);
      return;
    }
    if (A.mode === 'sealing') { pilot.label = ''; const gz = A.gateCenter.z - 2.6; if (ctl.z > gz + 0.1) steer(A.gateCenter.x, gz, 0.45); return; }
    if (A.mode === 'clearing') { pilot.label = ''; return; }
    const th = threatDir();
    if (th && pilot.dashCool <= 0 && ctl.dashReady) {
      pilot.n++; pilot.dashCool = 30;
      if (pilot.n % 3 !== 0) { pilot.mv = th; pilot.want.dash = true; pilot.label = 'DODGE'; return; }
      pilot.label = 'TANK IT';
    }
    let best = null, bs = Infinity;
    for (const e of P.mgr.list) {
      if (e.dying || e.dead || !e.visible || e.state === 'spawn') continue;
      const d = Math.hypot(e.x - ctl.x, e.z - ctl.z) - (e.state === 'dazed' ? 6 : isOpen(e) ? 2 : 0);
      if (d < bs) { bs = d; best = e; }
    }
    if (!best) {
      // between waves: drift back toward the middle of the room
      const c = A.center; if (Math.hypot(ctl.x - c.x, ctl.z - c.z) > 1.5) steer(c.x, c.z + 0.5, 0.5);
      return;
    }
    // stuck detection only while trying to move
    if (moved < 0.01 && Math.hypot(pilot.mv.x, pilot.mv.z) === 0) pilot.stuck = Math.max(0, pilot.stuck - 1);
    const d = Math.hypot(best.x - ctl.x, best.z - ctl.z);
    const reach = best.r + 0.9;
    if (isOpen(best)) {
      pilot.label = best.state === 'dazed' ? 'PUNISH' : pilot.label;
      if (d > reach) steer(best.x, best.z, Math.min(1, (d - reach) / 0.4 + 0.3));
      else {
        if (P.anim.state !== 'attack') steer(best.x, best.z, 0.2);
        if (pilot.atkCool <= 0) { pilot.want.attack = true; pilot.atkCool = 13; }
      }
    } else {
      const keep = best.kind === 'brute' ? 3.4 : best.kind === 'mite' ? 1.9 : 1.75;
      if (d < keep - 0.4) { const b = away(best.x, best.z, 0); pilot.mv = { x: b.x * 0.8, z: b.z * 0.8 }; }
      else if (d > keep + 1.2) steer(best.x, best.z, 0.7);
      else steer(best.x, best.z, 0.12);
    }
    const trying = Math.hypot(pilot.mv.x, pilot.mv.z) > 0.4;
    if (trying && moved < 0.012) { pilot.stuck++; if (pilot.stuck === 15) pilot.side = -pilot.side; } else if (pilot.stuck > 0) pilot.stuck--;
    if (pilot.stuck > 60) pilot.stuck = 0;
  }
  function goLive() { if (!auto || mode !== 'play') return; auto = false; P.ctl.source = input; say('LIVE'); }
  function goDemo() { auto = true; if (P.ctl) P.ctl.source = pilot; say('DEMO'); }

  function tickPlay() {
    const A = P.arena;
    if (auto) pilotStep();
    P.combat.tick();
    P.cam.tick(P.ctl);
    P.mgr.tick();
    A.tick();
    P.cfx.tick();
    Object.assign(world.room, { mode: A.mode, wave: A.director?.wave ?? 0 });
    if (P.deadT >= 0 && ++P.deadT > 60) {
      P.deadT = -1;
      const c = A.center; P.ctl.teleport(c.x, c.z + 1, Math.PI);
      P.health.revive();
      say('BACK ON YOUR FEET');
    }
    if (A.mode === 'exited' && P.exitT < 0) P.exitT = 0;
    if (P.exitT >= 0 && ++P.exitT === 30) startWipe(() => enterPlay((P.idx + 1) % 5));
  }

  // ---------------------------------------------------------------------------------
  function clearContent() {
    for (const a of tour.arenas) a.dispose();
    tour.arenas = [];
    if (P.arena) { P.arena.dispose(); P.arena = null; setActiveArena(null); }
    P.cfx?.dispose(); P.cfx = null;
    P.mgr?.dispose(); P.mgr = null;
    vfx.clear();
    setCollision(null);
    world.enemies = []; world.hero = null;
    if (content) root.remove(content);
    content = new THREE.Group();
    root.add(content);
    loop.setTimeScale(SLOWS.includes(O.slow) ? SLOWS[slowIdx] : O.slow);
  }
  function enterTour(i = 0) { clearContent(); mode = 'tour'; buildTour(i); }
  function startWipe(fn) { if (!wipe) wipe = { t: 0, dur: 36, fn, done: false }; }

  return {
    pausable: true,
    enter(_d, r) {
      root = r;
      world.reset();
      look.mood('crypt');
      loop.setTimeScale(SLOWS.includes(O.slow) ? SLOWS[slowIdx] : O.slow);
      const on = (n, f) => offs.push(events.on(n, f));
      on('input:press', (e) => { if (auto && mode === 'play' && !['pause'].includes(e.action) && e.device !== 'script') goLive(); });
      on('combat:heroHurt', () => { P.tally.hurt++; });
      on('enemy:death', () => { P.tally.kills++; });
      on('arena:propBreak', () => { P.tally.broken++; });
      on('combat:heroDeath', () => { P.deadT = 0; });
      debug.handle('goto', (i) => { const k = Math.max(0, Math.min(4, (i | 0))); startWipe(() => enterPlay(k)); wipe.t = 18; return { ok: true, arena: k }; });
      if (mode === 'play') enterPlay(arenaParam >= 0 ? arenaParam : 2);
      else enterTour(arenaParam >= 0 ? arenaParam : 0);
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      clearContent();
      loop.setTimeScale(1);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
      debug.handle('goto', () => ({ ok: false, error: 'no rooms in this scene' }));
    },
    frame() {
      const k = input.ui.key;
      if (k('Tab')) { if (mode === 'tour') startWipe(() => enterPlay(tour.stop)); else startWipe(() => enterTour(P.idx)); }
      if (mode === 'tour') {
        if (k('ArrowRight') || k('KeyD')) goStop(tour.stop + 1);
        if (k('ArrowLeft') || k('KeyA')) goStop(tour.stop - 1);
        if (k('Space') || k('Enter')) startWipe(() => enterPlay(tour.stop));
      } else {
        if (k('KeyB')) goDemo();
        if (k('KeyR')) { startWipe(() => enterPlay(P.idx)); }
        if (k('KeyN')) { startWipe(() => enterPlay((P.idx + 1) % 5)); }
        ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].forEach((d, i) => { if (k(d)) startWipe(() => enterPlay(i)); });
        if (k('KeyG') && P.arena) { replaySlam(); say('GATE SLAM'); }
        if (k('KeyC') && P.arena) { forceClear(); say('CLEAR'); }
      }
      if (k('KeyZ')) { setZoom(O.zoom >= 3 ? 1 : O.zoom + 1); say(`ZOOM ${O.zoom}X`); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) O.hud = !O.hud;
    },
    tick() {
      if (wipe) {
        wipe.t++;
        if (!wipe.done && wipe.t >= wipe.dur / 2) { wipe.done = true; wipe.fn(); }
        if (wipe.t >= wipe.dur) wipe = null;
      }
      if (mode === 'tour') tickTour(); else if (P.arena) tickPlay();
    },
    render(alpha) {
      if (mode === 'tour') {
        for (const a of tour.arenas) a.render(alpha);
        display.setCameraTarget(tour.camX, 0, -0.95);
        return;
      }
      if (!P.arena) return;
      P.anim.render(alpha);
      P.health.render();
      const off = P.cam.render(alpha, P.ctl.at(alpha));
      P.rig.group.position.set(off.x, off.y, off.z);
      P.mgr.render(alpha);
      P.arena.render(alpha);
      P.cfx.render(alpha);
    },
    ui(g) {
      const W = display.width, H = display.height;
      if (mode === 'play' && P.arena) { P.cfx.ui(g); if (O.banners) P.arena.ui(g); }
      if (O.status.text && loop.realTime < O.status.until) drawText(g, O.status.text, W / 2, 70, 'gold', { align: 'center', outline: 'ink' });
      if (O.hud) (mode === 'tour' ? tourHud : playHud)(g, W, H);
      if (wipe) drawWipe(g, W, H);
    },
    state() {
      const room = mode === 'tour' ? tour.arenas[tour.stop]?.info() : P.arena?.info();
      return { showcase: { id: 'arenas', mode, seed, order, arena: mode === 'tour' ? tour.stop : P.idx, stop: tour.stop, t: tour.t, auto,
        hero: P.ctl && mode === 'play' ? { x: +P.ctl.x.toFixed(2), z: +P.ctl.z.toFixed(2), hp: P.health.hp } : null,
        tally: { ...P.tally }, threat: plans.map(arenaThreat), room } };
    },
  };

  function replaySlam() {
    const A = P.arena;
    if (A.mode === 'waiting') { A.slam(); return; }
    // lift the gate back up instantly and drop it again (the room stays as it is)
    A.gate.state = 'falling'; A.gate.y = A.gate.py = -(12 + 4) / 8; A.gate.vy = 0;
    if (A.gateBox) { A.cw.remove(A.gateBox); A.gateBox = null; }
  }
  function forceClear() {
    const A = P.arena;
    if (A.mode === 'waiting') A.slam();
    for (const e of P.mgr.list) if (!e.dying) e.takeHit({ dmg: 9999, dx: 0, dz: 1, tx: 0, tz: 0, power: 2, step: 2, finisher: true, knock: 2, lift: 0, stopMs: 60, flashTicks: 4 });
    if (A.director) { A.director.state = 'done'; }
    if (A.mode !== 'clearing' && A.mode !== 'open') { A._setMode('fighting'); A.clearRoom(P.ctl.x, P.ctl.z - 1); }
  }

  // ---- HUD ----------------------------------------------------------------------------
  function helpBar(g, W, H, text) {
    const w = textWidth(text) + 8;
    g.fillStyle = css('ink'); g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
    drawText(g, text, W / 2, H - 10, 'slate', { align: 'center' });
  }
  function threatBars(g, x, y, cur) {
    const th = plans.map(arenaThreat), mx = Math.max(...th);
    drawText(g, 'THREAT', x, y, 'slate', { shadow: 'ink' });
    for (let i = 0; i < 5; i++) {
      const bx = x + 34 + i * 9, h = Math.max(2, Math.round((th[i] / mx) * 16));
      g.fillStyle = css('ink'); g.fillRect(bx - 1, y + 7 - h - 1 + 1, 7, h + 1);
      g.fillStyle = css(i === cur ? 'red' : 'blood'); g.fillRect(bx, y + 7 - h + 1, 5, h - 1);
    }
  }
  function tourHud(g, W, H) {
    const A = tour.arenas[tour.stop];
    drawText(g, `ARENAS  SEED ${seed}`, 6, 6, 'mist', { shadow: 'ink' });
    for (let i = 0; i < 5; i++) {
      const on = i === tour.stop;
      if (on) { g.fillStyle = css('ink'); g.fillRect(4, 16 + i * 9, 132, 9); }
      drawText(g, `${i + 1} ${TEMPLATES[order[i]].title}`, 6, 17 + i * 9, on ? 'gold' : 'slate', { shadow: on ? null : 'ink' });
    }
    threatBars(g, 6, 66, tour.stop);
    if (!O.hold && A && tour.t > FLY - 10) {
      // the card: name, size, and the seeded waves
      const k = Math.min(1, (tour.t - FLY + 10) / 12);
      const lines = plans[tour.stop].waves.map((w, i) => `WAVE ${i + 1}  ${describeWave(w)}`);
      const cw = Math.max(textWidth(A.title) * 2, ...lines.map(textWidth)) + 20;
      const x = Math.round(W - cw - 8 + (1 - k) * 20), y = H - 30 - 26 - lines.length * 10;
      g.fillStyle = css('ink'); g.fillRect(x, y, cw, 30 + lines.length * 10);
      g.fillStyle = css('gold'); g.fillRect(x, y, Math.round(cw * k), 2);
      drawText(g, `ARENA ${tour.stop + 1} OF 5  ${A.W}X${A.D}  ${A.L.themeId.toUpperCase()}${A.L.mirror ? '  MIRRORED' : ''}`, x + 10, y + 5, 'fog', {});
      drawText(g, A.title, x + 10, y + 14, 'bone', { scale: 2 });
      lines.forEach((l, i) => drawText(g, l, x + 10, y + 30 + i * 10, i === lines.length - 1 ? 'rose' : 'mist', {}));
    }
    helpBar(g, W, H, '< > ARENA  SPACE PLAY IT  TAB PLAY  Z ZOOM  T SLOW  H HUD');
  }
  function playHud(g, W, H) {
    const A = P.arena; if (!A) return;
    drawText(g, `ARENAS  SEED ${seed}  ARENA ${P.idx + 1}/5`, 6, 6, 'mist', { shadow: 'ink' });
    drawText(g, auto ? 'DEMO  (ANY KEY: TAKE OVER)' : 'LIVE  (B: DEMO)', 6, 16, auto ? 'mist' : 'leaf', { shadow: 'ink' });
    const tag = { waiting: 'GATE OPEN', sealing: 'SEALED', fighting: 'FIGHT', clearing: 'CLEARED', open: 'EXIT OPEN', exited: 'ONWARD' }[A.mode] ?? A.mode.toUpperCase();
    drawText(g, tag, 6, 26, A.mode === 'fighting' ? 'red' : A.mode === 'open' || A.mode === 'clearing' ? 'gold' : 'fog', { shadow: 'ink' });
    if (auto && pilot.label) drawText(g, pilot.label, 6, 36, pilot.label === 'DODGE' ? 'sky' : 'rose', { shadow: 'ink' });
    threatBars(g, 6, 48, P.idx);
    // right: hp pips, wave, counts
    const hp = P.health.hp, mx = P.health.maxHp, pw = 9, gap = 3, px0 = W - 8 - mx * (pw + gap) + gap;
    for (let i = 0; i < mx; i++) {
      const x = px0 + i * (pw + gap), y = 8;
      g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, pw + 2, pw + 2);
      g.fillStyle = css(i >= hp ? 'shadow' : 'red'); g.fillRect(x, y, pw, pw);
      if (i < hp) { g.fillStyle = css('rose'); g.fillRect(x + 1, y + 1, 3, 2); }
    }
    let ry = 22;
    const row = (t, c) => { drawText(g, t, W - 8, ry, c, { align: 'right', shadow: 'ink' }); ry += 10; };
    const D = A.director;
    if (D) row(`WAVE ${Math.max(0, D.wave)}/${D.total}  ALIVE ${P.mgr.alive}`, 'mist');
    row(`KILLS ${P.tally.kills}  HITS TAKEN ${P.tally.hurt}  SMASHED ${P.tally.broken}`, 'slate');
    if (loop.timeScale !== 1 && A.mode !== 'clearing') row(`X${loop.timeScale}`, 'gold');
    helpBar(g, W, H, 'WASD J K  B DEMO  R RESTART  N NEXT  1-5 ARENA  G SLAM  C CLEAR  TAB TOUR  Z T H');
  }
  function drawWipe(g, W, H) {
    // ink columns drop in stepped from the top, then pull away downward
    const k = wipe.t / wipe.dur;
    const cols = 16, cw = Math.ceil(W / cols);
    g.fillStyle = css('ink');
    for (let c = 0; c < cols; c++) {
      const lag = ((c * 7) % cols) / cols * 0.35;
      if (k < 0.5) {
        const h = Math.max(0, Math.min(1, (k * 2 - lag) / (1 - 0.35)));
        g.fillRect(c * cw, 0, cw, Math.round(Math.round(h * 8) / 8 * H));
      } else {
        const h = Math.max(0, Math.min(1, ((k - 0.5) * 2 - lag) / (1 - 0.35)));
        const top = Math.round(Math.round(h * 8) / 8 * H);
        g.fillRect(c * cw, top, cw, H - top);
      }
    }
  }
}
