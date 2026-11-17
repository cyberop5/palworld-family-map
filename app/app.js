// PalMap — browser app
// © Void Possum

import { parseSave } from './lib/palsave.mjs';
import { readCustomPins } from './lib/localpins.mjs';

// --- maps and their world -> image transforms -------------------------------
// Palworld has two maps, and says so itself: a save's RecordData carries
// UnlockedWorldMapFlags = { MainMap, Tree }. MainMap is Palpagos plus both DLC
// island groups, all in one continuous coordinate space; the World Tree is a
// separate instanced level with its own texture, its own corner of world space
// and — the part that isn't obvious — its own in-game coordinate origin and
// scale. Nothing about one carries over to the other.
//
// On both, the horizontal axis is world Y (east positive) and the vertical axis
// is world X inverted (north up).
//
// Both boxes are square on purpose: each texture is a square 8192px image, so
// the world region it covers must be square too — the same world-units-per-pixel
// on both axes. MainMap's long-standing box wasn't, and its two axes differed by
// 0.75%: invisible mid-map, ~30px out at Feybreak and the Sky Islands, which is
// exactly where markers used to sit beside the thing rather than on it. An
// earlier version of this file mistook that one global defect for three separate
// regional problems and tried to patch it with a box per landmass. There is no
// such thing, and that code is gone.
//
// Both were derived by cross-referencing paldb.cc, which publishes the same two
// 8192px textures as tile pyramids:
//   MainMap — 867 markers carrying both in-game coordinates and tile positions;
//     one uniform-scale affine fits all 867 to under 2px.
//   Tree    — fitted on the 15 fast travel points instead, matched by name so
//     the fit uses our exact world coordinates rather than paldb's rounded
//     integer display values. Max residual 0.05px, and the two axis scales
//     agree to 0.0006%.
// tools/calibrate.mjs re-checks both against our own textures, holding out
// every effigy.
const IMAGE = 8192;

const MAPS = [
  {
    id: 'palpagos',
    name: 'Palpagos',
    texture: 'data/T_WorldMap.png',
    world: { minX: -1099401, maxX: 349385, minY: -724397, maxY: 724389 },
    // The in-game map's own coordinate readout, so popups show what the pause
    // menu and paldb show rather than raw save units. Validated against Arena
    // Entrance -> 629, 14 and Azure Covenant Tower -> -423, -1426.
    coords: { div: 459, offY: -158000, offX: 123888 },
  },
  {
    id: 'worldTree',
    name: 'World Tree',
    texture: 'data/T_TreeMap.png',
    world: { minX: 347350, maxX: 689148, minY: -818197, maxY: -476399 },
    // Different origin *and* different scale from Palpagos — 1334 world units
    // per map unit rather than 459. Reproduces paldb's published coordinate for
    // 14 of the 15 fast travel points exactly, the last off by one.
    coords: { div: 1334, offY: 647509, offX: 517733 },
  },
];

// The World Tree sits in an isolated corner of world space, so a range check
// separates the two maps the same way it always has. Everything else is MainMap.
const isWorldTree = m => m.x >= 400000 && m.y <= -500000;
const mapOf = m => (isWorldTree(m) ? MAPS[1] : MAPS[0]);

function worldToLatLng(wx, wy, map) {
  const { minX, maxX, minY, maxY } = map.world;
  const u = (wy - minY) / (maxY - minY);       // 0..1 west->east
  const v = 1 - (wx - minX) / (maxX - minX);   // 0..1 north->south
  // CRS.Simple's y grows upward, but v is measured from the top.
  return [(1 - v) * IMAGE, u * IMAGE];
}

function toMapCoords(wx, wy, map) {
  const { div, offY, offX } = map.coords;
  return [Math.round((wy + offY) / div), Math.round((wx + offX) / div)];
}

const COLORS = {
  effigy: '#a3e635',
  fastTravel: '#60a5fa',
  towerBoss: '#f87171',
  alphaPal: '#fb923c',
  cagedBoss: '#cbd5e1',
  dungeon: '#c084fc',
  note: '#fbbf24',
  ancientRuin: '#22d3ee',
  watchtower: '#2dd4bf',
  treasureMap: '#facc15',
  warpPoint: '#a78bfa',
  skillFruit: '#f472b6',
  bounty: '#f43f5e',
  player: '#ffffff',
};

