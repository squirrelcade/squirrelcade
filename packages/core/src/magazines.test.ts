import { describe, expect, it } from 'vitest';
import { issueFromFileName, issueLabel, mergeSecondRead, pageNames, parseComicInfo, parseHocr, searchText, secondReadPage, skippedName, writeHocr, type PageWord } from './magazines.js';
import { describe as describeShare, expect as expectShare, it as itShare } from 'vitest';

describeShare("a page's text shared (D209)", () => {
  itShare('writes hOCR that reads back as the same words, boxes and text, odd characters and all', () => {
    const page = parseHocr(
      `<div class='ocr_page'><span class='ocr_line' title="bbox 0 0 300 40"><span class='ocrx_word' title='bbox 10 5 120 40; x_wconf 91'>Zelda</span> <span class='ocrx_word' title='bbox 130 5 200 40'>&amp;</span> <span class='ocrx_word' title='bbox 210 5 300 40'>&lt;Link&gt;</span></span><span class='ocr_line' title="bbox 0 50 300 60"><span class='ocrx_word' title='bbox 10 50 60 60'>It's</span> <span class='ocrx_word' title='bbox 70 50 160 60'>"great"</span></span></div>`,
    );
    expectShare(page.words).toHaveLength(5);
    expectShare(parseHocr(writeHocr(page.words, page.text))).toEqual(page);
    // Words the text doesn't line up with still come back, on a line of their own.
    const odd = { words: [...page.words, { text: 'extra', box: [1, 2, 3, 4] as [number, number, number, number] }], text: page.text };
    expectShare(parseHocr(writeHocr(odd.words, odd.text)).words).toEqual(odd.words);
    expectShare(parseHocr(writeHocr([], ''))).toEqual({ words: [], text: '' });
  });
});

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

