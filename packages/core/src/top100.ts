import { z } from 'zod';

/**
 * Top 100 lists and console history (D48, D49): each console's best games in ranked order, and what a console
 * was and why it mattered. Both ship with Squirrelcade as data (apps/server/data); the owner can mark any text
 * verified or rewrite it, and their version is kept apart from the shipped one.
 */

/**
 * The Top 100 lists name consoles by RomM/IGDB-style slugs; these are Squirrelcade's platform keys for them. A slug
 * that isn't here stands for a platform of the same key (one Squirrelcade made from a PriceCharting console name it
 * doesn't know, such as "Vectrex").
 */
export const TOP100_PLATFORMS: Readonly<Record<string, string>> = {
  '3ds': 'nintendo-3ds',
  atari2600: 'atari-2600',
  atari5200: 'atari-5200',
  atari7800: 'atari-7800',
  colecovision: 'colecovision',
  dc: 'sega-dreamcast',
  fds: 'famicom-disk-system',
  gamegear: 'sega-game-gear',
  gb: 'game-boy',
  gba: 'game-boy-advance',
  gbc: 'game-boy-color',
  genesis: 'sega-genesis',
  intellivision: 'intellivision',
  jaguar: 'atari-jaguar',
  lynx: 'atari-lynx',
  n64: 'nintendo-64',
  nds: 'nintendo-ds',
  neogeomvs: 'neo-geo',
  nes: 'nintendo-entertainment-system',
  ngage: 'n-gage',
  ngc: 'nintendo-gamecube',
  'odyssey-2': 'magnavox-odyssey-2',
  ps2: 'playstation-2',
  ps3: 'playstation-3',
  ps4: 'playstation-4',
  psp: 'psp',
  psx: 'playstation',
  sega32: 'sega-32x',
  segacd: 'sega-cd',
  sg1000: 'sega-sg-1000',
  sms: 'sega-master-system',
  snes: 'super-nintendo',
  switch: 'nintendo-switch',
  tg16: 'turbografx-16',
  virtualboy: 'virtual-boy',
  wii: 'wii',
  wiiu: 'wii-u',
  xbox360: 'xbox-360',
};

/** One game of a Top 100 list. */
export interface Top100Entry {
  rank: number;
  title: string;
  /** Other and regional titles, which help find the game in the collection and in RomM. */
  altTitles: string[];
  year: number | null;
}

/** A console's Top 100 list, best first. */
export interface Top100List {
  platformKey: string;
  /** The list's own name for the console ("Super Nintendo / Super Famicom"). */
  name: string;
  entries: Top100Entry[];
}

/** The Top 100 lists that ship with Squirrelcade, and their version (the day they were put together). */
export interface Top100Data {
  version: string;
  lists: Top100List[];
}

const top100Schema = z.object({
  version: z.string().min(1),
  platforms: z.array(
    z.object({
      platform: z.string().min(1),
      name: z.string().min(1),
      list: z.array(z.object({ rank: z.number().int().positive(), title: z.string().trim().min(1), alt: z.array(z.string()).optional(), year: z.number().int().nullable().optional() })),
    }),
  ),
});

/** Reads the Top 100 lists' file ({version, platforms: [{platform, name, list: [{rank, title, alt, year}]}]}), best first. */
export function parseTop100(raw: unknown): Top100Data {
  const data = top100Schema.parse(raw);
  return {
    version: data.version,
    lists: data.platforms.map((p) => ({
      platformKey: TOP100_PLATFORMS[p.platform] ?? p.platform,
      name: p.name,
      entries: [...p.list]
        .sort((a, b) => a.rank - b.rank)
        .map((e) => ({ rank: e.rank, title: e.title, altTitles: (e.alt ?? []).map((a) => a.trim()).filter(Boolean), year: e.year ?? null })),
    })),
  };
}

/** Whether a text has been checked by the owner, or is still as drafted (with Claude's help, from its sources). */
export type HistoryStatus = 'draft' | 'verified';

/** A console launch in one region: the day (YYYY-MM-DD, or less exact: YYYY-MM, YYYY) and its price then. */
export interface ConsoleLaunch {
  region: string;
  date: string;
  price?: string;
}

