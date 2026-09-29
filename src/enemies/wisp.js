// Ember Wisp (piece `enemies`): a coal skull in a flame, floating. Keeps its distance and
// lobs slow ember orbs.
//
//   move     holds a band of distance from the hero (keep [min, max]): backs off when you
//            close in, drifts closer when you run, and circles sideways, flipping direction
//            when it meets a wall. Always faces you.
//   windup   42 ticks: the flame swells, embers are sucked into the skull, a rising whine; a
//            dotted aim line on the floor tracks you, then locks for the last 12 ticks
//   fire     the orb(s) leave along the locked line; the wisp recoils and its flame flattens
//   orbs     slow (3.1 u/s), with a red ring on the floor under them. A dash passes through
//            them (i-frames); a wall or the hero pops them. They scorch the floor.
//   hurt     every hit staggers it: the flame gutters and it is knocked back
//   death    the flame gutters and goes out in a puff of smoke; the coal skull drops,
//            bounces once, and shatters into cinders

import { vfx } from '../vfx/vfx.js';
import { events } from '../core/events.js';
import { DT } from '../core/loop.js';
import { Enemy, part, pivot, ease, smooth, clamp01, wrap, V } from './enemy.js';
import { makeVoxelMaterial } from '../render/voxel/index.js';
import { enemySfx } from './sfx.js';
import { dmg } from './data.js';

export class Wisp extends Enemy {
  build() {
    const M = this.material;
    this.shadow = part('enemies.shadow', M);
    this.shadow.position.y = 0.005;
    this.group.add(this.shadow);
    this.floater = pivot(this.body, 0, 0, 0);
    this.core = pivot(this.floater, 0, 0, 0, part('enemies.wisp.core', M));
    this.flameMat = makeVoxelMaterial();      // the tell tints only the skull; fire stays fire
    this.flames = [0, 1, 2].map((f) => part(`enemies.wisp.flame${f}`, this.flameMat));
    this.flame = pivot(this.floater, 0, 0, 0, ...this.flames);
    this.orbit = this.rand() < 0.5 ? 1 : -1;
    this.flipT = 90 + Math.floor(this.rand() * 120);
    this.aim = 0;
    Object.assign(this.pose, { fy: this.D.float * 8, fs: 1, fh: 1, lean: 0, roll: 0, cy: 0, ct: 0, sh: 1 });
  }

  get attacking() { return this.state === 'windup'; }
  get A() { return this.D.attack; }
  canStagger() { return this.state !== 'spawn'; }

  beginSpawn() {
    if (this.spawnKind === 'instant') { this.setState('move'); return; }
    this.visible = false;
    const p = vfx.spawnPortal(this.x, this.z, { dur: 0.7, radius: 0.6, palette: 'ember' });
    this.popAt = p.popTick + this.spawnDelay;
  }
  tickSpawn() {
    const k = this.st - this.popAt;
    if (k < 0) return;
    if (k === 0) {
      this.visible = true;
      enemySfx.spawn('wisp');
      vfx.flash(this.x, this.D.float + 0.2, this.z, { color: 'flame', size: 0.7 });
      vfx.embers(this.x, this.D.float, this.z, { n: 16, spread: 0.3, up: 1.1 });
    }
    if (k >= 22) this.setState('move');
  }

  think() {
    const A = this.A, D = this.D;
    const th = this.toHero();
    switch (this.state) {
      case 'move': {
        if (!this.ai) { this.puppetBusy = false; this.idleHome(); break; }
        if (!th) { this.stop(); break; }
        const [lo, hi] = D.keep;
        let radial = 0;
        if (th.d < lo) radial = -Math.min(1, (lo - th.d) / 1.2 + 0.35);
        else if (th.d > hi) radial = Math.min(1, (th.d - hi) / 1.5 + 0.2) * 0.8;
        if (--this.flipT <= 0) { this.orbit = -this.orbit; this.flipT = 120 + Math.floor(this.rand() * 140); }
        const tx = th.dz * this.orbit, tz = -th.dx * this.orbit;
        const sp = this.speed;
        let wx = (th.dx * radial + tx * 0.55) * sp, wz = (th.dz * radial + tz * 0.55) * sp;
        // walls: look ahead; if the way is shut, circle the other way and slide off the wall
        const cw = this.mgr.collision;
        if (cw && cw.blocked(this.x + wx * 0.35, this.z + wz * 0.35, this.r + 0.15)) {
          if (this.flipT > 30) { this.orbit = -this.orbit; this.flipT = 30; }
          wx = (th.dx * radial * 0.3 - tx * 0.8) * sp; wz = (th.dz * radial * 0.3 - tz * 0.8) * sp;
        }
        this.want.x = wx; this.want.z = wz;
        this.turnTo(th.yaw, 0.14);
        if (this.cool > 0) this.cool--;
        if (this.cool <= 0 && th.d < A.range && th.d > 1.2 && this.clearTo(th.h.x, th.h.z, A.orbRadius)) this.startWindup();
        break;
      }
      case 'windup': {
        this.want.x *= 0.9; this.want.z *= 0.9;
        if (th) this.turnTo(th.yaw, 0.14);
        if (th && this.st < A.windup - 12) this.aim = th.yaw;           // tracks, then locks
        if (this.st % 3 === 0) this.suck();
        if (this.st >= A.windup) this.fire();
        break;
      }
      case 'recover':
        this.want.x *= 0.85; this.want.z *= 0.85;
        if (th) this.turnTo(th.yaw, 0.1);
        if (this.st >= A.recover) { this.cool = this.cooldownTicks(); this.setState('move'); }
        break;
    }
  }

