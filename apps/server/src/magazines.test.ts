import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setUp, testApp, type TestApp } from './test-helpers.js';
import { writeZip } from './zip.js';

let g: TestApp;
let dir: string;
afterEach(async () => {
  await g.cleanup();
  rmSync(dir, { recursive: true, force: true });
});

/** A made-up issue: its pages (bytes that stand for pictures) and its ComicInfo.xml, if it has one. */
function cbz(path: string, pages: number, info: Record<string, string | number> | null): void {
  const files = Array.from({ length: pages }, (_, i) => ({ name: `${String(i + 1).padStart(3, '0')}.jpg`, data: Buffer.from(`page ${i + 1} of ${path}`) }));
  if (info) files.push({ name: 'ComicInfo.xml', data: Buffer.from(`<?xml version="1.0"?><ComicInfo>${Object.entries(info).map(([k, v]) => `<${k}>${v}</${k}>`).join('')}</ComicInfo>`) });
  writeFileSync(path, writeZip(files));
}

const hocr = (words: string[]) => `<div class='ocr_page'><span class='ocr_line' title="bbox 0 0 100 10">${words.map((w, i) => `<span class='ocrx_word' title='bbox ${i * 10} 0 ${i * 10 + 9} 10; x_wconf 95'>${w}</span>`).join(' ')}</span></div>`;

