import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

describe('consoles you follow (D169)', () => {
  it("gives a console Roots knows but you don't collect its record, its games' pages and Store Mode's answer, until you stop following it", async () => {
    g = await testApp();
    const cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Okami', 'PlayStation 2']], catalogs: { 'playstation-2': ['Okami'] } });
    // The Vectrex has a record (for IGDB's list and RomM), and no catalog.
    const vectrex = g.db.select({ id: platforms.id, name: platforms.name }).from(platforms).where(eq(platforms.key, 'vectrex')).get();
    expect(vectrex?.name).toBe('Vectrex');
    g.db.insert(igdbGames).values({ platformId: vectrex!.id, igdbId: 7001, data: JSON.stringify({ id: 7001, name: 'Mine Storm', altNames: [], coverId: 'co_mine', genres: [], themes: [], perspectives: [], franchise: null, japanese: false, released: '1982-11-01', gameType: 'Main Game' }) }).run();
    g.igdb.forgetPlatforms();

    // Its game's page opens (it said "No such platform" before), with IGDB's box art.
    const page = await g.app.inject({ url: '/api/v1/game?platform=vectrex&title=Mine%20Storm', cookies });
    expect(page.statusCode).toBe(200);
    // Store Mode: "Not tracked" on the Vectrex, never in the offline copy.
    const found = (await g.app.inject({ url: '/api/v1/lookup?q=mine%20storm', cookies })).json() as { platform: string; answer: string }[];
    expect(found.find((r) => r.platform === 'Vectrex')).toMatchObject({ answer: 'not-tracked' });
    const copy = (await g.app.inject({ url: '/api/v1/lookup/offline', cookies })).json() as { games: { t: string }[] };
    expect(copy.games.some((x) => x.t === 'Mine Storm')).toBe(false);
    // Roots says it's followed; stopped following, it isn't, and Store Mode leaves it out.
    const followedOf = async () => ((await g.app.inject({ url: '/api/v1/history/timeline', cookies })).json().consoles as { platformKey: string; followed: boolean }[]).find((c) => c.platformKey === 'vectrex')?.followed;
    expect(await followedOf()).toBe(true);
    g.settings.update({ 'platforms.unfollowed': ['vectrex'] });
    expect(await followedOf()).toBe(false);
    expect(((await g.app.inject({ url: '/api/v1/lookup?q=mine%20storm', cookies })).json() as { platform: string }[]).some((r) => r.platform === 'Vectrex')).toBe(false);
    // A console nobody knows is still no console.
    expect((await g.app.inject({ url: '/api/v1/game?platform=no-such-console&title=X', cookies })).statusCode).toBe(404);
  });
});
