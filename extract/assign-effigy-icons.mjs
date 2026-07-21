// Give each effigy the portrait of the Pal it depicts.
//
// markers.json stores effigies by display name (the L10N table was available when
// they were built), but the icon files are named with the game's internal
// codenames. This table bridges the two.
//
// © Void Possum

import fs from 'node:fs';
import path from 'node:path';

const ICONS_SRC = 'Output/Exports/Pal/Content/Pal/Texture/PalIcon/Normal';
const ICONS_OUT = 'app/data/icons';

// display name -> internal codename used by the icon files.
// The last two are inferred by elimination (Herbil=leaf, Munchill=chill); if they
// ever look swapped in game, swap them here.
const PAL_CODENAME = {
  Lifmunk: 'Carbunclo',
  Rooby: 'FlameBambi',
  Cattiva: 'PinkCat',
  Lamball: 'SheepBall',
  Pengullet: 'Penguin',
  Depresso: 'NegativeKoala',
  Tanzee: 'Monkey',
  Herbil: 'LeafMomonga',
  Munchill: 'IceCrocodile',
  Relaxaurus: 'LazyDragon',
  Lunaris: 'MoonChild',
};

const available = new Set(fs.readdirSync(ICONS_SRC));
const iconFor = display => {
  const code = PAL_CODENAME[display];
  if (!code) return null;
  const file = `T_${code}_icon_normal.png`;
  return available.has(file) ? file : null;
};

const data = JSON.parse(fs.readFileSync('app/data/markers.json', 'utf8'));
fs.mkdirSync(ICONS_OUT, { recursive: true });

const used = new Set();
const missing = new Map();
let tagged = 0;

for (const m of data.markers) {
  if (m.category !== 'effigy') continue;

  // The generic relic blueprint has no variant suffix, so its label came out as
  // "C Effigy" — that one is the plain Lifmunk Effigy.
  let display = m.label.replace(/ Effigy$/, '').trim();
  if (display === 'C' || display === '') display = 'Lifmunk';
  m.label = `${display} Effigy`;

  const icon = iconFor(display);
  if (icon) { m.icon = icon; used.add(icon); tagged++; }
  else missing.set(display, (missing.get(display) || 0) + 1);
}

for (const icon of used) fs.copyFileSync(path.join(ICONS_SRC, icon), path.join(ICONS_OUT, icon));

// 1.0 has twelve effigy types, so the category isn't "Lifmunk" specific — only
// the plain variant is. Individual markers keep their per-Pal label.
const effigyCat = data.categories.find(c => c.id === 'effigy');
if (effigyCat) effigyCat.name = 'Effigy';

console.log(`effigies with a portrait: ${tagged} / ${data.markers.filter(m => m.category === 'effigy').length}`);
console.log(`copied ${used.size} icons`);
if (missing.size) {
  console.log('\nno codename mapping for:');
  for (const [name, n] of missing) console.log(`  ${name} (${n})`);
}

data.generatedAt = new Date().toISOString();
fs.writeFileSync('app/data/markers.json', JSON.stringify(data));
