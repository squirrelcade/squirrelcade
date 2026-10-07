import { existsSync, mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appState, collectionItems, copies, copyDetails, imports, pricePoints } from './db/schema.js';
import { exportDate } from './collection.js';
import { exportCsv, HEADER, makeZip, multipart, multipartFile, setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

const GAMES: [string, string, string, number, string?][] = [
  ['1', 'Uncharted', 'Playstation 3', 1000],
  ['2', 'Demons Souls', 'Playstation 3', 2500, 'New Item, Box, and Manual'],
  ['3', 'Journey Collector’s Edition', 'Playstation 3', 3000],
  ['4', 'Katamari Forever', 'PAL Playstation 3', 1500, 'Item Only'],
  ['5', 'Splatoon 3', 'Nintendo Switch', 4000],
  ['6', 'Doom', 'PC Games', 500],
];

async function upload(fileName: string, csv: string) {
  const { payload, headers } = multipart(fileName, csv);
  return g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, payload, headers });
}

describe('collection import', () => {
  it('imports an export, skips PC games and builds platforms', async () => {
    const res = await upload('collection_20260926.csv', exportCsv(GAMES));
    expect(res.statusCode).toBe(201);
    const outcome = res.json();
    expect(outcome.import).toMatchObject({ status: 'applied', current: true, rowCount: 5, addedCount: 5 });
    expect(outcome.report.excluded).toEqual([{ label: 'PC Games', rows: 1 }]);

    const summary = (await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json();
    expect(summary.totals).toMatchObject({ games: 5, copies: 5, valueCents: 12000, sealed: 1, platforms: 2 });
    const ps3 = summary.platforms.find((p: { key: string }) => p.key === 'playstation-3');
    expect(ps3).toMatchObject({ games: 4, eligible: false });

    const platforms = (await g.app.inject({ url: '/api/v1/platforms', cookies })).json();
    expect(platforms.find((p: { key: string }) => p.key === 'playstation-3').labels).toEqual(
      expect.arrayContaining([
        { label: 'Playstation 3', region: 'north-america' },
        { label: 'PAL Playstation 3', region: 'europe' },
      ]),
    );
  });

  it('marks platforms eligible from the setting', async () => {
    await upload('collection_20260926.csv', exportCsv(GAMES));
    g.settings.update({ 'platforms.minUniqueGames': 4 });
    const summary = (await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json();
    expect(summary.platforms.find((p: { key: string }) => p.key === 'playstation-3').eligible).toBe(true);
    expect(summary.totals.eligiblePlatforms).toBe(1);
  });

  it('sorts by what copies gained since they were bought', async () => {
    const csv = [
      HEADER,
      '1,"Cheap Buy",Playstation 3,5000,"Item, Box, and Manual",,,,1000,1,2026-01-01,,,,',
      '2,"Paid Full",Playstation 3,3000,"Item, Box, and Manual",,,,3500,1,2026-01-01,,,,',
      '3,"No Price Paid",Playstation 3,9000,"Item, Box, and Manual",,,,,1,2026-01-01,,,,',
    ].join('\n');
    await upload('collection_20260926.csv', csv);
    const res = (await g.app.inject({ url: '/api/v1/collection/items?sort=gain', cookies })).json();
    expect(res.items.map((i: { title: string }) => i.title)).toEqual(['Cheap Buy', 'Paid Full', 'No Price Paid']);
  });

  it('sorts by each column of the Stash, either way, with empty ones last (D144)', async () => {
    const csv = [
      HEADER,
      '1,"Banjo",Nintendo 64,5000,"Item, Box, and Manual",,,,1000,1,2026-01-03,,,,',
      '2,"Astro",Playstation 3,2000,"Item Only",,,,,1,2026-01-01,,,,',
      '3,"Crash",Playstation 3,3000,"Item and Box",,,,2500,1,2026-01-02,,,,',
    ].join('\n');
    await upload('collection_20260926.csv', csv);
    const titles = async (query: string) => (await g.app.inject({ url: `/api/v1/collection/items?${query}`, cookies })).json().items.map((i: { title: string }) => i.title);
    expect(await titles('sort=title')).toEqual(['Astro', 'Banjo', 'Crash']);
    expect(await titles('sort=title&dir=desc')).toEqual(['Crash', 'Banjo', 'Astro']);
    // Each column's own first direction: the newest, the most valuable first.
    expect(await titles('sort=added')).toEqual(['Banjo', 'Crash', 'Astro']);
    expect(await titles('sort=added&dir=asc')).toEqual(['Astro', 'Crash', 'Banjo']);
    expect(await titles('sort=value&dir=asc')).toEqual(['Astro', 'Crash', 'Banjo']);
    // Nothing paid is last either way.
    expect(await titles('sort=paid')).toEqual(['Crash', 'Banjo', 'Astro']);
    expect(await titles('sort=paid&dir=asc')).toEqual(['Banjo', 'Crash', 'Astro']);
    // Conditions best first: complete, then the game and its box, then the game alone.
    expect(await titles('sort=condition')).toEqual(['Banjo', 'Crash', 'Astro']);
    expect(await titles('sort=platform&dir=desc')).toEqual(['Astro', 'Crash', 'Banjo']);
  });

  it('lists games owned more than once', async () => {
    const twice = [...GAMES, ['1', 'Uncharted', 'Playstation 3', 1000, 'Item Only']] as typeof GAMES;
    await upload('collection_20260926.csv', exportCsv(twice));
    const res = (await g.app.inject({ url: '/api/v1/collection/items?duplicates=1', cookies })).json();
    expect(res.total).toBe(2);
    expect(res.items.map((i: { title: string }) => i.title)).toEqual(['Uncharted', 'Uncharted']);
  });

  it('filters, searches, sorts and pages items', async () => {
    await upload('collection_20260926.csv', exportCsv(GAMES));
    const page = (await g.app.inject({ url: '/api/v1/collection/items?platform=playstation-3&sort=value&pageSize=2', cookies })).json();
    expect(page.total).toBe(4);
    expect(page.items.map((i: { title: string }) => i.title)).toEqual(['Journey Collector’s Edition', 'Demons Souls']);
    const search = (await g.app.inject({ url: '/api/v1/collection/items?q=katamari', cookies })).json();
    expect(search.items[0]).toMatchObject({ title: 'Katamari Forever', region: 'europe', completeness: 'loose' });
    const sealed = (await g.app.inject({ url: '/api/v1/collection/items?completeness=sealed', cookies })).json();
    expect(sealed.total).toBe(1);
  });

  it('reports additions and removals between imports', async () => {
    g.settings.update({ 'collection.maxRemovalPercent': 50 });
    await upload('collection_20260926.csv', exportCsv(GAMES));
    const next = GAMES.filter(([id]) => id !== '4').concat([['7', 'Tetris', 'GameBoy', 900]]);
    const res = (await upload('collection_20260927.csv', exportCsv(next))).json();
    expect(res.import).toMatchObject({ status: 'applied', addedCount: 1, removedCount: 1 });
    expect(res.report.diff.added[0].title).toBe('Tetris');
    expect(res.report.diff.removed[0].title).toBe('Katamari Forever');
  });

  it('recognizes a file it already imported', async () => {
    const csv = exportCsv(GAMES);
    await upload('collection_20260926.csv', csv);
    const again = await upload('copy.csv', csv);
    expect(again.statusCode).toBe(200);
    expect(again.json().duplicate).toBe(true);
    expect((await g.app.inject({ url: '/api/v1/imports', cookies })).json()).toHaveLength(1);
  });

  it("reads another app's export (CLZ Games) and keeps the barcodes it gives, without replacing a linked one", async () => {
    // A barcode linked by hand (on a console the collection already has), before switching to another app's export.
    g.settings.update({ 'collection.maxRemovalPercent': 100 });
    await upload('collection_20260926.csv', exportCsv(GAMES));
    await g.app.inject({ method: 'POST', url: '/api/v1/barcodes', cookies, payload: { code: '711719541028', platformKey: 'playstation-3', title: 'Uncharted' } });
    const clz = [
      'Title;Platform;Collection Status;Region;Completeness;Purchase Price;Barcode',
      'Super Mario World;SNES;In Collection;USA;Complete;$45.00;045496830434',
      "Demon's Souls;PlayStation 3;In Collection;USA;Loose;;711719541028",
      'Metroid Dread;Nintendo Switch;Wish List;USA;;;045496597894',
    ].join('\n');
    const res = (await upload('clz-export.csv', clz)).json();
    expect(res.import.status).toBe('applied');
    expect(res.report.warnings).toContain("1 row that isn't in your collection (a wish list, sold, on order) left out.");
    const scan = async (code: string) => (await g.app.inject({ url: `/api/v1/lookup/barcode/${code}`, cookies })).json();
    const mario = await scan('045496830434');
    expect(mario).toMatchObject({ known: true, searchedFor: 'Super Mario World' });
    expect(mario.results[0]).toMatchObject({ title: 'Super Mario World', platform: 'Super Nintendo' });
    // The barcode linked by hand keeps its game; the wish list's barcode isn't kept.
    expect(await scan('711719541028')).toMatchObject({ known: true, searchedFor: 'Uncharted' });
    expect(await scan('045496597894')).toMatchObject({ known: false });
  });

  it('keeps the totals of every applied import for the value history', async () => {
    g.settings.update({ 'collection.maxRemovalPercent': 50 });
    await upload('collection_20260926.csv', exportCsv(GAMES));
    await upload('collection_20260927.csv', exportCsv([...GAMES, ['7', 'Tetris', 'Nintendo Switch', 900]]));
    const { payload, headers } = multipart('bad.csv', 'id,title\n1,x');
    await g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, payload, headers });
    const history = (await g.app.inject({ url: '/api/v1/collection/history', cookies })).json();
    // PC games are left out, as in the collection itself; the refused file isn't a point.
    expect(history.map((h: { fileName: string; date: string; games: number; copies: number; valueCents: number }) => [h.fileName, h.date, h.games, h.copies, h.valueCents])).toEqual([
      ['collection_20260926.csv', '2026-09-26', 5, 5, 12000],
      ['collection_20260927.csv', '2026-09-27', 6, 6, 12900],
    ]);
    const summary = (await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json();
    expect(history[1].valueCents).toBe(summary.totals.valueCents);
  });

  it("keeps each platform's totals with every update, past the pruning of its rows", async () => {
    g.settings.update({ 'collection.maxRemovalPercent': 50 });
    await upload('collection_20260926.csv', exportCsv(GAMES));
    await upload('collection_20260927.csv', exportCsv([...GAMES, ['7', 'Tetris', 'Nintendo Switch', 900]]));
    type Totals = { key: string; games: number; copies: number; valueCents: number };
    const byPlatform = async () =>
      ((await g.app.inject({ url: '/api/v1/collection/history', cookies })).json() as { platforms: Totals[] | null }[]).map((h) => h.platforms?.map((p) => [p.key, p.games, p.copies, p.valueCents]) ?? null);
    // Most valuable first; PAL Playstation 3 is the PS3; PC games are left out, as in the collection.
    expect(await byPlatform()).toEqual([
      [
        ['playstation-3', 4, 4, 8000],
        ['nintendo-switch', 1, 1, 4000],
      ],
      [
        ['playstation-3', 4, 4, 8000],
        ['nintendo-switch', 2, 2, 4900],
      ],
    ]);
    // The list of updates doesn't carry them: the history does.
    const listed = (await g.app.inject({ url: '/api/v1/imports', cookies })).json();
    expect(listed[0]).not.toHaveProperty('platformTotals');
    // Pruned rows don't take the totals with them.
    g.db.delete(collectionItems).where(eq(collectionItems.importId, 1)).run();
    expect((await byPlatform())[0]).toHaveLength(2);
    // An install from before they were kept fills them in from the updates it still has rows for, once.
    g.db.update(imports).set({ platformTotals: null }).run();
    expect(g.collection.backfillPlatformTotals()).toBe(1);
    expect(g.collection.backfillPlatformTotals()).toBe(0);
    expect((await byPlatform())[0]).toBeNull();
    expect((await byPlatform())[1]).toHaveLength(2);
  });

  it('knows which platforms an import made tracked', async () => {
    g.settings.update({ 'platforms.minUniqueGames': 5 });
    const first = (await upload('collection_20260926.csv', exportCsv(GAMES))).json();
    // Four PS3 games and one Switch game: PS3 has 4 (PAL counts as PS3), not yet 5.
    expect(g.collection.newlyTracked(first.import.id)).toEqual([]);
    const more = [...GAMES, ['7', 'Flower', 'Playstation 3', 900]] as typeof GAMES;
    const second = (await upload('collection_20260927.csv', exportCsv(more))).json();
    expect(g.collection.newlyTracked(second.import.id)).toEqual([{ name: 'PlayStation 3', games: 5 }]);
  });

  it('finds the biggest price moves since the previous import', async () => {
    const empty = (await g.app.inject({ url: '/api/v1/collection/movers', cookies })).json();
    expect(empty).toEqual({ since: null, up: [], down: [] });
    await upload('collection_20260926.csv', exportCsv(GAMES));
    const moved = GAMES.map((row) => (row[0] === '1' ? ['1', 'Uncharted', 'Playstation 3', 1600] : row[0] === '2' ? ['2', 'Demons Souls', 'Playstation 3', 2000, 'New Item, Box, and Manual'] : row)) as typeof GAMES;
    await upload('collection_20261026.csv', exportCsv(moved));
    const res = (await g.app.inject({ url: '/api/v1/collection/movers', cookies })).json();
    expect(res.since).toMatchObject({ fileName: 'collection_20260926.csv', date: '2026-09-26' });
    expect(res.up).toEqual([{ title: 'Uncharted', platform: 'PlayStation 3', platformKey: 'playstation-3', condition: 'Item, Box, and Manual', beforeCents: 1000, nowCents: 1600, changeCents: 600, percent: 60 }]);
    expect(res.down).toEqual([expect.objectContaining({ title: 'Demons Souls', changeCents: -500, percent: -20 })]);
    // Each platform's value then, for the Platforms page's change since the last update.
    const ps3 = (await g.app.inject({ url: '/api/v1/platforms', cookies })).json().find((p: { key: string }) => p.key === 'playstation-3');
    expect(ps3).toMatchObject({ valueSince: '2026-09-26', valueBeforeCents: 1000 + 2500 + 3000 + 1500, valueCents: 1600 + 2000 + 3000 + 1500 });
  });

  it("keeps each copy's value at every update that changed it, past the pruning of old updates", async () => {
    await upload('collection_20260926.csv', exportCsv(GAMES));
    const moved = GAMES.map((row) => (row[0] === '1' ? ['1', 'Uncharted', 'Playstation 3', 1600] : row)) as typeof GAMES;
    await upload('collection_20261026.csv', exportCsv(moved));
    await upload('collection_20261126.csv', exportCsv([...moved, ['7', 'Tetris', 'Nintendo Switch', 900]]));
    const history = g.collection.priceHistory([
      { productId: '1', includeString: 'Item, Box, and Manual' },
      { productId: '2', includeString: 'New Item, Box, and Manual' },
      { productId: '7', includeString: 'Item, Box, and Manual' },
    ]);
    // A point only when the value changed: Uncharted twice, Demons Souls once, Tetris from its first update.
    expect(history.get('1|Item, Box, and Manual')).toEqual([
      { date: '2026-09-26', cents: 1000 },
      { date: '2026-10-26', cents: 1600 },
    ]);
    expect(history.get('2|New Item, Box, and Manual')?.map((p) => p.cents)).toEqual([2500]);
    expect(history.get('7|Item, Box, and Manual')).toHaveLength(1);
    // The game drawer shows it with each copy.
    const view = (await g.app.inject({ url: '/api/v1/game?platform=playstation-3&title=Uncharted', cookies })).json();
    expect(view.copies[0]).toMatchObject({ includeString: 'Item, Box, and Manual', history: [{ cents: 1000 }, { cents: 1600 }] });

    // An install from before price history starts it from the updates it kept, once.
    g.db.delete(pricePoints).run();
    // The first update's 5 console games (the PC game isn't imported), Uncharted's new value, then Tetris.
    expect(g.collection.backfillPrices()).toBe(7);
    expect(g.collection.backfillPrices()).toBe(0);
    expect(g.collection.priceHistory([{ productId: '1', includeString: 'Item, Box, and Manual' }]).get('1|Item, Box, and Manual')?.map((p) => p.cents)).toEqual([1000, 1600]);
  });

  it("reads an export's date from its file name", () => {
    expect(exportDate('collection_20260927.csv')).toBe('2026-09-27');
    expect(exportDate('collection_20260927 (1).csv')).toBe('2026-09-27');
    expect(exportDate('my games.csv')).toBeNull();
    expect(exportDate('collection_20261399.csv')).toBeNull();
    expect(exportDate('collection_202609271.csv')).toBeNull();
  });

  it('takes an older export again when it is uploaded, to go back to it', async () => {
    g.settings.update({ 'collection.maxRemovalPercent': 50 });
    const a = exportCsv(GAMES);
    const b = exportCsv([...GAMES, ['7', 'Tetris', 'Nintendo Switch', 900]]);
    await upload('collection_20260926.csv', a);
    await upload('collection_20260927.csv', b);
    const back = await upload('collection_20260926.csv', a);
    expect(back.statusCode).toBe(201);
    expect(back.json().import).toMatchObject({ status: 'applied', current: true, addedCount: 0, removedCount: 1 });
    expect(back.json().report.diff.removed[0].title).toBe('Tetris');
    expect((await g.app.inject({ url: '/api/v1/imports', cookies })).json()).toHaveLength(3);
  });

  it('holds an import that would remove too much, until confirmed or discarded', async () => {
    await upload('collection_20260926.csv', exportCsv(GAMES));
    const cutOff = exportCsv(GAMES.slice(0, 2));
    const held = (await upload('collection_20260927.csv', cutOff)).json();
    expect(held.import).toMatchObject({ status: 'pending', current: false });
    expect(held.report.removalPercent).toBeGreaterThan(10);
    // The collection is unchanged while the import waits.
    expect((await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json().totals.games).toBe(5);

    const discarded = await g.app.inject({ method: 'POST', url: `/api/v1/imports/${held.import.id}/discard`, cookies });
    expect(discarded.statusCode).toBe(200);
    const again = (await upload('collection_20260927b.csv', cutOff + '\n')).json();
    const applied = await g.app.inject({ method: 'POST', url: `/api/v1/imports/${again.import.id}/apply`, cookies });
    expect(applied.json().import).toMatchObject({ status: 'applied', current: true, removedCount: 3 });
    expect(applied.json().report.copies).toEqual({ matched: 2, added: 0, missing: 3, gone: 0 });
    // The three games it doesn't have wait on Review, still counted, until the owner says they're gone.
    expect((await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json().totals.games).toBe(5);
    const missing = (await g.app.inject({ url: '/api/v1/collection/missing', cookies })).json() as { id: number }[];
    expect(missing).toHaveLength(3);
    for (const m of missing) await g.app.inject({ method: 'POST', url: `/api/v1/collection/missing/${m.id}`, cookies, payload: { answer: 'removed' } });
    expect((await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json().totals.games).toBe(2);
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/imports/${again.import.id}/apply`, cookies })).statusCode).toBe(409);
  });

  it('takes the zip PriceCharting sends, named after the export inside', async () => {
    const zip = makeZip({ 'collection_20260927.csv': exportCsv(GAMES) });
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, ...multipartFile('collection (6).zip', zip, 'application/zip') });
    expect(res.statusCode).toBe(201);
    expect(res.json().import).toMatchObject({ status: 'applied', fileName: 'collection_20260927.csv' });
    // The same export again, unzipped this time, is recognized as the same file.
    const again = await g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, ...multipart('collection_20260927.csv', exportCsv(GAMES)) });
    expect(again.json().duplicate).toBe(true);
    // A zip without an export in it is refused with the reason.
    const empty = await g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, ...multipartFile('collection.zip', makeZip({ 'readme.txt': 'hi' }), 'application/zip') });
    expect(empty.statusCode).toBe(400);
    expect(empty.json().message).toBe('collection.zip has no CSV file in it.');
  });

  it('refuses a broken file and keeps the collection', async () => {
    await upload('collection_20260926.csv', exportCsv(GAMES));
    const res = (await upload('bad.csv', 'id,name\n1,x')).json();
    expect(res.import.status).toBe('refused');
    expect(res.report.errors[0]).toMatch(/missing column/);
    expect((await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json().totals.games).toBe(5);
  });

  it('turns an unknown console name into a new platform', async () => {
    await upload('collection_20260926.csv', exportCsv([['9', 'Odd Game', 'JP Pippin', 100]]));
    const platforms = (await g.app.inject({ url: '/api/v1/platforms', cookies })).json();
    expect(platforms.find((p: { key: string }) => p.key === 'pippin')).toMatchObject({ source: 'auto', name: 'Pippin' });
  });
});

describe('copies kept by Squirrelcade', () => {
  type Item = { id: number; key: string; title: string; completeness: string; quantity: number; source: string; missingSince: string | null; valueCents: number | null };
  const items = async (query = '') => (await g.app.inject({ url: `/api/v1/collection/items${query}`, cookies })).json().items as Item[];
  const missing = async () => (await g.app.inject({ url: '/api/v1/collection/missing', cookies })).json() as { id: number; title: string; source: string; others: number }[];
  const answer = (id: number, value: string) => g.app.inject({ method: 'POST', url: `/api/v1/collection/missing/${id}`, cookies, payload: { answer: value } });
  const TWO = [...GAMES.slice(0, 5)];
  const row = (id: string, title: string, label: string, cents: number, quantity: number, inc = 'Item, Box, and Manual', paid = '0', bought = '') =>
    `${id},"${title}",${label},${cents},"${inc}",,,,${paid},${quantity},2026-01-01,${bought},,,`;

  it('keeps each copy on its own, with a key of its own, and follows it through updates', async () => {
    await upload('collection_20260926.csv', [HEADER, row('1', 'Uncharted', 'Playstation 3', 1000, 2), row('2', 'Journey', 'Playstation 3', 1500, 1)].join('\n'));
    const first = await items();
    expect(first.map((i) => `${i.title} ×${i.quantity}`)).toEqual(['Journey ×1', 'Uncharted ×1', 'Uncharted ×1']);
    expect(new Set(first.map((i) => i.key)).size).toBe(3);
    expect(first.every((i) => i.source === 'pricecharting' && i.missingSince === null)).toBe(true);
    // A new price and one copy more: the copies stay the same ones (same keys), and one is added.
    await upload('collection_20261003.csv', [HEADER, row('1', 'Uncharted', 'Playstation 3', 1100, 3), row('2', 'Journey', 'Playstation 3', 1600, 1)].join('\n'));
    const second = await items();
    expect(second).toHaveLength(4);
    for (const c of first) expect(second.find((i) => i.key === c.key)).toBeDefined();
    expect(second.filter((i) => i.title === 'Uncharted').map((i) => i.valueCents)).toEqual([1100, 1100, 1100]);
    expect((await g.app.inject({ url: '/api/v1/imports?limit=1', cookies })).json()[0]).toMatchObject({ status: 'applied' });
    expect(g.collection.reportOf(g.collection.currentImportId()!)!.copies).toEqual({ matched: 3, added: 1, missing: 0, gone: 0 });
  });

  it('pairs copies of the same game with the rows most like them, so their details stay with them', async () => {
    await upload('collection_20260926.csv', [HEADER, row('1', 'Uncharted', 'Playstation 3', 1000, 1, undefined, '500', '2020-01-01'), row('1', 'Uncharted', 'Playstation 3', 1000, 1, undefined, '2500', '2024-06-01')].join('\n'));
    const before = await items();
    const cheap = before.find((i) => i.key && g.collection.items({ all: true }).items.find((x) => x.key === i.key)!.costCents === 500)!;
    await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key: cheap.key, location: 'Shelf A' } });
    // The same two copies, listed the other way round in the next export.
    await upload('collection_20261003.csv', [HEADER, row('1', 'Uncharted', 'Playstation 3', 1200, 1, undefined, '2500', '2024-06-01'), row('1', 'Uncharted', 'Playstation 3', 1200, 1, undefined, '500', '2020-01-01')].join('\n'));
    const after = g.collection.items({ all: true }).items;
    expect(after.find((i) => i.key === cheap.key)!.costCents).toBe(500);
    expect((await g.app.inject({ url: `/api/v1/copy?key=${encodeURIComponent(cheap.key)}`, cookies })).json().details.location).toBe('Shelf A');
  });

  it('asks about a copy the next export no longer has, and does what the owner says', async () => {
    // One game of five is more than the 10% an update may remove without holding it.
    g.settings.update({ 'collection.maxRemovalPercent': 50 });
    await upload('collection_20260926.csv', exportCsv(TWO));
    await upload('collection_20261003.csv', exportCsv(TWO.slice(1)));
    // Uncharted waits on Review, still counted.
    expect((await items()).map((i) => i.title)).toContain('Uncharted');
    expect((await items('?missing=1')).map((i) => i.title)).toEqual(['Uncharted']);
    const [m] = await missing();
    expect(m).toMatchObject({ title: 'Uncharted', source: 'pricecharting', others: 0 });
    // Kept: it's the owner's own copy now, and no export asks about it again.
    expect((await answer(m!.id, 'keep')).json()).toEqual({ ok: true });
    expect(await missing()).toEqual([]);
    await upload('collection_20261010.csv', exportCsv(TWO.slice(2)));
    expect((await missing()).map((x) => x.title)).toEqual(['Demons Souls']);
    expect((await items()).find((i) => i.title === 'Uncharted')!.source).toBe('squirrelcade');
    // Sold: it leaves the collection.
    expect((await answer((await missing())[0]!.id, 'sold')).statusCode).toBe(200);
    expect((await items()).map((i) => i.title)).not.toContain('Demons Souls');
    expect((await answer(999, 'sold')).statusCode).toBe(404);
    expect((await answer(1, 'maybe')).statusCode).toBe(400);
  });

  it('clears the question when the copy comes back, and removes at once when set to', async () => {
    g.settings.update({ 'collection.maxRemovalPercent': 50 });
    await upload('collection_20260926.csv', exportCsv(TWO));
    await upload('collection_20261003.csv', exportCsv(TWO.slice(1)));
    expect(await missing()).toHaveLength(1);
    await upload('collection_20261010.csv', exportCsv(TWO));
    expect(await missing()).toEqual([]);
    g.settings.update({ 'collection.goneFromFile': 'remove' });
    const outcome = g.collection.importText(exportCsv(TWO.slice(1)), { source: 'upload', fileName: 'collection_20261017.csv' });
    expect(outcome.report.copies).toEqual({ matched: 4, added: 0, missing: 0, gone: 1 });
    expect((await items()).map((i) => i.title)).not.toContain('Uncharted');
    expect(await missing()).toEqual([]);
  });

  it("brings a spreadsheet in beside PriceCharting's copies without doubling them, and PriceCharting takes over the spreadsheet's", async () => {
    await upload('collection_20260926.csv', exportCsv([['1', 'Uncharted', 'Playstation 3', 1000]]));
    // The owner's own list: Uncharted again (the same game, no copy more) and a game PriceCharting doesn't have.
    const sheet = ['Title,Console,Condition', 'Uncharted,PlayStation 3,CIB', 'Puppeteer,PlayStation 3,CIB'].join('\n');
    expect(g.collection.importText(sheet, { source: 'upload', fileName: 'my games.csv' }).report.copies).toEqual({ matched: 1, added: 1, missing: 0, gone: 0 });
    expect((await items()).map((i) => `${i.title} (${i.source})`)).toEqual(['Puppeteer (spreadsheet)', 'Uncharted (pricecharting)']);
    // An export that has Puppeteer now takes that copy over (the same one), with PriceCharting's product and value.
    const puppeteer = (await items()).find((i) => i.title === 'Puppeteer')!;
    g.collection.importText(exportCsv([['1', 'Uncharted', 'Playstation 3', 1000], ['7', 'Puppeteer', 'Playstation 3', 1800]]), { source: 'upload', fileName: 'collection_20261003.csv' });
    const now = (await items()).find((i) => i.title === 'Puppeteer')!;
    expect(now).toMatchObject({ key: puppeteer.key, source: 'pricecharting', valueCents: 1800 });
    expect(await items()).toHaveLength(2);
  });

  it('starts the copies once from the current update of an older install, keeping details under their keys', async () => {
    await upload('collection_20260926.csv', [HEADER, row('1', 'Uncharted', 'Playstation 3', 1000, 2), row('2', 'Journey', 'Playstation 3', 1500, 1)].join('\n'));
    // As an install from before 0.19.0: no copies yet, details kept by product and condition.
    g.db.delete(copies).run();
    g.db.delete(appState).where(eq(appState.key, 'collection.copiesFrom')).run();
    g.db.insert(copyDetails).values({ copyKey: '1|Item, Box, and Manual', productId: '1', location: 'Shelf A', tags: '[]', updatedAt: '2026-09-01' }).run();
    expect(g.collection.startCopies()).toBe(3);
    expect(g.collection.startCopies()).toBe(0);
    const keys = g.collection.items({ all: true }).items.map((i) => i.key).sort();
    expect(keys).toEqual(['1|Item, Box, and Manual', '1|Item, Box, and Manual#2', '2|Item, Box, and Manual']);
    const shelf = (await items()).filter((i) => i.title === 'Uncharted');
    expect(shelf).toHaveLength(2);
    expect((await g.app.inject({ url: `/api/v1/copy?key=${encodeURIComponent('1|Item, Box, and Manual')}`, cookies })).json().details.location).toBe('Shelf A');
  });
});

describe('spending', () => {
  it('adds up what the copies cost by the month they were bought (or added), with the consoles of the last 12 months', async () => {
    const month = (offset: number) => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() - offset);
      return d.toISOString().slice(0, 10);
    };
    const csv = [
      HEADER,
      `1,"Uncharted",Playstation 3,1000,"Item, Box, and Manual",,,,400,2,${month(0)},,,,`,
      `2,"Journey",Playstation 3,2550,"Item, Box, and Manual",,,,1000,1,${month(0)},${month(1)},,,`,
      `3,"Okami",Wii,1999,"Item, Box, and Manual",,,,0,1,${month(0)},,,,`,
      `4,"Zelda",Wii,1999,"Item, Box, and Manual",,,,2500,1,${month(20)},,,,`,
    ].join('\n');
    await g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, ...multipart('collection_20260927.csv', csv) });
    const spending = (await g.app.inject({ url: '/api/v1/collection/spending', cookies })).json();
    // Uncharted twice this month; Journey bought last month (its purchase date wins); Okami cost nothing.
    expect(spending.months).toEqual([
      { month: month(20).slice(0, 7), cents: 2500, copies: 1 },
      { month: month(1).slice(0, 7), cents: 1000, copies: 1 },
      { month: month(0).slice(0, 7), cents: 800, copies: 2 },
    ]);
    // Zelda is older than 12 months.
    expect(spending.consoles).toEqual([{ platform: 'PlayStation 3', cents: 1800, copies: 3 }]);
  });
});

describe('stats for dashboards', () => {
  it('answers with the API key only, zeros before the first update, then the totals', async () => {
    expect((await g.app.inject({ url: '/api/v1/stats' })).statusCode).toBe(401);
    const { apiKey } = (await g.app.inject({ url: '/api/v1/auth/apikey', cookies })).json() as { apiKey: string };
    const stats = async () => {
      const res = await g.app.inject({ url: '/api/v1/stats', headers: { 'x-api-key': apiKey } });
      expect(res.statusCode).toBe(200);
      return res.json();
    };
    expect(await stats()).toEqual({
      games: 0, items: 0, platforms: 0, trackedPlatforms: 0, value: 0, cost: 0, gain: 0, currency: 'USD',
      addedLastUpdate: 0, lastUpdateAt: null, pricesAsOf: null, valueChange: 0, topPlatform: null, topPlatformGames: 0, spentThisMonth: 0, spentLast12Months: 0,
      // The PC library's totals (pc.test.ts fills them).
      pcGames: 0, pcOwned: 0, pcHours: 0,
      // Games not played yet, games lent out, and copies for sale or trade (0.6.0).
      backlog: 0, lent: 0, forSale: 0,
    });
    // Two PS3 games, one of them twice, and a Wii game; PC games stay out.
    const csv = [
      HEADER,
      '1,"Uncharted",Playstation 3,1000,"Item, Box, and Manual",,,,400,2,2026-01-01,,,,',
      '2,"Journey",Playstation 3,2550,"Item, Box, and Manual",,,,1000,1,2026-01-01,,,,',
      '3,"Okami",Wii,1999,"Item, Box, and Manual",,,,0,1,2026-01-01,,,,',
      '4,"Half-Life",PC Games,500,"Item Only",,,,100,1,2026-01-01,,,,',
    ].join('\n');
    const upload = await g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, ...multipart('collection_20260927.csv', csv) });
    expect(upload.statusCode).toBe(201);
    const after = await stats();
    expect(after).toMatchObject({
      games: 3, items: 4, platforms: 2, value: 65.49, cost: 18, gain: 47.49, currency: 'USD',
      addedLastUpdate: 3, lastUpdateAt: upload.json().import.appliedAt, pricesAsOf: '2026-09-27', valueChange: 0, topPlatform: 'PlayStation 3', topPlatformGames: 2,
      // Unmarked games count as not played yet (Settings > Collection > Playing).
      backlog: 3,
    });
    // A later export where Journey went up $5: the value moved by that much.
    const later = csv.replace('2,"Journey",Playstation 3,2550', '2,"Journey",Playstation 3,3050');
    await g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, ...multipart('collection_20261027.csv', later) });
    expect(await stats()).toMatchObject({ pricesAsOf: '2026-10-27', valueChange: 5 });
    // Signed-in browsers may ask too.
    expect((await g.app.inject({ url: '/api/v1/stats', cookies })).statusCode).toBe(200);
  });
});

describe('import folder', () => {
  it('imports finished files, moves them and leaves files still being written', async () => {
    const folder = join(g.dir, 'imports');
    mkdirSync(folder, { recursive: true });
    const done = join(folder, 'collection_20260926.csv');
    writeFileSync(done, exportCsv(GAMES));
    const old = new Date(Date.now() - 120_000);
    utimesSync(done, old, old);
    writeFileSync(join(folder, 'collection_20260927.csv'), exportCsv(GAMES.slice(0, 3)));
    writeFileSync(join(folder, 'notes.txt'), 'ignore me');

    const run = await g.tasks.runNow('import-folder');
    expect(run).toMatchObject({ status: 'success', message: 'collection_20260926.csv: applied' });
    expect(existsSync(join(folder, 'done', 'collection_20260926.csv'))).toBe(true);
    expect(existsSync(join(folder, 'collection_20260927.csv'))).toBe(true);
    expect(existsSync(join(folder, 'notes.txt'))).toBe(true);
  });

  it('never imports a file left in the folder twice, even after newer imports', async () => {
    g.settings.update({ 'collection.afterImport': 'leave' });
    const folder = join(g.dir, 'imports');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, 'collection_20260926.csv');
    writeFileSync(file, exportCsv(GAMES));
    const old = new Date(Date.now() - 120_000);
    utimesSync(file, old, old);
    await g.tasks.runNow('import-folder');
    await upload('collection_20260927.csv', exportCsv([...GAMES, ['7', 'Tetris', 'Nintendo Switch', 900]]));
    const again = await g.tasks.runNow('import-folder');
    expect(again?.message).toBe('collection_20260926.csv: already used');
    expect((await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json().totals.games).toBe(6);
  });

  it('moves refused files into "failed"', async () => {
    const folder = join(g.dir, 'imports');
    mkdirSync(folder, { recursive: true });
    const bad = join(folder, 'collection_20260926.csv');
    writeFileSync(bad, 'not,a,collection\n1,2,3');
    const old = new Date(Date.now() - 120_000);
    utimesSync(bad, old, old);
    await g.tasks.runNow('import-folder');
    expect(existsSync(join(folder, 'failed', 'collection_20260926.csv'))).toBe(true);
  });

  it('takes zips from the watched folder too', async () => {
    const folder = join(g.dir, 'imports');
    mkdirSync(folder, { recursive: true });
    const zip = join(folder, 'collection (1).zip');
    writeFileSync(zip, makeZip({ 'collection_20260928.csv': exportCsv(GAMES) }));
    const old = new Date(Date.now() - 120_000);
    utimesSync(zip, old, old);
    const run = await g.tasks.runNow('import-folder');
    expect(run).toMatchObject({ status: 'success', message: 'collection (1).zip: applied' });
    expect(existsSync(join(folder, 'done', 'collection (1).zip'))).toBe(true);
    expect(g.collection.listImports(1)[0]).toMatchObject({ source: 'folder', fileName: 'collection_20260928.csv' });
  });

  it('does nothing when turned off', async () => {
    g.settings.update({ 'collection.dropFolderEnabled': false });
    expect(g.collection.scanFolder(join(g.dir, 'imports'))).toBe('The watched folder is turned off.');
  });
});

describe('region-locked consoles', () => {
  const consoles = async () => {
    const summary = (await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json();
    return Object.fromEntries(summary.platforms.map((p: { key: string; name: string; copies: number }) => [p.key, `${p.name}: ${p.copies}`]));
  };

  it('gives other-region copies a console of their own, and moves them when the setting changes', async () => {
    const res = await upload(
      'collection_20260927.csv',
      exportCsv([
        ['1', 'Super Mario World', 'Super Nintendo', 1000],
        ['2', 'Super Mario World', 'Super Famicom', 800],
        ['3', 'Mario Kart 64', 'JP Nintendo 64', 900],
        ['4', 'Splatoon 3', 'Nintendo Switch', 4000],
        ['5', 'Splatoon 3', 'JP Nintendo Switch', 3500],
      ]),
    );
    expect(res.statusCode).toBe(201);
    expect(await consoles()).toEqual({
      'super-nintendo': 'Super Nintendo: 1',
      'super-famicom': 'Super Famicom: 1',
      'nintendo-64-japan': 'Nintendo 64 (Japan): 1',
      'nintendo-switch': 'Nintendo Switch: 2',
    });

    // The Super Famicom's catalog games are Japanese releases, and its copies count there even when other regions don't.
    g.settings.update({ 'catalogs.otherRegionsCount': false });
    g.catalogs.syncSource('super-famicom', 'test', [{ title: 'Super Mario World' }, { title: 'Star Fox' }]);
    expect(g.catalogs.summary().find((c) => c.key === 'super-famicom')).toMatchObject({ name: 'Super Famicom', percent: 50 });

    // A console taken off the list counts every region as one again; the change moves the copies already imported.
    const locked = g.settings.get('platforms.regionLocked').filter((k) => k !== 'super-nintendo');
    const put = await g.app.inject({ method: 'PUT', url: '/api/v1/settings', cookies, payload: { changes: { 'platforms.regionLocked': locked } } });
    expect(put.statusCode).toBe(200);
    expect(await consoles()).toEqual({
      'super-nintendo': 'Super Nintendo: 2',
      'nintendo-64-japan': 'Nintendo 64 (Japan): 1',
      'nintendo-switch': 'Nintendo Switch: 2',
    });
    // The Super Famicom's catalog stays for when the Super Nintendo is ticked again, out of completion and the wishlist meanwhile.
    expect(g.catalogs.summary().some((c) => c.key === 'super-famicom')).toBe(false);
  });
});
