import { aroundThisDate, dayIn, normalizeTitle, pickOfTheDay, priceChartingUrl, shopLinksFor, SHOPS_IN_LISTS, shopUrl, type DayPick, type ScoreComponent } from '@squirrelcade/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from './db/index.js';
import type { DealsService, DealView } from './deals.js';
import { appState } from './db/schema.js';
import type { HistoryService } from './history.js';
import type { IgdbService } from './igdb.js';
import type { NotificationService } from './notifications.js';
import type { SettingsService } from './settings.js';
import type { WishlistService } from './wishlist.js';

/**
 * The game of the day (Settings > Notifications > Game of the day, off by default): each day, one game you don't
 * have from the top of the wishlist (core's pickOfTheDay: a draw weighted by score, with anniversary points, and
 * no repeats for a while), shown on the Wishlist page and, if you like, sent as a message at an hour you choose.
 * "Another one" passes it over and draws again. No AI and no outside service: the wishlist's own points decide.
 */

/** Today's game, with what the Wishlist page's card and the message show. */
export interface GotdView {
  date: string;
  /** Which of the day's draws it is: 1 for the first, one more after each "Another one". */
  pick: number;
  platformKey: string;
  platform: string;
  title: string;
  score: number;
  priority: string;
  rank: number;
  /** The wishlist points that count most for it (the largest few). */
  reasons: ScoreComponent[];
  /** Its other points together (the rest of its reasons, before the score is fitted to the scale or capped). */
  otherPoints: number;
  /** IGDB's rating of it (critics and players together, out of 100) and how many ratings it rests on, when IGDB has one. */
  reviews: { rating: number; count: number } | null;
  /** Why it matters, from its console's history, when it has a text. */
  why: string | null;
  released: string | null;
  /** It came out around this date in a past year. */
  anniversary: boolean;
  coverId: string | null;
  preference: string | null;
  links: { name: string; url: string }[];
  /** A fresh deal on it from PriceCharting's emails (an eBay listing below the market value), when there is one. */
  deal: Pick<DealView, 'date' | 'priceCents' | 'saveCents' | 'listingTitle' | 'listingUrl'> | null;
}

const HISTORY_KEY = 'gotd.history';
const SENT_KEY = 'gotd.sent';
/** How many days of picks are kept (the repeat rules look back at most a year). */
const KEEP_PICKS = 400;

