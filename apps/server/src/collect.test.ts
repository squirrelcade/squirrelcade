import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

type Row = { platformKey: string; tracked: boolean; followed: boolean; collecting: boolean; unitsSold: string | null; unitsSoldFull: string | null; picture?: { url: string; credit: string | null } | null };
const consoleOf = async (cookies: Awaited<ReturnType<typeof setUp>>, key: string) =>
  ((await g.app.inject({ url: '/api/v1/history/timeline', cookies })).json().consoles as Row[]).find((c) => c.platformKey === key)!;

describe('start collecting a followed console (R15)', () => {
  it('counts a console you chose as collected before you own enough games, and followed again once you stop', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Okami', 'PlayStation 2']], catalogs: { 'playstation-2': ['Okami'] } });
    expect(g.catalogBuilder.trackedKeys()).not.toContain('vectrex');
    expect(await consoleOf(cookies, 'vectrex')).toMatchObject({ tracked: false, followed: true, collecting: false });

    g.settings.update({ 'platforms.collecting': ['vectrex'] });
    expect(g.catalogBuilder.trackedKeys()).toContain('vectrex');
    expect(g.collection.platformsWithLabels().find((p) => p.key === 'vectrex')?.eligible).toBe(true);
    expect(await consoleOf(cookies, 'vectrex')).toMatchObject({ tracked: true, followed: false, collecting: true });
    // Its catalog status lists it (the console's page in the Nutshell finds it), and its build can be asked for.
    const sources = (await g.app.inject({ url: '/api/v1/catalogs/sources', cookies })).json() as { key: string; tracked: boolean }[];
    expect(sources.find((s) => s.key === 'vectrex')).toMatchObject({ tracked: true });
    expect(g.catalogBuilder.requestBuilt(['vectrex'])).toEqual(['vectrex']);

    // Its catalog gets built; stopping with none of its games owned forgets it, so it is followed again.
    g.catalogs.syncSource('vectrex', 'test', [{ title: 'Mine Storm' }]);
    expect(await consoleOf(cookies, 'vectrex')).toMatchObject({ tracked: true });
    g.settings.update({ 'platforms.collecting': [] });
    expect(g.catalogBuilder.trackedKeys()).not.toContain('vectrex');
    expect(await consoleOf(cookies, 'vectrex')).toMatchObject({ tracked: false, followed: true });
  });

  it('makes the record of a collected console even when following is off', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    g.settings.update({ 'platforms.followRoots': false });
    g.settings.update({ 'platforms.collecting': ['astrocade'] });
    expect(g.collection.platformsWithLabels().find((p) => p.key === 'astrocade')?.eligible).toBe(true);
    expect(await consoleOf(cookies, 'astrocade')).toMatchObject({ tracked: true });
  });

  it("tells what a console's catalog would be built from, and what its export calls it", async () => {
    g = await testApp();
    const cookies = await setUp(g);
    const vectrex = (await g.app.inject({ url: '/api/v1/catalog-plan/vectrex', cookies })).json();
    expect(vectrex).toMatchObject({ key: 'vectrex', name: 'Vectrex', pages: ['List of Vectrex games'], pagesAreDefault: true, list: null, labels: ['Vectrex'] });
    // Without a Wikipedia list of its own: IGDB's list, and no name known for PriceCharting.
    const sg = (await g.app.inject({ url: '/api/v1/catalog-plan/sega-sg-1000', cookies })).json();
    expect(sg).toMatchObject({ pages: [], labels: [] });
    expect(sg.igdb).toBe(true);
    g.settings.update({ 'catalogs.wikipediaPages': ['sega-sg-1000: List of SG-1000 games'] });
    expect((await g.app.inject({ url: '/api/v1/catalog-plan/sega-sg-1000', cookies })).json()).toMatchObject({ pages: ['List of SG-1000 games'], pagesAreDefault: false });
    expect((await g.app.inject({ url: '/api/v1/catalog-plan/no-such-console', cookies })).statusCode).toBe(404);
  });
});

describe('more on Roots console cards (R16)', () => {
  it('gives units sold in short, with the full text', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    expect(await consoleOf(cookies, 'playstation-3')).toMatchObject({ unitsSold: '87.4 million', unitsSoldFull: "About 87.4 million worldwide (Sony's final figure)" });
    expect(await consoleOf(cookies, 'nintendo-switch')).toMatchObject({ unitsSold: null, unitsSoldFull: null });
  });

  it('keeps a console picture from Wikipedia in the background, credits Commons, and serves it with a long cache', async () => {
    const png = await sharp({ create: { width: 640, height: 400, channels: 3, background: '#336699' } }).png().toBuffer();
    const asked: string[] = [];
    g = await testApp({
      wikipediaFetch: async (url) => {
        asked.push(url);
        if (url.includes('/page/summary/Vectrex')) {
          return new Response(JSON.stringify({ thumbnail: { source: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Vectrex-Console-Set.jpg/330px-Vectrex-Console-Set.jpg' } }), { status: 200 });
        }
        if (url.includes('/page/summary/Atari_2600')) {
          // A non-free file kept on en.wikipedia isn't taken.
          return new Response(JSON.stringify({ thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/en/thumb/a/ab/Box.png/330px-Box.png' } }), { status: 200 });
        }
        if (url.includes('Vectrex-Console-Set')) return new Response(png, { status: 200 });
        return new Response('{}', { status: 404 });
      },
    });
    const cookies = await setUp(g);
    // The first visit has none and asks for them; they come in the background.
    expect((await consoleOf(cookies, 'vectrex')).picture).toBeNull();
    let found: Row['picture'] = null;
    for (let i = 0; i < 100 && !found; i++) {
      await new Promise((r) => setTimeout(r, 50));
      found = (await consoleOf(cookies, 'vectrex')).picture;
    }
    expect(found?.credit).toBe('https://commons.wikimedia.org/wiki/File:Vectrex-Console-Set.jpg');
    expect(found?.url).toMatch(/^\/api\/v1\/history\/picture\/vectrex\?v=\d+$/);
    expect((await consoleOf(cookies, 'atari-2600')).picture).toBeNull();
    expect(asked.some((u) => u.includes('Box.png'))).toBe(false);
    const res = await g.app.inject({ url: found!.url, cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toContain('max-age=2592000');
    expect((await sharp(res.rawPayload).metadata()).width).toBe(320);
    expect(existsSync(join(g.dir, 'console-pictures', 'vectrex.webp'))).toBe(true);
    expect((await g.app.inject({ url: '/api/v1/history/picture/atari-2600', cookies })).statusCode).toBe(404);

    // Off: nothing is shown or served.
    g.settings.update({ 'roots.consolePictures': false });
    expect((await consoleOf(cookies, 'vectrex')).picture).toBeUndefined();
    expect((await g.app.inject({ url: found!.url, cookies })).statusCode).toBe(404);
  });

  it('shows no picture when Wikipedia is out of reach, and does not ask again at once', async () => {
    let calls = 0;
    g = await testApp({
      wikipediaFetch: async () => {
        calls++;
        throw new Error('offline');
      },
    });
    const cookies = await setUp(g);
    expect((await consoleOf(cookies, 'vectrex')).picture).toBeNull();
    await new Promise((r) => setTimeout(r, 200));
    const first = calls;
    expect(first).toBeGreaterThan(0);
    expect((await consoleOf(cookies, 'vectrex')).picture).toBeNull();
    await new Promise((r) => setTimeout(r, 100));
    expect(calls).toBe(first);
  });
});
