import type { TargetStatus } from './catalog.js';
import { csvDelimiter, parseCsv } from './csv.js';
import { pageTables, wikiDate } from './wikipedia.js';

/** A game on a console list the user provides (the top layer of the console's catalog). */
export interface ListEntry {
  title: string;
  altTitles?: string[];
  releaseDate?: string | null;
  region?: string;
  targetStatus?: TargetStatus;
  format?: string | null;
  notes?: string | null;
}

const COLUMNS: Record<keyof ListEntry, RegExp> = {
  title: /^(title|canonical title|game|game title|name|product name|product-name)$/,
  altTitles: /^(also known as|aka|other names?|alternate titles?|alt titles?|alternative names?|source titles?)$/,
  releaseDate: /^(release date|released|date|first released|release|date released|release dates|((standard|original|first|north american|na|us) )?(edition )?release dates?( ?\(s\))?)$/,
  region: /^(region|release region)$/,
  targetStatus: /^(status|target status|target)$/,
  format: /^(format|physical format|media)$/,
  notes: /^(notes?|comments?)$/,
};

const STATUS_WORDS: [RegExp, TargetStatus][] = [
  [/^(required|current|yes|y|target|collect|want|x|upcoming|announced|pre-?order|coming soon)$/, 'required'],
  [/^(optional|maybe|nice to have)$/, 'optional'],
  [/^(review|check|unsure|\?)$/, 'review'],
  [/^(unconfirmed|not confirmed|not confirmed physical)$/, 'unconfirmed'],
  [/^(excluded|exclude|not required|no|n|skip|ignore|not a target)$/, 'excluded'],
];

function region(text: string): string | undefined {
  const t = text.trim().toLowerCase();
  if (!t) return undefined;
  if (/^(na|n\. ?america|north america|us|usa|us\/canada|united states|ntsc-u|ntsc u\/c)$/.test(t)) return 'north-america';
  if (/^(pal|eu|europe|uk|pal region)$/.test(t) || t.includes('europe')) return 'europe';
  if (/^(jp|jpn|ntsc-j)$/.test(t) || t.includes('japan')) return 'japan';
  return 'other';
}

/** Whether a row is a list's header: it names a title column (Title, Game, Name...). */
const isHeader = (r: readonly string[]) => r.some((c) => COLUMNS.title.test(c.trim().toLowerCase()));

/**
 * Reads a console list from CSV: a header row naming a title column (Title, Game, Name...), and
 * optionally other names, release date, region, status, format and notes. Status words such as
 * Required, Current, Upcoming, Review, Excluded or "Not required" are understood; anything else counts as required.
 */
export function parseCatalogList(text: string): { entries: ListEntry[]; problems: string[] } {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const headerAt = rows.findIndex(isHeader);
  if (headerAt < 0) return { entries: [], problems: ['No title column: the first row needs a column named Title (or Game, or Name).'] };
  const { entries, unknownStatus } = readRows(rows[headerAt]!, rows.slice(headerAt + 1));
  const problems: string[] = [];
  if (entries.length === 0) problems.push('The list has no games under its title column.');
  if (unknownStatus > 0) problems.push(`${unknownStatus} status value(s) weren't recognized; those games count as required.`);
  return { entries, problems };
}