// Official in-game compass icons, copied by extract/copy-ui-icons.mjs and
// extract/merge-locations.mjs.
const ICONS = {
  fastTravel: 'T_icon_compass_FTtower.png',
  dungeon: 'T_icon_compass_dungeon.png',
  towerBoss: 'T_icon_compass_tower.png',
  // A custom drawing rather than a game asset — Palworld's own UI has no icon
  // for the ruins specifically (the closest, Search_Treasure, is a generic
  // treasure-hunt glyph shared with other things). Made by Void Possum.
  ancientRuin: 'AncientRuin_icon_by_voidpossum.png',
  watchtower: 'T_icon_compass_FTUnlockMap.png',
  treasureMap: 'T_icon_compass_TreasureMap_01.png',
  warpPoint: 'T_icon_compass_Teleport.png',
  respawnPoint: 'T_icon_compass_Teleport_Direction.png',
  skillFruit: 'Skill_Fruit_icon.webp',
  bounty: 'T_icon_compass_Bounty.png',
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
  fastTravel: 34, note: 20, ancientRuin: 26,
  watchtower: 32, treasureMap: 22, warpPoint: 24, skillFruit: 22,
  bounty: 22,
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

// 1.4 renamed the "Item Pickup" category to "Ancient Ruin" once we worked out
// that's what those 106 objects are. Marker ids carry the category, so old hand
// ticks would otherwise be orphaned; rewriting the prefix on read keeps them.
const migrate = ids => new Set([...ids].map(id => id.replace(/^itemPickup:/, 'ancientRuin:')));

let manual = migrate(loadSet(LS.manual));
let auto = loadSet(LS.auto);

// 170 dungeon portals is a lot of small icons to greet a new install with, so
// they start hidden — but only on a genuine first run. Keyed on "never saved a
// choice before", not on "currently empty": hitting All deliberately produces
// an empty set too, and that must stay empty on reload rather than silently
// re-hiding dungeons behind the player's back.
const hiddenCats = localStorage.getItem(LS.hiddenCats) === null
  ? new Set(['dungeon'])
  : loadSet(LS.hiddenCats);

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

// --- hand-ticked progress ---------------------------------------------------
// The ✋ categories aren't in the Palworld save, so localStorage used to be
// their only home and clearing site data lost them. The server now keeps them
// in its own progress.json — same trick that fixed auto-sync in Brave, applied
// to the other direction. localStorage stays as a mirror so the manual
// file-picker path still works with no server.
let progressKey = null;
let progressTimer = null;

function persistManual() {
  saveSet(LS.manual, manual);
  if (!progressKey) return;
  // Debounced: ticking several markers in a row is one write, not five.
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => {
    fetch(`/api/progress?world=${encodeURIComponent(progressKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual: [...manual] }),
    }).catch(() => { /* keep going; localStorage already has it */ });
  }, 400);
}

async function loadManual(worldId) {
  progressKey = worldId;
  try {
    const res = await fetch(`/api/progress?world=${encodeURIComponent(worldId)}`);
    if (!res.ok) return;
    const saved = (await res.json()).manual;
    if (Array.isArray(saved) && saved.length) {
      // The file is authoritative once it exists, otherwise un-ticking would
      // be undone on the next reload.
      manual = migrate(saved);
      saveSet(LS.manual, manual);
    } else if (manual.size) {
      persistManual();   // first run: lift existing local ticks into the file
    }
  } catch { /* no server (file-picker mode) — localStorage carries on */ }
}

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
const overlay = L.imageOverlay(MAPS[0].texture, bounds).addTo(map);
// The sidebar floats over the map's left edge, so bias the initial fit right by
// its width — otherwise the island centres partly underneath it.
map.fitBounds(bounds, { paddingTopLeft: [300, 0] });
map.setMaxBounds([[-IMAGE * 0.1, -IMAGE * 0.1], [IMAGE * 1.1, IMAGE * 1.1]]);

// --- load markers -----------------------------------------------------------
const res = await fetch('data/markers.json');
const { categories, markers: allMarkers } = await res.json();

// Every marker belongs to exactly one map, so its pin is built once with that
// map's transform and never has to move. Switching maps only changes which pins
// are on screen, not where any of them are.
let activeMap = MAPS.find(m => m.id === localStorage.getItem('palmap.map')) || MAPS[0];
let markers = [];

const byCategory = new Map();     // active map only — drives the sidebar and counts
const everyCategory = new Map();  // both maps — drives the save join
const pins = new Map();     // marker id -> L.Marker
const layers = new Map();   // category id -> L.LayerGroup

for (const cat of categories) {
  layers.set(cat.id, L.layerGroup().addTo(map));
  byCategory.set(cat.id, []);
  everyCategory.set(cat.id, []);
}
for (const m of allMarkers) everyCategory.get(m.category)?.push(m);

// Rebuilds everything that depends on which map is showing. Cheap enough to run
// on every switch: it re-buckets ~1,150 markers and repaints one list.
function selectMap(next, { fit = true } = {}) {
  activeMap = next;
  localStorage.setItem('palmap.map', next.id);

  overlay.setUrl(next.texture);
  markers = allMarkers.filter(m => mapOf(m) === next);

  for (const cat of categories) byCategory.set(cat.id, []);
  for (const m of markers) byCategory.get(m.category)?.push(m);

  for (const layer of layers.values()) layer.clearLayers();
  for (const btn of document.querySelectorAll('[data-map]')) {
    btn.classList.toggle('on', btn.dataset.map === next.id);
  }

  renderSidebar();
  applyVisibility();
  updateCounts();
  placePlayer();
  if (fit) map.fitBounds(bounds, { paddingTopLeft: [300, 0] });
}

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Sidebar icons for the categories whose *map* pins are per-Pal portraits, so
// there's no single pin image to reuse. Effigies borrow Lifmunk — the classic
// one — and the bosses use the game's own compass crests.
const CAT_ICON = {
  effigy: 'icons/effigy/Lifmunk_Effigy_icon.webp',
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

  if (m.category === 'effigy' && m.icon) {
    // Effigy icons are their own transparent art, so they show bare — no disc,
    // no ring — unlike the square Pal portraits below which need a circular frame.
    html = `<div class="effigy-pin" style="width:${size}px;height:${size}px">
              <img src="data/icons/${m.icon}" alt="" decoding="async"></div>`;
  } else if (m.icon) {
    // Bosses show the Pal's square portrait, cropped to a disc and ringed in
    // their category colour.
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

  const marker = L.marker(worldToLatLng(m.x, m.y, mapOf(m)), {
    icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
    keyboard: false,
  });
  marker.on('click', () => openPopup(m, marker));
  return marker;
}

const catName = id => (categories.find(c => c.id === id) || {}).name || id;

function openPopup(m, marker) {
  const fromSave = auto.has(m.id);
  const found = isFound(m.id);
  const [mapX, mapY] = toMapCoords(m.x, m.y, mapOf(m));
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="popup-title">${escapeHtml(m.label)}</div>
    <div class="popup-meta">
      ${escapeHtml(catName(m.category))} &middot; ${mapX}, ${mapY}
      ${fromSave ? '<br><span class="src-auto">✓ found — from your save</span>' : ''}
    </div>`;
  if (!fromSave) {
    const btn = document.createElement('button');
    btn.className = 'popup-btn';
    btn.textContent = found ? 'Mark as not found' : 'Mark as found';
    btn.onclick = () => {
      if (manual.has(m.id)) manual.delete(m.id); else manual.add(m.id);
      persistManual();
      applyVisibility();
      updateCounts();
      marker.closePopup();
    };
    el.appendChild(btn);
  }
  marker.bindPopup(el).openPopup();
}

for (const m of allMarkers) {
  const pin = pinFor(m);
  pins.set(m.id, pin);
}

// --- live from your save ----------------------------------------------------
// Two things that aren't collectibles and so aren't markers: where you're
// standing, and the pins you dropped on the in-game map. Both come from the
// save and are replaced wholesale on every sync, so they live in their own
// layer with no category, no count and no tick.
let playerPos = null;    // { x, y } raw world coords, from LastTransform
let customPins = [];     // [{ x, y }] from LocalData.sav
const liveLayer = L.layerGroup().addTo(map);

function livePin(pos, html, size, popup) {
  const pin = L.marker(worldToLatLng(pos.x, pos.y, activeMap), {
    icon: L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] }),
    keyboard: false,
    zIndexOffset: 1000,
  });
  const [mx, my] = toMapCoords(pos.x, pos.y, activeMap);
  pin.bindPopup(`<div class="popup-title">${popup}</div><div class="popup-meta">${mx}, ${my}</div>`);
  return pin;
}

