import { describe, expect, it } from 'vitest';
import { guessKind, samplePages, type SamplePage } from './pages.js';

const filler = Array.from({ length: 150 }, (_, i) => `word${i}`).join(' ');

describe("the Leaves yardstick's sample of pages (docs/leaves-yardstick.md)", () => {
  it("guesses a page's kind from its text, to spread the sample", () => {
    expect(guessKind(40, 'BUY IT NOW only $49.99')).toBe('ad');
    expect(guessKind(4, `CONTENTS ${filler}`)).toBe('contents');
    // "contents" far into an issue is a word, not the contents page.
    expect(guessKind(90, `the contents of the box ${filler}`)).toBe('other');
    expect(guessKind(60, `Review Crew ${filler} graphics 9 gameplay 8 overall 9`)).toBe('review');
    expect(guessKind(30, `Preview ${filler} release date: fall, a first look`)).toBe('preview');
    expect(guessKind(12, `News ${filler} Sega announced today`)).toBe('news');
  });

  it('spreads the sample over magazines, eras and kinds, the same pages every time', () => {
    const pages: SamplePage[] = [];
    for (let i = 0; i < 4000; i++) pages.push({ issueId: 1 + (i % 40), page: 1 + Math.floor(i / 40), magazine: 'Big Monthly', year: 1994 + (i % 10), kind: i % 5 === 0 ? 'review' : i % 7 === 0 ? 'ad' : 'other' });
    for (let i = 0; i < 40; i++) pages.push({ issueId: 100, page: i + 1, magazine: 'Small Club News', year: 1983, kind: i === 3 ? 'contents' : 'other' });
    const picked = samplePages(pages, 60);
    expect(picked.length).toBeGreaterThan(45);
    expect(picked.length).toBeLessThan(75);
    // The small magazine is there, though it has a hundredth of the pages; so is each era of the big one.
    expect(picked.filter((p) => p.magazine === 'Small Club News').length).toBeGreaterThanOrEqual(2);
    expect(new Set(picked.filter((p) => p.magazine === 'Big Monthly').map((p) => (p.year < 1995 ? 'a' : p.year < 2000 ? 'b' : 'c'))).size).toBe(3);
    // The kinds take turns: reviews and ads are a fifth and a seventh of the pages, and far more of the sample.
    expect(picked.filter((p) => p.kind === 'review').length).toBeGreaterThan(picked.length / 5);
    expect(picked.some((p) => p.kind === 'contents')).toBe(true);
    expect(samplePages(pages, 60)).toEqual(picked);
  });
});
