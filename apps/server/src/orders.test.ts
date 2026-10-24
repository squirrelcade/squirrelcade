import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { copies } from './db/schema.js';
import type { FoundMail, MailboxOpener, MailSearch } from './mailImport.js';
import { fakeTransports, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

/** An order email (made up, in a store's shape): its HTML table of items and amounts. */
function orderMail(id: string, daysAgo: number, from: string, subject: string, rows: [string, string][]): FoundMail {
  const html = `<table>${rows.map(([a, b]) => `<tr><td>${a}</td><td>${b}</td></tr>`).join('')}</table>`;
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  const source = [`From: Store <${from}>`, 'To: someone@example.com', `Subject: ${subject}`, `Message-ID: <${id}>`, `Date: ${date.toUTCString()}`, 'MIME-Version: 1.0', 'Content-Type: text/html; charset=utf-8', '', html].join('\r\n');
  return { id: `<${id}>`, date: date.toISOString(), subject, from, fromName: 'Store', source: Buffer.from(source) };
}

/** A stand-in Gmail mailbox: its own search finds the emails with the phrase in them; every search is recorded. */
function gmailBox(mails: FoundMail[]) {
  const searches: MailSearch[] = [];
  const headerQueries: { since: Date; gmail?: string; subjects: readonly string[]; limit: number }[] = [];
  const open: MailboxOpener = async () => ({
    // Headers only: who sent each email since the day, and its subject (the subject check is the caller's).
    async headers(query) {
      headerQueries.push(query);
      return mails.filter((m) => Date.parse(m.date) >= query.since.getTime()).map((m) => ({ from: m.from, fromName: m.fromName, subject: m.subject, date: m.date }));
    },
    gmail: true,
    async find() {
      return { folder: '[Gmail]/All Mail', mails: [] };
    },
    async search(query) {
      searches.push(query);
      const phrase = /"([^"]+)"/.exec(query.gmail ?? '')?.[1];
      const found = mails.filter((m) => {
        if (Date.parse(m.date) < query.since.getTime()) return false;
        if (query.from?.length && !query.from.some((f) => m.from.endsWith(f))) return false;
        if (phrase) return m.source.toString('utf8').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').includes(phrase);
        if (query.text) return m.source.toString('utf8').toLowerCase().includes(query.text.toLowerCase());
        return true;
      });
      return { folder: '[Gmail]/All Mail', mails: found.filter((m) => !query.subject || query.subject(m.subject)).slice(-query.limit) };
    },
    async close() {},
  });
  return { open, searches, headerQueries, mails };
}

const EBAY_OKAMI = orderMail('ebay1@ebay', 3, 'ebay@ebay.com', 'Order confirmed: Okami PS2 Complete CIB Tested', [
  ['Order number:', '12-34567-89012'],
  ['Item price', '$24.99'],
  ['Shipping', '$4.99'],
  ['Sales tax', '$2.16'],
  ['Order total', '$32.14'],
]);

const SHOP_TWO = orderMail('shop1@shop', 20, 'orders@limitedrungames.com', 'Order #LRG100200 confirmed', [
  ['Shantae (Game Boy Color)', '$40.00'],
  ['Journey (PS3)', '$20.00'],
  ['Subtotal', '$60.00'],
  ['Shipping', '$9.00'],
  ['Taxes', '$4.80'],
  ['Total', '$73.80'],
]);

async function owner(mails: FoundMail[]) {
  const box = gmailBox(mails);
  const { transports, sent } = fakeTransports();
  g = await testApp({ mailbox: box.open, transports });
  const cookies = await setUp(g);
  seedCatalogs(g, { owned: [], catalogs: { 'playstation-2': ['Okami', 'Kingdom Hearts'], 'playstation-3': ['Journey', 'Okami HD'], 'game-boy-color': ['Shantae'] } });
  g.settings.update({ 'notifications.emailProvider': 'gmail', 'notifications.smtpUser': 'me@example.com', 'notifications.smtpPassword': 'app password' });
  return { box, cookies, sent };
}

