import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readZip } from './zip.js';
import { barcodes } from './db/schema.js';
import { HEADER, multipartForm, seedCatalogs, setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

const row = (id: string, title: string, label: string, cents: number, inc: string, paid: string) => `${id},"${title}",${label},${cents},"${inc}",,,,${paid},1,2026-01-01,,,,`;
const COLLECTION = [
  HEADER,
  row('1', 'Okami', 'Playstation 2', 3000, 'Item, Box, and Manual', '1500'),
  row('1', 'Okami', 'Playstation 2', 1200, 'Item Only', '0'),
  row('2', 'Journey', 'Playstation 3', 2500, 'New Item, Box, and Manual', '2000'),
  row('3', 'Flower', 'Playstation 3', 900, 'Item Only', '0'),
].join('\n');

function load() {
  g.collection.importText(COLLECTION, { source: 'upload', fileName: 'collection_20260927.csv' });
  seedCatalogs(g, { owned: [], catalogs: { 'playstation-2': [{ title: 'Okami', releaseDate: '2006-09-19' }], 'playstation-3': ['Journey', 'Flower'] } });
}
const copyOf = (title: string, completeness?: string) => g.collection.items({ q: title, all: true }).items.find((i) => !completeness || i.completeness === completeness)!;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 1)]);

describe('selling', () => {
  it("writes a copy's listing for eBay and Mercari, with its price, photos and sold listings", async () => {
    load();
    const okami = copyOf('Okami', 'complete');
    g.db.insert(barcodes).values({ code: '013388290208', platformId: g.collection.platformsWithLabels().find((p) => p.key === 'playstation-2')!.id, title: 'Okami', source: 'user', createdAt: '2026-09-01' }).run();
    await g.app.inject({ method: 'POST', url: '/api/v1/copy/tests', cookies, payload: { key: okami.key, kind: 'rip', result: 'works', testedAt: '2026-09-20T10:00:00Z' } });
    await g.app.inject({ method: 'POST', url: '/api/v1/copy/tests', cookies, payload: { key: okami.key, result: 'works', testedAt: '2026-09-21T10:00:00Z' } });
    await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key: okami.key, sale: 'sale', askingCents: 3500, saleNote: 'Minty case.' } });
    await g.app.inject({ method: 'POST', url: '/api/v1/photos', cookies, ...multipartForm({ key: okami.key, slot: 'Box front' }, { name: 'p.png', content: PNG, type: 'image/png' }) });
    const kit = (await g.app.inject({ url: `/api/v1/collection/copies/${okami.id}/listing?marketplace=ebay`, cookies })).json();
    expect(kit.listing.title).toBe('Okami (PlayStation 2, 2006) CIB Complete Tested');
    expect(kit.listing.description).toContain('What you get: the disc, the case and the manual.');
    expect(kit.listing.description).toContain('The disc was read in full and verified without errors on September 20, 2026.');
    expect(kit.listing.description).toContain('Tested and working on September 21, 2026.');
    expect(kit.listing.description).toContain('Minty case.');
    expect(kit.listing.specifics).toContainEqual({ name: 'UPC', value: '013388290208' });
    expect(kit.listing.condition).toEqual({ name: 'Used', id: 3000 });
    // At the asking price: eBay's 13.6% and 40 cents, less 5.00 shipping.
    expect(kit.price).toEqual({ valueCents: 3000, askingCents: 3500, atCents: 3500, feesCents: 516, netCents: 2484, shippingCostCents: 500 });
    expect(kit.photos.missing).toEqual(['Box back', 'Inside', 'Disc front', 'Disc back']);
    expect(kit.links.sold).toContain('LH_Sold=1');
    const mercari = (await g.app.inject({ url: `/api/v1/collection/copies/${okami.id}/listing?marketplace=mercari`, cookies })).json();
    expect(mercari.listing.condition).toEqual({ name: 'Good' });
    expect(mercari.price.feesCents).toBe(350);
    // The photos, named by their place, to upload.
    const zip = await g.app.inject({ url: `/api/v1/collection/copies/${okami.id}/photos.zip`, cookies });
    expect(zip.headers['content-type']).toBe('application/zip');
    expect(readZip(zip.rawPayload).map((e) => e.name)).toEqual(['01 Box front.png']);
    expect((await g.app.inject({ url: `/api/v1/collection/copies/${copyOf('Flower').id}/photos.zip`, cookies })).statusCode).toBe(404);
    expect((await g.app.inject({ url: '/api/v1/collection/copies/9999/listing', cookies })).statusCode).toBe(404);
  });

  it('records a sale, with fees worked out, counts it in money and meals, and takes it back', async () => {
    load();
    const okami = copyOf('Okami', 'complete');
    const sold = await g.app.inject({ method: 'POST', url: `/api/v1/collection/copies/${okami.id}/sell`, cookies, payload: { soldCents: 4000, marketplace: 'ebay', soldAt: '2026-09-29' } });
    expect(sold.statusCode).toBe(201);
    // 13.6% of 40.00 is 5.44, plus 0.40; shipping 5.00; paid 15.00.
    expect(sold.json()).toMatchObject({ soldCents: 4000, feesCents: 584, shippingCostCents: 500, netCents: 2916, paidCents: 1500, gainCents: 1416 });
    expect(copyOf('Okami', 'complete')).toBeUndefined();
    // Still listed on PriceCharting: on the list to remove there.
    expect((await g.app.inject({ url: '/api/v1/send/pricecharting', cookies })).json().toRemove.map((c: { title: string }) => c.title)).toEqual(['Okami']);
    // A local sale: no fees, no shipping; the loose Okami had no price paid, but the owner's estimate counts.
    const loose = copyOf('Okami', 'loose');
    await g.app.inject({ method: 'PUT', url: `/api/v1/collection/copies/${loose.id}`, cookies, payload: { estimatedCents: 800 } });
    await g.app.inject({ method: 'POST', url: `/api/v1/collection/copies/${loose.id}/sell`, cookies, payload: { soldCents: 1500, marketplace: 'local', soldAt: '2026-09-29' } });
    const sales = (await g.app.inject({ url: '/api/v1/sales', cookies })).json();
    expect(sales.all).toEqual({ sales: 2, soldCents: 5500, feesCents: 584, shippingCostCents: 500, netCents: 4416, paidCents: 2300, gainCents: 2116, meals: 2 });
    expect(sales.mealCents).toBe(1500);
    const csv = (await g.app.inject({ url: '/api/v1/sales/export', cookies })).body;
    expect(csv).toContain('2026-09-29,Okami,PlayStation 2,Complete in box,ebay,40.00,0.00,5.84,5.00,29.16,15.00,14.16,');
    // A fee known later; then the sale taken back: the copy returns.
    const first = sales.sales.find((s: { marketplace: string }) => s.marketplace === 'ebay');
    expect((await g.app.inject({ method: 'PUT', url: `/api/v1/sales/${first.id}`, cookies, payload: { feesCents: 600 } })).json()).toMatchObject({ feesCents: 600, netCents: 2900 });
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/sales/${first.id}`, cookies })).json()).toEqual({ undone: true });
    expect(copyOf('Okami', 'complete')).toBeDefined();
    for (const bad of [{}, { soldCents: -1 }, { soldCents: 100, marketplace: 'garage' }, { soldCents: 100, soldAt: 'today' }]) {
      expect((await g.app.inject({ method: 'POST', url: `/api/v1/collection/copies/${copyOf('Flower').id}/sell`, cookies, payload: bad })).statusCode).toBe(400);
    }
  });

  it('suggests what to sell next: games finished, then copies owned twice, never a keeper', async () => {
    load();
    await g.app.inject({ method: 'PUT', url: '/api/v1/play', cookies, payload: { platformKey: 'playstation-3', title: 'Journey', status: 'beaten' } });
    await g.app.inject({ method: 'PUT', url: '/api/v1/play', cookies, payload: { platformKey: 'playstation-3', title: 'Flower', status: 'completed' } });
    let s = (await g.app.inject({ url: '/api/v1/sales/suggestions', cookies })).json();
    expect(s.finished.map((c: { title: string; why: string }) => `${c.title}: ${c.why}`)).toEqual(['Journey: You beat it', 'Flower: You completed it']);
    // Of the two Okami, the loose one could go.
    expect(s.twice.map((c: { title: string; condition: string }) => `${c.title} ${c.condition}`)).toEqual(['Okami Loose']);
    // A keeper (Settings > Collection > Selling's tag) and a copy already for sale aren't suggested.
    await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key: copyOf('Journey').key, tags: ['Keeper'] } });
    await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key: copyOf('Okami', 'loose').key, sale: 'sale' } });
    s = (await g.app.inject({ url: '/api/v1/sales/suggestions', cookies })).json();
    expect(s.finished.map((c: { title: string }) => c.title)).toEqual(['Flower']);
    expect(s.twice).toEqual([]);
  });

  it('lists the copies worth more lately, the biggest rise first', async () => {
    load();
    // A later export: Journey's price up from 25.00 to 40.00, Flower's from 9.00 to 10.00, the loose Okami's down.
    const later = COLLECTION.replace('Journey",Playstation 3,2500', 'Journey",Playstation 3,4000').replace('Flower",Playstation 3,900', 'Flower",Playstation 3,1000').replace('Okami",Playstation 2,1200', 'Okami",Playstation 2,1100');
    g.collection.importText(later, { source: 'upload', fileName: 'collection_20260929.csv' });
    let s = (await g.app.inject({ url: '/api/v1/sales/suggestions', cookies })).json();
    expect(s.rising.map((c: { title: string; riseCents: number; risePercent: number }) => `${c.title} +${c.riseCents} (+${c.risePercent}%)`)).toEqual(['Journey +1500 (+60%)', 'Flower +100 (+11%)']);
    expect(s.rising[0].since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // A keeper isn't suggested.
    await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key: copyOf('Journey').key, tags: ['Keeper'] } });
    s = (await g.app.inject({ url: '/api/v1/sales/suggestions', cookies })).json();
    expect(s.rising.map((c: { title: string }) => c.title)).toEqual(['Flower']);
  });

  it('keeps a rip apart from a test, and says so', async () => {
    load();
    const key = copyOf('Journey').key;
    await g.app.inject({ method: 'POST', url: '/api/v1/copy/tests', cookies, payload: { key, kind: 'rip', result: 'issues' } });
    const tests = (await g.app.inject({ url: `/api/v1/copy?key=${encodeURIComponent(key)}`, cookies })).json().tests;
    expect(tests).toMatchObject([{ kind: 'rip', result: 'issues' }]);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/copy/tests', cookies, payload: { key, kind: 'played', result: 'works' } })).statusCode).toBe(400);
  });
});
