/**
 * Reading Wikipedia's "List of <console> games" pages (the HTML the MediaWiki
 * API's action=parse returns). Every top-level wikitable becomes a grid of cell
 * texts with rowspans and colspans filled in; tables with a title column become
 * games, with their release dates per region and whether the page marks them
 * download-only or as download titles.
 */

export type WikiRegion = 'north-america' | 'europe' | 'japan' | 'other';

/** A game as a Wikipedia list gives it: its names, where it's listed, and when it came out in which region. */
export interface WikiGame {
  /** The names in the title cell: the main title first, then any others (other regions, retitles). */
  titles: string[];
  /** The headings above the game's table, e.g. "Unlicensed games > NES's lifespan". */
  section: string;
  /** Release date text per region, as the table writes it ("November 17, 2006", "Unreleased"). */
  releases: Partial<Record<WikiRegion, string>>;
  /** Whether the table has region columns (without them, releases can't be told apart by region). */
  regional: boolean;
  /** Marked download-only, through the page's key or the words in an options column. */
  digitalOnly: boolean;
  /**
   * Marked as a download title without being called download-only (an Xbox Live Arcade mark): what the
   * page's key says the mark means. Some such games also had a disc release.
   */
  download?: string;
  /** The article the title links to, if any ("Retro/Grade"). */
  article?: string;
  /** A download category the article is in ("PlayStation Network games"), when the catalog builder looked. */
  downloadCategory?: string;
  developer?: string;
  publisher?: string;
}

interface Cell {
  text: string;
  header: boolean;
  rowspan: number;
  colspan: number;
  /** The cell's data-sort-value: stands in for a cell that shows only a mark (a checkmark image, a color). */
  sortValue?: string;
  /** The article the cell's first link points to; null when that link isn't an article (a missing page, a section). */
  link?: string | null;
}

interface RawTable {
  section: string;
  rows: Cell[][];
}

/** What a table's section holds: retail games, special releases, unlicensed or homebrew games, or nothing to collect. */
export type WikiKind = 'retail' | 'special' | 'unlicensed' | 'skip';

/** Classifies a section by its headings ("Unreleased games" is skipped, "Unlicensed games > ..." is unlicensed). */
export function sectionKind(section: string): WikiKind {
  const s = section.toLowerCase();
  if (/unreleased|cancel+ed|prototype|non-game|software|application|compatib|see also|references|notes|demo|beta/.test(s)) return 'skip';
  if (/unlicen|homebrew|aftermarket|after (its )?lifespan|pirate|bootleg|fan-made|independent/.test(s)) return 'unlicensed';
  if (/promotion|giveaway|championship|competition|limited edition|non-retail|kiosk|prize|bundle|special release|other release/.test(s)) return 'special';
  return 'retail';
}

/** Built-in page names of each known console's game list, by platform key. */
export const WIKIPEDIA_LISTS: Record<string, string> = {
  'nintendo-entertainment-system': 'List of Nintendo Entertainment System games',
  'famicom-disk-system': 'List of Family Computer Disk System games',
  'super-nintendo': 'List of Super Nintendo Entertainment System games',
  'nintendo-64': 'List of Nintendo 64 games',
  'nintendo-gamecube': 'List of GameCube games',
  wii: 'List of Wii games',
  'wii-u': 'List of Wii U games',
  'nintendo-switch': 'List of Nintendo Switch games',
  'nintendo-switch-2': 'List of Nintendo Switch 2 games',
  'game-boy': 'List of Game Boy games',
  'game-boy-color': 'List of Game Boy Color games',
  'game-boy-advance': 'List of Game Boy Advance games',
  'nintendo-ds': 'List of Nintendo DS games',
  'nintendo-3ds': 'List of Nintendo 3DS games',
  'virtual-boy': 'List of Virtual Boy games',
  'game-and-watch': 'List of Game & Watch games',
  playstation: 'List of PlayStation (console) games',
  'playstation-2': 'List of PlayStation 2 games',
  'playstation-3': 'List of PlayStation 3 games',
  'playstation-4': 'List of PlayStation 4 games',
  'playstation-5': 'List of PlayStation 5 games',
  psp: 'List of PlayStation Portable games',
  'playstation-vita': 'List of PlayStation Vita games',
  xbox: 'List of Xbox games',
  'xbox-360': 'List of Xbox 360 games',
  'xbox-one': 'List of Xbox One games',
  'xbox-series-x': 'List of Xbox Series X and Series S games',
  'sega-master-system': 'List of Master System games',
  'sega-genesis': 'List of Sega Genesis games',
  'sega-cd': 'List of Sega CD games',
  'sega-32x': 'List of 32X games',
  'sega-saturn': 'List of Sega Saturn games',
  'sega-dreamcast': 'List of Dreamcast games',
  'sega-game-gear': 'List of Game Gear games',
  'atari-2600': 'List of Atari 2600 games',
  'atari-5200': 'List of Atari 5200 games',
  'atari-7800': 'List of Atari 7800 games',
  'atari-lynx': 'List of Atari Lynx games',
  'atari-jaguar': 'List of Atari Jaguar games',
  // No list page: the games table is in the article's "Games" section.
  'magnavox-odyssey': 'Magnavox Odyssey',
  'magnavox-odyssey-2': 'List of Magnavox Odyssey 2 games',
  intellivision: 'List of Intellivision games',
  colecovision: 'List of ColecoVision games',
  'turbografx-16': 'List of TurboGrafx-16 games',
  'neo-geo': 'List of Neo Geo games',
  '3do': 'List of 3DO Interactive Multiplayer games',
  'n-gage': 'List of N-Gage games',
};

