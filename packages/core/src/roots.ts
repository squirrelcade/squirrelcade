/**
 * Roots (D165): a game's Wikipedia article read for its own time and since. Wikipedia's review table (each outlet's
 * score, with the magazine, issue, page and date its citation gives), every dated citation in the article, the game's
 * releases from its infobox, and the games its Development and Legacy sections name (what it came from, what it led
 * to). Pure functions over the article's wikitext: the server fetches it, keeps the reading, and sorts the sources into
 * At the time and Looking back by the game's first release.
 */
import { PLATFORM_SHORT_NAMES } from './platforms.js';

/** Bumped when the reading changes, so installs read their games again (gradually). */
export const ROOTS_READER_VERSION = 1;

/** A citation as the article gives it. */
export interface WikiCitation {
  /** cite web, cite magazine, cite news, cite journal, cite book, cite video, sfn (a short footnote), link. */
  kind: string;
  title: string | null;
  /** The magazine, website, newspaper or show it's in. */
  work: string | null;
  /** When it was published: "1994-06-22", "1994-06" or "1994". */
  date: string | null;
  issue: string | null;
  volume: string | null;
  /** The page or pages ("28", "32–35"). */
  page: string | null;
  url: string | null;
  /** An archived copy (the Wayback Machine, archive.today). */
  archiveUrl: string | null;
  language: string | null;
  authors: string[];
}

/** A score in the review table, for one platform or for all. */
export interface ReviewScore {
  /** The platform the table gives it for ("PS2"), or null for the game as a whole. */
  platform: string | null;
  score: string;
}

/** A row of the article's review table. */
export interface ReviewRow {
  /** The table it's in says its era: "Contemporary reception" (time) or "Retrospective reception" (later). */
  table: 'time' | 'later' | null;
  /** The table's code for the outlet ("EGM", "MC", "rev1"). */
  code: string;
  /** The outlet's name: its citation's magazine or website, else the table's own name for the code. */
  outlet: string;
  /** An aggregator (Metacritic, GameRankings, OpenCritic) rather than a review. */
  aggregate: boolean;
  scores: ReviewScore[];
  citation: WikiCitation | null;
}

/** A release of the game, from its infobox. */
export interface WikiRelease {
  platform: string | null;
  region: string | null;
  date: string;
}

/** A dated source cited anywhere in the article, with the section it's cited in. */
export interface WikiSource extends WikiCitation {
  section: string;
}

/** A game the article names in its Development or Legacy sections. */
export interface WikiMention {
  title: string;
  /** The article it links to, when it's a link. */
  article: string | null;
  /** The sentence it's named in. */
  context: string;
}

/** What Roots keeps of an article. */
export interface RootsReading {
  version: number;
  releases: WikiRelease[];
  /** The earliest release ("1994-03-19"), which At the time is counted from. */
  firstRelease: string | null;
  reviews: ReviewRow[];
  /** Every dated citation outside the review table, in article order, once each. */
  sources: WikiSource[];
  /** Games named in Development (what it came from) and Legacy (what it led to). */
  cameFrom: WikiMention[];
  ledTo: WikiMention[];
}

// ---------------------------------------------------------------------------------------------------------------
// Wikitext

/** A template in the text: its name (lower case, spaces for underscores) and what's between its braces. */
export interface WikiTemplate {
  name: string;
  body: string;
  start: number;
  end: number;
}

/** The templates at the top level of the text (not those nested in another), in order. */
export function templatesIn(text: string): WikiTemplate[] {
  const out: WikiTemplate[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] === '{' && text[i + 1] === '{') {
      if (depth === 0) start = i;
      depth++;
      i++;
    } else if (text[i] === '}' && text[i + 1] === '}' && depth > 0) {
      depth--;
      i++;
      if (depth === 0) {
        const body = text.slice(start + 2, i - 1);
        const name = body.split('|')[0]!.replace(/<!--[\s\S]*?-->/g, '').replace(/_/g, ' ').trim().toLowerCase();
        out.push({ name, body, start, end: i + 1 });
      }
    }
  }
  return out;
}

/** Every template in the text, nested ones too. */
function allTemplates(text: string): WikiTemplate[] {
  const out: WikiTemplate[] = [];
  for (const t of templatesIn(text)) {
    out.push(t);
    out.push(...allTemplates(t.body.slice(t.body.indexOf('|') + 1 || t.body.length)));
  }
  return out;
}

