// Brute (piece `enemies`): a horned plum ogre in iron. Slow on foot; its threat is the charge.
//
//   spawn    drops from above onto a red landing disc that fills first; lands with a
//            shockwave and a roar
//   move     a heavy stomp toward the hero; a puff of dust at every footfall
//   charge   windup 50 ticks: it plants, paws the floor three times (dust, scrape), snorts,
//            and a lane fills on the floor from its feet to exactly where it will stop (the
//            first wall, or its max run). It tracks you for the first 60%, then the lane
//            locks. Then it runs the lane at 10.5 u/s. A hit hurts 2 and throws you along it.
//   crash    if the lane ends at a wall, it smashes into it: a shockwave, rubble, a crack in
//            the floor, and it is dazed for ~2 s with stars round its head. This is the
//            opening: it cannot be staggered, but it cannot do anything either.
//   skid     if the lane ends in open floor, it skids to a stop and recovers.
//   slam     when you are close: both fists up over its head (34 ticks, a disc fills in
//            front of it), then down: a floor shockwave.
//   poise    50: a whole combo only rocks it; 50 damage inside about a second staggers it out
//            of a windup. It cannot be staggered mid-charge or while dazed.
//   death    it staggers, drops to its knees, falls on its face (a big thud), then shatters

import * as THREE from 'three';
import { vfx } from '../vfx/vfx.js';
import { events } from '../core/events.js';
import { DT } from '../core/loop.js';
import { Enemy, part, pivot, ease, smooth, clamp01, wrap, V } from './enemy.js';
import { enemySfx } from './sfx.js';
import { dmg } from './data.js';
import { quake, kick } from './shake.js';

export class Brute extends Enemy {
  build() {
    const M = this.material;
    this.faller = pivot(this.body, 0, 0, 0);
    this.hips = pivot(this.faller, 0, 5, 0);
    this.legL = pivot(this.hips, -2.5, 0, 0, part('enemies.brute.legL', M));
    this.legR = pivot(this.hips, 2.5, 0, 0, part('enemies.brute.legR', M));
    this.torso = pivot(this.hips, 0, 0, 0, part('enemies.brute.torso', M));
    this.head = pivot(this.torso, 0, 5.6, 2.6, part('enemies.brute.head', M));
    this.maw = part('enemies.brute.maw', M);       // flares in the charge windup
    this.maw.position.set(0, -0.55 * V, 3.2 * V);
    this.maw.visible = false;
    this.head.add(this.maw);
    this.armL = pivot(this.torso, -6.4, 7.2, 0.3, part('enemies.brute.armL', M));
    this.armR = pivot(this.torso, 6.4, 7.2, 0.3, part('enemies.brute.armR', M));
    this.stars = new THREE.Group();
    this.starMeshes = [0, 1, 2].map(() => { const s = part('enemies.star', M); this.stars.add(s); return s; });
    this.stars.visible = false;
    this.group.add(this.stars);
    this.phase = 0;
    this.lastFoot = 0;
    this.onLand = (v) => this.landed_(v);
    Object.assign(this.pose, { hipY: 0, hunch: 0.25, roll: 0, twist: 0, hp: 0, hr: 0, lx: -0.1, lz: -0.15, rx: -0.1, rz: 0.15, legL: 0, legR: 0, fall: 0 });
  }

  get attacking() { return ['aim', 'charge', 'raise', 'slam'].includes(this.state); }
  canStagger() { return !['spawn', 'charge', 'dazed', 'skid'].includes(this.state); }
  get C() { return this.D.charge; }
  get S() { return this.D.slam; }

