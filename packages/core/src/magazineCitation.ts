/**
 * A review's citation, found in the owner's magazines (D191): the magazine its work names ("EGM" is Electronic Gaming
 * Monthly), the month its date gives, and the printed page it cites.
 */

/** Other names Wikipedia cites a magazine by, each a magazine's name as Leaves knows it. */
const ALIASES: Record<string, string[]> = {
  'electronic gaming monthly': ['egm', 'egm2', 'electronic gaming monthly'],
  'nintendo power': ['nintendo power', 'np'],
  gamepro: ['gamepro', 'game pro'],
  'game informer': ['game informer', 'gameinformer', 'gi'],
  'next generation': ['next generation', 'next generation magazine', 'next gen', 'nextgen'],
  gamefan: ['gamefan', 'diehard gamefan', 'die hard game fan', 'game fan'],
  'computer gaming world': ['computer gaming world', 'cgw'],
  'official us playstation magazine': ['official us playstation magazine', 'official u s playstation magazine', 'opm', 'official playstation magazine', 'official playstation magazine us'],
  'playstation the official magazine': ['playstation the official magazine', 'playstation official magazine', 'ps the official magazine'],
  'electronic games': ['electronic games'],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\[\[|\]\]|''+/g, '')
    .replace(/\|.*$/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/^the /, '')
    .trim();

/** The owner's magazine a citation's work is, among the magazines' names in Leaves; null when none. */
export function magazineOf(work: string, magazines: readonly string[]): string | null {
  const w = norm(work);
  if (!w) return null;
  for (const name of magazines) {
    const n = norm(name);
    if (n === w || (ALIASES[n] ?? []).includes(w)) return name;
  }
  return null;
}

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** The year and month a citation's date gives ("1994-06", "1994-06-01", "June 1994", "June/July 1994"). */
export function citationMonth(date: string | null): { year: number; month: number | null } | null {
  if (!date) return null;
  const iso = /^(\d{4})(?:-(\d{2}))?/.exec(date.trim());
  if (iso) return { year: Number(iso[1]), month: iso[2] ? Number(iso[2]) : null };
  const named = new RegExp(`\\b(${MONTHS.join('|')}|${MONTHS.map((m) => m.slice(0, 3)).join('|')})\\b[^0-9]*(\\d{4})`, 'i').exec(date);
  if (named) {
    const m = MONTHS.findIndex((x) => x.startsWith(named[1]!.toLowerCase().slice(0, 3)));
    return { year: Number(named[2]), month: m + 1 };
  }
  const year = /\b(19|20)\d{2}\b/.exec(date);
  return year ? { year: Number(year[0]), month: null } : null;
}

/** The first printed page a citation names ("28", "pp. 28-30", "p. 28"); null when none. */
export function printedPage(page: string | null): number | null {
  const m = /\d+/.exec(page ?? '');
  return m ? Number(m[0]) : null;
}

/** An issue number a citation names ("#61", "61", "No. 61"); null when it isn't one. */
export function citedIssueNumber(issue: string | null): number | null {
  const m = /^\D{0,6}(\d{1,4})\b/.exec((issue ?? '').trim());
  return m ? Number(m[1]) : null;
}
