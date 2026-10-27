/**
 * Now in and the Time machine (D190): the dates a decade back at a time from today, and how many days either side of a
 * date its window spans.
 */

/** Today's day and month, a decade back at a time ("2026-10-26": 2016-10-26, the 2010s; 2006-10-26, the 2000s...). */
export function nowInDates(today: string, decades: number): { date: string; label: string }[] {
  const [y, m, d] = today.split('-').map(Number) as [number, number, number];
  const out: { date: string; label: string }[] = [];
  for (let k = 1; k <= decades; k++) {
    const year = y - 10 * k;
    // February 29th in a year without one is the 28th.
    const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const date = `${year}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
    out.push({ date, label: `Now in the ${Math.floor(year / 10) * 10}s` });
  }
  return out;
}

/** The days either side of a date its window spans: its decade's own ("1970s: 60"), else the usual. */
export function windowDaysFor(date: string, usual: number, byDecade: readonly string[]): number {
  const decade = `${Math.floor(Number(date.slice(0, 4)) / 10) * 10}s`;
  for (const line of byDecade) {
    const m = /^\s*(\d{4})s\s*[:=]\s*(\d+)\s*$/.exec(line);
    if (m && `${m[1]}s` === decade) return Math.min(Number(m[2]), 366);
  }
  return usual;
}

/** How many months a magazine's cover date ran ahead of its newsstand date: its own ("Nintendo Power: 2"), else the usual. */
export function coverLeadFor(magazine: string, usual: number, byMagazine: readonly string[]): number {
  for (const line of byMagazine) {
    const i = line.lastIndexOf(':');
    if (i < 0) continue;
    const n = Number(line.slice(i + 1).trim());
    if (Number.isInteger(n) && line.slice(0, i).trim().toLowerCase() === magazine.trim().toLowerCase()) return n;
  }
  return usual;
}
