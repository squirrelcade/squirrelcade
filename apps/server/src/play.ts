import { dayIn, inBacklog, isPlayStatus, normalizeTitle, PLAY_STATUSES, playDates, type PlayStatus, priceChartingUrl } from '@squirrelcade/core';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { shown } from './access.js';
import type { Db } from './db/index.js';
import { copies, platforms, playStatus } from './db/schema.js';
import type { IgdbService } from './igdb.js';
import type { SettingsService } from './settings.js';

/** What the owner has played of a game: its status, rating and days. */
export interface Play {
  status: PlayStatus | null;
  rating: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

/** An owned game and where the owner is with it, for the Backlog page. */
export interface PlayGame {
  platformKey: string;
  platform: string;
  title: string;
  coverId: string | null;
  status: PlayStatus | null;
  rating: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** IGDB's rating, when known: "What to play next" leans toward well-rated games. */
  igdbRating: number | null;
}

/** An owned game whose best copy isn't complete, for Collection > Upgrades. */
export interface Upgrade {
  platformKey: string;
  platform: string;
  title: string;
  coverId: string | null;
  /** The best copy: what it has (PriceCharting's words), how complete it is, and what it's worth. */
  includeString: string;
  completeness: 'loose' | 'item-box' | 'item-manual';
  valueCents: number | null;
  /** What it lacks to be complete. */
  missing: ('box' | 'manual')[];
  status: PlayStatus | null;
  rating: number | null;
  igdbRating: number | null;
  /** PriceCharting's page for the game (its loose, complete and new prices): the export's product, else a search. */
  priceUrl: string;
}

/** How complete a copy is, for picking a game's best copy (a box or a manual alone isn't one to upgrade). */
const COMPLETE_RANK: Record<string, number> = { graded: 5, sealed: 5, complete: 4, 'item-box': 3, 'item-manual': 2, loose: 1 };

/** Why a play status couldn't be saved. */
export class PlayError extends Error {}


/**
 * What the owner has played (0.6.0, D52): a status and a rating per game on a console, kept by the console and the
 * normalized title as notes are, beside the collection (PriceCharting doesn't know it). The backlog is the owned
 * games not played yet; "What to play next" picks one of them, leaning toward the ones IGDB rates well.
 */
export class PlayService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly igdb: IgdbService,
    private readonly log: Logger,
    /** The title a copy's play is kept under: the catalog game it counts as, or else its own title. */
    private readonly titleOf: (platformKey: string, productId: string, title: string) => string = (_platformKey, _productId, title) => title,
  ) {}

  /** Every game's play, by "platform key|normalized title". */
  index(): Map<string, Play> {
    return new Map(
      this.db
        .select({ platformKey: platforms.key, titleKey: playStatus.titleKey, status: playStatus.status, rating: playStatus.rating, startedAt: playStatus.startedAt, finishedAt: playStatus.finishedAt, updatedAt: playStatus.updatedAt })
        .from(playStatus)
        .innerJoin(platforms, eq(platforms.id, playStatus.platformId))
        .all()
        .map((r) => [`${r.platformKey}|${r.titleKey}`, { status: (r.status as PlayStatus | null) ?? null, rating: r.rating, startedAt: r.startedAt, finishedAt: r.finishedAt, updatedAt: r.updatedAt }]),
    );
  }

  /** A copy's play (kept under the catalog game it counts as, or its own title), from an index(). */
  ofCopy(index: Map<string, Play>, platformKey: string, productId: string, title: string): Play | null {
    return index.get(`${platformKey}|${normalizeTitle(this.titleOf(platformKey, productId, title))}`) ?? index.get(`${platformKey}|${normalizeTitle(title)}`) ?? null;
  }

  /** A game's play, found by any of its titles (the catalog's first). */
  of(platformKey: string, titles: readonly string[]): Play | null {
    const index = this.index();
    return titles.map((t) => index.get(`${platformKey}|${normalizeTitle(t)}`)).find(Boolean) ?? null;
  }

  /**
   * Saves a game's status and rating under its first title (replacing one kept under its other titles); with neither,
   * the game has no play kept. Starting a game dates its start and finishing one its end, unless days are given.
   */
  set(input: { platformKey: string; titles: string[]; status?: unknown; rating?: unknown; startedAt?: unknown; finishedAt?: unknown }): Play | null {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, input.platformKey)).get();
    const title = input.titles[0]?.trim();
    if (!platform || !title) throw new PlayError('No such game.');
    const before = this.of(input.platformKey, input.titles);
    const status = input.status === undefined ? (before?.status ?? null) : input.status;
    if (status !== null && !isPlayStatus(status)) throw new PlayError(`A status is one of ${PLAY_STATUSES.map((s) => s.value).join(', ')}.`);
    const rating = input.rating === undefined ? (before?.rating ?? null) : input.rating;
    if (rating !== null && (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 10)) throw new PlayError('A rating is a whole number from 1 to 10.');
    const day = (value: unknown, fallback: string | null) => {
      if (value === undefined) return fallback;
      if (value === null || value === '') return null;
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new PlayError('A day is YYYY-MM-DD.');
      return value;
    };
    const auto = input.status === undefined ? { startedAt: before?.startedAt ?? null, finishedAt: before?.finishedAt ?? null } : playDates(status, { startedAt: before?.startedAt ?? null, finishedAt: before?.finishedAt ?? null }, dayIn(this.settings.get('general.timeZone')));
    const startedAt = day(input.startedAt, auto.startedAt);
    const finishedAt = day(input.finishedAt, auto.finishedAt);
    const keys = [...new Set(input.titles.map(normalizeTitle).filter(Boolean))];
    const now = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.delete(playStatus)
        .where(and(eq(playStatus.platformId, platform.id), inArray(playStatus.titleKey, keys)))
        .run();
      if (status !== null || rating !== null) {
        tx.insert(playStatus).values({ platformId: platform.id, title, titleKey: normalizeTitle(title), status, rating: rating as number | null, startedAt, finishedAt, updatedAt: now }).run();
      }
    });
    this.log.info({ context: 'play' }, `${title} (${platform.name}): ${status ?? 'no status'}${rating ? `, ${rating}/10` : ''}`);
    return this.of(input.platformKey, [title]);
  }

  /** The owned games (one per console and title) with their play, for the Backlog page and the picker. */
  owned(): PlayGame[] {
    const rows = this.db
      .selectDistinct({ productId: copies.productId, title: copies.title, platformKey: platforms.key, platform: platforms.name, platformId: platforms.id })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    const index = this.index();
    const seen = new Set<string>();
    const out: PlayGame[] = [];
    for (const r of rows) {
      // One game per catalog game (copies of an edition count as the game), or per title outside the catalog.
      const name = this.titleOf(r.platformKey, r.productId, r.title);
      const key = `${r.platformKey}|${normalizeTitle(name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const play = index.get(key) ?? index.get(`${r.platformKey}|${normalizeTitle(r.title)}`);
      const game = this.igdb.find(r.platformId, name) ?? this.igdb.find(r.platformId, r.title);
      out.push({
        platformKey: r.platformKey,
        platform: r.platform,
        title: name,
        coverId: game?.coverId ?? null,
        status: play?.status ?? null,
        rating: play?.rating ?? null,
        startedAt: play?.startedAt ?? null,
        finishedAt: play?.finishedAt ?? null,
        igdbRating: game?.rating ?? null,
      });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title) || a.platform.localeCompare(b.platform));
  }

  /**
   * Collection > Upgrades: the owned games whose best copy isn't complete (loose, or without its box or its manual),
   * the ones you like best first: your rating, then IGDB's, then the copy's value. A game with a complete, sealed or
   * graded copy isn't one; with `withPlay` off (a viewer who isn't shown what you played), no ratings or statuses,
   * and IGDB's rating first.
   */
  upgrades(withPlay = true): Upgrade[] {
    const rows = this.db
      .select({
        productId: copies.productId,
        title: copies.title,
        completeness: copies.completeness,
        includeString: copies.includeString,
        valueCents: copies.valueCents,
        platformKey: platforms.key,
        platform: platforms.name,
        platformId: platforms.id,
      })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    // Each game's best copy (one game per catalog game, as the backlog counts them): the most complete, then the
    // most valuable.
    const best = new Map<string, { name: string; row: (typeof rows)[number] }>();
    for (const r of rows) {
      const name = this.titleOf(r.platformKey, r.productId, r.title);
      const key = `${r.platformKey}|${normalizeTitle(name)}`;
      const before = best.get(key);
      const rank = COMPLETE_RANK[r.completeness] ?? 0;
      const beforeRank = before ? (COMPLETE_RANK[before.row.completeness] ?? 0) : -1;
      if (rank > beforeRank || (rank === beforeRank && (r.valueCents ?? 0) > (before?.row.valueCents ?? 0))) best.set(key, { name, row: r });
    }
    const index = withPlay ? this.index() : new Map<string, Play>();
    const out: Upgrade[] = [];
    for (const [key, { name, row }] of best) {
      if (row.completeness !== 'loose' && row.completeness !== 'item-box' && row.completeness !== 'item-manual') continue;
      const play = index.get(key) ?? index.get(`${row.platformKey}|${normalizeTitle(row.title)}`);
      const game = this.igdb.find(row.platformId, name) ?? this.igdb.find(row.platformId, row.title);
      out.push({
        platformKey: row.platformKey,
        platform: row.platform,
        title: name,
        coverId: game?.coverId ?? null,
        includeString: row.includeString,
        completeness: row.completeness,
        valueCents: row.valueCents,
        missing: row.completeness === 'loose' ? ['box', 'manual'] : row.completeness === 'item-box' ? ['manual'] : ['box'],
        status: play?.status ?? null,
        rating: play?.rating ?? null,
        igdbRating: game?.rating ?? null,
        // PriceCharting's product id (an export's) opens the game's own page; a spreadsheet's copy, its search.
        priceUrl: /^\d+$/.test(row.productId) ? `https://www.pricecharting.com/game/${row.productId}` : priceChartingUrl(name, row.platform),
      });
    }
    const higher = (a: number | null, b: number | null) => (b ?? -1) - (a ?? -1);
    return out.sort((a, b) => higher(a.rating, b.rating) || higher(a.igdbRating, b.igdbRating) || higher(a.valueCents, b.valueCents) || a.title.localeCompare(b.title));
  }

  /** The Backlog page: the owned games in a status (or the backlog), searched, with each status's count. */
  list(query: { status?: string; platform?: string; q?: string }) {
    const unmarked = this.settings.get('collection.backlogIncludesUnmarked');
    const all = this.owned();
    const counts: Record<string, number> = { backlog: 0, unmarked: 0, rated: 0 };
    for (const s of PLAY_STATUSES) counts[s.value] ??= 0;
    for (const g of all) {
      if (g.status) counts[g.status] = (counts[g.status] ?? 0) + (g.status === 'backlog' ? 0 : 1);
      else counts.unmarked = (counts.unmarked ?? 0) + 1;
      if (inBacklog(g.status, unmarked)) counts.backlog = (counts.backlog ?? 0) + 1;
      if (g.rating !== null) counts.rated = (counts.rated ?? 0) + 1;
    }
    const q = query.q ? normalizeTitle(query.q) : '';
    const status = query.status && (isPlayStatus(query.status) || query.status === 'unmarked' || query.status === 'rated') ? query.status : 'backlog';
    const items = all.filter(
      (g) =>
        (status === 'backlog' ? inBacklog(g.status, unmarked) : status === 'unmarked' ? g.status === null : status === 'rated' ? g.rating !== null : g.status === status) &&
        (!query.platform || g.platformKey === query.platform) &&
        (!q || normalizeTitle(g.title).includes(q)),
    );
    return { status, counts, total: items.length, items };
  }

  /**
   * What to play next: one game from the backlog (on a console, if asked), at random but leaning toward the ones
   * IGDB rates well (a game's chance grows with its rating; an unrated game counts as 70). Null when there's none.
   */
  next(platformKey?: string, random: () => number = Math.random): PlayGame | null {
    const unmarked = this.settings.get('collection.backlogIncludesUnmarked');
    const pool = this.owned().filter((g) => inBacklog(g.status, unmarked) && (!platformKey || g.platformKey === platformKey));
    if (pool.length === 0) return null;
    const weights = pool.map((g) => Math.max(g.igdbRating ?? 70, 20) ** 2);
    let pick = random() * weights.reduce((a, b) => a + b, 0);
    for (let i = 0; i < pool.length; i++) {
      pick -= weights[i]!;
      if (pick <= 0) return pool[i]!;
    }
    return pool[pool.length - 1]!;
  }
}