const addCopy = async (cookies: Record<string, string>, platformKey: string, title: string) =>
  (await g!.app.inject({ method: 'POST', url: '/api/v1/collection/copies', cookies, payload: { platformKey, title, completeness: 'complete' } })).json().copy as { id: number; key: string };

const settle = async <T extends { state: string }>(url: string, cookies: Record<string, string>): Promise<T> => {
  for (let i = 0; i < 200; i++) {
    const job = (await g!.app.inject({ url, cookies })).json() as T;
    if (job.state !== 'reading') return job;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('The job never ended');
};

describe('prices from your order emails', () => {
  it("is off until turned on; then finds a copy's order in Gmail and fills in its price, as the setting counts it", async () => {
    const { box, cookies } = await owner([EBAY_OKAMI, SHOP_TWO]);
    const okami = await addCopy(cookies, 'playstation-2', 'Okami');
    // Off: nothing searched.
    expect((await g!.app.inject({ method: 'POST', url: '/api/v1/orders/find', cookies, payload: { copyId: okami.id } })).statusCode).toBe(409);
    expect(box.searches).toHaveLength(0);

    g!.settings.update({ 'orders.find': true });
    const started = (await g!.app.inject({ method: 'POST', url: '/api/v1/orders/find', cookies, payload: { copyId: okami.id } })).json();
    const job = await settle<{ state: string; found: Record<string, unknown>[] }>(`/api/v1/orders/find/${started.id}`, cookies);
    expect(job.state).toBe('done');
    // Gmail's own search: the title as a phrase, an order word, within the days set, no big emails.
    expect(box.searches[0]!.gmail).toMatch(/^"okami" \{order receipt purchase purchased bought invoice\} newer_than:365d smaller:5M$/);
    expect(job.found[0]).toMatchObject({ store: 'eBay', itemCents: 2499, taxCents: 216, shippingCents: 499, paidCents: 2499, orderNumber: '12-34567-89012', readBy: 'plain' });
    // Nothing is saved until the copy is.
    expect(g!.collection.ownCopies().find((c) => c.id === okami.id)?.costCents ?? null).toBeNull();

    // With the tax and shipping, shared out by price: Journey is a third of the $60 order.
    g!.settings.update({ 'orders.paidCounts': 'all' });
    const journey = await addCopy(cookies, 'playstation-3', 'Journey');
    const second = (await g!.app.inject({ method: 'POST', url: '/api/v1/orders/find', cookies, payload: { copyId: journey.id } })).json();
    const found = (await settle<{ state: string; found: Record<string, unknown>[] }>(`/api/v1/orders/find/${second.id}`, cookies)).found;
    expect(found[0]).toMatchObject({ store: 'Limited Run Games', itemCents: 2000, taxCents: 160, shippingCents: 300, paidCents: 2460 });
  });

  it('looks up the copies missing a price in one go, and keeps what it found until it is used or turned down', async () => {
    const { cookies } = await owner([EBAY_OKAMI, SHOP_TWO]);
    g!.settings.update({ 'orders.find': true });
    const okami = await addCopy(cookies, 'playstation-2', 'Okami');
    const shantae = await addCopy(cookies, 'game-boy-color', 'Shantae');
    await addCopy(cookies, 'playstation-2', 'Kingdom Hearts');
    const started = (await g!.app.inject({ method: 'POST', url: '/api/v1/orders/batch', cookies, payload: { added: 'here' } })).json();
    const job = await settle<{ state: string; total: number; done: number; found: number }>(`/api/v1/orders/batch/${started.id}`, cookies);
    expect(job).toMatchObject({ state: 'done', total: 3, done: 3, found: 2 });
    const kept = (await g!.app.inject({ url: '/api/v1/orders/found', cookies })).json().found as { copyId: number; paidCents: number }[];
    expect(kept.map((f) => [f.copyId, f.paidCents]).sort()).toEqual([[okami.id, 2499], [shantae.id, 4000]].sort());
    // Turned down: forgotten. Given a price: no longer listed.
    await g!.app.inject({ method: 'DELETE', url: `/api/v1/orders/found/${okami.id}`, cookies });
    await g!.app.inject({ method: 'PUT', url: `/api/v1/collection/copies/${shantae.id}`, cookies, payload: { costCents: 4000 } });
    expect((await g!.app.inject({ url: '/api/v1/orders/found', cookies })).json().found).toEqual([]);
  });

  it('looks up only the copies added in the last few days for a haul', async () => {
    const { cookies } = await owner([EBAY_OKAMI, SHOP_TWO]);
    g!.settings.update({ 'orders.find': true });
    const okami = await addCopy(cookies, 'playstation-2', 'Okami');
    const shantae = await addCopy(cookies, 'game-boy-color', 'Shantae');
    g!.db.update(copies).set({ addedAt: new Date(Date.now() - 30 * 86_400_000).toISOString() }).where(eq(copies.id, shantae.id)).run();
    const started = (await g!.app.inject({ method: 'POST', url: '/api/v1/orders/batch', cookies, payload: { recentDays: 7 } })).json();
    const job = await settle<{ state: string; total: number; found: number }>(`/api/v1/orders/batch/${started.id}`, cookies);
    expect(job).toMatchObject({ state: 'done', total: 1, found: 1 });
    const kept = (await g!.app.inject({ url: '/api/v1/orders/found', cookies })).json().found as { copyId: number }[];
    expect(kept.map((f) => f.copyId)).toEqual([okami.id]);
  });

  it("asks the AI model when one is set up, once for each email, with addresses left out; and the plain reader when it fails", async () => {
    const prompts: string[] = [];
    let fail = false;
    const box = gmailBox([EBAY_OKAMI]);
    g = await testApp({
      mailbox: box.open,
      visionFetch: async (_url, init) => {
        prompts.push(String((JSON.parse(String(init?.body)) as { messages: { content: string }[] }).messages[0]!.content));
        if (fail) return new Response('{"error": "down"}', { status: 503 });
        const answer = { orders: [{ email: 1, purchase: true, store: 'eBay', date: '2026-10-01', orderNumber: '12-34567-89012', currency: 'USD', items: [{ title: 'Okami PS2 Complete CIB Tested', price: 23.5, quantity: 1 }], tax: 2, shipping: 5, total: 30.5 }] };
        return Response.json({ choices: [{ message: { content: `Here you go: ${JSON.stringify(answer)}` } }] });
      },
    });
    const cookies = await setUp(g);
    seedCatalogs(g, { owned: [], catalogs: { 'playstation-2': ['Okami'] } });
    g.settings.update({ 'notifications.emailProvider': 'gmail', 'notifications.smtpUser': 'me@example.com', 'notifications.smtpPassword': 'app password', 'orders.find': true, 'features.vision': true, 'sources.visionUrl': 'https://ai.example/v1', 'sources.visionModel': 'reader' });
    const okami = await addCopy(cookies, 'playstation-2', 'Okami');
    const ask = async () => {
      const started = (await g!.app.inject({ method: 'POST', url: '/api/v1/orders/find', cookies, payload: { copyId: okami.id } })).json();
      return (await settle<{ state: string; found: Record<string, unknown>[] }>(`/api/v1/orders/find/${started.id}`, cookies)).found;
    };
    expect((await ask())[0]).toMatchObject({ readBy: 'ai', itemCents: 2350, date: '2026-10-01' });
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('Order total\t$32.14');
    expect(prompts[0]).not.toContain('someone@example.com');
    // Read once: the second lookup asks nothing.
    await ask();
    expect(prompts).toHaveLength(1);
    // Turned to the plain reader: no email goes to the model.
    g.settings.update({ 'orders.reader': 'plain' });
    expect((await ask())[0]).toMatchObject({ readBy: 'plain', itemCents: 2499 });
    expect(prompts).toHaveLength(1);
    // A model that fails: the plain reader reads it instead.
    g.settings.update({ 'orders.reader': 'ai' });
    fail = true;
    box.mails.push(orderMail('ebay2@ebay', 1, 'ebay@ebay.com', 'Order confirmed: Okami PS2 Black Label', [['Item price', '$30.00']]));
    const both = await ask();
    expect(both.map((f) => f.readBy).sort()).toEqual(['ai', 'plain']);
  });
});

describe('On the way', () => {
  it('watches for purchases, lists them out of the collection, and makes one a copy when it arrives', async () => {
    const mercari = orderMail('mercari1@mercari', 1, 'no-reply@mercari.com', 'You purchased Kingdom Hearts PS2 Greatest Hits', [['Item price', '$12.00'], ['Sales tax', '$1.00'], ['Total', '$13.00']]);
    const shipped = orderMail('ship1@ebay', 1, 'ebay@ebay.com', 'Your order has shipped: Okami PS2', [['Order total', '$32.14']]);
    const unsure = orderMail('ebay3@ebay', 2, 'ebay@ebay.com', 'Order confirmed: Okami lot of games', [['Item price', '$50.00']]);
    const lookalike = orderMail('fake1@fake', 1, 'billing@notebay.com', 'Order confirmed: Okami PS2', [['Item price', '$1.00']]);
    const { box, cookies, sent } = await owner([EBAY_OKAMI, mercari, shipped, unsure, lookalike]);
    g!.settings.update({ 'notifications.pushoverEnabled': true, 'notifications.pushoverToken': 't', 'notifications.pushoverUser': 'u' });
    expect(await g!.orders.watch()).toMatch(/off/);
    g!.settings.update({ 'orders.watch': true, 'orders.watchNotify': true });
    // Counts only (the line is logged): the shipping notice is left out by its subject.
    expect(await g!.orders.watch()).toBe('3 new on the way (3 purchase emails read).');
    // eBay's and Mercari's addresses, searched by sender since the first look's days.
    expect(box.searches.map((s) => s.from)).toEqual([['ebay.com'], ['mercari.com']]);
    const { items } = (await g!.app.inject({ url: '/api/v1/coming', cookies })).json() as { items: Record<string, unknown>[] };
    const okami = items.find((i) => String(i.listingTitle).startsWith('Okami PS2'))!;
    expect(okami).toMatchObject({ platformKey: 'playstation-2', store: 'eBay', itemCents: 2499, paidCents: 2499, link: null });
    expect(items.find((i) => i.title === 'Kingdom Hearts')).toMatchObject({ store: 'Mercari', paidCents: 1200 });
    // The shipping notice isn't a purchase; a listing that names no one game waits for the owner to say.
    expect(items.some((i) => String(i.listingTitle).includes('shipped'))).toBe(false);
    expect(items.find((i) => i.listingTitle === 'Okami lot of games')).toMatchObject({ title: null, platformKey: null, maybe: [expect.objectContaining({ title: 'Okami', platformKey: 'playstation-2' })] });
    expect(sent.push.at(-1)?.title).toMatch(/on the way/);
    // Not in the collection, not counted.
    expect(g!.collection.ownCopies()).toHaveLength(0);
    // Each email is read once.
    expect(await g!.orders.watch()).toMatch(/^Nothing new on the way/);

    // Store Mode says so.
    const found = (await g!.app.inject({ url: '/api/v1/lookup?q=Okami&platform=playstation-2', cookies })).json() as { title: string; onTheWay: unknown }[];
    expect(found.find((r) => r.title === 'Okami')?.onTheWay).toMatchObject({ store: 'eBay', paidCents: 2499 });

    // It's here: a copy with its price and the day of the order; it leaves the list.
    const arrived = (await g!.app.inject({ method: 'POST', url: `/api/v1/coming/${okami.id}/arrived`, cookies })).json();
    expect(arrived).toMatchObject({ platformKey: 'playstation-2', title: 'Okami', id: expect.any(Number) });
    const copy = g!.collection.ownCopies().find((c) => c.id === arrived.id)!;
    expect(copy).toMatchObject({ costCents: 2499, datePurchased: okami.orderDate });
    expect(((await g!.app.inject({ url: '/api/v1/coming', cookies })).json().items as { id: number }[]).some((i) => i.id === okami.id)).toBe(false);
    // Dismissed: gone too.
    const kh = items.find((i) => i.title === 'Kingdom Hearts')!;
    expect((await g!.app.inject({ method: 'POST', url: `/api/v1/coming/${kh.id}/dismiss`, cookies })).json()).toEqual({ ok: true });
    // A viewer sees none of it: not the list, not in Store Mode's answers.
    const invite = await g!.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Mom' }, cookies });
    const joined = await g!.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'mom', password: 'kitchen table' } });
    const viewer = { squirrelcade_session: joined.cookies.find((c) => c.name === 'squirrelcade_session')!.value };
    expect((await g!.app.inject({ url: '/api/v1/coming', cookies: viewer })).statusCode).toBe(403);
    expect((await g!.app.inject({ url: '/api/v1/orders/found', cookies: viewer })).statusCode).toBe(403);
    const lot = items.find((i) => i.listingTitle === 'Okami lot of games')!;
    await g!.app.inject({ method: 'PUT', url: `/api/v1/coming/${lot.id}`, cookies, payload: { platformKey: 'playstation-2', title: 'Okami' } });
    const theirs = (await g!.app.inject({ url: '/api/v1/lookup?q=Okami&platform=playstation-2', cookies: viewer })).json() as { title: string; onTheWay: unknown }[];
    expect(theirs.find((r) => r.title === 'Okami')?.onTheWay).toBeNull();
    expect(((await g!.app.inject({ url: '/api/v1/lookup?q=Okami&platform=playstation-2', cookies })).json() as { title: string; onTheWay: unknown }[]).find((r) => r.title === 'Okami')?.onTheWay).toMatchObject({ id: lot.id });
  });

  it("finds the stores of your purchase emails from their headers alone, for On the way's list", async () => {
    const mercari = orderMail('mercari2@mercari', 5, 'no-reply@mercari.com', 'You purchased Shantae', [['Item price', '$30.00']]);
    const gamestop = orderMail('gs1@gamestop', 30, 'notifications@info.gamestop.com', 'Thank you for your order!', [['Item price', '$59.99']]);
    const shipped = orderMail('ship2@ebay', 1, 'ebay@ebay.com', 'Your order has shipped: Okami PS2', [['Order total', '$32.14']]);
    const older = orderMail('old1@shop', 500, 'orders@oldshop.example', 'Order confirmed', [['Item price', '$5.00']]);
    const pizza = orderMail('pz1@pizza', 3, 'receipts@pizza.example', 'Your receipt from Pizza Place', [['Total', '$20.00']]);
    const { box, cookies } = await owner([EBAY_OKAMI, SHOP_TWO, mercari, gamestop, shipped, older, pizza]);
    // Off with On the way.
    expect((await g!.app.inject({ method: 'POST', url: '/api/v1/orders/stores', cookies })).statusCode).toBe(409);
    g!.settings.update({ 'orders.watch': true });
    const started = (await g!.app.inject({ method: 'POST', url: '/api/v1/orders/stores', cookies })).json() as { id: string };
    const job = await settle<{ state: string; read: number; days: number; stores: { domain: string; name: string; emails: number; known: boolean }[] }>(`/api/v1/orders/stores/${started.id}`, cookies);
    expect(job).toMatchObject({ state: 'done', read: 6, days: 365 });
    // Gmail's own search: a purchase word in the subject, within "Look at order emails from the last" (a year).
    expect(box.headerQueries[0]?.gmail).toMatch(/^\{subject:"order confirmed" .*\} newer_than:365d$/);
    // The stores Squirrelcade reads first; a shipping notice and an email older than a year count for nothing.
    expect(job.stores.map((s) => [s.domain, s.name, s.emails, s.known])).toEqual([
      ['ebay.com', 'eBay', 1, true],
      ['gamestop.com', 'GameStop', 1, true],
      ['limitedrungames.com', 'Limited Run Games', 1, true],
      ['mercari.com', 'Mercari', 1, true],
      ['pizza.example', 'Store', 1, false],
    ]);
    // No email was fetched whole.
    expect(box.searches).toHaveLength(0);
  });
});
