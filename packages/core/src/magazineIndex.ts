/**
 * The magazine index (D181): cover dates for issues whose files don't say, before anyone names them by hand. Two ways:
 * a small table of magazines whose numbering is known (GameFan's volumes and issues), and an issue's number between two
 * dated issues of its magazine that came out one a month (Computer Gaming World's #41 and #42 between #40, October 1987,
 * and #43, January 1988).
 */

export interface IssueToDate {
  id: number;
  magazine: string;
  number: string | null;
  volume: string | null;
  /** Its date as known (the owner's, or its file's); null when it has none. */
  year: number | null;
  month: number | null;
}

export interface GuessedDate {
  id: number;
  year: number;
  month: number;
  /** index: from the table of known cover dates; numbering: worked out from its number between dated issues. */
  from: 'index' | 'numbering';
}

type YearMonth = [number, number];
const plus = ([y, m]: YearMonth, months: number): YearMonth => {
  const t = y * 12 + (m - 1) + months;
  return [Math.floor(t / 12), (t % 12) + 1];
};
const monthsOf = (y: number, m: number) => y * 12 + (m - 1);
const whole = (s: string | null) => (s !== null && /^\d+$/.test(s.trim()) ? Number(s.trim()) : null);

/**
 * GameFan (DieHard GameFan, 1992-2000), by volume and issue, from the Video Game History Foundation library's catalog:
 * volume 1 from October 1992 (no November issue; issue 4, February or March 1993, isn't known for sure), volume 2 from
 * December 1993, and from volume 3 (1995) the volume is the year's and the issue its month.
 */
function gameFan(volume: number, n: number): YearMonth | null {
  if (volume === 1) return ({ 1: [1992, 10], 2: [1992, 12], 3: [1993, 1], 5: [1993, 4], 6: [1993, 5], 7: [1993, 6], 8: [1993, 7], 9: [1993, 8], 10: [1993, 9], 11: [1993, 10], 12: [1993, 11] } as Record<number, YearMonth>)[n] ?? null;
  if (volume === 2 && n >= 1 && n <= 12) return plus([1993, 12], n - 1);
  if (volume >= 3 && volume <= 8 && n >= 1 && n <= 12) return [1992 + volume, n];
  return null;
}

/** A magazine's known cover date for a volume and issue, when the index has that magazine. */
export function indexedCoverDate(magazine: string, volume: string | null, number: string | null): YearMonth | null {
  const name = magazine.toLowerCase().replace(/[^a-z]/g, '');
  const v = whole(volume);
  const n = whole(number);
  if (n === null) return null;
  if (/(^|diehard)gamefan$/.test(name) && v !== null) return gameFan(v, n);
  return null;
}

/** The dates the index and the numbering give the issues without one; an issue with a date is never changed. */
export function guessDates(issues: readonly IssueToDate[]): GuessedDate[] {
  const out: GuessedDate[] = [];
  const dated = new Map<number, YearMonth>();
  for (const i of issues) if (i.year !== null && i.month !== null) dated.set(i.id, [i.year, i.month]);
  for (const i of issues) {
    if (i.year !== null) continue;
    const known = indexedCoverDate(i.magazine, i.volume, i.number);
    if (!known) continue;
    out.push({ id: i.id, year: known[0], month: known[1], from: 'index' });
    dated.set(i.id, known);
  }
  // Between two dated issues of the same magazine and volume whose numbers and months advance together, one a month.
  const groups = new Map<string, IssueToDate[]>();
  for (const i of issues) {
    if (whole(i.number) === null) continue;
    const key = `${i.magazine}\u0000${i.volume ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  for (const list of groups.values()) {
    const anchors = list.filter((i) => dated.has(i.id)).map((i) => ({ n: whole(i.number)!, at: dated.get(i.id)! })).sort((a, b) => a.n - b.n);
    for (const i of list) {
      if (dated.has(i.id)) continue;
      const n = whole(i.number)!;
      const before = anchors.filter((a) => a.n < n).at(-1);
      const after = anchors.find((a) => a.n > n);
      if (!before || !after) continue;
      if (monthsOf(...after.at) - monthsOf(...before.at) !== after.n - before.n) continue;
      const [year, month] = plus(before.at, n - before.n);
      out.push({ id: i.id, year, month, from: 'numbering' });
    }
  }
  return out;
}
