// Measure any systematic placement offset.
//
// Land-based markers (fast travel, dungeons, towers) should sit ON land. For
// each, find the nearest land pixel; the average offset vector is the systematic
// error the land-overlap fit was too coarse to catch. Reported in image pixels
// and converted to a world-Y / world-X correction.
//
// © Void Possum

import fs from 'node:fs';
import { PNG } from 'pngjs';

const WORLD = { minX: -1094598, maxX: 347730, minY: -726096, maxY: 729410 };
const IMAGE = 8192;

// Same transform the app uses.
const toPixel = (wx, wy) => {
  const u = (wy - WORLD.minY) / (WORLD.maxY - WORLD.minY);
  const v = 1 - (wx - WORLD.minX) / (WORLD.maxX - WORLD.minX);
  return { px: u * IMAGE, py: (1 - (1 - v)) * IMAGE }; // py measured from top
};

console.log('decoding map…');
const png = PNG.sync.read(fs.readFileSync('app/data/T_WorldMap.png'));
const N = png.width; // 8192
const isLand = (x, y) => {
  if (x < 0 || y < 0 || x >= N || y >= N) return false;
  const i = (y * N + x) << 2;
  const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2], a = png.data[i + 3];
  return a >= 40 && (g > b + 5 || r > b + 5 || (r + g + b) / 3 > 130);
};

const { markers } = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));
const onPalpagos = m => m.x >= WORLD.minX && m.x <= WORLD.maxX && m.y >= WORLD.minY && m.y <= WORLD.maxY;
const probes = markers.filter(m => onPalpagos(m) && ['fastTravel', 'dungeon', 'towerBoss'].includes(m.category));

// nearest land pixel within a small radius (spiral out)
function nearestLandOffset(px, py) {
  const cx = Math.round(px), cy = Math.round(py);
  if (isLand(cx, cy)) return { dx: 0, dy: 0, dist: 0 };
  for (let r = 1; r <= 60; r++) {
    for (let a = 0; a < 360; a += 6) {
      const x = Math.round(cx + r * Math.cos(a * Math.PI / 180));
      const y = Math.round(cy + r * Math.sin(a * Math.PI / 180));
      if (isLand(x, y)) return { dx: x - px, dy: y - py, dist: r };
    }
  }
  return null;
}

let sumDx = 0, sumDy = 0, n = 0, offLand = 0;
for (const m of probes) {
  const { px, py } = toPixel(m.x, m.y);
  const o = nearestLandOffset(px, py);
  if (!o) continue;
  if (o.dist > 0) offLand++;
  sumDx += o.dx; sumDy += o.dy; n++;
}

const meanDx = sumDx / n, meanDy = sumDy / n;
console.log(`\n${n} land-probe markers, ${offLand} currently off-land`);
console.log(`mean nearest-land offset: dx=${meanDx.toFixed(1)}px  dy=${meanDy.toFixed(1)}px  (of ${IMAGE})`);

// dx is +east on the image; image-x maps from world Y. dy is +south; image-y
// maps from world X inverted. Convert the pixel correction back to world units.
const worldYPerPx = (WORLD.maxY - WORLD.minY) / IMAGE;
const worldXPerPx = (WORLD.maxX - WORLD.minX) / IMAGE;
const dWorldY = meanDx * worldYPerPx;
const dWorldX = -meanDy * worldXPerPx; // py from top, world X inverted

console.log(`\nto move markers onto land, shift the WORLD window so pixels move by that mean:`);
console.log(`  minY,maxY -= ${(dWorldY).toFixed(0)}   (dx ${meanDx.toFixed(1)}px)`);
console.log(`  minX,maxX -= ${(dWorldX).toFixed(0)}   (dy ${meanDy.toFixed(1)}px)`);
console.log(`\nsuggested WORLD:`);
console.log(`const WORLD = { minX: ${Math.round(WORLD.minX - dWorldX)}, maxX: ${Math.round(WORLD.maxX - dWorldX)}, minY: ${Math.round(WORLD.minY - dWorldY)}, maxY: ${Math.round(WORLD.maxY - dWorldY)} };`);
