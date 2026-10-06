import { pcFamilyKey } from '@squirrelcade/core';
import { afterEach, describe, expect, it } from 'vitest';
import { pcCandidates } from './db/schema.js';
import type { FetchLike } from './igdb.js';
import { bestDeal, saleHtml, saleMessage } from './itad.js';
import { emailLayout } from './notifications.js';
import { fakeTransports, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

const amount = (cents: number) => ({ amount: cents / 100, amountInt: cents, currency: 'USD' });
const deal = (shop: string, cents: number, regular: number) => ({ shop: { id: 1, name: shop }, price: amount(cents), regular: amount(regular), cut: Math.round((1 - cents / regular) * 100), url: `https://example.com/${shop}` });

/** A fake IsThereAnyDeal: Hades by its Steam app id, Disco Elysium by title, and a game it doesn't know. */
function fakeItad(prices: Record<string, { deals: ReturnType<typeof deal>[]; low: number }>) {
  const calls: string[] = [];
  const fetch: FetchLike = async (url, init) => {
    const u = new URL(url);
    calls.push(`${init.method ?? 'GET'} ${u.pathname}?${[...u.searchParams].filter(([k]) => k !== 'key').map(([k, v]) => `${k}=${v}`).join('&')}`);
    if (u.searchParams.get('key') !== 'itad-key') return new Response('no', { status: 403 });
    if (u.pathname === '/games/lookup/v1') {
      if (u.searchParams.get('appid') === '1145360') return Response.json({ found: true, game: { id: 'id-hades', slug: 'hades', title: 'Hades' } });
      if (u.searchParams.get('title') === 'Disco Elysium') return Response.json({ found: true, game: { id: 'id-disco', slug: 'disco-elysium', title: 'Disco Elysium' } });
      return Response.json({ found: false });
    }
    if (u.pathname === '/games/prices/v3') {
      const ids = JSON.parse(String(init.body)) as string[];
      return Response.json(ids.map((id) => ({ id, historyLow: { all: amount(prices[id]!.low) }, deals: prices[id]!.deals })));
    }
    return new Response('not found', { status: 404 });
  };
  return { fetch, calls };
}

/** The PC wishlist's found games, as the weekly search would keep them. */
function seedPcWishlist() {
  const now = new Date().toISOString();
  const game = (id: number, name: string) =>
    JSON.stringify({ id, name, altNames: [], coverId: null, genres: ['Role-playing (RPG)'], themes: [], perspectives: [], franchise: null, japanese: null, released: '2020-01-01', gameType: 'Main Game', rating: 90, ratingCount: 500 });
  g.db
    .insert(pcCandidates)
    .values(
      [
        [1, 'Hades', 1145360],
        [2, 'Disco Elysium', null],
        [3, 'Unknown Indie', null],
      ].map(([id, title, steam]) => ({ igdbId: id as number, familyKey: pcFamilyKey(title as string), title: title as string, game: game(id as number, title as string), steamAppId: steam as number | null, sources: '["Genre: RPG"]', foundAt: now, seenAt: now })),
    )
    .run();
  g.pcWishlist.invalidate();
}

const HADES = pcFamilyKey('Hades');

describe('PC game prices', () => {
  it("reads the PC wishlist's best prices and lowest ever, and tells about a drop once", async () => {
    const { sent, transports } = fakeTransports();
    const prices = {
      'id-hades': { deals: [deal('GOG', 1249, 2499), deal('Steam', 999, 2499)], low: 999 },
      'id-disco': { deals: [deal('Steam', 3999, 3999)], low: 999 },
    };
    const itad = fakeItad(prices);
    const started = Date.now();
    const timings: string[] = [];
    const mark = (what: string) => timings.push(`${what} ${Date.now() - started}ms`);
    g = await testApp({ features: ['pc', 'itad'], itadFetch: itad.fetch, transports });
    mark('app');
    cookies = await setUp(g);
    g.settings.update({ 'sources.itadKey': 'itad-key', 'notifications.pushoverEnabled': true, 'notifications.pushoverToken': 'app-token', 'notifications.pushoverUser': 'user-key' });
    seedPcWishlist();
    mark('seeded');
    const first = await g.pcPrices.refresh();
    mark('first refresh');
    expect(first).toBe('Prices for 2 of 3 games (1 not on IsThereAnyDeal); 1 price drop(s) told');
    // Hades by its Steam app id, the others by title; prices for the two it knows, in one request.
    expect(itad.calls).toEqual(expect.arrayContaining(['GET /games/lookup/v1?appid=1145360', 'GET /games/lookup/v1?title=Disco Elysium', 'GET /games/lookup/v1?title=Unknown Indie', 'POST /games/prices/v3?country=US']));
    expect(sent.push).toHaveLength(1);
    expect(sent.push[0]!.message).toBe('A game on your PC wishlist is on sale: Hades: 9.99 USD at Steam (60% off, its lowest ever).');
    const list = (await g.app.inject({ url: '/api/v1/pc/wishlist', cookies })).json();
    mark('list');
    expect(list.pricesOn).toBe(true);
    const price = (title: string) => list.items.find((i: { title: string }) => i.title === title).price;
    expect(price('Hades')).toMatchObject({ currentCents: 999, regularCents: 2499, cut: 60, shop: 'Steam', lowCents: 999, currency: 'USD', atLow: true, missing: false });
    expect(price('Disco Elysium')).toMatchObject({ currentCents: 3999, cut: 0, atLow: false });
    expect(price('Unknown Indie')).toMatchObject({ missing: true, currentCents: null });
    const csv = (await g.app.inject({ url: '/api/v1/pc/wishlist/export', cookies })).body;
    expect(csv.split(/\r?\n/)[0]).toMatch(/,Best price now,Lowest ever,Store$/);
    // Read again: the same price isn't told twice, and the unknown game isn't looked up again for a month.
    const before = itad.calls.length;
    await g.pcPrices.refresh();
    mark('refresh 2');
    expect(sent.push).toHaveLength(1);
    expect(itad.calls.slice(before)).toEqual(['POST /games/prices/v3?country=US']);
    // Up again, then down to its lowest: told again.
    prices['id-hades'].deals = [deal('Steam', 1499, 2499)];
    await g.pcPrices.refresh();
    mark('refresh 3');
    expect(sent.push).toHaveLength(1);
    prices['id-hades'].deals = [deal('Steam', 999, 2499)];
    await g.pcPrices.refresh();
    mark('refresh 4');
    expect(sent.push).toHaveLength(2);
    // A discount rule tells about Disco Elysium once it's half off, and "never" tells nothing.
    g.settings.update({ 'pc.priceAlertRule': 'cut', 'pc.priceAlertCut': 50 });
    prices['id-disco'].deals = [deal('Humble', 1999, 3999)];
    await g.pcPrices.refresh();
    mark('refresh 5');
    expect(sent.push.at(-1)!.message).toMatch(/Disco Elysium: 19.99 USD at Humble \(50% off\)/);
    g.settings.update({ 'pc.priceAlertRule': 'off' });
    prices['id-disco'].deals = [deal('Humble', 999, 3999)];
    const count = sent.push.length;
    await g.pcPrices.refresh();
    mark('refresh 6');
    expect(sent.push).toHaveLength(count);
    expect(g.pcPrices.prices().get(HADES)).toMatchObject({ currentCents: 999 });
    mark('done');
    // Where the time goes, when it's slow (CI once took 12 seconds here).
    if (Date.now() - started > 2000) console.log(`PC price test timings: ${timings.join(', ')}`);
  }, 30_000);

  it('needs the part on and a key, says when IsThereAnyDeal refuses, and has a button to read prices now', async () => {
    const itad = fakeItad({});
    g = await testApp({ features: ['pc'], itadFetch: itad.fetch });
    cookies = await setUp(g);
    seedPcWishlist();
    expect(await g.pcPrices.refresh()).toBe('PC game prices are off (Settings > Features).');
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/pc/prices/refresh', cookies })).json()).toMatchObject({ error: 'feature-off', message: 'PC game prices is off (Settings > Features).' });
    expect((await g.app.inject({ url: '/api/v1/pc/wishlist', cookies })).json().pricesOn).toBe(false);
    g.settings.update({ 'features.itad': true });
    expect(await g.pcPrices.refresh()).toBe("IsThereAnyDeal's API key is needed (Settings > Sources > IsThereAnyDeal).");
    // The Test button under the key says what's wrong, and when it works.
    const test = async () => (await g.app.inject({ method: 'POST', url: '/api/v1/pc/prices/test', cookies })).json();
    expect(await test()).toEqual({ ok: false, message: "Enter IsThereAnyDeal's API key first (and save it)." });
    g.settings.update({ 'sources.itadKey': 'wrong-key' });
    await expect(g.pcPrices.refresh()).rejects.toThrow("IsThereAnyDeal didn't accept the API key (Settings > Sources > IsThereAnyDeal).");
    expect(await test()).toEqual({ ok: false, message: "IsThereAnyDeal didn't accept the API key (Settings > Sources > IsThereAnyDeal)." });
    g.settings.update({ 'sources.itadKey': 'itad-key' });
    expect(await test()).toEqual({ ok: true, message: 'IsThereAnyDeal accepted the key.' });
    expect(itad.calls.at(-1)).toBe('GET /games/lookup/v1?appid=620');
    g.settings.update({ 'sources.itadKey': 'wrong-key' });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/pc/prices/refresh', cookies })).statusCode).toBe(202);
    // The PC library off turns its prices off too.
    g.settings.update({ 'features.pc': false });
    expect(await g.pcPrices.refresh()).toBe('PC game prices are off (Settings > Features).');
  });

  it('names ten games on sale in a message and counts the rest', () => {
    const told = Array.from({ length: 13 }, (_, i) => `Game ${i + 1}: 9.99 USD at Steam (50% off)`);
    const message = saleMessage(told);
    expect(message).toMatch(/^13 games on your PC wishlist are on sale: Game 1: .*; Game 10: 9\.99 USD at Steam \(50% off\); and 3 more on the PC wishlist\.$/);
    expect(message).not.toContain('Game 11');
    expect(saleMessage(told.slice(0, 2))).toBe('2 games on your PC wishlist are on sale: Game 1: 9.99 USD at Steam (50% off); Game 2: 9.99 USD at Steam (50% off).');
  });

  it('picks the lowest price among the deals', () => {
    expect(bestDeal({ id: 'x', historyLow: null, deals: [] })).toEqual({ currentCents: null, regularCents: null, cut: null, shop: null, url: null, lowCents: null, currency: null });
    expect(bestDeal({ id: 'x', historyLow: { all: amount(500) }, deals: [deal('A', 900, 1000), deal('B', 700, 1000)] })).toMatchObject({ currentCents: 700, shop: 'B', cut: 30, lowCents: 500 });
  });
});

describe('the PC deals email', () => {
  it("shows each game as a row with its badges and its deal, in Squirrelcade's look", () => {
    const html = emailLayout(
      saleHtml([{ title: 'Hades & Co', price: '9.99 USD', shop: 'Steam', cut: 60, lowest: true, url: 'https://deals.example.test/hades?a=1&b=2', image: 'https://images.igdb.com/igdb/image/upload/t_cover_small/co1abc.jpg' }]),
      'https://squirrelcade.example.test/pc/wishlist',
    );
    expect(html).toContain('A game on your PC wishlist is on sale:');
    expect(html).toContain('Hades &amp; Co');
    expect(html).toContain('9.99 USD at Steam');
    expect(html).toContain('60% off');
    expect(html).toContain('Lowest ever');
    expect(html).toContain('href="https://deals.example.test/hades?a=1&amp;b=2"');
    expect(html).toContain('<img src="https://images.igdb.com/igdb/image/upload/t_cover_small/co1abc.jpg" width="45" height="64"');
    expect(html).toContain('<span style="color:#ee8a2c">squirrel</span>');
    expect(html).toContain('href="https://squirrelcade.example.test/pc/wishlist"');
    // Past the first ten, the rest are counted.
    const many = saleHtml(Array.from({ length: 12 }, (_, i) => ({ title: `Game ${i}`, price: '1.00 USD', shop: 'GOG', cut: 50, lowest: false, url: null })));
    expect(many).toContain('12 games on your PC wishlist are on sale:');
    expect(many).toContain('And 2 more on the PC wishlist.');
    expect(many).not.toContain('Lowest ever');
    // A game without box art keeps its place in the row, with nothing in it.
    expect(many).not.toContain('<img');
  });
});
