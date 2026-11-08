import { exportAttachment, exportLinks, hostAllowed, parseDealEmail, PRICECHARTING_COLLECTION_URL, type MailHeader, type PriceChartingDeal } from '@squirrelcade/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { Logger } from 'pino';
import { exportDate, type CollectionService } from './collection.js';
import type { Db } from './db/index.js';
import { appState } from './db/schema.js';
import { MailAccounts, type MailAccountRow } from './mailAccounts.js';
import type { NotificationService } from './notifications.js';
import type { SettingsService } from './settings.js';
import type { TaskRunner } from './tasks.js';
import { unpackExport, ZipError } from './zip.js';

/**
 * Collection updates from email (Settings > Features, off by default): PriceCharting emails a link to your export
 * when you ask for one on its My Collection page, and this watches your mailbox for that email and updates the
 * collection from it, as if you had uploaded the file. The mailbox is opened read-only: nothing is marked read,
 * moved or deleted, and only emails from PriceCharting's address with its subject are fetched. The export is
 * downloaded from the email's link only when that link is on an allowed host (Google's storage, PriceCharting).
 */

/** An email the mailbox found: its id (Message-ID), when it came, its subject and sender, and the whole message. */
export interface FoundMail {
  id: string;
  date: string;
  subject: string;
  from: string;
  /** The sender's name ("eBay"), when the email gives one. */
  fromName?: string;
  source: Buffer;
}

/**
 * A search of the mailbox for order emails (D155, D156): Gmail's own search words when the mailbox is Gmail's
 * (X-GM-RAW, which says its own time and size), else the emails since a day with words in their text or from senders;
 * the newest `limit`, none larger than `maxBytes`.
 */
export interface MailSearch {
  since: Date;
  gmail?: string;
  text?: string;
  from?: string[];
  limit: number;
  maxBytes: number;
  /** Only the emails whose subject this takes: the newest emails' subjects are read first (ten times `limit` of them), and only those fetched whole. */
  subject?: (subject: string) => boolean;
}

/** The mailbox to read, and how to sign in to it. */
export interface MailAccount {
  host: string;
  port: number;
  user: string;
  pass: string;
  /** A folder to look in; empty: All Mail where the server has one, else the inbox. */
  folder: string;
  /** Encrypted from the start (false: STARTTLS); unset: by the port (143 is STARTTLS). */
  secure?: boolean;
}

/** An open mailbox (IMAP in Squirrelcade, a stand-in in tests). */
export interface Mailbox {
  /** The emails since a date from a sender with words in their subject (the newest `limit`), oldest first, and the folder looked in. */
  find(query: { since: Date; from: string; subject: string; limit?: number }): Promise<{ folder: string; mails: FoundMail[] }>;
  /** Whether it's Gmail's, whose own search words work (MailSearch.gmail). */
  gmail: boolean;
  /** The emails a search finds (the newest `limit`), oldest first. */
  search(query: MailSearch): Promise<{ folder: string; mails: FoundMail[] }>;
  /**
   * The sender and subject of the emails with one of these words in their subject (Gmail's own search words when it's
   * Gmail's), the newest `limit`: their headers only, no email fetched whole (Find my stores).
   */
  headers?(query: { since: Date; gmail?: string; subjects: readonly string[]; limit: number }): Promise<MailHeader[]>;
  close(): Promise<void>;
}

export type MailboxOpener = (account: MailAccount) => Promise<Mailbox>;
/** Downloads an export from a link: its file name and contents. */
export type ExportDownloader = (url: string) => Promise<{ name: string; data: Buffer }>;

/** An email larger than this isn't fetched (PriceCharting's is about 7 KB; an attached export is far smaller than this). */
const MAX_MAIL_BYTES = 30 * 1024 * 1024;
/** An export larger than this isn't downloaded (a 4,000-copy collection zips to under 1 MB). */
const MAX_EXPORT_BYTES = 50 * 1024 * 1024;
/** How many emails of the search are looked at, newest ones. */
const MAX_MAILS = 20;

