import {
  COMPLETENESS_LABELS,
  estimateCost,
  mediaOf,
  parseNewGamePrices,
  photoSlotsFor,
  type Completeness,
  type CostEstimate,
  type TestResult,
} from '@squirrelcade/core';
import { and, asc, desc, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { CatalogService } from './catalogs.js';
import type { CopyDetailsService } from './copyDetails.js';
import type { Db } from './db/index.js';
import { catalogEntries, copies, copyPhotos, copyTests, platforms } from './db/schema.js';
import { catalogTarget } from './games.js';
import type { IgdbService } from './igdb.js';
import type { SettingsService } from './settings.js';

/** What a copy can be missing, as Collection > Improve lists it (Settings > Collection > Improve your collection). */
export type Gap = 'paid' | 'date' | 'photos' | 'tested' | 'location';
export const GAPS: Gap[] = ['paid', 'date', 'photos', 'tested', 'location'];

/** A copy on Collection > Improve's list, with what it's missing. */
export interface ImproveItem {
  id: number;
  key: string;
  title: string;
  platform: string | null;
  platformKey: string | null;
  completeness: string;
  condition: string;
  costCents: number | null;
  datePurchased: string | null;
  notes: string;
  /** Who graded a graded copy, and its certificate (D151). */
  gradingCompany: string;
  gradingCertId: string;
  gaps: Gap[];
  /** Its standard photos, and the ones it doesn't have yet. */
  slots: string[];
  missingPhotos: string[];
  lastTest: { result: TestResult; testedAt: string } | null;
  location: string | null;
  /** The owner's estimate of what it cost (null unless they set one). */
  estimatedCents: number | null;
}

/** A copy on Stash > Recently added (D161): what's finished there, and what its full window needs. */
export interface RecentItem {
  id: number;
  key: string;
  title: string;
  platform: string | null;
  platformKey: string | null;
  completeness: string;
  condition: string;
  costCents: number | null;
  estimatedCents: number | null;
  datePurchased: string | null;
  notes: string;
  gradingCompany: string;
  gradingCertId: string;
  slots: string[];
  addedAt: string;
  location: string | null;
  /** Its console is one whose games are ripped (Settings > Collection > Consoles whose games you rip). */
  canRip: boolean;
  /** Its latest rip, with its id to take it back. */
  lastRip: { id: number; result: TestResult; testedAt: string } | null;
}

/** How far back Recently added looks by default, and at most (days), and how many copies it lists at most. */
export const RECENT_DAYS = 30;
const RECENT_MAX_DAYS = 365;
const RECENT_MAX = 300;

type CopyRow = typeof copies.$inferSelect;

/**
 * Looking after the copies (0.21.0): each one's standard photos (by the console's media, Settings > Collection), a
 * suggestion for the estimated price of a copy whose price paid the owner doesn't know (only when they ask: D85), and
 * Collection > Improve's list of what copies are missing.
 */
export class CopyCareService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly details: CopyDetailsService,
    private readonly igdb: IgdbService,
    private readonly catalogs: CatalogService,
  ) {}

  /** A copy's standard photos (Settings > Collection > Your copies), by what it has and what its console plays games from. */
  slotsOf(copy: Pick<CopyRow, 'completeness' | 'hasBox' | 'hasManual' | 'sealed'>, platformKey: string | null): string[] {
    const s = this.settings;
    return photoSlotsFor(copy, mediaOf(platformKey ?? ''), {
      box: s.get('collection.photoSlotsBox'),
      inside: s.get('collection.photoSlotsInside'),
      game: s.get('collection.photoSlotsGame'),
      manual: s.get('collection.photoSlotsManual'),
    });
  }

  /** When a game came out on a console: IGDB's first release there, else the catalog's date. */
  private released(platformId: number, platformKey: string, title: string): string | null {
    const igdb = this.igdb.find(platformId, title)?.released;
    if (igdb) return igdb;
    const target = catalogTarget(this.catalogs, platformKey, title);
    if (!target) return null;
    const date = this.db.select({ releaseDate: catalogEntries.releaseDate }).from(catalogEntries).where(eq(catalogEntries.id, target.target.id)).get()?.releaseDate ?? null;
    return date && /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : null;
  }

  /**
   * Squirrelcade's suggestion for a copy's estimated price, worked out only when the owner asks (Suggest): a copy with its
   * box at its console's usual price for a new game (Settings > Collection > Suggested estimates), with the game's
   * release as when it was most likely bought; one without, at a share of it. Null when there's no such copy, the
   * suggestions are off, or its console has no price in the list.
   */
  suggest(id: number): CostEstimate | null {
    if (!this.settings.get('collection.estimates')) return null;
    const row = this.db
      .select({ copy: copies, platformKey: platforms.key, platformName: platforms.name })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(and(eq(copies.id, id), isNull(copies.goneAt)))
      .get();
    if (!row) return null;
    const { copy, platformKey, platformName } = row;
    const bought = !['loose', 'box-only', 'manual-only', 'unknown'].includes(copy.completeness);
    const table = parseNewGamePrices(this.settings.get('collection.newGamePrices'));
    return estimateCost({ completeness: copy.completeness, platformKey, platformName }, bought ? this.released(copy.platformId!, platformKey, copy.title) : null, table, this.settings.get('collection.usedShare'));
  }

  /**
   * Stash > Recently added (D161, the owner's way: a game logged, then ripped, then put away): the copies added to the
   * collection in the last `days` days, newest first, with what's finished there (condition, price paid, the rip, where
   * it's kept) and what its full window needs.
   */
  recent(days = RECENT_DAYS): { days: number; total: number; items: RecentItem[] } {
    const span = Math.min(Math.max(Math.round(days) || RECENT_DAYS, 1), RECENT_MAX_DAYS);
    const since = new Date(Date.now() - span * 86_400_000).toISOString();
    const rows = this.db
      .select({ copy: copies, platformKey: platforms.key, platform: platforms.name })
      .from(copies)
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(and(isNull(copies.goneAt), gte(copies.addedAt, since)))
      .orderBy(desc(copies.addedAt), desc(copies.id))
      .all();
    const index = this.details.index();
    const rips = new Map<string, RecentItem['lastRip']>();
    for (const t of this.db.select().from(copyTests).where(eq(copyTests.kind, 'rip')).orderBy(asc(copyTests.testedAt), asc(copyTests.id)).all()) {
      rips.set(t.copyKey, { id: t.id, result: t.result as TestResult, testedAt: t.testedAt });
    }
    const ripConsoles = this.settings.get('collection.ripConsoles');
    const items = rows.slice(0, RECENT_MAX).map(({ copy: c, platformKey, platform }): RecentItem => ({
      id: c.id,
      key: c.key,
      title: c.title,
      platform,
      platformKey,
      completeness: c.completeness,
      condition: COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness,
      costCents: c.costCents,
      estimatedCents: c.estimatedCents,
      datePurchased: c.datePurchased,
      notes: c.notes,
      gradingCompany: c.gradingCompany,
      gradingCertId: c.gradingCertId,
      slots: this.slotsOf(c, platformKey),
      addedAt: c.addedAt,
      location: index.get(c.key)?.location ?? null,
      canRip: platformKey !== null && ripConsoles.includes(platformKey),
      lastRip: rips.get(c.key) ?? null,
    }));
    return { days: span, total: rows.length, items };
  }

  /** The owner's estimates of the copies whose price paid they don't know, together: for their view of what they spent. */
  estimatedTotal(): { cents: number; copies: number } {
    let cents = 0;
    let n = 0;
    for (const c of this.db.select({ cost: copies.costCents, estimated: copies.estimatedCents }).from(copies).where(and(isNull(copies.goneAt), isNotNull(copies.estimatedCents))).all()) {
      if (c.cost !== null && c.cost > 0) continue;
      cents += c.estimated!;
      n++;
    }
    return { cents, copies: n };
  }

  /**
   * Collection > Improve: each gap's count, and the copies missing what's asked (or anything counted), a page at a time.
   * `added: 'here'` keeps only the copies added in Squirrelcade (Store Mode's Add it, Add a copy) that no export has
   * brought back yet: a store's haul, filled in one after another later (D153).
   */
  improve(query: { gap?: string; platform?: string; added?: string; page?: number; pageSize?: number }): { counts: Record<Gap, number>; checked: Gap[]; total: number; items: ImproveItem[] } {
    const s = this.settings;
    const checked = GAPS.filter((g) => s.get(`collection.improve${g[0]!.toUpperCase()}${g.slice(1)}` as 'collection.improvePaid'));
    const retestMonths = s.get('collection.retestMonths');
    const since = retestMonths > 0 ? new Date(Date.now() - retestMonths * 30.44 * 86_400_000).toISOString() : null;
    const index = this.details.index();
    const tested = this.details.lastTests();
    const filled = new Map<string, Set<string>>();
    for (const p of this.db.select({ copyKey: copyPhotos.copyKey, slot: copyPhotos.slot }).from(copyPhotos).where(isNotNull(copyPhotos.slot)).all()) {
      filled.set(p.copyKey, (filled.get(p.copyKey) ?? new Set()).add(p.slot!));
    }
    const rows = this.db
      .select({ copy: copies, platformKey: platforms.key, platform: platforms.name })
      .from(copies)
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(and(isNull(copies.goneAt), ...(query.platform ? [eq(platforms.key, query.platform)] : []), ...(query.added === 'here' ? [eq(copies.source, 'squirrelcade')] : [])))
      .all()
      .sort((a, b) => a.copy.title.localeCompare(b.copy.title) || (a.platform ?? '').localeCompare(b.platform ?? '') || a.copy.id - b.copy.id);
    const counts: Record<Gap, number> = { paid: 0, date: 0, photos: 0, tested: 0, location: 0 };
    const listed: { row: (typeof rows)[number]; gaps: Gap[]; slots: string[]; missingPhotos: string[] }[] = [];
    for (const row of rows) {
      const c = row.copy;
      const slots = this.slotsOf(c, row.platformKey);
      const missingPhotos = slots.filter((slot) => !filled.get(c.key)?.has(slot));
      const last = tested.get(c.key);
      const has: Record<Gap, boolean> = {
        // A copy the owner gave an estimate to is settled: they don't know what they paid.
        paid: (c.costCents === null || c.costCents <= 0) && c.estimatedCents === null,
        date: !c.datePurchased,
        photos: missingPhotos.length > 0,
        tested: !last || (since !== null && last.testedAt < since),
        location: !index.get(c.key)?.location,
      };
      const gaps = checked.filter((g) => has[g]);
      for (const g of gaps) counts[g]++;
      const wanted = query.gap && (GAPS as string[]).includes(query.gap) ? has[query.gap as Gap] && checked.includes(query.gap as Gap) : gaps.length > 0;
      if (wanted) listed.push({ row, gaps, slots, missingPhotos });
    }
    const pageSize = Math.min(Math.max(query.pageSize ?? 50, 1), 500);
    const page = Math.max(query.page ?? 1, 1);
    const items = listed.slice((page - 1) * pageSize, page * pageSize).map(({ row, gaps, slots, missingPhotos }): ImproveItem => {
      const c = row.copy;
      return {
        id: c.id,
        key: c.key,
        title: c.title,
        platform: row.platform,
        platformKey: row.platformKey,
        completeness: c.completeness,
        condition: COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness,
        costCents: c.costCents,
        datePurchased: c.datePurchased,
        notes: c.notes,
        gradingCompany: c.gradingCompany,
        gradingCertId: c.gradingCertId,
        gaps,
        slots,
        missingPhotos,
        lastTest: tested.get(c.key) ?? null,
        location: index.get(c.key)?.location ?? null,
        estimatedCents: c.estimatedCents,
      };
    });
    return { counts, checked, total: listed.length, items };
  }
}

/** Collection > Improve's list, a suggested estimate for a copy, and the owner's estimates together (owner only). */
export function registerCopyCareRoutes(app: FastifyInstance, care: CopyCareService): void {
  app.get('/api/v1/collection/copies/:id/suggestion', async (request) => ({ suggestion: care.suggest(Number((request.params as { id: string }).id)) }));
  app.get('/api/v1/collection/improve', async (request) => {
    const q = request.query as Record<string, string | undefined>;
    return care.improve({ gap: q.gap || undefined, platform: q.platform || undefined, added: q.added || undefined, page: q.page ? Number(q.page) : undefined, pageSize: q.pageSize ? Number(q.pageSize) : undefined });
  });
  app.get('/api/v1/collection/estimates', async () => care.estimatedTotal());
  /** ?days=30 (1 to 365): the copies added lately, newest first (Stash > Recently added). */
  app.get('/api/v1/collection/recent', async (request) => {
    const days = Number((request.query as { days?: string }).days);
    return care.recent(Number.isFinite(days) && days > 0 ? days : RECENT_DAYS);
  });
}
