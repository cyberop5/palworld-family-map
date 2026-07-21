// Check how well markers.json joins to a real player save.
// Usage: node extract/verify-join.mjs [path-to-player.sav]
//
// © Void Possum

import fs from 'node:fs';
import path from 'node:path';
import { parseSave } from '../src/palsave.mjs';

const DEFAULT_SAVE = path.join(
  process.env.LOCALAPPDATA,
  'Pal/Saved/SaveGames/76561198012066907/8247F1A549B649D3FBD0EBB290B46020',
  'Players/00000000000000000000000000000001.sav'
);

const src = process.argv[2] || DEFAULT_SAVE;
fs.mkdirSync('work', { recursive: true });
const copy = path.join('work', path.basename(src));
fs.copyFileSync(src, copy);

const save = parseSave(new Uint8Array(fs.readFileSync(copy)));
const record = save.data.SaveData.RecordData;
const { categories, markers, stats } = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));

// Only GUID keys get their dashes stripped — note keys like "Day1-2" contain
// meaningful dashes and must be left alone.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/;
const normalise = k => {
  const s = String(k).toLowerCase();
  return GUID.test(s) ? s.replace(/-/g, '') : s;
};

// Since 1.0 each effigy variant is its own relic type, recorded in
// RelicObtainForInstanceFlagByType as { Type, Flags: [[key, bool], …] }. The
// flat list only holds the classic Lifmunk ones, so both shapes must be read.
const EXTRA_FLAGS = { effigy: ['RelicObtainForInstanceFlagByType'] };

function recordKeys(entry) {
  const out = [];
  if (!Array.isArray(entry)) return out;
  for (const item of entry) {
    if (Array.isArray(item)) {
      if (item[1] === true) out.push(item[0]);
    } else if (item && Array.isArray(item.Flags)) {
      for (const f of item.Flags) if (Array.isArray(f) && f[1] === true) out.push(f[0]);
    }
  }
  return out;
}

const flagSet = names => {
  const set = new Set();
  for (const name of [].concat(names)) for (const k of recordKeys(record[name])) set.add(normalise(k));
  return set;
};

console.log(`markers: ${markers.length}\n`);
console.log('category      markers   save-flags   matched   orphaned');
console.log('-'.repeat(60));

// Several categories can share one save flag (alpha pals and caged bosses both
// live in NormalBossDefeatFlag), so group by flag before scoring.
const byFlag = new Map();
for (const cat of categories) {
  if (!cat.saveFlag) continue;
  if (!byFlag.has(cat.saveFlag)) byFlag.set(cat.saveFlag, []);
  byFlag.get(cat.saveFlag).push(cat);
}

for (const [flag, cats] of byFlag) {
  const keys = new Set(markers.filter(m => cats.some(c => c.id === m.category)).map(m => m.key));
  const extra = cats.flatMap(c => EXTRA_FLAGS[c.id] || []);
  const flags = flagSet([flag, ...extra]);
  const matched = [...flags].filter(k => keys.has(k)).length;
  const orphaned = flags.size - matched;
  const warn = orphaned > 0 ? '  <-- unmatched save entries' : '';

  const label = cats.map(c => c.id).join(' + ');
  const total = markers.filter(m => cats.some(c => c.id === m.category)).length;
  console.log(
    `${label.padEnd(13)} ${String(total).padStart(7)}   ${String(flags.size).padStart(10)}   ` +
    `${String(matched).padStart(7)}   ${String(orphaned).padStart(8)}${warn}`
  );
}

for (const cat of categories.filter(c => !c.saveFlag)) {
  const n = markers.filter(m => m.category === cat.id).length;
  console.log(`${cat.id.padEnd(13)} ${String(n).padStart(7)}   ${'(no flag)'.padStart(10)}`);
}
