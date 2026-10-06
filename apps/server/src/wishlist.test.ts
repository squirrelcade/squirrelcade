import { normalizeTitle, type GameDetails } from '@squirrelcade/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { gameDetails, igdbGames, platforms } from './db/schema.js';
import { csvLines, seedCatalogs, setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

/** Details the user (or a lookup source) knows about a game. */
function details(platform: string, title: string, d: GameDetails & { marketValueCents?: number }) {
  const platformId = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, platform)).get()!.id;
  g.db
    .insert(gameDetails)
    .values({ platformId, title, titleKey: normalizeTitle(title), details: JSON.stringify(d), source: 'user', updatedAt: new Date().toISOString() })
    .run();
}

/** Two consoles' catalogs, scoring points, game details, hidden games and a preference. */
function load() {
  seedCatalogs(g, {
    owned: [
      ['1', 'Uncharted', 'Playstation 3'],
      ['2', 'Okami', 'Wii'],
    ],
    catalogs: {
      'playstation-3': ['Uncharted', 'Tales of Graces f', 'Okami', 'Hidden Game', 'Deferred Game', 'Cheap Only', 'Movie Game', 'Final Fantasy XIII'],
      wii: ['Okami', 'Xenoblade Chronicles'],
    },
    exclusions: [
      { platform: 'playstation-3', title: 'Hidden Game', action: 'hide' },
      { platform: 'playstation-3', title: 'Deferred Game', action: 'defer', until: '2999-01-01' },
      { platform: 'playstation-3', title: 'Cheap Only', action: 'below-price', belowCents: 2000 },
    ],
  });
  g.settings.update({
    'wishlist.platformPoints': { 'playstation-3': 12 },
    'wishlist.otherPlatformPoints': 2,
    'wishlist.genrePoints': { RPG: 30, 'Action-adventure': 26 },
    'wishlist.stylePoints': { JRPG: 9 },
    'wishlist.homeRegionPoints': 5,
    'wishlist.completionBy': 'left',
    'wishlist.completionTiers': [{ max: 3, points: 60 }],
    'wishlist.seriesTiers': [{ max: 1, points: 30 }],
    'wishlist.personalInterestPoints': { Essential: 20 },
    'wishlist.releaseClassPoints': { 'Exact target': 6 },
    'wishlist.campaignPlatforms': ['wii'],
    'wishlist.campaignPoints': 15,
    'wishlist.offbeatJapanesePoints': 15,
    'wishlist.tieInPoints': -8,
    'wishlist.consoleDiversityPenalty': 5,
    'wishlist.ownedElsewherePoints': -20,
    // This test follows the old points model: no review points, no cap at 100.
    'wishlist.reviewTop': 0,
    'wishlist.maxScore': 0,
  });
  const standard = { naPhysical: true, releaseClass: 'Exact target', significance: 'Standard', marketUrgency: 'Low' };
  details('playstation-3', 'Tales of Graces f', {
    ...standard,
    genre: 'RPG',
    style: 'JRPG',
    seriesRemaining: 1,
    japaneseDeveloped: true,
    offbeat: true,
    personalInterest: 'Essential',
    franchise: 'tales of',
    marketValueCents: 4000,
  });
  details('playstation-3', 'Movie Game', { ...standard, genre: 'Action-adventure', tieIn: true, personalInterest: 'Neutral' });
  details('playstation-3', 'Cheap Only', { ...standard, genre: 'RPG', personalInterest: 'Neutral', marketValueCents: 2500 });
  g.wishlist.setPreference('playstation-3', 'Final Fantasy XIII', 'Strong Interest', 'Want it');
}

