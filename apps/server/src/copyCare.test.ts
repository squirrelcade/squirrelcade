import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HEADER, multipartForm, seedCatalogs, setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

const row = (id: string, title: string, label: string, cents: number, inc: string, paid: string, bought = '') => `${id},"${title}",${label},${cents},"${inc}",,,,${paid},1,2026-01-01,${bought},,,`;
/** Uncharted complete (paid, bought), Journey sealed and Flower loose (nothing paid), Mario Kart on a card console. */
const COLLECTION = [
  HEADER,
  row('1', 'Uncharted', 'Playstation 3', 1000, 'Item, Box, and Manual', '2500', '2010-05-01'),
  row('2', 'Journey', 'Playstation 3', 1500, 'New Item, Box, and Manual', '0'),
  row('3', 'Flower', 'Playstation 3', 900, 'Item Only', '0'),
  row('4', 'Mario Kart 8 Deluxe', 'Nintendo Switch', 4000, 'Item, Box, and Manual', '5999', '2017-04-28'),
].join('\n');

function load() {
  g.collection.importText(COLLECTION, { source: 'upload', fileName: 'collection_20260927.csv' });
  seedCatalogs(g, { owned: [], catalogs: { 'playstation-3': [{ title: 'Journey', releaseDate: '2012-03-13' }, 'Uncharted', 'Flower'] } });
}
const keyOf = (title: string) => g.collection.items({ q: title }).items[0]!.key;
const idOf = (title: string) => g.collection.items({ q: title }).items[0]!.id;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const photo = (key: string, slot?: string) =>
  g.app.inject({ method: 'POST', url: '/api/v1/photos', cookies, ...multipartForm({ key, ...(slot ? { slot } : { caption: 'Extra' }) }, { name: 'photo.png', content: PNG, type: 'image/png' }) });
const improve = async (query = '') => (await g.app.inject({ url: `/api/v1/collection/improve${query}`, cookies })).json();

