import { describe, expect, it } from 'vitest';
import { consoleMark, coverMarks, CONSOLE_MARKS, markInk, markPixels } from './marks.js';
import { KNOWN_PLATFORMS } from './platforms.js';

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
