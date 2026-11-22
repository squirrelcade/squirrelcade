import { eraOf } from './score.js';

/**
 * The Leaves yardstick's sample of pages to label (docs/leaves-yardstick.md, truth set B): spread over magazines,
 * five-year eras and kinds of page, the same pages every time for the same library.
 */

export type PageKind = 'contents' | 'review' | 'preview' | 'news' | 'ad' | 'other';

export const PAGE_KINDS: readonly PageKind[] = ['contents', 'review', 'preview', 'news', 'ad', 'other'];

const count = (text: string, words: RegExp) => text.match(words)?.length ?? 0;

/**
 * A guess at a page's kind from its text, only to spread the sample over kinds (whoever labels the page says what it
 * is): little text is an ad or a picture; an early page that says "contents"; words of reviews, previews or news.
 */
export function guessKind(n: number, text: string): PageKind {
  const words = text.split(/\s+/).length;
  if (words < 120) return 'ad';
  if (n <= 15 && /\bcontents\b/i.test(text)) return 'contents';
  if (count(text, /\b(?:reviews?|review crew|proreview|verdict|ratings?|overall|graphics|playability|gameplay)\b/gi) >= 3) return 'review';
  if (count(text, /\b(?:previews?|coming soon|sneak peek|first look|hands[- ]on|work in progress|release date)\b/gi) >= 2) return 'preview';
  if (count(text, /\b(?:news|rumou?rs?|announced|announcement|press release)\b/gi) >= 2) return 'news';
  return 'other';
}

/** A page that could be picked. */
export interface SamplePage {
  issueId: number;
  page: number;
  magazine: string;
  year: number;
  kind: PageKind;
}

/** A number from a string, the same every time: what orders the pages within a group. */
function hash(s: string): number {
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
  return h >>> 0;
}

/**
 * About `target` pages: each magazine and era gets a share that grows with the square root of its pages (so a small
 * magazine is there and a big one doesn't take everything), at least one, and within it the kinds take turns.
 */
export function samplePages(pages: readonly SamplePage[], target: number, seed = 'leaves'): SamplePage[] {
  const groups = new Map<string, SamplePage[]>();
  for (const p of pages) {
    const key = `${p.magazine}|${eraOf(p.year)}`;
    const list = groups.get(key);
    if (list) list.push(p);
    else groups.set(key, [p]);
  }
  const weight = [...groups.values()].reduce((sum, g) => sum + Math.sqrt(g.length), 0);
  const out: SamplePage[] = [];
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const share = Math.max(1, Math.round((target * Math.sqrt(group.length)) / weight));
    const byKind = new Map<PageKind, SamplePage[]>();
    for (const p of group) {
      const list = byKind.get(p.kind);
      if (list) list.push(p);
      else byKind.set(p.kind, [p]);
    }
    for (const list of byKind.values()) list.sort((a, b) => hash(`${seed}|${a.issueId}|${a.page}`) - hash(`${seed}|${b.issueId}|${b.page}`));
    // The kinds take turns, starting each group at a kind of its own so the rarer kinds are met.
    const kinds = PAGE_KINDS.filter((k) => byKind.has(k));
    let turn = hash(`${seed}|${group[0]!.magazine}|${eraOf(group[0]!.year)}`) % kinds.length;
    for (let taken = 0, empty = 0; taken < share && empty < kinds.length; turn = (turn + 1) % kinds.length) {
      const next = byKind.get(kinds[turn]!)!.shift();
      if (!next) {
        empty++;
        continue;
      }
      empty = 0;
      out.push(next);
      taken++;
    }
  }
  return out;
}
