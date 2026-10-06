import { dayIn } from '@squirrelcade/core';
import { afterEach, describe, expect, it } from 'vitest';
import { exportCsv, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

type Cookies = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ squirrelcade_session: res.cookies.find((c) => c.name === 'squirrelcade_session')!.value });

/** Four PS3 games (one an edition of a catalog game) and a Wii game, with a PS3 catalog. */
async function collection() {
  g = await testApp();
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [
      ['1', 'Uncharted [Greatest Hits]', 'Playstation 3'],
      ['2', 'Journey', 'Playstation 3'],
      ['3', 'Flower', 'Playstation 3'],
      ['4', 'Puppeteer', 'Playstation 3'],
      ['5', 'Okami', 'Wii'],
    ],
    catalogs: { 'playstation-3': ['Uncharted', 'Journey', 'Flower', 'Puppeteer'] },
  });
}

const put = (payload: Record<string, unknown>, who = cookies) => g.app.inject({ method: 'PUT', url: '/api/v1/play', cookies: who, payload });
const list = async (query = '', who = cookies) => (await g.app.inject({ url: `/api/v1/play${query}`, cookies: who })).json();

describe('play status', () => {
  it('keeps a status and rating under the catalog game, dates starting and finishing, and removes an empty one', async () => {
    await collection();
    // Days are in the install's time zone (Settings > General).
    const today = dayIn(g.settings.get('general.timeZone'));
    // An edition's copy is kept as the catalog's game.
    const playing = await put({ platformKey: 'playstation-3', title: 'Uncharted [Greatest Hits]', status: 'playing' });
    expect(playing.statusCode).toBe(200);
    expect(playing.json().play).toMatchObject({ status: 'playing', rating: null, startedAt: today, finishedAt: null });
    const beaten = (await put({ platformKey: 'playstation-3', title: 'Uncharted', status: 'beaten', rating: 9 })).json().play;
    expect(beaten).toMatchObject({ status: 'beaten', rating: 9, startedAt: today, finishedAt: today });
    // The drawer shows it, for the copy's own title too.
    expect((await g.app.inject({ url: '/api/v1/game?platform=playstation-3&title=Uncharted%20%5BGreatest%20Hits%5D', cookies })).json().play).toMatchObject({ status: 'beaten', rating: 9 });
    // Days can be set; back to "not played yet" clears them.
    expect((await put({ platformKey: 'playstation-3', title: 'Journey', status: 'completed', startedAt: '2026-01-02', finishedAt: '2026-01-05' })).json().play).toMatchObject({
      startedAt: '2026-01-02',
      finishedAt: '2026-01-05',
    });
    expect((await put({ platformKey: 'playstation-3', title: 'Journey', status: 'backlog' })).json().play).toMatchObject({ status: 'backlog', startedAt: null, finishedAt: null });
    // A rating alone keeps the status; neither removes the game's play.
    expect((await put({ platformKey: 'playstation-3', title: 'Journey', rating: 7 })).json().play).toMatchObject({ status: 'backlog', rating: 7 });
    expect((await put({ platformKey: 'playstation-3', title: 'Journey', status: null, rating: null })).json().play).toBeNull();
    // What isn't valid is refused.
    for (const bad of [{ status: 'finished' }, { rating: 0 }, { rating: 11 }, { rating: 7.5 }, { startedAt: '2026-1-2' }]) {
      expect((await put({ platformKey: 'playstation-3', title: 'Flower', ...bad })).statusCode).toBe(400);
    }
    expect((await put({ platformKey: 'no-such-console', title: 'Flower', status: 'playing' })).statusCode).toBe(400);
    expect((await put({ platformKey: 'playstation-3' })).statusCode).toBe(400);
  });

  it('lists the backlog (with unmarked games when the setting says so), each status, and what to play next', async () => {
    await collection();
    await put({ platformKey: 'playstation-3', title: 'Uncharted', status: 'playing' });
    await put({ platformKey: 'playstation-3', title: 'Journey', status: 'backlog' });
    await put({ platformKey: 'playstation-3', title: 'Flower', status: 'dropped', rating: 4 });
    const backlog = await list();
    expect(backlog.status).toBe('backlog');
    // Journey (marked), Puppeteer and Okami (not marked): one game per catalog game, under its catalog title.
    expect(backlog.items.map((i: { title: string }) => i.title)).toEqual(['Journey', 'Okami', 'Puppeteer']);
    expect(backlog.counts).toMatchObject({ backlog: 3, unmarked: 2, playing: 1, dropped: 1, beaten: 0, rated: 1 });
    expect((await list('?status=playing')).items.map((i: { title: string }) => i.title)).toEqual(['Uncharted']);
    expect((await list('?status=rated')).items.map((i: { title: string }) => i.title)).toEqual(['Flower']);
    expect((await list('?status=unmarked&platform=wii')).items.map((i: { title: string }) => i.title)).toEqual(['Okami']);
    expect((await list('?q=pupp')).items.map((i: { title: string }) => i.title)).toEqual(['Puppeteer']);
    // Without unmarked games, only Journey is waiting.
    g.settings.update({ 'collection.backlogIncludesUnmarked': false });
    expect((await list()).items.map((i: { title: string }) => i.title)).toEqual(['Journey']);
    const next = (await g.app.inject({ url: '/api/v1/play/next', cookies })).json();
    expect(next.game.title).toBe('Journey');
    expect((await g.app.inject({ url: '/api/v1/play/next?platform=wii', cookies })).json()).toEqual({ game: null });
    // The picker leans toward well-rated games: with a random draw near the end, the last of the pool.
    g.settings.update({ 'collection.backlogIncludesUnmarked': true });
    expect(g.play.next(undefined, () => 0)!.title).toBe('Journey');
    expect(g.play.next(undefined, () => 0.999)!.title).toBe('Puppeteer');
  });

  it("shows each copy's play on the Collection page, filters by it, and counts it on the dashboard", async () => {
    await collection();
    await put({ platformKey: 'playstation-3', title: 'Uncharted', status: 'beaten', rating: 8 });
    await put({ platformKey: 'playstation-3', title: 'Journey', status: 'playing' });
    const items = (await g.app.inject({ url: '/api/v1/collection/items', cookies })).json().items as { title: string; play: unknown }[];
    expect(items.find((i) => i.title === 'Uncharted [Greatest Hits]')!.play).toEqual({ status: 'beaten', rating: 8 });
    expect(items.find((i) => i.title === 'Okami')!.play).toBeNull();
    const titles = async (query: string) => ((await g.app.inject({ url: `/api/v1/collection/items${query}`, cookies })).json().items as { title: string }[]).map((i) => i.title);
    expect(await titles('?play=beaten')).toEqual(['Uncharted [Greatest Hits]']);
    expect(await titles('?play=backlog')).toEqual(['Flower', 'Okami', 'Puppeteer']);
    expect(await titles('?play=unmarked&platform=wii')).toEqual(['Okami']);
    // Filters page after filtering.
    const page = (await g.app.inject({ url: '/api/v1/collection/items?play=backlog&pageSize=2&page=2', cookies })).json();
    expect(page).toMatchObject({ total: 3 });
    expect(page.items.map((i: { title: string }) => i.title)).toEqual(['Puppeteer']);
    const csv = (await g.app.inject({ url: '/api/v1/collection/export?play=playing', cookies })).body.trim().split(/\r?\n/);
    expect(csv.slice(1).map((l) => l.split(',')[0])).toEqual(['Journey']);
    expect(csv[1]).toContain(',Playing,');
    const { apiKey } = (await g.app.inject({ url: '/api/v1/auth/apikey', cookies })).json() as { apiKey: string };
    expect((await g.app.inject({ url: '/api/v1/stats', headers: { 'x-api-key': apiKey } })).json()).toMatchObject({ backlog: 3 });
  });

  it("shows viewers what the owner played unless it's kept private, and never lets them change it", async () => {
    await collection();
    await put({ platformKey: 'playstation-3', title: 'Journey', status: 'completed', rating: 10 });
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Sam' }, cookies });
    const viewer = cookieOf(await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } }));
    expect((await list('?status=completed', viewer)).items.map((i: { title: string }) => i.title)).toEqual(['Journey']);
    expect((await put({ platformKey: 'playstation-3', title: 'Journey', status: 'dropped' }, viewer)).statusCode).toBe(403);
    g.settings.update({ 'security.viewersSeePlay': false });
    expect((await g.app.inject({ url: '/api/v1/play', cookies: viewer })).statusCode).toBe(403);
    expect((await g.app.inject({ url: '/api/v1/play/next', cookies: viewer })).statusCode).toBe(403);
    expect((await g.app.inject({ url: '/api/v1/game?platform=playstation-3&title=Journey', cookies: viewer })).json().play).toBeNull();
    const items = (await g.app.inject({ url: '/api/v1/collection/items?play=completed', cookies: viewer })).json();
    // The filter is ignored for them, and no row says what was played.
    expect(items.total).toBe(5);
    expect(items.items.every((i: { play: unknown }) => i.play === null)).toBe(true);
  });
});

