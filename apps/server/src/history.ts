import {
  consoleProfileSchema,
  firstLaunchYear,
  KNOWN_PLATFORMS,
  lastYear,
  matchKey,
  normalizeTitle,
  parseHistory,
  parseTop100,
  regionalConsole,
  similarityReason,
  sourcesSchema,
  startHereSchema,
  type Completeness,
  type ConsoleHistory,
  type ConsoleProfile,
  type GameSignificance,
  type HistoryData,
  type HistoryStatus,
  type PlayStatus,
  type StartHereGame,
  type TargetResult,
  type Top100Data,
  type Top100Entry,
  type Top100List,
} from '@squirrelcade/core';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import type { Logger } from 'pino';
import historyFile from '../data/history.json';
import top100File from '../data/top100.json';
import { shown } from './access.js';
import type { RommLinker } from './catalogs.js';
import type { Db } from './db/index.js';
import { historyNotes, platforms } from './db/schema.js';
import type { IgdbService } from './igdb.js';
import type { PcService } from './pc.js';
import type { RommLink } from './romm.js';
import type { SettingsService } from './settings.js';
import { keysOf, wordsOf, type OwnedOnConsole, type TitleIndex } from './titleIndex.js';
import type { WishlistService } from './wishlist.js';

/** A history text as the pages show it: Squirrelcade's, or the owner's own version. */
export interface HistoryText {
  text: string;
  sources: string[];
  status: HistoryStatus;
  origin: 'squirrelcade' | 'yours';
  updatedAt: string | null;
  /** The owner's version started from an older text of Squirrelcade's, which has changed since. */
  newerShipped: boolean;
}

/** Whether the collection has a listed game: owned, one to answer on Review, a look-alike (not counted), or missing. */
export type ListOwnership = 'owned' | 'review' | 'maybe' | 'missing';

/** A game of a list (a Top 100 list, a console's "Start here" games) and what the collection has of it. */
export interface ListGame {
  title: string;
  coverId: string | null;
  owned: ListOwnership;
  /** The owned copies that count, on the console or its other regions' consoles (the Super Famicom's for the Super Nintendo). */
  copies: { title: string; platform: string; platformKey: string; completeness: Completeness; sealed: boolean; quantity: number }[];
  /** Owned copies on the console that look like it (not counted). */
  maybe: string[];
  /** Other consoles the same title is owned on. */
  ownedOn: string[];
  /** PC storefronts it's owned in for good (with the PC library on). */
  onPc: string[];
  /** The console catalog's game, for opening it in the game drawer: this console's, else another region's console's (the Super Famicom's for a game the Super Nintendo never had). */
  catalogTitle: string | null;
  catalogPlatformKey: string | null;
  catalogStatus: string | null;
  romm: RommLink | null;
  wishlistRank: number | null;
  preference: string | null;
  /** What the owner played of it (with that shown): its status and rating. */
  play: { status: PlayStatus | null; rating: number | null } | null;
}

/** What a requester may see on the lists: PC copies, RomM links and (optional) what the owner played. */
type Access = { pc: boolean; romm: boolean; play?: boolean };

/** One game of a console's Top 100 list. */
export interface Top100Row extends ListGame {
  rank: number;
  altTitles: string[];
  year: number | null;
  developers: string[];
  publishers: string[];
  why: HistoryText | null;
}

/** A console's Top 100 list with the collection's side of it (GET /api/v1/history/top100/:key). */
export interface Top100View {
  platformKey: string;
  platform: string;
  /** The list's own name for the console ("Super Nintendo / Super Famicom"). */
  listName: string;
  version: string;
  rows: Top100Row[];
  summary: { total: number; owned: number; review: number; maybe: number; inRomm: number | null; ownedInRomm: number | null; finished: number | null };
  /** RomM links for games you don't own are on (Settings > Sources > RomM). */
  rommUnowned: boolean;
}

/** A console's history for its page (GET /api/v1/history/consoles/:key). */
export interface ConsoleHistoryView {
  platformKey: string;
  platform: string;
  history: {
    profile: ConsoleProfile;
    startHere: (ListGame & { why: string })[];
    sources: string[];
    status: HistoryStatus;
    asOf: string | null;
    origin: 'squirrelcade' | 'yours';
    updatedAt: string | null;
    newerShipped: boolean;
  } | null;
  hasTop100: boolean;
}

