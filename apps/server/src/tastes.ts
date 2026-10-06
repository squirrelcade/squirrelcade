import { igdbDetails, inferFranchise, normalizeTitle, shapePoints, type ShapeSpec } from '@squirrelcade/core';
import { eq, isNull } from 'drizzle-orm';
import type { CatalogService } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import { copies, platforms } from './db/schema.js';
import type { IgdbService } from './igdb.js';

/**
 * What Squirrelcade learns about its owner from the collection, for the wishlist's defaults: which
 * consoles they collect now, which genres they favor, and which series they follow. Every install
 * learns from its own collection, so nobody's tastes are written into the defaults.
 */
export interface LearnedTastes {
  months: number;
  /** Consoles by games added in the last `months` (then by games owned), most first. */
  platforms: { key: string; name: string; recent: number; owned: number }[];
  /**
   * Genres by how much more of them the collection holds than the catalogs do ("lift": 2 means
   * twice their share), most first. Genres with too few catalog games to tell are left out.
   */
  genres: { name: string; owned: number; catalog: number; lift: number }[];
  /** Games owned per series (normalized series name), across consoles. */
  series: Map<string, number>;
}

/** A genre needs this many catalog games (in shares) before its lift says anything. */
const MIN_CATALOG_GAMES = 10;

/** Learns the owner's tastes from the current collection, the catalogs and IGDB's genres and series. */
export function learnTastes(db: Db, collection: CollectionService, catalogs: CatalogService, igdb: IgdbService | undefined, months: number): LearnedTastes {
  const empty: LearnedTastes = { months, platforms: [], genres: [], series: new Map() };
  if (!collection.hasCopies()) return empty;

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - months);
  const since = cutoff.toISOString().slice(0, 10);
  const rows = db
    .select({
      productId: copies.productId,
      title: copies.title,
      quantity: copies.quantity,
      dateEntered: copies.dateEntered,
      platformId: platforms.id,
      key: platforms.key,
      name: platforms.name,
    })
    .from(copies)
    .innerJoin(platforms, eq(platforms.id, copies.platformId))
    .where(isNull(copies.goneAt))
    .all();

  // Consoles collected now: the most games added lately.
  const perPlatform = new Map<string, { key: string; name: string; recent: number; owned: number }>();
  for (const r of rows) {
    const p = perPlatform.get(r.key) ?? { key: r.key, name: r.name, recent: 0, owned: 0 };
    p.owned += r.quantity;
    if ((r.dateEntered ?? '') >= since) p.recent += r.quantity;
    perPlatform.set(r.key, p);
  }

  // Genres and series of the owned games (each owned product once), and of the catalogs for comparison.
  // A game with several genres counts as a share of each, so games IGDB tags generously don't weigh more.
  const ownedGenres = new Map<string, number>();
  const series = new Map<string, number>();
  let ownedTotal = 0;
  const seen = new Set<string>();
  for (const r of rows) {
    const id = `${r.platformId}|${r.productId}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const game = igdb?.find(r.platformId, r.title);
    const details = game ? igdbDetails(game) : undefined;
    const franchise = details?.franchise?.trim() || inferFranchise(r.title);
    if (franchise) series.set(normalizeTitle(franchise), (series.get(normalizeTitle(franchise)) ?? 0) + 1);
    if (details?.genres?.length) {
      ownedTotal++;
      for (const g of details.genres) ownedGenres.set(g, (ownedGenres.get(g) ?? 0) + 1 / details.genres.length);
    }
  }
  const catalogGenres = new Map<string, number>();
  let catalogTotal = 0;
  for (const p of catalogs.allMatches()) {
    for (const t of p.match.targets) {
      if (t.status === 'excluded' || t.status === 'unconfirmed' || t.status === 'upcoming') continue;
      const game = igdb?.find(p.platformId, t.target.title);
      const genres = game ? igdbDetails(game).genres : undefined;
      if (!genres?.length) continue;
      catalogTotal++;
      for (const g of genres) catalogGenres.set(g, (catalogGenres.get(g) ?? 0) + 1 / genres.length);
    }
  }
  // Shares with a little smoothing, so a genre with few games doesn't swing to either end.
  const names = [...catalogGenres.keys()].filter((g) => (catalogGenres.get(g) ?? 0) >= MIN_CATALOG_GAMES);
  const smooth = 0.5;
  const share = (map: Map<string, number>, total: number, g: string) => ((map.get(g) ?? 0) + smooth) / (total + smooth * names.length);
  const genres = names
    .map((name) => ({
      name,
      owned: Math.round((ownedGenres.get(name) ?? 0) * 10) / 10,
      catalog: Math.round((catalogGenres.get(name) ?? 0) * 10) / 10,
      lift: ownedTotal > 0 ? Math.round((share(ownedGenres, ownedTotal, name) / share(catalogGenres, catalogTotal, name)) * 100) / 100 : 1,
    }))
    .sort((a, b) => b.lift - a.lift || b.owned - a.owned || a.name.localeCompare(b.name));

  return {
    months,
    platforms: [...perPlatform.values()].sort((a, b) => b.recent - a.recent || b.owned - a.owned || a.name.localeCompare(b.name)),
    genres,
    series,
  };
}

/**
 * The points lists learned tastes give, shaped like the user's lists (their shape, top and bottom
 * points; the learned ranking is the order): consoles with at least minGames added lately, and every genre.
 */
export function learnedPoints(
  tastes: LearnedTastes,
  shapes: { platform: Omit<ShapeSpec, 'order'>; genre: Omit<ShapeSpec, 'order'> },
  minGames: number,
): { platformPoints: Record<string, number>; genrePoints: Record<string, number> } {
  const learnedShape = (s: Omit<ShapeSpec, 'order'>) => ({ ...s, shape: s.shape === 'custom' ? ('linear' as const) : s.shape });
  return {
    platformPoints: shapePoints({ ...learnedShape(shapes.platform), order: tastes.platforms.filter((p) => p.recent >= minGames).map((p) => p.key) }),
    genrePoints: shapePoints({ ...learnedShape(shapes.genre), order: tastes.genres.map((g) => g.name) }),
  };
}