/** A setting's "platform-key: Name; Other name" lines, by platform key. */
function platformLines(lines: readonly string[]): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i <= 0) continue;
    const key = line.slice(0, i).trim().toLowerCase();
    const names = line
      .slice(i + 1)
      .split(';')
      .map((p) => p.trim())
      .filter(Boolean);
    if (key) result[key] = names;
  }
  return result;
}

/**
 * Wikipedia list pages per platform: the built-in names, with the user's
 * overrides ("platform-key: Page title" lines; several pages separated by ";").
 */
export function wikipediaPages(overrides: readonly string[]): Record<string, string[]> {
  const result: Record<string, string[]> = Object.fromEntries(Object.entries(WIKIPEDIA_LISTS).map(([k, v]) => [k, [v]]));
  return { ...result, ...platformLines(overrides) };
}

/** Download categories per platform ("platform-key: Category; Category" lines; a "Category:" prefix is optional). */
export function downloadCategories(lines: readonly string[]): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(platformLines(lines)).map(([key, names]) => [key, [...new Set(names.map((n) => n.replace(/^category\s*:\s*/i, '').replace(/_/g, ' ').trim()).filter(Boolean))]]),
  );
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  eacute: 'é',
};

/** Decodes the HTML entities of a page's text ("&amp;" is "&", "&#039;" is an apostrophe). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function attributes(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    out[m[1]!.toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '');
  }
  return out;
}

const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input', 'wbr', 'col', 'source', 'area', 'base']);

/** Namespaces whose pages aren't articles ("File:", "Category:"...). */
const NAMESPACES = /^(file|image|category|template|help|wikipedia|portal|special|talk|user|draft|module|mediawiki|wp|wt|w|wikt):/i;

/** The article an href points to ("/wiki/Retro/Grade" -> "Retro/Grade"), or undefined for a section of a page, another namespace or a missing page. */
function articleOf(href: string | undefined): string | undefined {
  if (!href?.startsWith('/wiki/') || href.includes('#')) return undefined;
  let title: string;
  try {
    title = decodeURIComponent(href.slice(6)).replace(/_/g, ' ').trim();
  } catch {
    return undefined;
  }
  return title && !NAMESPACES.test(title) ? title : undefined;
}

/**
 * Elements whose text isn't part of what a reader sees in the cell: footnote marks, styles, hidden sort
 * keys, and what only shows on screen, such as the " [ja]" after a game with an article only on another
 * language's Wikipedia (the Super Famicom's games released only in Japan).
 */
function skipped(tag: string, attrs: Record<string, string>): boolean {
  if (tag === 'sup' || tag === 'style' || tag === 'script') return true;
  const style = (attrs.style ?? '').replace(/\s/g, '').toLowerCase();
  if (style.includes('display:none')) return true;
  const cls = ` ${attrs.class ?? ''} `;
  return cls.includes(' sortkey ') || cls.includes(' reference ') || cls.includes(' mw-editsection ') || cls.includes(' noprint ');
}

