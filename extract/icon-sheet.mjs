// Throwaway: composite every compass icon into one labelled sheet so the
// numbered ones (T_icon_compass_00..16) can be identified by eye.
//
// Usage: node extract/icon-sheet.mjs
//
// © Void Possum

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const SRC = 'Output/Exports/Pal/Content/Pal/Texture/UI/InGame';
const CELL = 96;
const COLS = 8;

const files = fs.readdirSync(SRC).filter(f => /^T_icon_compass.*\.png$/i.test(f)).sort();
const rows = Math.ceil(files.length / COLS);
const out = new PNG({ width: COLS * CELL, height: rows * CELL });

// mid-grey backdrop so both white and dark icons stay visible
for (let i = 0; i < out.data.length; i += 4) {
  out.data[i] = 70; out.data[i + 1] = 74; out.data[i + 2] = 82; out.data[i + 3] = 255;
}

files.forEach((file, i) => {
  const img = PNG.sync.read(fs.readFileSync(path.join(SRC, file)));
  const ox = (i % COLS) * CELL, oy = Math.floor(i / COLS) * CELL;
  const scale = Math.min((CELL - 12) / img.width, (CELL - 12) / img.height);
  const w = Math.floor(img.width * scale), h = Math.floor(img.height * scale);
  const px = ox + ((CELL - w) >> 1), py = oy + ((CELL - h) >> 1);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const s = ((Math.floor(y / scale) * img.width) + Math.floor(x / scale)) << 2;
      const d = (((py + y) * out.width) + px + x) << 2;
      const a = img.data[s + 3] / 255;
      for (let c = 0; c < 3; c++) out.data[d + c] = img.data[s + c] * a + out.data[d + c] * (1 - a);
    }
  }
});

fs.mkdirSync('work', { recursive: true });
fs.writeFileSync('work/compass-icons.png', PNG.sync.write(out));

console.log(`${files.length} icons, ${COLS} per row:\n`);
files.forEach((f, i) => {
  const name = f.replace(/^T_icon_compass_?/, '').replace(/\.png$/, '') || '(base)';
  process.stdout.write(`${String(i).padStart(2)}:${name.padEnd(20)}`);
  if ((i + 1) % COLS === 0) process.stdout.write('\n');
});
console.log('\n\nwrote work/compass-icons.png');
