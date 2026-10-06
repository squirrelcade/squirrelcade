import { consoleInUse, forPlatform, IGDB_GAME_FIELDS, igdbDetails, igdbGameFromApi, igdbIndex, physicalIn, withoutSharedNames, type GameDetails, type IgdbGame } from '@squirrelcade/core';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { catalogEntries, igdbGames, igdbSummaries, igdbSyncs, platforms } from './db/schema.js';
import type { SettingsService } from './settings.js';

/** Fetch, as far as the IGDB and Wikipedia clients use it; tests pass fakes. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** IGDB or Twitch refused or failed, with a message to show the user. */
export class IgdbError extends Error {}

/** A game's reviews as the pages show them beside its acorns (0.53.0): IGDB's rating, rounded, and how many ratings. */
export type Reviews = { rating: number; count: number } | null;

/** IGDB's rating of a game (critics and players together, out of 100) when it rests on at least one rating. */
export function reviewsOf(game: IgdbGame | undefined): Reviews {
  return game?.rating != null && game.ratingCount ? { rating: Math.round(game.rating), count: game.ratingCount } : null;
}

/** IGDB allows 4 requests a second. */
const MIN_INTERVAL_MS = 260;
/** IGDB returns at most 500 records per request. */
const PAGE = 500;

/**
 * Talks to IGDB with the user's Twitch application: gets and renews the access
 * token, spaces requests out, and pages through a platform's games.
 */
export class IgdbClient {
  private token: { value: string; expiresAt: number; credentials: string } | null = null;
  private last = 0;

  constructor(
    private readonly settings: SettingsService,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly minIntervalMs = MIN_INTERVAL_MS,
  ) {}

  /** IGDB is on (Settings > Features) with a client ID and secret. */
  configured(): boolean {
    return this.settings.get('features.igdb') && Boolean(this.settings.get('sources.igdbClientId').trim() && this.settings.get('sources.igdbClientSecret').trim());
  }