  // ---- spawn: a landing disc fills, then it drops out of the dark ----------------------
  beginSpawn() {
    if (this.spawnKind === 'instant') { this.setState('move'); return; }
    this.visible = false;
    this.popAt = 36 + this.spawnDelay;
  }
  tickSpawn() {
    const k = this.st - this.popAt;
    if (k === -30) vfx.dust(this.x, this.z, { n: 4, size: 0.6, palette: 'dustDark', y: 0.1 });
    if (k === 0) { this.visible = true; this.y = this.py = 5.5; this.vy = -3; enemySfx.spawn('brute'); }
    if (this.dropped && this.st - this.dropped > 8) { this.setState('roar'); enemySfx.windup('charge'); }
  }
  landed_(v) {
    this.vy = 0;
    if (this.state === 'spawn' && !this.dropped) {
      this.dropped = this.st;
      this.squash = 0.9;
      quake(4.5, 240);
      vfx.shockwave(this.x, this.z, { radius: 2.2, color: 'fog' });
      vfx.land(this.x, this.z, { size: 1.6 });
      this.mgr.decal(this.x, this.z, 'crack', { r: 0.8, life: 300 });
      enemySfx.crash();
      events.emit('enemy:land', { enemy: this, x: this.x, z: this.z });
    } else if (this.dying) {
      this.squash = 0.4;
    }
  }

