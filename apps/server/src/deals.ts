import { editionBase, igdbCoverUrl, KNOWN_PLATFORMS, listingPart, matchKey, normalizeTitle, platformInText } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import type { CatalogService } from './catalogs.js';
import type { IgdbService, Reviews } from './igdb.js';
import type { MailImportService, StoredDeal } from './mailImport.js';
import { escapeHtml, type NotificationService } from './notifications.js';
import type { SettingsService } from './settings.js';
import type { WishlistService } from './wishlist.js';

/**
 * Wishlist > Deals: the deals PriceCharting emailed (a game of your PriceCharting wishlist listed on eBay below the
 * market value; read with collection updates from email), each matched to its console's catalog game, with whether
 * you have it and its place on Squirrelcade's own wishlist. Nothing is fetched from PriceCharting or eBay.
 */

/** A deal with what Squirrelcade knows of its game. */
export interface DealView extends StoredDeal {
  platformKey: string | null;
  platform: string | null;
  /** The catalog game it is, when its console's catalog has it. */
  gameTitle: string | null;
  /** The catalog's answer for it: owned, missing, review, unconfirmed or excluded. */
  status: string | null;
  wishlist: { score: number; priority: string; rank: number | null } | null;
  coverId: string | null;
  /** IGDB's rating of the game, beside its acorns (0.53.0). */
  reviews: Reviews;
  /** What the listing is when its title says it isn't the game ("Manual only", "Case only"...; listingPart), else null. */
  part: string | null;
}

/** A deal's email: the game's box art, its console and place on the wishlist, the price, and a link to the listing. */
export function dealHtml(d: { title: string; console: string; rank: number; price: string; coverId: string | null; url: string | null }): string {
  const cover = d.coverId ? `<td style="width:68px;padding:0 12px 0 0;vertical-align:top"><img src="${escapeHtml(igdbCoverUrl(d.coverId))}" width="56" height="80" alt="" style="display:block;border-radius:6px"></td>` : '';
  const link = d.url ? `<div style="margin-top:8px"><a href="${escapeHtml(d.url)}" style="color:#2b7a4b;font-weight:600;text-decoration:none">See the listing &rsaquo;</a></div>` : '';
  return (
    `<table role="presentation" style="border-collapse:collapse"><tr>${cover}<td style="vertical-align:top">` +
    `<div style="font-weight:700;font-size:16px">${escapeHtml(d.title)}</div>` +
    `<div style="color:#526357;font-size:13px;margin-top:2px">${escapeHtml(d.console)} &middot; #${d.rank} on your wishlist</div>` +
    `<div style="margin-top:8px">${escapeHtml(d.price)}</div>${link}</td></tr></table>`
  );
}

export class DealsService {
  constructor(
    private readonly settings: SettingsService,
    private readonly mail: MailImportService,
    private readonly catalogs: CatalogService,
    private readonly wishlist: WishlistService,
    private readonly igdb: IgdbService | null,
    private readonly notifications: Pick<NotificationService, 'notice'> | null = null,
  ) {}

  /**
   * New deals on games your wishlist ranks in its top Settings > Collection > "Tell me about deals on my wishlist's
   * top" (0, off, by default): one message each, with the rank, the price and the listing. How many were sent.
   */
  async alert(added: StoredDeal[]): Promise<number> {
    const top = this.settings.get('mail.dealAlertRank');
    if (top <= 0 || !this.notifications || added.length === 0) return 0;
    const ids = new Set(added.map((d) => d.id));
    const money = (cents: number | null) => (cents === null ? '' : `$${(cents / 100).toFixed(2)}`);
    let sent = 0;
    // Only fresh deals: the first look at a mailbox reads a week of them, and old listings have usually sold.
    const fresh = Date.now() - 24 * 3_600_000;
    for (const d of this.recent().filter((x) => ids.has(x.id) && Date.parse(x.date) >= fresh)) {
      const rank = d.wishlist?.rank;
      if (!rank || rank > top || d.status === 'owned' || !d.gameTitle) continue;
      const price = d.priceCents !== null ? `listed on eBay for ${money(d.priceCents)}${d.saveCents ? `, ${money(d.saveCents)} below the market value` : ''}` : 'listed on eBay below the market value';
      const html = dealHtml({ title: d.gameTitle, console: d.platform ?? d.console, rank, price: `It's ${price} (PriceCharting).`, coverId: d.coverId, url: d.listingUrl ?? null });
      await this.notifications.notice(`deal on #${rank} of your wishlist: ${d.gameTitle}`, `${d.gameTitle} (${d.platform ?? d.console}), #${rank} on your wishlist, is ${price} (PriceCharting). ${d.listingUrl ?? ''}`.trim(), '/wishlist/deals', html);
      sent++;
    }
    return sent;
  }

