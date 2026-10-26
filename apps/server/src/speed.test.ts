import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

// It stays snappy (AGENTS.md, D171): the search and a barcode's lookup answer within a budget, with a followed
// console's whole IGDB list (a big console's is tens of thousands of games) kept in memory, not read per search.
const SEARCH_BUDGET_MS = 300;
const BARCODE_BUDGET_MS = 500;
const STATS_BUDGET_MS = 100;
const FOLLOWED_GAMES = 30000;

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g.cleanup();
});

const game = (id: number, name: string) => ({ platformId: 0, igdbId: id, data: JSON.stringify({ id, name, altNames: [], coverId: null, genres: [], themes: [], perspectives: [], franchise: null, japanese: false, released: null, gameType: 'Main Game' }) });

beforeEach(async () => {
  g = await testApp({ productNameLookup: async (code) => (code === '012345678905' ? 'Okami HD - PlayStation 2' : null) });
  cookies = await setUp(g);
  seedCatalogs(g, { owned: [['1', 'Okami', 'PlayStation 2']], catalogs: { 'playstation-2': ['Okami', 'Shadow of the Colossus'] } });
  const idOf = (key: string) => g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, key)).get()!.id;
  // A followed console you don't collect, with a big IGDB list, and a collected one's IGDB list too.
  const vectrex = idOf('vectrex');
  const rows = Array.from({ length: FOLLOWED_GAMES }, (_, i) => ({ ...game(10000 + i, i === 0 ? 'Mine Storm' : `Filler Game ${i}`), platformId: vectrex }));
  for (let i = 0; i < rows.length; i += 500) g.db.insert(igdbGames).values(rows.slice(i, i + 500)).run();
  g.db.insert(igdbGames).values([{ ...game(1, 'Okami'), platformId: idOf('playstation-2') }, { ...game(2, 'Shadow of the Colossus'), platformId: idOf('playstation-2') }]).run();
  g.igdb.forgetPlatforms();
});

const time = async <T>(run: () => Promise<T>) => {
  const start = performance.now();
  const value = await run();
  return { value, ms: performance.now() - start };
};

describe('the search and barcodes stay snappy (D171)', () => {
  it("reads a followed console's IGDB list once, not on each search, and answers within the budget", async () => {
    const read = vi.spyOn(g.igdb, 'games');
    const search = (q: string) => g.app.inject({ url: `/api/v1/lookup?q=${encodeURIComponent(q)}`, cookies });
    expect((await search('mine storm')).json().find((r: { platform: string }) => r.platform === 'Vectrex')).toMatchObject({ answer: 'not-tracked' });
    const reads = read.mock.calls.length;
    for (const q of ['mi', 'min', 'mine', 'mine s', 'okami', 'filler game 29999']) {
      const { value, ms } = await time(() => search(q));
      expect(value.statusCode).toBe(200);
      expect(ms).toBeLessThan(SEARCH_BUDGET_MS);
    }
    expect(read.mock.calls.length).toBe(reads);
  });

  it("gives a collected console's games from its catalog only, never a second \"Not tracked\" answer", async () => {
    const found = (await g.app.inject({ url: '/api/v1/lookup?q=shadow%20of%20the%20colossus', cookies })).json() as { platform: string; answer: string }[];
    expect(found.filter((r) => r.platform === 'PlayStation 2')).toHaveLength(1);
    expect(found.some((r) => r.answer === 'not-tracked')).toBe(false);
  });

  it("answers a barcode within the budget, without the followed consoles' lists", async () => {
    const read = vi.spyOn(g.igdb, 'games');
    const { value, ms } = await time(() => g.app.inject({ url: '/api/v1/lookup/barcode/012345678905', cookies }));
    expect(value.json()).toMatchObject({ productName: 'Okami HD - PlayStation 2', searchedFor: 'Okami' });
    expect((value.json().results as { answer: string }[]).some((r) => r.answer === 'not-tracked')).toBe(false);
    expect(ms).toBeLessThan(BARCODE_BUDGET_MS);
    expect(read).not.toHaveBeenCalled();
  });

  it("keeps the Nutshell's statistics until the copies change (D183)", async () => {
    const stats = async () => (await g.app.inject({ url: '/api/v1/collection/statistics', cookies })).json();
    const first = await stats();
    expect(first.totals).toMatchObject({ copies: 1 });
    const work = vi.spyOn(g.collection, 'items');
    const again = await time(stats);
    expect(work).not.toHaveBeenCalled();
    expect(again.value.totals).toEqual(first.totals);
    expect(again.ms).toBeLessThan(STATS_BUDGET_MS);
    // A copy added: worked out again.
    const added = await g.app.inject({ method: 'POST', url: '/api/v1/collection/copies', cookies, payload: { platformKey: 'playstation-2', title: 'Shadow of the Colossus', completeness: 'complete' } });
    expect(added.statusCode).toBeLessThan(300);
    expect((await stats()).totals).toMatchObject({ copies: 2 });
    expect(work).toHaveBeenCalledTimes(1);
  });
});