  // ---- AI --------------------------------------------------------------------------------
  think() {
    const C = this.C, S = this.S;
    const th = this.toHero();
    switch (this.state) {
      case 'move': {
        if (!this.ai) { this.puppetBusy = false; this.idleHome(); break; }
        if (!th) { this.stop(); break; }
        const p = this.slotPoint(this.D.standoff);
        this.seek(p.x, p.z, this.speed, 0.6);
        this.turnTo(th.yaw, 0.05);
        if (this.cool > 0) this.cool--;
        if (this.cool > 0) break;
        const facing = Math.abs(wrap(th.yaw - this.yaw)) < 0.7;
        if (th.d < S.range && facing) { if (this.takeToken()) this.startSlam(); }
        else if (th.d >= C.min && th.d <= C.max + 1.5 && this.clearTo(th.h.x, th.h.z, this.r)) { if (this.takeToken()) this.startCharge(); }
        break;
      }
      case 'aim': {
        this.stop();
        if (th && this.st < C.windup * 0.6) this.turnTo(th.yaw, 0.07);
        this.lane = this.laneFrom(this.x, this.z, this.yaw);
        if (this.st % 16 === 4 && this.st < C.windup - 8) {     // paw the floor
          const bx = this.x - Math.sin(this.yaw) * 0.6 + Math.cos(this.yaw) * 0.35, bz = this.z - Math.cos(this.yaw) * 0.6 - Math.sin(this.yaw) * 0.35;
          vfx.dust(bx, bz, { dx: -Math.sin(this.yaw), dz: -Math.cos(this.yaw), n: 5, size: 1, palette: 'dustWarm' });
          enemySfx.paw();
        }
        if (this.st === 10 || this.st === 34) this.snort();
        if (this.st >= C.windup) {
          this.setState('charge');
          this.ax = this.x; this.az = this.z; this.ayaw = this.yaw; this.alen = this.lane; this.ran = 0; this.gored = false;
          enemySfx.charge();
          events.emit('enemy:charge', { enemy: this, x: this.x, z: this.z, yaw: this.yaw, length: this.alen });
        }
        break;
      }
      case 'charge': {
        this.stop(); this.mvx = 0; this.mvz = 0;
        const dx = Math.sin(this.ayaw), dz = Math.cos(this.ayaw);
        const sp = C.speed * (this.speed / this.D.speed);
        const want = Math.min(sp * DT, this.alen - this.ran);
        const x0 = this.x, z0 = this.z;
        this.moveBy(dx * want, dz * want);
        const moved = Math.hypot(this.x - x0, this.z - z0);
        this.ran += moved;
        this.chargeV = moved / DT;
        if (this.st % 3 === 0) vfx.dust(this.x - dx * 0.5, this.z - dz * 0.5, { dx: -dx, dz: -dz, n: 3, size: 0.9, palette: 'dustWarm', spread: 0.6 });
        if (this.st % 6 === 2) vfx.afterimage(this.body, { palette: 'ghostRed', life: 0.12 });
        // gore the hero once
        const h = this.hero;
        if (!this.gored && h && !h.dead && Math.hypot(h.x - this.x, h.z - this.z) < this.r + 0.3 + 0.12) {
          this.gored = true;
          const r = this.hurtHero(dmg(C.dmg));
          if (r.ok && h.ctl) {
            const side = Math.sign((h.x - this.x) * dz - (h.z - this.z) * dx) || 1;
            h.ctl.impulse(dx * C.knock * 0.6 + dz * side * C.knock * 0.5, dz * C.knock * 0.6 - dx * side * C.knock * 0.5);
          }
        }
        const blocked = moved < want * 0.5 && this.st > 1;
        if (blocked && this.alen - this.ran > 0.05) this.crash(dx, dz);
        else if (this.ran >= this.alen - 1e-3) { if (this.endsAtWall) this.crash(dx, dz); else { this.setState('skid'); this.skidV = sp; } }
        break;
      }
      case 'skid': {
        this.stop();
        const dx = Math.sin(this.ayaw), dz = Math.cos(this.ayaw);
        this.skidV *= 0.8;
        this.moveBy(dx * this.skidV * DT, dz * this.skidV * DT);
        this.chargeV = this.skidV;
        if (this.st % 2 === 0) vfx.dust(this.x + dx * 0.3, this.z + dz * 0.3, { dx: dx, dz: dz, n: 2, size: 0.8, palette: 'dustWarm' });
        if (this.st >= C.skid) { this.setState('recover'); this.recoverFor = C.recover; }
        break;
      }
      case 'dazed':
        this.stop();
        if (this.st % 45 === 10) enemySfx.dizzy();
        if (this.st >= C.stun) { this.setState('recover'); this.recoverFor = 26; }
        break;
      case 'raise': {
        this.stop();
        if (th && this.st < S.windup * 0.5) this.turnTo(th.yaw, 0.06);
        if (this.st >= S.windup) {
          this.setState('slam');
          this.ax = this.x + Math.sin(this.yaw) * S.ahead; this.az = this.z + Math.cos(this.yaw) * S.ahead; this.hitDone = false;
        }
        break;
      }
      case 'slam': {
        this.stop();
        if (this.st === 1) {
          quake(3.2, 170);
          vfx.shockwave(this.ax, this.az, { radius: S.radius + 0.3, color: 'fog' });
          vfx.dust(this.ax, this.az, { n: 10, size: 1.3, palette: 'dustWarm' });
          this.mgr.decal(this.ax, this.az, 'crack', { r: 0.6, life: 240 });
          enemySfx.slam();
          events.emit('enemy:slam', { enemy: this, x: this.ax, z: this.az });
        }
        if (!this.hitDone && this.st >= 1 && this.heroInDisc(this.ax, this.az, S.radius)) { this.hitDone = true; this.hurtHero(dmg(S.dmg), { x: this.ax, z: this.az }); }
        if (this.st >= S.active) { this.setState('recover'); this.recoverFor = S.recover; }
        break;
      }
      case 'roar':
        this.stop();
        if (this.st >= 30) this.setState('move');
        break;
      case 'recover':
        this.stop();
        if (this.st >= (this.recoverFor ?? 30)) {
          this.dropToken();
          this.cool = this.cooldownTicks(this.rand(), this.lastAttack === 'slam' ? this.S.cooldown : this.C.cooldown);
          this.setState('move');
        }
        break;
    }
  }

  /** How far the charge will run from (x, z) along yaw: to the first wall, or its max. */
  laneFrom(x, z, yaw) {
    const C = this.C, cw = this.mgr.collision;
    let d = C.max;
    if (cw) d = Math.min(C.max, cw.raycast(x, z, Math.sin(yaw), Math.cos(yaw), C.max + 0.5, this.r));
    const B = this.bounds;
    if (B) {
      const dx = Math.sin(yaw), dz = Math.cos(yaw);
      if (dx > 1e-4) d = Math.min(d, (B.maxX - this.r - x) / dx); else if (dx < -1e-4) d = Math.min(d, (B.minX + this.r - x) / dx);
      if (dz > 1e-4) d = Math.min(d, (B.maxZ - this.r - z) / dz); else if (dz < -1e-4) d = Math.min(d, (B.minZ + this.r - z) / dz);
    }
    this.endsAtWall = d < C.max - 1e-3;
    return Math.max(0.3, d);
  }

