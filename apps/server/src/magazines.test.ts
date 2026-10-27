import { mkdirSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
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
    cbz(join(dir, 'GameFan', 'GameFan Vol 01 #02.cbz'), 2, null);
    cbz(join(dir, 'GameFan', 'GameFan Vol 01 #04.cbz'), 2, null);
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
    expect(await g.magazines.scan()).toBe('4 issues, 4 new; 1 dated by the magazine index; text brought in for 1');

    const { magazines, status } = await get('/api/v1/magazines');
    expect(magazines.map((m: { name: string; issues: number; from: number | null; withText: number }) => [m.name, m.issues, m.from, m.withText])).toEqual([
      ['GameFan', 2, 1992, 0],
      ['Nintendo Power', 2, 1990, 1],
    ]);
    expect(status).toMatchObject({ found: true, issues: 4, withText: 1 });
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

    // Name these: the magazine index dates GameFan's #2 (D181), not #4, which the index doesn't know; given one, it's kept.
    const named = await get('/api/v1/magazines/undated');
    expect(named.issues.map((i: { label: string }) => i.label)).toEqual(['GameFan Vol. 1 #4']);
    expect(named.guessed.map((i: { label: string; dateFrom: string }) => [i.label, i.dateFrom])).toEqual([['GameFan Vol. 1 #2 · December 1992', 'index']]);
    const dated = await g.app.inject({ method: 'PUT', url: `/api/v1/magazines/issues/${named.issues[0].id}`, cookies, payload: { year: 1993, month: 3 } });
    expect(dated.json()).toMatchObject({ label: 'GameFan Vol. 1 #4 · March 1993', needsDate: false, dateFrom: null });

    // The night's reading (Tesseract here a stand-in): #11's three pages, then it's searched too.
    g.settings.update({ 'magazines.ocr': true });
    expect(await g.magazines.readText(() => undefined, true)).toBe('1 issue read (3 pages)');
    expect(read).toHaveLength(3);
    expect((await get('/api/v1/magazines/search?q=tecmo')).hits.map((h: { page: number }) => h.page)).toEqual([1, 2, 3]);

    // A file gone from the folder: its issue and its text are forgotten; an unchanged one isn't read again.
    unlinkSync(join(dir, 'Nintendo Power', 'Nintendo Power #011 (1990-03).cbz'));
    expect(await g.magazines.scan()).toBe('3 issues, 1 gone; 1 dated by the magazine index');
    expect((await get('/api/v1/magazines/search?q=tecmo')).hits).toEqual([]);
  });

  it("sends a page as wide as the screen needs, made once and kept, and its words' boxes in the scan's pixels (D182)", async () => {
    dir = mkdtempSync(join(tmpdir(), 'squirrelcade-magazines-'));
    mkdirSync(join(dir, 'Nintendo Power'));
    const scan = await sharp({ create: { width: 2000, height: 2600, channels: 3, background: '#c33' } }).jpeg().toBuffer();
    writeFileSync(join(dir, 'Nintendo Power', 'Nintendo Power #001 (1988-07).cbz'), writeZip([{ name: '001.jpg', data: scan }]));
    writeFileSync(join(dir, 'Nintendo Power', 'Nintendo Power #002 (1988-09).cbz'), writeZip([{ name: '001.jpg', data: Buffer.from('not a picture') }]));
    g = await testApp({ magazineReader: async () => hocr(['Zelda']) });
    const cookies = await setUp(g);
    g.settings.update({ 'features.magazines': true, 'magazines.folder': dir, 'magazines.ocr': true });
    await g.magazines.scan();
    await g.magazines.readText(() => undefined, true);
    await g.magazines.readText(() => undefined, true);
    const [one, two] = (await g.app.inject({ url: `/api/v1/magazines/${(await g.app.inject({ url: '/api/v1/magazines', cookies })).json().magazines[0].id}`, cookies })).json().issues;
    const width = async (url: string) => {
      const res = await g.app.inject({ url, cookies });
      expect(res.statusCode).toBe(200);
      return (await sharp(res.rawPayload).metadata()).width;
    };
    // A phone's screen (390 pixels at 3x): the next width up, 1200; a cover tile, 240; none asked, the whole scan.
    expect(await width(`/api/v1/magazines/issues/${one.id}/pages/1?w=1170`)).toBe(1200);
    expect(await width(`/api/v1/magazines/issues/${one.id}/pages/1?w=200`)).toBe(240);
    expect(await width(`/api/v1/magazines/issues/${one.id}/pages/1`)).toBe(2000);
    // Never wider than the setting; kept in magazines-cache.
    g.settings.update({ 'magazines.pageWidth': 800 });
    expect(await width(`/api/v1/magazines/issues/${one.id}/pages/1?w=3000`)).toBe(800);
    expect(readdirSync(join(g.env.configDir, 'magazines-cache')).sort()).toEqual([`${one.id}-${one.version}-1-1200.jpg`, `${one.id}-${one.version}-1-240.jpg`, `${one.id}-${one.version}-1-800.jpg`]);
    // Past its room, the ones used longest ago go.
    g.settings.update({ 'magazines.cacheMb': 50 });
    expect(await g.magazines.pruneCache()).toBe(0);
    // A picture that can't be read is sent as it is.
    expect((await g.app.inject({ url: `/api/v1/magazines/issues/${two.id}/pages/1?w=400`, cookies })).body).toBe('not a picture');
    // The words' boxes come with the scan's size, so the marks land right on a smaller page.
    expect((await g.app.inject({ url: `/api/v1/magazines/issues/${one.id}/pages/1/words`, cookies })).json()).toMatchObject({ width: 2000, height: 2600 });
  });

  it("finds a review's citation in the owner's issues, at its printed page once the offset is set (D191)", async () => {
    dir = mkdtempSync(join(tmpdir(), 'squirrelcade-magazines-'));
    mkdirSync(join(dir, 'Electronic Gaming Monthly'));
    cbz(join(dir, 'Electronic Gaming Monthly', 'Electronic Gaming Monthly #059 (1994-06).cbz'), 120, { Series: 'Electronic Gaming Monthly', Number: 59, Year: 1994, Month: 6 });
    cbz(join(dir, 'Electronic Gaming Monthly', 'Electronic Gaming Monthly #060 (1994-07).cbz'), 120, { Series: 'Electronic Gaming Monthly', Number: 60, Year: 1994, Month: 7 });
    g = await testApp();
    const cookies = await setUp(g);
    g.settings.update({ 'features.magazines': true, 'magazines.folder': dir });
    await g.magazines.scan();
    // Super Metroid's EGM review: cited by date and page.
    const cited = { work: 'EGM', date: 'June 1994', issue: null, page: '28' };
    const found = g.magazines.findScan(cited)!;
    expect(found).toMatchObject({ page: 28, label: 'Electronic Gaming Monthly #59 · June 1994', offsetKnown: false });
    // By its number, too; and not at all for a magazine or month the owner hasn't.
    expect(g.magazines.findScan({ work: 'Electronic Gaming Monthly', date: null, issue: '60', page: null })).toMatchObject({ label: 'Electronic Gaming Monthly #60 · July 1994', page: 1 });
    expect(g.magazines.findScan({ ...cited, work: 'Famitsu' })).toBeNull();
    expect(g.magazines.findScan({ ...cited, date: 'May 1994' })).toBeNull();
    // The owner says file page 32 is printed page 28: the review opens at 32.
    const set = await g.app.inject({ method: 'PUT', url: `/api/v1/magazines/issues/${found.issueId}/page-offset`, cookies, payload: { filePage: 32, printed: 28 } });
    expect(set.json()).toMatchObject({ pageOffset: 4 });
    expect(g.magazines.findScan(cited)).toMatchObject({ page: 32, offsetKnown: true });
  });

  it('finds the games in an issue: its cited reviews, the titles on its pages, the owner\'s answers and marks (D191, D192)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'squirrelcade-magazines-'));
    mkdirSync(join(dir, 'Electronic Gaming Monthly'));
    cbz(join(dir, 'Electronic Gaming Monthly', 'Electronic Gaming Monthly #059 (1994-06).cbz'), 3, { Series: 'Electronic Gaming Monthly', Number: 59, Year: 1994, Month: 6 });
    // Page 2's text: Super Metroid's review with the Review Crew's scores, and a passing word that is also a game.
    const hocrLines = (lines: string[][]) =>
      `<div class='ocr_page'>${lines.map((ws, y) => `<span class='ocr_line'>${ws.map((w, x) => `<span class='ocrx_word' title='bbox ${x * 100} ${y * 40} ${x * 100 + 90} ${y * 40 + (y === 0 ? 60 : 20)}; x_wconf 95'>${w}</span>`).join(' ')}</span>`).join('')}</div>`;
    const pages: Record<number, string> = {
      1: hocrLines([['Contents']]),
      2: hocrLines([['SUPER', 'METROID'], ['Samus', 'returns', 'in', 'Super', 'Metroid', 'the', 'best', 'yet'], ['9.0', '9.0', '9.5', '9.0'], ['Mega', 'Man', 'X', 'sneaks', 'in']]),
      3: hocrLines([['Next', 'month']]),
    };
    g = await testApp({ magazineReader: async () => pages[Object.keys(pages).length === 0 ? 1 : (read++ % 3) + 1]! });
    let read = 0;
    const cookies = await setUp(g);
    g.settings.update({ 'features.magazines': true, 'magazines.folder': dir, 'magazines.ocr': true });
    await g.magazines.scan();
    await g.magazines.readText(() => undefined, true);
    const issueId = (await g.app.inject({ url: '/api/v1/magazines/undated', cookies })).json() && g.magazines.findScan({ work: 'EGM', date: 'June 1994', issue: null, page: '2' })!.issueId;
    // A citation seeds it: Donkey Kong Country's EGM review, cited at page 3.
    expect(g.magazines.seedCitations([{ platformKey: 'super-nintendo', title: 'Donkey Kong Country', outlet: 'EGM', score: '9/10', work: 'EGM', date: 'June 1994', issue: null, page: '3' }])).toBe(1);
    // The titles on the pages: from the games out around June 1994.
    const result = await g.magazines.spotGames(() => [
      { platformKey: 'super-nintendo', title: 'Super Metroid', day: '1994-04-18' },
      { platformKey: 'super-nintendo', title: 'Mega Man X', day: '1994-01-01' },
      { platformKey: 'super-nintendo', title: 'Donkey Kong Country', day: '1994-11-21' },
    ]);
    expect(result).toBe('1 issues looked through: 1 games linked, 1 to answer on Review > Magazines');
    const mentions = (await g.app.inject({ url: '/api/v1/game/magazines?title=Super%20Metroid', cookies })).json().mentions;
    expect(mentions).toEqual([expect.objectContaining({ issueId, page: 2, title: 'Super Metroid', source: 'ocr', state: 'linked', kind: 'review', score: '9.0 / 9.0 / 9.5 / 9.0' })]);
    expect((await g.app.inject({ url: '/api/v1/game/magazines?title=Donkey%20Kong%20Country', cookies })).json().mentions).toEqual([
      expect.objectContaining({ page: 3, source: 'citation', score: '9/10', printed: 'EGM' }),
    ]);
    // Mega Man X is a maybe (three short words in small type): on Review > Magazines.
    const review = (await g.app.inject({ url: '/api/v1/magazines/review', cookies })).json().mentions;
    expect(review.map((m: { title: string; state: string }) => [m.title, m.state])).toEqual([['Mega Man X', 'suggested']]);
    // The owner says yes: linked, and a rule for those words from now on.
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/magazines/mentions/${review[0].id}/answer`, cookies, payload: { answer: 'yes' } })).json()).toEqual({ ok: true });
    expect((await g.app.inject({ url: '/api/v1/magazines/review', cookies })).json().mentions).toEqual([]);
    await g.magazines.spotGames(() => [{ platformKey: 'super-nintendo', title: 'Mega Man X', day: '1994-01-01' }, { platformKey: 'super-nintendo', title: 'Super Metroid', day: '1994-04-18' }]);
    expect((await g.app.inject({ url: '/api/v1/game/magazines?title=Mega%20Man%20X', cookies })).json().mentions).toEqual([expect.objectContaining({ state: 'linked', confidence: 1 })]);
    // A game marked by hand (its logo), and a page's games with the scan's size.
    const marked = await g.app.inject({ method: 'POST', url: `/api/v1/magazines/issues/${issueId}/pages/1/mentions`, cookies, payload: { platformKey: 'super-nintendo', title: 'Stunt Race FX', box: [10, 10, 200, 80] } });
    expect(marked.json()).toMatchObject({ title: 'Stunt Race FX', source: 'owner', state: 'linked', box: [10, 10, 200, 80] });
    const page2 = (await g.app.inject({ url: `/api/v1/magazines/issues/${issueId}/pages/2/games`, cookies })).json();
    expect(page2.games.map((m: { title: string }) => m.title).sort()).toEqual(['Mega Man X', 'Super Metroid']);
    expect(page2.games[0]).toHaveProperty('answer');
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
