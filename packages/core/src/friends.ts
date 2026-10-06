import type { Completeness } from './pricecharting.js';

/**
 * Friends' collections (0.56.0, D131): the share file one Squirrelcade gives another (by hand, by email or directly),
 * what in a collection is for trade, and the trades that come out even by market value.
 */

export const SHARE_FORMAT = 'squirrelcade-friend';
export const SHARE_VERSION = 1;

/** One copy in a shared collection: its condition and (when shared) its market value. */
export interface ShareCopy {
  condition: Completeness;
  valueCents: number | null;
}

/** A game in a shared collection: its console, title, PriceCharting product (when it has one) and copies. */
export interface ShareGame {
  platformKey: string;
  platform: string;
  productId: string | null;
  title: string;
  copies: ShareCopy[];
}

/** A game on a shared wishlist. */
export interface ShareWish {
  platformKey: string;
  platform: string;
  title: string;
  rank: number | null;
  acorns: number;
  priority: string;
}

/** A copy its owner would trade: marked for sale or trade, or a spare (a second copy of a game). */
export interface ShareTradeable {
  platformKey: string;
  platform: string;
  productId: string | null;
  title: string;
  condition: Completeness;
  valueCents: number | null;
  kind: 'sale' | 'trade' | 'spare';
  askingCents: number | null;
}

/** What one Squirrelcade shares with a friend's. Prices paid, notes, places, loans and play are never in it. */
export interface ShareFile {
  format: typeof SHARE_FORMAT;
  version: number;
  /** Who it's from, as they chose to be called. */
  from: string;
  /** The code made for this friendship: every file between the two carries the same one. */
  code: string;
  madeAt: string;
  /** The currency of the values in it (cents). */
  currency: string;
  collection?: ShareGame[];
  wishlist?: ShareWish[];
  forTrade?: ShareTradeable[];
}

/** Why a file isn't a share file Squirrelcade can read, in plain words. */
export class ShareFileError extends Error {}

const CONDITIONS = new Set<string>(['sealed', 'complete', 'item-box', 'item-manual', 'loose', 'box-only', 'manual-only', 'graded', 'unknown']);
const MAX_GAMES = 30_000;
const MAX_WISHES = 2_000;
const MAX_TRADEABLE = 5_000;

const str = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string' || !v.trim()) throw new ShareFileError(`The file has a game without ${what}.`);
  return v.trim().slice(0, max);
};
const optStr = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const cents = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : null);
const condition = (v: unknown): Completeness => (typeof v === 'string' && CONDITIONS.has(v) ? (v as Completeness) : 'unknown');

/**
 * Reads a share file (JSON text), checking its shape and keeping only what the format has: anything else is
 * dropped, long text cut, numbers out of range left out. Throws ShareFileError for anything that isn't one.
 */
export function parseShareFile(text: string): ShareFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new ShareFileError("That isn't a Squirrelcade share file (it isn't JSON).");
  }
  const f = raw as Record<string, unknown>;
  if (!f || typeof f !== 'object' || f.format !== SHARE_FORMAT) throw new ShareFileError("That isn't a Squirrelcade share file.");
  if (typeof f.version !== 'number' || f.version < 1) throw new ShareFileError('The share file has no version.');
  if (f.version > SHARE_VERSION) throw new ShareFileError('That share file is from a newer Squirrelcade: update this one to read it.');
  const list = <T>(v: unknown, max: number, read: (x: Record<string, unknown>) => T): T[] | undefined => {
    if (v === undefined || v === null) return undefined;
    if (!Array.isArray(v)) throw new ShareFileError('The share file is damaged (a list is not a list).');
    if (v.length > max) throw new ShareFileError(`The share file has more than ${max} entries in a list.`);
    return v.map((x) => read((x ?? {}) as Record<string, unknown>));
  };
  return {
    format: SHARE_FORMAT,
    version: f.version,
    from: optStr(f.from, 80) ?? 'A friend',
    code: optStr(f.code, 100) ?? '',
    madeAt: typeof f.madeAt === 'string' && !Number.isNaN(Date.parse(f.madeAt)) ? new Date(f.madeAt).toISOString() : new Date().toISOString(),
    currency: optStr(f.currency, 3)?.toUpperCase() ?? 'USD',
    collection: list(f.collection, MAX_GAMES, (g) => ({
      platformKey: str(g.platformKey, 80, 'a console'),
      platform: optStr(g.platform, 80) ?? str(g.platformKey, 80, 'a console'),
      productId: optStr(g.productId, 40),
      title: str(g.title, 300, 'a title'),
      copies: (Array.isArray(g.copies) ? g.copies.slice(0, 200) : [{}]).map((c) => ({ condition: condition((c as Record<string, unknown>)?.condition), valueCents: cents((c as Record<string, unknown>)?.valueCents) })),
    })),
    wishlist: list(f.wishlist, MAX_WISHES, (w) => ({
      platformKey: str(w.platformKey, 80, 'a console'),
      platform: optStr(w.platform, 80) ?? str(w.platformKey, 80, 'a console'),
      title: str(w.title, 300, 'a title'),
      rank: typeof w.rank === 'number' && Number.isInteger(w.rank) && w.rank > 0 ? w.rank : null,
      acorns: typeof w.acorns === 'number' && Number.isFinite(w.acorns) ? Math.round(w.acorns) : 0,
      priority: optStr(w.priority, 20) ?? '',
    })),
    forTrade: list(f.forTrade, MAX_TRADEABLE, (t) => ({
      platformKey: str(t.platformKey, 80, 'a console'),
      platform: optStr(t.platform, 80) ?? str(t.platformKey, 80, 'a console'),
      productId: optStr(t.productId, 40),
      title: str(t.title, 300, 'a title'),
      condition: condition(t.condition),
      valueCents: cents(t.valueCents),
      kind: t.kind === 'sale' || t.kind === 'trade' ? t.kind : 'spare',
      askingCents: cents(t.askingCents),
    })),
  };
}

