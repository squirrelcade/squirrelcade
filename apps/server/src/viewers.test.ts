import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

const HEADER = 'id,product-name,console-name,price-in-pennies,include-string,condition-string,sku,notes,cost-basis-in-pennies,quantity,date-entered,date-purchased,grading-company,grading-cert-id,folder';
/** Seven PS3 games, each worth $10.00 and bought for $5.00. */
const COLLECTION = [HEADER, ...['Uncharted', 'Okami', 'Flower', 'Journey', 'Rain', 'Puppeteer', 'Tearaway'].map((t, i) => `${i + 1},"${t}",Playstation 3,1000,"Item, Box, and Manual",,,,500,1,2026-09-01,2026-09-01,,,`)].join('\n');

type Cookies = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ squirrelcade_session: res.cookies.find((c) => c.name === 'squirrelcade_session')!.value });

/** An owner, their seven-game collection with a PS3 catalog, and a viewer who joined through an invite link. */
async function ownerAndViewer(): Promise<{ owner: Cookies; viewer: Cookies; viewerId: number }> {
  const owner = await setUp(g);
  g.collection.importText(COLLECTION, { source: 'upload', fileName: 'collection_20260927.csv' });
  seedCatalogs(g, { owned: [], catalogs: { 'playstation-3': ['Uncharted', 'Okami', "Demon's Souls"] } });
  const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Mom' }, cookies: owner });
  const joined = await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'mom', password: 'kitchen table' } });
  const users = (await g.app.inject({ url: '/api/v1/users', cookies: owner })).json().users as { id: number; username: string }[];
  return { owner, viewer: cookieOf(joined), viewerId: users.find((u) => u.username === 'mom')!.id };
}

