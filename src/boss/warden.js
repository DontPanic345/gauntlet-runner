// The Warden (piece `boss`): a jailer-knight with a spiked ball on a chain, fought in a round
// pit in three phases. Built on the enemies piece's Enemy base (body, pose lerp, hit flash,
// floor telegraphs through the manager), with its own hit rules, attacks and death.
//
// PHASES (hp thresholds at 2/3 and 1/3; each change is an event, not a stat change):
//   I   THE CHAIN   sweep, lash, stomp                    eyes sky
//   II  THE QUAKE   + leap slam with a shockwave ring     eyes gold, right pauldron torn off
//   III THE CAGE    + the cage, summons husks, two rings  eyes ember, the breastplate cracks
//
// ATTACKS (every one telegraphed on the floor in the enemies' language: the drawn zone is the
// hitbox, the fill shows the time left, gold blink over the last quarter):
//   sweep   58-tick windup, the ball whirled overhead (rising whirl). A 230° fan fills round
//           it, reach 4.7. Then the ball sweeps the fan in 9 ticks. Answer: get outside the
//           reach, get behind it, or dash through the ball as it passes.
//   lash    42-tick windup, the ball drawn back behind it; a lane fills toward you, tracking
//           for 60%, then locks. The ball flies down the lane and buries itself in the floor:
//           the Warden is stuck pulling it free for 54 ticks: the punish window.
//   stomp   only when you hug it: a 2.15-radius disc round its feet, 30-tick windup.
//   leap    (II+) it crouches, a disc fills where you stand (tracks 60%), it leaps and lands
//           there: 2 damage in the disc; 16 ticks later a shockwave ring rolls out across the
//           pit at 4.6 u/s (its start line flashes on the floor first). Dash *into* the ring to pass through it. 64 ticks stuck in the floor after.
//   summon  (III) unhooks its keys and rattles them: two husks claw out of the floor.
//   cage    (III, once) a bell; the outer ring of the pit fills red for 96 ticks, then iron
//           bars burst up at r = 4.3. Anyone outside is hurt and thrown in. The pit shrinks.
//
// STAGGER (the punish window you earn): damage builds poise (bar under the hp bar). At 90
// it breaks: any windup is cancelled and it drops to one knee for 160 ticks, taking 1.5x
// damage. After a stagger poise cannot build for 4 s. It cannot be staggered in the air.
//
// DEATH: the killing blow freezes the world; it reels, light bursts out of the cracks in
// beams, it sinks to its knees and shudders; then it bursts: the armour flies apart and
// clatters across the floor, its soul rises, and the keys are left glowing in the pile.
//
// Events: boss:wake, boss:chains, boss:roar, boss:begin, boss:attack {name}, boss:strike
// {name, x, z}, boss:stagger, boss:phase {phase}, boss:cage, boss:cageUp, boss:summon,
// boss:death, boss:burst {x, z}, boss:defeated. (All carry {boss} too.)

import * as THREE from 'three';
import { Enemy, part, pivot, ease, smooth, clamp01, wrap, V } from '../enemies/enemy.js';
import { ENEMY_DATA } from '../enemies/data.js';
import { Hurtable } from '../combat/combat.js';
import { vfx } from '../vfx/vfx.js';
import { events } from '../core/events.js';
import { feedback } from '../core/feedback.js';
import { DT } from '../core/loop.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { voxelMesh } from '../render/voxel/index.js';
import { RIG, PIT } from './models.js';
import { bossSfx } from './sfx.js';

// ---- tuning (data, like the enemies' data.js; debug.boss('tune', {...}) edits it live) ------
export const WARDEN = {
  name: 'THE WARDEN', title: 'JAILER OF THE DEEP GAUNTLET',
  hp: 720, radius: 0.95, height: 4.7, weight: 40, speed: 1.3, accel: 0.06,
  phases: [null, 'THE CHAIN', 'THE QUAKE', 'THE CAGE'],
  cool: { 1: [28, 54], 2: [22, 46], 3: [16, 38] },    // ticks between attacks, per phase
  poise: 90, poiseRest: 100, poiseDrain: 0.8, poiseLock: 240,
  stagger: { ticks: 160, mult: 1.5 },
  sweep: { windup: 58, lock: 0.6, active: 9, recover: 46, reach: 4.7, inner: 0.85, arc: 115, dmg: 1 },
  lash: { windup: 42, lock: 0.6, fly: 6, stuck: 54, pull: 14, recover: 18, length: 6.6, width: 1.1, dmg: 1 },
  stomp: { windup: 30, recover: 34, radius: 2.15, range: 2.3, dmg: 1 },
  leap: { windup: 36, lock: 0.6, air: 28, height: 3.2, radius: 1.8, recover: 64, dmg: 2, waves: { 2: 1, 3: 2 }, gap: 24, preroll: 16 },
  wave: { speed: 4.6, half: 0.2, dmg: 1 },
  summon: { windup: 64, at: 26, n: 2, cap: 3, cool: 600 },
  cage: { windup: 96 },
};
// the enemies' base class reads its archetype row from ENEMY_DATA
ENEMY_DATA.warden = {
  name: WARDEN.name, blurb: WARDEN.title, color: 'mist',
  hp: WARDEN.hp, speed: WARDEN.speed, accel: WARDEN.accel, radius: WARDEN.radius, height: WARDEN.height,
  weight: WARDEN.weight, aggression: 1, poise: WARDEN.poise, hurt: 0, token: 0,
  attack: { cooldown: WARDEN.cool[1] },
  debris: ['mist', 'slate', 'fog', 'blood'],
};

const EYE = { 1: 'sky', 2: 'gold', 3: 'ember' };
const ROMAN = [null, 'I', 'II', 'III'];
export { ROMAN };
const N_LINKS = 13;
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _w = new THREE.Vector3();

// The resting pose: every key the animation writes.
const REST = {
  hipY: 0, lean: 0.06, twist: 0, roll: 0, hp: 0.1, hy: 0,
  lx: -0.12, lz: -0.18, rx: -0.15, rz: 0.22,
  tL: 0, sL: 0, tR: 0, sR: 0,
  ba: 0.85, br: 1.75, bh: 0.28, bspin: 0, cape: 0.15,
};

export class Warden extends Enemy {
  constructor(mgr, opts = {}) {
    super(mgr, 'warden', { id: 'WARDEN', ...opts, spawn: 'instant' });
    this.collision = null;            // knockback never moves it; we clamp to the pit ourselves
    this.ringR = PIT.RP;              // the playable radius (shrinks to the cage in phase 3)
    this.phase = opts.phase ?? 1;
    this.force = null;                // showcase: loop one attack
    this.passive = false;             // showcase: never attack
    this.waves = [];                  // shockwave rings rolling out
    this.chunks = [];                 // armour pieces flying loose (phase breaks, death)
    this.poiseLockT = 0; this.sinceHit = 999; this.poiseHit = 0;   // its own poise (the base class drains poiseDmg on its own clock)
    this.summonCool = 0; this.caged = false;
    this.last = []; this.attacks = 0;
    this.hits = 0; this.staggers = 0;
    this.dmgTaken = 0;
    this.hp = Math.round(WARDEN.hp * (opts.hpScale ?? 1));
    this.maxHp = this.hp;
    if (this.phase >= 2) this.hp = Math.round(this.maxHp * (this.phase === 2 ? 2 / 3 : 1 / 3));
    this.applyPhaseLook(this.phase, true);
    this.shape = mgr.collision?.addCircle(this.x, this.z, this.r * 0.92, 'warden') ?? null;
    this.eyesLit = true;
    if ((opts.state ?? 'ready') === 'dormant') this.dormant(); else this.setState(opts.state ?? 'ready');
    this.snapPose();
  }

  // ---- the rig -----------------------------------------------------------------------------
  build() {
    const M = this.material;
    Object.assign(this.pose, REST);
    this.faller = pivot(this.body, 0, 0, 0);
    this.hips = pivot(this.faller, 0, RIG.hipY, 0);
    this.thighL = pivot(this.hips, -RIG.hipX, 0, 0, part('boss.thigh.L', M));
    this.shinL = pivot(this.thighL, 0, -6, 0, part('boss.shin.L', M));
    this.thighR = pivot(this.hips, RIG.hipX, 0, 0, part('boss.thigh.R', M));
    this.shinR = pivot(this.thighR, 0, -6, 0, part('boss.shin.R', M));
    this.torso = pivot(this.hips, 0, RIG.beltY - RIG.hipY, 0);
    this.torsos = [1, 2, 3].map((p) => { const m = part(`boss.torso.p${p}`, M); this.torso.add(m); return m; });
    this.cape = pivot(this.torso, 0, 12, -5.4, part('boss.cape', M));
    this.neck = pivot(this.torso, 0, RIG.neckY, 0.4);
    this.heads = [0, 1, 2, 3].map((p) => { const m = part(`boss.head.p${p}`, M); this.neck.add(m); return m; });   // p0: eyes dark
    this.armL = pivot(this.torso, -RIG.shoulderX, RIG.shoulderY, 0, part('boss.arm.L', M));
    this.armR = pivot(this.torso, RIG.shoulderX, RIG.shoulderY, 0, part('boss.arm.R', M));
    this.paulL = pivot(this.torso, -RIG.shoulderX + 0.5, RIG.shoulderY + 1.5, 0, part('boss.pauldron.L', M));
    this.paulR = pivot(this.torso, RIG.shoulderX - 0.5, RIG.shoulderY + 1.5, 0, part('boss.pauldron.R', M));
    this.handL = pivot(this.armL, 0, RIG.handY, 0.5);
    this.handR = pivot(this.armR, 0, RIG.handY, 0.5);
    this.belt = pivot(this.torso, -7.6, 0.5, 2.6);
    this.keys = part('boss.keys', M);
    this.belt.add(this.keys);
    // the ball rides in the yawed group (its pose is polar round the Warden), not the tilting body
    this.ball = part('boss.ball', M);
    this.group.add(this.ball);
    this.links = [];
    for (let k = 0; k < N_LINKS; k++) { const l = part('boss.link', M); this.mgr.root.add(l); this.links.push(l); }
    // the eye light: a small cold glow in the visor, its colour follows the phase
    this.eyeLight = look.torch(this.neck, { y: 0.55, z: 0.55, color: 'sky', intensity: 0.0, radius: 3.4, flicker: 0.35, haze: 1 });
    this.chained = false;             // intro: chains run from the wall rings to its wrists
    this.wallRings = [[-1.5, 2.6, PIT.wallZ + 0.35], [1.5, 2.6, PIT.wallZ + 0.35]];
    this.wallChains = [0, 1].map(() => { const a = []; for (let k = 0; k < 12; k++) { const l = part('boss.link', M); l.visible = false; this.mgr.root.add(l); a.push(l); } return a; });
  }

