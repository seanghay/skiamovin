// Minimal static server for browser tests.

import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('../../', import.meta.url));
const repo = join(pkg, '..', '..');
const MOUNTS = {
  '/pkg/': pkg,
  '/modules/': join(repo, 'node_modules/'),
  '/out/': join(repo, 'test-output/'),
  '/fonts/': '/System/Library/Fonts/Supplemental/',
};
const TYPES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.html': 'text/html',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// Import maps don't apply inside module workers, so bare specifiers in served JS are rewritten here instead.
const BARE = {
  skiamovin: '/pkg/dist/index.js',
  'skiamovin/scene': '/pkg/dist/scene/index.js',
  'skiamovin/media': '/pkg/dist/media/index.js',
  'skiamovin/taffy': '/pkg/dist/taffy/index.js',
  '#loader': '/pkg/dist/native/loader-wasm.js',
  mediabunny: '/modules/mediabunny/dist/bundles/mediabunny.mjs',
};
const rewrite = (src) =>
  src.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"./][^'"]*)\2/g, (m, pre, q, spec) =>
    BARE[spec] ? `${pre}${q}${BARE[spec]}${q}` : m,
  );

export function startServer(port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      const mount = Object.keys(MOUNTS).find((m) => url.pathname.startsWith(m));
      if (!mount) throw new Error('not found');
      const file = normalize(join(MOUNTS[mount], decodeURIComponent(url.pathname.slice(mount.length))));
      if (!file.startsWith(normalize(MOUNTS[mount]))) throw new Error('forbidden');
      const s = await stat(file);
      if (!s.isFile()) throw new Error('not a file');
      let body = await readFile(file);
      if (extname(file) === '.js' && !file.includes('node_modules') && !file.includes('/wasm/'))
        body = Buffer.from(rewrite(body.toString('utf8')));
      const headers = {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cross-origin-opener-policy': 'same-origin',
        'cross-origin-embedder-policy': 'require-corp',
        'cross-origin-resource-policy': 'same-origin',
        'cache-control': 'no-store',
        'accept-ranges': 'bytes',
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = range[1] ? Number(range[1]) : body.length - Number(range[2]);
        const end = range[1] && range[2] ? Math.min(Number(range[2]), body.length - 1) : body.length - 1;
        res.writeHead(206, {
          ...headers,
          'content-range': `bytes ${start}-${end}/${body.length}`,
          'content-length': end - start + 1,
        });
        res.end(req.method === 'HEAD' ? undefined : body.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { ...headers, 'content-length': body.length });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(404);
      res.end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}
