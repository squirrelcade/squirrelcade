import {
  baseTitle,
  consoleRegion,
  matchKey,
  toCsv,
  mergeDetails,
  normalizeTitle,
  scoreCandidates,
  scoringConfig,
  selectMaster,
  topByPlatform,
  type GameDetails,
  type MasterEntry,
  type ScoredCandidate,
  type SettingsValues,
  type ShapeSpec,
  type WishlistCandidate,
} from '@squirrelcade/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { shown } from './access.js';
import type { Logger } from 'pino';
import type { CatalogService } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import type { IgdbService, Reviews } from './igdb.js';
import { copies, exclusions, gameDetails, ownerPreferences, platforms } from './db/schema.js';
import type { SettingsService } from './settings.js';
import { learnedPoints, learnTastes, type LearnedTastes } from './tastes.js';

/** The computed wishlist: the master list, each console's list, and the platforms with candidates. */
export interface WishlistResult {
  generatedAt: string;
  master: MasterEntry[];
  byPlatform: Map<string, ScoredCandidate[]>;
  platforms: { key: string; name: string; candidates: number }[];
  counts: { candidates: number; scored: number; hidden: number };
  /** Every scored game by "platformKey|normalized title", with its main-wishlist rank if it has one. */
  index: Map<string, { score: number; priority: string; rank: number | null }>;
  /** Every scored game with its points, by "platformKey|normalized title" (the game drawer's explanation). */
  all: Map<string, ScoredCandidate>;
  /** Why a missing catalog game isn't on the wishlist, by "platformKey|normalized title" (snoozes aside). */
  offList: Map<string, string>;
}

/**
 * The wishlist: scores every missing catalog game from its details and the settings, then picks the master list
 * and each console's list; cached until the collection, catalogs, details or settings change.
 */
