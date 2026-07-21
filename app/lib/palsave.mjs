// Palworld .sav container: a small header wrapping an Oodle-compressed GVAS blob.
//
// Palworld v0.6+ uses the "PlM" magic (Oodle Kraken). Older saves used "PlZ"
// (zlib) — that's the format palworld-save-tools and most editors handle, and
// why they fail on current saves.
//
// © Void Possum

import { decompress } from 'ooz-wasm';
import { parseGvas, plain } from './gvas.mjs';

export function readHeader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawSize = view.getUint32(0, true);
  const compressedSize = view.getUint32(4, true);
  let magic = '';
  for (let i = 8; i < 12; i++) magic += String.fromCharCode(bytes[i]);
  return { rawSize, compressedSize, magic };
}

/** Decompress a .sav container to its raw GVAS bytes. */
export function decompressSave(bytes) {
  const { rawSize, compressedSize, magic } = readHeader(bytes);

  if (magic.startsWith('PlZ')) {
    throw new Error(
      'This is an older "PlZ" (zlib) save. PalMap currently handles the "PlM" ' +
      '(Oodle) format used by Palworld v0.6+.'
    );
  }
  if (!magic.startsWith('PlM')) {
    throw new Error(`Not a Palworld save file (magic=${JSON.stringify(magic)}).`);
  }

  const payload = bytes.subarray(12, 12 + compressedSize);
  const out = decompress(payload, rawSize);
  if (out.length !== rawSize) {
    throw new Error(`Decompressed ${out.length} bytes, expected ${rawSize}.`);
  }
  return out;
}

/** Full pipeline: .sav bytes -> parsed, unwrapped save data. */
export function parseSave(bytes) {
  const gvas = parseGvas(decompressSave(bytes));
  return { header: gvas.header, data: plain(gvas.properties), raw: gvas.properties };
}
