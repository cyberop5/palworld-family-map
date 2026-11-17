// Tiny static server, plus a strictly read-only local API over the Palworld
// save folder and an optional proxy for the Palworld Dedicated Server REST API.
//
// Zero runtime dependencies — Node's standard library only.
// Based on PalMap (© Void Possum, GPL-3.0).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// PAL_SAVES overrides for non-standard installs or Docker volume mounts.
const SAVES = process.env.PAL_SAVES
  ? path.resolve(process.env.PAL_SAVES)
  : process.env.LOCALAPPDATA
    ? path.resolve(process.env.LOCALAPPDATA, 'Pal/Saved/SaveGames')
    : null;

// DATA_DIR holds runtime state (progress.json, players-cache.json).
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;
fs.mkdirSync(DATA_DIR, { recursive: true });

// Optional Palworld Dedicated Server REST API config (server-side only; never exposed to browser).
const PALWORLD_API_BASE_URL = (process.env.PALWORLD_API_BASE_URL || '').replace(/\/+$/, '');
const PALWORLD_ADMIN_PASSWORD = process.env.PALWORLD_ADMIN_PASSWORD || '';

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.map': 'application/json',
};

// --- save folder ------------------------------------------------------------
const dirsIn = p => {
  try { return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); }
  catch { return []; }
};

const HOST_SLOT = '00000000000000000000000000000001.sav';
const PLAYER_UID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function listPlayerFiles(worldDir) {
  let files;
  try { files = fs.readdirSync(path.join(worldDir, 'Players')); }
  catch { return []; }
  return files
    .filter(n => n.toLowerCase().endsWith('.sav') && !n.toLowerCase().includes('_dps'))
    .sort((a, b) => (a === HOST_SLOT ? -1 : b === HOST_SLOT ? 1 : a.localeCompare(b)));
}

function pickPlayer(worldDir) {
  const files = listPlayerFiles(worldDir);
  return files[0] || null;
}

function listWorlds() {
  if (!SAVES || !fs.existsSync(SAVES)) return [];
  const out = [];
  for (const account of dirsIn(SAVES)) {
    for (const world of dirsIn(path.join(SAVES, account))) {
      const dir = path.join(SAVES, account, world);
      if (!fs.existsSync(path.join(dir, 'LevelMeta.sav'))) continue;
      const player = pickPlayer(dir);
      if (!player) continue;
      out.push({ id: `${account}/${world}`, folder: world, player });
    }
  }
  return out;
}

function worldDir(worldId) {
  if (!SAVES || typeof worldId !== 'string') return null;
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(worldId)) return null;
  const [account, world] = worldId.split('/');
  const dir = path.resolve(SAVES, account, world);
  return dir.startsWith(SAVES + path.sep) ? dir : null;
}

const inSaves = file => (file.startsWith(SAVES + path.sep) && fs.existsSync(file) ? file : null);

function playerSavePath(worldId, playerUid = null) {
  const dir = worldDir(worldId);
  if (!dir) return null;
  if (playerUid) {
    if (!PLAYER_UID_RE.test(playerUid)) return null;
    const target = `${playerUid}.sav`;
    const files = listPlayerFiles(dir);
    const match = files.find(f => f.toLowerCase() === target.toLowerCase());
    return match ? inSaves(path.resolve(dir, 'Players', match)) : null;
  }
  const player = pickPlayer(dir);
  return player ? inSaves(path.resolve(dir, 'Players', player)) : null;
}

const WORLD_FILES = {
  meta: 'LevelMeta.sav',
  worldoption: 'WorldOption.sav',
  localdata: 'LocalData.sav',
};

function worldFilePath(worldId, which) {
  const dir = worldDir(worldId);
  const name = WORLD_FILES[which];
  return dir && name ? inSaves(path.resolve(dir, name)) : null;
}

async function readFileWithRetry(filePath, retries = 1) {
  try {
    return await fs.promises.readFile(filePath);
  } catch (err) {
    if (retries > 0 && (err.code === 'EBUSY' || err.code === 'EAGAIN')) {
      await new Promise(r => setTimeout(r, 100));
      return readFileWithRetry(filePath, retries - 1);
    }
    throw err;
  }
}

// --- runtime state (progress + player name cache) ---------------------------
const PROGRESS_FILE = path.join(DATA_DIR, 'progress.json');
const PLAYERS_CACHE_FILE = path.join(DATA_DIR, 'players-cache.json');
const MAX_BODY = 2 * 1024 * 1024;
const WORLD_KEY = /^[A-Za-z0-9_\-/:]{1,192}$/;

