// Fit the world-Y scale from small-island markers.
//
// The cleanest ground truth for placement is a fast-travel point on a tiny
// isolated island: it should sit at the island's centre. For each such marker,
// flood-fill the land blob nearest it; if the blob is small (a real islet, not
// the mainland), pair its centroid pixel with the marker's world coord. Coastal
// pier points on big landmasses are excluded — that's the noise that washed out
// the least-squares fit.
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

// downsample the land mask to 2048 so flood-fills are cheap
const png = PNG.sync.read(fs.readFileSync('app/data/T_WorldMap.png'));
const F = png.width / 2048;
const M = 2048;
const land = new Uint8Array(M * M);
for (let y = 0; y < M; y++) for (let x = 0; x < M; x++) {
  const i = ((Math.floor(y * F) * png.width) + Math.floor(x * F)) << 2;
  const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
  land[y * M + x] = (a >= 40 && (g > b + 5 || r > b + 5 || (r + g + b) / 3 > 130)) ? 1 : 0;
}

// nearest land cell to a point, then flood-fill its blob
function blobNear(px, py) {
  const cx = Math.round(px / F), cy = Math.round(py / F);
  let seed = null;
  for (let r = 0; r <= 40 && !seed; r++) {
    for (let a = 0; a < 360 && !seed; a += 8) {
      const x = Math.round(cx + r * Math.cos(a * Math.PI / 180));
      const y = Math.round(cy + r * Math.sin(a * Math.PI / 180));
      if (x >= 0 && y >= 0 && x < M && y < M && land[y * M + x]) seed = [x, y];
    }
  }
  if (!seed) return null;
  const seen = new Set();
  const stack = [seed];
  let sx = 0, sy = 0, n = 0, minX = M, maxX = 0, minY = M, maxY = 0;
  while (stack.length) {
    const [x, y] = stack.pop();
    const k = y * M + x;
    if (x < 0 || y < 0 || x >= M || y >= M || seen.has(k) || !land[k]) continue;
    seen.add(k); sx += x; sy += y; n++;
    if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (n > 20000) break; // mainland — bail
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return { cx: sx / n * F, cy: sy / n * F, cells: n, w: (maxX - minX) * F, h: (maxY - minY) * F };
}

const { markers } = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));
const onMap = m => m.x >= WORLD.minX && m.x <= WORLD.maxX && m.y >= WORLD.minY && m.y <= WORLD.maxY;
const probes = markers.filter(m => onMap(m) && m.category === 'fastTravel');

const anchors = [];
for (const m of probes) {
  const { px, py } = toPixel(m.x, m.y);
  const blob = blobNear(px, py);
  if (!blob) continue;
  // small isolated island only, and marker should be near its centre
  const islandPx = blob.cells * F * F;
  const near = Math.hypot(px - blob.cx, py - blob.cy) < Math.max(blob.w, blob.h);
  if (islandPx > 400000 || !near) continue;               // skip mainland / far markers
  if (Math.max(blob.w, blob.h) > 1200) continue;           // skip big landmasses
  anchors.push({ label: m.label, wy: m.y, wx: m.x, px, py, cx: blob.cx, cy: blob.cy, dx: blob.cx - px, dy: blob.cy - py });
}

anchors.sort((a, b) => a.wy - b.wy);
console.log(`${anchors.length} small-island anchors:\n`);
for (const a of anchors) console.log(`  ${a.label.padEnd(34)} wY=${String(a.wy).padStart(8)}  dx=${a.dx.toFixed(1).padStart(6)}  dy=${a.dy.toFixed(1).padStart(6)}`);

// least-squares dx = A*wy + B, robust-ish (already filtered to clean anchors)
const n = anchors.length;
const mw = anchors.reduce((s, a) => s + a.wy, 0) / n;
const md = anchors.reduce((s, a) => s + a.dx, 0) / n;
let cov = 0, varr = 0;
for (const a of anchors) { cov += (a.wy - mw) * (a.dx - md); varr += (a.wy - mw) ** 2; }
const A = cov / varr, B = md - A * mw;
console.log(`\ndx = ${(A * 1e6).toFixed(2)}/1e6 * wY + ${B.toFixed(2)}   (mean |dx| ${(anchors.reduce((s, a) => s + Math.abs(a.dx), 0) / n).toFixed(1)}px)`);

const span = WORLD.maxY - WORLD.minY;
const slope0 = IMAGE / span, off0 = -WORLD.minY * slope0;
const slope1 = slope0 + A, off1 = off0 + B;
const newMin = Math.round(-off1 / slope1);
const newMax = Math.round(newMin + IMAGE / slope1);
console.log(`\nsuggested WORLD:`);
console.log(`const WORLD = { minX: ${WORLD.minX}, maxX: ${WORLD.maxX}, minY: ${newMin}, maxY: ${newMax} };`);
