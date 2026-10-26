/**
 * Leaves: the owner's magazine scans (D177, docs/design/magazines-build.md). What's read here, without touching a
 * file: an issue's ComicInfo.xml (its converter's: series, number, volume, year, month, the cover story), what a file
 * name says when there's none, and the text a page's hOCR holds, word by word with its box.
 */

/** What an issue is, from its ComicInfo.xml or its file name. */
export interface IssueInfo {
  magazine: string | null;
  number: string | null;
  volume: string | null;
  year: number | null;
  month: number | null;
  /** The cover story (ComicInfo's Title, or what follows the date in a file name). */
  title: string | null;
  publisher: string | null;
  pages: number | null;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescape = (s: string) => s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_m, e: string) => (e[0] === '#' ? String.fromCodePoint(e[1]?.toLowerCase() === 'x' ? Number.parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? `&${e};`)));

/** An issue's ComicInfo.xml, read (the fields Squirrelcade uses; the rest left). */
export function parseComicInfo(xml: string): IssueInfo {
  const field = (name: string) => {
    const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
    const v = m ? unescape(m[1]!).trim() : '';
    return v || null;
  };
  const int = (name: string) => {
    const v = field(name);
    const n = v === null ? Number.NaN : Number.parseInt(v, 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const month = int('Month');
  return {
    magazine: field('Series'),
    number: field('Number'),
    volume: field('Volume'),
    year: int('Year'),
    month: month !== null && month <= 12 ? month : null,
    title: field('Title'),
    publisher: field('Publisher'),
    pages: int('PageCount'),
  };
}

/**
 * What an issue's file name says ("Nintendo Power #001 (1988-07) Super Mario Bros. 2.cbz", "GameFan Vol 01 #01.cbz",
 * "Computer Gaming World #268 (2006-11).cbz"), for an issue without a ComicInfo.xml.
 */
export function issueFromFileName(fileName: string): IssueInfo {
  const base = fileName.replace(/\.(cbz|cbr|pdf|zip)$/i, '').trim();
  const m = /^(.*?)\s*(?:vol\.?\s*(\d+)\s*)?#\s*(\d+[a-z]?)\s*(?:\((\d{4})(?:-(\d{1,2}))?\))?\s*(.*)$/i.exec(base);
  if (!m) return { magazine: base || null, number: null, volume: null, year: null, month: null, title: null, publisher: null, pages: null };
  const month = m[5] ? Number(m[5]) : null;
  return {
    magazine: m[1]!.trim() || null,
    number: String(Number.parseInt(m[3]!, 10)) + (m[3]!.replace(/^\d+/, '') || ''),
    volume: m[2] ? String(Number.parseInt(m[2], 10)) : null,
    year: m[4] ? Number(m[4]) : null,
    month: month !== null && month >= 1 && month <= 12 ? month : null,
    title: m[6]!.trim() || null,
    publisher: null,
    pages: null,
  };
}

/** Whether a folder or file is left out of the library: a name matching one of the patterns ("_*", ".*"). */
export function skippedName(name: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => {
    const re = new RegExp(`^${p.trim().replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');
    return p.trim() !== '' && re.test(name);
  });
}

/** A page's image in a CBZ: a picture's name, read in the order the pages run (001.jpg, 002.jpg...). */
export function pageNames(names: readonly string[]): string[] {
  return names
    .filter((n) => /\.(jpe?g|png|webp|gif)$/i.test(n) && !/(^|\/)(__macosx|\.)/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

/** A word on a page, and its box (left, top, right, bottom, in the page image's pixels). */
export interface PageWord {
  text: string;
  box: [number, number, number, number];
}

/** A page's hOCR (Tesseract's): its words with their boxes, and its text, line by line. */
export function parseHocr(hocr: string): { words: PageWord[]; text: string } {
  const words: PageWord[] = [];
  const lines: string[] = [];
  // Each line (ocr_line, ocr_caption, ocr_header...) holds its words (ocrx_word), each with its bbox in its title.
  for (const line of hocr.split(/<span[^>]*class=['"]ocr_(?:line|caption|header|textfloat)['"]/i).slice(1)) {
    const inLine: string[] = [];
    for (const m of line.matchAll(/<span[^>]*class=['"]ocrx_word['"][^>]*title=['"][^'"]*bbox (\d+) (\d+) (\d+) (\d+)[^'"]*['"][^>]*>([\s\S]*?)<\/span>/gi)) {
      const text = unescape(m[5]!.replace(/<[^>]+>/g, '')).trim();
      if (!text) continue;
      words.push({ text, box: [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] });
      inLine.push(text);
    }
    if (inLine.length > 0) lines.push(inLine.join(' '));
  }
  return { words, text: lines.join('\n') };
}

/** An issue's name as the library shows it: "Nintendo Power #45 · February 1993", or with its volume. */
export function issueLabel(i: { magazine: string; number: string | null; volume: string | null; year: number | null; month: number | null }): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const num = i.number ? `${i.volume ? `Vol. ${i.volume} ` : ''}#${i.number}` : i.volume ? `Vol. ${i.volume}` : '';
  const when = i.year ? `${i.month ? `${months[i.month - 1]} ` : ''}${i.year}` : '';
  return [i.magazine + (num ? ` ${num}` : ''), when].filter(Boolean).join(' · ');
}
