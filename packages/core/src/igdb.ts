/**
 * IGDB (the free game database run by Twitch): game records as Squirrelcade keeps
 * them, the platform ids, the mapping from IGDB genres to the wishlist's genre
 * and style names, and matching catalog titles to IGDB games.
 */
import { baseTitle } from './catalog.js';
import { latinTitle, matchKey, normalizeTitle } from './text.js';
import type { GameDetails } from './wishlist.js';

/** IGDB platform ids for the built-in platforms (editable in Settings > Sources). */
export const IGDB_PLATFORM_IDS: Record<string, number> = {
  'nintendo-entertainment-system': 18,
  famicom: 99,
  'famicom-disk-system': 51,
  'super-nintendo': 19,
  'super-famicom': 58,
  'nintendo-64': 4,
  'nintendo-gamecube': 21,
  wii: 5,
  'wii-u': 41,
  'nintendo-switch': 130,
  'nintendo-switch-2': 508,
  'game-boy': 33,
  'game-boy-color': 22,
  'game-boy-advance': 24,
  'nintendo-ds': 20,
  'nintendo-3ds': 37,
  'virtual-boy': 87,
  'game-and-watch': 307,
  playstation: 7,
  'playstation-2': 8,
  'playstation-3': 9,
  'playstation-4': 48,
  'playstation-5': 167,
  psp: 38,
  'playstation-vita': 46,
  xbox: 11,
  'xbox-360': 12,
  'xbox-one': 49,
  'xbox-series-x': 169,
  'sega-master-system': 64,
  'sega-genesis': 29,
  'sega-cd': 78,
  'sega-32x': 30,
  'sega-saturn': 32,
  'sega-dreamcast': 23,
  'sega-game-gear': 35,
  'atari-2600': 59,
  'atari-5200': 66,
  'atari-7800': 60,
  'atari-lynx': 61,
  'atari-jaguar': 62,
  'magnavox-odyssey': 88,
  'magnavox-odyssey-2': 133,
  intellivision: 67,
  colecovision: 68,
  'turbografx-16': 86,
  'neo-geo': 80,
  '3do': 50,
  'n-gage': 42,
};

/**
 * Second IGDB platforms for the built-in platforms (editable in Settings > Sources): IGDB lists
 * Japan's Famicom and Super Famicom as platforms of their own, so games released only in Japan are
 * there and not under the NES or the Super Nintendo, whose Japanese releases they are in Squirrelcade.
 */
export const IGDB_EXTRA_PLATFORM_IDS: Record<string, number> = {
  'nintendo-entertainment-system': 99,
  'super-nintendo': 58,
  // As consoles of their own (region-locked, Settings > Platforms), games released in both regions are under the other platform.
  famicom: 18,
  'super-famicom': 19,
};

/** What Squirrelcade keeps of an IGDB game on one platform. */
export interface IgdbGame {
  id: number;
  name: string;
  altNames: string[];
  coverId: string | null;
  genres: string[];
  themes: string[];
  perspectives: string[];
  franchise: string | null;
  /** True when a developer is based in Japan, false when developers are known and none is, null when unknown. */
  japanese: boolean | null;
  /** First release on this platform (YYYY-MM-DD), any region. */
  released: string | null;
  /** "Main Game", "Remake", "Port", "Bundle"... */
  gameType: string | null;
  /**
   * Countries (ISO 3166 numeric codes) of the game's physical listings on this platform, from IGDB's
   * links to retailers; empty when a listing gives no country; missing when IGDB knows no physical listing.
   */
  physical?: number[];
  /** IGDB's rating (0–100, critics and players together), and how many ratings it rests on; missing in lists downloaded before ratings were read. */
  rating?: number | null;
  ratingCount?: number;
  /** The companies that made it and that published it; missing in lists downloaded before they were read. */
  developers?: string[];
  publishers?: string[];
  /** IGDB's remakes and remasters of this game (their IGDB ids); missing in lists downloaded before they were read. */
  remakes?: number[];
  remasters?: number[];
}

/** Countries that count as each home region for physical listings (PAL takes in Australia and New Zealand). */
const REGION_COUNTRIES: Record<string, number[]> = {
  'north-america': [840, 124],
  europe: [826, 276, 250, 380, 724, 528, 56, 40, 756, 752, 578, 208, 246, 372, 620, 616, 203, 348, 300, 36, 554],
  japan: [392],
};