  startWindup() {
    this.setState('windup');
    this.attacks++;
    const th = this.toHero();
    this.aim = th ? th.yaw : this.yaw;
    enemySfx.windup('wisp', this.A.windup / 60);
    events.emit('combat:enemyWindup', { enemy: this, x: this.x, z: this.z });
  }
  act(what) { if (this.state === 'move') { this.puppetBusy = true; this.startWindup(); } }

  /** Embers drawn in from a ring round the skull. */
  suck() {
    const y = this.D.float + 0.1;
    for (let k = 0; k < 2; k++) {
      const a = this.rand() * Math.PI * 2, r = 0.75;
      const x = this.x + Math.sin(a) * r, z = this.z + Math.cos(a) * r * 0.8, yy = y + (this.rand() - 0.3) * 0.6;
      const i = vfx.core.add(x, yy, z, (this.x - x) * 4.2, (y - yy) * 4.2, (this.z - z) * 4.2, 0.22, this.rand() < 0.3 ? 2 : 1, 'ember', vfx.core.SPRITE);
      if (i >= 0) { vfx.core.P.pop[i] = 1; vfx.core.P.fadeAt[i] = 0.9; }
    }
  }

  fire() {
    const A = this.A;
    const n = Math.max(1, A.orbs | 0);
    const y = this.D.float + 0.05;
    for (let k = 0; k < n; k++) {
      const a = this.aim + (n === 1 ? 0 : (k / (n - 1) - 0.5) * 2 * A.spread);
      const dx = Math.sin(a), dz = Math.cos(a);
      this.mgr.fireOrb(this, this.x + dx * 0.35, y, this.z + dz * 0.35, dx, dz, { speed: A.orbSpeed * (this.speed / this.D.speed), life: A.orbLife, radius: A.orbRadius, dmg: dmg(A.dmg) });
    }
    const dx = Math.sin(this.aim), dz = Math.cos(this.aim);
    this.mvx = -dx * 3; this.mvz = -dz * 3;
    this.squash = 0.6;
    vfx.flash(this.x + dx * 0.35, y, this.z + dz * 0.35, { color: 'flame', size: 0.45 });
    enemySfx.fire();
    events.emit('enemy:fire', { enemy: this, x: this.x, z: this.z, yaw: this.aim });
    this.setState('recover');
  }

  telegraph(T) {
    if (this.state !== 'windup') return;
    const A = this.A, n = Math.max(1, A.orbs | 0);
    const p = Math.min(1, this.st / A.windup);
    const locked = this.st >= A.windup - 12;
    for (let k = 0; k < n; k++) {
      const a = this.aim + (n === 1 ? 0 : (k / (n - 1) - 0.5) * 2 * A.spread);
      const dx = Math.sin(a), dz = Math.cos(a);
      // a dotted line: dots march outward as it charges; solid and blinking once locked
      const len = 3.2;
      for (let d = 0.5; d < len; d += 0.25) {
        const on = d / len <= p;
        if (!on) continue;
        const blink = locked && ((this.st >> 1) & 1);
        T.dot(this.x + dx * d, this.z + dz * d, blink ? 'gold' : (Math.round(d * 4) % 2 ? 'red' : 'blood'));
        if (locked) { T.dot(this.x + dx * d + dz * 0.125, this.z + dz * d - dx * 0.125, 'blood'); }
      }
    }
  }

  onDeath() { enemySfx.death('wisp'); }

  tickDeath() {
    const k = this.st, y = this.D.float;
    if (k < 18 && k % 3 === 0) vfx.embers(this.x, y + 0.2, this.z, { n: 3, spread: 0.2, up: 0.9 });
    if (k === 18) {
      vfx.dust(this.x, this.z, { y: y + 0.2, n: 7, size: 1, palette: 'dustDark' });
      vfx.embers(this.x, y + 0.1, this.z, { n: 10, spread: 0.25, up: 1.4 });
    }
    if (k === 27) {
      vfx.death(this.x, 0.15, this.z, { colors: this.debris, power: 0.65, soul: false, ring: 'slate' });
      vfx.embers(this.x, 0.1, this.z, { n: 12, spread: 0.3, up: 0.6 });
      enemySfx.crumble(); enemySfx.thud(0.5);
      this.mgr.decal(this.x, this.z, 'scorch', { r: 0.45, life: 300 });
    }
    if (k === 29) this.visible = false;
    if (k > 40) this.remove = true;
  }

