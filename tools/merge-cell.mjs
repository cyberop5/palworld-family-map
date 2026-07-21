// Merge markers out of a single World Partition cell export into markers.json.
//
// Cell files are self-contained (actors plus their components), so locations
// resolve without needing the persistent level. This lets us fill in categories
// one cell at a time instead of re-exporting everything.
//
// Usage: node extract/merge-cell.mjs <category> <cell.json>
//   e.g. node extract/merge-cell.mjs itemPickup Output/.../MainGrid_L15_X0_Y0_DLC881EFB3.json
//
// © Void Possum

import fs from 'node:fs';

const CATEGORIES = {
  itemPickup: {
    name: 'Item Pickup',
    saveFlag: 'ItemPickupObtainForInstanceFlag',
    match: t => /^BP_LevelObject_ItemPickup/.test(t),
    key: a => a.Properties?.LevelObjectInstanceId?.replace(/-/g, '').toLowerCase() || null,
    label: () => 'Item Pickup',
  },
  note: {
    name: 'Note',
    saveFlag: 'NoteObtainForInstanceFlag',
    match: t => t === 'BP_LevelObject_Note_C',
    key: a => a.Properties?.NoteRowName?.Key?.toLowerCase() || null,
    label: a => `Note: ${a.Properties?.NoteRowName?.Key || '?'}`,
  },
};

const [categoryId, cellPath] = process.argv.slice(2);
const category = CATEGORIES[categoryId];
if (!category || !cellPath) {
  console.error(`usage: node extract/merge-cell.mjs <${Object.keys(CATEGORIES).join('|')}> <cell.json>`);
  process.exit(1);
}
if (!fs.existsSync(cellPath)) {
  console.error(`no such file: ${cellPath}`);
  process.exit(1);
}

const cell = JSON.parse(fs.readFileSync(cellPath, 'utf8'));
const indexOf = objectPath => Number(String(objectPath).split('.').pop());

function locationOf(actor) {
  const ref = actor.Properties?.RootComponent || actor.Properties?.DefaultSceneRoot;
  if (!ref?.ObjectPath) return null;
  return cell[indexOf(ref.ObjectPath)]?.Properties?.RelativeLocation ?? null;
}

const markers = [];
let noKey = 0, noLoc = 0;
for (const actor of cell) {
  if (!actor.Type || !category.match(actor.Type)) continue;
  const key = category.key(actor);
  const loc = locationOf(actor);
  if (!key) { noKey++; continue; }
  if (!loc) { noLoc++; continue; }
  markers.push({
    id: `${categoryId}:${key}`,
    category: categoryId,
    key,
    label: category.label(actor),
    x: Math.round(loc.X), y: Math.round(loc.Y), z: Math.round(loc.Z ?? 0),
  });
}
console.log(`${markers.length} ${categoryId} markers (${noKey} without a key, ${noLoc} without a location)`);

const data = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));
const before = data.markers.length;
data.markers = data.markers.filter(m => m.category !== categoryId).concat(markers);
if (!data.categories.some(c => c.id === categoryId)) {
  data.categories.push({ id: categoryId, name: category.name, saveFlag: category.saveFlag });
}
data.stats = { ...data.stats, [categoryId]: markers.length };
data.generatedAt = new Date().toISOString();
fs.writeFileSync('app/data/markers.json', JSON.stringify(data));
console.log(`markers.json: ${before} -> ${data.markers.length}`);
