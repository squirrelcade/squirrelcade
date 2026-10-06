import { classifyIncludes } from '@squirrelcade/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { INCLUDE_OF } from './collection.js';
import { pendingPurchases } from './db/schema.js';
import { HEADER, seedCatalogs, setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
  // One game of five may go without holding an update (these tests drop one at a time).
  g.settings.update({ 'collection.maxRemovalPercent': 50 });
});
afterEach(async () => {
  await g.cleanup();
});

type Copy = { id: number; key: string; title: string; completeness: string; source: string; valueCents: number | null; costCents: number | null; datePurchased: string | null; missingSince: string | null };
const row = (id: string, title: string, label: string, cents: number, inc = 'Item, Box, and Manual', paid = '0') => `${id},"${title}",${label},${cents},"${inc}",,,,${paid},1,2026-01-01,,,,`;
const exportOf = (...rows: string[]) => [HEADER, ...rows].join('\n');
const BASE = [row('1', 'Uncharted', 'Playstation 3', 1000), row('2', 'Journey', 'Playstation 3', 1500), row('3', 'Flower', 'Playstation 3', 900)];
let day = 1;
const update = (...rows: string[]) => g.collection.importText(exportOf(...rows), { source: 'upload', fileName: `collection_202610${String(day++).padStart(2, '0')}.csv` });
const items = (q = '') => g.collection.items({ q, all: true }).items as unknown as Copy[];
const add = (payload: Record<string, unknown>, who = cookies) => g.app.inject({ method: 'POST', url: '/api/v1/collection/copies', cookies: who, payload });
const edit = (id: number, payload: Record<string, unknown>) => g.app.inject({ method: 'PUT', url: `/api/v1/collection/copies/${id}`, cookies, payload });
const remove = (id: number, reason: string) => g.app.inject({ method: 'POST', url: `/api/v1/collection/copies/${id}/remove`, cookies, payload: { reason } });
const send = async () => (await g.app.inject({ url: '/api/v1/send/pricecharting', cookies })).json() as { toSend: { id: number; line: string; conditionReadThere: boolean }[]; waiting: { id: number }[]; toRemove: { id: number; title: string }[]; text: string };

