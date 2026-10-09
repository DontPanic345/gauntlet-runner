// Mite (piece `enemies`): a glowing crypt tick, four voxels tall. Comes five at a time.
//
//   spawn    one portal flings the whole swarm out onto a ring round it
//   move     scuttles fast and jittery (zig-zags, freezes for a few ticks, darts on) to its
//            own slot on a ring round the hero just outside sword reach; the ring slowly turns,
//            so a swarm surrounds and circles instead of piling up
//   windup   16 ticks: stops dead, crouches, rears its front up and flashes; a small disc
//            fills on the floor exactly where it will land
//   hop      an 11-tick leap (up to 1.75 units) onto that disc; it bites whatever is in the
//            disc when it lands. Walking out of the disc is enough to avoid it.
//   recover  40 ticks shaking itself off, right next to you: the opening
//   hurt     8 hp: one sword hit kills it
//   death    flips onto its back, legs kicking, then pops in a spray of teal goo that stains
//            the floor

import { vfx } from '../vfx/vfx.js';
import { events } from '../core/events.js';
import { DT } from '../core/loop.js';
import { Enemy, part, pivot, ease, smooth, clamp01, wrap, V } from './enemy.js';
import { enemySfx } from './sfx.js';
import { dmg } from './data.js';

export class Mite extends Enemy {
  build() {
    const M = this.material;
    this.tip = pivot(this.body, 0, 0, 0);
    this.shell = part('enemies.mite.body', M);
    this.legs = [part('enemies.mite.legs0', M), part('enemies.mite.legs1', M)];
    this.deadMesh = part('enemies.mite.dead', M);
    this.deadMesh.visible = false;
    this.tip.add(this.shell, ...this.legs, this.deadMesh);
    this.phase = this.rand() * 4;
    this.freeze = 0;
    Object.assign(this.pose, { hy: 0, pitch: 0, roll: 0, crouch: 0, flip: 0 });
  }

  get attacking() { return this.state === 'windup' || this.state === 'hop'; }
  get A() { return this.D.attack; }

  beginSpawn() {
    if (this.spawnKind === 'instant') { this.setState('move'); return; }
    this.visible = false;
    if (this.spawnKind === 'fling') { this.popAt = this.spawnDelay; return; }
    const p = vfx.spawnPortal(this.x, this.z, { dur: 0.6, radius: 0.4, palette: 'cool' });
    this.popAt = p.popTick + this.spawnDelay;
    this.spawnFrom = null;
  }
  tickSpawn() {
    const k = this.st - this.popAt;
    if (k < 0) return;
    const F = this.spawnFrom;
    if (k === 0) { this.visible = true; enemySfx.hop(); }
    if (F) {
      const u = Math.min(1, k / 14);
      this.x = F.x + (F.tx - F.x) * u; this.z = F.z + (F.tz - F.z) * u;
      this.y = Math.sin(u * Math.PI) * 0.7;
      if (u >= 1) { this.y = 0; this.spawnFrom = null; this.squash = 0.5; vfx.dust(this.x, this.z, { n: 2, size: 0.5 }); }
    }
    if (k >= 20) { this.y = 0; this.setState('move'); }
  }

  think() {
    const A = this.A;
    const th = this.toHero();
    switch (this.state) {
      case 'move': {
        if (!this.ai) { this.puppetBusy = false; this.idleHome(); break; }
        if (!th) { this.stop(); break; }
        if (this.cool > 0) this.cool--;
        if (this.freeze > 0) { this.freeze--; this.stop(); this.turnTo(th.yaw, 0.25); break; }
        if (this.rand() < 0.012) { this.freeze = 5 + Math.floor(this.rand() * 10); break; }   // insects stop dead
        // the swarm rings the hero just outside sword reach and slowly circles
        // (the slot follows its current angle, so aiming a little ahead of it keeps it circling)
        const h = th.h, a = (this.slot ?? Math.atan2(this.x - h.x, this.z - h.z)) + (this.D.orbit ?? 0) * 25;
        const p = { x: h.x + Math.sin(a) * this.D.standoff, z: h.z + Math.cos(a) * this.D.standoff };
        this.seek(p.x, p.z, this.speed, 0.3);
        // zig-zag across the line of travel
        const z = Math.sin(this.t * 0.35 + this.seed) * 0.7 * this.speed;
        const l = Math.hypot(this.want.x, this.want.z);
        if (l > 0.3) { const wx = this.want.x, wz = this.want.z; this.want.x = wx - (wz / l) * z; this.want.z = wz + (wx / l) * z; }
        if (th.d < 1.6 && l < 0.5) this.turnTo(th.yaw, 0.3);
        else if (this.moveSpeed > 0.2) this.turnTo(Math.atan2(this.mvx, this.mvz), 0.35);
        if (th.d <= A.range && this.cool <= 0 && this.takeToken()) this.startWindup(th);
        break;
      }
      case 'windup': {
        this.stop();
        if (this.st === A.windup - 6) events.emit('enemy:commit', { enemy: this });
        if (this.st >= A.windup) {
          this.setState('hop');
          this.hx = this.x; this.hz = this.z;
          enemySfx.hop();
          vfx.dust(this.x, this.z, { n: 2, size: 0.5, dx: -Math.sin(this.yaw), dz: -Math.cos(this.yaw) });
        }
        break;
      }
      case 'hop': {
        this.stop(); this.mvx = 0; this.mvz = 0;
        const u = Math.min(1, this.st / A.active);
        const nx = this.hx + (this.lx - this.hx) * u, nz = this.hz + (this.lz - this.hz) * u;
        this.moveBy(nx - this.x, nz - this.z);
        this.y = Math.sin(u * Math.PI) * 0.42;
        if (u >= 1) {
          this.y = 0; this.squash = 0.6;
          if (this.heroInDisc(this.lx, this.lz, A.radius)) { enemySfx.bite(); this.hurtHero(dmg(A.dmg)); }
          vfx.dust(this.x, this.z, { n: 3, size: 0.55 });
          this.setState('recover');
        }
        break;
      }
      case 'recover':
        this.stop();
        if (this.st >= A.recover) { this.dropToken(); this.cool = this.cooldownTicks(); this.setState('move'); }
        break;
    }
  }

