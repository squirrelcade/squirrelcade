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
  /** Found by the second read (D244), not the first: kept apart so what the second read added can be told. */
  second?: true;
  /** What the second read made of this word when it read it otherwise, and surely (D244): the games are looked for both ways. */
  alt?: string;
}

/** A word as a reading gave it: with how sure the reader was (0 to 100; 100 when the hOCR doesn't say). */
interface ReadWord {
  text: string;
  box: [number, number, number, number];
  sure: number;
}

/** A page's hOCR as lines of words: each line (ocr_line, ocr_caption, ocr_header...) holds its words (ocrx_word), each with its bbox in its title. */
function hocrLines(hocr: string): ReadWord[][] {
  const lines: ReadWord[][] = [];
  for (const line of hocr.split(/<span[^>]*class=['"]ocr_(?:line|caption|header|textfloat)['"]/i).slice(1)) {
    const inLine: ReadWord[] = [];
    for (const m of line.matchAll(/<span[^>]*class=['"]ocrx_word['"][^>]*title=['"]([^'"]*bbox (\d+) (\d+) (\d+) (\d+)[^'"]*)['"][^>]*>([\s\S]*?)<\/span>/gi)) {
      const text = unescape(m[6]!.replace(/<[^>]+>/g, '')).trim();
      if (!text) continue;
      const sure = /x_wconf (\d+)/.exec(m[1]!);
      inLine.push({ text, box: [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])], sure: sure ? Number(sure[1]) : 100 });
    }
    if (inLine.length > 0) lines.push(inLine);
  }
  return lines;
}

/** A page's hOCR (Tesseract's): its words with their boxes, and its text, line by line. */
export function parseHocr(hocr: string): { words: PageWord[]; text: string } {
  const lines = hocrLines(hocr);
  return { words: lines.flatMap((line) => line.map((w) => ({ text: w.text, box: w.box }))), text: lines.map((line) => line.map((w) => w.text).join(' ')).join('\n') };
}

/** The words of reviews: three of them make a page a review's. */
const REVIEW_WORDS = /\b(?:reviews?|review crew|proreview|verdict|ratings?|overall|graphics|playability|gameplay)\b/gi;

/**
 * Whether a page is worth a second read (D244): one with little text (an ad, a cover, a title page: where the first
 * read's layout analysis leaves display type unread most often), a contents page, or a review's page (where a game's
 * name is the heading).
 */
export function secondReadPage(n: number, text: string, thinUnder: number): boolean {
  const words = text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
  if (words < thinUnder) return true;
  if (n <= 15 && /\bcontents\b/i.test(text)) return true;
  return (text.match(REVIEW_WORDS)?.length ?? 0) >= 3;
}

/** How sure the second read must be of a word to add it (Tesseract's 0 to 100): sparse mode reads pictures as letters. */
export const SECOND_READ_SURE = 70;
/** And how sure of a word it reads otherwise than the first read did, to keep its reading beside the first's. */
export const SECOND_READ_OTHERWISE = 85;

const area = (b: readonly number[]) => Math.max(0, b[2]! - b[0]!) * Math.max(0, b[3]! - b[1]!);

/** How much of each of two boxes the other covers (0 to 1 each). */
function shared(a: readonly number[], b: readonly number[]): [ofA: number, ofB: number] {
  const w = Math.min(a[2]!, b[2]!) - Math.max(a[0]!, b[0]!);
  const h = Math.min(a[3]!, b[3]!) - Math.max(a[1]!, b[1]!);
  if (w <= 0 || h <= 0) return [0, 0];
  return [(w * h) / (area(a) || 1), (w * h) / (area(b) || 1)];
}

/** A word's letters and digits, small: what two readings of the same ink are compared by. */
const letters = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]/gu) ?? []).join('');

/**
 * A page's words with what a second read found added (D244). The second read is Tesseract's sparse mode: every bit of
 * text it can find, with no layout analysis, so it reads headings and display type the first read's layout left out,
 * and also takes pictures for letters. So:
 * - nothing the first read gave is changed or taken out;
 * - a word in a place the first read had nothing is added when the reader was sure of it and it has two letters or
 *   digits. It goes where it belongs: beside the word of its own line that the first read already had (a heading read
 *   in part becomes whole), or, when its whole line is new, on a line of its own after the page's other words;
 * - a word the first read had, read otherwise this time and surely ("NINETY-NINE" where the first read made
 *   "IIIIIE'IY-IIIIIE" of a heading's letters), keeps the first reading and gets the second beside it (its alt): the
 *   games are looked for both ways.
 * Adding is safe to do twice: what was added is in its place and isn't added again.
 */
