// Read-only family stats extractor over Palworld save files (Level.sav,
// LevelMeta.sav, Players/*.sav). Uses ooz-wasm directly so it runs in Node
// with zero external dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { decompress } from '../vendor/ooz-wasm/index.js';
import { parseGvas, plain } from './gvas.mjs';

function decompressSav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const rawSize = view.getUint32(0, true);
  const compressedSize = view.getUint32(4, true);
  let magic = '';
  for (let i = 8; i < 12; i++) magic += String.fromCharCode(bytes[i]);
  if (!magic.startsWith('PlM')) {
    throw new Error(`Unsupported save magic: ${magic}`);
  }
  const out = decompress(bytes.subarray(12, 12 + compressedSize), rawSize);
  if (out.length !== rawSize) {
    throw new Error(`Decompressed ${out.length} bytes, expected ${rawSize}`);
  }
  return out;
}

class Reader {
  constructor(b, pos = 0) {
    this.b = b;
    this.dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    this.pos = pos;
  }
  u8() { return this.b[this.pos++]; }
  i32() { const v = this.dv.getInt32(this.pos, true); this.pos += 4; return v; }
  u32() { const v = this.dv.getUint32(this.pos, true); this.pos += 4; return v; }
  i64() { const v = this.dv.getBigInt64(this.pos, true); this.pos += 8; return Number(v); }
  u64() { const v = this.dv.getBigUint64(this.pos, true); this.pos += 8; return v.toString(); }
  f32() { const v = this.dv.getFloat32(this.pos, true); this.pos += 4; return v; }
  dbl() { const v = this.dv.getFloat64(this.pos, true); this.pos += 8; return v; }
  bool() { return this.u8() !== 0; }
  bytes(n) { const s = this.b.subarray(this.pos, this.pos + n); this.pos += n; return s; }
  guid() {
    let s = '';
    for (let i = 0; i < 16; i++) s += this.b[this.pos++].toString(16).padStart(2, '0');
    return s;
  }
  optGuid() { return this.u8() ? this.guid() : null; }
  fstring() {
    const len = this.i32();
    if (len === 0) return '';
    if (len < 0) {
      const c = -len;
      let s = '';
      for (let i = 0; i < c - 1; i++) {
        s += String.fromCharCode(this.dv.getUint16(this.pos + i * 2, true));
      }
      this.pos += c * 2;
      return s;
    }
    let s = '';
    for (let i = 0; i < len - 1; i++) s += String.fromCharCode(this.b[this.pos + i]);
    this.pos += len;
    return s;
  }
}

const KNOWN_STRUCTS = {
  Vector: r => ({ x: r.dbl(), y: r.dbl(), z: r.dbl() }),
  Rotator: r => ({ pitch: r.dbl(), yaw: r.dbl(), roll: r.dbl() }),
  Quat: r => ({ x: r.dbl(), y: r.dbl(), z: r.dbl(), w: r.dbl() }),
  Vector2D: r => ({ x: r.dbl(), y: r.dbl() }),
  IntPoint: r => ({ x: r.i32(), y: r.i32() }),
  LinearColor: r => ({ r: r.f32(), g: r.f32(), b: r.f32(), a: r.f32() }),
  Guid: r => r.guid(),
  DateTime: r => r.u64(),
  Timespan: r => r.u64(),
};

function readBare(r, type, structType) {
  switch (type) {
    case 'IntProperty': case 'Int32Property': return r.i32();
    case 'UInt32Property': return r.u32();
    case 'Int64Property': return r.i64();
    case 'UInt64Property': return r.u64();
    case 'FloatProperty': return r.f32();
    case 'DoubleProperty': return r.dbl();
    case 'BoolProperty': return r.bool();
    case 'ByteProperty': return r.u8();
    case 'StrProperty': case 'NameProperty': case 'EnumProperty': return r.fstring();
    case 'StructProperty': return KNOWN_STRUCTS[structType] ? KNOWN_STRUCTS[structType](r) : readProperties(r);
    default: throw new Error(`Unsupported bare property type: ${type}`);
  }
}

