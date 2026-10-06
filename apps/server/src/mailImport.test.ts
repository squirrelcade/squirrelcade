import { exportLinks, hostAllowed } from '@squirrelcade/core';
import { afterEach, describe, expect, it } from 'vitest';
import type { FoundMail, MailAccount, MailboxOpener } from './mailImport.js';
import { exportCsv, fakeTransports, makeZip, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

const LINK = 'https://storage.googleapis.com/vgpc-export/abc123/def456/collection.zip';

/** An export email as PriceCharting sends it (made up, with the same shape): an HTML link to the export. */
function exportMail(id: string, date: string, link = LINK, from = 'sales@vgpc.com'): FoundMail {
  const source = [
    `From: PriceCharting <${from}>`,
    'To: someone@example.com',
    'Subject: Your Exported Collection: Video Games',
    `Message-ID: <${id}>`,
    `Date: ${new Date(date).toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=utf-8',
    '',
    `<div>Your exported collection is ready!<br/><a href="${link}">Download Your Collection</a>`,
    '<p>Note: This download link will expire in 7 days.</p>',
    'See <a href="https://www.PriceCharting.com/my-collection?utm_source=email">your collection</a></div>',
  ].join('\r\n');
  return { id: `<${id}>`, date: new Date(date).toISOString(), subject: 'Your Exported Collection: Video Games', from, source: Buffer.from(source) };
}

/** A stand-in mailbox holding some emails, which records every sign-in and search. */
function mailbox(mails: FoundMail[], fail?: Error) {
  const calls: { account: MailAccount; query?: { since: Date; from: string; subject: string } }[] = [];
  const open: MailboxOpener = async (account) => {
    const call: (typeof calls)[number] = { account };
    calls.push(call);
    if (fail) throw fail;
    return {
      async find(query) {
        call.query = query;
        return { folder: '[Gmail]/All Mail', mails: mails.filter((m) => Date.parse(m.date) >= query.since.getTime() && m.subject.toLowerCase().includes(query.subject.toLowerCase())) };
      },
      async close() {},
    };
  };
  // The mails, to add one between two looks.
  return { open, calls, mails };
}

const EXPORT = exportCsv([
  ['1', 'Okami', 'Playstation 3', 2000, 'Item, Box, and Manual'],
  ['2', 'Journey', 'Playstation 3', 1500, 'Item, Box, and Manual'],
]);

describe('collection updates from email', () => {
  it("updates the collection from PriceCharting's export email, once, reading the mailbox only", async () => {
    const now = Date.now();
    const recent = new Date(now - 2 * 3_600_000).toISOString();
    const old = new Date(now - 10 * 86_400_000).toISOString();
    const box = mailbox([exportMail('old@vgpc', old), exportMail('new@vgpc', recent)]);
    const downloads: string[] = [];
    g = await testApp({
      features: ['mail'],
      mailbox: box.open,
      exportDownload: async (url) => {
        downloads.push(url);
        return { name: 'collection.zip', data: makeZip({ 'collection_20260927.csv': EXPORT }) };
      },
    });
    const cookies = await setUp(g);
    // Not set up: it says what's missing, and signs in to nothing.
    expect((await g.app.inject({ url: '/api/v1/mail', cookies })).json()).toMatchObject({ on: true, account: null, problem: expect.stringContaining('Settings > Email') });
    expect(await g.mail.check()).toMatch(/Settings > Email/);
    expect(box.calls).toHaveLength(0);

    // The email notifications' account is used when this part has none of its own (Gmail's IMAP server).
    g.settings.update({ 'notifications.emailProvider': 'gmail', 'notifications.smtpUser': 'me@example.com', 'notifications.smtpPassword': 'app password' });
    expect(g.mail.status()).toMatchObject({ account: { user: 'me@example.com', host: 'imap.gmail.com', port: 993 }, problem: null });
    const test = (await g.app.inject({ method: 'POST', url: '/api/v1/mail/test', cookies })).json();
    expect(test).toMatchObject({ ok: true, message: expect.stringContaining('one export email') });
    expect(box.calls[0]!.query).toMatchObject({ from: 'vgpc.com', subject: 'Exported Collection: Video Games' });
    // The test changes nothing.
    expect(g.collection.listImports()).toHaveLength(0);

    // The task: the new email's export becomes the collection; the 10-day-old one is left alone.
    const first = await g.mail.check();
    expect(first).toMatch(/collection updated from collection_20260927\.csv \(2 added/);
    expect(downloads).toEqual([LINK]);
    expect(g.collection.listImports()[0]).toMatchObject({ source: 'email', fileName: 'collection_20260927.csv', status: 'applied' });
    // Looked at once: the next check has nothing new.
    expect(await g.mail.check()).toMatch(/No new export emails/);
    expect(downloads).toHaveLength(1);
    const status = (await g.app.inject({ url: '/api/v1/mail', cookies })).json();
    expect(status).toMatchObject({ lastCheck: { ok: true }, recent: [{ status: 'applied', importId: expect.any(Number) }], exportUrl: 'https://www.pricecharting.com/my-collection' });
    expect(JSON.stringify(status)).not.toContain('app password');
    // "Check now" queues the task.
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/mail/check', cookies })).json()).toEqual({ queued: true });
  });

  it('never follows a link to another site, says when a link has expired, and explains a refused sign-in', async () => {
    const recent = new Date(Date.now() - 3_600_000).toISOString();
    const box = mailbox([exportMail('evil@vgpc', recent, 'https://192.0.2.10/collection.zip'), exportMail('expired@vgpc', recent)]);
    const downloads: string[] = [];
    g = await testApp({
      features: ['mail'],
      mailbox: box.open,
      exportDownload: async (url) => {
        downloads.push(url);
        const { ExpiredLink } = await import('./mailImport.js');
        throw new ExpiredLink();
      },
    });
    g.settings.update({ 'mail.username': 'me@example.com', 'mail.password': 'app password', 'mail.imapHost': 'imap.example.com' });
    const message = await g.mail.check();
    expect(message).toMatch(/no export link on an allowed site/);
    expect(message).toMatch(/link has expired/);
    // Only PriceCharting's storage was asked, never the other address.
    expect(downloads).toEqual([LINK]);
    expect(g.collection.listImports()).toHaveLength(0);

    // A sign-in the mailbox refuses: what to fix, and the task fails so it's alerted.
    const refused = Object.assign(new Error('Command failed'), { authenticationFailed: true, responseText: 'Invalid credentials' });
    const g2 = await testApp({ features: ['mail'], mailbox: mailbox([], refused).open });
    try {
      g2.settings.update({ 'mail.username': 'me@example.com', 'mail.password': 'wrong', 'mail.imapHost': 'imap.example.com' });
      expect(await g2.mail.test()).toEqual({ ok: false, message: expect.stringContaining('app password') });
      await expect(g2.mail.check()).rejects.toThrow(/refused the sign-in/);
    } finally {
      await g2.cleanup();
    }
  });

  it("reminds you to export when the newest export is old, once, and not for Outlook's mailboxes", async () => {
    const { transports, sent } = fakeTransports();
    g = await testApp({ transports });
    g.settings.update({ 'notifications.pushoverEnabled': true, 'notifications.pushoverToken': 't', 'notifications.pushoverUser': 'u' });
    g.collection.importText(EXPORT, { source: 'upload', fileName: 'collection_20200101.csv' });
    expect(await g.mail.remind()).toBe('Reminders are off.');
    g.settings.update({ 'collection.exportReminderDays': 7 });
    expect(await g.mail.remind()).toMatch(/^Reminded: the newest export is \d+ days old/);
    expect(sent.push.at(-1)).toMatchObject({ message: expect.stringContaining('https://www.pricecharting.com/my-collection') });
    expect(await g.mail.remind()).toBe('Already reminded about this export.');

    // Microsoft's mailboxes can't be read with a password: said up front.
    g.settings.update({ 'notifications.emailProvider': 'outlook', 'notifications.smtpUser': 'me@outlook.com', 'notifications.smtpPassword': 'x' });
    expect(g.mail.status().problem).toMatch(/Microsoft/);
  });
});

describe('export links', () => {
  it('takes only https links to a .zip or .csv on the allowed sites', () => {
    const hosts = ['storage.googleapis.com', 'pricecharting.com'];
    const html = `<a href="${LINK}">Download</a> <a href="https://www.PriceCharting.com/my-collection">yours</a> <a href="http://storage.googleapis.com/x/collection.zip">plain</a> <a href="https://evil.example/storage.googleapis.com/collection.zip">no</a>`;
    expect(exportLinks(html, `Also ${LINK}.`, hosts)).toEqual([LINK]);
    expect(hostAllowed('https://www.pricecharting.com/x.csv', hosts)).toBe(true);
    expect(hostAllowed('https://pricecharting.com.evil.example/x.csv', hosts)).toBe(false);
    expect(hostAllowed('not a link', hosts)).toBe(false);
  });
});

/** A wishlist deal email in PriceCharting's shape (made up: game, prices and listing). */
function dealMail(id: string, date: string, game: string, console: string, listing = `${game} Complete`): FoundMail {
  const html = `<div>We found an eBay deal from your wishlist.<br>Someone listed <a href="https://www.PriceCharting.com/game/1?utm_source=email">${game} for ${console}</a> for sale on eBay AND <b>it's below the market value</b>.
<a href="https://www.ebay.com/itm/555?mkevt=1"><img src="https://i.ebayimg.com/images/g/x/s-l225.jpg"/></a>
<span style="font-size: 12px;">Title:</span>: <a href="https://www.ebay.com/itm/555?mkevt=1"><span>${listing}</span></a>
<span style="font-size: 12px;">Price:</span> <span style="font-size: 24px;"> $19.99</span>
<span style="font-size: 12px;">Save:</span> <span style="font-size: 24px;"> $7.51</span></div>`;
  const source = [`From: PriceCharting <sales@vgpc.com>`, `Subject: [Wishlist Deal] Buy ${game} below market price`, `Message-ID: <${id}>`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', html].join('\r\n');
  return { id: `<${id}>`, date: new Date(date).toISOString(), subject: `[Wishlist Deal] Buy ${game} below market price`, from: 'sales@vgpc.com', source: Buffer.from(source) };
}

describe("deals from PriceCharting's emails", () => {
  it('lists each deal against the catalogs and the wishlist, and the game of the day shows it', async () => {
    const recent = new Date(Date.now() - 3_600_000).toISOString();
    const box = mailbox([dealMail('deal1@vgpc', recent, 'Tales of Graces f', 'Playstation 3'), dealMail('deal2@vgpc', recent, 'Okami', 'Playstation 3')]);
    const { transports, sent } = fakeTransports();
    g = await testApp({ features: ['mail'], mailbox: box.open, transports });
    const cookies = await setUp(g);
    const { seedCatalogs } = await import('./test-helpers.js');
    seedCatalogs(g, { owned: [['1', 'Okami', 'Playstation 3']], catalogs: { 'playstation-3': ['Okami', 'Tales of Graces f'] } });
    g.settings.update({ 'mail.username': 'me@example.com', 'mail.password': 'app password', 'mail.imapHost': 'imap.example.com' });
    // A message for a deal on a game the wishlist ranks in its top 25 (not for one you have).
    g.settings.update({ 'mail.dealAlertRank': 25, 'notifications.pushoverEnabled': true, 'notifications.pushoverToken': 't', 'notifications.pushoverUser': 'u' });
    expect(await g.mail.check()).toMatch(/2 new deals from PriceCharting/);
    const dealMessages = sent.push.filter((m) => /deal on/.test(m.title));
    expect(dealMessages.map((m) => m.title)).toEqual([expect.stringMatching(/deal on #\d+ of your wishlist: Tales of Graces f/)]);
    expect(dealMessages[0]!.message).toContain('$19.99');
    // Read once: the next look has nothing new.
    expect(await g.mail.check()).not.toMatch(/new deal/);
    const { deals, on } = (await g.app.inject({ url: '/api/v1/deals', cookies })).json();
    expect(on).toBe(true);
    const tales = deals.find((d: { title: string }) => d.title === 'Tales of Graces f');
    expect(tales).toMatchObject({ platformKey: 'playstation-3', platform: 'PlayStation 3', gameTitle: 'Tales of Graces f', status: 'missing', priceCents: 1999, saveCents: 751, listingUrl: 'https://www.ebay.com/itm/555', wishlist: { score: expect.any(Number) } });
    expect(deals.find((d: { title: string }) => d.title === 'Okami')).toMatchObject({ status: 'owned' });

    // The game of the day: the only game you don't have, with its deal.
    g.settings.update({ 'gotd.enabled': true });
    expect((await g.app.inject({ url: '/api/v1/gotd', cookies })).json().game).toMatchObject({ title: 'Tales of Graces f', deal: { priceCents: 1999, saveCents: 751 } });
    // A manual listed alone is left out (and counted), until that setting is off.
    expect((await g.app.inject({ url: '/api/v1/deals', cookies })).json().partsLeftOut).toBe(0);
    box.mails.push(dealMail('deal3@vgpc', recent, 'Tales of Graces f', 'Playstation 3', 'Tales of Graces f PS3 Manual Only'));
    await g.mail.check();
    const withPart = (await g.app.inject({ url: '/api/v1/deals', cookies })).json();
    expect(withPart.partsLeftOut).toBe(1);
    expect(withPart.deals.some((d: { listingTitle: string }) => /Manual Only/.test(d.listingTitle))).toBe(false);
    g.settings.update({ 'mail.dealsLeaveOutParts': false });
    const allListed = (await g.app.inject({ url: '/api/v1/deals', cookies })).json();
    expect(allListed.deals.find((d: { listingTitle: string }) => /Manual Only/.test(d.listingTitle))).toMatchObject({ part: 'Manual only' });
    // Deal emails off: none listed.
    g.settings.update({ 'mail.deals': false });
    expect((await g.app.inject({ url: '/api/v1/deals', cookies })).json()).toMatchObject({ on: false, deals: [] });
  });
});

describe('downloading an export', () => {
  it('fetches the file, says when the link has expired, and refuses one too large or moved', async () => {
    const { createServer } = await import('node:http');
    const { downloadExport, ExpiredLink } = await import('./mailImport.js');
    const zip = makeZip({ 'collection_20260927.csv': EXPORT });
    const server = createServer((req, res) => {
      if (req.url === '/export/collection.zip') return void res.writeHead(200, { 'content-type': 'application/zip' }).end(zip);
      if (req.url === '/gone.zip') return void res.writeHead(404).end();
      if (req.url === '/moved.zip') return void res.writeHead(302, { location: 'http://127.0.0.1:1/elsewhere.zip' }).end();
      if (req.url === '/huge.zip') return void res.writeHead(200, { 'content-length': String(80 * 1024 * 1024) }).end();
      res.writeHead(500).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      expect(await downloadExport(`${base}/export/collection.zip`)).toEqual({ name: 'collection.zip', data: zip });
      await expect(downloadExport(`${base}/gone.zip`)).rejects.toBeInstanceOf(ExpiredLink);
      // A link that moves elsewhere isn't followed.
      await expect(downloadExport(`${base}/moved.zip`)).rejects.toThrow();
      await expect(downloadExport(`${base}/huge.zip`)).rejects.toThrow(/too large/);
      await expect(downloadExport(`${base}/other.zip`)).rejects.toThrow(/answered 500/);
    } finally {
      server.close();
    }
  });

  it("says what to fix when the mail server can't be found or reached", async () => {
    for (const [code, text] of [
      ['ENOTFOUND', /wasn't found/],
      ['ECONNREFUSED', /could not be reached/],
      ['EOTHER', /couldn't be read/],
    ] as const) {
      const failing = await testApp({ features: ['mail'], mailbox: mailbox([], Object.assign(new Error('boom'), { code })).open });
      try {
        failing.settings.update({ 'mail.username': 'me@example.com', 'mail.password': 'x', 'mail.imapHost': 'imap.example.com' });
        expect(await failing.mail.test()).toEqual({ ok: false, message: expect.stringMatching(text) });
      } finally {
        await failing.cleanup();
      }
    }
  });
});
