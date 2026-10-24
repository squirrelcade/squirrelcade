import { baseTitle, matchKey, normalizeTitle, seriesNamesOf, type IgdbGame } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import type { CatalogService } from './catalogs.js';
import type { IgdbService } from './igdb.js';
import type { SettingsService } from './settings.js';

/** One series (IGDB's franchise or collection) across the consoles' catalogs, and how much of it is owned. */
export interface SeriesSummary {
  name: string;
  owned: number;
  /** The series' catalog games not owned: missing, not confirmed physical, not out yet or waiting on Review. */
  missing: number;
  /** Of those, the ones you own on another console (the same title). */
  ownedElsewhere: number;
  /** Of the missing ones, those you have on PC (the PC library): a second segment of the bar. */
  onPc: number;
  total: number;
  percent: number;
  /** The consoles its catalog games are on. */
  platforms: string[];
  /** One of your own series (Settings > Collection > Your own series), not IGDB's. */
  custom?: boolean;
}

/** A series' game on one console, with its catalog's answer and IGDB's first release there. */
export interface SeriesGame {
  platformKey: string;
  platform: string;
  title: string;
  status: string;
  released: string | null;
  /** For a game you don't own here: the other consoles you own the same title on. */
  ownedOn: string[];
  /** Your wishlist preference for it (Must Have... Do Not Recommend). */
  preference?: string | null;
  /** For a game you don't own here: you have it on PC (the PC library). */
  onPc?: boolean;
  /** IGDB's cover for it on this console. */
  coverId?: string | null;
  /** IGDB's game, so the same game spelled two ways on two consoles ("Judgement", "Judgment") counts once. */
  igdbId?: number;
  /**
   * For a remake or remaster (IGDB's links): the game in this series it's a version of, followed back to the first
   * one, with its first release; so an opened series can show versions together. "version" when it took more than
   * one step (a remaster of a remake).
   */
  original?: { title: string; released: string | null; kind: 'remake' | 'remaster' | 'version' };
}

/**
 * A series' game counted once, whatever consoles it came out on (the Nutshell's Series, the owner: "as long as we
 * have one copy somewhere, it counts for that game"): had when any console's copy is yours; PC apart, never counted.
 */
export interface SeriesTitle {
  /** The game across consoles: its title as matchKey(baseTitle()) makes it. */
  key: string;
  title: string;
  /** Its first release on any console. */
  released: string | null;
  coverId: string | null;
  had: boolean;
  /** Not had on a console, but on PC (the PC library): shown apart. */
  onPc: boolean;
  /** Each console it's on, in release order, with that console's answer. */
  consoles: { platformKey: string; platform: string; status: string }[];
  original?: SeriesGame['original'];
}

/** A series counted by game (GET /api/v1/series?by=game). */
export interface SeriesByGame {
  name: string;
  had: number;
  total: number;
  /** Games not had on a console that you have on PC. */
  onPc: number;
  percent: number;
  /** The cover the series' card shows: its first game you have, else its first game. */
  coverId: string | null;
  /** How many consoles its games are on. */
  consoles: number;
  custom?: boolean;
}

/** Marks each remake or remaster in a series' games with the earliest version of it the series has (see SeriesGame.original). */
function linkVersions(list: SeriesGame[], igdbOf: Map<SeriesGame, IgdbGame>): void {
  const parent = new Map<number, { id: number; kind: 'remake' | 'remaster' }>();
  for (const g of list) {
    const ig = igdbOf.get(g);
    for (const id of ig?.remakes ?? []) if (id !== ig!.id) parent.set(id, { id: ig!.id, kind: 'remake' });
    for (const id of ig?.remasters ?? []) if (id !== ig!.id && !parent.has(id)) parent.set(id, { id: ig!.id, kind: 'remaster' });
  }
  if (parent.size === 0) return;
  const byId = new Map<number, SeriesGame[]>();
  for (const g of list) {
    const id = igdbOf.get(g)?.id;
    if (id !== undefined) byId.set(id, [...(byId.get(id) ?? []), g]);
  }
  for (const g of list) {
    const ig = igdbOf.get(g);
    if (!ig) continue;
    let at = ig.id;
    let steps = 0;
    let first: 'remake' | 'remaster' | null = null;
    let found: { id: number; steps: number } | null = null;
    const seen = new Set([at]);
    for (let step = parent.get(at); step && !seen.has(step.id); step = parent.get(at)) {
      seen.add(step.id);
      first ??= step.kind;
      at = step.id;
      steps++;
      if (byId.has(at)) found = { id: at, steps };
    }
    if (!found) continue;
    const originals = byId.get(found.id)!;
    const released = originals.flatMap((o) => (o.released ? [o.released] : [])).sort()[0] ?? null;
    g.original = { title: originals[0]!.title, released, kind: found.steps === 1 ? first! : 'version' };
  }
}

