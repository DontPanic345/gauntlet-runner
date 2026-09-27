// Title screen and menus (piece `title`): the first scene the game shows. An animated voxel
// vignette (the runner at the Gauntlet's mouth, torchlit, embers drifting), a designed logo
// lockup drawn on the UI canvas, and a Start/Settings/Controls/Credits menu, all keyboard,
// mouse and gamepad navigable. Also replaces foundation's placeholder `pause` scene with the
// same menu toolkit (per core/placeholders.js's header: "pause -> `title` menus").
//
//   scenes.define('title', createTitleScene())     // normal entry (also the default `/`)
//   scenes.define('pause', createPauseScene())      // Esc/P from any pausable scene
//
// The environment borrows the `look` piece's crypt-vignette stand-in models (floor, back wall
// with its barred arch/banners/sconces, brazier) rather than authoring new voxel art — see
// title.md "Known gaps". The hero is the real rig+animator, idling at the arch.

import * as THREE from 'three';
import { scenes } from '../core/scenes.js';
import { display } from '../core/display.js';
import { input, ACTIONS } from '../core/input.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { debug } from '../core/debug.js';
import { drawText } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { voxelMesh, VOXEL } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { SCONCES } from '../render/showcase-models.js';
import { vfx } from '../vfx/index.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { createMenuList, menuSfx, drawGem, createTextScreen, clamp01 } from './menus.js';
import { createSettingsScreen } from './settings.js';

const TAU = Math.PI * 2;
const FLOOR_BACK = -5;     // world z of the back wall face (matches look's showcase vignette)
const PAN_AMP = 1.0;       // world units either side
const PAN_PERIOD = 26;     // seconds for a full sweep
const ITEM_W = 190, ITEM_H = 30;

const SCREENS = ['closed', 'main', 'settings', 'controls', 'credits'];

// The current menu host, for a critic/test script (debug.add('menu', ...) below).
let activeHost = null;

const CONTROL_ROWS = [
  ['up', 'MOVE UP'], ['down', 'MOVE DOWN'], ['left', 'MOVE LEFT'], ['right', 'MOVE RIGHT'],
  ['attack', 'ATTACK'], ['dash', 'DASH'], ['interact', 'INTERACT'], ['pause', 'PAUSE'],
];
function controlsLines() {
  return CONTROL_ROWS.filter(([a]) => ACTIONS.includes(a)).map(([a, label]) => [label, input.describe(a) || '-']);
}
const CREDITS_LINES = [
  'GAUNTLET-RUNNER', '',
  'A three.js voxel roguelite built by the Hurdles loop:', 'waves of building, then blind A/B critique.',
  '', ['ENGINE, ART AND SOUND', 'THE HURDLES LOOP'], '', 'Built with three.js and WebAudio.', 'No third-party art or audio.',
];

// ---------------------------------------------------------------------------------------
// the 3D vignette: floor, back wall (arch, banners, sconces), two braziers, the idling hero
function buildTitleEnv(root) {
  const place = (name, x, z, yaw = 0, y = 0) => {
    const m = voxelMesh(name);
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    root.add(m);
    return m;
  };
  look.mood('crypt');
  place('look.floor', 0, FLOOR_BACK);
  place('look.wall', 0, FLOOR_BACK);
  place('look.rubble', -6.4, 2.2, 0.4);
  place('look.rubble', 6.0, 1.6, -0.3);

  // sconce anchors: plain Object3D at each cup (matches look's showcase wiring)
  for (const [sx, sy] of SCONCES) {
    const x = sx * VOXEL, y = (sy + 1) * VOXEL, z = FLOOR_BACK + 2 * VOXEL + VOXEL / 2;
    const anchor = new THREE.Object3D();
    anchor.position.set(x, y, z);
    root.add(anchor);
    look.torch(anchor, { y: 0.3, z: 0.35, color: 'flame', intensity: 1.1, radius: 6.5 });
  }
  const braziers = [];
  for (const bx of [-2.7, 2.7]) {
    const b = place('look.brazier', bx, 1.6);
    look.torch(b, { y: 1.6, color: 'flame', intensity: 1.7, radius: 7.5 });
    braziers.push(b);
  }

  vfx.attach(root, { ambient: 'crypt', capacity: 1400 });

  const rig = createHeroRig();
  root.add(rig.group);
  const anim = new HeroAnim(rig, { x: 0, z: 1.9, yaw: Math.PI, floorY: 0 });
  anim.spawn();

  return {
    tick() { anim.tick({ x: 0, z: 1.9, face: Math.PI }); vfx.tick(); },
    render(alpha) { anim.render(alpha); vfx.render(alpha); },
    ui(g) { vfx.ui(g); },
    dispose() { anim.rig.dispose(); vfx.detach(); },
  };
}

