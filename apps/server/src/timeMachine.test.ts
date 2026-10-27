import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';
import { writeZip } from './zip.js';

let g: TestApp;
let dir: string;
afterEach(async () => {
  await g.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

const game = (id: number, name: string, released: string | null, rating: number | null = null, ratingCount = 0, gameType = 'Main Game') => ({
  igdbId: id,
  data: JSON.stringify({ id, name, altNames: [], coverId: null, genres: [], themes: [], perspectives: [], franchise: null, japanese: false, released, gameType, rating, ratingCount }),
});

describe('Now in and the Time machine (D190)', () => {
  it("shows a window's games, most important first, one line each, and the magazines on sale then, within the budget", async () => {
    dir = mkdtempSync(join(tmpdir(), 'squirrelcade-tm-'));
    mkdirSync(join(dir, 'Nintendo Power'));
    // A November 1996 issue was on sale in October 1996; a December one, in November.
    for (const [n, month] of [[90, 11], [91, 12]] as const) writeFileSync(join(dir, 'Nintendo Power', `Nintendo Power #0${n} (1996-${month}).cbz`), writeZip([{ name: '001.jpg', data: Buffer.from('page') }]));
    g = await testApp();
    const cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Okami', 'PlayStation 2']], catalogs: { 'nintendo-64': ['Super Mario 64'], playstation: ['Crash Bandicoot'] } });
    const idOf = (key: string) => g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, key)).get()!.id;
    const n64 = idOf('nintendo-64');
    const ps1 = idOf('playstation');
    // Thousands of releases around the years, a few in the window.
    const filler = Array.from({ length: 30000 }, (_, i) => ({ ...game(100000 + i, `Filler ${i}`, `19${80 + (i % 20)}-0${1 + (i % 9)}-15`, 40, 1), platformId: n64 }));
    for (let i = 0; i < filler.length; i += 500) g.db.insert(igdbGames).values(filler.slice(i, i + 500)).run();
    g.db
      .insert(igdbGames)
      .values([
        { ...game(1, 'Super Mario 64', '1996-09-29', 94, 900), platformId: n64 },
        { ...game(2, 'Crash Bandicoot', '1996-09-09', 80, 500), platformId: ps1 },
        { ...game(3, 'Tetris Attack Pack', '1996-10-20', 70, 5, 'Bundle'), platformId: ps1 },
        { ...game(4, 'Pilotwings 64', '1996-10-30', 75, 200), platformId: n64 },
        { ...game(5, 'Pilotwings 64', '1996-11-02', 60, 3), platformId: ps1 },
        { ...game(6, 'Wave Race 64', '1996-11-01', 82, 150), platformId: n64 },
        { ...game(7, 'Too Early', '1996-09-01', 99, 999), platformId: n64 },
      ])
      .run();
    g.igdb.forgetPlatforms();
    g.settings.update({ 'features.magazines': true, 'magazines.folder': dir });
    await g.magazines.scan();
    const get = async (url: string) => {
      const start = performance.now();
      const res = await g.app.inject({ url, cookies });
      return { body: res.json(), status: res.statusCode, ms: performance.now() - start };
    };
    // The index is built once (the first answer), then each window is a search of it.
    await get('/api/v1/history/day?date=1996-10-26');
    const day = await get('/api/v1/history/day?date=1996-10-26');
    expect(day.status).toBe(200);
    expect(day.ms).toBeLessThan(300);
    expect(day.body).toMatchObject({ from: '1996-10-12', to: '1996-11-09' });
    expect(day.body.games.map((x: { title: string; consoles: { key: string }[] }) => [x.title, x.consoles.map((c) => c.key)])).toEqual([
      ['Wave Race 64', ['nintendo-64']],
      ['Pilotwings 64', ['nintendo-64', 'playstation']],
    ]);
    // On sale then, their covers a month ahead: November's issue in October, December's from November 1st.
    expect(day.body.magazines.map((m: { label: string }) => m.label)).toEqual(['Nintendo Power #90 · November 1996', 'Nintendo Power #91 · December 1996']);
    // A week earlier, only November's.
    expect((await get('/api/v1/history/day?date=1996-10-15')).body.magazines.map((m: { label: string }) => m.label)).toEqual(['Nintendo Power #90 · November 1996']);
    // A wider window for its decade.
    g.settings.update({ 'roots.windowDaysByDecade': ['1990s: 60'] });
    const wide = await get('/api/v1/history/day?date=1996-10-26');
    expect(wide.body.games.map((x: { title: string }) => x.title)).toEqual(expect.arrayContaining(['Super Mario 64', 'Crash Bandicoot', 'Too Early']));
    // Now in: five decades back from today, each a window.
    const now = await get('/api/v1/history/now-in');
    expect(now.body.windows).toHaveLength(5);
    expect(now.ms).toBeLessThan(300);
    expect((await get('/api/v1/history/day?date=nope')).status).toBe(400);
  }, 60_000);
});
