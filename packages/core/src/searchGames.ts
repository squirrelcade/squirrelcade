import { baseTitle } from './catalog.js';
import { matchKey } from './text.js';

/**
 * The key a search's answers are one game by (D175): its title without notes in square brackets ("Call of Duty 3
 * [Platinum Hits]" is "Call of Duty 3"), compared as catalogs compare titles ("Call of Duty Black Ops" is "Call of
 * Duty: Black Ops").
 */
export function searchGameKey(title: string): string {
  return matchKey(baseTitle(title)) || title;
}

/**
 * Answers in the search's order as games (T-407): each game with every one of its answers, in the order each game's
 * best answer came. A page of games keeps all of a game's consoles, so none is cut off by other games' answers.
 */
export function answersByGame<T extends { title: string }>(answers: readonly T[]): { key: string; answers: T[] }[] {
  const games = new Map<string, T[]>();
  for (const a of answers) {
    const key = searchGameKey(a.title);
    const list = games.get(key);
    if (list) list.push(a);
    else games.set(key, [a]);
  }
  return [...games].map(([key, list]) => ({ key, answers: list }));
}

/** A search by game's page (T-407): every answer of its first `games` games, how many games in all, and every console among all the answers. */
export interface GamesPage<T> {
  results: T[];
  /** How many games matched, in all. */
  games: number;
  /** Every console the answers are on (not only the page's games), with how many answers there, the most first. */
  consoles: { platformKey: string; platform: string; count: number }[];
}

/** The first `games` games of answers in the search's order, each with all its answers, and what's beyond them (T-407). */
export function pageOfGames<T extends { title: string; platformKey: string; platform: string }>(sorted: readonly T[], games: number): GamesPage<T> {
  const all = answersByGame(sorted);
  const counts = new Map<string, { platformKey: string; platform: string; count: number }>();
  for (const r of sorted) {
    const c = counts.get(r.platformKey);
    if (c) c.count++;
    else counts.set(r.platformKey, { platformKey: r.platformKey, platform: r.platform, count: 1 });
  }
  return {
    results: all.slice(0, Math.max(0, games)).flatMap((g) => g.answers),
    games: all.length,
    consoles: [...counts.values()].sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform)),
  };
}

/** The most games one search by game answers (GET /api/v1/lookup?games=): more of the title, or a console chip, narrows it. */
export const SEARCH_GAMES_MAX = 100;

/** Days back that count as lately, for the consoles you're most active on. */
export const ACTIVE_DAYS = 90;

/** How busy you've been on one console, from your own data (T-407). */
export interface ConsoleActivity {
  /** Copies added in the last ACTIVE_DAYS days, and games on the way. */
  recent: number;
  /** Copies you have. */
  copies: number;
  /** Its games opened lately (in this browser). */
  opened?: number;
}

/**
 * Each console's weight (0 to 2.5): what you've done on it lately counts most (copies added and games on the way, and
 * games opened, each as a share of the busiest console's), then the size of what you have (half, as a share of the
 * biggest). A console with none of it weighs 0.
 */
export function consoleWeights(activity: Readonly<Record<string, ConsoleActivity>>): Map<string, number> {
  const entries = Object.entries(activity);
  const most = (pick: (a: ConsoleActivity) => number) => Math.max(0, ...entries.map(([, a]) => pick(a)));
  const recent = most((a) => a.recent);
  const opened = most((a) => a.opened ?? 0);
  const copies = most((a) => a.copies);
  const share = (n: number, of: number) => (of > 0 ? n / of : 0);
  return new Map(entries.map(([key, a]) => [key, share(a.recent, recent) + share(a.opened ?? 0, opened) + 0.5 * share(a.copies, copies)]));
}

/** The fewest and most consoles a search's game shows before "more" (Settings > Interface > Navigation). */
export const FOLDED_CONSOLES = { min: 2, max: 4 } as const;

/**
 * The consoles a game shows before "more" (T-407): the console of the answer it shows (its best match, the search's
 * order); where that isn't one you have it on, the console you have it on that you're most active on (the marks say
 * where it's yours: a game you have shouldn't look like one you don't); then the consoles you're most active on
 * (consoleWeights), then the rest in the search's order; `count` of them, 2 to 4. `consoles` are the game's answers'
 * consoles in the search's order (a console may come twice); `owned` the ones you have it on.
 */
export function foldedConsoles(consoles: readonly string[], shownKey: string, weights: ReadonlyMap<string, number>, count: number, owned: ReadonlySet<string> = new Set()): Set<string> {
  const n = Math.min(FOLDED_CONSOLES.max, Math.max(FOLDED_CONSOLES.min, Math.round(count) || FOLDED_CONSOLES.min));
  const distinct = [...new Set(consoles)];
  const rest = distinct
    .filter((k) => k !== shownKey)
    .map((key, i) => ({ key, weight: weights.get(key) ?? 0, i }))
    .sort((a, b) => b.weight - a.weight || a.i - b.i)
    .map((x) => x.key);
  const yours = owned.has(shownKey) ? undefined : rest.find((k) => owned.has(k));
  return new Set([...new Set([...(distinct.includes(shownKey) ? [shownKey] : []), ...(yours ? [yours] : []), ...rest])].slice(0, n));
}