  applyPhaseLook(p, instant = false) {
    this.torsos.forEach((m, i) => { m.visible = i === p - 1; });
    if (p >= 2 && this.paulR.parent && !this.paulR.userData.gone && instant) { this.paulR.visible = false; this.paulR.userData.gone = true; }
    if (p >= 3 && this.paulL.parent && !this.paulL.userData.gone && instant) { this.paulL.visible = false; this.paulL.userData.gone = true; }
    if (this.eyeLight) this.eyeLight.color.setHex(hex(EYE[p]));
  }

  get W() { return WARDEN; }
  get attacking() { return ['sweepWind', 'sweep', 'lashWind', 'lash', 'stompWind', 'stomp', 'leapWind', 'air', 'cageWind', 'summon'].includes(this.state); }
  get airborne() { return this.state === 'air'; }
  get open() { return ['stuck', 'pull', 'land', 'recover', 'stagger'].includes(this.state); }
  get alive() { return !this.dead && !this.dying; }

  // the intro, driven by the fight director
  dormant() { this.setState('dormant'); this.chained = true; this.eyesLit = false; Object.assign(this.pose, this.kneelPose(1)); this.snapPose(); }
  wake() { if (this.state === 'dormant') { this.eyesLit = true; this.setState('wake'); events.emit('boss:wake', { boss: this }); } }
  begin() { this.setState('move'); this.cool = 40; events.emit('boss:begin', { boss: this }); }

  // ---- hits ---------------------------------------------------------------------------------
  takeHit(hit) {
    if (this.dead || this.dying) return false;
    if (['dormant', 'wake', 'roar', 'ready', 'break'].includes(this.state)) return false;   // armoured by the moment
    if (this.state === 'air' || this.y > 0.8) return false;
    const stag = this.state === 'stagger';
    const extra = stag ? Math.round(hit.dmg * (WARDEN.stagger.mult - 1)) : 0;
    const before = this.hp;
    // Hurtable's rules (hp, flash, tilt) without the enemies' poise and stagger: the Warden has its own
    if (!Hurtable.prototype.takeHit.call(this, { ...hit, knock: hit.knock * 0.2, lift: 0 })) return false;
    this.hp = Math.max(0, this.hp - extra);
    if (this.hp <= 0) this.dead = true;
    this.dmgTaken += before - this.hp;
    this.recoil = Math.min(1, 0.4 + hit.power * 0.25); this.recoilX = hit.dx; this.recoilZ = hit.dz;
    this.sinceHit = 0;
    bossSfx.hit(hit.finisher);
    if (extra) events.emit('combat:damage', { x: this.x, y: 3.6, z: this.z, amount: extra, crit: true, side: 'enemy' });
    events.emit('enemy:hurt', { enemy: this, x: this.x, z: this.z, dmg: before - this.hp, hp: this.hp });
    // phase thresholds: the hp clamps at the line and the phase change plays
    const line = this.phase < 3 ? Math.round(this.maxHp * (3 - this.phase) / 3) : 0;
    if (this.phase < 3 && this.hp <= line) { this.hp = line; this.dead = false; this.breakPhase(hit); return true; }
    if (this.dead) { this.die(hit); return true; }
    // poise
    if (!stag && this.poiseLockT <= 0) {
      this.poiseHit += hit.dmg;
      if (this.poiseHit >= WARDEN.poise) this.staggerNow(hit);
    }
    return true;
  }

  staggerNow(hit = null) {
    this.poiseHit = 0; this.poiseLockT = WARDEN.stagger.ticks + WARDEN.poiseLock;
    this.cancelAttack();
    this.setState('stagger');
    this.staggers++;
    this.squash = 0.6;
    feedback.hitstop(110); feedback.shake(4, 220);
    vfx.hitSpark(this.x, 2.6, this.z, { dx: hit?.dx ?? 0, dz: hit?.dz ?? 1, power: 2.4, palette: 'hit' });
    vfx.shockwave(this.x, this.z, { radius: 2.0, color: 'gold', hot: 'white', dust: true });
    look.flash(this.x, 2.4, this.z, { color: 'gold', ms: 220, intensity: 3, radius: 5 });
    bossSfx.stagger();
    events.emit('boss:stagger', { boss: this });
  }

  cancelAttack() {
    // drop the ball wherever it is, forget the telegraph. Rings already rolling keep rolling.
    this.lane = null; this.aim = null;
    if (this.keys.parent === this.handL) this.belt.add(this.keys);
  }

  breakPhase(hit) {
    this.cancelAttack();
    this.poiseHit = 0;
    this.nextPhase = this.phase + 1;
    this.setState('break');
    this.vx = (hit?.dx ?? 0) * 2.5; this.vz = (hit?.dz ?? 1) * 2.5;
    feedback.hitstop(170);
    feedback.flash('white', 160, 0.45);
    feedback.shake(7, 450);
    bossSfx.break();
    // the armour tears: a pauldron flies off and clatters across the floor
    const piece = this.nextPhase === 2 ? this.paulR : this.paulL;
    this.detach(piece, { vx: (this.nextPhase === 2 ? 1 : -1) * 3.2 + (hit?.dx ?? 0) * 2, vy: 6.5, vz: 1.5 + (hit?.dz ?? 0) * 2, spin: 14 });
    piece.userData.gone = true;
    vfx.hitSpark(this.x + (this.nextPhase === 2 ? 1.2 : -1.2), 3.0, this.z, { dx: this.nextPhase === 2 ? 1 : -1, dz: 0.3, power: 3, palette: 'hit' });
    this.burstChunks(this.x, 2.8, this.z, ['mist', 'slate', 'fog', 'frost'], 18, 1.2);
    events.emit('boss:phase', { boss: this, phase: this.nextPhase, name: WARDEN.phases[this.nextPhase] });
  }

  die(hit) {
    this.dying = true;
    this.dead = true;
    this.cancelAttack();
    this.deathDX = hit?.dx ?? 0; this.deathDZ = hit?.dz ?? 1;
    this.setState('death');
    feedback.hitstop(240);
    feedback.flash('white', 220, 0.7);
    feedback.shake(8, 600);
    bossSfx.deathHit();
    look.flash(this.x, 2.5, this.z, { color: 'torch', ms: 400, intensity: 4, radius: 8 });
    events.emit('enemy:death', { enemy: this, x: this.x, z: this.z, kind: 'warden' });
    events.emit('boss:death', { boss: this });
  }

  // ---- the tick -----------------------------------------------------------------------------
  tick() {
    this.sinceHit++;
    if (this.poiseLockT > 0) this.poiseLockT--;
    else if (this.sinceHit > WARDEN.poiseRest && this.poiseHit > 0) this.poiseHit = Math.max(0, this.poiseHit - WARDEN.poiseDrain);
    if (this.summonCool > 0) this.summonCool--;
    super.tick();
    this.clampToRing();
    this.tickWaves();
    this.tickChunks();
    // its body blocks the hero (and husks): the collision circle follows it
    if (this.shape) {
      const up = this.y > 0.6 || this.burst;
      this.shape.x = up ? 1e4 : this.x; this.shape.z = up ? 1e4 : this.z;
    }
  }

  /** No collision world for the Warden's own body: it walks freely inside the pit's ring. */
  moveBy(dx, dz) { this.x += dx; this.z += dz; this.clampToRing(); return null; }
  clampToRing() {
    const d = Math.hypot(this.x, this.z), lim = this.ringR - this.r;
    if (d > lim) { this.x *= lim / d; this.z *= lim / d; }
  }

