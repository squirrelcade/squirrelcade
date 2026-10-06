import { normalizeBarcode, normalizeTitle, searchRank } from '@squirrelcade/core';
import { ApiError } from './api';
import type { Answer } from './choices';

/**
 * Store Mode without a connection. Store Mode keeps a copy of every answer it can give (GET
 * /api/v1/lookup/offline) in this browser's storage, updated each time it opens, and answers from it when
 * Squirrelcade can't be reached: no signal in a store, a store's Wi-Fi sign-in page, a server that's down.
 * Settings > Interface > "Answer without a connection" turns it off; signing out removes the copy.
 */

/** One game in the copy: its answer with short keys (see OfflineGame in the server's lookup.ts). */
export interface OfflineGame {
  p: number;
  t: string;
  a: Answer;
  as?: string[];
  on?: string[];
  pc?: string[];
  m?: string[];
  w?: { score: number; priority: string; rank: number | null };
  s?: string[];
  n?: string;
  pending?: true;
  e?: number;
}

/** The server's copy of Store Mode's answers. */
export interface OfflineCopy {
  version: 1;
  builtAt: string;
  platforms: { key: string; name: string }[];
  games: OfflineGame[];
  barcodes: [string, number, string][];
}

/** The copy as this browser keeps it: its tag, and when Squirrelcade last confirmed it was current. */
export interface SavedCopy {
  copy: OfflineCopy;
  etag: string;
  savedAt: string;
}

/** A Store Mode answer made from the copy: the fields a search gives, without the ones that need the server. */
export interface OfflineResult {
  platformKey: string;
  platform: string;
  title: string;
  answer: Answer;
  ownedAs: string[];
  ownedOn: string[];
  ownedOnPc: string[];
  maybe: string[];
  wishlist: { score: number; priority: string; rank: number | null } | null;
  sets: string[];
  note: string | null;
  pending: boolean;
  /** The catalog game's id, for "I bought it" (catalog games only). */
  entryId?: number;
}

/** A game marked bought in Store Mode without a connection, kept in this browser until Squirrelcade answers. */
export interface QueuedPurchase {
  entryId: number;
  title: string;
  platform: string;
  at: string;
}

const DB_NAME = 'squirrelcade';
const STORE = 'offline';
const KEY = 'store-mode';
/** How long Store Mode waits for Squirrelcade before answering from the copy, when it has one. */
export const OFFLINE_WAIT_MS = 6000;
/** The same for a barcode, which the server may ask a barcode service about first (it waits up to 6 seconds). */
export const BARCODE_WAIT_MS = 10000;

/** The copy read or saved last in this page, so a search doesn't read storage each time. */
let memory: SavedCopy | null = null;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/** The copy saved in this browser, or null (none yet, or storage is off, as in some private windows). */
export async function readCopy(): Promise<SavedCopy | null> {
  if (memory) return memory;
  try {
    const saved = await withStore<SavedCopy | undefined>('readonly', (s) => s.get(KEY));
    memory = saved && saved.copy?.version === 1 && Array.isArray(saved.copy.games) ? saved : null;
  } catch {
    memory = null;
  }
  return memory;
}

async function writeCopy(saved: SavedCopy): Promise<void> {
  memory = saved;
  try {
    await withStore('readwrite', (s) => s.put(saved, KEY));
  } catch {
    // Storage is off or full: the copy lasts as long as the page.
  }
}

/**
 * Who was signed in on this browser, kept (no password or token, only the name and role) so Squirrelcade can open
 * with no connection at all when Store Mode's copy is here: the server can't say then. Forgotten on signing out.
 */
const LAST_SESSION = 'squirrelcade.lastSession';

export interface RememberedSession {
  setupRequired: boolean;
  authenticated: boolean;
  username: string | null;
  via: 'session' | 'apikey' | 'local' | null;
  role: 'owner' | 'viewer' | null;
  publicCheck: 'off' | 'phones' | 'everywhere';
}

