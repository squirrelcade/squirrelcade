import { baseTitle, KNOWN_PLATFORMS, matchKey, parseCsv, productPlatform, readPurchaseSheet, type PurchaseRow } from '@squirrelcade/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import { appState, copies, platforms, purchaseRows } from './db/schema.js';
import type { Env } from './env.js';
import type { OrderService } from './orders.js';
import type { SettingsService } from './settings.js';

const ROWS_KEY = 'purchaseSheet.rows';
const AUDIT_KEY = 'purchaseSheet.audit';

/** A game bought that's in the collection on that console: its price, day, order and ASIN to write on the copy. */
export interface SheetWrite {
  key: string;
  item: string;
  date: string | null;
  unitCents: number | null;
  orderNumber: string;
  asin: string;
  platformKey: string;
  platform: string;
  title: string;
  copyId: number;
  /** What the copy has already (written only where it has none). */
  copyCostCents: number | null;
  copyDate: string | null;
}

/** A game bought that the collection hasn't on that console (or that Squirrelcade can't name for sure). */
export interface SheetMissing {
  key: string;
  item: string;
  date: string | null;
  unitCents: number | null;
  orderNumber: string;
  platformKey: string | null;
  platform: string | null;
  /** The game Squirrelcade takes it for; null when it isn't sure (then it's for the owner to say). */
  title: string | null;
}

/** The audit (D178): what the sheet's games would change, shown before anything is written. */
export interface SheetAudit {
  at: string;
  rows: number;
  games: number;
  gone: number;
  writes: SheetWrite[];
  missing: SheetMissing[];
  /** Hardware rows that name a console (a console bought, its accessories). */
  consoles: { item: string; date: string | null; platform: string }[];
}

/**
 * A purchases CSV as a source (D178): its folder read on a schedule (it changes nothing), its game rows matched to the
 * collection in the background, the result kept: the audit. Its games' prices, days, orders and ASINs are written on
 * copies, or the ones not in the collection put on the way, only for the rows the owner chooses; each row once.
 */
export class PurchaseSheetService {
  constructor(
    private readonly d: { db: Db; settings: SettingsService; env: Env; log: Logger; collection: CollectionService; orders: OrderService },
  ) {}

  enabled(): boolean {
    return this.d.settings.get('sources.purchaseCsv');
  }

  /** The watched folder: its CSV files are read, and an uploaded one is saved in it. */
  folder(): string {
    return this.d.settings.get('sources.purchaseCsvFolder').trim() || join(this.d.env.configDir, 'purchases');
  }

  private state<T>(key: string): T | null {
    const row = this.d.db.select().from(appState).where(eq(appState.key, key)).get();
    try {
      return row ? (JSON.parse(row.value) as T) : null;
    } catch {
      return null;
    }
  }

  private save(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.d.db.insert(appState).values({ key, value: json }).onConflictDoUpdate({ target: appState.key, set: { value: json } }).run();
  }

  /** The rows of every CSV in the folder, each row once (a later file's row in place of an earlier one's). */
  private async rows(): Promise<PurchaseRow[]> {
    const folder = this.folder();
    if (!existsSync(folder)) throw new Error(`The purchases folder isn't there (${folder}): upload a CSV, or make the folder.`);
    const names = (await readdir(folder)).filter((n) => n.toLowerCase().endsWith('.csv')).sort();
    if (names.length === 0) throw new Error('No CSV in the purchases folder yet.');
    const byKey = new Map<string, PurchaseRow>();
    for (const name of names) {
      const rows = readPurchaseSheet(parseCsv((await readFile(join(folder, name), 'utf8')).replace(/^﻿/, '')));
      if (!rows) {
        this.d.log.warn({ file: name }, "A CSV in the purchases folder isn't a purchases file (no Order # and Item columns): left out");
        continue;
      }
      for (const r of rows) byKey.set(r.key, r);
    }
    return [...byKey.values()];
  }

