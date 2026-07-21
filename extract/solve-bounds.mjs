// Fit a corrected world-Y window from the signed placement errors.
//
// diagnose-offset showed markers drift west toward the eastern edge — a mild
// horizontal scale error. Model the signed x-error as linear in world Y, least-
// squares, then choose minY/maxY that null the trend. World X (vertical) is
// checked the same way and only adjusted if it shows a real trend.
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
function signed(px, py) {
  if (isLand(px, py)) return null;
  let dx = null, dy = null;
  for (let d = 1; d <= 40; d++) {
    if (dx === null) { if (isLand(px + d, py)) dx = d; else if (isLand(px - d, py)) dx = -d; }
    if (dy === null) { if (isLand(px, py + d)) dy = d; else if (isLand(px, py - d)) dy = -d; }
    if (dx !== null && dy !== null) break;
  }
  return { dx, dy };
}

const { markers } = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));
const onMap = m => m.x >= WORLD.minX && m.x <= WORLD.maxX && m.y >= WORLD.minY && m.y <= WORLD.maxY;
const probes = markers.filter(m => onMap(m) && ['fastTravel', 'dungeon', 'towerBoss'].includes(m.category));

const xs = [], ys = [];
for (const m of probes) {
  const { px, py } = toPixel(m.x, m.y);
  const o = signed(px, py);
  if (!o) continue;
  if (o.dx !== null && Math.abs(o.dx) <= 25) xs.push({ w: m.y, d: o.dx }); // dx vs world Y
  if (o.dy !== null && Math.abs(o.dy) <= 25) ys.push({ w: m.x, d: o.dy }); // dy vs world X
}

// least-squares line d = a*w + b
const fit = pts => {
  const n = pts.length;
  const mw = pts.reduce((s, p) => s + p.w, 0) / n;
  const md = pts.reduce((s, p) => s + p.d, 0) / n;
  let cov = 0, varr = 0;
  for (const p of pts) { cov += (p.w - mw) * (p.d - md); varr += (p.w - mw) ** 2; }
  const a = cov / varr, b = md - a * mw;
  return { a, b, n };
};

// current px(wy) = (wy - minY)/span * IMAGE. We want px'(wy) = px(wy) + (a*wy+b)
// so the residual trend is removed. px'(wy) is linear; read off new minY,maxY.
function correctAxis(min, max, { a, b }) {
  const span = max - min;
  const slope0 = IMAGE / span;              // px per world unit
  const off0 = -min * slope0;               // px at wy=0
  const slope1 = slope0 + a;                // add the residual slope
  const off1 = off0 + b;
  const newMin = -off1 / slope1;
  const newMax = newMin + IMAGE / slope1;
  return { newMin: Math.round(newMin), newMax: Math.round(newMax) };
}

const fx = fit(xs); // horizontal (world Y)
const fy = fit(ys); // vertical (world X)
console.log(`x-error vs worldY:  slope ${(fx.a * 1e6).toFixed(2)} px/1e6, intercept ${fx.b.toFixed(2)} (n=${fx.n})`);
console.log(`y-error vs worldX:  slope ${(fy.a * 1e6).toFixed(2)} px/1e6, intercept ${fy.b.toFixed(2)} (n=${fy.n})`);

const Y = correctAxis(WORLD.minY, WORLD.maxY, fx);
// vertical: py = (1 - (wx-minX)/spanX)*IMAGE, i.e. py decreases with wx. The
// residual dy vs wx slope maps the same way through correctAxis if we treat the
// axis as inverted; only apply if the trend is meaningful (>~4px across span).
const yDrift = Math.abs(fy.a * (WORLD.maxX - WORLD.minX));
console.log(`\nvertical drift across span: ${yDrift.toFixed(1)}px ${yDrift < 4 ? '(negligible — leaving X alone)' : '(correcting)'}`);

console.log('\nsuggested WORLD:');
console.log(`const WORLD = { minX: ${WORLD.minX}, maxX: ${WORLD.maxX}, minY: ${Y.newMin}, maxY: ${Y.newMax} };`);
console.log(`\n(minY ${WORLD.minY} -> ${Y.newMin},  maxY ${WORLD.maxY} -> ${Y.newMax})`);
