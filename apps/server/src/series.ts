import { baseTitle, matchKey, normalizeTitle, type IgdbGame } from '@squirrelcade/core';
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
  /**
   * For a remake or remaster (IGDB's links): the game in this series it's a version of, followed back to the first
   * one, with its first release; so an opened series can show versions together. "version" when it took more than
   * one step (a remaster of a remake).
   */
  original?: { title: string; released: string | null; kind: 'remake' | 'remaster' | 'version' };
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
  private cache: { key: string; games: Map<string, SeriesGame[]>; custom: Set<string> } | null = null;

  constructor(
    private readonly catalogs: CatalogService,
    private readonly igdb: IgdbService,
    private readonly settings: SettingsService,
    /** Your wishlist preferences by "platform key|normalized title". */
    private readonly preferences: () => Map<string, string> = () => new Map(),
    /** Whether you have a title on PC (the PC library; false while it's off). */
    private readonly onPc: (title: string) => boolean = () => false,
  ) {}

  private games(): Map<string, SeriesGame[]> {
    return this.worked().games;
  }

  /** Every series' games (IGDB's, and your own), and which series are your own. */
  private worked(): { games: Map<string, SeriesGame[]>; custom: Set<string> } {
    const own = this.settings.get('collection.customSeries');
    const key = `${this.catalogs.stamp()}|${this.igdb.stamp()}|${own.join('\n')}`;
    if (this.cache?.key === key) return this.cache;
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
        const name = game?.franchise?.trim();
        if (!name) continue;
        const list = bySeries.get(name) ?? [];
        const elsewhere = t.status === 'owned' ? [] : [...(ownedOn.get(matchKey(baseTitle(t.target.title))) ?? [])].filter((n) => n !== p.name);
        const entry: SeriesGame = { platformKey: p.key, platform: p.name, title: t.target.title, status: t.status, released: game?.released ?? null, ownedOn: elsewhere };
        if (game) igdbOf.set(entry, game);
        list.push(entry);
        bySeries.set(name, list);
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
          const entry: SeriesGame = { platformKey: p.key, platform: p.name, title: t.target.title, status: t.status, released: game?.released ?? null, ownedOn: elsewhere };
          if (game) igdbOf.set(entry, game);
          list.push(entry);
        }
      }
      if (list.length === 0) continue;
      bySeries.set(name, list);
      custom.add(name);
    }
    for (const list of bySeries.values()) linkVersions(list, igdbOf);
    this.cache = { key, games: bySeries, custom };
    return this.cache;
  }

  /**
   * Every series with a game owned and at least Settings > Collection > "Fewest games for a series" in the
   * catalogs (so a single game with a series name isn't a "series"): the most owned first.
   */
  list(): SeriesSummary[] {
    const out: SeriesSummary[] = [];
    const fewest = this.settings.get('collection.seriesMinGames');
    const { games: all, custom } = this.worked();
    for (const [name, games] of all) {
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

  /** One series' games: the ones you don't own first, each group by release date, then title. */
  detail(name: string): SeriesGame[] | null {
    const games = this.games().get(name);
    if (!games) return null;
    const rank = (g: SeriesGame) => (g.status === 'owned' ? 1 : 0);
    const preferences = this.preferences();
    return [...games].map((g) => ({ ...g, preference: preferences.get(`${g.platformKey}|${normalizeTitle(g.title)}`) ?? null, onPc: g.status !== 'owned' && this.onPc(g.title) })).sort((a, b) => rank(a) - rank(b) || (a.released ?? '9999').localeCompare(b.released ?? '9999') || a.title.localeCompare(b.title) || a.platform.localeCompare(b.platform));
  }
}

/** Series: GET /api/v1/series and GET /api/v1/series/games?name=. */
export function registerSeriesRoutes(app: FastifyInstance, series: SeriesService): void {
  app.get('/api/v1/series', async () => series.list());

  app.get('/api/v1/series/games', async (request, reply) => {
    const name = (request.query as { name?: string }).name;
    const games = name ? series.detail(name) : null;
    if (!games) return reply.code(404).send({ error: 'not-found', message: 'No such series in your catalogs.' });
    return games;
  });
}
