// ?showcase=hero : the hooded runner on a plinth, cycling every animation with its name.
//
// Params:  &anim=all|idle|run|turn|dash|attack|hurt|death|spawn   (default all: auto cycle)
//          &zoom=1..4   (default 3; 1 = game scale)
//          &yaw=<deg>   facing relative to the camera (default -25: three-quarter, sword side)
//          &slow=<s>    time scale, e.g. 0.25
//          &hud=0       no labels at all (clean stills)
// Keys:    1 idle  2 run  3 turn  4 dash  5 attack combo  6 hurt  7 death  8 spawn  9 cycle all
//          J attack (chains the combo)  K dash  L hurt  (live triggers, any mode)
//          Left/Right turn the hero 45 deg   Z zoom   T slow-mo (1, 0.5, 0.25, 0.1)   H labels
//          P/Esc pause

import * as THREE from 'three';
import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop, DT } from '../core/loop.js';
import { world } from '../core/world.js';
import { rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { buildStage } from '../core/stage.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css, hex } from '../render/palette.js';
import { voxelMesh, VOXEL } from '../render/voxel/index.js';
import { look } from '../render/look.js';
import { createHeroRig } from './model.js';
import { HeroAnim, ATTACKS, RUN_SPEED } from './anim.js';

const MODES = [
  { id: 'idle', label: 'IDLE', dur: 300, note: 'BREATHING, BLINKS, A LOOK AROUND' },
  { id: 'run', label: 'RUN CYCLE', dur: 180, note: 'CONTACT / DOWN / PASSING / UP, FOOTSTEP DUST' },
  { id: 'turn', label: 'TURNS', dur: 200, note: 'REVERSALS PIVOT WITH A SQUASH, NEVER POP' },
  { id: 'dash', label: 'DASH', dur: 150, note: 'STRETCH, AFTERIMAGES, SKID' },
  { id: 'attack', label: 'ATTACK COMBO', dur: 170, note: 'ANTICIPATION, SMEAR, RECOVERY' },
  { id: 'hurt', label: 'HURT', dur: 150, note: 'FLASH, WINCE, FLINCH AWAY FROM THE HIT' },
  { id: 'death', label: 'DEATH', dur: 170, note: 'JOLT, KNEES, COLLAPSE' },
  { id: 'spawn', label: 'SPAWN-IN', dur: 110, note: 'DROP, SQUASH, FLOURISH' },
];
const PLINTH_Y = 2 * VOXEL; // top of test.plinth's inner disc
const SLOWS = [1, 0.5, 0.25, 0.1];

export default function heroShowcase(params) {
  let hud = params.get('hud') !== '0';
  let zoom = Math.max(1, Math.min(4, parseInt(params.get('zoom') ?? '3', 10) || 3));
  let viewYaw = THREE.MathUtils.degToRad(parseFloat(params.get('yaw') ?? '-25') || 0);
  const slowParam = parseFloat(params.get('slow') ?? '1');
  let slowIdx = Math.max(0, SLOWS.indexOf(slowParam));
  const want = params.get('anim') ?? 'all';
  let cycle = !MODES.some((m) => m.id === want);
  let modeIdx = cycle ? 0 : MODES.findIndex((m) => m.id === want);

  let root, stage, rig, anim, dust, offs = [];
  let mt = 0;          // ticks in the current mode
  let hx = 0, hz = 0;  // hero position (moves only in the dash demo)
  let face = viewYaw;
  let combo = 0, comboQueued = false, hurtSide = 1;
  let status = { text: '', until: 0 };
  const say = (text) => { status = { text, until: loop.realTime + 1.4 }; };

  function setMode(i, announce = false) {
    modeIdx = (i + MODES.length) % MODES.length;
    mt = 0; hx = 0; hz = 0; face = viewYaw; combo = 0; comboQueued = false;
    anim.reset(0, 0, viewYaw);
    const id = MODES[modeIdx].id;
    if (id === 'idle') anim.idleT = 200;  // the look-around starts about 1.7 s in
    if (id === 'spawn') anim.spawn();
    if (announce) say(MODES[modeIdx].label);
  }

  function live(what) {
    if (what === 'attack') {
      if (anim.state === 'attack' && !anim.canChain) { comboQueued = true; return; }
      combo = anim.state === 'attack' ? (anim.step + 1) % 3 : 0;
      anim.attack(combo);
    } else if (what === 'dash') anim.dash(10);
    else if (what === 'hurt') { hurtSide = -hurtSide; anim.hurt(face + hurtSide * 0.9); }
  }

  // what each mode does on each tick, before the animator ticks
  function drive() {
    const id = MODES[modeIdx].id;
    const t = mt;
    let speed = 0, vx, vz;
    if (id === 'run') speed = RUN_SPEED;
    if (id === 'turn') {
      speed = RUN_SPEED;
      const seg = Math.floor(t / 50);
      face = viewYaw + (seg % 2 ? Math.PI : 0) + (seg % 4 >= 2 ? 0.8 : 0);
    }
    if (id === 'dash') {
      // dash across the plinth and back, a beat between
      const k = t % 75;
      const dir = Math.floor(t / 75) % 2 ? -1 : 1;
      face = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
      if (k === 20) anim.dash(10);
      if (k >= 20 && k < 30) { const v = 12.5 * dir; hx += v * DT; vx = v; vz = 0; }
      else if (k >= 30 && k < 35) { const v = 2.5 * dir * (35 - k) / 5; hx += v * DT; vx = v; vz = 0; }
      else { vx = 0; vz = 0; }
      hx = Math.max(-1.35, Math.min(1.35, hx));
    }
    if (id === 'attack') {
      // the full combo on beat, then a rest: 1-2-3 chained at each attack's cancel tick
      const k = t % 110;
      if (k === 10) { combo = 0; anim.attack(0); }
      else if (anim.state === 'attack' && anim.step < 2 && k > 10 && k < 80 && anim.t === ATTACKS[anim.step].cancel) {
        combo = anim.step + 1; anim.attack(combo);
      }
    }
    if (id === 'hurt') {
      const k = t % 50;
      if (k === 12) anim.hurt(face + (Math.floor(t / 50) % 2 ? 0.8 : -0.8));
    }
    if (id === 'death') {
      const k = t % 170;
      if (k === 12) anim.die();
      if (k === 150) anim.spawn();
    }
    if (id === 'spawn' && t > 0 && t % 80 === 0) anim.spawn();
    // the live combo: a queued press fires as soon as the current swing allows it
    if (comboQueued && anim.state === 'attack' && anim.canChain) {
      comboQueued = false; combo = (anim.step + 1) % 3; anim.attack(combo);
    }
    const ctl = { x: hx, z: hz, face };
    if (id === 'dash') { ctl.vx = vx; ctl.vz = vz; }
    else ctl.speed = speed;
    if ((id === 'run' || id === 'turn') && anim.state === 'loco') {
      // running in place: feed the cloth the wind it would feel
      ctl.vx = Math.sin(anim.pose.cur.yaw) * speed; ctl.vz = Math.cos(anim.pose.cur.yaw) * speed;
    }
    anim.tick(ctl);
  }

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      display.setZoom(zoom);
      loop.setTimeScale(SLOWS[slowIdx]);
      stage = buildStage(root, { torches: [[-2.4, -1.9], [2.4, -1.9], [-2.6, 1.9], [2.6, 1.9]], rng: rng.fork('hero-stage'), dustBox: [5, 2.5, 4] });
      const plinth = voxelMesh('test.plinth');
      root.add(plinth);
      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: 0, z: 0, yaw: viewYaw, floorY: PLINTH_Y });
      anim.onDebug = (action, arg) => {
        if (action === 'mode') {
          const i = MODES.findIndex((m) => m.id === arg);
          if (arg === 'all') { cycle = true; setMode(0); }
          else if (i >= 0) { cycle = false; setMode(i); }
          else return { ok: false, error: `no mode "${arg}"`, modes: MODES.map((m) => m.id) };
        }
        return undefined;
      };
      world.hero = { get x() { return anim.pose.cur.x; }, get z() { return anim.pose.cur.z; }, hp: 5, maxHp: 5 };
      dust = makeDust(root, rng.fork('hero-dust'));
      const on = (name, fn) => offs.push(events.on(name, fn));
      on('hero:step', (e) => dust.puff(footPos(e), 3, 0.5, e.yaw));
      on('hero:dash', (e) => dust.puff({ x: e.x, z: e.z }, 7, 1.1, e.yaw));
      on('hero:land', (e) => dust.ring(e, 12, 1.1));
      on('hero:slam', (e) => dust.ring({ x: e.x + Math.sin(e.yaw) * 0.55, z: e.z + Math.cos(e.yaw) * 0.55 }, 10, 1.3));
      on('hero:thud', (e) => dust.ring({ x: e.x + Math.sin(e.yaw) * 0.5, z: e.z + Math.cos(e.yaw) * 0.5 }, 9, 0.9));
      setMode(modeIdx);
    },

    exit() {
      offs.forEach((f) => f());
      offs = [];
      loop.setTimeScale(1);
    },

    frame() {
      const k = input.ui.key;
      for (let i = 1; i <= 9; i++) {
        if (!k(`Digit${i}`)) continue;
        if (i === 9) { cycle = true; setMode(0, true); say('CYCLING ALL'); }
        else { cycle = false; setMode(i - 1, true); }
      }
      if (k('ArrowLeft') || k('ArrowRight')) {
        viewYaw += (k('ArrowLeft') ? -1 : 1) * Math.PI / 4;
        face = viewYaw;
        say(`FACING ${Math.round(((THREE.MathUtils.radToDeg(viewYaw) % 360) + 540) % 360 - 180)}`);
      }
      if (k('KeyZ')) { zoom = zoom >= 4 ? 1 : zoom + 1; display.setZoom(zoom); say(`ZOOM ${zoom}X`); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (k('KeyH')) hud = !hud;
      if (k('KeyJ')) live('attack');
      if (k('KeyK')) live('dash');
      if (k('KeyL')) live('hurt');
    },

    tick() {
      mt++;
      stage.tick();
      drive();
      dust.tick();
      if (cycle && mt >= MODES[modeIdx].dur) setMode(modeIdx + 1);
    },

    render(alpha) {
      anim.render(alpha);
      stage.render(alpha);
      dust.render(alpha);
      display.setCameraTarget(0, PLINTH_Y + 0.55, 0);
    },

    ui(g) {
      const W = display.width, H = display.height;
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, 34, 'gold', { align: 'center', outline: 'ink' });
      if (!hud) return;
      const m = MODES[modeIdx];
      const info = anim.info();
      drawText(g, 'HERO', 8, 8, 'bone', { outline: 'ink' });
      drawText(g, cycle ? 'CYCLING  (9)' : `MODE ${modeIdx + 1}`, 8, 18, 'mist', { shadow: 'ink' });

      // the big name: which animation is playing right now
      let name = m.label;
      if (info.state === 'attack') name = `${['1', '2', '3'][info.step]}  ${ATTACKS[info.step].name.toUpperCase()}`;
      else if (m.id === 'attack') name = 'ATTACK COMBO';
      drawText(g, name, W / 2, 8, 'bone', { align: 'center', scale: 2, outline: 'ink' });
      drawText(g, m.note, W / 2, 26, 'fog', { align: 'center', shadow: 'ink' });

      // attack timeline: windup / active / recover, with the playhead
      if (info.state === 'attack') {
        const a = ATTACKS[info.step];
        const bw = 6, x0 = Math.round(W / 2 - (a.total * bw) / 2), y0 = H - 40;
        const segs = [[a.windup, 'gold', 'WINDUP'], [a.active, 'rose', 'SMEAR'], [a.recover, 'slate', 'RECOVER']];
        let x = x0;
        for (const [n, col] of segs) {
          g.fillStyle = css('ink'); g.fillRect(x - 1, y0 - 1, n * bw + 1, 6);
          g.fillStyle = css(col); g.fillRect(x, y0, n * bw - 1, 4);
          x += n * bw;
        }
        // labels as one line under the bar, each in its segment's colour
        const labs = segs.map(([n, col, lab]) => [`${lab} ${n}`, col]);
        const gap = 10;
        let lx = Math.round(W / 2 - (labs.reduce((w, [t]) => w + textWidth(t), 0) + gap * (labs.length - 1)) / 2);
        for (const [t, col] of labs) { drawText(g, t, lx, y0 + 8, col, { shadow: 'ink' }); lx += textWidth(t) + gap; }
        const ph = x0 + Math.min(info.t, a.total) * bw;
        g.fillStyle = css('white'); g.fillRect(ph, y0 - 3, 1, 10);
      }

      // key list
      const items = MODES.map((mm, i) => `${i + 1} ${mm.id.toUpperCase()}`).concat('9 ALL');
      let y = 40;
      items.forEach((s, i) => {
        const on = cycle ? i === 8 || i === modeIdx : i === modeIdx;
        drawText(g, s, 8, y, on ? 'gold' : 'slate', { shadow: 'ink' });
        y += 9;
      });
      drawText(g, `T ${String(info.t).padStart(3, ' ')}`, W - 8, 8, 'mist', { align: 'right', shadow: 'ink' });
      drawText(g, `X${loop.timeScale}`, W - 8, 18, loop.timeScale < 1 ? 'gold' : 'mist', { align: 'right', shadow: 'ink' });
      const help = 'J ATTACK  K DASH  L HURT  ARROWS TURN  Z ZOOM  T SLOW  H HIDE';
      const w = textWidth(help) + 8;
      g.fillStyle = css('ink');
      g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
      drawText(g, help, W / 2, H - 10, 'slate', { align: 'center' });
    },

    state() {
      return { showcase: { id: 'hero', mode: MODES[modeIdx].id, cycle, modeTick: mt, zoom: display.zoom,
        viewYaw: +viewYaw.toFixed(3), ...anim.info() } };
    },
  };

  function footPos(e) {
    // the foot that just landed: half a stride ahead, a voxel to its side
    const s = e.foot === 'L' ? -1 : 1;
    const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
    return { x: e.x + fx * 0.18 + fz * s * 0.12, z: e.z + fz * 0.18 - fx * s * 0.12 };
  }
}

