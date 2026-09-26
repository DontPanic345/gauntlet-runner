// ?showcase=boons : the boon shrine and the boons at work.
//
//   ?showcase=boons                   the choice screen with 3 random boons. It runs as an attract
//                                     loop: cards deal in and flip, the cursor browses, one is taken,
//                                     the hero shows it off on two dummies, then a new round starts.
//                                     Any key takes over (then it only does what you press).
//   ?showcase=boons&give=<id[,id]>    a dummy room with that boon (or several: synergies) on the hero.
//                                     A bot fights waves of real enemies; pickups drop and vacuum in.
//
// Params: &give=id,id   boons on the hero          &stacks=<1..3>   level for &give
//         &held=id,id   boons already held before the first shrine round (synergy ribbons show)
//         &offers=a,b,c fix the three cards        &shards=<n>      starting shards (default 12)
//         &auto=0       no attract loop            &bot=0           hero stands still, you drive
//         &enemies=husk,mite,...  one wave, respawned when cleared     &zoom=1..3   &slow=<s>   &hud=0
// Keys:   WASD move  J attack  K dash  E open the shrine  R restart  B bot on/off  Z zoom  T slow  H hud
//         In the shrine: A/D or arrows browse, Enter / J take, 1 2 3 direct, R reroll.

import { display, PPU, CAMERA_PITCH } from '../core/display.js';
import { input } from '../core/input.js';
import { loop } from '../core/loop.js';
import { world } from '../core/world.js';
import { rng, Rng } from '../core/rng.js';
import { events } from '../core/events.js';
import { debug } from '../core/debug.js';
import { buildStage } from '../core/stage.js';
import { drawText, textWidth, wrapText } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { voxelMesh } from '../render/voxel/index.js';
import '../render/voxel/testmodels.js';
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
import { look } from '../render/look.js';
import { createProgression } from './index.js';
import { BOONS, IDS, RARITY } from './boons.js';
import { drawBoonStrip } from './effects.js';
import { drawShardCounter } from './pickups.js';

