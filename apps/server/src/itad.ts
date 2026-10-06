import { igdbCoverUrl } from '@squirrelcade/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { pcPrices } from './db/schema.js';
import type { FetchLike } from './igdb.js';
import { escapeHtml, type NotificationService } from './notifications.js';
import type { PcWishlistService } from './pcWishlist.js';
import type { SettingsService } from './settings.js';
import type { TaskRunner } from './tasks.js';

const BASE = 'https://api.isthereanydeal.com';
/** Games looked up on IsThereAnyDeal per check, at most; the rest wait for the next check. */
const LOOKUPS_PER_RUN = 300;
/** A game IsThereAnyDeal didn't have is asked about again after this long. */
const MISSING_RETRY_MS = 30 * 86_400_000;
/** Prices are asked for this many games at a time (IsThereAnyDeal's limit). */
const PRICE_BATCH = 200;
/** How many games on sale a message names; it counts the rest (a first check can find dozens on sale at once). */
const SALES_NAMED = 10;

/** The message about PC wishlist games on sale: the first SALES_NAMED by name (the wishlist's order), then how many more. */
export function saleMessage(told: string[]): string {
  if (told.length === 1) return `A game on your PC wishlist is on sale: ${told[0]}.`;
  const more = told.length - SALES_NAMED;
  return `${told.length} games on your PC wishlist are on sale: ${told.slice(0, SALES_NAMED).join('; ')}${more > 0 ? `; and ${more} more on the PC wishlist` : ''}.`;
}

/** One PC game on sale, as the email shows it: a row with its price, store, how much off, and its deal. */
export interface SaleRow {
  title: string;
  price: string;
  shop: string;
  cut: number;
  lowest: boolean;
  url: string | null;
  /** Its box art (IGDB's cover), when it has one. */
  image?: string | null;
}

/** The PC deals email: a row for each game (the first SALES_NAMED), each with its box art, badges and a link to its deal. */
export function saleHtml(rows: SaleRow[]): string {
  const badge = (text: string, bg: string, fg: string) => `<span style="display:inline-block;background:${bg};color:${fg};border-radius:6px;padding:2px 8px;font-size:12px;font-weight:700;margin-left:4px">${text}</span>`;
  const cell = 'padding:10px 0;border-bottom:1px solid #e3ebe5;vertical-align:top';
  const lines = rows.slice(0, SALES_NAMED).map(
    (r) =>
      `<tr><td style="${cell};width:52px;padding-right:12px">${r.image ? `<img src="${escapeHtml(r.image)}" width="45" height="64" alt="" style="display:block;border-radius:4px">` : ''}</td>` +
      `<td style="${cell}"><div style="font-weight:600">${escapeHtml(r.title)}</div><div style="color:#526357;font-size:13px">${escapeHtml(r.price)} at ${escapeHtml(r.shop)}</div></td>` +
      `<td style="${cell};text-align:right;white-space:nowrap">${badge(`${r.cut}% off`, '#ee8a2c', '#241302')}${r.lowest ? badge('Lowest ever', '#2b7a4b', '#ffffff') : ''}` +
      `${r.url ? `<div style="margin-top:6px"><a href="${escapeHtml(r.url)}" style="color:#2b7a4b;font-weight:600;text-decoration:none">See the deal &rsaquo;</a></div>` : ''}</td></tr>`,
  );
  const more = rows.length - SALES_NAMED;
  const head = rows.length === 1 ? 'A game on your PC wishlist is on sale:' : `${rows.length} games on your PC wishlist are on sale:`;
  return `<p style="margin:0 0 8px">${head}</p><table role="presentation" style="width:100%;border-collapse:collapse">${lines.join('')}</table>${more > 0 ? `<p style="margin:12px 0 0">And ${more} more on the PC wishlist.</p>` : ''}`;
}

/** IsThereAnyDeal refused or failed, with a message to show the user. */
export class ItadError extends Error {}

interface ItadAmount {
  amount: number;
  amountInt: number;
  currency: string;
}

