import { describe, expect, it } from 'vitest';
import { isAddedSource, mergeSources, sourceCovers, sourceOrder, type SourceLayer } from './sources.js';

const list: SourceLayer = {
  id: 'list',
  adds: 'all',
  games: [
    { title: 'Absolum', format: 'Full Game Card', releaseDate: '2026-09', evidence: 'list' },
    { title: 'Dredge', evidence: 'list' },
    { title: 'Dredge: Deluxe Edition', evidence: 'list' },
    { title: 'Borderlands 4', format: 'Game-Key Card', releaseDate: 'TBA', evidence: 'list' },
  ],
};
const nintendoLife: SourceLayer = {
  id: 'nintendo-life',
  adds: 'after',
  after: '2026-08-28',
  games: [
    { title: 'Absolum - Nintendo Switch 2 Edition', format: 'Full Game Card', releaseDate: '2026-09-17', evidence: 'nintendo-life' },
    { title: 'Borderlands 4', format: 'Full Game Card', releaseDate: 'TBA', evidence: 'nintendo-life' },
    { title: 'Monster Hunter Wilds', format: 'Game-Key Card', releaseDate: 'TBA', evidence: 'nintendo-life' },
    { title: 'Old Key Card Game', format: 'Game-Key Card', releaseDate: '2025-06-05', evidence: 'nintendo-life' },
  ],
};
const wikipedia: SourceLayer = {
  id: 'wikipedia',
  adds: 'after',
  after: '2026-08-28',
  games: [
    { title: 'Dredge', releaseDate: '2025-07-01', targetStatus: 'required' },
    { title: 'Hela', releaseDate: '2026-11-05', targetStatus: 'required' },
    { title: 'Monster Hunter Wilds', altTitles: ['MH Wilds'], releaseDate: '2027-02', targetStatus: 'required' },
  ],
};