  // Enemy.tick routes: dying -> tickDeath; 'spawn' -> tickSpawn; 'hurt' -> stun; else think()
  think() {
    const th = this.toHero();
    const W = WARDEN;
    switch (this.state) {
      case 'dormant': case 'ready': this.stop(); break;
      case 'wake':
        this.stop();
        if (this.st === 64) this.snapChains();
        if (this.st >= 84) { this.setState('roar'); this.roarT = 0; }
        break;
      case 'roar':
        this.stop();
        if (this.st === 6) this.roar(true);
        if (this.st >= 70) this.setState('ready');
        break;
      case 'move': this.thinkMove(th); break;
      case 'sweepWind': {
        this.stop();
        const S = W.sweep;
        if (th && this.st < S.windup * S.lock) this.turnTo(th.yaw, 0.08);
        this.ayaw = this.yaw;
        if (this.st >= S.windup) {
          this.setState('sweep'); this.hitDone = false; bossSfx.sweep(); this.strike('sweep', this.x, this.z); this.prevA = null;
          // a wide smear where the chain passes, so the sweep reads even at game scale
          const arc = S.arc * Math.PI / 180;
          vfx.slash(this.x, 0.7, this.z, this.ayaw, { span: arc * 2, radius: S.reach - 0.45, thick: 1.1, palette: 'blade', mirror: -1, life: S.active / 60 + 0.12 });
          vfx.slash(this.x, 0.75, this.z, this.ayaw, { span: arc * 2, radius: S.reach - 1.3, thick: 0.5, palette: 'cool', mirror: -1, life: S.active / 60 + 0.08, sparks: false });
        }
        break;
      }
      case 'sweep': {
        this.stop();
        const S = W.sweep, arc = S.arc * Math.PI / 180;
        const u = smooth(this.st / S.active);
        const a = this.ayaw + arc - 2 * arc * u;           // world angle of the chain this tick
        const a0 = this.prevA ?? this.ayaw + arc;
        this.prevA = a;
        if (!this.hitDone && this.heroInSweep(a0, a, S.inner, S.reach)) {
          const bx = this.x + Math.sin(a) * (S.reach - 0.4), bz = this.z + Math.cos(a) * (S.reach - 0.4);
          const r = this.hurtHero(S.dmg, { x: this.x, z: this.z });
          if (r.ok) { this.hitDone = true; vfx.hitSpark(this.hero.x, 0.8, this.hero.z, { dx: Math.cos(a), dz: -Math.sin(a), power: 1.6, palette: 'hurt' }); }
          void bx; void bz;
        }
        // the ball scrapes the floor at the bottom of the arc
        if (this.st % 2 === 0) {
          const bx = this.x + Math.sin(a) * (S.reach - 0.35), bz = this.z + Math.cos(a) * (S.reach - 0.35);
          vfx.dust(bx, bz, { dx: Math.cos(a), dz: -Math.sin(a), n: 3, size: 1, palette: 'dustWarm' });
          vfx.embers(bx, 0.3, bz, { n: 3, spread: 0.15, up: 0.6, palette: 'spark' });
        }
        if (this.st === 4) feedback.shake(2.5, 140);
        if (this.st >= S.active) { this.setState('recover'); this.recoverFor = S.recover; this.from = 'sweep'; }
        break;
      }
      case 'lashWind': {
        this.stop();
        const L = W.lash;
        if (th && this.st < L.windup * L.lock) this.turnTo(th.yaw, 0.09);
        this.ayaw = this.yaw; this.ax = this.x; this.az = this.z;
        this.lane = this.laneLen(this.x, this.z, this.yaw, L.length);
        if (this.st >= L.windup) { this.setState('lash'); this.hitDone = false; bossSfx.lash(); this.strike('lash', this.x, this.z); }
        break;
      }
      case 'lash': {
        this.stop();
        const L = W.lash;
        const out = this.lane * smooth(this.st / L.fly);
        if (!this.hitDone && this.heroInLane(this.ax, this.az, this.ayaw, 0.5, out + 0.4, L.width / 2)) {
          const r = this.hurtHero(L.dmg, { x: this.ax, z: this.az });
          if (r.ok) this.hitDone = true;
        }
        if (this.st >= L.fly) {
          const ex = this.ax + Math.sin(this.ayaw) * this.lane, ez = this.az + Math.cos(this.ayaw) * this.lane;
          this.impact(ex, ez, 1.1, 0.9);
          this.setState('stuck');
        }
        break;
      }
      case 'stuck': {
        this.stop();
        if (this.st % 18 === 9) {   // it heaves on the chain
          bossSfx.yank();
          const ex = this.ax + Math.sin(this.ayaw) * this.lane, ez = this.az + Math.cos(this.ayaw) * this.lane;
          vfx.dust(ex, ez, { n: 4, size: 1, palette: 'dustWarm' });
          feedback.shake(1.2, 80);
        }
        if (this.st >= W.lash.stuck) { this.setState('pull'); bossSfx.yank(); }
        break;
      }
      case 'pull':
        this.stop();
        if (this.st % 2 === 0) {
          const d = this.lane * (1 - smooth(this.st / W.lash.pull)) + 1.6 * smooth(this.st / W.lash.pull);
          vfx.dust(this.ax + Math.sin(this.ayaw) * d, this.az + Math.cos(this.ayaw) * d, { n: 2, size: 0.9, palette: 'dustWarm' });
        }
        if (this.st >= W.lash.pull) { this.setState('recover'); this.recoverFor = W.lash.recover; this.from = 'lash'; }
        break;
      case 'stompWind':
        this.stop();
        if (th) this.turnTo(th.yaw, 0.05);
        if (this.st >= W.stomp.windup) {
          this.setState('stomp');
          this.impact(this.x, this.z, W.stomp.radius, 0.8, true);
          if (this.heroInDisc(this.x, this.z, W.stomp.radius)) this.hurtHero(W.stomp.dmg, this);
          this.strike('stomp', this.x, this.z);
        }
        break;
      case 'stomp':
        this.stop();
        if (this.st >= 4) { this.setState('recover'); this.recoverFor = W.stomp.recover; this.from = 'stomp'; }
        break;
      case 'leapWind': {
        this.stop();
        const Lp = W.leap;
        if (th && this.st < Lp.windup * Lp.lock) { this.aim = this.clampTarget(th.h.x, th.h.z); this.turnTo(th.yaw, 0.12); }
        if (!this.aim) this.aim = this.clampTarget(this.x, this.z + 2);
        if (this.st === Lp.windup - 10) bossSfx.inhale(0.3);
        if (this.st >= Lp.windup) {
          this.setState('air');
          this.lx0 = this.x; this.lz0 = this.z;
          this.yaw = Math.atan2(this.aim.x - this.x, this.aim.z - this.z);
          bossSfx.leap();
          vfx.dust(this.x, this.z, { n: 14, size: 1.5, palette: 'dustWarm' });
          vfx.land(this.x, this.z, { size: 1.6 });
          feedback.shake(2.5, 120);
          this.mgr.decal(this.x, this.z, 'crack', { r: 0.7, life: 260 });
        }
        break;
      }
      case 'air': {
        this.stop();
        const Lp = W.leap, u = this.st / Lp.air;
        this.x = this.lx0 + (this.aim.x - this.lx0) * smooth(u);
        this.z = this.lz0 + (this.aim.z - this.lz0) * smooth(u);
        this.y = Math.max(0, 4 * Lp.height * u * (1 - u));
        this.vy = 0;
        if (this.st >= Lp.air) {
          this.y = 0; this.x = this.aim.x; this.z = this.aim.z;
          this.setState('land');
          this.squash = 1;
          this.impact(this.x, this.z, Lp.radius, 1.6, true);
          bossSfx.land();
          feedback.shake(7.5, 420); feedback.kick(0, 1, 5);
          look.flash(this.x, 0.6, this.z, { color: 'flame', ms: 220, intensity: 3.2, radius: 6 });
          if (this.heroInDisc(this.x, this.z, Lp.radius)) this.hurtHero(Lp.dmg, this);
          const n = Lp.waves[this.phase] ?? 1;
          for (let k = 0; k < n; k++) this.waves.push({ x: this.x, z: this.z, r: Lp.radius, t: -Lp.preroll - k * Lp.gap, hit: false });
          this.strike('leap', this.x, this.z);
        }
        break;
      }
      case 'land':
        this.stop();
        if (this.st >= W.leap.recover) { this.setState('recover'); this.recoverFor = 18; this.from = 'leap'; }
        break;
      case 'summon': {
        this.stop();
        const Sm = W.summon;
        if (this.st === 2) { this.handL.add(this.keys); bossSfx.keys(); }
        if (this.st === 14 || this.st === 30 || this.st === 46) bossSfx.keys();
        if (this.st === Sm.at) this.summonHusks(Sm.n);
        if (this.st >= Sm.windup) { this.belt.add(this.keys); this.setState('recover'); this.recoverFor = 16; this.from = 'summon'; this.summonCool = Sm.cool; }
        break;
      }
      case 'cageWind':
        this.stop();
        if (this.st === 1) { bossSfx.bell(); events.emit('boss:cage', { boss: this }); }
        if (this.st === 48) bossSfx.bell();
        if (this.st >= W.cage.windup) this.raiseCage();
        break;
      case 'cageUp':
        this.stop();
        if (this.st >= 30) { this.setState('summon'); }
        break;
      case 'stagger':
        this.stop();
        if (this.st % 40 === 20) vfx.embers(this.x, 3.2, this.z + 0.3, { n: 4, spread: 0.3, up: 0.6, palette: 'spark' });
        if (this.st >= WARDEN.stagger.ticks) { this.setState('recover'); this.recoverFor = 24; this.from = 'stagger'; }
        break;
      case 'break': this.tickBreak(); break;
      case 'recover':
        this.stop();
        if (this.st >= (this.recoverFor ?? 30)) { this.setState('move'); this.cool = this.coolTicks(); }
        break;
      default: this.setState('move');
    }
  }

  coolTicks() {
    if (this.force) return 36;
    const [a, b] = WARDEN.cool[this.phase];
    return Math.round(a + (b - a) * this.rand());
  }

