import { baseTitle, matchKey, nowInDates, windowDaysFor } from '@squirrelcade/core';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import type { HistoryService } from './history.js';
import type { IgdbService } from './igdb.js';
import type { RootsService } from './roots.js';
import type { IssueView, MagazineService } from './magazines.js';
import type { SettingsService } from './settings.js';

/** One game's release on one console, as the index keeps it. */
interface Release {
  igdbId: number;
  day: string;
  platformKey: string;
  platform: string;
  title: string;
  rating: number | null;
  count: number;
  coverId: string | null;
}

/** A game out in a window: its consoles there, the first day, and why it ranks where it does. */
export interface WindowGame {
  title: string;
  day: string;
  consoles: { key: string; name: string }[];
  rating: number | null;
  ratingCount: number;
  coverId: string | null;
  top100: boolean;
  /** Its reviews in the owner's magazines (D192). */
  reviews: { issueId: number; issue: string; page: number; score: string | null }[];
}

/** A window of days around a date: the games out then and the magazines on sale. */
export interface MediaWindow {
  date: string;
  label: string;
  from: string;
  to: string;
  games: WindowGame[];
  magazines: IssueView[];
}

/** The kinds of IGDB entries that count as a game's release (not its bundles, packs or updates). */
const COUNTED = new Set(['Main Game', 'Remake', 'Remaster', 'Expanded Game', 'Standalone Expansion', 'Port']);

const shift = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Now in and the Time machine (D190, the owner: "I'll call this feature Now in"; "pick any date and... get a vibe of all
 * the media that's going on"): the games out and the magazines on sale in a window of days around a date. Two entries,
 * one engine: Now in goes back a decade at a time from today, the Time machine takes any date. Release days come from an
 * index of IGDB's lists, built once (and again when IGDB's lists change) and searched by day, never read per request.
 */
export class TimeMachineService {
  private index: { stamp: number; rows: Release[]; top: Set<string> } | null = null;

  constructor(private readonly d: { db: Db; settings: SettingsService; igdb: IgdbService; history: HistoryService; magazines: MagazineService; roots?: RootsService; log: Logger }) {}

  /** The release index: every IGDB game with a release day on a console Squirrelcade knows, by day. */
  private releases(): { rows: Release[]; top: Set<string> } {
    const stamp = this.d.igdb.stamp();
    if (this.index?.stamp === stamp) return this.index;
    const started = Date.now();
    // Only the few fields a window needs, read straight from each row's JSON (the whole lists aren't kept for this).
    const raw = this.d.db.all<{ id: number; key: string; name: string; title: string; day: string; rating: number | null; count: number | null; cover: string | null; type: string | null }>(sql`
      SELECT g.igdb_id AS id, p.key AS key, p.name AS name, json_extract(g.data, '$.name') AS title, json_extract(g.data, '$.released') AS day,
        json_extract(g.data, '$.rating') AS rating, json_extract(g.data, '$.ratingCount') AS count, json_extract(g.data, '$.coverId') AS cover,
        json_extract(g.data, '$.gameType') AS type
      FROM igdb_games g JOIN platforms p ON p.id = g.platform_id
      WHERE json_extract(g.data, '$.released') IS NOT NULL`);
    const rows = raw
      .filter((r) => r.type === null || COUNTED.has(r.type))
      .map((r) => ({ igdbId: r.id, day: r.day, platformKey: r.key, platform: r.name, title: r.title, rating: r.rating, count: r.count ?? 0, coverId: r.cover }))
      .sort((a, b) => a.day.localeCompare(b.day));
    // A Top 100 place lifts a game in its window.
    const top = new Set<string>();
    try {
      for (const key of this.d.history.available().top100) {
        const view = this.d.history.top100View(key, { pc: false, romm: false });
        for (const r of view?.rows ?? []) top.add(`${key}|${matchKey(r.title)}`);
      }
    } catch (err) {
      this.d.log.debug({ context: 'history', err }, "The Top 100 lists couldn't be read for Now in");
    }
    this.index = { stamp, rows, top };
    this.d.log.info({ context: 'history' }, `Now in's release index: ${rows.length} releases in ${Date.now() - started} ms`);
    return this.index;
  }

