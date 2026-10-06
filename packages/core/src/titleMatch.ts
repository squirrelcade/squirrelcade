import { baseTitle, editionBase, similarityReason, titleStems } from './catalog.js';
import { matchKey, matchTokens } from './text.js';

/**
 * Whether a title someone asks about is a game in the collection (0.55.0, D127): for Claude and other AI apps
 * (check_ownership, search_games), where titles come from a photo, a list or a conversation, not from PriceCharting.
 * Each match says how sure it is (confidence 0 to 1) and how the titles differ; near misses are listed, never
 * counted. A different number is always a different game (Halo 2 is never Halo 3).
 */

/** How two titles were found to be the same game, or close to it. */
export type TitleMatchKind = 'same' | 'reprint' | 'subtitle' | 'franchise' | 'edition' | 'stem' | 'remaster' | 'demo' | 'spelling' | 'similar';

export interface TitleMatch {
  /** 1 is the same title written differently; SAME_GAME_AT and above count as the same game. */
  confidence: number;
  kind: TitleMatchKind;
  /** Why, in a few words ("A different edition: yours isn't the Director's Cut"). */
  why: string;
}

/** At this confidence and above, a title counts as the same game. */
export const SAME_GAME_AT = 0.85;
/** From here up to SAME_GAME_AT, a title is a near miss: listed, never counted. */
export const NEAR_MISS_AT = 0.6;

