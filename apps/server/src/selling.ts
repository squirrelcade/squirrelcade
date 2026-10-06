import {
  COMPLETENESS_LABELS,
  dayIn,
  ebaySoldUrl,
  matchKey,
  baseTitle,
  mediaOf,
  mercariSoldUrl,
  netOfSale,
  priceChartingUrl,
  sellFormUrl,
  toCsv,
  writeListing,
  type Completeness,
  type Listing,
  type Marketplace,
} from '@squirrelcade/core';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { CatalogService } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { CopyCareService } from './copyCare.js';
import type { CopyDetailsService } from './copyDetails.js';
import type { Db } from './db/index.js';
import { barcodes, catalogEntries, copies, copyPhotos, copySales, platforms, pricePoints } from './db/schema.js';
import { catalogTarget } from './games.js';
import type { IgdbService } from './igdb.js';
import type { PlayService } from './play.js';
import type { SettingsService } from './settings.js';
import { writeZip } from './zip.js';

/** Where a copy was sold: the two marketplaces Squirrelcade writes listings for, in person, or elsewhere. */
export const SOLD_VIA = ['ebay', 'mercari', 'local', 'other'] as const;
export type SoldVia = (typeof SOLD_VIA)[number];

/** Why a sale couldn't be recorded (the message is for the owner). */
export class SellingError extends Error {}

/** A copy's listing kit: the listing, its price, its photos and the links to go on with. */
export interface ListingKit {
  copy: { id: number; key: string; title: string; platform: string; platformKey: string; condition: string; completeness: string; costCents: number | null; estimatedCents: number | null };
  listing: Listing;
  price: {
    /** PriceCharting's value for its condition (from the last export), and the owner's asking price. */
    valueCents: number | null;
    askingCents: number | null;
    /** What a sale at the asking price (else the value) brings after the marketplace's fees and shipping. */
    atCents: number | null;
    feesCents: number | null;
    netCents: number | null;
    shippingCostCents: number;
  };
  photos: { taken: { id: number; slot: string | null; caption: string | null }[]; missing: string[] };
  links: { sold: string; sell: string; priceCharting: string };
}

/** A sale, as Collection > Sales lists it. */
export type Sale = typeof copySales.$inferSelect & { netCents: number; gainCents: number | null };

/** A sales total: how many, what they brought (the price and the shipping the buyer paid), the fees and shipping, what's left, and in meals. */
export interface SalesTotal {
  sales: number;
  soldCents: number;
  feesCents: number;
  shippingCostCents: number;
  netCents: number;
  /** What the copies sold had cost (their price paid, else the owner's estimate), and what the sales made over it. */
  paidCents: number;
  gainCents: number;
  meals: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const cents = (value: unknown, what: string): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100_000_000) throw new SellingError(`${what} is an amount in cents.`);
  return value;
};

/**
 * Selling (0.22.0, D86), for the owner's plan to play a game and then sell it: a listing kit for eBay or Mercari from
 * what Squirrelcade knows about a copy (its condition, tests and rips, photos, the game's year and genre, its barcode),
 * with its price (PriceCharting's value, the asking price, what's left after fees) and the searches of sold listings;
 * each sale kept with what it brought, in money and in meals; and the copies worth selling next.
 */
