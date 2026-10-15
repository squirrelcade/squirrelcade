import { normalizeBarcode, normalizeTitle } from '@squirrelcade/core';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { shown } from './access.js';
import type { CatalogService } from './catalogs.js';
import { CopyDetailsError, text, type CopyDetailsService } from './copyDetails.js';
import type { Db } from './db/index.js';
import { copies, copyDetails, placeNotes, platforms } from './db/schema.js';
import type { LookupService } from './lookup.js';

/** A copy as the places' pages show it. */
export interface PlaceCopy {
  copyKey: string;
  id: number;
  title: string;
  platformKey: string | null;
  platform: string | null;
  completeness: string;
  /** Its storage location now (null: none yet). */
  place: string | null;
}

/** A place where copies are kept: its name as typed first, the note on where the place itself is, and its copies. */
export interface Place {
  name: string;
  note: string | null;
  copies: PlaceCopy[];
}

/** One of the collection's games, found by a barcode or a title, with its copies (the ones without a place first). */
export interface PlaceGame {
  platformKey: string;
  platform: string;
  title: string;
  copies: PlaceCopy[];
}

/** A copy given a place, and where it was before (null: nowhere yet). */
export interface Placed extends PlaceCopy {
  before: string | null;
}

/** Copies given a place at once (a bag's games from a photo): a list longer than a few shelves is a mistake. */
const PUT_MAX = 500;
/** Games looked up at once (a shelf photo's "Have it" list). */
const GAMES_MAX = 300;
const NOTE_MAX = 120;

/** Places sorted as people number them: "Bag 2" before "Bag 10". */
const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/**
 * Storage locations made quick to fill in (D157). A copy's place is its storage location (copy_details.location,
 * typed in its window); here many copies get one place at once (Pack a place, a shelf photo's games), a place is
 * renamed on every copy that has it, and a place can carry a note saying where the place itself is ("Bag 7": "under
 * the master bed"), kept in place_notes by the place's name, so moving a bag is one change. Places are compared
 * without case, as the Stash's filter compares them.
 */
export class PlacesService {
  constructor(
    private readonly db: Db,
    private readonly details: CopyDetailsService,
    private readonly lookup: LookupService,
    private readonly catalogs: CatalogService,
    private readonly log: Logger,
  ) {}

  /** The collection's copies (or a console's copies of these products), with their place now. */
  private copyRows(where?: { platformKey: string; productIds: string[] }, index = this.details.index()): PlaceCopy[] {
    if (where && where.productIds.length === 0) return [];
    return this.db
      .select({ copyKey: copies.key, id: copies.id, title: copies.title, platformKey: platforms.key, platform: platforms.name, completeness: copies.completeness })
      .from(copies)
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(where ? and(isNull(copies.goneAt), inArray(copies.productId, where.productIds)) : isNull(copies.goneAt))
      .orderBy(asc(copies.id))
      .all()
      .filter((c) => !where || c.platformKey === where.platformKey)
      .map((c) => ({ ...c, place: index.get(c.copyKey)?.location ?? null }));
  }

  /** The notes on places, by the place's name in lower case. */
  notes(): Map<string, { name: string; note: string }> {
    return new Map(
      this.db
        .select()
        .from(placeNotes)
        .all()
        .map((r) => [r.key, { name: r.name, note: r.note }]),
    );
  }

  /** Every place with its copies (and a place with a note but no copies yet), and how many copies have none. */
  list(): { places: Place[]; unplaced: number } {
    const notes = this.notes();
    const places = new Map<string, Place>();
    let unplaced = 0;
    for (const c of this.copyRows()) {
      if (!c.place) {
        unplaced++;
        continue;
      }
      const k = c.place.toLowerCase();
      const p = places.get(k) ?? { name: c.place, note: notes.get(k)?.note ?? null, copies: [] };
      p.copies.push(c);
      places.set(k, p);
    }
    for (const [k, n] of notes) if (!places.has(k)) places.set(k, { name: n.name, note: n.note, copies: [] });
    for (const p of places.values()) p.copies.sort((a, b) => (a.platform ?? '').localeCompare(b.platform ?? '') || a.title.localeCompare(b.title, undefined, { numeric: true }));
    return { places: [...places.values()].sort(byName), unplaced };
  }

  /** A game's copies on its console, the ones without a place first. */
  private game(platformKey: string, platform: string, title: string, productIds: string[], index: ReturnType<CopyDetailsService['index']>): PlaceGame | null {
    const found = this.copyRows({ platformKey, productIds: [...new Set(productIds)] }, index).sort((a, b) => Number(a.place !== null) - Number(b.place !== null) || a.id - b.id);
    return found.length > 0 ? { platformKey, platform, title, copies: found } : null;
  }