/** A template's parameters: the positional ones in order, and the named ones by their lower-case name. */
export function templateParams(body: string): { positional: string[]; named: Map<string, string> } {
  const parts: string[] = [];
  let depth = 0;
  let link = 0;
  let current = '';
  for (let i = 0; i < body.length; i++) {
    const two = body.slice(i, i + 2);
    if (two === '{{') {
      depth++;
      current += two;
      i++;
    } else if (two === '}}' && depth > 0) {
      depth--;
      current += two;
      i++;
    } else if (two === '[[') {
      link++;
      current += two;
      i++;
    } else if (two === ']]' && link > 0) {
      link--;
      current += two;
      i++;
    } else if (body[i] === '|' && depth === 0 && link === 0) {
      parts.push(current);
      current = '';
    } else current += body[i];
  }
  parts.push(current);
  const positional: string[] = [];
  const named = new Map<string, string>();
  for (const p of parts.slice(1)) {
    const eq = p.indexOf('=');
    // A "=" inside a nested template or link isn't the parameter's.
    const head = eq > 0 ? p.slice(0, eq) : '';
    if (eq > 0 && !/[{[<]/.test(head)) named.set(head.trim().toLowerCase(), p.slice(eq + 1).trim());
    else positional.push(p.trim());
  }
  return { positional, named };
}

/** References' tags: "<ref name=x>...</ref>" and "<ref name=x />". */
const REF_FULL = /<ref(\s[^>]*?)?(?<!\/)>([\s\S]*?)<\/ref\s*>/gi;
const REF_SHORT = /<ref(\s[^>]*?)\/>/gi;
const refName = (attrs: string | undefined) => /\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s/>]+))/i.exec(attrs ?? '')?.slice(1).find((x) => x !== undefined)?.trim() ?? null;

/** The article's named references' contents, by name. */
function namedRefs(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of text.matchAll(REF_FULL)) {
    const name = refName(m[1]);
    if (name && !out.has(name)) out.set(name, m[2]!);
  }
  return out;
}

/** The references in a stretch of text, in order: each one's contents (a named one's from its definition). */
function refsIn(text: string, defs: Map<string, string>): { body: string; name: string | null }[] {
  const out: { at: number; body: string; name: string | null }[] = [];
  for (const m of text.matchAll(REF_FULL)) out.push({ at: m.index!, body: m[2]!, name: refName(m[1]) });
  for (const m of text.matchAll(REF_SHORT)) {
    const name = refName(m[1]);
    if (name && defs.has(name)) out.push({ at: m.index!, body: defs.get(name)!, name });
  }
  return out.sort((a, b) => a.at - b.at).map(({ body, name }) => ({ body, name }));
}

/** Templates whose first parameter is their text ({{nowrap|...}}, {{small|...}}). */
const KEEP_FIRST = new Set(['nowrap', 'small', 'nobold', 'smaller', 'big', 'nihongo', 'nihongo2', 'vgy', 'vgrelease title', 'em', 'strong', 'sic', 'notatypo', 'nobr', 'abbr', 'lang-ja', 'transl', 'nihongo foot', 'tooltip', 'proper name', 'not a typo']);
/** Templates whose last parameter is their text ({{lang|fr|...}}). */
const KEEP_LAST = new Set(['lang', 'langx', 'linktext']);

/** The words of some wikitext, without its markup: links as their words, templates as their text or nothing. */
export function plain(text: string): string {
  let s = text.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(REF_FULL, '').replace(REF_SHORT, '');
  // Templates, innermost first.
  for (let round = 0; round < 6 && s.includes('{{'); round++) {
    s = s.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => {
      const name = body.split('|')[0]!.trim().toLowerCase();
      const { positional } = templateParams(body);
      if (KEEP_FIRST.has(name)) return positional[0] ?? '';
      if (KEEP_LAST.has(name)) return positional.at(-1) ?? '';
      if (name === '!') return '|';
      if (name === 'snd' || name === 'spaced ndash' || name === 'ndash') return ' – ';
      if (name === 'nbsp') return ' ';
      if (name === 'ill' || name === 'interlanguage link') return positional[0] ?? '';
      return '';
    });
  }
  s = s.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1');
  s = s.replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]+)\]/g, '$1').replace(/\[(?:https?:)?\/\/[^\s\]]+\]/g, '');
  s = s.replace(/'''''|'''|''/g, '');
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  s = s.replace(/&nbsp;|&#160;/g, ' ').replace(/&ndash;/g, '–').replace(/&mdash;/g, '—').replace(/&amp;/g, '&');
  return s
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Dates

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const monthOf = (word: string): number | null => {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(w) || (w === 'sept' && m === 'september'));
  return i >= 0 ? i + 1 : null;
};
const pad = (n: number) => String(n).padStart(2, '0');
const year = (s: string) => {
  const y = Number(s);
  return y >= 1940 && y <= 2100 ? y : null;
};

