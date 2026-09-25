#!/usr/bin/env node
// Image utilities done in headless Chromium: no native deps, and exact nearest-neighbour
// scaling. For mp4/h264 sources use the system ffmpeg instead (see PROTOCOL.md, References).
//
//   node tools/sheet.cjs grid  --out sheet.png [--cols 4] [--width 320] a.png b.png ...
//        contact sheet of still images, in the order given
//   node tools/sheet.cjs video --in clip.webm|anim.gif --out strip.png [--fps 10] [--start 0]
//                              [--dur 3] [--cols 6] [--width 320]
//        contact sheet of frames sampled from a video (webm/VP8) or animated GIF, so a
//        reader that only sees still images can judge motion. mp4/h264: use /usr/bin/ffmpeg.
//   node tools/sheet.cjs pair  --out pair.png [--height 540] left.png right.png
//        two images side by side at the same height
//
// All scaling is nearest-neighbour so pixel art stays honest.

const fs = require('fs');
const path = require('path');

function loadPlaywright() {
  try { return require('playwright'); } catch {}
  return require('/usr/local/lib/node_modules/playwright');
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.webm': 'video/webm' };
const dataUrl = (f) => `data:${MIME[path.extname(f).toLowerCase()] || 'application/octet-stream'};base64,${fs.readFileSync(f).toString('base64')}`;

async function withPage(fn) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<html><body></body></html>');
    return await fn(page);
  } finally { await browser.close(); }
}

function writeDataUrl(out, url) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(url.split(',')[1], 'base64'));
}

// Lay out frames (array of ImageBitmap-like sources, in-page) into a grid. Runs in page.
const GRID_FN = `
window.__grid = (frames, cols, width) => {
  const cells = frames.map((f) => ({ f, w: width, h: Math.round(f.height * width / f.width) }));
  const ch = Math.max(...cells.map((c) => c.h));
  const rows = Math.ceil(cells.length / cols), pad = 4;
  const cv = document.createElement('canvas');
  cv.width = Math.min(cols, cells.length) * (width + pad) + pad;
  cv.height = rows * (ch + pad) + pad;
  const g = cv.getContext('2d');
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#202020'; g.fillRect(0, 0, cv.width, cv.height);
  cells.forEach((c, i) => g.drawImage(c.f, pad + (i % cols) * (width + pad), pad + Math.floor(i / cols) * (ch + pad), c.w, c.h));
  return cv.toDataURL('image/png');
};
window.__load = (src) => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
`;

async function grid(files, out, cols = 4, width = 320) {
  const srcs = files.map(dataUrl);
  const url = await withPage(async (page) => {
    await page.addScriptTag({ content: GRID_FN });
    return page.evaluate(async ({ srcs, cols, width }) =>
      window.__grid(await Promise.all(srcs.map(window.__load)), cols, width), { srcs, cols, width });
  });
  writeDataUrl(out, url);
}

async function pair(left, right, out, height = 540) {
  const srcs = [dataUrl(left), dataUrl(right)];
  const url = await withPage(async (page) => {
    await page.addScriptTag({ content: GRID_FN });
    return page.evaluate(async ({ srcs, height }) => {
      const [a, b] = await Promise.all(srcs.map(window.__load));
      const wa = Math.round(a.width * height / a.height), wb = Math.round(b.width * height / b.height), gap = 8;
      const cv = document.createElement('canvas');
      cv.width = wa + gap + wb; cv.height = height;
      const g = cv.getContext('2d');
      g.imageSmoothingEnabled = false;
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(a, 0, 0, wa, height); g.drawImage(b, wa + gap, 0, wb, height);
      return cv.toDataURL('image/png');
    }, { srcs, height });
  });
  writeDataUrl(out, url);
}

async function video(inFile, out, { fps = 10, start = 0, dur = 3, cols = 6, width = 320 } = {}) {
  const src = dataUrl(inFile);
  const isGif = /\.gif$/i.test(inFile);
  const url = await withPage(async (page) => {
    await page.addScriptTag({ content: GRID_FN });
    return page.evaluate(async ({ src, isGif, fps, start, dur, cols, width }) => {
      const frames = [];
      if (isGif) {
        const data = await (await fetch(src)).arrayBuffer();
        const dec = new ImageDecoder({ data, type: 'image/gif' });
        await dec.tracks.ready;
        const count = dec.tracks.selectedTrack.frameCount;
        let t = 0; const want = [];
        for (let k = 0; k < fps * dur; k++) want.push(start + k / fps);
        let wi = 0;
        for (let i = 0; i < count && wi < want.length; i++) {
          const { image } = await dec.decode({ frameIndex: i });
          const end = t + (image.duration || 100000) / 1e6;
          while (wi < want.length && want[wi] < end) {
            if (want[wi] >= t) { const c = new OffscreenCanvas(image.displayWidth, image.displayHeight);
              c.getContext('2d').drawImage(image, 0, 0); frames.push(c); }
            wi++;
          }
          t = end; image.close();
        }
      } else {
        const v = document.createElement('video');
        v.muted = true; v.src = src; v.preload = 'auto';
        await new Promise((r, j) => { v.onloadeddata = r; v.onerror = () => j(new Error('video decode failed')); });
        for (let k = 0; k < fps * dur; k++) {
          const t = start + k / fps;
          await new Promise((r) => { v.onseeked = r; v.currentTime = t; });
          if (v.currentTime + 1e-3 < t) break;
          const c = new OffscreenCanvas(v.videoWidth, v.videoHeight);
          c.getContext('2d').drawImage(v, 0, 0); frames.push(c);
        }
      }
      if (!frames.length) throw new Error('no frames in range');
      return window.__grid(frames, cols, width);
    }, { src, isGif, fps, start, dur, cols, width });
  });
  writeDataUrl(out, url);
}

module.exports = { grid, pair, video };

if (require.main === module) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opts = {}; const pos = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i].startsWith('--')) opts[rest[i].slice(2)] = rest[++i]; else pos.push(rest[i]);
  }
  const num = (k, d) => (opts[k] != null ? Number(opts[k]) : d);
  const run = {
    grid: () => grid(pos, opts.out, num('cols', 4), num('width', 320)),
    pair: () => pair(pos[0], pos[1], opts.out, num('height', 540)),
    video: () => video(opts.in, opts.out, { fps: num('fps', 10), start: num('start', 0), dur: num('dur', 3),
      cols: num('cols', 6), width: num('width', 320) }),
  }[cmd];
  if (!run || !opts.out) { console.error('usage: sheet.cjs grid|video|pair --out file ... (see header)'); process.exit(1); }
  run().then(() => console.log(`wrote ${opts.out}`)).catch((e) => { console.error(e.message); process.exit(1); });
}