/** Reads a mailbox over IMAP (with imapflow), read-only. */
export const imapMailbox: MailboxOpener = async (account) => {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    // 993 is encrypted from the start; STARTTLS (port 143) upgrades.
    secure: account.secure ?? account.port !== 143,
    auth: { user: account.user, pass: account.pass },
    logger: false,
    connectionTimeout: 20_000,
    greetingTimeout: 15_000,
    socketTimeout: 60_000,
  });
  // A dropped connection is reported by the command that was waiting, not as an error of its own.
  client.on('error', () => undefined);
  await client.connect();
  const folderOf = async () => {
    if (account.folder) return account.folder;
    const boxes = await client.list();
    return boxes.find((b) => b.specialUse === '\\All')?.path ?? 'INBOX';
  };
  /** The emails a search found (the newest `limit`): their size first, so a huge message is never downloaded. */
  const fetchSmall = async (folder: string, found: number[] | false | undefined, limit: number, maxBytes: number, subject?: (s: string) => boolean): Promise<FoundMail[]> => {
    const uids = (found || []).slice(subject ? -limit * 10 : -limit);
    if (uids.length === 0) return [];
    let small: number[] = [];
    // A subject to match: the envelopes first (a few hundred bytes each), the newest `limit` that match fetched whole.
    for await (const m of client.fetch(uids, { uid: true, size: true, ...(subject ? { envelope: true } : {}) }, { uid: true })) {
      if ((m.size ?? 0) <= maxBytes && (!subject || subject(m.envelope?.subject ?? ''))) small.push(m.uid);
    }
    small = small.sort((a, b) => a - b).slice(-limit);
    const mails: FoundMail[] = [];
    if (small.length === 0) return mails;
    for await (const m of client.fetch(small, { uid: true, envelope: true, internalDate: true, source: true }, { uid: true })) {
      if (!m.source) continue;
      const date = new Date(m.internalDate ?? m.envelope?.date ?? Date.now());
      mails.push({
        id: m.envelope?.messageId || `${folder}:${m.uid}`,
        date: (Number.isNaN(date.getTime()) ? new Date() : date).toISOString(),
        subject: m.envelope?.subject ?? '',
        from: m.envelope?.from?.[0]?.address ?? '',
        fromName: m.envelope?.from?.[0]?.name || undefined,
        source: m.source,
      });
    }
    return mails.sort((a, b) => a.date.localeCompare(b.date));
  };
  const gmail = Boolean(client.capabilities?.has('X-GM-EXT-1'));
  return {
    gmail,
    async find({ since, from, subject, limit = MAX_MAILS }) {
      const folder = await folderOf();
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        // Only the conditions set: an empty sender or subject would search for nothing, or refuse.
        const found = await client.search({ since, ...(from ? { from } : {}), ...(subject ? { subject } : {}) }, { uid: true });
        return { folder, mails: await fetchSmall(folder, found, limit, MAX_MAIL_BYTES) };
      } finally {
        lock.release();
      }
    },
    async search({ since, gmail: words, text, from, limit, maxBytes, subject }) {
      const folder = await folderOf();
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const senders = (from ?? []).map((f) => f.trim()).filter(Boolean);
        const query =
          words && gmail
            ? { gmraw: words }
            : { since, smaller: maxBytes, ...(text ? { text } : {}), ...(senders.length === 1 ? { from: senders[0] } : senders.length > 1 ? { or: senders.map((f) => ({ from: f })) } : {}) };
        return { folder, mails: await fetchSmall(folder, await client.search(query, { uid: true }), limit, maxBytes, subject) };
      } finally {
        lock.release();
      }
    },
    async headers({ since, gmail: words, subjects, limit }) {
      const folder = await folderOf();
      const lock = await client.getMailboxLock(folder, { readOnly: true });
      try {
        const wanted = subjects.map((s) => s.trim()).filter(Boolean);
        const query = words && gmail ? { gmraw: words } : { since, ...(wanted.length === 1 ? { subject: wanted[0] } : wanted.length > 1 ? { or: wanted.map((s) => ({ subject: s })) } : {}) };
        const uids = ((await client.search(query, { uid: true })) || []).slice(-limit);
        const out: MailHeader[] = [];
        if (uids.length === 0) return out;
        // The envelope only: who sent it, its subject and day (a few hundred bytes each).
        for await (const m of client.fetch(uids, { uid: true, envelope: true, internalDate: true }, { uid: true })) {
          const date = new Date(m.internalDate ?? m.envelope?.date ?? Date.now());
          out.push({
            from: m.envelope?.from?.[0]?.address ?? '',
            fromName: m.envelope?.from?.[0]?.name || undefined,
            subject: m.envelope?.subject ?? '',
            date: (Number.isNaN(date.getTime()) ? new Date() : date).toISOString(),
          });
        }
        return out;
      } finally {
        lock.release();
      }
    },
    async close() {
      await client.logout().catch(() => client.close());
    },
  };
};

