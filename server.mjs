// Tiny static server. The web root is the project root so that app/ can import
// the shared save-parsing modules from src/.
//
// © Void Possum

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 5173;

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.map': 'application/json',
};

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);

  // Redirect rather than serving app/index.html at "/", so the page's relative
  // URLs (style.css, vendor/…, data/…) resolve against /app/.
  if (url === '/') { res.writeHead(302, { Location: '/app/' }).end(); return; }

  let file = path.join(ROOT, url);

  // Never serve outside the project.
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404).end('Not found'); return; }

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`PalMap running at http://localhost:${PORT}/`);
});