const YOU_PIN = `<div class="you-pin">
  <img src="data/icons/ui/T_SignBoard_Icon_Cattiva_Pleading.png" alt="" decoding="async"></div>`;

const PLAYER_COLORS = ['#38bdf8', '#f472b6', '#4ade80', '#facc15', '#c084fc', '#fb923c'];
const livePlayersLayer = L.layerGroup().addTo(map);
let livePlayers = [];
let showLivePlayers = true;

function placeLivePlayers() {
  livePlayersLayer.clearLayers();
  if (!showLivePlayers || !Array.isArray(livePlayers)) return;
  livePlayers.forEach((p, idx) => {
    const pos = { x: p.location_x, y: p.location_y };
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return;
    if (mapOf(pos) !== activeMap) return;
    const color = PLAYER_COLORS[idx % PLAYER_COLORS.length];
    const html = `<div class="live-player-pin" style="--player-color:${color}">
      <div class="live-player-dot"></div>
      <div class="live-player-label">${escapeHtml(p.name)}</div>
    </div>`;
    const pin = L.marker(worldToLatLng(pos.x, pos.y, activeMap), {
      icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
      keyboard: false,
      zIndexOffset: 1100,
    });
    const [mx, my] = toMapCoords(pos.x, pos.y, activeMap);
    pin.bindPopup(
      `<div class="popup-title">${escapeHtml(p.name)} (Lv ${p.level})</div>` +
      `<div class="popup-meta">${mx}, ${my}</div>`
    );
    livePlayersLayer.addLayer(pin);
  });
}

