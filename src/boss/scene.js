// The 'boss' scene (piece `boss`): the Warden's Pit in normal play. Replaces foundation's
// placeholder; main.js imports this module after placeholders.js.
//
// data: { intro = true, phase = 1, hp = 5, maxHp }   (?scene=boss plays the intro)
// The fight is won when the Warden's death sequence ends: THE WARDEN FALLS holds for ~5 s,
// then 'victory'. If the hero dies: 'gameover' { cause: 'warden' }. Held boons work here
// (the boons piece's progression, with no drops).

import { scenes } from '../core/scenes.js';
import { display } from '../core/display.js';
import { world } from '../core/world.js';
import { debug } from '../core/debug.js';
import { createProgression } from '../progression/index.js';
import { spawnHandler } from '../enemies/index.js';
import { createBossFight } from './fight.js';

scenes.define('boss', (() => {
  let fight = null, prog = null, endT = -1;
  return {
    pausable: true,
    enter(data, root) {
      world.reset();
      display.setZoom(1);
      fight = createBossFight(root, { intro: data?.intro ?? true, phase: data?.phase ?? 1, hp: data?.hp ?? 5, maxHp: data?.maxHp });
      world.room = { index: 5, kind: 'boss', id: 'warden', name: "THE WARDEN'S PIT" };
      prog = createProgression(root, { ctl: fight.ctl, anim: fight.anim, rig: fight.rig, health: fight.health, combat: fight.combat, drops: false });
      debug.handle('spawn', spawnHandler(fight.mgr));
      endT = -1;
    },
    exit() {
      prog?.dispose(); prog = null;
      fight?.dispose(); fight = null;
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },
    tick() {
      fight.tick();
      prog.tick();
      if (fight.state === 'lost' && endT < 0) endT = 0;
      if (fight.state === 'won' && fight.wonT > 320 && endT < 0) endT = 0;
      if (endT >= 0 && ++endT > 20) scenes.go(fight.state === 'won' ? 'victory' : 'gameover', { cause: 'warden' });
    },
    frame() { fight?.frame(); prog?.frame(); },
    render(alpha) { fight.render(alpha); prog.render(alpha); },
    ui(g) { fight.ui(g); prog.ui(g); },
    state() { return { boss: fight?.info() ?? null }; },
  };
})());
