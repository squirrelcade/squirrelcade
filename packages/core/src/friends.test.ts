import { describe, expect, it } from 'vitest';
import { evenOffers, parseShareFile, ShareFileError, sparesOf, SHARE_FORMAT } from './friends.js';

describe('parseShareFile', () => {
  const file = {
    format: SHARE_FORMAT,
    version: 1,
    from: 'Justin',
    code: 'abc123',
    madeAt: '2026-10-05T20:00:00Z',
    currency: 'usd',
    collection: [{ platformKey: 'playstation-3', platform: 'PlayStation 3', productId: '123', title: 'Cars 2: The Video Game', copies: [{ condition: 'complete', valueCents: 899 }, { condition: 'weird', valueCents: -5 }] }],
    wishlist: [{ platformKey: 'xbox-360', platform: 'Xbox 360', title: 'Halo Reach', rank: 3, acorns: 42.4, priority: 'High' }],
    forTrade: [{ platformKey: 'playstation-3', platform: 'PlayStation 3', productId: '123', title: 'Cars 2: The Video Game', condition: 'loose', valueCents: 400, kind: 'spare' }],
    pricePaid: 'never read',
  };

  it('reads a share file, keeping only what the format has', () => {
    const f = parseShareFile(JSON.stringify(file));
    expect(f).toMatchObject({ from: 'Justin', code: 'abc123', currency: 'USD', madeAt: '2026-10-05T20:00:00.000Z' });
    expect(f.collection![0]!.copies).toEqual([
      { condition: 'complete', valueCents: 899 },
      { condition: 'unknown', valueCents: null },
    ]);
    expect(f.wishlist![0]).toMatchObject({ title: 'Halo Reach', rank: 3, acorns: 42 });
    expect(f.forTrade![0]).toMatchObject({ kind: 'spare', askingCents: null, valueCents: 400 });
    expect(JSON.stringify(f)).not.toContain('never read');
  });

  it("refuses what isn't one, and files from a newer Squirrelcade", () => {
    expect(() => parseShareFile('not json')).toThrow(ShareFileError);
    expect(() => parseShareFile(JSON.stringify({ format: 'something-else', version: 1 }))).toThrow("isn't a Squirrelcade share file");
    expect(() => parseShareFile(JSON.stringify({ ...file, version: 99 }))).toThrow('newer Squirrelcade');
    expect(() => parseShareFile(JSON.stringify({ ...file, collection: [{ platform: 'PS3' }] }))).toThrow('without a console');
  });
});

describe('sparesOf', () => {
  it('keeps the best copy of each game and offers the rest', () => {
    const copies = [
      { id: 1, productId: 'a', completeness: 'loose' as const, valueCents: 500 },
      { id: 2, productId: 'a', completeness: 'complete' as const, valueCents: 1500 },
      { id: 3, productId: 'a', completeness: 'loose' as const, valueCents: 600 },
      { id: 4, productId: 'b', completeness: 'sealed' as const, valueCents: 9000 },
    ];
    expect(sparesOf(copies).map((c) => c.id).sort()).toEqual([1, 3]);
  });
});

describe('evenOffers', () => {
  const pool = [
    { name: 'A', valueCents: 1000, wanted: false },
    { name: 'B', valueCents: 2100, wanted: true },
    { name: 'C', valueCents: 1100, wanted: true },
    { name: 'D', valueCents: 900, wanted: false },
    { name: 'E', valueCents: null, wanted: true },
  ];

  it('finds one item, or a combination, within the margin, what the other side wants first', () => {
    const offers = evenOffers(2000, pool, 10);
    expect(offers[0]).toMatchObject({ items: [{ name: 'B' }], totalCents: 2100, diffPct: 5 });
    // A pair adds up too (C + D = 2000), and items of no known value are never offered.
    expect(offers.some((o) => o.items.map((i) => i.name).join('+') === 'C+D')).toBe(true);
    expect(offers.every((o) => o.items.every((i) => i.name !== 'E'))).toBe(true);
    for (const o of offers) expect(Math.abs(o.diffPct)).toBeLessThanOrEqual(10);
  });

  it('has nothing for a target of no value, or one nothing reaches', () => {
    expect(evenOffers(0, pool, 20)).toEqual([]);
    expect(evenOffers(100_000, pool, 5)).toEqual([]);
  });
});
