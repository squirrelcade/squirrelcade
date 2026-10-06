import { platformInText } from './catalogList.js';
import { parseCsv } from './csv.js';
import { KNOWN_PLATFORMS } from './platforms.js';
import { cellTitles, wikiTables } from './wikipedia.js';

/**
 * Sets: the user's own named sets of games beyond consoles, such as a publisher's releases (Limited Run
 * Games, Super Rare Games), a series or any theme. A set's games span consoles; whether one is owned is
 * the console catalog's answer where the console has the game, so every review answer counts here too.
 */

/** A game in a set: its title and the consoles (platform keys) it came out on. */
export interface SetGame {
  title: string;
  platforms: string[];
  altTitles?: string[];
  notes?: string;
}

/**
 * Sets that can be made in one click (Sets > New set): publishers of limited physical releases whose releases
 * Wikipedia lists with their consoles. Only offered, never made on their own.
 */
export const READY_SETS: readonly { name: string; page: string; about: string }[] = [
  { name: 'Limited Run Games', page: 'List of Limited Run Games releases', about: 'Limited physical runs of indie and retro games, on most consoles since 2015.' },
  { name: 'Super Rare Games', page: 'Super Rare Games', about: 'Limited physical editions of indie games, on Switch, Switch 2, PS4 and PS5, since 2018.' },
];

const TITLE = /^(title|titles|title\(s\)|game|game title|name)\b/;
const PLATFORM = /^(platforms?|platform\(s\)|systems?|consoles?)\b/;
const NOTES = /^(notes?|comments?)$/;

/** The consoles a set's list can name ("PS4", "Vita", "Nintendo Switch"), as Squirrelcade's platform keys. */
export function setPlatform(label: string): string | null {
  return platformInText(label, KNOWN_PLATFORMS);
}

/** The consoles named in a cell: each line or comma-separated part, and notes in parentheses such as Limited Run's "105 (PS4)". */
export function platformsIn(text: string): string[] {
  const parts = [...text.split(/[\n,;/]+|\band\b/), ...[...text.matchAll(/\(([^)]{1,30})\)/g)].map((m) => m[1]!)];
  const keys = new Set<string>();
  for (const part of parts) {
    const key = setPlatform(part);
    if (key) keys.add(key);
  }
  return [...keys];
}

/** Adds a game to a set's games, joining the consoles of games listed more than once. */
function addGame(games: Map<string, SetGame>, game: SetGame): void {
  const key = game.title.toLowerCase();
  const had = games.get(key);
  if (!had) {
    games.set(key, game);
    return;
  }
  had.platforms = [...new Set([...had.platforms, ...game.platforms])];
  if (game.altTitles) had.altTitles = [...new Set([...(had.altTitles ?? []), ...game.altTitles])];
}

/**
 * The games of a Wikipedia list of a set, such as "List of Limited Run Games releases": every table with
 * a title column, the consoles from its Platform column or, without one, from notes in parentheses
 * anywhere in the row ("105 (PS4)", "Distro (Switch)"), or else from the heading the table sits under
 * (Super Rare Games' article has a table per console, under "Nintendo Switch", "PlayStation 4"...). Games
 * without a console Squirrelcade knows are counted in `skipped` (PC releases, for example: the PC library keeps those).
 */
export function wikiSetGames(html: string): { games: SetGame[]; skipped: number } {
  const games = new Map<string, SetGame>();
  let skipped = 0;
  for (const { section, rows } of wikiTables(html)) {
    // The console of the heading the table is under ("Releases > Nintendo Switch"), for rows that name none.
    const headingPlatform = setPlatform(section.split(' > ').at(-1) ?? '');
    let headerRows = 0;
    while (headerRows < rows.length && rows[headerRows]!.every((c) => c.header)) headerRows++;
    if (headerRows === 0 || headerRows === rows.length) continue;
    const width = Math.max(...rows.map((r) => r.length));
    const labels = Array.from({ length: width }, (_, col) =>
      rows
        .slice(0, headerRows)
        .map((r) => (r[col]?.text ?? '').toLowerCase().replace(/\[[^\]]*\]/g, '').trim())
        .join(' '),
    );
    const titleCol = labels.findIndex((l) => TITLE.test(l));
    if (titleCol < 0) continue;
    const platformCol = labels.findIndex((l) => PLATFORM.test(l));
    for (const row of rows.slice(headerRows)) {
      const cell = row[titleCol];
      if (!cell || row.every((c) => c.header)) continue;
      const [title, ...alt] = cellTitles(cell.text);
      if (!title) continue;
      const named =
        platformCol >= 0
          ? platformsIn(row[platformCol]?.text ?? '')
          : [
              ...new Set(
                // A note can name several consoles: "Distro (Switch, PS4, PS5)".
                row.flatMap((c, i) => (i === titleCol ? [] : [...c.text.matchAll(/\(([^)]{1,40})\)/g)].flatMap((m) => platformsIn(m[1]!)))),
              ),
            ];
      const platforms = named.length === 0 && headingPlatform ? [headingPlatform] : named;
      if (platforms.length === 0) {
        skipped++;
        continue;
      }
      addGame(games, { title, platforms, ...(alt.length > 0 ? { altTitles: alt } : {}) });
    }
  }
  return { games: [...games.values()], skipped };
}

/**
 * A set's list from CSV: a title column (Title, Game or Name) and a platform column (Platform, Console or
 * System: names such as "PS4" or "Nintendo Switch", several separated by ; or ,), notes optional. A row
 * without a console Squirrelcade knows is skipped and counted as a problem.
 */
export function parseSetCsv(text: string): { games: SetGame[]; problems: string[] } {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const headerAt = rows.findIndex((r) => r.some((c) => TITLE.test(c.trim().toLowerCase())));
  if (headerAt < 0) return { games: [], problems: ['No title column: the first row needs a column named Title (or Game, or Name).'] };
  const header = rows[headerAt]!.map((c) => c.trim().toLowerCase());
  const titleCol = header.findIndex((h) => TITLE.test(h));
  const platformCol = header.findIndex((h) => PLATFORM.test(h));
  if (platformCol < 0) return { games: [], problems: ['No platform column: add a column named Platform (or Console) with each game\'s console.'] };
  const notesCol = header.findIndex((h) => NOTES.test(h));
  const games = new Map<string, SetGame>();
  let unknown = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const title = (r[titleCol] ?? '').trim();
    if (!title) continue;
    const platforms = platformsIn(r[platformCol] ?? '');
    if (platforms.length === 0) {
      unknown++;
      continue;
    }
    const notes = notesCol >= 0 ? (r[notesCol] ?? '').trim().slice(0, 500) : '';
    addGame(games, { title, platforms, ...(notes ? { notes } : {}) });
  }
  const problems: string[] = [];
  if (games.size === 0) problems.push('The list has no games with a console Squirrelcade knows.');
  if (unknown > 0) problems.push(`${unknown} row(s) had no console Squirrelcade knows (PC games, for example) and were left out.`);
  return { games: [...games.values()], problems };
}

/** A URL-safe key for a set's name ("Limited Run Games" -> "limited-run-games"). */
export function setKey(name: string): string {
  return (
    name
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'set'
  );
}

/** A Wikipedia page named by its title or its address ("https://en.wikipedia.org/wiki/List_of_Limited_Run_Games_releases"). */
export function wikiPageTitle(text: string): string {
  const t = text.trim();
  const m = /wikipedia\.org\/wiki\/([^?#]+)/i.exec(t);
  return (m ? decodeURIComponent(m[1]!) : t).replace(/_/g, ' ').trim();
}
