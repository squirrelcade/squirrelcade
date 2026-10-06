import {
  ACHIEVEMENT_SOURCES,
  achievementTitle,
  normalizeTitle,
  parseSteamProfile,
  psnCompleted,
  psnPlatformKeys,
  trophyCount,
  xboxCompleted,
  xboxPlatformKeys,
  type AchievementSource,
  type TrophyCounts,
  type XboxTitleProgress,
} from '@squirrelcade/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import https from 'node:https';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import type { FetchLike } from './igdb.js';
import { achievementProgress, appState } from './db/schema.js';
import type { PlayService } from './play.js';
import type { SettingsService } from './settings.js';
import type { TaskRunner } from './tasks.js';

/** A Steam game's achievements, for the PC library's row (by the game's Steam app id). */
export interface SteamProgress {
  earned: number;
  total: number;
  progress: number;
  completed: boolean;
  lastPlayedAt: string | null;
}

/**
 * Achievements from Xbox and PlayStation (0.24.0, D88), and Steam (0.28.0, D92), beside RetroAchievements: the owner's progress in each game,
 * read daily, matched to their consoles (the one they own a copy on first), shown in the game's drawer and optionally
 * marked in What you played. Xbox is read through OpenXBL (xbl.io, a key the owner makes); PlayStation through the
 * PlayStation App's API (psn-api), signed in with a token the owner copies from their browser. Squirrelcade only reads.
 */

/** A service didn't answer as hoped: what to tell the owner. */
export class AchievementsError extends Error {}

/** OpenXBL's answer to a GET: its status and body. */
export type XboxGet = (path: string, apiKey: string) => Promise<{ status: number; body: string }>;

/**
 * A GET to OpenXBL with Node's https module: its server answers Node's built-in fetch with an error inside an HTTP 200
 * (other OpenXBL clients found the same), while https and curl get the answer.
 */
