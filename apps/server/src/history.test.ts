import { parseHistory, parseTop100 } from '@squirrelcade/core';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { rommPlatforms, rommRoms } from './db/schema.js';
import { keysOf } from './titleIndex.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g?.cleanup();
});

/** A small Top 100 file: a few PS3 games (one known by two names) and a Super Nintendo list the Super Famicom shares. */
const TOP100 = {
  version: '2026-09-27',
  platforms: [
    {
      platform: 'ps3',
      name: 'Sony PlayStation 3',
      list: [
        { rank: 2, title: 'Uncharted 2: Among Thieves', alt: [], year: 2009 },
        { rank: 1, title: 'The Last of Us', alt: [], year: 2013 },
        { rank: 3, title: 'Journey', alt: [], year: 2012 },
        { rank: 4, title: 'Demon Souls Remastered Edition', alt: ["Demon's Souls"], year: 2009 },
        { rank: 5, title: 'Heavy Rain', alt: [], year: 2010 },
        { rank: 6, title: 'Puppeteer', alt: [], year: 2013 },
      ],
    },
    {
      platform: 'snes',
      name: 'Super Nintendo / Super Famicom',
      list: [
        { rank: 1, title: 'Final Fantasy VI', alt: ['Final Fantasy III'], year: 1994 },
        { rank: 2, title: 'Live A Live', alt: [], year: 1994 },
        { rank: 3, title: 'Super Metroid', alt: [], year: 1994 },
      ],
    },
  ],
};

const PROFILE = {
  manufacturer: 'Sony Computer Entertainment',
  generation: 7,
  launches: [
    { region: 'JP', date: '2006-11-11' },
    { region: 'NA', date: '2006-11-17', price: 'US$499' },
  ],
  discontinued: 'October 2016 (North America), May 29, 2017 (Japan)',
  unitsSold: '87.4 million',
  hardware: ['Cell Broadband Engine'],
  competitors: ['Xbox 360', 'Wii'],
  story: 'It started badly and recovered.',
  firsts: ['Blu-ray games'],
  endOfLife: null,
};

/** A little shipped history: the PS3's, why two PS3 games matter, and one Super Nintendo game. */
const HISTORY = {
  version: '2026-09-28',
  consoles: [
    {
      platformKey: 'playstation-3',
      profile: PROFILE,
      startHere: [
        { title: 'The Last of Us', why: 'A late masterpiece.' },
        { title: 'Heavy Rain', why: 'Choices that stick.' },
      ],
      sources: ['https://en.wikipedia.org/wiki/PlayStation_3'],
      status: 'draft',
      asOf: '2026-09',
    },
  ],
  games: [
    { platformKey: 'playstation-3', title: 'The Last of Us', text: 'Swept the awards.', sources: ['https://en.wikipedia.org/wiki/The_Last_of_Us_(video_game)'], status: 'draft' },
    { platformKey: 'playstation-3', title: 'Journey', text: 'A wordless pilgrimage.', sources: ['https://en.wikipedia.org/wiki/Journey_(2012_video_game)'], status: 'draft' },
    { platformKey: 'super-nintendo', title: 'Final Fantasy VI', text: 'The last 2D main Final Fantasy.', sources: ['https://en.wikipedia.org/wiki/Final_Fantasy_VI'], status: 'draft' },
  ],
};

/** PS3 and Super Nintendo copies (some Japanese, which count on the Super Famicom), with each console's catalog. */
function seed(app: TestApp): void {
  seedCatalogs(app, {
    owned: [
      ['1', 'The Last of Us', 'Playstation 3'],
      ['3', 'Journey Collectors Edition', 'Playstation 3'],
      ['4', "Demon's Souls", 'Playstation 3'],
      ['5', 'Heavy Rain [Greatest Hits]', 'Playstation 3'],
      // A look-alike the owner hasn't answered about yet: Uncharted 2 stays for Review.
      ['9', 'Uncharted 2 Among Thieves Game of the Year', 'Playstation 3'],
      ['6', 'Final Fantasy III', 'Super Nintendo'],
      ['7', 'Live A Live', 'Super Famicom'],
      ['8', 'Puppeteer', 'Playstation 4'],
    ],
    catalogs: {
      'playstation-3': [
        'The Last of Us',
        'Uncharted 2: Among Thieves',
        // Three games on one disc: "Journey" is the game named Journey, not the first to go by the disc's name.
        { title: 'Flower', altTitles: ["Journey Collector's Edition"] },
        { title: 'Journey', altTitles: ["Journey Collector's Edition"] },
        { title: 'flOw', altTitles: ["Journey Collector's Edition"] },
        "Demon's Souls",
        'Heavy Rain',
        'Puppeteer',
      ],
      'super-nintendo': ['Final Fantasy III', 'Super Metroid'],
      'super-famicom': ['Live A Live', 'Final Fantasy VI'],
    },
  });
}

