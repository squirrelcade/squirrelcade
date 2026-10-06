import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SourceEntry } from './catalogs.js';
import { igdbGames, platforms } from './db/schema.js';
import { csvLines, exportCsv, multipart, seedCatalogs, setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

const PS3: SourceEntry[] = [
  ...['Uncharted', 'Mass Effect', 'Mass Effect 2', 'Cars 2: The Video Game', 'Katamari Forever', 'Flower', 'Kiosk Demo'].map((title) => ({ title, format: 'Game Disc' })),
  { title: 'Odd Import', format: 'Game Disc', targetStatus: 'review' },
  { title: 'Store Display', format: 'Game Disc', targetStatus: 'excluded' },
];

/** A collection, the PS3 catalog as a catalog source lists it, a compilation and two exclusions. */
function load() {
  seedCatalogs(g, {
    owned: [
      ['1', 'Uncharted [Greatest Hits]', 'Playstation 3'],
      ['2', 'Mass Effect Trilogy', 'Playstation 3'],
      ['3', 'Cars 2', 'Playstation 3'],
      ['4', 'Katamari Forever', 'PAL Playstation 3'],
      ['5', 'Demo Disc Collection', 'Playstation 3'],
      ['6', 'Journey Collectors Edition', 'Playstation 3'],
    ],
    catalogs: { 'playstation-3': PS3 },
    mappings: [
      { platform: 'playstation-3', owned: 'Mass Effect Trilogy', satisfies: 'Mass Effect' },
      { platform: 'playstation-3', owned: 'Mass Effect Trilogy', satisfies: 'Mass Effect 2' },
    ],
    exclusions: [
      { platform: 'playstation-3', title: 'Kiosk Demo', action: 'exclude' },
      { platform: 'playstation-3', title: 'Flower', action: 'below-price', belowCents: 1000 },
    ],
  });
}

describe('catalogs', () => {
  it('builds the catalog and works out completion', async () => {
    load();
    const summary = (await g.app.inject({ url: '/api/v1/catalogs', cookies })).json();
    // Owned: Uncharted (edition), Mass Effect + 2 (compilation), Katamari (a PAL copy counts). Review: Cars 2 look-alike,
    // Odd Import. Missing: Flower. Excluded: Kiosk Demo (ignore list), Store Display (not required).
    expect(summary[0]).toMatchObject({ key: 'playstation-3', targets: 9, owned: 4, review: 2, missing: 1, excluded: 2, percent: 57.1 });

    const detail = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?status=review', cookies })).json();
    const cars = detail.entries.find((e: { title: string }) => e.title === 'Cars 2: The Video Game');
    expect(cars.suggestions).toEqual([expect.objectContaining({ productId: '3', title: 'Cars 2' })]);
    const all = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3', cookies })).json();
    expect(all.notInCatalog.map((p: { title: string }) => p.title).sort()).toEqual(['Cars 2', 'Demo Disc Collection', 'Journey Collectors Edition']);
  });

  it('tells which release each owned copy is, and filters the collection by region', async () => {
    load();
    const owned = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?status=owned', cookies })).json();
    const matchOf = (title: string) => owned.entries.find((e: { title: string }) => e.title === title).matches[0];
    expect(matchOf('Katamari Forever')).toMatchObject({ productId: '4', region: 'europe', consoleLabel: 'PAL Playstation 3' });
    expect(matchOf('Uncharted')).toMatchObject({ region: 'north-america', consoleLabel: 'Playstation 3' });
    // The console's games per release, the most copies first, and the owned games outside the catalog with theirs.
    expect(owned.regions).toEqual([
      { region: 'north-america', consoleLabel: 'Playstation 3', games: 5, copies: 5 },
      { region: 'europe', consoleLabel: 'PAL Playstation 3', games: 1, copies: 1 },
    ]);
    expect(owned.notInCatalog[0]).toMatchObject({ region: 'north-america', consoleLabel: 'Playstation 3' });

    const pal = (await g.app.inject({ url: '/api/v1/collection/items?region=europe', cookies })).json();
    expect(pal).toMatchObject({ total: 1, items: [{ title: 'Katamari Forever', region: 'europe', consoleLabel: 'PAL Playstation 3' }] });
    // Store Mode says which release the owned copy is.
    const store = (await g.app.inject({ url: '/api/v1/lookup?q=katamari', cookies })).json();
    expect(store[0]).toMatchObject({ answer: 'own', ownedReleases: [{ region: 'europe', consoleLabel: 'PAL Playstation 3' }] });
  });

  it('takes ownership mappings from a CSV: compilations count for their games, conditional ones wait for review', async () => {
    seedCatalogs(g, {
      owned: [
        ['1', 'Uncharted & Uncharted 2 Dual Pack', 'Playstation 3'],
        ['2', 'Far Cry Compilation', 'Playstation 3'],
      ],
      catalogs: { 'playstation-3': ["Uncharted: Drake's Fortune", 'Uncharted 2: Among Thieves', 'Far Cry 3: Blood Dragon', 'Flower'] },
    });
    const status = async () =>
      Object.fromEntries(((await g.app.inject({ url: '/api/v1/catalogs/playstation-3', cookies })).json().entries as { title: string; status: string }[]).map((e) => [e.title, e.status]));
    expect((await status())["Uncharted: Drake's Fortune"]).toBe('missing');
    const csv = [
      'Owned Physical Title,Satisfies Canonical Title,Mapping Type,Counts as Complete',
      "Uncharted & Uncharted 2 Dual Pack,Uncharted: Drake's Fortune,Compilation,Yes",
      'Uncharted & Uncharted 2 Dual Pack,Uncharted 2: Among Thieves,Compilation,Yes',
      'Far Cry Compilation,Far Cry 3: Blood Dragon,Conditional compilation,Conditional',
    ].join('\n');
    const res = await g.app.inject({ method: 'PUT', url: '/api/v1/catalogs/playstation-3/mappings', cookies, ...multipart('PS3 Ownership Mappings.csv', csv) });
    expect(res.json()).toEqual({ mappings: 3, problems: [] });
    expect(await status()).toEqual({ "Uncharted: Drake's Fortune": 'owned', 'Uncharted 2: Among Thieves': 'owned', 'Far Cry 3: Blood Dragon': 'review', Flower: 'missing' });
    const sources = (await g.app.inject({ url: '/api/v1/catalogs/sources', cookies })).json();
    expect(sources.find((s: { key: string }) => s.key === 'playstation-3').mappings).toBe(3);
    // A console list isn't a mappings file; removing the mappings undoes them.
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/catalogs/playstation-3/mappings', cookies, ...multipart('list.csv', 'Title\nFlower') })).statusCode).toBe(400);
    expect((await g.app.inject({ method: 'DELETE', url: '/api/v1/catalogs/playstation-3/mappings', cookies })).json()).toEqual({ removed: true });
    expect((await status())["Uncharted: Drake's Fortune"]).toBe('missing');
  });

  it("sorts a console's games by score, genre or release date, either way", async () => {
    load();
    const titles = async (query: string) =>
      ((await g.app.inject({ url: `/api/v1/catalogs/playstation-3?status=missing${query}`, cookies })).json().entries as { title: string; wishlist: { score: number } | null; genres: string[] }[]);
    const byScore = await titles('&sort=score&dir=desc');
    const scores = byScore.map((e) => e.wishlist?.score ?? -1);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect((await titles('&sort=score&dir=asc')).map((e) => e.title)).toEqual([...byScore].reverse().map((e) => e.title));
    // Every game carries its genres (none here: no IGDB data), and a title sort is the default.
    expect(byScore.every((e) => Array.isArray(e.genres))).toBe(true);
    expect((await titles('')).map((e) => e.title)).toEqual((await titles('&sort=title&dir=asc')).map((e) => e.title));
  });

  it('remembers review answers and can undo them', async () => {
    load();
    const detail = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=cars', cookies })).json();
    const entryId = detail.entries[0].id;
    await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/decisions', cookies, payload: { entryId, productId: '3', decision: 'confirmed' } });
    let cars = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=cars', cookies })).json().entries[0];
    expect(cars).toMatchObject({ status: 'owned', matches: [{ method: 'confirmed' }] });

    await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/decisions', cookies, payload: { entryId, productId: '3', decision: 'rejected' } });
    cars = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=cars', cookies })).json().entries[0];
    expect(cars.status).toBe('missing');

    await g.app.inject({ method: 'DELETE', url: '/api/v1/catalogs/decisions', cookies, payload: { entryId, productId: '3' } });
    cars = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=cars', cookies })).json().entries[0];
    expect(cars.status).toBe('review');
  });

  it('keeps the answers when the catalog source changes', async () => {
    load();
    const entry = async (q: string) => (await g.app.inject({ url: `/api/v1/catalogs/playstation-3?q=${q}`, cookies })).json().entries[0];
    const cars = await entry('cars');
    await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/decisions', cookies, payload: { entryId: cars.id, productId: '3', decision: 'confirmed' } });
    const odd = await entry('odd');
    await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${odd.id}`, cookies, payload: { targetStatus: 'required' } });
    const flower = await entry('flower');
    await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${flower.id}`, cookies, payload: { targetStatus: 'excluded' } });

    // The same list again changes nothing.
    expect(g.catalogs.syncSource('playstation-3', 'test', PS3)).toEqual({ added: 0, updated: 9, removed: 0, kept: 0 });
    expect(await entry('cars')).toMatchObject({ id: cars.id, status: 'owned' });

    // A shorter list: games the user answered about stay, the rest go; the user's own status wins over the source's.
    const result = g.catalogs.syncSource('playstation-3', 'test', [{ title: 'Uncharted' }, { title: 'Flower' }, { title: 'Brand New Game' }]);
    expect(result).toEqual({ added: 1, updated: 2, removed: 5, kept: 2 });
    expect(await entry('cars')).toMatchObject({ id: cars.id, status: 'owned' });
    expect(await entry('odd')).toMatchObject({ id: odd.id, status: 'missing', targetStatus: 'required' });
    expect(await entry('flower')).toMatchObject({ id: flower.id, status: 'excluded' });
    expect(await entry('katamari')).toBeUndefined();
    expect(g.catalogs.syncSource('nope', 'test', [])).toBeNull();
  });

  it('can hold a catalog for a console nobody owns games for yet', async () => {
    load();
    expect(g.catalogs.syncSource('sega-saturn', 'test', [{ title: 'Panzer Dragoon Saga' }])).toMatchObject({ added: 1 });
    const saturn = (await g.app.inject({ url: '/api/v1/catalogs', cookies })).json().find((p: { key: string }) => p.key === 'sega-saturn');
    expect(saturn).toMatchObject({ targets: 1, missing: 1, owned: 0 });
  });

  it('counts a game on a console with download-only games only with evidence it had a physical release', async () => {
    seedCatalogs(g, {
      owned: [['1', 'Owned Game', 'Nintendo Switch']],
      catalogs: {
        'nintendo-switch': [
          { title: 'Listed Only', source: 'wikipedia' },
          { title: 'On My List', source: 'list', evidence: 'list' },
          { title: 'Owned Game', source: 'wikipedia' },
          { title: 'Special Release', source: 'wikipedia', targetStatus: 'review' },
        ],
      },
    });
    const status = async () =>
      Object.fromEntries(((await g.app.inject({ url: '/api/v1/catalogs/nintendo-switch?all=1', cookies })).json().entries as { title: string; status: string }[]).map((e) => [e.title, e.status]));
    expect(await status()).toEqual({ 'Listed Only': 'unconfirmed', 'On My List': 'missing', 'Owned Game': 'owned', 'Special Release': 'review' });
    const switchSummary = (await g.app.inject({ url: '/api/v1/catalogs', cookies })).json().find((p: { key: string }) => p.key === 'nintendo-switch');
    // 1 owned of the 2 that count: the unconfirmed game is left out of completion.
    expect(switchSummary).toMatchObject({ targets: 4, owned: 1, missing: 1, review: 1, unconfirmed: 1, percent: 33.3 });

    // Confirming it (the user's own target status) makes it count; a game added by hand counts at once.
    const listed = (await g.app.inject({ url: '/api/v1/catalogs/nintendo-switch?q=listed', cookies })).json().entries[0];
    await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${listed.id}`, cookies, payload: { targetStatus: 'required' } });
    await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/nintendo-switch/entries', cookies, payload: { title: 'Added By Hand' } });
    expect(await status()).toMatchObject({ 'Listed Only': 'missing', 'Added By Hand': 'missing' });

    // Consoles whose lists are retail games don't need the evidence.
    g.settings.update({ 'catalogs.mixedListPlatforms': [] });
    expect((await status())['Special Release']).toBe('review');
  });

  it('follows the matching settings', async () => {
    load();
    const katamari = async () => (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=katamari', cookies })).json().entries[0].status;
    const uncharted = async () => (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=uncharted', cookies })).json().entries[0].status;
    expect(await katamari()).toBe('owned');
    g.settings.update({ 'catalogs.otherRegionsCount': false });
    expect(await katamari()).toBe('missing');
    expect(await uncharted()).toBe('owned');
    g.settings.update({ 'catalogs.variantsSatisfy': false, 'catalogs.suggestMatches': false });
    expect(await uncharted()).toBe('missing');
  });

  it('keeps upcoming games apart and leaves Game-Key Cards out when the settings say so', () => {
    const listed = { evidence: 'list' as const };
    seedCatalogs(g, {
      owned: [['1', 'Mario Kart World', 'Nintendo Switch 2']],
      catalogs: {
        'nintendo-switch-2': [
          { title: 'Mario Kart World', releaseDate: '2025-06-05', format: 'Full Game Card', ...listed },
          { title: 'Far Future Game', releaseDate: '2099-01', ...listed },
          { title: 'Undated Game', releaseDate: 'TBA', ...listed },
          { title: 'Key Card Game', releaseDate: '2025-07-01', format: 'Game-Key Card', ...listed },
        ],
      },
    });
    const statuses = () => Object.fromEntries(g.catalogs.titles('nintendo-switch-2')!.map((t) => [t.title, t.status]));
    // By default both count: upcoming games are missing, Game-Key Cards are games like the rest.
    expect(statuses()).toEqual({ 'Mario Kart World': 'owned', 'Far Future Game': 'missing', 'Undated Game': 'missing', 'Key Card Game': 'missing' });
    g.settings.update({ 'catalogs.upcomingCount': false, 'catalogs.gameKeyCards': false });
    expect(statuses()).toEqual({ 'Mario Kart World': 'owned', 'Far Future Game': 'upcoming', 'Undated Game': 'upcoming', 'Key Card Game': 'excluded' });
    expect(g.catalogs.summary().find((c) => c.key === 'nintendo-switch-2')).toMatchObject({ upcoming: 2, excluded: 1, missing: 0, percent: 100 });
    expect(g.wishlist.compute().master.some((c) => c.platformKey === 'nintendo-switch-2')).toBe(false);
  });

  it('counts a cross-generation game owned on the console before or after it, within the years, unless turned off', () => {
    const listed = { evidence: 'list' as const };
    seedCatalogs(g, {
      owned: [
        ['1', 'Hollow Knight: Silksong', 'Nintendo Switch 2'],
        ['2', 'Old Port', 'Nintendo Switch 2'],
      ],
      catalogs: {
        'nintendo-switch': [
          { title: 'Hollow Knight: Silksong', releaseDate: '2025-09-04', ...listed },
          { title: 'Old Port', releaseDate: '2018-01-01', ...listed },
          { title: 'Only On Switch', releaseDate: '2020-01-01', ...listed },
        ],
        'nintendo-switch-2': [
          { title: 'Hollow Knight: Silksong', releaseDate: '2025-09-04', ...listed },
          { title: 'Old Port', releaseDate: '2026-01-01', ...listed },
        ],
      },
    });
    const statuses = (key: string) => Object.fromEntries(g.catalogs.titles(key)!.map((t) => [t.title, t.status]));
    // On by default: Silksong on Switch 2 covers its Switch version, saying where; a port eight years later doesn't.
    expect(statuses('nintendo-switch')).toEqual({ 'Hollow Knight: Silksong': 'owned', 'Old Port': 'missing', 'Only On Switch': 'missing' });
    expect(g.catalogs.matchOf('nintendo-switch')!.targets.find((t) => t.target.title === 'Hollow Knight: Silksong')!.via).toMatch(/Switch 2/);
    expect(statuses('nintendo-switch-2')).toEqual({ 'Hollow Knight: Silksong': 'owned', 'Old Port': 'owned' });
    // Any years apart: the port counts too.
    g.settings.update({ 'catalogs.crossGenYears': 0 });
    expect(statuses('nintendo-switch')['Old Port']).toBe('owned');
    // Off: each version counts only on its own console.
    g.settings.update({ 'catalogs.crossGen': false });
    expect(statuses('nintendo-switch')).toEqual({ 'Hollow Knight: Silksong': 'missing', 'Old Port': 'missing', 'Only On Switch': 'missing' });
  });

  it("doesn't let a copy count for another game through an other name IGDB gives both", () => {
    seedCatalogs(g, {
      owned: [['1', 'Rune Factory: Guardians Of Azuma', 'Nintendo Switch 2']],
      catalogs: {
        'nintendo-switch': [{ title: 'Marvel Cosmic Invasion', evidence: 'list' }],
        'nintendo-switch-2': [
          { title: 'Rune Factory: Guardians of Azuma', releaseDate: '2025-06-05', evidence: 'list' },
          { title: 'Marvel Cosmic Invasion', releaseDate: '2025-12-01', evidence: 'list' },
        ],
      },
    });
    // IGDB has "Game.exe" as another name of both games, on both consoles.
    for (const key of ['nintendo-switch', 'nintendo-switch-2']) {
      const platformId = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, key)).get()!.id;
      const game = (id: number, name: string) => ({ platformId, igdbId: id, data: JSON.stringify({ id, name, altNames: [`${name.toUpperCase()}`, 'Game.exe'], coverId: null, genres: [], themes: [], perspectives: [], franchise: null, japanese: null, released: '2025-06-05', gameType: 'Main Game' }) });
      g.db.insert(igdbGames).values([game(250922, 'Rune Factory: Guardians of Azuma'), game(337035, 'Marvel Cosmic Invasion')]).run();
    }
    g.settings.update({ 'features.igdb': true });
    const statuses = (key: string) => Object.fromEntries(g.catalogs.titles(key)!.map((t) => [t.title, t.status]));
    expect(statuses('nintendo-switch-2')).toEqual({ 'Rune Factory: Guardians of Azuma': 'owned', 'Marvel Cosmic Invasion': 'missing' });
    expect(statuses('nintendo-switch')).toEqual({ 'Marvel Cosmic Invasion': 'missing' });
  });

  it('gathers the review questions of every console in one queue', async () => {
    load();
    const queue = (await g.app.inject({ url: '/api/v1/review', cookies })).json();
    expect(queue.lookAlikes).toEqual([
      { platformKey: 'playstation-3', platform: 'PlayStation 3', entryId: expect.any(Number), title: 'Cars 2: The Video Game', suggestions: [expect.objectContaining({ productId: '3', title: 'Cars 2' })] },
    ]);
    expect(queue.marked).toEqual([{ platformKey: 'playstation-3', platform: 'PlayStation 3', entryId: expect.any(Number), title: 'Odd Import', notes: null, conditional: false }]);
    // Answering removes the question.
    await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/decisions', cookies, payload: { entryId: queue.lookAlikes[0].entryId, productId: '3', decision: 'confirmed' } });
    await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${queue.marked[0].entryId}`, cookies, payload: { targetStatus: 'required' } });
    expect((await g.app.inject({ url: '/api/v1/review', cookies })).json()).toEqual({ lookAlikes: [], marked: [] });
  });

  it('answers several marked games at once', async () => {
    load();
    const all = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3', cookies })).json().entries as { id: number; title: string }[];
    const ids = all.filter((e) => ['Flower', 'Odd Import'].includes(e.title)).map((e) => e.id);
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/entries/status', cookies, payload: { ids, targetStatus: 'excluded' } });
    expect(res.json()).toEqual({ changed: 2 });
    const after = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?status=excluded', cookies })).json().entries.map((e: { title: string }) => e.title);
    expect(after).toEqual(expect.arrayContaining(['Flower', 'Odd Import']));
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/entries/status', cookies, payload: { ids, targetStatus: 'nope' } })).statusCode).toBe(400);
  });

  it('adds a copy of a game just bought, which the next export that has it takes over', async () => {
    load();
    const flower = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=flower', cookies })).json().entries[0];
    expect(flower.status).toBe('missing');
    const mark = await g.app.inject({ method: 'POST', url: '/api/v1/purchases', cookies, payload: { entryId: flower.id } });
    expect(mark.statusCode).toBe(201);
    // Sent twice the same day (a phone that was offline), it counts once.
    const twice = await g.app.inject({ method: 'POST', url: '/api/v1/purchases', cookies, payload: { entryId: flower.id } });
    expect(twice.statusCode).toBe(200);
    expect(twice.json().id).toBe(mark.json().id);
    expect((await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=flower', cookies })).json().entries[0]).toMatchObject({ status: 'owned', matches: [{ method: 'exact' }] });
    const store = (await g.app.inject({ url: '/api/v1/lookup?q=flower', cookies })).json();
    expect(store[0]).toMatchObject({ title: 'Flower', answer: 'own', entryId: flower.id });
    const wishlist = (await g.app.inject({ url: '/api/v1/wishlist', cookies })).json();
    expect(wishlist.master.map((m: { title: string }) => m.title)).not.toContain('Flower');
    expect((await g.app.inject({ url: '/api/v1/purchases', cookies })).json()).toEqual([
      expect.objectContaining({ title: 'Flower', platformKey: 'playstation-3', entryId: flower.id, condition: 'Complete in box', sentAt: null }),
    ]);

    // The next export has Flower: it's that same copy now (PriceCharting's), not a second one.
    const csv = exportCsv([
      ['1', 'Uncharted [Greatest Hits]', 'Playstation 3', 1000],
      ['2', 'Mass Effect Trilogy', 'Playstation 3', 1000],
      ['3', 'Cars 2', 'Playstation 3', 1000],
      ['4', 'Katamari Forever', 'PAL Playstation 3', 1000],
      ['5', 'Demo Disc Collection', 'Playstation 3', 1000],
      ['6', 'Journey Collectors Edition', 'Playstation 3', 1000],
      ['8', 'Flower', 'Playstation 3', 1500],
    ]);
    const { payload, headers } = multipart('collection_20260928.csv', csv);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, payload, headers })).json().import.status).toBe('applied');
    expect((await g.app.inject({ url: '/api/v1/purchases', cookies })).json()).toEqual([]);
    expect((await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=flower', cookies })).json().entries[0]).toMatchObject({ status: 'owned', matches: [{ method: 'exact' }] });
    expect(g.collection.items({ q: 'Flower' }).items).toMatchObject([{ key: mark.json().key, source: 'pricecharting', valueCents: 1500 }]);

    // A copy just added can be taken back.
    const again = (await g.app.inject({ method: 'POST', url: '/api/v1/purchases', cookies, payload: { entryId: flower.id } })).json();
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/purchases/${again.id}`, cookies })).json()).toEqual({ removed: true });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/purchases', cookies, payload: { entryId: 999999 } })).statusCode).toBe(404);
  });

  it('shows wishlist scores on missing games and sorts by them', async () => {
    load();
    for (const title of ['Brand New Game', 'Another New Game']) {
      await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/playstation-3/entries', cookies, payload: { title } });
    }
    const byScore = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?status=missing&sort=score', cookies })).json();
    // Scored games first, highest first; games the wishlist hides (Flower: "report only below price") last, without a score.
    const scores = byScore.entries.map((e: { wishlist: { score: number } | null }) => e.wishlist?.score ?? null);
    expect(scores.filter((x: number | null) => x !== null).length).toBeGreaterThan(0);
    const firstNull = scores.indexOf(null);
    if (firstNull >= 0) expect(scores.slice(firstNull).every((x: number | null) => x === null)).toBe(true);
    const scored = scores.filter((x: number | null): x is number => x !== null);
    expect(scored).toEqual([...scored].sort((a, b) => b - a));
    expect(byScore.entries.find((e: { title: string }) => e.title === 'Flower')?.wishlist).toBeNull();
    const owned = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?status=owned', cookies })).json();
    expect(owned.entries.every((e: { wishlist: unknown }) => e.wishlist === null)).toBe(true);
  });

  it('exports a console catalog as a spreadsheet', async () => {
    load();
    const res = await g.app.inject({ url: '/api/v1/catalogs/playstation-3/export', cookies });
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="squirrelcade-playstation-3-\d{4}-\d{2}-\d{2}\.csv"/);
    const lines = csvLines(res.body);
    expect(lines[0]).toBe('Title,Status,Owned as,Maybe owned as,Format,Released,Notes');
    expect(lines).toHaveLength(10);
    expect(lines).toContain('Mass Effect,Owned,Mass Effect Trilogy,,Game Disc,,');
    expect(lines).toContain('Cars 2: The Video Game,Needs review,,Cars 2,Game Disc,,');
    expect((await g.app.inject({ url: '/api/v1/catalogs/nope/export', cookies })).statusCode).toBe(404);
  });

  it('lets a catalog game be marked as not a target', async () => {
    load();
    const flower = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=flower', cookies })).json().entries[0];
    expect((await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${flower.id}`, cookies, payload: { targetStatus: 'excluded' } })).statusCode).toBe(200);
    expect((await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=flower', cookies })).json().entries[0].status).toBe('excluded');
    expect((await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${flower.id}`, cookies, payload: { targetStatus: 'nope' } })).statusCode).toBe(400);
  });
});

describe('owned games that are not in the catalog', () => {
  const notInCatalog = async () =>
    (await g.app.inject({ url: '/api/v1/catalogs/playstation-3', cookies })).json().notInCatalog.map((p: { title: string }) => p.title).sort();

  it('can be linked to the catalog games they count as', async () => {
    load();
    const titles = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3/titles', cookies })).json();
    const flower = titles.find((t: { title: string }) => t.title === 'Flower');
    expect(flower).toMatchObject({ status: 'missing' });
    // "Journey Collectors Edition" also contains Flower.
    await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/decisions', cookies, payload: { entryId: flower.id, productId: '6', decision: 'confirmed' } });
    expect(await notInCatalog()).toEqual(['Cars 2', 'Demo Disc Collection']);
    const owned = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=flower', cookies })).json().entries[0];
    expect(owned).toMatchObject({ status: 'owned', matches: [{ productId: '6', method: 'confirmed' }] });
  });

  it('can be added to the catalog, and removed again', async () => {
    load();
    const added = await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/playstation-3/entries', cookies, payload: { title: 'Journey Collectors Edition', releaseDate: '2012-08' } });
    expect(added.statusCode).toBe(201);
    expect(await notInCatalog()).toEqual(['Cars 2', 'Demo Disc Collection']);
    const entry = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=journey', cookies })).json().entries[0];
    expect(entry).toMatchObject({ status: 'owned', source: 'user', releaseDate: '2012-08' });

    const again = await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/playstation-3/entries', cookies, payload: { title: 'journey collectors edition' } });
    expect(again.statusCode).toBe(409);
    const badDate = await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/playstation-3/entries', cookies, payload: { title: 'New Game', releaseDate: 'soon' } });
    expect(badDate.statusCode).toBe(400);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/nope/entries', cookies, payload: { title: 'X' } })).statusCode).toBe(404);

    // A catalog source's games can't be deleted (the next refresh would bring them back); the user's own can.
    const flower = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=flower', cookies })).json().entries[0];
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/catalogs/entries/${flower.id}`, cookies })).statusCode).toBe(400);
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/catalogs/entries/${entry.id}`, cookies })).statusCode).toBe(200);
    expect(await notInCatalog()).toEqual(['Cars 2', 'Demo Disc Collection', 'Journey Collectors Edition']);

    // The user's games survive a refresh from the catalog source.
    await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/playstation-3/entries', cookies, payload: { title: 'Brand New Release' } });
    g.catalogs.syncSource('playstation-3', 'test', PS3);
    expect((await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=brand', cookies })).json().entries).toHaveLength(1);
  });

  it('can be ignored, and the ignore undone', async () => {
    load();
    const ignore = await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/playstation-3/ignored', cookies, payload: { productId: '5' } });
    expect(ignore.statusCode).toBe(200);
    const detail = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3', cookies })).json();
    expect(detail.notInCatalog.map((p: { title: string }) => p.title).sort()).toEqual(['Cars 2', 'Journey Collectors Edition']);
    expect(detail.ignored).toEqual([{ productId: '5', title: 'Demo Disc Collection' }]);
    // An ignored game is no longer offered as a look-alike either.
    await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/playstation-3/ignored', cookies, payload: { productId: '3' } });
    const cars = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=cars', cookies })).json().entries[0];
    expect(cars).toMatchObject({ status: 'missing', suggestions: [] });

    expect((await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/playstation-3/ignored', cookies, payload: { productId: 'nope' } })).statusCode).toBe(404);
    await g.app.inject({ method: 'DELETE', url: '/api/v1/catalogs/playstation-3/ignored/5', cookies });
    await g.app.inject({ method: 'DELETE', url: '/api/v1/catalogs/playstation-3/ignored/3', cookies });
    expect(await notInCatalog()).toEqual(['Cars 2', 'Demo Disc Collection', 'Journey Collectors Edition']);
  });
});

describe('coming soon', () => {
  it('lists the games not out yet on consoles with a catalog, soonest first and TBA last, with whether a copy is owned', async () => {
    const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
    seedCatalogs(g, {
      owned: [['1', 'Later Game', 'Nintendo Switch'], ...['A', 'B', 'C', 'D', 'E'].map((t, i): [string, string, string] => [String(i + 2), `Owned ${t}`, 'Nintendo Switch'])],
      catalogs: {
        'nintendo-switch': [
          { title: 'Soon Game', releaseDate: day(10), evidence: 'list' },
          { title: 'Later Game', releaseDate: day(40), evidence: 'list' },
          { title: 'Someday Game', releaseDate: 'TBA', evidence: 'list' },
          { title: 'Old Game', releaseDate: '2001-01-01', evidence: 'list' },
        ],
      },
    });
    const list = (await g.app.inject({ url: '/api/v1/catalogs/upcoming', cookies })).json();
    expect(list.map((x: { title: string; status: string }) => [x.title, x.status])).toEqual([
      ['Soon Game', 'missing'],
      ['Later Game', 'owned'],
      ['Someday Game', 'missing'],
    ]);

    // As a calendar file: the dated releases (not the TBA one), each an all-day event.
    const ics = await g.app.inject({ url: '/api/v1/catalogs/upcoming.ics', cookies });
    expect(ics.headers['content-type']).toMatch(/^text\/calendar/);
    expect(ics.headers['content-disposition']).toBe('attachment; filename="squirrelcade-coming-soon.ics"');
    expect(ics.body).toContain(`DTSTART;VALUE=DATE:${day(10).replace(/-/g, '')}`);
    expect(ics.body).toContain('SUMMARY:Later Game (Nintendo Switch)');
    expect(ics.body).toContain('DESCRIPTION:You have a copy');
    expect(ics.body).not.toContain('Someday Game');
    expect(ics.body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });
});
