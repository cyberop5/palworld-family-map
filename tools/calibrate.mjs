// Verify the world -> map-image transforms.
//
// This used to fit the transforms by search. It no longer does, and that is
// deliberate: every search-based fit attempted here produced a confidently
// wrong answer that scored well. What follows is the transforms plus the
// evidence for them, and a check that re-runs on demand.
//
// The transforms
// --------------
// Palworld has two maps and says so itself — a save's RecordData carries
// UnlockedWorldMapFlags = { MainMap, Tree }. MainMap covers Palpagos plus both
// DLC island groups in one continuous coordinate space; the World Tree is a
// separate instanced level with its own texture, its own corner of world space,
// and its own in-game coordinate origin and scale.
//
// Orientation is fixed by geography on both: the image's horizontal axis is
// world Y (east positive), its vertical axis is world X inverted (north up).
// The scale is not free: both textures are square 8192px images, so the world
// region each covers is square too — the same world-units-per-pixel on both axes.
//
// Provenance, MainMap: paldb.cc publishes the same 8192px artwork as a tile
// pyramid and lists 867 markers with both their in-game coordinates and their
// position on it. A single uniform-scale affine fits all 867 to under 2px, and
// its two axis scales agree to 0.002%.
//
// Provenance, Tree: same idea, better data. Rather than paldb's *displayed*
// coordinates — which are rounded to integers, and at 32px per map unit that
// rounding alone is worth ±16px — the fit pairs the 15 fast travel points by
// name and uses our own exact world coordinates against paldb's tile positions.
// Max residual 0.05px over 15 points, axis scales agreeing to 0.0006%.
//
// Three traps, each of which produced a good-looking number
// ---------------------------------------------------------
// 1. The land mask was wrong. A colour heuristic tuned for Palpagos's greens
//    and browns silently misread Feybreak's dark blue-purple terrain as water,
//    and some open ocean as land, so every score computed against it was
//    meaningless while looking plausible. See isLand() below for what replaced
//    it — and note it is now per-texture, because the two textures hide their
//    off-map area in completely different ways.
// 2. A land-hit score is blind to sub-island drift, because a marker 40px off
//    is usually still comfortably on the same island. One re-fit of Palpagos
//    scored *higher* (97.9% vs 97.0%) while moving every Palpagos marker by up
//    to 44px. Land-hit can refute a transform; it cannot select one.
// 3. Per-region boxes were the wrong idea entirely. They were an attempt to
//    patch, landmass by landmass, a single global defect — the old MainMap box's
//    two axes differed by 0.75%, an error that is ~0 mid-map and grows to ~30px
//    out at the DLC islands. Fixing the scale fixed every region at once. Note
//    that the Tree map is *not* a fourth region: it is a genuinely separate
//    level, which is why it gets its own box and the DLC islands do not.
//
// So: the numbers come from the cross-references above, and this script's job is
// only to confirm they still hold against our own textures — including every
// effigy, which no fit has ever looked at.
//
// © Void Possum

import fs from 'node:fs';
import { PNG } from 'pngjs';

// Must match app/app.js.
const IMAGE = 8192;
const MAPS = [
  {
    id: 'palpagos',
    name: 'Palpagos + DLC islands',
    texture: 'app/data/T_WorldMap.png',
    world: { minX: -1099401, maxX: 349385, minY: -724397, maxY: 724389 },
    coordDiv: 459,
  },
  {
    id: 'worldTree',
    name: 'World Tree',
    texture: 'app/data/T_TreeMap.png',
    world: { minX: 347350, maxX: 689148, minY: -818197, maxY: -476399 },
    coordDiv: 1334,
  },
];

const R = 4;