/** Whether IGDB knows a physical listing of the game: anywhere, or (region set) in that home region. */
export function physicalIn(game: IgdbGame | undefined, region?: string): boolean {
  if (!game?.physical) return false;
  const countries = region ? REGION_COUNTRIES[region] : undefined;
  if (!countries) return true;
  return game.physical.some((c) => countries.includes(c));
}

/** The fields Squirrelcade asks IGDB for (see igdbGameFromApi). */
export const IGDB_GAME_FIELDS = [
  'name',
  'alternative_names.name',
  'cover.image_id',
  'genres.name',
  'themes.name',
  'player_perspectives.name',
  'franchise.name',
  'franchises.name',
  'collections.name',
  'game_type.type',
  'release_dates.platform',
  'release_dates.date',
  'involved_companies.developer',
  'involved_companies.publisher',
  'involved_companies.company.country',
  'involved_companies.company.name',
  'total_rating',
  'total_rating_count',
  'remakes',
  'remasters',
].join(',');

const JAPAN = 392;

type Named = { name?: string };
interface ApiGame {
  id: number;
  name?: string;
  alternative_names?: Named[];
  cover?: { image_id?: string };
  genres?: Named[];
  themes?: Named[];
  player_perspectives?: Named[];
  franchise?: Named;
  total_rating?: number;
  total_rating_count?: number;
  franchises?: Named[];
  collections?: Named[];
  game_type?: { type?: string };
  release_dates?: { platform?: number; date?: number }[];
  involved_companies?: { developer?: boolean; publisher?: boolean; company?: { country?: number; name?: string } }[];
  remakes?: number[];
  remasters?: number[];
}

const names = (list: Named[] | undefined) => (list ?? []).map((x) => x.name?.trim() ?? '').filter(Boolean);

/** Turns a game from IGDB's API into the record Squirrelcade keeps for one platform. */
export function igdbGameFromApi(raw: unknown, igdbPlatformId: number): IgdbGame | null {
  const g = raw as ApiGame;
  if (typeof g?.id !== 'number' || !g.name?.trim()) return null;
  const dates = (g.release_dates ?? [])
    .filter((d) => d.platform === igdbPlatformId && typeof d.date === 'number')
    .map((d) => d.date!)
    .sort((a, b) => a - b);
  const companies = g.involved_companies ?? [];
  const withCountry = companies.filter((c) => c.developer && typeof c.company?.country === 'number');
  const companyNames = (role: 'developer' | 'publisher') => [...new Set(companies.filter((c) => c[role]).map((c) => c.company?.name?.trim() ?? '').filter(Boolean))];
  return {
    id: g.id,
    name: g.name.trim(),
    altNames: names(g.alternative_names),
    coverId: g.cover?.image_id ?? null,
    genres: names(g.genres),
    themes: names(g.themes),
    perspectives: names(g.player_perspectives),
    franchise: g.franchise?.name?.trim() || names(g.franchises)[0] || names(g.collections)[0] || null,
    japanese: withCountry.length === 0 ? null : withCountry.some((c) => c.company!.country === JAPAN),
    released: dates.length > 0 ? new Date(dates[0]! * 1000).toISOString().slice(0, 10) : null,
    gameType: g.game_type?.type?.trim() || null,
    rating: typeof g.total_rating === 'number' ? Math.round(g.total_rating * 10) / 10 : null,
    ratingCount: g.total_rating_count ?? 0,
    developers: companyNames('developer'),
    publishers: companyNames('publisher'),
    remakes: (g.remakes ?? []).filter((id) => typeof id === 'number'),
    remasters: (g.remasters ?? []).filter((id) => typeof id === 'number'),
  };
}

/**
 * IGDB genres in the wishlist's genre names, most specific first: a game that
 * IGDB files under both Adventure and Role-playing counts as an RPG.
 */
const GENRE_ORDER: [igdb: string, genre: string][] = [
  ['Role-playing (RPG)', 'RPG'],
  ['Platform', 'Platformer'],
  ['Fighting', 'Fighting'],
  ['Racing', 'Racing'],
  ['Sport', 'Sports'],
  ['Music', 'Rhythm / music'],
  ['Visual Novel', 'Visual novel'],
  ['Point-and-click', 'Point-and-click adventure'],
  ['Puzzle', 'Puzzle'],
  ['Real Time Strategy (RTS)', 'Strategy'],
  ['Turn-based strategy (TBS)', 'Strategy'],
  ['Strategy', 'Strategy'],
  ['Tactical', 'Strategy'],
  ['Shooter', 'Shooter'],
  ["Hack and slash/Beat 'em up", "Beat 'em up / hack-and-slash"],
  ['Simulator', 'Simulation'],
  ['Quiz/Trivia', 'Party / minigame'],
  ['Arcade', 'Arcade'],
  ['Adventure', 'Action-adventure'],
];

