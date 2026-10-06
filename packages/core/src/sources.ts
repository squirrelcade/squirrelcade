import { editionBase, type TargetStatus } from './catalog.js';
import { matchKey, matchTokens } from './text.js';

/**
 * Catalog sources: where each console's catalog games, and the facts about them, come from, in the
 * order the user trusts them (Settings > Sources > Catalog sources). Each source lists games (by its
 * own rules) and states facts about them. When two sources disagree about a fact, the one higher in
 * the order wins and the difference is recorded; lower sources fill in what higher ones don't say.
 * The user's own answers about games (links, exclusions, confirmations) stand above every source.
 */

/** A kind of fact a source can give about a console's games. */
export type SourceFact = 'games' | 'names' | 'dates' | 'formats' | 'physical' | 'status';

/** How the Sources page names each kind of fact. */
export const SOURCE_FACT_LABELS: Record<SourceFact, string> = {
  games: 'Games',
  names: 'Other names',
  dates: 'Release dates',
  formats: 'Formats (such as Game-Key Card)',
  physical: 'Proof of a physical release',
  status: 'What to collect',
};

/** A catalog source Squirrelcade can read. */
export interface CatalogSourceInfo {
  id: string;
  name: string;
  description: string;
  provides: SourceFact[];
  /** The consoles it covers, when it doesn't cover every console. */
  platforms?: string[];
  /** Its conditions of use, shown beside it. */
  terms?: string;
  /** Where to read it. */
  url?: string;
  /** On for a new install. */
  defaultOn: boolean;
}

/** Every catalog source, in the default order (most trusted first). */
export const CATALOG_SOURCES: readonly CatalogSourceInfo[] = [
  {
    id: 'list',
    name: 'Your lists',
    description: 'The CSV list you give a console on its page: the truth for the games it covers. Its games are always in the catalog.',
    provides: ['games', 'names', 'dates', 'formats', 'physical', 'status'],
    defaultOn: true,
  },
  {
    id: 'nintendo-life',
    name: 'Nintendo Life',
    description:
      "Nintendo Life's lists of Switch 2 physical releases: the confirmed Game-Key Cards, and the games with the full game on the card. Only officially confirmed releases are listed, not retailer listings.",
    provides: ['games', 'dates', 'formats', 'physical'],
    platforms: ['nintendo-switch-2'],
    terms: "Nintendo Life's terms allow personal, non-commercial use with credit: Squirrelcade reads its lists for your own catalogs and never passes them on.",
    url: 'https://www.nintendolife.com/guides/every-nintendo-switch-2-game-key-card-release',
    defaultOn: false,
  },
  {
    id: 'wikipedia',
    name: 'Wikipedia',
    description: "Wikipedia's list of each console's games (the pages are named under Settings > Catalogs and matching): the games released in the console's region, their other names, dates and download marks.",
    provides: ['games', 'names', 'dates', 'status'],
    terms: 'Free to reuse (CC BY-SA).',
    url: 'https://en.wikipedia.org/wiki/Lists_of_video_games',
    defaultOn: true,
  },
  {
    id: 'igdb-regions',
    name: 'IGDB (other regions)',
    description:
      "IGDB's physical releases of a console's games that the sources above don't list, such as PAL, Japanese and Asian releases. On a console that isn't region-locked (Settings > Platforms > Region-locked consoles) they join its catalog and count once you own one; until then they're neither missing nor recommended. A region-locked console leaves them to its regional console (the Super Famicom beside the Super Nintendo). Needs IGDB.",
    provides: ['games', 'names', 'dates', 'physical'],
    terms: "IGDB's data, read with your own Twitch application (Settings > Sources > IGDB).",
    url: 'https://www.igdb.com',
    defaultOn: true,
  },
];

/** A source's place in the order, and whether it's read at all. */
export interface SourceSetting {
  id: string;
  on: boolean;
}