type Row = { title: string; rank: number; owned: string; romm: { romId: number } | null };

describe('Top 100 lists', () => {
  it("lists a console's best games in rank order with what the collection has, counting its other regions' console", async () => {
    g = await testApp({ top100Data: TOP100, historyData: HISTORY });
    const cookies = await setUp(g);
    seed(g);
    // Each console on its own: cross-generation games (another test's subject) stay out of these counts.
    g.settings.update({ 'catalogs.crossGen': false });

    const ps3 = (await g.app.inject({ url: '/api/v1/history/top100/playstation-3', cookies })).json();
    expect(ps3.rows.map((r: Row) => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ps3.summary).toMatchObject({ total: 6, owned: 4, review: 1, inRomm: null });
    const row = (title: string) => ps3.rows.find((r: Row) => r.title === title);
    expect(row('The Last of Us')).toMatchObject({ owned: 'owned', catalogTitle: 'The Last of Us', catalogPlatformKey: 'playstation-3', year: 2013, why: { text: 'Swept the awards.', status: 'draft', origin: 'squirrelcade' } });
    expect(row('The Last of Us').copies).toEqual([{ title: 'The Last of Us', platform: 'PlayStation 3', platformKey: 'playstation-3', completeness: 'complete', sealed: false, quantity: 1 }]);
    // Journey is Journey, though Flower and flOw share the collector's edition's name.
    expect(row('Journey')).toMatchObject({ owned: 'owned', catalogTitle: 'Journey' });
    // Found by another of its names, and by an edition of its title.
    expect(row('Demon Souls Remastered Edition')).toMatchObject({ owned: 'owned', catalogTitle: "Demon's Souls" });
    expect(row('Heavy Rain')).toMatchObject({ owned: 'owned', copies: [{ title: 'Heavy Rain [Greatest Hits]' }] });
    expect(row('Uncharted 2: Among Thieves')).toMatchObject({ owned: 'review', copies: [] });
    // Owned only on another console: not owned here, and it says where.
    expect(row('Puppeteer')).toMatchObject({ owned: 'missing', ownedOn: ['PlayStation 4'], romm: null });

    // The Super Nintendo's list counts the Super Famicom's copies, and opens a game the Super Nintendo never had there.
    const snes = (await g.app.inject({ url: '/api/v1/history/top100/super-nintendo', cookies })).json();
    expect(snes.summary).toMatchObject({ total: 3, owned: 2 });
    expect(snes.rows[0]).toMatchObject({ title: 'Final Fantasy VI', owned: 'owned', catalogTitle: 'Final Fantasy III', catalogPlatformKey: 'super-nintendo', why: { text: 'The last 2D main Final Fantasy.' } });
    expect(snes.rows[1]).toMatchObject({ title: 'Live A Live', owned: 'owned', catalogTitle: 'Live A Live', catalogPlatformKey: 'super-famicom' });
    expect(snes.rows[1].copies[0]).toMatchObject({ platformKey: 'super-famicom', platform: 'Super Famicom' });
    expect(snes.rows[2]).toMatchObject({ title: 'Super Metroid', owned: 'missing' });
    // The Super Famicom has the same list, and its why-it-matters falls back to the Super Nintendo's.
    const sfc = (await g.app.inject({ url: '/api/v1/history/top100/super-famicom', cookies })).json();
    expect(sfc).toMatchObject({ platform: 'Super Famicom', summary: { owned: 2 } });
    expect(sfc.rows[0].why.text).toBe('The last 2D main Final Fantasy.');

    // Which consoles have a list or a history, for the tabs; a console without a list says so.
    const available = (await g.app.inject({ url: '/api/v1/history', cookies })).json();
    expect(available).toMatchObject({ version: '2026-09-27', history: ['playstation-3'] });
    expect(available.top100).toEqual(expect.arrayContaining(['playstation-3', 'super-nintendo', 'super-famicom']));
    expect((await g.app.inject({ url: '/api/v1/history/top100/playstation-4', cookies })).statusCode).toBe(404);
  });

  it('says what the owner played of each game and how many they finished, unless it is kept from viewers', async () => {
    g = await testApp({ top100Data: TOP100, historyData: HISTORY });
    const cookies = await setUp(g);
    seed(g);
    const play = (title: string, status: string, rating?: number) => g.app.inject({ method: 'PUT', url: '/api/v1/play', cookies, payload: { platformKey: 'playstation-3', title, status, rating } });
    await play('The Last of Us', 'completed', 10);
    // Kept under the catalog's name, found by the list's.
    await play("Demon's Souls", 'beaten');
    await play('Journey Collectors Edition', 'playing');
    const ps3 = (await g.app.inject({ url: '/api/v1/history/top100/playstation-3', cookies })).json();
    expect(ps3.summary.finished).toBe(2);
    const row = (title: string) => ps3.rows.find((r: Row) => r.title === title);
    expect(row('The Last of Us').play).toEqual({ status: 'completed', rating: 10 });
    expect(row('Demon Souls Remastered Edition').play).toEqual({ status: 'beaten', rating: null });
    expect(row('Journey').play).toEqual({ status: 'playing', rating: null });
    expect(row('Puppeteer').play).toBeNull();
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: {}, cookies });
    const joined = await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } });
    const viewer = { squirrelcade_session: joined.cookies.find((c) => c.name === 'squirrelcade_session')!.value };
    g.settings.update({ 'security.viewersSeePlay': false });
    const theirs = (await g.app.inject({ url: '/api/v1/history/top100/playstation-3', cookies: viewer })).json();
    expect(theirs.summary.finished).toBeNull();
    expect(theirs.rows.every((r: { play: unknown }) => r.play === null)).toBe(true);
  });

  it("links to RomM only for games you own, unless Settings > Sources > RomM says so; off, there's no RomM at all", async () => {
    g = await testApp({ top100Data: TOP100, historyData: HISTORY, features: ['romm'] });
    const cookies = await setUp(g);
    seed(g);
    // Each console on its own: cross-generation games (another test's subject) stay out of these counts.
    g.settings.update({ 'catalogs.crossGen': false });
    // A RomM index with two PS3 games, as the nightly task would have read it.
    g.db.insert(rommPlatforms).values({ id: 7, slug: 'ps3', name: 'PlayStation 3', igdbId: null, romCount: 2 }).run();
    for (const [id, name] of [
      [70, 'The Last of Us'],
      [71, 'Puppeteer'],
    ] as const) {
      g.db.insert(rommRoms).values({ id, platformId: 7, igdbId: null, name, fsName: `${name} (USA).iso`, regions: '["USA"]', tags: '[]', playable: false }).run();
    }
    g.settings.update({ 'sources.rommUrl': 'http://romm.test:8080', 'sources.rommPublicUrl': 'https://roms.example.com', 'sources.rommPlatforms': ['playstation-3: ps3'] });

    const view = async () => (await g.app.inject({ url: '/api/v1/history/top100/playstation-3', cookies })).json();
    const drawer = async () => (await g.app.inject({ url: '/api/v1/game?platform=playstation-3&title=Puppeteer', cookies })).json().romm;
    let ps3 = await view();
    const row = (title: string) => ps3.rows.find((r: Row) => r.title === title);
    expect(row('The Last of Us').romm).toMatchObject({ romId: 70, url: 'https://roms.example.com/rom/70' });
    // Puppeteer is in RomM but not in the collection: no link by default, in the list or the drawer.
    expect(row('Puppeteer').romm).toBeNull();
    expect(ps3).toMatchObject({ rommUnowned: false, summary: { inRomm: 1, ownedInRomm: 1 } });
    expect(await drawer()).toBeNull();

    g.settings.update({ 'sources.rommLinkUnowned': true });
    ps3 = await view();
    expect(row('Puppeteer').romm).toMatchObject({ romId: 71 });
    expect(ps3).toMatchObject({ rommUnowned: true, summary: { inRomm: 2, ownedInRomm: 1 } });
    expect(await drawer()).toMatchObject({ romId: 71 });

    // RomM turned off (Settings > Features): no links anywhere, no RomM counts, and its API is gone.
    g.settings.update({ 'features.romm': false });
    ps3 = await view();
    expect(row('The Last of Us').romm).toBeNull();
    expect(ps3.summary.inRomm).toBeNull();
    expect(await drawer()).toBeNull();
    const status = await g.app.inject({ url: '/api/v1/sources/romm', cookies });
    expect([status.statusCode, status.json().error]).toEqual([404, 'feature-off']);
  });
});

