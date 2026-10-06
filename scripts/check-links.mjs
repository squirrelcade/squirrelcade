#!/usr/bin/env node
// The monthly upkeep check (STATUS, "Next 9"): every outside address that Help, squirrelcade.com and the app itself
// point people to, asked for once, politely (a few at a time, a pause per site). Prints what failed; with
// "--report <file>" also writes it as Markdown for an issue. Exits 1 when an address is broken (gone, or the site
// down); a site that turns scripts away (401, 403, 429) is listed to check by hand, not counted as broken.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PLACES = ['docs/help', 'docs/MATCHING.md', 'README.md', 'site/index.html', 'packages/core/src', 'apps/web/src'];
const TEXT = /\.(md|html|ts|tsx)$/;
/** Addresses that aren't pages for people: examples, local ones, templates, services' API endpoints, the private repository. */
const SKIP = [
  /\{|\$\{|%s/,
  /^https?:\/\/(localhost|127\.|192\.0\.2\.|10\.|192\.168\.)/,
  /\.(example|test|invalid|local)(\/|:|$)/,
  /example\.(com|org|net)/,
  /^https?:\/\/(api|id)\./,
  /\/api\/v\d|\/v4\/|\/oauth2\//,
  /discord\.com\/api\/webhooks/,
  /github\.com\/squirrelcade\/squirrelcade/,
  /^https?:\/\/images\.igdb\.com\/igdb\/image\/upload\/t_[a-z_]+\/?$/,
];

function files(path) {
  const full = join(ROOT, path);
  if (!statSync(full, { throwIfNoEntry: false })) return [];
  if (statSync(full).isFile()) return [full];
  return readdirSync(full, { recursive: true })
    .map((f) => join(full, String(f)))
    .filter((f) => TEXT.test(f) && !/\.test\.tsx?$/.test(f) && statSync(f).isFile());
}

// Every address, with the files it's in.
const found = new Map();
for (const file of PLACES.flatMap(files)) {
  for (const m of readFileSync(file, 'utf8').matchAll(/https?:\/\/[^\s)"'<>`\]]+/g)) {
    const url = m[0].replace(/[.,;:!?*]+$/, '').replace(/&amp;/g, '&');
    if (SKIP.some((re) => re.test(url))) continue;
    // A bare "https://" (a box's placeholder) or a half address isn't one to ask for.
    try {
      if (!new URL(url).hostname.includes('.')) continue;
    } catch {
      continue;
    }
    (found.get(url) ?? found.set(url, new Set()).get(url)).add(relative(ROOT, file).replace(/\\/g, '/'));
  }
}

const AGENT = 'Mozilla/5.0 (compatible; Squirrelcade-upkeep/1.0; +https://squirrelcade.com)';
async function ask(url) {
  for (const method of ['HEAD', 'GET']) {
    try {
      const res = await fetch(url, { method, redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': AGENT, accept: 'text/html,*/*;q=0.8' } });
      // Some sites refuse HEAD but answer GET.
      if (method === 'HEAD' && [400, 403, 404, 405, 429, 500, 501].includes(res.status)) continue;
      return { status: res.status };
    } catch (err) {
      if (method === 'GET') return { status: 0, error: err instanceof Error ? (err.cause?.code ?? err.message) : String(err) };
    }
  }
  return { status: 0, error: 'no answer' };
}

// A few at a time, and a second between two asks to the same site.
const results = [];
const lastAsked = new Map();
const queue = [...found.keys()].sort();
async function worker() {
  for (let url = queue.shift(); url; url = queue.shift()) {
    const host = new URL(url).host;
    const wait = (lastAsked.get(host) ?? 0) + 1000 - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAsked.set(host, Date.now());
    results.push({ url, ...(await ask(url)), in: [...found.get(url)] });
  }
}
await Promise.all(Array.from({ length: 4 }, worker));

const broken = results.filter((r) => r.status === 0 || r.status === 404 || r.status === 410 || r.status >= 500);
const turnedAway = results.filter((r) => [401, 403, 429].includes(r.status));
const line = (r) => `- ${r.url}: ${r.status === 0 ? r.error : r.status} (in ${r.in.join(', ')})`;
const report = [
  `Checked ${results.length} outside addresses that Help, squirrelcade.com and the app point to.`,
  '',
  broken.length > 0 ? `## Broken (${broken.length})\n\n${broken.map(line).join('\n')}` : 'Nothing broken.',
  turnedAway.length > 0 ? `\n## Turned the check away (${turnedAway.length}): open each in a browser\n\n${turnedAway.map(line).join('\n')}` : '',
].join('\n');
console.log(report);
const at = process.argv.indexOf('--report');
if (at > 0 && process.argv[at + 1]) writeFileSync(process.argv[at + 1], `${report}\n`);
process.exitCode = broken.length > 0 ? 1 : 0;