/** A list's games from its header row and the rows under it (one game a row; a title and region given twice counts once). */
function readRows(headerRow: readonly string[], rows: readonly string[][]): { entries: ListEntry[]; unknownStatus: number } {
  const header = headerRow.map((c) => c.trim().toLowerCase());
  const col = (field: keyof ListEntry) => header.findIndex((h) => COLUMNS[field].test(h));
  const at = { title: col('title'), altTitles: col('altTitles'), releaseDate: col('releaseDate'), region: col('region'), targetStatus: col('targetStatus'), format: col('format'), notes: col('notes') };
  const entries: ListEntry[] = [];
  const seen = new Set<string>();
  let unknownStatus = 0;
  for (const r of rows) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const title = cell(at.title);
    if (!title) continue;
    const e: ListEntry = { title };
    const alt = cell(at.altTitles)
      .split(/[;|]/)
      .map((t) => t.trim())
      .filter((t) => t && t !== title);
    if (alt.length > 0) e.altTitles = alt;
    const date = cell(at.releaseDate);
    // A date, or a word for one not set yet ("TBA"); anything else in the column (a format, a note) isn't a date.
    const when = wikiDate(date) ?? (/^(tba|tbd|tbc|to be announced|to be determined|coming soon|upcoming|announced)$/i.test(date) ? date : null);
    if (when) e.releaseDate = when;
    const reg = region(cell(at.region));
    if (reg) e.region = reg;
    const statusText = cell(at.targetStatus).toLowerCase();
    if (statusText) {
      const status = STATUS_WORDS.find(([re]) => re.test(statusText))?.[1];
      if (status) e.targetStatus = status;
      else unknownStatus++;
    }
    if (cell(at.format)) e.format = cell(at.format);
    if (cell(at.notes)) e.notes = cell(at.notes).slice(0, 500);
    const key = `${title.toLowerCase()}|${e.region ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(e);
  }
  return { entries, unknownStatus };
}

/**
 * Where to download an online list: a Google Sheets link becomes the sheet's CSV (the sheet must be shared with
 * anyone who has the link, or published); any other address is used as given.
 */
export function listDownloadUrl(url: string): string {
  if (/[?&](format|output)=csv/.test(url)) return url;
  // A sheet published to the web (".../d/e/2PACX-.../pubhtml").
  if (/^https:\/\/docs\.google\.com\/spreadsheets\/d\/e\//.test(url)) {
    const u = new URL(url);
    u.pathname = u.pathname.replace(/\/pub(html)?$/, '/pub');
    u.searchParams.set('output', 'csv');
    u.hash = '';
    return u.toString();
  }
  const sheet = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/.exec(url);
  if (!sheet) return url;
  const gid = /[#?&]gid=(\d+)/.exec(url)?.[1];
  return `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`;
}

/**
 * A downloaded list's rows: a CSV (comma, semicolon or tab separated), or a web page's tables that have a
 * title column, joined when they share their columns (a list split into a table per letter). Null for a page
 * with no such table.
 */
export function listRows(body: string, contentType = '', platforms: readonly { key: string; name: string; labels?: readonly string[] }[] = []): { rows: string[][]; from: 'csv' | 'page' } | null {
  if (!/html|xml/i.test(contentType) && !/^\s*</.test(body)) return { rows: parseCsv(body, csvDelimiter(body)), from: 'csv' };
  const tables = pageTables(body)
    .filter((t) => t.rows.slice(0, 3).some(isHeader))
    .map((t) => {
      // A page with a table for each console, the console in the heading over it (as Wikipedia's page of Super Rare
      // Games' releases has): the table's rows get a Platform column with that heading.
      const at = t.rows.findIndex(isHeader);
      const heading = t.section
        .split(' > ')
        .reverse()
        .find((h) => platformInText(h, platforms));
      if (!heading || t.rows[at]!.some((c) => CONSOLE_COLUMN.test(c.trim().toLowerCase()))) return t.rows;
      return t.rows.map((r, i) => (i < at ? r : [...r, i === at ? 'Platform' : heading]));
    });
  if (tables.length === 0) return null;
  const headerOf = (t: string[][]) => t.find(isHeader)!.map((c) => c.trim().toLowerCase()).join('|');
  const groups = new Map<string, string[][][]>();
  for (const t of tables) groups.set(headerOf(t), [...(groups.get(headerOf(t)) ?? []), t]);
  const size = (g: string[][][]) => g.reduce((n, t) => n + t.length, 0);
  const best = [...groups.values()].sort((a, b) => size(b) - size(a))[0]!;
  const rows = [...best[0]!];
  for (const t of best.slice(1)) rows.push(...t.slice(t.findIndex(isHeader) + 1));
  return { rows, from: 'page' };
}

const CONSOLE_COLUMN = /^(platforms?|consoles?|systems?)( ?\(s\))?$/;

/** The console a line of a cell names in parentheses at its end ("105 (PS4)"), with the line's text before it. */
function consoleLine(line: string, platforms: readonly { key: string; name: string; labels?: readonly string[] }[]): { key: string; text: string } | null {
  const m = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(line.trim());
  const key = m ? platformInText(m[2]!, platforms) : null;
  return key ? { key, text: m![1]! } : null;
}

/**
 * A list without a console column whose rows name their consoles on the lines of a cell ("105 (PS4)", "054 (Switch)",
 * as Wikipedia's list of Limited Run Games' releases does): each row becomes one for each console, with a Platform
 * column, and a cell's lines for other consoles left out ("November 17, 2017 (PS4)" is the PS4 row's date). Null when
 * no column names consoles so in at least half the rows.
 */
function rowsByConsoleLines(header: readonly string[], rows: readonly string[][], platforms: readonly { key: string; name: string; labels?: readonly string[] }[]): { header: string[]; rows: string[][] } | null {
  const titleAt = header.findIndex((h) => COLUMNS.title.test(h.trim().toLowerCase()));
  const named = (cell: string | undefined) => (cell ?? '').split('\n').some((l) => consoleLine(l, platforms));
  let best = -1;
  let most = 0;
  header.forEach((_, i) => {
    const n = i === titleAt ? 0 : rows.filter((r) => named(r[i])).length;
    if (n > most) [best, most] = [i, n];
  });
  if (best < 0 || most < rows.length / 2) return null;
  const out: string[][] = [];
  for (const r of rows) {
    const keys = [...new Set((r[best] ?? '').split('\n').flatMap((l) => consoleLine(l, platforms)?.key ?? []))];
    if (keys.length === 0) out.push([...r, '']);
    for (const key of keys) {
      const cells = r.map((cell, i) => {
        if (i === titleAt) return cell;
        const lines = cell.split('\n').map((l) => ({ line: l, named: consoleLine(l, platforms) }));
        const mine = lines.find((l) => l.named?.key === key);
        if (mine) return mine.named!.text;
        // Lines all for other consoles: nothing for this one; lines naming no console are for every console.
        return lines.every((l) => l.named) ? '' : cell;
      });
      out.push([...cells, platforms.find((p) => p.key === key)?.name ?? key]);
    }
  }
  return { header: [...header, 'Platform'], rows: out };
}

/** A list that may cover several consoles, as an added catalog source reads it. */
export interface SourceList {
  /** Its games by console key. */
  games: Record<string, ListEntry[]>;
  /** Values of its console column that name no console Squirrelcade knows, with their games. */
  unknown: { name: string; games: number }[];
  /** Whether it has a console column (Platform, Console or System). */
  consoleColumn: boolean;
  /** The columns it's read by, named as in the list. */
  columns: string[];
  problems: string[];
}

/**
 * Reads a list that may cover several consoles (a catalog source the user adds): each row's console from its
 * Platform (Console, System) column, else every game for the console given. Its other columns are a console
 * list's (parseCatalogList).
 */
export function readSourceList(rows: readonly string[][], platforms: readonly { key: string; name: string; labels?: readonly string[] }[], platform: string | null): SourceList {
  const filled = rows.filter((r) => r.some((c) => c.trim()));
  const headerAt = filled.findIndex(isHeader);
  if (headerAt < 0) return { games: {}, unknown: [], consoleColumn: false, columns: [], problems: ['No title column: the list needs a column named Title (or Game, or Name).'] };
  let header = filled[headerAt]!;
  let body = filled.slice(headerAt + 1);
  let consoleAt = header.findIndex((h) => CONSOLE_COLUMN.test(h.trim().toLowerCase()));
  const byLines = consoleAt < 0 ? rowsByConsoleLines(header, body, platforms) : null;
  if (byLines) {
    ({ header, rows: body } = byLines);
    consoleAt = header.length - 1;
  }
  const lower = header.map((c) => c.trim().toLowerCase());
  const columns = header.filter((_, i) => i === consoleAt || Object.values(COLUMNS).some((re) => re.test(lower[i]!))).map((c) => c.trim());
  const groups = new Map<string, string[][]>();
  const add = (key: string, r: string[]) => (groups.get(key) ?? groups.set(key, []).get(key)!).push(r);
  const unknown = new Map<string, number>();
  const keyOf = new Map<string, string | null>();
  for (const r of body) {
    const value = consoleAt >= 0 ? (r[consoleAt] ?? '').trim() : '';
    if (!value) {
      if (platform) add(platform, r);
      else if (consoleAt >= 0) unknown.set('(no console)', (unknown.get('(no console)') ?? 0) + 1);
      continue;
    }
    if (!keyOf.has(value)) keyOf.set(value, platformInText(value, platforms));
    const key = keyOf.get(value);
    if (key) add(key, r);
    else unknown.set(value, (unknown.get(value) ?? 0) + 1);
  }
  const games: Record<string, ListEntry[]> = {};
  let unknownStatus = 0;
  for (const [key, list] of groups) {
    const read = readRows(header, list);
    if (read.entries.length > 0) games[key] = read.entries;
    unknownStatus += read.unknownStatus;
  }
  const problems: string[] = [];
  if (consoleAt < 0 && !platform) problems.push('It has no console column (Platform, Console or System): choose the console it is for.');
  else if (Object.keys(games).length === 0) problems.push(unknown.size > 0 ? "None of its consoles is one Squirrelcade knows." : 'It has no games under its title column.');
  if (unknownStatus > 0) problems.push(`${unknownStatus} status value(s) weren't recognized; those games count as required.`);
  return { games, unknown: [...unknown].map(([name, n]) => ({ name, games: n })).sort((a, b) => b.games - a.games), consoleColumn: consoleAt >= 0, columns, problems };
}

