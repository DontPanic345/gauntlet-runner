// ?showcase=<piece-id> router.
//
// Each piece's showcase is an ES module whose default export is a function
//   (params: URLSearchParams) => sceneDef      (see scenes.js for the sceneDef shape)
// The router registers it as the 'showcase' scene and switches to it.
//
// To wire up your piece's showcase, set `load` on its row below (a one-line edit that
// every piece is allowed to make). Rows with load: null show a readable "not built yet"
// screen instead of a blank canvas; unknown ids show "no such showcase" with the list.

import { scenes } from './scenes.js';
import { display } from './display.js';
import { drawText, textWidth, LINE_H, wrapText } from './pixelfont.js';
import { css } from '../render/palette.js';
import { loop } from './loop.js';

export const SHOWCASES = {
  foundation: { title: 'Engine foundation', load: () => import('./showcase-foundation.js') },
  look: { title: 'Render look', load: () => import('../render/showcase.js') },
  hero: { title: 'Hero model and animation', load: () => import('../hero/showcase.js') },
  movement: { title: 'Movement and camera', load: () => import('./showcase-movement.js') },
  combat: { title: 'Combat feel', load: () => import('../combat/showcase.js') },
  vfx: { title: 'VFX and juice', load: () => import('../vfx/showcase.js') },
  enemies: { title: 'Enemies', load: () => import('../enemies/showcase.js') },
  arenas: { title: 'Arenas and environment', load: () => import('../world/showcase-arenas.js') },
  gauntlet: { title: 'Gauntlet corridors', load: () => import('../world/showcase-gauntlet.js') },
  boons: { title: 'Boons and pickups', load: () => import('../progression/showcase.js') },
  boss: { title: 'Boss: The Warden', load: () => import('../boss/showcase.js') },
  hud: { title: 'HUD and in-game UI', load: () => import('../ui/showcase-hud.js') },
  audio: { title: 'Audio', load: () => import('../audio/showcase.js') },
  title: { title: 'Title screen and menus', load: null },
  'run-flow': { title: 'Run flow and endings', load: null },
};

/** Load and enter a showcase. Always ends in a drawn scene: the showcase or an error screen. */
export async function startShowcase(id, params) {
  const entry = SHOWCASES[id];
  if (!entry) return showError('NO SUCH SHOWCASE', id, `There is no showcase called "${id}".`);
  if (!entry.load) return showError('NOT BUILT YET', id, `The "${entry.title}" piece has not wired up its showcase yet.`);
  try {
    const mod = await entry.load();
    const def = mod.default(params);
    scenes.define('showcase', def);
    scenes.go('showcase', { id, params });
  } catch (err) {
    console.error(`showcase "${id}" failed to load:`, err);
    showError('SHOWCASE FAILED', id, `${err && err.message ? err.message : err}`);
  }
}

function showError(heading, id, message) {
  scenes.define('showcase-error', errorScene(heading, id, message));
  scenes.go('showcase-error');
}

function errorScene(heading, id, message) {
  let t0 = 0;
  return {
    enter() { t0 = loop.realTime; },
    ui(g) {
      const W = display.width, H = display.height;
      const ids = Object.keys(SHOWCASES);
      const panelW = Math.min(W - 16, 330);
      const panelH = 70 + ids.length * LINE_H + 10;
      const x = Math.round((W - panelW) / 2), y = Math.max(6, Math.round((H - panelH) / 2));
      // slide the panel in over the first 200 ms
      const k = Math.min(1, (loop.realTime - t0) / 0.2);
      const oy = Math.round((1 - k) * (1 - k) * 18);
      g.fillStyle = css('shadow');
      g.fillRect(x, y + oy, panelW, panelH);
      g.fillStyle = css('rose');
      g.fillRect(x, y + oy, panelW, 2);
      g.fillStyle = css('ink');
      g.fillRect(x, y + oy + panelH, panelW, 2);
      let cy = y + oy + 10;
      drawText(g, heading, x + 10, cy, 'rose', { shadow: 'ink', scale: 2 });
      cy += 20;
      drawText(g, `?showcase=${id}`, x + 10, cy, 'gold', { shadow: 'ink' });
      cy += LINE_H + 2;
      for (const line of wrapText(message, panelW - 20)) { drawText(g, line, x + 10, cy, 'frost'); cy += LINE_H; }
      cy += 6;
      drawText(g, 'SHOWCASES:', x + 10, cy, 'fog'); cy += LINE_H + 2;
      for (const sid of ids) {
        const e = SHOWCASES[sid];
        const ready = !!e.load;
        const col = sid === id ? 'gold' : ready ? 'bone' : 'mist';
        drawText(g, (ready ? '• ' : '  ') + sid, x + 14, cy, col);
        const tag = ready ? 'READY' : 'NOT BUILT';
        drawText(g, tag, x + panelW - 10 - textWidth(tag), cy, ready ? 'leaf' : 'slate');
        cy += LINE_H;
      }
    },
  };
}
