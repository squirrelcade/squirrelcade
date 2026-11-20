import { baseTitle, editionBase } from './catalog.js';
import type { PageWord } from './magazines.js';
import { CONSOLE_MARKS } from './marks.js';
import { regionalConsole } from './platforms.js';
import { platformsIn } from './sets.js';
import { latinTitle, matchKey } from './text.js';

/**
 * The games on a magazine's page (D192, D242, magazines.md "Matching"): the titles it could be about (the magazine's
 * consoles, games out around its cover date) found in the page's text, with the words' boxes, and how sure each is.
 * Squirrelcade's own rules; the owner's answers on Review > Magazines become rules over them.
 */

/** A game the page could name. */
export interface SpotCandidate {
  platformKey: string;
  title: string;
  /** Its release day, to choose between consoles that have the same title. */
  day: string | null;
  /** The other names it goes by (IGDB's): each may be what a page prints. */
  names?: readonly string[];
}

/** What a find rests on: how the title was written, and what on the page speaks for it. */
export interface SpotEvidence {
  /** Written whole, by its main title, by its subtitle, or by another of its names. */
  as: 'title' | 'main' | 'subtitle' | 'name';
  /** The words that count in what was printed (not "the", "of"...). */
  words: number;
  /** How many times the page names it. */
  times: number;
  /** In big type (a heading). */
  big: boolean;
  /** Written with capitals, as titles are. */
  caps: boolean;
  /** A console named right after it ("(PS3, 360)", "for the Genesis"). */
  console: boolean;
  /** Other candidates' titles begin with it: a series' name as much as a game. */
  series: boolean;
  /** The words around it may make it part of a longer title ("Falcon 3.0", "Gold & Silver"): nothing else settles it. */
  partial: boolean;
}

/** A game found on the page. */
export interface Spotted {
  platformKey: string;
  title: string;
  /** The words on the page that named it. */
  printed: string;
  confidence: number;
  /** Its box in the scan's pixels: the named words joined (where the page names it most surely). */
  box: [number, number, number, number];
  evidence: SpotEvidence;
  /** Every console the candidates have this title on (the page may name one of them). */
  on: readonly string[];
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'vs']);

/** The spotter's rules' version: an issue is looked through again when they change (D192). */
export const SPOT_VERSION = 4;

/** A sequel's number or a year in a title makes it surer ("Suikoden IV", "NCAA Football 2005"). */
const NUMBER = /^\d+$/;

/** A word as compared: lower case, accents and punctuation gone. */
export const spotWord = (w: string) =>
  w
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** A title's words as compared (its colon, dashes and slashes are breaks between words). */
export const spotWords = (s: string) => s.split(/[\s:\-–—/]+/).map(spotWord).filter(Boolean);

/** Roman numbers as digits, so "Quake II" and "Quake 2" are the same words. A lone I or X stays a letter (Mega Man X). */
const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16' };

/** A page's "II" or "III" as the reading often gives them: I's, l's, 1's and bars mixed ("Il", "ll", "||", "IlI"). */
const MISREAD_ROMAN = /^(?!\d+$)(?:[Il1|]{2,3}|Ii|il|iI|I[il]i)$/;

/**
 * One printed word as the words compared (D242): its hyphens and slashes break it, "&" and "'n'" are "and", roman
 * numbers are digits, accents and marks are gone. The same for a title's words and a page's, so both meet.
 */
