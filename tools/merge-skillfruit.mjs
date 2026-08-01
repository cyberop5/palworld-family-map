// merge-skillfruit.mjs — add skill fruit tree markers (Palpagos + Feybreak +
// Sky Islands/Sunreach).
//
// Skill fruit trees sit in fine-grained World Partition cells, so pulling them
// from game files would mean exporting the whole ~20 GB MainWorld folder. They
// also have no save flag (they respawn), so they can only ever be reference
// markers. Instead of the huge export, this uses in-game map coordinates —
// Palpagos from community guides (TheGamer + Destructoid, cross-checked);
// Feybreak (internal fruit id Fruits_DarkIsland_1) and Sky Islands/Sunreach
// (Fruits_SkyIsland_1) from exact "In-game" coordinate readouts the user
// captured directly from an interactive-map popup — and converts them into
// world coordinates through Palworld's own map formula.
//
// PalMap's map texture already covers all these regions in one continuous
// coordinate space (confirmed via the Tanzee/Depresso effigy markers already
// placed there — Depresso effigies sit within 60k units of every Sky Island
// tree below), so this is a single conversion, no second map image or
// switcher needed. Validated three ways: the Palpagos list against a
// fast-travel anchor (Mount Obsidian Anubis Statue FT converts to map
// (-540,-638), a guide tree sits at ~(-556,-620) right beside it); the
// Feybreak and Sky Island lists each round-trip exactly through the formula
// and land inside the existing image bounds.
//
// Idempotent — drops any existing skillFruit markers first.
//
// © Void Possum

import fs from 'node:fs';

// [map_x, map_y, region] — the coordinates the game shows on the map.
// Palpagos: matched pairs across the two guides are averaged; the four points
// only one guide listed are kept (better an approximate marker than a missing
// tree — they're reference markers the player confirms in-game).
const TREES = [
  // --- Palpagos (19) ---
  [204, -453, 'Grassy Behemoth Hills'],
  [-193, -520, 'Small Cove'],
  [146, -25, 'Sealed Realm of the Guardian'],
  [-246, -205, "Investigator's Fork"],
  [-15, -482, 'Small Settlement'],
  [-187, -403, 'Ascetic Falls'],
  [52, -51, 'Mount Flopie Summit'],
  [-453, -32, 'Forgotten Island Church Ruins'],
  [339, -39, 'Sealed Realm of the Swift'],
  [364, -320, 'Marsh Island Church Ruins'],
  [-556, -620, 'Mount Obsidian — Anubis Statue'],
  [-259, -624, 'Mount Obsidian — north'],
  [-625, -260, 'Ruined Fortress City'],
  [-40, -162, 'Lake Center'],
  [-39, 162, 'Moonless Shore'],
  [-151, 584, 'Land of Absolute Zero'],
  [184, 429, 'Duneshelter — west'],
  [339, 489, 'Duneshelter — east'],
  [295, 256, 'Sand Dunes Entrance'],

  // --- Feybreak (7) --- exact in-game coordinates from the user's screenshots.
  [-972, -921, 'Feybreak'],
  [-668, -932, 'Feybreak'],
  [-1408, -1027, 'Feybreak'],
  [-1251, -1399, 'Feybreak'],
  [-968, -1169, 'Feybreak'],
  [-872, -1472, 'Feybreak'],
  [-1423, -1673, 'Feybreak'],

  // --- Sky Islands / Sunreach (4) --- exact in-game coordinates from the
  // user's screenshots (internal fruit id Fruits_SkyIsland_1).
  [-555, -1295, 'Sky Islands'],
  [-385, -1352, 'Sky Islands'],
  [-417, -1376, 'Sky Islands'],
  [-543, -1432, 'Sky Islands'],
];

// Inverse of the in-game map formula:
//   map_x = (sav_y - 158000)/459   ->   sav_y = map_x*459 + 158000
//   map_y = (sav_x + 123888)/459   ->   sav_x = map_y*459 - 123888
const toSav = (mx, my) => ({ x: my * 459 - 123888, y: mx * 459 + 158000 });

const path = 'app/data/markers.json';
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

data.markers = data.markers.filter(m => m.category !== 'skillFruit');

let i = 0;
for (const [mx, my, region] of TREES) {
  const { x, y } = toSav(mx, my);
  data.markers.push({
    id: `skillFruit:${++i}`,
    category: 'skillFruit',
    key: `skillFruit_${i}`,
    label: `Skill Fruit Tree — ${region}`,
    x, y, z: 0,
  });
}

if (!data.categories.some(c => c.id === 'skillFruit')) {
  data.categories.push({ id: 'skillFruit', name: 'Skill Fruit', saveFlag: null });
}

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log(`added ${TREES.length} skill fruit trees (19 Palpagos + 7 Feybreak + 4 Sky Islands)`);
