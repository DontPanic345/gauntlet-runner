// Husk (piece `enemies`): the shambling chaser. Slow, lurching, never stops coming.
//
//   move     lurches toward its flanking slot in surges (one good leg, one dragging), arms
//            rising to reach for the hero as it closes in
//   windup   30 ticks: rears back, both claws raised overhead, jaw drops, a groan; the floor
//            sector fills toward the hero; the body pulses red over the last 10 ticks
//   attack   a double-claw slam with a lunge; the sector flashes gold; the hit test is the
//            drawn sector from the origin locked at the end of the windup
//   recover  40 ticks hunched over with its arms hanging: the opening
//   hurt     every hit staggers it (poise 0): head snaps back, arms flail
//   death    a flop: arms thrown up, it topples backward away from the blow, bounces,
//            lies still, twitches once, then crumbles into rot and bone

import { vfx } from '../vfx/vfx.js';
import { events } from '../core/events.js';
import { DT } from '../core/loop.js';
import { Enemy, part, pivot, ease, smooth, clamp01, V } from './enemy.js';
import { enemySfx } from './sfx.js';
import { dmg } from './data.js';
import { quake } from './shake.js';

export class Husk extends Enemy {
  build() {
    const M = this.material;
    this.faller = pivot(this.body, 0, 0, 0);
    this.hips = pivot(this.faller, 0, 4, 0);
    this.legL = pivot(this.hips, -1.2, 0, 0, part('enemies.husk.legL', M));
    this.legR = pivot(this.hips, 1.2, 0, 0, part('enemies.husk.legR', M));
    this.torso = pivot(this.hips, 0, 0, 0, part('enemies.husk.torso', M));
    this.head = pivot(this.torso, 0, 5, 0.4, part('enemies.husk.head', M));
    this.jaw = pivot(this.head, 0, 1, 0.5, part('enemies.husk.jaw', M));
    this.armL = pivot(this.torso, -3.9, 4.6, 0.3, part('enemies.husk.armL', M));
    this.armR = pivot(this.torso, 3.9, 4.6, 0.3, part('enemies.husk.armR', M));
    this.phase = this.rand() * 6;
    this.reach = 0;          // 0..1: arms raised toward the hero when close
    Object.assign(this.pose, { rise: 0, fall: 0, hipY: 0, hunch: 0.45, roll: 0, twist: 0, hp: 0, hr: 0, hy: 0, jaw: 0.1,
      lx: -0.2, lz: -0.1, rx: -0.2, rz: 0.1, legL: 0, legR: 0 });
  }

  get attacking() { return this.state === 'windup' || this.state === 'attack'; }
  get A() { return this.D.attack; }

  beginSpawn() {
    if (this.spawnKind === 'instant') { this.setState('move'); return; }
    this.visible = false;
    const p = vfx.spawnPortal(this.x, this.z, { dur: 0.8, radius: 0.75, palette: 'rose' });
    this.popAt = p.popTick + this.spawnDelay;
    this.pose.rise = -14;
  }
  tickSpawn() {
    const k = this.st - this.popAt;
    if (k < 0) return;
    if (k === 0) { this.visible = true; enemySfx.spawn('husk'); vfx.dust(this.x, this.z, { n: 10, size: 1.2, palette: 'dustWarm' }); }
    if (k % 5 === 0 && k < 24) vfx.dust(this.x, this.z, { n: 3, size: 0.8, palette: 'dustWarm', spread: 2 });
    if (k === 26) { this.squash = 0.4; }
    if (k >= 40) this.setState('move');
  }

