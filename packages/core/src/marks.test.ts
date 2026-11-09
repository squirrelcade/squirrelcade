import { describe, expect, it } from 'vitest';
import { bannerMarks, consoleMark, coverMarks, CONSOLE_MARKS, markInk, markPixels } from './marks.js';
import { KNOWN_PLATFORMS } from './platforms.js';

describe("a cover's banner (the owner's rules, 2026-11-06)", () => {
  it('fills the places left with the newest other consoles it came out on, grey, and shows a game you lack on two greys', () => {
    // Not yours anywhere: the two newest it came out on, one per company, both grey.
    expect(bannerMarks([], ['nintendo-gamecube', 'playstation-2', 'xbox'])).toEqual([
      { key: 'nintendo-gamecube', owned: false },
      { key: 'xbox', owned: false },
    ]);
    // Yours on one: it in color, then the newest other console of another company, grey.
    expect(bannerMarks(['nintendo-gamecube'], ['nintendo-gamecube', 'playstation-2', 'wii'])).toEqual([
      { key: 'nintendo-gamecube', owned: true },
      { key: 'playstation-2', owned: false },
    ]);
    // Yours on three: the two newest you have it on, in color, nothing grey.
    expect(bannerMarks(['playstation-4', 'xbox-one', 'nintendo-switch', 'pc'], ['playstation-5'])).toEqual([
      { key: 'nintendo-switch', owned: true },
      { key: 'playstation-4', owned: true },
    ]);
    // Only one company to show: its next newest, grey.
    expect(bannerMarks(['nintendo-switch'], ['nintendo-switch', 'nintendo-switch-2'])).toEqual([
      { key: 'nintendo-switch', owned: true },
      { key: 'nintendo-switch-2', owned: false },
    ]);
    expect(bannerMarks([], [])).toEqual([]);
  });

  it("puts the cover's own console first on a cover of one console's version, then its other consoles (1.5.1)", () => {
    const megaMan2 = ['nintendo-entertainment-system', 'wii', 'wii-u', 'pc'];
    // The owner's Mega Man 2 (NES) on the game of the day: the NES first, grey, then the newest other console, grey.
    expect(bannerMarks([], megaMan2, 2, 'nintendo-entertainment-system')).toEqual([
      { key: 'nintendo-entertainment-system', owned: false },
      { key: 'wii-u', owned: false },
    ]);
    // Without a console of its own, as before: the two newest it came out on.
    expect(bannerMarks([], megaMan2)).toEqual([
      { key: 'wii-u', owned: false },
      { key: 'wii', owned: false },
    ]);
    // Yours there: in color.
    expect(bannerMarks(['nintendo-entertainment-system'], megaMan2, 2, 'nintendo-entertainment-system')).toEqual([
      { key: 'nintendo-entertainment-system', owned: true },
      { key: 'wii-u', owned: false },
    ]);
    // Yours on another console: that one next, in color, before the newest you don't have.
    expect(bannerMarks(['wii'], megaMan2, 2, 'nintendo-entertainment-system')).toEqual([
      { key: 'nintendo-entertainment-system', owned: false },
      { key: 'wii', owned: true },
    ]);
    // The next place goes to a company not shown yet, as before.
    expect(bannerMarks([], ['nintendo-gamecube', 'playstation-2', 'xbox'], 2, 'nintendo-gamecube')).toEqual([
      { key: 'nintendo-gamecube', owned: false },
      { key: 'xbox', owned: false },
    ]);
    // A console it isn't known to have come out on still comes first; PC never takes a console's place.
    expect(bannerMarks([], [], 2, 'super-famicom')).toEqual([{ key: 'super-famicom', owned: false }]);
    expect(bannerMarks(['pc'], megaMan2, 2, 'pc')).toEqual([
      { key: 'wii-u', owned: false },
      { key: 'wii', owned: false },
    ]);
  });
});

describe('console marks (D175)', () => {
  it('has a mark of its own for every console Squirrelcade knows, and one for a console it has none for', () => {
    expect(KNOWN_PLATFORMS.filter((p) => !CONSOLE_MARKS[p.key]).map((p) => p.key)).toEqual([]);
    expect(consoleMark('vectrex', 'Vectrex')).toMatchObject({ abbr: 'VEC', company: 'other' });
    expect(consoleMark('bandai-wonderswan-color', 'WonderSwan Color')).toMatchObject({ abbr: 'WC' });
  });

  it('draws a short name as a tile of pixel letters, its corners cut', () => {
    const rows = markPixels(consoleMark('playstation-2'));
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.length === 3 * 4 - 1 + 4)).toBe(true);
    expect(rows[0]![0]).toBe('.');
    expect(rows.join('')).toContain('+');
    expect(markPixels(consoleMark('nintendo-switch'))).toHaveLength(8);
    expect(markInk('#FFFFFF')).toBe('#1A1A1A');
    expect(markInk('#003791')).toBe('#FFFFFF');
  });

  it("puts the two newest consoles on a cover, one per company, PC apart (the owner's rules)", () => {
    // The PS5, an Xbox and the Switch 2: the two newest of different companies.
    expect(coverMarks(['xbox-one', 'playstation-5', 'nintendo-switch-2', 'pc'])).toEqual(['nintendo-switch-2', 'playstation-5']);
    // Two of one company only when that's all there is.
    expect(coverMarks(['nintendo-switch', 'nintendo-switch-2'])).toEqual(['nintendo-switch-2', 'nintendo-switch']);
    expect(coverMarks(['playstation-4', 'playstation-5', 'xbox-one'])).toEqual(['playstation-5', 'xbox-one']);
    expect(coverMarks(['pc'])).toEqual([]);
    expect(coverMarks(['super-nintendo'])).toEqual(['super-nintendo']);
  });
});
