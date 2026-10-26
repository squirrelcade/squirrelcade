import { regionalConsole } from './platforms.js';

/**
 * Every console's mark (D175): one table, so a new console gets its mark in one place. Squirrelcade's own pixel
 * marks in each console's colors, not the companies' logos (their trademarks, in a public app): a few drawn as
 * pictures (the Switch's two Joy-Con, the Switch 2's with its 2 between them, a PC's screen), the rest the console's
 * short name in pixel letters on a tile of its color. Filled where you have the game (or the console's games),
 * dotted where you don't.
 */
export type MarkCompany = 'nintendo' | 'sony' | 'microsoft' | 'sega' | 'atari' | 'nec' | 'snk' | 'pc' | 'other';

export interface ConsoleMarkDef {
  /** Its short name, in pixel letters (none for a drawn mark). */
  abbr?: string;
  /** A drawn mark instead: rows of pixels, a letter per color (A, B, C...) or "." for none. */
  icon?: { rows: string[]; colors: string[] };
  /** The tile's color. */
  color: string;
  company: MarkCompany;
  /** The year it came out (the newest first on a cover, D175). */
  year: number;
}

const SWITCH_ROWS = ['.AA..BB.', 'AAA..BBB', 'A.A..B.B', 'AAA..BBB', 'AAA..BBB', 'A.A..B.B', 'AAA..BBB', '.AA..BB.'];

export const CONSOLE_MARKS: Readonly<Record<string, ConsoleMarkDef>> = {
  'nintendo-entertainment-system': { abbr: 'NES', color: '#C4342D', company: 'nintendo', year: 1983 },
  famicom: { abbr: 'FC', color: '#C4342D', company: 'nintendo', year: 1983 },
  'famicom-disk-system': { abbr: 'FDS', color: '#C4342D', company: 'nintendo', year: 1986 },
  'super-nintendo': { abbr: 'SNES', color: '#5B4A9C', company: 'nintendo', year: 1990 },
  'super-famicom': { abbr: 'SFC', color: '#5B4A9C', company: 'nintendo', year: 1990 },
  'nintendo-64': { abbr: 'N64', color: '#1F4BA5', company: 'nintendo', year: 1996 },
  'nintendo-gamecube': { abbr: 'GC', color: '#5A4FCF', company: 'nintendo', year: 2001 },
  wii: { abbr: 'WII', color: '#2A9FD6', company: 'nintendo', year: 2006 },
  'wii-u': { abbr: 'WIIU', color: '#009AC7', company: 'nintendo', year: 2012 },
  'nintendo-switch': { icon: { rows: SWITCH_ROWS, colors: ['#E60012', '#00A0E9'] }, color: '#E60012', company: 'nintendo', year: 2017 },
  'nintendo-switch-2': {
    icon: { rows: ['AA.CC.BB', 'AA...CBB', 'AA..C.BB', 'AA.C..BB', 'AA.CCCBB', 'AA....BB', 'AA....BB', 'AA....BB'], colors: ['#E60012', '#00A0E9', '#8A8A8A'] },
    color: '#E60012',
    company: 'nintendo',
    year: 2025,
  },
  'game-boy': { abbr: 'GB', color: '#7A8B3A', company: 'nintendo', year: 1989 },
  'game-boy-color': { abbr: 'GBC', color: '#6A1B9A', company: 'nintendo', year: 1998 },
  'game-boy-advance': { abbr: 'GBA', color: '#3F3FBF', company: 'nintendo', year: 2001 },
  'nintendo-ds': { abbr: 'DS', color: '#7D7D7D', company: 'nintendo', year: 2004 },
  'nintendo-3ds': { abbr: '3DS', color: '#CE1126', company: 'nintendo', year: 2011 },
  'virtual-boy': { abbr: 'VB', color: '#B00000', company: 'nintendo', year: 1995 },
  'game-and-watch': { abbr: 'GW', color: '#B08D00', company: 'nintendo', year: 1980 },
  playstation: { abbr: 'PS1', color: '#7D838C', company: 'sony', year: 1994 },
  'playstation-2': { abbr: 'PS2', color: '#1B2A6B', company: 'sony', year: 2000 },
  'playstation-3': { abbr: 'PS3', color: '#2B2B2B', company: 'sony', year: 2006 },
  'playstation-4': { abbr: 'PS4', color: '#003791', company: 'sony', year: 2013 },
  'playstation-5': { abbr: 'PS5', color: '#0070D1', company: 'sony', year: 2020 },
  psp: { abbr: 'PSP', color: '#333333', company: 'sony', year: 2004 },
  'playstation-vita': { abbr: 'VITA', color: '#1A1A6E', company: 'sony', year: 2011 },
  xbox: { abbr: 'XB', color: '#107C10', company: 'microsoft', year: 2001 },
  'xbox-360': { abbr: '360', color: '#4C9E1A', company: 'microsoft', year: 2005 },
  'xbox-one': { abbr: 'ONE', color: '#0E7A0D', company: 'microsoft', year: 2013 },
  'xbox-series-x': { abbr: 'XS', color: '#0B5D0B', company: 'microsoft', year: 2020 },
  'sega-master-system': { abbr: 'SMS', color: '#D52B1E', company: 'sega', year: 1985 },
  'sega-genesis': { abbr: 'GEN', color: '#1A1A1A', company: 'sega', year: 1988 },
  'mega-drive-japan': { abbr: 'MD', color: '#1A1A1A', company: 'sega', year: 1988 },
  'mega-drive-pal': { abbr: 'MD', color: '#1A1A1A', company: 'sega', year: 1990 },
  'sega-cd': { abbr: 'SCD', color: '#2D2D2D', company: 'sega', year: 1991 },
  'sega-32x': { abbr: '32X', color: '#C8102E', company: 'sega', year: 1994 },
  'sega-saturn': { abbr: 'SAT', color: '#4A4A8C', company: 'sega', year: 1994 },
  'sega-dreamcast': { abbr: 'DC', color: '#E8661F', company: 'sega', year: 1998 },
  'sega-game-gear': { abbr: 'GG', color: '#262626', company: 'sega', year: 1990 },
  'atari-2600': { abbr: '2600', color: '#8B5A2B', company: 'atari', year: 1977 },
  'atari-5200': { abbr: '5200', color: '#3A3A3A', company: 'atari', year: 1982 },
  'atari-7800': { abbr: '7800', color: '#4A4A4A', company: 'atari', year: 1986 },
  'atari-lynx': { abbr: 'LYNX', color: '#C98B00', company: 'atari', year: 1989 },
  'atari-jaguar': { abbr: 'JAG', color: '#C8102E', company: 'atari', year: 1993 },
  'magnavox-odyssey': { abbr: 'ODY', color: '#3A3A3A', company: 'other', year: 1972 },
  'magnavox-odyssey-2': { abbr: 'OD2', color: '#4A4A4A', company: 'other', year: 1978 },
  intellivision: { abbr: 'INTV', color: '#8C6E3F', company: 'other', year: 1979 },
  colecovision: { abbr: 'CV', color: '#1F3A93', company: 'other', year: 1982 },
  'turbografx-16': { abbr: 'TG16', color: '#E8661F', company: 'nec', year: 1987 },
  'pc-engine': { abbr: 'PCE', color: '#5A5A5A', company: 'nec', year: 1987 },
  'neo-geo': { abbr: 'NEO', color: '#B08D00', company: 'snk', year: 1990 },
  '3do': { abbr: '3DO', color: '#2D2D2D', company: 'other', year: 1993 },
  'n-gage': { abbr: 'NG', color: '#2B7BB9', company: 'other', year: 2003 },
  pc: {
    icon: { rows: ['AAAAAAAA', 'A......A', 'A......A', 'A......A', 'AAAAAAAA', '...AA...', '..AAAA..', '........'], colors: ['#6E6E6E'] },
    color: '#6E6E6E',
    company: 'pc',
    year: 0,
  },
};

