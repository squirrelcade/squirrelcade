import { afterEach, describe, expect, it } from 'vitest';
import { exportCsv, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

type Cookies = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ squirrelcade_session: res.cookies.find((c) => c.name === 'squirrelcade_session')!.value });

const CIB = 'Item, Box, and Manual';
/** Okami twice (complete and loose), Journey, and Flower. */
const COLLECTION = exportCsv([
  ['1', 'Okami', 'Playstation 2', 3000, CIB],
  ['1', 'Okami', 'Playstation 2', 1200, 'Item Only'],
  ['2', 'Journey', 'Playstation 3', 1500, CIB],
  ['3', 'Flower', 'Playstation 3', 900, CIB],
]);
let OKAMI_CIB = '';
let OKAMI_LOOSE = '';
let JOURNEY = '';
let FLOWER = '';

async function collection() {
  g = await testApp();
  cookies = await setUp(g);
  g.collection.importText(COLLECTION, { source: 'upload', fileName: 'collection_20260927.csv' });
  const keyOf = (title: string, includeString = CIB) => g.collection.items({ all: true }).items.find((i) => i.title === title && i.includeString === includeString)!.key;
  OKAMI_CIB = keyOf('Okami');
  OKAMI_LOOSE = keyOf('Okami', 'Item Only');
  JOURNEY = keyOf('Journey');
  FLOWER = keyOf('Flower');
}

const get = async (url: string, who = cookies) => (await g.app.inject({ url, cookies: who })).json();
const post = (url: string, payload: unknown, who = cookies) => g.app.inject({ method: 'POST', url, cookies: who, payload: payload as Record<string, unknown> });
const put = (place: string | null, keys: string[]) => post('/api/v1/places/put', { place, keys });
const placeOf = async (key: string) => (await get(`/api/v1/copy?key=${encodeURIComponent(key)}`)).details.location as string | null;