describe('Console history', () => {
  it("says why a game matters in the drawer, and keeps the owner's version apart from Squirrelcade's", async () => {
    g = await testApp({ top100Data: TOP100, historyData: HISTORY });
    const cookies = await setUp(g);
    seed(g);
    const drawer = async (title: string) => (await g.app.inject({ url: `/api/v1/game?platform=playstation-3&title=${encodeURIComponent(title)}`, cookies })).json().history;
    const put = (payload: Record<string, unknown>) => g.app.inject({ method: 'PUT', url: '/api/v1/history/games', cookies, payload });
    expect(await drawer('The Last of Us')).toEqual({
      why: { text: 'Swept the awards.', sources: ['https://en.wikipedia.org/wiki/The_Last_of_Us_(video_game)'], status: 'draft', origin: 'squirrelcade', updatedAt: null, newerShipped: false },
      top100: { rank: 1, of: 6 },
    });
    // A game with neither says nothing, until the owner writes it.
    expect(await drawer('Flower')).toEqual({ why: null, top100: null });

    // The owner checks Squirrelcade's text: it becomes theirs, verified.
    expect((await put({ platformKey: 'playstation-3', title: 'The Last of Us', status: 'verified' })).json().why).toMatchObject({ text: 'Swept the awards.', status: 'verified', origin: 'yours' });
    // ...and writes one for a game Squirrelcade has none for.
    const flower = await put({ platformKey: 'playstation-3', title: 'Flower', text: 'Wind and petals.', sources: ['https://en.wikipedia.org/wiki/Flower_(video_game)'] });
    expect(flower.json().why).toMatchObject({ text: 'Wind and petals.', status: 'draft', origin: 'yours' });
    expect((await drawer('Flower')).why.text).toBe('Wind and petals.');
    // The Top 100 shows the owner's version.
    const ps3 = (await g.app.inject({ url: '/api/v1/history/top100/playstation-3', cookies })).json();
    expect(ps3.rows[0].why).toMatchObject({ status: 'verified', origin: 'yours' });

    // A game marked bought counts on the list before the next export has it.
    const puppeteer = (await g.app.inject({ url: '/api/v1/game?platform=playstation-3&title=Puppeteer', cookies })).json();
    await g.app.inject({ method: 'POST', url: '/api/v1/purchases', cookies, payload: { entryId: puppeteer.catalog.entryId } });
    const bought = (await g.app.inject({ url: '/api/v1/history/top100/playstation-3', cookies })).json();
    expect(bought.rows.find((r: Row) => r.title === 'Puppeteer')).toMatchObject({ owned: 'owned', copies: [{ title: 'Puppeteer', completeness: 'complete' }] });

    // Bad input is refused: no title, no text, a source that isn't an address, an unknown status.
    expect((await put({ platformKey: 'playstation-3', text: 'No title.' })).statusCode).toBe(400);
    expect((await put({ platformKey: 'playstation-3', title: 'Heavy Rain', text: '  ' })).statusCode).toBe(400);
    expect((await put({ platformKey: 'playstation-3', title: 'Heavy Rain', text: 'Choices.', sources: ['not an address'] })).statusCode).toBe(400);
    expect((await put({ platformKey: 'playstation-3', title: 'Heavy Rain', text: 'Choices.', status: 'maybe' })).statusCode).toBe(400);

    // Squirrelcade's text changes in an update: the owner's version stays, marked so they can take the new one.
    const changed = { ...HISTORY, games: HISTORY.games.map((x) => (x.title === 'The Last of Us' ? { ...x, text: 'Swept the 2013 awards.' } : x)) };
    await g.restart({ historyData: changed });
    expect((await drawer('The Last of Us')).why).toMatchObject({ text: 'Swept the awards.', origin: 'yours', newerShipped: true });
    // Taking theirs back shows Squirrelcade's new text.
    expect((await put({ platformKey: 'playstation-3', title: 'The Last of Us', text: null })).json().why).toMatchObject({ text: 'Swept the 2013 awards.', origin: 'squirrelcade' });
  });

  it("shows a console's history with its Start here games, lets the owner rewrite or check it, and puts consoles on a timeline", async () => {
    g = await testApp({ top100Data: TOP100, historyData: HISTORY });
    const cookies = await setUp(g);
    seed(g);
    const get = async (key: string) => (await g.app.inject({ url: `/api/v1/history/consoles/${key}`, cookies })).json();
    const ps3 = await get('playstation-3');
    expect(ps3).toMatchObject({ platform: 'PlayStation 3', hasTop100: true, history: { status: 'draft', origin: 'squirrelcade', asOf: '2026-09', profile: { generation: 7 } } });
    expect(ps3.history.startHere.map((s: { title: string; owned: string; why: string }) => [s.title, s.owned, s.why])).toEqual([
      ['The Last of Us', 'owned', 'A late masterpiece.'],
      ['Heavy Rain', 'owned', 'Choices that stick.'],
    ]);
    // A console with no history yet.
    expect(await get('super-nintendo')).toMatchObject({ history: null, hasTop100: true });

    const put = (key: string, payload: Record<string, unknown>) => g.app.inject({ method: 'PUT', url: `/api/v1/history/consoles/${key}`, cookies, payload });
    // Checked: the owner's version, verified.
    expect((await put('playstation-3', { status: 'verified' })).json().history).toMatchObject({ status: 'verified', origin: 'yours', profile: { unitsSold: '87.4 million' } });
    // Written from scratch for the Super Nintendo; the Super Famicom shows it too.
    const snesProfile = { ...PROFILE, manufacturer: 'Nintendo', generation: 4, launches: [{ region: 'JP', date: '1990-11-21' }], discontinued: '2003' };
    const written = await put('super-nintendo', { profile: snesProfile, startHere: [{ title: 'Super Metroid', why: 'Exploration.' }], sources: ['https://en.wikipedia.org/wiki/Super_Nintendo_Entertainment_System'] });
    expect(written.json().history).toMatchObject({ origin: 'yours', status: 'draft', profile: { manufacturer: 'Nintendo' }, startHere: [{ title: 'Super Metroid', owned: 'missing' }] });
    expect((await get('super-famicom')).history).toMatchObject({ profile: { manufacturer: 'Nintendo' } });
    // Bad input: a launch day that isn't a date, too many Start here games, a source that isn't an address.
    expect((await put('super-nintendo', { profile: { ...snesProfile, launches: [{ region: 'JP', date: 'soon' }] } })).statusCode).toBe(400);
    expect((await put('super-nintendo', { startHere: Array.from({ length: 16 }, (_, i) => ({ title: `Game ${i}`, why: 'Why.' })) })).statusCode).toBe(400);
    expect((await put('super-nintendo', { sources: ['nope'] })).statusCode).toBe(400);

    // The timeline: consoles by the year they came out, with their best games and Start here games.
    const timeline = (await g.app.inject({ url: '/api/v1/history/timeline', cookies })).json();
    expect(timeline.consoles.map((c: { platformKey: string; launched: number | null; tracked: boolean }) => [c.platformKey, c.launched, c.tracked])).toEqual([
      ['super-nintendo', 1990, true],
      ['playstation-3', 2006, true],
    ]);
    expect(timeline.consoles[1]).toMatchObject({ ended: 2017, generation: 7, hasHistory: true, hasTop100: true });
    const games = timeline.games.map((x: { title: string; year: number; startHere: boolean; owned: string }) => [x.year, x.title, x.startHere, x.owned]);
    expect(games).toContainEqual([2013, 'The Last of Us', true, 'owned']);
    expect(games).toContainEqual([1994, 'Super Metroid', true, 'missing']);
    // A landmark game you don't have comes with your preference for it (none for one you have).
    const metroid = () => timelineGame('Super Metroid');
    const timelineGame = async (title: string) => (await g.app.inject({ url: '/api/v1/history/timeline', cookies })).json().games.find((x: { title: string }) => x.title === title);
    expect(await metroid()).toMatchObject({ catalogTitle: 'Super Metroid', preference: null });
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', cookies, payload: { platformKey: 'super-nintendo', title: 'Super Metroid', preference: 'Must Have', note: null } });
    expect(await metroid()).toMatchObject({ preference: 'Must Have' });
    expect(await timelineGame('The Last of Us')).toMatchObject({ owned: 'owned', preference: null });
    // As many landmark games per console as Settings > Interface says (Start here games come on top).
    g.settings.update({ 'interface.timelineGames': 1 });
    const fewer = (await g.app.inject({ url: '/api/v1/history/timeline', cookies })).json();
    expect(fewer.games.filter((x: { platformKey: string }) => x.platformKey === 'playstation-3').map((x: { title: string }) => x.title).sort()).toEqual(['Heavy Rain', 'The Last of Us']);

    // Back to Squirrelcade's: the Super Nintendo has none again.
    await put('super-nintendo', { reset: true });
    expect((await get('super-nintendo')).history).toBeNull();
  });

  it('is off with Settings > Features, and viewers can read it but not change it', async () => {
    g = await testApp({ top100Data: TOP100, historyData: HISTORY });
    const owner = await setUp(g);
    seed(g);
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Sam' }, cookies: owner });
    const joined = await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } });
    const viewer = { squirrelcade_session: joined.cookies.find((c) => c.name === 'squirrelcade_session')!.value };
    for (const url of ['/api/v1/history', '/api/v1/history/top100/playstation-3', '/api/v1/history/consoles/playstation-3', '/api/v1/history/timeline']) {
      expect([url, (await g.app.inject({ url, cookies: viewer })).statusCode]).toEqual([url, 200]);
    }
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/history/games', cookies: viewer, payload: { platformKey: 'playstation-3', title: 'Journey', status: 'verified' } })).statusCode).toBe(403);
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/history/consoles/playstation-3', cookies: viewer, payload: { status: 'verified' } })).statusCode).toBe(403);

    g.settings.update({ 'features.history': false });
    for (const url of ['/api/v1/history', '/api/v1/history/top100/playstation-3', '/api/v1/history/timeline']) {
      const res = await g.app.inject({ url, cookies: owner });
      expect([url, res.statusCode, res.json().error]).toEqual([url, 404, 'feature-off']);
    }
    expect((await g.app.inject({ url: '/api/v1/game?platform=playstation-3&title=Journey', cookies: owner })).json().history).toBeNull();
  });
});