/** Downloads an export: https only, no redirects (a link that moves elsewhere isn't followed), within a size limit. */
export const downloadExport: ExportDownloader = async (url) => {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000), redirect: 'error' });
  if (res.status === 403 || res.status === 404 || res.status === 410) throw new ExpiredLink();
  if (!res.ok) throw new Error(`The export's download answered ${res.status}.`);
  if (Number(res.headers.get('content-length') ?? 0) > MAX_EXPORT_BYTES) throw new Error('The export is too large to be a collection export.');
  const data = Buffer.from(await res.arrayBuffer());
  if (data.length > MAX_EXPORT_BYTES) throw new Error('The export is too large to be a collection export.');
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || '') || 'collection.zip';
  return { name, data };
};

/** PriceCharting deletes an export after 7 days: its link then answers 403 or 404. */
export class ExpiredLink extends Error {
  constructor() {
    super("The export's link has expired (PriceCharting keeps an export for 7 days): ask PriceCharting for a new one (My Collection › Download (CSV)).");
  }
}

/** What became of one export email. */
export interface MailOutcome {
  id: string;
  date: string;
  subject: string;
  /** applied, pending (held for you), refused, duplicate (the same as the current collection), expired, no-export, failed. */
  status: string;
  detail: string;
  importId: number | null;
  checkedAt: string;
}

/** A deal PriceCharting emailed, as kept: the email's id and date with what it says. */
export interface StoredDeal extends PriceChartingDeal {
  id: string;
  date: string;
}

/** The last look at the mailbox. */
export interface MailCheck {
  at: string;
  ok: boolean;
  message: string;
}

/** Settings > Features and Collection updates show this: whether it's on and set up, the last look, the emails used. */
export interface MailStatus {
  on: boolean;
  /** The accounts it reads (never their passwords); none until one is set up. */
  accounts: { id: number; name: string; address: string }[];
  /** Why it can't look yet, when it can't. */
  problem: string | null;
  lastCheck: MailCheck | null;
  recent: MailOutcome[];
  /** Where you ask PriceCharting for an export. */
  exportUrl: string;
}

const SEEN_KEY = 'mail.seen';
const LAST_KEY = 'mail.lastCheck';
const REMINDED_KEY = 'mail.reminded';
const DEALS_KEY = 'mail.deals';
/** How many deals are kept (the newest), whatever their age. */
const KEEP_DEALS = 300;
/** How many deal emails one look reads at most (PriceCharting sends a handful a day). */
const MAX_DEAL_MAILS = 150;
/** How many emails' outcomes are kept (each is looked at once). */
const KEEP_SEEN = 50;

