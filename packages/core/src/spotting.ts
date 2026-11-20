import type { PageWord } from './magazines.js';
import { CONSOLE_MARKS } from './marks.js';
import { regionalConsole } from './platforms.js';
import { platformsIn } from './sets.js';

/**
 * The games on a magazine's page (D192, magazines.md "Matching"): the titles it could be about (the magazine's
 * consoles, games out around its cover date) found in the page's text as runs of its words, with the words' boxes, and
 * how sure each is. Squirrelcade's own rules; the owner's answers on Review > Magazines become rules over them.
 */

/** A game the page could name. */
export interface SpotCandidate {
  platformKey: string;
  title: string;
  /** Its release day, to choose between consoles that have the same title. */
  day: string | null;
}

/** A game found on the page. */
export interface Spotted {
  platformKey: string;
  title: string;
  /** The words on the page that named it. */
  printed: string;
  confidence: number;
  /** Its box in the scan's pixels: the named words joined (the first time it's named). */
  box: [number, number, number, number];
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'to', 'in', 'on', 'for', 'vs']);

/** The spotter's rules' version: an issue is looked through again when they change (D192). */
export const SPOT_VERSION = 3;

/** A sequel's number or a year in a title makes it surer ("Suikoden IV", "NCAA Football 2005"). */
const NUMBERED = /^(?:\d+|[ivx]+)$/;

/** A word as compared: lower case, accents and punctuation gone. */
export const spotWord = (w: string) =>
  w
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

/** A title's words as compared (its colon, dashes and slashes are breaks between words). */
export const spotWords = (s: string) => s.split(/[\s:\-–—/]+/).map(spotWord).filter(Boolean);

/** The ways a title may be written on a page: whole, its main title, or its subtitle (each a little less sure). */
function variants(title: string): { words: string[]; penalty: number }[] {
  const out = [{ words: spotWords(title), penalty: 0 }];
  const colon = title.split(/:\s+| - /);
  if (colon.length > 1) {
    const main = spotWords(colon[0]!);
    const sub = spotWords(colon.slice(1).join(' '));
    // A main title alone is often the series' name ("Tomb Raider" for Tomb Raider: Legend): much less sure.
    if (main.filter((w) => !STOP.has(w)).length >= 2) out.push({ words: main, penalty: 0.2 });
    if (sub.filter((w) => !STOP.has(w)).length >= 2) out.push({ words: sub, penalty: 0.15 });
  }
  return out.filter((v) => v.words.length > 0);
}

/**
 * The candidates' titles found on a page: each a run of the page's words, the longest at a place winning. A title of
 * one word counts only in big type (a heading), as "Rampage" or "Heat" are words too; a heading and a title named more
 * than once count more; the same title on several consoles is the console whose release is nearest the cover's day.
 */
export interface SpotIndex {
  first: Map<string, { c: SpotCandidate; words: string[]; penalty: number }[]>;
  startsOthers: Set<string>;
}

/**
 * The candidates made ready for an issue's pages, once (not per page): by their first word, each title once (its
 * console chosen by the nearest release), and the titles that begin others' (series' names).
 */
export function spotIndex(candidates: readonly SpotCandidate[], coverDay: string): SpotIndex {
  const near = (c: SpotCandidate) => (c.day ? Math.abs(Date.parse(c.day) - Date.parse(coverDay)) : Number.MAX_SAFE_INTEGER);
  const byTitle = new Map<string, SpotCandidate>();
  for (const c of candidates) {
    const k = spotWords(c.title).join(' ');
    const had = byTitle.get(k);
    if (!had || near(c) < near(had)) byTitle.set(k, c);
  }
  const first = new Map<string, { c: SpotCandidate; words: string[]; penalty: number }[]>();
  for (const c of byTitle.values()) {
    for (const v of variants(c.title)) {
      if (v.words.every((w) => STOP.has(w))) continue;
      const list = first.get(v.words[0]!) ?? [];
      list.push({ c, ...v });
      first.set(v.words[0]!, list);
    }
  }
  // A title that begins other candidates' titles is a series' name as often as a game ("Final Fantasy"). Sorted, a
  // title's longer titles come right after it (no word has a character before the space), so one look each.
  const titleWords = [...byTitle.keys()].sort();
  const startsOthers = new Set(titleWords.filter((t, i) => titleWords[i + 1]?.startsWith(`${t} `)));
  return { first, startsOthers };
}

