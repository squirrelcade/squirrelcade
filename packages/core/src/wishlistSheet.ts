import { csvDelimiter, parseCsv } from './csv.js';
import type { GameDetails } from './wishlist.js';

/**
 * Wishlist data from a spreadsheet (1.5.0, T-278): a tab saved as CSV, read by its column headings. Four kinds, the
 * shapes of a wishlist kept in a spreadsheet before Squirrelcade (the old system's tabs among them):
 * - rules: numbered buying rules in words (Rule ID, Category, Rule, Applies to, Rule type, Status, Notes);
 * - exclusions: games not to recommend (Title, Console, Action, Ignore Until, Reconsider Below, Reason, Status);
 * - preferences: the owner's say on a game (Title, Console, Owner Preference, Owner Note, Review After, Exclusion?);
 * - details: what's known about a game for its acorns (Title, Console, Primary Genre, Subgenre / Style, Licensed
 *   Tie-in, Japanese Developed, Offbeat, NA Physical, Personal Interest, Series Completion, Series Gap Remaining,
 *   Release Class, Platform Significance, Market Urgency, Franchise, Physical Proof, Evidence / Notes, Status).
 * Only reading here: what's added, and never over what the owner set, is the server's (wishlistImport.ts).
 */
export type SheetKind = 'rules' | 'exclusions' | 'preferences' | 'details';

export interface SheetRule {
  ref: string;
  title: string;
  text: string;
  kind: 'rule' | 'preference';
  area: string;
  notes: string;
  active: boolean;
}

export interface SheetExclusion {
  title: string;
  console: string;
  action: 'exclude' | 'hide' | 'defer' | 'below-price';
  until: string | null;
  belowCents: number | null;
  reason: string;
  active: boolean;
}

export interface SheetPreference {
  title: string;
  console: string;
  preference: string;
  note: string;
  /** Not to be recommended until this date (YYYY-MM-DD), when set. */
  reviewAfter: string | null;
  /** Kept off the wishlist ("Recommendation Exclusion?" yes). */
  exclude: boolean;
  active: boolean;
}

export interface SheetDetails {
  title: string;
  console: string;
  details: GameDetails;
  active: boolean;
}

export type SheetRead =
  | { kind: 'rules'; rows: SheetRule[]; skipped: number }
  | { kind: 'exclusions'; rows: SheetExclusion[]; skipped: number }
  | { kind: 'preferences'; rows: SheetPreference[]; skipped: number }
  | { kind: 'details'; rows: SheetDetails[]; skipped: number }
  | { kind: null; problem: string };

/** A heading as compared: lowercase letters and digits only ("Notes / exceptions" -> "notesexceptions"). */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** The names a column goes by, first match wins. */
const COLUMNS = {
  ref: ['ruleid', 'id', 'ref', 'number'],
  category: ['category', 'title', 'name', 'rulename'],
  rule: ['wishlistrule', 'rule', 'text', 'buyingrule'],
  appliesTo: ['appliesto', 'scope', 'area'],
  ruleType: ['ruletype', 'type', 'kind'],
  notes: ['notesexceptions', 'notes', 'evidencenotes', 'ownernote', 'note'],
  status: ['status', 'active', 'metadatastatus'],
  title: ['title', 'canonicaltitle', 'game', 'name'],
  console: ['console', 'platform', 'system'],
  action: ['action'],
  until: ['ignoreuntil', 'until', 'deferuntil', 'reviewafter'],
  below: ['reconsiderbelow', 'belowprice', 'reportbelow'],
  reason: ['reason'],
  preference: ['ownerpreference', 'preference', 'priority', 'manualpriority'],
  excludeFlag: ['recommendationexclusion', 'exclude', 'exclusion'],
  genre: ['primarygenre', 'genre'],
  style: ['subgenrestyle', 'subgenre', 'style'],
  tieIn: ['licensedtiein', 'tiein'],
  japanese: ['japanesedeveloped'],
  offbeat: ['offbeat'],
  naPhysical: ['naphysical', 'northamericanphysical'],
  interest: ['personalinterest', 'interest'],
  seriesCompletes: ['seriescompletion'],
  seriesRemaining: ['seriesgapremaining', 'seriesremaining'],
  releaseClass: ['releaseclass'],
  significance: ['platformsignificance', 'significance'],
  urgency: ['marketurgency', 'urgency'],
  franchise: ['franchise', 'series'],
  proof: ['physicalproof'],
} as const;

type Col = keyof typeof COLUMNS;

