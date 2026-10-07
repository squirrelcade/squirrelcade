import { afterEach, describe, expect, it } from 'vitest';
import { rommPlatforms, rommRoms } from './db/schema.js';
import { exportCsv, multipartFile, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g?.cleanup();
});

const SEALED = 'New Item, Box, and Manual';

/** Sealed Switch games also owned on Steam, Okami sealed on PS2 and opened on Wii, Tearaway sealed only, and two look-alike pairs. */
const COLLECTION = exportCsv([
  ['1', 'Hades', 'Nintendo Switch', 2000, SEALED],
  ['2', 'Celeste', 'Nintendo Switch', 1500, SEALED],
  ['3', 'Okami', 'Playstation 2', 3000, SEALED],
  ['4', 'Okami', 'Wii', 1000, 'Item Only'],
  ['5', 'Tearaway', 'Playstation Vita', 1000, SEALED],
  ['6', 'Doom', 'Playstation 4', 1000],
  ['7', 'Biohazard 4', 'JP Gamecube', 4000],
]);

/** A Playnite reader snapshot: Hades and Celeste's special edition on Steam, the 1993 Doom, Resident Evil 4, and a Game Pass game. */
const SNAPSHOT = JSON.stringify({
  schemaVersion: 'vgcm-playnite-library-v1',
  generatedAtUtc: '2026-09-27T12:00:00Z',
  source: { fileName: 'PlayniteBackup-2026-09-26.zip', lastWriteUtc: '2026-09-26T12:53:59Z', fingerprint: 'x' },
  statistics: { gameRecords: 5 },
  records: [
    ['Steam', '1', 'Hades'],
    ['Steam', '2', 'Celeste: Farewell Edition'],
    ['Steam', '3', 'Doom'],
    ['Steam', '4', 'Resident Evil 4'],
    ['Xbox Game Pass', '5', 'Tearaway'],
  ].map(([store, id, name]) => ({
    recordKey: `${store}|${id}`,
    playniteId: `p-${id}`,
    storefrontGameId: id,
    sourceName: store,
    name,
    platforms: ['PC (Windows)'],
    genres: [],
    series: [],
    favorite: false,
    hidden: false,
    installed: false,
    playtimeSeconds: 0,
    playCount: 0,
    links: [],
  })),
});

type Group = { key: string; title: string; total: number; sealed: number; playable: { kind: string; label: string }[]; consoles: { copyKey: string; platform: string }[]; pc: { copyKey: string; storefronts: { storefront: string }[] }[] };

async function prepare(pcOn = true) {
  g = await testApp({ features: pcOn ? ['pc'] : [] });
  const cookies = await setUp(g);
  g.collection.importText(COLLECTION, { source: 'upload', fileName: 'collection_20260928.csv' });
  if (pcOn) {
    // Game Pass is a subscription: it lets you play, but you don't own the game.
    g.settings.update({ 'pc.storefrontOwnership': ['Xbox Game Pass: subscription'] });
    const read = await g.app.inject({ method: 'POST', url: '/api/v1/pc/snapshot', cookies, ...multipartFile('snapshot.json', Buffer.from(SNAPSHOT), 'application/json') });
    expect(read.statusCode).toBe(201);
  }
  return cookies;
}