  startCharge() {
    this.setState('aim'); this.attacks++; this.lastAttack = 'charge';
    this.lane = this.laneFrom(this.x, this.z, this.yaw);
    enemySfx.windup('charge');
    events.emit('combat:enemyWindup', { enemy: this, x: this.x, z: this.z });
  }
  startSlam() {
    this.setState('raise'); this.attacks++; this.lastAttack = 'slam';
    enemySfx.windup('slam', this.S.windup / 60);
    events.emit('combat:enemyWindup', { enemy: this, x: this.x, z: this.z });
  }
  act(what) {
    if (this.state !== 'move') return;
    this.puppetBusy = true;
    if (what === 'slam') this.startSlam(); else this.startCharge();
  }

  snort() {
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    for (const s of [-1, 1]) {
      const x = this.x + fx * 0.75 + fz * 0.08 * s, z = this.z + fz * 0.75 - fx * 0.08 * s;
      const i = vfx.core.add(x, 1.25, z, fx * 1.6 + fz * s * 0.6, -0.3, fz * 1.6 - fx * s * 0.6, 0.45, 2, 'dust', vfx.core.SPRITE);
      if (i >= 0) { vfx.core.P.drag[i] = 0.9; vfx.core.P.grav[i] = -1; }
    }
  }

  crash(dx, dz) {
    this.setState('dazed');
    this.stunBounce = 0;
    const cx = this.x + dx * (this.r + 0.05), cz = this.z + dz * (this.r + 0.05);
    this.vx = -dx * 4.5; this.vz = -dz * 4.5; this.vy = 2.2;     // bounces off the wall
    this.squash = 0.9;
    quake(6, 320);
    kick(dx, dz, 4);
    vfx.hitSpark(cx, 1.2, cz, { dx: -dx, dz: -dz, power: 2.2, palette: 'hit' });
    vfx.shockwave(cx, cz, { radius: 1.6, color: 'fog' });
    vfx.dust(cx, cz, { dx: -dx, dz: -dz, n: 14, size: 1.5, palette: 'dustWarm', y: 0.4 });
    for (let k = 0; k < 8; k++) {   // rubble knocked off the wall
      const a = Math.atan2(-dx, -dz) + (this.rand() - 0.5) * 2.2, sp = 2 + this.rand() * 3;
      const i = vfx.core.add(cx, 1 + this.rand() * 0.8, cz, Math.sin(a) * sp, 2 + this.rand() * 3, Math.cos(a) * sp, 1.2, 3 + (k % 3), k % 2 ? 'stoneLight' : 'stone', vfx.core.CUBE);
      if (i >= 0) { vfx.core.P.grav[i] = 22; vfx.core.P.bounce[i] = 0.35; vfx.core.P.floorY[i] = 0.05; vfx.core.P.pop[i] = 1; vfx.core.P.shrinkAt[i] = 0.85; vfx.core.P.fadeAt[i] = 0.85; }
    }
    this.mgr.decal(cx - dx * 0.2, cz - dz * 0.2, 'crack', { r: 0.7, life: 360 });
    enemySfx.crash();
    events.emit('enemy:crash', { enemy: this, x: cx, z: cz });
  }

  telegraph(T) {
    const C = this.C, S = this.S;
    if (this.state === 'spawn' && !this.visible) {
      const k = this.st, p = clamp01(k / this.popAt);
      T.disc(this.x, this.z, this.r + 0.35, p, { t: k });
    } else if (this.state === 'aim') {
      T.lane(this.x, this.z, this.yaw, this.lane + this.r, C.width, Math.min(1, this.st / C.windup), { t: this.st, start: this.r * 0.6 });
    } else if (this.state === 'charge') {
      T.lane(this.ax, this.az, this.ayaw, this.alen + this.r, C.width, 1, { firing: this.st < 4, start: Math.max(this.r * 0.6, this.ran + this.r * 0.6), t: this.st });
    } else if (this.state === 'raise') {
      const x = this.x + Math.sin(this.yaw) * S.ahead, z = this.z + Math.cos(this.yaw) * S.ahead;
      T.disc(x, z, S.radius, Math.min(1, this.st / S.windup), { t: this.st });
    } else if (this.state === 'slam' && this.st <= 3) {
      T.disc(this.ax, this.az, S.radius, 1, { firing: true });
    }
  }

