import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { appState, igdbGames, platforms } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

const HEAD = `<tr><th rowspan="2">Title</th><th rowspan="2">Developer(s)</th><th colspan="3">Release date</th><th rowspan="2">Options</th></tr><tr><th>JP</th><th>PAL</th><th>NA</th></tr>`;
const row = (title: string, jp: string, pal: string, na: string, options = '') => `<tr><th scope="row"><i>${title}</i></th><td>Studio</td><td>${jp}</td><td>${pal}</td><td>${na}</td><td>${options}</td></tr>`;

/**
 * A fake Wikipedia: pages by title (a missing title answers as Wikipedia does), the prefix search, and
 * articles' categories (redirects followed, only the categories asked about).
 */
function fakeWikipedia(pages: Record<string, string>, articles: { categories?: Record<string, string[]>; redirects?: Record<string, string> } = {}) {
  const calls: { action: string; page: string | null; agent: string | null; titles?: string; categories?: string }[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const u = new URL(url);
    const action = u.searchParams.get('action') ?? '';
    const page = u.searchParams.get('page');
    const call: (typeof calls)[number] = { action, page, agent: new Headers(init.headers).get('user-agent') };
    calls.push(call);
    if (action === 'query' && u.searchParams.get('prop') === 'categories') {
      call.titles = u.searchParams.get('titles') ?? '';
      call.categories = u.searchParams.get('clcategories') ?? '';
      const wanted = call.categories.split('|');
      const titles = call.titles.split('|');
      const redirects = titles.filter((t) => articles.redirects?.[t]).map((t) => ({ from: t, to: articles.redirects![t]! }));
      const result = titles.map((t) => articles.redirects?.[t] ?? t);
      return Response.json({
        query: {
          redirects,
          pages: result.map((title) => {
            const cats = articles.categories?.[title];
            if (!cats) return { title, missing: true };
            const kept = cats.map((c) => `Category:${c}`).filter((c) => wanted.includes(c));
            return kept.length > 0 ? { title, categories: kept.map((c) => ({ ns: 14, title: c })) } : { title };
          }),
        },
      });
    }
    if (action === 'query') {
      const prefix = u.searchParams.get('pssearch') ?? '';
      const found = Object.keys(pages).filter((t) => t.startsWith(prefix));
      return Response.json({ query: { prefixsearch: [...found, `${prefix} that support 3D`].map((title) => ({ title })) } });
    }
    const html = pages[page ?? ''];
    if (html === undefined) return Response.json({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } });
    return Response.json({ parse: { title: page, text: html } });
  };
  return { fetch, calls, pages };
}

function ps3Pages() {
  return {
    'List of PlayStation 3 games (A–C)': `
      <table class="wikitable"><tr><th colspan="2">Key</th></tr><tr><td>M PlayStation Move</td><td>D Digital only games</td></tr></table>
      <h2>List</h2>
      <table class="wikitable sortable">${HEAD}
        ${row('Afrika', 'August 28, 2008', 'Unreleased', 'June 9, 2009', 'M')}
        ${row('Only In Japan', 'March 1, 2010', 'Unreleased', 'Unreleased')}
        ${row('Bejeweled 2', 'Unreleased', '2008', 'December 11, 2008', 'D')}
        ${row('Cars 2: The Video Game', 'Unreleased', 'July 2011', 'June 21, 2011')}
      </table>`,
    'List of PlayStation 3 games (D–Z)': `
      <h2>List</h2>
      <table class="wikitable sortable">${HEAD}
        ${row("Uncharted: Drake's Fortune<br>Uncharted", 'December 6, 2007', 'December 7, 2007', 'November 19, 2007')}
        ${row('Valkyria Chronicles', 'April 24, 2008', 'October 31, 2008', 'November 4, 2008')}
      </table>
      <h2>Promotional releases</h2>
      <table class="wikitable">${HEAD}${row('Kiosk Demo Disc', 'Unreleased', 'Unreleased', '2007')}</table>
      <h2>Unreleased games</h2>
      <table class="wikitable"><tr><th>Title</th><th>Developer</th></tr><tr><td>Never Came Out</td><td>Nobody</td></tr></table>`,
  };
}

/** Shaped like "List of Xbox 360 games": a key whose marks include download titles, used in an Addons column. */
const X360_HEAD = `<tr><th rowspan="2">Title</th><th rowspan="2">Developer(s)</th><th colspan="2">Release date</th><th rowspan="2">Addons</th></tr><tr><th>NA</th><th>EU</th></tr>`;
const x360Row = (title: string, na: string, marks = '') => `<tr><td><i>${title}</i></td><td>Studio</td><td>${na}</td><td>2012</td><td>${marks}</td></tr>`;
function x360Pages() {
  return {
    'List of Xbox 360 games': `
      <table class="wikitable"><tr><td>K Kinect optional</td><td>DL Downloadable titles</td><td>XBLIG Xbox Live Indie Games</td><td>XBLA Xbox Live Arcade titles</td></tr></table>
      <table class="wikitable sortable">${X360_HEAD}
        ${x360Row('Halo 3', 'September 25, 2007')}
        ${x360Row('Castle Crashers', 'August 27, 2008', 'XBLA')}
        ${x360Row('Wreckateer', 'May 2, 2012', 'K XBLA')}
        ${x360Row('Indie Thing', '2011', 'XBLIG')}
        ${x360Row('Kinect Adventures!', 'November 4, 2010', 'K')}
      </table>`,
  };
}