/** A date as written ("April 22, 1994", "22 April 1994", "1994-04-22", "June 1994", "1994"): "1994-04-22", "1994-06", "1994", or null. */
export function articleDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = plain(raw).replace(/\s+/g, ' ').trim();
  let m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(s);
  if (m && year(m[1]!)) return m[3] ? `${m[1]}-${pad(+m[2]!)}-${pad(+m[3])}` : `${m[1]}-${pad(+m[2]!)}`;
  m = /\b([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})\b/.exec(s);
  if (m && monthOf(m[1]!) && year(m[3]!)) return `${m[3]}-${pad(monthOf(m[1]!)!)}-${pad(+m[2]!)}`;
  m = /\b(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})\b/.exec(s);
  if (m && monthOf(m[2]!) && year(m[3]!)) return `${m[3]}-${pad(monthOf(m[2]!)!)}-${pad(+m[1]!)}`;
  m = /\b([A-Za-z]{3,9})\.?,? (\d{4})\b/.exec(s);
  if (m && monthOf(m[1]!) && year(m[2]!)) return `${m[2]}-${pad(monthOf(m[1]!)!)}`;
  m = /\b(\d{4})\b/.exec(s);
  if (m && year(m[1]!)) return m[1]!;
  return null;
}

/** Months between two dates (partial dates count from their start). */
function monthsBetween(a: string, b: string): number {
  const [ay, am = 1, ad = 1] = a.split('-').map(Number);
  const [by, bm = 1, bd = 1] = b.split('-').map(Number);
  return (by! - ay!) * 12 + (bm - am) + (bd - ad) / 31;
}

/**
 * Which part of Roots a source belongs to, by its date and the game's first release: At the time from a year before
 * the release (previews) to the window's end (18 months, Settings > Roots), Looking back after that.
 */
export function eraOf(date: string | null, firstRelease: string | null, months: number): 'time' | 'later' | null {
  if (!date || !firstRelease) return null;
  const gap = monthsBetween(firstRelease, date);
  if (gap < -12) return null;
  // A source dated by its year only, the release's year or the next, is still of its time.
  if (/^\d{4}$/.test(date)) return Number(date) - Number(firstRelease.slice(0, 4)) <= Math.max(1, Math.ceil(months / 12)) ? 'time' : 'later';
  return gap <= months ? 'time' : 'later';
}

// ---------------------------------------------------------------------------------------------------------------
// Citations

const WORK_KEYS = ['magazine', 'work', 'website', 'newspaper', 'journal', 'periodical', 'encyclopedia', 'series', 'network', 'station', 'publisher'];

/** The first citation in a reference's contents. */
export function citationOf(body: string): WikiCitation | null {
  for (const t of allTemplates(body)) {
    const kind = t.name.replace(/\s+/g, ' ');
    if (kind === 'sfn' || kind === 'harvnb' || kind === 'sfnp') {
      const { positional, named } = templateParams(t.body);
      return {
        kind: 'sfn',
        title: null,
        work: positional[0] ? plain(positional[0]) : null,
        date: articleDate(positional.find((p) => /^\d{4}/.test(p)) ?? null),
        issue: null,
        volume: null,
        page: named.get('p') ?? named.get('pp') ?? named.get('page') ?? null,
        url: null,
        archiveUrl: null,
        language: null,
        authors: [],
      };
    }
    if (!/^(cite|citation)\b/.test(kind)) continue;
    const { named } = templateParams(t.body);
    const get = (...keys: string[]) => {
      for (const k of keys) {
        const v = named.get(k);
        if (v && plain(v)) return v;
      }
      return null;
    };
    const work = get(...WORK_KEYS);
    const authors: string[] = [];
    for (const i of ['', '1', '2', '3', '4', '5']) {
      const last = named.get(`last${i}`) ?? named.get(`surname${i}`);
      const first = named.get(`first${i}`) ?? named.get(`given${i}`);
      const author = named.get(`author${i}`);
      if (last) authors.push(plain([first, last].filter(Boolean).join(' ')));
      else if (author) authors.push(plain(author));
    }
    return {
      kind: kind === 'citation' ? 'cite web' : kind,
      title: get('title', 'chapter', 'episode') ? plain(get('title', 'chapter', 'episode')!) : null,
      work: work ? plain(work) : null,
      date: articleDate(get('date', 'publication-date', 'air-date', 'airdate') ?? get('year')),
      issue: get('issue', 'number') ? plain(get('issue', 'number')!) : null,
      volume: get('volume') ? plain(get('volume')!) : null,
      page: get('page', 'pages', 'p', 'pp', 'at') ? plain(get('page', 'pages', 'p', 'pp', 'at')!) : null,
      url: get('url') ? plain(get('url')!).split(/\s/)[0]! : null,
      archiveUrl: get('archive-url', 'archiveurl') ? plain(get('archive-url', 'archiveurl')!).split(/\s/)[0]! : null,
      language: get('language', 'lang') ? plain(get('language', 'lang')!) : null,
      authors: authors.filter(Boolean),
    };
  }
  const link = /\[(https?:\/\/[^\s\]]+)\s*([^\]]*)\]/.exec(body);
  if (link) return { kind: 'link', title: plain(link[2] ?? '') || null, work: null, date: articleDate(plain(body.slice(link.index + link[0].length))), issue: null, volume: null, page: null, url: link[1]!, archiveUrl: null, language: null, authors: [] };
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// The review table

