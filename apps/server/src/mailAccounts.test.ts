import { afterEach, describe, expect, it } from 'vitest';
import type { FoundMail, MailAccount, MailboxOpener } from './mailImport.js';
import { exportCsv, fakeTransports, makeZip, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

const LINK = 'https://storage.googleapis.com/vgpc-export/abc123/def456/collection.zip';

function exportMail(id: string, date: string): FoundMail {
  const source = [
    'From: PriceCharting <sales@vgpc.com>',
    'To: someone@example.com',
    'Subject: Your Exported Collection: Video Games',
    `Message-ID: <${id}>`,
    `Date: ${new Date(date).toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    `<div>Your exported collection is ready!<br/><a href="${LINK}">Download Your Collection</a></div>`,
  ].join('\r\n');
  return { id: `<${id}>`, date: new Date(date).toISOString(), subject: 'Your Exported Collection: Video Games', from: 'sales@vgpc.com', source: Buffer.from(source) };
}

/** Stand-in mailboxes by the account's address: each holds its own emails, and every sign-in is recorded. */
function mailboxes(byUser: Record<string, FoundMail[] | Error>) {
  const signedIn: MailAccount[] = [];
  const open: MailboxOpener = async (account) => {
    signedIn.push(account);
    const held = byUser[account.user];
    if (held === undefined || held instanceof Error) throw held ?? new Error('No such mailbox');
    return {
      async find(query) {
        return { folder: 'INBOX', mails: held.filter((m) => Date.parse(m.date) >= query.since.getTime()) };
      },
      gmail: false,
      async search() {
        return { folder: 'INBOX', mails: [] };
      },
      async close() {},
    };
  };
  return { open, signedIn };
}

const EXPORT_A = exportCsv([['1', 'Okami', 'Playstation 3', 2000, 'Item, Box, and Manual']]);
const EXPORT_B = exportCsv([['1', 'Okami', 'Playstation 3', 2000, 'Item, Box, and Manual'], ['2', 'Journey', 'Playstation 3', 1500, 'Item, Box, and Manual']]);

const gmail = { name: 'Home Gmail', address: 'home@example.com', password: 'app password one', imapHost: 'imap.example.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: 'smtp.example.com', smtpPort: 587 };
const other = { name: 'Work', address: 'work@example.com', password: 'app password two', imapHost: 'imap.work.example.com', imapPort: 993, imapSecurity: 'ssl', smtpHost: '', smtpPort: 587 };

describe('email accounts (Settings > Email)', () => {
  it('adds, edits, tests and removes accounts, and never sends a password back', async () => {
    const box = mailboxes({ 'home@example.com': [], 'work@example.com': new Error('refused') });
    const fake = fakeTransports();
    g = await testApp({ mailbox: box.open, transports: fake.transports });
    const cookies = await setUp(g);
    const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown) => g!.app.inject({ method, url: `/api/v1/mail/accounts${url}`, cookies, payload: payload as object | undefined });

    expect((await call('GET', '')).json()).toEqual({ accounts: [] });
    const a = (await call('POST', '', gmail)).json();
    const b = (await call('POST', '', other)).json();
    expect(a).toMatchObject({ id: expect.any(Number), name: 'Home Gmail', hasPassword: true, reads: true, sends: true });
    expect(b).toMatchObject({ name: 'Work', reads: true, sends: false });
    expect(JSON.stringify((await call('GET', '')).json())).not.toContain('app password');
    expect((await call('POST', '', { ...gmail, name: '' })).statusCode).toBe(400);

    // Editing without a password keeps the saved one (and a new name).
    const edited = (await call('PUT', `/${a.id}`, { ...gmail, name: 'Gmail at home', password: '' })).json();
    expect(edited).toMatchObject({ name: 'Gmail at home', hasPassword: true });
    expect(g.mail.accounts.get(a.id)!.password).toBe('app password one');

    // Test: reads its mailbox and sends a message when it has an outgoing server; the one that is refused says why.
    expect((await call('POST', `/${a.id}/test`)).json()).toMatchObject({ read: { ok: true }, send: { ok: true } });
    expect(fake.sent.mail.at(-1)).toMatchObject({ host: 'smtp.example.com', user: 'home@example.com', pass: 'app password one' });
    expect((await call('POST', `/${b.id}/test`)).json()).toMatchObject({ read: { ok: false, message: expect.stringContaining('refused') }, send: null });

    // Remove: gone, and a feature that read only it reads all again.
    g.settings.update({ 'mail.accounts': [String(b.id)] });
    expect((await call('DELETE', `/${b.id}`)).json()).toEqual({ removed: true });
    expect((await call('GET', '')).json().accounts).toHaveLength(1);
    expect(g.settings.get('mail.accounts')).toEqual([]);
    expect((await call('DELETE', `/${b.id}`)).statusCode).toBe(404);
  });

  it('reads two accounts for a feature set to all, and only the chosen one when it is set to one', async () => {
    const recent = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const box = mailboxes({ 'home@example.com': [exportMail('one@vgpc', recent)], 'work@example.com': [exportMail('two@vgpc', new Date(Date.now() - 3_600_000).toISOString())] });
    const downloads: string[] = [];
    let n = 0;
    g = await testApp({
      features: ['mail'],
      mailbox: box.open,
      exportDownload: async (url) => {
        downloads.push(url);
        return { name: 'collection.zip', data: makeZip({ 'collection_20260927.csv': n++ === 0 ? EXPORT_A : EXPORT_B }) };
      },
    });
    const first = g.mail.accounts.add({ ...gmail, username: '', imapSecurity: 'ssl' } as never);
    const second = g.mail.accounts.add({ ...other, username: '', imapSecurity: 'ssl' } as never);

    // "All" (the default, empty): both mailboxes are signed in to, and both emails are used.
    expect(g.settings.get('mail.accounts')).toEqual([]);
    const said = await g.mail.check();
    expect(box.signedIn.map((s) => s.user).sort()).toEqual(['home@example.com', 'work@example.com']);
    expect(said).toMatch(/collection updated/);
    expect(g.collection.listImports().filter((i) => i.source === 'email')).toHaveLength(2);

    // One chosen: only that mailbox is read.
    box.signedIn.length = 0;
    g.settings.update({ 'mail.accounts': [String(second.id)], 'mail.deals': false });
    await g.mail.check();
    expect(box.signedIn.map((s) => s.user)).toEqual(['work@example.com']);
    expect(g.mail.status().accounts).toEqual([{ id: second.id, name: 'Work', address: 'work@example.com' }]);
    void first;

    // One account failing doesn't stop the other, and says which.
    const failing = mailboxes({ 'home@example.com': new Error('refused'), 'work@example.com': [] });
    const g2 = await testApp({ features: ['mail'], mailbox: failing.open });
    try {
      g2.mail.accounts.add({ ...gmail, username: '', imapSecurity: 'ssl' } as never);
      g2.mail.accounts.add({ ...other, username: '', imapSecurity: 'ssl' } as never);
      const message = await g2.mail.check();
      expect(message).toMatch(/Home Gmail: .*refused/);
    } finally {
      await g2.cleanup();
    }
  });

  it('moves the old single account to account 1 at start, and keeps every feature reading it', async () => {
    const box = mailboxes({ 'me@example.com': [] });
    g = await testApp({ mailbox: box.open });
    const raw = g.db.$client;
    // An install from before accounts: the old settings in the database, no accounts, nothing moved yet.
    raw.prepare('DELETE FROM mail_accounts').run();
    raw.prepare("DELETE FROM app_state WHERE key = 'mail.accountsMoved'").run();
    const old = { 'notifications.emailProvider': 'gmail', 'notifications.smtpHost': 'smtp.gmail.com', 'notifications.smtpPort': 587, 'notifications.smtpUser': 'me@example.com', 'notifications.smtpPassword': 'old app password' };
    for (const [key, value] of Object.entries(old)) raw.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), new Date().toISOString());
    await g.restart();

    const accounts = g.mail.accounts.list();
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ id: expect.any(Number), name: 'Gmail', address: 'me@example.com', password: 'old app password', imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 587 });
    // The old rows are gone (the password with them), and nothing is chosen: every feature reads account 1.
    expect(g.db.$client.prepare("SELECT COUNT(*) AS n FROM settings WHERE key LIKE 'notifications.smtp%' OR key = 'notifications.emailProvider'").get()).toEqual({ n: 0 });
    for (const key of ['mail.accounts', 'mail.dealAccounts', 'orders.findAccounts', 'orders.watchAccounts'] as const) expect(g.settings.get(key)).toEqual([]);
    expect(g.mail.accounts.readers([]).accounts.map((a) => a.address)).toEqual(['me@example.com']);
    expect(g.mail.accounts.sender()?.address).toBe('me@example.com');
    // Starting again moves nothing twice.
    await g.restart();
    expect(g.mail.accounts.list()).toHaveLength(1);
  });

  it('moves a different mailbox for exports to its own account, read by exports and deals, with orders on account 1', async () => {
    g = await testApp();
    const raw = g.db.$client;
    raw.prepare('DELETE FROM mail_accounts').run();
    raw.prepare("DELETE FROM app_state WHERE key = 'mail.accountsMoved'").run();
    const old = { 'notifications.smtpHost': 'smtp.example.com', 'notifications.smtpUser': 'me@example.com', 'notifications.smtpPassword': 'one', 'mail.username': 'prices@example.org', 'mail.password': 'two', 'mail.imapHost': 'imap.example.org' };
    for (const [key, value] of Object.entries(old)) raw.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)').run(key, JSON.stringify(value), new Date().toISOString());
    await g.restart();
    const [one, two] = g.mail.accounts.list();
    expect(one).toMatchObject({ address: 'me@example.com', imapHost: 'imap.example.com' });
    expect(two).toMatchObject({ name: 'PriceCharting emails', address: 'prices@example.org', password: 'two', imapHost: 'imap.example.org', smtpHost: '' });
    expect(g.settings.get('mail.accounts')).toEqual([String(two!.id)]);
    expect(g.settings.get('mail.dealAccounts')).toEqual([String(two!.id)]);
    expect(g.settings.get('orders.findAccounts')).toEqual([String(one!.id)]);
    expect(g.settings.get('orders.watchAccounts')).toEqual([String(one!.id)]);
  });

  it('moves old email settings written by a settings file or an AI onto account 1', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    const file = { format: 'squirrelcade-settings', version: 1, settings: { 'notifications.smtpHost': 'smtp.example.com', 'notifications.smtpUser': 'me@example.com', 'notifications.smtpPassword': 'from a file', 'notifications.emailTo': ['me@example.com'] } };
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/settings/import', cookies, payload: file });
    expect(res.statusCode).toBe(200);
    expect(g.mail.accounts.list()).toHaveLength(1);
    expect(g.mail.accounts.list()[0]).toMatchObject({ address: 'me@example.com', password: 'from a file', smtpHost: 'smtp.example.com' });
    expect(g.settings.get('notifications.emailTo')).toEqual(['me@example.com']);
    // Written again later, the same account is changed, not a second one made.
    g.settings.update({ 'notifications.smtpHost': 'smtp.other.example.com' });
    expect(g.mail.accounts.list()).toHaveLength(1);
    expect(g.mail.accounts.list()[0]!.smtpHost).toBe('smtp.other.example.com');
  });

  it('sends email notifications from the chosen account', async () => {
    const fake = fakeTransports();
    g = await testApp({ transports: fake.transports });
    const first = g.mail.accounts.add({ ...gmail, username: '', imapSecurity: 'ssl' } as never);
    const second = g.mail.accounts.add({ ...gmail, name: 'Second', address: 'second@example.com', smtpHost: 'smtp.second.example.com', username: '', imapSecurity: 'ssl' } as never);
    g.settings.update({ 'notifications.emailEnabled': true, 'notifications.emailTo': ['me@example.com'] });
    // Not chosen: the first account that sends.
    await g.notifications.test();
    expect(fake.sent.mail.at(-1)).toMatchObject({ host: 'smtp.example.com', user: 'home@example.com' });
    g.settings.update({ 'notifications.emailAccount': String(second.id) });
    await g.notifications.test();
    expect(fake.sent.mail.at(-1)).toMatchObject({ host: 'smtp.second.example.com', user: 'second@example.com' });
    void first;
  });

  it('shows a status line for each account: its name, when it worked, and failing in red', async () => {
    const box = mailboxes({ 'home@example.com': [], 'work@example.com': new Error('refused') });
    g = await testApp({ mailbox: box.open });
    const cookies = await setUp(g);
    type Line = { key: string; name: string; light: string; says: string; lastOk: string | null };
    const lines = async () => (await g!.app.inject({ url: '/api/v1/system/integrations', cookies })).json().lines as Line[];

    // No account yet: the one grey line.
    expect((await lines()).find((l) => l.key === 'mailbox')).toMatchObject({ light: 'grey' });

    const a = g.mail.accounts.add({ ...gmail, username: '', imapSecurity: 'ssl' } as never);
    const b = g.mail.accounts.add({ ...other, username: '', imapSecurity: 'ssl' } as never);
    let all = await lines();
    expect(all.find((l) => l.key === 'mailbox')).toBeUndefined();
    expect(all.find((l) => l.key === `mailbox-${a.id}`)).toMatchObject({ name: 'The mailbox: Home Gmail', light: 'yellow' });

    // Tested: the one that works is green with when it read; the one refused is red with why, first in the list.
    await g.app.inject({ method: 'POST', url: `/api/v1/mail/accounts/${a.id}/test`, cookies });
    await g.app.inject({ method: 'POST', url: `/api/v1/mail/accounts/${b.id}/test`, cookies });
    all = await lines();
    const ok = all.find((l) => l.key === `mailbox-${a.id}`)!;
    expect(ok).toMatchObject({ light: 'green', says: expect.stringMatching(/^Read /) });
    expect(ok.lastOk).not.toBeNull();
    expect(all.find((l) => l.key === `mailbox-${b.id}`)).toMatchObject({ name: 'The mailbox: Work', light: 'red', says: expect.stringContaining('refused') });
    expect(all.findIndex((l) => l.key === `mailbox-${b.id}`)).toBeLessThan(all.findIndex((l) => l.key === `mailbox-${a.id}`));
  });
});