describe('the lists and history that ship with Squirrelcade', () => {
  const top100 = parseTop100(JSON.parse(readFileSync(new URL('../data/top100.json', import.meta.url), 'utf8')));
  const history = parseHistory(JSON.parse(readFileSync(new URL('../data/history.json', import.meta.url), 'utf8')));

  it('has ranked lists without gaps, one per console', () => {
    expect(top100.lists.length).toBeGreaterThanOrEqual(40);
    expect(new Set(top100.lists.map((l) => l.platformKey)).size).toBe(top100.lists.length);
    for (const l of top100.lists) expect([l.platformKey, l.entries.map((e) => e.rank)]).toEqual([l.platformKey, l.entries.map((_, i) => i + 1)]);
  });

  it("matches every text about a game to a game of its console's list, and every Start here game too", () => {
    const listed = (key: string, title: string) => {
      const list = top100.lists.find((l) => l.platformKey === key);
      const keys = keysOf(title);
      return Boolean(list?.entries.some((e) => [e.title, ...e.altTitles].some((n) => keysOf(n).some((k) => keys.includes(k)))));
    };
    expect(history.games.filter((x) => !listed(x.platformKey, x.title)).map((x) => `${x.platformKey}: ${x.title}`)).toEqual([]);
    for (const c of history.consoles) expect(c.startHere.filter((s) => !listed(c.platformKey, s.title)).map((s) => s.title)).toEqual([]);
    // Every text cites English Wikipedia (see docs/DECISIONS.md, D49), and each console appears once.
    for (const s of [...history.consoles.flatMap((c) => c.sources), ...history.games.flatMap((x) => x.sources)]) expect(s).toMatch(/^https:\/\/en\.wikipedia\.org\/wiki\//);
    expect(new Set(history.consoles.map((c) => c.platformKey)).size).toBe(history.consoles.length);
  });
});