interface ItadDeal {
  shop: { id: number; name: string };
  price: ItadAmount;
  regular: ItadAmount;
  cut: number;
  url: string;
}

/** A game's prices as IsThereAnyDeal gives them (POST /games/prices/v3). */
export interface ItadGamePrices {
  id: string;
  historyLow?: { all?: ItadAmount | null } | null;
  deals: ItadDeal[];
}

/** A PC wishlist game's price, as the page shows it. */
export interface PcPrice {
  /** The best price now, in the store country's currency; null when no store sells it. */
  currentCents: number | null;
  regularCents: number | null;
  /** Percent off the regular price. */
  cut: number | null;
  shop: string | null;
  url: string | null;
  /** The lowest price it has ever had. */
  lowCents: number | null;
  currency: string | null;
  /** At (or under) its lowest price ever. */
  atLow: boolean;
  /** IsThereAnyDeal doesn't have the game. */
  missing: boolean;
  /** Where the price comes from: IsThereAnyDeal (the default) or GG.deals. */
  source?: 'itad' | 'ggdeals';
  /** GG.deals' lowest key shop price now, beside its retail one. */
  keyshopCents?: number | null;
  fetchedAt: string;
}

/** IsThereAnyDeal's API: finding a game by its Steam app id or title, and its current and lowest prices. */
export class ItadClient {
  constructor(
    private readonly settings: SettingsService,
    private readonly fetcher: FetchLike = (url, init) => fetch(url, init),
  ) {}

  /** With PC game prices on (Settings > Features) and an API key. */
  configured(): boolean {
    return this.settings.get('features.itad') && this.settings.get('sources.itadKey').length > 0;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const key = this.settings.get('sources.itadKey');
    const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
    let res: Response;
    try {
      res = await this.fetcher(url, { ...init, signal: AbortSignal.timeout(30_000) });
    } catch (err) {
      throw new ItadError(`IsThereAnyDeal couldn't be reached: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 429) throw new ItadError('IsThereAnyDeal asked to slow down; the next check tries again.');
    if (res.status === 401 || res.status === 403) throw new ItadError("IsThereAnyDeal didn't accept the API key (Settings > Sources > IsThereAnyDeal).");
    if (!res.ok) throw new ItadError(`IsThereAnyDeal answered ${res.status}.`);
    return (await res.json()) as T;
  }

  /** A game's IsThereAnyDeal id, by its Steam app id or else its title; null when it isn't there. */
  async lookup(by: { appId?: number | null; title?: string }): Promise<{ id: string; title: string } | null> {
    const query = by.appId ? `appid=${by.appId}` : `title=${encodeURIComponent(by.title ?? '')}`;
    const r = await this.call<{ found?: boolean; game?: { id: string; title: string } }>(`/games/lookup/v1?${query}`);
    return r.found && r.game ? { id: r.game.id, title: r.game.title } : null;
  }

  /** The current deals and lowest price of up to 200 games, in a store country (two letters). */
  async prices(ids: string[], country: string): Promise<ItadGamePrices[]> {
    return this.call<ItadGamePrices[]>(`/games/prices/v3?country=${encodeURIComponent(country)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ids),
    });
  }
}

const cents = (a: ItadAmount | null | undefined) => (a && Number.isFinite(a.amountInt) ? a.amountInt : null);

/** The best deal in IsThereAnyDeal's answer: the lowest price now (and its store), and the lowest price ever. */
export function bestDeal(game: ItadGamePrices): Omit<PcPrice, 'missing' | 'fetchedAt' | 'atLow'> {
  const best = [...(game.deals ?? [])].sort((a, b) => a.price.amountInt - b.price.amountInt)[0];
  return {
    currentCents: cents(best?.price),
    regularCents: cents(best?.regular),
    cut: best ? best.cut : null,
    shop: best?.shop.name ?? null,
    url: best?.url ?? null,
    lowCents: cents(game.historyLow?.all),
    currency: best?.price.currency ?? game.historyLow?.all?.currency ?? null,
  };
}

