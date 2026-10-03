// ?showcase=hud : the in-run HUD in a dummy fight, at game scale (zoom 1, 640x360), in a real
// arena (the Antechamber, lit, no waves). Every HUD element is live and fed by the real game
// systems: hearts from HeroHealth, the dash pip from the controller, shards from real pickups,
// boons from giveBoon (with their real effects), damage numbers from combat events.
//
// In the room: three husks (puppets: they only attack when the demo tells them to) and an iron
// training dummy standing in for a boss. Hits on the dummy drain a showcase-only boss pool
// ("IRON DUMMY", three phases, poise and stagger) so the boss bar can be shown outside the
// Warden's pit. The real Warden bar is in ?scene=boss.
//
// DEMO (default): the pilot fights with keyboard-style presses; a 30 s script walks through
// every element: boons arrive (tooltips, a synergy), husks land hits (labelled), the hero drops
// to one heart (heartbeat, vignette), hearts are picked up, the room track advances, the boss
// pool is broken through its phases. Any movement key takes over (LIVE).
//
// Params:  &auto=0  (start LIVE)   &hud=0 (no showcase labels; the game HUD stays)
//          &hp=1..5  (start hp)    &boons=a,b,c (start with these)   &shards=<n>
//          &node=0..9 (room track position)   &boss=0 (no boss bar)   &slow=<s>   &zoom=1..3
//          &at=<tick> (jump the demo script to a tick)
// Keys:    1 take a hit   2 heal   3 shards   4 add a boon   5 one heart left   6 next room
//          7 boss bar on/off   8 hit the boss pool   Tab inspect boons   B demo/live
//          R reset   T slow-mo   Z zoom   H labels   P/Esc pause   (WASD J K play, LIVE)

import { display } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { drawText } from '../core/pixelfont.js';
import { setCollision } from '../core/collision.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import '../combat/sfx.js';
import { TrainingDummy } from '../combat/dummy.js';
import { vfx } from '../vfx/vfx.js';
import { spawnHandler } from '../enemies/index.js';
import { Arena, generateArena, cameraBounds, setActiveArena } from '../world/arena.js';
import { progress, giveBoon, resetProgress } from '../progression/boons.js';
import { createProgression } from '../progression/index.js';
import { createHud } from './hud.js';
import { NODES } from './widgets/track.js';

const SLOWS = [1, 0.5, 0.25, 0.1];
const HOMES = [[-2.3, -0.4], [2.4, -0.2], [-0.9, 1.9]];
const DUMMY = { x: 0.2, z: -2.1 };
const DEMO_BOONS = ['kindling', 'chain-spark', 'storm-dash', 'leech', 'keen-edge'];
const LIVE_BOONS = ['kindling', 'chain-spark', 'storm-dash', 'leech', 'keen-edge', 'bulwark', 'reaper', 'ember-orbit', 'echo-blade', 'moon-wave', 'heavy-hand', 'fleet-foot', 'soul-hunger', 'ember-trail', 'starfall', 'phoenix'];
const LOOP = 1860;
const POOL = { max: 420, poise: 70, stagger: 150, lock: 180 };

const roomOf = (n) => (NODES[n] === 'boss' ? { index: 5, kind: 'boss' } : NODES[n] === 'arena' ? { index: n / 2, kind: 'arena' } : { index: (n - 1) / 2, kind: 'corridor' });

