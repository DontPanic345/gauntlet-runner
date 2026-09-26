// Pixel icons for the boons (12x12, authored as text, palette names only), drawn with a 1px
// ink outline so they read on any card. Also the shard and heart glyphs for HUDs.
//
//   drawIcon(g, id, x, y, scale = 3, { dim })     x,y = top-left of the 12x12 cell
//   ICON = 12

import { css } from '../render/palette.js';

export const ICON = 12;

const KEY = {
  k: 'ink', w: 'white', t: 'torch', g: 'gold', f: 'flame', e: 'ember', r: 'red', b: 'blood', y: 'rose',
  c: 'cyan', s: 'sky', n: 'navy', u: 'blue', m: 'mist', o: 'fog', z: 'frost', S: 'slate', D: 'dusk',
  v: 'violet', p: 'plum', l: 'leaf', d: 'moss', W: 'woodLight', B: 'wood', T: 'teal', a: 'bone',
};

const ART = {
  'chain-spark': [
    '......ww....',
    '.....wws....',
    '....wwss....',
    '...wwsscc...',
    '..wwwwsscc..',
    '.....wsscc..',
    '....wwscc...',
    '...wwscc.ww.',
    '..wwscc.wss.',
    '.wwsc....ww.',
    '.ws.........',
    '.w..........',
  ],
  'gale-boots': [
    '............',
    '..aaa.......',
    '..aza.......',
    '..aza...s...',
    '..aza.ssz...',
    '..azaaaaz.s.',
    '..azzzzzzss.',
    '..aooooooo..',
    '.aooooooooo.',
    '.SSSSSSSSSS.',
    '.vvvvvvvvvv.',
    '............',
  ],
  'searing-brand': [
    '.....e......',
    '.....ee.....',
    '....eef..e..',
    '...eeff.ee..',
    '...eeffeef..',
    '..eefffeff..',
    '..eeffgfff..',
    '..eefgtgff..',
    '..eefgtgfe..',
    '...eefgfee..',
    '....eeeee...',
    '............',
  ],
  lodestone: [
    '.....cc.....',
    '....cssc....',
    '...csswsc...',
    '..cssswwsc..',
    '..csswwwsu..',
    '..cswwwssu..',
    '...cswsscu..',
    '....csssu...',
    '.....csuu...',
    '......uu....',
    '..g.......g.',
    '.ggg.....ggg',
  ],
  bloodrush: [
    '............',
    '.rr..rr..rr.',
    '..rr..rr..rr',
    '...rr..rr..r',
    '..rr..rr..rr',
    '.rr..rr..rr.',
    '............',
    '.yy..yy..yy.',
    '..yy..yy....',
    '.yy..yy.....',
    '............',
    '............',
  ],
  'ember-trail': [
    '............',
    '..........e.',
    '.........ef.',
    '........effe',
    '....e...fgfe',
    '...ef..efgfe',
    '..efe..efffe',
    '.efgfe..eee.',
    '.efgfe.e....',
    '.effe.eff...',
    '..ee..efe...',
    '.......e....',
  ],
  'third-wave': [
    '............',
    '.....gggg...',
    '...ggffffg..',
    '..gffeeeffg.',
    '.gfe.tt.efg.',
    '.gf.tggt.fg.',
    'gfe.tg...efg',
    'gf..t.....fg',
    'gf........fg',
    'ge........eg',
    '.e........e.',
    '............',
  ],
  'ghost-dash': [
    '............',
    '.....cccc...',
    '....cssssc..',
    '...cswwwwsc.',
    '.ccsw.kk.wsc',
    'ccsssw..wssc',
    '.ccsswwwssc.',
    '..ccssssscc.',
    '...cscscscc.',
    '..cc.c.c.c..',
    '.cc..c......',
    '............',
  ],
  'life-motes': [
    '............',
    '..rrr.rrr...',
    '.rrwrrrrrr..',
    '.rwrrrrrrr..',
    '.rrrrrrrrb..',
    '..rrrrrrb.y.',
    '...rrrrb.y..',
    '....rrb.....',
    '.y...bb...y.',
    '..y.....y...',
    '............',
    '............',
  ],
  retribution: [
    '.....ee.....',
    '..e..ee..e..',
    '...e.ff.e...',
    '....effe....',
    '.ee.efge.ee.',
    'eeffgttgffee',
    'eeffgttgffee',
    '.ee.efge.ee.',
    '....effe....',
    '...e.ff.e...',
    '..e..ee..e..',
    '.....ee.....',
  ],
  aegis: [
    '............',
    '..uuuuuuuu..',
    '.uzzsssssnu.',
    '.uzsssscccu.',
    '.uzsswwcccu.',
    '.uzssscccnu.',
    '.uscccccnnu.',
    '..uccccnnu..',
    '..uuccnnu...',
    '...uucnu....',
    '....uuu.....',
    '............',
  ],
  headsman: [
    '............',
    '.....SSSS...',
    '....SzzzzS..',
    '...SzgggzzS.',
    '..SzgggzzzS.',
    '..SzgggzzzS.',
    '..SzzzzzzS.B',
    '...SzzzSSSB.',
    '.....SSSB...',
    '.....WB.....',
    '....WB......',
    '...WB.......',
  ],
  'storm-call': [
    '...zzzz.....',
    '..zaaaazz...',
    '.zaaaaaazz..',
    'zzaaaaaaaaz.',
    'zaaaaaaaaaz.',
    '.oooooooooo.',
    '.....gg.....',
    '....ggt.....',
    '...ggtt.....',
    '....gggg....',
    '.....gt.....',
    '....g.......',
  ],
  'volatile-soul': [
    '.e.......e..',
    '..e.aaa.e...',
    '...aazzza...',
    '..azzzzzza..',
    '.ezzzzzzzze.',
    '.ezkkzzkkze.',
    '..zkekzkekz.',
    '..zzzzzzzz..',
    '...zazazz...',
    '..e.zzzz.e..',
    '.e...aa...e.',
    '............',
  ],
  'orbit-blades': [
    '...zz.......',
    '..zsz.......',
    '.zs..ccccc..',
    '.z..c.....c.',
    '.z.c..ww...c',
    '...c.wtgw..c',
    '...c.wgtw..c',
    '.z.c..ww...c',
    '.zs.c....c..',
    '..zsz.ccc...',
    '...zzz...zz.',
    '.........zsz',
  ],
  'phoenix-spark': [
    '.....gg.....',
    'e....gg....e',
    'ee..gffg..ee',
    'eee.gffg.eee',
    'efeegfteefee',
    'effffgtgfffe',
    '.effffgfffe.',
    '..effffffe..',
    '...eeffee...',
    '....efge....',
    '.....ee.....',
    '.....r......',
  ],
};