/** The table's codes for outlets (Template:Video game reviews), for a row whose citation names no outlet. */
export const REVIEW_OUTLETS: Record<string, string> = {
  MC: 'Metacritic',
  GR: 'GameRankings',
  OC: 'OpenCritic',
  '1UP': '1UP.com',
  ACE: 'ACE',
  Allgame: 'AllGame',
  AllGame: 'AllGame',
  ASM: 'Aktueller Software Markt',
  CGW: 'Computer Gaming World',
  CVG: 'Computer and Video Games',
  CP: 'Consoles +',
  Destruct: 'Destructoid',
  Edge: 'Edge',
  EGM: 'Electronic Gaming Monthly',
  EuroG: 'Eurogamer',
  Fam: 'Famitsu',
  G4: 'G4',
  GameFan: 'GameFan',
  GPro: 'GamePro',
  GP: 'GamePro',
  GameRev: 'Game Revolution',
  GB: 'Giant Bomb',
  GI: 'Game Informer',
  GMaster: 'GamesMaster',
  GRadar: 'GamesRadar+',
  GSpot: 'GameSpot',
  GSpy: 'GameSpy',
  GT: 'GameTrailers',
  GTM: 'GamesTM',
  Hyper: 'Hyper',
  IGN: 'IGN',
  Joystiq: 'Joystiq',
  JXV: 'Jeuxvideo.com',
  MG: 'M! Games',
  MF: 'Mega Fun',
  N64: 'N64 Magazine',
  NGen: 'Next Generation',
  NLife: 'Nintendo Life',
  NP: 'Nintendo Power',
  NWR: 'Nintendo World Report',
  ONM: 'Official Nintendo Magazine',
  OPM: 'Official U.S. PlayStation Magazine',
  OPMUK: 'PlayStation Official Magazine – UK',
  OXM: 'Official Xbox Magazine',
  OXMUK: 'Official Xbox Magazine UK',
  PCGUK: 'PC Gamer UK',
  PCGUS: 'PC Gamer US',
  PCZone: 'PC Zone',
  Play: 'Play',
  PO: 'Player One',
  Poly: 'Polygon',
  PSM: 'PlayStation Magazine',
  PSM3: 'PSM3',
  RPGFan: 'RPGFan',
  SP: 'Super Play',
  TOT: 'Total!',
  TouchArcade: 'TouchArcade',
  VG: 'VideoGamer.com',
  VGS: 'Video Games',
  XPlay: 'X-Play',
};
const AGGREGATES = new Set(['MC', 'GR', 'OC']);
/** The review table's own settings, not outlets. */
const NOT_OUTLETS = /^(title|subtitle|width|align|state|na|platforms?|show ?na|collapsed?|italic|qualifier|noarticle|columns?|award\d*|award\d*pub|state|reviews?|aggregators?|bgcolor|headerstyle|class|float|caption)$/i;

/** A score cell: "PS2: 93/100\nWii: 90/100" as two platforms' scores, "9/10, 9/10" as one. */
function scoresOf(value: string, platform: string | null = null): ReviewScore[] {
  const out: ReviewScore[] = [];
  for (const line of plain(value).split('\n')) {
    const marks = [...line.matchAll(/(?:^|\s)([A-Z0-9][A-Za-z0-9 .+/]{0,14}?)\s?:\s/g)];
    if (marks.length === 0) {
      // "96/100 (PC)": the platform after the score.
      const after = /^(.*?)\s*\(([A-Za-z0-9][A-Za-z0-9 .+/]{0,14})\)\s*$/.exec(line.trim());
      if (after && after[1]) out.push({ platform: after[2]!, score: after[1] });
      else if (line.trim()) out.push({ platform, score: line.trim() });
      continue;
    }
    if (marks[0]!.index! > 0 && line.slice(0, marks[0]!.index).trim()) out.push({ platform: null, score: line.slice(0, marks[0]!.index).trim() });
    marks.forEach((m, i) => {
      const from = m.index! + m[0].length;
      const to = i + 1 < marks.length ? marks[i + 1]!.index! : line.length;
      const score = line.slice(from, to).trim().replace(/[,;]$/, '');
      if (score) out.push({ platform: m[1]!.trim(), score });
    });
  }
  return out;
}

const squash = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The outlet a row is from: the table's own name for its code, or its citation's when that names the same outlet more fully. */
function outletOf(code: string, citation: WikiCitation | null): string {
  const known = Object.entries(REVIEW_OUTLETS).find(([k]) => k.toLowerCase() === code.toLowerCase())?.[1];
  if (AGGREGATES.has(code.toUpperCase())) return known ?? code;
  const work = citation?.work ?? null;
  if (!known) return work ?? code;
  // "Weekly Famitsu" for Famitsu, but not "Gematsu", which reported Famitsu's scores.
  return work && (squash(work).includes(squash(known)) || squash(known).includes(squash(work))) ? work : known;
}

