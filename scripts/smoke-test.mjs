// End-to-end smoke test of a FRESH Squirrelcade install (it creates the first account):
//   node scripts/smoke-test.mjs http://127.0.0.1:7575
// CI runs it against the Docker image. On an instance that is already set up it
// stops at the first check, since setup is refused and nothing else is allowed.
// With SMOKE_UI=1 it ends by walking the interface in a browser (scripts/ui-test.mjs).
const target = process.argv[2] ?? 'http://127.0.0.1:7575';
const base = `${target.replace(/\/+$/, '')}/api/v1`;
let cookie = '';
const results = [];
async function call(method, path, body, { form } = {}) {
  const headers = cookie ? { cookie } : {};
  let payload;
  if (form) payload = form;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(base + path, { method, headers, body: payload });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data };
}
function check(name, ok, detail = '') {
  results.push(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

for (let i = 0; i < 30; i++) {
  try {
    if ((await fetch(base + '/health')).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
let r = await call('GET', '/auth/session');
check('setup required on a fresh install', r.data.setupRequired === true);
if (!r.data.setupRequired) {
  console.log('This instance is already set up; the smoke test only runs on a fresh one.');
  process.exit(1);
}
// A throwaway account for this local smoke test only (never used anywhere else).
const account = { username: 'smoke', password: 'smoke-test-only-' + Math.random().toString(36).slice(2) };
if (process.env.SMOKE_UI === '1') {
  // With the browser, the account is made on the setup page, as a new owner makes it; then the API signs in with it.
  const { setupTest } = await import('./ui-test.mjs');
  await setupTest(target, account, check);
  r = await call('POST', '/auth/login', account);
  check('the account made on the setup page signs in', r.status === 200, String(r.status));
} else {
  r = await call('POST', '/setup', account);
  check('setup creates the account', r.status === 201, String(r.status));
}
r = await call('GET', '/collection/summary');
check('empty collection', r.data.currentImport === null);
r = await call('GET', '/system/status');
check('status answers', r.status === 200, r.data.health?.map((h) => h.message).join(' | '));
r = await call('GET', '/review');
check('review queue empty', r.data.lookAlikes.length === 0 && r.data.marked.length === 0);
r = await call('GET', '/catalogs/sources');
check('no console to build a catalog for yet', r.status === 200 && Array.isArray(r.data) && r.data.length === 0, JSON.stringify(r.data));

const csv = [
  'id,product-name,console-name,price-in-pennies,include-string,condition-string,sku,notes,cost-basis-in-pennies,quantity,date-entered,date-purchased,grading-company,grading-cert-id,folder',
  ...['Uncharted', 'Okami', 'Flower', 'Journey', 'Rain', 'Puppeteer', 'Tearaway'].map((t, i) => `${i + 1},"${t}",Playstation 3,${1000 + i * 100},"Item, Box, and Manual",,,,500,1,2026-09-01,,,,`),
].join('\n');
if (process.env.SMOKE_UI === '1') {
  // With the browser, the export goes in through the welcome guide, as a new owner's first one does.
  const { welcomeTest } = await import('./ui-test.mjs');
  await welcomeTest(target, account, csv, check);
  r = await call('GET', '/collection/summary');
  check('import applied', r.data.currentImport?.fileName === 'collection_20260927.csv' && r.data.totals?.copies === 7, JSON.stringify(r.data.totals));
} else {
  const form = new FormData();
  form.append('file', new Blob([csv], { type: 'text/csv' }), 'collection_20260927.csv');
  r = await call('POST', '/imports', undefined, { form });
  check('import applied', r.data.import?.status === 'applied', r.data.import?.status);
}
r = await call('GET', '/platforms');
const ps3 = r.data.find((p) => p.key === 'playstation-3');
check('PS3 tracked with 7 games', ps3 && ps3.eligible, JSON.stringify(ps3 && { games: ps3.games, eligible: ps3.eligible }));
r = await call('GET', '/catalogs');
check('no catalogs yet', Array.isArray(r.data) && r.data.length === 0);
r = await call('POST', '/catalogs/playstation-3/entries', { title: 'Demons Souls' });
check('add a game by hand', r.status === 201, String(r.status));
r = await call('POST', '/catalogs/playstation-3/entries', { title: 'Uncharted' });
r = await call('GET', '/catalogs/playstation-3');
check('catalog shows owned and missing', r.data.counts?.owned === 1 && r.data.counts?.missing === 1, JSON.stringify(r.data.counts));
check('owned games outside the catalog are listed', r.data.notInCatalog?.length === 6);
r = await call('GET', '/wishlist');
check('wishlist recommends the missing game', r.data.master?.some((m) => m.title === 'Demons Souls'), `${r.data.master?.length} picks`);
r = await call('GET', '/lookup?q=demons');
const entry = r.data[0];
check('store mode says need it', entry?.answer === 'need');
r = await call('POST', '/purchases', { entryId: entry.entryId });
r = await call('GET', '/lookup?q=demons');
check('bought: a copy of it is in the collection', r.data[0]?.answer === 'own');
r = await call('GET', '/send/pricecharting');
check("the copy bought is listed for PriceCharting's importer", r.data.toSend?.some((c) => c.line === 'Demons Souls Playstation 3 CIB'), JSON.stringify(r.data.toSend?.map((c) => c.line)));
r = await call('GET', '/wishlist/export');
check('wishlist CSV downloads', typeof r.data === 'string' && r.data.includes('Rank,Title'));
r = await call('GET', '/catalogs/playstation-3/export');
check('catalog CSV downloads', typeof r.data === 'string' && r.data.includes('Demons Souls'));
r = await call('POST', '/notifications/test');
check('notification test refuses without channels', r.status === 400);
r = await call('POST', '/backups', {});
check('manual backup', r.status === 200, r.data.name);
r = await call('GET', '/settings/export');
check('settings export', r.data.format === 'squirrelcade-settings');
// What was played, a copy's details, statistics, the workbook, and a share link that opens without signing in (0.6.0).
r = await call('PUT', '/play', { platformKey: 'playstation-3', title: 'Okami', status: 'beaten', rating: 9 });
check('play status saved', r.status === 200 && r.data.play?.status === 'beaten', JSON.stringify(r.data).slice(0, 120));
r = await call('GET', '/play?status=beaten');
check('the Backlog page lists it', Array.isArray(r.data.items) && r.data.items.some((g) => g.title === 'Okami'));
r = await call('GET', '/collection/items?q=Okami');
const okami = r.data.items?.[0];
r = await call('PUT', '/copy', { key: okami?.copyKey, location: 'Shelf A', tags: ['Favorite'] });
check("a copy's place and tags saved", r.status === 200 && r.data.details?.location === 'Shelf A', JSON.stringify(r.data).slice(0, 120));
r = await call('GET', '/collection/statistics');
check('statistics', r.status === 200 && r.data.totals?.games > 0);
r = await call('GET', '/export/workbook');
check('Excel workbook downloads', r.status === 200);
r = await call('POST', '/shares', { kind: 'wishlist', name: 'Smoke' });
const shared = await fetch(`${base}${r.data.path}`);
check('a share link opens without signing in', shared.status === 200 && (await shared.json()).kind === 'wishlist', String(shared.status));
r = await call('GET', '/tasks');
check('tasks listed', r.data.map((t) => t.name).sort().join(',') === 'backup,catalog-build,export-reminder,game-of-the-day,health-check,housekeeping,igdb-sync,import-folder,loan-reminders,mail-import,pc-discover,pc-prices,pc-read,psn-sync,ra-sync,release-reminders,romm-sync,steam-sync,xbox-sync', r.data.map((t) => t.name).join(','));
r = await call('POST', '/tasks/health-check/run');
await new Promise((res) => setTimeout(res, 1500));
r = await call('GET', '/tasks');
const hc = r.data.find((t) => t.name === 'health-check');
// A health check that finds nothing new leaves no row in the history, only its last look (a quiet check).
check('health check runs', hc?.lastRun?.status === 'success' || Boolean(hc?.lastLook), hc?.lastRun?.message ?? hc?.lastLook?.message);
r = await call('GET', '/collection/history');
check('value history has the import', r.data.length === 1 && r.data[0].valueCents > 0);

// A set from a CSV: one game owned, one missing, one added by hand.
r = await call('POST', '/sets', { name: 'Smoke set' });
check('a set is made', r.status === 201 && r.data.set?.key === 'smoke-set', String(r.status));
const setForm = new FormData();
setForm.append('file', new Blob(['Title,Platform\nJourney,PS3\nDemons Souls,PS3'], { type: 'text/csv' }), 'smoke-set.csv');
r = await call('PUT', '/sets/smoke-set/list', undefined, { form: setForm });
check("the set's list is read", r.status === 200, r.data.message);
r = await call('POST', '/sets/smoke-set/games', { platformKey: 'playstation-3', title: 'Tearaway', action: 'add' });
r = await call('GET', '/sets/smoke-set');
check("the set's completion", r.data.set?.games === 3 && r.data.set?.owned === 3, JSON.stringify(r.data.set && { games: r.data.set.games, owned: r.data.set.owned }));

// One game's view (the drawer), ownership for other tools, series, and the downloads.
r = await call('GET', '/game?platform=playstation-3&title=Uncharted');
check("a game's view", r.status === 200 && r.data.catalog?.status === 'owned' && r.data.copies?.length === 1, r.data.catalog?.status);
r = await call('POST', '/owned', { games: [{ title: 'Uncharted' }, { title: 'Demons Souls', platform: 'playstation-3' }, { title: 'Nothing Like It' }] });
check('ownership for other tools', r.status === 200 && r.data.results?.map((x) => x.owned).join() === 'true,true,false', JSON.stringify(r.data.results?.map((x) => x.owned)));
r = await call('GET', '/series');
check('series answer', r.status === 200 && Array.isArray(r.data));
r = await call('GET', '/collection/export');
check('collection spreadsheet', typeof r.data === 'string' && r.data.startsWith('Title,Console') && r.data.includes('Uncharted'));
r = await call('GET', '/catalogs/upcoming.ics');
check('coming soon calendar file', typeof r.data === 'string' && r.data.startsWith('BEGIN:VCALENDAR'));

// The Top 100 lists and history that ship with Squirrelcade, and the Copies page.
r = await call('GET', '/history');
check('Top 100 lists ship with Squirrelcade', r.status === 200 && r.data.top100?.includes('playstation-3') && r.data.history?.includes('playstation-3'), JSON.stringify(r.data).slice(0, 120));
r = await call('GET', '/history/top100/playstation-3');
check("the PS3's Top 100 with what the collection has", r.data.rows?.length === 100 && r.data.summary?.owned >= 3, JSON.stringify(r.data.summary));
r = await call('GET', '/history/consoles/playstation-3');
check("the PS3's history", r.data.history?.profile?.generation === 7 && r.data.history?.startHere?.length > 0, r.data.history?.status);
r = await call('GET', '/history/timeline');
check('the timeline', r.data.consoles?.some((c) => c.platformKey === 'playstation-3' && c.tracked), `${r.data.consoles?.length} consoles`);
r = await call('GET', '/copies?view=all');
// The export's seven games and the one bought since.
check('the Copies page', r.status === 200 && r.data.counts?.all === 8, JSON.stringify(r.data.counts));

// The PC library: off in a new install (Settings > Features), then on without Playnite; the support file, and the
// interface's compressed files.
r = await call('GET', '/pc');
check('the PC library is off in a new install', r.status === 404 && r.data.error === 'feature-off', String(r.status));
r = await call('PUT', '/settings', { changes: { 'features.pc': true } });
check('Settings > Features turns the PC library on', r.status === 200 && r.data.values?.['features.pc'] === true, String(r.status));
r = await call('GET', '/pc');
check('PC library answers without Playnite', r.status === 200 && r.data.records === 0);
r = await call('GET', '/system/support');
check('support file downloads', r.status === 200 && r.data.version && Array.isArray(r.data.taskRuns));
const page = await fetch(`${target.replace(/\/+$/, '')}/`);
const script = /src="\/(assets\/index-[^"]+\.js)"/.exec(await page.text())?.[1];
const compressed = script ? await fetch(`${target.replace(/\/+$/, '')}/${script}`, { headers: { 'accept-encoding': 'br' } }) : null;
check('the interface is sent compressed', compressed?.headers.get('content-encoding') === 'br', compressed?.headers.get('content-encoding') ?? 'no script found');

if (process.env.SMOKE_UI === '1') {
  const { uiTest } = await import('./ui-test.mjs');
  await uiTest(target, account, check);
}
console.log(results.join('\n'));
if (results.some((x) => x.startsWith('FAIL'))) {
  console.log('SOME CHECKS FAILED');
  process.exit(1);
}
console.log('ALL CHECKS PASSED');
