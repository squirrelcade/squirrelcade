import {
  dayIn,
  gmailOrderSearch,
  ITEM_MATCH,
  itemCost,
  KNOWN_PLATFORMS,
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
  readOrderEmail,
  type FoundOrder,
  type OrderEmail,
  type PaidCounts,
} from '@squirrelcade/core';
import { and, desc, eq, isNull, lte, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { simpleParser } from 'mailparser';
import type { Logger } from 'pino';
import { CopyError, type CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import { appState, comingItems, copies, platforms } from './db/schema.js';
import { HelperError, type HelperQueue } from './helper.js';
import type { LookupService } from './lookup.js';
import { signInProblem, type FoundMail, type Mailbox, type MailboxOpener, type MailImportService } from './mailImport.js';
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

/** A price found for a copy by Look up prices in my email, kept until it's used, turned down, or the copy has a price. */
export interface StoredFound extends FoundPrice {
  copyId: number;
  at: string;
}

/** A game on the way (GET /api/v1/coming). */
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
  paidCents: number | null;
  readBy: string;
  /** The game it is, when Squirrelcade is sure or the owner said; else null, with the games it may be. */
  platformKey: string | null;
  platform: string | null;
  title: string | null;
  entryId: number | null;
  maybe: { platformKey: string; platform: string; title: string }[];
  status: 'waiting' | 'arrived' | 'dismissed';
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
    },
  ) {}

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
  startBatch(filter: { platform?: string; added?: string }): BatchJob {
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
  private missingPrice(filter: { platform?: string; added?: string }, limit = this.d.settings.get('orders.batchMax')) {
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

  /** An order's items as games on the way (each once: an email's item is never added twice); the new ones. */
  private addComing(ref: string, order: FoundOrder): ComingView[] {
    const now = new Date().toISOString();
    const out: ComingView[] = [];
    order.items.forEach((item, index) => {
      const known = this.d.db.select({ id: comingItems.id }).from(comingItems).where(and(eq(comingItems.mailRef, ref), eq(comingItems.itemIndex, index))).get();
      if (known) return;
      // Each share for one copy: the price paid is worked out from them as Settings > Email counts it, then.
      const cost = itemCost(order, index, 'all');
      const game = this.matchListing(item.title);
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

  /** The game a listing's title is, when Squirrelcade is sure: its console named, or one console's game only, and the title's words all there. */
  private matchListing(listing: string): { platformKey: string; title: string } | null {
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
    return rows.filter((r) => r.status === 'waiting' || (all && (r.updatedAt ?? r.createdAt) >= month)).map((r) => this.view(r));
  }

  /** One's price paid, as Settings > Email counts it now. */
  private paidOf(r: typeof comingItems.$inferSelect): number | null {
    const counts = this.d.settings.get('orders.paidCounts') as PaidCounts;
    if (r.itemCents === null) return null;
    if (counts === 'item') return r.itemCents;
    if (counts === 'tax') return r.itemCents + (r.taxCents ?? 0);
    return Math.max(0, r.itemCents + (r.taxCents ?? 0) + (r.shippingCents ?? 0) - (r.discountCents ?? 0));
  }

  private view(r: typeof comingItems.$inferSelect): ComingView {
    const paid = this.paidOf(r);
    const game = r.platformKey && r.title ? this.d.lookup.search(r.title, { platformKey: r.platformKey, exact: true, limit: 1, brief: true })[0] : undefined;
    const maybe = r.platformKey && r.title ? [] : r.status === 'waiting' ? this.d.lookup.productMatch(r.listingTitle).results.slice(0, 5).map((m) => ({ platformKey: m.platformKey, platform: m.platform, title: m.title })) : [];
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
      readBy: r.readBy,
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
    for (const map of [this.finds, this.batches] as Map<string, { finishedAt: number | null }>[]) for (const [k, j] of map) if (j.finishedAt !== null && now - j.finishedAt > KEEP_MS) map.delete(k);
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
    const b = (request.body ?? {}) as { platform?: unknown; added?: unknown };
    return orders.startBatch({ platform: typeof b.platform === 'string' ? b.platform : undefined, added: typeof b.added === 'string' ? b.added : undefined });
  });
  app.get('/api/v1/orders/batch/:id', async (request, reply) => orders.batch((request.params as { id: string }).id) ?? reply.code(404).send({ error: 'not-found', message: 'That lookup is no longer kept.' }));
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
