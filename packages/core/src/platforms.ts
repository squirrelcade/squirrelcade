import { slugify } from './text.js';

/** Where a release is from. */
export type Region = 'north-america' | 'europe' | 'japan' | 'asia' | 'other';

/** Region names for the interface. */
export const REGION_LABELS: Record<Region, string> = {
  'north-america': 'North America',
  europe: 'Europe (PAL)',
  japan: 'Japan',
  asia: 'Asia',
  other: 'Other',
};

/** Short region names for badges ("US" as collectors say, where "NA" would read as "not available"). */
export const REGION_SHORT: Record<Region, string> = {
  'north-america': 'US',
  europe: 'PAL',
  japan: 'JP',
  asia: 'Asia',
  other: 'Other',
};

/** Region prefixes PriceCharting puts in front of console names, e.g. "JP Nintendo Switch". */
const REGION_PREFIXES: { prefix: string; region: Region }[] = [
  { prefix: 'asian english ', region: 'asia' },
  { prefix: 'jp ', region: 'japan' },
  { prefix: 'pal ', region: 'europe' },
  { prefix: 'chinese ', region: 'asia' },
  { prefix: 'korean ', region: 'asia' },
];

/** A platform Squirrelcade knows out of the box, with the PriceCharting console names that belong to it. */
export interface KnownPlatform {
  key: string;
  name: string;
  /** PriceCharting console names without a region prefix. */
  labels: string[];
  /** Names that are always a regional release of this platform, e.g. Super Famicom. */
  regionalLabels?: { label: string; region: Region }[];
}

/**
 * Built-in starting point for recognizing PriceCharting console names. Users can
 * add or change mappings on the Platforms settings page; this list only seeds them.
 */
export const KNOWN_PLATFORMS: KnownPlatform[] = [
  { key: 'nintendo-entertainment-system', name: 'Nintendo Entertainment System', labels: ['NES'], regionalLabels: [{ label: 'Famicom', region: 'japan' }] },
  { key: 'famicom-disk-system', name: 'Famicom Disk System', labels: ['Famicom Disk System'] },
  { key: 'super-nintendo', name: 'Super Nintendo', labels: ['Super Nintendo'], regionalLabels: [{ label: 'Super Famicom', region: 'japan' }] },
  { key: 'nintendo-64', name: 'Nintendo 64', labels: ['Nintendo 64'] },
  { key: 'nintendo-gamecube', name: 'Nintendo GameCube', labels: ['Gamecube'] },
  { key: 'wii', name: 'Wii', labels: ['Wii'] },
  { key: 'wii-u', name: 'Wii U', labels: ['Wii U'] },
  { key: 'nintendo-switch', name: 'Nintendo Switch', labels: ['Nintendo Switch', 'Switch'] },
  { key: 'nintendo-switch-2', name: 'Nintendo Switch 2', labels: ['Nintendo Switch 2', 'Switch 2'] },
  { key: 'game-boy', name: 'Game Boy', labels: ['GameBoy'] },
  { key: 'game-boy-color', name: 'Game Boy Color', labels: ['GameBoy Color'] },
  { key: 'game-boy-advance', name: 'Game Boy Advance', labels: ['GameBoy Advance'] },
  { key: 'nintendo-ds', name: 'Nintendo DS', labels: ['Nintendo DS'] },
  { key: 'nintendo-3ds', name: 'Nintendo 3DS', labels: ['Nintendo 3DS'] },
  { key: 'virtual-boy', name: 'Virtual Boy', labels: ['Virtual Boy'] },
  { key: 'game-and-watch', name: 'Game & Watch', labels: ['Game & Watch'] },
  { key: 'playstation', name: 'PlayStation', labels: ['Playstation'] },
  { key: 'playstation-2', name: 'PlayStation 2', labels: ['Playstation 2'] },
  { key: 'playstation-3', name: 'PlayStation 3', labels: ['Playstation 3'] },
  { key: 'playstation-4', name: 'PlayStation 4', labels: ['Playstation 4'] },
  { key: 'playstation-5', name: 'PlayStation 5', labels: ['Playstation 5'] },
  { key: 'psp', name: 'PSP', labels: ['PSP'] },
  { key: 'playstation-vita', name: 'PlayStation Vita', labels: ['Playstation Vita'] },
  { key: 'xbox', name: 'Xbox', labels: ['Xbox'] },
  { key: 'xbox-360', name: 'Xbox 360', labels: ['Xbox 360'] },
  { key: 'xbox-one', name: 'Xbox One', labels: ['Xbox One'] },
  { key: 'xbox-series-x', name: 'Xbox Series X', labels: ['Xbox Series X'] },
  { key: 'sega-master-system', name: 'Sega Master System', labels: ['Sega Master System'] },
  { key: 'sega-genesis', name: 'Sega Genesis', labels: ['Sega Genesis'], regionalLabels: [{ label: 'Sega Mega Drive', region: 'europe' }] },
  { key: 'sega-cd', name: 'Sega CD', labels: ['Sega CD'] },
  { key: 'sega-32x', name: 'Sega 32X', labels: ['Sega 32X'] },
  { key: 'sega-saturn', name: 'Sega Saturn', labels: ['Sega Saturn'] },
  { key: 'sega-dreamcast', name: 'Sega Dreamcast', labels: ['Sega Dreamcast'] },
  { key: 'sega-game-gear', name: 'Sega Game Gear', labels: ['Sega Game Gear'] },
  { key: 'atari-2600', name: 'Atari 2600', labels: ['Atari 2600'] },
  { key: 'atari-5200', name: 'Atari 5200', labels: ['Atari 5200'] },
  { key: 'atari-7800', name: 'Atari 7800', labels: ['Atari 7800'] },
  { key: 'atari-lynx', name: 'Atari Lynx', labels: ['Atari Lynx'] },
  { key: 'atari-jaguar', name: 'Atari Jaguar', labels: ['Jaguar'] },
  { key: 'magnavox-odyssey', name: 'Magnavox Odyssey', labels: ['Magnavox Odyssey'] },
  { key: 'magnavox-odyssey-2', name: 'Magnavox Odyssey 2', labels: ['Magnavox Odyssey 2'] },
  { key: 'intellivision', name: 'Intellivision', labels: ['Intellivision'] },
  { key: 'colecovision', name: 'ColecoVision', labels: ['Colecovision'] },
  { key: 'turbografx-16', name: 'TurboGrafx-16', labels: ['TurboGrafx-16'], regionalLabels: [{ label: 'PC Engine', region: 'japan' }] },
  { key: 'neo-geo', name: 'Neo Geo', labels: ['Neo Geo AES', 'Neo Geo'] },
  { key: '3do', name: '3DO', labels: ['3DO'] },
  { key: 'n-gage', name: 'N-Gage', labels: ['N-Gage'] },
];