/** What a console was: who made it, when and for how much, how it did, and why it matters. */
export interface ConsoleProfile {
  manufacturer: string | null;
  /** Its console generation (the NES is the third, the PlayStation 3 the seventh); null for ones outside them. */
  generation: number | null;
  launches: ConsoleLaunch[];
  discontinued: string | null;
  /** Units sold, with the date the figure is from ("87.4 million (as of March 2017)"). */
  unitsSold: string | null;
  hardware: string[];
  /** What it competed against, by name. */
  competitors: string[];
  /** Why it succeeded or failed: a paragraph or two. */
  story: string | null;
  firsts: string[];
  endOfLife: string | null;
}

/** A game that shows what a console was about, and why. */
export interface StartHereGame {
  title: string;
  why: string;
}

/** A console's history as shipped or as the owner wrote it. */
export interface ConsoleHistory {
  platformKey: string;
  profile: ConsoleProfile;
  startHere: StartHereGame[];
  /** Where the facts come from: web addresses. */
  sources: string[];
  status: HistoryStatus;
  /** The day the figures that change (units sold) are from, YYYY-MM or YYYY-MM-DD. */
  asOf: string | null;
}

/** Why a game matters on a console: a sentence or two, with sources. */
export interface GameSignificance {
  platformKey: string;
  title: string;
  text: string;
  sources: string[];
  status: HistoryStatus;
}

/** The history that ships with Squirrelcade. */
export interface HistoryData {
  version: string;
  consoles: ConsoleHistory[];
  games: GameSignificance[];
}

const url = z.string().trim().url().max(500);
const status = z.enum(['draft', 'verified']);

export const consoleProfileSchema = z.object({
  manufacturer: z.string().trim().max(200).nullable(),
  generation: z.number().int().min(1).max(20).nullable(),
  launches: z.array(z.object({ region: z.string().trim().min(1).max(20), date: z.string().trim().regex(/^\d{4}(-\d{2}(-\d{2})?)?$/), price: z.string().trim().max(200).optional() })).max(12),
  discontinued: z.string().trim().max(200).nullable(),
  unitsSold: z.string().trim().max(200).nullable(),
  hardware: z.array(z.string().trim().min(1).max(400)).max(20),
  competitors: z.array(z.string().trim().min(1).max(100)).max(12),
  story: z.string().trim().max(4000).nullable(),
  firsts: z.array(z.string().trim().min(1).max(400)).max(20),
  endOfLife: z.string().trim().max(1000).nullable(),
});

export const startHereSchema = z.array(z.object({ title: z.string().trim().min(1).max(200), why: z.string().trim().min(1).max(600) })).max(15);
export const sourcesSchema = z.array(url).max(20);

const historySchema = z.object({
  version: z.string().min(1),
  consoles: z.array(
    z.object({ platformKey: z.string().min(1), profile: consoleProfileSchema, startHere: startHereSchema, sources: sourcesSchema, status, asOf: z.string().nullable() }),
  ),
  games: z.array(z.object({ platformKey: z.string().min(1), title: z.string().trim().min(1), text: z.string().trim().min(1).max(1000), sources: sourcesSchema, status })),
});

/** Reads the history file that ships with Squirrelcade (apps/server/data/history.json). */
export function parseHistory(raw: unknown): HistoryData {
  return historySchema.parse(raw);
}

/** The year a console first came out anywhere, from its launches; null when none is known. */
export function firstLaunchYear(profile: Pick<ConsoleProfile, 'launches'>): number | null {
  const years = profile.launches.map((l) => Number(l.date.slice(0, 4))).filter((y) => Number.isFinite(y));
  return years.length > 0 ? Math.min(...years) : null;
}

/** The year in a "discontinued" text ("2017", "March 2016 (PAL)..."): the latest year it names, or null. */
export function lastYear(text: string | null): number | null {
  const years = (text ?? '').match(/\b(19|20)\d{2}\b/g)?.map(Number) ?? [];
  return years.length > 0 ? Math.max(...years) : null;
}