describe('viewers', () => {
  it('joins through an invite link that works once, and signs in as a viewer', async () => {
    g = await testApp();
    const owner = await setUp(g);
    expect((await g.app.inject({ url: '/api/v1/auth/session', cookies: owner })).json()).toMatchObject({ role: 'owner', publicCheck: 'off' });
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Mom' }, cookies: owner });
    expect(invite.statusCode).toBe(201);
    const path = `/api/v1${invite.json().path}`;
    // Anyone with the link sees whom it's for; a short password is refused.
    expect((await g.app.inject({ url: path })).json()).toMatchObject({ name: 'Mom', username: null });
    expect((await g.app.inject({ method: 'POST', url: path, payload: { username: 'mom', password: 'short' } })).statusCode).toBe(400);
    const joined = await g.app.inject({ method: 'POST', url: path, payload: { username: 'mom', password: 'kitchen table' } });
    expect(joined.statusCode).toBe(201);
    expect((await g.app.inject({ url: '/api/v1/auth/session', cookies: cookieOf(joined) })).json()).toMatchObject({ username: 'mom', role: 'viewer' });
    // Used once, it's gone; the owner's list of open links is empty again.
    expect((await g.app.inject({ url: path })).statusCode).toBe(404);
    expect((await g.app.inject({ method: 'POST', url: path, payload: { username: 'dad', password: 'kitchen table' } })).statusCode).toBe(404);
    expect((await g.app.inject({ url: '/api/v1/users', cookies: owner })).json().invites).toEqual([]);
    // A second link can't take a username that's used; an expired one doesn't work.
    const second = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: {}, cookies: owner });
    expect((await g.app.inject({ method: 'POST', url: `/api/v1${second.json().path}`, payload: { username: 'mom', password: 'kitchen table' } })).statusCode).toBe(409);
    g.db.$client.prepare("update invites set expires_at = '2000-01-01T00:00:00.000Z'").run();
    expect((await g.app.inject({ url: `/api/v1${second.json().path}` })).statusCode).toBe(404);
    // A link the owner takes back stops working at once.
    const third = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Dad' }, cookies: owner });
    const open = (await g.app.inject({ url: '/api/v1/users', cookies: owner })).json().invites as { id: number; name: string | null }[];
    const dad = open.find((i) => i.name === 'Dad')!;
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/invites/${dad.id}`, cookies: owner })).json()).toEqual({ removed: true });
    expect((await g.app.inject({ url: `/api/v1${third.json().path}` })).statusCode).toBe(404);
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/invites/${dad.id}`, cookies: owner })).json()).toEqual({ removed: false });
  });

  it('lets a viewer look at the collection and change nothing', async () => {
    g = await testApp({ features: ['pc'] });
    const { owner, viewer } = await ownerAndViewer();
    for (const url of ['/api/v1/collection/summary', '/api/v1/collection/items', '/api/v1/wishlist', '/api/v1/platforms', '/api/v1/catalogs/playstation-3', '/api/v1/lookup?q=okami', '/api/v1/game?platform=playstation-3&title=Okami', '/api/v1/sets', '/api/v1/series', '/api/v1/pc']) {
      expect([url, (await g.app.inject({ url, cookies: viewer })).statusCode]).toEqual([url, 200]);
    }
    for (const url of ['/api/v1/system/status', '/api/v1/system/support', '/api/v1/system/logs', '/api/v1/backups', '/api/v1/review', '/api/v1/imports', '/api/v1/tasks', '/api/v1/users', '/api/v1/auth/apikey', '/api/v1/stats', '/api/v1/settings/export', '/api/v1/collection/spending']) {
      expect([url, (await g.app.inject({ url, cookies: viewer })).statusCode]).toEqual([url, 403]);
    }
    const changes: [string, string, unknown][] = [
      ['PUT', '/api/v1/settings', { changes: { 'general.currency': 'EUR' } }],
      ['POST', '/api/v1/purchases', { entryId: 1 }],
      ['PUT', '/api/v1/game/note', { platformKey: 'playstation-3', title: 'Okami', note: 'x' }],
      ['PUT', '/api/v1/wishlist/preferences', { platformKey: 'playstation-3', title: 'Okami', preference: null }],
      ['POST', '/api/v1/invites', {}],
      ['POST', '/api/v1/backups', {}],
      ['POST', '/api/v1/sets', { name: 'Mine' }],
    ];
    for (const [method, url, payload] of changes) {
      const res = await g.app.inject({ method: method as 'PUT', url, payload: payload as object, cookies: viewer });
      expect([method, url, res.statusCode]).toEqual([method, url, 403]);
    }
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/settings', payload: { changes: { 'general.currency': 'EUR' } }, cookies: viewer })).json().error).toBe('owner-only');
    // A viewer's settings are what their pages need: no sign-in, storage or notification settings.
    const values = (await g.app.inject({ url: '/api/v1/settings', cookies: viewer })).json().values as Record<string, unknown>;
    expect(values['general.currency']).toBe('USD');
    expect(values['interface.shopLinks']).toBeDefined();
    expect(values['security.authMethod']).toBeUndefined();
    expect(values['notifications.emailTo']).toBeUndefined();
    expect(values['storage.backupRetention']).toBeUndefined();
    // Their own account is theirs: a new password, a question about ownership, signing out.
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/auth/password', payload: { currentPassword: 'kitchen table', newPassword: 'kitchen chair' }, cookies: viewer })).statusCode).toBe(200);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/owned', payload: { games: [{ title: 'Okami' }] }, cookies: viewer })).json().results[0].owned).toBe(true);
    // The owner still does anything.
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/settings', payload: { changes: { 'general.instanceName': 'Our games' } }, cookies: owner })).statusCode).toBe(200);
  });

  it("keeps the owner's prices paid, notes, RomM links and (a setting) PC library from viewers unless shared", async () => {
    g = await testApp();
    const { owner, viewer } = await ownerAndViewer();
    await g.app.inject({ method: 'PUT', url: '/api/v1/game/note', payload: { platformKey: 'playstation-3', title: 'Okami', note: 'The one with the art book' }, cookies: owner });
    const items = async (who: Cookies) => (await g.app.inject({ url: '/api/v1/collection/items', cookies: who })).json().items as { title: string; costCents: number | null }[];
    const game = async (who: Cookies) => (await g.app.inject({ url: '/api/v1/game?platform=playstation-3&title=Okami', cookies: who })).json();
    expect((await items(owner))[0]!.costCents).toBe(500);
    expect((await items(viewer))[0]!.costCents).toBeNull();
    expect((await g.app.inject({ url: '/api/v1/collection/summary', cookies: viewer })).json().totals.costCents).toBe(0);
    expect(await game(owner)).toMatchObject({ note: { text: 'The one with the art book' }, copies: [{ costCents: 500 }] });
    expect(await game(viewer)).toMatchObject({ note: null, copies: [{ costCents: null }], romm: null });
    expect((await g.app.inject({ url: '/api/v1/game/notes', cookies: viewer })).json()).toEqual([]);
    expect((await g.app.inject({ url: '/api/v1/lookup?q=okami', cookies: viewer })).json()[0].note).toBeNull();
    const csv = (await g.app.inject({ url: '/api/v1/collection/export', cookies: viewer })).body;
    expect(csv).not.toContain('5.00');
    expect(csv).toContain('10.00');
    // Shared: prices paid and spending, notes; and the PC library can be kept from them.
    g.settings.update({ 'security.viewersSeePaid': true, 'security.viewersSeeNotes': true, 'security.viewersSeePc': false });
    expect((await items(viewer))[0]!.costCents).toBe(500);
    expect((await game(viewer)).note).toMatchObject({ text: 'The one with the art book' });
    expect((await g.app.inject({ url: '/api/v1/collection/spending', cookies: viewer })).statusCode).toBe(200);
    expect((await g.app.inject({ url: '/api/v1/pc', cookies: viewer })).statusCode).toBe(403);
  });

  it('hands the collection to another account, and a link lets someone choose a new password', async () => {
    g = await testApp();
    const { owner, viewer, viewerId } = await ownerAndViewer();
    // The owner's own account can't be removed.
    const ownerId = ((await g.app.inject({ url: '/api/v1/users', cookies: owner })).json().users as { id: number; role: string }[]).find((u) => u.role === 'owner')!.id;
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/users/${ownerId}`, cookies: owner })).statusCode).toBe(400);
    // A new-password link for the viewer: using it signs out their other sessions.
    const link = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { userId: viewerId }, cookies: owner });
    expect((await g.app.inject({ url: `/api/v1${link.json().path}` })).json()).toMatchObject({ username: 'mom' });
    expect((await g.app.inject({ method: 'POST', url: `/api/v1${link.json().path}`, payload: { password: 'garden chair' } })).statusCode).toBe(201);
    expect((await g.app.inject({ url: '/api/v1/auth/session', cookies: viewer })).json().authenticated).toBe(false);
    const again = await g.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'mom', password: 'garden chair' } });
    expect(again.statusCode).toBe(200);
    // Handing over: she's the owner now, and the one who was is a viewer.
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/users/${viewerId}/owner`, cookies: owner })).statusCode).toBe(200);
    expect((await g.app.inject({ url: '/api/v1/auth/session', cookies: cookieOf(again) })).json().role).toBe('owner');
    expect((await g.app.inject({ url: '/api/v1/auth/session', cookies: owner })).json().role).toBe('viewer');
    expect((await g.app.inject({ url: '/api/v1/users', cookies: owner })).statusCode).toBe(403);
    // Now she can remove the old owner's account, a viewer's.
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/users/${ownerId}`, cookies: cookieOf(again) })).statusCode).toBe(200);
  });

  it('answers a game check without signing in when turned on: have it or need it, and nothing private', async () => {
    g = await testApp();
    const { owner } = await ownerAndViewer();
    await g.app.inject({ method: 'PUT', url: '/api/v1/game/note', payload: { platformKey: 'playstation-3', title: 'Okami', note: 'Private' }, cookies: owner });
    // Off by default.
    expect((await g.app.inject({ url: '/api/v1/check?q=okami' })).statusCode).toBe(404);
    g.settings.update({ 'security.publicCheck': 'phones' });
    expect((await g.app.inject({ url: '/api/v1/auth/session' })).json()).toMatchObject({ authenticated: false, publicCheck: 'phones' });
    const okami = (await g.app.inject({ url: '/api/v1/check?q=okami' })).json();
    expect(okami.results[0]).toEqual({ platformKey: 'playstation-3', platform: 'PlayStation 3', title: 'Okami', answer: 'own', ownedOn: [], coverId: null, valueCents: null, wishlist: null, links: [] });
    const souls = (await g.app.inject({ url: `/api/v1/check?q=${encodeURIComponent("demon's souls")}` })).json().results[0];
    expect(souls).toMatchObject({ title: "Demon's Souls", answer: 'need', wishlist: { priority: expect.any(String) } });
    expect(souls.links.map((l: { name: string }) => l.name)).toEqual(['PriceCharting', 'eBay', 'Mercari', 'FB Marketplace']);
    expect(JSON.stringify(okami)).not.toContain('Private');
    // What the copy is worth, when that's shown; a saved barcode answers too.
    g.settings.update({ 'security.publicCheckValue': true });
    expect((await g.app.inject({ url: '/api/v1/check?q=okami' })).json().results[0].valueCents).toBe(1000);
    await g.app.inject({ method: 'POST', url: '/api/v1/barcodes', payload: { code: '711719541028', platformKey: 'playstation-3', title: 'Okami' }, cookies: owner });
    expect((await g.app.inject({ url: '/api/v1/check?barcode=711719541028' })).json().results[0]).toMatchObject({ title: 'Okami', answer: 'own' });
    // No more than the limit from one address: four checks so far, so the fifth is the last.
    g.settings.update({ 'security.publicCheckLimit': 5 });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await g.app.inject({ url: '/api/v1/check?q=okami' })).statusCode);
    expect(codes).toEqual([200, 429, 429]);
  });
});
