// The effects library. Each effect is a recipe over the particle pool (particles.js), the 2D
// marks (marks.js), and the shared light and feedback channels. Every recipe has the same
// shape in time: a bright, fast pop (a white frame, heavy drag so the burst decelerates hard),
// then a longer, dimmer tail that steps down a palette ramp and shrinks a pixel at a time.
//
// All positions are world units (y is up, z toward the camera); all effects take one options
// object and never allocate per frame. Emitters (portal, fountain, sparkle) run on a small fixed
// pool and spawn particles over several ticks.

import * as THREE from 'three';
import { ramp, F_STRETCH, F_BOUNCE, F_FLAT, F_GROUND, F_TWINKLE } from './particles.js';
import { addMark, STAR, SMEAR, GLOW, TWINKLE, RING } from './marks.js';
import { look } from '../render/look.js';
import { feedback } from '../core/feedback.js';
import { hex } from '../render/palette.js';
import { DT } from '../core/loop.js';

// ---- ramps (palette names only) ---------------------------------------------------------------
const R = {
  hit: 'white,torch,gold,flame',
  hurt: 'white,rose,red,blood',
  magic: 'white,sky,cyan,teal',
  void: 'white,frost,fog,violet',
  ember: 'gold,flame,ember,blood',
  hot: 'white,gold,ember,blood',
  smoke: 'frost,fog,mist,slate',
  dust: 'white,frost,fog,mist',
  ring: 'white,frost,fog,mist',
  gold: 'white,torch,gold,flame',
  ice: 'white,sky,frost,fog',
};
const RAMP_FOR = { hit: R.hit, hurt: R.hurt, magic: R.magic, void: R.void, ember: R.ember, gold: R.gold, ice: R.ice };

