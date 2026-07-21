// Phase 0 spike: prove we can read progression out of a real player save.
// Copies the save first so we never read a file the game may be mid-write on.
//
// Usage: node extract/spike-save.mjs [path-to-player.sav]
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
const workDir = 'work';
fs.mkdirSync(workDir, { recursive: true });
const copy = path.join(workDir, path.basename(src));

const mtimeBefore = fs.statSync(src).mtimeMs;
fs.copyFileSync(src, copy);

const { header, data } = parseSave(new Uint8Array(fs.readFileSync(copy)));

console.log(`save class : ${header.saveGameClassName}`);
console.log(`engine     : ${header.engineVersion.branch}`);

const record = data?.SaveData?.RecordData;
if (!record) {
  console.log('\nNo RecordData found. Top-level keys:', Object.keys(data).join(', '));
  process.exit(1);
}

console.log(`\n=== RecordData: ${Object.keys(record).length} fields ===\n`);

const summarise = value => {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Uint8Array) return `<${value.length} bytes>`;
  if (Array.isArray(value)) {
    if (value.length && Array.isArray(value[0]) && value[0].length === 2) {
      const truthy = value.filter(([, v]) => v === true || v === 1).length;
      return `map, ${value.length} entries (${truthy} true)`;
    }
    return `array, ${value.length} items`;
  }
  if (typeof value === 'object') return `object {${Object.keys(value).slice(0, 4).join(', ')}}`;
  return JSON.stringify(value);
};

for (const [name, value] of Object.entries(record)) {
  console.log(`${name.padEnd(42)} ${summarise(value)}`);
}

// The fields that drive auto-marking — show real sample keys so we can see
// whether they're readable names or opaque GUIDs.
const FOCUS = [
  'RelicObtainForInstanceFlag',
  'NoteObtainForInstanceFlag',
  'ItemPickupObtainForInstanceFlag',
  'FastTravelPointUnlockFlag',
  'TowerBossDefeatFlag',
  'NormalBossDefeatFlag',
  'RelicPossessNumMap',
];

console.log('\n\n=== Sample keys from the fields that matter ===');
for (const name of FOCUS) {
  const value = record[name];
  console.log(`\n--- ${name} ---`);
  if (!value) { console.log('  (absent)'); continue; }
  if (!Array.isArray(value)) { console.log('  ', summarise(value)); continue; }

  const truthy = value.filter(([, v]) => v === true || v === 1);
  console.log(`  ${value.length} entries, ${truthy.length} true`);
  for (const [k, v] of value.slice(0, 8)) {
    console.log(`    ${JSON.stringify(k)} = ${JSON.stringify(v)}`);
  }
}

console.log(`\n\nsource mtime unchanged: ${fs.statSync(src).mtimeMs === mtimeBefore}`);
