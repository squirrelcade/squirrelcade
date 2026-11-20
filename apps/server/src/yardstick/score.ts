import { baseTitle, matchKey, spotWord, spotWords } from '@squirrelcade/core';

/**
 * The Leaves yardstick's sums (docs/leaves-yardstick.md): how the games found on the magazines' pages are measured
 * against what is known to be there. Nothing here reads a file; yardstick/cli.ts does the reading.
 */

/** A five-year era, as "1990-94". */
export function eraOf(year: number): string {
  const from = Math.floor(year / 5) * 5;
  return `${from}-${String((from + 4) % 100).padStart(2, '0')}`;
}

/**
 * Why a game known to be in an issue wasn't found, from the issue's own text, the first that fits:
 * - exact: its title is on a page, word for word, as the spotter compares words;
 * - variant: it is there written another way ("&" for "and", "2" for "II", "Hawk" for "Hawk's", a mark between words);
 * - main-title: only what comes before its subtitle is there;
 * - run-together: its letters are there, but the words are joined or split differently ("Mega Man" as "Megaman");
 * - one-off: its letters are there but for one character (a misread letter);
 * - scattered: all of its words are on one page, not in a row;
 * - absent: the text read doesn't have it.
 */
export type MissCause = 'exact' | 'variant' | 'main-title' | 'run-together' | 'one-off' | 'scattered' | 'absent';

export const MISS_CAUSES: readonly MissCause[] = ['exact', 'variant', 'main-title', 'run-together', 'one-off', 'scattered', 'absent'];

export const CAUSE_LABELS: Record<MissCause, string> = {
  exact: 'Exact title in the text, not matched',
  variant: 'There in another spelling (&/and, II/2, possessive, a mark between words)',
  'main-title': 'Only the main title, without its subtitle',
  'run-together': 'Words run together or split',
  'one-off': 'One character misread',
  scattered: 'All its words on one page, out of order',
  absent: 'Not in the text read at all',
};

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12', xiii: '13' };
const LOOSE_DROP = new Set(['the', 'and', 'a']);

