// The 'run' scene (piece `run-flow`): one arena of the run. Replaces foundation's placeholder.
//
// data: { room = 0, fresh, seed, hp, maxHp, carry }
//   fresh (or arriving from outside a run: title, gameover, showcase, a cold ?scene=run):
//     a new run starts here: record zeroed, boons reset, the world reseeded, hp full.
//   otherwise the hp carried from the last segment is kept (flow.js puts it in data).
// Every arena entry is a drop-in: the runner falls from the dark above the gate with a few
// stones, lands hard (dust ring, shake, thud) and is under control on the landing (the hero
// piece's sword flourish is cut short as soon as you move, attack or dash). A fresh run also
// shows the run card (RUN n / THE GAUNTLET / SEED) for two seconds. The drop waits while a
// transition wall still covers the screen.
// Walking out of the open exit goes to the next corridor (or, after arena 5, the Warden) through
// the router, which styles the change.

import { scenes } from '../core/scenes.js';
import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { reseed, rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { feedback } from '../core/feedback.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { look } from '../render/look.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { setCollision } from '../core/collision.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import { TrainingDummy, SparringDummy } from '../combat/dummy.js';
import { vfx } from '../vfx/vfx.js';
import { spawnHandler } from '../enemies/index.js';
import { Arena, generateArena, cameraBounds, setActiveArena, ARENA_COUNT } from '../world/arena.js';
import { createProgression } from '../progression/index.js';
import { resetProgress } from '../progression/boons.js';
import { createHud } from '../ui/hud.js';
import { ditherRect } from '../ui/menus.js';
import { run, startRun, GAMEPLAY, fmtTime } from './record.js';
import { flow } from './flow.js';
import { runSound } from './sfx.js';

export const DROP = {
  height: 12,      // world units above the floor the fall starts at (just off the top of the view)
  ticks: 15,       // fall time to the floor (then the hero piece's spawn landing plays)
  cancelAfter: 3,  // ticks after landing when any input cuts the flourish and gives control
};

const SPAWN_LIFT = 18 / 8;   // the hero piece's spawn pose starts 18 voxels up
let pilotSource = null;   // the showcase can drive the hero (an input-like source)
export function setPilot(src) { pilotSource = src; }
let active = null;
/** The live arena run: { ctl, anim, hero, combat, arena, drop } (showcase / debug). */
export const activeRun = () => active;

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const easeOut = (t) => 1 - (1 - clamp01(t)) ** 3;

scenes.define('run', (() => {
  let hero, anim, rig, ctl, cam, combat, cfx, arena, prog, hud, offs = [];
  let drop = null;        // { t, started, landed, rocks: [] }
  let card = null;        // { t, number, seed }
  let deadT = -1, index = 0;
  return {
    pausable: true,
    enter(data, root) {
      world.reset();
      display.setZoom(1);
      const prev = data?.__prev;
      const fresh = !!data?.fresh || !run.active || run.ended || !data?.carry;
      index = Math.max(0, Math.min(ARENA_COUNT - 1, data?.room ?? 0));
      if (fresh) {
        const seed = flow.freshSeed(data);
        flow.markStarted();
        reseed(seed);
        if (window.__GR) window.__GR.seed = seed;
        resetProgress();
        startRun(seed);
        card = { t: 0, number: run.number, seed };
      } else card = null;
      const hp = fresh ? 5 : Math.max(1, data?.hp ?? run.hp ?? 5);
      const maxHp = fresh ? 5 : (data?.maxHp ?? run.maxHp ?? 5);

      arena = setActiveArena(new Arena(root, generateArena(index, rng.seed), { hero: () => ctl }));
      const start = arena.start;
      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: start.x, z: start.z, yaw: start.yaw });
      setCollision(arena.collision);
      ctl = new HeroController({ x: start.x, z: start.z, yaw: start.yaw, anim, collision: arena.collision, ...(pilotSource ? { source: pilotSource } : {}) });
      cam = new CameraRig({ bounds: cameraBounds(arena.L, 1) });
      cam.reset(start.x, start.z);
      hero = new HeroHealth({ ctl, anim, rig, hp, maxHp });
      combat = new HeroCombat({ ctl, anim, health: hero, targets: () => [...world.enemies, ...arena.targets()] });
      cfx = createCombatFx(root, { numbers: false });   // the hud piece draws damage numbers
      vfx.bind(['move', 'kill']);
      world.hero = hero;
      run.hp = hp; run.maxHp = maxHp;
      // the drop-in: hidden above until the screen is uncovered
      drop = { t: -1, landed: -1, rocks: [] };
      anim.spawn();
      rig.group.visible = false;
      deadT = -1;

      debug.handle('spawn', spawnHandler(arena.foes, (type, x, z) => {
        if (type !== 'dummy' && type !== 'sparring') return { ok: false, error: `no enemy type "${type}" (try husk, wisp, brute, mite, mites, dummy or sparring)` };
        const b = arena.bounds;
        const d = type === 'dummy' ? new TrainingDummy(root, { id: `D${world.enemies.length}`, x, z, bounds: b })
          : new SparringDummy(root, { id: `S${world.enemies.length}`, x, z, bounds: b, health: hero });
        d.attachCollider(arena.collision);
        world.enemies.push(d);
        return { ok: true, id: d.id };
      }));
      debug.handle('goto', (i) => { scenes.go('run', { room: i | 0 }); return { ok: true, room: i | 0 }; });
      offs.push(events.on('arena:exit', () => scenes.go(index + 1 < ARENA_COUNT ? 'gauntlet' : 'boss', { room: index + 1, index })));
      prog = createProgression(root, { ctl, anim, rig, health: hero, combat, arena, shrineOnClear: true, hud: false });
      hud = createHud({ health: hero, runtime: prog.runtime });
      active = { ctl, anim, hero, combat, arena, get drop() { return drop; }, get landed() { return !!drop && drop.landed >= 0; } };
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      prog.dispose(); hud.dispose();
      setCollision(null); cfx.dispose();
      arena.dispose(); arena = null;
      active = null;
      debug.handle('goto', () => ({ ok: false, error: 'no rooms in this scene' }));
    },
    tick() {
      tickDrop();
      combat.tick();
      arena.tickCamera(cam, ctl);
      for (const e of world.enemies) if (!arena.foes.list.includes(e)) e.tick?.();
      arena.tick();
      cfx.tick();
      prog.tick();
      if (card) card.t++;
    },
    render(alpha) {
      anim.render(alpha);
      hero.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y + dropY(alpha), off.z);
      for (const e of world.enemies) if (!arena.foes.list.includes(e)) e.render?.(alpha);
      arena.render(alpha);
      cfx.render(alpha);
      prog.render(alpha);
    },
    frame() { prog?.frame(); },
    ui(g) {
      cfx.ui(g);
      arena.ui(g);
      drawRocks(g);
      hud.ui(g);
      prog.ui(g);
      if (card && !flow.dying && !hero.dead) drawRunCard(g, card);
    },
    state() { return { run: flow.info(), drop: drop ? { t: drop.t, landed: drop.landed } : null }; },
  };

  // ---- the drop-in -------------------------------------------------------------------------
  function tickDrop() {
    const d = drop;
    if (!d) return;
    if (d.t < 0) {
      // hold the airborne spawn pose until the screen is uncovered
      anim.t = 0;
      if (flow.covered) return;
      d.t = 0;
      rig.group.visible = true;
      // a few stones fall with the runner
      for (let i = 0; i < 9; i++) d.rocks.push({ x: ctl.x + (Math.random() - 0.5) * 2.6, z: ctl.z + (Math.random() - 0.5) * 1.2, h: DROP.height * (0.5 + Math.random() * 0.6), v: 8 + Math.random() * 10, s: i < 3 ? 4 : Math.random() < 0.5 ? 3 : 2, done: false });
      runSound('run.rise', { rate: 0.8 });
    }
    d.t++;
    if (d.t <= DROP.ticks) anim.t = 0;          // the stretched airborne pose all the way down
    if (d.t === DROP.ticks + 1) {
      anim.t = 7;                                // straight into the hero piece's landing (squash on 10)
      d.landed = 0;
      feedback.shake(4, 240);
      feedback.kick(0, 1, 2);
      vfx.shockwave(ctl.x, ctl.z, { radius: 1.6, color: 'fog' });
      vfx.dust(ctl.x, ctl.z, { n: 14, size: 1.4, spread: 1.4 });
      look.flash(ctl.x, 0.4, ctl.z, { color: 'frost', ms: 140, intensity: 1.4, radius: 3 });
      runSound('run.impact');
    }
    if (d.landed >= 0) {
      d.landed++;
      // control on landing: any input cuts the flourish short
      const src = pilotSource ?? input;
      const m = src.move();
      const wants = Math.hypot(m.x, m.z) > 0.2 || src.buffered?.('attack') || src.buffered?.('dash');
      if (anim.state === 'spawn' && d.landed >= DROP.cancelAfter && wants) anim._enter('loco', 5);
      if (anim.state !== 'spawn' && d.landed > 4) d.done = true;
    }
    for (const r of d.rocks) {
      if (r.done) continue;
      r.v += 40 * DT; r.h -= r.v * DT;
      if (r.h <= 0) { r.done = true; vfx.dust(r.x, r.z, { n: r.s > 2 ? 4 : 2, size: 0.7 }); if (r.s > 3) runSound('run.block', { rate: 1.3 + Math.random() * 0.4, gain: 0.5 }); }
    }
  }
  function dropY(alpha) {
    const d = drop;
    if (!d || d.t < 0) return DROP.height;
    const T = DROP.ticks;
    if (d.t > T) return 0;
    const k = Math.min(1, (d.t + alpha) / T);
    // the airborne pose sits SPAWN_LIFT above its feet: fall until the feet meet the floor
    return DROP.height - (DROP.height + SPAWN_LIFT) * k * k;
  }
  function drawRocks(g) {
    const d = drop;
    if (!d || d.t < 0) return;
    for (const r of d.rocks) {
      if (r.done) continue;
      const p = display.worldToScreen(r.x, r.h, r.z);
      const sh = display.worldToScreen(r.x, 0, r.z);
      g.fillStyle = css('ink'); g.fillRect(sh.x - 1, sh.y, r.s + 1, 1);
      g.fillStyle = css('ink'); g.fillRect(p.x - 1, p.y - 1, r.s + 2, r.s + 2);
      g.fillStyle = css('stone'); g.fillRect(p.x, p.y, r.s, r.s);
      g.fillStyle = css('stoneLight'); g.fillRect(p.x, p.y, r.s, 1);
      g.fillStyle = css('fog'); g.fillRect(p.x, p.y, 1, 1);
      // a short streak above it: it is falling fast
      g.fillStyle = css('dusk'); g.fillRect(p.x + (r.s >> 1), p.y - 3, 1, 2);
    }
  }
  function drawRunCard(g, c) {
    // RUN n / THE GAUNTLET / SEED: slides down under the room track, holds, dithers out
    const t = c.t / 60;
    if (t > 3.2) return;
    const W = display.width;
    const inK = easeOut(t / 0.35), outK = clamp01((t - 2.5) / 0.7);
    const y = Math.round(54 - (1 - inK) * 16);
    const w = Math.max(textWidth('THE GAUNTLET', 3), 120) + 36;
    const x = Math.round((W - w) / 2);
    const lvl = 16 * (1 - outK);
    if (lvl <= 0) return;
    ditherRect(g, x, y - 4, w, 54, 'ink', Math.min(11, lvl));
    drawText(g, `RUN ${c.number}`, W / 2, y, outK > 0.5 ? 'slate' : 'fog', { align: 'center', shadow: 'ink' });
    drawText(g, 'THE GAUNTLET', W / 2, y + 11, outK > 0.6 ? 'violet' : 'bone', { align: 'center', scale: 3, outline: 'ink' });
    g.fillStyle = css(outK > 0.4 ? 'blood' : 'ember');
    const rw = Math.round((w - 40) * inK);
    g.fillRect(Math.round(W / 2 - rw / 2), y + 36, rw, 1);
    drawText(g, `SEED ${c.seed}`, W / 2, y + 40, outK > 0.5 ? 'slate' : 'gold', { align: 'center', shadow: 'ink' });
  }
})());

// expose for the showcase / debug
export { fmtTime };
