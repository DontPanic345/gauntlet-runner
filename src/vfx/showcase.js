// ?showcase=vfx : the effects reel. Each effect plays in turn, labelled, in a lit crypt corner
// with the real hero. HIT, KILL BURST (id death) and SPAWN use the game's real enemies, struck
// through combat's strike() and bound through vfx.bind(['kill']) exactly as in play, so the
// look impact layer (stains, chips) and combat's 2D marks and numbers show too. The other
// entries use a skeleton stand-in. The reel loops.
//
// Params:  &fx=<id>      start at this effect and hold it (loop only it). Ids: hit slash dust dash
//                        death spawn embers flash shock pickup ambient stress
//          &loop=0       with &fx: play it once and advance as normal
//          &zoom=1..3    (default 2; 1 = game scale)
//          &slow=<s>     time scale, e.g. 0.25
//          &ambient=0    no ambient layer (motes, embers, brazier fire)
//          &hud=0        no labels at all (clean stills)
//          &stress=<n>   particles the stress entry keeps alive (default 2400)
// Keys:    Left/Right or A/D  previous / next effect     1-9 0 - =  jump to an effect
//          Space or J  replay     L  hold this effect / auto-advance     B  ambient on/off
//          Z  zoom     T  slow-mo (1, 0.5, 0.25, 0.1)     H  labels     P/Esc  pause
//
// Every entry re-seeds the vfx stream when it starts, so a replay is identical.

import * as THREE from 'three';
import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { voxelMesh, VOXEL, VoxelGrid, defineModel } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import '../render/showcase-models.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { strike, applyImpact, COMBO } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import { createEnemies } from '../enemies/index.js';
import { vfx } from './vfx.js';

// a small gem pickup, for the sparkle
{
  const g = new VoxelGrid(5, 7, 5);
  const put = (y, pts, c, e = false) => pts.forEach(([x, z]) => g.set(x, y, z, c, e));
  const plus = [[2, 1], [1, 2], [2, 2], [3, 2], [2, 3]];
  const sq = [[1, 1], [2, 1], [3, 1], [1, 2], [2, 2], [3, 2], [1, 3], [2, 3], [3, 3]];
  put(0, [[2, 2]], 'flame');
  put(1, plus, 'flame');
  put(2, sq, 'gold'); put(2, [[2, 2]], 'torch', true);
  put(3, [...sq, [0, 2], [4, 2], [2, 0], [2, 4]], 'gold'); put(3, [[1, 1], [3, 1]], 'torch', true);
  put(4, sq, 'gold');
  put(5, plus, 'torch');
  put(6, [[2, 2]], 'white');
  defineModel('vfx.gem', { grid: g });
}

const HERO = { x: -1.3, z: 0.3 };
const SKEL = { x: 0.9, z: 0.1 };
const FOE = { x: -0.1, z: 0.25 };      // where the real enemies stand, in the hero's reach
const BRAZIERS = [[-3.4, -1.6], [3.4, -1.6]];
const SLOWS = [1, 0.5, 0.25, 0.1];

// The reel. dur in ticks. run(t, S) is called every tick with the entry's local tick.
const REEL = [
  { id: 'hit', label: 'HIT SPARK', note: 'REAL COMBO, REAL HUSK. WHITE FLASH, INK FRAME, BURST, CHIPS THAT STAY', dur: 200 },
  { id: 'slash', label: 'SLASH SMEAR', note: 'SWEEPS IN FAST, EATEN FROM THE TAIL. BLADE, ENEMY, BOSS', dur: 170 },
  { id: 'dust', label: 'DUST PUFFS', note: 'FOOTSTEP SCUFFS, THEN A LANDING RING', dur: 200 },
  { id: 'dash', label: 'DASH', note: 'KICK-OFF DUST, SPEED LINES, DITHER-FADING AFTERIMAGES', dur: 150 },
  { id: 'death', label: 'KILL BURST', note: 'HUSK, BRUTE, MITES. INK FRAME, STARBURST, SMOKE, SCORCH THAT STAYS', dur: 420 },
  { id: 'spawn', label: 'SPAWN PORTAL', note: 'REAL SPAWN-INS. SNAPS OPEN, PULLS MOTES IN, GLOWS, POPS', dur: 200 },
  { id: 'embers', label: 'EMBERS', note: 'A GUST OF EMBERS OFF THE COALS', dur: 170 },
  { id: 'flash', label: 'LIGHT FLASH', note: 'A LIGHT POP WITH A HOT DISC AND FLARE', dur: 150 },
  { id: 'shock', label: 'SHOCKWAVE', note: 'OVERHEAD SLAM, THEN A BOSS STOMP', dur: 170 },
  { id: 'pickup', label: 'PICKUP SPARKLE', note: 'IDLE TWINKLE, THEN COLLECTED', dur: 170 },
  { id: 'ambient', label: 'AMBIENT LAYER', note: 'CRYPT MOTES, COLLAPSE EMBERS AND GRIT, BOSS MOTES', dur: 330 },
  { id: 'stress', label: 'STRESS', note: 'ONE POOL, ONE DRAW CALL, NO ALLOCATION PER FRAME', dur: 300 },
];

