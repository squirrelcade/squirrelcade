import { shown, type Sees } from './access.js';
import {
  addDays,
  barcodeForms,
  baseTitle,
  classifyIncludes,
  COMPLETENESS_LABELS,
  dayIn,
  diffCollections,
  inBacklog,
  matchKey,
  type Completeness,
  type PlayStatus,
  matchesFilePattern,
  parseAnyCollection,
  consoleFor,
  parseConsoleLabel,
  removalPercent,
  type CollectionDiff,
  type CollectionParseResult,
  type CollectionRow,
  type ParsedConsoleLabel,
} from '@squirrelcade/core';
import { and, asc, desc, eq, inArray, isNotNull, isNull, like, notInArray, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from 'node:fs';
import type { RommLink } from './romm.js';
import type { CopyExtras } from './copyDetails.js';
import { unpackExport, ZipError } from './zip.js';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { appState, barcodes, catalogEntries, collectionItems, copies, imports, pendingPurchases, platformLabels, platforms, pricePoints } from './db/schema.js';
import type { SettingsService } from './settings.js';

/** What became of a collection update: applied, held for the user's confirmation, discarded, or refused. */
export type ImportStatus = 'applied' | 'pending' | 'discarded' | 'refused';

/** Whose files keep a copy up to date (D81): PriceCharting's exports, the owner's spreadsheet, or none (Squirrelcade's own). */
export type CopySource = 'pricecharting' | 'spreadsheet' | 'squirrelcade';

/** What an applied update did to the collection's copies. */
export interface CopyChanges {
  /** Copies the file had that were already in the collection. */
  matched: number;
  /** Copies the file added. */
  added: number;
  /** Copies its kind of file had before and this one doesn't: they wait on Review. */
  missing: number;
  /** Copies that left the collection with it (Settings > Collection > A copy the next update no longer has). */
  gone: number;
}

/** What a collection update found: problems in the file, rows left out, and what changed. */
export interface ImportReport {
  errors: string[];
  warnings: string[];
  excluded: CollectionParseResult['excluded'];
  diff: CollectionDiff | null;
  removalPercent: number;
  /** What it did to the copies, once applied (not in reports from before 0.19.0). */
  copies?: CopyChanges;
}

/** A copy whose file no longer has it, waiting for the owner on Review. */
export interface MissingCopy {
  id: number;
  key: string;
  title: string;
  platform: string | null;
  platformKey: string | null;
  condition: string;
  source: CopySource;
  missingSince: string;
  valueCents: number | null;
  /** Other copies of the same game on that console still in the collection. */
  others: number;
}

/** What the owner said about a copy its file no longer has: still theirs, or gone (sold, or removed for another reason). */
export type MissingAnswer = 'keep' | 'sold' | 'removed';

type CopyRow = typeof copies.$inferSelect;
type ItemRow = typeof collectionItems.$inferSelect;

/** The fields a file's row and a copy share, which an update brings to the copy. */
function itemFields(r: ItemRow) {
  return {
    productId: r.productId,
    title: r.title,
    consoleLabel: r.consoleLabel,
    platformId: r.platformId,
    region: r.region,
    valueCents: r.valueCents,
    costCents: r.costCents,
    includeString: r.includeString,
    conditionString: r.conditionString,
    completeness: r.completeness,
    sealed: r.sealed,
    hasBox: r.hasBox,
    hasManual: r.hasManual,
    sku: r.sku,
    notes: r.notes,
    dateEntered: r.dateEntered,
    datePurchased: r.datePurchased,
    gradingCompany: r.gradingCompany,
    gradingCertId: r.gradingCertId,
    folder: r.folder,
  };
}

/**
 * The fields an owner can change in Squirrelcade, by the name kept in a copy's own fields, and the columns each covers:
 * a file doesn't overwrite them once changed here.
 */
const OWN_FIELDS: Record<string, (keyof ReturnType<typeof itemFields>)[]> = {
  condition: ['includeString', 'conditionString', 'completeness', 'sealed', 'hasBox', 'hasManual'],
  costCents: ['costCents'],
  datePurchased: ['datePurchased'],
  notes: ['notes'],
};

/** A new copy's key: made once, never a product and condition like the keys of copies from before 0.19.0. */
export const newCopyKey = () => `c-${randomBytes(8).toString('hex')}`;

/** A file's kind by its rows' product ids, for an update from before 0.19.0 kept it: a spreadsheet's are Squirrelcade's own ("s-..."). */
const formatOfRows = (rows: { productId: string }[]): CopySource => (rows.length > 0 && rows.every((r) => r.productId.startsWith('s-')) ? 'spreadsheet' : 'pricecharting');

/** How alike a copy and a file's row are beyond product and condition, to pair copies of the same product with the right rows. */
function closeness(c: CopyRow, r: ItemRow): number {
  return [c.datePurchased === r.datePurchased, c.costCents === r.costCents, c.notes === r.notes, c.dateEntered === r.dateEntered, c.sku === r.sku, c.folder === r.folder, c.conditionString === r.conditionString].filter(Boolean).length;
}

/** The same game by its title, as the wishlist compares consoles (spelling and edition marks aside). */
const gameKey = (title: string) => matchKey(baseTitle(title));

/** Why a copy couldn't be added or changed (the message is for the owner). */
export class CopyError extends Error {}

/** The conditions a copy can be given in Squirrelcade, with the include text PriceCharting's export writes for each. */
export const INCLUDE_OF: Record<Exclude<Completeness, 'unknown'>, string> = {
  sealed: 'New Item, Box, and Manual',
  complete: 'Item, Box, and Manual',
  'item-box': 'Item and Box only',
  'item-manual': 'Item and Manual only',
  loose: 'Item Only',
  'box-only': 'Box Only',
  'manual-only': 'Manual Only',
  graded: 'Graded Item',
};

/** The condition words PriceCharting's paste importer reads ("Mario 2 NES Sealed"); a line without one comes in loose. */
const PASTE_WORD: Partial<Record<Completeness, string>> = { sealed: 'Sealed', complete: 'CIB' };

/** A copy of Squirrelcade's own on its way to PriceCharting, or sold here and still listed there. */
export interface SendCopy {
  id: number;
  key: string;
  title: string;
  platform: string | null;
  platformKey: string | null;
  condition: string;
  /** Its line for PriceCharting's paste importer ("Title Console Condition"). */
  line: string;
  /** Whether PriceCharting's importer can take its condition (CIB, Sealed); set the others there by hand. */
  conditionReadThere: boolean;
  addedAt: string;
  sentAt: string | null;
  goneAt: string | null;
  goneReason: string | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A collection update as the history lists it. */
export interface ImportSummary {
  id: number;
  source: string;
  fileName: string;
  fileBytes: number;
  status: ImportStatus;
  current: boolean;
  createdAt: string;
  appliedAt: string | null;
  rowCount: number;
  copyCount: number;
  gameCount: number | null;
  valueCents: number | null;
  costCents: number | null;
  addedCount: number;
  removedCount: number;
  changedCount: number;
  message: string | null;
}

/** A platform's totals in one applied update, for the value by platform over time (Collection > Statistics). */
export interface PlatformTotals {
  key: string;
  name: string;
  games: number;
  copies: number;
  valueCents: number;
  costCents: number;
}

/** An owned game whose value changed since the previous update. */
export interface PriceMove {
  title: string;
  platform: string;
  /** The platform's key, to open the game (null for a copy without a platform). */
  platformKey: string | null;
  /** PriceCharting's include string: which condition the price is for. */
  condition: string;
  beforeCents: number;
  nowCents: number;
  changeCents: number;
  percent: number;
}

/** The collection against its goal (Settings > Collection > Your goal). */
export interface CollectionGoal {
  goal: number;
  counts: 'copies' | 'games';
  /** How many there are now, and 12 months ago (by the day each copy came: bought, else entered, else added here; less the ones that left). */
  now: number;
  yearAgo: number;
  /** The change over those 12 months, a month's worth of it, and how many to go (below 0: over the goal). */
  change: number;
  perMonth: number;
  remaining: number;
  /** The day the goal would be reached at that pace; null once it's reached, or when the collection isn't growing. */
  reachBy: string | null;
}

/** The collection's totals for dashboards (GET /api/v1/stats). */
export interface CollectionStats {
  /** Different games (products) in the current collection. */
  games: number;
  /** Copies, counting quantities. */
  items: number;
  platforms: number;
  /** Platforms with enough different games to be tracked (Settings > Platforms). */
  trackedPlatforms: number;
  value: number;
  cost: number;
  gain: number;
  currency: string;
  /** Games the last collection update added. */
  addedLastUpdate: number;
  lastUpdateAt: string | null;
  /** The date the values are from: the export's own (from its file name), or when it was applied. */
  pricesAsOf: string | null;
  /** How much the collection's value moved since the previous update (copies added or removed, and prices); 0 without one. */
  valueChange: number;
  topPlatform: string | null;
  topPlatformGames: number;
  /** What the copies bought this month and in the last 12 months cost (see spending()). */
  spentThisMonth: number;
  spentLast12Months: number;
}

/** The result of one collection update, and whether the file was one already used. */
export interface ImportOutcome {
  import: ImportSummary;
  report: ImportReport;
  duplicate: boolean;
}

const CURRENT_KEY = 'collection.currentImportId';
/** Kept once the copies were started from the updates' rows (0.19.0): the update they started from, or 0. */
const COPIES_FROM_KEY = 'collection.copiesFrom';
/** Imports whose rows are kept for comparing and rolling back; older ones keep only their summary. */
const KEEP_IMPORT_ROWS = 12;

/** The date in an export's file name, as PriceCharting names them ("collection_20260927.csv" is 2026-09-27); null without one. */
export function exportDate(fileName: string): string | null {
  const m = /(?:^|[^\d])(20\d{2})(\d{2})(\d{2})(?:[^\d]|$)/.exec(fileName);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(5, 10) !== `${mo}-${d}` ? null : `${y}-${mo}-${d}`;
}

/**
 * The collection: its copies, kept by Squirrelcade (D81); updates from PriceCharting exports and spreadsheets (checked,
 * compared, held when they would remove too much, then brought into the copies); its totals, items and platforms,
 * its value over time, and the watched folder.
 */
export class CollectionService {
  /**
   * `imported` fires for every new import: applied, held for confirmation or refused (not for duplicates).
   * `remapped` fires when console names moved to another platform (see remapLabels).
   * `changed` fires whenever the copies changed: an applied update, an answer on Review.
   */
  readonly events = new EventEmitter<{ imported: [outcome: ImportOutcome]; remapped: [labels: string[]]; changed: [] }>();
  /** Counts changes to the copies since the start, for revision(): anywhere (an update), and on each console. */
  private changes = 0;
  private consoleChanges = new Map<number, number>();
  private readonly startedAt = Date.now().toString(36);

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly log: Logger,
  ) {}

  /** The last applied update: the export the values are from, and the one the next is compared with. */
  currentImportId(): number | null {
    const row = this.db.select().from(appState).where(eq(appState.key, CURRENT_KEY)).get();
    return row ? Number(row.value) : null;
  }

  /** Changes whenever the collection's copies change: what caches of anything worked out from them are kept by. */
  revision(): string {
    let each = 0;
    for (const n of this.consoleChanges.values()) each += n;
    return `${this.startedAt}.${this.changes}.${each}`;
  }

  /** Changes with an update (a file's copies brought in, the first start): not with a copy added or changed here. */
  updateRevision(): string {
    return `${this.startedAt}.${this.changes}`;
  }

  /**
   * Changes whenever one console's copies change (or everyone's, with an update): what's worked out per console (its
   * catalog's matching) is kept by it, so a copy bought for one console doesn't make every console start over.
   */
  consoleRevision(platformId: number): string {
    return `${this.startedAt}.${this.changes}.${this.consoleChanges.get(platformId) ?? 0}`;
  }

  /** The copies changed: on these consoles (a copy's own), or anywhere (by default: an update, the first start). */
  private changed(platformIds?: (number | null)[]): void {
    if (platformIds) for (const id of platformIds) this.consoleChanges.set(id ?? -1, (this.consoleChanges.get(id ?? -1) ?? 0) + 1);
    else this.changes++;
    this.events.emit('changed');
  }

  /** Whether there is a collection: at least one copy in it. */
  hasCopies(): boolean {
    return this.db.select({ id: copies.id }).from(copies).where(isNull(copies.goneAt)).limit(1).get() !== undefined;
  }

  /**
   * Starts the collection's copies (0.19.0) from the current update's rows, once: each copy in a row becomes a copy of
   * its own, and the first of a product in a condition keeps that as its key, so the details, loans and photos kept
   * under it stay with it. Returns how many copies it made.
   */
  startCopies(): number {
    if (this.db.select().from(appState).where(eq(appState.key, COPIES_FROM_KEY)).get()) return 0;
    const current = this.currentImportId();
    let made = 0;
    this.db.transaction((tx) => {
      if (current !== null) {
        const at = tx.select({ appliedAt: imports.appliedAt }).from(imports).where(eq(imports.id, current)).get()?.appliedAt ?? new Date().toISOString();
        const rows = tx.select().from(collectionItems).where(eq(collectionItems.importId, current)).orderBy(asc(collectionItems.line), asc(collectionItems.id)).all();
        const source = formatOfRows(rows);
        const seen = new Map<string, number>();
        const values: (typeof copies.$inferInsert)[] = [];
        for (const r of rows) {
          for (let n = 0; n < r.quantity; n++) {
            const legacy = `${r.productId}|${r.includeString}`;
            const count = (seen.get(legacy) ?? 0) + 1;
            seen.set(legacy, count);
            values.push({ ...itemFields(r), key: count === 1 ? legacy : `${legacy}#${count}`, source, fileInclude: r.includeString, addedAt: at, importId: current, seenAt: at, updatedAt: at });
          }
        }
        for (let i = 0; i < values.length; i += 500) tx.insert(copies).values(values.slice(i, i + 500)).run();
        tx.update(imports).set({ format: source }).where(eq(imports.id, current)).run();
        made = values.length;
      }
      tx.insert(appState).values({ key: COPIES_FROM_KEY, value: String(current ?? 0) }).run();
    });
    if (made > 0) {
      this.log.info({ context: 'collection' }, `The collection's ${made} copies are kept by Squirrelcade now, each on its own (from update ${current})`);
      this.changed();
    }
    return made;
  }

  /**
   * Brings an applied update's file into the collection's copies (D81). Each copy in its rows is matched to a copy its
   * kind of file keeps (the same product in the same condition, the closest details first), else to a copy no file of
   * its kind has (the same game on the same console, in the same condition: a copy added in Squirrelcade and sent to
   * PriceCharting, or one from a spreadsheet before PriceCharting); the rest are new copies. A PriceCharting export
   * takes over a copy it matches; a spreadsheet takes over only Squirrelcade's own and leaves PriceCharting's as they are.
   * The copies of its kind it no longer has wait on Review, or leave the collection (Settings > Collection). A copy sold
   * or removed in Squirrelcade that the file still lists stays gone (still to remove there), until a file drops it.
   */
  private merge(tx: Pick<Db, 'select' | 'insert' | 'update'>, importId: number, format: CopySource, at: string): CopyChanges {
    const rows = tx.select().from(collectionItems).where(eq(collectionItems.importId, importId)).orderBy(asc(collectionItems.line), asc(collectionItems.id)).all();
    const live = tx.select().from(copies).where(isNull(copies.goneAt)).orderBy(asc(copies.id)).all();
    const listed = tx.select().from(copies).where(and(isNotNull(copies.goneAt), eq(copies.listedOn, format))).orderBy(asc(copies.id)).all();
    // Copies are matched by the product and condition their file gave them (a condition changed here since stays theirs).
    const pool = (list: CopyRow[]) => {
      const map = new Map<string, CopyRow[]>();
      for (const c of list) {
        const k = `${c.productId}|${c.fileInclude ?? c.includeString}`;
        map.set(k, [...(map.get(k) ?? []), c]);
      }
      return map;
    };
    const byProduct = pool(live.filter((c) => c.source === format));
    const stillListed = pool(listed);
    const others = live.filter((c) => c.source !== format);
    const matched = new Set<number>();
    const updates: { copy: CopyRow; row: ItemRow; takeOver: boolean }[] = [];
    const unmatched: ItemRow[] = [];
    const closest = (list: CopyRow[], r: ItemRow) => {
      let best: CopyRow | undefined;
      for (const c of list) if (!best || closeness(c, r) > closeness(best, r)) best = c;
      if (best) list.splice(list.indexOf(best), 1);
      return best;
    };
    let listedStill = 0;
    for (const r of rows) {
      for (let n = 0; n < r.quantity; n++) {
        const k = `${r.productId}|${r.includeString}`;
        const best = closest(byProduct.get(k) ?? [], r);
        if (best) {
          matched.add(best.id);
          updates.push({ copy: best, row: r, takeOver: false });
          continue;
        }
        // Sold or removed here, still on the file's service: it stays gone, and isn't added again.
        const gone = closest(stillListed.get(k) ?? [], r);
        if (gone) {
          tx.update(copies).set({ importId, seenAt: at, updatedAt: at }).where(eq(copies.id, gone.id)).run();
          listedStill++;
        } else unmatched.push(r);
      }
    }
    // The ones its service no longer lists either: nothing left to remove there.
    for (const c of [...stillListed.values()].flat()) tx.update(copies).set({ listedOn: null, updatedAt: at }).where(eq(copies.id, c.id)).run();
    // Then the copies no file of this kind has: the same game on the same console, in the same condition first; a copy of
    // Squirrelcade's own in any condition after that (PriceCharting's importer reads only CIB and Sealed, and "I bought it"
    // guesses), never a copy another file keeps in another condition (that's a second copy).
    let rest = unmatched;
    for (const strict of [true, false]) {
      const next: ItemRow[] = [];
      for (const r of rest) {
        const game = gameKey(r.title);
        const c = others.find(
          (o) =>
            !matched.has(o.id) &&
            o.platformId === r.platformId &&
            (o.productId === r.productId || gameKey(o.title) === game) &&
            (strict ? o.completeness === r.completeness || o.completeness === 'unknown' || r.completeness === 'unknown' : o.source === 'squirrelcade'),
        );
        if (!c) {
          next.push(r);
          continue;
        }
        matched.add(c.id);
        // A spreadsheet leaves a copy PriceCharting keeps as it is: it only isn't a copy of its own.
        if (format === 'pricecharting' || c.source === 'squirrelcade') updates.push({ copy: c, row: r, takeOver: true });
      }
      rest = next;
    }
    const added = rest;
    for (const { copy, row, takeOver } of updates) {
      const fields: Partial<ReturnType<typeof itemFields>> = itemFields(row);
      for (const own of JSON.parse(copy.ownFields) as string[]) for (const column of OWN_FIELDS[own] ?? []) delete fields[column];
      tx.update(copies)
        .set({ ...fields, ...(takeOver ? { source: format } : {}), fileInclude: row.includeString, importId, seenAt: at, missingSince: null, updatedAt: at })
        .where(eq(copies.id, copy.id))
        .run();
    }
    const values = added.map((r) => ({ ...itemFields(r), key: newCopyKey(), source: format, fileInclude: r.includeString, addedAt: at, importId, seenAt: at, updatedAt: at }));
    for (let i = 0; i < values.length; i += 500) tx.insert(copies).values(values.slice(i, i + 500)).run();
    if (listedStill > 0) this.log.info({ context: 'collection' }, `${listedStill} copies sold or removed in Squirrelcade are still in the file: to remove there`);
    // The copies its kind of file had before and this one doesn't.
    const dropped = [...byProduct.values()].flat();
    const remove = this.settings.get('collection.goneFromFile') === 'remove';
    let missing = 0;
    for (const c of dropped) {
      if (remove) {
        tx.update(copies).set({ goneAt: at, goneReason: 'gone', updatedAt: at }).where(eq(copies.id, c.id)).run();
      } else if (!c.missingSince) {
        tx.update(copies).set({ missingSince: at, updatedAt: at }).where(eq(copies.id, c.id)).run();
        missing++;
      }
    }
    return { matched: matched.size, added: values.length, missing, gone: remove ? dropped.length : 0 };
  }

  /** The copies a file of this kind keeps and still had last time, as the comparison with a new file takes them. */
  private keptBy(format: CopySource): { productId: string; title: string; consoleLabel: string; quantity: number }[] {
    return this.db
      .select({ productId: copies.productId, title: copies.title, consoleLabel: copies.consoleLabel, quantity: copies.quantity })
      .from(copies)
      .where(and(isNull(copies.goneAt), isNull(copies.missingSince), eq(copies.source, format)))
      .all();
  }

  /** Makes an update the current one and brings its file into the copies; its report says what that did. */
  private applyFile(tx: Pick<Db, 'insert' | 'select' | 'update'>, id: number, format: CopySource, at: string, report: ImportReport): ImportReport {
    this.setCurrent(tx, id, at);
    const changes = this.merge(tx, id, format, at);
    const next = { ...report, copies: changes };
    tx.update(imports).set({ report: JSON.stringify(next), format }).where(eq(imports.id, id)).run();
    return next;
  }

  /** The copies whose file no longer has them, waiting for the owner on Review (the longest waiting first). */
  missing(): MissingCopy[] {
    const rows = this.db
      .select({ copy: copies, platform: platforms.name, platformKey: platforms.key })
      .from(copies)
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(and(isNull(copies.goneAt), isNotNull(copies.missingSince)))
      .orderBy(asc(copies.missingSince), asc(copies.title))
      .all();
    if (rows.length === 0) return [];
    const live = this.db.select({ platformId: copies.platformId, title: copies.title }).from(copies).where(isNull(copies.goneAt)).all();
    return rows.map(({ copy: c, platform, platformKey }) => ({
      id: c.id,
      key: c.key,
      title: c.title,
      platform,
      platformKey,
      condition: COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness,
      source: c.source as CopySource,
      missingSince: c.missingSince!,
      valueCents: c.valueCents,
      others: live.filter((o) => o.platformId === c.platformId && gameKey(o.title) === gameKey(c.title)).length - 1,
    }));
  }

  /**
   * The owner's answer about a copy its file no longer has: keep it (a copy of Squirrelcade's own from then on, which no
   * file removes), or it's gone (sold, or removed for another reason). False when there's no such copy waiting.
   */
  answerMissing(id: number, answer: MissingAnswer): boolean {
    const c = this.db.select().from(copies).where(and(eq(copies.id, id), isNull(copies.goneAt), isNotNull(copies.missingSince))).get();
    if (!c) return false;
    const at = new Date().toISOString();
    if (answer === 'keep') this.db.update(copies).set({ source: 'squirrelcade', missingSince: null, updatedAt: at }).where(eq(copies.id, id)).run();
    else this.db.update(copies).set({ goneAt: at, goneReason: answer, updatedAt: at }).where(eq(copies.id, id)).run();
    this.log.info({ context: 'collection' }, `${c.title}: ${answer === 'keep' ? 'kept, though its file no longer has it' : answer === 'sold' ? 'sold' : 'removed'}`);
    this.changed([c.platformId]);
    return true;
  }

  /** A copy in the collection by its id, or null. */
  copy(id: number): CopyRow | null {
    return this.db.select().from(copies).where(and(eq(copies.id, id), isNull(copies.goneAt))).get() ?? null;
  }

  /**
   * The console name PriceCharting's export uses for a platform (what a copy added here is written as, and its line for
   * PriceCharting's importer): the one most of its copies have in its own region, else one of its known names, else the
   * platform's own name.
   */
  private labelFor(platform: typeof platforms.$inferSelect): { consoleLabel: string; region: string } {
    const used = this.db
      .select({ consoleLabel: copies.consoleLabel, region: copies.region, n: sql<number>`count(*)` })
      .from(copies)
      .where(and(eq(copies.platformId, platform.id), isNull(copies.goneAt)))
      .groupBy(copies.consoleLabel, copies.region)
      .orderBy(desc(sql`count(*)`))
      .all();
    const home = this.settings.get('general.homeRegion');
    const best = used.find((u) => u.region === home) ?? used[0];
    if (best) return { consoleLabel: best.consoleLabel, region: best.region };
    const known = this.db.select().from(platformLabels).where(eq(platformLabels.platformId, platform.id)).all();
    const label = known.find((l) => l.region === home) ?? known[0];
    return label ? { consoleLabel: label.label, region: label.region } : { consoleLabel: platform.name, region: home };
  }

  private checked(input: { costCents?: unknown; estimatedCents?: unknown; datePurchased?: unknown; notes?: unknown; completeness?: unknown }) {
    const out: { costCents?: number | null; estimatedCents?: number | null; datePurchased?: string | null; notes?: string; completeness?: Exclude<Completeness, 'unknown'> } = {};
    if (input.estimatedCents !== undefined) {
      const c = input.estimatedCents;
      if (c !== null && (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 100_000_000)) throw new CopyError('An estimate is an amount in cents.');
      out.estimatedCents = c as number | null;
    }
    if (input.completeness !== undefined) {
      if (typeof input.completeness !== 'string' || !(input.completeness in INCLUDE_OF)) throw new CopyError('Choose its condition (sealed, complete, loose...).');
      out.completeness = input.completeness as Exclude<Completeness, 'unknown'>;
    }
    if (input.costCents !== undefined) {
      const c = input.costCents;
      if (c !== null && (typeof c !== 'number' || !Number.isInteger(c) || c < 0 || c > 100_000_000)) throw new CopyError('What you paid is an amount in cents.');
      out.costCents = c as number | null;
    }
    if (input.datePurchased !== undefined) {
      const d = input.datePurchased;
      if (d !== null && d !== '' && (typeof d !== 'string' || !DAY.test(d))) throw new CopyError('The day you bought it is YYYY-MM-DD.');
      out.datePurchased = (d as string | null) || null;
    }
    if (input.notes !== undefined) {
      if (typeof input.notes !== 'string' && input.notes !== null) throw new CopyError('Notes are text.');
      const n = ((input.notes as string | null) ?? '').trim();
      if (n.length > 500) throw new CopyError('Notes hold up to 500 characters.');
      out.notes = n;
    }
    return out;
  }

  /**
   * Adds a copy of Squirrelcade's own (0.20.0, D83): a game you bought or have, on a console, in a condition, with what you
   * paid and when if you like. It counts at once; its value comes with the export that has it (or from another copy
   * of the same product in that condition). It shares a PriceCharting product when you have the game from an export.
   */
  addCopy(input: {
    platformKey: string;
    title: string;
    completeness: unknown;
    costCents?: unknown;
    datePurchased?: unknown;
    notes?: unknown;
    at?: string;
    /** False when the condition is Settings > Collection's guess for a game just bought: the export's then wins. */
    conditionGiven?: boolean;
  }): CopyRow {
    const platform = this.db.select().from(platforms).where(eq(platforms.key, input.platformKey)).get();
    if (!platform) throw new CopyError('No such console.');
    const title = (typeof input.title === 'string' ? input.title : '').trim().replace(/\s+/g, ' ');
    if (!title || title.length > 200) throw new CopyError('Give the game its title (up to 200 characters).');
    const given = this.checked({ completeness: input.completeness ?? '', costCents: input.costCents, datePurchased: input.datePurchased, notes: input.notes });
    const completeness = given.completeness!;
    const at = input.at ?? new Date().toISOString();
    const game = gameKey(title);
    const same = this.db
      .select()
      .from(copies)
      .where(and(isNull(copies.goneAt), eq(copies.platformId, platform.id)))
      .all()
      .filter((c) => gameKey(c.title) === game);
    const fromExport = same.find((c) => !/^[sg]-/.test(c.productId));
    const productId = fromExport?.productId ?? same[0]?.productId ?? `g-${createHash('sha1').update(`${platform.key}|${game}`).digest('hex').slice(0, 12)}`;
    const includeString = INCLUDE_OF[completeness];
    const inc = classifyIncludes(includeString);
    const own = [
      ...(input.conditionGiven === false ? [] : ['condition']),
      ...(given.costCents != null ? ['costCents'] : []),
      ...(given.datePurchased ? ['datePurchased'] : []),
      ...(given.notes ? ['notes'] : []),
    ];
    const row = this.db
      .insert(copies)
      .values({
        key: newCopyKey(),
        productId,
        title,
        ...this.labelFor(platform),
        platformId: platform.id,
        valueCents: same.find((c) => c.productId === productId && c.completeness === completeness && c.valueCents !== null)?.valueCents ?? null,
        costCents: given.costCents ?? null,
        includeString,
        conditionString: '',
        completeness,
        sealed: inc.sealed,
        hasBox: inc.hasBox,
        hasManual: inc.hasManual,
        sku: '',
        notes: given.notes ?? '',
        dateEntered: input.at ? input.at.slice(0, 10) : dayIn(this.settings.get('general.timeZone')),
        datePurchased: given.datePurchased ?? null,
        gradingCompany: '',
        gradingCertId: '',
        folder: '',
        source: 'squirrelcade',
        ownFields: JSON.stringify(own),
        addedAt: at,
        updatedAt: at,
      })
      .returning()
      .get();
    this.log.info({ context: 'collection' }, `Added a copy of ${title} (${platform.name}, ${COMPLETENESS_LABELS[completeness]})`);
    this.changed([platform.id]);
    return row;
  }

  /**
   * Changes a copy's condition, price paid, day bought or notes (any copy, from an export too): what's changed here is
   * the owner's, and no file overwrites it afterwards. Null when there's no such copy in the collection.
   */
  editCopy(id: number, change: { completeness?: unknown; costCents?: unknown; estimatedCents?: unknown; datePurchased?: unknown; notes?: unknown }): CopyRow | null {
    const c = this.copy(id);
    if (!c) return null;
    const given = this.checked(change);
    const own = new Set(JSON.parse(c.ownFields) as string[]);
    const set: Partial<typeof copies.$inferInsert> = {};
    if (given.completeness) {
      const inc = classifyIncludes(INCLUDE_OF[given.completeness]);
      Object.assign(set, { includeString: INCLUDE_OF[given.completeness], completeness: given.completeness, sealed: inc.sealed, hasBox: inc.hasBox, hasManual: inc.hasManual });
      own.add('condition');
    }
    if (given.costCents !== undefined) (set.costCents = given.costCents), own.add('costCents');
    if (given.datePurchased !== undefined) (set.datePurchased = given.datePurchased), own.add('datePurchased');
    if (given.notes !== undefined) (set.notes = given.notes), own.add('notes');
    // The owner's estimate is Squirrelcade's alone (no file has one), so it needs no protecting from files.
    if (given.estimatedCents !== undefined) set.estimatedCents = given.estimatedCents;
    if (Object.keys(set).length === 0) return c;
    const row = this.db
      .update(copies)
      .set({ ...set, ownFields: JSON.stringify([...own]), updatedAt: new Date().toISOString() })
      .where(eq(copies.id, id))
      .returning()
      .get();
    this.changed([c.platformId]);
    return row ?? null;
  }

  /**
   * Takes a copy out of the collection: sold, or removed for another reason. Kept in the table with when and why; one
   * its file still lists stays on the list of copies to remove there. False when there's no such copy.
   */
  removeCopy(id: number, reason: 'sold' | 'removed'): boolean {
    const c = this.copy(id);
    if (!c) return false;
    const at = new Date().toISOString();
    const listedOn = c.source !== 'squirrelcade' && !c.missingSince ? c.source : null;
    this.db.update(copies).set({ goneAt: at, goneReason: reason, listedOn, missingSince: null, updatedAt: at }).where(eq(copies.id, id)).run();
    this.log.info({ context: 'collection' }, `${c.title}: ${reason}${listedOn ? `, still on ${listedOn === 'pricecharting' ? 'PriceCharting' : 'the spreadsheet'}` : ''}`);
    this.changed([c.platformId]);
    return true;
  }

  /** Brings back a copy that left the collection (a sale taken back), as it was before it left. False when there's no such copy gone. */
  restoreCopy(id: number): boolean {
    const c = this.db.select().from(copies).where(and(eq(copies.id, id), isNotNull(copies.goneAt))).get();
    if (!c) return false;
    this.db.update(copies).set({ goneAt: null, goneReason: null, listedOn: null, updatedAt: new Date().toISOString() }).where(eq(copies.id, id)).run();
    this.log.info({ context: 'collection' }, `${c.title} is back in the collection`);
    this.changed([c.platformId]);
    return true;
  }

  /**
   * Undoes a copy just added in Squirrelcade (one no file has had, with nothing kept on it yet): it's as if it never was.
   * False when it's not such a copy.
   */
  undoCopy(id: number, hasExtras: (key: string) => boolean): boolean {
    const c = this.copy(id);
    if (!c || c.source !== 'squirrelcade' || c.seenAt !== null || hasExtras(c.key)) return false;
    this.db.delete(copies).where(eq(copies.id, id)).run();
    this.log.info({ context: 'collection' }, `Took back the copy of ${c.title} just added`);
    this.changed([c.platformId]);
    return true;
  }

  /** The copies added in Squirrelcade no file has had yet, the oldest first ("I bought it" and Add a copy). */
  ownCopies(): (CopyRow & { platformKey: string | null; platform: string | null })[] {
    return this.db
      .select({ copy: copies, platformKey: platforms.key, platform: platforms.name })
      .from(copies)
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(and(isNull(copies.goneAt), eq(copies.source, 'squirrelcade')))
      .orderBy(asc(copies.addedAt), asc(copies.id))
      .all()
      .map((r) => ({ ...r.copy, platformKey: r.platformKey, platform: r.platform }));
  }

  /**
   * PriceCharting's side of the hub (D83): the copies of Squirrelcade's own not on PriceCharting yet, as lines for its paste
   * importer (to send, and sent but not in an export yet), and the copies sold or removed here that its export still lists.
   */
  forPriceCharting(): { toSend: SendCopy[]; waiting: SendCopy[]; toRemove: SendCopy[]; text: string } {
    const item = (c: CopyRow, platformKey: string | null, platform: string | null): SendCopy => {
      const word = PASTE_WORD[c.completeness as Completeness];
      return {
        id: c.id,
        key: c.key,
        title: c.title,
        platform,
        platformKey,
        condition: COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness,
        line: `${c.title} ${c.consoleLabel}${word ? ` ${word}` : ''}`.replace(/\s+/g, ' ').trim(),
        conditionReadThere: word !== undefined || c.completeness === 'loose',
        addedAt: c.addedAt,
        sentAt: c.sentAt,
        goneAt: c.goneAt,
        goneReason: c.goneReason,
      };
    };
    const own = this.ownCopies().map((c) => item(c, c.platformKey, c.platform));
    const toRemove = this.db
      .select({ copy: copies, platformKey: platforms.key, platform: platforms.name })
      .from(copies)
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(and(isNotNull(copies.goneAt), eq(copies.listedOn, 'pricecharting')))
      .orderBy(asc(copies.goneAt))
      .all()
      .map((r) => item(r.copy, r.platformKey, r.platform));
    const toSend = own.filter((c) => c.sentAt === null);
    return { toSend, waiting: own.filter((c) => c.sentAt !== null), toRemove, text: toSend.map((c) => c.line).join('\n') };
  }

  /** Notes the copies as pasted into PriceCharting's importer (they wait for the export that has them); returns how many. */
  markSent(ids: number[]): number {
    if (ids.length === 0) return 0;
    const at = new Date().toISOString();
    const n = this.db
      .update(copies)
      .set({ sentAt: at, updatedAt: at })
      .where(and(inArray(copies.id, ids), isNull(copies.goneAt), eq(copies.source, 'squirrelcade')))
      .run().changes;
    if (n > 0) this.changed([]);
    return n;
  }

  /** Notes copies sold or removed here as removed on their service too (nothing left to do there); returns how many. */
  markRemovedThere(ids: number[]): number {
    if (ids.length === 0) return 0;
    const n = this.db
      .update(copies)
      .set({ listedOn: null, updatedAt: new Date().toISOString() })
      .where(and(inArray(copies.id, ids), isNotNull(copies.goneAt)))
      .run().changes;
    if (n > 0) this.changed([]);
    return n;
  }

  /**
   * Games marked "I bought it" before 0.20.0 (owned until an export had them) become copies of Squirrelcade's own, in the
   * condition Settings > Collection gives a game just bought, once. Returns how many.
   */
  startPurchases(): number {
    const marks = this.db
      .select({ id: pendingPurchases.id, title: catalogEntries.title, platformKey: platforms.key, createdAt: pendingPurchases.createdAt })
      .from(pendingPurchases)
      .innerJoin(catalogEntries, eq(catalogEntries.id, pendingPurchases.entryId))
      .innerJoin(platforms, eq(platforms.id, catalogEntries.platformId))
      .all();
    for (const m of marks) {
      this.addCopy({ platformKey: m.platformKey, title: m.title, completeness: this.settings.get('collection.boughtCondition'), at: m.createdAt, conditionGiven: false });
      this.db.delete(pendingPurchases).where(eq(pendingPurchases.id, m.id)).run();
    }
    return marks.length;
  }

  private setCurrent(tx: Pick<Db, 'insert' | 'select' | 'update'>, id: number, appliedAt: string): void {
    tx.insert(appState)
      .values({ key: CURRENT_KEY, value: String(id) })
      .onConflictDoUpdate({ target: appState.key, set: { value: String(id) } })
      .run();
    this.recordPrices(tx, id, appliedAt);
    this.recordPlatformTotals(tx, id);
  }

  /** Each platform's totals in an update, from its rows, most valuable first; null when its rows are gone. */
  private platformTotalsOf(tx: Pick<Db, 'select'>, importId: number): PlatformTotals[] | null {
    const rows = tx
      .select({
        key: platforms.key,
        name: platforms.name,
        games: sql<number>`count(distinct ${collectionItems.productId})`,
        copies: sql<number>`coalesce(sum(${collectionItems.quantity}), 0)`,
        valueCents: sql<number>`coalesce(sum(${collectionItems.valueCents} * ${collectionItems.quantity}), 0)`,
        costCents: sql<number>`coalesce(sum(${collectionItems.costCents} * ${collectionItems.quantity}), 0)`,
      })
      .from(collectionItems)
      .innerJoin(platforms, eq(platforms.id, collectionItems.platformId))
      .where(eq(collectionItems.importId, importId))
      .groupBy(platforms.id)
      .all();
    if (rows.length === 0) return null;
    return rows
      .map((r) => ({ key: r.key, name: r.name, games: Number(r.games), copies: Number(r.copies), valueCents: Number(r.valueCents), costCents: Number(r.costCents) }))
      .sort((a, b) => b.valueCents - a.valueCents || a.name.localeCompare(b.name));
  }

  /** Keeps an applied update's platform totals with it, so they outlive the pruning of its rows. */
  private recordPlatformTotals(tx: Pick<Db, 'select' | 'update'>, importId: number): boolean {
    const totals = this.platformTotalsOf(tx, importId);
    if (!totals) return false;
    tx.update(imports).set({ platformTotals: JSON.stringify(totals) }).where(eq(imports.id, importId)).run();
    return true;
  }

  /**
   * Fills in the platform totals of applied updates from before they were kept, from the rows still there (an
   * install from before 0.13.0). Returns how many updates it filled in.
   */
  backfillPlatformTotals(): number {
    const missing = this.db
      .select({ id: imports.id })
      .from(imports)
      .where(and(eq(imports.status, 'applied'), isNull(imports.platformTotals)))
      .all();
    let filled = 0;
    this.db.transaction((tx) => {
      for (const { id } of missing) if (this.recordPlatformTotals(tx, id)) filled++;
    });
    if (filled > 0) this.log.info({ context: 'collection' }, `Value by platform started from ${filled} kept update(s)`);
    return filled;
  }

  /**
   * Adds a price point for each copy of an applied update whose value isn't its product's last one, dated by the
   * export's own date when its file name has one ("collection_20260927.csv"), else when it was applied. Returns how many.
   */
  private recordPrices(tx: Pick<Db, 'insert' | 'select'>, importId: number, appliedAt: string): number {
    const fileName = tx.select({ fileName: imports.fileName }).from(imports).where(eq(imports.id, importId)).get()?.fileName ?? '';
    const recordedAt = exportDate(fileName) ?? appliedAt;
    const last = new Map<string, number>();
    for (const p of tx.select({ productId: pricePoints.productId, includeString: pricePoints.includeString, valueCents: pricePoints.valueCents }).from(pricePoints).orderBy(asc(pricePoints.id)).all()) {
      last.set(`${p.productId}|${p.includeString}`, p.valueCents);
    }
    const points = new Map<string, typeof pricePoints.$inferInsert>();
    for (const r of tx.select({ productId: collectionItems.productId, includeString: collectionItems.includeString, valueCents: collectionItems.valueCents }).from(collectionItems).where(eq(collectionItems.importId, importId)).all()) {
      const key = `${r.productId}|${r.includeString}`;
      if (r.valueCents === null || last.get(key) === r.valueCents || points.has(key)) continue;
      points.set(key, { productId: r.productId, includeString: r.includeString, valueCents: r.valueCents, recordedAt, importId });
    }
    const rows = [...points.values()];
    for (let i = 0; i < rows.length; i += 500) tx.insert(pricePoints).values(rows.slice(i, i + 500)).run();
    return rows.length;
  }

  /**
   * Fills the price history from the updates whose rows are still kept, oldest first, when it's empty (an
   * install from before price history). Returns how many points it added.
   */
  backfillPrices(): number {
    if (this.db.select({ id: pricePoints.id }).from(pricePoints).limit(1).get()) return 0;
    const kept = new Set(this.db.selectDistinct({ id: collectionItems.importId }).from(collectionItems).all().map((r) => r.id));
    const applied = this.db.select({ id: imports.id, appliedAt: imports.appliedAt }).from(imports).where(eq(imports.status, 'applied')).orderBy(asc(imports.appliedAt), asc(imports.id)).all();
    let added = 0;
    this.db.transaction((tx) => {
      for (const i of applied) if (kept.has(i.id) && i.appliedAt) added += this.recordPrices(tx, i.id, i.appliedAt);
    });
    if (added > 0) this.log.info({ context: 'collection' }, `Price history started from ${kept.size} kept update(s): ${added} prices`);
    return added;
  }

  /** The value history of products in their conditions ("productId|includeString"), oldest first. */
  priceHistory(keys: { productId: string; includeString: string }[]): Map<string, { date: string; cents: number }[]> {
    const out = new Map<string, { date: string; cents: number }[]>();
    const ids = [...new Set(keys.map((k) => k.productId))];
    if (ids.length === 0) return out;
    const wanted = new Set(keys.map((k) => `${k.productId}|${k.includeString}`));
    for (const p of this.db.select().from(pricePoints).where(inArray(pricePoints.productId, ids)).orderBy(asc(pricePoints.recordedAt), asc(pricePoints.id)).all()) {
      const key = `${p.productId}|${p.includeString}`;
      if (!wanted.has(key)) continue;
      out.set(key, [...(out.get(key) ?? []), { date: p.recordedAt, cents: p.valueCents }]);
    }
    return out;
  }

  private rowsOf(importId: number | null) {
    if (importId === null) return [];
    return this.db
      .select({ productId: collectionItems.productId, title: collectionItems.title, consoleLabel: collectionItems.consoleLabel, quantity: collectionItems.quantity })
      .from(collectionItems)
      .where(eq(collectionItems.importId, importId))
      .all();
  }

  /** Finds or creates the platform for a PriceCharting console name. */
  resolveLabel(label: string): { platformId: number; region: string } {
    const known = this.db.select().from(platformLabels).where(eq(platformLabels.label, label)).get();
    if (known) return { platformId: known.platformId, region: known.region };
    const parsed = parseConsoleLabel(label);
    const platform = this.platformFor(parsed);
    this.db.insert(platformLabels).values({ label, platformId: platform.id, region: parsed.region, source: 'auto' }).run();
    return { platformId: platform.id, region: parsed.region };
  }

  /** The console a copy with this console name counts toward (Settings > Platforms > Region-locked consoles). */
  private consoleOf(parsed: ParsedConsoleLabel): { key: string; name: string } {
    return consoleFor({ key: parsed.platformKey, name: parsed.platformName }, parsed.region, this.settings.get('general.homeRegion'), this.settings.get('platforms.regionLocked'));
  }

  /** The platform for a console name, created when it's new: on a region-locked console, another region's copies get one of their own. */
  private platformFor(parsed: ParsedConsoleLabel): typeof platforms.$inferSelect {
    const target = this.consoleOf(parsed);
    const existing = this.db.select().from(platforms).where(eq(platforms.key, target.key)).get();
    if (existing) return existing;
    const created = this.db
      .insert(platforms)
      .values({ key: target.key, name: target.name, source: parsed.platform ? 'builtin' : 'auto', createdAt: new Date().toISOString() })
      .returning()
      .get();
    if (!parsed.platform) this.log.warn({ context: 'collection' }, `Unknown console name "${parsed.label}" became a new platform "${parsed.platformName}"`);
    return created;
  }

  /**
   * Moves the console names Squirrelcade recognized by itself to the console they count toward now, with
   * every imported copy under them (all imports, so history and comparisons agree): after the
   * region-locked consoles or the home region change, and once on start. Returns the names moved.
   */
  remapLabels(): string[] {
    const keyOf = new Map(this.db.select({ id: platforms.id, key: platforms.key }).from(platforms).all().map((p) => [p.id, p.key]));
    const moved: string[] = [];
    for (const row of this.db.select().from(platformLabels).where(eq(platformLabels.source, 'auto')).all()) {
      const parsed = parseConsoleLabel(row.label);
      if (keyOf.get(row.platformId) === this.consoleOf(parsed).key) continue;
      const platform = this.platformFor(parsed);
      this.db.transaction((tx) => {
        tx.update(platformLabels).set({ platformId: platform.id }).where(eq(platformLabels.label, row.label)).run();
        tx.update(collectionItems).set({ platformId: platform.id }).where(eq(collectionItems.consoleLabel, row.label)).run();
        tx.update(copies).set({ platformId: platform.id }).where(eq(copies.consoleLabel, row.label)).run();
      });
      this.log.info({ context: 'collection' }, `"${row.label}" copies now count toward ${platform.name}`);
      moved.push(row.label);
    }
    if (moved.length > 0) this.events.emit('remapped', moved);
    return moved;
  }

  summaryOf(id: number): ImportSummary | null {
    const row = this.db.select().from(imports).where(eq(imports.id, id)).get();
    if (!row) return null;
    // The report and the platform totals have their own calls (reportOf, history).
    const { report: _report, fileSha256: _sha, platformTotals: _platforms, ...rest } = row;
    return { ...rest, status: row.status as ImportStatus, current: this.currentImportId() === row.id };
  }

  reportOf(id: number): ImportReport | null {
    const row = this.db.select({ report: imports.report }).from(imports).where(eq(imports.id, id)).get();
    return row ? (JSON.parse(row.report) as ImportReport) : null;
  }

  listImports(limit = 50): ImportSummary[] {
    const current = this.currentImportId();
    return this.db
      .select()
      .from(imports)
      .orderBy(desc(imports.id))
      .limit(limit)
      .all()
      .map(({ report: _r, fileSha256: _s, platformTotals: _p, ...rest }) => ({ ...rest, status: rest.status as ImportStatus, current: rest.id === current }));
  }

  /**
   * Imports a PriceCharting collection export (or a spreadsheet of the owner's own). The file becomes the collection
   * right away unless it has errors (refused) or would remove more of the
   * collection than the safety setting allows (pending until confirmed).
   */
  importText(text: string, meta: { source: 'upload' | 'folder' | 'email'; fileName: string }): ImportOutcome {
    const bytes = Buffer.byteLength(text);
    const sha = createHash('sha256').update(text).digest('hex');
    // The import folder never takes the same file twice: a file left in the folder
    // would otherwise undo every later import. An upload of an older export is taken
    // again, so it can bring the collection back to that point; one that matches the
    // current collection or a held import is recognized as already imported.
    const current = this.currentImportId();
    const matches = this.db
      .select({ id: imports.id, status: imports.status })
      .from(imports)
      .where(and(eq(imports.fileSha256, sha), inArray(imports.status, ['applied', 'pending'])))
      .orderBy(desc(imports.id))
      .all();
    const earlier = meta.source === 'upload' ? matches.find((m) => m.id === current || m.status === 'pending') : matches[0];
    if (earlier) {
      return { import: this.summaryOf(earlier.id)!, report: this.reportOf(earlier.id)!, duplicate: true };
    }

    // PriceCharting's export, or else a spreadsheet of the owner's own (Title and Console columns; see spreadsheet.ts).
    const parsed = parseAnyCollection(text, { excludedLabels: this.settings.get('platforms.excludedLabels') });
    if (parsed.format === 'spreadsheet' && parsed.errors.length === 0) {
      parsed.warnings.unshift(`Read as a spreadsheet of your own (not a PriceCharting export): ${parsed.rows.length} rows with a title and a console.`);
    }
    const now = new Date().toISOString();
    const base = {
      source: meta.source,
      fileName: meta.fileName,
      fileSha256: sha,
      fileBytes: bytes,
      createdAt: now,
      rowCount: parsed.rows.length,
      copyCount: parsed.copies,
    };

    if (parsed.errors.length > 0) {
      const report: ImportReport = { errors: parsed.errors, warnings: parsed.warnings, excluded: parsed.excluded, diff: null, removalPercent: 0 };
      const row = this.db
        .insert(imports)
        .values({ ...base, status: 'refused', addedCount: 0, removedCount: 0, changedCount: 0, report: JSON.stringify(report), message: parsed.errors[0] ?? null })
        .returning({ id: imports.id })
        .get();
      this.log.warn({ context: 'collection' }, `Update from ${meta.fileName} refused: ${parsed.errors.join(' ')}`);
      return this.announce({ import: this.summaryOf(row.id)!, report, duplicate: false });
    }

    // Compared with the copies its kind of file keeps (not the ones already waiting on Review).
    const format: CopySource = parsed.format === 'spreadsheet' ? 'spreadsheet' : 'pricecharting';
    const before = this.keptBy(format);
    const totals = {
      gameCount: new Set(parsed.rows.map((r) => r.productId)).size,
      valueCents: parsed.rows.reduce((sum, r) => sum + (r.valueCents ?? 0) * r.quantity, 0),
      costCents: parsed.rows.reduce((sum, r) => sum + (r.costCents ?? 0) * r.quantity, 0),
    };
    const diff = diffCollections(before, parsed.rows);
    const productsBefore = new Set(before.map((r) => r.productId)).size;
    const removal = removalPercent(diff, productsBefore);
    const hold = before.length > 0 && removal > this.settings.get('collection.maxRemovalPercent');
    let report: ImportReport = { errors: [], warnings: parsed.warnings, excluded: parsed.excluded, diff, removalPercent: Math.round(removal * 10) / 10 };
    const labels = new Map<string, { platformId: number; region: string }>();
    for (const label of new Set(parsed.rows.map((r) => r.consoleLabel))) labels.set(label, this.resolveLabel(label));

    const id = this.db.transaction((tx) => {
      const row = tx
        .insert(imports)
        .values({
          ...base,
          ...totals,
          format,
          status: hold ? 'pending' : 'applied',
          appliedAt: hold ? null : now,
          addedCount: diff.added.length,
          removedCount: diff.removed.length,
          changedCount: diff.quantityChanged.length,
          report: JSON.stringify(report),
          message: hold
            ? `Waiting for confirmation: this would remove ${report.removalPercent}% of your collection (${diff.removed.length} games).`
            : null,
        })
        .returning({ id: imports.id })
        .get();
      insertRows(tx, row.id, parsed.rows, labels);
      // Barcodes the file gives (another app's export, such as CLZ's): Store Mode knows these games when they're
      // scanned, with no barcode service. A barcode linked by hand keeps its game, in whatever form it was saved.
      for (const r of parsed.rows) {
        const platformId = r.barcode ? labels.get(r.consoleLabel)?.platformId : undefined;
        if (!r.barcode || platformId === undefined) continue;
        if (tx.select({ code: barcodes.code }).from(barcodes).where(inArray(barcodes.code, barcodeForms(r.barcode))).get()) continue;
        tx.insert(barcodes).values({ code: r.barcode, platformId, title: r.title, source: 'import', createdAt: now }).onConflictDoNothing().run();
      }
      if (!hold) report = this.applyFile(tx, row.id, format, now, report);
      return row.id;
    });
    if (!hold) this.changed();
    const moved = report.copies ? `; copies: ${report.copies.added} new, ${report.copies.missing} to review, ${report.copies.gone} gone` : '';
    this.log.info(
      { context: 'collection' },
      `${hold ? 'Held the update from' : 'Collection updated from'} ${meta.fileName}: ${parsed.rows.length} rows, ${diff.added.length} added, ${diff.removed.length} removed, ${diff.quantityChanged.length} changed${moved}`,
    );
    return this.announce({ import: this.summaryOf(id)!, report, duplicate: false });
  }

  private announce(outcome: ImportOutcome): ImportOutcome {
    this.events.emit('imported', outcome);
    return outcome;
  }

  /**
   * What the collection's copies cost, by the month they were bought: the purchase date, or the day the copy was
   * added when that's empty. Only copies with a cost count, and only those still in the collection (not the ones
   * sold since). The consoles are those of the last 12 months.
   */
  spending(now = new Date()): { months: { month: string; cents: number; copies: number }[]; consoles: { platform: string; cents: number; copies: number }[] } {
    const rows = this.db
      .select({ cost: copies.costCents, quantity: copies.quantity, purchased: copies.datePurchased, entered: copies.dateEntered, platform: platforms.name })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    const byMonth = new Map<string, { cents: number; copies: number }>();
    const byConsole = new Map<string, { cents: number; copies: number }>();
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString().slice(0, 7);
    for (const r of rows) {
      const day = (r.purchased || r.entered || '').slice(0, 10);
      if (!r.cost || r.cost <= 0 || !/^\d{4}-\d{2}/.test(day)) continue;
      const month = day.slice(0, 7);
      const m = byMonth.get(month) ?? { cents: 0, copies: 0 };
      m.cents += r.cost * r.quantity;
      m.copies += r.quantity;
      byMonth.set(month, m);
      if (month >= since) {
        const c = byConsole.get(r.platform) ?? { cents: 0, copies: 0 };
        c.cents += r.cost * r.quantity;
        c.copies += r.quantity;
        byConsole.set(r.platform, c);
      }
    }
    return {
      months: [...byMonth.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, v]) => ({ month, ...v })),
      consoles: [...byConsole.entries()].sort((a, b) => b[1].cents - a[1].cents).map(([platform, v]) => ({ platform, ...v })),
    };
  }

  /** Totals of every applied import, oldest first: how the collection and its value changed. */
  /**
   * The collection's totals at each applied update, in order of their date: the export's own date from its file
   * name ("collection_20260927.csv"), or when it was applied.
   */
  history(): { id: number; fileName: string; appliedAt: string; date: string; games: number; copies: number; valueCents: number; costCents: number; platforms: PlatformTotals[] | null }[] {
    return this.db
      .select()
      .from(imports)
      .where(eq(imports.status, 'applied'))
      .orderBy(asc(imports.appliedAt), asc(imports.id))
      .all()
      .filter((i) => i.appliedAt !== null && i.valueCents !== null && i.gameCount !== null)
      .map((i) => ({
        id: i.id,
        fileName: i.fileName,
        appliedAt: i.appliedAt!,
        date: exportDate(i.fileName) ?? i.appliedAt!,
        games: i.gameCount!,
        copies: i.copyCount,
        valueCents: i.valueCents!,
        costCents: i.costCents ?? 0,
        platforms: i.platformTotals ? (JSON.parse(i.platformTotals) as PlatformTotals[]) : null,
      }))
      .sort((a, b) => a.date.localeCompare(b.date) || a.appliedAt.localeCompare(b.appliedAt));
  }

  /**
   * Platforms an import made tracked: they now have at least the minimum number
   * of different games (Settings > Platforms) and the collection before it didn't.
   */
  newlyTracked(importId: number): { name: string; games: number }[] {
    const min = this.settings.get('platforms.minUniqueGames');
    const applied = this.db.select().from(imports).where(eq(imports.status, 'applied')).orderBy(desc(imports.appliedAt), desc(imports.id)).all();
    const at = applied.findIndex((i) => i.id === importId);
    if (at < 0) return [];
    const kept = new Set(this.db.selectDistinct({ id: collectionItems.importId }).from(collectionItems).all().map((r) => r.id));
    const previous = applied.slice(at + 1).find((i) => kept.has(i.id));
    const counts = (id: number) =>
      new Map(
        this.db
          .select({ name: platforms.name, games: sql<number>`count(distinct ${collectionItems.productId})` })
          .from(collectionItems)
          .innerJoin(platforms, eq(platforms.id, collectionItems.platformId))
          .where(eq(collectionItems.importId, id))
          .groupBy(platforms.id)
          .all()
          .map((r) => [r.name, r.games]),
      );
    const before = previous ? counts(previous.id) : new Map<string, number>();
    return [...counts(importId)]
      .filter(([name, games]) => games >= min && (before.get(name) ?? 0) < min)
      .map(([name, games]) => ({ name, games }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Owned games whose PriceCharting value changed most since the previous
   * applied import, per copy and like for like (same product, same condition).
   */
  priceMovers(limit = 8): {
    since: { fileName: string; appliedAt: string; date: string } | null;
    up: PriceMove[];
    down: PriceMove[];
  } {
    const current = this.currentImportId();
    const empty = { since: null, up: [], down: [] };
    const previous = this.previousImport();
    if (current === null || !previous) return empty;
    const prices = (importId: number) => {
      const map = new Map<string, { title: string; platform: string; platformKey: string | null; condition: string; cents: number }>();
      const rows = this.db
        .select({ productId: collectionItems.productId, title: collectionItems.title, includeString: collectionItems.includeString, valueCents: collectionItems.valueCents, platform: platforms.name, platformKey: platforms.key })
        .from(collectionItems)
        .leftJoin(platforms, eq(platforms.id, collectionItems.platformId))
        .where(eq(collectionItems.importId, importId))
        .all();
      for (const r of rows) {
        if (r.valueCents === null) continue;
        map.set(`${r.productId}|${r.includeString}`, { title: r.title, platform: r.platform ?? '', platformKey: r.platformKey ?? null, condition: r.includeString, cents: r.valueCents });
      }
      return map;
    };
    const before = prices(previous.id);
    const moves: PriceMove[] = [];
    for (const [key, now] of prices(current)) {
      const was = before.get(key);
      if (!was || was.cents <= 0 || was.cents === now.cents) continue;
      moves.push({ ...now, beforeCents: was.cents, nowCents: now.cents, changeCents: now.cents - was.cents, percent: Math.round(((now.cents - was.cents) / was.cents) * 1000) / 10 });
    }
    const strip = ({ cents: _c, ...m }: PriceMove & { cents?: number }) => m;
    return {
      since: { fileName: previous.fileName, appliedAt: previous.appliedAt!, date: exportDate(previous.fileName) ?? previous.appliedAt! },
      up: moves.filter((m) => m.changeCents > 0).sort((a, b) => b.changeCents - a.changeCents).slice(0, limit).map(strip),
      down: moves.filter((m) => m.changeCents < 0).sort((a, b) => a.changeCents - b.changeCents).slice(0, limit).map(strip),
    };
  }

  /** The applied update before the current one whose copies are still kept (pruning drops old updates' rows), or null. */
  private previousImport(): typeof imports.$inferSelect | null {
    const current = this.currentImportId();
    if (current === null) return null;
    const kept = new Set(this.db.selectDistinct({ id: collectionItems.importId }).from(collectionItems).all().map((r) => r.id));
    const applied = this.db.select().from(imports).where(eq(imports.status, 'applied')).orderBy(desc(imports.appliedAt), desc(imports.id)).all();
    const at = applied.findIndex((i) => i.id === current);
    return at < 0 ? null : (applied.slice(at + 1).find((i) => kept.has(i.id)) ?? null);
  }

  /** Each platform's value at the previous update, and that update's date (the export's own when its name has it); null without one. */
  previousPlatformValues(): { date: string; values: Map<number, number> } | null {
    const previous = this.previousImport();
    if (!previous) return null;
    const rows = this.db
      .select({ platformId: collectionItems.platformId, cents: sql<number>`coalesce(sum(${collectionItems.valueCents} * ${collectionItems.quantity}), 0)` })
      .from(collectionItems)
      .where(eq(collectionItems.importId, previous.id))
      .groupBy(collectionItems.platformId)
      .all();
    return {
      date: exportDate(previous.fileName) ?? previous.appliedAt!,
      values: new Map(rows.filter((r) => r.platformId !== null).map((r) => [r.platformId!, Number(r.cents)])),
    };
  }

  /** Makes a held import the current one and brings it into the copies; the comparison is redone against the copies at that moment. */
  apply(id: number): ImportOutcome | null {
    const row = this.db.select().from(imports).where(eq(imports.id, id)).get();
    if (!row || row.status !== 'pending') return null;
    const rows = this.rowsOf(id);
    const format = (row.format as CopySource | null) ?? formatOfRows(rows);
    const diff = diffCollections(this.keptBy(format), rows);
    let report: ImportReport = { ...(JSON.parse(row.report) as ImportReport), diff };
    const appliedAt = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.update(imports)
        .set({
          status: 'applied',
          appliedAt,
          addedCount: diff.added.length,
          removedCount: diff.removed.length,
          changedCount: diff.quantityChanged.length,
          report: JSON.stringify(report),
          message: 'Applied after confirmation.',
        })
        .where(eq(imports.id, id))
        .run();
      report = this.applyFile(tx, id, format, appliedAt, report);
    });
    this.changed();
    this.log.info({ context: 'collection' }, `Held update from ${row.fileName} applied`);
    return this.announce({ import: this.summaryOf(id)!, report, duplicate: false });
  }

  discard(id: number): boolean {
    const row = this.db.select().from(imports).where(eq(imports.id, id)).get();
    if (!row || row.status !== 'pending') return false;
    this.db.transaction((tx) => {
      tx.delete(collectionItems).where(eq(collectionItems.importId, id)).run();
      tx.update(imports).set({ status: 'discarded', message: 'Discarded.' }).where(eq(imports.id, id)).run();
    });
    return true;
  }

  /** Drops the rows of old imports (their summaries stay), always keeping the current and held ones. */
  pruneOldImports(): number {
    const current = this.currentImportId();
    const keep = this.db
      .select({ id: imports.id })
      .from(imports)
      .where(inArray(imports.status, ['applied', 'pending']))
      .orderBy(desc(imports.id))
      .limit(KEEP_IMPORT_ROWS)
      .all()
      .map((r) => r.id);
    if (current !== null) keep.push(current);
    if (keep.length === 0) return 0;
    return this.db.delete(collectionItems).where(notInArray(collectionItems.importId, keep)).run().changes;
  }

  /** Settings > Collection > Playing: games not marked at all count as not played yet. */
  backlogIncludesUnmarked(): boolean {
    return this.settings.get('collection.backlogIncludesUnmarked');
  }

  summary() {
    const current = this.currentImportId();
    const minUnique = this.settings.get('platforms.minUniqueGames');
    const perPlatform = this.db
      .select({
        platformId: platforms.id,
        key: platforms.key,
        name: platforms.name,
        games: sql<number>`count(distinct ${copies.productId})`,
        copies: sql<number>`sum(${copies.quantity})`,
        valueCents: sql<number>`coalesce(sum(${copies.valueCents} * ${copies.quantity}), 0)`,
        costCents: sql<number>`coalesce(sum(${copies.costCents} * ${copies.quantity}), 0)`,
        sealed: sql<number>`sum(case when ${copies.sealed} then ${copies.quantity} else 0 end)`,
      })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .groupBy(platforms.id)
      .orderBy(desc(sql`count(distinct ${copies.productId})`))
      .all()
      .map((p) => ({ ...p, eligible: p.games >= minUnique }));
    const totals = perPlatform.reduce(
      (t, p) => ({ games: t.games + p.games, copies: t.copies + p.copies, valueCents: t.valueCents + p.valueCents, costCents: t.costCents + p.costCents, sealed: t.sealed + p.sealed }),
      { games: 0, copies: 0, valueCents: 0, costCents: 0, sealed: 0 },
    );
    // Games you have more than one copy of (the same PriceCharting item): what makes the copies outnumber the games.
    const repeats = this.db
      .select({ n: sql<number>`sum(${copies.quantity})` })
      .from(copies)
      .where(isNull(copies.goneAt))
      .groupBy(copies.productId)
      .having(sql`sum(${copies.quantity}) > 1`)
      .all();
    return {
      currentImport: current === null ? null : this.summaryOf(current),
      totals: {
        ...totals,
        platforms: perPlatform.length,
        eligiblePlatforms: perPlatform.filter((p) => p.eligible).length,
        repeatGames: repeats.length,
        repeatCopies: repeats.reduce((n, r) => n + Number(r.n) - 1, 0),
      },
      platforms: perPlatform,
    };
  }

  /**
   * The collection against its goal (Settings > Collection > Your goal), or null without one. The pace is the change
   * over the last 12 months: the copies that came (the day bought, else the day entered, else the day added here) less
   * the ones that left (sold, removed or gone); copies taken out before 0.19.0 left no record, so a pace can come out a
   * little high.
   */
  goal(today = dayIn(this.settings.get('general.timeZone'))): CollectionGoal | null {
    const goal = this.settings.get('collection.goal');
    if (!goal || goal <= 0) return null;
    const counts = this.settings.get('collection.goalCounts');
    const rows = this.db
      .select({ productId: copies.productId, platformId: copies.platformId, datePurchased: copies.datePurchased, dateEntered: copies.dateEntered, addedAt: copies.addedAt, goneAt: copies.goneAt })
      .from(copies)
      .where(isNotNull(copies.platformId))
      .all();
    const DAY = /^\d{4}-\d{2}-\d{2}/;
    const came = (r: (typeof rows)[number]) => [r.datePurchased, r.dateEntered, r.addedAt].find((d): d is string => typeof d === 'string' && DAY.test(d))?.slice(0, 10) ?? '0000-00-00';
    const tally = (keep: (r: (typeof rows)[number]) => boolean) => {
      const kept = rows.filter(keep);
      return counts === 'games' ? new Set(kept.map((r) => `${r.platformId}|${r.productId}`)).size : kept.length;
    };
    const then = addDays(today, -365);
    const now = tally((r) => r.goneAt === null);
    const yearAgo = tally((r) => came(r) <= then && (r.goneAt === null || r.goneAt.slice(0, 10) > then));
    const change = now - yearAgo;
    const perMonth = Math.round((change / 12) * 10) / 10;
    const remaining = goal - now;
    const months = remaining > 0 && change > 0 ? remaining / (change / 12) : null;
    return { goal, counts, now, yearAgo, change, perMonth, remaining, reachBy: months !== null && months <= 1200 ? addDays(today, Math.ceil(months * 30.44)) : null };
  }

  /**
   * The collection's totals for dashboards such as Homepage's customapi widget: flat, numbers as
   * numbers, amounts in the currency of Settings > General. Zeros and nulls before the first update.
   */
  stats(): CollectionStats {
    const s = this.summary();
    const top = s.platforms[0] ?? null; // most different games first
    const money = (cents: number) => Math.round(cents) / 100;
    const previous = this.previousImport();
    return {
      games: s.totals.games,
      items: s.totals.copies,
      platforms: s.totals.platforms,
      trackedPlatforms: s.totals.eligiblePlatforms,
      value: money(s.totals.valueCents),
      cost: money(s.totals.costCents),
      gain: money(s.totals.valueCents - s.totals.costCents),
      currency: this.settings.get('general.currency'),
      addedLastUpdate: s.currentImport?.addedCount ?? 0,
      lastUpdateAt: s.currentImport?.appliedAt ?? null,
      pricesAsOf: s.currentImport ? (exportDate(s.currentImport.fileName) ?? s.currentImport.appliedAt) : null,
      // From one export to the next: copies added or removed there, and prices.
      valueChange: money(previous?.valueCents != null && s.currentImport?.valueCents != null ? s.currentImport.valueCents - previous.valueCents : 0),
      topPlatform: top?.name ?? null,
      topPlatformGames: top?.games ?? 0,
      ...this.spent(money),
    };
  }

  /** This month's and the last 12 months' spending, for the dashboard stats. */
  private spent(money: (cents: number) => number): { spentThisMonth: number; spentLast12Months: number } {
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1)).toISOString().slice(0, 7);
    const months = this.spending(now).months;
    return {
      spentThisMonth: money(months.find((m) => m.month === month)?.cents ?? 0),
      spentLast12Months: money(months.filter((m) => m.month >= since).reduce((sum, m) => sum + m.cents, 0)),
    };
  }

  /** The collection's copies, filtered, sorted and a page at a time; `all` gives every match at once (the spreadsheet download). */
  items(query: {
    platform?: string;
    region?: string;
    q?: string;
    completeness?: string;
    sort?: string;
    /** Which way: each column has its own first (title A to Z, value and date added most or newest first). */
    dir?: string;
    page?: number;
    pageSize?: number;
    duplicates?: boolean;
    /** Only the copies waiting on Review (their file no longer has them). */
    missing?: boolean;
    all?: boolean;
    /** A filter worked out beside the collection (play status, the owner's details): the page is taken after it. */
    keep?: (item: { key: string; productId: string; includeString: string; title: string; platformKey: string | null }) => boolean;
  }) {
    const where: SQL[] = [isNull(copies.goneAt)];
    // Games owned more than once: two or more copies of the same product.
    if (query.duplicates) {
      where.push(sql`${copies.productId} in (select product_id from copies where gone_at is null group by product_id having count(*) > 1)`);
    }
    if (query.missing) where.push(isNotNull(copies.missingSince));
    if (query.platform) where.push(eq(platforms.key, query.platform));
    if (query.region) where.push(eq(copies.region, query.region));
    if (query.completeness) where.push(eq(copies.completeness, query.completeness));
    if (query.q) where.push(like(copies.title, `%${query.q.replace(/[%_]/g, '')}%`));
    // A column of the Stash's table, either way (D144): `dir` when it's given, else the column's own first direction.
    // Copies with nothing in the column (no value, no price paid, no date) come last either way.
    const way = (column: Parameters<typeof asc>[0], first: 'asc' | 'desc') => ((query.dir === 'asc' || query.dir === 'desc' ? query.dir : first) === 'asc' ? asc(column) : desc(column));
    const paidFirst = sql`case when coalesce(${copies.costCents}, 0) > 0 then 0 else 1 end`;
    // Conditions best first: graded, sealed, complete, then the parts.
    const condition = sql`case ${copies.completeness} when 'graded' then 0 when 'sealed' then 1 when 'complete' then 2 when 'item-box' then 3 when 'item-manual' then 4 when 'loose' then 5 when 'box-only' then 6 when 'manual-only' then 7 else 8 end`;
    const order = {
      title: [way(copies.title, 'asc'), asc(copies.id)],
      platform: [way(platforms.name, 'asc'), asc(copies.title), asc(copies.id)],
      condition: [way(condition, 'asc'), asc(copies.title), asc(copies.id)],
      value: [sql`${copies.valueCents} is null`, way(copies.valueCents, 'desc'), asc(copies.title), asc(copies.id)],
      paid: [paidFirst, way(copies.costCents, 'desc'), asc(copies.title), asc(copies.id)],
      // What a copy gained since it was bought (value minus price paid); copies without a price paid last.
      gain: [paidFirst, way(sql`coalesce(${copies.valueCents}, 0) - coalesce(${copies.costCents}, 0)`, 'desc'), asc(copies.title), asc(copies.id)],
      added: [sql`${copies.dateEntered} is null`, way(copies.dateEntered, 'desc'), asc(copies.title), asc(copies.id)],
    }[query.sort ?? 'title'] ?? [asc(copies.title), asc(copies.id)];
    const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 1000);
    const page = Math.max(query.page ?? 1, 1);
    const filter = and(...where);
    const rows = this.db
      .select({
        id: copies.id,
        key: copies.key,
        productId: copies.productId,
        title: copies.title,
        consoleLabel: copies.consoleLabel,
        platform: platforms.name,
        platformKey: platforms.key,
        region: copies.region,
        completeness: copies.completeness,
        includeString: copies.includeString,
        conditionString: copies.conditionString,
        sealed: copies.sealed,
        quantity: copies.quantity,
        valueCents: copies.valueCents,
        costCents: copies.costCents,
        estimatedCents: copies.estimatedCents,
        dateEntered: copies.dateEntered,
        datePurchased: copies.datePurchased,
        notes: copies.notes,
        source: copies.source,
        missingSince: copies.missingSince,
      })
      .from(copies)
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(filter)
      .orderBy(...order)
      .$dynamic();
    if (query.keep) {
      const kept = rows.all().filter(query.keep);
      return { total: kept.length, items: query.all ? kept : kept.slice((page - 1) * pageSize, page * pageSize) };
    }
    const total = this.db
      .select({ n: sql<number>`count(*)` })
      .from(copies)
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(filter)
      .get()!.n;
    const items = query.all ? rows.all() : rows.limit(pageSize).offset((page - 1) * pageSize).all();
    return { total, items };
  }

  /** Each owned product's region and PriceCharting console name on a platform ("Super Famicom", Japan): one each, as a product is one release. */
  productRegions(platformId: number): Map<string, { region: string; consoleLabel: string }> {
    const out = new Map<string, { region: string; consoleLabel: string }>();
    const rows = this.db
      .select({ productId: copies.productId, region: copies.region, consoleLabel: copies.consoleLabel })
      .from(copies)
      .where(and(isNull(copies.goneAt), eq(copies.platformId, platformId)))
      .all();
    for (const r of rows) if (!out.has(r.productId)) out.set(r.productId, { region: r.region, consoleLabel: r.consoleLabel });
    return out;
  }

  /** The games and copies owned on a platform per region and PriceCharting console name, the most copies first. */
  regionCounts(platformId: number): { region: string; consoleLabel: string; games: number; copies: number }[] {
    return this.db
      .select({
        region: copies.region,
        consoleLabel: copies.consoleLabel,
        games: sql<number>`count(distinct ${copies.productId})`,
        copies: sql<number>`sum(${copies.quantity})`,
      })
      .from(copies)
      .where(and(isNull(copies.goneAt), eq(copies.platformId, platformId)))
      .groupBy(copies.region, copies.consoleLabel)
      .orderBy(desc(sql`sum(${copies.quantity})`), asc(copies.consoleLabel))
      .all();
  }

  /** Every product in the collection with its platform, once each (for counting matches elsewhere, such as RomM). */
  ownedProducts(): { productId: string; title: string; platformKey: string }[] {
    return this.db
      .selectDistinct({ productId: copies.productId, title: copies.title, platformKey: platforms.key })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
  }

  platformsWithLabels() {
    const all = this.db.select().from(platforms).orderBy(asc(platforms.name)).all();
    const labels = this.db.select().from(platformLabels).all();
    const stats = new Map(this.summary().platforms.map((p) => [p.platformId, p]));
    const minUnique = this.settings.get('platforms.minUniqueGames');
    const before = this.previousPlatformValues();
    return all.map((p) => {
      const s = stats.get(p.id);
      return {
        ...p,
        games: s?.games ?? 0,
        copies: s?.copies ?? 0,
        valueCents: s?.valueCents ?? 0,
        // Its value at the previous update (0 when it had no copies then), and that update's date; null without one.
        valueBeforeCents: before ? (before.values.get(p.id) ?? 0) : null,
        valueSince: before?.date ?? null,
        eligible: (s?.games ?? 0) >= minUnique,
        labels: labels.filter((l) => l.platformId === p.id).map((l) => ({ label: l.label, region: l.region })),
      };
    });
  }

  /**
   * Imports new files from the import folder, oldest name first. Files still
   * being written (changed in the last 30 seconds) wait for the next check.
   */
  scanFolder(folder: string): string {
    if (!this.settings.get('collection.dropFolderEnabled')) return 'The watched folder is turned off.';
    if (!existsSync(folder)) return `The watched folder ${folder} doesn't exist.`;
    const pattern = this.settings.get('collection.importFilePattern');
    const files = readdirSync(folder, { withFileTypes: true })
      .filter((d) => d.isFile() && matchesFilePattern(d.name, pattern))
      .map((d) => d.name)
      .sort();
    const results: string[] = [];
    for (const name of files) {
      const path = join(folder, name);
      if (Date.now() - statSync(path).mtimeMs < 30_000) continue;
      let outcome: ImportOutcome;
      try {
        const file = unpackExport(name, readFileSync(path));
        outcome = this.importText(file.data.toString('utf8'), { source: 'folder', fileName: file.fileName });
      } catch (err) {
        if (!(err instanceof ZipError)) throw err;
        results.push(`${name}: ${err.message}`);
        continue;
      }
      const status = outcome.duplicate ? 'already used' : outcome.import.status;
      results.push(`${name}: ${status}`);
      if (this.settings.get('collection.afterImport') === 'move') {
        const sub = outcome.import.status === 'refused' && !outcome.duplicate ? 'failed' : 'done';
        mkdirSync(join(folder, sub), { recursive: true });
        let target = join(folder, sub, name);
        for (let i = 1; existsSync(target); i++) target = join(folder, sub, name.replace(/(\.[^.]*)?$/, `-${i}$1`));
        renameSync(path, target);
      }
    }
    return results.length > 0 ? results.join('; ') : 'No new files.';
  }
}

