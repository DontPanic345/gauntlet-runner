// Training dummies (piece `combat`): targets for the combat showcase and for testing hits in
// normal play (debug.spawn('dummy' | 'sparring', x, z) where a scene registers them).
//
//   const d = new TrainingDummy(root, { id: 'A', x, z, bounds });           // straw dummy
//   const s = new SparringDummy(root, { id: 'S', x, z, bounds, health });    // hits back, slowly
//   tick: d.tick();   render: d.render(alpha);   remove: d.dispose()
//
// A straw dummy sits on a round weighted base. A hit knocks it sliding (knockback scales with
// the hit), rocks it on its base, squashes it and flashes it white. When it has rested for a
// moment away from its painted home mark it hops back, three small hops at most. It counts
// hits, remembers the last damage, and measures how far the last hit pushed it (knockDist).
//
// The sparring dummy wears an iron pot, holds a club, and has ember eyes. When the hero is in
// range it winds up (42 ticks, a floor telegraph in ember fills its reach), swings (the
// telegraph IS the hitbox), and recovers. The overhead finisher staggers it out of a windup.

import * as THREE from 'three';
import { Hurtable } from './combat.js';
import { defineModel, voxelMesh, VoxelGrid, VOXEL, makeVoxelMaterial } from '../render/voxel/index.js';
import { hex } from '../render/palette.js';
import { look } from '../render/look.js';
import { events } from '../core/events.js';
import { combatSfx } from './sfx.js';

const V = VOXEL;
const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const hash = (x, y, z = 0) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967295; };

// ---- models ------------------------------------------------------------------------------

