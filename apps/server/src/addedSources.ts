import {
  decodeEntities,
  KNOWN_PLATFORMS,
  listDownloadUrl,
  listRows,
  readSourceList,
  summarizeSourceList,
  type AddedSourceInfo,
  type ListEntry,
  type SourceListSummary,
} from '@squirrelcade/core';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { addedSources } from './db/schema.js';
import { APP_VERSION } from './env.js';
import type { FetchLike } from './igdb.js';

/** At most this many added sources, and an online list or file at most this large. */
const MAX_SOURCES = 30;
const MAX_BYTES = 10 * 1024 * 1024;
const READ_TIMEOUT_MS = 30_000;
/** An online list that couldn't be read is tried again by the catalog task after this long, not at every run. */
const RETRY_MS = 12 * 3_600_000;

/** A list couldn't be read or used, with a message to show the user. */
export class AddedSourceError extends Error {}

/** How an added source's games count: toward completion, or once owned (as other regions' releases do). */
export type SourceCounts = 'complete' | 'owned';

/** An added source, as Settings > Sources shows it. */
export interface AddedSource {
  /** Its id in the order: "added-" and a number. */
  id: string;
  name: string;
  kind: 'link' | 'file';
  url: string | null;
  fileName: string | null;
  /** The console every game is for, when the list has no console column. */
  platformKey: string | null;
  counts: SourceCounts;
  games: number;
  consoles: { key: string; games: number }[];
  /** When its games were last read. */
  readAt: string;
  /** Why the last reading of an online list failed, or null. */
  error: string | null;
}

/** What a list has, before it's added. */
export interface ListPreview extends SourceListSummary {
  /** Whether it can be added as it is: it has games for a console Squirrelcade knows. */
  usable: boolean;
  /** A name for it: the page's title, or the file's name. */
  name: string;
  from: 'csv' | 'page';
  /** Consoles in its console column that Squirrelcade doesn't know, with their games. */
  unknown: { name: string; games: number }[];
  consoleColumn: boolean;
  columns: string[];
  problems: string[];
}

/** A list to read: an online list's address, or a file's text; and the console it's for, when it has no console column. */
export type ListInput = ({ url: string } | { fileName: string; text: string }) & { platform?: string | null };

interface Reading {
  games: Record<string, ListEntry[]>;
  preview: ListPreview;
}

const sourceId = (n: number) => `added-${n}`;
const rowId = (id: string): number => (/^added-\d+$/.test(id) ? Number(id.slice(6)) : Number.NaN);
const knownConsole = (key: string | null | undefined): string | null => (key && KNOWN_PLATFORMS.some((p) => p.key === key) ? key : null);

/**
 * Catalog sources the user adds (Settings > Sources > Catalog sources): an online list (a CSV's address, a Google
 * sheet, or a web page with a table of games) or a CSV file, read into games by console. Each has its own place in
 * the order, and the catalog build reads its games (CatalogBuilder). An online list is read again with the catalog
 * refresh; a reading that fails keeps the games of the one before.
 */
export class AddedSources {
  /** Each source's games, parsed once. */
  private readonly cache = new Map<number, Record<string, ListEntry[]>>();
  /** When each online list that failed was last tried (the catalog task waits before trying it again). */
  private readonly tried = new Map<number, number>();

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly fetcher: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private gamesOf(n: number): Record<string, ListEntry[]> {
    let games = this.cache.get(n);
    if (!games) {
      const row = this.db.select({ games: addedSources.games }).from(addedSources).where(eq(addedSources.id, n)).get();
      games = row ? (JSON.parse(row.games) as Record<string, ListEntry[]>) : {};
      if (row) this.cache.set(n, games);
    }
    return games;
  }

  /** Every added source, oldest first. */
  list(): AddedSource[] {
    const rows = this.db
      .select({
        id: addedSources.id,
        name: addedSources.name,
        kind: addedSources.kind,
        url: addedSources.url,
        fileName: addedSources.fileName,
        platformKey: addedSources.platformKey,
        counts: addedSources.counts,
        total: addedSources.total,
        readAt: addedSources.readAt,
        error: addedSources.error,
      })
      .from(addedSources)
      .orderBy(asc(addedSources.id))
      .all();
    return rows.map((r) => ({
      id: sourceId(r.id),
      name: r.name,
      kind: r.kind === 'file' ? 'file' : 'link',
      url: r.url,
      fileName: r.fileName,
      platformKey: r.platformKey,
      counts: r.counts === 'owned' ? 'owned' : 'complete',
      games: r.total,
      consoles: Object.entries(this.gamesOf(r.id))
        .map(([key, l]) => ({ key, games: l.length }))
        .sort((a, b) => b.games - a.games),
      readAt: r.readAt,
      error: r.error,
    }));
  }