const readJsonFile = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { return fallback; }
};

function writeJsonAtomic(file, obj) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file);
}

const readProgress = () => readJsonFile(PROGRESS_FILE, {});
const writeProgress = all => writeJsonAtomic(PROGRESS_FILE, all);

// Maps normalized playerId / uid prefixes to { name, playerId, userId, lastSeen }.
const readPlayersCache = () => readJsonFile(PLAYERS_CACHE_FILE, {});
function updatePlayersCache(livePlayers) {
  if (!Array.isArray(livePlayers) || livePlayers.length === 0) return;
  const cache = readPlayersCache();
  let changed = false;
  for (const p of livePlayers) {
    if (!p?.name || !p?.playerId) continue;
    const key = String(p.playerId).toLowerCase();
    const prev = cache[key];
    if (!prev || prev.name !== p.name || prev.userId !== p.userId) {
      cache[key] = {
        name: p.name,
        playerId: String(p.playerId),
        userId: p.userId ? String(p.userId) : null,
        lastSeen: new Date().toISOString(),
      };
      changed = true;
    }
  }
  if (changed) writeJsonAtomic(PLAYERS_CACHE_FILE, cache);
}

function resolveCachedPlayerName(uid, cache) {
  const lower = uid.toLowerCase();
  if (cache[lower]?.name) return cache[lower].name;
  // Palworld REST API playerId is often an 8-char hex prefix or unpadded hex of the 32-char GUID.
  for (const [k, v] of Object.entries(cache)) {
    if (!v?.name) continue;
    if (lower.startsWith(k) || k.startsWith(lower)) return v.name;
    const trimmedUid = lower.replace(/^0+/, '');
    const trimmedKey = k.replace(/^0+/, '');
    if (trimmedKey && trimmedUid && (trimmedUid.startsWith(trimmedKey) || trimmedKey.startsWith(trimmedUid))) {
      return v.name;
    }
  }
  return null;
}

// --- live players REST API proxy --------------------------------------------
const LIVE_CACHE_MS = 2000;
let liveCache = { at: 0, payload: null };

async function fetchLivePlayers() {
  if (!PALWORLD_API_BASE_URL || !PALWORLD_ADMIN_PASSWORD) {
    return { configured: false, serverOnline: false, players: [], updatedAt: null };
  }
  const now = Date.now();
  if (liveCache.payload && now - liveCache.at < LIVE_CACHE_MS) {
    return liveCache.payload;
  }

  const auth = Buffer.from(`admin:${PALWORLD_ADMIN_PASSWORD}`).toString('base64');
  let payload;
  try {
    const res = await fetch(`${PALWORLD_API_BASE_URL}/v1/api/players`, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) {
      throw new Error(`REST API returned HTTP ${res.status}`);
    }
    const data = await res.json();
    const players = Array.isArray(data?.players)
      ? data.players.map(p => ({
        name: p.name || 'Unknown',
        playerId: p.playerId != null ? String(p.playerId) : '',
        userId: p.userId != null ? String(p.userId) : '',
        location_x: Number(p.location_x),
        location_y: Number(p.location_y),
        level: Number(p.level) || 0,
        ping: Number(p.ping) || 0,
      })).filter(p => Number.isFinite(p.location_x) && Number.isFinite(p.location_y))
      : [];

    updatePlayersCache(players);
    payload = { configured: true, serverOnline: true, players, updatedAt: new Date().toISOString() };
  } catch (err) {
    payload = {
      configured: true,
      serverOnline: false,
      players: [],
      error: err?.message || 'Unable to reach Palworld server',
      updatedAt: new Date().toISOString(),
    };
  }

  liveCache = { at: now, payload };
  return payload;
}

// --- request handling -------------------------------------------------------
const sendJson = (res, obj) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

