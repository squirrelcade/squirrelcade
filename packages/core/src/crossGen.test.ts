import { describe, expect, it } from 'vitest';
import { completionPercent, countedTargets, type CatalogMatch, type TargetResult } from './catalog.js';
import { applyCrossGen, crossGenNeighbors, releaseYear, sameGameAcross, type CrossGenPartner } from './crossGen.js';
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

  it('never counts a game through a copy whose only shared thing is a name in another script (D159)', () => {
    // On the owner's install, every Switch 2 game with a Chinese or Japanese other name counted as their Switch copy of
    // Zombie Army Trilogy, whose Korean name had the same (empty) key.
    const before = match([missing(1, 'Indiana Jones and the Great Circle', ['夺宝奇兵：古老之圈']), missing(2, 'Monster Hunter Wilds', ['モンスターハンターワイルズ'])]);
    const partner: CrossGenPartner = {
      name: 'Nintendo Switch',
      owned: new Map(['Zombie Army Trilogy', '좀비 아미 트릴로지'].map((n) => [matchKey(n), { productId: '1', title: 'Zombie Army Trilogy', year: 2020 }])),
    };
    expect(applyCrossGen(before, [partner], 0, () => null).targets.map((t) => t.status)).toEqual(['missing', 'missing']);
    // The same name in another script still counts.
    const same: CrossGenPartner = { name: 'Nintendo Switch', owned: new Map([[matchKey('モンスターハンターワイルズ'), { productId: '2', title: 'Monster Hunter Wilds', year: 2025 }]]) };
    expect(applyCrossGen(before, [same], 0, () => null).targets.map((t) => t.status)).toEqual(['missing', 'owned']);
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

  it("keeps catalog matching's completion rule: other regions' releases not owned don't count (1.5.2)", () => {
    // On the owner's install every console with a cross-generation game read low (Switch 34.3% for 42.1%): the
    // percent was worked out again with the extras left in.
    const extra = (id: number, title: string): TargetResult => ({ target: { id, title, status: 'extra' }, status: 'extra', matches: [], suggestions: [] });
    const other = (id: number, status: 'excluded' | 'unconfirmed' | 'upcoming'): TargetResult => ({ target: { id, title: `T${id}`, status }, status, matches: [], suggestions: [] });
    const owned: TargetResult = { target: { id: 1, title: 'Owned Here', status: 'required' }, status: 'owned', matches: [{ productId: '9', title: 'Owned Here', method: 'exact' }], suggestions: [] };
    const before = match([owned, missing(2, 'Hollow Knight: Silksong'), missing(3, 'Only Here'), missing(4, 'Not Yet'), extra(5, 'Japan Only'), extra(6, 'Europe Only'), extra(7, 'Asia Only'), other(8, 'excluded'), other(9, 'unconfirmed'), other(10, 'upcoming')]);
    // match() above leaves the percent at 0; catalog matching's rule gives 1 of the 4 that count.
    expect(completionPercent(before.counts)).toBe(25);
    const after = applyCrossGen(before, [switch2([['Hollow Knight: Silksong', 2025]])], 0, () => null);
    expect(after.counts).toMatchObject({ owned: 2, missing: 2, extra: 3 });
    expect(countedTargets(after.counts)).toBe(4);
    expect(after.percent).toBe(50); // 2 of 4; the old sum kept the 3 extras in: 2 of 7 = 28.6
    expect(after.percent).toBe(completionPercent(after.counts));
  });
});

describe('the same game on another console (R12)', () => {
  const mw2 = { title: 'Call of Duty Modern Warfare 2', year: 2009 };
  const mwII = { title: 'Call of Duty: Modern Warfare II', year: 2022 };
  it('tells a reboot from its namesake by its years and its numerals', () => {
    expect(sameGameAcross(mwII, mw2, 2)).toBe(false);
    expect(sameGameAcross({ title: 'Call of Duty: Modern Warfare III', year: 2023 }, { title: 'Call of Duty: Modern Warfare 3', year: 2011 }, 2)).toBe(false);
  });
  it('keeps one game when the years are close, unknown, or the setting is off', () => {
    expect(sameGameAcross({ ...mwII, year: 2010 }, mw2, 2)).toBe(true);
    expect(sameGameAcross({ ...mwII, year: null }, mw2, 2)).toBe(true);
    expect(sameGameAcross(mwII, mw2, 0)).toBe(true);
    // Written the same way: a late port is still the game you have (Final Fantasy VII, 1997 and 2019).
    expect(sameGameAcross({ title: 'Final Fantasy VII', year: 2019 }, { title: 'Final Fantasy VII', year: 1997 }, 2)).toBe(true);
    expect(sameGameAcross({ title: 'Dragon Age II', year: 2011 }, { title: 'Dragon Age 2', year: 2011 }, 2)).toBe(true);
  });
  it("follows IGDB's game when it knows both", () => {
    expect(sameGameAcross({ title: 'Final Fantasy VII', year: 2019, igdbId: 427 }, { title: 'Final Fantasy VII', year: 1997, igdbId: 427 }, 2)).toBe(true);
    expect(sameGameAcross({ title: 'Shadow of the Colossus', year: 2018, igdbId: 37016 }, { title: 'Shadow of the Colossus', year: 2005, igdbId: 1386 }, 2)).toBe(false);
    expect(sameGameAcross({ ...mwII, igdbId: 1 }, { ...mw2, igdbId: 2 }, 2)).toBe(false);
    // Two IGDB entries from the same years (a port listed apart) are still one game.
    expect(sameGameAcross({ title: 'Doom', year: 2019, igdbId: 5 }, { title: 'Doom', year: 2020, igdbId: 6 }, 2)).toBe(true);
  });
});

