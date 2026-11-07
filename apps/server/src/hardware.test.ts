import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g?.cleanup();
});

describe('hardware from PriceCharting (T-217)', () => {
  it("keeps a console and its controller out of the games, lists them as Your hardware, and takes the owner's word", async () => {
    g = await testApp();
    const cookies = await setUp(g);
    seedCatalogs(g, {
      owned: [
        ['1', 'Super Mario 64', 'Nintendo 64'],
        ['2', 'Nintendo 64 Console', 'Nintendo 64'],
        ['3', 'Nintendo 64 Controller', 'Nintendo 64'],
        ['4', 'Mario Kart 64', 'Nintendo 64'],
      ],
      catalogs: { 'nintendo-64': ['Super Mario 64', 'Mario Kart 64', 'GoldenEye 007'] },
    });
    const get = async (url: string) => (await g.app.inject({ url, cookies })).json();
    const n64 = async () => (await get('/api/v1/platforms')).find((p: { key: string }) => p.key === 'nintendo-64');
    expect(await n64()).toMatchObject({ games: 2, hardware: 2 });
    const hw = await get('/api/v1/hardware?platform=nintendo-64');
    expect(hw.items.map((i: { title: string; kind: string }) => [i.title, i.kind])).toEqual(expect.arrayContaining([['Nintendo 64 Console', 'console'], ['Nintendo 64 Controller', 'controller']]));
    // Never "owned, not in the catalog".
    const catalog = await get('/api/v1/catalogs/nintendo-64');
    expect(JSON.stringify(catalog.notInCatalog ?? [])).not.toContain('Nintendo 64 Console');
    // The owner says the controller is a game (to test): it counts again; null goes back to its name.
    await g.app.inject({ method: 'PUT', url: '/api/v1/hardware/3', cookies, payload: { is: 'game' } });
    expect(await n64()).toMatchObject({ games: 3, hardware: 1 });
    await g.app.inject({ method: 'PUT', url: '/api/v1/hardware/3', cookies, payload: { is: null } });
    expect(await n64()).toMatchObject({ games: 2, hardware: 2 });
  });
});