function wordTokens(raw: string, out: string[]): void {
  const plain = raw.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  if (/^[^A-Za-z0-9&]*(?:&|['’‘`][nN]['’‘`]?|[nN]['’‘`])[^A-Za-z0-9&]*$/.test(plain)) {
    out.push('and');
    return;
  }
  const spaced = plain.replace(/&/g, ' and ').replace(/([A-Za-z])['’‘`][nN](?![A-Za-z])/g, '$1 and ');
  for (const part of spaced.split(/[\s:\-–—/]+/)) {
    // "Il" and "||" are a misread II; "I'll" is not.
    const core = part.replace(/^[^A-Za-z0-9|]+|[^A-Za-z0-9|]+$/g, '');
    if (MISREAD_ROMAN.test(core)) {
      out.push(String(core.length));
      continue;
    }
    const w = part.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
    if (w) out.push(ROMAN[w] ?? w);
  }
}

/** What follows a word, when it matters to a title running on: 1 a full stop, 2 a comma or colon, 3 the end of a sentence (! ? ;). */
function markAfter(raw: string): number {
  const m = /([.,:;!?])["'”’)\]]*$/.exec(raw);
  if (!m) return 0;
  return m[1] === '.' ? 1 : m[1] === ',' || m[1] === ':' ? 2 : 3;
}

/** A way a candidate's title may be written on a page. */
interface Variant {
  c: SpotCandidate;
  /** Its words as compared, and run together (what a page's words are checked against, however they're spaced). */
  tokens: string[];
  str: string;
  /** How much less sure than the whole title: its main title 0.2, its subtitle 0.15, another name 0.1. */
  penalty: number;
  as: SpotEvidence['as'];
  /** Its words that count, and whether one is a number. */
  words: number;
  numbered: boolean;
  /** The marks its own writing has, by where they fall in str: a title's full stop or comma may be on the page too. */
  marks: Map<number, number> | null;
  /** How many other candidates' titles begin with it. */
  stemOf: number;
  /** How many candidates share it as their main title or subtitle. */
  shared: number;
  /** Every console the candidates have its game on. */
  on: string[];
}

export interface SpotIndex {
  first: Map<string, Variant[]>;
  /** The titles (as words) that begin other candidates' titles: series' names. */
  startsOthers: Set<string>;
}

/** Names that come before a game's own title, which a page often leaves out. */
const BRANDS = [
  ['tom', 'clancys'],
  ['tom', 'clancy'],
  ['sid', 'meiers'],
  ['clive', 'barkers'],
  ['american', 'mcgees'],
  ['disney', 'pixar'],
  ['disneys'],
  ['disney'],
  ['marvels'],
  ['marvel'],
];

interface Written {
  tokens: string[];
  marks: Map<number, number> | null;
}

/** A name's words as compared, with the marks it's written with, by where they fall. */
function written(name: string): Written {
  const tokens: string[] = [];
  let marks: Map<number, number> | null = null;
  let at = 0;
  for (const raw of name.split(/\s+/)) {
    const before = tokens.length;
    wordTokens(raw, tokens);
    for (let k = before; k < tokens.length; k++) at += tokens[k]!.length;
    // A dash on its own between words is a break, as a colon is.
    const mark = /^[-–—]+$/.test(raw) ? 2 : markAfter(raw);
    if (mark && at > 0) (marks ??= new Map()).set(at, mark);
  }
  return { tokens, marks };
}

/** The words that count in a title: not "the" or "of", nor a letter alone (the X of X-Men, the U of "U-SA"). */
const meaningful = (tokens: readonly string[]) => tokens.filter((w) => !STOP.has(w) && (w.length > 1 || NUMBER.test(w))).length;

/** The ways a candidate may be written on a page: whole, its main title, its subtitle, another name; each less sure. */
function variantsOf(c: SpotCandidate): Omit<Variant, 'stemOf' | 'shared' | 'on'>[] {
  const out: Omit<Variant, 'stemOf' | 'shared' | 'on'>[] = [];
  const add = (w: Written, penalty: number, as: Variant['as'], from = 0, to = w.tokens.length) => {
    let tokens = w.tokens.slice(from, to);
    let cut = w.tokens.slice(0, from).join('').length;
    if (tokens[0] === 'the' && tokens.length > 1) {
      tokens = tokens.slice(1);
      cut += 3;
    }
    const str = tokens.join('');
    if (str.length < 2 || tokens.every((t) => STOP.has(t))) return;
    let marks: Map<number, number> | null = null;
    for (const [at, mark] of w.marks ?? []) if (at > cut && at - cut < str.length) (marks ??= new Map()).set(at - cut, mark);
    out.push({ c, tokens, str, penalty, as, words: meaningful(tokens), numbered: tokens.some((t) => NUMBER.test(t)), marks });
  };
  const whole = written(c.title);
  add(whole, 0, 'title');
  // An edition's game ("Lollipop Chainsaw: Premium Edition" is Lollipop Chainsaw), and a title without its possessive.
  const base = editionBase(c.title);
  const edition = base !== c.title;
  if (edition) add(written(base), 0.02, 'title');
  if (/['’]s(?=\s|$)/i.test(c.title)) add(written(c.title.replace(/['’]s(?=\s|$)/gi, '')), 0.02, 'title');
  for (const brand of BRANDS) {
    if (brand.every((b, k) => whole.tokens[k] === b) && meaningful(whole.tokens.slice(brand.length)) >= 2) {
      add(whole, 0.03, 'title', brand.length);
      break;
    }
  }
  // Its main title and its subtitle, each alone. A main title is often the series' name ("Tomb Raider" for Tomb
  // Raider: Legend): much less sure.
  const parts = c.title.split(/:\s+|\s[-–—]\s/);
  if (parts.length > 1 && !edition) {
    const main = written(parts[0]!);
    const sub = written(parts.slice(1).join(' '));
    // One word alone only when it's a long one ("Castlevania", not "Halo" or "Fear").
    if (meaningful(main.tokens) >= 2 || main.tokens.join('').length >= 8) add(main, 0.2, 'main');
    if (meaningful(sub.tokens) >= 2) add(sub, 0.15, 'subtitle');
  }
  for (const name of c.names ?? []) {
    if (!latinTitle(name)) continue;
    const w = written(name);
    // Another name counts when it's a name of two real words or more: IGDB's lists hold short ones that are words too.
    const real = w.tokens.filter((t) => t.length >= 3 && !STOP.has(t)).length;
    if (real >= 2 || (real === 1 && w.tokens.some((t) => NUMBER.test(t)))) add(w, 0.1, 'name');
  }
  return out;
}

/**
 * The candidates made ready for an issue's pages, once (not per page): each way a title may be written, kept once
 * (the surest candidate for it; between consoles with the same title, the nearest release), by the words it begins
 * with, and the titles that begin others' (series' names).
 */
export function spotIndex(candidates: readonly SpotCandidate[], coverDay: string): SpotIndex {
  const near = (c: SpotCandidate) => (c.day ? Math.abs(Date.parse(c.day) - Date.parse(coverDay)) : Number.MAX_SAFE_INTEGER);
  const byStr = new Map<string, Omit<Variant, 'stemOf' | 'shared' | 'on'> & { whole: string }>();
  const sharers = new Map<string, Set<string>>();
  const consoles = new Map<string, Set<string>>();
  const titles = new Set<string>();
  for (const c of candidates) {
    const all = variantsOf(c);
    if (all.length === 0) continue;
    // An edition is its game ("Lollipop Chainsaw: Premium Edition" doesn't make Lollipop Chainsaw a series).
    titles.add((all.find((v) => v.as === 'title' && v.penalty === 0.02 && v.str.length < all[0]!.str.length) ?? all[0]!).tokens.join(' '));
    const whole = all[0]!.str;
    const on = consoles.get(whole) ?? new Set<string>();
    on.add(c.platformKey);
    consoles.set(whole, on);
    for (const v of all) {
      if (v.as === 'main' || v.as === 'subtitle') {
        const set = sharers.get(v.str) ?? new Set<string>();
        set.add(all[0]!.str);
        sharers.set(v.str, set);
      }
      const had = byStr.get(v.str);
      if (!had || v.penalty < had.penalty || (v.penalty === had.penalty && near(v.c) < near(had.c))) byStr.set(v.str, { ...v, whole });
    }
  }
  // A title that begins other candidates' titles is a series' name as often as a game ("Final Fantasy"). Sorted, a
  // title's longer titles come right after it (no word has a character before the space), so a short look each.
  const sorted = [...titles].sort();
  const stemOf = (words: string) => {
    const prefix = `${words} `;
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! < prefix) lo = mid + 1;
      else hi = mid;
    }
    let n = 0;
    while (n < 3 && sorted[lo + n]?.startsWith(prefix)) n++;
    return n;
  };
  const first = new Map<string, Variant[]>();
  const startsOthers = new Set<string>();
  for (const { whole, ...v } of byStr.values()) {
    const words = v.tokens.join(' ');
    const made: Variant = { ...v, stemOf: stemOf(words), shared: sharers.get(v.str)?.size ?? 0, on: [...(consoles.get(whole) ?? [])] };
    if (made.stemOf > 0 && made.penalty === 0) startsOthers.add(words);
    // By its first word, and by its first words run together (a page may print "Megaman" for Mega Man).
    const keys = new Set([v.tokens[0]!, v.tokens.slice(0, 2).join(''), v.tokens.slice(0, 3).join('')]);
    for (const key of keys) {
      const list = first.get(key);
      if (list) list.push(made);
      else first.set(key, [made]);
    }
  }
  return { first, startsOthers };
}

