// PalMap — browser app
// © Void Possum

import { parseSave } from '../src/palsave.mjs';

// --- world -> image transform ----------------------------------------------
// The map's horizontal axis is world Y (east positive) and its vertical axis is
// world X inverted (north is up). Base bounds fitted by extract/calibrate.mjs
// (97.4% of known-on-land markers on land). extract/diagnose-offset.mjs then
// found a residual ~11px westward drift confined to the far-eastern edge; maxY
// is tightened slightly to null it there while keeping the rest within ~2px.
const WORLD = { minX: -1094598, maxX: 347730, minY: -726031, maxY: 727133 };
const IMAGE = 8192;

function worldToLatLng(wx, wy) {
  const u = (wy - WORLD.minY) / (WORLD.maxY - WORLD.minY);       // 0..1 west->east
  const v = 1 - (wx - WORLD.minX) / (WORLD.maxX - WORLD.minX);   // 0..1 north->south
  // CRS.Simple's y grows upward, but v is measured from the top.
  return [(1 - v) * IMAGE, u * IMAGE];
}

const COLORS = {
  effigy: '#a3e635',
  fastTravel: '#60a5fa',
  towerBoss: '#f87171',
  alphaPal: '#fb923c',
  cagedBoss: '#cbd5e1',
  dungeon: '#c084fc',
  note: '#fbbf24',
  itemPickup: '#22d3ee',
  watchtower: '#2dd4bf',
  treasureMap: '#facc15',
  warpPoint: '#a78bfa',
  skillFruit: '#f472b6',
};

// Official in-game compass icons, copied by extract/copy-ui-icons.mjs and
// extract/merge-locations.mjs.
const ICONS = {
  fastTravel: 'T_icon_compass_FTtower.png',
  dungeon: 'T_icon_compass_dungeon.png',
  towerBoss: 'T_icon_compass_tower.png',
  itemPickup: 'T_icon_compass_Search_Treasure.png',
  watchtower: 'T_icon_compass_FTUnlockMap.png',
  treasureMap: 'T_icon_compass_TreasureMap_01.png',
  warpPoint: 'T_icon_compass_Teleport.png',
  respawnPoint: 'T_icon_compass_Teleport_Direction.png',
};

// Notes have no counterpart in the game's UI textures, so they keep a drawn glyph.
const GLYPHS = {
  note: '<path d="M6 3h9l3 3v15H6z" opacity=".95"/><path d="M8.5 9h7M8.5 12h7M8.5 15h4.5" stroke="rgba(0,0,0,.55)" stroke-width="1.4" fill="none" stroke-linecap="round"/>',
};

const PIN_SCALE = 1.25;
// Sizes are the pin diameter. They're not uniform because the icons fill their
// canvas very differently: the fast-travel emblem is a wide, short shape that
// only occupies ~50% of its height, so it needs a bigger box to read at the same
// visual weight; dungeon/chest glyphs are near-solid and go smaller.
const BASE_SIZE = {
  effigy: 26, alphaPal: 30, cagedBoss: 30, towerBoss: 30, dungeon: 19,
  fastTravel: 34, note: 20, itemPickup: 18,
  watchtower: 32, treasureMap: 22, warpPoint: 24, skillFruit: 22,
};
const sizeFor = category => Math.round((BASE_SIZE[category] || 22) * PIN_SCALE);

// --- state ------------------------------------------------------------------
const LS = {
  manual: 'palmap.manual',
  auto: 'palmap.auto',
  profile: 'palmap.profile',
  foundState: 'palmap.foundState',
  hiddenCats: 'palmap.hiddenCats',
};
const loadSet = k => new Set(JSON.parse(localStorage.getItem(k) || '[]'));
const saveSet = (k, s) => localStorage.setItem(k, JSON.stringify([...s]));

let manual = loadSet(LS.manual);
let auto = loadSet(LS.auto);
const hiddenCats = loadSet(LS.hiddenCats);

