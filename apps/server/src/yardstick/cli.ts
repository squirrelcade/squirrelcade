import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { articleGameTitle, baseTitle, matchKey, printedKey, settingDefinitions, SPOT_VERSION, spotIndex, spotIssue, spotTitles, spotWindow, spotWord, spotWords, type PageWord, type SettingKey, type SpotIndex } from '@squirrelcade/core';
import { guessKind, samplePages, type SamplePage } from './pages.js';
import { readReleases, type Releases } from './releases.js';
import { compareMarkdown, reportMarkdown, type PileStats, type RunResult } from './report.js';
import { causePages, eraOf, missCause, scoreCited, scoreLabels, type CitedRow, type FoundOnPage, type LabelledPage, type MissCause } from './score.js';

/**
 * The Leaves yardstick (docs/leaves-yardstick.md): measures how well the games on the magazines' pages are found,
 * against a read-only copy of an install's magazines.db. It never writes to the copy: what it finds goes to a run
 * file of its own.
 *
 *   npm run leaves:yardstick -- run --data <folder> --label before [--stored] [--only cited] [--labels pages.json]
 *   npm run leaves:yardstick -- compare <before.json> <after.json>
 */

type Args = Record<string, string | true>;

function parseArgs(argv: readonly string[]): { rest: string[]; args: Args } {
  const rest: string[] = [];
  const args: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) rest.push(a);
    else if (argv[i + 1] === undefined || argv[i + 1]!.startsWith('--')) args[a.slice(2)] = true;
    else args[a.slice(2)] = argv[++i]!;
  }
  return { rest, args };
}

const str = (args: Args, key: string, fallback?: string): string => {
  const v = args[key];
  if (typeof v === 'string') return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`--${key} is needed`);
};

/** The install's settings the spotter reads: its own values from settings.json (as its database keeps them), else the defaults. */
function settingsOf(dataDir: string): <K extends SettingKey>(key: K) => (typeof settingDefinitions)[K]['default'] {
  const path = join(dataDir, 'settings.json');
  const own = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>) : {};
  return (key) => (key in own ? JSON.parse(own[key]!) : settingDefinitions[key].default);
}

interface IssueRow {
  id: number;
  magazine: string;
  year: number | null;
  month: number | null;
  owner_year: number | null;
  owner_month: number | null;
  text_state: string;
  page_offset?: number | null;
}

const RUN_SCHEMA = `
CREATE TABLE IF NOT EXISTS mentions (issue_id INTEGER NOT NULL, page INTEGER NOT NULL, platform_key TEXT, title TEXT NOT NULL, title_key TEXT NOT NULL, printed TEXT, kind TEXT, score TEXT, confidence REAL, state TEXT NOT NULL, box TEXT, consoles TEXT);
CREATE TABLE IF NOT EXISTS cited (citation_id INTEGER NOT NULL, issue_id INTEGER NOT NULL, magazine TEXT NOT NULL, year INTEGER, title TEXT NOT NULL, platform_key TEXT, page INTEGER, page_cited INTEGER NOT NULL, outcome TEXT NOT NULL, cause TEXT, in_candidates INTEGER NOT NULL, pages_off INTEGER);
CREATE TABLE IF NOT EXISTS meta (key TEXT NOT NULL, value TEXT NOT NULL);
`;