const REVIEW_TABLES = /^(video game reviews|vg reviews|video game multiple console reviews|vgr)$/;

/**
 * The article's review tables (Template:Video game reviews), row by row, with each row's citation. An article can have
 * two ("Contemporary reception" and "Retrospective reception"), and a table can give each platform its own column
 * ("CVG_NES = 95%").
 */
export function reviewTable(text: string, defs = namedRefs(text)): ReviewRow[] {
  const rows: ReviewRow[] = [];
  for (const box of templatesIn(text).filter((t) => REVIEW_TABLES.test(t.name))) {
    const { named } = templateParams(box.body);
    const title = plain(named.get('title') ?? '');
    const table = /contemporary|original|initial/i.test(title) ? 'time' : /retrospective|re-?release|later|remaster/i.test(title) ? 'later' : null;
    // The parameters as written (the table's codes keep their case: "GSpot", "rev1Score", "CVG_NES").
    const written = new Map<string, string>();
    for (const p of box.body.split(/\n\s*\|/).slice(1)) {
      const eq = p.indexOf('=');
      if (eq > 0) written.set(p.slice(0, eq).trim().toLowerCase(), p.slice(0, eq).trim());
    }
    const byCode = new Map<string, ReviewRow>();
    const add = (code: string, name: string | null, value: string, platform: string | null) => {
      const ref = refsIn(value, defs)[0];
      const citation = ref ? citationOf(ref.body) : null;
      const scores = scoresOf(value, platform);
      const row = byCode.get(code.toLowerCase());
      if (row) {
        row.scores.push(...scores);
        row.citation ??= citation;
        return;
      }
      const made: ReviewRow = { table, code, outlet: name ?? outletOf(code, citation), aggregate: AGGREGATES.has(code.toUpperCase()), scores, citation };
      byCode.set(code.toLowerCase(), made);
      rows.push(made);
    };
    for (const [key, value] of named) {
      if (NOT_OUTLETS.test(key) || /^rev\d+(score)?(_.+)?$/.test(key) || !plain(value)) continue;
      // "NES = true": the table has a column for that platform.
      if (/^(true|yes|y)$/i.test(plain(value))) continue;
      const as = written.get(key) ?? key;
      const column = /^(.+?)_([A-Za-z0-9]+)$/.exec(as);
      add(column ? column[1]! : as, null, value, column ? column[2]! : null);
    }
    // rev1 = ''Games World'', rev1Score = 94/100 (or rev1_NES = 4/4, a platform's column): outlets with no code.
    for (let i = 1; i <= 40; i++) {
      const name = named.get(`rev${i}`);
      if (!name) continue;
      for (const [key, value] of named) {
        const m = new RegExp(`^rev${i}(?:score)?(?:_(.+))?$`).exec(key);
        if (!m || key === `rev${i}`) continue;
        const column = m[1] ? (/_([A-Za-z0-9]+)$/.exec(written.get(key) ?? key)?.[1] ?? m[1]) : null;
        add(`rev${i}`, plain(name), value, column);
      }
    }
  }
  return rows;
}

// ---------------------------------------------------------------------------------------------------------------
// Releases

/** The game's releases from its infobox: {{Video game release|JP|March 19, 1994|NA|...}}, under a platform's bold name when it has several. */
export function releasesOf(text: string): WikiRelease[] {
  const box = templatesIn(text).find((t) => t.name.startsWith('infobox video game'));
  if (!box) return [];
  const { named } = templateParams(box.body);
  const field = named.get('released') ?? named.get('release') ?? '';
  const out: WikiRelease[] = [];
  let platform: string | null = null;
  // Walk the field: a bold name ('''PS2''') sets the platform for the dates after it.
  const tokens = field.split(/('''[^']+''')/);
  for (const token of tokens) {
    const bold = /^'''([^']+)'''$/.exec(token);
    if (bold) {
      platform = plain(bold[1]!);
      continue;
    }
    for (const t of allTemplates(token)) {
      if (!/^(video game release|vgrelease|vgrelease new|vgr)$/.test(t.name)) continue;
      const { positional } = templateParams(t.body);
      for (let i = 0; i + 1 < positional.length; i += 2) {
        const date = articleDate(positional[i + 1]);
        if (date) out.push({ platform, region: plain(positional[i]!) || null, date });
      }
    }
    // Dates written out without a template ("April 20, 2006").
    if (!allTemplates(token).some((t) => /^(video game release|vgrelease|vgrelease new|vgr)$/.test(t.name))) {
      for (const t of allTemplates(token).filter((x) => x.name === 'start date')) {
        const { positional } = templateParams(t.body);
        const [y, mo, d] = positional;
        if (y && year(y)) out.push({ platform, region: null, date: [y, mo && pad(+mo), d && pad(+d)].filter(Boolean).join('-') });
      }
      const words = plain(token);
      for (const m of words.matchAll(/\b(?:[A-Z][a-z]{2,8}\.? \d{1,2}, \d{4}|\d{1,2} [A-Z][a-z]{2,8} \d{4}|[A-Z][a-z]{2,8} \d{4})\b/g)) {
        const date = articleDate(m[0]);
        if (date && !out.some((r) => r.date === date && r.platform === platform)) out.push({ platform, region: null, date });
      }
    }
  }
  return out;
}

