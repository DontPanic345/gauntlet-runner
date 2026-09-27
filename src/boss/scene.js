// The boss scene (piece `boss`): the hero, the Warden and the round arena, wired into one scene
// definition. `?showcase=boss` uses it with a bot at the controls; `?scene=boss` (and run-flow) use it live.
//
//   import { createBossScene } from './boss/scene.js';
//   scenes.define('boss', createBossScene({ intro: true }));
//
// Options: { phase: 1|2|3, intro: bool, bot: bool, hud: bool, help: bool, hp: 0..1 fraction of the phase's start,
//            zoom: bool, slow: number, showcase: bool, knobs: {aggression} }

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
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import '../combat/sfx.js';
import { vfx } from '../vfx/index.js';
import { createEnemySystem } from '../enemies/index.js';
import { BossFight } from './fight.js';
import { ARENA_R } from './arena.js';
import { TUNE } from './warden.js';

const TAU = Math.PI * 2;
let current = null;                       // the live scene's parts, for the debug hook

export function createBossScene(o = {}) {
  const P = { phase: 1, intro: false, bot: false, hud: true, help: false, hp: null, showcase: false, knobs: { aggression: 1 }, ...o };
  let root, rig, anim, ctl, health, combat, cfx, cw, sys, fight, offs = [];
  let bot = P.bot, deadT = -1, hurtFlash = 99, slowP = P.slow ?? null, hud = P.hud, help = P.help;
  const status = { text: '', until: 0 };
  const say = (t) => { status.text = t; status.until = loop.realTime + 1.6; };

  // ---- the bot: plays the hero so the fight shows itself. Any key takes over. ----------------------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, atkCd: 0, dashCd: 0, side: 1, sideT: 0,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };
  function botStep() {
    const b = fight.boss, h = ctl;
    pilot.mv = { x: 0, z: 0 };
    pilot.atkCd--; pilot.dashCd--; pilot.sideT--;
    if (health.dead || fight.state === 'intro' || fight.state === 'dying') return;
    const bx = b.x - h.x, bz = b.z - h.z, bd = Math.hypot(bx, bz) || 1;
    const away = { x: -bx / bd, z: -bz / bd };
    const perp = { x: -away.z * pilot.side, z: away.x * pilot.side };
    if (pilot.sideT <= 0) { pilot.side = Math.random() < 0.5 ? -1 : 1; pilot.sideT = 90 + (Math.random() * 60 | 0); }
    let threat = null, dashNow = false;
    const a = b.a;
    const ring = fight.rings.rings.find((r) => r.onHit && Math.abs(Math.hypot(h.x - r.x, h.z - r.z) - r.r) < 1.7 && Math.hypot(h.x - r.x, h.z - r.z) > r.r - 0.3);
    if (ring) {
      const d = Math.hypot(h.x - ring.x, h.z - ring.z);
      const dx = (h.x - ring.x) / (d || 1), dz = (h.z - ring.z) / (d || 1);
      // dash THROUGH the crest as it arrives
      if (d - ring.r < 0.95 + Math.max(0, (ring.speed / 60) * 4) && pilot.dashCd <= 0 && ctl.dashReady) { threat = { x: -dx, z: -dz }; dashNow = true; }
      else threat = { x: -dx * 0.0, z: -dz * 0.0 };
    }
    if (a && !threat) {
      if (a.name === 'sweep') {
        const rho = bd;
        if (a.stage === 'wind') { if (rho < 4.6) threat = { x: away.x, z: away.z }; }
        else if (rho < 4.5 && rho > 1.05) { threat = { x: away.x, z: away.z }; if (rho < 3.9) dashNow = pilot.dashCd <= 0 && ctl.dashReady; }
      } else if (a.name === 'lash' && a.dir && (a.stage === 'wind' || a.stage === 'fly')) {
        const along = (h.x - b.x) * a.dir.x + (h.z - b.z) * a.dir.z, side = (h.x - b.x) * a.dir.z - (h.z - b.z) * a.dir.x;
        if (along > 0 && Math.abs(side) < 1.6) { const sg = side >= 0 ? 1 : -1; threat = { x: a.dir.z * sg, z: -a.dir.x * sg }; if (a.stage === 'fly' && Math.abs(side) < 0.8) dashNow = pilot.dashCd <= 0 && ctl.dashReady; }
      } else if ((a.name === 'slam' || a.name === 'slam2' || a.name === 'leap') && a.T) {
        const dx = h.x - a.T.x, dz = h.z - a.T.z, d = Math.hypot(dx, dz) || 1;
        if (d < 2.6) { threat = { x: dx / d, z: dz / d }; if (d < 2.0 && (a.stage === 'strike' || a.stage === 'air' || (a.st > 30 && a.stage === 'wind'))) dashNow = pilot.dashCd <= 0 && ctl.dashReady; }
      }
    }
    if (threat && (threat.x || threat.z)) {
      pilot.mv = { x: threat.x, z: threat.z };
      if (dashNow) { pilot.want.dash = true; pilot.dashCd = 30; }
      return;
    }
    // husks: fight them when they are near
    const husk = sys.alive().filter((e) => e.solid).sort((p, q) => Math.hypot(p.x - h.x, p.z - h.z) - Math.hypot(q.x - h.x, q.z - h.z))[0];
    const open = b.punishing && b.st < b.recoverMax - 6;
    if (open) {
      // the window: close in and swing
      const stand = 1.55;
      if (bd > stand) pilot.mv = { x: bx / bd, z: bz / bd }; else pilot.mv = { x: bx / bd * 0.05, z: bz / bd * 0.05 };
      if (bd < stand + 0.7 && pilot.atkCd <= 0) { pilot.want.attack = true; pilot.atkCd = 13; }
      return;
    }
    if (husk && Math.hypot(husk.x - h.x, husk.z - h.z) < 2.6) {
      const dx = husk.x - h.x, dz = husk.z - h.z, d = Math.hypot(dx, dz) || 1;
      pilot.mv = { x: dx / d * (d > 1.1 ? 1 : 0.05), z: dz / d * (d > 1.1 ? 1 : 0.05) };
      if (d < 1.6 && pilot.atkCd <= 0) { pilot.want.attack = true; pilot.atkCd = 13; }
      return;
    }
    // otherwise keep a respectful distance and circle
    const want = 3.7;
    const k = bd < want - 0.4 ? -1 : bd > want + 0.8 ? 1 : 0;
    pilot.mv = { x: (bx / bd) * k * 0.9 + perp.x * 0.55, z: (bz / bd) * k * 0.9 + perp.z * 0.55 };
  }
  function goLive() { if (!bot) return; bot = false; ctl.source = input; pilot.mv = { x: 0, z: 0 }; say('LIVE'); }

  function build() {
    fight?.dispose();
    world.reset();
    cw = new CollisionWorld();
    cw.addRing(0, 0, ARENA_R);
    setCollision(cw);
    world.room = { index: 5, kind: 'boss', id: 'warden' };
    if (!rig) {
      rig = createHeroRig(); root.add(rig.group);
      anim = new HeroAnim(rig, { x: 0, z: 4.8, yaw: Math.PI });
      ctl = new HeroController({ x: 0, z: 4.8, yaw: Math.PI, anim, collision: cw, source: bot ? pilot : input });
      health = new HeroHealth({ ctl, anim, rig, hp: 5 });
    } else { ctl.collision = cw; ctl.teleport(0, 4.8, Math.PI); health.revive(); health.hp = health.maxHp; ctl.source = bot ? pilot : input; }
    world.hero = health;
    sys?.dispose();
    sys = createEnemySystem(root, { hero: health, collision: cw, bounds: { minX: -ARENA_R, maxX: ARENA_R, minZ: -ARENA_R, maxZ: ARENA_R }, list: world.enemies, ai: true, bars: true });
    fight = new BossFight(root, { hero: health, ctl, cw, sys, heroRig: rig, phase: P.phase, intro: P.intro, knobs: P.knobs, hpMul: P.hpMul ?? 1, zoom: P.zoom ?? 1, cam: P.cam ?? null });
    if (P.hp !== null && !P.intro) { const lo = fight.boss.phase === 3 ? 0 : fight.boss.maxHp * (fight.boss.phase === 2 ? 1 / 3 : 2 / 3); fight.boss.hp = Math.max(1, Math.round(lo + (fight.boss.hp - lo) * P.hp)); fight.hpShown = fight.hpGhost = fight.boss.hp / fight.boss.maxHp; }
    combat = new HeroCombat({ ctl, anim, health, targets: () => [fight.boss, ...world.enemies] });
    world.enemies.push(fight.boss);
    current = { get fight() { return fight; }, get ctl() { return ctl; }, get health() { return health; }, get sys() { return sys; }, get pilot() { return pilot; }, P, say, restart: () => build() };
    deadT = -1;
  }

  return {
    pausable: true,
    enter(_d, r) {
      root = r;
      display.setZoom(1);
      if (slowP && Number.isFinite(slowP)) loop.setTimeScale(slowP); else loop.setTimeScale(1);
      vfx.attach(root, { ambient: 'boss' });
      cfx = createCombatFx(root, { numbers: true });
      build();
      const on = (n, fn) => offs.push(events.on(n, fn));
      on('input:press', (e) => { if (bot && fight.state !== 'intro' && e.action !== 'pause' && e.action !== 'interact') goLive(); });
      on('hero:dead', () => { deadT = 0; });
      on('combat:heroHurt', () => { hurtFlash = 0; });
      debug.handle('spawn', (type, x, z) => sys.handleSpawn(type, x, z) ?? { ok: false, error: 'the boss arena spawns husk, wisp, brute, mite' });
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      cfx?.dispose(); fight?.dispose(); sys?.dispose(); vfx.detach();
      loop.setTimeScale(1); setCollision(null); current = null; rig = null;
      display.setZoom(1);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },
    frame() {
      const k = input.ui.key;
      if (P.showcase || help) {
        if (k('KeyH')) hud = !hud;
        if (k('KeyB')) { bot = !bot; ctl.source = bot ? pilot : input; say(bot ? 'BOT PLAYS' : 'LIVE'); }
        if (k('KeyR')) { build(); say('RESTART'); }
        if (k('Digit1')) { P.phase = 1; P.intro = false; build(); say('PHASE 1'); }
        if (k('Digit2')) { P.phase = 2; P.intro = false; build(); say('PHASE 2'); }
        if (k('Digit3')) { P.phase = 3; P.intro = false; build(); say('PHASE 3'); }
        if (k('KeyI')) { P.phase = 1; P.intro = true; build(); say('INTRO'); }
        if (k('KeyK') && !bot && false) fight.boss.kill();
        if (k('KeyX')) fight.boss.kill();
      }
      if (k('KeyE') && fight.state === 'intro') fight.skipIntro();
    },
    tick() {
      if (bot) botStep();
      fight.tick();
      combat.tick();
      sys.tick();
      cfx.tick();
      vfx.tick();
      hurtFlash++;
      if (health.dead && deadT >= 0 && ++deadT > 110) {
        deadT = -1; health.revive(); ctl.teleport(0, 4.8, Math.PI);
        if (fight.state === 'fight' && fight.boss.state !== 'transition') { fight.boss.cool = Math.max(fight.boss.cool, 60); }
        say('BACK ON YOUR FEET');
      }
    },
    render(alpha) {
      anim.render(alpha);
      health.render();
      fight.render(alpha);
      sys.render(alpha);
      cfx.render(alpha);
      vfx.render(alpha);
    },
    ui(g) {
      const W = display.width, H = display.height;
      cfx.ui(g);
      sys.ui(g);
      vfx.ui(g);
      fight.ui(g);
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, 20, 'gold', { align: 'center', outline: 'ink' });
      if (fight.state === 'intro' && fight.bars > 0.3) return;
      // hero hp pips
      const hp = health.hp, mx = health.maxHp;
      const pw = 9, gap = 3, px0 = 10;
      const sx = hurtFlash < 8 ? ((hurtFlash % 2) ? 1 : -1) : 0;
      for (let i = 0; i < mx; i++) {
        const x = px0 + i * (pw + gap) + sx, y = 10;
        g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, pw + 2, pw + 2);
        g.fillStyle = css(i >= hp ? 'shadow' : 'red'); g.fillRect(x, y, pw, pw);
        if (i < hp) { g.fillStyle = css('rose'); g.fillRect(x + 1, y + 1, 3, 2); }
      }
      if (health.dead) drawText(g, 'YOU FELL', W / 2, H * 0.4, 'rose', { align: 'center', scale: 2, outline: 'ink' });
      if (!hud) return;
      if (P.showcase) {
        drawText(g, 'BOSS: THE WARDEN', 10, 24, 'bone', { outline: 'ink' });
        const b = fight.boss;
        drawText(g, `${fight.state.toUpperCase()}  PHASE ${b.phase}   ${b.a ? b.a.name.toUpperCase() : b.state.toUpperCase()}${b.punishing ? '  OPEN!' : ''}`, 10, 34, b.punishing ? 'gold' : 'mist', { shadow: 'ink' });
        drawText(g, bot ? 'BOT PLAYS  (ANY KEY: TAKE OVER)' : 'LIVE', 10, 44, bot ? 'mist' : 'leaf', { shadow: 'ink' });
        const t = 'WASD MOVE  J ATTACK  K DASH  1 2 3 PHASE  I INTRO  X KILL  B BOT  R RESTART  H HUD';
        const w = textWidth(t) + 8;
        g.fillStyle = css('ink'); g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
        drawText(g, t, W / 2, H - 10, 'slate', { align: 'center' });
      }
    },
    state() {
      return { showcase: { id: 'boss', bot, ...fight.info(), health: health.info() } };
    },
  };
}