/**
 * Series: each IGDB series (a franchise, or else a collection) with games in the consoles' catalogs, owned and
 * not, so a collector sees which series they're close to finishing. Only series with a game owned are listed.
 * Worked out again when the catalogs or IGDB's data change.
 */
export class SeriesService {
  private cache: { key: string; games: Map<string, SeriesGame[]>; custom: Set<string>; folded: Map<string, string> } | null = null;

  constructor(
    private readonly catalogs: CatalogService,
    private readonly igdb: IgdbService,
    private readonly settings: SettingsService,
    /** Your wishlist preferences by "platform key|normalized title". */
    private readonly preferences: () => Map<string, string> = () => new Map(),
    /** Whether you have a title on PC (the PC library; false while it's off). */
    private readonly onPc: (title: string) => boolean = () => false,
  ) {}

  /**
   * Every series' games (IGDB's, and your own), which series are your own, and IGDB's older franchise names folded
   * into newer ones ("Mario Bros." into "Mario").
   */
  private worked(): { games: Map<string, SeriesGame[]>; custom: Set<string>; folded: Map<string, string> } {
    const own = this.settings.get('collection.customSeries');
    const withCollections = this.settings.get('collection.seriesCollections');
    const key = `${this.catalogs.stamp()}|${this.igdb.stamp()}|${own.join('\n')}|${withCollections}`;
    if (this.cache?.key === key) return this.cache;
    // The names IGDB gives as franchises, and as collections: only a franchise folds into another.
    const franchiseNames = new Set<string>();
    const collectionNames = new Set<string>();
    const bySeries = new Map<string, SeriesGame[]>();
    const igdbOf = new Map<SeriesGame, IgdbGame>();
    const matches = this.catalogs.allMatches();
    // The consoles each title is owned on, so a missing game can say you have it elsewhere.
    const ownedOn = new Map<string, Set<string>>();
    for (const p of matches) {
      for (const t of p.match.targets) {
        if (t.status !== 'owned') continue;
        const k = matchKey(baseTitle(t.target.title));
        ownedOn.set(k, (ownedOn.get(k) ?? new Set()).add(p.name));
      }
    }
    for (const p of matches) {
      for (const t of p.match.targets) {
        // Another region's release not owned counts nowhere (it counts once owned).
        if (t.status === 'excluded' || t.status === 'extra') continue;
        const game = this.igdb.find(p.platformId, t.target.title);
        // Each of its franchises and (with the setting) its collections (seriesNamesOf).
        const names = game ? seriesNamesOf(game, withCollections) : [];
        if (names.length === 0) continue;
        for (const f of game!.franchises ?? [game!.franchise ?? '']) if (f) franchiseNames.add(f);
        for (const c of game!.collections ?? []) collectionNames.add(c);
        const elsewhere = t.status === 'owned' ? [] : [...(ownedOn.get(matchKey(baseTitle(t.target.title))) ?? [])].filter((n) => n !== p.name);
        for (const name of names) {
          // One entry for each series, since each series links its own remakes (linkVersions).
          const entry: SeriesGame = { platformKey: p.key, platform: p.name, title: t.target.title, status: t.status, released: game!.released ?? null, ownedOn: elsewhere, coverId: game!.coverId ?? null, igdbId: game!.id };
          igdbOf.set(entry, game!);
          bySeries.set(name, [...(bySeries.get(name) ?? []), entry]);
        }
      }
    }
    // IGDB's older franchise names inside its newer ones (the owner: the Mario series lacked Super Mario Bros. 2 and 3,
    // which IGDB files under "Mario Bros." as well as "Mario"): a franchise whose name begins with a bigger
    // franchise's, with most of its games in that one too, joins it and isn't listed apart. Collections never fold.
    const folded = new Map<string, string>();
    const gameKey = (g: SeriesGame) => `${g.platformKey}|${normalizeTitle(g.title)}`;
    for (const [name, list] of bySeries) {
      if (!franchiseNames.has(name) || collectionNames.has(name)) continue;
      for (const [other, into] of bySeries) {
        if (other === name || !franchiseNames.has(other) || into.length <= list.length || !matchKey(name).startsWith(matchKey(other))) continue;
        const inOther = new Set(into.map(gameKey));
        if (list.filter((g) => inOther.has(gameKey(g))).length >= 0.8 * list.length) {
          folded.set(name, other);
          break;
        }
      }
    }
    for (const [name, other] of folded) {
      const into = bySeries.get(other)!;
      const have = new Set(into.map(gameKey));
      for (const g of bySeries.get(name)!) {
        if (have.has(gameKey(g))) continue;
        const copy: SeriesGame = { ...g };
        const game = igdbOf.get(g);
        if (game) igdbOf.set(copy, game);
        into.push(copy);
        have.add(gameKey(g));
      }
    }
    // Your own series: the catalogs' games whose titles have one of its words (in place of an IGDB series of that name).
    const custom = new Set<string>();
    for (const line of own) {
      const bar = line.indexOf('|');
      const name = (bar < 0 ? '' : line.slice(0, bar)).trim();
      const words = (bar < 0 ? '' : line.slice(bar + 1)).split(',').map((w) => matchKey(w)).filter(Boolean);
      if (!name || words.length === 0) continue;
      const list: SeriesGame[] = [];
      for (const p of matches) {
        for (const t of p.match.targets) {
          if (t.status === 'excluded' || t.status === 'extra' || !words.some((w) => matchKey(t.target.title).includes(w))) continue;
          const game = this.igdb.find(p.platformId, t.target.title);
          const elsewhere = t.status === 'owned' ? [] : [...(ownedOn.get(matchKey(baseTitle(t.target.title))) ?? [])].filter((n) => n !== p.name);
          const entry: SeriesGame = { platformKey: p.key, platform: p.name, title: t.target.title, status: t.status, released: game?.released ?? null, ownedOn: elsewhere, coverId: game?.coverId ?? null };
          if (game) igdbOf.set(entry, game);
          list.push(entry);
        }
      }
      if (list.length === 0) continue;
      bySeries.set(name, list);
      custom.add(name);
    }
    for (const list of bySeries.values()) linkVersions(list, igdbOf);
    this.cache = { key, games: bySeries, custom, folded };
    return this.cache;
  }

