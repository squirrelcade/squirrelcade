import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

/** IGDB's data for games on a console: title, series and first release there. */
function igdb(platformKey: string, games: [string, string | null, string | null][]) {
  const platformId = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, platformKey)).get()!.id;
  g.db
    .insert(igdbGames)
    .values(
      games.map(([name, franchise, released], i) => ({
        platformId,
        igdbId: platformId * 1000 + i,
        data: JSON.stringify({ id: platformId * 1000 + i, name, altNames: [], coverId: null, genres: [], themes: [], perspectives: [], franchise, japanese: null, released, gameType: null }),
      })),
    )
    .run();
}

describe('series', () => {
  it("lists each series you own a game of, across consoles, with what's missing first", async () => {
    seedCatalogs(g, {
      owned: [
        ['1', 'Mega Man 2', 'NES'],
        ['2', 'Mega Man X', 'Super Nintendo'],
        ['3', 'Contra', 'NES'],
        ...['A', 'B', 'C', 'D', 'E'].map((x, i): [string, string, string] => [String(10 + i), `Filler ${x}`, 'NES']),
        ...['F', 'G', 'H', 'I', 'J', 'K'].map((x, i): [string, string, string] => [String(20 + i), `Filler ${x}`, 'Super Nintendo']),
      ],
      catalogs: {
        'nintendo-entertainment-system': ['Mega Man 2', 'Mega Man 3', 'Contra', 'Zelda II The Adventure of Link'],
        // Mega Man 2 on the Super Nintendo too, as a game owned on another console (made up for the test).
        'super-nintendo': ['Mega Man X', 'Mega Man X2', 'Super Metroid', 'Mega Man 2'],
      },
    });
    igdb('nintendo-entertainment-system', [
      ['Mega Man 2', 'Mega Man', '1989-06-01'],
      ['Mega Man 3', 'Mega Man', '1990-11-01'],
      ['Contra', 'Contra', '1988-02-01'],
      ['Zelda II: The Adventure of Link', 'The Legend of Zelda', '1988-12-01'],
    ]);
    igdb('super-nintendo', [
      ['Mega Man X', 'Mega Man', '1994-01-01'],
      ['Mega Man X2', 'Mega Man', '1995-01-01'],
      ['Super Metroid', 'Metroid', '1994-04-18'],
      ['Mega Man 2', 'Mega Man', '1996-01-01'],
    ]);

    const list = (await g.app.inject({ url: '/api/v1/series', cookies })).json();
    // Contra (one game) and series with nothing owned (Zelda, Metroid) aren't listed.
    expect(list).toEqual([{ name: 'Mega Man', owned: 2, missing: 3, ownedElsewhere: 1, onPc: 0, total: 5, percent: 40, platforms: ['Nintendo Entertainment System', 'Super Nintendo'] }]);

    const games = (await g.app.inject({ url: '/api/v1/series/games?name=Mega%20Man', cookies })).json();
    expect(games.map((x: { title: string; status: string }) => [x.title, x.status])).toEqual([
      ['Mega Man 3', 'missing'],
      ['Mega Man X2', 'missing'],
      ['Mega Man 2', 'missing'],
      ['Mega Man 2', 'owned'],
      ['Mega Man X', 'owned'],
    ]);
    expect(games[0].ownedOn).toEqual([]);
    // Each game comes with your preference for it, to change it right there.
    expect(games[0].preference).toBeNull();
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', cookies, payload: { platformKey: 'nintendo-entertainment-system', title: 'Mega Man 3', preference: 'Strong Interest', note: null } });
    expect((await g.app.inject({ url: '/api/v1/series/games?name=Mega%20Man', cookies })).json()[0]).toMatchObject({ title: 'Mega Man 3', preference: 'Strong Interest' });
    // Missing on the Super Nintendo, owned on the NES: it says so.
    expect(games.find((x: { title: string; platformKey: string }) => x.title === 'Mega Man 2' && x.platformKey === 'super-nintendo').ownedOn).toEqual(['Nintendo Entertainment System']);
    expect((await g.app.inject({ url: '/api/v1/series/games?name=Nope', cookies })).statusCode).toBe(404);
    // Settings > Collection: a series needs this many catalog games to be listed.
    g.settings.update({ 'collection.seriesMinGames': 6 });
    expect((await g.app.inject({ url: '/api/v1/series', cookies })).json()).toEqual([]);
  });

  it("lists your own series: the catalogs' games whose titles have its words, whatever you own of them", async () => {
    seedCatalogs(g, {
      owned: [['1', 'Mega Man X', 'Super Nintendo']],
      catalogs: {
        'nintendo-entertainment-system': ['Mega Man 2', 'Mega Man 3', 'Contra'],
        'super-nintendo': ['Mega Man X', 'Mega Man X2', 'Super Metroid'],
      },
    });
    g.settings.update({ 'collection.customSeries': ['Blue Bomber | Mega Man X', 'Run and Gun | Contra, Gunstar', 'No Bar Here'] });
    const list = (await g.app.inject({ url: '/api/v1/series', cookies })).json() as { name: string; owned: number; total: number; custom?: boolean }[];
    // A series of your own shows even with nothing owned (Run and Gun) or a single game; a line without a bar is left out.
    expect(list.map((x) => [x.name, x.owned, x.total, x.custom ?? false])).toEqual([
      ['Blue Bomber', 1, 2, true],
      ['Run and Gun', 0, 1, true],
    ]);
    const games = (await g.app.inject({ url: '/api/v1/series/games?name=Blue%20Bomber', cookies })).json() as { title: string }[];
    expect(games.map((x) => x.title).sort()).toEqual(['Mega Man X', 'Mega Man X2']);
  });
});

