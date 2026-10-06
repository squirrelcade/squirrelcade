import { baseTitle } from './catalog.js';
import { forPlatform } from './platforms.js';
import { latinTitle, matchKey } from './text.js';

/**
 * Finding a game in the user's RomM (a self-hosted ROM library): which RomM platform each
 * Squirrelcade platform is, and which of the ROMs of a game to link to.
 */

/** A ROM in Squirrelcade's index of RomM, as matching needs it. */
export interface RommRom {
  id: number;
  platformId: number;
  igdbId: number | null;
  name: string;
  /** The file name, whose tags ("(USA)", "(Beta)", "[h1]") tell the region and the kind of dump. */
  fsName: string;
  regions: string[];
  tags: string[];
  playable: boolean;
}

/** A platform in RomM. */
export interface RommPlatform {
  id: number;
  slug: string;
  name: string;
  igdbId: number | null;
}

/** A Squirrelcade platform, as mapping it to RomM needs it. */
export interface MappablePlatform {
  key: string;
  name: string;
  igdbId: number | null;
  /** IGDB's second platform for it, such as the Super Famicom for the Super Nintendo. */
  extraIgdbId?: number | null;
}

/** Which RomM platforms a Squirrelcade platform is, and how that was worked out. */
export interface RommPlatformMatch {
  platforms: RommPlatform[];
  via: 'setting' | 'igdb' | 'name';
}

/** Region names as RomM reads them from file names, and their usual short forms, to one spelling. */
const REGION_ALIASES: Record<string, string> = {
  usa: 'usa',
  us: 'usa',
  u: 'usa',
  america: 'usa',
  'north america': 'usa',
  world: 'world',
  w: 'world',
  europe: 'europe',
  eur: 'europe',
  eu: 'europe',
  e: 'europe',
  pal: 'europe',
  japan: 'japan',
  jpn: 'japan',
  jp: 'japan',
  j: 'japan',
  asia: 'asia',
};

const normalizeRegion = (region: string) => REGION_ALIASES[region.trim().toLowerCase()] ?? region.trim().toLowerCase();

/** Preferred ROM regions by home region, when the user hasn't set an order of their own. */
const REGION_ORDERS: Record<string, string[]> = {
  'north-america': ['usa', 'world', 'europe', 'japan'],
  europe: ['europe', 'world', 'usa', 'japan'],
  japan: ['japan', 'world', 'usa', 'europe'],
  asia: ['asia', 'world', 'usa', 'japan', 'europe'],
};

/** The order in which ROM regions are preferred: the user's own (Settings > Sources), or by home region. */
export function regionOrder(homeRegion: string, custom: readonly string[] = []): string[] {
  const own = custom.map(normalizeRegion).filter(Boolean);
  return own.length > 0 ? own : (REGION_ORDERS[homeRegion] ?? REGION_ORDERS['north-america']!);
}

/**
 * Betas, prototypes, demos, samples, hacks and pirate, bad or trained dumps (GoodTools' [h], [p],
 * [b], [t], [o]): linked to only when there is nothing else.
 */
const UNWANTED = /\b(beta|proto|prototype|demo|sample|hack|hacked|pirate|kiosk)\b|\[(h|p|b|t|o)\d*[^\]]*\]/i;

/** Whether a ROM is a beta, prototype, demo, hack or bad dump rather than the released game. */
export function isUnwantedRom(rom: Pick<RommRom, 'tags' | 'fsName'>): boolean {
  return rom.tags.some((t) => UNWANTED.test(t)) || UNWANTED.test(rom.fsName);
}

/**
 * The ROM to link to among several of the same game: released games before betas, demos and
 * hacks; then the most preferred region (a ROM counts with its best region; unknown regions come
 * last); then ones playable in the browser; then the lowest RomM id, so the choice is stable.
 */
export function pickRom<T extends RommRom>(candidates: readonly T[], order: readonly string[]): T | null {
  if (candidates.length === 0) return null;
  const wanted = candidates.filter((r) => !isUnwantedRom(r));
  const pool = wanted.length > 0 ? wanted : candidates;
  const rank = (r: RommRom) => {
    const ranks = r.regions.map((g) => order.indexOf(normalizeRegion(g))).filter((i) => i >= 0);
    return ranks.length > 0 ? Math.min(...ranks) : order.length;
  };
  return [...pool].sort((a, b) => rank(a) - rank(b) || Number(b.playable) - Number(a.playable) || a.id - b.id)[0]!;
}

