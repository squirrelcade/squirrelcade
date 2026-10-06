import { describe, expect, it } from 'vitest';
import { dealHtml } from './deals.js';

describe('the deal email', () => {
  it("shows the game's box art, its console and place on the wishlist, the price and the listing", () => {
    const html = dealHtml({ title: 'Tales & Graces', console: 'PlayStation 3', rank: 4, price: "It's listed on eBay for $19.99 (PriceCharting).", coverId: 'co1abc', url: 'https://www.ebay.com/itm/555?a=1&b=2' });
    expect(html).toContain('<img src="https://images.igdb.com/igdb/image/upload/t_cover_small/co1abc.jpg"');
    expect(html).toContain('Tales &amp; Graces');
    expect(html).toContain('PlayStation 3 &middot; #4 on your wishlist');
    expect(html).toContain('href="https://www.ebay.com/itm/555?a=1&amp;b=2"');
    // Without box art or a listing, neither shows.
    const bare = dealHtml({ title: 'Okami', console: 'Wii', rank: 1, price: '', coverId: null, url: null });
    expect(bare).not.toContain('<img');
    expect(bare).not.toContain('See the listing');
  });
});