let built = false;
function buildModels() {
  if (built) return;
  built = true;
  // weighted base: a wooden drum with an iron band; ~1 unit across
  {
    const S = 9, c = 4;
    const g = new VoxelGrid(S, 2, S);
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c, z - c);
      if (d > 4.3) continue;
      g.set(x, 0, z, d > 3.4 ? 'slate' : 'wood');
      g.set(x, 1, z, d > 3.4 ? 'wood' : hash(x, z, 3) < 0.25 ? 'wood' : 'woodLight');
    }
    defineModel('combat.base', { grid: g });
  }
  // upper body: post, burlap sack body with a painted target, crossbar arms with straw, sack head.
  // variant 'straw' (training) and 'iron' (sparring: darker sack, iron pot helm, ember eyes, no right arm)
  for (const variant of ['straw', 'iron']) {
    const W = 13, H = 15, D = 9, cx = 6, cz = 4;
    const g = new VoxelGrid(W, H, D);
    const iron = variant === 'iron';
    const sack = (x, y, z) => {
      const f = hash(x, y, z);
      if (iron) return f < 0.2 ? 'stone' : f < 0.35 ? 'dirt' : 'wood';
      return f < 0.18 ? 'wood' : f < 0.3 ? 'gold' : 'woodLight';
    };
    // post (y 0..3)
    for (let y = 0; y < 4; y++) for (let z = cz - 1; z <= cz; z++) for (let x = cx - 1; x <= cx; x++) g.set(x, y, z, y === 0 ? 'dirt' : 'wood');
    // body (y 3..9): a stuffed sack, fatter in the middle
    const radii = [[2.4, 1.9], [3.3, 2.5], [3.6, 2.8], [3.6, 2.8], [3.5, 2.7], [3.2, 2.5], [2.6, 2.0]];
    radii.forEach(([rx, rz], i) => {
      const y = 3 + i;
      for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const dx = (x - cx + 0.5) / rx, dz = (z - cz + 0.5) / rz;
        if (dx * dx + dz * dz > 1) continue;
        let c = sack(x, y, z);
        if (y === 5 || y === 8) c = iron ? 'slate' : 'dirt';          // rope / iron bands
        g.set(x, y, z, c);
      }
    });
    // painted target on the front (straw) / a chest plate (iron)
    for (let y = 4; y <= 9; y++) for (let x = 0; x < W; x++) {
      let zf = -1;
      for (let z = D - 1; z >= 0; z--) if (g.get(x, y, z)) { zf = z; break; }
      if (zf < 0) continue;
      const d = Math.hypot(x - cx + 0.5, (y - 6.5) * 1.1);
      if (!iron) {
        if (d < 1.1) g.set(x, y, zf, 'bone');
        else if (d < 2.2) g.set(x, y, zf, 'red');
        else if (d < 2.9 && y !== 5 && y !== 8) g.set(x, y, zf, 'bone');
      } else if (d < 2.6) g.set(x, y, zf, d < 1.2 ? 'fog' : 'slate');
    }
    // crossbar arms (y 8), straw tufts at the ends
    for (let x = 0; x < W; x++) {
      if (iron && x > cx + 2) continue;   // the sparring dummy's right arm is the club (separate mesh)
      if (!g.get(x, 8, cz)) g.set(x, 8, cz, 'wood');
    }
    for (const x of iron ? [0] : [0, W - 1]) for (let y = 7; y <= 9; y++) g.set(x, y, cz, y === 8 ? 'gold' : 'woodLight'), g.set(x, y, cz - 1, 'gold');
    // neck (y 10) and head (y 11..14)
    for (let z = cz - 1; z <= cz; z++) for (let x = cx - 1; x <= cx; x++) g.set(x, 10, z, iron ? 'slate' : 'dirt');
    for (let y = 11; y < 15; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const dx = x - cx + 0.5, dy = (y - 12.7) * 1.1, dz = z - cz + 0.5;
      const d = Math.hypot(dx, dy, dz);
      if (d > 2.6) continue;
      let c = iron ? (y >= 13 ? (d > 2.0 ? 'slate' : 'mist') : 'dirt') : (hash(x, y, z + 9) < 0.25 ? 'wood' : 'woodLight');
      g.set(x, y, z, c);
    }
    if (iron) { // helm brim
      for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - cx + 0.5, z - cz + 0.5);
        if (d < 3.4 && d > 1.2 && !g.get(x, 13, z)) g.set(x, 12, z, 'slate');
        if (d < 3.4 && d >= 2.4) g.set(x, 13, z, 'fog');
      }
    }
    // face: find the front surface at eye height
    const front = (x, y) => { for (let z = D - 1; z >= 0; z--) if (g.get(x, y, z)) return z; return -1; };
    for (const ex of [cx - 2, cx + 1]) {
      const z = front(ex, 12);
      if (z >= 0) g.set(ex, 12, z, iron ? 'ember' : 'ink', iron);
      if (!iron) {  // stitched X-ish eyes
        const z2 = front(ex, 11);
        if (z2 >= 0 && ex === cx - 2) g.set(ex + 1, 11, front(ex + 1, 11), 'ink');
      }
    }
    if (!iron) { const z = front(cx, 11); if (z >= 0) g.set(cx, 11, z, 'dirt'); g.set(cx - 1, 11, front(cx - 1, 11), 'dirt'); }
    // straw spike on top of the straw head
    if (!iron) { g.set(cx, 15 - 1, cz, 'gold'); g.set(cx - 1, 14, cz, 'gold'); }
    defineModel(`combat.dummy.${variant}`, { grid: g, origin: [cx, 0, cz] });
  }
  // the club: a knotted wooden club with iron studs, along +z from the grip
  {
    const g = new VoxelGrid(3, 3, 11);
    for (let z = 0; z < 11; z++) {
      const r = z < 4 ? 0 : 1;
      for (let y = 1 - r; y <= 1 + r; y++) for (let x = 1 - r; x <= 1 + r; x++) {
        let c = z < 4 ? 'dirt' : hash(x, y, z) < 0.3 ? 'wood' : 'woodLight';
        if (z >= 6 && (x + y + z) % 3 === 0 && (x !== 1 || y !== 1)) c = 'fog';
        g.set(x, y, z, c);
      }
    }
    defineModel('combat.club', { grid: g, origin: [1.5, 1.5, 0.5] });
  }
  // home mark: a painted chalk ring on the floor
  {
    const S = 11, c = 5;
    const g = new VoxelGrid(S, 1, S);
    for (let z = 0; z < S; z++) for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c, z - c);
      if (d > 4.6 && d < 5.4 && hash(x, z, 5) > 0.2) g.set(x, 0, z, 'slate');
      if ((x === c && Math.abs(z - c) <= 1) || (z === c && Math.abs(x - c) <= 1)) g.set(x, 0, z, 'slate');
    }
    defineModel('combat.home', { grid: g, scale: V, origin: [c + 0.5, 0.9, c + 0.5] });
  }
}

// ---- training dummy ------------------------------------------------------------------------