/** What an added source's list has, for its preview: games by console and by region, and the years of its dates. */
export interface SourceListSummary {
  games: number;
  consoles: { key: string; games: number }[];
  /** Games by region (north-america, europe, japan, other), and those it gives none for (none). */
  regions: Record<string, number>;
  years: { from: number; to: number } | null;
}

export function summarizeSourceList(games: Record<string, readonly ListEntry[]>): SourceListSummary {
  const regions: Record<string, number> = {};
  let from = Infinity;
  let to = -Infinity;
  for (const e of Object.values(games).flat()) {
    regions[e.region ?? 'none'] = (regions[e.region ?? 'none'] ?? 0) + 1;
    const year = Number(/^(\d{4})-/.exec(e.releaseDate ?? '')?.[1]);
    if (year) {
      from = Math.min(from, year);
      to = Math.max(to, year);
    }
  }
  return {
    games: Object.values(games).reduce((n, l) => n + l.length, 0),
    consoles: Object.entries(games)
      .map(([key, l]) => ({ key, games: l.length }))
      .sort((a, b) => b.games - a.games),
    regions,
    years: Number.isFinite(from) ? { from, to } : null,
  };
}

/** An owned title that counts as a catalog game: a compilation, another name, a package or an edition. */
export interface MappingEntry {
  ownedTitle: string;
  satisfies: string;
  type: string;
  /** yes: owning it counts; conditional: it depends on the copy (a question for review); no: it doesn't count. */
  counts: 'yes' | 'conditional' | 'no';
  notes?: string;
}

