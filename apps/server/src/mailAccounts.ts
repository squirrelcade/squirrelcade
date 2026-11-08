import { MAIL_PROVIDERS } from '@squirrelcade/core';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from './db/index.js';
import { appState, mailAccounts } from './db/schema.js';
import type { MailAccount, MailboxOpener } from './mailImport.js';
import { signInProblem } from './mailImport.js';
import type { NotificationService } from './notifications.js';
import type { SettingsService } from './settings.js';

/**
 * The email accounts (Settings > Email, D218): each a mailbox Squirrelcade reads and, with an outgoing server, sends
 * from. What reads email says on its own page which accounts it reads (an empty choice reads all of them). The password
 * stays on the server, as secret settings do: the browser is told only that one is set.
 */

export type MailAccountRow = typeof mailAccounts.$inferSelect;

/** An account as the browser sees it: everything but the password. */
export interface MailAccountView {
  id: number;
  name: string;
  address: string;
  username: string;
  hasPassword: boolean;
  imapHost: string;
  imapPort: number;
  imapSecurity: 'ssl' | 'starttls';
  smtpHost: string;
  smtpPort: number;
  /** It has an incoming server: it can be read. */
  reads: boolean;
  /** It has an outgoing server: it can send. */
  sends: boolean;
  /** Why it can't be read, when it can't (Microsoft refuses a password). */
  problem: string | null;
}

/** What the last use of an account was: reading it, and sending from it. */
export interface MailAccountState {
  read?: { at: string; ok: boolean; message: string };
  send?: { at: string; ok: boolean; message: string };
}

const MICROSOFT = /(^|\.)(outlook\.office365\.com|outlook\.com|office365\.com|hotmail\.com|live\.com)$/i;

/** Why an account can't be read, or null. */
export function readProblem(a: Pick<MailAccountRow, 'imapHost'>): string | null {
  if (MICROSOFT.test(a.imapHost.trim())) return "Microsoft doesn't let programs read Outlook.com or Microsoft 365 mail with a password. Use another account (a forwarding rule to Gmail works).";
  return null;
}

/** The input to add or change an account; a password left out (or empty) keeps the saved one. */
export const accountInput = z.object({
  name: z.string().trim().min(1, 'Give it a name.').max(60),
  address: z.string().trim().min(1, 'Enter its address.').max(200),
  username: z.string().trim().max(200).default(''),
  password: z.string().max(500).optional(),
  imapHost: z.string().trim().max(200).default(''),
  imapPort: z.number().int().min(1).max(65535).default(993),
  imapSecurity: z.enum(['ssl', 'starttls']).default('ssl'),
  smtpHost: z.string().trim().max(200).default(''),
  smtpPort: z.number().int().min(1).max(65535).default(587),
});
export type AccountInput = z.infer<typeof accountInput>;

const stateKey = (id: number) => `mail.account.${id}`;
const MOVED_KEY = 'mail.accountsMoved';

export class MailAccounts {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  list(): MailAccountRow[] {
    return this.db.select().from(mailAccounts).orderBy(asc(mailAccounts.position), asc(mailAccounts.id)).all();
  }

  get(id: number): MailAccountRow | undefined {
    return this.db.select().from(mailAccounts).where(eq(mailAccounts.id, id)).get();
  }

  view(a: MailAccountRow): MailAccountView {
    return {
      id: a.id,
      name: a.name,
      address: a.address,
      username: a.username,
      hasPassword: a.password !== '',
      imapHost: a.imapHost,
      imapPort: a.imapPort,
      imapSecurity: a.imapSecurity === 'starttls' ? 'starttls' : 'ssl',
      smtpHost: a.smtpHost,
      smtpPort: a.smtpPort,
      reads: a.imapHost.trim() !== '',
      sends: a.smtpHost.trim() !== '',
      problem: a.imapHost.trim() ? readProblem(a) : null,
    };
  }

  views(): MailAccountView[] {
    return this.list().map((a) => this.view(a));
  }

