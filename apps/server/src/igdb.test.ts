import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike } from './igdb.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g.cleanup();
});

/** Stand-in for Twitch and IGDB: PS3 (9) has the named games plus filler, enough for two pages. */
function fakeIgdb(options: { tokenStatus?: number; expireFirstToken?: boolean } = {}) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  let tokens = 0;
  const named = [
    {
      id: 10,
      name: 'Tales of Graces f',
      cover: { image_id: 'co_tales' },
      genres: [{ name: 'Role-playing (RPG)' }],
      involved_companies: [{ developer: true, company: { country: 392 } }],
      collections: [{ name: 'Tales' }],
      game_type: { type: 'Main Game' },
      release_dates: [{ platform: 9, date: 1344556800 }],
    },
    { id: 20, name: 'Okami HD', cover: { image_id: 'co_okami' }, genres: [{ name: 'Adventure' }] },
    { id: 30, name: 'Uncharted: Drakes Fortune', cover: { image_id: 'co_uncharted' }, genres: [{ name: 'Shooter' }, { name: 'Adventure' }] },
  ];
  const filler = Array.from({ length: 498 }, (_, i) => ({ id: 1000 + i, name: `Filler Game ${i}` }));
  const ps3 = [...named, ...filler];
  // A second platform (as the Super Famicom is the Super Nintendo's): one game on both, one only there.
  const second = [named[0]!, { id: 40, name: 'Japan Only Game', cover: { image_id: 'co_japan' } }];
  const fetch: FetchLike = async (url, init) => {
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
    const body = typeof init.body === 'string' ? init.body : '';
    calls.push({ url, headers, body });
    if (url.startsWith('https://id.twitch.tv/oauth2/token')) {
      tokens++;
      if (options.tokenStatus) return new Response('{"message":"invalid client"}', { status: options.tokenStatus });
      return Response.json({ access_token: `token-${tokens}`, expires_in: 5_000_000, token_type: 'bearer' });
    }
    if (headers['Authorization'] !== `Bearer token-${tokens}` || headers['Client-ID'] !== 'my-client-id') return new Response('unauthorized', { status: 401 });
    if (options.expireFirstToken && tokens === 1) return new Response('expired', { status: 401 });
    if (url === 'https://api.igdb.com/v4/platforms') return Response.json([{ id: 9, name: 'PlayStation 3' }]);
    if (url === 'https://api.igdb.com/v4/games' && /fields summary;/.test(body)) {
      const id = Number(/where id = (\d+);/.exec(body)?.[1]);
      return Response.json(id === 10 ? [{ id, summary: 'A Tales game about friendship.' }] : [{ id }]);
    }
    if (url === 'https://api.igdb.com/v4/games') {
      const platform = Number(/platforms = \((\d+)\)/.exec(body)?.[1]);
      const after = Number(/id > (\d+)/.exec(body)?.[1] ?? 0);
      const limit = Number(/limit (\d+)/.exec(body)?.[1] ?? 10);
      const games = platform === 9 ? ps3 : platform === 77 ? second : [];
      return Response.json(games.filter((x) => x.id > after).slice(0, limit));
    }
    if (url === 'https://api.igdb.com/v4/game_release_formats') return Response.json([{ id: 1, format: 'Digital' }, { id: 2, format: 'Physical' }]);
    if (url === 'https://api.igdb.com/v4/external_games') {
      // Physical retail listings: Tales of Graces f in the US, Okami HD in Japan.
      const physical = /platform = 9 & game_release_format = 2/.test(body) && !/offset [1-9]/.test(body);
      if (/platform = 77 & game_release_format = 2/.test(body) && !/offset [1-9]/.test(body)) return Response.json([{ game: 40, countries: [392] }, { game: 10, countries: [392] }]);
      return Response.json(physical ? [{ game: 10, countries: [840] }, { game: 20, countries: [392] }, { game: 10, countries: [124] }] : []);
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls, tokens: () => tokens };
}

