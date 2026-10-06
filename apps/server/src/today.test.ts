import { addDays, dayIn, yearsBefore } from '@squirrelcade/core';
import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp | undefined;
afterEach(async () => {
  await g?.cleanup();
  g = undefined;
});

describe('today', () => {
  it("puts this week's releases, lent games due back and the last update on one page", async () => {
    g = await testApp();
    const cookies = await setUp(g);
    const today = dayIn(g.settings.get('general.timeZone'));
    const listed = { evidence: 'list' as const };
    seedCatalogs(g, {
      owned: [
        ['1', 'Okami', 'Playstation 3'],
        ['2', 'Journey', 'Playstation 3'],
      ],
      catalogs: {
        'playstation-3': [
          'Okami',
          'Journey',
          { title: 'Soon Game', releaseDate: addDays(today, 3), ...listed },
          { title: 'Later Game', releaseDate: addDays(today, 40), ...listed },
        ],
      },
    });
    // Journey lent a month ago: overdue.
    const key = (await g.app.inject({ url: '/api/v1/collection/items?q=Journey', cookies })).json().items[0].copyKey;
    await g.app.inject({ method: 'POST', url: '/api/v1/loans', cookies, payload: { key, lentTo: 'Alex', lentAt: addDays(today, -40) } });

    const t = (await g.app.inject({ url: '/api/v1/today', cookies })).json();
    expect(t).toMatchObject({ date: today, gotd: null, deals: [], dealsOn: false });
    expect(t.releases.map((r: { title: string }) => r.title)).toEqual(['Soon Game']);
    expect(t.loans).toEqual([expect.objectContaining({ title: 'Journey', lentTo: 'Alex', overdue: true })]);
    expect(t.lastUpdate).toMatchObject({ addedCount: 2, removedCount: 0 });

    // The game of the day comes along once it's on.
    g.settings.update({ 'gotd.enabled': true });
    expect((await g.app.inject({ url: '/api/v1/today', cookies })).json().gotd).toMatchObject({ platform: 'PlayStation 3' });
  });
  it('shows this week in game history and the lists closest to done', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    const today = dayIn(g.settings.get('general.timeZone'));
    const listed = { evidence: 'list' as const };
    seedCatalogs(g, {
      owned: [['1', 'Okami', 'Playstation 3']],
      catalogs: {
        'playstation-3': [
          { title: 'Okami', releaseDate: addDays(yearsBefore(today, 15), -1), ...listed },
          { title: 'Old Hit', releaseDate: yearsBefore(today, 12), ...listed },
          { title: 'Far Game', releaseDate: addDays(yearsBefore(today, 10), 20), ...listed },
          { title: 'This Year', releaseDate: addDays(today, -1), ...listed },
          ...Array.from({ length: 10 }, (_, i) => `Filler ${i + 1}`),
        ],
      },
    });
    const t = (await g.app.inject({ url: '/api/v1/today', cookies })).json();
    // Today's date first, then yesterday's; one released 20 days off this week, or this year, isn't history.
    expect(t.history.map((h: { title: string; yearsAgo: number; offset: number; status: string }) => [h.title, h.yearsAgo, h.offset, h.status])).toEqual([
      ['Old Hit', 12, 0, 'missing'],
      ['Okami', 15, -1, 'owned'],
    ]);
    // The catalog: 1 owned of the 14 games out (the one out yesterday counts too).
    expect(t.completion.lines).toEqual([{ kind: 'catalog', key: 'playstation-3', name: 'PlayStation 3', owned: 1, total: 14, percent: 7.1 }]);
    expect(t.completion.done).toBe(0);
  });
});
