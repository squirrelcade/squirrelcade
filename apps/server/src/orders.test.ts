import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { appState, comingItems, copies } from './db/schema.js';
import type { FoundMail, MailboxOpener, MailSearch } from './mailImport.js';
import { fakeTransports, multipart, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

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

async function owner(mails: FoundMail[], extra: Parameters<typeof testApp>[0] = {}) {
  const box = gmailBox(mails);
  const { transports, sent } = fakeTransports();
  g = await testApp({ mailbox: box.open, transports, ...extra });
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

  it('shows the page on its own switch, whether or not purchase emails are read (D195)', async () => {
    const { cookies } = await owner([]);
    const coming = async () => (await g!.app.inject({ url: '/api/v1/coming', cookies })).json() as { on: boolean; watch: boolean };
    // On to start, with no email set up.
    expect(await coming()).toMatchObject({ on: true, watch: false });
    g!.settings.update({ 'orders.watch': true });
    expect(await coming()).toMatchObject({ on: true, watch: true });
    g!.settings.update({ 'orders.page': false, 'orders.watch': false });
    expect(await coming()).toMatchObject({ on: false, watch: false });
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

describe('Several games, one price (D173)', () => {
  it("splits a lot into its games, sharing its price evenly unless one's is given, and turns pounds into dollars at the order day's rate", async () => {
    const lot = orderMail('mercari9@mercari', 1, 'no-reply@mercari.com', 'You purchased: PS2 Game Lot - Okami, Kingdom Hearts, Shadow Hearts', [['Item price', '$30.01'], ['Sales tax', '$3.00'], ['Total', '$33.01']]);
    const pack = orderMail('srg1@srg', 2, 'help@superraregames.com', 'Order #400001 confirmed', [['PS3 Bundle - Journey, Okami HD', '£40.00'], ['Subtotal', '£40.00'], ['Shipping', '£10.00'], ['Total', '£50.00 GBP']]);
    const asked: string[] = [];
    const { cookies } = await owner([lot, pack], {
      ratesFetch: async (url) => {
        asked.push(url);
        return Response.json({ amount: 1, base: 'GBP', rates: { USD: 1.25 } });
      },
    });
    g!.settings.update({ 'orders.watch': true, 'orders.watchSenders': ['ebay.com', 'mercari.com', 'superraregames.com'] });
    expect(await g!.orders.watch()).toBe('2 new on the way (2 purchase emails read).');
    const list = async () => (await g!.app.inject({ url: '/api/v1/coming', cookies })).json().items as Record<string, unknown>[];
    const items = await list();
    const mercariLot = items.find((i) => i.store === 'Mercari')!;
    const srgPack = items.find((i) => i.store === 'Super Rare Games')!;
    // Both are several games; the pack's price is in pounds, its dollars at the day's rate (asked once).
    expect(mercariLot).toMatchObject({ several: true, title: null, paidCents: 3001 });
    expect(srgPack).toMatchObject({ several: true, currency: 'GBP', paidInCurrencyCents: 4000, paidCents: 5000 });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/frankfurter\.app\/\d{4}-\d{2}-\d{2}\?from=GBP&to=USD$/);

    // The lot's games, guessed from its listing, each matched on the console it names.
    const guesses = (await g!.app.inject({ url: `/api/v1/coming/${mercariLot.id}/games`, cookies })).json();
    expect(guesses.games.map((x: { name: string; title: string | null }) => [x.name, x.title])).toEqual([
      ['Okami', 'Okami'],
      ['Kingdom Hearts', 'Kingdom Hearts'],
      ['Shadow Hearts', null],
    ]);
    // Split: one price given, the rest shared to the cent; the tax shared evenly; the lot gone from the list.
    const split = await g!.app.inject({
      method: 'POST',
      url: `/api/v1/coming/${mercariLot.id}/split`,
      cookies,
      payload: { games: [{ platformKey: 'playstation-2', title: 'Okami', cents: 2000 }, { platformKey: 'playstation-2', title: 'Kingdom Hearts' }, { platformKey: null, title: 'Shadow Hearts' }] },
    });
    expect(split.statusCode).toBe(201);
    const games = split.json().items as { title: string | null; listingTitle: string; itemCents: number; taxCents: number; lotOf: number }[];
    expect(games.map((x) => [x.listingTitle, x.title, x.itemCents, x.taxCents, x.lotOf])).toEqual([
      ['Okami', 'Okami', 2000, 100, mercariLot.id],
      ['Kingdom Hearts', 'Kingdom Hearts', 501, 100, mercariLot.id],
      ['Shadow Hearts', null, 500, 100, mercariLot.id],
    ]);
    const after = await list();
    expect(after.some((i) => i.id === mercariLot.id)).toBe(false);
    expect(after.filter((i) => i.lotOf === mercariLot.id)).toHaveLength(3);
    // Each arrives on its own, with its share; the email is never read into the lot again.
    const okami = games[0] as unknown as { id: number };
    const arrived = (await g!.app.inject({ method: 'POST', url: `/api/v1/coming/${okami.id}/arrived`, cookies })).json();
    expect(g!.collection.ownCopies().find((c) => c.id === arrived.id)).toMatchObject({ costCents: 2000 });
    expect(await g!.orders.watch()).toMatch(/^Nothing new on the way/);
    // A split needs two games; a split lot can't be split again.
    expect((await g!.app.inject({ method: 'POST', url: `/api/v1/coming/${srgPack.id}/split`, cookies, payload: { games: [{ title: 'Journey' }] } })).statusCode).toBe(400);
    expect((await g!.app.inject({ method: 'POST', url: `/api/v1/coming/${mercariLot.id}/split`, cookies, payload: { games: [{ title: 'A' }, { title: 'B' }] } })).statusCode).toBe(400);
    // The pack split in two: its dollars come from its pounds.
    const halves = (await g!.app.inject({ method: 'POST', url: `/api/v1/coming/${srgPack.id}/split`, cookies, payload: { games: [{ platformKey: 'playstation-3', title: 'Journey' }, { platformKey: 'playstation-3', title: 'Okami HD' }] } })).json().items as { paidCents: number; paidInCurrencyCents: number }[];
    expect(halves.map((x) => [x.paidInCurrencyCents, x.paidCents])).toEqual([
      [2000, 2500],
      [2000, 2500],
    ]);
    // Without the rates (the setting off), a price in another currency is left for the owner to type.
    g!.settings.update({ 'orders.exchangeRates': false });
    expect(((await list()).find((i) => i.listingTitle === 'Journey') as { paidCents: number | null }).paidCents).toBeNull();
  });
});

describe('Amazon (D176)', () => {
  it("waits with an Amazon order's unnamed game, names it from its order page, and brings in the order history's games", async () => {
    const ordered = orderMail('amz1@amazon', 1, 'auto-confirm@amazon.com', 'Ordered 2 items: Video Games, Electronics', [['2 items: 1 Video Games, 1 Electronics', ''], ['Order #', '111-1234567-7654321'], ['Grand Total:', '$32.39']]);
    const shipped = orderMail('amz2@amazon', 1, 'shipment-tracking@amazon.com', 'Shipped 2 items: Video Games, Electronics', [['Order #', '111-1234567-7654321']]);
    const tools = orderMail('amz3@amazon', 1, 'auto-confirm@amazon.com', 'Ordered 1 item: Tools', [['1 item: 1 Tools', ''], ['Order #', '111-1234567-0000000']]);
    const { cookies } = await owner([ordered, shipped, tools]);
    g!.settings.update({ 'orders.watch': true, 'orders.watchSenders': ['amazon.com'] });
    expect(await g!.orders.watch()).toMatch(/^1 new on the way/);
    const list = async () => (await g!.app.inject({ url: '/api/v1/coming', cookies })).json().items as Record<string, unknown>[];
    const unnamed = (await list())[0]!;
    expect(unnamed).toMatchObject({ store: 'Amazon', unknown: true, title: null, maybe: [], orderNumber: '111-1234567-7654321' });

    // Its page, pasted: its game, matched, with its price; the unnamed line gives way to it.
    const page = ['Order Details', 'Order placed October 24, 2026', 'Order # 111-1234567-7654321', 'Order Summary', 'Item(s) Subtotal: $29.99', 'Grand Total: $32.39', 'Arriving today', 'Okami - PlayStation 2', 'Sold by: Amazon.com Services LLC', '$29.99', 'Buy it again'].join('\n');
    const named = await g!.app.inject({ method: 'POST', url: '/api/v1/coming/page', cookies, payload: { text: page, into: unnamed.id } });
    expect(named.statusCode).toBe(201);
    expect(named.json().items).toEqual([expect.objectContaining({ store: 'Amazon', platformKey: 'playstation-2', title: 'Okami', itemCents: 2999, orderDate: '2026-10-24' })]);
    expect((await list()).some((i) => i.id === unnamed.id)).toBe(false);
    // The same page again, on its own this time, adds nothing (D236: its game is there); something that isn't an order page says so.
    expect((await g!.app.inject({ method: 'POST', url: '/api/v1/coming/page', cookies, payload: { text: page } })).json().items).toHaveLength(0);
    expect((await list()).filter((i) => i.title === 'Okami')).toHaveLength(1);
    expect((await g!.app.inject({ method: 'POST', url: '/api/v1/coming/page', cookies, payload: { text: 'hello' } })).statusCode).toBe(400);

    // The order history: a game you have is left out, a cable isn't a game, a game is on the way with its price.
    await g!.app.inject({ method: 'POST', url: '/api/v1/collection/copies', cookies, payload: { platformKey: 'playstation-3', title: 'Journey', completeness: 'complete' } });
    const csv = [
      'Website,Order ID,Order Date,Currency,Unit Price,Quantity,Order Status,Product Name',
      'Amazon.com,111-0000001-0000001,2019-03-04T18:22:01Z,USD,19.99,1,Closed,"Journey - PlayStation 3"',
      'Amazon.com,111-0000002-0000002,2020-07-01T10:00:00Z,USD,12.50,1,Closed,"USB-C Cable, 2 Pack"',
      'Amazon.com,111-0000003-0000003,2021-01-01T10:00:00Z,USD,24.99,1,Closed,"Kingdom Hearts - PlayStation 2"',
    ].join('\n');
    const history = await g!.app.inject({ method: 'POST', url: '/api/v1/coming/amazon-history', cookies, ...multipart('Retail.OrderHistory.1.csv', csv) });
    expect(history.json()).toEqual({ items: 3, games: 2, added: 1, have: 1, unsure: 0 });
    expect((await list()).find((i) => i.title === 'Kingdom Hearts')).toMatchObject({ itemCents: 2499, orderDate: '2021-01-01', store: 'Amazon' });
    // Dropped in again: nothing twice.
    expect((await g!.app.inject({ method: 'POST', url: '/api/v1/coming/amazon-history', cookies, ...multipart('Retail.OrderHistory.1.csv', csv) })).json().added).toBe(0);
    expect((await g!.app.inject({ method: 'POST', url: '/api/v1/coming/amazon-history', cookies, ...multipart('list.csv', 'Title\nOkami') })).statusCode).toBe(400);
  });
});

describe('On the way with two email accounts', () => {
  it("reads the purchase emails of every account when set to all, and of the chosen one alone when set to one", async () => {
    const mercari = orderMail('mercari1@mercari', 1, 'no-reply@mercari.com', 'You purchased Kingdom Hearts PS2 Greatest Hits', [['Item price', '$12.00'], ['Sales tax', '$1.00'], ['Total', '$13.00']]);
    const homeBox = gmailBox([EBAY_OKAMI]);
    const workBox = gmailBox([mercari]);
    const opened: string[] = [];
    const open: MailboxOpener = async (account) => {
      opened.push(account.user);
      return account.user === 'home@example.com' ? homeBox.open(account) : workBox.open(account);
    };
    const { transports } = fakeTransports();
    g = await testApp({ mailbox: open, transports });
    seedCatalogs(g, { owned: [], catalogs: { 'playstation-2': ['Okami', 'Kingdom Hearts'] } });
    const base = { imapHost: 'imap.example.com', imapPort: 993, imapSecurity: 'ssl' as const, smtpHost: '', smtpPort: 587, username: '' };
    g.mail.accounts.add({ ...base, name: 'Home', address: 'home@example.com', password: 'one' });
    const work = g.mail.accounts.add({ ...base, name: 'Work', address: 'work@example.com', password: 'two' });
    g.settings.update({ 'orders.watch': true });
    // All (empty): both mailboxes are watched, and a purchase from each is on the way.
    expect(await g.orders.watch()).toBe('2 new on the way (2 purchase emails read).');
    expect(opened.sort()).toEqual(['home@example.com', 'work@example.com']);
    // Chosen: only Work is signed in to.
    opened.length = 0;
    g.settings.update({ 'orders.watchAccounts': [String(work.id)] });
    await g.orders.watch();
    expect(opened).toEqual(['work@example.com']);
  });
});

describe('On the way: one purchase, listed once (D236)', () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const waiting = async (cookies: Record<string, string>) => (await g!.app.inject({ url: '/api/v1/coming', cookies })).json().items as Record<string, unknown>[];

  it("doesn't add an order's email for a game Claude's connector put there, and takes its tax and shipping", async () => {
    const mercari = orderMail('mercari1@mercari', 1, 'no-reply@mercari.com', 'You purchased Kingdom Hearts PS2 Greatest Hits', [['Item price', '$12.00'], ['Sales tax', '$1.00'], ['Total', '$13.00']]);
    const { box, cookies } = await owner([EBAY_OKAMI, mercari]);
    // The connector first, as a daily task of Claude's says it hours before the email is read.
    const said = g!.orders.recordOnTheWay({ title: 'Okami PS2 Complete CIB Tested', store: 'eBay', orderDate: daysAgo(3), priceCents: 2499, orderNumber: '12-34567-89012', itemId: '407000000001', expectedOn: '2026-12-01' });
    expect(said.status).toBe('added');
    // With no order number to go by: the same game from the same store within days.
    expect(g!.orders.recordOnTheWay({ title: 'Kingdom Hearts PS2 Greatest Hits', store: 'mercari', orderDate: daysAgo(2), priceCents: 1200 }).status).toBe('added');
    g!.settings.update({ 'orders.watch': true });
    expect(await g!.orders.watch()).toBe('Nothing new on the way (2 purchase emails read).');
    let items = await waiting(cookies);
    expect(items).toHaveLength(2);
    // The one there keeps what it had and takes what the email adds.
    expect(items.find((i) => i.title === 'Okami')).toMatchObject({ id: said.item!.id, itemCents: 2499, taxCents: 216, shippingCents: 499, expectedOn: '2026-12-01', orderNumber: '12-34567-89012' });
    expect(items.find((i) => i.title === 'Kingdom Hearts')).toMatchObject({ itemCents: 1200, taxCents: 100 });

    // Another order of the same game is another copy on its way; so is another item of the same order.
    expect(g!.orders.recordOnTheWay({ title: 'Okami PS2 Complete CIB Tested', store: 'eBay', orderDate: daysAgo(1), priceCents: 2000, orderNumber: '99-00000-00001', itemId: '407000000002' }).status).toBe('added');
    expect(g!.orders.recordOnTheWay({ title: 'Kingdom Hearts PS2 Black Label', store: 'eBay', orderDate: daysAgo(3), orderNumber: '12-34567-89012', itemId: '407000000003' }).status).toBe('added');
    expect(await waiting(cookies)).toHaveLength(4);

    // Said again in other words, with no item id: known, not added.
    expect(g!.orders.recordOnTheWay({ title: 'Okami PS2 Complete CIB Tested', platform: 'PlayStation 2', store: 'eBay', orderNumber: '12-34567-89012' })).toMatchObject({ status: 'known', item: { id: said.item!.id } });
    // Once it's here, neither the connector nor another email of the order puts it back.
    await g!.app.inject({ method: 'POST', url: `/api/v1/coming/${said.item!.id}/arrived`, cookies });
    expect(g!.orders.recordOnTheWay({ title: 'Okami (PS2) complete, tested', platform: 'PlayStation 2', store: 'eBay', orderNumber: '12-34567-89012' }).status).toBe('known');
    box.mails.push(orderMail('ebay9@ebay', 0, 'ebay@ebay.com', 'Order confirmed: Okami PS2 Complete CIB Tested', [['Order number:', '12-34567-89012'], ['Item price', '$24.99']]));
    expect(await g!.orders.watch()).toMatch(/^Nothing new on the way/);
    items = await waiting(cookies);
    expect(items).toHaveLength(3);
    expect(items.some((i) => i.orderNumber === '12-34567-89012' && i.title === 'Okami')).toBe(false);
  });

  it("takes an order's one item for the one game an app put there for it, when their words differ", async () => {
    const ebay = orderMail('ebay5@ebay', 1, 'ebay@ebay.com', 'Order confirmed: Rare dungeon crawler import, tested', [['Order number:', '55-55555-55555'], ['Item price', '$40.00'], ['Shipping', '$5.00']]);
    const two = orderMail('ebay6@ebay', 1, 'ebay@ebay.com', 'Order confirmed: Okami PS2 Complete', [['Order number:', '66-66666-66666'], ['Item price', '$20.00']]);
    const { cookies } = await owner([ebay, two]);
    // A game Squirrelcade can't name, on a console the app said.
    expect(g!.orders.recordOnTheWay({ title: 'Dungeon thing (JP)', platform: 'PlayStation 2', store: 'eBay', orderNumber: '55-55555-55555', itemId: '407000000010', priceCents: 4000 }).status).toBe('added');
    // Two known games aren't one for sharing an order: Kingdom Hearts from the app, Okami in the email.
    expect(g!.orders.recordOnTheWay({ title: 'Kingdom Hearts PS2', store: 'eBay', orderNumber: '66-66666-66666', itemId: '407000000011' }).status).toBe('added');
    g!.settings.update({ 'orders.watch': true });
    expect(await g!.orders.watch()).toBe('1 new on the way (2 purchase emails read).');
    const items = await waiting(cookies);
    expect(items.filter((i) => i.orderNumber === '55-55555-55555')).toEqual([expect.objectContaining({ listingTitle: 'Dungeon thing (JP) - PlayStation 2', itemCents: 4000, shippingCents: 500 })]);
    expect(items.filter((i) => i.orderNumber === '66-66666-66666').map((i) => i.title).sort()).toEqual(['Kingdom Hearts', 'Okami']);
  });

  it('makes one, once, of the games listed twice before', async () => {
    const { cookies } = await owner([]);
    const row = { itemIndex: 0, store: 'eBay', orderDate: '2026-11-07', quantity: 1, currency: 'USD', readBy: 'ai', status: 'waiting', createdAt: '2026-11-07T16:00:00.000Z' };
    const okami = { listingTitle: 'Okami PS2 Complete', itemCents: 1999, platformKey: 'playstation-2', title: 'Okami' };
    const hearts = { listingTitle: 'Kingdom Hearts PS2', itemCents: 900, platformKey: 'playstation-2', title: 'Kingdom Hearts' };
    const unnamed = 'Amazon order 111-0000001-0000001: a video game, its name not in the email';
    g!.db
      .insert(comingItems)
      .values([
        // The connector's, then its email's: both waiting.
        { ...row, ...okami, mailRef: 'connector:08-1|407000000021', orderNumber: '08-1', expectedOn: '2026-11-18' },
        { ...row, ...okami, mailRef: 'mail-a', orderNumber: '08-1', taxCents: 122, shippingCents: 708 },
        // One that arrived, and its email's still waiting.
        { ...row, ...hearts, mailRef: 'connector:08-2|407000000022', orderNumber: '08-2', status: 'arrived' },
        { ...row, ...hearts, mailRef: 'mail-b', orderNumber: '08-2' },
        // An Amazon order's game its email didn't name, that an app named and that arrived.
        { ...row, mailRef: 'connector:111-0000001-0000001|B000000001', store: 'Amazon', orderNumber: '111-0000001-0000001', listingTitle: 'Journey - PlayStation 3', platformKey: 'playstation-3', title: 'Journey', status: 'arrived' },
        { ...row, mailRef: 'mail-c', store: 'Amazon', orderNumber: '111-0000001-0000001', listingTitle: unnamed },
        // Each its own: an email's two items, and the same game on another order.
        { ...row, mailRef: 'mail-d', orderNumber: '08-3', listingTitle: 'Journey (PS3)', platformKey: 'playstation-3', title: 'Journey' },
        { ...row, mailRef: 'mail-d', itemIndex: 1, orderNumber: '08-3', listingTitle: 'Shantae (Game Boy Color)', platformKey: 'game-boy-color', title: 'Shantae' },
        { ...row, ...okami, mailRef: 'mail-e', orderNumber: '08-4' },
      ])
      .run();
    expect(await waiting(cookies)).toHaveLength(7);
    // A start does it once (this install's start, before these rows, found nothing and noted it).
    g!.db.delete(appState).where(eq(appState.key, 'orders.sameOnce')).run();
    expect(g!.orders.sameOnce()).toBe(3);
    const items = await waiting(cookies);
    expect(items.map((i) => `${i.orderNumber} ${i.title}`).sort()).toEqual(['08-1 Okami', '08-3 Journey', '08-3 Shantae', '08-4 Okami']);
    // The earlier one stays, with the day it's expected, and takes the email's tax and shipping.
    expect(items.find((i) => i.orderNumber === '08-1')).toMatchObject({ expectedOn: '2026-11-18', itemCents: 1999, taxCents: 122, shippingCents: 708 });
    // Put away, not shown as dismissed or arrived.
    expect(((await g!.app.inject({ url: '/api/v1/coming?all=1', cookies })).json().items as { status: string }[]).filter((i) => i.status !== 'waiting').map((i) => i.status).sort()).toEqual(['arrived', 'arrived']);
    expect(g!.orders.sameOnce()).toBe(0);
  });
});
