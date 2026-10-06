import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';
import { buildWorkbook, columnName } from './xlsx.js';
import { readZip } from './zip.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

type Cookies = Record<string, string>;
const cookieOf = (res: { cookies: { name: string; value: string }[] }): Cookies => ({ squirrelcade_session: res.cookies.find((c) => c.name === 'squirrelcade_session')!.value });

const HEADER = 'id,product-name,console-name,price-in-pennies,include-string,condition-string,sku,notes,cost-basis-in-pennies,quantity,date-entered,date-purchased,grading-company,grading-cert-id,folder';
/** Three PS3 games (one twice, one sealed) and a Wii game, bought in 2025 and 2026. */
const COLLECTION = [
  HEADER,
  '1,"Uncharted",Playstation 3,1000,"Item, Box, and Manual",,,,500,2,2025-03-01,2025-03-01,,,',
  '2,"Journey",Playstation 3,2500,"New Item, Box, and Manual",,,,2000,1,2026-01-10,2026-01-10,,,',
  '3,"Flower",Playstation 3,800,"Item Only",,,,300,1,2026-02-01,,,,',
  '4,"Okami",Wii,1999,"Item, Box, and Manual",,,,1000,1,2026-02-01,2026-02-01,,,',
].join('\n');

async function collection() {
  g = await testApp();
  cookies = await setUp(g);
  g.collection.importText(COLLECTION, { source: 'upload', fileName: 'collection_20260927.csv' });
  seedCatalogs(g, { owned: [], catalogs: { 'playstation-3': ['Uncharted', 'Journey', 'Flower', 'Puppeteer'] } });
}

/** A workbook's tabs and each tab's rows as text (the cells' text or numbers, in order). */
function readWorkbook(data: Buffer): { tabs: string[]; sheets: Map<string, string[][]> } {
  const files = new Map(readZip(data).map((e) => [e.name, e.read().toString('utf8')]));
  const tabs = [...files.get('xl/workbook.xml')!.matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  const sheets = new Map<string, string[][]>();
  tabs.forEach((tab, i) => {
    const xml = files.get(`xl/worksheets/sheet${i + 1}.xml`)!;
    const rows = [...xml.matchAll(/<row r="\d+">(.*?)<\/row>/g)].map((r) => [...r[1]!.matchAll(/<c r="[A-Z]+\d+"[^>]*>(?:<is><t[^>]*>(.*?)<\/t><\/is>|<v>(.*?)<\/v>)<\/c>/g)].map((c) => c[1] ?? c[2] ?? ''));
    sheets.set(tab, rows);
  });
  return { tabs, sheets };
}

describe('statistics and the report', () => {
  it('counts the collection by console, condition, region, year added and year bought', async () => {
    await collection();
    const stats = (await g.app.inject({ url: '/api/v1/collection/statistics', cookies })).json();
    expect(stats.totals).toEqual({ games: 4, copies: 5, valueCents: 2 * 1000 + 2500 + 800 + 1999, costCents: 2 * 500 + 2000 + 300 + 1000, sealed: 1, consoles: 2 });
    expect(stats.consoles).toMatchObject([
      { label: 'PlayStation 3', key: 'playstation-3', count: 4, games: 3, cents: 5300 },
      { label: 'Wii', key: 'wii', count: 1, games: 1, cents: 1999 },
    ]);
    expect(stats.conditions).toMatchObject([
      { label: 'Complete in box', count: 3 },
      { label: 'Loose', count: 1 },
      { label: 'Sealed', count: 1 },
    ]);
    expect(stats.added).toMatchObject([
      { label: '2025', count: 2 },
      { label: '2026', count: 3 },
    ]);
    // Bought (or added) that year, what was paid: Flower has no purchase day, so its day added counts.
    expect(stats.spending).toMatchObject([
      { label: '2025', cents: 1000 },
      { label: '2026', cents: 3300 },
    ]);
    expect(stats.mostValuable.map((m: { title: string }) => m.title)).toEqual(['Journey', 'Okami', 'Uncharted', 'Flower']);
    expect(stats.play.statuses).toEqual([{ label: 'Not marked', count: 4, cents: 0 }]);
  });

  it('lists every copy by console with totals for printing, as far as a viewer may see', async () => {
    await collection();
    await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key: g.collection.items({ q: 'Okami' }).items[0]!.key, location: 'Shelf A' } });
    const report = (await g.app.inject({ url: '/api/v1/collection/report', cookies })).json();
    expect(report).toMatchObject({ instanceName: 'Squirrelcade', currency: 'USD', pricesAsOf: '2026-09-27', totals: { games: 4, copies: 5, valueCents: 7299, costCents: 4300 } });
    expect(report.consoles.map((c: { platform: string; copies: number }) => [c.platform, c.copies])).toEqual([
      ['PlayStation 3', 4],
      ['Wii', 1],
    ]);
    expect(report.consoles[1].items).toEqual([{ title: 'Okami', condition: 'Complete in box', region: 'North America', quantity: 1, valueCents: 1999, costCents: 1000, location: 'Shelf A', photos: 0 }]);
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: {}, cookies });
    const viewer = cookieOf(await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } }));
    const theirs = (await g.app.inject({ url: '/api/v1/collection/report', cookies: viewer })).json();
    expect(theirs.totals.costCents).toBeNull();
    expect(theirs.consoles[1].items[0]).toMatchObject({ costCents: null, location: null });
    const stats = (await g.app.inject({ url: '/api/v1/collection/statistics', cookies: viewer })).json();
    expect(stats.spending).toBeNull();
    expect(stats.totals.costCents).toBeNull();
  });
});

