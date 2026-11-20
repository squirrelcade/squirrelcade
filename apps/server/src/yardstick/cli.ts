import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { articleGameTitle, baseTitle, matchKey, printedKey, settingDefinitions, SPOT_VERSION, spotIndex, spotIssue, spotTitles, spotWindow, spotWord, spotWords, type PageWord, type SettingKey, type SpotIndex } from '@squirrelcade/core';
import { readReleases, type Releases } from './releases.js';
import { compareMarkdown, reportMarkdown, type PileStats, type RunResult } from './report.js';
import { causePages, missCause, scoreCited, scoreLabels, type CitedRow, type FoundOnPage, type LabelledPage, type MissCause } from './score.js';

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
  const linkAt = setting('magazines.linkAt');
  const askAt = setting('magazines.askAt');
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
    const pages = (pagesOf.all(i.id) as { n: number; text: string; words: string }[]).map((p) => ({ n: p.n, text: p.text, words: JSON.parse(p.words) as PageWord[] }));
    pagesRead += pages.length;
    // The games the issue is checked for, as the server's task makes them (app.ts, magazines-games).
    let index: SpotIndex | null = null;
    let candidateKeys: Set<string> | null = null;
    const candidates = () => {
      const w = spotWindow({ magazine: i.magazine, year: year!, month }, setting('magazines.spotYears'), setting('magazines.makers'));
      return releases.between(w.from, w.to, w.keep);
    };
    let found: { page: number; platform_key: string | null; title: string; title_key: string; printed: string | null; kind: string | null; score: string | null; confidence: number | null; state: string; box: string | null; consoles: string | null }[];
    if (stored) found = storedOf.all(i.id) as typeof found;
    else {
      const t0 = performance.now();
      const list = candidates();
      index = spotIndex(list, coverDay);
      if (cited.length > 0) candidateKeys = new Set(list.map((c) => matchKey(baseTitle(c.title))));
      found = spotIssue(pages, index, { magazine: i.magazine, coverDay, linkAt, askAt, rules }).map((x) => ({
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
          const pass = ['shard', '--data', str(args, 'data'), '--shard', `${k}/${parts}`, '--out', file, ...(args['stored'] === true ? ['--stored'] : []), ...(args['raw-titles'] === true ? ['--raw-titles'] : []), ...(typeof args['only'] === 'string' ? ['--only', args['only']] : [])];
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
  const parts = Number(str(args, 'shards', String(Math.max(1, Math.min(12, cpus().length - 2)))));
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
  const w = spotWindow({ magazine: i.magazine, year, month }, setting('magazines.spotYears'), setting('magazines.makers'));
  const list = readReleases(join(dataDir, 'releases.jsonl')).between(w.from, w.to, w.keep);
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

const { rest, args } = parseArgs(process.argv.slice(2));
const command = rest[0];
if (command === 'shard') shard(args);
else if (command === 'run') await run(args);
else if (command === 'compare') compare(rest.slice(1));
else if (command === 'why') why(args);
else {
  process.stderr.write('Leaves yardstick: run --data <folder> [--label name] [--stored] [--raw-titles] [--only cited] [--labels pages.json] [--shards n] [--out folder] | compare <before.json> <after.json>\n');
  process.exitCode = 1;
}
