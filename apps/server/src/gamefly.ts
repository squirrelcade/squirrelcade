import { GAMEFLY_PLATFORMS, gameflyUrl, matchKey, baseTitle } from '@squirrelcade/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { appState } from './db/schema.js';
import type { FetchLike } from './igdb.js';
import type { SettingsService } from './settings.js';

/** GameFly's public search (what its site asks, no account). */
const SEARCH_URL = 'https://api.gamefly.com/api/ProductQuery/Search';
const KEPT_KEY = 'gamefly.prices';
const PAUSE_MS = 1000;

/** A game's prices at GameFly (D174): new and used, in cents, and its page; both null when GameFly has it but doesn't sell it. */
export interface GameFlyPrice {
  platformKey: string;
  title: string;
  newCents: number | null;
  usedCents: number | null;
  url: string | null;
  checkedAt: string;
}

interface SearchItem {
  id: number;
  title: string;
  uriSafeTitle: string;
  platformId: number;
  productType?: string;
  offerActions?: { offerActionType: string; skuIsUsed?: boolean; listPrice?: { amount: number } | null; salePrice?: { amount: number } | null }[];
}

/**
 * GameFly as a place to buy (D174): its prices for the wishlist's games on the consoles it sells, read in the
 * background (one search a second, never on a page's request) and kept, for the wishlist and a game's Get it.
 */
export class GameFlyService {
  private kept: Map<string, GameFlyPrice> | null = null;

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly wishlistGames: () => { platformKey: string; title: string }[],
    private readonly log: Logger,
    private readonly fetchFn: FetchLike = fetch,
    private readonly pauseMs = PAUSE_MS,
  ) {}

  enabled(): boolean {
    return this.settings.get('sources.gamefly') === true;
  }

  private static key(platformKey: string, title: string): string {
    return `${platformKey}|${matchKey(title)}`;
  }

  /** The prices kept, read from the database once. */
  private prices(): Map<string, GameFlyPrice> {
    if (!this.kept) {
      const row = this.db.select().from(appState).where(eq(appState.key, KEPT_KEY)).get();
      let list: GameFlyPrice[] = [];
      try {
        list = row ? (JSON.parse(row.value) as GameFlyPrice[]) : [];
      } catch {
        list = [];
      }
      this.kept = new Map(list.map((p) => [GameFlyService.key(p.platformKey, p.title), p]));
    }
    return this.kept;
  }

  /** Every price kept (GameFly sells the game new or used), for the pages. */
  list(): GameFlyPrice[] {
    return [...this.prices().values()].filter((p) => p.newCents !== null || p.usedCents !== null);
  }

  /** What GameFly sells a game for: the one on that console whose title is the game's. */
  async lookup(platformKey: string, title: string): Promise<Omit<GameFlyPrice, 'checkedAt'> | null> {
    const platformId = GAMEFLY_PLATFORMS[platformKey];
    if (platformId === undefined) return null;
    const res = await this.fetchFn(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ searchTerm: title, pageSize: 20 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`GameFly answered ${res.status}`);
    const items = ((await res.json()) as { itemPage?: { items?: SearchItem[] } }).itemPage?.items ?? [];
    const want = new Set([matchKey(title), matchKey(baseTitle(title))]);
    const item = items.find((i) => i.platformId === platformId && (i.productType ?? 'Game') !== 'Movie' && (want.has(matchKey(i.title)) || want.has(matchKey(baseTitle(i.title)))));
    if (!item) return null;
    const cheapest = (used: boolean) => {
      const amounts = (item.offerActions ?? [])
        .filter((o) => o.offerActionType === 'Purchase' && Boolean(o.skuIsUsed) === used)
        .map((o) => o.salePrice?.amount ?? o.listPrice?.amount)
        .filter((a): a is number => typeof a === 'number' && a > 0);
      return amounts.length > 0 ? Math.round(Math.min(...amounts) * 100) : null;
    };
    return { platformKey, title, newCents: cheapest(false), usedCents: cheapest(true), url: gameflyUrl(item.uriSafeTitle, item.id) };
  }

  /** The task: the wishlist's first games on GameFly's consoles, each asked about once, a second apart; kept. */
  async refresh(progress: (line: string) => void = () => undefined): Promise<string> {
    if (!this.enabled()) return "GameFly's prices are off";
    const games = this.wishlistGames()
      .filter((g) => GAMEFLY_PLATFORMS[g.platformKey] !== undefined)
      .slice(0, this.settings.get('sources.gameflyGames'));
    const now = new Date().toISOString();
    const next = new Map<string, GameFlyPrice>();
    let found = 0;
    let failed = 0;
    for (const [i, g] of games.entries()) {
      progress(`${i + 1} of ${games.length}`);
      try {
        const price = await this.lookup(g.platformKey, g.title);
        next.set(GameFlyService.key(g.platformKey, g.title), price ? { ...price, checkedAt: now } : { platformKey: g.platformKey, title: g.title, newCents: null, usedCents: null, url: null, checkedAt: now });
        if (price && (price.newCents !== null || price.usedCents !== null)) found++;
      } catch (err) {
        failed++;
        // What was kept before stays, until GameFly answers again.
        const before = this.prices().get(GameFlyService.key(g.platformKey, g.title));
        if (before) next.set(GameFlyService.key(g.platformKey, g.title), before);
        if (failed === 1) this.log.warn({ context: 'gamefly' }, `GameFly didn't answer: ${err instanceof Error ? err.message : String(err)}`);
        if (failed >= 5 && found === 0) break;
      }
      if (i < games.length - 1 && this.pauseMs > 0) await new Promise((r) => setTimeout(r, this.pauseMs));
    }
    this.kept = next;
    const json = JSON.stringify([...next.values()]);
    this.db.insert(appState).values({ key: KEPT_KEY, value: json }).onConflictDoUpdate({ target: appState.key, set: { value: json } }).run();
    return `${found} of ${games.length} wishlist games sold at GameFly${failed > 0 ? ` (${failed} not answered)` : ''}`;
  }
}

export function registerGameFlyRoutes(app: FastifyInstance, gamefly: GameFlyService): void {
  // The prices kept (D174): read in the background, so this only reads memory.
  app.get('/api/v1/gamefly', async () => ({ on: gamefly.enabled(), prices: gamefly.enabled() ? gamefly.list() : [] }));
}
