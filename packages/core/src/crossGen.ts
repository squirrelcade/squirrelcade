import { completionPercent, type CatalogMatch, type CatalogTarget, type TargetResult } from './catalog.js';
import { matchKey, romanNumerals } from './text.js';

/**
 * Console families, one generation after another. Neighbors share cross-generation releases: the same game made for
 * both, usually within a year or two of each other (Switch and Switch 2, PlayStation 4 and 5, Xbox One and Series X|S).
 */
export const CONSOLE_GENERATIONS: readonly (readonly string[])[] = [
  ['playstation', 'playstation-2', 'playstation-3', 'playstation-4', 'playstation-5'],
  ['xbox', 'xbox-360', 'xbox-one', 'xbox-series-x'],
  ['nintendo-gamecube', 'wii', 'wii-u', 'nintendo-switch', 'nintendo-switch-2'],
  ['game-boy', 'game-boy-color'],
  ['nintendo-ds', 'nintendo-3ds'],
  ['psp', 'playstation-vita'],
];

/** A console's neighbors in its family, the generation before and after it: where its cross-generation games also are. */
export function crossGenNeighbors(platformKey: string): string[] {
  for (const family of CONSOLE_GENERATIONS) {
    const i = family.indexOf(platformKey);
    if (i >= 0) return [family[i - 1], family[i + 1]].filter((k): k is string => k !== undefined);
  }
  return [];
}

/** A game owned on a neighbor console: the copy that owns it, its name there, and the year it came out there. */
export interface CrossGenOwned {
  productId: string;
  title: string;
  year: number | null;
}

/** A neighbor console and the games owned on it, by the matching key of each game's names. */
export interface CrossGenPartner {
  name: string;
  owned: ReadonlyMap<string, CrossGenOwned>;
}

/**
 * Cross-generation games (Settings > Catalogs and matching): a catalog game missing on a console counts as owned when
 * the same game (its title, or one of its other names) is owned on a neighbor in its family, the two released within
 * `years` of each other where both years are known (0: any years apart). Such a game says where it's owned ("via").
 */
export function applyCrossGen(
  match: CatalogMatch,
  partners: readonly CrossGenPartner[],
  years: number,
  yearOf: (target: CatalogTarget) => number | null,
): CatalogMatch {
  if (partners.length === 0) return match;
  let found = 0;
  const targets = match.targets.map((r): TargetResult => {
    if (r.status !== 'missing') return r;
    const year = yearOf(r.target);
    // A name with no key (punctuation alone) matches nothing.
    const keys = [r.target.title, ...(r.target.altTitles ?? [])].map(matchKey).filter(Boolean);
    for (const p of partners) {
      for (const key of keys) {
        const there = p.owned.get(key);
        if (!there) continue;
        if (years > 0 && year !== null && there.year !== null && Math.abs(year - there.year) > years) continue;
        found++;
        return { ...r, status: 'owned', matches: [{ productId: there.productId, title: `${there.title} (${p.name})`, method: 'crossgen' }], suggestions: [], via: p.name };
      }
    }
    return r;
  });
  if (found === 0) return match;
  const counts = { ...match.counts, owned: match.counts.owned + found, missing: match.counts.missing - found };
  return { ...match, targets, counts, percent: completionPercent(counts) };
}

/** The year a catalog's release date starts with ("2017-03-03", "2017"), or null ("TBA", none). */
export function releaseYear(date: string | null | undefined): number | null {
  const m = /^(\d{4})/.exec(date ?? '');
  return m ? Number(m[1]) : null;
}

/** One copy or catalog game as seen across consoles: its title, the year it came out there, and IGDB's game when known. */
export interface GameOnConsole {
  title: string;
  year: number | null;
  igdbId?: number | null;
}

/**
 * Whether two games with the same title key on different consoles are the same game (1.5.0, R12: "Call of Duty:
 * Modern Warfare II", 2022, isn't 2009's "Modern Warfare 2", though D21 reads II as 2). When IGDB knows both, its game
 * decides, except that two of its entries from the same years still count as one (a port it lists apart). Without
 * IGDB, they're two games only when one spells the number in Roman numerals and the other doesn't and their years are
 * more than `years` apart (Settings > Catalogs > Cross-generation: released within); a title said the same way stays
 * one game, as before. `years` 0 or less never splits them.
 */
export function sameGameAcross(a: GameOnConsole, b: GameOnConsole, years: number): boolean {
  const apart = years > 0 && a.year !== null && b.year !== null && Math.abs(a.year - b.year) > years;
  if (!apart) return true;
  if (a.igdbId && b.igdbId) return a.igdbId === b.igdbId;
  const ra = romanNumerals(a.title).join(',');
  const rb = romanNumerals(b.title).join(',');
  return ra === rb;
}

