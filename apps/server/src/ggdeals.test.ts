import { afterEach, describe, expect, it } from 'vitest';
import { GgDealsService, ggAsPcPrice } from './ggdeals.js';
import { testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

/** GG.deals as a fake: Half-Life 2: Episode Two (Steam app 420) priced, every other game unknown. */
async function fakeGgDeals(url: string): Promise<Response> {
  const ids = new URL(url).searchParams.get('ids')!.split(',');
  const priced = {
    title: 'Half-Life 2: Episode Two',
    url: 'https://gg.deals/game/half-life-2-episode-two/',
    prices: { currentRetail: '9.99', currentKeyshops: '4.30', historicalRetail: '2.89', historicalKeyshops: '1.61', currency: 'GBP' },
  };
  const data = Object.fromEntries(ids.map((id) => [id, id === '420' ? priced : null]));
  return new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } });
}

describe('GG.deals prices', () => {
  it('reads Steam games 100 at a time and keeps their retail and key shop prices', async () => {
    g = await testApp();
    g.settings.update({ 'sources.ggdealsKey': 'made-up-key', 'sources.ggdealsRegion': 'gb' });
    const asked: string[] = [];
    const gg = new GgDealsService(g.db, g.settings, (url) => (asked.push(url), fakeGgDeals(url)), undefined, 0);
    const ids = [420, ...Array.from({ length: 150 }, (_, i) => 1000 + i)];
    expect(await gg.read(ids)).toBe('GG.deals: prices for 1 of 151 Steam games');
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('key=made-up-key');
    expect(asked[0]).toContain('region=gb');
    const price = gg.prices().get(420)!;
    expect(price).toMatchObject({ currentCents: 999, keyshopCents: 430, lowCents: 289, lowKeyshopCents: 161, currency: 'GBP' });
    // As the PC wishlist shows it: GG.deals named (its link kept), at its lowest only when it is.
    expect(ggAsPcPrice(price)).toMatchObject({ shop: 'GG.deals', url: 'https://gg.deals/game/half-life-2-episode-two/', source: 'ggdeals', currentCents: 999, lowCents: 289, atLow: false, keyshopCents: 430 });
  });

  it('says when GG.deals refuses the key, and stops at its limit', async () => {
    g = await testApp();
    g.settings.update({ 'sources.ggdealsKey': 'wrong' });
    const refused = new GgDealsService(g.db, g.settings, async () => new Response('{}', { status: 401 }), undefined, 0);
    await expect(refused.read([420])).rejects.toThrow(/didn't take the API key/);
    const limited = new GgDealsService(g.db, g.settings, async () => new Response('{}', { status: 429 }), undefined, 0);
    expect(await limited.read([420])).toBe('GG.deals: prices for 0 of 0 Steam games');
  });
});
