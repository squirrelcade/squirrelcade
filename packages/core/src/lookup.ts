import { withoutEditionWords } from './catalog.js';
import { platformInText } from './catalogList.js';
import { KNOWN_PLATFORMS } from './platforms.js';
import { matchTokens, normalizeTitle, romajiTokens } from './text.js';

/** Words retail product names add around a game's title. */
const PLATFORM_WORDS = [
  'playstation 5', 'playstation 4', 'playstation 3', 'playstation 2', 'playstation vita', 'playstation', 'ps5', 'ps4', 'ps3', 'ps2', 'psp', 'ps vita',
  'nintendo switch 2', 'nintendo switch', 'switch 2', 'switch', 'nintendo 3ds', '3ds', 'nintendo ds', 'nintendo wii u', 'wii u', 'nintendo wii', 'wii',
  'nintendo gamecube', 'gamecube', 'nintendo 64', 'n64', 'game boy advance', 'gba', 'xbox series x', 'xbox series s', 'xbox series x s', 'xbox one',
  'xbox 360', 'xbox', 'sega dreamcast', 'dreamcast', 'pc', 'windows',
];

const NOISE_WORDS = [
  'video game', 'standard edition', 'physical edition', 'physical', 'brand new', 'new', 'sealed', 'factory sealed', 'game', 'edition',
  // Reprint lines and the state of a used copy.
  'greatest hits', 'platinum hits', 'players choice', 'nintendo selects', 'essentials', 'pre owned', 'preowned', 'refurbished', 'used',
];

/**
 * Turns a retail product name ("Uncharted 3: Drake's Deception - PlayStation 3
 * Standard Edition") into the words worth searching for ("uncharted 3 drakes deception").
 */
export function cleanProductTitle(name: string): string {
  let t = name.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ');
  // Everything after a spaced dash or a " for " is usually platform or packaging.
  t = t.replace(/\s[-–—|]\s.*$/, '').replace(/\sfor\s(nintendo|playstation|xbox|sega|pc|wii|ps\d).*$/i, '');
  // An edition written after the title is the game ("Mafia III Deluxe Edition" is Mafia III).
  t = withoutEditionWords(t.replace(/\s+/g, ' ').trim());
  let n = normalizeTitle(t);
  for (const w of [...PLATFORM_WORDS, ...NOISE_WORDS].sort((a, b) => b.length - a.length)) {
    n = ` ${n} `.replace(new RegExp(` ${w} `, 'g'), ' ').trim();
  }
  return n.replace(/\s+/g, ' ').trim();
}

/**
 * A retail product name's words, with its bracketed notes and punctuation between words left out: the game's
 * title is a run of them, with a publisher's name, an edition, the console or packaging words around it
 * ("Microsoft Halo 5: Guardians - Xbox One"), which Store Mode finds by trying the longest runs first. Words keep
 * their apostrophes, since titles are compared with them ("Thief's" is "Thief", as catalogs compare it).
 */
export function productNameWords(name: string): string[] {
  return name
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .split(/[\s:;,|/–—-]+/)
    .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’]+$/gu, ''))
    .filter((w) => /[\p{L}\p{N}]/u.test(w));
}

/** Words that say little about which game a name is. */
const MINOR_WORDS = new Set(['the', 'a', 'an', 'of', 'and', 'for', 'in', 'on', 'to', 'with', 'edition', 'game', 'video']);

/**
 * How much of a name and a title are the same words, 0 to 1 (the F1 measure: the name's words found in the title,
 * and the title's found in the name), leaving out words like "the" and "edition". For a barcode service's name
 * that no title fits exactly ("Sony Uncharted 4 A Thiefs End" and "Uncharted 4: A Thief's End" share 4 of 5).
 */
export function wordOverlap(name: string, title: string): number {
  const words = (text: string) => new Set(normalizeTitle(text).split(' ').filter((w) => w && !MINOR_WORDS.has(w)));
  const n = words(name);
  const t = words(title);
  if (n.size === 0 || t.size === 0) return 0;
  let hit = 0;
  for (const w of n) if (t.has(w)) hit++;
  if (hit === 0) return 0;
  const found = hit / n.size;
  const covered = hit / t.size;
  return (2 * found * covered) / (found + covered);
}

/** The console a retail product name names ("Mafia III Deluxe Edition (Xbox One)" is for the Xbox One), or null. */
export function productPlatform(name: string): string | null {
  return platformInText(name, KNOWN_PLATFORMS);
}

/** searchRank on normalized text. */
function rank(t: string, q: string): number {
  if (t === q) return 3;
  if (t.startsWith(q)) return 2;
  const words = ` ${t} `;
  return q.split(' ').every((w) => words.includes(` ${w} `) || (w.length >= 3 && t.includes(w))) ? 1 : 0;
}

/**
 * A title normalized, and with Japanese long vowels folded, kept once worked out: Store Mode searches every
 * catalog title on each keystroke, and the titles hardly change. Forgotten when it grows past a limit.
 */
const searchForms = new Map<string, { plain: string; folded: string; numbered: string }>();
function searchForm(title: string): { plain: string; folded: string; numbered: string } {
  let form = searchForms.get(title);
  if (!form) {
    if (searchForms.size > 200_000) searchForms.clear();
    const plain = normalizeTitle(title);
    form = { plain, folded: romajiTokens(plain.split(' ')).join(' '), numbered: matchTokens(title).join(' ') };
    searchForms.set(title, form);
  }
  return form;
}

/**
 * How well a title answers a search: 3 exact, 2 starts with the query, 1 contains every word, 0 no match.
 * A Japanese title typed with its long vowels written out, or not, still finds it ("Jikkyou" finds "Jikkyō").
 */
export function searchRank(title: string, query: string): number {
  const q = searchForm(query);
  if (!q.plain) return 0;
  const t = searchForm(title);
  const plain = rank(t.plain, q.plain);
  if (plain > 0) return plain;
  const folded = rank(t.folded, q.folded);
  if (folded > 0) return folded;
  // Numbers written either way, as catalogs match them: "Mafia 2" finds "Mafia II", "Final Fantasy VII" "Final Fantasy 7".
  return rank(t.numbered, q.numbered);
}

/**
 * Keeps the digits of a scanned code; UPC-A, EAN-8/13 and GTIN-14 are 8 to 14 digits. A UPC-A read with zeros in
 * front (as an EAN-13 or a GTIN-14, as some phones read it) is the same code, so it's kept as its 12 digits:
 * whichever way a camera reads a box, it's one barcode.
 */
export function normalizeBarcode(code: string): string | null {
  let digits = code.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  while (digits.length > 12 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

/** A barcode's forms as it may have been saved before: its 12 digits, and with the zeros some phones add in front. */
export function barcodeForms(code: string): string[] {
  const digits = normalizeBarcode(code);
  if (!digits) return [];
  return digits.length === 12 ? [digits, `0${digits}`, `00${digits}`] : digits.length === 13 ? [digits, `0${digits}`] : [digits];
}