describe("a page's second read (D244)", () => {
  type Read = [text: string, box: [number, number, number, number], sure?: number];
  /** A sparse read's hOCR: each line a block of its own, as Tesseract's sparse mode writes them. */
  const sparse = (...lines: Read[][]) =>
    `<div class='ocr_page'>${lines
      .map((line) => `<div class='ocr_carea'><p class='ocr_par'><span class='ocr_line' title="bbox 0 0 1 1; baseline 0 0">${line.map(([text, box, sure = 95]) => `<span class='ocrx_word' title='bbox ${box.join(' ')}; x_wconf ${sure}'>${text}</span>`).join(' ')}</span></p></div>`)
      .join('')}</div>`;
  const word = (text: string, box: [number, number, number, number]): PageWord => ({ text, box });
  // A review's page as the first read gave it: its heading read in part ("SUPER" without "METROID"), and its text.
  const first = {
    words: [word('SUPER', [100, 100, 260, 160]), word('for', [100, 300, 130, 320]), word('the', [140, 300, 170, 320]), word('SNES', [180, 300, 240, 320])],
    text: 'SUPER\nfor the SNES',
  };

  it("adds what the first read didn't have, where it belongs, and changes nothing it had", () => {
    const merged = mergeSecondRead(
      first,
      sparse(
        // The heading, whole this time: its new word joins the first read's, on its line.
        [['SUPER', [102, 101, 258, 158]], ['METROID', [280, 100, 520, 160]]],
        // A line the first read had: nothing to add.
        [['for', [100, 300, 130, 320]], ['the', [140, 300, 170, 320]], ['SNES', [181, 301, 239, 319]]],
        // A line that's all new (a box of display type the layout left out): a line of its own, after the others.
        [['Nintendo', [600, 900, 760, 940]], ['Power', [770, 900, 880, 940]]],
        // A word before the first one the first read had goes before it.
        [['only', [60, 300, 95, 320]], ['for', [100, 300, 130, 320]]],
      ),
    );
    expect(merged.added).toBe(4);
    expect(merged.words.map((w) => `${w.text}${w.second ? '*' : ''}`)).toEqual(['SUPER', 'METROID*', 'only*', 'for', 'the', 'SNES', 'Nintendo*', 'Power*']);
    expect(merged.text).toBe('SUPER METROID\nonly for the SNES\nNintendo Power');
    // The first read's words are the same objects' worth: text and box untouched, no mark.
    expect(merged.words.filter((w) => !w.second)).toEqual(first.words);
    // What was written still reads back word for word (the second read's mark isn't part of a shared text).
    expect(parseHocr(writeHocr(merged.words, merged.text))).toEqual({ words: merged.words.map(({ text, box }) => ({ text, box })), text: merged.text });
  });

  it('adds a word only when the reader was sure of it and it is more than a mark', () => {
    const merged = mergeSecondRead(
      first,
      sparse([['Zelda', [600, 500, 700, 540], 69]], [['@', [10, 10, 40, 40]], ['L', [50, 10, 70, 40]], ['.2', [80, 10, 110, 40]], ['II', [600, 600, 640, 640], 70]], [['', [1, 1, 2, 2]]]),
    );
    expect(merged.words.filter((w) => w.second).map((w) => w.text)).toEqual(['II']);
    expect(mergeSecondRead(first, sparse()).added).toBe(0);
    expect(mergeSecondRead(first, 'not hOCR at all')).toEqual({ words: first.words, text: first.text, added: 0, otherwise: 0 });
  });

  it('is safe to do twice: what was added is in its place and is not added again', () => {
    const hocr = sparse([['SUPER', [102, 101, 258, 158]], ['METROID', [280, 100, 520, 160]]], [['Nintendo', [600, 900, 760, 940]], ['Power', [770, 900, 880, 940]]]);
    const once = mergeSecondRead(first, hocr);
    const twice = mergeSecondRead(once, hocr);
    expect(twice.added).toBe(0);
    expect(twice.words).toEqual(once.words);
    expect(twice.text).toBe(once.text);
    // And a later read that finds one thing more adds only that, beside what the earlier one added.
    const more = mergeSecondRead(once, sparse([['Nintendo', [600, 900, 760, 940]], ['Power', [770, 900, 880, 940]], ['presents', [890, 900, 1000, 940]]]));
    expect(more.added).toBe(1);
    expect(more.text).toBe('SUPER METROID\nfor the SNES\nNintendo Power presents');
  });

  it("keeps a text that doesn't line up with its words (one that came with the scan) and adds the new lines after it", () => {
    const came = { words: first.words, text: 'SUPER for\nthe SNES, a review' };
    const merged = mergeSecondRead(came, sparse([['SUPER', [102, 101, 258, 158]], ['METROID', [280, 100, 520, 160]]], [['Nintendo', [600, 900, 760, 940]]]));
    expect(merged.words.map((w) => w.text)).toEqual(['SUPER', 'METROID', 'for', 'the', 'SNES', 'Nintendo']);
    expect(merged.text).toBe('SUPER for\nthe SNES, a review\nMETROID\nNintendo');
    // A page the first read found nothing on.
    expect(mergeSecondRead({ words: [], text: '' }, sparse([['Pac-Man', [10, 10, 200, 60]], ['World', [210, 10, 340, 60]]]))).toEqual({
      words: [
        { text: 'Pac-Man', box: [10, 10, 200, 60], second: true },
        { text: 'World', box: [210, 10, 340, 60], second: true },
      ],
      text: 'Pac-Man World',
      added: 2,
      otherwise: 0,
    });
  });

  it("keeps a sure second reading beside the first read's, for a word the two read differently", () => {
    // A heading whose letters the first read made nothing of, and a word of the text it got one letter short.
    const page = {
      words: [word("IIIIIE'IY-IIIIIE", [102, 805, 976, 940]), word('NIGHTS', [997, 802, 1508, 939]), word('Space', [484, 609, 527, 625]), word('Chanel', [533, 610, 589, 622]), word('5', [594, 610, 605, 622]), word('Warriors.', [700, 610, 790, 622])],
      text: "IIIIIE'IY-IIIIIE NIGHTS\nSpace Chanel 5 Warriors.",
    };
    const hocr = sparse(
      [['NINETY-NINE', [88, 749, 976, 940], 92], ['NIGHTS', [997, 802, 1511, 939], 91]],
      // The same letters with or without a mark are the same reading; a reading the reader wasn't sure of is left out.
      [['Space', [484, 609, 527, 625], 84], ['Channel', [533, 610, 589, 622], 90], ['S', [594, 610, 605, 622], 93], ['Warriors', [700, 610, 786, 622], 96]],
    );
    const merged = mergeSecondRead(page, hocr);
    expect(merged).toMatchObject({ added: 0, otherwise: 2, text: page.text });
    expect(merged.words.map((w) => (w.alt === undefined ? w.text : `${w.text} or ${w.alt}`))).toEqual(["IIIIIE'IY-IIIIIE or NINETY-NINE", 'NIGHTS', 'Space', 'Chanel or Channel', '5', 'Warriors.']);
    // The first reading is still the word; the search knows both.
    expect(merged.words.map((w) => w.text)).toEqual(page.words.map((w) => w.text));
    expect(searchText(merged)).toBe(`${page.text}\nNINETY-NINE Channel`);
    expect(searchText(page)).toBe(page.text);
    // Once: a second time changes nothing, and a reading under the bar never counts.
    expect(mergeSecondRead(merged, hocr)).toMatchObject({ added: 0, otherwise: 0, words: merged.words });
    expect(mergeSecondRead(page, sparse([['Channel', [533, 610, 589, 622], 84]])).otherwise).toBe(0);
    // A word that only overlaps a corner of another, or covers several, is not another reading of it.
    expect(mergeSecondRead(page, sparse([['SpaceChannelFive', [484, 605, 790, 628], 95]])).otherwise).toBe(0);
  });

  it('picks the pages worth a second read: little text, a contents page, a review', () => {
    const body = (n: number) => Array.from({ length: n }, (_, k) => `word${k}`).join(' ');
    expect(secondReadPage(40, '', 120)).toBe(true);
    expect(secondReadPage(40, body(119), 120)).toBe(true);
    expect(secondReadPage(40, body(120), 120)).toBe(false);
    expect(secondReadPage(4, `Contents ${body(300)}`, 120)).toBe(true);
    expect(secondReadPage(40, `Contents ${body(300)}`, 120)).toBe(false);
    expect(secondReadPage(40, `${body(300)} Graphics 8 Gameplay 9 Overall 9`, 120)).toBe(true);
    expect(secondReadPage(40, `${body(300)} a review`, 120)).toBe(false);
    // 0: only contents and reviews.
    expect(secondReadPage(40, '', 0)).toBe(false);
    expect(secondReadPage(4, `Contents ${body(30)}`, 0)).toBe(true);
  });
});