function placePlayer() {
  liveLayer.clearLayers();
  if (playerPos && mapOf(playerPos) === activeMap) {
    liveLayer.addLayer(livePin(playerPos, YOU_PIN, 30, 'Last saved position'));
  }
  for (const p of customPins) {
    if (mapOf(p) !== activeMap) continue;
    liveLayer.addLayer(livePin(p, '<div class="custom-pin"></div>', 16, 'Your map pin'));
  }
  placeLivePlayers();
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
  for (const cat of categories) {
    // Reference categories aren't collections, so they have no counter or bar
    // to update — see renderSidebar().
    if (cat.reference) continue;
    const mine = byCategory.get(cat.id);
    if (!mine?.length) continue;
    const found = mine.reduce((n, m) => n + (isFound(m.id) ? 1 : 0), 0);
    const el = listEl.querySelector(`[data-count="${cat.id}"]`);
    if (el) {
      el.textContent = `${found} / ${mine.length}`;
      el.classList.toggle('done', found === mine.length);
    }
    const bar = listEl.querySelector(`[data-bar="${cat.id}"]`);
    if (bar) bar.style.width = `${(found / mine.length) * 100}%`;
  }
}

function paintFoundBtn(btn, catId) {
  const s = stateOf(catId);
  btn.textContent = FOUND_GLYPH[s];
  btn.dataset.state = s;
  btn.title = `${FOUND_TITLE[s]} — click to cycle, shift-click to set every category`;
}

// Three tiers, in this order:
//   0  auto-synced collections — tick themselves from the save
//   1  hand-tracked collections — a total you can finish, but you tick it
//   2  reference — dungeons, treasure maps, warp points, skill fruit, bounties
//
// Tier 2 exists because those aren't collections at all. Dungeons reset, skill
// fruit trees regrow, bounty targets respawn; a treasure map is a place you go,
// not a thing you complete. Showing "0 / 170" against them invented a score
// nobody was playing for, and made the sidebar read as failure. They keep their
// tick — handy for marking a treasure map you've already dug — but no counter
// and no bar.
//
// Tier 1 is empty today, since every non-auto category is currently reference.
// It's here so that adding a hand-tracked *collectible* later doesn't silently
// file it under reference.
const tierOf = cat => (cat.saveFlag ? 0 : cat.reference ? 2 : 1);
const TIER_LABEL = { 1: 'Tick by hand', 2: 'Reference — not counted' };

