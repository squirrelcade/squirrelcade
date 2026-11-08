import { baseTitle, citationMonth, citedIssueNumber, matchKey, platformsIn, scoresOn, SPOT_VERSION, spotIndex, spotTitles, spotWord, type SpotCandidate, coverLeadFor, guessDates, magazineOf, printedPage, issueFromFileName, issueLabel, pageNames, parseComicInfo, parseHocr, skippedName, writeHocr, type IssueInfo, type IssueToDate, type PageWord } from '@squirrelcade/core';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, type Dirent } from 'node:fs';
import { mkdir, open, readdir, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { isViewer } from './access.js';
import type { Logger } from 'pino';
import sharp from 'sharp';
import type { Env } from './env.js';
import type { SettingsService } from './settings.js';
import { ZipFileWriter } from './zip.js';

/**
 * Leaves (D177, docs/design/magazines-build.md): the owner's magazine scans, read from a folder (read only, never
 * changed). Everything Squirrelcade learns from them (the issues, their pages' text and word boxes, the search index)
 * is kept in a database of its own, magazines.db in the config folder: rebuildable from the scans, so left out of
 * backups. Reading the library opens a CBZ only for its table of contents and its small ComicInfo.xml, and only when
 * the file changed; a page is read from its CBZ when it's shown.
 */

/** A file or folder the magazines folder's permissions keep Squirrelcade out of (D196). */
export function isLocked(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'EACCES' || code === 'EPERM' || /EACCES|EPERM|permission denied/i.test(err instanceof Error ? err.message : String(err));
}

const lockedHelp = "Squirrelcade's account needs permission to read the magazines folder and its files: Help > Magazines says how.";

/** What a scan says when the magazines folder itself can't be opened (D196). */
function lockedMessage(root: string, err: unknown): string {
  return isLocked(err)
    ? `Squirrelcade can't open the magazines folder (${root}): its permissions keep Squirrelcade out. ${lockedHelp}`
    : `The magazines folder (${root}) couldn't be read: ${err instanceof Error ? err.message : String(err)}`;
}

/** The night's reading in a line (D196): what was read, and apart from it what failed and what couldn't be opened. */
export function nightMessage(read: number, pages: number, failed: number, unopened: number, stoppedLocked = false): string {
  const n = (x: number) => x.toLocaleString('en-US');
  const parts = [`${n(read)} ${read === 1 ? 'issue' : 'issues'} read (${n(pages)} pages)`];
  if (failed > 0) parts.push(`${n(failed)} couldn't be read`);
  if (unopened > 0) parts.push(`${n(unopened)} couldn't be opened (their permissions)`);
  return `${parts.join(', ')}${stoppedLocked ? '; stopped: the magazines folder looks locked' : ''}`;
}

/** A magazines' text export (D209): its manifest's format name. */
const TEXT_FORMAT = 'squirrelcade-magazine-text';
/** An export's file name in config/exports. */
const TEXT_EXPORT = /^magazine-text-[\d-]+(?:-new)?\.zip$/;

/** What an export or an import of the text did. */
export interface TextJobResult {
  file: string;
  issues: number;
  pages: number;
  filled: number;
  skipped: number;
  unmatched: number;
  rules: number;
}

/** The text's export or import running now, or the last one. */
export interface TextJob {
  kind: 'export' | 'import';
  state: 'running' | 'done' | 'failed';
  progress: string;
  startedAt: string;
  result: TextJobResult | null;
  error: string | null;
}

/** An export's manifest: each issue's file, its magazine's folder and its numbering, for a friend's install to find it. */
interface TextManifest {
  format: string;
  version: number;
  exportedAt: string;
  since: string | null;
  issues: { path: string; size: number; folder: string; magazine: string; number: string | null; volume: string | null; year: number | null; month: number | null; pages: number; dir: string; read: number }[];
}

/** One file in a zip, as its table of contents gives it. */
interface ZipItem {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

/** A zip's table of contents, read from its end (the whole file is never read). */
export async function zipContents(path: string): Promise<ZipItem[]> {
  const fh = await open(path, 'r');
  try {
    const { size } = await fh.stat();
    const tail = Math.min(size, 65_557);
    const buf = Buffer.alloc(tail);
    await fh.read(buf, 0, tail, size - tail);
    let end = -1;
    for (let i = tail - 22; i >= 0; i--) {
      if (buf.readUInt32LE(i) === 0x06054b50) {
        end = i;
        break;
      }
    }
    if (end < 0) throw new Error('not a zip (no table of contents)');
    let count = buf.readUInt16LE(end + 10);
    let cdSize = buf.readUInt32LE(end + 12);
    let cdOffset = buf.readUInt32LE(end + 16);
    // A zip over 4 GB keeps them in its zip64 record.
    if (cdOffset === 0xffffffff || count === 0xffff) {
      const loc = end - 20;
      if (loc < 0 || buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('a zip64 file without its locator');
      const rec = Buffer.alloc(56);
      await fh.read(rec, 0, 56, Number(buf.readBigUInt64LE(loc + 8)));
      count = Number(rec.readBigUInt64LE(32));
      cdSize = Number(rec.readBigUInt64LE(40));
      cdOffset = Number(rec.readBigUInt64LE(48));
    }
    const cd = Buffer.alloc(cdSize);
    await fh.read(cd, 0, cdSize, cdOffset);
    const items: ZipItem[] = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      let compressed = cd.readUInt32LE(p + 20);
      let size = cd.readUInt32LE(p + 24);
      let offset = cd.readUInt32LE(p + 42);
      // Sizes and offset past 4 GB are in the zip64 extra field, in that order, the ones that overflowed.
      if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) {
        let e = p + 46 + nameLen;
        const stop = e + extraLen;
        while (e + 4 <= stop) {
          const id = cd.readUInt16LE(e);
          const len = cd.readUInt16LE(e + 2);
          if (id === 0x0001) {
            let q = e + 4;
            if (size === 0xffffffff) (size = Number(cd.readBigUInt64LE(q))), (q += 8);
            if (compressed === 0xffffffff) (compressed = Number(cd.readBigUInt64LE(q))), (q += 8);
            if (offset === 0xffffffff) offset = Number(cd.readBigUInt64LE(q));
          }
          e += 4 + len;
        }
      }
      items.push({ name: cd.toString('utf8', p + 46, p + 46 + nameLen), method: cd.readUInt16LE(p + 10), compressed, size, offset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return items;
  } finally {
    await fh.close();
  }
}

/** One file of a zip, read from where its table of contents says it is. */
export async function zipRead(path: string, item: ZipItem): Promise<Buffer> {
  const fh = await open(path, 'r');
  try {
    const head = Buffer.alloc(30);
    await fh.read(head, 0, 30, item.offset);
    if (head.readUInt32LE(0) !== 0x04034b50) throw new Error(`${item.name}: not where the zip says`);
    const start = item.offset + 30 + head.readUInt16LE(26) + head.readUInt16LE(28);
    const data = Buffer.alloc(item.compressed);
    await fh.read(data, 0, item.compressed, start);
    if (item.method === 0) return data;
    if (item.method === 8) return inflateRawSync(data);
    throw new Error(`${item.name}: packed a way Squirrelcade can't read (method ${item.method})`);
  } finally {
    await fh.close();
  }
}

/** The widths a page is made at for screens (D182): a step up from what's asked, so few are made and kept. */
const PAGE_WIDTHS = [240, 480, 800, 1200, 1600, 2400, 3200, 4000];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS magazines (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, folder TEXT NOT NULL, publisher TEXT);
CREATE TABLE IF NOT EXISTS issues (
  id INTEGER PRIMARY KEY, magazine_id INTEGER NOT NULL, path TEXT NOT NULL UNIQUE, file_size INTEGER NOT NULL, file_mtime INTEGER NOT NULL,
  number TEXT, volume TEXT, year INTEGER, month INTEGER, title TEXT, pages INTEGER NOT NULL DEFAULT 0, named_by TEXT NOT NULL,
  owner_year INTEGER, owner_month INTEGER, text_state TEXT NOT NULL DEFAULT 'none', problem TEXT, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS issues_magazine ON issues(magazine_id);
CREATE TABLE IF NOT EXISTS pages (issue_id INTEGER NOT NULL, n INTEGER NOT NULL, text TEXT NOT NULL, words TEXT NOT NULL, width INTEGER, height INTEGER, source TEXT NOT NULL, PRIMARY KEY (issue_id, n));
CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(text, issue_id UNINDEXED, n UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS mentions (
  id INTEGER PRIMARY KEY, issue_id INTEGER NOT NULL, page INTEGER NOT NULL, platform_key TEXT, title TEXT NOT NULL, title_key TEXT NOT NULL,
  printed TEXT, kind TEXT, score TEXT, source TEXT NOT NULL, confidence REAL, state TEXT NOT NULL, box TEXT, created_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS mentions_one ON mentions(issue_id, page, title_key, source);
CREATE INDEX IF NOT EXISTS mentions_title ON mentions(title_key);
CREATE TABLE IF NOT EXISTS mention_rules (printed_key TEXT NOT NULL, magazine TEXT NOT NULL, answer TEXT NOT NULL, PRIMARY KEY (printed_key, magazine));
`;

/** A game on a magazine's page (D191): from a review's citation, the page's text, or the owner's own mark. */
export interface MentionView {
  id: number;
  issueId: number;
  issue: string;
  magazine: string;
  page: number;
  version: number;
  platformKey: string | null;
  title: string;
  /** The words on the page (or the citation's outlet) it was found by. */
  printed: string | null;
  /** review, preview, feature... when known. */
  kind: string | null;
  score: string | null;
  source: 'citation' | 'ocr' | 'owner';
  /** linked (it's this game), or suggested (to answer on Review > Magazines). */
  state: 'linked' | 'suggested';
  confidence: number | null;
  /** Where it is on the page, in the scan's pixels (from the text's word boxes, or the owner's box). */
  box: [number, number, number, number] | null;
  /**
   * The consoles the page names ("PS2", "Nintendo 64"), worked out once when its games are found (item 11 of the owner's
   * 1.3 list): the chest fills when you have the game on one of them it came out on, else on the mention's console.
   */
  consoles: string[];
}

interface MentionRow {
  id: number;
  issue_id: number;
  page: number;
  platform_key: string | null;
  title: string;
  title_key: string;
  printed: string | null;
  kind: string | null;
  score: string | null;
  source: string;
  confidence: number | null;
  state: string;
  box: string | null;
  consoles?: string | null;
  issue_pages: number;
  version: number;
  magazine: string;
}

/** A magazine, as Leaves lists it. */
export interface MagazineView {
  id: number;
  name: string;
  publisher: string | null;
  issues: number;
  from: number | null;
  to: number | null;
  /** The issue whose cover stands for it (the first). */
  coverIssue: number | null;
  withText: number;
}

/** An issue, as a magazine's page lists it. */
export interface IssueView {
  id: number;
  magazineId: number;
  magazine: string;
  label: string;
  number: string | null;
  volume: string | null;
  year: number | null;
  month: number | null;
  title: string | null;
  pages: number;
  /** No date: on Name these, for the owner to give one. */
  needsDate: boolean;
  /** A date nobody gave (D181): from the magazine index, or worked out from its number; null otherwise. */
  dateFrom: 'index' | 'numbering' | null;
  /** The file's page of printed page 1 less one, when the owner set it (D191). */
  pageOffset: number | null;
  text: 'none' | 'hocr' | 'ocr' | 'failed';
  problem: string | null;
  version: number;
}

/** A search's answer: a page, with the words found marked (between [ and ]). */
export interface PageHit {
  issueId: number;
  label: string;
  page: number;
  snippet: string;
}

/** Reads one page with Tesseract: its hOCR (the image's bytes in), for the night's reading. */
export type PageReader = (image: Buffer, threads: number) => Promise<string>;

/** Tesseract, at the lowest priority ("nice"), the page on its standard input, its hOCR out. */
export const tesseract: PageReader = (image, threads) =>
  new Promise((resolve, reject) => {
    const child = spawn('nice', ['-n', '19', 'tesseract', 'stdin', 'stdout', '-l', 'eng', 'hocr'], { env: { ...process.env, OMP_THREAD_LIMIT: String(threads) }, windowsHide: true });
    const out: Buffer[] = [];
    child.stdout.on('data', (d: Buffer) => out.push(d));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(`Tesseract stopped (${code})`))));
    child.stdin.end(image);
  });

export class MagazineService {
  private db: Database.Database | null = null;
  /** The table of contents of the CBZs read lately (a page turned reads only its picture). */
  private contents = new Map<string, { mtime: number; pages: ZipItem[] }>();

  constructor(
    private readonly settings: SettingsService,
    private readonly env: Env,
    private readonly log: Logger,
    private readonly readPage: PageReader = tesseract,
  ) {}

  enabled(): boolean {
    return this.settings.get('features.magazines') === true;
  }

  /** The magazines folder: the setting, else /magazines in Docker. */
  folder(): string | null {
    return this.settings.get('magazines.folder') || (this.env.inDocker ? '/magazines' : null);
  }

  private textFolder(): string | null {
    const f = this.folder();
    return this.settings.get('magazines.textFolder') || (f ? join(f, '_derived') : null);
  }

  /** Leaves' own database, opened the first time it's needed. */
  private store(): Database.Database {
    if (!this.db) {
      this.db = new Database(join(this.env.configDir, 'magazines.db'));
      this.db.pragma('journal_mode = WAL');
      this.db.exec(SCHEMA);
      // D181: where a date nobody gave came from (the magazine index, or the issue's number); null for a file's own.
      const columns = (this.db.prepare('PRAGMA table_info(issues)').all() as { name: string }[]).map((c) => c.name);
      if (!columns.includes('date_from')) this.db.exec('ALTER TABLE issues ADD COLUMN date_from TEXT');
      // D191: the file's page of printed page 1 less one (covers, inserts), set once by the owner ("this is page 28").
      if (!columns.includes('page_offset')) this.db.exec('ALTER TABLE issues ADD COLUMN page_offset INTEGER');
      // D209: when an issue's text was read or brought in, for an export of only what's new since the last.
      if (!columns.includes('text_at')) this.db.exec('ALTER TABLE issues ADD COLUMN text_at TEXT');
      // The consoles a mention's page names (item 11 of the owner's 1.3 list), for the chest on its game.
      if (!(this.db.prepare('PRAGMA table_info(mentions)').all() as { name: string }[]).some((c) => c.name === 'consoles')) this.db.exec('ALTER TABLE mentions ADD COLUMN consoles TEXT');
    }
    return this.db;
  }

  close(): void {
    this.db?.close();
    this.db = null;
  }

  /**
   * The task: the magazines folder read (a folder for each magazine, an issue a CBZ), each changed file's table of
   * contents and ComicInfo.xml read, gone files forgotten, then the text that came with the scans brought in.
   */
  async scan(progress: (line: string) => void = () => undefined): Promise<string | { message: string; warning: true }> {
    if (!this.enabled()) return 'Leaves is off';
    const root = this.folder();
    if (!root || !existsSync(root)) return `The magazines folder${root ? ` (${root})` : ''} can't be found: name it on Settings > Magazines, or mount it at /magazines.`;
    const db = this.store();
    const skip = this.settings.get('magazines.skip');
    const seen = new Set<string>();
    let added = 0;
    let changed = 0;
    let failed = 0;
    let locked = 0;
    const known = new Map((db.prepare('SELECT path, file_size AS size, file_mtime AS mtime FROM issues').all() as { path: string; size: number; mtime: number }[]).map((r) => [r.path, r]));
    // D196: a folder Squirrelcade can't enter is said plainly (the task fails, so System > Status shows it), and
    // what was read of it before is kept.
    let entries: Dirent[];
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (err) {
      throw new Error(lockedMessage(root, err));
    }
    for (const dir of entries.filter((d) => d.isDirectory() && !skippedName(d.name, skip))) {
      progress(dir.name);
      // A folder or file that can't be read (its permissions) is said in the log and passed over: the rest is read,
      // and what was read of it before is kept.
      let files: Dirent[];
      try {
        files = await readdir(join(root, dir.name), { withFileTypes: true });
      } catch (err) {
        if (isLocked(err)) locked++;
        else failed++;
        this.log.warn({ context: 'magazines' }, `${dir.name} couldn't be read: ${err instanceof Error ? err.message : String(err)}`);
        for (const p of known.keys()) if (p.startsWith(`${dir.name}/`)) seen.add(p);
        continue;
      }
      for (const file of files.filter((f) => f.isFile() && /\.cbz$/i.test(f.name) && !skippedName(f.name, skip))) {
        const path = join(root, dir.name, file.name);
        const rel = relative(root, path).replace(/\\/g, '/');
        seen.add(rel);
        try {
          const st = await stat(path);
          const was = known.get(rel);
          if (was && was.size === st.size && was.mtime === Math.round(st.mtimeMs)) continue;
          const items = await zipContents(path);
          const info = items.find((i) => /(^|\/)comicinfo\.xml$/i.test(i.name));
          const fromInfo = info ? parseComicInfo((await zipRead(path, info)).toString('utf8')) : null;
          const fromName = issueFromFileName(file.name);
          const issue: IssueInfo = fromInfo?.magazine ? { ...fromName, ...Object.fromEntries(Object.entries(fromInfo).filter(([, v]) => v !== null)) } : fromName;
          this.saveIssue(rel, dir.name, issue, pageNames(items.map((i) => i.name)).length, st.size, Math.round(st.mtimeMs), fromInfo?.magazine ? 'comicinfo' : 'filename');
          if (was) changed++;
          else added++;
        } catch (err) {
          if (isLocked(err)) locked++;
          else failed++;
          this.log.warn({ context: 'magazines' }, `${rel} couldn't be read: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    // Files gone from the folder: their issues, and their text, forgotten.
    const gone = [...known.keys()].filter((p) => !seen.has(p));
    for (const p of gone) this.forget(p);
    const dated = this.fillDates();
    const requeued = this.requeueUnlocked();
    const text = await this.importText(progress);
    // D209: a friend's text export left in the text folder is read once (by its name, size and date).
    let shared = 0;
    const base = this.textFolder();
    if (base && existsSync(base)) {
      for (const name of (await readdir(base)).filter((n) => /\.zip$/i.test(n))) {
        const st = await stat(join(base, name));
        const key = `textzip:${name}|${st.size}|${Math.round(st.mtimeMs)}`;
        if (this.stateOf(key)) continue;
        try {
          shared += (await this.importTextZip(join(base, name), { rules: false }, progress)).filled;
        } catch (err) {
          this.log.warn({ context: 'magazines' }, `${name} in the text folder couldn't be read: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.setState(key, new Date().toISOString());
      }
    }
    const issues = (db.prepare('SELECT COUNT(*) AS n FROM issues').get() as { n: number }).n;
    const message = `${issues} issues${added > 0 ? `, ${added} new` : ''}${changed > 0 ? `, ${changed} changed` : ''}${gone.length > 0 ? `, ${gone.length} gone` : ''}${failed > 0 ? `, ${failed} couldn't be read` : ''}${locked > 0 ? `, ${locked} couldn't be opened (their permissions: Help > Magazines)` : ''}${requeued > 0 ? `; ${requeued} back in line for their text` : ''}${dated > 0 ? `; ${dated} dated by the magazine index` : ''}${text > 0 ? `; text brought in for ${text}` : ''}${shared > 0 ? `; a friend's text for ${shared}` : ''}`;
    return locked > 0 || failed > 0 ? { message, warning: true } : message;
  }

  /**
   * D196: the issues the night's reading marked failed because their file couldn't be opened (the folder locked by
   * its permissions) go back in line once it can be read. How many did.
   */
  requeueUnlocked(): number {
    const root = this.folder();
    if (!root) return 0;
    const db = this.store();
    const rows = db.prepare("SELECT id, path FROM issues WHERE text_state = 'failed' AND (problem LIKE 'EACCES%' OR problem LIKE 'EPERM%' OR problem LIKE '%permission denied%')").all() as { id: number; path: string }[];
    let n = 0;
    const back = db.prepare("UPDATE issues SET text_state = 'none', problem = NULL WHERE id = ?");
    for (const r of rows) {
      try {
        accessSync(join(root, r.path), constants.R_OK);
        back.run(r.id);
        n++;
      } catch {
        // Still locked: it waits for the next look.
      }
    }
    return n;
  }

  private saveIssue(path: string, folder: string, info: IssueInfo, pages: number, size: number, mtime: number, namedBy: string): void {
    const db = this.store();
    const name = info.magazine ?? folder;
    db.prepare('INSERT INTO magazines (name, folder, publisher) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET publisher = COALESCE(excluded.publisher, publisher)').run(name, folder, info.publisher);
    const magazine = (db.prepare('SELECT id FROM magazines WHERE name = ?').get(name) as { id: number }).id;
    db.prepare(
      `INSERT INTO issues (magazine_id, path, file_size, file_mtime, number, volume, year, month, title, pages, named_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET magazine_id = excluded.magazine_id, file_size = excluded.file_size, file_mtime = excluded.file_mtime, number = excluded.number, volume = excluded.volume,
         year = excluded.year, month = excluded.month, date_from = NULL, title = excluded.title, pages = excluded.pages, named_by = excluded.named_by, problem = NULL, updated_at = excluded.updated_at`,
    ).run(magazine, path, size, mtime, info.number, info.volume, info.year, info.month, info.title, pages, namedBy, new Date().toISOString());
    this.contents.delete(path);
  }

  /**
   * The dates nobody gave (D181): from the magazine index, or an issue's number between dated ones, worked out again
   * each time (an owner's date or a file's always wins). How many issues it dated.
   */
  fillDates(): number {
    const db = this.store();
    const fills = db.transaction(() => {
      db.prepare('UPDATE issues SET year = NULL, month = NULL, date_from = NULL WHERE date_from IS NOT NULL').run();
      const rows = db
        .prepare('SELECT i.id, m.name AS magazine, i.number, i.volume, COALESCE(i.owner_year, i.year) AS year, CASE WHEN i.owner_year IS NOT NULL THEN i.owner_month ELSE i.month END AS month FROM issues i JOIN magazines m ON m.id = i.magazine_id')
        .all() as IssueToDate[];
      const guessed = guessDates(rows);
      const set = db.prepare('UPDATE issues SET year = ?, month = ?, date_from = ? WHERE id = ?');
      for (const g of guessed) set.run(g.year, g.month, g.from, g.id);
      return guessed.length;
    })();
    return fills;
  }

  private forget(path: string): void {
    const db = this.store();
    const row = db.prepare('SELECT id FROM issues WHERE path = ?').get(path) as { id: number } | undefined;
    if (!row) return;
    db.prepare('DELETE FROM pages WHERE issue_id = ?').run(row.id);
    db.prepare('DELETE FROM pages_fts WHERE issue_id = ?').run(row.id);
    db.prepare('DELETE FROM issues WHERE id = ?').run(row.id);
  }

  /**
   * The text that came with the scans (Tesseract's hOCR, <text folder>/<magazine folder>/ocr/<issue>/001.hocr...),
   * brought in for issues without text: the issue a folder is is the number at the end of its name ("NP-010" is #10).
   * How many issues got text.
   */
  async importText(progress: (line: string) => void = () => undefined): Promise<number> {
    const base = this.textFolder();
    if (!base || !existsSync(base)) return 0;
    const db = this.store();
    let done = 0;
    for (const m of db.prepare('SELECT id, name, folder FROM magazines').all() as { id: number; name: string; folder: string }[]) {
      const dir = join(base, m.folder, 'ocr');
      if (!existsSync(dir)) continue;
      for (const sub of (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory())) {
        const num = /(\d+)\s*$/.exec(sub.name)?.[1];
        if (!num) continue;
        const issue = db.prepare("SELECT id FROM issues WHERE magazine_id = ? AND CAST(number AS INTEGER) = ? AND text_state = 'none'").get(m.id, Number(num)) as { id: number } | undefined;
        if (!issue) continue;
        progress(`${m.name} ${sub.name}`);
        const files = (await readdir(join(dir, sub.name))).filter((f) => /^\d+\.hocr$/i.test(f)).sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
        const pages: { n: number; text: string; words: PageWord[] }[] = [];
        for (const f of files) pages.push({ n: Number.parseInt(f, 10), ...parseHocr(await readFile(join(dir, sub.name, f), 'utf8')) });
        if (pages.length === 0) continue;
        await this.savePages(issue.id, pages, 'hocr');
        done++;
      }
    }
    return done;
  }

  /**
   * An issue's pages kept, with their words' boxes and the search index: a few pages at a time with requests let in
   * between (1.4.0, D220: a big issue's tens of MB in one transaction held the server for seconds while the night
   * reader ran). The issue counts as read only once all its pages are in.
   */
  private async savePages(issueId: number, pages: { n: number; text: string; words: PageWord[] }[], source: 'hocr' | 'ocr'): Promise<void> {
    const db = this.store();
    db.transaction(() => {
      db.prepare('DELETE FROM pages WHERE issue_id = ?').run(issueId);
      db.prepare('DELETE FROM pages_fts WHERE issue_id = ?').run(issueId);
    })();
    const page = db.prepare('INSERT INTO pages (issue_id, n, text, words, source) VALUES (?, ?, ?, ?, ?)');
    const fts = db.prepare('INSERT INTO pages_fts (text, issue_id, n) VALUES (?, ?, ?)');
    const some = db.transaction((list: { n: number; text: string; words: PageWord[] }[]) => {
      for (const p of list) {
        page.run(issueId, p.n, p.text, JSON.stringify(p.words), source);
        if (p.text.trim()) fts.run(p.text, issueId, p.n);
      }
    });
    let at = 0;
    while (at < pages.length) {
      // As many pages as fit in about 40 ms, at least one.
      const started = Date.now();
      do some(pages.slice(at, ++at));
      while (at < pages.length && Date.now() - started < 40);
      await new Promise((resolve) => setImmediate(resolve));
    }
    db.prepare('UPDATE issues SET text_state = ?, text_at = ? WHERE id = ?').run(source, new Date().toISOString(), issueId);
  }

  /** Whether now is in the reading hours ("01-06": 1 AM to 6 AM, in the owner's time zone). */
  private inReadingHours(now = new Date()): boolean {
    const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(this.settings.get('magazines.ocrHours').trim());
    if (!m) return false;
    const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: this.settings.get('general.timeZone') || undefined }).format(now));
    const [from, to] = [Number(m[1]), Number(m[2])];
    return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
  }

  /**
   * The night's reading: the issues without text, newest added first, page by page with Tesseract at the lowest priority, until the
   * reading hours end. After its first issue it says how long the rest will take.
   */
  async readText(progress: (line: string) => void = () => undefined, force = false): Promise<string | { message: string; warning: true }> {
    if (!this.enabled() || !this.settings.get('magazines.ocr')) return 'Reading the magazines is off';
    if (!force && !this.inReadingHours()) return 'Outside the reading hours';
    const root = this.folder();
    if (!root || !existsSync(root)) return "The magazines folder can't be found";
    const db = this.store();
    const threads = this.settings.get('magazines.ocrThreads');
    // T-176: several pages at once, each by its own Tesseract (one rarely uses more than two cores).
    const atOnce = Math.max(1, this.settings.get('magazines.ocrPages'));
    this.requeueUnlocked();
    let read = 0;
    let failed = 0;
    let unopened = 0;
    let lockedInARow = 0;
    let pagesRead = 0;
    let stoppedLocked = false;
    const started = Date.now();
    for (;;) {
      if (!force && !this.inReadingHours()) break;
      const issue = db.prepare("SELECT id, path FROM issues WHERE text_state = 'none' ORDER BY id DESC LIMIT 1").get() as { id: number; path: string } | undefined;
      if (!issue) break;
      const path = join(root, issue.path);
      try {
        const names = await this.pageItems(path);
        const pages: { n: number; text: string; words: PageWord[] }[] = new Array(names.length);
        let next = 0;
        let done = 0;
        let broken: unknown = null;
        const worker = async () => {
          // A page that fails stops the others taking new pages; they finish the one they're on.
          for (let i = next++; i < names.length && broken === null; i = next++) {
            try {
              const hocr = await this.readPage(await zipRead(path, names[i]!), threads);
              pages[i] = { n: i + 1, ...parseHocr(hocr) };
              done++;
              pagesRead++;
              progress(`${basename(issue.path)}: page ${done} of ${names.length}`);
            } catch (err) {
              broken ??= err;
            }
          }
        };
        await Promise.all(Array.from({ length: Math.min(atOnce, Math.max(1, names.length)) }, worker));
        if (broken !== null) throw broken;
        await this.savePages(issue.id, pages, 'ocr');
        read++;
        lockedInARow = 0;
      } catch (err) {
        db.prepare("UPDATE issues SET text_state = 'failed', problem = ? WHERE id = ?").run(err instanceof Error ? err.message.slice(0, 300) : String(err), issue.id);
        // D196: a file the folder's permissions keep out isn't a bad scan: it's counted apart, goes back in line once
        // it can be opened, and a run of them stops the night (the whole folder is locked).
        if (isLocked(err)) {
          unopened++;
          if (++lockedInARow >= 10) {
            stoppedLocked = true;
            break;
          }
        } else {
          failed++;
          lockedInARow = 0;
        }
      }
      if (read + failed === 1 && unopened === 0) {
        const left = (db.prepare("SELECT COUNT(*) AS n FROM issues WHERE text_state = 'none'").get() as { n: number }).n;
        const hours = ((Date.now() - started) / 3_600_000) * left;
        this.writeState('ocrEstimate', JSON.stringify({ at: new Date().toISOString(), perIssueSeconds: Math.round((Date.now() - started) / 1000), issuesLeft: left, hoursLeft: Math.round(hours) }));
      }
      if (force) break;
    }
    if (read + failed + unopened === 0) return 'Nothing left to read';
    const message = nightMessage(read, pagesRead, failed, unopened, stoppedLocked);
    // Nothing read and files that couldn't be opened: the run failed, so System > Status shows it in red.
    if (read === 0 && unopened > 0) throw new Error(`${message} ${lockedHelp}`);
    return failed > 0 || unopened > 0 ? { message, warning: true } : message;
  }

  private writeState(key: string, value: string): void {
    this.store().prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  private readState(key: string): string | null {
    return (this.store().prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }

  /** A CBZ's pages, in order, from its table of contents (kept while the file stays the same). */
  private async pageItems(path: string): Promise<ZipItem[]> {
    const st = await stat(path);
    const kept = this.contents.get(path);
    if (kept && kept.mtime === st.mtimeMs) return kept.pages;
    const items = await zipContents(path);
    const order = pageNames(items.map((i) => i.name));
    const pages = order.map((n) => items.find((i) => i.name === n)!);
    if (this.contents.size > 200) this.contents.clear();
    this.contents.set(path, { mtime: st.mtimeMs, pages });
    return pages;
  }


  // ---------------------------------------------------------------------------------------------------------------
  // Sharing the read text (D209): a friend with the same scans takes it instead of reading it again (an older NAS
  // without AVX2 reads a page in minutes). Only the magazines' text goes: no collection, nothing of the owner's own.

  private textJob: TextJob | null = null;

  /** Where the text's exports are written (and a friend's upload waits while it's read): config/exports. */
  exportsFolder(): string {
    return join(this.env.configDir, 'exports');
  }

  /** The exports made, newest first, and what the share is doing now. */
  textShare(): { job: TextJob | null; exports: { name: string; bytes: number; at: string }[]; lastExportAt: string | null } {
    const dir = this.exportsFolder();
    const exports = existsSync(dir)
      ? readdirSync(dir)
          .filter((n) => TEXT_EXPORT.test(n))
          .map((name) => {
            const st = statSync(join(dir, name));
            return { name, bytes: st.size, at: st.mtime.toISOString() };
          })
          .sort((a, b) => b.at.localeCompare(a.at))
      : [];
    return { job: this.textJob, exports, lastExportAt: this.enabled() ? this.readState('textExportedAt') : null };
  }

  /** Starts an export (all the text, only what was read since the last export, or since a day): false while one runs. */
  startTextExport(since: 'all' | 'last' | string): boolean {
    if (this.textJob?.state === 'running') return false;
    const job: TextJob = { kind: 'export', state: 'running', progress: 'Starting', startedAt: new Date().toISOString(), result: null, error: null };
    this.textJob = job;
    void this.exportText(since, (line) => (job.progress = line))
      .then((result) => Object.assign(job, { state: 'done', progress: '', result }))
      .catch((err: unknown) => Object.assign(job, { state: 'failed', error: err instanceof Error ? err.message : String(err) }));
    return true;
  }

  /** Writes the text as Tesseract's hOCR, a file a page, in the layout the text folder is read in, with a manifest. */
  async exportText(since: 'all' | 'last' | string, progress: (line: string) => void = () => undefined): Promise<TextJobResult> {
    const db = this.store();
    const started = new Date();
    const last = since === 'last' ? this.readState('textExportedAt') : null;
    const from = since === 'last' ? last : since === 'all' ? null : since;
    type Row = { id: number; path: string; folder: string; magazine: string; number: string | null; volume: string | null; year: number | null; month: number | null; pages: number; file_size: number; text_at: string | null };
    const rows = (
      db
        .prepare(
          `SELECT i.id, i.path, m.folder, m.name AS magazine, i.number, i.volume, COALESCE(i.owner_year, i.year) AS year, CASE WHEN i.owner_year IS NOT NULL THEN i.owner_month ELSE i.month END AS month, i.pages, i.file_size, i.text_at
           FROM issues i JOIN magazines m ON m.id = i.magazine_id WHERE i.text_state IN ('hocr', 'ocr') ORDER BY m.folder, i.path`,
        )
        .all() as Row[]
    ).filter((r) => !from || (r.text_at !== null && (since === 'last' ? r.text_at > from : r.text_at >= from)));
    mkdirSync(this.exportsFolder(), { recursive: true });
    const stamp = started.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
    let name = `magazine-text-${stamp}${from ? '-new' : ''}.zip`;
    // Two exports in the same second keep both.
    for (let i = 2; existsSync(join(this.exportsFolder(), name)); i++) name = `magazine-text-${stamp}-${i}${from ? '-new' : ''}.zip`;
    const part = join(this.exportsFolder(), `${name}.part`);
    const zip = await ZipFileWriter.create(part, started);
    const manifest: TextManifest = { format: TEXT_FORMAT, version: 1, exportedAt: started.toISOString(), since: from, issues: [] };
    let pages = 0;
    let since50 = Date.now();
    try {
      for (const [k, r] of rows.entries()) {
        progress(`${r.magazine}: ${basename(r.path)} (${k + 1} of ${rows.length})`);
        // The issue's folder ends with its number, as the text folder's own reading (importText) expects.
        const num = r.number && /^\d+$/.test(r.number.trim()) ? ` - ${Number(r.number)}` : '';
        const dir = `${basename(r.path).replace(/\.cbz$/i, '').replace(/[\\/:*?"<>|]+/g, '_').replace(/[\s.]+$/, '')}${num}`;
        const issuePages = db.prepare('SELECT n, text, words FROM pages WHERE issue_id = ? ORDER BY n').all(r.id) as { n: number; text: string; words: string }[];
        for (const p of issuePages) {
          await zip.add(`${r.folder}/ocr/${dir}/${String(p.n).padStart(3, '0')}.hocr`, Buffer.from(writeHocr(JSON.parse(p.words) as PageWord[], p.text), 'utf8'));
          pages++;
          if (Date.now() - since50 > 50) {
            await new Promise((resolve) => setImmediate(resolve));
            since50 = Date.now();
          }
        }
        manifest.issues.push({ path: r.path, size: r.file_size, folder: r.folder, magazine: r.magazine, number: r.number, volume: r.volume, year: r.year, month: r.month, pages: r.pages, dir, read: issuePages.length });
      }
      // The answers about which game a page's words mean, for a friend who wants them too (off when importing, to start).
      const rules = db.prepare('SELECT printed_key, magazine, answer FROM mention_rules').all();
      await zip.add('rules.json', Buffer.from(JSON.stringify(rules), 'utf8'));
      await zip.add('manifest.json', Buffer.from(JSON.stringify(manifest, null, 1), 'utf8'));
      await zip.close();
      renameSync(part, join(this.exportsFolder(), name));
    } catch (err) {
      await zip.abort();
      rmSync(part, { force: true });
      throw err;
    }
    this.writeState('textExportedAt', started.toISOString());
    // The three newest exports are kept (each can be hundreds of megabytes).
    for (const old of this.textShare().exports.slice(3)) rmSync(join(this.exportsFolder(), old.name), { force: true });
    this.log.info({ context: 'magazines' }, `The magazines' text exported: ${rows.length} issues, ${pages} pages (${name})`);
    return { file: name, issues: rows.length, pages, filled: 0, skipped: 0, unmatched: 0, rules: 0 };
  }

  /** Starts reading a friend's text from a zip saved here (deleted afterwards when `removeAfter`): false while a job runs. */
  startTextImport(path: string, opts: { rules: boolean; removeAfter: boolean }, done: () => void = () => undefined): boolean {
    if (this.textJob?.state === 'running') return false;
    const job: TextJob = { kind: 'import', state: 'running', progress: 'Starting', startedAt: new Date().toISOString(), result: null, error: null };
    this.textJob = job;
    void this.importTextZip(path, opts, (line) => (job.progress = line))
      .then((result) => {
        Object.assign(job, { state: 'done', progress: '', result });
        done();
      })
      .catch((err: unknown) => Object.assign(job, { state: 'failed', error: err instanceof Error ? err.message : String(err) }))
      .finally(() => {
        if (opts.removeAfter) rmSync(path, { force: true });
      });
    return true;
  }

  /**
   * A friend's text into the issues that have none (never over text already read): each issue found by its path, else
   * by its magazine's folder and its number and volume, else (no number) its year and month, with the same number of
   * pages. Their answers about the pages' games come too only with `rules`.
   */
  async importTextZip(path: string, opts: { rules: boolean }, progress: (line: string) => void = () => undefined): Promise<TextJobResult> {
    const db = this.store();
    const items = await zipContents(path);
    const manifestItem = items.find((i) => i.name === 'manifest.json');
    if (!manifestItem) throw new Error("This zip isn't a Squirrelcade magazines' text export (it has no manifest.json).");
    const manifest = JSON.parse((await zipRead(path, manifestItem)).toString('utf8')) as TextManifest;
    if (manifest.format !== TEXT_FORMAT) throw new Error("This zip isn't a Squirrelcade magazines' text export.");
    const byDir = new Map<string, ZipItem[]>();
    for (const item of items) {
      const m = /^(.+)\/ocr\/([^/]+)\/(\d+)\.hocr$/i.exec(item.name);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      byDir.set(key, [...(byDir.get(key) ?? []), item]);
    }
    type Local = { id: number; path: string; folder: string; number: string | null; volume: string | null; year: number | null; month: number | null; pages: number; text_state: string };
    const locals = db
      .prepare(
        `SELECT i.id, i.path, m.folder, i.number, i.volume, COALESCE(i.owner_year, i.year) AS year, CASE WHEN i.owner_year IS NOT NULL THEN i.owner_month ELSE i.month END AS month, i.pages, i.text_state
         FROM issues i JOIN magazines m ON m.id = i.magazine_id`,
      )
      .all() as Local[];
    const byPath = new Map(locals.map((l) => [l.path, l]));
    const sameNum = (a: string | null, b: string | null) => (a ?? '').trim().replace(/^0+(?=\d)/, '').toLowerCase() === (b ?? '').trim().replace(/^0+(?=\d)/, '').toLowerCase();
    let filled = 0;
    let skipped = 0;
    let unmatched = 0;
    let since50 = Date.now();
    for (const [k, m] of manifest.issues.entries()) {
      progress(`${m.magazine}: ${basename(m.path)} (${k + 1} of ${manifest.issues.length})`);
      let local = byPath.get(m.path);
      if (!local) {
        const sameMagazine = locals.filter((l) => l.folder === m.folder);
        const found = m.number
          ? sameMagazine.filter((l) => sameNum(l.number, m.number) && sameNum(l.volume, m.volume))
          : sameMagazine.filter((l) => !l.number && l.year === m.year && l.month === m.month && m.year !== null && sameNum(l.volume, m.volume));
        local = found.length === 1 ? found[0] : undefined;
      }
      const files = (byDir.get(`${m.folder}/${m.dir}`) ?? []).sort((a, b) => Number.parseInt(basename(a.name), 10) - Number.parseInt(basename(b.name), 10));
      if (!local || local.pages !== m.pages || files.length === 0) {
        unmatched++;
        continue;
      }
      if (local.text_state !== 'none' && local.text_state !== 'failed') {
        skipped++;
        continue;
      }
      const pages: { n: number; text: string; words: PageWord[] }[] = [];
      for (const f of files) {
        pages.push({ n: Number.parseInt(basename(f.name), 10), ...parseHocr((await zipRead(path, f)).toString('utf8')) });
        if (Date.now() - since50 > 50) {
          await new Promise((resolve) => setImmediate(resolve));
          since50 = Date.now();
        }
      }
      await this.savePages(local.id, pages, 'hocr');
      local.text_state = 'hocr';
      filled++;
    }
    let rules = 0;
    const rulesItem = items.find((i) => i.name === 'rules.json');
    if (opts.rules && rulesItem) {
      const add = db.prepare('INSERT OR IGNORE INTO mention_rules (printed_key, magazine, answer) VALUES (?, ?, ?)');
      for (const r of JSON.parse((await zipRead(path, rulesItem)).toString('utf8')) as { printed_key: string; magazine: string; answer: string }[]) {
        if (typeof r.printed_key === 'string' && typeof r.magazine === 'string' && typeof r.answer === 'string') rules += add.run(r.printed_key, r.magazine, r.answer).changes;
      }
      if (rules > 0) this.setState('rules', String(Number(this.rulesVersion()) + 1));
    }
    this.log.info({ context: 'magazines' }, `A friend's text read: ${filled} issues filled, ${skipped} had text already, ${unmatched} not found here${rules > 0 ? `, ${rules} answers` : ''}`);
    return { file: basename(path), issues: manifest.issues.length, pages: 0, filled, skipped, unmatched, rules };
  }

  // What the pages read.

  magazines(): MagazineView[] {
    if (!this.enabled()) return [];
    return (
      this.store()
        .prepare(
          `SELECT m.id, m.name, m.publisher, COUNT(i.id) AS issues, MIN(COALESCE(i.owner_year, i.year)) AS "from", MAX(COALESCE(i.owner_year, i.year)) AS "to",
             SUM(i.text_state IN ('hocr', 'ocr')) AS withText,
             (SELECT i2.id FROM issues i2 WHERE i2.magazine_id = m.id ORDER BY COALESCE(i2.owner_year, i2.year, 9999), COALESCE(i2.owner_month, i2.month, 0), CAST(i2.number AS INTEGER) LIMIT 1) AS coverIssue
           FROM magazines m JOIN issues i ON i.magazine_id = m.id GROUP BY m.id ORDER BY m.name COLLATE NOCASE`,
        )
        .all() as MagazineView[]
    );
  }

  private view(r: { id: number; magazine_id: number; magazine: string; number: string | null; volume: string | null; year: number | null; month: number | null; owner_year: number | null; owner_month: number | null; date_from: string | null; title: string | null; pages: number; text_state: string; problem: string | null; file_mtime: number }): IssueView {
    const year = r.owner_year ?? r.year;
    const month = r.owner_month ?? r.month;
    return {
      id: r.id,
      magazineId: r.magazine_id,
      magazine: r.magazine,
      label: issueLabel({ magazine: r.magazine, number: r.number, volume: r.volume, year, month }),
      number: r.number,
      volume: r.volume,
      year,
      month,
      title: r.title,
      pages: r.pages,
      needsDate: year === null,
      dateFrom: r.owner_year !== null ? null : (r.date_from as IssueView['dateFrom']),
      pageOffset: (r as { page_offset?: number | null }).page_offset ?? null,
      text: r.text_state as IssueView['text'],
      problem: r.problem,
      version: r.file_mtime,
    };
  }

  private readonly issueQuery = 'SELECT i.*, m.name AS magazine FROM issues i JOIN magazines m ON m.id = i.magazine_id';

  issues(magazineId: number): IssueView[] {
    if (!this.enabled()) return [];
    return (this.store().prepare(`${this.issueQuery} WHERE i.magazine_id = ? ORDER BY COALESCE(i.owner_year, i.year, 9999), COALESCE(i.owner_month, i.month, 0), CAST(i.volume AS INTEGER), CAST(i.number AS INTEGER)`).all(magazineId) as Parameters<MagazineService['view']>[0][]).map((r) => this.view(r));
  }

  issue(id: number): IssueView | null {
    if (!this.enabled()) return null;
    const r = this.store().prepare(`${this.issueQuery} WHERE i.id = ?`).get(id) as Parameters<MagazineService['view']>[0] | undefined;
    return r ? this.view(r) : null;
  }

  /** Name these: the issues without a date, to give one. */
  undated(): IssueView[] {
    if (!this.enabled()) return [];
    return (this.store().prepare(`${this.issueQuery} WHERE COALESCE(i.owner_year, i.year) IS NULL ORDER BY m.name, CAST(i.volume AS INTEGER), CAST(i.number AS INTEGER)`).all() as Parameters<MagazineService['view']>[0][]).map((r) => this.view(r));
  }

  /**
   * The issues on sale in a window of days (D190: Now in and the Time machine): the month an issue was on the
   * newsstand is its cover's month less the magazine's lead (a setting), and it counts when that month overlaps.
   */
  onSale(from: string, to: string): IssueView[] {
    if (!this.enabled()) return [];
    const usual = this.settings.get('magazines.coverLeadMonths');
    const own = this.settings.get('magazines.coverLead');
    const rows = this.store()
      .prepare(`${this.issueQuery} WHERE COALESCE(i.owner_year, i.year) IS NOT NULL AND COALESCE(i.owner_month, i.month) IS NOT NULL`)
      .all() as Parameters<MagazineService['view']>[0][];
    const out: IssueView[] = [];
    for (const r of rows) {
      const year = r.owner_year ?? r.year!;
      const month = (r.owner_year !== null ? r.owner_month : r.month)!;
      const t = year * 12 + (month - 1) - coverLeadFor(r.magazine, usual, own);
      const first = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01`;
      const last = `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-31`;
      if (first <= to && last >= from) out.push(this.view(r));
    }
    return out.sort((a, b) => a.magazine.localeCompare(b.magazine) || (a.year ?? 0) - (b.year ?? 0) || (a.month ?? 0) - (b.month ?? 0));
  }

  /**
   * A review's citation found in the owner's magazines (D191): the magazine its work names, the issue its number or
   * month gives, and the file's page for the printed page it cites (the issue's offset, once the owner set it, else
   * the printed page itself). Null when the owner hasn't that issue.
   */
  findScan(c: { work: string | null; date: string | null; issue: string | null; page: string | null }): { issueId: number; page: number; label: string; offsetKnown: boolean } | null {
    if (!this.enabled() || !c.work) return null;
    const db = this.store();
    const names = (db.prepare('SELECT name FROM magazines').all() as { name: string }[]).map((r) => r.name);
    const name = magazineOf(c.work, names);
    if (!name) return null;
    type Row = Parameters<MagazineService['view']>[0] & { page_offset: number | null };
    const issues = db.prepare(`${this.issueQuery} WHERE m.name = ?`).all(name) as Row[];
    const n = citedIssueNumber(c.issue);
    const when = citationMonth(c.date);
    const byNumber = n !== null ? issues.filter((i) => Number(i.number) === n) : [];
    const byMonth = when?.month ? issues.filter((i) => (i.owner_year ?? i.year) === when.year && (i.owner_year !== null ? i.owner_month : i.month) === when.month) : [];
    // An issue number and the month agreeing is surest; a number alone is ambiguous across volumes (GameFan's).
    const issue = byNumber.find((i) => byMonth.includes(i)) ?? (byNumber.length === 1 ? byNumber[0] : undefined) ?? (byMonth.length === 1 ? byMonth[0] : undefined);
    if (!issue) return null;
    const printed = printedPage(c.page);
    const page = Math.min(Math.max(1, (printed ?? 1) + (issue.page_offset ?? 0)), Math.max(1, issue.pages));
    return { issueId: issue.id, page, label: this.view(issue).label, offsetKnown: issue.page_offset !== null };
  }

  /**
   * In the magazines, seeded from Wikipedia's citations (D191): each printed review of a game Roots has read, found in
   * the owner's issues, kept as a mention of the game on its page (linked: the citation says so). Made again each time
   * (an offset set since moves its page); the owner's own marks and answers are never touched.
   */
  seedCitations(reviews: readonly { platformKey: string; title: string; outlet: string; score: string; work: string | null; date: string | null; issue: string | null; page: string | null }[]): number {
    if (!this.enabled()) return 0;
    const db = this.store();
    const now = new Date().toISOString();
    return db.transaction(() => {
      db.prepare("DELETE FROM mentions WHERE source = 'citation'").run();
      const add = db.prepare(
        "INSERT OR IGNORE INTO mentions (issue_id, page, platform_key, title, title_key, printed, kind, score, source, confidence, state, created_at) VALUES (?, ?, ?, ?, ?, ?, 'review', ?, 'citation', 1, 'linked', ?)",
      );
      let n = 0;
      for (const r of reviews) {
        const scan = this.findScan(r);
        if (!scan) continue;
        n += add.run(scan.issueId, scan.page, r.platformKey, r.title, matchKey(baseTitle(r.title)), r.outlet, r.score || null, now).changes;
      }
      return n;
    })();
  }

  /** A game's mentions in the owner's magazines (D191): linked ones, then the maybes; newest issue last. */
  mentionsOf(title: string): MentionView[] {
    if (!this.enabled()) return [];
    const rows = this.store()
      .prepare(
        `SELECT mn.*, i.pages AS issue_pages, i.file_mtime AS version, mg.name AS magazine FROM mentions mn JOIN issues i ON i.id = mn.issue_id JOIN magazines mg ON mg.id = i.magazine_id
         WHERE mn.title_key = ? AND mn.state IN ('linked', 'suggested') ORDER BY COALESCE(i.owner_year, i.year, 9999), COALESCE(i.owner_month, i.month, 0), mn.page`,
      )
      .all(matchKey(baseTitle(title))) as MentionRow[];
    return this.mentionViews(rows);
  }

  /** Games' reviews in the owner's magazines, by title key (D192: Now in and the Time machine show them), at most three each. */
  reviewsOf(titles: readonly string[]): Map<string, { issueId: number; issue: string; page: number; score: string | null }[]> {
    const out = new Map<string, { issueId: number; issue: string; page: number; score: string | null }[]>();
    if (!this.enabled() || titles.length === 0) return out;
    const keys = [...new Set(titles.map((t) => matchKey(baseTitle(t))))];
    const rows = this.store()
      .prepare(`SELECT title_key, issue_id, page, score FROM mentions WHERE state = 'linked' AND (kind = 'review' OR source = 'citation') AND title_key IN (${keys.map(() => '?').join(',')}) ORDER BY issue_id, page`)
      .all(...keys) as { title_key: string; issue_id: number; page: number; score: string | null }[];
    for (const r of rows) {
      const list = out.get(r.title_key) ?? [];
      if (list.length >= 3) continue;
      list.push({ issueId: r.issue_id, issue: this.issue(r.issue_id)?.label ?? '', page: r.page, score: r.score });
      out.set(r.title_key, list);
    }
    return out;
  }

  /** The games an issue mentions, by page (D191). */
  gamesOn(issueId: number): MentionView[] {
    if (!this.enabled()) return [];
    const rows = this.store()
      .prepare(
        `SELECT mn.*, i.pages AS issue_pages, i.file_mtime AS version, mg.name AS magazine FROM mentions mn JOIN issues i ON i.id = mn.issue_id JOIN magazines mg ON mg.id = i.magazine_id
         WHERE mn.issue_id = ? AND mn.state IN ('linked', 'suggested') ORDER BY mn.page, mn.title`,
      )
      .all(issueId) as MentionRow[];
    return this.mentionViews(rows);
  }

  private mentionViews(rows: MentionRow[]): MentionView[] {
    const labels = new Map<number, string>();
    return rows.map((r) => {
      if (!labels.has(r.issue_id)) labels.set(r.issue_id, this.issue(r.issue_id)?.label ?? r.magazine);
      return {
        id: r.id,
        issueId: r.issue_id,
        issue: labels.get(r.issue_id)!,
        magazine: r.magazine,
        page: r.page,
        version: r.version,
        platformKey: r.platform_key,
        title: r.title,
        printed: r.printed,
        kind: r.kind,
        score: r.score,
        source: r.source as MentionView['source'],
        state: r.state as MentionView['state'],
        confidence: r.confidence,
        box: r.box ? (JSON.parse(r.box) as [number, number, number, number]) : null,
        consoles: r.consoles ? (JSON.parse(r.consoles) as string[]) : [],
      };
    });
  }

  /**
   * The games on the pages with text (D192): each page's words checked for the titles its issue could be about, the
   * owner's rules applied, a game linked at Link games found at, asked about from Ask me about games found at, a
   * review's scores read by the magazine's layout. An issue is spotted again when its text or these settings change.
   */
  async spotGames(candidatesFor: (issue: { magazine: string; year: number; month: number | null }) => SpotCandidate[], progress: (line: string) => void = () => undefined): Promise<string> {
    if (!this.enabled()) return 'Leaves is off';
    const db = this.store();
    const linkAt = this.settings.get('magazines.linkAt');
    const askAt = this.settings.get('magazines.askAt');
    const sig = JSON.stringify([SPOT_VERSION, linkAt, askAt, this.settings.get('magazines.spotYears'), this.settings.get('magazines.makers'), this.rulesVersion()]);
    type Row = Parameters<MagazineService['view']>[0];
    const issues = (db.prepare(`${this.issueQuery} WHERE i.text_state IN ('hocr', 'ocr') AND COALESCE(i.owner_year, i.year) IS NOT NULL`).all() as Row[]).filter(
      (i) => this.stateOf(`spotted:${i.id}`) !== `${sig}|${i.file_mtime}`,
    );
    const rules = this.rules();
    const add = db.prepare(
      "INSERT OR REPLACE INTO mentions (issue_id, page, platform_key, title, title_key, printed, kind, score, source, confidence, state, box, created_at, consoles) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ocr', ?, ?, ?, ?, ?)",
    );
    let linked = 0;
    let asked = 0;
    // The server keeps answering while it looks (It stays snappy): it gives way between pages, at most ~50 ms at a time.
    let since = Date.now();
    const breathe = async () => {
      if (Date.now() - since < 50) return;
      await new Promise((resolve) => setImmediate(resolve));
      since = Date.now();
    };
    // Issues of the same magazine and month share their candidates, made ready once.
    const indexes = new Map<string, ReturnType<typeof spotIndex>>();
    for (const [k, i] of issues.entries()) {
      progress(`${this.view(i).label} (${k + 1} of ${issues.length})`);
      const year = i.owner_year ?? i.year!;
      const month = (i.owner_year !== null ? i.owner_month : i.month) ?? 6;
      const coverDay = `${year}-${String(month).padStart(2, '0')}-01`;
      const windowKey = `${i.magazine}|${coverDay}`;
      let index = indexes.get(windowKey);
      if (!index) {
        if (indexes.size > 24) indexes.clear();
        index = spotIndex(candidatesFor({ magazine: i.magazine, year, month }), coverDay);
        indexes.set(windowKey, index);
        await breathe();
      }
      const pages = db.prepare('SELECT n, text, words FROM pages WHERE issue_id = ?').all(i.id) as { n: number; text: string; words: string }[];
      const spotted = new Map<number, ReturnType<typeof spotTitles>>();
      for (const p of pages) {
        spotted.set(p.n, spotTitles(JSON.parse(p.words) as PageWord[], index, coverDay));
        await breathe();
      }
      const now = new Date().toISOString();
      db.transaction(() => {
        db.prepare("DELETE FROM mentions WHERE issue_id = ? AND source = 'ocr'").run(i.id);
        for (const p of pages) {
          const found = spotted.get(p.n) ?? [];
          const kept: { s: (typeof found)[number]; state: 'linked' | 'suggested' }[] = [];
          for (const f of found) {
            const printedKey = spotWord(f.printed.replace(/\s+/g, ''));
            const rule = rules.get(`${printedKey}|${i.magazine}`) ?? rules.get(`${printedKey}|*`);
            if (rule === 'not' || rule === `notgame:${f.platformKey}|${f.title}`) continue;
            if (rule?.startsWith('game:')) {
              const [pk, ...t] = rule.slice(5).split('|');
              kept.push({ s: { ...f, platformKey: pk!, title: t.join('|'), confidence: 1 }, state: 'linked' });
              continue;
            }
            if (f.confidence >= linkAt) kept.push({ s: f, state: 'linked' });
            else if (f.confidence >= askAt) kept.push({ s: f, state: 'suggested' });
          }
          // The consoles the page names, for the chest on its games (item 11): once a page.
          const named = kept.length > 0 ? JSON.stringify(platformsIn(p.text.replace(/\n+/g, ', '))) : null;
          // A review's scores go to the game it's about: the one linked game, or the one in the biggest type.
          const score = scoresOn(p.text, i.magazine);
          const linkedHere = kept.filter((x) => x.state === 'linked');
          const reviewed = score && linkedHere.length > 0 ? linkedHere.reduce((a, b) => (b.s.box[3] - b.s.box[1] > a.s.box[3] - a.s.box[1] ? b : a)) : null;
          for (const x of kept) {
            add.run(i.id, p.n, x.s.platformKey, x.s.title, matchKey(baseTitle(x.s.title)), x.s.printed, x === reviewed ? 'review' : null, x === reviewed ? score : null, x.s.confidence, x.state, JSON.stringify(x.s.box), now, named);
            if (x.state === 'linked') linked++;
            else asked++;
          }
        }
        this.setState(`spotted:${i.id}`, `${sig}|${i.file_mtime}`);
      })();
      await new Promise((resolve) => setImmediate(resolve));
    }
    return issues.length === 0 ? 'Nothing new to look through' : `${issues.length} issues looked through: ${linked} games linked, ${asked} to answer on Review > Magazines`;
  }

  private stateOf(key: string): string | null {
    return (this.store().prepare('SELECT value FROM state WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null;
  }

  private setState(key: string, value: string): void {
    this.store().prepare('INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
  }

  private rules(): Map<string, string> {
    return new Map((this.store().prepare('SELECT printed_key, magazine, answer FROM mention_rules').all() as { printed_key: string; magazine: string; answer: string }[]).map((r) => [`${r.printed_key}|${r.magazine}`, r.answer]));
  }

  private rulesVersion(): string {
    return this.stateOf('rules') ?? '0';
  }

  /**
   * The owner's answer about a game found on a page (D192): this is it, not this game, another game, or not a game.
   * Each becomes a rule for those printed words (in this magazine, or everywhere), applied to every issue at the next
   * look through; the mention itself is answered at once.
   */
  answer(id: number, a: { answer: 'yes' | 'no' | 'game' | 'not-a-game'; platformKey?: string; title?: string; everywhere?: boolean }): boolean {
    const db = this.store();
    const m = db.prepare('SELECT mn.*, mg.name AS magazine FROM mentions mn JOIN issues i ON i.id = mn.issue_id JOIN magazines mg ON mg.id = i.magazine_id WHERE mn.id = ?').get(id) as
      | (MentionRow & { magazine: string })
      | undefined;
    if (!m) return false;
    const printedKey = spotWord((m.printed ?? m.title).replace(/\s+/g, ''));
    const where = a.everywhere ? '*' : m.magazine;
    const rule = (answer: string) => db.prepare('INSERT INTO mention_rules (printed_key, magazine, answer) VALUES (?, ?, ?) ON CONFLICT(printed_key, magazine) DO UPDATE SET answer = excluded.answer').run(printedKey, where, answer);
    if (a.answer === 'yes') {
      rule(`game:${m.platform_key}|${m.title}`);
      db.prepare("UPDATE mentions SET state = 'linked', confidence = 1 WHERE id = ?").run(id);
    } else if (a.answer === 'game' && a.platformKey && a.title) {
      rule(`game:${a.platformKey}|${a.title}`);
      db.prepare("UPDATE mentions SET state = 'linked', confidence = 1, platform_key = ?, title = ?, title_key = ? WHERE id = ?").run(a.platformKey, a.title, matchKey(baseTitle(a.title)), id);
    } else {
      rule(a.answer === 'no' ? `notgame:${m.platform_key}|${m.title}` : 'not');
      db.prepare('DELETE FROM mentions WHERE id = ?').run(id);
    }
    this.setState('rules', String(Number(this.rulesVersion()) + 1));
    return true;
  }

  /** A game the owner marked on a page by hand (D192: a logo the text doesn't name), with its box. */
  markGame(issueId: number, page: number, g: { platformKey: string; title: string; box: [number, number, number, number] }): MentionView | null {
    const db = this.store();
    if (!db.prepare('SELECT 1 FROM issues WHERE id = ?').get(issueId)) return null;
    const r = db
      .prepare(
        "INSERT OR REPLACE INTO mentions (issue_id, page, platform_key, title, title_key, printed, kind, score, source, confidence, state, box, created_at) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, 'owner', 1, 'linked', ?, ?)",
      )
      .run(issueId, page, g.platformKey, g.title, matchKey(baseTitle(g.title)), JSON.stringify(g.box.map((n) => Math.round(n))), new Date().toISOString());
    return this.gamesOn(issueId).find((m) => m.id === Number(r.lastInsertRowid)) ?? null;
  }

  /** A mention taken off a page (one the owner marked by mistake, or a wrong one). */
  forgetMention(id: number): boolean {
    return this.store().prepare('DELETE FROM mentions WHERE id = ?').run(id).changes > 0;
  }

  /** Review > Magazines (D192): the games found that are maybes, to answer; the surest first. */
  toReview(limit = 200): MentionView[] {
    if (!this.enabled()) return [];
    const rows = this.store()
      .prepare(
        `SELECT mn.*, i.pages AS issue_pages, i.file_mtime AS version, mg.name AS magazine FROM mentions mn JOIN issues i ON i.id = mn.issue_id JOIN magazines mg ON mg.id = i.magazine_id
         WHERE mn.state = 'suggested' ORDER BY mn.confidence DESC, mn.id LIMIT ?`,
      )
      .all(limit) as MentionRow[];
    return this.mentionViews(rows);
  }

  /** The owner says a file page is a printed page ("this is page 28"): the issue's offset (D191). */
  setPageOffset(id: number, filePage: number, printed: number): IssueView | null {
    this.store().prepare('UPDATE issues SET page_offset = ? WHERE id = ?').run(filePage - printed, id);
    return this.issue(id);
  }

  /** The dates Squirrelcade worked out (D181), to check on Name these. */
  guessed(): IssueView[] {
    if (!this.enabled()) return [];
    return (this.store().prepare(`${this.issueQuery} WHERE i.owner_year IS NULL AND i.date_from IS NOT NULL ORDER BY m.name, CAST(i.volume AS INTEGER), CAST(i.number AS INTEGER)`).all() as Parameters<MagazineService['view']>[0][]).map((r) => this.view(r));
  }

  /** The owner's date for an issue (kept over what its file says); the dates worked out from it follow. */
  setDate(id: number, year: number | null, month: number | null): IssueView | null {
    this.store().prepare('UPDATE issues SET owner_year = ?, owner_month = ? WHERE id = ?').run(year, month, id);
    this.fillDates();
    return this.issue(id);
  }

  /**
   * A page's picture (n from 1): as it is in its CBZ, or, asked for a width, made that wide (D182: a step up from it,
   * never wider than the setting or the scan) and kept in magazines-cache, so a phone gets a small page at once.
   */
  async page(id: number, n: number, want = 0): Promise<{ data: Buffer; type: string } | null> {
    const max = this.settings.get('magazines.pageWidth');
    if (want > 0 && max > 0) {
      const row = this.store().prepare('SELECT file_mtime AS version FROM issues WHERE id = ?').get(id) as { version: number } | undefined;
      if (!row) return null;
      const width = Math.min(PAGE_WIDTHS.find((w) => w >= want) ?? PAGE_WIDTHS.at(-1)!, max);
      const file = join(this.cacheDir(), `${id}-${row.version}-${n}-${width}.jpg`);
      try {
        const data = await readFile(file);
        void utimes(file, new Date(), new Date()).catch(() => undefined);
        return { data, type: 'image/jpeg' };
      } catch {
        // Not made yet.
      }
      const original = await this.originalPage(id, n);
      if (!original) return null;
      let data: Buffer;
      try {
        const image = sharp(original.data, { failOn: 'none' });
        const meta = await image.metadata();
        if (!meta.width || meta.width <= width) return original;
        data = await image.rotate().resize({ width }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
      } catch {
        // A picture sharp can't read is sent as it is.
        return original;
      }
      await mkdir(this.cacheDir(), { recursive: true });
      await writeFile(file, data);
      if (++this.made % 50 === 0) void this.pruneCache().catch((err) => this.log.warn({ context: 'magazines', err }, "The magazines' page cache couldn't be trimmed"));
      return { data, type: 'image/jpeg' };
    }
    return this.originalPage(id, n);
  }

  private made = 0;

  private cacheDir(): string {
    return join(this.env.configDir, 'magazines-cache');
  }

  /** The pages made for screens, past their room: the ones used longest ago go. */
  async pruneCache(): Promise<number> {
    const dir = this.cacheDir();
    if (!existsSync(dir)) return 0;
    const files = await Promise.all((await readdir(dir)).map(async (name) => ({ name, ...(await stat(join(dir, name)).then((s) => ({ size: s.size, at: s.mtimeMs }))) })));
    let total = files.reduce((t, f) => t + f.size, 0);
    const room = this.settings.get('magazines.cacheMb') * 1024 * 1024;
    let gone = 0;
    for (const f of files.sort((a, b) => a.at - b.at)) {
      if (total <= room) break;
      await rm(join(dir, f.name), { force: true });
      total -= f.size;
      gone++;
    }
    return gone;
  }

  /** A page's size in its scan (the words' boxes are in its pixels), kept once known. */
  async pageSize(id: number, n: number): Promise<{ width: number; height: number } | null> {
    const row = this.store().prepare('SELECT width, height FROM pages WHERE issue_id = ? AND n = ?').get(id, n) as { width: number | null; height: number | null } | undefined;
    if (row?.width && row.height) return { width: row.width, height: row.height };
    const original = await this.originalPage(id, n);
    if (!original) return null;
    const meta = await sharp(original.data, { failOn: 'none' })
      .metadata()
      .catch(() => null);
    if (!meta?.width || !meta.height) return null;
    if (row) this.store().prepare('UPDATE pages SET width = ?, height = ? WHERE issue_id = ? AND n = ?').run(meta.width, meta.height, id, n);
    return { width: meta.width, height: meta.height };
  }

  /** A page's picture, as it is in its CBZ (n from 1). */
  private async originalPage(id: number, n: number): Promise<{ data: Buffer; type: string } | null> {
    const root = this.folder();
    const row = this.store().prepare('SELECT path FROM issues WHERE id = ?').get(id) as { path: string } | undefined;
    if (!root || !row) return null;
    const items = await this.pageItems(join(root, row.path));
    const item = items[n - 1];
    if (!item) return null;
    const ext = item.name.split('.').pop()!.toLowerCase();
    return { data: await zipRead(join(root, row.path), item), type: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg' };
  }

  /** A page's words with their boxes (for the reader's highlights), when it has text. */
  pageWords(id: number, n: number): PageWord[] {
    const row = this.store().prepare('SELECT words FROM pages WHERE issue_id = ? AND n = ?').get(id, n) as { words: string } | undefined;
    return row ? (JSON.parse(row.words) as PageWord[]) : [];
  }

  /**
   * Search magazines: the pages whose text has every word (or the phrase, in quotes), best first, with the words
   * marked in a snippet; only one magazine's, or a span of years, when asked.
   */
  search(q: string, options: { magazineId?: number; from?: number; to?: number; limit?: number } = {}): PageHit[] {
    if (!this.enabled()) return [];
    const words = q.match(/"[^"]+"|\S+/g) ?? [];
    const match = words.map((w) => (w.startsWith('"') ? `"${w.slice(1, -1).replace(/"/g, '')}"` : `"${w.replace(/"/g, '')}"`)).join(' ');
    if (!match) return [];
    const rows = this.store()
      .prepare(
        `SELECT f.issue_id AS issueId, f.n AS page, snippet(pages_fts, 0, '[', ']', '…', 16) AS snippet
         FROM pages_fts f JOIN issues i ON i.id = f.issue_id
         WHERE pages_fts MATCH ? AND (? IS NULL OR i.magazine_id = ?) AND (? IS NULL OR COALESCE(i.owner_year, i.year) >= ?) AND (? IS NULL OR COALESCE(i.owner_year, i.year) <= ?)
         ORDER BY rank LIMIT ?`,
      )
      .all(match, options.magazineId ?? null, options.magazineId ?? null, options.from ?? null, options.from ?? null, options.to ?? null, options.to ?? null, options.limit ?? 50) as { issueId: number; page: number; snippet: string }[];
    return rows.map((r) => ({ ...r, label: this.issue(r.issueId)?.label ?? '' }));
  }

  /** What Settings > Magazines and Leaves say of the library and its reading. */
  status(): { folder: string | null; found: boolean; issues: number; withText: number; failed: number; estimate: { perIssueSeconds: number; issuesLeft: number; hoursLeft: number } | null } {
    const folder = this.folder();
    if (!this.enabled()) return { folder, found: false, issues: 0, withText: 0, failed: 0, estimate: null };
    const c = this.store().prepare("SELECT COUNT(*) AS issues, SUM(text_state IN ('hocr', 'ocr')) AS withText, SUM(text_state = 'failed') AS failed FROM issues").get() as { issues: number; withText: number | null; failed: number | null };
    const e = this.readState('ocrEstimate');
    return { folder, found: Boolean(folder && existsSync(folder)), issues: c.issues, withText: c.withText ?? 0, failed: c.failed ?? 0, estimate: e ? (JSON.parse(e) as { perIssueSeconds: number; issuesLeft: number; hoursLeft: number }) : null };
  }
}

export function registerMagazineRoutes(
  app: FastifyInstance,
  magazines: MagazineService,
  tasks: { enqueue: (name: string) => boolean },
  answerOf: (m: { platformKey: string | null; title: string }) => Record<string, unknown> = () => ({}),
): void {
  const off = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => reply.code(404).send({ error: 'off', message: 'Leaves is off (Settings > Features).' });
  // D209: the read text shared with a friend who has the same scans: the owner's only (never a viewer's).
  const ownerOnly = (request: FastifyRequest, reply: FastifyReply) => (isViewer(request) ? reply.code(403).send({ error: 'forbidden', message: 'Only the owner shares the magazines\' text.' }) : null);
  app.get('/api/v1/magazines/text', async (request, reply) => {
    if (!magazines.enabled()) return off(reply);
    return ownerOnly(request, reply) ?? magazines.textShare();
  });
  app.post('/api/v1/magazines/text/export', async (request, reply) => {
    if (!magazines.enabled()) return off(reply);
    if (ownerOnly(request, reply)) return reply;
    const since = String((request.body as { since?: unknown } | null)?.since ?? 'all');
    if (!(since === 'all' || since === 'last' || /^\d{4}-\d{2}-\d{2}$/.test(since))) return reply.code(400).send({ error: 'invalid', message: "since is 'all', 'last' or a day (YYYY-MM-DD)." });
    if (!magazines.startTextExport(since)) return reply.code(409).send({ error: 'busy', message: 'An export or import of the text is running: wait for it to finish.' });
    return reply.code(202).send(magazines.textShare());
  });
  app.get('/api/v1/magazines/text/exports/:name', async (request, reply) => {
    if (!magazines.enabled()) return off(reply);
    if (ownerOnly(request, reply)) return reply;
    const { name } = request.params as { name: string };
    const path = join(magazines.exportsFolder(), name);
    if (!TEXT_EXPORT.test(name) || !existsSync(path)) return reply.code(404).send({ error: 'not-found', message: 'No such export.' });
    return reply.header('content-type', 'application/zip').header('content-disposition', `attachment; filename="${name}"`).header('content-length', statSync(path).size).send(createReadStream(path));
  });
  // A friend's export, uploaded (it can be hundreds of megabytes): saved, read in the background, then deleted.
  app.post('/api/v1/magazines/text/import', async (request, reply) => {
    if (!magazines.enabled()) return off(reply);
    if (ownerOnly(request, reply)) return reply;
    const file = await request.file({ limits: { fileSize: 16 * 1024 ** 3 } });
    if (!file) return reply.code(400).send({ error: 'invalid', message: 'Send the export (a zip).' });
    const rules = (file.fields.rules as { value?: unknown } | undefined)?.value === 'true';
    mkdirSync(magazines.exportsFolder(), { recursive: true });
    const path = join(magazines.exportsFolder(), `incoming-${Date.now()}.zip`);
    await pipeline(file.file, createWriteStream(path));
    if (file.file.truncated) {
      rmSync(path, { force: true });
      return reply.code(413).send({ error: 'too-large', message: 'That file is too big.' });
    }
    if (!magazines.startTextImport(path, { rules, removeAfter: true }, () => tasks.enqueue('magazines-games'))) {
      rmSync(path, { force: true });
      return reply.code(409).send({ error: 'busy', message: 'An export or import of the text is running: wait for it to finish.' });
    }
    return reply.code(202).send(magazines.textShare());
  });
  app.get('/api/v1/magazines', async (_request, reply) => (magazines.enabled() ? { magazines: magazines.magazines(), status: magazines.status() } : off(reply)));
  app.get('/api/v1/magazines/undated', async (_request, reply) => (magazines.enabled() ? { issues: magazines.undated(), guessed: magazines.guessed() } : off(reply)));
  app.get('/api/v1/magazines/search', async (request, reply) => {
    if (!magazines.enabled()) return off(reply);
    const q = request.query as { q?: string; magazine?: string; from?: string; to?: string };
    const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
    return { hits: magazines.search(String(q.q ?? '').slice(0, 200), { magazineId: num(q.magazine), from: num(q.from), to: num(q.to) }) };
  });
  app.post('/api/v1/magazines/scan', async (_request, reply) => (magazines.enabled() ? { queued: tasks.enqueue('magazines-scan') } : off(reply)));
  app.get('/api/v1/magazines/:id', async (request, reply) => (magazines.enabled() ? { issues: magazines.issues(Number((request.params as { id: string }).id)) } : off(reply)));
  app.get('/api/v1/magazines/issues/:id', async (request, reply) => magazines.issue(Number((request.params as { id: string }).id)) ?? reply.code(404).send({ error: 'not-found', message: 'No such issue.' }));
  app.put('/api/v1/magazines/issues/:id', async (request, reply) => {
    const b = (request.body ?? {}) as { year?: unknown; month?: unknown };
    const year = typeof b.year === 'number' && b.year >= 1950 && b.year <= 2100 ? Math.round(b.year) : null;
    const month = typeof b.month === 'number' && b.month >= 1 && b.month <= 12 ? Math.round(b.month) : null;
    return magazines.setDate(Number((request.params as { id: string }).id), year, month) ?? reply.code(404).send({ error: 'not-found', message: 'No such issue.' });
  });
  // In the magazines (D191): a game's mentions, and an issue's games.
  app.get('/api/v1/game/magazines', async (request, reply) => {
    const { title } = request.query as { title?: string };
    if (!title?.trim()) return reply.code(400).send({ error: 'invalid', message: 'Give a title.' });
    return { mentions: magazines.mentionsOf(title.trim()) };
  });
  // A whole issue's games, or the maybes to review: without each one's full answer (a lookup each made a long list
  // slow); the page answers have-it from the owned-consoles map it already has.
  app.get('/api/v1/magazines/issues/:id/games', async (request) => ({ games: magazines.gamesOn(Number((request.params as { id: string }).id)) }));
  // A page's games (D192), with the scan's size their boxes are in, and each one's answer (have it, wishlist...).
  app.get('/api/v1/magazines/issues/:id/pages/:n/games', async (request) => {
    const { id, n } = request.params as { id: string; n: string };
    const games = magazines.gamesOn(Number(id)).filter((m) => m.page === Number(n));
    // The scan's size, which the boxes are in (and a box drawn by hand is turned into).
    const size = await magazines.pageSize(Number(id), Number(n));
    return { width: size?.width ?? null, height: size?.height ?? null, games: games.map((m) => ({ ...m, ...answerOf(m) })) };
  });
  app.post('/api/v1/magazines/issues/:id/pages/:n/mentions', async (request, reply) => {
    const { id, n } = request.params as { id: string; n: string };
    const b = (request.body ?? {}) as { platformKey?: unknown; title?: unknown; box?: unknown };
    const box = Array.isArray(b.box) && b.box.length === 4 && b.box.every((x) => typeof x === 'number' && x >= 0) ? (b.box as [number, number, number, number]) : null;
    if (typeof b.platformKey !== 'string' || typeof b.title !== 'string' || !b.title.trim() || !box) return reply.code(400).send({ error: 'invalid', message: 'Give the game (its console and title) and its box on the page.' });
    return magazines.markGame(Number(id), Number(n), { platformKey: b.platformKey, title: b.title.trim(), box }) ?? reply.code(404).send({ error: 'not-found', message: 'No such issue.' });
  });
  app.post('/api/v1/magazines/mentions/:id/answer', async (request, reply) => {
    const b = (request.body ?? {}) as { answer?: unknown; platformKey?: unknown; title?: unknown; everywhere?: unknown };
    if (!['yes', 'no', 'game', 'not-a-game'].includes(String(b.answer))) return reply.code(400).send({ error: 'invalid', message: 'Answer yes, no, game or not-a-game.' });
    const done = magazines.answer(Number((request.params as { id: string }).id), {
      answer: b.answer as 'yes',
      platformKey: typeof b.platformKey === 'string' ? b.platformKey : undefined,
      title: typeof b.title === 'string' ? b.title : undefined,
      everywhere: b.everywhere === true,
    });
    return done ? { ok: true } : reply.code(404).send({ error: 'not-found', message: 'No such game on a page.' });
  });
  app.delete('/api/v1/magazines/mentions/:id', async (request) => ({ removed: magazines.forgetMention(Number((request.params as { id: string }).id)) }));
  app.get('/api/v1/magazines/review', async () => ({ mentions: magazines.toReview() }));
  // "This is page 28" (D191): the issue's printed page numbers from here on.
  app.put('/api/v1/magazines/issues/:id/page-offset', async (request, reply) => {
    const b = (request.body ?? {}) as { filePage?: unknown; printed?: unknown };
    if (typeof b.filePage !== 'number' || typeof b.printed !== 'number' || b.filePage < 1 || b.printed < -20 || b.printed > 2000) return reply.code(400).send({ error: 'invalid', message: 'Give the page in the file and the number printed on it.' });
    return magazines.setPageOffset(Number((request.params as { id: string }).id), Math.round(b.filePage), Math.round(b.printed)) ?? reply.code(404).send({ error: 'not-found', message: 'No such issue.' });
  });
  // A page's picture: the same bytes as long as its file stays the same, so the browser keeps it.
  app.get('/api/v1/magazines/issues/:id/pages/:n', async (request, reply) => {
    const { id, n } = request.params as { id: string; n: string };
    // ?w=: as wide as the screen needs (D182); without it, the page as it is in its scan.
    const w = Number((request.query as { w?: string }).w ?? 0);
    const page = await magazines.page(Number(id), Number(n), Number.isFinite(w) && w > 0 ? Math.min(Math.round(w), 8000) : 0);
    if (!page) return reply.code(404).send({ error: 'not-found', message: 'No such page.' });
    return reply.header('Content-Type', page.type).header('Cache-Control', 'private, max-age=604800').send(page.data);
  });
  app.get('/api/v1/magazines/issues/:id/pages/:n/words', async (request) => {
    const { id, n } = request.params as { id: string; n: string };
    const words = magazines.pageWords(Number(id), Number(n));
    // The scan's own size, which the boxes are in (a page sent smaller is scaled to it).
    const size = words.length > 0 ? await magazines.pageSize(Number(id), Number(n)) : null;
    return { words, width: size?.width ?? null, height: size?.height ?? null };
  });
}
