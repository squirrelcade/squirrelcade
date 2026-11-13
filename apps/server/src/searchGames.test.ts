import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copies } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

// T-407 (the owner in a store, 2026-11-12): "Call of Duty" listed no PS3 game. The search cut its answers at 30, a game
// on each console being one answer and the games you need first, so the long series' other games filled the 30 before
// the PS3 games, all owned, came. Searched by game, each game keeps every console, and every game can be reached.

/** A long series across consoles, made up for the test: each game on its consoles. */
const SERIES: Record<string, string[]> = {
  'Call of Duty 2': ['xbox-360'],
  'Call of Duty 2: Big Red One': ['playstation-2', 'xbox', 'nintendo-gamecube'],
  'Call of Duty 3': ['playstation-2', 'xbox', 'xbox-360', 'playstation-3', 'wii'],
  'Call of Duty 4: Modern Warfare': ['xbox-360', 'playstation-3', 'nintendo-ds'],
  'Call of Duty: Advanced Warfare': ['xbox-360', 'playstation-3', 'playstation-4', 'xbox-one'],
  'Call of Duty: Black Ops': ['xbox-360', 'playstation-3', 'wii', 'nintendo-ds'],
  'Call of Duty: Black Ops II': ['xbox-360', 'playstation-3', 'wii-u'],
  'Call of Duty: Finest Hour': ['playstation-2', 'xbox', 'nintendo-gamecube'],
  'Call of Duty: Ghosts': ['xbox-360', 'playstation-3', 'wii-u', 'playstation-4', 'xbox-one'],
  'Call of Duty: Modern Warfare 2': ['xbox-360', 'playstation-3'],
  'Call of Duty: Modern Warfare 3': ['xbox-360', 'playstation-3', 'wii', 'nintendo-ds'],
  'Call of Duty: Roads to Victory': ['psp'],
  'Call of Duty: Vanguard': ['playstation-4', 'playstation-5', 'xbox-one', 'xbox-series-x'],
  'Call of Duty: World at War': ['xbox-360', 'playstation-3', 'wii', 'nintendo-ds', 'playstation-2'],
  'Call of Duty: WWII': ['playstation-4', 'xbox-one'],
};
const PS3 = Object.entries(SERIES).filter(([, on]) => on.includes('playstation-3')).map(([t]) => t);
const ANSWERS = Object.values(SERIES).reduce((n, on) => n + on.length, 0);

type Answer = { platformKey: string; platform: string; title: string; answer: string; stars?: unknown; coverId?: unknown };
type Page = { results: Answer[]; games: number; consoles: { platformKey: string; platform: string; count: number }[]; activity: Record<string, { recent: number; copies: number }> };

let g: TestApp;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
  const catalogs: Record<string, string[]> = {};
  for (const [title, on] of Object.entries(SERIES)) for (const key of on) (catalogs[key] ??= []).push(title);
  // Every PS3 game owned: "own" comes after "need" in the search's order, so they'd come last of all.
  seedCatalogs(g, { owned: PS3.map((t, i): [string, string, string] => [`p${i}`, t, 'Playstation 3']), catalogs });
});
afterEach(async () => {
  await g.cleanup();
});

const search = async (query: string) => (await g.app.inject({ url: `/api/v1/lookup?${query}`, cookies })).json() as Page;
const byGame = (answers: Answer[]) => {
  const games = new Map<string, Set<string>>();
  for (const a of answers) {
    const key = a.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    games.set(key, (games.get(key) ?? new Set()).add(a.platformKey));
  }
  return games;
};
const key = (title: string) => title.toLowerCase().replace(/[^a-z0-9]/g, '');

describe('the search by game (T-407)', () => {
  it('keeps every console of each game it lists, so a long series no longer drops a console', async () => {
    // The cause, as the header and Store Mode asked before: the top 30 answers held no PS3 game at all.
    expect(ANSWERS).toBeGreaterThan(30);
    const top30 = (await g.app.inject({ url: '/api/v1/lookup?q=call%20of%20duty&limit=30', cookies })).json() as Answer[];
    expect(top30.some((r) => r.platformKey === 'playstation-3')).toBe(false);
    const page = await search('q=call%20of%20duty&games=5');
    const games = byGame(page.results);
    expect(games.size).toBe(5);
    for (const [game, on] of games) {
      const title = Object.keys(SERIES).find((t) => key(t) === game)!;
      expect([...on].sort()).toEqual([...SERIES[title]!].sort());
    }
    // How many games there are, and every console among them, the PS3 too, for the chips.
    expect(page.games).toBe(Object.keys(SERIES).length);
    expect(page.consoles.find((c) => c.platformKey === 'playstation-3')).toMatchObject({ platform: 'PlayStation 3', count: PS3.length });
    expect(new Set(page.consoles.map((c) => c.platformKey))).toEqual(new Set(Object.values(SERIES).flat()));
  });

  it('reaches every game and every console with more games, and a console chip gives all of its games', async () => {
    const all = await search('q=call%20of%20duty&games=100');
    expect(all.results).toHaveLength(ANSWERS);
    expect(all.results.filter((r) => r.platformKey === 'playstation-3').map((r) => r.title).sort()).toEqual([...PS3].sort());
    expect(all.results.filter((r) => r.platformKey === 'playstation-3').every((r) => r.answer === 'own')).toBe(true);
    const ps3 = await search('q=call%20of%20duty&games=5&platform=playstation-3');
    expect(ps3.games).toBe(PS3.length);
    expect(ps3.results).toHaveLength(5);
    expect(ps3.results.every((r) => r.platformKey === 'playstation-3')).toBe(true);
    // More than the most a search answers is cut to it, never an error.
    expect((await search('q=call%20of%20duty&games=5000')).results).toHaveLength(ANSWERS);
  });

  it('says how busy you have been on each console: copies, those added lately, and games on the way', async () => {
    const day = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    g.db.update(copies).set({ dateEntered: day }).run();
    const page = await search('q=call%20of%20duty&games=3');
    expect(page.activity['playstation-3']).toEqual({ recent: PS3.length, copies: PS3.length });
    expect(page.activity['xbox-360']).toBeUndefined();
  });

  it('leaves out what the header list does not show when brief, and the old answers stay as they were', async () => {
    const brief = await search('q=call%20of%20duty&games=3&brief=1');
    expect(brief.results.length).toBeGreaterThan(0);
    expect(brief.results.every((r) => r.stars === undefined && r.coverId === undefined)).toBe(true);
    const full = await search('q=call%20of%20duty&games=3');
    expect(full.results.every((r) => Array.isArray(r.stars))).toBe(true);
    // Without games, the answers are a list of at most 30 (or limit), as other pages and tools read them.
    const flat = (await g.app.inject({ url: '/api/v1/lookup?q=call%20of%20duty', cookies })).json() as Answer[];
    expect(Array.isArray(flat)).toBe(true);
    expect(flat).toHaveLength(30);
  });

  it('answers a long series by game within the search budget', async () => {
    await search('q=call%20of%20duty&games=20');
    const start = performance.now();
    for (const q of ['ca', 'call', 'call of duty', 'call of duty black ops']) await search(`q=${encodeURIComponent(q)}&games=20`);
    expect((performance.now() - start) / 4).toBeLessThan(300);
  });
});