const ROOM = 4.9;
const SLOWS = [1, 0.5, 0.25];
const TORCHES = [[-3.5, -3], [3.5, -3], [-3.5, 3], [3.5, 3]];
const WAVES = [
  ['husk', 'husk', 'mite', 'mite', 'mite'],
  ['husk', 'wisp', 'mite', 'mite'],
  ['husk', 'husk', 'husk'],
  ['brute', 'mite', 'mite'],
];
const list = (s) => (s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

export default function boonsShowcase(params) {
  const P = (k, d) => params.get(k) ?? d;
  const giveIds = list(P('give', '')).filter((id) => BOONS[id]);
  const mode = giveIds.length ? 'room' : 'shrine';
  const stacks = Math.max(1, parseInt(P('stacks', '1'), 10) || 1);
  const heldIds = list(P('held', '')).filter((id) => BOONS[id]);
  const fixedOffers = list(P('offers', '')).filter((id) => BOONS[id]);
  const customEnemies = list(P('enemies', ''));
  let auto = P('auto', '1') !== '0';
  let botOn = P('bot', '1') !== '0';
  let zoom = Math.max(1, Math.min(3, parseInt(P('zoom', '2'), 10) || 2));
  let hud = P('hud', '1') !== '0';
  let slowIdx = 0;
  const slowP = parseFloat(P('slow', '1'));

  let root, stage, rig, anim, ctl, cam, health, combat, cfx, cw, esys, prog, sr;
  let dummies = [];
  let offs = [];
  let deadT = -1, waveN = 0, emptyT = 0, round = 0, holdT = -1, attractT = 0, lastPick = null, botT = 0;
  const status = { text: '', until: 0 };
  const say = (t) => { status.text = t; status.until = loop.realTime + 1.4; };
  const hurtFlash = { t: 99 };
  let shrineMesh = null;
  let after = 0;

  // ---- the bot: keyboard-style presses through the real controller -----------------------
  const pilot = {
    mv: { x: 0, z: 0 }, want: {}, nextPress: 0, comboIdx: 0, lastDash: -999, dodged: new Set(), lastHeart: -999,
    move() { return this.mv; },
    consume(a) { if (this.want[a]) { this.want[a] = false; return true; } return false; },
    buffered(a) { return !!this.want[a]; },
  };

  const realFoes = () => world.enemies.filter((e) => !e.dead && e.managed && e.solid);
  function botStep() {
    botT++;
    pilot.mv = { x: 0, z: 0 };
    const real = realFoes();
    const pool = real.length ? real : dummies.filter((d) => !d.dead);
    let t = null, bd = 1e9;
    for (const e of pool) { const d = Math.hypot(e.x - ctl.x, e.z - ctl.z); if (d < bd) { bd = d; t = e; } }
    if (health.dead) return;
    // heal: a heart drops when the hero is low, so the pickup is seen working
    if (health.hp <= 2 && botT - pilot.lastHeart > 260 && mode === 'room') {
      pilot.lastHeart = botT;
      prog.pickups.drop({ x: ctl.x + 0.8, z: ctl.z + 0.9, hearts: 1 });
    }
    if (!t) { const d = Math.hypot(ctl.x, ctl.z - 0.6); if (d > 0.4) pilot.mv = { x: -ctl.x / d * 0.6, z: (0.6 - ctl.z) / d * 0.6 }; return; }
    let dx = t.x - ctl.x, dz = t.z - ctl.z;
    const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const dashy = prog.boons.has('ghost-dash') || prog.boons.has('ember-trail');
    // dodge a wind-up sometimes (the rest land, so hurt-triggered boons get seen)
    for (const e of real) {
      if (e.state === 'windup' && !pilot.dodged.has(e) && Math.hypot(e.x - ctl.x, e.z - ctl.z) < 1.7 && e.st > 14) {
        pilot.dodged.add(e);
        if ((botT + e.id.length * 7) % 3 !== 0 && ctl.dashReady) { pilot.mv = { x: -dz, z: dx }; pilot.want.dash = true; pilot.lastDash = botT; return; }
      }
    }
    if (d > 1.15) {
      pilot.mv = { x: dx, z: dz };
      if (ctl.dashReady && botT - pilot.lastDash > (dashy ? 55 : 130) && d > (dashy ? 1.7 : 3.2) && d < 4.2 && ctl.state === 'move') {
        pilot.want.dash = true; pilot.lastDash = botT;
      }
    } else {
      pilot.mv = { x: dx * 0.3, z: dz * 0.3 };
      if (botT >= pilot.nextPress) {
        pilot.want.attack = true;
        pilot.nextPress = botT + (pilot.comboIdx === 2 ? 36 : 13);
        pilot.comboIdx = (pilot.comboIdx + 1) % 3;
      }
    }
  }

  function takeOver() {
    if (!auto && !botOn) return;
    auto = false; botOn = false;
    ctl.source = input;
    pilot.mv = { x: 0, z: 0 };
    say('LIVE');
  }
  function setBot(on) {
    botOn = on;
    ctl.source = on ? pilot : input;
    pilot.mv = { x: 0, z: 0 }; pilot.want = {};
  }

  // ---- helpers -----------------------------------------------------------------------------
  function camBounds() {
    const hw = display.width / (2 * PPU * zoom), hd = display.height / (2 * PPU * zoom * Math.sin(CAMERA_PITCH));
    const bx = Math.max(0, ROOM - hw + 0.4), bz = Math.max(0, ROOM - hd + 0.6);
    return { minX: -bx, maxX: bx, minZ: -bz - 0.2, maxZ: bz };
  }
  function setZoom(z) { zoom = z; display.setZoom(zoom); if (cam) cam.bounds = camBounds(); }

  function spawnWave() {
    const types = customEnemies.length ? customEnemies : WAVES[waveN % WAVES.length];
    waveN++;
    types.forEach((type, i) => {
      const a = (i / types.length) * Math.PI * 2 + waveN * 0.9;
      const r = 3.1 + (i % 2) * 0.5;
      esys.spawn(type, Math.sin(a) * r, Math.cos(a) * r * 0.85 - 0.3, { delay: i * 4 });
    });
  }

  function newHero() {
    ctl.teleport(0, 1.6, Math.PI);
    health.revive();
    cam.reset(0, 0);
  }

  function startRound(first = false) {
    round++;
    holdT = -1;
    attractT = 0;
    const o = fixedOffers.length === 3 ? fixedOffers.map((id) => ({ id, level: (prog.boons.level(id) || 0) + 1 })) : null;
    prog.offerShrine({ offers: o, onClose: () => { holdT = 0; if (auto) setBot(true); } });
    void first;
  }

  function restart() {
    prog.boons.reset();
    prog.pickups.clear();
    prog.pickups.total = 0;
    prog.pickups.add(parseInt(P('shards', '12'), 10) || 0);
    for (const id of heldIds) prog.boons.give(id);
    round = 0;
    newHero();
    if (mode === 'shrine') { setBot(false); startRound(true); }
  }

  const doorGlow = { t: 0 };

  return {
    pausable: true,

    enter(_d, r) {
      root = r;
      world.reset();
      setZoom(zoom);
      loop.setTimeScale(Number.isFinite(slowP) && slowP > 0 ? slowP : 1);
      stage = buildStage(root, { torches: TORCHES, rng: rng.fork('boons-stage') });
      if (mode === 'shrine') {
        shrineMesh = voxelMesh('test.shrine');
        shrineMesh.position.set(0, 0, -2.4);
        root.add(shrineMesh);
      }
      rig = createHeroRig();
      root.add(rig.group);
      anim = new HeroAnim(rig, { x: 0, z: 1.6, yaw: Math.PI });
      anim.spawn();
      cw = new CollisionWorld();
      cw.addRing(0, 0, ROOM);
      for (const [x, z] of TORCHES) cw.addCircle(x, z, 0.22, 'torch');
      if (mode === 'shrine') cw.addCircle(0, -2.4, 1.2, 'shrine');
      setCollision(cw);
      ctl = new HeroController({ x: 0, z: 1.6, yaw: Math.PI, anim, collision: cw, source: input });
      cam = new CameraRig({});
      cam.bounds = camBounds();
      cam.reset(0, 0);
      health = new HeroHealth({ ctl, anim, rig, hp: 5 });
      combat = new HeroCombat({ ctl, anim, health, targets: () => world.enemies });
      world.hero = health;
      world.room = { index: 0, kind: 'showcase', id: 'boons' };
      cfx = createCombatFx(root, { numbers: true });
      vfx.attach(root, { ambient: 'crypt' });
      const bounds = { minX: -ROOM + 0.4, maxX: ROOM - 0.4, minZ: -ROOM + 0.4, maxZ: ROOM - 0.4 };
      esys = createEnemySystem(root, { hero: health, collision: cw, bounds, list: world.enemies });
      prog = createProgression(root, { ctl, health, rig, rng: rng.fork('boons-run'), bounds });

      // two straw dummies: always something to hit (chain arcs jump between them)
      const dpos = mode === 'room' ? [[-1.7, -0.4], [-0.5, -1.0]] : [[-1.5, 0.1], [-0.4, -0.5]];
      dummies = dpos.map(([x, z], i) => new TrainingDummy(root, { id: `D${i}`, x, z, bounds }));
      for (const d of dummies) { d.attachCollider(cw); world.enemies.push(d); }

      const on = (n, f) => offs.push(events.on(n, f));
      on('input:press', (e) => { if ((auto || botOn) && e.action !== 'pause' && e.action !== 'confirm') takeOver(); });
      on('combat:heroHurt', () => { hurtFlash.t = 0; });
      on('combat:heroDeath', () => { deadT = 0; });
      on('boon:acquire', (e) => { lastPick = { id: e.id, level: e.level, t: loop.realTime }; });
      debug.handle('spawn', (type, x, z) => esys.handleSpawn(type, x, z) ?? { ok: false, error: `no enemy type "${type}"` });

      prog.pickups.add(parseInt(P('shards', '12'), 10) || 0);
      prog.pickups.counter.pop = 99; prog.pickups.counter.addT = 99;
      for (const id of heldIds) prog.boons.give(id);
      if (mode === 'room') {
        for (const id of giveIds) for (let k = 0; k < stacks; k++) prog.boons.give(id);
        setBot(botOn);
        if (P('waves', '1') !== '0') spawnWave();
      } else {
        setBot(false);
      }
      sr = new Rng('boons-showcase');
      if (mode === 'shrine') after = 14;
    },

    exit() {
      offs.forEach((f) => f()); offs = [];
      prog?.dispose();
      cfx?.dispose();
      esys?.dispose();
      for (const d of dummies) d.dispose?.();
      vfx.detach();
      loop.setTimeScale(1);
      setCollision(null);
      debug.handle('spawn', () => ({ ok: false, error: 'no spawner in this scene' }));
    },

    frame(dt) {
      const k = input.ui.key;
      prog.frame(dt);
      if (k('KeyH')) hud = !hud;
      if (prog.shrine.active) return;
      if (k('KeyE')) { setBot(false); auto = false; startRound(); }
      if (k('KeyR')) { restart(); say('RESTART'); }
      if (k('KeyB')) { auto = false; setBot(!botOn); say(botOn ? 'BOT ON' : 'BOT OFF'); }
      if (k('KeyZ')) { setZoom(zoom >= 3 ? 1 : zoom + 1); say(`ZOOM ${zoom}X`); }
      if (k('KeyT')) { slowIdx = (slowIdx + 1) % SLOWS.length; loop.setTimeScale(SLOWS[slowIdx]); say(`SPEED X${SLOWS[slowIdx]}`); }
      // attract loop bookkeeping happens in tick (sim time) except the shrine browse below
    },

    tick() {
      if (mode === 'shrine' && after > 0 && --after === 0) startRound(true);
      if (prog.blocking) {
        // attract: while the shrine is up and nobody touches anything, browse and then take a card
        if (auto && prog.shrine.phase === 'choose') {
          attractT++;
          const s = prog.shrine;
          if (attractT % 52 === 1 && attractT > 1) s.hover?.((s.selected + 1) % 3);
          if (attractT > 190) {
            // prefer the rarest card on offer
            const order = { epic: 2, rare: 1, common: 0 };
            let best = 0;
            s.cards.forEach((c, i) => { if (order[c.rarity] > order[s.cards[best].rarity]) best = i; });
            s.pick(best);
          }
        }
        return;
      }
      stage.tick();
      if (botOn) botStep();
      combat.tick();
      cam.tick(ctl);
      for (const e of world.enemies) if (!e.managed) e.tick?.();
      esys.tick();
      cfx.tick();
      vfx.tick();
      prog.tick();
      hurtFlash.t++;
      // shrine attract: after a pick, show it off for a few seconds, then deal again
      if (mode === 'shrine' && holdT >= 0 && auto) {
        holdT++;
        if (holdT === 40) { botT = 0; }
        if (holdT > 330) { if (round >= 6) { prog.boons.reset(); round = 0; } startRound(); }
      }
      // waves: when the real enemies are gone for a moment, send the next
      if (mode === 'room' && P('waves', '1') !== '0' && esys.alive().length === 0) {
        if (++emptyT === 1) events.emit('arena:clear', { index: 0, x: 0, z: 0, showcase: true });
        if (emptyT > 150) { emptyT = 0; spawnWave(); }
      } else emptyT = 0;
      for (const d of dummies) if (d.dead) d.hp = d.maxHp;
      if (health.dead && deadT >= 0 && ++deadT > 70) { deadT = -1; newHero(); say('BACK ON YOUR FEET'); }
    },

    render(alpha) {
      anim.render(alpha);
      health.render();
      const off = cam.render(alpha, ctl.at(alpha));
      rig.group.position.set(off.x, off.y, off.z);
      for (const e of world.enemies) if (!e.managed) e.render?.(alpha);
      esys.render(alpha);
      stage.render(alpha);
      cfx.render(alpha);
      vfx.render(alpha);
      prog.render(alpha);
    },

    ui(g) {
      const W = display.width, H = display.height;
      cfx.ui(g);
      esys.ui(g);
      vfx.ui(g);
      // world-space boon UI first, the shrine last so it covers everything
      if (!hud) { prog.ui(g); return; }
      if (!prog.shrine.active) drawHud(g, W, H);
      prog.ui(g);
    },

    state() {
      return { showcase: { id: 'boons', mode, auto, bot: botOn, round, zoom: display.zoom,
        held: prog.boons.list().map((b) => ({ id: b.id, level: b.level })), synergies: prog.boons.synergies().map((s) => s.name),
        shards: prog.pickups.total, pickups: prog.pickups.items.length, fires: prog.boons.fires.length, motes: prog.boons.motes.length,
        burning: prog.boons.burning.size, shrine: prog.shrine.active ? { phase: prog.shrine.phase, cards: prog.shrine.cards.map((c) => c.id), selected: prog.shrine.selected } : null,
        stats: prog.pickups.stats } };
    },
  };

  function drawHud(g, W, H) {
    drawText(g, 'BOONS', 8, 8, 'bone', { outline: 'ink' });
    drawText(g, mode === 'room' ? 'DUMMY ROOM' : 'SHRINE', 8, 18, 'mist', { shadow: 'ink' });
    // held boons: a strip of icons
    const b = prog.boons;
    if (b.list().length) drawBoonStrip(g, b, 10, 32, { scale: 2 });
    drawShardCounter(g, 10, 32 + (b.list().length ? 34 : 0) + 4, prog.pickups);
    // hp pips
    const hp = health.hp, mx = health.maxHp;
    const pw = 9, gap = 3, px0 = W - 8 - mx * (pw + gap) + gap;
    const shk = hurtFlash.t < 8 ? ((hurtFlash.t % 2) ? 1 : -1) : 0;
    for (let i = 0; i < mx; i++) {
      const x = px0 + i * (pw + gap) + shk, y = 8;
      g.fillStyle = css('ink'); g.fillRect(x - 1, y - 1, pw + 2, pw + 2);
      const lost = i >= hp;
      g.fillStyle = css(lost ? 'shadow' : 'red'); g.fillRect(x, y, pw, pw);
      if (!lost) { g.fillStyle = css('rose'); g.fillRect(x + 1, y + 1, 3, 2); }
    }
    // the boon on show (room mode) or the last taken one (shrine mode)
    const show = mode === 'room' ? giveIds : lastPick && loop.realTime - lastPick.t < 6 ? [lastPick.id] : [];
    if (show.length) {
      const id = show[0], def = BOONS[id], lv = b.level(id) || 1;
      const R = RARITY[def.rarity];
      drawText(g, def.name, W / 2, 8, R.hi, { align: 'center', scale: 2, outline: 'ink' });
      drawText(g, `${R.name}  LV${lv}`, W / 2, 26, R.edge, { align: 'center', shadow: 'ink' });
      wrapText(def.desc(lv), 300).forEach((ln, i) => drawText(g, ln, W / 2, 37 + i * 9, 'frost', { align: 'center', shadow: 'ink' }));
      if (show.length > 1) drawText(g, 'WITH ' + show.slice(1).map((x) => BOONS[x].name).join(' + '), W / 2, 55, 'fog', { align: 'center', shadow: 'ink' });
    }
    const syn = b.synergies();
    if (syn.length) drawText(g, 'SYNERGY: ' + syn.map((s) => s.name).join(', '), W / 2, 62, 'gold', { align: 'center', outline: 'ink' });
    if (status.text && loop.realTime < status.until) drawText(g, status.text, W / 2, 80, 'gold', { align: 'center', outline: 'ink' });
    if (auto) drawText(g, 'DEMO  (ANY KEY: TAKE OVER)', 8, H - 22, 'mist', { shadow: 'ink' });
    else drawText(g, botOn ? 'BOT FIGHTING  (ANY KEY: TAKE OVER)' : 'LIVE', 8, H - 22, 'leaf', { shadow: 'ink' });
    const help = 'WASD MOVE  J ATTACK  K DASH  E SHRINE  R RESTART  B BOT  Z ZOOM  T SLOW  H HUD';
    const w = textWidth(help) + 8;
    g.fillStyle = css('ink'); g.fillRect(Math.round((W - w) / 2), H - 12, w, 12);
    drawText(g, help, W / 2, H - 10, 'slate', { align: 'center' });
    void IDS; void look; void doorGlow;
  }
}

