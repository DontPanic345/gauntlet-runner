// ?showcase=run-flow (piece `run-flow`). It drives the real scenes ('run', 'gauntlet', 'boss',
// 'gameover', 'victory') rather than a copy, so what you see is what play does.
//
//   &at=intro        (default) a fresh run: the drop-in and the run card. Then it is live: play.
//   &at=transition   a god-moded tour of every segment change: arena 1 -> corridor 1 -> arena 2 ... ->
//                    the Warden's pit, about 3.5 s per segment (the room is skipped, not played)
//   &at=death        arena 3 with one heart left; a simple pilot walks in and fights until a foe
//                    lands the last hit. Then the real death sequence and summary.
//   &at=summary      the same, but the hero falls to a brute at once and the summary is shown counted
//   &at=victory      the Warden's pit, the killing blow is dealt for you: the Warden's death, then the
//                    victory sequence and summary
// &seed=N (default 7)  &hud=0 hides the showcase label.
// death / summary / victory stage the run's history up to that point (time, foes, damage, boons),
// so the summary shows a mid-run state; the screen says so ("SHOWCASE: STAGED RUN HISTORY") and
// staged runs never touch the saved meta (best time, depth, lore).
// Keys: 1 intro  2 transition  3 death  4 summary  5 victory  H label. Moving or attacking takes
// the hero off the pilot. R / E / Esc on the summary work as in play.
// state().run is the run record; debug.run() has the rest (see flow.js).

import { scenes } from '../core/scenes.js';
import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { world } from '../core/world.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { giveBoon, progress } from '../progression/boons.js';
import { run } from './record.js';
import { flow } from './flow.js';
import { setPilot, activeRun } from './arena-scene.js';

const MODES = ['intro', 'transition', 'death', 'summary', 'victory'];
const LABEL = {
  intro: 'INTRO: DROP-IN AND RUN CARD, THEN LIVE',
  transition: 'TRANSITIONS: EVERY SEGMENT CHANGE (GOD MODE, ROOMS SKIPPED)',
  death: 'DEATH: ONE HEART LEFT, A PILOT FIGHTS UNTIL IT FALLS',
  summary: 'SUMMARY: STRAIGHT TO THE RUN SUMMARY',
  victory: 'VICTORY: THE WARDEN IS FELLED FOR YOU',
};

// a mid-run history to stage (the death is real; what came before it is not)
const STAGE = {
  death: { room: 2, ticks: 60 * 252 + 31, kills: 27, killsBy: { husk: 14, mite: 8, wisp: 5 }, dmg: 1786, hurts: 6, dodges: 11, shards: 58, boons: ['kindling', 'keen-edge', 'keen-edge', 'fleet-foot'], deepest: 4 },
  victory: { ticks: 60 * 611 + 17, kills: 64, killsBy: { husk: 28, mite: 17, wisp: 11, brute: 7 }, dmg: 5320, hurts: 11, dodges: 26, shards: 141, boons: ['chain-spark', 'storm-dash', 'kindling', 'keen-edge', 'bulwark', 'fleet-foot', 'keen-edge'], deepest: 9 },
};

