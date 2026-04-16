#!/usr/bin/env node
/**
 * Minimal static server for a CRA `build/` folder (SPA fallback to index.html).
 * Used by Playwright webServer — avoids `serve` calling os.networkInterfaces() in restricted envs.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '../../unified-dashboard/littlelab-landing/build'));
const port = Number(process.argv[3] || process.env.PORT || 5199, 10);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

function safeJoin(base, rel) {
  const baseR = path.resolve(base);
  const target = path.resolve(path.join(baseR, rel));
  if (!target.startsWith(baseR + path.sep) && target !== baseR) return null;
  return target;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let rel = urlPath === '/' ? '/index.html' : urlPath;
  let file = safeJoin(root, rel.slice(1));

  if (file && fs.existsSync(file) && fs.statSync(file).isFile()) {
    const ext = path.extname(file);
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
    return;
  }

  const indexPath = path.join(root, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  res.statusCode = 404;
  res.end('Not found');
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[serve-cra-build] Port ${port} is already in use (another \`serve:landing\`, Playwright webServer, or stray process).\n` +
        `  Stop it:  lsof -nP -iTCP:${port} -sTCP:LISTEN\n` +
        `  Or use another port:  PW_LANDING_PORT=5200 npx playwright test …  (and rebuild if you changed static port logic)`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`serve-cra-build ${root} http://127.0.0.1:${port}\n`);
});
