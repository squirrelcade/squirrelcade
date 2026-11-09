import { baseTitle, matchKey, SAME_GAME_AT, TitleMatcher } from '@squirrelcade/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import sharp from 'sharp';
import type { CollectionService } from './collection.js';
import type { CopyDetailsService } from './copyDetails.js';
import type { Db } from './db/index.js';
import { auditCopies, audits, auditShelves, copies, copyDetails, platforms } from './db/schema.js';
import type { PlacesService } from './places.js';
import type { SettingsService } from './settings.js';

/**
 * The collection audit (1.5.0, R05; the owner: "take pictures of my copies, and see if there are games that aren't
 * logged in"). Shelf by shelf: the phone reads a shelf's spines against its console's games (Check a shelf's reader,
 * in the browser), and the audit ticks the copies it found as seen; what's on the shelf but not in the collection is
 * added from the page (as Store Mode adds) and noted here; barcodes and taps tick the rest. Progress is kept for weeks.
 * At the end, the copies never seen are listed, each found, sold, given away, lost or lent.
 */
export class AuditError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface AuditCopy {
  copyKey: string;
  id: number;
  title: string;
  platformKey: string;
  platform: string;
  completeness: string;
  quantity: number;
  addedAt: string | null;
  place: string | null;
  state: string | null;
  how: string | null;
}

interface ScopeCopy {
  id: number;
  key: string;
  productId: string;
  title: string;
  platformKey: string;
  platform: string;
  completeness: string;
  quantity: number;
  addedAt: string | null;
}

const PHOTO_WIDTH = 1600;
export const AUDIT_PHOTO_MAX_BYTES = 25 * 1024 * 1024;