async function handler(req, res) {
  const [rawPath, rawQuery] = req.url.split('?');
  const url = decodeURIComponent(rawPath);
  const params = new URLSearchParams(rawQuery || '');

  // ---- hand-ticked progress (writable endpoint) ----
  if (url === '/api/progress') {
    const world = params.get('world') || 'default';
    if (!WORLD_KEY.test(world)) { res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad world key'); return; }

    if (req.method === 'GET') { sendJson(res, readProgress()[world] || { manual: [] }); return; }

    if (req.method === 'POST') {
      let body = '';
      let aborted = false;
      req.on('data', chunk => {
        if (aborted) return;
        body += chunk;
        if (body.length > MAX_BODY) { aborted = true; res.writeHead(413).end('Too large'); req.destroy(); }
      });
      req.on('end', () => {
        if (aborted) return;
        try {
          const parsed = JSON.parse(body);
          const manual = Array.isArray(parsed.manual)
            ? parsed.manual.filter(x => typeof x === 'string').slice(0, 50000)
            : [];
          const all = readProgress();
          all[world] = { manual, updatedAt: new Date().toISOString() };
          writeProgress(all);
          sendJson(res, { ok: true, saved: manual.length });
        } catch {
          res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad payload');
        }
      });
      return;
    }
    res.writeHead(405, { 'Content-Type': 'text/plain' }).end('Method not allowed');
    return;
  }

  // ---- live player positions (REST API proxy) ----
  if (url === '/api/live-players') {
    const data = await fetchLivePlayers();
    sendJson(res, data);
    return;
  }

  // ---- read-only save API ----
  if (url === '/api/worlds') { sendJson(res, listWorlds()); return; }

  if (url === '/api/players') {
    const dir = worldDir(params.get('world'));
    if (!dir) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No such world'); return; }
    const cache = readPlayersCache();
    const files = listPlayerFiles(dir);
    const players = files.map(filename => {
      const uid = filename.replace(/\.sav$/i, '');
      const fullPath = path.join(dir, 'Players', filename);
      let mtime = 0;
      try { mtime = fs.statSync(fullPath).mtimeMs; } catch {}
      const cachedName = resolveCachedPlayerName(uid, cache);
      const isHost = filename === HOST_SLOT;
      const fallbackLabel = isHost ? 'Host (0001)' : `Player (${uid.slice(0, 8)})`;
      return {
        uid,
        filename,
        name: cachedName || fallbackLabel,
        hasKnownName: Boolean(cachedName),
        isHost,
        mtime,
      };
    });
    sendJson(res, { players });
    return;
  }

  const which = url === '/api/meta' ? 'meta'
    : url === '/api/worldoption' ? 'worldoption'
      : url === '/api/localdata' ? 'localdata' : null;
  if (which) {
    const file = worldFilePath(params.get('world'), which);
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No such world'); return; }
    const bytes = await readFileWithRetry(file);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(bytes);
    return;
  }

  if (url === '/api/status' || url === '/api/save') {
    const file = playerSavePath(params.get('world'), params.get('player'));
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No such save'); return; }
    const mtime = fs.statSync(file).mtimeMs;

    if (url === '/api/status') { sendJson(res, { mtime }); return; }

    const bytes = await readFileWithRetry(file);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Save-Mtime': String(mtime),
    });
    res.end(bytes);
    return;
  }

  // ---- static files ----
  if (url === '/') { res.writeHead(302, { Location: '/app/' }).end(); return; }

  let file = path.join(ROOT, url);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(file).pipe(res);
}

// --- listen -----------------------------------------------------------------
const HOST = process.env.HOST || '127.0.0.1';
const BASE = Number(process.env.PORT) || 5173;
const PORTS = process.env.PORT ? [BASE] : [BASE, BASE + 1, BASE + 2, BASE + 3, BASE + 4];

function listen(i = 0) {
  const port = PORTS[i];
  const server = http.createServer((req, res) => {
    handler(req, res).catch(err => {
      console.error('Request error:', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Internal error');
    });
  });

  server.on('error', err => {
    if (err.code !== 'EADDRINUSE') {
      console.error(`\nPalMap could not start: ${err.message}\n`);
      process.exit(1);
    }
    if (i + 1 < PORTS.length) {
      console.log(`Port ${port} is in use, trying ${PORTS[i + 1]}…`);
      listen(i + 1);
      return;
    }
    console.error(`\nPalMap could not start: port ${port} is in use.\n`);
    process.exit(1);
  });

  server.listen(port, HOST, () => {
    const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${port}/app/`;
    console.log(`\nPalworld Family Map running at ${url} (bound ${HOST}:${port})`);
    console.log(SAVES && fs.existsSync(SAVES)
      ? `Reading saves from ${SAVES}`
      : `No Palworld save folder found${SAVES ? ` at ${SAVES}` : ''} — set PAL_SAVES.`);
    console.log(PALWORLD_API_BASE_URL
      ? `Live player REST API: ${PALWORLD_API_BASE_URL}`
      : `Live player REST API disabled (PALWORLD_API_BASE_URL not set).`);

    if (process.env.PALMAP_OPEN) {
      const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]]
          : ['xdg-open', [url]];
      spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
    }
  });
}

listen();