export class SellingService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly collection: CollectionService,
    private readonly details: CopyDetailsService,
    private readonly care: CopyCareService,
    private readonly igdb: IgdbService,
    private readonly catalogs: CatalogService,
    private readonly play: PlayService,
    private readonly log: Logger,
  ) {}

  private live(id: number) {
    return this.db
      .select({ copy: copies, platformKey: platforms.key, platform: platforms.name })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(and(eq(copies.id, id), isNull(copies.goneAt)))
      .get();
  }

  private fees(marketplace: SoldVia): { feePercent: number; orderFeeCents: number } {
    if (marketplace === 'ebay') return { feePercent: this.settings.get('selling.ebayFeePercent'), orderFeeCents: this.settings.get('selling.ebayOrderFeeCents') };
    if (marketplace === 'mercari') return { feePercent: this.settings.get('selling.mercariFeePercent'), orderFeeCents: 0 };
    return { feePercent: 0, orderFeeCents: 0 };
  }

  /** The game's year, genres and publisher: IGDB's, else the catalog's release. */
  private game(platformId: number, platformKey: string, title: string): { year: number | null; genres: string[]; publisher: string | null } {
    const g = this.igdb.find(platformId, title);
    let released = g?.released ?? null;
    if (!released) {
      const target = catalogTarget(this.catalogs, platformKey, title);
      if (target) released = this.db.select({ d: catalogEntries.releaseDate }).from(catalogEntries).where(eq(catalogEntries.id, target.target.id)).get()?.d ?? null;
    }
    const year = released && /^\d{4}/.test(released) ? Number(released.slice(0, 4)) : null;
    return { year, genres: g?.genres ?? [], publisher: g?.publishers?.[0] ?? null };
  }

  /** A barcode Squirrelcade knows for the game on its console (a scan linked to it, or another app's export). */
  private upc(platformId: number, title: string): string | null {
    const key = matchKey(baseTitle(title));
    const row = this.db
      .select({ code: barcodes.code, title: barcodes.title })
      .from(barcodes)
      .where(eq(barcodes.platformId, platformId))
      .all()
      .find((b) => matchKey(baseTitle(b.title)) === key);
    return row?.code ?? null;
  }

  /** The listing kit for a copy on a marketplace; null when there's no such copy in the collection. */
  listing(id: number, marketplace: Marketplace): ListingKit | null {
    const row = this.live(id);
    if (!row) return null;
    const { copy: c, platformKey, platform } = row;
    const game = this.game(c.platformId!, platformKey, c.title);
    const tests = this.details.tests(c.key);
    // The day of its last test and rip in the owner's time zone (an evening test in Arizona is already tomorrow in UTC).
    const timeZone = this.settings.get('general.timeZone');
    const lastOf = (kind: 'test' | 'rip') => {
      const t = tests.find((x) => x.kind === kind);
      return t ? { result: t.result, testedAt: dayIn(timeZone, new Date(t.testedAt)) } : null;
    };
    const detail = this.details.index().get(c.key);
    const photos = this.details.photos(c.key);
    const slots = this.care.slotsOf(c, platformKey);
    const listing = writeListing(
      {
        title: c.title,
        platformName: platform,
        year: game.year,
        completeness: c.completeness,
        media: mediaOf(platformKey),
        region: c.region,
        homeRegion: this.settings.get('general.homeRegion'),
        gradingCompany: c.gradingCompany,
        lastTest: lastOf('test'),
        lastRip: lastOf('rip'),
        saleNote: detail?.saleNote ?? null,
        genres: game.genres,
        upc: this.upc(c.platformId!, c.title),
        photos: photos.length,
        footer: this.settings.get('selling.footer'),
        dateFormat: this.settings.get('general.dateFormat'),
      },
      marketplace,
    );
    if (game.publisher) listing.specifics.splice(listing.specifics.length - 1, 0, { name: 'Publisher', value: game.publisher });
    const at = detail?.askingCents ?? c.valueCents;
    const shippingCostCents = this.settings.get('selling.shippingCents');
    const net = at !== null ? netOfSale({ priceCents: at, ...this.fees(marketplace), shippingCostCents }) : null;
    const site = this.settings.get('selling.ebaySite');
    return {
      copy: {
        id: c.id,
        key: c.key,
        title: c.title,
        platform,
        platformKey,
        condition: COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness,
        completeness: c.completeness,
        costCents: c.costCents,
        estimatedCents: c.estimatedCents,
      },
      listing,
      price: { valueCents: c.valueCents, askingCents: detail?.askingCents ?? null, atCents: at, feesCents: net?.feesCents ?? null, netCents: net?.netCents ?? null, shippingCostCents },
      photos: { taken: photos.map((p) => ({ id: p.id, slot: p.slot, caption: p.caption })), missing: slots.filter((s) => !photos.some((p) => p.slot === s)) },
      links: {
        sold: marketplace === 'ebay' ? ebaySoldUrl(site, c.title, platform) : mercariSoldUrl(c.title, platform),
        sell: sellFormUrl(marketplace, site),
        priceCharting: priceChartingUrl(c.title, platform),
      },
    };
  }

  /** A copy's photos in a zip, the standard ones first and named by their place, to upload to a listing; null without any. */
  photosZip(id: number): { name: string; data: Buffer } | null {
    const row = this.live(id);
    if (!row) return null;
    const photos = this.db.select().from(copyPhotos).where(eq(copyPhotos.copyKey, row.copy.key)).orderBy(asc(copyPhotos.id)).all();
    if (photos.length === 0) return null;
    const slots = this.care.slotsOf(row.copy, row.platformKey);
    const ordered = [...photos].sort((a, b) => (a.slot ? slots.indexOf(a.slot) : 99) - (b.slot ? slots.indexOf(b.slot) : 99) || a.id - b.id);
    const safe = (s: string) => s.replace(/[^\w .-]+/g, '').replace(/\s+/g, ' ').trim();
    const ext = (mime: string) => (mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg');
    const files = ordered.map((p, i) => ({ name: `${String(i + 1).padStart(2, '0')} ${safe(p.slot ?? p.caption ?? 'photo') || 'photo'}.${ext(p.mime)}`, data: p.data }));
    return { name: `${safe(`${row.copy.title} ${row.platform}`) || 'photos'}.zip`, data: writeZip(files) };
  }

  /**
   * Records a sale: where, when (today unless said), for how much, the fees (the marketplace's, worked out, unless
   * given) and shipping (Settings > Collection > Selling unless given); the copy leaves the collection as sold (and, when
   * PriceCharting still lists it, it's on Send to PriceCharting's list to remove there).
   */
  sell(id: number, input: { soldCents?: unknown; marketplace?: unknown; soldAt?: unknown; feesCents?: unknown; shippingCostCents?: unknown; shippingChargedCents?: unknown; note?: unknown }): Sale {
    const row = this.live(id);
    if (!row) throw new SellingError("That copy isn't in your collection.");
    const soldCents = cents(input.soldCents, 'What it sold for');
    if (soldCents === undefined) throw new SellingError('Say what it sold for.');
    const marketplace = (input.marketplace ?? 'ebay') as SoldVia;
    if (!SOLD_VIA.includes(marketplace)) throw new SellingError('Where it sold: ebay, mercari, local or other.');
    if (input.soldAt !== undefined && input.soldAt !== null && (typeof input.soldAt !== 'string' || !DAY.test(input.soldAt))) throw new SellingError('The day it sold is YYYY-MM-DD.');
    const shippingChargedCents = cents(input.shippingChargedCents, 'The shipping the buyer paid') ?? 0;
    const shippingCostCents = cents(input.shippingCostCents, 'What shipping cost you') ?? (marketplace === 'local' ? 0 : this.settings.get('selling.shippingCents'));
    const feesCents = cents(input.feesCents, 'The fees') ?? netOfSale({ priceCents: soldCents, shippingChargedCents, ...this.fees(marketplace) }).feesCents;
    const note = typeof input.note === 'string' ? input.note.trim().slice(0, 200) || null : null;
    const c = row.copy;
    const sale = this.db
      .insert(copySales)
      .values({
        copyId: c.id,
        copyKey: c.key,
        title: c.title,
        platformKey: row.platformKey,
        platform: row.platform,
        completeness: c.completeness,
        marketplace,
        soldAt: (input.soldAt as string | undefined) ?? dayIn(this.settings.get('general.timeZone')),
        soldCents,
        shippingChargedCents,
        feesCents,
        shippingCostCents,
        paidCents: c.costCents && c.costCents > 0 ? c.costCents : null,
        estimatedCents: c.estimatedCents,
        note,
        createdAt: new Date().toISOString(),
      })
      .returning()
      .get();
    this.collection.removeCopy(c.id, 'sold');
    this.log.info({ context: 'selling' }, `${c.title} (${row.platform}) sold on ${marketplace}`);
    return this.withNet(sale);
  }

  private withNet(s: typeof copySales.$inferSelect): Sale {
    const netCents = s.soldCents + s.shippingChargedCents - s.feesCents - s.shippingCostCents;
    const basis = s.paidCents ?? s.estimatedCents;
    return { ...s, netCents, gainCents: basis === null ? null : netCents - basis };
  }

  /** Changes a sale's figures (a fee known later, a typo). Null when there's no such sale. */
  updateSale(id: number, change: { soldCents?: unknown; feesCents?: unknown; shippingCostCents?: unknown; shippingChargedCents?: unknown; soldAt?: unknown; marketplace?: unknown; note?: unknown }): Sale | null {
    const s = this.db.select().from(copySales).where(eq(copySales.id, id)).get();
    if (!s) return null;
    const set: Partial<typeof copySales.$inferInsert> = {};
    for (const [key, what] of [
      ['soldCents', 'What it sold for'],
      ['feesCents', 'The fees'],
      ['shippingCostCents', 'What shipping cost you'],
      ['shippingChargedCents', 'The shipping the buyer paid'],
    ] as const) {
      const v = cents(change[key], what);
      if (v !== undefined) set[key] = v;
    }
    if (change.soldAt !== undefined) {
      if (typeof change.soldAt !== 'string' || !DAY.test(change.soldAt)) throw new SellingError('The day it sold is YYYY-MM-DD.');
      set.soldAt = change.soldAt;
    }
    if (change.marketplace !== undefined) {
      if (!SOLD_VIA.includes(change.marketplace as SoldVia)) throw new SellingError('Where it sold: ebay, mercari, local or other.');
      set.marketplace = change.marketplace as SoldVia;
    }
    if (change.note !== undefined) set.note = typeof change.note === 'string' ? change.note.trim().slice(0, 200) || null : null;
    const row = Object.keys(set).length > 0 ? this.db.update(copySales).set(set).where(eq(copySales.id, id)).returning().get() : s;
    return row ? this.withNet(row) : null;
  }

  /** Takes a sale back (it didn't go through): the sale is forgotten and the copy is back in the collection. */
  undoSale(id: number): boolean {
    const s = this.db.select().from(copySales).where(eq(copySales.id, id)).get();
    if (!s) return false;
    this.db.delete(copySales).where(eq(copySales.id, id)).run();
    this.collection.restoreCopy(s.copyId);
    return true;
  }

  /** Every sale, the newest first, with this month's, this year's and every sale's totals. */
  sales(now = new Date()): { sales: Sale[]; month: SalesTotal; year: SalesTotal; all: SalesTotal; mealCents: number } {
    const sales = this.db.select().from(copySales).orderBy(desc(copySales.soldAt), desc(copySales.id)).all().map((s) => this.withNet(s));
    const today = dayIn(this.settings.get('general.timeZone'), now);
    const mealCents = this.settings.get('selling.mealCents');
    const total = (list: Sale[]): SalesTotal => {
      const t = { sales: list.length, soldCents: 0, feesCents: 0, shippingCostCents: 0, netCents: 0, paidCents: 0, gainCents: 0, meals: 0 };
      for (const s of list) {
        t.soldCents += s.soldCents + s.shippingChargedCents;
        t.feesCents += s.feesCents;
        t.shippingCostCents += s.shippingCostCents;
        t.netCents += s.netCents;
        const basis = s.paidCents ?? s.estimatedCents;
        if (basis !== null) {
          t.paidCents += basis;
          t.gainCents += s.netCents - basis;
        }
      }
      t.meals = mealCents > 0 ? Math.floor(Math.max(t.netCents, 0) / mealCents) : 0;
      return t;
    };
    return {
      sales,
      month: total(sales.filter((s) => s.soldAt.slice(0, 7) === today.slice(0, 7))),
      year: total(sales.filter((s) => s.soldAt.slice(0, 4) === today.slice(0, 4))),
      all: total(sales),
      mealCents,
    };
  }

  /**
   * Copies worth selling next: the games you've finished (beaten, completed or dropped: play one, then sell it), then the
   * games you own more than once (the less complete, less valuable copy), the most valuable first; and the copies worth
   * more lately (the biggest rises in value since about a year ago, or since the first price kept, to sell while it's
   * up). None already for sale nor tagged as a keeper (Settings > Collection > Selling).
   */
  suggestions(limit = 20, now = new Date()): { finished: SuggestedCopy[]; twice: SuggestedCopy[]; rising: SuggestedCopy[] } {
    const keepTag = this.settings.get('selling.keepTag').trim().toLowerCase();
    const index = this.details.index();
    const kept = (key: string) => {
      const d = index.get(key);
      return Boolean(d?.sale) || (keepTag !== '' && (d?.tags ?? []).some((t) => t.toLowerCase() === keepTag));
    };
    const rows = this.db
      .select({ copy: copies, platformKey: platforms.key, platform: platforms.name })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    const plays = this.play.index();
    const view = (r: (typeof rows)[number], why: string): SuggestedCopy => ({
      id: r.copy.id,
      key: r.copy.key,
      title: r.copy.title,
      platform: r.platform,
      platformKey: r.platformKey,
      condition: COMPLETENESS_LABELS[r.copy.completeness as Completeness] ?? r.copy.completeness,
      valueCents: r.copy.valueCents,
      why,
    });
    const byValue = (a: SuggestedCopy, b: SuggestedCopy) => (b.valueCents ?? 0) - (a.valueCents ?? 0) || a.title.localeCompare(b.title);
    const finished = rows
      .filter((r) => !kept(r.copy.key))
      .map((r) => ({ r, status: this.play.ofCopy(plays, r.platformKey, r.copy.productId, r.copy.title)?.status }))
      .filter(({ status }) => status === 'beaten' || status === 'completed' || status === 'dropped')
      .map(({ r, status }) => view(r, status === 'dropped' ? 'You dropped it' : status === 'completed' ? 'You completed it' : 'You beat it'))
      .sort(byValue)
      .slice(0, limit);
    const byProduct = new Map<string, (typeof rows)[number][]>();
    for (const r of rows) byProduct.set(`${r.platformKey}|${r.copy.productId}`, [...(byProduct.get(`${r.platformKey}|${r.copy.productId}`) ?? []), r]);
    const rank: Record<string, number> = { graded: 0, sealed: 1, complete: 2, 'item-box': 3, 'item-manual': 4, loose: 5, 'box-only': 6, 'manual-only': 7, unknown: 8 };
    const twice: SuggestedCopy[] = [];
    for (const list of byProduct.values()) {
      if (list.length < 2) continue;
      // Keep the best copy (most complete, then most valuable); the others could go.
      const sorted = [...list].sort((a, b) => (rank[a.copy.completeness] ?? 9) - (rank[b.copy.completeness] ?? 9) || (b.copy.valueCents ?? 0) - (a.copy.valueCents ?? 0));
      for (const r of sorted.slice(1)) if (!kept(r.copy.key)) twice.push(view(r, `You have ${list.length} copies`));
    }
    // Each product's price in a condition about a year ago: the last point then, else the first kept.
    const yearAgo = new Date(now.getTime() - 365 * 86_400_000).toISOString();
    const baseline = new Map<string, { cents: number; at: string }>();
    for (const pt of this.db.select().from(pricePoints).orderBy(asc(pricePoints.recordedAt), asc(pricePoints.id)).all()) {
      const k = `${pt.productId}|${pt.includeString}`;
      const had = baseline.get(k);
      if (!had || pt.recordedAt <= yearAgo) baseline.set(k, { cents: pt.valueCents, at: pt.recordedAt });
    }
    const rising: SuggestedCopy[] = [];
    for (const r of rows) {
      if (kept(r.copy.key) || r.copy.valueCents === null) continue;
      const was = baseline.get(`${r.copy.productId}|${r.copy.fileInclude ?? r.copy.includeString}`);
      if (!was || was.cents <= 0 || r.copy.valueCents <= was.cents) continue;
      const riseCents = r.copy.valueCents - was.cents;
      rising.push({ ...view(r, 'Worth more lately'), riseCents, risePercent: Math.round((riseCents / was.cents) * 100), since: was.at.slice(0, 10) });
    }
    rising.sort((a, b) => (b.riseCents ?? 0) - (a.riseCents ?? 0) || a.title.localeCompare(b.title));
    return { finished, twice: twice.sort(byValue).slice(0, limit), rising: rising.slice(0, limit) };
  }

  /** Every sale as CSV (Collection > Sales > Download). */
  salesCsv(): string {
    const currency = this.settings.get('general.currency') || 'USD';
    const m = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2));
    const rows: (string | number)[][] = [['Sold on', 'Title', 'Console', 'Condition', 'Where', `Sold for (${currency})`, `Shipping paid by the buyer (${currency})`, `Fees (${currency})`, `Shipping cost (${currency})`, `Net (${currency})`, `Paid (${currency})`, `Gain (${currency})`, 'Note']];
    for (const s of this.sales().sales) {
      rows.push([s.soldAt, s.title, s.platform ?? '', COMPLETENESS_LABELS[s.completeness as Completeness] ?? s.completeness, s.marketplace, m(s.soldCents), m(s.shippingChargedCents), m(s.feesCents), m(s.shippingCostCents), m(s.netCents), m(s.paidCents), m(s.gainCents), s.note ?? '']);
    }
    return toCsv(rows);
  }
}

