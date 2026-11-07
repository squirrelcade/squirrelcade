import { plain } from './roots.js';

/**
 * Roots > Top 20 (T-218, D206): each year's best-selling games, from Wikipedia's "YYYY in video games" articles. Their
 * tables come in three shapes: one per region under its own heading (1990: "Japan"), one with a Title column and the
 * regions' sales beside it (2005: worldwide), and one whose columns are the regions, each cell a game (2015, 2024).
 */

/** The regions a year's best-selling lists are kept by. */
export type SalesRegion = 'us' | 'japan' | 'europe' | 'worldwide';

export const SALES_REGIONS: Record<SalesRegion, string> = { us: 'the United States', japan: 'Japan', europe: 'Europe', worldwide: 'the world' };

/** A best seller: its title and its Wikipedia article (the link in its cell). */
export interface YearSeller {
  title: string;
  article: string | null;
}

/** Which region a heading, a caption or a column's label is about; null when it names none (Steam, digital). */
export function salesRegionOf(text: string): SalesRegion | null {
  const t = plain(text).toLowerCase();
  if (/steam|digital|mobile|arcade|pc\b/.test(t) && !/retail/.test(t)) return null;
  if (/japan|famitsu|media create/.test(t)) return 'japan';
  if (/united states|\bu\.?s\.?\b|\busa\b|north america|npd|circana/.test(t)) return 'us';
  if (/united kingdom|\buk\b|europe|gfk|chart-track|britain|germany|france/.test(t)) return 'europe';
  if (/worldwide|global|world\b/.test(t)) return 'worldwide';
  return null;
}

const REF = /<ref(\s[^>]*?)?(?<!\/)>[\s\S]*?<\/ref\s*>|<ref(\s[^>]*?)\/>/gi;

/** A cell's game: its first link's article and text, else its plain words. */
function cellGame(cell: string): YearSeller | null {
  const link = /\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|([^\]]+))?\]\]/.exec(cell);
  const title = plain(link ? (link[2] ?? link[1]!) : cell).replace(/^["'\s]+|["'\s]+$/g, '');
  if (!title || /^\d[\d,.\s<>+~]*$/.test(title) || /^(unknown|n\/a|—|-)$/i.test(title)) return null;
  return { title, article: link ? link[1]!.trim() : null };
}

/** A wikitable's header labels and its rows' cells (each cell's raw text; rowspans and colspans read as one cell). */
function tableOf(body: string): { caption: string; header: string[]; rows: string[][] } {
  let caption = '';
  const header: string[] = [];
  const rows: string[][] = [];
  for (const chunk of body.split(/\n\|-[^\n]*/)) {
    const cells: string[] = [];
    let headerRow = false;
    for (const raw of chunk.split('\n')) {
      const line = raw.trim();
      if (line.startsWith('|+')) caption = line.slice(2);
      else if (line.startsWith('!')) {
        headerRow = true;
        for (const c of line.slice(1).split('!!')) header.push(c.replace(/^[^|[]*\|(?!\|)/, '').trim());
      } else if (line.startsWith('|') && !line.startsWith('|}')) {
        for (const c of line.slice(1).split('||')) cells.push(c.replace(/^\s*(?:rowspan|colspan|style|scope|align)[^|[]*\|(?!\|)/i, '').trim());
      }
    }
    if (!headerRow && cells.length > 0) rows.push(cells);
  }
  return { caption, header, rows };
}

/**
 * A "YYYY in video games" article's best-selling games, by region, in rank order. Arcade and mobile charts, consoles
 * (hardware) and highest-grossing lists are left out.
 */
export function yearBestSellers(wikitext: string): Partial<Record<SalesRegion, YearSeller[]>> {
  const text = wikitext.replace(/<!--[\s\S]*?-->/g, '').replace(REF, '');
  const out: Partial<Record<SalesRegion, YearSeller[]>> = {};
  const lines = text.split('\n');
  // The best-selling games' sections: from such a heading to the next heading of its level or higher.
  for (let i = 0; i < lines.length; i++) {
    const h = /^(={2,4})\s*(.+?)\s*\1\s*$/.exec(lines[i]!);
    if (!h || !/best[- ]selling/i.test(h[2]!) || /system|console|hardware|arcade|mobile/i.test(h[2]!)) continue;
    const level = h[1]!.length;
    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const n = /^(={2,6})[^=]/.exec(lines[j]!);
      if (n && n[1]!.length <= level) {
        end = j;
        break;
      }
    }
    const section = lines.slice(i + 1, end).join('\n');
    // Each table with the words before it (a region's heading, a bold label, its own caption).
    let before = '';
    for (const part of `\n${section}`.split(/\n\{\|/)) {
      const close = part.indexOf('\n|}');
      if (close < 0 || !/^\s*class="[^"]*wikitable/.test(part)) {
        before = part.split('\n').filter((l) => l.trim()).slice(-3).join(' ');
        continue;
      }
      const { caption, header, rows } = tableOf(part.slice(0, close));
      const titleCol = header.findIndex((l) => /^\s*(?:''')?(title|game)s?\b/i.test(plain(l)));
      const regionCols = header.map((l) => salesRegionOf(l));
      if (titleCol < 0 && regionCols.some(Boolean)) {
        // The regions as columns, each cell a game; the rank is the row.
        regionCols.forEach((region, col) => {
          if (!region || out[region]) return;
          const games = rows.map((r) => cellGame(r[col] ?? '')).filter((g): g is YearSeller => Boolean(g));
          if (games.length > 0) out[region] = dedupe(games);
        });
      } else if (titleCol >= 0) {
        const region = salesRegionOf(caption) ?? salesRegionOf(before) ?? salesRegionOf(h[2]!) ?? 'worldwide';
        if (!out[region]) {
          const games = rows.map((r) => cellGame(r[titleCol - (header.length - r.length > 0 ? 0 : 0)] ?? '')).filter((g): g is YearSeller => Boolean(g));
          if (games.length > 0) out[region] = dedupe(games);
        }
      }
      const after = part.slice(close + 3);
      before = after.split('\n').filter((l) => l.trim()).slice(-3).join(' ');
    }
  }
  return out;
}

/** A game ranked twice (one per platform) counts once, at its first place. */
function dedupe(games: YearSeller[]): YearSeller[] {
  const seen = new Set<string>();
  return games.filter((g) => {
    const k = (g.article ?? g.title).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
