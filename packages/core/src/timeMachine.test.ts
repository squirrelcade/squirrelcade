import { describe, expect, it } from 'vitest';
import { coverLeadFor, nowInDates, windowDaysFor } from './timeMachine.js';

describe('Now in and the Time machine (D190)', () => {
  it("goes back a decade at a time from today's day and month", () => {
    expect(nowInDates('2026-10-26', 5)).toEqual([
      { date: '2016-10-26', label: 'Now in the 2010s' },
      { date: '2006-10-26', label: 'Now in the 2000s' },
      { date: '1996-10-26', label: 'Now in the 1990s' },
      { date: '1986-10-26', label: 'Now in the 1980s' },
      { date: '1976-10-26', label: 'Now in the 1970s' },
    ]);
    // A leap day in a year without one.
    expect(nowInDates('2028-02-29', 1)).toEqual([{ date: '2018-02-28', label: 'Now in the 2010s' }]);
  });

  it("spans a decade's own window, and a magazine's own lead", () => {
    expect(windowDaysFor('1976-10-26', 14, ['1970s: 60'])).toBe(60);
    expect(windowDaysFor('1996-10-26', 14, ['1970s: 60'])).toBe(14);
    expect(coverLeadFor('Nintendo Power', 1, ['Nintendo Power: 2'])).toBe(2);
    expect(coverLeadFor('GamePro', 1, ['Nintendo Power: 2'])).toBe(1);
  });
});
