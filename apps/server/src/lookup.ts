import {
  barcodeForms,
  baseTitle,
  cleanProductTitle,
  editionBase,
  KNOWN_PLATFORMS,
  matchKey,
  normalizeBarcode,
  normalizeTitle,
  productNameWords,
  productPlatform,
  searchRank,
  wordOverlap,
} from '@squirrelcade/core';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { shown } from './access.js';
import type { Logger } from 'pino';
import type { CatalogService, RommLinker } from './catalogs.js';
import type { Db } from './db/index.js';
import type { IgdbService } from './igdb.js';
import { barcodeNames, barcodes, copies, platforms } from './db/schema.js';
import type { SettingsService } from './settings.js';
import type { WishlistService } from './wishlist.js';

/** Store Mode's answer for one game on one platform. */
export type Answer = 'need' | 'unconfirmed' | 'own' | 'own-elsewhere' | 'check' | 'not-a-target' | 'own-not-in-catalog' | 'not-tracked';

/** One answer in Store Mode: a game on one platform, whether it's owned or needed, and why. */
export interface LookupResult {
  platformKey: string;
  platform: string;
  title: string;
  answer: Answer;
  /** Owned products that satisfy it on this platform. */
  ownedAs: string[];
  /** Other platforms where the same game is owned. */
  ownedOn: string[];
  /** PC storefronts where the same game is owned for good. */
  ownedOnPc: string[];
  /** Possible matches waiting for review. */
  maybe: string[];
  wishlist: { score: number; priority: string; rank: number | null } | null;
  relevance: number;
  coverId?: string | null;
  /** IGDB's rating of the game, beside its acorns (0.53.0). */
  reviews?: { rating: number; count: number } | null;
  /** The catalog game's id, for "I bought this" (catalog games only). */
  entryId?: number;
  /** Internal: owned products behind the answer, for their value. Not sent. */
  ownedProductIds?: string[];
  /** Owned only through a "just bought" mark, not yet in an export. */
  pending?: boolean;
  /** What the owned copies are worth in the latest export (PriceCharting's value times copies). */
  ownedValueCents?: number | null;
  /** Which releases the owned copies are: region and PriceCharting console name ("Super Famicom", Japan). */
  ownedReleases?: { region: string; consoleLabel: string }[];
  /** The owner's sets the game is in ("Limited Run Games"). */
  sets?: string[];
  /** Your own note on the game (not for a brief search). */
  note?: string | null;
  /** Your wishlist preference for a catalog game (Must Have... Do Not Recommend). */
  preference?: string | null;
}

/**
 * One game in Store Mode's offline copy (GET /api/v1/lookup/offline): its answer with short keys, and the parts
 * that are empty left out, since a collection's catalogs make tens of thousands of these.
 */
export interface OfflineGame {
  /** The platform's place in the copy's platforms. */
  p: number;
  t: string;
  a: Answer;
  /** The owned copies' titles, when they aren't just the title. */
  as?: string[];
  /** Other consoles you own it on. */
  on?: string[];
  /** PC storefronts you own it in. */
  pc?: string[];
  /** Possible matches waiting for Review. */
  m?: string[];
  w?: { score: number; priority: string; rank: number | null };
  /** Your sets it's in. */
  s?: string[];
  /** Your note on it. */
  n?: string;
  /** Owned only through "I bought it", not yet in an export. */
  pending?: true;
  /** The catalog game's id, for "I bought it" made without a connection (catalog games only). */
  e?: number;
}

/** Store Mode's offline copy: every answer it can give, and the barcodes you saved. */
export interface OfflineCopy {
  version: 1;
  builtAt: string;
  platforms: { key: string; name: string }[];
  games: OfflineGame[];
  /** Saved barcodes: [digits, the platform's place in platforms, title]. */
  barcodes: [string, number, string][];
}

/** How long a built offline copy is handed out before it's built again, in milliseconds. */
const OFFLINE_FRESH_MS = 60_000;

/** Whether one game is owned (POST /api/v1/owned), for tools such as a game-of-the-day recommender. */
export interface OwnedAnswer {
  /** The title and console key as asked. */
  title: string;
  platform: string | null;
  /** Owned on the console asked about (or on any console when none was given), a copy just bought included. */
  owned: boolean;
  /** The consoles it's owned on, and the PC storefronts where it's owned for good. */
  ownedOn: string[];
  ownedOnPc: string[];
  /** Store Mode's answer for each console with a game of that title (with your preference for a catalog game). */
  answers: { platformKey: string; platform: string; title: string; answer: Answer; preference?: string | null }[];
}

/** How many games one ownership question may ask about. */
export const OWNED_MAX = 100;

/**
 * A title's keys as catalogs compare titles (its own, and without an edition in brackets), kept once worked
 * out: the ownership API compares every catalog game's names with each title it's asked about. Forgotten when
 * it grows past a limit.
 */
const titleKeys = new Map<string, [string, string]>();
function keysOf(title: string): [string, string] {
  let k = titleKeys.get(title);
  if (!k) {
    if (titleKeys.size > 200_000) titleKeys.clear();
    k = [matchKey(title), matchKey(baseTitle(title))];
    titleKeys.set(title, k);
  }
  return k;
}

/** Where Store Mode learns about the owner's sets (see sets.ts). */
export interface SetMembership {
  setsOf: (platformKey: string, titles: string[]) => string[];
  missingOutsideCatalogs: () => { platformKey: string; platform: string; title: string; sets: string[]; maybe?: string[] }[];
}


/** Store Mode's answer to a scanned barcode: the games it may be, and what the lookup service called it. */
export interface BarcodeLookup {
  code: string;
  /** The barcode is one the user confirmed before. */
  known: boolean;
  /** What the lookup service called the product, when the barcode was new. */
  productName: string | null;
  searchedFor: string | null;
  /** The console the product's name names (its games come first), with its name, when it names one. */
  platformKey?: string | null;
  platformName?: string | null;
  results: LookupResult[];
  message: string | null;
  /** The barcode waits its turn with the barcode service (its per-minute limit): ask again in this many seconds. */
  retryInSeconds?: number | null;
  /** The barcode service's lookups left today and when more come, when this answer asked it or waits for it. */
  lookups?: ServiceLookups | null;
}

