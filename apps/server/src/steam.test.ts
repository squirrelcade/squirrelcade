import { parsePlayniteSnapshot } from '@squirrelcade/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike } from './igdb.js';
import { setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
/** A signed-in viewer's session cookie. */
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ squirrelcade_session: res.cookies.find((c) => c.name === 'squirrelcade_session')!.value });
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

interface Owned {
  appid: number;
  name: string;
  playtime_forever: number;
  rtime_last_played: number;
  has_community_visible_stats?: boolean;
}

/** A fake Steam Web API: the key "steam-key" is taken, the custom name "player" is the profile, games as given. */
function fakeSteam(games: Owned[], achievements: Record<number, number[]>, opts: { private?: boolean; down?: Set<number> } = {}) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    const u = new URL(String(url));
    calls.push(`${u.pathname}${u.searchParams.get('appid') ? ` ${u.searchParams.get('appid')}` : ''}`);
    if (u.searchParams.get('key') !== 'steam-key') return new Response('<html><body>Forbidden</body></html>', { status: 403 });
    if (u.pathname === '/ISteamUser/ResolveVanityURL/v1/') {
      return Response.json({ response: u.searchParams.get('vanityurl') === 'player' ? { steamid: '76561198000000001', success: 1 } : { success: 42, message: 'No match' } });
    }
    if (u.pathname === '/ISteamUser/GetPlayerSummaries/v2/') {
      return Response.json({ response: { players: [{ steamid: '76561198000000001', personaname: 'Player One', communityvisibilitystate: opts.private ? 1 : 3 }] } });
    }
    if (u.pathname === '/IPlayerService/GetOwnedGames/v1/') return Response.json({ response: opts.private ? {} : { game_count: games.length, games } });
    if (u.pathname === '/ISteamUserStats/GetPlayerAchievements/v1/') {
      // A game Steam doesn't answer about: 500 for the first, no answer at all for the others.
      const appid = Number(u.searchParams.get('appid'));
      if (opts.down?.has(appid)) {
        if (appid === [...opts.down][0]) return new Response('Internal Server Error', { status: 500 });
        throw new TypeError('fetch failed');
      }
      const earned = achievements[Number(u.searchParams.get('appid'))];
      if (!earned) return Response.json({ playerstats: { error: 'Requested app has no stats', success: false } }, { status: 400 });
      return Response.json({ playerstats: { steamID: '76561198000000001', gameName: 'x', achievements: earned.map((a, i) => ({ apiname: `A${i}`, achieved: a, unlocktime: 0 })), success: true } });
    }
    return new Response('Not Found', { status: 404 });
  };
  return { fetch, calls };
}

/** The PC library's reading: [storefront, game id, name, hours]. */
function library(records: [string, string, string, number][]) {
  return parsePlayniteSnapshot(
    JSON.stringify({
      schemaVersion: 'vgcm-playnite-library-v1',
      generatedAtUtc: '2026-09-29T12:00:00Z',
      source: { fileName: 'PlayniteBackup-2026-09-29.zip', lastWriteUtc: '2026-09-29T12:00:00Z', fingerprint: 'f' },
      statistics: { gameRecords: records.length },
      records: records.map(([store, id, name, hours]) => ({
        recordKey: `${store}|${id}`,
        playniteId: `p-${store}-${id}`,
        storefrontGameId: id,
        sourceName: store,
        name,
        platforms: ['PC (Windows)'],
        genres: [],
        series: [],
        favorite: false,
        hidden: false,
        installed: false,
        playtimeSeconds: hours * 3600,
        playCount: 0,
        links: [],
      })),
    }),
  );
}

const done = (n: number) => Array.from({ length: n }, () => 1);
const GAMES: Owned[] = [
  { appid: 1145360, name: 'Hades', playtime_forever: 2400, rtime_last_played: 1790000000, has_community_visible_stats: true },
  { appid: 504230, name: 'Celeste', playtime_forever: 720, rtime_last_played: 1780000000, has_community_visible_stats: true },
  { appid: 400, name: 'Portal', playtime_forever: 300, rtime_last_played: 1700000000, has_community_visible_stats: true },
  { appid: 620, name: 'Portal 2', playtime_forever: 0, rtime_last_played: 0, has_community_visible_stats: true },
];

