/**
 * What's missing from a magazine's run (D221): the issues between the first and last you have that you don't, worked
 * out from the numbers and cover dates of the ones you do, with nothing to look up. Where the numbers run ahead of the
 * months between two issues (GamePro's #80, March 1996, then #91, April 1996), past one extra issue a year (a holiday
 * issue), the magazine skipped numbers or a file's number is off: that's a jump, said apart, not ten missing issues. A magazine without numbers (Electronic Games) has
 * the months with no issue instead, at its usual pace. The owner's answers ("not an issue", "no issues there") and the
 * first and last issue they name for a run are kept and win.
 */

/** An issue you have, as its file or the owner names it. */
export interface HeldIssue {
  number: string | null;
  volume: string | null;
  year: number | null;
  month: number | null;
}

type YearMonth = [number, number];

/** An issue missing from the run. */
export interface MissingIssue {
  /** Its key for the owner's answers: "#237", or "v6#1" for a magazine numbered by volume. */
  key: string;
  number: number;
  /** Its volume, for a magazine whose numbers start again each volume (GameFan). */
  volume: number | null;
  /** Its cover month, when the issues around it ran one a month; null otherwise. */
  year: number | null;
  month: number | null;
  /** The cover months of the issues you have on each side, when its own isn't known. */
  after: YearMonth | null;
  before: YearMonth | null;
  /** between: inside your run; before: ahead of the first you have (from #1, or the first the owner named); after: past your last, up to the last the owner named. */
  where: 'between' | 'before' | 'after';
}

/** More numbers than months between two issues you have: numbers skipped, or a file's number off. */
export interface NumberJump {
  /** Its key for the owner's answer: "jump:#80-91". */
  key: string;
  volume: number | null;
  /** The numbers you have on each side. */
  from: number;
  to: number;
  fromDate: YearMonth;
  toDate: YearMonth;
  /** The months between the two with no issue (0: none at all). */
  months: number;
}

/** A month with no issue, for a magazine without numbers. */
export interface MissingMonth {
  /** Its key for the owner's answers: "1984-02". */
  key: string;
  year: number;
  month: number;
}

export interface MagazineGaps {
  missing: MissingIssue[];
  jumps: NumberJump[];
  months: MissingMonth[];
  /** The lowest and highest numbers you have (in their volumes, for one numbered by volume). */
  first: { number: number; volume: number | null } | null;
  last: { number: number; volume: number | null } | null;
  /** Issues you have without a number (a special, an annual): not counted. */
  unnumbered: number;
  byVolume: boolean;
}

export interface GapOptions {
  /** The run's first issue as the owner named it; null: #1 when fromOne is on. */
  first?: number | null;
  /** The run's last issue as the owner named it; null: unknown (the last you have). */
  last?: number | null;
  /** Count the issues before the first you have, from #1 (or the first the owner named). */
  fromOne?: boolean;
  /** The owner's answers, by key: "not" (not an issue: never printed, or not a gap), and for a jump "none" (no issues there) or "missing" (they're all missing). */
  answers?: ReadonlyMap<string, string>;
}

const monthsOf = ([y, m]: YearMonth) => y * 12 + (m - 1);
const plus = ([y, m]: YearMonth, months: number): YearMonth => {
  const t = y * 12 + (m - 1) + months;
  return [Math.floor(t / 12), (t % 12) + 1];
};
/** An issue's number: its leading digits ("31 Neo Geo" is 31); null when it doesn't start with one. */
export const issueNumber = (s: string | null): number | null => {
  const m = s === null ? null : /^\s*0*(\d{1,5})(?!\d)/.exec(s);
  return m ? Number(m[1]) : null;
};
const dateOf = (i: HeldIssue): YearMonth | null => (i.year !== null && i.month !== null && i.month >= 1 && i.month <= 12 ? [i.year, i.month] : null);
const keyOf = (volume: number | null, n: number) => (volume === null ? `#${n}` : `v${volume}#${n}`);