  add(input: AccountInput): MailAccountRow {
    const last = this.list().at(-1);
    return this.db
      .insert(mailAccounts)
      .values({ ...input, password: input.password ?? '', position: (last?.position ?? 0) + 1, createdAt: new Date().toISOString() })
      .returning()
      .get();
  }

  update(id: number, input: AccountInput): MailAccountRow | undefined {
    const { password, ...rest } = input;
    this.db
      .update(mailAccounts)
      .set({ ...rest, ...(password ? { password } : {}) })
      .where(eq(mailAccounts.id, id))
      .run();
    return this.get(id);
  }

  remove(id: number): boolean {
    const gone = this.db.delete(mailAccounts).where(eq(mailAccounts.id, id)).returning({ id: mailAccounts.id }).get();
    this.db.delete(appState).where(eq(appState.key, stateKey(id))).run();
    // A feature that read this account alone reads all of them again, rather than none: drop it from each choice.
    for (const key of ['mail.accounts', 'mail.dealAccounts', 'orders.findAccounts', 'orders.watchAccounts'] as const) {
      const ids = this.settings.get(key);
      if (ids.includes(String(id))) this.settings.update({ [key]: ids.filter((x) => x !== String(id)) });
    }
    if (this.settings.get('notifications.emailAccount') === String(id)) this.settings.update({ 'notifications.emailAccount': '' });
    return Boolean(gone);
  }

  /**
   * The accounts a feature reads: the ones chosen (an empty choice: all), that have an incoming server and aren't
   * refused by their provider. `skipped` are the chosen ones that can't be read, each with why; `problem` says why
   * there's nothing to read when there isn't.
   */
  readers(choice: readonly string[]): { accounts: MailAccountRow[]; skipped: { account: MailAccountRow; problem: string }[]; problem: string | null } {
    const all = this.list();
    const chosen = choice.length === 0 ? all : all.filter((a) => choice.includes(String(a.id)));
    const accounts: MailAccountRow[] = [];
    const skipped: { account: MailAccountRow; problem: string }[] = [];
    for (const a of chosen) {
      const why = !a.imapHost.trim() ? 'It has no incoming mail server.' : !a.password || !(a.username || a.address) ? 'It has no app password.' : readProblem(a);
      if (why) skipped.push({ account: a, problem: why });
      else accounts.push(a);
    }
    let problem: string | null = null;
    if (accounts.length === 0) {
      if (all.length === 0) problem = 'Add an email account on Settings > Email: its address, an app password and its incoming mail server.';
      else if (chosen.length === 0) problem = "The accounts chosen here are gone: choose again, or leave it empty to read all of them.";
      else problem = skipped.map((s) => `${s.account.name}: ${s.problem}`).join(' ');
    }
    return { accounts, skipped, problem };
  }

  /** The account to sign in to, for the mail opener: the folder is the feature's (empty: All Mail where there is one). */
  imap(a: MailAccountRow, folder = ''): MailAccount {
    return { host: a.imapHost.trim(), port: a.imapPort, user: (a.username || a.address).trim(), pass: a.password, folder, secure: a.imapSecurity !== 'starttls' };
  }

  /** The account that sends notifications and the like: the one chosen, else the first with an outgoing server. */
  sender(): MailAccountRow | null {
    const chosen = this.settings.get('notifications.emailAccount');
    const all = this.list();
    const pick = chosen ? all.find((a) => String(a.id) === chosen) : undefined;
    const row = pick ?? all.find((a) => a.smtpHost.trim() !== '');
    return row && row.smtpHost.trim() ? row : null;
  }

  // What each account last did, for the status board and the account's own card.

  state(id: number): MailAccountState {
    const row = this.db.select().from(appState).where(eq(appState.key, stateKey(id))).get();
    try {
      return row ? (JSON.parse(row.value) as MailAccountState) : {};
    } catch {
      return {};
    }
  }