  thinkMove(th) {
    if (!th) { this.stop(); return; }
    // close to a comfortable distance (just inside the sweep's reach); heavy and slow
    const want = 3.0;
    if (th.d > want + 0.4) this.seek(th.h.x - th.dx * want, th.h.z - th.dz * want, this.speed, 0.8);
    else if (th.d < 1.7) this.seek(this.x - th.dx, this.z - th.dz, this.speed * 0.6, 0.5);
    else this.stop();
    this.turnTo(th.yaw, 0.06);
    if (this.passive) return;
    if (this.cool > 0) { this.cool--; return; }
    if (Math.abs(wrap(th.yaw - this.yaw)) > 0.9 && !this.force) return;   // turn to face first
    const pick = this.force ?? this.choose(th);
    if (pick) this.startAttack(pick);
  }

  choose(th) {
    const W = WARDEN, p = this.phase, d = th.d;
    const opts = [];
    const add = (name, w) => { if (w <= 0) return; const rep = this.last.filter((x) => x === name).length; opts.push([name, w / (1 + rep * 1.5)]); };
    if (d < W.stomp.range) add('stomp', 4);
    if (d >= 1.2 && d < W.sweep.reach - 0.3) add('sweep', 3);
    if (d >= 2.4) add('lash', p === 1 ? 2.5 : 1.6);
    if (p >= 2 && d >= 2.2) add('leap', p === 2 ? 2.4 : 2.6);
    if (p >= 3 && this.summonCool <= 0 && this.mgr.list.filter((e) => e.kind === 'husk' && !e.dying).length < 1) add('summon', 6);
    if (!opts.length) return d > 5 ? 'lash' : 'sweep';
    let tot = opts.reduce((s, o) => s + o[1], 0), r = this.rand() * tot;
    for (const [n, w] of opts) { r -= w; if (r <= 0) return n; }
    return opts[0][0];
  }

  startAttack(name) {
    const W = WARDEN;
    this.last.push(name); if (this.last.length > 3) this.last.shift();
    this.attacks++;
    this.hitDone = false; this.aim = null; this.lane = null;
    const st = { sweep: 'sweepWind', lash: 'lashWind', stomp: 'stompWind', leap: 'leapWind', summon: 'summon', cage: 'cageWind' }[name];
    if (!st) return;
    if (name === 'leap' && this.phase < 2 && !this.force) return;
    this.setState(st);
    if (name === 'sweep') bossSfx.whirl(W.sweep.windup / 60);
    if (name === 'lash') bossSfx.drawback(W.lash.windup / 60);
    if (name === 'stomp') bossSfx.creak(W.stomp.windup / 60);
    if (name === 'leap') bossSfx.inhale(W.leap.windup / 60 * 0.7);
    if (name === 'lash') this.lane = this.laneLen(this.x, this.z, this.yaw, W.lash.length);
    events.emit('boss:attack', { boss: this, name });
    events.emit('combat:enemyWindup', { enemy: this, x: this.x, z: this.z });
  }

  /** debug / showcase: start an attack now (from any calm state). */
  act(name) {
    if (!['move', 'recover', 'ready'].includes(this.state)) return false;
    this.startAttack(name);
    return true;
  }

  strike(name, x, z) { events.emit('boss:strike', { boss: this, name, x, z }); }

  // ---- the attacks' geometry -------------------------------------------------------------------
  laneLen(x, z, yaw, max) {
    // the ball flies until the pit's edge (or the cage)
    const dx = Math.sin(yaw), dz = Math.cos(yaw);
    const b = x * dx + z * dz, c = x * x + z * z - (this.ringR - 0.25) ** 2;
    const t = -b + Math.sqrt(Math.max(0, b * b - c));
    return Math.max(1.5, Math.min(max, t));
  }
  clampTarget(x, z) {
    const d = Math.hypot(x, z), lim = this.ringR - this.r - 0.1;
    return d > lim ? { x: x / d * lim, z: z / d * lim } : { x, z };
  }
  heroInSweep(a0, a1, inner, reach) {
    const h = this.hero; if (!h || h.dead) return false;
    const dx = h.x - this.x, dz = h.z - this.z, d = Math.hypot(dx, dz);
    if (d > reach + 0.3 || d < inner - 0.3) return false;
    const ha = Math.atan2(dx, dz), pad = Math.asin(Math.min(1, 0.3 / Math.max(0.3, d)));
    const mid = (a0 + a1) / 2, half = Math.abs(a1 - a0) / 2 + pad;
    return Math.abs(wrap(ha - mid)) <= half;
  }
  heroInLane(x, z, yaw, from, to, half) {
    const h = this.hero; if (!h || h.dead) return false;
    const dx = Math.sin(yaw), dz = Math.cos(yaw), rx = h.x - x, rz = h.z - z;
    const along = rx * dx + rz * dz, side = rx * dz - rz * dx;
    return along >= from - 0.3 && along <= to + 0.3 && Math.abs(side) <= half + 0.3;
  }

  /** A heavy blow on the floor: crack, dust, a ring of dust, shake. */
  impact(x, z, r, big = 1, ring = false) {
    feedback.shake(3 + big * 2.5, 180 + big * 120);
    vfx.dust(x, z, { n: Math.round(8 + big * 8), size: 1 + big * 0.4, palette: 'dustWarm' });
    vfx.land(x, z, { size: 1 + big * 0.6 });
    if (ring) vfx.shockwave(x, z, { radius: r + 0.4, color: 'fog', hot: 'white' });
    for (let k = 0; k < 6 + big * 4; k++) {     // floor chips thrown up
      const a = this.rand() * Math.PI * 2, sp = 1.5 + this.rand() * 2.5 * big;
      const i = vfx.core.add(x, 0.15, z, Math.sin(a) * sp, 3 + this.rand() * 3 * big, Math.cos(a) * sp, 1.1, 3 + (k % 2), k % 3 ? 'stone' : 'stoneLight', vfx.core.CUBE);
      if (i >= 0) { const P = vfx.core.P; P.grav[i] = 22; P.bounce[i] = 0.35; P.floorY[i] = 0.04; P.pop[i] = 1; P.shrinkAt[i] = 0.8; P.fadeAt[i] = 0.85; }
    }
    this.mgr.decal(x, z, 'crack', { r: 0.5 + r * 0.35, life: 420 });
    bossSfx.impact(big);
  }

  roar(intro = false) {
    bossSfx.roar(intro ? 1 : 1.1);
    feedback.shake(intro ? 7 : 6, 900);
    feedback.flash('white', 90, 0.18);
    look.flash(this.x, 3.5, this.z, { color: EYE[this.phase], ms: 500, intensity: 3, radius: 7 });
    for (let k = 0; k < 3; k++) vfx.later(k * 7, (a) => vfx.shockwave(a.x, a.z, { radius: 3.5 + a.k * 1.8, color: a.k === 2 ? 'mist' : 'fog', hot: 'white', dust: a.k === 0 }), { x: this.x, z: this.z, k });
    // the roar shoves the hero back a step (no damage)
    const h = this.hero;
    if (h && !h.dead && h.ctl) {
      const dx = h.x - this.x, dz = h.z - this.z, d = Math.hypot(dx, dz) || 1;
      if (d < 7) h.ctl.impulse(dx / d * 5 * (1 - d / 9), dz / d * 5 * (1 - d / 9));
    }
    events.emit('boss:roar', { boss: this, intro });
  }

  snapChains() {
    this.chained = false;
    bossSfx.snap();
    feedback.shake(4, 220);
    for (const [k, links] of this.wallChains.entries()) {
      for (const [i, l] of links.entries()) {
        if (!l.visible) continue;
        l.visible = false;
        const p = l.position;
        const s = k ? 1 : -1;
        const j = vfx.core.add(p.x, p.y, p.z, s * (1 + i * 0.25) + (this.rand() - 0.5), 2 + this.rand() * 3, 1 + this.rand() * 2, 1.4, 3, i % 2 ? 'mist' : 'slate', vfx.core.CUBE);
        if (j >= 0) { const P = vfx.core.P; P.grav[j] = 22; P.bounce[j] = 0.4; P.floorY[j] = 0.04; P.pop[j] = 1; P.fadeAt[j] = 0.85; P.shrinkAt[j] = 0.85; }
      }
    }
    for (const s of [-1, 1]) vfx.hitSpark(this.x + s * 1.5, 1.6, this.z, { dx: s, dz: 0.4, power: 1.8, palette: 'hit', light: false });
    events.emit('boss:chains', { boss: this });
  }

  summonHusks(n) {
    const h = this.hero;
    const R = Math.min(this.ringR - 1.2, 3.6);
    let made = 0;
    for (let k = 0; k < 12 && made < n; k++) {
      const a = this.rand() * Math.PI * 2, r = 1.8 + this.rand() * (R - 1.8);
      const x = Math.sin(a) * r, z = Math.cos(a) * r;
      if (h && Math.hypot(h.x - x, h.z - z) < 2.2) continue;
      if (Math.hypot(this.x - x, this.z - z) < 2) continue;
      if (this.mgr.list.filter((e) => e.kind === 'husk' && !e.dying).length >= WARDEN.summon.cap) break;
      this.mgr.spawn('husk', x, z, { delay: made * 8 });
      made++;
    }
    events.emit('boss:summon', { boss: this, n: made });
  }

