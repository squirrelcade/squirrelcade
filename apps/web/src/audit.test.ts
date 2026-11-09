import { describe, expect, it } from 'vitest';
import { addedText, auditGroups, byConsole, conditionText, findCopies, percent, photoFiles, seenByTitle, shelfBody, unsent } from './audit';
import type { OfflineCopy } from './offline';
import { allReads, checklist, shelfMatcher, type ReadLine } from './shelfCheck';

const copy: OfflineCopy = {
  version: 1,
  builtAt: '2026-11-08T00:00:00Z',
  platforms: [
    { key: 'xbox-360', name: 'Xbox 360' },
    { key: 'playstation-3', name: 'PlayStation 3' },
  ],
  games: [
    { p: 0, t: 'Alan Wake', a: 'own' },
    { p: 0, t: 'Bayonetta', a: 'own', as: ['Bayonetta (Platinum Hits)'] },
    { p: 0, t: 'Lost Odyssey', a: 'need', e: 7 },
    { p: 0, t: 'Viva Pinata', a: 'not-a-target', e: 8 },
    { p: 0, t: 'Portal 2', a: 'own-elsewhere', on: ['PlayStation 3'] },
    { p: 0, t: 'Crackdown', a: 'check', m: ['Crackdown (Platinum Hits)'] },
    { p: 1, t: 'Uncharted', a: 'own' },
  ],
  barcodes: [],
};

const line = (text: string): ReadLine => ({ text, score: 0.95, turn: 'ccw', box: [] });

const shelf = (reads: string[], fixes = new Map<string, string | null>()) => {
  const { matcher, games } = shelfMatcher(copy, 0, ['Banjo-Kazooie: Nuts & Bolts']);
  return checklist(matcher.match(allReads(reads.map(line), []), fixes), games);
};

describe('the collection audit on the page', () => {
  it("turns a shelf's checklist into logged, not logged, on another console, and unsure", () => {
    const groups = auditGroups(shelf(['BAYONETTA', 'ALAN WAKE', 'LOST ODYSSEY', 'VIVA PINATA', 'PORTAL 2', 'CRACKDOWN', 'BANJO-KAZOOIE NUTS & BOLTS']));
    expect(groups.logged.map((f) => f.title)).toEqual(['Alan Wake', 'Bayonetta']);
    // Need it, not a target and a game only in the console's full list: all on the shelf and not in the collection.
    expect(groups.notLogged.map((f) => f.title)).toEqual(['Banjo-Kazooie: Nuts & Bolts', 'Lost Odyssey', 'Viva Pinata']);
    // Had on another console, or maybe had: apart, never ticked.
    expect(groups.elsewhere.map((f) => f.title)).toEqual(['Crackdown', 'Portal 2']);
    expect(groups.unsure).toEqual([]);
  });

  it("sends the copies' own titles to tick, and the games not logged with what was read", () => {
    const groups = auditGroups(shelf(['BAYONETTA', 'ALAN WAKE', 'LOST ODYSSEY']));
    expect(shelfBody(groups)).toEqual({ seen: ['Alan Wake', 'Bayonetta (Platinum Hits)'], notLogged: [{ title: 'Lost Odyssey', read: 'LOST ODYSSEY' }] });
    // A later photo: only what wasn't sent before.
    const later = auditGroups(shelf(['BAYONETTA', 'ALAN WAKE', 'LOST ODYSSEY', 'UNCHARTED']));
    expect(unsent(later, new Set(['Alan Wake']))).toEqual(['Bayonetta (Platinum Hits)']);
  });

  it('lists the copies ticked one line per game, without doubling a copy', () => {
    expect(
      seenByTitle([
        { copyKey: 'b1', title: 'Blue Dragon' },
        { copyKey: 'a1', title: 'Alan Wake' },
        { copyKey: 'b2', title: 'Blue Dragon' },
        { copyKey: 'b1', title: 'Blue Dragon' },
      ]),
    ).toEqual([
      { title: 'Alan Wake', keys: ['a1'] },
      { title: 'Blue Dragon', keys: ['b1', 'b2'] },
    ]);
  });

  it('fills a bar to the end only when every copy is seen', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(151, 152)).toBe(99);
    expect(percent(152, 152)).toBe(100);
    expect(percent(612, 640)).toBe(96);
  });

  it('finds copies by any of their words, and groups them by console', () => {
    const copies = [
      { title: 'Mass Effect', platformKey: 'xbox-360', platform: 'Xbox 360' },
      { title: 'Pokémon Pearl', platformKey: 'nintendo-ds', platform: 'Nintendo DS' },
      { title: 'Mass Effect 2', platformKey: 'xbox-360', platform: 'Xbox 360' },
    ];
    expect(findCopies(copies, 'effect mass').map((c) => c.title)).toEqual(['Mass Effect', 'Mass Effect 2']);
    expect(findCopies(copies, 'pokemon').map((c) => c.title)).toEqual(['Pokémon Pearl']);
    expect(findCopies(copies, '  ')).toHaveLength(3);
    expect(byConsole(copies).map((g) => [g.name, g.copies.length])).toEqual([
      ['Xbox 360', 2],
      ['Nintendo DS', 1],
    ]);
  });

  it("names a shelf's photos as the server keeps them, and says a copy's condition and when it was added", () => {
    expect(photoFiles({ id: 12, photos: 2 })).toEqual(['12-1.jpg', '12-2.jpg']);
    expect(photoFiles({ id: 3, photos: 0 })).toEqual([]);
    expect(conditionText('complete')).not.toBe('complete');
    expect(conditionText('odd')).toBe('odd');
    expect(addedText('2024-09-01')).toBe('added Sep 2024');
    expect(addedText(null)).toBeNull();
    expect(addedText('not a date')).toBeNull();
  });
});
