import {
  baseTitle,
  consoleRegion,
  matchKey,
  toCsv,
  mergeDetails,
  normalizeTitle,
  collectionNameMatches,
  waysToPlayText,
  releaseYear,
  romanNumerals,
  sameGameAcross,
  scoreCandidates,
  scoringConfig,
  SAME_GAME_AT,
  selectMaster,
  TitleMatcher,
  topByPlatform,
  type GameDetails,
  type GameOnConsole,
  type IgdbGame,
  type WayToPlay,
  type MasterEntry,
  type ScoredCandidate,
  type SettingsValues,
  type ShapeSpec,
  type WishlistCandidate,
} from '@squirrelcade/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { shown } from './access.js';
import type { Logger } from 'pino';
import type { CatalogService } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import type { IgdbService, Reviews } from './igdb.js';
import { catalogEntries, copies, exclusions, gameDetails, myWishlist, ownerPreferences, ownershipMappings, platforms } from './db/schema.js';
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
  /** What the wishlist is (D217): Squirrelcade's ranked list, or the games the owner picked (master is then theirs). */
  source: 'suggested' | 'mine';
  /** With a wishlist the owner picks: the ranked list to pick from (each entry's rank its place there). */
  suggestions: MasterEntry[] | null;
}

/** One game the owner put on My wishlist (D217). */
export interface MyWish {
  platformKey: string;
  platform: string;
  title: string;
  source: string;
  addedAt: string;
}

/**
 * The wishlist: scores every missing catalog game from its details and the settings, then picks the master list
 * and each console's list; cached until the collection, catalogs, details or settings change.
 */
