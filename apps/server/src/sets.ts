import {
  KNOWN_PLATFORMS,
  matchKey,
  normalizeTitle,
  parseSetCsv,
  regionalConsole,
  setKey,
  similarityReason,
  toCsv,
  wikiPageTitle,
  wikiSetGames,
  type SetGame,
  type TargetResult,
} from '@squirrelcade/core';
import { and, asc, eq } from 'drizzle-orm';
import { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { gameSets, setEdits, setGames, setLinks } from './db/schema.js';
import { keysOf, wordsOf, type OwnedOnConsole, type TitleIndex } from './titleIndex.js';
import type { WikipediaClient } from './wikipedia.js';

/** A set game's standing: owned, missing, or a look-alike to answer on its console's Review page. */
export type SetGameStatus = 'owned' | 'missing' | 'review';

/** One of a set's games on one console, and how it stands in the collection. */
export interface SetGameResult {
  id: number;
  title: string;
  platformKey: string;
  platform: string;
  status: SetGameStatus;
  /** The owned titles that count as it. */
  ownedAs: string[];
  /** The console's catalog has the game, so its answer (and any review answers) decide; otherwise the title alone does. */
  inCatalog: boolean;
  /** The console catalog's own status when it's neither owned nor missing there (unconfirmed, upcoming, excluded). */
  catalogStatus?: string;
  /** Owned copies on its console that look like it, for a missing game outside the console's catalog (never counted). */
  maybe?: string[];
  /** Owned through the owner's own answer that a look-alike is the same game. */
  linked?: boolean;
  /** For a game not owned here: the other consoles the same title is owned on. */
  ownedOn?: string[];
  /** Added by the owner, not from the set's list. */
  byHand?: boolean;
  notes: string | null;
  /** The console catalog's title for it (when the catalog has it), which preferences are kept under. */
  catalogTitle?: string;
  /** Your wishlist preference for it, for a game the catalog has. */
  preference?: string | null;
}

/** A set with its completion, for the Sets page. */
export interface SetSummary {
  key: string;
  name: string;
  source: 'csv' | 'wikipedia';
  page: string | null;
  collectedOnly: boolean;
  builtAt: string | null;
  message: string | null;
  games: number;
  owned: number;
  review: number;
  percent: number;
  /** Games the owner added by hand, and games of the list they took out. */
  addedByHand: number;
  takenOut: number;
  /** The consoles of the games that count, with their counts. */
  platforms: { key: string; name: string; games: number; owned: number }[];
}

const platformName = (key: string) => KNOWN_PLATFORMS.find((p) => p.key === key)?.name ?? regionalConsole(key)?.name ?? key;

/** Why a set couldn't be made or read. */
export class SetError extends Error {}

/** A set's missing game outside its console's catalog, for Store Mode (which otherwise only knows catalogs and the collection). */
export interface SetGameForStore {
  platformKey: string;
  platform: string;
  title: string;
  sets: string[];
  /** Owned copies on its console that look like it. */
  maybe?: string[];
}

/**
 * Sets: the owner's own named sets of games beyond consoles (a publisher's releases such as Limited Run
 * Games, a series, any theme), from a CSV or a Wikipedia list. Whether a set's game is owned is its console
 * catalog's answer when the catalog has the game (edition rules, mappings and review answers included);
 * otherwise the owned copies on that console are compared by title.
 */
export class SetsService {
  /** Fires when a set or what it's worked out from changed (the wishlist's set points follow). */
  readonly events = new EventEmitter<{ changed: [] }>();
  private storeCache: { at: number; of: Map<string, string[]>; outside: SetGameForStore[] } | null = null;
  /** Your wishlist preferences by "platform key|normalized title" (set by the app), shown with a set's games. */
  private preferences: () => Map<string, string> = () => new Map();

  setPreferences(preferences: () => Map<string, string>): void {
    this.preferences = preferences;
  }

  constructor(
    private readonly db: Db,
    private readonly titles: TitleIndex,
    private readonly wikipedia: WikipediaClient,
    private readonly log: Logger,
  ) {}

  /** Forgets what Store Mode and the wishlist were told (after a set or the collection changes). */
  invalidate(): void {
    this.storeCache = null;
    this.titles.invalidate();
    this.events.emit('changed');
  }

  /**
   * For Store Mode: the sets a game is in (by console and title key), and the sets' missing games that no
   * console catalog has. Worked out again after ten seconds, so a search while typing doesn't redo it.
   */
  private forStore(): { of: Map<string, string[]>; outside: SetGameForStore[] } {
    if (this.storeCache && Date.now() - this.storeCache.at < 10_000) return this.storeCache;
    const indexes = this.indexes();
    const of = new Map<string, string[]>();
    const outside = new Map<string, SetGameForStore>();
    for (const row of this.db.select().from(gameSets).orderBy(asc(gameSets.name)).all()) {
      for (const g of this.results(row.id, row.collectedOnly, indexes)) {
        for (const k of keysOf(g.title)) {
          const id = `${g.platformKey}|${k}`;
          of.set(id, [...new Set([...(of.get(id) ?? []), row.name])]);
        }
        if (g.inCatalog || g.status !== 'missing') continue;
        const id = `${g.platformKey}|${matchKey(g.title)}`;
        const game = outside.get(id) ?? { platformKey: g.platformKey, platform: g.platform, title: g.title, sets: [], ...(g.maybe ? { maybe: g.maybe } : {}) };
        game.sets = [...new Set([...game.sets, row.name])];
        outside.set(id, game);
      }
    }
    this.storeCache = { at: Date.now(), of, outside: [...outside.values()] };
    return this.storeCache;
  }

  /** The names of the sets a game on a console is in, by any of its titles. */
  setsOf(platformKey: string, titles: string[]): string[] {
    const { of } = this.forStore();
    return [...new Set(titles.flatMap(keysOf).flatMap((k) => of.get(`${platformKey}|${k}`) ?? []))];
  }

  /** The sets' missing games that no console catalog has. */
  missingOutsideCatalogs(): SetGameForStore[] {
    return this.forStore().outside;
  }

  /** The consoles' catalog games (only the consoles sets use) and the collection's copies, for working out sets. */
  private indexes(setId?: number): { catalog: Map<string, Map<string, TargetResult>>; owned: Map<string, OwnedOnConsole> } {
    const keys = this.db
      .selectDistinct({ key: setGames.platformKey })
      .from(setGames)
      .where(setId === undefined ? undefined : eq(setGames.setId, setId))
      .all()
      .map((r) => r.key);
    return { catalog: this.titles.catalog(keys), owned: this.titles.ownedByConsole() };
  }

  /** A set's games: its list, plus the games the owner added by hand, less the ones they took out. */
  private gamesOf(setId: number): { id: number; title: string; platformKey: string; altTitles: string | null; notes: string | null; byHand: boolean }[] {
    const edits = this.db.select().from(setEdits).where(eq(setEdits.setId, setId)).all();
    const out = new Set(edits.filter((e) => e.action === 'remove').map((e) => `${e.platformKey}|${matchKey(e.title)}`));
    const listed = this.db
      .select()
      .from(setGames)
      .where(eq(setGames.setId, setId))
      .all()
      .map((g) => ({ ...g, byHand: false }));
    // A game added by hand has the edit's id, negative so it's never a list row's.
    const added = edits.filter((e) => e.action === 'add').map((e) => ({ id: -e.id, title: e.title, platformKey: e.platformKey, altTitles: null, notes: null, byHand: true }));
    return [...listed, ...added].filter((g) => !out.has(`${g.platformKey}|${matchKey(g.title)}`)).sort((a, b) => a.title.localeCompare(b.title));
  }

  private results(setId: number, collectedOnly: boolean, indexes = this.indexes(setId)): SetGameResult[] {
    const rows = this.gamesOf(setId);
    // The owner's answers about look-alikes, by console and title key.
    const links = new Map<string, { same: string[]; different: Set<string> }>();
    for (const l of this.db.select().from(setLinks).where(eq(setLinks.setId, setId)).all()) {
      const k = `${l.platformKey}|${l.titleKey}`;
      const entry = links.get(k) ?? { same: [], different: new Set<string>() };
      if (l.decision === 'same') entry.same.push(l.ownedTitle);
      else entry.different.add(l.ownedTitle);
      links.set(k, entry);
    }
    const out: SetGameResult[] = [];
    const preferences = this.preferences();
    for (const g of rows) {
      if (collectedOnly && !indexes.owned.has(g.platformKey)) continue;
      const names = [g.title, ...(g.altTitles ? (JSON.parse(g.altTitles) as string[]) : [])];
      const keys = names.flatMap(keysOf);
      const base = { id: g.id, title: g.title, platformKey: g.platformKey, platform: platformName(g.platformKey), notes: g.notes, ...(g.byHand ? { byHand: true } : {}) };
      const target = keys.map((k) => indexes.catalog.get(g.platformKey)?.get(k)).find(Boolean);
      if (target) {
        const status: SetGameStatus = target.status === 'owned' ? 'owned' : target.status === 'review' ? 'review' : 'missing';
        out.push({
          ...base,
          status,
          ownedAs: target.matches.map((m) => m.title),
          inCatalog: true,
          catalogTitle: target.target.title,
          preference: preferences.get(`${g.platformKey}|${normalizeTitle(target.target.title)}`) ?? null,
          ...(target.status !== status ? { catalogStatus: target.status } : {}),
        });
        continue;
      }
      const on = indexes.owned.get(g.platformKey);
      const owned = [...new Set(keys.flatMap((k) => on?.byKey.get(k) ?? []))];
      if (owned.length > 0 || !on) {
        out.push({ ...base, status: owned.length > 0 ? 'owned' : 'missing', ownedAs: owned, inCatalog: false });
        continue;
      }
      // The owner said a copy is this game (and it's still in the collection).
      const answers = links.get(`${g.platformKey}|${matchKey(g.title)}`);
      const said = (answers?.same ?? []).filter((t) => on.titles.has(t));
      if (said.length > 0) {
        out.push({ ...base, status: 'owned', ownedAs: said, inCatalog: false, linked: true });
        continue;
      }
      // Copies sharing a longer word, then the Review page's look-alike test ("9th Dawn III" / "9th Dawn III: Shadow of Erthil").
      const near = new Set(names.flatMap(wordsOf).flatMap((w) => [...(on.byWord.get(w) ?? [])]));
      const maybe = [...near].filter((t) => !answers?.different.has(t) && names.some((n) => similarityReason(n, t) !== null)).slice(0, 3);
      out.push({ ...base, status: 'missing', ownedAs: [], inCatalog: false, ...(maybe.length > 0 ? { maybe } : {}) });
    }
    // A game not owned here that's owned on another console says where ("You have it on Nintendo Switch").
    for (const r of out) {
      if (r.status === 'owned') continue;
      const keys = keysOf(r.title);
      const on = [...indexes.owned.entries()].filter(([key, c]) => key !== r.platformKey && keys.some((k) => c.byKey.has(k))).map(([key]) => platformName(key));
      if (on.length > 0) r.ownedOn = on;
    }
    return out;
  }

  private summary(row: typeof gameSets.$inferSelect, games: SetGameResult[]): SetSummary {
    const owned = games.filter((g) => g.status === 'owned').length;
    const edits = this.db.select({ action: setEdits.action }).from(setEdits).where(eq(setEdits.setId, row.id)).all();
    const byPlatform = new Map<string, SetSummary['platforms'][number]>();
    for (const g of games) {
      const p = byPlatform.get(g.platformKey) ?? { key: g.platformKey, name: g.platform, games: 0, owned: 0 };
      p.games++;
      if (g.status === 'owned') p.owned++;
      byPlatform.set(g.platformKey, p);
    }
    return {
      key: row.key,
      name: row.name,
      source: row.source as SetSummary['source'],
      page: row.page,
      collectedOnly: row.collectedOnly,
      builtAt: row.builtAt,
      message: row.message,
      games: games.length,
      owned,
      review: games.filter((g) => g.status === 'review').length,
      percent: games.length === 0 ? 0 : Math.round((owned / games.length) * 1000) / 10,
      addedByHand: edits.filter((e) => e.action === 'add').length,
      takenOut: edits.filter((e) => e.action === 'remove').length,
      platforms: [...byPlatform.values()].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name)),
    };
  }

  list(): SetSummary[] {
    const indexes = this.indexes();
    return this.db
      .select()
      .from(gameSets)
      .orderBy(asc(gameSets.name))
      .all()
      .map((row) => this.summary(row, this.results(row.id, row.collectedOnly, indexes)));
  }

  detail(key: string): { set: SetSummary; games: SetGameResult[] } | null {
    const row = this.db.select().from(gameSets).where(eq(gameSets.key, key)).get();
    if (!row) return null;
    const games = this.results(row.id, row.collectedOnly);
    return { set: this.summary(row, games), games };
  }

  /** Makes a set; one from a Wikipedia list is read right away, one from a CSV waits for its file (setList). */
  async create(input: { name: string; page?: string | null; collectedOnly?: boolean }): Promise<{ set: SetSummary; message: string }> {
    const name = input.name.trim();
    if (!name) throw new SetError('Give the set a name.');
    if (name.length > 100 || (input.page ?? '').length > 300) throw new SetError('The name (100 characters at most) or the Wikipedia page (300) is too long.');
    let key = setKey(name);
    for (let i = 2; this.db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.key, key)).get(); i++) key = `${setKey(name)}-${i}`;
    const page = input.page?.trim() ? wikiPageTitle(input.page) : null;
    const read = page ? await this.readWikipedia(page) : null;
    const row = this.db
      .insert(gameSets)
      .values({ key, name, source: page ? 'wikipedia' : 'csv', page, collectedOnly: input.collectedOnly ?? true, createdAt: new Date().toISOString() })
      .returning()
      .get();
    const message = read ? this.replaceGames(row.id, read.games, read.message) : 'Upload the set\'s list (a CSV with Title and Platform columns), or add its games by hand.';
    this.invalidate();
    this.log.info({ context: 'sets' }, `Set "${name}" made: ${message}`);
    return { set: this.detail(key)!.set, message };
  }

  private async readWikipedia(page: string): Promise<{ games: SetGame[]; message: string }> {
    const found = await this.wikipedia.pageHtml(page);
    if (!found) throw new SetError(`Wikipedia has no page named "${page}".`);
    const { games, skipped } = wikiSetGames(found.html);
    if (games.length === 0) throw new SetError(`"${found.title}" has no table of games with their consoles that Squirrelcade can read.`);
    return { games, message: `${games.length} games from Wikipedia's "${found.title}"${skipped > 0 ? `; ${skipped} without a console Squirrelcade knows (PC games, or no console in the list) left out` : ''}.` };
  }

  /** Replaces a set's games (a game on several consoles becomes one row per console). */
  private replaceGames(setId: number, games: SetGame[], message: string): string {
    this.db.transaction((tx) => {
      tx.delete(setGames).where(eq(setGames.setId, setId)).run();
      for (const g of games) {
        for (const platformKey of g.platforms) {
          tx.insert(setGames)
            .values({ setId, title: g.title, platformKey, altTitles: g.altTitles?.length ? JSON.stringify(g.altTitles) : null, notes: g.notes ?? null })
            .run();
        }
      }
      tx.update(gameSets).set({ builtAt: new Date().toISOString(), message }).where(eq(gameSets.id, setId)).run();
    });
    this.invalidate();
    return message;
  }

  /** Replaces a set's games from a CSV (Title and Platform columns); null when there's no such set. */
  setList(key: string, csv: string): { message: string; problems: string[] } | null {
    const row = this.db.select().from(gameSets).where(eq(gameSets.key, key)).get();
    if (!row) return null;
    const { games, problems } = parseSetCsv(csv);
    if (games.length === 0) throw new SetError(problems.join(' '));
    const message = this.replaceGames(row.id, games, `${games.length} games from your list.${problems.length > 0 ? ` ${problems.join(' ')}` : ''}`);
    this.db.update(gameSets).set({ source: 'csv', page: null }).where(eq(gameSets.id, row.id)).run();
    return { message, problems };
  }

  /** Reads a Wikipedia set's page again; null when there's no such set. */
  async rebuild(key: string): Promise<string | null> {
    const row = this.db.select().from(gameSets).where(eq(gameSets.key, key)).get();
    if (!row) return null;
    if (!row.page) throw new SetError('This set comes from your own list: upload a new file instead.');
    const read = await this.readWikipedia(row.page);
    return this.replaceGames(row.id, read.games, read.message);
  }

  /**
   * The owner's answer about a set game and an owned copy that looks like it: the same game (it counts), not
   * the same (it's no longer suggested), or null to take the answer back. False when there's no such set.
   */
  answer(key: string, input: { platformKey: string; title: string; ownedTitle: string; decision: 'same' | 'different' | null }): boolean {
    const set = this.db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.key, key)).get();
    if (!set) return false;
    const where = and(eq(setLinks.setId, set.id), eq(setLinks.platformKey, input.platformKey), eq(setLinks.titleKey, matchKey(input.title)), eq(setLinks.ownedTitle, input.ownedTitle));
    this.db.transaction((tx) => {
      tx.delete(setLinks).where(where).run();
      if (input.decision) tx.insert(setLinks).values({ setId: set.id, platformKey: input.platformKey, titleKey: matchKey(input.title), ownedTitle: input.ownedTitle, decision: input.decision }).run();
    });
    this.invalidate();
    return true;
  }

  /**
   * Adds a game to a set by hand (bringing it back if it was taken out), or takes one out: a game added by
   * hand is simply dropped, a game of the list is left out until brought back. False when there's no such set.
   */
  editGame(key: string, input: { platformKey: string; title: string; action: 'add' | 'remove' }): boolean {
    const set = this.db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.key, key)).get();
    if (!set) return false;
    const title = input.title.trim();
    if (!title || title.length > 300 || !KNOWN_PLATFORMS.some((p) => p.key === input.platformKey)) throw new SetError('Give the game\'s title (300 characters at most) and one of Squirrelcade\'s consoles.');
    const same = (e: { platformKey: string; title: string }) => e.platformKey === input.platformKey && matchKey(e.title) === matchKey(title);
    const edits = this.db.select().from(setEdits).where(eq(setEdits.setId, set.id)).all().filter(same);
    this.db.transaction((tx) => {
      for (const e of edits) tx.delete(setEdits).where(eq(setEdits.id, e.id)).run();
      const listed = tx
        .select({ title: setGames.title, platformKey: setGames.platformKey })
        .from(setGames)
        .where(eq(setGames.setId, set.id))
        .all()
        .some(same);
      // Adding a game of the list only needs its "taken out" gone; taking out a hand-added game only needs its "added" gone.
      if (input.action === 'add' && !listed) tx.insert(setEdits).values({ setId: set.id, platformKey: input.platformKey, title, action: 'add' }).run();
      if (input.action === 'remove' && listed) tx.insert(setEdits).values({ setId: set.id, platformKey: input.platformKey, title, action: 'remove' }).run();
    });
    this.invalidate();
    return true;
  }

  /** Brings back every game of the list that was taken out; false when there's no such set. */
  restoreTakenOut(key: string): boolean {
    const set = this.db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.key, key)).get();
    if (!set) return false;
    this.db.delete(setEdits).where(and(eq(setEdits.setId, set.id), eq(setEdits.action, 'remove'))).run();
    this.invalidate();
    return true;
  }

  update(key: string, change: { name?: string; collectedOnly?: boolean }): boolean {
    const set: Partial<typeof gameSets.$inferInsert> = {};
    if (typeof change.name === 'string' && change.name.trim()) set.name = change.name.trim().slice(0, 100);
    if (typeof change.collectedOnly === 'boolean') set.collectedOnly = change.collectedOnly;
    if (Object.keys(set).length === 0) return this.db.select({ id: gameSets.id }).from(gameSets).where(eq(gameSets.key, key)).get() !== undefined;
    this.invalidate();
    return this.db.update(gameSets).set(set).where(eq(gameSets.key, key)).run().changes > 0;
  }

  remove(key: string): boolean {
    this.invalidate();
    return this.db.delete(gameSets).where(eq(gameSets.key, key)).run().changes > 0;
  }
}