function insertRows(tx: Pick<Db, 'insert'>, importId: number, rows: CollectionRow[], labels: Map<string, { platformId: number; region: string }>) {
  const values = rows.map((r) => ({
    importId,
    productId: r.productId,
    title: r.title,
    consoleLabel: r.consoleLabel,
    platformId: labels.get(r.consoleLabel)?.platformId ?? null,
    region: labels.get(r.consoleLabel)?.region ?? 'other',
    valueCents: r.valueCents,
    costCents: r.costCents,
    includeString: r.includeString,
    conditionString: r.conditionString,
    completeness: r.completeness,
    sealed: r.sealed,
    hasBox: r.hasBox,
    hasManual: r.hasManual,
    quantity: r.quantity,
    sku: r.sku,
    notes: r.notes,
    dateEntered: r.dateEntered,
    datePurchased: r.datePurchased,
    gradingCompany: r.gradingCompany,
    gradingCertId: r.gradingCertId,
    folder: r.folder,
    line: r.line,
  }));
  // SQLite limits variables per statement; insert in chunks.
  for (let i = 0; i < values.length; i += 500) tx.insert(collectionItems).values(values.slice(i, i + 500)).run();
}

/** What other parts add to the collection's copies: play status (play.ts) and the owner's details (copyDetails.ts). */
export interface ItemExtras {
  /** A lookup of each copy's play: kept under the catalog game it counts as, or its own title. */
  play?: () => (platformKey: string, productId: string, title: string) => { status: PlayStatus | null; rating: number | null } | null;
  details?: () => CopyExtras;
}