describe('mergeSources', () => {
  it('takes games from every source in order: higher ones win, lower ones fill in', () => {
    const { games, conflicts, contributions } = mergeSources([list, nintendoLife, wikipedia]);
    const by = Object.fromEntries(games.map((g) => [g.title, g]));
    expect(games.map((g) => g.title)).toEqual(['Absolum', 'Dredge', 'Dredge: Deluxe Edition', 'Borderlands 4', 'Monster Hunter Wilds', 'Hela']);
    // A name with an edition is the same game; the more precise date that agrees fills in the day.
    expect(by['Absolum']).toMatchObject({ source: 'list', releaseDate: '2026-09-17', altTitles: ['Absolum - Nintendo Switch 2 Edition'] });
    // Your list's own games stay apart, and a lower source's date fills a gap.
    expect(by['Dredge']).toMatchObject({ releaseDate: '2025-07-01' });
    // Nintendo Life brings the game after your list; Wikipedia gives it another name, and its date where there was none.
    expect(by['Monster Hunter Wilds']).toMatchObject({ source: 'nintendo-life', format: 'Game-Key Card', releaseDate: '2027-02', altTitles: ['MH Wilds'], evidence: 'nintendo-life' });
    expect(by['Hela']).toMatchObject({ source: 'wikipedia' });
    expect(by['Hela']!.evidence).toBeUndefined();
    // Your list and Nintendo Life disagree about Borderlands 4: your list is higher, so its format stands.
    expect(by['Borderlands 4']!.format).toBe('Game-Key Card');
    expect(conflicts).toEqual([{ title: 'Borderlands 4', fact: 'format', kept: { source: 'list', value: 'Game-Key Card' }, other: { source: 'nintendo-life', value: 'Full Game Card' } }]);
    expect(contributions).toEqual([
      { id: 'list', listed: 4, added: 4, matched: 0, filled: 0, older: 0 },
      { id: 'nintendo-life', listed: 4, added: 1, matched: 2, filled: 1, older: 1 },
      { id: 'wikipedia', listed: 3, added: 1, matched: 2, filled: 2, older: 0 },
    ]);
  });

  it('lets the order decide who wins', () => {
    const { games, conflicts } = mergeSources([nintendoLife, list]);
    expect(games.find((g) => g.title === 'Borderlands 4')!.format).toBe('Full Game Card');
    expect(conflicts[0]).toMatchObject({ kept: { source: 'nintendo-life' }, other: { source: 'list', value: 'Game-Key Card' } });
  });

  it('can trust a source first for one fact: Nintendo Life for dates, your list for formats', () => {
    const layers: SourceLayer[] = [
      { id: 'list', adds: 'all', games: [{ title: 'Rayman Legends Retold', releaseDate: '2026-10', format: 'Full Game Card' }, { title: 'Absolum', releaseDate: '2026-09' }] },
      { id: 'nintendo-life', adds: 'all', games: [{ title: 'Rayman Legends Retold', releaseDate: '2026-12-03', format: 'Game-Key Card' }, { title: 'Absolum', releaseDate: '2026-09-17' }] },
      { id: 'wikipedia', adds: 'all', games: [{ title: 'Rayman Legends Retold', releaseDate: '2026-10-30' }] },
    ];
    const { games, conflicts, contributions } = mergeSources(layers, undefined, { releaseDate: 'nintendo-life', format: 'list' });
    expect(games.map((g) => [g.title, g.releaseDate, g.format ?? null, g.source])).toEqual([
      ['Rayman Legends Retold', '2026-12-03', 'Full Game Card', 'list'],
      ['Absolum', '2026-09-17', null, 'list'],
    ]);
    expect(conflicts).toEqual([
      { title: 'Rayman Legends Retold', fact: 'releaseDate', kept: { source: 'nintendo-life', value: '2026-12-03' }, other: { source: 'list', value: '2026-10' } },
      { title: 'Rayman Legends Retold', fact: 'releaseDate', kept: { source: 'nintendo-life', value: '2026-12-03' }, other: { source: 'wikipedia', value: '2026-10-30' } },
      { title: 'Rayman Legends Retold', fact: 'format', kept: { source: 'list', value: 'Full Game Card' }, other: { source: 'nintendo-life', value: 'Game-Key Card' } },
    ]);
    expect(contributions.find((c) => c.id === 'nintendo-life')!.filled).toBe(2);
    // Without the preference, the order decides: your list's dates stand, and the day only fills in where it agrees.
    const plain = mergeSources(layers).games.map((g) => g.releaseDate);
    expect(plain).toEqual(['2026-10-30', '2026-09-17']);
  });

  it('makes one game of a public source naming it twice, and keeps your own list as it is', () => {
    const wiki: SourceLayer = { id: 'wikipedia', adds: 'all', games: [{ title: 'Super Mario Collection', altTitles: ['Super Mario All-Stars'] }, { title: 'Super Mario All-Stars', releaseDate: '1993-07-14' }] };
    expect(mergeSources([wiki]).games).toEqual([{ title: 'Super Mario Collection', altTitles: ['Super Mario All-Stars'], releaseDate: '1993-07-14', source: 'wikipedia' }]);
    const mine: SourceLayer = { id: 'list', adds: 'all', games: [{ title: 'Tetris' }, { title: 'Tetris' }] };
    expect(mergeSources([mine]).games).toHaveLength(2);
  });

  it('recognizes the same IGDB game under another name', () => {
    const idOf = (t: string) => ({ 'Super Mario Bros. Wonder': 7, 'Mario Wonder': 7 })[t];
    const { games } = mergeSources([{ id: 'list', adds: 'all', games: [{ title: 'Super Mario Bros. Wonder' }] }, { id: 'wikipedia', adds: 'all', games: [{ title: 'Mario Wonder', releaseDate: '2023-10-20' }] }], idOf);
    expect(games).toEqual([{ title: 'Super Mario Bros. Wonder', altTitles: ['Mario Wonder'], releaseDate: '2023-10-20', source: 'list' }]);
  });
});