/** Sets: list, make (from a Wikipedia list, or then a CSV), read, change, read again, remove, download. */
export function registerSetRoutes(app: FastifyInstance, sets: SetsService): void {
  const failed = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) => {
    if (err instanceof SetError) return reply.code(400).send({ error: 'invalid-set', message: err.message });
    throw err;
  };

  app.get('/api/v1/sets', async () => sets.list());

  /** { name, page?: a Wikipedia list's title or address, collectedOnly?: true }. Without a page, upload the list next (PUT .../list). */
  app.post('/api/v1/sets', async (request, reply) => {
    const body = (request.body ?? {}) as { name?: unknown; page?: unknown; collectedOnly?: unknown };
    try {
      const made = await sets.create({ name: String(body.name ?? ''), page: typeof body.page === 'string' ? body.page : null, collectedOnly: body.collectedOnly !== false });
      return reply.code(201).send(made);
    } catch (err) {
      return failed(reply, err);
    }
  });

  app.get('/api/v1/sets/:key', async (request, reply) => {
    const detail = sets.detail((request.params as { key: string }).key);
    if (!detail) return reply.code(404).send({ error: 'not-found', message: 'No such set.' });
    return detail;
  });

  app.put('/api/v1/sets/:key/list', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no-file', message: 'Choose the CSV file of the set.' });
    try {
      const saved = sets.setList((request.params as { key: string }).key, (await file.toBuffer()).toString('utf8'));
      if (!saved) return reply.code(404).send({ error: 'not-found', message: 'No such set.' });
      return saved;
    } catch (err) {
      return failed(reply, err);
    }
  });

  app.post('/api/v1/sets/:key/rebuild', async (request, reply) => {
    try {
      const message = await sets.rebuild((request.params as { key: string }).key);
      if (message === null) return reply.code(404).send({ error: 'not-found', message: 'No such set.' });
      return { message };
    } catch (err) {
      return failed(reply, err);
    }
  });

  /** { platformKey, title, ownedTitle, decision: "same" | "different" | null }: your answer about a set game and an owned look-alike. */
  app.put('/api/v1/sets/:key/answers', async (request, reply) => {
    const body = (request.body ?? {}) as { platformKey?: unknown; title?: unknown; ownedTitle?: unknown; decision?: unknown };
    const decision = body.decision === null ? null : body.decision === 'same' || body.decision === 'different' ? body.decision : undefined;
    if (typeof body.platformKey !== 'string' || typeof body.title !== 'string' || typeof body.ownedTitle !== 'string' || decision === undefined) {
      return reply.code(400).send({ error: 'invalid', message: 'platformKey, title and ownedTitle are text; decision is "same", "different" or null.' });
    }
    if (!sets.answer((request.params as { key: string }).key, { platformKey: body.platformKey, title: body.title, ownedTitle: body.ownedTitle, decision })) {
      return reply.code(404).send({ error: 'not-found', message: 'No such set.' });
    }
    return { ok: true };
  });

  /** { platformKey, title, action: "add" | "remove" }: a game added to the set by hand, or taken out of it. */
  app.post('/api/v1/sets/:key/games', async (request, reply) => {
    const body = (request.body ?? {}) as { platformKey?: unknown; title?: unknown; action?: unknown };
    if (typeof body.platformKey !== 'string' || typeof body.title !== 'string' || (body.action !== 'add' && body.action !== 'remove')) {
      return reply.code(400).send({ error: 'invalid', message: 'platformKey and title are text; action is "add" or "remove".' });
    }
    try {
      if (!sets.editGame((request.params as { key: string }).key, { platformKey: body.platformKey, title: body.title, action: body.action })) {
        return reply.code(404).send({ error: 'not-found', message: 'No such set.' });
      }
      return { ok: true };
    } catch (err) {
      return failed(reply, err);
    }
  });

  /** Brings back the games of the set's list that were taken out. */
  app.post('/api/v1/sets/:key/restore', async (request, reply) => {
    if (!sets.restoreTakenOut((request.params as { key: string }).key)) return reply.code(404).send({ error: 'not-found', message: 'No such set.' });
    return { ok: true };
  });

  app.patch('/api/v1/sets/:key', async (request, reply) => {
    const body = (request.body ?? {}) as { name?: string; collectedOnly?: boolean };
    if (!sets.update((request.params as { key: string }).key, body)) return reply.code(404).send({ error: 'not-found', message: 'No such set.' });
    return { ok: true };
  });

  app.delete('/api/v1/sets/:key', async (request, reply) => {
    if (!sets.remove((request.params as { key: string }).key)) return reply.code(404).send({ error: 'not-found', message: 'No such set.' });
    return { ok: true };
  });

  /** The set's games as CSV: ?status=missing (or owned, review) for just those. */
  app.get('/api/v1/sets/:key/export', async (request, reply) => {
    const { key } = request.params as { key: string };
    const detail = sets.detail(key);
    if (!detail) return reply.code(404).send({ error: 'not-found', message: 'No such set.' });
    const status = (request.query as { status?: string }).status;
    const rows = detail.games.filter((g) => !status || g.status === status).map((g) => [g.title, g.platform, g.status, g.ownedAs.join('; '), g.notes ?? '']);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${key}${status ? `-${status}` : ''}.csv"`)
      .send(toCsv([['Title', 'Platform', 'Status', 'Owned as', 'Notes'], ...rows]));
  });
}
