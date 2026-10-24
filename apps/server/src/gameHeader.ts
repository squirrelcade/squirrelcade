import { matchKey } from '@squirrelcade/core';
import { isNotNull } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { catalogEntries } from './db/schema.js';

/**
 * A game's star beside its name in the header the game page, Game of the Day and Store Mode share (D165): its place in
 * its console's Top 100, best-selling on its console, an award, critics' favorite, a launch title.
 */
export interface GameStar {
  kind: 'top100' | 'bestselling' | 'award' | 'critics' | 'launch';
  /** What the star says: "#2 Top 100", "Critics' favorite". */
  label: string;
  /** Where it comes from, for its tooltip. */
  detail: string;
  /** The list it's on, inside Squirrelcade ("/platforms/snes?tab=top100") or outside. */
  href: string | null;
}

/** The Reviews circle: Metacritic's score when known (from Wikipedia's review table or Wikidata), IGDB's rating otherwise. */
export interface HeaderReviews {
  score: number;
  /** How many ratings IGDB's rests on (Metacritic's is its own). */
  count: number | null;
  source: 'metacritic' | 'igdb';
}

/** Reviews at this score or more make a critics' favorite (Settings > Interface, Critics' favorite from). */
export const CRITICS_FAVORITE = 90;
/** IGDB's rating counts toward critics' favorite when it rests on at least this many ratings. */
const MIN_RATINGS = 5;

/** A full date ("1991-08-23"), the only kind a launch day is compared on. */
const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;

const longDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/**
 * Each console's launch day by its catalog: the earliest full release date that two or more of its games share (a
 * launch has a lineup; a lone early date is more likely a test market or a typo). Worked out once per change to the
 * catalogs' size.
 */
export class LaunchDays {
  private cache: { size: number; days: Map<number, string> } | null = null;

  constructor(private readonly db: Db) {}

  /** The console's launch day, if its catalog shows one. */
  of(platformId: number): string | null {
    return this.days().get(platformId) ?? null;
  }

  private days(): Map<number, string> {
    const rows = this.db.select({ platformId: catalogEntries.platformId, releaseDate: catalogEntries.releaseDate }).from(catalogEntries).where(isNotNull(catalogEntries.releaseDate)).all();
    if (this.cache && this.cache.size === rows.length) return this.cache.days;
    const byConsole = new Map<number, Map<string, number>>();
    for (const r of rows) {
      if (!r.releaseDate || !FULL_DATE.test(r.releaseDate)) continue;
      const dates = byConsole.get(r.platformId) ?? new Map<string, number>();
      dates.set(r.releaseDate, (dates.get(r.releaseDate) ?? 0) + 1);
      byConsole.set(r.platformId, dates);
    }
    const days = new Map<number, string>();
    for (const [platformId, dates] of byConsole) {
      const launch = [...dates].filter(([, n]) => n >= 2).sort(([a], [b]) => a.localeCompare(b))[0];
      if (launch) days.set(platformId, launch[0]);
    }
    this.cache = { size: rows.length, days };
    return days;
  }
}

/**
 * The header's stars, most telling first: its Top 100 place, best-selling and awards (with Roots' reading, from
 * Wikipedia and Wikidata), critics' favorite, a launch title. The header shows three and folds the rest under "+n".
 */
export function headerStars(game: {
  platformKey: string;
  platform: string;
  top100: { rank: number; of: number } | null;
  reviews: HeaderReviews | null;
  released: string | null;
  launchDay: string | null;
  /** The score from which reviews make a critics' favorite. */
  criticsFavorite?: number;
  read?: { bestselling: { rank: number | null; list: string; url: string | null } | null; awards: { name: string; year: string | null }[] };
}): GameStar[] {
  const stars: GameStar[] = [];
  if (game.top100) {
    stars.push({
      kind: 'top100',
      label: `#${game.top100.rank} Top 100`,
      detail: `#${game.top100.rank} of ${game.top100.of} on the ${game.platform}'s Top 100`,
      href: `/platforms/${encodeURIComponent(game.platformKey)}?tab=top100`,
    });
  }
  const sold = game.read?.bestselling;
  if (sold) {
    stars.push({ kind: 'bestselling', label: sold.rank ? `#${sold.rank} best-selling` : 'Best-selling', detail: `On Wikipedia's ${sold.list}`, href: sold.url });
  }
  for (const a of game.read?.awards ?? []) {
    stars.push({ kind: 'award', label: a.year ? `${a.name} ${a.year}` : a.name, detail: `${a.name}${a.year ? ` (${a.year})` : ''}, from Wikidata`, href: null });
  }
  const r = game.reviews;
  if (r && r.score >= (game.criticsFavorite ?? CRITICS_FAVORITE) && (r.source === 'metacritic' || (r.count ?? 0) >= MIN_RATINGS)) {
    stars.push({
      kind: 'critics',
      label: "Critics' favorite",
      detail: r.source === 'metacritic' ? `Metacritic ${r.score}` : `Reviews of ${r.score} on IGDB, from ${r.count} ratings`,
      href: null,
    });
  }
  if (game.launchDay && game.released === game.launchDay) {
    stars.push({ kind: 'launch', label: 'Launch title', detail: `Out the day the ${game.platform} launched, ${longDate(game.launchDay)}`, href: null });
  }
  return stars;
}

/**
 * Where a game's worth sits in the collection: the share of your games (titles, every console's copies together)
 * worth less, 0 to 100, for the Worth circle's fill.
 */
export function worthPercentile(copies: readonly { title: string; valueCents: number | null; quantity: number }[], gameKey: string, cents: number): number {
  const totals = new Map<string, number>();
  for (const c of copies) {
    if (c.valueCents === null) continue;
    const k = matchKey(c.title);
    totals.set(k, (totals.get(k) ?? 0) + c.valueCents * c.quantity);
  }
  totals.set(gameKey, cents);
  const below = [...totals.values()].filter((v) => v < cents).length;
  return totals.size <= 1 ? 100 : Math.round((below / (totals.size - 1)) * 100);
}
