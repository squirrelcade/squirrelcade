import { afterEach, describe, expect, it } from 'vitest';
import { bestSellingLists } from './db/schema.js';
import { setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g?.cleanup();
});

describe('Roots > Top 20 (T-218)', () => {
  it("lists each year from now back, the best sellers in the region asked for or the year's own, and says what a year lacks", async () => {
    g = await testApp();
    const cookies = await setUp(g);
    g.db.insert(bestSellingLists).values({ platformKey: 'year:1990', page: '1990 in video games', data: JSON.stringify({ japan: [{ title: 'Super Mario World', article: 'Super Mario World' }] }), readAt: new Date().toISOString() }).run();
    g.db.insert(bestSellingLists).values({ platformKey: 'year:2015', page: '2015 in video games', data: JSON.stringify({ us: [{ title: 'Call of Duty: Black Ops III', article: null }, { title: 'Madden NFL 16', article: null }] }), readAt: new Date().toISOString() }).run();
    const get = async (url: string) => (await g.app.inject({ url, cookies })).json();
    const selling = await get('/api/v1/roots/top20?kind=selling&all=1');
    expect(selling).toMatchObject({ kind: 'selling', region: 'us' });
    expect(selling.years[0].year).toBe(new Date().getFullYear());
    const year = (y: number) => selling.years.find((x: { year: number }) => x.year === y);
    expect(year(2015)).toMatchObject({ region: 'us', note: 'Its list has 2', games: [{ rank: 1, title: 'Call of Duty: Black Ops III' }, { rank: 2, title: 'Madden NFL 16' }] });
    // 1990 has only Japan's chart: shown, and said whose.
    expect(year(1990)).toMatchObject({ region: 'japan', games: [{ title: 'Super Mario World' }] });
    expect(year(2000)).toMatchObject({ games: [], note: 'No sales list for this year' });
    // Highest rated without IGDB's lists: every year says it has none rated enough.
    const rated = await get('/api/v1/roots/top20?kind=rated&all=1');
    expect(rated.years[0].note).toMatch(/has 10 ratings yet/);
  });
});
