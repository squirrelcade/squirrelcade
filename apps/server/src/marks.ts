import { baseTitle, matchKey } from '@squirrelcade/core';
import { eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { shown } from './access.js';
import type { CatalogService } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import { catalogEntries, copies, platforms } from './db/schema.js';
import type { IgdbService } from './igdb.js';
import type { PcFamily, PcService } from './pc.js';

/** A PC game's edition and the console game of the same name: the same game when they came out at most this many years apart. */
const PC_EDITION_YEARS = 12;

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
      // One title and console for each key, to tell a PC game's year against (the guard on the PC mark below).
      const sample = new Map<string, { title: string; key: string }>();
      const add = (title: string, key: string) => {
        const k = matchKey(baseTitle(title));
        if (!k) return;
        consoles.set(k, (consoles.get(k) ?? new Set()).add(key));
        if (key !== 'pc' && !sample.has(k)) sample.set(k, { title, key });
      };
      for (const r of this.db.select({ title: copies.title, key: platforms.key }).from(copies).innerJoin(platforms, eq(platforms.id, copies.platformId)).where(isNull(copies.goneAt)).all()) add(r.title, r.key);
      for (const p of this.catalogs.allMatches()) for (const t of p.match.targets) if (t.status === 'owned') add(t.target.title, p.key);
      const withoutPc = Object.fromEntries([...consoles].map(([k, v]) => [k, [...v]]));
      for (const f of this.pc.enabled() ? this.pc.families() : []) {
        if (!f.owned) continue;
        add(f.title, 'pc');
        // Its name without edition words too, as the PC library groups it (2026-11-07: "Grand Theft Auto IV: The Complete
        // Edition" on Steam left Grand Theft Auto IV's PC mark grey), unless the console game of that name came out years
        // apart: SimCity Digital Deluxe Edition (2013) isn't the Super Famicom's SimCity (1991).
        if (f.key && f.key !== matchKey(baseTitle(f.title)) && this.sameGame(f, sample.get(f.key))) consoles.set(f.key, (consoles.get(f.key) ?? new Set()).add('pc'));
      }
      this.cache = { stamp, at: Date.now(), owned: Object.fromEntries([...consoles].map(([k, v]) => [k, [...v]])), withoutPc };
    }
    return withPc ? this.cache.owned : this.cache.withoutPc;
  }

  /**
   * Whether a PC game is the console game that shares its name without edition words: not when both years are known
   * and more than PC_EDITION_YEARS apart (a remaster comes years later; a game of the same name decades later is another).
   */
  private sameGame(f: PcFamily, console: { title: string; key: string } | undefined): boolean {
    if (!console) return true;
    const years = f.records.map((r) => r.releaseYear).filter((y): y is number => typeof y === 'number' && y > 0);
    const released = this.igdb?.findByKey(console.key, console.title)?.released ?? null;
    const consoleYear = released ? Number(released.slice(0, 4)) : Number.NaN;
    if (years.length === 0 || !Number.isFinite(consoleYear)) return true;
    return Math.abs(Math.min(...years) - consoleYear) <= PC_EDITION_YEARS;
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