/** Words compared loosely: possessives, "the", "and" and marks aside, roman numbers as digits. */
export function looseWords(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of raw) {
    const w = spotWord(r.replace(/['’`]s\b/gi, ''));
    if (!w || LOOSE_DROP.has(w)) continue;
    out.push(ROMAN[w] ?? w);
  }
  return out;
}

function hasRun(page: readonly string[], run: readonly string[]): boolean {
  if (run.length === 0 || run.length > page.length) return false;
  const first = run[0]!;
  for (let i = page.indexOf(first); i !== -1 && i <= page.length - run.length; i = page.indexOf(first, i + 1)) {
    let k = 1;
    while (k < run.length && page[i + k] === run[k]) k++;
    if (k === run.length) return true;
  }
  return false;
}

/** Whether b is a with at most one character changed, added or left out. */
function withinOne(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/** Whether a text has the pattern but for one character: one of the pattern's halves must be there whole. */
function nearlyIn(text: string, pattern: string): boolean {
  const m = pattern.length;
  const half = Math.floor(m / 2);
  const parts: [string, number][] = [
    [pattern.slice(0, half), 0],
    [pattern.slice(half), half],
  ];
  for (const [part, at] of parts) {
    for (let i = text.indexOf(part); i !== -1; i = text.indexOf(part, i + 1)) {
      for (const shift of [-1, 0, 1]) {
        const start = i - at + (at === 0 ? 0 : shift);
        if (start < 0) continue;
        for (const len of [m - 1, m, m + 1]) if (start + len <= text.length && withinOne(pattern, text.slice(start, start + len))) return true;
      }
    }
  }
  return false;
}

/** An issue's pages made ready for missCause, once: each page's words as printed. */
export interface CausePages {
  strict: string[][];
  loose: string[][];
  joined: string[];
}

export function causePages(pages: readonly (readonly string[])[]): CausePages {
  const strict = pages.map((p) => p.map(spotWord));
  return { strict, loose: pages.map((p) => looseWords(p)), joined: strict.map((p) => p.join('')) };
}

export function missCause(title: string, pages: CausePages): MissCause {
  const words = spotWords(baseTitle(title));
  if (words.length === 0) return 'absent';
  if (pages.strict.some((p) => hasRun(p, words))) return 'exact';
  const loose = looseWords(baseTitle(title).split(/[\s:\-–—/]+/));
  if (loose.length > 0 && pages.loose.some((p) => hasRun(p, loose))) return 'variant';
  const parts = baseTitle(title).split(/:\s+| - /);
  if (parts.length > 1) {
    const main = looseWords(parts[0]!.split(/[\s\-–—/]+/));
    if (main.length > 0 && pages.loose.some((p) => hasRun(p, main))) return 'main-title';
  }
  const joined = words.join('');
  if (joined.length >= 5 && pages.joined.some((p) => p.includes(joined))) return 'run-together';
  if (joined.length >= 8 && pages.joined.some((p) => nearlyIn(p, joined))) return 'one-off';
  const need = [...new Set(loose)];
  if (need.length > 1 && pages.loose.some((p) => need.every((w) => p.includes(w)))) return 'scattered';
  return 'absent';
}

/** One review Wikipedia cites in an issue the owner has (truth set A), and what the spotter made of it. */
export interface CitedRow {
  magazine: string;
  year: number;
  title: string;
  /**
   * linked, maybe (found, left to answer), missed, no-text (the issue's text isn't read yet), or wrong-issue (the
   * game came out more than a year after the issue: the citation was matched to the wrong issue).
   */
  outcome: 'linked' | 'maybe' | 'missed' | 'no-text' | 'wrong-issue';
  /** Whether the citation names a page. One with a date only is often a website's review, set against that month's issue. */
  pageCited: boolean;
  /** For a miss: why. */
  cause: MissCause | null;
  /** Whether the game was among the titles the issue was checked for. */
  inCandidates: boolean;
  /** Pages between the page cited and the nearest page it was found on (null when not found). */
  pagesOff: number | null;
}

export interface Tally {
  n: number;
  linked: number;
  maybe: number;
  missed: number;
}

/** The reviews of one kind (all, or those citing a page), counted. */
export interface CitedGroup {
  all: Tally;
  byMagazine: Record<string, Tally>;
  byEra: Record<string, Tally>;
  /** The misses by cause, each split by whether the game was a candidate and whether its title is one word. */
  causes: Record<MissCause, { n: number; candidate: number; oneWord: number }>;
  /** Of those found, how many within two pages of the page cited. */
  nearPage: { found: number; within2: number };
}

export interface CitedScore {
  /** Every review cited in an issue whose text is read. */
  all: CitedGroup;
  /** Those whose citation names a page: the surer half (the review is in that issue). */
  withPage: CitedGroup;
  /** Reviews cited in issues without text yet, and ones set against the wrong issue (both left out of the shares). */
  noText: number;
  wrongIssue: number;
}

const tally = (): Tally => ({ n: 0, linked: 0, maybe: 0, missed: 0 });

const group = (): CitedGroup => ({
  all: tally(),
  byMagazine: {},
  byEra: {},
  causes: Object.fromEntries(MISS_CAUSES.map((c) => [c, { n: 0, candidate: 0, oneWord: 0 }])) as CitedGroup['causes'],
  nearPage: { found: 0, within2: 0 },
});

export function scoreCited(rows: readonly CitedRow[]): CitedScore {
  const score: CitedScore = { all: group(), withPage: group(), noText: 0, wrongIssue: 0 };
  for (const r of rows) {
    if (r.outcome === 'no-text') {
      score.noText++;
      continue;
    }
    if (r.outcome === 'wrong-issue') {
      score.wrongIssue++;
      continue;
    }
    for (const g of r.pageCited ? [score.all, score.withPage] : [score.all]) {
      for (const t of [g.all, (g.byMagazine[r.magazine] ??= tally()), (g.byEra[eraOf(r.year)] ??= tally())]) {
        t.n++;
        t[r.outcome]++;
      }
      if (r.outcome === 'missed' && r.cause) {
        const c = g.causes[r.cause];
        c.n++;
        if (r.inCandidates) c.candidate++;
        if (spotWords(baseTitle(r.title)).length === 1) c.oneWord++;
      } else if (r.pagesOff !== null) {
        g.nearPage.found++;
        if (r.pagesOff <= 2) g.nearPage.within2++;
      }
    }
  }
  return score;
}

/** A page whose every game is listed by hand or by a reader checked by hand (truth set B). */
export interface LabelledPage {
  issueId: number;
  page: number;
  magazine: string;
  year: number;
  /** contents, review, preview, ad, news, feature, other. */
  kind: string;
  /** The games named on the page, each with the other names it goes by (a catalog's, IGDB's). */
  games: { title: string; aka?: string[] }[];
}

/** A game the spotter put on a page. */
export interface FoundOnPage {
  issueId: number;
  page: number;
  title: string;
  state: 'linked' | 'suggested';
}

export interface PageScore {
  pages: number;
  /** Games the labels list. */
  truth: number;
  /** Of the linked: how many are on the labels (precision), and of the labels how many were linked (recall). */
  linked: { found: number; right: number; truthFound: number };
  /** The same counting the maybes as found. */
  withMaybes: { found: number; right: number; truthFound: number };
}

export interface LabelScore {
  all: PageScore;
  byKind: Record<string, PageScore>;
  byEra: Record<string, PageScore>;
}

const pageScore = (): PageScore => ({ pages: 0, truth: 0, linked: { found: 0, right: 0, truthFound: 0 }, withMaybes: { found: 0, right: 0, truthFound: 0 } });

const keyOf = (title: string) => matchKey(baseTitle(title));

/** Precision and recall on the labelled pages: a game found is right when the page's labels name it (by any of its names). */
export function scoreLabels(labels: readonly LabelledPage[], found: readonly FoundOnPage[]): LabelScore {
  const byPage = new Map<string, FoundOnPage[]>();
  for (const f of found) {
    const k = `${f.issueId}|${f.page}`;
    const list = byPage.get(k) ?? [];
    list.push(f);
    byPage.set(k, list);
  }
  const score: LabelScore = { all: pageScore(), byKind: {}, byEra: {} };
  for (const l of labels) {
    const here = byPage.get(`${l.issueId}|${l.page}`) ?? [];
    const truth = l.games.map((g) => new Set([g.title, ...(g.aka ?? [])].map(keyOf)));
    for (const s of [score.all, (score.byKind[l.kind] ??= pageScore()), (score.byEra[eraOf(l.year)] ??= pageScore())]) {
      s.pages++;
      s.truth += truth.length;
      for (const [part, states] of [
        [s.linked, ['linked']],
        [s.withMaybes, ['linked', 'suggested']],
      ] as const) {
        const keys = new Set(here.filter((f) => (states as readonly string[]).includes(f.state)).map((f) => keyOf(f.title)));
        part.found += keys.size;
        for (const k of keys) if (truth.some((t) => t.has(k))) part.right++;
        for (const t of truth) if ([...t].some((k) => keys.has(k))) part.truthFound++;
      }
    }
  }
  return score;
}

export const pct = (part: number, whole: number) => (whole === 0 ? '-' : `${Math.round((1000 * part) / whole) / 10}%`);