describe('looking after copies', () => {
  it('keeps each test of a copy: when, whether it works, and a note', async () => {
    load();
    const key = keyOf('Uncharted');
    const first = await g.app.inject({ method: 'POST', url: '/api/v1/copy/tests', cookies, payload: { key, result: 'issues', note: 'Skips in chapter 3', testedAt: '2026-01-10T12:00:00Z' } });
    expect(first.statusCode).toBe(201);
    const second = (await g.app.inject({ method: 'POST', url: '/api/v1/copy/tests', cookies, payload: { key, result: 'works' } })).json();
    const tests = (await g.app.inject({ url: `/api/v1/copy?key=${encodeURIComponent(key)}`, cookies })).json().tests;
    expect(tests.map((t: { result: string }) => t.result)).toEqual(['works', 'issues']);
    expect(tests[1]).toMatchObject({ note: 'Skips in chapter 3', testedAt: '2026-01-10T12:00:00.000Z' });
    // The Collection page shows the last test.
    const item = (await g.app.inject({ url: '/api/v1/collection/items?q=Uncharted', cookies })).json().items[0];
    expect(item.details.tested).toMatchObject({ result: 'works' });
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/copy/tests/${second.id}`, cookies })).json()).toEqual({ removed: true });
    for (const bad of [{ key, result: 'fine' }, { key, result: 'works', testedAt: 'yesterday' }, { key: '9|Loose', result: 'works' }]) {
      expect((await g.app.inject({ method: 'POST', url: '/api/v1/copy/tests', cookies, payload: bad })).statusCode).toBe(400);
    }
  });

  it("names each copy's standard photos by what it has and its console, one photo each", async () => {
    load();
    const game = async (platform: string, title: string) => (await g.app.inject({ url: `/api/v1/game?platform=${platform}&title=${encodeURIComponent(title)}`, cookies })).json().copies[0];
    expect((await game('playstation-3', 'Uncharted')).slots).toEqual(['Box front', 'Box back', 'Inside', 'Disc front', 'Disc back']);
    expect((await game('playstation-3', 'Journey')).slots).toEqual(['Box front', 'Box back']);
    expect((await game('playstation-3', 'Flower')).slots).toEqual(['Disc front', 'Disc back']);
    expect((await game('nintendo-switch', 'Mario Kart 8 Deluxe')).slots).toEqual(['Box front', 'Box back', 'Inside', 'Card front', 'Card back']);
    // A standard photo takes the place of the one it had; another photo is kept beside them.
    const key = keyOf('Uncharted');
    const front = (await photo(key, 'Box front')).json();
    expect(front).toMatchObject({ slot: 'Box front', caption: 'Box front' });
    await photo(key, 'Box front');
    const extra = (await photo(key)).json();
    let photos = (await g.app.inject({ url: `/api/v1/copy?key=${encodeURIComponent(key)}`, cookies })).json().photos as { id: number; slot: string | null }[];
    expect(photos.map((p) => p.slot)).toEqual(['Box front', null]);
    expect(photos.find((p) => p.id === front.id)).toBeUndefined();
    // An extra photo can become a standard one.
    await g.app.inject({ method: 'PUT', url: `/api/v1/photos/${extra.id}`, cookies, payload: { slot: 'Box front' } });
    photos = (await g.app.inject({ url: `/api/v1/copy?key=${encodeURIComponent(key)}`, cookies })).json().photos;
    expect(photos.map((p) => [p.id === extra.id, p.slot])).toEqual([
      [false, null],
      [true, 'Box front'],
    ]);
    g.settings.update({ 'collection.photoSlotsManual': ['Manual front'] });
    expect((await game('playstation-3', 'Uncharted')).slots).toContain('Manual front');
  });

  it("keeps an estimated price only when the owner sets one, and suggests one when asked", async () => {
    load();
    const items = async (who = cookies) => (await g.app.inject({ url: '/api/v1/collection/items', cookies: who })).json().items as { title: string; estimatedCents: number | null }[];
    const suggestion = async (title: string) => (await g.app.inject({ url: `/api/v1/collection/copies/${idOf(title)}/suggestion`, cookies })).json().suggestion;
    // Nothing is estimated unless the owner asks.
    expect((await items()).every((i) => i.estimatedCents === null)).toBe(true);
    expect((await g.app.inject({ url: '/api/v1/collection/statistics', cookies })).json().estimated).toEqual({ cents: 0, copies: 0 });
    // Suggest: Journey, sealed, a new PS3 game at its release; Flower, loose, half of that, no date.
    expect(await suggestion('Journey')).toEqual({ cents: 5999, basis: 'new', newCents: 5999, date: '2012-03-13' });
    expect(await suggestion('Flower')).toEqual({ cents: 3000, basis: 'used', newCents: 5999, date: null });
    g.settings.update({ 'collection.newGamePrices': ['PlayStation 3: 49.99'], 'collection.usedShare': 40 });
    expect(await suggestion('Flower')).toMatchObject({ cents: 2000 });
    // The owner takes one (or types their own): it's theirs, apart from what was paid.
    const set = await g.app.inject({ method: 'PUT', url: `/api/v1/collection/copies/${idOf('Journey')}`, cookies, payload: { estimatedCents: 4999 } });
    expect(set.json().copy).toMatchObject({ estimatedCents: 4999, costCents: 0 });
    expect((await items()).find((i) => i.title === 'Journey')!.estimatedCents).toBe(4999);
    expect((await g.app.inject({ url: '/api/v1/collection/estimates', cookies })).json()).toEqual({ cents: 4999, copies: 1 });
    expect((await g.app.inject({ url: '/api/v1/collection/statistics', cookies })).json().estimated).toEqual({ cents: 4999, copies: 1 });
    expect((await g.app.inject({ url: '/api/v1/game?platform=playstation-3&title=Journey', cookies })).json().copies[0].estimatedCents).toBe(4999);
    // Never what was paid: not in the collection's download, and a file doesn't touch it.
    const csv = (await g.app.inject({ url: '/api/v1/collection/export', cookies })).body;
    expect(csv.split(/\r?\n/).find((l) => l.startsWith('Journey,'))).toContain(',15.00,0.00,');
    expect(csv).not.toContain('49.99');
    g.collection.importText(COLLECTION.replace('Journey",Playstation 3,1500', 'Journey",Playstation 3,1600'), { source: 'upload', fileName: 'collection_20261003.csv' });
    expect((await items()).find((i) => i.title === 'Journey')!.estimatedCents).toBe(4999);
    expect((await g.app.inject({ method: 'PUT', url: `/api/v1/collection/copies/${idOf('Journey')}`, cookies, payload: { estimatedCents: -5 } })).statusCode).toBe(400);
    // Suggest turned off; a viewer who isn't shown prices paid doesn't see estimates.
    g.settings.update({ 'collection.estimates': false });
    expect(await suggestion('Flower')).toBeNull();
  });

  it('lists what copies are missing, by what counts, and takes the answers as they come', async () => {
    load();
    let list = await improve();
    // Paid: Journey, Flower. Date: Journey, Flower. Photos, tested, location: all four.
    expect(list.counts).toEqual({ paid: 2, date: 2, photos: 4, tested: 4, location: 4 });
    expect(list.total).toBe(4);
    const journey = list.items.find((i: { title: string }) => i.title === 'Journey');
    expect(journey).toMatchObject({ gaps: ['paid', 'date', 'photos', 'tested', 'location'], missingPhotos: ['Box front', 'Box back'], estimatedCents: null });
    expect((await improve('?gap=paid')).items.map((i: { title: string }) => i.title)).toEqual(['Flower', 'Journey']);
    // Answers: a test, a place, an estimate (the price isn't known), the photos, and the day bought.
    const key = keyOf('Journey');
    await g.app.inject({ method: 'POST', url: '/api/v1/copy/tests', cookies, payload: { key, result: 'works' } });
    await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key, location: 'Shelf A' } });
    await g.app.inject({ method: 'PUT', url: `/api/v1/collection/copies/${idOf('Journey')}`, cookies, payload: { estimatedCents: 5999, datePurchased: '2012-03-13' } });
    await photo(key, 'Box front');
    await photo(key, 'Box back');
    list = await improve();
    expect(list.items.map((i: { title: string }) => i.title)).not.toContain('Journey');
    expect(list.counts).toEqual({ paid: 1, date: 1, photos: 3, tested: 3, location: 3 });
    // What counts is a setting; a test long ago counts again once "test again after" is set.
    g.settings.update({ 'collection.improvePhotos': false, 'collection.improveTested': false, 'collection.improveLocation': false, 'collection.improveDate': false });
    expect((await improve()).items.map((i: { title: string }) => i.title)).toEqual(['Flower']);
    g.settings.update({ 'collection.improveTested': true, 'collection.retestMonths': 6 });
    await g.app.inject({ method: 'POST', url: '/api/v1/copy/tests', cookies, payload: { key: keyOf('Uncharted'), result: 'works', testedAt: '2020-01-01T00:00:00Z' } });
    expect((await improve('?gap=tested')).items.map((i: { title: string }) => i.title)).toEqual(['Flower', 'Mario Kart 8 Deluxe', 'Uncharted']);
  });
});