type ItemKeys = { key: string; productId: string; includeString: string; title: string; platformKey: string | null };

/**
 * The Collection page's filters by what's kept beside the collection (?play=, location=, tag=, lent=1, sale=, digital=), for
 * what the requester may see, and the lookups for the rows' play status and details.
 */
export function extraFilters(q: Record<string, string | undefined>, may: Sees, extras: ItemExtras, unmarkedInBacklog: boolean) {
  const playOf = may.play && extras.play ? extras.play() : null;
  const ex = may.details && extras.details ? extras.details() : null;
  const tests: ((i: ItemKeys) => boolean)[] = [];
  const key = (i: { key: string }) => i.key;
  const wanted = q.play;
  if (playOf && wanted) {
    tests.push((i) => {
      const status = (i.platformKey ? playOf(i.platformKey, i.productId, i.title)?.status : null) ?? null;
      return wanted === 'unmarked' ? status === null : wanted === 'backlog' ? inBacklog(status, unmarkedInBacklog) : status === wanted;
    });
  }
  const location = q.location?.toLowerCase();
  const tag = q.tag?.toLowerCase();
  if (ex && location) tests.push((i) => (ex.details.get(key(i))?.location ?? '').toLowerCase() === location);
  if (ex && tag) tests.push((i) => (ex.details.get(key(i))?.tags ?? []).some((t) => t.toLowerCase() === tag));
  if (ex && (q.lent === '1' || q.lent === 'true')) tests.push((i) => ex.lentTo.has(key(i)));
  if (ex && q.sale) tests.push((i) => (q.sale === 'any' ? Boolean(ex.details.get(key(i))?.sale) : ex.details.get(key(i))?.sale === q.sale));
  // A digital copy claimed with the disc, or not yet (0.55.0).
  if (ex && q.digital) tests.push((i) => ex.details.get(key(i))?.digitalClaim === q.digital);
  const keep = tests.length > 0 ? (i: ItemKeys) => tests.every((t) => t(i)) : undefined;
  return { keep, playOf, ex, key };
}

