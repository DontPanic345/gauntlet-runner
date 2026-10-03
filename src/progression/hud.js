// Progression HUD (piece `boons`): the soul shard counter, the held-boons bar, and the
// synergy banner. A stand-in until the `hud` piece exists: it can draw its own and pass
// { hud: false } to createProgression, reading `progress` and the boon:* events instead.
//
//   const hud = createProgressionHud({ runtime, pickups });   hud.ui(g)   hud.dispose()
//
// Shard counter (top right): a crystal and the count. It pops (white, a pixel up) on every
// shard, and a "+n" tally collects consecutive pickups beside it.
// Boon bar (bottom left): one framed icon per boon in its rarity colours, stack pips under it.
// An icon flashes white and hops when its boon procs; a ward or a spent phoenix greys out;
// boons in an active synergy wear a gold corner gem.

import { loop } from '../core/loop.js';
import { events } from '../core/events.js';
import { display } from '../core/display.js';
import { drawText, textWidth } from '../core/pixelfont.js';
import { css } from '../render/palette.js';
import { BOONS, RARITY, progress, has, level, activeSynergies, SYNERGIES } from './boons.js';
import { drawIcon } from './icons.js';
import { bevel } from './cards.js';
import { boonSfx } from './sfx.js';

export function createProgressionHud({ runtime = null, pickups = null, top = 18 } = {}) {
  const offs = [];
  const tally = { n: 0, at: -99 };
  let pop = 0;
  let synBanner = null;
  const gained = new Map();   // id -> realTime gained (icon pops in)
  offs.push(events.on('pickup:shard', () => { pop = loop.realTime; if (loop.realTime - tally.at > 1.2) tally.n = 0; tally.n++; tally.at = loop.realTime; }));
  offs.push(events.on('boon:gain', (e) => {
    gained.set(e.id, loop.realTime);
    if (e.synergies?.length) synBanner = { s: e.synergies[0], t0: loop.realTime + (e.quiet ? 0 : 0.6), played: false };
  }));

  function shards(g) {
    const W = display.width;
    const t = loop.realTime - pop;
    const hot = t < 0.07;
    const txt = String(progress.shards);
    const tw = textWidth(txt, 2);
    const x1 = W - 6, x0 = x1 - tw - 24;
    const y = top + (t < 0.05 ? -1 : 0);
    bevel(g, 'ink', x0 - 3, top - 3, tw + 31, 21, 3);
    bevel(g, 'dusk', x0 - 2, top - 2, tw + 29, 19, 2);
    drawIcon(g, 'shard', x0 - 2, top - 3, { scale: 1, tint: hot ? 'white' : null });
    drawText(g, txt, x1 - 2, y + 1, hot ? 'white' : 'sky', { align: 'right', scale: 2, outline: 'ink' });
    const tt = loop.realTime - tally.at;
    if (tally.n > 1 && tt < 1.2 && !(tt > 0.9 && Math.floor(tt * 20) % 2)) {
      drawText(g, `+${tally.n}`, x0 - 8, top + 4 - Math.round(Math.min(1, tt * 8) * 3), 'frost', { align: 'right', outline: 'ink' });
    }
  }

  function bar(g) {
    const ids = progress.order;
    if (!ids.length) return;
    const H = display.height;
    const syn = activeSynergies();
    const inSyn = new Set(syn.flatMap((s) => [s.a, s.b]));
    const y = H - 44;
    let x = 6;
    for (const id of ids) {
      const B = BOONS[id], R = RARITY[B.rarity];
      const last = runtime?.lastProc?.[id] ?? -99;
      const age = loop.tick - last;
      const flash = age >= 0 && age < 4;
      const born = loop.realTime - (gained.get(id) ?? -9);
      if (born < 0.3 && Math.floor(born * 30) % 2) { x += 24; continue; }
      const hop = age >= 0 && age < 6 ? -[2, 2, 1, 1, 0, 0][age] : 0;
      const spent = (id === 'phoenix' && progress.spent.has('phoenix')) || (id === 'bulwark' && runtime && !runtime.ward.up);
      const yy = y + hop;
      bevel(g, 'ink', x - 1, yy - 1, 22, 22, 2);
      bevel(g, flash ? 'white' : spent ? 'slate' : R.frame, x, yy, 20, 20, 2);
      bevel(g, 'night', x + 1, yy + 1, 18, 18, 1);
      drawIcon(g, id, x + 1, yy + 1, { scale: 1, tint: flash ? 'white' : null, dim: spent && !flash });
      if (inSyn.has(id)) { g.fillStyle = css('ink'); g.fillRect(x + 15, yy - 2, 6, 6); g.fillStyle = css('gold'); g.fillRect(x + 16, yy - 1, 4, 4); g.fillStyle = css('white'); g.fillRect(x + 16, yy - 1, 1, 1); }
      // stack pips
      const n = progress.held.get(id);
      for (let k = 0; k < B.max; k++) {
        g.fillStyle = css('ink'); g.fillRect(x + 2 + k * 6, yy + 22, 5, 4);
        g.fillStyle = css(k < n ? R.frame : 'violet'); g.fillRect(x + 3 + k * 6, yy + 23, 3, 2);
      }
      // live meters: leech motes, ward regrow
      if (id === 'leech' && runtime) {
        const per = level('leech').per, m = runtime.leechMotes;
        for (let k = 0; k < per; k++) { g.fillStyle = css(k < m ? 'red' : 'blood'); g.fillRect(x + 2 + k * 3, yy - 4, 2, 2); }
      }
      if (id === 'bulwark' && runtime && !runtime.ward.up && runtime.ward.meshes.length) {
        const k = 1 - runtime.ward.regrowT / level('bulwark').regrow;
        g.fillStyle = css('sky'); g.fillRect(x + 1, yy + 19 - Math.round(18 * k), 2, Math.round(18 * k));
      }
      if (id === 'starfall' && runtime) {
        const every = level('starfall').every;
        for (let k = 0; k < every; k++) { g.fillStyle = css(k < runtime.hitCount ? 'gold' : 'violet'); g.fillRect(x + 2 + k * 3, yy - 4, 2, 2); }
      }
      x += 24;
    }
  }

  function synergy(g) {
    const b = synBanner;
    if (!b) return;
    const t = loop.realTime - b.t0;
    if (t < 0) return;
    if (!b.played) { b.played = true; boonSfx.synergy(); }
    if (t > 2.6) { synBanner = null; return; }
    if (t > 2.3 && Math.floor(t * 20) % 2) return;
    const W = display.width;
    const s = b.s;
    const k = Math.min(1, t / 0.15);
    const y = Math.round(78 + (1 - k) * 10);
    const title = 'SYNERGY', name = s.name;
    const w = Math.max(textWidth(name, 2) + 52, textWidth(s.text) + 12, 150);
    const x0 = Math.round(W / 2 - w / 2);
    bevel(g, 'ink', x0 - 2, y - 2, w + 4, 46, 3);
    bevel(g, 'gold', x0 - 1, y - 1, w + 2, 44, 3);
    bevel(g, 'night', x0, y, w, 42, 2);
    drawText(g, title, W / 2, y + 3, t < 0.1 ? 'white' : 'gold', { align: 'center' });
    drawIcon(g, s.a, x0 + 4, y + 11, { scale: 1 });
    drawIcon(g, s.b, x0 + w - 22, y + 11, { scale: 1 });
    drawText(g, name, W / 2, y + 13, 'torch', { align: 'center', scale: 2, outline: 'ink' });
    drawText(g, s.text, W / 2, y + 31, 'frost', { align: 'center' });
  }

  return {
    ui(g) { shards(g); bar(g); synergy(g); },
    dispose() { offs.forEach((f) => f()); offs.length = 0; },
  };
}
