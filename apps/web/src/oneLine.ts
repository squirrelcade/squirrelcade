import { baseTitle, consoleMark, matchKey } from '@squirrelcade/core';

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
export function oneLinePerGame<T extends OnConsole>(results: readonly T[]): { key: string; title: string; first: T; consoles: T[]; owned: boolean; onPc: boolean }[] {
  const games = new Map<string, T[]>();
  for (const r of results) {
    const key = matchKey(baseTitle(r.title)) || r.title;
    games.set(key, [...(games.get(key) ?? []), r]);
  }
  return [...games].map(([key, consoles]) => ({
    key,
    title: consoles[0]!.title,
    // The answer that came first (the scanned console's, the best match): the one shown to start.
    first: consoles[0]!,
    consoles: [...consoles].sort((a, b) => consoleMark(a.platformKey, a.platform).year - consoleMark(b.platformKey, b.platform).year),
    owned: consoles.some((c) => isOwned(c.answer)),
    onPc: consoles.some((c) => (c.ownedOnPc?.length ?? 0) > 0),
  }));
}
