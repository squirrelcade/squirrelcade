import { baseTitle, matchKey, yearBestSellers, type SalesRegion, type YearSeller } from '@squirrelcade/core';
import { eq, like, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { bestSellingLists, platforms } from './db/schema.js';
import type { IgdbService } from './igdb.js';
import type { SettingsService } from './settings.js';
import type { WikipediaClient } from './wikipedia.js';

/** One game of a year's Top 20: its title, IGDB's box art, the consoles it came out on, and its rating or sales place. */
export interface Top20Game {
  rank: number;
  title: string;
  coverId: string | null;
  consoles: string[];
  rating: number | null;
  ratings: number | null;
}

/** A year's Top 20 (T-218, D206), with what it says when it has fewer (\"7 games rated enough in 1978\"). */
export interface Top20Year {
  year: number;
  games: Top20Game[];
  note: string | null;
  /** Best selling: whose chart it is (the region asked for, or the one the year has). */
  region: SalesRegion | null;
}

/** First year Top 20 goes back to: the first home consoles. */
const FIRST_YEAR = 1972;
/** The current year's best sellers are read again after this long. */
const CURRENT_YEAR_DAYS = 7;

/** A rated game as the highest-rated lists take it, from every console's IGDB list. */
interface Rated {
  id: number;
  title: string;
  year: number;
  rating: number;
  count: number;
  coverId: string | null;
  consoles: Set<string>;
}

/**
 * Roots > Top 20 (T-218, D206): each year's 20 highest-rated games (IGDB's ratings Squirrelcade already stores, games
 * with at least Settings > Roots > Top 20: ratings it needs) and best-selling ones (Wikipedia's \"YYYY in video games\",
 * read once in the background, the current year weekly). Everything is worked out once and kept, so the page only reads.
 */
export class Top20Service {
  private rated: { stamp: number; built: Promise<Rated[]> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly igdb: IgdbService,
    private readonly wikipedia: WikipediaClient,
    private readonly log: Logger,
    /** The consoles games came out on (IGDB's lists and the catalogs), by title key. */
    private readonly releasedOn: (keys: string[]) => Promise<Record<string, string[]>>,
  ) {}

  enabled(): boolean {
    return this.settings.get('features.history');
  }

  /** Settings > Roots > Top 20: whose sales chart, and how many ratings a game needs. */
  region(): SalesRegion {
    return this.settings.get('roots.top20SalesRegion');
  }

  minRatings(): number {
    return this.settings.get('roots.top20MinRatings');
  }

  /** Every rated game, a slice of IGDB's lists at a time (the server keeps answering), kept until the next download. */
  private ratedGames(): Promise<Rated[]> {
    const stamp = this.igdb.stamp();
    if (this.rated?.stamp !== stamp) this.rated = { stamp, built: this.buildRated() };
    return this.rated.built;
  }

  private async buildRated(): Promise<Rated[]> {
    const keyOf = new Map(this.db.select({ id: platforms.id, key: platforms.key }).from(platforms).all().map((p) => [p.id, p.key]));
    const games = new Map<number, Rated>();
    let after = 0;
    for (;;) {
      const rows = this.db.all<{ rowid: number; platform_id: number; igdb_id: number; name: string; released: string | null; rating: number | null; count: number | null; cover: string | null }>(
        sql`SELECT rowid, platform_id, igdb_id, json_extract(data, '$.name') AS name, json_extract(data, '$.released') AS released, json_extract(data, '$.rating') AS rating, json_extract(data, '$.ratingCount') AS count, json_extract(data, '$.coverId') AS cover FROM igdb_games WHERE rowid > ${after} ORDER BY rowid LIMIT 5000`,
      );
      if (rows.length === 0) break;
      for (const r of rows) {
        const key = keyOf.get(r.platform_id);
        const year = r.released ? Number(r.released.slice(0, 4)) : NaN;
        if (r.rating == null || !r.count || !Number.isFinite(year) || !key) continue;
        const g = games.get(r.igdb_id);
        if (g) {
          g.year = Math.min(g.year, year);
          g.consoles.add(key);
          g.coverId ??= r.cover;
        } else games.set(r.igdb_id, { id: r.igdb_id, title: r.name, year, rating: r.rating, count: r.count, coverId: r.cover, consoles: new Set([key]) });
      }
      after = rows[rows.length - 1]!.rowid;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    return [...games.values()];
  }

  /** Each year's 20 highest rated, newest year first; with `collected`, only games out on a console you collect. */
  async highestRated(collected: Set<string> | null): Promise<Top20Year[]> {
    const min = this.settings.get('roots.top20MinRatings');
    const byYear = new Map<number, Rated[]>();
    for (const g of await this.ratedGames()) {
      if (g.count < min || (collected && ![...g.consoles].some((k) => collected.has(k)))) continue;
      byYear.set(g.year, [...(byYear.get(g.year) ?? []), g]);
    }
    const now = new Date().getFullYear();
    const years: Top20Year[] = [];
    for (let year = now; year >= FIRST_YEAR; year--) {
      const top = (byYear.get(year) ?? []).sort((a, b) => b.rating - a.rating || b.count - a.count).slice(0, 20);
      years.push({
        year,
        games: top.map((g, i) => ({ rank: i + 1, title: g.title, coverId: g.coverId, consoles: [...g.consoles], rating: Math.round(g.rating), ratings: g.count })),
        note: top.length === 0 ? `No game of ${year} has ${min} ratings yet` : top.length < 20 ? `${top.length} ${top.length === 1 ? 'game' : 'games'} rated enough in ${year}` : null,
        region: null,
      });
    }
    return years;
  }

  /** Each year's best sellers in the region asked for (else the region the year has), newest first. */
  async bestSelling(region: SalesRegion, collected: Set<string> | null): Promise<Top20Year[]> {
    const stored = new Map(
      this.db
        .select()
        .from(bestSellingLists)
        .where(like(bestSellingLists.platformKey, 'year:%'))
        .all()
        .map((r) => [Number(r.platformKey.slice(5)), JSON.parse(r.data) as Partial<Record<SalesRegion, YearSeller[]>>]),
    );
    const titles = [...stored.values()].flatMap((lists) => Object.values(lists).flatMap((l) => (l ?? []).map((g) => matchKey(baseTitle(g.title)))));
    const released = await this.releasedOn([...new Set(titles)].filter(Boolean));
    const now = new Date().getFullYear();
    const years: Top20Year[] = [];
    for (let year = now; year >= FIRST_YEAR; year--) {
      const lists = stored.get(year);
      const order: SalesRegion[] = [region, 'worldwide', 'us', 'japan', 'europe'];
      const chosen = lists ? order.find((r) => (lists[r]?.length ?? 0) > 0) : undefined;
      const list = chosen ? lists![chosen]! : [];
      const games = list
        .slice(0, 20)
        .map((g, i) => {
          const consoles = released[matchKey(baseTitle(g.title))] ?? [];
          return { rank: i + 1, title: g.title, coverId: consoles.map((k) => this.igdb.coverOf(k, g.title)).find(Boolean) ?? null, consoles, rating: null, ratings: null };
        })
        .filter((g) => !collected || g.consoles.length === 0 || g.consoles.some((k) => collected.has(k)));
      years.push({
        year,
        games,
        note: !lists ? (stored.size === 0 ? 'Not read yet: Wikipedia\'s lists are read in the background' : 'No sales list for this year') : !chosen ? 'No sales list for this year' : list.length < 20 ? `Its list has ${list.length}` : null,
        region: chosen ?? null,
      });
    }
    return years;
  }

  /**
   * The task: Wikipedia's \"YYYY in video games\" read for each year not read yet, and the current year again weekly. A
   * few seconds apart, politely; the stored lists are all the page reads.
   */
  async readYears(progress: (line: string) => void = () => undefined): Promise<string> {
    if (!this.enabled()) return 'Roots is off';
    const now = new Date().getFullYear();
    let read = 0;
    let found = 0;
    for (let year = now; year >= FIRST_YEAR; year--) {
      const key = `year:${year}`;
      const row = this.db.select().from(bestSellingLists).where(eq(bestSellingLists.platformKey, key)).get();
      const old = row && (year < now - 1 || Date.now() - Date.parse(row.readAt) < CURRENT_YEAR_DAYS * 86_400_000);
      if (old) continue;
      progress(`${year} in video games`);
      const got = await this.wikipedia.article(`${year} in video games`);
      read++;
      const lists = got ? yearBestSellers(got.wikitext) : {};
      if (Object.keys(lists).length > 0) found++;
      const values = { page: got?.title ?? `${year} in video games`, data: JSON.stringify(lists), readAt: new Date().toISOString() };
      this.db.insert(bestSellingLists).values({ platformKey: key, ...values }).onConflictDoUpdate({ target: bestSellingLists.platformKey, set: values }).run();
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    return read === 0 ? 'Nothing new to read' : `${read} years read, ${found} with best-selling lists`;
  }

  /** The highest-rated index built ahead of the first visit. */
  warm(): void {
    void this.ratedGames().catch((err: unknown) => this.log.debug({ context: 'top20', err }, "Top 20's ratings couldn't be gathered"));
  }
}

export function registerTop20Routes(app: FastifyInstance, top20: Top20Service, collected: () => string[]): void {
  // ?kind=rated|selling, &all=1 for consoles you don't collect too.
  app.get('/api/v1/roots/top20', async (request, reply) => {
    if (!top20.enabled()) return reply.code(404).send({ error: 'feature-off', message: 'Roots is off (Settings > Features).' });
    const q = request.query as { kind?: string; all?: string };
    const only = q.all === '1' ? null : new Set(collected());
    const region = top20.region();
    const years = q.kind === 'selling' ? await top20.bestSelling(region, only) : await top20.highestRated(only);
    return { kind: q.kind === 'selling' ? 'selling' : 'rated', region, minRatings: top20.minRatings(), years };
  });
}
