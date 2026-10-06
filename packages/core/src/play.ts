/**
 * What the owner has played (0.6.0): a status and a rating per game on a console, kept beside the collection
 * (PriceCharting doesn't know it). The backlog is what's owned and not played yet.
 */

/** Where the owner is with a game. */
export type PlayStatus = 'backlog' | 'playing' | 'beaten' | 'completed' | 'dropped' | 'shelf';

/** The statuses in the order they're offered, with their names. */
export const PLAY_STATUSES: readonly { value: PlayStatus; label: string; short: string }[] = [
  { value: 'backlog', label: 'Not played yet', short: 'Not played' },
  { value: 'playing', label: 'Playing', short: 'Playing' },
  { value: 'beaten', label: 'Beaten', short: 'Beaten' },
  { value: 'completed', label: 'Completed (everything)', short: 'Completed' },
  { value: 'dropped', label: 'Dropped', short: 'Dropped' },
  { value: 'shelf', label: 'Just for the shelf', short: 'Shelf' },
];

export const PLAY_LABELS: Record<PlayStatus, string> = Object.fromEntries(PLAY_STATUSES.map((s) => [s.value, s.label])) as Record<PlayStatus, string>;

export const isPlayStatus = (value: unknown): value is PlayStatus => typeof value === 'string' && PLAY_STATUSES.some((s) => s.value === value);

/** Statuses that mean the owner has finished with the game (beaten, completed). */
export const FINISHED: ReadonlySet<PlayStatus> = new Set(['beaten', 'completed']);

/**
 * Whether a game is in the backlog: marked "Not played yet", or (when the setting counts them) not marked at all.
 * Playing, beaten, completed, dropped and shelf games never are.
 */
export function inBacklog(status: PlayStatus | null, unmarkedCount: boolean): boolean {
  return status === 'backlog' || (status === null && unmarkedCount);
}

/**
 * The days a status sets when it's chosen: starting a game dates its start, finishing one dates its end (keeping
 * dates already set), and going back to "Not played yet" clears both.
 */
export function playDates(
  status: PlayStatus | null,
  before: { startedAt: string | null; finishedAt: string | null },
  today: string,
): { startedAt: string | null; finishedAt: string | null } {
  if (status === 'backlog') return { startedAt: null, finishedAt: null };
  if (status === 'playing') return { startedAt: before.startedAt ?? today, finishedAt: null };
  if (status === 'beaten' || status === 'completed') return { startedAt: before.startedAt, finishedAt: before.finishedAt ?? today };
  return before;
}