  /** The window around a date: the games out then, most important first, and the magazines on sale. */
  window(date: string, label: string): MediaWindow {
    const days = windowDaysFor(date, this.d.settings.get('roots.windowDays'), this.d.settings.get('roots.windowDaysByDecade'));
    const from = shift(date, -days);
    const to = shift(date, days);
    const { rows, top } = this.releases();
    // The first release on or after the window's start, then on until its end.
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid]!.day < from) lo = mid + 1;
      else hi = mid;
    }
    const games = new Map<string, WindowGame & { score: number }>();
    for (let i = lo; i < rows.length && rows[i]!.day <= to; i++) {
      const r = rows[i]!;
      const k = matchKey(r.title);
      const inTop = top.has(`${r.platformKey}|${k}`);
      // How much a release matters: its rating, weighed by how many ratings it rests on, and a Top 100 place.
      const score = ((r.rating ?? 50) / 100) * Math.log10(r.count + 1) + (inTop ? 2 : 0);
      const g = games.get(k);
      if (!g) {
        games.set(k, { title: r.title, day: r.day, consoles: [{ key: r.platformKey, name: r.platform }], rating: r.rating, ratingCount: r.count, coverId: r.coverId, top100: inTop, reviews: [], score });
        continue;
      }
      if (!g.consoles.some((c) => c.key === r.platformKey)) g.consoles.push({ key: r.platformKey, name: r.platform });
      if (r.day < g.day) g.day = r.day;
      if (score > g.score) Object.assign(g, { score, rating: r.rating, ratingCount: r.count, coverId: g.coverId ?? r.coverId });
      g.top100 ||= inTop;
    }
    const shown = this.d.settings.get('roots.windowGames');
    const list = [...games.values()]
      .sort((a, b) => b.score - a.score || a.day.localeCompare(b.day))
      .slice(0, shown)
      .map(({ score: _score, ...g }) => g);
    // What the owner's magazines said of them (D192).
    const reviews = this.d.magazines.reviewsOf(list.map((g) => g.title));
    for (const g of list) g.reviews = reviews.get(matchKey(baseTitle(g.title))) ?? [];
    return { date, label, from, to, games: list, magazines: this.d.magazines.onSale(from, to) };
  }

  /** The games out between two days on the consoles chosen (D192: the games a magazine's issue could be about). */
  releasesBetween(from: string, to: string, keep: (platformKey: string) => boolean = () => true): { platformKey: string; title: string; day: string }[] {
    const { rows } = this.releases();
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid]!.day < from) lo = mid + 1;
      else hi = mid;
    }
    const out: { platformKey: string; title: string; day: string }[] = [];
    for (let i = lo; i < rows.length && rows[i]!.day <= to; i++) if (keep(rows[i]!.platformKey)) out.push({ platformKey: rows[i]!.platformKey, title: rows[i]!.title, day: rows[i]!.day });
    return out;
  }

  /** The index built ahead of the first visit (it reads every IGDB list once). */
  warm(): void {
    this.releases();
  }

  /** The games that came out on a day of the year, any year (On this day, D194), or in a month (This month in history). */
  onThisDay(monthDay: string, limit = 12): (WindowGame & { year: number })[] {
    const { rows, top } = this.releases();
    const games = new Map<string, WindowGame & { year: number; score: number }>();
    for (const r of rows) {
      if (r.day.slice(5, 5 + monthDay.length) !== monthDay) continue;
      const k = `${r.day.slice(0, 4)}|${matchKey(r.title)}`;
      const inTop = top.has(`${r.platformKey}|${matchKey(r.title)}`);
      const score = ((r.rating ?? 50) / 100) * Math.log10(r.count + 1) + (inTop ? 2 : 0);
      const g = games.get(k);
      if (g) {
        if (!g.consoles.some((c) => c.key === r.platformKey)) g.consoles.push({ key: r.platformKey, name: r.platform });
        if (score > g.score) Object.assign(g, { score, rating: r.rating, ratingCount: r.count });
        continue;
      }
      games.set(k, { title: r.title, day: r.day, year: Number(r.day.slice(0, 4)), consoles: [{ key: r.platformKey, name: r.platform }], rating: r.rating, ratingCount: r.count, coverId: r.coverId, top100: inTop, reviews: [], score });
    }
    return [...games.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .sort((a, b) => a.day.localeCompare(b.day))
      .map(({ score: _s, ...g }) => g);
  }

  /**
   * A game's releases beyond its first (D194, its timeline strip completed): the same game on the other consoles IGDB
   * lists, and its remakes and remasters, each with its day.
   */
  releasesOf(platformKey: string, title: string): { day: string; platform: string; title: string; kind: 'release' | 'remake' | 'remaster' }[] {
    const { rows } = this.releases();
    const game = this.d.igdb.findByKey(platformKey, title);
    const key = matchKey(game?.name ?? title);
    const remakes = new Set(game?.remakes ?? []);
    const remasters = new Set(game?.remasters ?? []);
    const out: { day: string; platform: string; title: string; kind: 'release' | 'remake' | 'remaster' }[] = [];
    for (const r of rows) {
      const kind = remakes.has(r.igdbId) ? 'remake' : remasters.has(r.igdbId) ? 'remaster' : matchKey(r.title) === key ? 'release' : null;
      if (kind) out.push({ day: r.day, platform: r.platform, title: r.title, kind });
    }
    return out;
  }

  /**
   * A game's line of its time for Store Mode (D194): the day it came out, a review of its time from its Wikipedia
   * reading as stored (nothing is fetched), and its review in the owner's magazines.
   */
  era(platformKey: string, title: string): { released: string | null; review: { outlet: string; score: string } | null; magazine: { issueId: number; issue: string; page: number; score: string | null } | null } {
    const reading = this.d.roots?.readingOf(platformKey, title)?.reading ?? null;
    const released = this.d.igdb.findByKey(platformKey, title)?.released ?? reading?.firstRelease ?? null;
    const row = reading?.reviews.find((r) => !r.aggregate && r.table !== 'later' && r.scores.length > 0) ?? null;
    const magazine = this.d.magazines.reviewsOf([title]).get(matchKey(baseTitle(title)))?.[0] ?? null;
    return { released, review: row ? { outlet: row.outlet, score: row.scores[0]!.score } : null, magazine };
  }

  /** Now in: today's day and month, a decade back at a time. */
  nowIn(today: string): MediaWindow[] {
    return nowInDates(today, this.d.settings.get('roots.nowInDecades')).map((d) => this.window(d.date, d.label));
  }
}

