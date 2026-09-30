// ?showcase=gauntlet&seed=N : one gauntlet corridor, played start to finish.
//
// The hero drops in, the ceiling gives way, and a DEMO pilot runs the corridor with
// keyboard-style input only (8-way moves and dash presses): it reads each trap's rhythm,
// waits for its window, weaves lanes, dashes gaps and fire, and keeps ahead of the
// collapse. The gate slams behind it, the collapse smashes into the bars and stills, and
// it walks down the stair. Then the corridor runs again. Any key takes over (LIVE).
//
// T toggles the timing overlay: a bar over every trap showing its cycle (rest, warning,
// hot) with a playhead and a countdown; the collapse's speed, the speed it wants, the gap
// and the dawdle meter; a map strip of the whole corridor; and the pilot's planned path.
//
// Params:  &seed=N            the run seed (the contract's ?seed; default 1)
//          &corridor=1..4     which corridor of the run (default 2)
//          &beats=a,b,c       force the beats (ids from BEATS in corridor.js)
//          &auto=0            start LIVE (you play)
//          &overlay=1         start with the timing overlay on
//          &hold=1            the collapse waits for debug.corridor('start') (captures)
//          &zoom=1..3 (default 1, game scale)   &slow=<s>   &hud=0
// Keys:    WASD move, K/Space dash, J attack (LIVE)
//          T overlay, B demo, R restart, N next corridor, Z zoom, L slow-mo, H hud, P/Esc pause
// state().showcase = { id, mode, corridor: info(), hero, pilot, overlay }

import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { look } from '../render/look.js';
import { vfx } from '../vfx/vfx.js';
import '../combat/sfx.js';
import { createCorridorRun, generateCorridor, CORRIDOR_COUNT, BEATS } from './corridor.js';
import { SPIKE, JET, CRUMBLE } from './traps.js';

const SLOWS = [1, 0.5, 0.25, 0.1];

// __GR.debug.gauntletPilot(): the demo pilot's reasoning at this tick (showcase only)
let pilotProbe = null;
if (!('gauntletPilot' in debug)) debug.add('gauntletPilot', () => (pilotProbe ? pilotProbe() : { ok: false, error: 'not in ?showcase=gauntlet' }));
const PHASE_COL = { rest: 'slate', warn: 'gold', hot: 'red', cool: 'plum' };