/** The earliest of the releases: a full date over a month over a year, of the same moment. */
export function firstReleaseOf(releases: readonly WikiRelease[]): string | null {
  return [...releases.map((r) => r.date)].sort((a, b) => a.localeCompare(b))[0] ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Sections, sources and the games named

/** The article cut at its headings: each piece with its heading's path ("Reception > Sales"). */
function sections(text: string): { path: string; level: number; text: string }[] {
  const out: { path: string; level: number; text: string }[] = [];
  const stack: string[] = [];
  let at = 0;
  let current = { path: 'Lead', level: 1 };
  for (const m of text.matchAll(/^(={2,6})\s*(.+?)\s*\1\s*$/gm)) {
    out.push({ ...current, text: text.slice(at, m.index) });
    const level = m[1]!.length;
    stack.length = Math.max(0, level - 2);
    stack.push(plain(m[2]!));
    current = { path: stack.join(' > '), level };
    at = m.index! + m[0].length;
  }
  out.push({ ...current, text: text.slice(at) });
  return out;
}

/** Every dated citation in the article outside its review table, once each, with the section it's first cited in. */
export function sourcesOf(text: string, defs = namedRefs(text)): WikiSource[] {
  const box = templatesIn(text).find((t) => /^(video game reviews|vg reviews|video game multiple console reviews|vgr)$/.test(t.name));
  const outside = box ? text.slice(0, box.start) + text.slice(box.end) : text;
  const seen = new Set<string>();
  const out: WikiSource[] = [];
  for (const part of sections(outside)) {
    if (/^(references|notes|citations|external links|further reading|bibliography|works cited|sources)\b/i.test(part.path)) continue;
    for (const ref of refsIn(part.text, defs)) {
      const key = ref.name ?? ref.body;
      if (seen.has(key)) continue;
      seen.add(key);
      const c = citationOf(ref.body);
      if (c && c.date && (c.work || c.title)) out.push({ ...c, section: part.path });
    }
  }
  return out;
}

const BEFORE = /^(development|design|background|production|conception|inspiration|influences?|history)\b/i;
const AFTER = /^(legacy|influence|impact|sequels?|successors?|remakes?|follow-ups?|future|franchise|cultural impact|other media|re-?releases?)\b/i;

/**
 * In a section about the game's making or its legacy in general, a game counts only in a sentence that says how it's
 * related ("inspired by", "based on", "led to"...): a sentence about its rating or its sales names other games for other
 * reasons. A section about exactly that (Inspiration, Sequels, Influence) needs no such words.
 */
const CAME_FROM_CUES = /\b(inspir\w*|influenc\w*|based on|drew|draws?|drawn|predecessors?|prequels?|sequel to|successor to|follow(?:-up| up)? to|similar to|borrow\w*|homage|modell?ed|built on|original|previous|earlier|took cues|took inspiration|reference\w*|derived|spiritual|like (?:the|in|its)|took after|wanted to (?:make|create)|compared)\b/i;
const LED_TO_CUES = /\b(inspir\w*|influenc\w*|cited|led to|successors?|sequels?|remakes?|remaster\w*|follow(?:ed|-ups?|s)|spiritual|clones?|genre|similar|imitat\w*|homage|metroidvania|paved|pioneer\w*|tribute|reference\w*|borrow\w*|modell?ed|compared|spawned|precursor|template|blueprint)\b/i;
const SPECIFIC = /^(inspiration|influences?|sequels?|successors?|remakes?|follow-ups?|prequels?|spin-?offs?)\b/i;

/** The italic titles and links to other games in a section, each with the sentence it's in. */
function mentionsIn(text: string, own: Set<string>, cue: RegExp | null): WikiMention[] {
  const out: WikiMention[] = [];
  const seen = new Set<string>();
  const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(REF_FULL, '').replace(REF_SHORT, '');
  // Sentences, roughly: what's between full stops at the paragraph level.
  for (const paragraph of body.split(/\n+/)) {
    if (/^\s*[{|!]/.test(paragraph)) continue;
    for (const sentence of paragraph.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      if (cue && !cue.test(plain(sentence))) continue;
      const found: { title: string; article: string | null }[] = [];
      for (const m of sentence.matchAll(/''\[\[([^|\]]+)(?:\|([^\]]+))?\]\]''|\[\[([^|\]]+)\|''([^']+)''\]\]|''([^'[\]{}]{2,80})''/g)) {
        if (m[1]) found.push({ title: plain(m[2] ?? m[1]), article: m[1].trim() });
        else if (m[3]) found.push({ title: plain(m[4]!), article: m[3].trim() });
        else if (m[5]) found.push({ title: plain(m[5]), article: null });
      }
      for (const f of found) {
        const key = f.title.toLowerCase();
        if (!f.title || seen.has(key) || own.has(key) || f.title.length < 3 || /^(true|false|and|or|the)$/i.test(f.title) || !/^[\p{Lu}\p{N}]/u.test(f.title)) continue;
        seen.add(key);
        const context = plain(sentence);
        out.push({ title: f.title, article: f.article, context: context.length > 260 ? `${context.slice(0, 257)}…` : context });
      }
    }
  }
  return out;
}

/** The games the article names where it tells what the game came from, and what it led to. */
export function lineageOf(text: string, ownTitles: readonly string[], works: readonly string[] = []): { cameFrom: WikiMention[]; ledTo: WikiMention[] } {
  // The game itself, and the article's publications (its citations' magazines and sites), aren't games it names.
  const own = new Set([...ownTitles, ...works].map((t) => t.toLowerCase()));
  const cameFrom: WikiMention[] = [];
  const ledTo: WikiMention[] = [];
  for (const part of sections(text)) {
    const top = part.path.split(' > ')[0] ?? '';
    const leaf = part.path.split(' > ').at(-1) ?? '';
    const exact = SPECIFIC.test(leaf);
    if (BEFORE.test(top) || BEFORE.test(leaf)) cameFrom.push(...mentionsIn(part.text, own, exact ? null : CAME_FROM_CUES));
    else if (AFTER.test(top) || AFTER.test(leaf)) ledTo.push(...mentionsIn(part.text, own, exact ? null : LED_TO_CUES));
  }
  const unique = (list: WikiMention[]) => list.filter((m, i) => list.findIndex((x) => x.title.toLowerCase() === m.title.toLowerCase()) === i);
  return { cameFrom: unique(cameFrom).slice(0, 40), ledTo: unique(ledTo).slice(0, 40) };
}

/** Reads a game's article: its review table, releases, dated sources, and the games it names. */
export function readArticle(text: string, ownTitles: readonly string[] = []): RootsReading {
  const clean = text.replace(/<!--[\s\S]*?-->/g, '');
  const defs = namedRefs(clean);
  const releases = releasesOf(clean);
  const reviews = reviewTable(clean, defs);
  const sources = sourcesOf(clean, defs);
  const works = [...sources.map((x) => x.work), ...reviews.map((r) => r.outlet), ...reviews.map((r) => r.citation?.work)].filter((w): w is string => Boolean(w));
  const lineage = lineageOf(clean, ownTitles, works);
  return {
    version: ROOTS_READER_VERSION,
    releases,
    firstRelease: firstReleaseOf(releases),
    reviews,
    sources,
    cameFrom: lineage.cameFrom,
    ledTo: lineage.ledTo,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Best-selling lists

/** Wikipedia's best-selling list for each console that has one. */
export const BEST_SELLING_LISTS: Record<string, string> = {
  'nintendo-entertainment-system': 'List of best-selling Nintendo Entertainment System video games',
  famicom: 'List of best-selling Nintendo Entertainment System video games',
  'super-nintendo': 'List of best-selling Super Nintendo Entertainment System video games',
  'super-famicom': 'List of best-selling Super Nintendo Entertainment System video games',
  'nintendo-64': 'List of best-selling Nintendo 64 video games',
  'nintendo-gamecube': 'List of best-selling GameCube video games',
  wii: 'List of best-selling Wii video games',
  'wii-u': 'List of best-selling Wii U video games',
  'nintendo-switch': 'List of best-selling Nintendo Switch video games',
  'nintendo-switch-2': 'List of best-selling Nintendo Switch 2 games',
  'game-boy': 'List of best-selling Game Boy video games',
  'game-boy-color': 'List of best-selling Game Boy video games',
  'game-boy-advance': 'List of best-selling Game Boy Advance video games',
  'nintendo-ds': 'List of best-selling Nintendo DS video games',
  'nintendo-3ds': 'List of best-selling Nintendo 3DS video games',
  playstation: 'List of best-selling PlayStation video games',
  'playstation-2': 'List of best-selling PlayStation 2 video games',
  'playstation-3': 'List of best-selling PlayStation 3 video games',
  'playstation-4': 'List of best-selling PlayStation 4 video games',
  'playstation-5': 'List of best-selling PlayStation 5 video games',
  psp: 'List of best-selling PlayStation Portable video games',
  xbox: 'List of best-selling Xbox games',
  'xbox-360': 'List of best-selling Xbox 360 video games',
  'xbox-one': 'List of best-selling Xbox One video games',
  'sega-genesis': 'List of best-selling Sega Genesis games',
  'mega-drive-japan': 'List of best-selling Sega Genesis games',
  'mega-drive-pal': 'List of best-selling Sega Genesis games',
  'sega-dreamcast': 'List of best-selling Dreamcast games',
  'atari-2600': 'List of best-selling Atari 2600 video games',
  pc: 'List of best-selling PC games',
};

/** A best-selling list's games in its order: each one's article (the link in its row) and title, ranked from 1. */
export function bestSellingList(text: string): { article: string; title: string; rank: number }[] {
  const out: { article: string; title: string; rank: number }[] = [];
  const clean = text.replace(/<!--[\s\S]*?-->/g, '').replace(REF_FULL, '').replace(REF_SHORT, '');
  // The list's own tables: sortable ones that have a Game column.
  for (const table of `\n${clean}`.split(/\n\{\|/).slice(1)) {
    const body = table.split(/\n\|\}/)[0]!;
    const head = body.split('\n')[0] ?? '';
    if (!/sortable/.test(head) || !/!\s*(?:scope="col"\s*\|)?\s*(?:Game|Title)/i.test(body)) continue;
    for (const row of body.split(/\n\|-[^\n]*/).slice(1)) {
      if (/static-row-header/.test(row) || /^\s*!scope="col"/m.test(row)) continue;
      const link = /\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|([^\]]+))?\]\]/.exec(row);
      if (!link) continue;
      const article = link[1]!.trim();
      if (out.some((g) => g.article === article)) continue;
      out.push({ article, title: plain(link[2] ?? link[1]!), rank: out.length + 1 });
    }
    if (out.length > 0) break;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Platforms in the review table

/** How review tables write consoles, beyond the short names Squirrelcade already knows. */
const TABLE_NAMES: Record<string, string[]> = {
  'nintendo-entertainment-system': ['nes'],
  'super-nintendo': ['snes', 'sfc'],
  'nintendo-64': ['n64'],
  'nintendo-gamecube': ['gc', 'ngc', 'gcn', 'gamecube'],
  wii: ['wii'],
  'wii-u': ['wii u', 'wiiu'],
  'nintendo-switch': ['ns', 'nsw', 'switch'],
  'nintendo-switch-2': ['ns2', 'switch 2'],
  'game-boy': ['gb'],
  'game-boy-color': ['gbc'],
  'game-boy-advance': ['gba'],
  'sega-genesis': ['gen', 'genesis', 'md', 'mega drive'],
  'sega-saturn': ['sat', 'saturn'],
  'sega-dreamcast': ['dc', 'dreamcast'],
  'playstation-vita': ['vita', 'psv'],
  famicom: ['fc', 'famicom'],
  'super-famicom': ['sfc', 'snes'],
  'turbografx-16': ['tg16', 'tg 16', 'pce'],
  'nintendo-ds': ['ds', 'nds'],
  'nintendo-3ds': ['3ds'],
  playstation: ['ps', 'ps1', 'psx'],
  'playstation-2': ['ps2'],
  'playstation-3': ['ps3'],
  'playstation-4': ['ps4'],
  'playstation-5': ['ps5'],
  psp: ['psp'],
  xbox: ['xbox', 'xb'],
  'xbox-360': ['x360', 'xbox 360', '360'],
  'xbox-one': ['xone', 'xbox one', 'xb1'],
  'xbox-series-x': ['xsxs', 'xsx', 'xbox series x s', 'xbox series x', 'series x s'],
  pc: ['pc', 'win', 'windows'],
};

/** Whether a review table's platform label ("PS2", "Xbox 360", "NS") is the console. */
export function reviewPlatformFits(label: string, platformKey: string, platformName: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const want = norm(label);
  const names = [norm(platformName), norm(platformKey.replace(/-/g, ' ')), ...(PLATFORM_SHORT_NAMES[platformKey] ?? []).map(norm), ...(TABLE_NAMES[platformKey] ?? [])];
  return names.includes(want);
}

/** Metacritic's score for the console from the review table: its platform's, or the only one. */
export function metacriticFor(reviews: readonly ReviewRow[], platformKey: string, platformName: string): number | null {
  const mc = reviews.find((r) => r.code.toUpperCase() === 'MC');
  if (!mc) return null;
  const num = (s: string) => {
    const m = /(\d{1,3})\s*\/\s*100/.exec(s) ?? /^(\d{1,3})\b/.exec(s.trim());
    return m ? Number(m[1]) : null;
  };
  const mine = mc.scores.find((s) => s.platform !== null && reviewPlatformFits(s.platform, platformKey, platformName));
  if (mine) return num(mine.score);
  // The only score, given for no platform in particular: the game's.
  const whole = mc.scores.filter((s) => s.platform === null);
  return whole.length === 1 && mc.scores.length === 1 ? num(whole[0]!.score) : null;
}
