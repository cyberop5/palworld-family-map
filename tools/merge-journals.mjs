// merge-journals.mjs — give the notes their real titles, and add the six the
// export missed.
//
// build-markers.mjs and merge-notes.mjs place the notes but can only name them
// from their save row name, so they shipped as "Note — Grass Boss 1" and
// "Journal — Day 12-1". The game calls them "Zoe Rayne's Diary - 1" and
// "Castaway's Journal - Day 12-1". Since search matches on the label, the old
// names made a category of 55 readable, ordered diaries unsearchable by
// anything a player would actually type.
//
// The row-name → title mapping, and why it can be trusted
// -------------------------------------------------------
// Titles come from paldb.cc's Journals layer, matched to our markers by in-game
// map coordinate. All 49 existing notes paired, worst case 0.63 map units — and
// the result is not a scatter of coincidences but an exact, regular scheme:
//
//   grassbossN      -> Zoe Rayne's Diary - N        (5)
//   forestbossN     -> Lily Everhart's Diary - N    (3, + a letter as 4)
//   desertbossN     -> Marcus Dryden's Diary - N    (3)
//   snowbossN       -> Victor Ashford's Diary - N   (3)
//   volcanoboss1    -> Axel Travers' Diary - 1      (1)
//   vikingbossN     -> Bjorn Seligsson's Diary - N  (5)
//   sakurajimabossN -> Saya Kurosaki's Diary - N    (5)
//   dayN            -> Castaway's Journal - Day N   (23)
//
// Every region's notes are one author's numbered diary, and N matches. That is
// what licenses the six added below: the Sky Islands (internal name Sorajima)
// hold Auri's Diary 1–6, so they are sorajimaboss1–6. Two independent checks
// agree — a real save carries SorajimaBoss1 and SorajimaBoss5 under
// NoteObtainForInstanceFlag with no marker to join to, and paldb lists exactly
// six Auri entries.
//
// Titles are kept verbatim, including the game's own inconsistencies (curly vs
// straight apostrophes within the Bjorn set, and "Castaway's Journal Day 2"
// missing its dash). They are what the game prints; normalising them here would
// only make them stop matching what a player sees.
//
// Idempotent. Run after merge-notes.mjs.
//
// © Void Possum

import fs from 'node:fs';

// [title, map_x, map_y] — in-game map coordinates.
const JOURNALS = [
  ["Castaway's Journal - Day XX", 135, -471],
  ["Castaway's Journal - Day 0", -447, -292],
  ["Castaway's Journal - Day 1-1", 259, -522],
  ["Castaway's Journal - Day 1-2", 86, -459],
  ["Castaway's Journal Day 2", 238, -505],
  ["Castaway's Journal - Day 3", 189, -378],
  ["Castaway's Journal - Day 5", 162, 449],
  ["Castaway's Journal - Day 6", -234, -188],
  ["Castaway's Journal - Day 8", 64, -418],
  ["Castaway's Journal - Day 10", -19, -372],
  ["Castaway's Journal - Day 11", 122, -396],
  ["Castaway's Journal - Day 12-1", -170, -467],
  ["Castaway's Journal - Day 12-2", 111, 33],
  ["Castaway's Journal - Day 12-3", 184, 26],
  ["Castaway's Journal - Day 13", -564, -224],
  ["Castaway's Journal - Day 15", 312, -49],
  ["Castaway's Journal - Day 18", 34, -417],
  ["Castaway's Journal - Day 22", 495, 11],
  ["Castaway's Journal - Day 25", -725, -656],
  ["Castaway's Journal - Day 29", -405, -607],
  ["Castaway's Journal - Day 30", 289, 192],
  ["Castaway's Journal - Day 32", 512, 391],
  ["Castaway's Journal - Day 38", -263, -134],

  ["Zoe Rayne's Diary - 1", -4, -503],
  ["Zoe Rayne's Diary - 2", 168, -554],
  ["Zoe Rayne's Diary - 3", 126, -337],
  ["Zoe Rayne's Diary - 4", -397, -168],
  ["Zoe Rayne's Diary - 5", -359, -187],

  ["Lily Everhart's Diary - 1", -51, -216],
  ["Lily Everhart's Diary - 2", 218, -257],
  ["Lily Everhart's Diary - 3", -7, -265],
  ['A letter penned in crude handwriting:', -223, -135],

  ["Marcus Dryden's Diary - 1", 339, 363],
  ["Marcus Dryden's Diary - 2", 597, 330],
  ["Marcus Dryden's Diary - 3", 433, 535],

  ["Victor Ashford's Diary - 1", -88, 178],
  ["Victor Ashford's Diary - 2", -136, 587],
  ["Victor Ashford's Diary - 3", -187, 496],

  ["Axel Travers' Diary - 1", -668, -274],

  ['Bjorn Seligsson’s Diary - 1', -1079, -1315],
  ["Bjorn Seligsson's Diary - 2", -968, -1172],
  ['Bjorn Seligsson’s Diary - 3', -841, -1213],
  ['Bjorn Seligsson’s Diary - 4', -661, -938],
  ['Bjorn Seligsson’s Diary - 5', -1306, -1686],

  ["Saya Kurosaki's Diary - 1", -590, 203],
  ["Saya Kurosaki's Diary - 2", -484, 259],
  ["Saya Kurosaki's Diary - 3", -696, 84],
  ["Saya Kurosaki's Diary - 4", -627, 231],
  ["Saya Kurosaki's Diary - 5", -677, 229],
];

