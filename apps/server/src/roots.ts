import {
  BEST_SELLING_LISTS,
  bestSellingList,
  eraOf,
  matchKey,
  metacriticFor,
  readArticle,
  reviewPlatformFits,
  ROOTS_READER_VERSION,
  type ReviewScore,
  type RootsReading,
  type WikiCitation,
  type WikiMention,
  type WikiRelease,
} from '@squirrelcade/core';
import { eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { CatalogService } from './catalogs.js';
import type { Db } from './db/index.js';
import { appState, bestSellingLists, catalogEntries, copies, gameArticleLinks, gameArticles, platforms } from './db/schema.js';
import { catalogTarget } from './games.js';
import type { SettingsService } from './settings.js';
import type { TitleIndex } from './titleIndex.js';
import { keysOf } from './titleIndex.js';
import type { WikidataClient } from './wikidata.js';
import type { WikipediaClient } from './wikipedia.js';
import type { WishlistService } from './wishlist.js';

/** Awards (Wikidata's P166). */
const AWARD = 'P166';
/** A site's link format on Wikidata (P1630): its address with "$1" for the identifier. */
const FORMATTER = 'P1630';
/** An article read longer ago than this is checked for a newer revision; a game under six months old, sooner. */
const RECHECK_DAYS = 30;
const RECHECK_NEW_DAYS = 7;
/** A best-selling list is read again after this long. */
const LIST_DAYS = 90;
/** Site formats are asked of Wikidata again after this long. */
const FORMAT_DAYS = 30;

/** What Wikidata adds to an article: the game's identifiers on reference sites, and its awards. */
interface StoredWikidata {
  ids: Record<string, string>;
  awards: { name: string; year: string | null }[];
}

/** A review of the game, as its Roots lists it. */
export interface RootsReview {
  outlet: string;
  /** Its score for this console when the table gives one per platform, else every score it gives. */
  score: string;
  date: string | null;
  issue: string | null;
  page: string | null;
  url: string | null;
  archiveUrl: string | null;
  /** In print (a magazine, a newspaper), or on the web. */
  print: boolean;
  /** The owner's scan of it in Leaves, opened at its page (D191). */
  scan: { issueId: number; page: number; label: string; offsetKnown: boolean } | null;
}

/** A source cited in the article, as its Roots lists it. */
export interface RootsSource {
  kind: 'magazine' | 'web' | 'news' | 'video' | 'book' | 'other';
  title: string | null;
  work: string | null;
  date: string | null;
  issue: string | null;
  page: string | null;
  url: string | null;
  archiveUrl: string | null;
  language: string | null;
}

/** A game the article names, found in the consoles' catalogs. */
export interface RootsMention {
  title: string;
  context: string;
  platformKey: string;
  platform: string;
  /** The catalog's title for it, to open its page. */
  catalogTitle: string;
  owned: boolean;
  /** On a catalog as a game you don't have yet. */
  missing: boolean;
}

/** A game's Roots (GET /api/v1/game/roots). */
export interface RootsView {
  /** off: Roots or its reading is off; none: no article was found; ready: read. */
  status: 'off' | 'none' | 'ready';
  article: { title: string; url: string } | null;
  firstRelease: string | null;
  releases: WikiRelease[];
  /** How long At the time lasts (Settings > Roots). */
  months: number;
  /** Metacritic, GameRankings and OpenCritic, as the table gives them. */
  aggregates: { outlet: string; score: string }[];
  time: { reviews: RootsReview[]; magazines: RootsSource[]; web: RootsSource[]; videos: RootsSource[] };
  later: { reviews: RootsReview[]; sources: RootsSource[] };
  cameFrom: RootsMention[];
  ledTo: RootsMention[];
  sites: { name: string; url: string }[];
  awards: { name: string; year: string | null }[];
  bestSelling: { rank: number; list: string; url: string } | null;
  readAt: string | null;
}

/** A stored reading. */
interface Stored {
  article: string;
  wikidataId: string | null;
  revision: number | null;
  readerVersion: number | null;
  reading: RootsReading | null;
  wikidata: StoredWikidata | null;
  readAt: string | null;
  checkedAt: string | null;
  error: string | null;
}

const wikiUrl = (title: string) => `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
const daysAgo = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 86_400_000 : Infinity);
/** A title without a disambiguation ("Doom (2016 video game)" is Doom). */
const bare = (title: string) => title.replace(/\s*\([^)]*\)\s*$/, '');

/** What kind of source a citation is. */
function kindOf(c: WikiCitation): RootsSource['kind'] {
  // A citation of a game itself (cite video game) is no video.
  if (c.kind === 'cite video game') return 'other';
  if (/cite (video|av media|episode|serial)/.test(c.kind) || /youtube\.com|youtu\.be/.test(c.url ?? '')) return 'video';
  if (c.kind === 'cite magazine' || c.kind === 'cite journal' || c.kind === 'sfn') return 'magazine';
  if (c.kind === 'cite news') return 'news';
  if (c.kind === 'cite book') return 'book';
  if (c.kind === 'cite web' || c.kind === 'link') return 'web';
  return 'other';
}

const sourceOf = (c: WikiCitation): RootsSource => ({
  kind: kindOf(c),
  title: c.title,
  work: c.work,
  date: c.date,
  issue: c.issue,
  page: c.page,
  url: c.url,
  archiveUrl: c.archiveUrl,
  language: c.language,
});

/**
 * Roots (D165): each game's Wikipedia article, read for its own time and since. The article a game is comes from its
 * catalog (the list links it), else a search on Wikipedia once; the reading is kept, read again when the article
 * changes (a cheap revision check first) or the reader improves, and nothing here is the owner's own: it can all be
 * read again.
 */
export class RootsService {
  private formats: Map<string, string> | null = null;
  /** A citation's scan in the owner's magazines (Leaves, D191), set by the app when Leaves is there. */
  private scanOf: (c: { work: string | null; date: string | null; issue: string | null; page: string | null }) => RootsReview['scan'] = () => null;

  setScans(find: RootsService['scanOf']): void {
    this.scanOf = find;
  }

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly catalogs: CatalogService,
    private readonly wishlist: WishlistService,
    private readonly titles: TitleIndex,
    private readonly wikipedia: WikipediaClient,
    private readonly wikidata: WikidataClient,
    private readonly log: Logger,
  ) {}

  /** Roots on (Settings > Features) and its reading (Settings > Roots). */
  enabled(): boolean {
    return this.settings.get('features.history') && this.settings.get('roots.read');
  }

  private stored(article: string): Stored | null {
    const r = this.db.select().from(gameArticles).where(eq(gameArticles.article, article)).get();
    if (!r) return null;
    return {
      article: r.article,
      wikidataId: r.wikidataId,
      revision: r.revision,
      readerVersion: r.readerVersion,
      reading: r.data ? (JSON.parse(r.data) as RootsReading) : null,
      wikidata: r.wikidata ? (JSON.parse(r.wikidata) as StoredWikidata) : null,
      readAt: r.readAt,
      checkedAt: r.checkedAt,
      error: r.error,
    };
  }

  /** The article a game on a console is: its catalog's link, or one found before (null: looked, none); undefined: not looked yet. */
  articleOf(platformKey: string, title: string): string | null | undefined {
    const target = catalogTarget(this.catalogs, platformKey, title);
    if (target) {
      const entry = this.db.select({ wikiArticle: catalogEntries.wikiArticle }).from(catalogEntries).where(eq(catalogEntries.id, target.target.id)).get();
      if (entry?.wikiArticle) return entry.wikiArticle;
    }
    // Found before: for this console, or the same title on another (the same game, as a rule).
    const key = matchKey(target?.target.title ?? title);
    const links = this.db.select({ article: gameArticleLinks.article, platformKey: gameArticleLinks.platformKey }).from(gameArticleLinks).where(eq(gameArticleLinks.titleKey, key)).all();
    const mine = links.find((l) => l.platformKey === platformKey) ?? links[0];
    return mine ? mine.article : undefined;
  }

  /** Finds the article for a game the catalogs don't link, by its title on Wikipedia, and remembers it (or that there's none). */
  private async find(platformKey: string, title: string): Promise<string | null> {
    const now = new Date().toISOString();
    let found: string | null = null;
    const want = matchKey(title);
    for (const query of [`"${title}" video game`, title]) {
      const results = await this.wikipedia.search(query, 5);
      found = results.find((t) => matchKey(bare(t)) === want) ?? null;
      if (found) break;
    }
    this.db
      .insert(gameArticleLinks)
      .values({ platformKey, titleKey: want, article: found, foundBy: 'search', checkedAt: now })
      .onConflictDoUpdate({ target: [gameArticleLinks.platformKey, gameArticleLinks.titleKey], set: { article: found, foundBy: 'search', checkedAt: now } })
      .run();
    return found;
  }

  /** Each reference site's link format from Wikidata ("https://www.mobygames.com/game/$1/"), asked once a month. */
  private async siteFormats(): Promise<Map<string, string>> {
    if (this.formats) return this.formats;
    const saved = this.db.select().from(appState).where(eq(appState.key, 'roots.formats')).get();
    const parsed = saved ? (JSON.parse(saved.value) as { at: string; formats: Record<string, string> }) : null;
    const props = this.siteProperties();
    if (parsed && daysAgo(parsed.at) < FORMAT_DAYS && props.every((p) => p in parsed.formats)) return (this.formats = new Map(Object.entries(parsed.formats)));
    try {
      const entities = await this.wikidata.entities(props);
      const formats: Record<string, string> = { ...(parsed?.formats ?? {}) };
      for (const [id, e] of entities) {
        const f = e.claims.get(FORMATTER)?.[0]?.value;
        if (f) formats[id] = f;
      }
      const value = JSON.stringify({ at: new Date().toISOString(), formats });
      this.db.insert(appState).values({ key: 'roots.formats', value }).onConflictDoUpdate({ target: appState.key, set: { value } }).run();
      return (this.formats = new Map(Object.entries(formats)));
    } catch (err) {
      this.log.warn({ context: 'roots' }, `Couldn't read the reference sites' link formats from Wikidata: ${err instanceof Error ? err.message : String(err)}`);
      return new Map(Object.entries(parsed?.formats ?? {}));
    }
  }

  /** The reference sites (Settings > Roots), each with its Wikidata properties or its search address. */
  private sites(): { name: string; props: string[]; template: string | null }[] {
    const out: { name: string; props: string[]; template: string | null }[] = [];
    for (const line of this.settings.get('roots.referenceSites')) {
      const [name, rest] = line.split('|').map((x) => x.trim());
      if (!name || !rest) continue;
      if (/^https?:\/\//.test(rest)) out.push({ name, props: [], template: rest });
      else out.push({ name, props: rest.split(/[,\s]+/).filter((p) => /^P\d+$/.test(p)), template: null });
    }
    return out;
  }

  private siteProperties(): string[] {
    return [...new Set(this.sites().flatMap((s) => s.props))];
  }

  /**
   * Reads an article (again): its wikitext from Wikipedia, its Wikidata identifiers and awards, and keeps the reading.
   * Returns null when there's no such article or it isn't a game's.
   */
  async read(article: string, gameTitles: readonly string[] = []): Promise<Stored | null> {
    const now = new Date().toISOString();
    try {
      const page = await this.wikipedia.article(article);
      if (!page || !/\{\{\s*infobox video game/i.test(page.wikitext)) {
        this.save({ article, wikidataId: null, revision: page?.revision ?? null, readerVersion: ROOTS_READER_VERSION, reading: null, wikidata: null, readAt: now, checkedAt: now, error: page ? 'Not a game article' : 'No such article' });
        return null;
      }
      const reading = readArticle(page.wikitext, [...gameTitles, page.title, bare(page.title)]);
      let wikidata: StoredWikidata | null = null;
      if (page.wikidataId) wikidata = await this.readWikidata(page.wikidataId);
      const stored: Stored = { article, wikidataId: page.wikidataId, revision: page.revision, readerVersion: ROOTS_READER_VERSION, reading, wikidata, readAt: now, checkedAt: now, error: null };
      this.save(stored);
      return stored;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.warn({ context: 'roots' }, `Couldn't read "${article}": ${message}`);
      const old = this.stored(article);
      // Outside sources fail soft: the last good reading stays.
      this.save({ ...(old ?? { article, wikidataId: null, revision: null, readerVersion: null, reading: null, wikidata: null, readAt: null }), checkedAt: now, error: message });
      return old?.reading ? old : null;
    }
  }

  private async readWikidata(id: string): Promise<StoredWikidata> {
    const entities = await this.wikidata.entities([id]);
    const e = entities.get(id);
    const ids: Record<string, string> = {};
    for (const p of this.siteProperties()) {
      const v = e?.claims.get(p)?.[0]?.value;
      if (v) ids[p] = v;
    }
    const raw = e?.claims.get(AWARD) ?? [];
    const labels = raw.length > 0 ? await this.wikidata.entities(raw.map((a) => a.value)) : new Map();
    const awards = raw.map((a) => ({ name: labels.get(a.value)?.label ?? a.value, year: a.year })).filter((a) => !/^Q\d+$/.test(a.name));
    return { ids, awards };
  }

  private save(s: Stored): void {
    const values = {
      wikidataId: s.wikidataId,
      revision: s.revision,
      readerVersion: s.readerVersion,
      data: s.reading ? JSON.stringify(s.reading) : null,
      wikidata: s.wikidata ? JSON.stringify(s.wikidata) : null,
      readAt: s.readAt,
      checkedAt: s.checkedAt,
      error: s.error,
    };
    this.db.insert(gameArticles).values({ article: s.article, ...values }).onConflictDoUpdate({ target: gameArticles.article, set: values }).run();
  }

  /**
   * A game's article, read: found and read now when it hasn't been (a game you open), the stored reading otherwise.
   * Null when there's none.
   */
  async ensure(platformKey: string, title: string): Promise<Stored | null> {
    let article = this.articleOf(platformKey, title);
    if (article === undefined) article = this.settings.get('roots.findArticles') ? await this.find(platformKey, title) : null;
    if (!article) return null;
    const s = this.stored(article);
    if (s && s.readerVersion === ROOTS_READER_VERSION && (s.reading || s.error)) return s.reading ? s : null;
    return this.read(article, [title]);
  }

  /**
   * Every printed review in the stored readings, with the game it's of (D191): the games the catalogs link to an
   * article, and the ones found before. What seeds In the magazines from Wikipedia's citations.
   */
  printedReviews(): { platformKey: string; title: string; outlet: string; score: string; work: string | null; date: string | null; issue: string | null; page: string | null }[] {
    const games = this.db.all<{ key: string; title: string; article: string }>(sql`
      SELECT p.key AS key, e.title AS title, e.wiki_article AS article FROM catalog_entries e JOIN platforms p ON p.id = e.platform_id
        WHERE e.wiki_article IS NOT NULL AND EXISTS (SELECT 1 FROM game_articles a WHERE a.article = e.wiki_article AND a.data IS NOT NULL)
      UNION
      SELECT l.platform_key AS key, l.article AS title, l.article AS article FROM game_article_links l
        WHERE l.article IS NOT NULL AND EXISTS (SELECT 1 FROM game_articles a WHERE a.article = l.article AND a.data IS NOT NULL)`);
    const readings = new Map<string, RootsReading | null>();
    const out: ReturnType<RootsService['printedReviews']> = [];
    const seen = new Set<string>();
    for (const g of games) {
      if (!readings.has(g.article)) {
        const row = this.db.select({ data: gameArticles.data }).from(gameArticles).where(eq(gameArticles.article, g.article)).get();
        readings.set(g.article, row?.data ? (JSON.parse(row.data) as RootsReading) : null);
      }
      const r = readings.get(g.article);
      for (const row of r?.reviews ?? []) {
        const c = row.citation;
        if (!c || row.aggregate || (kindOf(c) !== 'magazine' && kindOf(c) !== 'news')) continue;
        const k = `${g.key}|${matchKey(g.title)}|${row.outlet}|${c.date}|${c.page}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ platformKey: g.key, title: g.title, outlet: row.outlet, score: row.scores.map((x) => (x.platform ? `${x.platform} ${x.score}` : x.score)).join(' · '), work: c.work ?? row.outlet, date: c.date, issue: c.issue, page: c.page });
      }
    }
    return out;
  }

  /** The stored reading of a game's article, without asking Wikipedia. */
  readingOf(platformKey: string, title: string): Stored | null {
    const article = this.articleOf(platformKey, title);
    if (!article) return null;
    const s = this.stored(article);
    return s?.reading ? s : null;
  }

  /** What the header shows from a game's reading: Metacritic for the console, best-selling and awards (for its stars). */
  header(platformKey: string, platformName: string, title: string): { metacritic: number | null; bestselling: { rank: number | null; list: string; url: string | null } | null; awards: { name: string; year: string | null }[] } {
    const empty = { metacritic: null, bestselling: null, awards: [] };
    if (!this.enabled()) return empty;
    const s = this.readingOf(platformKey, title);
    if (!s?.reading) return empty;
    const sold = this.bestSellingOf(platformKey, s.article);
    return {
      metacritic: metacriticFor(s.reading.reviews, platformKey, platformName),
      bestselling: sold ? { rank: sold.rank, list: sold.list, url: sold.url } : null,
      // The headline awards make stars; the rest are listed in its Roots.
      awards: (s.wikidata?.awards ?? []).filter((a) => /game of the year|best game|hall of fame/i.test(a.name)).map(headlineAward).slice(0, 2),
    };
  }

  private bestSellingOf(platformKey: string, article: string): { rank: number; list: string; url: string } | null {
    const row = this.db.select().from(bestSellingLists).where(eq(bestSellingLists.platformKey, platformKey)).get();
    if (!row) return null;
    const games = JSON.parse(row.data) as { article: string; rank: number }[];
    const hit = games.find((g) => g.article === article || bare(g.article) === bare(article));
    return hit ? { rank: hit.rank, list: row.page, url: wikiUrl(row.page) } : null;
  }

  /** Reads a console's best-selling list when it has one and it's old or missing. */
  async readBestSelling(platformKey: string): Promise<void> {
    const page = BEST_SELLING_LISTS[platformKey];
    if (!page) return;
    const row = this.db.select().from(bestSellingLists).where(eq(bestSellingLists.platformKey, platformKey)).get();
    if (row && daysAgo(row.readAt) < LIST_DAYS) return;
    const got = await this.wikipedia.article(page);
    if (!got) return;
    const games = bestSellingList(got.wikitext);
    if (games.length === 0) return;
    const values = { page: got.title, data: JSON.stringify(games), readAt: new Date().toISOString() };
    this.db.insert(bestSellingLists).values({ platformKey, ...values }).onConflictDoUpdate({ target: bestSellingLists.platformKey, set: values }).run();
  }

  /** A game's Roots, from its stored reading (GET /api/v1/game/roots). */
  async view(platformKey: string, platformName: string, title: string): Promise<RootsView> {
    const months = this.settings.get('roots.atTimeMonths');
    const empty: RootsView = {
      status: 'off',
      article: null,
      firstRelease: null,
      releases: [],
      months,
      aggregates: [],
      time: { reviews: [], magazines: [], web: [], videos: [] },
      later: { reviews: [], sources: [] },
      cameFrom: [],
      ledTo: [],
      sites: [],
      awards: [],
      bestSelling: null,
      readAt: null,
    };
    if (!this.enabled()) return empty;
    const s = await this.ensure(platformKey, title);
    if (!s?.reading) return { ...empty, status: 'none' };
    const r = s.reading;
    const first = r.firstRelease;
    const forConsole = (scores: ReviewScore[]) => {
      const mine = scores.filter((x) => x.platform !== null && reviewPlatformFits(x.platform, platformKey, platformName));
      const shown = mine.length > 0 ? mine : scores;
      return shown.map((x) => (x.platform && mine.length === 0 && scores.length > 1 ? `${x.platform} ${x.score}` : x.score)).join(' · ');
    };
    const reviews = { time: [] as RootsReview[], later: [] as RootsReview[] };
    const used = new Set<string>();
    for (const row of r.reviews) {
      if (row.aggregate) continue;
      const c = row.citation;
      const era = row.table ?? eraOf(c?.date ?? null, first, months) ?? 'time';
      const review: RootsReview = {
        outlet: row.outlet,
        score: forConsole(row.scores),
        date: c?.date ?? null,
        issue: c?.issue ?? null,
        page: c?.page ?? null,
        url: c?.url ?? null,
        archiveUrl: c?.archiveUrl ?? null,
        print: c ? kindOf(c) === 'magazine' || kindOf(c) === 'news' : false,
        scan: c && (kindOf(c) === 'magazine' || kindOf(c) === 'news') ? this.scanOf({ work: c.work ?? row.outlet, date: c.date, issue: c.issue, page: c.page }) : null,
      };
      if (c?.url) used.add(c.url);
      reviews[era === 'later' ? 'later' : 'time'].push(review);
    }
    const byDate = <T extends { date: string | null }>(list: T[]) => list.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
    const time: RootsView['time'] = { reviews: byDate(reviews.time), magazines: [], web: [], videos: [] };
    const laterSources: RootsSource[] = [];
    // The magazines of its time include the reviews printed in them.
    for (const row of r.reviews) {
      const c = row.citation;
      if (!c || row.aggregate || kindOf(c) !== 'magazine') continue;
      const era = row.table ?? eraOf(c.date, first, months) ?? 'time';
      if (era === 'time') time.magazines.push({ ...sourceOf(c), title: c.title ?? `Review: ${row.outlet}` });
    }
    for (const c of r.sources) {
      if (c.url && used.has(c.url)) continue;
      const era = eraOf(c.date, first, months);
      if (!era) continue;
      const src = sourceOf(c);
      if (era === 'later') {
        if (src.kind !== 'other') laterSources.push(src);
        continue;
      }
      if (src.kind === 'magazine' || src.kind === 'news' || src.kind === 'book') time.magazines.push(src);
      else if (src.kind === 'video') time.videos.push(src);
      else if (src.kind === 'web') time.web.push(src);
    }
    // A magazine cited for its review and again in the article is listed once.
    const seenIssue = new Set<string>();
    time.magazines = time.magazines.filter((m) => {
      const k = [m.work, m.issue, m.page, m.date, m.title].map((x) => (x ?? '').toLowerCase()).join('|');
      if (seenIssue.has(k)) return false;
      seenIssue.add(k);
      return true;
    });
    byDate(time.magazines);
    byDate(time.web);
    const formats = await this.siteFormats();
    const sites: RootsView['sites'] = [{ name: 'Wikipedia', url: wikiUrl(s.article) }];
    for (const site of this.sites()) {
      if (site.template) {
        sites.push({ name: site.name, url: site.template.replace(/\{title\}/g, encodeURIComponent(title)) });
        continue;
      }
      const prop = site.props.find((p) => s.wikidata?.ids[p] && formats.get(p));
      if (prop) sites.push({ name: site.name, url: formats.get(prop)!.replace('$1', s.wikidata!.ids[prop]!) });
    }
    const sold = this.bestSellingOf(platformKey, s.article);
    // The game itself, by any of its names (the article calls Breath of the Wild just that).
    const target = catalogTarget(this.catalogs, platformKey, title);
    const own = [title, s.article, bare(s.article), ...(target ? [target.target.title, ...(target.target.altTitles ?? [])] : [])];
    return {
      status: 'ready',
      article: { title: s.article, url: wikiUrl(s.article) },
      firstRelease: first,
      releases: r.releases,
      months,
      // Each aggregate once, however many tables give it (the first table's, its original release's, first).
      aggregates: r.reviews
        .filter((x) => x.aggregate)
        .filter((x, i, all) => all.findIndex((y) => y.outlet === x.outlet) === i)
        .map((x) => ({ outlet: x.outlet, score: forConsole(x.scores) })),
      time,
      later: { reviews: reviews.later, sources: laterSources.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 40) },
      cameFrom: this.found(r.cameFrom, platformKey, own),
      ledTo: this.found(r.ledTo, platformKey, own),
      sites,
      awards: s.wikidata?.awards ?? [],
      bestSelling: sold,
      readAt: s.readAt,
    };
  }

  /**
   * The games an article names, found in the consoles' catalogs (magazines, people and words that aren't games are
   * left out by not being there): on this console first, then on one where you have it, then any.
   */
  private found(mentions: readonly WikiMention[], platformKey: string, own: readonly string[]): RootsMention[] {
    const all = this.db.select({ key: platforms.key, name: platforms.name }).from(platforms).all();
    const index = this.titles.catalog(all.map((p) => p.key));
    const names = new Map(all.map((p) => [p.key, p.name]));
    const ownKeys = new Set(own.flatMap((t) => keysOf(t)));
    const out: RootsMention[] = [];
    for (const m of mentions) {
      const keys = keysOf(m.title);
      if (keys.some((k) => ownKeys.has(k))) continue;
      const hits: { key: string; t: { target: { title: string }; status: string } }[] = [];
      for (const [key, map] of index) {
        for (const k of keys) {
          const t = map.get(k);
          if (t) {
            hits.push({ key, t });
            break;
          }
        }
      }
      if (hits.length === 0) continue;
      // A name that finds the game itself ("Breath of the Wild").
      if (hits.some((h) => keysOf(h.t.target.title).some((k) => ownKeys.has(k)))) continue;
      const pick = hits.find((h) => h.key === platformKey) ?? hits.find((h) => h.t.status === 'owned') ?? hits[0]!;
      out.push({
        title: m.title,
        context: m.context,
        platformKey: pick.key,
        platform: names.get(pick.key) ?? pick.key,
        catalogTitle: pick.t.target.title,
        owned: hits.some((h) => h.t.status === 'owned'),
        missing: pick.t.status === 'missing',
      });
    }
    return out.slice(0, 20);
  }

  /**
   * The nightly reading: the games you have, then the ones on your wishlist, a few hundred at a time; an article read
   * a while ago is read again only if Wikipedia has a newer revision of it (or the reader improved).
   */
  async readMany(progress: (text: string) => void, limit: number): Promise<string> {
    if (!this.enabled()) return 'Roots is off.';
    const games: { platformKey: string; title: string }[] = [];
    const seen = new Set<string>();
    const add = (platformKey: string, title: string) => {
      const k = `${platformKey}|${matchKey(title)}`;
      if (!seen.has(k)) {
        seen.add(k);
        games.push({ platformKey, title });
      }
    };
    for (const c of this.db.select({ title: copies.title, key: platforms.key }).from(copies).innerJoin(platforms, eq(platforms.id, copies.platformId)).where(isNull(copies.goneAt)).all()) {
      add(c.key, catalogTarget(this.catalogs, c.key, c.title)?.target.title ?? c.title);
    }
    for (const m of this.wishlist.compute().master) add(m.platformKey, m.title);
    let read = 0;
    let checked = 0;
    let found = 0;
    // Articles to check for a newer revision, in batches of 50.
    const stale: { article: string; revision: number | null }[] = [];
    for (const g of games) {
      if (read >= limit) break;
      let article = this.articleOf(g.platformKey, g.title);
      if (article === undefined && this.settings.get('roots.findArticles')) {
        progress(`Looking up ${g.title}`);
        article = await this.find(g.platformKey, g.title);
        found++;
        read++;
      }
      if (!article) continue;
      const s = this.stored(article);
      if (!s || s.readerVersion !== ROOTS_READER_VERSION) {
        progress(`Reading ${article}`);
        await this.read(article, [g.title]);
        read++;
        continue;
      }
      const fresh = s.reading?.firstRelease && daysAgo(`${s.reading.firstRelease.slice(0, 4)}-12-31`) < 183 ? RECHECK_NEW_DAYS : RECHECK_DAYS;
      if (daysAgo(s.checkedAt) > fresh) stale.push({ article, revision: s.revision });
    }
    for (let i = 0; i < stale.length && read < limit; i += 50) {
      const batch = stale.slice(i, i + 50);
      const revisions = await this.wikipedia.revisions(batch.map((b) => b.article));
      for (const b of batch) {
        checked++;
        const now = revisions.get(b.article);
        if (now !== undefined && now !== b.revision && read < limit) {
          progress(`Reading ${b.article} again`);
          await this.read(b.article);
          read++;
        } else this.db.update(gameArticles).set({ checkedAt: new Date().toISOString() }).where(eq(gameArticles.article, b.article)).run();
      }
    }
    // The best-selling lists of the consoles you have.
    for (const key of new Set(games.map((g) => g.platformKey))) await this.readBestSelling(key).catch(() => undefined);
    return `${read} read (${found} looked up), ${checked} checked for changes, of ${games.length} games you have or want.`;
  }
}

/** "Golden Joystick Awards − Ultimate Game of the Year" (2013) as a star: "Game of the Year 2013". */
function headlineAward(a: { name: string; year: string | null }): { name: string; year: string | null } {
  if (/hall of fame/i.test(a.name)) return { name: 'Hall of Fame', year: a.year };
  if (/game of the year/i.test(a.name)) return { name: 'Game of the Year', year: a.year };
  if (/british academy/i.test(a.name) && /best game/i.test(a.name)) return { name: 'BAFTA Best Game', year: a.year };
  return a;
}

/** Roots' routes: a game's Roots for its page. */
export function registerRootsRoutes(app: FastifyInstance, roots: RootsService, db: Db): void {
  app.get('/api/v1/game/roots', async (request, reply) => {
    const { platform: key, title } = request.query as { platform?: string; title?: string };
    if (!key || !title?.trim()) return reply.code(400).send({ error: 'invalid', message: 'Give a platform (its key) and a title.' });
    const p = key === 'pc' ? { name: 'PC' } : db.select({ name: platforms.name }).from(platforms).where(eq(platforms.key, key)).get();
    if (!p) return reply.code(404).send({ error: 'not-found', message: 'No such platform.' });
    return roots.view(key, p.name, title.trim());
  });
}
