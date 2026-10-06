import { addDays, dayIn, yearsBefore } from '@squirrelcade/core';
import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

describe('past releases', () => {
  it('lists the games that came out around this time in each past year, never one that is not a target', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    const today = dayIn(g.settings.get('general.timeZone'));
    const ago = (years: number, days = 0) => addDays(yearsBefore(today, years), days);
    seedCatalogs(g, {
      owned: ['Celeste', 'Cuphead', 'Gris', 'Tunic', 'Ori', 'Owned Last Year'].map((t, i): [string, string, string] => [String(i + 1), t, 'Nintendo Switch']),
      catalogs: {
        'nintendo-switch': [
          { title: 'Last Year', evidence: 'list', releaseDate: ago(1) },
          { title: 'Owned Last Year', evidence: 'list', releaseDate: ago(1, 10) },
          { title: 'Two Years Back', evidence: 'list', releaseDate: ago(2, -20) },
          { title: 'Outside The Window', evidence: 'list', releaseDate: ago(1, 45) },
          { title: 'Five Years Back', evidence: 'list', releaseDate: ago(5) },
          { title: 'Month Only', evidence: 'list', releaseDate: ago(1).slice(0, 7) },
          { title: 'Not A Target', evidence: 'list', releaseDate: ago(3) },
        ],
      },
    });
    const entryId = (await g.app.inject({ url: '/api/v1/game?platform=nintendo-switch&title=Not%20A%20Target', cookies })).json().catalog.entryId;
    await g.app.inject({ method: 'PATCH', url: `/api/v1/catalogs/entries/${entryId}`, payload: { targetStatus: 'excluded' }, cookies });

    type Year = { yearsAgo: number; from: string; to: string; games: { title: string; status: string; platformKey: string }[] };
    const past = async () => (await g.app.inject({ url: '/api/v1/catalogs/past', cookies })).json() as Year[];
    const years = await past();
    // Four years back by default, each 30 days either side of today's date that year.
    expect(years.map((y) => y.yearsAgo)).toEqual([1, 2, 3, 4]);
    expect(years[0]).toMatchObject({ from: ago(1, -30), to: ago(1, 30) });
    expect(years[0]!.games.map((x) => [x.title, x.status])).toEqual([
      ['Last Year', 'missing'],
      ['Owned Last Year', 'owned'],
    ]);
    expect(years[1]!.games.map((x) => x.title)).toEqual(['Two Years Back']);
    // A game you said isn't a target stays out; a date without its day can't say when it came out.
    expect(years[2]!.games).toEqual([]);
    expect(years.flatMap((y) => y.games).some((x) => x.title === 'Month Only')).toBe(false);

    // Both are settings: fewer years, a wider window.
    g.settings.update({ 'interface.pastYears': 1, 'interface.pastWindowDays': 60 });
    const wider = await past();
    expect(wider).toHaveLength(1);
    expect(wider[0]!.games.map((x) => x.title)).toContain('Outside The Window');
  });
});