/** A PriceCharting console name, split into the platform and region it stands for. */
export interface ParsedConsoleLabel {
  /** The label exactly as PriceCharting wrote it. */
  label: string;
  /** The label without its region prefix. */
  base: string;
  region: Region;
  /** Matching built-in platform, if any. */
  platform: KnownPlatform | null;
  /** Suggested key: the built-in one, or a slug of the base name. */
  platformKey: string;
  platformName: string;
}

const byLabel = new Map<string, { platform: KnownPlatform; region?: Region }>();
for (const p of KNOWN_PLATFORMS) {
  for (const l of p.labels) byLabel.set(l.toLowerCase(), { platform: p });
  for (const r of p.regionalLabels ?? []) byLabel.set(r.label.toLowerCase(), { platform: p, region: r.region });
}

/** Splits a PriceCharting console name into region and platform: "PAL Playstation 3" -> PlayStation 3, Europe. */
export function parseConsoleLabel(label: string): ParsedConsoleLabel {
  const trimmed = label.trim();
  const lower = trimmed.toLowerCase();
  let base = trimmed;
  let region: Region | null = null;
  for (const { prefix, region: r } of REGION_PREFIXES) {
    if (lower.startsWith(prefix)) {
      base = trimmed.slice(prefix.length).trim();
      region = r;
      break;
    }
  }
  const known = byLabel.get(base.toLowerCase());
  const platform = known?.platform ?? null;
  // An unprefixed name is the North American release on PriceCharting; special names carry their own region.
  const resolvedRegion: Region = region ?? known?.region ?? 'north-america';
  return {
    label: trimmed,
    base,
    region: resolvedRegion,
    platform,
    platformKey: platform?.key ?? slugify(base),
    platformName: platform?.name ?? base,
  };
}

/**
 * Consoles that play only their own region's games (cartridge shapes, lockout chips, region codes):
 * the defaults of Settings > Platforms > Region-locked consoles.
 */
export const REGION_LOCKED_DEFAULT: readonly string[] = [
  'nintendo-entertainment-system',
  'super-nintendo',
  'nintendo-64',
  'nintendo-gamecube',
  'wii',
  'wii-u',
  'nintendo-3ds',
  'playstation',
  'playstation-2',
  'xbox',
  'xbox-360',
  'sega-master-system',
  'sega-genesis',
  'sega-cd',
  'sega-32x',
  'sega-saturn',
  'sega-dreamcast',
  'turbografx-16',
];