  animate() {
    const P = this.pose, A = this.A, s = this.st, D = this.D;
    const bob = Math.sin(this.t * 0.09 + this.seed) * 0.8;
    const lean = clamp01(this.moveSpeed / this.speed);
    // lean into movement (in the wisp's own frame)
    const rel = wrap(Math.atan2(this.mvx, this.mvz) - this.yaw);
    const leanF = Math.cos(rel) * lean * 0.25, leanS = Math.sin(rel) * lean * 0.2;
    let fy = D.float * 8 + bob, fs = 1, fh = 1, cy = 0, ct = 0, sh = 1;
    switch (this.state) {
      case 'spawn': {
        const k = Math.max(0, s - (this.popAt ?? 0));
        const u = clamp01(k / 14);
        fs = u < 0.6 ? u / 0.6 * 1.3 : 1.3 - (u - 0.6) / 0.4 * 0.3;
        fh = fs; sh = u;
        break;
      }
      case 'windup': {
        const u = smooth(s / A.windup);
        fs = 1 + 0.35 * u + (s > A.windup - 12 ? ((s >> 1) & 1) * 0.08 : 0);
        fh = 1 + 0.25 * u;
        fy += 2 * u;
        ct = -0.25 * u;
        this.tell = s > A.windup - 12 ? ((s >> 1) & 1 ? 0.5 : 0) : 0;
        this.tellColor = 'torch';
        break;
      }
      case 'recover': {
        const u = clamp01(s / 10);
        fs = 1.15 - 0.15 * u; fh = 0.7 + 0.3 * u; ct = 0.3 * (1 - u);
        break;
      }
      case 'hurt': fs = 0.75 + ((s >> 1) & 1) * 0.15; fh = 0.8; ct = 0.35; break;
      case 'death': {
        // gutter: flicker smaller and out; then the skull drops, bounces, shatters
        const g = clamp01(1 - s / 18);
        fs = g * (0.7 + ((s >> 1) & 1) * 0.3); fh = g;
        const fall = s < 18 ? 0 : s - 18;
        const drop = Math.min(D.float * 8 - 1.8, 0.28 * fall * fall);      // gravity in voxels
        cy = -drop + (s > 22 && s < 27 ? Math.sin((s - 22) / 5 * Math.PI) * 1.2 : 0);
        ct = s < 18 ? Math.sin(s * 1.3) * 0.3 : 0.8;
        sh = s < 18 ? 1 : 0.6;
        if (s < 18) { this.tell = (s >> 1) & 1 ? 0.6 : 0; this.tellColor = 'white'; }
        break;
      }
    }
    P.fy = ease(P.fy, fy, 0.3);
    P.fs = this.state === 'death' || this.state === 'spawn' ? fs : ease(P.fs, fs, 0.35);
    P.fh = ease(P.fh, fh, 0.35);
    P.cy = cy; P.ct = ease(P.ct, ct, 0.3); P.sh = sh;
    P.lean = ease(P.lean, leanF, 0.15); P.roll = ease(P.roll, -leanS, 0.15);
    if (this.recoil > 0.05) { P.ct += this.recoil * 0.4; P.fs *= 1 - this.recoil * 0.25; }
  }

  apply(p) {
    this.floater.position.y = p.fy * V;
    this.floater.rotation.set(p.lean, 0, p.roll);
    this.core.position.y = p.cy * V;
    this.core.rotation.x = p.ct;
    // the flame: one of three frames at ~10 fps, stepped scale (no smooth swell)
    const f = Math.floor(this.t / 6) % 3;
    this.flames.forEach((m, i) => { m.visible = i === f; });
    const FS = 0.8;   // the flame model is authored large; this is its size at rest
    const fs = Math.max(0.001, Math.round(p.fs * FS * 8) / 8), fh = Math.max(0.001, Math.round(p.fh * 8) / 8);
    const hf = this.flashLevel(), fm = this.flameMat.userData;
    fm.flash.value = hf; if (hf) fm.flashColor.value.setHex(0xffffff);
    this.flame.scale.set(fs, fs * fh, fs);
    this.flame.visible = p.fs > 0.05;
    const hgt = (p.fy + p.cy) / (this.D.float * 8);
    const ss = Math.max(0.3, Math.min(1.1, 1.2 - hgt * 0.35)) * p.sh;
    this.shadow.scale.set(ss, 1, ss);
    this.shadow.visible = p.sh > 0.05;
  }
}