/** How good a condition is to keep: the best copy of a game stays, the others are spares. */
const KEEP_ORDER: Completeness[] = ['graded', 'sealed', 'complete', 'item-box', 'item-manual', 'loose', 'box-only', 'manual-only', 'unknown'];

/**
 * The spares among copies: of each product's copies, all but the one to keep (the best condition, then the most
 * valuable). A copy of a product owned once is never a spare.
 */
export function sparesOf<T extends { productId: string; completeness: Completeness; valueCents: number | null }>(copies: readonly T[]): T[] {
  const byProduct = new Map<string, T[]>();
  for (const c of copies) byProduct.set(c.productId, [...(byProduct.get(c.productId) ?? []), c]);
  const out: T[] = [];
  for (const list of byProduct.values()) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => KEEP_ORDER.indexOf(a.completeness) - KEEP_ORDER.indexOf(b.completeness) || (b.valueCents ?? 0) - (a.valueCents ?? 0));
    out.push(...sorted.slice(1));
  }
  return out;
}

/** An offer for something: the items given, their total, and how far that is from the value asked (a percentage). */
export interface TradeOffer<T> {
  items: T[];
  totalCents: number;
  /** (total - target) / target, in percent: negative is less than its value. */
  diffPct: number;
}

/**
 * Offers that come out even for a target value: one item within the margin, else two, else three (the 40 most
 * promising, to keep it quick), from a pool of tradeable items with known values. Items the other side wants count
 * first; then the fewest items, then the closest total. A target of no value has no offers.
 */
export function evenOffers<T extends { valueCents: number | null; wanted?: boolean }>(targetCents: number, pool: readonly T[], marginPct: number, limit = 8): TradeOffer<T>[] {
  if (!(targetCents > 0)) return [];
  const lo = targetCents * (1 - marginPct / 100);
  const hi = targetCents * (1 + marginPct / 100);
  const items = pool.filter((p) => (p.valueCents ?? 0) > 0 && (p.valueCents ?? 0) <= hi);
  const offers: TradeOffer<T>[] = [];
  const add = (picked: T[]) => {
    const total = picked.reduce((n, p) => n + (p.valueCents ?? 0), 0);
    if (total >= lo && total <= hi) offers.push({ items: picked, totalCents: total, diffPct: Math.round(((total - targetCents) / targetCents) * 1000) / 10 });
  };
  for (const a of items) add([a]);
  // Pairs and threes from the most promising: what the other side wants, then values near the target's share.
  const promising = [...items].sort((a, b) => Number(Boolean(b.wanted)) - Number(Boolean(a.wanted)) || Math.abs((a.valueCents ?? 0) - targetCents / 2) - Math.abs((b.valueCents ?? 0) - targetCents / 2)).slice(0, 120);
  if (offers.length < limit) for (let i = 0; i < promising.length; i++) for (let j = i + 1; j < promising.length; j++) add([promising[i]!, promising[j]!]);
  if (offers.length < limit) {
    const few = promising.slice(0, 40);
    for (let i = 0; i < few.length; i++) for (let j = i + 1; j < few.length; j++) for (let k = j + 1; k < few.length; k++) add([few[i]!, few[j]!, few[k]!]);
  }
  const wantedCount = (o: TradeOffer<T>) => o.items.filter((i) => i.wanted).length;
  return offers.sort((a, b) => wantedCount(b) / b.items.length - wantedCount(a) / a.items.length || a.items.length - b.items.length || Math.abs(a.diffPct) - Math.abs(b.diffPct)).slice(0, limit);
}
