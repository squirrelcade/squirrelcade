/** Store Mode's answer for one game on one console (see apps/server/src/lookup.ts). */
export type Answer = 'need' | 'unconfirmed' | 'own' | 'own-elsewhere' | 'check' | 'not-a-target' | 'own-not-in-catalog' | 'not-tracked';

/** How each answer reads and its badge color, in Store Mode and the header's search. */
export const ANSWERS: Record<Answer, { label: string; color: string }> = {
  need: { label: 'Need it', color: 'green' },
  unconfirmed: { label: 'Need it if physical', color: 'teal' },
  own: { label: 'You own this', color: 'blue' },
  'own-not-in-catalog': { label: 'You own this', color: 'blue' },
  'own-elsewhere': { label: 'Owned on another console', color: 'yellow' },
  check: { label: 'Maybe owned: check', color: 'orange' },
  'not-a-target': { label: 'Not a collecting target', color: 'gray' },
  'not-tracked': { label: 'Not tracked', color: 'gray' },
};

/** How an owned copy counts as a catalog's game (see MatchMethod in packages/core/src/catalog.ts). */
export type MatchMethod = 'exact' | 'variant' | 'alias' | 'spelling' | 'short' | 'mapping' | 'confirmed' | 'pending' | 'crossgen';

/** Each way of counting as it reads on a console's page and in the game drawer. */
export const MATCH_METHODS: Record<MatchMethod, string> = {
  exact: 'Same title',
  variant: 'Edition',
  alias: 'Other name',
  spelling: 'Spelled differently',
  short: 'Without its subtitle',
  mapping: 'Mapping',
  confirmed: 'You confirmed',
  pending: 'Just bought',
  crossgen: 'Other generation',
};

/** The ways of counting that can be wrong, and so offer "not the same". */
export const REJECTABLE: ReadonlySet<string> = new Set(['variant', 'alias', 'spelling', 'short']);

/** How long a game can be snoozed on the wishlists. */
export const SNOOZES = [
  ['1 month', 1],
  ['3 months', 3],
  ['6 months', 6],
  ['1 year', 12],
] as const;

/** The date a number of months from today, as YYYY-MM-DD. */
export function monthsFromNow(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}