export function spotTitles(words: readonly PageWord[], candidates: readonly SpotCandidate[] | SpotIndex, coverDay: string): Spotted[] {
  const page = words.map((w) => spotWord(w.text));
  if (page.length === 0) return [];
  const heights = words.map((w) => w.box[3] - w.box[1]).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;
  const { first, startsOthers } = Array.isArray(candidates) ? spotIndex(candidates, coverDay) : (candidates as SpotIndex);
  const found = new Map<string, Spotted & { times: number }>();
  let i = 0;
  while (i < page.length) {
    let best: { c: SpotCandidate; words: string[]; penalty: number } | null = null;
    for (const v of first.get(page[i]!) ?? []) {
      if (v.words.length > page.length - i) continue;
      if (!v.words.every((w, k) => page[i + k] === w)) continue;
      if (!best || v.words.length > best.words.length) best = v;
    }
    if (!best) {
      i++;
      continue;
    }
    const span = words.slice(i, i + best.words.length);
    const box: [number, number, number, number] = [Math.min(...span.map((w) => w.box[0])), Math.min(...span.map((w) => w.box[1])), Math.max(...span.map((w) => w.box[2])), Math.max(...span.map((w) => w.box[3]))];
    const big = span.some((w) => w.box[3] - w.box[1] >= 1.6 * median);
    const meaningful = best.words.filter((w) => !STOP.has(w)).length;
    const base = meaningful >= 3 ? 0.9 : meaningful === 2 ? 0.78 : big ? 0.62 : 0.4;
    // Words going straight on after it (a capital, a number, no stop between) make it the start of a longer title.
    const lastWord = span[span.length - 1]!;
    const nextWord = words[i + best.words.length];
    const sameLine = nextWord !== undefined && Math.abs(nextWord.box[1] - lastWord.box[1]) < (lastWord.box[3] - lastWord.box[1]) / 2;
    const goesOn = sameLine && !/[.,;:!?)"”]$/.test(lastWord.text) && /^(?:[A-Z][a-z]|\d|[IVX]+\b)/.test(nextWord.text);
    const series = startsOthers.has(best.words.join(' ')) && best.penalty === 0;
    const confidence = Math.min(1, base - best.penalty + (big ? 0.1 : 0) + (best.words.some((w) => NUMBERED.test(w)) ? 0.05 : 0) - (goesOn ? 0.15 : 0) - (series ? 0.15 : 0));
    const key = `${best.c.platformKey}|${best.c.title}`;
    const had = found.get(key);
    if (had) {
      had.times++;
      had.confidence = Math.max(had.confidence, confidence);
    } else found.set(key, { platformKey: best.c.platformKey, title: best.c.title, printed: span.map((w) => w.text).join(' '), confidence, box, times: 1 });
    i += best.words.length;
  }
  return [...found.values()].map(({ times, ...s }) => ({ ...s, confidence: Math.round(Math.min(1, s.confidence + (times > 1 ? 0.08 : 0)) * 100) / 100 }));
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
}

/** The key the owner's answer about printed words is kept by: the words as compared, run together. */
export const printedKey = (printed: string) => spotWord(printed.replace(/\s+/g, ''));

/**
 * The games of one issue (D192): each page's words checked for the issue's candidates, the owner's rules applied, a
 * game linked at linkAt and asked about from askAt, a review's scores given to the game they go with.
 */
export function spotIssue(pages: readonly SpotPage[], index: SpotIndex, o: SpotIssueOptions): SpotMention[] {
  const out: SpotMention[] = [];
  for (const p of pages) {
    const kept: SpotMention[] = [];
    for (const f of spotTitles(p.words, index, o.coverDay)) {
      const key = printedKey(f.printed);
      const rule = o.rules.get(`${key}|${o.magazine}`) ?? o.rules.get(`${key}|*`);
      if (rule === 'not' || rule === `notgame:${f.platformKey}|${f.title}`) continue;
      if (rule?.startsWith('game:')) {
        const [pk, ...t] = rule.slice(5).split('|');
        kept.push({ ...f, platformKey: pk!, title: t.join('|'), confidence: 1, page: p.n, state: 'linked', kind: null, score: null, consoles: [] });
        continue;
      }
      if (f.confidence >= o.linkAt) kept.push({ ...f, page: p.n, state: 'linked', kind: null, score: null, consoles: [] });
      else if (f.confidence >= o.askAt) kept.push({ ...f, page: p.n, state: 'suggested', kind: null, score: null, consoles: [] });
    }
    if (kept.length === 0) continue;
    // The consoles the page names, for the chest on its games: once a page.
    const named = platformsIn(p.text.replace(/\n+/g, ', '));
    // A review's scores go to the game it's about: the one linked game, or the one in the biggest type.
    const score = scoresOn(p.text, o.magazine);
    const linkedHere = kept.filter((x) => x.state === 'linked');
    const reviewed = score && linkedHere.length > 0 ? linkedHere.reduce((a, b) => (b.box[3] - b.box[1] > a.box[3] - a.box[1] ? b : a)) : null;
    for (const x of kept) {
      x.consoles = named;
      if (x === reviewed) {
        x.kind = 'review';
        x.score = score;
      }
      out.push(x);
    }
  }
  return out;
}

/**
 * The games an issue could be about (D192): out from so many years before its cover date to so many after ("2, 1"),
 * on its magazine's maker's consoles when it has one ("Nintendo Power: nintendo"), else on every console.
 */
export function spotWindow(issue: { magazine: string; year: number; month: number | null }, spotYears: string, makers: readonly string[]): { from: string; to: string; keep: (platformKey: string) => boolean } {
  const [before, after] = spotYears
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
