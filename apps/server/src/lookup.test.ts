import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BarcodeServiceKey, BarcodeServiceLimit, upcDatabase, upcItemDb } from './lookup.js';
import { seedCatalogs, setUp, testApp } from './test-helpers.js';

const PRODUCTS: Record<string, string> = {
  '045496590036': 'Xenoblade Chronicles - Nintendo Wii',
  '711719541028': "Tales of Graces f - PlayStation 3 Standard Edition",
  // Names as barcode services write them (made up for the tests): a publisher first, an edition after, notes in brackets.
  '012345678905': 'Nintendo Xenoblade Chronicles Special Edition (Nintendo Wii) [Pre-Owned]',
  '036000291452': 'Capcom Okami Deluxe Edition - Nintendo Wii',
  '710425498114': 'Totally Unknown Thing (Xbox One)',
  // No title fits exactly: a publisher before it and a word left out ("of").
  '049000000443': 'Bandai Tales Graces F PlayStation 3',
};
let lookups = 0;

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  lookups = 0;
  g = await testApp({
    productNameLookup: async (code) => {
      lookups++;
      if (code === '999999999999') throw new Error('service down');
      return PRODUCTS[code] ?? null;
    },
  });
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [
      ['1', 'Okami', 'Wii'],
      ['2', 'Cars 2', 'Playstation 3'],
      ['3', 'Katamari Forever', 'JP Playstation 3'],
    ],
    catalogs: {
      'playstation-3': ['Okami', 'Tales of Graces f', 'Cars 2: The Video Game'],
      wii: ['Okami', 'Xenoblade Chronicles'],
    },
  });
});
afterEach(async () => {
  await g.cleanup();
});

