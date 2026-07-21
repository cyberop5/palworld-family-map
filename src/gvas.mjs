// Minimal GVAS (Unreal Engine save) reader.
// Only needs to handle Palworld *player* saves, which are plain GVAS — the
// Palworld-specific custom blobs all live in Level.sav, which we never touch.
//
// © Void Possum

const latin1 = bytes => {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
};

const KNOWN_STRUCTS = {
  Vector: r => ({ x: r.double(), y: r.double(), z: r.double() }),
  Rotator: r => ({ pitch: r.double(), yaw: r.double(), roll: r.double() }),
  Quat: r => ({ x: r.double(), y: r.double(), z: r.double(), w: r.double() }),
  Vector2D: r => ({ x: r.double(), y: r.double() }),
  IntPoint: r => ({ x: r.i32(), y: r.i32() }),
  LinearColor: r => ({ r: r.f32(), g: r.f32(), b: r.f32(), a: r.f32() }),
  Guid: r => r.guid(),
  DateTime: r => r.u64(),
  Timespan: r => r.u64(),
};

class Reader {
  constructor(buf) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    this.pos = 0;
  }
  get remaining() { return this.buf.length - this.pos; }
  bytes(n) { const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }
  u8() { return this.view.getUint8(this.pos++); }
  i32() { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  u32() { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  u16() { const v = this.view.getUint16(this.pos, true); this.pos += 2; return v; }
  i64() { const v = this.view.getBigInt64(this.pos, true); this.pos += 8; return Number(v); }
  u64() { const v = this.view.getBigUint64(this.pos, true); this.pos += 8; return v.toString(); }
  f32() { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  double() { const v = this.view.getFloat64(this.pos, true); this.pos += 8; return v; }
  bool() { return this.u8() !== 0; }
  guid() { return [...this.bytes(16)].map(b => b.toString(16).padStart(2, '0')).join(''); }

  fstring() {
    const len = this.i32();
    if (len === 0) return '';
    if (len < 0) {
      // UTF-16LE, length is in characters and includes the null terminator
      const chars = -len;
      const raw = this.bytes(chars * 2);
      let s = '';
      for (let i = 0; i < chars - 1; i++) s += String.fromCharCode(raw[i * 2] | (raw[i * 2 + 1] << 8));
      return s;
    }
    return latin1(this.bytes(len)).replace(/\0+$/, '');
  }

  // UE writes a flag byte; if set, a 16-byte property GUID follows.
  optionalGuid() { return this.u8() !== 0 ? this.guid() : null; }
}

// Read a bare value of `type` with no property tag around it (map keys/values,
// array elements). `structType` is only consulted for StructProperty.
function readBare(r, type, structType) {
  switch (type) {
    case 'IntProperty': case 'Int32Property': return r.i32();
    case 'Int64Property': return r.i64();
    case 'FloatProperty': return r.f32();
    case 'DoubleProperty': return r.double();
    case 'BoolProperty': return r.bool();
    case 'ByteProperty': return r.u8();
    case 'StrProperty': case 'NameProperty': return r.fstring();
    case 'EnumProperty': return r.fstring();
    case 'StructProperty': return readStructValue(r, structType);
    default: throw new Error(`readBare: unsupported type ${type}`);
  }
}

function readStructValue(r, structType) {
  const known = KNOWN_STRUCTS[structType];
  if (known) return known(r);
  return readProperties(r); // nested property list terminated by "None"
}

function readProperty(r, name) {
  const type = r.fstring();
  const size = r.i64();

  switch (type) {
    case 'StructProperty': {
      const structType = r.fstring();
      r.guid();          // struct id
      r.optionalGuid();  // property guid
      return { type, structType, value: readStructValue(r, structType) };
    }
    case 'ArrayProperty': {
      const arrayType = r.fstring();
      r.optionalGuid();
      const count = r.u32();
      if (arrayType === 'StructProperty') {
        // Struct arrays carry an inner property tag describing the element type.
        r.fstring();               // element name
        r.fstring();               // "StructProperty"
        r.i64();                   // inner size
        const structType = r.fstring();
        r.guid();
        r.optionalGuid();
        const items = [];
        for (let i = 0; i < count; i++) items.push(readStructValue(r, structType));
        return { type, arrayType, structType, value: items };
      }
      if (arrayType === 'ByteProperty') {
        return { type, arrayType, value: r.bytes(count) };
      }
      const items = [];
      for (let i = 0; i < count; i++) items.push(readBare(r, arrayType));
      return { type, arrayType, value: items };
    }
    case 'MapProperty': {
      const keyType = r.fstring();
      const valueType = r.fstring();
      r.optionalGuid();
      r.u32();                     // unknown / flags
      const count = r.u32();
      const entries = [];
      for (let i = 0; i < count; i++) {
        // Struct keys/values in maps don't record their struct type; Guid is
        // overwhelmingly the common case (same assumption palworld-save-tools makes).
        const key = readBare(r, keyType, 'Guid');
        const value = readBare(r, valueType, undefined);
        entries.push([key, value]);
      }
      return { type, keyType, valueType, value: entries };
    }
    case 'BoolProperty': {
      const value = r.bool();
      r.optionalGuid();
      return { type, value };
    }
    case 'EnumProperty': {
      const enumType = r.fstring();
      r.optionalGuid();
      return { type, enumType, value: r.fstring() };
    }
    case 'ByteProperty': {
      const enumName = r.fstring();
      r.optionalGuid();
      return { type, enumName, value: enumName === 'None' ? r.u8() : r.fstring() };
    }
    case 'IntProperty': case 'Int64Property': case 'FloatProperty':
    case 'DoubleProperty': case 'StrProperty': case 'NameProperty': {
      r.optionalGuid();
      return { type, value: readBare(r, type) };
    }
    default: {
      // Unknown type: skip its payload so the rest of the file still parses.
      return { type, value: r.bytes(size), skipped: true };
    }
  }
}

function readProperties(r) {
  const out = {};
  for (;;) {
    const name = r.fstring();
    if (name === 'None' || name === '') break;
    out[name] = readProperty(r, name);
  }
  return out;
}

export function parseGvas(buf) {
  const r = new Reader(buf);
  const magic = latin1(r.bytes(4));
  if (magic !== 'GVAS') throw new Error(`not a GVAS file (magic=${JSON.stringify(magic)})`);

  const header = { saveGameVersion: r.i32(), packageFileVersionUE4: r.i32() };
  if (header.saveGameVersion >= 3) header.packageFileVersionUE5 = r.i32();
  header.engineVersion = {
    major: r.u16(), minor: r.u16(), patch: r.u16(),
    changelist: r.u32(), branch: r.fstring(),
  };
  header.customFormatVersion = r.i32();
  const customCount = r.i32();
  header.customFormats = [];
  for (let i = 0; i < customCount; i++) header.customFormats.push({ id: r.guid(), value: r.i32() });
  header.saveGameClassName = r.fstring();

  return { header, properties: readProperties(r), bytesLeft: r.remaining };
}

// Unwrap the {type, value} envelope so callers can read plain data.
export function plain(node) {
  if (node === null || typeof node !== 'object') return node;
  if (node instanceof Uint8Array) return node;
  if (Array.isArray(node)) return node.map(plain);
  if ('type' in node && 'value' in node) return plain(node.value);
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = plain(v);
  return out;
}