describe('the upgrade list', () => {
  it("lists games whose best copy isn't complete, your favorites first, with PriceCharting's page for each", async () => {
    g = await testApp();
    cookies = await setUp(g);
    g.collection.importText(
      exportCsv([
        ['11', 'Okami', 'Playstation 2', 1500, 'Item Only'],
        ['12', 'Ico', 'Playstation 2', 4000, 'Item and Box'],
        ['13', 'Rez', 'Playstation 2', 3000, 'Item and Manual'],
        ['14', 'Katamari Damacy', 'Playstation 2', 2500, 'Item, Box, and Manual'],
        // Loose and complete copies of one game: its best copy is complete, so it isn't an upgrade.
        ['15', 'Shadow of the Colossus', 'Playstation 2', 1200, 'Item Only'],
        ['15', 'Shadow of the Colossus', 'Playstation 2', 3500, 'Item, Box, and Manual'],
        ['16', 'Jak and Daxter', 'Playstation 2', 800, 'Box Only'],
      ]),
      { source: 'upload', fileName: 'collection_20260926.csv' },
    );
    await put({ platformKey: 'playstation-2', title: 'Rez', status: 'completed', rating: 9 });
    await put({ platformKey: 'playstation-2', title: 'Ico', rating: 6 });
    const upgrades = async (who = cookies) => (await g.app.inject({ url: '/api/v1/collection/upgrades', cookies: who })).json().items;
    const items = await upgrades();
    expect(items.map((u: { title: string; missing: string[]; rating: number | null }) => [u.title, u.missing, u.rating])).toEqual([
      ['Rez', ['box'], 9],
      ['Ico', ['manual'], 6],
      ['Okami', ['box', 'manual'], null],
    ]);
    expect(items[0]).toMatchObject({ platform: 'PlayStation 2', status: 'completed', valueCents: 3000, completeness: 'item-manual', priceUrl: 'https://www.pricecharting.com/game/13' });
    // A viewer sees them too, without what the owner played when that isn't shared.
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Sam' }, cookies });
    const viewer = cookieOf(await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } }));
    expect((await upgrades(viewer))[0]).toMatchObject({ title: 'Rez', rating: 9 });
    g.settings.update({ 'security.viewersSeePlay': false });
    const hidden = await upgrades(viewer);
    expect(hidden.map((u: { rating: number | null; status: string | null }) => [u.rating, u.status])).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ]);
    // Without ratings, the most valuable first.
    expect(hidden.map((u: { title: string }) => u.title)).toEqual(['Ico', 'Rez', 'Okami']);
  });
});