// How each category treats markers you've already found.
const FOUND_STATES = ['shown', 'dim', 'hidden'];
const FOUND_GLYPH = { shown: '●', dim: '◐', hidden: '○' };
const FOUND_TITLE = {
  shown: 'Found markers: shown in full',
  dim: 'Found markers: dimmed',
  hidden: 'Found markers: hidden',
};
let foundState = JSON.parse(localStorage.getItem(LS.foundState) || '{}');

const isFound = id => auto.has(id) || manual.has(id);
const stateOf = catId => foundState[catId] || 'dim';

// --- map --------------------------------------------------------------------
const map = L.map('map', {
  crs: L.CRS.Simple,
  minZoom: -4,
  maxZoom: 2,
  // Top-left is where the floating sidebar sits, so the zoom control moves over.
  zoomControl: false,
  attributionControl: false,
});
L.control.zoom({ position: 'topright' }).addTo(map);

const bounds = [[0, 0], [IMAGE, IMAGE]];
L.imageOverlay('data/T_WorldMap.png', bounds).addTo(map);
// The sidebar floats over the map's left edge, so bias the initial fit right by
// its width — otherwise the island centres partly underneath it.
map.fitBounds(bounds, { paddingTopLeft: [300, 0] });
map.setMaxBounds([[-IMAGE * 0.1, -IMAGE * 0.1], [IMAGE * 1.1, IMAGE * 1.1]]);

// --- load markers -----------------------------------------------------------
const res = await fetch('data/markers.json');
const { categories, markers: allMarkers } = await res.json();

// The World Tree is a separate instanced map with its own texture, tucked into an
// isolated corner of world space. Everything else — Palpagos and the Sakurajima /
// Feybreak islands — belongs on this one.
const isWorldTree = m => m.x >= 400000 && m.y <= -500000;
const markers = allMarkers.filter(m => !isWorldTree(m));

// Indexes built once; refresh() used to re-filter the whole array per category.
const byCategory = new Map();
const pins = new Map();     // marker id -> L.Marker
const layers = new Map();   // category id -> L.LayerGroup

for (const cat of categories) {
  layers.set(cat.id, L.layerGroup().addTo(map));
  byCategory.set(cat.id, []);
}
for (const m of markers) byCategory.get(m.category)?.push(m);

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Sidebar icons for the categories whose *map* pins are per-Pal portraits, so
// there's no single pin image to reuse. Effigies borrow Lifmunk — the classic
// one — and the bosses use the game's own compass crests.
const CAT_ICON = {
  effigy: 'icons/T_Carbunclo_icon_normal.png',
  alphaPal: 'icons/ui/T_icon_compass_boss.png',
  cagedBoss: 'icons/ui/T_icon_compass_KeyBoss.png',
};

function categorySwatch(id, colour) {
  const src = CAT_ICON[id] || (ICONS[id] ? `icons/ui/${ICONS[id]}` : null);
  if (src) return `<img class="cat-icon" src="data/${src}" alt="" decoding="async">`;
  // Notes have no icon anywhere in the game's UI textures, so the sidebar
  // reuses the same drawn glyph the map pin uses.
  if (GLYPHS[id]) return `<svg class="cat-icon" viewBox="0 0 24 24" style="fill:${colour}">${GLYPHS[id]}</svg>`;
  return `<span class="dot" style="background:${colour}"></span>`;
}

function pinFor(m) {
  const color = COLORS[m.category] || '#94a3b8';
  const size = sizeFor(m.category);
  let html;

  if (m.icon) {
    // Effigies and bosses show the Pal's portrait, ringed in their category colour.
    html = `<div class="pal-pin${m.caged ? ' caged' : ''}" style="--ring:${color};width:${size}px;height:${size}px">
              <img src="data/icons/${m.icon}" alt="" decoding="async"></div>`;
  } else if (ICONS[m.category]) {
    html = `<div class="ui-pin" style="width:${size}px;height:${size}px">
              <img src="data/icons/ui/${ICONS[m.category]}" alt="" decoding="async"></div>`;
  } else if (GLYPHS[m.category]) {
    html = `<div class="glyph-pin" style="--tint:${color};width:${size}px;height:${size}px">
              <svg viewBox="0 0 24 24">${GLYPHS[m.category]}</svg></div>`;
  } else {
    html = `<div class="dot-pin" style="--tint:${color}"></div>`;
  }

  const marker = L.marker(worldToLatLng(m.x, m.y), {
    icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
    keyboard: false,
  });
  marker.on('click', () => openPopup(m, marker));
  return marker;
}

