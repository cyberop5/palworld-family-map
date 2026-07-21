// Rebuild field-boss markers from the spawner datatables and attach pal icons.
//
// The level geometry only contains boss spawners that were placed as actors, which
// misses the caged ("Imprisonment") bosses entirely. DT_PalSpawnerPlacement is the
// authoritative list — it carries a Location for every spawner — and
// DT_PalWildSpawner says which pal each one spawns, which also gives us the icon.
//
// Merges into app/data/markers.json rather than rebuilding it, so the level-derived
// categories survive.
//
// © Void Possum

import fs from 'node:fs';
import path from 'node:path';

const SPAWNER = 'Output/Exports/Pal/Content/Pal/DataTable/Spawner';
const ICONS_SRC = 'Output/Exports/Pal/Content/Pal/Texture/PalIcon/Normal';
const ICONS_OUT = 'app/data/icons';
const L10N = 'Output/Exports/Pal/Content/L10N/en/Pal/DataTable/Text';

const rows = p => JSON.parse(fs.readFileSync(p, 'utf8'))[0].Rows;

// Both are tracked by NormalBossDefeatFlag, but they're different things in game:
// FieldBoss is a roaming Alpha Pal, ImprisonmentBoss is one caged in a camp.
const CATEGORY_FOR = { FieldBoss: 'alphaPal', ImprisonmentBoss: 'cagedBoss' };
const BOSS_TYPES = new Set(Object.keys(CATEGORY_FOR));
const bare = t => String(t || '').replace(/.*::/, '');

// --- which pal does each spawner spawn --------------------------------------
const wild = Object.values(rows(path.join(SPAWNER, 'DT_PalWildSpawner.json')));
const spawnerInfo = new Map();
for (const r of wild) {
  const name = String(r.SpawnerName || '').toLowerCase();
  if (!name || !BOSS_TYPES.has(bare(r.SpawnerType))) continue;
  if (!spawnerInfo.has(name)) {
    spawnerInfo.set(name, { pal: r.Pal_1, level: r.LvMax_1 || r.LvMin_1, type: bare(r.SpawnerType) });
  }
}
console.log(`${spawnerInfo.size} boss spawners in DT_PalWildSpawner`);

// --- where is each one ------------------------------------------------------
const placements = Object.values(rows(path.join(SPAWNER, 'DT_PalSpawnerPlacement.json')));
const locations = new Map();
for (const p of placements) {
  const name = String(p.SpawnerName || '').toLowerCase();
  if (!name || !BOSS_TYPES.has(bare(p.SpawnerType)) || !p.Location) continue;
  if (!locations.has(name)) locations.set(name, p.Location);
}
console.log(`${locations.size} boss placements with a location`);

// --- readable pal names -----------------------------------------------------
let palNames = {};
const namesFile = path.join(L10N, 'DT_PalNameText_Common.json');
if (fs.existsSync(namesFile)) {
  palNames = rows(namesFile);
  console.log(`pal name table: ${Object.keys(palNames).length} rows`);
} else {
  console.log('! DT_PalNameText_Common not exported — falling back to internal codenames');
}
const titleCase = s => s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
const displayName = code => {
  const key = String(code).replace(/^BOSS_/i, '');
  const row = palNames[`PAL_NAME_${key}`] || palNames[key];
  return row?.TextData?.LocalizedString || row?.TextData?.SourceString || titleCase(key);
};

// --- icons ------------------------------------------------------------------
const available = new Set(fs.existsSync(ICONS_SRC) ? fs.readdirSync(ICONS_SRC) : []);
const iconFile = code => {
  const key = String(code).replace(/^BOSS_/i, '');
  for (const cand of [`T_${key}_icon_normal.png`, `T_${key}_icon.png`]) {
    if (available.has(cand)) return cand;
  }
  return null;
};

// --- build markers ----------------------------------------------------------
const markers = [];
const usedIcons = new Set();
let noLoc = 0;
for (const [name, info] of spawnerInfo) {
  const loc = locations.get(name);
  if (!loc) { noLoc++; continue; }
  const icon = iconFile(info.pal);
  if (icon) usedIcons.add(icon);
  const category = CATEGORY_FOR[info.type];
  markers.push({
    id: `${category}:${name}`,
    category,
    key: name,
    label: `${displayName(info.pal)}${info.level ? ` (Lv ${info.level})` : ''}`,
    icon: icon || null,
    caged: category === 'cagedBoss',
    x: Math.round(loc.X), y: Math.round(loc.Y), z: Math.round(loc.Z ?? 0),
  });
}
const count = c => markers.filter(m => m.category === c).length;
console.log(`built ${markers.length} boss markers (${noLoc} had no placement)`);
console.log(`  ${count('alphaPal')} alpha pals, ${count('cagedBoss')} caged, ${markers.filter(m => m.icon).length} with a portrait`);

// --- copy icons -------------------------------------------------------------
fs.mkdirSync(ICONS_OUT, { recursive: true });
let bytes = 0;
for (const icon of usedIcons) {
  fs.copyFileSync(path.join(ICONS_SRC, icon), path.join(ICONS_OUT, icon));
  bytes += fs.statSync(path.join(ICONS_OUT, icon)).size;
}
console.log(`copied ${usedIcons.size} icons (${(bytes / 1024).toFixed(0)} KB)`);

// --- merge ------------------------------------------------------------------
const CATEGORY_META = [
  { id: 'alphaPal', name: 'Alpha Pal', saveFlag: 'NormalBossDefeatFlag' },
  { id: 'cagedBoss', name: 'Caged Boss', saveFlag: 'NormalBossDefeatFlag' },
];

const data = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));
const before = data.markers.length;

// "fieldBoss" was the old combined category; drop it along with the new ones.
const replaced = new Set(['fieldBoss', ...CATEGORY_META.map(c => c.id)]);
data.markers = data.markers.filter(m => !replaced.has(m.category)).concat(markers);
data.categories = data.categories.filter(c => !replaced.has(c.id)).concat(CATEGORY_META);

delete data.stats.fieldBoss;
for (const c of CATEGORY_META) data.stats[c.id] = count(c.id);
data.generatedAt = new Date().toISOString();
fs.writeFileSync('app/data/markers.json', JSON.stringify(data));
console.log(`\nmarkers.json: ${before} -> ${data.markers.length}`);