export default function runFlowShowcase(params) {
  const seed = parseInt(params.get('seed') ?? '', 10);
  const SEED = Number.isFinite(seed) ? seed : 7;
  let at = params.get('at') ?? 'intro';
  if (!MODES.includes(at)) at = 'intro';
  let labels = params.get('hud') !== '0';
  let mode = at, t = 0, timer = null, pilotOn = false, offs = [];

  // ---- the pilot: keyboard-style input for the hero in an arena ----------------------------------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, stuck: 0, lastX: 0, lastZ: 0, side: 1,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
    tick() {
      const R = activeRun();
      if (!R || !pilotOn) return;
      const c = R.ctl;
      // a real key takes over
      const m = input.move();
      if (Math.hypot(m.x, m.z) > 0.2 || input.held('attack') || input.held('dash')) { goLive(); return; }
      let tx = 0, tz = -0.5, near = null, nd = 1e9;
      for (const e of world.enemies) {
        if (e.dead || !(e.hp > 0)) continue;
        const d = Math.hypot(e.x - c.x, e.z - c.z);
        if (d < nd) { nd = d; near = e; }
      }
      if (near) { tx = near.x; tz = near.z; }
      let dx = tx - c.x, dz = tz - c.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      // stuck on a pillar: slide sideways for a bit
      const moved = Math.hypot(c.x - this.lastX, c.z - this.lastZ);
      this.lastX = c.x; this.lastZ = c.z;
      this.stuck = moved < 0.01 && l > 1.2 ? this.stuck + 1 : Math.max(0, this.stuck - 1);
      if (this.stuck > 20) { const s = this.side; [dx, dz] = [-dz * s, dx * s]; if (this.stuck > 50) { this.stuck = 0; this.side = -this.side; } }
      this.n = (this.n ?? 0) + 1;
      if (near && nd < 1.25) {
        this.mv = { x: dx * 0.05, z: dz * 0.05 };   // face it
        if (this.n % 5 === 0) this.want.attack = true;
      } else this.mv = { x: dx, z: dz };
    },
  };
  function goLive() {
    if (!pilotOn) return;
    pilotOn = false;
    const R = activeRun();
    if (R) { R.ctl.source = input; R.combat._source = null; }
    setPilot(null);
  }

  // ---- staging ------------------------------------------------------------------------------------
  function stage(S, sceneName, then) {
    const off = events.on('scene:enter', (e) => {
      if (e.name !== sceneName) return;
      off();
      run.staged = true;
      run.seed = SEED;
      run.ticks = S.ticks; run.kills = S.kills; run.killsBy = { ...S.killsBy }; run.dmg = S.dmg; run.hurts = S.hurts; run.dodges = S.dodges;
      run.deepest = Math.max(run.deepest, S.deepest ?? 0);
      for (const id of S.boons) giveBoon(id, { quiet: true });
      progress.shards = S.shards; progress.shardsTotal = S.shards;
      run.shards = S.shards;
      then?.();
    });
    offs.push(off);
  }

  function clear() {
    offs.forEach((f) => f()); offs = [];
    timer = null; pilotOn = false; setPilot(null);
    world.god = false;
    debug.run('clock', { scale: 1, fixed: 0, manual: false });
  }

  function start(m) {
    clear();
    mode = m; t = 0;
    flow.reset();
    // the pilot never survives into a summary or a restart
    offs.push(events.on('scene:enter', (e) => { if (e.name === 'gameover' || e.name === 'victory') { pilotOn = false; setPilot(null); } }));
    if (m === 'intro') {
      scenes.goNow('run', { fresh: true, seed: SEED, room: 0 });
    } else if (m === 'transition') {
      world.god = true;
      scenes.goNow('run', { fresh: true, seed: SEED, room: 0 });
      // every ~3.5 s of real time, the next segment (through the router, so the wall plays)
      timer = { every: 3.4, next: 2.2, fn: () => { world.god = true; if (!flow.covered && ['run', 'gauntlet', 'boss'].includes(scenes.current)) { if (scenes.current === 'boss') start('transition'); else debug.run('next'); } } };
    } else if (m === 'death' || m === 'summary') {
      const S = STAGE.death;
      stage(S, 'run', () => { const h = world.hero; if (h) { h.hp = m === 'death' ? 1 : 2; run.hp = h.hp; } });
      setPilot(pilot);
      pilotOn = m === 'death';
      scenes.goNow('run', { fresh: true, seed: SEED, room: S.room });
      if (m === 'summary') {
        timer = { every: 99, next: 1.6, fn: () => {
          const R = activeRun();
          if (!R) return;
          // a brute steps out of the dark beside the runner, and the blow lands
          debug.spawn('brute', R.ctl.x + 0.9, R.ctl.z - 0.9);
          timer = { every: 99, next: t + 0.7, fn: () => {
            debug.run('die', 'brute');
            // straight on to the counted summary once the screen has fallen
            const off = events.on('scene:enter', (e) => { if (e.name === 'gameover') { off(); debug.run('skip'); } });
            offs.push(off);
          } };
        } };
      }
    } else if (m === 'victory') {
      const S = STAGE.victory;
      stage(S, 'boss');
      run.active = false;   // a fresh record for the staged run (the boss scene starts one)
      scenes.goNow('boss', { intro: false, hp: 3, maxHp: 5, carry: true });
      timer = { every: 99, next: 1.5, fn: () => { debug.boss?.('kill'); } };
    }
  }

  // ---- the overlay: label, keys, timers (drawn by flow after the scene UI) ----------------------------
  flow.onDraw = (g, dt) => {
    t += dt;
    if (timer && t >= timer.next) { timer.next = t + timer.every; timer.fn(); }
    pilot.tick();
    if (!scenes.paused) {
      for (let i = 0; i < MODES.length; i++) if (input.ui.key(`Digit${i + 1}`)) { start(MODES[i]); break; }
      if (input.ui.key('KeyH')) labels = !labels;
    }
    if (!labels) return;
    const W = display.width, H = display.height;
    const text = `SHOWCASE RUN-FLOW  •  ${LABEL[mode]}`;
    const keys = '1 INTRO  2 TRANSITIONS  3 DEATH  4 SUMMARY  5 VICTORY  H LABEL';
    const w = Math.max(textWidth(text), textWidth(keys)) + 10;
    const y = H - 52;
    if (scenes.current === 'gameover' || scenes.current === 'victory') return;   // the summary is the show
    g.fillStyle = css('ink'); g.fillRect(4, y, w, 21);
    drawText(g, text, 9, y + 2, 'gold');
    drawText(g, keys, 9, y + 11, 'mist');
    if (pilotOn) drawText(g, 'PILOT (MOVE TO TAKE OVER)', 9, y - 10, 'fog', { shadow: 'ink' });
  };

  return {
    enter() {
      start(at);
    },
    ui(g) {
      drawText(g, 'LOADING RUN-FLOW SHOWCASE', display.width / 2, display.height / 2, 'mist', { align: 'center' });
    },
    state() { return { showcase: { id: 'run-flow', mode } }; },
  };
}