/** One shard of a run: its share of the issues looked through (or their stored mentions read), and their cited reviews scored. */
function shard(args: Args): void {
  const dataDir = resolve(str(args, 'data'));
  const [part, parts] = str(args, 'shard').split('/').map(Number) as [number, number];
  const stored = args['stored'] === true;
  const onlyCited = args['only'] === 'cited';
  // A game found by its article goes by the article's name in older copies ("Deadpool (video game)"): read as the game's.
  const titleOf = args['raw-titles'] === true ? (t: string) => t : articleGameTitle;
  const setting = settingsOf(dataDir);
  // The bars to link and to ask at: the install's own, or others to try (--link-at 0.8).
  const withoutSecond = args['without-second'] === true;
  const linkAt = typeof args['link-at'] === 'string' ? Number(args['link-at']) : setting('magazines.linkAt');
  const askAt = typeof args['ask-at'] === 'string' ? Number(args['ask-at']) : setting('magazines.askAt');
  const db = new Database(join(dataDir, 'magazines-audit.db'), { readonly: true, fileMustExist: true });
  const out = new Database(str(args, 'out'));
  out.pragma('journal_mode = OFF');
  out.pragma('synchronous = OFF');
  out.exec(RUN_SCHEMA);
  const releases: Releases = readReleases(join(dataDir, 'releases.jsonl'));
  const rules = new Map((db.prepare('SELECT printed_key, magazine, answer FROM mention_rules').all() as { printed_key: string; magazine: string; answer: string }[]).map((r) => [`${r.printed_key}|${r.magazine}`, r.answer]));
  const citations = new Map<number, { id: number; page: number; platform_key: string | null; title: string; title_key: string }[]>();
  for (const c of db.prepare("SELECT id, issue_id, page, platform_key, title, title_key FROM mentions WHERE source = 'citation'").all() as { id: number; issue_id: number; page: number; platform_key: string | null; title: string; title_key: string }[]) {
    const list = citations.get(c.issue_id) ?? [];
    list.push(c);
    citations.set(c.issue_id, list);
  }
  const looked = new Set((db.prepare("SELECT key FROM state WHERE key LIKE 'spotted:%'").all() as { key: string }[]).map((r) => Number(r.key.slice(8))));
  const issues = (db.prepare('SELECT i.id, m.name AS magazine, i.year, i.month, i.owner_year, i.owner_month, i.text_state, i.page_offset FROM issues i JOIN magazines m ON m.id = i.magazine_id ORDER BY i.id').all() as IssueRow[]).filter(
    (i, k) => k % parts === part && (!onlyCited || citations.has(i.id)),
  );
  const addMention = out.prepare('INSERT INTO mentions (issue_id, page, platform_key, title, title_key, printed, kind, score, confidence, state, box, consoles) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const addCited = out.prepare('INSERT INTO cited (citation_id, issue_id, magazine, year, title, platform_key, page, page_cited, outcome, cause, in_candidates, pages_off) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const pagesOf = db.prepare('SELECT n, text, words FROM pages WHERE issue_id = ? ORDER BY n');
  const storedOf = db.prepare("SELECT page, platform_key, title, title_key, printed, kind, score, confidence, state, box, consoles FROM mentions WHERE issue_id = ? AND source = 'ocr'");
  let spotMs = 0;
  let pagesRead = 0;
  for (const i of issues) {
    const cited = citations.get(i.id) ?? [];
    const year = i.owner_year ?? i.year;
    const hasText = (i.text_state === 'hocr' || i.text_state === 'ocr') && year !== null && (!stored || looked.has(i.id));
    if (!hasText) {
      out.transaction(() => {
        for (const c of cited) addCited.run(c.id, i.id, i.magazine, year, titleOf(c.title), c.platform_key, c.page, c.page - (i.page_offset ?? 0) > 1 ? 1 : 0, 'no-text', null, 0, null);
      })();
      continue;
    }
    const month = (i.owner_year !== null ? i.owner_month : i.month) ?? 6;
    const coverDay = `${year}-${String(month).padStart(2, '0')}-01`;
    // --without-second leaves out what the second read added (D244: its words, and its other readings), to measure what that read brought.
    const pages = (pagesOf.all(i.id) as { n: number; text: string; words: string }[]).map((p) => ({ n: p.n, text: p.text, words: withoutSecond ? (JSON.parse(p.words) as PageWord[]).filter((w) => !w.second).map((w) => ({ text: w.text, box: w.box })) : (JSON.parse(p.words) as PageWord[]) }));
    pagesRead += pages.length;
    // The games the issue is checked for, as the server's task makes them (app.ts, magazines-games).
    let index: SpotIndex | null = null;
    let candidateKeys: Set<string> | null = null;
    const candidates = () => {
      const w = spotWindow({ magazine: i.magazine, year: year!, month }, setting('magazines.spotYears'), setting('magazines.makers'), setting('magazines.spotYearsOlder'));
      return releases.between(w.from, w.to, w.keep).map((r) => ({ platformKey: r.platformKey, title: r.title, day: r.day, names: r.alt }));
    };
    let found: { page: number; platform_key: string | null; title: string; title_key: string; printed: string | null; kind: string | null; score: string | null; confidence: number | null; state: string; box: string | null; consoles: string | null }[];
    if (stored) found = storedOf.all(i.id) as typeof found;
    else {
      const t0 = performance.now();
      const list = candidates();
      index = spotIndex(list, coverDay);
      if (cited.length > 0) candidateKeys = new Set(list.map((c) => matchKey(baseTitle(c.title))));
      // A cited review is itself a reason to link a maybe: left out unless asked for, as the citations are what the
      // spotter is measured against.
      const options = { magazine: i.magazine, coverDay, linkAt, askAt, rules, evidence: args['no-evidence'] !== true, ...(args['cited'] === true ? { cited: new Set(cited.map((c) => matchKey(baseTitle(titleOf(c.title))))) } : {}) };
      found = spotIssue(pages, index, options).map((x) => ({
        page: x.page,
        platform_key: x.platformKey,
        title: x.title,
        title_key: matchKey(baseTitle(x.title)),
        printed: x.printed,
        kind: x.kind,
        score: x.score,
        confidence: x.confidence,
        state: x.state,
        box: JSON.stringify(x.box),
        consoles: JSON.stringify(x.consoles),
      }));
      spotMs += performance.now() - t0;
    }
    let ready: ReturnType<typeof causePages> | null = null;
    out.transaction(() => {
      for (const f of found) addMention.run(i.id, f.page, f.platform_key, f.title, f.title_key, f.printed, f.kind, f.score, f.confidence, f.state, f.box, f.consoles);
      for (const c of cited) {
        const title = titleOf(c.title);
        const key = matchKey(baseTitle(title));
        const pageCited = c.page - (i.page_offset ?? 0) > 1 ? 1 : 0;
        // A review can't be of a game that came out more than a year after the issue: the citation met the wrong issue.
        const first = releases.firstDay(key);
        if (first !== null && first > `${year! + 1}-${String(month).padStart(2, '0')}-31`) {
          addCited.run(c.id, i.id, i.magazine, year, title, c.platform_key, c.page, pageCited, 'wrong-issue', null, 0, null);
          continue;
        }
        const hits = found.filter((f) => f.title_key === key);
        const outcome = hits.some((f) => f.state === 'linked') ? 'linked' : hits.length > 0 ? 'maybe' : 'missed';
        candidateKeys ??= new Set(candidates().map((r) => matchKey(baseTitle(r.title))));
        let cause: MissCause | null = null;
        if (outcome === 'missed') {
          ready ??= causePages(pages.map((p) => p.words.map((w) => w.text)));
          cause = missCause(title, ready);
        }
        const off = hits.length > 0 ? Math.min(...hits.map((f) => Math.abs(f.page - c.page))) : null;
        addCited.run(c.id, i.id, i.magazine, year, title, c.platform_key, c.page, pageCited, outcome, cause, candidateKeys.has(key) ? 1 : 0, off);
      }
    })();
  }
  out.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('shard', JSON.stringify({ part, issues: issues.length, pages: pagesRead, spotMs: Math.round(spotMs) }));
  out.close();
  db.close();
}

function runShards(args: Args, outDir: string, label: string, parts: number): Promise<string[]> {
  const self = fileURLToPath(import.meta.url);
  const files = Array.from({ length: parts }, (_, k) => join(outDir, `${label}.part${k}.db`));
  return Promise.all(
    files.map(
      (file, k) =>
        new Promise<string>((done, fail) => {
          rmSync(file, { force: true });
          const pass = ['shard', '--data', str(args, 'data'), '--shard', `${k}/${parts}`, '--out', file, ...(args['stored'] === true ? ['--stored'] : []), ...['raw-titles', 'no-evidence', 'cited', 'without-second'].filter((flag) => args[flag] === true).map((flag) => `--${flag}`), ...['only', 'link-at', 'ask-at'].flatMap((name) => (typeof args[name] === 'string' ? [`--${name}`, args[name] as string] : []))];
          const child = spawn(process.execPath, [...process.execArgv, self, ...pass], { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true });
          child.on('error', fail);
          child.on('exit', (code) => (code === 0 ? done(file) : fail(new Error(`shard ${k} ended with ${code}`))));
        }),
    ),
  );
}

function pileStats(run: Database.Database): PileStats {
  const count = (state: string) => (run.prepare('SELECT COUNT(*) AS n FROM mentions WHERE state = ?').get(state) as { n: number }).n;
  const printed = new Map<string, { n: number; printed: string; titles: Set<string> }>();
  for (const r of run.prepare("SELECT printed, title FROM mentions WHERE state = 'suggested'").iterate() as IterableIterator<{ printed: string | null; title: string }>) {
    const key = printedKey(r.printed ?? r.title);
    const had = printed.get(key);
    if (had) {
      had.n++;
      if (had.titles.size < 4) had.titles.add(r.title);
    } else printed.set(key, { n: 1, printed: r.printed ?? r.title, titles: new Set([r.title]) });
  }
  const sorted = [...printed.values()].sort((a, b) => b.n - a.n);
  const coveredBy = (n: number) => sorted.slice(0, n).reduce((sum, p) => sum + p.n, 0);
  return {
    linked: count('linked'),
    suggested: count('suggested'),
    printedWords: printed.size,
    coveredByTop: { 100: coveredBy(100), 500: coveredBy(500), 2000: coveredBy(2000) },
    top: sorted.slice(0, 30).map((p) => ({ printed: p.printed, n: p.n, titles: [...p.titles] })),
  };
}

async function run(args: Args): Promise<void> {
  const dataDir = resolve(str(args, 'data'));
  const label = str(args, 'label', args['stored'] === true ? 'stored' : `v${SPOT_VERSION}`);
  const outDir = resolve(str(args, 'out', join(dataDir, 'runs')));
  mkdirSync(outDir, { recursive: true });
  // Four processes at a time unless asked for more: a run on every core holds a computer at full load and heat for
  // minutes, which is rarely what its owner wants beside their other work.
  const parts = Math.max(1, Number(str(args, 'shards', String(Math.max(1, Math.min(4, cpus().length - 2))))));
  const started = Date.now();
  const files = await runShards(args, outDir, label, parts);
  const runFile = join(outDir, `${label}.db`);
  rmSync(runFile, { force: true });
  const runDb = new Database(runFile);
  runDb.pragma('journal_mode = OFF');
  runDb.exec(RUN_SCHEMA);
  for (const f of files) {
    runDb.prepare('ATTACH ? AS part').run(f);
    runDb.exec('INSERT INTO mentions SELECT * FROM part.mentions; INSERT INTO cited SELECT * FROM part.cited; INSERT INTO meta SELECT * FROM part.meta; DETACH part');
    rmSync(f, { force: true });
  }
  runDb.exec('CREATE INDEX mentions_page ON mentions(issue_id, page); CREATE INDEX mentions_state ON mentions(state)');
  const shards = (runDb.prepare("SELECT value FROM meta WHERE key = 'shard'").all() as { value: string }[]).map((r) => JSON.parse(r.value) as { issues: number; pages: number; spotMs: number });
  const citedRows = (runDb.prepare('SELECT magazine, year, title, page_cited, outcome, cause, in_candidates, pages_off FROM cited').all() as { magazine: string; year: number | null; title: string; page_cited: number; outcome: CitedRow['outcome']; cause: MissCause | null; in_candidates: number; pages_off: number | null }[]).map(
    (r): CitedRow => ({ magazine: r.magazine, year: r.year ?? 0, title: r.title, outcome: r.outcome, pageCited: r.page_cited === 1, cause: r.cause, inCandidates: r.in_candidates === 1, pagesOff: r.pages_off }),
  );
  const result: RunResult = {
    label,
    mode: args['stored'] === true ? 'stored' : 'respot',
    spotVersion: SPOT_VERSION,
    only: typeof args['only'] === 'string' ? args['only'] : 'all',
    at: new Date().toISOString(),
    issues: shards.reduce((n, s) => n + s.issues, 0),
    pages: shards.reduce((n, s) => n + s.pages, 0),
    spotSeconds: Math.round(shards.reduce((n, s) => n + s.spotMs, 0) / 1000),
    wallSeconds: Math.round((Date.now() - started) / 1000),
    cited: scoreCited(citedRows),
    pile: pileStats(runDb),
    labels: null,
  };
  if (typeof args['labels'] === 'string') {
    const labels = (JSON.parse(readFileSync(resolve(args['labels']), 'utf8')) as { pages: LabelledPage[] }).pages;
    const onPage = runDb.prepare('SELECT issue_id AS issueId, page, title, state FROM mentions WHERE issue_id = ? AND page = ?');
    const found = labels.flatMap((l) => onPage.all(l.issueId, l.page) as FoundOnPage[]);
    result.labels = scoreLabels(labels, found);
  }
  runDb.close();
  writeFileSync(join(outDir, `${label}.json`), `${JSON.stringify(result, null, 1)}\n`);
  const md = reportMarkdown(result);
  writeFileSync(join(outDir, `${label}.md`), md);
  process.stdout.write(`${md}\nKept: ${join(outDir, `${label}.json`)} (the numbers), ${label}.md (this), ${label}.db (every game found)\n`);
}

function compare(rest: readonly string[]): void {
  const [a, b] = rest.map((f) => JSON.parse(readFileSync(resolve(f), 'utf8')) as RunResult);
  if (!a || !b) throw new Error('compare needs two run files: <before.json> <after.json>');
  process.stdout.write(compareMarkdown(a, b));
}

/** Why a game was or wasn't found in an issue: whether it was a candidate, where its words are, and what the spotter made of them. */
function why(args: Args): void {
  const dataDir = resolve(str(args, 'data'));
  const issueId = Number(str(args, 'issue'));
  const title = str(args, 'title');
  const setting = settingsOf(dataDir);
  const db = new Database(join(dataDir, 'magazines-audit.db'), { readonly: true, fileMustExist: true });
  const i = db.prepare('SELECT i.id, m.name AS magazine, i.year, i.month, i.owner_year, i.owner_month, i.text_state FROM issues i JOIN magazines m ON m.id = i.magazine_id WHERE i.id = ?').get(issueId) as IssueRow | undefined;
  if (!i) throw new Error(`No issue ${issueId}`);
  const year = (i.owner_year ?? i.year)!;
  const month = (i.owner_year !== null ? i.owner_month : i.month) ?? 6;
  const coverDay = `${year}-${String(month).padStart(2, '0')}-01`;
  const w = spotWindow({ magazine: i.magazine, year, month }, setting('magazines.spotYears'), setting('magazines.makers'), setting('magazines.spotYearsOlder'));
  const list = readReleases(join(dataDir, 'releases.jsonl'))
    .between(w.from, w.to, w.keep)
    .map((r) => ({ platformKey: r.platformKey, title: r.title, day: r.day, names: r.alt }));
  const key = matchKey(baseTitle(title));
  const same = list.filter((c) => matchKey(baseTitle(c.title)) === key);
  const say = (line: string) => process.stdout.write(`${line}
`);
  say(`${i.magazine} ${coverDay} (issue ${i.id}): checked for ${list.length} games out ${w.from} to ${w.to}`);
  say(same.length > 0 ? `A candidate: ${same.map((c) => `${c.title} (${c.platformKey}, ${c.day})`).join('; ')}` : 'Not a candidate');
  const index = spotIndex(list, coverDay);
  const words = spotWords(baseTitle(title));
  for (const p of db.prepare('SELECT n, words FROM pages WHERE issue_id = ? ORDER BY n').all(issueId) as { n: number; words: string }[]) {
    const page = JSON.parse(p.words) as PageWord[];
    const found = spotTitles(page, index, coverDay).filter((f) => matchKey(baseTitle(f.title)) === key);
    for (const f of found) say(`  p.${p.n}: found as "${f.printed}" at ${f.confidence}`);
    const strict = page.map((x) => spotWord(x.text));
    for (let k = 0; k < strict.length; k++) {
      if (strict[k] !== words[0] || !words.every((x, j) => strict[k + j] === x)) continue;
      const heights = page.map((x) => x.box[3] - x.box[1]).sort((a, b) => a - b);
      const tall = Math.max(...page.slice(k, k + words.length).map((x) => x.box[3] - x.box[1]));
      say(`  p.${p.n}: "${page.slice(Math.max(0, k - 5), k + words.length + 5).map((x) => x.text).join(' ')}" (type ${tall} px, the page's usual ${heights[Math.floor(heights.length / 2)]} px)`);
    }
  }
  db.close();
}

/** A stable pick of n from a list: by a hash of each item's key and the seed, so a later run picks the same ones again. */
function pick<T>(items: readonly T[], n: number, seed: string, keyOf: (item: T) => string): T[] {
  const hash = (s: string) => {
    let h = 2166136261;
    for (let k = 0; k < s.length; k++) h = Math.imul(h ^ s.charCodeAt(k), 16777619);
    return h >>> 0;
  };
  return items
    .map((item) => ({ item, h: hash(`${seed}|${keyOf(item)}`) }))
    .sort((a, b) => a.h - b.h)
    .slice(0, n)
    .map((x) => x.item);
}

/**
 * Some of a run's finds, each with the words around it on its page, to judge by hand whether the page names that game
 * (precision, until the labelled pages exist). --not-in leaves out what another run found the same way.
 */
function sample(args: Args): void {
  const dataDir = resolve(str(args, 'data'));
  const state = str(args, 'state', 'linked');
  const db = new Database(join(dataDir, 'magazines-audit.db'), { readonly: true, fileMustExist: true });
  const run = new Database(resolve(str(args, 'run')), { readonly: true, fileMustExist: true });
  type Row = { issue_id: number; page: number; platform_key: string | null; title: string; title_key: string; printed: string | null; confidence: number | null; box: string | null };
  let rows = run.prepare('SELECT issue_id, page, platform_key, title, title_key, printed, confidence, box FROM mentions WHERE state = ?').all(state) as Row[];
  if (typeof args['not-in'] === 'string') {
    const other = new Database(resolve(args['not-in']), { readonly: true, fileMustExist: true });
    const had = new Set((other.prepare('SELECT issue_id, page, title_key FROM mentions WHERE state = ?').all(state) as Row[]).map((r) => `${r.issue_id}|${r.page}|${r.title_key}`));
    other.close();
    rows = rows.filter((r) => !had.has(`${r.issue_id}|${r.page}|${r.title_key}`));
  }
  const id = (r: Row) => `${r.issue_id}|${r.page}|${r.title_key}|${printedKey(r.printed ?? r.title)}`;
  const picked = pick(rows, Number(str(args, 'n', '100')), str(args, 'seed', '1'), id);
  const issueOf = db.prepare('SELECT m.name AS magazine, COALESCE(i.owner_year, i.year) AS year, COALESCE(i.owner_month, i.month) AS month FROM issues i JOIN magazines m ON m.id = i.magazine_id WHERE i.id = ?');
  const wordsOf = db.prepare('SELECT words FROM pages WHERE issue_id = ? AND n = ?');
  const lines = picked.map((r) => {
    const issue = issueOf.get(r.issue_id) as { magazine: string; year: number; month: number | null };
    const words = JSON.parse((wordsOf.get(r.issue_id, r.page) as { words: string }).words) as PageWord[];
    const box = JSON.parse(r.box ?? '[0,0,0,0]') as number[];
    const inside = words.map((w, k) => (w.box[0] >= box[0]! && w.box[1] >= box[1]! && w.box[2] <= box[2]! && w.box[3] <= box[3]! ? k : -1)).filter((k) => k >= 0);
    const a = inside[0] ?? 0;
    const b = inside[inside.length - 1] ?? 0;
    const around = `${words.slice(Math.max(0, a - 14), a).map((w) => w.text).join(' ')} [[${words.slice(a, b + 1).map((w) => w.text).join(' ')}]] ${words.slice(b + 1, b + 15).map((w) => w.text).join(' ')}`;
    return JSON.stringify({ id: id(r), where: `${issue.magazine} ${issue.year}-${String(issue.month ?? 0).padStart(2, '0')} p.${r.page}`, title: r.title, console: r.platform_key, confidence: r.confidence, around });
  });
  process.stdout.write(`${lines.join('\n')}\n`);
  db.close();
  run.close();
}

/**
 * The pages to label for truth set B: about --n of them (300), spread over magazines, eras and kinds of page, written
 * as a labels file with no games yet (tools/leaves-yardstick/label-pages.py fills them; some are then corrected by hand).
 */
function samplePagesFile(args: Args): void {
  const dataDir = resolve(str(args, 'data'));
  const db = new Database(join(dataDir, 'magazines-audit.db'), { readonly: true, fileMustExist: true });
  const issues = new Map(
    (db.prepare("SELECT i.id, i.path, m.name AS magazine, COALESCE(i.owner_year, i.year) AS year, COALESCE(i.owner_month, i.month) AS month FROM issues i JOIN magazines m ON m.id = i.magazine_id WHERE i.text_state IN ('hocr', 'ocr') AND COALESCE(i.owner_year, i.year) IS NOT NULL").all() as { id: number; path: string; magazine: string; year: number; month: number | null }[]).map((i) => [i.id, i]),
  );
  const all: SamplePage[] = [];
  for (const p of db.prepare('SELECT issue_id, n, text FROM pages').iterate() as IterableIterator<{ issue_id: number; n: number; text: string }>) {
    const issue = issues.get(p.issue_id);
    if (issue) all.push({ issueId: p.issue_id, page: p.n, magazine: issue.magazine, year: issue.year, kind: guessKind(p.n, p.text) });
  }
  db.close();
  const picked = samplePages(all, Number(str(args, 'n', '300')), str(args, 'seed', 'leaves'));
  const pages = picked.map((p) => ({ ...p, month: issues.get(p.issueId)!.month, path: issues.get(p.issueId)!.path, games: [] as { title: string }[], labelledBy: null as string | null, checked: false }));
  const out = resolve(str(args, 'out', join(dataDir, 'pages.json')));
  writeFileSync(out, `${JSON.stringify({ pages }, null, 1)}\n`);
  const by = (key: (p: SamplePage) => string) => Object.entries(picked.reduce<Record<string, number>>((n, p) => ((n[key(p)] = (n[key(p)] ?? 0) + 1), n), {})).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(', ');
  process.stdout.write(`${picked.length} pages of ${all.length} to label, in ${out}\nBy kind (a guess from the text): ${by((p) => p.kind)}\nBy era: ${by((p) => eraOf(p.year))}\nBy magazine: ${by((p) => p.magazine)}\n`);
}

const { rest, args } = parseArgs(process.argv.slice(2));
const command = rest[0];
if (command === 'shard') shard(args);
else if (command === 'run') await run(args);
else if (command === 'compare') compare(rest.slice(1));
else if (command === 'why') why(args);
else if (command === 'sample') sample(args);
else if (command === 'sample-pages') samplePagesFile(args);
else {
  process.stderr.write('Leaves yardstick: run --data <folder> [--label name] [--stored] [--raw-titles] [--no-evidence] [--cited] [--without-second] [--link-at 0.8] [--ask-at 0.6] [--only cited] [--labels pages.json] [--shards n] [--out folder] | compare <before.json> <after.json> | why --data <folder> --issue <id> --title <game> | sample --data <folder> --run <run.db> [--not-in <run.db>] [--n 100] | sample-pages --data <folder> [--n 300] [--out pages.json]\n');
  process.exitCode = 1;
}
