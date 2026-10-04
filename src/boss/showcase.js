// ?showcase=boss : The Warden.
//
// The real fight (warden.js, arena.js, fight.js), played by a DEMO pilot that uses keyboard-
// style input only. The pilot plays it the way it is meant to be played: it holds a spacing,
// reads each telegraph, dashes out of it at the last moment (or through the shockwave ring),
// and punishes the openings (the stuck lash, the landing, the stagger). It dodges two threats
// in three and deliberately eats the third (TANK IT), so both outcomes are on show; with
// &dodge=1 it dodges everything. If it falls, it gets back up. Any key takes over (LIVE).
//
// Params:  &phase=1|2|3        start the fight at that phase (no intro)
//          &intro=1            play the intro first, then the fight
//          &attack=sweep|lash|stomp|leap|summon|cage    the Warden only uses that attack
//          &death=1            phase III with a sliver of hp: the pilot lands the killing blow
//                              and the death sequence plays
//          &auto=0             start LIVE (default DEMO)       &dodge=1  the pilot dodges all
//          &zoom=1..3          camera zoom (default 1, game scale)
//          &passive=1          the Warden never attacks (model and idle stills)
//          &focus=1            the camera frames the Warden (close-up stills with &zoom=2)
//          &slow=<s>           time scale                      &numbers=0  no damage numbers
//          &hud=0              no showcase labels (the boss's own UI stays)
// Keys:    WASD move, J attack, K dash (LIVE)
//          1 / 2 / 3 restart at a phase, 4 the intro, 5 the death, B demo, R restart,
//          T slow-mo, H hud, P/Esc pause
// state().showcase = { id, mode, auto, start, attack, pilot, ...fight.info() }
//
// Strip recipe (deterministic): load with &hud=0, wait for ready, debug.freeze(true), then
// debug.step(N) and alternate debug.step(k) with screenshots. The Warden's attack picks and
// the pilot are seeded, so the same N gives the same frame.

import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { vfx } from '../vfx/vfx.js';
import { spawnHandler } from '../enemies/index.js';
import { createBossFight, INTRO } from './fight.js';
import { WARDEN, ROMAN } from './warden.js';
import { PIT } from './models.js';
import { createHud, wardenSource } from '../ui/hud.js';   // the same HUD as normal play (?scene=boss)

const SLOWS = [1, 0.5, 0.25, 0.1];
const ATTACKS = ['sweep', 'lash', 'stomp', 'leap', 'summon', 'cage'];
const TAG = {
  dormant: ['DORMANT', 'mist'], wake: ['WAKING', 'sky'], roar: ['ROAR', 'gold'], ready: ['READY', 'mist'], move: ['STALKING', 'fog'],
  sweepWind: ['SWEEP: TELEGRAPH', 'gold'], sweep: ['SWEEP', 'red'], lashWind: ['LASH: TELEGRAPH', 'gold'], lash: ['LASH', 'red'],
  stuck: ['STUCK: PUNISH IT', 'leaf'], pull: ['PULLING FREE: PUNISH IT', 'leaf'], stompWind: ['STOMP: TELEGRAPH', 'gold'], stomp: ['STOMP', 'red'],
  leapWind: ['LEAP: TELEGRAPH', 'gold'], air: ['LEAP', 'red'], land: ['LANDED: PUNISH IT', 'leaf'], summon: ['SUMMON', 'rose'],
  cageWind: ['THE CAGE: GET INSIDE', 'gold'], cageUp: ['THE CAGE', 'red'], stagger: ['STAGGERED: PUNISH IT', 'gold'], break: ['PHASE BREAK', 'white'],
  recover: ['RECOVER', 'leaf'], death: ['DEATH', 'rose'],
};

