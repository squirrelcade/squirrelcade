import { describe, expect, it } from 'vitest';
import { DISC_CONSOLES, estimateCost, mediaOf, NEW_GAME_PRICES, parseNewGamePrices, photoSlotsFor, RIPPABLE_CONSOLES } from './copyCare.js';
import { KNOWN_PLATFORMS } from './platforms.js';
import { settingDefinitions } from './settings.js';

const SLOTS = { box: ['Box front', 'Box back'], inside: ['Inside'], game: ['{game} front', '{game} back'], manual: [] as string[] };
const copy = (completeness: string, parts: { hasBox: boolean; hasManual: boolean; sealed?: boolean }) => ({ completeness, sealed: false, ...parts });

describe("a copy's care", () => {
  it('rips, to start with, the disc consoles a PC drive with OmniDrive can read in full', () => {
    expect(RIPPABLE_CONSOLES).toEqual(expect.arrayContaining(['playstation', 'playstation-2', 'playstation-3', 'playstation-5', 'xbox', 'xbox-360', 'xbox-series-x', 'nintendo-gamecube', 'wii', 'wii-u', 'sega-saturn', '3do']));
    // PSP's UMDs and Dreamcast's GD-ROMs need their console; the rest are every disc console.
    expect(DISC_CONSOLES.filter((k) => !RIPPABLE_CONSOLES.includes(k))).toEqual(['psp', 'sega-dreamcast']);
    expect(settingDefinitions['collection.ripConsoles'].default).toEqual([...RIPPABLE_CONSOLES]);
  });

  it('knows what each console plays games from, following a region\'s own console to its base', () => {
    expect(mediaOf('playstation-2')).toBe('disc');
    expect(mediaOf('super-nintendo')).toBe('cartridge');
    expect(mediaOf('super-famicom')).toBe('cartridge');
    expect(mediaOf('nintendo-switch')).toBe('card');
    expect(mediaOf('pc-engine')).toBe('card');
    expect(mediaOf('sega-saturn-japan')).toBe('disc');
    expect(mediaOf('famicom-disk-system')).toBe('disk');
    expect(mediaOf('some-new-console')).toBe('cartridge');
  });

  it("names a copy's standard photos by what it has", () => {
    expect(photoSlotsFor(copy('complete', { hasBox: true, hasManual: true }), 'disc', SLOTS)).toEqual(['Box front', 'Box back', 'Inside', 'Disc front', 'Disc back']);
    // Sealed: only the outside of the box.
    expect(photoSlotsFor(copy('sealed', { hasBox: true, hasManual: true, sealed: true }), 'disc', SLOTS)).toEqual(['Box front', 'Box back']);
    // Loose: only the game.
    expect(photoSlotsFor(copy('loose', { hasBox: false, hasManual: false }), 'cartridge', SLOTS)).toEqual(['Cartridge front', 'Cartridge back']);
    // A box alone: the box, opened too, no game.
    expect(photoSlotsFor(copy('box-only', { hasBox: true, hasManual: false }), 'card', SLOTS)).toEqual(['Box front', 'Box back', 'Inside']);
    expect(photoSlotsFor(copy('complete', { hasBox: true, hasManual: true }), 'card', { ...SLOTS, manual: ['Manual front', ' Box front '] })).toEqual([
      'Box front',
      'Box back',
      'Inside',
      'Card front',
      'Card back',
      'Manual front',
    ]);
  });

  it('reads the usual prices of new games, and has one for every console it knows but three', () => {
    const prices = parseNewGamePrices(['PlayStation 2: 49.99', 'nintendo-switch = $59.99', 'Neo Geo: 199,99', 'nonsense', 'PSP:']);
    expect([...prices]).toEqual([
      ['playstation 2', 4999],
      ['nintendo-switch', 5999],
      ['neo geo', 19999],
    ]);
    const all = parseNewGamePrices(NEW_GAME_PRICES);
    const missing = KNOWN_PLATFORMS.filter((p) => !all.has(p.name.toLowerCase())).map((p) => p.key);
    // Japan's disk add-on, the Game & Watch (each is its own device) and the first Odyssey (no store price to speak of).
    expect(missing.sort()).toEqual(['famicom-disk-system', 'game-and-watch', 'magnavox-odyssey']);
  });

  it('estimates a copy bought new at its console\'s price and release, and one without its box at a share of it', () => {
    const prices = parseNewGamePrices(NEW_GAME_PRICES);
    const ratchet = { completeness: 'sealed', platformKey: 'playstation-2', platformName: 'PlayStation 2' };
    expect(estimateCost(ratchet, '2002-11-04', prices, 50)).toEqual({ cents: 4999, basis: 'new', newCents: 4999, date: '2002-11-04' });
    expect(estimateCost({ ...ratchet, completeness: 'loose' }, '2002-11-04', prices, 50)).toEqual({ cents: 2500, basis: 'used', newCents: 4999, date: null });
    // Another region's console takes its base console's price.
    expect(estimateCost({ completeness: 'complete', platformKey: 'super-famicom', platformName: 'Super Famicom' }, null, prices, 50)).toMatchObject({ cents: 5999, date: null });
    expect(estimateCost({ completeness: 'complete', platformKey: 'game-and-watch', platformName: 'Game & Watch' }, null, prices, 50)).toBeNull();
  });
});