/** The collection: uploads and their history, held updates, totals, items, platforms and the dashboard stats. */
export function registerCollectionRoutes(
  app: FastifyInstance,
  collection: CollectionService,
  /** Cover image id for a game, when IGDB data is there. */
  coverOf: (platformKey: string, title: string) => string | null = () => null,
  /** The link to an owned game in the user's RomM, when there is one (see romm.ts). */
  rommOf: (platformKey: string, title: string, productId: string) => RommLink | null = () => null,
  /** More totals for GET /api/v1/stats from outside the collection (the PC library's). */
  extraStats: () => Record<string, number> = () => ({}),
  /** Play status and the owner's details on each copy, shown and filtered by on the Collection page. */
  extras: ItemExtras = {},
): void {
  app.post('/api/v1/imports', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no-file', message: 'Choose the CSV file PriceCharting sent, or the zip it came in.' });
    let upload: { fileName: string; data: Buffer };
    try {
      upload = unpackExport(file.filename || 'upload.csv', await file.toBuffer());
    } catch (err) {
      if (err instanceof ZipError) return reply.code(400).send({ error: 'bad-zip', message: err.message });
      throw err;
    }
    const outcome = collection.importText(upload.data.toString('utf8'), { source: 'upload', fileName: upload.fileName });
    return reply.code(outcome.duplicate ? 200 : 201).send(outcome);
  });

  // Totals for dashboards, asked for every few minutes: kept for a minute, and fresh after each collection update.
  let stats: { at: number; body: CollectionStats & Record<string, unknown> } | null = null;
  collection.events.on('imported', () => (stats = null));
  collection.events.on('changed', () => (stats = null));
  collection.events.on('remapped', () => (stats = null));
  app.get('/api/v1/stats', async () => {
    if (!stats || Date.now() - stats.at > 60_000) stats = { at: Date.now(), body: { ...collection.stats(), ...extraStats() } };
    return stats.body;
  });

  app.get('/api/v1/imports', async (request) => {
    const limit = Number((request.query as { limit?: string }).limit ?? 50) || 50;
    return collection.listImports(Math.min(Math.max(limit, 1), 500));
  });

  app.get('/api/v1/imports/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const summary = collection.summaryOf(id);
    if (!summary) return reply.code(404).send({ error: 'not-found', message: 'No such update.' });
    return { import: summary, report: collection.reportOf(id) };
  });

  app.post('/api/v1/imports/:id/apply', async (request, reply) => {
    const outcome = collection.apply(Number((request.params as { id: string }).id));
    if (!outcome) return reply.code(409).send({ error: 'not-pending', message: 'Only an update waiting for confirmation can be applied.' });
    return outcome;
  });

  app.post('/api/v1/imports/:id/discard', async (request, reply) => {
    if (!collection.discard(Number((request.params as { id: string }).id))) {
      return reply.code(409).send({ error: 'not-pending', message: 'Only an update waiting for confirmation can be discarded.' });
    }
    return { ok: true };
  });

  // Prices paid are the owner's unless shared with viewers (Settings > Security > Viewers).
  app.get('/api/v1/collection/goal', async () => ({ goal: collection.goal() }));

  app.get('/api/v1/collection/summary', async (request) => {
    const summary = collection.summary();
    if (shown(request).paid) return summary;
    return { ...summary, totals: { ...summary.totals, costCents: 0 }, platforms: summary.platforms.map((p) => ({ ...p, costCents: 0 })) };
  });

  app.get('/api/v1/collection/items', async (request) => {
    const q = request.query as Record<string, string | undefined>;
    const may = shown(request);
    const { keep, playOf, ex, key } = extraFilters(q, may, extras, collection.backlogIncludesUnmarked());
    const result = collection.items({
      platform: q.platform || undefined,
      region: q.region || undefined,
      q: q.q || undefined,
      completeness: q.completeness || undefined,
      // Someone who can't see prices paid can't sort by them either: the order would give them away.
      sort: !may.paid && (q.sort === 'paid' || q.sort === 'gain') ? undefined : q.sort || undefined,
      dir: q.dir || undefined,
      page: q.page ? Number(q.page) : undefined,
      pageSize: q.pageSize ? Number(q.pageSize) : undefined,
      duplicates: q.duplicates === '1' || q.duplicates === 'true',
      missing: q.missing === '1' || q.missing === 'true',
      keep,
    });
    return {
      ...result,
      items: result.items.map((i) => {
        const d = ex?.details.get(key(i));
        return {
          ...i,
          costCents: may.paid ? i.costCents : null,
          // The owner's estimate of a price they don't know (D85): never a price paid, never in a download.
          estimatedCents: may.paid ? i.estimatedCents : null,
          coverId: i.platformKey ? coverOf(i.platformKey, i.title) : null,
          romm: may.romm && i.platformKey ? rommOf(i.platformKey, i.title, i.productId) : null,
          copyKey: key(i),
          play: playOf && i.platformKey ? playOf(i.platformKey, i.productId, i.title) : null,
          details: ex
            ? { location: d?.location ?? null, tags: d?.tags ?? [], sale: d?.sale ?? null, lentTo: ex.lentTo.get(key(i)) ?? [], photos: ex.photos.get(key(i)) ?? 0, tested: ex.tested.get(key(i)) ?? null }
            : null,
        };
      }),
    };
  });

  // A viewer who isn't shown prices paid gets 0 for them, overall and by platform.
  app.get('/api/v1/collection/history', async (request) =>
    shown(request).paid ? collection.history() : collection.history().map((h) => ({ ...h, costCents: 0, platforms: h.platforms?.map((p) => ({ ...p, costCents: 0 })) ?? null })),
  );
  app.get('/api/v1/collection/spending', async () => collection.spending());

  app.get('/api/v1/collection/movers', async () => collection.priceMovers());

  // Copies whose file no longer has them (Review), and the owner's answer about each: keep, sold or removed.
  app.get('/api/v1/collection/missing', async () => collection.missing());
  app.post('/api/v1/collection/missing/:id', async (request, reply) => {
    const answer = (request.body as { answer?: unknown } | null)?.answer;
    if (answer !== 'keep' && answer !== 'sold' && answer !== 'removed') {
      return reply.code(400).send({ error: 'invalid', message: 'Answer keep (you still have it), sold, or removed.' });
    }
    if (!collection.answerMissing(Number((request.params as { id: string }).id), answer)) {
      return reply.code(404).send({ error: 'not-found', message: 'No such copy is waiting on Review.' });
    }
    return { ok: true };
  });

  app.get('/api/v1/platforms', async () => collection.platformsWithLabels());
}
