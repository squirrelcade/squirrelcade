import { consoleInUse, KNOWN_PLATFORMS, normalizeTitle, platformInText, regionalConsole } from '@squirrelcade/core';
import { eq, inArray, and } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { platforms, raProgress } from './db/schema.js';
import type { FetchLike } from './igdb.js';
import type { PlayService } from './play.js';
import type { SettingsService } from './settings.js';
import type { TaskRunner } from './tasks.js';

/**
 * RetroAchievements (0.18.0, D80): the owner's progress on retroachievements.org, read daily with their username and
 * web API key, each game matched to a console and a game Squirrelcade knows; shown in the game's drawer, and optionally
 * marked in What you played. Squirrelcade only reads.
 */

/** RetroAchievements didn't answer as hoped: what to tell the owner. */
export class RaError extends Error {}

/** A game's progress as the drawer shows it. */
export interface RaGame {
  gameId: number;
  title: string;
  numAwarded: number;
  numAwardedHardcore: number;
  maxPossible: number;
  /** RetroAchievements' highest award: beaten-softcore, beaten-hardcore, completed (softcore mastery) or mastered. */
  award: string | null;
  awardedAt: string | null;
  lastPlayedAt: string | null;
  url: string;
}

/** One game of RetroAchievements' progress answer (API_GetUserCompletionProgress). */
interface RaProgressItem {
  GameID: number;
  Title: string;
  ConsoleID: number;
  ConsoleName: string;
  MaxPossible: number;
  NumAwarded: number;
  NumAwardedHardcore: number;
  MostRecentAwardedDate: string | null;
  HighestAwardKind: string | null;
  HighestAwardDate: string | null;
}

/** RetroAchievements' console names, as Squirrelcade's consoles (the ones it doesn't know are kept, unmatched). */
const RA_CONSOLES: Record<string, string> = {
  'genesis/mega drive': 'sega-genesis',
  'nintendo 64': 'nintendo-64',
  'snes/super famicom': 'super-nintendo',
  'game boy': 'game-boy',
  'game boy advance': 'game-boy-advance',
  'game boy color': 'game-boy-color',
  'nes/famicom': 'nintendo-entertainment-system',
  'pc engine/turbografx-16': 'turbografx-16',
  'sega cd': 'sega-cd',
  '32x': 'sega-32x',
  'master system': 'sega-master-system',
  playstation: 'playstation',
  'atari lynx': 'atari-lynx',
  'game gear': 'sega-game-gear',
  gamecube: 'nintendo-gamecube',
  'atari jaguar': 'atari-jaguar',
  'nintendo ds': 'nintendo-ds',
  'nintendo dsi': 'nintendo-ds',
  'playstation 2': 'playstation-2',
  'magnavox odyssey 2': 'magnavox-odyssey-2',
  'atari 2600': 'atari-2600',
  'atari 5200': 'atari-5200',
  'atari 7800': 'atari-7800',
  'virtual boy': 'virtual-boy',
  saturn: 'sega-saturn',
  dreamcast: 'sega-dreamcast',
  'playstation portable': 'psp',
  '3do interactive multiplayer': '3do',
  colecovision: 'colecovision',
  intellivision: 'intellivision',
  'game & watch': 'game-and-watch',
  'nokia n-gage': 'n-gage',
  wii: 'wii',
  'nintendo 3ds': 'nintendo-3ds',
};

/** A RetroAchievements console as Squirrelcade's platform key, or null for one it doesn't track (Arcade, MSX...). */
export function raPlatformKey(consoleName: string): string | null {
  return RA_CONSOLES[consoleName.trim().toLowerCase()] ?? platformInText(consoleName, KNOWN_PLATFORMS);
}

/**
 * A RetroAchievements title as a game's title: without its tags ("~Unlicensed~"), its other names after " | ",
 * "Legend of Zelda, The - A Link to the Past" as "The Legend of Zelda: A Link to the Past". Null for what isn't a
 * released game: hacks, homebrew, prototypes, demos and achievement subsets.
 */