/** Labels in brackets that are another printing of the same release, not another edition ("[Greatest Hits]"). */
const REPRINT =
  /^(?:greatest hits|platinum hits|players?['’]? ?choice|nintendo selects|essentials|platinum|classics|the best|best of|budget|hits|big hits|favorites|not for resale|nfr|reprint|variant cover|alt(?:ernate)? cover|black label|red label|green label|cardboard|disc only|game only|cartridge only)$/i;

/** Edition names written straight after a title, with nothing between ("Yakuza 0 Director's Cut"). */
const TRAILING_EDITION =
  /\s*[(:\-–—]?\s*((?:director['’]?s cut)|(?:game of the year|goty)(?: edition)?|(?:complete|definitive|special|limited|collector['’]?s|deluxe|digital deluxe|super deluxe|gold|ultimate|premium|legendary|enhanced|anniversary|royal|launch|day one|steelbook|signature) edition)\)?\s*$/i;

/** Words at the end of a name that every game of a film or show has ("Cars 2: The Video Game"). */
const GENERIC_SUBTITLES: string[][] = [
  ['the', 'official', 'video', 'game'],
  ['the', 'official', 'game'],
  ['official', 'video', 'game'],
  ['official', 'game'],
  ['the', 'video', 'game'],
  ['the', 'videogame'],
  ['video', 'game'],
  ['videogame'],
  ['the', 'game'],
];

/** Names in front of a title that aren't its own ("Sid Meier's Civilization"), as matchTokens writes them ("'s" dropped). */
const FRANCHISE_PREFIXES: string[][] = [
  ['sid', 'meier'],
  ['disney', 'pixar'],
  ['disney'],
  ['pixar'],
  ['marvel'],
  ['clive', 'barker'],
  ['american', 'mcgee'],
  ['bram', 'stoker'],
  ['peter', 'jackson'],
  ['james', 'cameron'],
  ['shaun', 'white'],
  ['dreamworks'],
  ['nickelodeon'],
  ['robert', 'ludlum'],
  ['ea', 'sports'],
];

/** Words that make a release a remaster or remake of the game, not the game itself. */
const REMASTER_WORDS = new Set(['remastered', 'remaster', 'hd', 'remake', 'redux', 'reforged', 'remade']);

/** Words too common to tell titles apart. */
const STOP_WORDS = new Set(['the', 'of', 'a', 'an', 'and', 'to', 'in', 'on', 'for']);

/** A title worked out once for comparing with many: its keys after each step that leaves the game the same. */
export interface TitleShape {
  title: string;
  /** As written (matchKey: case, punctuation, accents, ™ ®, "&", Roman numerals, "The", "Tom Clancy's"). */
  key: string;
  /** Without reprint labels ("[Greatest Hits]"). */
  reprintless: string;
  /** Without an edition ("[Limited Edition]", ": Gold Edition", " Director's Cut"). */
  base: string;
  /** Without a generic subtitle (": The Video Game"). */
  plain: string;
  /** Without a franchise name in front ("Sid Meier's"). */
  core: string;
  /** Without remaster words ("Remastered", "HD"). */
  unremastered: string;
  /** The keys of its main titles before each real subtitle ("Star Wars" of "Star Wars: Battlefront"). */
  stems: string[];
  /** Its words (without the edition), for near misses. */
  tokens: string[];
  /** Its numbers, sorted, which must agree. */
  numbers: string;
  /** The reprint label and the edition, as written, for saying how two titles differ. */
  reprint: string | null;
  edition: string | null;
  subtitle: string | null;
  franchise: string | null;
  /** A demo disc is never the game. */
  demo: boolean;
}

const tokensKey = (tokens: readonly string[]) => tokens.join('');

/** Drops a word sequence from the end of tokens (at least one word staying), or returns null. */
function dropEnd(tokens: string[], tail: string[]): string[] | null {
  if (tokens.length <= tail.length) return null;
  for (let i = 0; i < tail.length; i++) if (tokens[tokens.length - tail.length + i] !== tail[i]) return null;
  return tokens.slice(0, tokens.length - tail.length);
}

/** Drops a word sequence from the start of tokens (at least one word staying), or returns null. */
function dropStart(tokens: string[], head: string[]): string[] | null {
  if (tokens.length <= head.length) return null;
  for (let i = 0; i < head.length; i++) if (tokens[i] !== head[i]) return null;
  return tokens.slice(head.length);
}

const words = (tokens: readonly string[]) => tokens.join(' ');

/** Words at a title's end (or start) as the title writes them ("The Video Game", "Sid Meier's"), or null. */
function asWritten(title: string, tokens: string[], where: 'start' | 'end'): string | null {
  // Tokens are lowercase letters and digits only, so they go into the pattern as they are.
  const body = tokens.join('[^a-z0-9]*');
  const m = where === 'end' ? new RegExp(String.raw`[\s:\-–—]*(${body})\s*$`, 'i').exec(title) : new RegExp(String.raw`^\s*(${body}(?:['’]s)?)`, 'i').exec(title);
  return m ? m[1]!.trim() : null;
}

/** Works out a title's shape (see TitleShape). */
export function titleShape(title: string): TitleShape {
  // Unicode spells ™ out as "TM" when it takes accents off; marks never belong to the name.
  const trimmed = title.replace(/[™®©℠]/g, '').trim();
  // Brackets: reprint labels go first; any other bracket is an edition (PriceCharting writes "[Limited Edition]").
  let reprint: string | null = null;
  let edition: string | null = null;
  let rest = trimmed;
  for (;;) {
    const m = /\s*\[([^\]]*)\]\s*$/.exec(rest);
    if (!m) break;
    const label = m[1]!.trim();
    if (REPRINT.test(label)) reprint ??= label;
    else edition ??= label;
    rest = rest.slice(0, m.index).trim();
  }
  const demo = /\bdemo\b/i.test(trimmed);
  const reprintless = matchKey(edition ? `${rest} [${edition}]` : rest);
  // Editions named after the title: Squirrelcade's own rule (editionBase), then the ones written without a colon.
  let base = editionBase(rest);
  if (base !== rest) edition ??= rest.slice(base.length).replace(/^[\s:\-–—(]+|[\s)]+$/g, '') || null;
  else {
    const m = TRAILING_EDITION.exec(rest);
    if (m && m.index > 1) {
      base = rest.slice(0, m.index).trim();
      edition ??= m[1]!;
    }
  }
  // A demo is compared without the word, so it's found as the game's demo (and never counted as the game).
  const baseTokens = matchTokens(base).filter((t, i, all) => !(demo && all.length > 1 && (t === 'demo' || (t === 'disc' && all[i - 1] === 'demo'))));
  let plainTokens = baseTokens;
  let subtitle: string | null = null;
  for (const tail of GENERIC_SUBTITLES) {
    const dropped = dropEnd(baseTokens, tail);
    if (dropped) {
      plainTokens = dropped;
      subtitle = asWritten(base, tail, 'end') ?? words(tail);
      break;
    }
  }
  let coreTokens = plainTokens;
  let franchise: string | null = null;
  for (const head of FRANCHISE_PREFIXES) {
    const dropped = dropStart(plainTokens, head);
    if (dropped && tokensKey(dropped).length >= 3) {
      coreTokens = dropped;
      franchise = asWritten(base, head, 'start') ?? words(head);
      break;
    }
  }
  const unremasteredTokens = coreTokens.filter((t, i) => !(REMASTER_WORDS.has(t) && i > 0));
  const stems = titleStems(base)
    .map((s) => matchKey(s))
    .filter((k) => k.length >= 3 && k !== tokensKey(baseTokens));
  return {
    title: trimmed,
    key: matchKey(trimmed),
    reprintless,
    base: tokensKey(baseTokens),
    plain: tokensKey(plainTokens),
    core: tokensKey(coreTokens),
    unremastered: tokensKey(unremasteredTokens),
    stems,
    tokens: coreTokens,
    numbers: baseTokens
      .filter((t) => /^\d+$/.test(t))
      .sort()
      .join(','),
    reprint,
    edition,
    subtitle,
    franchise,
    demo,
  };
}

/** Levenshtein distance, giving up (Infinity) past max. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(v);
      if (v < best) best = v;
    }
    if (best > max) return Infinity;
    prev = cur;
  }
  return prev[b.length]!;
}

/** "Director's Cut" against nothing: how the editions differ, from the collection's side. */
function editionWhy(asked: TitleShape, owned: TitleShape): string {
  if (owned.edition && asked.edition) return `a different edition: ${owned.edition}, not ${asked.edition}`;
  if (owned.edition) return `a different edition: ${owned.edition}`;
  return `a different edition: not the ${asked.edition}`;
}

const sentence = (parts: string[]) => {
  const text = parts.join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

/**
 * Whether `owned` (a title in the collection) is the game `asked` names, and how sure that is; null when they're
 * not the same game or close to it. The steps that keep the game the same: another printing (0.95), a generic
 * subtitle (0.95), a franchise name in front (0.9) and another edition (0.9, said as such); a little less when
 * several are needed. Near misses: a real subtitle (0.75), a remaster (0.7), a spelling (0.8) or words in common.
 */
export function compareTitles(asked: TitleShape, owned: TitleShape): TitleMatch | null {
  if (asked.key === owned.key) return { confidence: 1, kind: 'same', why: 'The same title' };
  if (asked.numbers !== owned.numbers) return null;
  if (asked.demo !== owned.demo) {
    return asked.base === owned.base || asked.core === owned.core ? { confidence: 0.65, kind: 'demo', why: asked.demo ? 'The game, not its demo' : 'A demo of it, not the game' } : null;
  }
  const levels: ['reprintless' | 'base' | 'plain' | 'core', number][] = [
    ['reprintless', 0.95],
    ['base', 0.9],
    ['plain', 0.95],
    ['core', 0.9],
  ];
  for (let level = 0; level < levels.length; level++) {
    const field = levels[level]![0];
    if (asked[field] !== owned[field]) continue;
    const parts: string[] = [];
    let confidence = 1;
    let steps = 0;
    let kind: TitleMatchKind = 'reprint';
    const reprinted = asked.key !== asked.reprintless || owned.key !== owned.reprintless;
    const editioned = level >= 1 && (asked.reprintless !== asked.base || owned.reprintless !== owned.base);
    const subtitled = level >= 2 && (asked.base !== asked.plain || owned.base !== owned.plain);
    const franchised = level >= 3 && (asked.plain !== asked.core || owned.plain !== owned.core);
    if (reprinted && (owned.reprint || asked.reprint) && owned.reprint !== asked.reprint) {
      parts.push(owned.reprint ? `another printing: ${owned.reprint}` : `another printing than ${asked.reprint}`);
      confidence = Math.min(confidence, 0.95);
      steps++;
    }
    if (subtitled) {
      parts.push(`"${owned.subtitle ?? asked.subtitle}" is part of its name`);
      confidence = Math.min(confidence, 0.95);
      kind = 'subtitle';
      steps++;
    }
    if (franchised) {
      parts.push(`"${owned.franchise ?? asked.franchise}" in front of its name`);
      confidence = Math.min(confidence, 0.9);
      kind = 'franchise';
      steps++;
    }
    if (editioned && (owned.edition || asked.edition) && owned.edition !== asked.edition) {
      parts.push(editionWhy(asked, owned));
      confidence = Math.min(confidence, 0.9);
      kind = 'edition';
      steps++;
    }
    if (steps === 0) return { confidence: 1, kind: 'same', why: 'The same title' };
    return { confidence: Math.round((confidence - 0.02 * (steps - 1)) * 100) / 100, kind, why: sentence(parts) };
  }
  // Near misses: never counted as the same game.
  let best: TitleMatch | null = null;
  const consider = (m: TitleMatch) => {
    if (!best || m.confidence > best.confidence) best = m;
  };
  if (asked.unremastered === owned.unremastered) consider({ confidence: 0.7, kind: 'remaster', why: 'A remaster or remake of it, not the same release' });
  const ownedSubtitle = owned.stems.includes(asked.core) || owned.stems.includes(asked.base);
  const askedSubtitle = asked.stems.includes(owned.core) || asked.stems.includes(owned.base);
  if (ownedSubtitle) consider({ confidence: 0.75, kind: 'stem', why: `Its full name goes on: ${owned.title}` });
  else if (askedSubtitle) consider({ confidence: 0.7, kind: 'stem', why: `Yours is ${owned.title}, without the rest of the name` });
  if (asked.core.length >= 6 && owned.core.length >= 6) {
    const d = distance(asked.core, owned.core, 2);
    if (d <= 2 && d <= Math.floor(Math.min(asked.core.length, owned.core.length) / 5)) consider({ confidence: 0.8, kind: 'spelling', why: 'Spelled a little differently' });
  }
  // Numbers already agree; words in common are the rest.
  const a = new Set(asked.tokens.filter((t) => !STOP_WORDS.has(t) && !/^\d+$/.test(t)));
  const b = new Set(owned.tokens.filter((t) => !STOP_WORDS.has(t) && !/^\d+$/.test(t)));
  if (a.size > 0 && b.size > 0) {
    let common = 0;
    for (const t of a) if (b.has(t)) common++;
    const jaccard = common / (a.size + b.size - common);
    if (jaccard >= 0.5) consider({ confidence: Math.round((0.5 + 0.3 * jaccard) * 100) / 100, kind: 'similar', why: 'Most of the same words' });
  }
  if (!best) {
    const reason = similarityReason(asked.title, owned.title);
    if (reason) consider({ confidence: 0.65, kind: 'similar', why: reason });
  }
  return best;
}

/** Compares two titles as written (see compareTitles). */
export function matchTitles(asked: string, owned: string): TitleMatch | null {
  return compareTitles(titleShape(asked), titleShape(owned));
}

/** A title found for a question: the item it belongs to, which of its titles matched, and how. */
export interface TitleFound<T> {
  item: T;
  title: string;
  match: TitleMatch;
}

/**
 * Many items' titles, ready to be asked about one title at a time (an item can have several titles). Only
 * titles sharing a key or a word with the question are compared, so a collection of thousands answers in
 * milliseconds.
 */
export class TitleMatcher<T> {
  private readonly entries: { item: T; shape: TitleShape }[] = [];
  private readonly byKey = new Map<string, number[]>();
  private readonly byWord = new Map<string, number[]>();
  /** Words in more titles than this say little (worked out from the size). */
  private readonly common: number;

  constructor(items: readonly T[], titlesOf: (item: T) => readonly string[]) {
    for (const item of items) {
      for (const title of new Set(titlesOf(item))) {
        if (!title.trim()) continue;
        const shape = titleShape(title);
        const i = this.entries.push({ item, shape }) - 1;
        for (const k of new Set([shape.key, shape.reprintless, shape.base, shape.plain, shape.core, shape.unremastered, ...shape.stems])) {
          if (k) push(this.byKey, k, i);
        }
        for (const w of new Set(shape.tokens)) if (!STOP_WORDS.has(w)) push(this.byWord, w, i);
      }
    }
    this.common = Math.max(60, Math.ceil(this.entries.length * 0.03));
  }

  get size(): number {
    return this.entries.length;
  }

  /** The items whose titles match `title`, the surest first (one per item: its best title); at least `min` confident. */
  find(title: string, options: { min?: number; limit?: number; filter?: (item: T) => boolean } = {}): TitleFound<T>[] {
    const asked = titleShape(title);
    if (!asked.key) return [];
    const min = options.min ?? NEAR_MISS_AT;
    const candidates = new Set<number>();
    for (const k of new Set([asked.key, asked.reprintless, asked.base, asked.plain, asked.core, asked.unremastered, ...asked.stems])) {
      for (const i of this.byKey.get(k) ?? []) candidates.add(i);
    }
    for (const w of new Set(asked.tokens)) {
      if (STOP_WORDS.has(w)) continue;
      const hits = this.byWord.get(w);
      if (hits && hits.length <= this.common) for (const i of hits) candidates.add(i);
    }
    const best = new Map<T, TitleFound<T>>();
    for (const i of candidates) {
      const { item, shape } = this.entries[i]!;
      if (options.filter && !options.filter(item)) continue;
      const match = compareTitles(asked, shape);
      if (!match || match.confidence < min) continue;
      const before = best.get(item);
      if (!before || match.confidence > before.match.confidence) best.set(item, { item, title: shape.title, match });
    }
    const found = [...best.values()].sort((x, y) => y.match.confidence - x.match.confidence || x.title.localeCompare(y.title));
    return options.limit === undefined ? found : found.slice(0, options.limit);
  }
}

function push(map: Map<string, number[]>, key: string, value: number) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** For search: whether every word asked starts a word of the title ("yak" finds "Yakuza 0"), as a score (0 when not). */
export function wordsScore(asked: string, title: string): number {
  const askedWords = matchTokens(asked).filter((w) => !STOP_WORDS.has(w));
  if (askedWords.length === 0) return 0;
  const titleWords = matchTokens(baseTitle(title));
  if (!askedWords.every((w) => titleWords.some((t) => t.startsWith(w)))) {
    // "spiderman" for "Spider-Man": the joined words.
    const key = matchKey(asked);
    if (key.length < 3 || !matchKey(title).includes(key)) return 0;
  }
  return Math.round((0.5 + 0.3 * Math.min(1, matchKey(asked).length / Math.max(1, matchKey(baseTitle(title)).length))) * 100) / 100;
}