// Land is either textured or bright.
//
// The grain test does the work: ocean on MainMap is a smooth gradient and the
// Tree map's off-map area is a literal flat fill of (13,21,27), while real
// terrain has visible noise. That alone is palette-independent, which is what
// the original colour heuristic — tuned for Palpagos greens, blind to Feybreak
// purples — was not.
//
// The brightness clause covers the one place grain isn't there: large flat
// expanses of snow and ice, on both maps, are smooth enough to score as low as
// 13. They are obviously land, and calling them water made real markers look
// misplaced. The two populations are nowhere near each other — everything
// off-map measures 20-60 average brightness, flat ice measures 186-204 — so 120
// sits in a very wide empty gap rather than on a tuned edge.
function isLand(png, x, y) {
  const i = (y * png.width + x) << 2;
  const brightness = (png.data[i] + png.data[i + 1] + png.data[i + 2]) / 3;
  return brightness >= 120 || variance(png, x, y) >= 15;
}

function variance(png, x, y) {
  let minR = 255, maxR = 0, minG = 255, maxG = 0, minB = 255, maxB = 0;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const i = ((y + dy) * png.width + (x + dx)) << 2;
      const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
      if (r < minR) minR = r; if (r > maxR) maxR = r;
      if (g < minG) minG = g; if (g > maxG) maxG = g;
      if (b < minB) minB = b; if (b > maxB) maxB = b;
    }
  }
  return (maxR - minR) + (maxG - minG) + (maxB - minB);
}

const { markers: allMarkers } = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));

// Same predicate the app uses to decide which map a marker belongs to.
const isWorldTree = m => m.x >= 400000 && m.y <= -500000;

// Categories that are guaranteed to stand on solid ground. Reference categories
// are excluded — a treasure map's dig site or a bounty target's patrol point can
// legitimately sit on a beach edge or a pier.
const PROBE_CATS = ['fastTravel', 'dungeon', 'towerBoss', 'ancientRuin', 'skillFruit'];

let failed = false;

for (const map of MAPS) {
  const mine = allMarkers.filter(m => (isWorldTree(m) ? map.id === 'worldTree' : map.id === 'palpagos'));
  if (!fs.existsSync(map.texture)) {
    console.log(`\n${map.name}: ${map.texture} missing — skipped`);
    continue;
  }

  console.log(`\n=== ${map.name} (${mine.length} markers) ===`);
  const png = PNG.sync.read(fs.readFileSync(map.texture));
  if (png.width !== png.height) {
    console.log(`WARNING: ${map.texture} is ${png.width}x${png.height}, not square.`);
  }

  const spanX = map.world.maxX - map.world.minX;
  const spanY = map.world.maxY - map.world.minY;
  if (spanX !== spanY) {
    console.log(`WARNING: box is not square (spanX ${spanX}, spanY ${spanY}).`);
    console.log('The texture is square, so the world region it covers must be too.');
  }
  console.log(`scale: ${(map.coordDiv * IMAGE / spanY).toFixed(6)} px per in-game map unit (both axes)`);

  const toPixel = m => [
    Math.round((m.y - map.world.minY) / spanY * IMAGE),
    Math.round((1 - (m.x - map.world.minX) / spanX) * IMAGE),
  ];
  const onLand = m => {
    const [x, y] = toPixel(m);
    if (x < R || y < R || x >= png.width - R || y >= png.height - R) return false;
    return isLand(png, x, y);
  };

  const report = (label, group) => {
    if (!group.length) return [];
    const miss = group.filter(m => !onLand(m));
    const ok = group.length - miss.length;
    console.log(`  ${label.padEnd(24)} ${ok}/${group.length}  ${((ok / group.length) * 100).toFixed(1)}%`);
    for (const m of miss) console.log(`      off-map: ${m.label} (${toPixel(m).join(',')})`);
    return miss;
  };

  console.log('land-guaranteed markers:');
  if (report('probes', mine.filter(m => PROBE_CATS.includes(m.category))).length) failed = true;

  console.log('held-out (never used to derive anything):');
  if (report('effigies', mine.filter(m => m.category === 'effigy')).length) failed = true;
  report('everything else', mine.filter(m => !PROBE_CATS.includes(m.category) && m.category !== 'effigy'));
}

console.log(failed
  ? '\nFAIL — something that should be on land is off the map.'
  : '\nOK — every land-guaranteed and held-out marker is on land.');

process.exitCode = failed ? 1 : 0;
