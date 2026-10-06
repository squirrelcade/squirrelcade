import { afterEach, describe, expect, it } from 'vitest';
import { exportCsv, fakeTransports, multipartForm, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

type Cookies = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ squirrelcade_session: res.cookies.find((c) => c.name === 'squirrelcade_session')!.value });

const CIB = 'Item, Box, and Manual';
const LOOSE = 'Item Only';
/** Okami twice (complete and loose), Journey, and Flower. */
const COLLECTION = exportCsv([
  ['1', 'Okami', 'Playstation 2', 3000, CIB],
  ['1', 'Okami', 'Playstation 2', 1200, LOOSE],
  ['2', 'Journey', 'Playstation 3', 1500, CIB],
  ['3', 'Flower', 'Playstation 3', 900, CIB],
]);
// Each copy's key, as the pages get it from the collection.
let OKAMI_CIB = '';
let OKAMI_LOOSE = '';
let JOURNEY = '';

async function collection(options: Parameters<typeof testApp>[0] = {}) {
  g = await testApp(options);
  cookies = await setUp(g);
  g.collection.importText(COLLECTION, { source: 'upload', fileName: 'collection_20260927.csv' });
  const keyOf = (title: string, includeString: string) => g.collection.items({ all: true }).items.find((i) => i.title === title && i.includeString === includeString)!.key;
  OKAMI_CIB = keyOf('Okami', CIB);
  OKAMI_LOOSE = keyOf('Okami', LOOSE);
  JOURNEY = keyOf('Journey', CIB);
}

const setCopy = (payload: Record<string, unknown>, who = cookies) => g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies: who, payload });
const titles = async (query: string) => ((await g.app.inject({ url: `/api/v1/collection/items${query}`, cookies })).json().items as { title: string; completeness: string }[]).map((i) => `${i.title} (${i.completeness})`);