export function registerTimeMachineRoutes(app: FastifyInstance, tm: TimeMachineService, today: () => string): void {
  app.get('/api/v1/history/now-in', async () => ({ today: today(), windows: tm.nowIn(today()) }));
  // On this day and This month in history (D194).
  app.get('/api/v1/history/on-this-day', async (request) => {
    const q = request.query as { month?: string };
    const day = today();
    return q.month === '1' ? { today: day, month: true, games: tm.onThisDay(day.slice(5, 7), 10) } : { today: day, month: false, games: tm.onThisDay(day.slice(5)) };
  });
  // A game's line of its time, for Store Mode (D194).
  app.get('/api/v1/game/era', async (request, reply) => {
    const { platform, title } = request.query as { platform?: string; title?: string };
    if (!platform || !title?.trim()) return reply.code(400).send({ error: 'invalid', message: 'Give a platform key and a title.' });
    return tm.era(platform, title.trim());
  });
  // A game's re-releases, remakes and remasters, for its timeline strip (D194).
  app.get('/api/v1/game/releases', async (request, reply) => {
    const { platform, title } = request.query as { platform?: string; title?: string };
    if (!platform || !title?.trim()) return reply.code(400).send({ error: 'invalid', message: 'Give a platform key and a title.' });
    return { releases: tm.releasesOf(platform, title.trim()) };
  });
  app.get('/api/v1/history/day', async (request, reply) => {
    const date = String((request.query as { date?: unknown }).date ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return reply.code(400).send({ error: 'invalid', message: 'Give a date as YYYY-MM-DD.' });
    return tm.window(date, date);
  });
}
