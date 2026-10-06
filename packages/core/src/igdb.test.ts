import { describe, expect, it } from 'vitest';
import { igdbCoverUrl, igdbDetails, igdbGameFromApi, matchIgdb, mergeDetails, titleKeys, type IgdbGame, withoutSharedNames } from './igdb.js';
import { scoreCandidates, scoringConfig } from './wishlist.js';
import { defaultSettings } from './settings.js';

const PS3 = 9;

/** A game as IGDB's API returns it with Squirrelcade's field list. */
const apiGame = {
  id: 1942,
  name: 'Tales of Graces f',
  alternative_names: [{ id: 1, name: 'Tales of Graces F' }, { id: 2, name: 'テイルズ オブ グレイセス エフ' }],
  cover: { id: 5, image_id: 'co1abc' },
  genres: [{ id: 12, name: 'Role-playing (RPG)' }, { id: 31, name: 'Adventure' }],
  themes: [{ id: 17, name: 'Fantasy' }],
  player_perspectives: [{ id: 2, name: 'Third person' }],
  collections: [{ id: 9, name: 'Tales' }],
  game_type: { id: 0, type: 'Main Game' },
  release_dates: [
    { id: 1, platform: 41, date: 1300000000 },
    { id: 2, platform: PS3, date: 1323993600 },
    { id: 3, platform: PS3, date: 1344556800 },
  ],
  involved_companies: [
    { id: 1, developer: true, company: { id: 3, country: 392, name: 'Namco Tales Studio' } },
    { id: 2, developer: false, publisher: true, company: { id: 4, country: 840, name: 'Namco Bandai Games America' } },
  ],
  total_rating: 83.456,
  total_rating_count: 57,
  remakes: [11111],
  remasters: [22222],
};

const game = (over: Partial<IgdbGame>): IgdbGame => ({
  id: 1,
  name: 'Game',
  altNames: [],
  coverId: null,
  genres: [],
  themes: [],
  perspectives: [],
  franchise: null,
  japanese: null,
  released: null,
  gameType: 'Main Game',
  ...over,
});

describe('withoutSharedNames', () => {
  it("leaves out the other names that don't tell a game apart: file names, and names another game goes by", () => {
    const games = withoutSharedNames([
      game({ id: 1, name: 'Rune Factory: Guardians of Azuma', altNames: ['Game.exe', 'Rune Factory: PROJECT DRAGON'] }),
      game({ id: 2, name: 'Marvel Cosmic Invasion', altNames: ['MARVEL Cosmic Invasion', 'Game.exe'] }),
      game({ id: 3, name: 'Mega Man', altNames: ['Rockman'] }),
      game({ id: 4, name: 'Mega Man X', altNames: ['Mega Man', 'Rockman X'] }),
      // An edition going by the name too doesn't take it from the game; the edition loses it.
      game({ id: 5, name: 'EarthBound', altNames: ['Mother 2'] }),
      game({ id: 6, name: 'Mother 2: Perfect Edition', altNames: ['Mother 2'] }),
      // Two alphabets: the key would keep only "Tomb Raider".
      game({ id: 7, name: 'Tomb Raider Chronicles', altNames: ['Tomb Raider: Хроники', 'トゥームレイダー クロニクル'] }),
    ]);
    expect(games.map((x) => x.altNames)).toEqual([['Rune Factory: PROJECT DRAGON'], ['MARVEL Cosmic Invasion'], ['Rockman'], ['Rockman X'], ['Mother 2'], [], ['トゥームレイダー クロニクル']]);
  });
});

describe('igdbGameFromApi', () => {
  it('keeps what Squirrelcade uses, for one platform', () => {
    expect(igdbGameFromApi(apiGame, PS3)).toEqual({
      id: 1942,
      name: 'Tales of Graces f',
      altNames: ['Tales of Graces F', 'テイルズ オブ グレイセス エフ'],
      coverId: 'co1abc',
      genres: ['Role-playing (RPG)', 'Adventure'],
      themes: ['Fantasy'],
      perspectives: ['Third person'],
      franchise: 'Tales',
      japanese: true,
      released: '2011-12-16',
      gameType: 'Main Game',
      rating: 83.5,
      ratingCount: 57,
      developers: ['Namco Tales Studio'],
      publishers: ['Namco Bandai Games America'],
      remakes: [11111],
      remasters: [22222],
    });
  });

  it('copes with missing fields and rejects nameless records', () => {
    expect(igdbGameFromApi({ id: 2, name: 'Bare' }, PS3)).toEqual(game({ id: 2, name: 'Bare', gameType: null, rating: null, ratingCount: 0, developers: [], publishers: [], remakes: [], remasters: [] }));
    expect(igdbGameFromApi({ id: 3 }, PS3)).toBeNull();
    expect(igdbGameFromApi(null, PS3)).toBeNull();
  });
});