/**
 * PC game prices (0.6.0, D56, optional: Settings > Features): IsThereAnyDeal's best current price and lowest price
 * ever for each game on the PC wishlist, checked every few hours, with a message when one drops the way
 * Settings > PC library > Prices says (at its lowest ever, or a big enough discount), each price once.
 */
export class PcPriceService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    readonly client: ItadClient,
    private readonly pcWishlist: PcWishlistService,
    private readonly notifications: NotificationService,
    private readonly log: Logger,
    private readonly intervalMs = 350,
  ) {}

  /** PC game prices are on (they need the PC library too). */
  enabled(): boolean {
    return this.settings.get('features.itad') && this.settings.get('features.pc');
  }

  /** Each PC wishlist game's price, by its key. */
  prices(): Map<string, PcPrice> {
    return new Map(
      this.db
        .select()
        .from(pcPrices)
        .all()
        .map((r) => [
          r.key,
          {
            currentCents: r.currentCents,
            regularCents: r.regularCents,
            cut: r.cut,
            shop: r.shop,
            url: r.url,
            lowCents: r.lowCents,
            currency: r.currency,
            atLow: r.currentCents !== null && r.lowCents !== null && r.currentCents <= r.lowCents,
            missing: r.missing,
            fetchedAt: r.fetchedAt,
          },
        ]),
    );
  }

  private pause(): Promise<void> {
    return this.intervalMs > 0 ? new Promise((resolve) => setTimeout(resolve, this.intervalMs)) : Promise.resolve();
  }

  /** Whether a price is worth a message under Settings > PC library > Prices. */
  private worthTelling(p: { currentCents: number | null; lowCents: number | null; cut: number | null }): boolean {
    if (p.currentCents === null) return false;
    const rule = this.settings.get('pc.priceAlertRule');
    if (rule === 'low') return p.lowCents !== null && p.currentCents <= p.lowCents && (p.cut ?? 0) > 0;
    if (rule === 'cut') return (p.cut ?? 0) >= this.settings.get('pc.priceAlertCut');
    return false;
  }

  /** Finds the PC wishlist's games on IsThereAnyDeal, reads their prices, and tells about drops; what it did. */
  async refresh(progress?: (text: string) => void): Promise<string> {
    if (!this.enabled()) return 'PC game prices are off (Settings > Features).';
    if (!this.client.configured()) return "IsThereAnyDeal's API key is needed (Settings > Sources > IsThereAnyDeal).";
    const items = this.pcWishlist.compute().items;
    if (items.length === 0) return 'The PC wishlist is empty.';
    const now = new Date().toISOString();
    const known = new Map(this.db.select().from(pcPrices).all().map((r) => [r.key, r]));

    // 1. Each game's IsThereAnyDeal id, kept once found; a game it doesn't have is asked about again after a month.
    let looked = 0;
    for (const item of items) {
      const row = known.get(item.key);
      if (row?.itadId || (row?.missing && Date.now() - Date.parse(row.fetchedAt) < MISSING_RETRY_MS)) continue;
      if (looked >= LOOKUPS_PER_RUN) break;
      looked++;
      progress?.(`Finding games on IsThereAnyDeal (${looked})`);
      const game = (item.steamAppId ? await this.client.lookup({ appId: item.steamAppId }) : null) ?? (await this.client.lookup({ title: item.title }));
      const values = { key: item.key, itadId: game?.id ?? null, title: item.title, missing: !game, fetchedAt: now };
      this.db.insert(pcPrices).values(values).onConflictDoUpdate({ target: pcPrices.key, set: values }).run();
      await this.pause();
    }

    // 2. Their prices, 200 games at a time.
    const rows = new Map(this.db.select().from(pcPrices).all().map((r) => [r.key, r]));
    const wanted = items.map((i) => rows.get(i.key)).filter((r): r is NonNullable<typeof r> => !!r?.itadId);
    const byId = new Map(wanted.map((r) => [r.itadId!, r]));
    const country = (this.settings.get('sources.itadCountry') || 'US').toUpperCase();
    let priced = 0;
    for (let i = 0; i < wanted.length; i += PRICE_BATCH) {
      progress?.(`Reading prices (${Math.min(i + PRICE_BATCH, wanted.length)} of ${wanted.length})`);
      const answer = await this.client.prices(
        wanted.slice(i, i + PRICE_BATCH).map((r) => r.itadId!),
        country,
      );
      for (const game of answer) {
        const row = byId.get(game.id);
        if (!row) continue;
        const deal = bestDeal(game);
        this.db
          .update(pcPrices)
          .set({ ...deal, missing: false, fetchedAt: now })
          .where(eq(pcPrices.key, row.key))
          .run();
        priced++;
      }
      if (i + PRICE_BATCH < wanted.length) await this.pause();
    }

    // 3. Drops worth a message, each price once (a price that stops being one can be told again later).
    const told: string[] = [];
    const saleRows: SaleRow[] = [];
    const toMark: { key: string; cents: number | null }[] = [];
    for (const item of items) {
      const r = this.db.select().from(pcPrices).where(eq(pcPrices.key, item.key)).get();
      if (!r || r.missing) continue;
      if (this.worthTelling(r)) {
        if (r.alertedCents !== r.currentCents) {
          const money = (c: number | null) => (c === null ? '?' : `${(c / 100).toFixed(2)} ${r.currency ?? ''}`.trim());
          told.push(`${item.title}: ${money(r.currentCents)} at ${r.shop ?? 'a store'} (${r.cut ?? 0}% off${r.lowCents !== null && r.currentCents !== null && r.currentCents <= r.lowCents ? ', its lowest ever' : ''})`);
          saleRows.push({
            title: item.title,
            price: money(r.currentCents),
            shop: r.shop ?? 'a store',
            cut: r.cut ?? 0,
            lowest: r.lowCents !== null && r.currentCents !== null && r.currentCents <= r.lowCents,
            url: r.url,
            image: item.coverId ? igdbCoverUrl(item.coverId) : null,
          });
          toMark.push({ key: r.key, cents: r.currentCents });
        }
      } else if (r.alertedCents !== null) {
        toMark.push({ key: r.key, cents: null });
      }
    }
    if (told.length > 0 && this.notifications.channels().length > 0) {
      const results = await this.notifications.notice(told.length === 1 ? 'a PC game is on sale' : 'PC games are on sale', saleMessage(told), '/pc/wishlist', saleHtml(saleRows));
      if (!results.some((r) => r.ok)) throw new Error(`The message about ${told.length} price drop(s) couldn't be sent: ${results.map((r) => `${r.channel}: ${r.error ?? 'failed'}`).join('; ')}`);
    }
    for (const m of toMark) this.db.update(pcPrices).set({ alertedCents: m.cents }).where(eq(pcPrices.key, m.key)).run();
    const missing = items.filter((i) => rows.get(i.key)?.missing).length;
    this.log.info({ context: 'itad' }, `Prices read for ${priced} PC wishlist games`);
    return `Prices for ${priced} of ${items.length} games${missing > 0 ? ` (${missing} not on IsThereAnyDeal)` : ''}${told.length > 0 ? `; ${told.length} price drop(s) told` : ''}`;
  }
}

/**
 * PC game prices: checking the key (the Test button under it), and reading the prices again now (in the background).
 * The prices themselves come with the PC wishlist.
 */
export function registerPcPriceRoutes(app: FastifyInstance, prices: PcPriceService, tasks: TaskRunner): void {
  app.post('/api/v1/pc/prices/test', async () => {
    if (!prices.client.configured()) return { ok: false, message: "Enter IsThereAnyDeal's API key first (and save it)." };
    try {
      // One lookup of a game every store sells (Portal 2, by its Steam app id): the key works if IsThereAnyDeal answers.
      const game = await prices.client.lookup({ appId: 620 });
      return { ok: true, message: game ? `IsThereAnyDeal accepted the key (it found ${game.title}).` : 'IsThereAnyDeal accepted the key.' };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post('/api/v1/pc/prices/refresh', async (_request, reply) => {
    tasks.enqueue('pc-prices');
    return reply.code(202).send({ queued: true });
  });
}
