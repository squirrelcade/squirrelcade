/**
 * The game of the day: each day, one game you don't have from the top of the wishlist, picked by Squirrelcade's own
 * rules (no AI, no outside service). A weighted draw: the higher a game's score, the likelier it is, with extra
 * points for a game that came out around this date in a past year; a game picked lately isn't picked again, nor
 * another of its series right after. The date seeds the draw, so the pick is the same all day, on every page.
 */

/** A game the pick may be: a wishlist game with its score, series and release date. */
export interface DayCandidate {
  platformKey: string;
  title: string;
  score: number;
  /** Its series (the wishlist's franchise), or "" without one. */
  franchise: string;
  /** Its release date (YYYY-MM-DD), when known. */
  released: string | null;
}

/** A day's pick, remembered so it isn't picked again too soon. */
export interface DayPick {
  date: string;
  platformKey: string;
  title: string;
  franchise: string;
  /** Passed over with "Another one": still counts as picked for the repeat rules. */
  skipped?: boolean;
}

export interface DayRules {
  /** A game picked in this many days isn't picked again. */
  repeatDays: number;
  /** Another game of a series picked in this many days isn't picked. */
  seriesDays: number;
  /** Extra points for a game that came out within windowDays of this date in a past year. */
  pastBonus: number;
  windowDays: number;
}

/** A number from 0 up to 1, the same for a date and try (FNV-1a of both), so a day's pick doesn't change on reload. */
export function dayRandom(date: string, attempt = 0): number {
  let h = 0x811c9dc5;
  for (const ch of `${date}#${attempt}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // One more mixing step: dates a day apart then land far apart.
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h ^= h >>> 12;
  return (h >>> 0) / 4_294_967_296;
}

/** Whether a release date falls within some days of this month and day, in an earlier year. */
export function aroundThisDate(released: string | null, today: string, windowDays: number): boolean {
  if (!released || !/^\d{4}-\d{2}-\d{2}/.test(released)) return false;
  const year = Number(released.slice(0, 4));
  const thisYear = Number(today.slice(0, 4));
  if (year >= thisYear) return false;
  // The same month and day in the release's year and the ones next to it (the window may cross New Year).
  const release = Date.parse(`${released.slice(0, 10)}T00:00:00Z`);
  return [year - 1, year, year + 1].some((y) => Math.abs(Date.parse(`${y}${today.slice(4, 10)}T00:00:00Z`) - release) <= windowDays * 86_400_000);
}

/** The days from one date (YYYY-MM-DD) to another. */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

const keyOf = (platformKey: string, title: string) => `${platformKey}|${title.toLowerCase()}`;

/**
 * The day's pick among the candidates, or null when every one was picked lately. Each weighs its score squared
 * (a 90 is about twice as likely as a 64), plus the bonus when it came out around this date; games picked in the
 * last repeatDays and series picked in the last seriesDays are left out, and so are today's earlier picks.
 */
export function pickOfTheDay(candidates: readonly DayCandidate[], history: readonly DayPick[], today: string, rules: DayRules, attempt = 0): DayCandidate | null {
  const recentGames = new Set<string>();
  const recentSeries = new Set<string>();
  for (const p of history) {
    const ago = daysBetween(p.date, today);
    if (ago < 0) continue;
    if (ago < rules.repeatDays || ago === 0) recentGames.add(keyOf(p.platformKey, p.title));
    // Today's own passes don't hold its series back: another one may well be the same series.
    if (p.franchise && ago > 0 && ago < rules.seriesDays) recentSeries.add(p.franchise.toLowerCase());
  }
  const pool = candidates
    .filter((c) => !recentGames.has(keyOf(c.platformKey, c.title)) && !(c.franchise && recentSeries.has(c.franchise.toLowerCase())))
    .map((c) => {
      const points = Math.max(1, c.score + (aroundThisDate(c.released, today, rules.windowDays) ? rules.pastBonus : 0));
      return { c, weight: points * points };
    });
  if (pool.length === 0) return null;
  const total = pool.reduce((sum, x) => sum + x.weight, 0);
  let at = dayRandom(today, attempt) * total;
  for (const x of pool) {
    at -= x.weight;
    if (at < 0) return x.c;
  }
  return pool[pool.length - 1]!.c;
}
