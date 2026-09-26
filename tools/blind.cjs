#!/usr/bin/env node
// Build a blind comparison packet from two matched sets of images.
//
// Usage: node tools/blind.cjs --ours <dir> --ref <dir> --packet <dir> --key <file>
//
// Both dirs must contain the same number of PNGs; they are paired in sorted-name order
// (so name them 01-idle.png, 02-attack.png, ... in both). A coin flip decides whether
// ours is A or B for the whole packet. Output:
//   <packet>/A/NN.*, <packet>/B/NN.*       the two sets, neutral names
//   <packet>/pair-NN.png                   A on the left, B on the right, same height
// The mapping goes to --key, which must be OUTSIDE the packet dir. Judges read only the packet.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pair } = require('./sheet.cjs');

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i === -1 ? null : args[i + 1]; };
const ours = opt('ours'), ref = opt('ref'), packet = path.resolve(opt('packet')), key = path.resolve(opt('key'));
if (!ours || !ref || !opt('packet') || !opt('key')) { console.error('missing args'); process.exit(1); }
if (key.startsWith(packet + path.sep)) { console.error('--key must be outside --packet'); process.exit(1); }

const list = (d) => fs.readdirSync(d).filter((f) => /\.(png|jpe?g|gif|webp)$/i.test(f)).sort().map((f) => path.join(d, f));
const a0 = list(ours), b0 = list(ref);
if (a0.length !== b0.length || !a0.length) { console.error(`need equal non-zero counts: ours=${a0.length} ref=${b0.length}`); process.exit(1); }

const oursIsA = crypto.randomInt(2) === 0;
const A = oursIsA ? a0 : b0, B = oursIsA ? b0 : a0;
fs.rmSync(packet, { recursive: true, force: true });
fs.mkdirSync(path.join(packet, 'A'), { recursive: true });
fs.mkdirSync(path.join(packet, 'B'), { recursive: true });

(async () => {
for (let i = 0; i < A.length; i++) {
  const n = String(i + 1).padStart(2, '0');
  const ext = (f) => path.extname(f).toLowerCase();
  fs.copyFileSync(A[i], path.join(packet, 'A', n + ext(A[i])));
  fs.copyFileSync(B[i], path.join(packet, 'B', n + ext(B[i])));
  await pair(A[i], B[i], path.join(packet, `pair-${n}.png`));
}

fs.mkdirSync(path.dirname(key), { recursive: true });
fs.writeFileSync(key, JSON.stringify({ ours: oursIsA ? 'A' : 'B', pairs: A.length,
  sources: { A, B } }, null, 2) + '\n');
console.log(`packet: ${packet} (${A.length} pairs). key written to ${key}. Do not open the key before the verdict.`);
})().catch((e) => { console.error(e); process.exit(1); });