  /** A series by its name, or the one it folded into ("Mario Bros." is Mario's). */
  private named(name: string): SeriesGame[] | undefined {
    const { games, folded } = this.worked();
    return games.get(folded.get(name) ?? name);
  }

  /**
   * Every series with a game owned and at least Settings > Collection > "Fewest games for a series" in the
   * catalogs (so a single game with a series name isn't a "series"): the most owned first.
   */
  list(): SeriesSummary[] {
    const out: SeriesSummary[] = [];
    const fewest = this.settings.get('collection.seriesMinGames');
    const { games: all, custom, folded } = this.worked();
    for (const [name, games] of all) {
      if (folded.has(name)) continue;
      const owned = games.filter((g) => g.status === 'owned').length;
      // Your own series show whatever you own of them; IGDB's need a game owned and enough games.
      if (!custom.has(name) && (owned === 0 || games.length < fewest)) continue;
      out.push({
        name,
        owned,
        missing: games.length - owned,
        ownedElsewhere: games.filter((g) => g.status !== 'owned' && g.ownedOn.length > 0).length,
        onPc: games.filter((g) => g.status !== 'owned' && this.onPc(g.title)).length,
        total: games.length,
        percent: Math.round((owned / games.length) * 1000) / 10,
        platforms: [...new Set(games.map((g) => g.platform))].sort((a, b) => a.localeCompare(b)),
        ...(custom.has(name) ? { custom: true } : {}),
      });
    }
    return out.sort((a, b) => b.owned - a.owned || b.percent - a.percent || a.name.localeCompare(b.name));
  }

  /** A series' games counted once each, wherever you have them (see SeriesTitle), in release order. */
  private titlesOf(games: SeriesGame[]): SeriesTitle[] {
    // One game: the same title, or the same IGDB game under another spelling (the owner: "why are the Judgment games
    // on here twice?", a catalog's "Judgement" beside another's "Judgment").
    const parent = new Map<string, string>();
    const root = (k: string): string => {
      let r = k;
      while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
      return r;
    };
    const join = (a: string, b: string) => {
      const ra = root(a);
      const rb = root(b);
      if (ra !== rb) parent.set(rb, ra);
    };
    for (const g of games) {
      const key = matchKey(baseTitle(g.title));
      if (!parent.has(key)) parent.set(key, key);
      if (g.igdbId !== undefined) {
        if (!parent.has(`#${g.igdbId}`)) parent.set(`#${g.igdbId}`, key);
        join(key, `#${g.igdbId}`);
      }
    }
    const byGame = new Map<string, SeriesGame[]>();
    for (const g of games) {
      const key = root(matchKey(baseTitle(g.title)));
      byGame.set(key, [...(byGame.get(key) ?? []), g]);
    }
    const out: SeriesTitle[] = [];
    for (const [key, list] of byGame) {
      const sorted = [...list].sort((a, b) => (a.released ?? '9999').localeCompare(b.released ?? '9999') || a.platform.localeCompare(b.platform));
      // Its name: the spelling most of its consoles use (the first released on a tie).
      const spellings = new Map<string, number>();
      for (const g of sorted) spellings.set(g.title, (spellings.get(g.title) ?? 0) + 1);
      const best = [...spellings].sort((a, b) => b[1] - a[1])[0]![0];
      const first = sorted[0]!;
      const had = list.some((g) => g.status === 'owned');
      const mine = list.find((g) => g.status === 'owned' && g.coverId);
      out.push({
        key,
        title: best,
        released: first.released,
        coverId: mine?.coverId ?? sorted.find((g) => g.coverId)?.coverId ?? null,
        had,
        onPc: !had && list.some((g) => this.onPc(g.title)),
        consoles: sorted.map((g) => ({ platformKey: g.platformKey, platform: g.platform, status: g.status })),
        ...(first.original ? { original: first.original } : {}),
      });
    }
    return out.sort((a, b) => (a.original?.released ?? a.released ?? '9999').localeCompare(b.original?.released ?? b.released ?? '9999') || a.title.localeCompare(b.title));
  }