export function mergeSecondRead(
  page: { words: readonly PageWord[]; text: string },
  sparseHocr: string,
  sure = SECOND_READ_SURE,
  otherwise = SECOND_READ_OTHERWISE,
): { words: PageWord[]; text: string; added: number; otherwise: number } {
  const base = page.words;
  // The page's words by band, so a word of the second read is compared with its neighbours only.
  const BAND = 64;
  const bands = new Map<number, number[]>();
  const put = (box: readonly number[], index: number) => {
    for (let b = Math.floor(box[1]! / BAND); b <= Math.floor(box[3]! / BAND); b++) {
      const list = bands.get(b);
      if (list) list.push(index);
      else bands.set(b, [index]);
    }
  };
  base.forEach((w, k) => put(w.box, k));
  const added: PageWord[] = [];
  /**
   * The word already in this place, the one that shares most with it: its index among the page's words (-2 for one
   * added a moment ago, -1 for none), and whether the two are one word in one place (each covers most of the other).
   */
  const at = (box: readonly number[]): { k: number; one: boolean } => {
    let best = -1;
    let most = 0;
    let one = false;
    const seen = new Set<number>();
    for (let b = Math.floor(box[1]! / BAND); b <= Math.floor(box[3]! / BAND); b++) {
      for (const k of bands.get(b) ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        const [ofTheirs, ofOurs] = shared(k >= 0 ? base[k]!.box : added[-k - 3]!.box, box);
        // The same place: what they share is a good part of the smaller one.
        if (Math.max(ofTheirs, ofOurs) <= 0.3) continue;
        const both = Math.min(ofTheirs, ofOurs);
        if (best === -1 || both > most) {
          best = k >= 0 ? k : -2;
          most = both;
          one = both > 0.5;
        }
      }
    }
    return { k: best, one };
  };
  // Where each new word goes: after a word of the first read, before one, or on a new line at the end.
  const after = new Map<number, PageWord[]>();
  const before = new Map<number, PageWord[]>();
  const newLines: PageWord[][] = [];
  // The words read otherwise this time: the second reading, by the word's index.
  const alts = new Map<number, string>();
  for (const line of hocrLines(sparseHocr)) {
    const places = line.map((w) => at(w.box));
    const place = places.map((x) => x.k);
    const news: { k: number; word: PageWord }[] = [];
    line.forEach((w, k) => {
      const here = places[k]!;
      if (here.k >= 0) {
        const was = base[here.k]!;
        if (here.one && w.sure >= otherwise && !was.second && was.alt === undefined && !alts.has(here.k) && letters(w.text).length >= 2 && letters(w.text) !== letters(was.text)) alts.set(here.k, w.text);
        return;
      }
      if (here.k !== -1 || w.sure < sure || area(w.box) === 0 || letters(w.text).length < 2) return;
      const word: PageWord = { text: w.text, box: w.box, second: true };
      news.push({ k, word });
      added.push(word);
      put(w.box, -(added.length - 1) - 3);
    });
    if (news.length === 0) continue;
    const own: PageWord[] = [];
    for (const { k, word } of news) {
      let left = -1;
      for (let j = k - 1; j >= 0 && left < 0; j--) if (place[j]! >= 0) left = place[j]!;
      let right = -1;
      for (let j = k + 1; j < line.length && right < 0 && left < 0; j++) if (place[j]! >= 0) right = place[j]!;
      const list = left >= 0 ? after : right >= 0 ? before : null;
      const anchor = left >= 0 ? left : right;
      if (!list) own.push(word);
      else if (list.has(anchor)) list.get(anchor)!.push(word);
      else list.set(anchor, [word]);
    }
    if (own.length > 0) newLines.push(own);
  }
  if (added.length === 0 && alts.size === 0) return { words: [...base], text: page.text, added: 0, otherwise: 0 };
  // The first read's lines, as its text has them (each line of the text is the next of its words): the new words
  // join their line. A text that doesn't line up with its words (it came with the scan) keeps its lines as they are.
  const lines: PageWord[][] = [];
  let k = 0;
  let aligned = true;
  for (const textLine of page.text.split('\n')) {
    const tokens = textLine.split(' ').filter(Boolean);
    if (tokens.length === 0) continue;
    const ws = base.slice(k, k + tokens.length);
    if (ws.length !== tokens.length || ws.some((w, i) => w.text !== tokens[i])) {
      aligned = false;
      break;
    }
    lines.push(ws);
    k += tokens.length;
  }
  if (aligned && k < base.length) aligned = false;
  const withNew = (ws: readonly PageWord[], first: number) => ws.flatMap((w, i) => [...(before.get(first + i) ?? []), alts.has(first + i) ? { ...w, alt: alts.get(first + i)! } : w, ...(after.get(first + i) ?? [])]);
  const words = [...withNew(base, 0), ...newLines.flat()];
  let text: string;
  if (aligned) {
    let first = 0;
    const out: string[] = [];
    for (const ws of lines) {
      out.push(withNew(ws, first).map((w) => w.text).join(' '));
      first += ws.length;
    }
    text = [...out, ...newLines.map((ws) => ws.map((w) => w.text).join(' '))].join('\n');
  } else {
    const more = [...[...before.values(), ...after.values()].map((ws) => ws.map((w) => w.text).join(' ')), ...newLines.map((ws) => ws.map((w) => w.text).join(' '))];
    text = [page.text, ...more].filter((t) => t !== '').join('\n');
  }
  return { words, text, added: added.length, otherwise: alts.size };
}