async function start(fake: ReturnType<typeof fakeIgdb>, more: string[] = []) {
  g = await testApp({ igdbFetch: fake.fetch });
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [['1', "Uncharted: Drake's Fortune [Greatest Hits]", 'Playstation 3']],
    catalogs: { 'playstation-3': ["Uncharted: Drake's Fortune", 'Tales of Graces f', 'Okami HD', 'Not On IGDB', ...more] },
  });
}

const keys = () => g.settings.update({ 'sources.igdbClientId': 'my-client-id', 'sources.igdbClientSecret': 'my-secret' });

describe('IGDB', () => {
  it('tests the keys', async () => {
    const fake = fakeIgdb();
    await start(fake);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/igdb/test', cookies })).statusCode).toBe(400);
    keys();
    const ok = (await g.app.inject({ method: 'POST', url: '/api/v1/sources/igdb/test', cookies })).json();
    expect(ok).toEqual({ ok: true, message: 'Connected to IGDB (it knows PlayStation 3).' });
    const token = fake.calls.find((c) => c.url.startsWith('https://id.twitch.tv'))!;
    expect(token.url).toContain('client_id=my-client-id');
    expect(token.url).toContain('grant_type=client_credentials');
  });

  it('says so when Twitch refuses the keys', async () => {
    await start(fakeIgdb({ tokenStatus: 403 }));
    keys();
    const res = (await g.app.inject({ method: 'POST', url: '/api/v1/sources/igdb/test', cookies })).json();
    expect(res).toEqual({ ok: false, message: 'Twitch did not accept the client ID and secret. Check both in Settings > Sources.' });
    const run = await g.tasks.runNow('igdb-sync');
    expect(run).toMatchObject({ status: 'failed', message: 'Twitch did not accept the client ID and secret. Check both in Settings > Sources.' });
  });

  it("asks IGDB for a game's summary the first time its drawer opens, and keeps it", async () => {
    const fake = fakeIgdb();
    await start(fake);
    const summary = async (title: string) => (await g.app.inject({ url: `/api/v1/game/summary?platform=playstation-3&title=${encodeURIComponent(title)}`, cookies })).json();
    // Without IGDB's data (or keys), there's none to show.
    expect(await summary('Tales of Graces f')).toEqual({ summary: null });
    keys();
    await g.tasks.runNow('igdb-sync');
    expect(await summary('Tales of Graces f')).toEqual({ summary: 'A Tales game about friendship.' });
    const asked = fake.calls.filter((c) => /fields summary;/.test(c.body)).length;
    expect(await summary('Tales of Graces f')).toEqual({ summary: 'A Tales game about friendship.' });
    expect(fake.calls.filter((c) => /fields summary;/.test(c.body)).length).toBe(asked);
    // IGDB has none for Okami HD: kept as none, not asked again.
    expect(await summary('Okami HD')).toEqual({ summary: null });
    expect(await summary('Okami HD')).toEqual({ summary: null });
    expect(fake.calls.filter((c) => /fields summary;/.test(c.body)).length).toBe(asked + 1);
    expect((await g.app.inject({ url: '/api/v1/game/summary?platform=nope&title=x', cookies })).statusCode).toBe(404);
  });

  it('downloads platform lists page by page and uses them for covers, details and Store Mode', async () => {
    const fake = fakeIgdb();
    await start(fake);
    expect((await g.tasks.runNow('igdb-sync'))?.message).toBe('IGDB keys are not set (Settings > Sources).');
    keys();
    const run = await g.tasks.runNow('igdb-sync');
    expect(run).toMatchObject({ status: 'success', message: 'Games per platform: PlayStation 3 501' });
    // Two pages of games with one token.
    const gameCalls = fake.calls.filter((c) => c.url.endsWith('/v4/games'));
    expect(gameCalls).toHaveLength(2);
    expect(gameCalls[0]!.body).toContain('where platforms = (9) & id > 0; sort id asc; limit 500;');
    expect(gameCalls[1]!.body).toContain('id > 1496');
    expect(fake.tokens()).toBe(1);

    const status = (await g.app.inject({ url: '/api/v1/sources/igdb', cookies })).json();
    expect(status).toMatchObject({ configured: true, platforms: [{ key: 'playstation-3', igdbId: 9, games: 501, error: null }] });

    const catalog = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3', cookies })).json();
    const cover = (title: string) => catalog.entries.find((e: { title: string }) => e.title === title)?.coverId;
    expect(cover("Uncharted: Drake's Fortune")).toBe('co_uncharted');
    expect(cover('Tales of Graces f')).toBe('co_tales');
    expect(cover('Not On IGDB')).toBeNull();

    const wishlist = (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json();
    const tales = wishlist.master.find((m: { title: string }) => m.title === 'Tales of Graces f');
    expect(tales.coverId).toBe('co_tales');
    expect(tales.components).toContainEqual({ label: 'RPG (IGDB)', points: 0 });
    expect(tales.franchise).toBe('Tales');

    const owned = (await g.app.inject({ url: '/api/v1/collection/items', cookies })).json();
    expect(owned.items[0]).toMatchObject({ title: "Uncharted: Drake's Fortune [Greatest Hits]", coverId: 'co_uncharted' });

    const store = (await g.app.inject({ url: '/api/v1/lookup?q=okami', cookies })).json();
    expect(store[0]).toMatchObject({ title: 'Okami HD', coverId: 'co_okami' });

    // Turning the details off leaves the covers.
    g.settings.update({ 'sources.igdbDetails': false });
    const plain = (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json().master.find((m: { title: string }) => m.title === 'Tales of Graces f');
    expect(plain.components.map((c: { label: string }) => c.label)).not.toContain('RPG (IGDB)');
    expect(plain.coverId).toBe('co_tales');
  });

  it("adds the games of the platform's second IGDB platform to its list", async () => {
    const fake = fakeIgdb();
    await start(fake, ['Japan Only Game']);
    keys();
    g.settings.update({ 'sources.igdbExtraPlatformIds': { 'playstation-3': 77 } });
    const run = await g.tasks.runNow('igdb-sync');
    // 501 games on the first platform; of the second's two, only the one not already there joins.
    expect(run).toMatchObject({ status: 'success', message: 'Games per platform: PlayStation 3 502' });
    expect(fake.calls.filter((c) => c.url.endsWith('/v4/games')).map((c) => /platforms = \((\d+)\)/.exec(c.body)?.[1])).toEqual(['9', '9', '77']);
    const status = (await g.app.inject({ url: '/api/v1/sources/igdb', cookies })).json();
    expect(status.platforms[0]).toMatchObject({ key: 'playstation-3', igdbId: 9, extraIgdbId: 77, games: 502 });
    const catalog = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3', cookies })).json();
    expect(catalog.entries.find((e: { title: string }) => e.title === 'Japan Only Game')?.coverId).toBe('co_japan');
    // The second platform's physical listings count too.
    expect(g.igdb.findByKey('playstation-3', 'Japan Only Game')?.physical).toEqual([392]);
    expect(g.igdb.findByKey('playstation-3', 'Tales of Graces f')?.physical).toEqual([840, 124, 392]);
  });

  it('counts physical listings as evidence of a physical release', async () => {
    const fake = fakeIgdb();
    await start(fake);
    keys();
    await g.tasks.runNow('igdb-sync');
    // PlayStation 3 treated like a console whose lists include download-only games.
    g.settings.update({ 'catalogs.mixedListPlatforms': ['playstation-3'] });
    const status = async () =>
      Object.fromEntries(((await g.app.inject({ url: '/api/v1/catalogs/playstation-3?all=1', cookies })).json().entries as { title: string; status: string; evidence: string | null }[]).map((e) => [e.title, `${e.status} ${e.evidence}`]));
    expect(await status()).toEqual({
      'Not On IGDB': 'unconfirmed null',
      'Okami HD': 'missing igdb',
      'Tales of Graces f': 'missing igdb',
      "Uncharted: Drake's Fortune": 'owned null',
    });
    // Only listings from the home region (North America here) when the setting says so.
    g.settings.update({ 'catalogs.physicalRegion': 'home' });
    expect((await status())['Okami HD']).toBe('unconfirmed null');
    expect((await status())['Tales of Graces f']).toBe('missing igdb');
  });

  it('counts a download title once IGDB lists a physical release', async () => {
    g = await testApp({ igdbFetch: fakeIgdb().fetch });
    cookies = await setUp(g);
    // PlayStation 3's list covers retail games, but its source marks three of these as download titles.
    seedCatalogs(g, {
      owned: [['1', "Uncharted: Drake's Fortune [Greatest Hits]", 'Playstation 3']],
      catalogs: {
        'playstation-3': [
          "Uncharted: Drake's Fortune",
          { title: 'Tales of Graces f', targetStatus: 'unconfirmed' },
          { title: 'Okami HD', targetStatus: 'unconfirmed' },
          { title: 'Filler Game 7', targetStatus: 'unconfirmed' },
        ],
      },
    });
    const status = async () =>
      Object.fromEntries(((await g.app.inject({ url: '/api/v1/catalogs/playstation-3?all=1', cookies })).json().entries as { title: string; status: string; evidence: string | null }[]).map((e) => [e.title, `${e.status} ${e.evidence}`]));
    expect(await status()).toEqual({ 'Filler Game 7': 'unconfirmed null', 'Okami HD': 'unconfirmed null', 'Tales of Graces f': 'unconfirmed null', "Uncharted: Drake's Fortune": 'owned null' });
    keys();
    await g.tasks.runNow('igdb-sync');
    // IGDB's physical listings (Tales of Graces f in the US, Okami HD in Japan) make them count; the one without stays.
    expect(await status()).toEqual({ 'Filler Game 7': 'unconfirmed null', 'Okami HD': 'missing igdb', 'Tales of Graces f': 'missing igdb', "Uncharted: Drake's Fortune": 'owned null' });
    g.settings.update({ 'catalogs.physicalRegion': 'home' });
    expect((await status())['Okami HD']).toBe('unconfirmed null');
  });

  it('gets a new token when IGDB rejects the old one', async () => {
    const fake = fakeIgdb({ expireFirstToken: true });
    await start(fake);
    keys();
    const res = (await g.app.inject({ method: 'POST', url: '/api/v1/sources/igdb/test', cookies })).json();
    expect(res.ok).toBe(true);
    expect(fake.tokens()).toBe(2);
  });

  it('waits and asks again while IGDB is busy', async () => {
    const fake = fakeIgdb();
    await start(fake);
    keys();
    // Other apps using the same keys can use up the rate limit: the next requests are turned away.
    let busy = 3;
    Object.assign(g.igdb.client, { fetchImpl: async (url: string, init: RequestInit) => (url.includes('api.igdb.com') && busy-- > 0 ? new Response('{"message":"Too Many Requests"}', { status: 429 }) : fake.fetch(url, init)) });
    const run = await g.tasks.runNow('igdb-sync');
    expect(run).toMatchObject({ status: 'success', message: expect.stringContaining('PlayStation 3 501') });
    expect(busy).toBeLessThan(0);
  });

  it('keeps the last good list when a download fails', async () => {
    const fake = fakeIgdb();
    await start(fake);
    keys();
    await g.tasks.runNow('igdb-sync');
    const failing: FetchLike = async (url, init) => (url.endsWith('/v4/games') ? new Response('server error', { status: 500 }) : fake.fetch(url, init));
    Object.assign(g.igdb.client, { fetchImpl: failing });
    const run = await g.tasks.runNow('igdb-sync');
    expect(run).toMatchObject({ status: 'failed' });
    const status = (await g.app.inject({ url: '/api/v1/sources/igdb', cookies })).json();
    expect(status.platforms[0].error).toContain('IGDB answered 500');
    const catalog = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=tales', cookies })).json();
    expect(catalog.entries[0].coverId).toBe('co_tales');
  });
});