  /** The owned games whose title is this (a catalog game's or a copy's own), by console and title, to their products. */
  private titleIndex(): Map<string, Set<string>> {
    const out = new Map<string, Set<string>>();
    const add = (platformKey: string, title: string, productId: string) => {
      const k = `${platformKey}|${normalizeTitle(title)}`;
      out.set(k, (out.get(k) ?? new Set<string>()).add(productId));
    };
    for (const p of this.catalogs.allMatches()) for (const t of p.match.targets) for (const m of t.matches) if (m.method !== 'pending') add(p.key, t.target.title, m.productId);
    for (const c of this.db
      .select({ productId: copies.productId, title: copies.title, platformKey: platforms.key })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all())
      add(c.platformKey, c.title, c.productId);
    return out;
  }

  /** Each game (its console's key and its title, as Store Mode names it) with its copies; null for one not owned. */
  games(list: { platformKey: string; title: string }[]): (PlaceGame | null)[] {
    const titles = this.titleIndex();
    const index = this.details.index();
    const names = new Map(this.db.select({ key: platforms.key, name: platforms.name }).from(platforms).all().map((p) => [p.key, p.name]));
    return list.map((g) => {
      const products = titles.get(`${g.platformKey}|${normalizeTitle(g.title)}`);
      return products ? this.game(g.platformKey, names.get(g.platformKey) ?? g.platformKey, g.title, [...products], index) : null;
    });
  }

  /**
   * A barcode Squirrelcade has saved (Scan my shelf's, Store Mode's), without asking a barcode service: its game and
   * that game's copies; known null when it isn't saved yet. Undefined when the code isn't a barcode.
   */
  byCode(raw: string): { code: string; known: { platformKey: string; platform: string; title: string } | null; games: PlaceGame[] } | undefined {
    const code = normalizeBarcode(raw);
    const saved = this.lookup.savedBarcode(raw);
    if (!code || saved === undefined) return undefined;
    if (!saved) return { code, known: null, games: [] };
    const game = this.games([{ platformKey: saved.platformKey, title: saved.title }])[0];
    return { code: saved.code, known: { platformKey: saved.platformKey, platform: saved.platform, title: saved.title }, games: game ? [game] : [] };
  }

  /** The owned games a typed title finds (on one console, or on all), the best first, with their copies. */
  byTitle(query: string, platformKey?: string): PlaceGame[] {
    const owned = this.lookup.search(query, { platformKey, limit: 30, brief: true }).filter((r) => r.answer === 'own' || r.answer === 'own-not-in-catalog');
    if (owned.length === 0) return [];
    return this.games(owned.map((r) => ({ platformKey: r.platformKey, title: r.title })))
      .filter((g): g is PlaceGame => g !== null)
      .slice(0, 10);
  }

  /** Gives each copy the place (null: none), keeping its other details; says where each one was before. */
  put(place: unknown, keys: unknown): { place: string | null; placed: Placed[] } {
    if (!Array.isArray(keys) || keys.length === 0 || keys.length > PUT_MAX || keys.some((k) => typeof k !== 'string')) {
      throw new CopyDetailsError(`Send the copies (their keys), up to ${PUT_MAX}.`);
    }
    if (place !== null && typeof place !== 'string') throw new CopyDetailsError('A storage location is text.');
    const changed = this.details.setLocations(keys as string[], place);
    const where = changed[0]?.after ?? null;
    const names = new Map(this.db.select({ key: platforms.key, name: platforms.name }).from(platforms).all().map((p) => [p.key, p.name]));
    const moved = changed.filter((c) => (c.before ?? '').toLowerCase() !== (where ?? '').toLowerCase()).length;
    if (moved > 0) this.log.info({ context: 'places' }, where ? `${moved} ${moved === 1 ? 'copy' : 'copies'} put in ${where}` : `${moved} ${moved === 1 ? 'copy' : 'copies'} taken out of their place`);
    return {
      place: where,
      placed: changed.map((c) => ({
        copyKey: c.copy.copyKey,
        id: c.copy.id,
        title: c.copy.title,
        platformKey: c.copy.platformKey,
        platform: c.copy.platformKey ? (names.get(c.copy.platformKey) ?? c.copy.platform) : c.copy.platform,
        completeness: c.copy.completeness,
        place: c.after,
        before: c.before,
      })),
    };
  }

