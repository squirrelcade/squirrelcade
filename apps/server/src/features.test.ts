import { afterEach, describe, expect, it } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g?.cleanup();
});

describe('Settings > Features', () => {
  it('starts a new install with the parts that need another program off, and refuses their API until they are on', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    const values = (await g.app.inject({ url: '/api/v1/settings', cookies })).json().values;
    expect([values['features.igdb'], values['features.history'], values['features.pc'], values['features.romm']]).toEqual([true, true, false, false]);
    for (const url of ['/api/v1/pc', '/api/v1/pc/games', '/api/v1/pc/wishlist', '/api/v1/sources/romm']) {
      const res = await g.app.inject({ url, cookies });
      expect([url, res.statusCode, res.json().error]).toEqual([url, 404, 'feature-off']);
    }
    // Their background tasks don't run either.
    const tasks = (await g.app.inject({ url: '/api/v1/tasks', cookies })).json() as { name: string; intervalMs: number | null }[];
    for (const name of ['pc-read', 'pc-discover', 'romm-sync']) expect([name, tasks.find((t) => t.name === name)?.intervalMs]).toEqual([name, null]);

    // Turned on, the PC library answers.
    g.settings.update({ 'features.pc': true });
    expect((await g.app.inject({ url: '/api/v1/pc', cookies })).statusCode).toBe(200);
  });

  it('with IGDB off, never uses IGDB data: no covers or details, and no IGDB settings API', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Okami', 'Playstation 2']], catalogs: { 'playstation-2': ['Okami'] } });
    const ps2 = g.db.select().from(platforms).all().find((p) => p.key === 'playstation-2')!;
    const game = { id: 1, name: 'Okami', altNames: [], coverId: 'co1abc', genres: ['Adventure'], themes: [], perspectives: [], franchise: null, japanese: true, released: '2006-04-20', gameType: 'Main Game' };
    g.db.insert(igdbGames).values({ platformId: ps2.id, igdbId: 1, data: JSON.stringify(game) }).run();
    const drawer = async () => (await g.app.inject({ url: '/api/v1/game?platform=playstation-2&title=Okami', cookies })).json();
    expect(await drawer()).toMatchObject({ coverId: 'co1abc', igdb: { name: 'Okami' } });

    g.settings.update({ 'features.igdb': false });
    expect(await drawer()).toMatchObject({ coverId: null, igdb: null });
    expect((await g.app.inject({ url: '/api/v1/sources/igdb', cookies })).json()).toMatchObject({ error: 'feature-off' });
  });

  it("tells a viewer's interface which parts are on", async () => {
    g = await testApp({ features: ['pc'] });
    const owner = await setUp(g);
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Sam' }, cookies: owner });
    const joined = await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } });
    const viewer = { squirrelcade_session: joined.cookies.find((c) => c.name === 'squirrelcade_session')!.value };
    const values = (await g.app.inject({ url: '/api/v1/settings', cookies: viewer })).json().values;
    expect(values).toMatchObject({ 'features.pc': true, 'features.romm': false, 'features.history': true });
    // ...but not the settings behind them (RomM's address, the Playnite folder).
    expect(values['sources.rommUrl']).toBeUndefined();
    expect(values['pc.playniteFolder']).toBeUndefined();
  });
});
