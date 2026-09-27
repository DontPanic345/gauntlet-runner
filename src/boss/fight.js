// The boss fight (piece `boss`): the arena, the Warden, and everything around the fight itself:
// the intro sequence (dark arena, the footsteps, the eyes, the roar, the name card), the boss bar,
// the phase banners, the hero's shockwave and telegraph layers, the camera, and the death
// sequence. `Warden` (warden.js) is the fighter; this file is the director.
//
//   const fight = new BossFight(root, { hero, ctl, cw, sys, heroRig, phase: 1, intro: true });
//   tick: fight.tick()      render: fight.render(alpha)   (after anim.render)     ui: fight.ui(g)
//   events: boss:intro, boss:fightStart, boss:phase {to}, boss:hurt, boss:deathHit, boss:defeated, boss:cleared

import * as THREE from 'three';
import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css, hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { voxelMesh, VOXEL as V } from '../render/voxel/index.js';
import { CameraRig } from '../render/camera.js';
import { vfx } from '../vfx/index.js';
import { ramp, F_BOUNCE, F_TWINKLE } from '../vfx/particles.js';
import { BossArena, Zone, Rings, ARENA_R } from './arena.js';
import { Warden, TUNE } from './warden.js';
import './sfx.js';
import { drawBossBar } from '../ui/widgets/bossbar.js';   // hud piece draws the bar

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const hash = (x, y = 0) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

export const INTRO_TICKS = 372;
const NAME = 'THE WARDEN', SUB = 'JAILER OF THE DEEP';
const PHASE_TEXT = { 2: ['THE CHAIN IS SHED', 'HE FIGHTS WITH THE MAUL'], 3: ['THE CAGE CLOSES', 'HIS DEAD ARE CALLED UP'] };

export class BossFight {
  constructor(root, { hero, ctl, cw, sys, heroRig = null, phase = 1, intro = false, hpMul = 1, knobs = { aggression: 1 }, health = null, zoom = 1, cam = null } = {}) {
    this.root = root; this.hero = hero; this.ctl = ctl; this.cw = cw; this.sys = sys; this.heroRig = heroRig; this.knobs = knobs;
    this.state = intro ? 'intro' : 'fight';
    this.t = 0; this.introT = 0; this.dt = 0; this.wonT = 0;
    this.arena = new BossArena(root, { lit: !intro });
    this.zone = new Zone(root); this.rings = new Rings(root);
    this.decals = this.makeDecals();
    this.boss = new Warden(this, 0, intro ? -2.6 : -2.2, { yaw: 0, hpMul });
    this.playZoom = zoom; this.camHome = cam ?? [0, -0.2];
    this.camRig = new CameraRig({ bounds: cam ? { minX: cam[0] - 0.2, maxX: cam[0] + 0.2, minZ: cam[1] - 0.2, maxZ: cam[1] + 0.2 } : { minX: -1.4, maxX: 1.4, minZ: -1.8, maxZ: 0.6 } });
    this.camRig.reset(this.camHome[0], this.camHome[1]);
    this.cine = null;                       // {zoom, x, y, z} while a cutscene owns the camera
    this.bars = 0; this.fade = 0; this.flashA = 0;
    this.hpShown = 1; this.hpGhost = 1; this.hpFlash = 0; this.barFill = intro ? 0 : 1;
    this.banner = null; this.status = { text: '', t: 0 };
    this.slow = { t: 0, s: 1 }; this.baseScale = null;
    this.husks = [];
    this.key = null; this.column = null; this.helm = null;
    this.ballV = null; this.cleared = false;
    this.zoomWas = display.zoom;
    // light: capture the mood's values so the intro can darken the room and give it back
    look.mood?.('crypt');
    const L = display.lights; this.baseLight = { hemi: L.hemi.intensity, key: L.key.intensity, rim: L.rim.intensity };
    this.dark = intro ? 0.8 : 0;
    vfx.ambient.mood(intro ? 'off' : 'boss');
    this.applyLight();
    this.offs = [];
    const on = (n, fn) => this.offs.push(events.on(n, fn));
    on('input:press', (e) => { if (this.state === 'intro' && this.introT > 50 && (e.action === 'interact' || e.action === 'attack' || e.action === 'dash') && this.canSkip) this.skipIntro(); });
    this.canSkip = false;
    if (intro) {
      this.boss.eyeK = 0; this.boss.override = { headX: 0.8, armRX: 0.2, armLX: 0.2, lean: 0.1 };
      ctl.teleport(0, 5.2, Math.PI); ctl.stun(INTRO_TICKS);
      this.boss.tp = this.boss.defaultPose(); Object.assign(this.boss.pose, { headX: 0.8 });
      this.emitOnce('intro');
    } else {
      this.startFight(phase);
    }
  }
  emitOnce(n, e = {}) { events.emit(`boss:${n}`, { fight: this, ...e }); }

  // ---- fight start (also the showcase's phase start) ------------------------------------------------
  startFight(phase = 1) {
    const b = this.boss;
    b.eyeK = 1; b.phase = phase; b.state = 'move'; b.st = 0; b.cool = 50; b.override = null;
    b.queue = [];
    if (phase >= 2) { b.hp = Math.round(b.maxHp * (phase === 2 ? 0.66 : 0.33)); b.crackBackK = phase >= 3 ? 1 : 0; }
    if (phase >= 3) { this.arena.raiseCage(); this.arena.cageT = 999; }
    this.arena.ignite(0, 0);
    for (const br of this.arena.braziers) { br.lit = 1; br.target = 1; br.delay = 0; }
    this.dark = 0; this.barFill = 1; this.state = 'fight';
    vfx.ambient.mood('boss');
    this.hpShown = this.hpGhost = b.hp / b.maxHp;
    this.applyLight();
    this.emitOnce('fightStart', { phase });
  }