/**
 * A console's mark: its own, its base console's for another region's (the Japanese PlayStation 2's is the
 * PlayStation 2's), else its name's initials on a grey tile (a console Roots knows that has none yet).
 */
export function consoleMark(platformKey: string, name = ''): ConsoleMarkDef {
  const own = CONSOLE_MARKS[platformKey] ?? CONSOLE_MARKS[regionalConsole(platformKey)?.base ?? ''];
  if (own) return own;
  const words = (name || platformKey.replace(/-/g, ' ')).split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const abbr = (words.length > 1 ? words.map((w) => (/^\d+$/.test(w) ? w : w[0]!)).join('') : (words[0] ?? '?').slice(0, 3)).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
  return { abbr: abbr || '?', color: '#6E6E6E', company: 'other', year: 0 };
}

/** The pixel letters (3 wide, 5 tall) the marks' short names are drawn in. */
const FONT: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  V: ['#.#', '#.#', '#.#', '.#.', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '##.', '..#', '##.'],
  '6': ['.##', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '##.'],
  '?': ['##.', '..#', '.#.', '...', '.#.'],
};

/**
 * A mark as rows of pixels: "A", "B"... a color of its own (icon), "#" the tile's color, "+" the letters on it, "."
 * nothing. A short name is a tile 7 pixels tall, its letters in the middle with a pixel between them; its corners
 * are cut, for a rounded look.
 */
export function markPixels(mark: ConsoleMarkDef): string[] {
  if (mark.icon) return mark.icon.rows;
  const letters = [...(mark.abbr ?? '?')].map((c) => FONT[c] ?? FONT['?']!);
  const textWidth = letters.length * 4 - 1;
  const width = textWidth + 4;
  const rows: string[] = [];
  for (let y = 0; y < 7; y++) {
    let row = '';
    for (let x = 0; x < width; x++) {
      const corner = (y === 0 || y === 6) && (x === 0 || x === width - 1);
      if (corner) {
        row += '.';
        continue;
      }
      const tx = x - 2;
      const ty = y - 1;
      const letter = tx >= 0 && ty >= 0 && ty < 5 && tx < textWidth && tx % 4 < 3 ? letters[Math.floor(tx / 4)]![ty]![tx % 4] : '.';
      row += letter === '#' ? '+' : '#';
    }
    rows.push(row);
  }
  return rows;
}

/** Light or dark letters on a tile, whichever reads on its color. */
export function markInk(color: string): string {
  const n = Number.parseInt(color.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#1A1A1A' : '#FFFFFF';
}

/**
 * The consoles a cover's banner shows (D175, the owner's rules): the newest you have it on, one per company, two at
 * most; two of one company only when that's all there is (the Switch and the Switch 2). PC isn't one of them: it
 * has its own place at the right end.
 */
export function coverMarks(platformKeys: readonly string[], most = 2): string[] {
  const consoles = [...new Set(platformKeys)].filter((k) => k !== 'pc').sort((a, b) => consoleMark(b).year - consoleMark(a).year || a.localeCompare(b));
  const picked: string[] = [];
  const companies = new Set<string>();
  for (const k of consoles) {
    if (picked.length >= most) break;
    const c = consoleMark(k).company;
    if (companies.has(c) && c !== 'other') continue;
    picked.push(k);
    companies.add(c);
  }
  // One company only (or fewer companies than places): its next newest fill the places left.
  for (const k of consoles) {
    if (picked.length >= most) break;
    if (!picked.includes(k)) picked.push(k);
  }
  return picked;
}
