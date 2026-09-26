// ?showcase=enemies : the cast, then a fight.
//
//   ?showcase=enemies                a looping reel on the foundation stage: all four archetypes
//                                    spawn in (names under each), each shows its telegraph and
//                                    attack in place, the brute charges into the wall and stuns
//                                    itself, then each one dies.
//   ?showcase=enemies&fight=<type>   spawns one against the hero (husk | wisp | brute | mite |
//                                    all). A bot plays the hero (it dashes telegraphs, swings a
//                                    combo); any key takes over. Waves respawn when cleared.
//
// Params:  &fight=husk|wisp|brute|mite|all   &n=<count of that type, default 1 (mite: groups of 5)>
//          &bot=0             start LIVE          &at=spawn|idle|husk|wisp|mite|brute|death (reel)
//          &zoom=1..3         (default 2)         &slow=<s>       &hud=0 clean stills
//          &hp=<x> &speed=<x> &aggr=<x>           difficulty knobs (data, see data.js)
//          &bars=0            no enemy hp bars     &cx=<x>&cz=<z> where the camera looks (close-ups)
// Keys:    WASD move  J attack  K dash  1 husk  2 wisp  3 brute  4 mite swarm  5 all  V kill all
//          C clear  B bot  L reel/fight  G difficulty  Z zoom  T slow  H hud  P/Esc pause

import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { buildStage } from '../core/stage.js';
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
import { createEnemySystem, ENEMIES, TYPES, setKnobs, knobs } from './index.js';

const TAU = Math.PI * 2;
const SLOWS = [1, 0.5, 0.25];
const TORCHES = [[-4.2, -3.3], [4.2, -3.3], [-4.2, 3.3], [4.2, 3.3]];
const BOUNDS = { minX: -4.6, maxX: 4.6, minZ: -4.6, maxZ: 4.6 };
const ROW_Z = -1.3;
const CAST = [
  { kind: 'husk', x: -3.3, n: 1 }, { kind: 'wisp', x: -1.15, n: 1 }, { kind: 'brute', x: 1.25, n: 1 }, { kind: 'mite', x: 3.35, n: 5 },
];
// the reel: [tick, label, action]
const REEL = [
  [0, 'SPAWN', 'spawn'], [130, 'THE CAST', null],
  [230, 'HUSK', 'husk'], [320, 'EMBER WISP', 'wisp'], [410, 'MITE SWARM', 'mite'], [500, 'BRUTE', 'brute'],
  [830, 'DEATHS', null], [850, 'DEATHS', 'kill:husk'], [905, 'DEATHS', 'kill:wisp'], [950, 'DEATHS', 'kill:mite'], [1000, 'DEATHS', 'kill:brute'],
  [1180, '', 'loop'],
];
const DIFFS = [{ n: 'EASY', hp: 0.7, speed: 0.85, aggression: 0.75 }, { n: 'NORMAL', hp: 1, speed: 1, aggression: 1 }, { n: 'HARD', hp: 1.5, speed: 1.2, aggression: 1.6 }];