describe('Steam achievements', () => {
  it("reads the played games' achievements, shows them in the PC library, and asks again only for games played since", async () => {
    const games = GAMES.map((x) => ({ ...x }));
    // Hades completed (49 of 49); Celeste 10 of 32; Portal has no achievements; Portal 2 never played.
    const steam = fakeSteam(games, { 1145360: done(49), 504230: [...done(10), ...Array.from({ length: 22 }, () => 0)], 620: done(5) });
    g = await testApp({ features: ['pc', 'steam'], steamApiFetch: steam.fetch });
    cookies = await setUp(g);
    g.pc.applySnapshot(library([['Steam', '1145360', 'Hades', 40], ['Epic', 'a', 'Hades', 0], ['Steam', '504230', 'Celeste', 12], ['Steam', '620', 'Portal 2', 0]]), 'upload');

    // The Test button: a key Steam doesn't take, then the right one and the profile by its custom name.
    g.settings.update({ 'sources.steamApiKey': 'wrong-key', 'sources.steamId': 'https://steamcommunity.com/id/player/' });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/steam/test', cookies })).json()).toMatchObject({ ok: false, message: expect.stringMatching(/didn't take the Web API key/) });
    g.settings.update({ 'sources.steamApiKey': 'steam-key' });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/steam/test', cookies })).json()).toEqual({ ok: true, message: 'Steam took the key: Player One, 4 games.' });

    expect(await g.achievements.sync('steam')).toBe('2 games with achievements (1 completed); 3 asked of Steam, the rest not played since the last read');
    const pcGames = async (query = '') => (await g.app.inject({ url: `/api/v1/pc/games?pageSize=500${query}`, cookies })).json();
    const hades = (await pcGames()).items.find((f: { title: string }) => f.title === 'Hades');
    expect(hades.records.find((r: { storefront: string }) => r.storefront === 'Steam').achievements).toEqual({ earned: 49, total: 49, progress: 100, completed: true, lastPlayedAt: new Date(1790000000 * 1000).toISOString() });
    expect(hades.records.find((r: { storefront: string }) => r.storefront === 'Epic').achievements).toBeNull();
    expect((await pcGames('&achievements=completed')).items.map((f: { title: string }) => f.title)).toEqual(['Hades']);
    expect((await pcGames('&achievements=started')).items.map((f: { title: string }) => f.title)).toEqual(['Celeste', 'Hades']);
    expect((await g.app.inject({ url: '/api/v1/sources/steam', cookies })).json()).toMatchObject({ on: true, configured: true, games: 2, completed: 1 });

    // Nothing played since: nothing asked. Celeste played again: only Celeste.
    const before = steam.calls.length;
    expect(await g.achievements.sync('steam')).toMatch(/; 0 asked of Steam/);
    expect(steam.calls.slice(before).filter((c) => c.startsWith('/ISteamUserStats'))).toEqual([]);
    games[1]!.rtime_last_played = 1790500000;
    expect(await g.achievements.sync('steam')).toMatch(/; 1 asked of Steam/);
    expect(steam.calls.at(-1)).toBe('/ISteamUserStats/GetPlayerAchievements/v1/ 504230');
    // The profile's custom name was looked up once with the right key (after the wrong key's refusal), and kept.
    expect(steam.calls.filter((c) => c.startsWith('/ISteamUser/ResolveVanityURL')).length).toBe(2);

    // A viewer sees them with what the owner played; without it, none, and the filter is ignored.
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Sam' }, cookies });
    const viewer = cookieOf(await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } }));
    const viewerGames = async (query = '') => (await g.app.inject({ url: `/api/v1/pc/games?pageSize=500${query}`, cookies: viewer })).json();
    expect((await viewerGames('&achievements=completed')).items.map((f: { title: string }) => f.title)).toEqual(['Hades']);
    g.settings.update({ 'security.viewersSeePlay': false });
    expect((await viewerGames('&achievements=completed')).total).toBe(3);
    expect((await viewerGames()).items.flatMap((f: { records: { achievements: unknown }[] }) => f.records.map((r) => r.achievements))).toEqual([null, null, null, null]);
    expect((await pcGames('&achievements=completed')).items.map((f: { title: string }) => f.title)).toEqual(['Hades']);

    // Off: no achievements in the PC library, and Steam's routes answer as off.
    g.settings.update({ 'features.steam': false });
    expect((await pcGames()).items.find((f: { title: string }) => f.title === 'Hades').records[0].achievements).toBeNull();
    expect((await g.app.inject({ url: '/api/v1/sources/steam', cookies })).statusCode).toBe(404);
  });

  it("keeps a game Steam doesn't answer about as it was, asks it again at the next read, and stops after five in a row", async () => {
    // Twelve played games with 3 achievements each; Steam answers about the first, then not about the next six.
    const many: Owned[] = Array.from({ length: 12 }, (_, i) => ({ appid: 1000 + i, name: `Game ${i}`, playtime_forever: 60, rtime_last_played: 1790000000 + i }));
    const earned = Object.fromEntries(many.map((x) => [x.appid, [1, 1, 0]]));
    const down = new Set([1001, 1002, 1003, 1004, 1005, 1006]);
    const steam = fakeSteam(many, earned, { down });
    g = await testApp({ features: ['pc', 'steam'], steamApiFetch: steam.fetch });
    cookies = await setUp(g);
    g.settings.update({ 'sources.steamApiKey': 'steam-key', 'sources.steamId': '76561198000000001' });

    // Game 0 read; games 1 to 5 not answered (five in a row), so the other six wait for the next read.
    expect(await g.achievements.sync('steam')).toBe('1 game with achievements (0 completed); 6 asked of Steam (5 not answered, 6 left: asked at the next read), the rest not played since the last read');
    // Steam answers again: the eleven not read are asked (game 6 still isn't answered), game 0 isn't.
    down.clear();
    down.add(1006);
    expect(await g.achievements.sync('steam')).toBe('11 games with achievements (0 completed); 11 asked of Steam (1 not answered: asked at the next read), the rest not played since the last read');
    down.clear();
    expect(await g.achievements.sync('steam')).toBe('12 games with achievements (0 completed); 1 asked of Steam, the rest not played since the last read');
    // Steam answering about none of the games asked is a failed read, and what was read is kept.
    many[0]!.rtime_last_played = 1795000000;
    down.add(1000);
    await expect(g.achievements.sync('steam')).rejects.toThrow("Steam didn't answer about the one game asked");
    expect((await g.app.inject({ url: '/api/v1/sources/steam', cookies })).json()).toMatchObject({ games: 12 });
  });

  it("says when the profile's game details aren't public, or the profile isn't found", async () => {
    g = await testApp({ features: ['pc', 'steam'], steamApiFetch: fakeSteam(GAMES, {}, { private: true }).fetch });
    cookies = await setUp(g);
    g.settings.update({ 'sources.steamApiKey': 'steam-key', 'sources.steamId': '76561198000000001' });
    await expect(g.achievements.sync('steam')).rejects.toThrow(/game details aren't public/);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/steam/test', cookies })).json()).toMatchObject({ ok: false, message: expect.stringMatching(/^Steam took the key \(Player One\), but steam shows no games/) });
    g.settings.update({ 'sources.steamId': 'nobody-here' });
    await expect(g.achievements.sync('steam')).rejects.toThrow(/Steam knows no profile called "nobody-here"/);
    g.settings.update({ 'sources.steamId': 'https://example.com/a/b' });
    await expect(g.achievements.sync('steam')).rejects.toThrow(/isn't a Steam profile/);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/steam/sync', cookies })).statusCode).toBe(202);
  });
});
