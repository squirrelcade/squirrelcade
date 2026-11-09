import { describe, expect, it } from 'vitest';
import { issueNumber, magazineGaps, type HeldIssue } from './magazineGaps.js';

const n = (number: number | string, year: number | null = null, month: number | null = null, volume: string | null = null): HeldIssue => ({ number: String(number), volume, year, month });

describe("what's missing from a magazine's run (D221)", () => {
  it('reads an issue number from its leading digits', () => {
    expect(issueNumber('042')).toBe(42);
    expect(issueNumber('31 Neo Geo')).toBe(31);
    expect(issueNumber('Special 1')).toBeNull();
    expect(issueNumber(null)).toBeNull();
  });

  it('lists the numbers between the ones you have, with their months when the run went one a month', () => {
    const gaps = magazineGaps([n(1, 1991, 1), n(2, 1991, 2), n(5, 1991, 5), n(9, 1991, 12)]);
    expect(gaps.first).toEqual({ number: 1, volume: null });
    expect(gaps.last).toEqual({ number: 9, volume: null });
    expect(gaps.missing.map((m) => [m.key, m.year, m.month, m.where])).toEqual([
      ['#3', 1991, 3, 'between'],
      ['#4', 1991, 4, 'between'],
      // Three numbers over six months: their months aren't known, only the issues on each side.
      ['#6', null, null, 'between'],
      ['#7', null, null, 'between'],
      ['#8', null, null, 'between'],
    ]);
    expect(gaps.missing[2]).toMatchObject({ after: [1991, 5], before: [1991, 12] });
    expect(gaps.jumps).toEqual([]);
  });

  it('says a jump apart when the numbers run ahead of the months (GamePro #80 to #91 in a month)', () => {
    const gaps = magazineGaps([n(79, 1996, 2), n(80, 1996, 3), n(91, 1996, 4), n(92, 1996, 5)], { fromOne: false });
    expect(gaps.missing).toEqual([]);
    expect(gaps.jumps).toEqual([{ key: 'jump:#80-91', volume: null, from: 80, to: 91, fromDate: [1996, 3], toDate: [1996, 4], months: 0 }]);
    // The owner's answers: no issues there, or they're all missing.
    expect(magazineGaps([n(80, 1996, 3), n(91, 1996, 4)], { fromOne: false, answers: new Map([['jump:#80-91', 'none']]) })).toMatchObject({ missing: [], jumps: [] });
    expect(magazineGaps([n(80, 1996, 3), n(91, 1996, 4)], { fromOne: false, answers: new Map([['jump:#80-91', 'missing']]) }).missing.map((m) => m.key)).toEqual(['#81', '#82', '#83', '#84', '#85', '#86', '#87', '#88', '#89', '#90']);
  });

  it('allows one extra issue a year before calling it a jump (a holiday issue: 13 a year)', () => {
    // PlayStation: The Official Magazine, #20 (June 2009) to #39 (December 2010): 18 numbers over 17 months.
    const ptom = magazineGaps([n(20, 2009, 6), n(39, 2010, 12), n(45, 2011, 5)], { fromOne: false });
    expect(ptom.jumps).toEqual([]);
    expect(ptom.missing).toHaveLength(18 + 5);
    // Their months aren't known (the numbers don't run one a month).
    expect(ptom.missing[0]).toMatchObject({ key: '#21', year: null, after: [2009, 6], before: [2010, 12] });
  });

  it("skips numbers that were never printed: no jump, and the months still line up (GamePro's #81-90)", () => {
    const never = new Map(Array.from({ length: 10 }, (_, i): [string, string] => [`#${81 + i}`, 'not']));
    expect(magazineGaps([n(80, 1996, 3), n(91, 1996, 4)], { fromOne: false, answers: never })).toMatchObject({ missing: [], jumps: [] });
    // #91 missing too: #92 is a month after #80, so #91 is April 1996.
    expect(magazineGaps([n(80, 1996, 3), n(92, 1996, 5)], { fromOne: false, answers: never }).missing.map((m) => [m.key, m.year, m.month])).toEqual([['#91', 1996, 4]]);
  });

  it('trusts the numbers over a misdated file, and over a pause (fewer numbers than months)', () => {
    // #162 dated after #164: the months can't be trusted, the numbers can.
    expect(magazineGaps([n(162, 2003, 1), n(164, 2002, 5)], { fromOne: false }).missing.map((m) => [m.key, m.year])).toEqual([['#163', null]]);
    // EGM's 2009-2010 pause: one number over fourteen months.
    expect(magazineGaps([n(236, 2009, 1), n(238, 2010, 4)], { fromOne: false }).missing.map((m) => m.key)).toEqual(['#237']);
  });

  it('counts from #1 ahead of the first you have, or from the first the owner named; past the last only to the last they named', () => {
    const opm = [n(88, 2004, 12), n(89, 2005, 1)];
    expect(magazineGaps(opm).missing.map((m) => m.key)).toHaveLength(87);
    expect(magazineGaps(opm).missing[0]).toMatchObject({ key: '#1', where: 'before', before: [2004, 12] });
    expect(magazineGaps(opm, { fromOne: false }).missing).toEqual([]);
    expect(magazineGaps(opm, { first: 86 }).missing.map((m) => m.key)).toEqual(['#86', '#87']);
    expect(magazineGaps(opm, { last: 91 }).missing.slice(-2).map((m) => [m.key, m.where])).toEqual([
      ['#90', 'after'],
      ['#91', 'after'],
    ]);
  });

  it("leaves out what the owner said isn't an issue, and doesn't count the unnumbered", () => {
    const gaps = magazineGaps([n(1), n(4), n('Special'), { number: null, volume: null, year: 1990, month: 1 }], { answers: new Map([['#2', 'not']]) });
    expect(gaps.missing.map((m) => m.key)).toEqual(['#3']);
    expect(gaps.unnumbered).toBe(2);
  });

  it('works by volume when numbers start again each volume (GameFan), filling a volume to the usual size', () => {
    const fan: HeldIssue[] = [];
    for (let v = 5; v <= 8; v++) for (let i = 1; i <= 12; i++) fan.push(n(i, 1992 + v, i, String(v)));
    // Volume 6 has #2, #4, #5, #6 and #8; volume 7 lacks #2.
    const gaps = magazineGaps(fan.filter((f) => !(f.volume === '6' && ![2, 4, 5, 6, 8].includes(Number(f.number))) && !(f.volume === '7' && f.number === '2')));
    expect(gaps.byVolume).toBe(true);
    expect(gaps.missing.map((m) => [m.key, m.year, m.month])).toEqual([
      ['v6#1', null, null],
      ['v6#3', 1998, 3],
      ['v6#7', 1998, 7],
      ['v6#9', null, null],
      ['v6#10', null, null],
      ['v6#11', null, null],
      ['v6#12', null, null],
      ['v7#2', 1999, 2],
    ]);
    expect(gaps.first).toEqual({ number: 1, volume: 5 });
    expect(gaps.last).toEqual({ number: 12, volume: 8 });
    // A volume missing whole between two you have.
    expect(magazineGaps([n(1, null, null, '1'), n(2, null, null, '1'), n(1, null, null, '3'), n(2, null, null, '3')]).missing.map((m) => m.key)).toEqual(['v2#1', 'v2#2']);
  });

  it('gives a magazine without numbers the months with no issue, at its usual pace', () => {
    const eg = [
      [1983, 11],
      [1983, 12],
      [1984, 1],
      [1984, 3],
      [1984, 4],
      [1984, 5],
      [1984, 6],
    ].map(([y, m]) => ({ number: null, volume: null, year: y!, month: m! }));
    expect(magazineGaps(eg).months).toEqual([{ key: '1984-02', year: 1984, month: 2 }]);
    expect(magazineGaps(eg, { answers: new Map([['1984-02', 'not']]) }).months).toEqual([]);
    // Every other month: nothing missing.
    const bimonthly = [1, 3, 5, 7, 9].map((m) => ({ number: null, volume: null, year: 1982, month: m }));
    expect(magazineGaps(bimonthly).months).toEqual([]);
    expect(magazineGaps([...bimonthly, { number: null, volume: null, year: 1983, month: 1 }]).months.map((m) => m.key)).toEqual(['1982-11']);
  });
});