export default function gauntletShowcase(params) {
  const seed = window.__GR?.seed ?? 1;
  let hud = params.get('hud') !== '0';
  let zoom = Math.max(1, Math.min(3, parseInt(params.get('zoom') ?? '1', 10) || 1));
  const slow = parseFloat(params.get('slow') ?? '1') || 1;
  let slowIdx = Math.max(0, SLOWS.indexOf(slow));
  let index = Math.max(0, Math.min(CORRIDOR_COUNT - 1, (parseInt(params.get('corridor') ?? '2', 10) || 2) - 1));
  const beats = params.get('beats') ? params.get('beats').split(',').filter((b) => BEATS[b]) : null;
  let auto = params.get('auto') !== '0';
  let overlay = params.get('overlay') === '1';
  const hold = params.get('hold') === '1';

  let root, run = null, t = 0, wipe = null, offs = [], runs = 0, doneT = -1;
  const results = [];   // one line per finished run: what the demo (or you) did
  const status = { text: '', until: 0 };
  const say = (s) => { status.text = s; status.until = loop.realTime + 1.3; };

  // ---- the demo pilot ---------------------------------------------------------------------
  // Plans are "wait w ticks (moving only across lanes), then run right, with an optional dash
  // at a chosen x", simulated tick by tick against every trap's pure timing, the holes and the
  // collapse's predicted edge. The cheapest safe plan wins; it re-plans every few ticks.
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, label: '', plan: null, planT: 0, path: [], lapses: 0,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
    read: 0, readDone: new Set(),
    reset() { this.mv = { x: 0, z: 0 }; this.want = {}; this.plan = null; this.planT = 0; this.path = []; this.label = ''; this.read = 0; this.readDone = new Set(); },
  };
  const LANES = [-2.2, -0.75, 0.75, 2.2];
  const RUN = 4.2 / 60;
  function simulate(cor, c, w, lane, dashX) {
    const horizon = w + 150;
    const goal = Math.min(c.x + 7.5, cor.L.gateX + 0.5);
    const t0 = cor.t, col = cor.collapse;
    const fs = col.active ? Math.max(col.speed, col.want) / 60 + 0.004 : 0;
    const f0 = col.active ? col.front : -Infinity;
    const colStart = col.active ? 0 : Math.max(0, 75 - cor.st);
    let x = c.x, z = c.z, v = Math.max(0, c.vx / 60);
    let dashT = -1, dashed = false, cool = c.dashReady ? 0 : 18;
    const path = [];
    for (let k = 1; k <= horizon; k++) {
      const tk = t0 + k;
      const dz = lane - z;
      const lat = Math.abs(dz) > 0.04;
      if (cool > 0) cool--;
      if (dashT >= 0) {
        dashT++;
        const f = (q) => 2.5 * (1 - (1 - Math.min(11, q) / 11) ** 2);
        x += f(dashT) - f(dashT - 1);
        if (dashT >= 11) { dashT = -1; v = RUN; cool = 18; }
      } else if (k <= w) {
        v = 0;
        if (lat) z += Math.sign(dz) * Math.min(Math.abs(dz), RUN);
      } else {
        if (dashX !== null && !dashed && x >= dashX && cool <= 0) { dashT = 0; dashed = true; v = RUN; continue; }
        v = Math.min(RUN, v + 0.028);
        if (lat) { const s = v * Math.SQRT1_2; x += s; z += Math.sign(dz) * Math.min(Math.abs(dz), s); } else x += v;
      }
      if (k % 3 === 0) path.push([x, z]);
      const dashing = dashT >= 0;
      const ifr = dashing && dashT < 9;
      if (!ifr && cor.hazard(x, z, 0.36, tk)) return { ok: false, k, path };
      if (!dashing && cor.pitAt(x, z, tk)) return { ok: false, k, path };
      if (!dashing && k <= w && cor.crumbly(x)) return { ok: false, k, path };
      const fk = col.active ? f0 + fs * k : (k > colStart ? cor.collapse.front + (k - colStart) * 0.03 : -Infinity);
      if (x - 0.3 < fk + 0.55) return { ok: false, k, path };
      if (x > goal && k > w) return { ok: true, k, path };
    }
    return { ok: false, k: horizon, path };
  }
  function planFor(cor, c) {
    // obstacle entries ahead: where a dash could start
    const dashXs = [null];
    for (const tr of cor.trapsIn(c.x - 0.5, c.x + 7)) {
      if (tr.kind === 'crumble') {
        for (const col of tr.cols) if (col.state !== 'solid' && col.state !== 'shake' && col.x > c.x - 0.2) { dashXs.push(col.x - 0.45); break; }
      } else if (tr.x0 > c.x) dashXs.push(tr.x0 - 0.75);
    }
    let best = null, bestFail = null;
    const lanes = [...LANES].sort((a, b) => Math.abs(a - c.z) - Math.abs(b - c.z));
    for (let w = 0; w <= 72; w += 4) {
      if (best && w >= best.cost) break;
      for (const lane of lanes) for (const dx of dashXs) {
        const r = simulate(cor, c, w, lane, dx);
        const cost = w + Math.abs(lane - c.z) * 3 + (dx !== null ? 6 : 0);
        if (r.ok) { if (!best || cost < best.cost) best = { w, lane, dashX: dx, cost, path: r.path }; }
        else if (!bestFail || r.k > bestFail.k) bestFail = { w, lane, dashX: dx, k: r.k, path: r.path, fail: true };
      }
    }
    return best ?? bestFail;
  }
  function pilotStep() {
    pilot.mv = { x: 0, z: 0 };
    if (!run) return;
    const cor = run.cor, c = run.ctl;
    if (run.health.dead || run.anim.state === 'spawn' || cor.fall) { pilot.label = ''; return; }
    if (cor.state === 'safe' || cor.state === 'exited') {
      // walk to the stair and down it
      pilot.label = cor.st < 100 ? 'SAFE' : 'EXIT';
      if (cor.st < 100) return;
      const ex = cor.L.exitX;
      if (Math.abs(c.x - ex) > 0.15 && c.z > -cor.D / 2 + 0.3) pilot.mv = { x: Math.sign(ex - c.x) * (Math.abs(ex - c.x) > 0.5 ? 1 : 0.5), z: c.z > -1.5 ? -0.5 : 0 };
      else pilot.mv = { x: 0, z: -1 };
      return;
    }
    // like a player seeing a beat for the first time, it stops for a moment at the start of
    // each one to read the rhythm, unless the collapse is already on its heels
    if (pilot.read > 0) {
      pilot.read--;
      pilot.label = 'READ';
      if (cor.collapse.active && cor.collapse.gap < 3.2) pilot.read = 0;
      else return;
    }
    for (const b of cor.L.beats) {
      if (!pilot.readDone.has(b.x0) && c.x > b.x0 - 1.4 && c.x < b.x0) {
        pilot.readDone.add(b.x0);
        if (!cor.hazard(c.x, c.z, 0.4, cor.t + 1)) { pilot.read = 30 + ((b.x0 * 7) % 20); pilot.plan = null; return; }
      }
    }
    if (c.x > cor.L.gateX - 1.2) { pilot.mv = { x: 1, z: 0 }; pilot.label = 'THROUGH'; return; }
    if (!pilot.plan || --pilot.planT <= 0) {
      pilot.plan = planFor(cor, c);
      pilot.planT = 3;
      pilot.path = pilot.plan?.path ?? [];
    } else if (pilot.plan.w > 0) pilot.plan.w--;
    const P = pilot.plan;
    if (!P) return;
    const dz = P.lane - c.z;
    const lat = Math.abs(dz) > 0.08 ? Math.sign(dz) : 0;
    if (P.w > 0) {
      pilot.mv = { x: 0, z: lat };
      pilot.label = P.fail ? 'PUSH ON' : 'WAIT';
      if (P.dashX !== null && P.fail && c.dashReady) { pilot.mv = { x: 1, z: 0 }; pilot.want.dash = true; pilot.label = 'DASH!'; }
      return;
    }
    pilot.mv = lat ? { x: Math.SQRT1_2, z: lat * Math.SQRT1_2 } : { x: 1, z: 0 };
    pilot.label = lat ? 'LANE' : 'RUN';
    if (P.dashX !== null && c.x >= P.dashX && c.dashReady) { pilot.want.dash = true; pilot.mv = { x: 1, z: 0 }; pilot.label = 'DASH'; P.dashX = null; }
    if (P.fail) pilot.label = 'PUSH ON';
  }
  function goLive() { if (!auto || !run) return; auto = false; run.ctl.source = input; world.god = false; say('LIVE'); }
  function goDemo() { if (!run) return; auto = true; run.ctl.source = pilot; world.god = true; pilot.reset(); say('DEMO'); }

  // ---- building ---------------------------------------------------------------------------
  function build() {
    if (run) { run.dispose(); run = null; }
    vfx.clear();
    world.enemies = [];
    const layout = generateCorridor(index, seed, { beats });
    run = createCorridorRun(root, { layout, source: auto ? pilot : input, autoStart: !hold });
    world.god = auto;
    pilot.reset();
    display.setZoom(zoom);
    t = 0; doneT = -1; runs++;
  }
  function record(end) {
    const c = run.cor;
    results.push({ corridor: index + 1, beats: c.L.beats.map((b) => b.id).join(','), end, mode: auto ? 'demo' : 'live', time: +(c.stats.time / 60).toFixed(1), hurts: c.stats.hurts, falls: c.stats.falls, caught: c.stats.caught, dodges: c.stats.dodges, minGap: +c.minGap.toFixed(2) });
    if (results.length > 20) results.shift();
  }
  function transition(fn) { if (!wipe) wipe = { t: 0, then: fn }; }

  // ---- overlay drawing ----------------------------------------------------------------------
  function drawOverlay(g) {
    const W = display.width, H = display.height;
    const cor = run.cor, D = cor.D, tNow = cor.t;
    // per-trap timing bars, pinned above each trap on the rock face
    for (const tr of cor.traps) {
      const cx = (tr.x0 + tr.x1) / 2;
      const p = display.worldToScreen(cx, 4.2, -D / 2);
      if (p.x < -30 || p.x > W + 30) continue;
      if (tr.kind === 'crumble') {
        const shaking = tr.cols.filter((c) => c.state === 'shake');
        drawText(g, 'CRUMBLE', p.x, p.y - 9, 'fog', { align: 'center', outline: 'ink' });
        const txt = shaking.length ? `DROPS ${((shaking[0].fallAt - tNow) / 60).toFixed(1)}S` : `HOLDS ${(CRUMBLE.fall / 60).toFixed(1)}S`;
        drawText(g, txt, p.x, p.y + 1, shaking.length ? 'red' : 'slate', { align: 'center', outline: 'ink' });
        continue;
      }
      const T = tr.timing();
      const bw = 40, bx = Math.round(p.x - bw / 2), by = p.y;
      g.fillStyle = css('ink'); g.fillRect(bx - 1, by - 1, bw + 2, 7);
      for (const [a, b, s] of T.segs) {
        const x0 = bx + Math.round(a / T.period * bw), x1 = bx + Math.round(b / T.period * bw);
        g.fillStyle = css(PHASE_COL[s]); g.fillRect(x0, by, Math.max(1, x1 - x0), 5);
      }
      const u = tr.u(tNow);
      const px = bx + Math.round(u / T.period * bw);
      g.fillStyle = css('white'); g.fillRect(px, by - 2, 1, 9);
      const ph = tr.phase(tNow);
      const name = { spikes: 'SPIKES', blade: 'BLADE', jet: 'FIRE' }[tr.kind];
      drawText(g, `${name} ${(T.period / 60).toFixed(1)}S`, p.x, by - 10, 'fog', { align: 'center', outline: 'ink' });
      const until = tr.untilHot(tNow);
      drawText(g, ph === 'hot' ? 'HOT' : `IN ${(until / 60).toFixed(1)}S`, p.x, by + 8, ph === 'hot' ? 'red' : ph === 'warn' ? 'gold' : 'leaf', { align: 'center', outline: 'ink' });
    }
    // the pilot's plan: where it means to be, every 3 ticks
    if (auto && pilot.path.length) {
      g.fillStyle = css(pilot.plan?.fail ? 'red' : 'sky');
      for (const [x, z] of pilot.path) { const s = display.worldToScreen(x, 0.02, z); g.fillRect(s.x - 1, s.y - 1, 2, 2); }
      if (pilot.plan && pilot.plan.dashX !== null) { const s = display.worldToScreen(pilot.plan.dashX, 0.02, pilot.plan.lane); g.fillStyle = css('cyan'); g.fillRect(s.x - 1, s.y - 4, 2, 8); }
    }
    // the collapse panel
    const col = cor.collapse;
    const x0 = 6, y0 = 40;
    g.fillStyle = css('ink'); g.fillRect(x0 - 2, y0 - 2, 176, 56);
    g.fillStyle = css('ember'); g.fillRect(x0 - 2, y0 - 2, 2, 56);
    drawText(g, 'COLLAPSE', x0 + 3, y0, 'ember');
    drawText(g, `SPEED ${col.speed.toFixed(2)}  WANTS ${col.want.toFixed(2)}`, x0 + 3, y0 + 10, 'bone');
    drawText(g, `GAP ${col.active ? Math.max(0, col.gap).toFixed(1) : '-'}`, x0 + 3, y0 + 20, col.gap < 3 ? 'red' : 'fog');
    drawText(g, 'DAWDLE', x0 + 3, y0 + 30, 'fog');
    g.fillStyle = css('shadow'); g.fillRect(x0 + 40, y0 + 31, 70, 5);
    g.fillStyle = css(col.dawdle > 0.5 ? 'red' : 'flame'); g.fillRect(x0 + 40, y0 + 31, Math.round(70 * col.dawdle), 5);
    drawText(g, `HURTS ${cor.stats.hurts}  FALLS ${cor.stats.falls}  CAUGHT ${cor.stats.caught}  DODGES ${cor.stats.dodges}`, x0 + 3, y0 + 40, 'slate');
    // map strip: the whole corridor, beats, hero, collapse
    const mx = 130, mw = W - mx - 8, my = H - 26;
    const sx = (x) => mx + Math.round((x + 1) / (cor.L.len + cor.L.safeLen + 1) * mw);
    g.fillStyle = css('ink'); g.fillRect(mx - 1, my - 1, mw + 2, 7);
    g.fillStyle = css('dusk'); g.fillRect(mx, my, mw, 5);
    for (const b of cor.L.beats) { g.fillStyle = css('violet'); g.fillRect(sx(b.x0), my, sx(b.x1) - sx(b.x0), 5); }
    g.fillStyle = css('gold'); g.fillRect(sx(cor.L.gateX), my - 2, 1, 9);
    if (col.active) { g.fillStyle = css('ember'); g.fillRect(mx, my, Math.max(0, sx(col.front) - mx), 5); }
    g.fillStyle = css('sky'); g.fillRect(sx(run.ctl.x) - 1, my - 2, 3, 9);
    for (const b of cor.L.beats) if (textWidth(b.name) < sx(b.x1) - sx(b.x0) + 30) drawText(g, b.name, (sx(b.x0) + sx(b.x1)) / 2, my - 9, 'slate', { align: 'center' });
  }

  // =====================================================================================
  return {
    pausable: true,
    enter(_d, r) {
      root = r;
      world.reset();
      loop.setTimeScale(SLOWS.includes(slow) ? SLOWS[slowIdx] : slow);
      const on = (n, f) => offs.push(events.on(n, f));
      on('input:press', (e) => { if (auto && e.action !== 'pause' && !['KeyB', 'KeyT', 'KeyZ', 'KeyL', 'KeyH', 'KeyR', 'KeyN'].includes(e.code)) goLive(); });
      on('gauntlet:exit', () => { doneT = 0; record('exit'); });
      // the pilot's reasoning, for checking beats: every lane x dash option at wait 0
      pilotProbe = () => {
        if (!run) return null;
        const c = run.ctl, cor = run.cor;
        const out = [];
        const dashXs = [null];
        for (const tr of cor.trapsIn(c.x - 0.5, c.x + 7)) {
          if (tr.kind === 'crumble') { for (const col of tr.cols) if (col.state !== 'solid' && col.state !== 'shake' && col.x > c.x - 0.2) { dashXs.push(col.x - 0.45); break; } }
          else if (tr.x0 > c.x) dashXs.push(tr.x0 - 0.75);
        }
        for (const lane of LANES) for (const dx of dashXs) { const r = simulate(cor, c, 0, lane, dx); out.push({ lane, dx, ok: r.ok, k: r.k, end: r.path[r.path.length - 1] }); }
        return { x: c.x, z: c.z, plan: pilot.plan && { ...pilot.plan, path: undefined }, out };
      };
      debug.handle('goto', (i) => { index = Math.max(0, Math.min(CORRIDOR_COUNT - 1, i | 0)); build(); return { ok: true, corridor: index + 1 }; });
      build();
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      run?.dispose(); run = null;
      pilotProbe = null;
      world.god = false;
      loop.setTimeScale(1);
      look.mood('crypt');
      // the pilot's reasoning, for checking beats: every lane x dash option at wait 0
      pilotProbe = () => {
        if (!run) return null;
        const c = run.ctl, cor = run.cor;
        const out = [];
        const dashXs = [null];
        for (const tr of cor.trapsIn(c.x - 0.5, c.x + 7)) {
          if (tr.kind === 'crumble') { for (const col of tr.cols) if (col.state !== 'solid' && col.state !== 'shake' && col.x > c.x - 0.2) { dashXs.push(col.x - 0.45); break; } }
          else if (tr.x0 > c.x) dashXs.push(tr.x0 - 0.75);
        }
        for (const lane of LANES) for (const dx of dashXs) { const r = simulate(cor, c, 0, lane, dx); out.push({ lane, dx, ok: r.ok, k: r.k, end: r.path[r.path.length - 1] }); }
        return { x: c.x, z: c.z, plan: pilot.plan && { ...pilot.plan, path: undefined }, out };
      };
      debug.handle('goto', () => ({ ok: false, error: 'no rooms in this scene' }));
    },
    frame() {
      const k = input.ui.key;
      if (k('KeyT')) { overlay = !overlay; say(overlay ? 'TIMING OVERLAY' : 'OVERLAY OFF'); }
      if (k('KeyZ')) { zoom = zoom >= 3 ? 1 : zoom + 1; display.setZoom(zoom); say(`ZOOM ${zoom}X`); }
      if (k('KeyL')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) hud = !hud;
      if (k('KeyB')) goDemo();
      if (k('KeyR')) transition(() => build());
      if (k('KeyN')) transition(() => { index = (index + 1) % CORRIDOR_COUNT; build(); });
    },
    tick() {
      t++;
      if (wipe) { wipe.t++; if (wipe.t === 9) wipe.then(); if (wipe.t >= 18) wipe = null; }
      if (!run) return;
      if (auto) pilotStep();
      run.tick();
      if (run.health.dead && doneT < 0) { doneT = 0; record('dead'); }
      if (doneT >= 0 && ++doneT === 60) transition(() => build());
    },
    render(alpha) { run?.render(alpha); },
    ui(g) {
      const W = display.width, H = display.height;
      if (run) {
        if (overlay) drawOverlay(g);
        run.ui(g);
        if (hud) {
          const cor = run.cor;
          drawText(g, `GAUNTLET  CORRIDOR ${index + 1}/${CORRIDOR_COUNT}  SEED ${seed}`, 6, 6, 'mist', { shadow: 'ink' });
          drawText(g, auto ? 'DEMO  (HERO CANNOT DIE; ANY KEY: TAKE OVER)' : 'LIVE  (B: DEMO)', 6, 16, auto ? 'slate' : 'leaf', { shadow: 'ink' });
          if (auto && pilot.label) drawText(g, pilot.label, 6, 26, pilot.label.startsWith('DASH') ? 'sky' : pilot.label === 'WAIT' ? 'gold' : pilot.label === 'PUSH ON' ? 'rose' : 'fog', { shadow: 'ink' });
          const hp = run.health.hp, mx = run.health.maxHp;
          for (let i = 0; i < mx; i++) {
            const x = W - 6 - (mx - i) * 10, y = 6;
            g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, 9, 9);
            g.fillStyle = css(i < hp ? 'red' : 'shadow'); g.fillRect(x, y, 7, 7);
          }
          drawText(g, `${cor.state.toUpperCase()}  ${(cor.stats.time / 60).toFixed(1)}S`, W - 6, 18, 'fog', { align: 'right', shadow: 'ink' });
          const help = 'WASD MOVE  K DASH  T TIMING  B DEMO  R RESTART  N NEXT  Z ZOOM  L SLOW  H HUD';
          const w = textWidth(help) + 8;
          g.fillStyle = css('ink'); g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
          drawText(g, help, W / 2, H - 10, 'slate', { align: 'center' });
        }
      }
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, H - 40, 'gold', { align: 'center', outline: 'ink' });
      if (wipe) {
        const k = wipe.t < 9 ? wipe.t / 8 : (17 - wipe.t) / 8;
        const bw = 16, cover = Math.round(Math.max(0, Math.min(1, k)) * bw);
        g.fillStyle = css('ink');
        for (let x = 0; x < W; x += bw) g.fillRect(x, 0, cover, H);
      }
    },
    state() {
      return {
        showcase: {
          id: 'gauntlet', mode: auto ? 'demo' : 'live', corridor: run?.cor.info() ?? null, overlay, zoom: display.zoom, runs, results,
          hero: run ? { x: +run.ctl.x.toFixed(2), z: +run.ctl.z.toFixed(2), hp: run.health.hp, state: run.ctl.state } : null,
          pilot: auto ? { label: pilot.label, plan: pilot.plan ? { w: pilot.plan.w, lane: pilot.plan.lane, dashX: pilot.plan.dashX, fail: !!pilot.plan.fail } : null } : null,
        },
      };
    },
  };
}
void SPIKE; void JET;
