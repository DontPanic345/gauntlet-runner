// Placeholder scenes so every scene name in the contract works from day one:
// title, run, boss, pause, gameover, victory. Each is replaced by the piece that owns it
// (title -> `title`, run/boss/gameover/victory -> `run-flow`, pause -> `title` menus) by
// calling scenes.define(name, ...) with the same name from a module imported in main.js.
//
// They are deliberately plain, and they say they are placeholders.

import { scenes } from './scenes.js';
import { display } from './display.js';
import { input } from './input.js';
import { loop, Interp, DT } from './loop.js';
import { world } from './world.js';
import { rng } from './rng.js';
import { feedback } from './feedback.js';
import { drawText } from './pixelfont.js';
import { buildStage } from './stage.js';
import { voxelMesh, VOXEL } from '../render/voxel/index.js';
import '../render/voxel/testmodels.js';
import { createHeroRig } from '../hero/model.js';   // hero piece: the real rig and animator
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';  // movement piece: controller, collision, camera
import { CollisionWorld, setCollision } from './collision.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';   // combat piece: combo, hits, hurt rules
import { createCombatFx } from '../combat/fx.js';
import '../combat/sfx.js';
import { TrainingDummy, SparringDummy } from '../combat/dummy.js';
import { debug } from './debug.js';
import { vfx } from '../vfx/vfx.js';   // vfx piece: footstep/dash/landing dust and death bursts from events
import { createEnemies, spawnHandler } from '../enemies/index.js';   // enemies piece: debug.spawn('husk'|'wisp'|'brute'|'mite'|'mites')

const note = (g, text) => drawText(g, text, 6, display.height - 12, 'mist', { shadow: 'ink' });
const blink = (period = 1.1) => (loop.realTime % period) < period * 0.62;

// ---- title ------------------------------------------------------------------------------
scenes.define('title', (() => {
  let stage, shrine, spin;
  return {
    enter(_d, root) {
      world.reset();
      display.setZoom(2);
      stage = buildStage(root, { torches: [[-2.2, -0.6], [2.2, -0.6]], rng: rng.fork('title-stage') });
      shrine = voxelMesh('test.shrine');
      root.add(shrine);
      spin = new Interp({ a: -0.5 }).angle('a');
      display.setCameraTarget(0, 1.1, 0);
    },
    tick() { spin.snap(); spin.cur.a += DT * 0.25; stage.tick(); },
    frame() { if (input.ui.pressed('confirm') || input.ui.pressed('attack')) scenes.go('run'); },
    render(alpha) { shrine.rotation.y = spin.at(alpha).a; stage.render(alpha); },
    ui(g) {
      const W = display.width;
      drawText(g, 'GAUNTLET-RUNNER', W / 2, 26, 'bone', { scale: 3, align: 'center', outline: 'ink' });
      if (blink()) drawText(g, 'PRESS ENTER', W / 2, display.height - 44, 'gold', { align: 'center', shadow: 'ink', scale: 1 });
      note(g, 'PLACEHOLDER TITLE (FOUNDATION). THE TITLE PIECE REPLACES THIS.');
    },
  };
})());

