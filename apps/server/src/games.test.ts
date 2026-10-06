import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

const game = async (platform: string, title: string) => (await g.app.inject({ url: `/api/v1/game?platform=${platform}&title=${encodeURIComponent(title)}`, cookies })).json();

describe('the game drawer', () => {
  it("brings together a game's catalog status, copies, other consoles, wishlist points and sets", async () => {
    seedCatalogs(g, {
      owned: [
        ...['Celeste', 'Cuphead', 'Gris', 'Tunic', 'Ori', 'Inside'].map((t, i): [string, string, string] => [String(i + 1), t, 'Nintendo Switch']),
        ['9', 'Hades', 'Playstation 4'],
      ],
      catalogs: { 'nintendo-switch': [{ title: 'Hades', evidence: 'list' }, { title: 'Celeste', evidence: 'list' }] },
    });

    const hades = await game('nintendo-switch', 'Hades');
    expect(hades).toMatchObject({ platform: 'Nintendo Switch', title: 'Hades', catalog: { status: 'missing', matches: [] }, copies: [], ownedOn: ['PlayStation 4'], sets: [] });
    // Missing and a candidate: the wishlist's points, every one explained.
    expect(hades.wishlist.components.length).toBeGreaterThan(0);
    expect(hades).toMatchObject({ preference: null, snoozedUntil: null });

    // What the drawer's buttons do shows up in it: "I bought it", a preference, a snooze, "Not a target".
    const entryId = hades.catalog.entryId;
    await g.app.inject({ method: 'POST', url: '/api/v1/purchases', payload: { entryId }, cookies });
    const bought = await game('nintendo-switch', 'Hades');
    expect(bought.catalog).toMatchObject({ status: 'owned', matches: [{ method: 'exact' }] });
    expect(bought.copies).toMatchObject([{ title: 'Hades', completeness: 'complete', source: 'squirrelcade', sentAt: null }]);
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/purchases/${bought.copies[0].id}`, cookies })).json()).toEqual({ removed: true });
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', payload: { platformKey: 'nintendo-switch', title: 'Hades', preference: 'Do Not Recommend', note: null }, cookies });
    expect(await game('nintendo-switch', 'Hades')).toMatchObject({ preference: 'Do Not Recommend' });
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', payload: { platformKey: 'nintendo-switch', title: 'Hades', preference: null, note: null }, cookies });
    expect(await game('nintendo-switch', 'Hades')).toMatchObject({ preference: null, wishlist: { score: expect.any(Number) } });
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/snooze', payload: { platformKey: 'nintendo-switch', title: 'Hades', until: '2999-01-01' }, cookies });
    expect(await game('nintendo-switch', 'Hades')).toMatchObject({ wishlist: null, snoozedUntil: '2999-01-01' });
    // Hidden from the wishlist: the drawer says why.
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/snooze', payload: { platformKey: 'nintendo-switch', title: 'Hades', until: null }, cookies });
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', payload: { platformKey: 'nintendo-switch', title: 'Hades', preference: 'Do Not Recommend', note: null }, cookies });
    expect(await game('nintendo-switch', 'Hades')).toMatchObject({ wishlist: null, wishlistNote: 'Your preference "Do Not Recommend" keeps it off the wishlist.' });
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', payload: { platformKey: 'nintendo-switch', title: 'Hades', preference: null, note: null }, cookies });
    await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${entryId}`, payload: { targetStatus: 'excluded' }, cookies });
    expect((await game('nintendo-switch', 'Hades')).catalog).toMatchObject({ status: 'excluded', targetStatus: 'excluded', yourChoice: true });

    const celeste = await game('nintendo-switch', 'Celeste');
    expect(celeste).toMatchObject({
      catalog: { status: 'owned', targetStatus: 'required', yourChoice: false, matches: [{ title: 'Celeste', method: 'exact' }], purchase: null },
      copies: [{ title: 'Celeste', quantity: 1, valueCents: 1000, countsAs: 'exact' }],
      wishlist: null,
    });

    // A game outside the catalog still shows its copies.
    expect(await game('nintendo-switch', 'Cuphead')).toMatchObject({ catalog: null, copies: [{ title: 'Cuphead' }] });
    expect((await g.app.inject({ url: '/api/v1/game?platform=nintendo-switch', cookies })).statusCode).toBe(400);
    expect((await g.app.inject({ url: '/api/v1/game?platform=nope&title=X', cookies })).statusCode).toBe(404);
  });

  it("keeps your note on a game, under the catalog's title, for the drawer, Store Mode and the notes list", async () => {
    seedCatalogs(g, {
      owned: ['Celeste', 'Cuphead', 'Gris', 'Tunic', 'Ori', 'Inside'].map((t, i): [string, string, string] => [String(i + 1), t, 'Nintendo Switch']),
      catalogs: { 'nintendo-switch': [{ title: 'Hades', evidence: 'list' }, { title: 'Celeste', evidence: 'list' }] },
    });
    const put = (payload: Record<string, unknown>) => g.app.inject({ method: 'PUT', url: '/api/v1/game/note', payload, cookies });
    // Saved under the catalog's title, however the title was written; trimmed.
    expect((await put({ platformKey: 'nintendo-switch', title: 'hades', note: '  The one with the art book  ' })).json()).toEqual({ ok: true, title: 'Hades' });
    expect((await game('nintendo-switch', 'Hades')).note).toEqual({ text: 'The one with the art book', updatedAt: expect.any(String) });
    expect((await game('nintendo-switch', 'Celeste')).note).toBeNull();
    // A game outside the catalog keeps its note under its own title.
    await put({ platformKey: 'nintendo-switch', title: 'Cuphead', note: 'Replace the manual' });
    const notes = (await g.app.inject({ url: '/api/v1/game/notes', cookies })).json() as { platformKey: string; platform: string; title: string; note: string }[];
    expect(notes.map((n) => n.title).sort()).toEqual(['Cuphead', 'Hades']);
    expect(notes.find((n) => n.title === 'Cuphead')).toMatchObject({ platformKey: 'nintendo-switch', platform: 'Nintendo Switch', note: 'Replace the manual' });
    // Store Mode's answers carry it.
    const found = (await g.app.inject({ url: '/api/v1/lookup?q=Hades', cookies })).json() as { platformKey: string; note: string | null }[];
    expect(found.find((r) => r.platformKey === 'nintendo-switch')).toMatchObject({ note: 'The one with the art book' });
    // An empty note removes it; a note too long, a console unknown or a missing note is refused.
    await put({ platformKey: 'nintendo-switch', title: 'Hades', note: '' });
    expect((await game('nintendo-switch', 'Hades')).note).toBeNull();
    expect((await put({ platformKey: 'nintendo-switch', title: 'Hades', note: 'x'.repeat(2001) })).statusCode).toBe(400);
    expect((await put({ platformKey: 'nope', title: 'Hades', note: 'x' })).statusCode).toBe(404);
    expect((await put({ platformKey: 'nintendo-switch', title: 'Hades' })).statusCode).toBe(400);
  });

  it('exports the collection as a spreadsheet, with the catalog game each copy counts as', async () => {
    seedCatalogs(g, {
      owned: [
        ...['Celeste', 'Cuphead', 'Gris', 'Tunic', 'Ori', 'Inside'].map((t, i): [string, string, string] => [String(i + 1), t, 'Nintendo Switch']),
        ['9', 'Hades', 'Playstation 4'],
      ],
      catalogs: { 'nintendo-switch': [{ title: 'Celeste', evidence: 'list' }] },
    });
    const res = await g.app.inject({ url: '/api/v1/collection/export', cookies });
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="squirrelcade-collection-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = res.body.trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      'Title,Console,PriceCharting console,Region,Condition,Sealed,Copies,Value each (USD),Paid each (USD),Added,Bought,Counts as,Series,Played,Your rating,Where it is,Tags,Lent to,For sale or trade,Your note',
    );
    expect(lines).toHaveLength(8);
    const row = (title: string) => lines.find((l) => l.startsWith(`${title},`))!.split(',');
    expect(row('Celeste').slice(0, 3)).toEqual(['Celeste', 'Nintendo Switch', 'Nintendo Switch']);
    expect(row('Celeste')[11]).toBe('Celeste');
    // A copy the console's catalog doesn't have, and one on a console without a catalog.
    expect(row('Cuphead')[11]).toBe('not in the catalog');
    expect(row('Hades')[11]).toBe('');
    // Your note on the game a copy counts as is its last column.
    await g.app.inject({ method: 'PUT', url: '/api/v1/game/note', cookies, payload: { platformKey: 'nintendo-switch', title: 'Celeste', note: 'Keep the reversible cover' } });
    const noted = (await g.app.inject({ url: '/api/v1/collection/export', cookies })).body.trim().split(/\r?\n/);
    expect(noted.find((l) => l.startsWith('Celeste,'))!.endsWith(',Keep the reversible cover')).toBe(true);
    expect(noted.find((l) => l.startsWith('Cuphead,'))!.endsWith(',')).toBe(true);
    // With the Collection page's filters: one console, or a search.
    const switchOnly = (await g.app.inject({ url: '/api/v1/collection/export?platform=nintendo-switch', cookies })).body.trim().split(/\r?\n/);
    expect(switchOnly).toHaveLength(7);
    const searched = (await g.app.inject({ url: '/api/v1/collection/export?q=celes', cookies })).body.trim().split(/\r?\n/);
    expect(searched.slice(1).map((l) => l.split(',')[0])).toEqual(['Celeste']);
  });

  it("explains a game's points even when it's past its console's top 20", async () => {
    const titles = Array.from({ length: 24 }, (_, i) => `Test Game ${i + 1}`);
    seedCatalogs(g, { owned: [['1', 'Test Game 1', 'Playstation 3']], catalogs: { 'playstation-3': titles } });
    const wishlist = (await g.app.inject({ url: '/api/v1/wishlist/platforms/playstation-3', cookies })).json();
    const listed = new Set(wishlist.entries.map((e: { title: string }) => e.title));
    const past = titles.find((t) => t !== 'Test Game 1' && !listed.has(t))!;
    expect(past).toBeDefined();
    expect((await game('playstation-3', past)).wishlist).toMatchObject({ score: expect.any(Number), components: expect.any(Array) });
  });
});