/** The default order and switches. */
export const DEFAULT_SOURCE_ORDER: SourceSetting[] = CATALOG_SOURCES.map((s) => ({ id: s.id, on: s.defaultOn }));

/**
 * A catalog source the user added in Settings > Sources (an online list or a CSV file): its id in the order
 * ("added-" and a number), its name and the consoles its list has games for.
 */
export interface AddedSourceInfo {
  id: string;
  name: string;
  platforms: string[];
}

/** Whether a source id is one the user added. */
export const isAddedSource = (id: string): boolean => /^added-\d+$/.test(id);

/**
 * The sources in the user's order: the stored order, then any source added since (a built-in one as its
 * default, one the user added switched on, at the bottom); unknown ids (a removed source) left out.
 */
export function sourceOrder(setting: readonly SourceSetting[], added: readonly { id: string }[] = []): SourceSetting[] {
  const known = new Set([...CATALOG_SOURCES.map((s) => s.id), ...added.map((a) => a.id)]);
  const out: SourceSetting[] = [];
  for (const s of setting) if (known.has(s.id) && !out.some((o) => o.id === s.id)) out.push({ id: s.id, on: s.on });
  for (const s of CATALOG_SOURCES) if (!out.some((o) => o.id === s.id)) out.push({ id: s.id, on: s.defaultOn });
  for (const a of added) if (!out.some((o) => o.id === a.id)) out.push({ id: a.id, on: true });
  return out;
}

/** Whether a source covers a console: a source the user added covers the consoles its list has games for. */
export function sourceCovers(id: string, platformKey: string, added: readonly AddedSourceInfo[] = []): boolean {
  const own = added.find((a) => a.id === id);
  if (own) return own.platforms.includes(platformKey);
  const platforms = CATALOG_SOURCES.find((s) => s.id === id)?.platforms;
  return !platforms || platforms.includes(platformKey);
}

/** A game as one source lists it. */
export interface LayerGame {
  title: string;
  altTitles?: string[];
  /** A stable identity the source gives it, if any. */
  key?: string;
  region?: string;
  format?: string | null;
  releaseDate?: string | null;
  notes?: string | null;
  targetStatus?: TargetStatus;
  /** Why the source counts it as a physical release (the source's id), if it does. */
  evidence?: string | null;
}

/** One source's games for a console, and which of them it may bring into the catalog. */
export interface SourceLayer {
  id: string;
  games: LayerGame[];
  /**
   * The games no higher source brought that this one adds: all of them, only those released after
   * a date (under your own list, which covers the older ones), or none (it only gives facts).
   */
  adds: 'all' | 'after' | 'none';
  after?: string | null;
  /** With "after": an older game is still added when this says so (a game you own a copy of, so the copy counts). */
  keepOlder?: (g: LayerGame) => boolean;
  /** False: a game a higher source has takes nothing from this one (no names, facts or evidence); it only adds new games. */
  fills?: boolean;
}

/** Two sources disagreeing about a fact of a game: the higher one's value stands. */
export interface SourceConflict {
  title: string;
  fact: 'releaseDate' | 'format';
  kept: { source: string; value: string };
  other: { source: string; value: string };
}

/** What a source gave a console's catalog in a build. */
export interface SourceContribution {
  id: string;
  /** Games it listed. */
  listed: number;
  /** Games it brought into the catalog (no higher source had them). */
  added: number;
  /** Games it listed that a higher source brought. */
  matched: number;
  /** Facts of other sources' games that came from it (a date, a format, proof of a physical release). */
  filled: number;
  /** Games left out because they came out before your own list, which covers them. */
  older: number;
}

/** A catalog game after merging: its facts, and the source that brought it. */
export interface MergedGame extends LayerGame {
  source: string;
}

/** A fact sources can disagree about. */
export type ConflictFact = 'releaseDate' | 'format';
const FACTS: readonly ConflictFact[] = ['releaseDate', 'format'];

