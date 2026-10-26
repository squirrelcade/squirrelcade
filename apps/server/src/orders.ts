import {
  baseTitle,
  dayIn,
  findPlatforms,
  isAccessory,
  isConsoleHardware,
  isDigitalCode,
  gmailOrderSearch,
  gmailPurchaseSearch,
  fromAmazon,
  isAmazonUnknown,
  ITEM_MATCH,
  orderPageDate,
  itemCost,
  KNOWN_PLATFORMS,
  lotGames,
  matchKey,
  normalizeTitle,
  orderItemFor,
  orderItemScore,
  ORDER_SCHEMA,
  orderPrompt,
  orderSearchTitles,
  ordersFromAnswer,
  orderText,
  orderTextForModel,
  productPlatform,
  purchaseSubject,
  readAmazonHistory,
  readAmazonOrder,
  readOrderEmail,
  readOrderPage,
  severalGames,
  splitEvenly,
  storesSeen,
  type FoundOrder,
  type OrderEmail,
  type PaidCounts,
  type StoreSeen,
} from '@squirrelcade/core';
import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { simpleParser } from 'mailparser';
import type { Logger } from 'pino';
import { CopyError, type CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import type { FetchLike } from './igdb.js';
import { appState, comingItems, copies, platforms, purchaseRows } from './db/schema.js';
import { HelperError, type HelperQueue } from './helper.js';
import type { LookupService } from './lookup.js';
import { signInProblem, type FoundMail, type Mailbox, type MailboxOpener, type MailImportService } from './mailImport.js';
import { isZip, readZip } from './zip.js';
import type { NotificationService } from './notifications.js';
import type { SettingsService } from './settings.js';
import { answerOf } from './talk.js';
import type { VisionClient } from './vision.js';

/**
 * Prices from your order emails (D155) and On the way (D156), both off until turned on (Settings > Email), since they
 * read more of the mailbox than PriceCharting's emails. The mailbox is opened read-only, as for exports: a search, then
 * the newest few emails it found, none larger than a limit. Each email is read by the AI model when one is set up
 * (Settings > Sources > Vision model, or the owner's helper), else by plain rules (core's readOrderEmail). Only what's
 * found is kept (the store, the day, the items and the amounts, and which email it was as a hash of its Message-ID),
 * never an email; logs carry counts.
 */

/** An email larger than this isn't fetched (an order email is well under a megabyte; its pictures are links). */
const MAX_ORDER_BYTES = 5 * 1024 * 1024;
/** At most this many emails go to the model in one question. */
const AI_BATCH = 5;
/** Jobs are kept this long after they end, for the page to ask about. */
const KEEP_MS = 60 * 60_000;
const READ_KEY = 'orders.read';
const FOUND_KEY = 'orders.found';
const SEEN_KEY = 'orders.watchSeen';
const LAST_KEY = 'orders.lastWatch';
const AI_DAY_KEY = 'orders.aiDay';
/** How many emails' readings by the model are kept (a reading is the amounts and items, never the email). */
const KEEP_READ = 1000;
const KEEP_SEEN = 1000;
const KEEP_FOUND = 500;

/** One order found for a copy: where and when, the item as the email names it, and what it cost (its share of the order). */
export interface FoundPrice {
  store: string;
  date: string | null;
  orderNumber: string | null;
  itemTitle: string;
  quantity: number;
  currency: string | null;
  itemCents: number | null;
  taxCents: number | null;
  shippingCents: number | null;
  discountCents: number | null;
  /** The price paid as Settings > Email counts it. */
  paidCents: number | null;
  link: string | null;
  readBy: 'ai' | 'plain';
}

export interface FindJob {
  id: string;
  state: 'reading' | 'done' | 'failed';
  found: FoundPrice[];
  /** How many emails the search found and were read. */
  read: number;
  message: string | null;
  error: string | null;
  finishedAt: number | null;
}

export interface BatchJob {
  id: string;
  state: 'reading' | 'done' | 'failed';
  total: number;
  done: number;
  /** How many copies a price was found for. */
  found: number;
  error: string | null;
  finishedAt: number | null;
}

/** Find my stores (Settings > Email): the stores of the mailbox's purchase emails, worked out from their headers. */
export interface StoresJob {
  id: string;
  state: 'reading' | 'done' | 'failed';
  stores: StoreSeen[];
  /** How many emails' headers were looked at. */
  read: number;
  /** The days looked back. */
  days: number;
  error: string | null;
  finishedAt: number | null;
}

/** At most this many purchase emails' headers are looked at (the newest), and this many stores listed. */
const MAX_STORE_HEADERS = 3000;
const MAX_STORES = 60;

/** A price found for a copy by Look up prices in my email, kept until it's used, turned down, or the copy has a price. */
export interface StoredFound extends FoundPrice {
  copyId: number;
  at: string;
}

/** A game on the way (GET /api/v1/coming). */
/** What an item bought is (D184): see OrderService.classify. */
export type ItemKind =
  | { kind: 'game'; game: { platformKey: string; title: string } | null; platformKey: string | null }
  | { kind: 'digital'; platformKey: string | null }
  | { kind: 'hardware'; platformKey: string }
  | { kind: 'other' };

export interface ComingView {
  id: number;
  store: string;
  orderDate: string | null;
  orderNumber: string | null;
  link: string | null;
  listingTitle: string;
  quantity: number;
  currency: string | null;
  itemCents: number | null;
  taxCents: number | null;
  shippingCents: number | null;
  discountCents: number | null;
  /** In the home currency (D173): converted at the order day's rate, or null while that's unknown. */
  paidCents: number | null;
  /** Its value in another currency, as the email gave it, when it's in one. */
  paidInCurrencyCents: number | null;
  /** A lot, a pack or a bundle: several games for one price (D173), to split. */
  several: boolean;
  /** An Amazon order's game its email didn't name (D176): its order page pasted, or a screenshot of it, names it. */
  unknown: boolean;
  /** The lot it was split from. */
  lotOf: number | null;
  readBy: string;
  /** The day it's expected, when the shop said (D179). */
  expectedOn: string | null;
  /** The game it is, when Squirrelcade is sure or the owner said; else null, with the games it may be. */
  platformKey: string | null;
  platform: string | null;
  title: string | null;
  entryId: number | null;
  maybe: { platformKey: string; platform: string; title: string }[];
  status: 'waiting' | 'arrived' | 'dismissed' | 'split';
  createdAt: string;
}

/** What Store Mode says of a game on the way. */
export interface OnTheWay {
  id: number;
  store: string;
  orderDate: string | null;
  paidCents: number | null;
}

export class OrderService {
  private readonly finds = new Map<string, FindJob>();
  private readonly batches = new Map<string, BatchJob>();
  private readonly storeJobs = new Map<string, StoresJob>();

  constructor(
    private readonly d: {
      db: Db;
      settings: SettingsService;
      mail: MailImportService;
      collection: CollectionService;
      lookup: LookupService;
      helpers: HelperQueue;
      vision: VisionClient;
      log: Logger;
      notifications: Pick<NotificationService, 'notice'> | null;
      open: MailboxOpener;
      /** For the exchange rates (Frankfurter's); the network's fetch unless a test gives one. */
      ratesFetch?: FetchLike;
    },
  ) {}

  /** Exchange rates kept, by "day|from|to" (a past day's rate doesn't change). */
  private readonly rates = new Map<string, number>();

  /** A currency's value in another on a day (D173), from Frankfurter (the European Central Bank's rates); null when it can't be had. */
  private async rateOf(from: string, to: string, day: string): Promise<number | null> {
    if (from === to) return 1;
    const key = `${day}|${from}|${to}`;
    const kept = this.rates.get(key);
    if (kept !== undefined) return kept;
    try {
      const res = await (this.d.ratesFetch ?? fetch)(`https://api.frankfurter.app/${day}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const rate = ((await res.json()) as { rates?: Record<string, unknown> }).rates?.[to];
      if (typeof rate !== 'number' || !(rate > 0)) return null;
      this.rates.set(key, rate);
      return rate;
    } catch {
      return null;
    }
  }

  /** The games on the way in another currency get their rate, where it's still missing (each look tries again). */
  private async fillRates(): Promise<void> {
    if (!this.d.settings.get('orders.exchangeRates')) return;
    const home = this.d.settings.get('general.currency');
    const rows = this.d.db.select().from(comingItems).where(and(eq(comingItems.status, 'waiting'), isNull(comingItems.rate))).all();
    for (const r of rows) {
      if (!r.currency || r.currency === home) continue;
      const rate = await this.rateOf(r.currency, home, r.orderDate ?? r.createdAt.slice(0, 10));
      if (rate !== null) this.d.db.update(comingItems).set({ rate }).where(eq(comingItems.id, r.id)).run();
    }
  }

  findOn(): boolean {
    return this.d.settings.get('orders.find') === true;
  }

  watchOn(): boolean {
    return this.d.settings.get('orders.watch') === true;
  }

  /** Whether emails go to the AI model: Settings > Email says so, and a model is set up. */
  private aiReady(): boolean {
    return this.d.settings.get('orders.reader') === 'ai' && this.d.vision.ready();
  }

  status() {
    const { account, problem } = this.d.mail.account('orders');
    const waiting = this.d.db.select({ id: comingItems.id }).from(comingItems).where(eq(comingItems.status, 'waiting')).all().length;
    return {
      find: this.findOn(),
      watch: this.watchOn(),
      account: account ? { user: account.user, host: account.host } : null,
      problem,
      reader: this.aiReady() ? 'ai' : 'plain',
      lastWatch: this.readState<{ at: string; ok: boolean; message: string }>(LAST_KEY),
      waiting,
    };
  }

  // Price paid from your order emails.

  /** Starts looking for a copy's order in the mailbox; the job says what it found. */
  startFind(copyId: number): FindJob {
    this.sweep();
    const copy = this.copyOf(copyId);
    if (!copy) throw new CopyError("That copy isn't in your collection.");
    const job: FindJob = { id: randomUUID(), state: 'reading', found: [], read: 0, message: null, error: null, finishedAt: null };
    this.finds.set(job.id, job);
    void (async () => {
      let box: Mailbox | null = null;
      try {
        box = await this.openBox();
        const { found, read } = await this.findFor(box, copy);
        job.found = found;
        job.read = read;
        job.message = found.length > 0 ? null : read > 0 ? `${read === 1 ? 'One email names' : `${read} emails name`} ${copy.title}, but none reads as its order.` : `No order or receipt email from the last ${this.d.settings.get('orders.lookBackDays')} days names ${copy.title}.`;
        job.state = 'done';
        this.d.log.info({ context: 'orders' }, `Price lookup: ${read} emails read, ${found.length} orders found`);
      } catch (err) {
        job.state = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
      } finally {
        await box?.close().catch(() => undefined);
        job.finishedAt = Date.now();
      }
    })();
    return job;
  }

  find(id: string): FindJob | undefined {
    this.sweep();
    return this.finds.get(id);
  }

  /**
   * Look up prices in my email (Collection > Improve): the copies still missing a price (none paid and no estimate),
   * newest added first, on a console or added here if asked, up to Settings > Email's limit, one after another in one
   * visit to the mailbox. What's found is kept for each copy until it's used or turned down.
   */
  startBatch(filter: { platform?: string; added?: string; recentDays?: number }): BatchJob {
    this.sweep();
    const running = [...this.batches.values()].find((b) => b.state === 'reading');
    if (running) return running;
    const list = this.missingPrice(filter);
    const job: BatchJob = { id: randomUUID(), state: 'reading', total: list.length, done: 0, found: 0, error: null, finishedAt: null };
    this.batches.set(job.id, job);
    void (async () => {
      let box: Mailbox | null = null;
      let read = 0;
      try {
        if (list.length > 0) box = await this.openBox();
        for (const copy of list) {
          const { found, read: n } = await this.findFor(box!, copy);
          read += n;
          job.done++;
          // The best one with a price (they come first): a price to use or turn down.
          const best = found.find((f) => f.paidCents !== null);
          if (best) {
            job.found++;
            this.keepFound({ ...best, copyId: copy.id, at: new Date().toISOString() });
          }
        }
        job.state = 'done';
        this.d.log.info({ context: 'orders' }, `Price lookups: ${list.length} copies, ${read} emails read, ${job.found} prices found`);
      } catch (err) {
        job.state = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
      } finally {
        await box?.close().catch(() => undefined);
        job.finishedAt = Date.now();
      }
    })();
    return job;
  }

  batch(id: string): BatchJob | undefined {
    this.sweep();
    return this.batches.get(id);
  }

  /**
   * Find my stores (Settings > Email, under "Purchase emails from"): the stores the owner buys from, from the senders of
   * the mailbox's purchase emails within "Look at order emails from the last" (a subject On the way's rules take as a
   * purchase). Only the headers are read, never an email whole, and nothing is kept: the list is for the owner to pick from.
   */
  startStores(): StoresJob {
    this.sweep();
    const running = [...this.storeJobs.values()].find((j) => j.state === 'reading');
    if (running) return running;
    const s = this.d.settings;
    const days = s.get('orders.lookBackDays');
    const job: StoresJob = { id: randomUUID(), state: 'reading', stores: [], read: 0, days, error: null, finishedAt: null };
    this.storeJobs.set(job.id, job);
    void (async () => {
      let box: Mailbox | null = null;
      try {
        box = await this.openBox();
        if (!box.headers) throw new Error("This mailbox can't be searched for stores.");
        const yes = s.get('orders.watchSubjects');
        const no = s.get('orders.watchNotSubjects');
        const since = new Date(Date.now() - days * 86_400_000);
        const headers = await box.headers({ since, ...(box.gmail ? { gmail: gmailPurchaseSearch(yes, days) } : {}), subjects: yes, limit: MAX_STORE_HEADERS });
        job.read = headers.length;
        job.stores = storesSeen(headers, yes, no).slice(0, MAX_STORES);
        job.state = 'done';
        this.d.log.info({ context: 'orders' }, `Find my stores: ${headers.length} emails' headers, ${job.stores.length} stores`);
      } catch (err) {
        job.state = 'failed';
        job.error = err instanceof Error ? err.message : String(err);
      } finally {
        await box?.close().catch(() => undefined);
        job.finishedAt = Date.now();
      }
    })();
    return job;
  }

  storesJob(id: string): StoresJob | undefined {
    this.sweep();
    return this.storeJobs.get(id);
  }

  /** The prices kept for copies that still miss one (a copy given a price or an estimate since, or gone, drops out). */
  found(): StoredFound[] {
    const kept = this.readState<StoredFound[]>(FOUND_KEY) ?? [];
    if (kept.length === 0) return [];
    const still = new Set(this.missingPrice({}, Number.MAX_SAFE_INTEGER).map((c) => c.id));
    return kept.filter((f) => still.has(f.copyId));
  }

  /** A kept price used or turned down: it's forgotten. */
  forgetFound(copyId: number): void {
    const kept = this.readState<StoredFound[]>(FOUND_KEY) ?? [];
    this.writeState(FOUND_KEY, kept.filter((f) => f.copyId !== copyId));
  }

  private keepFound(f: StoredFound): void {
    const kept = (this.readState<StoredFound[]>(FOUND_KEY) ?? []).filter((x) => x.copyId !== f.copyId);
    this.writeState(FOUND_KEY, [f, ...kept].slice(0, KEEP_FOUND));
  }

  /** The copies missing a price paid: none, or 0, and no estimate of the owner's; newest added first. */
  private missingPrice(filter: { platform?: string; added?: string; recentDays?: number }, limit = this.d.settings.get('orders.batchMax')) {
    return this.d.db
      .select({ id: copies.id, title: copies.title, platformKey: platforms.key, datePurchased: copies.datePurchased, addedAt: copies.addedAt })
      .from(copies)
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(
        and(
          isNull(copies.goneAt),
          or(isNull(copies.costCents), lte(copies.costCents, 0)),
          isNull(copies.estimatedCents),
          ...(filter.platform ? [eq(platforms.key, filter.platform)] : []),
          ...(filter.added === 'here' ? [eq(copies.source, 'squirrelcade')] : []),
          // The haul: the copies added lately (Stash > Recently added's days).
          ...(filter.recentDays ? [gte(copies.addedAt, new Date(Date.now() - filter.recentDays * 86_400_000).toISOString())] : []),
        ),
      )
      .orderBy(desc(copies.addedAt), desc(copies.id))
      .limit(limit)
      .all();
  }

  private copyOf(id: number) {
    return (
      this.d.db
        .select({ id: copies.id, title: copies.title, platformKey: platforms.key, datePurchased: copies.datePurchased, addedAt: copies.addedAt })
        .from(copies)
        .leftJoin(platforms, eq(platforms.id, copies.platformId))
        .where(and(eq(copies.id, id), isNull(copies.goneAt)))
        .get() ?? null
    );
  }

  /** Signs in to the mailbox (the account on Settings > Email), or says what's missing. */
  private async openBox(): Promise<Mailbox> {
    const { account, problem } = this.d.mail.account('orders');
    if (!account) throw new Error(problem!);
    try {
      return await this.d.open(account);
    } catch (err) {
      throw new Error(signInProblem(err));
    }
  }

  /**
   * One copy's orders: the mailbox searched for its title (then its main title, before a subtitle) with an order word,
   * within the days set, the newest few read; each order's item naming the game, with what it cost. The closest to the
   * day it was bought comes first when that's known, else the newest; an item that names another console is left out.
   */
  private async findFor(box: Mailbox, copy: { title: string; platformKey: string | null; datePurchased: string | null }): Promise<{ found: FoundPrice[]; read: number }> {
    const s = this.d.settings;
    const days = s.get('orders.lookBackDays');
    const since = new Date(Date.now() - days * 86_400_000);
    const limit = s.get('orders.maxEmails');
    const words = s.get('orders.words');
    let mails: FoundMail[] = [];
    for (const title of orderSearchTitles(copy.title)) {
      const query = box.gmail
        ? { since, gmail: gmailOrderSearch(title, words, days, MAX_ORDER_BYTES / 1024 / 1024), limit, maxBytes: MAX_ORDER_BYTES }
        : { since, text: title, limit, maxBytes: MAX_ORDER_BYTES };
      mails = (await box.search(query)).mails;
      if (mails.length > 0) break;
    }
    const orders = await this.read(mails, copy.title);
    const counts = s.get('orders.paidCounts') as PaidCounts;
    const found: FoundPrice[] = [];
    for (const order of orders) {
      if (!order) continue;
      const index = orderItemFor(order, copy.title);
      if (index === null) continue;
      const item = order.items[index]!;
      const named = productPlatform(item.title);
      if (named && copy.platformKey && named !== copy.platformKey) continue;
      const cost = itemCost(order, index, counts);
      found.push({ store: order.store, date: order.date, orderNumber: order.orderNumber, itemTitle: item.title, quantity: item.quantity, currency: order.currency, ...cost, link: order.link, readBy: order.readBy });
    }
    const near = (f: FoundPrice) => (copy.datePurchased && f.date ? Math.abs(Date.parse(f.date) - Date.parse(copy.datePurchased)) : -Date.parse(f.date ?? '1970-01-01'));
    found.sort((a, b) => Number(b.paidCents !== null) - Number(a.paidCents !== null) || near(a) - near(b));
    return { found, read: mails.length };
  }

  /**
   * Reads emails into orders: by the AI model, a few to a question, when it's set up (a reading kept, by a hash of the
   * email's Message-ID, so an email is asked about once), and within today's limit; else, or when the model fails, by
   * the plain rules (with `wanted`, the lines naming that game).
   */
  private async read(mails: FoundMail[], wanted?: string): Promise<(FoundOrder | null)[]> {
    const tz = this.d.settings.get('general.timeZone');
    const emails: (OrderEmail & { ref: string })[] = [];
    for (const mail of mails) {
      const parsed = await simpleParser(mail.source);
      const html = typeof parsed.html === 'string' ? parsed.html : '';
      const text = html ? orderText(html) : (parsed.text ?? '');
      // The links' addresses, for the listing's own (eBay's item, Mercari's, an Amazon order).
      const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!.replace(/&amp;/g, '&')).join('\n');
      emails.push({ ref: refOf(mail.id), subject: mail.subject, from: mail.from, fromName: mail.fromName, day: dayIn(tz, new Date(mail.date)), text, links });
    }
    const out: (FoundOrder | null | undefined)[] = emails.map(() => undefined);
    if (this.aiReady() && emails.length > 0) {
      const cache = new Map((this.readState<{ ref: string; order: FoundOrder | null; at: string }[]>(READ_KEY) ?? []).map((r) => [r.ref, r]));
      const ask: number[] = [];
      emails.forEach((e, i) => {
        const kept = cache.get(e.ref);
        if (readAmazonOrder(e)) return;
        if (kept) out[i] = kept.order;
        else ask.push(i);
      });
      for (let at = 0; at < ask.length; ) {
        const room = Math.min(AI_BATCH, this.aiLeft());
        if (room <= 0) break;
        const some = ask.slice(at, at + room);
        at += some.length;
        const batch = some.map((i) => emails[i]!);
        try {
          this.aiUsed(batch.length);
          const answer = await this.askModel(orderPrompt(batch.map((e) => ({ subject: e.subject, from: e.fromName ? `${e.fromName} (${e.from.split('@').pop()})` : (e.from.split('@').pop() ?? ''), day: e.day, text: orderTextForModel(e.text) }))));
          const read = ordersFromAnswer(answer, batch.map((e) => ({ from: e.from, fromName: e.fromName, day: e.day, text: `${e.text}\n${e.links ?? ''}` })));
          some.forEach((i, k) => {
            out[i] = read[k] ?? null;
            cache.set(emails[i]!.ref, { ref: emails[i]!.ref, order: out[i]!, at: new Date().toISOString() });
          });
        } catch (err) {
          // Squirrelcade's own reader reads these instead; the model is asked about them another time.
          // What went wrong in a word: a helper's error can carry its last output, which may quote an email.
          const what = err instanceof HelperError ? 'the helper failed or is away' : err instanceof Error && /refused \(\d+\)/.test(err.message) ? (/refused \(\d+\)/.exec(err.message)![0]) : 'no answer';
          this.d.log.warn({ context: 'orders' }, `The AI model couldn't read ${batch.length} order ${batch.length === 1 ? 'email' : 'emails'} (${what}), so Squirrelcade's own reader did`);
          break;
        }
      }
      this.writeState(READ_KEY, [...cache.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, KEEP_READ));
    }
    return emails.map((e, i) => {
      // Amazon's order email names departments, not items (D176): its video games wait, unnamed, under its order.
      const amazon = readAmazonOrder(e);
      if (amazon) return amazon;
      const o = out[i];
      if (o === undefined) return readOrderEmail(e, wanted);
      // A model's reading that doesn't have the game asked for: the plain rules may still find its line.
      if (wanted && (o === null || orderItemFor(o, wanted) === null)) return readOrderEmail(e, wanted) ?? o;
      return o;
    });
  }

  /** The model's answer, as JSON: the owner's helper (sent as a turn of Talk is, a prompt and its schema), or the service. */
  private async askModel(prompt: string): Promise<unknown> {
    if (this.d.settings.get('sources.visionApi') === 'helper') {
      const a = await this.d.helpers.ask('talk', { prompt, schema: ORDER_SCHEMA, purpose: 'orders' });
      if (a.answer && typeof a.answer === 'object') return a.answer;
      const parsed = typeof a.text === 'string' ? answerOf(a.text) : null;
      if (!parsed) throw new HelperError("The helper's answer wasn't JSON.");
      return parsed;
    }
    const text = await this.d.vision.chat(prompt, this.d.settings.get('sources.talkModel') || null);
    const parsed = answerOf(text);
    if (!parsed) throw new Error("The AI model's answer wasn't JSON.");
    return parsed;
  }

  /** Emails the model may still read today (Settings > Email; 0 sets no limit). */
  private aiLeft(): number {
    const limit = this.d.settings.get('orders.aiDailyEmails');
    if (limit === 0) return Number.MAX_SAFE_INTEGER;
    const used = this.readState<{ day: string; used: number }>(AI_DAY_KEY);
    const today = new Date().toISOString().slice(0, 10);
    return Math.max(0, limit - (used?.day === today ? used.used : 0));
  }

  private aiUsed(n: number): void {
    const today = new Date().toISOString().slice(0, 10);
    const used = this.readState<{ day: string; used: number }>(AI_DAY_KEY);
    this.writeState(AI_DAY_KEY, { day: today, used: (used?.day === today ? used.used : 0) + n });
  }

  // On the way.

  /**
   * The task: purchase emails from the senders Settings > Email lists (eBay and Mercari unless changed), since the last
   * look (the first goes back the days set), each read once; each item becomes a game on the way, matched to the game
   * it is when Squirrelcade is sure. A message for the new ones, if asked. What happened, in a line.
   */
  async watch(): Promise<string> {
    if (!this.watchOn()) return 'On the way is off (Settings > Email).';
    const s = this.d.settings;
    const last = this.readState<{ at: string; ok: boolean; message: string }>(LAST_KEY);
    const since = new Date(last?.ok ? Date.parse(last.at) - 2 * 86_400_000 : Date.now() - s.get('orders.watchFirstDays') * 86_400_000);
    let box: Mailbox;
    try {
      box = await this.openBox();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.saveWatch(false, message);
      throw new Error(message);
    }
    const seen = new Set(this.readState<string[]>(SEEN_KEY) ?? []);
    const fresh: FoundMail[] = [];
    try {
      const purchase = (subject: string) => purchaseSubject(subject, s.get('orders.watchSubjects'), s.get('orders.watchNotSubjects'));
      for (const sender of s.get('orders.watchSenders')) {
        const want = sender.trim().toLowerCase().replace(/^@/, '');
        if (!want) continue;
        // Only the purchase emails are fetched whole: the subjects of the newest few hundred are looked at first.
        const { mails } = await box.search({ since, from: [want], limit: 50, maxBytes: MAX_ORDER_BYTES, subject: purchase });
        for (const m of mails) {
          const ref = refOf(m.id);
          if (seen.has(ref) || fresh.some((f) => f.id === m.id)) continue;
          // The server's search is loose (a word anywhere in From): the sender is checked again, as an address or its
          // domain ("ebay.com" is ebay@ebay.com or one at reply.ebay.com, never one at notebay.com).
          const from = m.from.toLowerCase();
          if (!(from === want || from.endsWith(`@${want}`) || from.endsWith(`.${want}`))) continue;
          if (!purchase(m.subject)) continue;
          if (!s.get('orders.amazonEmails') && fromAmazon(m.from)) continue;
          fresh.push(m);
        }
      }
    } catch (err) {
      await box.close().catch(() => undefined);
      const message = signInProblem(err);
      this.saveWatch(false, message);
      throw new Error(message);
    }
    await box.close().catch(() => undefined);
    const orders = await this.read(fresh);
    const added: ComingView[] = [];
    fresh.forEach((mail, i) => {
      const order = orders[i];
      if (order) added.push(...this.addComing(refOf(mail.id), order));
    });
    this.writeState(SEEN_KEY, [...fresh.map((m) => refOf(m.id)), ...seen].slice(0, KEEP_SEEN));
    await this.fillRates();
    this.d.log.info({ context: 'orders' }, `On the way: ${fresh.length} purchase emails read, ${added.length} new`);
    if (added.length > 0 && s.get('orders.watchNotify')) {
      const names = added.map((a) => `${a.title ?? a.listingTitle} (${a.store})`);
      await this.d.notifications?.notice(
        added.length === 1 ? `on the way: ${added[0]!.title ?? added[0]!.listingTitle}` : `${added.length} games on the way`,
        `Squirrelcade found ${added.length === 1 ? 'a purchase' : 'purchases'} in your email: ${names.join(', ')}. ${added.length === 1 ? 'It waits' : 'They wait'} on On the way until ${added.length === 1 ? 'it arrives' : 'they arrive'}.`,
        '/coming',
      );
    }
    // Counts only: the line goes to the log and the task's history (the games are on On the way).
    const message = added.length > 0 ? `${added.length} new on the way (${fresh.length} purchase ${fresh.length === 1 ? 'email' : 'emails'} read).` : fresh.length > 0 ? `Nothing new on the way (${fresh.length} purchase ${fresh.length === 1 ? 'email' : 'emails'} read).` : 'Nothing new on the way.';
    this.saveWatch(true, message);
    return message;
  }

  /** An order's items put on the way (each once, by ref and place), as an email's are: for other sources (D178). */
  putOnTheWay(ref: string, order: FoundOrder): ComingView[] {
    return this.addComing(ref, order);
  }

  /**
   * A game bought, said by an app through the connector (D179: record_on_the_way): on the way as an email's would be,
   * once by its order number and item id (the ASIN or the shop's own). Already waiting on that order (an email's or a
   * CSV's), it's the same one: an Amazon game its email didn't name is named, nothing is added.
   */
  recordOnTheWay(r: { title: string; platform?: string; store: string; orderDate?: string; priceCents?: number; currency?: string; orderNumber?: string; itemId?: string; expectedOn?: string; link?: string }): { status: 'added' | 'named' | 'known' | 'not_a_game' | 'digital_code'; item: ComingView | null } {
    const orderNumber = r.orderNumber?.trim() || null;
    const itemId = r.itemId?.trim() || null;
    const ref = `connector:${orderNumber ?? ''}|${itemId ?? normalizeTitle(r.title)}`;
    const listing = (r.platform ? `${r.title} - ${r.platform}` : r.title).slice(0, 200);
    const now = new Date().toISOString();
    const expected = r.expectedOn ? { expectedOn: r.expectedOn } : {};
    const mine = this.d.db.select().from(comingItems).where(eq(comingItems.mailRef, ref)).get();
    if (mine) {
      if (r.expectedOn) this.d.db.update(comingItems).set({ ...expected, updatedAt: now }).where(eq(comingItems.id, mine.id)).run();
      return { status: 'known', item: this.view({ ...mine, ...expected }) };
    }
    // Any item may be sent (D184): only a game goes on the way; a console game bought as a code is left out unless
    // Settings > Email counts them.
    const kind = this.classify(listing, { orderDate: r.orderDate ?? null, coming: Boolean(r.expectedOn) });
    if (kind.kind === 'digital') return { status: 'digital_code', item: null };
    if (kind.kind !== 'game') return { status: 'not_a_game', item: null };
    const game = kind.game;
    const rowKey = orderNumber && itemId ? `${orderNumber}|${itemId}` : null;
    if (orderNumber) {
      const same = this.d.db.select().from(comingItems).where(and(eq(comingItems.orderNumber, orderNumber), eq(comingItems.status, 'waiting'))).all();
      // The same item: one with this item id, or one with none (a pasted page, an email: D186) that's the same game or
      // title, an Amazon game its email didn't name, or the order's only one waiting whose game isn't known.
      const idOf = (ref: string) => (/^(?:connector|sheet):/.test(ref) ? ref.slice(ref.indexOf('|') + 1) : null);
      const mayBe = same.filter((x) => idOf(x.mailRef) === null || idOf(x.mailRef) === itemId);
      const titleKey = (t: string) => matchKey(baseTitle(t.replace(/[\u2122\u00ae\u00a9]/g, '').replace(/\s+-\s+[^-]+$/, '')));
      const twin =
        mayBe.find((x) => game && x.platformKey === game.platformKey && x.title === game.title) ??
        mayBe.find((x) => isAmazonUnknown(x.listingTitle)) ??
        mayBe.find((x) => titleKey(x.title ?? x.listingTitle) === titleKey(game?.title ?? r.title)) ??
        (same.length === 1 && mayBe.length === 1 && !mayBe[0]!.title ? mayBe[0] : undefined);
      if (twin) {
        const unnamed = isAmazonUnknown(twin.listingTitle);
        // The game as this says it (its console named: the Switch 2's, not the N64's a bare title matched).
        const better = !unnamed && game && (twin.platformKey !== game.platformKey || twin.title !== game.title) ? { platformKey: game.platformKey, title: game.title } : {};
        const set = { ...expected, ...better, ...(unnamed ? { listingTitle: listing, platformKey: game?.platformKey ?? null, title: game?.title ?? null } : {}), ...(twin.itemCents === null && r.priceCents !== undefined ? { itemCents: r.priceCents } : {}), updatedAt: now };
        this.d.db.update(comingItems).set(set).where(eq(comingItems.id, twin.id)).run();
        if (rowKey) this.d.db.insert(purchaseRows).values({ key: rowKey, kind: 'coming', copyId: null, appliedAt: now }).onConflictDoNothing().run();
        return { status: unnamed ? 'named' : 'known', item: this.view({ ...twin, ...set }) };
      }
    }
    // Brought in once: a purchases CSV's row for it isn't put on the way again.
    if (rowKey && this.d.db.select().from(purchaseRows).where(eq(purchaseRows.key, rowKey)).get()) {
      const earlier = this.d.db.select().from(comingItems).where(eq(comingItems.mailRef, `sheet:${rowKey}`)).get();
      if (earlier) return { status: 'known', item: this.view(earlier) };
    }
    this.addComing(ref, {
      store: r.store,
      date: r.orderDate ?? null,
      orderNumber,
      currency: r.currency ?? this.d.settings.get('general.currency'),
      items: [{ title: listing, priceCents: r.priceCents ?? null, quantity: 1 }],
      taxCents: null,
      shippingCents: null,
      discountCents: null,
      totalCents: null,
      link: r.link ?? (orderNumber && /^\d{3}-\d{7}-\d{7}$/.test(orderNumber) ? `https://www.amazon.com/your-orders/order-details?orderID=${orderNumber}` : null),
      readBy: 'ai',
    });
    const row = this.d.db.select().from(comingItems).where(eq(comingItems.mailRef, ref)).get()!;
    // A console said that the title's words didn't settle: the owner then picks the game on it.
    const platformKey = row.platformKey ?? game?.platformKey ?? kind.platformKey ?? (r.platform ? findPlatforms(r.platform, this.d.db.select({ key: platforms.key, name: platforms.name }).from(platforms).all())[0]?.key ?? null : null);
    const set = { ...expected, platformKey, updatedAt: now };
    this.d.db.update(comingItems).set(set).where(eq(comingItems.id, row.id)).run();
    if (rowKey) this.d.db.insert(purchaseRows).values({ key: rowKey, kind: 'coming', copyId: null, appliedAt: now }).onConflictDoNothing().run();
    return { status: 'added', item: this.view({ ...row, ...set }) };
  }

  /** An order's items as games on the way (each once: an email's item is never added twice); the new ones. */
  private addComing(ref: string, order: FoundOrder): ComingView[] {
    const now = new Date().toISOString();
    const out: ComingView[] = [];
    order.items.forEach((item, index) => {
      const known = this.d.db.select({ id: comingItems.id }).from(comingItems).where(and(eq(comingItems.mailRef, ref), eq(comingItems.itemIndex, index))).get();
      if (known) return;
      // Each share for one copy: the price paid is worked out from them as Settings > Email counts it, then.
      const cost = itemCost(order, index, 'all');
      const game = isAmazonUnknown(item.title) ? null : this.matchListing(item.title);
      const row = this.d.db
        .insert(comingItems)
        .values({
          mailRef: ref,
          itemIndex: index,
          store: order.store,
          orderDate: order.date,
          orderNumber: order.orderNumber,
          link: order.link,
          listingTitle: item.title,
          quantity: item.quantity,
          currency: order.currency,
          itemCents: cost.itemCents,
          taxCents: cost.taxCents,
          shippingCents: cost.shippingCents,
          discountCents: cost.discountCents,
          readBy: order.readBy,
          expectedOn: order.expectedOn ?? null,
          platformKey: game?.platformKey ?? null,
          title: game?.title ?? null,
          status: 'waiting',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      out.push(this.view(row));
    });
    return out;
  }

  /** The game a listing's title is, when Squirrelcade is sure (for other sources, D178). */
  gameOf(listing: string): { platformKey: string; title: string } | null {
    return this.matchListing(listing);
  }

  /**
   * What an item bought is (D184), for the purchases CSV and Claude's connector, which send every item: a game (the one
   * Squirrelcade is sure of, else only its console, or neither, for the owner to say), a console game bought as a code
   * (left out unless Settings > Email counts them), a console, or something else. A sheet's own guess is only a hint.
   */
  classify(item: string, opts: { hint?: 'game' | 'hardware' | 'other'; seller?: string; orderDate?: string | null; coming?: boolean } = {}): ItemKind {
    const platformKey = productPlatform(item);
    if (isDigitalCode(item, opts.seller) && platformKey !== 'pc' && !this.d.settings.get('orders.countDigitalCodes')) return { kind: 'digital', platformKey };
    const game = this.matchListing(item);
    // A pre-order whose name says no console is the release coming out after the order, not the one a catalog has
    // ("The Legend of Zelda: Ocarina of Time", ordered in 2026 for the Switch 2, isn't the N64's).
    if (game && !platformKey && opts.coming && opts.orderDate) {
      const on = this.d.lookup.releasedAfter(game.title, opts.orderDate);
      if (on && on !== game.platformKey) return { kind: 'game', game: { platformKey: on, title: game.title }, platformKey: on };
    }
    if (game) return { kind: 'game', game, platformKey: game.platformKey };
    if (isConsoleHardware(item) || (opts.hint === 'hardware' && !platformKey)) return platformKey ? { kind: 'hardware', platformKey } : { kind: 'other' };
    if (isAccessory(item)) return { kind: 'other' };
    // A console in its name and nothing else it could be: a game ("Stranger of Paradise - PlayStation 5", which a
    // sheet's keyword guess took for hardware).
    if (platformKey) return { kind: 'game', game: null, platformKey };
    if (opts.hint === 'hardware') return { kind: 'other' };
    // No console in its name: a game's title anywhere makes it a game; a pre-order's console is the one IGDB has it
    // coming out on after the order.
    const { results } = this.d.lookup.productMatch(item);
    const best = results[0];
    const titled = best && orderItemScore(item, best.title) >= ITEM_MATCH ? best.title : null;
    if (!titled && opts.hint !== 'game') return { kind: 'other' };
    if (titled && opts.coming && opts.orderDate) {
      const on = this.d.lookup.releasedAfter(titled, opts.orderDate);
      if (on) return { kind: 'game', game: { platformKey: on, title: titled }, platformKey: on };
    }
    return { kind: 'game', game: null, platformKey: null };
  }

  /** The game a listing's title is, when Squirrelcade is sure: its console named, or one console's game only, and the title's words all there. */
  private matchListing(name: string): { platformKey: string; title: string } | null {
    // A shop's trademark signs aren't part of the title (D186).
    const listing = name.replace(/[™®©]/g, '');
    // A lot or a bundle is several games: the owner says which.
    if (/\b(lot|bundle|bundled)\b|\b\d+\s+games\b/i.test(listing)) return null;
    const { platformKey, results } = this.d.lookup.productMatch(listing);
    const best = results[0];
    if (!best || orderItemScore(listing, best.title) < ITEM_MATCH) return null;
    const consoles = new Set(results.filter((r) => normalizeTitle(r.title) === normalizeTitle(best.title)).map((r) => r.platformKey));
    if (platformKey ? best.platformKey !== platformKey : consoles.size > 1) return null;
    return { platformKey: best.platformKey, title: best.title };
  }

  /** The games on the way (waiting), newest first, and those just arrived or dismissed (the last 30 days) when asked. */
  coming(all = false): ComingView[] {
    const rows = this.d.db.select().from(comingItems).orderBy(desc(comingItems.createdAt), desc(comingItems.id)).all();
    const month = new Date(Date.now() - 30 * 86_400_000).toISOString();
    return rows.filter((r) => r.status === 'waiting' || (all && r.status !== 'split' && (r.updatedAt ?? r.createdAt) >= month)).map((r) => this.view(r));
  }

  /** One's price paid, as Settings > Email counts it now, in its own currency. */
  private paidInCurrency(r: typeof comingItems.$inferSelect): number | null {
    const counts = this.d.settings.get('orders.paidCounts') as PaidCounts;
    if (r.itemCents === null) return null;
    if (counts === 'item') return r.itemCents;
    if (counts === 'tax') return r.itemCents + (r.taxCents ?? 0);
    return Math.max(0, r.itemCents + (r.taxCents ?? 0) + (r.shippingCents ?? 0) - (r.discountCents ?? 0));
  }

  /** Whether one's price is in another currency than the home one. */
  private foreign(r: typeof comingItems.$inferSelect): boolean {
    return r.currency !== null && r.currency !== this.d.settings.get('general.currency');
  }

  /** One's price paid in the home currency (D173): another currency's at the order day's rate, or null without one. */
  private paidOf(r: typeof comingItems.$inferSelect): number | null {
    const paid = this.paidInCurrency(r);
    if (paid === null || !this.foreign(r)) return paid;
    return this.d.settings.get('orders.exchangeRates') && r.rate ? Math.round(paid * r.rate) : null;
  }

  /**
   * Several games, one price (D173): a lot, a pack or a bundle on the way becomes a game of its own for each, in the
   * order given. A game's price is its own when given; the others share what's left of the lot's evenly. The tax, the
   * shipping and the discount are shared evenly. The lot is kept, as split, so its email never adds it again.
   */
  split(id: number, games: { platformKey: string | null; title: string; cents: number | null }[]): ComingView[] {
    const row = this.d.db.select().from(comingItems).where(eq(comingItems.id, id)).get();
    if (!row || row.status !== 'waiting') throw new CopyError("That isn't on the way.");
    if (games.length < 2 || games.length > 40) throw new CopyError('Name two games or more (40 at most).');
    const n = games.length;
    const all = (cents: number | null) => (cents === null ? null : cents * row.quantity);
    const lot = all(row.itemCents);
    const given = games.reduce((sum, g) => sum + (g.cents ?? 0), 0);
    const rest = splitEvenly(Math.max(0, (lot ?? 0) - given), games.filter((g) => g.cents === null).length);
    const shares = (cents: number | null) => (cents === null ? games.map(() => null) : splitEvenly(cents, n));
    const [tax, shipping, discount] = [shares(all(row.taxCents)), shares(all(row.shippingCents)), shares(all(row.discountCents))];
    const now = new Date().toISOString();
    const made: (typeof comingItems.$inferSelect)[] = [];
    this.d.db.transaction((tx) => {
      let open = 0;
      games.forEach((g, k) => {
        const itemCents = g.cents ?? (lot === null ? null : rest[open++]!);
        const child = tx
          .insert(comingItems)
          .values({
            mailRef: row.mailRef,
            // After its lot's own place, so an email's items stay one each.
            itemIndex: (row.itemIndex + 1) * 1000 + k,
            store: row.store,
            orderDate: row.orderDate,
            orderNumber: row.orderNumber,
            link: row.link,
            listingTitle: g.title.slice(0, 200),
            quantity: 1,
            currency: row.currency,
            itemCents,
            taxCents: tax[k]!,
            shippingCents: shipping[k]!,
            discountCents: discount[k]!,
            rate: row.rate,
            lotOf: row.id,
            readBy: row.readBy,
            platformKey: g.platformKey,
            title: g.platformKey ? g.title.slice(0, 200) : null,
            status: 'waiting',
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        made.push(child);
      });
      tx.update(comingItems).set({ status: 'split', updatedAt: now }).where(eq(comingItems.id, row.id)).run();
    });
    return made.map((r) => this.view(r));
  }

  /**
   * An order page's text (D176: copied from the shop's page, or read from a screenshot on the phone): its items on the
   * way, each matched as an email's are. With `into`, it names that game on the way (an Amazon order's game its email
   * didn't name: every one of that order's unnamed games is replaced by the page's). Pasted twice, it's added once.
   */
  fromPage(text: string, into?: number): ComingView[] {
    const today = new Date().toISOString().slice(0, 10);
    const row = into !== undefined ? this.d.db.select().from(comingItems).where(eq(comingItems.id, into)).get() : undefined;
    if (into !== undefined && (!row || row.status !== 'waiting')) throw new CopyError("That isn't on the way.");
    const order = readOrderPage(text.slice(0, 200_000), today, row?.store);
    if (!order || order.items.length === 0) throw new CopyError("That doesn't read as an order page: copy the whole page (Ctrl+A, then Ctrl+C), the one with each item's price.");
    if (row) {
      order.orderNumber ??= row.orderNumber;
      if (orderPageDate(text) === null && row.orderDate) order.date = row.orderDate;
    }
    const ref = `page:${createHash('sha256').update(row ? `${row.mailRef}|${text}` : text).digest('hex').slice(0, 32)}`;
    const now = new Date().toISOString();
    if (row) {
      // The order's unnamed games give way to the page's.
      const unnamed = this.d.db.select().from(comingItems).where(and(eq(comingItems.status, 'waiting'), eq(comingItems.mailRef, row.mailRef))).all().filter((r) => r.id === row.id || isAmazonUnknown(r.listingTitle));
      for (const u of unnamed) this.d.db.update(comingItems).set({ status: 'split', updatedAt: now }).where(eq(comingItems.id, u.id)).run();
    }
    return this.addComing(ref, order);
  }

  /**
   * Amazon's order history download (D176: Request your data > Your Orders; its CSV, or the zip it comes in): the games
   * in it, by their names (a console named, and a game Squirrelcade is sure of), each on the way to be checked and
   * added, its price before tax and shipping. A game you have already, on that console, is left out; so is each item
   * read before. What it found, counted.
   */
  async fromAmazonHistory(data: Buffer): Promise<{ items: number; games: number; added: number; have: number; unsure: number }> {
    let text = data.toString('utf8');
    if (isZip(data)) {
      const entry = readZip(data).find((e) => /OrderHistory.*\.csv$/i.test(e.name)) ?? readZip(data).find((e) => /\.csv$/i.test(e.name));
      if (!entry) throw new CopyError("That zip has no order history in it (Retail.OrderHistory.1.csv).");
      text = entry.read().toString('utf8');
    }
    const rows = readAmazonHistory(text);
    if (!rows) throw new CopyError("That isn't Amazon's order history: it's the file Your Orders in Amazon's Request your data (its columns Order ID, Order Date, Product Name...).");
    const counts = { items: rows.length, games: 0, added: 0, have: 0, unsure: 0 };
    for (const [i, r] of rows.entries()) {
      // A long history doesn't hold the server: other requests get their turn every 25 rows.
      if (i % 25 === 24) await new Promise((resolve) => setImmediate(resolve));
      const platformKey = productPlatform(r.productName);
      if (!platformKey) continue;
      counts.games++;
      const game = this.matchListing(r.productName);
      if (game) {
        const mine = this.d.lookup.search(game.title, { platformKey: game.platformKey, exact: true, limit: 1, brief: true, followed: false })[0];
        if (mine && (mine.answer === 'own' || mine.answer === 'own-not-in-catalog')) {
          counts.have++;
          continue;
        }
      } else counts.unsure++;
      const added = this.addComing(`amazon-history:${r.orderId}|${i}`, {
        store: 'Amazon',
        date: r.date,
        orderNumber: r.orderId,
        currency: r.currency,
        items: [{ title: r.productName.slice(0, 200), priceCents: r.unitPriceCents, quantity: r.quantity }],
        taxCents: null,
        shippingCents: null,
        discountCents: null,
        totalCents: null,
        link: `https://www.amazon.com/your-orders/order-details?orderID=${r.orderId}`,
        readBy: 'plain',
      });
      counts.added += added.length;
    }
    await this.fillRates();
    return counts;
  }

  /**
   * The games a lot may be, to start its split (D173): the ones its listing names, each with the game Squirrelcade takes
   * it for on the console the listing names (or anywhere), and the lot's whole price paid.
   */
  lotGuesses(id: number): { games: { name: string; platformKey: string | null; platform: string | null; title: string | null }[]; paidCents: number | null } | null {
    const row = this.d.db.select().from(comingItems).where(eq(comingItems.id, id)).get();
    if (!row) return null;
    const platformKey = productPlatform(row.listingTitle);
    const games = lotGames(row.listingTitle).map((name) => {
      const found = platformKey ? this.d.lookup.search(name, { platformKey, limit: 1, brief: true, followed: false })[0] : this.d.lookup.productMatch(name).results[0];
      return { name, platformKey: found?.platformKey ?? platformKey, platform: found?.platform ?? (platformKey ? this.platformName(platformKey) : null), title: found?.title ?? null };
    });
    const paid = this.paidOf(row);
    return { games, paidCents: paid === null ? null : paid * row.quantity };
  }

  private view(r: typeof comingItems.$inferSelect): ComingView {
    const paid = this.paidOf(r);
    const game = r.platformKey && r.title ? this.d.lookup.search(r.title, { platformKey: r.platformKey, exact: true, limit: 1, brief: true })[0] : undefined;
    const maybe = r.platformKey && r.title ? [] : r.status === 'waiting' && !isAmazonUnknown(r.listingTitle) ? this.d.lookup.productMatch(r.listingTitle).results.slice(0, 5).map((m) => ({ platformKey: m.platformKey, platform: m.platform, title: m.title })) : [];
    return {
      id: r.id,
      store: r.store,
      orderDate: r.orderDate,
      orderNumber: r.orderNumber,
      link: r.link,
      listingTitle: r.listingTitle,
      quantity: r.quantity,
      currency: r.currency,
      itemCents: r.itemCents,
      taxCents: r.taxCents,
      shippingCents: r.shippingCents,
      discountCents: r.discountCents,
      paidCents: paid,
      paidInCurrencyCents: this.foreign(r) ? this.paidInCurrency(r) : null,
      several: r.lotOf === null && severalGames(r.listingTitle),
      unknown: isAmazonUnknown(r.listingTitle),
      lotOf: r.lotOf,
      readBy: r.readBy,
      expectedOn: r.expectedOn,
      platformKey: r.platformKey,
      platform: game?.platform ?? (r.platformKey ? this.platformName(r.platformKey) : null),
      title: r.title,
      entryId: game?.entryId ?? null,
      maybe,
      status: r.status as ComingView['status'],
      createdAt: r.createdAt,
    };
  }

  /** A console's name, from its key ("PlayStation 3" for playstation-3). */
  private platformName(key: string): string {
    return this.d.db.select({ name: platforms.name }).from(platforms).where(eq(platforms.key, key)).get()?.name ?? KNOWN_PLATFORMS.find((p) => p.key === key)?.name ?? key;
  }

  /** The owner says which game one is (or that it's none they know: null). */
  setGame(id: number, game: { platformKey: string; title: string } | null): ComingView | null {
    const row = this.d.db.select().from(comingItems).where(eq(comingItems.id, id)).get();
    if (!row) return null;
    const updated = this.d.db
      .update(comingItems)
      .set({ platformKey: game?.platformKey ?? null, title: game?.title ?? null, updatedAt: new Date().toISOString() })
      .where(eq(comingItems.id, id))
      .returning()
      .get();
    return this.view(updated);
  }

  dismiss(id: number): boolean {
    return this.d.db.update(comingItems).set({ status: 'dismissed', updatedAt: new Date().toISOString() }).where(and(eq(comingItems.id, id), eq(comingItems.status, 'waiting'))).run().changes > 0;
  }

  /**
   * It's here: a copy of its game, with the price paid (as Settings > Email counts it) and the day of the order, in
   * the condition a game just bought is given; one of several stays on the way with one fewer. The new copy's id and key.
   */
  arrived(id: number): { id: number; key: string; platformKey: string; platform: string; title: string } {
    const row = this.d.db.select().from(comingItems).where(eq(comingItems.id, id)).get();
    if (!row || row.status !== 'waiting') throw new CopyError("That isn't on the way.");
    if (!row.platformKey || !row.title) throw new CopyError('Say which game it is first.');
    const view = this.view(row);
    const copy = this.d.collection.addCopy({
      platformKey: row.platformKey,
      title: row.title,
      completeness: this.d.settings.get('collection.boughtCondition'),
      costCents: view.paidCents,
      datePurchased: row.orderDate,
      conditionGiven: false,
    });
    const now = new Date().toISOString();
    if (row.quantity > 1) this.d.db.update(comingItems).set({ quantity: row.quantity - 1, updatedAt: now }).where(eq(comingItems.id, id)).run();
    else this.d.db.update(comingItems).set({ status: 'arrived', copyId: copy.id, updatedAt: now }).where(eq(comingItems.id, id)).run();
    return { id: copy.id, key: copy.key, platformKey: row.platformKey, platform: this.platformName(row.platformKey), title: row.title };
  }

  /** Store Mode's index: each game on the way by "platform key|normalized title". */
  index(): Map<string, OnTheWay> {
    const map = new Map<string, OnTheWay>();
    if (!this.watchOn()) return map;
    for (const r of this.d.db.select().from(comingItems).where(eq(comingItems.status, 'waiting')).orderBy(comingItems.createdAt).all()) {
      if (!r.platformKey || !r.title) continue;
      map.set(`${r.platformKey}|${normalizeTitle(r.title)}`, { id: r.id, store: r.store, orderDate: r.orderDate, paidCents: this.paidOf(r) });
    }
    return map;
  }

  private saveWatch(ok: boolean, message: string): void {
    this.writeState(LAST_KEY, { at: new Date().toISOString(), ok, message });
  }

  private sweep(): void {
    const now = Date.now();
    for (const map of [this.finds, this.batches, this.storeJobs] as Map<string, { finishedAt: number | null }>[]) for (const [k, j] of map) if (j.finishedAt !== null && now - j.finishedAt > KEEP_MS) map.delete(k);
  }

  private readState<T>(key: string): T | null {
    const row = this.d.db.select().from(appState).where(eq(appState.key, key)).get();
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  private writeState(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.d.db.insert(appState).values({ key, value: json }).onConflictDoUpdate({ target: appState.key, set: { value: json } }).run();
  }
}

/** Which email a reading came from, without the email: a hash of its Message-ID. */
const refOf = (messageId: string) => createHash('sha256').update(messageId).digest('hex').slice(0, 32);

export function registerOrderRoutes(app: FastifyInstance, orders: OrderService, tasks: { enqueue: (name: string) => boolean }): void {
  const off = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, what: 'find' | 'watch') =>
    reply.code(409).send({ error: 'off', message: what === 'find' ? 'Turn on "Find what you paid in your order emails" first (Settings > Email).' : 'Turn on On the way first (Settings > Email).' });
  app.get('/api/v1/orders', async () => orders.status());
  app.post('/api/v1/orders/find', async (request, reply) => {
    if (!orders.findOn()) return off(reply, 'find');
    const copyId = (request.body as { copyId?: unknown } | null)?.copyId;
    if (!Number.isInteger(copyId)) return reply.code(400).send({ error: 'invalid', message: 'Send the copyId.' });
    try {
      return orders.startFind(copyId as number);
    } catch (err) {
      if (err instanceof CopyError) return reply.code(404).send({ error: 'not-found', message: err.message });
      throw err;
    }
  });
  app.get('/api/v1/orders/find/:id', async (request, reply) => orders.find((request.params as { id: string }).id) ?? reply.code(404).send({ error: 'not-found', message: 'That lookup is no longer kept.' }));
  app.post('/api/v1/orders/batch', async (request, reply) => {
    if (!orders.findOn()) return off(reply, 'find');
    const b = (request.body ?? {}) as { platform?: unknown; added?: unknown; recentDays?: unknown };
    return orders.startBatch({
      platform: typeof b.platform === 'string' ? b.platform : undefined,
      added: typeof b.added === 'string' ? b.added : undefined,
      recentDays: typeof b.recentDays === 'number' && b.recentDays > 0 && b.recentDays <= 366 ? b.recentDays : undefined,
    });
  });
  app.get('/api/v1/orders/batch/:id', async (request, reply) => orders.batch((request.params as { id: string }).id) ?? reply.code(404).send({ error: 'not-found', message: 'That lookup is no longer kept.' }));
  // Find my stores: the stores of the mailbox's purchase emails, for "Purchase emails from" (owner only: no viewer path).
  app.post('/api/v1/orders/stores', async (_request, reply) => (orders.watchOn() ? orders.startStores() : off(reply, 'watch')));
  app.get('/api/v1/orders/stores/:id', async (request, reply) => orders.storesJob((request.params as { id: string }).id) ?? reply.code(404).send({ error: 'not-found', message: 'That search is no longer kept.' }));
  app.get('/api/v1/orders/found', async () => ({ found: orders.findOn() ? orders.found() : [] }));
  app.delete('/api/v1/orders/found/:copyId', async (request) => {
    orders.forgetFound(Number((request.params as { copyId: string }).copyId));
    return { ok: true };
  });

  app.get('/api/v1/coming', async (request) => ({ on: orders.watchOn(), items: orders.coming((request.query as { all?: string }).all === '1') }));
  app.post('/api/v1/coming/check', async (_request, reply) => {
    if (!orders.watchOn()) return off(reply, 'watch');
    return { queued: tasks.enqueue('orders-watch') };
  });
  app.put('/api/v1/coming/:id', async (request, reply) => {
    const b = (request.body ?? {}) as { platformKey?: unknown; title?: unknown };
    const game = typeof b.platformKey === 'string' && typeof b.title === 'string' && b.title.trim() ? { platformKey: b.platformKey, title: b.title.trim().slice(0, 200) } : null;
    const view = orders.setGame(Number((request.params as { id: string }).id), game);
    return view ?? reply.code(404).send({ error: 'not-found', message: "That isn't on the way." });
  });
  // An order page pasted, or read from a screenshot (D176): its games on the way, or the unnamed game it names.
  app.post('/api/v1/coming/page', async (request, reply) => {
    const b = (request.body ?? {}) as { text?: unknown; into?: unknown };
    if (typeof b.text !== 'string' || !b.text.trim()) return reply.code(400).send({ error: 'invalid', message: 'Paste the order page.' });
    try {
      return reply.code(201).send({ items: orders.fromPage(b.text, typeof b.into === 'number' ? b.into : undefined) });
    } catch (err) {
      if (err instanceof CopyError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });
  // Amazon's order history download (D176), dropped in.
  app.post('/api/v1/coming/amazon-history', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no-file', message: "Choose Amazon's order history: the zip from Request your data, or the CSV in it." });
    try {
      return await orders.fromAmazonHistory(await file.toBuffer());
    } catch (err) {
      if (err instanceof CopyError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });
  // Several games, one price (D173): what the lot may be, and the lot made a game of its own for each.
  app.get('/api/v1/coming/:id/games', async (request, reply) => orders.lotGuesses(Number((request.params as { id: string }).id)) ?? reply.code(404).send({ error: 'not-found', message: "That isn't on the way." }));
  app.post('/api/v1/coming/:id/split', async (request, reply) => {
    const b = (request.body ?? {}) as { games?: unknown };
    const games = Array.isArray(b.games)
      ? b.games.flatMap((g: unknown) => {
          const x = (g ?? {}) as { platformKey?: unknown; title?: unknown; cents?: unknown };
          if (typeof x.title !== 'string' || !x.title.trim()) return [];
          const cents = typeof x.cents === 'number' && Number.isInteger(x.cents) && x.cents >= 0 ? x.cents : null;
          return [{ platformKey: typeof x.platformKey === 'string' && x.platformKey ? x.platformKey : null, title: x.title.trim(), cents }];
        })
      : [];
    try {
      return reply.code(201).send({ items: orders.split(Number((request.params as { id: string }).id), games) });
    } catch (err) {
      if (err instanceof CopyError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });
  app.post('/api/v1/coming/:id/dismiss', async (request, reply) => (orders.dismiss(Number((request.params as { id: string }).id)) ? { ok: true } : reply.code(404).send({ error: 'not-found', message: "That isn't on the way." })));
  app.post('/api/v1/coming/:id/arrived', async (request, reply) => {
    try {
      return reply.code(201).send(orders.arrived(Number((request.params as { id: string }).id)));
    } catch (err) {
      if (err instanceof CopyError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });
}