  startWindup(th) {
    const A = this.A;
    this.setState('windup');
    this.attacks++;
    const d = Math.min(Math.max(0, th.d - 0.15), A.hop);
    this.lx = this.x + th.dx * d; this.lz = this.z + th.dz * d;
    this.yaw = th.yaw;
    enemySfx.windup('mite');
    events.emit('combat:enemyWindup', { enemy: this, x: this.x, z: this.z });
  }
  act(what) {
    if (this.state !== 'move') return;
    const th = this.toHero();
    if (th) { this.puppetBusy = true; this.startWindup(th); }
  }

  telegraph(T) {
    const A = this.A;
    if (this.state === 'windup') T.disc(this.lx, this.lz, A.radius, Math.min(1, this.st / A.windup), { t: this.st });
    else if (this.state === 'hop') T.disc(this.lx, this.lz, A.radius, 1, { firing: this.st >= A.active - 2, t: this.st });
  }

  onDeath() {
    enemySfx.death('mite');
    this.vy = Math.max(this.vy, 3.2);             // flips up off the floor
  }
  tickDeath() {
    const k = this.st;
    if (k === 14) {
      // pop: goo chunks, a cool spark ring, a stain
      const y = 0.15 + this.y;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2 + this.rand(), sp = 1.2 + this.rand() * 2.2;
        const j = vfx.core.add(this.x, y, this.z, Math.sin(a) * sp, 2 + this.rand() * 3, Math.cos(a) * sp, 0.7, i % 3 ? 2 : 3, this.debris[i % 3], vfx.core.CUBE);
        if (j >= 0) { vfx.core.P.grav[j] = 20; vfx.core.P.bounce[j] = 0.2; vfx.core.P.floorY[j] = 0.03; vfx.core.P.pop[j] = 1.5; vfx.core.P.shrinkAt[j] = 0.7; vfx.core.P.fadeAt[j] = 0.7; }
      }
      vfx.hitSpark(this.x, y, this.z, { dx: this.deathDX, dz: this.deathDZ, power: 0.6, palette: 'cool', light: false });
      this.mgr.decal(this.x, this.z, 'goo', { r: 0.28, life: 220 });
      enemySfx.death('mite');
    }
    if (k === 15) this.visible = false;
    if (k > 22) this.remove = true;
  }

  animate() {
    const P = this.pose, A = this.A, s = this.st;
    const spd = this.moveSpeed;
    this.phase += spd * DT * 9 + (this.state === 'death' && s < 14 ? 0.5 : 0);
    let t = { hy: 0, pitch: 0, roll: 0, crouch: 0, flip: 0 };
    switch (this.state) {
      case 'windup': {
        const u = smooth(s / 6);
        t = { hy: 0, pitch: -0.55 * u, roll: 0, crouch: 0.35 * u, flip: 0 };
        this.tell = (s >> 2) & 1 ? 0.3 : 0; this.tellColor = 'red';
        break;
      }
      case 'hop': t = { hy: 0, pitch: 0.35, roll: 0, crouch: -0.25, flip: 0 }; break;
      case 'recover': t = { hy: 0, pitch: 0, roll: s < 16 ? Math.sin(s * 1.6) * 0.3 : 0, crouch: 0, flip: 0 }; break;
      case 'hurt': t = { hy: 0, pitch: -0.4, roll: 0.4, crouch: 0, flip: 0 }; break;
      case 'death': t = { hy: 0, pitch: 0, roll: 0, crouch: 0, flip: 1 }; break;
      default: t.roll = Math.sin(this.phase * 0.5) * 0.08 * clamp01(spd);
    }
    const k = this.state === 'windup' || this.state === 'hop' ? 0.5 : 0.35;
    for (const key in t) P[key] = ease(P[key], t[key], k);
  }

  apply(p) {
    const dead = this.dying;
    this.shell.visible = !dead; this.deadMesh.visible = dead;
    const f = dead ? (this.st >> 1) & 1 : Math.floor(this.phase) & 1;
    this.legs[0].visible = !dead && f === 0; this.legs[1].visible = !dead && f === 1;
    this.tip.rotation.set(p.pitch, 0, p.roll);
    this.tip.scale.set(1 + p.crouch * 0.3, 1 - p.crouch * 0.5, 1);
    if (dead) this.tip.rotation.z = (this.st & 2 ? 0.2 : -0.2);   // legs kick, body rocks
  }
}
