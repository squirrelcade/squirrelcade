import { normalizeTitle } from './text.js';

/**
 * Check a shelf (D147): what a text reader (or a vision model) read on a photo of game spines, matched against one
 * console's closed list of games. Readers run words together and slip on letters, so spaces don't matter and small
 * slips are forgiven; numbers never are (Assassin's Creed II is never III: every character of a title's number must
 * be read, with nothing extra beside it); and a read that could be the start of several games ("UNCHARTED",
 * "DARKSIDERS") is unsure. A wrong "you don't have it" is how a duplicate gets bought, so whatever isn't certain is
 * unsure, with its best guess. Ownership is the caller's: this only says which game each spine is.
 */

/** A game a spine can be: the caller's key for it, and its title. */
export interface ShelfGame {
  key: string;
  title: string;
}

/** One line of text read on the photo. */
export interface ShelfRead {
  text: string;
  /** The reader's own confidence, 0 to 1; reads under 0.5 are left out. */
  score: number;
  /** Read by a vision model, which reads whole spines: no cut-off doubt. */
  model?: boolean;
}

/** Why a match stayed unsure. */
export type ShelfDoubt = 'not-close' | 'number' | 'or' | 'cut-off';

export interface ShelfMatch {
  key: string;
  title: string;
  /** The text read. */
  read: string;
  /** How close the read is to the title, 0 to 1. */
  likeness: number;
  /** Set when unsure: why, and the other game it could be. */
  doubt?: ShelfDoubt;
  other?: string;
}

export interface ShelfResult {
  sure: ShelfMatch[];
  unsure: ShelfMatch[];
  /** The reads long enough to try. */
  reads: number;
}

