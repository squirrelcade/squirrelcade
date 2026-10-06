import {
  addDays,
  calendarFile,
  consoleInUse,
  consoleRegion,
  dayIn,
  igdbDetails,
  isFileName,
  isGameKeyCard,
  isUpcoming,
  KNOWN_PLATFORMS,
  matchCatalog,
  matchKey,
  normalizeTitle,
  parseOwnershipMappings,
  regionalConsole,
  slugify,
  toCsv,
  yearsBefore,
  type CatalogMatch,
  applyCrossGen,
  crossGenNeighbors,
  releaseYear,
  type CrossGenOwned,
  type CrossGenPartner,
  type CatalogTarget,
  type Decision,
  type MappingEntry,
  type OwnershipMapping,
  type TargetStatus,
} from '@squirrelcade/core';
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { shown } from './access.js';
import type { Logger } from 'pino';
import type { CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import type { RommLink } from './romm.js';
import { reviewsOf, type IgdbService, type Reviews } from './igdb.js';
import { catalogDecisions, catalogEntries, copies, exclusions, ignoredProducts, ownershipMappings, pendingPurchases, platforms } from './db/schema.js';
import type { SettingsService } from './settings.js';

/** The RomM link for a game on a platform, by the names it goes by (see romm.ts). */
export type RommLinker = (platformKey: string, titles: string[]) => RommLink | null;

/** A catalog game to add, by hand or from a source. */
export interface NewEntry {
  title: string;
  region?: string;
  format?: string | null;
  releaseDate?: string | null;
  notes?: string | null;
}

/** A catalog game as a catalog source lists it. */
export interface SourceEntry extends NewEntry {
  /** Stable identity within the platform; by default "<platform>|<region>|<title slug>". */
  key?: string;
  targetStatus?: TargetStatus;
  /** Other names the game goes by (other regions' titles, retitles). */
  altTitles?: string[];
  /** Which source lists it (list, wikipedia...); by default the sync's first source. */
  source?: string;
  /** Why the source counts it as a physical release (list: the user's own list), if it does. */
  evidence?: string | null;
}

/** What syncing a source into a console's catalog changed. */
export interface SyncResult {
  added: number;
  updated: number;
  removed: number;
  /** Games the source no longer lists, kept because the user answered something about them. */
  kept: number;
}

/** A game's wishlist score (set by the app once the wishlist exists; the wishlist builds on the catalogs). */
export type WishlistScorer = (platformKey: string, title: string) => { score: number; priority: string; rank: number | null } | undefined;

/**
 * Each console's catalog: games synced in from the sources, matched against the collection (cached until
 * something changes), the user's answers (links, exclusions, target statuses, games added by hand), the review
 * queue and Store Mode's just-bought marks.
 */
/** Drops a console's entries from a cache keyed "<platform id>|..." (it keeps only each console's latest). */
function forgetConsole(cache: Map<string, unknown>, platformId: number): void {
  for (const key of cache.keys()) if (key.startsWith(`${platformId}|`)) cache.delete(key);
}

export class CatalogService {
  private scorer?: WishlistScorer;
  private rommLink?: RommLinker;
  /** For each match: which catalog games each owned product counts as. */
  private owners = new WeakMap<CatalogMatch, Map<string, CatalogMatch['targets']>>();
  private revision = 0;
  /** Each console's latest matching, and its catalog games as the matching takes them (they don't change with the copies). */
  private cache = new Map<string, CatalogMatch>();
  private targetsCache = new Map<string, CatalogTarget[]>();

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly collection: CollectionService,
    private readonly log: Logger,
    private readonly igdb?: IgdbService,
  ) {}

  /** Where owned games link to the user's RomM (see romm.ts). */
  setRommLinks(link: RommLinker): void {
    this.rommLink = link;
  }

  /** The names of the catalog games an owned product counts as, IGDB's among them: for finding the product elsewhere. */
  titlesOfOwned(platformKey: string, productId: string): string[] {
    const platform = this.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return [];
    const m = this.matchFor(platform.id);
    let owners = this.owners.get(m);
    if (!owners) {
      owners = new Map();
      for (const t of m.targets) for (const x of t.matches) owners.set(x.productId, [...(owners.get(x.productId) ?? []), t]);
      this.owners.set(m, owners);
    }
    return (owners.get(productId) ?? []).flatMap((t) => [t.target.title, ...(t.target.altTitles ?? [])]);
  }

  setScorer(scorer: WishlistScorer): void {
    this.scorer = scorer;
  }

  /** Your wishlist preferences by "platform key|normalized title" (set by the app), for Coming soon and Past releases. */
  private preferences: () => Map<string, string> = () => new Map();

  setPreferences(preferences: () => Map<string, string>): void {
    this.preferences = preferences;
  }

  /** Forget computed results after catalog, mapping, decision or setting changes. */
  /**
   * Forgets computed results: of one platform after an answer or edit there, or
   * of all of them (catalog rebuilds, settings changes, imports).
   */
  invalidate(platformId?: number): void {
    this.revision++;
    if (platformId === undefined) {
      this.cache.clear();
      this.targetsCache.clear();
      return;
    }
    forgetConsole(this.cache, platformId);
    forgetConsole(this.targetsCache, platformId);
  }

  /** The platform of a catalog game, for invalidate(). */
  private platformOfEntry(entryId: number): number | undefined {
    return this.db.select({ platformId: catalogEntries.platformId }).from(catalogEntries).where(eq(catalogEntries.id, entryId)).get()?.platformId;
  }

  /**
   * Makes a platform's games from the catalog sources match what they list now. `scope` names the
   * sources this sync speaks for (their games may be updated or removed); each entry says which one
   * lists it. A game is recognized by its key or by any of its names, so it keeps its id (and with
   * it the user's answers) when a better source takes it over or writes its title differently.
   * Games the sources dropped are removed, unless the user answered something about them (a match
   * decision, a purchase mark or their own target status); those stay, as do games added by hand.
   */
  syncSource(platformKey: string, scope: string | string[], entries: SourceEntry[]): SyncResult | null {
    const sources = Array.isArray(scope) ? scope : [scope];
    const platform = this.platform(platformKey);
    if (!platform) return null;
    const ownRegion = consoleRegion(platform.key, this.settings.get('general.homeRegion'));
    const now = new Date().toISOString();
    const result: SyncResult = { added: 0, updated: 0, removed: 0, kept: 0 };
    this.db.transaction((tx) => {
      const rows = tx
        .select({ id: catalogEntries.id, key: catalogEntries.key, source: catalogEntries.source, title: catalogEntries.title, altTitles: catalogEntries.altTitles })
        .from(catalogEntries)
        .where(eq(catalogEntries.platformId, platform.id))
        .all();
      const byKey = new Map(rows.map((r) => [r.key, r]));
      const byName = new Map<string, (typeof rows)[number]>();
      for (const r of rows) {
        if (!sources.includes(r.source)) continue;
        for (const name of [r.title, ...(r.altTitles ? (JSON.parse(r.altTitles) as string[]) : [])]) {
          const k = matchKey(name);
          if (k && !byName.has(k)) byName.set(k, r);
        }
      }
      const claimed = new Set<number>();
      const usedKeys = new Set(rows.map((r) => r.key));
      for (const e of entries) {
        const title = e.title.trim();
        if (!title) continue;
        const region = e.region || ownRegion;
        const alt = [...new Set((e.altTitles ?? []).map((t) => t.trim()).filter((t) => t && t !== title))];
        const base = e.key?.trim() || `${platform.key}|${region}|${slugify(title)}`;
        const keyed = byKey.get(base);
        if (keyed && !sources.includes(keyed.source)) continue; // added by hand (or by another source) first: that one stays
        let row = keyed && !claimed.has(keyed.id) ? keyed : undefined;
        if (!row) {
          for (const name of [title, ...alt]) {
            const hit = byName.get(matchKey(name));
            if (hit && !claimed.has(hit.id)) {
              row = hit;
              break;
            }
          }
        }
        const values = {
          title,
          altTitles: alt.length > 0 ? JSON.stringify(alt) : null,
          region,
          format: e.format?.trim() || null,
          releaseDate: e.releaseDate?.trim() || null,
          notes: e.notes?.trim() || null,
          targetStatus: e.targetStatus ?? 'required',
          source: e.source ?? sources[0]!,
          evidence: e.evidence ?? null,
          updatedAt: now,
        };
        if (row) {
          claimed.add(row.id);
          tx.update(catalogEntries).set(values).where(eq(catalogEntries.id, row.id)).run();
          result.updated++;
        } else {
          let key = base;
          for (let i = 2; usedKeys.has(key); i++) key = `${base}-${i}`;
          usedKeys.add(key);
          const inserted = tx.insert(catalogEntries).values({ platformId: platform.id, key, ...values }).returning({ id: catalogEntries.id }).get();
          claimed.add(inserted.id);
          result.added++;
        }
      }
      for (const r of rows) {
        if (!sources.includes(r.source) || claimed.has(r.id)) continue;
        const answered =
          tx.select({ id: catalogDecisions.id }).from(catalogDecisions).where(eq(catalogDecisions.entryId, r.id)).get() ??
          tx.select({ id: pendingPurchases.id }).from(pendingPurchases).where(eq(pendingPurchases.entryId, r.id)).get() ??
          tx
            .select({ id: catalogEntries.id })
            .from(catalogEntries)
            .where(and(eq(catalogEntries.id, r.id), isNotNull(catalogEntries.userStatus)))
            .get();
        if (answered) {
          result.kept++;
          continue;
        }
        tx.delete(catalogEntries).where(eq(catalogEntries.id, r.id)).run();
        result.removed++;
      }
    });
    this.invalidate(platform.id);
    this.log.info(
      { context: 'catalogs' },
      `${platform.name} catalog from ${sources.join(' and ')}: ${result.added} added, ${result.updated} updated, ${result.removed} removed, ${result.kept} kept for your answers`,
    );
    return result;
  }

  /**
   * Replaces a console's mappings from the user's file: owned titles that count as catalog games
   * (compilations, other names, packages). Mappings from anywhere else stay. Null for an unknown console.
   */
  setMappings(platformKey: string, entries: MappingEntry[]): number | null {
    const platform = this.platform(platformKey);
    if (!platform) return null;
    this.db.transaction((tx) => {
      tx.delete(ownershipMappings).where(and(eq(ownershipMappings.platformId, platform.id), eq(ownershipMappings.source, 'list'))).run();
      for (let i = 0; i < entries.length; i += 200) {
        tx.insert(ownershipMappings)
          .values(entries.slice(i, i + 200).map((m) => ({ platformId: platform.id, ownedTitle: m.ownedTitle, satisfiesTitle: m.satisfies, type: m.type, counts: m.counts, notes: m.notes ?? null, source: 'list' })))
          .run();
      }
    });
    this.invalidate(platform.id);
    this.log.info({ context: 'catalogs' }, `${platform.name}: ${entries.length} ownership mapping(s) from your file`);
    return entries.length;
  }

  /** Removes a console's mappings from the user's file; false when it had none. */
  removeMappings(platformKey: string): boolean {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return false;
    const removed = this.db.delete(ownershipMappings).where(and(eq(ownershipMappings.platformId, platform.id), eq(ownershipMappings.source, 'list'))).run().changes > 0;
    if (removed) this.invalidate(platform.id);
    return removed;
  }

  /** How many mappings from the user's files each console has, by platform key. */
  mappingCounts(): Map<string, number> {
    return new Map(
      this.db
        .select({ key: platforms.key, n: sql<number>`count(*)` })
        .from(ownershipMappings)
        .innerJoin(platforms, eq(platforms.id, ownershipMappings.platformId))
        .where(eq(ownershipMappings.source, 'list'))
        .groupBy(platforms.key)
        .all()
        .map((r) => [r.key, r.n]),
    );
  }

  /**
   * A platform by key; a known platform nobody owns games for yet (or another region's console of its
   * own, such as the Super Famicom) is created, so it can have a catalog.
   */
  platform(platformKey: string): typeof platforms.$inferSelect | null {
    const existing = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (existing) return existing;
    const name = KNOWN_PLATFORMS.find((p) => p.key === platformKey)?.name ?? regionalConsole(platformKey)?.name;
    if (!name) return null;
    return this.db.insert(platforms).values({ key: platformKey, name, source: 'builtin', createdAt: new Date().toISOString() }).returning().get();
  }

  /** The PC storefronts a title is owned in for good (set by the app once the PC library exists). */
  private pcOwnership: (title: string) => string[] = () => [];

  setPcOwnership(lookup: (title: string) => string[]): void {
    this.pcOwnership = lookup;
  }

  /** The platforms with a catalog that count now (another region's own console only while it's in use, see consoleInUse). */
  private withCatalog(): { id: number; key: string; name: string }[] {
    const home = this.settings.get('general.homeRegion');
    const locked = this.settings.get('platforms.regionLocked');
    return this.db
      .selectDistinct({ id: platforms.id, key: platforms.key, name: platforms.name })
      .from(platforms)
      .innerJoin(catalogEntries, eq(catalogEntries.platformId, platforms.id))
      .all()
      .filter((p) => consoleInUse(p.key, home, locked));
  }

  /** Each console's matching with its cross-generation games, kept while its own and its neighbors' stay the same. */
  private crossCache = new Map<number, { inputs: unknown[]; result: CatalogMatch }>();

  /**
   * A console's catalog after matching, with cross-generation games (Settings > Catalogs and matching): a game missing
   * here that you have on the console before or after it in its family counts as owned, saying where.
   */
  private matchFor(platformId: number): CatalogMatch {
    const base = this.baseMatchFor(platformId);
    if (!this.settings.get('catalogs.crossGen')) return base;
    const platformKey = this.db.select({ key: platforms.key }).from(platforms).where(eq(platforms.id, platformId)).get()?.key ?? '';
    const neighbors = crossGenNeighbors(platformKey)
      .map((key) => this.db.select({ id: platforms.id, name: platforms.name }).from(platforms).where(eq(platforms.key, key)).get())
      .filter((p): p is { id: number; name: string } => p !== undefined);
    if (neighbors.length === 0) return base;
    const years = this.settings.get('catalogs.crossGenYears');
    // What each neighbor's answer depends on: its own matching where it has a catalog, else its copies.
    const sides = neighbors.map((n) => (this.hasCatalog(n.id) ? this.baseMatchFor(n.id) : this.collection.consoleRevision(n.id)));
    const inputs = [base, years, ...sides];
    const cached = this.crossCache.get(platformId);
    if (cached && cached.inputs.length === inputs.length && cached.inputs.every((x, i) => x === inputs[i])) return cached.result;
    const partners: CrossGenPartner[] = neighbors.map((n, i) => ({ name: n.name, owned: this.ownedForCrossGen(n.id, sides[i]!) }));
    const ownYears = this.entryYears(platformId);
    const result = applyCrossGen(base, partners, years, (t) => ownYears.get(t.id) ?? null);
    this.crossCache.set(platformId, { inputs, result });
    return result;
  }

  private hasCatalog(platformId: number): boolean {
    return Boolean(this.db.select({ id: catalogEntries.id }).from(catalogEntries).where(eq(catalogEntries.platformId, platformId)).limit(1).get());
  }

  /** A console's catalog games' release years, by entry. */
  private entryYears(platformId: number): Map<number, number | null> {
    const rows = this.db.select({ id: catalogEntries.id, releaseDate: catalogEntries.releaseDate }).from(catalogEntries).where(eq(catalogEntries.platformId, platformId)).all();
    return new Map(rows.map((r) => [r.id, releaseYear(r.releaseDate)]));
  }

  /**
   * The games you have on a neighbor console, by the matching key of each name: from its catalog's owned games (with
   * the year each came out there) and the copies its catalog doesn't cover, or from its copies when it has no catalog.
   */
  private ownedForCrossGen(platformId: number, side: CatalogMatch | string | number): Map<string, CrossGenOwned> {
    const out = new Map<string, CrossGenOwned>();
    if (typeof side !== 'object') {
      const rows = this.db
        .select({ productId: copies.productId, title: copies.title })
        .from(copies)
        .where(and(isNull(copies.goneAt), eq(copies.platformId, platformId)))
        .all();
      for (const r of rows) out.set(matchKey(r.title), { productId: r.productId, title: r.title, year: null });
      return out;
    }
    const years = this.entryYears(platformId);
    for (const r of side.targets) {
      // Owned there through its own copies (another cross-generation answer never chains on).
      if (r.status !== 'owned' || r.via || !r.matches[0]) continue;
      const owned = { productId: r.matches[0].productId, title: r.matches[0].title, year: years.get(r.target.id) ?? null };
      for (const name of [r.target.title, ...(r.target.altTitles ?? [])]) out.set(matchKey(name), owned);
    }
    for (const p of side.unmatched) if (!out.has(matchKey(p.title))) out.set(matchKey(p.title), { productId: p.productId, title: p.title, year: null });
    return out;
  }

  /** A console's catalog matched with its own copies only (cross-generation games come on top, in matchFor). */
  private baseMatchFor(platformId: number): CatalogMatch {
    // The console's own copies: a change on another console keeps this one's matching.
    const revision = this.collection.consoleRevision(platformId);
    const homeRegion = this.settings.get('general.homeRegion');
    const otherRegions = this.settings.get('catalogs.otherRegionsCount');
    const upcomingCount = this.settings.get('catalogs.upcomingCount');
    const keyCards = this.settings.get('catalogs.gameKeyCards');
    const shortTitles = this.settings.get('catalogs.shortTitles');
    // Upcoming games change with the date, so a day's results are kept for that day only.
    const today = new Date().toISOString().slice(0, 10);
    // The catalog's side (its games, their statuses and other names), then the matching with the copies. Each console
    // keeps only its latest of each: a copy bought used to leave the console's previous results behind for good.
    const targetsKey = `${platformId}|${homeRegion}|${this.igdb?.stamp() ?? 0}|${this.settings.get('catalogs.mixedListPlatforms').join(',')}|${this.settings.get('catalogs.physicalRegion')}|${upcomingCount}|${keyCards}|${today}`;
    const cacheKey = `${targetsKey}|${revision}|${otherRegions}|${this.settings.get('catalogs.variantsSatisfy')}|${this.settings.get('catalogs.suggestMatches')}|${shortTitles}`;
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;

    const platformKey = this.db.select({ key: platforms.key }).from(platforms).where(eq(platforms.id, platformId)).get()?.key ?? '';
    // Another region's own console (the Super Famicom) follows the console it is a version of, with its own region.
    const regional = regionalConsole(platformKey);
    const mixed = this.settings.get('catalogs.mixedListPlatforms');
    const needsEvidence = mixed.includes(platformKey) || (regional !== null && mixed.includes(regional.base));
    const ownRegion = regional?.region ?? homeRegion;
    let targets = this.targetsCache.get(targetsKey);
    if (!targets) {
      targets = this.targetsOf(platformId, needsEvidence, ownRegion, keyCards, upcomingCount, today);
      forgetConsole(this.targetsCache, platformId);
      this.targetsCache.set(targetsKey, targets);
    }
    const ownedRows = this.db
      .select({ productId: copies.productId, title: copies.title, quantity: copies.quantity, region: copies.region })
      .from(copies)
      .where(and(isNull(copies.goneAt), eq(copies.platformId, platformId)))
      .all();
    const owned = new Map<string, { productId: string; title: string; copies: number }>();
    for (const r of ownedRows) {
      if (!otherRegions && r.region !== ownRegion) continue;
      const o = owned.get(r.productId);
      if (o) o.copies += r.quantity;
      else owned.set(r.productId, { productId: r.productId, title: r.title, copies: r.quantity });
    }
    return this.matchWith(platformId, cacheKey, targets, owned, ownRegion, shortTitles);
  }

  /** A console's catalog games as the matching takes them: each one's status (settings and evidence), and other names. */
  private targetsOf(platformId: number, needsEvidence: boolean, ownRegion: string, keyCards: boolean, upcomingCount: boolean, today: string): CatalogTarget[] {
    const entries = this.db.select().from(catalogEntries).where(eq(catalogEntries.platformId, platformId)).orderBy(asc(catalogEntries.title)).all();
    const excluded = new Set(
      this.db
        .select({ title: exclusions.title })
        .from(exclusions)
        .where(and(eq(exclusions.platformId, platformId), eq(exclusions.action, 'exclude'), eq(exclusions.active, true)))
        .all()
        .map((e) => normalizeTitle(e.title)),
    );
    return entries.map((e) => {
      // The game's other names: those its source lists, and IGDB's for it once downloaded.
      // (A file name such as "Game.exe", which IGDB gave many games before 0.43.1, names no game.)
      const alt = new Set<string>(e.altTitles ? (JSON.parse(e.altTitles) as string[]).filter((t) => !isFileName(t)) : []);
      const igdb = this.igdb?.find(platformId, e.title);
      if (igdb) for (const name of [igdb.name, ...igdb.altNames]) alt.add(name);
      alt.delete(e.title);
      let status = (excluded.has(normalizeTitle(e.title)) ? 'excluded' : (e.userStatus ?? e.targetStatus)) as TargetStatus;
      // A game its source marks as a download title (unconfirmed), and any game from a list that mixes in
      // download-only games, counts only with evidence of a physical release: the user's list, adding it by
      // hand, an IGDB physical listing, their own confirmation. Owning it is evidence too.
      if (!e.userStatus && (status === 'unconfirmed' || (needsEvidence && (status === 'required' || status === 'optional')))) {
        const physical = Boolean(e.evidence) || Boolean(this.igdb?.physical(platformId, e.title, ownRegion));
        if (!physical) status = 'unconfirmed';
        else if (status === 'unconfirmed') status = 'required';
      }
      // The user's own answer about a game stands; otherwise Settings > Catalogs and matching may leave out Game-Key Cards
      // (known from a list's Format column) and keep games that aren't out yet apart until they are.
      if (!e.userStatus && !keyCards && status !== 'excluded' && isGameKeyCard(e.format)) status = 'excluded';
      if (!e.userStatus && !upcomingCount && (status === 'required' || status === 'optional') && isUpcoming(e.releaseDate, today)) status = 'upcoming';
      return { id: e.id, title: e.title, status, altTitles: [...alt] };
    });
  }

  /** The matching of a console's catalog games with its owned products, kept as the console's latest. */
  private matchWith(
    platformId: number,
    cacheKey: string,
    targets: CatalogTarget[],
    owned: Map<string, { productId: string; title: string; copies: number }>,
    ownRegion: string,
    shortTitles: string,
  ): CatalogMatch {
    const mappings: OwnershipMapping[] = this.db
      .select()
      .from(ownershipMappings)
      .where(eq(ownershipMappings.platformId, platformId))
      .all()
      .map((m) => ({ ownedTitle: m.ownedTitle, satisfies: m.satisfiesTitle, counts: m.counts as OwnershipMapping['counts'] }));
    const decisions: Decision[] = this.db
      .select({ targetId: catalogDecisions.entryId, productId: catalogDecisions.productId, decision: catalogDecisions.decision })
      .from(catalogDecisions)
      .innerJoin(catalogEntries, eq(catalogEntries.id, catalogDecisions.entryId))
      .where(eq(catalogEntries.platformId, platformId))
      .all()
      .map((d) => ({ ...d, decision: d.decision as Decision['decision'] }));
    const ignored = new Set(
      this.db.select({ productId: ignoredProducts.productId }).from(ignoredProducts).where(eq(ignoredProducts.platformId, platformId)).all().map((r) => r.productId),
    );
    const pending = this.db
      .select({ id: pendingPurchases.id, targetId: pendingPurchases.entryId, title: catalogEntries.title })
      .from(pendingPurchases)
      .innerJoin(catalogEntries, eq(catalogEntries.id, pendingPurchases.entryId))
      .where(eq(catalogEntries.platformId, platformId))
      .all();
    const result = matchCatalog(targets, [...owned.values()], mappings, decisions, {
      variantsSatisfy: this.settings.get('catalogs.variantsSatisfy'),
      suggest: this.settings.get('catalogs.suggestMatches'),
      ignored,
      pending,
      // A catalog of Japanese releases (the Super Famicom, or a home region of Japan) takes titles romanized differently as the same.
      romaji: ownRegion === 'japan',
      shortTitles: shortTitles === 'all' || (shortTitles === 'japan' && ownRegion === 'japan'),
    });
    forgetConsole(this.cache, platformId);
    this.cache.set(cacheKey, result);
    return result;
  }

  /** Changes whenever computed results could change (catalog edits, answers, a new collection import). */
  stamp(): string {
    return `${this.revision}|${this.collection.revision()}`;
  }

  /** Changes with the catalogs themselves (edits, answers, settings), not with the copies. */
  catalogStamp(): number {
    return this.revision;
  }

  /** Match results for every platform that has a catalog, with each entry's region. */
  /**
   * One console's catalog after matching, or null when it has no catalog in use. The same object comes back
   * while nothing it depends on changed (the collection, decisions, settings), so callers can keep what they
   * work out from it.
   */
  matchOf(platformKey: string): CatalogMatch | null {
    if (!consoleInUse(platformKey, this.settings.get('general.homeRegion'), this.settings.get('platforms.regionLocked'))) return null;
    const p = this.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, platformKey)).get();
    const has = p && this.db.select({ id: catalogEntries.id }).from(catalogEntries).where(eq(catalogEntries.platformId, p.id)).limit(1).get();
    return p && has ? this.matchFor(p.id) : null;
  }

  /** Every console with a catalog in use, matched; each catalog game's region (regionOf) is read only when asked for (the wishlist does). */
  allMatches(): { platformId: number; key: string; name: string; match: CatalogMatch; regionOf: Map<number, string> }[] {
    const db = this.db;
    return this.withCatalog().map((p) => {
      let regions: Map<number, string> | null = null;
      return {
        platformId: p.id,
        key: p.key,
        name: p.name,
        match: this.matchFor(p.id),
        get regionOf() {
          regions ??= new Map(
            db
              .select({ id: catalogEntries.id, region: catalogEntries.region })
              .from(catalogEntries)
              .where(eq(catalogEntries.platformId, p.id))
              .all()
              .map((e) => [e.id, e.region]),
          );
          return regions;
        },
      };
    });
  }

  /**
   * Games not out yet on the consoles with a catalog, soonest first: a date only as precise as its source
   * ("2026-12" sorts from the month's first day), "TBA" last. Each has its console, format, whether a copy is
   * already owned (a pre-order in the export, or a just-bought mark) and its wishlist score. Excluded games
   * are left out.
   */
  upcoming(): { entryId: number; platformKey: string; platform: string; title: string; releaseDate: string; format: string | null; status: string; score: number | null; reviews: Reviews; preference: string | null }[] {
    const preferences = this.preferences();
    const today = new Date().toISOString().slice(0, 10);
    const out: ReturnType<CatalogService['upcoming']> = [];
    for (const p of this.withCatalog()) {
      const byId = new Map(this.matchFor(p.id).targets.map((t) => [t.target.id, t]));
      const entries = this.db
        .select({ id: catalogEntries.id, title: catalogEntries.title, releaseDate: catalogEntries.releaseDate, format: catalogEntries.format })
        .from(catalogEntries)
        .where(and(eq(catalogEntries.platformId, p.id), isNotNull(catalogEntries.releaseDate)))
        .all();
      for (const e of entries) {
        const t = byId.get(e.id);
        if (!t || t.status === 'excluded' || !isUpcoming(e.releaseDate, today)) continue;
        out.push({
          entryId: e.id,
          platformKey: p.key,
          platform: p.name,
          title: e.title,
          releaseDate: e.releaseDate!,
          format: e.format,
          status: t.status,
          score: this.scorer?.(p.key, e.title)?.score ?? null,
          reviews: reviewsOf(this.igdb?.find(p.id, e.title)),
          preference: preferences.get(`${p.key}|${normalizeTitle(e.title)}`) ?? null,
        });
      }
    }
    const sortKey = (d: string) => (/^\d{4}/.test(d) ? d : '9999');
    return out.sort((a, b) => sortKey(a.releaseDate).localeCompare(sortKey(b.releaseDate)) || a.title.localeCompare(b.title) || a.platform.localeCompare(b.platform));
  }

  /**
   * The catalog games with a full release date (YYYY-MM-DD) from one day to another, both included, on the
   * consoles with a catalog, with their status and wishlist score; never one you said isn't a target.
   */
  releasesBetween(from: string, to: string): { entryId: number; platformKey: string; platform: string; title: string; releaseDate: string; format: string | null; status: string; score: number | null; reviews: Reviews; preference: string | null }[] {
    const preferences = this.preferences();
    const out: ReturnType<CatalogService['releasesBetween']> = [];
    for (const p of this.withCatalog()) {
      const byId = new Map(this.matchFor(p.id).targets.map((t) => [t.target.id, t]));
      const entries = this.db
        .select({ id: catalogEntries.id, title: catalogEntries.title, releaseDate: catalogEntries.releaseDate, format: catalogEntries.format })
        .from(catalogEntries)
        .where(and(eq(catalogEntries.platformId, p.id), gte(catalogEntries.releaseDate, from), lte(catalogEntries.releaseDate, to)))
        .all();
      for (const e of entries) {
        const t = byId.get(e.id);
        if (!t || t.status === 'excluded' || !/^\d{4}-\d{2}-\d{2}$/.test(e.releaseDate ?? '')) continue;
        out.push({
          entryId: e.id,
          platformKey: p.key,
          platform: p.name,
          title: e.title,
          releaseDate: e.releaseDate!,
          format: e.format,
          status: t.status,
          score: this.scorer?.(p.key, e.title)?.score ?? null,
          reviews: reviewsOf(this.igdb?.find(p.id, e.title)),
          preference: preferences.get(`${p.key}|${normalizeTitle(e.title)}`) ?? null,
        });
      }
    }
    return out.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate) || a.title.localeCompare(b.title));
  }

  /**
   * Past releases (Wishlist > Past releases): for each of the last few years (Settings > Interface), the games
   * released around today's date that year, on the consoles with a catalog, with their status, wishlist score and
   * cover; never one you said isn't a target. Only games with a full release date can say when in the year they
   * came out.
   */
  pastReleases(today = dayIn(this.settings.get('general.timeZone'))): {
    yearsAgo: number;
    from: string;
    to: string;
    games: (ReturnType<CatalogService['releasesBetween']>[number] & { coverId: string | null })[];
  }[] {
    const days = this.settings.get('interface.pastWindowDays');
    const out: ReturnType<CatalogService['pastReleases']> = [];
    for (let yearsAgo = 1; yearsAgo <= this.settings.get('interface.pastYears'); yearsAgo++) {
      const then = yearsBefore(today, yearsAgo);
      const from = addDays(then, -days);
      const to = addDays(then, days);
      const games = this.releasesBetween(from, to).map((g) => ({ ...g, coverId: this.igdb?.coverOf(g.platformKey, g.title) ?? null }));
      out.push({ yearsAgo, from, to, games });
    }
    return out;
  }

  /**
   * This week in game history (Today): catalog games released on a day within `days` of today's date in an earlier
   * year, the best known first (the most ratings on IGDB), one line per game (a game out on several consoles the
   * same day keeps the one you own, else the first), then in order of the day: today, yesterday, tomorrow and so
   * on. Never one you said isn't a target.
   */
  onThisWeek(
    today = dayIn(this.settings.get('general.timeZone')),
    days = 3,
    limit = 5,
  ): { platformKey: string; platform: string; title: string; releaseDate: string; yearsAgo: number; offset: number; status: string; rank: number | null; score: number | null; reviews: Reviews; coverId: string | null }[] {
    const year = Number(today.slice(0, 4));
    const dayOf = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
    const now = dayOf(today);
    // The release's month and day in this year (or the next or the last, near New Year): days from today, and that year.
    const anniversaryOf = (released: string): { offset: number; year: number } | null => {
      let best: { offset: number; year: number } | null = null;
      for (const y of [year - 1, year, year + 1]) {
        const md = released.slice(5);
        const t = dayOf(`${y}-${md === '02-29' ? '02-28' : md}`);
        if (Number.isNaN(t)) continue;
        const offset = t - now;
        if (Math.abs(offset) <= days && (best === null || Math.abs(offset) < Math.abs(best.offset))) best = { offset, year: y };
      }
      return best;
    };
    const found = new Map<string, ReturnType<CatalogService['onThisWeek']>[number] & { ratings: number }>();
    for (const p of this.withCatalog()) {
      const byId = new Map(this.matchFor(p.id).targets.map((t) => [t.target.id, t]));
      const entries = this.db
        .select({ id: catalogEntries.id, title: catalogEntries.title, releaseDate: catalogEntries.releaseDate })
        .from(catalogEntries)
        .where(and(eq(catalogEntries.platformId, p.id), isNotNull(catalogEntries.releaseDate), lte(catalogEntries.releaseDate, `${year - 1}-12-31`)))
        .all();
      for (const e of entries) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(e.releaseDate ?? '')) continue;
        const t = byId.get(e.id);
        if (!t || t.status === 'excluded') continue;
        const at = anniversaryOf(e.releaseDate!);
        if (!at) continue;
        const { offset } = at;
        const yearsAgo = at.year - Number(e.releaseDate!.slice(0, 4));
        if (yearsAgo < 1) continue;
        const igdbGame = this.igdb?.find(p.id, e.title);
        const wished = t.status === 'owned' ? undefined : this.scorer?.(p.key, e.title);
        const game = { platformKey: p.key, platform: p.name, title: e.title, releaseDate: e.releaseDate!, yearsAgo, offset, status: t.status, rank: wished?.rank ?? null, score: wished?.score ?? null, reviews: reviewsOf(igdbGame), coverId: null, ratings: igdbGame?.ratingCount ?? 0 };
        const key = `${normalizeTitle(e.title)}|${e.releaseDate}`;
        const had = found.get(key);
        if (!had || (had.status !== 'owned' && game.status === 'owned')) found.set(key, had ? { ...game, ratings: Math.max(had.ratings, game.ratings) } : game);
        else had.ratings = Math.max(had.ratings, game.ratings);
      }
    }
    return [...found.values()]
      .sort((a, b) => b.ratings - a.ratings || (a.status === 'owned' ? 0 : 1) - (b.status === 'owned' ? 0 : 1) || a.title.localeCompare(b.title))
      .slice(0, limit)
      .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset) || a.offset - b.offset || b.yearsAgo - a.yearsAgo || a.title.localeCompare(b.title))
      .map(({ ratings: _r, ...g }) => ({ ...g, coverId: this.igdb?.coverOf(g.platformKey, g.title) ?? null }));
  }

  summary() {
    return this.withCatalog()
      .map((p) => {
        const m = this.matchFor(p.id);
        return { key: p.key, name: p.name, ...m.counts, percent: m.percent, notInCatalog: m.unmatched.length };
      })
      .sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
  }

  detail(platformKey: string, query: { status?: string; q?: string; page?: number; pageSize?: number; all?: boolean; sort?: string; dir?: 'asc' | 'desc' }) {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return null;
    const m = this.matchFor(platform.id);
    const entryRows = new Map(this.db.select().from(catalogEntries).where(eq(catalogEntries.platformId, platform.id)).all().map((e) => [e.id, e]));
    const q = query.q ? normalizeTitle(query.q) : '';
    let rows = m.targets.filter((t) => (!query.status || t.status === query.status) && (!q || normalizeTitle(t.target.title).includes(q)));
    const wishlist = (title: string) => (this.scorer ? this.scorer(platform.key, title) : undefined);
    // Your preference for each game (Must Have... Do Not Recommend), to change it right in the list.
    const preferences = this.preferences();
    // The game's genres as the wishlist names them, from IGDB.
    const genresOf = (title: string) => {
      const game = this.igdb?.find(platform.id, title);
      return game ? (igdbDetails(game).genres ?? []) : [];
    };
    // Sorting by a column: names A to Z first, scores and release dates highest or newest first; games without a value last.
    const sortBy = query.sort === 'score' || query.sort === 'reviews' || query.sort === 'released' || query.sort === 'genre' ? query.sort : 'title';
    const dir = query.dir ?? (sortBy === 'title' || sortBy === 'genre' ? 'asc' : 'desc');
    if (sortBy !== 'title' || dir !== 'asc') {
      const valueOf = (r: (typeof rows)[number]): string | number | null =>
        sortBy === 'score'
          ? (wishlist(r.target.title)?.score ?? null)
          : sortBy === 'reviews'
            ? (reviewsOf(this.igdb?.find(platform.id, r.target.title))?.rating ?? null)
          : sortBy === 'released'
            ? (entryRows.get(r.target.id)?.releaseDate ?? null)
            : sortBy === 'genre'
              ? (genresOf(r.target.title).join(', ') || null)
              : r.target.title;
      const values = new Map(rows.map((r) => [r, valueOf(r)]));
      rows = [...rows].sort((a, b) => {
        const va = values.get(a)!;
        const vb = values.get(b)!;
        if (va === null || vb === null) return va === vb ? a.target.title.localeCompare(b.target.title) : va === null ? 1 : -1;
        const order = typeof va === 'number' ? va - (vb as number) : String(va).localeCompare(String(vb));
        return (dir === 'asc' ? order : -order) || a.target.title.localeCompare(b.target.title);
      });
    }
    const total = rows.length;
    const pageSize = query.all ? Math.max(rows.length, 1) : Math.min(Math.max(query.pageSize ?? 100, 1), 1000);
    const page = Math.max(query.page ?? 1, 1);
    rows = rows.slice((page - 1) * pageSize, page * pageSize);
    // Which release each owned product is (a Super Famicom copy on the Super Nintendo, say), for region badges.
    const regions = this.collection.productRegions(platform.id);
    const withRegion = <T extends { productId: string }>(p: T) => ({ ...p, region: regions.get(p.productId)?.region ?? null, consoleLabel: regions.get(p.productId)?.consoleLabel ?? null });
    return {
      platform: { key: platform.key, name: platform.name },
      counts: m.counts,
      percent: m.percent,
      // The games and copies owned on the platform per region and PriceCharting console name.
      regions: this.collection.regionCounts(platform.id),
      total,
      entries: rows.map((r) => {
        const e = entryRows.get(r.target.id)!;
        return {
          id: e.id,
          title: e.title,
          format: e.format,
          releaseDate: e.releaseDate,
          targetStatus: e.userStatus ?? e.targetStatus,
          notes: e.notes,
          source: e.source,
          evidence: e.evidence ?? (this.igdb?.physical(platform.id, e.title) ? 'igdb' : null),
          coverId: this.igdb?.find(platform.id, e.title)?.coverId ?? null,
          reviews: reviewsOf(this.igdb?.find(platform.id, e.title)),
          status: r.status,
          matches: r.matches.map(withRegion),
          suggestions: r.suggestions,
          rejected: r.rejected ?? [],
          wishlist: r.status === 'missing' ? (wishlist(e.title) ?? null) : null,
          preference: preferences.get(`${platform.key}|${normalizeTitle(e.title)}`) ?? null,
          genres: genresOf(e.title),
          romm: r.status === 'owned' && this.rommLink ? this.rommLink(platform.key, [e.title, ...(r.target.altTitles ?? [])]) : null,
          // Related, never counted: the PC storefronts where the same game is owned for good.
          pc: r.status === 'owned' ? [] : this.pcOwnership(e.title),
        };
      }),
      notInCatalog: m.unmatched.filter((p) => !q || normalizeTitle(p.title).includes(q)).map(withRegion),
      ignored: this.db
        .select({ productId: ignoredProducts.productId, title: ignoredProducts.title })
        .from(ignoredProducts)
        .where(eq(ignoredProducts.platformId, platform.id))
        .orderBy(asc(ignoredProducts.title))
        .all(),
    };
  }

  /**
   * Every open review question across the consoles: look-alikes (an owned game
   * might be this one) and games the catalog itself marks for review.
   */
  reviewQueue(): {
    lookAlikes: { platformKey: string; platform: string; entryId: number; title: string; suggestions: { productId: string; title: string; reason: string }[] }[];
    marked: { platformKey: string; platform: string; entryId: number; title: string; notes: string | null; conditional: boolean }[];
  } {
    const lookAlikes: ReturnType<CatalogService['reviewQueue']>['lookAlikes'] = [];
    const marked: ReturnType<CatalogService['reviewQueue']>['marked'] = [];
    const notes = new Map(
      this.db
        .select({ id: catalogEntries.id, notes: catalogEntries.notes, targetStatus: catalogEntries.targetStatus, userStatus: catalogEntries.userStatus })
        .from(catalogEntries)
        .all()
        .map((e) => [e.id, e]),
    );
    for (const p of this.allMatches().sort((a, b) => a.name.localeCompare(b.name))) {
      for (const t of p.match.targets) {
        if (t.status !== 'review') continue;
        const base = { platformKey: p.key, platform: p.name, entryId: t.target.id, title: t.target.title };
        if (t.suggestions.length > 0) lookAlikes.push({ ...base, suggestions: t.suggestions });
        else {
          const e = notes.get(t.target.id);
          marked.push({ ...base, notes: e?.notes ?? null, conditional: (e?.userStatus ?? e?.targetStatus) !== 'review' });
        }
      }
    }
    return { lookAlikes, marked };
  }

  /** Every catalog game on a platform with its match status, for pickers. */
  titles(platformKey: string): { id: number; title: string; status: string }[] | null {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return null;
    return this.matchFor(platform.id).targets.map((t) => ({ id: t.target.id, title: t.target.title, status: t.status }));
  }

  /** Adds a game to a platform's catalog by hand (a new release, or an owned game the catalog lacks). */
  addEntry(platformKey: string, input: NewEntry): { id: number } | 'no-platform' | 'exists' {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return 'no-platform';
    const title = input.title.trim();
    const region = input.region || consoleRegion(platform.key, this.settings.get('general.homeRegion'));
    const same = this.db
      .select({ title: catalogEntries.title, region: catalogEntries.region })
      .from(catalogEntries)
      .where(eq(catalogEntries.platformId, platform.id))
      .all()
      .some((e) => e.region === region && normalizeTitle(e.title) === normalizeTitle(title));
    if (same) return 'exists';
    const row = this.db
      .insert(catalogEntries)
      .values({
        platformId: platform.id,
        key: `${platform.key}|${region}|${slugify(title)}`,
        title,
        format: input.format?.trim() || null,
        region,
        targetStatus: 'required',
        releaseDate: input.releaseDate?.trim() || null,
        notes: input.notes?.trim() || null,
        source: 'user',
        evidence: 'user',
        updatedAt: new Date().toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: catalogEntries.id })
      .get();
    if (!row) return 'exists';
    this.invalidate(platform.id);
    this.log.info({ context: 'catalogs' }, `Added "${title}" to the ${platform.name} catalog`);
    return { id: row.id };
  }

  /** Removes a game the user added. A catalog source's games are excluded instead: the next refresh would bring them back. */
  deleteEntry(id: number): 'deleted' | 'not-found' | 'not-yours' {
    const entry = this.db.select().from(catalogEntries).where(eq(catalogEntries.id, id)).get();
    if (!entry) return 'not-found';
    if (entry.source !== 'user') return 'not-yours';
    this.db.delete(catalogEntries).where(eq(catalogEntries.id, id)).run();
    this.invalidate(entry.platformId);
    return 'deleted';
  }

  /** Marks an owned product as not a catalog game, or undoes that. */
  setIgnored(platformKey: string, productId: string, ignored: boolean): boolean {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return false;
    if (ignored) {
      const item = this.db
        .select({ title: copies.title })
        .from(copies)
        .where(and(isNull(copies.goneAt), eq(copies.platformId, platform.id), eq(copies.productId, productId)))
        .get();
      if (!item) return false;
      this.db
        .insert(ignoredProducts)
        .values({ platformId: platform.id, productId, title: item.title, createdAt: new Date().toISOString() })
        .onConflictDoNothing()
        .run();
    } else {
      this.db.delete(ignoredProducts).where(and(eq(ignoredProducts.platformId, platform.id), eq(ignoredProducts.productId, productId))).run();
    }
    this.invalidate(platform.id);
    return true;
  }

  decide(entryId: number, productId: string, decision: 'confirmed' | 'rejected'): boolean {
    const entry = this.db.select().from(catalogEntries).where(eq(catalogEntries.id, entryId)).get();
    if (!entry) return false;
    this.db
      .insert(catalogDecisions)
      .values({ entryId, productId, decision, createdAt: new Date().toISOString() })
      .onConflictDoUpdate({ target: [catalogDecisions.entryId, catalogDecisions.productId], set: { decision, createdAt: new Date().toISOString() } })
      .run();
    this.invalidate(entry.platformId);
    this.log.info({ context: 'catalogs' }, `${decision === 'confirmed' ? 'Confirmed' : 'Rejected'} product ${productId} as "${entry.title}"`);
    return true;
  }

  undoDecision(entryId: number, productId: string): boolean {
    const platformId = this.platformOfEntry(entryId);
    const changes = this.db
      .delete(catalogDecisions)
      .where(and(eq(catalogDecisions.entryId, entryId), eq(catalogDecisions.productId, productId)))
      .run().changes;
    this.invalidate(platformId);
    return changes > 0;
  }

  /** A catalog game's title and console, for "I bought it" (a copy of it is added: ownCopies.ts). */
  entry(entryId: number): { title: string; platformKey: string } | null {
    return (
      this.db
        .select({ title: catalogEntries.title, platformKey: platforms.key })
        .from(catalogEntries)
        .innerJoin(platforms, eq(platforms.id, catalogEntries.platformId))
        .where(eq(catalogEntries.id, entryId))
        .get() ?? null
    );
  }

  pendingPurchases(): { id: number; entryId: number; title: string; platformKey: string; platform: string; createdAt: string }[] {
    return this.db
      .select({ id: pendingPurchases.id, entryId: pendingPurchases.entryId, title: catalogEntries.title, platformKey: platforms.key, platform: platforms.name, createdAt: pendingPurchases.createdAt })
      .from(pendingPurchases)
      .innerJoin(catalogEntries, eq(catalogEntries.id, pendingPurchases.entryId))
      .innerJoin(platforms, eq(platforms.id, catalogEntries.platformId))
      .orderBy(asc(pendingPurchases.createdAt))
      .all();
  }

  /** Drops the "just bought" marks whose games an export now includes. Returns how many. */
  clearFulfilledPurchases(): number {
    const pending = this.pendingPurchases();
    if (pending.length === 0) return 0;
    const fulfilled = pending.filter((b) => {
      const platform = this.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, b.platformKey)).get();
      const target = platform ? this.matchFor(platform.id).targets.find((t) => t.target.id === b.entryId) : undefined;
      return target?.matches.some((m) => m.method !== 'pending') ?? false;
    });
    if (fulfilled.length === 0) return 0;
    this.db.delete(pendingPurchases).where(inArray(pendingPurchases.id, fulfilled.map((b) => b.id))).run();
    this.invalidate();
    this.log.info({ context: 'catalogs' }, `The latest import includes ${fulfilled.length} game(s) marked as just bought`);
    return fulfilled.length;
  }

  /** Sets the target status of several games at once (the Review page's bulk answers). */
  setTargetStatuses(entryIds: number[], status: TargetStatus): number {
    if (entryIds.length === 0) return 0;
    const changes = this.db.transaction((tx) => {
      let n = 0;
      for (let i = 0; i < entryIds.length; i += 500) {
        n += tx
          .update(catalogEntries)
          .set({ userStatus: status, updatedAt: new Date().toISOString() })
          .where(inArray(catalogEntries.id, entryIds.slice(i, i + 500)))
          .run().changes;
      }
      return n;
    });
    this.invalidate();
    this.log.info({ context: 'catalogs' }, `Set ${changes} catalog games to ${status}`);
    return changes;
  }

  setTargetStatus(entryId: number, status: TargetStatus): boolean {
    const changes = this.db
      .update(catalogEntries)
      .set({ userStatus: status, updatedAt: new Date().toISOString() })
      .where(eq(catalogEntries.id, entryId))
      .run().changes;
    this.invalidate(this.platformOfEntry(entryId));
    return changes > 0;
  }
}