function openPopup(m, marker) {
  const fromSave = auto.has(m.id);
  const found = isFound(m.id);
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="popup-title">${escapeHtml(m.label)}</div>
    <div class="popup-meta">
      ${m.category} &middot; ${m.x}, ${m.y}
      ${fromSave ? '<br><span class="src-auto">✓ found — from your save</span>' : ''}
    </div>`;
  if (!fromSave) {
    const btn = document.createElement('button');
    btn.className = 'popup-btn';
    btn.textContent = found ? 'Mark as not found' : 'Mark as found';
    btn.onclick = () => {
      if (manual.has(m.id)) manual.delete(m.id); else manual.add(m.id);
      saveSet(LS.manual, manual);
      applyVisibility();
      updateCounts();
      marker.closePopup();
    };
    el.appendChild(btn);
  }
  marker.bindPopup(el).openPopup();
}

for (const m of markers) {
  const pin = pinFor(m);
  pins.set(m.id, pin);
}

// --- visibility -------------------------------------------------------------
// Category on/off and per-category found state both decide whether a pin is on
// the map, so they run through one function rather than each poking the layers.
//
// Deliberately NOT viewport-culled. Culling was tried and made things worse: it
// kept ~345 markers in the DOM instead of ~900, but the bulk add/remove on every
// moveend cost a 158ms hitch. With the CSS filters gone, all ~900 markers pan at
// ~17ms/frame, so there is nothing to buy.
function applyVisibility() {
  for (const cat of categories) {
    const layer = layers.get(cat.id);
    const mine = byCategory.get(cat.id);
    if (!layer || !mine?.length) continue;

    const catOn = !hiddenCats.has(cat.id);
    const found = stateOf(cat.id);

    for (const m of mine) {
      const pin = pins.get(m.id);
      if (!pin) continue;

      const isFoundMarker = isFound(m.id);
      const wanted = catOn && !(isFoundMarker && found === 'hidden');

      const on = layer.hasLayer(pin);
      if (wanted && !on) layer.addLayer(pin);
      else if (!wanted && on) layer.removeLayer(pin);

      if (wanted) {
        const el = pin.getElement();
        if (el) el.classList.toggle('dim', isFoundMarker && found === 'dim');
      }
    }
  }
}

// Pins are sized for a close-in view; at full-map zoom ~900 of them at that size
// bury the island. Rather than resize 900 icons (which would touch the DOM on
// every zoom), publish one CSS variable the pins scale themselves against.
const mapEl = document.getElementById('map');
function applyZoomScale() {
  const z = map.getZoom();
  const t = (z - map.getMinZoom()) / Math.max(1, map.getMaxZoom() - map.getMinZoom());
  const scale = 0.5 + t * 0.6;   // ~0.5x zoomed right out, ~1.1x zoomed right in
  mapEl.style.setProperty('--pin-scale', scale.toFixed(3));
}

map.on('zoomend', applyZoomScale);
applyZoomScale();

// --- sidebar ----------------------------------------------------------------
const listEl = document.getElementById('categories');

function updateCounts() {
  // Only trackable categories belong in the headline total — counting chests and
  // warp points would make the overall figure meaningless.
  let totalFound = 0, totalTracked = 0;

  for (const cat of categories) {
    const mine = byCategory.get(cat.id);
    if (!mine?.length) continue;
    const found = mine.reduce((n, m) => n + (isFound(m.id) ? 1 : 0), 0);
    const el = listEl.querySelector(`[data-count="${cat.id}"]`);
    if (el) {
      el.textContent = `${found} / ${mine.length}`;
      el.classList.toggle('done', found === mine.length);
    }
    if (cat.saveFlag) { totalFound += found; totalTracked += mine.length; }
  }

  const bar = document.getElementById('progress-bar');
  const label = document.getElementById('progress-label');
  if (bar && label && totalTracked) {
    const pct = Math.round((totalFound / totalTracked) * 100);
    bar.style.width = `${pct}%`;
    label.textContent = `${totalFound} / ${totalTracked} tracked collectibles · ${pct}%`;
  }
}

function paintFoundBtn(btn, catId) {
  const s = stateOf(catId);
  btn.textContent = FOUND_GLYPH[s];
  btn.dataset.state = s;
  btn.title = `${FOUND_TITLE[s]} — click to cycle, shift-click to set every category`;
}

for (const cat of categories) {
  const mine = byCategory.get(cat.id);
  if (!mine?.length) continue;

  // Only categories with a save flag can tick themselves; the rest are manual.
  // Saying so inline stops "why didn't my treasure maps update?" before it starts.
  const badge = cat.saveFlag
    ? `<span class="sync-badge" title="Supports auto-sync — these tick themselves from your save file">⟳</span>`
    : `<span class="sync-badge manual" title="Manual only — Palworld doesn't record these in the save, so tick them by hand">✋</span>`;

  const colour = COLORS[cat.id] || '#94a3b8';
  const swatch = categorySwatch(cat.id, colour);

  const li = document.createElement('li');
  li.innerHTML = `
    <div class="cat" style="--cat:${colour}">
      <label class="cat-main">
        <input type="checkbox" data-cat="${cat.id}" ${hiddenCats.has(cat.id) ? '' : 'checked'}>
        ${swatch}
        <span class="name">${escapeHtml(cat.name)}</span>
        ${badge}
        <span class="count" data-count="${cat.id}"></span>
      </label>
      <button class="found-btn" data-found="${cat.id}"></button>
    </div>`;
  listEl.appendChild(li);

  li.querySelector('input').addEventListener('change', e => {
    if (e.target.checked) hiddenCats.delete(cat.id); else hiddenCats.add(cat.id);
    saveSet(LS.hiddenCats, hiddenCats);
    applyVisibility();
  });

  const btn = li.querySelector('.found-btn');
  paintFoundBtn(btn, cat.id);
  btn.addEventListener('click', e => {
    const next = FOUND_STATES[(FOUND_STATES.indexOf(stateOf(cat.id)) + 1) % FOUND_STATES.length];
    if (e.shiftKey) for (const c of categories) foundState[c.id] = next;
    else foundState[cat.id] = next;

    localStorage.setItem(LS.foundState, JSON.stringify(foundState));
    listEl.querySelectorAll('.found-btn').forEach(b => paintFoundBtn(b, b.dataset.found));
    applyVisibility();
  });
}

const setAllCategories = on => {
  listEl.querySelectorAll('input[data-cat]').forEach(i => {
    i.checked = on;
    if (on) hiddenCats.delete(i.dataset.cat); else hiddenCats.add(i.dataset.cat);
  });
  saveSet(LS.hiddenCats, hiddenCats);
  applyVisibility();
};
document.getElementById('all-btn').onclick = () => setAllCategories(true);
document.getElementById('none-btn').onclick = () => setAllCategories(false);

// --- save sync --------------------------------------------------------------
const statusEl = document.getElementById('sync-status');
const setStatus = (msg, cls = '') => { statusEl.textContent = msg; statusEl.className = `status ${cls}`; };

// Only GUID keys get their dashes stripped — note keys like "Day1-2" contain
// meaningful dashes and must be left alone.
const GUID = /^[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}$/;

// Since 1.0 each effigy variant is its own relic type with its own perk
// (Lamball = HungerReduction, Munchill = FoodDecayReduction, …) and is recorded
// in RelicObtainForInstanceFlagByType. The flat RelicObtainForInstanceFlag only
// ever holds the classic Lifmunk (CapturePower) ones, so both must be read or
// every non-Lifmunk effigy stays unticked.
const EXTRA_FLAGS = { effigy: ['RelicObtainForInstanceFlagByType'] };

// RecordData entries come in two shapes: a flat [key, bool] list, or a per-type
// list of { Type, Flags: [[key, bool], …] }. Collect keys from either.
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

// The one join used by every path (server sync, auto-sync, manual file picker).
function syncFromBytes(bytes, label) {
  const save = parseSave(bytes);
  const record = save.data?.SaveData?.RecordData;
  if (!record) throw new Error('No RecordData — is this a player save (not Level.sav)?');

  const flagSet = names => {
    const set = new Set();
    for (const name of names) {
      for (const k of recordKeys(record[name])) {
        const s = String(k).toLowerCase();
        set.add(GUID.test(s) ? s.replace(/-/g, '') : s);
      }
    }
    return set;
  };

  const next = new Set();
  let matched = 0;
  for (const cat of categories) {
    if (!cat.saveFlag) continue;
    const flags = flagSet([cat.saveFlag, ...(EXTRA_FLAGS[cat.id] || [])]);
    for (const m of byCategory.get(cat.id) || []) {
      if (flags.has(m.key)) { next.add(m.id); matched++; }
    }
  }

  auto = next;
  saveSet(LS.auto, auto);
  if (label) localStorage.setItem(LS.profile, label);
  applyVisibility();
  updateCounts();
  return matched;
}

// --- fallback: single-file picker (all browsers) ----------------------------
document.getElementById('sync-btn').onclick = () => document.getElementById('sync-input').click();

document.getElementById('sync-input').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  setStatus('Reading save…');
  try {
    const matched = syncFromBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    setStatus(`Synced ${matched} found markers from ${file.name}`, 'ok');
  } catch (err) {
    console.error(err);
    setStatus(err.message, 'err');
  } finally {
    e.target.value = '';
  }
};

// --- server-backed sync (works in every browser) ----------------------------
// A browser can only re-read a file unprompted via the File System Access API,
// which Brave disables and Firefox never shipped. So the local server finds the
// save folder and serves the bytes, and this just polls it: no folder picking,
// no browser flags, identical behaviour everywhere.
const els = {
  worldField: document.getElementById('world-field'),
  worldSelect: document.getElementById('world-select'),
  syncActions: document.getElementById('sync-actions'),
  refreshBtn: document.getElementById('refresh-btn'),
  autoRow: document.getElementById('auto-row'),
  autoToggle: document.getElementById('auto-toggle'),
  autoInterval: document.getElementById('auto-interval'),
  syncBtn: document.getElementById('sync-btn'),
};

const LS_WORLD = 'palmap.worldId';
const LS_AUTO_ON = 'palmap.autoOn';
const LS_AUTO_MINS = 'palmap.autoMins';

let worlds = [];
let lastMtime = null;
let autoTimer = null;

const currentWorld = () => worlds[Number(els.worldSelect.value)] || null;
const worldLabel = w =>
  `${w.name}${w.host ? ` — ${w.host}` : ''}${w.level != null ? ` (Lv ${w.level})` : ''}`;

// Footer stamp — shows at a glance which app.js ran and which path is live.
const stamp = mode => {
  const el = document.getElementById('ver');
  if (el) el.textContent = `© Void Possum · v1.2 · ${mode}`;
};

// Palworld only flushes the save to disk on its own schedule, so hitting
// Refresh right after picking something up legitimately finds nothing new.
// Reporting the save's own write time is what tells the two cases apart —
// without it "nothing changed" is indistinguishable from "the button is broken".
async function syncWorld(w, isAuto = false) {
  const res = await fetch(`/api/save?world=${encodeURIComponent(w.id)}`);
  if (!res.ok) throw new Error(`Could not read the save (${res.status})`);

  const mtime = Number(res.headers.get('X-Save-Mtime'));
  const before = auto.size;
  const matched = syncFromBytes(new Uint8Array(await res.arrayBuffer()), w.name);
  const gained = auto.size - before;
  lastMtime = mtime;

  const saved = mtime ? new Date(mtime).toLocaleTimeString() : 'unknown';
  const delta = gained > 0 ? ` (+${gained} new)` : '';
  setStatus(
    `${isAuto ? 'Auto-synced' : 'Synced'} ${matched} markers${delta} · game last saved ${saved}`,
    'ok'
  );
}

async function selectWorld(i, isAuto = false) {
  const w = worlds[i];
  if (!w) return;
  localStorage.setItem(LS_WORLD, w.id);
  try { await syncWorld(w, isAuto); }
  catch (err) { console.error(err); setStatus(err.message, 'err'); }
}

// The poll hits /api/status, which is a stat rather than a save parse, so
// running it every minute costs nothing; the save is only re-read once its
// timestamp actually moves.
async function autoTick() {
  const w = currentWorld();
  if (!w) return;
  try {
    const res = await fetch(`/api/status?world=${encodeURIComponent(w.id)}`);
    if (!res.ok) return;
    const { mtime } = await res.json();
    if (String(mtime) === String(lastMtime)) return;
    await syncWorld(w, true);
  } catch (err) {
    console.error(err);
  }
}

function setupAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  localStorage.setItem(LS_AUTO_ON, els.autoToggle.checked ? '1' : '0');
  localStorage.setItem(LS_AUTO_MINS, els.autoInterval.value);
  if (els.autoToggle.checked) autoTimer = setInterval(autoTick, Number(els.autoInterval.value) * 60000);
}

fetch('/api/worlds').then(r => (r.ok ? r.json() : [])).then(async list => {
  worlds = Array.isArray(list) ? list : [];
  // No saves found (or not running under the local server) — leave the manual
  // file picker as the primary control.
  if (!worlds.length) { stamp('file mode'); return; }

  els.worldSelect.innerHTML = '';
  worlds.forEach((w, i) => {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = worldLabel(w);
    els.worldSelect.appendChild(o);
  });

  els.worldField.hidden = false;
  els.syncActions.hidden = false;
  els.autoRow.hidden = false;
  // The server found the save, so the manual picker drops to a tertiary link.
  els.syncBtn.classList.remove('primary');
  els.syncBtn.classList.add('link', 'plain');
  els.syncBtn.textContent = 'Or pick a .sav file manually…';
  stamp('auto-sync');

  els.autoToggle.checked = (localStorage.getItem(LS_AUTO_ON) ?? '1') === '1';
  els.autoInterval.value = localStorage.getItem(LS_AUTO_MINS) || '1';

  els.worldSelect.onchange = () => selectWorld(Number(els.worldSelect.value));
  els.refreshBtn.onclick = () => selectWorld(Number(els.worldSelect.value));
  els.autoToggle.onchange = setupAuto;
  els.autoInterval.onchange = setupAuto;

  const remembered = localStorage.getItem(LS_WORLD);
  const i = Math.max(0, worlds.findIndex(w => w.id === remembered));
  els.worldSelect.value = String(i);
  await selectWorld(i);
  setupAuto();
}).catch(err => { console.error(err); stamp('file mode'); });

// --- export / import --------------------------------------------------------
document.getElementById('export-btn').onclick = () => {
  const blob = new Blob([JSON.stringify({
    version: 1,
    exportedAt: new Date().toISOString(),
    manual: [...manual],
    auto: [...auto],
  }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `palmap-progress-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
};

document.getElementById('import-btn').onclick = () => document.getElementById('import-input').click();
document.getElementById('import-input').onchange = async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    manual = new Set(data.manual || []);
    auto = new Set(data.auto || []);
    saveSet(LS.manual, manual);
    saveSet(LS.auto, auto);
    applyVisibility();
    updateCounts();
    setStatus(`Imported progress from ${file.name}`, 'ok');
  } catch (err) {
    setStatus(`Import failed: ${err.message}`, 'err');
  } finally {
    e.target.value = '';
  }
};

const profile = localStorage.getItem(LS.profile);
if (profile) setStatus(`Last synced from ${profile}`);

applyVisibility();
updateCounts();
