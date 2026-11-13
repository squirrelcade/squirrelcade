import { consoleMark, consoleWeights, foldedConsoles, searchGameKey, type ConsoleActivity } from '@squirrelcade/core';

/** What one line of a search shows of a game on a console: its console, its title there, and whether you have it there. */
export interface OnConsole {
  platformKey: string;
  platform: string;
  title: string;
  answer: string | null;
  ownedOnPc?: string[];
}

/** A game you have on a console, by the search's answer. */
export const isOwned = (answer: string | null) => answer === 'own' || answer === 'own-not-in-catalog';

/**
 * A search's matches as one line per game (D175, the owner: "just showing one game and then it shows next to it
 * the symbols for the different consoles"): the consoles' answers of a game together (its editions and subtitles
 * too, as catalogs compare titles), in the order the first of each came, its consoles oldest first.
 */
export function oneLinePerGame<T extends OnConsole>(results: readonly T[]): { key: string; title: string; first: T; ranked: T[]; consoles: T[]; owned: boolean; onPc: boolean }[] {
  const games = new Map<string, T[]>();
  for (const r of results) {
    const key = searchGameKey(r.title);
    games.set(key, [...(games.get(key) ?? []), r]);
  }
  return [...games].map(([key, consoles]) => ({
    key,
    title: consoles[0]!.title,
    // The answer that came first (the scanned console's, the best match): the one shown to start.
    first: consoles[0]!,
    // In the search's order: the order the folded marks are picked in (marksToShow).
    ranked: consoles,
    consoles: [...consoles].sort((a, b) => consoleMark(a.platformKey, a.platform).year - consoleMark(b.platformKey, b.platform).year),
    owned: consoles.some((c) => isOwned(c.answer)),
    onPc: consoles.some((c) => (c.ownedOnPc?.length ?? 0) > 0),
  }));
}

/** A search by game (GET /api/v1/lookup?games=, T-407): every console's answer for the best games, and what's beyond them. */
export interface GamesAnswer<T> {
  results: T[];
  /** How many games matched, in all. */
  games: number;
  /** Every console among the matches, with how many answers there, the most first (the console chips). */
  consoles: { platformKey: string; platform: string; count: number }[];
  /** How busy you've been on each console (copies added lately, games on the way, copies). */
  activity: Record<string, ConsoleActivity>;
}

/** Each console's weight for a game's first marks: the server's activity, with the games opened lately in this browser. */
export function searchWeights(activity: Readonly<Record<string, ConsoleActivity>> | undefined, opened: readonly { platformKey: string }[]): Map<string, number> {
  const all: Record<string, ConsoleActivity> = {};
  for (const [key, a] of Object.entries(activity ?? {})) all[key] = { ...a };
  for (const g of opened) {
    const a = (all[g.platformKey] ??= { recent: 0, copies: 0 });
    a.opened = (a.opened ?? 0) + 1;
  }
  return consoleWeights(all);
}

/**
 * One answer per console, for its mark: where a console has two answers of the game (an edition of it the catalog lists
 * apart, a copy outside the catalog), the one you have, else the first. A mark is "where", once per console.
 */
export function onePerConsole<T extends OnConsole>(answers: readonly T[]): T[] {
  const best = new Map<string, T>();
  for (const a of answers) {
    const had = best.get(a.platformKey);
    if (!had || (!isOwned(had.answer) && isOwned(a.answer))) best.set(a.platformKey, a);
  }
  return answers.filter((a) => best.get(a.platformKey) === a);
}

/**
 * The marks a game's line shows (T-407), one per console (onePerConsole): folded, `count` consoles (foldedConsoles: the
 * one whose answer it shows, one you have it on, then the ones you're most active on, then the search's order), oldest
 * first as always; open, all of them. `hidden` is how many consoles "+n more" shows.
 */
export function marksToShow<T extends OnConsole>(
  line: { consoles: T[]; ranked?: T[] },
  shownKey: string,
  weights: ReadonlyMap<string, number>,
  count: number,
  open: boolean,
): { marks: T[]; hidden: number } {
  const order = (line.ranked ?? line.consoles).map((c) => c.platformKey);
  const all = new Set(order);
  const owned = new Set((line.ranked ?? line.consoles).filter((c) => isOwned(c.answer)).map((c) => c.platformKey));
  const folded = foldedConsoles(order, shownKey, weights, count, owned);
  const marks = onePerConsole(line.consoles);
  if (open || all.size <= folded.size) return { marks, hidden: 0 };
  return { marks: marks.filter((c) => folded.has(c.platformKey)), hidden: all.size - folded.size };
}