describe('Copies', () => {
  it('finds sealed games you can play another way: on PC, with an opened copy, and none for the rest', async () => {
    const cookies = await prepare();
    const list = async (query = '') => (await g.app.inject({ url: `/api/v1/copies${query}`, cookies })).json();
    const first = await list();
    expect(first).toMatchObject({ view: 'sealed-playable', pcOn: true, counts: { 'sealed-playable': 3, 'sealed-only': 1, multiple: 4 } });
    expect(first.items.map((x: Group) => [x.title, x.playable.map((w) => w.label)])).toEqual([
      ['Celeste', ['Steam']],
      ['Hades', ['Steam']],
      ['Okami', ['A copy on Wii']],
    ]);
    // Only the ones on PC.
    expect((await list('?how=pc')).items.map((x: Group) => x.title)).toEqual(['Celeste', 'Hades']);
    // Sealed with no other way: a subscription doesn't count as owning it.
    expect((await list('?view=sealed-only')).items.map((x: Group) => [x.title, x.pc.map((p) => p.storefronts[0]!.storefront)])).toEqual([['Tearaway', ['Xbox Game Pass']]]);
    // More than one copy: on two consoles, or on a console and PC (Doom's two games share a name, for now); a
    // subscription isn't a copy (Tearaway).
    expect((await list('?view=multiple')).items.map((x: Group) => [x.title, x.total])).toEqual([
      ['Celeste', 2],
      ['Doom', 2],
      ['Hades', 2],
      ['Okami', 2],
    ]);
    expect((await list('?view=all&q=resident')).items.map((x: Group) => x.title)).toEqual(['Resident Evil 4']);
  });

  it('lists the games you have more than once on one console: the copies PriceCharting counts beyond the games', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    const csv = exportCsv([
      ['1', 'Hades', 'Nintendo Switch', 2000, SEALED],
      ['1', 'Hades', 'Nintendo Switch', 2000],
      ['2', 'Battlefield 4', 'Playstation 3', 500],
      ['2', 'Battlefield 4', 'Playstation 3', 500],
      ['2', 'Battlefield 4', 'Playstation 3', 500],
      ['3', 'Okami', 'Playstation 2', 3000],
      ['4', 'Okami', 'Wii', 1000],
    ]);
    expect(g.collection.importText(csv, { source: 'upload', fileName: 'collection_20260927.csv' }).import.status).toBe('applied');
    const summary = (await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json();
    expect(summary.totals).toMatchObject({ games: 4, copies: 7, repeatGames: 2, repeatCopies: 3 });
    // The same item more than once on a console; Okami on two consoles is more than one copy, not a repeat.
    const list = (await g.app.inject({ url: '/api/v1/copies?view=repeats', cookies })).json();
    expect(list.counts).toMatchObject({ repeats: 2, multiple: 3 });
    expect(list.items.map((x: Group) => x.title)).toEqual(['Battlefield 4', 'Hades']);
    // The headings sort it (D144): by title either way, or by how many copies, most first.
    const titles = async (query: string) => (await g.app.inject({ url: `/api/v1/copies?view=all&${query}`, cookies })).json().items.map((x: Group) => x.title);
    expect(await titles('sort=title&dir=desc')).toEqual(['Okami', 'Hades', 'Battlefield 4']);
    expect(await titles('sort=copies')).toEqual(['Battlefield 4', 'Hades', 'Okami']);
    expect(await titles('sort=copies&dir=asc')).toEqual(['Hades', 'Okami', 'Battlefield 4']);
  });

  it('lets the owner say a copy is another game, or the same game under another name, and take it back', async () => {
    const cookies = await prepare();
    const list = async (query = '') => (await g.app.inject({ url: `/api/v1/copies${query}`, cookies })).json();
    const put = (copyKey: string, groupKey: string | null) => g.app.inject({ method: 'PUT', url: '/api/v1/copies/group', cookies, payload: { copyKey, groupKey } });
    const all = async () => (await list('?view=all&pageSize=500')).items as Group[];

    // The Steam Doom is the 1993 game, not the PS4's: it stands on its own.
    const doom = (await all()).find((x) => x.title === 'Doom')!;
    expect((await put(doom.pc[0]!.copyKey, 'own')).statusCode).toBe(200);
    expect((await all()).filter((x) => x.title === 'Doom').map((x) => [x.total, x.consoles.length, x.pc.length])).toEqual([
      [1, 1, 0],
      [1, 0, 1],
    ]);

    // Resident Evil 4 on Steam is the Japanese Biohazard 4: found by title, and put with it.
    const found = (await g.app.inject({ url: '/api/v1/copies/search?q=bioha', cookies })).json();
    expect(found).toMatchObject([{ title: 'Biohazard 4' }]);
    const re4 = (await all()).find((x) => x.title === 'Resident Evil 4')!;
    expect((await put(re4.pc[0]!.copyKey, found[0].key)).statusCode).toBe(200);
    const together = (await all()).find((x) => x.title === 'Biohazard 4')!;
    expect(together).toMatchObject({ total: 2, pc: [{ copyKey: re4.pc[0]!.copyKey, moved: true }] });
    expect((await list('?view=multiple')).counts.multiple).toBe(4);

    // Taken back: Resident Evil 4 is on its own again.
    await put(re4.pc[0]!.copyKey, null);
    expect((await all()).find((x) => x.title === 'Biohazard 4')!.total).toBe(1);
    // Something that isn't a copy is refused.
    expect((await put('nonsense', 'own')).statusCode).toBe(400);
  });

  it('counts RomM as a way to play a sealed game (with RomM on), and has nothing to show before the first export', async () => {
    g = await testApp({ features: ['romm'] });
    const cookies = await setUp(g);
    expect((await g.app.inject({ url: '/api/v1/copies?view=all', cookies })).json()).toMatchObject({ total: 0, counts: { all: 0 } });
    g.collection.importText(COLLECTION, { source: 'upload', fileName: 'collection_20260928.csv' });
    g.db.insert(rommPlatforms).values({ id: 3, slug: 'psvita', name: 'PlayStation Vita', igdbId: null, romCount: 1 }).run();
    g.db.insert(rommRoms).values({ id: 30, platformId: 3, igdbId: null, name: 'Tearaway', fsName: 'Tearaway (USA).vpk', regions: '["USA"]', tags: '[]', playable: false }).run();
    g.settings.update({ 'sources.rommUrl': 'http://romm.test:8080', 'sources.rommPlatforms': ['playstation-vita: psvita'] });
    const list = (await g.app.inject({ url: '/api/v1/copies?how=romm', cookies })).json();
    expect(list.items.map((x: Group) => [x.title, x.playable])).toEqual([['Tearaway', [{ kind: 'romm', label: 'RomM (PlayStation Vita)', url: 'http://romm.test:8080/rom/30' }]]]);
    // A request that isn't an answer about a copy is refused.
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/copies/group', cookies, payload: { groupKey: 'own' } })).statusCode).toBe(400);
  });

  it('works without the PC library, and viewers see it (with PC copies only when shared) but change nothing', async () => {
    const cookies = await prepare();
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Sam' }, cookies });
    const joined = await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } });
    const viewer = { squirrelcade_session: joined.cookies.find((c) => c.name === 'squirrelcade_session')!.value };
    expect((await g.app.inject({ url: '/api/v1/copies', cookies: viewer })).json()).toMatchObject({ pcOn: true, counts: { 'sealed-playable': 3 } });
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/copies/group', cookies: viewer, payload: { copyKey: 'pc|doom', groupKey: 'own' } })).statusCode).toBe(403);
    // Not sharing the PC library with viewers leaves its copies out of their Copies page.
    g.settings.update({ 'security.viewersSeePc': false });
    expect((await g.app.inject({ url: '/api/v1/copies', cookies: viewer })).json()).toMatchObject({ pcOn: false, counts: { 'sealed-playable': 1, 'sealed-only': 3 } });

    // The PC library off (Settings > Features): console copies only, for the owner too.
    g.settings.update({ 'features.pc': false });
    const off = (await g.app.inject({ url: '/api/v1/copies', cookies })).json();
    expect(off).toMatchObject({ pcOn: false, counts: { 'sealed-playable': 1, 'sealed-only': 3, multiple: 1 } });
    expect(off.items.map((x: Group) => x.title)).toEqual(['Okami']);
  });
});