/** The barcode service's lookups left today, and when more come (its own count, from its last answer). */
export interface ServiceLookups {
  left: number | null;
  resetAt: string | null;
}

/** What a barcode service said about a code: its product name (null when it doesn't know it), and its lookups left. */
export interface ProductNameAnswer extends Partial<ServiceLookups> {
  name: string | null;
}

/** Asks a barcode service what product a barcode is: its name (null when it doesn't know), or a fuller answer. */
export type ProductNameLookup = (code: string) => Promise<string | null | ProductNameAnswer>;

/** The barcode service asked Squirrelcade to wait: its per-minute limit, or today's lookups used up (`daily`). */
export class BarcodeServiceLimit extends Error {
  constructor(
    readonly daily: boolean,
    readonly resetAt: string | null,
  ) {
    super(daily ? "The barcode service's lookups for today are used up." : 'The barcode service asked to slow down.');
  }
}

/** The barcode service didn't take its key (UPC Database's): what to say, with where the key is set. */
export class BarcodeServiceKey extends Error {}

/** The barcode services Squirrelcade can ask, by their Settings > Sources > Barcodes name. */
export type BarcodeServiceId = 'upcitemdb' | 'upcdatabase';

const SERVICE_NAMES: Record<BarcodeServiceId, string> = { upcitemdb: 'UPCitemdb', upcdatabase: 'UPC Database' };

/**
 * UPC Database (upcdatabase.org): a free account's key; its plans count lookups a day (100 free, "reset each night").
 * Its title is the product's name.
 */
export function upcDatabase(key: string): ProductNameLookup {
  return async (code) => {
    const res = await fetch(`https://api.upcdatabase.org/product/${encodeURIComponent(code)}`, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: 'application/json', authorization: `Bearer ${key}` },
    });
    if (res.status === 401 || res.status === 403) throw new BarcodeServiceKey("UPC Database didn't take its key: check it in Settings > Sources > Barcodes.");
    if (res.status === 429) throw new BarcodeServiceLimit(true, null);
    if (res.status === 404) return { name: null };
    if (!res.ok) throw new Error(`UPC Database answered ${res.status}`);
    const body = (await res.json()) as { success?: boolean | string; title?: string; description?: string };
    const found = body.success === true || body.success === 'true';
    return { name: found ? body.title?.trim() || body.description?.trim() || null : null };
  };
}

/** UPCitemdb's free trial endpoint (no key): 100 lookups a day, and 6 a minute. */
export const upcItemDb: ProductNameLookup = async (code) => {
  const res = await fetch(`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`, {
    signal: AbortSignal.timeout(6000),
    headers: { accept: 'application/json' },
  });
  // Its answers carry its count: X-RateLimit-Remaining lookups left, until X-RateLimit-Reset (Unix time). After a
  // 429 they describe the limit that was hit: the minute's (a limit of 6, back within a minute) or the day's.
  const number = (name: string) => (res.headers.has(name) && Number.isFinite(Number(res.headers.get(name))) ? Number(res.headers.get(name)) : null);
  const limit = number('x-ratelimit-limit');
  const reset = number('x-ratelimit-reset');
  const resetAt = reset !== null && reset > 0 ? new Date(reset * 1000).toISOString() : null;
  if (res.status === 429) {
    throw new BarcodeServiceLimit((limit !== null && limit > 10) || (resetAt !== null && Date.parse(resetAt) - Date.now() > 5 * 60_000), resetAt);
  }
  const lookups = { left: number('x-ratelimit-remaining'), resetAt };
  if (res.status === 404) return { name: null, ...lookups };
  if (!res.ok) throw new Error(`UPCitemdb answered ${res.status}`);
  const body = (await res.json()) as { items?: { title?: string }[] };
  return { name: body.items?.[0]?.title?.trim() || null, ...lookups };
};

/** How fast a barcode service may be asked: UPCitemdb's free use takes 6 lookups a minute. */
export interface BarcodePacing {
  perMinute: number;
  windowMs: number;
}

export const UPCITEMDB_PACING: BarcodePacing = { perMinute: 6, windowMs: 60_000 };

/** UPC Database names no per-minute limit: Squirrelcade keeps to a polite 30 when it's the only service asked. */
export const UPCDATABASE_PACING: BarcodePacing = { perMinute: 30, windowMs: 60_000 };

/** A code the barcode service didn't know is asked about again after this long (its database grows). */
const UNKNOWN_RETRY_MS = 7 * 86_400_000;

/**
 * Store Mode: searches the catalogs and the collection by title or barcode and answers own, need, own elsewhere
 * or check, with the same title rules as the collection pages; remembers barcodes once the user confirms them.
 */
export class LookupService {
  private rommLink?: RommLinker;