/** What an issue's own text says of its words: how often each is written small, as ordinary words are. */
export interface SpotContext {
  /** A word's count with a small first letter ("rampage", not "Rampage"). */
  lower: ReadonlyMap<string, number>;
  /** The same for two words in a row ("game over"). */
  lowerPairs: ReadonlySet<string>;
}

/** The context of some pages: the words (and pairs of words) they write small. */
export function spotContext(pages: readonly (readonly PageWord[])[]): SpotContext {
  const lower = new Map<string, number>();
  const lowerPairs = new Set<string>();
  for (const words of pages) {
    let before = '';
    for (const w of words) {
      const small = /^[^A-Za-z0-9]*[a-z]/.test(w.text);
      const t = small ? spotWord(w.text) : '';
      if (t) {
        lower.set(t, (lower.get(t) ?? 0) + 1);
        if (before) lowerPairs.add(before + t);
      }
      before = t;
    }
  }
  return { lower, lowerPairs };
}

/** A console's name right after a title: "(PS3, 360)", "for the Genesis", "/ SNES". */
const CONSOLE_WORD =
  /^(?:ps[1-5px]?|psone|psp|psn|vita|playstation[1-5]?|xbox|xbox360|360|x360|xbla|xb1|wii|wiiu|wiiware|gamecube|gcn?|ngc|n64|nintendo64|nintendo|snes|supernes|nes|famicom|gameboy|gba?|gbc|ds|3ds|dsi|switch|genesis|megadrive|segacd|megacd|32x|saturn|dreamcast|dc|sms|mastersystem|gamegear|gg|turbografx|turbografx16|tg16|pcengine|neogeo|jaguar|lynx|3do|atari|2600|5200|7800|vcs|colecovision|coleco|intellivision|odyssey|odyssey2|vectrex|arcade|coinop|pc|mac|amiga|c64|commodore|spectrum|amstrad|ngage|sega|sony|microsoft)$/;

