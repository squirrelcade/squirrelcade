import { KNOWN_PLATFORMS, regionalConsole } from './platforms.js';
import type { Completeness } from './pricecharting.js';

/**
 * What a console's games come on (0.21.0): the standard photos of a copy name it ("Disc front", "Cartridge back").
 * Consoles Squirrelcade doesn't know are taken as cartridges.
 */
export type GameMedia = 'disc' | 'cartridge' | 'card' | 'disk';

const DISC = new Set([
  'nintendo-gamecube',
  'wii',
  'wii-u',
  'playstation',
  'playstation-2',
  'playstation-3',
  'playstation-4',
  'playstation-5',
  'psp',
  'xbox',
  'xbox-360',
  'xbox-one',
  'xbox-series-x',
  'sega-cd',
  'sega-saturn',
  'sega-dreamcast',
  '3do',
]);
/** The consoles whose games come on disc. */
export const DISC_CONSOLES: readonly string[] = [...DISC];

/**
 * The consoles whose discs a PC can rip in full (0.26.0, D90), which Settings > Collection > Consoles whose games you
 * rip starts with: a Blu-ray drive flashed with OmniDrive (RibShark's firmware for the ASUS BW-16D1HT and several LG
 * drives) and redumper (Redump's dumper) read CDs (PlayStation, Saturn, Sega CD, 3DO), DVDs (PS2, Xbox, Xbox 360,
 * GameCube, Wii) and Blu-rays (PS3, PS4, PS5, Wii U, Xbox One, Series X). PSP's UMDs and Dreamcast's GD-ROMs need
 * their own console. A cartridge reader's consoles can be added to the setting.
 */
export const RIPPABLE_CONSOLES: readonly string[] = DISC_CONSOLES.filter((k) => k !== 'psp' && k !== 'sega-dreamcast');

const CARD = new Set(['nintendo-switch', 'nintendo-switch-2', 'nintendo-ds', 'nintendo-3ds', 'playstation-vita', 'n-gage', 'turbografx-16']);
const DISK = new Set(['famicom-disk-system']);

export const MEDIA_NAMES: Record<GameMedia, string> = { disc: 'Disc', cartridge: 'Cartridge', card: 'Card', disk: 'Disk' };

/** What a console's games come on; another region's own console (the Super Famicom, "Nintendo 64 (Japan)") follows its base. */
export function mediaOf(platformKey: string): GameMedia {
  const base = regionalConsole(platformKey)?.base ?? platformKey;
  if (DISC.has(base)) return 'disc';
  if (CARD.has(base)) return 'card';
  if (DISK.has(base)) return 'disk';
  return 'cartridge';
}

/** The standard photo slots of Settings > Collection, by the part of a copy they show. */
export interface PhotoSlotSettings {
  box: string[];
  inside: string[];
  /** "{game}" in a name becomes Disc, Cartridge, Card or Disk by the console. */
  game: string[];
  manual: string[];
}

/**
 * A copy's standard photos, by what it has: its box (front, back), the box opened (not for a sealed copy), the game
 * itself (not for a sealed copy), the manual (not for a sealed copy). A slot named twice is kept once.
 */
export function photoSlotsFor(copy: { completeness: Completeness | string; hasBox: boolean; hasManual: boolean; sealed: boolean }, media: GameMedia, slots: PhotoSlotSettings): string[] {
  const hasItem = copy.sealed || !['box-only', 'manual-only'].includes(copy.completeness);
  const out = [
    ...(copy.hasBox ? slots.box : []),
    ...(copy.hasBox && !copy.sealed ? slots.inside : []),
    ...(hasItem && !copy.sealed ? slots.game.map((s) => s.replace(/\{game\}/gi, MEDIA_NAMES[media])) : []),
    ...(copy.hasManual && !copy.sealed ? slots.manual : []),
  ].map((s) => s.trim());
  return [...new Set(out.filter(Boolean))];
}

/**
 * What a new game usually cost on each console (US prices, the standard edition, in dollars): the default of Settings >
 * Collection > Suggested estimates, which an owner in another currency changes to theirs.
 */
