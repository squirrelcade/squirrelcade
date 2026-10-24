import { channelRef, gameInVideoTitle, normalizeTitle, parseVideoChannels, videoEra, videoKind, videoTitleIndex, youtubeVideoId, type VideoChannel } from '@squirrelcade/core';
import { and, eq, inArray, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import type { CatalogService } from './catalogs.js';
import type { Db } from './db/index.js';
import { gameVideos, videoLookups } from './db/schema.js';
import { catalogTarget } from './games.js';
import type { FetchLike, IgdbService } from './igdb.js';
import type { SettingsService } from './settings.js';

/**
 * Roots' videos (D165 phase 3, D168): a game's videos played on its page. Without a key: the ones the owner pastes
 * (named by YouTube's oEmbed), its trailers from IGDB, and (in the page) the videos its Wikipedia article cites; with
 * a YouTube key, each video channel's whole list read and the videos about the consoles' games kept (only those: as
 * YouTube asks, they're read again within 30 days or dropped). Channels' public feeds are tried without a key too.
 */

/** A video as a game's page shows it. */
export interface GameVideo {
  videoId: string;
  title: string;
  channel: string | null;
  publishedAt: string | null;
  source: 'pasted' | 'igdb' | 'channel';
  kind: string | null;
}

export interface GameVideosView {
  status: 'off' | 'ready';
  time: GameVideo[];
  later: GameVideo[];
  /** A YouTube key is set (channels are read whole). */
  keyed: boolean;
}

/** A video from a channel's list. */
interface ListedVideo {
  videoId: string;
  title: string;
  publishedAt: string | null;
}

const API = 'https://www.googleapis.com/youtube/v3';
const DAY = 86_400_000;
/** YouTube asks that what's kept from its API be refreshed within 30 days. */
const KEEP_DAYS = 30;

export class YouTubeError extends Error {}

/** YouTube: its oEmbed (no key), its Data API (with the key), a channel's page and feed (no key). */
export class YouTubeClient {
  constructor(
    private readonly settings: SettingsService,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  key(): string {
    return this.settings.get('sources.youtubeKey').trim();
  }

  private async get(url: string): Promise<Response> {
    return this.fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 (Squirrelcade)', 'accept-language': 'en-US' }, signal: AbortSignal.timeout(20_000) });
  }

  private async api<T>(path: string, params: Record<string, string>): Promise<T> {
    const res = await this.get(`${API}/${path}?${new URLSearchParams({ ...params, key: this.key() })}`);
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new YouTubeError(`YouTube answered ${res.status}${body?.error?.message ? `: ${body.error.message}` : ''}`);
    }
    return (await res.json()) as T;
  }

  /** A video's title and channel, from YouTube's oEmbed (no key); null when YouTube doesn't know it. */
  async oembed(videoId: string): Promise<{ title: string; author: string | null } | null> {
    const res = await this.get(`https://www.youtube.com/oembed?${new URLSearchParams({ url: `https://www.youtube.com/watch?v=${videoId}`, format: 'json' })}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { title?: string; author_name?: string };
    return body.title ? { title: body.title, author: body.author_name ?? null } : null;
  }

  /** When videos were published (with the key), by id. */
  async published(ids: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!this.key() || ids.length === 0) return out;
    for (let i = 0; i < ids.length; i += 50) {
      const body = await this.api<{ items?: { id: string; snippet?: { publishedAt?: string } }[] }>('videos', { part: 'snippet', id: ids.slice(i, i + 50).join(','), maxResults: '50' });
      for (const v of body.items ?? []) if (v.snippet?.publishedAt) out.set(v.id, v.snippet.publishedAt);
    }
    return out;
  }

  /** A channel's id from its handle, id or address: the Data API with the key, else the channel's own page. */
  async channelId(handle: string): Promise<string | null> {
    const ref = channelRef(handle);
    if (!ref) return null;
    if ('id' in ref) return ref.id;
    if (this.key()) {
      const body = await this.api<{ items?: { id: string }[] }>('channels', { part: 'id', forHandle: `@${ref.handle}` });
      return body.items?.[0]?.id ?? null;
    }
    const res = await this.get(`https://www.youtube.com/@${encodeURIComponent(ref.handle)}`);
    if (!res.ok) return null;
    return (await res.text()).match(/"externalId":"(UC[A-Za-z0-9_-]{22})"/)?.[1] ?? null;
  }

  /** A page of a channel's uploads, newest first (the Data API: 1 unit for 50 videos). */
  async uploads(channelId: string, pageToken?: string): Promise<{ videos: ListedVideo[]; next: string | null }> {
    const body = await this.api<{ items?: { snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } } }[]; nextPageToken?: string }>('playlistItems', {
      part: 'snippet',
      playlistId: `UU${channelId.slice(2)}`,
      maxResults: '50',
      ...(pageToken ? { pageToken } : {}),
    });
    const videos = (body.items ?? []).flatMap((i) => (i.snippet?.resourceId?.videoId && i.snippet.title ? [{ videoId: i.snippet.resourceId.videoId, title: i.snippet.title, publishedAt: i.snippet.publishedAt ?? null }] : []));
    return { videos, next: body.nextPageToken ?? null };
  }

  /** A channel's newest uploads from its public feed (no key); none when YouTube doesn't serve it. */
  async feed(channelId: string): Promise<ListedVideo[]> {
    const res = await this.get(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
    if (!res.ok) return [];
    const xml = await res.text();
    const out: ListedVideo[] = [];
    for (const entry of xml.split('<entry>').slice(1)) {
      const id = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1];
      const title = entry.match(/<title>([^<]+)<\/title>/)?.[1];
      if (id && title) out.push({ videoId: id, title: title.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"'), publishedAt: entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? null });
    }
    return out;
  }
}

export class VideosService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly catalogs: CatalogService,
    private readonly igdb: IgdbService,
    private readonly youtube: YouTubeClient,
    private readonly thumbsDir: string,
    private readonly log: Logger,
  ) {}

  enabled(): boolean {
    return this.settings.get('features.history') && this.settings.get('roots.videos');
  }

  /** The keys a game's videos are kept under: its title and its catalog game's names, normalized. */
  private keysOf(platformKey: string, title: string): string[] {
    const target = catalogTarget(this.catalogs, platformKey, title)?.target;
    return [...new Set([title, target?.title, ...(target?.altTitles ?? [])].filter((x): x is string => Boolean(x)).map(normalizeTitle).filter(Boolean))];
  }

  private lookup(key: string): { value: unknown; at: string } | null {
    const row = this.db.select().from(videoLookups).where(eq(videoLookups.key, key)).get();
    return row ? { value: row.value ? (JSON.parse(row.value) as unknown) : null, at: row.at } : null;
  }

  private remember(key: string, value: unknown): void {
    const at = new Date().toISOString();
    const json = value === undefined || value === null ? null : JSON.stringify(value);
    this.db.insert(videoLookups).values({ key, value: json, at }).onConflictDoUpdate({ target: videoLookups.key, set: { value: json, at } }).run();
  }

  /** IGDB's videos for a game (its trailers), asked once a month at most. */
  private async igdbVideos(platformKey: string, title: string, key: string): Promise<void> {
    const game = this.igdb.findByKey(platformKey, title);
    if (!game || !this.igdb.client.configured()) return;
    const asked = this.lookup(`igdb:${game.id}`);
    if (asked && Date.now() - Date.parse(asked.at) < KEEP_DAYS * DAY) return;
    try {
      const rows = await this.igdb.client.query<{ name?: string; video_id?: string }>('game_videos', `fields name, video_id; where game = ${game.id}; limit 20;`);
      const now = new Date().toISOString();
      for (const r of rows) {
        const id = r.video_id ? youtubeVideoId(r.video_id) : null;
        if (!id) continue;
        const name = r.name?.trim() || 'Trailer';
        this.db
          .insert(gameVideos)
          .values({ titleKey: key, videoId: id, title: `${game.name}: ${name}`, channel: null, publishedAt: null, source: 'igdb', era: null, kind: videoKind(name) ?? 'trailer', seenAt: now })
          .onConflictDoNothing()
          .run();
      }
      this.remember(`igdb:${game.id}`, null);
    } catch (err) {
      this.log.debug({ context: 'videos', err }, `No IGDB videos for ${title}`);
    }
  }

  /** A game's videos for its page: At the time (before it came out and its first months), and Looking back. */
  async forGame(platformKey: string, title: string): Promise<GameVideosView> {
    if (!this.enabled()) return { status: 'off', time: [], later: [], keyed: false };
    const keys = this.keysOf(platformKey, title);
    if (keys.length === 0) return { status: 'ready', time: [], later: [], keyed: Boolean(this.youtube.key()) };
    await this.igdbVideos(platformKey, title, keys[0]!);
    const archives = new Set(parseVideoChannels(this.settings.get('roots.videoChannels')).filter((c) => c.archive).map((c) => c.name));
    const released = this.igdb.findByKey(platformKey, title)?.released ?? null;
    const months = this.settings.get('roots.atTimeMonths');
    const time: GameVideo[] = [];
    const later: GameVideo[] = [];
    const seen = new Set<string>();
    const rows = this.db.select().from(gameVideos).where(inArray(gameVideos.titleKey, keys)).all();
    rows.sort((a, b) => (a.publishedAt ?? '9999').localeCompare(b.publishedAt ?? '9999'));
    for (const r of rows) {
      if (seen.has(r.videoId)) continue;
      seen.add(r.videoId);
      const video: GameVideo = { videoId: r.videoId, title: r.title, channel: r.channel, publishedAt: r.publishedAt, source: r.source as GameVideo['source'], kind: r.kind };
      // The owner's say for a pasted one; a trailer and an archive's video are of their time; else by its date.
      const era = r.era ?? (r.source === 'igdb' || (r.channel && archives.has(r.channel)) ? 'time' : (videoEra(r.publishedAt, released, months) ?? 'later'));
      (era === 'time' ? time : later).push(video);
    }
    return { status: 'ready', time, later, keyed: Boolean(this.youtube.key()) };
  }

  /** A video pasted onto a game (its address or id): named by YouTube's oEmbed, dated with the key. */
  async paste(platformKey: string, title: string, address: string, era: 'time' | 'later' | null): Promise<GameVideo> {
    const id = youtubeVideoId(address);
    if (!id) throw new YouTubeError("That isn't a YouTube video's address.");
    const keys = this.keysOf(platformKey, title);
    if (keys.length === 0) throw new YouTubeError('No such game.');
    const named = await this.youtube.oembed(id);
    if (!named) throw new YouTubeError("YouTube doesn't know that video (or it's private).");
    const published = this.youtube.key() ? ((await this.youtube.published([id]).catch(() => new Map<string, string>())).get(id) ?? null) : null;
    const now = new Date().toISOString();
    const values = { titleKey: keys[0]!, videoId: id, title: named.title, channel: named.author, publishedAt: published, source: 'pasted', era, kind: videoKind(named.title), seenAt: now };
    this.db
      .insert(gameVideos)
      .values(values)
      .onConflictDoUpdate({ target: [gameVideos.titleKey, gameVideos.videoId], set: { title: values.title, channel: values.channel, era, source: 'pasted', seenAt: now, ...(published ? { publishedAt: published } : {}) } })
      .run();
    return { videoId: id, title: named.title, channel: named.author, publishedAt: published, source: 'pasted', kind: values.kind };
  }

  /** A video taken off a game (whatever brought it). */
  remove(platformKey: string, title: string, videoId: string): boolean {
    const keys = this.keysOf(platformKey, title);
    return keys.length > 0 && this.db.delete(gameVideos).where(and(inArray(gameVideos.titleKey, keys), eq(gameVideos.videoId, videoId))).run().changes > 0;
  }

  /**
   * Reads the video channels (the task): with the key, a channel's whole list once and again every 30 days, and its
   * newest pages each night until a video already seen; without one, its public feed. Videos about the consoles'
   * games are kept, by the title they name; the rest are not.
   */
  async readChannels(progress?: (text: string) => void): Promise<string> {
    if (!this.enabled()) return 'Videos are off (Settings > Roots).';
    const channels = parseVideoChannels(this.settings.get('roots.videoChannels')).filter((c) => c.on);
    if (channels.length === 0) return 'No video channel is on (Settings > Roots > Video channels).';
    const titles: string[] = [];
    for (const p of this.catalogs.allMatches()) for (const t of p.match.targets) titles.push(t.target.title, ...(t.target.altTitles ?? []));
    const index = videoTitleIndex(titles);
    const keyed = Boolean(this.youtube.key());
    const said: string[] = [];
    for (const [i, channel] of channels.entries()) {
      progress?.(`${channel.name} (${i + 1} of ${channels.length})`);
      try {
        said.push(await this.readChannel(channel, index, keyed));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.log.warn({ context: 'videos' }, `Reading ${channel.name}'s videos failed: ${message}`);
        said.push(`${channel.name}: ${message}`);
      }
    }
    // Without the key, what came from the API isn't refreshed: as YouTube asks, it goes after 30 days.
    if (!keyed) {
      const cutoff = new Date(Date.now() - KEEP_DAYS * DAY).toISOString();
      this.db.delete(gameVideos).where(and(eq(gameVideos.source, 'channel'), lt(gameVideos.seenAt, cutoff))).run();
    }
    return said.join('; ');
  }

  private async readChannel(channel: VideoChannel, index: ReturnType<typeof videoTitleIndex>, keyed: boolean): Promise<string> {
    const lookupKey = `channel:${channel.handle.toLowerCase()}`;
    const known = this.lookup(lookupKey)?.value as { id?: string; fullAt?: string } | null;
    const id = known?.id ?? (await this.youtube.channelId(channel.handle));
    if (!id) return `${channel.name}: YouTube didn't find the channel ${channel.handle}`;
    const start = new Date().toISOString();
    let read = 0;
    let kept = 0;
    const keep = (v: ListedVideo) => {
      read++;
      const game = gameInVideoTitle(v.title, index);
      if (!game) return false;
      kept++;
      this.db
        .insert(gameVideos)
        .values({ titleKey: normalizeTitle(game), videoId: v.videoId, title: v.title, channel: channel.name, publishedAt: v.publishedAt, source: 'channel', era: null, kind: videoKind(v.title), seenAt: start })
        .onConflictDoUpdate({ target: [gameVideos.titleKey, gameVideos.videoId], set: { title: v.title, publishedAt: v.publishedAt, seenAt: start } })
        .run();
      return true;
    };
    if (!keyed) {
      const feed = await this.youtube.feed(id);
      for (const v of feed) keep(v);
      this.remember(lookupKey, { ...known, id });
      return feed.length > 0 ? `${channel.name}: ${read} new videos read, ${kept} about your games` : `${channel.name}: its feed had nothing (YouTube's feeds come and go; a YouTube key reads the whole channel)`;
    }
    // The whole list every 30 days (a refresh, as YouTube asks); else the newest pages until a video seen before.
    const full = !known?.fullAt || Date.now() - Date.parse(known.fullAt) > KEEP_DAYS * DAY;
    const seen = new Set(full ? [] : this.db.select({ videoId: gameVideos.videoId }).from(gameVideos).where(eq(gameVideos.channel, channel.name)).all().map((r) => r.videoId));
    let token: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await this.youtube.uploads(id, token);
      pages++;
      let old = false;
      for (const v of page.videos) {
        if (seen.has(v.videoId)) old = true;
        keep(v);
      }
      if (!page.next || (!full && (old || pages >= 4)) || pages >= 4000) break;
      token = page.next;
    }
    if (full) {
      // Gone from the channel (or no longer about a game): dropped.
      this.db.delete(gameVideos).where(and(eq(gameVideos.source, 'channel'), eq(gameVideos.channel, channel.name), lt(gameVideos.seenAt, start))).run();
    }
    this.remember(lookupKey, { id, fullAt: full ? start : known?.fullAt });
    return `${channel.name}: ${read} videos read${full ? ' (the whole channel)' : ''}, ${kept} about your games`;
  }

  /** A video's thumbnail, kept on the server so the page doesn't ask YouTube for it. */
  async thumbnail(videoId: string): Promise<Buffer | null> {
    if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
    const file = join(this.thumbsDir, `${videoId}.jpg`);
    if (existsSync(file)) return readFileSync(file);
    const res = await fetch(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) return null;
    const data = Buffer.from(await res.arrayBuffer());
    mkdirSync(this.thumbsDir, { recursive: true });
    writeFileSync(file, data);
    return data;
  }
}