const MAPPING_COLUMNS = {
  ownedTitle: /^(owned physical title|owned title|owned|owned game|you own)$/,
  satisfies: /^(satisfies canonical title|satisfies|satisfies title|counts as|catalog title|catalog game)$/,
  type: /^(mapping type|type|kind)$/,
  counts: /^(counts as complete|counts|counts as owned)$/,
  notes: /^(notes?|comments?)$/,
};

/**
 * Reads a console's ownership mappings from CSV, as the old workbook's Ownership Mappings tabs
 * have them: an owned title column (Owned Physical Title, or Owned) and the catalog game it counts
 * as (Satisfies Canonical Title, or Counts as), optionally a type, whether it counts (Yes,
 * Conditional or No; Yes when left out) and notes.
 */
export function parseOwnershipMappings(text: string): { mappings: MappingEntry[]; problems: string[] } {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const header = (r: string[]) => r.map((c) => c.trim().toLowerCase());
  const headerAt = rows.findIndex((r) => header(r).some((h) => MAPPING_COLUMNS.ownedTitle.test(h)) && header(r).some((h) => MAPPING_COLUMNS.satisfies.test(h)));
  if (headerAt < 0) return { mappings: [], problems: ['No mapping columns: the first row needs an owned title column (Owned Physical Title, or Owned) and a Satisfies Canonical Title (or Counts as) column.'] };
  const h = header(rows[headerAt]!);
  const col = (field: keyof typeof MAPPING_COLUMNS) => h.findIndex((x) => MAPPING_COLUMNS[field].test(x));
  const at = { ownedTitle: col('ownedTitle'), satisfies: col('satisfies'), type: col('type'), counts: col('counts'), notes: col('notes') };
  const mappings: MappingEntry[] = [];
  const seen = new Set<string>();
  let unknownCounts = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const ownedTitle = cell(at.ownedTitle);
    const satisfies = cell(at.satisfies);
    if (!ownedTitle || !satisfies) continue;
    const countsText = cell(at.counts).toLowerCase();
    const counts = /^(|yes|y|true|1|counts)$/.test(countsText) ? 'yes' : /^(conditional|partly|partial|sometimes|maybe|review)$/.test(countsText) ? 'conditional' : /^(no|n|false|0)$/.test(countsText) ? 'no' : null;
    if (counts === null) unknownCounts++;
    const key = `${ownedTitle.toLowerCase()}|${satisfies.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const m: MappingEntry = { ownedTitle, satisfies, type: cell(at.type) || 'Mapping', counts: counts ?? 'yes' };
    if (cell(at.notes)) m.notes = cell(at.notes).slice(0, 500);
    mappings.push(m);
  }
  const problems: string[] = [];
  if (mappings.length === 0) problems.push('The file has no mappings under its columns.');
  if (unknownCounts > 0) problems.push(`${unknownCounts} "counts" value(s) weren't recognized; those mappings count.`);
  return { mappings, problems };
}

