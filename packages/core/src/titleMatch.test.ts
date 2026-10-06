import { describe, expect, it } from 'vitest';
import { matchTitles, NEAR_MISS_AT, SAME_GAME_AT, TitleMatcher, titleShape, wordsScore } from './titleMatch.js';

const same = (asked: string, owned: string) => {
  const m = matchTitles(asked, owned);
  expect(m, `${asked} / ${owned}`).not.toBeNull();
  expect(m!.confidence, `${asked} / ${owned}: ${m!.why}`).toBeGreaterThanOrEqual(SAME_GAME_AT);
  return m!;
};
const nearMiss = (asked: string, owned: string) => {
  const m = matchTitles(asked, owned);
  expect(m, `${asked} / ${owned}`).not.toBeNull();
  expect(m!.confidence, `${asked} / ${owned}: ${m!.why}`).toBeLessThan(SAME_GAME_AT);
  expect(m!.confidence).toBeGreaterThanOrEqual(NEAR_MISS_AT);
  return m!;
};
const different = (asked: string, owned: string) => {
  const m = matchTitles(asked, owned);
  expect(m === null || m.confidence < NEAR_MISS_AT, `${asked} / ${owned}: ${m?.why}`).toBe(true);
};

describe('matchTitles', () => {
  it('finds the owner\'s three examples', () => {
    // An edition: owned, said to be a different edition.
    const yakuza = same("Yakuza 0 Director's Cut", 'Yakuza 0');
    expect(yakuza).toMatchObject({ kind: 'edition', confidence: 0.9 });
    expect(yakuza.why).toBe("A different edition: not the Director's Cut");
    expect(same('Yakuza 0', "Yakuza 0 Director's Cut").why).toBe("A different edition: Director's Cut");
    // A generic subtitle.
    expect(same('Cars 2', 'Cars 2: The Video Game')).toMatchObject({ kind: 'subtitle', confidence: 0.95 });
    expect(same('Cars 2: The Video Game', 'Cars 2').kind).toBe('subtitle');
    // A franchise name in front ("Tom Clancy's" is one matching already ignores).
    expect(same('EndWar', "Tom Clancy's EndWar")).toMatchObject({ confidence: 1 });
    expect(same("Sid Meier's Civilization IV", 'Civilization IV')).toMatchObject({ kind: 'franchise', confidence: 0.9 });
  });

  it('reads the same title written differently as the same', () => {
    expect(same('Final Fantasy VII', 'Final Fantasy 7').confidence).toBe(1);
    expect(same('Pokémon™ Sword', 'Pokemon Sword').confidence).toBe(1);
    expect(same('SPIDER-MAN 2', 'Spiderman 2').confidence).toBe(1);
    expect(same('Ratchet & Clank', 'Ratchet and Clank').confidence).toBe(1);
    expect(same('The Elder Scrolls V: Skyrim®', 'Elder Scrolls V Skyrim').confidence).toBe(1);
  });

  it('counts printings and editions, and says which', () => {
    expect(same('Gears of War', 'Gears of War [Platinum Hits]')).toMatchObject({ kind: 'reprint', confidence: 0.95, why: 'Another printing: Platinum Hits' });
    expect(same('Halo 3', 'Halo 3 [Limited Edition]')).toMatchObject({ kind: 'edition', why: 'A different edition: Limited Edition' });
    expect(same('Fallout 3', 'Fallout 3 Game of the Year Edition').kind).toBe('edition');
    expect(same('Just Dance 2016', 'Just Dance 2016: Gold Edition').kind).toBe('edition');
    expect(same('Deadly Premonition: The Director\'s Cut', 'Deadly Premonition').kind).toBe('edition');
    // Two steps at once are a little less sure, still the same game.
    expect(same("Disney's Cars 2", 'Cars 2: The Video Game').confidence).toBeCloseTo(0.88);
  });

  it('never takes another number for the same game', () => {
    different('Halo 2', 'Halo 3');
    different('FIFA 14', 'FIFA 15');
    different('Cars', 'Cars 2');
    different('Mario Kart 8', 'Mario Kart 7');
    different('Kingdom Hearts', 'Kingdom Hearts HD 1.5 Remix');
  });

  it('lists near misses without counting them', () => {
    expect(nearMiss('Star Wars', 'Star Wars: Battlefront')).toMatchObject({ kind: 'stem', confidence: 0.75 });
    expect(nearMiss('Star Wars: Battlefront', 'Star Wars').kind).toBe('stem');
    expect(nearMiss('Dark Souls Remastered', 'Dark Souls')).toMatchObject({ kind: 'remaster' });
    expect(nearMiss('Assasins Creed', "Assassin's Creed")).toMatchObject({ kind: 'spelling' });
    expect(nearMiss('Beijing 2008', 'Beijing Olympics 2008').kind).toBe('similar');
    expect(nearMiss('Halo 3', 'Halo 3 Demo').kind).toBe('demo');
    different('Mario Kart', 'Mario Party');
    different('Doom', 'Doom 3');
    different('Demon\'s Souls', 'Dark Souls');
  });

  it('knows what each title is made of', () => {
    expect(titleShape("Yakuza 0 Director's Cut")).toMatchObject({ base: 'yakuza0', edition: "Director's Cut", numbers: '0' });
    expect(titleShape('Uncharted [Greatest Hits]')).toMatchObject({ reprint: 'Greatest Hits', base: 'uncharted', demo: false });
    expect(titleShape('Cars 2: The Video Game')).toMatchObject({ plain: 'cars2', subtitle: 'The Video Game' });
    expect(titleShape("Sid Meier's Civilization IV")).toMatchObject({ core: 'civilization4', franchise: "Sid Meier's" });
    expect(matchTitles('Cars 2', 'Cars 2: The Video Game')!.why).toBe('"The Video Game" is part of its name');
    expect(titleShape('Star Wars: Battlefront').stems).toEqual(['starwars']);
  });
});

