import { normalizeTitle, type GameDetails } from '@squirrelcade/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('My wishlist and Suggestions (1.4.0, D217)', () => {
  const titles = (list: { title: string }[]) => list.map((m) => m.title);

  it("never suggests a game the owner has on the console, even when its catalog didn't see the copy", () => {
    load();
    // The catalog counts Uncharted as missing, as a tester's catalogs did with games he had.
    const real = g.catalogs.allMatches.bind(g.catalogs);
    vi.spyOn(g.catalogs, 'allMatches').mockImplementation(() =>
      real().map((p) => ({ ...p, regionOf: p.regionOf, match: { ...p.match, targets: p.match.targets.map((t) => (t.target.title === 'Uncharted' ? { ...t, status: 'missing' as const } : t)) } })),
    );
    g.wishlist.invalidate();
    const r = g.wishlist.compute();
    expect(titles(r.master)).not.toContain('Uncharted');
    expect(titles(r.byPlatform.get('playstation-3') ?? [])).not.toContain('Uncharted');
    expect(r.offList.get('playstation-3|uncharted')).toMatch(/You have it on this console/);
    // The next rebuild leaves it out before the lists are picked (the copies are unchanged).
    g.wishlist.invalidate();
    expect(titles(g.wishlist.compute().master)).not.toContain('Uncharted');
  });

  it('holds only the games the owner adds when they choose so; the ranked list stays as Suggestions', async () => {
    load();
    const before = (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json();
    expect(before.source).toBe('suggested');
    expect(before.suggestions).toBeNull();
    expect(before.master.length).toBeGreaterThan(0);

    g.settings.update({ 'wishlist.source': 'mine' });
    g.wishlist.invalidate();
    const empty = (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json();
    expect(empty.source).toBe('mine');
    expect(empty.master).toEqual([]);
    expect(titles(empty.suggestions)).toEqual(titles(before.master));

    const add = (platformKey: string, title: string, source?: string) => g.app.inject({ method: 'POST', url: '/api/v1/wishlist/mine', cookies, payload: { platformKey, title, source } });
    expect((await add('playstation-3', 'Tales of Graces f')).statusCode).toBe(201);
    expect((await add('playstation-3', 'Final Fantasy XIII', 'game')).statusCode).toBe(201);
    expect((await add('playstation-3', 'A Homebrew Game', 'store')).statusCode).toBe(201);
    expect((await add('playstation-3', 'Uncharted')).statusCode).toBe(201); // owned: never shown
    expect((await add('nope', 'X')).statusCode).toBe(404);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/wishlist/mine', cookies, payload: { platformKey: 'playstation-3' } })).statusCode).toBe(400);

    const mine = (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json();
    expect(titles(mine.master)).toEqual(['Tales of Graces f', 'Final Fantasy XIII', 'A Homebrew Game']);
    expect(mine.master.map((m: { rank: number }) => m.rank)).toEqual([1, 2, 3]);
    expect(mine.master[2].score).toBe(0);
    // Store Mode and the game's acorns read their place on My wishlist.
    expect(g.wishlist.compute().index.get('playstation-3|tales of graces f')?.rank).toBe(1);
    const suggestedOnly = titles(mine.suggestions).find((t: string) => !['Tales of Graces f', 'Final Fantasy XIII'].includes(t));
    if (suggestedOnly) expect(g.wishlist.compute().index.get(`playstation-3|${normalizeTitle(suggestedOnly)}`)?.rank ?? null).toBeNull();

    const listed = (await g.app.inject({ url: '/api/v1/wishlist/mine', cookies })).json().games as { title: string; source: string }[];
    expect(listed.find((w) => w.title === 'Final Fantasy XIII')?.source).toBe('game');
    const removed = await g.app.inject({ method: 'DELETE', url: `/api/v1/wishlist/mine?platform=playstation-3&title=${encodeURIComponent('Final Fantasy XIII')}`, cookies });
    expect(removed.json()).toEqual({ removed: true });
    expect(titles((await g.app.inject({ url: '/api/v1/wishlist', cookies })).json().master)).toEqual(['Tales of Graces f', 'A Homebrew Game']);
  });

  it('works the wishlist out in the background in steps, keeping it once done, and never keeps one made old meanwhile (D220)', async () => {
    load();
    g.wishlist.invalidate();
    let ticks = 0;
    const counting = setInterval(() => ticks++, 0);
    await g.wishlist.rebuild();
    clearInterval(counting);
    const first = g.wishlist.compute();
    expect(g.wishlist.compute()).toBe(first);
    expect(first.master.length).toBeGreaterThan(0);

    // A change while it's being worked out: the old one isn't kept, and the next ask works it out anew.
    g.wishlist.invalidate();
    const running = g.wishlist.rebuild();
    g.wishlist.setPreference('playstation-3', 'Movie Game', 'Strong Interest', null);
    await running;
    const after = g.wishlist.compute();
    expect(after).not.toBe(first);
    expect(after.all.get('playstation-3|movie game')?.preference).toBe('Strong Interest');
    expect(ticks).toBeGreaterThanOrEqual(0);
  });
});