/** Six different games make a console tracked. */
const PS3_OWNED: [string, string, string][] = [
  ['1', 'Uncharted [Greatest Hits]', 'Playstation 3'],
  ['2', 'Cars 2', 'Playstation 3'],
  ['3', 'Afrika', 'Playstation 3'],
  ['4', 'Demons Souls', 'Playstation 3'],
  ['5', 'Flower', 'Playstation 3'],
  ['6', 'Journey', 'Playstation 3'],
];
const X360_OWNED: [string, string, string][] = [
  ['11', 'Halo 3', 'Xbox 360'],
  ['12', 'Castle Crashers', 'Xbox 360'],
  ['13', 'Gears of War', 'Xbox 360'],
  ['14', 'Fable II', 'Xbox 360'],
  ['15', 'Mass Effect', 'Xbox 360'],
  ['16', 'Forza Motorsport 2', 'Xbox 360'],
];

async function start(pages: Record<string, string> = ps3Pages(), options: { articles?: Parameters<typeof fakeWikipedia>[1]; owned?: [string, string, string][] } = {}) {
  const fake = fakeWikipedia(pages, options.articles);
  g = await testApp({ wikipediaFetch: fake.fetch });
  cookies = await setUp(g);
  seedCatalogs(g, { owned: options.owned ?? PS3_OWNED, catalogs: {} });
  return fake;
}

/** A FormData as the multipart body and headers app.inject takes. */
async function multipartBody(form: FormData): Promise<{ payload: Buffer; headers: Record<string, string> }> {
  const res = new Response(form);
  return { payload: Buffer.from(await res.arrayBuffer()), headers: { 'content-type': res.headers.get('content-type')! } };
}

const build = async (body: object = {}) => {
  const res = await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/build', cookies, payload: body });
  await g.tasks.whenIdle();
  return res;
};
const detail = async (platform = 'playstation-3') => (await g.app.inject({ url: `/api/v1/catalogs/${platform}?all=1`, cookies })).json();
type Entry = { id: number; title: string; status: string; notes: string | null; evidence: string | null };
const statuses = async (platform = 'playstation-3') => Object.fromEntries(((await detail(platform)).entries as Entry[]).map((e) => [e.title, e.status]));
const sources = async () => (await g.app.inject({ url: '/api/v1/catalogs/sources', cookies })).json() as Promise<{ key: string; downloads: number; skipped: Record<string, number> }[]>;