describe('tastes learned from the collection', () => {
  it('ranks the consoles by games added lately, genres by what you own more of, and counts the series you collect', async () => {
    const rpgs = Array.from({ length: 12 }, (_, i) => `Quest ${i + 1}`);
    const racers = Array.from({ length: 12 }, (_, i) => `Speed ${i + 1}`);
    seedCatalogs(g, {
      owned: [
        ...rpgs.slice(0, 4).map((t, i): [string, string, string] => [`r${i}`, t, 'Playstation 3']),
        ['s1', 'Speed 1', 'Playstation 3'],
        ['ff', 'Final Fantasy X', 'Playstation 3'],
        ['w1', 'Some Wii Game', 'Wii'],
      ],
      catalogs: { 'playstation-3': [...rpgs, ...racers, 'Final Fantasy X', 'Final Fantasy XIII'], wii: ['Some Wii Game', 'Another Wii Game'] },
    });
    const ps3 = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, 'playstation-3')).get()!.id;
    const igdbGame = (id: number, name: string, genres: string[]) =>
      JSON.stringify({ id, name, altNames: [], coverId: null, genres, themes: [], perspectives: [], franchise: null, japanese: null, released: null, gameType: null });
    g.db
      .insert(igdbGames)
      .values([...rpgs.map((t, i) => ({ platformId: ps3, igdbId: 100 + i, data: igdbGame(100 + i, t, ['Role-playing (RPG)']) })), ...racers.map((t, i) => ({ platformId: ps3, igdbId: 200 + i, data: igdbGame(200 + i, t, ['Racing']) }))])
      .run();
    g.settings.update({ 'wishlist.learnMinGames': 2 });

    const t = (await g.app.inject({ url: '/api/v1/wishlist/tastes', cookies })).json();
    // Six PS3 games and one Wii game, all added this year: PS3 is collected now (the top points), Wii isn't (under 2 games).
    expect(t.platforms.map((p: { key: string; recent: number; points: number | null }) => [p.key, p.recent, p.points])).toEqual([
      ['playstation-3', 6, 22],
      ['wii', 1, null],
    ]);
    // Owned: 4 of 12 RPGs, 1 of 12 racing games, so RPGs come first.
    expect(t.genres.map((x: { name: string }) => x.name)).toEqual(['RPG', 'Racing']);
    expect(t.genres[0].lift).toBeGreaterThan(1);
    expect(t.genres[1].lift).toBeLessThan(1);
    expect(t.learning).toEqual({ platforms: true, genres: true });

    const w = (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json();
    const quest = w.master.find((m: { title: string }) => m.title === 'Quest 5');
    expect(quest.components).toEqual(expect.arrayContaining([{ label: 'PlayStation 3', points: 22 }, { label: 'RPG (IGDB)', points: 22 }]));
    // Owning Final Fantasy X counts for Final Fantasy XIII.
    const ff = w.master.find((m: { title: string }) => m.title === 'Final Fantasy XIII');
    expect(ff.components).toContainEqual({ label: 'Series you collect (1 owned)', points: 5 });
    // A list of your own replaces the learned one.
    g.settings.update({ 'wishlist.platformPoints': { wii: 9 } });
    expect((await g.app.inject({ url: '/api/v1/wishlist/tastes', cookies })).json().learning).toEqual({ platforms: false, genres: true });
  });
});