function renderSidebar() {
  listEl.innerHTML = '';
  const ordered = [...categories].sort((a, b) => tierOf(a) - tierOf(b));
  let lastTier = 0;

  for (const cat of ordered) {
    const mine = byCategory.get(cat.id);
    if (!mine?.length) continue;

    const tier = tierOf(cat);
    if (tier !== lastTier) {
      const sep = document.createElement('li');
      sep.className = 'cat-divider';
      sep.innerHTML = `<span>${TIER_LABEL[tier]}</span>`;
      listEl.appendChild(sep);
      lastTier = tier;
    }

    // Only categories with a save flag can tick themselves; the rest are manual.
    // Saying so inline stops "why didn't my treasure maps update?" before it starts.
    const badge = cat.reference
      ? ''
      : cat.saveFlag
        ? `<span class="sync-badge" title="Supports auto-sync — these tick themselves from your save file">⟳</span>`
        : `<span class="sync-badge manual" title="Manual only — Palworld doesn't record these in the save, so tick them by hand">✋</span>`;

    const colour = COLORS[cat.id] || '#94a3b8';
    const swatch = categorySwatch(cat.id, colour);

    const li = document.createElement('li');
    li.className = cat.reference ? 'ref' : '';
    li.innerHTML = `
      <div class="cat" style="--cat:${colour}">
        <label class="cat-main">
          <input type="checkbox" data-cat="${cat.id}" ${hiddenCats.has(cat.id) ? '' : 'checked'}>
          ${swatch}
          <span class="name">${escapeHtml(cat.name)}</span>
          ${badge}
          ${cat.reference ? `<span class="count ref-count">${mine.length}</span>`
        : `<span class="count" data-count="${cat.id}"></span>`}
        </label>
        <button class="found-btn" data-found="${cat.id}"></button>
      </div>
      ${cat.reference ? '' : `<div class="cat-bar"><i data-bar="${cat.id}"></i></div>`}`;
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
    // Every marker on both maps, not just the visible one — otherwise switching
    // maps would quietly discard the other map's progress on the next sync.
    for (const m of everyCategory.get(cat.id) || []) {
      if (flags.has(m.key)) { next.add(m.id); matched++; }
    }
  }

  // Where the character was standing when the game last wrote the save. Free —
  // this file is already fetched and parsed on every sync.
  const t = save.data?.SaveData?.LastTransform?.Translation;
  playerPos = t && Number.isFinite(t.x) ? { x: t.x, y: t.y } : null;

  auto = next;
  saveSet(LS.auto, auto);
  if (label) localStorage.setItem(LS.profile, label);
  applyVisibility();
  updateCounts();
  placePlayer();
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
  playerField: document.getElementById('player-field'),
  playerSelect: document.getElementById('player-select'),
  syncActions: document.getElementById('sync-actions'),
  refreshBtn: document.getElementById('refresh-btn'),
  autoRow: document.getElementById('auto-row'),
  autoToggle: document.getElementById('auto-toggle'),
  autoInterval: document.getElementById('auto-interval'),
  liveBar: document.getElementById('live-bar'),
  liveToggle: document.getElementById('live-toggle'),
  liveStatus: document.getElementById('live-status'),
  syncBtn: document.getElementById('sync-btn'),
};

const LS_WORLD = 'palmap.worldId';
const LS_PLAYER = 'palmap.playerUid';
const LS_AUTO_ON = 'palmap.autoOn';
const LS_AUTO_MINS = 'palmap.autoMins';
const LS_LIVE_ON = 'palmap.liveOn';

let worlds = [];
let players = [];
let lastMtime = null;
let autoTimer = null;
let liveTimer = null;

const currentWorld = () => worlds[Number(els.worldSelect.value)] || null;
const worldLabel = w =>
  `${w.name}${w.host ? ` — ${w.host}` : ''}${w.level != null ? ` (Lv ${w.level})` : ''}`;

// The server hands over LevelMeta.sav untouched and this decodes it, so the
// server itself needs no save-parsing library — and therefore no npm install.
// A world that won't decode still works; it just shows its folder id.
async function nameWorld(w) {
  try {
    const res = await fetch(`/api/meta?world=${encodeURIComponent(w.id)}`);
    if (!res.ok) throw new Error(res.status);
    const sd = parseSave(new Uint8Array(await res.arrayBuffer())).data?.SaveData || {};
    return { ...w, name: sd.WorldName || w.folder, host: sd.HostPlayerName || '', level: sd.HostPlayerLevel ?? null };
  } catch {
    return { ...w, name: w.folder, host: '', level: null };
  }
}

// Footer stamp — shows at a glance which app.js ran and which path is live.
const VERSION = '1.5.0';
const stamp = mode => {
  const el = document.getElementById('ver');
  if (el) el.innerHTML =
    `<a class="author" href="https://voidpossum.carrd.co/" target="_blank" rel="noopener">Void Possum</a>`
    + ` · v${VERSION} · ${escapeHtml(mode)}`;
};

// --- update check -------------------------------------------------------
// The only outbound request PalMap ever makes. Reads package.json straight off
// GitHub's raw-file CDN rather than the Releases API: the repo has tags but no
// published Releases, so Releases would report nothing until that habit starts,
// and package.json is already bumped on every version with nothing new to keep
// in sync. Versions here are always x.y.z, so a plain per-segment numeric
// compare is all that's needed — no semver library.
const UPDATE_URL = 'https://raw.githubusercontent.com/voidpossum/PalMap/main/package.json';
const LS_UPDATE_CHECKED = 'palmap.lastUpdateCheck';
const LS_UPDATE_LATEST = 'palmap.latestVersion';
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const isNewer = (a, b) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
};

