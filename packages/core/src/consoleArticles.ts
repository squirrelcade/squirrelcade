/**
 * The English Wikipedia article of each console Roots knows, by platform key: the page whose lead photo is the console's
 * picture on Roots' cards (R16). A console not listed here is looked up by its name. Titles only; nothing is fetched here.
 */
export const CONSOLE_ARTICLES: Record<string, string> = {
  'nintendo-entertainment-system': 'Nintendo Entertainment System',
  'famicom-disk-system': 'Famicom Disk System',
  'super-nintendo': 'Super Nintendo Entertainment System',
  'nintendo-64': 'Nintendo 64',
  'nintendo-gamecube': 'GameCube',
  wii: 'Wii',
  'wii-u': 'Wii U',
  'nintendo-switch': 'Nintendo Switch',
  'nintendo-switch-2': 'Nintendo Switch 2',
  'game-boy': 'Game Boy',
  'game-boy-color': 'Game Boy Color',
  'game-boy-advance': 'Game Boy Advance',
  'nintendo-ds': 'Nintendo DS',
  'nintendo-3ds': 'Nintendo 3DS',
  'virtual-boy': 'Virtual Boy',
  'game-and-watch': 'Game & Watch',
  playstation: 'PlayStation (console)',
  'playstation-2': 'PlayStation 2',
  'playstation-3': 'PlayStation 3',
  'playstation-4': 'PlayStation 4',
  'playstation-5': 'PlayStation 5',
  psp: 'PlayStation Portable',
  'playstation-vita': 'PlayStation Vita',
  xbox: 'Xbox (console)',
  'xbox-360': 'Xbox 360',
  'xbox-one': 'Xbox One',
  'xbox-series-x': 'Xbox Series X and Series S',
  'sega-master-system': 'Master System',
  'sega-genesis': 'Sega Genesis',
  'sega-cd': 'Sega CD',
  'sega-32x': '32X',
  'sega-saturn': 'Sega Saturn',
  'sega-dreamcast': 'Dreamcast',
  'sega-game-gear': 'Game Gear',
  'sega-sg-1000': 'SG-1000',
  'atari-2600': 'Atari 2600',
  'atari-5200': 'Atari 5200',
  'atari-7800': 'Atari 7800',
  'atari-lynx': 'Atari Lynx',
  'atari-jaguar': 'Atari Jaguar',
  'magnavox-odyssey': 'Magnavox Odyssey',
  'magnavox-odyssey-2': 'Magnavox Odyssey 2',
  intellivision: 'Intellivision',
  colecovision: 'ColecoVision',
  'turbografx-16': 'TurboGrafx-16',
  'neo-geo': 'Neo Geo (system)',
  'neo-geo-pocket': 'Neo Geo Pocket',
  'neo-geo-pocket-color': 'Neo Geo Pocket Color',
  '3do': '3DO Interactive Multiplayer',
  'n-gage': 'N-Gage (device)',
  vectrex: 'Vectrex',
  'arcadia-2001': 'Arcadia 2001',
  astrocade: 'Bally Astrocade',
  'epoch-super-cassette-vision': 'Super Cassette Vision',
  arcade: 'Arcade video game',
};

/** A console's Wikipedia article title: the table's, else its name. */
export function consoleArticle(platformKey: string, name: string): string {
  return CONSOLE_ARTICLES[platformKey] ?? name;
}

/** The Commons file page a picture's address comes from ("https://commons.wikimedia.org/wiki/File:X.jpg"), or null for any other host (a non-free file on en.wikipedia, say). */
export function commonsFilePage(imageUrl: string): string | null {
  const m = /^https:\/\/(?:upload|thumb)\.wikimedia\.org\/wikipedia\/commons\/(?:thumb\/)?[0-9a-f]\/[0-9a-f]{2}\/([^/?#]+)/i.exec(imageUrl);
  if (!m) return null;
  return `https://commons.wikimedia.org/wiki/File:${m[1]}`;
}

/**
 * Units sold in short ("About 87.4 million worldwide (Sony's final figure)" is "87.4 million", "770,000" stays, "20,000–30,000
 * (estimated)" is "20,000–30,000"): the first figure of the text, or null when it has none. The full text is for a tooltip.
 */
export function unitsSoldShort(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = /(\d[\d,]*(?:\.\d+)?)(?:\s*(million|billion|thousand))?(?:\s*[–-]\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(million|billion|thousand))?)?/i.exec(text);
  if (!m) return null;
  const [, a, unitA, b, unitB] = m;
  if (b) return unitB ? `${a}${unitA ? ` ${unitA.toLowerCase()}` : ''}–${b} ${unitB.toLowerCase()}` : `${a}–${b}${unitA ? ` ${unitA.toLowerCase()}` : ''}`;
  return `${a}${unitA ? ` ${unitA.toLowerCase()}` : ''}`;
}