export class GameOfTheDayService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly wishlist: WishlistService,
    private readonly igdb: IgdbService | null,
    private readonly history: HistoryService | null,
    private readonly notifications: Pick<NotificationService, 'notice'> | null,
    private readonly deals: DealsService | null = null,
  ) {}

  enabled(): boolean {
    return this.settings.get('gotd.enabled');
  }

  private today(): string {
    return dayIn(this.settings.get('general.timeZone'));
  }

  /** Today's game: the one picked earlier today, or a new pick (remembered). Null when off or nothing can be picked. */
  current(): GotdView | null {
    if (!this.enabled()) return null;
    const date = this.today();
    const picks = this.picks();
    const kept = picks.find((p) => p.date === date && !p.skipped);
    if (kept) {
      const view = this.view(kept, date);
      // Still a game you don't have (not bought since this morning, still on the wishlist): keep it.
      if (view) return view;
    }
    return this.draw(date, picks);
  }

  /** "Another one": passes today's game over and draws another. */
  another(): GotdView | null {
    if (!this.enabled()) return null;
    const date = this.today();
    const picks = this.picks().map((p) => (p.date === date && !p.skipped ? { ...p, skipped: true } : p));
    this.save(picks);
    return this.draw(date, picks);
  }

  /** The picks so far, newest first. */
  picks(): DayPick[] {
    const row = this.db.select().from(appState).where(eq(appState.key, HISTORY_KEY)).get();
    try {
      return row ? (JSON.parse(row.value) as DayPick[]) : [];
    } catch {
      return [];
    }
  }

  /**
   * The task, every hour: once the day's hour has come, the day's game goes out as a message (once a day). What
   * it did, in a line.
   */
  async send(now = new Date()): Promise<string> {
    if (!this.enabled()) return 'The game of the day is off.';
    const date = dayIn(this.settings.get('general.timeZone'), now);
    const sent = this.db.select().from(appState).where(eq(appState.key, SENT_KEY)).get()?.value;
    if (sent === date) return `Sent today already.`;
    const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: this.zone() }).format(now));
    if (hour < this.settings.get('gotd.hour')) return `Goes out at ${this.settings.get('gotd.hour')}:00.`;
    const game = this.current();
    this.writeState(SENT_KEY, date);
    if (!game) return 'No game to pick: the wishlist is empty, or every game was picked lately.';
    if (!this.settings.get('gotd.send')) return `Today's game: ${game.title} (${game.platform}); not sent (Send it as a message is off).`;
    const lines = [
      `${game.title} (${game.platform}): #${game.rank} on your wishlist, ${game.priority.toLowerCase()} priority, ${game.score} acorns.`,
      game.anniversary && game.released ? `It came out on ${game.released} (${Number(date.slice(0, 4)) - Number(game.released.slice(0, 4))} years ago this week).` : null,
      game.deal?.priceCents ? `A deal from PriceCharting: listed on eBay for $${(game.deal.priceCents / 100).toFixed(2)}${game.deal.saveCents ? `, $${(game.deal.saveCents / 100).toFixed(2)} below the market value` : ''} (${game.deal.listingUrl ?? ''}).` : null,
      game.why ? `Why it matters: ${game.why}` : null,
      game.reviews ? `Reviews: ${game.reviews.rating}/100 on IGDB (${game.reviews.count} ratings).` : null,
      game.reasons.length > 0 ? `Where its acorns come from: ${game.reasons.map((r) => `${r.label} (${r.points > 0 ? '+' : ''}${r.points})`).join('; ')}.` : null,
      `Price: ${game.links[0]?.url ?? ''}`,
    ].filter(Boolean);
    await this.notifications?.notice(`game of the day: ${game.title}`, lines.join(' '), '/wishlist');
    return `Sent: ${game.title} (${game.platform}).`;
  }

  private zone(): string {
    const zone = this.settings.get('general.timeZone');
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: zone });
      return zone || 'UTC';
    } catch {
      return 'UTC';
    }
  }

  /** Draws today's game (a new try after each pass), remembers it, and shows it. */
  private draw(date: string, picks: DayPick[]): GotdView | null {
    const top = this.wishlist.compute().master.slice(0, this.settings.get('gotd.pickFrom'));
    // A game with a fresh deal from PriceCharting's emails gets the deal points in the draw.
    const deals = this.deals?.recent() ?? [];
    const dealPoints = this.settings.get('gotd.dealPoints');
    const candidates = top.map((m) => ({
      platformKey: m.platformKey,
      title: m.title,
      score: m.score + (dealPoints > 0 && this.deals?.forGame(m.platformKey, m.title, deals) ? dealPoints : 0),
      franchise: m.franchise ?? '',
      released: this.igdb?.findByKey(m.platformKey, m.title)?.released ?? null,
    }));
    const rules = {
      repeatDays: this.settings.get('gotd.repeatDays'),
      seriesDays: this.settings.get('gotd.seriesDays'),
      pastBonus: this.settings.get('gotd.pastBonus'),
      windowDays: 7,
    };
    const tries = picks.filter((p) => p.date === date).length;
    const pick = pickOfTheDay(candidates, picks, date, rules, tries);
    if (!pick) return null;
    this.save([{ date, platformKey: pick.platformKey, title: pick.title, franchise: pick.franchise }, ...picks]);
    return this.view({ date, platformKey: pick.platformKey, title: pick.title, franchise: pick.franchise }, date);
  }

  /** What a pick shows, from the wishlist as it is now; null when it isn't on the wishlist any more. */
  private view(pick: DayPick, date: string): GotdView | null {
    const result = this.wishlist.compute();
    const entry = result.master.find((m) => m.platformKey === pick.platformKey && normalizeTitle(m.title) === normalizeTitle(pick.title));
    if (!entry) return null;
    const igdbGame = this.igdb?.findByKey(entry.platformKey, entry.title);
    const released = igdbGame?.released ?? null;
    const shops = shopLinksFor(this.settings.get('interface.shopLinks'), entry.platformKey).slice(0, SHOPS_IN_LISTS).map((s) => ({ name: s.name, url: shopUrl(s.template, entry.title, entry.platformName) }));
    const why = this.history?.enabled() ? (this.history.gameHistory(entry.platformKey, [entry.title]).why?.text ?? null) : null;
    // The game's own points, not the lines that fit or cap the total ("Fitted to the scale", "Capped at 100").
    const own = entry.components.filter((c) => !/^(Fitted to the scale|Capped at)/.test(c.label));
    const reasons = own.filter((c) => c.points > 0).sort((a, b) => b.points - a.points).slice(0, 3);
    return {
      date,
      pick: Math.max(1, this.picks().filter((p) => p.date === date).length),
      platformKey: entry.platformKey,
      platform: entry.platformName,
      title: entry.title,
      score: entry.score,
      priority: entry.priority,
      rank: entry.rank,
      reasons,
      otherPoints: own.reduce((sum, c) => sum + c.points, 0) - reasons.reduce((sum, c) => sum + c.points, 0),
      reviews: igdbGame?.rating != null && igdbGame.ratingCount ? { rating: Math.round(igdbGame.rating), count: igdbGame.ratingCount } : null,
      why,
      released,
      anniversary: aroundThisDate(released, date, 7),
      coverId: this.igdb?.coverOf(entry.platformKey, entry.title) ?? null,
      preference: this.wishlist.preferences().get(`${entry.platformKey}|${normalizeTitle(entry.title)}`) ?? null,
      links: [{ name: 'PriceCharting', url: priceChartingUrl(entry.title, entry.platformName) }, ...shops],
      deal: pickDeal(this.deals?.forGame(entry.platformKey, entry.title) ?? null),
    };
  }

  private save(picks: DayPick[]): void {
    this.writeState(HISTORY_KEY, JSON.stringify(picks.slice(0, KEEP_PICKS)));
  }

  private writeState(key: string, value: string): void {
    this.db.insert(appState).values({ key, value }).onConflictDoUpdate({ target: appState.key, set: { value } }).run();
  }
}

/** What the card and the message show of a deal. */
function pickDeal(d: DealView | null): GotdView['deal'] {
  return d ? { date: d.date, priceCents: d.priceCents, saveCents: d.saveCents, listingTitle: d.listingTitle, listingUrl: d.listingUrl } : null;
}

export function registerGotdRoutes(app: FastifyInstance, gotd: GameOfTheDayService): void {
  const off = { error: 'off', message: 'The game of the day is off (Settings > Notifications > Game of the day).' };
  app.get('/api/v1/gotd', async (_request, reply) => {
    if (!gotd.enabled()) return reply.code(404).send(off);
    return { game: gotd.current() };
  });
  app.post('/api/v1/gotd/another', async (_request, reply) => {
    if (!gotd.enabled()) return reply.code(404).send(off);
    return { game: gotd.another() };
  });
}