/** The top-level wikitables of a page (or every top-level table) as rows of cells (before rowspans and colspans are filled in). */
function rawTables(html: string, anyTable = false): RawTable[] {
  const tables: RawTable[] = [];
  let depth = 0;
  let current: Cell[][] | null = null;
  let cell: Cell | null = null;
  const open: { tag: string; skip: boolean }[] = [];
  const skipping = () => open.some((o) => o.skip);
  const headings: string[] = [];
  let heading: { level: number; text: string } | null = null;
  const outer: { tag: string; skip: boolean }[] = [];
  const closeCell = () => {
    if (cell && current && current.length > 0) {
      if (!cell.text.trim() && cell.sortValue) cell.text = cell.sortValue;
      current[current.length - 1]!.push(cell);
    }
    cell = null;
  };
  for (const m of html.matchAll(/<!--[\s\S]*?-->|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+)|</g)) {
    if (m[0].startsWith('<!--')) continue;
    if (m[2] === undefined) {
      if (cell && depth === 1 && !skipping()) cell.text += decodeEntities(m[4] ?? m[0]);
      else if (heading && depth === 0 && !outer.some((o) => o.skip)) heading.text += decodeEntities(m[4] ?? m[0]);
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    if (depth === 0 && tag !== 'table') {
      const level = /^h([2-5])$/.exec(tag)?.[1];
      if (level && !closing) heading = { level: Number(level), text: '' };
      else if (level && closing && heading) {
        headings.length = heading.level - 2;
        headings.push(heading.text.replace(/\s+/g, ' ').trim());
        heading = null;
      } else if (heading && !closing && !VOID.has(tag)) outer.push({ tag, skip: skipped(tag, attributes(m[3] ?? '')) });
      else if (heading && closing) {
        const at = outer.map((o) => o.tag).lastIndexOf(tag);
        if (at >= 0) outer.splice(at);
      }
      continue;
    }
    if (tag === 'table') {
      if (!closing) {
        depth++;
        if (depth === 1) {
          const cls = ` ${attributes(m[3] ?? '').class ?? ''} `;
          current = anyTable || cls.includes(' wikitable ') ? [] : null;
          if (current) tables.push({ section: headings.filter(Boolean).join(' > '), rows: current });
        }
      } else {
        if (depth === 1) closeCell();
        depth = Math.max(0, depth - 1);
        if (depth === 0) current = null;
      }
      continue;
    }
    if (depth !== 1 || !current) continue;
    if (closing) {
      if (tag === 'td' || tag === 'th') closeCell();
      else if (tag === 'tr') closeCell();
      else {
        const at = open.map((o) => o.tag).lastIndexOf(tag);
        if (at >= 0) open.splice(at);
      }
      continue;
    }
    const attrs = attributes(m[3] ?? '');
    if (tag === 'tr') {
      closeCell();
      open.length = 0;
      current.push([]);
    } else if (tag === 'td' || tag === 'th') {
      closeCell();
      open.length = 0;
      if (current.length === 0) current.push([]);
      const span = (v: string | undefined) => Math.max(1, Math.min(1000, Number.parseInt(v ?? '1', 10) || 1));
      cell = { text: '', header: tag === 'th', rowspan: span(attrs.rowspan), colspan: span(attrs.colspan), sortValue: attrs['data-sort-value']?.trim() || undefined };
    } else if (tag === 'br') {
      if (cell && !skipping()) cell.text += '\n';
    } else if (tag === 'img') {
      // A checkmark or flag image says what it means in its alt text ("Yes", "No").
      const alt = attrs.alt?.trim();
      if (cell && !skipping() && alt && alt.length <= 20) cell.text += ` ${alt} `;
    } else if (!VOID.has(tag) && !m[0].endsWith('/>')) {
      const skip = skipped(tag, attrs);
      if (tag === 'a' && cell && cell.link === undefined && !skip && !skipping()) cell.link = articleOf(attrs.href) ?? null;
      open.push({ tag, skip });
    }
  }
  return tables;
}

