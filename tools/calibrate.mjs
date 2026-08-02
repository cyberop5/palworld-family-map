// Verify the world -> map-image transform.
//
// This used to fit the transform by search. It no longer does, and that is
// deliberate: every search-based fit attempted here produced a confidently
// wrong answer that scored well. What follows is the transform plus the
// evidence for it, and a check that re-runs on demand.
//
// The transform
// -------------
// T_WorldMap covers the whole game world — Palpagos plus both DLC island
// groups — in one continuous coordinate space at one scale. Orientation is
// fixed by geography: the image's horizontal axis is world Y (east positive),
// its vertical axis is world X inverted (north up). The scale is not free:
// T_WorldMap is a square 8192px texture, so the world region it covers is
// square too — the same world-units-per-pixel on both axes.
//
// Provenance: paldb.cc publishes the same 8192px artwork as a tile pyramid
// (512px tiles, max native zoom 4) and lists 867 markers with both their
// in-game coordinates and their position on it. A single uniform-scale affine
// fits all 867 to under 2px, and its two axis scales agree to 0.002% — which
// is the square-texture constraint above, confirmed from an independent
// working implementation rather than assumed. WORLD below is that transform
// expressed as a world-coordinate box.
//
// Three traps, each of which produced a good-looking number
// ---------------------------------------------------------
// 1. The land mask was wrong. A colour heuristic tuned for Palpagos's greens
//    and browns silently misread Feybreak's dark blue-purple terrain as water,
//    and some open ocean as land, so every score computed against it was
//    meaningless while looking plausible. isLand() below tests local texture
//    *variance* instead — water, deep or shallow, is a near-flat gradient;
//    every real landmass has grain — which works regardless of palette.
// 2. A land-hit score is blind to sub-island drift, because a marker 40px off
//    is usually still comfortably on the same island. One re-fit of Palpagos
//    scored *higher* (97.9% vs 97.0%) while moving every Palpagos marker by up
//    to 44px. Land-hit can refute a transform; it cannot select one.
// 3. Per-region boxes were the wrong idea entirely. They were an attempt to
//    patch, landmass by landmass, a single global defect — the old box's two
//    axes differed by 0.75%, an error that is ~0 mid-map and grows to ~30px
//    out at the DLC islands. Fixing the scale fixed every region at once.
//
// So: the numbers come from the 867-marker cross-reference, and this script's
// job is only to confirm they still hold against our own texture — including
// 360 effigies that no fit has ever looked at.
//
// © Void Possum

import fs from 'node:fs';
import { PNG } from 'pngjs';

// Must match app/app.js.
const WORLD = { minX: -1099401, maxX: 349385, minY: -724397, maxY: 724389 };
const IMAGE = 8192;

console.log('decoding map texture…');
const png = PNG.sync.read(fs.readFileSync('app/data/T_WorldMap.png'));
const PW = png.width, PH = png.height;

const R = 4;
function isLand(x, y) {
  if (x < R || y < R || x >= PW - R || y >= PH - R) return false;
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const i = ((y + dy) * PW + (x + dx)) << 2;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (g < minG) minG = g; if (g > maxG) maxG = g;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
    }
  }
  return (maxR - minR) + (maxG - minG) + (maxB - minB) >= 15;
}

const { markers: allMarkers } = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));

// The World Tree is a separate instanced map (its own T_TreeMap texture) in an
// isolated corner of world space. Nothing there belongs on T_WorldMap.
const isWorldTree = m => m.x >= 400000 && m.y <= -500000;
const markers = allMarkers.filter(m => !isWorldTree(m));
console.log(`${allMarkers.length - markers.length} World Tree markers excluded`);

const spanX = WORLD.maxX - WORLD.minX, spanY = WORLD.maxY - WORLD.minY;
if (spanX !== spanY) {
  console.log(`\nWARNING: box is not square (spanX ${spanX}, spanY ${spanY}).`);
  console.log('The texture is square, so the world region it covers must be too.');
}
const toPixel = m => [
  Math.round((m.y - WORLD.minY) / spanY * IMAGE),
  Math.round((1 - (m.x - WORLD.minX) / spanX) * IMAGE),
];

// Landmass predicates are for REPORTING ONLY — they score each landmass
// separately so a regression confined to one can't hide inside a healthy
// global average. They do not select a transform; there is only one.
const isFeybreak = m => m.x >= -1050000 && m.x <= -495000 && m.y >= -650000 && m.y <= -120000;
const isSkyIslands = m => m.x >= -860000 && m.x <= -700000 && m.y >= -120000 && m.y <= 80000;
const PROBE_CATS = ['fastTravel', 'dungeon', 'towerBoss', 'skillFruit'];

let failed = false;
const report = (label, group) => {
  const miss = group.filter(m => !isLand(...toPixel(m)));
  const ok = group.length - miss.length;
  console.log(`  ${label.padEnd(24)} ${ok}/${group.length}  ${((ok / group.length) * 100).toFixed(1)}%`);
  return miss;
};

console.log(`\nscale: ${(459 * IMAGE / spanY).toFixed(6)} px per in-game map unit (both axes)`);
console.log('\nland-guaranteed markers, per landmass:');
for (const [label, pred] of [
  ['Palpagos', m => !isFeybreak(m) && !isSkyIslands(m)],
  ['Feybreak', isFeybreak],
  ['Sky Islands', isSkyIslands],
]) {
  const miss = report(label, markers.filter(m => pred(m) && PROBE_CATS.includes(m.category)));
  if (miss.length) failed = true;
  for (const m of miss) console.log(`      in water: ${m.label} (${toPixel(m).join(',')})`);
}

console.log('\nheld-out (never used to derive anything):');
const effMiss = report('effigies', markers.filter(m => m.category === 'effigy'));
if (effMiss.length) failed = true;
for (const m of effMiss) console.log(`      in water: ${m.label} (${toPixel(m).join(',')})`);
report('all non-note markers', markers.filter(m => m.category !== 'note'));

console.log(failed
  ? '\nFAIL — something that should be on land is in open water.'
  : '\nOK — every land-guaranteed and held-out marker is on land.');

// --- overlay, so the fit can also be judged by eye --------------------------
fs.mkdirSync('work', { recursive: true });
const OUT = 2048, STEP = PW / OUT;
const out = new PNG({ width: OUT, height: OUT });
for (let y = 0; y < OUT; y++) for (let x = 0; x < OUT; x++) {
  const i = (Math.floor(y * STEP) * PW + Math.floor(x * STEP)) << 2;
  const o = (y * OUT + x) << 2;
  out.data[o] = png.data[i]; out.data[o + 1] = png.data[i + 1];
  out.data[o + 2] = png.data[i + 2]; out.data[o + 3] = 255;
}
for (const m of markers.filter(m => PROBE_CATS.includes(m.category))) {
  const [px, py] = toPixel(m);
  const cx = Math.round(px / STEP), cy = Math.round(py / STEP);
  const col = m.category === 'skillFruit' ? [80, 220, 255]
    : m.category === 'towerBoss' ? [255, 60, 60] : [255, 235, 40];
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x < 0 || y < 0 || x >= OUT || y >= OUT) continue;
    const i = (y * OUT + x) << 2;
    out.data[i] = col[0]; out.data[i + 1] = col[1]; out.data[i + 2] = col[2];
  }
}
fs.writeFileSync('work/calibration-overlay.png', PNG.sync.write(out));
console.log('wrote work/calibration-overlay.png');

process.exitCode = failed ? 1 : 0;
