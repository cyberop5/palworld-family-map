// Read the pins the player dropped on the in-game map, out of LocalData.sav.
//
// Why this isn't just parseSave()
// -------------------------------
// LocalData.sav is a normal PlM container holding normal GVAS, and gvas.mjs
// gets most of the way through it — but not all the way: somewhere in the 5.4 MB
// of cached character data it hits a property shape it mishandles and throws.
// Hardening the general parser against a file we want exactly one field from
// would be a lot of work aimed at the wrong target, and every byte of that work
// would be re-litigated on the next Palworld patch.
//
// So this reads only what it needs. The pin array lives at about 96% of the way
// through the file, past everything that trips the parser, and its shape is
// plain and stable:
//
//   Local_CustomMarkerSaveData : ArrayProperty of StructProperty
//     PalCustomMarkerSaveData
//       IconLocation : StructProperty "Vector"  -> 3 × float64
//       IconType     : IntProperty
//
// Finding each IconLocation by name and reading the Vector after it needs no
// knowledge of the array header or of anything else in the file. The 17 skipped
// bytes are the standard UE struct preamble — a 16-byte struct GUID and a
// terminator — which is fixed by the engine, not by Palworld.
//
// Everything here fails soft. This is a garnish on the map; if the format moves,
// the right outcome is no pins, not a broken page.
//
// © Void Possum

import { decompressSave } from './palsave.mjs';

const ARRAY_NAME = 'Local_CustomMarkerSaveData';
const STRUCT_PREAMBLE = 17;   // struct GUID (16) + terminator (1)

// Guards against a mis-parse silently placing pins in absurd places. The whole
// playable world sits inside ±2,000,000 units on both axes.
const LIMIT = 2_000_000;

const asLatin1 = bytes => {
  let out = '';
  // Chunked so a multi-megabyte save doesn't blow the argument limit.
  for (let i = 0; i < bytes.length; i += 32768) {
    out += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  }
  return out;
};

export function readCustomPins(bytes) {
  let data;
  try { data = decompressSave(bytes); }
  catch { return []; }

  const text = asLatin1(data);
  const start = text.indexOf(ARRAY_NAME);
  if (start < 0) return [];

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const pins = [];
  let i = start;

  for (;;) {
    const name = text.indexOf('IconLocation', i);
    if (name < 0) break;
    const vec = text.indexOf('Vector', name);
    // "Vector" always follows within one short property header; anything
    // further away means we've walked off the end of the array.
    if (vec < 0 || vec - name > 90) break;

    const at = vec + 'Vector'.length + 1 + STRUCT_PREAMBLE;
    if (at + 24 > data.length) break;

    const x = view.getFloat64(at, true);
    const y = view.getFloat64(at + 8, true);
    if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < LIMIT && Math.abs(y) < LIMIT) {
      pins.push({ x, y });
    }
    i = vec + 'Vector'.length;
  }

  return pins;
}
