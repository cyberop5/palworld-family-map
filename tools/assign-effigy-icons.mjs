// Give each effigy the icon of the effigy it is.
//
// Effigy markers are stored by display name (Lamball Effigy, Munchill Effigy…),
// and app/data/icons/effigy/ holds a matching <Name>_Effigy_icon.webp for each.
// This points every effigy marker at its icon. Self-contained — it needs only
// the committed icons, no game-file export.
//
// © Void Possum

import fs from 'node:fs';

const EFFIGY_DIR = 'app/data/icons/effigy';
const path = 'app/data/markers.json';

const have = new Set(fs.readdirSync(EFFIGY_DIR));
const data = JSON.parse(fs.readFileSync(path, 'utf8'));

let tagged = 0;
const missing = new Map();

for (const m of data.markers) {
  if (m.category !== 'effigy') continue;

  // The generic relic blueprint has no variant suffix, so its label came out as
  // "C Effigy" — that one is the plain Lifmunk Effigy.
  let display = m.label.replace(/ Effigy$/, '').trim();
  if (display === 'C' || display === '') display = 'Lifmunk';
  m.label = `${display} Effigy`;

  const file = `${display}_Effigy_icon.webp`;
  if (have.has(file)) { m.icon = `effigy/${file}`; tagged++; }
  else missing.set(display, (missing.get(display) || 0) + 1);
}

const effigyCat = data.categories.find(c => c.id === 'effigy');
if (effigyCat) effigyCat.name = 'Effigy';

fs.writeFileSync(path, JSON.stringify(data, null, 2));
console.log(`effigies with an icon: ${tagged} / ${data.markers.filter(m => m.category === 'effigy').length}`);
if (missing.size) {
  console.log('\nno effigy icon for:');
  for (const [name, n] of missing) console.log(`  ${name} (${n}) — expected ${name}_Effigy_icon.webp`);
}
