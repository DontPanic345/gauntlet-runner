// The boss fight (piece `boss`): the hero, the Warden's Pit and the Warden, with the moments
// that make it an event: the intro, the phase changes, the death, and the boss UI.
// Used by the 'boss' scene (normal play) and by ?showcase=boss.
//
//   const fight = createBossFight(root, { intro: true, phase: 1, source: input, hp: 5 });
//   tick: fight.tick()   frame: fight.frame()   render: fight.render(alpha)   ui: fight.ui(g)
//   exit: fight.dispose()
//   fight.state       'intro' | 'fight' | 'dying' | 'won' | 'lost'
//   fight.warden      the Warden (warden.js)       fight.pit   the pit (arena.js)
//   fight.skipIntro() jump to the end of the intro (attack / interact / confirm also skip it)
//
// THE INTRO (~8 s, skippable after the first second):
//   the hero walks in over the bridge into a dark pit; the gate of bars slams up behind; the
//   camera drifts to the far side where a huge armoured figure kneels in chains; the six
//   braziers light one by one round the rim and the rune ring wakes with them; cut close: its
//   eyes ignite; it rises and tears the chains out of the wall; cut wide: it ROARS (rings, a
//   flash, the braziers flare, the hero is shoved back) and the name card slams in.
// PHASE CHANGES: slow motion, a flash, armour flies off, the eyes change colour, a roar, the
//   braziers flare and shift, a phase card ("II  THE QUAKE"); in III the runes turn red and
//   the cage goes up.
// DEATH: slow motion; beams of light break out of it, wider and more of them as it shudders;
//   it bursts apart (a white-out, rings of gold, the armour clattering across the floor, its
//   soul rising); the cage sinks, the braziers burn gold, THE WARDEN FALLS.

import * as THREE from 'three';
import { display, CAMERA_PITCH } from '../core/display.js';
import { input } from '../core/input.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { setCollision } from '../core/collision.js';
import { debug } from '../core/debug.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css, hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import '../combat/sfx.js';
import { vfx } from '../vfx/vfx.js';
import { createEnemies } from '../enemies/index.js';
import './models.js';
import { PIT } from './models.js';
import { BossPit, IGNITE_ORDER } from './arena.js';
import { Warden, WARDEN, ROMAN, EYE } from './warden.js';
import { bossSfx } from './sfx.js';

const NULL_SOURCE = { move: () => ({ x: 0, z: 0 }), consume: () => false, buffered: () => false, pressed: () => false, held: () => false };
const WARDEN_HOME = { x: 0, z: -3.35 };
const HERO_FIGHT = { x: 0, z: 2.6 };
const HERO_GATE = { x: 0, z: 8.6 };
const HERO_STOP = 3.4;

// intro beats (sim ticks)
export const INTRO = {
  walkEnd: 104, seal: 66, pan: 100, ignite0: 140, igniteGap: 15, eyes: 246, wake: 262, roarCut: 346,
  card: 360, bar: 430, fight: 476,
};

const ease = (a, b, k) => a + (b - a) * k;
const smooth = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
const easeOutBack = (t) => { const c = 1.9; t -= 1; return 1 + (c + 1) * t * t * t + c * t * t; };