// The Sky Islands six, which no cell export covers. Keys follow the scheme
// established by every other region; see the header.
const SKY_ISLANDS = [
  ['sorajimaboss1', "Auri's Diary - 1", -250, -1420],
  ['sorajimaboss2', "Auri's Diary - 2", -239, -1480],
  ['sorajimaboss3', "Auri's Diary - 3", -583, -1499],
  ['sorajimaboss4', "Auri's Diary - 4", -437, -1510],
  ['sorajimaboss5', "Auri's Diary - 5", -454, -1329],
  ['sorajimaboss6', "Auri's Diary - 6", -561, -1341],
];

// The World Tree nine. Zenara's Diary follows the same author-per-region scheme
// as everywhere else, so 1–5 are worldtreeboss1–5 — the save confirms four of
// those five exist.
//
// The other four are a caveat. They are the plain `worldtree1`–`worldtree4`
// series (the save has worldtree1 and worldtree3), but nothing tells us which
// title is which number, so they're numbered in the order paldb lists the
// journals datatable. If a later export gives the real row names, fix them here;
// the cost of being wrong is only which of these four shows ticked, and only for
// a player who has some but not all.
const WORLD_TREE = [
  ['worldtree1', 'Audio Recording from a Council Meeting:', -53, 743],
  ['worldtree2', 'Suppression Operation Comms Log:', 41, 831],
  ['worldtree3', 'Ancient Recorder:', 108, 774],
  ['worldtree4', '(A scorched piece of paper)', -79, 762],
  ['worldtreeboss1', "Zenara's Diary - 1", -49, 792],
  ['worldtreeboss2', "Zenara's Diary - 2", 14, 775],
  ['worldtreeboss3', "Zenara's Diary - 3", -76, 854],
  ['worldtreeboss4', "Zenara's Diary - 4", -67, 706],
  ['worldtreeboss5', "Zenara's Diary - 5", -62, 803],
];

const toMap = m => [(m.y - 158000) / 459, (m.x + 123888) / 459];
const toSav = (mx, my) => ({ x: my * 459 - 123888, y: mx * 459 + 158000 });

// The World Tree is its own level with its own map origin and scale — 1334 world
// units per map unit, not 459. See the MAPS table in app/app.js.
const toSavTree = (mx, my) => ({ x: my * 1334 - 517733, y: mx * 1334 - 647509 });

// The closest two journals sit ~19 map units apart, so 4 is comfortably inside
// the gap while being six times the worst observed match distance.
const TOLERANCE = 4;

const path = 'app/data/markers.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

const added = new Set([...SKY_ISLANDS, ...WORLD_TREE].map(([key]) => key));
const existing = data.markers.filter(m => m.category === 'note' && !added.has(m.key));
data.markers = data.markers.filter(m => m.category !== 'note');

let named = 0;
const claimed = new Set();
for (const m of existing) {
  const [mx, my] = toMap(m);
  let best = -1;
  let bestDist = Infinity;
  JOURNALS.forEach(([, jx, jy], i) => {
    const d = Math.hypot(jx - mx, jy - my);
    if (d < bestDist) { bestDist = d; best = i; }
  });

  if (bestDist > TOLERANCE) {
    console.warn(`  no title within ${TOLERANCE} for ${m.key} (nearest ${bestDist.toFixed(1)})`);
  } else if (claimed.has(best)) {
    console.warn(`  ${JOURNALS[best][0]} claimed twice; leaving ${m.key} unnamed`);
  } else {
    claimed.add(best);
    m.label = JOURNALS[best][0];
    named++;
  }
  data.markers.push(m);
}

for (const [key, title, mx, my] of SKY_ISLANDS) {
  const { x, y } = toSav(mx, my);
  data.markers.push({ id: `note:${key}`, category: 'note', key, label: title, x, y, z: 0 });
}
for (const [key, title, mx, my] of WORLD_TREE) {
  const { x, y } = toSavTree(mx, my);
  data.markers.push({ id: `note:${key}`, category: 'note', key, label: title, x, y, z: 0 });
}

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log(`titled ${named}/${existing.length} notes, added ${SKY_ISLANDS.length} Sky Islands `
  + `and ${WORLD_TREE.length} World Tree journals`);