  /** An uploaded CSV: checked, then saved in the folder for the task to read (nothing in the collection changes). */
  async upload(text: string): Promise<{ rows: number }> {
    const rows = readPurchaseSheet(parseCsv(text.replace(/^﻿/, '')));
    if (!rows) throw new Error("That isn't a purchases CSV: it needs an Order # and an Item column.");
    await mkdir(this.folder(), { recursive: true });
    await writeFile(join(this.folder(), `uploaded-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`), text);
    return { rows: rows.length };
  }

  /** The task: the sheet read and kept, then the audit worked out and kept. Nothing in the collection changes. */
  async refresh(progress: (line: string) => void = () => undefined): Promise<string> {
    if (!this.enabled()) return 'Purchases CSV import is off';
    progress('Reading the purchases CSVs');
    const rows = await this.rows();
    this.save(ROWS_KEY, { at: new Date().toISOString(), rows });
    const audit = await this.work(rows, progress);
    return `${rows.length} rows, ${audit.games} games: ${audit.writes.length} to write on your copies, ${audit.missing.length} not in your collection`;
  }

  /** The audit, as kept (worked out by the task, never on a page's request). */
  audit(): SheetAudit | null {
    return this.state<SheetAudit>(AUDIT_KEY);
  }

  private async work(rows: PurchaseRow[], progress: (line: string) => void): Promise<SheetAudit> {
    const done = new Set(this.d.db.select({ key: purchaseRows.key }).from(purchaseRows).all().map((r) => r.key));
    const names = new Map(this.d.db.select({ key: platforms.key, name: platforms.name }).from(platforms).all().map((p) => [p.key, p.name]));
    const nameOf = (k: string) => names.get(k) ?? KNOWN_PLATFORMS.find((p) => p.key === k)?.name ?? k;
    // The collection's copies by console and title (as catalogs compare titles), read once.
    const mine = new Map<string, { id: number; costCents: number | null; datePurchased: string | null; orderNumber: string | null }[]>();
    for (const c of this.d.db
      .select({ id: copies.id, title: copies.title, key: platforms.key, costCents: copies.costCents, datePurchased: copies.datePurchased, orderNumber: copies.orderNumber })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all()) {
      const k = `${c.key}|${matchKey(baseTitle(c.title))}`;
      mine.set(k, [...(mine.get(k) ?? []), c]);
    }
    const audit: SheetAudit = { at: new Date().toISOString(), rows: rows.length, games: 0, gone: 0, writes: [], missing: [], consoles: [] };
    const taken = new Set<number>();
    for (const [i, r] of rows.entries()) {
      if (i % 20 === 19) {
        progress(`${i + 1} of ${rows.length}`);
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (r.kind === 'hardware') {
        const p = productPlatform(r.item);
        if (p && !r.gone) audit.consoles.push({ item: r.item, date: r.date, platform: nameOf(p) });
        continue;
      }
      if (r.kind !== 'game') continue;
      if (r.gone) {
        audit.gone++;
        continue;
      }
      audit.games++;
      if (done.has(r.key)) continue;
      const game = this.d.orders.gameOf(r.item);
      const owned = game ? (mine.get(`${game.platformKey}|${matchKey(baseTitle(game.title))}`) ?? []) : [];
      // Already written from this order: nothing to do. Else the copy without an order yet, the one without a price first.
      if (owned.some((c) => c.orderNumber === r.orderNumber)) continue;
      // A price of 0 is PriceCharting's for one it wasn't given: no price.
      const copy = owned.filter((c) => !c.orderNumber && !taken.has(c.id)).sort((a, b) => Number(Boolean(a.costCents)) - Number(Boolean(b.costCents)) || a.id - b.id)[0];
      if (game && copy) {
        taken.add(copy.id);
        audit.writes.push({ key: r.key, item: r.item, date: r.date, unitCents: r.unitCents, orderNumber: r.orderNumber, asin: r.asin, platformKey: game.platformKey, platform: nameOf(game.platformKey), title: game.title, copyId: copy.id, copyCostCents: copy.costCents || null, copyDate: copy.datePurchased });
      } else if (!game || owned.length === 0) {
        const p = game?.platformKey ?? productPlatform(r.item);
        audit.missing.push({ key: r.key, item: r.item, date: r.date, unitCents: r.unitCents, orderNumber: r.orderNumber, platformKey: p, platform: p ? nameOf(p) : null, title: game?.title ?? null });
      }
    }
    this.save(AUDIT_KEY, audit);
    return audit;
  }

  /**
   * The owner's choice from the audit: the chosen copies get the sheet's price and day (where they have none), its
   * order number and ASIN; the chosen games not in the collection go on the way, to check and add. Each row once.
   */
  apply(keys: readonly string[]): { written: number; onTheWay: number } {
    const audit = this.audit();
    if (!audit) return { written: 0, onTheWay: 0 };
    const want = new Set(keys);
    const now = new Date().toISOString();
    let written = 0;
    let onTheWay = 0;
    for (const w of audit.writes.filter((x) => want.has(x.key))) {
      if (this.d.db.select().from(purchaseRows).where(eq(purchaseRows.key, w.key)).get()) continue;
      const change: { costCents?: unknown; datePurchased?: unknown } = {};
      if (w.copyCostCents === null && w.unitCents !== null) change.costCents = w.unitCents;
      if (!w.copyDate && w.date) change.datePurchased = w.date;
      if (Object.keys(change).length > 0) this.d.collection.editCopy(w.copyId, change);
      this.d.db.update(copies).set({ orderNumber: w.orderNumber, asin: w.asin || null }).where(and(eq(copies.id, w.copyId), isNull(copies.orderNumber))).run();
      this.d.db.insert(purchaseRows).values({ key: w.key, kind: 'copy', copyId: w.copyId, appliedAt: now }).onConflictDoNothing().run();
      written++;
    }
    for (const m of audit.missing.filter((x) => want.has(x.key))) {
      if (this.d.db.select().from(purchaseRows).where(eq(purchaseRows.key, m.key)).get()) continue;
      this.d.orders.putOnTheWay(`sheet:${m.key}`, {
        store: 'Amazon',
        date: m.date,
        orderNumber: m.orderNumber,
        currency: this.d.settings.get('general.currency'),
        items: [{ title: m.item.slice(0, 200), priceCents: m.unitCents, quantity: 1 }],
        taxCents: null,
        shippingCents: null,
        discountCents: null,
        totalCents: null,
        link: /^\d{3}-\d{7}-\d{7}$/.test(m.orderNumber) ? `https://www.amazon.com/your-orders/order-details?orderID=${m.orderNumber}` : null,
        readBy: 'plain',
      });
      this.d.db.insert(purchaseRows).values({ key: m.key, kind: 'coming', copyId: null, appliedAt: now }).onConflictDoNothing().run();
      onTheWay++;
    }
    // The audit without what's done.
    const applied = new Set(this.d.db.select({ key: purchaseRows.key }).from(purchaseRows).all().map((r) => r.key));
    this.save(AUDIT_KEY, { ...audit, writes: audit.writes.filter((x) => !applied.has(x.key)), missing: audit.missing.filter((x) => !applied.has(x.key)) });
    return { written, onTheWay };
  }
}

export function registerPurchaseSheetRoutes(app: FastifyInstance, sheet: PurchaseSheetService, tasks: { enqueue: (name: string) => boolean }): void {
  app.get('/api/v1/purchase-sheet', async () => ({ on: sheet.enabled(), audit: sheet.audit() }));
  app.post('/api/v1/purchase-sheet/check', async () => ({ queued: tasks.enqueue('purchase-sheet') }));
  app.post('/api/v1/purchase-sheet/upload', async (request, reply) => {
    if (!sheet.enabled()) return reply.code(400).send({ error: 'off', message: 'Turn on Settings > Sources > Purchases CSV first.' });
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no-file', message: 'Choose a purchases CSV.' });
    try {
      const saved = await sheet.upload((await file.toBuffer()).toString('utf8'));
      return { ...saved, queued: tasks.enqueue('purchase-sheet') };
    } catch (err) {
      return reply.code(400).send({ error: 'invalid', message: (err as Error).message });
    }
  });
  app.post('/api/v1/purchase-sheet/apply', async (request, reply) => {
    const keys = (request.body as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) return reply.code(400).send({ error: 'invalid', message: 'Send the rows to write, by their keys.' });
    return sheet.apply(keys as string[]);
  });
}