function paintUpdateBadge(latest) {
  const badge = document.getElementById('update-badge');
  if (badge) badge.hidden = !(latest && isNewer(latest, VERSION));
}

async function checkForUpdate({ force = false } = {}) {
  const statusEl = document.getElementById('update-status');
  const lastChecked = Number(localStorage.getItem(LS_UPDATE_CHECKED));
  const cached = localStorage.getItem(LS_UPDATE_LATEST);

  if (!force && lastChecked && Date.now() - lastChecked < UPDATE_INTERVAL_MS) {
    paintUpdateBadge(cached);
    return;
  }

  if (force && statusEl) statusEl.textContent = 'Checking…';
  try {
    const res = await fetch(`${UPDATE_URL}?_=${Date.now()}`);
    if (!res.ok) throw new Error(res.status);
    const latest = (await res.json()).version;
    if (typeof latest !== 'string') throw new Error('no version field');

    // Only a *successful* check resets the clock — a blocked or offline
    // attempt shouldn't start a fake day-long cooldown, it should just try
    // again next launch.
    localStorage.setItem(LS_UPDATE_CHECKED, String(Date.now()));
    localStorage.setItem(LS_UPDATE_LATEST, latest);
    paintUpdateBadge(latest);
    if (force && statusEl) {
      statusEl.textContent = isNewer(latest, VERSION) ? '' : 'Up to date';
    }
  } catch {
    // Silent — this is a footnote, not something the app depends on.
    if (force && statusEl) statusEl.textContent = "Couldn't check right now";
  }
}

document.getElementById('update-check-btn').onclick = () => checkForUpdate({ force: true });

const currentPlayerUid = () => els.playerSelect?.value || '';
const progressScopeKey = (w, uid) => (uid ? `${w.id}:${uid}` : w.id);

async function syncWorld(w, playerUid = currentPlayerUid(), isAuto = false) {
  const q = new URLSearchParams({ world: w.id });
  if (playerUid) q.set('player', playerUid);
  const res = await fetch(`/api/save?${q}`);
  if (!res.ok) throw new Error(`Could not read the save (${res.status})`);

  const mtime = Number(res.headers.get('X-Save-Mtime'));
  const before = auto.size;
  const playerObj = players.find(p => p.uid === playerUid);
  const label = playerObj ? `${w.name} (${playerObj.name})` : w.name;
  const matched = syncFromBytes(new Uint8Array(await res.arrayBuffer()), label);
  const gained = auto.size - before;
  lastMtime = mtime;

  const saved = mtime ? new Date(mtime).toLocaleTimeString() : 'unknown';
  const delta = gained > 0 ? ` (+${gained} new)` : '';
  setStatus(
    `${isAuto ? 'Auto-synced' : 'Synced'} ${matched} markers${delta} · game last saved ${saved}`,
    'ok'
  );
}

// Palworld writes the save on a timer, and the world decides that timer:
// WorldOption.sav's autoSaveSpan, 30 seconds by default. Nothing PalMap does can
// beat it, so hammering Sync now after picking something up can only ever show
// the same numbers. Reading the actual value beats a hardcoded guess — a server
// with a slower span would otherwise look broken for minutes at a time.
let autoSaveSpan = null;

async function readAutoSaveSpan(w) {
  try {
    const res = await fetch(`/api/worldoption?world=${encodeURIComponent(w.id)}`);
    if (!res.ok) throw new Error(res.status);
    const sd = parseSave(new Uint8Array(await res.arrayBuffer())).data?.OptionWorldData?.Settings;
    const span = Number(sd?.autoSaveSpan);
    autoSaveSpan = Number.isFinite(span) && span > 0 ? span : null;
  } catch {
    autoSaveSpan = null;
  }
  const el = document.getElementById('save-note');
  if (el) {
    el.textContent = `Palworld saves every ${autoSaveSpan ?? 30}s — anything you just picked up shows up within about that long.`;
    el.hidden = false;
  }
}

// The pins you dropped on the in-game map. Optional in every sense: co-op guests
// have no LocalData.sav, and the reader returns nothing rather than throwing if
// the format shifts.
async function readMapPins(w) {
  try {
    const res = await fetch(`/api/localdata?world=${encodeURIComponent(w.id)}`);
    if (!res.ok) throw new Error(res.status);
    customPins = readCustomPins(new Uint8Array(await res.arrayBuffer()));
  } catch {
    customPins = [];
  }
  placePlayer();
}

