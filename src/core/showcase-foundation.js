// ?showcase=foundation : the engine on a turntable.
//
// Centre: a test voxel model on a rotating plate (greedy-meshed, baked dithered AO, one draw
// call), on a torch-lit stage. Left: input echo (every action through the rebinding table,
// held state, press flash, the 120 ms buffer draining, move vector, aim mode, event log with
// measured event-to-frame latency). Right: fps, frame-time graph, sim tick, steps per frame,
// interpolation alpha, time scale and pause/hitstop state, and the model's mesh stats.
//
// Keys: 1-3 model, E next model, J hop (buffered: press just before landing), K spin (dash),
//       A/D turn, G show greedy quads, Z toggle game scale, T slow-motion, H hitstop test,
//       P / Esc pause, . single sim step while paused.
// Params: &model=shrine|runner|ao  &zoom=1..4  &spin=0 (stop the turntable)  &hud=0 (no panels)

import * as THREE from 'three';
import { display } from './display.js';
import { input, BUFFER_TICKS } from './input.js';
import { loop, Interp, DT } from './loop.js';
import { events } from './events.js';
import { feedback } from './feedback.js';
import { scenes } from './scenes.js';
import { rng } from './rng.js';
import { world } from './world.js';
import { buildStage } from './stage.js';
import { drawText, textWidth, LINE_H } from './pixelfont.js';
import { css, hex } from '../render/palette.js';
import { voxelMesh, getModel, VOXEL } from '../render/voxel/index.js';
import '../render/voxel/testmodels.js';

const MODELS = [
  { id: 'shrine', name: 'test.shrine', label: 'CRYPT SHRINE', form: 'VOXELGRID CODE', zoom: 2 },
  { id: 'runner', name: 'test.runner', label: 'HOODED RUNNER', form: 'TEXT LAYERS', zoom: 3 },
  { id: 'ao', name: 'test.ao', label: 'AO TEST BLOCK', form: 'VOXELGRID CODE', zoom: 3 },
];
const SCALES = [1, 0.5, 0.25, 0.1];
const PLATE_TOP = 3 * VOXEL;

/** Exposed faces before greedy merging (for the "faces -> quads" stat). */
function naiveFaces(grid) {
  const [sx, sy, sz] = grid.size;
  let n = 0;
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    if (!grid.get(x, y, z)) continue;
    n += !grid.get(x + 1, y, z) + !grid.get(x - 1, y, z) + !grid.get(x, y + 1, z) + !grid.get(x, y - 1, z) + !grid.get(x, y, z + 1) + !grid.get(x, y, z - 1);
  }
  return n;
}