/** Another region's version of a console that goes by a name of its own (the Super Famicom is the Japanese Super Nintendo). */
const REGIONAL_CONSOLES: { key: string; name: string; base: string; region: Region }[] = [
  { key: 'famicom', name: 'Famicom', base: 'nintendo-entertainment-system', region: 'japan' },
  { key: 'super-famicom', name: 'Super Famicom', base: 'super-nintendo', region: 'japan' },
  { key: 'pc-engine', name: 'PC Engine', base: 'turbografx-16', region: 'japan' },
  { key: 'mega-drive-japan', name: 'Mega Drive (Japan)', base: 'sega-genesis', region: 'japan' },
  { key: 'mega-drive-pal', name: 'Mega Drive (PAL)', base: 'sega-genesis', region: 'europe' },
];

/** How a region shows in a regional console's key and name ("nintendo-64-japan", "Nintendo 64 (Japan)"). */
const REGION_CONSOLE: Record<Region, { slug: string; name: string }> = {
  'north-america': { slug: 'north-america', name: 'North America' },
  europe: { slug: 'pal', name: 'PAL' },
  japan: { slug: 'japan', name: 'Japan' },
  asia: { slug: 'asia', name: 'Asia' },
  other: { slug: 'other', name: 'Other' },
};

/**
 * The console a copy counts toward. On a region-locked console, a copy from another region than
 * the home region counts toward that region's console of its own (the Super Famicom, "Nintendo 64
 * (Japan)"); on the other consoles, copies from every region count toward the one console.
 */
export function consoleFor(platform: { key: string; name: string }, region: Region, homeRegion: string, regionLocked: readonly string[]): { key: string; name: string } {
  if (!regionLocked.includes(platform.key) || region === homeRegion) return { key: platform.key, name: platform.name };
  const named = REGIONAL_CONSOLES.find((c) => c.base === platform.key && c.region === region);
  if (named) return { key: named.key, name: named.name };
  return { key: `${platform.key}-${REGION_CONSOLE[region].slug}`, name: `${platform.name} (${REGION_CONSOLE[region].name})` };
}

/** The maker families the redesign colors consoles by (D117): blue PlayStation, green Xbox, orange Nintendo, gold the rest. */
export type PlatformFamily = 'playstation' | 'xbox' | 'nintendo' | 'other';

const FAMILY_OF: Record<string, PlatformFamily> = {
  'nintendo-entertainment-system': 'nintendo',
  'famicom-disk-system': 'nintendo',
  'super-nintendo': 'nintendo',
  'nintendo-64': 'nintendo',
  'nintendo-gamecube': 'nintendo',
  wii: 'nintendo',
  'wii-u': 'nintendo',
  'nintendo-switch': 'nintendo',
  'nintendo-switch-2': 'nintendo',
  'game-boy': 'nintendo',
  'game-boy-color': 'nintendo',
  'game-boy-advance': 'nintendo',
  'nintendo-ds': 'nintendo',
  'nintendo-3ds': 'nintendo',
  'virtual-boy': 'nintendo',
  'game-and-watch': 'nintendo',
  playstation: 'playstation',
  'playstation-2': 'playstation',
  'playstation-3': 'playstation',
  'playstation-4': 'playstation',
  'playstation-5': 'playstation',
  psp: 'playstation',
  'playstation-vita': 'playstation',
  xbox: 'xbox',
  'xbox-360': 'xbox',
  'xbox-one': 'xbox',
  'xbox-series-x': 'xbox',
};

/**
 * A console's maker family, for its color: by its key (another region's console takes its base console's), else by
 * its name for a console added by hand ("PlayStation Portable", "Xbox Live Arcade", "Super Famicom").
 */
export function platformFamily(key: string, name = ''): PlatformFamily {
  const known = FAMILY_OF[regionalConsole(key)?.base ?? key];
  if (known) return known;
  const text = `${key} ${name}`.toLowerCase();
  if (/playstation|\bps[1-5p]\b|\bpsp\b|\bvita\b/.test(text)) return 'playstation';
  if (/xbox/.test(text)) return 'xbox';
  if (/nintendo|famicom|\bwii\b|wii-u|game ?boy|game-boy|gamecube|\bswitch\b|virtual ?boy|\b3?ds\b|\bsnes\b|\bnes\b|\bn64\b|game (and|&) watch/.test(text)) return 'nintendo';
  return 'other';
}

/** For another region's console of its own: the console it is a version of, the region, and its name. Null for any other key. */
export function regionalConsole(key: string): { base: string; region: Region; name: string } | null {
  const named = REGIONAL_CONSOLES.find((c) => c.key === key);
  if (named) return { base: named.base, region: named.region, name: named.name };
  for (const [region, r] of Object.entries(REGION_CONSOLE) as [Region, { slug: string; name: string }][]) {
    if (!key.endsWith(`-${r.slug}`)) continue;
    const base = KNOWN_PLATFORMS.find((p) => p.key === key.slice(0, -r.slug.length - 1));
    if (base) return { base: base.key, region, name: `${base.name} (${r.name})` };
  }
  return null;
}

