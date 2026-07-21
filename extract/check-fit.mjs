// Render named landmarks onto the map so the transform can be checked by eye.
// Usage: node extract/check-fit.mjs
//
// © Void Possum

import fs from 'node:fs';
import { PNG } from 'pngjs';

const WORLD = { minX: -582888, maxX: 335112, minY: -301000, maxY: 617000 };
const OUT = 1024;

// Horizontal comes from world Y (increasing east); vertical from world X, which
// increases northward, so it's inverted to get screen-down pixel space.
export const worldToUV = (x, y) => [
  (y - WORLD.minY) / (WORLD.maxY - WORLD.minY),
  1 - (x - WORLD.minX) / (WORLD.maxX - WORLD.minX),
];

const png = PNG.sync.read(fs.readFileSync('app/data/T_WorldMap.png'));
const step = png.width / OUT;
const out = new PNG({ width: OUT, height: OUT });
for (let y = 0; y < OUT; y++) {
  for (let x = 0; x < OUT; x++) {
    const i = (Math.floor(y * step) * png.width + Math.floor(x * step)) << 2;
    const o = (y * OUT + x) << 2;
    out.data[o] = png.data[i]; out.data[o + 1] = png.data[i + 1];
    out.data[o + 2] = png.data[i + 2]; out.data[o + 3] = 255;
  }
}

const mark = (cx, cy, col, size = 4) => {
  for (let dy = -size; dy <= size; dy++) for (let dx = -size; dx <= size; dx++) {
    if (Math.abs(dx) !== size && Math.abs(dy) !== size) continue; // hollow square
    const x = Math.round(cx) + dx, y = Math.round(cy) + dy;
    if (x < 0 || y < 0 || x >= OUT || y >= OUT) continue;
    const i = (y * OUT + x) << 2;
    out.data[i] = col[0]; out.data[i + 1] = col[1]; out.data[i + 2] = col[2]; out.data[i + 3] = 255;
  }
};

const { markers } = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));
const byLabel = l => markers.find(m => m.label === l);

// Landmarks whose real position on the island is unambiguous.
const LANDMARKS = [
  ['Mount Obsidian - Midpoint', [255, 60, 60], 'volcano, bottom-left'],
  ['Duneshelter', [255, 200, 40], 'desert, top-right'],
  ['PAL Genetic Research Unit Tower Entrance', [120, 220, 255], 'snow, top-centre'],
  ['Fisherman\'s Point', [255, 120, 255], 'far west'],
  ['Deep Sand Dunes', [255, 160, 40], 'desert, far east'],
];

console.log('landmark                                    world(x,y)          -> u,v');
for (const [label, col, note] of LANDMARKS) {
  const m = byLabel(label);
  if (!m) { console.log(`  MISSING: ${label}`); continue; }
  const [u, v] = worldToUV(m.x, m.y);
  console.log(`${label.padEnd(44)} ${String(m.x).padStart(8)},${String(m.y).padStart(8)} -> ${u.toFixed(3)}, ${v.toFixed(3)}   (${note})`);
  mark(u * OUT, v * OUT, col, 6);
}

// every land-guaranteed marker as a small dot
for (const m of markers) {
  if (!['fastTravel', 'towerBoss'].includes(m.category)) continue;
  if (m.x < WORLD.minX || m.x > WORLD.maxX || m.y < WORLD.minY || m.y > WORLD.maxY) continue;
  const [u, v] = worldToUV(m.x, m.y);
  mark(u * OUT, v * OUT, [255, 255, 0], 1);
}

fs.mkdirSync('work', { recursive: true });
fs.writeFileSync('work/fit-check.png', PNG.sync.write(out));
console.log('\nwrote work/fit-check.png');