export default function foundationShowcase(params) {
  const hud = params.get('hud') !== '0';
  let autoSpin = params.get('spin') === '0' ? 0 : 0.55;
  let modelIndex = Math.max(0, MODELS.findIndex((m) => m.id === params.get('model')));
  const zoomParam = parseInt(params.get('zoom') ?? '', 10);
  let gameScale = zoomParam === 1;

  let root, stage, pivot, model, wire, plate, showWire = false;
  let st;          // Interp: spin angle, hop height, squash
  let spinVel = 0, hopV = 0, grounded = true, squashT = 0, flashT = 0, scaleIndex = 0;
  const log = [];  // {tick, text, color, t, lat}
  const flashes = {}; // action -> render frame of last press
  const offPress = [];
  const faceCache = new Map();
  const wireMat = new THREE.MeshBasicMaterial({ color: hex('gold'), wireframe: true });

  function pushLog(text, color, t) {
    log.push({ tick: loop.tick, text, color, t, lat: null });
    if (log.length > 7) log.shift();
  }

  function setModel(i) {
    modelIndex = (i + MODELS.length) % MODELS.length;
    const M = MODELS[modelIndex];
    if (model) { pivot.remove(model); model.material.dispose(); }
    model = voxelMesh(M.name, { ownMaterial: true });
    model.position.y = PLATE_TOP;
    pivot.add(model);
    wire = new THREE.Mesh(model.geometry, wireMat);
    wire.visible = showWire;
    model.add(wire);
    if (!faceCache.has(M.name)) faceCache.set(M.name, naiveFaces(getModel(M.name).grid));
    applyZoom();
    squashT = 8; // pop in
  }

  function applyZoom() {
    const M = MODELS[modelIndex];
    const z = gameScale ? 1 : (zoomParam > 0 ? zoomParam : M.zoom);
    display.setZoom(z);
    const h = getModel(M.name).geometry.boundingBox.max.y;
    display.setCameraTarget(0, PLATE_TOP + h * 0.45, 0);
  }

  return {
    pausable: true,

    enter(_data, r) {
      root = r;
      world.reset();
      stage = buildStage(root, { torches: [[-2.3, -1.3], [2.3, -1.3]], rng: rng.fork('showcase-stage'), dustBox: [5, 3, 4] });
      root.add(voxelMesh('test.plinth'));
      pivot = new THREE.Group();
      root.add(pivot);
      plate = voxelMesh('test.plate');
      plate.position.y = 2 * VOXEL;
      pivot.add(plate);
      st = new Interp({ a: -0.6, hop: 0, sq: 1 }).angle('a');
      setModel(modelIndex);
      squashT = 0;
      offPress.push(events.on('input:press', (e) => {
        flashes[e.action] = loop.frameCount;
        const code = e.code.startsWith('@') ? 'SCRIPT' : e.code.replace(/^Key/, '').replace(/^Arrow/, '').toUpperCase();
        pushLog(`${e.action.toUpperCase()} ${code}`, 'bone', e.t);
      }));
    },

    exit() { offPress.forEach((f) => f()); offPress.length = 0; },

    frame() {
      const k = input.ui.key;
      if (k('Digit1')) setModel(0);
      if (k('Digit2')) setModel(1);
      if (k('Digit3')) setModel(2);
      if (k('KeyG')) { showWire = !showWire; wire.visible = showWire; }
      if (k('KeyZ')) { gameScale = !gameScale; applyZoom(); }
      if (k('KeyT')) { scaleIndex = (scaleIndex + 1) % SCALES.length; loop.setTimeScale(SCALES[scaleIndex]); }
      if (k('KeyH')) {
        loop.hitstop(90);
        feedback.shake(3, 180);
        feedback.flash('white', 70, 0.25);
        flashT = 6;
        pushLog('HITSTOP 90MS', 'gold', null);
      }
      if (k('Period') && loop.paused) loop.step(1);
    },

    tick() {
      st.snap();
      stage.tick();
      const c = st.cur;
      const m = input.move();
      // turntable: auto spin, A/D turn, K (dash) spin burst
      if (input.consume('dash')) { spinVel += 9; feedback.kick(1, 0, 2); pushLog('DASH→SPIN', 'cyan', null); }
      spinVel *= 0.93;
      c.a += (autoSpin + m.x * 2.2 + spinVel) * DT;
      // J (attack) hop: only from the ground, so a press just before landing waits in the buffer
      if (grounded && input.buffered('attack')) {
        const age = input.bufferAge('attack');
        input.consume('attack');
        hopV = 3.4; grounded = false; squashT = 0;
        if (age > 0) pushLog(`BUFFER→HOP +${age}T`, 'leaf', null);
      }
      if (input.consume('interact')) setModel(modelIndex + 1);
      if (!grounded) {
        hopV -= 16 * DT;
        c.hop += hopV * DT;
        if (c.hop <= 0) { c.hop = 0; grounded = true; squashT = 8; feedback.shake(1, 80); }
      }
      if (squashT > 0) squashT--;
      if (flashT > 0) flashT--;
      c.sq = !grounded ? 1 + Math.min(0.14, Math.abs(hopV) * 0.04) : squashT > 0 ? 1 - 0.16 * Math.sin((squashT / 8) * Math.PI) : 1;
    },

    render(alpha) {
      const s = st.at(alpha);
      pivot.rotation.y = s.a;
      model.position.y = PLATE_TOP + s.hop;
      model.scale.set(1 / Math.sqrt(s.sq), s.sq, 1 / Math.sqrt(s.sq));
      model.material.userData.flash.value = flashT > 0 ? 0.85 : 0;
      stage.render(alpha);
    },

    ui(g) {
      const now = performance.now();
      for (const e of log) if (e.lat === null && e.t !== null) e.lat = Math.max(0, now - e.t);
      const W = display.width, H = display.height;
      const M = MODELS[modelIndex];
      drawText(g, 'ENGINE FOUNDATION', W / 2, 6, 'bone', { align: 'center', scale: 2, outline: 'ink' });
      drawText(g, `${M.label}  (${M.form})`, W / 2, 24, 'fog', { align: 'center', shadow: 'ink' });
      if (!hud) return;
      inputPanel(g, 6, 38);
      enginePanel(g, W - 156, 38, M);
      // help bar
      const help = '1-3 MODEL  J HOP  K SPIN  A/D TURN  G QUADS  Z SCALE  T SLOW-MO  H HITSTOP  P PAUSE  . STEP';
      g.fillStyle = css('ink');
      g.fillRect(0, H - 13, W, 13);
      drawText(g, help, W / 2, H - 10, 'mist', { align: 'center' });
    },

    state() {
      return { showcase: { id: 'foundation', model: MODELS[modelIndex].id, zoom: display.zoom, quads: showWire,
        angle: +st.cur.a.toFixed(4), hop: +st.cur.hop.toFixed(4), grounded } };
    },
  };

  // ---- panels --------------------------------------------------------------------------

  function panel(g, x, y, w, h, title, right) {
    g.fillStyle = 'rgba(11,10,18,0.78)';
    g.fillRect(x, y, w, h);
    g.fillStyle = css('violet');
    g.fillRect(x, y, w, 1);
    drawText(g, title, x + 5, y + 4, 'gold');
    if (right) drawText(g, right, x + w - 5, y + 4, 'mist', { align: 'right' });
  }

  function cap(g, x, y, label, action, w = 13) {
    const held = input.held(action);
    const fresh = loop.frameCount - (flashes[action] ?? -99) < 5;
    g.fillStyle = css(fresh ? 'white' : held ? 'gold' : 'dusk');
    g.fillRect(x, y + 1, w, 11);
    g.fillStyle = css(held || fresh ? 'woodLight' : 'shadow');
    g.fillRect(x, y + 12, w, 2);
    drawText(g, label, x + w / 2 + 1, y + 3 + (held ? 1 : 0), held || fresh ? 'ink' : 'frost', { align: 'center' });
  }

  function firstKey(action) {
    const c = input.bindings[action].find((k) => !k.startsWith('Mouse') && !k.startsWith('Pad')) || '?';
    return c.replace(/^Key/, '').replace(/^Arrow/, '').replace('Escape', 'ESC').replace('Space', 'SPC');
  }

  function inputPanel(g, x, y) {
    const w = 150;
    panel(g, x, y, w, 262, 'INPUT ECHO', input.device.toUpperCase());
    let cy = y + 16;
    // WASD cluster
    cap(g, x + 22, cy, firstKey('up'), 'up');
    cap(g, x + 7, cy + 15, firstKey('left'), 'left');
    cap(g, x + 22, cy + 15, firstKey('down'), 'down');
    cap(g, x + 37, cy + 15, firstKey('right'), 'right');
    // move vector dial
    const cx = x + 80, cyy = cy + 14, R = 13;
    g.fillStyle = css('shadow');
    for (let dy = -R; dy <= R; dy++) {
      const dx = Math.floor(Math.sqrt(R * R - dy * dy));
      g.fillRect(cx - dx, cyy + dy, dx * 2 + 1, 1);
    }
    g.fillStyle = css('dusk');
    g.fillRect(cx - R, cyy, R * 2 + 1, 1);
    g.fillRect(cx, cyy - R, 1, R * 2 + 1);
    const mv = input.move();
    const px = Math.round(cx + mv.x * (R - 2)), py = Math.round(cyy + mv.z * (R - 2));
    g.fillStyle = css(mv.x || mv.z ? 'gold' : 'mist');
    g.fillRect(px - 1, py - 1, 3, 3);
    drawText(g, `X ${fmt(mv.x)}`, x + 100, cy + 5, 'frost');
    drawText(g, `Z ${fmt(mv.z)}`, x + 100, cy + 16, 'frost');
    cy += 36;

    // action rows: cap, bindings, buffer meter
    for (const a of ['attack', 'dash', 'interact', 'pause']) {
      cap(g, x + 6, cy, firstKey(a), a, 23);
      drawText(g, a.toUpperCase(), x + 34, cy + 3, input.held(a) ? 'gold' : 'bone');
      if (a !== 'pause') {
        // buffer: BUFFER_TICKS segments draining; filled while a press waits unconsumed
        const age = input.bufferAge(a);
        for (let i = 0; i < BUFFER_TICKS; i++) {
          const on = age >= 0 && i < BUFFER_TICKS - age;
          g.fillStyle = css(on ? 'cyan' : 'dusk');
          g.fillRect(x + 98 + i * 6, cy + 4, 5, 5);
        }
      }
      cy += 16;
    }
    drawText(g, 'BUFFER 7 TICKS = 117 MS', x + 6, cy, 'mist');
    cy += LINE_H + 4;

    // aim / devices
    const mouseOn = input.mouseActive();
    drawText(g, 'AIM', x + 6, cy, 'fog');
    drawText(g, mouseOn ? 'MOUSE CURSOR' : 'FACING (MOUSE IDLE 2S)', x + 30, cy, mouseOn ? 'cyan' : 'bone');
    cy += LINE_H;
    const lmb = input.codeDown('Mouse0') ? 'L' : '-', rmb = input.codeDown('Mouse2') ? 'R' : '-';
    drawText(g, 'MOUSE', x + 6, cy, 'fog');
    drawText(g, `${Math.round(input.mouse.x)},${Math.round(input.mouse.y)} ${lmb}${rmb}`, x + 42, cy, 'bone');
    cy += LINE_H;
    drawText(g, 'PAD', x + 6, cy, 'fog');
    drawText(g, input.gamepadConnected ? 'CONNECTED' : 'NONE', x + 30, cy, input.gamepadConnected ? 'leaf' : 'mist');
    cy += LINE_H + 5;

    // event log
    g.fillStyle = css('violet');
    g.fillRect(x + 5, cy - 3, w - 10, 1);
    drawText(g, 'TICK', x + 6, cy, 'mist');
    drawText(g, 'EVENT', x + 40, cy, 'mist');
    drawText(g, 'TO FRAME', x + w - 5, cy, 'mist', { align: 'right' });
    cy += LINE_H + 1;
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      const age = log.length - 1 - i;
      const col = age === 0 && loop.frameCount % 2 === 0 && loop.tick - e.tick < 9 ? 'white' : e.color;
      drawText(g, String(e.tick).padStart(5, ' '), x + 6, cy, 'mist');
      drawText(g, e.text, x + 40, cy, col);
      if (e.lat !== null) drawText(g, `${e.lat.toFixed(0)}MS`, x + w - 5, cy, e.lat <= 17 ? 'leaf' : e.lat <= 34 ? 'gold' : 'red', { align: 'right' });
      cy += LINE_H;
    }
  }

  function enginePanel(g, x, y, M) {
    const w = 150;
    const state = scenes.paused ? 'PAUSED' : loop.paused ? 'FROZEN' : loop.inHitstop ? 'HITSTOP' : loop.timeScale !== 1 ? 'SLOW-MO' : 'RUNNING';
    const stateCol = state === 'PAUSED' || state === 'FROZEN' ? 'rose' : state === 'HITSTOP' ? 'white' : state === 'SLOW-MO' ? 'cyan' : 'leaf';
    panel(g, x, y, w, 262, 'ENGINE', state);
    let cy = y + 16;
    drawText(g, `${Math.round(loop.fps)}`, x + 6, cy, 'bone', { scale: 2 });
    drawText(g, 'FPS', x + 6 + textWidth(`${Math.round(loop.fps)}`, 2) + 3, cy + 7, 'fog');
    drawText(g, `${loop.frameMs.toFixed(1)} MS`, x + w - 5, cy + 7, 'bone', { align: 'right' });
    cy += 18;
    // frame-time graph: last 120 frames, 33 ms full scale, 16.7 ms line
    const gh = 26, gx = x + 5, gw = w - 10;
    g.fillStyle = css('night');
    g.fillRect(gx, cy, gw, gh);
    const hist = loop.history, n = hist.length;
    for (let i = 0; i < gw; i++) {
      const v = hist[(loop.historyIndex - gw + i + n * 2) % n];
      if (!v) continue;
      const bh = Math.max(1, Math.min(gh, Math.round((v / 33.3) * gh)));
      g.fillStyle = css(v <= 18 ? 'teal' : v <= 34 ? 'gold' : 'red');
      g.fillRect(gx + i, cy + gh - bh, 1, bh);
    }
    g.fillStyle = css('slate');
    for (let i = 0; i < gw; i += 2) g.fillRect(gx + i, cy + gh - Math.round(gh / 2), 1, 1);
    cy += gh + 5;

    const row = (k, v, col = 'bone') => {
      drawText(g, k, x + 6, cy, 'fog');
      drawText(g, v, x + w - 5, cy, col, { align: 'right' });
      cy += LINE_H;
    };
    row('SIM TICK', String(loop.tick), loop.paused ? 'rose' : 'bone');
    row('RATE', '60 HZ FIXED');
    row('STEPS THIS FRAME', String(loop.stepsLastFrame));
    row('INTERP ALPHA', loop.alpha.toFixed(2));
    row('TIME SCALE', `X${loop.timeScale}`, loop.timeScale === 1 ? 'bone' : 'cyan');
    row('SCENE', String(scenes.current).toUpperCase(), stateCol);
    cy += 3;
    g.fillStyle = css('violet');
    g.fillRect(x + 5, cy - 2, w - 10, 1);
    drawText(g, 'VOXEL MODEL', x + 6, cy + 1, 'gold');
    cy += LINE_H + 2;
    const e = getModel(M.name);
    const st = e.stats;
    const faces = faceCache.get(M.name);
    row('NAME', M.name.toUpperCase());
    row('SIZE', `${st.size[0]}×${st.size[1]}×${st.size[2]}`);
    row('VOXELS', String(st.voxels));
    row('FACES', String(faces));
    row('GREEDY QUADS', `${st.quads} (-${Math.round((1 - st.quads / faces) * 100)}%)`, 'leaf');
    row('TRIANGLES', String(st.triangles));
    row('MESHED ONCE IN', `${e.ms.toFixed(1)} MS`);
    row('DRAW CALLS', `1 (${display.renderer.info.render.calls} IN FRAME)`);
    row('ZOOM', `${display.zoom}X${display.zoom === 1 ? ' GAME SCALE' : ''}`);
  }
}

function fmt(v) { return (v >= 0 ? ' ' : '-') + Math.abs(v).toFixed(2); }