function readProperty(r) {
  const type = r.fstring();
  const size = r.i64();
  switch (type) {
    case 'StructProperty': {
      const st = r.fstring();
      r.guid();
      r.optGuid();
      return KNOWN_STRUCTS[st] ? KNOWN_STRUCTS[st](r) : readProperties(r);
    }
    case 'ArrayProperty': {
      const at = r.fstring();
      r.optGuid();
      const count = r.u32();
      if (at === 'StructProperty') {
        r.fstring();
        r.fstring();
        r.i64();
        const st = r.fstring();
        r.guid();
        r.optGuid();
        const items = [];
        for (let i = 0; i < count; i++) {
          items.push(KNOWN_STRUCTS[st] ? KNOWN_STRUCTS[st](r) : readProperties(r));
        }
        return items;
      }
      if (at === 'ByteProperty') return r.bytes(count);
      const items = [];
      for (let i = 0; i < count; i++) items.push(readBare(r, at));
      return items;
    }
    case 'MapProperty': {
      const kt = r.fstring();
      const vt = r.fstring();
      r.optGuid();
      r.u32();
      const count = r.u32();
      const entries = [];
      for (let i = 0; i < count; i++) {
        entries.push([readBare(r, kt, 'Guid'), readBare(r, vt, undefined)]);
      }
      return entries;
    }
    case 'SetProperty': {
      const et = r.fstring();
      r.optGuid();
      r.u32();
      const count = r.u32();
      const items = [];
      for (let i = 0; i < count; i++) items.push(readBare(r, et, 'Guid'));
      return items;
    }
    case 'BoolProperty': { const v = r.bool(); r.optGuid(); return v; }
    case 'EnumProperty': { r.fstring(); r.optGuid(); return r.fstring(); }
    case 'ByteProperty': {
      const en = r.fstring();
      r.optGuid();
      return en === 'None' ? r.u8() : r.fstring();
    }
    case 'IntProperty': case 'Int32Property': case 'UInt32Property':
    case 'Int64Property': case 'UInt64Property': case 'FloatProperty':
    case 'DoubleProperty': case 'StrProperty': case 'NameProperty': {
      r.optGuid();
      return readBare(r, type);
    }
    default: {
      r.optGuid();
      return r.bytes(size);
    }
  }
}

function readProperties(r) {
  const out = {};
  for (;;) {
    const name = r.fstring();
    if (name === 'None' || name === '') break;
    out[name] = readProperty(r);
  }
  return out;
}

function parseMapSlice(buf, keyStruct, valStruct) {
  const mr = new Reader(buf);
  mr.u32();
  const count = mr.u32();
  const out = [];
  for (let i = 0; i < count; i++) {
    const k = keyStruct ? readProperties(mr) : mr.guid();
    const v = valStruct ? readProperties(mr) : mr.guid();
    out.push([k, v]);
  }
  return out;
}