/** Cached per-icon list of [x, y, colourName] pixels. */
const cache = new Map();
function pixels(id) {
  let p = cache.get(id);
  if (p) return p;
  p = [];
  const art = ART[id] ?? ART['chain-spark'];
  for (let y = 0; y < ICON; y++) for (let x = 0; x < ICON; x++) {
    const ch = art[y]?.[x];
    if (ch && ch !== '.') p.push([x, y, KEY[ch] ?? 'white']);
  }
  cache.set(id, p);
  return p;
}

/** Draw icon `id` with its top-left at (x, y), each icon pixel `s` screen pixels. */
export function drawIcon(g, id, x, y, s = 3, { outline = true, dim = 0 } = {}) {
  const px = pixels(id);
  if (outline) {
    g.fillStyle = css('ink');
    for (const [ix, iy] of px) {
      g.fillRect(x + (ix - 1) * s, y + iy * s, s * 3, s);
      g.fillRect(x + ix * s, y + (iy - 1) * s, s, s * 3);
    }
  }
  for (const [ix, iy, c] of px) {
    g.fillStyle = css(c);
    g.fillRect(x + ix * s, y + iy * s, s, s);
  }
  if (dim > 0) {
    g.fillStyle = `rgba(11,10,18,${dim})`;
    for (const [ix, iy] of px) g.fillRect(x + ix * s, y + iy * s, s, s);
  }
}

export const iconIds = () => Object.keys(ART);

const SHARD = ['..c..', '.csc.', 'csws.', '.cus.', '..u..'];
const HEART = ['.rr.rr.', 'rwrrrrr', 'rrrrrrb', '.rrrrb.', '..rrb..', '...b...'];
/** Small HUD glyphs. kind: 'shard' | 'heart'. Returns [w, h]. */
export function drawGlyph(g, kind, x, y, s = 1) {
  const art = kind === 'heart' ? HEART : SHARD;
  const col = { c: 'cyan', s: 'sky', w: 'white', u: 'blue', r: 'red', b: 'blood' };
  g.fillStyle = css('ink');
  for (let j = 0; j < art.length; j++) for (let i = 0; i < art[j].length; i++) {
    if (art[j][i] === '.') continue;
    g.fillRect(x + (i - 1) * s, y + j * s, s * 3, s); g.fillRect(x + i * s, y + (j - 1) * s, s, s * 3);
  }
  for (let j = 0; j < art.length; j++) for (let i = 0; i < art[j].length; i++) {
    const c = art[j][i]; if (c === '.') continue;
    g.fillStyle = css(col[c]); g.fillRect(x + i * s, y + j * s, s, s);
  }
  return [art[0].length * s, art.length * s];
}