  record(id: number, kind: 'read' | 'send', ok: boolean, message: string): void {
    if (!this.get(id)) return;
    const next: MailAccountState = { ...this.state(id), [kind]: { at: new Date().toISOString(), ok, message: message.replace(/\s+/g, ' ').trim().slice(0, 300) } };
    const value = JSON.stringify(next);
    this.db.insert(appState).values({ key: stateKey(id), value }).onConflictDoUpdate({ target: appState.key, set: { value } }).run();
  }

  // From before accounts: one account in Settings > Email (and maybe another mailbox for exports).

  /**
   * Moves what the old email settings said onto accounts. The account in "Your email account" is account 1 (every
   * feature then reads it); a different mailbox for PriceCharting's emails, when one was set, becomes the next, read by
   * the exports and deals alone. Called once at start with the old settings found in the database, and by a settings
   * file or an AI that still writes them (then the first account is updated, and a missing one made).
   */
  moveLegacy(values: Record<string, unknown>): void {
    const str = (k: string) => (typeof values[k] === 'string' ? (values[k] as string).trim() : '');
    const raw = (k: string) => (typeof values[k] === 'string' ? (values[k] as string) : '');
    const portOf = (k: string, fallback: number) => (typeof values[k] === 'number' && values[k] >= 1 && values[k] <= 65535 ? (values[k] as number) : fallback);
    const provider = MAIL_PROVIDERS.find((m) => m.id === str('notifications.emailProvider'));
    const smtpHost = str('notifications.smtpHost') || provider?.host || '';
    const smtpUser = str('notifications.smtpUser');
    const smtpPass = raw('notifications.smtpPassword');
    const imapOf = (host: string) => provider?.imapHost || (host.startsWith('smtp.') ? `imap.${host.slice(5)}` : '');
    const own = Boolean(smtpUser || smtpPass || str('notifications.smtpHost') || provider);
    const other = { user: str('mail.username'), pass: raw('mail.password'), host: str('mail.imapHost'), port: portOf('mail.imapPort', 993) };
    const hasOther = Boolean(other.user || other.pass || other.host);
    if (!own && !hasOther) return;

    let first = this.list()[0];
    // Servers and a password with no address make no account.
    if (own && (first || smtpUser)) {
      const fields = { address: smtpUser, smtpHost, smtpPort: portOf('notifications.smtpPort', provider?.port ?? 587), imapHost: imapOf(smtpHost), ...(smtpPass ? { password: smtpPass } : {}) };
      if (first) {
        // Only what was written changes: an empty value leaves the account as it is.
        const set = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== '' && v !== undefined));
        this.db.update(mailAccounts).set(set).where(eq(mailAccounts.id, first.id)).run();
        first = this.get(first.id)!;
      } else {
        first = this.add(accountInput.parse({ name: provider?.name ?? 'My email', ...fields, password: smtpPass }));
      }
    }
    if (!hasOther) return;
    // The different mailbox for exports: its own account unless it is the account above.
    const user = other.user || smtpUser || first?.address || '';
    const pass = other.pass || smtpPass;
    const host = other.host || first?.imapHost || '';
    if (!user) return;
    if (first && user === (first.username || first.address) && (pass === first.password || !pass) && host === first.imapHost) return;
    const existing = this.list().find((a) => a.name === 'PriceCharting emails');
    const extra = existing
      ? (this.db.update(mailAccounts).set({ address: user || existing.address, ...(other.pass ? { password: other.pass } : {}), ...(host ? { imapHost: host } : {}), imapPort: other.port }).where(eq(mailAccounts.id, existing.id)).run(), this.get(existing.id)!)
      : this.add(accountInput.parse({ name: first ? 'PriceCharting emails' : (provider?.name ?? 'My email'), address: user, password: pass, imapHost: host, imapPort: other.port, imapSecurity: other.port === 143 ? 'starttls' : 'ssl' }));
    if (!first) return;
    const toId = [String(extra.id)];
    this.settings.update({ 'mail.accounts': toId, 'mail.dealAccounts': toId, 'orders.findAccounts': [String(first.id)], 'orders.watchAccounts': [String(first.id)] });
  }

  /** At start: the old settings in the database move onto accounts, once (the old rows are then removed, passwords with them). */
  moveOld(): void {
    if (this.db.select().from(appState).where(eq(appState.key, MOVED_KEY)).get()) return;
    const rows = this.db.$client.prepare("SELECT key, value FROM settings WHERE key IN ('notifications.emailProvider','notifications.smtpHost','notifications.smtpPort','notifications.smtpUser','notifications.smtpPassword','mail.username','mail.password','mail.imapHost','mail.imapPort')").all() as { key: string; value: string }[];
    const values: Record<string, unknown> = {};
    for (const r of rows) {
      try {
        values[r.key] = JSON.parse(r.value);
      } catch {
        // An unreadable value is as good as none.
      }
    }
    if (this.list().length === 0) this.moveLegacy(values);
    this.db.$client.prepare("DELETE FROM settings WHERE key IN ('notifications.emailProvider','notifications.smtpHost','notifications.smtpPort','notifications.smtpUser','notifications.smtpPassword','mail.username','mail.password','mail.imapHost','mail.imapPort')").run();
    this.db.insert(appState).values({ key: MOVED_KEY, value: new Date().toISOString() }).onConflictDoNothing().run();
  }
}

