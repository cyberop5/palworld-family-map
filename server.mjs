// Tiny static server, plus a strictly read-only local API over the Palworld
// save folder.
//
// Why the API exists: browsers can only re-read a file on their own via the
// File System Access API, which Brave disables and Firefox never shipped. So
// the server does the file reading instead and the page polls it. That makes
// auto-sync work everywhere with no browser flags and no folder picking.
//
// It is deliberately narrow: bound to 127.0.0.1 (never reachable from the
// network), it only ever reads, and every path it opens is forced to stay
// inside the save folder.
//
// © Void Possum

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseSave } from './src/palsave.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// PAL_SAVES overrides for non-standard installs (or for testing).
const SAVES = process.env.PAL_SAVES
  ? path.resolve(process.env.PAL_SAVES)
  : process.env.LOCALAPPDATA
    ? path.resolve(process.env.LOCALAPPDATA, 'Pal/Saved/SaveGames')
    : null;

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

// The local single-player host always occupies this slot; co-op guests get hex
// names and *_dps files are differential backups, which we skip.
const HOST_SLOT = '00000000000000000000000000000001.sav';
function pickPlayer(worldDir) {
  let files;
  try { files = fs.readdirSync(path.join(worldDir, 'Players')); }
  catch { return null; }
  files = files.filter(n => n.toLowerCase().endsWith('.sav') && !n.toLowerCase().includes('_dps'));
  return files.find(n => n === HOST_SLOT) || files[0] || null;
}

// SaveGames/<SteamID>/<WorldID>/{LevelMeta.sav, Players/*.sav}
function listWorlds() {
  if (!SAVES || !fs.existsSync(SAVES)) return [];
  const out = [];
  for (const account of dirsIn(SAVES)) {
    for (const world of dirsIn(path.join(SAVES, account))) {
      const dir = path.join(SAVES, account, world);
      if (!fs.existsSync(path.join(dir, 'LevelMeta.sav'))) continue;
      const player = pickPlayer(dir);
      if (!player) continue;

      // LevelMeta is what turns "8247F1A5…" into a name a human recognises.
      let name = world, host = '', level = null;
      try {
        const sd = parseSave(new Uint8Array(fs.readFileSync(path.join(dir, 'LevelMeta.sav')))).data?.SaveData || {};
        name = sd.WorldName || world;
        host = sd.HostPlayerName || '';
        level = sd.HostPlayerLevel ?? null;
      } catch { /* unreadable meta — still usable, just unnamed */ }

      out.push({ id: `${account}/${world}`, name, host, level, player });
    }
  }
  return out;
}

// Resolve a world id to its player save. The id shape is validated first (so it
// cannot contain separators or ".."), then the resolved path is re-checked
// against the save root — belt and braces against path traversal.
function playerSavePath(worldId) {
  if (!SAVES || typeof worldId !== 'string') return null;
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(worldId)) return null;
  const [account, world] = worldId.split('/');
  const dir = path.join(SAVES, account, world);
  const player = pickPlayer(dir);
  if (!player) return null;
  const file = path.resolve(dir, 'Players', player);
  if (!file.startsWith(SAVES + path.sep)) return null;
  return fs.existsSync(file) ? file : null;
}

// --- hand-ticked progress ---------------------------------------------------
// Categories like dungeons and treasure maps aren't recorded in the Palworld
// save at all, so browser localStorage was their only home — clearing site data
// wiped them. Keeping them in a file next to the server fixes that, and means
// the same ticks appear in every browser on the machine.
//
// This is the *only* thing PalMap ever writes, and it writes to its own file.
// Nothing here can touch a Palworld save: the path is a fixed constant, never
// derived from the request.
const PROGRESS_FILE = path.join(ROOT, 'progress.json');
const MAX_BODY = 2 * 1024 * 1024;
const WORLD_KEY = /^[A-Za-z0-9_\-/]{1,128}$/;

const readProgress = () => {
  try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8')); }
  catch { return {}; }
};

function writeProgress(all) {
  // Write-then-rename: a crash mid-write leaves the old file intact rather than
  // a truncated one.
  const tmp = `${PROGRESS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2));
  fs.renameSync(tmp, PROGRESS_FILE);
}

// --- request handling -------------------------------------------------------
const sendJson = (res, obj) => {
  res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

function handler(req, res) {
  const [rawPath, rawQuery] = req.url.split('?');
  const url = decodeURIComponent(rawPath);
  const params = new URLSearchParams(rawQuery || '');

  // ---- hand-ticked progress (the only writable endpoint) ----
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

  // ---- read-only save API ----
  if (url === '/api/worlds') { sendJson(res, listWorlds()); return; }

  if (url === '/api/status' || url === '/api/save') {
    const file = playerSavePath(params.get('world'));
    if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('No such save'); return; }
    const mtime = fs.statSync(file).mtimeMs;

    // /api/status is the cheap poll — a stat, no decompression — so the page
    // only downloads and re-parses the save when it has actually changed.
    if (url === '/api/status') { sendJson(res, { mtime }); return; }

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Save-Mtime': String(mtime),
    });
    res.end(fs.readFileSync(file));
    return;
  }

  // ---- static files ----
  // Redirect rather than serving app/index.html at "/", so the page's relative
  // URLs (style.css, vendor/…, data/…) resolve against /app/.
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
// Without an error handler an occupied port kills the process with a raw
// EADDRINUSE stack trace, which tells a non-technical user nothing. Try a few
// ports, then explain the fix in plain English.
const BASE = Number(process.env.PORT) || 5173;
const PORTS = [BASE, BASE + 1, BASE + 2, BASE + 3, BASE + 4];

function listen(i = 0) {
  const port = PORTS[i];
  const server = http.createServer(handler);

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
    console.error(
      `\nPalMap could not start: ports ${PORTS[0]}-${PORTS[PORTS.length - 1]} are all in use.\n` +
      `Close whatever is using them, or pick your own port:\n\n` +
      `    PORT=8080 npm start\n`
    );
    process.exit(1);
  });

  // 127.0.0.1 only: the save API must never be reachable from the network.
  server.listen(port, '127.0.0.1', () => {
    const url = `http://localhost:${port}/app/`;
    console.log(`\nPalMap running at  ${url}`);
    console.log(SAVES && fs.existsSync(SAVES)
      ? `Reading saves from ${SAVES}`
      : `No Palworld save folder found${SAVES ? ` at ${SAVES}` : ''} — set PAL_SAVES, or use the manual file picker in the page.`);

    // The launcher sets PALMAP_OPEN so the browser lands on the port we
    // actually got — the launcher can't know that in advance if 5173 was busy.
    if (process.env.PALMAP_OPEN) {
      const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
        : process.platform === 'darwin' ? ['open', [url]]
          : ['xdg-open', [url]];
      spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true }).unref();
    }
  });
}

listen();