  /** Read at all: collection updates from email on, with deal emails. */
  enabled(): boolean {
    return this.settings.get('features.mail') && this.settings.get('mail.deals');
  }

  /**
   * The recent deals, newest first, matched to the catalogs in one pass. A listing of a part without the game (a manual
   * or a case alone, compared with a whole game's market value) is left out while Settings > Email > "Leave out a
   * manual, case or box listed alone" is on: from Deals, Today, the game of the day and the messages alike.
   */
  recent(): DealView[] {
    return this.listed().deals;
  }

  /** The deals shown, and how many listings of a part alone were left out. */
  listed(): { deals: DealView[]; partsLeftOut: number } {
    const all = this.matched();
    if (!this.settings.get('mail.dealsLeaveOutParts')) return { deals: all, partsLeftOut: 0 };
    const deals = all.filter((d) => !d.part);
    return { deals, partsLeftOut: all.length - deals.length };
  }

  private matched(): DealView[] {
    if (!this.enabled()) return [];
    const deals = this.mail.deals();
    if (deals.length === 0) return [];
    // Each console's catalog games by the key titles are compared with (their other names too).
    const byPlatform = new Map<string, { name: string; games: Map<string, { title: string; status: string }> }>();
    for (const p of this.catalogs.allMatches()) {
      const games = new Map<string, { title: string; status: string }>();
      for (const t of p.match.targets) {
        for (const name of [t.target.title, ...(t.target.altTitles ?? [])]) {
          const k = matchKey(name);
          if (k && !games.has(k)) games.set(k, { title: t.target.title, status: t.status });
        }
      }
      byPlatform.set(p.key, { name: p.name, games });
    }
    const index = this.wishlist.compute().index;
    return deals.map((d) => {
      const platformKey = platformInText(d.console, KNOWN_PLATFORMS);
      const catalog = platformKey ? byPlatform.get(platformKey) : undefined;
      const game = catalog?.games.get(matchKey(d.title)) ?? catalog?.games.get(matchKey(editionBase(d.title))) ?? null;
      const w = game && platformKey ? index.get(`${platformKey}|${normalizeTitle(game.title)}`) : undefined;
      return {
        ...d,
        platformKey,
        platform: catalog?.name ?? KNOWN_PLATFORMS.find((k) => k.key === platformKey)?.name ?? null,
        gameTitle: game?.title ?? null,
        status: game?.status ?? null,
        wishlist: w ? { score: w.score, priority: w.priority, rank: w.rank } : null,
        coverId: game && platformKey ? (this.igdb?.coverOf(platformKey, game.title) ?? null) : null,
        reviews: game && platformKey ? (this.igdb?.reviewsOf(platformKey, game.title) ?? null) : null,
        part: listingPart(d.listingTitle),
      };
    });
  }

  /** The freshest deal on a catalog game (the game of the day's), or null. */
  forGame(platformKey: string, title: string, deals = this.recent()): DealView | null {
    const k = normalizeTitle(title);
    return deals.find((d) => d.platformKey === platformKey && d.gameTitle !== null && normalizeTitle(d.gameTitle) === k && d.status !== 'owned') ?? null;
  }
}

export function registerDealRoutes(app: FastifyInstance, deals: DealsService, settings: SettingsService): void {
  app.get('/api/v1/deals', async () => ({ on: deals.enabled(), days: settings.get('mail.dealDays'), ...deals.listed() }));
}
