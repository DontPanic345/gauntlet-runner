// ?showcase=boons : the shrine and the pick-1-of-3 choice screen, in a real arena (the
// Antechamber, lit, no waves).
//   DEMO (default): a shrine rises out of the floor, the hero walks up and offers (E), the
//   cards come in, the selection moves across them, one is taken and flies into the hero.
//   The shrine re-arms and offers again; held boons pile up, so upgrade cards (LV 1 > 2) and
//   synergy rows appear on later rolls. After six picks the run resets.
//   LIVE (&auto=0, or B): walk with WASD, E at the shrine, A/D or the mouse to choose, J / E /
//   Enter / click to take, R to reroll the open offer.
//
// ?showcase=boons&give=<id>[,<id>...] : the dummy room. The hero holds those boons (id:2 or
// id:3 for more stacks; `all` for everything) in the same arena with four husks that stand
// still and do not attack (puppets). They die, spill shards and hearts, and come back through
// portals. The DEMO pilot walks up and combos, dashes through the group, and, for bulwark and
// phoenix, takes a scripted hit (labelled). Any movement key takes over (LIVE); B returns.
//
// Params:  &auto=0  &zoom=1..3 (default 2)  &hud=0 (no showcase labels; the game HUD stays)
//          &offer=a,b,c  (choice: always offer these)   &at=open (choice: skip the walk-up)
//          &slow=<s>   &seed=<n> (the run seed: rolls, drops)   &uislow=<s> (slow the card screen, e.g. 0.25)
// Keys:    choice: WASD, E, A/D, 1-3, J/E/Enter, R reroll, B demo/live
//          room:   WASD, J, K, B demo, R respawn the husks, Z zoom, T slow-mo, H hud, P/Esc pause

import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { drawText, textWidth, LINE_H } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { setCollision } from '../core/collision.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import '../combat/sfx.js';
import { vfx } from '../vfx/vfx.js';
import { spawnHandler } from '../enemies/index.js';
import { Arena, generateArena, cameraBounds, setActiveArena } from '../world/arena.js';
import { BOONS, BOON_IDS, RARITY, progress, giveBoon, resetProgress, rollChoice, has } from './boons.js';
import { createProgression } from './index.js';
import { choiceTiming } from './shrine.js';
import { drawIcon } from './icons.js';
import { richText, bevel } from './cards.js';

const SLOWS = [1, 0.5, 0.25, 0.1];
const HOMES = [[-1.7, -1.2], [1.7, -1.2], [0, -2.5], [2.6, 0.7]];
const SHRINE = { x: 0, z: -1.1 };

