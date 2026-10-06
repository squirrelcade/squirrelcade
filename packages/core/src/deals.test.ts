import { describe, expect, it } from 'vitest';
import { listingPart, parseDealEmail } from './deals.js';

/** A wishlist deal email in PriceCharting's shape (made up: game, prices and listing). */
export const DEAL_HTML = `
<div>We found an eBay deal from your wishlist.<br><br>
Someone listed <a href="https://www.PriceCharting.com/game/1234?utm_source=email&amp;utm_medium=email">
Okami HD for Nintendo Switch</a> for sale on eBay AND <b>it's below the market value</b>.
<br/><a href="https://www.ebay.com/itm/111222333?mkevt=1&amp;campid=1&amp;customid=abc"><img src="https://i.ebayimg.com/images/g/abc/s-l225.jpg" alt="Okami HD | Nintendo Switch"/></a>
<br/><span style="font-size: 12px;">Title:</span>:
<a href="https://www.ebay.com/itm/111222333?mkevt=1&amp;campid=1"><span style="font-weight: bold;">Okami HD Nintendo Switch Complete Tested</span></a>
<br/><span style="font-size: 12px;">Price:</span> <span style="font-size: 24px;font-weight: bold;"> $19.99</span>
<br/><span style="font-size: 12px;">Save:</span> <span style="font-size: 24px;font-weight: bold;"> $7.51</span>
<a href="https://www.PriceCharting.com/wishlist">Your Wishlist</a></div>`;

describe('deals from PriceCharting', () => {
  it("reads a wishlist deal email: the game, its console, the price and the eBay listing", () => {
    expect(parseDealEmail('[Wishlist Deal] Buy Okami HD below market price', DEAL_HTML)).toEqual({
      title: 'Okami HD',
      console: 'Nintendo Switch',
      priceCents: 1999,
      saveCents: 751,
      listingTitle: 'Okami HD Nintendo Switch Complete Tested',
      listingUrl: 'https://www.ebay.com/itm/111222333',
      imageUrl: 'https://i.ebayimg.com/images/g/abc/s-l225.jpg',
      priceChartingUrl: 'https://www.PriceCharting.com/game/1234',
    });
  });

  it('splits the console at the last "for", and leaves other emails alone', () => {
    const html = DEAL_HTML.replace('Okami HD for Nintendo Switch', 'Ready for Battle for Wii');
    expect(parseDealEmail('[Wishlist] Buy Ready for Battle', html)).toMatchObject({ title: 'Ready for Battle', console: 'Wii' });
    expect(parseDealEmail('Your Exported Collection: Video Games', DEAL_HTML)).toBeNull();
    expect(parseDealEmail('[Wishlist Deal] Buy X', '<p>No listing here</p>')).toBeNull();
    // A deal without a Save line says so.
    expect(parseDealEmail('[Wishlist] Buy Okami HD', DEAL_HTML.replace(/<span[^>]*>Save:[\s\S]*?\$7\.51<\/span>/, ''))).toMatchObject({ saveCents: null, priceCents: 1999 });
  });
});

describe('a listing of a part without the game', () => {
  it("knows a manual, a case or a box listed alone, by the listing's own title", () => {
    // Listings PriceCharting's deal emails sent (2026-10), each compared with a whole game's market value.
    expect(listingPart('Case Only Civilization VII Switch 2')).toBe('Case only');
    expect(listingPart('Armored Core For Answer Xbox 360 Manual Only')).toBe('Manual only');
    expect(listingPart('Armored Core: For Answer - Microsoft Xbox 360 - Authentic Manual Only')).toBe('Manual only');
    expect(listingPart('Blitz The League II Microsoft Xbox 360 Game Manual Booklet Only No Game')).toBe('Manual only');
    expect(listingPart('Dragonball Z for Kinect Xbox 360 - Case. Manual, and Kinect Calibration ONLY')).toBe('Parts only');
    expect(listingPart('SKYLANDERS SPYROS ADVENTURE - PLAYSTATION 3 PS3 - INSTRUCTION MANUAL')).toBe('Manual only');
    expect(listingPart('Halo 3 Xbox 360 Box Only')).toBe('Box only');
    expect(listingPart('Halo 3 Xbox 360 (No Game) Case & Artwork')).toBe('No game');
    expect(listingPart('Empty Replacement Case for Zelda Wind Waker GameCube')).toBe('Case only');
    expect(listingPart('EarthBound SNES Repro Cart')).toBe('Reproduction');
    expect(listingPart('Halo 3 Official Strategy Guide Prima')).toBe('Strategy guide');
  });

  it('leaves the game alone: a disc or a cartridge by itself, and a whole copy that lists its parts', () => {
    for (const title of [
      'Microsoft Left 4 Dead disc only (Xbox 360)',
      'Left 4 Dead (Microsoft Xbox 360) Disc Only - Tested - Free Shipping',
      'DRAGON BALL Sparking! ZERO - Nintendo Switch - Cartridge Only, Used NO Case',
      'Valve Left 4 Dead Microsoft Xbox 360 Manual/Case/Disc NTSC-U/C M 2008',
      'Valve Left 4 Dead GOTY Edition Xbox 360 NTSC-U/C Manual Included',
      // A plain "Manual" at the end: this one was the game, at $75.
      'Activision Spider-Man: Web of Shadows Xbox 360 NTSC-U/C T 2008 Manual',
      'Scene It? Box Office Smash / Xbox 360 Video Game / Disc Manual & Case SEALED Yay',
      'Transformers: Fall of Cybertron Xbox 360 W/Slipcover Complete in Box CiB',
      'NCAA Football 14 (Xbox 360) RARE WALMART COVER - Untested',
      'EarthBound SNES authentic cart with repro box',
      'X-Men Origins: Wolverine (Xbox 360) CIB Tested Authentic Complete Code Variant',
    ]) {
      expect([title, listingPart(title)]).toEqual([title, null]);
    }
    expect(listingPart(null)).toBeNull();
  });
});