export default function bossShowcase(params) {
  const hud0 = params.get('hud') !== '0';
  const O = {
    hud: hud0,
    slow: parseFloat(params.get('slow') ?? '1') || 1,
    numbers: params.get('numbers') !== '0',
    dodgeAll: params.get('dodge') === '1',
    focus: params.get('focus') === '1',
    passive: params.get('passive') === '1',
    zoom: Math.max(1, Math.min(3, parseInt(params.get('zoom') ?? '1', 10) || 1)),
    status: { text: '', until: 0 },
  };
  O.say = (t) => { O.status.text = t; O.status.until = loop.realTime + 1.4; };
  let auto = params.get('auto') !== '0';
  let attack = ATTACKS.includes(params.get('attack')) ? params.get('attack') : null;
  const phaseP = Math.max(1, Math.min(3, parseInt(params.get('phase') ?? '1', 10) || 1));
  let start = params.get('death') === '1' ? 'death' : params.get('intro') === '1' ? 'intro' : `phase${phaseP}`;
  let slowIdx = Math.max(0, SLOWS.indexOf(O.slow));
  let root = null, F = null, hud = null, offs = [], deadT = -1, t = 0;

  // ---- the demo pilot: keyboard-style input only --------------------------------------------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, n: 0, dashCool: 0, atkCool: 0, label: '', labelT: 0, rng: 1,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
    rand() { this.rng = (this.rng * 16807) % 2147483647; return this.rng / 2147483647; },
  };
  function say(l) { pilot.label = l; pilot.labelT = 50; }
  function away(x, z, ctl) { let dx = ctl.x - x, dz = ctl.z - z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l; return edgeSafe({ x: dx, z: dz }, ctl); }
  // a dash that would run into the pit's wall turns along it instead
  function edgeSafe(d, ctl) {
    const R = F.warden.ringR - 0.5;
    const ex = ctl.x + d.x * 2.4, ez = ctl.z + d.z * 2.4;
    if (Math.hypot(ex, ez) < R) return d;
    const rx = ctl.x, rz = ctl.z, rl = Math.hypot(rx, rz) || 1;
    const tx = -rz / rl, tz = rx / rl;
    const s = (tx * d.x + tz * d.z) >= 0 ? 1 : -1;
    return { x: tx * s * 0.85 - rx / rl * 0.3, z: tz * s * 0.85 - rz / rl * 0.3 };
  }
  function threat() {
    const w = F.warden, ctl = F.ctl, W = WARDEN;
    if (w.dying) return null;
    switch (w.state) {
      case 'sweepWind':
        if (w.st >= W.sweep.windup - 3 && w.heroInSector(w.x, w.z, w.yaw, W.sweep.reach + 0.35, W.sweep.arc + 8)) return { d: away(w.x, w.z, ctl), why: 'sweep' };
        break;
      case 'lashWind':
        if (w.st >= W.lash.windup - 4 && w.heroInLane(w.x, w.z, w.yaw, 0.5, w.lane + 0.3, W.lash.width / 2 + 0.1)) {
          const dx = Math.sin(w.yaw), dz = Math.cos(w.yaw), side = (ctl.x - w.x) * dz - (ctl.z - w.z) * dx >= 0 ? 1 : -1;
          return { d: edgeSafe({ x: dz * side, z: -dx * side }, ctl), why: 'lash' };
        }
        break;
      case 'stompWind':
        if (w.st >= W.stomp.windup - 5 && w.heroInDisc(w.x, w.z, W.stomp.radius + 0.2)) return { d: away(w.x, w.z, ctl), why: 'stomp' };
        break;
      case 'leapWind': case 'air': {
        const left = w.state === 'air' ? W.leap.air - w.st : W.leap.windup - w.st + W.leap.air;
        if (w.aim && left <= 6 && w.heroInDisc(w.aim.x, w.aim.z, W.leap.radius + 0.2)) return { d: away(w.aim.x, w.aim.z, ctl), why: 'leap' };
        break;
      }
      default: break;
    }
    for (const r of w.waves) {
      if (r.t < 0 || r.hit) continue;
      const gap = Math.hypot(ctl.x - r.x, ctl.z - r.z) - r.r;
      if (gap > 0.15 && gap < 0.8) { const dx = r.x - ctl.x, dz = r.z - ctl.z, l = Math.hypot(dx, dz) || 1; return { d: { x: dx / l, z: dz / l }, why: 'wave' }; }
    }
    for (const e of F.mgr.list) {
      if (e === w || e.dying || e.kind !== 'husk' || e.state !== 'windup') continue;
      const A = e.D.attack;
      if (e.st >= A.windup - 8 && e.heroInSector(e.x, e.z, e.yaw, A.reach + 0.25, A.arc)) return { d: away(e.x, e.z, ctl), why: 'husk' };
    }
    return null;
  }
  function pilotStep() {
    const ctl = F.ctl, w = F.warden;
    pilot.mv = { x: 0, z: 0 };
    if (pilot.dashCool > 0) pilot.dashCool--;
    if (pilot.atkCool > 0) pilot.atkCool--;
    if (pilot.labelT > 0) pilot.labelT--;
    if (F.health.dead || F.state === 'intro') return;
    if (F.state === 'won' || F.state === 'dying') {
      // after the kill: walk a little way off and watch
      const dx = ctl.x - w.x, dz = ctl.z - w.z, d = Math.hypot(dx, dz) || 1;
      if (d < 3.2) pilot.mv = { x: dx / d * 0.5, z: dz / d * 0.5 };
      return;
    }
    // the cage: get inside the bars, now
    if (w.state === 'cageWind' && Math.hypot(ctl.x, ctl.z) > PIT.CAGE - 0.7) {
      const l = Math.hypot(ctl.x, ctl.z) || 1; pilot.mv = { x: -ctl.x / l, z: -ctl.z / l }; say('GET INSIDE'); return;
    }
    const th = threat();
    if (th && pilot.dashCool <= 0 && ctl.dashReady) {
      pilot.n++;
      pilot.dashCool = 20;
      if (O.dodgeAll || pilot.n % 3 !== 0) { pilot.mv = th.d; pilot.want.dash = true; say(th.why === 'wave' ? 'THROUGH THE RING' : 'DODGE'); return; }
      say('TANK IT');
    }
    // targets: a husk that is close, else the Warden
    let tgt = w, td = Math.hypot(w.x - ctl.x, w.z - ctl.z);
    for (const e of F.mgr.list) {
      if (e === w || e.dying || e.dead || !e.visible || e.state === 'spawn') continue;
      const d = Math.hypot(e.x - ctl.x, e.z - ctl.z);
      if (d < 2.6 && d < td) { tgt = e; td = d; }
    }
    const dx = tgt.x - ctl.x, dz = tgt.z - ctl.z, d = Math.hypot(dx, dz) || 1;
    const go = (k, sx = dx / d, sz = dz / d) => { pilot.mv = { x: sx * k, z: sz * k }; };
    const reach = tgt.r + (tgt === w ? 0.7 : 0.9);
    const open = tgt !== w || w.open || (w.state === 'move' && w.cool > 24) || w.state === 'summon' || w.state === 'cageWind' || start === 'death';
    if (open && !w.passive || open && start === 'death' && t > 40) {
      if (tgt === w && w.open && pilot.labelT <= 0) say('PUNISH');
      if (d > reach) go(Math.min(1, (d - reach) / 0.4 + 0.35));
      else {
        if (F.anim.state !== 'attack') go(0.2);
        if (pilot.atkCool <= 0) { pilot.want.attack = true; pilot.atkCool = 13; }
      }
      return;
    }
    // not open: hold a spacing at the edge of its reach and circle, waiting for it to commit
    const keep = w.phase >= 2 ? 3.9 : 3.5;
    const tx = -dz / d, tz = dx / d;
    const circle = Math.sin(t * 0.013) > 0 ? 0.35 : -0.35;
    if (d < keep - 0.5) go(-0.8, dx / d, dz / d);
    else if (d > keep + 1.0) go(0.7);
    else pilot.mv = { x: tx * circle + dx / d * 0.08, z: tz * circle + dz / d * 0.08 };
    const e = edgeSafe(pilot.mv, ctl); if (Math.hypot(ctl.x, ctl.z) > w.ringR - 1.0) pilot.mv = { x: e.x * 0.5, z: e.z * 0.5 };
  }
  function goLive() { if (!auto) return; auto = false; F.ctl.source = input; F.combat._source = null; O.say('LIVE'); }
  function goDemo() { auto = true; F.ctl.source = pilot; O.say('DEMO'); }

  // ---- (re)building the fight -----------------------------------------------------------------
  function build(which) {
    start = which;
    if (F) { F.dispose(); F = null; vfx.clear(); }
    hud?.dispose(); hud = null;
    world.enemies = [];
    deadT = -1; t = 0;
    pilot.n = 0; pilot.dashCool = 0; pilot.atkCool = 0; pilot.want = {}; pilot.rng = 1; pilot.label = '';
    vfx.seed(17);
    const phase = which === 'death' ? 3 : which === 'intro' ? 1 : +which.slice(5);
    F = createBossFight(root, { intro: which === 'intro', phase, source: auto ? pilot : input, numbers: false, force: attack, zoom: O.zoom, focus: O.focus });
    F.barLift = O.hud ? 10 : 0;
    // integration: the hud piece's hearts, dash pip, boss bar and damage numbers, as in normal play
    F.externalHud = true;
    const boss = wardenSource(F);
    hud = createHud({ health: F.health, boss: () => { const b = boss(); if (b) b.lift = F.barLift; return b; }, numbers: O.numbers, track: false, shards: false, boons: false });
    if (O.passive) F.warden.passive = true;
    if (which === 'death') { F.warden.hp = 22; F.warden.passive = true; F.ctl.teleport(0, -1.2, Math.PI); }
    if (attack === 'cage') F.warden.caged = false;
    debug.handle('spawn', spawnHandler(F.mgr));
    world.room = { index: 5, kind: 'boss', id: 'warden', showcase: true };
  }

  return {
    pausable: true,
    enter(_d, r) {
      root = r;
      world.reset();
      loop.setTimeScale(SLOWS.includes(O.slow) ? SLOWS[slowIdx] : O.slow);
      build(start);
      offs.push(events.on('input:press', (e) => { if (auto && e.action !== 'pause' && F.state !== 'intro') goLive(); }));
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      F?.dispose(); F = null;
      hud?.dispose(); hud = null;
      loop.setTimeScale(1);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },
    frame() {
      const k = input.ui.key;
      F.frame();
      if (k('KeyB')) goDemo();
      if (k('KeyR')) { build(start); O.say('RESTART'); }
      if (k('Digit1')) { attack = null; build('phase1'); O.say('PHASE I'); }
      if (k('Digit2')) { attack = null; build('phase2'); O.say('PHASE II'); }
      if (k('Digit3')) { attack = null; build('phase3'); O.say('PHASE III'); }
      if (k('Digit4')) { attack = null; build('intro'); O.say('THE INTRO'); }
      if (k('Digit5')) { attack = null; build('death'); O.say('THE DEATH'); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); O.say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) { O.hud = !O.hud; F.barLift = O.hud ? 10 : 0; }
    },
    tick() {
      t++;
      if (auto) pilotStep();
      F.tick();
      // the demo never ends on a fall: it gets back up
      if (F.health.dead && deadT < 0) deadT = 0;
      if (deadT >= 0 && ++deadT > 60) { deadT = -1; F.reviveHero(); O.say('BACK ON YOUR FEET'); }
      // the death replay loops back to the start a while after THE WARDEN FALLS
      if (F.state === 'won' && F.wonT > 420 && start === 'death') build('death');
      // a forced attack: keep it coming
      if (attack && F.warden.state === 'move' && F.warden.cool > 40) F.warden.cool = 40;
    },
    render(alpha) { F.render(alpha); },
    ui(g) {
      const W = display.width, H = display.height;
      hud.hidden = F.state === 'intro';
      hud.ui(g);
      F.ui(g);
      if (O.status.text && loop.realTime < O.status.until) drawText(g, O.status.text, W / 2, 46, 'gold', { align: 'center', outline: 'ink' });
      if (!O.hud) return;
      const w = F.warden;
      drawText(g, 'BOSS: THE WARDEN', W / 2, 6, 'bone', { align: 'center', outline: 'ink' });
      const tg = TAG[w.state] ?? [w.state.toUpperCase(), 'fog'];
      if (F.state !== 'intro') drawText(g, `${ROMAN[w.phase]}  ${tg[0]}`, W / 2, 16, tg[1], { align: 'center', shadow: 'ink' });
      else drawText(g, `INTRO  ${Math.min(INTRO.fight, F.t)}/${INTRO.fight}`, W / 2, 16, 'mist', { align: 'center', shadow: 'ink' });
      drawText(g, auto ? 'DEMO  (ANY KEY: TAKE OVER)' : 'LIVE  (B: DEMO)', 8, 42, auto ? 'mist' : 'leaf', { shadow: 'ink' });
      if (auto && pilot.labelT > 0) drawText(g, pilot.label, 8, 52, pilot.label === 'TANK IT' ? 'rose' : pilot.label === 'PUNISH' ? 'leaf' : 'sky', { shadow: 'ink' });
      if (attack) drawText(g, `ATTACK: ${attack.toUpperCase()} ONLY`, W - 8, 22, 'gold', { align: 'right', shadow: 'ink' });
      if (loop.timeScale !== 1) drawText(g, `X${+loop.timeScale.toFixed(2)}`, W - 8, 32, 'gold', { align: 'right', shadow: 'ink' });
      const help = '1-3 PHASE  4 INTRO  5 DEATH  B DEMO  R RESTART  T SLOW  H HUD';
      const hw = textWidth(help) + 8;
      g.fillStyle = css('ink'); g.fillRect(Math.round((W - hw) / 2), H - 11, hw, 11);
      drawText(g, help, W / 2, H - 9, 'slate', { align: 'center' });
    },
    state() {
      return { showcase: { id: 'boss', mode: start, auto, start, attack, pilot: { label: pilot.label, dodges: pilot.n }, ...F.info() } };
    },
  };
}
