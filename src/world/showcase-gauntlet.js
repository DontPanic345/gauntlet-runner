// ?showcase=gauntlet : one corridor played start to finish, by a bot that reads the trap timings.
//
//   ?showcase=gauntlet&seed=N        the corridor for seed N (default 1); it plays through, then restarts
//   &index=0..3                      which corridor of the run (default 1): 0 spikes/axes/fire, 1 to 3 add the
//                                    crumbling bridge and shorter cycles
//   &bot=0                           you play (WASD move, J attack, K/Space dash); any key takes over from the bot
//   &overlay=1                       start with the trap timing overlay on (T toggles it)
//   &at=spikes|blades|jets|pit|end   start the chase in front of that section (for close looks)
//   &zoom=1..3  &slow=<s>  &hud=0    presentation
//   &skill=0..1                      bot care (default 0.8): lower means later dashes and more mistakes
// Keys: T timing overlay   R restart   N next corridor   1-4 pick a corridor   B bot on/off   Q slow-mo
//       Z zoom   H hud   P/Esc pause   WASD / J / K play
// Overlay: each trap gets a bar of one full cycle (slate = safe, gold = warning, red = hurts) with a white
// playhead; the collapse shows its speed, its multiplier and the gap to you.

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
import { generateCorridor, Corridor, SECTION_NAMES } from './corridor.js';

const SLOWS = [1, 0.5, 0.25];
const RUN = 4.2;