describe('copies of Squirrelcade\'s own', () => {
  it('adds a game by hand on a new install, with no export and no catalog yet (Add a game, 0.60.0)', async () => {
    // A console nothing was imported for: created when its first game is added.
    const first = await add({ platformKey: 'sega-saturn', title: 'Panzer Dragoon Saga', completeness: 'complete', costCents: 25000, notes: 'From a garage sale' });
    expect(first.statusCode).toBe(201);
    expect(first.json().copy).toMatchObject({ title: 'Panzer Dragoon Saga', costCents: 25000, notes: 'From a garage sale' });
    const summary = (await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json();
    expect(summary).toMatchObject({ currentImport: null, totals: { copies: 1 } });
    expect((await add({ platformKey: 'not-a-console', title: 'X', completeness: 'complete' })).statusCode).toBe(400);
  });

  it('suggests titles for a console from the collection and its catalog, words matching at their start', async () => {
    seedCatalogs(g, { owned: [['1', 'Uncharted', 'Playstation 3']], catalogs: { 'playstation-3': ['Uncharted 2: Among Thieves', 'Uncharted 3', 'Journey', 'Flower'] } });
    const suggest = async (q: string, platform = 'playstation-3') =>
      (await g.app.inject({ url: `/api/v1/collection/add/suggest?platform=${platform}&q=${encodeURIComponent(q)}`, cookies })).json().suggestions as { title: string; sources: string[]; owned: number }[];
    const unch = await suggest('uncha');
    expect(unch.map((x) => x.title)).toEqual(['Uncharted', 'Uncharted 3', 'Uncharted 2: Among Thieves']);
    expect(unch[0]).toMatchObject({ owned: 1, sources: expect.arrayContaining(['collection']) });
    expect((await suggest('among thi')).map((x) => x.title)).toEqual(['Uncharted 2: Among Thieves']);
    expect(await suggest('ourney')).toEqual([]);
    expect(await suggest('')).toEqual([]);
  });

  it('writes each condition the way PriceCharting does, so it reads back the same', () => {
    for (const [completeness, include] of Object.entries(INCLUDE_OF)) expect(classifyIncludes(include).completeness).toBe(completeness);
  });

  it('adds a copy that counts at once, sharing the product (and its value) of a copy from an export', async () => {
    update(...BASE);
    const res = await add({ platformKey: 'playstation-3', title: 'Uncharted', completeness: 'complete', costCents: 500, datePurchased: '2026-09-20', notes: 'Second copy' });
    expect(res.statusCode).toBe(201);
    expect(res.json().copy).toMatchObject({ title: 'Uncharted', completeness: 'complete', condition: 'Complete in box', costCents: 500, datePurchased: '2026-09-20', notes: 'Second copy', source: 'squirrelcade', sentAt: null });
    const uncharted = items('Uncharted');
    expect(uncharted).toHaveLength(2);
    expect(new Set(uncharted.map((c) => c.valueCents))).toEqual(new Set([1000]));
    // A game no export has: a product of Squirrelcade's own, no value yet.
    const puppeteer = (await add({ platformKey: 'playstation-3', title: 'Puppeteer', completeness: 'sealed' })).json().copy;
    expect(items('Puppeteer')).toMatchObject([{ id: puppeteer.id, valueCents: null, completeness: 'sealed' }]);
    expect((await g.app.inject({ url: '/api/v1/collection/summary', cookies })).json().totals).toMatchObject({ games: 4, copies: 5 });
    // What isn't valid is refused.
    for (const bad of [
      { platformKey: 'nope', title: 'X', completeness: 'loose' },
      { platformKey: 'playstation-3', title: ' ', completeness: 'loose' },
      { platformKey: 'playstation-3', title: 'X', completeness: 'mint' },
      { platformKey: 'playstation-3', title: 'X', completeness: 'loose', costCents: -1 },
      { platformKey: 'playstation-3', title: 'X', completeness: 'loose', datePurchased: 'yesterday' },
    ]) {
      expect((await add(bad)).statusCode).toBe(400);
    }
  });

  it("keeps the owner's changes to a copy from an export, and the export still finds it", async () => {
    update(...BASE);
    const journey = items('Journey')[0]!;
    const changed = await edit(journey.id, { completeness: 'item-box', costCents: 1200, datePurchased: '2020-05-01' });
    expect(changed.json().copy).toMatchObject({ completeness: 'item-box', costCents: 1200, datePurchased: '2020-05-01' });
    // PriceCharting still has it complete, with no price paid: the same copy, the owner's condition and price kept, its new value taken.
    const outcome = update(row('1', 'Uncharted', 'Playstation 3', 1000), row('2', 'Journey', 'Playstation 3', 1700), row('3', 'Flower', 'Playstation 3', 900));
    expect(outcome.report.copies).toEqual({ matched: 3, added: 0, missing: 0, gone: 0 });
    expect(items('Journey')).toMatchObject([{ id: journey.id, completeness: 'item-box', costCents: 1200, datePurchased: '2020-05-01', valueCents: 1700 }]);
    expect((await edit(999, { notes: 'x' })).statusCode).toBe(404);
    expect((await edit(journey.id, { completeness: 'mint' })).statusCode).toBe(400);
  });

  it('lists the copies to add to PriceCharting, and the export that has them takes them over', async () => {
    update(...BASE);
    const complete = (await add({ platformKey: 'playstation-3', title: 'Puppeteer', completeness: 'complete', costCents: 2500 })).json().copy;
    const boxed = (await add({ platformKey: 'playstation-3', title: 'Tearaway', completeness: 'item-box' })).json().copy;
    const list = await send();
    expect(list.toSend.map((c) => c.line)).toEqual(['Puppeteer Playstation 3 CIB', 'Tearaway Playstation 3']);
    expect(list.toSend.map((c) => c.conditionReadThere)).toEqual([true, false]);
    expect(list.text).toBe('Puppeteer Playstation 3 CIB\nTearaway Playstation 3');
    // Pasted: they wait for the export that has them.
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/send/pricecharting/sent', cookies, payload: { ids: [complete.id, boxed.id] } })).json()).toEqual({ marked: 2 });
    expect(await send()).toMatchObject({ toSend: [], waiting: [{ id: complete.id }, { id: boxed.id }], text: '' });
    // PriceCharting read Tearaway as loose: still that copy, its condition kept; Puppeteer gets its value, its price paid kept.
    const outcome = update(...BASE, row('7', 'Puppeteer', 'Playstation 3', 1800), row('8', 'Tearaway', 'Playstation 3', 700, 'Item Only'));
    expect(outcome.report.copies).toEqual({ matched: 5, added: 0, missing: 0, gone: 0 });
    expect(items('Puppeteer')).toMatchObject([{ id: complete.id, source: 'pricecharting', valueCents: 1800, costCents: 2500 }]);
    expect(items('Tearaway')).toMatchObject([{ id: boxed.id, source: 'pricecharting', completeness: 'item-box', valueCents: 700 }]);
    expect(await send()).toMatchObject({ toSend: [], waiting: [] });
    // And the next export finds Tearaway again by what PriceCharting calls it (loose), not as a new copy.
    expect(update(...BASE, row('7', 'Puppeteer', 'Playstation 3', 1800), row('8', 'Tearaway', 'Playstation 3', 700, 'Item Only')).report.copies).toEqual({ matched: 5, added: 0, missing: 0, gone: 0 });
  });

  it('takes out a copy sold here, and lists it to remove on PriceCharting until its export drops it', async () => {
    update(...BASE);
    const flower = items('Flower')[0]!;
    expect((await remove(flower.id, 'sold')).json()).toEqual({ ok: true });
    expect(items('Flower')).toEqual([]);
    expect((await send()).toRemove).toMatchObject([{ id: flower.id, title: 'Flower' }]);
    // The next export still has it (with a new price): it isn't added back.
    expect(update(row('1', 'Uncharted', 'Playstation 3', 1001), BASE[1]!, BASE[2]!).report.copies).toEqual({ matched: 2, added: 0, missing: 0, gone: 0 });
    expect(items('Flower')).toEqual([]);
    expect((await send()).toRemove).toHaveLength(1);
    // Removed on PriceCharting: the next export doesn't have it, and there's nothing left to do.
    update(BASE[0]!, BASE[1]!);
    expect((await send()).toRemove).toEqual([]);
    expect(await g.app.inject({ url: '/api/v1/collection/missing', cookies }).then((r) => r.json())).toEqual([]);
    // Marked done by hand works too.
    const journey = items('Journey')[0]!;
    await remove(journey.id, 'removed');
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/send/pricecharting/removed', cookies, payload: { ids: [journey.id] } })).json()).toEqual({ marked: 1 });
    expect((await send()).toRemove).toEqual([]);
    expect((await remove(journey.id, 'sold')).statusCode).toBe(404);
    expect((await remove(items()[0]!.id, 'lost')).statusCode).toBe(400);
  });

  it('takes back a copy just added, but not one with details kept on it', async () => {
    update(...BASE);
    const mistake = (await add({ platformKey: 'playstation-3', title: 'Rain', completeness: 'loose' })).json().copy;
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/purchases/${mistake.id}`, cookies })).json()).toEqual({ removed: true });
    expect(items('Rain')).toEqual([]);
    const kept = (await add({ platformKey: 'playstation-3', title: 'Rain', completeness: 'loose' })).json().copy;
    await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key: kept.key, location: 'Shelf A' } });
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/purchases/${kept.id}`, cookies })).json()).toEqual({ removed: false });
    // A copy from an export is never undone this way.
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/purchases/${items('Journey')[0]!.id}`, cookies })).json()).toEqual({ removed: false });
  });

  it('turns games marked "I bought it" before 0.20.0 into copies, in the condition set for a game just bought', async () => {
    seedCatalogs(g, { owned: [['1', 'Uncharted', 'Playstation 3']], catalogs: { 'playstation-3': ['Uncharted', 'Journey'] } });
    const journey = (await g.app.inject({ url: '/api/v1/catalogs/playstation-3?q=journey', cookies })).json().entries[0];
    g.db.insert(pendingPurchases).values({ entryId: journey.id, createdAt: '2026-09-01T10:00:00.000Z' }).run();
    g.settings.update({ 'collection.boughtCondition': 'sealed' });
    expect(g.collection.startPurchases()).toBe(1);
    expect(g.collection.startPurchases()).toBe(0);
    expect(items('Journey')).toMatchObject([{ completeness: 'sealed', source: 'squirrelcade' }]);
    expect((await g.app.inject({ url: '/api/v1/purchases', cookies })).json()).toMatchObject([{ title: 'Journey', entryId: journey.id, createdAt: '2026-09-01T10:00:00.000Z' }]);
  });

  it('leaves adding and changing copies to the owner', async () => {
    update(...BASE);
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Sam' }, cookies });
    const joined = await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } });
    const viewer = { squirrelcade_session: joined.cookies.find((c: { name: string }) => c.name === 'squirrelcade_session')!.value };
    expect((await add({ platformKey: 'playstation-3', title: 'Rain', completeness: 'loose' }, viewer)).statusCode).toBe(403);
    expect((await g.app.inject({ method: 'PUT', url: `/api/v1/collection/copies/${items()[0]!.id}`, cookies: viewer, payload: { notes: 'x' } })).statusCode).toBe(403);
    expect((await g.app.inject({ url: '/api/v1/send/pricecharting', cookies: viewer })).statusCode).toBe(403);
  });

  it("changes only its own console's catalog matching (a purchase in a store doesn't make every console start over)", async () => {
    update(...BASE, row('4', 'Okami', 'Playstation 2', 1200));
    g.catalogs.syncSource('playstation-3', 'test', [{ title: 'Uncharted' }, { title: 'Journey' }, { title: 'Flower' }, { title: 'Rain' }]);
    g.catalogs.syncSource('playstation-2', 'test', [{ title: 'Okami' }, { title: 'Shadow of the Colossus' }]);
    const id = (key: string) => (g.db.$client.prepare('select id from platforms where key = ?').get(key) as { id: number }).id;
    const [ps2, ps3] = [id('playstation-2'), id('playstation-3')];
    const owned = () => Object.fromEntries((g.catalogs.summary() as { key: string; owned: number }[]).map((p) => [p.key, p.owned]));
    expect(owned()).toMatchObject({ 'playstation-2': 1, 'playstation-3': 3 });
    const before = { ps2: g.collection.consoleRevision(ps2), ps3: g.collection.consoleRevision(ps3), all: g.collection.revision() };
    // Rain bought for the PS3: the PS3's matching starts over (and counts it), the PS2's stays as it was.
    expect((await add({ platformKey: 'playstation-3', title: 'Rain', completeness: 'loose' })).statusCode).toBe(201);
    expect(g.collection.consoleRevision(ps3)).not.toBe(before.ps3);
    expect(g.collection.consoleRevision(ps2)).toBe(before.ps2);
    expect(g.collection.revision()).not.toBe(before.all);
    expect(owned()).toMatchObject({ 'playstation-2': 1, 'playstation-3': 4 });
    // An update can change any console: every one starts over.
    update(...BASE, row('4', 'Okami', 'Playstation 2', 1200), row('5', 'Shadow of the Colossus', 'Playstation 2', 800));
    expect(g.collection.consoleRevision(ps2)).not.toBe(before.ps2);
    expect(owned()).toMatchObject({ 'playstation-2': 2 });
  });
});