/** Roots' videos: GET /api/v1/game/videos, POST and DELETE for pasted ones, a thumbnail. */
export function registerVideoRoutes(app: FastifyInstance, videos: VideosService): void {
  app.get('/api/v1/game/videos', async (request, reply) => {
    const { platform, title } = request.query as { platform?: string; title?: string };
    if (!platform || !title) return reply.code(400).send({ error: 'invalid', message: 'Give a platform key and a title.' });
    return videos.forGame(platform, title);
  });
  app.post('/api/v1/game/videos', async (request, reply) => {
    const b = request.body as { platform?: unknown; title?: unknown; url?: unknown; era?: unknown } | null;
    if (typeof b?.platform !== 'string' || typeof b.title !== 'string' || typeof b.url !== 'string') {
      return reply.code(400).send({ error: 'invalid', message: "Send the game's platform key and title, and the video's address." });
    }
    if (!videos.enabled()) return reply.code(404).send({ error: 'feature-off', message: 'Videos are off (Settings > Roots).' });
    try {
      return await videos.paste(b.platform, b.title, b.url, b.era === 'time' || b.era === 'later' ? b.era : null);
    } catch (err) {
      if (err instanceof YouTubeError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });
  app.delete('/api/v1/game/videos', async (request) => {
    const q = request.query as { platform?: string; title?: string; video?: string };
    return { removed: q.platform && q.title && q.video ? videos.remove(q.platform, q.title, q.video) : false };
  });
  app.get('/api/v1/videos/thumb/:id', async (request, reply) => {
    const data = await videos.thumbnail((request.params as { id: string }).id);
    if (!data) return reply.code(404).send({ error: 'not-found', message: 'No such video.' });
    return reply.header('content-type', 'image/jpeg').header('cache-control', 'private, max-age=2592000').send(data);
  });
}
