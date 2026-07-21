// Add the location categories that live in the persistent level.
//
// Run with extra heap — PL_MainWorld5.json is ~180 MB:
//   node --max-old-space-size=6144 extract/merge-locations.mjs
//
// The interesting one is the Watchtower. BP_LevelObject_UnlockMapPoint_C is the
// tower you activate to reveal a chunk of the map, and it carries a
// FastTravelPointID — so the game files it under FastTravelPointUnlockFlag just
// like a normal fast-travel statue. That is exactly why a real save had 10
// unlock flags with no marker to attach to: every one of them was a watchtower.
//
// © Void Possum

import fs from 'node:fs';
import path from 'node:path';

const EXPORTS = 'Output/Exports/Pal/Content';
const LEVEL = path.join(EXPORTS, 'Pal/Maps/MainWorld_5/PL_MainWorld5.json');
const L10N = path.join(EXPORTS, 'L10N/en/Pal/DataTable/Text');
const ICONS_SRC = path.join(EXPORTS, 'Pal/Texture/UI/InGame');
const ICONS_OUT = 'app/data/icons/ui';

const readJson = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const rows = f => readJson(path.join(L10N, f))[0].Rows;
const text = (table, key) =>
  table[key]?.TextData?.LocalizedString || table[key]?.TextData?.SourceString || null;

const respawnText = rows('DT_MapRespawnPointInfoText.json');

const titleCase = s => String(s).replace(/_/g, ' ').replace(/([a-z])([A-Z0-9])/g, '$1 $2').trim();
const indexOf = objectPath => Number(String(objectPath).split('.').pop());

function locationOf(actor, file) {
  const ref = actor.Properties?.RootComponent || actor.Properties?.DefaultSceneRoot
    || actor.Properties?.RootSceneComponent;
  if (!ref?.ObjectPath) return null;
  const loc = file[indexOf(ref.ObjectPath)]?.Properties?.RelativeLocation;
  return loc ? { x: loc.X, y: loc.Y, z: loc.Z ?? 0 } : null;
}

const instanceId = a =>
  a.Properties?.LevelObjectInstanceId?.replace(/-/g, '').toLowerCase() || null;

// `saveFlag: null` means the game doesn't track it per-instance — the marker is
// there for reference and can only be ticked by hand.
const CATEGORIES = [
  {
    id: 'watchtower',
    name: 'Watchtower',
    saveFlag: 'FastTravelPointUnlockFlag',
    icon: 'T_icon_compass_FTUnlockMap.png',
    match: t => t === 'BP_LevelObject_UnlockMapPoint_C',
    key: instanceId,
    label: a => {
      const id = a.Properties?.FastTravelPointID;
      return (id && text(respawnText, id)) || (id ? titleCase(id) : 'Watchtower');
    },
  },
  {
    id: 'treasureMap',
    name: 'Treasure Map',
    saveFlag: null,
    icon: 'T_icon_compass_TreasureMap_01.png',
    match: t => t === 'BP_LevelObject_TreasureMapPoint_C',
    key: instanceId,
    label: () => 'Treasure Map',
  },
  {
    id: 'warpPoint',
    name: 'Warp Point',
    saveFlag: null,
    icon: 'T_icon_compass_Teleport.png',
    match: t => /^BP_LevelObject_WarpPointDestination|^BP_DimensionWarpPoint_C$/.test(t),
    // Dimension warp points carry no instance id, so fall back to a positional
    // key. Nothing joins to these anyway.
    key: (a, i) => instanceId(a) || `warp${i}`,
    label: a => (a.Type === 'BP_DimensionWarpPoint_C' ? 'Dimensional Warp' : 'Warp Point'),
  },
  {
    id: 'respawnPoint',
    name: 'Respawn Point',
    saveFlag: null,
    icon: 'T_icon_compass_Teleport_Direction.png',
    match: t => t === 'BP_LevelObject_StaticRespawnPoint_C',
    key: (a, i) => instanceId(a) || `respawn${i}`,
    label: () => 'Respawn Point',
  },
];

console.log('reading persistent level (this takes a moment)...');
const level = readJson(LEVEL);
console.log(`  ${level.length} objects`);

const data = readJson('app/data/markers.json');
const ids = new Set(CATEGORIES.map(c => c.id));

// Drop any previous run's markers/categories for these ids so the script is
// safe to re-run.
data.markers = data.markers.filter(m => !ids.has(m.category));
data.categories = data.categories.filter(c => !ids.has(c.id));

for (const cat of CATEGORIES) {
  let n = 0, i = 0;
  for (const actor of level) {
    if (!actor.Type || !cat.match(actor.Type)) continue;
    const loc = locationOf(actor, level);
    const key = cat.key(actor, i++);
    if (!loc || !key) continue;
    data.markers.push({
      id: `${cat.id}:${key}`,
      category: cat.id,
      key,
      label: cat.label(actor),
      x: Math.round(loc.x), y: Math.round(loc.y), z: Math.round(loc.z),
    });
    n++;
  }
  data.categories.push({ id: cat.id, name: cat.name, saveFlag: cat.saveFlag });
  console.log(`  ${cat.id.padEnd(14)} ${String(n).padStart(4)}${cat.saveFlag ? '  -> ' + cat.saveFlag : ''}`);

  fs.mkdirSync(ICONS_OUT, { recursive: true });
  const src = path.join(ICONS_SRC, cat.icon);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(ICONS_OUT, cat.icon));
  else console.warn(`    ! icon missing: ${cat.icon}`);
}

data.generatedAt = new Date().toISOString();
fs.writeFileSync('app/data/markers.json', JSON.stringify(data));
console.log(`\nwrote app/data/markers.json — ${data.markers.length} markers`);
