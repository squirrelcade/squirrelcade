import { describe, expect, it } from 'vitest';
import { settingDefinitions } from './settings.js';
import { priceChartingUrl, shopLinks, shopLinksFor, shopUrl } from './shops.js';

describe('shop links', () => {
  it('reads "Name | address" lines, leaving out the ones that are not links with a title', () => {
    expect(
      shopLinks([
        'eBay | https://www.ebay.com/sch/i.html?_nkw={title}+{platform}',
        '  Local shop|https://shop.example.test/search?q={title}  ',
        'No title | https://shop.example.test/',
        'No bar https://shop.example.test/?q={title}',
        'Not a link | javascript:alert({title})',
      ]),
    ).toEqual([
      { name: 'eBay', template: 'https://www.ebay.com/sch/i.html?_nkw={title}+{platform}', platforms: null },
      { name: 'Local shop', template: 'https://shop.example.test/search?q={title}', platforms: null },
    ]);
  });

  it('keeps a link to the consoles named after a second bar', () => {
    const lines = ['eBay | https://www.ebay.com/sch/i.html?_nkw={title}', 'Deku Deals | https://www.dekudeals.com/search?q={title} | Nintendo Switch, Switch 2'];
    expect(shopLinks(lines)[1]).toEqual({ name: 'Deku Deals', template: 'https://www.dekudeals.com/search?q={title}', platforms: ['nintendo-switch', 'nintendo-switch-2'] });
    expect(shopLinksFor(lines, 'nintendo-switch-2').map((s) => s.name)).toEqual(['eBay', 'Deku Deals']);
    expect(shopLinksFor(lines, 'playstation-5').map((s) => s.name)).toEqual(['eBay']);
    // Consoles Squirrelcade doesn't know leave the link on none.
    expect(shopLinks(['Odd | https://odd.example.test/?q={title} | Nothing Real'])[0]!.platforms).toEqual([]);
  });

  it('keeps the group a fourth part names, with the consoles part empty for every console', () => {
    expect(shopLinks(['Mercari | https://www.mercari.com/search/?keyword={title} | | Used marketplaces'])[0]).toEqual({
      name: 'Mercari',
      template: 'https://www.mercari.com/search/?keyword={title}',
      platforms: null,
      group: 'Used marketplaces',
    });
    // Every ready-made link is valid, in a group, and each console it names is one Squirrelcade knows.
    const defaults = settingDefinitions['interface.shopLinks'].default;
    const parsed = shopLinks(defaults);
    expect(parsed).toHaveLength(defaults.length);
    for (const [i, line] of defaults.entries()) {
      const named = (line.split('|')[2] ?? '').split(',').map((c) => c.trim()).filter(Boolean);
      expect(parsed[i]!.group, line).toBeTruthy();
      if (named.length > 0) expect(parsed[i]!.platforms, line).toHaveLength(named.length);
    }
  });

  it("puts a game's title and console into the address", () => {
    expect(shopUrl('https://www.ebay.com/sch/i.html?_nkw={title}+{platform}', 'Mario & Luigi: Superstar Saga', 'Game Boy Advance')).toBe(
      'https://www.ebay.com/sch/i.html?_nkw=Mario%20%26%20Luigi%3A%20Superstar%20Saga+Game%20Boy%20Advance',
    );
    expect(priceChartingUrl('Okami', 'Playstation 3')).toBe('https://www.pricecharting.com/search-products?type=prices&q=Okami%20Playstation%203');
  });

  it('refuses a setting value that is not a shop link', () => {
    const schema = settingDefinitions['interface.shopLinks'].schema;
    expect(schema.safeParse(['eBay | https://www.ebay.com/sch/i.html?_nkw={title}']).success).toBe(true);
    expect(schema.safeParse(['Deku Deals | https://www.dekudeals.com/search?q={title} | Nintendo Switch']).success).toBe(true);
    expect(schema.safeParse(['eBay | https://www.ebay.com/']).success).toBe(false);
    expect(schema.safeParse([]).success).toBe(true);
    // The starting list is valid, and has Deku Deals for the Switch consoles only.
    expect(schema.safeParse(settingDefinitions['interface.shopLinks'].default).success).toBe(true);
  });
});
