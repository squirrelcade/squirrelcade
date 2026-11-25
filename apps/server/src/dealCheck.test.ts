import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { comingItems } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [
      ['1', 'Halo 3', 'Xbox 360'],
      ['2', 'Cars 2: The Video Game', 'Playstation 3'],
      ['3', 'Gears of War [Platinum Hits]', 'Xbox 360'],
    ],
    catalogs: { 'xbox-360': ['Halo 3', 'Halo Reach', 'Gears of War'], 'playstation-3': ['Cars 2: The Video Game', "Demon's Souls"] },
  });
});
afterEach(async () => {
  await g.cleanup();
});

const check = (items: unknown) => g.app.inject({ method: 'POST', url: '/api/v1/deal-check', cookies, payload: { items } });

describe('subtitleOf', () => {
  it('knows a subtitle or an edition from another game', async () => {
    const { subtitleOf } = await import('./dealCheck.js');
    expect(subtitleOf('Tiger Woods PGA Tour 12', 'Tiger Woods PGA Tour 12: The Masters')).toBe(true);
    expect(subtitleOf('Uncharted 2: Among Thieves', 'Uncharted 2: Among Thieves [Game Of The Year]')).toBe(true);
    expect(subtitleOf('Halo', 'Halo 3')).toBe(false);
    expect(subtitleOf('Halo Reach', 'Halo Reach')).toBe(false);
    expect(subtitleOf('Tiger Woods PGA Tour', 'Tiger Woods PGA Tour 12: The Masters')).toBe(false);
    const { sameWords } = await import('./dealCheck.js');
    expect(sameWords('Grand Theft Auto: Trilogy - The Definitive Edition', 'Grand Theft Auto: The Trilogy [Definitive Edition]')).toBe(true);
    expect(sameWords('Halo 3', 'Halo 3 ODST')).toBe(false);
  });
});

