import { baseTitle, matchKey } from '@squirrelcade/core';
import { eq, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { shown } from './access.js';
import type { CatalogService } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import { copies, platforms } from './db/schema.js';
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

  constructor(
    private readonly db: Db,
    private readonly collection: CollectionService,
    private readonly catalogs: CatalogService,
    private readonly pc: PcService,
  ) {}

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
}