function extractWorldSlices(buf, targetNames) {
  const r = new Reader(buf);
  r.pos += 4; // GVAS
  const sgv = r.i32();
  r.i32(); // ue4
  if (sgv >= 3) r.i32(); // ue5
  r.pos += 10; // engine ver
  r.fstring(); // branch
  r.i32(); // customFormatVersion
  const cc = r.i32();
  r.pos += cc * 20;
  r.fstring(); // saveGameClassName

  const slices = {};
  while (r.pos < buf.length) {
    const n = r.fstring();
    if (n === 'None' || n === '') break;
    const t = r.fstring();
    const sz = r.i64();
    if (n === 'worldSaveData') {
      r.fstring();
      r.guid();
      r.optGuid();
      while (r.pos < buf.length) {
        const n2 = r.fstring();
        if (n2 === 'None' || n2 === '') break;
        const t2 = r.fstring();
        const s2 = r.i64();
        if (t2 === 'StructProperty') { r.fstring(); r.guid(); r.optGuid(); }
        else if (t2 === 'ArrayProperty') { r.fstring(); r.optGuid(); }
        else if (t2 === 'MapProperty') { r.fstring(); r.fstring(); r.optGuid(); }
        else if (t2 === 'SetProperty') { r.fstring(); r.optGuid(); }
        else if (t2 === 'BoolProperty') { r.u8(); r.optGuid(); }
        else if (t2 === 'EnumProperty' || t2 === 'ByteProperty') { r.fstring(); r.optGuid(); }
        else { r.optGuid(); }
        if (targetNames.has(n2)) slices[n2] = r.bytes(s2);
        else r.pos += s2;
      }
      break;
    } else {
      if (t === 'StructProperty') { r.fstring(); r.guid(); r.optGuid(); }
      else if (t === 'BoolProperty') { r.u8(); r.optGuid(); }
      else r.optGuid();
      r.pos += sz;
    }
  }
  return slices;
}

const HIGH_PASSIVES = new Set([
  'Legend', 'PAL_ALLAttack_up2', 'PAL_ALLAttack_up1', 'Noukin', 'PAL_FullStomach_Down_1',
  'Rare', 'ElementBoost_Fire_2_PAL', 'ElementBoost_Water_2_PAL', 'ElementBoost_Leaf_2_PAL',
  'ElementBoost_Thunder_2_PAL', 'ElementBoost_Ice_2_PAL', 'ElementBoost_Earth_2_PAL',
  'ElementBoost_Dark_2_PAL', 'ElementBoost_Dragon_2_PAL', 'DemonGod', 'Vampiric',
  'CoolTimeReduction_Up_2', 'CoolTimeReduction_Up_1',
]);

function computePalPower(sp) {
  const lv = Number(sp.Level) || 1;
  const rank = Math.max(1, Number(sp.Rank) || 1); // 1..5 (stars = rank - 1)
  const ivs = [sp.Talent_HP, sp.Talent_Melee, sp.Talent_Shot, sp.Talent_Defense]
    .map(v => (typeof v === 'number' ? v : 50));
  const ivAvg = ivs.reduce((a, b) => a + b, 0) / ivs.length;
  const passives = Array.isArray(sp.PassiveSkillList) ? sp.PassiveSkillList : [];
  let passiveBonus = 0;
  for (const p of passives) {
    passiveBonus += HIGH_PASSIVES.has(p) ? 0.14 : 0.06;
  }
  const rankMult = 1 + (rank - 1) * 0.2;
  const ivMult = 1 + (ivAvg / 100) * 0.3;
  const power = Math.round(lv * 100 * rankMult * ivMult * (1 + passiveBonus));
  return { power, ivAvg: Math.round(ivAvg), rank, passives };
}

function prettyPalId(id) {
  if (!id) return 'Unknown Pal';
  let s = String(id);
  const isBoss = s.startsWith('BOSS_') || s.startsWith('GYM_');
  s = s.replace(/^(BOSS_|GYM_)/, '').replace(/_/g, ' ');
  s = s.replace(/([a-z])([A-Z])/g, '$1 $2');
  return isBoss ? `${s} (Alpha)` : s;
}

function guidHex(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += bytes[i].toString(16).padStart(2, '0');
  return s;
}

