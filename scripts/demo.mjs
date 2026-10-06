// A demo install with a made-up collection, and screenshots of its main pages: for the README, the guide and a
// video's storyboard. Never run it against a real install: it expects a FRESH one (it creates the first account).
//   node scripts/demo.mjs http://127.0.0.1:7577 [output folder]
// It needs the internet (Wikipedia's game lists build the catalogs). With DEMO_IGDB_ID and DEMO_IGDB_SECRET (your own
// Twitch application's keys) the pages get covers too. Or, with no keys at all: DEMO_IGDB_ROWS, a JSON file of IGDB's
// public game data for the demo's consoles ({ "playstation-3": [{ "igdbId": 1, "data": "<IgdbGame JSON>" }], ... }),
// and DEMO_DB, the demo install's database file: the rows go in while IGDB is off, before anything reads them.
// Chrome, or Edge with UI_BROWSER=msedge.
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { exportCsv } from './demo-data.mjs';

const target = (process.argv[2] ?? 'http://127.0.0.1:7577').replace(/\/+$/, '');
const out = process.argv[3] ?? '.work/demo';
mkdirSync(out, { recursive: true });
const api = `${target}/api/v1`;
let cookie = '';
async function call(method, path, body, form) {
  const headers = cookie ? { cookie } : {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(api + path, { method, headers, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, data: type.includes('json') ? await res.json() : await res.text() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  let r = await call('GET', '/auth/session');
  if (!r.data.setupRequired) throw new Error('This install is set up already: the demo runs only on a fresh one.');
  const account = { username: 'demo', password: `demo-only-${Math.random().toString(36).slice(2)}` };
  r = await call('POST', '/setup', account);
  if (r.status !== 201) throw new Error(`Setup failed: ${r.status}`);
  await call('PUT', '/settings', { changes: { 'general.timeZone': 'America/New_York', 'general.instanceName': 'Squirrelcade', 'gotd.enabled': true, 'gotd.send': false, 'interface.theme': 'dark' } });
  if (process.env.DEMO_IGDB_ID && process.env.DEMO_IGDB_SECRET) {
    await call('PUT', '/settings', { changes: { 'sources.igdbClientId': process.env.DEMO_IGDB_ID, 'sources.igdbClientSecret': process.env.DEMO_IGDB_SECRET } });
  }
  const rows = process.env.DEMO_IGDB_ROWS && process.env.DEMO_DB ? process.env.DEMO_IGDB_ROWS : null;
  if (rows) await call('PUT', '/settings', { changes: { 'features.igdb': false } });
  const form = new FormData();
  form.append('file', new Blob([exportCsv()], { type: 'text/csv' }), 'collection_20260927.csv');
  r = await call('POST', '/imports', undefined, form);
  console.log('import:', r.data.import?.status, r.data.import?.addedCount, 'added');
  if (rows) {
    // The import made the consoles: their IGDB games go in under each one's id here, then IGDB is on again.
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(process.env.DEMO_DB);
    const add = db.prepare('INSERT OR IGNORE INTO igdb_games (platform_id, igdb_id, data) VALUES (?, ?, ?)');
    const synced = db.prepare('INSERT OR REPLACE INTO igdb_syncs (platform_id, synced_at, games, error) VALUES (?, ?, ?, NULL)');
    const byKey = JSON.parse(readFileSync(rows, 'utf8'));
    db.transaction(() => {
      for (const [key, games] of Object.entries(byKey)) {
        const platform = db.prepare('SELECT id FROM platforms WHERE key = ?').get(key);
        if (!platform) continue;
        for (const g of games) add.run(platform.id, g.igdbId, g.data);
        synced.run(platform.id, new Date().toISOString(), games.length);
      }
    })();
    db.close();
    await call('PUT', '/settings', { changes: { 'features.igdb': true } });
    console.log('igdb rows:', Object.entries(byKey).map(([k, g]) => `${k} ${g.length}`).join(', '));
  }
  const keys = ['super-nintendo', 'nintendo-64', 'playstation-3', 'nintendo-switch'];
  await call('POST', '/catalogs/build', { platforms: keys });
  if (process.env.DEMO_IGDB_ID) await call('POST', '/tasks/igdb-sync/run');
  // Wait for the catalogs (Wikipedia, one page at a time) and the tasks to settle.
  for (let i = 0; i < 180; i++) {
    const built = (await call('GET', '/catalogs')).data;
    const tasks = (await call('GET', '/tasks')).data;
    const busy = Array.isArray(tasks) && tasks.some((t) => t.state !== 'idle');
    if (Array.isArray(built) && built.length >= keys.length && !busy) break;
    await sleep(5000);
  }
  console.log('catalogs:', JSON.stringify((await call('GET', '/catalogs')).data).slice(0, 400));
  // The keys are needed only for the sync (the covers are IGDB's public images): the demo forgets them right after.
  if (process.env.DEMO_IGDB_ID) await call('PUT', '/settings', { changes: { 'sources.igdbClientId': '', 'sources.igdbClientSecret': '' } });
  // A few preferences, so the wishlist has some of each.
  const wish = (await call('GET', '/wishlist')).data;
  for (const [i, m] of (wish.master ?? []).slice(0, 6).entries()) {
    await call('PUT', '/wishlist/preferences', { platformKey: m.platformKey, title: m.title, preference: i % 3 === 0 ? 'Must Have' : 'Strong Interest', note: null });
  }

  // A first backup, so the setup checklist (on Today while a step is left) has nothing left to say.
  await call('POST', '/backups', {});
  const browser = await chromium.launch({ channel: process.env.UI_BROWSER || 'chrome', headless: true });
  const shots = [];
  async function shot(name, path, opts = {}) {
    const context = await browser.newContext({ viewport: opts.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: 'dark' });
    const [name0, value0] = cookie.split('=');
    await context.addCookies([{ name: name0, value: value0, url: target }]);
    const page = await context.newPage();
    await page.goto(`${target}${path}`);
    await page.waitForLoadState('networkidle');
    if (opts.act) await opts.act(page);
    await page.waitForTimeout(800);
    const file = `${out}/${name}.png`;
    await page.screenshot({ path: file, fullPage: opts.full ?? false });
    shots.push(file);
    await context.close();
  }
  await shot('00-today', '/today');
  await shot('00-today-phone', '/today', { phone: true });
  await shot('01-collection', '/collection');
  await shot('02-platforms', '/platforms');
  await shot('03-console-missing', '/platforms/super-nintendo');
  await shot('04-top100', '/platforms/super-nintendo?tab=top100');
  await shot('05-history', '/platforms/super-nintendo?tab=history');
  await shot('06-wishlist', '/wishlist');
  const first = (wish.master ?? [])[0];
  if (first) await shot('07-game-drawer', `/wishlist?game=${encodeURIComponent(`${first.platformKey}|${first.title}`)}`);
  await shot('08-store-phone', '/store', {
    phone: true,
    act: async (page) => {
      await page.getByPlaceholder('Barcode or title').fill('zelda');
      await page.waitForTimeout(2500);
    },
  });
  await shot('09-statistics', '/collection/statistics');
  await shot('10-timeline', '/platforms?view=timeline');
  await shot('11-features', '/settings/features');
  await shot('12-updates', '/updates');
  await browser.close();
  console.log(`${shots.length} screenshots in ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
