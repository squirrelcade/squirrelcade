import { baseTitle, matchKey } from '@squirrelcade/core';
import { eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { shown } from './access.js';
import type { CatalogService } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import { catalogEntries, copies, platforms } from './db/schema.js';
import type { IgdbService } from './igdb.js';
import type { PcService } from './pc.js';

/** The consoles a game is yours on (D175), by the game's title key (as catalogs compare titles): PC is "pc". */
export type OwnedMarks = Record<string, string[]>;

/**
 * Which consoles you have each game on, for the marks on its cover and beside its title everywhere (D175): your
 * copies' titles, the catalog games they count as, and the PC library's games you own for good. Worked out once
 * per change of the collection or the catalogs (and at most once a minute for the PC library), never per page.
 */
export class MarksService {
  private cache: { stamp: string; at: number; owned: OwnedMarks; withoutPc: OwnedMarks } | null = null;
  /** The consoles each game came out on, by its title key: built once per IGDB download or catalog change, a slice at a time. */
  private releasedIndex: { stamp: string; built: Promise<Map<string, string[]>> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly collection: CollectionService,
    private readonly catalogs: CatalogService,
    private readonly pc: PcService,
    private readonly igdb?: IgdbService,
  ) {}

  /**
   * The consoles each of these games came out on (the owner's rules for a cover's banner, 2026-11-06): from IGDB's lists
   * of the consoles Squirrelcade knows and the catalogs, by title key. The index is built once (a slice at a time, so
   * the server keeps answering meanwhile) and kept until IGDB's lists or the catalogs change.
   */
  async released(keys: readonly string[]): Promise<Record<string, string[]>> {
    const index = await this.releasedMap();
    return Object.fromEntries(keys.filter((k) => index.has(k)).map((k) => [k, index.get(k)!]));
  }

  private releasedMap(): Promise<Map<string, string[]>> {
    const stamp = `${this.igdb?.stamp() ?? 0}|${this.catalogs.stamp()}`;
    if (this.releasedIndex?.stamp !== stamp) this.releasedIndex = { stamp, built: this.buildReleased() };
    return this.releasedIndex.built;
  }

  private async buildReleased(): Promise<Map<string, string[]>> {
    const keyOf = new Map(this.db.select({ id: platforms.id, key: platforms.key }).from(platforms).all().map((p) => [p.id, p.key]));
    const sets = new Map<string, Set<string>>();
    const add = (title: string, key: string | undefined) => {
      const k = key ? matchKey(baseTitle(title)) : '';
      if (k) sets.set(k, (sets.get(k) ?? new Set()).add(key!));
    };
    const yieldNow = () => new Promise<void>((resolve) => setImmediate(resolve));
    // IGDB's lists, a slice at a time by rowid; only each game's name is read out of its JSON.
    let after = 0;
    for (;;) {
      const rows = this.db.all<{ rowid: number; platform_id: number; name: string | null }>(sql`SELECT rowid, platform_id, json_extract(data, '$.name') AS name FROM igdb_games WHERE rowid > ${after} ORDER BY rowid LIMIT 5000`);
      if (rows.length === 0) break;
      for (const r of rows) if (r.name) add(r.name, keyOf.get(r.platform_id));
      after = rows[rows.length - 1]!.rowid;
      await yieldNow();
    }
    for (const r of this.db.select({ title: catalogEntries.title, platformId: catalogEntries.platformId }).from(catalogEntries).all()) add(r.title, keyOf.get(r.platformId));
    return new Map([...sets].map(([k, v]) => [k, [...v]]));
  }

  owned(withPc = true): OwnedMarks {
    // Any copy added, changed or gone changes its count, its newest id or its last change.
    const c = this.db.select({ n: sql<number>`count(*)`, last: sql<number>`max(${copies.id})`, changed: sql<string>`max(${copies.updatedAt})` }).from(copies).get();
    const stamp = `${c?.n}|${c?.last}|${c?.changed}|${this.collection.updateRevision()}|${this.catalogs.stamp()}`;
    if (!this.cache || this.cache.stamp !== stamp || Date.now() - this.cache.at > 60_000) {
      const consoles = new Map<string, Set<string>>();
      const add = (title: string, key: string) => {
        const k = matchKey(baseTitle(title));
        if (k) consoles.set(k, (consoles.get(k) ?? new Set()).add(key));
      };
      for (const r of this.db.select({ title: copies.title, key: platforms.key }).from(copies).innerJoin(platforms, eq(platforms.id, copies.platformId)).where(isNull(copies.goneAt)).all()) add(r.title, r.key);
      for (const p of this.catalogs.allMatches()) for (const t of p.match.targets) if (t.status === 'owned') add(t.target.title, p.key);
      const withoutPc = Object.fromEntries([...consoles].map(([k, v]) => [k, [...v]]));
      for (const f of this.pc.enabled() ? this.pc.families() : []) if (f.owned) add(f.title, 'pc');
      this.cache = { stamp, at: Date.now(), owned: Object.fromEntries([...consoles].map(([k, v]) => [k, [...v]])), withoutPc };
    }
    return withPc ? this.cache.owned : this.cache.withoutPc;
  }
}

export function registerMarkRoutes(app: FastifyInstance, marks: MarksService): void {
  // Read once by a page and kept (it changes with the collection): a viewer gets PC only when they may see it.
  app.get('/api/v1/marks', async (request) => ({ owned: marks.owned(shown(request).pc) }));
  // The consoles games came out on, for their covers' grey marks: the pages ask for a few hundred title keys at a time.
  app.post('/api/v1/marks/released', async (request) => {
    const keys = (request.body as { keys?: unknown } | null)?.keys;
    return { released: await marks.released(Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string').slice(0, 1000) : []) };
  });
}
