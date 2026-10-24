import { describe, expect, it } from 'vitest';
import { headerStars, worthPercentile } from './gameHeader.js';

describe("the game page's header (D165)", () => {
  it('gives a game its stars, most telling first', () => {
    const stars = headerStars({
      platformKey: 'super-nintendo',
      platform: 'Super Nintendo',
      top100: { rank: 2, of: 100 },
      reviews: { score: 96, count: 1086, source: 'igdb' },
      released: '1991-08-23',
      launchDay: '1991-08-23',
      read: { bestselling: { rank: 4, list: 'list of best-selling Super Nintendo games', url: 'https://en.wikipedia.org/wiki/x' }, awards: [{ name: 'Game of the Year', year: '1994' }] },
    });
    expect(stars.map((s) => s.label)).toEqual(['#2 Top 100', '#4 best-selling', 'Game of the Year 1994', "Critics' favorite", 'Launch title']);
    expect(stars[0]).toMatchObject({ href: '/roots/super-nintendo?tab=top100', detail: "#2 of 100 on the Super Nintendo's Top 100" });
  });

  it("calls reviews a critics' favorite at 90 or more, and only on enough ratings", () => {
    const base = { platformKey: 'x', platform: 'X', top100: null, released: null, launchDay: null };
    expect(headerStars({ ...base, reviews: { score: 89, count: 500, source: 'igdb' } })).toEqual([]);
    expect(headerStars({ ...base, reviews: { score: 95, count: 3, source: 'igdb' } })).toEqual([]);
    expect(headerStars({ ...base, reviews: { score: 93, count: null, source: 'metacritic' } })).toMatchObject([{ kind: 'critics', detail: 'Metacritic 93' }]);
  });

  it("says how much of the collection a game's worth is above", () => {
    const copies = [
      { title: 'A', valueCents: 1000, quantity: 1 },
      { title: 'B', valueCents: 3000, quantity: 1 },
      { title: 'C', valueCents: 500, quantity: 2 },
      { title: 'D', valueCents: null, quantity: 1 },
    ];
    // B is worth more than A and C: all of the others.
    expect(worthPercentile(copies, 'b', 3000)).toBe(100);
    // C's two copies (10.00) tie A: worth more than none.
    expect(worthPercentile(copies, 'c', 1000)).toBe(0);
    expect(worthPercentile([], 'a', 100)).toBe(100);
  });
});