describe('igdbDetails', () => {
  it('maps genres to the wishlist names, most specific first', () => {
    expect(igdbDetails(igdbGameFromApi(apiGame, PS3)!)).toEqual({
      source: 'igdb',
      genre: 'RPG',
      // Every genre, for averaging their points, and the rating for review points.
      genres: ['RPG', 'Action-adventure'],
      rating: 83.5,
      ratingCount: 57,
      style: 'JRPG',
      franchise: 'Tales',
      japaneseDeveloped: true,
      fromIgdb: ['genre', 'genres', 'rating', 'ratingCount', 'style', 'franchise', 'japaneseDeveloped'],
    });
    expect(igdbDetails(game({ genres: ['Adventure', 'Platform'], perspectives: ['Side view'] }))).toMatchObject({ genre: 'Platformer', style: 'Traditional 2D platformer' });
    expect(igdbDetails(game({ genres: ['Shooter'], themes: ['Horror', 'Action'] }))).toMatchObject({ genre: 'Horror', style: 'Survival / action horror' });
    expect(igdbDetails(game({ genres: ['Role-playing (RPG)'], japanese: false }))).toMatchObject({ style: 'Western RPG' });
    expect(igdbDetails(game({ genres: ['Adventure'], themes: ['Open world'] }))).toMatchObject({ genre: 'Action-adventure', style: 'Open-world' });
    expect(igdbDetails(game({ genres: ['Card & Board Game'] }))).toEqual({ source: 'igdb', fromIgdb: [] });
  });
});

describe('mergeDetails', () => {
  it('keeps curated values and fills only the gaps', () => {
    const merged = mergeDetails({ genre: 'Action-adventure', personalInterest: 'Essential' }, { source: 'igdb', genre: 'RPG', franchise: 'Tales', fromIgdb: ['genre', 'franchise'] });
    expect(merged).toEqual({ genre: 'Action-adventure', personalInterest: 'Essential', franchise: 'Tales', fromIgdb: ['franchise'] });
    expect(mergeDetails(undefined, { source: 'igdb', genre: 'RPG' })).toEqual({ source: 'igdb', genre: 'RPG' });
    expect(mergeDetails({ genre: 'RPG' }, undefined)).toEqual({ genre: 'RPG' });
  });
});

describe('matchIgdb', () => {
  it('matches names, alternative names, editions and generic subtitles', () => {
    const games = [
      game({ id: 1, name: 'Cars 2' }),
      game({ id: 2, name: 'Stranglehold', altNames: ['John Woo Presents: Stranglehold'] }),
      game({ id: 3, name: 'Uncharted: Drakes Fortune' }),
      game({ id: 4, name: 'Okami' }),
      game({ id: 5, name: 'Okami', gameType: 'Remaster', released: '2012-10-30' }),
    ];
    const result = matchIgdb(['Cars 2: The Video Game', 'John Woo Presents: Stranglehold', "Uncharted: Drake's Fortune [Greatest Hits]", 'Okami', 'Unknown Game'], games);
    expect([...result].map(([title, g]) => [title, g.id])).toEqual([
      ['Cars 2: The Video Game', 1],
      ['John Woo Presents: Stranglehold', 2],
      ["Uncharted: Drake's Fortune [Greatest Hits]", 3],
      ['Okami', 4],
    ]);
  });

  it('builds lookup keys without the edition and the generic subtitle', () => {
    expect(titleKeys('Cars 2 - The Video Game [Greatest Hits]')).toContain(titleKeys('Cars 2')[0]);
  });
});

describe('scoring with IGDB details', () => {
  const config = scoringConfig({ ...defaultSettings(), 'wishlist.genrePoints': { RPG: 30, Platformer: 28 } });
  const base = { platformKey: 'playstation-3', platformName: 'PlayStation 3', homeRegion: true };

  it('marks IGDB genres and still guesses when IGDB has none', () => {
    const [fromIgdb, guessed] = scoreCandidates(
      [
        { ...base, title: 'Tales of Graces f', details: { source: 'igdb', genre: 'RPG', fromIgdb: ['genre'] } },
        { ...base, title: 'Super Mario Galaxy', details: { source: 'igdb', franchise: 'Mario', fromIgdb: ['franchise'] } },
      ],
      new Map([['playstation-3', 100]]),
      config,
    );
    expect(fromIgdb!.components).toContainEqual({ label: 'RPG (IGDB)', points: 30 });
    expect(guessed!.components).toContainEqual({ label: 'Platformer (guessed from title)', points: 28 });
  });

  it('never guesses over curated details', () => {
    const [curated] = scoreCandidates([{ ...base, title: 'Super Mario Galaxy', details: { personalInterest: 'Essential' } }], new Map([['playstation-3', 100]]), config);
    expect(curated!.components).toContainEqual({ label: 'Genre unknown', points: 0 });
  });
});

describe('igdbCoverUrl', () => {
  it('points at the image server', () => {
    expect(igdbCoverUrl('co1abc')).toBe('https://images.igdb.com/igdb/image/upload/t_cover_small/co1abc.jpg');
    expect(igdbCoverUrl('co1abc', 'thumb')).toBe('https://images.igdb.com/igdb/image/upload/t_thumb/co1abc.jpg');
  });
});