export const NEW_GAME_PRICES = [
  'Atari 2600: 29.99',
  'Atari 5200: 34.99',
  'Atari 7800: 29.99',
  'Atari Lynx: 39.99',
  'Atari Jaguar: 59.99',
  'ColecoVision: 29.99',
  'Intellivision: 29.99',
  'Magnavox Odyssey 2: 29.99',
  'Nintendo Entertainment System: 49.99',
  'Super Nintendo: 59.99',
  'Nintendo 64: 59.99',
  'Nintendo GameCube: 49.99',
  'Wii: 49.99',
  'Wii U: 59.99',
  'Nintendo Switch: 59.99',
  'Nintendo Switch 2: 69.99',
  'Game Boy: 29.99',
  'Game Boy Color: 29.99',
  'Game Boy Advance: 29.99',
  'Virtual Boy: 39.99',
  'Nintendo DS: 34.99',
  'Nintendo 3DS: 39.99',
  'PlayStation: 39.99',
  'PlayStation 2: 49.99',
  'PlayStation 3: 59.99',
  'PlayStation 4: 59.99',
  'PlayStation 5: 69.99',
  'PSP: 39.99',
  'PlayStation Vita: 39.99',
  'Xbox: 49.99',
  'Xbox 360: 59.99',
  'Xbox One: 59.99',
  'Xbox Series X: 69.99',
  'Sega Master System: 29.99',
  'Sega Genesis: 49.99',
  'Sega CD: 49.99',
  'Sega 32X: 49.99',
  'Sega Saturn: 49.99',
  'Sega Dreamcast: 49.99',
  'Sega Game Gear: 29.99',
  'TurboGrafx-16: 49.99',
  'Neo Geo: 199.99',
  '3DO: 49.99',
  'N-Gage: 39.99',
];

/** "PlayStation 2: 49.99" lines as cents by the console's name or key, lowercased; lines that aren't a price are left out. */
export function parseNewGamePrices(lines: string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of lines) {
    const m = /^(.+?)\s*[:=]\s*\$?\s*(\d+(?:[.,]\d{1,2})?)\s*$/.exec(line.trim());
    if (!m) continue;
    out.set(m[1]!.trim().toLowerCase(), Math.round(Number(m[2]!.replace(',', '.')) * 100));
  }
  return out;
}

/** A guess at what a copy cost, for Squirrelcade's own view of the collection only: never an export's price paid. */
export interface CostEstimate {
  cents: number;
  /** new: bought new, at the console's usual price for a new game; used: a share of it (a copy without its box). */
  basis: 'new' | 'used';
  /** The console's usual price for a new game the estimate starts from. */
  newCents: number;
  /** When a copy bought new was most likely bought: the game's release (null when that isn't known). */
  date: string | null;
}

/**
 * Estimates what a copy without a price paid cost: a sealed or complete copy (or one with its box) at the console's
 * usual price for a new game, dated at the game's release; a copy without its box at `usedShare` percent of it, with
 * no date. Null when the console has no price in the list.
 */
export function estimateCost(
  copy: { completeness: Completeness | string; platformKey: string; platformName: string },
  released: string | null,
  prices: Map<string, number>,
  usedShare: number,
): CostEstimate | null {
  const base = regionalConsole(copy.platformKey)?.base;
  const baseName = base ? KNOWN_PLATFORMS.find((k) => k.key === base)?.name.toLowerCase() : undefined;
  const newCents = prices.get(copy.platformName.toLowerCase()) ?? prices.get(copy.platformKey) ?? (base ? prices.get(base) : undefined) ?? (baseName ? prices.get(baseName) : undefined);
  if (newCents === undefined) return null;
  const used = ['loose', 'box-only', 'manual-only', 'unknown'].includes(copy.completeness);
  return used
    ? { cents: Math.round((newCents * usedShare) / 100), basis: 'used', newCents, date: null }
    : { cents: newCents, basis: 'new', newCents, date: released };
}

/** The results a test of a copy can have. */
export const TEST_RESULTS = { works: 'Works', issues: 'Works, with problems', broken: "Doesn't work" } as const;
export type TestResult = keyof typeof TEST_RESULTS;

/** A test of a copy (played) or a rip of it (its disc read in full, 0.22.0); a rip's results in words. */
export type TestKind = 'test' | 'rip';
export const RIP_RESULTS: Record<TestResult, string> = { works: 'Read fully', issues: 'Read with errors', broken: "Couldn't be read" };