export class TrainingDummy extends Hurtable {
  constructor(root, { id = 'dummy', x = 0, z = 0, yaw = 0, bounds = null, variant = 'straw', type = 'dummy' } = {}) {
    super({ id, type, x, z, r: 0.42, h: 1.8, hp: Infinity, weight: 1, friction: 0.8, bounds });
    buildModels();
    this.hitY = 0.8;
    this.root = root;
    this.home = { x, z };
    this.yaw = yaw;
    this.variant = variant;
    this.debris = variant === 'iron' ? ['woodLight', 'slate', 'wood'] : ['gold', 'woodLight', 'gold', 'torch'];
    this.material = makeVoxelMaterial();
    this.group = new THREE.Group();
    this.base = voxelMesh('combat.base'); this.base.material = this.material;
    this.upper = new THREE.Group();
    this.upper.position.y = 2 * V;
    this.body = voxelMesh(`combat.dummy.${variant}`); this.body.material = this.material;
    this.upper.add(this.body);
    this.group.add(this.base, this.upper);
    this.mark = voxelMesh('combat.home');
    this.mark.position.set(x, 0, z);
    root.add(this.mark, this.group);
    this.rest = 0;              // ticks at rest
    this.hop = null;            // {t, len, fx, fz, tx, tz}
    this.knockDist = 0;         // how far the last hit pushed it (units), measured when it stops
    this._knockFrom = null;
    this.hitPop = 0;            // ticks since last hit (label pop)
    this.t = 0;
    this.lastDmg = 0;
    this.collider = null;       // a CollisionWorld circle kept on the dummy
    this.onLand = (v) => events.emit('combat:dummyLand', { x: this.x, z: this.z, v });
  }

  attachCollider(cw) { this.cw = cw; this.collider = cw.addCircle(this.x, this.z, this.r * 0.85, 'dummy'); }

  takeHit(hit) {
    const ok = super.takeHit(hit);
    if (!ok) return false;
    this.hop = null;
    this.rest = 0;
    this.hitPop = 0;
    this.lastDmg = hit.dmg;
    this._knockFrom = { x: this.x, z: this.z };
    return true;
  }

  tick() {
    this.t++;
    this.hitPop++;
    this.tickBody();
    const moving = this.vx || this.vz || this.y > 0;
    if (!moving && this._knockFrom) {
      this.knockDist = Math.hypot(this.x - this._knockFrom.x, this.z - this._knockFrom.z);
      this._knockFrom = null;
    }
    // hop home after a rest
    if (this.hop) {
      const h = this.hop;
      h.t++;
      const u = Math.min(1, h.t / h.len);
      this.x = h.fx + (h.tx - h.fx) * u;
      this.z = h.fz + (h.tz - h.fz) * u;
      this.y = Math.sin(u * Math.PI) * 0.16;
      if (h.t === 1) this.squash = Math.max(this.squash, 0.3);   // crouch into it
      if (u >= 1) { this.hop = null; this.y = 0; this.squash = 0.45; this.rest = 36; events.emit('combat:dummyLand', { x: this.x, z: this.z, v: 1 }); }
    } else if (!moving) {
      this.rest++;
      const dx = this.home.x - this.x, dz = this.home.z - this.z, d = Math.hypot(dx, dz);
      if (this.rest > 50 && d > 0.06) {
        const step = Math.min(d, 0.42);
        this.hop = { t: 0, len: 14, fx: this.x, fz: this.z, tx: this.x + dx / d * step, tz: this.z + dz / d * step };
      }
    } else this.rest = 0;
    if (this.collider) { this.collider.x = this.x; this.collider.z = this.z; }
  }

  render(alpha) {
    const s = this.at(alpha);
    const p = look.snap(new THREE.Vector3(s.x, s.y, s.z));
    this.group.position.copy(p);
    this.group.rotation.y = this.yaw;
    // tilt in world axes: undo the yaw so a hit from the left always rocks it right
    const cy = Math.cos(-this.yaw), sy = Math.sin(-this.yaw);
    const idle = Math.sin(this.t * 0.05 + this.home.x) * 0.012;
    this.upper.rotation.set(s.tiltX * cy - s.tiltZ * sy, 0, s.tiltX * sy + s.tiltZ * cy + idle);
    const q = s.squash;
    this.upper.scale.set(1 + q * 0.18, 1 - q * 0.22, 1 + q * 0.18);
    const f = this.flashLevel();
    this.material.userData.flash.value = f;
    if (f) this.material.userData.flashColor.value.setHex(hex('white'));
  }

  dispose() {
    this.root.remove(this.group, this.mark);
    if (this.collider) this.cw?.remove(this.collider);
  }