/** Consoles and landmark games by year (GET /api/v1/history/timeline). */
export interface TimelineView {
  consoles: {
    platformKey: string;
    name: string;
    manufacturer: string | null;
    generation: number | null;
    launched: number | null;
    ended: number | null;
    /** You collect it: it has a catalog or owned copies. */
    tracked: boolean;
    hasHistory: boolean;
    hasTop100: boolean;
  }[];
  games: {
    platformKey: string;
    platform: string;
    title: string;
    catalogTitle: string | null;
    catalogPlatformKey: string | null;
    year: number;
    rank: number | null;
    startHere: boolean;
    owned: ListOwnership;
    /** Your wishlist preference for it, when a catalog has it. */
    preference: string | null;
  }[];
}

/** What the game drawer shows of a game's history: why it matters, and its place in its console's Top 100. */
export interface GameHistory {
  why: HistoryText | null;
  top100: { rank: number; of: number } | null;
}

/** Why the owner's history text couldn't be saved. */
export class HistoryError extends Error {}

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

/** A platform's display name when the database doesn't have it: Squirrelcade's own name, or another region's console's. */
const knownName = (key: string) => KNOWN_PLATFORMS.find((p) => p.key === key)?.name ?? regionalConsole(key)?.name ?? key;

/**
 * Top 100 lists and console history (D48, D49). The lists and texts ship with Squirrelcade (apps/server/data); the
 * owner's own versions of texts live in history_notes and win. What the collection has of a listed game comes
 * from the same matching as sets (the console catalog's answer, else the owned copies' titles), over the console
 * and its other regions' consoles of their own.
 */
