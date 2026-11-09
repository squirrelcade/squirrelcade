import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeTransports, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp | undefined;
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await g?.cleanup();
  g = undefined;
});

const PS3 = ['Okami', 'Journey', 'Flower', 'Puppeteer', 'Tearaway', 'Ico'];
const WANTED = ['Demons Souls', 'Heavy Rain', 'Uncharted 2', 'Rain', 'Folklore'];

/** An install with six PS3 games owned, five to get, and the game of the day on. */
async function dayApp(): Promise<Record<string, string>> {
  g = await testApp();
  const cookies = await setUp(g);
  seedCatalogs(g, { owned: PS3.map((t, i): [string, string, string] => [String(i + 1), t, 'Playstation 3']), catalogs: { 'playstation-3': [...PS3, ...WANTED] } });
  g.settings.update({ 'gotd.enabled': true, 'general.timeZone': 'America/Phoenix' });
  return cookies;
}

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

  it("works the day's game out once and keeps it: asking again reads it, a new day works it out again (1.5.1)", async () => {
    const cookies = await dayApp();
    const app = g!;
    const ask = async () => (await app.app.inject({ url: '/api/v1/gotd', cookies })).json().game;
    const first = await ask();
    expect(WANTED).toContain(first.title);
    const kept = app.db.$client.prepare("SELECT value FROM app_state WHERE key = 'gotd.today'").get() as { value: string };
    expect(JSON.parse(kept.value)).toMatchObject({ date: first.date, view: { title: first.title, platform: 'PlayStation 3' } });

    // Asked again, nothing changed: the kept game, the wishlist not even asked.
    const compute = vi.spyOn(app.wishlist, 'compute');
    expect((await ask()).title).toBe(first.title);
    expect(compute).not.toHaveBeenCalled();
    // Today's answer carries the same game.
    expect((await app.app.inject({ url: '/api/v1/today', cookies })).json().gotd).toMatchObject({ title: first.title });

    // After a start the wishlist isn't worked out yet: the kept game comes at once, still without it.
    await app.restart();
    const compute2 = vi.spyOn(app.wishlist, 'compute');
    const again = (await app.app.inject({ url: '/api/v1/gotd', cookies })).json().game;
    expect(again).toMatchObject({ title: first.title, score: first.score, rank: first.rank, links: first.links });
    expect(compute2).not.toHaveBeenCalled();
    // The start's warm-up (the half-hourly task too) works it out again in the background; still the same game.
    await app.gotd.refresh();
    expect(app.wishlist.workedOut()).not.toBeNull();
    expect((await ask()).title).toBe(first.title);

    // Your preference, set on the card a moment ago, shows at once (the wishlist not worked out again yet).
    await app.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', cookies, payload: { platformKey: 'playstation-3', title: first.title, preference: 'Must Have', note: null } });
    expect(app.wishlist.workedOut()).toBeNull();
    expect(await ask()).toMatchObject({ title: first.title, preference: 'Must Have' });
    await app.gotd.refresh();
    expect(app.wishlist.workedOut()).not.toBeNull();

    // A new day: worked out again, a new pick kept for it.
    const tomorrow = new Date(Date.now() + 24 * 3_600_000);
    vi.useFakeTimers({ toFake: ['Date'], now: tomorrow });
    const compute3 = vi.spyOn(app.wishlist, 'compute');
    const next = await ask();
    expect(compute3).toHaveBeenCalled();
    expect(next.date).not.toBe(first.date);
    expect(next.title).not.toBe(first.title);
    expect(app.gotd.picks()[0]).toMatchObject({ date: next.date, title: next.title });
    expect(JSON.parse((app.db.$client.prepare("SELECT value FROM app_state WHERE key = 'gotd.today'").get() as { value: string }).value).date).toBe(next.date);
  });

  it('draws again once the kept game is bought or marked Do Not Recommend, without waiting for the wishlist', async () => {
    const cookies = await dayApp();
    const app = g!;
    const ask = async () => (await app.app.inject({ url: '/api/v1/gotd', cookies })).json().game;
    const first = await ask();
    // Marked just bought: its catalog game isn't missing any more, so it's drawn again at once.
    const entry = app.catalogs.titles('playstation-3')!.find((t) => t.title === first.title)!;
    expect((await app.app.inject({ method: 'POST', url: '/api/v1/purchases', cookies, payload: { entryId: entry.id } })).statusCode).toBeLessThan(300);
    const second = await ask();
    expect(WANTED).toContain(second.title);
    expect(second.title).not.toBe(first.title);
    expect((await ask()).title).toBe(second.title);
    // Do Not Recommend keeps it off the wishlist: another one.
    await app.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', cookies, payload: { platformKey: 'playstation-3', title: second.title, preference: 'Do Not Recommend', note: null } });
    const third = await ask();
    expect([first.title, second.title]).not.toContain(third.title);
  });
});