  onDeath() {
    enemySfx.death('brute');
    const [fx, fz] = this.fallDir(-this.deathDX, -this.deathDZ);   // falls toward whoever killed it
    this.yaw = Math.atan2(fx, fz);
    this.pyaw = this.yaw;
  }
  tickDeath() {
    const k = this.st;
    if (k === 16) { enemySfx.thud(0.8); vfx.dust(this.x, this.z, { n: 6, size: 1 }); }
    if (k === 40) {
      const fx = this.x + Math.sin(this.yaw) * 1.1, fz = this.z + Math.cos(this.yaw) * 1.1;
      enemySfx.thud(1.8); quake(4.5, 260);
      vfx.land(fx, fz, { size: 1.7 });
      vfx.shockwave(fx, fz, { radius: 1.8, color: 'mist', dust: false });
    }
    if (k === 66) {
      const fx = this.x + Math.sin(this.yaw) * 0.9, fz = this.z + Math.cos(this.yaw) * 0.9;
      vfx.death(fx, 0.35, fz, { colors: this.debris, power: 1.8, ring: 'rose' });
      enemySfx.crumble(); quake(2, 120);
      this.mgr.decal(fx, fz, 'blood', { r: 0.8, life: 360 });
    }
    if (k === 68) this.visible = false;
    if (k > 80) this.remove = true;
  }

