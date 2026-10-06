import { afterEach, describe, expect, it } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
import type { FetchLike } from './igdb.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';
import { eq } from 'drizzle-orm';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g.cleanup();
});

/** A fake RomM: an SNES, an arcade and a Game Boy platform; Street Fighter II (IGDB 3186) is on all three in real life. */
function fakeRomm() {
  const state = { down: false, calls: [] as string[] };
  const snes = [
    { id: 101, platform_id: 10, igdb_id: 3186, name: 'Street Fighter II', fs_name: 'Street Fighter II - The World Warrior (Japan).sfc', regions: ['Japan'], tags: [] },
    { id: 102, platform_id: 10, igdb_id: 3186, name: 'Street Fighter II', fs_name: 'Street Fighter II - The World Warrior (USA).sfc', regions: ['USA'], tags: [] },
    { id: 103, platform_id: 10, igdb_id: 3186, name: 'Street Fighter II', fs_name: 'Street Fighter II - The World Warrior (USA) (Beta).sfc', regions: ['USA'], tags: ['Beta'] },
    { id: 104, platform_id: 10, igdb_id: 1026, name: 'The Legend of Zelda: A Link to the Past', fs_name: 'Legend of Zelda, The - A Link to the Past (USA).sfc', regions: ['USA'], tags: [] },
    { id: 105, platform_id: 10, igdb_id: null, name: null, fs_name: 'Super Mario World (USA).sfc', regions: ['USA'], tags: [] },
    { id: 106, platform_id: 10, igdb_id: 999, name: 'Gone', fs_name: 'Gone (USA).sfc', regions: ['USA'], tags: [], missing_from_fs: true },
    // Japanese releases, named in Japanese as RomM often does, with No-Intro's subtitles in the file names.
    { id: 107, platform_id: 10, igdb_id: 1234, name: 'ロックマン7 宿命の対決!', fs_name: 'Rockman 7 - Shukumei no Taiketsu! (Japan).sfc', regions: ['Japan'], tags: [] },
    { id: 108, platform_id: 10, igdb_id: 2001, name: 'Dragon Ball Z: Super Butouden', fs_name: 'Dragon Ball Z - Super Butouden (Japan).sfc', regions: ['Japan'], tags: [] },
    { id: 109, platform_id: 10, igdb_id: 2002, name: 'Dragon Ball Z: Super Butouden 2', fs_name: 'Dragon Ball Z - Super Butouden 2 (Japan).sfc', regions: ['Japan'], tags: [] },
    { id: 110, platform_id: 10, igdb_id: 3000, name: 'スーパーファミスタ2', fs_name: 'Super Famista 2 (Japan).sfc', regions: ['Japan'], tags: [] },
  ];
  const arcade = [{ id: 201, platform_id: 20, igdb_id: 3186, name: 'Street Fighter II', fs_name: 'sf2.zip', regions: ['World'], tags: [] }];
  const fetch: FetchLike = async (url, init) => {
    state.calls.push(url);
    if (state.down) throw new Error('connect ECONNREFUSED');
    if (new Headers(init.headers).get('authorization') !== 'Bearer rmm-test-token') return new Response('{"detail":"Forbidden"}', { status: 403 });
    const u = new URL(url);
    if (u.pathname === '/api/platforms') {
      return Response.json([
        { id: 10, slug: 'snes', name: 'Super Nintendo Entertainment System', igdb_id: 19 },
        { id: 20, slug: 'arcade', name: 'Arcade', igdb_id: 52 },
        { id: 30, slug: 'gb', name: 'Game Boy', igdb_id: 33 },
      ]);
    }
    if (u.pathname === '/api/roms') {
      const platform = Number(u.searchParams.get('platform_ids'));
      const roms = platform === 10 ? snes : platform === 20 ? arcade : [];
      if (u.searchParams.get('playable') === 'true') return Response.json({ items: roms.slice(0, 1), rom_id_index: platform === 10 ? [102, 104] : [] });
      const offset = Number(u.searchParams.get('offset'));
      return Response.json({ items: roms.slice(offset, offset + Number(u.searchParams.get('limit'))) });
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, state };
}

const igdbGame = (id: number, name: string, altNames: string[] = []) =>
  JSON.stringify({ id, name, altNames, coverId: null, genres: [], themes: [], perspectives: [], franchise: null, japanese: null, released: null, gameType: null, collections: [] });

async function start(fake = fakeRomm()) {
  g = await testApp({ rommFetch: fake.fetch, features: ['romm'] });
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [
      ['1', 'Street Fighter II', 'Super Nintendo'],
      ['2', 'Zelda Link to the Past', 'Super Nintendo'],
      ['3', 'Super Mario World', 'Super Nintendo'],
      ['4', 'Unknown Game', 'Super Nintendo'],
      ['5', 'Street Fighter II', 'GameBoy'],
      ['6', 'Rockman 7', 'Super Nintendo'],
      ['7', 'Dragon Ball Z', 'Super Nintendo'],
      ['8', 'Tony Hawk 2', 'Super Nintendo'],
    ],
    catalogs: {
      // The catalog's names for Zelda include IGDB's, so the PriceCharting title finds it.
      'super-nintendo': [
        'Street Fighter II',
        { title: 'Zelda Link to the Past', altTitles: ['The Legend of Zelda: A Link to the Past'] },
        'Super Mario World',
        // A Japanese name keys to "2", as RomM's name of Super Famista 2 does: no link.
        { title: 'Tony Hawk 2', altTitles: ['トニー・ホーク 2'] },
      ],
    },
  });
  // IGDB's lists of both platforms know Street Fighter II as the same game, 3186.
  const id = (key: string) => g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, key)).get()!.id;
  g.db
    .insert(igdbGames)
    .values([
      { platformId: id('super-nintendo'), igdbId: 3186, data: igdbGame(3186, 'Street Fighter II: The World Warrior', ['Street Fighter II']) },
      { platformId: id('super-nintendo'), igdbId: 1026, data: igdbGame(1026, 'The Legend of Zelda: A Link to the Past') },
      { platformId: id('game-boy'), igdbId: 3186, data: igdbGame(3186, 'Street Fighter II') },
    ])
    .run();
  return fake;
}