export class AuditService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly collection: CollectionService,
    private readonly details: CopyDetailsService,
    private readonly places: PlacesService | null,
    private readonly configDir: string,
    private readonly log: Logger,
  ) {}

  /** The audit in progress (or the last one finished, when none is), with how far it's got. */
  current() {
    const row = this.db.select().from(audits).where(isNull(audits.finishedAt)).orderBy(desc(audits.id)).get() ?? this.db.select().from(audits).orderBy(desc(audits.id)).get();
    if (!row) return null;
    return this.summary(row.id);
  }

  summary(id: number) {
    const row = this.audit(id);
    const scope = this.scope(row);
    const marks = this.marks(id);
    const consoles = new Map<string, { key: string; name: string; copies: number; seen: number }>();
    let seen = 0;
    for (const c of scope) {
      const k = consoles.get(c.platformKey) ?? { key: c.platformKey, name: c.platform, copies: 0, seen: 0 };
      k.copies++;
      const m = marks.get(c.key);
      if (m) {
        k.seen++;
        seen++;
      }
      consoles.set(c.platformKey, k);
    }
    // A copy added and then taken back (the walk-through's Undo) isn't counted; one gone is, as gone.
    const inScope = new Set(scope.map((c) => c.key));
    const count = (state: string) => [...marks.values()].filter((m) => m.state === state && (state === 'gone' || inScope.has(m.copyKey))).length;
    const shelves = this.db.select().from(auditShelves).where(eq(auditShelves.auditId, id)).orderBy(desc(auditShelves.id)).all();
    const seenOn = new Map<number, number>();
    for (const m of marks.values()) if (m.shelfId !== null) seenOn.set(m.shelfId, (seenOn.get(m.shelfId) ?? 0) + 1);
    return {
      id: row.id,
      name: row.name,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      platforms: row.platforms ? (JSON.parse(row.platforms) as string[]) : null,
      totals: { copies: scope.length, marked: seen, seen: count('seen'), added: count('added'), gone: count('gone'), lent: count('lent'), shelves: shelves.length },
      consoles: [...consoles.values()].sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name)),
      shelves: shelves.slice(0, 30).map((s) => ({ id: s.id, name: s.name, platformKey: s.platformKey, reads: s.reads, seen: seenOn.get(s.id) ?? 0, notLogged: JSON.parse(s.notLogged) as { title: string; read?: string; added?: boolean }[], photos: (JSON.parse(s.photos) as string[]).length, createdAt: s.createdAt })),
    };
  }

  start(input: { name?: unknown; platforms?: unknown }) {
    if (this.db.select().from(audits).where(isNull(audits.finishedAt)).get()) throw new AuditError('An audit is already going. Finish it before starting another.', 409);
    const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 120) : `Collection audit, ${new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    const keys = Array.isArray(input.platforms) ? input.platforms.filter((k): k is string => typeof k === 'string') : [];
    const row = this.db
      .insert(audits)
      .values({ name, platforms: keys.length > 0 ? JSON.stringify(keys) : null, startedAt: new Date().toISOString() })
      .returning()
      .get();
    this.log.info({ context: 'audit' }, `Collection audit started: ${name}`);
    return this.summary(row.id);
  }

  finish(id: number) {
    this.audit(id);
    this.db.update(audits).set({ finishedAt: new Date().toISOString() }).where(eq(audits.id, id)).run();
    return this.summary(id);
  }

  /** Picks an audit up again after it was finished (more shelves were found). */
  reopen(id: number) {
    this.audit(id);
    if (this.db.select().from(audits).where(isNull(audits.finishedAt)).get()) throw new AuditError('Another audit is going.', 409);
    this.db.update(audits).set({ finishedAt: null }).where(eq(audits.id, id)).run();
    return this.summary(id);
  }

  /**
   * A shelf photographed: the titles the reader found that are in the collection (ticked as seen, every copy of each on
   * that console), and the ones on the shelf that aren't (kept with the shelf, to add). The shelf's name becomes the
   * copies' place when asked (Settings > Collection > A shelf's name becomes its copies' place).
   */
  shelf(id: number, input: { platformKey?: unknown; name?: unknown; reads?: unknown; seen?: unknown; notLogged?: unknown; place?: unknown }) {
    const row = this.open(id);
    const platformKey = typeof input.platformKey === 'string' ? input.platformKey : '';
    if (!this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get()) throw new AuditError('Say which console the shelf is.');
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 120) : '';
    const notLogged = Array.isArray(input.notLogged)
      ? input.notLogged
          .filter((x): x is { title: string; read?: string } => typeof x?.title === 'string')
          .slice(0, 200)
          .map((x) => ({ title: x.title.slice(0, 200), ...(typeof x.read === 'string' ? { read: x.read.slice(0, 200) } : {}) }))
      : [];
    const shelf = this.db
      .insert(auditShelves)
      .values({ auditId: row.id, name, platformKey, reads: typeof input.reads === 'number' ? Math.max(0, Math.round(input.reads)) : 0, notLogged: JSON.stringify(notLogged), createdAt: new Date().toISOString() })
      .returning()
      .get();
    const titles = Array.isArray(input.seen) ? input.seen.filter((t): t is string => typeof t === 'string') : [];
    const result = this.seeTitles(row.id, platformKey, titles, 'photo', shelf.id);
    const usePlace = input.place === true || (input.place === undefined && this.settings.get('audit.placeFromShelf'));
    if (name && usePlace && this.places && result.seen.length > 0) {
      try {
        this.places.put(name, result.seen.map((s) => s.copyKey));
      } catch (err) {
        this.log.warn({ context: 'audit', err }, `The shelf's place wasn't set: ${(err as Error).message}`);
      }
    }
    return { shelf: { id: shelf.id, name, platformKey }, ...result };
  }

  /** Ticks the copies of these games on a console as seen (a shelf's photo, a barcode, a tap). */
  seeTitles(id: number, platformKey: string, titles: string[], how: 'photo' | 'barcode' | 'hand', shelfId: number | null = null) {
    const row = this.open(id);
    const onConsole = this.scope(row).filter((c) => c.platformKey === platformKey);
    const byKey = new Map<string, ScopeCopy[]>();
    for (const c of onConsole) {
      const k = matchKey(baseTitle(c.title));
      byKey.set(k, [...(byKey.get(k) ?? []), c]);
    }
    let matcher: TitleMatcher<ScopeCopy> | null = null;
    const seen: { copyKey: string; title: string }[] = [];
    const unmatched: string[] = [];
    for (const t of [...new Set(titles)]) {
      let found = byKey.get(matchKey(baseTitle(t)));
      if (!found) {
        matcher ??= new TitleMatcher(onConsole, (c) => [c.title]);
        const best = matcher.find(t, { min: SAME_GAME_AT, limit: 1 })[0]?.item;
        found = best ? byKey.get(matchKey(baseTitle(best.title))) : undefined;
      }
      if (!found) {
        unmatched.push(t);
        continue;
      }
      for (const c of found) {
        this.mark(row.id, c.key, 'seen', how, shelfId, false);
        seen.push({ copyKey: c.key, title: c.title });
      }
    }
    return { seen, unmatched };
  }

  /** Ticks copies by their keys (tick by hand, a barcode's copy). */
  tick(id: number, keys: string[], how: 'photo' | 'barcode' | 'hand', shelfId: number | null = null) {
    const row = this.open(id);
    const inScope = new Set(this.scope(row).map((c) => c.key));
    const done = keys.filter((k) => inScope.has(k));
    for (const k of done) this.mark(row.id, k, 'seen', how, shelfId, false);
    return { ticked: done.length };
  }

  untick(id: number, key: string) {
    this.open(id);
    return { removed: this.db.delete(auditCopies).where(and(eq(auditCopies.auditId, id), eq(auditCopies.copyKey, key))).run().changes > 0 };
  }

  /** A copy added during the audit (on a shelf, not logged): counted as seen, and noted on its shelf. */
  added(id: number, input: { copyKey?: unknown; shelfId?: unknown; title?: unknown }) {
    const row = this.open(id);
    const copyKey = typeof input.copyKey === 'string' ? input.copyKey : '';
    if (!this.db.select({ id: copies.id }).from(copies).where(eq(copies.key, copyKey)).get()) throw new AuditError("That copy isn't in your collection.", 404);
    const shelfId = typeof input.shelfId === 'number' ? input.shelfId : null;
    this.mark(row.id, copyKey, 'added', 'added', shelfId, true);
    if (shelfId !== null && typeof input.title === 'string') {
      const shelf = this.db.select().from(auditShelves).where(and(eq(auditShelves.id, shelfId), eq(auditShelves.auditId, row.id))).get();
      if (shelf) {
        const list = JSON.parse(shelf.notLogged) as { title: string; read?: string; added?: boolean }[];
        const hit = list.find((x) => x.title === input.title && !x.added);
        if (hit) hit.added = true;
        this.db.update(auditShelves).set({ notLogged: JSON.stringify(list) }).where(eq(auditShelves.id, shelf.id)).run();
      }
    }
    return { added: true };
  }

  /** The audit's copies on a console (or all): those not seen yet, or those seen. */
  copies(id: number, opts: { platformKey?: string; state?: 'unseen' | 'seen' | 'all' }): AuditCopy[] {
    const row = this.audit(id);
    const marks = this.marks(id);
    const scope = this.scope(row).filter((c) => !opts.platformKey || c.platformKey === opts.platformKey);
    const placeOf = new Map(this.db.select({ key: copyDetails.copyKey, location: copyDetails.location }).from(copyDetails).all().map((r) => [r.key, r.location]));
    const state = opts.state ?? 'unseen';
    return scope
      .filter((c) => (state === 'all' ? true : state === 'seen' ? marks.has(c.key) : !marks.has(c.key)))
      .map((c) => ({ copyKey: c.key, id: c.id, title: c.title, platformKey: c.platformKey, platform: c.platform, completeness: c.completeness, quantity: c.quantity, addedAt: c.addedAt, place: placeOf.get(c.key) || null, state: marks.get(c.key)?.state ?? null, how: marks.get(c.key)?.how ?? null }))
      .sort((a, b) => a.platform.localeCompare(b.platform) || a.title.localeCompare(b.title));
  }

  /** What became of a copy not seen: found after all, sold, given away, lost (those leave the collection), or lent. */
  settle(id: number, input: { copyKey?: unknown; outcome?: unknown; lentTo?: unknown }) {
    const row = this.open(id);
    const copyKey = typeof input.copyKey === 'string' ? input.copyKey : '';
    const copy = this.scope(row).find((c) => c.key === copyKey);
    if (!copy) throw new AuditError("That copy isn't part of this audit.", 404);
    const outcome = input.outcome;
    if (outcome === 'found') this.mark(row.id, copyKey, 'seen', 'hand', null, true);
    else if (outcome === 'sold' || outcome === 'given' || outcome === 'lost') {
      this.collection.removeCopy(copy.id, outcome === 'sold' ? 'sold' : 'removed');
      this.mark(row.id, copyKey, 'gone', outcome, null, true);
    } else if (outcome === 'lent') {
      this.details.lend(copyKey, { lentTo: typeof input.lentTo === 'string' && input.lentTo.trim() ? input.lentTo : 'Someone' });
      this.mark(row.id, copyKey, 'lent', 'lent', null, true);
    } else throw new AuditError('Say what became of it: found, sold, given, lost or lent.');
    return { settled: outcome };
  }

  /** Keeps a shelf's photo (resized) when Settings > Collection > Keep the audit's shelf photos is on. */
  async addPhoto(shelfId: number, data: Buffer): Promise<{ photos: number; kept: boolean }> {
    const shelf = this.db.select().from(auditShelves).where(eq(auditShelves.id, shelfId)).get();
    if (!shelf) throw new AuditError('No such shelf.', 404);
    const list = JSON.parse(shelf.photos) as string[];
    if (!this.settings.get('audit.keepPhotos')) return { photos: list.length, kept: false };
    const dir = join(this.configDir, 'audit', String(shelf.auditId));
    mkdirSync(dir, { recursive: true });
    const file = `${shelf.id}-${list.length + 1}.jpg`;
    await sharp(data).rotate().resize({ width: PHOTO_WIDTH, withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(join(dir, file));
    list.push(file);
    this.db.update(auditShelves).set({ photos: JSON.stringify(list) }).where(eq(auditShelves.id, shelf.id)).run();
    return { photos: list.length, kept: true };
  }

  photo(auditId: number, file: string): Buffer | null {
    if (!/^\d+-\d+\.jpg$/.test(file)) return null;
    const path = join(this.configDir, 'audit', String(auditId), file);
    return existsSync(path) ? readFileSync(path) : null;
  }

  private audit(id: number) {
    const row = this.db.select().from(audits).where(eq(audits.id, id)).get();
    if (!row) throw new AuditError('No such audit.', 404);
    return row;
  }

  private open(id: number) {
    const row = this.audit(id);
    if (row.finishedAt) throw new AuditError('That audit is finished. Pick it up again first.', 409);
    return row;
  }

  private marks(id: number) {
    return new Map(this.db.select().from(auditCopies).where(eq(auditCopies.auditId, id)).all().map((m) => [m.copyKey, m] as const));
  }

  private mark(auditId: number, copyKey: string, state: string, how: string, shelfId: number | null, replace: boolean) {
    const at = new Date().toISOString();
    const q = this.db.insert(auditCopies).values({ auditId, copyKey, state, how, shelfId, at });
    if (replace) q.onConflictDoUpdate({ target: [auditCopies.auditId, auditCopies.copyKey], set: { state, how, shelfId, at } }).run();
    else q.onConflictDoNothing().run();
  }

  /** The copies an audit covers: the physical games in the collection on its consoles (hardware left out). */
  private scope(row: typeof audits.$inferSelect): ScopeCopy[] {
    const keys = row.platforms ? new Set(JSON.parse(row.platforms) as string[]) : null;
    return this.db
      .select({ id: copies.id, key: copies.key, productId: copies.productId, title: copies.title, platformKey: platforms.key, platform: platforms.name, completeness: copies.completeness, quantity: copies.quantity, addedAt: copies.addedAt })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all()
      .filter((c) => (!keys || keys.has(c.platformKey)) && !this.collection.isHardware(c.productId, c.title));
  }
}

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof AuditError) return reply.code(err.status).send({ error: err.status === 404 ? 'not-found' : err.status === 409 ? 'conflict' : 'invalid', message: err.message });
  throw err;
}

const HOWS = new Set(['photo', 'barcode', 'hand']);

export function registerAuditRoutes(app: FastifyInstance, audit: AuditService): void {
  const id = (request: { params: unknown }) => Number((request.params as { id: string }).id);
  app.get('/api/v1/audit', async () => ({ audit: audit.current() }));
  app.post('/api/v1/audit', async (request, reply) => {
    try {
      return reply.code(201).send({ audit: audit.start((request.body ?? {}) as Record<string, unknown>) });
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/audit/:id/finish', async (request, reply) => {
    try {
      return { audit: audit.finish(id(request)) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/audit/:id/reopen', async (request, reply) => {
    try {
      return { audit: audit.reopen(id(request)) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/audit/:id/shelves', async (request, reply) => {
    try {
      return reply.code(201).send(audit.shelf(id(request), (request.body ?? {}) as Record<string, unknown>));
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/audit/:id/seen', async (request, reply) => {
    const b = (request.body ?? {}) as { platformKey?: unknown; titles?: unknown; copyKeys?: unknown; how?: unknown; shelfId?: unknown };
    const how = typeof b.how === 'string' && HOWS.has(b.how) ? (b.how as 'hand') : 'hand';
    const shelfId = typeof b.shelfId === 'number' ? b.shelfId : null;
    try {
      if (Array.isArray(b.copyKeys)) return audit.tick(id(request), b.copyKeys.filter((k): k is string => typeof k === 'string'), how, shelfId);
      if (typeof b.platformKey !== 'string' || !Array.isArray(b.titles)) return reply.code(400).send({ error: 'invalid', message: 'Say which copies (their keys), or a console and titles.' });
      return audit.seeTitles(id(request), b.platformKey, b.titles.filter((t): t is string => typeof t === 'string'), how, shelfId);
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.delete('/api/v1/audit/:id/seen', async (request, reply) => {
    const key = (request.query as { key?: string }).key;
    if (!key) return reply.code(400).send({ error: 'invalid', message: 'Say which copy.' });
    try {
      return audit.untick(id(request), key);
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/audit/:id/added', async (request, reply) => {
    try {
      return audit.added(id(request), (request.body ?? {}) as Record<string, unknown>);
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.get('/api/v1/audit/:id/copies', async (request, reply) => {
    const q = request.query as { platform?: string; state?: string };
    const state = q.state === 'seen' || q.state === 'all' ? q.state : 'unseen';
    try {
      return { copies: audit.copies(id(request), { platformKey: q.platform || undefined, state }) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/audit/:id/settle', async (request, reply) => {
    try {
      return audit.settle(id(request), (request.body ?? {}) as Record<string, unknown>);
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/audit/shelves/:id/photos', async (request, reply) => {
    const file = await request.file({ limits: { fileSize: AUDIT_PHOTO_MAX_BYTES + 1 } });
    if (!file) return reply.code(400).send({ error: 'no-file', message: 'Choose a photo.' });
    const data = await file.toBuffer();
    if (file.file.truncated) return reply.code(400).send({ error: 'invalid', message: `A photo can be up to ${AUDIT_PHOTO_MAX_BYTES / 1024 / 1024} MB.` });
    try {
      return reply.code(201).send(await audit.addPhoto(id(request), data));
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.get('/api/v1/audit/:id/photos/:file', async (request, reply) => {
    const data = audit.photo(id(request), (request.params as { file: string }).file);
    if (!data) return reply.code(404).send({ error: 'not-found', message: 'No such photo.' });
    return reply.header('content-type', 'image/jpeg').header('cache-control', 'private, max-age=31536000, immutable').send(data);
  });
}
