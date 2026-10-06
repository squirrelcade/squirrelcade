import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

type Cookies = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ squirrelcade_session: res.cookies.find((c) => c.name === 'squirrelcade_session')!.value });

/** Two PS3 games owned and three missing from the catalog, so the wishlist has games. */
async function wishlist() {
  g = await testApp();
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [
      ['1', 'Uncharted', 'Playstation 3'],
      ['2', 'Journey', 'Playstation 3'],
    ],
    catalogs: { 'playstation-3': ['Uncharted', 'Journey', 'Flower', 'Puppeteer', 'Tearaway Unfolded'] },
  });
  g.settings.update({ 'interface.shopLinks': ['eBay | https://www.ebay.com/sch/i.html?_nkw={title}+{platform}'] });
}

const make = async (payload: Record<string, unknown>, who = cookies) => g.app.inject({ method: 'POST', url: '/api/v1/shares', cookies: who, payload });

describe('share links', () => {
  it("opens the wishlist's top picks to anyone with the link, with where to buy them, and counts the visits", async () => {
    await wishlist();
    const made = await make({ kind: 'wishlist', name: '  Birthday  ' });
    expect(made.statusCode).toBe(201);
    const link = made.json();
    expect(link).toMatchObject({ kind: 'wishlist', name: 'Birthday', opens: 0, lastOpenedAt: null });
    expect(link.path).toMatch(/^\/share\/[A-Za-z0-9_-]{24}$/);
    // No sign-in: the token is the key.
    const page = await g.app.inject({ url: `/api/v1${link.path}` });
    expect(page.statusCode).toBe(200);
    const body = page.json();
    expect(body).toMatchObject({ kind: 'wishlist', name: 'Birthday', instanceName: 'Squirrelcade', currency: 'USD' });
    expect(body.wishes.map((w: { title: string }) => w.title).sort()).toEqual(['Flower', 'Puppeteer', 'Tearaway Unfolded']);
    expect(body.wishes[0]).toMatchObject({ rank: 1, platform: 'PlayStation 3' });
    expect(body.wishes[0].links.map((l: { name: string }) => l.name)).toEqual(['PriceCharting', 'eBay']);
    // Only the picks: nothing owned, nothing about the collection.
    expect(JSON.stringify(body)).not.toMatch(/Uncharted|valueCents|costCents|score/);
    // The size is a setting.
    g.settings.update({ 'wishlist.shareSize': 5 });
    g.wishlist.invalidate();
    expect((await g.app.inject({ url: `/api/v1${link.path}` })).json().wishes).toHaveLength(3);
    const listed = (await g.app.inject({ url: '/api/v1/shares', cookies })).json();
    expect(listed).toMatchObject([{ id: link.id, opens: 2 }]);
    expect(listed[0].lastOpenedAt).not.toBeNull();
    // Removed, it stops working; a made-up link never did.
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/shares/${link.id}`, cookies })).json()).toEqual({ removed: true });
    expect((await g.app.inject({ url: `/api/v1${link.path}` })).statusCode).toBe(404);
    expect((await g.app.inject({ url: '/api/v1/share/abcdefghijklmnopqrstuvwx' })).statusCode).toBe(404);
    expect((await g.app.inject({ url: '/api/v1/share/short' })).statusCode).toBe(401);
    expect((await make({ kind: 'collection' })).statusCode).toBe(400);
  });

  it('shows the games for sale or trade on a sale link, and only the owner makes links', async () => {
    await wishlist();
    await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key: g.collection.items({ q: 'Journey' }).items[0]!.key, sale: 'trade', saleNote: 'Mint' } });
    const link = (await make({ kind: 'sale' })).json();
    const page = (await g.app.inject({ url: `/api/v1${link.path}` })).json();
    expect(page).toMatchObject({ kind: 'sale', name: null, sales: [{ title: 'Journey', platform: 'PlayStation 3', condition: 'Complete in box', quantity: 1, kind: 'trade', askingCents: null, note: 'Mint' }] });
    expect(page.wishes).toBeUndefined();
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: {}, cookies });
    const viewer = cookieOf(await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } }));
    expect((await make({ kind: 'wishlist' }, viewer)).statusCode).toBe(403);
    expect((await g.app.inject({ url: '/api/v1/shares', cookies: viewer })).statusCode).toBe(403);
  });

  it('turns away an address that opens links too often (Settings > Security)', async () => {
    await wishlist();
    expect(g.settings.get('security.shareOpenLimit')).toBe(60);
    const link = (await make({ kind: 'wishlist' })).json();
    for (let i = 0; i < 60; i++) expect((await g.app.inject({ url: `/api/v1${link.path}`, remoteAddress: '203.0.113.9' })).statusCode).toBe(200);
    expect((await g.app.inject({ url: `/api/v1${link.path}`, remoteAddress: '203.0.113.9' })).statusCode).toBe(429);
    expect((await g.app.inject({ url: `/api/v1${link.path}`, remoteAddress: '203.0.113.10' })).statusCode).toBe(200);
  });
});