const turnOn = () =>
  g.settings.update({ 'sources.rommUrl': 'http://romm.test:8080/', 'sources.rommToken': 'rmm-test-token', 'sources.rommPublicUrl': 'https://roms.example.test' });

const items = async (platform: string) =>
  Object.fromEntries(
    ((await g.app.inject({ url: `/api/v1/collection/items?platform=${platform}`, cookies })).json().items as { title: string; romm: unknown }[]).map((i) => [i.title, i.romm]),
  );

describe('RomM links', () => {
  it('links owned games to the same game on the same platform in RomM, the best ROM first', async () => {
    const fake = await start();
    turnOn();
    const run = await g.tasks.runNow('romm-sync');
    expect(run).toMatchObject({ status: 'success', message: '9 ROMs on 2 RomM platforms' });
    // Only mapped platforms are read (SNES by its IGDB number, Game Boy too); the arcade isn't one of Squirrelcade's.
    expect(fake.state.calls.some((c) => c.includes('platform_ids=20'))).toBe(false);

    const snes = await items('super-nintendo');
    // The USA release wins over Japan's and the beta, and RomM can play it in the browser.
    expect(snes['Street Fighter II']).toEqual({ romId: 102, name: 'Street Fighter II', url: 'https://roms.example.test/rom/102', playUrl: 'https://roms.example.test/rom/102/ejs', possible: false });
    // Found through the catalog game's IGDB name.
    expect(snes['Zelda Link to the Past']).toMatchObject({ romId: 104, possible: false });
    // RomM doesn't know its IGDB game: the same title, marked as a possible match.
    expect(snes['Super Mario World']).toEqual({ romId: 105, name: 'Super Mario World (USA).sfc', url: 'https://roms.example.test/rom/105', playUrl: null, possible: true });
    expect(snes['Unknown Game']).toBeNull();
    // A title without the file name's subtitle links when that's one game, and not when it's several.
    expect(snes['Rockman 7']).toMatchObject({ romId: 107, possible: true });
    expect(snes['Dragon Ball Z']).toBeNull();
    expect(snes['Tony Hawk 2']).toBeNull();
    // The same IGDB game on another platform isn't this game: no Game Boy ROM, no link.
    expect((await items('game-boy'))['Street Fighter II']).toBeNull();

    // The console page's owned games and Store Mode's answers link too.
    const detail = (await g.app.inject({ url: '/api/v1/catalogs/super-nintendo?status=owned', cookies })).json();
    expect(detail.entries.find((e: { title: string }) => e.title === 'Street Fighter II').romm).toMatchObject({ romId: 102 });
    const lookup = (await g.app.inject({ url: '/api/v1/lookup?q=street%20fighter', cookies })).json();
    expect(lookup.find((r: { platformKey: string }) => r.platformKey === 'super-nintendo').romm).toMatchObject({ romId: 102 });

    const status = (await g.app.inject({ url: '/api/v1/sources/romm', cookies })).json();
    expect(status).toMatchObject({ configured: true, roms: 9, error: null, owned: { matched: 2, possible: 2, owned: 8 } });
    expect(status.platforms.find((p: { key: string }) => p.key === 'super-nintendo')).toMatchObject({ romm: [{ slug: 'snes' }], via: 'igdb', roms: 9 });
  });

  it('keeps the last index when RomM is down, and shows no links before the first read', async () => {
    const fake = await start();
    turnOn();
    fake.state.down = true;
    expect(await g.tasks.runNow('romm-sync')).toMatchObject({ status: 'failed', message: expect.stringContaining("Couldn't reach RomM") });
    // Never read: no links, and the pages still load.
    const before = await g.app.inject({ url: '/api/v1/collection/items?platform=super-nintendo', cookies });
    expect(before.statusCode).toBe(200);
    expect(before.json().items.every((i: { romm: unknown }) => i.romm === null)).toBe(true);

    fake.state.down = false;
    await g.tasks.runNow('romm-sync');
    fake.state.down = true;
    expect(await g.tasks.runNow('romm-sync')).toMatchObject({ status: 'failed' });
    // The index from the last good read stays, so the links do too.
    expect((await items('super-nintendo'))['Street Fighter II']).toMatchObject({ romId: 102 });
    expect((await g.app.inject({ url: '/api/v1/sources/romm', cookies })).json().error).toContain("Couldn't reach RomM");
  });

  it('tests the connection, follows the platform setting, and stays off without an address', async () => {
    const fake = await start();
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/romm/test', cookies })).statusCode).toBe(400);
    g.settings.update({ 'sources.rommUrl': 'http://romm.test:8080', 'sources.rommToken': 'wrong' });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/romm/test', cookies })).json()).toMatchObject({ ok: false, message: expect.stringContaining('roms.read and platforms.read') });
    turnOn();
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/romm/test', cookies })).json()).toEqual({ ok: true, message: 'Connected to RomM: 3 platforms.' });
    // "Update now" queues the index's task.
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/romm/sync', cookies })).json()).toEqual({ queued: true });
    await g.tasks.runNow('romm-sync');
    // A setting line sends the Super Nintendo to the arcade platform instead: SF2's arcade ROM is linked.
    g.settings.update({ 'sources.rommPlatforms': ['super-nintendo: arcade'] });
    await g.tasks.runNow('romm-sync');
    expect((await items('super-nintendo'))['Street Fighter II']).toMatchObject({ romId: 201 });
    expect(fake.state.calls.some((c) => c.includes('platform_ids=20'))).toBe(true);
    // Without an address the links are off.
    g.settings.update({ 'sources.rommUrl': '' });
    expect((await items('super-nintendo'))['Street Fighter II']).toBeNull();
  });
});
