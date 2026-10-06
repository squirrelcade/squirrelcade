import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { appState } from './db/schema.js';
import type { FetchLike } from './igdb.js';
import type { PcPrice } from './itad.js';
import type { SettingsService } from './settings.js';

const BASE = 'https://api.gg.deals/v1/prices/by-steam-app-id/';
/** Steam games asked about per request: GG.deals' most, and its limit per minute. */
const BATCH = 100;
/** app_state key: GG.deals' prices by Steam app ID, as last read. */
const STATE = 'pc.ggdeals.prices';

/** GG.deals' prices for one Steam game, in cents of its region's currency. */
export interface GgPrice {
  title: string;
  /** The game's page on GG.deals (its links are kept as they are, as its terms ask). */
  url: string;
  /** The lowest price now in a retail store, and in a key shop. */
  currentCents: number | null;
  keyshopCents: number | null;
  /** The lowest price ever in a retail store, and in a key shop. */
  lowCents: number | null;
  lowKeyshopCents: number | null;
  currency: string | null;
  fetchedAt: string;
}

/** A price as GG.deals writes it ("91.99"), in cents; null when there is none. */
function cents(v: unknown): number | null {
  if (typeof v !== 'string' || v.trim() === '' || !Number.isFinite(Number(v))) return null;
  return Math.round(Number(v) * 100);
}

/** A GG.deals price as the PC wishlist shows prices: its retail price, credited to GG.deals with its link. */
export function ggAsPcPrice(g: GgPrice): PcPrice {
  return {
    currentCents: g.currentCents,
    regularCents: null,
    cut: null,
    shop: 'GG.deals',
    url: g.url,
    lowCents: g.lowCents,
    currency: g.currency,
    atLow: g.currentCents !== null && g.lowCents !== null && g.currentCents <= g.lowCents,
    missing: false,
    fetchedAt: g.fetchedAt,
    source: 'ggdeals',
    keyshopCents: g.keyshopCents,
  };
}

/**
 * PC game prices from GG.deals (Settings > Sources > GG.deals), a second source beside IsThereAnyDeal: the PC
 * wishlist's Steam games, read with the PC prices task, 100 a minute (its limit; free for personal use, with
 * GG.deals credited wherever its prices show).
 */
export class GgDealsService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly fetchLike: FetchLike = (url, init) => fetch(url, init),
    private readonly log?: Logger,
    private readonly pauseMs = 61_000,
  ) {}

  configured(): boolean {
    return this.settings.get('sources.ggdealsKey').trim() !== '';
  }

  /** Each Steam game's GG.deals prices, as last read. */
  prices(): Map<number, GgPrice> {
    const row = this.db.select().from(appState).where(eq(appState.key, STATE)).get();
    const stored = row ? (JSON.parse(row.value) as Record<string, GgPrice>) : {};
    return new Map(Object.entries(stored).map(([id, p]) => [Number(id), p]));
  }

  /** Reads the prices of these Steam games, 100 at a time a minute apart, keeping each answer. What happened, in a line. */
  async read(appIds: readonly number[]): Promise<string> {
    const ids = [...new Set(appIds)].filter((id) => Number.isInteger(id) && id > 0);
    if (ids.length === 0) return 'GG.deals: no Steam games to price';
    const key = this.settings.get('sources.ggdealsKey').trim();
    const region = this.settings.get('sources.ggdealsRegion');
    const stored: Record<string, GgPrice> = Object.fromEntries([...this.prices()].map(([id, p]) => [String(id), p]));
    let found = 0;
    let asked = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      if (i > 0 && this.pauseMs > 0) await new Promise((done) => setTimeout(done, this.pauseMs));
      const batch = ids.slice(i, i + BATCH);
      const res = await this.fetchLike(`${BASE}?ids=${batch.join(',')}&key=${encodeURIComponent(key)}&region=${encodeURIComponent(region)}`, {
        headers: { accept: 'application/json' },
      });
      if (res.status === 401 || res.status === 403) throw new Error("GG.deals didn't take the API key (Settings > Sources > GG.deals).");
      // Past its limit (100 a minute, 1,000 an hour): the rest wait for the next check.
      if (res.status === 429) {
        this.log?.warn({ context: 'ggdeals' }, 'GG.deals: over its limit; the rest wait for the next check');
        break;
      }
      if (!res.ok) throw new Error(`GG.deals answered ${res.status}.`);
      const body = (await res.json()) as { data?: Record<string, { title?: string; url?: string; prices?: Record<string, unknown> } | null> };
      const now = new Date().toISOString();
      for (const id of batch) {
        asked++;
        const g = body.data?.[String(id)];
        if (!g?.prices) {
          delete stored[String(id)];
          continue;
        }
        stored[String(id)] = {
          title: g.title ?? '',
          url: g.url ?? '',
          currentCents: cents(g.prices.currentRetail),
          keyshopCents: cents(g.prices.currentKeyshops),
          lowCents: cents(g.prices.historicalRetail),
          lowKeyshopCents: cents(g.prices.historicalKeyshops),
          currency: typeof g.prices.currency === 'string' ? g.prices.currency : null,
          fetchedAt: now,
        };
        found++;
      }
    }
    const text = JSON.stringify(stored);
    this.db.insert(appState).values({ key: STATE, value: text }).onConflictDoUpdate({ target: appState.key, set: { value: text } }).run();
    return `GG.deals: prices for ${found} of ${asked} Steam games`;
  }
}