  // ---- animation -------------------------------------------------------------------------------
  animate() {
    const P = this.pose, s = this.st, C = this.C, S = this.S;
    const spd = this.state === 'charge' || this.state === 'skid' ? (this.chargeV ?? 0) : this.moveSpeed;
    const prev = this.phase;
    this.phase += spd * DT * (Math.PI * 2 / (this.state === 'charge' ? 2.2 : 1.35));
    // footfalls: dust (and on the charge, a little shake)
    if (Math.floor(this.phase / Math.PI) !== Math.floor(prev / Math.PI) && spd > 0.3) {
      const side = Math.floor(this.phase / Math.PI) % 2 ? 1 : -1;
      const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
      vfx.dust(this.x + fz * 0.35 * side, this.z - fx * 0.35 * side, { n: this.state === 'charge' ? 4 : 3, size: 0.9, palette: 'dustWarm' });
      if (this.state === 'move') this.squash = Math.max(this.squash, 0.18);   // each stomp lands
      if (this.state === 'charge') quake(1.2, 60);
    }
    const walk = clamp01(spd / 0.9);
    const ph = this.phase;
    const breathe = Math.sin(this.t * 0.05) * 0.4;
    let t;
    switch (this.state) {
      case 'spawn': case 'roar': {
        const roar = this.state === 'roar' ? smooth(s / 8) * (1 - smooth((s - 22) / 8)) : 0;
        t = { hipY: 0, hunch: 0.25 - 0.55 * roar, roll: 0, twist: 0, hp: -0.6 * roar, hr: roar * Math.sin(s * 1.7) * 0.05, lx: -0.1 - 1.2 * roar, lz: -0.15 - 0.9 * roar, rx: -0.1 - 1.2 * roar, rz: 0.15 + 0.9 * roar, legL: 0, legR: 0, fall: 0 };
        if (this.state === 'spawn' && this.y > 0.01) { t.lx = -2.4; t.rx = -2.4; t.lz = -0.5; t.rz = 0.5; t.legL = -0.4; t.legR = 0.3; }
        break;
      }
      case 'aim': {
        // plant, head down, one hoof pawing back and forth
        const u = smooth(s / 12);
        const paw = s < C.windup - 8 ? Math.sin((s % 16) / 16 * Math.PI * 2) : 0;
        // a bull's crouch: body drops 2+ voxels, head down, fists drawn back past the hips
        t = { hipY: -2.3 * u, hunch: 0.25 + 0.6 * u, roll: 0, twist: 0, hp: 0.3 * u, hr: 0, lx: 0.75 * u, lz: -0.55 * u - 0.1, rx: 0.75 * u, rz: 0.55 * u + 0.1, legL: -0.3 * u, legR: 0.1 + 0.45 * paw * u, fall: 0 };
        if (s > C.windup - 12) { this.tell = (s >> 1) & 1 ? 0.35 : 0; this.tellColor = 'red'; }
        break;
      }
      case 'charge': case 'skid': {
        const run = this.state === 'charge';
        t = { hipY: -0.8 - Math.abs(Math.sin(ph)) * (run ? 1 : 0.3), hunch: run ? 0.85 : 0.2, roll: Math.sin(ph) * 0.08, twist: 0, hp: run ? 0.45 : -0.2, hr: 0,
          lx: run ? 0.25 + Math.sin(ph) * 0.45 : -0.9, lz: -0.4, rx: run ? 0.25 - Math.sin(ph) * 0.45 : -0.9, rz: 0.4,
          legL: run ? -Math.sin(ph) * 0.8 : -0.6, legR: run ? Math.sin(ph) * 0.8 : 0.4, fall: 0 };
        if (!run) t.hunch = -0.2;
        break;
      }
      case 'dazed': {
        // slumped back on its heels, head lolling in circles
        const u = smooth(s / 6);
        t = { hipY: -1.5 * u, hunch: -0.15, roll: Math.sin(s * 0.09) * 0.12, twist: 0, hp: 0.3 + Math.sin(s * 0.12) * 0.2, hr: Math.cos(s * 0.12) * 0.35,
          lx: 0.25, lz: -0.55 + Math.sin(s * 0.1) * 0.1, rx: 0.25, rz: 0.55 - Math.sin(s * 0.1) * 0.1, legL: -0.2, legR: 0.25, fall: 0 };
        break;
      }
      case 'raise': {
        const u = smooth(s / (S.windup * 0.5));
        const tr = s > S.windup - 10 ? Math.sin(s * 2.3) * 0.05 : 0;
        t = { hipY: 0.6 * u, hunch: 0.25 - 0.65 * u, roll: tr, twist: 0, hp: -0.35 * u, hr: 0, lx: -0.1 - 2.8 * u, lz: -0.15 + 0.35 * u, rx: -0.1 - 2.8 * u, rz: 0.15 - 0.35 * u, legL: -0.15 * u, legR: 0.15 * u, fall: 0 };
        if (s > S.windup - 10) { this.tell = (s >> 1) & 1 ? 0.3 : 0; this.tellColor = 'red'; }
        break;
      }
      case 'slam': {
        const u = smooth(s / 2);
        Object.assign(P, { hipY: -1.8 * u, hunch: -0.4 + 1.3 * u, roll: 0, twist: 0, hp: 0.4 * u, hr: 0, lx: -2.9 + 2.2 * u, lz: -0.1 + 0.1 * u, rx: -2.9 + 2.2 * u, rz: 0.1 - 0.1 * u, legL: -0.3, legR: 0.3, fall: 0 });
        return;
      }
      case 'recover': {
        const u = smooth(s / (this.recoverFor ?? 30));
        const fromSlam = this.lastAttack === 'slam';
        t = { hipY: (fromSlam ? -1.8 : -0.8) * (1 - u), hunch: (fromSlam ? 0.9 : 0.3) * (1 - u) + 0.25 * u, roll: 0, twist: 0, hp: 0.2 * (1 - u), hr: 0,
          lx: (fromSlam ? -0.7 : -0.1) * (1 - u) - 0.1 * u, lz: -0.15, rx: (fromSlam ? -0.7 : -0.1) * (1 - u) - 0.1 * u, rz: 0.15, legL: -0.2 * (1 - u), legR: 0.2 * (1 - u), fall: 0 };
        break;
      }
      case 'hurt':
        t = { hipY: -0.6, hunch: -0.2, roll: 0.1, twist: 0.15, hp: -0.4, hr: 0.2, lx: -0.9, lz: -0.6, rx: -0.5, rz: 0.7, legL: 0.25, legR: -0.2, fall: 0 };
        break;
      case 'death': {
        // stagger back, knees, then face-first
        const kneel = smooth((s - 12) / 12), f = s < 28 ? 0 : s < 40 ? (Math.PI / 2 - 0.12) * ((s - 28) / 12) ** 2 : Math.PI / 2 - 0.12 - (s < 46 ? Math.sin((s - 40) / 6 * Math.PI) * 0.1 : 0);
        Object.assign(P, { hipY: -3.2 * kneel - (s < 12 ? s * 0.08 : 0), hunch: s < 12 ? -0.35 : 0.3, roll: s < 28 ? Math.sin(s * 0.4) * 0.08 : 0, twist: 0, hp: s < 12 ? -0.5 : 0.1, hr: 0.1,
          lx: s < 12 ? -1.2 : s < 40 ? 0.2 : -2.8, lz: -0.5, rx: s < 12 ? -0.8 : s < 40 ? 0.2 : -2.6, rz: 0.5, legL: -1.3 * kneel, legR: -1.2 * kneel, fall: f });
        return;
      }
      default: {
        t = { hipY: -Math.abs(Math.sin(ph)) * 2.0 * walk + breathe * (1 - walk), hunch: 0.28 + 0.06 * Math.sin(ph * 2) * walk, roll: Math.sin(ph) * 0.1 * walk, twist: Math.sin(ph) * 0.1 * walk,
          hp: 0.05 + breathe * 0.05, hr: 0, lx: -0.1 + Math.sin(ph) * 0.35 * walk, lz: -0.15 - breathe * 0.03, rx: -0.1 - Math.sin(ph) * 0.35 * walk, rz: 0.15 + breathe * 0.03,
          legL: -Math.sin(ph) * 0.5 * walk, legR: Math.sin(ph) * 0.5 * walk, fall: 0 };
      }
    }
    const k = this.state === 'charge' ? 0.5 : 0.22;
    for (const key in t) P[key] = ease(P[key], t[key], k);
    if (this.recoil > 0.05) { P.hunch -= this.recoil * 0.2; P.hp -= this.recoil * 0.25; }
  }

