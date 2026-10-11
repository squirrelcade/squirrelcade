import { describe, expect, it } from 'vitest';
import type { OfflineCopy } from './offline';
import { allReads, checklist, doubtText, progressText, progressValue, shelfConsoles, shelfMatcher } from './shelfCheck';

const copy: OfflineCopy = {
  version: 1,
  builtAt: '2026-10-11T00:00:00Z',
  platforms: [
    { key: 'playstation-3', name: 'PlayStation 3' },
    { key: 'wii', name: 'Wii' },
    { key: 'nes', name: 'NES' },
  ],
  games: [
    { p: 0, t: 'Darksiders', a: 'own' },
    { p: 0, t: 'Darksiders II', a: 'need', w: { score: 40, priority: 'Low', rank: 30 } },
    { p: 0, t: 'Okami HD', a: 'need', w: { score: 80, priority: 'High', rank: 2 } },
    { p: 0, t: 'Flower', a: 'own-elsewhere', on: ['PlayStation 4'] },
    { p: 0, t: 'Puppeteer', a: 'not-a-target' },
    { p: 1, t: 'Okami', a: 'own' },
    { p: 2, t: 'Duck Hunt', a: 'not-tracked' },
  ],
  barcodes: [],
};

describe('Check a shelf on the page', () => {
  it('offers the consoles with games, by name', () => {
    expect(shelfConsoles(copy).map((c) => c.key)).toEqual(['playstation-3', 'wii']);
  });

  it('makes a checklist: the wishlist first, and unsure spines with what they would be', () => {
    const { matcher, games } = shelfMatcher(copy, 0);
    const list = checklist(matcher.match(allReads([{ text: 'DARKSIDERS II', score: 0.9, turn: 'ccw', box: [] }, { text: 'DARKSIDERS', score: 0.9, turn: 'ccw', box: [] }, { text: 'FLOWER', score: 0.9, turn: 'ccw', box: [] }, { text: 'PUPPETEER', score: 0.9, turn: 'ccw', box: [] }], ['Okami HD'])), games);
    expect(list.need.map((f) => f.title)).toEqual(['Okami HD', 'Darksiders II']);
    expect(list.elsewhere.map((f) => f.title)).toEqual(['Flower']);
    expect(list.other.map((f) => f.title)).toEqual(['Puppeteer']);
    // DARKSIDERS could be Darksiders II cut off: unsure, with what it is if it is Darksiders.
    expect(list.unsure).toEqual([{ title: 'Darksiders', read: 'DARKSIDERS', doubt: 'cut-off', other: 'Darksiders II', answer: 'own' }]);
    expect(doubtText(list.unsure[0]!)).toBe('or Darksiders II, if the end was cut off');
  });

  it('says how far along the reader is', () => {
    expect(progressText({ stage: 'download', done: 12e6, total: 30e6 })).toBe('Getting the reader ready, the first time only: 12 of 30 MB');
    expect(progressText({ stage: 'read', pass: 1, passes: 2, done: 5, total: 50 })).toBe('Reading 5 of 50 (pass 1 of 2)…');
    expect(progressValue({ stage: 'read', pass: 2, passes: 2, done: 50, total: 50 })).toBe(100);
  });
});