// Convert UE DateTime ticks (100ns since 0001-01-01) to ISO string.
function ueTicksToIso(ticksStr) {
  if (!ticksStr) return null;
  try {
    const ticks = BigInt(ticksStr);
    const epochOffset = 621355968000000000n;
    if (ticks <= epochOffset) return null;
    const ms = Number((ticks - epochOffset) / 10000n);
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

export function buildFamilyStats(worldDir, playerFiles, resolveNameFn) {
  // 1. LevelMeta.sav -> InGameDay, WorldName, HostPlayerLevel
  let worldDay = null;
  let worldName = null;
  let hostLevel = null;
  const metaPath = path.join(worldDir, 'LevelMeta.sav');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = plain(parseGvas(decompressSav(new Uint8Array(fs.readFileSync(metaPath)))).properties);
      const sd = meta?.SaveData || {};
      worldDay = sd.InGameDay ?? null;
      worldName = sd.WorldName || null;
      hostLevel = sd.HostPlayerLevel ?? null;
    } catch { /* ignore */ }
  }

  // 2. Players/*.sav -> PlayerUId, party/box container IDs, Paldeck & RecordData
  const playerRecords = new Map(); // normalized PlayerUId -> record
  for (const filename of playerFiles) {
    const uid = filename.replace(/\.sav$/i, '');
    const fullPath = path.join(worldDir, 'Players', filename);
    try {
      const sav = plain(parseGvas(decompressSav(new Uint8Array(fs.readFileSync(fullPath)))).properties);
      const sd = sav?.SaveData || {};
      const playerUId = (sd.PlayerUId || '').toLowerCase();
      const rec = sd.RecordData || {};
      const captureMap = Array.isArray(rec.PalCaptureCount) ? rec.PalCaptureCount : [];
      const totalCaptured = captureMap.reduce((sum, [, c]) => sum + (Number(c) || 0), 0);
      const bonusMap = Array.isArray(rec.PalCaptureBonusCount) ? rec.PalCaptureBonusCount : [];
      const bonusComplete = bonusMap.filter(([, c]) => Number(c) >= 12).length;
      const unlockMap = Array.isArray(rec.PaldeckUnlockFlag) ? rec.PaldeckUnlockFlag : [];
      const uniqueUnlocked = typeof rec.TribeCaptureCount === 'number'
        ? rec.TribeCaptureCount
        : unlockMap.filter(([, v]) => v === true).length;

      playerRecords.set(playerUId, {
        uid,
        playerUId,
        cachedName: resolveNameFn(uid),
        partyContainerId: sd.OtomoCharacterContainerId?.ID?.toLowerCase() || null,
        boxContainerId: sd.PalStorageContainerId?.ID?.toLowerCase() || null,
        lastOnline: ueTicksToIso(sd.LastOnlineDateTime),
        paldeck: {
          unique: uniqueUnlocked,
          totalCaptured,
          bonusComplete,
        },
        dungeonsCleared: (Number(rec.NormalDungeonClearCount) || 0) + (Number(rec.FixedDungeonClearCount) || 0),
        predatorsDefeated: Number(rec.PredatorDefeatCount) || 0,
      });
    } catch { /* skip unreadable player save */ }
  }

  // 3. Level.sav -> CharacterSaveParameterMap, BaseCampSaveData, GuildExtraSaveDataMap
  const levelPath = path.join(worldDir, 'Level.sav');
  const levelPlayers = new Map(); // playerUId -> { name, level, exp, hp }
  const pals = [];
  const bases = [];

  if (fs.existsSync(levelPath)) {
    const raw = decompressSav(new Uint8Array(fs.readFileSync(levelPath)));
    const slices = extractWorldSlices(raw, new Set([
      'CharacterSaveParameterMap',
      'BaseCampSaveData',
    ]));

    if (slices.CharacterSaveParameterMap) {
      const chars = parseMapSlice(slices.CharacterSaveParameterMap, true, true);
      for (const [k, v] of chars) {
        try {
          const sp = readProperties(new Reader(v.RawData)).SaveParameter;
          if (!sp) continue;
          if (sp.IsPlayer) {
            const puid = String(k.PlayerUId || '').toLowerCase();
            levelPlayers.set(puid, {
              name: sp.NickName || null,
              level: Number(sp.Level) || 1,
              exp: Number(sp.Exp) || 0,
            });
          } else {
            pals.push(sp);
          }
        } catch { /* skip malformed character entry */ }
      }
    }

    const baseWorkerContainers = new Map(); // containerId -> baseIndex
    if (slices.BaseCampSaveData) {
      const rawBases = parseMapSlice(slices.BaseCampSaveData, false, true);
      rawBases.forEach(([baseId, v], idx) => {
        const wd = v?.WorkerDirector?.RawData;
        const workerContainerId = wd && wd.length >= 20
          ? guidHex(wd.subarray(wd.length - 20, wd.length - 4)).toLowerCase()
          : null;
        if (workerContainerId) baseWorkerContainers.set(workerContainerId, idx);
        bases.push({
          id: baseId,
          label: `Base ${idx + 1}`,
          workerContainerId,
          totalWorkers: 0,
          ownersMap: new Map(),
        });
      });
    }

    // Group Pals by container (party vs base worker)
    const partyByContainer = new Map();
    for (const sp of pals) {
      const cid = sp.SlotId?.ContainerId?.ID?.toLowerCase();
      if (!cid) continue;

      if (baseWorkerContainers.has(cid)) {
        const base = bases[baseWorkerContainers.get(cid)];
        base.totalWorkers++;
        const ownerId = (sp.OwnerPlayerUId || sp.OldOwnerPlayerUIds?.[0] || '').toLowerCase();
        const ownerName = levelPlayers.get(ownerId)?.name
          || playerRecords.get(ownerId)?.cachedName
          || (ownerId ? `Player (${ownerId.slice(0, 6)})` : 'Unowned');
        if (!base.ownersMap.has(ownerName)) base.ownersMap.set(ownerName, []);
        base.ownersMap.get(ownerName).push({
          name: sp.NickName || prettyPalId(sp.CharacterID),
          level: Number(sp.Level) || 1,
          rank: Math.max(1, Number(sp.Rank) || 1),
        });
      } else {
        if (!partyByContainer.has(cid)) partyByContainer.set(cid, []);
        partyByContainer.get(cid).push(sp);
      }
    }

    // Attach party Pals + Level.sav player info to each player
    for (const [puid, rec] of playerRecords) {
      const lp = levelPlayers.get(puid);
      rec.name = lp?.name || rec.cachedName || (rec.uid.startsWith('00000000') ? 'Host (0001)' : `Player (${rec.uid.slice(0, 8)})`);
      rec.level = lp?.level ?? null;

      const partyRaw = rec.partyContainerId ? (partyByContainer.get(rec.partyContainerId) || []) : [];
      const party = partyRaw.map(sp => {
        const { power, ivAvg, rank, passives } = computePalPower(sp);
        return {
          characterId: sp.CharacterID,
          name: sp.NickName || prettyPalId(sp.CharacterID),
          level: Number(sp.Level) || 1,
          rank,
          ivAvg,
          passiveCount: passives.length,
          power,
        };
      }).sort((a, b) => b.power - a.power);

      rec.party = party;
      rec.partyPower = party.reduce((sum, p) => sum + p.power, 0);
    }
  } else {
    for (const [, rec] of playerRecords) {
      rec.name = rec.cachedName || (rec.uid.startsWith('00000000') ? 'Host (0001)' : `Player (${rec.uid.slice(0, 8)})`);
      rec.level = null;
      rec.party = [];
      rec.partyPower = 0;
    }
  }

  const playersOut = [...playerRecords.values()].map(({ cachedName, partyContainerId, boxContainerId, ...rest }) => rest);

  const basesOut = bases.map(({ workerContainerId, ownersMap, ...b }) => ({
    ...b,
    owners: [...ownersMap.entries()]
      .map(([name, ownerPals]) => ({
        name,
        count: ownerPals.length,
        pals: ownerPals.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => b.count - a.count),
  }));

  return {
    worldName,
    worldDay,
    hostLevel,
    players: playersOut,
    bases: basesOut,
    updatedAt: new Date().toISOString(),
  };
}
