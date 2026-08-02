// name-dungeons.mjs — give dungeons their in-game name and level, and add the
// thirteen the persistent level doesn't list.
//
// build-markers.mjs names a dungeon after the blueprint suffix it was extracted
// from, so they shipped as "Grass1 Dungeon" and "Viking C Dungeon" — internal
// type names that appear nowhere in the game. The game calls them "Ravine
// Grotto" and "Feybreak Cavern", and shows a level, which is the one thing you
// actually want to know before dropping into one.
//
// The mapping is by type, not by position, because it turned out to be exactly
// that regular: cross-checking all 157 markers against paldb.cc's dungeon layer
// by in-game coordinate, every marker of a given internal type mapped to one
// and the same in-game name, with no exceptions and no splits. The three Viking
// variants are all Feybreak Cavern; everything else is one-to-one. So a table
// keyed on our own labels is both simpler and more robust than re-matching
// coordinates on every run.
//
// The thirteen extras are all Ravine Grotto, in the starter grass region.
// build-markers.mjs reads BP_DungeonPortalMarker actors out of the persistent
// level and finds 157, which matches the persistent level exactly — these
// thirteen simply are not in it. They are not duplicates of ones we have: the
// closest sits 29 map units from our nearest dungeon and most are 50–120 away,
// far outside anything that could be the same portal counted twice.
//
// Dungeons have no save flag (they reset), so these are reference markers and
// the synthetic keys below never need to join anything.
//
// Idempotent.
//
// © Void Possum

import fs from 'node:fs';

// Our extracted label -> what the game calls it. Levels are the dungeon's own,
// as shown in-game and on paldb.
const NAMES = {
  'Grass1 Dungeon': 'Ravine Grotto (Lv 14)',
  'Forest Dungeon': 'Mountain Stream Grotto (Lv 22)',
  'Volcano Dungeon': 'Volcanic Cavern (Lv 32)',
  'Desert Dungeon': 'Cavern of the Dunes (Lv 33)',
  'Snow Dungeon': 'Astral Mountains Cavern (Lv 39)',
  'Sakura Dungeon': 'Cherry Blossom Cave (Lv 40)',
  // The game itself shows this one as "???" — not a placeholder on our side.
  'Yakushima Dungeon': '??? (Lv 45)',
  'Viking Dungeon': 'Feybreak Cavern (Lv 50)',
  'Viking B Dungeon': 'Feybreak Cavern (Lv 50)',
  'Viking C Dungeon': 'Feybreak Cavern (Lv 50)',
  'Skyland Dungeon': 'Sunreach Skies (Lv 63)',
};

// [map_x, map_y] — Ravine Grotto portals missing from the persistent level.
const EXTRA_RAVINE = [
  [120, -426], [52, -525], [146, -400], [-15, -409], [20, -521],
  [8, -468], [7, -541], [92, -449], [-122, -339], [60, -433],
  [119, -377], [77, -469], [-185, -234],
];

const toSav = (mx, my) => ({ x: my * 459 - 123888, y: mx * 459 + 158000 });

const path = 'app/data/markers.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

// Re-runnable both ways: NAMES is keyed on the extracted labels, so build a
// reverse lookup too and let an already-named marker pass through unchanged.
const known = new Set(Object.values(NAMES));

const synthetic = /^dungeon_extra_/;
const existing = data.markers.filter(m => m.category === 'dungeon' && !synthetic.test(m.key));
data.markers = data.markers.filter(m => m.category !== 'dungeon');

let named = 0;
for (const m of existing) {
  const real = NAMES[m.label];
  if (real) { m.label = real; named++; }
  else if (!known.has(m.label)) console.warn(`  no in-game name for "${m.label}"`);
  data.markers.push(m);
}

EXTRA_RAVINE.forEach(([mx, my], i) => {
  const key = `dungeon_extra_${i + 1}`;
  const { x, y } = toSav(mx, my);
  data.markers.push({
    id: `dungeon:${key}`,
    category: 'dungeon',
    key,
    label: NAMES['Grass1 Dungeon'],
    x, y, z: 0,
  });
});

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log(`named ${named}/${existing.length} dungeons, added ${EXTRA_RAVINE.length} Ravine Grottos`);
