import {
  appriseRequest,
  CHANNEL_NAMES,
  discordRequest,
  gotifyRequest,
  importReport,
  normalizeTitle,
  ntfyRequest,
  pushbulletRequest,
  slackRequest,
  telegramRequest,
  webhookRequest,
  wishlistChanges,
  type Channel,
  type ChannelRequest,
  type MessageKind,
  type Report,
  type SnapshotEntry,
} from '@squirrelcade/core';
import { desc, eq, lte } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import nodemailer from 'nodemailer';
import type { Logger } from 'pino';
import type { CatalogService } from './catalogs.js';
import type { CollectionService, ImportOutcome } from './collection.js';
import type { Db } from './db/index.js';
import { appState, wishlistSnapshots } from './db/schema.js';
import type { SettingsService } from './settings.js';
import type { WishlistService } from './wishlist.js';

/** app_state key: the failing tasks already alerted, so each alerts once (and once a day while it keeps failing). */
const FAILING_TASKS = 'tasks.failing';
const DAY_MS = 86_400_000;

/** An email to send, with the mail server to send it through. */
export interface MailMessage {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  html: string;
}

/** A Pushover message to send. */
export interface PushMessage {
  token: string;
  user: string;
  title: string;
  message: string;
  url?: string;
  /** Pushover's -2 (lowest) to 2 (emergency); 0 when left out. */
  priority?: number;
}

/** A web request to a push or chat service; tests replace it with a fake. */
export type Post = (url: string, init: RequestInit) => Promise<Response>;

/** How messages leave Squirrelcade; tests replace these with fakes. */
export interface Transports {
  sendMail: (m: MailMessage) => Promise<void>;
  pushover: (m: PushMessage) => Promise<void>;
  /** The other push and chat services' requests (Pushbullet, ntfy, Gotify, Discord, Telegram, Slack, webhooks, Apprise). */
  post?: Post;
}