describe('catalogs from Wikipedia', () => {
  it('builds a tracked console\'s catalog from its list pages', async () => {
    const fake = await start();
    const res = await build();
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ queued: ['playstation-3'] });

    const d = await detail();
    const byTitle = Object.fromEntries(d.entries.map((e: { title: string; status: string }) => [e.title, e.status]));
    // North American retail games; the promotional disc comes in for review. Left out: the Japan-only game,
    // the download-only one, the unreleased one, and the unrelated page the prefix search also found.
    expect(byTitle).toEqual({
      Afrika: 'owned',
      'Cars 2: The Video Game': 'review',
      'Kiosk Demo Disc': 'review',
      "Uncharted: Drake's Fortune": 'owned',
      'Valkyria Chronicles': 'missing',
    });
    // Uncharted is owned through the other name the list gives it.
    expect(d.entries.find((e: { title: string }) => e.title.startsWith('Uncharted')).matches).toEqual([expect.objectContaining({ productId: '1', method: 'alias' })]);
    expect(d.entries.find((e: { title: string }) => e.title === 'Kiosk Demo Disc')).toMatchObject({ notes: 'Wikipedia lists it under "Promotional releases"', source: 'wikipedia' });

    const [status] = (await g.app.inject({ url: '/api/v1/catalogs/sources', cookies })).json();
    expect(status).toMatchObject({
      key: 'playstation-3',
      tracked: true,
      pages: ['List of PlayStation 3 games'],
      games: 5,
      skipped: { region: 1, digital: 1, unlicensed: 0, other: 1 },
      error: null,
    });
    expect(fake.calls.filter((c) => c.action === 'parse').map((c) => c.page)).toEqual([
      'List of PlayStation 3 games',
      'List of PlayStation 3 games (A–C)',
      'List of PlayStation 3 games (D–Z)',
    ]);
    expect(fake.calls.every((c) => c.agent?.startsWith('Squirrelcade/'))).toBe(true);
  });

  it('refreshes the catalog and keeps the answers', async () => {
    const fake = await start();
    await build();
    const valkyria = (await detail()).entries.find((e: { title: string }) => e.title === 'Valkyria Chronicles');
    await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${valkyria.id}`, cookies, payload: { targetStatus: 'excluded' } });

    // Next month the list drops Valkyria Chronicles and Afrika, and adds a game.
    fake.pages['List of PlayStation 3 games (D–Z)'] = fake.pages['List of PlayStation 3 games (D–Z)']!.replace(row('Valkyria Chronicles', 'April 24, 2008', 'October 31, 2008', 'November 4, 2008'), row('Zombie Game', 'Unreleased', '2012', '2012'));
    fake.pages['List of PlayStation 3 games (A–C)'] = fake.pages['List of PlayStation 3 games (A–C)']!.replace(row('Afrika', 'August 28, 2008', 'Unreleased', 'June 9, 2009', 'M'), '');
    await build({ platforms: ['playstation-3'] });
    const titles = (await detail()).entries.map((e: { title: string; status: string }) => `${e.title}: ${e.status}`);
    // Valkyria stays (the user excluded it); Afrika goes; Zombie Game comes.
    expect(titles).toEqual(['Cars 2: The Video Game: review', 'Kiosk Demo Disc: review', "Uncharted: Drake's Fortune: owned", 'Valkyria Chronicles: excluded', 'Zombie Game: missing']);
  });

  it('follows the settings for download-only and region', async () => {
    await start();
    g.settings.update({ 'catalogs.includeDigitalOnly': true, 'general.homeRegion': 'japan' });
    await build();
    const titles = (await detail()).entries.map((e: { title: string }) => e.title);
    expect(titles).toEqual(['Afrika', 'Only In Japan', "Uncharted: Drake's Fortune", 'Valkyria Chronicles']);
  });

  it('keeps the last catalog and reports the problem when a list can\'t be read', async () => {
    await start();
    await build();
    g.settings.update({ 'catalogs.wikipediaPages': ['playstation-3: List of games that do not exist'] });
    await build({ platforms: ['playstation-3'] });
    const [status] = (await g.app.inject({ url: '/api/v1/catalogs/sources', cookies })).json();
    expect(status).toMatchObject({ pages: ['List of games that do not exist'], games: 5, error: 'Wikipedia has no page named "List of games that do not exist".' });
    expect((await detail()).entries).toHaveLength(5);
    expect(g.tasks.lastRun('catalog-build')).toMatchObject({ status: 'failed' });
  });

  it("adds other regions' physical releases from IGDB on a console that isn't region-locked, counting once owned", async () => {
    await start();
    const ps3 = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, 'playstation-3')).get()!.id;
    const game = (id: number, name: string, physical: number[], gameType = 'Main Game') => ({
      platformId: ps3,
      igdbId: id,
      data: JSON.stringify({ id, name, altNames: [], coverId: null, genres: [], themes: [], perspectives: [], franchise: null, japanese: null, released: '2011-05-06', gameType, physical }),
    });
    // A PAL-only disc, a download-only game and an add-on: only the disc joins the catalog.
    g.db.insert(igdbGames).values([game(9001, 'Euro Only Racer', [826]), game(9002, 'Download Only Thing', []), game(9003, 'Racer Track Pack', [826], 'DLC')]).run();
    await build();
    const entries = async () => ((await detail()).entries as { title: string; status: string; source: string }[]).map((e) => `${e.title}: ${e.status} (${e.source})`);
    const added = (await entries()).filter((e) => /Euro Only|Download Only|Track Pack/.test(e));
    expect(added).toEqual(['Euro Only Racer: extra (igdb-regions)']);
    // Not owned, it's neither missing nor counted.
    expect((await detail()).counts).toMatchObject({ extra: 1 });
    // A region-locked console leaves other regions' releases to its regional console.
    g.settings.update({ 'platforms.regionLocked': ['playstation-3'] });
    await build({ platforms: ['playstation-3'] });
    expect((await entries()).some((e) => e.startsWith('Euro Only Racer'))).toBe(false);
  });

  it("puts a console list of your own on top of Wikipedia's", async () => {
    const fake = await start();
    await build();
    // Wikipedia also lists a game that comes out after the user's list was made.
    fake.pages['List of PlayStation 3 games (D–Z)'] = fake.pages['List of PlayStation 3 games (D–Z)']!.replace('</table>', `${row('Next Year Game', 'Unreleased', 'Unreleased', 'March 3, 2099')}</table>`);
    const csv = ['Title,Status,Release date', `"Uncharted: Drake's Fortune",Current,2007-11-19`, 'Limited Game,Current,2021', 'Afrika,Not required,', 'Maybe Disc,Unconfirmed,2010', ''].join('\n');
    const form = new FormData();
    form.append('file', new Blob([csv]), 'ps3.csv');
    const upload = await g.app.inject({ method: 'PUT', url: '/api/v1/catalogs/playstation-3/list', cookies, ...(await multipartBody(form)) });
    expect(upload.statusCode).toBe(202);
    expect(upload.json()).toEqual({ games: 4, problems: [] });
    await g.tasks.whenIdle();
    const entries = async () => ((await detail()).entries as { title: string; status: string; source: string }[]).map((e) => `${e.title}: ${e.status} (${e.source})`);
    // The list covers the games up to when it was made; Wikipedia adds only what came out after. A row the list marks
    // as not confirmed isn't evidence of a physical release: it waits, as any unconfirmed game does.
    expect(await entries()).toEqual(['Afrika: excluded (list)', 'Limited Game: missing (list)', 'Maybe Disc: unconfirmed (list)', 'Next Year Game: missing (wikipedia)', "Uncharted: Drake's Fortune: owned (list)"]);
    const [status] = (await g.app.inject({ url: '/api/v1/catalogs/sources', cookies })).json();
    expect(status.list).toMatchObject({ fileName: 'ps3.csv', games: 4 });
    expect(status.skipped.older).toBe(3);

    // Set to add every game the list doesn't have, Wikipedia's older games come in too.
    g.settings.update({ 'catalogs.listFill': 'all' });
    await build({ platforms: ['playstation-3'] });
    expect(await entries()).toEqual([
      'Afrika: excluded (list)',
      'Cars 2: The Video Game: review (wikipedia)',
      'Kiosk Demo Disc: review (wikipedia)',
      'Limited Game: missing (list)',
      'Maybe Disc: unconfirmed (list)',
      'Next Year Game: missing (wikipedia)',
      "Uncharted: Drake's Fortune: owned (list)",
      'Valkyria Chronicles: missing (wikipedia)',
    ]);

    // When Wikipedia can't be read, the list is still applied and Wikipedia's games stay as they were.
    delete fake.pages['List of PlayStation 3 games (A–C)'];
    delete fake.pages['List of PlayStation 3 games (D–Z)'];
    await build({ platforms: ['playstation-3'] });
    const [after] = (await g.app.inject({ url: '/api/v1/catalogs/sources', cookies })).json();
    expect(after.error).toMatch(/^Wikipedia couldn't be read .*your list was applied\.$/);
    expect((await detail()).entries).toHaveLength(8);

    // Without the list, the console goes back to Wikipedia alone.
    Object.assign(fake.pages, ps3Pages());
    expect((await g.app.inject({ method: 'DELETE', url: '/api/v1/catalogs/playstation-3/list', cookies })).statusCode).toBe(200);
    await g.tasks.whenIdle();
    expect(((await detail()).entries as { title: string; status: string }[]).map((e) => `${e.title}: ${e.status}`)).toEqual([
      'Afrika: owned',
      'Cars 2: The Video Game: review',
      'Kiosk Demo Disc: review',
      "Uncharted: Drake's Fortune: owned",
      'Valkyria Chronicles: missing',
    ]);
    const bad = new FormData();
    bad.append('file', new Blob(['Year,Price\n2001,5\n']), 'bad.csv');
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/catalogs/playstation-3/list', cookies, ...(await multipartBody(bad)) })).statusCode).toBe(400);
  });

  it('lets download titles count once shown physical', async () => {
    await start(x360Pages(), { owned: X360_OWNED });
    await build();
    // Xbox Live Arcade and Indie titles wait as not confirmed physical; owning one shows it had a disc.
    expect(await statuses('xbox-360')).toEqual({
      'Castle Crashers': 'owned',
      'Halo 3': 'owned',
      'Indie Thing': 'unconfirmed',
      'Kinect Adventures!': 'missing',
      Wreckateer: 'unconfirmed',
    });
    const entries = (await detail('xbox-360')).entries as Entry[];
    const wreckateer = entries.find((e) => e.title === 'Wreckateer')!;
    expect(wreckateer.notes).toBe('Wikipedia\'s list marks it as a download title ("Xbox Live Arcade titles")');
    expect(entries.find((e) => e.title === 'Halo 3')!.notes).toBeNull();
    expect((await detail('xbox-360')).counts).toMatchObject({ owned: 2, missing: 1, unconfirmed: 2 });
    expect((await sources()).find((s) => s.key === 'xbox-360')).toMatchObject({ downloads: 3, skipped: { download: 0 } });

    // "It's physical" makes one count, and a rebuild keeps the answer.
    await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${wreckateer.id}`, cookies, payload: { targetStatus: 'required' } });
    await build({ platforms: ['xbox-360'] });
    expect((await statuses('xbox-360')).Wreckateer).toBe('missing');

    // Set to leave download titles out, only the one answered about stays.
    g.settings.update({ 'catalogs.downloadTitles': 'skip' });
    await build({ platforms: ['xbox-360'] });
    expect(await statuses('xbox-360')).toEqual({ 'Halo 3': 'owned', 'Kinect Adventures!': 'missing', Wreckateer: 'missing' });
    expect((await sources()).find((s) => s.key === 'xbox-360')).toMatchObject({ downloads: 0, skipped: { download: 3 } });

    // Set to count them like other games, every one is a target again.
    g.settings.update({ 'catalogs.downloadTitles': 'count' });
    await build({ platforms: ['xbox-360'] });
    expect(await statuses('xbox-360')).toEqual({ 'Castle Crashers': 'owned', 'Halo 3': 'owned', 'Indie Thing': 'missing', 'Kinect Adventures!': 'missing', Wreckateer: 'missing' });
    expect(((await detail('xbox-360')).entries as Entry[]).every((e) => e.notes === null)).toBe(true);
  });

  it("checks the articles of a list that doesn't mark all its download games", async () => {
    const pages = ps3Pages();
    pages['List of PlayStation 3 games (D–Z)'] = pages['List of PlayStation 3 games (D–Z)'].replace(
      '</table>',
      `${row('<a href="/wiki/Tiny_Brains">Tiny Brains</a>', 'Unreleased', 'December 18, 2013', 'January 7, 2014')}
       ${row('<a href="/wiki/Stealth_Inc">Stealth Inc: A Clone in the Dark</a>', 'August 26, 2014', 'July 24, 2013', 'July 23, 2013')}
       ${row('<a href="/wiki/Resistance_3">Resistance 3</a>', 'September 8, 2011', 'September 9, 2011', 'September 6, 2011', 'M')}
       ${row('<a href="/wiki/Japan_Only_Game">Japan Only Game</a>', 'March 1, 2010', 'Unreleased', 'Unreleased')}
      </table>`,
    );
    // The part with the key (each part has its own) also has a download-only game.
    const cars = row('Cars 2: The Video Game', 'Unreleased', 'July 2011', 'June 21, 2011');
    pages['List of PlayStation 3 games (A–C)'] = pages['List of PlayStation 3 games (A–C)'].replace(
      cars,
      `${cars}${row('<a href="/wiki/Flow_(video_game)">flOw</a>', 'May 3, 2007', 'February 22, 2007', 'February 22, 2007', 'D')}`,
    );
    const fake = await start(pages, {
      articles: {
        categories: {
          'Tiny Brains': ['PlayStation Network games', 'PlayStation 3 games'],
          'Stealth Bastard': ['PlayStation Network games'],
          'Resistance 3': ['PlayStation 3 games'],
          'Flow (video game)': ['PlayStation Network games'],
          'Japan Only Game': ['PlayStation Network games'],
        },
        redirects: { 'Stealth Inc': 'Stealth Bastard' },
      },
    });
    await build();
    // The page marks none of the new ones; the PlayStation Network category (Settings > Catalogs and matching) finds two, one through a redirect.
    const found = await statuses();
    expect(found).toMatchObject({ 'Tiny Brains': 'unconfirmed', 'Stealth Inc: A Clone in the Dark': 'unconfirmed', 'Resistance 3': 'missing', 'Valkyria Chronicles': 'missing' });
    expect(found.flOw).toBeUndefined();
    expect(found['Japan Only Game']).toBeUndefined();
    expect(((await detail()).entries as Entry[]).find((e) => e.title === 'Tiny Brains')!.notes).toBe('Its Wikipedia article is in the category "PlayStation Network games"');
    // One question, about the linked games that would otherwise count (not the download-only one or the Japanese one).
    expect(fake.calls.filter((c) => c.categories !== undefined)).toEqual([
      expect.objectContaining({ titles: 'Tiny Brains|Stealth Inc|Resistance 3', categories: 'Category:PlayStation Network games', agent: expect.stringMatching(/^Squirrelcade\//) }),
    ]);

    // Without categories for the console, nothing is asked and the games count as the list has them.
    g.settings.update({ 'catalogs.downloadCategories': [] });
    await build({ platforms: ['playstation-3'] });
    expect(fake.calls.filter((c) => c.categories !== undefined)).toHaveLength(1);
    expect((await statuses())['Tiny Brains']).toBe('missing');
    expect(((await detail()).entries as Entry[]).find((e) => e.title === 'Tiny Brains')!.notes).toBeNull();
  });

  it('asks for a collection before building', async () => {
    g = await testApp({ wikipediaFetch: fakeWikipedia({}).fetch });
    cookies = await setUp(g);
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/build', cookies, payload: {} });
    expect(res.statusCode).toBe(400);
  });
});

describe('catalog sources in your order', () => {
  const switch2Page = `<h2>List</h2><table class="wikitable sortable">${HEAD}${row('Mario Kart World', 'June 5, 2025', 'June 5, 2025', 'June 5, 2025')}${row('Hela', 'Unreleased', 'November 5, 2099', 'November 5, 2099')}</table>`;
  /** Shaped like Nintendo Life's two guides: the confirmed Game-Key Cards, and the games with the full game on the card. */
  const nintendoLife = {
    key: `<h2>Confirmed Switch 2 Game-Key Cards List</h2><ul class="games"><li><a href="games/nintendo-switch-2/borderlands-4">Borderlands 4</a> (Switch 2)<br /><em>TBA / 2K Games</em></li><li><a href="games/nintendo-switch-2/monster-hunter-wilds">Monster Hunter Wilds</a> (Switch 2)<br /><em>TBA / Capcom</em></li></ul>`,
    full: `<h2>Confirmed &#039;Real&#039; Nintendo Switch 2 Physical Games</h2><ul class="games"><li><a href="games/nintendo-switch-2/mario-kart-world">Mario Kart World</a> (Switch 2)<br /><em>5th Jun 2025 / Nintendo</em></li></ul>`,
  };
  const order = (...ids: string[]) => ids.map((id) => ({ id: id.replace(/^!/, ''), on: !id.startsWith('!') }));
  const games = async () =>
    Object.fromEntries(((await detail('nintendo-switch-2')).entries as { title: string; format: string | null; source: string }[]).map((e) => [e.title, `${e.format ?? '-'} (${e.source})`]));

  it("builds a console's catalog from its sources in your order, and shows where they disagree", async () => {
    const wiki = fakeWikipedia({ 'List of Nintendo Switch 2 games': switch2Page });
    const agents: string[] = [];
    g = await testApp({
      wikipediaFetch: wiki.fetch,
      nintendoLifeFetch: async (url, init) => {
        agents.push(new Headers(init?.headers).get('user-agent') ?? '');
        return new Response(url.includes('game-key-card') ? nintendoLife.key : nintendoLife.full);
      },
    });
    cookies = await setUp(g);
    g.settings.update({ 'sources.catalogOrder': order('list', 'nintendo-life', 'wikipedia') });
    const form = new FormData();
    form.append('file', new Blob([['Title,Format,Release date', 'Borderlands 4,Full Game Card,TBA', 'Mario Kart World,Full Game Card,2025-06-05', ''].join('\n')]), 'switch2.csv');
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/catalogs/nintendo-switch-2/list', cookies, ...(await multipartBody(form)) })).statusCode).toBe(202);
    await g.tasks.whenIdle();
    // Your list's games; after it, Nintendo Life brings an announced game and Wikipedia a newer one.
    expect(await games()).toEqual({
      'Borderlands 4': 'Full Game Card (list)',
      Hela: '- (wikipedia)',
      'Mario Kart World': 'Full Game Card (list)',
      'Monster Hunter Wilds': 'Game-Key Card (nintendo-life)',
    });
    const status = (await sources()).find((s) => s.key === 'nintendo-switch-2') as unknown as { sources: { id: string; added: number }[]; conflicts: unknown[] };
    expect(status.sources.map((s) => `${s.id} +${s.added}`)).toEqual(['list +2', 'nintendo-life +1', 'wikipedia +1']);
    // Your list says Borderlands 4 has the full game on the card, Nintendo Life says Game-Key Card: your list is higher.
    expect(status.conflicts).toEqual([{ title: 'Borderlands 4', fact: 'format', kept: { source: 'list', value: 'Full Game Card' }, other: { source: 'nintendo-life', value: 'Game-Key Card' } }]);
    expect(agents).toHaveLength(2);
    expect(agents[0]).toMatch(/^Squirrelcade\//);

    // Trusting Nintendo Life more turns the difference its way; turning it off takes away the game only it brought.
    g.settings.update({ 'sources.catalogOrder': order('nintendo-life', 'list', 'wikipedia') });
    await build({ platforms: ['nintendo-switch-2'] });
    expect((await games())['Borderlands 4']).toBe('Game-Key Card (nintendo-life)');
    g.settings.update({ 'sources.catalogOrder': order('list', '!nintendo-life', 'wikipedia') });
    await build({ platforms: ['nintendo-switch-2'] });
    expect(await games()).not.toHaveProperty('Monster Hunter Wilds');
    expect((await games())['Borderlands 4']).toBe('Full Game Card (list)');
    // Read once a day at most.
    expect(agents).toHaveLength(2);
  });

  it('trusts a source first for one fact when the settings say so', async () => {
    g = await testApp({
      wikipediaFetch: fakeWikipedia({ 'List of Nintendo Switch 2 games': switch2Page }).fetch,
      nintendoLifeFetch: async (url) => new Response(url.includes('game-key-card') ? nintendoLife.key : nintendoLife.full),
    });
    cookies = await setUp(g);
    g.settings.update({ 'sources.catalogOrder': order('list', 'nintendo-life', 'wikipedia'), 'sources.formatsFrom': 'nintendo-life' });
    const form = new FormData();
    form.append('file', new Blob([['Title,Format,Release date', 'Borderlands 4,Full Game Card,TBA', ''].join('\n')]), 'switch2.csv');
    await g.app.inject({ method: 'PUT', url: '/api/v1/catalogs/nintendo-switch-2/list', cookies, ...(await multipartBody(form)) });
    await g.tasks.whenIdle();
    // Your list stays first and brings the game; its format comes from Nintendo Life, trusted first for formats.
    expect((await games())['Borderlands 4']).toBe('Game-Key Card (list)');
    const status = (await sources()).find((s) => s.key === 'nintendo-switch-2') as unknown as { conflicts: unknown[] };
    expect(status.conflicts).toEqual([{ title: 'Borderlands 4', fact: 'format', kept: { source: 'nintendo-life', value: 'Game-Key Card' }, other: { source: 'list', value: 'Full Game Card' } }]);
  });

  it("keeps Nintendo Life's last lists when it can't be read", async () => {
    let up = true;
    g = await testApp({
      wikipediaFetch: fakeWikipedia({ 'List of Nintendo Switch 2 games': switch2Page }).fetch,
      nintendoLifeFetch: async (url) => (up ? new Response(url.includes('game-key-card') ? nintendoLife.key : nintendoLife.full) : new Response('<h2>Something else</h2>')),
    });
    cookies = await setUp(g);
    g.settings.update({ 'sources.catalogOrder': order('nintendo-life', 'wikipedia', 'list') });
    await build({ platforms: ['nintendo-switch-2'] });
    expect(Object.keys((await g.app.inject({ url: '/api/v1/catalogs/source-status', cookies })).json())).toEqual(['list', 'nintendo-life', 'wikipedia']);
    // A day later the page has changed: the reading fails, and the games it gave stay.
    up = false;
    const old = JSON.parse(g.db.select().from(appState).where(eq(appState.key, 'source.nintendo-life')).get()!.value);
    g.db.update(appState).set({ value: JSON.stringify({ ...old, readAt: '2020-01-01T00:00:00.000Z', attemptedAt: '2020-01-01T00:00:00.000Z' }) }).where(eq(appState.key, 'source.nintendo-life')).run();
    await build({ platforms: ['nintendo-switch-2'] });
    const status = (await g.app.inject({ url: '/api/v1/catalogs/source-status', cookies })).json()['nintendo-life'];
    expect(status.error).toMatch(/no list of confirmed games/);
    expect(status.summary).toMatch(/^2 Game-Key Cards and 1 full-card games/);
    expect(await games()).toHaveProperty('Monster Hunter Wilds');
  });
});

describe('games you own that your list lacks', () => {
  it('come in from the other sources whatever their date, unless turned off', async () => {
    await start(ps3Pages(), { owned: [...PS3_OWNED, ['7', 'Valkyria Chronicles', 'Playstation 3']] });
    const form = new FormData();
    form.append('file', new Blob([['Title,Status', `"Uncharted: Drake's Fortune",Current`, 'Afrika,Current', ''].join('\n')]), 'ps3.csv');
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/catalogs/playstation-3/list', cookies, ...(await multipartBody(form)) })).statusCode).toBe(202);
    await g.tasks.whenIdle();
    const entries = async () => ((await detail()).entries as { title: string; status: string; source: string }[]).map((e) => `${e.title}: ${e.status} (${e.source})`);
    // Wikipedia's Valkyria Chronicles is older than the list, but owned: it comes in, counted; Cars 2: The Video Game,
    // owned only by a look-alike title, doesn't.
    expect(await entries()).toEqual(['Afrika: owned (list)', "Uncharted: Drake's Fortune: owned (list)", 'Valkyria Chronicles: owned (wikipedia)']);
    g.settings.update({ 'catalogs.ownedUnderList': false });
    await build({ platforms: ['playstation-3'] });
    expect(await entries()).toEqual(['Afrika: owned (list)', "Uncharted: Drake's Fortune: owned (list)"]);
  });
});

describe('catalog sources you add', () => {
  const entries = async () => ((await detail()).entries as { title: string; status: string; source: string }[]).map((e) => `${e.title}: ${e.status} (${e.source})`);

  it('adds an online list and a CSV file as sources of their own, read into games by console', async () => {
    const online = ['Title,Platform,Region', 'Euro Exclusive,PlayStation 3,PAL', `"Uncharted: Drake's Fortune",PS3,`, 'Switch Only,Nintendo Switch,'].join('\n');
    let up = true;
    g = await testApp({ wikipediaFetch: fakeWikipedia(ps3Pages()).fetch, listFetch: async () => (up ? new Response(online, { headers: { 'content-type': 'text/csv' } }) : new Response('', { status: 503 })) });
    cookies = await setUp(g);
    seedCatalogs(g, { owned: PS3_OWNED, catalogs: {} });
    await build();

    // First what the list has, then added: at the bottom of the order, its consoles' catalogs rebuilt (PS3; the Switch isn't collected).
    const preview = await g.app.inject({ method: 'POST', url: '/api/v1/catalog-sources/preview', cookies, payload: { url: 'https://example.com/list.csv' } });
    expect(preview.json()).toMatchObject({ usable: true, games: 3, consoleColumn: true, consoles: [{ key: 'playstation-3', games: 2 }, { key: 'nintendo-switch', games: 1 }], regions: { europe: 1, none: 2 } });
    const add = await g.app.inject({ method: 'POST', url: '/api/v1/catalog-sources', cookies, payload: { url: 'https://example.com/list.csv', name: 'Community list' } });
    expect(add.statusCode).toBe(201);
    expect(add.json()).toMatchObject({ id: 'added-1', name: 'Community list', kind: 'link', counts: 'complete', games: 3 });
    await g.tasks.whenIdle();
    expect((await entries()).filter((e) => /Euro Exclusive|Switch Only/.test(e))).toEqual(['Euro Exclusive: missing (added-1)']);

    // Its games can count once owned instead, as other regions' releases do: neither missing nor counted.
    expect((await g.app.inject({ method: 'PATCH', url: '/api/v1/catalog-sources/added-1', cookies, payload: { counts: 'owned' } })).json()).toMatchObject({ counts: 'owned' });
    await g.tasks.whenIdle();
    expect((await entries()).filter((e) => e.includes('Euro Exclusive'))).toEqual(['Euro Exclusive: extra (added-1)']);

    // A file without a console column, for the console chosen (the form's fields before its file).
    const form = new FormData();
    form.append('platform', 'playstation-3');
    form.append('name', 'My PAL file');
    form.append('file', new Blob(['Game\nFile Game\n']), 'pal.csv');
    const file = await g.app.inject({ method: 'POST', url: '/api/v1/catalog-sources', cookies, ...(await multipartBody(form)) });
    expect(file.statusCode).toBe(201);
    expect(file.json()).toMatchObject({ id: 'added-2', name: 'My PAL file', kind: 'file', fileName: 'pal.csv', platformKey: 'playstation-3', games: 1 });
    await g.tasks.whenIdle();
    expect((await entries()).filter((e) => e.includes('File Game'))).toEqual(['File Game: missing (added-2)']);

    // An online list that can't be read again keeps its games and says why, on the Sources page too.
    up = false;
    const again = await g.app.inject({ method: 'POST', url: '/api/v1/catalog-sources/added-1/read', cookies });
    expect(again.statusCode).toBe(400);
    expect(again.json().message).toBe('The address answered 503.');
    expect((await g.app.inject({ url: '/api/v1/catalog-sources', cookies })).json()).toMatchObject([
      { id: 'added-1', games: 3, error: 'The address answered 503.' },
      { id: 'added-2', games: 1, error: null },
    ]);
    const status = (await g.app.inject({ url: '/api/v1/catalogs/source-status', cookies })).json();
    expect(status['added-1']).toMatchObject({ summary: '3 games: PlayStation 3 2, Nintendo Switch 1.', error: 'The address answered 503.' });

    // Removed, its games leave the catalog; the other source's stay.
    expect((await g.app.inject({ method: 'DELETE', url: '/api/v1/catalog-sources/added-1', cookies })).statusCode).toBe(200);
    await g.tasks.whenIdle();
    expect((await entries()).filter((e) => /Euro Exclusive|File Game/.test(e))).toEqual(['File Game: missing (added-2)']);
  });

  it("says why a list can't be used", async () => {
    const page = (body: string) => new Response(`<html><body>${body}</body></html>`, { headers: { 'content-type': 'text/html' } });
    g = await testApp({ wikipediaFetch: fakeWikipedia({}).fetch, listFetch: async (url) => (url.includes('docs.google.com') ? page('Sign in') : url.includes('nocolumn') ? new Response('Game\nPikmin 4\n') : page('<p>Nothing</p>')) });
    cookies = await setUp(g);
    const preview = (url: string) => g.app.inject({ method: 'POST', url: '/api/v1/catalog-sources/preview', cookies, payload: { url } });
    expect((await preview('https://docs.google.com/spreadsheets/d/abc/edit')).json().message).toMatch(/^Google answered with its sign-in page/);
    expect((await preview('https://example.com/page')).json().message).toMatch(/^No table of games was found there/);
    expect((await preview('ftp://example.com/x.csv')).json().message).toBe('Only http and https addresses can be read.');
    expect((await preview('not an address')).json().message).toMatch(/^That isn't a web address/);
    // Without a console column it waits for the console to be chosen, and can't be added until then.
    expect((await preview('https://example.com/nocolumn.csv')).json()).toMatchObject({ usable: false, consoleColumn: false, problems: ['It has no console column (Platform, Console or System): choose the console it is for.'] });
    const add = await g.app.inject({ method: 'POST', url: '/api/v1/catalog-sources', cookies, payload: { url: 'https://example.com/nocolumn.csv' } });
    expect(add.statusCode).toBe(400);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/catalog-sources/preview', cookies, payload: { url: 'https://example.com/nocolumn.csv', platform: 'nintendo-switch' } })).json()).toMatchObject({ usable: true, games: 1 });
  });
});