// ---- debug hooks: __GR.debug.boss(action, arg) ----------------------------------------------------------------
//   no action / 'state'     the fight's state
//   'phase', n              jump to phase n (a real transition if already fighting)
//   'attack', name          queue an attack next: sweep lash slam slam2 leap summon
//   'hp', fraction          set the Warden's hp as a fraction of max
//   'kill'                  the killing blow (starts the death sequence)
//   'intro'                 restart with the intro     'skip'  skip the intro     'restart'
//   'god', bool             hero cannot lose hp       'bot', bool   toggle the bot
//   'tune'                  returns TUNE (numbers are live)
debug.add('boss', (action, arg) => {
  const c = current;
  if (!c) return { ok: false, error: 'no boss scene is live' };
  const f = c.fight, b = f.boss;
  switch (action) {
    case undefined: case 'state': return { ok: true, ...f.info() };
    case 'phase': if (b.state === 'move' || b.state === 'recover') { b.beginTransition(Math.min(3, Math.max(2, +arg))); } else { c.P.phase = +arg; c.P.intro = false; c.restart(); } return { ok: true, ...f.info() };
    case 'attack': b.forced = [arg]; b.queue = []; b.cool = 0; return { ok: true };
    case 'hp': b.hp = Math.max(1, Math.round(b.maxHp * +arg)); f.hpShown = f.hpGhost = b.hp / b.maxHp; return { ok: true, hp: b.hp };
    case 'kill': return { ok: b.kill() };
    case 'intro': c.P.phase = 1; c.P.intro = true; c.restart(); return { ok: true };
    case 'skip': f.skipIntro(); return { ok: true };
    case 'restart': c.restart(); return { ok: true };
    case 'god': world.god = arg !== false; return { ok: true, god: world.god };
    case 'tune': return { ok: true, tune: TUNE };
    case 'part': { const m = b[arg]; if (!m) return { ok: false, error: 'no part' }; m.visible = !m.visible; return { ok: true, visible: m.visible }; }
    default: return { ok: false, error: `unknown action "${action}"` };
  }
});