export class MailImportService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly collection: CollectionService,
    private readonly log: Logger,
    private readonly notifications: Pick<NotificationService, 'notice'> | null = null,
    private readonly open: MailboxOpener = imapMailbox,
    private readonly download: ExportDownloader = downloadExport,
  ) {
    this.accounts = new MailAccounts(db, settings);
  }

  /** Told of each look's new deals (the deals service's messages about top-ranked games). */
  private dealListener: ((deals: StoredDeal[]) => Promise<void>) | null = null;

  onNewDeals(listener: (deals: StoredDeal[]) => Promise<void>): void {
    this.dealListener = listener;
  }

  enabled(): boolean {
    return this.settings.get('features.mail');
  }

  /** The email accounts (Settings > Email). */
  readonly accounts: MailAccounts;

  /** The accounts that export and deal emails are read in: the ones chosen on Settings > Collection and Acorns (empty: all). */
  private plan(): { reading: { account: MailAccountRow; exports: boolean; deals: boolean }[]; skipped: { account: MailAccountRow; problem: string }[]; problem: string | null } {
    const exports = this.accounts.readers(this.settings.get('mail.accounts'));
    const dealsOn = this.settings.get('mail.deals');
    const deals = dealsOn ? this.accounts.readers(this.settings.get('mail.dealAccounts')) : { accounts: [] as MailAccountRow[], skipped: [] as { account: MailAccountRow; problem: string }[], problem: null };
    const ids = new Map<number, MailAccountRow>();
    for (const a of [...exports.accounts, ...deals.accounts]) ids.set(a.id, a);
    const reading = [...ids.values()].map((account) => ({ account, exports: exports.accounts.some((a) => a.id === account.id), deals: deals.accounts.some((a) => a.id === account.id) }));
    const skipped = [...exports.skipped, ...deals.skipped.filter((d) => !exports.skipped.some((e) => e.account.id === d.account.id))];
    return { reading, skipped, problem: reading.length === 0 ? exports.problem : null };
  }

  status(): MailStatus {
    const { reading, problem } = this.plan();
    return {
      on: this.enabled(),
      accounts: reading.map((r) => ({ id: r.account.id, name: r.account.name, address: r.account.address })),
      problem,
      lastCheck: this.readState<MailCheck>(LAST_KEY),
      recent: this.seen().slice(0, 10),
      exportUrl: PRICECHARTING_COLLECTION_URL,
    };
  }

  /** Signs in to each account that exports are read in and looks for export emails, changing nothing: whether it works, and what it found. */
  async test(): Promise<{ ok: boolean; message: string }> {
    const { reading, problem } = this.plan();
    if (reading.length === 0) return { ok: false, message: problem! };
    const lines: string[] = [];
    let ok = true;
    for (const { account } of reading) {
      try {
        const { folder, mails } = await this.find(account, false, true);
        const newest = mails.at(-1);
        this.accounts.record(account.id, 'read', true, `Looked in ${folder}.`);
        lines.push(
          `${account.name}: signed in to ${account.address} and looked in ${folder}: ` +
            (newest
              ? `${mails.length === 1 ? 'one export email' : `${mails.length} export emails`} from the last ${this.settings.get('mail.maxAgeDays')} days, the newest on ${newest.date.slice(0, 10)}.`
              : `no export email from the last ${this.settings.get('mail.maxAgeDays')} days yet. Ask PriceCharting for an export (My Collection \u203a Download (CSV)), and Squirrelcade picks it up within ${this.settings.get('mail.checkMinutes')} minutes.`),
        );
      } catch (err) {
        ok = false;
        const message = signInProblem(err);
        this.accounts.record(account.id, 'read', false, message);
        lines.push(`${account.name}: ${message}`);
      }
    }
    return { ok, message: lines.join(' ') };
  }

  /**
   * The task: each export email not seen before (in any of the accounts read), oldest first, updates the collection.
   * An account that fails doesn't stop the others; it fails the task only when none could be read. What happened, in a line.
   */
  async check(): Promise<string> {
    if (!this.enabled()) return 'Stash updates from email are off (Settings > Features).';
    const { reading, skipped, problem } = this.plan();
    for (const s of skipped) this.accounts.record(s.account.id, 'read', false, s.problem);
    if (reading.length === 0) {
      this.saveCheck(false, problem!);
      return problem!;
    }
    const mails: FoundMail[] = [];
    const dealMails: FoundMail[] = [];
    const failures: string[] = [];
    let worked = 0;
    for (const { account, exports, deals } of reading) {
      try {
        const found = await this.find(account, deals, exports);
        for (const m of found.mails) if (!mails.some((x) => x.id === m.id)) mails.push(m);
        for (const m of found.deals) if (!dealMails.some((x) => x.id === m.id)) dealMails.push(m);
        this.accounts.record(account.id, 'read', true, `Looked in ${found.folder}.`);
        worked++;
      } catch (err) {
        const message = signInProblem(err);
        this.accounts.record(account.id, 'read', false, message);
        failures.push(reading.length > 1 ? `${account.name}: ${message}` : message);
      }
    }
    if (worked === 0) {
      const message = failures.join(' ');
      this.saveCheck(false, message);
      throw new Error(message);
    }
    mails.sort((a, b) => a.date.localeCompare(b.date));
    const seen = new Set(this.seen().map((o) => o.id));
    const fresh = mails.filter((m) => !seen.has(m.id));
    const lines: string[] = [];
    for (const mail of fresh) {
      const outcome = await this.use(mail);
      // A download that failed for a passing reason is tried again next time; everything else is looked at once.
      if (outcome.status !== 'retry') this.remember(outcome);
      lines.push(`${mail.date.slice(0, 10)}: ${outcome.detail}`);
    }
    const newDeals = await this.keepDeals(dealMails);
    if (newDeals.length > 0) {
      lines.push(`${newDeals.length} new ${newDeals.length === 1 ? 'deal' : 'deals'} from PriceCharting.`);
      await this.dealListener?.(newDeals);
    }
    lines.push(...failures);
    const message = lines.length > 0 ? lines.join(' ') : mails.length > 0 ? `No new export emails (${mails.length} used before).` : 'No export emails yet.';
    this.saveCheck(failures.length === 0, message);
    return message;
  }

  /** The deals PriceCharting emailed, from the last Settings > Collection > "Keep deals for" days, newest first. */
  deals(): StoredDeal[] {
    const since = Date.now() - this.settings.get('mail.dealDays') * 86_400_000;
    return (this.readState<StoredDeal[]>(DEALS_KEY) ?? []).filter((d) => Date.parse(d.date) >= since);
  }

  /** Reads the deal emails not kept yet (with the same mail parser as exports); how many new deals there were. */
  private async keepDeals(mails: FoundMail[]): Promise<StoredDeal[]> {
    if (mails.length === 0) return [];
    const kept = this.readState<StoredDeal[]>(DEALS_KEY) ?? [];
    const known = new Set(kept.map((d) => d.id));
    const added: StoredDeal[] = [];
    for (const mail of mails) {
      if (known.has(mail.id)) continue;
      const parsed = await simpleParser(mail.source);
      const html = typeof parsed.html === 'string' ? parsed.html : '';
      const deal = parseDealEmail(mail.subject, html);
      if (deal) added.push({ id: mail.id, date: mail.date, ...deal });
    }
    if (added.length === 0) return [];
    const month = Date.now() - 30 * 86_400_000;
    this.writeState(DEALS_KEY, [...added, ...kept].filter((d) => Date.parse(d.date) >= month).sort((a, b) => b.date.localeCompare(a.date)).slice(0, KEEP_DEALS));
    return added;
  }

  /**
   * "Remind me to export" (Settings > Collection > Reminders): a message when the newest export is that many days
   * old, once per export, with PriceCharting's collection page to ask for the export on. What it did, in a line.
   */
  async remind(): Promise<string> {
    const days = this.settings.get('collection.exportReminderDays');
    if (days <= 0) return 'Reminders are off.';
    const latest = this.collection.listImports(1)[0];
    const since = latest ? (exportDate(latest.fileName) ?? latest.createdAt.slice(0, 10)) : null;
    if (!since) return 'No export yet.';
    const age = Math.floor((Date.now() - Date.parse(`${since}T00:00:00Z`)) / 86_400_000);
    if (age < days) return `The newest export is ${age} days old.`;
    const reminded = this.readState<{ since: string }>(REMINDED_KEY);
    if (reminded?.since === since) return 'Already reminded about this export.';
    const how = this.enabled() ? 'Ask for an export on its My Collection page (Download (CSV)), and Squirrelcade updates your collection from the email.' : 'Export it from its My Collection page and upload the file on Stash updates.';
    await this.notifications?.notice('time for a PriceCharting export', `Your newest PriceCharting export is ${age} days old. ${how} ${PRICECHARTING_COLLECTION_URL}`, '/updates');
    this.writeState(REMINDED_KEY, { since });
    return `Reminded: the newest export is ${age} days old.`;
  }

  /** The export emails, and (with `withDeals`) PriceCharting's wishlist deal emails, in one visit to the mailbox. */
  private async find(row: MailAccountRow, withDeals = false, withExports = true): Promise<{ folder: string; mails: FoundMail[]; deals: FoundMail[] }> {
    const account = this.accounts.imap(row, this.settings.get('mail.folder').trim());
    const since = new Date(Date.now() - this.settings.get('mail.maxAgeDays') * 86_400_000);
    const from = this.settings.get('mail.sender').trim();
    // The server's search is loose (a word anywhere in From); the sender is checked again here.
    const mine = (mails: FoundMail[]) => mails.filter((m) => !from || m.from.toLowerCase().endsWith(from.toLowerCase()));
    const box = await this.open(account);
    try {
      const found = withExports ? await box.find({ since, from, subject: this.settings.get('mail.subject').trim() }) : { folder: 'its mail', mails: [] as FoundMail[] };
      let deals: FoundMail[] = [];
      if (withDeals) {
        const dealSince = new Date(Date.now() - this.settings.get('mail.dealDays') * 86_400_000);
        deals = mine((await box.find({ since: dealSince, from, subject: 'Wishlist', limit: MAX_DEAL_MAILS })).mails).filter((m) => /^\s*\[Wishlist/i.test(m.subject));
      }
      return { folder: found.folder, mails: mine(found.mails), deals };
    } finally {
      await box.close().catch(() => undefined);
    }
  }

  /** Updates the collection from one export email: its attached export, else the export its link leads to. */
  private async use(mail: FoundMail): Promise<MailOutcome & { status: string }> {
    const base = { id: mail.id, date: mail.date, subject: mail.subject, importId: null, checkedAt: new Date().toISOString() };
    let file: { name: string; data: Buffer };
    try {
      const parsed = await simpleParser(mail.source);
      const attached = parsed.attachments.find((a) => exportAttachment(a.filename ?? ''));
      if (attached) file = { name: attached.filename!, data: attached.content };
      else {
        const hosts = this.settings.get('mail.linkHosts');
        const links = exportLinks(typeof parsed.html === 'string' ? parsed.html : '', parsed.text ?? '', hosts);
        if (links.length === 0) return { ...base, status: 'no-export', detail: 'the email had no export link on an allowed site, nor an attached export.' };
        if (!hostAllowed(links[0]!, hosts)) return { ...base, status: 'no-export', detail: 'its link leads to a site that isn\'t allowed.' };
        file = await this.download(links[0]!);
      }
    } catch (err) {
      if (err instanceof ExpiredLink) return { ...base, status: 'expired', detail: err.message };
      const young = Date.now() - Date.parse(mail.date) < 2 * 86_400_000;
      this.log.warn({ context: 'mail', err }, `Couldn't get the export from the email of ${mail.date}`);
      return { ...base, status: young ? 'retry' : 'failed', detail: `the export couldn't be downloaded: ${err instanceof Error ? err.message : String(err)}` };
    }
    try {
      const unpacked = unpackExport(file.name, file.data);
      // An export named without its date takes the email's, so its prices are dated right.
      const fileName = exportDate(unpacked.fileName) ? unpacked.fileName : `collection_${mail.date.slice(0, 10).replace(/-/g, '')}.csv`;
      const outcome = this.collection.importText(unpacked.data.toString('utf8'), { source: 'email', fileName });
      const i = outcome.import;
      const detail = outcome.duplicate
        ? `${fileName} is the collection you have: nothing new.`
        : i.status === 'applied'
          ? `collection updated from ${fileName} (${i.addedCount} added, ${i.removedCount} removed, ${i.changedCount} changed).`
          : i.status === 'pending'
            ? `the update from ${fileName} waits for you on Stash updates: ${i.message ?? 'it needs your confirmation.'}`
            : `the update from ${fileName} was refused: ${i.message ?? 'not a PriceCharting export.'}`;
      this.log.info({ context: 'mail' }, `Export email of ${mail.date}: ${detail}`);
      return { ...base, importId: i.id, status: outcome.duplicate ? 'duplicate' : i.status, detail };
    } catch (err) {
      if (!(err instanceof ZipError)) throw err;
      return { ...base, status: 'refused', detail: err.message };
    }
  }

  private seen(): MailOutcome[] {
    return this.readState<MailOutcome[]>(SEEN_KEY) ?? [];
  }

  private remember(outcome: MailOutcome): void {
    const { status, ...rest } = outcome;
    this.writeState(SEEN_KEY, [{ ...rest, status }, ...this.seen().filter((o) => o.id !== outcome.id)].slice(0, KEEP_SEEN));
  }

  private saveCheck(ok: boolean, message: string): void {
    this.writeState(LAST_KEY, { at: new Date().toISOString(), ok, message } satisfies MailCheck);
  }

  private readState<T>(key: string): T | null {
    const row = this.db.select().from(appState).where(eq(appState.key, key)).get();
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  private writeState(key: string, value: unknown): void {
    const json = JSON.stringify(value);
    this.db.insert(appState).values({ key, value: json }).onConflictDoUpdate({ target: appState.key, set: { value: json } }).run();
  }
}

/** A sign-in or connection failure, said so the owner knows what to fix. */
export function signInProblem(err: unknown): string {
  const e = err as { authenticationFailed?: boolean; code?: string; responseText?: string; message?: string };
  if (e?.authenticationFailed) return `The mailbox refused the sign-in${e.responseText ? ` (${e.responseText})` : ''}: check the username, and use an app password (your account's own password is usually refused).`;
  if (e?.code === 'ENOTFOUND') return "The incoming mail server wasn't found: check its name (imap.gmail.com for Gmail).";
  if (e?.code === 'ECONNREFUSED' || e?.code === 'ETIMEDOUT' || e?.code === 'ESOCKET') return 'The incoming mail server could not be reached: check its name and port (993 for most).';
  return `The mailbox couldn't be read: ${e?.message ?? String(err)}`;
}

export function registerMailRoutes(app: FastifyInstance, mail: MailImportService, tasks: Pick<TaskRunner, 'enqueue'>): void {
  app.get('/api/v1/mail', async () => mail.status());
  app.post('/api/v1/mail/test', async () => mail.test());
  app.post('/api/v1/mail/check', async (_request, reply) => {
    if (!mail.enabled()) return reply.code(409).send({ error: 'off', message: 'Turn on collection updates from your email first (Settings > Features).' });
    return { queued: tasks.enqueue('mail-import') };
  });
}