  /**
   * Every series counted by game (the Nutshell's Series): a game counts once, had when any console's copy is yours,
   * PC apart. The same series as list() (a game had, enough games, your own), the most had first.
   */
  listByGame(): SeriesByGame[] {
    const out: SeriesByGame[] = [];
    const fewest = this.settings.get('collection.seriesMinGames');
    const { games: all, custom, folded } = this.worked();
    for (const [name, games] of all) {
      if (folded.has(name)) continue;
      const titles = this.titlesOf(games);
      const had = titles.filter((t) => t.had).length;
      if (!custom.has(name) && (had === 0 || titles.length < fewest)) continue;
      out.push({
        name,
        had,
        total: titles.length,
        onPc: titles.filter((t) => t.onPc).length,
        percent: Math.round((had / titles.length) * 1000) / 10,
        coverId: titles.find((t) => t.had && t.coverId)?.coverId ?? titles.find((t) => t.coverId)?.coverId ?? null,
        consoles: new Set(games.map((g) => g.platformKey)).size,
        ...(custom.has(name) ? { custom: true } : {}),
      });
    }
    return out.sort((a, b) => b.had - a.had || b.percent - a.percent || a.name.localeCompare(b.name));
  }

  /** One series' games counted by game, in release order (each remake beside the game it remakes). */
  detailByGame(name: string): SeriesTitle[] | null {
    const games = this.named(name);
    return games ? this.titlesOf(games) : null;
  }

  /**
   * The series a game is in, for its page's Series tab (the owner: "I would like to be able to see the series from
   * this game"): the ones the Series page lists (not hidden), each with how much of it you have, the biggest first.
   */
  of(platformKey: string, title: string): { name: string; had: number; total: number }[] {
    const key = normalizeTitle(title);
    const hidden = new Set(this.settings.get('collection.seriesHidden'));
    const { games: all } = this.worked();
    const listed = new Map(this.listByGame().map((s) => [s.name, s]));
    const out: { name: string; had: number; total: number }[] = [];
    for (const [name, games] of all) {
      const s = listed.get(name);
      if (!s || hidden.has(name) || !games.some((g) => g.platformKey === platformKey && normalizeTitle(g.title) === key)) continue;
      out.push({ name, had: s.had, total: s.total });
    }
    return out.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }

  /** One series' games: the ones you don't own first, each group by release date, then title. */
  detail(name: string): SeriesGame[] | null {
    const games = this.named(name);
    if (!games) return null;
    const rank = (g: SeriesGame) => (g.status === 'owned' ? 1 : 0);
    const preferences = this.preferences();
    return [...games].map((g) => ({ ...g, preference: preferences.get(`${g.platformKey}|${normalizeTitle(g.title)}`) ?? null, onPc: g.status !== 'owned' && this.onPc(g.title) })).sort((a, b) => rank(a) - rank(b) || (a.released ?? '9999').localeCompare(b.released ?? '9999') || a.title.localeCompare(b.title) || a.platform.localeCompare(b.platform));
  }
}

/** Series: GET /api/v1/series and GET /api/v1/series/games?name=. */
export function registerSeriesRoutes(app: FastifyInstance, series: SeriesService): void {
  // ?by=game: each game counted once, wherever you have it (the Nutshell's Series); otherwise each console's apart (Sets > Series).
  app.get('/api/v1/series', async (request) => ((request.query as { by?: string }).by === 'game' ? series.listByGame() : series.list()));

  app.get('/api/v1/series/games', async (request, reply) => {
    const { name, by } = request.query as { name?: string; by?: string };
    const games = name ? (by === 'game' ? series.detailByGame(name) : series.detail(name)) : null;
    if (!games) return reply.code(404).send({ error: 'not-found', message: 'No such series in your catalogs.' });
    return games;
  });

  // The series a game is in (its page's Series tab).
  app.get('/api/v1/series/of', async (request, reply) => {
    const { platform, title } = request.query as { platform?: string; title?: string };
    if (!platform || !title) return reply.code(400).send({ error: 'invalid', message: 'Give a platform key and a title.' });
    return { series: series.of(platform, title) };
  });
}