const ROMAN: Record<string, string> = { ii: '2', iii: '3', iv: '4', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12', xiii: '13', xiv: '14', xv: '15', xvi: '16' };

/** A title as compact text, with the places of its number's characters: Roman numerals kept as letters, or as digits. */
interface Form {
  text: string;
  numeral: Set<number>;
  whole?: boolean;
  /** Its pairs of letters, for finding candidates fast. */
  pairs?: Map<string, number>;
}

function formsOf(title: string): Form[] {
  const tokens = normalizeTitle(title.replace(/['’`]s\b/gi, 's')).split(' ').filter(Boolean);
  const isNumber = (t: string, i: number) => /^\d+$/.test(t) || t in ROMAN || ((t === 'i' || t === 'v') && i === tokens.length - 1 && i > 0);
  const build = (asDigits: boolean): Form => {
    let text = '';
    const numeral = new Set<number>();
    tokens.forEach((t, i) => {
      const word = asDigits && isNumber(t, i) ? (ROMAN[t] ?? (t === 'i' ? '1' : t === 'v' ? '5' : t)) : t;
      if (isNumber(t, i)) for (let k = 0; k < word.length; k++) numeral.add(text.length + k);
      text += word;
    });
    return { text, numeral };
  };
  return [build(false), build(true)];
}

/** A title without the edition at its end ("Snoopy & the Great Mystery Club Deluxe Edition"). */
export function withoutEdition(title: string): string {
  return title
    .replace(/\s*[-–:]?\s*(?:deluxe|definitive|complete|ultimate|royal|gold|signature|anniversary|special|enhanced|launch|day one|collector['’]?s|game of the year|goty)\s+edition\s*$/i, '')
    .replace(/\s*[-–:]?\s*(?:director['’]?s cut|remastered|the final cut)\s*$/i, '')
    .trim();
}

function pairsOf(text: string): Map<string, number> {
  const pairs = new Map<string, number>();
  for (let i = 0; i + 1 < text.length; i++) {
    const p = text.slice(i, i + 2);
    pairs.set(p, (pairs.get(p) ?? 0) + 1);
  }
  return pairs;
}

/** A title's forms: whole, without its console edition, brand or edition, and before its subtitle (spines often show only the main title). */
function allForms(title: string): Form[] {
  const base = title.split(/:| - | – /)[0]!;
  // Without the console's edition and what's bundled in ("- Nintendo Switch 2 Edition + Star-Crossed World").
  const plain = title.replace(/\s*\+.*$/, '').replace(/\s*[-–]?\s*Nintendo Switch 2 Edition.*$/i, '').trim();
  // Without a brand in front ("EA SPORTS Madden NFL 26") or an edition at the end ("- Royal Edition").
  const unbranded = withoutEdition(plain.replace(/^(?:EA SPORTS|EA|2K|Sid Meier['’]?s|Tom Clancy['’]?s)\s+/i, ''));
  const forms = [
    ...formsOf(title).map((f) => ({ ...f, whole: true })),
    ...(plain !== title ? formsOf(plain) : []),
    ...(unbranded !== plain ? formsOf(unbranded) : []),
    ...(base !== title ? formsOf(base) : []),
  ].filter((f) => f.text.length >= 4);
  return forms.filter((f, i) => forms.findIndex((g) => g.text === f.text) === i).map((f) => ({ ...f, pairs: pairsOf(f.text) }));
}

/** Edit distance between a read and a form, and whether the form's number came through exactly. */
function compare(read: string, form: Form): { likeness: number; numberRead: boolean } {
  const a = read;
  const b = form.text;
  const w = b.length + 1;
  const d = new Uint16Array((a.length + 1) * w);
  for (let j = 0; j <= b.length; j++) d[j] = j;
  for (let i = 1; i <= a.length; i++) {
    d[i * w] = i;
    for (let j = 1; j <= b.length; j++) d[i * w + j] = Math.min(d[(i - 1) * w + j]! + 1, d[i * w + j - 1]! + 1, d[(i - 1) * w + j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const at = (i: number, j: number) => d[i * w + j]!;
  const likeness = 1 - at(a.length, b.length) / Math.max(a.length, b.length);
  if (form.numeral.size === 0) return { likeness, numberRead: (a.match(/\d+/g) ?? []).every((n) => b.includes(n)) };
  // Walk back the alignment: each character of the number matched as itself, nothing inserted beside it.
  let i = a.length;
  let j = b.length;
  let ok = true;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && at(i, j) === at(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      if (form.numeral.has(j - 1) && a[i - 1] !== b[j - 1]) ok = false;
      i--;
      j--;
    } else if (j > 0 && at(i, j) === at(i, j - 1) + 1) {
      if (form.numeral.has(j - 1)) ok = false; // the number's character wasn't read
      j--;
    } else {
      // A digit, or a Roman numeral's letter, read beside the number makes it another number (II read as III).
      if ((form.numeral.has(j - 1) || form.numeral.has(j)) && /[\divx]/.test(a[i - 1]!)) ok = false;
      i--;
    }
  }
  return { likeness, numberRead: ok };
}

/** A read as compact text: spaces gone, O read for 0 and l or I for 1 beside a digit. */
function compact(text: string): string {
  return normalizeTitle(text.replace(/['’`]s\b/gi, 's'))
    .replace(/ /g, '')
    .replace(/o(?=\d)|(?<=\d)o/g, '0')
    .replace(/[li](?=\d)|(?<=\d)[li]/g, '1');
}

interface Indexed {
  game: ShelfGame;
  forms: Form[];
}

/** The games' forms, built once for any number of photos. */
export class ShelfMatcher {
  private readonly index: Indexed[];
  /** For each pair of letters, the games whose forms have it. */
  private readonly byPair = new Map<string, number[]>();

  constructor(games: ShelfGame[]) {
    this.index = games.map((game) => ({ game, forms: allForms(game.title) }));
    this.index.forEach((x, n) => {
      const seen = new Set<string>();
      for (const f of x.forms) for (const p of f.pairs!.keys()) seen.add(p);
      for (const p of seen) {
        const list = this.byPair.get(p);
        if (list) list.push(n);
        else this.byPair.set(p, [n]);
      }
    });
  }

  /** The games that share enough pairs of letters with a read to be within reach (an edit spoils at most two pairs). */
  private candidates(reads: string[]): Indexed[] {
    const shared = new Map<number, number>();
    for (const r of reads)
      for (const p of pairsOf(r).keys())
        for (const n of this.byPair.get(p) ?? []) shared.set(n, (shared.get(n) ?? 0) + 1);
    const shortest = Math.min(...reads.map((r) => r.length));
    // Likeness 0.55 (the least a rival can have) allows edits up to 45% of the longer text; generous on purpose.
    const need = Math.max(1, Math.floor((shortest - 1) * 0.25));
    return [...shared].filter(([, k]) => k >= need).map(([n]) => this.index[n]!);
  }

  /** Each line read on one photo matched to the games: sure ones, and unsure ones with their best guess. */
  match(lines: ShelfRead[]): ShelfResult {
    const sure = new Map<string, ShelfMatch>();
    const unsure = new Map<string, ShelfMatch>();
    let count = 0;
    for (const line of lines) {
      if (line.score < 0.5) continue;
      const read = compact(line.text);
      if (read.length < 4) continue;
      count++;
      // The read as it is, and without an edition at its end ("... Deluxe Edition" on the spine, not in the list).
      const bare = normalizeTitle(withoutEdition(line.text).replace(/['’`]s\b/gi, 's')).replace(/ /g, '');
      const tries = bare && bare !== read && bare.length >= 4 ? [read, bare] : [read];
      const scored = this.candidates(tries)
        .map((x) => {
          let best = { likeness: 0, numberRead: false, whole: false };
          for (const f of x.forms) {
            for (const r of tries) {
              const c = compare(r, f);
              if (c.likeness > best.likeness || (c.likeness === best.likeness && (c.numberRead || f.whole))) best = { ...c, whole: Boolean(f.whole) };
            }
          }
          return { x, ...best };
        })
        .sort((p, q) => q.likeness - p.likeness);
      let top = scored[0];
      // The start of exactly one game's title, long enough, is that game ("REMEMBER" is Remember Me), but only when
      // the read is most of the title with no number left unread ("NINTENDO" isn't Nintendo Switch Sports).
      if (read.length >= 7 && (!top || top.likeness < 0.95)) {
        const startOf = (f: Form) => f.text.length > read.length && read.length >= 0.6 * f.text.length;
        const starts = this.index.filter((x) => x.forms.some((f) => startOf(f) && f.text[0] === read[0] && compare(read, { text: f.text.slice(0, read.length), numeral: new Set() }).likeness >= 0.95));
        if (starts.length === 1) {
          const rest = starts[0]!.forms.find(startOf)!.text.slice(read.length);
          top = { x: starts[0]!, likeness: 0.95, whole: false, numberRead: !/\d/.test(read) && !/\d/.test(rest) };
        }
      }
      if (!top || top.likeness < 0.6) continue;
      const chosen = top;
      // Another game this read could also be: as close, or one this read could be the cut-off start of.
      // The same title on another console isn't a rival: the caller's list may hold several consoles.
      const rival = scored.find((s) => s.x.game.title !== chosen.x.game.title && s.likeness >= chosen.likeness - 0.05 && s.numberRead && !(chosen.whole && chosen.likeness === 1 && !(s.whole && s.likeness === 1)));
      // A model reads whole spines; a text reader may stop short. The number counts here too (0 isn't II).
      const cutOff = line.model
        ? undefined
        : this.index.find(
            (x) =>
              x.game.title !== chosen.x.game.title &&
              x.forms.some((f) => {
                if (f.text.length <= read.length || chosen.x.forms.some((g) => g.text === f.text)) return false;
                const start = f.text.slice(0, read.length);
                // Most of the start must be there before the full comparison (fast for thousands of games).
                if (start[0] !== read[0] && start[1] !== read[1]) return false;
                const c = compare(read, { text: start, numeral: new Set([...f.numeral].filter((n) => n < read.length)) });
                return c.numberRead && c.likeness >= Math.min(0.9, chosen.likeness - 0.02);
              }),
          );
      const needed = read.length <= 6 ? 0.95 : 0.82;
      const doubt: ShelfDoubt | undefined = chosen.likeness < needed ? 'not-close' : !chosen.numberRead ? 'number' : rival ? 'or' : cutOff ? 'cut-off' : undefined;
      const other = doubt === 'or' ? rival!.x.game.title : doubt === 'cut-off' ? cutOff!.game.title : undefined;
      const found: ShelfMatch = {
        key: chosen.x.game.key,
        title: chosen.x.game.title,
        read: line.text,
        likeness: Math.round(chosen.likeness * 100) / 100,
        ...(doubt ? { doubt } : {}),
        ...(other ? { other } : {}),
      };
      // A short or far-off partial read is noise, not a guess worth listing ("RAGD" isn't worth "Rage?").
      if (doubt === 'not-close' && (read.length <= 6 || chosen.likeness < 0.7)) continue;
      const map = doubt ? unsure : sure;
      const was = map.get(found.key);
      if (!was || was.likeness < found.likeness) map.set(found.key, found);
    }
    for (const key of sure.keys()) unsure.delete(key);
    return {
      sure: [...sure.values()].sort((a, b) => a.title.localeCompare(b.title)),
      unsure: [...unsure.values()].sort((a, b) => b.likeness - a.likeness),
      reads: count,
    };
  }
}

/** One photo's reads matched against a list of games (see ShelfMatcher to reuse the list's forms). */
export function matchShelf(lines: ShelfRead[], games: ShelfGame[]): ShelfResult {
  return new ShelfMatcher(games).match(lines);
}
