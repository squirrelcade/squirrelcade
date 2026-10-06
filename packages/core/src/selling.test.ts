import { describe, expect, it } from 'vitest';
import { ebaySoldUrl, listingDay, listingTitle, netOfSale, writeListing, type ListingInput } from './selling.js';

const RATCHET: ListingInput = {
  title: 'Ratchet & Clank',
  platformName: 'PlayStation 2',
  year: 2002,
  completeness: 'complete',
  media: 'disc',
  region: 'north-america',
  homeRegion: 'north-america',
  lastTest: { result: 'works', testedAt: '2026-09-29' },
  lastRip: null,
  genres: ['Platform', 'Shooter'],
  upc: '711719719926',
  photos: 5,
};

describe('listings', () => {
  it('titles a copy with its console, year, condition, region and a test that passed', () => {
    expect(listingTitle(RATCHET)).toBe('Ratchet & Clank (PlayStation 2, 2002) CIB Complete Tested');
    expect(listingTitle({ ...RATCHET, completeness: 'sealed', lastTest: null })).toBe('Ratchet & Clank (PlayStation 2, 2002) New Sealed');
    expect(listingTitle({ ...RATCHET, completeness: 'loose', media: 'cartridge', platformName: 'Super Nintendo', year: 1991, title: 'Super Mario World' })).toBe(
      'Super Mario World (Super Nintendo, 1991) Cartridge Only Tested',
    );
    expect(listingTitle({ ...RATCHET, region: 'europe' })).toBe('Ratchet & Clank (PlayStation 2, 2002) CIB Complete PAL Tested');
    // Never over 80: "Tested", then the year give way, then the name at a word.
    const long = { ...RATCHET, title: 'The Legend of Zelda: Twilight Princess Collectors Edition With Bonus Soundtrack', platformName: 'Nintendo GameCube' };
    expect(listingTitle(long).length).toBeLessThanOrEqual(80);
    expect(listingTitle(long)).toMatch(/\(Nintendo GameCube\) CIB Complete$/);
  });

  it("writes what comes with it, how it was tested and read, and the owner's lines", () => {
    const listing = writeListing({ ...RATCHET, lastRip: { result: 'works', testedAt: '2026-09-28' }, saleNote: 'Light wear on the case.', footer: 'Ships the next business day.' }, 'ebay');
    expect(listing.description).toBe(
      [
        'Ratchet & Clank for PlayStation 2 (2002).',
        'What you get: the disc, the case and the manual.',
        'The disc was read in full and verified without errors on September 28, 2026.',
        'Tested and working on September 29, 2026.',
        'Light wear on the case.',
        'The photos show the copy you will receive.',
        'Ships the next business day.',
      ].join('\n\n'),
    );
    expect(listing.condition).toEqual({ name: 'Used', id: 3000 });
    expect(listing.specifics).toEqual([
      { name: 'Platform', value: 'PlayStation 2' },
      { name: 'Game Name', value: 'Ratchet & Clank' },
      { name: 'Region Code', value: 'NTSC-U/C (US/Canada)' },
      { name: 'Release Year', value: '2002' },
      { name: 'Genre', value: 'Platform' },
      { name: 'UPC', value: '711719719926' },
    ]);
    // A copy that doesn't work is for parts; a sealed one is new; Mercari says good for a used copy.
    expect(writeListing({ ...RATCHET, lastTest: { result: 'broken', testedAt: '2026-09-29' } }, 'ebay').condition).toEqual({ name: 'For parts or not working', id: 7000 });
    expect(writeListing({ ...RATCHET, completeness: 'sealed' }, 'mercari').condition).toEqual({ name: 'New' });
    expect(writeListing(RATCHET, 'mercari').condition).toEqual({ name: 'Good' });
    // A cartridge ripped with a cartridge reader says so.
    expect(writeListing({ ...RATCHET, media: 'cartridge', lastRip: { result: 'works', testedAt: '2026-09-28' } }, 'ebay').description).toContain('The cartridge was read in full and verified without errors on September 28, 2026.');
    // Its days in the owner's date format, in words.
    expect(writeListing({ ...RATCHET, dateFormat: 'eu' }, 'ebay').description).toContain('Tested and working on 29 September 2026.');
    expect(writeListing({ ...RATCHET, dateFormat: 'iso' }, 'ebay').description).toContain('Tested and working on 2026-09-29.');
    expect(listingDay('2026-01-05')).toBe('January 5, 2026');
    expect(listingDay('not a day')).toBe('not a day');
    // Mercari takes up to 1,000 characters.
    expect(writeListing({ ...RATCHET, saleNote: 'x '.repeat(700) }, 'mercari').description.length).toBeLessThanOrEqual(1000);
  });

  it('works out what a sale brings after fees and shipping', () => {
    expect(netOfSale({ priceCents: 2500, feePercent: 13.6, orderFeeCents: 40, shippingCostCents: 500 })).toEqual({ feesCents: 380, netCents: 1620 });
    expect(netOfSale({ priceCents: 2500, shippingChargedCents: 500, feePercent: 10, shippingCostCents: 500 })).toEqual({ feesCents: 300, netCents: 2200 });
    expect(ebaySoldUrl('www.ebay.co.uk/', 'Okami', 'PlayStation 2')).toBe('https://www.ebay.co.uk/sch/i.html?_nkw=Okami%20PlayStation%202&_sacat=139973&LH_Sold=1&LH_Complete=1');
  });
});