export default function gauntletShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  const seed = parseInt(P('seed', '3'), 10) || 3;
  let index = clampI(parseInt(P('index', '1'), 10), 0, 3, 1);
  let bot = P('bot', '1') !== '0';
  let hud = P('hud', '1') !== '0';
  let overlay = P('overlay', '0') === '1';
  let zoom = clampI(parseInt(P('zoom', '1'), 10), 1, 3, 1);
  let slowIdx = Math.max(0, SLOWS.indexOf(parseFloat(P('slow', '1'))));
  const skill = Math.max(0, Math.min(1, parseFloat(P('skill', '0.8'))));
  const at = P('at', '');

  let root, rig, anim, ctl, cam, health, combat, cfx, cor, layout;
  let offs = [], hurtFlash = 99, endT = -1, runs = 0, results = [];
  const status = { text: '', until: 0 };
  const say = (t) => { status.text = t; status.until = loop.realTime + 1.4; };

  // ---- the bot -------------------------------------------------------------------------------------------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, lane: 0, plan: '',
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };
  const LANES = [-1.3, -0.65, 0, 0.65, 1.3, 1.6];
  /** Run at full speed from (hx,hz) toward lane z for `horizon` seconds; return the time of the first hit, or Infinity. */
  function firstHit(sec, hx, hz, laneZ, speed, horizon = 1.25) {
    for (let t = 0; t <= horizon; t += 1 / 20) {
      const x = hx + speed * t, z = hz + Math.sign(laneZ - hz) * Math.min(Math.abs(laneZ - hz), RUN * t);
      for (const tr of cor.traps) {
        if (Math.abs(tr.x - x) > 2.4) continue;
        if (tr.hitAt(sec + t, x, z, 0.14)) return t;
      }
    }
    return Infinity;
  }
  function pitZ(x) {
    const p = layout.pit;
    if (!p) return null;
    if (x < p.x0 - 1.6 || x > p.x1 + 0.2) return null;
    const c = Math.max(0, Math.min(3, Math.floor((x + 0.9 - p.x0) / p.tw)));
    return [-1.3, 0, 1.3][p.pathRows[c]];
  }
  function botStep() {
    pilot.mv = { x: 0, z: 0 };
    if (!cor || health.dead) return;
    const h = health, st = cor.state;
    if (st === 'exited' || st === 'failed') return;
    if (st === 'ready') { pilot.mv = { x: 0.15, z: 0 }; return; }
    if (st === 'escaped') {
      const e = cor.exitPoint;
      const dx = e.x - h.x, dz = e.z - h.z + 0.4;
      const d = Math.hypot(dx, dz);
      // go along the corridor to the arch, then up into it
      if (Math.abs(dx) > 0.4) pilot.mv = { x: Math.sign(dx) * Math.min(1, 0.3 + Math.abs(dx) * 0.4), z: 0 };
      else pilot.mv = { x: dx * 0.6, z: -1 };
      void d;
      return;
    }
    if (st === 'escape') { pilot.mv = { x: 0.2, z: 0 }; return; }
    const sec = (cor.t + 1) / 60, gap = cor.collapse.gap;
    const pz = pitZ(h.x);
    // the sight: anything within reach of the next second and a quarter
    let best = null, bestT = -1;
    const lanes = pz !== null ? [pz] : LANES;
    for (const lz of lanes) {
      const ft = firstHit(sec, h.x, h.z, lz, RUN);
      const score = ft === Infinity ? 100 - Math.abs(lz - h.z) * 3 - Math.abs(lz) * 0.4 : ft;
      if (ft > bestT || (ft === Infinity && score > (best?.score ?? -1))) { if (ft === Infinity || best === null || ft > best.ft) { best = { lz, ft, score }; bestT = ft; } }
    }
    let safeRun = best && best.ft === Infinity;
    const laneZ = pz !== null ? pz : best.lz;
    const zk = Math.max(-1, Math.min(1, (laneZ - h.z) * 2.4));
    if (safeRun) { pilot.mv = { x: 1, z: zk }; pilot.plan = 'run'; return; }
    // no safe run: is waiting here safe? (hold position, drift to the safest lane)
    const waitHit = firstHit(sec, h.x, h.z, h.z, 0, 0.8);
    const hurry = gap < 4.6 + (1 - skill) * 1.5;
    const soon = best.ft;
    if (hurry && ctl.dashReady && soon < 0.34 && soon > 0.04) { pilot.mv = { x: 1, z: zk }; pilot.want.dash = true; pilot.plan = 'dash'; return; }
    if (waitHit === Infinity && !(gap < 2.2)) { pilot.mv = { x: 0, z: (laneZ - h.z) * 0.5 }; pilot.plan = 'wait'; return; }
    if (waitHit !== Infinity && ctl.dashReady) { pilot.mv = { x: 1, z: zk }; pilot.want.dash = true; pilot.plan = 'dash!'; return; }
    // out of options: run and hope
    pilot.mv = { x: 1, z: zk }; pilot.plan = 'gamble';
  }
  function goLive() { if (!bot) return; bot = false; ctl.source = input; pilot.mv = { x: 0, z: 0 }; say('LIVE'); }

  // ---- corridor lifecycle ---------------------------------------------------------------------------------
  function build(i = index) {
    index = i;
    cor?.dispose();
    vfx.clear();
    layout = generateCorridor(seed, index);
    cor = new Corridor(root, layout, { overlay });
    ctl.collision = cor.cw; setCollision(cor.cw);
    const e = cor.entryPoint;
    ctl.teleport(e.x, e.z, Math.PI / 2); anim.reset(e.x, e.z, Math.PI / 2); ctl.stunT = 0;
    health.revive(); health.iframeT = 0;
    rig.group.visible = true;
    cor.bind({ hero: health });
    cam.bounds = cor.cameraBounds;
    cam.follow = true;
    cam.reset(e.x + 2, -0.6);
    ctl.source = bot ? pilot : input;
    pilot.mv = { x: 0, z: 0 };
    endT = -1; hurtFlash = 99;
    runs++;
    if (at) {
      const s = layout.sections.find((q) => q.kind === at);
      const x = at === 'end' ? layout.triggerX - 4 : s ? s.x0 - 2.2 : null;
      if (x !== null) { cor.jump(x); cam.reset(x + 2, -0.6); }
    }
  }

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      loop.setTimeScale(SLOWS[slowIdx]);
      display.setZoom(zoom);
      vfx.attach(root, { ambient: 'collapse' });
      const cw0 = new CollisionWorld();
      setCollision(cw0);
      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: 0, z: 0, yaw: Math.PI / 2 });
      ctl = new HeroController({ x: 0, z: 0, yaw: Math.PI / 2, anim, collision: cw0, source: bot ? pilot : input });
      health = new HeroHealth({ ctl, anim, rig, hp: 5 });
      world.hero = health;
      combat = new HeroCombat({ ctl, anim, health, targets: () => [] });
      cfx = createCombatFx(root, { numbers: false });
      cam = new CameraRig({});
      const on = (n, fn) => offs.push(events.on(n, fn));
      on('input:press', (e) => { if (bot && e.action !== 'pause') goLive(); });
      on('combat:heroHurt', () => { hurtFlash = 0; });
      on('gauntlet:release', (e) => { results.push({ index: e.index, time: +e.time.toFixed(2), minGap: +e.minGap.toFixed(2) }); });
      on('gauntlet:exit', () => { endT = 0; });
      on('gauntlet:fail', () => { endT = 0; });
      debug.handle('goto', (i) => { build(clampI(i | 0, 0, 3, 0)); return { ok: true, corridor: index }; });
      debug.handle('spawn', () => ({ ok: false, error: 'no enemies in the gauntlet showcase' }));
      build(index);
    },

    exit() {
      offs.forEach((f) => f()); offs = [];
      cor?.dispose(); cor = null;
      cfx?.dispose(); vfx.detach();
      loop.setTimeScale(1);
      setCollision(null);
      debug.handle('goto', () => ({ ok: false, error: 'no rooms in this scene' }));
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },

    frame() {
      const k = input.ui.key;
      if (k('KeyT')) { overlay = !overlay; cor.overlay = overlay; say(overlay ? 'TIMING OVERLAY ON' : 'TIMING OVERLAY OFF'); }
      if (k('KeyZ')) { zoom = zoom >= 3 ? 1 : zoom + 1; display.setZoom(zoom); say(`ZOOM ${zoom}X`); }
      if (k('KeyQ')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) hud = !hud;
      if (k('KeyB')) { bot = !bot; ctl.source = bot ? pilot : input; say(bot ? 'BOT PLAYS' : 'LIVE'); }
      if (k('KeyR')) { build(index); say('RESTART'); }
      if (k('KeyN')) { build((index + 1) % 4); say(`CORRIDOR ${index + 1}`); }
      for (let d = 0; d < 4; d++) if (k(`Digit${d + 1}`)) { build(d); say(`CORRIDOR ${d + 1}`); }
    },

    tick() {
      if (bot) botStep();
      combat.tick();
      cam.tick(ctl);
      cor.tick();
      cfx.tick();
      vfx.tick();
      hurtFlash++;
      if (endT >= 0 && ++endT > (cor.state === 'failed' ? 100 : 130)) {
        const failed = cor.state === 'failed';
        say(failed ? 'AGAIN' : 'THE END OF THE REEL');
        build(index);
      }
    },

    render(alpha) {
      anim.render(alpha);
      health.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y, off.z);
      cor.render(alpha);
      cfx.render(alpha);
      vfx.render(alpha);
    },

    ui(g) {
      const W = display.width, H = display.height;
      cfx.ui(g);
      vfx.ui(g);
      cor.ui(g);
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, H - 34, 'gold', { align: 'center', outline: 'ink' });
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
      if (!hud) return;
      const inf = cor.info();
      drawText(g, `GAUNTLET ${index + 1}/4  ${cor.name}`, 8, 8, 'bone', { outline: 'ink' });
      drawText(g, `${inf.state.toUpperCase()}  ${inf.time.toFixed(1)}S  GAP ${Math.max(0, inf.gap).toFixed(1)}  WALL ${inf.speed.toFixed(1)} U/S`, 8, 18, 'mist', { shadow: 'ink' });
      drawText(g, `${layout.order.map((k) => SECTION_NAMES[k]).join(' > ')}  SEED ${seed}`, 8, 28, 'slate', { shadow: 'ink' });
      if (bot) drawText(g, `BOT: ${pilot.plan.toUpperCase()}`, 8, 38, 'slate', { shadow: 'ink' });
      const help = 'T TIMING  R RESTART  N NEXT  1-4 PICK  B BOT  Q SLOW  Z ZOOM  H HUD   WASD J K';
      const w = textWidth(help) + 8;
      g.fillStyle = css('ink'); g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
      drawText(g, help, W / 2, H - 10, 'slate', { align: 'center' });
    },

    state() {
      return { showcase: { id: 'gauntlet', bot, zoom: display.zoom, overlay: cor?.overlay, corridor: cor?.info(), plan: pilot.plan, results, runs, health: health?.info() } };
    },
  };
}

function clampI(v, a, b, d) { return Number.isFinite(v) ? Math.max(a, Math.min(b, v)) : d; }
