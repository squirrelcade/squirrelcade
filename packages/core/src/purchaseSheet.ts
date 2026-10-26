/**
 * A purchases spreadsheet (D178): one row per item bought (an Amazon order history kept in a Google Sheet, or its CSV),
 * read only. Its columns are found by their names, so a sheet with them in another order, or more of them, reads the
 * same: Order date, Order #, Item, ASIN, Qty, Unit price, Line total, Sold by, Condition, Shipment status, Cancelled,
 * Video game? (Yes, or Accessory/hardware), Product page.
 */

import { arrivingDate } from './amazon.js';

/** One item of the sheet. */
export interface PurchaseRow {
  /** Order number and ASIN together: the row's key, so it's brought in once. */
  key: string;
  date: string | null;
  orderNumber: string;
  item: string;
  asin: string;
  quantity: number;
  /** One's price, before tax and shipping, in cents. */
  unitCents: number | null;
  seller: string;
  condition: string;
  status: string;
  /** The sheet's own guess ("Video game?"): only a hint (D184), Squirrelcade decides what's a game itself. */
  kind: 'game' | 'hardware' | 'other';
  /** Cancelled, returned or refunded: not a purchase. */
  gone: boolean;
  /** Not shipped yet (a pre-order), and the day it's expected when the status says (D184). */
  coming: boolean;
  expectedOn: string | null;
}

const money = (s: string | undefined) => {
  const n = Number.parseFloat((s ?? '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};

/** The sheet's rows (the first is its header), read; null when it hasn't the columns (Order #, Item). */
export function readPurchaseSheet(rows: readonly (readonly string[])[]): PurchaseRow[] | null {
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const c = {
    date: col('order date', 'date'),
    order: col('order #', 'order id', 'order number', 'order'),
    item: col('item', 'product name', 'title'),
    asin: col('asin'),
    qty: col('qty', 'quantity'),
    unit: col('unit price', 'price'),
    seller: col('sold by', 'seller'),
    condition: col('condition'),
    status: col('shipment status', 'status', 'order status'),
    cancelled: col('cancelled', 'canceled'),
    game: col('video game?', 'video game', 'kind'),
  };
  if (c.order < 0 || c.item < 0) return null;
  const at = (r: readonly string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const out: PurchaseRow[] = [];
  for (const r of rows.slice(1)) {
    const item = at(r, c.item);
    const orderNumber = at(r, c.order);
    if (!item || !orderNumber) continue;
    const status = at(r, c.status);
    const cancelled = at(r, c.cancelled);
    const kind = at(r, c.game).toLowerCase();
    const asin = at(r, c.asin);
    out.push({
      key: `${orderNumber}|${asin || item}`,
      date: /^\d{4}-\d{2}-\d{2}/.exec(at(r, c.date))?.[0] ?? null,
      orderNumber,
      item,
      asin,
      quantity: Math.max(1, Number.parseInt(at(r, c.qty), 10) || 1),
      unitCents: money(at(r, c.unit)),
      seller: at(r, c.seller),
      condition: at(r, c.condition),
      status,
      kind: kind === 'yes' || kind === 'game' ? 'game' : /accessor|hardware/.test(kind) ? 'hardware' : 'other',
      gone: /^(yes|true|1|x)$/i.test(cancelled) || /^cancel|return complete|refund/i.test(status),
      coming: /not yet shipped|pre-?order|arriving|preparing for shipment|shipping soon|release date/i.test(status),
      expectedOn: arrivingDate(status, /^\d{4}-\d{2}-\d{2}/.exec(at(r, c.date))?.[0] ?? null),
    });
  }
  return out;
}
