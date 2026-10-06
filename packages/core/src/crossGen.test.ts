import { describe, expect, it } from 'vitest';
import type { CatalogMatch, TargetResult } from './catalog.js';
import { applyCrossGen, crossGenNeighbors, releaseYear, type CrossGenPartner } from './crossGen.js';
import { matchKey } from './text.js';

const missing = (id: number, title: string, altTitles: string[] = []): TargetResult => ({ target: { id, title, status: 'required', altTitles }, status: 'missing', matches: [], suggestions: [] });

function match(targets: TargetResult[]): CatalogMatch {
  const counts = { targets: targets.length, owned: 0, missing: 0, review: 0, excluded: 0, unconfirmed: 0, upcoming: 0, extra: 0 };
  for (const t of targets) counts[t.status]++;
  return { targets, unmatched: [], counts, percent: 0 };
}

const switch2 = (games: [string, number | null][]): CrossGenPartner => ({
  name: 'Nintendo Switch 2',
  owned: new Map(games.map(([title, year], i) => [matchKey(title), { productId: String(i + 1), title, year }])),
});

describe('cross-generation games', () => {
  it('knows each console family, one generation after another', () => {
    expect(crossGenNeighbors('nintendo-switch')).toEqual(['wii-u', 'nintendo-switch-2']);
    expect(crossGenNeighbors('xbox-series-x')).toEqual(['xbox-one']);
    expect(crossGenNeighbors('playstation-4')).toEqual(['playstation-3', 'playstation-5']);
    expect(crossGenNeighbors('nintendo-64')).toEqual([]);
  });

  it('reads the year a release date starts with', () => {
    expect(releaseYear('2017-03-03')).toBe(2017);
    expect(releaseYear('2025')).toBe(2025);
    expect(releaseYear('TBA')).toBeNull();
    expect(releaseYear(null)).toBeNull();
  });

  it('counts a missing game owned on a neighbor, by its title or another name, within the years', () => {
    const years: Record<number, number> = { 1: 2025, 2: 2018, 3: 2020, 4: 2017 };
    const before = match([missing(1, 'Hollow Knight: Silksong'), missing(2, 'Old Port'), missing(3, 'Only Here'), missing(4, 'Zelda BotW', ['The Legend of Zelda: Breath of the Wild'])]);
    const partner = switch2([
      ['Hollow Knight: Silksong', 2025],
      ['Old Port', 2026],
      ['The Legend of Zelda: Breath of the Wild', 2017],
    ]);
    const after = applyCrossGen(before, [partner], 2, (t) => years[t.id] ?? null);
    expect(after.targets.map((t) => [t.target.title, t.status, t.via ?? null])).toEqual([
      ['Hollow Knight: Silksong', 'owned', 'Nintendo Switch 2'],
      ['Old Port', 'missing', null],
      ['Only Here', 'missing', null],
      ['Zelda BotW', 'owned', 'Nintendo Switch 2'],
    ]);
    expect(after.targets[0]!.matches).toEqual([{ productId: '1', title: 'Hollow Knight: Silksong (Nintendo Switch 2)', method: 'crossgen' }]);
    expect(after.counts).toMatchObject({ owned: 2, missing: 2 });
    expect(after.percent).toBe(50);
    // Any years apart (0), the port counts too; with no partner, nothing changes.
    expect(applyCrossGen(before, [partner], 0, (t) => years[t.id] ?? null).counts.owned).toBe(3);
    expect(applyCrossGen(before, [], 2, () => null)).toBe(before);
  });
});