export class WishlistService {
  private revision = 0;
  private cache: { key: string; result: WishlistResult } | null = null;
  private tasteCache: { key: string; tastes: LearnedTastes } | null = null;

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly catalogs: CatalogService,
    private readonly collection: CollectionService,
    private readonly log: Logger,
    private readonly igdb?: IgdbService,
  ) {}

  /** IGDB cover image id for a game, when IGDB data was downloaded. */
  coverOf(platformKey: string, title: string): string | null {
    return this.igdb?.coverOf(platformKey, title) ?? null;
  }

  /** IGDB's rating of a game, shown beside its acorns. */
  reviewsOf(platformKey: string, title: string): Reviews {
    return this.igdb?.reviewsOf(platformKey, title) ?? null;
  }

  /** The PC storefronts a title is owned in for good (set by the app once the PC library exists). */
  private pcOwnership: (title: string) => string[] = () => [];
  /** The owner's sets a game is in (set by the app once there are sets). */
  private setsOf: (platformKey: string, titles: string[]) => string[] = () => [];

  /** Where the wishlist learns which of the owner's sets a game is in (Sets). */
  setSets(lookup: (platformKey: string, titles: string[]) => string[]): void {
    this.setsOf = lookup;
    this.invalidate();
  }

  setPcOwnership(lookup: (title: string) => string[]): void {
    this.pcOwnership = lookup;
  }

  invalidate(): void {
    this.revision++;
    this.cache = null;
  }

  /**
   * What the collection says about the owner's tastes (see tastes.ts): learned again after a collection update or a
   * change to the catalogs or IGDB's data, and at most hourly as copies come one at a time (a copy bought barely moves
   * them, and learning them from the whole collection takes a second).
   */
  tastes(): LearnedTastes {
    const months = this.settings.get('wishlist.learnMonths');
    const hour = Math.floor(Date.now() / 3_600_000);
    const key = `${this.catalogs.catalogStamp()}|${this.collection.updateRevision()}|${hour}|${this.igdb?.stamp() ?? 0}|${months}`;
    if (this.tasteCache?.key === key) return this.tasteCache.tastes;
    const tastes = learnTastes(this.db, this.collection, this.catalogs, this.igdb, months);
    this.tasteCache = { key, tastes };
    return tastes;
  }

  /** The points lists learned from the collection, in the shapes the user gave those lists (Wishlist > Scoring). */
  learned(s: SettingsValues = this.settings.all() as SettingsValues) {
    const shapes = s['wishlist.pointShapes'];
    const shapeOf = (key: string, fallback: Omit<ShapeSpec, 'order'>) => {
      const spec = shapes[key];
      return spec ? { shape: spec.shape, top: spec.top, bottom: spec.bottom } : fallback;
    };
    return learnedPoints(
      this.tastes(),
      {
        platform: shapeOf('wishlist.platformPoints', { shape: 'logarithmic', top: 22, bottom: 8 }),
        genre: shapeOf('wishlist.genrePoints', { shape: 'linear', top: 22, bottom: 0 }),
      },
      s['wishlist.learnMinGames'],
    );
  }

  private ownedElsewhere(): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    const rows = this.db
      .select({ title: copies.title, platform: platforms.name })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    // WR-038 penalizes only the same title (spelling differences aside): named editions such as
    // "Dredge: Deluxe Edition" are not treated as the same game across consoles.
    for (const r of rows) {
      const key = matchKey(baseTitle(r.title));
      map.set(key, (map.get(key) ?? new Set()).add(r.platform));
    }
    return map;
  }

  compute(): WishlistResult {
    const key = `${this.catalogs.stamp()}|${this.revision}|${this.igdb?.stamp() ?? 0}`;
    if (this.cache?.key === key) return this.cache.result;

    const s = this.settings.all() as SettingsValues;
    const config = scoringConfig(s);
    // Lists the user left empty are learned from the collection.
    const learned = this.learned(s);
    if (Object.keys(config.platformPoints).length === 0) config.platformPoints = learned.platformPoints;
    if (Object.keys(config.genrePoints).length === 0) config.genrePoints = learned.genrePoints;
    const homeRegion = s['general.homeRegion'];
    const today = new Date().toISOString().slice(0, 10);
    const details = new Map(this.db.select().from(gameDetails).all().map((d) => [`${d.platformId}|${d.titleKey}`, JSON.parse(d.details) as GameDetails & { marketValueCents?: number }]));
    const prefs = new Map(this.db.select().from(ownerPreferences).all().map((p) => [`${p.platformId}|${p.titleKey}`, p.preference]));
    const hidden = new Map<string, { action: string; until: string | null; belowCents: number | null }[]>();
    for (const e of this.db.select().from(exclusions).where(eq(exclusions.active, true)).all()) {
      if (e.action === 'exclude' || e.platformId === null) continue;
      const k = `${e.platformId}|${normalizeTitle(e.title)}`;
      hidden.set(k, [...(hidden.get(k) ?? []), e]);
    }
    const elsewhere = this.ownedElsewhere();
    const offList = new Map<string, string>();
    const price = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: s['general.currency'] || 'USD' }).format(cents / 100);

    const candidates: WishlistCandidate[] = [];
    const remaining = new Map<string, number>();
    const completion = new Map<string, number>();
    const platformRows: WishlistResult['platforms'] = [];
    let hiddenCount = 0;
    for (const p of this.catalogs.allMatches()) {
      completion.set(p.key, p.match.percent);
      let count = 0;
      let platformCandidates = 0;
      for (const t of p.match.targets) {
        if (t.status !== 'missing' && t.status !== 'review') continue;
        const k = `${p.platformId}|${normalizeTitle(t.target.title)}`;
        const d = details.get(k);
        const rc = (d?.releaseClass ?? '').toLowerCase();
        const countsTowardCompletion = !['exclude', 'physical proof pending', 'physical homebrew / aftermarket'].includes(rc);
        if (countsTowardCompletion) count++;
        // Only games that are clearly missing are recommended; review questions come first.
        if (t.status !== 'missing') continue;
        const hides = hidden.get(k) ?? [];
        const isHidden = hides.some(
          (h) =>
            h.action === 'hide' ||
            (h.action === 'defer' && (h.until ?? '') >= today) ||
            (h.action === 'below-price' && (d?.marketValueCents === undefined || h.belowCents === null || d.marketValueCents > h.belowCents)),
        );
        if (isHidden) {
          hiddenCount++;
          const byHand = hides.find((h) => h.action === 'hide');
          const cap = hides.find((h) => h.action === 'below-price');
          if (byHand) offList.set(`${p.key}|${normalizeTitle(t.target.title)}`, 'Hidden from the wishlist by your list of exclusions.');
          else if (cap?.belowCents != null) {
            offList.set(
              `${p.key}|${normalizeTitle(t.target.title)}`,
              `On the wishlist only once it's worth ${price(cap.belowCents)} or less (${d?.marketValueCents !== undefined ? `now ${price(d.marketValueCents)}` : 'no price known'}).`,
            );
          }
          continue;
        }
        const owned = [...(elsewhere.get(matchKey(baseTitle(t.target.title))) ?? [])].filter((n) => n !== p.name);
        // On another region's own console (the Super Famicom), that region's releases are the console's own, not imports.
        const ownRegion = consoleRegion(p.key, homeRegion);
        candidates.push({
          platformKey: p.key,
          platformName: p.name,
          title: t.target.title,
          homeRegion: (p.regionOf.get(t.target.id) ?? ownRegion) === ownRegion,
          details: mergeDetails(d, this.igdb?.details(p.platformId, t.target.title)),
          ownedOn: owned,
          ownedOnPc: this.pcOwnership(t.target.title),
          inSets: this.setsOf(p.key, [t.target.title, ...(t.target.altTitles ?? [])]),
          preference: prefs.get(k),
        });
        platformCandidates++;
      }
      remaining.set(p.key, count);
      platformRows.push({ key: p.key, name: p.name, candidates: platformCandidates });
    }

    const scored = scoreCandidates(candidates, remaining, config, { ownedInSeries: this.tastes().series, completion });
    const master = selectMaster(scored, config);
    const all = new Map(scored.map((c) => [`${c.platformKey}|${normalizeTitle(c.title)}`, c]));
    // Candidates the rules left out: a preference that keeps a game off, or a release class that isn't a target.
    for (const c of candidates) {
      const k = `${c.platformKey}|${normalizeTitle(c.title)}`;
      if (all.has(k)) continue;
      const rc = c.details?.releaseClass?.trim();
      offList.set(k, c.preference && !Object.keys(config.preferencePoints).some((k) => normalizeTitle(k) === normalizeTitle(c.preference!)) ? `Your preference "${c.preference}" keeps it off the wishlist.` : `Its release class (${rc || 'unknown'}) keeps it off the wishlist.`);
    }
    const index = new Map<string, { score: number; priority: string; rank: number | null }>();
    for (const c of scored) index.set(`${c.platformKey}|${normalizeTitle(c.title)}`, { score: c.score, priority: c.priority, rank: null });
    // A game's own score (0 to the top of the scale) and its place on the master list; the master list's score,
    // less its variety penalties, only orders that list (and can fall below 0).
    for (const m of master) index.set(`${m.platformKey}|${normalizeTitle(m.title)}`, { score: m.score, priority: m.priority, rank: m.rank });
    const result: WishlistResult = {
      generatedAt: new Date().toISOString(),
      master,
      index,
      byPlatform: topByPlatform(scored, config),
      all,
      offList,
      platforms: platformRows.sort((a, b) => a.name.localeCompare(b.name)),
      counts: { candidates: candidates.length, scored: scored.length, hidden: hiddenCount },
    };
    this.cache = { key, result };
    return result;
  }

  /** Every preference you set, by "platform key|normalized title", for lists that show many games' (Coming soon, Past releases). */
  preferences(): Map<string, string> {
    return new Map(
      this.db
        .select({ key: platforms.key, titleKey: ownerPreferences.titleKey, preference: ownerPreferences.preference })
        .from(ownerPreferences)
        .innerJoin(platforms, eq(platforms.id, ownerPreferences.platformId))
        .all()
        .map((r) => [`${r.key}|${r.titleKey}`, r.preference]),
    );
  }

  /** Your preference for one game ("Must Have", "Do Not Recommend"...), or null. */
  preferenceOf(platformKey: string, title: string): string | null {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return null;
    return (
      this.db
        .select({ preference: ownerPreferences.preference })
        .from(ownerPreferences)
        .where(and(eq(ownerPreferences.platformId, platform.id), eq(ownerPreferences.titleKey, normalizeTitle(title))))
        .get()?.preference ?? null
    );
  }

  setPreference(platformKey: string, title: string, preference: string | null, note: string | null): boolean {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return false;
    const titleKey = normalizeTitle(title);
    if (!preference || preference === 'No Adjustment') {
      this.db.delete(ownerPreferences).where(and(eq(ownerPreferences.platformId, platform.id), eq(ownerPreferences.titleKey, titleKey))).run();
    } else {
      const now = new Date().toISOString();
      this.db
        .insert(ownerPreferences)
        .values({ platformId: platform.id, title, titleKey, preference, note, updatedAt: now })
        .onConflictDoUpdate({ target: [ownerPreferences.platformId, ownerPreferences.titleKey], set: { preference, note, updatedAt: now } })
        .run();
    }
    this.invalidate();
    this.log.info({ context: 'wishlist' }, `Preference for "${title}" on ${platform.name}: ${preference ?? 'none'}`);
    return true;
  }

  /**
   * Hides a game from the wishlist until a date, or with until = null wakes it up.
   * The user's own snoozes are deleted; any other record is switched off, so it stays.
   */
  snooze(platformKey: string, title: string, until: string | null): boolean {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return false;
    const titleKey = normalizeTitle(title);
    const current = this.db
      .select()
      .from(exclusions)
      .where(and(eq(exclusions.platformId, platform.id), eq(exclusions.action, 'defer'), eq(exclusions.active, true)))
      .all()
      .filter((e) => normalizeTitle(e.title) === titleKey);
    this.db.transaction((tx) => {
      for (const e of current) {
        if (e.source === 'user') tx.delete(exclusions).where(eq(exclusions.id, e.id)).run();
        else tx.update(exclusions).set({ active: false }).where(eq(exclusions.id, e.id)).run();
      }
      if (until) {
        tx.insert(exclusions).values({ platformId: platform.id, title, action: 'defer', until, reason: 'Snoozed on the wishlist page', active: true, source: 'user' }).run();
      }
    });
    this.invalidate();
    this.log.info({ context: 'wishlist' }, until ? `Snoozed "${title}" on ${platform.name} until ${until}` : `Woke up "${title}" on ${platform.name}`);
    return true;
  }

  /** How many games added lately make a console one the owner collects now (Wishlist > Scoring). */
  minGames(): number {
    return this.settings.get('wishlist.learnMinGames');
  }

  /** Whether the user gave their own points lists (otherwise they are learned from the collection). */
  ownLists(): { platforms: boolean; genres: boolean } {
    return {
      platforms: Object.keys(this.settings.get('wishlist.platformPoints')).length > 0,
      genres: Object.keys(this.settings.get('wishlist.genrePoints')).length > 0,
    };
  }

  /** Games snoozed until a date that hasn't come yet. */
  snoozed(): { platformKey: string; platform: string; title: string; until: string }[] {
    const today = new Date().toISOString().slice(0, 10);
    return this.db
      .select({ platformKey: platforms.key, platform: platforms.name, title: exclusions.title, until: exclusions.until })
      .from(exclusions)
      .innerJoin(platforms, eq(platforms.id, exclusions.platformId))
      .where(and(eq(exclusions.action, 'defer'), eq(exclusions.active, true)))
      .all()
      .filter((e): e is typeof e & { until: string } => (e.until ?? '') >= today)
      .sort((a, b) => a.until.localeCompare(b.until) || a.title.localeCompare(b.title));
  }

}