/** The companies whose names fill a magazine's pages: a game's publisher far more often than a game. */
const COMPANY_WORD =
  /^(?:square|squaresoft|enix|capcom|konami|namco|taito|midway|acclaim|activision|ubisoft|eidos|interplay|sierra|thq|infogrames|psygnosis|ocean|hudson|irem|jaleco|tecmo|koei|snk|nec|bandai|mattel|parker|imagic|bally|williams|dataeast|broderbund|accolade|epyx|sunsoft|natsume|atlus|rare|rockstar|bethesda|bioware|blizzard|valve|origin|microprose|lucasarts|virgin|titus|vivendi|majesco|tengen|kemco|vic|tokai|treasure|technos|bullfrog|maxis|electronic|arts)$/;

/** Words that are consoles' and companies' names: never a game by themselves. */
const NOT_A_TITLE = { test: (word: string) => CONSOLE_WORD.test(word) || COMPANY_WORD.test(word) };

/** Ordinary words that are always written with a capital: a capital says nothing of them ("American Football"). */
const ALWAYS_CAPITAL = new Set(
  'american british english european french german italian japanese spanish russian chinese canadian australian mexican african asian america britain england europe france germany italy japan spain russia china canada australia mexico africa asia london paris tokyo york california texas vegas hollywood olympic olympics christmas easter january february march april june july august september october november december monday tuesday wednesday thursday friday saturday sunday world international national'.split(
    ' ',
  ),
);

/**
 * The candidates' titles found on a page (D192, D242): each a run of the page's words, however they're spaced or
 * hyphenated, the longest at a place winning and, between two as long, the surest. How sure rests on the title (three
 * words that count are surer than two; one word counts only when it isn't an ordinary word of the issue's text, or in
 * big type) and on the page: capitals, a heading, a console named after it, the title named again.
 */
