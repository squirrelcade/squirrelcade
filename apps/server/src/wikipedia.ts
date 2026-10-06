import {
  CATALOG_SOURCES,
  consoleRegion,
  regionalConsole,
  downloadCategories,
  editionBase,
  forPlatform,
  isAddedSource,
  KNOWN_PLATFORMS,
  matchKey,
  mergeSources,
  sourceCovers,
  sourceOrder,
  parseCatalogList,
  releasedIn,
  sectionKind,
  wikiDate,
  wikiGames,
  wikipediaPages,
  type ListEntry,
  type SourceConflict,
  type SourceContribution,
  type SourceLayer,
  type TargetStatus,
  type WikiGame,
  type WikiRegion,
} from '@squirrelcade/core';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { AddedSources } from './addedSources.js';
import type { CatalogService, SourceEntry, SyncResult } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import { catalogBuilds, catalogEntries, catalogLists, copies, platforms } from './db/schema.js';
import { APP_VERSION } from './env.js';
import type { FetchLike, IgdbService } from './igdb.js';
import type { NintendoLifeSource } from './nintendolife.js';
import type { SettingsService } from './settings.js';
import type { TaskRunner } from './tasks.js';

/** Wikipedia couldn't be read, or had nothing usable, with a message to show the user. */
/** IGDB's kinds of entry that are games of their own, for a catalog: no add-ons, bundles, packs or updates. */
const IGDB_CATALOG_TYPES = new Set(['Main Game', 'Remake', 'Remaster', 'Expanded Game', 'Port', 'Standalone Expansion']);

export class WikipediaError extends Error {}

/**
 * Wikipedia's API, politely: one request at a time with a pause between them, an
 * identifying User-Agent (Wikimedia asks for one), and waiting when told to.
 */
export class WikipediaClient {
  private last = 0;

  constructor(
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly minIntervalMs = 1000,
    private readonly endpoint = 'https://en.wikipedia.org/w/api.php',
  ) {}

  private async api(params: Record<string, string>, attempt = 1): Promise<Record<string, unknown>> {
    const wait = this.last + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const url = `${this.endpoint}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', maxlag: '5' })}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { 'User-Agent': `Squirrelcade/${APP_VERSION} (+https://github.com/squirrelcade/squirrelcade; self-hosted game collection app)`, 'Api-User-Agent': `Squirrelcade/${APP_VERSION}` },
      });
    } catch (err) {
      throw new WikipediaError(`Couldn't reach Wikipedia: ${err instanceof Error ? err.message : String(err)}`);
    }
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const after = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      await new Promise((r) => setTimeout(r, (Number.isFinite(after) ? Math.min(after, 60) : 5 * attempt) * 1000));
      return this.api(params, attempt + 1);
    }
    if (!res.ok) throw new WikipediaError(`Wikipedia answered ${res.status}`);
    const body = (await res.json()) as Record<string, unknown> & { error?: { code?: string; info?: string } };
    if (body.error?.code === 'maxlag' && attempt < 4) {
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      return this.api(params, attempt + 1);
    }
    if (body.error) throw new WikipediaError(body.error.info ?? body.error.code ?? 'Wikipedia returned an error');
    return body;
  }

  /** The page itself plus its split parts ("… (A–C)", "… (D–I)"), as Wikipedia names them. */
  async listPages(base: string): Promise<string[]> {
    const body = (await this.api({ action: 'query', list: 'prefixsearch', pssearch: base, pslimit: '50' })) as { query?: { prefixsearch?: { title: string }[] } };
    const titles = (body.query?.prefixsearch ?? []).map((p) => p.title);
    const parts = titles.filter((t) => t.startsWith(`${base} (`) && t.endsWith(')'));
    return [base, ...parts.sort()];
  }

  /** A page's rendered HTML, or null when there is no such page. */
  async pageHtml(title: string): Promise<{ title: string; html: string } | null> {
    try {
      const body = (await this.api({ action: 'parse', page: title, prop: 'text', redirects: '1' })) as { parse?: { title: string; text: string } };
      return body.parse ? { title: body.parse.title, html: body.parse.text } : null;
    } catch (err) {
      if (err instanceof WikipediaError && /doesn't exist|missingtitle/i.test(err.message)) return null;
      throw err;
    }
  }

  /**
   * Which of the given categories each article is in (redirects followed), asked about 50 articles at a
   * time. Articles in none of them, or missing from Wikipedia, are left out.
   */
  async categories(articles: string[], categories: string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    const unique = [...new Set(articles)];
    const wanted = categories.map((c) => `Category:${c}`).join('|');
    for (let i = 0; i < unique.length; ) {
      // At most 50 titles per request, and a URL of reasonable length.
      const batch: string[] = [];
      let length = 0;
      while (i < unique.length && batch.length < 50 && (batch.length === 0 || length + unique[i]!.length < 2000)) {
        length += unique[i]!.length + 1;
        batch.push(unique[i++]!);
      }
      type Page = { title: string; categories?: { title: string }[] };
      type Body = { query?: { normalized?: { from: string; to: string }[]; redirects?: { from: string; to: string }[]; pages?: Page[] }; continue?: Record<string, string> };
      const alias = new Map<string, string>();
      const found = new Map<string, Set<string>>();
      let more: Record<string, string> | undefined = {};
      for (let round = 0; more && round < 20; round++) {
        const body = (await this.api({ action: 'query', prop: 'categories', titles: batch.join('|'), clcategories: wanted, cllimit: 'max', redirects: '1', ...more })) as Body;
        for (const a of [...(body.query?.normalized ?? []), ...(body.query?.redirects ?? [])]) alias.set(a.from, a.to);
        for (const p of body.query?.pages ?? []) {
          const set = found.get(p.title) ?? new Set<string>();
          for (const c of p.categories ?? []) set.add(c.title.replace(/^Category:/, ''));
          found.set(p.title, set);
        }
        more = body.continue;
      }
      for (const article of batch) {
        let title = article;
        for (let hops = 0; hops < 5 && alias.has(title); hops++) title = alias.get(title)!;
        const cats = [...(found.get(title) ?? [])];
        if (cats.length > 0) result.set(article, cats);
      }
    }
    return result;
  }
}