export function createBossFight(root, opts = {}) {
  const O = { intro: false, phase: 1, source: input, hp: 5, maxHp: null, force: null, passive: false, demo: false, cameraY: 0.55, ...opts };
  const offs = [];
  const on = (n, f) => offs.push(events.on(n, f));

  // ---- the pit, the hero, the Warden ------------------------------------------------------------
  const pit = new BossPit(root, { lit: !O.intro });
  if (!O.intro) pit.seal(false);
  setCollision(pit.collision);
  look.mood('boss');

  const start = O.intro ? HERO_GATE : HERO_FIGHT;
  const rig = createHeroRig();
  root.add(rig.group);
  const anim = new HeroAnim(rig, { x: start.x, z: start.z, yaw: Math.PI });
  anim.spawn();
  const ctl = new HeroController({ x: start.x, z: start.z, yaw: Math.PI, anim, collision: pit.collision, source: O.intro ? NULL_SOURCE : O.source });
  const health = new HeroHealth({ ctl, anim, rig, hp: O.hp, maxHp: O.maxHp ?? Math.max(5, O.hp) });
  const combat = new HeroCombat({ ctl, anim, health, targets: () => world.enemies });
  world.hero = health;
  const cfx = createCombatFx(root, { numbers: O.numbers ?? true });
  vfx.bind(['move']);

  const mgr = createEnemies(root, { collision: pit.collision, bounds: { minX: -PIT.RP, maxX: PIT.RP, minZ: -PIT.RP, maxZ: PIT.RP }, hero: () => world.hero });
  const warden = new Warden(mgr, { x: WARDEN_HOME.x, z: WARDEN_HOME.z, yaw: 0, phase: O.phase, state: O.intro ? 'dormant' : 'ready' });
  mgr.add(warden);
  warden.force = O.force; warden.passive = O.passive;
  if (O.phase >= 3) { pit.runesHot(); pit.seal(false); pit.cageUp(); for (const c of pit.cage) { c.y = c.py = 0; c.landed = true; c.delay = 0; c.m.visible = true; c.m.position.y = 0; } warden.caged = true; warden.ringR = PIT.CAGE; }
  if (O.phase >= 2) pit.flare(O.phase === 3 ? 'red' : 'flame', 0);

  // ---- camera ---------------------------------------------------------------------------------
  const cam = new CameraRig({});
  cam.follow = false;
  const view = { x: 0, z: -1.0, goalX: 0, goalZ: -1.0, rate: 0.1, zoom: 1, cine: false };
  if (O.intro) { view.x = view.goalX = 0; view.z = view.goalZ = 1.4; }
  cam.reset(view.x, view.z);
  display.setZoom(O.zoom ?? 1);
  function camTick() {
    if (O.focus && !view.cine) {
      // showcase close-ups: frame the Warden
      view.goalX = warden.x; view.goalZ = warden.z - 1.3 - warden.y * 0.9; view.rate = 0.12;
    } else if (!view.cine) {
      // the whole pit stays framed: the view sits between the hero and the Warden, pulled
      // back toward the middle of the pit
      const mx = (ctl.x + warden.x) / 2, mz = (ctl.z + warden.z) / 2;
      view.goalX = Math.max(-2.6, Math.min(2.6, mx * 0.55));
      view.goalZ = Math.max(-3.2, Math.min(0.6, mz * 0.6 - 1.55));
      view.rate = 0.08;
      // a death or a phase change pulls the view toward the Warden
      if (state === 'dying' || warden.state === 'break') { view.goalX = ease(view.goalX, warden.x, 0.4); view.goalZ = ease(view.goalZ, warden.z - 1.4, 0.5); }
    }
    view.x += (view.goalX - view.x) * view.rate;
    view.z += (view.goalZ - view.z) * view.rate;
    cam.tick(ctl);
    cam.pos.cur.x = view.x; cam.pos.cur.z = view.z;
  }
  function cut(x, z, zoom) { view.x = view.goalX = x; view.z = view.goalZ = z; cam.pos.cur.x = cam.pos.prev.x = x; cam.pos.cur.z = cam.pos.prev.z = z; if (zoom && zoom !== display.zoom) display.setZoom(zoom); }

  // ---- slow motion (sim ticks), layered over whatever time scale the caller chose -------------
  const slow = { left: 0, base: null };
  function slowmo(scale, ticks) {
    if (slow.base === null) slow.base = loop.timeScale;
    slow.left = Math.max(slow.left, ticks);
    loop.setTimeScale(Math.min(slow.base, scale * slow.base));
  }
  function tickSlow() { if (slow.left > 0 && --slow.left === 0 && slow.base !== null) { loop.setTimeScale(slow.base); slow.base = null; } }

  // ---- director state --------------------------------------------------------------------------
  let state = O.intro ? 'intro' : 'fight';
  let t = 0;                      // ticks in the current director state
  let total = 0;
  const card = { t: -1 };         // the name card
  const phaseCard = { t: -1, p: 1 };
  const winCard = { t: -1 };
  const bar = { lift: 0, show: O.intro ? 0 : 1, trail: warden.hp, trailHold: 0, flash: 0, hp: warden.hp, poiseFlash: 0 };
  let deadT = -1, wonT = -1;
  let skipReady = false;

  if (!O.intro) { warden.eyesLit = true; warden.begin(); warden.cool = 50; }

  // ---- the intro --------------------------------------------------------------------------------
  function tickIntro() {
    const I = INTRO;
    // the hero walks in over the bridge
    if (t === 1) { ctl.source = { ...NULL_SOURCE, move: () => (ctl.z > HERO_STOP ? { x: 0, z: -0.62 } : { x: 0, z: 0 }) }; bossSfx.rumble(2.6); }
    if (t === I.seal) pit.seal(true);
    if (t === I.walkEnd) ctl.source = NULL_SOURCE;
    // the camera drifts across the pit to what kneels at the far side
    if (t === 1) { view.cine = true; view.goalX = 0; view.goalZ = 1.4; view.rate = 0.05; }
    if (t === I.pan) { view.goalZ = -2.2; view.rate = 0.035; }
    // the braziers light round the rim, the runes wake with them
    for (let i = 0; i < 6; i++) {
      if (t === I.ignite0 + i * I.igniteGap) {
        const k = IGNITE_ORDER[i];
        pit.ignite(k);
        const b = pit.braziers[k];
        // the two rune segments nearest this brazier
        const a = Math.atan2(b.x, b.z), seg = ((Math.round(a / (Math.PI * 2) * 12 - 0.5) % 12) + 12) % 12;
        pit.wakeRune(seg); vfx.later(5, () => pit.wakeRune((seg + 1) % 12));
      }
    }
    if (t === I.ignite0 + 6 * I.igniteGap - 6) for (let k = 0; k < 12; k++) vfx.later(k, () => pit.wakeRune(k));
    // cut close: the eyes ignite
    if (t === I.eyes) {
      cut(warden.x, warden.z - 0.9, 2);
      warden.eyesLit = true;
      bossSfx.eyes();
      const hy = 3.2;
      vfx.flash(warden.x, hy, warden.z + 0.7, { color: EYE[1], size: 0.7, light: false });
      look.flash(warden.x, hy, warden.z + 0.8, { color: 'sky', ms: 420, intensity: 3, radius: 5 });
      feedback.shake(1.5, 120);
    }
    if (t === I.wake) warden.wake();
    if (t > I.wake && t < I.roarCut) { view.goalZ = warden.z - 0.9 - (t - I.wake) * 0.008; view.rate = 0.05; }
    // cut wide: the roar
    if (t === I.roarCut) { cut(0, -1.9, O.zoom ?? 1); view.goalZ = -1.5; view.rate = 0.03; }
    if (t === I.card) { card.t = 0; bossSfx.card(); }
    if (t === I.roarCut + 2) pit.flare(null, 1.2);
    if (t >= I.bar) bar.show = Math.min(1, (t - I.bar) / 24);
    if (t === I.fight) beginFight();
    if (t === 60) skipReady = true;
  }

  function beginFight() {
    state = 'fight'; t = 0;
    view.cine = false;
    if (display.zoom !== (O.zoom ?? 1)) display.setZoom(O.zoom ?? 1);
    ctl.source = O.source;
    bar.show = 1;
    if (!pit.gateUp) pit.seal(true);
    if (warden.state !== 'move') warden.begin();
    events.emit('boss:fight', { warden });
  }

  function skipIntro() {
    if (state !== 'intro') return;
    // land everything where the intro would have left it
    if (!pit.gateUp) { pit.seal(true); }
    for (const b of pit.braziers) pit.ignite(b.k, true);
    for (let k = 0; k < 12; k++) pit.wakeRune(k, true);
    if (warden.state === 'dormant' || warden.state === 'wake' || warden.state === 'roar') {
      warden.chained = false; warden.eyesLit = true;
      for (const a of warden.wallChains) for (const l of a) l.visible = false;
      warden.setState('ready'); Object.assign(warden.pose, { hipY: 0, lean: 0.06, hp: 0.1, tL: 0, sL: 0, tR: 0, sR: 0 });
    }
    if (ctl.z > HERO_STOP + 0.2) ctl.teleport(0, HERO_STOP, Math.PI);
    card.t = Math.max(card.t, 150);
    beginFight();
  }

  // ---- reactions to the Warden ------------------------------------------------------------------
  on('boss:roar', (e) => { pit.flare(null, e.intro ? 1.3 : 1); });
  on('boss:phase', (e) => {
    slowmo(0.35, 46);
    phaseCard.t = 0; phaseCard.p = e.phase;
    pit.flare(e.phase === 3 ? 'red' : 'gold', 1.6);
    if (e.phase === 3) pit.runesHot();
    bar.flash = 20;
  });
  on('boss:cageUp', () => { pit.cageUp(); });
  on('boss:stagger', () => { bar.poiseFlash = 40; });
  on('boss:death', () => {
    state = 'dying'; t = 0;
    slowmo(0.3, 44);
    pit.flare('torch', 2);
    bar.flash = 30;
    // its prisoners crumble with it
    vfx.later(16, () => { for (const e of mgr.list) if (e !== warden && !e.dying && !e.dead) { e.hp = 0; e.dead = true; e.die({ dx: e.x - warden.x, dz: e.z - warden.z }); } });
    for (const w of warden.waves) w.done = true;
  });
  on('boss:burst', (e) => {
    pit.flare('gold', 2.5);
    pit.runesGold();
    vfx.later(70, () => pit.cageDown());
    keysGlow.on = true;
    void e;
  });
  on('boss:defeated', () => { state = 'won'; t = 0; wonT = 0; winCard.t = 0; bossSfx.victory(); });

  // the keys left glowing in the pile
  const keysGlow = { on: false, anchor: new THREE.Object3D(), light: null };
  root.add(keysGlow.anchor);

  // ---- death beams: shafts of light breaking out of the armour ------------------------------------
  const beams = createBeams(root);

  // ---- the tick ---------------------------------------------------------------------------------
  function tick() {
    t++; total++;
    tickSlow();
    if (state === 'intro') tickIntro();
    combat.tick();
    camTick();
    mgr.tick();
    pit.tick();
    cfx.tick();
    if (card.t >= 0) card.t++;
    if (phaseCard.t >= 0 && ++phaseCard.t > 130) phaseCard.t = -1;
    if (winCard.t >= 0) { winCard.t++; bar.show = Math.max(0, bar.show - 0.03); }
    if (bar.flash > 0) bar.flash--;
    if (bar.poiseFlash > 0) bar.poiseFlash--;
    // hp bar: the lost chunk hangs, then drains
    if (warden.hp < bar.hp) { bar.trailHold = 28; }
    bar.hp = warden.hp;
    if (bar.trailHold > 0) bar.trailHold--; else bar.trail = Math.max(warden.hp, bar.trail - warden.maxHp * 0.006);
    // dying: beams grow out of the cracks
    if (state === 'dying' || state === 'won') beams.tick(warden);
    if (keysGlow.on) {
      const c = warden.chunks.find((x) => x.obj.children.includes(warden.keys));
      if (c) {
        keysGlow.anchor.position.set(c.x, c.y, c.z);
        if (!keysGlow.light) keysGlow.light = look.torch(keysGlow.anchor, { y: 0.4, color: 'gold', intensity: 1.4, radius: 3.5, flicker: 0.3 });
        if (total % 14 === 0) { const h = (n) => ((Math.sin(total * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1; vfx.twinkle(c.x + (h(1) - 0.5) * 0.4, c.y + 0.2 + h(2) * 0.3, c.z + (h(3) - 0.5) * 0.3, { color: 'gold', size: 0.8 }); }
      }
    }
    if (health.dead && deadT < 0) { deadT = 0; }
    if (deadT >= 0) { deadT++; if (deadT === 70) { state = 'lost'; events.emit('boss:heroDown', { warden }); } }
    if (state === 'won') { wonT++; }
  }

  function render(alpha) {
    anim.render(alpha);
    health.render();
    const off = cam.render(alpha, ctl.at(alpha));
    rig.group.position.set(off.x, off.y, off.z);
    mgr.render(alpha);
    pit.render(alpha);
    cfx.render(alpha);
    beams.render(alpha, warden);
  }

  function frame() {
    if (state === 'intro' && skipReady && (input.ui.pressed('attack') || input.ui.pressed('interact') || input.ui.pressed('confirm'))) skipIntro();
  }

  // ---- UI ---------------------------------------------------------------------------------------
  function ui(g) {
    cfx.ui(g);
    const W = display.width, H = display.height;
    if (!api.externalHud) drawHeroHp(g, health, W, H);   // hud piece draws these when externalHud is set
    if (bar.show > 0 && !api.externalHud) drawBossBar(g, warden, bar, W, H);
    if (card.t >= 0 && card.t < 190) drawNameCard(g, card.t, W, H);
    if (phaseCard.t >= 0) drawPhaseCard(g, phaseCard.t, phaseCard.p, W, H);
    if (winCard.t >= 0) drawWinCard(g, winCard.t, W, H);
    if (state === 'intro' && skipReady && t < INTRO.fight - 20 && (loop.realTime % 1.2) < 0.8) drawText(g, `${input.describe('attack').split(' / ')[0]}: SKIP`, W - 8, H - 12, 'slate', { align: 'right', shadow: 'ink' });
  }

  function dispose() {
    if (active === api) active = null;
    offs.forEach((f) => f()); offs.length = 0;
    if (slow.base !== null) loop.setTimeScale(slow.base);
    cfx.dispose();
    mgr.dispose();
    pit.dispose();
    beams.dispose();
    keysGlow.light?.remove();
    keysGlow.anchor.removeFromParent();
    rig.group.removeFromParent();
    setCollision(null);
  }

  function info() {
    return { state, t, phase: warden.phase, warden: warden.info(), hero: { x: +ctl.x.toFixed(2), z: +ctl.z.toFixed(2), hp: health.hp, maxHp: health.maxHp, dead: health.dead },
      pit: pit.info(), husks: mgr.list.filter((e) => e.kind === 'husk' && !e.dying).length, zoom: display.zoom };
  }

  const api = {
    get state() { return state; }, get t() { return t; },
    warden, pit, mgr, ctl, anim, rig, health, combat, cfx, cam, view,
    tick, render, frame, ui, dispose, info, skipIntro, beginFight, slowmo,
    get wonT() { return wonT; },
    /** Showcase: back on your feet after a fall (the fight goes on). */
    reviveHero() { health.revive(); deadT = -1; if (state === 'lost') state = 'fight'; },
    /** Lift the boss bar (px) so a showcase help line fits under it. */
    set barLift(v) { bar.lift = v; },
    /** hud piece: true when src/ui/hud.js draws the hero hp and the boss bar (bar.show drives its slide). */
    externalHud: false,
    get bar() { return bar; },
  };
  active = api;
  return api;
}

// ---- debug hook --------------------------------------------------------------------------------
// __GR.debug.boss(action?, ...):
//   ()                      the fight: state, phase, the Warden's info, the hero, the pit
//   ('attack', name)        the Warden starts sweep | lash | stomp | leap | summon | cage now (from a calm state)
//   ('force', name|null)    it only uses that attack from now on (null: back to its own choices)
//   ('passive', on)         it never attacks
//   ('phase')               break into the next phase now (the full phase change plays)
//   ('stagger')             break its poise now
//   ('hp', n)               set its hp
//   ('kill')                the killing blow: the death sequence plays
//   ('skip')                skip the intro
//   ('tune', {...})         live-edit WARDEN (nested objects merge), e.g. ('tune', {sweep: {windup: 70}})
let active = null;
export const activeFight = () => active;
debug.add('boss', (action, a) => {
  if (action === 'tune') {
    if (a && typeof a === 'object') for (const k in a) { if (a[k] && typeof a[k] === 'object' && WARDEN[k] && typeof WARDEN[k] === 'object') Object.assign(WARDEN[k], a[k]); else WARDEN[k] = a[k]; }
    return { ok: true, warden: WARDEN };
  }
  const F = active;
  if (!F) return { ok: false, error: 'no boss fight in this scene (try ?scene=boss or ?showcase=boss)' };
  const w = F.warden;
  if (action === 'attack') { const ok = w.act(a); return { ok, state: w.state, note: ok ? undefined : 'the Warden is busy; try again when it is in move/recover' }; }
  if (action === 'force') { w.force = a ?? null; return { ok: true, force: w.force }; }
  if (action === 'passive') { w.passive = a ?? !w.passive; return { ok: true, passive: w.passive }; }
  if (action === 'phase') {
    if (w.phase >= 3 || w.dying) return { ok: false, error: 'already in the last phase' };
    if (F.state === 'intro') F.skipIntro();
    w.hp = Math.round(w.maxHp * (3 - w.phase) / 3); w.breakPhase({ dx: 0, dz: -1 });
    return { ok: true, phase: w.nextPhase };
  }
  if (action === 'stagger') { if (!w.alive) return { ok: false }; w.staggerNow({ dx: 0, dz: -1 }); return { ok: true }; }
  if (action === 'hp') { w.hp = Math.max(1, Math.min(w.maxHp, a | 0)); return { ok: true, hp: w.hp }; }
  if (action === 'kill') { if (!w.alive) return { ok: false, error: 'already dead' }; if (F.state === 'intro') F.skipIntro(); w.hp = 0; w.phase = 3; w.applyPhaseLook(3, true); w.die({ dx: 0, dz: -1 }); return { ok: true }; }
  if (action === 'skip') { F.skipIntro(); return { ok: true }; }
  return { ok: true, ...F.info() };
});

// ---- the boss UI ------------------------------------------------------------------------------
function drawHeroHp(g, h, W) {
  void W;
  const pw = 9, gap = 3;
  const shake = h.hurtT < 8 ? ((h.hurtT % 2) ? 1 : -1) : 0;
  for (let i = 0; i < h.maxHp; i++) {
    const x = 8 + i * (pw + gap) + shake, y = 8;
    g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, pw + 2, pw + 2);
    const lost = i >= h.hp, just = i === h.hp && h.hurtT < 10;
    g.fillStyle = css(just ? (h.hurtT % 4 < 2 ? 'white' : 'red') : lost ? 'shadow' : 'red');
    g.fillRect(x, y, pw, pw);
    if (!lost) { g.fillStyle = css('rose'); g.fillRect(x + 1, y + 1, 3, 2); }
  }
}

function drawBossBar(g, w, bar, W, H) {
  const bw = Math.min(300, W - 80), x0 = Math.round((W - bw) / 2);
  const y0 = H - 26 - (bar.lift ?? 0) + Math.round((1 - smooth(bar.show)) * 40);
  const max = w.maxHp;
  const fw = (v) => Math.round(bw * Math.max(0, v) / max);
  // name and phase
  drawText(g, WARDEN.name, x0, y0 - 11, bar.flash > 0 && bar.flash % 4 < 2 ? 'white' : 'bone', { shadow: 'ink' });
  const ph = `${ROMAN[w.phase]}  ${WARDEN.phases[w.phase]}`;
  drawText(g, ph, x0 + bw, y0 - 11, w.phase === 3 ? 'red' : w.phase === 2 ? 'gold' : 'sky', { align: 'right', shadow: 'ink' });
  // frame
  g.fillStyle = css('ink'); g.fillRect(x0 - 2, y0 - 2, bw + 4, 10);
  g.fillStyle = css('shadow'); g.fillRect(x0, y0, bw, 6);
  // the drained chunk, then the hp
  g.fillStyle = css('torch'); g.fillRect(x0, y0, fw(bar.trail), 6);
  g.fillStyle = css(bar.flash > 0 && bar.flash % 4 < 2 ? 'white' : 'red'); g.fillRect(x0, y0, fw(w.hp), 6);
  g.fillStyle = css('rose'); g.fillRect(x0, y0, fw(w.hp), 1);
  g.fillStyle = css('blood'); g.fillRect(x0, y0 + 5, fw(w.hp), 1);
  // phase notches at 2/3 and 1/3
  for (const k of [1, 2]) {
    const nx = x0 + Math.round(bw * k / 3);
    g.fillStyle = css('ink'); g.fillRect(nx, y0 - 2, 1, 10);
    g.fillStyle = css('gold'); g.fillRect(nx, y0 - 3, 1, 2);
  }
  // poise: a thin gold bar under it; it flashes when it breaks, greys while it is locked
  const py = y0 + 8;
  const locked = w.poiseLockT > 0;
  const pv = w.state === 'stagger' ? 1 : locked ? 0 : Math.min(1, w.poiseHit / WARDEN.poise);
  g.fillStyle = css('ink'); g.fillRect(x0 - 1, py - 1, bw + 2, 4);
  g.fillStyle = css('night'); g.fillRect(x0, py, bw, 2);
  if (w.state === 'stagger') {
    const k = 1 - w.st / WARDEN.stagger.ticks;
    g.fillStyle = css((w.st >> 2) & 1 ? 'gold' : 'torch'); g.fillRect(x0, py, Math.round(bw * k), 2);
    drawText(g, 'STAGGERED', W / 2, py + 4, (w.st >> 3) & 1 ? 'gold' : 'torch', { align: 'center', outline: 'ink' });
  } else if (locked) {
    g.fillStyle = css('slate'); g.fillRect(x0, py, Math.round(bw * (1 - w.poiseLockT / (WARDEN.stagger.ticks + WARDEN.poiseLock))), 2);
  } else {
    g.fillStyle = css(pv > 0.75 ? 'gold' : 'flame'); g.fillRect(x0, py, Math.round(bw * pv), 2);
  }
}

function drawNameCard(g, t, W, H) {
  // slam in (scale 5 -> 4 with a white frame), hold, then wipe out
  const out = 190 - t;
  const y = Math.round(H * 0.6);
  const k = Math.min(1, t / 6), o = Math.min(1, out / 14);
  const barW = Math.round(W * Math.min(k, o));
  g.fillStyle = css('ink');
  g.fillRect(Math.round(W / 2 - barW / 2), y - 10, barW, 58);
  g.fillStyle = css('ember');
  g.fillRect(Math.round(W / 2 - barW / 2), y - 10, barW, 2);
  g.fillRect(Math.round(W / 2 - barW / 2), y + 46, barW, 2);
  if (t < 4 || o < 0.6) return;
  const s = t < 7 ? 5 : 4;
  const shake = t < 12 ? ((t % 2) ? 1 : -1) * (12 - t) / 4 : 0;
  drawText(g, WARDEN.name, W / 2 + Math.round(shake), y - (s === 5 ? 4 : 0), t < 8 ? 'white' : 'bone', { align: 'center', scale: s, shadow: 'blood' });
  if (t > 16) {
    const sub = WARDEN.title;
    const n = Math.min(sub.length, Math.floor((t - 16) / 1.5));
    drawText(g, sub.slice(0, n), W / 2, y + 34, 'gold', { align: 'center' });
  }
}

function drawPhaseCard(g, t, p, W, H) {
  const out = 130 - t;
  if (out < 12 && out % 4 < 2) return;
  const y = Math.round(H * 0.74);
  const pop = t < 8 ? easeOutBack(t / 8) : 1;
  const num = ROMAN[p];
  const col = p === 3 ? 'red' : 'gold';
  const k = Math.min(1, t / 8);
  const w = Math.round((textWidth(WARDEN.phases[p], 2) + 60) * k);
  g.fillStyle = css('ink'); g.fillRect(Math.round(W / 2 - w / 2), y - 4, w, 40);
  g.fillStyle = css(col); g.fillRect(Math.round(W / 2 - w / 2), y - 4, w, 1); g.fillRect(Math.round(W / 2 - w / 2), y + 35, w, 1);
  if (t < 3) return;
  drawText(g, num, W / 2, y - Math.round((1 - pop) * 10), t < 6 ? 'white' : col, { align: 'center', scale: 2, shadow: 'blood' });
  if (t > 10) drawText(g, WARDEN.phases[p], W / 2, y + 17, 'bone', { align: 'center', scale: 2, shadow: 'dusk' });
}

function drawWinCard(g, t, W, H) {
  const y = Math.round(H * 0.09);
  const k = Math.min(1, t / 8);
  const s = t < 4 ? 5 : 4;
  const barW = Math.round(W * 0.9 * k);
  g.fillStyle = css('ink'); g.fillRect(Math.round(W / 2 - barW / 2), y - 10, barW, 54);
  g.fillStyle = css('gold'); g.fillRect(Math.round(W / 2 - barW / 2), y - 10, barW, 2); g.fillRect(Math.round(W / 2 - barW / 2), y + 42, barW, 2);
  if (t < 4) return;
  drawText(g, 'THE WARDEN FALLS', W / 2, y - (s === 5 ? 3 : 0), t < 8 ? 'white' : 'gold', { align: 'center', scale: s === 5 ? 4 : 3, shadow: 'blood' });
  if (t > 30) drawText(g, 'THE KEYS TO THE DEEP ARE YOURS', W / 2, y + 30, (t % 50) < 38 ? 'bone' : 'gold', { align: 'center', shadow: 'ink' });
}

// ---- beams of light (the death) ---------------------------------------------------------------------
function createBeams(root) {
  const group = new THREE.Group();
  group.rotation.x = -CAMERA_PITCH;          // a plane facing the camera
  root.add(group);
  look.noOutline(group);
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.translate(0.5, 0, 0);
  const mats = ['torch', 'white', 'gold'].map((c) => new THREE.MeshBasicMaterial({ color: hex(c), depthTest: false, depthWrite: false }));
  const N = 16;
  const list = [];
  let s = 4242;
  const r = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < N; i++) {
    const m = new THREE.Mesh(geo, mats[i % 3]);
    m.renderOrder = 50 + i;
    m.visible = false;
    group.add(m);
    // spread the angles round the circle, biased upward
    const a = (i * 2.39996 + r() * 0.4) % (Math.PI * 2);
    list.push({ m, a: Math.sin(a) < -0.6 ? a + Math.PI : a, len: 0, target: 1.6 + r() * 3.6, w: 0.08 + r() * 0.16, born: 14 + i * 6, ph: r() * 10 });
  }
  look.noOutline(group);
  const o = { x: 0, y: 0, z: 0 };
  let st = 0, burstAt = -1;
  return {
    tick(warden) {
      st = warden.st;
      if (warden.burst && burstAt < 0) burstAt = st;
      for (const b of list) {
        if (warden.burst) { b.len += (b.target * 4 - b.len) * 0.5; }
        else if (st >= b.born) b.len += (b.target * (0.6 + 0.4 * Math.min(1, (st - b.born) / 40)) - b.len) * 0.15;
      }
    },
    render(alpha, warden) {
      if (!warden.dying) { group.visible = false; return; }
      warden.beamOrigin(o);
      group.position.set(o.x, o.y, o.z);
      look.snap(group.position);
      const after = burstAt >= 0 ? st - burstAt : -1;
      group.visible = after < 0 || after < 14;
      const stepped = Math.floor((loop.tick) / 3);
      for (const [i, b] of list.entries()) {
        const vis = (warden.burst ? true : st >= b.born) && b.len > 0.05;
        b.m.visible = vis;
        if (!vis) continue;
        const flick = 0.75 + 0.25 * (((stepped + i * 7) % 5) / 4);
        const fat = after >= 0 ? 3 * (1 - after / 14) + 0.5 : 1;
        b.m.rotation.z = b.a + Math.sin(stepped * 0.3 + b.ph) * 0.01;
        b.m.scale.set(b.len, Math.max(1 / 32, b.w * flick * fat), 1);
      }
      void alpha;
    },
    dispose() { group.removeFromParent(); geo.dispose(); mats.forEach((m) => m.dispose()); },
  };
}

export { NULL_SOURCE, WARDEN_HOME, HERO_FIGHT };
