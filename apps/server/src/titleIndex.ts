import { baseTitle, editionBase, matchKey, normalizeTitle, type Completeness, type TargetResult } from '@squirrelcade/core';
import { eq, isNull } from 'drizzle-orm';
import type { CatalogService } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import { copies, platforms } from './db/schema.js';

/** One owned product on a console, as lists of games (sets, the Top 100) describe it. */
export interface OwnedCopy {
  productId: string;
  title: string;
  completeness: Completeness;
  sealed: boolean;
  quantity: number;
}

/** The current collection's copies on one console: by title key, by the longer words of their titles (for look-alikes), and by title. */
export interface OwnedOnConsole {
  byKey: Map<string, string[]>;
  byWord: Map<string, Set<string>>;
  titles: Set<string>;
  copies: Map<string, OwnedCopy[]>;
}

/** The keys a title is found by: as written, and without an edition. */
export const keysOf = (title: string): string[] => [...new Set([matchKey(title), matchKey(baseTitle(title)), matchKey(editionBase(title))].filter(Boolean))];

/** The longer words of a title, which look-alikes share. */
export const wordsOf = (title: string): string[] =>
  normalizeTitle(title)
    .split(' ')
    .filter((w) => w.length >= 4);

/**
 * The consoles' catalog games and the collection's copies by the keys of their titles, for lists of games that
 * aren't catalogs (sets, the Top 100 lists): a list's game is owned by its console catalog's answer when the
 * catalog has it (edition rules, mappings and review answers included), otherwise by the owned copies' titles.
 */
export class TitleIndex {
  /** Each console's catalog games by title key, kept for as long as the console's matching is the same object. */
  private readonly keyMaps = new WeakMap<object, Map<string, TargetResult>>();
  /** The collection's copies by console, for the current import. */
  private owned: { revision: string; index: Map<string, OwnedOnConsole> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly catalogs: CatalogService,
    private readonly collection: CollectionService,
  ) {}

  /** Forgets the collection's copies (after an update, or copies moved to another console). */
  invalidate(): void {
    this.owned = null;
  }

  /** The given consoles' catalog games by the keys of their titles and other names. */
  catalog(platformKeys: readonly string[]): Map<string, Map<string, TargetResult>> {
    const out = new Map<string, Map<string, TargetResult>>();
    for (const key of platformKeys) {
      const match = this.catalogs.matchOf(key);
      if (!match) continue;
      let byKey = this.keyMaps.get(match);
      if (!byKey) {
        byKey = new Map<string, TargetResult>();
        const add = (k: string, t: TargetResult) => {
          if (k && !byKey!.has(k)) byKey!.set(k, t);
        };
        // A game's own title first, then its other names, then both without an edition: "Journey" is Journey,
        // though Flower and flOw also go by "Journey Collector's Edition" (the disc with all three).
        for (const t of match.targets) add(matchKey(t.target.title), t);
        for (const t of match.targets) for (const name of t.target.altTitles ?? []) add(matchKey(name), t);
        for (const t of match.targets) for (const name of [t.target.title, ...(t.target.altTitles ?? [])]) for (const k of keysOf(name)) add(k, t);
        this.keyMaps.set(match, byKey);
      }
      out.set(key, byKey);
    }
    return out;
  }

  /** The collection's copies by console (worked out once per change to the copies). */
  ownedByConsole(): Map<string, OwnedOnConsole> {
    const revision = this.collection.revision();
    if (this.owned && this.owned.revision === revision) return this.owned.index;
    const out = new Map<string, OwnedOnConsole>();
    this.owned = { revision, index: out };
    const rows = this.db
      .select({
        productId: copies.productId,
        title: copies.title,
        platform: platforms.key,
        completeness: copies.completeness,
        sealed: copies.sealed,
        quantity: copies.quantity,
      })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    for (const r of rows) {
      const on = out.get(r.platform) ?? { byKey: new Map<string, string[]>(), byWord: new Map<string, Set<string>>(), titles: new Set<string>(), copies: new Map<string, OwnedCopy[]>() };
      on.titles.add(r.title);
      for (const k of keysOf(r.title)) on.byKey.set(k, [...new Set([...(on.byKey.get(k) ?? []), r.title])]);
      for (const w of wordsOf(r.title)) on.byWord.set(w, (on.byWord.get(w) ?? new Set<string>()).add(r.title));
      const copy: OwnedCopy = { productId: r.productId, title: r.title, completeness: r.completeness as Completeness, sealed: r.sealed, quantity: r.quantity };
      on.copies.set(r.title, [...(on.copies.get(r.title) ?? []), copy]);
      out.set(r.platform, on);
    }
    return out;
  }
}