// ---------------------------------------------------------------------------------------
// the logo lockup: a framed banner, hanging chain accents, a pulsing ember glow, two-line
// title text and a tagline. Designed as one lockup, not a bare drawText call.
function drawLogo(g, t) {
  const W = display.width;
  const cx = Math.round(W / 2);
  const bw = 320, bh = 66, bx = cx - bw / 2, by = 14;

  // hanging chains from the top edge to the banner's shoulders
  for (const side of [-1, 1]) {
    const x = cx + side * (bw / 2 - 6);
    for (let y = 0; y < by; y += 2) {
      g.fillStyle = css(((y >> 1) + (side > 0 ? 1 : 0)) % 2 ? 'slate' : 'mist');
      g.fillRect(x, y, 2, 2);
    }
  }

  // pulsing ember glow behind the banner (sparse dither, cheap: 2px step)
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.6);
  g.fillStyle = css('ember');
  const rx = 170, ry = 38, gcx = cx, gcy = by + bh / 2;
  for (let y = -ry; y <= ry; y += 2) {
    for (let x = -rx; x <= rx; x += 2) {
      const d = (x * x) / (rx * rx) + (y * y) / (ry * ry);
      if (d > 1) continue;
      const density = (1 - d) * pulse;
      if (((x * 7 + y * 13 + Math.floor(t * 18)) & 7) < density * 3) g.fillRect(gcx + x, gcy + y, 1, 1);
    }
  }

  // banner body
  g.fillStyle = css('ink'); g.fillRect(bx - 2, by + 4, bw + 4, bh + 4); // drop shadow
  g.fillStyle = css('ink'); g.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
  g.fillStyle = css('shadow'); g.fillRect(bx, by, bw, bh);
  g.fillStyle = css('dusk'); g.fillRect(bx, by, bw, Math.round(bh * 0.42));
  g.fillStyle = css('gold'); g.fillRect(bx, by, bw, 1);
  g.fillStyle = css('ink'); g.fillRect(bx, by + bh - 1, bw, 1);
  drawGem(g, bx + 9, by + 9); drawGem(g, bx + bw - 9, by + 9);
  drawGem(g, bx + 9, by + bh - 9); drawGem(g, bx + bw - 9, by + bh - 9);

  // title text, two lines, ember-lit
  drawText(g, 'GAUNTLET', cx, by + 8, 'bone', { align: 'center', scale: 3, outline: 'ink' });
  drawText(g, 'RUNNER', cx, by + 34, 'gold', { align: 'center', scale: 3, outline: 'ink' });
  g.fillStyle = css('ember'); g.fillRect(cx - 64, by + bh - 12, 128, 1);
  drawGem(g, cx, by + bh - 12, 'torch', 'ember');

  // tagline
  drawText(g, 'DESCEND THE COLLAPSING CRYPT', cx, by + bh + 8, 'frost', { align: 'center', shadow: 'ink' });
}