/** The facts of a game the owner may set for its acorns (the rest of GameDetails is IGDB's or worked out). */
const OWN_DETAIL_FIELDS = new Set(['genre', 'style', 'personalInterest', 'significance', 'marketUrgency', 'releaseClass', 'tieIn', 'japaneseDeveloped', 'offbeat', 'naPhysical', 'seriesRemaining', 'seriesCompletes', 'franchise', 'physicalProof', 'notes']);

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

  /** The owner's copies by title key, with their console and the year each came out there, for elsewhereOf. */
  private acrossCache: {
    key: string;
    byTitle: Map<string, { platformKey: string; platform: string; title: string; year: number | null }[]>;
    entryYears: Map<number, number | null>;
    /** Catalog games' years by their exact name (normalized), on any console. */
    namedYears: Map<string, number[]>;
  } | null = null;

  private across(): NonNullable<WishlistService['acrossCache']> {
    const key = `${this.collection.revision()}|${this.catalogs.stamp()}`;
    if (this.acrossCache?.key === key) return this.acrossCache;
    const entryRows = this.db.select({ id: catalogEntries.id, title: catalogEntries.title, releaseDate: catalogEntries.releaseDate }).from(catalogEntries).all();
    const entryYears = new Map(entryRows.map((r) => [r.id, releaseYear(r.releaseDate)] as const));
    const namedYears = new Map<string, number[]>();
    for (const r of entryRows) {
      const y = releaseYear(r.releaseDate);
      if (y === null) continue;
      const k = normalizeTitle(r.title);
      const list = namedYears.get(k);
      if (!list) namedYears.set(k, [y]);
      else if (!list.includes(y)) list.push(y);
    }
    // A copy's year is its catalog game's on that console (IGDB's, at the time of asking, when no catalog knows it).
    const ownedYear = new Map<string, number | null>();
    for (const p of this.catalogs.allMatches()) {
      for (const t of p.match.targets) {
        for (const m of t.matches) if (m.method !== 'crossgen') ownedYear.set(`${p.key}|${normalizeTitle(m.title)}`, entryYears.get(t.target.id) ?? null);
      }
    }
    const byTitle: NonNullable<WishlistService['acrossCache']>['byTitle'] = new Map();
    const rows = this.db
      .select({ title: copies.title, platformKey: platforms.key, platform: platforms.name })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    // WR-038 penalizes only the same title (spelling differences aside): named editions such as
    // "Dredge: Deluxe Edition" are not treated as the same game across consoles.
    for (const r of rows) {
      const k = matchKey(baseTitle(r.title));
      const entry = { ...r, year: ownedYear.get(`${r.platformKey}|${normalizeTitle(r.title)}`) ?? null };
      const list = byTitle.get(k);
      if (list) list.push(entry);
      else byTitle.set(k, [entry]);
    }
    // A copy no catalog knows takes the year of a copy spelled the same on another console (an Xbox 360 copy beside the
    // PlayStation 3's).
    for (const list of byTitle.values()) {
      for (const c of list) {
        if (c.year !== null) continue;
        const spelled = normalizeTitle(baseTitle(c.title));
        c.year = list.find((o) => o.year !== null && normalizeTitle(baseTitle(o.title)) === spelled)?.year ?? null;
      }
    }
    this.acrossCache = { key, byTitle, entryYears, namedYears };
    return this.acrossCache;
  }

  /**
   * The other consoles the owner has this game on: the same title (spelling aside), and the same game by
   * sameGameAcross (R12: 2022's "Modern Warfare II" isn't 2009's "Modern Warfare 2"). `entryId` is the catalog
   * game asked about, for its year.
   */
  /** A copy as sameGameAcross sees it: its title, the year it came out on its console, IGDB's game. */
  copyOnConsole(platformKey: string, title: string): GameOnConsole {
    const k = matchKey(baseTitle(title));
    const own = this.across().byTitle.get(k)?.find((c) => c.platformKey === platformKey && c.title === title);
    const igdb = this.igdb?.findByKey(platformKey, title);
    return { title, year: own?.year ?? releaseYear(igdb?.released), igdbId: igdb?.id ?? null };
  }

  /**
   * Whether a title asked about (by Claude's check_ownership, with no console or year) is the owner's copy, when the two
   * read the same but spell the number differently: a catalog game named exactly as asked, from other years, is
   * another game (R12: "Call of Duty: Modern Warfare II", 2022, isn't the owner's 2009 "Modern Warfare 2").
   */
  askedIsCopy(asked: string, platformKey: string, copyTitle: string): boolean {
    if (romanNumerals(asked).join(',') === romanNumerals(copyTitle).join(',')) return true;
    const years = this.across().namedYears.get(normalizeTitle(asked));
    if (!years?.length) return true;
    const copy = this.copyOnConsole(platformKey, copyTitle);
    const window = this.settings.get('catalogs.crossGenYears');
    return years.some((year) => sameGameAcross({ title: asked, year }, { ...copy, igdbId: null }, window));
  }

  /** Whether a copy on another console is the same game as one asked about here (sameGameAcross, R12). */
  sameGameAs(here: { platformKey: string; title: string; entryId?: number }, there: { platformKey: string; title: string }): boolean {
    const { entryYears } = this.across();
    const igdb = this.igdb?.findByKey(here.platformKey, here.title);
    const a = { title: here.title, year: (here.entryId !== undefined ? entryYears.get(here.entryId) : null) ?? releaseYear(igdb?.released), igdbId: igdb?.id ?? null };
    return sameGameAcross(a, this.copyOnConsole(there.platformKey, there.title), this.settings.get('catalogs.crossGenYears'));
  }

  /**
   * What ways to play a game the owner has, kept until the copies or IGDB's lists change (1.5.1): the IGDB games their
   * copies are (by name, or for a collection or remaster by collectionNameMatches), the IGDB games of the consoles they
   * have by id, and their compilation mappings.
   */
  private waysCache: {
    key: string;
    ownedIds: Map<number, Set<string>>;
    byId: Map<number, IgdbGame>;
    ownedTitleOn: Map<string, Set<string>>;
    mapped: Map<string, string[]>;
  } | null = null;

  private waysIndex(): NonNullable<WishlistService['waysCache']> {
    const key = `${this.collection.revision()}|${this.igdb?.stamp() ?? 0}|${this.catalogs.stamp()}`;
    if (this.waysCache?.key === key) return this.waysCache;
    const rows = this.db
      .select({ title: copies.title, platformId: platforms.id, platform: platforms.name })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    const ownedIds = new Map<number, Set<string>>();
    const ownedTitleOn = new Map<string, Set<string>>();
    const byId = new Map<number, IgdbGame>();
    const packages = new Map<number, IgdbGame[]>();
    const igdb = this.igdb;
    const packaged = (g: IgdbGame | undefined) => g?.gameType === 'Bundle' || g?.gameType === 'Remaster' || g?.gameType === 'Remake';
    for (const pid of new Set(rows.map((r) => r.platformId))) {
      const list = igdb?.games(pid) ?? [];
      for (const g of list) if (!byId.has(g.id)) byId.set(g.id, g);
      packages.set(pid, list.filter((g) => packaged(g)));
    }
    const PACKAGED = /collection|bundle|pack|remaster|trilogy|anthology|classics|anniversary|[+&]/i;
    for (const r of rows) {
      const k = matchKey(baseTitle(r.title));
      ownedTitleOn.set(k, (ownedTitleOn.get(k) ?? new Set()).add(r.platform));
      if (!igdb) continue;
      let g = igdb.find(r.platformId, r.title);
      // A collection's or remaster's box rarely says its name as IGDB does ("Final Fantasy I-VI Collection Pixel Remaster").
      if (!packaged(g) && PACKAGED.test(r.title)) g = packages.get(r.platformId)?.find((x) => collectionNameMatches(r.title, [x.name, ...x.altNames])) ?? g;
      if (g) ownedIds.set(g.id, (ownedIds.get(g.id) ?? new Set()).add(r.platform));
    }
    const mapped = new Map<string, string[]>();
    for (const m of this.db.select({ owned: ownershipMappings.ownedTitle, satisfies: ownershipMappings.satisfiesTitle, counts: ownershipMappings.counts }).from(ownershipMappings).all()) {
      if (m.counts === 'no') continue;
      const k = matchKey(baseTitle(m.satisfies));
      mapped.set(k, [...new Set([...(mapped.get(k) ?? []), m.owned])]);
    }
    this.waysCache = { key, ownedIds, byId, ownedTitleOn, mapped };
    return this.waysCache;
  }

  /**
   * The collections, remasters and remakes the owner has that a game can be played in, on any console or on PC (1.5.1):
   * IGDB's bundles of the game (and the bundles those are in), its remasters and remakes (Settings > Acorns ranking says
   * which count) and the bundles of those, and the owner's compilation mappings. PC counts what's owned for good.
   */
  waysToPlay(platformKey: string, title: string): WayToPlay[] {
    const idx = this.waysIndex();
    const s = this.settings;
    const ways = new Map<string, WayToPlay>();
    const add = (kind: WayToPlay['kind'], name: string, on: string[]) => {
      if (on.length === 0 || !name) return;
      const k = `${kind}|${name}`;
      const w = ways.get(k);
      if (w) w.on = [...new Set([...w.on, ...on])];
      else ways.set(k, { kind, title: name, on: [...new Set(on)] });
    };
    const onFor = (id: number, name: string | undefined) => {
      const on = [...(idx.ownedIds.get(id) ?? [])];
      if (name) for (const store of this.pcOwnership(name)) on.push(`PC (${store})`);
      return on;
    };
    const g = this.igdb?.findByKey(platformKey, title);
    if (g) {
      const via = (kind: WayToPlay['kind'], ids: readonly number[]) => {
        for (const id of ids) {
          const r = idx.byId.get(id);
          if (!r) continue;
          add(kind, r.name, onFor(id, r.name));
          // The collections it's in: a collection of collections (Legacy Collection 1 + 2), a remaster in a collection.
          for (const b of r.bundles ?? []) {
            const bundle = idx.byId.get(b);
            if (bundle) add(kind, kind === 'collection' ? bundle.name : `${r.name} in ${bundle.name}`, onFor(b, bundle.name));
          }
        }
      };
      via('collection', g.bundles ?? []);
      if (s.get('wishlist.playableRemasters')) via('remaster', g.remasters ?? []);
      if (s.get('wishlist.playableRemakes')) via('remake', g.remakes ?? []);
    }
    for (const owned of idx.mapped.get(matchKey(baseTitle(title))) ?? []) {
      const on = [...(idx.ownedTitleOn.get(matchKey(baseTitle(owned))) ?? [])];
      for (const store of this.pcOwnership(owned)) on.push(`PC (${store})`);
      add('collection', owned, on);
    }
    return [...ways.values()];
  }

  elsewhereOf(platformKey: string, platformName: string, title: string, entryId?: number): string[] {
    const { byTitle, entryYears } = this.across();
    const list = byTitle.get(matchKey(baseTitle(title)));
    if (!list) return [];
    const years = this.settings.get('catalogs.crossGenYears');
    let here: { title: string; year: number | null; igdbId: number | null } | null = null;
    const names = new Set<string>();
    for (const c of list) {
      if (c.platform === platformName || names.has(c.platform)) continue;
      if (!here) {
        const igdb = this.igdb?.findByKey(platformKey, title);
        here = { title, year: (entryId !== undefined ? entryYears.get(entryId) : null) ?? releaseYear(igdb?.released), igdbId: igdb?.id ?? null };
      }
      const igdb = this.igdb?.findByKey(c.platformKey, c.title);
      if (sameGameAcross(here, { title: c.title, year: c.year ?? releaseYear(igdb?.released), igdbId: igdb?.id ?? null }, years)) names.add(c.platform);
    }
    return [...names];
  }

  private cacheKey(): string {
    return `${this.catalogs.stamp()}|${this.revision}|${this.igdb?.stamp() ?? 0}`;
  }

  /**
   * The wishlist's stamp when it's worked out for what it depends on now (compute() then answers at once), null while
   * it needs working out again: Game of the Day keeps its pick until it changes (1.5.1).
   */
  workedOut(): string | null {
    const key = this.cacheKey();
    return this.cache?.key === key ? key : null;
  }

  /** The wishlist, worked out now if what it depends on changed (in one go: see rebuild for the background). */
  compute(): WishlistResult {
    const key = this.cacheKey();
    if (this.cache?.key === key) return this.cache.result;
    const steps = this.build(key, Date.now());
    let step = steps.next();
    while (!step.done) step = steps.next();
    return step.value;
  }

  /**
   * The wishlist worked out in the background (1.4.0, D220: a rebuild in one go held the server 4.4 s after an
   * update): a console at a time, then the scoring and the lists, letting requests in between. Whatever asks for it
   * meanwhile gets it worked out at once (and this stops); until then the old one is kept.
   */
  async rebuild(): Promise<void> {
    const key = this.cacheKey();
    if (this.cache?.key === key) return;
    const steps = this.build(key, Date.now());
    let step = steps.next();
    while (!step.done) {
      await new Promise((r) => setImmediate(r));
      if (this.cache?.key === key || this.cacheKey() !== key) return;
      step = steps.next();
    }
  }

  /** The games on My wishlist (D217), newest first. */
  mine(): MyWish[] {
    return this.db
      .select({ platformKey: platforms.key, platform: platforms.name, title: myWishlist.title, source: myWishlist.source, addedAt: myWishlist.addedAt })
      .from(myWishlist)
      .innerJoin(platforms, eq(platforms.id, myWishlist.platformId))
      .orderBy(desc(myWishlist.addedAt))
      .all();
  }

  /** Puts a game on My wishlist (from Suggestions, a game's page, Store Mode); false for an unknown console. */
  addMine(platformKey: string, title: string, source = 'suggestions'): boolean {
    const platform = this.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, platformKey)).get();
    const t = typeof title === 'string' ? title.trim().slice(0, 300) : '';
    if (!platform || !t) return false;
    const src = ['suggestions', 'game', 'store', 'friend', 'import'].includes(source) ? source : 'suggestions';
    this.db.insert(myWishlist).values({ platformId: platform.id, title: t, titleKey: normalizeTitle(t), source: src, addedAt: new Date().toISOString() }).onConflictDoNothing().run();
    this.invalidate();
    return true;
  }

  /** Takes a game off My wishlist. */
  removeMine(platformKey: string, title: string): boolean {
    const platform = this.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return false;
    const removed = this.db.delete(myWishlist).where(and(eq(myWishlist.platformId, platform.id), eq(myWishlist.titleKey, normalizeTitle(title)))).run().changes > 0;
    if (removed) this.invalidate();
    return removed;
  }

  /**
   * Whether the owner has a game on this console after all (D217: a tester's owned games were suggested): a copy whose
   * title is the same game (spellings, editions and punctuation aside, at the confidence that counts as the same game),
   * even when the console's catalog didn't match it to its entry. The copy's title, or null.
   */
  private ownedHere(): (platformKey: string, title: string) => string | null {
    // Kept with its answers until the copies change: the lists shown are mostly the same from one rebuild to the next.
    return this.ownedAnswers().lookup;
  }

  /** The games found owned so far (by "platformKey|normalized title"), left out before the lists are picked. */
  private knownOwned(): Map<string, string> {
    return this.ownedAnswers().owned;
  }

  private ownedAnswers(): { revision: string; lookup: (platformKey: string, title: string) => string | null; owned: Map<string, string> } {
    const revision = this.collection.revision();
    if (this.ownedCache?.revision === revision) return this.ownedCache;
    const answers = new Map<string, string | null>();
    const owned = new Map<string, string>();
    const look = this.ownedLookup();
    const lookup = (platformKey: string, title: string) => {
      const k = `${platformKey}|${title}`;
      let a = answers.get(k);
      if (a === undefined) {
        answers.set(k, (a = look(platformKey, title)));
        if (a) owned.set(`${platformKey}|${normalizeTitle(title)}`, a);
      }
      return a;
    };
    this.ownedCache = { revision, lookup, owned };
    return this.ownedCache;
  }

  private ownedCache: { revision: string; lookup: (platformKey: string, title: string) => string | null; owned: Map<string, string> } | null = null;

  private ownedLookup(): (platformKey: string, title: string) => string | null {
    const rows = this.db
      .select({ title: copies.title, platformKey: platforms.key })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    const exact = new Map<string, string>();
    const byPlatform = new Map<string, { title: string }[]>();
    for (const r of rows) {
      exact.set(`${r.platformKey}|${matchKey(baseTitle(r.title))}`, r.title);
      const list = byPlatform.get(r.platformKey);
      if (list) list.push({ title: r.title });
      else byPlatform.set(r.platformKey, [{ title: r.title }]);
    }
    const matchers = new Map<string, TitleMatcher<{ title: string }>>();
    return (platformKey, title) => {
      const hit = exact.get(`${platformKey}|${matchKey(baseTitle(title))}`);
      if (hit) return hit;
      const list = byPlatform.get(platformKey);
      if (!list) return null;
      let m = matchers.get(platformKey);
      if (!m) matchers.set(platformKey, (m = new TitleMatcher(list, (x) => [x.title])));
      return m.find(title, { min: SAME_GAME_AT, limit: 1 })[0]?.item.title ?? null;
    };
  }

  private *build(key: string, t0: number): Generator<void, WishlistResult, void> {
    let busyMs = 0;
    let since = Date.now();
    function* pause(): Generator<void, void, void> {
      busyMs += Date.now() - since;
      yield;
      since = Date.now();
    }

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
    const offList = new Map<string, string>();
    const playableAction = s['wishlist.playableAction'];
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
        const owned = this.elsewhereOf(p.key, p.name, t.target.title, t.target.id);
        // A way to play it the owner has (a collection, a remaster: 1.5.1), unless Settings say it makes no difference.
        const playable = playableAction === 'ignore' ? [] : this.waysToPlay(p.key, t.target.title);
        if (playable.length > 0 && playableAction === 'off-list' && owned.length === 0) {
          hiddenCount++;
          offList.set(`${p.key}|${normalizeTitle(t.target.title)}`, `${waysToPlayText(playable)}, so it's left off the wishlist (Settings > Acorns ranking).`);
          continue;
        }
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
          ...(playable.length > 0 ? { playable } : {}),
          inSets: this.setsOf(p.key, [t.target.title, ...(t.target.altTitles ?? [])]),
          preference: prefs.get(k),
        });
        platformCandidates++;
      }
      remaining.set(p.key, count);
      platformRows.push({ key: p.key, name: p.name, candidates: platformCandidates });
      yield* pause();
    }

    const tastes = this.tastes();
    yield* pause();
    let scored = scoreCandidates(candidates, remaining, config, { ownedInSeries: tastes.series, completion });
    // A game the owner has on the console isn't suggested, even when its catalog didn't see the copy (D217): the lists
    // shown are checked (every candidate would take seconds), and picked again without what's owned; what an earlier
    // rebuild found owned (the copies unchanged since) is left out before they're picked.
    const ownedHere = this.ownedHere();
    const owned = new Map(this.knownOwned());
    if (owned.size > 0) scored = scored.filter((c) => !owned.has(`${c.platformKey}|${normalizeTitle(c.title)}`));
    yield* pause();
    let master = selectMaster(scored, config);
    let byPlatform = topByPlatform(scored, config);
    yield* pause();
    const checked = new Set<string>(owned.keys());
    for (let round = 0; round < 4; round++) {
      let found = 0;
      for (const c of [...master, ...[...byPlatform.values()].flat()]) {
        const k = `${c.platformKey}|${normalizeTitle(c.title)}`;
        if (checked.has(k)) continue;
        checked.add(k);
        const copy = ownedHere(c.platformKey, c.title);
        if (copy) {
          owned.set(k, copy);
          found++;
        }
      }
      if (found === 0) break;
      scored = scored.filter((c) => !owned.has(`${c.platformKey}|${normalizeTitle(c.title)}`));
      master = selectMaster(scored, config);
      byPlatform = topByPlatform(scored, config);
      yield* pause();
    }
    for (const [k, copy] of owned) offList.set(k, `You have it on this console ("${copy}"), so it isn't suggested.`);
    if (owned.size > 0) this.log.info({ context: 'wishlist', owned: owned.size }, `${owned.size} game${owned.size === 1 ? '' : 's'} the catalogs counted as missing ${owned.size === 1 ? 'is' : 'are'} yours by title, so ${owned.size === 1 ? "it isn't" : "they aren't"} suggested`);
    const all = new Map(scored.map((c) => [`${c.platformKey}|${normalizeTitle(c.title)}`, c]));
    // Candidates the rules left out: a preference that keeps a game off, or a release class that isn't a target.
    for (const c of candidates) {
      const k = `${c.platformKey}|${normalizeTitle(c.title)}`;
      if (all.has(k) || owned.has(k)) continue;
      const rc = c.details?.releaseClass?.trim();
      offList.set(k, c.preference && !Object.keys(config.preferencePoints).some((k) => normalizeTitle(k) === normalizeTitle(c.preference!)) ? `Your preference "${c.preference}" keeps it off the wishlist.` : `Its release class (${rc || 'unknown'}) keeps it off the wishlist.`);
    }
    const index = new Map<string, { score: number; priority: string; rank: number | null }>();
    for (const c of scored) index.set(`${c.platformKey}|${normalizeTitle(c.title)}`, { score: c.score, priority: c.priority, rank: null });
    // A game's own score (0 to the top of the scale) and its place on the master list; the master list's score,
    // less its variety penalties, only orders that list (and can fall below 0).
    for (const m of master) index.set(`${m.platformKey}|${normalizeTitle(m.title)}`, { score: m.score, priority: m.priority, rank: m.rank });
    // My wishlist (D217): the games the owner picked, in their acorns' order (one not scored at the end), are the
    // wishlist; the ranked list stays as Suggestions. A game they now have on the console drops off.
    const source = s['wishlist.source'] === 'mine' ? 'mine' : 'suggested';
    let suggestions: MasterEntry[] | null = null;
    if (source === 'mine') {
      suggestions = master;
      for (const v of index.values()) v.rank = null;
      master = this.mine()
        .filter((w) => !ownedHere(w.platformKey, w.title))
        .map((w): MasterEntry => {
          const c = all.get(`${w.platformKey}|${normalizeTitle(w.title)}`);
          const base: ScoredCandidate = c ?? { platformKey: w.platformKey, platformName: w.platform, title: w.title, homeRegion: true, score: 0, priority: 'Low', components: [], flags: ['On your wishlist by hand'], franchise: '', tie: [] };
          return { ...base, rank: 0, masterScore: base.score, consolePenalty: 0, franchisePenalty: 0 };
        })
        .sort((a, b) => b.masterScore - a.masterScore || a.title.localeCompare(b.title))
        .map((m, i) => ({ ...m, rank: i + 1 }));
      for (const m of master) index.set(`${m.platformKey}|${normalizeTitle(m.title)}`, { score: m.score, priority: m.priority, rank: m.rank });
    }
    const result: WishlistResult = {
      generatedAt: new Date().toISOString(),
      master,
      index,
      byPlatform,
      all,
      offList,
      platforms: platformRows.sort((a, b) => a.name.localeCompare(b.name)),
      counts: { candidates: candidates.length, scored: scored.length, hidden: hiddenCount },
      source,
      suggestions,
    };
    busyMs += Date.now() - since;
    // Kept only while it's still the newest (a change while it was worked out in the background makes it old).
    if (this.cacheKey() === key) this.cache = { key, result };
    // A slow one is said in the log (2026-11-07: freezes the log couldn't explain), with how long it held the server.
    const ms = Date.now() - t0;
    if (busyMs >= 300) this.log.info({ context: 'wishlist', ms, busyMs }, `The wishlist was worked out again in ${busyMs} ms${ms > busyMs + 50 ? ` (in steps over ${ms} ms)` : ''}`);
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

  /** The facts the owner (or a spreadsheet they brought in) gave a game for its acorns (T-278). */
  ownDetails(platformKey: string, title: string): GameDetails | null {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return null;
    const row = this.db.select().from(gameDetails).where(and(eq(gameDetails.platformId, platform.id), eq(gameDetails.titleKey, normalizeTitle(title)))).get();
    return row ? (JSON.parse(row.details) as GameDetails) : {};
  }

  /**
   * Sets a game's facts for its acorns (1.5.0, T-278: your interest, its significance, market urgency, tie-in, offbeat,
   * release class, games left in its series): the fields given replace those kept, null removes one, others stay.
   */
  setOwnDetails(platformKey: string, title: string, change: Record<string, unknown>): GameDetails | null {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return null;
    const titleKey = normalizeTitle(title);
    const row = this.db.select().from(gameDetails).where(and(eq(gameDetails.platformId, platform.id), eq(gameDetails.titleKey, titleKey))).get();
    const kept = row ? (JSON.parse(row.details) as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries(change)) {
      if (!OWN_DETAIL_FIELDS.has(k)) continue;
      if (v === null || v === '') delete kept[k];
      else if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) kept[k] = typeof v === 'string' ? v.slice(0, 500) : v;
    }
    const now = new Date().toISOString();
    if (row) this.db.update(gameDetails).set({ details: JSON.stringify(kept), source: 'user', updatedAt: now }).where(eq(gameDetails.id, row.id)).run();
    else this.db.insert(gameDetails).values({ platformId: platform.id, title, titleKey, details: JSON.stringify(kept), source: 'user', updatedAt: now }).run();
    this.invalidate();
    return kept as GameDetails;
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
      // What the wishlist is (D217): with one the owner picks, master is My wishlist and suggestions the ranked list.
      source: r.source,
      suggestions:
        r.suggestions?.map((m) => ({ ...json(m, wishlist.coverOf(m.platformKey, m.title), wishlist.reviewsOf(m.platformKey, m.title)), rank: m.rank, masterScore: m.masterScore, consolePenalty: m.consolePenalty, franchisePenalty: m.franchisePenalty })) ?? null,
    };
  });

  // A game's facts for its acorns (T-278), the owner's own.
  app.get('/api/v1/wishlist/details', async (request, reply) => {
    const q = request.query as { platform?: string; title?: string };
    if (!q.platform || !q.title) return reply.code(400).send({ error: 'invalid', message: 'Say which game (its console and title).' });
    const details = wishlist.ownDetails(q.platform, q.title);
    return details ? { details } : reply.code(404).send({ error: 'not-found', message: 'No such console.' });
  });
  app.put('/api/v1/wishlist/details', async (request, reply) => {
    const b = (request.body ?? {}) as { platformKey?: unknown; title?: unknown; details?: unknown };
    if (typeof b.platformKey !== 'string' || typeof b.title !== 'string' || !b.details || typeof b.details !== 'object') return reply.code(400).send({ error: 'invalid', message: 'Say which game and what to set.' });
    const details = wishlist.setOwnDetails(b.platformKey, b.title, b.details as Record<string, unknown>);
    return details ? { details } : reply.code(404).send({ error: 'not-found', message: 'No such console.' });
  });

  // My wishlist (D217): the games the owner picked themselves (used as the wishlist when Settings say so).
  app.get('/api/v1/wishlist/mine', async () => ({ games: wishlist.mine() }));
  app.post('/api/v1/wishlist/mine', async (request, reply) => {
    const b = (request.body ?? {}) as { platformKey?: unknown; title?: unknown; source?: unknown };
    if (typeof b.platformKey !== 'string' || typeof b.title !== 'string' || !b.title.trim()) return reply.code(400).send({ error: 'invalid', message: 'Say which game (its console and title).' });
    if (!wishlist.addMine(b.platformKey, b.title, typeof b.source === 'string' ? b.source : undefined)) return reply.code(404).send({ error: 'not-found', message: 'No such console.' });
    return reply.code(201).send({ added: true });
  });
  app.delete('/api/v1/wishlist/mine', async (request, reply) => {
    const q = request.query as { platform?: string; title?: string };
    if (!q.platform || !q.title) return reply.code(400).send({ error: 'invalid', message: 'Say which game (its console and title).' });
    return { removed: wishlist.removeMine(q.platform, q.title) };
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