export function raGameTitle(title: string): string | null {
  if (/~\s*(hack|homebrew|prototype|demo|test kit)\s*~|\[subset/i.test(title)) return null;
  const clean = title.split(' | ')[0]!.replace(/\s*~[^~]*~\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const [main, ...rest] = clean.split(' - ');
  const moved = main!.replace(/^(.*), (The|A|An)$/i, '$2 $1');
  return [moved, ...rest].join(': ');
}

/** RetroAchievements' award as What you played's status: mastered or completed is Completed, beaten is Beaten. */
const PLAY_OF_AWARD: Record<string, 'beaten' | 'completed'> = {
  'beaten-softcore': 'beaten',
  'beaten-hardcore': 'beaten',
  completed: 'completed',
  mastered: 'completed',
};

const PAGE = 500;

export class RetroAchievementsService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly log: Logger,
    /** The game Squirrelcade knows on a console by this title (compared as the catalogs compare titles), and whether the owner has it; or null. */
    private readonly matchTitle: (platformKey: string, title: string) => { title: string; owned: boolean } | null,
    private readonly play: PlayService,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  enabled(): boolean {
    return this.settings.get('features.retroachievements');
  }

  configured(): boolean {
    return Boolean(this.settings.get('sources.raUsername').trim() && this.settings.get('sources.raApiKey'));
  }

  /** One page of the owner's progress, newest played first. */
  private async page(offset: number, count = PAGE): Promise<{ Count: number; Total: number; Results: RaProgressItem[] }> {
    const user = this.settings.get('sources.raUsername').trim();
    const url = new URL('https://retroachievements.org/API/API_GetUserCompletionProgress.php');
    url.searchParams.set('u', user);
    url.searchParams.set('y', this.settings.get('sources.raApiKey'));
    url.searchParams.set('c', String(count));
    url.searchParams.set('o', String(offset));
    const res = await this.fetchImpl(url.toString(), { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
    if (res.status === 401 || res.status === 403) throw new RaError("RetroAchievements didn't take the web API key (Settings > Sources > RetroAchievements).");
    if (res.status === 404 || res.status === 422) throw new RaError(`RetroAchievements doesn't know the user "${user}".`);
    if (!res.ok) throw new RaError(`RetroAchievements answered ${res.status}.`);
    const body = (await res.json()) as { Count?: number; Total?: number; Results?: RaProgressItem[] };
    return { Count: body.Count ?? 0, Total: body.Total ?? 0, Results: body.Results ?? [] };
  }

  /** The Test button: whether RetroAchievements takes the username and key, and how many games it has progress in. */
  async test(): Promise<{ ok: boolean; message: string }> {
    if (!this.configured()) return { ok: false, message: 'Enter your RetroAchievements username and web API key first (and save them).' };
    try {
      const first = await this.page(0, 1);
      return { ok: true, message: `RetroAchievements took the key: ${this.settings.get('sources.raUsername').trim()} has progress in ${first.Total} ${first.Total === 1 ? 'game' : 'games'}.` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * The task: reads every game with progress, matches each to a console and a game Squirrelcade knows, keeps them
   * (replacing the last read), and marks What you played when Settings says so. What it did, in a line.
   */
  async sync(progress?: (text: string) => void): Promise<string> {
    if (!this.enabled()) return 'RetroAchievements is off (Settings > Features).';
    if (!this.configured()) return 'RetroAchievements needs your username and web API key (Settings > Sources > RetroAchievements).';
    const items: RaProgressItem[] = [];
    for (let offset = 0; ; offset += PAGE) {
      progress?.(`Reading RetroAchievements (${items.length})`);
      const page = await this.page(offset);
      items.push(...page.Results);
      if (page.Results.length < PAGE || items.length >= page.Total) break;
    }
    const now = new Date().toISOString();
    // Another region's consoles of their own in use (the Super Famicom, while the Super Nintendo is region-locked).
    const home = this.settings.get('general.homeRegion');
    const locked = this.settings.get('platforms.regionLocked');
    const regional = this.db
      .select({ key: platforms.key })
      .from(platforms)
      .all()
      .map((r) => r.key)
      .filter((k) => regionalConsole(k) !== null && consoleInUse(k, home, locked));
    const rows = items.map((i) => {
      const base = raPlatformKey(i.ConsoleName);
      const title = raGameTitle(i.Title);
      // On its console, or one of its region's consoles of their own: the first the owner has a copy on, else the first
      // that knows the game, else its console under RetroAchievements' own title.
      let placed: { platformKey: string; title: string } | null = null;
      if (base && title) {
        for (const key of [base, ...regional.filter((k) => regionalConsole(k)!.base === base)]) {
          const m = this.matchTitle(key, title);
          if (!m) continue;
          if (m.owned) {
            placed = { platformKey: key, title: m.title };
            break;
          }
          placed ??= { platformKey: key, title: m.title };
        }
        placed ??= { platformKey: base, title };
      }
      const platformKey = placed?.platformKey ?? null;
      const matched = placed?.title ?? null;
      return {
        gameId: i.GameID,
        title: i.Title,
        consoleName: i.ConsoleName,
        platformKey: matched ? platformKey : null,
        titleKey: matched ? normalizeTitle(matched) : null,
        gameTitle: matched,
        numAwarded: i.NumAwarded ?? 0,
        numAwardedHardcore: i.NumAwardedHardcore ?? 0,
        maxPossible: i.MaxPossible ?? 0,
        award: i.HighestAwardKind || null,
        awardedAt: i.HighestAwardDate || null,
        lastPlayedAt: i.MostRecentAwardedDate || null,
        syncedAt: now,
      };
    });
    this.db.transaction((tx) => {
      tx.delete(raProgress).run();
      for (let i = 0; i < rows.length; i += 200) tx.insert(raProgress).values(rows.slice(i, i + 200).map(({ gameTitle: _t, ...r }) => r)).run();
    });
    // What you played, for games with an award and no status of the owner's (Settings > Sources > RetroAchievements).
    let marked = 0;
    if (this.settings.get('sources.raMarkPlayed') === 'beaten') {
      for (const r of rows) {
        const status = r.award ? PLAY_OF_AWARD[r.award] : undefined;
        if (!status || !r.platformKey || !r.gameTitle) continue;
        const before = this.play.of(r.platformKey, [r.gameTitle]);
        if (before?.status) continue;
        this.play.set({ platformKey: r.platformKey, titles: [r.gameTitle], status });
        marked++;
      }
    }
    const matched = rows.filter((r) => r.platformKey).length;
    const awarded = rows.filter((r) => r.award).length;
    this.log.info({ context: 'retroachievements' }, `Read ${rows.length} games from RetroAchievements`);
    return `${rows.length} games with progress (${matched} matched to your consoles, ${awarded} beaten or mastered)${marked > 0 ? `; ${marked} marked in What you played` : ''}`;
  }

  /** A game's progress, for its drawer: by its console and any of its titles. */
  forGame(platformKey: string, titles: string[]): RaGame | null {
    if (!this.enabled()) return null;
    const keys = [...new Set(titles.map(normalizeTitle))];
    const row = this.db
      .select()
      .from(raProgress)
      .where(and(eq(raProgress.platformKey, platformKey), inArray(raProgress.titleKey, keys)))
      .all()
      .sort((a, b) => b.numAwarded - a.numAwarded)[0];
    if (!row) return null;
    return {
      gameId: row.gameId,
      title: row.title,
      numAwarded: row.numAwarded,
      numAwardedHardcore: row.numAwardedHardcore,
      maxPossible: row.maxPossible,
      award: row.award,
      awardedAt: row.awardedAt,
      lastPlayedAt: row.lastPlayedAt,
      url: `https://retroachievements.org/game/${row.gameId}`,
    };
  }

  /** Settings' summary: the last read's games, how many matched, beaten and mastered. */
  status(): { on: boolean; configured: boolean; games: number; matched: number; beaten: number; mastered: number; syncedAt: string | null } {
    const rows = this.db.select({ platformKey: raProgress.platformKey, award: raProgress.award, syncedAt: raProgress.syncedAt }).from(raProgress).all();
    return {
      on: this.enabled(),
      configured: this.configured(),
      games: rows.length,
      matched: rows.filter((r) => r.platformKey).length,
      beaten: rows.filter((r) => r.award?.startsWith('beaten')).length,
      mastered: rows.filter((r) => r.award === 'mastered' || r.award === 'completed').length,
      syncedAt: rows[0]?.syncedAt ?? null,
    };
  }
}

/** RetroAchievements: its summary, the Test button, and reading the progress again now (in the background). */
export function registerRetroAchievementsRoutes(app: FastifyInstance, ra: RetroAchievementsService, tasks: TaskRunner): void {
  app.get('/api/v1/sources/retroachievements', async () => ra.status());
  app.post('/api/v1/sources/retroachievements/test', async () => ra.test());
  app.post('/api/v1/sources/retroachievements/sync', async (_request, reply) => {
    tasks.enqueue('ra-sync');
    return reply.code(202).send({ queued: true });
  });
}