  /** The added sources' ids, names and consoles, for the order (sourceOrder, sourceCovers). */
  info(): AddedSourceInfo[] {
    return this.list().map((s) => ({ id: s.id, name: s.name, platforms: s.consoles.map((c) => c.key) }));
  }

  /** An added source's games for a console and how they count, or null when it has none for it. */
  forBuild(id: string, platformKey: string): { games: ListEntry[]; counts: SourceCounts } | null {
    const n = rowId(id);
    if (!Number.isInteger(n)) return null;
    const row = this.db.select({ counts: addedSources.counts }).from(addedSources).where(eq(addedSources.id, n)).get();
    const games = row ? this.gamesOf(n)[platformKey] : undefined;
    return row && games && games.length > 0 ? { games, counts: row.counts === 'owned' ? 'owned' : 'complete' } : null;
  }

  /** Downloads an online list: its text, its type and the page's title. */
  async download(url: string): Promise<{ body: string; contentType: string; title: string | null }> {
    let address: URL;
    try {
      address = new URL(listDownloadUrl(url.trim()));
    } catch {
      throw new AddedSourceError("That isn't a web address (one starts with https://).");
    }
    if (address.protocol !== 'https:' && address.protocol !== 'http:') throw new AddedSourceError('Only http and https addresses can be read.');
    const sheet = address.hostname === 'docs.google.com';
    let res: Response;
    try {
      res = await this.fetcher(address.toString(), {
        headers: { 'user-agent': `Squirrelcade/${APP_VERSION} (+https://squirrelcade.com)`, accept: 'text/csv, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5' },
        signal: AbortSignal.timeout(READ_TIMEOUT_MS),
        redirect: 'follow',
      });
    } catch (err) {
      throw new AddedSourceError(`The address couldn't be reached (${err instanceof Error ? err.message : String(err)}).`);
    }
    if (!res.ok) {
      const closed = res.status === 401 || res.status === 403 || (sheet && res.status === 404);
      throw new AddedSourceError(`The address answered ${res.status}${closed ? `: the list isn't public${sheet ? ' (share the Google sheet with anyone who has the link)' : ''}` : ''}.`);
    }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new AddedSourceError('The list is larger than 10 MB.');
    const body = await res.text();
    if (body.length > MAX_BYTES) throw new AddedSourceError('The list is larger than 10 MB.');
    const contentType = res.headers.get('content-type') ?? '';
    // A sheet that isn't shared sends Google's sign-in page instead of its rows.
    if (sheet && /html/i.test(contentType)) throw new AddedSourceError('Google answered with its sign-in page: share the sheet with anyone who has the link (as a viewer), then try again.');
    const title = /<title[^>]*>([^<]{1,200})<\/title>/i.exec(body)?.[1];
    return { body, contentType, title: title ? decodeEntities(title).replace(/\s+/g, ' ').trim() : null };
  }

  /** Reads a list's text (an online list's download, or a file's) into its games by console, with a preview. */
  read(body: string, contentType: string, platformKey: string | null, name: string): Reading {
    const rows = listRows(body, contentType, KNOWN_PLATFORMS);
    if (!rows) throw new AddedSourceError('No table of games was found there: a list needs a column named Title (or Game, or Name).');
    const list = readSourceList(rows.rows, KNOWN_PLATFORMS, knownConsole(platformKey));
    const summary = summarizeSourceList(list.games);
    return {
      games: list.games,
      preview: { ...summary, usable: summary.games > 0, name, from: rows.from, unknown: list.unknown.slice(0, 20), consoleColumn: list.consoleColumn, columns: list.columns, problems: list.problems },
    };
  }

  private async reading(input: ListInput): Promise<Reading> {
    const platformKey = knownConsole(input.platform);
    if ('url' in input) {
      const d = await this.download(input.url);
      return this.read(d.body, d.contentType, platformKey, d.title ?? new URL(listDownloadUrl(input.url.trim())).hostname);
    }
    if (input.text.length > MAX_BYTES) throw new AddedSourceError('The list is larger than 10 MB.');
    return this.read(input.text, /\.html?$/i.test(input.fileName) ? 'text/html' : 'text/csv', platformKey, input.fileName.replace(/\.[a-z0-9]+$/i, '').trim());
  }

  /** What a list has, before it's added. */
  async preview(input: ListInput): Promise<ListPreview> {
    return (await this.reading(input)).preview;
  }

  /** Adds a source, read now; it joins the bottom of the order, switched on. */
  async add(input: ListInput & { name?: string; counts?: SourceCounts }): Promise<AddedSource> {
    if (this.db.select({ id: addedSources.id }).from(addedSources).all().length >= MAX_SOURCES) throw new AddedSourceError(`Up to ${MAX_SOURCES} sources can be added: remove one first.`);
    const r = await this.reading(input);
    if (!r.preview.usable) throw new AddedSourceError(r.preview.problems.join(' ') || 'The list has no games for a console Squirrelcade knows.');
    const now = new Date().toISOString();
    const link = 'url' in input;
    const row = this.db
      .insert(addedSources)
      .values({
        name: (input.name?.trim() || r.preview.name || 'My list').slice(0, 80),
        kind: link ? 'link' : 'file',
        url: link ? input.url.trim().slice(0, 2000) : null,
        fileName: link ? null : input.fileName.slice(0, 200),
        platformKey: knownConsole(input.platform),
        counts: input.counts === 'owned' ? 'owned' : 'complete',
        games: JSON.stringify(r.games),
        total: r.preview.games,
        readAt: now,
        createdAt: now,
      })
      .returning({ id: addedSources.id })
      .get();
    this.cache.set(row.id, r.games);
    const added = this.list().find((s) => s.id === sourceId(row.id))!;
    this.log.info({ context: 'catalogs' }, `Catalog source added: ${added.name} (${added.games} games for ${added.consoles.length} console(s))`);
    return added;
  }

  /** Renames a source, or changes how its games count; null when there's no such source. */
  update(id: string, changes: { name?: string; counts?: SourceCounts }): AddedSource | null {
    const n = rowId(id);
    if (!Number.isInteger(n)) return null;
    const set: { name?: string; counts?: SourceCounts } = {};
    if (changes.name?.trim()) set.name = changes.name.trim().slice(0, 80);
    if (changes.counts === 'owned' || changes.counts === 'complete') set.counts = changes.counts;
    if (Object.keys(set).length > 0) this.db.update(addedSources).set(set).where(eq(addedSources.id, n)).run();
    return this.list().find((s) => s.id === id) ?? null;
  }

  /** Removes a source: the consoles it had games for (to rebuild), or null when there's no such source. */
  remove(id: string): string[] | null {
    const n = rowId(id);
    if (!Number.isInteger(n)) return null;
    const consoles = Object.keys(this.gamesOf(n));
    const removed = this.db.delete(addedSources).where(eq(addedSources.id, n)).run().changes > 0;
    this.cache.delete(n);
    this.tried.delete(n);
    return removed ? consoles : null;
  }

  /** Reads an online list again: the source, and the consoles whose games changed. A failed reading keeps the games it had. */
  async refresh(id: string): Promise<{ source: AddedSource; changed: string[] }> {
    const n = rowId(id);
    const row = Number.isInteger(n) ? this.db.select({ kind: addedSources.kind, url: addedSources.url, platformKey: addedSources.platformKey }).from(addedSources).where(eq(addedSources.id, n)).get() : undefined;
    if (!row) throw new AddedSourceError('No such source.');
    if (row.kind !== 'link' || !row.url) throw new AddedSourceError('Only an online list is read again; give a file again by adding it anew.');
    this.tried.set(n, Date.now());
    try {
      const r = await this.reading({ url: row.url, platform: row.platformKey });
      if (!r.preview.usable) throw new AddedSourceError(r.preview.problems.join(' ') || 'The list has no games now.');
      const before = this.gamesOf(n);
      const changed = [...new Set([...Object.keys(before), ...Object.keys(r.games)])].filter((k) => JSON.stringify(before[k] ?? []) !== JSON.stringify(r.games[k] ?? []));
      this.db
        .update(addedSources)
        .set({ games: JSON.stringify(r.games), total: r.preview.games, readAt: new Date().toISOString(), error: null })
        .where(eq(addedSources.id, n))
        .run();
      this.cache.set(n, r.games);
      this.tried.delete(n);
      return { source: this.list().find((s) => s.id === id)!, changed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.db.update(addedSources).set({ error: message.slice(0, 500) }).where(eq(addedSources.id, n)).run();
      throw err instanceof AddedSourceError ? err : new AddedSourceError(message);
    }
  }

  /**
   * For the catalog task: reads again each online list last read longer ago than `days` (0: never on its own) and
   * returns the consoles whose games changed. One that fails waits a while before the next try.
   */
  async refreshDue(days: number, progress?: (text: string) => void): Promise<string[]> {
    if (days === 0) return [];
    const now = Date.now();
    const due = this.list().filter((s) => s.kind === 'link' && now - Date.parse(s.readAt) > days * 86_400_000 && now - (this.tried.get(rowId(s.id)) ?? 0) > RETRY_MS);
    const changed = new Set<string>();
    for (const s of due) {
      progress?.(`Reading ${s.name}`);
      try {
        for (const k of (await this.refresh(s.id)).changed) changed.add(k);
      } catch (err) {
        this.log.warn({ context: 'catalogs' }, `${s.name} couldn't be read again: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return [...changed];
  }
}

/** A request's list: a file (a form with the file after its fields), or an online list's address (JSON). */
async function listInput(request: FastifyRequest): Promise<(ListInput & { name?: string; counts?: SourceCounts }) | string> {
  if (request.isMultipart()) {
    const file = await request.file({ limits: { fileSize: MAX_BYTES + 1 } });
    if (!file) return "Choose the list's file.";
    const field = (name: string) => {
      const f = file.fields[name] as { value?: unknown } | undefined;
      return typeof f?.value === 'string' ? f.value : undefined;
    };
    const data = await file.toBuffer();
    if (file.file.truncated) return 'The list is larger than 10 MB.';
    return { fileName: file.filename || 'list.csv', text: data.toString('utf8'), platform: field('platform') || null, name: field('name'), counts: field('counts') === 'owned' ? 'owned' : 'complete' };
  }
  const body = (request.body ?? {}) as Record<string, unknown>;
  if (typeof body.url !== 'string' || !body.url.trim()) return "Paste the list's address.";
  return {
    url: body.url.slice(0, 2000),
    platform: typeof body.platform === 'string' ? body.platform : null,
    name: typeof body.name === 'string' ? body.name : undefined,
    counts: body.counts === 'owned' ? 'owned' : 'complete',
  };
}

function fail(reply: FastifyReply, err: unknown) {
  if (err instanceof AddedSourceError) return reply.code(400).send({ error: 'invalid-list', message: err.message });
  throw err;
}

/**
 * Settings > Sources > Catalog sources, the sources the user adds: preview a list, add it, rename it or change how
 * its games count, read an online list again, remove one. `rebuild` asks for the given consoles' catalogs to be built
 * again (those tracked or with a catalog).
 */
export function registerAddedSourceRoutes(app: FastifyInstance, added: AddedSources, rebuild: (platformKeys: string[]) => void): void {
  app.get('/api/v1/catalog-sources', async () => added.list());

  app.post('/api/v1/catalog-sources/preview', async (request, reply) => {
    const input = await listInput(request);
    if (typeof input === 'string') return reply.code(400).send({ error: 'invalid', message: input });
    try {
      return await added.preview(input);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/catalog-sources', async (request, reply) => {
    const input = await listInput(request);
    if (typeof input === 'string') return reply.code(400).send({ error: 'invalid', message: input });
    try {
      const source = await added.add(input);
      rebuild(source.consoles.map((c) => c.key));
      return reply.code(201).send(source);
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.patch('/api/v1/catalog-sources/:id', async (request, reply) => {
    const id = (request.params as { id: string }).id;
    const body = (request.body ?? {}) as { name?: unknown; counts?: unknown };
    const before = added.list().find((s) => s.id === id);
    const source = added.update(id, { name: typeof body.name === 'string' ? body.name : undefined, counts: body.counts === 'owned' || body.counts === 'complete' ? body.counts : undefined });
    if (!source || !before) return reply.code(404).send({ error: 'not-found', message: 'No such source.' });
    if (source.counts !== before.counts) rebuild(source.consoles.map((c) => c.key));
    return source;
  });

  app.post('/api/v1/catalog-sources/:id/read', async (request, reply) => {
    try {
      const { source, changed } = await added.refresh((request.params as { id: string }).id);
      rebuild(changed);
      return { ...source, changed };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/v1/catalog-sources/:id', async (request, reply) => {
    const consoles = added.remove((request.params as { id: string }).id);
    if (!consoles) return reply.code(404).send({ error: 'not-found', message: 'No such source.' });
    rebuild(consoles);
    return { removed: true };
  });
}