/** Why games a Wikipedia list names were left out of a catalog, counted by reason. */
export interface BuildSkipped {
  /** Not released in the home region (per the list's region columns). */
  region: number;
  /** Marked download-only. */
  digital: number;
  /** Marked as download titles, when Settings > Catalogs and matching leaves those out. */
  download?: number;
  /** In an unlicensed, homebrew or aftermarket section (Settings > Catalogs and matching decides). */
  unlicensed: number;
  /** In a section that isn't games to collect (unreleased, non-game software, feature lists). */
  other: number;
  /** Released before the user's own list, which covers those games (Settings > Catalogs and matching decides). */
  older?: number;
}

/** How a build's message names the sources it applied: "your list", "your list and Nintendo Life". */
function appliedNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? 'nothing') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Under a list, Wikipedia adds games released from this long before the list was given, in case the list was a little out of date. */
const LIST_OVERLAP_MS = 30 * 86_400_000;

/** What building one console's catalog did. */
export interface BuildResult {
  platformKey: string;
  pages: string[];
  games: number;
  review: number;
  skipped: BuildSkipped;
  sync: SyncResult | null;
  /** What each source gave the catalog, in the order they were trusted. */
  sources: SourceContribution[];
  /** Where sources disagreed about a game's date or format (the higher source's value stands). */
  conflicts: SourceConflict[];
  /** A source couldn't be read, so the others were applied (its games stay as they were). */
  error: string | null;
}

/** Where a console's catalog comes from and how its last build went, for the console page and the welcome guide. */
export interface CatalogSourceStatus {
  key: string;
  name: string;
  tracked: boolean;
  pages: string[];
  builtAt: string | null;
  games: number;
  skipped: BuildSkipped | null;
  error: string | null;
  queued: boolean;
  /** The user's own list for the console, when there is one. */
  list: { fileName: string; games: number; uploadedAt: string } | null;
  /** Catalog games Wikipedia marks as download titles (and the user hasn't answered about): they count once shown physical. */
  downloads: number;
  /** Mappings from the user's file: owned titles that count as catalog games. */
  mappings: number;
  /** What each source gave the last build, most trusted first. */
  sources: SourceContribution[];
  /** Where the sources disagreed in the last build. */
  conflicts: SourceConflict[];
}

const WIKI_REGION: Record<string, WikiRegion> = { 'north-america': 'north-america', europe: 'europe', japan: 'japan' };

/** What happens to games Wikipedia marks as download titles (Settings > Catalogs and matching). */
export type DownloadTitles = 'confirm' | 'skip' | 'count';

/** Why Wikipedia makes a game a download title, as the catalog's note; null when it doesn't. */
function downloadNote(game: WikiGame): string | null {
  if (game.download) return `Wikipedia's list marks it as a download title ("${game.download}")`;
  if (game.downloadCategory) return `Its Wikipedia article is in the category "${game.downloadCategory}"`;
  return null;
}

/**
 * Turns Wikipedia's game lists into catalog games: retail games released in the
 * home region become targets, games marked as download titles wait for evidence of
 * a physical release, special releases (promotional, competition) come in for
 * review, and the rest is left out unless the settings say otherwise.
 */
