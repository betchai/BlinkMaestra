import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleApi, send } from './src/router.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const PORT = Number(process.env.PORT || 4173);

function mime(file) {
  if (file.endsWith('.js')) return 'text/javascript';
  if (file.endsWith('.css')) return 'text/css';
  if (file.endsWith('.html')) return 'text/html';
  if (file.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url.pathname);
    }
    // Static files with traversal protection. Landing page is the homepage; app lives at /app.
    const routes = { '/': '/landing.html', '/app': '/index.html', '/app/': '/index.html' };
    const requested = routes[url.pathname] || url.pathname;
    const file = path.resolve(publicDir, '.' + requested);
    if (!file.startsWith(publicDir) || !existsSync(file)) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-cache' });
    res.end(await readFile(file));
  } catch (error) {
    console.error(error);
    const status = error.status || 500;
    const message =
      error.status && error.message
        ? error.message
        : 'We could not complete that action right now. Your work has been saved. Please try again.';
    send(res, status, { error: message });
  }
});

server.listen(PORT, () => console.log(`BLinkMaestra running at http://localhost:${PORT}`));