/** The smallest PNG: its signature and some bytes. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);
const photo = (key: string, content = PNG, type = 'image/png', caption = 'Front') =>
  g.app.inject({ method: 'POST', url: '/api/v1/photos', cookies, ...multipartForm({ key, caption }, { name: 'photo.png', content, type }) });

describe("copies' details", () => {
  it('keeps where each copy is, its tags and whether it is for sale, and filters the collection by them', async () => {
    await collection();
    const saved = await setCopy({ key: OKAMI_CIB, location: '  Shelf   A ', tags: ['Favorite', 'favorite', ' signed '] });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().details).toEqual({ location: 'Shelf A', tags: ['Favorite', 'signed'], sale: null, askingCents: null, saleNote: null, digitalClaim: null, digitalClaimedAt: null, digitalStore: null });
    await setCopy({ key: OKAMI_LOOSE, location: 'Shelf A', sale: 'trade', saleNote: 'Disc is clean' });
    await setCopy({ key: JOURNEY, tags: ['Favorite'], sale: 'sale', askingCents: 2500 });
    // What's given changes; the rest stays.
    expect((await setCopy({ key: OKAMI_CIB, tags: ['Favorite'] })).json().details).toMatchObject({ location: 'Shelf A', tags: ['Favorite'] });
    expect((await g.app.inject({ url: `/api/v1/copy?key=${encodeURIComponent(OKAMI_CIB)}`, cookies })).json()).toMatchObject({ details: { location: 'Shelf A' }, loans: [], photos: [] });
    expect((await g.app.inject({ url: '/api/v1/tags', cookies })).json()).toEqual({
      tags: [{ name: 'Favorite', copies: 2 }],
      locations: [{ name: 'Shelf A', copies: 2 }],
    });
    expect(await titles('?location=shelf%20a')).toEqual(['Okami (complete)', 'Okami (loose)']);
    expect(await titles('?tag=FAVORITE')).toEqual(['Journey (complete)', 'Okami (complete)']);
    expect(await titles('?sale=any')).toEqual(['Journey (complete)', 'Okami (loose)']);
    expect(await titles('?sale=trade')).toEqual(['Okami (loose)']);
    const row = ((await g.app.inject({ url: '/api/v1/collection/items?q=Journey', cookies })).json().items as { copyKey: string; details: unknown }[])[0]!;
    expect(row).toMatchObject({ copyKey: JOURNEY, details: { location: null, tags: ['Favorite'], sale: 'sale', lentTo: [], photos: 0 } });
    // Taking the sale off drops its price and note; with nothing left, nothing is kept.
    expect((await setCopy({ key: OKAMI_LOOSE, sale: null })).json().details).toEqual({ location: 'Shelf A', tags: [], sale: null, askingCents: null, saleNote: null, digitalClaim: null, digitalClaimedAt: null, digitalStore: null });
    await setCopy({ key: OKAMI_LOOSE, location: '' });
    expect((await g.app.inject({ url: '/api/v1/tags', cookies })).json().locations).toEqual([{ name: 'Shelf A', copies: 1 }]);
    // What isn't valid is refused.
    for (const bad of [{ tags: 'Favorite' }, { tags: ['x'.repeat(31)] }, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) }, { sale: 'gift' }, { sale: 'sale', askingCents: -1 }, { location: 'x'.repeat(81) }]) {
      expect((await setCopy({ key: JOURNEY, ...bad })).statusCode).toBe(400);
    }
    expect((await setCopy({ key: '9|Loose', location: 'Shelf B' })).json()).toMatchObject({ message: "That copy isn't in your collection." });
    expect((await setCopy({ location: 'Shelf B' })).statusCode).toBe(400);
  });

  it('lends copies, gives them back, keeps the history and reminds once when one is overdue', async () => {
    const { sent, transports } = fakeTransports();
    await collection({ transports });
    g.settings.update({ 'notifications.pushoverEnabled': true, 'notifications.pushoverToken': 'app-token', 'notifications.pushoverUser': 'user-key' });
    const lent = await g.app.inject({ method: 'POST', url: '/api/v1/loans', cookies, payload: { key: JOURNEY, lentTo: 'Alex', lentAt: '2026-01-01' } });
    expect(lent.statusCode).toBe(201);
    // Due back after Settings > Collection > Lend for (30 days).
    expect(lent.json()).toMatchObject({ title: 'Journey', platform: 'PlayStation 3', lentTo: 'Alex', lentAt: '2026-01-01', dueAt: '2026-01-31', returnedAt: null, overdue: true });
    const other = (await g.app.inject({ method: 'POST', url: '/api/v1/loans', cookies, payload: { key: OKAMI_CIB, lentTo: 'Kim', dueAt: null, note: 'With the case' } })).json();
    expect(other).toMatchObject({ dueAt: null, overdue: false, note: 'With the case' });
    expect(await titles('?lent=1')).toEqual(['Journey (complete)', 'Okami (complete)']);
    expect(((await g.app.inject({ url: '/api/v1/collection/items?q=Journey', cookies })).json().items[0].details as { lentTo: string[] }).lentTo).toEqual(['Alex']);
    // The overdue one first; one reminder for it, then no more.
    const loans = (await g.app.inject({ url: '/api/v1/loans', cookies })).json();
    expect(loans.open.map((l: { lentTo: string }) => l.lentTo)).toEqual(['Alex', 'Kim']);
    expect(await g.details.remindOverdue()).toBe('Reminded about 1 overdue game(s)');
    expect(sent.push[0]!.message).toMatch(/^A game you lent is overdue: Journey \(PlayStation 3\), lent to Alex on 2026-01-01, due back 2026-01-31\.$/);
    expect(await g.details.remindOverdue()).toBe('No lent game is overdue');
    // A new due day can be reminded about again; turned off, nothing is sent.
    expect((await g.app.inject({ method: 'PUT', url: `/api/v1/loans/${lent.json().id}`, cookies, payload: { dueAt: '2026-02-15' } })).json()).toMatchObject({ dueAt: '2026-02-15' });
    g.settings.update({ 'notifications.loanReminders': false });
    expect(await g.details.remindOverdue()).toBe('Loan reminders are off');
    // Given back: out of the open loans, into the history; the copy is no longer lent.
    const back = await g.app.inject({ method: 'POST', url: `/api/v1/loans/${lent.json().id}/return`, cookies, payload: { day: '2026-02-10' } });
    expect(back.json()).toMatchObject({ returnedAt: '2026-02-10', overdue: false });
    const after = (await g.app.inject({ url: '/api/v1/loans', cookies })).json();
    expect(after.open.map((l: { lentTo: string }) => l.lentTo)).toEqual(['Kim']);
    expect(after.returned.map((l: { lentTo: string }) => l.lentTo)).toEqual(['Alex']);
    expect(await titles('?lent=1')).toEqual(['Okami (complete)']);
    // Mistakes can be fixed or removed.
    expect((await g.app.inject({ method: 'PUT', url: `/api/v1/loans/${lent.json().id}`, cookies, payload: { returnedAt: null } })).json()).toMatchObject({ returnedAt: null });
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/loans/${other.id}`, cookies })).json()).toEqual({ removed: true });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/loans/999/return', cookies })).statusCode).toBe(404);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/loans', cookies, payload: { key: JOURNEY } })).statusCode).toBe(400);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/loans', cookies, payload: { key: JOURNEY, lentTo: 'Kim', lentAt: '2026-03-01', dueAt: '2026-02-01' } })).statusCode).toBe(400);
    expect((await g.app.inject({ method: 'PUT', url: `/api/v1/loans/${lent.json().id}`, cookies, payload: { dueAt: 'soon' } })).statusCode).toBe(400);
  });

  it('keeps photos of a copy, up to the setting, and serves them for the browser to keep', async () => {
    await collection();
    const added = await photo(JOURNEY);
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({ caption: 'Front', mime: 'image/png', bytes: PNG.length });
    const got = await g.app.inject({ url: `/api/v1/photos/${added.json().id}`, cookies });
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(got.rawPayload.equals(PNG)).toBe(true);
    expect((await g.app.inject({ method: 'PUT', url: `/api/v1/photos/${added.json().id}`, cookies, payload: { caption: 'Back' } })).json()).toEqual({ ok: true });
    expect((await g.app.inject({ url: `/api/v1/copy?key=${encodeURIComponent(JOURNEY)}`, cookies })).json().photos).toMatchObject([{ caption: 'Back' }]);
    // Not an image, an image that isn't what it says, a copy that isn't owned, and one photo too many.
    expect((await photo(JOURNEY, Buffer.from('hello'), 'text/plain')).statusCode).toBe(400);
    expect((await photo(JOURNEY, PNG, 'image/jpeg')).statusCode).toBe(400);
    expect((await photo('9|Loose')).statusCode).toBe(400);
    g.settings.update({ 'collection.photosPerCopy': 1 });
    expect((await photo(JOURNEY)).json().message).toMatch(/can have 1 photos/);
    expect(((await g.app.inject({ url: '/api/v1/collection/items?q=Journey', cookies })).json().items[0].details as { photos: number }).photos).toBe(1);
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/photos/${added.json().id}`, cookies })).json()).toEqual({ removed: true });
    expect((await g.app.inject({ url: `/api/v1/photos/${added.json().id}`, cookies })).statusCode).toBe(404);
  });

  it('lists the games for sale with a download, and the games owned more than once', async () => {
    await collection();
    await setCopy({ key: OKAMI_LOOSE, sale: 'sale', askingCents: 1500, saleNote: 'Disc only' });
    const sale = (await g.app.inject({ url: '/api/v1/sale', cookies })).json();
    expect(sale.items).toMatchObject([{ title: 'Okami', platform: 'PlayStation 2', condition: 'Loose', quantity: 1, sale: 'sale', askingCents: 1500, saleNote: 'Disc only', valueCents: 1200 }]);
    expect(sale.duplicates).toMatchObject([{ title: 'Okami', copies: 2, items: [{ condition: 'Complete in box', sale: null }, { condition: 'Loose', sale: 'sale' }] }]);
    const csv = (await g.app.inject({ url: '/api/v1/sale/export', cookies })).body.trim().split(/\r?\n/);
    expect(csv).toEqual(['Title,Console,Condition,Copies,Sale or trade,Asking (USD),Value each (USD),Note', 'Okami,PlayStation 2,Loose,1,sale,15.00,12.00,Disc only']);
  });

  it("keeps copies' details from viewers unless the owner shares them", async () => {
    await collection();
    await setCopy({ key: JOURNEY, location: 'Shelf A' });
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Sam' }, cookies });
    const viewer = cookieOf(await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } }));
    for (const url of ['/api/v1/tags', '/api/v1/loans', '/api/v1/sale', `/api/v1/copy?key=${encodeURIComponent(JOURNEY)}`]) {
      expect((await g.app.inject({ url, cookies: viewer })).statusCode).toBe(403);
    }
    expect((await g.app.inject({ url: '/api/v1/collection/items?q=Journey', cookies: viewer })).json().items[0].details).toBeNull();
    expect((await g.app.inject({ url: '/api/v1/game?platform=playstation-3&title=Journey', cookies: viewer })).json().copies[0]).toMatchObject({ details: null, loans: [], photos: [] });
    g.settings.update({ 'security.viewersSeeCopyDetails': true });
    expect((await g.app.inject({ url: `/api/v1/copy?key=${encodeURIComponent(JOURNEY)}`, cookies: viewer })).json().details.location).toBe('Shelf A');
    expect((await g.app.inject({ url: '/api/v1/game?platform=playstation-3&title=Journey', cookies: viewer })).json().copies[0].details.location).toBe('Shelf A');
    // They still change nothing.
    expect((await setCopy({ key: JOURNEY, location: 'Shelf B' }, viewer)).statusCode).toBe(403);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/loans', cookies: viewer, payload: { key: JOURNEY, lentTo: 'Sam' } })).statusCode).toBe(403);
  });
});