  /**
   * Renames a place on every copy that has it (sold ones too, so their history agrees) and moves its note. A name
   * another place has already joins the two (that place's note stays when both have one).
   */
  rename(from: unknown, to: unknown): { name: string; copies: number } {
    const old = text(from, 80, 'The place');
    const name = text(to, 80, 'Its new name');
    if (!old) throw new CopyDetailsError('Say which place to rename.');
    if (!name) throw new CopyDetailsError('Give the place a name.');
    const k = old.toLowerCase();
    const rows = this.db
      .select({ copyKey: copyDetails.copyKey, location: copyDetails.location })
      .from(copyDetails)
      .all()
      .filter((r) => r.location?.toLowerCase() === k);
    const notes = this.notes();
    if (rows.length === 0 && !notes.has(k)) throw new CopyDetailsError(`No copy is in ${old}.`);
    const now = new Date().toISOString();
    const owned = this.details.owned();
    this.db.transaction((tx) => {
      if (rows.length > 0) tx.update(copyDetails).set({ location: name, updatedAt: now }).where(inArray(copyDetails.copyKey, rows.map((r) => r.copyKey))).run();
      const note = notes.get(k);
      if (!note) return;
      tx.delete(placeNotes).where(eq(placeNotes.key, k)).run();
      const target = notes.get(name.toLowerCase());
      if (!target || name.toLowerCase() === k) tx.insert(placeNotes).values({ key: name.toLowerCase(), name, note: note.note, updatedAt: now }).run();
    });
    const count = rows.filter((r) => owned.has(r.copyKey)).length;
    this.log.info({ context: 'places' }, `${old} renamed ${name} (${count} ${count === 1 ? 'copy' : 'copies'})`);
    return { name, copies: count };
  }

  /** The note on where a place itself is ("under the master bed"); an empty note takes it away. */
  setNote(place: unknown, note: unknown): { name: string; note: string | null } {
    const name = text(place, 80, 'The place');
    if (!name) throw new CopyDetailsError('Say which place the note is for.');
    const said = text(note, NOTE_MAX, 'A note on the place');
    const key = name.toLowerCase();
    if (!said) {
      this.db.delete(placeNotes).where(eq(placeNotes.key, key)).run();
      return { name, note: null };
    }
    const row = { name, note: said, updatedAt: new Date().toISOString() };
    this.db.insert(placeNotes).values({ key, ...row }).onConflictDoUpdate({ target: placeNotes.key, set: row }).run();
    return { name, note: said };
  }
}

/** Places: the owner's, and a viewer's to look at when Settings > Security > Viewers shares copies' details. */
export function registerPlaceRoutes(app: FastifyInstance, places: PlacesService): void {
  const hidden = { error: 'not-shared', message: "The owner doesn't share their copies' details." };
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) => {
    if (err instanceof CopyDetailsError) return reply.code(400).send({ error: 'invalid', message: err.message });
    throw err;
  };

  app.get('/api/v1/places', async (request, reply) => (shown(request).details ? places.list() : reply.code(403).send(hidden)));

  // Pack a place: a scanned barcode's game (as saved here; never a barcode service), or the owned games a title finds.
  app.get('/api/v1/places/find', async (request, reply) => {
    const q = request.query as { code?: string; q?: string; platform?: string };
    if (q.code !== undefined) {
      const found = places.byCode(q.code);
      return found ?? reply.code(400).send({ error: 'invalid', message: "That isn't a barcode: a barcode has 8 to 14 digits." });
    }
    return { games: places.byTitle(q.q ?? '', q.platform || undefined) };
  });

  // A shelf photo's games (Check a shelf), each with its copies.
  app.post('/api/v1/places/games', async (request, reply) => {
    const games = (request.body as { games?: unknown } | null)?.games;
    const valid =
      Array.isArray(games) &&
      games.length <= GAMES_MAX &&
      games.every((g: unknown) => typeof g === 'object' && g !== null && typeof (g as { platformKey?: unknown }).platformKey === 'string' && typeof (g as { title?: unknown }).title === 'string');
    if (!valid) return reply.code(400).send({ error: 'invalid', message: `Send games: up to ${GAMES_MAX} of { platformKey, title }.` });
    return { games: places.games(games as { platformKey: string; title: string }[]) };
  });

  app.post('/api/v1/places/put', async (request, reply) => {
    const b = request.body as { place?: unknown; keys?: unknown } | null;
    try {
      return places.put(b?.place ?? null, b?.keys);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/places/rename', async (request, reply) => {
    const b = request.body as { from?: unknown; to?: unknown } | null;
    try {
      return places.rename(b?.from, b?.to);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put('/api/v1/places/note', async (request, reply) => {
    const b = request.body as { place?: unknown; note?: unknown } | null;
    try {
      return places.setNote(b?.place, b?.note);
    } catch (err) {
      return fail(reply, err);
    }
  });
}
