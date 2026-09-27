// ?showcase=hud : a fight that exercises every HUD element. A bot fights waves of real enemies
// (and two straw dummies) in a crypt yard while a script walks the HUD through everything it
// does: taking damage (heart bursts and the pale drain), heals, shards ticking up and spending,
// boons arriving (with tooltips), the route advancing, low health (heartbeat and vignette), and
// a boss bar taking hits. Any key takes over; the number keys then drive the HUD by hand.
//
// Params: &auto=0        no script (the bot still fights; use the keys)
//         &bot=0         the hero stands still (you drive)
//         &hp=<n> &max=<n>   starting hearts      &shards=<n>     &held=id,id    boons to start with
//         &route=<0..9>  starting node            &boss=1         boss bar up from the start
//         &low=1         start at 1 heart         &enemies=0      no enemies, only the dummies
//         &zoom=1..3 (default 1 = game scale)     &slow=<s>       &help=0   hide the key legend
// Keys:   WASD move  J attack  K dash  Tab cycle boon tooltips (or hover with the mouse)
//         1 hurt  2 heal  3 +7 shards  4 spend 5  5 add a boon  6 next room  7 boss bar / hit boss
//         8 drop to 1 heart  9 +1 max heart  0 reset  B bot  R restart  H hide HUD  Z zoom  T slow-mo