  private async accessToken(): Promise<string> {
    const id = this.settings.get('sources.igdbClientId').trim();
    const secret = this.settings.get('sources.igdbClientSecret').trim();
    if (!id || !secret) throw new IgdbError('Add the IGDB client ID and secret in Settings > Sources first.');
    const credentials = `${id}\n${secret}`;
    if (this.token && this.token.credentials === credentials && Date.now() < this.token.expiresAt) return this.token.value;
    const params = new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'client_credentials' });
    const res = await this.fetchImpl(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST', signal: AbortSignal.timeout(15_000) });
    if (res.status === 400 || res.status === 401 || res.status === 403) throw new IgdbError('Twitch did not accept the client ID and secret. Check both in Settings > Sources.');
    if (!res.ok) throw new IgdbError(`Twitch answered ${res.status} when asked for an access token.`);
    const body = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) throw new IgdbError('Twitch sent no access token.');
    // Tokens last about two months; renew a day early.
    const lifetime = Math.max(300, (body.expires_in ?? 86_400) - 86_400);
    this.token = { value: body.access_token, expiresAt: Date.now() + lifetime * 1000, credentials };
    return body.access_token;
  }

  /** Runs one query (Apicalypse syntax) against an IGDB endpoint. */
  async query<T>(endpoint: string, body: string, attempt = 0): Promise<T[]> {
    const wait = this.last + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const token = await this.accessToken();
    const res = await this.fetchImpl(`https://api.igdb.com/v4/${endpoint}`, {
      method: 'POST',
      headers: { 'Client-ID': this.settings.get('sources.igdbClientId').trim(), Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body,
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401 && attempt === 0) {
      this.token = null;
      return this.query(endpoint, body, 1);
    }
    // Too many requests: the limit is shared by every app using the same keys (RomM, for example), so wait longer each time.
    if (res.status === 429 && attempt < 5) {
      await new Promise((r) => setTimeout(r, Math.min(this.minIntervalMs * 4, 1000) * 2 ** attempt));
      return this.query(endpoint, body, attempt + 1);
    }
    if (!res.ok) throw new IgdbError(`IGDB answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()) as T[];
  }

  /** Every game IGDB lists for a platform, a page at a time. */
  async gamesOnPlatform(igdbPlatformId: number): Promise<IgdbGame[]> {
    const games: IgdbGame[] = [];
    let lastId = 0;
    for (let page = 0; page < 400; page++) {
      const rows = await this.query<{ id: number }>('games', `fields ${IGDB_GAME_FIELDS}; where platforms = (${igdbPlatformId}) & id > ${lastId}; sort id asc; limit ${PAGE};`);
      for (const r of rows) {
        const g = igdbGameFromApi(r, igdbPlatformId);
        if (g) games.push(g);
      }
      if (rows.length < PAGE) break;
      lastId = rows[rows.length - 1]!.id;
    }
    return games;
  }

  /**
   * The platform's games IGDB has a physical listing for (its links to retailers marked physical),
   * with the listings' countries.
   */
  async physicalListings(igdbPlatformId: number): Promise<Map<number, number[]>> {
    const formats = await this.query<{ id: number; format: string }>('game_release_formats', 'fields id,format; limit 50;');
    const physical = formats.find((f) => /physical/i.test(f.format))?.id;
    const result = new Map<number, number[]>();
    if (!physical) return result;
    for (let offset = 0; offset < 100_000; offset += PAGE) {
      const rows = await this.query<{ game?: number; countries?: number[] }>(
        'external_games',
        `fields game,countries; where platform = ${igdbPlatformId} & game_release_format = ${physical}; sort id asc; limit ${PAGE}; offset ${offset};`,
      );
      for (const r of rows) {
        if (typeof r.game !== 'number') continue;
        const countries = result.get(r.game) ?? [];
        for (const c of r.countries ?? []) if (!countries.includes(c)) countries.push(c);
        result.set(r.game, countries);
      }
      if (rows.length < PAGE) break;
    }
    return result;
  }

  /** Checks the keys by asking IGDB for one platform's name. */
  async test(): Promise<string> {
    const rows = await this.query<{ name?: string }>('platforms', 'fields name; where id = 9;');
    return `Connected to IGDB${rows[0]?.name ? ` (it knows ${rows[0].name})` : ''}.`;
  }
}

/** How far IGDB data is downloaded for a platform. */
export interface IgdbPlatformStatus {
  key: string;
  name: string;
  igdbId: number | null;
  /** IGDB's second platform whose games join the list (Settings > Sources), such as the Super Famicom. */
  extraIgdbId: number | null;
  games: number;
  syncedAt: string | null;
  error: string | null;
}

/**
 * Keeps each catalog platform's IGDB game list in the database and answers
 * "which IGDB game is this title?" for covers and game details.
 */
export class IgdbService {
  private indexes = new Map<number, (title: string) => IgdbGame | undefined>();
  private platformIds = new Map<string, number | null>();
  private revision = 0;

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    readonly client: IgdbClient,
    private readonly log: Logger,
  ) {}

  /** Changes whenever stored IGDB data changes. */
  stamp(): number {
    return this.revision;
  }

  /** The platform's IGDB platform (Settings > Sources); another region's own console without one of its own takes its base console's. */
  private igdbIdFor(platformKey: string): number | null {
    return forPlatform(this.settings.get('sources.igdbPlatformIds'), platformKey) ?? null;
  }

  /** The platform's second IGDB platform (Settings > Sources), when it has one besides its first. */
  extraIdFor(platformKey: string): number | null {
    const id = forPlatform(this.settings.get('sources.igdbExtraPlatformIds'), platformKey) ?? null;
    return id !== null && id !== this.igdbIdFor(platformKey) ? id : null;
  }

  /** Platforms that have a catalog and count now (see consoleInUse): the ones worth an IGDB list. */
  private catalogPlatforms() {
    const home = this.settings.get('general.homeRegion');
    const locked = this.settings.get('platforms.regionLocked');
    return this.db
      .selectDistinct({ id: platforms.id, key: platforms.key, name: platforms.name })
      .from(platforms)
      .innerJoin(catalogEntries, eq(catalogEntries.platformId, platforms.id))
      .all()
      .filter((p) => consoleInUse(p.key, home, locked));
  }

  status(): { configured: boolean; platforms: IgdbPlatformStatus[] } {
    const syncs = new Map(this.db.select().from(igdbSyncs).all().map((s) => [s.platformId, s]));
    return {
      configured: this.client.configured(),
      platforms: this.catalogPlatforms()
        .map((p) => {
          const s = syncs.get(p.id);
          return { key: p.key, name: p.name, igdbId: this.igdbIdFor(p.key), extraIgdbId: this.extraIdFor(p.key), games: s?.games ?? 0, syncedAt: s?.syncedAt ?? null, error: s?.error ?? null };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  /**
   * Downloads the game lists of every catalog platform (or one), each with the games of its second
   * IGDB platform. A platform that fails keeps its last list.
   */
  async sync(onlyKey?: string, progress?: (text: string) => void): Promise<string> {
    if (!this.client.configured()) return 'IGDB keys are not set (Settings > Sources).';
    const done: string[] = [];
    const failed: string[] = [];
    const todo = this.catalogPlatforms().filter((p) => (!onlyKey || p.key === onlyKey) && this.igdbIdFor(p.key));
    for (const [i, p] of todo.entries()) {
      const igdbId = this.igdbIdFor(p.key)!;
      const extraId = this.extraIdFor(p.key);
      progress?.(`${p.name} (${i + 1} of ${todo.length})`);
      const now = new Date().toISOString();
      try {
        const games = await this.client.gamesOnPlatform(igdbId);
        // Games only on the second platform (released only in Japan, for the Super Famicom) join the list.
        if (extraId !== null) {
          const have = new Set(games.map((g) => g.id));
          for (const g of await this.client.gamesOnPlatform(extraId)) if (!have.has(g.id)) games.push(g);
        }
        try {
          const physical = await this.client.physicalListings(igdbId);
          if (extraId !== null) {
            for (const [game, countries] of await this.client.physicalListings(extraId)) physical.set(game, [...new Set([...(physical.get(game) ?? []), ...countries])]);
          }
          for (const g of games) {
            const countries = physical.get(g.id);
            if (countries) g.physical = countries;
          }
        } catch (err) {
          // The game list is still worth keeping; physical evidence just waits for the next update.
          this.log.warn({ context: 'igdb' }, `IGDB physical listings for ${p.name} failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.db.transaction((tx) => {
          tx.delete(igdbGames).where(eq(igdbGames.platformId, p.id)).run();
          for (let i = 0; i < games.length; i += 200) {
            tx.insert(igdbGames)
              .values(games.slice(i, i + 200).map((g) => ({ platformId: p.id, igdbId: g.id, data: JSON.stringify(g) })))
              .onConflictDoNothing()
              .run();
          }
          tx.insert(igdbSyncs)
            .values({ platformId: p.id, syncedAt: now, games: games.length, error: null })
            .onConflictDoUpdate({ target: igdbSyncs.platformId, set: { syncedAt: now, games: games.length, error: null } })
            .run();
        });
        done.push(`${p.name} ${games.length}`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.db
          .insert(igdbSyncs)
          .values({ platformId: p.id, syncedAt: now, games: 0, error: message })
          .onConflictDoUpdate({ target: igdbSyncs.platformId, set: { syncedAt: now, error: message } })
          .run();
        failed.push(p.name);
        this.log.warn({ context: 'igdb' }, `IGDB list for ${p.name} failed: ${message}`);
        // Wrong keys fail every platform the same way: stop at the first.
        if (err instanceof IgdbError && /client ID and secret|IGDB keys/.test(message)) throw err;
      }
    }
    this.indexes.clear();
    this.revision++;
    if (done.length === 0 && failed.length > 0) throw new IgdbError(`Every platform failed; the details are on Settings > Sources.`);
    return `${done.length > 0 ? `Games per platform: ${done.join(', ')}` : 'Nothing to update'}${failed.length > 0 ? `. Failed: ${failed.join(', ')}` : ''}`;
  }

  /** Every IGDB game of a platform, as last downloaded (none before the first download). */
  games(platformId: number): IgdbGame[] {
    // Other names a game shares with another, or that are file names, would make two games one (withoutSharedNames).
    return withoutSharedNames(
      this.db
        .select({ data: igdbGames.data })
        .from(igdbGames)
        .where(eq(igdbGames.platformId, platformId))
        .all()
        .map((r) => JSON.parse(r.data) as IgdbGame),
    );
  }

  private indexFor(platformId: number) {
    let index = this.indexes.get(platformId);
    if (!index) {
      index = igdbIndex(this.games(platformId));
      this.indexes.set(platformId, index);
    }
    return index;
  }

  /**
   * IGDB's summary of a game: kept from an earlier ask, or asked for now and kept. Null when IGDB has none, isn't
   * set up, or can't be reached (then it's asked again next time).
   */
  async summaryOf(igdbId: number): Promise<string | null> {
    const kept = this.db.select().from(igdbSummaries).where(eq(igdbSummaries.igdbId, igdbId)).get();
    if (kept) return kept.summary;
    if (!this.client.configured()) return null;
    try {
      const [game] = await this.client.query<{ summary?: string }>('games', `fields summary; where id = ${igdbId};`);
      const summary = game?.summary?.trim() || null;
      this.db.insert(igdbSummaries).values({ igdbId, summary, fetchedAt: new Date().toISOString() }).onConflictDoNothing().run();
      return summary;
    } catch (err) {
      this.log.debug({ context: 'igdb', err }, `No summary for IGDB game ${igdbId}`);
      return null;
    }
  }

  /** The IGDB game for a title on a platform, if IGDB data was downloaded and a name matches. */
  find(platformId: number, title: string): IgdbGame | undefined {
    if (!this.settings.get('features.igdb')) return undefined;
    return this.indexFor(platformId)(title);
  }

  findByKey(platformKey: string, title: string): IgdbGame | undefined {
    if (!this.platformIds.has(platformKey)) {
      this.platformIds.set(platformKey, this.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, platformKey)).get()?.id ?? null);
    }
    const id = this.platformIds.get(platformKey);
    return id ? this.find(id, title) : undefined;
  }

  /** The cover image id for a title, for lists. */
  coverOf(platformKey: string, title: string): string | null {
    return this.findByKey(platformKey, title)?.coverId ?? null;
  }

  /** IGDB's rating of a title, for lists beside its acorns. */
  reviewsOf(platformKey: string, title: string): Reviews {
    return reviewsOf(this.findByKey(platformKey, title));
  }

  /** Forgets which platform each key is, after platforms were added (another region's console of its own). */
  forgetPlatforms(): void {
    this.platformIds.clear();
  }

  /**
   * Whether IGDB knows a physical listing of the game on the platform (when the setting asks, in the
   * console's region: the home region, or another region's own console's region).
   */
  physical(platformId: number, title: string, ownRegion?: string): boolean {
    const region = this.settings.get('catalogs.physicalRegion') === 'home' ? (ownRegion ?? this.settings.get('general.homeRegion')) : undefined;
    return physicalIn(this.find(platformId, title), region);
  }

  /** Game details from IGDB for the wishlist, when that setting is on. */
  details(platformId: number, title: string): GameDetails | undefined {
    if (!this.settings.get('sources.igdbDetails')) return undefined;
    const game = this.find(platformId, title);
    return game ? igdbDetails(game) : undefined;
  }

  /** Whether any IGDB data is stored (skips work when there is none). */
  hasData(): boolean {
    return (this.db.select({ n: sql<number>`count(*)` }).from(igdbGames).get()?.n ?? 0) > 0;
  }
}

/** IGDB: the download status of each platform, and the connection test. */
export function registerIgdbRoutes(app: FastifyInstance, igdb: IgdbService): void {
  app.get('/api/v1/sources/igdb', async () => igdb.status());

  app.post('/api/v1/sources/igdb/test', async (_request, reply) => {
    if (!igdb.client.configured()) return reply.code(400).send({ error: 'not-configured', message: 'Add the IGDB client ID and secret first (and save them).' });
    try {
      return { ok: true, message: await igdb.client.test() };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });
}
