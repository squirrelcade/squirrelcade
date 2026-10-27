import { describe, expect, it } from 'vitest';
import { citationMonth, citedIssueNumber, magazineOf, printedPage } from './magazineCitation.js';

describe("a review's citation in the owner's magazines (D191)", () => {
  const mine = ['Electronic Gaming Monthly', 'Nintendo Power', 'GamePro', 'Official U.S. PlayStation Magazine'];
  it('finds the magazine by its name or what Wikipedia calls it', () => {
    expect(magazineOf('EGM', mine)).toBe('Electronic Gaming Monthly');
    expect(magazineOf('[[Electronic Gaming Monthly]]', mine)).toBe('Electronic Gaming Monthly');
    expect(magazineOf("''Nintendo Power''", mine)).toBe('Nintendo Power');
    expect(magazineOf('Official U.S. PlayStation Magazine', mine)).toBe('Official U.S. PlayStation Magazine');
    expect(magazineOf('Famitsu', mine)).toBeNull();
  });
  it('reads the month, the page and the issue', () => {
    expect(citationMonth('1994-06')).toEqual({ year: 1994, month: 6 });
    expect(citationMonth('June 1994')).toEqual({ year: 1994, month: 6 });
    expect(citationMonth('Jun 1994')).toEqual({ year: 1994, month: 6 });
    expect(citationMonth('1994')).toEqual({ year: 1994, month: null });
    expect(printedPage('pp. 28-30')).toBe(28);
    expect(printedPage(null)).toBeNull();
    expect(citedIssueNumber('#59')).toBe(59);
    expect(citedIssueNumber('59')).toBe(59);
    expect(citedIssueNumber('June')).toBeNull();
  });
});
