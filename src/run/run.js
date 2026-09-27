// Run flow and endings (piece `run-flow`): stitches arenas, corridors and the boss into one
// playable run, replacing foundation's `run`/`gameover`/`victory` placeholders (per
// core/placeholders.js's header). Owns the sequencing, the boon-shrine beat between arenas, the
// wipe transitions between segments, the death and victory sequences, the run summary, instant
// restart, and light meta (best time, lore).
//
//   scenes.define('run', createRunScene())        // ?scene=run and Start both land here
//   scenes.define('gameover', ...)  scenes.define('victory', ...)   // reached via scenes.go()
//
// A run is: [arena0] -> boon -> [corridor0] -> [arena1] -> boon -> ... -> [arena4] -> boon ->
// [boss] -> victory. Segments are built and disposed one at a time (not a continuous world);
// the wipe in transition.js covers the swap so it never pops.

import { scenes } from '../core/scenes.js';
import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { feedback } from '../core/feedback.js';
import { drawText } from '../core/pixelfont.js';
import { look } from '../render/look.js';
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
import { createHud } from '../ui/hud.js';
import { createProgression } from '../progression/index.js';
import { generateLayout, Arena } from '../world/arena.js';
import { generateCorridor, Corridor } from '../world/corridor.js';
import { BossFight } from '../boss/fight.js';
import { ARENA_R } from '../boss/arena.js';
import { SegmentWipe } from './transition.js';
import { createDeathSequence } from './death.js';
import { createVictorySequence } from './victory.js';
import { drawSummary } from './summary.js';
import { recordRun } from './meta.js';

// ---- the run's shape: 5 arenas, 4 corridors between them, then the boss (GAME.md "Concept") ---
const PLAN = (() => {
  const p = [];
  for (let i = 0; i < 5; i++) { p.push({ type: 'arena', index: i }); if (i < 4) p.push({ type: 'corridor', index: i }); }
  p.push({ type: 'boss', index: 0 });
  return p;
})();

const ENEMY_CAUSE = { husk: 'overwhelmed by a Husk', brute: 'trampled by a Brute', wisp: 'burned down by an Ember Wisp', mite: 'swarmed by Mites' };
const TRAP_CAUSE = { spikes: 'impaled on the spikes', blades: 'cut down by the axes', jet: 'burned in a fire jet' };
const BOSS_TAG_CAUSE = { sweep: 'caught by the chain sweep', lash: 'caught by the flying ball', slam: 'crushed by a ground slam', leap: 'crushed by a leaping slam' };
function bossCause(tag) {
  const ring = typeof tag === 'string' && tag.endsWith('Ring');
  const base = ring ? tag.slice(0, -4) : tag;
  return `The Warden — ${ring ? 'caught in a shockwave' : (BOSS_TAG_CAUSE[base] || 'a crushing blow')}`;
}
const INTRO_DUR = 2.0;

let currentRun = null;   // for the __GR.debug.run(...) hook