  info() {
    return { id: this.id, type: this.type, x: +this.x.toFixed(3), z: +this.z.toFixed(3), hits: this.hits, lastDmg: this.lastDmg, knockDist: +this.knockDist.toFixed(2), flash: this.flashT };
  }
}

// ---- sparring dummy --------------------------------------------------------------------------

export const SPAR = { range: 2.5, reach: 1.65, halfAngle: 80, windup: 42, swing: 6, recover: 34, cooldown: 70, turn: 0.05 };

export class SparringDummy extends TrainingDummy {
  constructor(root, { health = null, ...opts } = {}) {
    super(root, { ...opts, variant: 'iron', type: 'sparring' });
    this.health = health;           // HeroHealth to strike
    this.state = 'idle'; this.st = 0; this.cool = 60;
    this.swingHit = false;
    this.club = new THREE.Group();
    this.club.position.set(3.2 * V, 8.5 * V, 0);
    const cm = voxelMesh('combat.club'); cm.material = this.material;
    this.club.add(cm);
    this.upper.add(this.club);
    this.clubPose = { yaw: 0.6, pitch: 1.0, twist: 0 };
    this.prevClub = { ...this.clubPose };
    this.weight = 1.5;
    // floor telegraph: a sector of flat tiles, drawn in ember (danger)
    this.tele = makeTelegraph(root);
    this.attacks = 0; this.landed = 0; this.dodged = 0;
  }

  takeHit(hit) {
    const ok = super.takeHit(hit);
    if (ok && hit.finisher && this.state === 'windup') { this.state = 'stagger'; this.st = 0; }
    return ok;
  }

  tick() {
    super.tick();
    this.prevClub = { ...this.clubPose };
    const h = this.health;
    const hx = h ? h.x : this.x, hz = h ? h.z : this.z + 1;
    const dx = hx - this.x, dz = hz - this.z, dist = Math.hypot(dx, dz);
    const want = Math.atan2(dx, dz);
    this.st++;
    const turn = (rate) => { const d = wrap(want - this.yaw); this.yaw = wrap(this.yaw + Math.max(-rate, Math.min(rate, d))); };
    const P = this.clubPose;
    const ease = (a, b, k) => a + (b - a) * k;
    switch (this.state) {
      case 'idle':
        if (!this.hop) turn(SPAR.turn);
        P.yaw = ease(P.yaw, 0.6, 0.2); P.pitch = ease(P.pitch, 1.0 + Math.sin(this.t * 0.06) * 0.05, 0.2); P.twist = ease(P.twist, 0, 0.2);
        if (--this.cool <= 0 && h && !h.dead && dist < SPAR.range && !this.hop && !this.vx && !this.vz) {
          this.state = 'windup'; this.st = 0; this.attacks++;
          combatSfx.creak(SPAR.windup / 60);
          events.emit('combat:enemyWindup', { enemy: this, x: this.x, z: this.z });
        }
        break;
      case 'windup': {
        if (this.st < SPAR.windup - 14) turn(SPAR.turn * 0.6);
        const u = this.st / SPAR.windup;
        P.yaw = ease(P.yaw, 2.3, 0.12); P.pitch = ease(P.pitch, -0.35, 0.12); P.twist = ease(P.twist, -0.5 * Math.min(1, u * 1.5), 0.3);
        if (this.st >= SPAR.windup) { this.state = 'swing'; this.st = 0; this.swingHit = false; combatSfx.whack(); }
        break;
      }
      case 'swing': {
        const u = Math.min(1, this.st / SPAR.swing);
        P.yaw = 2.3 + (-1.5 - 2.3) * (1 - (1 - u) * (1 - u)); P.pitch = 0.05; P.twist = -0.5 + 1.1 * u;
        if (this.st >= 1 && this.st <= 4 && !this.swingHit && h && !h.dead) {
          const rel = Math.abs(wrap(want - this.yaw)) * 180 / Math.PI;
          if (dist - 0.3 <= SPAR.reach && rel <= SPAR.halfAngle) {
            this.swingHit = true;
            const r = h.hurt(1, { x: this.x, z: this.z });
            if (r.ok) this.landed++; else if (r.reason === 'dodged') this.dodged++;
          }
        }
        if (this.st >= SPAR.swing) { this.state = 'recover'; this.st = 0; }
        break;
      }
      case 'recover':
        P.yaw = ease(P.yaw, 0.6, 0.08); P.pitch = ease(P.pitch, 1.0, 0.08); P.twist = ease(P.twist, 0, 0.1);
        if (this.st >= SPAR.recover) { this.state = 'idle'; this.st = 0; this.cool = SPAR.cooldown; }
        break;
      case 'stagger':
        P.yaw = ease(P.yaw, 0.2, 0.2); P.pitch = ease(P.pitch, 1.3, 0.2); P.twist = ease(P.twist, 0.3 * Math.sin(this.st * 0.6), 0.5);
        if (this.st >= 30) { this.state = 'idle'; this.st = 0; this.cool = 40; }
        break;
    }
    this.tele.set(this.state === 'windup' ? this.st / SPAR.windup : this.state === 'swing' ? 1 : -1, this.state === 'swing', this.x, this.z, this.yaw, this.st);
  }

