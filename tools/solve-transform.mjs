// Solve the world -> map-image transform from region correspondences.
//
// The snow island and the desert island are unmistakable in the texture (white
// vs pink/tan). We know which fast-travel points sit on each. Matching the two
// centroids gives a clean two-point linear fit per axis, with no reliance on a
// hand-tuned land mask.
//
// © Void Possum

import fs from 'node:fs';
import { PNG } from 'pngjs';

const N = 1024;
const png = PNG.sync.read(fs.readFileSync('app/data/T_WorldMap.png'));
const step = png.width / N;
const px = (x, y) => {
  const i = (Math.floor(y * step) * png.width + Math.floor(x * step)) << 2;
  return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
};

function centroid(test) {
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    if (test(...px(x, y))) { sx += x; sy += y; n++; }
  }
  return n ? { u: sx / n / N, v: sy / n / N, n } : null;
}

// Snow: bright and near-neutral/blue-white.
const snow = centroid((r, g, b, a) => a > 200 && r > 165 && g > 175 && b > 185);
// Desert: bright, warm, red clearly above blue.
const desert = centroid((r, g, b, a) => a > 200 && r > 150 && r > b + 30 && g > b);

console.log(`snow   island: u=${snow.u.toFixed(4)} v=${snow.v.toFixed(4)} (${snow.n} px)`);
console.log(`desert island: u=${desert.u.toFixed(4)} v=${desert.v.toFixed(4)} (${desert.n} px)`);

const { markers } = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));
const find = label => markers.find(m => m.label === label);

const SNOW_POINTS = ['Land of Absolute Zero', 'Unthawable Lake', 'Icy Weasel Hill', 'Cold Shore',
                     'PAL Genetic Research Unit Tower Entrance'];
const DESERT_POINTS = ['Duneshelter', 'Deep Sand Dunes', 'Sand Dunes Entrance', 'PIDF Tower Entrance'];

const worldCentroid = labels => {
  const pts = labels.map(find).filter(Boolean);
  console.log(`  resolved ${pts.length}/${labels.length}: ${pts.map(p => p.label).join(', ')}`);
  return {
    x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
    y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
  };
};

console.log('\nsnow world centroid:');
const snowW = worldCentroid(SNOW_POINTS);
console.log('desert world centroid:');
const desertW = worldCentroid(DESERT_POINTS);
console.log(`  snow   world (${snowW.x.toFixed(0)}, ${snowW.y.toFixed(0)})`);
console.log(`  desert world (${desertW.x.toFixed(0)}, ${desertW.y.toFixed(0)})`);

// u is linear in world Y; v is linear in world X.
const a = (desert.u - snow.u) / (desertW.y - snowW.y);
const b = snow.u - a * snowW.y;
const c = (desert.v - snow.v) / (desertW.x - snowW.x);
const d = snow.v - c * snowW.x;

console.log(`\nu = ${a.toExponential(6)} * worldY + ${b.toFixed(6)}`);
console.log(`v = ${c.toExponential(6)} * worldX + ${d.toFixed(6)}`);
console.log(`scale ratio |c/a| = ${Math.abs(c / a).toFixed(4)}  (1.0 => square, uniform)`);

// Express as world bounds covering the full image, which is what the app wants.
const worldYAt = u => (u - b) / a;
const worldXAt = v => (v - d) / c;
const FIT = {
  minY: worldYAt(0), maxY: worldYAt(1),  // left / right edge of image
  maxX: worldXAt(0), minX: worldXAt(1),  // top / bottom edge (v inverted vs X)
};
console.log('\nworld box covering the whole 8192x8192 image:');
console.log(`  X ${FIT.minX.toFixed(0)} .. ${FIT.maxX.toFixed(0)}   (span ${(FIT.maxX - FIT.minX).toFixed(0)})`);
console.log(`  Y ${FIT.minY.toFixed(0)} .. ${FIT.maxY.toFixed(0)}   (span ${(FIT.maxY - FIT.minY).toFixed(0)})`);

console.log('\nPaste into app.js:');
console.log(`const WORLD = { minX: ${FIT.minX.toFixed(0)}, maxX: ${FIT.maxX.toFixed(0)}, minY: ${FIT.minY.toFixed(0)}, maxY: ${FIT.maxY.toFixed(0)} };`);

fs.writeFileSync('work/transform.json', JSON.stringify(FIT, null, 2));