const json = (c: ScoredCandidate, coverId: string | null, reviews: Reviews = null) => ({
  platformKey: c.platformKey,
  platform: c.platformName,
  title: c.title,
  score: c.score,
  priority: c.priority,
  components: c.components,
  flags: c.flags,
  franchise: c.franchise,
  preference: c.preference ?? null,
  ownedOn: c.ownedOn ?? [],
  coverId,
  reviews,
});

/** The wishlist: the master list, each console's list, CSV downloads, and the user's per-game preferences and snoozes. */
export function registerWishlistRoutes(app: FastifyInstance, wishlist: WishlistService, notes: () => Map<string, string> = () => new Map()): void {
  app.get('/api/v1/wishlist', async () => {
    const r = wishlist.compute();
    return {
      generatedAt: r.generatedAt,
      counts: r.counts,
      platforms: r.platforms,
      snoozed: wishlist.snoozed(),
      master: r.master.map((m) => ({ ...json(m, wishlist.coverOf(m.platformKey, m.title), wishlist.reviewsOf(m.platformKey, m.title)), rank: m.rank, masterScore: m.masterScore, consolePenalty: m.consolePenalty, franchisePenalty: m.franchisePenalty })),
    };
  });

  // What the collection says about the owner's tastes, and the points lists learned from it.
  app.get('/api/v1/wishlist/tastes', async () => {
    const tastes = wishlist.tastes();
    const learned = wishlist.learned();
    const own = wishlist.ownLists();
    return {
      months: tastes.months,
      minGames: wishlist.minGames(),
      platforms: tastes.platforms.map((p) => ({ ...p, points: learned.platformPoints[p.key] ?? null })),
      genres: tastes.genres.map((g) => ({ ...g, points: learned.genrePoints[g.name] ?? null })),
      series: [...tastes.series.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([name, owned]) => ({ name, owned })),
      learning: { platforms: !own.platforms, genres: !own.genres },
    };
  });

  app.get('/api/v1/wishlist/platforms/:key', async (request, reply) => {
    const { key } = request.params as { key: string };
    const r = wishlist.compute();
    const platform = r.platforms.find((p) => p.key === key);
    if (!platform) return reply.code(404).send({ error: 'not-found', message: 'No wishlist for that platform.' });
    return { platform, entries: (r.byPlatform.get(key) ?? []).map((c) => json(c, wishlist.coverOf(c.platformKey, c.title), wishlist.reviewsOf(c.platformKey, c.title))) };
  });

  /** The wishlist as a spreadsheet: ?list=top (default) or ?list=platforms, with your note on each game. */
  app.get('/api/v1/wishlist/export', async (request, reply) => {
    const r = wishlist.compute();
    const perPlatform = (request.query as { list?: string }).list === 'platforms';
    const index = shown(request).notes ? notes() : new Map<string, string>();
    const noteOf = (platformKey: string, title: string) => index.get(`${platformKey}|${normalizeTitle(title)}`) ?? '';
    const rows: (string | number | null)[][] = perPlatform
      ? [
          ['Platform', 'Place', 'Title', 'Acorns', 'Priority', 'Your preference', 'Owned on', 'Your note'],
          ...r.platforms.flatMap((p) =>
            (r.byPlatform.get(p.key) ?? []).map((c, i) => [p.name, i + 1, c.title, c.score, c.priority, c.preference ?? '', (c.ownedOn ?? []).join('; '), noteOf(c.platformKey, c.title)]),
          ),
        ]
      : [
          ['Rank', 'Title', 'Platform', 'Acorns', 'Base acorns', 'Priority', 'Your preference', 'Owned on', 'Series', 'Your note'],
          ...r.master.map((m) => [m.rank, m.title, m.platformName, m.masterScore, m.score, m.priority, m.preference ?? '', (m.ownedOn ?? []).join('; '), m.franchise ?? '', noteOf(m.platformKey, m.title)]),
        ];
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="squirrelcade-wishlist-${perPlatform ? 'by-platform-' : ''}${date}.csv"`)
      .send(toCsv(rows));
  });

  app.put('/api/v1/wishlist/snooze', async (request, reply) => {
    const b = request.body as { platformKey?: unknown; title?: unknown; until?: unknown } | null;
    const until = b?.until ?? null;
    if (typeof b?.platformKey !== 'string' || typeof b.title !== 'string' || (until !== null && (typeof until !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(until)))) {
      return reply.code(400).send({ error: 'invalid', message: 'Send platformKey, title and until (YYYY-MM-DD, or null to wake it up).' });
    }
    if (until !== null && until <= new Date().toISOString().slice(0, 10)) {
      return reply.code(400).send({ error: 'invalid', message: 'Pick a date after today.' });
    }
    if (!wishlist.snooze(b.platformKey, b.title, until as string | null)) return reply.code(404).send({ error: 'not-found', message: 'No such platform.' });
    return { ok: true };
  });

  app.put('/api/v1/wishlist/preferences', async (request, reply) => {
    const b = request.body as { platformKey?: unknown; title?: unknown; preference?: unknown; note?: unknown } | null;
    if (typeof b?.platformKey !== 'string' || typeof b.title !== 'string' || (b.preference !== null && typeof b.preference !== 'string')) {
      return reply.code(400).send({ error: 'invalid', message: 'Send platformKey, title and preference (or null).' });
    }
    if (!wishlist.setPreference(b.platformKey, b.title, b.preference as string | null, typeof b.note === 'string' ? b.note : null)) {
      return reply.code(404).send({ error: 'not-found', message: 'No such platform.' });
    }
    return { ok: true };
  });
}
