import { CAUSE_LABELS, MISS_CAUSES, pct, type CitedGroup, type CitedScore, type LabelScore, type PageScore, type Tally } from './score.js';

/** The maybes waiting on Review > Magazines, and the links made. */
export interface PileStats {
  linked: number;
  suggested: number;
  /** Different printed words among the maybes: each answer is a rule for one of them. */
  printedWords: number;
  /** How many maybes the most frequent printed words cover. */
  coveredByTop: Record<number, number>;
  top: { printed: string; n: number; titles: string[] }[];
}

/** One run of the yardstick. */
export interface RunResult {
  label: string;
  /** stored: the mentions the copy holds, as its server found them; respot: looked through again with this code. */
  mode: 'stored' | 'respot';
  spotVersion: number;
  only: string;
  at: string;
  issues: number;
  pages: number;
  /** Processor seconds spent looking through the pages, and the run's wall time. */
  spotSeconds: number;
  wallSeconds: number;
  cited: CitedScore;
  pile: PileStats;
  labels: LabelScore | null;
}

const found = (t: Tally) => t.linked + t.maybe;
const empty: Tally = { n: 0, linked: 0, maybe: 0, missed: 0 };

const tallyRow = (name: string, t: Tally) => `| ${name} | ${t.n} | ${pct(t.linked, t.n)} | ${pct(t.maybe, t.n)} | ${pct(found(t), t.n)} | ${pct(t.missed, t.n)} |`;

/** A breakdown's rows: each key's found share among the reviews citing a page, and among all. */
function splitRows(page: Record<string, Tally>, all: Record<string, Tally>, byCount: boolean): string[] {
  const keys = Object.keys(all).sort((a, b) => (byCount ? all[b]!.n - all[a]!.n : a.localeCompare(b)));
  return keys.map((k) => {
    const p = page[k] ?? empty;
    const a = all[k]!;
    return `| ${k} | ${p.n} | ${pct(p.linked, p.n)} | ${pct(found(p), p.n)} | ${a.n} | ${pct(a.linked, a.n)} | ${pct(found(a), a.n)} |`;
  });
}

const SPLIT_HEAD = ['Page cited | Linked | Found | All cited | Linked | Found |', '---: | ---: | ---: | ---: | ---: | ---: |'];

function causeRows(g: CitedGroup): string[] {
  return MISS_CAUSES.map((cause) => {
    const x = g.causes[cause];
    return `| ${CAUSE_LABELS[cause]} | ${x.n} | ${pct(x.n, g.all.n)} | ${x.candidate} | ${x.oneWord} |`;
  });
}

function pageRows(name: string, s: PageScore): string {
  return `| ${name} | ${s.pages} | ${s.truth} | ${pct(s.linked.right, s.linked.found)} | ${pct(s.linked.truthFound, s.truth)} | ${pct(s.withMaybes.right, s.withMaybes.found)} | ${pct(s.withMaybes.truthFound, s.truth)} |`;
}