// ---------------------------------------------------------------------------------------
export function createTitleScene({ forceMenu = null } = {}) {
  let root, env;
  let screen = 'closed', screenT0 = 0;
  let mainMenu, settingsScreen, controlsScreen, creditsScreen;
  let camT = 0, camPrevT = 0;

  const mainRect = (i) => ({ x: display.width / 2 - ITEM_W / 2, y: 168 + i * ITEM_H, w: ITEM_W, h: ITEM_H - 4 });
  const panelBox = () => ({ x: display.width / 2 - 150, y: 96, w: 300 });

  function openScreen(name) {
    screen = name; screenT0 = loop.realTime;
    if (name === 'main') mainMenu.replay();
    else if (name === 'settings') settingsScreen.reset();
    else if (name === 'controls') controlsScreen.reset();
    else if (name === 'credits') creditsScreen.reset();
  }
  function currentIndex() {
    if (screen === 'main') return mainMenu.index;
    if (screen === 'settings') return settingsScreen.index;
    return 0;
  }

  const def = {
    // Not pausable: the title has its own screen stack (main/settings/controls/credits), and
    // Esc there means "back one level", not "open the pause overlay" (see createPauseScene).
    enter(_d, r) {
      root = r;
      world.reset();
      display.setZoom(1);
      env = buildTitleEnv(root);
      mainMenu = createMenuList({
        items: [
          { id: 'start', label: 'START' },
          { id: 'settings', label: 'SETTINGS' },
          { id: 'controls', label: 'CONTROLS' },
          { id: 'credits', label: 'CREDITS' },
        ],
        onConfirm(it) { if (it.id === 'start') scenes.go('run'); else openScreen(it.id); },
        onCancel() { openScreen('closed'); },
      });
      settingsScreen = createSettingsScreen({ onBack: () => openScreen('main') });
      controlsScreen = createTextScreen({ heading: 'CONTROLS', lines: controlsLines(), onBack: () => openScreen('main') });
      creditsScreen = createTextScreen({ heading: 'CREDITS', lines: CREDITS_LINES, onBack: () => openScreen('main') });
      screen = SCREENS.includes(forceMenu) && forceMenu !== 'closed' ? forceMenu : 'closed';
      screenT0 = loop.realTime;
      camT = camPrevT = 0;
      activeHost = { get screen() { return screen; }, get index() { return currentIndex(); }, open: openScreen };
    },
    exit() { env.dispose(); activeHost = null; },
    tick() { camPrevT = camT; camT += DT; env.tick(); },
    frame() {
      if (screen === 'closed') {
        if (input.ui.pressed('confirm') || input.ui.pressed('attack') || input.ui.key('Mouse0')) openScreen('main');
        return;
      }
      const box = panelBox();
      if (screen === 'main') mainMenu.frame(mainRect);
      else if (screen === 'settings') settingsScreen.frame(box.x, 128, box.w);
      else if (screen === 'controls') controlsScreen.frame();
      else if (screen === 'credits') creditsScreen.frame();
    },
    render(alpha) {
      const pt = camPrevT + (camT - camPrevT) * alpha;
      const cx = Math.sin((pt / PAN_PERIOD) * TAU) * PAN_AMP;
      display.setCameraTarget(cx, 0.9, -2.4);
      env.render(alpha);
    },
    ui(g) {
      const t = loop.realTime;
      const W = display.width, H = display.height;
      drawLogo(g, t);
      if (screen !== 'closed') { g.fillStyle = 'rgba(11,10,18,0.55)'; g.fillRect(0, 0, W, H); }
      if (screen === 'closed') {
        if ((loop.realTime % 1.1) < 0.68) drawText(g, 'PRESS START', W / 2, H - 40, 'gold', { align: 'center', shadow: 'ink' });
      } else if (screen === 'main') {
        mainMenu.ui(g, W / 2 - ITEM_W / 2, 168, ITEM_W, ITEM_H, t);
      } else {
        const box = panelBox();
        if (screen === 'settings') settingsScreen.ui(g, box.x, 128, box.w, t);
        else if (screen === 'controls') controlsScreen.ui(g, box.x, 96, box.w);
        else if (screen === 'credits') creditsScreen.ui(g, box.x, 96, box.w);
      }
      env.ui(g);
    },
    state() { return { menu: { screen, index: currentIndex() } } },
  };
  return def;
}

