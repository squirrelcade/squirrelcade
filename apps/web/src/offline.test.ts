import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { flushPurchases, NotSquirrelcade, offlineBarcode, offlineSearch, unreachable, type OfflineCopy } from './offline';

/** A small copy as the server sends it: two consoles, answers of each kind, a note and a saved barcode. */
const copy: OfflineCopy = {
  version: 1,
  builtAt: '2026-09-28T09:00:00.000Z',
  platforms: [
    { key: 'playstation-3', name: 'PlayStation 3' },
    { key: 'wii', name: 'Wii' },
  ],
  games: [
    { p: 1, t: 'Okami', a: 'own' },
    { p: 0, t: 'Okami', a: 'own-elsewhere', on: ['Wii'], w: { score: 70, priority: 'Medium', rank: 12 } },
    { p: 0, t: 'Okami HD', a: 'need', n: 'Only complete', w: { score: 80, priority: 'High', rank: 3 } },
    { p: 0, t: 'Tales of Graces f', a: 'need', s: ['Namco set'] },
    { p: 0, t: 'Cars 2: The Video Game', a: 'own', as: ['Cars 2'] },
    { p: 1, t: 'Jikkyō Powerful Pro Yakyū', a: 'check', m: ['Jikkyou Powerful Pro Yakyuu'] },
  ],
  barcodes: [['711719541028', 0, 'Tales of Graces f']],
};

describe("Store Mode's offline copy", () => {
  it('answers a typed title as the server ranks it: exact first, then by answer', () => {
    const found = offlineSearch(copy, 'okami');
    expect(found.map((r) => [r.platform, r.title, r.answer])).toEqual([
      ['PlayStation 3', 'Okami', 'own-elsewhere'],
      ['Wii', 'Okami', 'own'],
      ['PlayStation 3', 'Okami HD', 'need'],
    ]);
    // Every part a result card shows, rebuilt from the short keys.
    expect(found[0]).toMatchObject({ ownedOn: ['Wii'], wishlist: { rank: 12 }, ownedAs: [], note: null, pending: false });
    expect(found[1]!.ownedAs).toEqual(['Okami']);
    expect(found[2]!.note).toBe('Only complete');
    expect(offlineSearch(copy, 'cars 2')[0]!.ownedAs).toEqual(['Cars 2']);
    // One console, a limit, and a query too short to search.
    expect(offlineSearch(copy, 'okami', { platformKey: 'wii' })).toHaveLength(1);
    expect(offlineSearch(copy, 'okami', { limit: 2 })).toHaveLength(2);
    expect(offlineSearch(copy, 'o')).toEqual([]);
  });

  it('finds a Japanese title typed with its long vowels written out', () => {
    expect(offlineSearch(copy, 'jikkyou powerful')[0]).toMatchObject({ platform: 'Wii', answer: 'check', maybe: ['Jikkyou Powerful Pro Yakyuu'] });
  });

  it('knows the barcodes you saved, and only those', () => {
    const known = offlineBarcode(copy, '7117-1954-1028');
    expect(known).toMatchObject({ title: 'Tales of Graces f' });
    expect(known!.results).toEqual([expect.objectContaining({ platformKey: 'playstation-3', title: 'Tales of Graces f', answer: 'need', sets: ['Namco set'] })]);
    expect(offlineBarcode(copy, '045496590036')).toBeNull();
    expect(offlineBarcode(copy, '123')).toBeNull();
  });

  it('sends purchases kept without a connection, oldest first, keeping the rest when Squirrelcade stops answering', async () => {
    const kept = [1, 2, 3, 4].map((entryId) => ({ entryId, title: `Game ${entryId}`, platform: 'PlayStation 3', at: '2026-09-28T09:00:00.000Z' }));
    const posted: number[] = [];
    // All answered: every one sent.
    expect(await flushPurchases(kept, async (id) => void posted.push(id))).toEqual({ sent: kept, left: [] });
    expect(posted).toEqual([1, 2, 3, 4]);
    // A game no longer in the catalog is dropped; no connection at the third stops, and it waits with the fourth.
    const answer = async (id: number) => {
      if (id === 2) throw new ApiError(404, 'not-found', 'No such catalog game.');
      if (id === 3) throw new TypeError('Failed to fetch');
    };
    expect(await flushPurchases(kept, answer)).toEqual({ sent: [kept[0]], left: [kept[2], kept[3]] });
    // Signed out meanwhile: nothing is lost.
    expect(await flushPurchases(kept, async () => Promise.reject(new ApiError(401, 'unauthorized', 'Sign in first.')))).toEqual({ sent: [], left: kept });
  });

  it("gives a catalog game's id for \"I bought it\", and none for a copy outside the catalogs", () => {
    const withIds: OfflineCopy = { ...copy, games: [{ p: 0, t: 'Tales of Graces f', a: 'need', e: 42 }, { p: 1, t: 'Katamari Forever', a: 'own-not-in-catalog' }] };
    expect(offlineSearch(withIds, 'tales of graces')[0]!.entryId).toBe(42);
    expect(offlineSearch(withIds, 'katamari')[0]).not.toHaveProperty('entryId');
  });

  it("tells Squirrelcade's own answers from not reaching it", () => {
    // No connection, no answer in time, a proxy without its server, or another page answering.
    expect(unreachable(new TypeError('Failed to fetch'))).toBe(true);
    expect(unreachable(Object.assign(new Error('timed out'), { name: 'TimeoutError' }))).toBe(true);
    expect(unreachable(new ApiError(502, 'error', 'Bad Gateway'))).toBe(true);
    expect(unreachable(new NotSquirrelcade('a sign-in page'))).toBe(true);
    // Squirrelcade answering, even with a problem, is its answer.
    expect(unreachable(new ApiError(401, 'unauthorized', 'Sign in first.'))).toBe(false);
    expect(unreachable(new ApiError(500, 'error', 'Something broke'))).toBe(false);
  });
});