// ---------------------------------------------------------------------------------------
// Footstep and landing dust for the showcase only: stepped-size voxel puffs. The `vfx`
// piece owns the game's particles and should listen to the same hero:* events.
function makeDust(root, r) {
  const N = 96;
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(VOXEL, VOXEL, VOXEL), new THREE.MeshBasicMaterial(), N);
  inst.frustumCulled = false;
  look.noOutline(inst);
  root.add(inst);
  const cols = [hex('frost'), hex('fog'), hex('mist'), hex('slate')];
  const P = Array.from({ length: N }, () => ({ x: 0, y: 0, z: 0, px: 0, py: 0, pz: 0, vx: 0, vy: 0, vz: 0, life: 1, max: 0 }));
  let next = 0;
  const spawn = (x, z, vx, vy, vz, max) => {
    const p = P[next]; next = (next + 1) % N;
    Object.assign(p, { x, y: PLINTH_Y + 0.04, z, vx, vy, vz, life: 0, max });
    p.px = p.x; p.py = p.y; p.pz = p.z;
  };
  const m = new THREE.Matrix4();
  const col = new THREE.Color();
  return {
    puff(at, n, power, yaw) {
      const bx = -Math.sin(yaw), bz = -Math.cos(yaw); // kicked backward
      for (let i = 0; i < n; i++) {
        spawn(at.x + r.range(-0.06, 0.06), at.z + r.range(-0.06, 0.06),
          bx * r.range(0.3, 0.9) * power + r.range(-0.4, 0.4) * power, r.range(0.25, 0.7) * power,
          bz * r.range(0.3, 0.9) * power + r.range(-0.4, 0.4) * power, r.range(0.25, 0.45));
      }
    },
    ring(at, n, power) {
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + r.range(-0.2, 0.2);
        const s = r.range(1.2, 1.8) * power;
        spawn(at.x + Math.sin(a) * 0.12, at.z + Math.cos(a) * 0.12, Math.sin(a) * s, r.range(0.2, 0.6) * power, Math.cos(a) * s, r.range(0.3, 0.5));
      }
    },
    tick() {
      for (const p of P) {
        p.px = p.x; p.py = p.y; p.pz = p.z;
        if (p.life >= p.max) continue;
        p.life += DT;
        p.x += p.vx * DT; p.y += p.vy * DT; p.z += p.vz * DT;
        p.vx *= 0.86; p.vz *= 0.86; p.vy = p.vy * 0.9 + 0.01;
      }
    },
    render(alpha) {
      P.forEach((p, i) => {
        const k = p.life / p.max;
        const s = p.life >= p.max ? 0 : k < 0.3 ? 1 : k < 0.65 ? 0.75 : 0.5; // stepped shrink
        m.makeScale(s, s, s);
        m.setPosition(p.px + (p.x - p.px) * alpha, p.py + (p.y - p.py) * alpha, p.pz + (p.z - p.pz) * alpha);
        inst.setMatrixAt(i, m);
        inst.setColorAt(i, col.setHex(cols[Math.min(3, Math.floor(k * 4))]));
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    },
  };
}