/**
 * Whether a platform counts under the settings: another region's own console only while its base
 * console is region-locked and its region isn't the home region (unticking the Super Nintendo puts
 * the Super Famicom's copies back on it, and its catalog out of completion and the wishlist).
 */
export function consoleInUse(key: string, homeRegion: string, regionLocked: readonly string[]): boolean {
  const regional = regionalConsole(key);
  return !regional || (regionLocked.includes(regional.base) && regional.region !== homeRegion);
}

/** The region a console's games are from: another region's own console's region, or else the home region. */
export function consoleRegion(key: string, homeRegion: string): string {
  return regionalConsole(key)?.region ?? homeRegion;
}

/**
 * A per-platform value from a map (IGDB platforms, Wikipedia lists, RomM platforms), falling back
 * for another region's own console to the console it is a version of.
 */
export function forPlatform<T>(map: Record<string, T>, key: string): T | undefined {
  const own = map[key];
  if (own !== undefined) return own;
  const base = regionalConsole(key)?.base;
  return base === undefined ? undefined : map[base];
}

/** Short names people use for consoles ("PS3", "360", "Switch"), by platform key (0.55.0, for AI apps' questions). */
export const PLATFORM_SHORT_NAMES: Record<string, string[]> = {
  'nintendo-entertainment-system': ['nes', 'famicom'],
  'super-nintendo': ['snes', 'super nes', 'super famicom', 'sfc'],
  'nintendo-64': ['n64'],
  'nintendo-gamecube': ['gamecube', 'gc', 'gcn', 'ngc'],
  'wii-u': ['wiiu'],
  'nintendo-switch': ['switch', 'ns', 'switch 1'],
  'nintendo-switch-2': ['switch 2', 'ns2'],
  'game-boy': ['gb', 'gameboy'],
  'game-boy-color': ['gbc', 'gameboy color'],
  'game-boy-advance': ['gba', 'gameboy advance'],
  'nintendo-ds': ['ds', 'nds'],
  'nintendo-3ds': ['3ds'],
  playstation: ['ps1', 'psx', 'ps one', 'psone', 'playstation 1'],
  'playstation-2': ['ps2'],
  'playstation-3': ['ps3'],
  'playstation-4': ['ps4'],
  'playstation-5': ['ps5'],
  'playstation-vita': ['vita', 'ps vita', 'psvita'],
  xbox: ['original xbox', 'og xbox'],
  'xbox-360': ['360', 'x360'],
  'xbox-one': ['xb1', 'xbone'],
  'xbox-series-x': ['series x', 'xsx', 'series s', 'xbox series s', 'xbox series'],
  'sega-master-system': ['master system', 'sms'],
  'sega-genesis': ['genesis', 'mega drive', 'megadrive', 'md'],
  'sega-cd': ['mega cd'],
  'sega-32x': ['32x'],
  'sega-saturn': ['saturn'],
  'sega-dreamcast': ['dreamcast', 'dc'],
  'sega-game-gear': ['game gear', 'gg'],
  'atari-2600': ['2600', 'vcs'],
  'atari-jaguar': ['jaguar'],
  'atari-lynx': ['lynx'],
  'turbografx-16': ['tg16', 'tg 16', 'pc engine'],
  'neo-geo': ['neogeo', 'aes'],
};

/**
 * The platforms a name stands for, from those given: by key ("playstation-3"), name ("PlayStation 3"), a short
 * name ("PS3", "360") or PriceCharting's console name ("PAL Playstation 3"). Empty when none fits.
 */
export function findPlatforms<P extends { key: string; name: string }>(asked: string, platforms: readonly P[]): P[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const want = norm(asked);
  if (!want) return [];
  const exact = platforms.filter((p) => norm(p.key) === want || norm(p.name) === want || (PLATFORM_SHORT_NAMES[p.key] ?? []).includes(want));
  if (exact.length > 0) return exact;
  const parsed = parseConsoleLabel(asked);
  const byLabel = platforms.filter((p) => p.key === parsed.platformKey);
  if (byLabel.length > 0) return byLabel;
  // Another region's console of a known one ("super-nintendo-jp"): the short names of the console it's a version of.
  return platforms.filter((p) => {
    const base = regionalConsole(p.key)?.base;
    return base !== undefined && (norm(base) === want || (PLATFORM_SHORT_NAMES[base] ?? []).includes(want));
  });
}
