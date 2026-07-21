// Turn FModel's JSON exports into app/data/markers.json.
//
// Palworld's world is UE5 World Partition: a persistent level plus ~9,700
// streaming cells. Rather than scanning every cell (23 GB), we use the
// persistent level's SubObjectsToCellRemapping table as an index to find the
// handful of cells that actually hold collectibles.
//
// © Void Possum

import fs from 'node:fs';
import path from 'node:path';

const EXPORTS = 'Output/Exports/Pal/Content';
const MAPS = path.join(EXPORTS, 'Pal/Maps/MainWorld_5');
const CELLS = path.join(MAPS, 'PL_MainWorld5/_Generated_');
const L10N = path.join(EXPORTS, 'L10N/en/Pal/DataTable/Text');

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const rows = f => readJson(path.join(L10N, f))[0].Rows;
const text = (table, key) =>
  table[key]?.TextData?.LocalizedString || table[key]?.TextData?.SourceString || null;

const cellPath = name => path.join(CELLS, `${name}.json`);
const readCell = name => readJson(cellPath(name));

// --- label tables -----------------------------------------------------------
const respawnText = rows('DT_MapRespawnPointInfoText.json');
const commonText = rows('DT_UI_Common_Text_Common.json');
const noteText = rows('DT_NoteDescText.json');
const palNames = rows('DT_PalNameText_Common.json');

// --- location resolution ----------------------------------------------------
// A component's ObjectPath ends in its index within the file it came from,
// e.g. "...MainGrid_L15_X0_Y0_DL961A8730.409" -> index 409.
const indexOf = objectPath => Number(String(objectPath).split('.').pop());

function locationOf(actor, file) {
  const ref = actor.Properties?.RootComponent || actor.Properties?.DefaultSceneRoot;
  if (!ref?.ObjectPath) return null;
  const comp = file[indexOf(ref.ObjectPath)];
  const loc = comp?.Properties?.RelativeLocation;
  if (!loc) return null;
  return { x: loc.X, y: loc.Y, z: loc.Z ?? 0 };
}

const instanceId = actor =>
  actor.Properties?.LevelObjectInstanceId?.replace(/-/g, '').toLowerCase() || null;

// --- category definitions ---------------------------------------------------
// `key` is what joins a marker to a flag in the player save's RecordData.
const titleCase = s => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();

const CATEGORIES = [
  {
    id: 'effigy',
    name: 'Lifmunk Effigy',
    saveFlag: 'RelicObtainForInstanceFlag',
    cells: ['MainGrid_L15_X0_Y0_DL961A8730'],
    match: t => /^BP_LevelObject_Relic/.test(t),
    key: instanceId,
    label: a => {
      const variant = a.Type.replace(/^BP_LevelObject_Relic_?/, '').replace(/_C$/, '');
      if (!variant) return 'Lifmunk Effigy';
      const pal = text(palNames, `PAL_NAME_${variant}`);
      return pal ? `${pal} Effigy` : `${titleCase(variant)} Effigy`;
    },
  },
  {
    id: 'itemPickup',
    name: 'Item',
    saveFlag: 'ItemPickupObtainForInstanceFlag',
    cells: ['MainGrid_L15_X0_Y0_DLC881EFB3'],
    match: t => /^BP_LevelObject_ItemPickup/.test(t),
    key: instanceId,
    label: () => 'Item Pickup',
  },
  {
    id: 'note',
    name: 'Note',
    saveFlag: 'NoteObtainForInstanceFlag',
    cells: ['MainGrid_L15_X0_Y0_DLF89DD9AC'],
    persistent: true, // DLC-area notes also live in the persistent level
    match: t => t === 'BP_LevelObject_Note_C',
    key: a => a.Properties?.NoteRowName?.Key?.toLowerCase() || null,
    label: a => {
      const row = a.Properties?.NoteRowName?.Key;
      return row ? (text(noteText, row)?.split(/\r?\n/)[0].slice(0, 60) || `Note: ${row}`) : 'Note';
    },
  },
  {
    id: 'fastTravel',
    name: 'Fast Travel',
    saveFlag: 'FastTravelPointUnlockFlag',
    persistent: true,
    match: t => t === 'BP_LevelObject_TowerFastTravelPoint_C',
    key: instanceId,
    label: a => text(respawnText, a.Properties?.FastTravelPointID) || a.Properties?.FastTravelPointID || 'Fast Travel',
  },
  {
    id: 'towerBoss',
    name: 'Tower Boss',
    saveFlag: 'TowerBossDefeatFlag',
    persistent: true,
    match: t => /^BP_PalBossTower/.test(t),
    key: a => {
      const bossType = a.Properties?.BossType?.replace('EPalBossType::', '');
      return bossType ? `boss_battle_name_${bossType}`.toLowerCase() : null;
    },
    label: a => {
      const bossType = a.Properties?.BossType?.replace('EPalBossType::', '');
      return (bossType && text(commonText, `BOSS_BATTLE_NAME_${bossType}`)) || 'Tower Boss';
    },
  },
  {
    id: 'dungeon',
    name: 'Dungeon',
    persistent: true,
    match: t => /^BP_DungeonPortalMarker/.test(t),
    key: instanceId,
    label: a => `${titleCase(a.Type.replace(/^BP_DungeonPortalMarker_?/, '').replace(/_C$/, ''))} Dungeon`,
  },
];

