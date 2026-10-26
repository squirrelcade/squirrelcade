import { parseCsv } from './csv.js';
import { readOrderEmail, type FoundOrder, type OrderEmail } from './orders.js';

/**
 * Amazon (D176). Its order, shipping and delivery emails name an order's items only by their departments ("Ordered 2
 * items: Video Games, Electronics"), with its number and its grand total: a game bought there is known to be on its
 * way, not which game. Its name comes from the order's own page (pasted, or a screenshot read on the phone), or from
 * Amazon's order history download.
 */

/** An Amazon order number ("111-1234567-7654321"). */
const AMAZON_ORDER = /\b\d{3}-\d{7}-\d{7}\b/;

/** Whether an email is Amazon's. */
export function fromAmazon(address: string): boolean {
  return /(^|[@.])amazon\.[a-z.]+$/i.test(address.trim());
}

/**
 * Amazon's order email, read for what it says (D176): its order number, its total, and one item for each video game in
 * it (its name unknown: "a video game"). Null when it isn't Amazon's "Ordered" email or has no video game.
 */
export function readAmazonOrder(mail: OrderEmail): FoundOrder | null {
  if (!fromAmazon(mail.from)) return null;
  const subject = /^(?:re:\s*|fwd?:\s*)?ordered\s+(\d+)\s+items?:\s*(.+)$/i.exec(mail.subject.trim());
  if (!subject) return null;
  // "2 items: 1 Video Games, 1 Electronics" in the email says how many of each; else the subject's departments, one each.
  const counted = /(\d+)\s+items?:\s*((?:\d+\s+[^,\n]+(?:,\s*)?)+)/i.exec(mail.text);
  let games = 0;
  if (counted) for (const m of counted[2]!.matchAll(/(\d+)\s+([^,\n]+)/g)) if (/video\s*games?/i.test(m[2]!)) games += Number(m[1]);
  if (games === 0 && /video\s*games?/i.test(subject[2]!)) games = 1;
  if (games === 0) return null;
  const number = AMAZON_ORDER.exec(mail.text)?.[0] ?? AMAZON_ORDER.exec(mail.subject)?.[0] ?? null;
  const total = /grand\s+total:?\s*\$?\s*([\d,]+\.\d{2})/i.exec(mail.text);
  return {
    store: 'Amazon',
    date: mail.day,
    orderNumber: number,
    currency: 'USD',
    items: Array.from({ length: games }, () => ({ title: amazonUnknown(number), priceCents: null, quantity: 1 })),
    taxCents: null,
    shippingCents: null,
    discountCents: null,
    totalCents: total ? Math.round(Number(total[1]!.replace(/,/g, '')) * 100) : null,
    link: number ? `https://www.amazon.com/your-orders/order-details?orderID=${number}` : null,
    readBy: 'plain',
  };
}

/** The line an Amazon order's game waits under until it's named. */
export function amazonUnknown(orderNumber: string | null): string {
  return `Amazon order${orderNumber ? ` ${orderNumber}` : ''}: a video game, its name not in the email`;
}

/** Whether a game on the way is an Amazon order's game not named yet. */
export function isAmazonUnknown(listingTitle: string): boolean {
  return /^Amazon order\b.*: a video game, its name not in the email$/.test(listingTitle);
}

/** An order page's lines that aren't its items (Amazon's "Sold by", "Return or replace items", "Buy it again"...). */
const PAGE_NOISE = /^(?:sold by|supplied by|return or replace|return items|condition:|buy it again|view your item|write a product review|track package|ask product question|leave seller feedback|get product support|arriving|delivered|shipped|package was|your package|archive order|share gift receipt|problem with order)\b/i;

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The day an order page says it was placed ("Order placed October 24, 2026", "Ordered on 10/24/2026"). */
export function orderPageDate(text: string): string | null {
  const named = /(?:order(?:ed)?(?:\s+placed)?(?:\s+on)?|date)\s*:?\s*(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})/i.exec(text);
  if (named) return `${named[3]}-${String(MONTHS.indexOf(named[1]!.toLowerCase()) + 1).padStart(2, '0')}-${named[2]!.padStart(2, '0')}`;
  const numeric = /(?:order(?:ed)?(?:\s+placed)?(?:\s+on)?|order date|submitted)\s*:?\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i.exec(text);
  if (numeric) return `${numeric[3]}-${numeric[1]!.padStart(2, '0')}-${numeric[2]!.padStart(2, '0')}`;
  return null;
}