function cleanText(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** Fills rowspans and colspans in, so every row has one cell per column. */
function grid(rows: Cell[][]): Cell[][] {
  const out: Cell[][] = [];
  const pending = new Map<number, { cell: Cell; left: number }>();
  for (const raw of rows) {
    const row: Cell[] = [];
    const cells = [...raw];
    let col = 0;
    while (cells.length > 0 || pending.has(col)) {
      const carried = pending.get(col);
      if (carried) {
        row.push(carried.cell);
        if (carried.left <= 1) pending.delete(col);
        else carried.left--;
        col++;
        continue;
      }
      const c = cells.shift()!;
      const cleaned = { ...c, text: cleanText(c.text) };
      for (let i = 0; i < c.colspan; i++) {
        row.push(cleaned);
        if (c.rowspan > 1) pending.set(col, { cell: cleaned, left: c.rowspan - 1 });
        col++;
      }
    }
    out.push(row);
  }
  return out;
}

/** A cell of a table grid: its text, whether it's a header cell, and the article its first link points to. */
export interface WikiCell {
  text: string;
  header: boolean;
  link?: string | null;
}

/** The page's wikitables as grids of cells, with the headings they sit under. */
export function wikiTables(html: string): { section: string; rows: WikiCell[][] }[] {
  return rawTables(html).map((t) => ({ section: t.section, rows: grid(t.rows) }));
}

/** Every top-level table of a web page as rows of cell text (rowspans and colspans filled in), with the headings it sits under (an online list's page). */
export function pageTables(html: string): { section: string; rows: string[][] }[] {
  return rawTables(html, true).map((t) => ({ section: t.section, rows: grid(t.rows).map((row) => row.map((c) => c.text)) }));
}

const REGION_LABELS: [RegExp, WikiRegion][] = [
  [/^(na|n\. ?america|north america|us|usa|u\.s\.|united states|canada)$/, 'north-america'],
  [/^(pal|eu|eur|europe|pal region|europe\/pal|pal\/eu|eu\/pal|eu\/au|uk|united kingdom)$/, 'europe'],
  [/^(jp|jpn|japan)$/, 'japan'],
  [/^(au|aus|australia|australasia|oceania|kr|kor|korea|south korea|asia|as|br|brazil|cn|china|tw|taiwan|hk|hong kong|russia|ru)$/, 'other'],
];

function label(text: string): string {
  return text
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^\p{L}\p{N}.\s/()'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function regionOfLabel(text: string): WikiRegion | null {
  const l = label(text).replace(/[\s/]+$/, '');
  for (const [re, region] of REGION_LABELS) if (re.test(l)) return region;
  return null;
}

const TITLE_LABEL = /^(title|titles|title\(s\)|game|game title|name)\b/;

/** A key mark about downloads: what the key says it means, and whether it calls the games download-only. */
interface DownloadMark {
  meaning: string;
  digitalOnly: boolean;
}

/**
 * Key meanings that mark download titles: games sold as downloads (Xbox Live Arcade, PlayStation
 * Network...), some of which also came out on disc. A meaning that also says "only" is download-only.
 */
const DOWNLOAD_MEANING = /\b(digital|downloads?|downloadable|xbox live arcade|xbox live indie games?|xbla|xblig|playstation network|psn|wiiware|dsiware|eshop)\b/i;

/** The marks a page's key tables (tables without a title column) explain as downloads: "D  Digital only games", "XBLA  Xbox Live Arcade titles". */
function downloadMarks(tables: { rows: WikiCell[][] }[]): Map<string, DownloadMark> {
  const marks = new Map<string, DownloadMark>();
  for (const t of tables) {
    if (t.rows.some((row) => row.some((c) => c.header && TITLE_LABEL.test(label(c.text))))) continue;
    for (const row of t.rows) {
      for (const c of row) {
        const m = c.text.match(/^(\S{1,6})\s+(.{2,120})$/);
        if (!m) continue;
        const code = m[1]!.toUpperCase();
        const meaning = m[2]!.trim();
        if (/\b(?:digital|download)[- ]?(?:only)?\b/i.test(meaning) && /only|exclusive/i.test(meaning)) marks.set(code, { meaning, digitalOnly: true });
        else if (DOWNLOAD_MEANING.test(meaning) && !marks.has(code)) marks.set(code, { meaning, digitalOnly: false });
      }
    }
  }
  return marks;
}

const REGION_NOTE = /\s*\((?:NA|JP|EU|PAL|AU|KR|US|UK|WW|NA\/EU|NA\/PAL|EU\/AU|PAL\/NA|JP\/NA|Japan|North America|Europe|Australia)\)\s*$/i;

/** The names in a title cell: one per line, without region notes ("(NA)") and footnote marks. */
export function cellTitles(text: string): string[] {
  const names: string[] = [];
  for (const raw of text.split('\n')) {
    const name = raw
      .replace(REGION_NOTE, '')
      .replace(/^[\s"“”•·▪◦‣–—-]+|[\s"“”†‡*§¤#]+$/g, '')
      .trim();
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

/** The games in a page's tables that have a title column. */
export function wikiGames(html: string): WikiGame[] {
  const tables = wikiTables(html);
  const marks = downloadMarks(tables);
  const games: WikiGame[] = [];
  for (const { section, rows: t } of tables) {
    let headerRows = 0;
    while (headerRows < t.length && t[headerRows]!.every((c) => c.header)) headerRows++;
    if (headerRows === 0 || headerRows === t.length) continue;
    const width = Math.max(...t.map((r) => r.length));
    const labels = Array.from({ length: width }, (_, col) => t.slice(0, headerRows).map((r) => label(r[col]?.text ?? '')));
    const find = (test: (l: string) => boolean) => labels.findIndex((ls) => ls.some(test));
    const titleCol = find((l) => TITLE_LABEL.test(l));
    if (titleCol < 0) continue;
    const regionCols: [number, WikiRegion][] = [];
    labels.forEach((ls, col) => {
      if (col === titleCol) return;
      const region = ls.map((l) => regionOfLabel(l)).find(Boolean);
      if (region) regionCols.push([col, region]);
    });
    // A column that lists regions as text ("NA, EU") instead of one date column per region.
    const listCol = regionCols.length > 0 ? -1 : find((l) => /^(regions? released|regions?|region\(s\)|countr(y|ies)|released in)\b/.test(l));
    const devCol = find((l) => l.startsWith('developer'));
    const pubCol = find((l) => l.startsWith('publisher'));
    const optCol = find((l) => /^(options|add-?ons|notes|format|availability|type|distribution)\b/.test(l));
    for (const row of t.slice(headerRows)) {
      if (row.every((c) => c.header) || !row[titleCol]) continue;
      const titles = cellTitles(row[titleCol]!.text);
      if (titles.length === 0) continue;
      const releases: WikiGame['releases'] = {};
      for (const [col, region] of regionCols) {
        const text = row[col]?.text ?? '';
        if (releases[region] === undefined || (!isReleased(releases[region]!) && isReleased(text))) releases[region] = text;
      }
      if (listCol >= 0) {
        for (const part of (row[listCol]?.text ?? '').split(/[\n,;/&]+|\band\b/)) {
          const region = regionOfLabel(part.trim());
          if (region) releases[region] = 'Released';
        }
      }
      const options = optCol >= 0 ? (row[optCol]?.text ?? '') : '';
      const found = options
        .toUpperCase()
        .split(/[\s,;/·•]+/)
        .map((tok) => marks.get(tok))
        .filter((k): k is DownloadMark => k !== undefined);
      const digitalOnly = found.some((k) => k.digitalOnly) || /\b(digital|download)[- ]only\b|\bdigital exclusive\b/i.test(options);
      const game: WikiGame = { titles, section, releases, regional: regionCols.length > 0 || listCol >= 0, digitalOnly };
      if (!digitalOnly && found.length > 0) game.download = found[0]!.meaning;
      if (row[titleCol]!.link) game.article = row[titleCol]!.link!;
      if (devCol >= 0 && row[devCol]?.text) game.developer = row[devCol]!.text.replace(/\n/g, ', ');
      if (pubCol >= 0 && row[pubCol]?.text) game.publisher = row[pubCol]!.text.replace(/\n/g, ', ');
      games.push(game);
    }
  }
  return games;
}

function isReleased(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t || /^[—–\-?]+$/.test(t)) return false;
  return !/^(unreleased|n\/a|tba|tbd|tbc|cancel+ed|none|no|not released|unknown)\b/.test(t);
}

/** Whether a game came out in a region (true for tables without region columns). */
export function releasedIn(game: WikiGame, region: WikiRegion): boolean {
  if (!game.regional) return true;
  const text = game.releases[region];
  return text !== undefined && isReleased(text);
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** "November 17, 2006" -> 2006-11-17, "17 November 2006" -> 2006-11-17, "November 2006" -> 2006-11, "2006" -> 2006; otherwise null. */
export function wikiDate(text: string | undefined): string | null {
  if (!text) return null;
  const t = text.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const month = MONTHS.findIndex((m) => t.includes(m) || new RegExp(`\\b${m.slice(0, 3)}\\b`).test(t));
  const year = t.match(/\b(19[5-9]\d|20\d\d)\b/)?.[1];
  if (!year) return null;
  if (month < 0) return year;
  const mm = String(month + 1).padStart(2, '0');
  const day = t.replace(year, '').match(/\b([0-3]?\d)\b/)?.[1];
  return day && Number(day) >= 1 && Number(day) <= 31 ? `${year}-${mm}-${day.padStart(2, '0')}` : `${year}-${mm}`;
}