export function rememberSession(session: RememberedSession): void {
  try {
    if (session.authenticated) localStorage.setItem(LAST_SESSION, JSON.stringify(session));
    else localStorage.removeItem(LAST_SESSION);
  } catch {
    // Storage is off: no opening without a connection.
  }
}

/** The sign-in to open with when Squirrelcade can't be reached: only while Store Mode's copy is kept here. */
export async function offlineSession(): Promise<RememberedSession | null> {
  try {
    const kept = localStorage.getItem(LAST_SESSION);
    const session = kept ? (JSON.parse(kept) as RememberedSession) : null;
    return session?.authenticated && (await readCopy()) ? session : null;
  } catch {
    return null;
  }
}

/** Removes the copy, and purchases not sent yet, from this browser (signing out, or the setting turned off). */
export async function clearCopy(): Promise<void> {
  memory = null;
  queueMemory = [];
  try {
    localStorage.removeItem(LAST_SESSION);
  } catch {
    // Nothing kept.
  }
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
    await withStore('readwrite', (s) => s.delete(QUEUE_KEY));
  } catch {
    // Nothing kept.
  }
}

const QUEUE_KEY = 'store-mode-bought';
/** The purchases kept, for a browser whose storage is off (then they last as long as the page). */
let queueMemory: QueuedPurchase[] = [];

/** The games marked bought without a connection and not sent yet, oldest first. */
export async function queuedPurchases(): Promise<QueuedPurchase[]> {
  try {
    const list = await withStore<QueuedPurchase[] | undefined>('readonly', (s) => s.get(QUEUE_KEY));
    queueMemory = Array.isArray(list) ? list : [];
  } catch {
    // Storage is off: the page's own list.
  }
  return queueMemory;
}

async function saveQueue(list: QueuedPurchase[]): Promise<void> {
  queueMemory = list;
  try {
    await withStore('readwrite', (s) => (list.length > 0 ? s.put(list, QUEUE_KEY) : s.delete(QUEUE_KEY)));
  } catch {
    // Storage is off: the page's own list.
  }
}

/** Keeps a purchase made without a connection (once per game) until it can be sent. */
export async function queuePurchase(p: Omit<QueuedPurchase, 'at'>): Promise<void> {
  const list = await queuedPurchases();
  if (!list.some((x) => x.entryId === p.entryId)) await saveQueue([...list, { ...p, at: new Date().toISOString() }]);
}

/**
 * Sends kept purchases, oldest first, with post: a purchase sent leaves the list; one Squirrelcade refuses for good
 * (no such game any more) is dropped; anything else (no connection, signed out, a server problem) stops, and the
 * rest wait for the next try. Marking a game bought twice counts it once, so a purchase sent twice is harmless.
 */
export async function flushPurchases(list: QueuedPurchase[], post: (entryId: number) => Promise<unknown>): Promise<{ sent: QueuedPurchase[]; left: QueuedPurchase[] }> {
  const sent: QueuedPurchase[] = [];
  for (let i = 0; i < list.length; i++) {
    const p = list[i]!;
    try {
      await post(p.entryId);
      sent.push(p);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 404)) continue;
      return { sent, left: list.slice(i) };
    }
  }
  return { sent, left: [] };
}

/** Sends the purchases kept in this browser to Squirrelcade; returns the ones marked bought now. */
export async function sendQueued(post: (entryId: number) => Promise<unknown>): Promise<QueuedPurchase[]> {
  const list = await queuedPurchases();
  if (list.length === 0) return [];
  const { sent, left } = await flushPurchases(list, post);
  if (left.length !== list.length) await saveQueue(left);
  return sent;
}

/** Downloads the copy if it changed since the one saved (the server answers "not modified" otherwise); returns what's saved. */
export async function refreshCopy(): Promise<SavedCopy | null> {
  const current = await readCopy();
  try {
    const res = await fetch('/api/v1/lookup/offline', { credentials: 'same-origin', headers: current?.etag ? { 'if-none-match': current.etag } : {} });
    if (res.status === 304 && current) {
      const confirmed = { ...current, savedAt: new Date().toISOString() };
      await writeCopy(confirmed);
      return confirmed;
    }
    if (!res.ok || !(res.headers.get('content-type') ?? '').includes('application/json')) return current;
    const copy = (await res.json()) as OfflineCopy;
    if (copy?.version !== 1 || !Array.isArray(copy.games)) return current;
    const saved = { copy, etag: res.headers.get('etag') ?? '', savedAt: new Date().toISOString() };
    await writeCopy(saved);
    return saved;
  } catch {
    return current;
  }
}

