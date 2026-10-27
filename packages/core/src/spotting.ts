import type { PageWord } from './magazines.js';

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

/** A word as compared: lower case, accents and punctuation gone. */
export const spotWord = (w: string) =>
  w
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const wordsOf = (s: string) => s.split(/[\s:\-–—/]+/).map(spotWord).filter(Boolean);

/** The ways a title may be written on a page: whole, its main title, or its subtitle (each a little less sure). */
function variants(title: string): { words: string[]; penalty: number }[] {
  const out = [{ words: wordsOf(title), penalty: 0 }];
  const colon = title.split(/:\s+| - /);
  if (colon.length > 1) {
    const main = wordsOf(colon[0]!);
    const sub = wordsOf(colon.slice(1).join(' '));
    if (main.filter((w) => !STOP.has(w)).length >= 2) out.push({ words: main, penalty: 0.1 });
    if (sub.filter((w) => !STOP.has(w)).length >= 2) out.push({ words: sub, penalty: 0.1 });
  }
  return out.filter((v) => v.words.length > 0);
}

/**
 * The candidates' titles found on a page: each a run of the page's words, the longest at a place winning. A title of
 * one word counts only in big type (a heading), as "Rampage" or "Heat" are words too; a heading and a title named more
 * than once count more; the same title on several consoles is the console whose release is nearest the cover's day.
 */
export function spotTitles(words: readonly PageWord[], candidates: readonly SpotCandidate[], coverDay: string): Spotted[] {
  const page = words.map((w) => spotWord(w.text));
  if (page.length === 0) return [];
  const heights = words.map((w) => w.box[3] - w.box[1]).sort((a, b) => a - b);
  const median = heights[Math.floor(heights.length / 2)] || 1;
  // The candidates by their first word, each title once (its console chosen by the nearest release).
  const near = (c: SpotCandidate) => (c.day ? Math.abs(Date.parse(c.day) - Date.parse(coverDay)) : Number.MAX_SAFE_INTEGER);
  const byTitle = new Map<string, SpotCandidate>();
  for (const c of candidates) {
    const k = wordsOf(c.title).join(' ');
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
    const base = meaningful >= 3 ? 0.8 : meaningful === 2 ? 0.72 : big ? 0.62 : 0.4;
    const confidence = Math.min(1, base - best.penalty + (big ? 0.12 : 0));
    const key = `${best.c.platformKey}|${best.c.title}`;
    const had = found.get(key);
    if (had) {
      had.times++;
      had.confidence = Math.max(had.confidence, confidence);
    } else found.set(key, { platformKey: best.c.platformKey, title: best.c.title, printed: span.map((w) => w.text).join(' '), confidence, box, times: 1 });
    i += best.words.length;
  }
  return [...found.values()].map(({ times, ...s }) => ({ ...s, confidence: Math.round(Math.min(1, s.confidence + (times > 1 ? 0.1 : 0)) * 100) / 100 }));
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