export function wikiCatalogEntries(
  games: WikiGame[],
  options: { region: string; includeDigitalOnly: boolean; includeUnlicensed: boolean; downloadTitles?: DownloadTitles },
): { entries: SourceEntry[]; skipped: BuildSkipped } {
  const skipped: BuildSkipped = { region: 0, digital: 0, download: 0, unlicensed: 0, other: 0 };
  const region = WIKI_REGION[options.region] ?? 'other';
  // Collecting download-only games too means download titles count as well.
  const downloads = options.includeDigitalOnly ? 'count' : (options.downloadTitles ?? 'confirm');
  const byKey = new Map<string, SourceEntry & { targetStatus: TargetStatus }>();
  for (const game of games) {
    const kind = sectionKind(game.section);
    if (kind === 'skip') {
      skipped.other++;
      continue;
    }
    if (kind === 'unlicensed' && !options.includeUnlicensed) {
      skipped.unlicensed++;
      continue;
    }
    if (game.digitalOnly && !options.includeDigitalOnly) {
      skipped.digital++;
      continue;
    }
    if (!releasedIn(game, region)) {
      skipped.region++;
      continue;
    }
    const download = downloads === 'count' || kind === 'special' ? null : downloadNote(game);
    if (download && downloads === 'skip') {
      skipped.download!++;
      continue;
    }
    const [title, ...alt] = game.titles;
    if (!title) continue;
    // A download title waits as not confirmed physical until something shows a physical release.
    const targetStatus: TargetStatus = kind === 'special' ? 'review' : download ? 'unconfirmed' : 'required';
    const key = matchKey(title);
    const existing = byKey.get(key);
    if (existing) {
      existing.altTitles = [...new Set([...(existing.altTitles ?? []), ...alt])];
      if (targetStatus === 'required') {
        if (existing.targetStatus === 'unconfirmed') existing.notes = null;
        existing.targetStatus = 'required';
      }
      continue;
    }
    byKey.set(key, {
      title,
      altTitles: alt,
      region: options.region,
      releaseDate: wikiDate(game.releases[region] ?? Object.values(game.releases)[0]),
      notes: kind === 'special' ? `Wikipedia lists it under "${game.section}"` : download,
      targetStatus,
    });
  }
  return { entries: [...byKey.values()], skipped };
}