export function createRunScene() {
  let root, rig, anim, ctl, health, combat, cfx, hud, prog, cam;
  let cw = null, esys = null, arena = null, corridor = null, fight = null, seg = null;
  let segIdx = -1;
  let targetsFn = () => [];
  let offs = [];
  let phase = 'play';               // play | transition | dying | winning
  let introT0 = 0;
  let seedUsed = 1;
  let showcaseAt = null, showcaseT = 0;
  let stats = { kills: 0, startTick: 0, cause: null };
  const wipe = new SegmentWipe();
  let death = null, victory = null;

  const currentTargets = () => targetsFn();
  const heroPos = () => ({ x: health ? health.x : 0, z: health ? health.z : 0 });

  function segLabel(spec, obj) {
    if (!spec) return '';
    if (spec.type === 'arena') return obj?.name ?? `ARENA ${spec.index + 1}`;
    if (spec.type === 'corridor') return obj?.name ?? `THE GAUNTLET ${spec.index + 1}`;
    return 'THE WARDEN\'S LAIR';
  }

  function disposeSegment() {
    if (arena) { arena.dispose(); arena = null; }
    if (corridor) { corridor.dispose(); corridor = null; }
    if (fight) { fight.dispose(); fight = null; }
    if (esys) { esys.dispose(); esys = null; }
    world.enemies = [];
    cw = null;
    targetsFn = () => [];
  }

  function buildArena(index) {
    const layout = generateLayout(seedUsed, index);
    cw = new CollisionWorld();
    arena = new Arena(root, layout, { origin: { x: 0, z: 0 }, cw, title: true, banners: true });
    setCollision(cw);
    ctl.collision = cw;
    ctl.teleport(arena.entryPoint.x, arena.entryPoint.z, 0);
    cam.bounds = arena.bounds;
    cam.reset(arena.entryPoint.x, arena.entryPoint.z);
    world.enemies = [];
    esys = createEnemySystem(root, { hero: health, collision: cw, bounds: arena.bounds, list: world.enemies });
    arena.bind({ hero: health, sys: esys });
    targetsFn = () => [...world.enemies, ...arena.targets()];
    look.mood('crypt'); vfx.ambient.mood('crypt');
    seg = { type: 'arena', index, obj: arena };
  }

  function buildCorridor(index) {
    const layout = generateCorridor(seedUsed, index);
    corridor = new Corridor(root, layout, { lights: true });
    setCollision(corridor.cw);
    ctl.collision = corridor.cw;
    ctl.teleport(corridor.entryPoint.x, corridor.entryPoint.z, Math.PI / 2);
    cam.bounds = corridor.cameraBounds;
    cam.reset(corridor.entryPoint.x, corridor.entryPoint.z);
    world.enemies = [];
    targetsFn = () => [];
    corridor.bind({ hero: health });
    seg = { type: 'corridor', index, obj: corridor };
  }

  function buildBoss() {
    cw = new CollisionWorld();
    cw.addRing(0, 0, ARENA_R);
    setCollision(cw);
    ctl.collision = cw;
    ctl.teleport(0, 4.8, Math.PI);
    world.enemies = [];
    world.room = { index: 9, kind: 'boss', id: 'warden' };
    esys = createEnemySystem(root, { hero: health, collision: cw, bounds: { minX: -ARENA_R, maxX: ARENA_R, minZ: -ARENA_R, maxZ: ARENA_R }, list: world.enemies, ai: true, bars: true });
    fight = new BossFight(root, { hero: health, ctl, cw, sys: esys, heroRig: rig, phase: 1, intro: showcaseAt !== 'victory', zoom: 1 });
    world.enemies.push(fight.boss);
    targetsFn = () => [fight.boss, ...world.enemies];
    seg = { type: 'boss', index: 0, obj: fight };
  }

  function buildSegment(spec) {
    disposeSegment();
    if (spec.type === 'arena') buildArena(spec.index);
    else if (spec.type === 'corridor') buildCorridor(spec.index);
    else buildBoss();
  }

  function jumpTo(i) {
    const spec = PLAN[Math.max(0, Math.min(PLAN.length - 1, i))];
    death.cancel(); victory.cancel();
    phase = 'transition';
    wipe.start({
      onCovered: () => { segIdx = PLAN.indexOf(spec); buildSegment(spec); },
      onDone: () => { phase = 'play'; },
    });
  }

  function goToNext() { if (segIdx + 1 < PLAN.length) jumpTo(segIdx + 1); }

  function beginDeath() {
    if (phase === 'dying') return;
    phase = 'dying';
    const p = heroPos();
    vfx.death({ x: p.x, y: 1, z: p.z, power: 1.6, colors: ['blood', 'red', 'ember'] });
    feedback.shake(4, 480);
    death.begin();
  }

  function beginVictory() {
    if (phase === 'winning') return;
    phase = 'winning';
    victory.begin();
  }

  function finishRun(didWin) {
    const elapsed = (loop.tick - stats.startTick) / 60;
    const boons = prog.boons.list().map((b) => ({ id: b.id, level: b.level }));
    const deepest = segLabel(PLAN[Math.max(0, segIdx)], seg?.obj);
    const meta = recordRun({ victory: didWin, time: elapsed, node: Math.max(0, segIdx), seed: seedUsed });
    const payload = {
      victory: didWin, seed: seedUsed, time: elapsed, kills: stats.kills,
      deepestLabel: deepest, causeLabel: stats.cause,
      boons, bestTime: meta.bestTime, isNewBest: meta.isNewBest, newLore: meta.unlocked, runNumber: meta.runs,
    };
    scenes.go(didWin ? 'victory' : 'gameover', payload);
  }

  function tickShowcaseFF() {
    showcaseT++;
    if (showcaseAt === 'death' && showcaseT === 50 && phase === 'play') health.hurt(99, null, { force: true });
    else if (showcaseAt === 'victory' && showcaseT === 16 && phase === 'play' && fight) fight.boss.kill();
  }

  return {
    pausable: true,
    enter(data, r) {
      root = r;
      world.reset();
      display.setZoom(1);
      showcaseAt = data?.showcaseAt ?? null;
      showcaseT = 0;
      seedUsed = Number.isFinite(data?.seed) ? data.seed : rng.seed;
      stats = { kills: 0, startTick: loop.tick, cause: null };
      phase = 'play'; segIdx = -1; seg = null;
      introT0 = loop.realTime;

      rig = createHeroRig(); root.add(rig.group);
      anim = new HeroAnim(rig, { x: 0, z: 0, yaw: 0 });
      anim.spawn();
      ctl = new HeroController({ x: 0, z: 0, yaw: 0, anim });
      health = new HeroHealth({ ctl, anim, rig, hp: 5 });
      combat = new HeroCombat({ ctl, anim, health, targets: () => currentTargets() });
      world.hero = health;
      world.enemies = [];
      cam = new CameraRig({});
      vfx.attach(root, { ambient: 'crypt', capacity: 2600 });
      cfx = createCombatFx(root, { numbers: false });
      prog = createProgression(root, { ctl, health, rig, rng: rng.fork(`run/${seedUsed}`), bounds: null });
      hud = createHud({ ctl, prog });

      death = createDeathSequence({ causeLabel: () => stats.cause || 'the dark claimed you', onDone: () => finishRun(false) });
      victory = createVictorySequence({ heroPos, onDone: () => finishRun(true) });

      const on = (n, fn) => offs.push(events.on(n, fn));
      on('arena:exit', () => {
        if (phase !== 'play' || !arena) return;
        prog.offerShrine({ onClose: () => goToNext() });
      });
      on('gauntlet:exit', () => { if (phase === 'play') goToNext(); });
      on('boss:cleared', () => beginVictory());
      on('combat:heroDeath', () => beginDeath());
      on('enemy:die', () => { stats.kills++; });
      on('enemy:attack', (e) => { stats.cause = ENEMY_CAUSE[e.kind] || stats.cause; });
      on('gauntlet:trapHit', (e) => { stats.cause = TRAP_CAUSE[e.kind] || 'a trap'; });
      on('gauntlet:catch', () => { stats.cause = 'buried by the collapse'; });
      on('boss:heroHit', (e) => { stats.cause = bossCause(e.tag); });
      on('boss:keyRise', () => { if (showcaseAt === 'victory' && fight) ctl.teleport(fight.boss.x, fight.boss.z); });

      debug.handle('spawn', (type, x, z) => (esys ? esys.handleSpawn(type, x, z) : null) ?? { ok: false, error: `cannot spawn "${type}" in this segment` });
      debug.handle('goto', (n) => { jumpTo(n); return { ok: true, index: segIdx < 0 ? 0 : segIdx, target: n }; });

      currentRun = {
        info: () => ({
          phase, seg: seg ? { type: seg.type, index: seg.index } : null, segIdx, seed: seedUsed,
          kills: stats.kills, cause: stats.cause, elapsed: +((loop.tick - stats.startTick) / 60).toFixed(1),
        }),
        skip() { if (death.active) death.skip(); else if (victory.active) victory.skip(); },
        die() { health?.hurt(99, null, { force: true }); },
        win() { events.emit('boss:cleared', {}); },
        goto: (n) => jumpTo(n),
      };

      if (showcaseAt === 'victory') { segIdx = PLAN.length - 1; buildSegment(PLAN[segIdx]); }
      else { segIdx = 0; buildSegment(PLAN[0]); }
    },

    exit() {
      offs.forEach((f) => f()); offs = [];
      disposeSegment();
      hud.dispose(); prog.dispose(); cfx.dispose(); vfx.detach();
      setCollision(null);
      loop.setTimeScale(1);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
      debug.handle('goto', () => ({ ok: false, error: 'no run in progress' }));
      currentRun = null;
    },

    frame(realDt) {
      prog.frame(realDt);
      if (wipe.active) wipe.update(realDt);
      if (death.active) death.frame(realDt);
      if (victory.active) victory.frame(realDt);
    },

    tick() {
      if (showcaseAt) tickShowcaseFF();
      if (prog.blocking) return;
      if (phase === 'transition') { cfx.tick(); vfx.tick(); return; }
      if (phase === 'dying' || phase === 'winning') { combat.tick(); cfx.tick(); vfx.tick(); hud.tick(); return; }
      if (seg?.type === 'arena') { combat.tick(); cam.tick(ctl); arena.tick(); esys.tick(); }
      else if (seg?.type === 'corridor') { combat.tick(); cam.tick(ctl); corridor.tick(); }
      else if (seg?.type === 'boss') { fight.tick(); combat.tick(); esys.tick(); }
      cfx.tick(); vfx.tick(); prog.tick(); hud.tick();
    },

    render(alpha) {
      anim.render(alpha);
      health.render();
      if (seg?.type === 'boss' && fight) {
        fight.render(alpha);
      } else {
        const off = cam.render(alpha, ctl.at(alpha));
        rig.group.position.set(off.x, off.y, off.z);
      }
      if (arena) arena.render(alpha);
      if (corridor) corridor.render(alpha);
      if (esys) esys.render(alpha);
      cfx.render(alpha);
      vfx.render(alpha);
      prog.render(alpha);
    },

    ui(g) {
      cfx.ui(g);
      if (esys) esys.ui(g);
      vfx.ui(g);
      if (arena) arena.ui(g);
      if (corridor) corridor.ui(g);
      if (fight) fight.ui(g);
      hud.ui(g);
      prog.ui(g);
      const introK = loop.realTime - introT0;
      if (introK < INTRO_DUR + 0.5 && phase !== 'dying') drawIntro(g, introK);
      if (wipe.active) wipe.ui(g, display.width, display.height);
      death.ui(g);
      victory.ui(g);
    },

    state() {
      return { run: { phase, segIdx, seed: seedUsed, kills: stats.kills, cause: stats.cause, segment: seg ? seg.type : null } };
    },
  };

  function drawIntro(g, t) {
    const W = display.width;
    const kIn = Math.min(1, t / 0.4);
    const kOut = t > INTRO_DUR ? Math.max(0, 1 - (t - INTRO_DUR) / 0.5) : 1;
    const a = kIn * kOut;
    if (a <= 0.01) return;
    g.globalAlpha = a;
    const oy = Math.round((1 - kIn) * -8);
    drawText(g, 'THE GAUNTLET', Math.round(W / 2), 74 + oy, 'bone', { align: 'center', scale: 2, outline: 'ink' });
    drawText(g, `SEED ${seedUsed}`, Math.round(W / 2), 96 + oy, 'gold', { align: 'center', shadow: 'ink' });
    g.globalAlpha = 1;
  }
}