  raiseCage() {
    this.caged = true;
    this.setState('cageUp');
    const R = PIT.CAGE;
    this.ringR = R;
    feedback.shake(6, 400);
    events.emit('boss:cageUp', { boss: this, r: R });
    // anyone outside the bars is hurt and thrown in
    const h = this.hero;
    if (h && !h.dead && Math.hypot(h.x, h.z) > R - 0.4) {
      const d = Math.hypot(h.x, h.z) || 1, k = (R - 0.9) / d;
      h.ctl?.teleport(h.x * k, h.z * k);
      this.hurtHero(1, { x: h.x / k, z: h.z / k });
      vfx.hitSpark(h.x, 0.8, h.z, { dx: -h.x / d, dz: -h.z / d, power: 2, palette: 'hurt' });
    }
    for (const e of this.mgr.list) {
      if (e === this || e.dying) continue;
      const d = Math.hypot(e.x, e.z);
      if (d > R - 0.4) { const k = (R - 0.8) / d; e.x *= k; e.z *= k; }
    }
    if (Math.hypot(this.x, this.z) > R - this.r) { const d = Math.hypot(this.x, this.z), k = (R - this.r - 0.1) / d; this.x *= k; this.z *= k; }
  }

  // ---- phase change ------------------------------------------------------------------------------
  tickBreak() {
    this.stop();
    const s = this.st, p = this.nextPhase;
    if (s === 34) {
      this.phase = p;
      this.applyPhaseLook(p);
      bossSfx.eyes();
      vfx.flash(this.x, 4.0, this.z + 0.4, { color: EYE[p], size: 1.2 });
      vfx.embers(this.x, 3.6, this.z + 0.3, { n: 16, spread: 0.4, up: 1.2, palette: p === 3 ? 'ember' : 'spark' });
      look.flash(this.x, 4, this.z, { color: EYE[p], ms: 300, intensity: 3, radius: 6 });
      if (p === 3) this.burstChunks(this.x, 2.6, this.z + 0.5, ['mist', 'fog', 'slate'], 10, 0.8);
    }
    if (s === 60) this.roar(false);
    if (s >= 120) {
      this.poiseLockT = 0; this.poiseHit = 0;
      if (p === 3 && !this.caged) { this.setState('cageWind'); this.attacks++; events.emit('boss:attack', { boss: this, name: 'cage' }); }
      else { this.setState('move'); this.cool = 30; }
    }
  }