describe('deal-check corrections', () => {
  const correct = (payload: Record<string, unknown>) => g.app.inject({ method: 'POST', url: '/api/v1/deal-check/corrections', cookies, payload });
  it('reads a listing as the game you said, sure, from then on', async () => {
    const listing = 'Bungie Master Chief thing for 360';
    expect((await correct({ listing, kind: 'game', title: 'Halo 3', platformKey: 'xbox-360', wasTitle: 'Bungie Master Chief thing for 360' })).statusCode).toBe(200);
    const [r] = (await check([{ title: listing }])).json().results;
    expect(r).toMatchObject({ title: 'Halo 3', platformKey: 'xbox-360', answer: 'own', sure: 'sure', corrected: { kind: 'game', title: 'Halo 3' } });
    expect(r.why).toMatch(/^You told Squirrelcade this is Halo 3 \(Xbox 360\)/);
    const list = (await g.app.inject({ method: 'GET', url: '/api/v1/deal-check/corrections', cookies })).json().corrections;
    expect(list).toEqual([expect.objectContaining({ listing, kind: 'game', wasTitle: 'Bungie Master Chief thing for 360' })]);
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/deal-check/corrections?listing=${encodeURIComponent(listing)}`, cookies })).statusCode).toBe(200);
    const [after] = (await check([{ title: listing }])).json().results;
    expect(after.corrected).toBeNull();
  });

  it('keeps not-a-game and lots apart', async () => {
    await correct({ listing: 'Halo 3 Xbox 360 Controller Skin', kind: 'not-game' });
    await correct({ listing: 'Halo 3 + Gears of War Xbox 360 Bundle', kind: 'lot' });
    const [skin, lot] = (await check([{ title: 'Halo 3 Xbox 360 Controller Skin' }, { title: 'Halo 3 + Gears of War Xbox 360 Bundle' }])).json().results;
    expect(skin).toMatchObject({ answer: 'need', chest: 'none', corrected: { kind: 'not-game' } });
    expect(lot).toMatchObject({ answer: 'maybe', sure: 'unsure', corrected: { kind: 'lot' } });
  });

  it('turns down a correction it cannot keep', async () => {
    expect((await correct({ listing: 'x', kind: 'game' })).statusCode).toBe(400);
    expect((await correct({ listing: 'x', kind: 'game', title: 'Halo 3', platformKey: 'no-such' })).statusCode).toBe(400);
    expect((await correct({ kind: 'lot' })).statusCode).toBe(400);
  });
});

describe('POST /api/v1/deal-check', () => {
  it("answers each listing from the collection, on the listing's console", async () => {
    const res = await check([
      { title: 'Halo 3 - Xbox 360 Standard Edition' },
      { title: 'Halo 3 (PlayStation 3, 2007) Brand New' },
      { title: 'Halo Reach', platform: 'Xbox 360' },
      { title: 'Gears of War - Xbox 360' },
    ]);
    expect(res.statusCode).toBe(200);
    const [halo, elsewhere, reach, gears] = res.json().results;
    expect(halo).toMatchObject({ title: 'Halo 3', platformKey: 'xbox-360', answer: 'own', sure: 'sure', wishlist: null });
    expect(halo.priceChartingUrl).toContain('pricecharting.com');
    expect(elsewhere).toMatchObject({ answer: 'elsewhere', platformKey: 'playstation-3', ownedOn: ['Xbox 360'] });
    expect(elsewhere.why).toMatch(/you have it on Xbox 360, not this console/);
    expect(reach).toMatchObject({ title: 'Halo Reach', answer: 'need', platformKey: 'xbox-360' });
    expect(reach.why).toMatch(/console came from the page/);
    // The chest, the marks, the drawer's game and where a preference goes (D246).
    expect(halo).toMatchObject({ chest: 'own', drawer: { platformKey: 'xbox-360', title: 'Halo 3' }, preference: null });
    expect(halo.marks).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'xbox-360', owned: true })]));
    expect(halo.marks[0].svg).toMatch(/^<svg[\s\S]*Xbox 360 \(owned\)/);
    expect(elsewhere).toMatchObject({ chest: 'elsewhere', drawer: { platformKey: 'xbox-360', title: 'Halo 3' } });
    expect(reach).toMatchObject({ chest: 'none', drawer: { platformKey: 'xbox-360' }, preference: { platformKey: 'xbox-360', value: null } });
    expect(res.json().preferences[0]).toMatchObject({ name: 'Must Have', acorns: 20 });
    // A printing of the same game ("[Platinum Hits]") is the same game.
    expect(gears).toMatchObject({ answer: 'own', sure: 'sure', match: { title: 'Gears of War [Platinum Hits]' } });
  });

  it('is never more than pretty sure without a console', async () => {
    const [halo] = (await check([{ title: 'Halo 3' }])).json().results;
    expect(halo).toMatchObject({ answer: 'own', sure: 'likely', platformKey: null });
  });

  it('flags the kind of copy', async () => {
    const [r] = (await check([{ title: "Demon's Souls - PlayStation 3 [Digital Code]" }])).json().results;
    expect(r.flags).toEqual(['digital']);
  });

  it("keeps a preference given from the badge, and answers with it", async () => {
    const [reach] = (await check([{ title: 'Halo Reach', platform: 'Xbox 360' }])).json().results;
    const put = await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', cookies, payload: { platformKey: reach.preference.platformKey, title: reach.preference.title, preference: 'Must Have' } });
    expect(put.statusCode).toBe(200);
    const [again] = (await check([{ title: 'Halo Reach', platform: 'Xbox 360' }])).json().results;
    expect(again.preference.value).toBe('Must Have');
  });

  it('says when a game is on its way to you', async () => {
    g.settings.update({ 'orders.page': true });
    g.db
      .insert(comingItems)
      .values({ mailRef: 'test:1', itemIndex: 0, store: 'eBay', orderDate: '2026-11-20', listingTitle: 'Halo Reach Xbox 360 CIB', readBy: 'plain', platformKey: 'xbox-360', title: 'Halo Reach', status: 'waiting', createdAt: new Date().toISOString() })
      .run();
    const [reach, halo] = (await check([{ title: 'Halo Reach', platform: 'Xbox 360' }, { title: 'Halo 3 - Xbox 360' }])).json().results;
    expect(reach).toMatchObject({ chest: 'coming', onTheWay: { store: 'eBay', orderDate: '2026-11-20' } });
    // A game you have keeps its chest.
    expect(halo).toMatchObject({ chest: 'own', onTheWay: null });
  });

  it('takes 1 to 50 listings', async () => {
    expect((await check([])).statusCode).toBe(400);
    expect((await check(Array.from({ length: 51 }, () => ({ title: 'Halo 3' })))).statusCode).toBe(400);
    expect((await check([{ title: 7 }])).statusCode).toBe(400);
  });

  it('needs a sign-in', async () => {
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/deal-check', payload: { items: [{ title: 'Halo 3' }] } });
    expect(res.statusCode).toBe(401);
  });
});