export class HistoryService {
  readonly top100: Top100Data;
  readonly shipped: HistoryData;
  private readonly lists = new Map<string, Top100List>();
  private readonly shippedConsoles = new Map<string, ConsoleHistory>();
  /** Squirrelcade's texts about games by console and the exact key of their title, and by the keys without an edition. */
  private readonly shippedExact = new Map<string, GameSignificance>();
  private readonly shippedLoose = new Map<string, GameSignificance>();

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly titles: TitleIndex,
    private readonly deps: {
      igdb: IgdbService;
      wishlist: WishlistService;
      pc: PcService;
      romm: RommLinker;
      rommEnabled: () => boolean;
      /** What the owner played of a game on a console, by its names. */
      play?: (platformKey: string, names: string[]) => { status: PlayStatus | null; rating: number | null } | null;
    },
    private readonly log: Logger,
    data: { top100?: unknown; history?: unknown } = {},
  ) {
    this.top100 = parseTop100(data.top100 ?? top100File);
    this.shipped = parseHistory(data.history ?? historyFile);
    for (const l of this.top100.lists) this.lists.set(l.platformKey, l);
    for (const c of this.shipped.consoles) this.shippedConsoles.set(c.platformKey, c);
    for (const g of this.shipped.games) {
      this.shippedExact.set(`${g.platformKey}|${matchKey(g.title)}`, g);
      for (const k of keysOf(g.title)) if (!this.shippedLoose.has(`${g.platformKey}|${k}`)) this.shippedLoose.set(`${g.platformKey}|${k}`, g);
    }
  }

  /** Settings > Features > Top 100 lists and console history. */
  enabled(): boolean {
    return this.settings.get('features.history');
  }

  /** A console's Top 100 list: its own, or (another region's console of its own) its base console's. */
  listFor(platformKey: string): Top100List | undefined {
    return this.lists.get(platformKey) ?? this.lists.get(regionalConsole(platformKey)?.base ?? '');
  }

  private platformName(key: string): string {
    return this.platformNames().get(key) ?? knownName(key);
  }

  /** The platforms' names, read again after a few seconds (new consoles appear with collection updates). */
  private names: { at: number; map: Map<string, string> } | null = null;
  private platformNames(): Map<string, string> {
    if (this.names && Date.now() - this.names.at < 5000) return this.names.map;
    const map = new Map(
      this.db
        .select({ key: platforms.key, name: platforms.name })
        .from(platforms)
        .all()
        .map((p) => [p.key, p.name]),
    );
    this.names = { at: Date.now(), map };
    return map;
  }

  /** A console and its other regions' consoles of their own (the Super Nintendo and the Super Famicom), the given one first. */
  private family(platformKey: string): string[] {
    const base = regionalConsole(platformKey)?.base ?? platformKey;
    const keys = [...this.platformNames().keys()];
    return [...new Set([platformKey, base, ...keys.filter((k) => regionalConsole(k)?.base === base)])];
  }

  /** The owner's version of a text, if they wrote or checked one. */
  private note(kind: 'console' | 'game', platformKey: string, titleKey = '') {
    return this.db
      .select()
      .from(historyNotes)
      .where(and(eq(historyNotes.kind, kind), eq(historyNotes.platformKey, platformKey), eq(historyNotes.titleKey, titleKey)))
      .get();
  }

  /**
   * Squirrelcade's "why it matters" for a game on a console (or its base console): by any of its names exactly, else by
   * its own title (the first name) without an edition.
   */
  private shippedGame(platformKey: string, names: readonly string[]): GameSignificance | undefined {
    const consoles = [platformKey, regionalConsole(platformKey)?.base].filter((k): k is string => Boolean(k));
    const exact = [...new Set(names.map((n) => matchKey(n)).filter(Boolean))];
    for (const c of consoles) for (const k of exact) {
      const g = this.shippedExact.get(`${c}|${k}`);
      if (g) return g;
    }
    for (const c of consoles) for (const k of names[0] ? keysOf(names[0]) : []) {
      const g = this.shippedLoose.get(`${c}|${k}`);
      if (g) return g;
    }
    return undefined;
  }

  /** A list's entry for a game: by any of its names exactly, else by its own title (the first name) without an edition. */
  private entryFor(list: Top100List | undefined, names: readonly string[]): Top100Entry | undefined {
    if (!list) return undefined;
    const exact = new Set(names.map((n) => matchKey(n)).filter(Boolean));
    const hit = list.entries.find((e) => [e.title, ...e.altTitles].some((n) => exact.has(matchKey(n))));
    if (hit || !names[0]) return hit;
    const loose = new Set(keysOf(names[0]));
    return list.entries.find((e) => [e.title, ...e.altTitles].some((n) => keysOf(n).some((k) => loose.has(k))));
  }

  /** Why a game matters: the owner's version, else Squirrelcade's; null when there's neither. */
  why(platformKey: string, names: readonly string[]): HistoryText | null {
    const consoles = [platformKey, regionalConsole(platformKey)?.base].filter((k): k is string => Boolean(k));
    const shipped = this.shippedGame(platformKey, names);
    for (const c of consoles) {
      for (const k of [...new Set(names.map((n) => matchKey(n)).filter(Boolean))]) {
        const own = this.note('game', c, k);
        if (!own) continue;
        const data = JSON.parse(own.data) as { text: string };
        return {
          text: data.text,
          sources: JSON.parse(own.sources) as string[],
          status: own.status as HistoryStatus,
          origin: 'yours',
          updatedAt: own.updatedAt,
          newerShipped: Boolean(shipped && own.shippedHash && own.shippedHash !== hash(shipped)),
        };
      }
    }
    return shipped ? { text: shipped.text, sources: shipped.sources, status: shipped.status, origin: 'squirrelcade', updatedAt: null, newerShipped: false } : null;
  }

  /** What the collection has of a listed game, over the console and its other regions' consoles. */
  private owning(
    family: readonly string[],
    names: readonly string[],
    indexes: { catalog: Map<string, Map<string, TargetResult>>; owned: Map<string, OwnedOnConsole> },
  ): Omit<ListGame, 'title' | 'coverId' | 'romm' | 'wishlistRank' | 'preference' | 'onPc' | 'play'> {
    const keys = [...new Set(names.flatMap(keysOf))];
    const copies: ListGame['copies'] = [];
    let owned: ListOwnership = 'missing';
    let catalogTitle: string | null = null;
    let catalogPlatformKey: string | null = null;
    let catalogStatus: string | null = null;
    const maybe = new Set<string>();
    for (const key of family) {
      const on = indexes.owned.get(key);
      const byKey = indexes.catalog.get(key);
      const targets = [...new Set(keys.map((k) => byKey?.get(k)).filter((t): t is TargetResult => Boolean(t)))];
      // The family's first console is this page's, so its catalog wins.
      if (targets[0] && catalogTitle === null) {
        catalogTitle = targets[0].target.title;
        catalogPlatformKey = key;
        catalogStatus = targets[0].status;
      }
      // The catalog's answer when it has the game (its matches count even for a game it leaves out of completion);
      // otherwise the copies with the same title.
      const titles = targets.length > 0 ? targets.flatMap((t) => t.matches.map((m) => m.title)) : keys.flatMap((k) => on?.byKey.get(k) ?? []);
      for (const t of new Set(titles)) {
        const found = on?.copies.get(t);
        if (found) for (const c of found) copies.push({ title: c.title, platform: this.platformName(key), platformKey: key, completeness: c.completeness, sealed: c.sealed, quantity: c.quantity });
        else if (t) copies.push({ title: t, platform: this.platformName(key), platformKey: key, completeness: 'unknown', sealed: false, quantity: 1 });
      }
      if (copies.length > 0) owned = 'owned';
      else if (owned === 'missing' && targets.some((t) => t.status === 'review')) owned = 'review';
      // Copies sharing a longer word that the Review page's test calls look-alikes.
      if (targets.length === 0 && on) {
        const near = new Set(names.flatMap(wordsOf).flatMap((w) => [...(on.byWord.get(w) ?? [])]));
        for (const t of near) if (names.some((n) => similarityReason(n, t) !== null)) maybe.add(t);
      }
    }
    if (owned === 'missing' && maybe.size > 0) owned = 'maybe';
    // Owned on another console than this one's family ("You have it on Nintendo Switch").
    const ownedOn: string[] = [];
    if (owned !== 'owned') {
      for (const [key, on] of indexes.owned) {
        if (!family.includes(key) && keys.some((k) => on.byKey.has(k))) ownedOn.push(this.platformName(key));
      }
    }
    return { owned, copies, maybe: owned === 'owned' ? [] : [...maybe].slice(0, 3), ownedOn, catalogTitle, catalogPlatformKey, catalogStatus };
  }

  /** A listed game with the collection's side, covers, the wishlist's and RomM's. */
  private listGame(
    platformKey: string,
    family: readonly string[],
    names: readonly string[],
    indexes: { catalog: Map<string, Map<string, TargetResult>>; owned: Map<string, OwnedOnConsole> },
    may: Access,
  ): ListGame {
    const title = names[0]!;
    const owning = this.owning(family, names, indexes);
    const name = owning.catalogTitle ?? title;
    const rankKey = `${owning.catalogPlatformKey ?? platformKey}|${normalizeTitle(name)}`;
    const linkUnowned = this.settings.get('sources.rommLinkUnowned');
    const romm = may.romm && (owning.owned === 'owned' || linkUnowned) ? this.deps.romm(platformKey, [...new Set([name, ...names, ...owning.copies.map((c) => c.title)])]) : null;
    return {
      ...owning,
      title,
      coverId: names.map((n) => this.deps.igdb.coverOf(platformKey, n)).find(Boolean) ?? null,
      onPc: may.pc ? [...new Set(names.flatMap((n) => this.deps.pc.ownedOnPc(n)))] : [],
      romm,
      wishlistRank: owning.owned === 'owned' ? null : (this.deps.wishlist.compute().index.get(rankKey)?.rank ?? null),
      preference: this.deps.wishlist.preferenceOf(owning.catalogPlatformKey ?? platformKey, name),
      play: may.play && this.deps.play ? this.deps.play(owning.catalogPlatformKey ?? platformKey, [...new Set([name, ...names, ...owning.copies.map((c) => c.title)])]) : null,
    };
  }

  private indexes(family: readonly string[]) {
    return { catalog: this.titles.catalog(family), owned: this.titles.ownedByConsole() };
  }

  /** The consoles with a Top 100 list and the ones with a history (another region's console takes its base console's), for the pages' tabs. */
  available(): { version: string; top100: string[]; history: string[] } {
    const keys = [...new Set([...this.platformNames().keys(), ...this.lists.keys(), ...this.shippedConsoles.keys()])];
    return {
      version: this.top100.version,
      top100: keys.filter((k) => this.listFor(k)).sort(),
      history: keys.filter((k) => this.consoleHistory(k)).sort(),
    };
  }

  /** A console's Top 100 list, best first, with what the collection has of each game; null when it has none. */
  top100View(platformKey: string, may: Access): Top100View | null {
    const list = this.listFor(platformKey);
    if (!list) return null;
    const family = this.family(platformKey);
    const indexes = this.indexes(family);
    const rows: Top100Row[] = list.entries.map((e) => {
      const names = [e.title, ...e.altTitles];
      const game = names.map((n) => this.deps.igdb.findByKey(platformKey, n)).find(Boolean);
      return {
        ...this.listGame(platformKey, family, names, indexes, may),
        rank: e.rank,
        altTitles: e.altTitles,
        year: e.year,
        developers: game?.developers ?? [],
        publishers: game?.publishers ?? [],
        why: this.why(platformKey, names),
      };
    });
    const count = (f: (r: Top100Row) => boolean) => rows.filter(f).length;
    const rommOn = may.romm && this.deps.rommEnabled();
    return {
      platformKey,
      platform: this.platformName(platformKey),
      listName: list.name,
      version: this.top100.version,
      rows,
      summary: {
        total: rows.length,
        owned: count((r) => r.owned === 'owned'),
        review: count((r) => r.owned === 'review'),
        maybe: count((r) => r.owned === 'maybe'),
        inRomm: rommOn ? count((r) => r.romm !== null) : null,
        ownedInRomm: rommOn ? count((r) => r.owned === 'owned' && r.romm !== null) : null,
        finished: may.play && this.deps.play ? count((r) => r.play?.status === 'beaten' || r.play?.status === 'completed') : null,
      },
      rommUnowned: this.settings.get('sources.rommLinkUnowned'),
    };
  }

  /** How much of each console's Top 100 the collection has, for the consoles given that have a list (Today's Completion). */
  top100Progress(platformKeys: string[]): { platformKey: string; platform: string; owned: number; total: number }[] {
    if (!this.enabled()) return [];
    return platformKeys.flatMap((key) => {
      const view = this.top100View(key, { pc: false, romm: false });
      return view ? [{ platformKey: key, platform: view.platform, owned: view.summary.owned, total: view.summary.total }] : [];
    });
  }

  /** A console's history: the owner's version, else Squirrelcade's. */
  private consoleHistory(platformKey: string): { history: ConsoleHistory; origin: 'squirrelcade' | 'yours'; updatedAt: string | null; newerShipped: boolean } | null {
    const keys = [platformKey, regionalConsole(platformKey)?.base].filter((k): k is string => Boolean(k));
    for (const key of keys) {
      const shipped = this.shippedConsoles.get(key);
      const own = this.note('console', key);
      if (own) {
        const data = JSON.parse(own.data) as { profile: ConsoleProfile; startHere: StartHereGame[]; asOf: string | null };
        return {
          history: { platformKey: key, profile: data.profile, startHere: data.startHere, asOf: data.asOf, sources: JSON.parse(own.sources) as string[], status: own.status as HistoryStatus },
          origin: 'yours',
          updatedAt: own.updatedAt,
          newerShipped: Boolean(shipped && own.shippedHash && own.shippedHash !== hash(shipped)),
        };
      }
      if (shipped) return { history: shipped, origin: 'squirrelcade', updatedAt: null, newerShipped: false };
    }
    return null;
  }

  consoleView(platformKey: string, may: Access): ConsoleHistoryView {
    const found = this.consoleHistory(platformKey);
    const family = this.family(platformKey);
    const indexes = this.indexes(family);
    return {
      platformKey,
      platform: this.platformName(platformKey),
      hasTop100: Boolean(this.listFor(platformKey)),
      history: found
        ? {
            profile: found.history.profile,
            startHere: found.history.startHere.map((s) => {
              const entry = this.entryFor(this.listFor(platformKey), [s.title]);
              return { ...this.listGame(platformKey, family, [s.title, ...(entry?.altTitles ?? [])], indexes, may), why: s.why };
            }),
            sources: found.history.sources,
            status: found.history.status,
            asOf: found.history.asOf,
            origin: found.origin,
            updatedAt: found.updatedAt,
            newerShipped: found.newerShipped,
          }
        : null,
    };
  }

  /** Every console with a history or a Top 100 list, by the year it came out, and each one's landmark games. */
  timeline(): TimelineView {
    const owned = this.titles.ownedByConsole();
    // Your preference for a landmark game you don't have, when a catalog has it (kept under the catalog's title).
    const preferences = this.deps.wishlist.preferences();
    const preferenceOf = (key: string, o: { owned: ListOwnership; catalogTitle: string | null; catalogPlatformKey: string | null }) =>
      o.owned === 'owned' || !o.catalogTitle ? null : (preferences.get(`${o.catalogPlatformKey ?? key}|${normalizeTitle(o.catalogTitle)}`) ?? null);
    const inDb = new Set(this.platformNames().keys());
    const keys = [...new Set([...this.shippedConsoles.keys(), ...this.lists.keys(), ...this.db.select({ key: historyNotes.platformKey }).from(historyNotes).where(eq(historyNotes.kind, 'console')).all().map((r) => r.key)])];
    const perConsole = this.settings.get('interface.timelineGames');
    const consoles: TimelineView['consoles'] = [];
    const games: TimelineView['games'] = [];
    for (const key of keys) {
      const found = this.consoleHistory(key);
      const list = this.lists.get(key);
      const tracked = inDb.has(key) && (owned.has(key) || Boolean(this.titles.catalog([key]).get(key)));
      const profile = found?.history.profile;
      consoles.push({
        platformKey: key,
        name: this.platformName(key),
        manufacturer: profile?.manufacturer ?? null,
        generation: profile?.generation ?? null,
        launched: profile ? firstLaunchYear(profile) : null,
        ended: lastYear(profile?.discontinued ?? null),
        tracked,
        hasHistory: Boolean(found),
        hasTop100: Boolean(list),
      });
      if (perConsole === 0) continue;
      const family = this.family(key);
      const indexes = this.indexes(family);
      const platform = this.platformName(key);
      const picked = new Map<string, TimelineView['games'][number]>();
      for (const e of (list?.entries ?? []).slice(0, perConsole)) {
        if (e.year === null) continue;
        const o = this.owning(family, [e.title, ...e.altTitles], indexes);
        picked.set(matchKey(e.title), { platformKey: key, platform, title: e.title, catalogTitle: o.catalogTitle, catalogPlatformKey: o.catalogPlatformKey, year: e.year, rank: e.rank, startHere: false, owned: o.owned, preference: preferenceOf(key, o) });
      }
      for (const s of found?.history.startHere ?? []) {
        const entry = this.entryFor(list, [s.title]);
        const had = picked.get(matchKey(entry?.title ?? s.title));
        if (had) {
          had.startHere = true;
          continue;
        }
        const year = entry?.year ?? Number(this.deps.igdb.findByKey(key, s.title)?.released?.slice(0, 4) ?? NaN);
        if (!Number.isFinite(year)) continue;
        const o = this.owning(family, [s.title, ...(entry?.altTitles ?? [])], indexes);
        picked.set(matchKey(s.title), { platformKey: key, platform, title: s.title, catalogTitle: o.catalogTitle, catalogPlatformKey: o.catalogPlatformKey, year, rank: entry?.rank ?? null, startHere: true, owned: o.owned, preference: preferenceOf(key, o) });
      }
      games.push(...picked.values());
    }
    consoles.sort((a, b) => (a.launched ?? 9999) - (b.launched ?? 9999) || a.name.localeCompare(b.name));
    games.sort((a, b) => a.year - b.year || (a.rank ?? 999) - (b.rank ?? 999) || a.title.localeCompare(b.title));
    return { consoles, games };
  }

  /** For the game drawer: why the game matters and its Top 100 rank on the console. */
  gameHistory(platformKey: string, names: readonly string[]): GameHistory {
    const list = this.listFor(platformKey);
    const entry = this.entryFor(list, names);
    return {
      why: this.why(platformKey, entry ? [...names, entry.title, ...entry.altTitles] : names),
      top100: entry && list ? { rank: entry.rank, of: list.entries.length } : null,
    };
  }

  /** Saves the owner's version of why a game matters (text null takes theirs back, to Squirrelcade's). */
  saveGame(input: { platformKey: string; title: string; text?: string | null; sources?: unknown; status?: unknown }): HistoryText | null {
    const title = input.title.trim();
    const titleKey = matchKey(title);
    if (!titleKey) throw new HistoryError('Give the game\'s title.');
    const where = and(eq(historyNotes.kind, 'game'), eq(historyNotes.platformKey, input.platformKey), eq(historyNotes.titleKey, titleKey));
    if (input.text === null) {
      this.db.delete(historyNotes).where(where).run();
      return this.why(input.platformKey, [title]);
    }
    const current = this.why(input.platformKey, [title]);
    const text = (input.text ?? current?.text ?? '').trim();
    if (!text) throw new HistoryError('Write why the game matters (a sentence or two).');
    if (text.length > 1000) throw new HistoryError('Keep it to 1,000 characters.');
    const sources = input.sources === undefined ? (current?.sources ?? []) : sourcesSchema.safeParse(input.sources);
    const parsedSources = Array.isArray(sources) ? sources : sources.success ? sources.data : null;
    if (!parsedSources) throw new HistoryError('Sources are web addresses (up to 20).');
    const status = input.status === undefined ? (current?.status ?? 'draft') : input.status;
    if (status !== 'draft' && status !== 'verified') throw new HistoryError('Status is draft or verified.');
    const shipped = this.shippedGame(input.platformKey, [title]);
    const row = { kind: 'game', platformKey: input.platformKey, titleKey, title, data: JSON.stringify({ text }), sources: JSON.stringify(parsedSources), status, shippedHash: shipped ? hash(shipped) : null, updatedAt: new Date().toISOString() };
    this.db.insert(historyNotes).values(row).onConflictDoUpdate({ target: [historyNotes.kind, historyNotes.platformKey, historyNotes.titleKey], set: row }).run();
    this.log.info({ context: 'history' }, `Why ${title} matters (${input.platformKey}): saved, ${status}`);
    return this.why(input.platformKey, [title]);
  }

  /** Saves the owner's version of a console's history (reset takes theirs back, to Squirrelcade's). */
  saveConsole(input: { platformKey: string; profile?: unknown; startHere?: unknown; sources?: unknown; status?: unknown; asOf?: unknown; reset?: boolean }): void {
    const where = and(eq(historyNotes.kind, 'console'), eq(historyNotes.platformKey, input.platformKey), eq(historyNotes.titleKey, ''));
    if (input.reset) {
      this.db.delete(historyNotes).where(where).run();
      return;
    }
    const current = this.consoleHistory(input.platformKey);
    const base = current?.history.platformKey === input.platformKey ? current.history : undefined;
    const empty: ConsoleProfile = { manufacturer: null, generation: null, launches: [], discontinued: null, unitsSold: null, hardware: [], competitors: [], story: null, firsts: [], endOfLife: null };
    const profile = consoleProfileSchema.safeParse(input.profile === undefined ? (base?.profile ?? empty) : input.profile);
    if (!profile.success) throw new HistoryError(`The history isn't valid: ${profile.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    const startHere = startHereSchema.safeParse(input.startHere === undefined ? (base?.startHere ?? []) : input.startHere);
    if (!startHere.success) throw new HistoryError('"Start here" is up to 15 games, each with a title and why.');
    const sources = sourcesSchema.safeParse(input.sources === undefined ? (base?.sources ?? []) : input.sources);
    if (!sources.success) throw new HistoryError('Sources are web addresses (up to 20).');
    const status = input.status === undefined ? (base?.status ?? 'draft') : input.status;
    if (status !== 'draft' && status !== 'verified') throw new HistoryError('Status is draft or verified.');
    const asOf = input.asOf === undefined ? (base?.asOf ?? null) : input.asOf;
    if (asOf !== null && (typeof asOf !== 'string' || !/^\d{4}(-\d{2}(-\d{2})?)?$/.test(asOf))) throw new HistoryError('"As of" is a date: YYYY, YYYY-MM or YYYY-MM-DD.');
    const shipped = this.shippedConsoles.get(input.platformKey);
    const row = {
      kind: 'console',
      platformKey: input.platformKey,
      titleKey: '',
      title: null,
      data: JSON.stringify({ profile: profile.data, startHere: startHere.data, asOf }),
      sources: JSON.stringify(sources.data),
      status,
      shippedHash: shipped ? hash(shipped) : null,
      updatedAt: new Date().toISOString(),
    };
    this.db.insert(historyNotes).values(row).onConflictDoUpdate({ target: [historyNotes.kind, historyNotes.platformKey, historyNotes.titleKey], set: row }).run();
    this.log.info({ context: 'history' }, `History of ${input.platformKey}: saved, ${status}`);
  }
}

/** Top 100 lists, console history and the timeline; the owner's versions of history texts. */
export function registerHistoryRoutes(app: FastifyInstance, history: HistoryService): void {
  const off = { error: 'feature-off', message: 'Top 100 lists and console history are off (Settings > Features).' };

  app.get('/api/v1/history', async (_request, reply) => {
    if (!history.enabled()) return reply.code(404).send(off);
    return history.available();
  });

  app.get('/api/v1/history/top100/:key', async (request, reply) => {
    if (!history.enabled()) return reply.code(404).send(off);
    const { key } = request.params as { key: string };
    const may = shown(request);
    const view = history.top100View(key, { pc: may.pc, romm: may.romm, play: may.play });
    if (!view) return reply.code(404).send({ error: 'not-found', message: 'Squirrelcade has no Top 100 list for this console.' });
    return view;
  });

  app.get('/api/v1/history/consoles/:key', async (request, reply) => {
    if (!history.enabled()) return reply.code(404).send(off);
    const { key } = request.params as { key: string };
    const may = shown(request);
    return history.consoleView(key, { pc: may.pc, romm: may.romm, play: may.play });
  });

  app.get('/api/v1/history/timeline', async (_request, reply) => {
    if (!history.enabled()) return reply.code(404).send(off);
    return history.timeline();
  });

  // The owner's version of why a game matters: text (null: back to Squirrelcade's), sources, status.
  app.put('/api/v1/history/games', async (request, reply) => {
    if (!history.enabled()) return reply.code(404).send(off);
    const b = request.body as { platformKey?: unknown; title?: unknown; text?: unknown; sources?: unknown; status?: unknown } | null;
    if (typeof b?.platformKey !== 'string' || typeof b.title !== 'string' || (b.text !== undefined && b.text !== null && typeof b.text !== 'string')) {
      return reply.code(400).send({ error: 'invalid', message: 'Send platformKey, title, and text (null for Squirrelcade\'s), sources or status.' });
    }
    try {
      return { why: history.saveGame({ platformKey: b.platformKey, title: b.title, text: b.text as string | null | undefined, sources: b.sources, status: b.status }) };
    } catch (err) {
      if (err instanceof HistoryError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });

  // The owner's version of a console's history (reset: back to Squirrelcade's).
  app.put('/api/v1/history/consoles/:key', async (request, reply) => {
    if (!history.enabled()) return reply.code(404).send(off);
    const { key } = request.params as { key: string };
    const b = (request.body ?? {}) as { profile?: unknown; startHere?: unknown; sources?: unknown; status?: unknown; asOf?: unknown; reset?: unknown };
    try {
      history.saveConsole({ platformKey: key, profile: b.profile, startHere: b.startHere, sources: b.sources, status: b.status, asOf: b.asOf, reset: b.reset === true });
      const may = shown(request);
      return history.consoleView(key, { pc: may.pc, romm: may.romm, play: may.play });
    } catch (err) {
      if (err instanceof HistoryError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });
}
