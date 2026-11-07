import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { appState } from './db/schema.js';
import type { FetchLike } from './igdb.js';
import { exportCsv, multipartFile, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

/** A game as IGDB's API gives it, on PC, with a Steam id when given. */
const igdbGame = (id: number, name: string, genre: string, rating: number, count: number, steam?: number, franchise?: string) => ({
  id,
  name,
  genres: [{ name: genre }],
  total_rating: rating,
  total_rating_count: count,
  release_dates: [{ platform: 6, date: 1_500_000_000 }],
  ...(franchise ? { franchises: [{ name: franchise }] } : {}),
  ...(steam ? { external_games: [{ uid: String(steam), external_game_source: 1 }] } : {}),
});

/** A fake IGDB: genres and themes, one series, genre searches and title searches on PC. */
function fakeIgdb(): { fetch: FetchLike; bodies: string[] } {
  const bodies: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = typeof init.body === 'string' ? init.body : '';
    if (url.startsWith('https://id.twitch.tv/oauth2/token')) return Response.json({ access_token: 'token', expires_in: 5_000_000, token_type: 'bearer' });
    bodies.push(`${url.split('/').pop()}: ${body}`);
    if (url.endsWith('/genres')) return Response.json([{ id: 12, name: 'Role-playing (RPG)' }, { id: 8, name: 'Platform' }]);
    if (url.endsWith('/themes')) return Response.json([{ id: 19, name: 'Horror' }]);
    if (url.endsWith('/franchises') || url.endsWith('/collections')) return Response.json([]);
    if (url.endsWith('/games')) {
      if (/search "Hollow Knight"/.test(body)) return Response.json([igdbGame(300, 'Hollow Knight', 'Platform', 90, 500, 367520), igdbGame(301, 'Hollow Knight: Silksong', 'Platform', 88, 100)]);
      if (/id = \(300\)/.test(body)) return Response.json([igdbGame(300, 'Hollow Knight', 'Platform', 90, 500, 367520)]);
      if (/genres = \(12\)/.test(body)) return Response.json([igdbGame(100, 'Hades', 'Role-playing (RPG)', 93, 900, 1145360), igdbGame(101, 'Disco Elysium', 'Role-playing (RPG)', 92, 800, 632470), igdbGame(102, 'Halo Infinite', 'Role-playing (RPG)', 80, 300)]);
      if (/genres = \(8\)/.test(body)) return Response.json([igdbGame(200, 'Celeste', 'Platform', 94, 700, 504230)]);
      return Response.json([]);
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, bodies };
}

/** A Playnite reader snapshot: Hades owned on Steam, Halo Infinite on Xbox (a subscription, by the audit below). */
const SNAPSHOT = JSON.stringify({
  schemaVersion: 'vgcm-playnite-library-v1',
  generatedAtUtc: '2026-09-27T12:00:00Z',
  source: { fileName: 'PlayniteBackup.zip', fingerprint: 'f' },
  statistics: { gameRecords: 2 },
  records: [
    { recordKey: 'steam|1145360', playniteId: 'a', storefrontGameId: '1145360', sourceName: 'Steam', name: 'Hades', platforms: [], genres: [], series: [], favorite: false, hidden: false, installed: false, playtimeSeconds: 0, playCount: 0, links: [] },
    { recordKey: 'xbox|9', playniteId: 'b', storefrontGameId: '9', sourceName: 'Xbox', name: 'Halo Infinite', platforms: [], genres: [], series: [], favorite: false, hidden: false, installed: false, playtimeSeconds: 0, playCount: 0, links: [] },
  ],
});

describe('PC wishlist', () => {
  it('finds PC games on IGDB, leaves out what you own on PC, and ranks the rest with every point explained', async () => {
    const igdb = fakeIgdb();
    const steamCalls: string[] = [];
    g = await testApp({
      features: ['pc'],
      igdbFetch: igdb.fetch,
      steamFetch: async (url) => {
        steamCalls.push(url);
        return Response.json({ success: 1, query_summary: { total_positive: 970, total_reviews: 1000, review_score_desc: 'Overwhelmingly Positive' } });
      },
    });
    cookies = await setUp(g);
    g.settings.update({ 'sources.igdbClientId': 'id', 'sources.igdbClientSecret': 'secret', 'wishlist.genrePoints': { RPG: 22, Platformer: 18 }, 'pc.discoverGenres': 2, 'pc.subscriptionPoints': -30 });
    // A sealed console copy of Hollow Knight, and the PC library (Hades owned, Halo Infinite on a subscription).
    g.collection.importText(exportCsv([['1', 'Hollow Knight', 'Nintendo Switch', 1500, 'New Item, Box, and Manual']]), { source: 'upload', fileName: 'collection_20260927.csv' });
    await g.app.inject({ method: 'POST', url: '/api/v1/pc/snapshot', cookies, ...multipartFile('s.json', Buffer.from(SNAPSHOT), 'application/json') });
    await g.app.inject({ method: 'PUT', url: '/api/v1/pc/audit', cookies, ...multipartFile('a.csv', Buffer.from('Source,Storefront Game ID,Title,Ownership Status\nXbox,9,Halo Infinite,Subscription Access')) });

    expect(await g.pcWishlist.discover()).toMatch(/^5 PC games found \(2 genres, 0 series, 1 sealed console games, 1 of them looked up\); 4 Steam review summaries read$/);
    // Only games on PC, of the kinds a wishlist wants, released already.
    expect(igdb.bodies.find((b) => b.startsWith('games:') && /genres = \(12\)/.test(b))).toMatch(/platforms = \(6\) & game_type = \(0,4,8,9,10,11\).*total_rating_count >= 50/);
    expect(steamCalls[0]).toMatch(/^https:\/\/store\.steampowered\.com\/appreviews\/\d+\?json=1/);

    const list = (await g.app.inject({ url: '/api/v1/pc/wishlist', cookies })).json();
    expect(list).toMatchObject({ found: 5, owned: 1, hidden: 0 });
    // Hades is owned on Steam: never a candidate. Silksong isn't the sealed game, so the title search keeps only Hollow Knight.
    expect(list.items.map((c: { title: string }) => c.title)).toEqual(['Hollow Knight', 'Disco Elysium', 'Celeste', 'Halo Infinite']);
    const hk = list.items[0];
    expect(hk.sources).toEqual(['Sealed on Nintendo Switch']);
    expect(hk.components).toContainEqual({ label: 'Sealed on Nintendo Switch: play it on PC', points: 15 });
    expect(hk.components).toContainEqual({ label: 'Reviews: 97% positive on Steam (1,000)', points: 31 });
    expect(list.items.find((c: { title: string }) => c.title === 'Halo Infinite').components).toContainEqual({ label: 'On your subscription (Xbox)', points: -30 });

    // Hiding a game takes it off; a CSV has the list.
    const key = list.items.find((c: { title: string }) => c.title === 'Celeste').key;
    expect((await g.app.inject({ method: 'PUT', url: `/api/v1/pc/wishlist/${key}`, cookies, payload: { action: 'hide' } })).statusCode).toBe(200);
    const after = (await g.app.inject({ url: '/api/v1/pc/wishlist', cookies })).json();
    expect(after.hidden).toBe(1);
    expect(after.items.map((c: { title: string }) => c.title)).not.toContain('Celeste');
    // The hidden games have a list of their own (to bring one back).
    expect((await g.app.inject({ url: '/api/v1/pc/wishlist/hidden', cookies })).json()).toMatchObject([{ familyKey: key, title: 'Celeste', action: 'hide' }]);
    // Searching again now is a task in the background.
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/pc/wishlist/discover', cookies })).statusCode).toBe(202);
    const csv = await g.app.inject({ url: '/api/v1/pc/wishlist/export', cookies });
    expect(csv.body.split('\n')[1]).toMatch(/^1,Hollow Knight,/);

    // The next search remembers what the sealed games are on PC: nothing to look up again, the game still found.
    const searches = igdb.bodies.filter((b) => /search "Hollow Knight"/.test(b)).length;
    expect(await g.pcWishlist.discover()).toMatch(/1 sealed console games, 0 of them looked up/);
    expect(igdb.bodies.filter((b) => /search "Hollow Knight"/.test(b))).toHaveLength(searches);
    expect((await g.app.inject({ url: '/api/v1/pc/wishlist', cookies })).json().items[0].title).toBe('Hollow Knight');
  });

  it('asks for IGDB keys before searching', async () => {
    g = await testApp({ features: ['pc'] });
    cookies = await setUp(g);
    expect(await g.pcWishlist.discover()).toBe("IGDB's keys are needed to look for PC games (Settings > Sources).");
  });
});

describe("Steam's reviews when Steam won't give them (2026-11-07: 229 'Unexpected token <' warnings in a week)", () => {
  const pauseValue = () => g.db.select().from(appState).where(eq(appState.key, 'pc.steamReviews.pause')).get()?.value ?? null;
  async function searchWith(answer: () => Response) {
    const calls: string[] = [];
    g = await testApp({
      features: ['pc'],
      igdbFetch: fakeIgdb().fetch,
      steamFetch: async (url, init) => {
        calls.push(url);
        expect(init.redirect).toBe('manual');
        return answer();
      },
    });
    cookies = await setUp(g);
    g.settings.update({ 'sources.igdbClientId': 'id', 'sources.igdbClientSecret': 'secret', 'wishlist.genrePoints': { RPG: 22, Platformer: 18 }, 'pc.discoverGenres': 2 });
    return calls;
  }

  it('a redirect to the store page pauses the reading after one request, and the search still finishes', async () => {
    const calls = await searchWith(() => new Response('<!DOCTYPE html><html>store front</html>', { status: 302, headers: { location: 'https://store.steampowered.com/', 'content-type': 'text/html; charset=UTF-8' } }));
    const message = await g.pcWishlist.discover();
    expect(message).toMatch(/^\d+ PC games found .*; Steam's reviews paused until \d{4}-\d\d-\d\d \d\d:\d\d UTC \(Steam answered with a web page instead of the review data\)$/);
    expect(calls).toHaveLength(1);
    // The next search doesn't ask Steam at all while the pause lasts.
    expect(await g.pcWishlist.discover()).toMatch(/Steam's reviews paused until/);
    expect(calls).toHaveLength(1);
    expect((await g.app.inject({ url: '/api/v1/pc/wishlist', cookies })).json().found).toBeGreaterThan(0);
  });

  it('a web page with status 200 (a followed redirect) is a web page too, never parsed as data', async () => {
    const calls = await searchWith(() => new Response('<!DOCTYPE html><html></html>', { status: 200, headers: { 'content-type': 'text/html; charset=UTF-8' } }));
    expect(await g.pcWishlist.discover()).toMatch(/Steam answered with a web page/);
    expect(calls).toHaveLength(1);
  });

  it('"too many requests" pauses for 6 hours, doubling with each failed try', async () => {
    const calls = await searchWith(() => new Response('slow down', { status: 429 }));
    const before = Date.now();
    await g.pcWishlist.discover();
    const pause = JSON.parse(pauseValue() ?? '{}');
    expect(pause.failures).toBe(1);
    expect(Date.parse(pause.until) - before).toBeGreaterThanOrEqual(6 * 3_600_000 - 5_000);
    expect(Date.parse(pause.until) - before).toBeLessThan(6 * 3_600_000 + 60_000);
    expect(calls).toHaveLength(1);
  });

  it('good answers clear the pause', async () => {
    const calls = await searchWith(() => Response.json({ success: 1, query_summary: { total_positive: 90, total_reviews: 100, review_score_desc: 'Very Positive' } }));
    g.db.insert(appState).values({ key: 'pc.steamReviews.pause', value: JSON.stringify({ until: new Date(Date.now() - 1000).toISOString(), failures: 3, reason: 'old' }) }).run();
    expect(await g.pcWishlist.discover()).toMatch(/; \d+ Steam review summaries read$/);
    expect(calls.length).toBeGreaterThan(0);
    expect(pauseValue()).toBe('');
  });
});