  /** Where owned games link to the user's RomM (see romm.ts). */
  setRommLinks(link: RommLinker): void {
    this.rommLink = link;
  }

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly catalogs: CatalogService,
    private readonly wishlist: WishlistService,
    private readonly log: Logger,
    private readonly productName: ProductNameLookup = upcItemDb,
    private readonly igdb?: IgdbService,
    private readonly pacing: BarcodePacing = UPCITEMDB_PACING,
    private readonly upcDatabaseFor: (key: string) => ProductNameLookup = upcDatabase,
  ) {}

  /** The services asked about a new barcode, in order, by Settings > Sources > Barcodes (UPC Database only with its key). */
  private chosen(): { id: BarcodeServiceId; lookup: ProductNameLookup }[] {
    const choice = this.settings.get('sources.barcodeLookup');
    const key = this.settings.get('sources.upcDatabaseKey').trim();
    const itemdb = { id: 'upcitemdb' as const, lookup: this.productName };
    const database = key ? { id: 'upcdatabase' as const, lookup: this.upcDatabaseFor(key) } : null;
    if (choice === 'upcitemdb') return [itemdb];
    if (choice === 'upcdatabase') return database ? [database] : [];
    if (choice === 'both') return database ? [itemdb, database] : [itemdb];
    return [];
  }

  /** How fast the chosen services may be asked: UPCitemdb's 6 a minute whenever it's among them. */
  private pacingNow(): BarcodePacing {
    return this.chosen().some((c) => c.id === 'upcitemdb') ? this.pacing : UPCDATABASE_PACING;
  }

  /** When each of the barcode service's recent lookups was sent, oldest first (its per-minute limit). */
  private sent: number[] = [];
  /** Not before this time (the service's own "slow down"). */
  private pausedUntil = 0;
  /** Barcodes waiting their turn with the service, oldest first, and the timer that asks about the next. */
  private waiting: string[] = [];
  private timer: NodeJS.Timeout | null = null;
  /** Each service's lookups left today, from its last answer, and whether today's are used up. */
  private quota = new Map<BarcodeServiceId, ServiceLookups & { usedUp: boolean }>();

  /** Stops the waiting line's timer (the app is closing). */
  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.waiting = [];
  }

  /**
   * What a service called a code before: its name, null (none of the services asked knew it, lately), or undefined
   * (never asked, or a service chosen since, such as UPC Database added, hasn't been asked about it).
   */
  private remembered(code: string): string | null | undefined {
    const row = this.db.select().from(barcodeNames).where(eq(barcodeNames.code, code)).get();
    if (!row) return undefined;
    if (row.name !== null) return row.name;
    if (Date.now() - Date.parse(row.askedAt) > UNKNOWN_RETRY_MS) return undefined;
    const asked = new Set(row.source.split('+'));
    return this.chosen().every((c) => asked.has(c.id)) ? null : undefined;
  }

  /** Milliseconds until the chosen services take another lookup (0: now), under their per-minute limit. */
  private waitMs(now = Date.now()): number {
    const pacing = this.pacingNow();
    this.sent = this.sent.filter((t) => now - t < pacing.windowMs);
    const minute = this.sent.length < pacing.perMinute ? 0 : this.sent[0]! + pacing.windowMs - now + 50;
    return Math.max(minute, this.pausedUntil - now, 0);
  }

  /** Whether a service's lookups for today are used up (until they come back). */
  private serviceUsedUp(id: BarcodeServiceId): boolean {
    const q = this.quota.get(id);
    if (q?.usedUp && q.resetAt && Date.parse(q.resetAt) <= Date.now()) this.quota.delete(id);
    return this.quota.get(id)?.usedUp ?? false;
  }

  /** Whether every chosen service's lookups for today are used up. */
  private usedUp(): boolean {
    const chosen = this.chosen();
    return chosen.length > 0 && chosen.every((c) => this.serviceUsedUp(c.id));
  }

  /**
   * Asks the chosen services about a code now, in order, until one names it (a service whose lookups are used up
   * for today is passed over), and keeps the answer for good with the service that gave it. Throws when it has to
   * wait (a service's "slow down", and no other named it) or every service failed.
   */
  private async ask(code: string): Promise<string | null> {
    this.sent.push(Date.now());
    const asked: BarcodeServiceId[] = [];
    let wait: BarcodeServiceLimit | null = null;
    let failure: unknown = null;
    for (const service of this.chosen()) {
      if (this.serviceUsedUp(service.id)) continue;
      let answer: ProductNameAnswer;
      try {
        const said = await service.lookup(code);
        answer = said !== null && typeof said === 'object' ? said : { name: said };
      } catch (err) {
        if (err instanceof BarcodeServiceLimit && err.daily) this.quota.set(service.id, { left: 0, resetAt: err.resetAt ?? new Date(Date.now() + 3_600_000).toISOString(), usedUp: true });
        else if (err instanceof BarcodeServiceLimit) {
          wait = err;
          this.pausedUntil = Math.max(err.resetAt ? Date.parse(err.resetAt) : 0, Date.now() + this.pacingNow().windowMs / 2);
        } else {
          failure ??= err;
          this.log.warn({ context: 'lookup', err }, `Barcode lookup for ${code} at ${SERVICE_NAMES[service.id]} failed`);
        }
        continue;
      }
      asked.push(service.id);
      if (typeof answer.left === 'number') this.quota.set(service.id, { left: answer.left, resetAt: answer.resetAt ?? null, usedUp: answer.left <= 0 });
      if (answer.name) {
        this.keep(code, answer.name, service.id);
        this.log.info({ context: 'lookup' }, `Barcode ${code} is "${answer.name}" to ${SERVICE_NAMES[service.id]}`);
        return answer.name;
      }
    }
    if (wait) throw wait;
    if (asked.length === 0) {
      if (failure) throw failure;
      throw new BarcodeServiceLimit(true, null);
    }
    this.keep(code, null, asked.join('+'));
    this.log.info({ context: 'lookup' }, `Barcode ${code} is unknown to ${asked.map((id) => SERVICE_NAMES[id]).join(' and ')}`);
    return null;
  }

  private keep(code: string, name: string | null, source: string): void {
    const row = { code, name, source, askedAt: new Date().toISOString() };
    this.db.insert(barcodeNames).values(row).onConflictDoUpdate({ target: barcodeNames.code, set: row }).run();
  }

  /** Puts a code in the waiting line (once) and makes sure the line moves; its place in it. */
  private enqueue(code: string): number {
    if (!this.waiting.includes(code)) this.waiting.push(code);
    this.schedule();
    return this.waiting.indexOf(code);
  }

  private schedule(): void {
    if (this.timer || this.waiting.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.drain();
    }, this.waitMs());
    this.timer.unref?.();
  }

  /** Asks about the waiting barcodes as fast as the service allows; their answers are kept for the next scan. */
  private async drain(): Promise<void> {
    while (this.waiting.length > 0 && this.waitMs() === 0) {
      if (this.usedUp()) {
        this.waiting = [];
        return;
      }
      const code = this.waiting.shift()!;
      if (this.remembered(code) !== undefined) continue;
      try {
        await this.ask(code);
      } catch (err) {
        if (err instanceof BarcodeServiceLimit && !err.daily) this.waiting.unshift(code);
        else if (!(err instanceof BarcodeServiceLimit)) this.log.warn({ context: 'lookup', err }, `Barcode lookup for ${code} failed`);
      }
    }
    this.schedule();
  }

  /** The answer for a barcode waiting its turn: when to ask again, by its place in the line. */
  private waitingAnswer(code: string, place: number): BarcodeLookup {
    const pacing = this.pacingNow();
    const ms = this.waitMs() + Math.floor(place / pacing.perMinute) * pacing.windowMs;
    return {
      code,
      known: false,
      productName: null,
      searchedFor: null,
      results: [],
      message: `Waiting for the barcode service, which takes ${pacing.perMinute} lookups a minute${place > 0 ? ` (${place} ${place === 1 ? 'barcode' : 'barcodes'} ahead of this one)` : ''}.`,
      retryInSeconds: Math.max(2, Math.ceil(ms / 1000) + 1),
      lookups: this.lookupsNow(),
    };
  }

  /** The first chosen service's lookups left today, when it says (UPCitemdb's answers do). */
  private lookupsNow(): ServiceLookups | null {
    for (const c of this.chosen()) {
      const q = this.quota.get(c.id);
      if (q && q.left !== null) return { left: q.left, resetAt: q.resetAt };
    }
    return null;
  }

  /** Everything Squirrelcade knows about games whose titles match the query, best matches first. */
  /** The PC storefronts a title is owned in for good (set by the app once the PC library exists). */
  private pcOwnership: (title: string) => string[] = () => [];

  setPcOwnership(lookup: (title: string) => string[]): void {
    this.pcOwnership = lookup;
  }

  /** The owner's sets (set by the app): which sets a game is in, and their missing games outside console catalogs. */
  private sets: SetMembership = { setsOf: () => [], missingOutsideCatalogs: () => [] };

  setSets(sets: SetMembership): void {
    this.sets = sets;
  }

  /** Your notes by "platform key|normalized title" (set by the app). */
  private notes: () => Map<string, string> = () => new Map();

  setNotes(index: () => Map<string, string>): void {
    this.notes = index;
  }

  /**
   * Set while the ownership API answers a list of games: what every search of the list reads from the collection,
   * read once.
   */
  private batch: { owned: Map<string, Set<string>>; rows: { productId: string; title: string; key: string; name: string }[]; preferences: Map<string, string> } | null = null;

  search(query: string, options: { platformKey?: string; exact?: boolean; sameTitle?: boolean; limit?: number; brief?: boolean; every?: boolean } = {}): LookupResult[] {
    const q = normalizeTitle(query);
    // every: all the games Store Mode knows, unranked (the offline copy).
    if (!options.every && q.length < 2) return [];
    // sameTitle: only games whose title (or another name) is the query's, compared as catalogs compare titles
    // ("Zelda Twilight Princess" is "The Legend of Zelda: Twilight Princess"); otherwise ranked as typed.
    const keys = options.sameTitle ? new Set([matchKey(query), matchKey(baseTitle(query)), matchKey(editionBase(query))].filter(Boolean)) : null;
    const rankOf = (names: string[]) =>
      options.every
        ? 1
        : keys
        ? names.some((n) => {
            const [own, base] = keysOf(n);
            return keys.has(own) || keys.has(base);
          })
          ? 3
          : 0
        : searchRank(names[0]!, q);
    const limit = options.limit ?? 30;
    const wishlist = this.wishlist.compute();
    const preferences = this.batch?.preferences ?? this.wishlist.preferences();
    const owned = this.batch?.owned ?? this.ownedByTitle();
    const results: LookupResult[] = [];
    const covered = new Set<string>();

    for (const p of this.catalogs.allMatches()) {
      if (options.platformKey && p.key !== options.platformKey) continue;
      for (const t of p.match.targets) {
        const relevance = rankOf([t.target.title, ...(t.target.altTitles ?? [])]);
        if (relevance === 0 || (options.exact && relevance < 3)) continue;
        const titleKey = matchKey(baseTitle(t.target.title));
        const elsewhere = [...(owned.get(titleKey) ?? [])].filter((name) => name !== p.name);
        const answer: Answer =
          t.status === 'owned'
            ? 'own'
            : t.status === 'review'
              ? 'check'
              : t.status === 'excluded' || t.status === 'extra'
                ? 'not-a-target'
                : elsewhere.length > 0
                  ? 'own-elsewhere'
                  : t.status === 'unconfirmed'
                    ? 'unconfirmed'
                    : 'need';
        for (const m of t.matches) covered.add(`${p.key}|${m.productId}`);
        results.push({
          platformKey: p.key,
          platform: p.name,
          title: t.target.title,
          answer,
          ownedAs: t.matches.map((m) => m.title),
          ownedOn: elsewhere,
          ownedOnPc: this.pcOwnership(t.target.title),
          maybe: t.suggestions.map((s) => s.title),
          wishlist: wishlist.index.get(`${p.key}|${normalizeTitle(t.target.title)}`) ?? null,
          preference: preferences.get(`${p.key}|${normalizeTitle(t.target.title)}`) ?? null,
          relevance,
          entryId: t.target.id,
          pending: t.matches.length > 0 && t.matches.every((m) => m.method === 'pending'),
          ownedProductIds: t.matches.filter((m) => m.method !== 'pending').map((m) => m.productId),
          sets: this.sets.setsOf(p.key, [t.target.title, ...(t.target.altTitles ?? [])]),
        });
      }
    }

    // A set's missing games that no console catalog has (a publisher's download-era release, say).
    for (const g of this.sets.missingOutsideCatalogs()) {
      if (options.platformKey && g.platformKey !== options.platformKey) continue;
      const relevance = rankOf([g.title]);
      if (relevance === 0 || (options.exact && relevance < 3)) continue;
      const elsewhere = [...(owned.get(matchKey(baseTitle(g.title))) ?? [])].filter((name) => name !== g.platform);
      results.push({
        platformKey: g.platformKey,
        platform: g.platform,
        title: g.title,
        answer: elsewhere.length > 0 ? 'own-elsewhere' : 'need',
        ownedAs: [],
        ownedOn: elsewhere,
        ownedOnPc: this.pcOwnership(g.title),
        maybe: g.maybe ?? [],
        wishlist: null,
        relevance,
        sets: g.sets,
      });
    }

    // Owned games outside any catalog (other regions, untracked platforms, odd releases).
    {
      const rows = this.batch?.rows ?? this.ownedRows();
      const seen = new Set<string>();
      for (const r of rows) {
        if (options.platformKey && r.key !== options.platformKey) continue;
        const id = `${r.key}|${r.productId}`;
        if (covered.has(id) || seen.has(id)) continue;
        seen.add(id);
        const relevance = rankOf([r.title]);
        if (relevance === 0 || (options.exact && relevance < 3)) continue;
        results.push({
          platformKey: r.key,
          platform: r.name,
          title: r.title,
          answer: 'own-not-in-catalog',
          ownedAs: [r.title],
          ownedProductIds: [r.productId],
          ownedOn: [],
          ownedOnPc: this.pcOwnership(r.title),
          maybe: [],
          wishlist: null,
          relevance,
          sets: this.sets.setsOf(r.key, [r.title]),
        });
      }
    }

    // What owned copies are worth, from the last export, and which releases they are (not for a brief search).
    const values = new Map<string, number>();
    const releases = new Map<string, { region: string; consoleLabel: string }>();
    if (!options.brief) {
      for (const r of this.db
        .select({
          productId: copies.productId,
          key: platforms.key,
          valueCents: copies.valueCents,
          quantity: copies.quantity,
          region: copies.region,
          consoleLabel: copies.consoleLabel,
        })
        .from(copies)
        .innerJoin(platforms, eq(platforms.id, copies.platformId))
        .where(isNull(copies.goneAt))
        .all()) {
        const k = `${r.key}|${r.productId}`;
        releases.set(k, { region: r.region, consoleLabel: r.consoleLabel });
        if (r.valueCents === null) continue;
        values.set(k, (values.get(k) ?? 0) + r.valueCents * r.quantity);
      }
    }
    for (const r of results) {
      const ids = r.ownedProductIds ?? [];
      const known = ids.filter((id) => values.has(`${r.platformKey}|${id}`));
      r.ownedValueCents = known.length > 0 ? known.reduce((sum, id) => sum + values.get(`${r.platformKey}|${id}`)!, 0) : null;
      const owned = ids.map((id) => releases.get(`${r.platformKey}|${id}`)).filter((x) => x !== undefined);
      r.ownedReleases = [...new Map(owned.map((x) => [`${x.region}|${x.consoleLabel}`, x])).values()];
      delete r.ownedProductIds;
    }

    const order: Record<Answer, number> = { need: 0, check: 1, unconfirmed: 2, 'own-elsewhere': 3, own: 4, 'own-not-in-catalog': 5, 'not-a-target': 6, 'not-tracked': 7 };
    const notes = options.brief ? new Map<string, string>() : this.notes();
    return results
      .sort((a, b) => b.relevance - a.relevance || order[a.answer] - order[b.answer] || a.title.localeCompare(b.title) || a.platform.localeCompare(b.platform))
      .slice(0, limit)
      .map((r) => {
        if (options.brief) return r;
        const romm = (r.answer === 'own' || r.answer === 'own-not-in-catalog') && this.rommLink ? this.rommLink(r.platformKey, [r.title, ...r.ownedAs]) : null;
        return { ...r, coverId: this.igdb?.coverOf(r.platformKey, r.title) ?? null, reviews: this.igdb?.reviewsOf(r.platformKey, r.title) ?? null, romm, note: notes.get(`${r.platformKey}|${normalizeTitle(r.title)}`) ?? null };
      });
  }

  /** The offline copies built last: with your notes (the owner's), and without (a viewer's, when notes aren't shared). */
  private offlineCopies = new Map<boolean, { at: number; stamp: string; copy: OfflineCopy; body: string; etag: string; gzip?: Buffer }>();

  /**
   * Store Mode's offline copy: every answer a search could give (brief ones: no values, covers or RomM links),
   * your note on each game, its catalog id (for "I bought it" without a connection), and the saved barcodes.
   * Built again when the catalogs' answers change (a purchase, an answer, an update) or after a minute; the
   * tag changes only when the answers do, so a phone that has the copy isn't sent it again.
   */
  offlineCopy(withNotes = true): { copy: OfflineCopy; body: string; etag: string; gzip: () => Buffer } {
    const stamp = this.catalogs.stamp();
    const last = this.offlineCopies.get(withNotes);
    if (last && last.stamp === stamp && Date.now() - last.at < OFFLINE_FRESH_MS) return this.withGzip(last);
    const platformList = this.db.select({ id: platforms.id, key: platforms.key, name: platforms.name }).from(platforms).orderBy(asc(platforms.id)).all();
    const place = new Map(platformList.map((p, i) => [p.key, i]));
    const placeById = new Map(platformList.map((p, i) => [p.id, i]));
    const notes = withNotes ? this.notes() : new Map<string, string>();
    const games: OfflineGame[] = [];
    for (const r of this.search('', { every: true, brief: true, limit: Number.MAX_SAFE_INTEGER })) {
      const p = place.get(r.platformKey);
      if (p === undefined) continue;
      const g: OfflineGame = { p, t: r.title, a: r.answer };
      if (r.ownedAs.length > 0 && !(r.ownedAs.length === 1 && r.ownedAs[0] === r.title)) g.as = r.ownedAs;
      if (r.ownedOn.length > 0) g.on = r.ownedOn;
      if (r.ownedOnPc.length > 0) g.pc = r.ownedOnPc;
      if (r.maybe.length > 0) g.m = r.maybe;
      if (r.wishlist) g.w = { score: r.wishlist.score, priority: r.wishlist.priority, rank: r.wishlist.rank };
      if (r.sets?.length) g.s = r.sets;
      const note = notes.get(`${r.platformKey}|${normalizeTitle(r.title)}`);
      if (note) g.n = note;
      if (r.pending) g.pending = true;
      if (r.entryId !== undefined) g.e = r.entryId;
      games.push(g);
    }
    const saved: [string, number, string][] = [];
    for (const b of this.db.select({ code: barcodes.code, platformId: barcodes.platformId, title: barcodes.title }).from(barcodes).all()) {
      const p = placeById.get(b.platformId);
      if (p !== undefined) saved.push([normalizeBarcode(b.code) ?? b.code, p, b.title]);
    }
    const content = JSON.stringify({ platforms: platformList.map((p) => ({ key: p.key, name: p.name })), games, barcodes: saved });
    const etag = `"${createHash('sha1').update(content).digest('base64url').slice(0, 20)}"`;
    // The build time changes only with the answers, so the tag and the copy agree.
    const builtAt = last?.etag === etag ? last.copy.builtAt : new Date().toISOString();
    const copy: OfflineCopy = { version: 1, builtAt, platforms: platformList.map((p) => ({ key: p.key, name: p.name })), games, barcodes: saved };
    const built = { at: Date.now(), stamp, copy, body: JSON.stringify(copy), etag };
    this.offlineCopies.set(withNotes, built);
    return this.withGzip(built);
  }

  /** The copy with its gzip form, compressed the first time it's asked for and kept with it. */
  private withGzip(built: { copy: OfflineCopy; body: string; etag: string; gzip?: Buffer }): { copy: OfflineCopy; body: string; etag: string; gzip: () => Buffer } {
    return { ...built, gzip: () => (built.gzip ??= gzipSync(built.body)) };
  }

  /** The collection's copies with their consoles, for games outside any catalog. */
  private ownedRows(): { productId: string; title: string; key: string; name: string }[] {
    return this.db
      .select({ productId: copies.productId, title: copies.title, key: platforms.key, name: platforms.name })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
  }

  private ownedByTitle(): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    const rows = this.db
      .select({ title: copies.title, name: platforms.name })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    for (const r of rows) {
      const key = matchKey(baseTitle(r.title));
      map.set(key, (map.get(key) ?? new Set()).add(r.name));
    }
    return map;
  }

  async byBarcode(raw: string): Promise<BarcodeLookup> {
    const code = normalizeBarcode(raw);
    if (!code) return { code: raw, known: false, productName: null, searchedFor: null, results: [], message: "That doesn't look like a barcode (8 to 14 digits)." };
    const saved = this.db
      .select({ title: barcodes.title, key: platforms.key })
      .from(barcodes)
      .innerJoin(platforms, eq(platforms.id, barcodes.platformId))
      .where(inArray(barcodes.code, barcodeForms(code)))
      .get();
    if (saved) {
      return { code, known: true, productName: null, searchedFor: saved.title, results: this.search(saved.title, { platformKey: saved.key, exact: true }), message: null };
    }
    // What the barcode service said about it before, kept for good: no lookup spent (even with the service now off).
    const before = this.remembered(code);
    let productName: string | null;
    let lookups: ServiceLookups | null = null;
    if (before !== undefined) {
      productName = before;
    } else if (this.chosen().length === 0) {
      const message =
        this.settings.get('sources.barcodeLookup') === 'off'
          ? 'New barcode. Search for the game by title, then link the barcode to it.'
          : 'UPC Database needs its key (Settings > Sources > Barcodes). Search for the game by title, then link the barcode to it.';
      return { code, known: false, productName: null, searchedFor: null, results: [], message };
    } else if (this.usedUp()) {
      // When more come is shown by the page, in the phone's own time.
      return { code, known: false, productName: null, searchedFor: null, results: [], message: "The barcode service's lookups for today are used up. Search by title instead, and link the barcode to the game you find.", lookups: this.lookupsNow() };
    } else if (this.waiting.length > 0 || this.waitMs() > 0) {
      // Over its per-minute limit: the barcode waits its turn, asked in the background, and the page asks again.
      return this.waitingAnswer(code, this.enqueue(code));
    } else {
      try {
        productName = await this.ask(code);
        lookups = this.lookupsNow();
      } catch (err) {
        if (err instanceof BarcodeServiceLimit && !err.daily) return this.waitingAnswer(code, this.enqueue(code));
        if (err instanceof BarcodeServiceLimit) return this.byBarcode(code);
        if (err instanceof BarcodeServiceKey) return { code, known: false, productName: null, searchedFor: null, results: [], message: err.message };
        return { code, known: false, productName: null, searchedFor: null, results: [], message: "The barcode service didn't answer. Search by title instead." };
      }
    }
    if (!productName) {
      return { code, known: false, productName: null, searchedFor: null, results: [], message: "The barcode service doesn't know this code. Search by title instead.", lookups };
    }
    const platformKey = productPlatform(productName);
    const { query, results } = this.productSearch(productName, platformKey);
    // The barcode is a game for the console its name gives: that console's answers come first (the Xbox One's
    // Mafia III before the PS4's), then the rest as good as they match.
    const ranked = results
      .map((r, i) => ({ r, i }))
      .sort((a, b) => Number(b.r.platformKey === platformKey) - Number(a.r.platformKey === platformKey) || b.r.relevance - a.r.relevance || a.i - b.i)
      .map((x) => x.r);
    const platformName = platformKey ? (this.catalogs.allMatches().find((m) => m.key === platformKey)?.name ?? KNOWN_PLATFORMS.find((k) => k.key === platformKey)?.name ?? null) : null;
    this.log.info({ context: 'lookup' }, `Barcode ${code} ("${productName}"): searched for "${query}", ${ranked.length} found`);
    return { code, known: false, productName, searchedFor: query, platformKey, platformName, results: ranked, message: null, lookups };
  }

  /**
   * The games a retail product name may be, in steps, each only when the one before found nothing:
   * 1. The longest run of its words that's a game's title (in a catalog, a set or the collection), compared as
   *    catalogs compare titles, so a publisher's name, an edition, the console or packaging words around the title
   *    don't matter ("Microsoft Halo 5: Guardians - Xbox One", "Mafia III Deluxe Edition (Xbox One)"). A title on
   *    the console the name gives wins, unless it's much shorter than one found elsewhere ("Destiny" in "Destiny:
   *    The Taken King Legendary Edition").
   * 2. On that console: its games with every word of the name as typed ("Spider-Man" finds "Marvel's Spider-Man"),
   *    then the ones sharing most of its words ("Sony Uncharted 4 A Thiefs End" is "Uncharted 4: A Thief's End").
   * 3. Anywhere: the same, then the name's first words, fewer at a time.
   */
  private productSearch(productName: string, platformKey: string | null): { query: string; results: LookupResult[] } {
    const known = new Map<string, string>();
    const add = (title: string) => {
      const k = matchKey(title);
      if (k && !known.has(k)) known.set(k, title);
    };
    for (const p of this.catalogs.allMatches()) for (const t of p.match.targets) for (const title of [t.target.title, ...(t.target.altTitles ?? [])]) add(title);
    for (const g of this.sets.missingOutsideCatalogs()) add(g.title);
    for (const r of this.ownedRows()) add(baseTitle(r.title));
    const merge = (...lists: LookupResult[][]) => {
      const seen = new Set<string>();
      return lists.flat().filter((r) => !seen.has(`${r.platformKey}|${r.title}`) && seen.add(`${r.platformKey}|${r.title}`)).slice(0, 15);
    };

    const words = productNameWords(productName);
    // The longest title found only on other consoles, and a much shorter one found on the name's console.
    let elsewhere: { query: string; results: LookupResult[]; words: number } | null = null;
    let shortHere: { query: string; results: LookupResult[] } | null = null;
    for (let n = words.length; n >= 1; n--) {
      for (let i = 0; i + n <= words.length; i++) {
        const run = words.slice(i, i + n).join(' ');
        // One short word ("Halo", "Doom" pass; "The", "PC" don't) says too little on its own.
        if (n === 1 && normalizeTitle(run).length < 4) continue;
        const title = known.get(matchKey(run));
        if (!title) continue;
        const results = this.search(title, { sameTitle: true, limit: 15 });
        if (results.length === 0) continue;
        if (!platformKey || results.some((r) => r.platformKey === platformKey)) {
          if (!elsewhere || n >= elsewhere.words - 1) return { query: title, results };
          shortHere ??= { query: title, results };
        } else elsewhere ??= { query: title, results, words: n };
      }
    }

    const cleaned = cleanProductTitle(productName);
    if (platformKey) {
      const typed = this.search(cleaned, { platformKey, limit: 15 });
      if (typed.length > 0) return { query: cleaned, results: merge(typed, elsewhere?.results ?? []) };
      const close = this.closest(cleaned, platformKey);
      if (close.length > 0) return { query: close[0]!.title, results: merge(close, shortHere?.results ?? [], elsewhere?.results ?? []) };
    }
    if (shortHere) return { query: shortHere.query, results: merge(shortHere.results, elsewhere?.results ?? []) };
    if (elsewhere) return { query: elsewhere.query, results: elsewhere.results };

    let results = this.search(cleaned, { limit: 15 });
    if (results.length > 0) return { query: cleaned, results };
    const close = this.closest(cleaned, null);
    if (close.length > 0) return { query: close[0]!.title, results: close };
    const cleanedWords = cleaned.split(' ');
    for (let n = cleanedWords.length - 1; n >= 1; n--) {
      const query = cleanedWords.slice(0, n).join(' ');
      if (query.length < 4) break;
      results = this.search(query, { limit: 15 });
      if (results.length > 0) return { query, results };
    }
    return { query: cleaned, results: [] };
  }

  /** The games (on one console, or any) whose titles share most of a name's words (wordOverlap 0.6 or more), closest first. */
  private closest(name: string, platformKey: string | null): LookupResult[] {
    const scored = new Map<string, { title: string; key: string; score: number }>();
    for (const r of this.search(name, { every: true, brief: true, platformKey: platformKey ?? undefined, limit: Number.MAX_SAFE_INTEGER })) {
      const score = wordOverlap(name, r.title);
      const id = `${r.platformKey}|${r.title}`;
      if (score >= 0.6 && (scored.get(id)?.score ?? 0) < score) scored.set(id, { title: r.title, key: r.platformKey, score });
    }
    const best = [...scored.values()].sort((a, b) => b.score - a.score).slice(0, 5);
    // Each one's full answer (value, cover, note), as a search for it gives.
    return best.flatMap((b) => this.search(b.title, { platformKey: b.key, exact: true, limit: 1 }));
  }

  saveBarcode(raw: string, platformKey: string, title: string): boolean {
    const code = normalizeBarcode(raw);
    const platform = this.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (!code || !platform || !title.trim()) return false;
    const now = new Date().toISOString();
    // One link per barcode: one saved before in another form (with the zeros some phones add in front) is replaced,
    // not left beside it to answer instead.
    this.db
      .delete(barcodes)
      .where(and(inArray(barcodes.code, barcodeForms(code)), ne(barcodes.code, code)))
      .run();
    this.db
      .insert(barcodes)
      .values({ code, platformId: platform.id, title: title.trim(), source: 'user', createdAt: now })
      .onConflictDoUpdate({ target: barcodes.code, set: { platformId: platform.id, title: title.trim(), source: 'user', createdAt: now } })
      .run();
    this.log.info({ context: 'lookup' }, `Barcode ${code} is "${title.trim()}" on ${platform.name}`);
    return true;
  }

  /**
   * Whether each game is owned, for other tools: Store Mode's answers for the same title (compared as catalogs
   * compare titles), on the console asked about or on all of them.
   */
  owned(queries: { title: string; platform?: string | null }[]): OwnedAnswer[] {
    this.batch = { owned: this.ownedByTitle(), rows: this.ownedRows(), preferences: this.wishlist.preferences() };
    try {
      return queries.map((q) => this.ownedOne(q));
    } finally {
      this.batch = null;
    }
  }

  private ownedOne({ title, platform }: { title: string; platform?: string | null }): OwnedAnswer {
    const found = this.search(title, { platformKey: platform || undefined, sameTitle: true, limit: 30, brief: true });
    const here = found.filter((r) => r.answer === 'own' || r.answer === 'own-not-in-catalog');
    return {
      title,
      platform: platform || null,
      owned: here.length > 0,
      ownedOn: [...new Set([...here.map((r) => r.platform), ...found.flatMap((r) => r.ownedOn)])],
      ownedOnPc: [...new Set(found.flatMap((r) => r.ownedOnPc))],
      answers: found.map((r) => ({ platformKey: r.platformKey, platform: r.platform, title: r.title, answer: r.answer, ...(r.entryId !== undefined ? { preference: r.preference ?? null } : {}) })),
    };
  }

  /**
   * Scan my shelf (0.33.0): a barcode Squirrelcade has saved (a scan confirmed here, or another app's export), without
   * asking any barcode service; null when it hasn't one, undefined when the code isn't a barcode.
   */
  savedBarcode(raw: string): { code: string; platformKey: string; platform: string; title: string; source: string } | null | undefined {
    const code = normalizeBarcode(raw);
    if (!code) return undefined;
    return (
      this.db
        .select({ code: barcodes.code, platformKey: platforms.key, platform: platforms.name, title: barcodes.title, source: barcodes.source })
        .from(barcodes)
        .innerJoin(platforms, eq(platforms.id, barcodes.platformId))
        // As saved before, too (with the zeros some phones add in front).
        .where(inArray(barcodes.code, barcodeForms(code)))
        .get() ?? null
    );
  }

  /**
   * Scan my shelf: for each console with copies, how many of its owned games (products) have their barcode saved, by
   * the copy's own title or the catalog game it counts as.
   */
  barcodeCoverage(): { key: string; name: string; games: number; withBarcode: number }[] {
    const saved = new Map<number, Set<string>>();
    for (const b of this.db.select({ platformId: barcodes.platformId, title: barcodes.title }).from(barcodes).all()) {
      saved.set(b.platformId, (saved.get(b.platformId) ?? new Set<string>()).add(matchKey(baseTitle(b.title))));
    }
    const consoles = new Map<string, { key: string; name: string; games: Map<string, boolean> }>();
    const rows = this.db
      .select({ platformId: copies.platformId, productId: copies.productId, title: copies.title, key: platforms.key, name: platforms.name })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    for (const r of rows) {
      const c = consoles.get(r.key) ?? { key: r.key, name: r.name, games: new Map<string, boolean>() };
      consoles.set(r.key, c);
      if (c.games.get(r.productId)) continue;
      const known = saved.get(r.platformId!);
      c.games.set(r.productId, Boolean(known) && [r.title, ...this.catalogs.titlesOfOwned(r.key, r.productId)].some((t) => known!.has(matchKey(baseTitle(t)))));
    }
    return [...consoles.values()]
      .map((c) => ({ key: c.key, name: c.name, games: c.games.size, withBarcode: [...c.games.values()].filter(Boolean).length }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Forgets a barcode's link (a wrong one), in every form it may have been saved in. */
  forgetBarcode(raw: string): boolean {
    const code = normalizeBarcode(raw);
    return code ? this.db.delete(barcodes).where(inArray(barcodes.code, barcodeForms(code))).run().changes > 0 : false;
  }
}

/** Store Mode: title search, barcode lookups, and remembering which game a barcode is. */
export function registerLookupRoutes(app: FastifyInstance, lookup: LookupService): void {
  /** A viewer's answers leave out what isn't shared with them (notes, RomM links). */
  const forRequester = (request: FastifyRequest, results: LookupResult[]): LookupResult[] => {
    const may = shown(request);
    return may.notes && may.romm ? results : results.map((r) => ({ ...r, note: may.notes ? r.note : null, ...('romm' in r && !may.romm ? { romm: null } : {}) }));
  };

  app.get('/api/v1/lookup', async (request) => {
    const q = request.query as { q?: string; platform?: string; limit?: string };
    const limit = Number(q.limit);
    return forRequester(request, lookup.search(q.q ?? '', { platformKey: q.platform || undefined, limit: Number.isInteger(limit) && limit >= 1 && limit <= 30 ? limit : undefined }));
  });

  app.get('/api/v1/lookup/barcode/:code', async (request) => {
    const answer = await lookup.byBarcode((request.params as { code: string }).code);
    return { ...answer, results: forRequester(request, answer.results) };
  });

  // Store Mode's offline copy: sent again only when it changed (ETag), compressed when the browser takes gzip.
  app.get('/api/v1/lookup/offline', async (request, reply) => {
    const { body, etag, gzip } = lookup.offlineCopy(shown(request).notes);
    reply.header('etag', etag).header('cache-control', 'no-cache').header('vary', 'accept-encoding');
    // A proxy that compresses the answer again (Cloudflare) marks the tag weak ("W/..."); it's still this copy.
    const known = String(request.headers['if-none-match'] ?? '').split(',').map((t) => t.trim().replace(/^W\//, ''));
    if (known.includes(etag)) return reply.code(304).send();
    reply.type('application/json; charset=utf-8');
    if (/\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))) return reply.header('content-encoding', 'gzip').send(gzip());
    return reply.send(body);
  });

  // Ownership for other tools: several games at once, or one by the query string.
  app.post('/api/v1/owned', async (request, reply) => {
    const games = (request.body as { games?: unknown } | null)?.games;
    const valid =
      Array.isArray(games) &&
      games.length >= 1 &&
      games.length <= OWNED_MAX &&
      games.every((g: unknown) => {
        const x = g as { title?: unknown; platform?: unknown } | null;
        return typeof x?.title === 'string' && x.title.trim().length > 0 && x.title.length <= 300 && (x.platform === undefined || x.platform === null || typeof x.platform === 'string');
      });
    if (!valid) return reply.code(400).send({ error: 'invalid', message: `Send games: a list of 1 to ${OWNED_MAX} games, each { "title": "...", "platform": "<console key>" (optional) }.` });
    return { results: lookup.owned(games as { title: string; platform?: string | null }[]) };
  });

  app.get('/api/v1/owned', async (request, reply) => {
    const q = request.query as { title?: string; platform?: string };
    if (!q.title?.trim()) return reply.code(400).send({ error: 'invalid', message: 'Give a title (and a platform key if you like).' });
    return lookup.owned([{ title: q.title, platform: q.platform || null }])[0];
  });

  app.post('/api/v1/barcodes', async (request, reply) => {
    const b = request.body as { code?: unknown; platformKey?: unknown; title?: unknown } | null;
    if (typeof b?.code !== 'string' || typeof b.platformKey !== 'string' || typeof b.title !== 'string' || !lookup.saveBarcode(b.code, b.platformKey, b.title)) {
      return reply.code(400).send({ error: 'invalid', message: 'Send a barcode, a platform key and a title.' });
    }
    return { ok: true };
  });

  app.delete('/api/v1/barcodes/:code', async (request) => ({ removed: lookup.forgetBarcode((request.params as { code: string }).code) }));

  // Scan my shelf (0.33.0, the owner's): how many of each console's games have their barcode, and a barcode Squirrelcade
  // has saved, without asking any barcode service.
  app.get('/api/v1/barcodes/coverage', async () => lookup.barcodeCoverage());
  app.get('/api/v1/barcodes/:code', async (request, reply) => {
    const saved = lookup.savedBarcode((request.params as { code: string }).code);
    if (saved === undefined) return reply.code(400).send({ error: 'invalid', message: "That isn't a barcode: a barcode has 8 to 14 digits." });
    return { saved };
  });
}