describe('Leaves: the magazine scans (D177)', () => {
  it('reads the folder, its issues from their ComicInfo.xml or names, the text that came with them, and searches it', async () => {
    dir = mkdtempSync(join(tmpdir(), 'squirrelcade-magazines-'));
    mkdirSync(join(dir, 'Nintendo Power'));
    mkdirSync(join(dir, 'GameFan'));
    mkdirSync(join(dir, '_work'));
    cbz(join(dir, 'Nintendo Power', 'Nintendo Power #010 (1990-01) Super Mario Bros. 3.cbz'), 4, { Series: 'Nintendo Power', Number: 10, Year: 1990, Month: 1, Title: 'Super Mario Bros. 3', PageCount: 4 });
    cbz(join(dir, 'Nintendo Power', 'Nintendo Power #011 (1990-03).cbz'), 3, { Series: 'Nintendo Power', Number: 11, Year: 1990, Month: 3 });
    cbz(join(dir, 'GameFan', 'GameFan Vol 01 #01.cbz'), 2, null);
    cbz(join(dir, '_work', 'scratch.cbz'), 1, null);
    // The text that came with #10, as Tesseract's hOCR.
    mkdirSync(join(dir, '_derived', 'Nintendo Power', 'ocr', 'NP-010'), { recursive: true });
    writeFileSync(join(dir, '_derived', 'Nintendo Power', 'ocr', 'NP-010', '001.hocr'), hocr(['Chrono', 'Trigger', 'preview']));
    writeFileSync(join(dir, '_derived', 'Nintendo Power', 'ocr', 'NP-010', '002.hocr'), hocr(['Counselors', 'Corner']));

    const read: number[] = [];
    g = await testApp({ magazineReader: async (image) => (read.push(image.length), hocr(['Tecmo', 'Bowl'])) });
    const cookies = await setUp(g);
    const get = async (url: string) => (await g.app.inject({ url, cookies })).json();
    // Off: none of it.
    expect((await g.app.inject({ url: '/api/v1/magazines', cookies })).statusCode).toBe(404);
    g.settings.update({ 'features.magazines': true, 'magazines.folder': dir });
    expect(await g.magazines.scan()).toBe('3 issues, 3 new; text brought in for 1');

    const { magazines, status } = await get('/api/v1/magazines');
    expect(magazines.map((m: { name: string; issues: number; from: number | null; withText: number }) => [m.name, m.issues, m.from, m.withText])).toEqual([
      ['GameFan', 1, null, 0],
      ['Nintendo Power', 2, 1990, 1],
    ]);
    expect(status).toMatchObject({ found: true, issues: 3, withText: 1 });
    const np = magazines.find((m: { name: string }) => m.name === 'Nintendo Power');
    const issues = (await get(`/api/v1/magazines/${np.id}`)).issues;
    expect(issues.map((i: { label: string; title: string | null; pages: number; text: string }) => [i.label, i.title, i.pages, i.text])).toEqual([
      ['Nintendo Power #10 · January 1990', 'Super Mario Bros. 3', 4, 'hocr'],
      ['Nintendo Power #11 · March 1990', null, 3, 'none'],
    ]);

    // A page's picture, as it is in its CBZ; its words with their boxes.
    const page = await g.app.inject({ url: `/api/v1/magazines/issues/${issues[0].id}/pages/2`, cookies });
    expect(page.headers['content-type']).toBe('image/jpeg');
    expect(page.body).toContain('page 2 of');
    expect((await get(`/api/v1/magazines/issues/${issues[0].id}/pages/1/words`)).words[0]).toEqual({ text: 'Chrono', box: [0, 0, 9, 10] });

    // Searched: the page with the words, marked.
    expect((await get('/api/v1/magazines/search?q=chrono%20trigger')).hits).toEqual([{ issueId: issues[0].id, page: 1, label: 'Nintendo Power #10 · January 1990', snippet: '[Chrono] [Trigger] preview' }]);
    expect((await get('/api/v1/magazines/search?q=%22trigger%20chrono%22')).hits).toEqual([]);

    // Name these: GameFan's issue has no date; given one, it's kept.
    const undated = (await get('/api/v1/magazines/undated')).issues;
    expect(undated.map((i: { label: string }) => i.label)).toEqual(['GameFan Vol. 1 #1']);
    const dated = await g.app.inject({ method: 'PUT', url: `/api/v1/magazines/issues/${undated[0].id}`, cookies, payload: { year: 1992, month: 9 } });
    expect(dated.json()).toMatchObject({ label: 'GameFan Vol. 1 #1 · September 1992', needsDate: false });

    // The night's reading (Tesseract here a stand-in): #11's three pages, then it's searched too.
    g.settings.update({ 'magazines.ocr': true });
    expect(await g.magazines.readText(() => undefined, true)).toBe('1 issue read (3 pages)');
    expect(read).toHaveLength(3);
    expect((await get('/api/v1/magazines/search?q=tecmo')).hits.map((h: { page: number }) => h.page)).toEqual([1, 2, 3]);

    // A file gone from the folder: its issue and its text are forgotten; an unchanged one isn't read again.
    unlinkSync(join(dir, 'Nintendo Power', 'Nintendo Power #011 (1990-03).cbz'));
    expect(await g.magazines.scan()).toBe('2 issues, 1 gone');
    expect((await get('/api/v1/magazines/search?q=tecmo')).hits).toEqual([]);
  });

  it('answers the library and its search within the budget on a big library (It stays snappy)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'squirrelcade-magazines-'));
    for (const m of ['Alpha Gaming', 'Beta Monthly', 'Gamma Power']) {
      mkdirSync(join(dir, m));
      for (let n = 1; n <= 100; n++) cbz(join(dir, m, `${m} #${String(n).padStart(3, '0')} (1990-01).cbz`), 2, { Series: m, Number: n, Year: 1985 + Math.floor(n / 12), Month: (n % 12) + 1 });
    }
    g = await testApp({ magazineReader: async () => hocr(['lorem', 'ipsum', 'sonic', 'hedgehog', 'review']) });
    const cookies = await setUp(g);
    g.settings.update({ 'features.magazines': true, 'magazines.folder': dir, 'magazines.ocr': true });
    await g.magazines.scan();
    for (let i = 0; i < 300; i++) await g.magazines.readText(() => undefined, true);
    const time = async (url: string) => {
      const start = performance.now();
      const res = await g.app.inject({ url, cookies });
      expect(res.statusCode).toBe(200);
      return performance.now() - start;
    };
    expect(await time('/api/v1/magazines')).toBeLessThan(300);
    const { magazines } = (await g.app.inject({ url: '/api/v1/magazines', cookies })).json();
    expect(await time(`/api/v1/magazines/${magazines[0].id}`)).toBeLessThan(300);
    expect(await time('/api/v1/magazines/search?q=sonic%20hedgehog')).toBeLessThan(300);
  }, 120_000);
});