/** Reads one CSV tab; says what kind it is, or why it isn't one Squirrelcade knows. */
export function readWishlistSheet(text: string): SheetRead {
  const all = parseCsv(text, csvDelimiter(text)).filter((r) => r.some((c) => c.trim() !== ''));
  // The heading row: the first with a title-and-console pair, or a rule column (a tab may start with a title line).
  const at = all.findIndex((r) => {
    const h = new Set(r.map(norm));
    return (h.has('title') || h.has('canonicaltitle')) && h.has('console') ? true : h.has('ruleid') || (h.has('wishlistrule') && h.has('category'));
  });
  if (at < 0) return { kind: null, problem: 'No heading row Squirrelcade knows: a sheet of games needs Title and Console columns, a sheet of rules Rule ID and Rule.' };
  const heads = all[at]!.map(norm);
  const index = (c: Col): number => {
    for (const name of COLUMNS[c]) {
      const i = heads.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };
  const has = (c: Col) => index(c) >= 0;
  const rows = all.slice(at + 1);
  const get = (r: string[], c: Col) => {
    const i = index(c);
    return i < 0 ? '' : (r[i] ?? '').trim();
  };
  const yes = (v: string) => /^(y|yes|true|1|x|✓)$/i.test(v.trim());
  const activeOf = (r: string[]) => {
    const v = get(r, 'status');
    return v === '' || !/^(inactive|no|false|0|off|retired)$/i.test(v);
  };

  if (has('ref') && has('rule')) {
    const out: SheetRule[] = [];
    let skipped = 0;
    for (const r of rows) {
      const text = get(r, 'rule');
      if (!text) {
        skipped++;
        continue;
      }
      const type = get(r, 'ruleType').toLowerCase();
      out.push({ ref: get(r, 'ref'), title: get(r, 'category') || get(r, 'ref'), text, kind: /hard|must|rule/.test(type) && !/prefer/.test(type) ? 'rule' : 'preference', area: get(r, 'appliesTo'), notes: get(r, 'notes'), active: activeOf(r) });
    }
    return { kind: 'rules', rows: out, skipped };
  }

  const game = (r: string[]) => ({ title: get(r, 'title'), console: get(r, 'console') });
  if (has('action')) {
    const out: SheetExclusion[] = [];
    let skipped = 0;
    for (const r of rows) {
      const { title, console } = game(r);
      const action = actionOf(get(r, 'action'));
      if (!title || !console || !action) {
        skipped++;
        continue;
      }
      const below = centsOf(get(r, 'below'));
      out.push({ title, console, action, until: dateOf(get(r, 'until')), belowCents: below, reason: get(r, 'reason'), active: activeOf(r) });
    }
    return { kind: 'exclusions', rows: out, skipped };
  }

  if (has('preference')) {
    const out: SheetPreference[] = [];
    let skipped = 0;
    for (const r of rows) {
      const { title, console } = game(r);
      if (!title || !console) {
        skipped++;
        continue;
      }
      out.push({ title, console, preference: get(r, 'preference'), note: get(r, 'notes'), reviewAfter: dateOf(get(r, 'until')), exclude: yes(get(r, 'excludeFlag')), active: activeOf(r) });
    }
    return { kind: 'preferences', rows: out, skipped };
  }

  if (has('releaseClass') || has('interest') || has('significance') || has('urgency') || has('genre')) {
    const out: SheetDetails[] = [];
    let skipped = 0;
    for (const r of rows) {
      const { title, console } = game(r);
      if (!title || !console) {
        skipped++;
        continue;
      }
      const d: GameDetails = {};
      const flag = (c: Col, key: 'tieIn' | 'japaneseDeveloped' | 'offbeat' | 'naPhysical' | 'seriesCompletes') => {
        const v = get(r, c);
        if (v) d[key] = yes(v);
      };
      const word = (c: Col, key: 'genre' | 'style' | 'franchise' | 'physicalProof' | 'notes' | 'personalInterest' | 'significance' | 'marketUrgency' | 'releaseClass', unknown: readonly string[] = []) => {
        const v = get(r, c);
        if (v && !unknown.includes(v.toLowerCase())) d[key] = v;
      };
      word('genre', 'genre');
      word('style', 'style');
      flag('tieIn', 'tieIn');
      flag('japanese', 'japaneseDeveloped');
      flag('offbeat', 'offbeat');
      flag('naPhysical', 'naPhysical');
      // Unknown or "no change" values say nothing: they're left out, so they never stand in for something set later.
      word('interest', 'personalInterest', ['neutral', 'unknown', '']);
      const completes = get(r, 'seriesCompletes');
      if (completes && yes(completes)) d.seriesCompletes = true;
      const left = Number.parseInt(get(r, 'seriesRemaining'), 10);
      if (Number.isFinite(left) && left >= 0) d.seriesRemaining = left;
      word('releaseClass', 'releaseClass');
      word('significance', 'significance', ['standard', 'unknown']);
      word('urgency', 'marketUrgency', ['review', 'unknown']);
      word('franchise', 'franchise');
      word('proof', 'physicalProof');
      word('notes', 'notes');
      out.push({ title, console, details: d, active: activeOf(r) });
    }
    return { kind: 'details', rows: out, skipped };
  }
  return { kind: null, problem: 'A sheet of games, but not one Squirrelcade knows: it needs an Action column (games not to recommend), an Owner Preference column, or wishlist facts such as Release Class or Personal Interest.' };
}

/** The old system's Ignore List actions and plainer words for them. */
function actionOf(v: string): SheetExclusion['action'] | null {
  const s = v.toLowerCase();
  if (/exclude|not a target|collection target/.test(s)) return 'exclude';
  if (/hide/.test(s)) return 'hide';
  if (/defer|snooze|until/.test(s)) return 'defer';
  if (/below|price/.test(s)) return 'below-price';
  return null;
}

/** "$20.58", "20", "20.5" -> cents; anything else null. */
function centsOf(v: string): number | null {
  const m = /^\$?\s*(\d+(?:\.\d{1,2})?)$/.exec(v.replace(/,/g, '').trim());
  return m ? Math.round(Number(m[1]) * 100) : null;
}

/** A date as YYYY-MM-DD ("2026-12-01", "12/1/2026"), else null. */
function dateOf(v: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim());
  if (us) return `${us[3]}-${us[1]!.padStart(2, '0')}-${us[2]!.padStart(2, '0')}`;
  return null;
}
