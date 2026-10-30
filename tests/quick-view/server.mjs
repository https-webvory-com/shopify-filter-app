import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
export const createFixtureServer = () => http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (pathname === '/fr/cart') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>Theme cart page fixture</title><main id="theme-cart-page">Cart</main>');
    return;
  }
  const allowed = pathname.startsWith('/tests/quick-view/') || pathname.startsWith('/extensions/theme-extension/assets/quickView');
  const file = path.resolve(root, `.${pathname}`);
  if (!allowed || !file.startsWith(root + path.sep)) { response.writeHead(404).end(); return; }
  try {
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'text/javascript');
    response.end(await fs.readFile(file));
  } catch { response.writeHead(404).end(); }
});

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createFixtureServer().listen(4179, '127.0.0.1', () => console.log('Quick View fixtures: http://127.0.0.1:4179/tests/quick-view/index.html'));
}