  // ---- services for the Warden -----------------------------------------------------------------------------
  hurtHero(amount, src, tag) {
    if (this.state === 'dying' || this.state === 'won') return { ok: false, reason: 'over' };
    const r = this.hero.hurt(amount, src);
    if (r && r.ok) events.emit('boss:heroHit', { tag, x: this.hero.x, z: this.hero.z });
    return r;
  }
  ring(o) {
    const speed = o.speed ?? 3.6;
    this.rings.spawn({ x: o.x, z: o.z, r0: o.r0, speed, dmg: o.dmg, tag: o.tag, style: o.style ?? 'ember', onHit: o.dmg > 0 ? (r) => this.hurtHero(r.dmg, { x: r.x, z: r.z }, r.tag + 'Ring') : null });
    events.emit('boss:ring', { x: o.x, z: o.z });
  }
  clang(boss, hit, why) {
    vfx.hit({ x: boss.x - (hit.dx || 0) * 0.6, y: 1.6 + Math.random() * 0.6, z: boss.z - (hit.dz || 0) * 0.6, dx: -(hit.dx || 0), dz: -(hit.dz || 0), power: 0.7, style: 'white,torch,gold,flame' });
    feedback.shake(1, 60);
    events.emit('boss:clang', { why });
  }
  onBossHit(boss, hit, armored) {
    this.hpFlash = 8;
    if (armored) {
      vfx.hit({ x: boss.x - (hit.dx || 0) * 0.7, y: 1.7, z: boss.z - (hit.dz || 0) * 0.7, dx: -(hit.dx || 0), dz: -(hit.dz || 0), power: 0.6, style: 'white,torch,gold,flame' });
      events.emit('boss:clang', { armored: true });
    } else {
      vfx.hit({ x: boss.x - (hit.dx || 0) * 0.7, y: 1.9, z: boss.z - (hit.dz || 0) * 0.7, dx: -(hit.dx || 0), dz: -(hit.dz || 0), power: 1.4, style: 'gold' });
      vfx.embers({ x: boss.x, y: 2, z: boss.z, n: 6 });
      feedback.shake(1.5, 100);
      events.emit('boss:crit', {});
    }
  }
  huskCount() { return this.sys ? this.sys.alive().filter((e) => e.kind === 'husk').length : 0; }
  spawnHusk(x, z) { if (this.sys) this.sys.spawn('husk', x, z, { hpMul: 0.75 }); }
  setSlow(s, ticks) { this.slow = { t: ticks, s }; if (this.baseScale === null) this.baseScale = loop.timeScale; loop.setTimeScale(s); }
  say(text) { this.status = { text, t: 70 }; }
  roar(boss, to) {
    const b = boss;
    events.emit('boss:roar', { big: true, to });
    feedback.flash('white', 200, 0.5); feedback.shake(9, 700);
    look.flash(b.x, 3, b.z, { color: 'ember', ms: 500, intensity: 4, radius: 12 });
    vfx.shockwave({ x: b.x, z: b.z, radius: 6, style: 'ember' });
    vfx.embers({ x: b.x, y: 3.4, z: b.z, n: 30 });
    vfx.flash({ x: b.x, y: 3, z: b.z, color: 'flame', radius: 4, ms: 400 });
    // the roar throws you back: a ring that shoves, and does not hurt
    this.rings.spawn({ x: b.x, z: b.z, r0: 1.0, speed: 8, dmg: 0, style: 'ember', h: 4, onHit: (r) => { const dx = this.hero.x - r.x, dz = this.hero.z - r.z, d = Math.hypot(dx, dz) || 1; this.ctl.impulse(dx / d * 9, dz / d * 9); events.emit('boss:shove', {}); return { ok: true }; } });
    this.arena.braziers.forEach((br) => this.arena.flare(br));
    this.banner = { title: PHASE_TEXT[to][0], sub: PHASE_TEXT[to][1], t: 0, len: 150, color: to === 3 ? 'red' : 'ember' };
    events.emit('boss:phaseBanner', { to });
  }
  floorCrack(x, z, r) {
    const d = this.decals; if (!d) return;
    const n = 7 + ((Math.random() * 3) | 0);
    for (let k = 0; k < n; k++) {
      let a = (k / n) * TAU + Math.random() * 0.5, px = x + Math.sin(a) * r * 0.5, pz = z + Math.cos(a) * r * 0.5;
      const len = 6 + ((Math.random() * 10) | 0);
      for (let i = 0; i < len; i++) {
        a += (Math.random() - 0.5) * 0.7; px += Math.sin(a) * V; pz += Math.cos(a) * V;
        if (Math.hypot(px, pz) > ARENA_R + 0.5) break;
        d.cells.push({ x: Math.round(px / V) * V, z: Math.round(pz / V) * V, b: this.t + i * 1.4 });
      }
    }
    for (let i = 0; i < 26; i++) { const a = Math.random() * TAU, rr = Math.random() * r * 0.8; d.cells.push({ x: Math.round((x + Math.sin(a) * rr) / V) * V, z: Math.round((z + Math.cos(a) * rr) / V) * V, b: this.t, scorch: true }); }
    if (d.cells.length > d.cap) d.cells.splice(0, d.cells.length - d.cap);
  }
  makeDecals() {
    const cap = 1400;
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(V, 0.012, V), new THREE.MeshBasicMaterial({ color: 0xffffff }), cap);
    mesh.frustumCulled = false; mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    look.noOutline(mesh); this.root.add(mesh);
    const C = {}; for (const k of ['ember', 'red', 'blood', 'ink', 'night', 'flame']) C[k] = new THREE.Color(hex(k));
    return { mesh, cap, cells: [], C };
  }

  // ---- intro ---------------------------------------------------------------------------------------------------
  skipIntro() {
    if (this.state !== 'intro') return;
    this.arena.ignite(0, 0); for (const br of this.arena.braziers) { br.lit = 1; br.target = 1; br.delay = 0; }
    this.boss.x = 0; this.boss.z = -2.2; this.boss.px = 0; this.boss.pz = -2.2;
    this.ctl.stunT = 0; this.cine = null; display.setZoom(this.playZoom);
    this.bars = 0; this.fade = 0; this.banner = null;
    this.startFight(1); this.camRig.reset(this.camHome[0], this.camHome[1]);
  }
  tickIntro() {
    const t = ++this.introT, b = this.boss;
    this.canSkip = t > 50;
    // the room is dark: it comes up with the roar
    const P = b.pose;
    if (t === 1) { events.emit('boss:beat', {}); }
    if (t === 30 || t === 66) events.emit('boss:beat', {});
    // a slow, heavy step forward
    if (t >= 88 && t <= 122) { b.walk = 0.55; b.z += 0.55 / 60; b.tp = b.defaultPose(); }
    else b.walk *= 0.9;
    if (t === 96 || t === 116) { events.emit('boss:step', {}); feedback.shake(1.8, 140); vfx.dust({ x: b.x + (t === 96 ? 0.4 : -0.4), z: b.z, dx: 0, dz: -1, n: 6, size: 5, speed: 0.9 }); }
    // the head comes up
    if (t >= 118 && t < 172) b.override = { headX: lerp(0.8, 0.15, sstep((t - 118) / 40)), armRX: 0.2, armLX: 0.2, lean: 0.1 };
    if (t === 150) { b.eyeK = 1; b.eyeBoost = 1.5; events.emit('boss:eyes', {}); look.flash(b.x, 3.4, b.z + 0.6, { color: 'ember', ms: 500, intensity: 2.6, radius: 6 }); vfx.flash({ x: b.x, y: 3.5, z: b.z + 0.8, color: 'ember', radius: 1.6, ms: 300 }); feedback.flash('ember', 90, 0.2); }
    if (t > 150 && t < 172 && t % 5 === 0) vfx.embers({ x: b.x, y: 3.4, z: b.z + 0.7, n: 3 });
    // rears back and roars
    if (t >= 172 && t < 236) {
      const k = sstep((t - 172) / 10), h = t > 236 - 14 ? sstep((236 - t) / 14) : 1;
      b.override = { headX: -0.85 * k * h + 0.15 * (1 - k * h), armRZ: 1.15 * k * h + 0.16, armLZ: 1.15 * k * h + 0.16, armRX: 0.2, armLX: 0.2, lean: -0.32 * k * h + 0.1, rate: 0.3 };
    }
    if (t === 182) {
      events.emit('boss:roar', { big: true });
      feedback.flash('white', 220, 0.55); feedback.shake(10, 1400);
      b.eyeBoost = 2;
      vfx.shockwave({ x: b.x, z: b.z, radius: 7, style: 'ember' }); vfx.embers({ x: b.x, y: 3.6, z: b.z + 0.5, n: 36 });
      this.rings.spawn({ x: b.x, z: b.z, r0: 1, speed: 9, dmg: 0, style: 'ember', h: 3, onHit: null });
      this.arena.ignite(4, 7);
      vfx.ambient.mood('boss');
      look.flash(b.x, 3, b.z, { color: 'flame', ms: 700, intensity: 4, radius: 12 });
    }
    if (t > 182 && t < 232 && t % 4 === 0) { vfx.embers({ x: b.x + (Math.random() - 0.5) * 1.6, y: 3 + Math.random(), z: b.z + 0.5, n: 4 }); }
    if (t >= 182 && t <= 232) this.dark = lerp(0.8, 0, sstep((t - 182) / 50));
    // name card
    if (t === 238) { events.emit('boss:nameCard', {}); feedback.shake(7, 300); feedback.hitstop(60); this.cardT = 0; b.eyeBoost = 1; }
    if (t > 238) this.cardT = t - 238;
    if (t >= 236) { b.override = null; }
    // gameplay camera returns; hero control returns, the bar fills
    if (t === 332) { this.cine = null; display.setZoom(this.playZoom); this.camRig.reset(this.camHome[0], this.camHome[1]); events.emit('boss:barFill', {}); }
    if (t >= 332) { this.barFill = clamp((t - 332) / 34, 0, 1); }
    if (t >= 350) this.ctl.stunT = 0;
    if (t >= INTRO_TICKS) { this.introDone(); }
  }
  introDone() { this.state = 'fight'; this.boss.setState('move'); this.boss.cool = 70; this.boss.override = null; this.barFill = 1; this.dark = 0; this.canSkip = false; this.emitOnce('fightStart', { phase: 1 }); }
  introCam(t) {
    // hard cuts between four shots
    if (t < 30) return { zoom: 1, x: 0, y: 0.55, z: 3.9 };
    if (t < 120) return { zoom: 1, x: 0, y: 0.55, z: lerp(3.9, -0.4, sstep((t - 30) / 90)) };
    if (t < 172) return { zoom: 3, x: 0, y: 3.15, z: this.boss.z - 0.55 + Math.sin(t * 0.2) * 0.01 };
    if (t < 332) return { zoom: 2, x: 0, y: 1.75, z: this.boss.z - 0.55 };
    return null;
  }

  // ---- death ----------------------------------------------------------------------------------------------------
  beginDeath() {
    if (this.state === 'dying' || this.state === 'won') return;
    const b = this.boss;
    this.state = 'dying'; this.dt = 0;
    b.state = 'dying'; b.cancelAttack(); this.rings.clear(); this.zone.clear();
    b.dead = true; b.crackForce = true; b.eyeBoost = 3;
    this.sys?.kill('all');
    if (this.hero.iframeT !== undefined) this.hero.iframeT = 900;
    feedback.hitstop(280); feedback.flash('white', 320, 0.9); feedback.shake(9, 700);
    this.setSlow(0.22, 40);
    this.cine = { zoom: 2, x: 0, y: 1.9, z: b.z - 0.5 };
    events.emit('boss:deathHit', { x: b.x, z: b.z });
    // the maul flies out of his hand
    const B = b.ball; B.mode = 'free';
    this.ballV = { x: (Math.random() - 0.5) * 6, y: 7, z: 4 };
    B.x = B.px = b.handW.x; B.y = B.py = b.handW.y; B.z = B.pz = b.handW.z;
    this.debris(b.x, 2.4, b.z, 34, ['stone', 'slate', 'mist', 'stoneDark', 'bone'], 6, 7);
    vfx.hit({ x: b.x, y: 2.3, z: b.z + 0.6, dx: 0, dz: 1, power: 3, style: 'hit' });
    vfx.flash({ x: b.x, y: 2.3, z: b.z + 0.6, color: 'torch', radius: 1.6, ms: 200 });
    vfx.embers({ x: b.x, y: 2.3, z: b.z, n: 30 });
  }
  debris(x, y, z, n, colors, speed = 5, size = 6, up = 4) {
    const pool = vfx.pool; if (!pool) return;
    const r = ramp(colors.join(','));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = speed * (0.35 + Math.random() * 0.75);
      const rr = ramp([colors[(Math.random() * colors.length) | 0], colors[(Math.random() * colors.length) | 0]].join(','));
      pool.add(x + (Math.random() - 0.5) * 0.9, y + (Math.random() - 0.3) * 1.4, z + (Math.random() - 0.5) * 0.6, Math.sin(a) * s, up * (0.4 + Math.random()) + Math.random() * 2, Math.cos(a) * s * 0.8, 1.6 + Math.random() * 1.6, size * (0.6 + Math.random() * 0.8), size * 0.5, rr, F_BOUNCE, 0.985, 16);
    }
  }
  tickDeath() {
    const t = ++this.dt, b = this.boss, hero = this.hero;
    this.zone.clear();
    if (this.slow.t > 0 && --this.slow.t === 0) { loop.setTimeScale(t < 100 ? 0.55 : 1); if (t >= 100) this.baseScale = null; }
    // the maul, tumbling
    if (this.ballV) {
      const B = b.ball, v = this.ballV;
      B.x += v.x / 60; B.z += v.z / 60; B.y += v.y / 60; v.y -= 22 / 60;
      if (B.y < 0.6) { B.y = 0.6; if (v.y < -2) { v.y = -v.y * 0.35; v.x *= 0.6; v.z *= 0.6; vfx.dust({ x: B.x, z: B.z, n: 6, size: 5, speed: 0.9 }); feedback.shake(2, 100); } else { v.y = 0; v.x *= 0.85; v.z *= 0.85; } }
      const d = Math.hypot(B.x, B.z); if (d > ARENA_R - 0.4) { B.x *= (ARENA_R - 0.4) / d; B.z *= (ARENA_R - 0.4) / d; v.x = -v.x * 0.4; v.z = -v.z * 0.4; }
    }
    // ---- 0..30: he reels upright, roaring in pain
    if (t <= 30) {
      const k = sstep(t / 8);
      b.override = { headX: -0.9 * k, armRZ: 1.3 * k, armLZ: 1.3 * k, armRX: 0.1, armLX: 0.1, lean: -0.35 * k, dip: 0, rate: 0.25 }; b.tflash = 0.5 + 0.5 * ((t >> 1) & 1);
      if (t % 4 === 0) vfx.embers({ x: b.x, y: 2.4, z: b.z, n: 5 });
    }
    // ---- 30..100: he sinks to his knees; the armour comes off in pieces; beats of light
    else if (t <= 100) {
      const k = sstep((t - 30) / 20);
      b.override = { dip: -0.72 * k, legA: -1.1 * k, legB: 1.0 * k, lean: lerp(-0.35, 0.55, k), headX: lerp(-0.9, 0.85, k), armRZ: lerp(1.3, 0.25, k), armLZ: lerp(1.3, 0.25, k), armRX: lerp(0.1, 0.5, k), armLX: lerp(0.1, 0.5, k), rate: 0.2 };
      b.tflash = 0.35 + 0.35 * Math.sin(t * 0.5);
      if ((t - 30) % 14 === 0) {
        const n = (t - 30) / 14;
        events.emit('boss:deathBeat', {});
        vfx.shockwave({ x: b.x, z: b.z, radius: 3 + n * 0.5, style: 'ember' });
        this.rings.spawn({ x: b.x, z: b.z, r0: 0.8, speed: 5 + n, dmg: 0, style: 'ember', h: 2, onHit: null, max: 4 + n });
        look.flash(b.x, 2.2, b.z, { color: 'ember', ms: 320, intensity: 3.5, radius: 8 });
        feedback.shake(3 + n * 1.2, 320);
        this.debris(b.x, 2.2, b.z, 14, ['stone', 'slate', 'mist', 'stoneDark', 'gold'], 5 + n, 6);
        vfx.embers({ x: b.x, y: 2, z: b.z, n: 14 });
        vfx.pickup({ x: b.x + (Math.random() - 0.5) * 2, y: 0.3, z: b.z + 0.5, style: 'gold' });
        this.flashA = 0.35;
      }
    }
    // ---- 100..136: he rises into the light
    else if (t <= 136) {
      const k = sstep((t - 100) / 22);
      b.override = { dip: -0.72 * (1 - k), legA: -1.1 * (1 - k), legB: 1.0 * (1 - k), lean: lerp(0.55, -0.2, k), headX: lerp(0.85, -0.85, k), armRZ: lerp(0.25, 0.9, k), armLZ: lerp(0.25, 0.9, k), armRX: lerp(0.5, -2.7, k), armLX: lerp(0.5, -2.7, k), rate: 0.3 };
      b.tflash = (t >> 1) & 1 ? 1 : 0.2;
      if (t === 100) { this.column = { t: 0 }; events.emit('boss:deathBeat', {}); }
      feedback.shake(4 + (t - 100) * 0.25, 120);
      if (t % 3 === 0) { vfx.embers({ x: b.x + (Math.random() - 0.5) * 1.6, y: 0.5, z: b.z + (Math.random() - 0.5) * 1.2, n: 6 }); this.flashA = 0.15 + (t - 100) * 0.014; }
      if (t % 6 === 0) vfx.flash({ x: b.x, y: 2.5, z: b.z, color: 'torch', radius: 3 + (t - 100) * 0.1, ms: 200 });
    }
    // ---- 136: the burst
    if (t === 136) {
      events.emit('boss:deathBurst', {});
      feedback.hitstop(140); feedback.flash('white', 520, 1); feedback.shake(15, 900);
      b.gone = true; b.g.visible = false; b.shadow.visible = false; b.eyeLight?.remove(); b.eyeLight = null; b.fillLight?.remove(); b.fillLight = null;
      if (b.body) { this.cw.remove(b.body); b.body = null; }
      this.debris(b.x, 1.8, b.z, 70, ['stoneDark', 'stone', 'slate', 'mist', 'bone', 'red'], 9, 8, 6);
      this.debris(b.x, 2.4, b.z, 80, ['gold', 'torch', 'flame', 'white'], 8, 4, 8);
      for (let i = 0; i < 4; i++) vfx.death({ x: b.x, y: 0.8 + i * 0.9, z: b.z, power: 3.4, colors: ['gold', 'torch', 'flame', 'stone', 'bone'] });
      vfx.hit({ x: b.x, y: 2, z: b.z, dx: 0, dz: 1, power: 3.5, style: 'gold' });
      vfx.shockwave({ x: b.x, z: b.z, radius: 8, style: 'ember' });
      vfx.flash({ x: b.x, y: 2.2, z: b.z, color: 'gold', radius: 3, ms: 500, screen: 0.4 });
      look.flash(b.x, 3, b.z, { color: 'gold', ms: 900, intensity: 5, radius: 14 });
      this.rings.spawn({ x: b.x, z: b.z, r0: 0.6, speed: 9, dmg: 0, style: 'gold', h: 4, onHit: null });
      this.rings.spawn({ x: b.x, z: b.z, r0: 0.4, speed: 5.5, dmg: 0, style: 'ember', h: 3, onHit: null });
      this.arena.golden = 1; this.arena.dropCage();
      for (const br of this.arena.braziers) { this.arena.flare(br); }
      this.column = { t: 0, fade: true };
      this.floorCrack(b.x, b.z, 2.4);
      this.helm = voxelMesh('boss.head'); this.helm.position.set(b.x, 1.6, b.z); this.root.add(this.helm); this.helmV = { y: 6, x: (Math.random() - 0.5) * 1.5, z: 1.4, spin: 0.1 };
      this.setSlow(0.4, 46);
      this.baseScale = null;
      this.cine = { zoom: 2, x: 0, y: 1.2, z: b.z - 0.2 };
      vfx.ambient.set({ embers: 150, dust: 24, rise: 1.0 });
    }
    if (t > 136) {
      if (this.helm) {
        const h = this.helmV; h.y -= 20 / 60; this.helm.position.y += h.y / 60; this.helm.position.x += h.x / 60; this.helm.position.z += h.z / 60;
        this.helm.rotation.x += 0.09; this.helm.rotation.z += h.spin;
        if (this.helm.position.y < 0.5) { this.helm.position.y = 0.5; if (h.y < -1.5) { h.y = -h.y * 0.4; h.x *= 0.6; h.z *= 0.6; h.spin *= 0.6; vfx.dust({ x: this.helm.position.x, z: this.helm.position.z, n: 5, size: 5, speed: 0.8 }); feedback.shake(2, 100); } else { h.y = 0; h.x *= 0.8; h.z *= 0.8; this.helm.rotation.x += (0.35 - this.helm.rotation.x % TAU) * 0.0; } }
      }
      // a golden rain of embers off the crater
      if (t % 3 === 0) vfx.embers({ x: b.x + (Math.random() - 0.5) * 3, y: 0.2, z: b.z + (Math.random() - 0.5) * 2, n: 2 });
      if (t % 24 === 0 && t < 250) vfx.pickup({ x: b.x + (Math.random() - 0.5) * 2, y: 0.2, z: b.z + (Math.random() - 0.5) * 1.5, style: 'gold' });
    }
    // the key rises out of the crater
    if (t === 158) {
      this.key = { m: voxelMesh('boss.key'), t: 0, y: 0 };
      this.key.m.scale.setScalar(1.1); this.root.add(this.key.m);
      const anchor = new THREE.Object3D(); this.key.m.add(anchor); this.key.light = look.torch(anchor, { y: 0.2, color: 'gold', intensity: 1.4, radius: 6, haze: 1 });
      vfx.pickup({ x: b.x, y: 0.3, z: b.z, style: 'gold' }); vfx.flash({ x: b.x, y: 0.8, z: b.z, color: 'gold', radius: 3, ms: 500 });
      events.emit('boss:keyRise', {});
    }
    if (t === 176) { this.banner = { title: 'THE WARDEN FALLS', sub: 'THE WAY DOWN IS OPEN', t: 0, len: 999, color: 'gold', victory: true }; events.emit('boss:defeated', { x: b.x, z: b.z, fight: this }); }
    if (t === 196) { this.cine = null; display.setZoom(this.playZoom); this.camRig.reset(this.camHome[0], this.camHome[1]); this.ctl.stunT = 0; }
    if (t >= 200) { this.state = 'won'; this.wonT = 0; if (this.baseScale !== null) { loop.setTimeScale(this.baseScale); this.baseScale = null; } }
  }
  tickWon() {
    this.wonT++;
    const k = this.key, h = this.hero;
    if (!k || this.cleared) return;
    if (this.wonT % 30 === 0) vfx.pickup({ x: k.m.position.x, y: k.m.position.y, z: k.m.position.z, style: 'gold' });
    if (Math.hypot(h.x - k.m.position.x, h.z - k.m.position.z) < 1.0 && this.wonT > 20) {
      this.cleared = true; k.taken = 0;
      vfx.pickup({ x: k.m.position.x, y: k.m.position.y, z: k.m.position.z, style: 'gold' });
      vfx.flash({ x: k.m.position.x, y: k.m.position.y, z: k.m.position.z, color: 'gold', radius: 3, ms: 500, screen: 0.3 });
      feedback.flash('gold', 300, 0.5); feedback.shake(3, 200);
      events.emit('boss:key', { x: k.m.position.x, z: k.m.position.z });
      events.emit('boss:cleared', { fight: this });
    }
  }

  // ---- per tick ----------------------------------------------------------------------------------------------------
  tick() {
    this.t++;
    const b = this.boss;
    if (this.slow.t > 0 && this.state !== 'dying') { if (--this.slow.t === 0) { loop.setTimeScale(this.baseScale ?? 1); this.baseScale = null; } }
    if (this.state === 'intro') this.tickIntro();
    else if (this.state === 'dying') this.tickDeath();
    else if (this.state === 'won') this.tickWon();
    b.tick();
    this.zone.paint();
    this.rings.tick(this.state === 'dying' || this.state === 'won' ? null : this.hero);
    this.arena.tick();
    if (this.state === 'fight') this.camRig.tick(this.ctl);
    else if (!this.cine) this.camRig.tick(this.ctl);
    // hp bar easing
    const want = b.hp / b.maxHp;
    this.hpShown += (want - this.hpShown) * 0.4;
    if (this.hpGhost > want) this.hpGhost = Math.max(want, this.hpGhost - 0.0035); else this.hpGhost = want;
    if (this.hpFlash > 0) this.hpFlash--;
    if (this.banner) this.banner.t++;
    if (this.banner && this.banner.t > this.banner.len) this.banner = null;
    if (this.status.t > 0) this.status.t--;
    // the intro's bars, fade
    if (this.state === 'intro') {
      const t = this.introT;
      this.bars = t < 300 ? sstep(t / 24) : sstep((INTRO_TICKS - 22 - t) / 22 + 1) * 0 + sstep((332 + 22 - t) / 22);
      this.fade = t < 34 ? 1 - t / 34 : 0;
    } else if (this.state === 'dying') { this.bars = lerp(this.bars, 0.75, 0.05); } else this.bars *= 0.85;
    if (this.flashA > 0) this.flashA = Math.max(0, this.flashA - 0.02);
    // column of light
    if (this.column) { this.column.t++; }
    // key hover
    if (this.key) { const k = this.key; k.t++; k.y = lerp(k.y, 1.55, 0.04); k.m.position.set(this.boss.x, k.y + Math.sin(k.t * 0.06) * 0.1, this.boss.z + 0.2); k.m.rotation.y = k.t * 0.04; }
    // decals cool
    if (this.decals.cells.length) { /* drawn in render */ }
    // ambient
    this.applyLight();
    // hero and boss must not overlap dead husks etc. nothing else to do
  }

  applyLight() {
    const L = display.lights, k = 1 - 0.78 * this.dark, B = this.baseLight;
    L.hemi.intensity = B.hemi * k; L.key.intensity = B.key * (1 - 0.85 * this.dark); L.rim.intensity = B.rim * (1 - 0.6 * this.dark);
    for (const br of this.arena.braziers) if (br.light && this.state === 'intro') br.light.intensity = 1.15 * br.lit;
  }

  // ---- render -----------------------------------------------------------------------------------------------------------
  render(alpha) {
    const b = this.boss;
    this.arena.render(alpha); this.rings.render(alpha); b.render(alpha);
    // decals
    {
      const d = this.decals, arr = d.mesh.instanceMatrix.array, carr = d.mesh.instanceColor.array;
      let n = 0;
      for (const c of d.cells) {
        const age = this.t - c.b; if (age < 0) continue;
        const col = c.scorch ? (age < 30 ? d.C.ember : age < 90 ? d.C.red : d.C.night) : (age < 20 ? d.C.flame : age < 60 ? d.C.ember : age < 140 ? d.C.blood : d.C.ink);
        const i = n * 16;
        arr[i] = 1; arr[i + 1] = arr[i + 2] = arr[i + 3] = arr[i + 4] = 0; arr[i + 5] = 1; arr[i + 6] = arr[i + 7] = arr[i + 8] = arr[i + 9] = 0; arr[i + 10] = 1; arr[i + 11] = 0;
        arr[i + 12] = c.x; arr[i + 13] = 0.01; arr[i + 14] = c.z; arr[i + 15] = 1;
        carr[n * 3] = col.r; carr[n * 3 + 1] = col.g; carr[n * 3 + 2] = col.b; n++;
      }
      d.mesh.count = n; d.mesh.visible = n > 0; d.mesh.instanceMatrix.needsUpdate = true; d.mesh.instanceColor.needsUpdate = true;
    }
    // the column of light at his death
    this.renderColumn(alpha);
    // camera
    let c = null;
    if (this.state === 'intro') c = this.introCam(this.introT);
    else if (this.state === 'dying') c = this.cine;
    if (c) {
      if (display.zoom !== c.zoom) display.setZoom(c.zoom);
      display.setCameraTarget(c.x, c.y, c.z);
      this.heroRig?.group.position.set(0, 0, 0);
    } else {
      if (display.zoom !== this.playZoom) display.setZoom(this.playZoom);
      const off = this.camRig.render(alpha, this.ctl.at(alpha));
      this.heroRig?.group.position.set(off.x, off.y, off.z);
    }
    if (this.key) this.key.m.visible = true;
  }
  renderColumn() {
    const col = this.column;
    if (!col) { if (this.colMesh) this.colMesh.visible = false; return; }
    if (!this.colMesh) {
      const N = 900;
      this.colMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(V, V, V), new THREE.MeshBasicMaterial({ color: 0xffffff }), N);
      this.colMesh.frustumCulled = false; this.colMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * 3), 3); look.noOutline(this.colMesh); this.root.add(this.colMesh);
    }
    const m = this.colMesh, arr = m.instanceMatrix.array, carr = m.instanceColor.array, b = this.boss;
    const t = col.t, up = col.fade ? 1 : clamp(t / 30, 0, 1), fade = col.fade ? clamp(1 - t / 40, 0, 1) : 1;
    const H = 13 * up, W = (col.fade ? 1 + t * 0.09 : 0.5 + t * 0.03);
    const names = ['white', 'torch', 'gold', 'flame'], cs = names.map((n) => new THREE.Color(hex(n)));
    let n = 0;
    for (let ring = 0; ring < 8 && n < 890; ring++) {
      for (let y = 0; y < H; y += V * 2.4) {
        for (let k = 0; k < 3 && n < 890; k++) {
          const a = hash(ring * 31 + k, Math.floor(y * 9)) * TAU + t * 0.05, r = W * (0.3 + hash(k, ring) * 0.7) * (0.6 + 0.4 * ((ring + 1) / 8));
          if (hash(Math.floor(t / 2) + k * 7, ring * 13 + Math.floor(y * 5)) > fade) continue;
          const i = n * 16, s = 1 + (ring < 3 ? 1.2 : 0);
          arr[i] = s; arr[i + 1] = arr[i + 2] = arr[i + 3] = arr[i + 4] = 0; arr[i + 5] = s; arr[i + 6] = arr[i + 7] = arr[i + 8] = arr[i + 9] = 0; arr[i + 10] = s; arr[i + 11] = 0;
          arr[i + 12] = b.x + Math.sin(a) * r * 0.35; arr[i + 13] = y; arr[i + 14] = b.z + Math.cos(a) * r * 0.35; arr[i + 15] = 1;
          const c = cs[ring < 3 ? 0 : ring < 5 ? 1 : ring < 7 ? 2 : 3];
          carr[n * 3] = c.r; carr[n * 3 + 1] = c.g; carr[n * 3 + 2] = c.b; n++;
        }
      }
    }
    m.count = n; m.visible = n > 0; m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
    if (col.fade && t > 42) { this.column = null; m.visible = false; }
  }

  // ---- ui ------------------------------------------------------------------------------------------------------------------
  ui(g) {
    const W = display.width, H = display.height, b = this.boss;
    // the boss bar
    if (this.state === 'fight' || this.state === 'intro' && this.barFill > 0 || this.state === 'dying' && this.dt < 136) this.drawBar(g, W, H);
    // status text
    if (this.status.t > 0) drawText(g, this.status.text, W / 2, 36, 'gold', { align: 'center', outline: 'ink' });
    // phase banner
    if (this.banner && !this.banner.victory) this.drawBanner(g, W, H, this.banner);
    if (this.banner?.victory) this.drawVictory(g, W, H, this.banner);
    // intro
    if (this.state === 'intro') this.drawIntro(g, W, H);
    // full-screen flash from the director (in addition to feedback.flash)
    if (this.flashA > 0.01 && this.state === 'dying') { g.globalAlpha = this.flashA; g.fillStyle = css('white'); g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    if (this.state === 'won' && this.key && !this.cleared) {
      const p = display.worldToScreen(this.key.m.position.x, this.key.m.position.y + 0.9, this.key.m.position.z);
      const bob = Math.round(Math.sin(this.wonT * 0.1) * 2);
      drawText(g, 'TAKE THE KEY', p.x, p.y - 8 + bob, 'gold', { align: 'center', outline: 'ink' });
    }
  }
  drawBar(g, W, H) {
    const w = Math.min(260, W - 60);
    drawBossBar(g, (W - w) / 2, H - 26, w, { name: NAME, hp: this.hpShown, ghost: this.hpGhost, flash: this.hpFlash, fill: this.barFill, phase: this.boss.phase, phases: 3, t: this.t ?? this.dt ?? 0 });
  }
  drawBanner(g, W, H, b) {
    const k = b.t, len = b.len, inn = sstep(k / 10), out = sstep((len - k) / 16);
    const a = Math.min(inn, out);
    if (a <= 0) return;
    const y = Math.round(H * 0.24), slide = Math.round((1 - inn) * 40);
    g.globalAlpha = a * 0.85; g.fillStyle = css('ink'); g.fillRect(0, y - 8, W, 44);
    g.fillStyle = css(b.color); g.fillRect(0, y - 8, W, 1); g.fillRect(0, y + 35, W, 1);
    g.globalAlpha = a;
    drawText(g, b.title, W / 2 + slide, y, b.color === 'red' ? 'rose' : 'flame', { align: 'center', scale: 2, outline: 'ink' });
    drawText(g, b.sub, W / 2 - slide, y + 22, 'fog', { align: 'center', shadow: 'ink' });
    g.globalAlpha = 1;
  }
  drawVictory(g, W, H, b) {
    const k = b.t, title = b.title, y = Math.round(H * 0.2);
    const shown = Math.min(title.length, Math.floor(k / 2.2));
    const scale = 3;
    const full = textWidth(title, scale), x0 = Math.round((W - full) / 2);
    g.globalAlpha = Math.min(1, k / 8) * 0.8; g.fillStyle = css('ink'); g.fillRect(0, y - 10, W, 44 + 14); g.globalAlpha = 1;
    g.fillStyle = css('gold'); g.fillRect(0, y - 10, W, 1); g.fillRect(0, y + 47, W, 1);
    let x = x0;
    for (let i = 0; i < shown; i++) {
      const ch = title[i], age = k - i * 2.2, pop = age < 6 ? (1 - age / 6) * 10 : 0;
      x += drawText(g, ch, x, y - pop, age < 4 ? 'white' : 'gold', { scale, outline: 'ink' }) + scale;
    }
    // glint that runs along the word
    const gx = x0 + ((k * 3) % (full + 80)) - 40;
    if (shown === title.length && gx > x0 && gx < x0 + full) { g.fillStyle = css('white'); g.globalAlpha = 0.7; g.fillRect(gx, y, 2, 21); g.globalAlpha = 1; }
    if (k > 26) { g.globalAlpha = Math.min(1, (k - 26) / 16); drawText(g, b.sub, W / 2, y + 30, 'torch', { align: 'center', outline: 'ink' }); g.globalAlpha = 1; }
  }
  drawIntro(g, W, H) {
    const t = this.introT;
    const bh = Math.round(this.bars * 34);
    g.fillStyle = css('ink');
    if (bh > 0) { g.fillRect(0, 0, W, bh); g.fillRect(0, H - bh, W, bh); }
    if (this.fade > 0) { g.globalAlpha = this.fade; g.fillRect(0, 0, W, H); g.globalAlpha = 1; }
    // name card: slams in, underline sweeps, subtitle types out
    if (t >= 238 && t < 332) {
      const c = this.cardT, out = sstep((332 - t) / 14);
      const scale = c < 3 ? 6 : c < 6 ? 5 : 4;
      const y = Math.round(H * 0.62);
      g.globalAlpha = out;
      const w = textWidth(NAME, 4);
      const band = 34;
      g.fillStyle = css('ink'); g.globalAlpha = out * 0.78; g.fillRect(0, y - 10, W, band + 30); g.globalAlpha = out;
      g.fillStyle = css('red'); g.fillRect(0, y - 10, W, 1); g.fillRect(0, y + band + 19, W, 1);
      const flash = c < 4;
      drawText(g, NAME, W / 2, y, flash ? 'white' : 'bone', { align: 'center', scale, outline: 'ink' });
      const ux = Math.round((W - w) / 2), uw = Math.round(w * clamp((c - 6) / 18, 0, 1));
      g.fillStyle = css('ember'); g.fillRect(ux, y + 32, uw, 2); g.fillStyle = css('flame'); g.fillRect(ux, y + 32, uw, 1);
      const chars = clamp(Math.floor((c - 18) / 1.6), 0, SUB.length);
      drawText(g, SUB.slice(0, chars), W / 2, y + 40, 'rose', { align: 'center', outline: 'ink' });
      g.globalAlpha = 1;
    }
    if (this.canSkip && t < 330) drawText(g, 'E: SKIP', W - 8, H - bh - 10, 'slate', { align: 'right' });
  }

  dispose() {
    this.offs.forEach((f) => f());
    for (const k of ['arena', 'zone', 'rings']) this[k].dispose();
    this.boss.dispose();
    this.root.remove(this.decals.mesh);
    if (this.colMesh) this.root.remove(this.colMesh);
    if (this.helm) this.root.remove(this.helm);
    if (this.key) { this.key.light?.remove(); this.root.remove(this.key.m); }
    const L = display.lights, B = this.baseLight; L.hemi.intensity = B.hemi; L.key.intensity = B.key; L.rim.intensity = B.rim;
    if (this.baseScale !== null) loop.setTimeScale(this.baseScale);
    display.setZoom(this.zoomWas || 1);
  }
  info() { return { state: this.state, introT: this.introT, dt: this.dt, boss: this.boss.info(), rings: this.rings.active, husks: this.huskCount(), hp: this.boss.hp, maxHp: this.boss.maxHp, cage: this.arena.cageK, key: !!this.key, cleared: this.cleared }; }
}