describe('places', () => {
  it('finds a game by a saved barcode or a title, and puts its copies in a place, saying where they were', async () => {
    await collection();
    // A barcode Squirrelcade doesn't know yet: matched by title, then remembered (as Scan my shelf does).
    expect(await get('/api/v1/places/find?code=012345678905')).toEqual({ code: '012345678905', known: null, games: [] });
    expect((await g.app.inject({ url: '/api/v1/places/find?code=12', cookies })).statusCode).toBe(400);
    const byTitle = await get('/api/v1/places/find?q=okami');
    expect(byTitle.games).toMatchObject([{ platformKey: 'playstation-2', platform: 'PlayStation 2', title: 'Okami', copies: [{ copyKey: OKAMI_CIB, place: null }, { copyKey: OKAMI_LOOSE, place: null }] }]);
    await post('/api/v1/barcodes', { code: '012345678905', platformKey: 'playstation-3', title: 'Journey' });
    expect(await get('/api/v1/places/find?code=0012345678905')).toMatchObject({ code: '012345678905', known: { platformKey: 'playstation-3', title: 'Journey' }, games: [{ title: 'Journey', copies: [{ copyKey: JOURNEY, place: null }] }] });

    const packed = await put('  Bag   7 ', [OKAMI_CIB, JOURNEY]);
    expect(packed.statusCode).toBe(200);
    expect(packed.json()).toMatchObject({ place: 'Bag 7', placed: [{ copyKey: OKAMI_CIB, title: 'Okami', platform: 'PlayStation 2', place: 'Bag 7', before: null }, { copyKey: JOURNEY, before: null }] });
    // The copy without a place comes first; a copy that has one says which.
    expect((await get('/api/v1/places/find?q=okami')).games[0].copies).toMatchObject([{ copyKey: OKAMI_LOOSE, place: null }, { copyKey: OKAMI_CIB, place: 'Bag 7' }]);
    // Moved, and moved back (Undo).
    expect((await put('Shelf A', [JOURNEY])).json().placed).toMatchObject([{ copyKey: JOURNEY, place: 'Shelf A', before: 'Bag 7' }]);
    expect((await put('Bag 7', [JOURNEY])).json().placed[0].before).toBe('Shelf A');
    // Its other details stay; no place at all takes it out.
    await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key: FLOWER, tags: ['Favorite'], location: 'Shelf A' } });
    expect((await put(null, [FLOWER])).json().placed[0]).toMatchObject({ place: null, before: 'Shelf A' });
    expect((await get(`/api/v1/copy?key=${encodeURIComponent(FLOWER)}`)).details).toMatchObject({ location: null, tags: ['Favorite'] });

    // The Stash's filter has them.
    const titles = (await get('/api/v1/collection/items?location=bag%207')).items.map((i: { title: string }) => i.title);
    expect(titles).toEqual(['Journey', 'Okami']);
    // What isn't right is refused, and nothing changes.
    for (const bad of [{ place: 'Bag 8', keys: [] }, { place: 'Bag 8', keys: 'x' }, { place: 'x'.repeat(81), keys: [FLOWER] }, { place: 5, keys: [FLOWER] }, { place: 'Bag 8', keys: [FLOWER, '9|Loose'] }]) {
      expect((await post('/api/v1/places/put', bad)).statusCode).toBe(400);
    }
    expect(await placeOf(FLOWER)).toBeNull();
  });

  it('lists each place with its games, renames a place everywhere and keeps a note on where the place is', async () => {
    await collection();
    await put('Bag 7', [OKAMI_CIB, JOURNEY]);
    await put('Bag 10', [FLOWER]);
    expect(await get('/api/v1/places')).toMatchObject({
      places: [
        { name: 'Bag 7', note: null, copies: [{ title: 'Okami', platform: 'PlayStation 2' }, { title: 'Journey', platform: 'PlayStation 3' }] },
        { name: 'Bag 10', note: null, copies: [{ title: 'Flower' }] },
      ],
      unplaced: 1,
    });

    // A note on the place itself, shown wherever its name is offered.
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/places/note', cookies, payload: { place: 'bag 7', note: ' Under the  master bed ' } })).json()).toEqual({ name: 'bag 7', note: 'Under the master bed' });
    expect((await get('/api/v1/tags')).locations).toEqual([
      { name: 'Bag 7', copies: 2, note: 'Under the master bed' },
      { name: 'Bag 10', copies: 1, note: null },
    ]);
    // A place with a note and no games yet (a bag labeled before it's packed) is listed too.
    await g.app.inject({ method: 'PUT', url: '/api/v1/places/note', cookies, payload: { place: 'Bag 8', note: 'Hall closet' } });
    expect((await get('/api/v1/places')).places.map((p: { name: string; copies: unknown[] }) => `${p.name}: ${p.copies.length}`)).toEqual(['Bag 7: 2', 'Bag 8: 0', 'Bag 10: 1']);

    // Renamed on every copy, the note with it.
    expect((await post('/api/v1/places/rename', { from: 'BAG 7', to: 'Black case #7' })).json()).toEqual({ name: 'Black case #7', copies: 2 });
    expect(await placeOf(OKAMI_CIB)).toBe('Black case #7');
    expect((await get('/api/v1/places')).places.map((p: { name: string; note: string | null }) => `${p.name} (${p.note})`)).toEqual(['Bag 8 (Hall closet)', 'Bag 10 (null)', 'Black case #7 (Under the master bed)']);
    expect((await get('/api/v1/collection/items?location=black%20case%20%237')).items).toHaveLength(2);
    // A name another place has joins them; that place's note stays.
    expect((await post('/api/v1/places/rename', { from: 'Bag 10', to: 'Bag 8' })).json()).toEqual({ name: 'Bag 8', copies: 1 });
    expect((await get('/api/v1/places')).places.map((p: { name: string; note: string | null; copies: unknown[] }) => `${p.name} (${p.note}): ${p.copies.length}`)).toEqual(['Bag 8 (Hall closet): 1', 'Black case #7 (Under the master bed): 2']);
    // An empty note takes it away; a place nobody has can't be renamed; a name is needed.
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/places/note', cookies, payload: { place: 'Bag 8', note: '' } })).json()).toEqual({ name: 'Bag 8', note: null });
    expect((await post('/api/v1/places/rename', { from: 'Bag 99', to: 'Bag 100' })).statusCode).toBe(400);
    expect((await post('/api/v1/places/rename', { from: 'Bag 8', to: '  ' })).statusCode).toBe(400);
  });

  it("gives a shelf photo's games their copies, and keeps places from viewers unless shared", async () => {
    await collection();
    const found = (await post('/api/v1/places/games', { games: [{ platformKey: 'playstation-2', title: 'Okami' }, { platformKey: 'playstation-3', title: 'Journey' }, { platformKey: 'playstation-3', title: 'Not Mine' }] })).json();
    expect(found.games).toMatchObject([{ title: 'Okami', copies: [{ copyKey: OKAMI_CIB }, { copyKey: OKAMI_LOOSE }] }, { title: 'Journey', copies: [{ copyKey: JOURNEY }] }, null]);
    expect((await post('/api/v1/places/games', { games: 'Okami' })).statusCode).toBe(400);

    await put('Bag 7', [JOURNEY]);
    const invite = await post('/api/v1/invites', { name: 'Sam' });
    const viewer = cookieOf(await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } }));
    expect((await g.app.inject({ url: '/api/v1/places', cookies: viewer })).statusCode).toBe(403);
    g.settings.update({ 'security.viewersSeeCopyDetails': true });
    expect((await get('/api/v1/places', viewer)).places[0].name).toBe('Bag 7');
    // They still change nothing, and can't look games up to pack.
    expect((await post('/api/v1/places/put', { place: 'Bag 8', keys: [JOURNEY] }, viewer)).statusCode).toBe(403);
    expect((await post('/api/v1/places/rename', { from: 'Bag 7', to: 'Bag 8' }, viewer)).statusCode).toBe(403);
    expect((await g.app.inject({ url: '/api/v1/places/find?q=okami', cookies: viewer })).statusCode).toBe(403);
  });
});
