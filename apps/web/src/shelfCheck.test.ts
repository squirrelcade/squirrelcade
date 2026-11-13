import { shelfReadKey } from '@squirrelcade/core';
import { describe, expect, it } from 'vitest';
import type { OfflineCopy } from './offline';
import { allReads, boundsOf, checklist, doubtText, linesFor, photoView, progressText, progressValue, shelfConsoles, shelfFixes, shelfMatcher, unsureLists } from './shelfCheck';

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
    // DARKSIDERS could be Darksiders II cut off: unsure, with what it is if it's Darksiders, or Darksiders II.
    expect(list.unsure).toEqual([{ title: 'Darksiders', read: 'DARKSIDERS', reads: ['DARKSIDERS'], doubt: 'cut-off', other: 'Darksiders II', answer: 'own', otherAnswer: 'need', wanted: true }]);
    expect(doubtText(list.unsure[0]!)).toBe('or Darksiders II, if the end was cut off');
  });

  it("splits the unsure spines: the ones you'd need if it's that game, and the ones you have or don't need either way (T-406)", () => {
    const shelfOf = (games: OfflineCopy['games'], reads: string[]) => {
      const { matcher, games: list } = shelfMatcher({ ...copy, games }, 0);
      return checklist(matcher.match(allReads(reads.map((text) => ({ text, score: 0.9, turn: 'ccw', box: [] })), [])), list);
    };
    // Darksiders (yours) or Darksiders II (needed): you'd need it if it's II.
    const needed = shelfOf(copy.games, ['DARKSIDERS']);
    expect(unsureLists(needed.unsure)).toEqual({ wanted: [expect.objectContaining({ title: 'Darksiders' })], rest: [] });
    // Both yours: either way, you have it.
    const both = shelfOf([{ p: 0, t: 'Darksiders', a: 'own' }, { p: 0, t: 'Darksiders II', a: 'own' }], ['DARKSIDERS']);
    expect(unsureLists(both.unsure)).toEqual({ wanted: [], rest: [expect.objectContaining({ title: 'Darksiders', answer: 'own', otherAnswer: 'own', wanted: false })] });
    // The guess needed (Need it if physical) and the other one not a collecting target: you'd need it if it's the guess.
    const physical = shelfOf([{ p: 0, t: 'Darksiders', a: 'unconfirmed' }, { p: 0, t: 'Darksiders II', a: 'not-a-target' }], ['DARKSIDERS']);
    expect(unsureLists(physical.unsure).wanted).toHaveLength(1);
    // A wishlist game you have only on another console counts as one you'd need; without the wishlist, it doesn't.
    const wished = shelfOf([{ p: 0, t: 'Darksiders', a: 'own' }, { p: 0, t: 'Darksiders II', a: 'own-elsewhere', on: ['Xbox 360'], w: { score: 30, priority: 'Low', rank: 9 } }], ['DARKSIDERS']);
    expect(unsureLists(wished.unsure).wanted).toHaveLength(1);
    const elsewhere = shelfOf([{ p: 0, t: 'Darksiders', a: 'own' }, { p: 0, t: 'Darksiders II', a: 'own-elsewhere', on: ['Xbox 360'] }], ['DARKSIDERS']);
    expect(unsureLists(elsewhere.unsure).rest).toHaveLength(1);
  });

  it('finds a game tapped in a list on the photo, and zooms to it (T-406)', () => {
    const box = (x: number, y: number, w: number, h: number): [number, number][] => [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
    const lines = [
      { text: 'HALO 3', score: 0.9, turn: 'ccw', box: box(100, 50, 40, 400) },
      { text: 'HALO3', score: 0.8, turn: 'ccw', box: box(900, 60, 40, 380) },
      { text: 'HALO 3', score: 0.3, turn: 'ccw', box: box(500, 0, 10, 10) },
      { text: 'OKAMI', score: 0.9, turn: 'ccw', box: box(300, 50, 40, 400) },
    ];
    // Every text read as the game, read well enough to be drawn: both of its spines, not the weak read or another game.
    const found = linesFor(lines, ['HALO 3', 'HALO3', 'Halo 3']);
    expect(found.map((l) => l.box[0])).toEqual([
      [100, 50],
      [900, 60],
    ]);
    expect(boundsOf(found)).toEqual({ x: 100, y: 50, w: 840, h: 400 });
    expect(boundsOf([])).toBeNull();
    expect(linesFor(lines, ['Halo 3'])).toEqual([]); // a title only the vision model read has no box

    const photo = { width: 1000, height: 500 };
    // The whole photo fills a frame of its own shape; in a shorter frame, it's shown whole and centered.
    expect(photoView(photo, { width: 400, height: 200 }, null)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(photoView(photo, { width: 400, height: 100 }, null)).toEqual({ scale: 0.5, x: 100, y: 0 });
    // A spine nearly as tall as the photo is shown whole: lit up, hardly zoomed.
    expect(photoView(photo, { width: 400, height: 200 }, boundsOf(linesFor(lines, ['OKAMI']))).scale).toBeLessThan(1.2);
    // A shorter one: zoomed in, its middle at the frame's middle when the photo allows, never past the photo's edges.
    const one = { x: 300, y: 150, w: 40, h: 120 };
    const v = photoView(photo, { width: 400, height: 200 }, one);
    expect(v.scale).toBeGreaterThan(1);
    const middle = (n: number, start: number, size: number) => n + (start + size / 2) * 0.4 * v.scale;
    expect(middle(v.x, one.x, one.w)).toBeCloseTo(200);
    expect(v.x).toBeLessThanOrEqual(0);
    expect(v.y).toBeLessThanOrEqual(0);
    expect(v.y).toBeGreaterThanOrEqual(200 - 200 * v.scale);
    // A spine at the photo's edge: the photo stays against the frame's edge rather than leaving a gap.
    const edge = photoView(photo, { width: 400, height: 200 }, { x: 0, y: 0, w: 20, h: 60 });
    expect(edge.x).toBe(0);
    expect(edge.y).toBe(0);
    // However small the spine, the zoom stops at 6 times.
    expect(photoView(photo, { width: 400, height: 200 }, { x: 500, y: 250, w: 1, h: 1 }).scale).toBeLessThanOrEqual(6);
  });

  it("takes your fixes, the copy's and this phone's, and names a game off your checklist from the console's full list", () => {
    const line = (text: string) => ({ text, score: 0.9, turn: 'ccw', box: [] as [number, number][] });
    const fixed: OfflineCopy = { ...copy, fixes: [[0, shelfReadKey('DARKSIDERS'), 'Darksiders'], [0, shelfReadKey('PUPPETEER'), 'Flower']] };
    // This phone's own fix wins over the copy's: PUPPETEER is no game at all.
    const fixes = shelfFixes(fixed, 0, { [shelfReadKey('PUPPETEER')]: null });
    const { matcher, games } = shelfMatcher(fixed, 0, ['Heavy Rain']);
    const list = checklist(matcher.match(allReads([line('DARKSIDERS'), line('PUPPETEER'), line('HEAVY RAIN')], []), fixes), games);
    expect(list.own).toEqual([expect.objectContaining({ title: 'Darksiders', fixed: true })]);
    expect(list.unsure).toEqual([]);
    expect(list.other.map((f) => [f.title, f.answer])).toEqual([['Heavy Rain', 'not-tracked']]);
  });

  it('says how far along the reader is', () => {
    expect(progressText({ stage: 'download', done: 12e6, total: 30e6 })).toBe('Getting the reader ready, the first time only: 12 of 30 MB');
    expect(progressText({ stage: 'read', pass: 1, passes: 2, done: 5, total: 50 })).toBe('Reading 5 of 50 (pass 1 of 2)…');
    expect(progressValue({ stage: 'read', pass: 2, passes: 2, done: 50, total: 50 })).toBe(100);
  });
});