describe('Store Mode lookups', () => {
  it('answers by title across platforms', async () => {
    const results = (await g.app.inject({ url: '/api/v1/lookup?q=okami', cookies })).json();
    expect(results.map((r: { platform: string; answer: string }) => [r.platform, r.answer])).toEqual([
      ['PlayStation 3', 'own-elsewhere'],
      ['Wii', 'own'],
    ]);
    expect(results[0].ownedOn).toEqual(['Wii']);
    // Owned copies carry their value from the export; needed games have none.
    expect(results[1].ownedValueCents).toBe(1000);
    expect(results[0].ownedValueCents).toBeNull();
    expect(results[1].ownedProductIds).toBeUndefined();
    const tales = (await g.app.inject({ url: '/api/v1/lookup?q=tales%20of%20graces', cookies })).json();
    expect(tales[0]).toMatchObject({ answer: 'need', title: 'Tales of Graces f' });
    expect(tales[0].wishlist.rank).toBeGreaterThan(0);
    // Your preference comes with a catalog game: in Store Mode, a console's list and the ownership answers (Check a list).
    expect(tales[0].preference).toBeNull();
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', cookies, payload: { platformKey: 'playstation-3', title: 'Tales of Graces f', preference: 'Must Have', note: null } });
    expect((await g.app.inject({ url: '/api/v1/lookup?q=tales%20of%20graces', cookies })).json()[0]).toMatchObject({ preference: 'Must Have' });
    const entries = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?status=missing', cookies })).json().entries as { title: string; preference: string | null }[];
    expect(entries.find((e) => e.title === 'Tales of Graces f')).toMatchObject({ preference: 'Must Have' });
    expect(entries.find((e) => e.title === 'Okami')).toMatchObject({ preference: null });
    const [asked] = (await g.app.inject({ method: 'POST', url: '/api/v1/owned', payload: { games: [{ title: 'Tales of Graces f' }, { title: 'Katamari Forever' }] }, cookies })).json().results;
    expect(asked.answers).toEqual([expect.objectContaining({ answer: 'need', preference: 'Must Have' })]);
    // The header's search asks for fewer; a limit out of range is ignored.
    expect((await g.app.inject({ url: '/api/v1/lookup?q=okami&limit=1', cookies })).json()).toHaveLength(1);
    expect((await g.app.inject({ url: '/api/v1/lookup?q=okami&limit=0', cookies })).json()).toHaveLength(2);
  });

  it("gives Store Mode's offline copy: every answer, your notes and saved barcodes, again only when changed", async () => {
    await g.app.inject({ method: 'POST', url: '/api/v1/barcodes', payload: { code: '711719541028', platformKey: 'playstation-3', title: 'Tales of Graces f' }, cookies });
    await g.app.inject({ method: 'PUT', url: '/api/v1/game/note', payload: { platformKey: 'playstation-3', title: 'Tales of Graces f', note: 'Only complete' }, cookies });
    const res = await g.app.inject({ url: '/api/v1/lookup/offline', cookies });
    expect(res.headers['content-type']).toContain('application/json');
    const copy = res.json() as { version: number; platforms: { key: string; name: string }[]; games: { p: number; t: string; a: string; on?: string[]; n?: string; w?: unknown }[]; barcodes: [string, number, string][] };
    expect(copy.version).toBe(1);
    const answer = (key: string, title: string) => copy.games.find((x) => copy.platforms[x.p]!.key === key && x.t === title);
    // The same answers as a search: owned here, owned on another console, needed with its wishlist points.
    expect(answer('wii', 'Okami')).toMatchObject({ a: 'own' });
    expect(answer('playstation-3', 'Okami')).toMatchObject({ a: 'own-elsewhere', on: ['Wii'] });
    expect(answer('playstation-3', 'Tales of Graces f')).toMatchObject({ a: 'need', n: 'Only complete', w: { rank: expect.any(Number) }, e: expect.any(Number) });
    // An owned copy outside the catalogs, and the saved barcode.
    expect(copy.games.some((x) => x.t === 'Katamari Forever' && x.a === 'own-not-in-catalog')).toBe(true);
    expect(copy.barcodes).toEqual([['711719541028', copy.platforms.findIndex((x) => x.key === 'playstation-3'), 'Tales of Graces f']]);
    // A phone that has this copy isn't sent it again; one that takes gzip gets it compressed.
    const etag = res.headers.etag as string;
    expect((await g.app.inject({ url: '/api/v1/lookup/offline', headers: { 'if-none-match': etag }, cookies })).statusCode).toBe(304);
    // Also as a proxy that compressed it again passes the tag on: weak.
    expect((await g.app.inject({ url: '/api/v1/lookup/offline', headers: { 'if-none-match': `W/${etag}` }, cookies })).statusCode).toBe(304);
    const zipped = await g.app.inject({ url: '/api/v1/lookup/offline', headers: { 'accept-encoding': 'gzip, br' }, cookies });
    expect(zipped.headers['content-encoding']).toBe('gzip');
    expect(JSON.parse(gunzipSync(zipped.rawPayload).toString('utf8'))).toEqual(copy);
  });

  it('answers other tools whether games are owned, by title as catalogs compare them', async () => {
    const ask = async (games: unknown) => g.app.inject({ method: 'POST', url: '/api/v1/owned', payload: { games }, cookies });
    const res = await ask([{ title: 'Okami' }, { title: 'Okami', platform: 'playstation-3' }, { title: 'Tales of Graces f' }, { title: 'Katamari Forever' }, { title: 'Nothing Like It' }]);
    expect(res.statusCode).toBe(200);
    const [anywhere, onPs3, tales, katamari, none] = res.json().results;
    expect(anywhere).toMatchObject({ title: 'Okami', platform: null, owned: true, ownedOn: ['Wii'] });
    expect(anywhere.answers.map((a: { platform: string; answer: string }) => [a.platform, a.answer])).toEqual([
      ['PlayStation 3', 'own-elsewhere'],
      ['Wii', 'own'],
    ]);
    // On the PS3 it isn't owned, but it is on the Wii.
    expect(onPs3).toMatchObject({ platform: 'playstation-3', owned: false, ownedOn: ['Wii'], answers: [{ answer: 'own-elsewhere' }] });
    expect(tales).toMatchObject({ owned: false, ownedOn: [], answers: [{ title: 'Tales of Graces f', answer: 'need' }] });
    expect(katamari).toMatchObject({ owned: true, answers: [{ answer: 'own-not-in-catalog' }] });
    // A copy outside every catalog has no preference to show.
    expect(katamari.answers[0].preference).toBeUndefined();
    expect(none).toMatchObject({ owned: false, answers: [] });
    // Only the same title: "Cars 2" asks about the owned Cars 2, not "Cars 2: The Video Game".
    const [cars] = (await ask([{ title: 'Cars 2', platform: 'playstation-3' }])).json().results;
    expect(cars.answers.map((a: { title: string }) => a.title)).toEqual(['Cars 2']);
    // One game by the query string, and questions it can't answer.
    expect((await g.app.inject({ url: '/api/v1/owned?title=okami&platform=wii', cookies })).json()).toMatchObject({ owned: true });
    expect((await g.app.inject({ url: '/api/v1/owned', cookies })).statusCode).toBe(400);
    expect((await ask([])).statusCode).toBe(400);
    expect((await ask([{ title: '' }])).statusCode).toBe(400);
    expect((await ask(Array.from({ length: 101 }, () => ({ title: 'Okami' })))).statusCode).toBe(400);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/owned', payload: { games: [{ title: 'Okami' }] } })).statusCode).toBe(401);
  });

  it('warns about possible matches and lists owned games outside the catalog', async () => {
    const cars = (await g.app.inject({ url: '/api/v1/lookup?q=cars%202', cookies })).json();
    expect(cars.find((r: { title: string }) => r.title === 'Cars 2: The Video Game')).toMatchObject({ answer: 'check', maybe: ['Cars 2'] });
    expect(cars.find((r: { title: string }) => r.title === 'Cars 2')).toMatchObject({ answer: 'own-not-in-catalog' });
    const katamari = (await g.app.inject({ url: '/api/v1/lookup?q=katamari', cookies })).json();
    expect(katamari[0]).toMatchObject({ answer: 'own-not-in-catalog', platform: 'PlayStation 3' });
  });

  it('asks about games not confirmed physical, and confirms them from the shelf', async () => {
    // On a console with download-only games, a game with no physical evidence isn't a need yet.
    seedCatalogs(g, { owned: [], catalogs: { 'nintendo-switch': ['Shelf Find'] } });
    const find = async () => (await g.app.inject({ url: '/api/v1/lookup?q=shelf%20find', cookies })).json()[0];
    const before = await find();
    expect(before).toMatchObject({ answer: 'unconfirmed', title: 'Shelf Find' });
    const res = await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${before.entryId}`, cookies, payload: { targetStatus: 'required' } });
    expect(res.statusCode).toBe(200);
    expect(await find()).toMatchObject({ answer: 'need' });
  });

  it('names a new barcode with the lookup service, then remembers it once linked', async () => {
    const first = (await g.app.inject({ url: '/api/v1/lookup/barcode/0 45496 59003 6', cookies })).json();
    expect(first).toMatchObject({ code: '045496590036', known: false, productName: 'Xenoblade Chronicles - Nintendo Wii', searchedFor: 'Xenoblade Chronicles' });
    expect(first.results[0]).toMatchObject({ title: 'Xenoblade Chronicles', platform: 'Wii', answer: 'need' });
    await g.app.inject({ method: 'POST', url: '/api/v1/barcodes', cookies, payload: { code: '045496590036', platformKey: 'wii', title: 'Xenoblade Chronicles' } });
    const again = (await g.app.inject({ url: '/api/v1/lookup/barcode/045496590036', cookies })).json();
    expect(again).toMatchObject({ known: true, results: [{ title: 'Xenoblade Chronicles', answer: 'need' }] });
    expect(lookups).toBe(1);
    // A barcode linked to the wrong game can be forgotten: the next scan matches the service's name again (kept, so
    // not asked again).
    expect((await g.app.inject({ method: 'DELETE', url: '/api/v1/barcodes/045496590036', cookies })).json()).toEqual({ removed: true });
    expect((await g.app.inject({ url: '/api/v1/lookup/barcode/045496590036', cookies })).json()).toMatchObject({ known: false, productName: 'Xenoblade Chronicles - Nintendo Wii' });
    expect(lookups).toBe(1);
    expect((await g.app.inject({ method: 'DELETE', url: '/api/v1/barcodes/045496590036', cookies })).json()).toEqual({ removed: false });
  });

  it('keeps one link per barcode, whatever form it was saved in before', async () => {
    // A link saved before barcodes were kept as their 12 digits: with the zero some phones read in front.
    const wii = g.db.$client.prepare("select id from platforms where key = 'wii'").get() as { id: number };
    g.db.$client.prepare("insert into barcodes (code, platform_id, title, source, created_at) values ('0045496590036', ?, 'Okami', 'user', '2026-09-01')").run(wii.id);
    const forms = () => (g.db.$client.prepare("select code from barcodes where code like '%45496590036'").all() as { code: string }[]).map((r) => r.code);
    expect((await g.app.inject({ url: '/api/v1/barcodes/045496590036', cookies })).json()).toMatchObject({ saved: { title: 'Okami' } });
    // Linked again (it was the wrong game): the new link replaces the old one rather than sitting beside it.
    await g.app.inject({ method: 'POST', url: '/api/v1/barcodes', cookies, payload: { code: '045496590036', platformKey: 'wii', title: 'Xenoblade Chronicles' } });
    expect(forms()).toEqual(['045496590036']);
    expect((await g.app.inject({ url: '/api/v1/lookup/barcode/0045496590036', cookies })).json()).toMatchObject({ known: true, results: [{ title: 'Xenoblade Chronicles' }] });
    // Forgotten in whatever form it was saved.
    g.db.$client.prepare("update barcodes set code = '0045496590036'").run();
    expect((await g.app.inject({ method: 'DELETE', url: '/api/v1/barcodes/045496590036', cookies })).json()).toEqual({ removed: true });
    expect(forms()).toEqual([]);
  });

  it("finds the game inside a barcode service's name, on the console the name gives first", async () => {
    const answer = async (code: string) => (await g.app.inject({ url: `/api/v1/lookup/barcode/${code}`, cookies })).json();
    // A publisher's name before the title, an edition and notes after it: the title in between is the game.
    const xeno = await answer('012345678905');
    expect(xeno).toMatchObject({ known: false, searchedFor: 'Xenoblade Chronicles', platformKey: 'wii', platformName: 'Wii' });
    expect(xeno.results[0]).toMatchObject({ title: 'Xenoblade Chronicles', platform: 'Wii', answer: 'need' });
    // The same game on two consoles: the one the name gives comes first.
    const okami = await answer('036000291452');
    expect(okami.results.map((r: { platform: string }) => r.platform)).toEqual(['Wii', 'PlayStation 3']);
    // No title fits exactly: the console's game sharing most of the name's words.
    expect((await answer('049000000443')).results[0]).toMatchObject({ title: 'Tales of Graces f', platform: 'PlayStation 3', answer: 'need' });
    // A code scanned again asks the barcode service once.
    const before = lookups;
    await answer('036000291452');
    expect(lookups).toBe(before);
    // Nothing matches: the name, cleaned, and its console, for the page to say so.
    expect(await answer('710425498114')).toMatchObject({ results: [], searchedFor: 'totally unknown thing', platformKey: 'xbox-one', platformName: 'Xbox One' });
  });

  it('knows a saved barcode however the camera reads it, and gives family its price by the barcode', async () => {
    // Saved from a phone that read the UPC with a zero in front; scanned later without it (and the other way).
    await g.app.inject({ method: 'POST', url: '/api/v1/barcodes', cookies, payload: { code: '0045496590036', platformKey: 'wii', title: 'Xenoblade Chronicles' } });
    expect((await g.app.inject({ url: '/api/v1/lookup/barcode/045496590036', cookies })).json()).toMatchObject({ code: '045496590036', known: true });
    expect((await g.app.inject({ url: '/api/v1/lookup/barcode/0045496590036', cookies })).json()).toMatchObject({ code: '045496590036', known: true });
    // The phone's offline copy has it in the one form a scan is compared in.
    const offline = (await g.app.inject({ url: '/api/v1/lookup/offline', cookies })).json();
    expect(offline.barcodes.map((b: [string, number, string]) => b[0])).toEqual(['045496590036']);
    // Shopping for them: PriceCharting's link for the scanned game goes by its barcode (that edition's page).
    g.settings.update({ 'security.publicCheck': 'everywhere' });
    const check = (await g.app.inject({ url: '/api/v1/check?barcode=012345678905' })).json();
    expect(check.results[0]).toMatchObject({ title: 'Xenoblade Chronicles', answer: 'need' });
    expect(check.results[0].links[0]).toEqual({ name: 'PriceCharting', url: 'https://www.pricecharting.com/search-products?type=prices&q=012345678905' });
    expect(check.lookupUrl).toBe('https://www.pricecharting.com/search-products?type=prices&q=012345678905');
    // A game found by title keeps the title search.
    expect((await g.app.inject({ url: '/api/v1/check?q=xenoblade' })).json().results[0].links[0].url).toContain('q=Xenoblade%20Chronicles%20Wii');
  });

  it('copes with unknown codes, a failing service and the lookup turned off', async () => {
    expect((await g.app.inject({ url: '/api/v1/lookup/barcode/123456789012', cookies })).json().message).toMatch(/doesn't know/);
    expect((await g.app.inject({ url: '/api/v1/lookup/barcode/999999999999', cookies })).json().message).toMatch(/didn't answer/);
    expect((await g.app.inject({ url: '/api/v1/lookup/barcode/12', cookies })).json().message).toMatch(/doesn't look like/);
    // A name the service gave before still answers with the service turned off; a new barcode can't be named.
    await g.app.inject({ url: '/api/v1/lookup/barcode/036000291452', cookies });
    g.settings.update({ 'sources.barcodeLookup': 'off' });
    const before = lookups;
    expect((await g.app.inject({ url: '/api/v1/lookup/barcode/036000291452', cookies })).json().results[0]).toMatchObject({ title: 'Okami' });
    expect((await g.app.inject({ url: '/api/v1/lookup/barcode/711719541028', cookies })).json().message).toMatch(/Search for the game/);
    expect(lookups).toBe(before);
  });

  it("keeps the barcode service's answers for good, past a restart, and asks about an unknown code again after a week", async () => {
    await g.app.inject({ url: '/api/v1/lookup/barcode/045496590036', cookies });
    await g.app.inject({ url: '/api/v1/lookup/barcode/123456789012', cookies });
    expect(lookups).toBe(2);
    // A new start of the app (sessions and kept names are in the database).
    await g.restart();
    const again = (await g.app.inject({ url: '/api/v1/lookup/barcode/045496590036', cookies })).json();
    expect(again).toMatchObject({ known: false, productName: 'Xenoblade Chronicles - Nintendo Wii', searchedFor: 'Xenoblade Chronicles' });
    expect((await g.app.inject({ url: '/api/v1/lookup/barcode/123456789012', cookies })).json().message).toMatch(/doesn't know/);
    expect(lookups).toBe(2);
    // An unknown code asked about more than a week ago is asked about again (the service's database grows).
    g.db.$client.prepare("update barcode_names set asked_at = '2000-01-01T00:00:00.000Z' where code = '123456789012'").run();
    await g.app.inject({ url: '/api/v1/lookup/barcode/123456789012', cookies });
    expect(lookups).toBe(3);
  });
});

describe('the barcode service, paced', () => {
  let calls: string[];
  const PAST_ONE_WINDOW = 700;
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const scan = async (code: string) => (await g.app.inject({ url: `/api/v1/lookup/barcode/${code}`, cookies })).json();

  it('asks no faster than its per-minute limit: a barcode over it waits its turn in the background', async () => {
    await g.cleanup();
    calls = [];
    g = await testApp({
      barcodePacing: { perMinute: 2, windowMs: 400 },
      productNameLookup: async (code) => {
        calls.push(code);
        return { name: PRODUCTS[code] ?? null, left: 100 - calls.length, resetAt: '2099-01-01T00:00:00.000Z' };
      },
    });
    cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Okami', 'Wii']], catalogs: { wii: ['Okami', 'Xenoblade Chronicles'], 'playstation-3': ['Tales of Graces f'] } });
    // Two lookups in the window: answered at once, with the service's count of lookups left.
    expect(await scan('045496590036')).toMatchObject({ searchedFor: 'Xenoblade Chronicles', lookups: { left: 99, resetAt: '2099-01-01T00:00:00.000Z' } });
    expect((await scan('036000291452')).results[0]).toMatchObject({ title: 'Okami' });
    // The third waits: the page is told when to ask again, and the family check too.
    const third = await scan('711719541028');
    expect(third).toMatchObject({ results: [], retryInSeconds: expect.any(Number), lookups: { left: 98 } });
    expect(third.message).toMatch(/Waiting for the barcode service, which takes 2 lookups a minute/);
    g.settings.update({ 'security.publicCheck': 'everywhere' });
    const family = (await g.app.inject({ url: '/api/v1/check?barcode=711719541028' })).json();
    expect(family).toMatchObject({ results: [], retryInSeconds: expect.any(Number) });
    expect(family.message).toMatch(/Waiting for the barcode service/);
    // A fourth is behind it in the line.
    expect((await scan('049000000443')).message).toMatch(/1 barcode ahead of this one/);
    expect(calls).toHaveLength(2);
    // As the window passes, the line is asked about in the background; the next scans answer from what was kept.
    await pause(PAST_ONE_WINDOW);
    expect(calls).toEqual(['045496590036', '036000291452', '711719541028', '049000000443']);
    expect((await scan('711719541028')).results[0]).toMatchObject({ title: 'Tales of Graces f' });
    expect(calls).toHaveLength(4);
  });

  it("follows the service's own limits: waits after its slow down, and stops asking once today's are used up", async () => {
    await g.cleanup();
    calls = [];
    let slowDown = true;
    g = await testApp({
      barcodePacing: { perMinute: 5, windowMs: 400 },
      productNameLookup: async (code) => {
        calls.push(code);
        if (code === '036000291452' && slowDown) {
          slowDown = false;
          throw new BarcodeServiceLimit(false, null);
        }
        if (code === '123456789012') throw new BarcodeServiceLimit(true, '2099-01-01T07:00:00.000Z');
        return PRODUCTS[code] ?? null;
      },
    });
    cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Okami', 'Wii']], catalogs: { wii: ['Okami', 'Xenoblade Chronicles'] } });
    // "Slow down": the barcode waits, and is asked again once the service's pause has passed.
    expect(await scan('036000291452')).toMatchObject({ results: [], retryInSeconds: expect.any(Number) });
    await pause(PAST_ONE_WINDOW);
    expect(calls).toEqual(['036000291452', '036000291452']);
    expect((await scan('036000291452')).results[0]).toMatchObject({ title: 'Okami' });
    // Today's used up: said so (the page shows when more come), and no more lookups until then.
    const usedUp = await scan('123456789012');
    expect(usedUp.message).toMatch(/lookups for today are used up/);
    expect(usedUp.lookups).toEqual({ left: 0, resetAt: '2099-01-01T07:00:00.000Z' });
    expect((await scan('045496590036')).message).toMatch(/used up/);
    expect(calls).toHaveLength(3);
    // A barcode named before still answers.
    expect((await scan('036000291452')).results[0]).toMatchObject({ title: 'Okami' });
  });
});

describe('a second barcode service: UPC Database', () => {
  let asked: string[];
  const scan = async (code: string) => (await g.app.inject({ url: `/api/v1/lookup/barcode/${code}`, cookies })).json();

  async function withServices(options: { itemdb?: (code: string) => Promise<string | null>; database?: (code: string) => Promise<string | null> } = {}) {
    await g.cleanup();
    asked = [];
    g = await testApp({
      productNameLookup: async (code) => {
        asked.push(`upcitemdb ${code}`);
        return options.itemdb ? options.itemdb(code) : (PRODUCTS[code] ?? null);
      },
      upcDatabaseLookup: async (code) => {
        asked.push(`upcdatabase ${code}`);
        return options.database ? options.database(code) : code === '123456789012' ? 'Okami (Wii)' : null;
      },
    });
    cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Okami', 'Wii']], catalogs: { wii: ['Okami', 'Xenoblade Chronicles'] } });
  }

  it("asks UPC Database for barcodes UPCitemdb doesn't know, once it's chosen with its key", async () => {
    await withServices();
    // UPCitemdb alone doesn't know it; kept as unknown to UPCitemdb.
    expect((await scan('123456789012')).message).toMatch(/doesn't know/);
    // UPC Database chosen without its key: said so, no lookup.
    g.settings.update({ 'sources.barcodeLookup': 'upcdatabase' });
    expect((await scan('045496590036')).message).toMatch(/UPC Database needs its key/);
    // Both, with the key: UPCitemdb first, UPC Database for what it doesn't know (asked again: UPC Database is new).
    g.settings.update({ 'sources.barcodeLookup': 'both', 'sources.upcDatabaseKey': 'a-key' });
    const okami = await scan('123456789012');
    expect(okami.results[0]).toMatchObject({ title: 'Okami', platform: 'Wii' });
    expect(asked).toEqual(['upcitemdb 123456789012', 'upcitemdb 123456789012', 'upcdatabase 123456789012']);
    // A barcode UPCitemdb names isn't asked of UPC Database.
    expect((await scan('045496590036')).searchedFor).toBe('Xenoblade Chronicles');
    expect(asked.at(-1)).toBe('upcitemdb 045496590036');
    // Kept for good with the service that named it.
    const row = g.db.$client.prepare("select source from barcode_names where code = '123456789012'").get() as { source: string };
    expect(row.source).toBe('upcdatabase');
  });

  it("goes on to UPC Database when UPCitemdb's lookups are used up, and says when its key isn't taken", async () => {
    await withServices({
      itemdb: async () => {
        throw new BarcodeServiceLimit(true, '2099-01-01T07:00:00.000Z');
      },
      database: async (code) => {
        if (code === '036000291452') throw new BarcodeServiceKey("UPC Database didn't take its key: check it in Settings > Sources > Barcodes.");
        return 'Okami (Wii)';
      },
    });
    g.settings.update({ 'sources.barcodeLookup': 'both', 'sources.upcDatabaseKey': 'a-key' });
    expect((await scan('123456789012')).results[0]).toMatchObject({ title: 'Okami' });
    // UPCitemdb's are used up: not asked again today.
    expect((await scan('045496590036')).results[0]).toMatchObject({ title: 'Okami' });
    expect(asked.filter((a) => a.startsWith('upcitemdb'))).toHaveLength(1);
    expect((await scan('036000291452')).message).toMatch(/didn't take its key/);
  });
});

describe('the barcode services over HTTP', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } }));

  it("reads UPCitemdb's name and its count of lookups left, and its two limits", async () => {
    vi.stubGlobal('fetch', answer(200, { items: [{ title: ' Okami - Nintendo Wii ' }] }, { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '87', 'x-ratelimit-reset': '4102444800' }));
    expect(await upcItemDb('036000291452')).toEqual({ name: 'Okami - Nintendo Wii', left: 87, resetAt: '2100-01-01T00:00:00.000Z' });
    vi.stubGlobal('fetch', answer(404, {}));
    expect(await upcItemDb('000000000000')).toEqual({ name: null, left: null, resetAt: null });
    // The minute's limit (6), then the day's (100).
    vi.stubGlobal('fetch', answer(429, {}, { 'x-ratelimit-limit': '6', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 40) }));
    await expect(upcItemDb('036000291452')).rejects.toMatchObject({ daily: false });
    vi.stubGlobal('fetch', answer(429, {}, { 'x-ratelimit-limit': '100', 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 8 * 3600) }));
    await expect(upcItemDb('036000291452')).rejects.toMatchObject({ daily: true });
  });

  it("reads UPC Database's title, sends its key, and says when the key isn't taken", async () => {
    const found = answer(200, { success: true, barcode: '036000291452', title: 'Okami', description: '' });
    vi.stubGlobal('fetch', found);
    expect(await upcDatabase('the-key')('036000291452')).toEqual({ name: 'Okami' });
    expect(found.mock.calls[0]).toEqual(['https://api.upcdatabase.org/product/036000291452', expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer the-key' }) })]);
    vi.stubGlobal('fetch', answer(200, { success: false, error: { code: 404, message: 'No item found' } }));
    expect(await upcDatabase('the-key')('000000000000')).toEqual({ name: null });
    vi.stubGlobal('fetch', answer(401, { success: false }));
    await expect(upcDatabase('wrong')('036000291452')).rejects.toBeInstanceOf(BarcodeServiceKey);
    vi.stubGlobal('fetch', answer(429, { success: false }));
    await expect(upcDatabase('the-key')('036000291452')).rejects.toMatchObject({ daily: true });
  });
});
