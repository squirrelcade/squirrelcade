import { afterEach, describe, expect, it } from 'vitest';
import { fakeTransports, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

describe('the game of the day', () => {
  it("picks one game you don't have each day, the same all day, another on request, and sends it at its hour", async () => {
    const { transports, sent } = fakeTransports();
    g = await testApp({ transports });
    const cookies = await setUp(g);
    seedCatalogs(g, {
      owned: [
        ['1', 'Okami', 'Playstation 3'],
        ['2', 'Journey', 'Playstation 3'],
        ['3', 'Flower', 'Playstation 3'],
        ['4', 'Puppeteer', 'Playstation 3'],
        ['5', 'Tearaway', 'Playstation 3'],
        ['6', 'Ico', 'Playstation 3'],
      ],
      catalogs: { 'playstation-3': ['Okami', 'Journey', 'Flower', 'Puppeteer', 'Tearaway', 'Ico', 'Demons Souls', 'Heavy Rain', 'Uncharted 2', 'Rain', 'Folklore'] },
    });
    // Off by default.
    expect((await g.app.inject({ url: '/api/v1/gotd', cookies })).statusCode).toBe(404);
    g.settings.update({ 'gotd.enabled': true, 'general.timeZone': 'America/Phoenix' });

    const first = (await g.app.inject({ url: '/api/v1/gotd', cookies })).json().game;
    expect(first).toMatchObject({ platform: 'PlayStation 3', score: expect.any(Number), rank: expect.any(Number), links: [{ name: 'PriceCharting' }, { name: 'eBay' }, { name: 'Mercari' }, { name: 'FB Marketplace' }] });
    expect(['Demons Souls', 'Heavy Rain', 'Uncharted 2', 'Rain', 'Folklore']).toContain(first.title);
    // The same all day.
    expect((await g.app.inject({ url: '/api/v1/gotd', cookies })).json().game.title).toBe(first.title);
    // Another one: a different game, which then stays.
    const second = (await g.app.inject({ method: 'POST', url: '/api/v1/gotd/another', cookies })).json().game;
    expect(second.title).not.toBe(first.title);
    expect((await g.app.inject({ url: '/api/v1/gotd', cookies })).json().game.title).toBe(second.title);
    expect(g.gotd.picks().map((p) => [p.title, p.skipped ?? false])).toEqual([
      [second.title, false],
      [first.title, true],
    ]);

    // The message: not before its hour (8 in Phoenix, UTC-7), then once that day.
    g.settings.update({ 'notifications.pushoverEnabled': true, 'notifications.pushoverToken': 't', 'notifications.pushoverUser': 'u' });
    const today = g.gotd.picks()[0]!.date;
    expect(await g.gotd.send(new Date(`${today}T13:00:00Z`))).toBe('Goes out at 8:00.');
    expect(await g.gotd.send(new Date(`${today}T15:30:00Z`))).toBe(`Sent: ${second.title} (PlayStation 3).`);
    expect(sent.push.at(-1)).toMatchObject({ title: expect.stringContaining(`game of the day: ${second.title}`), message: expect.stringContaining('pricecharting.com') });
    expect(await g.gotd.send(new Date(`${today}T18:00:00Z`))).toBe('Sent today already.');
  });
});