// ---- run / boss: a stand-in hero on the stage ------------------------------------------
function runScene(label) {
  const TORCHES = [[-3.5, -3], [3.5, -3], [-3.5, 3], [3.5, 3]];
  let stage, hero, anim, rig, ctl, cam, deadT, combat, cfx, foes;
  return {
    pausable: true,
    enter(_d, root) {
      world.reset();
      display.setZoom(1);
      stage = buildStage(root, { torches: TORCHES, rng: rng.fork(label + '-stage') });
      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: 0, z: 0, yaw: 0 });
      anim.spawn();
      const cw = new CollisionWorld();
      cw.addRing(0, 0, 4.9);
      for (const [x, z] of TORCHES) cw.addCircle(x, z, 0.22, 'torch');
      setCollision(cw);
      ctl = new HeroController({ x: 0, z: 0, yaw: 0, anim, collision: cw });
      cam = new CameraRig({ bounds: { minX: -1.6, maxX: 1.6, minZ: -1.2, maxZ: 1.2 } });
      cam.reset(0, 0);
      deadT = -1;
      hero = new HeroHealth({ ctl, anim, rig, hp: 5 });
      combat = new HeroCombat({ ctl, anim, health: hero, targets: () => world.enemies });
      cfx = createCombatFx(root);
      vfx.bind(['move', 'kill']);   // unbinds itself when the scene exits
      world.hero = hero;
      world.enemies = [];
      // debug.spawn('dummy' | 'sparring', x, z): combat's training targets (enemies replaces this)
      foes = createEnemies(root, { collision: cw, bounds: { minX: -4.9, maxX: 4.9, minZ: -4.9, maxZ: 4.9 } });
      debug.handle('spawn', spawnHandler(foes, (type, x, z) => {
        if (type !== 'dummy' && type !== 'sparring') return { ok: false, error: `no enemy type "${type}" (try husk, wisp, brute, mite, mites, dummy or sparring)` };
        const b = { minX: -4.6, maxX: 4.6, minZ: -4.6, maxZ: 4.6 };
        const d = type === 'dummy' ? new TrainingDummy(root, { id: `D${world.enemies.length}`, x, z, bounds: b })
          : new SparringDummy(root, { id: `S${world.enemies.length}`, x, z, bounds: b, health: hero });
        d.attachCollider(cw);
        world.enemies.push(d);
        return { ok: true, id: d.id };
      }));
      world.room = { index: 0, kind: label === 'boss' ? 'boss' : 'arena', placeholder: true };
    },
    exit() { setCollision(null); cfx.dispose(); foes.dispose(); },
    tick() {
      stage.tick();
      combat.tick();   // combo input, ctl.tick(), hits, hero hurt/death rules (combat piece)
      cam.tick(ctl);
      for (const e of world.enemies) if (!foes.list.includes(e)) e.tick?.();
      foes.tick();
      cfx.tick();
      if (hero.dead && deadT < 0) deadT = 0;
      if (deadT >= 0 && ++deadT > 80) scenes.go('gameover', { cause: 'debug' });
    },
    render(alpha) {
      anim.render(alpha);
      hero.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y, off.z);
      for (const e of world.enemies) if (!foes.list.includes(e)) e.render?.(alpha);
      foes.render(alpha);
      stage.render(alpha);
      cfx.render(alpha);
    },
    ui(g) {
      cfx.ui(g);
      drawText(g, `HP ${hero.hp}/${hero.maxHp}`, 6, 6, hero.hp <= 1 ? 'red' : 'bone', { shadow: 'ink' });
      drawText(g, label === 'boss' ? 'BOSS (PLACEHOLDER)' : 'RUN (PLACEHOLDER)', display.width - 6, 6, 'mist', { align: 'right', shadow: 'ink' });
      note(g, `PLACEHOLDER ${label.toUpperCase()} SCENE (FOUNDATION). WASD MOVE  K DASH  J ATTACK  ESC PAUSE`);
    },
  };
}
scenes.define('run', runScene('run'));
scenes.define('boss', runScene('boss'));

// ---- pause ------------------------------------------------------------------------------
scenes.define('pause', (() => {
  let t0 = 0;
  return {
    enter() { t0 = loop.realTime; },
    ui(g) {
      const k = Math.min(1, (loop.realTime - t0) / 0.12);
      g.fillStyle = `rgba(11,10,18,${0.55 * k})`;
      g.fillRect(0, 0, display.width, display.height);
      const y = Math.round(display.height / 2 - 20 + (1 - k) * 8);
      drawText(g, 'PAUSED', display.width / 2, y, 'bone', { scale: 3, align: 'center', outline: 'ink' });
      drawText(g, `${input.describe('pause')} TO RESUME`, display.width / 2, y + 30, 'fog', { align: 'center', shadow: 'ink' });
    },
  };
})());

// ---- gameover / victory -----------------------------------------------------------------
function endScene(heading, color, sub) {
  let t0 = 0;
  return {
    enter() { t0 = loop.realTime; world.reset(); display.setZoom(1); display.setCameraTarget(0, 0, 0); },
    frame() {
      if (loop.realTime - t0 < 0.4) return;
      if (input.ui.pressed('confirm') || input.ui.pressed('attack')) scenes.go('run');
      else if (input.ui.pressed('cancel')) scenes.go('title');
    },
    ui(g) {
      const k = Math.min(1, (loop.realTime - t0) / 0.3);
      const y = Math.round(display.height / 2 - 30 - (1 - k) * 12);
      drawText(g, heading, display.width / 2, y, color, { scale: 3, align: 'center', outline: 'ink' });
      drawText(g, sub, display.width / 2, y + 34, 'fog', { align: 'center', shadow: 'ink' });
      note(g, 'PLACEHOLDER (FOUNDATION). RUN-FLOW REPLACES THIS.');
    },
  };
}
scenes.define('gameover', endScene('YOU FELL', 'red', 'ENTER: TRY AGAIN    ESC: TITLE'));
scenes.define('victory', endScene('THE WARDEN FALLS', 'gold', 'ENTER: RUN AGAIN    ESC: TITLE'));