function renderPlayerOptions(selectedUid) {
  els.playerSelect.innerHTML = '';
  for (const p of players) {
    const o = document.createElement('option');
    o.value = p.uid;
    o.textContent = p.name;
    els.playerSelect.appendChild(o);
  }
  if (selectedUid && players.some(p => p.uid === selectedUid)) {
    els.playerSelect.value = selectedUid;
  } else if (players.length > 0) {
    els.playerSelect.value = players[0].uid;
  }
  els.playerField.hidden = players.length === 0;
}

async function loadPlayersForWorld(w) {
  try {
    const res = await fetch(`/api/players?world=${encodeURIComponent(w.id)}`);
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    players = Array.isArray(data.players) ? data.players : [];
  } catch {
    players = [];
  }
  const remembered = localStorage.getItem(LS_PLAYER);
  renderPlayerOptions(remembered);
}

async function selectPlayer(uid, isAuto = false) {
  const w = currentWorld();
  if (!w) return;
  if (uid) localStorage.setItem(LS_PLAYER, uid);
  await loadManual(progressScopeKey(w, uid));
  try { await syncWorld(w, uid, isAuto); }
  catch (err) { console.error(err); setStatus(err.message, 'err'); }
}

async function selectWorld(i, isAuto = false) {
  const w = worlds[i];
  if (!w) return;
  localStorage.setItem(LS_WORLD, w.id);
  readAutoSaveSpan(w);
  readMapPins(w);
  await loadPlayersForWorld(w);
  await selectPlayer(currentPlayerUid(), isAuto);
}

async function autoTick() {
  const w = currentWorld();
  if (!w) return;
  const uid = currentPlayerUid();
  try {
    const q = new URLSearchParams({ world: w.id });
    if (uid) q.set('player', uid);
    const res = await fetch(`/api/status?${q}`);
    if (!res.ok) return;
    const { mtime } = await res.json();
    if (String(mtime) === String(lastMtime)) return;
    await syncWorld(w, uid, true);
  } catch (err) {
    console.error(err);
  }
}

async function pollLivePlayers() {
  try {
    const res = await fetch('/api/live-players');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.configured) {
      els.liveBar.hidden = true;
      return;
    }
    els.liveBar.hidden = false;
    if (data.serverOnline) {
      livePlayers = data.players || [];
      els.liveStatus.textContent = `${livePlayers.length} online`;
      els.liveStatus.className = 'live-status online';
      // Refresh player dropdown names if any previously unknown UID just came online.
      const w = currentWorld();
      if (w && players.some(p => !p.hasKnownName)) {
        const prev = currentPlayerUid();
        await loadPlayersForWorld(w);
        if (prev) els.playerSelect.value = prev;
      }
    } else {
      livePlayers = [];
      els.liveStatus.textContent = 'Server offline';
      els.liveStatus.className = 'live-status offline';
    }
    placeLivePlayers();
  } catch {
    // Silent on transient network errors.
  }
}

function setupLivePolling() {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  showLivePlayers = els.liveToggle.checked;
  localStorage.setItem(LS_LIVE_ON, showLivePlayers ? '1' : '0');
  placeLivePlayers();
  if (showLivePlayers) {
    pollLivePlayers();
    liveTimer = setInterval(pollLivePlayers, 3000);
  } else {
    els.liveStatus.textContent = 'Paused';
    els.liveStatus.className = 'live-status';
  }
}

function setupAuto() {
  if (autoTimer) { clearInterval(autoTimer); autoTimer = null; }
  localStorage.setItem(LS_AUTO_ON, els.autoToggle.checked ? '1' : '0');
  localStorage.setItem(LS_AUTO_MINS, els.autoInterval.value);
  if (els.autoToggle.checked) autoTimer = setInterval(autoTick, Number(els.autoInterval.value) * 60000);
}

fetch('/api/worlds').then(r => (r.ok ? r.json() : [])).then(async list => {
  // No saves found (or not running under the local server) — leave the manual
  // file picker as the primary control.
  if (!Array.isArray(list) || !list.length) { stamp('file mode'); return; }
  worlds = await Promise.all(list.map(nameWorld));

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
  stamp('family server');

  els.autoToggle.checked = (localStorage.getItem(LS_AUTO_ON) ?? '1') === '1';
  els.autoInterval.value = localStorage.getItem(LS_AUTO_MINS) || '1';
  els.liveToggle.checked = (localStorage.getItem(LS_LIVE_ON) ?? '1') === '1';

  els.worldSelect.onchange = () => selectWorld(Number(els.worldSelect.value));
  els.playerSelect.onchange = () => selectPlayer(currentPlayerUid());
  els.refreshBtn.onclick = () => selectPlayer(currentPlayerUid());
  els.autoToggle.onchange = setupAuto;
  els.autoInterval.onchange = setupAuto;
  els.liveToggle.onchange = setupLivePolling;

  const remembered = localStorage.getItem(LS_WORLD);
  const i = Math.max(0, worlds.findIndex(w => w.id === remembered));
  els.worldSelect.value = String(i);
  await selectWorld(i);
  setupAuto();
  setupLivePolling();
}).catch(err => { console.error(err); stamp('file mode'); });