export default function enemiesShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  const fight = P('fight', null);
  let mode = fight ? 'fight' : 'reel';
  let bot = P('bot', '1') !== '0';
  let zoom = Math.max(1, Math.min(3, parseInt(P('zoom', '2'), 10) || 2));
  let hud = P('hud', '1') !== '0';
  const bars = P('bars', '1') !== '0';
  const slowP = parseFloat(P('slow', '1'));
  const at = P('at', null);
  const count = Math.max(1, parseInt(P('n', '1'), 10) || 1);
  let slowIdx = Math.max(0, SLOWS.indexOf(slowP)), customSlow = SLOWS.includes(slowP) ? null : slowP;
  let diff = 1;
  setKnobs({ hp: P('hp', knobs.hp), speed: P('speed', knobs.speed), aggression: P('aggr', knobs.aggression) });

  let root, stage, rig, anim, ctl, cam, health, combat, cfx, cw, sys;
  let offs = [];
  let reelT = 0, beat = '', deadT = -1, respawnT = -1, kills = 0, wave = 0, hurtFlash = 99;
  const status = { text: '', until: 0 };
  const say = (t) => { status.text = t; status.until = loop.realTime + 1.2; };
  const HERO0 = { x: 0, z: 2.4 };

  // ---- the bot: plays the hero so the fight shows itself. Any key takes over. ----------------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, atkCd: 0, dashCd: 0,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };
  function botStep() {
    pilot.mv = { x: 0, z: 0 };
    pilot.atkCd--; pilot.dashCd--;
    const hx = ctl.x, hz = ctl.z;
    const live = world.enemies.filter((e) => e.solid && !e.dead);
    if (health.dead) return;
    // dodge: step out of a telegraph that is about to land on us
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
    if (threat && pilot.dashCd <= 0 && !combat.info().busy) {
      pilot.mv = { x: threat.nx, z: threat.nz }; pilot.want.dash = true; pilot.dashCd = 34;
      return;
    }
    if (threat) { pilot.mv = { x: threat.nx, z: threat.nz }; return; }
    // otherwise: go after the nearest one and swing
    let best = null, bd = 1e9;
    for (const e of live) { const d = Math.hypot(e.x - hx, e.z - hz) - (e.kind === 'brute' && e.state === 'charge' ? 3 : 0); if (d < bd) { bd = d; best = e; } }
    if (!best) { const dx = HERO0.x - hx, dz = HERO0.z - hz, d = Math.hypot(dx, dz); if (d > 0.3) pilot.mv = { x: dx / d * 0.6, z: dz / d * 0.6 }; return; }
    const dx = best.x - hx, dz = best.z - hz, dist = Math.hypot(dx, dz);
    const stand = best.kind === 'brute' ? 1.25 : 1.0;
    if (dist > stand) { const k = Math.min(1, (dist - stand) / 0.4 + 0.25); pilot.mv = { x: dx / dist * k, z: dz / dist * k }; }
    else pilot.mv = { x: dx / dist * 0.05, z: dz / dist * 0.05 };   // just face it
    if (dist < stand + 0.55 && pilot.atkCd <= 0) { pilot.want.attack = true; pilot.atkCd = 13; }
  }
  function goLive() { if (!bot) return; bot = false; ctl.source = input; pilot.mv = { x: 0, z: 0 }; say('LIVE'); }

  // ---- spawning ---------------------------------------------------------------------------------
  function spawnCast() {
    sys.clear();
    for (const c of CAST) {
      if (c.n > 1) sys.spawnGroup(c.kind, c.x, ROW_Z, c.n, { yaw: 0, radius: 0.72 });
      else sys.spawn(c.kind, c.x, ROW_Z, { yaw: 0 });
    }
  }
  function ring(kind, n, i0 = 0) {
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i + i0 - (n - 1) / 2) * 0.9 + (Math.random() - 0.5) * 0.3, r = 3.2 + Math.random() * 0.6;
      const x = Math.max(-4, Math.min(4, ctl.x + Math.sin(a) * r)), z = Math.max(-4, Math.min(3.9, ctl.z - Math.abs(Math.cos(a)) * r));
      if (kind === 'mite') sys.spawnGroup('mite', x, z, 5, { radius: 0.5 }); else sys.spawn(kind, x, z, { delay: (i + i0) * 12 });
    }
  }
  function spawnWave() {
    wave++;
    if (fight === 'all' || mode === 'fight' && !fight) { ring('husk', 2); ring('wisp', 1, 2); ring('brute', 1, 3); ring('mite', 1, 4); }
    else if (TYPES.includes(fight)) ring(fight, count);
    else ring('husk', 1);
  }

  const CX = parseFloat(P('cx', '0')) || 0, CZ = parseFloat(P('cz', '0.3')) || 0;
  const camBounds = () => ({ minX: CX - 0.7, maxX: CX + 0.7, minZ: CZ - 0.5, maxZ: CZ + 0.3 });
  function setZoom(z) { zoom = z; display.setZoom(zoom); if (cam) cam.bounds = camBounds(); }
  function setMode(m) {
    mode = m;
    sys.clear(); vfx.clear();
    reelT = 0; beat = ''; respawnT = -1;
    ctl.teleport(HERO0.x, HERO0.z, 0); health.revive(); health.hp = health.maxHp; deadT = -1;
    if (m === 'reel') { sys.ai = false; spawnCast(); } else { sys.ai = true; ctl.teleport(0, 1.6, Math.PI); spawnWave(); }
  }

  function reelStep() {
    if (mode !== 'reel') return;
    const t = reelT++;
    for (let i = 0; i < REEL.length; i++) {
      const [at0, label, act] = REEL[i];
      if (t !== at0) continue;
      if (label) beat = label;
      if (!act) continue;
      if (act === 'spawn') spawnCast();
      else if (act === 'loop') { reelT = 0; spawnCast(); beat = 'SPAWN'; }
      else if (act.startsWith('kill:')) { for (const e of sys.mine) if (e.kind === act.slice(5)) e.kill(0.3, 1); }
      else { let i = 0; for (const e of sys.mine) if (e.kind === act && e.state === 'move') { if (act === 'mite') e.startIn = 1 + i++ * 9; else e.startAttack(); } }
    }
  }
  const jump = (name) => {
    const m = { spawn: 0, idle: 130, husk: 230, wisp: 320, mite: 410, brute: 500, death: 830 };
    if (m[name] === undefined) return;
    reelT = m[name];
    if (reelT > 60) { spawnCast(); }     // arrive at the beat with a cast already stood there
    // fast-forward the spawn animation so the beat starts on a full cast
    if (reelT > 60) for (const e of sys.mine) { e.st = 60; e.state = 'move'; e.spawnK = e.pspawnK = 1; e.updatePose?.(); }
    beat = REEL.filter((r) => r[0] <= reelT).pop()?.[1] ?? '';
    if (name === 'death') for (const e of sys.mine) e.state = 'move';
  };

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      if (customSlow !== null && Number.isFinite(customSlow)) loop.setTimeScale(customSlow); else loop.setTimeScale(SLOWS[slowIdx]);
      display.setZoom(zoom);
      stage = buildStage(root, { torches: TORCHES, rng: rng.fork('enemies-stage') });
      vfx.attach(root, { ambient: 'off' });
      cw = new CollisionWorld();
      cw.addRing(0, 0, 4.9);
      for (const [x, z] of TORCHES) cw.addCircle(x, z, 0.22, 'torch');
      setCollision(cw);

      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: HERO0.x, z: HERO0.z, yaw: 0 });
      ctl = new HeroController({ x: HERO0.x, z: HERO0.z, yaw: 0, anim, collision: cw, source: mode === 'fight' && bot ? pilot : input });
      health = new HeroHealth({ ctl, anim, rig, hp: 5 });
      world.hero = health;
      world.room = { index: 0, kind: 'showcase', id: 'enemies' };
      sys = createEnemySystem(root, { hero: health, collision: cw, bounds: BOUNDS, list: world.enemies, ai: mode === 'fight', bars });
      combat = new HeroCombat({ ctl, anim, health, targets: () => world.enemies });
      cfx = createCombatFx(root, { numbers: true });
      cam = new CameraRig({});
      setZoom(zoom);
      cam.reset(CX, CZ);

      const on = (n, fn) => offs.push(events.on(n, fn));
      on('input:press', (e) => { if (bot && mode === 'fight' && e.action !== 'pause') goLive(); });
      on('hero:dead', () => { deadT = 0; });
      on('combat:heroHurt', () => { hurtFlash = 0; });
      on('enemy:die', () => { kills++; });
      debug.handle('spawn', (type, x, z) => sys.handleSpawn(type, x, z) ?? { ok: false, error: `the enemies showcase spawns ${TYPES.join(', ')}, mites, not "${type}"` });

      if (mode === 'fight') { ctl.teleport(0, 1.6, Math.PI); spawnWave(); }
      else { spawnCast(); if (at) jump(at); }
    },

    exit() {
      offs.forEach((f) => f()); offs = [];
      cfx?.dispose(); sys?.dispose(); vfx.detach();
      loop.setTimeScale(1);
      setCollision(null);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },

    frame() {
      const k = input.ui.key;
      if (k('KeyZ')) { setZoom(zoom >= 3 ? 1 : zoom + 1); say(`ZOOM ${zoom}X`); }
      if (k('KeyT')) { customSlow = null; slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) hud = !hud;
      if (k('KeyL')) { setMode(mode === 'reel' ? 'fight' : 'reel'); say(mode === 'reel' ? 'THE CAST' : 'FIGHT'); }
      if (k('KeyB')) { bot = !bot; ctl.source = bot ? pilot : input; say(bot ? 'BOT PLAYS' : 'LIVE'); }
      if (k('KeyC')) { sys.clear(); say('CLEARED'); }
      if (k('KeyV')) { sys.kill('all'); }
      if (k('KeyG')) { diff = (diff + 1) % DIFFS.length; setKnobs(DIFFS[diff]); say(`DIFFICULTY ${DIFFS[diff].n}`); }
      const digit = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'].findIndex((c) => k(c));
      if (digit >= 0) {
        if (mode === 'reel') setMode('fight');
        const kinds = ['husk', 'wisp', 'brute', 'mite'];
        if (digit === 4) { ring('husk', 1); ring('wisp', 1, 1); ring('brute', 1, 2); ring('mite', 1, 3); } else ring(kinds[digit], 1, 1);
      }
    },

    tick() {
      stage.tick();
      if (mode === 'fight' && bot) botStep();
      reelStep();
      combat.tick();
      cam.tick(ctl);
      sys.tick();
      cfx.tick();
      vfx.tick();
      hurtFlash++;
      if (deadT >= 0 && ++deadT > 70) { deadT = -1; sys.clear(); ctl.teleport(0, 1.6, Math.PI); health.revive(); kills = 0; if (mode === 'fight') spawnWave(); say('BACK ON YOUR FEET'); }
      if (mode === 'fight' && deadT < 0) {
        if (world.enemies.length === 0 && respawnT < 0) respawnT = 80;
        if (respawnT >= 0 && --respawnT === 0) { respawnT = -1; spawnWave(); }
      }
    },

    render(alpha) {
      anim.render(alpha);
      health.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y, off.z);
      sys.render(alpha);
      stage.render(alpha);
      cfx.render(alpha);
      vfx.render(alpha);
    },

    ui(g) {
      const W = display.width, H = display.height;
      cfx.ui(g);
      sys.ui(g);
      vfx.ui(g);
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, 30, 'gold', { align: 'center', outline: 'ink' });
      if (!hud) return;
      drawText(g, 'ENEMIES', 8, 8, 'bone', { outline: 'ink' });
      if (mode === 'reel') {
        drawText(g, `REEL  (L: FIGHT   J: HIT THEM)`, 8, 18, 'mist', { shadow: 'ink' });
        if (beat) drawText(g, beat, W / 2, 8, 'bone', { align: 'center', scale: 2, outline: 'ink' });
        // name plates under the cast
        for (const c of CAST) {
          const d = ENEMIES[c.kind];
          const p = display.worldToScreen(c.x, 0, ROW_Z + 1.0);
          const active = beat === d.name || (c.kind === 'mite' && beat === 'MITE SWARM');
          drawText(g, d.name, p.x, p.y, active ? 'gold' : 'bone', { align: 'center', outline: 'ink' });
          drawText(g, d.role, p.x, p.y + 10, 'fog', { align: 'center', shadow: 'ink' });
          if (active) drawText(g, d.tell, p.x, p.y + 20, 'rose', { align: 'center', shadow: 'ink' });
        }
      } else {
        drawText(g, bot ? 'BOT PLAYS  (ANY KEY: TAKE OVER)' : 'LIVE  (B: BOT   L: REEL)', 8, 18, bot ? 'mist' : 'leaf', { shadow: 'ink' });
        drawText(g, `WAVE ${wave}   KILLS ${kills}   ALIVE ${sys.alive().length}`, 8, 28, 'mist', { shadow: 'ink' });
        drawText(g, `HP X${knobs.hp}  SPEED X${knobs.speed}  AGGRO X${knobs.aggression}   (G)`, 8, 38, 'slate', { shadow: 'ink' });
        const sl = sys.slots;
        drawText(g, `SLOTS  MELEE ${sl.melee.size}/${sys.allowed('melee')}  RANGED ${sl.ranged.size}/${sys.allowed('ranged')}  SWARM ${sl.swarm.size}/${sys.allowed('swarm')}`, 8, 48, 'slate', { shadow: 'ink' });
      }
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
      const help = mode === 'fight' ? 'WASD MOVE  J ATTACK  K DASH  1-5 SPAWN  V KILL  C CLEAR  B BOT  G DIFF  L REEL  H HUD' : 'L FIGHT  1-5 SPAWN  J ATTACK  Z ZOOM  T SLOW  H HUD';
      const w = textWidth(help) + 8;
      g.fillStyle = css('ink'); g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
      drawText(g, help, W / 2, H - 10, 'slate', { align: 'center' });
    },

    state() {
      return { showcase: { id: 'enemies', mode, beat, reelT, bot, wave, kills, zoom: display.zoom, knobs: { ...knobs }, slots: Object.fromEntries(Object.entries(sys.slots).map(([k, v]) => [k, v.size])), enemies: sys.info(), health: health.info() } };
    },
  };
}