/**
 * The keys a game is found by its titles, with and without an edition in brackets ("[Not for
 * Resale]"): none for a title in another script (RomM and IGDB name many Japanese games in
 * Japanese), nor for a title whose key is a single character, since neither tells games apart
 * ("デッドオアアライブ2" and "スーパーファミスタ2" would both be "2").
 */
export function titleMatchKeys(titles: readonly string[]): string[] {
  return [
    ...new Set(
      titles
        .flatMap((t) => [t, baseTitle(t)])
        .filter(latinTitle)
        .map((t) => matchKey(t))
        .filter((k) => k.length > 1),
    ),
  ];
}

/** A ROM's file name as a title: no extension or tags, and No-Intro's "Legend of Zelda, The - ..." turned around. */
function fileTitle(fsName: string): string {
  return fsName
    .replace(/\.[a-z0-9]{1,5}$/i, '')
    .replace(/\s*[([][^)\]]*[)\]]/g, '')
    .trim()
    .replace(/^(.*?), (The|A|An)\b(.*)$/i, '$2 $1$3');
}

/** The title keys a ROM goes by: its name and its file name. */
export function romTitleKeys(rom: Pick<RommRom, 'name' | 'fsName'>): string[] {
  return titleMatchKeys([rom.name, fileTitle(rom.fsName)]);
}

/**
 * The key of a ROM's file name without its subtitle ("Rockman 7 - Shukumei no Taiketsu! (Japan)"
 * is "Rockman 7"), for owned titles that leave the subtitle out, as PriceCharting's often do for
 * Japanese releases; empty when the file name has no subtitle.
 */
export function romShortTitleKey(rom: Pick<RommRom, 'fsName'>): string {
  const title = fileTitle(rom.fsName);
  const at = title.indexOf(' - ');
  return at > 0 ? (titleMatchKeys([title.slice(0, at)])[0] ?? '') : '';
}

/**
 * Whether ROMs are all one game (regions, revisions): the same file title, or the same IGDB game.
 * A title without its subtitle links only then, so "Dragon Ball Z" finds none of several games.
 */
export function oneGame(roms: readonly Pick<RommRom, 'fsName' | 'igdbId'>[]): boolean {
  if (roms.length === 0) return false;
  if (new Set(roms.map((r) => matchKey(fileTitle(r.fsName)))).size === 1) return true;
  const ids = new Set(roms.map((r) => r.igdbId));
  return ids.size === 1 && !ids.has(null);
}

/** Parses the setting's lines "platform key: RomM slug" (several slugs separated by ";"). */
export function rommOverrides(lines: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of lines) {
    const at = line.indexOf(':');
    if (at < 0) continue;
    const key = line.slice(0, at).trim();
    const slugs = line
      .slice(at + 1)
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    if (key && slugs.length > 0) out[key] = slugs;
  }
  return out;
}

const nameKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '');

/**
 * Which RomM platforms each Squirrelcade platform is: the setting's lines first, then the same IGDB
 * platform number (or its second one: a RomM "Super Famicom" joins the Super Nintendo), then the
 * same name. Platforms with no match are left out.
 */
export function mapPlatforms(ours: readonly MappablePlatform[], romm: readonly RommPlatform[], overrides: Record<string, string[]> = {}): Map<string, RommPlatformMatch> {
  const out = new Map<string, RommPlatformMatch>();
  for (const p of ours) {
    const wanted = forPlatform(overrides, p.key);
    if (wanted) {
      const found = romm.filter((r) => wanted.includes(r.slug));
      if (found.length > 0) out.set(p.key, { platforms: found, via: 'setting' });
      continue;
    }
    const ids = [p.igdbId, p.extraIgdbId].filter((id): id is number => typeof id === 'number');
    const byIgdb = romm.filter((r) => r.igdbId !== null && ids.includes(r.igdbId));
    if (byIgdb.length > 0) {
      out.set(p.key, { platforms: byIgdb, via: 'igdb' });
      continue;
    }
    const byName = romm.filter((r) => nameKey(r.name) === nameKey(p.name));
    if (byName.length > 0) out.set(p.key, { platforms: byName, via: 'name' });
  }
  return out;
}