/** A value that says nothing yet: no date, or "TBA". */
const unknown = (v: string | null | undefined) => !v || /^(tba|tbd|tbc)$/i.test(v.trim());
const formatKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Whether two values say the same: the same format, or dates where one says less ("2026-10" and "2026-10-15"). */
const agree = (fact: ConflictFact, a: string, b: string) => (fact === 'releaseDate' ? a.startsWith(b) || b.startsWith(a) : formatKey(a) === formatKey(b));

/**
 * Merges the sources' games in order, the first layer most trusted. A game is recognized across
 * sources by any of its names, by its name without an edition ("Absolum - Nintendo Switch 2 Edition"
 * is "Absolum"), or as the same IGDB game (`idOf`). The highest source that lists a game gives its
 * title, region and status. Dates and formats are settled once every source is read: the most trusted
 * source that states one wins (`prefer` can put a source first for one fact, such as Nintendo Life for
 * release dates; the others keep the order), a date that agrees but says more gives the detail, and
 * disagreements are returned. Proof of a physical release from any source counts.
 */
/**
 * Looser keys for a source that only adds games: a title without its edition, small words ("the", "a", "an") and
 * punctuation, so "The Walking Dead: The Final Season" is "The Walking Dead: Final Season".
 */
function looseKeys(name: string): string[] {
  // A note in brackets is left out ("San Andreas (GH only)", "Shenmue III (collector's edition only)"), and editions
  // can stack ("Enhanced Edition - Game of the Year Edition"): taken off one at a time.
  const plain = name.replace(/\s*\([^)]*\)/g, '');
  let base = plain;
  for (let i = 0; i < 3 && editionBase(base) !== base; i++) base = editionBase(base);
  const key = (title: string) => {
    const tokens = matchTokens(title).filter((t) => t !== 'the' && t !== 'a' && t !== 'an');
    // An edition named without a dash or a colon ("Destiny: Taken King Legendary Edition").
    if (tokens.length > 2 && tokens.at(-1) === 'edition') tokens.splice(-2);
    return tokens.join('');
  };
  return [...new Set([key(base), key(plain)])].filter(Boolean);
}

