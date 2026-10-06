/**
 * Deals from PriceCharting's emails (Today's card and Wishlist > Deals, 0.52.0): what both show of one, and the ways to
 * look through them: by console, best deals first or the wishlist's first, and only new or sealed copies.
 */

/** What both pages read of a deal (GET /api/v1/today and /api/v1/deals). */
export interface DealLike {
  date: string;
  title: string;
  console: string;
  priceCents: number | null;
  saveCents: number | null;
  listingTitle?: string | null;
  platform: string | null;
  wishlist: { score: number; priority: string; rank: number | null } | null;
}

/** The saving in percent of the market value (the price plus the saving), when the email says both. */
export function offPercent(d: Pick<DealLike, 'priceCents' | 'saveCents'>): number | null {
  return d.priceCents !== null && d.saveCents ? Math.round((d.saveCents / (d.priceCents + d.saveCents)) * 100) : null;
}

/** The console a deal is for, as Squirrelcade names it when it knows the console, else as PriceCharting's email does. */
export const consoleOf = (d: Pick<DealLike, 'platform' | 'console'>) => d.platform ?? d.console;

/**
 * A listing whose own title says it's new or sealed ("Brand New", "Factory Sealed"); "like new" is used. Only what the
 * seller wrote: PriceCharting's emails don't say the condition.
 */
export function isNewListing(d: Pick<DealLike, 'listingTitle'>): boolean {
  const t = d.listingTitle ?? '';
  return /\b(new|sealed)\b/i.test(t) && !/\blike[\s-]new\b/i.test(t);
}

/** The consoles the deals are for, the one with the most deals first. */
export function dealConsoles(deals: DealLike[]): { value: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const d of deals) counts.set(consoleOf(d), (counts.get(consoleOf(d)) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, n]) => ({ value: name, label: `${name} (${n})` }));
}

export type DealOrder = 'best' | 'wishlist';

/** Best deals first (the biggest saving in percent, then in money), or the wishlist's first (by acorns); newest among equals. */
export function dealOrder(order: DealOrder) {
  return (a: DealLike, b: DealLike) =>
    order === 'best'
      ? (offPercent(b) ?? -1) - (offPercent(a) ?? -1) || (b.saveCents ?? 0) - (a.saveCents ?? 0) || b.date.localeCompare(a.date)
      : (b.wishlist?.score ?? -1) - (a.wishlist?.score ?? -1) || b.date.localeCompare(a.date);
}