/** The IGDB genres (and themes: Horror is a theme there) a wishlist genre stands for, to search IGDB by it. */
export function igdbGenresFor(genre: string): { genres: string[]; themes: string[] } {
  const g = genre.trim().toLowerCase();
  if (g === 'horror') return { genres: [], themes: ['Horror', 'Survival'] };
  return { genres: GENRE_ORDER.filter(([, name]) => name.toLowerCase() === g).map(([igdb]) => igdb), themes: [] };
}

/** The genre names IGDB's genres become in the wishlist, for suggestions where points are given by genre. */
export const IGDB_GENRE_NAMES: readonly string[] = [...new Set([...GENRE_ORDER.map(([, genre]) => genre), 'Horror'])];

/** The style names igdbDetails works out, for suggestions where points are given by style. */
export const IGDB_STYLE_NAMES: readonly string[] = [
  'Action RPG',
  'Tactical / strategy RPG',
  'JRPG',
  'Western RPG',
  'Traditional 2D platformer',
  'Traditional 3D platformer',
  'Open-world',
  'Stealth-focused',
  'Survival / action horror',
];

/** Genre, style, series and Japanese origin from an IGDB game, in the wishlist's terms. */
export function igdbDetails(game: IgdbGame): GameDetails {
  const has = (list: string[], name: string) => list.some((x) => x.toLowerCase() === name.toLowerCase());
  let genre = GENRE_ORDER.find(([igdb]) => has(game.genres, igdb))?.[1];
  const horror = has(game.themes, 'Horror') || has(game.themes, 'Survival');
  if (horror && (!genre || genre === 'Action-adventure' || genre === 'Shooter')) genre = 'Horror';

  let style: string | undefined;
  if (genre === 'RPG') {
    if (has(game.genres, "Hack and slash/Beat 'em up")) style = 'Action RPG';
    else if (has(game.genres, 'Tactical') || has(game.genres, 'Turn-based strategy (TBS)')) style = 'Tactical / strategy RPG';
    else if (game.japanese === true) style = 'JRPG';
    else if (game.japanese === false) style = 'Western RPG';
  } else if (genre === 'Platformer') {
    if (has(game.perspectives, 'Side view')) style = 'Traditional 2D platformer';
    else if (has(game.perspectives, 'Third person')) style = 'Traditional 3D platformer';
  } else if (genre === 'Action-adventure') {
    if (has(game.themes, 'Open world')) style = 'Open-world';
    else if (has(game.themes, 'Stealth')) style = 'Stealth-focused';
  } else if (genre === 'Horror' && has(game.themes, 'Action')) {
    style = 'Survival / action horror';
  }

  const details: GameDetails = { source: 'igdb' };
  if (genre) details.genre = genre;
  // Every genre IGDB gives the game, in the wishlist's names, for scoring them together.
  const all = [...new Set([...GENRE_ORDER.filter(([igdb]) => has(game.genres, igdb)).map(([, name]) => name), ...(horror ? ['Horror'] : [])])];
  if (all.length > 0) details.genres = all;
  if (typeof game.rating === 'number') {
    details.rating = game.rating;
    details.ratingCount = game.ratingCount ?? 0;
  }
  if (style) details.style = style;
  if (game.franchise) details.franchise = game.franchise;
  if (game.japanese !== null) details.japaneseDeveloped = game.japanese;
  details.fromIgdb = Object.keys(details).filter((k) => k !== 'source');
  return details;
}

/**
 * Fills the gaps in curated details with IGDB's: what the user says always wins. Returns undefined when there is nothing at all.
 */
export function mergeDetails(curated: GameDetails | undefined, igdb: GameDetails | undefined): GameDetails | undefined {
  if (!igdb) return curated;
  if (!curated) return igdb;
  const merged: GameDetails = { ...curated };
  const filled: string[] = [];
  for (const [key, value] of Object.entries(igdb)) {
    if (key === 'source' || key === 'fromIgdb') continue;
    const current = (merged as Record<string, unknown>)[key];
    if (current === undefined || current === '' || current === null) {
      (merged as Record<string, unknown>)[key] = value;
      filled.push(key);
    }
  }
  if (filled.length > 0) merged.fromIgdb = filled;
  return merged;
}

/** Subtitles PriceCharting and catalogs add that IGDB leaves out ("Cars 2: The Video Game"). */
const GENERIC_SUBTITLE = /\s*[:-]\s*the (video )?game$/i;