  apply(p, alpha) {
    this.faller.rotation.x = p.fall;
    this.hips.position.y = (5 + p.hipY) * V;
    this.torso.rotation.set(p.hunch, p.twist, p.roll);
    this.head.rotation.set(p.hp - 0.7, 0, p.hr);   // tipped up against the hunch so the face shows from above
    this.armL.rotation.set(p.lx, 0, p.lz);
    this.armR.rotation.set(p.rx, 0, p.rz);
    this.legL.rotation.x = p.legL;
    this.legR.rotation.x = p.legR;
    // the maw flares through the charge windup: blinking, then solid and bigger for the last 12 ticks
    const aim = this.state === 'aim' && !this.dying;
    const late = aim && this.st > this.C.windup - 12;
    this.maw.visible = aim && (late || ((this.st >> 2) & 1) === 0 || this.st < 3) || this.state === 'charge';
    this.maw.scale.setScalar(late || this.state === 'charge' ? 1.35 : 1);
    // stun stars circle its head while it is dazed
    const dazed = this.state === 'dazed' && !this.dying;
    this.stars.visible = dazed;
    if (dazed) {
      const tt = (this.t + alpha) * 0.12;
      this.stars.position.set(0, 2.25, 0.35);
      this.starMeshes.forEach((m, i) => {
        const a = tt + i * (Math.PI * 2 / 3);
        m.position.set(Math.cos(a) * 0.45, Math.sin(a * 2) * 0.05, Math.sin(a) * 0.3);
        m.rotation.y = -this.group.rotation.y;     // always face the camera
      });
    }
  }
}