import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { rng, Rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { buildStage } from '../core/stage.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { CollisionWorld, setCollision } from '../core/collision.js';
import { createHeroRig } from '../hero/model.js';
import { HeroAnim } from '../hero/anim.js';
import { HeroController } from '../hero/controller.js';
import { CameraRig } from '../render/camera.js';
import { HeroCombat, HeroHealth } from '../combat/combat.js';
import { createCombatFx } from '../combat/fx.js';
import '../combat/sfx.js';
import { TrainingDummy } from '../combat/dummy.js';
import { createEnemySystem } from '../enemies/index.js';
import { vfx } from '../vfx/index.js';
import { createProgression } from '../progression/index.js';
import { BOONS } from '../progression/boons.js';
import { createHud } from './hud.js';

const ROOM = 4.9;
const SLOWS = [1, 0.5, 0.25];
const TORCHES = [[-3.5, -3], [3.5, -3], [-3.5, 3], [3.5, 3]];
const WAVES = [
  ['husk', 'mite', 'mite', 'mite'],
  ['husk', 'wisp', 'mite'],
  ['husk', 'husk'],
  ['brute', 'mite'],
];
const BOON_ORDER = ['chain-spark', 'searing-brand', 'aegis', 'gale-boots', 'headsman', 'life-motes', 'ember-trail', 'orbit-blades'];
const list = (s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

// The script: [tick, action]. It loops. Times are sim ticks (60 per second).
const SCRIPT = [
  [90, 'hurt'], [250, 'shards'], [380, 'boon'], [560, 'hurt'], [700, 'route'], [820, 'shards'],
  [960, 'boon'], [1080, 'low'], [1400, 'heal'], [1470, 'heal'], [1560, 'boss'], [1620, 'bosshit'], [1700, 'bosshit'],
  [1780, 'bosshit'], [1860, 'bosshit'], [1940, 'bosshit'], [2020, 'bosshit'], [2100, 'bosshit'], [2200, 'bossoff'],
  [2260, 'spend'], [2340, 'fullheal'], [2400, 'route'],
];
const LOOP = 2500;

export default function hudShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  let auto = P('auto', '1') !== '0';
  let botOn = P('bot', '1') !== '0';
  let zoom = Math.max(1, Math.min(3, parseInt(P('zoom', '1'), 10) || 1));
  let help = P('help', '1') !== '0';
  const slowP = parseFloat(P('slow', '1'));
  let slowIdx = 0;
  const startHp = parseInt(P('hp', '5'), 10) || 5;
  const startMax = Math.max(startHp, parseInt(P('max', '5'), 10) || 5);
  const foes = P('enemies', '1') !== '0';

  let root, stage, rig, anim, ctl, cam, health, combat, cfx, cw, esys, prog, hud;
  let dummies = [];
  let offs = [];
  let botT = 0, waveN = 0, emptyT = 0, deadT = -1, scriptT = 0, boonN = 0, bossHp = 1;
  const status = { text: '', until: 0 };
  const say = (t) => { status.text = t; status.until = loop.realTime + 1.6; };

  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, nextPress: 0, comboIdx: 0, lastDash: -999, dodged: new Set(),
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };

  function botStep() {
    botT++;
    pilot.mv = { x: 0, z: 0 };
    if (health.dead) return;
    const real = world.enemies.filter((e) => !e.dead && e.managed && e.solid);
    const pool = real.length ? real : dummies.filter((d) => !d.dead);
    let t = null, bd = 1e9;
    for (const e of pool) { const d = Math.hypot(e.x - ctl.x, e.z - ctl.z); if (d < bd) { bd = d; t = e; } }
    if (!t) { const d = Math.hypot(ctl.x, ctl.z - 0.6); if (d > 0.4) pilot.mv = { x: -ctl.x / d * 0.6, z: (0.6 - ctl.z) / d * 0.6 }; return; }
    let dx = t.x - ctl.x, dz = t.z - ctl.z;
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    for (const e of real) {
      if (e.state === 'windup' && !pilot.dodged.has(e) && Math.hypot(e.x - ctl.x, e.z - ctl.z) < 1.7 && e.st > 14) {
        pilot.dodged.add(e);
        if ((botT + e.id.length * 7) % 3 !== 0 && ctl.dashReady) { pilot.mv = { x: -dz, z: dx }; pilot.want.dash = true; pilot.lastDash = botT; return; }
      }
    }
    if (d > 1.15) {
      pilot.mv = { x: dx, z: dz };
      if (ctl.dashReady && botT - pilot.lastDash > 150 && d > 3.2 && d < 4.2 && ctl.state === 'move') { pilot.want.dash = true; pilot.lastDash = botT; }
    } else {
      pilot.mv = { x: dx * 0.3, z: dz * 0.3 };
      if (botT >= pilot.nextPress) {
        pilot.want.attack = true;
        pilot.nextPress = botT + (pilot.comboIdx === 2 ? 36 : 13);
        pilot.comboIdx = (pilot.comboIdx + 1) % 3;
      }
    }
  }
  function setBot(on) { botOn = on; ctl.source = on ? pilot : input; pilot.mv = { x: 0, z: 0 }; pilot.want = {}; }
  function takeOver() { if (!auto && !botOn) return; auto = false; setBot(false); say('LIVE: NUMBER KEYS DRIVE THE HUD'); }

  // ---- HUD exercises (also the keys and the debug hook) -----------------------------------------
  const act = {
    hurt(n = 1) { const r = health.hurt(n, { x: ctl.x + 0.6, z: ctl.z - 0.5 }, { force: true }); say('HURT'); return r; },
    heal(n = 1) { health.heal?.(n); if (!health.heal) health.hp = Math.min(health.maxHp, health.hp + n); say('HEAL'); },
    fullheal() { health.hp = health.maxHp; say('HEALED'); },
    low() { const n = health.hp - 1; if (n > 0) act.hurt(n); say('LOW HEALTH'); },
    shards(n = 7) { prog.pickups.add(n); say(`+${n} SHARDS`); },
    spend() { if (!prog.pickups.spend(5)) prog.pickups.add(6); say('SPEND 5'); },
    boon() {
      const id = BOON_ORDER.find((b) => prog.boons.level(b) < BOONS[b].max && prog.boons.level(b) === 0) ?? BOON_ORDER[boonN % BOON_ORDER.length];
      boonN++; prog.boons.give(id); say('BOON: ' + BOONS[id].name);
    },
    route() {
      const t = hud.track;
      if (t.index >= t.route.length - 1) { t.doneUpTo = -1; t.index = 0; t.arriveT = 0; }
      else { t.clear(t.index); t.goto(t.index + 1); }
      const k = t.route[t.index];
      const nth = t.route.slice(0, t.index + 1).filter((x) => x === k).length;
      t.label = k === 'arena' ? `ARENA ${nth}/5` : k === 'corridor' ? 'THE GAUNTLET' : 'THE WARDEN';
      t.alarm = k === 'corridor';
      t.setProgress(0);
      say('ROUTE: ' + k.toUpperCase());
    },
    boss() { bossHp = 1; hud.boss.show('THE WARDEN', { phases: 3 }); say('BOSS BAR'); },
    bosshit(n = 0.11) { if (!hud.boss.on) act.boss(); else { bossHp = Math.max(0, bossHp - n); hud.boss.set(bossHp); } },
    bossoff() { hud.boss.hide(); },
    maxup() { health.maxHp++; health.hp++; say('MAX HEARTS +1'); },
    reset() { restart(); say('RESET'); },
  };

  function camBounds() {
    const hw = display.width / (2 * PPU * zoom), hd = display.height / (2 * PPU * zoom * Math.sin(CAMERA_PITCH));
    const bx = Math.max(0, ROOM - hw + 0.4), bz = Math.max(0, ROOM - hd + 0.6);
    return { minX: -bx, maxX: bx, minZ: -bz - 0.2, maxZ: bz };
  }
  function setZoom(z) { zoom = z; display.setZoom(zoom); if (cam) cam.bounds = camBounds(); }

  function spawnWave() {
    const types = WAVES[waveN % WAVES.length];
    waveN++;
    types.forEach((type, i) => {
      const a = (i / types.length) * Math.PI * 2 + waveN * 0.9;
      const r = 3.1 + (i % 2) * 0.5;
      esys.spawn(type, Math.sin(a) * r, Math.cos(a) * r * 0.85 - 0.3, { delay: i * 4 });
    });
  }

  function newHero() { ctl.teleport(0, 1.6, Math.PI); health.revive(); health.hp = health.maxHp; cam.reset(0, 0); }

  function restart() {
    prog.boons.reset(); prog.pickups.clear(); prog.pickups.total = 0;
    prog.pickups.add(parseInt(P('shards', '23'), 10) || 0);
    hud.boss.hide(); bossHp = 1; scriptT = 0; boonN = 0;
    health.maxHp = startMax; health.hp = startHp;
    hud.track.set(null, 0); hud.track.doneUpTo = -1; hud.track.label = 'ARENA 1/5'; hud.track.alarm = false;
    for (const id of list(P('held', ''))) if (BOONS[id]) prog.boons.give(id);
    newHero(); health.hp = startHp;
  }

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      setZoom(zoom);
      loop.setTimeScale(Number.isFinite(slowP) && slowP > 0 ? slowP : 1);
      stage = buildStage(root, { torches: TORCHES, rng: rng.fork('hud-stage') });
      rig = createHeroRig(); root.add(rig.group);
      anim = new HeroAnim(rig, { x: 0, z: 1.6, yaw: Math.PI }); anim.spawn();
      cw = new CollisionWorld(); cw.addRing(0, 0, ROOM);
      for (const [x, z] of TORCHES) cw.addCircle(x, z, 0.22, 'torch');
      setCollision(cw);
      ctl = new HeroController({ x: 0, z: 1.6, yaw: Math.PI, anim, collision: cw, source: input });
      cam = new CameraRig({}); cam.bounds = camBounds(); cam.reset(0, 0);
      health = new HeroHealth({ ctl, anim, rig, hp: startHp, maxHp: startMax });
      combat = new HeroCombat({ ctl, anim, health, targets: () => world.enemies });
      world.hero = health;
      world.room = { index: 0, kind: 'arena', id: 'hud' };
      cfx = createCombatFx(root, { numbers: false });          // the HUD owns the damage numbers
      vfx.attach(root, { ambient: 'crypt' });
      const bounds = { minX: -ROOM + 0.4, maxX: ROOM - 0.4, minZ: -ROOM + 0.4, maxZ: ROOM - 0.4 };
      esys = createEnemySystem(root, { hero: health, collision: cw, bounds, list: world.enemies });
      prog = createProgression(root, { ctl, health, rig, rng: rng.fork('hud-boons'), bounds });
      hud = createHud({ ctl, prog });
      dummies = [[-1.7, -0.4], [-0.5, -1.0]].map(([x, z], i) => new TrainingDummy(root, { id: `D${i}`, x, z, bounds }));
      for (const d of dummies) { d.attachCollider(cw); world.enemies.push(d); }
      const on = (n, f) => offs.push(events.on(n, f));
      on('input:press', (e) => { if ((auto || botOn) && !['pause', 'confirm'].includes(e.action)) takeOver(); });
      on('combat:heroDeath', () => { deadT = 0; });
      debug.handle('spawn', (type, x, z) => esys.handleSpawn(type, x, z) ?? { ok: false, error: `no enemy type "${type}"` });
      debug.add('hud', (action, arg) => {
        if (!action || action === 'state') return { ok: true, ...hud.info() };
        if (action === 'zoom') { setZoom(+arg || 1); return { ok: true }; }
        if (action === 'route') { hud.track.goto(+arg); return { ok: true, ...hud.info().track }; }
        if (action === 'bossat') { if (!hud.boss.on) act.boss(); bossHp = +arg; hud.boss.set(bossHp); return { ok: true }; }
        if (action === 'hp') { health.hp = Math.max(0, Math.min(health.maxHp, +arg)); return { ok: true, hp: health.hp }; }
        if (typeof act[action] === 'function') { act[action](arg); return { ok: true, ...hud.info() }; }
        return { ok: false, error: `unknown action "${action}"; try ${Object.keys(act).join(' ')} bossat hp route zoom` };
      });
      restart();
      health.hp = P('low', '0') === '1' ? 1 : startHp;
      if (P('boss', '0') === '1') act.boss();
      const rt = parseInt(P('route', '0'), 10) || 0;
      if (rt) { for (let i = 0; i < rt; i++) hud.track.clear(i); hud.track.goto(rt); }
      setBot(botOn);
      if (foes) spawnWave();
    },

    exit() {
      offs.forEach((f) => f()); offs = [];
      hud?.dispose(); prog?.dispose(); cfx?.dispose(); esys?.dispose();
      for (const d of dummies) d.dispose?.();
      vfx.detach(); loop.setTimeScale(1); setCollision(null);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },

    frame(dt) {
      const k = input.ui.key;
      prog.frame(dt);
      const N = { Digit1: () => act.hurt(1), Digit2: () => act.heal(1), Digit3: () => act.shards(7), Digit4: () => act.spend(), Digit5: () => act.boon(),
        Digit6: () => act.route(), Digit7: () => act.bosshit(0.11), Digit8: () => act.low(), Digit9: () => act.maxup(), Digit0: () => act.reset() };
      for (const c in N) if (k(c)) N[c]();
      if (k('KeyH')) hud.visible = !hud.visible;
      if (k('KeyB')) { auto = false; setBot(!botOn); say(botOn ? 'BOT ON' : 'BOT OFF'); }
      if (k('KeyR')) { restart(); say('RESTART'); }
      if (k('KeyZ')) { setZoom(zoom >= 3 ? 1 : zoom + 1); say(`ZOOM ${zoom}X`); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
    },

    tick() {
      if (auto) {
        scriptT++;
        for (const [at, a] of SCRIPT) if (at === scriptT) act[a]?.();
        if (scriptT >= LOOP) scriptT = 0;
      }
      stage.tick();
      if (botOn) botStep();
      combat.tick();
      cam.tick(ctl);
      for (const e of world.enemies) if (!e.managed) e.tick?.();
      esys.tick();
      cfx.tick(); vfx.tick(); prog.tick();
      hud.tick();
      for (const d of dummies) if (d.dead) d.hp = d.maxHp;
      if (foes && esys.alive().length === 0) {
        if (++emptyT === 1) { events.emit('arena:wavesDone', { index: 0 }); }
        if (emptyT > 120) { emptyT = 0; spawnWave(); }
      } else emptyT = 0;
      if (health.dead && deadT >= 0 && ++deadT > 90) { deadT = -1; newHero(); say('BACK ON YOUR FEET'); }
    },

    render(alpha) {
      anim.render(alpha); health.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y, off.z);
      for (const e of world.enemies) if (!e.managed) e.render?.(alpha);
      esys.render(alpha); stage.render(alpha); cfx.render(alpha); vfx.render(alpha); prog.render(alpha);
    },

    ui(g) {
      const W = display.width, H = display.height;
      cfx.ui(g); esys.ui(g); vfx.ui(g);
      hud.ui(g);
      prog.ui(g);
      if (!hud.visible) return;
      if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, 62, 'gold', { align: 'center', outline: 'ink' });
      if (help) {
        const t = auto ? 'DEMO: ANY KEY TAKES OVER' : 'WASD J K  TAB TIPS  1 HURT 2 HEAL 3 SHARDS 4 SPEND 5 BOON 6 ROOM 7 BOSS 8 LOW 9 MAX 0 RESET  H HUD';
        const w = textWidth(t) + 8;
        drawText(g, t, W / 2, H - 11, 'slate', { align: 'center', shadow: 'ink' });
        void w;
      }
    },

    state() {
      return { showcase: { id: 'hud', auto, bot: botOn, zoom: display.zoom, script: scriptT, hud: hud.info() } };
    },
  };
}
void css; void Rng;
