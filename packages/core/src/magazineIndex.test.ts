import { describe, expect, it } from 'vitest';
import { guessDates, indexedCoverDate } from './magazineIndex.js';

describe('the magazine index (D181)', () => {
  it("knows GameFan's volumes and issues", () => {
    expect(indexedCoverDate('GameFan', '1', '1')).toEqual([1992, 10]);
    expect(indexedCoverDate('DieHard GameFan', '1', '2')).toEqual([1992, 12]);
    expect(indexedCoverDate('GameFan', '1', '4')).toBeNull();
    expect(indexedCoverDate('GameFan', '1', '12')).toEqual([1993, 11]);
    expect(indexedCoverDate('GameFan', '2', '1')).toEqual([1993, 12]);
    expect(indexedCoverDate('GameFan', '2', '10')).toEqual([1994, 9]);
    expect(indexedCoverDate('GameFan', '6', '8')).toEqual([1998, 8]);
    expect(indexedCoverDate('GameFan', null, '8')).toBeNull();
    expect(indexedCoverDate('MegaFan', '1', '1')).toBeNull();
  });

  it('fills an issue between two dated ones that came out a month apart each, and nothing else', () => {
    const cgw = (id: number, number: string, year: number | null = null, month: number | null = null) => ({ id, magazine: 'Computer Gaming World', number, volume: null, year, month });
    const guessed = guessDates([
      cgw(1, '40', 1987, 10),
      cgw(2, '41'),
      cgw(3, '42'),
      cgw(4, '43', 1988, 1),
      // Three numbers over four months: not one a month, so not guessed.
      cgw(5, '71', 1990, 5),
      cgw(6, '72'),
      cgw(7, '74', 1990, 9),
      // Before the first dated issue: not guessed.
      cgw(8, '6'),
      cgw(9, '31 Neo Geo'),
    ]);
    expect(guessed).toEqual([
      { id: 2, year: 1987, month: 11, from: 'numbering' },
      { id: 3, year: 1987, month: 12, from: 'numbering' },
    ]);
  });

  it("never changes a date an issue has, and uses the index's dates as anchors", () => {
    const gf = (id: number, volume: string, number: string, year: number | null = null, month: number | null = null) => ({ id, magazine: 'GameFan', number, volume, year, month });
    expect(guessDates([gf(1, '3', '2', 2001, 1), gf(2, '3', '3')])).toEqual([{ id: 2, year: 1995, month: 3, from: 'index' }]);
  });
});
