// Run flow and endings (piece `run-flow`). main.js imports this once, after the other scene
// pieces, and calls flow.draw(g, realDt) every frame after the scene UI.
//
//   src/run/record.js        the run record (stats, cause of death) and the meta (best time, depth, lore)
//   src/run/flow.js          the router: styled transitions, hp carry, the death slow-mo, restart
//   src/run/arena-scene.js   the 'run' scene: an arena of the run, with the drop-in
//   src/run/endings.js       the 'gameover' and 'victory' scenes
//   src/run/summary.js       the summary slab both endings use
//   src/run/wall.js          the stone-block transition wall and the screen collapse
//   src/run/sfx.js           the piece's sounds (added to the audio bank)
//   src/run/showcase.js      ?showcase=run-flow

import './sfx.js';
import './record.js';
import './arena-scene.js';
import './endings.js';
export { flow } from './flow.js';
export { run, meta } from './record.js';