/** Builds and refreshes catalogs from Wikipedia. */
export class CatalogBuilder {
  private readonly requested = new Set<string>();
  /** Platforms the running build hasn't finished yet. */
  private readonly pending = new Set<string>();

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly catalogs: CatalogService,
    private readonly collection: CollectionService,
    private readonly client: WikipediaClient,
    private readonly log: Logger,
    private readonly igdb?: IgdbService,
    private readonly nintendoLife?: NintendoLifeSource,
    private readonly added?: AddedSources,
  ) {}

  private pagesFor(platformKey: string): string[] {
    return forPlatform(wikipediaPages(this.settings.get('catalogs.wikipediaPages')), platformKey) ?? [];
  }

  private listOf(platformKey: string): { fileName: string; entries: ListEntry[]; games: number; uploadedAt: string } | null {
    const row = this.db
      .select({ fileName: catalogLists.fileName, entries: catalogLists.entries, games: catalogLists.games, uploadedAt: catalogLists.uploadedAt })
      .from(catalogLists)
      .innerJoin(platforms, eq(platforms.id, catalogLists.platformId))
      .where(eq(platforms.key, platformKey))
      .get();
    return row ? { ...row, entries: JSON.parse(row.entries) as ListEntry[] } : null;
  }

  /** Stores a console's own list (the top layer of its catalog); the next build applies it. */
  setList(platformKey: string, fileName: string, csv: string): { games: number; problems: string[] } | null {
    const platform = this.catalogs.platform(platformKey);
    if (!platform) return null;
    const { entries, problems } = parseCatalogList(csv);
    if (entries.length === 0) return { games: 0, problems };
    const row = { fileName: fileName.slice(0, 200), entries: JSON.stringify(entries), games: entries.length, uploadedAt: new Date().toISOString() };
    this.db.insert(catalogLists).values({ platformId: platform.id, ...row }).onConflictDoUpdate({ target: catalogLists.platformId, set: row }).run();
    this.log.info({ context: 'catalogs' }, `Your list for ${platform.name}: ${entries.length} games from ${row.fileName}`);
    return { games: entries.length, problems };
  }

  /** Removes a console's own list; the next build goes back to the automatic sources. */
  removeList(platformKey: string): boolean {
    const platform = this.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return false;
    return this.db.delete(catalogLists).where(eq(catalogLists.platformId, platform.id)).run().changes > 0;
  }

  /** The names of a console's copies (as written, and without their edition), to know an older game the user owns. */
  private ownedKeys(platformId: number): Set<string> {
    const keys = new Set<string>();
    for (const c of this.db.select({ title: copies.title }).from(copies).where(and(eq(copies.platformId, platformId), isNull(copies.goneAt))).all()) {
      for (const k of [matchKey(c.title), matchKey(editionBase(c.title))]) if (k) keys.add(k);
    }
    return keys;
  }

  /** The release date after which the other sources add games under a console's list, or null when they add every game. */
  private cutoff(list: { uploadedAt: string } | null): string | null {
    if (!list || this.settings.get('catalogs.listFill') === 'all') return null;
    return new Date(Date.parse(list.uploadedAt) - LIST_OVERLAP_MS).toISOString().slice(0, 10);
  }

  /** The sources that are on and cover a console, most trusted first (Settings > Sources > Catalog sources), with the ones the user added. */
  private sourcesFor(platformKey: string) {
    const added = this.added?.info() ?? [];
    return sourceOrder(this.settings.get('sources.catalogOrder'), added).filter((s) => s.on && sourceCovers(s.id, platformKey, added));
  }

  /** Whether any source that's on has something for a console: the user's list, a Wikipedia page, or a source that covers it. */
  private hasSource(platformKey: string): boolean {
    return this.sourcesFor(platformKey).some((s) => (s.id === 'list' ? this.listOf(platformKey) !== null : s.id === 'wikipedia' ? this.pagesFor(platformKey).length > 0 : true));
  }

  /** How a build's messages name a source: "your list", a built-in source's name, or the name of one the user added. */
  private sourceName(id: string): string {
    if (id === 'list') return 'your list';
    return CATALOG_SOURCES.find((c) => c.id === id)?.name ?? this.added?.info().find((a) => a.id === id)?.name ?? id;
  }

  /** Asks for the given consoles' catalogs to be built again, those tracked or with a catalog (a source's list may have others). */
  requestBuilt(platformKeys: string[]): string[] {
    const built = new Set(this.db.select({ key: platforms.key }).from(catalogBuilds).innerJoin(platforms, eq(platforms.id, catalogBuilds.platformId)).all().map((b) => b.key));
    const tracked = new Set(this.trackedKeys());
    const keys = [...new Set(platformKeys)].filter((k) => built.has(k) || tracked.has(k));
    this.request(keys);
    return keys;
  }

  /**
   * Builds one platform's catalog from its sources in the user's order (see mergeSources): the user's
   * own list, Nintendo Life (Switch 2), Wikipedia. A source that can't be read this time keeps the games
   * it brought before; a source that's off brings none. Throws when there is nothing to build from; the
   * catalog is then left as it was.
   */
  async build(platformKey: string): Promise<BuildResult> {
    const platform = this.catalogs.platform(platformKey);
    if (!platform) throw new WikipediaError(`Unknown console ${platformKey}.`);
    const order = this.sourcesFor(platformKey);
    const list = order.some((s) => s.id === 'list') ? this.listOf(platformKey) : null;
    const cutoff = this.cutoff(list);
    // Under the user's list, the other sources add only what came out after it (unless Settings > Catalogs and matching says every game).
    const adds = cutoff === null ? ('all' as const) : ('after' as const);
    // ...and an older game they list when the user owns a copy of it, so the copy counts (Settings > Catalogs and matching, 0.46.0).
    const owned = cutoff !== null && this.settings.get('catalogs.ownedUnderList') ? this.ownedKeys(platform.id) : null;
    const keepOlder = owned ? (g: { title: string; altTitles?: string[] }) => [g.title, ...(g.altTitles ?? [])].some((n) => owned.has(matchKey(n)) || owned.has(matchKey(editionBase(n)))) : undefined;
    const region = consoleRegion(platformKey, this.settings.get('general.homeRegion'));
    const layers: SourceLayer[] = [];
    const failed: string[] = [];
    const errors: string[] = [];
    /** The first source that couldn't be read: its own error is the build's when nothing else could be read. */
    let firstError: Error | null = null;
    let wiki: { pages: string[]; entries: SourceEntry[]; skipped: BuildSkipped } | null = null;
    for (const s of order) {
      if (s.id === 'list') {
        // Your list is evidence of a physical release, except for a row it marks as not confirmed (that one waits for IGDB
        // or a copy of yours, as any unconfirmed game does).
        if (list) layers.push({ id: 'list', adds: 'all', games: list.entries.map((l) => (l.targetStatus === 'unconfirmed' ? l : { ...l, evidence: 'list' })) });
      } else if (s.id === 'wikipedia') {
        const bases = this.pagesFor(platformKey);
        if (bases.length === 0) continue;
        try {
          wiki = await this.fromWikipedia(platformKey, bases);
          layers.push({ id: 'wikipedia', adds, after: cutoff, keepOlder, games: wiki.entries });
        } catch (err) {
          failed.push('wikipedia');
          firstError ??= err instanceof Error ? err : new WikipediaError(String(err));
          errors.push(`Wikipedia couldn't be read (${err instanceof Error ? err.message : String(err)})`);
        }
      } else if (s.id === 'igdb-regions' && this.igdb) {
        // Other regions' physical releases (IGDB), on a console that isn't region-locked: at the bottom, each counting
        // once owned. A region-locked console, and a regional one (the Super Famicom), leave them out.
        const locked = this.settings.get('platforms.regionLocked').includes(platformKey) || regionalConsole(platformKey) !== null;
        if (!locked) {
          const games = this.igdb
            .games(platform.id)
            .filter((g) => (g.physical?.length ?? 0) > 0 && (!g.gameType || IGDB_CATALOG_TYPES.has(g.gameType)))
            .map((g): SourceEntry => ({ title: g.name, altTitles: g.altNames, releaseDate: g.released, targetStatus: 'extra', evidence: 'igdb' }));
          // Only new games: a game another source has keeps its own names, facts and evidence.
          if (games.length > 0) layers.push({ id: 'igdb-regions', adds: 'all', fills: false, games });
        }
      } else if (isAddedSource(s.id) && this.added) {
        // A list the user added is, as their own lists are, evidence of a physical release (but for a row marked not
        // confirmed). One whose games count once owned only adds games, as other regions' releases do.
        const own = this.added.forBuild(s.id, platformKey);
        if (!own) continue;
        const games = own.games.map((g): SourceEntry => {
          const e: SourceEntry = g.targetStatus === 'unconfirmed' ? { ...g } : { ...g, evidence: 'list' };
          return own.counts === 'owned' && g.targetStatus !== 'excluded' ? { ...e, targetStatus: 'extra' } : e;
        });
        layers.push(own.counts === 'owned' ? { id: s.id, adds: 'all', fills: false, games } : { id: s.id, adds, after: cutoff, keepOlder, games });
      } else if (s.id === 'nintendo-life' && this.nintendoLife) {
        const games = this.nintendoLife.games(region);
        if (games) layers.push({ id: 'nintendo-life', adds, after: cutoff, keepOlder, games });
        else {
          failed.push('nintendo-life');
          const why = this.nintendoLife.snapshot().error;
          errors.push(`Nintendo Life hasn't been read yet${why ? ` (${why})` : ''}`);
          firstError ??= new WikipediaError(`${errors.at(-1)}.`);
        }
      }
    }
    if (layers.length === 0) {
      if (errors.length === 1 && firstError) throw firstError;
      if (errors.length > 0) throw new WikipediaError(`${errors.join('; ')}.`);
      throw new WikipediaError(`Nothing to build ${platform.name}'s catalog from: name its Wikipedia list in Settings > Catalogs and matching, give the console your own list, or turn a source on in Settings > Sources.`);
    }
    const prefer = { releaseDate: this.settings.get('sources.datesFrom') || undefined, format: this.settings.get('sources.formatsFrom') || undefined };
    const { games, conflicts, contributions } = mergeSources(layers, (title) => this.igdb?.find(platform.id, title)?.id, prefer);
    const entries: SourceEntry[] = games;
    // Sources that couldn't be read keep what they brought before; every other source's games follow this build,
    // a removed source's too (they go).
    const left = this.db.selectDistinct({ source: catalogEntries.source }).from(catalogEntries).where(eq(catalogEntries.platformId, platform.id)).all();
    const scope = [...new Set([...CATALOG_SOURCES.map((c) => c.id), ...(this.added?.info().map((a) => a.id) ?? []), ...left.map((r) => r.source).filter(isAddedSource)])].filter((id) => !failed.includes(id));
    const sync = this.catalogs.syncSource(platformKey, scope, entries);
    if (conflicts.length > 0) this.log.info({ context: 'catalogs' }, `${platform.name}: the sources disagree about ${conflicts.length} game(s); the higher source's value stands`);
    return {
      platformKey,
      pages: wiki?.pages ?? [],
      games: entries.length,
      review: entries.filter((e) => e.targetStatus === 'review').length,
      skipped: { ...(wiki?.skipped ?? { region: 0, digital: 0, unlicensed: 0, other: 0 }), older: contributions.reduce((n, c) => n + c.older, 0) },
      sync,
      sources: contributions,
      conflicts,
      error: errors.length > 0 ? `${errors.join('; ')}; ${appliedNames(layers.map((l) => this.sourceName(l.id)))} ${layers.length === 1 ? 'was' : 'were'} applied.` : null,
    };
  }

  /** The games Wikipedia's list pages give for a console. */
  private async fromWikipedia(platformKey: string, bases: string[]): Promise<{ pages: string[]; entries: SourceEntry[]; skipped: BuildSkipped }> {
    const pages: string[] = [];
    const games: WikiGame[] = [];
    for (const base of bases) {
      for (const title of await this.client.listPages(base)) {
        // A list's main page often redirects to its first part, which the search also finds.
        if (pages.includes(title)) continue;
        const page = await this.client.pageHtml(title);
        if (!page || pages.includes(page.title)) continue;
        pages.push(page.title);
        games.push(...wikiGames(page.html));
      }
    }
    if (pages.length === 0) throw new WikipediaError(`Wikipedia has no page named ${bases.map((b) => `"${b}"`).join(' or ')}.`);
    const options = {
      // Another region's own console (the Super Famicom) takes the games released in its region.
      region: consoleRegion(platformKey, this.settings.get('general.homeRegion')),
      includeDigitalOnly: this.settings.get('catalogs.includeDigitalOnly'),
      includeUnlicensed: this.settings.get('catalogs.includeUnlicensed'),
      downloadTitles: this.settings.get('catalogs.downloadTitles'),
    };
    if (!options.includeDigitalOnly && options.downloadTitles !== 'count') await this.markDownloadCategories(platformKey, games, WIKI_REGION[options.region] ?? 'other');
    const { entries, skipped } = wikiCatalogEntries(games, options);
    if (entries.length === 0) throw new WikipediaError(`The pages ${pages.map((p) => `"${p}"`).join(', ')} list no games Squirrelcade could read.`);
    return { pages, entries, skipped };
  }

  /**
   * For lists that don't mark all their download games (Settings > Catalogs and matching names the console and the
   * categories): the retail games whose linked article is in a download category become download titles.
   */
  private async markDownloadCategories(platformKey: string, games: WikiGame[], region: WikiRegion): Promise<void> {
    const categories = forPlatform(downloadCategories(this.settings.get('catalogs.downloadCategories')), platformKey) ?? [];
    if (categories.length === 0) return;
    // Only games that would otherwise count: retail, released in the home region, not already marked.
    const candidates = games.filter((g) => g.article && !g.digitalOnly && !g.download && sectionKind(g.section) === 'retail' && releasedIn(g, region));
    if (candidates.length === 0) return;
    const found = await this.client.categories(
      candidates.map((g) => g.article!),
      categories,
    );
    for (const g of candidates) {
      const hit = found.get(g.article!);
      if (hit) g.downloadCategory = categories.find((c) => hit.includes(c)) ?? hit[0];
    }
  }

  private record(
    platformKey: string,
    values: { pages: string[]; games: number; skipped: BuildSkipped | null; error: string | null; sources?: SourceContribution[]; conflicts?: SourceConflict[] },
  ): void {
    const platform = this.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!platform) return;
    const row = {
      source: (values.sources ?? []).map((s) => s.id).join(',') || 'none',
      builtAt: new Date().toISOString(),
      pages: JSON.stringify(values.pages),
      games: values.games,
      skipped: JSON.stringify(values.skipped ?? {}),
      error: values.error,
      sources: JSON.stringify(values.sources ?? []),
      // At most 200 differences are kept, enough to see what's going on.
      conflicts: JSON.stringify((values.conflicts ?? []).slice(0, 200)),
    };
    if (values.error) {
      // A failed refresh keeps the last good build's numbers; it only notes the error.
      const updated = this.db.update(catalogBuilds).set({ error: values.error, builtAt: row.builtAt }).where(eq(catalogBuilds.platformId, platform.id)).run().changes;
      if (updated > 0) return;
    }
    this.db.insert(catalogBuilds).values({ platformId: platform.id, ...row }).onConflictDoUpdate({ target: catalogBuilds.platformId, set: row }).run();
  }

  /** Each catalog source's state, for the Sources page: how many lists, Nintendo Life's last reading, Wikipedia's builds. */
  sourceStatus(): Record<string, { summary: string; error: string | null; at: string | null }> {
    const lists = this.db.select({ n: sql<number>`count(*)` }).from(catalogLists).get()?.n ?? 0;
    const wiki = this.db
      .select({ pages: catalogBuilds.pages, builtAt: catalogBuilds.builtAt })
      .from(catalogBuilds)
      .all()
      .filter((b) => (JSON.parse(b.pages) as string[]).length > 0);
    const snap = this.nintendoLife?.snapshot();
    const western = snap?.games.filter((g) => !g.japan) ?? [];
    const keyCards = western.filter((g) => g.format === 'Game-Key Card').length;
    const added: Record<string, { summary: string; error: string | null; at: string | null }> = {};
    for (const a of this.added?.list() ?? []) {
      const names = a.consoles.map((c) => `${KNOWN_PLATFORMS.find((p) => p.key === c.key)?.name ?? c.key} ${c.games.toLocaleString('en-US')}`);
      const where = names.length <= 3 ? names.join(', ') : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more consoles`;
      added[a.id] = { summary: `${a.games.toLocaleString('en-US')} game${a.games === 1 ? '' : 's'}: ${where}.`, error: a.error, at: a.readAt };
    }
    return {
      ...added,
      list: { summary: lists === 0 ? 'No lists given yet (a console page takes one).' : `Lists for ${lists} console${lists === 1 ? '' : 's'}.`, error: null, at: null },
      'nintendo-life': {
        summary: snap?.readAt ? `${keyCards} Game-Key Cards and ${western.length - keyCards} full-card games, plus ${(snap.games.length - western.length)} Japanese releases.` : 'Not read yet: it is read with the next catalog build once it is on.',
        error: snap?.error ?? null,
        at: snap?.readAt ?? null,
      },
      wikipedia: {
        summary: wiki.length === 0 ? 'No catalog built from it yet.' : `Read for ${wiki.length} console${wiki.length === 1 ? '' : 's'}.`,
        error: null,
        at: wiki.map((b) => b.builtAt).sort().at(-1) ?? null,
      },
    };
  }

  /** Asks for every tracked or built catalog to be rebuilt at the next run, after a change to what catalogs are built from. */
  requestAll(): void {
    const built = this.db.select({ key: platforms.key }).from(catalogBuilds).innerJoin(platforms, eq(platforms.id, catalogBuilds.platformId)).all();
    this.request([...new Set([...this.trackedKeys(), ...built.map((b) => b.key)])]);
  }

  /** Asks for platforms to be (re)built at the next run of the catalog task. */
  request(platformKeys: string[]): void {
    for (const k of platformKeys) this.requested.add(k);
  }

  /** Tracked consoles whose catalog was never built: a console that just got enough games (0.60.0). */
  unbuiltTracked(): string[] {
    const built = new Set(this.db.select({ key: platforms.key }).from(catalogBuilds).innerJoin(platforms, eq(platforms.id, catalogBuilds.platformId)).all().map((b) => b.key));
    return this.trackedKeys().filter((k) => !built.has(k));
  }

  /** Platforms the collection tracks (enough different games, Settings > Platforms). */
  trackedKeys(): string[] {
    return this.collection
      .platformsWithLabels()
      .filter((p) => p.eligible)
      .map((p) => p.key);
  }

  /**
   * The catalog task: builds the requested platforms, and every tracked platform
   * whose catalog is older than the refresh setting (or was never built).
   */
  async run(progress?: (text: string) => void): Promise<string> {
    const nlOn = sourceOrder(this.settings.get('sources.catalogOrder')).some((s) => s.id === 'nintendo-life' && s.on);
    if (nlOn && this.nintendoLife) {
      progress?.('Reading Nintendo Life');
      if (await this.nintendoLife.refresh()) {
        const covered = CATALOG_SOURCES.find((c) => c.id === 'nintendo-life')?.platforms ?? [];
        const built = new Set(this.db.select({ key: platforms.key }).from(catalogBuilds).innerJoin(platforms, eq(platforms.id, catalogBuilds.platformId)).all().map((b) => b.key));
        this.request(covered.filter((k) => built.has(k) || this.trackedKeys().includes(k)));
      }
    }
    // Online lists the user added are read again as often as catalogs are refreshed; a console whose games changed is rebuilt.
    if (this.added) this.requestBuilt(await this.added.refreshDue(this.settings.get('catalogs.refreshDays'), progress));
    const days = this.settings.get('catalogs.refreshDays');
    const builds = new Map(this.db.select({ key: platforms.key, builtAt: catalogBuilds.builtAt, error: catalogBuilds.error }).from(catalogBuilds).innerJoin(platforms, eq(platforms.id, catalogBuilds.platformId)).all().map((b) => [b.key, b]));
    const due = days === 0 ? [] : this.trackedKeys().filter((k) => {
      const b = builds.get(k);
      return !b || Date.now() - Date.parse(b.builtAt) > days * 86_400_000;
    });
    const keys = [...new Set([...this.requested, ...due])];
    this.requested.clear();
    if (keys.length === 0) return 'Every catalog is up to date';
    const done: string[] = [];
    const failed: string[] = [];
    for (const key of keys) this.pending.add(key);
    const names = new Map(this.db.select({ key: platforms.key, name: platforms.name }).from(platforms).all().map((p) => [p.key, p.name]));
    for (const [i, key] of keys.entries()) {
      progress?.(`${names.get(key) ?? key} (${i + 1} of ${keys.length})`);
      try {
        if (!this.hasSource(key)) continue;
        const r = await this.build(key);
        this.record(key, { pages: r.pages, games: r.games, skipped: r.skipped, error: r.error, sources: r.sources, conflicts: r.conflicts });
        done.push(`${key} ${r.games}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.record(key, { pages: [], games: 0, skipped: null, error: message });
        failed.push(key);
        this.log.warn({ context: 'catalogs' }, `Catalog for ${key} not built: ${message}`);
      } finally {
        this.pending.delete(key);
      }
    }
    if (done.length === 0 && failed.length > 0) throw new WikipediaError(`No catalog could be built (${failed.join(', ')}); the reasons are on the Platforms page.`);
    return `Catalogs built: ${done.join(', ') || 'none'}${failed.length > 0 ? `. Failed: ${failed.join(', ')}` : ''}`;
  }

  /** Each tracked platform (and each with a catalog) with its Wikipedia pages and last build. */
  status(): CatalogSourceStatus[] {
    const pages = wikipediaPages(this.settings.get('catalogs.wikipediaPages'));
    const builds = new Map(this.db.select().from(catalogBuilds).all().map((b) => [b.platformId, b]));
    const downloads = new Map(
      this.db
        .select({ platformId: catalogEntries.platformId, games: sql<number>`count(*)` })
        .from(catalogEntries)
        .where(and(eq(catalogEntries.targetStatus, 'unconfirmed'), isNull(catalogEntries.userStatus)))
        .groupBy(catalogEntries.platformId)
        .all()
        .map((r) => [r.platformId, r.games]),
    );
    const withCatalog = new Set(this.catalogs.summary().map((s) => s.key));
    const mappings = this.catalogs.mappingCounts();
    return this.collection
      .platformsWithLabels()
      .filter((p) => p.eligible || withCatalog.has(p.key))
      .map((p) => {
        const b = builds.get(p.id);
        const list = this.listOf(p.key);
        return {
          key: p.key,
          name: p.name,
          tracked: p.eligible,
          pages: forPlatform(pages, p.key) ?? [],
          builtAt: b?.builtAt ?? null,
          games: b?.games ?? 0,
          skipped: b ? (JSON.parse(b.skipped) as BuildSkipped) : null,
          error: b?.error ?? null,
          queued: this.requested.has(p.key) || this.pending.has(p.key),
          list: list ? { fileName: list.fileName, games: list.games, uploadedAt: list.uploadedAt } : null,
          downloads: downloads.get(p.id) ?? 0,
          mappings: mappings.get(p.key) ?? 0,
          sources: b ? (JSON.parse(b.sources) as SourceContribution[]) : [],
          conflicts: b ? (JSON.parse(b.conflicts) as SourceConflict[]) : [],
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

/** Catalog sources: their status, building now, and the user's own list for a console. */
export function registerCatalogSourceRoutes(app: FastifyInstance, builder: CatalogBuilder, tasks: TaskRunner): void {
  app.get('/api/v1/catalogs/sources', async () => builder.status());

  /** The catalog sources' state (Settings > Sources): lists given, Nintendo Life's last reading, Wikipedia's builds. */
  app.get('/api/v1/catalogs/source-status', async () => builder.sourceStatus());

  /** Builds catalogs in the background: the given platforms, or every tracked one. */
  app.post('/api/v1/catalogs/build', async (request, reply) => {
    const body = (request.body ?? {}) as { platforms?: unknown };
    const keys = Array.isArray(body.platforms) ? body.platforms.filter((k): k is string => typeof k === 'string' && k.length < 100) : builder.trackedKeys();
    if (keys.length === 0) return reply.code(400).send({ error: 'no-platforms', message: 'No console to build: import your collection first.' });
    builder.request(keys);
    tasks.enqueue('catalog-build');
    return reply.code(202).send({ queued: keys });
  });

  /** A console's own list (CSV): it goes on top of the console's catalog at the next build, started now. */
  app.put('/api/v1/catalogs/:platform/list', async (request, reply) => {
    const key = (request.params as { platform: string }).platform;
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no-file', message: 'Choose the CSV file of the list.' });
    const result = builder.setList(key, file.filename || 'list.csv', (await file.toBuffer()).toString('utf8'));
    if (!result) return reply.code(404).send({ error: 'not-found', message: 'No such console.' });
    if (result.games === 0) return reply.code(400).send({ error: 'invalid-list', message: result.problems.join(' ') });
    builder.request([key]);
    tasks.enqueue('catalog-build');
    return reply.code(202).send(result);
  });

  app.delete('/api/v1/catalogs/:platform/list', async (request, reply) => {
    const key = (request.params as { platform: string }).platform;
    if (!builder.removeList(key)) return reply.code(404).send({ error: 'not-found', message: 'This console has no list of yours.' });
    builder.request([key]);
    tasks.enqueue('catalog-build');
    return { removed: true };
  });
}