  render(alpha) {
    super.render(alpha);
    const a = this.prevClub, b = this.clubPose;
    const L = (k) => a[k] + (b[k] - a[k]) * alpha;
    this.club.rotation.set(L('pitch'), L('yaw'), 0, 'YXZ');
    this.body.rotation.y = L('twist');
    // ember eyes brighten through the windup (the emissive voxels stay ember; the body glows)
    if (this.state === 'windup' && this.st > SPAR.windup - 10 && !this.flashT) {
      this.material.userData.flash.value = (this.st % 4 < 2) ? 0.35 : 0;
      this.material.userData.flashColor.value.setHex(hex('ember'));
    }
  }

  dispose() { super.dispose(); this.tele.dispose(); }

  info() { return { ...super.info(), state: this.state, st: this.st, attacks: this.attacks, landed: this.landed, dodged: this.dodged }; }
}

// ---- the floor telegraph ---------------------------------------------------------------------

function makeTelegraph(root) {
  const cells = [];
  const step = V;               // one voxel tiles
  const R = SPAR.reach + 0.3;   // the hero's body radius is included in what's shown
  for (let z = -R; z <= R; z += step) for (let x = -R; x <= R; x += step) {
    const d = Math.hypot(x, z);
    if (d > R || d < 0.5) continue;
    const a = Math.atan2(x, z) * 180 / Math.PI;
    if (Math.abs(a) > SPAR.halfAngle) continue;
    const edge = d > R - step * 1.2 || Math.abs(a) > SPAR.halfAngle - (step / d) * 180 / Math.PI * 1.2;
    cells.push({ x, z, d, edge });
  }
  const geo = new THREE.BoxGeometry(step, 0.01, step);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const inst = new THREE.InstancedMesh(geo, mat, cells.length);
  inst.frustumCulled = false;
  look.noOutline(inst);
  inst.visible = false;
  root.add(inst);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  // ember on an unlit mesh does not survive the post chain's reserved-colour rule, so the
  // telegraph uses red (edge / fill front) and gold (firing)
  const cEmber = hex('red'), cBlood = hex('blood'), cFlame = hex('gold'), cPlum = hex('plum');
  return {
    set(progress, firing, x, z, yaw, st) {
      if (progress < 0) { inst.visible = false; return; }
      inst.visible = true;
      const cs = Math.cos(yaw), sn = Math.sin(yaw);
      const fill = firing ? R : 0.5 + (R - 0.5) * progress;
      const late = progress > 0.75 && !firing;
      let n = 0;
      for (const cell of cells) {
        const show = cell.edge || cell.d <= fill;
        if (!show) { m.makeScale(0, 0, 0); inst.setMatrixAt(n, m); inst.setColorAt(n++, c.setHex(cBlood)); continue; }
        // rotate the sector to the dummy's facing; tiles stay on the world voxel grid
        const wx = Math.round((x + cell.x * cs + cell.z * sn) / V) * V;
        const wz = Math.round((z - cell.x * sn + cell.z * cs) / V) * V;
        m.makeTranslation(wx, 0.012, wz);
        inst.setMatrixAt(n, m);
        let col = cell.edge ? cEmber : (Math.abs(cell.d - fill) < 0.13 ? cEmber : ((Math.round(cell.x / V) + Math.round(cell.z / V)) & 1 ? cBlood : cPlum));
        if (firing) col = cell.edge ? cFlame : cEmber;
        else if (late && cell.edge && (st >> 1) % 2) col = cFlame;
        inst.setColorAt(n++, c.setHex(col));
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },
    dispose() { root.remove(inst); geo.dispose(); mat.dispose(); },
  };
}
