#!/usr/bin/env node
// Drive the game (or any URL) in headless Chromium and save screenshots / video.
//
// Usage:
//   node tools/capture.cjs --url "/?scene=run&seed=3" --out shots/x [--script steps.json]
//                          [--steps '<json>'] [--video] [--size 1280x720] [--wait-ready]
//
// A --url starting with "/" is served from the project root by a throwaway static
// server on a free port, so parallel agents never collide. Any http(s) URL (e.g. an
// itch.io HTML5 game) is loaded as-is.
//
// Steps (JSON array, run in order):
//   {"wait": 500}                       sleep ms
//   {"press": "Space", "hold": 80}      tap a key (Playwright key names: KeyW, ArrowLeft, Shift, ...)
//   {"down": "KeyD"} / {"up": "KeyD"}   hold / release a key
//   {"click": [640, 360]}               mouse click at page coords
//   {"move": [640, 360]}                mouse move
//   {"eval": "window.__GR.debug.spawn('slime')"}   run JS in page, result printed
//   {"shot": "name"}                    screenshot -> <out>/name.png
//   {"burst": "name", "count": 8, "every": 50}     numbered screenshots for motion
// Default when no steps given: wait 1500ms, shot "frame".
//
// Console errors and page errors are written to <out>/console.log and summarised on stdout.

const fs = require('fs');
const path = require('path');
const http = require('http');

function loadPlaywright() {
  try { return require('playwright'); } catch {}
  return require('/usr/local/lib/node_modules/playwright');
}

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = args[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
};

const ROOT = path.resolve(__dirname, '..');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const file = path.join(ROOT, p);
      if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

(async () => {
  const url = opt('url', '/');
  const out = path.resolve(opt('out', 'shots/capture'));
  const [w, h] = String(opt('size', '1280x720')).split('x').map(Number);
  let steps = [{ wait: 1500 }, { shot: 'frame' }];
  if (opt('script')) steps = JSON.parse(fs.readFileSync(opt('script'), 'utf8'));
  if (opt('steps')) steps = JSON.parse(opt('steps'));
  fs.mkdirSync(out, { recursive: true });

  let server = null;
  let target = url;
  if (url.startsWith('/')) {
    server = await serve();
    target = `http://127.0.0.1:${server.address().port}${url}`;
  }

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    ...(opt('video') ? { recordVideo: { dir: out, size: { width: w, height: h } } } : {}),
  });
  const page = await context.newPage();
  const log = [];
  page.on('console', (m) => log.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => log.push(`[pageerror] ${e.stack || e.message}`));

  await page.goto(target, { waitUntil: 'load' });
  if (opt('wait-ready')) {
    await page.waitForFunction(() => window.__GR && window.__GR.ready, null, { timeout: 20000 });
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const s of steps) {
    if (s.wait != null) await sleep(s.wait);
    else if (s.press) { await page.keyboard.down(s.press); await sleep(s.hold ?? 60); await page.keyboard.up(s.press); }
    else if (s.down) await page.keyboard.down(s.down);
    else if (s.up) await page.keyboard.up(s.up);
    else if (s.click) await page.mouse.click(s.click[0], s.click[1]);
    else if (s.move) await page.mouse.move(s.move[0], s.move[1]);
    else if (s.eval) console.log('eval:', JSON.stringify(await page.evaluate(s.eval)));
    else if (s.shot) await page.screenshot({ path: path.join(out, `${s.shot}.png`) });
    else if (s.burst) {
      for (let i = 0; i < (s.count ?? 8); i++) {
        await page.screenshot({ path: path.join(out, `${s.burst}-${String(i).padStart(2, '0')}.png`) });
        await sleep(s.every ?? 50);
      }
    }
  }

  const video = page.video();
  await context.close();
  if (video) console.log('video:', await video.path());
  await browser.close();
  if (server) server.close();

  fs.writeFileSync(path.join(out, 'console.log'), log.join('\n') + '\n');
  const errors = log.filter((l) => l.startsWith('[error]') || l.startsWith('[pageerror]'));
  console.log(`saved to ${out} — ${log.length} console lines, ${errors.length} errors`);
  errors.slice(0, 10).forEach((e) => console.log('  ' + e));
  process.exitCode = errors.length ? 2 : 0;
})().catch((e) => { console.error(e); process.exit(1); });