export const xboxHttpsGet: XboxGet = (path, apiKey) =>
  new Promise((resolve, reject) => {
    const req = https.get(`https://api.xbl.io${path}`, { headers: { 'X-Authorization': apiKey, Accept: 'application/json' }, timeout: 30_000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('timeout', () => req.destroy(new AchievementsError('OpenXBL took too long to answer.')));
    req.on('error', reject);
  });

/** Sign-in tokens from PlayStation: an access token (an hour) and a refresh token (about two months). */
export interface PsnTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds the refresh token lasts. */
  refreshTokenExpiresIn: number;
}

/** One trophy list of the owner's (PlayStation's trophyTitles). */
export interface PsnTrophyTitle {
  npCommunicationId: string;
  trophyTitleName: string;
  /** "PS4", "PS5", or several: "PS3,PSVITA". */
  trophyTitlePlatform: string;
  definedTrophies?: TrophyCounts;
  earnedTrophies?: TrophyCounts;
  progress?: number;
  lastUpdatedDateTime?: string;
}

/** PlayStation's sign-in and the owner's trophy lists, 800 a page (psn.ts; tests use a fake). */
export interface PsnApi {
  signIn(npsso: string): Promise<PsnTokens>;
  refresh(refreshToken: string): Promise<PsnTokens>;
  titles(accessToken: string, offset: number): Promise<{ trophyTitles: PsnTrophyTitle[]; totalItemCount: number; nextOffset?: number }>;
}

/** A game's progress on Xbox or PlayStation, as its drawer shows it. */
export interface AchievementView {
  source: AchievementSource;
  title: string;
  /** Achievements (trophies) earned, of how many; total 0 when the service doesn't say (an Xbox 360 game). */
  earned: number;
  total: number;
  /** Xbox's gamerscore. */
  pointsEarned: number | null;
  pointsTotal: number | null;
  progress: number;
  /** PlayStation: whether its platinum is earned; null for a game without one (and on Xbox). */
  platinum: boolean | null;
  completed: boolean;
  lastPlayedAt: string | null;
}

/** A game as read from a service, before it's matched. */
interface Read {
  externalId: string;
  title: string;
  platforms: string;
  candidates: string[];
  earned: number;
  total: number;
  pointsEarned: number | null;
  pointsTotal: number | null;
  progress: number;
  platinum: boolean | null;
  completed: boolean;
  lastPlayedAt: string | null;
}

/** A game Squirrelcade knows on a console by a title: its title there, and whether the owner has a copy. */
export type AchievementMatch = (platformKey: string, title: string) => { title: string; owned: boolean } | null;

/** app_state: PlayStation's refresh token, when it runs out, and which sign-in token it came from (a hash). */
const PSN_AUTH = 'psn.auth';
interface PsnAuth {
  refreshToken: string;
  until: string;
  from: string;
}

const PSN_EXPIRED =
  "PlayStation didn't take the sign-in token; they last about two months. Sign in at playstation.com, open ca.account.sony.com/api/v1/ssocookie in the same browser, and copy the new token into Settings > Sources > PlayStation trophies.";

const SETTINGS: Record<
  AchievementSource,
  { feature: 'features.xbox' | 'features.playstation' | 'features.steam'; keys: ('sources.xboxApiKey' | 'sources.psnToken' | 'sources.steamApiKey' | 'sources.steamId')[]; mark: 'sources.xboxMarkPlayed' | 'sources.psnMarkPlayed' | null }
> = {
  xbox: { feature: 'features.xbox', keys: ['sources.xboxApiKey'], mark: 'sources.xboxMarkPlayed' },
  playstation: { feature: 'features.playstation', keys: ['sources.psnToken'], mark: 'sources.psnMarkPlayed' },
  // Steam's games are PC games: shown in the PC library, not marked in What you played (the consoles' list).
  steam: { feature: 'features.steam', keys: ['sources.steamApiKey', 'sources.steamId'], mark: null },
};

/** app_state: the Steam id a custom profile name was found to be, and the name. */
const STEAM_ID = 'steam.id';
const STEAM_PRIVATE =
  "Steam shows no games for this profile: its game details aren't public (Steam, your profile, Edit Profile, Privacy Settings, Game details: Public), or the profile isn't yours.";
/** After this many games in a row Steam didn't answer about, the read stops asking (the rest wait for the next read). */
const STEAM_MAX_MISSED = 5;
/** At most this many games' achievements asked of Steam in one read (the rest the next day); Steam allows 100,000 a day. */
const STEAM_MAX_PER_READ = 2000;

/** One game of Steam's owned games list (IPlayerService/GetOwnedGames). */
interface SteamOwnedGame {
  appid: number;
  name?: string;
  playtime_forever?: number;
  rtime_last_played?: number;
  has_community_visible_stats?: boolean;
}

export class AchievementsService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly log: Logger,
    private readonly match: AchievementMatch,
    private readonly play: PlayService,
    private readonly xboxGet: XboxGet,
    private readonly psn: PsnApi,
    /** Steam's Web API (api.steampowered.com), and the time between its per-game requests. */
    private readonly steamFetch: FetchLike = fetch,
    private readonly steamPaceMs = 250,
  ) {}

  /** The last Steam read: games asked of Steam, those it didn't answer about, and those left for the next read. */
  private steamRead = { asked: 0, missed: 0, left: 0 };

  enabled(source: AchievementSource): boolean {
    return this.settings.get(SETTINGS[source].feature);
  }

  configured(source: AchievementSource): boolean {
    return SETTINGS[source].keys.every((k) => Boolean(this.settings.get(k).trim()));
  }

  private state<T>(key: string): T | null {
    const row = this.db.select().from(appState).where(eq(appState.key, key)).get();
    try {
      return row ? (JSON.parse(row.value) as T) : null;
    } catch {
      return null;
    }
  }

  private keepState(key: string, value: unknown): void {
    const text = JSON.stringify(value);
    this.db.insert(appState).values({ key, value: text }).onConflictDoUpdate({ target: appState.key, set: { value: text } }).run();
  }

  /** A Steam Web API answer, asked with the key: its status and its JSON (null when it isn't JSON). */
  private async steam<T>(path: string, params: Record<string, string>): Promise<{ status: number; body: T | null }> {
    const url = new URL(`https://api.steampowered.com${path}`);
    url.searchParams.set('key', this.settings.get('sources.steamApiKey').trim());
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await this.steamFetch(url.toString(), { signal: AbortSignal.timeout(20_000), headers: { accept: 'application/json' } });
    let body: T | null = null;
    try {
      body = (await res.json()) as T;
    } catch {
      body = null;
    }
    return { status: res.status, body };
  }

  /** Steam's refusals, as the owner can act on them. */
  private steamStatus(status: number): void {
    if (status === 401 || status === 403) throw new AchievementsError("Steam didn't take the Web API key (Settings > Sources > Steam achievements).");
    if (status === 429) throw new AchievementsError('Steam asks to wait (too many requests); Squirrelcade reads again tomorrow.');
    if (status >= 500) throw new AchievementsError(`Steam answered ${status}; Squirrelcade tries again tomorrow.`);
  }

  /** The owner's Steam id: given, or found from the profile's custom name (and kept). */
  private async steamId(): Promise<string> {
    const given = this.settings.get('sources.steamId').trim();
    const parsed = parseSteamProfile(given);
    if (!parsed) throw new AchievementsError("That isn't a Steam profile: give its address, its custom name or its 17-digit ID (Settings > Sources > Steam achievements).");
    if ('id64' in parsed) return parsed.id64;
    const kept = this.state<{ from: string; id: string }>(STEAM_ID);
    if (kept?.from === given) return kept.id;
    const r = await this.steam<{ response?: { steamid?: string; success?: number } }>('/ISteamUser/ResolveVanityURL/v1/', { vanityurl: parsed.vanity });
    this.steamStatus(r.status);
    const id = r.body?.response?.success === 1 ? r.body.response.steamid : undefined;
    if (!id) throw new AchievementsError(`Steam knows no profile called "${parsed.vanity}": give its address or its 17-digit ID.`);
    this.keepState(STEAM_ID, { from: given, id });
    return id;
  }

  /**
   * The owner's Steam games with achievements: the owned games (one request), then each played game's achievements,
   * asked only when it was played since the last read (a game's achievements change only when it's played).
   */
  private async readSteam(progress?: (text: string) => void): Promise<Read[]> {
    const steamid = await this.steamId();
    const owned = await this.steam<{ response?: { games?: SteamOwnedGame[] } }>('/IPlayerService/GetOwnedGames/v1/', { steamid, include_appinfo: '1', include_played_free_games: '1' });
    this.steamStatus(owned.status);
    const games = owned.body?.response?.games;
    if (!Array.isArray(games)) throw new AchievementsError(STEAM_PRIVATE);
    const kept = new Map(
      this.db
        .select()
        .from(achievementProgress)
        .where(eq(achievementProgress.source, 'steam'))
        .all()
        .map((r) => [r.externalId, r] as const),
    );
    const again = (r: typeof achievementProgress.$inferSelect): Read => ({
      externalId: r.externalId,
      title: r.title,
      platforms: r.platforms,
      candidates: [],
      earned: r.earned,
      total: r.total,
      pointsEarned: null,
      pointsTotal: null,
      progress: r.progress,
      platinum: null,
      completed: r.completed,
      lastPlayedAt: r.lastPlayedAt,
    });
    const played = games.filter((g) => (g.playtime_forever ?? 0) > 0 && g.has_community_visible_stats !== false);
    const reads: Read[] = [];
    const counts = (this.steamRead = { asked: 0, missed: 0, left: 0 });
    let missedInARow = 0;
    for (const [i, g] of played.entries()) {
      const appid = String(g.appid);
      const lastPlayedAt = g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString() : null;
      const before = kept.get(appid);
      if (before && before.lastPlayedAt === lastPlayedAt) {
        reads.push(again(before));
        continue;
      }
      // Past the most asked in one read, or once Steam stopped answering: kept as they were, and asked at the next read.
      if (counts.asked >= STEAM_MAX_PER_READ || missedInARow >= STEAM_MAX_MISSED) {
        counts.left++;
        if (before) reads.push(again(before));
        continue;
      }
      progress?.(`Reading Steam achievements (${i + 1} of ${played.length})`);
      if (counts.asked > 0 && this.steamPaceMs > 0) await new Promise((done) => setTimeout(done, this.steamPaceMs));
      counts.asked++;
      const r = await this.steam<{ playerstats?: { gameName?: string; achievements?: { achieved?: number }[]; error?: string } }>('/ISteamUserStats/GetPlayerAchievements/v1/', { steamid, appid }).catch(() => null);
      const stats = r?.body?.playerstats;
      if (stats?.error && /not public/i.test(stats.error)) throw new AchievementsError(STEAM_PRIVATE);
      if (r && !stats && (r.status === 401 || r.status === 403)) this.steamStatus(r.status);
      // A game Steam didn't answer about (no answer, too busy, or an error of its own) is kept as it was, and asked
      // again at the next read, so one game's trouble doesn't stop the others.
      if (!stats) {
        counts.missed++;
        missedInARow++;
        if (before) reads.push(again(before));
        continue;
      }
      missedInARow = 0;
      // A game without achievements is kept with none, so it isn't asked again until it's played.
      const list = Array.isArray(stats?.achievements) ? stats.achievements : [];
      const total = list.length;
      const earned = list.filter((a) => a.achieved === 1).length;
      reads.push({
        externalId: appid,
        title: g.name ?? stats?.gameName ?? appid,
        platforms: 'PC',
        candidates: [],
        earned,
        total,
        pointsEarned: null,
        pointsTotal: null,
        progress: total > 0 ? Math.round((earned / total) * 100) : 0,
        platinum: null,
        completed: total > 0 && earned === total,
        lastPlayedAt,
      });
    }
    if (counts.asked > 0 && counts.missed === counts.asked) throw new AchievementsError(`Steam didn't answer about ${counts.asked === 1 ? 'the one game' : `any of the ${counts.asked} games`} asked; Squirrelcade tries again tomorrow.`);
    return reads;
  }

  /** An OpenXBL answer's payload: newer answers wrap it ({content, code}), and code says whether Xbox Live answered. */
  private async xbox<T>(path: string): Promise<T> {
    const res = await this.xboxGet(path, this.settings.get('sources.xboxApiKey').trim());
    if (res.status === 401 || res.status === 403) throw new AchievementsError("OpenXBL didn't take the API key (Settings > Sources > Xbox achievements).");
    if (res.status === 429) throw new AchievementsError('OpenXBL asks to wait (too many requests this hour); Squirrelcade reads again tomorrow.');
    if (res.status < 200 || res.status >= 300) throw new AchievementsError(`OpenXBL answered ${res.status}.`);
    let body: unknown;
    try {
      body = JSON.parse(res.body);
    } catch {
      throw new AchievementsError("OpenXBL's answer couldn't be read.");
    }
    if (body && typeof body === 'object' && 'content' in body) {
      const wrapped = body as { content: T; code?: number; message?: string };
      if (wrapped.code !== undefined && wrapped.code !== 200) throw new AchievementsError(`Xbox Live answered ${wrapped.code}${wrapped.message ? `: ${wrapped.message}` : ''}.`);
      return wrapped.content;
    }
    return body as T;
  }

  /** The owner's Xbox games with achievements: OpenXBL's title history (one request). */
  private async readXbox(): Promise<Read[]> {
    type Title = { titleId?: string | number; name?: string; type?: string; devices?: string[]; achievement?: XboxTitleProgress; titleHistory?: { lastTimePlayed?: string } };
    const content = await this.xbox<{ titles?: Title[] }>('/v2/achievements');
    if (!Array.isArray(content?.titles)) throw new AchievementsError('OpenXBL answered without a list of games.');
    return content.titles
      .filter((t) => t.titleId !== undefined && t.name && !/app/i.test(t.type ?? ''))
      .filter((t) => (t.achievement?.totalGamerscore ?? 0) > 0 || (t.achievement?.totalAchievements ?? 0) > 0 || (t.achievement?.currentAchievements ?? 0) > 0)
      .map((t) => {
        const a = t.achievement ?? {};
        return {
          externalId: String(t.titleId),
          title: t.name!,
          platforms: (t.devices ?? []).join(','),
          candidates: xboxPlatformKeys(t.devices ?? []),
          earned: a.currentAchievements ?? 0,
          total: a.totalAchievements ?? 0,
          pointsEarned: a.currentGamerscore ?? null,
          pointsTotal: a.totalGamerscore ?? null,
          progress: Math.round(a.progressPercentage ?? 0),
          platinum: null,
          completed: xboxCompleted(a),
          lastPlayedAt: t.titleHistory?.lastTimePlayed ?? null,
        };
      });
  }

  private psnAuth(): PsnAuth | null {
    const row = this.db.select().from(appState).where(eq(appState.key, PSN_AUTH)).get();
    try {
      return row ? (JSON.parse(row.value) as PsnAuth) : null;
    } catch {
      return null;
    }
  }

  private keepPsnAuth(t: PsnTokens, from: string): void {
    const value = JSON.stringify({ refreshToken: t.refreshToken, until: new Date(Date.now() + t.refreshTokenExpiresIn * 1000).toISOString(), from } satisfies PsnAuth);
    this.db.insert(appState).values({ key: PSN_AUTH, value }).onConflictDoUpdate({ target: appState.key, set: { value } }).run();
  }

  /** An access token: from the kept refresh token while it lasts (and came from the same sign-in token), else a new sign-in. */
  private async psnAccess(): Promise<string> {
    const npsso = this.settings.get('sources.psnToken').trim();
    const from = createHash('sha256').update(npsso).digest('hex').slice(0, 16);
    const kept = this.psnAuth();
    if (kept && kept.from === from && Date.parse(kept.until) > Date.now() + 60_000) {
      try {
        const t = await this.psn.refresh(kept.refreshToken);
        if (t.accessToken) {
          this.keepPsnAuth({ ...t, refreshToken: t.refreshToken || kept.refreshToken, refreshTokenExpiresIn: t.refreshToken ? t.refreshTokenExpiresIn : Math.round((Date.parse(kept.until) - Date.now()) / 1000) }, from);
          return t.accessToken;
        }
      } catch (err) {
        this.log.warn({ context: 'achievements' }, `PlayStation's refresh failed, signing in again: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    let t: PsnTokens;
    try {
      t = await this.psn.signIn(npsso);
    } catch (err) {
      // psn-api says "Is your NPSSO code valid?" when PlayStation doesn't take the token; other failures are the network's.
      const said = err instanceof Error ? err.message : String(err);
      throw new AchievementsError(/npsso|access code/i.test(said) ? PSN_EXPIRED : `PlayStation's sign-in failed: ${said.trim()}`);
    }
    if (!t.accessToken) throw new AchievementsError(PSN_EXPIRED);
    this.keepPsnAuth(t, from);
    return t.accessToken;
  }

  /** The owner's PlayStation games with trophies: their trophy lists, 800 a request. */
  private async readPlayStation(): Promise<Read[]> {
    const access = await this.psnAccess();
    const titles: PsnTrophyTitle[] = [];
    for (let offset = 0; ; ) {
      const page = await this.psn.titles(access, offset);
      if (!Array.isArray(page?.trophyTitles)) throw new AchievementsError('PlayStation answered without a trophy list.');
      titles.push(...page.trophyTitles);
      if (page.nextOffset === undefined || page.nextOffset <= offset || titles.length >= page.totalItemCount) break;
      offset = page.nextOffset;
    }
    return titles.map((t) => ({
      externalId: t.npCommunicationId,
      title: t.trophyTitleName,
      platforms: t.trophyTitlePlatform,
      candidates: psnPlatformKeys(t.trophyTitlePlatform),
      earned: trophyCount(t.earnedTrophies),
      total: trophyCount(t.definedTrophies),
      pointsEarned: null,
      pointsTotal: null,
      progress: t.progress ?? 0,
      platinum: (t.definedTrophies?.platinum ?? 0) > 0 ? (t.earnedTrophies?.platinum ?? 0) > 0 : null,
      completed: psnCompleted(t.definedTrophies, t.earnedTrophies, t.progress ?? 0),
      lastPlayedAt: t.lastUpdatedDateTime ?? null,
    }));
  }

  /** The console a game is on: the first of its consoles where the owner has a copy, else the first that knows it. */
  private place(candidates: string[], title: string): { platformKey: string; gameTitle: string } | null {
    const name = achievementTitle(title);
    let known: { platformKey: string; gameTitle: string } | null = null;
    for (const key of candidates) {
      const m = this.match(key, name);
      if (!m) continue;
      if (m.owned) return { platformKey: key, gameTitle: m.title };
      known ??= { platformKey: key, gameTitle: m.title };
    }
    return known;
  }

  /** The Test button: whether the service takes the key (or sign-in token), and whose it is or how many games. */
  async test(source: AchievementSource): Promise<{ ok: boolean; message: string }> {
    const name = ACHIEVEMENT_SOURCES[source];
    if (!this.configured(source)) {
      return {
        ok: false,
        message: source === 'xbox' ? 'Enter your OpenXBL API key first (and save it).' : source === 'playstation' ? 'Enter your PlayStation sign-in token first (and save it).' : 'Enter your Steam Web API key and your Steam profile first (and save them).',
      };
    }
    try {
      if (source === 'steam') {
        const steamid = await this.steamId();
        const summary = await this.steam<{ response?: { players?: { personaname?: string; communityvisibilitystate?: number }[] } }>('/ISteamUser/GetPlayerSummaries/v2/', { steamids: steamid });
        this.steamStatus(summary.status);
        const player = summary.body?.response?.players?.[0];
        if (!player) return { ok: false, message: `Steam knows no profile with the ID ${steamid}.` };
        const owned = await this.steam<{ response?: { game_count?: number } }>('/IPlayerService/GetOwnedGames/v1/', { steamid, include_played_free_games: '1' });
        const count = owned.body?.response?.game_count;
        if (count === undefined) return { ok: false, message: `Steam took the key (${player.personaname ?? steamid}), but ${STEAM_PRIVATE.charAt(0).toLowerCase()}${STEAM_PRIVATE.slice(1)}` };
        return { ok: true, message: `Steam took the key: ${player.personaname ?? steamid}, ${count} ${count === 1 ? 'game' : 'games'}.` };
      }
      if (source === 'xbox') {
        const account = await this.xbox<{ profileUsers?: { settings?: { id: string; value: string }[] }[] }>('/v2/account');
        const gamertag = account?.profileUsers?.[0]?.settings?.find((s) => s.id === 'Gamertag')?.value;
        return { ok: true, message: `OpenXBL took the key${gamertag ? `: signed in as ${gamertag}` : ''}.` };
      }
      const games = await this.readPlayStation();
      return { ok: true, message: `PlayStation took the sign-in token: ${games.length} ${games.length === 1 ? 'game' : 'games'} with trophies.` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : `${name}: ${String(err)}` };
    }
  }

  /**
   * The task: reads the owner's games from the service, matches each to a console and a game Squirrelcade knows, keeps
   * them (replacing the last read), and marks What you played when Settings says so. What it did, in a line.
   */
  async sync(source: AchievementSource, progress?: (text: string) => void): Promise<string> {
    const name = ACHIEVEMENT_SOURCES[source];
    if (!this.enabled(source)) return `${name} ${source === 'playstation' ? 'trophies are' : 'achievements are'} off (Settings > Features).`;
    if (!this.configured(source)) {
      return source === 'xbox'
        ? 'Xbox achievements need your OpenXBL API key (Settings > Sources > Xbox achievements).'
        : source === 'playstation'
          ? 'PlayStation trophies need your sign-in token (Settings > Sources > PlayStation trophies).'
          : 'Steam achievements need your Steam Web API key and your Steam profile (Settings > Sources > Steam achievements).';
    }
    progress?.(`Reading ${name}`);
    const read = source === 'xbox' ? await this.readXbox() : source === 'playstation' ? await this.readPlayStation() : await this.readSteam(progress);
    const now = new Date().toISOString();
    const rows = read.map((r) => {
      const placed = this.place(r.candidates, r.title);
      return { ...r, source, platformKey: placed?.platformKey ?? null, titleKey: placed ? normalizeTitle(placed.gameTitle) : null, gameTitle: placed?.gameTitle ?? null, syncedAt: now };
    });
    this.db.transaction((tx) => {
      tx.delete(achievementProgress).where(eq(achievementProgress.source, source)).run();
      for (let i = 0; i < rows.length; i += 200) {
        tx.insert(achievementProgress)
          .values(rows.slice(i, i + 200).map(({ candidates: _c, gameTitle: _g, ...r }) => r))
          .onConflictDoNothing()
          .run();
      }
    });
    // What you played, for completed games without a status of the owner's (Settings > Sources).
    let marked = 0;
    const mark = SETTINGS[source].mark;
    if (mark && this.settings.get(mark) === 'completed') {
      for (const r of rows) {
        if (!r.completed || !r.platformKey || !r.gameTitle) continue;
        if (this.play.of(r.platformKey, [r.gameTitle])?.status) continue;
        this.play.set({ platformKey: r.platformKey, titles: [r.gameTitle], status: 'completed' });
        marked++;
      }
    }
    const matched = rows.filter((r) => r.platformKey).length;
    const completed = rows.filter((r) => r.completed).length;
    this.log.info({ context: 'achievements' }, `Read ${rows.length} games from ${name}`);
    if (source === 'steam') {
      const withAchievements = rows.filter((r) => r.total > 0).length;
      const { asked, missed, left } = this.steamRead;
      const also = [missed > 0 ? `${missed} not answered` : '', left > 0 ? `${left} left` : ''].filter(Boolean).join(', ');
      return `${withAchievements} ${withAchievements === 1 ? 'game' : 'games'} with achievements (${completed} completed); ${asked} asked of Steam${also ? ` (${also}: asked at the next read)` : ''}, the rest not played since the last read`;
    }
    return `${rows.length} games (${matched} matched to your consoles, ${completed} completed)${marked > 0 ? `; ${marked} marked in What you played` : ''}`;
  }

  /** A game's progress on Xbox and PlayStation, for its drawer: by its console and any of its titles. */
  forGame(platformKey: string, titles: string[]): AchievementView[] {
    const sources = (['xbox', 'playstation'] as const).filter((s) => this.enabled(s));
    if (sources.length === 0) return [];
    const keys = [...new Set(titles.map(normalizeTitle))];
    const rows = this.db
      .select()
      .from(achievementProgress)
      .where(and(eq(achievementProgress.platformKey, platformKey), inArray(achievementProgress.titleKey, keys), inArray(achievementProgress.source, sources)))
      .all()
      .sort((a, b) => b.progress - a.progress || b.earned - a.earned);
    const seen = new Set<string>();
    return rows
      .filter((r) => !seen.has(r.source) && seen.add(r.source))
      .map((r) => ({
        source: r.source as AchievementSource,
        title: r.title,
        earned: r.earned,
        total: r.total,
        pointsEarned: r.pointsEarned,
        pointsTotal: r.pointsTotal,
        progress: r.progress,
        platinum: r.platinum,
        completed: r.completed,
        lastPlayedAt: r.lastPlayedAt,
      }));
  }

  /** Each Steam game's achievements, by its Steam app id, for the PC library (nothing while Steam achievements are off). */
  steamProgress(): Map<string, SteamProgress> {
    if (!this.enabled('steam')) return new Map();
    return new Map(
      this.db
        .select()
        .from(achievementProgress)
        .where(eq(achievementProgress.source, 'steam'))
        .all()
        .filter((r) => r.total > 0)
        .map((r) => [r.externalId, { earned: r.earned, total: r.total, progress: r.progress, completed: r.completed, lastPlayedAt: r.lastPlayedAt }] as const),
    );
  }

  /** Health problems: PlayStation's sign-in running out within a week (or run out), while its trophies are read. */
  problems(now = Date.now()): { level: 'warning'; message: string }[] {
    if (!this.enabled('playstation') || !this.configured('playstation')) return [];
    const until = this.psnAuth()?.until;
    if (!until || Date.parse(until) - now > 7 * 86_400_000) return [];
    const day = until.slice(0, 10);
    return [
      {
        level: 'warning',
        message: `PlayStation trophies' sign-in ${Date.parse(until) <= now ? 'ran out' : 'runs out'} on ${day}: sign in at playstation.com, open ca.account.sony.com/api/v1/ssocookie, and copy the new token into Settings > Sources > PlayStation trophies.`,
      },
    ];
  }

  /** Settings' summary: the last read's games, how many matched and completed, and (PlayStation) until when the sign-in lasts. */
  status(source: AchievementSource): { on: boolean; configured: boolean; games: number; matched: number; completed: number; syncedAt: string | null; signedInUntil: string | null } {
    const rows = this.db
      .select({ platformKey: achievementProgress.platformKey, total: achievementProgress.total, completed: achievementProgress.completed, syncedAt: achievementProgress.syncedAt })
      .from(achievementProgress)
      .where(eq(achievementProgress.source, source))
      .all()
      // Steam keeps games without achievements (so they aren't asked again); they don't count.
      .filter((r) => source !== 'steam' || r.total > 0);
    return {
      on: this.enabled(source),
      configured: this.configured(source),
      games: rows.length,
      matched: rows.filter((r) => r.platformKey).length,
      completed: rows.filter((r) => r.completed).length,
      syncedAt: rows[0]?.syncedAt ?? null,
      signedInUntil: source === 'playstation' ? (this.psnAuth()?.until ?? null) : null,
    };
  }
}

/** Xbox, PlayStation and Steam achievements: each one's summary, the Test button, and reading now (in the background). */
export function registerAchievementRoutes(app: FastifyInstance, achievements: AchievementsService, tasks: TaskRunner): void {
  const queued = (task: string, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    tasks.enqueue(task);
    return reply.code(202).send({ queued: true });
  };
  app.get('/api/v1/sources/xbox', async () => achievements.status('xbox'));
  app.post('/api/v1/sources/xbox/test', async () => achievements.test('xbox'));
  app.post('/api/v1/sources/xbox/sync', async (_request, reply) => queued('xbox-sync', reply));
  app.get('/api/v1/sources/playstation', async () => achievements.status('playstation'));
  app.post('/api/v1/sources/playstation/test', async () => achievements.test('playstation'));
  app.post('/api/v1/sources/playstation/sync', async (_request, reply) => queued('psn-sync', reply));
  app.get('/api/v1/sources/steam', async () => achievements.status('steam'));
  app.post('/api/v1/sources/steam/test', async () => achievements.test('steam'));
  app.post('/api/v1/sources/steam/sync', async (_request, reply) => queued('steam-sync', reply));
}