/** Settings > Email: the accounts, and testing one. */
export function registerMailAccountRoutes(app: FastifyInstance, accounts: MailAccounts, notifications: Pick<NotificationService, 'testEmail'>, open: MailboxOpener): void {
  const idOf = (params: unknown) => Number((params as { id?: string }).id);

  app.get('/api/v1/mail/accounts', async () => ({
    accounts: accounts.list().map((a) => ({ ...accounts.view(a), state: accounts.state(a.id) })),
  }));

  app.post('/api/v1/mail/accounts', async (request, reply) => {
    const parsed = accountInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid', message: parsed.error.issues.map((i) => i.message).join(' ') });
    return accounts.view(accounts.add(parsed.data));
  });

  app.put('/api/v1/mail/accounts/:id', async (request, reply) => {
    const id = idOf(request.params);
    if (!accounts.get(id)) return reply.code(404).send({ error: 'not-found', message: "That account isn't there." });
    const parsed = accountInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid', message: parsed.error.issues.map((i) => i.message).join(' ') });
    return accounts.view(accounts.update(id, parsed.data)!);
  });

  app.delete('/api/v1/mail/accounts/:id', async (request, reply) => {
    if (!accounts.remove(idOf(request.params))) return reply.code(404).send({ error: 'not-found', message: "That account isn't there." });
    return { removed: true };
  });

  /** Signs in to its mailbox, and sends itself a message when it has an outgoing server: what happened, in a line each. */
  app.post('/api/v1/mail/accounts/:id/test', async (request, reply) => {
    const account = accounts.get(idOf(request.params));
    if (!account) return reply.code(404).send({ error: 'not-found', message: "That account isn't there." });
    const out: { read: { ok: boolean; message: string } | null; send: { ok: boolean; message: string } | null } = { read: null, send: null };
    if (account.imapHost.trim()) {
      const why = !account.password ? 'Enter its app password first.' : readProblem(account);
      if (why) out.read = { ok: false, message: why };
      else {
        try {
          const box = await open(accounts.imap(account));
          await box.close().catch(() => undefined);
          out.read = { ok: true, message: `signed in to ${account.address} and read its mailbox.` };
        } catch (err) {
          out.read = { ok: false, message: signInProblem(err) };
        }
      }
      accounts.record(account.id, 'read', out.read.ok, out.read.message);
    }
    if (account.smtpHost.trim()) {
      out.send = await notifications.testEmail(account);
      accounts.record(account.id, 'send', out.send.ok, out.send.message);
    }
    return out;
  });
}
