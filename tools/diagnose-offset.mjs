// Is the placement error a fixable linear (scale/offset) error, or scattered
// texture noise? Measure signed nearest-land direction for small-island markers
// and see if it trends with world position.
//
// © Void Possum

import fs from 'node:fs';
import { PNG } from 'pngjs';

const WORLD = { minX: -1094598, maxX: 347730, minY: -726096, maxY: 729410 };
const IMAGE = 8192;
const toPixel = (wx, wy) => ({
  px: (wy - WORLD.minY) / (WORLD.maxY - WORLD.minY) * IMAGE,
  py: (1 - (wx - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * IMAGE,
});

const png = PNG.sync.read(fs.readFileSync('app/data/T_WorldMap.png'));
const N = png.width;
const isLand = (x, y) => {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= N || y >= N) return false;
  const i = (y * N + x) << 2;
  const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
  return a >= 40 && (g > b + 5 || r > b + 5 || (r + g + b) / 3 > 130);
};

// signed offset toward land: for a marker in water, how far and which way is the
// nearest land along each axis. Positive dx = land is east (marker too far west).
function signedOffset(px, py) {
  if (isLand(px, py)) return null; // on land, no signal
  let dx = null, dy = null;
  for (let d = 1; d <= 80; d++) {
    if (dx === null) { if (isLand(px + d, py)) dx = d; else if (isLand(px - d, py)) dx = -d; }
    if (dy === null) { if (isLand(px, py + d)) dy = d; else if (isLand(px, py - d)) dy = -d; }
    if (dx !== null && dy !== null) break;
  }
  return { dx, dy };
}

const { markers } = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));
const onMap = m => m.x >= WORLD.minX && m.x <= WORLD.maxX && m.y >= WORLD.minY && m.y <= WORLD.maxY;
const probes = markers.filter(m => onMap(m) && ['fastTravel', 'dungeon', 'towerBoss'].includes(m.category));

const rows = [];
for (const m of probes) {
  const { px, py } = toPixel(m.x, m.y);
  const o = signedOffset(px, py);
  if (o && o.dx !== null && Math.abs(o.dx) <= 40) rows.push({ wy: m.y, wx: m.x, dx: o.dx, dy: o.dy });
}

// correlate dx with world Y (drives image X). A clean slope => scale error.
const n = rows.length;
const mx = rows.reduce((s, r) => s + r.wy, 0) / n;
const mdx = rows.reduce((s, r) => s + r.dx, 0) / n;
let cov = 0, varr = 0;
for (const r of rows) { cov += (r.wy - mx) * (r.dx - mdx); varr += (r.wy - mx) ** 2; }
const slope = cov / varr;

console.log(`${n} off-land probes with a clear x-signal`);
console.log(`mean signed dx: ${mdx.toFixed(1)}px  (+ = markers too far west)`);
console.log(`dx vs worldY slope: ${(slope * 1e6).toFixed(3)} px per 1e6 world-units`);
console.log(`  -> across the ${((WORLD.maxY - WORLD.minY) / 1e6).toFixed(2)}e6 Y span that's ${(slope * (WORLD.maxY - WORLD.minY)).toFixed(1)}px of drift`);
console.log(`\nbucketed by world Y:`);
for (const [lo, hi] of [[-800000, -200000], [-200000, 100000], [100000, 300000], [300000, 800000]]) {
  const b = rows.filter(r => r.wy >= lo && r.wy < hi);
  if (!b.length) continue;
  const avg = b.reduce((s, r) => s + r.dx, 0) / b.length;
  console.log(`  Y ${String(lo).padStart(8)}..${String(hi).padStart(7)}: n=${String(b.length).padStart(3)}  mean dx=${avg.toFixed(1)}px`);
}
