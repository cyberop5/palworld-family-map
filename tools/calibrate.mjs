// Calibrate the world -> map-image transform.
//
// T_WorldMap covers the whole game world (Palpagos plus the DLC islands), not
// just the Palpagos box the published constants describe. Orientation is fixed
// from geography: the image's horizontal axis is world Y (east positive) and its
// vertical axis is world X inverted (north is up). That leaves an offset and a
// scale per axis, which we fit by maximising how many land-guaranteed markers
// (fast travel, dungeons, towers) land on land pixels.
//
// © Void Possum

import fs from 'node:fs';
import { PNG } from 'pngjs';

const N = 1024;
console.log('decoding map texture…');
const png = PNG.sync.read(fs.readFileSync('app/data/T_WorldMap.png'));
const step = png.width / N;

const land = new Uint8Array(N * N);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const i = (Math.floor(y * step) * png.width + Math.floor(x * step)) << 2;
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
    land[y * N + x] = (a >= 40 && (g > b + 5 || r > b + 5 || (r + g + b) / 3 > 130)) ? 1 : 0;
  }
}
const coverage = land.reduce((s, v) => s + v, 0) / (N * N);
console.log(`land coverage: ${(coverage * 100).toFixed(1)}%`);

const { markers: allMarkers } = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));

// The World Tree is a separate instanced map (its own T_TreeMap texture) sitting
// in an isolated corner of world space. Nothing there belongs on T_WorldMap.
const isWorldTree = m => m.x >= 400000 && m.y <= -500000;
const markers = allMarkers.filter(m => !isWorldTree(m));
console.log(`${allMarkers.length - markers.length} World Tree markers excluded`);

const probes = markers.filter(m => ['fastTravel', 'dungeon', 'towerBoss'].includes(m.category));
console.log(`${probes.length} land-guaranteed probes\n`);

// Dilate the land mask by 2px: markers legitimately sit on beaches and jetties,
// which are a pixel or two off "land" at this resolution.
const R = 2;
const nearLand = new Uint8Array(N * N);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    let on = 0;
    for (let dy = -R; dy <= R && !on; dy++) {
      for (let dx = -R; dx <= R && !on; dx++) {
        const yy = y + dy, xx = x + dx;
        if (yy >= 0 && xx >= 0 && yy < N && xx < N && land[yy * N + xx]) on = 1;
      }
    }
    nearLand[y * N + x] = on;
  }
}
const nearCoverage = nearLand.reduce((s, v) => s + v, 0) / (N * N);
console.log(`land coverage (dilated ${R}px): ${(nearCoverage * 100).toFixed(1)}%`);

// score for a candidate world box
function score(minX, maxX, minY, maxY) {
  let hit = 0;
  const spanX = maxX - minX, spanY = maxY - minY;
  for (const m of probes) {
    const u = (m.y - minY) / spanY;
    const v = 1 - (m.x - minX) / spanX;
    const x = (u * N) | 0, y = (v * N) | 0;
    if (x < 0 || y < 0 || x >= N || y >= N) continue;
    hit += nearLand[y * N + x];
  }
  return hit / probes.length;
}

// seed from the marker extent, then coarse-to-fine search
const xs = markers.map(m => m.x), ys = markers.map(m => m.y);
let box = {
  minX: Math.min(...xs), maxX: Math.max(...xs),
  minY: Math.min(...ys), maxY: Math.max(...ys),
};
console.log(`seed box X ${box.minX}..${box.maxX}  Y ${box.minY}..${box.maxY}`);
console.log(`seed score: ${(score(box.minX, box.maxX, box.minY, box.maxY) * 100).toFixed(1)}%\n`);

function refine(start) {
  let best = { ...start, s: score(start.minX, start.maxX, start.minY, start.maxY) };
  let stepSize = 160000;
  while (stepSize >= 500) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const key of ['minX', 'maxX', 'minY', 'maxY']) {
        for (const delta of [-stepSize, stepSize]) {
          const cand = { ...best, [key]: best[key] + delta };
          if (cand.maxX - cand.minX < 100000 || cand.maxY - cand.minY < 100000) continue;
          const s = score(cand.minX, cand.maxX, cand.minY, cand.maxY);
          if (s > best.s + 1e-9) { best = { ...cand, s }; improved = true; }
        }
      }
    }
    stepSize = Math.round(stepSize / 2);
  }
  return best;
}

// Multi-start so we don't settle into a local optimum.
let best = { s: 0 };
const jitters = [0, 150000, -150000, 300000, -300000];
for (const jx of jitters) {
  for (const jy of jitters) {
    const r = refine({ minX: box.minX + jx, maxX: box.maxX - jx, minY: box.minY + jy, maxY: box.maxY - jy });
    if (r.s > best.s) { best = r; console.log(`  new best ${(r.s * 100).toFixed(1)}% (start jx=${jx} jy=${jy})`); }
  }
}

console.log(`\nbest: ${(best.s * 100).toFixed(1)}% of land-guaranteed markers on land (random baseline ${(coverage * 100).toFixed(1)}%)`);
console.log('\nPaste into app.js:');
console.log(`const WORLD = { minX: ${best.minX}, maxX: ${best.maxX}, minY: ${best.minY}, maxY: ${best.maxY} };`);

fs.mkdirSync('work', { recursive: true });
fs.writeFileSync('work/transform.json', JSON.stringify(
  { minX: best.minX, maxX: best.maxX, minY: best.minY, maxY: best.maxY, score: best.s }, null, 2));

// --- overlay so the fit can be judged by eye --------------------------------
const OUT = 1024;
const out = new PNG({ width: OUT, height: OUT });
for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
  const i = (Math.floor(y * step) * png.width + Math.floor(x * step)) << 2;
  const o = (y * OUT + x) << 2;
  out.data[o] = png.data[i]; out.data[o + 1] = png.data[i + 1];
  out.data[o + 2] = png.data[i + 2]; out.data[o + 3] = 255;
}
const spanX = best.maxX - best.minX, spanY = best.maxY - best.minY;
for (const m of probes) {
  const u = (m.y - best.minY) / spanY, v = 1 - (m.x - best.minX) / spanX;
  const cx = Math.round(u * OUT), cy = Math.round(v * OUT);
  const col = m.category === 'towerBoss' ? [255, 60, 60] : [255, 235, 40];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= OUT || y >= OUT) continue;
    const i = (y * OUT + x) << 2;
    out.data[i] = col[0]; out.data[i + 1] = col[1]; out.data[i + 2] = col[2];
  }
}
fs.writeFileSync('work/calibration-overlay.png', PNG.sync.write(out));
console.log('wrote work/calibration-overlay.png');
