import { addDays, dayIn } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import { shown } from './access.js';
import type { CatalogService } from './catalogs.js';
import { exportDate, type CollectionService } from './collection.js';
import type { CopyDetailsService, Loan } from './copyDetails.js';
import type { DealsService, DealView } from './deals.js';
import type { GameOfTheDayService, GotdView } from './gotd.js';
import type { HistoryService } from './history.js';
import type { Reviews } from './igdb.js';
import type { SetsService } from './sets.js';
import type { SettingsService } from './settings.js';

/** A list Today's Completion card shows: a console's catalog, its Top 100, or a set. */
export interface CompletionLine {
  kind: 'catalog' | 'top100' | 'set';
  key: string;
  name: string;
  owned: number;
  total: number;
  percent: number;
}

/**
 * Today (a page of its own, and a start page to choose): what matters today on one screen, for a phone as much as a
 * computer: the game of the day, the best new deals, the games coming out this week on your consoles, this week in
 * game history, lent games due back, the lists closest to done, and how old your collection's last update is. Each
 * part only when it has something to say.
 */
export interface TodayView {
  date: string;
  gotd: GotdView | null;
  /** Deals from PriceCharting's emails on games you don't have, newest first (up to 150): Today groups them by game, and
   * shows the best first or the wishlist's first, one console or all. */
  deals: DealView[];
  dealsOn: boolean;
  /** Games not out yet whose release date falls in the 7 days from today, soonest first. */
  releases: { platformKey: string; platform: string; title: string; releaseDate: string; status: string; score: number | null; reviews: Reviews; preference: string | null }[];
  /** This week in game history: games out on a day within 3 days of today's date in an earlier year, the best known 5. */
  history: ReturnType<CatalogService['onThisWeek']>;
  /** The catalogs, Top 100 lists and sets closest to done (not done yet), and how many are done. */
  completion: { lines: CompletionLine[]; done: number };
  /** Lent copies overdue or due within 7 days; null when a viewer isn't shown copies' details. */
  loans: Loan[] | null;
  /** The collection's newest update, and how many days old its export is. */
  lastUpdate: { fileName: string; appliedAt: string | null; addedCount: number; removedCount: number; changedCount: number; ageDays: number | null } | null;
}

/** How many lists the Completion card shows, and the fewest games a list needs to be shown (a list of 3 is soon done). */
const COMPLETION_LINES = 5;
const COMPLETION_MIN_GAMES = 10;

/** The lists closest to done: every catalog, Top 100 (of those consoles) and set you own a game of. */
export function completion(catalogs: CatalogService, history: HistoryService | null, sets: SetsService | null): TodayView['completion'] {
  const percent = (owned: number, total: number) => (total === 0 ? 0 : Math.round((owned / total) * 1000) / 10);
  const tracked = catalogs.summary().filter((c) => c.owned > 0);
  const lines: CompletionLine[] = [
    ...tracked.map((c) => {
      const total = c.owned + c.missing + c.review;
      return { kind: 'catalog' as const, key: c.key, name: c.name, owned: c.owned, total, percent: percent(c.owned, total) };
    }),
    ...(history?.top100Progress(tracked.map((c) => c.key)) ?? []).map((t) => ({ kind: 'top100' as const, key: t.platformKey, name: t.platform, owned: t.owned, total: t.total, percent: percent(t.owned, t.total) })),
    ...(sets?.list() ?? []).map((s) => ({ kind: 'set' as const, key: s.key, name: s.name, owned: s.owned, total: s.games, percent: percent(s.owned, s.games) })),
  ].filter((l) => l.owned > 0 && l.total >= COMPLETION_MIN_GAMES);
  const open = lines.filter((l) => l.owned < l.total).sort((a, b) => b.percent - a.percent || b.total - a.total || a.name.localeCompare(b.name));
  return { lines: open.slice(0, COMPLETION_LINES), done: lines.length - open.length };
}

export function registerTodayRoutes(
  app: FastifyInstance,
  deps: {
    settings: SettingsService;
    gotd: GameOfTheDayService;
    deals: DealsService;
    catalogs: CatalogService;
    details: CopyDetailsService;
    collection: CollectionService;
    history?: HistoryService | null;
    sets?: SetsService | null;
  },
): void {
  // Game history and completion take a moment on a big collection (every console's Top 100): kept for a few minutes,
  // and worked out again as soon as the day or the collection's latest update changes.
  let kept: { at: number; key: string; history: TodayView['history']; completion: TodayView['completion'] } | null = null;
  const KEEP_MS = 5 * 60_000;

  app.get('/api/v1/today', async (request): Promise<TodayView> => {
    const { settings, gotd, deals, catalogs, details, collection } = deps;
    const date = dayIn(settings.get('general.timeZone'));
    const week = addDays(date, 7);
    const lastDay = addDays(date, 6);
    const dealList = deals
      .recent()
      .filter((d) => d.status !== 'owned')
      .slice(0, 150);
    const releases = catalogs
      .upcoming()
      .filter((u) => /^\d{4}-\d{2}-\d{2}$/.test(u.releaseDate) && u.releaseDate >= date && u.releaseDate <= lastDay)
      .slice(0, 60)
      .map(({ platformKey, platform, title, releaseDate, status, score, reviews, preference }) => ({ platformKey, platform, title, releaseDate, status, score, reviews, preference }));
    const loans = shown(request).details ? details.loans().open.filter((l) => l.overdue || (l.dueAt !== null && l.dueAt.slice(0, 10) <= week)) : null;
    const latest = collection.listImports(1).find((i) => i.status === 'applied') ?? null;
    const exported = latest ? (exportDate(latest.fileName) ?? latest.createdAt.slice(0, 10)) : null;
    const keyNow = `${date}|${latest?.id ?? 0}`;
    if (!kept || kept.key !== keyNow || Date.now() - kept.at > KEEP_MS) {
      kept = { at: Date.now(), key: keyNow, history: catalogs.onThisWeek(date), completion: completion(catalogs, deps.history ?? null, deps.sets ?? null) };
    }
    return {
      date,
      gotd: gotd.enabled() ? gotd.current() : null,
      deals: dealList,
      dealsOn: deals.enabled(),
      releases,
      history: kept.history,
      completion: kept.completion,
      loans,
      lastUpdate: latest
        ? {
            fileName: latest.fileName,
            appliedAt: latest.appliedAt,
            addedCount: latest.addedCount,
            removedCount: latest.removedCount,
            changedCount: latest.changedCount,
            ageDays: exported ? Math.max(0, Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${exported}T00:00:00Z`)) / 86_400_000)) : null,
          }
        : null,
    };
  });
}
