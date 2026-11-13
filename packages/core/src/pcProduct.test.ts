import { describe, expect, it } from 'vitest';
import { priceChartingProductFromUrl, priceChartingProductUrl, productDisagreements, readPriceChartingPage } from './pcProduct.js';

/** The part of a product page that matters, as PriceCharting writes it. */
const page = (name: string, console: string, id = '58604') => `<!DOCTYPE html>
<html lang="en"><head>
  <title>${name} Prices ${console} | Compare Loose, CIB &amp; New Prices
</title></head><body>
<div id="game-page" itemscope itemtype="http://schema.org/VideoGame">
    <h1 id="product_name" class="chart_title" title="${id}">
        ${name}
        <a href="/console/nintendo-switch">
            ${console}
        </a>
    </h1>
</div></body></html>`;

describe("a PriceCharting product's name and console", () => {
  it('reads them from the heading of its page, with the ID the page gives', () => {
    expect(readPriceChartingPage(page('Hollow Knight', 'Nintendo Switch'))).toEqual({ id: '58604', title: 'Hollow Knight', consoleName: 'Nintendo Switch' });
    expect(readPriceChartingPage(page('Ratchet &amp; Clank [Greatest Hits]', 'Playstation 2', '1234'))).toEqual({ id: '1234', title: 'Ratchet & Clank [Greatest Hits]', consoleName: 'Playstation 2' });
    expect(readPriceChartingPage(page('Mario Kart 8 Deluxe', 'PAL Nintendo Switch'))?.consoleName).toBe('PAL Nintendo Switch');
  });

  it('falls back on the page title, and gives up on a page that is neither', () => {
    expect(readPriceChartingPage('<html><head><title>Okami Prices Playstation 2 | Compare Loose, CIB &amp; New Prices</title></head></html>')).toEqual({ id: null, title: 'Okami', consoleName: 'Playstation 2' });
    expect(readPriceChartingPage('<html><head><title>Search results</title></head><body>Nothing here</body></html>')).toBeNull();
  });

  it("reads the address an ID's page leads to, when the page itself can't be read", () => {
    expect(priceChartingProductUrl('58604')).toBe('https://www.pricecharting.com/game/58604');
    expect(priceChartingProductFromUrl('https://www.pricecharting.com/game/nintendo-switch/hollow-knight')).toEqual({ id: null, title: 'Hollow Knight', consoleName: 'Nintendo Switch' });
    expect(priceChartingProductFromUrl('https://www.pricecharting.com/game/pal-playstation-4/bloodborne')?.consoleName).toBe('PAL Playstation 4');
    expect(priceChartingProductFromUrl('https://www.pricecharting.com/search-products?q=okami')).toBeNull();
  });
});

describe('an ID beside the copy it was given to', () => {
  const copy = { title: 'Hollow Knight', platformKey: 'nintendo-switch', region: 'north-america' };
  const product = (title: string, consoleName = 'Nintendo Switch', platformKey: string | null = 'nintendo-switch', region = 'north-america') => ({ title, consoleName, platformKey, region });

  it('agrees on the same game and console, however the title is written', () => {
    expect(productDisagreements(copy, product('Hollow Knight'))).toEqual([]);
    expect(productDisagreements({ ...copy, title: 'HOLLOW KNIGHT' }, product('Hollow Knight'))).toEqual([]);
  });

  it('says when the ID is another game, edition, console or region', () => {
    expect(productDisagreements(copy, product('Celeste'))).toEqual(['PriceCharting calls it "Celeste"']);
    expect(productDisagreements(copy, product('Hollow Knight', 'Playstation 4', 'playstation-4'))).toEqual(['Another console: Playstation 4']);
    expect(productDisagreements(copy, product('Hollow Knight', 'PAL Nintendo Switch', 'nintendo-switch', 'europe'))).toEqual(['Another region: PAL Nintendo Switch']);
    expect(productDisagreements({ ...copy, title: 'Yakuza 0' }, product("Yakuza 0 Director's Cut"))[0]).toMatch(/^(Another edition|PriceCharting calls it)/);
    // Both at once: the wrong line copied.
    expect(productDisagreements(copy, product('Okami', 'Playstation 2', 'playstation-2'))).toEqual(['PriceCharting calls it "Okami"', 'Another console: Playstation 2']);
  });
});