/** Where Store Mode's order of answers puts each one, as the server sorts them. */
const ORDER: Record<Answer, number> = { need: 0, check: 1, unconfirmed: 2, 'own-elsewhere': 3, own: 4, 'own-not-in-catalog': 5, 'not-a-target': 6, 'not-tracked': 7 };

function resultOf(copy: OfflineCopy, g: OfflineGame): OfflineResult | null {
  const platform = copy.platforms[g.p];
  if (!platform) return null;
  const owned = g.a === 'own' || g.a === 'own-not-in-catalog';
  return {
    platformKey: platform.key,
    platform: platform.name,
    title: g.t,
    answer: g.a,
    ownedAs: g.as ?? (owned ? [g.t] : []),
    ownedOn: g.on ?? [],
    ownedOnPc: g.pc ?? [],
    maybe: g.m ?? [],
    wishlist: g.w ?? null,
    sets: g.s ?? [],
    note: g.n ?? null,
    pending: g.pending === true,
    ...(g.e !== undefined ? { entryId: g.e } : {}),
  };
}

/**
 * Store Mode's answers from the copy, ranked as the server ranks a typed search (the title exact, then
 * starting with the words, then containing them), best first; exact keeps only exact titles.
 */
export function offlineSearch(copy: OfflineCopy, query: string, options: { platformKey?: string; exact?: boolean; limit?: number } = {}): OfflineResult[] {
  // As on the server, a query needs two letters or digits.
  if (normalizeTitle(query).length < 2) return [];
  const found: { r: OfflineResult; relevance: number }[] = [];
  for (const g of copy.games) {
    const relevance = searchRank(g.t, query);
    if (relevance === 0 || (options.exact && relevance < 3)) continue;
    const r = resultOf(copy, g);
    if (!r || (options.platformKey && r.platformKey !== options.platformKey)) continue;
    found.push({ r, relevance });
  }
  return found
    .sort((a, b) => b.relevance - a.relevance || ORDER[a.r.answer] - ORDER[b.r.answer] || a.r.title.localeCompare(b.r.title) || a.r.platform.localeCompare(b.r.platform))
    .slice(0, options.limit ?? 30)
    .map((x) => x.r);
}

/** A saved barcode's game from the copy: what it was saved as, and Store Mode's answers for it; null if it isn't saved. */
export function offlineBarcode(copy: OfflineCopy, code: string): { title: string; results: OfflineResult[] } | null {
  const digits = normalizeBarcode(code);
  const saved = digits ? copy.barcodes.find(([c]) => c === digits) : undefined;
  const platform = saved ? copy.platforms[saved[1]] : undefined;
  if (!saved || !platform) return null;
  return { title: saved[2], results: offlineSearch(copy, saved[2], { platformKey: platform.key, exact: true }) };
}

/** An answer that came back as something other than Squirrelcade's (a store's Wi-Fi sign-in page, say). */
export class NotSquirrelcade extends Error {}

/**
 * Whether a failed request means Squirrelcade couldn't be reached (no connection, no answer in time, a proxy
 * without its server, another page answering) rather than an answer from it.
 */
export function unreachable(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 502 || err.status === 503 || err.status === 504;
  if (err instanceof NotSquirrelcade || err instanceof TypeError) return true;
  return err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError');
}

/** A signal that gives up after ms, and also when the query's own signal does (where the browser can combine them). */
export function waitAtMost(signal: AbortSignal | undefined, ms: number): AbortSignal | undefined {
  if (typeof AbortSignal.timeout !== 'function') return signal;
  const timeout = AbortSignal.timeout(ms);
  if (!signal) return timeout;
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : timeout;
}
