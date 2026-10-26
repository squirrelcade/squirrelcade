import { describe, expect, it } from 'vitest';
import { issueFromFileName, issueLabel, pageNames, parseComicInfo, parseHocr, skippedName } from './magazines.js';

describe('magazines (D177)', () => {
  it("reads an issue's ComicInfo.xml", () => {
    const xml = '<?xml version="1.0"?><ComicInfo><Title>Super Mario Bros. 2</Title><Series>Nintendo Power</Series><Number>1</Number><Volume>1</Volume><Year>1988</Year><Month>7</Month><Publisher>Nintendo of America</Publisher><PageCount>108</PageCount><Notes>from x.pdf</Notes></ComicInfo>';
    expect(parseComicInfo(xml)).toEqual({ magazine: 'Nintendo Power', number: '1', volume: '1', year: 1988, month: 7, title: 'Super Mario Bros. 2', publisher: 'Nintendo of America', pages: 108 });
    expect(parseComicInfo('<ComicInfo><Series>Tips &amp; Tricks</Series><Month>0</Month></ComicInfo>')).toMatchObject({ magazine: 'Tips & Tricks', month: null, year: null });
  });

  it("reads what a file name says, for an issue without one", () => {
    expect(issueFromFileName('Nintendo Power #001 (1988-07) Super Mario Bros. 2.cbz')).toMatchObject({ magazine: 'Nintendo Power', number: '1', year: 1988, month: 7, title: 'Super Mario Bros. 2' });
    expect(issueFromFileName('Computer Gaming World #268 (2006-11).cbz')).toMatchObject({ magazine: 'Computer Gaming World', number: '268', year: 2006, month: 11, title: null });
    expect(issueFromFileName('GameFan Vol 01 #01.cbz')).toMatchObject({ magazine: 'GameFan', volume: '1', number: '1', year: null });
    expect(issueFromFileName('Some Scan.cbz')).toMatchObject({ magazine: 'Some Scan', number: null });
  });

  it('leaves out working folders, and reads pages in their order', () => {
    expect(['_work', '_derived', '.kavitaignore', 'Nintendo Power'].filter((n) => !skippedName(n, ['_*', '.*']))).toEqual(['Nintendo Power']);
    expect(pageNames(['010.jpg', 'ComicInfo.xml', '002.jpg', '001.jpg', '__MACOSX/001.jpg', '100.jpg'])).toEqual(['001.jpg', '002.jpg', '010.jpg', '100.jpg']);
  });

  it("reads a page's hOCR: its words with their boxes, and its text line by line", () => {
    const hocr = `<div class='ocr_page' title='bbox 0 0 1280 1700'><span class='ocr_line' title="bbox 10 10 300 40"><span class='ocrx_word' title='bbox 10 10 120 40; x_wconf 96'>Chrono</span> <span class='ocrx_word' title='bbox 130 10 300 40; x_wconf 95'>Trigger</span></span><span class='ocr_line' title="bbox 10 50 300 80"><span class='ocrx_word' title='bbox 10 50 60 80; x_wconf 90'>9.5&amp;</span></span></div>`;
    expect(parseHocr(hocr)).toEqual({
      words: [
        { text: 'Chrono', box: [10, 10, 120, 40] },
        { text: 'Trigger', box: [130, 10, 300, 40] },
        { text: '9.5&', box: [10, 50, 60, 80] },
      ],
      text: 'Chrono Trigger\n9.5&',
    });
  });

  it('names an issue', () => {
    expect(issueLabel({ magazine: 'Nintendo Power', number: '45', volume: null, year: 1993, month: 2 })).toBe('Nintendo Power #45 · February 1993');
    expect(issueLabel({ magazine: 'GameFan', number: '1', volume: '1', year: null, month: null })).toBe('GameFan Vol. 1 #1');
  });
});