/** The most common of some numbers (the smallest of those tied); null for none. */
function mode(values: number[]): number | null {
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: number | null = null;
  let bestCount = 0;
  for (const [v, c] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

interface Held {
  n: number;
  at: YearMonth | null;
}

/** One numbered run's gaps (a magazine's, or a volume's). */
function runGaps(list: Held[], volume: number | null, answers: ReadonlyMap<string, string>, out: MagazineGaps, ends: { from?: number; to?: number; outer: boolean }): void {
  const add = (n: number, where: MissingIssue['where'], at: YearMonth | null, after: YearMonth | null, before: YearMonth | null) => {
    const key = keyOf(volume, n);
    if (answers.get(key) === 'not') return;
    out.missing.push({ key, number: n, volume, year: at?.[0] ?? null, month: at?.[1] ?? null, after: at ? null : after, before: at ? null : before, where });
  };
  if (list.length === 0) {
    for (let n = ends.from ?? 1; n <= (ends.to ?? 0); n++) add(n, 'between', null, null, null);
    return;
  }
  // Ahead of the run's first issue: "before" at the magazine's start, "between" at a volume's inside the run.
  if (ends.from !== undefined) for (let n = ends.from; n < list[0]!.n; n++) add(n, ends.outer ? 'before' : 'between', null, null, list[0]!.at);
  for (let k = 1; k < list.length; k++) {
    const a = list[k - 1]!;
    const b = list[k]!;
    // The numbers between them, less the ones never printed (the owner's Not an issue, or the magazine index's).
    const real: number[] = [];
    for (let n = a.n + 1; n < b.n; n++) if (answers.get(keyOf(volume, n)) !== 'not') real.push(n);
    const gap = real.length;
    if (gap <= 0) continue;
    const months = a.at && b.at ? monthsOf(b.at) - monthsOf(a.at) - 1 : null;
    // More numbers than months between them, past one extra issue a year (a holiday issue made 13 a year): a jump,
    // unless the owner said otherwise.
    if (months !== null && months >= 0 && gap > months + Math.ceil((months + 2) / 12)) {
      const key = `jump:${volume === null ? '' : `v${volume}`}#${a.n}-${b.n}`;
      const answer = answers.get(key);
      if (answer === 'none') continue;
      if (answer !== 'missing') {
        out.jumps.push({ key, volume, from: a.n, to: b.n, fromDate: a.at!, toDate: b.at!, months });
        continue;
      }
    }
    // One a month across the gap: each one's month is known.
    const monthly = months !== null && months === gap;
    real.forEach((n, i) => add(n, 'between', monthly ? plus(a.at!, i + 1) : null, a.at, b.at));
  }
  if (ends.to !== undefined) for (let n = list.at(-1)!.n + 1; n <= ends.to; n++) add(n, ends.outer ? 'after' : 'between', null, list.at(-1)!.at, null);
}

/** What's missing from a magazine's run, from the issues you have (see the file's comment). */
export function magazineGaps(held: readonly HeldIssue[], options: GapOptions = {}): MagazineGaps {
  const answers = options.answers ?? new Map<string, string>();
  const fromOne = options.fromOne ?? true;
  const out: MagazineGaps = { missing: [], jumps: [], months: [], first: null, last: null, unnumbered: 0, byVolume: false };
  const numbered: { n: number; v: number | null; at: YearMonth | null }[] = [];
  for (const i of held) {
    const n = issueNumber(i.number);
    if (n === null) out.unnumbered++;
    else numbered.push({ n, v: issueNumber(i.volume), at: dateOf(i) });
  }

  if (numbered.length === 0) {
    // No numbers: the months with no issue, at the magazine's usual pace (one a month, every other month...).
    const months = [...new Set(held.map(dateOf).filter((d): d is YearMonth => d !== null).map(monthsOf))].sort((a, b) => a - b);
    const pace = mode(months.slice(1).map((m, k) => m - months[k]!));
    if (pace === null || pace < 1) return out;
    for (let k = 1; k < months.length; k++) {
      for (let m = months[k - 1]! + pace; m < months[k]!; m += pace) {
        const [year, month] = plus([0, 1], m);
        const key = `${year}-${String(month).padStart(2, '0')}`;
        if (answers.get(key) !== 'not') out.months.push({ key, year, month });
      }
    }
    return out;
  }

  // Numbered by volume when the same number comes in two volumes (GameFan's Vol. 6 #2 and Vol. 7 #2).
  const seen = new Map<number, Set<number>>();
  for (const i of numbered) if (i.v !== null) seen.set(i.n, (seen.get(i.n) ?? new Set()).add(i.v));
  out.byVolume = [...seen.values()].some((v) => v.size > 1);

  const sorted = (items: typeof numbered): Held[] => {
    const byNumber = new Map<number, Held>();
    for (const i of items) {
      const was = byNumber.get(i.n);
      if (!was || (!was.at && i.at)) byNumber.set(i.n, { n: i.n, at: i.at });
    }
    return [...byNumber.values()].sort((a, b) => a.n - b.n);
  };

  if (!out.byVolume) {
    const list = sorted(numbered);
    out.first = { number: list[0]!.n, volume: null };
    out.last = { number: list.at(-1)!.n, volume: null };
    const from = options.first ?? (fromOne ? 1 : undefined);
    runGaps(list, null, answers, out, { from: from !== undefined && from < list[0]!.n ? from : undefined, to: options.last != null && options.last > list.at(-1)!.n ? options.last : undefined, outer: true });
    return out;
  }

  // By volume: each volume's own gaps; a volume's size is the most common last issue among them (GameFan's 12), so a
  // volume between the first and the last is filled to it, and a volume you have none of is missing whole.
  const volumes = new Map<number, typeof numbered>();
  for (const i of numbered) if (i.v !== null) volumes.set(i.v, [...(volumes.get(i.v) ?? []), i]);
  out.unnumbered += numbered.filter((i) => i.v === null).length;
  const order = [...volumes.keys()].sort((a, b) => a - b);
  const size = mode(order.map((v) => Math.max(...volumes.get(v)!.map((i) => i.n))));
  const firstV = order[0]!;
  const lastV = order.at(-1)!;
  const firstNumber = Math.min(...volumes.get(firstV)!.map((i) => i.n));
  out.first = { number: firstNumber, volume: firstV };
  out.last = { number: Math.max(...volumes.get(lastV)!.map((i) => i.n)), volume: lastV };
  for (let v = firstV; v <= lastV; v++) {
    const list = sorted(volumes.get(v) ?? []);
    if (list.length === 0) {
      // A volume you have none of, between two you have: missing whole when the volumes' size is known.
      if (size !== null) runGaps([], v, answers, out, { from: 1, to: size, outer: false });
      continue;
    }
    runGaps(list, v, answers, out, {
      from: list[0]!.n > 1 && (v !== firstV || fromOne) ? 1 : undefined,
      to: size !== null && v !== lastV && list.at(-1)!.n < size ? size : undefined,
      // Only the first volume's start is the magazine's own; the rest are inside the run.
      outer: false,
    });
  }
  // The first volume's start, ahead of everything you have: "before".
  for (const m of out.missing) if (m.volume === firstV && m.number < firstNumber) m.where = 'before';
  return out;
}