const SHORT_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * The day an order page or email says it arrives ("Arriving November 5", "Expected by Wed, Nov 5", "Estimated delivery:
 * November 5, 2026"; D184), its year the order's (or the next, for a month before the order's). Null when it doesn't say.
 */
export function arrivingDate(text: string, orderDay: string | null): string | null {
  const m = /\b(?:arriving|arrives|expected(?:\s+delivery)?(?:\s+by)?|estimated\s+delivery(?:\s+date)?|delivery\s+estimate|get\s+it(?:\s+by)?|guaranteed\s+delivery)\s*:?\s*(?:(?:mon|tue|tues|wed|wednes|thu|thur|thurs|fri|sat|satur|sun)(?:day)?\.?,?\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?/i.exec(text);
  if (!m) return null;
  const month = SHORT_MONTHS.indexOf(m[1]!.slice(0, 3).toLowerCase()) + 1;
  const day = Number(m[2]);
  if (month < 1 || day < 1 || day > 31) return null;
  let year = m[3] ? Number(m[3]) : Number((orderDay ?? new Date().toISOString()).slice(0, 4));
  if (!m[3] && orderDay && month < Number(orderDay.slice(5, 7))) year++;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * An order page's text (copied from the shop's page, or read from a screenshot), read as an order email is (D176):
 * its items with their prices, its total, tax and shipping, its number and the day it was placed (else `today`).
 * Null when it doesn't read as an order.
 */
export function readOrderPage(text: string, today: string, store?: string): FoundOrder | null {
  const amazon = store === 'Amazon' || /amazon\.com|\bAmazon\b/.test(text);
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !PAGE_NOISE.test(l));
  const order = readOrderEmail({ subject: '', from: amazon ? 'orders@amazon.com' : 'orders@shop.example', fromName: store ?? (amazon ? 'Amazon' : ''), day: orderPageDate(text) ?? today, text: `Order${lines.length > 0 ? '\n' : ''}${lines.join('\n')}` });
  if (!order) return null;
  if (amazon) {
    order.store = 'Amazon';
    order.orderNumber = AMAZON_ORDER.exec(text)?.[0] ?? order.orderNumber;
  } else if (store) order.store = store;
  order.expectedOn = arrivingDate(text, order.date);
  return order;
}

/** One row of Amazon's order history download (Request your data > Your Orders: Retail.OrderHistory.N.csv). */
export interface AmazonHistoryRow {
  orderId: string;
  date: string | null;
  productName: string;
  /** One's price before tax and shipping, in cents. */
  unitPriceCents: number | null;
  quantity: number;
  currency: string;
  status: string;
}

/**
 * Amazon's order history download, read (D176): each item's order, day, full name, price and how many. Its columns are
 * found by their names (Amazon's file has "Order ID", "Order Date", "Product Name", "Unit Price", "Quantity",
 * "Currency" and "Order Status" among some twenty), so a file with them in another order is read the same. Cancelled
 * items are left out. Null when it isn't that file.
 */
export function readAmazonHistory(text: string): AmazonHistoryRow[] | null {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => head.findIndex((h) => names.includes(h));
  const [id, date, name, price, qty, currency, status] = [col('order id'), col('order date'), col('product name'), col('unit price', 'item subtotal', 'purchase price per unit'), col('quantity'), col('currency'), col('order status')];
  if (id < 0 || name < 0 || date < 0) return null;
  const out: AmazonHistoryRow[] = [];
  for (const r of rows.slice(1)) {
    const productName = (r[name] ?? '').trim();
    if (!productName) continue;
    const st = status >= 0 ? (r[status] ?? '').trim() : '';
    if (/cancel/i.test(st)) continue;
    const p = price >= 0 ? Number.parseFloat((r[price] ?? '').replace(/[^\d.]/g, '')) : Number.NaN;
    out.push({
      orderId: (r[id] ?? '').trim(),
      date: /^\d{4}-\d{2}-\d{2}/.exec((r[date] ?? '').trim())?.[0] ?? null,
      productName,
      unitPriceCents: Number.isFinite(p) ? Math.round(p * 100) : null,
      quantity: Math.max(1, Number.parseInt(qty >= 0 ? (r[qty] ?? '1') : '1', 10) || 1),
      currency: (currency >= 0 ? (r[currency] ?? '') : '').trim() || 'USD',
      status: st,
    });
  }
  return out;
}