export function spotTitles(words: readonly PageWord[], candidates: readonly SpotCandidate[] | SpotIndex, coverDay: string, context?: SpotContext): Spotted[] {
  if (words.length === 0) return [];
  const { first } = Array.isArray(candidates) ? spotIndex(candidates, coverDay) : (candidates as SpotIndex);
  const { lower, lowerPairs } = context ?? spotContext([words]);
  // The page's words as compared, each knowing the printed word it's from.
  const tok: string[] = [];
  const from: number[] = [];
  const starts: boolean[] = [];
  const ends: boolean[] = [];
  const mark: number[] = [];
  const piece: string[] = [];
  for (let w = 0; w < words.length; w++) {
    // A slash sets two names side by side ("Doom/Quake"): each is a word of its own. A hyphen joins.
    for (const part of words[w]!.text.split('/')) {
      piece.length = 0;
      wordTokens(part, piece);
      for (let k = 0; k < piece.length; k++) {
        tok.push(piece[k]!);
        from.push(w);
        starts.push(k === 0);
        ends.push(k === piece.length - 1);
        // A colon on the page may come where the title has none ("Zelda: Ocarina of Time"): never a break.
        mark.push(k === piece.length - 1 && !/:["'”’)\]]*$/.test(part) ? markAfter(part) : 0);
      }
    }
  }
  const n = tok.length;
  if (n === 0) return [];
  const heights = words.map((w) => w.box[3] - w.box[1]).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;

  /** Where a variant's run ends when the page's words from i spell it, however spaced; -1 when they don't. */
  const runEnd = (v: Variant, i: number): number => {
    const s = v.str;
    let pos = 0;
    let j = i;
    while (pos < s.length) {
      if (j >= n) return -1;
      const t = tok[j]!;
      if (!s.startsWith(t, pos)) return -1;
      pos += t.length;
      // A sentence doesn't end inside a title: a full stop, comma or "!" on the page must be the title's own there
      // ("Super Mario Bros. 3"; a short word's full stop is an abbreviation's).
      const m = mark[j]!;
      if (m !== 0 && pos < s.length) {
        const own = v.marks?.get(pos) ?? 0;
        if (m === 3 && own !== 3) return -1;
        if (m === 1 && own !== 1 && t.length > 4) return -1;
        if (m === 2 && own !== 2) return -1;
      }
      j++;
    }
    return ends[j - 1] ? j : -1;
  };

  /** Each time the page names a candidate, in order. */
  const seen: { v: Variant; start: number; end: number; printed: string; box: [number, number, number, number]; big: boolean; caps: boolean; console: boolean; series: boolean; comesAfter: boolean; goesOn: boolean; confidence: number; inList: number | null }[] = [];
  let i = 0;
  while (i < n) {
    if (!starts[i]) {
      i++;
      continue;
    }
    let best: Variant | null = null;
    let end = -1;
    let key = tok[i]!;
    for (let join = 0; join < 3 && i + join < n; join++) {
      if (join > 0) key += tok[i + join]!;
      const list = first.get(key);
      if (!list) continue;
      for (const v of list) {
        if (best && (v.str.length < best.str.length || (v.str.length === best.str.length && v.penalty >= best.penalty))) continue;
        const e = runEnd(v, i);
        if (e > 0) {
          best = v;
          end = e;
        }
      }
    }
    if (!best) {
      i++;
      continue;
    }
    const w0 = from[i]!;
    const w1 = from[end - 1]!;
    const span = words.slice(w0, w1 + 1);
    const box: [number, number, number, number] = [Math.min(...span.map((w) => w.box[0])), Math.min(...span.map((w) => w.box[1])), Math.max(...span.map((w) => w.box[2])), Math.max(...span.map((w) => w.box[3]))];
    const big = span.some((w) => w.box[3] - w.box[1] >= 1.6 * median);
    // Titles are written with capitals; the little words between needn't be.
    const capital = (w: PageWord) => /^[^A-Za-z0-9]*[A-Z0-9]/.test(w.text);
    const caps = span.some(capital) && span.every((w) => capital(w) || STOP.has(spotWord(w.text)) || spotWord(w.text) === '');
    // What follows on the same line: a number or a capital (the start of a longer title), or a console's name.
    const lastWord = span[span.length - 1]!;
    const next = words[w1 + 1];
    const sameLine = next !== undefined && Math.abs(next.box[1] - lastWord.box[1]) < (lastWord.box[3] - lastWord.box[1]) / 2;
    const open = sameLine && !/[.,;:!?)"”]$/.test(lastWord.text);
    const after = next?.text.replace(/^[^A-Za-z0-9|]+|[^A-Za-z0-9|]+$/g, '') ?? '';
    const goesOn = !open ? 0 : /^(?:\d|[IVX]+\b)/.test(after) || /^[IVXivxl1|]{1,4}f?$/.test(after) ? 0.15 : /^[A-Z][a-z]/.test(next.text) ? 0.08 : 0;
    // What comes before it on the line: "Super" or "New" before a title is another game's title ("Super Mario Bros.").
    const firstWord = span[0]!;
    const prev = w0 > 0 ? words[w0 - 1]! : undefined;
    const before = prev !== undefined && Math.abs(prev.box[1] - firstWord.box[1]) < (firstWord.box[3] - firstWord.box[1]) / 2 ? prev.text : '';
    // ...and so is the second name of a pair ("Gold & Silver").
    const comesAfter = (/^(?:super|ultra|mega|new|ms|mr|jr|baby)$/.test(spotWord(before)) && /^[A-Z]/.test(before)) || (before === '&' && w0 > 1 && /^[A-Z]/.test(words[w0 - 2]!.text));
    let console = false;
    for (let k = 1; k <= 3 && !console; k++) {
      const after = words[w1 + k];
      if (!after) break;
      const t = spotWord(after.text);
      if (CONSOLE_WORD.test(t)) console = k === 1 || /^[([]/.test(words[w1 + 1]!.text) || /^(?:for|on|the)$/.test(spotWord(words[w1 + 1]!.text));
      else if (!(k === 1 && /^(?:for|on)$/.test(t)) && !(k === 2 && t === 'the')) break;
    }
    // A series' name, not a game: other titles begin with it, or several candidates share it as their main title.
    // (A main title with its number, "Rayman 2", is that game whatever follows the colon.)
    const sharedName = (best.as === 'main' || best.as === 'subtitle') && !best.numbered && (best.shared > 1 || best.stemOf > 0);
    const series = (best.stemOf > 0 && best.penalty === 0) || sharedName;
    let base: number;
    // Made of the issue's ordinary words only: it needs more than its capitals to be a game.
    let plain = false;
    if (best.words >= 3) base = 0.9;
    else if (best.words === 2) {
      // Two words that count: sure when written as a title and one of them isn't an ordinary word of the issue's
      // text ("Contra Force"; "Snail Mail" and "Dead Space" need more: a heading, a console, the title again).
      const own = best.tokens.filter((t) => !STOP.has(t) && !NUMBER.test(t));
      plain = own.every((t) => (lower.get(t) ?? 0) >= 2 || ALWAYS_CAPITAL.has(t));
      base = !caps ? (plain || lowerPairs.has(best.str) ? 0.5 : 0.7) : lowerPairs.has(best.str) ? 0.72 : plain ? 0.8 : 0.86;
    } else {
      // One word: a game when the issue's text never writes it small, as "Rampage" or "Heat" are words too.
      const word = best.tokens.length > 1 ? best.str : best.tokens[0]!;
      plain = (lower.get(word) ?? 0) >= 2 || word.replace(/\d/g, '').length < 4 || NOT_A_TITLE.test(word) || ALWAYS_CAPITAL.has(word);
      base = !caps ? 0.3 : plain ? 0.4 : 0.72;
    }
    const sure = (goes: number) => {
      let c = base - best.penalty + (big ? (best.words === 1 ? 0.12 : 0.1) : 0) + (best.numbered && best.words > 1 ? 0.05 : 0) + (console ? 0.1 : 0) - goes - (comesAfter ? 0.15 : 0) - (series ? 0.15 : 0);
      // A name several games share as their main title or subtitle ("Final Fantasy", "The Video Game") names none of them.
      if (sharedName && best.shared > 1) c = Math.min(c, 0.5);
      // Another name made of ordinary words ("Super League") is those words as often as the game: never sure by itself.
      if (best.as === 'name' && plain) c = Math.min(c, 0.8);
      // An ordinary word in a heading ("One", "Up", "Wanted") is a heading: a game only with its console named.
      if (best.words === 1 && plain && !console) c = Math.min(c, 0.5);
      return Math.min(1, c);
    };
    seen.push({ v: best, start: i, end, printed: span.map((w) => w.text).join(' '), box, big, caps, console, series, comesAfter, goesOn: goesOn > 0, confidence: sure(goesOn), inList: goesOn === 0.08 ? sure(0) : null });
    i = end;
  }
  const found = new Map<string, Spotted & { best: number }>();
  for (let k = 0; k < seen.length; k++) {
    const o = seen[k]!;
    // In a list of titles, the capital after a title begins the next one: it says nothing of this one.
    const listed = o.inList !== null && seen[k + 1]?.start === o.end;
    const confidence = listed ? o.inList! : o.confidence;
    const partial = o.comesAfter || (o.goesOn && !listed);
    const id = `${o.v.c.platformKey}|${o.v.c.title}`;
    const had = found.get(id);
    if (had) {
      had.evidence.times++;
      had.evidence.big ||= o.big;
      had.evidence.console ||= o.console;
      if (confidence > had.best) {
        had.best = confidence;
        had.printed = o.printed;
        had.box = o.box;
        had.evidence.as = o.v.as;
        had.evidence.caps = o.caps;
        had.evidence.series = o.series;
        had.evidence.partial = partial;
        had.evidence.words = o.v.words;
      }
    } else {
      found.set(id, { platformKey: o.v.c.platformKey, title: o.v.c.title, printed: o.printed, confidence, best: confidence, box: o.box, evidence: { as: o.v.as, words: o.v.words, times: 1, big: o.big, caps: o.caps, console: o.console, series: o.series, partial }, on: o.v.on });
    }
  }
  return [...found.values()].map(({ best, ...s }) => ({ ...s, confidence: Math.round(Math.min(1, best + (s.evidence.times > 1 ? 0.08 : 0)) * 100) / 100 }));
}

/**
 * A review's scores in a page's text, by the magazine's own layout (D192): EGM's Review Crew (four reviewers' scores
 * out of 10, "8.0 7.5 8.5 9.0"), Nintendo Power's ratings (graphics, play control, challenge, theme/fun out of 5). The
 * first set found, as printed; null when the page has none.
 */
export function scoresOn(text: string, magazine: string): string | null {
  const m = magazine.toLowerCase();
  if (/electronic gaming monthly|^egm/.test(m)) {
    const crew = /\b((?:10|[1-9])(?:\.\d)?)\s+((?:10|[1-9])(?:\.\d)?)\s+((?:10|[1-9])(?:\.\d)?)\s+((?:10|[1-9])(?:\.\d)?)\b/.exec(text);
    if (crew && crew.slice(1, 5).some((s) => s.includes('.'))) return crew.slice(1, 5).join(' / ');
  }
  if (/nintendo power/.test(m)) {
    const np = /\bG\s*([1-5](?:\.\d)?)\s+P\s*([1-5](?:\.\d)?)\s+C\s*([1-5](?:\.\d)?)\s+T\s*([1-5](?:\.\d)?)\b/.exec(text);
    if (np) return `G ${np[1]} · P ${np[2]} · C ${np[3]} · T ${np[4]}`;
  }
  return null;
}

/** A page of an issue, as the spotter reads it. */
export interface SpotPage {
  n: number;
  text: string;
  words: readonly PageWord[];
}

/** A game found on an issue's page, and what becomes of it: linked, or a maybe to answer. */
export interface SpotMention extends Spotted {
  page: number;
  state: 'linked' | 'suggested';
  /** review, with its scores, for the game a review page's scores go with. */
  kind: 'review' | null;
  score: string | null;
  /** The consoles the page names (for the chest on its games). */
  consoles: string[];
}

export interface SpotIssueOptions {
  magazine: string;
  coverDay: string;
  /** Link games found at this confidence; ask about them from askAt. */
  linkAt: number;
  askAt: number;
  /** The owner's answers: "<printed key>|<magazine or *>" to not, notgame:<console>|<title> or game:<console>|<title>. */
  rules: ReadonlyMap<string, string>;
  /** The games a review is cited for in this issue (their titles' keys): a maybe of one of them is that game. */
  cited?: ReadonlySet<string>;
  /** Whether the rest of the issue may settle a maybe (on unless false): see spotIssue. */
  evidence?: boolean;
}

/** The key the owner's answer about printed words is kept by: the words as compared, run together. */
export const printedKey = (printed: string) => spotWord(printed.replace(/\s+/g, ''));

/** A contents page: among an issue's first pages, one that says so. */
const isContents = (p: SpotPage) => p.n <= 15 && /\bcontents\b/i.test(p.text);

/**
 * The games of one issue (D192, D242): each page's words checked for the issue's candidates, the owner's rules
 * applied, a game linked at linkAt and asked about from askAt, a review's scores given to the game they go with.
 *
 * Then the issue itself settles what a page alone leaves unsure, so less is left to ask:
 * - a maybe is sure (SURE) when a review of the game is cited for the issue, when the game is on the contents page,
 *   or when another page of the issue names it surely;
 * - it is likely (LIKELY, just under the usual bar to link: an owner who lowers the bar takes these too) when two
 *   lesser things speak for it: another page names it, this page names one of its consoles, names it twice, or in a
 *   heading;
 * - a series' name is left out when the page names a game whose title begins with it ("Final Fantasy" beside "Final
 *   Fantasy VII"), and so is the magazine's own name;
 * - two words found once, with nothing else in the issue to go on, are likely, not sure.
 */
const SURE = 0.9;
const LIKELY = 0.82;
const BARE = 0.84;
/** How sure a page must be of a game by itself for that to settle the game's maybes on other pages. */
const SURE_ALONE = 0.85;

export function spotIssue(pages: readonly SpotPage[], index: SpotIndex, o: SpotIssueOptions): SpotMention[] {
  const steps = spotIssueSteps(pages, index, o);
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
}

/**
 * spotIssue a page at a time: it stops after each page (a few milliseconds of work), so a server can answer its
 * requests in between (It stays snappy), and returns the issue's games at the end.
 */
export function* spotIssueSteps(pages: readonly SpotPage[], index: SpotIndex, o: SpotIssueOptions): Generator<void, SpotMention[], void> {
  const context = spotContext(pages.map((p) => p.words));
  const idOf = (f: { platformKey: string; title: string }) => `${f.platformKey}|${f.title}`;
  const ownName = printedKey(o.magazine);
  type Found = SpotMention & { ruled: boolean };
  const byPage: { p: SpotPage; found: Found[]; named: string[] }[] = [];
  for (const p of pages) {
    const found: Found[] = [];
    for (const f of spotTitles(p.words, index, o.coverDay, context)) {
      const key = printedKey(f.printed);
      const rule = o.rules.get(`${key}|${o.magazine}`) ?? o.rules.get(`${key}|*`);
      if (rule === 'not' || rule === `notgame:${f.platformKey}|${f.title}`) continue;
      // The magazine's own name on its pages is the magazine ("Next Generation investigates...").
      if (!rule && key.length >= 6 && ownName.includes(key)) continue;
      if (rule?.startsWith('game:')) {
        const [pk, ...t] = rule.slice(5).split('|');
        found.push({ ...f, platformKey: pk!, title: t.join('|'), confidence: 1, page: p.n, state: 'linked', kind: null, score: null, consoles: [], ruled: true });
      } else if (f.confidence >= o.askAt) found.push({ ...f, page: p.n, state: f.confidence >= o.linkAt ? 'linked' : 'suggested', kind: null, score: null, consoles: [], ruled: false });
    }
    // The consoles the page names: for the chest on its games, and as a word for a game that is on one of them.
    if (found.length > 0) byPage.push({ p, found, named: platformsIn(p.text.replace(/\n+/g, ', ')) });
    yield;
  }
  if (o.evidence !== false) {
    // Where the issue names each game: on which pages, surely on which, and on its contents page.
    const pagesOf = new Map<string, Set<number>>();
    const sureOn = new Map<string, Set<number>>();
    const inContents = new Set<string>();
    const note = (map: Map<string, Set<number>>, id: string, n: number) => {
      const set = map.get(id);
      if (set) set.add(n);
      else map.set(id, new Set([n]));
    };
    for (const { p, found } of byPage) {
      const contents = isContents(p);
      for (const f of found) {
        const id = idOf(f);
        note(pagesOf, id, p.n);
        // Surely: by the owner's word, or sure on its own page (whatever bar the owner links at) for more than two
        // words found once, and not a piece of a longer title.
        const sure = f.confidence >= Math.max(o.linkAt, SURE_ALONE) && !f.evidence.partial && (f.evidence.words >= 3 || f.evidence.big || f.evidence.console || f.evidence.times > 1);
        if (f.ruled || sure) note(sureOn, id, p.n);
        // On the contents page by its whole name (one word there is a word of a longer line as often as a game).
        if (contents && f.evidence.words >= 2 && !f.evidence.partial && !f.evidence.series) inContents.add(id);
      }
    }
    const other = (map: Map<string, Set<number>>, id: string, n: number) => {
      const set = map.get(id);
      return set !== undefined && (set.size > 1 || !set.has(n));
    };
    for (const page of byPage) {
      const titles = page.found.map((f) => spotWords(f.title).join(''));
      page.found = page.found.filter((f, k) => {
        if (f.ruled) return true;
        const id = idOf(f);
        const elsewhere = other(pagesOf, id, page.p.n);
        const cited = o.cited?.has(matchKey(baseTitle(f.title))) ?? false;
        const console = f.on.some((key) => page.named.includes(key));
        if (f.state === 'suggested') {
          // A series' name beside a game of the series: the page is about that game.
          const printed = printedKey(f.printed);
          if (f.evidence.series && titles.some((t, j) => j !== k && t.length > printed.length && t.startsWith(printed))) return false;
          // Part of a longer title, perhaps: nothing else on the page or in the issue says otherwise.
          if (f.evidence.partial) return true;
          const lesser = [elsewhere, console, f.evidence.times > 1, f.evidence.big || f.evidence.console].filter(Boolean).length;
          // A series' name needs more than a game's does; a main title or subtitle that is one, the surest only.
          const enough = !f.evidence.series ? lesser >= 2 : f.evidence.as === 'title' && lesser >= 3;
          if (cited || inContents.has(id) || other(sureOn, id, page.p.n)) f.confidence = Math.max(f.confidence, SURE);
          else if (enough) f.confidence = Math.max(f.confidence, LIKELY);
        } else if (f.evidence.words <= 2 && !f.evidence.big && !f.evidence.console && f.evidence.times === 1 && !(cited || elsewhere || inContents.has(id))) {
          // Two words found once and nothing else to go on: likely, not sure.
          f.confidence = Math.min(f.confidence, BARE);
        }
        f.state = f.confidence >= o.linkAt ? 'linked' : 'suggested';
        return true;
      });
    }
  }
  const out: SpotMention[] = [];
  for (const { p, found, named } of byPage) {
    // A review's scores go to the game it's about: the one linked game, or the one in the biggest type.
    const score = scoresOn(p.text, o.magazine);
    const linkedHere = found.filter((x) => x.state === 'linked');
    const reviewed = score && linkedHere.length > 0 ? linkedHere.reduce((a, b) => (b.box[3] - b.box[1] > a.box[3] - a.box[1] ? b : a)) : null;
    for (const { ruled: _ruled, ...x } of found) {
      const itsReview = reviewed !== null && idOf(reviewed) === idOf(x);
      out.push({ ...x, consoles: named, kind: itsReview ? 'review' : null, score: itsReview ? score : null });
    }
  }
  return out;
}

/**
 * The games an issue could be about (D192): out from so many years before its cover date to so many after ("2, 1"),
 * on its magazine's maker's consoles when it has one ("Nintendo Power: nintendo"), else on every console. An older
 * issue looks further back (byYear, as "1989: 6, 1" for issues through 1989): games then took years to cross the
 * sea, and an early magazine wrote of the arcade games of the years before it.
 */
export function spotWindow(
  issue: { magazine: string; year: number; month: number | null },
  spotYears: string,
  makers: readonly string[],
  byYear: readonly string[] = [],
): { from: string; to: string; keep: (platformKey: string) => boolean } {
  let years = spotYears;
  let through = Number.MAX_SAFE_INTEGER;
  for (const line of byYear) {
    const m = /^\s*(\d{4})\s*[:=]\s*(.+)$/.exec(line);
    if (m && issue.year <= Number(m[1]) && Number(m[1]) < through) {
      through = Number(m[1]);
      years = m[2]!;
    }
  }
  const [before, after] = years
    .split(/[,\s]+/)
    .map(Number)
    .map((n) => (Number.isFinite(n) ? n : 1)) as [number, number];
  const maker = makers
    .map((l) => l.split(':'))
    .find(([name]) => name!.trim().toLowerCase() === issue.magazine.toLowerCase())?.[1]
    ?.trim()
    .toLowerCase();
  return {
    from: `${issue.year - (before ?? 2)}-${String(issue.month ?? 1).padStart(2, '0')}-01`,
    to: `${issue.year + (after ?? 1)}-${String(issue.month ?? 12).padStart(2, '0')}-28`,
    keep: (key: string) => !maker || (CONSOLE_MARKS[key] ?? CONSOLE_MARKS[regionalConsole(key)?.base ?? ''])?.company === maker,
  };
}
