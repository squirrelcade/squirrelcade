import { afterEach, describe, expect, it } from 'vitest';
import { HEADER, setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
afterEach(async () => {
  await g?.cleanup();
});

const row = (id: string, title: string, label: string, cents: number, inc = 'Item, Box, and Manual') => `${id},"${title}",${label},${cents},"${inc}",,,,0,1,2026-01-01,,,,`;
const page = (name: string, console: string, id: string) =>
  `<html><head><title>${name} Prices ${console} | Compare Loose, CIB &amp; New Prices</title></head><body><h1 id="product_name" class="chart_title" title="${id}">${name} <a href="/console/x">${console}</a></h1>${'<p>prices</p>'.repeat(50)}</body></html>`;

/** PriceCharting as the tests have it: some products, one that doesn't exist, one page that fails once. */
function fakePriceCharting() {
  const asked: { url: string; agent: string }[] = [];
  let failing = true;
  const fetch = async (url: string, init: RequestInit) => {
    asked.push({ url, agent: String((init.headers as Record<string, string>)['user-agent'] ?? '') });
    const id = url.split('/').pop()!;
    if (id === '501' && failing) {
      failing = false;
      return new Response('busy', { status: 503 });
    }
    const products: Record<string, [string, string]> = { '700': ['Puppeteer', 'Playstation 3'], '701': ['Puppeteer', 'PAL Playstation 3'], '702': ['Tearaway', 'Playstation Vita'], '501': ['Puppeteer', 'Playstation 3'] };
    const p = products[id];
    return p ? new Response(page(p[0], p[1], id), { status: 200 }) : new Response('Not found', { status: 404 });
  };
  return { fetch, asked };
}

describe("Send to PriceCharting's check: what PriceCharting calls each ID", () => {
  it('reads an ID no export has from its page, once, in the background, only when the owner allows it', async () => {
    const pc = fakePriceCharting();
    g = await testApp({ pcPageFetch: pc.fetch });
    const cookies = await setUp(g);
    g.collection.importText([HEADER, row('1', 'Uncharted', 'Playstation 3', 1000), row('2', 'Journey', 'Playstation 3', 1500)].join('\n'), { source: 'upload', fileName: 'collection_20261001.csv' });
    const add = async (title: string, completeness = 'complete', costCents: number | null = null) =>
      (await g.app.inject({ method: 'POST', url: '/api/v1/collection/copies', cookies, payload: { platformKey: 'playstation-3', title, completeness, costCents } })).json().copy as { id: number };
    const give = (id: number, pcId: string) => g.app.inject({ method: 'PUT', url: `/api/v1/send/pricecharting/${id}/product`, cookies, payload: { pcId } });
    type Row = { id: number; verdict: string; lookup: string; pcTitle: string | null; pcConsole: string | null; why: string[]; inCsv: boolean; lookupMessage: string | null };
    const list = async () => (await g.app.inject({ url: '/api/v1/send/pricecharting', cookies })).json().toSend as Row[];
    const rowOf = async (id: number) => (await list()).find((c) => c.id === id)!;

    const puppeteer = await add('Puppeteer');
    expect((await give(puppeteer.id, '700')).statusCode).toBe(200);
    // Off (the default): nothing is read from PriceCharting, and the check says it can't name the ID.
    expect(await rowOf(puppeteer.id)).toMatchObject({ verdict: 'unknown', lookup: 'off', pcTitle: null, inCsv: true });
    await g.pcPages.idle();
    expect(pc.asked).toEqual([]);

    // On: the page opened asks for it, it's read in the background, and the next look has it.
    g.settings.update({ 'collection.pcLookup': true });
    expect(await rowOf(puppeteer.id)).toMatchObject({ lookup: 'pending', verdict: 'unknown', why: ['Looking it up on PriceCharting'] });
    await g.pcPages.idle();
    expect(await rowOf(puppeteer.id)).toMatchObject({ lookup: 'page', verdict: 'match', pcTitle: 'Puppeteer', pcConsole: 'Playstation 3', why: [] });
    // Kept: opening the page again reads nothing more.
    await list();
    await g.pcPages.idle();
    expect(pc.asked.map((a) => a.url)).toEqual(['https://www.pricecharting.com/game/700']);
    // A plain User-Agent, never an email address.
    expect(pc.asked[0]!.agent).toMatch(/^Squirrelcade\//);
    expect(pc.asked[0]!.agent).not.toContain('@');

    // Another region, another game and console, and an ID PriceCharting doesn't have: each a mismatch, flagged, and
    // still in the CSV unless unticked. An ID saved is looked up at once.
    const pal = await add('Puppeteer', 'loose');
    const vita = await add('Puppeteer', 'sealed');
    const gone = await add('Puppeteer', 'item-box');
    await give(pal.id, '701');
    await give(vita.id, '702');
    await give(gone.id, '999');
    await g.pcPages.idle();
    expect(await rowOf(pal.id)).toMatchObject({ verdict: 'mismatch', lookup: 'page', why: ['Another region: PAL Playstation 3'], inCsv: true });
    expect(await rowOf(vita.id)).toMatchObject({ verdict: 'mismatch', pcTitle: 'Tearaway', why: ['PriceCharting calls it "Tearaway"', 'Another console: Playstation Vita'] });
    expect(await rowOf(gone.id)).toMatchObject({ verdict: 'mismatch', lookup: 'missing', why: ['PriceCharting has no product #999'] });

    // A read that fails says so, and Try again reads it again.
    const busy = await add('Puppeteer', 'graded');
    await give(busy.id, '501');
    await g.pcPages.idle();
    expect(await rowOf(busy.id)).toMatchObject({ verdict: 'unknown', lookup: 'failed', lookupMessage: 'PriceCharting is busy (503)' });
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/send/pricecharting/${busy.id}/lookup`, cookies })).json()).toEqual({ ok: true });
    await g.pcPages.idle();
    expect(await rowOf(busy.id)).toMatchObject({ verdict: 'match', lookup: 'page' });

    // Turned off again, what was read stays shown, and nothing more is read.
    g.settings.update({ 'collection.pcLookup': false });
    const asked = pc.asked.length;
    expect(await rowOf(puppeteer.id)).toMatchObject({ lookup: 'page', verdict: 'match' });
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/send/pricecharting/${busy.id}/lookup`, cookies })).statusCode).toBe(409);
    await g.pcPages.idle();
    expect(pc.asked.length).toBe(asked);
  });

  it("gives the value of a game in a condition from the owner's exports, for the price check", async () => {
    g = await testApp();
    const cookies = await setUp(g);
    g.collection.importText([HEADER, row('2', 'Journey', 'Playstation 3', 1500), row('2', 'Journey', 'Playstation 3', 400, 'Item Only')].join('\n'), { source: 'upload', fileName: 'collection_20261001.csv' });
    const value = async (q: string) => (await g.app.inject({ url: `/api/v1/collection/known-value?${q}`, cookies })).json().valueCents as number | null;
    expect(await value('platform=playstation-3&title=Journey&completeness=complete')).toBe(1500);
    expect(await value('platform=playstation-3&title=journey&completeness=loose')).toBe(400);
    expect(await value('platform=playstation-3&title=Journey&completeness=sealed')).toBeNull();
    expect(await value('platform=playstation-3&title=Puppeteer&completeness=complete')).toBeNull();
    // By a copy: a copy added here of a game an export has shares its product, and the condition asked about counts.
    const copy = (await g.app.inject({ method: 'POST', url: '/api/v1/collection/copies', cookies, payload: { platformKey: 'playstation-3', title: 'Journey', completeness: 'complete' } })).json().copy as { id: number };
    expect(await value(`copy=${copy.id}`)).toBe(1500);
    expect(await value(`copy=${copy.id}&completeness=loose`)).toBe(400);
    // The send list carries it too, for the check's Value column.
    const send = (await g.app.inject({ url: '/api/v1/send/pricecharting', cookies })).json().toSend as { id: number; valueCents: number | null }[];
    expect(send.find((c) => c.id === copy.id)?.valueCents).toBe(1500);
  });
});