describe('TitleMatcher', () => {
  const games = [
    { id: 1, titles: ['Yakuza 0'] },
    { id: 2, titles: ['Cars 2: The Video Game'] },
    { id: 3, titles: ["Tom Clancy's EndWar"] },
    { id: 4, titles: ['Star Wars: Battlefront', 'Star Wars Battlefront (2004)'] },
    { id: 5, titles: ['Halo 3', 'Halo 3 [Limited Edition]'] },
    { id: 6, titles: ['Halo 2'] },
    { id: 7, titles: ['Cars'] },
  ];
  const matcher = new TitleMatcher(games, (g) => g.titles);

  it('finds each item once, the surest first', () => {
    expect(matcher.find("Yakuza 0 Director's Cut").map((f) => [f.item.id, f.match.kind])).toEqual([[1, 'edition']]);
    expect(matcher.find('Cars 2').map((f) => f.item.id)).toEqual([2]);
    expect(matcher.find('EndWar').map((f) => f.item.id)).toEqual([3]);
    expect(matcher.find('Halo 3')).toMatchObject([{ item: { id: 5 }, title: 'Halo 3', match: { confidence: 1 } }]);
  });

  it('gives near misses only when asked down to them, and filters', () => {
    expect(matcher.find('Star Wars', { min: SAME_GAME_AT })).toEqual([]);
    expect(matcher.find('Star Wars').map((f) => f.item.id)).toEqual([4]);
    expect(matcher.find('Halo 3', { filter: (g) => g.id !== 5 })).toEqual([]);
    expect(matcher.find('')).toEqual([]);
  });
});

describe('wordsScore', () => {
  it('finds titles that start with each word asked', () => {
    expect(wordsScore('yak', 'Yakuza 0')).toBeGreaterThan(0);
    expect(wordsScore('star bat', 'Star Wars: Battlefront')).toBeGreaterThan(0);
    expect(wordsScore('spiderman', 'Spider-Man 2')).toBeGreaterThan(0);
    expect(wordsScore('halo', 'Gears of War')).toBe(0);
    // Closer to the whole title, higher.
    expect(wordsScore('halo', 'Halo')).toBeGreaterThan(wordsScore('halo', 'Halo: The Master Chief Collection'));
  });
});