// ---- gameover / victory: the summary screen, shared -------------------------------------------
function createEndingScene() {
  let t0 = 0, data = null;
  return {
    enter(d) {
      t0 = loop.realTime;
      data = { victory: false, seed: rng.seed, time: 0, kills: 0, deepestLabel: '', causeLabel: null, boons: [], bestTime: null, isNewBest: false, newLore: [], ...d };
      world.reset(); display.setZoom(1); display.setCameraTarget(0, 0.6, 0);
    },
    frame() {
      const t = loop.realTime - t0;
      if (t < 0.3) return;
      if (input.ui.pressed('confirm') || input.ui.pressed('attack')) scenes.go('run', { seed: Math.floor(Math.random() * 1e9) });
      else if (input.ui.pressed('interact')) scenes.go('run', { seed: data.seed });
      else if (input.ui.pressed('cancel')) scenes.go('title');
    },
    ui(g) { drawSummary(g, data, loop.realTime - t0); },
    state() { return { ending: { victory: !!data?.victory, seed: data?.seed } }; },
  };
}

scenes.define('run', createRunScene());
scenes.define('gameover', createEndingScene());
scenes.define('victory', createEndingScene());

// ---- __GR.debug.run(action, arg) ---------------------------------------------------------------
//   no action / 'info'   the run's current phase, segment, seed, kills, cause, elapsed time
//   'skip'                skip the death or victory sequence straight to its ending
//   'die'                 force the hero dead right now (real death rules: sequence, then gameover)
//   'win'                 force `boss:cleared` right now (the real victory beat, then victory screen)
//   'goto', n              jump to PLAN index n (0..9: 5 arenas / 4 corridors / boss), wipe-covered
debug.add('run', (action, arg) => {
  if (!currentRun) return { ok: false, error: 'no run in progress' };
  switch (action) {
    case undefined: case 'info': return { ok: true, ...currentRun.info() };
    case 'skip': currentRun.skip(); return { ok: true };
    case 'die': currentRun.die(); return { ok: true };
    case 'win': currentRun.win(); return { ok: true };
    case 'goto': currentRun.goto(+arg || 0); return { ok: true };
    default: return { ok: false, error: `unknown action "${action}"` };
  }
});

export { PLAN };
