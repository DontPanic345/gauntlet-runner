// ?showcase=title: the title screen exactly as the game opens on it (same scene code, its own
// instance), optionally starting on a sub-page.
//
//   ?showcase=title                     the default entry (same as /)
//   ?showcase=title&menu=settings       open on Settings (also: controls, credits, main)
//   ?showcase=title&intro=0             skip the logo's ignite (cracks already lit)
//
// Keys: as the real title. Arrows / WASD / stick move, Enter / J / Space / pad A select,
// Esc / Backspace / pad B / right-click back, Left / Right adjust. Start Run leaves for the run.
// The pause menu is the real one: load ?scene=run and press Esc.
// __GR.debug.title() drives it from scripts (see title.js).

import { createTitleScene } from './title.js';

export default function titleShowcase(params) {
  const menu = params.get('menu') ?? params.get('page') ?? 'main';
  const zoom = parseInt(params.get('zoom') ?? '', 10);
  return createTitleScene({ menu, intro: params.get('intro') !== '0', ui: params.get('ui') !== '0', zoom: Number.isFinite(zoom) ? zoom : undefined }).def;
}