describe("a series' remakes", () => {
  it('know the game they remake (IGDB links), followed back to the first version the series has', async () => {
    seedCatalogs(g, {
      owned: [
        ['1', 'Resident Evil 2', 'PlayStation'],
        ['2', 'Resident Evil', 'PlayStation'],
        ...['A', 'B', 'C', 'D', 'E'].map((x, i): [string, string, string] => [String(10 + i), `Filler ${x}`, 'PlayStation']),
      ],
      catalogs: { playstation: ['Resident Evil', 'Resident Evil 2'], 'nintendo-gamecube': ['Resident Evil (2002)'], 'playstation-4': ['Resident Evil 2 (2019)', 'Resident Evil HD Remaster'] },
    });
    // IGDB's ids are a game's on every console: the 1996 game (1) has a remake (3) with a remaster (5); the 1998 one (2) a remake (4).
    const put = (platformKey: string, games: [number, string, string, number[], number[]][]) => {
      const platformId = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, platformKey)).get()!.id;
      g.db
        .insert(igdbGames)
        .values(
          games.map(([id, name, released, remakes, remasters]) => ({
            platformId,
            igdbId: id,
            data: JSON.stringify({ id, name, altNames: [], coverId: null, genres: [], themes: [], perspectives: [], franchise: 'Resident Evil', japanese: null, released, gameType: null, remakes, remasters }),
          })),
        )
        .run();
    };
    put('playstation', [
      [1, 'Resident Evil', '1996-03-30', [3], []],
      [2, 'Resident Evil 2', '1998-01-21', [4], []],
    ]);
    put('nintendo-gamecube', [[3, 'Resident Evil (2002)', '2002-04-30', [], [5]]]);
    put('playstation-4', [
      [4, 'Resident Evil 2 (2019)', '2019-01-25', [], []],
      [5, 'Resident Evil HD Remaster', '2015-01-20', [], []],
    ]);
    const games = (await g.app.inject({ url: `/api/v1/series/games?name=${encodeURIComponent('Resident Evil')}`, cookies })).json() as { title: string; original?: { title: string; released: string | null; kind: string } }[];
    const versions = Object.fromEntries(games.map((x) => [x.title, x.original ?? null]));
    expect(versions).toEqual({
      'Resident Evil': null,
      'Resident Evil 2': null,
      'Resident Evil (2002)': { title: 'Resident Evil', released: '1996-03-30', kind: 'remake' },
      'Resident Evil 2 (2019)': { title: 'Resident Evil 2', released: '1998-01-21', kind: 'remake' },
      // A remaster of the remake: a version of the first game.
      'Resident Evil HD Remaster': { title: 'Resident Evil', released: '1996-03-30', kind: 'version' },
    });
  });
});