/** Short names consoles go by, for recognizing which console a list is for. */
const NICKNAMES: Record<string, string[]> = {
  'nintendo-entertainment-system': ['nes', 'famicom'],
  'super-nintendo': ['snes', 'super famicom', 'super nes'],
  'nintendo-64': ['n64'],
  'nintendo-gamecube': ['gamecube', 'gcn', 'gc'],
  'game-boy': ['gb'],
  'game-boy-color': ['gbc'],
  'game-boy-advance': ['gba'],
  'nintendo-3ds': ['3ds'],
  'nintendo-ds': ['nds'],
  // "Switch" alone is the first Switch ("Nintendo Switch 2" is longer, so it wins for the second).
  'nintendo-switch': ['nsw', 'switch'],
  playstation: ['ps1', 'psx', 'psone'],
  'playstation-2': ['ps2'],
  'playstation-3': ['ps3'],
  // PlayStation VR games are PlayStation 4 games, VR2 games PlayStation 5 games.
  'playstation-4': ['ps4', 'ps 4', 'psvr', 'ps vr'],
  'playstation-5': ['ps5', 'ps 5', 'psvr2', 'ps vr2'],
  'playstation-vita': ['ps vita', 'vita', 'psv'],
  'xbox-360': ['x360'],
  'xbox-one': ['xb1', 'xbo'],
  'xbox-series-x': ['series x', 'xbox series x s', 'series x s', 'xsx', 'xbox series'],
  'turbografx-16': ['turbografx', 'tg16', 'tg 16'],
  'atari-2600': ['2600'],
  'sega-genesis': ['genesis', 'mega drive'],
  'sega-saturn': ['saturn'],
  'sega-dreamcast': ['dreamcast'],
  'magnavox-odyssey-2': ['odyssey 2', 'odyssey2'],
};

const words = (text: string) => ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** The platform whose name, PriceCharting name or nickname appears in the text; the longest name wins ("PlayStation 3" over "PlayStation"). */
export function platformInText(text: string, platforms: readonly { key: string; name: string; labels?: readonly string[] }[]): string | null {
  const t = words(text);
  let best: { key: string; length: number } | null = null;
  for (const p of platforms) {
    for (const name of [p.name, ...(p.labels ?? []), ...(NICKNAMES[p.key] ?? [])]) {
      const w = words(name);
      if (w.trim() && t.includes(w) && (!best || w.length > best.length)) best = { key: p.key, length: w.length };
    }
  }
  return best?.key ?? null;
}

/**
 * Which console a list is for: from its Platform (or Console) column, as the old workbook's
 * Master Catalog tabs have, else from its file name ("PS3 Master Catalog.csv"). Null when unsure.
 */
export function listPlatform(fileName: string, text: string, platforms: readonly { key: string; name: string; labels?: readonly string[] }[]): string | null {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const headerAt = rows.findIndex((r) => r.some((c) => COLUMNS.title.test(c.trim().toLowerCase())));
  const header = headerAt >= 0 ? rows[headerAt]!.map((c) => c.trim().toLowerCase()) : [];
  const at = header.findIndex((h) => /^(platform|console|system)$/.test(h));
  if (at >= 0) {
    const counts = new Map<string, number>();
    for (const r of rows.slice(headerAt + 1, headerAt + 500)) {
      const value = (r[at] ?? '').trim();
      if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const common = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
    const key = common ? platformInText(common, platforms) : null;
    if (key) return key;
  }
  return platformInText(fileName.replace(/\.[a-z0-9]+$/i, ''), platforms);
}