/** Play status: the Backlog page, "What to play next", and saving a game's status and rating (the owner's). */
export function registerPlayRoutes(app: FastifyInstance, play: PlayService, catalogTitle: (platformKey: string, title: string) => string | null): void {
  const hidden = { error: 'not-shared', message: "The owner doesn't share what they played." };
  app.get('/api/v1/play', async (request, reply) => {
    if (!shown(request).play) return reply.code(403).send(hidden);
    const q = request.query as { status?: string; platform?: string; q?: string };
    return play.list(q);
  });

  app.get('/api/v1/play/next', async (request, reply) => {
    if (!shown(request).play) return reply.code(403).send(hidden);
    const { platform } = request.query as { platform?: string };
    return { game: play.next(platform || undefined) };
  });

  // Collection > Upgrades: viewers see it too (gift ideas: a complete copy of a game you have loose), without what
  // the owner played unless that's shared.
  app.get('/api/v1/collection/upgrades', async (request) => ({ items: play.upgrades(shown(request).play) }));

  app.put('/api/v1/play', async (request, reply) => {
    const b = request.body as { platformKey?: unknown; title?: unknown; status?: unknown; rating?: unknown; startedAt?: unknown; finishedAt?: unknown } | null;
    if (typeof b?.platformKey !== 'string' || typeof b.title !== 'string' || !b.title.trim()) {
      return reply.code(400).send({ error: 'invalid', message: 'Send platformKey, title, and status, rating or days.' });
    }
    // Kept under the catalog's title when the catalog has the game, so every page finds it.
    const name = catalogTitle(b.platformKey, b.title) ?? b.title.trim();
    try {
      return { play: play.set({ platformKey: b.platformKey, titles: [name, b.title], status: b.status, rating: b.rating, startedAt: b.startedAt, finishedAt: b.finishedAt }) };
    } catch (err) {
      if (err instanceof PlayError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });
}