  think() {
    const A = this.A;
    const th = this.toHero();
    switch (this.state) {
      case 'move': {
        if (!this.ai) { this.puppetBusy = false; this.idleHome(); break; }
        if (!th) { this.stop(); break; }
        const lurch = 0.5 + 0.5 * Math.max(0, Math.sin(this.phase));
        const p = this.slotPoint(this.D.standoff);
        this.seek(p.x, p.z, this.speed * lurch, 0.5);
        if (th.d < 2.6 || this.moveSpeed < 0.15) this.turnTo(th.yaw, 0.08);
        else this.turnTo(Math.atan2(this.mvx, this.mvz), 0.06);
        if (this.cool > 0) this.cool--;
        const facing = Math.abs(((th.yaw - this.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.6;
        if (th.d <= A.range && this.cool <= 0 && facing && this.takeToken()) this.startWindup();
        break;
      }
      case 'windup': {
        this.stop();
        if (th && this.st < A.windup * 0.6) this.turnTo(th.yaw, 0.07);   // tracks, then commits
        if (this.st === A.windup - 10) events.emit('enemy:commit', { enemy: this });
        if (this.st >= A.windup) {
          this.setState('attack');
          this.ax = this.x; this.az = this.z; this.ayaw = this.yaw; this.swung = false;
          this.mvx = Math.sin(this.yaw) * A.lunge; this.mvz = Math.cos(this.yaw) * A.lunge;
          enemySfx.swipe();
          vfx.slash(this.x + Math.sin(this.yaw) * 0.1, 0.55, this.z + Math.cos(this.yaw) * 0.1, this.yaw, { palette: 'enemy', span: A.arc * 2 * Math.PI / 180, radius: A.reach * 0.85, thick: 0.42, life: 0.2, mirror: this.attacks % 2 ? -1 : 1 });
        }
        break;
      }
      case 'attack': {
        this.stop();
        if (!this.swung && this.st >= 1 && this.heroInSector(this.ax, this.az, this.ayaw, A.reach, A.arc)) { this.swung = true; this.hurtHero(dmg(A.dmg)); }
        if (this.st === 2) { vfx.dust(this.x + Math.sin(this.yaw) * 0.5, this.z + Math.cos(this.yaw) * 0.5, { n: 5, size: 0.9, dx: Math.sin(this.yaw), dz: Math.cos(this.yaw), palette: 'dustWarm' }); }
        if (this.st >= A.active) this.setState('recover');
        break;
      }
      case 'recover':
        this.stop();
        if (this.st >= A.recover) { this.dropToken(); this.cool = this.cooldownTicks(); this.setState('move'); }
        break;
    }
  }

  startWindup() {
    this.setState('windup');
    this.attacks++;
    enemySfx.windup('husk', this.A.windup / 60);
    events.emit('combat:enemyWindup', { enemy: this, x: this.x, z: this.z });
  }

  /** Lineup: play the attack at once, toward the stand-in. */
  act(what) {
    if (this.state === 'move') { this.puppetBusy = true; this.startWindup(); }
  }

  interrupt() { super.interrupt(); if (this.attacking) this.swung = true; }

  telegraph(T) {
    const A = this.A;
    if (this.state === 'windup') T.sector(this.x, this.z, this.yaw, A.reach, A.arc, Math.min(1, this.st / A.windup), { t: this.st });
    else if (this.state === 'attack' && this.st <= 3) T.sector(this.ax, this.az, this.ayaw, A.reach, A.arc, 1, { firing: true });
  }

  onDeath() {
    enemySfx.death('husk');
    // fall away from the blow (bent sideways so it reads from above): face the other way, topple backward
    const [fx, fz] = this.fallDir(this.deathDX, this.deathDZ);
    this.yaw = Math.atan2(-fx, -fz);
    this.pyaw = this.yaw;
  }

  tickDeath() {
    const k = this.st;
    if (k === 17) { enemySfx.thud(0.9); vfx.land(this.x - Math.sin(this.yaw) * 0.6, this.z - Math.cos(this.yaw) * 0.6, { size: 0.9 }); quake(1.5, 90); }
    if (k === 62) {
      // crumble: rot and bone burst out of the body lying on the floor
      const bx = this.x - Math.sin(this.yaw) * 0.55, bz = this.z - Math.cos(this.yaw) * 0.55;
      vfx.death(bx, 0.25, bz, { colors: this.debris, power: 0.8, ring: 'moss' });
      enemySfx.crumble();
      this.mgr.decal(bx, bz, 'rot', { r: 0.5, life: 260 });
    }
    if (k === 66) this.visible = false;
    if (k > 70) this.remove = true;
  }

  animate() {
    const P = this.pose, A = this.A, s = this.st;
    const spd = this.moveSpeed;
    this.phase += spd * DT * (Math.PI * 2 / 0.95);
    const walk = clamp01(spd / 0.8);
    const idle = Math.sin(this.t * 0.045 + this.seed % 7);
    const th = this.state === 'move' ? this.toHero() : null;
    this.reach = ease(this.reach, th && th.d < 3.2 ? 1 : 0, 0.06);
    const k = 0.25;   // how fast poses are chased
    let tgt;
    switch (this.state) {
      case 'spawn': {
        const kk = this.st - (this.popAt ?? 0);
        const u = smooth(kk / 26);
        tgt = { rise: -14 * (1 - u), fall: 0, hipY: 0, hunch: 0.2 + 0.3 * u, roll: Math.sin(kk * 0.5) * 0.15 * (1 - u), twist: 0, hp: -0.4 * (1 - u), hr: 0, hy: 0, jaw: 0.5 * (1 - u),
          lx: -2.8 + 2.4 * u + Math.sin(kk * 0.7) * 0.3 * (1 - u), lz: -0.3, rx: -2.8 + 2.4 * u + Math.cos(kk * 0.7) * 0.3 * (1 - u), rz: 0.3, legL: 0, legR: 0 };
        Object.assign(P, tgt);
        return;
      }
      case 'windup': {
        const u = smooth(s / (A.windup * 0.45));          // snaps up fast, then holds and trembles
        const tr = s > A.windup - 12 ? Math.sin(s * 2.1) * 0.06 : 0;
        tgt = { hipY: 0.5 * u, hunch: 0.45 - 0.75 * u, roll: tr, twist: 0, hp: -0.45 * u, hr: tr * 2, hy: 0, jaw: 0.1 + 0.55 * u,
          lx: -0.3 - 2.45 * u, lz: -0.35 * u + tr, rx: -0.3 - 2.45 * u, rz: 0.35 * u - tr, legL: -0.25 * u, legR: 0.3 * u };
        if (s > A.windup - 10) { this.tell = (s >> 1) & 1 ? 0.3 : 0; this.tellColor = 'red'; }
        break;
      }
      case 'attack': {
        const u = smooth(s / 3);
        tgt = { hipY: -0.6 * u, hunch: -0.3 + 1.3 * u, roll: 0, twist: 0, hp: 0.3 * u, hr: 0, hy: 0, jaw: 0.65 - 0.6 * u,
          lx: -2.75 + 2.5 * u, lz: -0.35 + 0.2 * u, rx: -2.75 + 2.5 * u, rz: 0.35 - 0.2 * u, legL: -0.45, legR: 0.35 };
        Object.assign(P, tgt);    // the slam is instant: no chasing
        this.applyWalk(P, 0);
        return;
      }
      case 'recover': {
        const u = smooth(s / A.recover);
        tgt = { hipY: -0.6 * (1 - u), hunch: 1.0 - 0.5 * u, roll: Math.sin(s * 0.15) * 0.06, twist: 0, hp: 0.35 * (1 - u), hr: Math.sin(s * 0.1) * 0.2, hy: 0, jaw: 0.25,
          lx: 0.15 + Math.sin(s * 0.2) * 0.15, lz: -0.15, rx: 0.15 - Math.sin(s * 0.2) * 0.15, rz: 0.15, legL: -0.45 * (1 - u), legR: 0.35 * (1 - u) };
        break;
      }
      case 'hurt': {
        tgt = { hipY: -0.3, hunch: 0.1, roll: 0, twist: 0, hp: -0.6, hr: 0.3, hy: 0, jaw: 0.6, lx: -1.6, lz: -0.6, rx: -1.3, rz: 0.7, legL: 0.2, legR: -0.1 };
        break;
      }
      case 'death': {
        // arms thrown up, then a backward topple with a bounce, a twitch, then it sinks
        const f = s < 5 ? 0 : s < 17 ? Math.PI / 2 * ((s - 5) / 12) ** 2 : s < 23 ? Math.PI / 2 - Math.sin((s - 17) / 6 * Math.PI) * 0.18 : Math.PI / 2;
        const twitch = s > 40 && s < 46 ? Math.sin(s * 3) * 0.4 : 0;
        const sink = s > 58 ? -(s - 58) * 0.25 : 0;
        Object.assign(P, { rise: sink, fall: -f, hipY: 0, hunch: s < 17 ? -0.2 : 0.15, roll: 0, twist: 0, hp: s < 17 ? -0.7 : 0.4, hr: 0.3, hy: 0, jaw: 0.8,
          lx: s < 17 ? -2.6 : -2.9 + twitch, lz: -0.5, rx: s < 17 ? -2.4 : -2.2, rz: 0.6, legL: s < 17 ? -0.4 : -0.1, legR: 0.3 });
        return;
      }
      default: {
        // shamble: surging steps, torso lurching over the good leg, head lolling
        const ph = this.phase;
        const reach = this.reach;
        tgt = { hipY: -Math.abs(Math.sin(ph)) * 0.7 * walk + (1 - walk) * idle * 0.2, hunch: 0.45 + 0.12 * Math.sin(ph * 2) * walk - 0.15 * reach, roll: Math.sin(ph) * 0.14 * walk + idle * 0.05 * (1 - walk),
          twist: Math.sin(ph) * 0.12 * walk, hp: 0.1 + Math.sin(this.t * 0.03) * 0.08 - 0.3 * reach, hr: Math.sin(this.t * 0.035 + 1) * 0.25, hy: Math.sin(this.t * 0.021) * 0.2 * (1 - reach),
          jaw: 0.15 + 0.15 * Math.max(0, Math.sin(this.t * 0.11)) + 0.2 * reach,
          lx: -0.15 - Math.sin(ph) * 0.35 * walk - 1.2 * reach, lz: -0.12, rx: -0.15 + Math.sin(ph) * 0.35 * walk - 1.35 * reach + Math.sin(this.t * 0.2) * 0.1 * reach, rz: 0.12,
          legL: 0, legR: 0 };
      }
    }
    for (const key in tgt) P[key] = ease(P[key], tgt[key], k);
    P.rise = ease(P.rise, 0, 0.3); P.fall = ease(P.fall, 0, 0.3);
    if (this.state === 'move' || this.state === 'hurt') this.applyWalk(P, walk);
    // recoil from a hit: a snap of the torso and head away from the blow
    if (this.recoil > 0.05) { P.hunch -= this.recoil * 0.5; P.hp -= this.recoil * 0.5; P.jaw = Math.max(P.jaw, this.recoil * 0.7); }
  }

  applyWalk(P, walk) {
    // the right leg drags: short, late swing
    const ph = this.phase;
    P.legL = ease(P.legL, -Math.sin(ph) * 0.55 * walk, 0.5);
    P.legR = ease(P.legR, Math.sin(ph - 0.6) * 0.28 * walk, 0.5);
  }

  apply(p) {
    this.faller.rotation.x = p.fall;
    this.faller.position.y = p.rise * V;
    this.hips.position.y = (4 + p.hipY) * V;
    this.torso.rotation.set(p.hunch, p.twist, p.roll);
    this.head.rotation.set(p.hp - 0.75, p.hy, p.hr);   // tipped up against the hunch so the face shows from above
    this.jaw.rotation.x = p.jaw;
    this.armL.rotation.set(p.lx, 0, p.lz);
    this.armR.rotation.set(p.rx, 0, p.rz);
    this.legL.rotation.x = p.legL;
    this.legR.rotation.x = p.legR;
  }
}
