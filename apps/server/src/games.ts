import { baseTitle, editionBase, matchKey, normalizeTitle, type ScoreComponent } from '@squirrelcade/core';
import { asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { shown } from './access.js';
import type { CatalogService, RommLinker } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { CopyDetail, CopyDetailsService, CopyTest, Loan, PhotoInfo } from './copyDetails.js';
import type { CopyCareService } from './copyCare.js';
import type { Db } from './db/index.js';
import { catalogEntries, copies, gameSets, platforms } from './db/schema.js';
import type { GameHistory, HistoryService } from './history.js';
import type { IgdbService } from './igdb.js';
import { NOTE_MAX, type NotesService } from './notes.js';
import type { PcService } from './pc.js';
import type { Play, PlayService } from './play.js';
import type { RommLink } from './romm.js';
import type { SettingsService } from './settings.js';
import type { SetsService } from './sets.js';
import type { WishlistService } from './wishlist.js';
import type { RaGame } from './retroachievements.js';
import type { AchievementView } from './achievements.js';

/** Everything Squirrelcade knows about one game on one console, for the game drawer (GET /api/v1/game). */
export interface GameView {
  platformKey: string;
  platform: string;
  title: string;
  coverId: string | null;
  /** IGDB's details, when its data for the console is in. */
  igdb: { name: string; genres: string[]; franchise: string | null; released: string | null; rating: number | null; ratingCount: number | null; gameType: string | null } | null;
  /** The console catalog's game, when the catalog has it: its status and the owned copies that count. */
  catalog: {
    entryId: number;
    title: string;
    /** Its place in the console's completion: owned, missing, review, excluded, unconfirmed or upcoming. */
    status: string;
    /** What the catalog makes of it (required, optional, review, excluded or unconfirmed): your choice, or else its source's. */
    targetStatus: string;
    /** The target status is your choice ("It's a target", "Not a target", "It's physical"). */
    yourChoice: boolean;
    releaseDate: string | null;
    format: string | null;
    source: string;
    notes: string | null;
    matches: { productId: string; title: string; method: string }[];
    suggestions: { productId: string; title: string; reason: string }[];
    /** Your "I bought it" mark, until an export includes the game. */
    purchase: { id: number; createdAt: string } | null;
  } | null;
  /** The copies on this console in the current collection, and how each counts as the catalog's game (null: it doesn't). */
  copies: {
    productId: string;
    title: string;
    consoleLabel: string;
    region: string;
    completeness: string;
    quantity: number;
    valueCents: number | null;
    costCents: number | null;
    dateEntered: string | null;
    countsAs: string | null;
    /** PriceCharting's condition ("Item, Box, and Manual"), which the value is for. */
    includeString: string;
    /** Its value at each collection update that changed it, oldest first. */
    history: { date: string; cents: number }[];
    /** The copy (a product in one condition), for its details, loans and photos. */
    copyKey: string;
    /** Where it's kept, tags, for sale (with copies' details shown). */
    details: CopyDetail | null;
    /** Its loans not given back yet. */
    loans: Loan[];
    photos: PhotoInfo[];
  }[];
  /** What the owner played of it (with that shown): status, rating and days. */
  play: Play | null;
  /** Other consoles the same title is owned on. */
  ownedOn: string[];
  /** The same game in the PC library: each storefront, how it counts, and playtime. */
  pc: { storefront: string; ownership: string; playtimeHours: number }[];
  /** The owner's sets the game is in, with the key of each set's page. */
  sets: { key: string; name: string }[];
  /** Why it isn't on the wishlist, when it's missing and left off (hidden, a price limit, a preference, its release class, a Review question). */
  wishlistNote: string | null;
  /** Its wishlist score with every point, when it's a candidate (missing and not hidden). */
  wishlist: { score: number; rank: number | null; priority: string; components: ScoreComponent[] } | null;
  /** Your wishlist preference for it (even one that keeps it off the wishlist, "Do Not Recommend"). */
  preference: string | null;
  /** The wishlist leaves it out until this day (YYYY-MM-DD). */
  snoozedUntil: string | null;
  romm: RommLink | null;
  /** Your own note on the game, and when you last changed it. */
  note: { text: string; updatedAt: string } | null;
  /** Why the game matters and its place in the console's Top 100 list (null with Top 100 lists and history off). */
  history: GameHistory | null;
  /** Your RetroAchievements progress on it (with RetroAchievements on, and what you played shown). */
  retroAchievements: RaGame | null;
  /** Your progress on it on Xbox and PlayStation (with those parts on, and what you played shown). */
  achievements: AchievementView[];
}

/** The console catalog's game with this title (or another name of it, or an edition of it), if the catalog has it. */
export function catalogTarget(catalogs: CatalogService, platformKey: string, title: string) {
  const keys = new Set([matchKey(title), matchKey(baseTitle(title)), matchKey(editionBase(title))].filter(Boolean));
  return catalogs.matchOf(platformKey)?.targets.find((t) => [t.target.title, ...(t.target.altTitles ?? [])].some((n) => keys.has(matchKey(n))));
}

/** The game drawer's data: one game on one console, from the catalogs, the collection, the wishlist, IGDB, the PC library, sets and RomM. */
export function registerGameRoutes(
  app: FastifyInstance,
  deps: {
    db: Db;
    settings: SettingsService;
    catalogs: CatalogService;
    collection: CollectionService;
    wishlist: WishlistService;
    igdb: IgdbService;
    pc: PcService;
    sets: SetsService;
    romm: RommLinker;
    notes: NotesService;
    history: HistoryService;
    play: PlayService;
    details: CopyDetailsService;
    /** Standard photos and estimates (copyCare.ts). */
    care?: CopyCareService;
    /** RetroAchievements' progress for a game by its console and titles (null without it). */
    ra?: (platformKey: string, titles: string[]) => RaGame | null;
    /** Xbox's and PlayStation's progress for a game by its console and titles. */
    achievements?: (platformKey: string, titles: string[]) => AchievementView[];
  },
): void {
  const { db } = deps;
  const catalogGame = (key: string, title: string) => catalogTarget(deps.catalogs, key, title);

  app.get('/api/v1/game', async (request, reply) => {
    const { platform: key, title } = request.query as { platform?: string; title?: string };
    if (!key || !title?.trim()) return reply.code(400).send({ error: 'invalid', message: 'Give a platform (its key) and a title.' });
    const p = db.select().from(platforms).where(eq(platforms.key, key)).get();
    if (!p) return reply.code(404).send({ error: 'not-found', message: 'No such platform.' });
    const keys = new Set([matchKey(title), matchKey(baseTitle(title)), matchKey(editionBase(title))].filter(Boolean));
    const same = (t: string) => keys.has(matchKey(t)) || keys.has(matchKey(baseTitle(t)));

    // The catalog's game (by its title or another name) and its row.
    const target = catalogGame(key, title);
    const entry = target ? db.select().from(catalogEntries).where(eq(catalogEntries.id, target.target.id)).get() : undefined;
    const name = target?.target.title ?? title.trim();

    // The copies here: the ones the catalog counts, or the same title.
    const counted = new Set(target?.matches.map((m) => m.productId) ?? []);
    const items = db.select().from(copies).where(isNull(copies.goneAt)).orderBy(asc(copies.id)).all();
    const byPlatform = new Map(db.select({ id: platforms.id, name: platforms.name }).from(platforms).all().map((x) => [x.id, x.name]));
    const here = items.filter((i) => i.platformId === p.id && (counted.has(i.productId) || same(i.title)));
    const ownedOn = [...new Set(items.filter((i) => i.platformId !== p.id && same(i.title)).map((i) => (i.platformId === null ? '' : (byPlatform.get(i.platformId) ?? ''))))].filter(Boolean);

    const g = deps.igdb.find(p.id, name);
    const scored = deps.wishlist.compute();
    const candidate = scored.all.get(`${key}|${normalizeTitle(name)}`);
    const rank = scored.index.get(`${key}|${normalizeTitle(name)}`)?.rank ?? null;
    const family = deps.pc.familyOf(name);
    const methods = new Map(target?.matches.map((m) => [m.productId, m.method]) ?? []);
    const prices = deps.collection.priceHistory(here.map((i) => ({ productId: i.productId, includeString: i.includeString })));
    const purchase = entry ? deps.catalogs.pendingPurchases().find((b) => b.entryId === entry.id) : undefined;
    const snooze = deps.wishlist.snoozed().find((z) => z.platformKey === key && normalizeTitle(z.title) === normalizeTitle(name));
    const setKeys = new Map(db.select({ key: gameSets.key, name: gameSets.name }).from(gameSets).all().map((s) => [s.name, s.key]));
    const may = shown(request);
    const details = may.details ? deps.details.index() : null;

    const view: GameView = {
      platformKey: key,
      platform: p.name,
      title: name,
      coverId: deps.igdb.coverOf(key, name),
      igdb: g ? { name: g.name, genres: g.genres, franchise: g.franchise, released: g.released, rating: g.rating ?? null, ratingCount: g.ratingCount ?? null, gameType: g.gameType } : null,
      catalog:
        target && entry
          ? {
              entryId: entry.id,
              title: entry.title,
              status: target.status,
              targetStatus: entry.userStatus ?? entry.targetStatus,
              yourChoice: entry.userStatus !== null,
              releaseDate: entry.releaseDate,
              format: entry.format,
              source: entry.source,
              notes: entry.notes,
              matches: target.matches.map((m) => ({ productId: m.productId, title: m.title, method: m.method })),
              suggestions: target.suggestions.map((s) => ({ productId: s.productId, title: s.title, reason: s.reason })),
              purchase: purchase ? { id: purchase.id, createdAt: purchase.createdAt } : null,
            }
          : null,
      copies: here.map((i) => ({
        id: i.id,
        productId: i.productId,
        title: i.title,
        consoleLabel: i.consoleLabel,
        region: i.region,
        completeness: i.completeness,
        quantity: i.quantity,
        valueCents: i.valueCents,
        costCents: i.costCents,
        dateEntered: i.dateEntered,
        countsAs: methods.get(i.productId) ?? null,
        includeString: i.includeString,
        history: prices.get(`${i.productId}|${i.includeString}`) ?? [],
        copyKey: i.key,
        source: i.source,
        missingSince: i.missingSince,
        sentAt: i.sentAt,
        datePurchased: i.datePurchased,
        notes: i.notes,
        details: details?.get(i.key) ?? null,
        loans: details ? deps.details.of(i.key).loans.filter((l) => l.returnedAt === null) : [],
        photos: details ? deps.details.photos(i.key) : [],
        // Its standard photos, its tests (the newest first), and the owner's estimate of a price they don't know.
        slots: deps.care ? deps.care.slotsOf(i, key) : [],
        tests: details ? deps.details.tests(i.key) : ([] as CopyTest[]),
        estimatedCents: may.paid ? i.estimatedCents : null,
      })),
      ownedOn,
      pc: (family?.records ?? []).map((r) => ({ storefront: r.storefront, ownership: r.ownership, playtimeHours: Math.round((r.playtimeSeconds / 3600) * 10) / 10 })),
      sets: deps.sets.setsOf(key, [name, ...(target?.target.altTitles ?? [])]).map((n) => ({ key: setKeys.get(n) ?? '', name: n })),
      wishlist: candidate ? { score: candidate.score, rank, priority: candidate.priority, components: candidate.components } : null,
      preference: deps.wishlist.preferenceOf(key, name),
      wishlistNote:
        scored.offList.get(`${key}|${normalizeTitle(name)}`) ??
        (target?.status === 'review' ? 'Recommended once its Review question is answered.' : null),
      snoozedUntil: snooze?.until ?? null,
      // RomM links owned games; games you don't own only when Settings > Sources > RomM says so.
      romm: here.length > 0 || deps.settings.get('sources.rommLinkUnowned') ? deps.romm(key, [...new Set([name, title, ...here.map((i) => i.title)])]) : null,
      note: deps.notes.of(key, [name, title]),
      history: deps.history.enabled() ? deps.history.gameHistory(key, [...new Set([name, title, ...(target?.target.altTitles ?? [])])]) : null,
      play: may.play ? deps.play.of(key, [...new Set([name, title, ...here.map((i) => i.title)])]) : null,
      retroAchievements: may.play && deps.ra ? deps.ra(key, [...new Set([name, title, ...here.map((i) => i.title), ...(target?.target.altTitles ?? [])])]) : null,
      achievements: may.play && deps.achievements ? deps.achievements(key, [...new Set([name, title, ...here.map((i) => i.title), ...(target?.target.altTitles ?? [])])]) : [],
    };
    // A viewer sees what's shared with them (Settings > Security > Viewers).
    return {
      ...view,
      copies: may.paid ? view.copies : view.copies.map((c) => ({ ...c, costCents: null })),
      note: may.notes ? view.note : null,
      romm: may.romm ? view.romm : null,
    };
  });

  // Your notes: every one, newest first (the Your notes page, and the mark next to a game's title).
  app.get('/api/v1/game/notes', async (request) => (shown(request).notes ? deps.notes.list() : []));

  // Saves your note on a game (under the catalog's title when the catalog has it); an empty note removes it.
  app.put('/api/v1/game/note', async (request, reply) => {
    const b = request.body as { platformKey?: unknown; title?: unknown; note?: unknown } | null;
    if (typeof b?.platformKey !== 'string' || typeof b.title !== 'string' || !b.title.trim() || (b.note !== null && typeof b.note !== 'string')) {
      return reply.code(400).send({ error: 'invalid', message: 'Send platformKey, title and note (or null to remove it).' });
    }
    if (typeof b.note === 'string' && b.note.trim().length > NOTE_MAX) {
      return reply.code(400).send({ error: 'invalid', message: `A note holds up to ${NOTE_MAX} characters.` });
    }
    const name = catalogGame(b.platformKey, b.title)?.target.title ?? b.title.trim();
    if (!deps.notes.set(b.platformKey, [name, b.title], b.note as string | null)) return reply.code(404).send({ error: 'not-found', message: 'No such platform.' });
    return { ok: true, title: name };
  });

  // IGDB's summary of the game, asked for separately so the drawer doesn't wait on IGDB.
  app.get('/api/v1/game/summary', async (request, reply) => {
    const { platform: key, title } = request.query as { platform?: string; title?: string };
    if (!key || !title?.trim()) return reply.code(400).send({ error: 'invalid', message: 'Give a platform (its key) and a title.' });
    const p = db.select().from(platforms).where(eq(platforms.key, key)).get();
    if (!p) return reply.code(404).send({ error: 'not-found', message: 'No such platform.' });
    const target = catalogGame(key, title);
    const game = deps.igdb.find(p.id, target?.target.title ?? title.trim());
    return { summary: game ? await deps.igdb.summaryOf(game.id) : null };
  });
}

