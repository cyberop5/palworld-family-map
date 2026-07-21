// Merge note markers into markers.json.
//
// FModel can't bulk-export MainGrid_L15_X0_Y0_DLF89DD9AC (it throws a
// NullReferenceException), but its properties can still be read in the viewer.
// The data below was transcribed from that view: NoteRowName is the key the save
// uses in NoteObtainForInstanceFlag, and the location is the actor's
// DefaultSceneRoot RelativeLocation.
//
// © Void Possum

import fs from 'node:fs';

// [NoteRowName, x, y, z]
const NOTES = [
  ['Day5', 82137, 232164, 3489],
  ['VikingBoss1', -727251, -337205, 15489],
  ['VikingBoss2', -661788, -286540, 1422],
  ['VikingBoss3', -680766, -228163, 10056],
  ['VikingBoss4', -554410, -145172, 11009],
  ['VikingBoss5', -897682, -441227, 19692],
  ['DesertBoss2', 27732, 432083, 10364],
  ['DesertBoss3', 121473, 356848, 3927],
  ['GrassBoss2', -378068, 235014, -1951],
  ['GrassBoss3', -278642, 215976, -434],
  ['GrassBoss4', -201124, -24022, 3460],
  ['Day6', -210150, 50624, 22618],
  ['GrassBoss5', -209799, -6681, 12032],
  ['ForestBoss4', -185964, 55639, 994],
  ['Day11', -305819, 213787, 260],
  ['Day12-1', -338282, 79979, 1175],
  ['Day12-2', -108817, 209024, 7045],
  ['Day15', -146580, 301270, 3868],
  ['Day18', -315241, 173396, -1150],
  ['Day22', -118767, 385155, 705],
  ['Day30', -35730, 290460, -605],
  ['Day32', 55488, 392859, -609],
  ['SakurajimaBoss1', -30653, -112971, 4190],
  ['SakurajimaBoss5', -18656, -152534, 2280],
  ['SakurajimaBoss2', -5174, -64213, -1941],
  ['SakurajimaBoss3', -85253, -161408, -1876],
  ['SakurajimaBoss4', -18050, -129575, 5774],
  ['Day3', -297553, 244560, -1878],
  ['Day-xx', -340151, 219816, 5924],
  ['GrassBoss1', -354576, 156362, 7280],
  ['Day1-1', -363279, 276904, 7155],
  ['Day1-2', -334784, 197305, -231],
  ['Day2', -355892, 267443, 5634],
  ['Day8', -315601, 187182, 3268],
  ['Day38', -185327, 37273, 8536],
  ['ForestBoss3', -245569, 154862, 776],
  ['Day10', -294513, 149429, 180],
  ['Day29', -402455, -28051, 6122],
  ['Day25', -425136, -174719, 13963],
  ['VolcanoBoss1', -249441, -148443, 11962],
  ['Day13', -226550, -100794, -1152],
  ['Day0', -257843, -47223, 3714],
  ['ForestBoss1', -223190, 134498, 6786],
  ['ForestBoss2', -241933, 258174, -860],
  ['Day12-3', -111751, 242255, 18777],
  ['SnowBoss1', -42138, 117813, 7954],
  ['SnowBoss2', 145644, 95477, 41242],
  ['SnowBoss3', 103667, 72074, 41839],
  ['DesertBoss1', 42675, 313641, 1843],
];

// Journal entries are "Day…"; the rest are logs left at each boss arena.
const labelFor = row =>
  /^Day/i.test(row) ? `Journal — ${row.replace(/^Day/i, 'Day ')}` : `Note — ${row.replace(/([a-z])([A-Z0-9])/g, '$1 $2')}`;

const markers = NOTES.map(([row, x, y, z]) => ({
  id: `note:${row.toLowerCase()}`,
  category: 'note',
  key: row.toLowerCase(),
  label: labelFor(row),
  x, y, z,
}));

const data = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));
const before = data.markers.length;
data.markers = data.markers.filter(m => m.category !== 'note').concat(markers);
data.stats = { ...data.stats, note: markers.length };
data.generatedAt = new Date().toISOString();
fs.writeFileSync('app/data/markers.json', JSON.stringify(data));

console.log(`${markers.length} note markers`);
console.log(`markers.json: ${before} -> ${data.markers.length}`);