  // ---- shockwave rings ---------------------------------------------------------------------------
  tickWaves() {
    const Wv = WARDEN.wave;
    for (const w of this.waves) {
      w.t++;
      if (w.t < 0) continue;
      if (w.t === 0) bossSfx.wave();
      w.r += Wv.speed * DT;
      const max = this.ringR - 0.05;
      if (w.r >= max) {
        w.done = true;
        // the ring breaks against the pit's edge (or the bars) in a spray of sparks
        for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2 + w.t; vfx.dust(w.x + Math.sin(a) * max, w.z + Math.cos(a) * max, { n: 2, size: 0.8, palette: 'dustWarm' }); }
        continue;
      }
      if (w.t % 3 === 0) {
        for (let k = 0; k < 5; k++) {
          const a = this.rand() * Math.PI * 2;
          vfx.dust(w.x + Math.sin(a) * w.r, w.z + Math.cos(a) * w.r, { dx: Math.sin(a), dz: Math.cos(a), n: 1, size: 0.9, palette: 'dustWarm' });
        }
      }
      const h = this.hero;
      if (!w.hit && h && !h.dead) {
        const d = Math.hypot(h.x - w.x, h.z - w.z);
        if (Math.abs(d - w.r) <= Wv.half + 0.3) {
          const r = this.hurtHero(Wv.dmg, { x: w.x, z: w.z });
          if (r.ok || r.reason === 'dodged') w.hit = true;
        }
      }
    }
    this.waves = this.waves.filter((w) => !w.done);
  }

  // ---- loose armour: pieces that fly off and clatter across the floor ---------------------------
  detach(obj, { vx = 0, vy = 5, vz = 0, spin = 8, rest = 0.2 } = {}) {
    if (!obj.parent) return null;
    obj.updateWorldMatrix(true, false);
    obj.getWorldPosition(_v); obj.getWorldQuaternion(_q);
    // a pivot group: carry its children (the mesh) into the room
    const holder = new THREE.Group();
    holder.position.copy(_v); holder.quaternion.copy(_q);
    this.mgr.root.add(holder);
    while (obj.children.length) holder.add(obj.children[0]);
    if (obj.isMesh) { obj.removeFromParent(); obj.position.set(0, 0, 0); obj.quaternion.identity(); holder.add(obj); }
    const c = {
      obj: holder, x: _v.x, y: _v.y, z: _v.z, px: _v.x, py: _v.y, pz: _v.z, vx, vy, vz,
      q: holder.quaternion.clone(), pq: holder.quaternion.clone(),
      w: new THREE.Vector3((this.rand() - 0.5) * spin, (this.rand() - 0.5) * spin, (this.rand() - 0.5) * spin),
      rest, bounces: 0, still: false, k: this.chunks.length,
    };
    this.chunks.push(c);
    return c;
  }
  tickChunks() {
    for (const c of this.chunks) {
      c.px = c.x; c.py = c.y; c.pz = c.z; c.pq.copy(c.q);
      if (c.still) continue;
      c.vy -= 22 * DT;
      c.x += c.vx * DT; c.y += c.vy * DT; c.z += c.vz * DT;
      _q.setFromAxisAngle(_w.copy(c.w).normalize(), c.w.length() * DT);
      if (c.w.lengthSq() > 1e-6) c.q.premultiply(_q);
      // keep pieces on the drum
      const d = Math.hypot(c.x, c.z), lim = PIT.RF - 0.4;
      if (d > lim) { c.x *= lim / d; c.z *= lim / d; c.vx *= -0.3; c.vz *= -0.3; }
      if (c.y <= c.rest) {
        c.y = c.rest;
        if (c.vy < -2) {
          c.bounces++;
          bossSfx.clatter(c.k + c.bounces);
          vfx.dust(c.x, c.z, { n: 3, size: 0.8, palette: 'dustWarm' });
          if (c.bounces === 1) vfx.hitSpark(c.x, c.y + 0.1, c.z, { dx: c.vx, dz: c.vz, power: 0.6, palette: 'hit', light: false });
          c.vy = -c.vy * 0.38; c.vx *= 0.6; c.vz *= 0.6; c.w.multiplyScalar(0.55);
        } else {
          c.vy = 0; c.vx *= 0.8; c.vz *= 0.8; c.w.multiplyScalar(0.7);
          if (Math.hypot(c.vx, c.vz) < 0.05 && c.w.length() < 0.2) {
            c.still = true;
            // settle flat-ish: snap the tumble to the nearest face-down orientation
            const e = new THREE.Euler().setFromQuaternion(c.q, 'YXZ');
            e.x = Math.round(e.x / (Math.PI / 2)) * (Math.PI / 2); e.z = Math.round(e.z / (Math.PI / 2)) * (Math.PI / 2);
            c.q.setFromEuler(e); c.pq.copy(c.q);
          }
        }
      }
    }
  }
  renderChunks(alpha) {
    for (const c of this.chunks) {
      c.obj.position.set(c.px + (c.x - c.px) * alpha, c.py + (c.y - c.py) * alpha, c.pz + (c.z - c.pz) * alpha);
      look.snap(c.obj.position);
      c.obj.quaternion.slerpQuaternions(c.pq, c.q, alpha);
    }
  }
  burstChunks(x, y, z, colors, n, power = 1) {
    for (let k = 0; k < n; k++) {
      const a = this.rand() * Math.PI * 2, sp = (1.5 + this.rand() * 3) * power;
      const i = vfx.core.add(x + Math.sin(a) * 0.3, y, z + Math.cos(a) * 0.3, Math.sin(a) * sp, 2 + this.rand() * 4 * power, Math.cos(a) * sp, 1.3, 3 + (k % 3), colors[k % colors.length], vfx.core.CUBE);
      if (i >= 0) { const P = vfx.core.P; P.grav[i] = 22; P.bounce[i] = 0.35; P.floorY[i] = 0.04; P.pop[i] = 1; P.shrinkAt[i] = 0.85; P.fadeAt[i] = 0.88; }
    }
  }

  // ---- death ---------------------------------------------------------------------------------
  /** Where the death beams come from (world). */
  beamOrigin(out = { x: 0, y: 0, z: 0 }) {
    out.x = this.x; out.z = this.z + 0.2;
    out.y = this.burst ? 1.0 : Math.max(1.4, 2.6 + this.pose.hipY * V);
    return out;
  }
  tickDeath() {
    const s = this.st;
    this.stop(); this.vx *= 0.85; this.vz *= 0.85;
    if (s === 1) { this.vx = this.deathDX * 2; this.vz = this.deathDZ * 2; }
    if (s === 6) bossSfx.groan();
    if (s === 14) { bossSfx.beams(); }
    if (s % 9 === 4 && s < 108) {
      vfx.embers(this.x + (this.rand() - 0.5) * 1.2, 2.2 + this.rand() * 1.2, this.z + 0.4, { n: 6, spread: 0.2, up: 1.4, palette: 'ember' });
      look.flash(this.x, 2.6, this.z, { color: s > 60 ? 'torch' : 'gold', ms: 140, intensity: 1.6 + s / 50, radius: 5 });
    }
    if (s === 40) { bossSfx.impact(1.4); feedback.shake(5, 300); vfx.land(this.x, this.z, { size: 2 }); vfx.dust(this.x, this.z, { n: 16, size: 1.5, palette: 'dustWarm' }); }
    if (s > 60 && s < 110 && s % 6 === 0) feedback.shake(1.5 + (s - 60) / 15, 120);
    if (s === 112) this.explode();
    if (s === 112 + 150) events.emit('boss:defeated', { boss: this });
    // never removed: the armour pile stays in the room
  }
  explode() {
    this.burst = true;
    feedback.hitstop(150);
    feedback.flash('white', 320, 0.9);
    feedback.shake(10, 700);
    bossSfx.burst();
    vfx.later(20, () => bossSfx.soul());
    const x = this.x, z = this.z;
    look.flash(x, 2, z, { color: 'torch', ms: 700, intensity: 5, radius: 10 });
    vfx.flash(x, 2.2, z, { color: 'torch', size: 3 });
    vfx.death(x, 2.0, z, { colors: ['mist', 'fog', 'slate', 'frost'], power: 2.6, soul: true, ring: 'gold' });
    vfx.death(x, 1.0, z, { colors: ['blood', 'plum', 'gold', 'slate'], power: 2.0, soul: false, ring: 'mist' });
    for (let k = 0; k < 3; k++) vfx.later(k * 8, (a) => vfx.shockwave(a.x, a.z, { radius: 6 + a.k * 3, color: a.k === 1 ? 'torch' : 'gold', hot: 'white', dust: a.k === 0 }), { x, z, k });
    this.burstChunks(x, 2.4, z, ['mist', 'fog', 'slate', 'gold', 'blood'], 30, 1.6);
    vfx.embers(x, 1.5, z, { n: 40, spread: 0.8, up: 2.5, palette: 'gold' });
    // the rig flies apart
    const fly = (o, vx, vy, vz, spin, rest) => this.detach(o, { vx, vy, vz, spin, rest });
    const dxk = this.deathDX * 1.5, dzk = this.deathDZ * 1.5;
    fly(this.neck, dxk + (this.rand() - 0.5) * 2, 11, dzk + 2.5, 16, 0.3);
    if (!this.paulL.userData.gone) fly(this.paulL, -4, 7, 1, 14, 0.15);
    if (!this.paulR.userData.gone) fly(this.paulR, 4, 7, 1, 14, 0.15);
    fly(this.armL, -4.5, 5, 1.5, 10, 0.25);
    fly(this.armR, 4.5, 5, 1.0, 10, 0.25);
    fly(this.cape, -0.5, 4, -3.5, 6, 0.06);
    fly(this.belt, -1.5, 6, 2.5, 12, 0.08);
    fly(this.torso, dxk, 3.5, dzk + 0.5, 4, 0.55);
    fly(this.shinL, -2.5, 2.5, 1.5, 8, 0.2); fly(this.shinR, 2.5, 2.5, 1.5, 8, 0.2);
    fly(this.thighL, -2, 3, 0.8, 8, 0.25); fly(this.thighR, 2, 3, 0.8, 8, 0.25);
    this.eyeLight.intensity = 0;
    this.ballFree = true;
    for (const l of this.links) { if (this.rand() < 0.5) continue; const c = this.detach(l, { vx: (this.rand() - 0.5) * 5, vy: 3 + this.rand() * 4, vz: (this.rand() - 0.5) * 5, spin: 18, rest: 0.03 }); void c; }
    events.emit('boss:burst', { boss: this, x, z });
  }

  // ---- the floor ----------------------------------------------------------------------------------
  telegraph(T) {
    const W = WARDEN, s = this.st;
    switch (this.state) {
      case 'sweepWind': T.sector(this.x, this.z, this.yaw, W.sweep.reach, W.sweep.arc, Math.min(1, s / W.sweep.windup), { t: s, inner: W.sweep.inner }); break;
      case 'sweep': if (s <= 4) T.sector(this.x, this.z, this.ayaw, W.sweep.reach, W.sweep.arc, 1, { firing: true, inner: W.sweep.inner }); break;
      case 'lashWind': T.lane(this.x, this.z, this.yaw, this.lane, W.lash.width, Math.min(1, s / W.lash.windup), { t: s, start: 0.6 }); break;
      case 'lash': T.lane(this.ax, this.az, this.ayaw, this.lane, W.lash.width, 1, { firing: true, start: 0.6 }); break;
      case 'stompWind': T.disc(this.x, this.z, W.stomp.radius, Math.min(1, s / W.stomp.windup), { t: s }); break;
      case 'stomp': if (s <= 3) T.disc(this.x, this.z, W.stomp.radius, 1, { firing: true }); break;
      case 'leapWind': if (this.aim) T.disc(this.aim.x, this.aim.z, W.leap.radius, s / (W.leap.windup + W.leap.air), { t: s }); break;
      case 'air': T.disc(this.aim.x, this.aim.z, W.leap.radius, (W.leap.windup + s) / (W.leap.windup + W.leap.air), { t: s + W.leap.windup }); break;
      case 'land': if (s <= 3) T.disc(this.x, this.z, W.leap.radius, 1, { firing: true }); break;
      case 'cageWind': ringZone(T, 0, 0, PIT.CAGE, this.ringR + 0.6, Math.min(1, s / W.cage.windup), s, false); break;
      case 'cageUp': if (s <= 4) ringZone(T, 0, 0, PIT.CAGE, PIT.RP + 0.6, 1, s, false, true); break;
      default: break;
    }
    // shockwave rings: a band of red with a gold leading edge
    for (const w of this.waves) {
      if (w.t < 0) { if (w.t > -14) ringZone(T, w.x, w.z, w.r - 0.05, w.r + 0.15, 1, w.t, false, (w.t & 2) === 0); continue; }
      ringBand(T, w.x, w.z, w.r, WARDEN.wave.half);
    }
  }

  // ---- animation -------------------------------------------------------------------------------------
  kneelPose(k = 1) {
    return {
      hipY: -5.2 * k, lean: 0.45 * k, twist: 0.05, roll: 0, hp: 0.75 * k, hy: 0,
      lx: -0.25 * k, lz: -0.35, rx: -0.2 * k, rz: 0.45,
      tL: -1.45 * k, sL: 1.45 * k, tR: 0.3 * k, sR: 1.35 * k,
      ba: 0.75, br: 1.6, bh: 0.28, bspin: 0, cape: 0.05,
    };
  }

  animate() {
    const P = this.pose, s = this.st, W = WARDEN;
    const spd = this.moveSpeed;
    this.stride = (this.stride ?? 0) + spd * DT * (Math.PI * 2 / 2.1);
    const ph = this.stride;
    const walk = clamp01(spd / 0.8);
    const br = Math.sin(this.t * 0.045);
    let t = { ...REST, hipY: br * 0.3, hp: 0.1 + br * 0.03, lz: -0.18 - br * 0.03, rz: 0.22 + br * 0.03, cape: 0.15 + br * 0.04 };
    let rate = 0.2;
    // footfalls: a heavy step, the ball scraping behind
    if (this.state === 'move' && walk > 0.2) {
      const prev = this.lastStep ?? 0, cur = Math.floor(ph / Math.PI);
      if (cur !== prev) {
        this.lastStep = cur;
        const side = cur % 2 ? 1 : -1, fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
        vfx.dust(this.x + fz * 0.45 * side, this.z - fx * 0.45 * side, { n: 3, size: 1, palette: 'dustWarm' });
        feedback.shake(0.8, 70);
        bossSfx.clatter(cur);
      }
    }
    switch (this.state) {
      case 'dormant': t = this.kneelPose(1); t.hp = 0.85 + br * 0.04; t.lz = -0.9; t.rz = 0.9; t.lx = 0.15; t.rx = 0.15; break;
      case 'wake': {
        const k = 1 - smooth((s - 8) / 60);
        t = this.kneelPose(k);
        t.hp = 0.85 * k - 0.15 * (1 - k);
        t.lz = -0.9 * (1 - smooth((s - 40) / 24)) - 0.2; t.rz = 0.9 * (1 - smooth((s - 40) / 24)) + 0.2;
        t.lx = 0.15 - 0.4 * smooth((s - 30) / 30); t.rx = t.lx;
        if (s > 50 && s < 64) { t.lz -= 0.25 * Math.sin(s * 1.9); t.rz += 0.25 * Math.sin(s * 1.9); }   // straining at the chains
        rate = 0.25;
        break;
      }
      case 'roar': case 'break': {
        if (this.state === 'break' && s < 34) {
          // reel: knocked back, arms flung, then down on a knee
          const k = smooth((s - 12) / 18);
          t = { ...this.kneelPose(k * 0.75), lean: -0.45 * (1 - k) + 0.5 * k, hp: -0.6 * (1 - k) + 0.6 * k, lx: -0.9, lz: -0.9 * (1 - k) - 0.3, rx: -0.9, rz: 0.9 * (1 - k) + 0.3, ba: 0.6, br: 1.5, bh: 0.28 };
          rate = 0.3;
          break;
        }
        const s2 = this.state === 'break' ? s - 50 : s;
        const up = smooth(s2 / 10) * (1 - smooth((s2 - 50) / 14));
        const rise = this.state === 'break' ? smooth((s - 34) / 20) : 1;
        t = { ...this.kneelPose(0.75 * (1 - rise)) };
        t.lean = -0.38 * up + t.lean * (1 - up); t.hp = -0.75 * up + 0.1 * (1 - up);
        t.lx = -0.7 * up - 0.1; t.lz = -1.25 * up - 0.18; t.rx = -0.7 * up - 0.1; t.rz = 1.25 * up + 0.22;
        if (up > 0.5) { t.roll = Math.sin(s * 2.1) * 0.03; t.hy = Math.sin(s * 1.3) * 0.05; }
        t.cape = 0.6 * up + 0.15;
        rate = 0.25;
        break;
      }
      case 'move': {
        const sw = Math.sin(ph);
        t.tL = -sw * 0.42 * walk; t.tR = sw * 0.42 * walk;
        t.sL = Math.max(0, sw) * 0.55 * walk; t.sR = Math.max(0, -sw) * 0.55 * walk;
        t.hipY = -Math.abs(Math.sin(ph)) * 0.9 * walk + br * 0.3 * (1 - walk);
        t.roll = sw * 0.04 * walk; t.twist = sw * 0.08 * walk;
        t.lx = -0.12 + sw * 0.3 * walk; t.rx = -0.15 - sw * 0.2 * walk;
        t.ba = 0.85 + 0.35 * walk; t.br = 1.75 + 0.3 * walk;   // the ball drags behind on the floor
        t.lean = 0.1 + 0.05 * walk;
        // a scrape of sparks behind the dragged ball
        if (walk > 0.3 && this.t % 7 === 0) {
          const a = this.yaw + t.ba, bx = this.x + Math.sin(a) * t.br, bz = this.z + Math.cos(a) * t.br;
          vfx.embers(bx, 0.15, bz, { n: 2, spread: 0.1, up: 0.4, palette: 'spark' });
        }
        break;
      }
      case 'sweepWind': {
        const u = s / W.sweep.windup;
        const spin = 0.12 + 0.36 * u * u;
        this.whirlA = (this.whirlA ?? 0) + spin;
        t.rx = -2.85; t.rz = 0.25 + Math.sin(this.whirlA) * 0.18; t.lx = -0.35; t.lz = -0.6;
        t.lean = -0.08; t.twist = 0.25 * smooth(s / 10);
        t.ba = this.whirlA; t.br = 1.25 + 0.35 * u; t.bh = 4.6 + Math.sin(this.whirlA * 2) * 0.1; t.bspin = this.whirlA * 0.5;
        t.hipY = -1.2 * smooth(s / 12);
        if (s > W.sweep.windup - 14) { this.tell = (s & 7) < 2 ? 0.16 : 0; this.tellColor = 'red'; }
        rate = s < 6 ? 0.25 : 1;
        if (s === 0) { this.whirlA = 0; }
        break;
      }
      case 'sweep': {
        const arc = W.sweep.arc * Math.PI / 180, u = smooth(s / W.sweep.active);
        const a = arc - 2 * arc * u;
        t.ba = a; t.br = W.sweep.reach - 0.35; t.bh = 0.7; t.bspin = a;
        t.rx = -1.45; t.rz = 0.2 + Math.sin(a) * 0.9; t.twist = a * 0.45; t.lean = 0.25; t.hipY = -1.8;
        t.lx = -0.5; t.lz = -0.8;
        if (s === 0) { P.ba = arc; this.ppose.ba = arc; P.br = t.br; this.ppose.br = t.br; P.bh = 2.4; this.ppose.bh = 3.2; }
        rate = 1;
        break;
      }
      case 'lashWind': {
        const u = smooth(s / 14), loop = s * 0.28;
        t.rx = 0.85 * u; t.rz = 0.35; t.twist = 0.4 * u; t.lean = -0.12 * u; t.lx = -0.8 * u; t.lz = -0.4;
        t.ba = Math.PI - 0.45 + Math.sin(loop) * 0.35 * u; t.br = 1.8; t.bh = 1.3 + Math.cos(loop) * 0.35 * u; t.bspin = loop;
        t.hipY = -0.8 * u;
        if (s > W.lash.windup - 12) { this.tell = (s & 7) < 2 ? 0.16 : 0; this.tellColor = 'red'; }
        rate = 0.4;
        break;
      }
      case 'lash': {
        const u = smooth(s / W.lash.fly);
        t.ba = (Math.PI - 0.45) * (1 - u) + 0.05 * u; t.br = 1.8 + (this.lane - 1.8) * u; t.bh = 1.4 * (1 - u) + 0.3 * u; t.bspin = s;
        t.rx = 0.85 - 2.2 * u; t.rz = 0.3; t.twist = 0.4 - 0.75 * u; t.lean = 0.3 * u; t.hipY = -1.4; t.lx = -0.2; t.lz = -0.5;
        rate = 1;
        break;
      }
      case 'stuck': case 'pull': {
        const yank = this.state === 'stuck' ? Math.max(0, Math.sin((s % 18) / 18 * Math.PI * 2)) : 0;
        const pull = this.state === 'pull' ? smooth(s / W.lash.pull) : 0;
        t.ba = 0.05 + 0.8 * pull; t.br = this.lane * (1 - pull) + 1.75 * pull; t.bh = 0.24 + yank * 0.06; t.bspin = this.state === 'pull' ? -s * 0.6 : 0;
        t.rx = -1.2 + yank * 0.5 + pull * 1.0; t.rz = 0.3; t.lean = -0.15 - yank * 0.2; t.twist = -0.3 * (1 - pull); t.hipY = -1.6 + pull * 1.2;
        t.tL = -0.35; t.sL = 0.3; t.tR = 0.35; t.sR = 0.15;
        t.lx = -0.9; t.lz = -0.3;
        rate = 0.35;
        break;
      }
      case 'stompWind': {
        const u = smooth(s / (W.stomp.windup * 0.6));
        t.tL = -1.15 * u; t.sL = 0.9 * u; t.lean = -0.12 * u; t.roll = 0.06 * u; t.hipY = 0.6 * u;
        t.lx = -0.5 * u; t.lz = -0.7 * u; t.rz = 0.7 * u;
        if (s > W.stomp.windup - 10) { this.tell = (s & 7) < 2 ? 0.16 : 0; this.tellColor = 'red'; }
        rate = 0.3;
        break;
      }
      case 'stomp': t.tL = 0.15; t.sL = 0; t.lean = 0.25; t.hipY = -1.6; t.lz = -0.5; t.rz = 0.5; rate = 0.8; break;
      case 'leapWind': {
        const u = smooth(s / 16);
        t.hipY = -3.6 * u; t.tL = -0.9 * u; t.sL = 1.6 * u; t.tR = -0.9 * u; t.sR = 1.6 * u; t.lean = 0.55 * u;
        t.lx = 1.0 * u; t.rx = 1.0 * u; t.lz = -0.35; t.rz = 0.35; t.hp = -0.3 * u;
        t.ba = 0.9; t.br = 1.6 - 0.4 * u; t.bh = 0.3 + 1.0 * u;
        if (s > W.leap.windup - 12) { this.tell = (s & 7) < 2 ? 0.16 : 0; this.tellColor = 'red'; }
        rate = 0.3;
        break;
      }
      case 'air': {
        const u = s / W.leap.air;
        const fall = u > 0.55;
        t.hipY = 0; t.tL = fall ? -0.3 : 0.3; t.tR = fall ? -0.6 : 0.2; t.sL = fall ? 0.4 : 0.6; t.sR = fall ? 0.9 : 0.6;
        t.lx = fall ? -1.0 : -2.9; t.rx = fall ? -1.0 : -2.9; t.lz = -0.2; t.rz = 0.2; t.lean = fall ? 0.35 : -0.2; t.hp = fall ? 0.4 : -0.2;
        t.ba = 0.3; t.br = 0.9; t.bh = fall ? 0.6 : 4.2; t.bspin = s * 0.4;
        rate = 0.35;
        break;
      }
      case 'land': {
        const u = smooth((s - 30) / 34);
        t.hipY = -4.4 * (1 - u); t.tL = -1.1 * (1 - u); t.sL = 1.5 * (1 - u); t.tR = 0.15 * (1 - u); t.sR = 1.5 * (1 - u);
        t.lean = 0.75 * (1 - u) + 0.1 * u; t.lx = -0.55 * (1 - u); t.rx = -0.55 * (1 - u); t.lz = -0.3; t.rz = 0.3; t.hp = 0.35 * (1 - u);
        t.ba = 0.3 + 0.55 * u; t.br = 1.7; t.bh = 0.26;
        rate = s < 3 ? 1 : 0.2;
        break;
      }
      case 'summon': {
        const u = smooth(s / 10) * (1 - smooth((s - W.summon.windup + 12) / 12));
        t.lx = -2.9 * u - 0.1; t.lz = -0.25 + Math.sin(s * 1.6) * 0.12 * u; t.hp = -0.4 * u; t.lean = -0.1 * u; t.twist = -0.15 * u;
        rate = 0.3;
        break;
      }
      case 'cageWind': case 'cageUp': {
        const up = this.state === 'cageUp';
        const u = smooth(s / 14);
        t.rx = -2.6 * u; t.lx = -2.6 * u; t.rz = 0.6; t.lz = -0.6; t.hp = -0.5 * u; t.lean = -0.15 * u; t.ba = 0.8; t.br = 1.0; t.bh = 3.6 * u + 0.3;
        if (up) { t.rx = -0.8; t.lx = -0.8; t.lean = 0.5; t.hipY = -2.8; t.bh = 0.3; t.ba = 0.4; t.br = 1.6; t.hp = 0.3; }
        if (!up && s > W.cage.windup - 14) { this.tell = (s & 7) < 2 ? 0.16 : 0; this.tellColor = 'red'; }
        rate = up ? 0.6 : 0.2;
        break;
      }
      case 'stagger': {
        const k = smooth(s / 8) * (1 - smooth((s - W.stagger.ticks + 16) / 16));
        t = { ...this.kneelPose(k) };
        t.hp = 0.7 * k + Math.sin(s * 0.2) * 0.05 * k; t.hy = Math.sin(s * 0.07) * 0.25 * k;
        t.roll = Math.sin(s * 0.11) * 0.04 * k;
        this.tell = (s % 30 < 4) ? 0.25 : 0; this.tellColor = 'gold';
        rate = 0.3;
        break;
      }
      case 'recover': {
        const u = smooth(s / (this.recoverFor ?? 30));
        if (this.from === 'sweep') { t.ba = -1.9 * (1 - u) + 0.85 * u; t.br = 3.2 * (1 - u) + 1.75 * u; t.bh = 0.3; t.twist = -0.4 * (1 - u); t.rx = -0.9 * (1 - u) - 0.15 * u; t.lean = 0.25 * (1 - u); t.hipY = -1.5 * (1 - u); }
        rate = 0.2;
        break;
      }
      case 'death': {
        const k1 = smooth(s / 10), k2 = smooth((s - 26) / 16);
        t = { ...this.kneelPose(k2) };
        t.lean = -0.5 * k1 * (1 - k2) + 0.35 * k2; t.hp = -0.8 * k1 * (1 - k2) + 0.6 * k2;
        t.lx = -1.3 * (1 - k2) - 0.2; t.lz = -1.3 * (1 - k2) - 0.3; t.rx = -1.3 * (1 - k2) - 0.2; t.rz = 1.3 * (1 - k2) + 0.3;
        t.ba = 0.6; t.br = 1.6; t.bh = 0.25;
        if (s > 60) { const j = (s - 60) / 50; t.roll = Math.sin(s * 2.7) * 0.05 * j; t.hy = Math.sin(s * 3.1) * 0.1 * j; t.lean += Math.sin(s * 2.3) * 0.04 * j; }
        rate = 0.3;
        break;
      }
      default: break;
    }
    for (const key in t) P[key] = ease(P[key] ?? t[key], t[key], rate);
    if (this.recoil > 0.05) { P.lean -= this.recoil * 0.12 * Math.sign(this.recoilZ || 1); P.hp -= this.recoil * 0.2; }
    if (this.phase === 3 && !this.dying && this.t % 50 === 0) vfx.embers(this.x, 2.6, this.z + 0.45, { n: 2, spread: 0.2, up: 0.8, palette: 'ember' });
  }

  apply(p, alpha) {
    this.hips.position.y = (RIG.hipY + p.hipY) * V;
    this.thighL.rotation.x = p.tL; this.shinL.rotation.x = p.sL;
    this.thighR.rotation.x = p.tR; this.shinR.rotation.x = p.sR;
    this.torso.rotation.set(p.lean, p.twist, p.roll);
    this.neck.rotation.set(p.hp - 0.35, p.hy, 0);       // tipped up a little so the visor shows from above
    this.armL.rotation.set(p.lx, 0, p.lz);
    this.armR.rotation.set(p.rx, 0, p.rz);
    this.cape.rotation.x = -p.cape;
    this.keys.rotation.z = Math.sin((this.t + alpha) * 0.13) * 0.15 + (this.keys.parent === this.handL ? Math.sin((this.t + alpha) * 1.7) * 0.5 : 0);
    // pauldrons ride the shoulders
    this.paulL.rotation.set(p.lx * 0.25, 0, p.lz * 0.3);
    this.paulR.rotation.set(p.rx * 0.25, 0, p.rz * 0.3);
    if (this.dying && this.st > 60 && !this.burst) {
      const j = (this.st - 60) / 50;
      this.body.position.set(Math.sin((this.t + alpha) * 4.1) * 0.03 * j, 0, 0);
    } else this.body.position.set(0, 0, 0);
    // the ball: polar round the Warden, in the yawed group
    if (!this.ballFree) {
      this.ball.position.set(Math.sin(p.ba) * p.br, p.bh + 0.28, Math.cos(p.ba) * p.br);
      this.ball.rotation.set(p.bspin * 0.6, p.bspin, 0);
    } else if (!this.ballSettled) {
      this.ballSettled = true;
    }
    // eyes: dark while dormant, lit after
    const eyesOn = this.eyesLit && !this.burst;
    this.eyeLight.intensity = eyesOn ? (this.state === 'stagger' ? 0.4 : 1.0) : 0;
    const hi = eyesOn ? this.phase : 0;
    this.heads.forEach((m, i) => { m.visible = i === hi; });
    // the chain from the fist to the ball, and the intro's wall chains
    this.group.updateMatrixWorld(true);
    this.handR.getWorldPosition(_v);
    const hx = _v.x, hy = _v.y, hz = _v.z;
    this.ball.getWorldPosition(_w);
    if (!this.burst) layChain(this.links, hx, hy, hz, _w.x, _w.y + 0.42, _w.z, 7.2, 0);
    const chained = this.chained || (this.state === 'wake' && this.st < 64);
    this.wallChains.forEach((links, k) => {
      if (!chained) { if (links[0].visible && !this.chained && this.state !== 'wake') links.forEach((l) => { l.visible = false; }); return; }
      (k ? this.handR : this.handL).getWorldPosition(_v);
      const [wx, wy, wz] = this.wallRings[k];
      layChain(links, wx, wy, wz, _v.x, _v.y, _v.z, 4.6, 0);
    });
    this.renderChunks(alpha);
  }

  render(alpha) {
    super.render(alpha);
    if (this.burst) { this.group.visible = this.ballFree; this.body.visible = false; this.renderChunks(alpha); }
  }

  onDispose() {
    for (const l of this.links) l.removeFromParent();
    for (const a of this.wallChains) for (const l of a) l.removeFromParent();
    for (const c of this.chunks) c.obj.removeFromParent();
    if (this.shape && this.mgr.collision) this.mgr.collision.remove(this.shape);
    this.eyeLight?.remove();
  }

  info() {
    return { ...super.info(), phase: this.phase, poise: Math.round(this.poiseHit), poiseMax: WARDEN.poise, poiseLock: this.poiseLockT,
      waves: this.waves.length, caged: this.caged, ring: this.ringR, staggers: this.staggers, force: this.force, passive: this.passive,
      last: [...this.last], open: this.open, burst: !!this.burst };
  }
}