describe('sourceOrder', () => {
  it("keeps the user's order and adds sources that came later", () => {
    expect(sourceOrder([{ id: 'wikipedia', on: true }, { id: 'list', on: false }, { id: 'gone', on: true }])).toEqual([
      { id: 'wikipedia', on: true },
      { id: 'list', on: false },
      { id: 'nintendo-life', on: false },
      // A source added later joins at the bottom, on as it is for a new install (IGDB's other regions).
      { id: 'igdb-regions', on: true },
    ]);
    expect(sourceCovers('nintendo-life', 'nintendo-switch-2')).toBe(true);
    expect(sourceCovers('nintendo-life', 'playstation-5')).toBe(false);
    expect(sourceCovers('wikipedia', 'playstation-5')).toBe(true);
  });

  it('keeps the sources the user added in their place, adds a new one at the bottom, switched on, and drops a removed one', () => {
    const added = [
      { id: 'added-1', name: 'PAL list', platforms: ['nintendo-switch'] },
      { id: 'added-3', name: 'Publisher list', platforms: ['playstation-4', 'nintendo-switch'] },
    ];
    const order = sourceOrder(
      [
        { id: 'added-1', on: false },
        { id: 'list', on: true },
        { id: 'added-2', on: true },
      ],
      added,
    );
    expect(order.map((o) => `${o.id} ${o.on}`)).toEqual(['added-1 false', 'list true', 'nintendo-life false', 'wikipedia true', 'igdb-regions true', 'added-3 true']);
    expect(sourceCovers('added-3', 'playstation-4', added)).toBe(true);
    expect(sourceCovers('added-1', 'playstation-4', added)).toBe(false);
    expect(isAddedSource('added-12')).toBe(true);
    expect(isAddedSource('list')).toBe(false);
  });
});

describe('under your own list', () => {
  it('adds only newer games, and an older one you own a copy of', () => {
    const list: SourceLayer = { id: 'list', adds: 'all', games: [{ title: 'Uncharted' }] };
    const wiki: SourceLayer = {
      id: 'wikipedia',
      adds: 'after',
      after: '2026-08-28',
      keepOlder: (g) => g.title === 'Valkyria Chronicles',
      games: [{ title: 'Valkyria Chronicles', releaseDate: '2008-11-04' }, { title: 'Cars 2', releaseDate: '2011-06-14' }, { title: 'Next Year Game', releaseDate: '2027-03-03' }],
    };
    const { games, contributions } = mergeSources([list, wiki]);
    expect(games.map((g) => g.title)).toEqual(['Uncharted', 'Valkyria Chronicles', 'Next Year Game']);
    expect(contributions[1]).toMatchObject({ added: 2, older: 1 });
  });
});

describe('a source that only adds games, matching loosely', () => {
  it('leaves out a game the catalog has with a few small words, punctuation or an edition apart', () => {
    const list: SourceLayer = {
      id: 'list',
      adds: 'all',
      games: [
        { title: 'The Walking Dead: Final Season' },
        { title: 'Minecraft: Story Mode Complete Adventure' },
        { title: 'Mortal Shell: Enhanced Edition' },
        { title: 'Grand Theft Auto: San Andreas (GH only)' },
        { title: 'Destiny: Taken King Legendary Edition' },
        { title: 'Shenmue III' },
      ],
    };
    const other: SourceLayer = {
      id: 'igdb-regions',
      adds: 'all',
      fills: false,
      games: [
        { title: 'The Walking Dead: The Final Season' },
        { title: 'Minecraft: Story Mode - The Complete Adventure' },
        { title: 'Mortal Shell: Enhanced Edition - Game of the Year Edition' },
        { title: 'Grand Theft Auto: San Andreas' },
        { title: 'Destiny: The Taken King - Legendary Edition' },
        { title: "Shenmue III (collector's edition only)" },
        { title: 'Dorfromantik', targetStatus: 'extra' },
      ],
    };
    const { games, contributions } = mergeSources([list, other]);
    expect(games.map((g) => g.title)).toEqual([...list.games.map((g) => g.title), 'Dorfromantik']);
    expect(contributions[1]).toMatchObject({ added: 1, matched: 6 });
  });
});

describe('a source that only adds games', () => {
  it("gives a game a higher source has none of its names or evidence, and still adds its new games", () => {
    const list = { id: 'list', adds: 'all' as const, games: [{ title: 'Sonic Frontiers' }] };
    const igdb = { id: 'igdb-regions', adds: 'all' as const, fills: false, games: [{ title: 'Sonic Frontiers', altTitles: ['Sonic Frontiers Day One'], evidence: 'igdb' }, { title: 'Euro Only Racer', evidence: 'igdb' }] };
    const { games } = mergeSources([list, igdb]);
    expect(games.map((g) => [g.title, g.evidence ?? null, g.altTitles ?? []])).toEqual([
      ['Sonic Frontiers', null, []],
      ['Euro Only Racer', 'igdb', []],
    ]);
  });
});