describe('wishlist', () => {
  it('ranks the missing games with explanations', async () => {
    load();
    const w = (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json();
    const titles = w.master.map((m: { title: string }) => m.title);
    // Uncharted is owned; Hidden and Deferred are hidden; Cheap Only has no price at or below $20.
    expect(titles).not.toContain('Uncharted');
    expect(titles).not.toContain('Hidden Game');
    expect(titles).not.toContain('Deferred Game');
    expect(titles).not.toContain('Cheap Only');
    expect(w.counts.hidden).toBe(3);
    const tales = w.master.find((m: { title: string }) => m.title === 'Tales of Graces f');
    // 12 PS3 + 5 region + 30 RPG + 9 JRPG + 30 series (1 left) + 15 offbeat + 20 essential + 6 exact
    expect(tales.score).toBe(127);
    expect(tales.priority).toBe('High');
    // Xenoblade ties at 127 (2 other + 5 + 30 RPG + 9 JRPG guessed + 60 completion + 15 campaign + 6) and wins
    // the tie on console-completion points, as in the old ranking.
    expect(w.master.slice(0, 2).map((m: { title: string; score: number }) => [m.title, m.score])).toEqual([
      ['Xenoblade Chronicles', 127],
      ['Tales of Graces f', 127],
    ]);

    const okami = w.master.find((m: { title: string; platform: string }) => m.title === 'Okami' && m.platform === 'PlayStation 3');
    expect(okami.components).toContainEqual({ label: 'Owned on Wii', points: -20 });
    const ff = w.master.find((m: { title: string }) => m.title === 'Final Fantasy XIII');
    expect(ff.preference).toBe('Strong Interest');
    expect(ff.flags).toContain('Genre guessed from "final fantasy"');
    // Search and Store Mode show a game's own score with its place on the list, not the list's score less its
    // variety penalties (which only orders the list, and can fall below 0).
    expect(ff.masterScore).toBeLessThan(ff.score);
    const [found] = (await g.app.inject({ url: '/api/v1/lookup?q=final%20fantasy%20xiii&platform=playstation-3', cookies })).json();
    expect(found.wishlist).toMatchObject({ score: ff.score, rank: ff.rank });
    const movie = w.master.find((m: { title: string }) => m.title === 'Movie Game');
    expect(movie.components).toContainEqual({ label: 'Movie/TV tie-in', points: -8 });
    // Wii: one game left (Xenoblade) -> completion 60 + campaign 15.
    const xeno = w.master.find((m: { title: string }) => m.title === 'Xenoblade Chronicles');
    expect(xeno.components).toEqual(expect.arrayContaining([{ label: 'Near complete (1 left)', points: 60 }, { label: 'Completion campaign', points: 15 }]));
  });

  it('lists the best games per platform', async () => {
    load();
    const ps3 = (await g.app.inject({ url: '/api/v1/wishlist/platforms/playstation-3', cookies })).json();
    expect(ps3.entries[0].title).toBe('Tales of Graces f');
    expect((await g.app.inject({ url: '/api/v1/wishlist/platforms/nope', cookies })).statusCode).toBe(404);
  });

  it('follows preference changes and setting changes', async () => {
    load();
    const scoreOf = async (title: string) => (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json().master.find((m: { title: string }) => m.title === title);
    const before = (await scoreOf('Movie Game')).score;
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', cookies, payload: { platformKey: 'playstation-3', title: 'Movie Game', preference: 'Must Have', note: null } });
    expect((await scoreOf('Movie Game')).score).toBe(before + 20);
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', cookies, payload: { platformKey: 'playstation-3', title: 'Movie Game', preference: 'Do Not Recommend', note: null } });
    expect(await scoreOf('Movie Game')).toBeUndefined();
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', cookies, payload: { platformKey: 'playstation-3', title: 'Movie Game', preference: null, note: null } });
    expect((await scoreOf('Movie Game')).score).toBe(before);
    g.settings.update({ 'wishlist.tieInPoints': 0 });
    expect((await scoreOf('Movie Game')).score).toBe(before + 8);
  });

  it('exports the wishlist as a spreadsheet', async () => {
    load();
    const top = await g.app.inject({ url: '/api/v1/wishlist/export', cookies });
    expect(top.headers['content-type']).toContain('text/csv');
    const lines = csvLines(top.body);
    expect(lines[0]).toBe('Rank,Title,Platform,Acorns,Base acorns,Priority,Your preference,Owned on,Series,Your note');
    const master = (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json().master;
    expect(lines).toHaveLength(master.length + 1);
    expect(lines[1]!.startsWith(`1,${master[0].title},`)).toBe(true);
    expect(lines[1]!.endsWith(',')).toBe(true);
    // Your note on a game is its last column.
    await g.app.inject({ method: 'PUT', url: '/api/v1/game/note', cookies, payload: { platformKey: master[0].platformKey, title: master[0].title, note: 'Sealed only' } });
    expect(csvLines((await g.app.inject({ url: '/api/v1/wishlist/export', cookies })).body)[1]!.endsWith(',Sealed only')).toBe(true);
    const byPlatform = await g.app.inject({ url: '/api/v1/wishlist/export?list=platforms', cookies });
    expect(byPlatform.headers['content-disposition']).toContain('squirrelcade-wishlist-by-platform-');
    expect(csvLines(byPlatform.body)[0]).toBe('Platform,Place,Title,Acorns,Priority,Your preference,Owned on,Your note');
    expect(csvLines(byPlatform.body).filter((l) => l.endsWith(',Sealed only'))).toHaveLength(1);
  });

  it('snoozes games until a date and wakes them up', async () => {
    load();
    const wishlist = async () => (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json();
    const snooze = (title: string, until: string | null) => g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/snooze', cookies, payload: { platformKey: 'playstation-3', title, until } });
    // A game hidden until a date shows as snoozed.
    expect((await wishlist()).snoozed).toEqual([{ platformKey: 'playstation-3', platform: 'PlayStation 3', title: 'Deferred Game', until: '2999-01-01' }]);

    expect((await snooze('Movie Game', '2999-06-01')).statusCode).toBe(200);
    let w = await wishlist();
    expect(w.master.map((m: { title: string }) => m.title)).not.toContain('Movie Game');
    expect(w.snoozed.map((z: { title: string }) => z.title)).toEqual(['Deferred Game', 'Movie Game']);

    await snooze('Movie Game', null);
    await snooze('Deferred Game', null);
    w = await wishlist();
    expect(w.snoozed).toEqual([]);
    expect(w.master.map((m: { title: string }) => m.title)).toEqual(expect.arrayContaining(['Movie Game', 'Deferred Game']));

    expect((await snooze('Movie Game', '2020-01-01')).statusCode).toBe(400);
    expect((await snooze('Movie Game', 'next week')).statusCode).toBe(400);
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/snooze', cookies, payload: { platformKey: 'nope', title: 'X', until: null } })).statusCode).toBe(404);
  });
});