/** Lookup keys for a title: as written, without edition brackets, and without a generic subtitle. */
export function titleKeys(title: string): string[] {
  const keys = new Set<string>();
  for (const t of [title, baseTitle(title)]) {
    keys.add(normalizeTitle(t));
    keys.add(normalizeTitle(t.replace(GENERIC_SUBTITLE, '')));
  }
  keys.delete('');
  return [...keys];
}

/**
 * A lookup from titles to IGDB games by exact (normalized) name, then by
 * alternative name. When several games share a name (a remake, a port), the
 * main game wins, then the earliest release.
 */
/** A file name IGDB has as some games' other name ("Game.exe"): it names no game. */
const FILE_NAME = /\.(exe|bin|iso|elf|app|apk|nsp|xci|nds|3ds|cia|wbfs|zip)$/i;

/** Whether a name is a file name ("Game.exe"), which IGDB has as some games' other name. */
export const isFileName = (name: string): boolean => FILE_NAME.test(name.trim());

/**
 * IGDB's games without the other names that don't tell a game apart: a file name ("Game.exe", which IGDB has for many
 * games); a name in two alphabets ("Tomb Raider: Хроники", whose key keeps only "Tomb Raider", another game); and a name
 * another game of the list also goes by, unless that game is an edition of it ("Mother 2" is EarthBound's, though "Mother
 * 2: Perfect Edition" goes by it too). Used as a game's other names, those make two games one (a copy of one counting
 * as the other).
 */
export function withoutSharedNames(games: readonly IgdbGame[]): IgdbGame[] {
  const owners = new Map<string, Set<IgdbGame>>();
  for (const g of games) {
    for (const name of [g.name, ...g.altNames]) {
      const k = matchKey(name);
      if (k) (owners.get(k) ?? owners.set(k, new Set()).get(k)!).add(g);
    }
  }
  const telling = (g: IgdbGame, alt: string) => {
    if (FILE_NAME.test(alt.trim()) || (/\p{Script=Latin}/u.test(alt) && !latinTitle(alt))) return false;
    const k = matchKey(alt);
    // Another game going by it counts against it, but for one whose own name only adds to it (an edition).
    return [...(owners.get(k) ?? [])].every((o) => o === g || (matchKey(o.name) !== k && matchKey(o.name).startsWith(k)));
  };
  return games.map((g) => {
    const altNames = g.altNames.filter((alt) => telling(g, alt));
    return altNames.length === g.altNames.length ? g : { ...g, altNames };
  });
}

export function igdbIndex(games: IgdbGame[]): (title: string) => IgdbGame | undefined {
  const byName = new Map<string, IgdbGame[]>();
  const byAlt = new Map<string, IgdbGame[]>();
  const add = (map: Map<string, IgdbGame[]>, key: string, g: IgdbGame) => {
    const list = map.get(key) ?? [];
    if (!list.includes(g)) list.push(g);
    map.set(key, list);
  };
  for (const g of games) {
    for (const k of titleKeys(g.name)) add(byName, k, g);
    for (const alt of g.altNames) for (const k of titleKeys(alt)) add(byAlt, k, g);
  }
  const pick = (list: IgdbGame[] | undefined): IgdbGame | undefined => {
    if (!list || list.length === 0) return undefined;
    if (list.length === 1) return list[0];
    const main = list.filter((g) => !g.gameType || g.gameType === 'Main Game');
    const pool = main.length > 0 ? main : list;
    return [...pool].sort((a, b) => (a.released ?? '9999').localeCompare(b.released ?? '9999') || a.id - b.id)[0];
  };
  return (title) => {
    const keys = titleKeys(title);
    return keys.map((k) => pick(byName.get(k))).find(Boolean) ?? keys.map((k) => pick(byAlt.get(k))).find(Boolean);
  };
}

/** The IGDB game for each title that has one (see igdbIndex). */
export function matchIgdb(titles: string[], games: IgdbGame[]): Map<string, IgdbGame> {
  const find = igdbIndex(games);
  const result = new Map<string, IgdbGame>();
  for (const title of titles) {
    const hit = find(title);
    if (hit) result.set(title, hit);
  }
  return result;
}

/** A cover image on IGDB's image server. Sizes: t_thumb (90x90), t_cover_small (90x128), t_cover_big (264x374). */
export function igdbCoverUrl(coverId: string, size: 'thumb' | 'cover_small' | 'cover_big' = 'cover_small'): string {
  return `https://images.igdb.com/igdb/image/upload/t_${size}/${coverId}.jpg`;
}