/** A copy suggested for selling, and why. */
export interface SuggestedCopy {
  id: number;
  key: string;
  title: string;
  platform: string;
  platformKey: string;
  condition: string;
  valueCents: number | null;
  why: string;
  /** Worth more lately: how much its value rose, by how much in percent, and since when (the price it's compared to). */
  riseCents?: number;
  risePercent?: number;
  since?: string;
}

/** Selling's routes (owner only): the listing kit and its photos, recording a sale, the sales and what to sell next. */
export function registerSellingRoutes(app: FastifyInstance, selling: SellingService): void {
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) => {
    if (err instanceof SellingError) return reply.code(400).send({ error: 'invalid', message: err.message });
    throw err;
  };
  const idOf = (request: { params: unknown }) => Number((request.params as { id: string }).id);

  app.get('/api/v1/collection/copies/:id/listing', async (request, reply) => {
    const marketplace = (request.query as { marketplace?: string }).marketplace === 'mercari' ? 'mercari' : 'ebay';
    return selling.listing(idOf(request), marketplace) ?? reply.code(404).send({ error: 'not-found', message: "That copy isn't in your collection." });
  });

  app.get('/api/v1/collection/copies/:id/photos.zip', async (request, reply) => {
    const zip = selling.photosZip(idOf(request));
    if (!zip) return reply.code(404).send({ error: 'not-found', message: 'That copy has no photos.' });
    return reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="${zip.name.replace(/"/g, '')}"`).send(zip.data);
  });

  app.post('/api/v1/collection/copies/:id/sell', async (request, reply) => {
    try {
      return reply.code(201).send(selling.sell(idOf(request), (request.body ?? {}) as Record<string, unknown>));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/v1/sales', async () => selling.sales());
  app.get('/api/v1/sales/suggestions', async () => selling.suggestions());
  app.get('/api/v1/sales/export', async (_request, reply) =>
    reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="squirrelcade-sales-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(selling.salesCsv()),
  );
  app.put('/api/v1/sales/:id', async (request, reply) => {
    try {
      return selling.updateSale(idOf(request), (request.body ?? {}) as Record<string, unknown>) ?? reply.code(404).send({ error: 'not-found', message: 'No such sale.' });
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.delete('/api/v1/sales/:id', async (request) => ({ undone: selling.undoSale(idOf(request)) }));
}