// Field bosses are one blueprint per boss, scattered across many cells. The
// save keys off the name embedded in the type: BP_PalSpawner_Sheets_<KEY>_C.
const FIELD_BOSS_RE = /^BP_PalSpawner_Sheets_(.+?)_C$/;

// --- build ------------------------------------------------------------------
console.log('reading persistent level...');
const persistent = readJson(path.join(MAPS, 'PL_MainWorld5.json'));

const remapping = persistent.find(o => o.Type === 'WorldPartitionLevelStreamingPolicy')
  ?.Properties?.SubObjectsToCellRemapping || [];
console.log(`  ${persistent.length} objects, ${remapping.length} actors indexed world-wide`);

// actor type -> set of cells containing it
const cellsForType = new Map();
for (const { Key, Value } of remapping) {
  const type = Key.replace(/_UAID_.*$/, '');
  if (!cellsForType.has(type)) cellsForType.set(type, new Set());
  cellsForType.get(type).add(Value);
}

const markers = [];
const stats = {};

function harvest(file, category) {
  let n = 0;
  for (const actor of file) {
    if (!actor.Type || !category.match(actor.Type)) continue;
    const loc = locationOf(actor, file);
    const key = category.key(actor);
    if (!loc || !key) continue;
    markers.push({
      id: `${category.id}:${key}`,
      category: category.id,
      key,
      label: category.label(actor),
      x: Math.round(loc.x), y: Math.round(loc.y), z: Math.round(loc.z),
    });
    n++;
  }
  return n;
}

for (const category of CATEGORIES) {
  let n = 0;
  if (category.persistent) n += harvest(persistent, category);
  for (const cell of category.cells || []) {
    if (!fs.existsSync(cellPath(cell))) { console.warn(`  ! missing cell ${cell}`); continue; }
    n += harvest(readCell(cell), category);
  }
  stats[category.id] = n;
  console.log(`  ${category.id.padEnd(12)} ${n}`);
}

// Field bosses: gather the cells that contain any spawner blueprint, then read
// each one once and pull every field boss out of it.
console.log('reading field boss cells...');
const bossCells = new Set();
for (const [type, cells] of cellsForType) {
  if (FIELD_BOSS_RE.test(type)) for (const c of cells) bossCells.add(c);
}
let bossCount = 0, read = 0, missing = 0;
for (const cell of bossCells) {
  if (!fs.existsSync(cellPath(cell))) { missing++; continue; }
  const file = readCell(cell);
  read++;
  for (const actor of file) {
    const m = FIELD_BOSS_RE.exec(actor.Type || '');
    if (!m) continue;
    const loc = locationOf(actor, file);
    if (!loc) continue;
    const key = m[1].toLowerCase();
    if (markers.some(mk => mk.id === `fieldBoss:${key}`)) continue; // dedupe
    markers.push({
      id: `fieldBoss:${key}`, category: 'fieldBoss', key,
      label: `Field Boss: ${titleCase(m[1])}`,
      x: Math.round(loc.x), y: Math.round(loc.y), z: Math.round(loc.z),
    });
    bossCount++;
  }
}
stats.fieldBoss = bossCount;
console.log(`  read ${read}/${bossCells.size} cells (${missing} not exported) -> ${bossCount} field bosses`);

const out = {
  generatedAt: new Date().toISOString(),
  categories: CATEGORIES.map(c => ({ id: c.id, name: c.name, saveFlag: c.saveFlag || null }))
    .concat([{ id: 'fieldBoss', name: 'Field Boss', saveFlag: 'NormalBossDefeatFlag' }]),
  stats,
  markers,
};

fs.mkdirSync('app/data', { recursive: true });
fs.writeFileSync('app/data/markers.json', JSON.stringify(out));
console.log(`\nwrote app/data/markers.json — ${markers.length} markers`);