/** Sends mail through nodemailer and push messages through Pushover's API. */
export const defaultTransports: Transports = {
  async sendMail(m) {
    const transport = nodemailer.createTransport({
      host: m.host,
      port: m.port,
      // Port 465 speaks TLS from the start; other ports upgrade with STARTTLS when the server offers it.
      secure: m.port === 465,
      auth: m.user ? { user: m.user, pass: m.pass } : undefined,
      connectionTimeout: 15_000,
    });
    await transport.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text, html: m.html });
  },
  async pushover(m) {
    const body = new URLSearchParams({ token: m.token, user: m.user, title: m.title, message: m.message, ...(m.url ? { url: m.url } : {}) });
    if (m.priority) body.set('priority', String(m.priority));
    // Emergency messages repeat until acknowledged: every minute, for up to an hour.
    if (m.priority === 2) {
      body.set('retry', '60');
      body.set('expire', '3600');
    }
    const res = await fetch('https://api.pushover.net/1/messages.json', { method: 'POST', body, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Pushover answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  },
  post: (url, init) => fetch(url, init),
};

export type { Channel, MessageKind };

const PRIORITY_SETTING = {
  summary: 'notifications.pushoverPrioritySummary',
  waiting: 'notifications.pushoverPriorityWaiting',
  problem: 'notifications.pushoverPriorityProblem',
} as const;

/** Whether a message went out on one channel, and why not. */
export interface SendResult {
  channel: Channel;
  ok: boolean;
  error?: string;
}

/** Wishlist snapshots kept for comparing; older ones are removed. */
const KEEP_SNAPSHOTS = 30;
/** Pushover rejects messages over 1,024 characters. */
const PUSH_LIMIT = 1000;

export const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Every email's look: Squirrelcade's wordmark on its deep forest green, the message on a white card, and a button
 * to open it. Inline styles only (what email apps keep); light colors that dark modes can turn.
 */
export function emailLayout(bodyHtml: string, url: string | null): string {
  const button = url
    ? `<div style="padding:0 24px 24px"><a href="${escapeHtml(url)}" style="display:inline-block;background:#2b7a4b;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">Open Squirrelcade</a></div>`
    : '';
  return [
    '<div style="background:#f2f6f2;padding:24px 12px;font-family:system-ui,-apple-system,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif">',
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d6e1d8;border-radius:12px;overflow:hidden">',
    '<div style="background:#173d2a;padding:14px 24px;font-size:22px;font-weight:700;letter-spacing:-0.02em"><span style="color:#ee8a2c">squirrel</span><span style="color:#46a36b">cade</span></div>',
    `<div style="padding:20px 24px;color:#14231a;font-size:15px;line-height:1.5">${bodyHtml}</div>`,
    button,
    '</div></div>',
  ].join('');
}

/**
 * Sends the update summary after each import (additions first, then the top
 * picks and how the wishlist moved) and alerts when something needs attention.
 * Every applied import also saves a snapshot of the main wishlist, whether or
 * not messages are turned on, so the next summary can say what changed.
 */
export class NotificationService {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly collection: CollectionService,
    private readonly wishlist: WishlistService,
    private readonly log: Logger,
    private readonly transports: Transports = defaultTransports,
    private readonly catalogs?: CatalogService,
  ) {}

  /** Resolves when the messages already queued have been handled. */
  idle(): Promise<unknown> {
    return this.queue;
  }

  private later(what: string, job: () => Promise<unknown>): void {
    this.queue = this.queue.then(job).catch((err) => this.log.error({ err, context: 'notifications' }, `${what} failed`));
  }

  /** Channels that are turned on and filled in. */
  channels(): Channel[] {
    const s = this.settings;
    const ready: Record<Channel, boolean> = {
      email: s.get('notifications.emailEnabled') && Boolean(s.get('notifications.smtpHost')) && s.get('notifications.emailTo').length > 0,
      pushover: s.get('notifications.pushoverEnabled') && Boolean(s.get('notifications.pushoverToken') && s.get('notifications.pushoverUser')),
      pushbullet: s.get('notifications.pushbulletEnabled') && Boolean(s.get('notifications.pushbulletToken')),
      ntfy: s.get('notifications.ntfyEnabled') && Boolean(s.get('notifications.ntfyTopic').trim()),
      gotify: s.get('notifications.gotifyEnabled') && Boolean(s.get('notifications.gotifyServer') && s.get('notifications.gotifyToken')),
      discord: s.get('notifications.discordEnabled') && Boolean(s.get('notifications.discordWebhook')),
      telegram: s.get('notifications.telegramEnabled') && Boolean(s.get('notifications.telegramToken') && s.get('notifications.telegramChatId').trim()),
      slack: s.get('notifications.slackEnabled') && Boolean(s.get('notifications.slackWebhook')),
      webhook: s.get('notifications.webhookEnabled') && Boolean(s.get('notifications.webhookUrl')),
      apprise: s.get('notifications.appriseEnabled') && Boolean(s.get('notifications.appriseUrl')),
    };
    return (Object.keys(ready) as Channel[]).filter((c) => ready[c]);
  }

  /** A push or chat service's request for a message (every channel but email and Pushover). */
  private request(channel: Channel, report: Report, url: string, kind: MessageKind, importance: number): ChannelRequest {
    const s = this.settings;
    switch (channel) {
      case 'pushbullet':
        return pushbulletRequest(s.get('notifications.pushbulletToken'), report, url);
      case 'ntfy':
        return ntfyRequest(s.get('notifications.ntfyServer'), s.get('notifications.ntfyTopic'), s.get('notifications.ntfyToken'), report, url, importance);
      case 'gotify':
        return gotifyRequest(s.get('notifications.gotifyServer'), s.get('notifications.gotifyToken'), report, url, importance);
      case 'discord':
        return discordRequest(s.get('notifications.discordWebhook'), report, url);
      case 'telegram':
        return telegramRequest(s.get('notifications.telegramToken'), s.get('notifications.telegramChatId'), report, url);
      case 'slack':
        return slackRequest(s.get('notifications.slackWebhook'), report, url);
      case 'webhook':
        return webhookRequest(s.get('notifications.webhookUrl'), s.get('notifications.webhookAuth'), report, url, kind, importance, new Date().toISOString());
      case 'apprise':
        return appriseRequest(s.get('notifications.appriseUrl'), report, url, kind);
      default:
        throw new Error(`${channel} isn't sent as a web request`);
    }
  }

  /** Sends a web service's request; a refusal says what the service answered (never the address, which can hold a token). */
  private async post(channel: Channel, req: ChannelRequest): Promise<void> {
    const post = this.transports.post ?? defaultTransports.post!;
    let res: Response;
    try {
      res = await post(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      const cause = err instanceof Error ? ((err.cause as Error | undefined)?.message ?? err.message) : String(err);
      throw new Error(`${CHANNEL_NAMES[channel]} couldn't be reached: ${cause}`);
    }
    if (!res.ok) throw new Error(`${CHANNEL_NAMES[channel]} answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  }

  private name(): string {
    return this.settings.get('general.instanceName') || 'Squirrelcade';
  }

  private link(path = ''): string {
    const base = this.settings.get('general.publicUrl').replace(/\/+$/, '');
    return base ? `${base}${path}` : '';
  }

  async send(report: Report, url = this.link(), kind: MessageKind = 'summary'): Promise<SendResult[]> {
    const s = this.settings;
    const results: SendResult[] = [];
    // How urgent it is (Settings > Notifications), on Pushover's scale; a test is normal.
    const importance = kind === 'test' ? 0 : Number(s.get(PRIORITY_SETTING[kind]));
    for (const channel of this.channels()) {
      try {
        if (channel === 'email') {
          await this.transports.sendMail({
            host: s.get('notifications.smtpHost'),
            port: s.get('notifications.smtpPort'),
            user: s.get('notifications.smtpUser'),
            pass: s.get('notifications.smtpPassword'),
            from: `"${this.name().replace(/["<>]/g, '')}" <${s.get('notifications.emailFrom') || s.get('notifications.smtpUser') || (s.get('notifications.emailTo')[0] ?? '')}>`,
            to: s.get('notifications.emailTo'),
            subject: report.subject,
            text: report.text,
            html: emailLayout(report.html, url || null),
          });
        } else if (channel === 'pushover') {
          await this.transports.pushover({
            token: s.get('notifications.pushoverToken'),
            user: s.get('notifications.pushoverUser'),
            title: report.subject,
            message: report.short.length > PUSH_LIMIT ? `${report.short.slice(0, PUSH_LIMIT - 3)}...` : report.short,
            url: url || undefined,
            priority: importance,
          });
        } else {
          await this.post(channel, this.request(channel, report, url, kind, importance));
        }
        results.push({ channel, ok: true });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.log.warn({ context: 'notifications' }, `Sending by ${channel} failed: ${error}`);
        results.push({ channel, ok: false, error });
      }
    }
    return results;
  }

  /** A short message for problems: one paragraph, the same text everywhere. */
  private alert(subject: string, body: string, path: string, kind: MessageKind): void {
    if (!this.settings.get('notifications.onFailure') || this.channels().length === 0) return;
    const url = this.link(path);
    const text = url ? `${body}\n\nOpen Squirrelcade: ${url}` : body;
    const html = `<p>${escapeHtml(body)}</p>`;
    this.later('Alert', () => this.send({ subject: `${this.name()}: ${subject}`, text, html, short: body }, url, kind));
  }

  /**
   * A message of its own about the collection, not a problem (a price drop, a lent game overdue): one paragraph,
   * sent now, whatever "When something needs attention" says; what went out on each channel.
   */
  async notice(subject: string, body: string, path: string, bodyHtml?: string): Promise<SendResult[]> {
    if (this.channels().length === 0) return [];
    const url = this.link(path);
    const text = url ? `${body}\n\nOpen Squirrelcade: ${url}` : body;
    // An email can show more than the one paragraph other channels get (the PC deals, a row each).
    const html = bodyHtml ?? `<p>${escapeHtml(body)}</p>`;
    return this.send({ subject: `${this.name()}: ${subject}`, text, html, short: body }, url, 'summary');
  }

  /** Called for every new import (see CollectionService events). */
  imported(outcome: ImportOutcome): void {
    const { import: imp, report } = outcome;
    if (imp.status === 'applied') {
      this.later('Update summary', () => this.importSummary(imp.id));
    } else if (imp.status === 'pending') {
      this.alert('collection update waiting for you', `The update from ${imp.fileName} was not applied yet: ${imp.message ?? 'it needs your confirmation.'} Apply or discard it on the Stash updates page.`, '/updates', 'waiting');
    } else if (imp.status === 'refused') {
      this.alert('collection update refused', `Your collection could not be updated from ${imp.fileName}: ${report.errors.join(' ') || imp.message || 'the file is not a PriceCharting collection export.'}`, '/updates', 'waiting');
    }
  }

  /** A PC library reading held because it would lose too many games (see PcService.applySnapshot). */
  pcReadHeld(message: string): void {
    this.alert('PC library reading waiting for you', message, '/pc', 'waiting');
  }

  /** New problems the health check found (see computeHealth). */
  healthProblems(messages: string[]): void {
    if (messages.length === 0) return;
    this.alert('needs attention', `Squirrelcade found ${messages.length === 1 ? 'a problem' : `${messages.length} problems`}: ${messages.join(' ')}`, '/system/status', 'problem');
  }

  /**
   * A failed run. A task that starts failing alerts once, then at most once a day while it keeps failing (one that
   * runs every half hour once alerted every half hour); taskSucceeded says when it works again.
   */
  taskFailed(name: string, title: string, message: string, now = new Date()): void {
    const failing = this.failingTasks();
    const was = failing[name];
    if (was && now.getTime() - Date.parse(was.alerted) < DAY_MS) return;
    const since = was?.since ?? now.toISOString();
    const body = was ? `${title} has been failing since ${since.slice(0, 10)}: ${message}` : `${title} failed: ${message}`;
    this.alert(`${title.toLowerCase()} ${was ? 'still fails' : 'failed'}`, body, '/system/tasks', 'problem');
    this.saveFailingTasks({ ...failing, [name]: { since, alerted: now.toISOString() } });
  }

  /** A run that worked: a task that had been failing (and alerted) says it works again, once. */
  taskSucceeded(name: string, title: string): void {
    const failing = this.failingTasks();
    if (!failing[name]) return;
    const { [name]: _gone, ...rest } = failing;
    this.saveFailingTasks(rest);
    this.alert(`${title.toLowerCase()} works again`, `${title} works again.`, '/system/tasks', 'problem');
  }

  /** The tasks failing now that were alerted: when each started failing and when it was last alerted. */
  private failingTasks(): Record<string, { since: string; alerted: string }> {
    const row = this.db.select().from(appState).where(eq(appState.key, FAILING_TASKS)).get();
    return row ? (JSON.parse(row.value) as Record<string, { since: string; alerted: string }>) : {};
  }

  private saveFailingTasks(value: Record<string, { since: string; alerted: string }>): void {
    const text = JSON.stringify(value);
    this.db.insert(appState).values({ key: FAILING_TASKS, value: text }).onConflictDoUpdate({ target: appState.key, set: { value: text } }).run();
  }

  private saveSnapshot(importId: number | null): SnapshotEntry[] {
    const entries: SnapshotEntry[] = this.wishlist.compute().master.map((m) => ({
      key: `${m.platformKey}|${normalizeTitle(m.title)}`,
      title: m.title,
      platform: m.platformName,
      rank: m.rank,
      score: m.masterScore,
    }));
    this.db.insert(wishlistSnapshots).values({ importId, createdAt: new Date().toISOString(), entries: JSON.stringify(entries) }).run();
    const oldest = this.db.select({ id: wishlistSnapshots.id }).from(wishlistSnapshots).orderBy(desc(wishlistSnapshots.id)).limit(1).offset(KEEP_SNAPSHOTS).get();
    if (oldest) this.db.delete(wishlistSnapshots).where(lte(wishlistSnapshots.id, oldest.id)).run();
    return entries;
  }

  /**
   * Saves a first snapshot when there is a collection but none yet (for example
   * after upgrading), so the next import summary can already list wishlist changes.
   */
  ensureBaseline(): boolean {
    const importId = this.collection.currentImportId();
    if (importId === null || this.lastSnapshot()) return false;
    this.saveSnapshot(importId);
    return true;
  }

  /** Saves the wishlist snapshot for an applied import and sends the summary if turned on. */
  async importSummary(importId: number): Promise<SendResult[]> {
    const summary = this.collection.summaryOf(importId);
    const report = this.collection.reportOf(importId);
    if (!summary || !report?.diff) return [];

    const previous = this.lastSnapshot()?.entries ?? null;
    const current = this.saveSnapshot(importId);
    const changes = wishlistChanges(previous, current, this.settings.get('notifications.moverPlaces'));

    if (!this.settings.get('notifications.onImport') || this.channels().length === 0) return [];
    const totals = this.collection.summary().totals;
    const message = importReport({
      instanceName: this.name(),
      fileName: summary.fileName,
      added: report.diff.added,
      removed: report.diff.removed,
      changedCount: report.diff.quantityChanged.length,
      games: totals.games,
      copies: totals.copies,
      top: current.slice(0, this.settings.get('notifications.topCount')),
      changes,
      firstSnapshot: previous === null,
      firstImport: report.diff.copiesBefore === 0,
      priceMoves: this.collection.priceMovers(3),
      newlyTracked: this.collection.newlyTracked(importId),
      waitingPurchases: this.catalogs?.pendingPurchases().map((p) => ({ title: p.title, platform: p.platform })),
      comingSoon: this.comingSoon(),
      currency: this.settings.get('general.currency'),
      url: this.link(),
    });
    const results = await this.send(message, this.link(), 'summary');
    this.log.info({ context: 'notifications' }, `Summary of ${summary.fileName} sent: ${results.map((r) => `${r.channel} ${r.ok ? 'ok' : 'failed'}`).join(', ')}`);
    return results;
  }

  /** The games with a release date in the next days (Settings > Notifications), soonest first, at most 15. */
  private comingSoon(): { title: string; platform: string; releaseDate: string; owned: boolean }[] {
    const days = this.settings.get('notifications.comingSoonDays');
    if (!days || !this.catalogs) return [];
    const until = new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
    return this.catalogs
      .upcoming()
      .filter((g) => /^\d{4}-\d{2}-\d{2}$/.test(g.releaseDate) && g.releaseDate <= until)
      .slice(0, 15)
      .map((g) => ({ title: g.title, platform: g.platform, releaseDate: g.releaseDate, owned: g.status === 'owned' }));
  }

  /**
   * Settings > Email's test of sending: a message from your account to the notifications' address (or the account's
   * own), whether email notifications are on or not. What happened, in a line.
   */
  async testEmail(): Promise<{ ok: boolean; message: string }> {
    const s = this.settings;
    const user = s.get('notifications.smtpUser').trim();
    const host = s.get('notifications.smtpHost').trim();
    if (!user || !host) return { ok: false, message: 'Fill in your email address and choose your provider (or its mail server), then save.' };
    const to = s.get('notifications.emailTo').length > 0 ? s.get('notifications.emailTo') : [user];
    const text = 'This is a test message from Squirrelcade. If you can read it, sending email works.';
    try {
      await this.transports.sendMail({
        host,
        port: s.get('notifications.smtpPort'),
        user,
        pass: s.get('notifications.smtpPassword'),
        from: `"${this.name().replace(/["<>]/g, '')}" <${s.get('notifications.emailFrom') || user}>`,
        to,
        subject: `${this.name()}: test message`,
        text,
        html: emailLayout(`<p>${text}</p>`, this.link() || null),
      });
      return { ok: true, message: `a test message went to ${to.join(', ')}.` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Whether Squirrelcade has an email account to send from (Settings › Email). */
  canEmail(): boolean {
    return Boolean(this.settings.get('notifications.smtpUser').trim() && this.settings.get('notifications.smtpHost').trim());
  }

  /** One message to someone who isn't the owner (a guest's sign-in code for an AI app, 0.55.0), from the owner's account. */
  async emailTo(to: string, subject: string, text: string): Promise<void> {
    const s = this.settings;
    const user = s.get('notifications.smtpUser').trim();
    const host = s.get('notifications.smtpHost').trim();
    if (!user || !host) throw new Error('Squirrelcade has no email account to send from (Settings › Email).');
    await this.transports.sendMail({
      host,
      port: s.get('notifications.smtpPort'),
      user,
      pass: s.get('notifications.smtpPassword'),
      from: `"${this.name().replace(/["<>]/g, '')}" <${s.get('notifications.emailFrom') || user}>`,
      to: [to],
      subject: `${this.name()}: ${subject}`,
      text,
      html: emailLayout(text.split('\n\n').map((p) => `<p>${escapeHtml(p)}</p>`).join(''), null),
    });
  }

  async test(): Promise<SendResult[]> {
    const text = 'This is a test message from Squirrelcade. If you can read it, notifications work.';
    return this.send({ subject: `${this.name()}: test message`, text, html: `<p>${text}</p>`, short: text }, this.link(), 'test');
  }

  lastSnapshot(): { importId: number | null; createdAt: string; entries: SnapshotEntry[] } | null {
    const last = this.db.select().from(wishlistSnapshots).orderBy(desc(wishlistSnapshots.id)).limit(1).get();
    return last ? { importId: last.importId, createdAt: last.createdAt, entries: JSON.parse(last.entries) as SnapshotEntry[] } : null;
  }
}

/** A chat a Telegram bot has seen: its ID, and what to call it. */
export interface TelegramChat {
  id: string;
  name: string;
  type: string;
}

/**
 * The chats a Telegram bot has had a message from lately (Telegram keeps them for a day), for "Find my chat": the
 * saved token's getUpdates, never marking them read (Squirrelcade doesn't read messages otherwise).
 */
export async function telegramChats(token: string, post: Post = defaultTransports.post!): Promise<TelegramChat[]> {
  let res: Response;
  try {
    res = await post(`https://api.telegram.org/bot${token.trim()}/getUpdates`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new Error(`Telegram couldn't be reached: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (res.status === 401 || res.status === 404) throw new Error("Telegram didn't accept the bot token: copy it again from @BotFather.");
  if (!res.ok) throw new Error(`Telegram answered ${res.status}.`);
  const body = (await res.json()) as { result?: { message?: { chat?: { id: number; type: string; title?: string; first_name?: string; last_name?: string; username?: string } } }[] };
  const chats = new Map<string, TelegramChat>();
  for (const update of body.result ?? []) {
    const c = update.message?.chat;
    if (!c) continue;
    const name = c.title ?? ([c.first_name, c.last_name].filter(Boolean).join(' ') || (c.username ? `@${c.username}` : String(c.id)));
    chats.set(String(c.id), { id: String(c.id), name, type: c.type });
  }
  return [...chats.values()];
}

/** Notifications: the test message, and finding a Telegram chat. */
export function registerNotificationRoutes(app: FastifyInstance, notifications: NotificationService, settings: SettingsService, post?: Post): void {
  app.post('/api/v1/notifications/test', async (_request, reply) => {
    if (notifications.channels().length === 0) {
      return reply.code(400).send({ error: 'no-channels', message: 'Turn on a way to send messages and fill in its settings first (and save them).' });
    }
    return { results: await notifications.test() };
  });

  app.post('/api/v1/notifications/telegram/chats', async (_request, reply) => {
    const token = settings.get('notifications.telegramToken');
    if (!token) return reply.code(400).send({ error: 'no-token', message: "Enter your bot's token first (and save it)." });
    try {
      const chats = await telegramChats(token, post);
      return {
        chats,
        message: chats.length === 0 ? 'No messages to the bot yet: send your bot a message in Telegram (or, for a group, add it and write there), then try again.' : null,
      };
    } catch (err) {
      return reply.code(400).send({ error: 'telegram', message: err instanceof Error ? err.message : String(err) });
    }
  });
}
