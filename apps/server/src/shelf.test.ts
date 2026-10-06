import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g?.cleanup();
});

/** A signed-in viewer's session cookie. */
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ squirrelcade_session: res.cookies.find((c) => c.name === 'squirrelcade_session')!.value });

describe('scan my shelf', () => {
  it("says which game a barcode is without asking a barcode service, and how many of each console's games have theirs", async () => {
    let asked = 0;
    g = await testApp({
      productNameLookup: async () => {
        asked++;
        return null;
      },
    });
    const cookies = await setUp(g);
    seedCatalogs(g, {
      owned: [
        ['1', 'Uncharted', 'Playstation 3'],
        ['2', 'Journey [Collector\'s Edition]', 'Playstation 3'],
        ['3', 'Tetris 99', 'Nintendo Switch'],
      ],
      catalogs: { 'playstation-3': ['Uncharted', 'Journey'], 'nintendo-switch': ['Tetris 99'] },
    });
    const get = async (url: string, who = cookies) => g.app.inject({ url: `/api/v1/${url}`, cookies: who });
    expect((await get('barcodes/coverage')).json()).toEqual([
      { key: 'nintendo-switch', name: 'Nintendo Switch', games: 1, withBarcode: 0 },
      { key: 'playstation-3', name: 'PlayStation 3', games: 2, withBarcode: 0 },
    ]);
    expect((await get('barcodes/0711719541028')).json()).toEqual({ saved: null });
    expect((await get('barcodes/abc')).statusCode).toBe(400);

    // Two scans confirmed: one under the copy's title, one under the catalog game its copy counts as.
    const save = (code: string, platformKey: string, title: string) => g.app.inject({ method: 'POST', url: '/api/v1/barcodes', cookies, payload: { code, platformKey, title } });
    expect((await save('0711719541028', 'playstation-3', 'Uncharted')).statusCode).toBe(200);
    expect((await save('711719500001', 'playstation-3', 'Journey')).statusCode).toBe(200);
    // Found in any form it was scanned in (a leading zero or not).
    expect((await get('barcodes/711719541028')).json()).toEqual({ saved: { code: '711719541028', platformKey: 'playstation-3', platform: 'PlayStation 3', title: 'Uncharted', source: 'user' } });
    expect((await get('barcodes/00711719541028')).json().saved).toMatchObject({ title: 'Uncharted' });
    expect((await get('barcodes/coverage')).json()).toEqual([
      { key: 'nintendo-switch', name: 'Nintendo Switch', games: 1, withBarcode: 0 },
      { key: 'playstation-3', name: 'PlayStation 3', games: 2, withBarcode: 2 },
    ]);
    // No barcode service was asked.
    expect(asked).toBe(0);

    // The owner's alone.
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Sam' }, cookies });
    const viewer = cookieOf(await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } }));
    expect((await get('barcodes/coverage', viewer)).statusCode).toBe(403);
    expect((await get('barcodes/711719541028', viewer)).statusCode).toBe(403);
  });
});
