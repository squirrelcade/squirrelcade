import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

/** A stand-in for GameFly's search: its answers for a few made-up and real-shaped titles; every search recorded. */
function gameflySearch(asked: string[]) {
  const item = (id: number, title: string, platformId: number, offers: [boolean, number][]) => ({
    id,
    title,
    uriSafeTitle: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    platformId,
    productType: 'Game',
    offerActions: [{ offerActionType: 'Rent' }, ...offers.map(([used, amount]) => ({ offerActionType: 'Purchase', skuIsUsed: used, listPrice: { amount }, salePrice: null }))],
  });
  return async (_url: string, init: RequestInit) => {
    const term = (JSON.parse(String(init.body)) as { searchTerm: string }).searchTerm;
    asked.push(term);
    const items =
      term === 'Journey'
        ? [item(1, 'Journey', 1225, [[false, 19.99]]), item(2, 'Journey', 1080, [[false, 14.99], [true, 9.99], [true, 7.5]])]
        : term === 'Okami HD'
          ? [item(3, 'Okami HD', 1225, [])]
          : [];
    return Response.json({ itemPage: { items } });
  };
}

describe("GameFly's prices on the wishlist (D174)", () => {
  it("reads them in the background for the wishlist's games on its consoles, and keeps them", async () => {
    const asked: string[] = [];
    g = await testApp({ gameflyFetch: gameflySearch(asked) });
    const cookies = await setUp(g);
    seedCatalogs(g, { owned: [], catalogs: { 'playstation-3': ['Journey', 'Okami HD'], 'super-nintendo': ['Chrono Trigger'] } });
    const read = async () => (await g.app.inject({ url: '/api/v1/gamefly', cookies })).json() as { on: boolean; prices: { platformKey: string; title: string; newCents: number | null; usedCents: number | null; url: string | null }[] };
    // Off to start: nothing asked, nothing shown.
    expect(await g.gamefly.refresh()).toBe("GameFly's prices are off");
    expect(await read()).toEqual({ on: false, prices: [] });
    g.settings.update({ 'sources.gamefly': true });
    expect(await g.gamefly.refresh()).toMatch(/^1 of 2 wishlist games sold at GameFly/);
    // The Super Nintendo isn't a GameFly console: never asked about.
    expect(asked.sort()).toEqual(['Journey', 'Okami HD']);
    // The PlayStation 3's Journey (not the PS4's): its new price, its cheapest used one, and its page.
    expect((await read()).prices).toEqual([{ platformKey: 'playstation-3', title: 'Journey', newCents: 1499, usedCents: 750, url: 'https://www.gamefly.com/game/journey/2', checkedAt: expect.any(String) }]);
    // Kept: a restart reads them from the database, without asking GameFly.
    const again = asked.length;
    expect((g.gamefly as unknown as { kept: unknown }).kept).not.toBeNull();
    (g.gamefly as unknown as { kept: unknown }).kept = null;
    expect((await read()).prices).toHaveLength(1);
    expect(asked).toHaveLength(again);
  });
});