export function createEffects(pp, ctx) {
  let seed = 12345;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const rr = (a, b) => a + (b - a) * rnd();
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const rampOf = (style) => ramp(RAMP_FOR[style] ?? style);

  const angleOf = (dx, dz) => Math.atan2(dx ?? 0, dz ?? 0);
  const feel = (o, shake, ms = 140, flash) => {
    if (!o.feel) return;
    if (shake) feedback.shake(shake, ms);
    if (flash) feedback.flash(flash, 70, 0.35);
  };
  const lightPop = (x, y, z, color, ms, intensity, radius) => { if (look.lights) look.flash(x, y, z, { color, ms, intensity, radius }); };

  // ---- emitters ---------------------------------------------------------------------------------
  const EM = Array.from({ length: 24 }, () => ({ on: false, type: '', t: 0, dur: 0, x: 0, y: 0, z: 0, a: 0, b: 0, style: 'magic', n: 0 }));
  function startEmitter(type, x, y, z, dur, o = {}) {
    const e = EM.find((q) => !q.on) ?? EM[0];
    e.on = true; e.type = type; e.t = 0; e.dur = dur; e.x = x; e.y = y; e.z = z; e.a = o.a ?? 1; e.b = o.b ?? 0; e.style = o.style ?? 'magic'; e.n = o.n ?? 1;
    e.o = o;
    return e;
  }

  // ---- the library ----------------------------------------------------------------------------
  const fx = {
    /** Hit-spark: white core pop, a fan of streaks along the blow, glowing chips, a 2D star. */
    hit(o = {}) {
      const { x = 0, y = 0.6, z = 0, power = 1, style = 'hit' } = o;
      const dx = o.dx ?? 0, dz = o.dz ?? 1;
      const l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
      const rid = rampOf(style), p = power;
      // core: one fat white cube that pops and is gone in 5 ticks
      const c = pp.add(x, y, z, 0, 0, 0, 0.09 + 0.02 * p, 6 + 3 * p, 1, rid, 0, 1, 0);
      pp.set(c, { pop: 0.15 });
      // streaks: a cone along the blow, a few thrown back at the attacker, all decelerating hard
      const n = Math.round(8 + 5 * p);
      for (let i = 0; i < n; i++) {
        const back = i < 2 ? -0.5 : 1;
        const a = Math.atan2(ux, uz) + rr(-0.75, 0.75) + (o.spread ?? 0) * rr(-1, 1);
        const sp = rr(9, 17) * (0.75 + 0.3 * p) * (i % 3 === 0 ? 1.4 : 1);
        const k = pp.add(x, y + rr(-0.05, 0.1), z, Math.sin(a) * sp * back, rr(0.2, 3.5), Math.cos(a) * sp * back,
          rr(0.16, 0.36) * (0.8 + 0.25 * p), i % 3 === 0 ? 2 : 1.5, 1, rid, F_STRETCH | F_BOUNCE, 0.9, 12);
        pp.set(k, { stretch: 2.4 + rnd() * 1.2, pop: 0.05 });
      }
      // glowing chips that fall
      const chips = Math.round(2 + 2 * p);
      for (let i = 0; i < chips; i++) {
        const a = rnd() * 6.283, sp = rr(1.5, 4);
        pp.add(x, y, z, Math.sin(a) * sp, rr(2, 5), Math.cos(a) * sp, rr(0.3, 0.55), 2, 1, ramp(R.ember), F_BOUNCE | F_TWINKLE, 0.94, 22);
      }
      addMark(STAR, x, y, z, 6, { a: p, col: style === 'hurt' ? 'red' : style === 'magic' ? 'cyan' : 'white' });
      lightPop(x, y + 0.2, z, style === 'hurt' ? 'red' : style === 'magic' ? 'cyan' : 'torch', 90, 1.3 + p * 0.5, 2.6);
      feel(o, 1.2 + p * 1.6, 110);
    },

    /** Slash smear: a crescent swept round the attacker in 3 ticks and thinned out over 7. */
    smear(o = {}) {
      const { x = 0, y = 0.55, z = 0, yaw = 0, radius = 0.95, sweep = 2.3, side = 1, power = 1 } = o;
      addMark(SMEAR, x, y, z, 7, { a: yaw, b: radius, c: sweep, d: side, e: power });
    },

    /** Dust puff: fat pale cubes that swell for a few ticks, drag to a stop, and shrink away. */
    dust(o = {}) {
      const { x = 0, z = 0, y = 0.06, n = 9, size = 5, style = 'dust' } = o;
      const dx = o.dx ?? 0, dz = o.dz ?? 0, dl = Math.hypot(dx, dz);
      const rid = ramp(R[style] ?? style);
      for (let i = 0; i < n; i++) {
        const a = rnd() * 6.283, sp = rr(1.6, 4.2) * (o.speed ?? 1);
        let vx = Math.sin(a) * sp, vz = Math.cos(a) * sp;
        if (dl > 0) { vx += (-dx / dl) * rr(1, 3) * (o.speed ?? 1); vz += (-dz / dl) * rr(1, 3) * (o.speed ?? 1); }
        const k = pp.add(x + Math.sin(a) * 0.08, y, z + Math.cos(a) * 0.08, vx, rr(0.3, 1.1), vz, rr(0.32, 0.58),
          size * rr(0.9, 1.4), 1, rid, 0, 0.925, -0.6);
        pp.set(k, { pop: 0.3 });
      }
    },

    /** Dash burst: kick-off dust at the feet and speed streaks left hanging in the air behind. */
    dash(o = {}) {
      const { x = 0, z = 0 } = o;
      const dx = o.dx ?? 0, dz = o.dz ?? 1, l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l;
      fx.dust({ x, z, dx: ux, dz: uz, n: 8, size: 4, speed: 1.6 });
      for (let i = 0; i < 6; i++) {
        const off = rr(-0.3, 0.3), h = rr(0.15, 0.85);
        const k = pp.add(x - ux * rr(0.1, 0.5) - uz * off, h, z - uz * rr(0.1, 0.5) + ux * off, -ux * rr(3, 6), 0, -uz * rr(3, 6),
          rr(0.16, 0.28), 2, 1, ramp(R.ice), F_STRETCH, 0.8, 0);
        pp.set(k, { stretch: 3.2, pop: 0.05 });
      }
      addMark(RING, x, 0.02, z, 6, { a: 0.75, col: 'frost' });
      feel(o, 1.5, 90);
    },

    /** Death burst: a white frame, the target's own colours flung out and bouncing, smoke, embers. */
    death(o = {}) {
      const { x = 0, y = 0.45, z = 0, power = 1, colors = ['stone', 'stoneLight', 'dusk'] } = o;
      const p = power;
      const c = pp.add(x, y, z, 0, 0, 0, 0.13, 14 * p, 2, ramp(R.hit), 0, 1, 0);
      pp.set(c, { pop: 0.2 });
      const n = Math.round(16 + 10 * p);
      for (let i = 0; i < n; i++) {
        const col = colors[i % colors.length];
        const a = rnd() * 6.283, sp = rr(2.2, 7) * (0.8 + 0.3 * p);
        const big = i % 4 === 0;
        pp.add(x + rr(-0.1, 0.1), y + rr(-0.15, 0.25), z + rr(-0.1, 0.1), Math.sin(a) * sp, rr(4, 9), Math.cos(a) * sp,
          rr(0.7, 1.25), big ? 6 : 4, big ? 3 : 2, ramp(`white,${col},${col},${col}`), F_BOUNCE, 0.97, 24);
      }
      for (let i = 0; i < 12; i++) {
        const a = rnd() * 6.283, sp = rr(9, 16);
        const k = pp.add(x, y, z, Math.sin(a) * sp, rr(1, 6), Math.cos(a) * sp, rr(0.16, 0.3), 2, 1, ramp(R.hit), F_STRETCH | F_BOUNCE, 0.86, 12);
        pp.set(k, { stretch: 2 });
      }
      for (let i = 0; i < 6; i++) {
        const a = rnd() * 6.283, sp = rr(0.9, 2.4);
        const k = pp.add(x, y + 0.1, z, Math.sin(a) * sp, rr(0.6, 1.8), Math.cos(a) * sp, rr(0.5, 0.85), rr(4, 7) * p, 1, ramp('fog,mist,slate,violet'), 0, 0.9, -0.5);
        pp.set(k, { pop: 0.35, delay: DT * 2 });
      }
      for (let i = 0; i < 5; i++) {
        const k = pp.add(x + rr(-0.15, 0.15), y, z + rr(-0.15, 0.15), rr(-0.4, 0.4), rr(1, 2.2), rr(-0.4, 0.4), rr(0.7, 1.3), 2, 1, ramp(R.ember), F_TWINKLE, 0.97, -0.5);
        pp.set(k, { delay: DT * 4 });
      }
      addMark(GLOW, x, y, z, 8, { a: 1.1 * p, col: 'torch' });
      addMark(STAR, x, y, z, 6, { a: 1.5 * p, col: 'torch' });
      addMark(RING, x, 0.03, z, 9, { a: 0.9 * p, col: 'frost' });
      lightPop(x, y + 0.3, z, 'torch', 140, 2, 3.4);
      feel(o, 3 + 2 * p, 190, 'white');
    },

    /** Spawn portal: a spinning rune ring draws in, motes spiral inward and rise, then it pops. */
    portal(o = {}) {
      const { x = 0, z = 0, radius = 0.9, dur = 0.85, style = 'void' } = o;
      startEmitter('portal', x, 0.04, z, dur, { a: radius, style });
      lightPop(x, 0.4, z, style === 'ember' ? 'ember' : 'cyan', dur * 1000, 1.1, 3.2);
    },

    /** A fountain of embers: rising, wobbling, cooling gold to red. */
    embers(o = {}) {
      const { x = 0, y = 0.1, z = 0, n = 14, dur = 0 } = o;
      if (dur > 0) { startEmitter('fountain', x, y, z, dur, { a: o.rate ?? 1.2, style: 'ember' }); return; }
      for (let i = 0; i < n; i++) emberOne(x, y, z, 1);
    },

    /** A light flash: a dithered glow that steps down in bands, a real light pop, optional screen flash. */
    flash(o = {}) {
      const { x = 0, y = 0.6, z = 0, color = 'torch', radius = 2.2, ms = 160 } = o;
      addMark(GLOW, x, y, z, Math.max(5, Math.round(ms / 16.7 * 0.7)), { a: radius, col: color });
      lightPop(x, y, z, color === 'ember' ? 'ember' : color, ms, o.intensity ?? 2.2, radius * 1.6);
      if (o.screen) feedback.flash(color, 90, o.screen === true ? 0.3 : o.screen);
    },

    /** Shockwave ring: a fast ring of flat cubes that decelerates outward, with dust kicked up. */
    shockwave(o = {}) {
      const { x = 0, z = 0, radius = 3, style = 'ring' } = o;
      const n = Math.max(16, Math.round(radius * 26));
      const rid = ramp(R[style] ?? style);
      const v0 = radius * 8.2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 6.283 + rr(-0.03, 0.03), s = v0 * rr(0.94, 1.06);
        const k = pp.add(x + Math.sin(a) * 0.15, 0.04, z + Math.cos(a) * 0.15, Math.sin(a) * s, 0, Math.cos(a) * s, rr(0.34, 0.42), 3, 1, rid, F_FLAT, 0.885, 0);
        pp.set(k, { pop: 0.08 });
      }
      // inner dust ring: slower, fatter, lives longer
      for (let i = 0; i < Math.round(n / 3); i++) {
        const a = rnd() * 6.283, s = v0 * rr(0.3, 0.6);
        const k = pp.add(x, 0.06, z, Math.sin(a) * s, rr(0.2, 0.8), Math.cos(a) * s, rr(0.4, 0.65), rr(4, 6), 1, ramp(R.dust), 0, 0.89, -0.4);
        pp.set(k, { pop: 0.3, delay: DT });
      }
      const c = pp.add(x, 0.1, z, 0, 0, 0, 0.1, 10, 2, ramp(R.hit), F_FLAT, 1, 0);
      pp.set(c, { pop: 0.2 });
      addMark(RING, x, 0.02, z, 14, { a: radius * 1.05, b: 0.885, col: 'white' });
      lightPop(x, 0.3, z, 'torch', 120, 1.6, radius * 1.4);
      feel(o, 2.4, 160, null);
    },

    /** Pickup sparkle: a rising ring, twinkling motes that float up, and 2D star sprites. */
    pickup(o = {}) {
      const { x = 0, y = 0.4, z = 0, style = 'gold' } = o;
      const rid = ramp(R[style] ?? style);
      const col = style === 'magic' ? 'cyan' : style === 'hurt' ? 'rose' : 'gold';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * 6.283;
        const k = pp.add(x + Math.sin(a) * 0.1, y - 0.25, z + Math.cos(a) * 0.1, Math.sin(a) * 1.5, 1.2, Math.cos(a) * 1.5, 0.5, 2, 1, rid, F_FLAT, 0.9, -0.3);
        pp.set(k, { pop: 0.1 });
      }
      for (let i = 0; i < 9; i++) {
        const a = rnd() * 6.283, sp = rr(0.2, 0.8);
        const k = pp.add(x + rr(-0.15, 0.15), y + rr(-0.1, 0.2), z + rr(-0.15, 0.15), Math.sin(a) * sp, rr(0.7, 2), Math.cos(a) * sp, rr(0.5, 0.95), 2, 1, rid, F_TWINKLE, 0.96, -0.5);
        pp.set(k, { delay: DT * Math.floor(rnd() * 8) });
      }
      for (let i = 0; i < 4; i++) {
        addMark(TWINKLE, x + rr(-0.25, 0.25), y + rr(0, 0.35), z + rr(-0.15, 0.15), 10 + i * 2, { col, a: i === 0 ? 1.4 : 1, dy: -0.35, dx: rr(-0.2, 0.2) });
      }
      const c = pp.add(x, y, z, 0, 0, 0, 0.1, 6, 1, ramp(R.hit), 0, 1, 0);
      pp.set(c, { pop: 0.2 });
      lightPop(x, y, z, col === 'cyan' ? 'cyan' : 'gold', 140, 1.2, 2.2);
    },
  };

  function emberOne(x, y, z, rise) {
    const a = rnd() * 6.283, sp = rr(0.1, 0.7);
    const k = pp.add(x + rr(-0.1, 0.1), y, z + rr(-0.1, 0.1), Math.sin(a) * sp, rr(1.3, 2.8) * rise, Math.cos(a) * sp, rr(0.7, 1.5), rnd() < 0.3 ? 3 : 2, 1, ramp(R.ember), F_TWINKLE, 0.965, -0.4);
    pp.set(k, { pop: 0.1 });
  }

  function tickEmitters() {
    for (const e of EM) {
      if (!e.on) continue;
      e.t += DT;
      const u = e.t / e.dur;
      if (e.type === 'portal') {
        const R0 = e.a, style = e.style;
        const rid = ramp(R[style] ?? style);
        // runes: a head of dots chasing round the rim, two of them, radius pulsing in
        const spin = e.t * 9;
        for (let h = 0; h < 2; h++) for (let s = 0; s < 3; s++) {
          const ang = spin + h * Math.PI - s * 0.16, rd = R0 * (1 - 0.15 * u) * (u < 0.1 ? u / 0.1 : 1);
          const k = pp.add(e.x + Math.sin(ang) * rd, 0.04, e.z + Math.cos(ang) * rd, 0, 0, 0, 0.22 + s * 0.05, 3 - (s > 1 ? 1 : 0), 1, rid, F_FLAT, 1, 0);
          pp.set(k, { pop: 0.05 });
        }
        // a few standing rune ticks appearing round the ring as it draws in
        if (((e.t / DT) | 0) % 3 === 0) {
          const ang = rnd() * 6.283, rd = R0 * (1 - 0.15 * u);
          pp.add(e.x + Math.sin(ang) * rd, 0.05, e.z + Math.cos(ang) * rd, 0, 0.8, 0, 0.3, 2, 1, rid, F_TWINKLE, 0.95, 0);
        }
        // motes spiral in and rise, faster as it charges
        const rate = 1 + Math.floor(u * 3);
        for (let i = 0; i < rate; i++) {
          const ang = rnd() * 6.283, rd = R0 * rr(0.9, 1.3);
          const tang = 1.6 + u * 2;
          const k = pp.add(e.x + Math.sin(ang) * rd, 0.05, e.z + Math.cos(ang) * rd,
            -Math.sin(ang) * rd * 2.2 + Math.cos(ang) * tang, rr(0.3, 1.2) + u * 2, -Math.cos(ang) * rd * 2.2 - Math.sin(ang) * tang,
            rr(0.28, 0.42), 2, 1, rid, F_TWINKLE, 0.93, -0.5);
          pp.set(k, { pop: 0.1 });
        }
        // a column of light building in the middle
        if (u > 0.35 && ((e.t / DT) | 0) % 2 === 0) {
          const k = pp.add(e.x + rr(-0.12, 0.12), 0.1, e.z + rr(-0.12, 0.12), 0, rr(2, 4) + u * 3, 0, rr(0.2, 0.32), 3, 1, ramp(style === 'ember' ? R.hot : R.magic), 0, 0.96, 0);
          pp.set(k, { pop: 0.15 });
        }
        if (e.t >= e.dur) {
          e.on = false;
          // the pop: white frame, an upward burst, a floor ring, and a real flash
          const c = pp.add(e.x, 0.45, e.z, 0, 0, 0, 0.14, 15, 2, ramp(R.hit), 0, 1, 0);
          pp.set(c, { pop: 0.2 });
          for (let i = 0; i < 16; i++) {
            const a = rnd() * 6.283, sp = rr(1, 4);
            const k = pp.add(e.x, 0.15, e.z, Math.sin(a) * sp, rr(4, 9), Math.cos(a) * sp, rr(0.25, 0.5), 2 + (i % 3 === 0 ? 1 : 0), 1, rid, F_STRETCH | F_BOUNCE, 0.9, 16);
            pp.set(k, { stretch: 1.8 });
          }
          fx.shockwave({ x: e.x, z: e.z, radius: R0 * 1.5, style: style === 'ember' ? 'ember' : 'ring' });
          addMark(GLOW, e.x, 0.5, e.z, 8, { a: R0 * 1.7, col: style === 'ember' ? 'ember' : 'cyan' });
          lightPop(e.x, 0.6, e.z, style === 'ember' ? 'ember' : 'sky', 220, 2.4, 4);
          if (e.o?.feel) { feedback.flash('white', 60, 0.25); feedback.shake(2.2, 140); }
        }
      } else if (e.type === 'fountain') {
        if (((e.t / DT) | 0) % Math.max(1, Math.round(4 / e.a)) === 0) emberOne(e.x, e.y, e.z, 1);
        if (e.t >= e.dur) e.on = false;
      }
    }
  }

  // ---- after-images: flat palette silhouettes of any object, stepping down a colour ramp -----------
  const GH_MAX = 96;
  const ghostGroup = new THREE.Group();
  ghostGroup.name = 'vfx-ghosts';
  look.noOutline(ghostGroup);
  ctx.root.add(ghostGroup);
  const ghostMeshes = [];                  // pool of meshes (geometry swapped per use)
  const ghostMats = {};                    // ramp id -> materials per stage
  const GH = [];                           // active ghosts: { idx: [mesh indices], t, life, mats }
  let ghostUsed = 0;
  function ghostMat(names) {
    const key = names.join(',');
    return ghostMats[key] ?? (ghostMats[key] = names.map((nm) => new THREE.MeshBasicMaterial({ color: hex(nm) })));
  }
  const tmpMeshes = [];
  fx.afterImage = (obj, o = {}) => {
    const names = o.ramp ?? ['white', 'sky', 'cyan', 'teal', 'navy'];
    obj.updateMatrixWorld(true);
    tmpMeshes.length = 0;
    obj.traverseVisible((c) => { if (c.isMesh && !c.isInstancedMesh && !c.userData.vfxGhost && c.geometry) tmpMeshes.push(c); });
    if (!tmpMeshes.length) return;
    let g = GH.find((q) => !q.on);
    if (!g) { g = { on: false, idx: [], t: 0, life: 1, mats: null }; GH.push(g); if (GH.length > 24) GH.shift(); }
    g.on = true; g.t = 0; g.life = Math.max(2, Math.round((o.life ?? 0.3) / DT)); g.mats = ghostMat(names); g.idx.length = 0;
    for (const src of tmpMeshes) {
      let i = ghostUsed++ % GH_MAX;
      let m = ghostMeshes[i];
      if (!m) { m = new THREE.Mesh(src.geometry, g.mats[0]); m.matrixAutoUpdate = false; m.userData.vfxGhost = true; m.frustumCulled = false; ghostMeshes[i] = m; ghostGroup.add(m); }
      m.geometry = src.geometry; m.material = g.mats[0];
      m.matrix.copy(src.matrixWorld); m.matrixWorldNeedsUpdate = true; m.visible = true;
      g.idx.push(i);
    }
  };
  function tickGhosts() {
    for (const g of GH) {
      if (!g.on) continue;
      g.t++;
      const k = g.t / g.life;
      if (k >= 1) { g.on = false; for (const i of g.idx) ghostMeshes[i].visible = false; continue; }
      const stage = Math.min(g.mats.length - 1, Math.floor(k * g.mats.length));
      const blink = k > 0.7 && (g.t & 1);                   // last third: dithers out, not a fade
      for (const i of g.idx) { const m = ghostMeshes[i]; m.material = g.mats[stage]; m.visible = !blink; }
    }
  }
  function clearGhosts() { for (const g of GH) { g.on = false; } for (const m of ghostMeshes) if (m) m.visible = false; }

  fx.tick = () => { tickEmitters(); tickGhosts(); };
  fx.clear = () => { for (const e of EM) e.on = false; clearGhosts(); };
  fx.dispose = () => { ctx.root.remove(ghostGroup); for (const arr of Object.values(ghostMats)) for (const m of arr) m.dispose(); };
  fx.activeEmitters = () => EM.filter((e) => e.on).length;
  return fx;
}