export default function boonsShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  const giveP = P('give', null);
  const mode = giveP ? 'room' : 'choice';
  let auto = P('auto', '1') !== '0';
  let zoom = Math.max(1, Math.min(3, parseInt(P('zoom', '2'), 10) || 2));
  let hud = P('hud', '1') !== '0';
  const offerP = P('offer', null);
  const at = P('at', null);
  const slowP = parseFloat(P('slow', '1'));
  let slowIdx = Math.max(0, SLOWS.indexOf(slowP));

  let root, arena, rig, anim, ctl, cam, health, combat, cfx, prog;
  let offs = [];
  const homes = [];
  const respawn = [];
  let tick = 0, liveRearm = 0;
  const gives = [];
  const status = { text: '', until: 0 };
  const say = (t, s = 1.4) => { status.text = t; status.until = loop.realTime + s; };

  // ---- the keyboard-style pilot -------------------------------------------------------------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, label: '', step: 'start', t: 0, cycle: 0, presses: 0, target: null, dashTo: null,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };
  const go = (step, label) => { pilot.step = step; pilot.t = 0; if (label !== undefined) pilot.label = label; };
  const steer = (x, z, stop = 0.08) => {
    const dx = x - ctl.x, dz = z - ctl.z, d = Math.hypot(dx, dz);
    if (d < stop) { pilot.mv = { x: 0, z: 0 }; return true; }
    const k = Math.min(1, d / 0.35);
    pilot.mv = { x: dx / d * k, z: dz / d * k };
    return false;
  };
  const alive = () => world.enemies.filter((e) => !e.dead && !e.dying && e.state !== 'spawn');
  const dashy = () => has('ember-trail') || has('storm-dash') || has('fleet-foot');
  const hitty = () => has('bulwark') || has('phoenix');

  function roomPilot() {
    pilot.t++;
    pilot.mv = { x: 0, z: 0 };
    const foes = alive();
    switch (pilot.step) {
      case 'start': if (pilot.t > 40) go('approach', 'COMBO'); break;
      case 'approach': {
        if (!foes.length) { if (pilot.t > 30) steer(0, 1.4); break; }
        const t = foes.reduce((b, e) => (Math.hypot(e.x - ctl.x, e.z - ctl.z) < Math.hypot(b.x - ctl.x, b.z - ctl.z) ? e : b));
        pilot.target = t;
        const d = Math.hypot(t.x - ctl.x, t.z - ctl.z);
        if (d < 1.15 || pilot.t > 240) { pilot.mv = { x: (t.x - ctl.x) / d, z: (t.z - ctl.z) / d }; go('combo'); pilot.presses = 0; break; }
        steer(t.x, t.z, 1.1);
        break;
      }
      case 'combo':
        if (pilot.t === 1 || pilot.t === 14 || pilot.t === 27) pilot.want.attack = true;
        if (pilot.t > 66) {
          pilot.cycle++;
          if (hitty() && pilot.cycle % 2 === 0) go('hitPrep', 'TAKES A HIT (SCRIPTED)');
          else if ((dashy() && pilot.cycle % 2 === 1) || pilot.cycle % 4 === 3) go('dashPrep', 'DASH THROUGH');
          else go('approach', 'COMBO');
        }
        break;
      case 'dashPrep': {
        const f = alive();
        if (!f.length) { go('approach', 'COMBO'); break; }
        const cx = f.reduce((s, e) => s + e.x, 0) / f.length, cz = f.reduce((s, e) => s + e.z, 0) / f.length;
        if (pilot.t === 1) {
          let dx = ctl.x - cx, dz = ctl.z - cz; const l = Math.hypot(dx, dz) || 1;
          pilot.dashFrom = { x: cx + dx / l * 2.3, z: cz + dz / l * 2.3 };
          pilot.dashDir = { x: -dx / l, z: -dz / l };
        }
        if (steer(pilot.dashFrom.x, pilot.dashFrom.z) || pilot.t > 200) {
          pilot.mv = pilot.dashDir; pilot.want.dash = true; go('dashOut');
        }
        break;
      }
      case 'dashOut':
        if (pilot.t < 12) pilot.mv = pilot.dashDir;
        if (pilot.t > 50) go('approach', 'COMBO');
        break;
      case 'hitPrep':
        if (pilot.t === 20) {
          const f = alive()[0];
          if (has('phoenix') && !progress.spent.has('phoenix')) { health.hp = 1; pilot.label = 'TAKES A KILLING BLOW (SCRIPTED)'; }
          health.hurt(1, f ? { x: f.x, z: f.z } : { x: ctl.x, z: ctl.z - 1 }, { force: true });
        }
        if (pilot.t > 150) {
          health.hp = health.maxHp;
          if (progress.spent.has('phoenix') && pilot.t > 160) progress.spent.delete('phoenix');
          go('approach', 'COMBO');
        }
        break;
    }
  }

  // the choice-mode pilot runs on real time (the cards do)
  const cp = { phase: 'walk', t0: 0, path: [], picks: 0, salt: 0 };
  function choiceTick() {
    pilot.t++;
    pilot.mv = { x: 0, z: 0 };
    const sh = prog.shrine;
    if (pilot.step === 'walk') {
      if (sh?.state === 'ready' && steer(SHRINE.x, SHRINE.z + 1.75)) { pilot.mv = { x: 0, z: -1 }; go('offer'); }
      else if (sh?.state !== 'ready' && pilot.t < 30) pilot.mv = { x: 0, z: 0 };
    } else if (pilot.step === 'offer') {
      pilot.mv = { x: 0, z: -0.3 };
      if (pilot.t === 10) { openOffer(); go('choosing'); }
    } else if (pilot.step === 'rest') {
      if (pilot.t > 150) {
        if (progress.picks >= 6) { resetProgress(); prog.runtime.apply(); say('NEW RUN: BOONS RESET', 2); }
        sh?.rearm();
        go('offer');
      }
    }
  }
  function choiceFrame() {
    const ch = prog.choice;
    if (!auto || !ch.active) return;
    if (ch.phase !== 'pick') { cp.t0 = loop.realTime; return; }
    const t = loop.realTime - cp.t0;
    // look along the cards, linger, then take one
    const plan = [[0.45, 0], [1.05, 2], [1.75, 1]];
    for (const [tt, i] of plan) if (t >= tt && t < tt + 0.05) ch.select(i);
    if (t >= 2.5) {
      // prefer an upgrade or a synergy partner, else the rarest card, else the middle one
      const ids = ch.ids;
      let pick = ids.findIndex((id) => id && progress.held.has(id));
      if (pick < 0) pick = ids.reduce((b, id, i) => (id && RARITY[BOONS[id].rarity].order > RARITY[BOONS[ids[b]].rarity].order ? i : b), 1);
      ch.select(pick);
      ch.confirm();
      cp.t0 = Infinity;
    }
  }
  function openOffer(salt = 0) {
    const ids = offerP ? offerP.split(',').map((s) => s.trim()).filter((id) => BOONS[id]) : rollChoice(3, { salt });
    prog.openChoice(ids);
  }

  function respawnAll() {
    for (const e of [...world.enemies]) if (!e.dead) { e.dying = true; }
    arena.foes.clear();
    world.enemies.length = 0;
    homes.forEach((h, i) => spawnPuppet(i, true));
  }
  function spawnPuppet(i, instant = false) {
    const [x, z] = HOMES[i];
    const e = arena.foes.spawn('husk', x, z, { instant, yaw: Math.atan2(-x, 2 - z) });
    e.ai = false;
    homes[i] = e;
  }

  return {
    pausable: true,
    enter(_d, r) {
      root = r;
      world.reset();
      resetProgress();
      tick = 0;
      display.setZoom(zoom);
      choiceTiming.speed = Math.max(0.02, parseFloat(P('uislow', '1')) || 1);
      loop.setTimeScale(Number.isFinite(slowP) && slowP > 0 ? slowP : 1);
      const L = generateArena(0, rng.seed, { template: 'antechamber' });
      arena = setActiveArena(new Arena(root, L, { hero: () => ctl, waves: false, awake: true, banners: false, autoSeal: false }));
      setCollision(arena.collision);
      const start = mode === 'room' ? { x: 0, z: 1.6, yaw: Math.PI } : at === 'open' ? { x: 0, z: SHRINE.z + 1.75, yaw: Math.PI } : { x: -0.6, z: 3.2, yaw: Math.PI };
      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: start.x, z: start.z, yaw: start.yaw });
      ctl = new HeroController({ x: start.x, z: start.z, yaw: start.yaw, anim, collision: arena.collision, source: auto ? pilot : input });
      cam = new CameraRig({ bounds: cameraBounds(L, zoom) });
      if (mode === 'choice') cam.reset((start.x + SHRINE.x) / 2, (start.z + SHRINE.z) / 2 + 0.2); else cam.reset(start.x, start.z);
      health = new HeroHealth({ ctl, anim, rig, hp: 5 });
      combat = new HeroCombat({ ctl, anim, health, targets: () => [...world.enemies, ...arena.targets()] });
      cfx = createCombatFx(root);
      vfx.bind(['move', 'kill']);
      world.hero = health;
      world.enemies = world.enemies || [];
      prog = createProgression(root, { ctl, anim, rig, health, combat, arena });
      debug.handle('spawn', spawnHandler(arena.foes));
      if (mode === 'room') {
        for (const tok of (giveP === 'all' ? BOON_IDS : giveP.split(','))) {
          const [id, n] = tok.trim().split(/[:*]/);
          for (let k = 0; k < Math.max(1, parseInt(n ?? '1', 10) || 1); k++) gives.push(giveBoon(id, { quiet: true }));
        }
        prog.runtime.apply();
        HOMES.forEach((_, i) => spawnPuppet(i, true));
        offs.push(events.on('enemy:death', (e) => {
          const i = homes.indexOf(e.enemy);
          if (i >= 0) respawn.push({ i, at: tick + 170 });
        }));
        world.room = { index: 0, kind: 'arena', showcase: 'boons' };
        go('start', 'COMBO');
      } else {
        prog.spawnShrine(SHRINE.x, SHRINE.z, { rise: at !== 'open' });
        world.room = { index: 0, kind: 'arena', showcase: 'boons' };
        go(at === 'open' ? 'offer' : 'walk', '');
        offs.push(events.on('boon:picked', () => { if (auto) go('rest'); else liveRearm = tick + 160; }));
      }
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      prog.dispose(); cfx.dispose(); arena.dispose();
      setCollision(null);
      loop.setTimeScale(1);
      choiceTiming.speed = 1;
    },
    frame() {
      prog.frame();
      if (mode === 'choice') choiceFrame();
      // keys
      if (input.ui.key('KeyB')) { auto = !auto; ctl.source = auto ? pilot : input; if (prog.choosing) { /* the lock keeps the hero still */ } say(auto ? 'DEMO' : 'LIVE'); if (auto && mode === 'choice') go(prog.shrine?.state === 'ready' ? 'walk' : 'rest'); }
      if (!prog.choosing && mode === 'room' && auto && ['up', 'down', 'left', 'right'].some((a) => input.ui.pressed(a))) { auto = false; ctl.source = input; say('LIVE'); }
      if (mode === 'choice' && input.ui.key('KeyR') && prog.choosing) { prog.choice.close(); cp.salt++; openOffer(cp.salt); }
      if (mode === 'room' && input.ui.key('KeyR')) respawnAll();
      if (input.ui.key('KeyZ') && !prog.choosing) { zoom = zoom % 3 + 1; display.setZoom(zoom); cam.bounds = cameraBounds(arena.L, zoom); }
      if (input.ui.key('KeyT') && !prog.choosing) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (input.ui.key('KeyH')) hud = !hud;
    },
    tick() {
      tick++;
      if (auto && ctl.source === pilot) (mode === 'room' ? roomPilot : choiceTick)();
      combat.tick();
      if (mode === 'choice') {
        // the camera frames the shrine and the hero together
        cam.tick({ x: (ctl.x + SHRINE.x) / 2, z: (ctl.z + SHRINE.z) / 2 + 0.2, vx: 0, vz: 0 });
      } else cam.tick(ctl);
      arena.tick();
      cfx.tick();
      prog.tick();
      for (let i = respawn.length - 1; i >= 0; i--) if (respawn[i].at <= tick) { spawnPuppet(respawn[i].i); respawn.splice(i, 1); }
      if (!auto && liveRearm && tick >= liveRearm) { liveRearm = 0; prog.shrine?.rearm(); }
      if (health.dead && tick % 200 === 0) { health.revive(); }
    },
    render(alpha) {
      anim.render(alpha);
      health.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y, off.z);
      arena.render(alpha);
      cfx.render(alpha);
      prog.render(alpha);
    },
    ui(g) {
      cfx.ui(g);
      prog.ui(g);
      if (!hud) return;
      const W = display.width, H = display.height;
      if (prog.choosing) return;
      // top left: what this is
      drawText(g, mode === 'room' ? 'BOONS: DUMMY ROOM' : 'BOONS: THE SHRINE', 6, 6, 'bone', { shadow: 'ink' });
      drawText(g, auto ? 'DEMO' : 'LIVE', 6, 16, auto ? 'gold' : 'leaf', { shadow: 'ink' });
      if (auto && pilot.label) drawText(g, pilot.label, 34, 16, 'fog', { shadow: 'ink' });
      if (mode === 'room') boonPanel(g);
      if (loop.realTime < status.until) drawText(g, status.text, W / 2, H - 70, 'gold', { align: 'center', scale: 2, outline: 'ink' });
      const keys = mode === 'room' ? 'WASD MOVE  J ATTACK  K DASH  B DEMO  R RESPAWN  Z ZOOM  T SLOW  H HUD' : 'WASD MOVE  E OFFER  A/D CHOOSE  J TAKE  R REROLL  B DEMO/LIVE  H HUD';
      drawText(g, keys, W / 2, H - 11, 'mist', { align: 'center', shadow: 'ink' });
    },
    state() {
      return { showcase: { id: 'boons', mode, auto, give: giveP, gives: gives.map((r) => (r.ok ? `${r.id}:${r.stacks}` : r.error)), pilot: { step: pilot.step, label: pilot.label, cycle: pilot.cycle }, zoom, progression: prog?.info() } };
    },
  };

  // the panel describing the held boons (room mode): icon, name, the card text
  function boonPanel(g) {
    const ids = progress.order;
    let y = 30;
    const w = 168;
    for (const id of ids.slice(0, 3)) {
      const B = BOONS[id], R = RARITY[B.rarity];
      const n = progress.held.get(id);
      const lines = 3;
      bevel(g, 'ink', 4, y - 2, w + 4, 22 + lines * LINE_H, 2);
      bevel(g, R.frame, 5, y - 1, w + 2, 20 + lines * LINE_H, 2);
      bevel(g, 'night', 6, y, w, 18 + lines * LINE_H, 2);
      drawIcon(g, id, 8, y + 1, { scale: 1 });
      drawText(g, B.name + (n > 1 ? ` LV ${n}` : ''), 28, y + 2, R.text);
      drawText(g, R.label, 28, y + 11, 'slate');
      richText(g, B.text(n, B.lv(n)), 9, y + 20, w - 6, 'frost', B.color === 'bone' ? 'white' : B.color, { align: 'left' });
      const procs = prog.runtime.procs[id] ?? 0;
      drawText(g, `x${procs}`, w + 2, y + 2, procs ? 'gold' : 'slate', { align: 'right' });
      y += 26 + lines * LINE_H;
    }
    if (ids.length > 3) drawText(g, `+${ids.length - 3} MORE`, 8, y, 'fog', { shadow: 'ink' });
  }
}