/** What the search keeps of a page (D244): its text, and the second read's other readings of its words. */
export function searchText(page: { words: readonly PageWord[]; text: string }): string {
  const other = page.words.filter((w) => w.alt !== undefined).map((w) => w.alt!);
  return other.length > 0 ? `${page.text}\n${other.join(' ')}` : page.text;
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');

/**
 * A page's hOCR from its stored words and text (D209, sharing a magazine's read text): each line of the text a line
 * of its words, with their boxes, so parseHocr gives back the same words, boxes and text. Words the text doesn't
 * line up with go on a last line of their own.
 */
export function writeHocr(words: readonly PageWord[], text: string): string {
  const word = (w: PageWord) => `<span class='ocrx_word' title='bbox ${w.box.join(' ')}; x_wconf 95'>${escapeXml(w.text)}</span>`;
  const line = (ws: readonly PageWord[]) => {
    const box = [Math.min(...ws.map((w) => w.box[0])), Math.min(...ws.map((w) => w.box[1])), Math.max(...ws.map((w) => w.box[2])), Math.max(...ws.map((w) => w.box[3]))];
    return `<span class='ocr_line' title='bbox ${box.join(' ')}'>${ws.map(word).join(' ')}</span>`;
  };
  const lines: string[] = [];
  let k = 0;
  for (const textLine of text.split('\n')) {
    const tokens = textLine.split(' ').filter(Boolean);
    if (tokens.length === 0) continue;
    const ws = words.slice(k, k + tokens.length);
    if (ws.length !== tokens.length || ws.some((w, i) => w.text !== tokens[i])) break;
    lines.push(line(ws));
    k += tokens.length;
  }
  if (k < words.length) lines.push(line(words.slice(k)));
  return `<?xml version="1.0" encoding="UTF-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><meta name="ocr-system" content="squirrelcade" /></head><body>\n<div class='ocr_page'>\n${lines.join('\n')}\n</div>\n</body></html>\n`;
}

/** An issue's name as the library shows it: "Nintendo Power #45 · February 1993", or with its volume. */
export function issueLabel(i: { magazine: string; number: string | null; volume: string | null; year: number | null; month: number | null }): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const num = i.number ? `${i.volume ? `Vol. ${i.volume} ` : ''}#${i.number}` : i.volume ? `Vol. ${i.volume}` : '';
  const when = i.year ? `${i.month ? `${months[i.month - 1]} ` : ''}${i.year}` : '';
  return [i.magazine + (num ? ` ${num}` : ''), when].filter(Boolean).join(' · ');
}