export function mergeSources(
  layers: SourceLayer[],
  idOf?: (title: string) => number | undefined,
  prefer: Partial<Record<ConflictFact, string>> = {},
): { games: MergedGame[]; conflicts: SourceConflict[]; contributions: SourceContribution[] } {
  const games: MergedGame[] = [];
  const conflicts: SourceConflict[] = [];
  const contributions: SourceContribution[] = [];
  const layerOf = new Map<MergedGame, number>();
  /** What each source says about each fact of a game, settled at the end. */
  const claims = new Map<MergedGame, Record<ConflictFact, { source: string; value: string }[]>>();
  const claim = (g: MergedGame, source: string, from: LayerGame) => {
    const said = claims.get(g)!;
    for (const fact of FACTS) {
      const value = from[fact]?.trim();
      // A source naming a game twice keeps its first word on it.
      if (value && !said[fact].some((c) => c.source === source)) said[fact].push({ source, value });
    }
  };
  const byName = new Map<string, MergedGame>();
  const byEdition = new Map<string, MergedGame>();
  const byLoose = new Map<string, MergedGame>();
  const byIgdb = new Map<number, MergedGame>();
  const index = (g: MergedGame) => {
    for (const name of [g.title, ...(g.altTitles ?? [])]) {
      const k = matchKey(name);
      if (k && !byName.has(k)) byName.set(k, g);
      const e = matchKey(editionBase(name));
      if (e && !byEdition.has(e)) byEdition.set(e, g);
      for (const l of looseKeys(name)) if (!byLoose.has(l)) byLoose.set(l, g);
    }
    const id = idOf?.(g.title);
    if (id !== undefined && !byIgdb.has(id)) byIgdb.set(id, g);
  };

  layers.forEach((layer, at) => {
    const c: SourceContribution = { id: layer.id, listed: layer.games.length, added: 0, matched: 0, filled: 0, older: 0 };
    contributions.push(c);
    // Games higher sources brought count as the same game by any name, edition or IGDB game. Within one
    // public source, only the same name does (a list page naming a game twice); your own list's games stay apart.
    const higher = (g: MergedGame | undefined) => (g !== undefined && layerOf.get(g)! < at ? g : undefined);
    const sameName = (g: MergedGame | undefined) => (g !== undefined && (layerOf.get(g)! < at || (layer.id !== 'list' && layerOf.get(g) === at)) ? g : undefined);
    for (const g of layer.games) {
      const names = [g.title, ...(g.altTitles ?? [])];
      const id = idOf?.(g.title);
      const hit =
        names.map((n) => sameName(byName.get(matchKey(n)))).find(Boolean) ??
        names.map((n) => higher(byEdition.get(matchKey(editionBase(n))))).find(Boolean) ??
        (id !== undefined ? higher(byIgdb.get(id)) : undefined) ??
        // A source that only adds games (another region's releases) leaves out one the catalog has with a few small
        // words, punctuation or an edition apart (0.45.0).
        (layer.fills === false ? names.flatMap((n) => looseKeys(n)).map((k) => higher(byLoose.get(k))).find(Boolean) : undefined);
      if (hit && layer.fills === false) {
        if (layerOf.get(hit) !== at) c.matched++;
        continue;
      }
      if (hit) {
        // The same source naming a game twice is one game with every name; another source's listing is a match.
        if (layerOf.get(hit) !== at) c.matched++;
        hit.altTitles = [...new Set([...(hit.altTitles ?? []), ...names])].filter((n) => n !== hit.title);
        index(hit);
        claim(hit, layer.id, g);
        if (!hit.evidence && g.evidence) {
          hit.evidence = g.evidence;
          if (layerOf.get(hit) !== at) c.filled++;
        }
        continue;
      }
      if (layer.adds === 'none') continue;
      // Under your own list, only what came out after it is new (a game announced without a date is, too).
      if (layer.adds === 'after' && layer.after) {
        const d = g.releaseDate?.trim();
        if (!(d && (/^(tba|tbd|tbc)$/i.test(d) || d > layer.after)) && !layer.keepOlder?.(g)) {
          c.older++;
          continue;
        }
      }
      const merged: MergedGame = { ...g, altTitles: [...new Set(g.altTitles ?? [])].filter((n) => n !== g.title), source: layer.id };
      games.push(merged);
      layerOf.set(merged, at);
      claims.set(merged, { releaseDate: [], format: [] });
      claim(merged, layer.id, g);
      index(merged);
      c.added++;
    }
  });

  // Each fact of each game: the most trusted source that knows it wins; a game nobody dates keeps its "TBA".
  const rank = (fact: ConflictFact, source: string) => (prefer[fact] === source ? -1 : layers.findIndex((l) => l.id === source));
  const byId = new Map(contributions.map((c) => [c.id, c]));
  for (const g of games) {
    for (const fact of FACTS) {
      const known = claims
        .get(g)!
        [fact].filter((c) => !unknown(c.value))
        .sort((a, b) => rank(fact, a.source) - rank(fact, b.source));
      const winner = known[0];
      if (!winner) continue;
      let value = winner.value;
      let from = winner.source;
      for (const other of known.slice(1)) {
        if (!agree(fact, winner.value, other.value)) {
          conflicts.push({ title: g.title, fact, kept: { source: winner.source, value: winner.value }, other: { source: other.source, value: other.value } });
        } else if (fact === 'releaseDate' && other.value.length > value.length) {
          // A date that agrees but says more (the day, not just the month) gives the detail.
          value = other.value;
          from = other.source;
        }
      }
      g[fact] = value;
      if (from !== g.source) byId.get(from)!.filled++;
    }
  }
  return { games, conflicts, contributions };
}