describe('the Excel workbook', () => {
  it('has a tab for each part, as far as the requester may see', async () => {
    await collection();
    await g.app.inject({ method: 'PUT', url: '/api/v1/play', cookies, payload: { platformKey: 'playstation-3', title: 'Journey', status: 'beaten', rating: 9 } });
    await g.app.inject({ method: 'PUT', url: '/api/v1/game/note', cookies, payload: { platformKey: 'wii', title: 'Okami', note: 'Wii remote & nunchuk <needed>' } });
    const res = await g.app.inject({ url: '/api/v1/export/workbook', cookies });
    expect(res.headers['content-type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="squirrelcade-\d{4}-\d{2}-\d{2}\.xlsx"$/);
    const { tabs, sheets } = readWorkbook(res.rawPayload);
    expect(tabs).toEqual(['Summary', 'Collection', 'Wishlist', 'Missing', 'Played', 'Loans', 'For sale', 'Notes', 'Top 100']);
    expect(sheets.get('Summary')!.at(-1)).toEqual(['All consoles', '4', '5', '72.99', '43']);
    const collectionRows = sheets.get('Collection')!;
    expect(collectionRows[0]!.slice(0, 3)).toEqual(['Title', 'Console', 'PriceCharting console']);
    expect(collectionRows[0]).toContain('Played');
    const journey = collectionRows.find((r) => r[0] === 'Journey')!;
    expect(journey).toContain('Beaten');
    expect(journey).toContain('25');
    expect(sheets.get('Missing')!.slice(1).map((r) => r.slice(0, 2))).toEqual([['PlayStation 3', 'Puppeteer']]);
    expect(sheets.get('Top 100')!.slice(1).every((r) => r[0] === 'PlayStation 3' || r[0] === 'Wii')).toBe(true);
    expect(sheets.get('Notes')![1]).toEqual(['Wii', 'Okami', 'Wii remote &amp; nunchuk &lt;needed&gt;', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)]);
    // A viewer's workbook leaves out what isn't shared with them.
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: {}, cookies });
    const viewer = cookieOf(await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } }));
    g.settings.update({ 'security.viewersSeePlay': false });
    const theirs = readWorkbook((await g.app.inject({ url: '/api/v1/export/workbook', cookies: viewer })).rawPayload);
    expect(theirs.tabs).toEqual(['Summary', 'Collection', 'Wishlist', 'Missing', 'Top 100']);
    expect(theirs.sheets.get('Collection')![0]).not.toContain('Played');
    expect(theirs.sheets.get('Summary')![0]).toEqual(['Console', 'Games', 'Copies', 'Value (USD)']);
  });

  it('writes cells Excel accepts: escaped text, numbers, money, frozen headers and filters', () => {
    expect([0, 25, 26, 51, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AZ', 'ZZ', 'AAA']);
    const data = buildWorkbook([
      { name: 'Games: [all]/?', header: ['Title', 'Copies', 'Value'], rows: [['A & B <C> "D"\u0001', 2, { cents: 1234 }], [null, undefined, { cents: null }]] },
      { name: 'Games: [all]/?', header: ['Empty'], rows: [] },
    ]);
    const files = new Map(readZip(data).map((e) => [e.name, e.read().toString('utf8')]));
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml']);
    // Tab names without the characters Excel refuses, and never twice.
    expect(files.get('xl/workbook.xml')).toContain('<sheet name="Games   all" sheetId="1" r:id="rId1"/><sheet name="Games   all 2" sheetId="2" r:id="rId2"/>');
    const sheet = files.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">A &amp; B &lt;C&gt; &quot;D&quot;</t></is></c><c r="B2"><v>2</v></c><c r="C2" s="2"><v>12.34</v></c>');
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1">');
    expect(sheet).toContain('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>');
    expect(sheet).toContain('<autoFilter ref="A1:C3"/>');
    // An empty row has no cells; an empty sheet has no filter.
    expect(sheet).toContain('<row r="3"></row>');
    expect(files.get('xl/worksheets/sheet2.xml')).not.toContain('autoFilter');
    expect(files.get('xl/workbook.xml')).toContain(`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'Games   all'!$A$1:$C$3</definedName>`);
  });
});