export default function vfxShowcase(params) {
  let hud = params.get('hud') !== '0';
  let zoom = Math.max(1, Math.min(3, parseInt(params.get('zoom') ?? '2', 10) || 2));
  const slowParam = parseFloat(params.get('slow') ?? '1');
  let slowIdx = Math.max(0, SLOWS.indexOf(slowParam));
  const start = REEL.findIndex((e) => e.id === params.get('fx'));
  let idx = Math.max(0, start);
  let hold = start >= 0 && params.get('loop') !== '0';
  let ambientOn = params.get('ambient') !== '0';
  const stressN = Math.max(100, Math.min(4000, parseInt(params.get('stress') ?? '2400', 10) || 2400));

  let root, rig, anim, skel, gem, braziers = [], amb = null, offs = [], foes = null, cfx = null;
  let t = 0;                        // local tick in the current entry
  let hx = HERO.x, hz = HERO.z, hFace = Math.PI / 2, hvx = 0;
  let skelShow = 1, skelPop = -1, skelFlash = 0, skelKnock = 0, skelVisible = true;
  let gemShow = 1, gemPop = -1;
  let ambPreset = 'crypt';
  let status = { text: '', until: 0 };
  const say = (text) => { status = { text, until: loop.realTime + 1.4 }; };
  let fpsMin = 999, fpsAcc = [];
  let sr = 1;
  const srnd = () => { sr = (sr * 16807) % 2147483647; return sr / 2147483647; };

  const skelMat = () => skel.material.userData.flash;

  function startAmbient(preset = 'crypt') {
    amb?.stop();
    amb = null;
    ambPreset = preset;
    if (!ambientOn) return;
    const fires = BRAZIERS.map(([x, z]) => [x, 7.2 * VOXEL, z, 1.4]);
    amb = vfx.ambient({ preset, box: [-5.5, 5.5, 0.15, 2.6, -4.6, 2.6], sources: fires.map((f) => [f[0], f[1] + 0.2, f[2]]), fires });
    look.mood(preset === 'crypt' ? 'crypt' : preset);
  }

  function resetActors() {
    hx = HERO.x; hz = HERO.z; hFace = Math.PI / 2; hvx = 0;
    anim.reset(hx, hz, hFace);
    skelShow = 1; skelPop = -1; skelFlash = 0; skelKnock = 0; skelVisible = true;
    gemShow = 1; gemPop = -1;
  }

  function begin(i) {
    idx = (i + REEL.length) % REEL.length;
    t = 0;
    vfx.clear();                       // a replay starts from a clean slate (the ambient layer restarts, prewarmed)
    vfx.bind(['kill']);                // the same kill binding every game scene uses (clear() unbinds)
    look.impact?.clear();              // floor marks are part of an entry: start each one clean
    look.impact?.seed(idx * 31 + 7);
    foes?.clear();
    amb = null;
    vfx.seed(idx * 7919 + 1);
    resetActors();
    fpsMin = 999; fpsAcc.length = 0; sr = 1;
    const id = REEL[idx].id;
    startAmbient('crypt');
    if (id === 'spawn' || id === 'hit' || id === 'death') { skelVisible = false; }
    if (id === 'hit') foe('husk', FOE.x, FOE.z, { hp: 9999 });
    if (id === 'pickup') { gemShow = 1; skelVisible = false; }
  }

  // a real enemy, standing still as a puppet (ai off) so the reel is the same every loop
  function foe(kind, x, z, { hp = null, instant = true } = {}) {
    const r = foes.spawn(kind, x, z, { instant, yaw: -Math.PI / 2 });
    for (const e of [].concat(r)) { e.ai = false; if (hp != null) { e.hp = e.maxHp = hp; } }
    return r;
  }
  const near = (r) => world.enemies.filter((e) => !e.dead && !e.dying && e.state !== 'spawn' && Math.hypot(e.x - hx, e.z - hz) < r + (e.r ?? 0.3));

  // hit reaction for the skeleton stand-in
  function strikeSkel(power, dx = 1) {
    skelFlash = 3;
    skelKnock = 0.12 * power * dx;
    feedback.hitstop(45 + power * 20);
    feedback.kick(dx, 0, 1 + power);
    if (power > 1.5) feedback.shake(2.5, 140);
  }

  // ---- the entries --------------------------------------------------------------------------
  const RUN = {
    hit(k) {
      // the hero's real combo on a real husk, through combat's strike(): everything a hit
      // gets in play (flash, ink frame, burst, chips, droplets, stains, numbers)
      for (const [at, step] of [[20, 0], [36, 1], [54, 2], [115, 0], [131, 1], [149, 2]]) if (k === at) anim.attack(step);
    },
    slash(k) {
      const y = 0.55;
      if (k === 12) vfx.slash(hx, y, hz, hFace, { palette: 'blade', span: 2.3, radius: 1.15 });
      if (k === 40) vfx.slash(hx, y, hz, hFace, { palette: 'blade', span: 2.3, radius: 1.15, mirror: -1 });
      if (k === 75) vfx.slash(SKEL.x, 0.6, SKEL.z, -Math.PI / 2, { palette: 'enemy', span: 2.8, radius: 1.3, thick: 0.45, life: 0.22 });
      if (k === 115) vfx.slash(0, 0.3, -0.3, 0, { palette: 'ember', span: 3.6, radius: 2.3, thick: 0.35, life: 0.3, mirror: -1 });
    },
    dust(k) {
      // run right, stop, run back along a lane in front of the skeleton; the hero's own
      // footstep events drive vfx.step
      if (k === 0) { hz = 1.3; anim.reset(hx, hz, hFace); }
      if (k >= 10 && k < 75) { hvx = 3.2; hFace = Math.PI / 2; }
      else if (k >= 95 && k < 150) { hvx = -3.2; hFace = -Math.PI / 2; }
      else hvx = 0;
      if (k === 150) hFace = Math.PI / 2;
      if (k === 158) anim.spawn();          // drops in: hero:land fires the landing ring
    },
    dash(k) {
      if (k === 20) { hFace = Math.PI / 2; anim.dash(10); vfx.dash(hx, hz, 1, 0, { obj: rig.group, ticks: 10 }); }
      if (k >= 20 && k < 30) hvx = 9; else if (k >= 80 && k < 90) hvx = -9; else hvx = 0;
      if (k === 70) hFace = -Math.PI / 2;
      if (k === 80) { anim.dash(10); vfx.dash(hx, hz, -1, 0, { obj: rig.group, ticks: 10, palette: 'ghostGold' }); }
    },
    death(k) {
      // three real kills with the real combo: a husk (size 1), a brute (1.45), a mite swarm (0.5)
      if (k === 1) foe('husk', FOE.x, FOE.z);
      for (const [at, step] of [[20, 0], [36, 1], [54, 2]]) if (k === at) anim.attack(step);
      if (k === 150) { const b = foe('brute', FOE.x + 0.35, FOE.z - 0.1); b.hp = 30; }
      for (const [at, step] of [[170, 0], [186, 1], [204, 2]]) if (k === at) anim.attack(step);
      if (k === 300) foe('mites', FOE.x + 0.15, FOE.z);
      if (k === 330) anim.attack(2);
    },
    spawn(k) {
      // the enemies' own spawn-ins call vfx.spawnPortal (husk: rose; mites: cool)
      if (k === 15) foe('husk', FOE.x + 0.4, FOE.z, { instant: false });
      if (k === 100) foe('mites', FOE.x + 0.4, FOE.z, { instant: false });
    },
    embers(k) {
      for (const [at, b] of [[15, 0], [55, 1], [95, 0], [100, 1]]) {
        if (k === at) {
          const [x, z] = BRAZIERS[b];
          vfx.embers(x, 7.5 * VOXEL, z, { n: 26, spread: 0.3, up: 1.2 });
          vfx.flash(x, 0.95, z, { color: 'flame', size: 0.7 });
        }
      }
      if (k === 130) vfx.embers(0, 0.1, 0.3, { n: 40, spread: 1.8, up: 0.8 });
    },
    flash(k) {
      if (k === 15) vfx.flash(0, 0.9, -0.2, { color: 'torch', size: 1 });
      if (k === 55) vfx.flash(-1.6, 0.8, -0.4, { color: 'sky', size: 0.8 });
      if (k === 90) vfx.flash(1.6, 0.8, -0.4, { color: 'rose', size: 0.8 });
      if (k === 125) vfx.flash(0, 1, -0.2, { color: 'flame', size: 1.3 });
    },
    shock(k) {
      if (k === 20) anim.attack(2);   // the overhead's hero:slam drives the small shockwave
      if (k === 95) {
        vfx.shockwave(0.2, -0.2, { radius: 3.2, color: 'ember', hot: 'torch' });
        vfx.flash(0.2, 0.3, -0.2, { color: 'flame', size: 0.9 });
        feedback.shake(4, 260);
      }
    },
    pickup(k) {
      if (k % 30 === 5 && gemShow >= 1 && k < 90) vfx.twinkle(gemPos.x + 0.1, gemPos.y + 0.35, gemPos.z, { color: 'torch' });
      if (k >= 40 && k < 88) { hvx = 2.6; hFace = Math.PI / 2; } else hvx = 0;
      if (k === 88) { gemShow = 0; vfx.sparkle(gemPos.x, gemPos.y + 0.2, gemPos.z); feedback.flash('gold', 60, 0.12); }
      if (k === 140) { gemPop = 0; gemShow = 0.01; vfx.twinkle(gemPos.x, gemPos.y + 0.2, gemPos.z, { size: 1.5 }); }
    },
    ambient(k) {
      if (k === 110) { startAmbient('collapse'); say('PRESET COLLAPSE'); }
      if (k === 220) { startAmbient('boss'); say('PRESET BOSS'); }
    },
    stress(k) {
      // a fountain that keeps about stressN particles alive: ~stressN/life spawned per second
      const life = 1.0;
      const perTick = Math.ceil(stressN / (life * 60));
      if (k < REEL[idx].dur - 70) {
        for (let n = 0; n < perTick; n++) {
          const a = srnd() * Math.PI * 2, s = 1.5 + srnd() * 2.5;
          const i = vfx.core.add(0, 0.2, -0.3, Math.sin(a) * s, 5 + srnd() * 3, Math.cos(a) * s * 0.7,
            life * (0.8 + srnd() * 0.4), n % 5 ? 1 : 2, n % 3 ? 'spark' : 'sparkCool', n % 4 ? vfx.core.SPRITE : vfx.core.CUBE);
          if (i < 0) break;
          vfx.core.P.grav[i] = 9; vfx.core.P.bounce[i] = 0.4; vfx.core.P.floorY[i] = 0.02; vfx.core.P.pop[i] = 1;
        }
      }
      if (k > 60 && k < REEL[idx].dur - 70) { fpsMin = Math.min(fpsMin, loop.fps); fpsAcc.push(loop.fps); if (fpsAcc.length > 400) fpsAcc.shift(); }
    },
  };
  const gemPos = new THREE.Vector3(0.9, 0.35, 0.1);

  // a swing connects: strike every real enemy in reach through combat (hero:swing = first active tick)
  function onSwing(e) {
    const id = REEL[idx].id;
    if (id !== 'hit' && id !== 'death') return;
    const step = Math.max(0, Math.min(2, e.step | 0));
    const spec = COMBO[step];
    vfx.later(step === 2 ? 3 : 1, () => {       // the overhead lands 3 ticks after its swing starts
      const hits = [];
      for (const t of near(step === 2 ? 1.45 : 1.3)) { const h = strike(t, { x: hx, z: hz }, spec, { step }); if (h) hits.push(h); }
      applyImpact(hits, spec);
    });
  }

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      display.setZoom(zoom);
      loop.setTimeScale(SLOWS[slowIdx]);
      look.mood('crypt');

      const floor = voxelMesh('look.floor'); floor.position.set(0, 0, -5); root.add(floor);
      const wall = voxelMesh('look.wall'); wall.position.set(0, 0, -5); root.add(wall);
      for (const [x, z] of BRAZIERS) {
        const b = voxelMesh('look.brazier'); b.position.set(x, 0, z); root.add(b);
        look.torch(b, { y: 1.3, color: 'flame', intensity: 1.6, radius: 7 });
        braziers.push(b);
      }
      const rub = voxelMesh('look.rubble'); rub.position.set(-4.2, 0, 1.4); root.add(rub);
      const bones = voxelMesh('look.bones'); bones.position.set(3.9, 0, 1.2); bones.rotation.y = 0.7; root.add(bones);

      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: hx, z: hz, yaw: hFace, floorY: 0 });
      skel = voxelMesh('look.skeleton', { ownMaterial: true });
      skel.rotation.y = -Math.PI / 2 + 0.25;
      root.add(skel);
      gem = voxelMesh('vfx.gem');
      root.add(gem);
      // the real enemies and combat effects (2D marks, damage numbers; particles go to vfx)
      world.hero = null;
      foes = createEnemies(root, { bounds: { minX: -5, maxX: 5, minZ: -3.5, maxZ: 2.5 } });
      cfx = createCombatFx(root, { numbers: true });

      offs = [
        events.on('hero:swing', onSwing),
        events.on('hero:step', (e) => { if (REEL[idx].id === 'dust' || REEL[idx].id === 'pickup') vfx.step(e.x, e.z, { dx: Math.sin(e.yaw), dz: Math.cos(e.yaw) }); }),
        events.on('hero:land', (e) => vfx.land(e.x, e.z)),
        events.on('hero:slam', (e) => {
          if (REEL[idx].id !== 'shock') return;
          vfx.shockwave(e.x + Math.sin(e.yaw) * 0.9, e.z + Math.cos(e.yaw) * 0.9, { radius: 1.5 });
          feedback.hitstop(70); feedback.shake(3, 160);
        }),
      ];
      begin(idx);
    },

    exit() {
      offs.forEach((f) => f());
      cfx?.dispose(); foes?.dispose(); cfx = foes = null;
      loop.setTimeScale(1);
      look.mood('crypt');
    },

    frame() {
      const k = input.ui.key;
      if (k('ArrowRight') || k('KeyD')) { begin(idx + 1); say(REEL[idx].label); }
      if (k('ArrowLeft') || k('KeyA')) { begin(idx - 1); say(REEL[idx].label); }
      const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'];
      digits.forEach((d, i) => { if (k(d) && i < REEL.length) { begin(i); say(REEL[i].label); } });
      if (k('Space') || k('KeyJ')) { begin(idx); say('REPLAY'); }
      if (k('KeyL')) { hold = !hold; say(hold ? 'HOLD THIS EFFECT' : 'AUTO-ADVANCE'); }
      if (k('KeyB')) { ambientOn = !ambientOn; startAmbient(ambPreset); say(ambientOn ? 'AMBIENT ON' : 'AMBIENT OFF'); }
      if (k('KeyZ')) { zoom = zoom >= 3 ? 1 : zoom + 1; display.setZoom(zoom); say(`ZOOM ${zoom}X`); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) hud = !hud;
    },

    tick() {
      const e = REEL[idx];
      RUN[e.id](t, e);
      foes.tick();
      cfx.tick();
      // hero
      hx += hvx * DT;
      hx = Math.max(-3.6, Math.min(3.6, hx));
      anim.tick({ x: hx, z: hz, face: hFace, vx: hvx, vz: 0, speed: Math.abs(hvx) });
      // skeleton reactions
      if (skelFlash > 0) skelFlash--;
      skelKnock *= 0.8;
      if (skelShow < 1 && skelVisible) skelShow = Math.min(1, skelShow + 1 / 10);
      if (gemPop >= 0) { gemPop++; gemShow = Math.min(1, gemPop / 10); if (gemPop > 10) gemPop = -1; }
      t++;
      if (t >= e.dur) begin(hold ? idx : idx + 1);
    },

    render(alpha) {
      const time = (loop.tick + alpha) * DT;
      display.setCameraTarget(0, 0.55, -0.35);
      anim.render(alpha);
      foes.render(alpha);
      cfx.render(alpha);
      for (const g of rig.ghosts) g.group.visible = false;   // the reel shows vfx's afterimages, not the hero's own
      // skeleton: pops in with a squash-stretch overshoot, flashes white when hit
      skel.visible = skelVisible;
      const s = skelShow;
      const pop = s >= 1 ? 1 : s < 0.5 ? s * 2 * 1.25 : 1.25 - (s - 0.5) * 0.5;
      const sq = s >= 1 ? 1 : 1 / Math.sqrt(Math.max(0.2, pop));
      skel.scale.set(sq, pop, sq);
      skel.position.set(SKEL.x + skelKnock, 0, SKEL.z);
      look.snap(skel.position);
      skelMat().value = skelFlash > 0 ? 1 : 0;
      // gem bobs in whole texels
      gem.visible = gemShow > 0;
      const gs = gemShow >= 1 ? 1 : gemShow;
      gem.scale.setScalar(Math.max(0.01, gs < 1 ? gs * 1.2 : 1));
      gem.position.set(gemPos.x, gemPos.y + (Math.floor(time * 3) % 2) * (1 / 32) + Math.sin(time * 2) * 0.04, gemPos.z);
      gem.rotation.y = Math.floor(time * 4) * (Math.PI / 8);
      gem.visible = gem.visible && REEL[idx].id === 'pickup';
      look.snap(gem.position);
    },

    ui(g) {
      const W = display.width, H = display.height;
      cfx.ui(g);
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, 64, 'gold', { align: 'center', outline: 'ink' });
      if (!hud) return;
      const e = REEL[idx];
      drawText(g, 'VFX REEL', 6, 6, 'mist', { shadow: 'ink' });
      drawText(g, `${idx + 1}/${REEL.length}`, 6 + textWidth('VFX REEL') + 6, 6, 'slate', { shadow: 'ink' });
      drawText(g, e.label, 6, 17, 'bone', { outline: 'ink', scale: 2 });
      drawText(g, e.note, 6, 36, 'fog', { shadow: 'ink' });
      // progress through this entry
      const bw = 120, p = Math.min(1, t / e.dur);
      g.fillStyle = css('ink'); g.fillRect(6, 46, bw + 2, 4);
      g.fillStyle = css(hold ? 'gold' : 'slate'); g.fillRect(7, 47, Math.round(bw * p), 2);
      if (hold) drawText(g, 'HOLD', 6 + bw + 6, 45, 'gold', { shadow: 'ink' });
      if (e.id === 'ambient') drawText(g, `PRESET ${ambPreset.toUpperCase()}`, 6, 54, 'flame', { shadow: 'ink' });
      // effect list, right edge
      const lx = W - 70;
      REEL.forEach((r, i) => {
        const key = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', '-', '='][i];
        const on = i === idx;
        if (on) { g.fillStyle = css('ink'); g.fillRect(lx - 3, 5 + i * 9, 68, 9); }
        drawText(g, `${key} ${r.id.toUpperCase()}`, lx, 6 + i * 9, on ? 'gold' : 'slate', { shadow: on ? null : 'ink' });
      });
      // pool stats
      const st = vfx.stats();
      const line1 = `PARTICLES ${st.particles}/${st.cap}  SHAPES ${st.shapes}  FPS ${Math.round(loop.fps)}`;
      const line2 = `SIM ${st.tickMs.toFixed(2)}MS  UPLOAD ${st.renderMs.toFixed(2)}MS  DROPPED ${st.dropped}`;
      drawText(g, line1, W - 6, H - 34, e.id === 'stress' ? 'bone' : 'mist', { align: 'right', shadow: 'ink' });
      drawText(g, line2, W - 6, H - 25, 'slate', { align: 'right', shadow: 'ink' });
      if (e.id === 'stress' && fpsAcc.length) {
        const avg = fpsAcc.reduce((a, b) => a + b, 0) / fpsAcc.length;
        drawText(g, `FPS AVG ${avg.toFixed(0)}  MIN ${fpsMin.toFixed(0)}`, W - 6, H - 43, 'gold', { align: 'right', shadow: 'ink' });
      }
      const help = '< > EFFECT  SPACE REPLAY  L HOLD  B AMBIENT  Z ZOOM  T SLOW  H HIDE';
      const w = textWidth(help) + 8;
      g.fillStyle = css('ink');
      g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
      drawText(g, help, W / 2, H - 10, 'slate', { align: 'center' });
    },

    state() {
      const st = vfx.stats();
      return { showcase: { id: 'vfx', effect: REEL[idx].id, index: idx, t, dur: REEL[idx].dur, hold, zoom: display.zoom,
        ambient: ambientOn ? ambPreset : null, particles: st.particles, shapes: st.shapes, dropped: st.dropped,
        tickMs: st.tickMs, renderMs: st.renderMs, fps: Math.round(loop.fps), effects: REEL.map((r) => r.id) } };
    },
  };
}