/** Lay a chain of link meshes from (ax..) to (bx..), sagging by the slack of `len`. */
function layChain(links, ax, ay, az, bx, by, bz, len, floor = 0) {
  const n = links.length;
  const d = Math.hypot(bx - ax, by - ay, bz - az);
  const sag = Math.max(0, len - d) * 0.45;
  let px = ax, py = ay, pz = az;
  for (let i = 0; i < n; i++) {
    const u = (i + 1) / (n + 0.5);
    let x = ax + (bx - ax) * u, y = ay + (by - ay) * u - sag * 4 * u * (1 - u), z = az + (bz - az) * u;
    if (y < floor + 0.06) y = floor + 0.06;
    const m = links[i];
    m.visible = true;
    m.position.set((px + x) / 2, (py + y) / 2, (pz + z) / 2);
    look.snap(m.position);
    _v.set(x, y, z);
    m.lookAt(_v);
    m.rotateZ(i % 2 ? Math.PI / 2 : 0);
    px = x; py = y; pz = z;
  }
}

/** Fill an annulus r0..r1 round (x, z): the cage's warning, or a ring about to roll. */
function ringZone(T, x, z, r0, r1, p, t, outward, firing = false) {
  const late = p > 0.75 && !firing, blink = late && ((t >> 1) & 1);
  const Vx = V;
  const ix0 = Math.floor((x - r1) / Vx), ix1 = Math.floor((x + r1) / Vx), iz0 = Math.floor((z - r1) / Vx), iz1 = Math.floor((z + r1) / Vx);
  const fillR = outward ? r0 + (r1 - r0) * p : r1 - (r1 - r0) * p;
  for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
    const wx = (ix + 0.5) * Vx, wz = (iz + 0.5) * Vx, d = Math.hypot(wx - x, wz - z);
    if (d < r0 || d > r1) continue;
    if (d > PIT.RF) continue;
    const edge = d < r0 + Vx || d > r1 - Vx;
    if (firing) { T.dot(wx, wz, edge ? 'gold' : ((ix + iz) & 1 ? 'red' : 'gold')); continue; }
    if (edge && d < r0 + Vx) { T.dot(wx, wz, blink ? 'gold' : 'red'); continue; }
    if (edge) continue;
    // fill sweeps from the bars outward to the pit's edge
    if (outward ? d > fillR : d < fillR) continue;
    if (Math.abs(d - fillR) < 1.5 * Vx && p < 1) T.dot(wx, wz, 'red');
    else if ((ix + iz) & 1) T.dot(wx, wz, 'blood');
  }
}

/** A rolling shockwave: a red band with a gold front, a scatter of blood behind it. */
function ringBand(T, x, z, r, half) {
  const r0 = Math.max(0, r - half - 0.25), r1 = r + half;
  const ix0 = Math.floor((x - r1) / V), ix1 = Math.floor((x + r1) / V), iz0 = Math.floor((z - r1) / V), iz1 = Math.floor((z + r1) / V);
  for (let iz = iz0; iz <= iz1; iz++) {
    const wz = (iz + 0.5) * V, dz = wz - z;
    if (Math.abs(dz) > r1) continue;
    for (let ix = ix0; ix <= ix1; ix++) {
      const wx = (ix + 0.5) * V, d = Math.hypot(wx - x, dz);
      if (d < r0 || d > r1 || d > PIT.RF) continue;
      if (d > r1 - V) T.dot(wx, wz, 'gold');
      else if (d > r - half) T.dot(wx, wz, (ix + iz) & 1 ? 'red' : 'torch');
      else if ((ix + iz) & 1) T.dot(wx, wz, 'blood');
    }
  }
}

export { layChain, EYE };
