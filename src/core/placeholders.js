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
  let stage, mesh, pos, hero, dashT, atkT, vx, vz, facing;
  return {
    pausable: true,
    enter(_d, root) {
      world.reset();
      display.setZoom(1);
      stage = buildStage(root, { torches: [[-3.5, -3], [3.5, -3], [-3.5, 3], [3.5, 3]], rng: rng.fork(label + '-stage') });
      mesh = voxelMesh('test.runner');
      root.add(mesh);
      pos = new Interp({ x: 0, z: 0, yaw: 0, sy: 1 }).angle('yaw');
      hero = { x: 0, z: 0, hp: 5, maxHp: 5 };
      world.hero = hero;
      world.room = { index: 0, kind: label === 'boss' ? 'boss' : 'arena', placeholder: true };
      dashT = 0; atkT = 0; vx = 0; vz = 0; facing = 0;
    },
    tick() {
      pos.snap();
      stage.tick();
      const m = input.move();
      const c = pos.cur;
      if (dashT > 0) dashT--;
      else {
        const speed = 4.2, acc = 0.35;
        vx += (m.x * speed - vx) * acc;
        vz += (m.z * speed - vz) * acc;
        if (input.consume('dash')) {
          const dx = m.x || Math.sin(facing), dz = m.z || Math.cos(facing);
          const l = Math.hypot(dx, dz) || 1;
          vx = (dx / l) * 13; vz = (dz / l) * 13; dashT = 8;
          feedback.shake(1.5, 90);
        }
      }
      if (atkT > 0) atkT--;
      else if (input.consume('attack')) { atkT = 14; feedback.kick(Math.sin(facing), Math.cos(facing), 2); }
      c.x += vx * DT; c.z += vz * DT;
      const r = Math.hypot(c.x, c.z), R = 4.6;
      if (r > R) { c.x *= R / r; c.z *= R / r; }
      if (Math.hypot(m.x, m.z) > 0.1) facing = Math.atan2(m.x, m.z);
      c.yaw = facing;
      c.sy = atkT > 0 ? 1 + 0.12 * Math.sin((atkT / 14) * Math.PI) * (atkT > 9 ? -1 : 1) : dashT > 0 ? 0.85 : 1;
      hero.x = c.x; hero.z = c.z;
      if (hero.hp <= 0) scenes.go('gameover', { cause: 'debug' });
    },
    render(alpha) {
      const p = pos.at(alpha);
      mesh.position.set(p.x, 0, p.z);
      mesh.rotation.y = p.yaw;
      mesh.scale.set(1 / Math.sqrt(p.sy), p.sy, 1 / Math.sqrt(p.sy));
      display.setCameraTarget(p.x * 0.35, 0.5, p.z * 0.35);
      stage.render(alpha);
    },
    ui(g) {
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

