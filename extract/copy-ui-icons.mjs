// Copy the official in-game compass icons used as map markers.
//
// These are the same glyphs the game draws on its own compass/HUD, so the map
// reads the way Palworld does. Identified from the contact sheet produced by
// extract/icon-sheet.mjs.
//
// Notes have no equivalent anywhere in the UI textures, so that one category
// keeps its hand-drawn SVG glyph in app.js.
//
// © Void Possum

import fs from 'node:fs';
import path from 'node:path';

const SRC = 'Output/Exports/Pal/Content/Pal/Texture/UI/InGame';
const OUT = 'app/data/icons/ui';

const ICONS = {
  fastTravel: 'T_icon_compass_FTtower.png',        // winged fast-travel emblem
  dungeon: 'T_icon_compass_dungeon.png',           // cave arch
  towerBoss: 'T_icon_compass_tower.png',           // syndicate tower crest
  itemPickup: 'T_icon_compass_Search_Treasure.png', // framed crate

  // Sidebar only. These categories draw per-Pal portraits on the map (which
  // tell you *which* Pal), but the category row needs one icon to stand for
  // the whole group.
  alphaPal: 'T_icon_compass_boss.png',
  cagedBoss: 'T_icon_compass_KeyBoss.png',
};

fs.mkdirSync(OUT, { recursive: true });

let bytes = 0, copied = 0;
for (const [category, file] of Object.entries(ICONS)) {
  const src = path.join(SRC, file);
  if (!fs.existsSync(src)) { console.warn(`! missing ${file} (${category})`); continue; }
  fs.copyFileSync(src, path.join(OUT, file));
  bytes += fs.statSync(path.join(OUT, file)).size;
  copied++;
  console.log(`${category.padEnd(12)} <- ${file}`);
}

console.log(`\ncopied ${copied} icons (${(bytes / 1024).toFixed(0)} KB) to ${OUT}`);