export function reportMarkdown(r: RunResult): string {
  const c = r.cited;
  const lines: string[] = [];
  lines.push(`# Leaves yardstick: ${r.label}`, '');
  lines.push(`${r.mode === 'stored' ? "The copy's own mentions, as its server found them" : `Looked through again with this code (spotter version ${r.spotVersion})`}; ${r.issues} issues, ${r.pages} pages${r.only === 'all' ? '' : ' (only issues with a cited review)'}; ${r.spotSeconds} s of looking, ${r.wallSeconds} s in all. ${r.at.slice(0, 16).replace('T', ' ')} UTC.`, '');
  lines.push('## Truth set A: the reviews Wikipedia cites', '');
  lines.push(
    `${c.all.all.n} reviews cited in issues whose text is read; ${c.withPage.all.n} of them cite a page (the surer half: a citation with a date only is often a website's review, set against that month's issue).` +
      (c.noText > 0 ? ` ${c.noText} more are in issues without text yet.` : '') +
      (c.wrongIssue > 0 ? ` ${c.wrongIssue} are left out: the game came out more than a year after the issue, so the citation met the wrong issue.` : ''),
    '',
  );
  lines.push('| | Reviews | Linked | A maybe | Found | Missed |', '| --- | ---: | ---: | ---: | ---: | ---: |', tallyRow('Page cited', c.withPage.all), tallyRow('All cited', c.all.all), '');
  lines.push('By era (found = linked or a maybe):', '', `| Era | ${SPLIT_HEAD[0]}`, `| --- | ${SPLIT_HEAD[1]}`, ...splitRows(c.withPage.byEra, c.all.byEra, false), '');
  lines.push('By magazine:', '', `| Magazine | ${SPLIT_HEAD[0]}`, `| --- | ${SPLIT_HEAD[1]}`, ...splitRows(c.withPage.byMagazine, c.all.byMagazine, true), '');
  for (const [name, g] of [
    ['the reviews citing a page', c.withPage],
    ['all the reviews cited', c.all],
  ] as const) {
    lines.push(`Why the misses were missed, of ${name}:`, '', '| Cause | Reviews | Share | Were candidates | One-word titles |', '| --- | ---: | ---: | ---: | ---: |', ...causeRows(g), '');
  }
  lines.push(`Of the ${c.withPage.nearPage.found} found that cite a page, ${c.withPage.nearPage.within2} (${pct(c.withPage.nearPage.within2, c.withPage.nearPage.found)}) are within two pages of it.`, '');
  lines.push('## The links and the maybes', '');
  lines.push(`${r.pile.linked} linked; ${r.pile.suggested} maybes on Review > Magazines, in ${r.pile.printedWords} different printed words.`);
  lines.push(`The 100 most frequent printed words cover ${pct(r.pile.coveredByTop[100] ?? 0, r.pile.suggested)} of the maybes, the top 500 ${pct(r.pile.coveredByTop[500] ?? 0, r.pile.suggested)}, the top 2,000 ${pct(r.pile.coveredByTop[2000] ?? 0, r.pile.suggested)}.`, '');
  lines.push('| Printed | Maybes | As |', '| --- | ---: | --- |');
  for (const t of r.pile.top) lines.push(`| ${t.printed.replace(/\|/g, '/')} | ${t.n} | ${t.titles.join('; ').replace(/\|/g, '/')} |`);
  lines.push('');
  if (r.labels) {
    lines.push('## Truth set B: the pages whose every game is listed', '');
    lines.push('| Pages | Pages | Games listed | Linked: right | Linked: of the games | With maybes: right | With maybes: of the games |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    lines.push(pageRows('All', r.labels.all));
    for (const k of Object.keys(r.labels.byKind).sort()) lines.push(pageRows(k, r.labels.byKind[k]!));
    for (const k of Object.keys(r.labels.byEra).sort()) lines.push(pageRows(k, r.labels.byEra[k]!));
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

const delta = (a: number, b: number) => `${b - a >= 0 ? '+' : ''}${b - a}`;

/** Two runs side by side: before and after a change to the spotter. */
export function compareMarkdown(a: RunResult, b: RunResult): string {
  const lines: string[] = [];
  lines.push(`# ${a.label} → ${b.label}`, '');
  lines.push(`| | ${a.label} | ${b.label} |`, '| --- | ---: | ---: |');
  for (const [name, pick] of [
    ['Reviews citing a page', (r: RunResult) => r.cited.withPage],
    ['All reviews cited', (r: RunResult) => r.cited.all],
  ] as const) {
    const ta = pick(a).all;
    const tb = pick(b).all;
    lines.push(`| **${name}** | ${ta.n} | ${tb.n} |`);
    lines.push(`| Linked | ${pct(ta.linked, ta.n)} | ${pct(tb.linked, tb.n)} |`);
    lines.push(`| A maybe | ${pct(ta.maybe, ta.n)} | ${pct(tb.maybe, tb.n)} |`);
    lines.push(`| Found (linked or a maybe) | ${pct(found(ta), ta.n)} | ${pct(found(tb), tb.n)} |`);
    lines.push(`| Missed | ${pct(ta.missed, ta.n)} | ${pct(tb.missed, tb.n)} |`);
  }
  lines.push(`| Found within two pages of the page cited | ${pct(a.cited.withPage.nearPage.within2, a.cited.withPage.nearPage.found)} | ${pct(b.cited.withPage.nearPage.within2, b.cited.withPage.nearPage.found)} |`);
  lines.push(`| **Games linked** | ${a.pile.linked} | ${b.pile.linked} (${delta(a.pile.linked, b.pile.linked)}) |`);
  lines.push(`| Maybes | ${a.pile.suggested} | ${b.pile.suggested} (${delta(a.pile.suggested, b.pile.suggested)}) |`);
  lines.push(`| Different printed words among the maybes | ${a.pile.printedWords} | ${b.pile.printedWords} (${delta(a.pile.printedWords, b.pile.printedWords)}) |`);
  if (a.labels && b.labels) {
    const right = (s: PageScore) => pct(s.linked.right, s.linked.found);
    const got = (s: PageScore) => pct(s.linked.truthFound, s.truth);
    lines.push(`| **Labelled pages**: linked games that are right | ${right(a.labels.all)} | ${right(b.labels.all)} |`);
    lines.push(`| Labelled pages: games on the page linked | ${got(a.labels.all)} | ${got(b.labels.all)} |`);
    lines.push(`| Labelled pages: games on the page linked or a maybe | ${pct(a.labels.all.withMaybes.truthFound, a.labels.all.truth)} | ${pct(b.labels.all.withMaybes.truthFound, b.labels.all.truth)} |`);
  }
  lines.push(`| Seconds of looking | ${a.spotSeconds} | ${b.spotSeconds} |`, '');
  for (const [name, pick] of [
    ['era', (r: RunResult) => r.cited.withPage.byEra],
    ['magazine', (r: RunResult) => r.cited.withPage.byMagazine],
  ] as const) {
    lines.push(`Found (linked or a maybe) by ${name}, of the reviews citing a page:`, '', `| | Reviews | ${a.label} | ${b.label} |`, '| --- | ---: | ---: | ---: |');
    const keys = Object.keys({ ...pick(a), ...pick(b) }).sort((x, y) => (name === 'era' ? x.localeCompare(y) : (pick(b)[y]?.n ?? 0) - (pick(b)[x]?.n ?? 0)));
    for (const k of keys) {
      const ta = pick(a)[k];
      const tb = pick(b)[k];
      lines.push(`| ${k} | ${tb?.n ?? ta?.n ?? 0} | ${ta ? pct(found(ta), ta.n) : '-'} | ${tb ? pct(found(tb), tb.n) : '-'} |`);
    }
    lines.push('');
  }
  lines.push('Misses by cause, of the reviews citing a page:', '', `| Cause | ${a.label} | ${b.label} |`, '| --- | ---: | ---: |');
  for (const cause of MISS_CAUSES) lines.push(`| ${CAUSE_LABELS[cause]} | ${a.cited.withPage.causes[cause].n} | ${b.cited.withPage.causes[cause].n} |`);
  return `${lines.join('\n')}\n`;
}
