import {
  forPlatform,
  mapPlatforms,
  oneGame,
  pickRom,
  regionalConsole,
  regionOrder,
  romShortTitleKey,
  romTitleKeys,
  rommOverrides,
  titleMatchKeys,
  type RommPlatform,
  type RommPlatformMatch,
  type RommRom,
} from '@squirrelcade/core';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { appState, platforms, rommPlatforms, rommRoms } from './db/schema.js';
import type { FetchLike } from './igdb.js';
import type { SettingsService } from './settings.js';
import type { TaskRunner } from './tasks.js';

/** RomM couldn't be read, with a message to show the user. */
export class RommError extends Error {}

/** ROMs per request when reading RomM's list; its limit is 10,000, and each ROM comes with all its details. */
const PAGE = 1000;

interface ApiPlatform {
  id: number;
  slug: string;
  name: string;
  display_name?: string;
  custom_name?: string | null;
  igdb_id?: number | null;
}

interface ApiRom {
  id: number;
  platform_id: number;
  igdb_id: number | null;
  name: string | null;
  fs_name: string;
  regions?: string[];
  tags?: string[];
  missing_from_fs?: boolean;
}

interface ApiPage {
  items: ApiRom[];
  rom_id_index?: number[];
}

/** RomM's API, read-only, with the user's Client API token. */
export class RommClient {
  constructor(
    private readonly settings: SettingsService,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  /** RomM is on (Settings > Features) with an address and a token. */
  configured(): boolean {
    return this.settings.get('features.romm') && Boolean(this.base() && this.settings.get('sources.rommToken').trim());
  }

  private base(): string {
    return this.settings.get('sources.rommUrl').trim().replace(/\/+$/, '');
  }

  private async get<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base()}${path}`, {
        headers: { Authorization: `Bearer ${this.settings.get('sources.rommToken').trim()}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new RommError(`Couldn't reach RomM at ${this.base()}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 401 || res.status === 403) throw new RommError('RomM did not accept the API token. It needs the scopes roms.read and platforms.read.');
    if (!res.ok) throw new RommError(`RomM answered ${res.status}.`);
    return (await res.json()) as T;
  }

  async platforms(): Promise<RommPlatform[]> {
    const rows = await this.get<ApiPlatform[]>('/api/platforms');
    return rows.map((p) => ({ id: p.id, slug: p.slug, name: p.custom_name || p.display_name || p.name, igdbId: p.igdb_id ?? null }));
  }

  /** Every ROM on a RomM platform that is still on disk, a page at a time. */
  async roms(platformId: number): Promise<Omit<RommRom, 'playable'>[]> {
    const out: Omit<RommRom, 'playable'>[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await this.get<ApiPage>(
        `/api/roms?platform_ids=${platformId}&limit=${PAGE}&offset=${offset}&order_by=id&order_dir=asc&with_total=false&with_rom_id_index=false&with_char_index=false&with_filter_values=false`,
      );
      for (const r of page.items) {
        if (r.missing_from_fs) continue;
        out.push({ id: r.id, platformId: r.platform_id, igdbId: r.igdb_id ?? null, name: r.name || r.fs_name, fsName: r.fs_name, regions: r.regions ?? [], tags: r.tags ?? [] });
      }
      if (page.items.length < PAGE) return out;
    }
  }

  /** The ids of a platform's ROMs RomM can run in the browser, from the id index RomM sends with a page. */
  async playableIds(platformId: number): Promise<Set<number>> {
    const page = await this.get<ApiPage>(`/api/roms?platform_ids=${platformId}&playable=true&limit=1&with_total=false&with_rom_id_index=true&with_char_index=false&with_filter_values=false`);
    return new Set(page.rom_id_index ?? page.items.map((r) => r.id));
  }
}

/** A link to a game in RomM, for the pages. */
export interface RommLink {
  romId: number;
  name: string;
  /** RomM's page for the ROM. */
  url: string;
  /** Plays the ROM in the browser; null when RomM can't. */
  playUrl: string | null;
  /** Matched by title only: IGDB doesn't confirm it's the same game. */
  possible: boolean;
}

/** How the RomM index stands, for Settings > Sources. */
export interface RommStatus {
  configured: boolean;
  syncedAt: string | null;
  error: string | null;
  roms: number;
  platforms: { key: string; name: string; romm: { slug: string; name: string }[]; via: RommPlatformMatch['via'] | null; roms: number }[];
}

interface SyncState {
  syncedAt: string | null;
  error: string | null;
}

interface Index {
  mapping: Map<string, RommPlatformMatch>;
  order: string[];
  byIgdb: Map<string, RommRom[]>;
  byTitle: Map<string, RommRom[]>;
  /** By the file name's title without its subtitle (see romShortTitleKey). */
  byShortTitle: Map<string, RommRom[]>;
}

/**
 * Squirrelcade's index of the user's RomM: which RomM platforms Squirrelcade's platforms are, and their
 * ROMs, read nightly and on demand. Pages link owned games to RomM from this index, never waiting
 * on RomM; when RomM can't be read, the last index stays.
 */
export class RommService {
  private index: Index | null = null;

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    readonly client: RommClient,
    private readonly log: Logger,
  ) {}

  /** Links are on: RomM is on (Settings > Features), its address is set and the index has been read at least once. */
  enabled(): boolean {
    return this.settings.get('features.romm') && Boolean(this.settings.get('sources.rommUrl').trim()) && this.load().byTitle.size > 0;
  }

  /** Forgets the in-memory index, after a sync or a change to the settings it depends on. */
  invalidate(): void {
    this.index = null;
  }

  private state(): SyncState {
    const row = this.db.select().from(appState).where(eq(appState.key, 'romm.sync')).get();
    return row ? (JSON.parse(row.value) as SyncState) : { syncedAt: null, error: null };
  }

  private setState(state: SyncState): void {
    const value = JSON.stringify(state);
    this.db.insert(appState).values({ key: 'romm.sync', value }).onConflictDoUpdate({ target: appState.key, set: { value } }).run();
  }

  /** Squirrelcade's platforms, with the IGDB platform numbers from Settings > Sources (another region's own console falls back to its base console's). */
  private ownPlatforms() {
    const ids = this.settings.get('sources.igdbPlatformIds');
    const extra = this.settings.get('sources.igdbExtraPlatformIds');
    return this.db
      .select({ key: platforms.key, name: platforms.name })
      .from(platforms)
      .all()
      .map((p) => ({ ...p, igdbId: forPlatform(ids, p.key) ?? null, extraIgdbId: forPlatform(extra, p.key) ?? null }));
  }

  /** ROM regions in the order they are preferred on a platform: another region's own console (the Super Famicom) prefers its region's ROMs. */
  private orderFor(platformKey: string, order: string[]): string[] {
    const region = regionalConsole(platformKey)?.region;
    if (!region) return order;
    const first = regionOrder(region)[0]!;
    return [first, ...order.filter((r) => r !== first)];
  }

  private mapping(romm: RommPlatform[]): Map<string, RommPlatformMatch> {
    return mapPlatforms(this.ownPlatforms(), romm, rommOverrides(this.settings.get('sources.rommPlatforms')));
  }

  private storedPlatforms(): RommPlatform[] {
    return this.db
      .select()
      .from(rommPlatforms)
      .all()
      .map((p) => ({ id: p.id, slug: p.slug, name: p.name, igdbId: p.igdbId }));
  }

  private load(): Index {
    if (this.index) return this.index;
    const mapping = this.mapping(this.storedPlatforms());
    const byIgdb = new Map<string, RommRom[]>();
    const byTitle = new Map<string, RommRom[]>();
    const byShortTitle = new Map<string, RommRom[]>();
    const add = (map: Map<string, RommRom[]>, key: string, rom: RommRom) => {
      const list = map.get(key);
      if (list) list.push(rom);
      else map.set(key, [rom]);
    };
    for (const r of this.db.select().from(rommRoms).all()) {
      const rom: RommRom = { ...r, regions: JSON.parse(r.regions) as string[], tags: JSON.parse(r.tags) as string[] };
      if (rom.igdbId !== null) add(byIgdb, `${rom.platformId}|${rom.igdbId}`, rom);
      for (const k of romTitleKeys(rom)) add(byTitle, `${rom.platformId}|${k}`, rom);
      const short = romShortTitleKey(rom);
      if (short) add(byShortTitle, `${rom.platformId}|${short}`, rom);
    }
    const order = regionOrder(this.settings.get('general.homeRegion'), this.settings.get('sources.rommRegions'));
    this.index = { mapping, order, byIgdb, byTitle, byShortTitle };
    return this.index;
  }

  /**
   * The RomM ROM for a game on a Squirrelcade platform: the same IGDB game on the platform's RomM
   * platforms (the same IGDB game on another platform doesn't count), or failing that the same
   * title (or, when that finds one game, the title of a file name without its subtitle), marked
   * as a possible match. Null when there's no match, RomM isn't set up or not read yet.
   */
  link(platformKey: string, igdbId: number | null | undefined, titles: readonly string[]): RommLink | null {
    if (!this.settings.get('features.romm') || !this.settings.get('sources.rommUrl').trim()) return null;
    const index = this.load();
    const mapped = index.mapping.get(platformKey);
    if (!mapped) return null;
    const ids = mapped.platforms.map((p) => p.id);
    let rom: RommRom | null = null;
    let possible = false;
    const order = this.orderFor(platformKey, index.order);
    if (igdbId) rom = pickRom(ids.flatMap((id) => index.byIgdb.get(`${id}|${igdbId}`) ?? []), order);
    if (!rom) {
      const keys = titleMatchKeys(titles);
      const found = new Map<number, RommRom>();
      for (const id of ids) for (const k of keys) for (const r of index.byTitle.get(`${id}|${k}`) ?? []) found.set(r.id, r);
      // Failing that, the title may leave out the file name's subtitle: linked only when that finds one game.
      if (found.size === 0) {
        for (const id of ids) for (const k of keys) for (const r of index.byShortTitle.get(`${id}|${k}`) ?? []) found.set(r.id, r);
        if (!oneGame([...found.values()])) found.clear();
      }
      rom = pickRom([...found.values()], order);
      possible = rom !== null;
    }
    if (!rom) return null;
    const base = (this.settings.get('sources.rommPublicUrl').trim() || this.settings.get('sources.rommUrl').trim()).replace(/\/+$/, '');
    return { romId: rom.id, name: rom.name, url: `${base}/rom/${rom.id}`, playUrl: rom.playable ? `${base}/rom/${rom.id}/ejs` : null, possible };
  }

  /**
   * Reads RomM's platforms and the ROMs of the ones Squirrelcade's platforms map to, and replaces the
   * index with them. A platform that fails keeps its last ROMs; when RomM can't be reached at all,
   * the whole index stays and the task fails with the reason.
   */
  async sync(progress?: (text: string) => void): Promise<string> {
    if (!this.client.configured()) return 'RomM is not set up (Settings > Sources).';
    let romm: RommPlatform[];
    try {
      romm = await this.client.platforms();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ ...this.state(), error: message });
      throw err;
    }
    const mapping = this.mapping(romm);
    const wanted = [...new Map([...mapping.values()].flatMap((m) => m.platforms).map((p) => [p.id, p])).values()];
    const read = new Map<number, RommRom[]>();
    const failed: string[] = [];
    for (const [i, p] of wanted.entries()) {
      progress?.(`${p.name} (${i + 1} of ${wanted.length})`);
      try {
        const roms = await this.client.roms(p.id);
        const playable = await this.client.playableIds(p.id);
        read.set(
          p.id,
          roms.map((r) => ({ ...r, playable: playable.has(r.id) })),
        );
      } catch (err) {
        failed.push(`${p.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.db.transaction((tx) => {
      tx.delete(rommPlatforms).run();
      for (const p of romm) tx.insert(rommPlatforms).values({ id: p.id, slug: p.slug, name: p.name, igdbId: p.igdbId, romCount: 0 }).run();
      // Platforms read now replace their ROMs; ones that failed keep theirs; ones no longer mapped go.
      const keep = wanted.map((p) => p.id).filter((id) => !read.has(id));
      const stale = tx.selectDistinct({ platformId: rommRoms.platformId }).from(rommRoms).all().map((r) => r.platformId).filter((id) => !keep.includes(id));
      if (stale.length > 0) tx.delete(rommRoms).where(inArray(rommRoms.platformId, stale)).run();
      for (const roms of read.values()) {
        for (let i = 0; i < roms.length; i += 500) {
          tx.insert(rommRoms)
            .values(roms.slice(i, i + 500).map((r) => ({ ...r, regions: JSON.stringify(r.regions), tags: JSON.stringify(r.tags) })))
            .run();
        }
      }
      // What the index holds per platform, kept ROMs included.
      tx.run(sql`update romm_platforms set rom_count = (select count(*) from romm_roms where romm_roms.platform_id = romm_platforms.id)`);
    });
    this.invalidate();
    const total = [...read.values()].reduce((sum, r) => sum + r.length, 0);
    this.setState({ syncedAt: new Date().toISOString(), error: failed.length > 0 ? failed.join('; ') : null });
    this.log.info({ context: 'romm' }, `RomM index: ${total} ROMs on ${read.size} platforms${failed.length > 0 ? `; failed: ${failed.join('; ')}` : ''}`);
    if (read.size === 0 && failed.length > 0) throw new RommError(`No RomM platform could be read: ${failed.join('; ')}`);
    return `${total} ROMs on ${read.size} RomM platforms${failed.length > 0 ? `. Failed: ${failed.join('; ')}` : ''}`;
  }

  status(): RommStatus {
    const state = this.state();
    const index = this.load();
    const counts = new Map(this.db.select({ id: rommPlatforms.id, n: rommPlatforms.romCount }).from(rommPlatforms).all().map((p) => [p.id, p.n]));
    const roms = this.db.select({ id: rommRoms.id }).from(rommRoms).all().length;
    return {
      configured: this.client.configured(),
      syncedAt: state.syncedAt,
      error: state.error,
      roms,
      platforms: this.ownPlatforms()
        .map((p) => {
          const m = index.mapping.get(p.key);
          return {
            key: p.key,
            name: p.name,
            romm: (m?.platforms ?? []).map((r) => ({ slug: r.slug, name: r.name })),
            via: m?.via ?? null,
            roms: (m?.platforms ?? []).reduce((sum, r) => sum + (counts.get(r.id) ?? 0), 0),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }
}

/** RomM: the index's status, the connection test, and updating the index now. */
export function registerRommRoutes(app: FastifyInstance, romm: RommService, tasks: TaskRunner, ownedMatches: () => { matched: number; possible: number; owned: number }): void {
  app.get('/api/v1/sources/romm', async () => ({ ...romm.status(), owned: romm.enabled() ? ownedMatches() : null }));

  app.post('/api/v1/sources/romm/test', async (_request, reply) => {
    if (!romm.client.configured()) return reply.code(400).send({ error: 'not-configured', message: "Add RomM's address and an API token first (and save them)." });
    try {
      const found = await romm.client.platforms();
      return { ok: true, message: `Connected to RomM: ${found.length} platforms.` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  });

  app.post('/api/v1/sources/romm/sync', async (_request, reply) => {
    if (!tasks.enqueue('romm-sync')) return reply.code(404).send({ error: 'not-found', message: 'No RomM task.' });
    return reply.code(202).send({ queued: true });
  });
}
