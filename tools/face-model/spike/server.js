// Phase 0 spike static server.
// Serves the benchmark page, model artifacts, and the LiteRT.js runtime
// (ESM bundle + WASM assets) from node_modules — same-origin, no CDN,
// mirroring the production constraint that models are served by the backend.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 4173;
const ROOT = __dirname;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.tflite': 'application/octet-stream',
  '.map': 'application/json',
};

// URL prefix -> filesystem directory
const MOUNTS = [
  ['/litert-wasm/', path.join(ROOT, 'node_modules/@litertjs/core/wasm')],
  ['/litert/', path.join(ROOT, 'node_modules/@litertjs/core/dist')],
  ['/litert-wasm-utils/', path.join(ROOT, 'node_modules/@litertjs/wasm-utils/dist')],
  ['/models/', path.join(ROOT, 'models')],
  ['/', ROOT],
];

// No COOP/COEP headers: LiteRT.js only loads its threaded WASM build when
// `loadLiteRt` is passed `{threads: true}`, which bench.js deliberately does not
// do. Serving cross-origin-isolated would therefore change nothing about what is
// measured, while diverging from the production backend (plan Section 6.1 keeps
// COOP/COEP off). Omitting them keeps the spike an honest mirror of production.
function resolveWithin(dir, rel) {
  const file = path.resolve(dir, rel);
  const relative = path.relative(dir, file);
  const escapes = relative.startsWith('..') || path.isAbsolute(relative);
  return escapes ? null : file;
}

http
  .createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const mount = MOUNTS.find(([prefix]) => urlPath.startsWith(prefix));
    const rel = urlPath === '/' ? 'index.html' : urlPath.slice(mount[0].length);
    const file = resolveWithin(mount[1], rel);
    if (!file) {
      res.writeHead(403).end('forbidden');
      return;
    }
    fs.readFile(file, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res
        .writeHead(200, {
          'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
          'Cache-Control': 'no-store',
        })
        .end(data);
    });
  })
  // Loopback only — this serves node_modules/ and must not be reachable on the LAN.
  .listen(PORT, '127.0.0.1', () => console.log(`face-litert-spike on http://localhost:${PORT}`));