// --- search -----------------------------------------------------------------
// Type a name and jump to it. Matches any marker's label (boss/Pal names,
// effigies, fast-travel points…); picking one reveals it and flies the map over.
const searchInput = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');

// Pre-split each label into a lowercase haystack once, so keystrokes are cheap.
// Deliberately spans both maps: searching for a World Tree effigy while looking
// at Palpagos should find it and take you there, not silently return nothing.
const searchIndex = allMarkers.map(m => ({ m, hay: m.label.toLowerCase() }));

let searchSel = -1;   // highlighted result for keyboard nav

function renderSearch(q) {
  const query = q.trim().toLowerCase();
  if (!query) { closeSearch(); return; }

  const hits = [];
  for (const e of searchIndex) {
    if (e.hay.includes(query)) hits.push(e.m);
    if (hits.length >= 12) break;
  }

  if (!hits.length) {
    searchResults.innerHTML = '<li class="search-empty">No matches</li>';
    searchResults.hidden = false;
    searchSel = -1;
    return;
  }

  searchResults.innerHTML = hits.map((m, i) => `
    <li class="search-hit" data-id="${m.id}" data-i="${i}" role="option">
      <span class="dot" style="background:${COLORS[m.category] || '#94a3b8'}"></span>
      <span class="hit-label">${escapeHtml(m.label)}</span>
      <span class="hit-cat">${escapeHtml(catName(m.category)
      + (mapOf(m) === activeMap ? '' : ` · ${mapOf(m).name}`))}</span>
    </li>`).join('');
  searchResults.hidden = false;
  searchSel = -1;

  searchResults.querySelectorAll('.search-hit').forEach(li =>
    li.addEventListener('click', () => goToMarker(li.dataset.id)));
}

function closeSearch() {
  searchResults.hidden = true;
  searchResults.innerHTML = '';
  searchSel = -1;
}

function goToMarker(id) {
  const m = allMarkers.find(x => x.id === id);
  const pin = pins.get(id);
  if (!m || !pin) return;

  // A hit on the other map is still a hit — switch to it rather than doing
  // nothing. No fit, because we're about to fly to the marker anyway.
  if (mapOf(m) !== activeMap) selectMap(mapOf(m), { fit: false });

  // The user searched for it, so make sure it's actually on the map even if its
  // category is toggled off or its "found" markers are hidden.
  const layer = layers.get(m.category);
  if (layer && !layer.hasLayer(pin)) layer.addLayer(pin);

  map.setView(pin.getLatLng(), Math.max(map.getZoom(), 0));
  openPopup(m, pin);
  closeSearch();
  searchInput.blur();
}

searchInput.addEventListener('input', () => renderSearch(searchInput.value));
searchInput.addEventListener('focus', () => { if (searchInput.value) renderSearch(searchInput.value); });

searchInput.addEventListener('keydown', e => {
  const hits = [...searchResults.querySelectorAll('.search-hit')];
  if (e.key === 'Escape') { closeSearch(); searchInput.blur(); return; }
  if (!hits.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    searchSel = (searchSel + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length;
    hits.forEach((li, i) => li.classList.toggle('sel', i === searchSel));
    hits[searchSel].scrollIntoView({ block: 'nearest' });
  } else if (e.key === 'Enter') {
    e.preventDefault();
    (hits[searchSel] || hits[0]).click();
  }
});

// Click outside the search box closes the dropdown.
document.addEventListener('click', e => {
  if (!document.getElementById('search').contains(e.target)) closeSearch();
});

const profile = localStorage.getItem(LS.profile);
if (profile) setStatus(`Last synced from ${profile}`);

// --- map switcher -----------------------------------------------------------
const switchEl = document.getElementById('map-switch');
for (const m of MAPS) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.map = m.id;
  btn.textContent = m.name;
  btn.onclick = () => { if (m !== activeMap) selectMap(m); };
  switchEl.appendChild(btn);
}

selectMap(activeMap);