// ---------------------------------------------------------------------------------------
// pause: Resume / Settings / Controls / Quit to Title, drawn over the frozen scene beneath.
export function createPauseScene() {
  let screen = 'main', screenT0 = 0;
  let mainMenu, settingsScreen, controlsScreen;
  let justOpened = false; // eat the Esc/P press that opened us: it also reads as 'cancel'/'pause'

  function openScreen(name) {
    screen = name; screenT0 = loop.realTime;
    if (name === 'main') mainMenu.replay();
    else if (name === 'settings') settingsScreen.reset();
    else if (name === 'controls') controlsScreen.reset();
  }
  function currentIndex() { return screen === 'main' ? mainMenu.index : screen === 'settings' ? settingsScreen.index : 0; }
  const mainRect = (i) => ({ x: display.width / 2 - ITEM_W / 2, y: 140 + i * ITEM_H, w: ITEM_W, h: ITEM_H - 4 });
  const panelBox = () => ({ x: display.width / 2 - 150, y: 96, w: 300 });

  return {
    enter() {
      mainMenu = createMenuList({
        items: [
          { id: 'resume', label: 'RESUME' },
          { id: 'settings', label: 'SETTINGS' },
          { id: 'controls', label: 'CONTROLS' },
          { id: 'title', label: 'QUIT TO TITLE' },
        ],
        onConfirm(it) {
          if (it.id === 'resume') scenes.resume();
          else if (it.id === 'title') { scenes.resume(); scenes.go('title'); }
          else openScreen(it.id);
        },
        onCancel() { scenes.resume(); },
      });
      settingsScreen = createSettingsScreen({ onBack: () => openScreen('main') });
      controlsScreen = createTextScreen({ heading: 'CONTROLS', lines: controlsLines(), onBack: () => openScreen('main') });
      screen = 'main'; screenT0 = loop.realTime;
      justOpened = true;
      menuSfx.open();
      activeHost = { get screen() { return screen; }, get index() { return currentIndex(); }, open: openScreen };
    },
    exit() { activeHost = null; },
    frame(dt) {
      if (justOpened) { justOpened = false; return; } // this frame's Esc/P also opened us; don't also act on it
      if (screen === 'main' && input.ui.pressed('pause')) { menuSfx.back(); scenes.resume(); return; }
      const box = panelBox();
      if (screen === 'main') mainMenu.frame(mainRect);
      else if (screen === 'settings') settingsScreen.frame(box.x, 100, box.w);
      else if (screen === 'controls') controlsScreen.frame();
      void dt;
    },
    ui(g) {
      const t = loop.realTime;
      const W = display.width, H = display.height;
      const k = clamp01((t - screenT0 + 0.12) / 0.12);
      g.fillStyle = `rgba(11,10,18,${0.62 * k})`;
      g.fillRect(0, 0, W, H);
      drawText(g, 'PAUSED', W / 2, 60, 'bone', { align: 'center', scale: 3, outline: 'ink' });
      if (screen === 'main') mainMenu.ui(g, W / 2 - ITEM_W / 2, 140, ITEM_W, ITEM_H, t);
      else {
        const box = panelBox();
        if (screen === 'settings') settingsScreen.ui(g, box.x, 100, box.w, t);
        else if (screen === 'controls') controlsScreen.ui(g, box.x, 70, box.w);
      }
    },
    state() { return { menu: { screen, index: currentIndex() } } },
  };
}

scenes.define('title', createTitleScene());
scenes.define('pause', createPauseScene());

// ---------------------------------------------------------------------------------------
// __GR.debug.menu(action, arg): drives whichever menu (title or pause) is currently open.
// action: 'open' (arg = screen name), 'nav' ('up'|'down'|'left'|'right'), 'confirm', 'cancel'.
// Always returns {screen, index}. Scripted tests can also just use debug.input()/tap() on the
// usual up/down/confirm/cancel actions; this hook exists for a one-call jump to a sub-screen.
debug.add('menu', (action, arg) => {
  if (!activeHost) return { ok: false, error: 'no menu open' };
  if (action === 'open') activeHost.open(arg);
  else if (action === 'nav') { input.injectCode(arg === 'up' ? 'ArrowUp' : arg === 'down' ? 'ArrowDown' : arg === 'left' ? 'ArrowLeft' : 'ArrowRight', true); input.injectCode(arg === 'up' ? 'ArrowUp' : arg === 'down' ? 'ArrowDown' : arg === 'left' ? 'ArrowLeft' : 'ArrowRight', false); }
  else if (action === 'confirm') { input.injectCode('Enter', true); input.injectCode('Enter', false); }
  else if (action === 'cancel') { input.injectCode('Escape', true); input.injectCode('Escape', false); }
  return { ok: true, screen: activeHost.screen, index: activeHost.index };
});
