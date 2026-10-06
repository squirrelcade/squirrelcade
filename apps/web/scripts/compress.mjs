// After the build: a Brotli (.br) and a gzip (.gz) copy of each text file in dist, which the server sends to
// browsers that accept them (@fastify/static's preCompressed), so pages load faster without a proxy compressing.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const dist = new URL('../dist/', import.meta.url);
const TEXT = /\.(js|css|html|svg|json|webmanifest|txt)$/;
let files = 0;
let before = 0;
let after = 0;

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (TEXT.test(name) && !name.endsWith('.map')) {
      const body = readFileSync(path);
      // Tiny files gain nothing.
      if (body.length < 1024) continue;
      const br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } });
      writeFileSync(`${path}.br`, br);
      writeFileSync(`${path}.gz`, gzipSync(body, { level: 9 }));
      files++;
      before += body.length;
      after += br.length;
    }
  }
}

const root = dist.pathname.replace(/^\/([A-Za-z]:)/, '$1');

// The files the service worker (public/sw.js) keeps on a device for opening with no connection: the build's
// assets (never source maps) and the icons, with a version that changes when any file does: its name, or what's in
// it (the icons keep their names when they change).
const offline = [
  ...readdirSync(join(root, 'assets'))
    .filter((n) => !n.endsWith('.map') && !n.endsWith('.br') && !n.endsWith('.gz'))
    .map((n) => `/assets/${n}`),
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icon-192.png',
].sort();
const hash = createHash('sha256');
for (const file of offline) hash.update(`${file}\n`).update(readFileSync(join(root, file.slice(1))));
const version = hash.digest('hex').slice(0, 16);
writeFileSync(join(root, 'offline-files.json'), JSON.stringify({ version, files: offline }));

walk(root);
console.log(`Compressed ${files} files: ${Math.round(before / 1024)} kB, ${Math.round(after / 1024)} kB with Brotli.`);