export default function hudShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  let auto = P('auto', '1') !== '0';
  let labels = P('hud', '1') !== '0';
  let zoom = Math.max(1, Math.min(3, parseInt(P('zoom', '1'), 10) || 1));
  const slowP = parseFloat(P('slow', '1'));
  let slowIdx = Math.max(0, SLOWS.indexOf(slowP));
  const startHp = Math.max(1, Math.min(5, parseInt(P('hp', '5'), 10) || 5));
  const startBoons = (P('boons', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
  const startShards = parseInt(P('shards', '0'), 10) || 0;
  let node = Math.max(0, Math.min(9, parseInt(P('node', '2'), 10) || 0));
  let bossOn = P('boss', '1') !== '0';
  const atP = parseInt(P('at', '0'), 10) || 0;

  let root, arena, rig, anim, ctl, cam, health, combat, cfx, prog, hud, dummy;
  let offs = [];
  let tick = 0, script = 0, liveBoon = 0, vacuumAt = -1;
  const homes = [];
  const respawn = [];
  const pool = { hp: POOL.max, poise: 0, stagger: 0, lock: 0, since: 999, show: 0, broken: -1 };
  const status = { text: '', until: 0 };
  const say = (t, s = 1.4) => { status.text = t; status.until = loop.realTime + s; };

  // ---- the keyboard-style pilot ---------------------------------------------------------------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, label: '', t: 0, cycle: 0, target: null, mode: 'fight', dashDir: null,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };
  const steer = (x, z, stop = 0.08) => {
    const dx = x - ctl.x, dz = z - ctl.z, d = Math.hypot(dx, dz);
    if (d < stop) { pilot.mv = { x: 0, z: 0 }; return true; }
    const k = Math.min(1, d / 0.35);
    pilot.mv = { x: dx / d * k, z: dz / d * k };
    return false;
  };
  const husks = () => world.enemies.filter((e) => e.kind === 'husk' && !e.dead && !e.dying && e.state !== 'spawn');

  function pilotTick() {
    pilot.t++;
    pilot.mv = { x: 0, z: 0 };
    if (health.dead || pilot.mode === 'wait') return;
    if (pilot.mode === 'dash') {
      if (pilot.t === 1) pilot.want.dash = true;
      pilot.mv = pilot.dashDir;
      if (pilot.t > 30) { pilot.mode = 'fight'; pilot.t = 0; }
      return;
    }
    // pick a target: the boss dummy in the boss part of the script, else the nearest husk
    const wantBoss = bossOn && pool.show > 0 && pool.broken < 0 && script % LOOP > 980 && script % LOOP < 1500;
    let t = wantBoss ? dummy : null;
    if (!t) {
      let best = 1e9;
      for (const e of husks()) { const d = Math.hypot(e.x - ctl.x, e.z - ctl.z); if (d < best) { best = d; t = e; } }
      if (!t && bossOn && pool.broken < 0) t = dummy;
    }
    pilot.target = t;
    if (!t) return;
    const d = Math.hypot(t.x - ctl.x, t.z - ctl.z);
    if (d > 1.15 && pilot.t > 0) { steer(t.x, t.z, 1.0); pilot.combo = 0; return; }
    pilot.mv = { x: (t.x - ctl.x) / d * 0.01, z: (t.z - ctl.z) / d * 0.01 };
    pilot.combo = (pilot.combo ?? 0) + 1;
    if (pilot.combo === 1 || pilot.combo === 14 || pilot.combo === 27) pilot.want.attack = true;
    if (pilot.combo > 66) {
      pilot.combo = 0;
      pilot.cycle++;
      if (pilot.cycle % 3 === 2) {
        const a = Math.atan2(ctl.x - t.x, ctl.z - t.z) + 1.2;
        pilot.dashDir = { x: Math.sin(a), z: Math.cos(a) };
        pilot.mode = 'dash'; pilot.t = 0;
      }
    }
  }

  // ---- the demo script (sim ticks, loops) -----------------------------------------------------------
  function hitFrom(e, label) {
    // a husk next to the hero swings at it; if the swing misses, the hit lands anyway after a beat
    say(label, 1.6);
    pilot.label = label;
    const h = e ?? husks()[0];
    if (h && h.state === 'move' && Math.hypot(h.x - ctl.x, h.z - ctl.z) < 2.2) { h.act(); pilot.pending = { t: 70, src: h, hp: health.hp }; }
    else health.hurt(1, h ? { x: h.x, z: h.z } : null, { force: true });
  }
  function scriptTick() {
    const s = script % LOOP;
    if (s === 0) { resetRun(startHp); pilot.label = 'FIGHT'; }
    if (s === 90) { giveBoon(DEMO_BOONS[0]); pilot.label = 'BOON GAINED (TOOLTIP)'; }
    if (s === 260) hitFrom(nearHusk(), 'HUSK LANDS A HIT');
    if (s === 420) { giveBoon(DEMO_BOONS[1]); pilot.label = 'BOON GAINED'; }
    if (s === 560) hitFrom(nearHusk(), 'HUSK LANDS A HIT');
    if (s === 640) { giveBoon(DEMO_BOONS[2]); pilot.label = 'SYNERGY'; }
    if (s === 760) { health.hurt(2, nearHusk() ?? null, { force: true }); pilot.label = 'TAKES 2 (SCRIPTED)'; say('TAKES 2', 1.4); }
    if (s === 980) { setNode(node + 1); pilot.label = 'NEXT ROOM (TRACK)'; }
    if (s === 1060) { pilot.label = 'BOSS POOL (STAND-IN)'; }
    if (s === 1200 && health.hp > 1) { health.hurt(health.hp - 1, nearHusk() ?? null, { force: true }); pilot.label = 'ONE HEART LEFT'; }
    if (s === 1460) { prog.pickups.drop('heart', ctl.x + 0.9, ctl.z + 0.3, 2, { y: 0.6 }); pilot.label = 'HEART PICKUPS'; }
    if (s === 1520) { giveBoon(DEMO_BOONS[3]); }
    if (s === 1640) { prog.pickups.drop('shard', ctl.x - 0.6, ctl.z + 0.5, 14, { y: 0.6, speed: 1.2 }); pilot.label = 'SHARDS'; }
    if (s === 1700) prog.pickups.vacuum();
    if (s === 1760) { hud.boons.inspect(0); pilot.label = 'TAB: INSPECT'; }
    if (s === 1810) hud.boons.inspect();
    // a husk swing that missed: land it anyway (the hit is the point of the beat)
    if (pilot.pending && --pilot.pending.t <= 0) {
      if (health.hp >= pilot.pending.hp && !health.invuln) health.hurt(1, { x: pilot.pending.src.x, z: pilot.pending.src.z }, { force: true });
      pilot.pending = null;
    } else if (pilot.pending && health.hp < pilot.pending.hp) pilot.pending = null;
  }
  const nearHusk = () => { let b = null, bd = 1e9; for (const e of husks()) { const d = Math.hypot(e.x - ctl.x, e.z - ctl.z); if (d < bd) { bd = d; b = e; } } return b; };

  function resetRun(hp = 5) {
    resetProgress();
    prog?.runtime.apply();
    progress.shards = startShards;
    health.hp = hp; health.maxHp = 5; health.iframeT = 0;
    if (health.dead) health.revive(), (health.hp = hp);
    for (const id of startBoons) giveBoon(id, { quiet: true });
    pool.hp = POOL.max; pool.poise = 0; pool.stagger = 0; pool.lock = 0; pool.broken = -1;
    liveBoon = 0;
  }

  function setNode(n) {
    node = ((n % NODES.length) + NODES.length) % NODES.length;
    world.room = { ...roomOf(node), showcase: 'hud' };
  }

  // ---- the boss pool on the iron dummy ---------------------------------------------------------------
  function poolHit(dmg) {
    if (!bossOn || pool.broken >= 0) return;
    const mult = pool.stagger > 0 ? 1.5 : 1;
    pool.hp = Math.max(0, pool.hp - Math.round(dmg * mult));
    pool.since = 0;
    if (pool.stagger <= 0 && pool.lock <= 0) { pool.poise += dmg; if (pool.poise >= POOL.poise) { pool.poise = 0; pool.stagger = POOL.stagger; say('STAGGERED', 1); } }
    if (pool.hp <= 0) { pool.broken = 0; say('BROKEN', 1.2); }
  }
  function poolTick() {
    pool.since++;
    if (pool.stagger > 0 && --pool.stagger === 0) pool.lock = POOL.lock;
    else if (pool.lock > 0) pool.lock--;
    if (pool.since > 60 && pool.poise > 0) pool.poise = Math.max(0, pool.poise - 0.3);
    const want = bossOn && (pool.broken < 0 || pool.broken < 90) ? 1 : 0;
    pool.show += ((want ? 1 : 0) - pool.show) * (want ? 0.08 : 0.12);
    if (pool.show < 0.01) pool.show = 0;
    if (pool.broken >= 0 && ++pool.broken > 150) { pool.broken = -1; pool.hp = POOL.max; pool.poise = 0; pool.lock = 0; pool.stagger = 0; }
  }
  const poolPhase = () => (pool.hp > POOL.max * 2 / 3 ? 1 : pool.hp > POOL.max / 3 ? 2 : 3);
  const bossSource = () => (bossOn || pool.show > 0 ? {
    name: 'IRON DUMMY', hp: pool.hp, maxHp: POOL.max, phase: poolPhase(), phaseName: ['', 'STANDING', 'DENTED', 'BUCKLING'][poolPhase()],
    phaseColor: ['', 'sky', 'gold', 'red'][poolPhase()], notches: [2 / 3, 1 / 3],
    poise: pool.poise / POOL.poise, stagger: pool.stagger > 0 ? pool.stagger / POOL.stagger : null,
    locked: pool.lock > 0 ? pool.lock / POOL.lock : null, show: pool.show,
  } : null);

  // ---- husks: puppets that come back through portals ------------------------------------------------
  function spawnHusk(i, instant = false) {
    const [x, z] = HOMES[i];
    const e = arena.foes.spawn('husk', x, z, { instant, yaw: Math.atan2(-x, 1 - z) });
    e.ai = false;
    homes[i] = e;
  }

  return {
    pausable: true,
    enter(_d, r) {
      root = r;
      world.reset();
      resetProgress();
      tick = 0; script = atP;
      display.setZoom(zoom);
      loop.setTimeScale(SLOWS[slowIdx] ?? 1);
      if (Number.isFinite(slowP) && slowP > 0 && !SLOWS.includes(slowP)) loop.setTimeScale(slowP);
      const L = generateArena(0, rng.seed, { template: 'antechamber' });
      arena = setActiveArena(new Arena(root, L, { hero: () => ctl, waves: false, awake: true, banners: false, autoSeal: false }));
      setCollision(arena.collision);
      const start = { x: -0.4, z: 0.9, yaw: Math.PI };
      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: start.x, z: start.z, yaw: start.yaw });
      anim.spawn();
      ctl = new HeroController({ x: start.x, z: start.z, yaw: start.yaw, anim, collision: arena.collision, source: auto ? pilot : input });
      cam = new CameraRig({ bounds: cameraBounds(L, zoom) });
      cam.reset(start.x, start.z - 0.3);
      health = new HeroHealth({ ctl, anim, rig, hp: 5 });
      dummy = new TrainingDummy(root, { id: 'IRON', x: DUMMY.x, z: DUMMY.z, variant: 'iron' });
      dummy.attachCollider(arena.collision);
      const take = dummy.takeHit.bind(dummy);
      dummy.takeHit = (hit) => { const ok = take(hit); if (ok !== false) poolHit(hit.dmg ?? 0); return ok; };
      combat = new HeroCombat({ ctl, anim, health, targets: () => [...world.enemies, dummy, ...arena.targets()] });
      cfx = createCombatFx(root, { numbers: false });   // the HUD draws the numbers
      vfx.bind(['move', 'kill']);
      world.hero = health;
      prog = createProgression(root, { ctl, anim, rig, health, combat, arena, hud: false });
      hud = createHud({ health, runtime: prog.runtime, boss: bossSource, waves: () => (NODES[node] === 'arena' ? { wave: 2, total: 3, done: false } : null) });
      debug.handle('spawn', spawnHandler(arena.foes));
      HOMES.forEach((_, i) => spawnHusk(i, true));
      offs.push(events.on('enemy:death', (e) => { const i = homes.indexOf(e.enemy); if (i >= 0) respawn.push({ i, at: tick + 150 }); }));
      setNode(node);
      resetRun(startHp);
      if (!auto) pilot.label = '';
    },
    exit() {
      offs.forEach((f) => f()); offs = [];
      hud.dispose(); prog.dispose(); cfx.dispose(); arena.dispose();
      dummy.group?.removeFromParent(); dummy.mark?.removeFromParent();
      setCollision(null);
      loop.setTimeScale(1);
    },
    frame() {
      prog.frame();
      if (input.ui.key('Digit1')) { const h = nearHusk(); health.hurt(1, h ? { x: h.x, z: h.z } : null, { force: true }); say('HIT'); }
      if (input.ui.key('Digit2')) { if (health.dead) health.revive(); else health.heal(1); say('HEAL'); }
      if (input.ui.key('Digit3')) { prog.pickups.drop('shard', ctl.x, ctl.z + 0.4, 12, { y: 0.6, speed: 1.2 }); vacuumAt = tick + 40; say('SHARDS'); }
      if (input.ui.key('Digit4')) {
        const order = auto ? DEMO_BOONS : LIVE_BOONS;
        let r = null;
        for (let k = 0; k < order.length && !(r && r.ok); k++) { r = giveBoon(order[liveBoon % order.length]); liveBoon++; }
        say(r?.ok ? `BOON: ${r.id.toUpperCase()}` : 'ALL BOONS HELD');
      }
      if (input.ui.key('Digit5')) { if (health.hp > 1) health.hurt(health.hp - 1, null, { force: true }); say('ONE HEART'); }
      if (input.ui.key('Digit6')) { setNode(node + 1); say('NEXT ROOM'); }
      if (input.ui.key('Digit7')) { bossOn = !bossOn; say(bossOn ? 'BOSS BAR' : 'NO BOSS BAR'); }
      if (input.ui.key('Digit8')) { poolHit(40); events.emit('combat:damage', { x: dummy.x, y: 1.9, z: dummy.z, amount: 40, crit: true, side: 'enemy' }); }
      if (input.ui.key('KeyB')) { auto = !auto; ctl.source = auto ? pilot : input; say(auto ? 'DEMO' : 'LIVE'); }
      if (auto && ['up', 'down', 'left', 'right'].some((a) => input.ui.pressed(a))) { auto = false; ctl.source = input; say('LIVE'); }
      if (input.ui.key('KeyR')) { resetRun(5); script = 0; say('RESET'); }
      if (input.ui.key('KeyZ')) { zoom = zoom % 3 + 1; display.setZoom(zoom); cam.bounds = cameraBounds(arena.L, zoom); }
      if (input.ui.key('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      if (input.ui.key('KeyH')) labels = !labels;
    },
    tick() {
      tick++;
      if (auto) { scriptTick(); script++; }
      if (auto && ctl.source === pilot) pilotTick();
      combat.tick();
      cam.tick(ctl);
      dummy.tick();
      arena.tick();
      world.room = { ...roomOf(node), showcase: 'hud' };   // the arena writes its own room each tick
      cfx.tick();
      prog.tick();
      poolTick();
      if (tick === vacuumAt) prog.pickups.vacuum();
      for (let i = respawn.length - 1; i >= 0; i--) if (respawn[i].at <= tick) { spawnHusk(respawn[i].i); respawn.splice(i, 1); }
      if (health.dead && (health.deadT = (health.deadT ?? 0) + 1) > 120) { health.deadT = 0; health.revive(); }
    },
    render(alpha) {
      anim.render(alpha);
      health.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y, off.z);
      dummy.render(alpha);
      arena.render(alpha);
      cfx.render(alpha);
      prog.render(alpha);
    },
    ui(g) {
      cfx.ui(g);
      hud.ui(g);
      prog.ui(g);
      if (!labels || prog.choosing) return;
      const W = display.width, H = display.height;
      drawText(g, 'HUD SHOWCASE', 8, 44, 'bone', { shadow: 'ink' });
      drawText(g, auto ? 'DEMO' : 'LIVE', 8, 54, auto ? 'gold' : 'leaf', { shadow: 'ink' });
      if (auto && pilot.label) drawText(g, pilot.label, 36, 54, 'fog', { shadow: 'ink' });
      if (loop.realTime < status.until) drawText(g, status.text, W / 2, Math.round(H * 0.3), 'gold', { align: 'center', outline: 'ink' });
      const help = ['1 HIT  2 HEAL  3 SHARDS', '4 BOON  5 LOW  6 ROOM', '7 BOSS  8 BOSS HIT  TAB TIPS', 'B DEMO  R RESET  H LABELS'];
      help.forEach((l, i) => drawText(g, l, W - 6, H - 46 + i * 9, 'mist', { align: 'right', shadow: 'ink' }));
    },
    state() {
      return {
        showcase: {
          id: 'hud', auto, script: script % LOOP, label: pilot.label, node, zoom,
          pool: { hp: pool.hp, max: POOL.max, phase: poolPhase(), stagger: pool.stagger, lock: pool.lock, show: +pool.show.toFixed(2) },
          hud: hud?.info(),
        },
      };
    },
  };
}

