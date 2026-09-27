// ?showcase=title : the title screen itself. This is deliberately the same scene as the
// default `/` entry (pieces.json: "same as the default entry"), so a critic sees exactly what
// a player sees, plus a param to jump straight into a sub-screen for judging it in isolation.
//
// Params: &menu=main|settings|controls|credits   start on that screen instead of the closed
//         "press start" vignette (default). ?showcase=title&menu=settings is the second
//         showcase pieces.json asks for.

import { createTitleScene } from './title.js';

export default function showcaseTitle(params) {
  return createTitleScene({ forceMenu: params.get('menu') });
}
