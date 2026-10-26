import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { copies, igdbGames, platforms } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let dir: string;
afterEach(async () => {
  await g.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

// A made-up purchases sheet (no one's real orders).
const SHEET = [
  ['Order date', 'Order #', 'Item', 'ASIN', 'Qty', 'Unit price', 'Line total', 'Sold by', 'Condition', 'Shipment status', 'Cancelled', 'Video game?', 'Product page'],
  ['2019-03-04', '111-0000001-0000001', 'Okami - PlayStation 2', 'B000000001', '1', '$20.00', '$20.00', 'Amazon.com', 'New', 'Delivered', '', 'Yes', 'View'],
  ['2019-03-04', '111-0000001-0000001', 'Kingdom Hearts - PlayStation 2', 'B000000002', '1', '$15.50', '$15.50', 'Amazon.com', 'New', 'Delivered', '', 'Yes', 'View'],
  ['2020-01-10', '111-0000002-0000002', 'Journey - PlayStation 3', 'B000000003', '1', '$9.99', '$9.99', '', '', 'Cancelled Your order was cancelled.', '', 'Yes', 'View'],
  ['2020-02-01', '111-0000003-0000003', 'PlayStation 2 Slim Console', 'B000000004', '1', '$99.00', '$99.00', '', '', 'Delivered', '', 'Accessory/hardware', 'View'],
  ['2020-02-01', '111-0000003-0000003', 'USB cable', 'B000000005', '1', '$5.00', '$5.00', '', '', 'Delivered', '', '', 'View'],
];
const csv = SHEET.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');

describe('a purchases CSV (D178)', () => {
  it('works out what it would change, writes nothing until asked, then only the rows chosen, each once', async () => {
    dir = mkdtempSync(join(tmpdir(), 'squirrelcade-sheet-'));
    writeFileSync(join(dir, 'purchases.csv'), csv);
    g = await testApp();
    const cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Okami', 'PlayStation 2']], catalogs: { 'playstation-2': ['Okami', 'Kingdom Hearts'], 'playstation-3': ['Journey'] } });
    g.settings.update({ 'sources.purchaseCsv': true, 'sources.purchaseCsvFolder': dir });
    expect(await g.purchaseSheet.refresh()).toBe('5 rows, 2 games: 1 to write on your copies, 1 not in your collection');
    const copyOf = (id?: number) => g.db.select().from(copies).where(id ? eq(copies.id, id) : eq(copies.title, 'Okami')).get()!;
    const okami = copyOf();
    const before = { cost: okami.costCents, order: null };
    const { audit } = (await g.app.inject({ url: '/api/v1/purchase-sheet', cookies })).json();
    expect(audit).toMatchObject({ rows: 5, games: 2, gone: 1 });
    expect(audit.writes).toEqual([expect.objectContaining({ title: 'Okami', platformKey: 'playstation-2', copyId: okami.id, unitCents: 2000, date: '2019-03-04', orderNumber: '111-0000001-0000001', asin: 'B000000001' })]);
    expect(audit.missing).toEqual([expect.objectContaining({ title: 'Kingdom Hearts', platform: 'PlayStation 2', unitCents: 1550 })]);
    expect(audit.consoles).toEqual([{ item: 'PlayStation 2 Slim Console', date: '2020-02-01', platform: 'PlayStation 2' }]);
    // Nothing written yet.
    expect(copyOf(okami.id).costCents).toBe(before.cost);

    // The owner chooses both: the copy gets its price and day, and Kingdom Hearts goes on the way.
    const applied = await g.app.inject({ method: 'POST', url: '/api/v1/purchase-sheet/apply', cookies, payload: { keys: [audit.writes[0].key, audit.missing[0].key] } });
    expect(applied.json()).toEqual({ written: 1, onTheWay: 1 });
    expect(copyOf(okami.id)).toMatchObject({ costCents: 2000, datePurchased: '2019-03-04', orderNumber: '111-0000001-0000001', asin: 'B000000001' });
    const coming = (await g.app.inject({ url: '/api/v1/coming', cookies })).json().items as { title: string | null; itemCents: number }[];
    expect(coming.find((c) => c.title === 'Kingdom Hearts')).toMatchObject({ itemCents: 1550 });
    // Read again: nothing left to do; applied twice: nothing more.
    expect(await g.purchaseSheet.refresh()).toBe('5 rows, 2 games: 0 to write on your copies, 0 not in your collection');
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/purchase-sheet/apply', cookies, payload: { keys: [audit.writes[0].key] } })).json()).toEqual({ written: 0, onTheWay: 0 });
  });

  it("decides what's a game itself: a pre-order naming no console, a game the sheet took for hardware, codes left out (D184)", async () => {
    dir = mkdtempSync(join(tmpdir(), 'squirrelcade-sheet-'));
    const head = SHEET[0]!;
    const rows = [
      head,
      // The sheet's keyword guess left it blank, and its name says no console: IGDB has it coming out on the Switch 2.
      ['2026-09-08', '111-0000020-0000020', 'The Legend of Zelda: Ocarina of Time', 'B000000020', '1', '$59.88', '$59.88', 'Amazon.com', 'New', 'Not yet shipped Arriving November 5', '', '', 'View'],
      // Called hardware by the guess; a PS5 game.
      ['2026-03-01', '111-0000021-0000021', 'Stranger of Paradise: Final Fantasy Origin - PlayStation 5', 'B000000021', '1', '$19.99', '$19.99', 'Amazon.com', 'New', 'Delivered', '', 'Accessory/hardware', 'View'],
      ['2026-03-02', '111-0000022-0000022', 'Hades - Nintendo Switch [Digital Code]', 'B000000022', '1', '$24.99', '$24.99', 'Amazon.com', 'New', 'Delivered', '', 'Yes', 'View'],
      ['2026-03-03', '111-0000023-0000023', 'Nintendo Switch 2 Pro Controller', 'B000000023', '1', '$84.99', '$84.99', 'Amazon.com', 'New', 'Delivered', '', 'Yes', 'View'],
      ['2026-03-04', '111-0000024-0000024', 'Steam Deck OLED Carrying Case', 'B000000024', '1', '$20.00', '$20.00', 'Amazon.com', 'New', 'Delivered', '', '', 'View'],
    ];
    writeFileSync(join(dir, 'purchases.csv'), rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n'));
    g = await testApp();
    const cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Okami', 'PlayStation 2']], catalogs: { 'nintendo-64': ['The Legend of Zelda: Ocarina of Time'], 'nintendo-switch-2': ['Mario Kart World'], 'playstation-5': ['Astro Bot'], 'nintendo-switch': ['Hades'] } });
    const idOf = (key: string) => g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, key)).get()!.id;
    const igdb = (id: number, key: string, released: string) => ({ platformId: idOf(key), igdbId: id, data: JSON.stringify({ id, name: 'The Legend of Zelda: Ocarina of Time', altNames: [], coverId: null, genres: [], themes: [], perspectives: [], franchise: null, japanese: false, released, gameType: 'Main Game' }) });
    g.db.insert(igdbGames).values([igdb(1, 'nintendo-64', '1998-11-21'), igdb(2, 'nintendo-switch-2', '2026-11-05')]).run();
    g.igdb.forgetPlatforms();
    // The console its name ends with, though that console's catalog hasn't the game yet: not the N64's.
    expect(g.orders.gameOf('The Legend of Zelda: Ocarina of Time - Nintendo Switch 2')).toEqual({ platformKey: 'nintendo-switch-2', title: 'The Legend of Zelda: Ocarina of Time' });
    expect(g.orders.gameOf('The Legend of Zelda: Ocarina of Time - Nintendo 64')).toEqual({ platformKey: 'nintendo-64', title: 'The Legend of Zelda: Ocarina of Time' });
    // A pasted order page's "Arriving November 5" is the day it's expected.
    const page = await g.app.inject({ method: 'POST', url: '/api/v1/coming/page', cookies, payload: { text: 'Order placed September 8, 2026\nOrder # 111-0000030-0000030\nArriving November 5\nThe Legend of Zelda: Ocarina of Time - Nintendo Switch 2\n$59.88\nAmazon.com' } });
    expect(page.statusCode).toBe(201);
    const paged = (await g.app.inject({ url: '/api/v1/coming', cookies })).json().items as { orderNumber: string; expectedOn: string | null; platformKey: string | null }[];
    expect(paged.find((c) => c.orderNumber === '111-0000030-0000030')).toMatchObject({ expectedOn: '2026-11-05', platformKey: 'nintendo-switch-2' });
    for (const c of (await g.app.inject({ url: '/api/v1/coming', cookies })).json().items as { id: number }[]) await g.app.inject({ method: 'POST', url: `/api/v1/coming/${c.id}/dismiss`, cookies });
    g.settings.update({ 'sources.purchaseCsv': true, 'sources.purchaseCsvFolder': dir });
    await g.purchaseSheet.refresh();
    const { audit } = (await g.app.inject({ url: '/api/v1/purchase-sheet', cookies })).json();
    expect(audit.missing).toEqual([
      expect.objectContaining({ title: 'The Legend of Zelda: Ocarina of Time', platformKey: 'nintendo-switch-2', coming: true, expectedOn: '2026-11-05' }),
      expect.objectContaining({ item: 'Stranger of Paradise: Final Fantasy Origin - PlayStation 5', platformKey: 'playstation-5' }),
    ]);
    expect(audit.leftOut).toEqual([
      { item: 'Hades - Nintendo Switch [Digital Code]', date: '2026-03-02', why: 'a console game bought as a digital code' },
      { item: 'Nintendo Switch 2 Pro Controller', date: '2026-03-03', why: "marked a video game, but it doesn't read as one" },
    ]);
    // Written: the pre-order goes on the way with the day it's expected.
    await g.app.inject({ method: 'POST', url: '/api/v1/purchase-sheet/apply', cookies, payload: { keys: [audit.missing[0].key] } });
    const coming = (await g.app.inject({ url: '/api/v1/coming', cookies })).json().items;
    expect(coming).toEqual([expect.objectContaining({ title: 'The Legend of Zelda: Ocarina of Time', platformKey: 'nintendo-switch-2', expectedOn: '2026-11-05' })]);
    // Counted when the owner says so.
    g.settings.update({ 'orders.countDigitalCodes': true });
    await g.purchaseSheet.refresh();
    expect(g.purchaseSheet.audit()!.missing.map((m) => m.item)).toContain('Hades - Nintendo Switch [Digital Code]');
  });

  it('takes an uploaded CSV into its folder, and reads every CSV there, each row once', async () => {
    dir = mkdtempSync(join(tmpdir(), 'squirrelcade-sheet-'));
    // An earlier file with the first two rows, and an upload with them all: the same rows aren't counted twice.
    writeFileSync(join(dir, 'a-earlier.csv'), SHEET.slice(0, 3).map((r) => r.map((c) => `"${c}"`).join(',')).join('\n'));
    writeFileSync(join(dir, 'notes.csv'), 'Just,some\nother,file');
    g = await testApp();
    const cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Okami', 'PlayStation 2']], catalogs: { 'playstation-2': ['Okami', 'Kingdom Hearts'] } });
    const form = (text: string) => {
      const boundary = '----squirrelcade';
      return { payload: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="purchases.csv"\r\nContent-Type: text/csv\r\n\r\n${text}\r\n--${boundary}--\r\n`, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
    };
    // Off by default: no upload.
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/purchase-sheet/upload', cookies, ...form(csv) })).statusCode).toBe(400);
    // On, with nothing in its folder yet: nothing to read, and no failure.
    g.settings.update({ 'sources.purchaseCsv': true, 'sources.purchaseCsvFolder': join(dir, 'empty') });
    expect(await g.purchaseSheet.refresh()).toBe('No purchases CSV yet: upload one, or save one in its folder');
    g.settings.update({ 'sources.purchaseCsvFolder': dir });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/purchase-sheet/upload', cookies, ...form('Not,a,purchases,file') })).statusCode).toBe(400);
    const up = await g.app.inject({ method: 'POST', url: '/api/v1/purchase-sheet/upload', cookies, ...form(csv) });
    expect(up.json()).toMatchObject({ rows: 5 });
    expect(readdirSync(dir).filter((n) => n.startsWith('uploaded-'))).toHaveLength(1);
    expect(await g.purchaseSheet.refresh()).toBe('5 rows, 2 games: 1 to write on your copies, 1 not in your collection');
  });
});