const STATUSES = new Set(['required', 'optional', 'review', 'excluded']);
const REGIONS = new Set(['north-america', 'europe', 'japan', 'other']);
const DATE = /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/;

/** Catalogs: completion per console, each console's games and exports, the review queue, and the user's answers. */
export function registerCatalogRoutes(app: FastifyInstance, catalogs: CatalogService): void {
  app.get('/api/v1/catalogs', async () => catalogs.summary());

  app.get('/api/v1/review', async () => catalogs.reviewQueue());

  /** Games not out yet on the consoles with a catalog, soonest first. */
  app.get('/api/v1/catalogs/upcoming', async () => catalogs.upcoming());

  /** Past releases: the games that came out around this time in each of the last few years. */
  app.get('/api/v1/catalogs/past', async () => catalogs.pastReleases());

  // Coming soon as a calendar file to import (Google Calendar, Outlook, Apple Calendar): the dated releases.
  app.get('/api/v1/catalogs/upcoming.ics', async (_request, reply) => {
    const events = catalogs.upcoming().map((g) => ({
      // By console and title, which survive a catalog rebuild, so importing the file again updates its events.
      uid: `${g.platformKey}-${slugify(g.title)}@squirrelcade`,
      date: g.releaseDate,
      summary: `${g.title} (${g.platform})`,
      description: [g.status === 'owned' ? 'You have a copy' : 'Not in your collection', g.format && /game[\s-]*key/i.test(g.format) ? 'Game-Key Card' : null].filter(Boolean).join(', '),
    }));
    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .header('content-disposition', 'attachment; filename="squirrelcade-coming-soon.ics"')
      .send(calendarFile('Squirrelcade: coming soon', events));
  });

  /** A console's ownership mappings (CSV): owned titles that count as catalog games; they replace the last file's. */
  app.put('/api/v1/catalogs/:platform/mappings', async (request, reply) => {
    const key = (request.params as { platform: string }).platform;
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no-file', message: 'Choose the CSV file of the mappings.' });
    const parsed = parseOwnershipMappings((await file.toBuffer()).toString('utf8'));
    if (parsed.mappings.length === 0) return reply.code(400).send({ error: 'invalid-mappings', message: parsed.problems.join(' ') });
    const saved = catalogs.setMappings(key, parsed.mappings);
    if (saved === null) return reply.code(404).send({ error: 'not-found', message: 'No such console.' });
    return { mappings: saved, problems: parsed.problems };
  });

  app.delete('/api/v1/catalogs/:platform/mappings', async (request, reply) => {
    if (!catalogs.removeMappings((request.params as { platform: string }).platform)) return reply.code(404).send({ error: 'not-found', message: 'This console has no mappings of yours.' });
    return { removed: true };
  });

  app.get('/api/v1/catalogs/:platform', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const detail = catalogs.detail((request.params as { platform: string }).platform, {
      status: q.status || undefined,
      q: q.q || undefined,
      sort: q.sort || undefined,
      dir: q.dir === 'asc' || q.dir === 'desc' ? q.dir : undefined,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
    });
    if (!detail) return reply.code(404).send({ error: 'not-found', message: 'No such platform.' });
    return shown(request).romm ? detail : { ...detail, entries: detail.entries.map((e) => ({ ...e, romm: null })) };
  });

  app.post('/api/v1/catalogs/decisions', async (request, reply) => {
    const b = request.body as { entryId?: unknown; productId?: unknown; decision?: unknown } | null;
    if (typeof b?.entryId !== 'number' || typeof b.productId !== 'string' || (b.decision !== 'confirmed' && b.decision !== 'rejected')) {
      return reply.code(400).send({ error: 'invalid', message: 'Send entryId, productId and decision (confirmed or rejected).' });
    }
    if (!catalogs.decide(b.entryId, b.productId, b.decision)) return reply.code(404).send({ error: 'not-found', message: 'No such catalog game.' });
    return { ok: true };
  });

  app.delete('/api/v1/catalogs/decisions', async (request) => {
    const b = request.body as { entryId?: number; productId?: string } | null;
    return { removed: typeof b?.entryId === 'number' && typeof b.productId === 'string' ? catalogs.undoDecision(b.entryId, b.productId) : false };
  });

  app.post('/api/v1/catalogs/entries/status', async (request, reply) => {
    const b = request.body as { ids?: unknown; targetStatus?: unknown } | null;
    const ids = Array.isArray(b?.ids) ? b.ids.filter((x): x is number => Number.isInteger(x)) : [];
    if (typeof b?.targetStatus !== 'string' || !STATUSES.has(b.targetStatus) || ids.length === 0 || ids.length > 20_000) {
      return reply.code(400).send({ error: 'invalid', message: 'Send ids (catalog game ids) and targetStatus (required, optional, review or excluded).' });
    }
    return { changed: catalogs.setTargetStatuses(ids, b.targetStatus as TargetStatus) };
  });

  app.patch('/api/v1/catalogs/entries/:id', async (request, reply) => {
    const status = (request.body as { targetStatus?: string } | null)?.targetStatus;
    if (!status || !STATUSES.has(status)) return reply.code(400).send({ error: 'invalid', message: 'targetStatus must be required, optional, review or excluded.' });
    if (!catalogs.setTargetStatus(Number((request.params as { id: string }).id), status as TargetStatus)) {
      return reply.code(404).send({ error: 'not-found', message: 'No such catalog game.' });
    }
    return { ok: true };
  });

  /** A console's whole catalog as a spreadsheet, with each game's status. */
  app.get('/api/v1/catalogs/:platform/export', async (request, reply) => {
    const key = (request.params as { platform: string }).platform;
    const detail = catalogs.detail(key, { all: true });
    if (!detail) return reply.code(404).send({ error: 'not-found', message: 'No such platform.' });
    const STATUS = { owned: 'Owned', missing: 'Missing', review: 'Needs review', excluded: 'Excluded', unconfirmed: 'Not confirmed physical', upcoming: 'Upcoming' } as const;
    const rows = [
      ['Title', 'Status', 'Owned as', 'Maybe owned as', 'Format', 'Released', 'Notes'],
      ...detail.entries.map((e) => [
        e.title,
        STATUS[e.status as keyof typeof STATUS] ?? e.status,
        e.matches.map((m) => m.title).join('; '),
        e.suggestions.map((s) => s.title).join('; '),
        e.format ?? '',
        e.releaseDate ?? '',
        e.notes ?? '',
      ]),
    ];
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="squirrelcade-${key}-${date}.csv"`)
      .send(toCsv(rows));
  });

  app.get('/api/v1/catalogs/:platform/titles', async (request, reply) => {
    const titles = catalogs.titles((request.params as { platform: string }).platform);
    return titles ?? reply.code(404).send({ error: 'not-found', message: 'No such platform.' });
  });

  app.post('/api/v1/catalogs/:platform/entries', async (request, reply) => {
    const b = request.body as Partial<Record<keyof NewEntry, unknown>> | null;
    const text = (v: unknown) => (typeof v === 'string' ? v : null);
    if (typeof b?.title !== 'string' || !b.title.trim() || b.title.length > 300) {
      return reply.code(400).send({ error: 'invalid', message: 'Send the game title (up to 300 characters).' });
    }
    if (b.region !== undefined && !REGIONS.has(String(b.region))) return reply.code(400).send({ error: 'invalid', message: 'Unknown region.' });
    const releaseDate = text(b.releaseDate)?.trim() || null;
    if (releaseDate && !DATE.test(releaseDate)) {
      return reply.code(400).send({ error: 'invalid', message: 'Release date must look like 2026-09-27, 2026-09 or 2026.' });
    }
    const result = catalogs.addEntry((request.params as { platform: string }).platform, {
      title: b.title,
      region: b.region === undefined ? undefined : String(b.region),
      format: text(b.format),
      releaseDate,
      notes: text(b.notes),
    });
    if (result === 'no-platform') return reply.code(404).send({ error: 'not-found', message: 'No such platform.' });
    if (result === 'exists') return reply.code(409).send({ error: 'exists', message: 'That game is already in this catalog.' });
    return reply.code(201).send(result);
  });

  app.delete('/api/v1/catalogs/entries/:id', async (request, reply) => {
    const result = catalogs.deleteEntry(Number((request.params as { id: string }).id));
    if (result === 'not-found') return reply.code(404).send({ error: 'not-found', message: 'No such catalog game.' });
    if (result === 'not-yours') return reply.code(400).send({ error: 'not-yours', message: 'Only games you added can be removed; exclude this one instead.' });
    return { ok: true };
  });

  app.post('/api/v1/catalogs/:platform/ignored', async (request, reply) => {
    const productId = (request.body as { productId?: unknown } | null)?.productId;
    if (typeof productId !== 'string') return reply.code(400).send({ error: 'invalid', message: 'Send the productId.' });
    if (!catalogs.setIgnored((request.params as { platform: string }).platform, productId, true)) {
      return reply.code(404).send({ error: 'not-found', message: 'No such platform or owned game.' });
    }
    return { ok: true };
  });

  app.delete('/api/v1/catalogs/:platform/ignored/:productId', async (request) => {
    const p = request.params as { platform: string; productId: string };
    return { ok: catalogs.setIgnored(p.platform, p.productId, false) };
  });

}
