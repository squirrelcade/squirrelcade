import {
  normalizeTitle,
  parsePcAudit,
  searchRank,
  parsePlayniteSnapshot,
  pcFamilyKey,
  pcOwnership,
  PC_OWNERSHIP_LABELS,
  playtimeHours,
  SnapshotError,
  toCsv,
  storefrontOwnership,
  type PcAuditEntry,
  type PcOwnership,
  type PlayniteSnapshot,
} from '@squirrelcade/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { sees } from './access.js';
import type { Db } from './db/index.js';
import { copies, pcAudit, pcGames, pcReads, platforms } from './db/schema.js';
import { envVar, type Env } from './env.js';
import type { SettingsService } from './settings.js';
import type { TaskRunner } from './tasks.js';

/** A Steam game's achievements (0.28.0), from Steam achievements when they're on. */
export interface PcAchievements {
  earned: number;
  total: number;
  progress: number;
  completed: boolean;
  lastPlayedAt: string | null;
}

/** A PC game in one storefront, with how it counts. */
export interface PcRecord {
  recordKey: string;
  storefront: string;
  storefrontGameId: string;
  name: string;
  familyKey: string;
  ownership: PcOwnership;
  /** The owner's audit decided the ownership (not the storefront's default). */
  audited: boolean;
  platforms: string[];
  genres: string[];
  series: string[];
  completionStatus: string | null;
  releaseYear: number | null;
  addedAt: string | null;
  lastActivityAt: string | null;
  playtimeSeconds: number;
  favorite: boolean;
  hidden: boolean;
  installed: boolean;
  links: { name: string; url: string }[];
  /** A Steam game's achievements (in the list's answer only; null without them). */
  achievements?: PcAchievements | null;
}

/** A game across the storefronts it's in (and the console copies of the same game, for the ownership matrix). */
export interface PcFamily {
  key: string;
  title: string;
  records: PcRecord[];
  /** Owned for good in at least one storefront (not only through a subscription or unverified). */
  owned: boolean;
  playtimeHours: number;
  lastActivityAt: string | null;
  genres: string[];
  series: string[];
  installed: boolean;
  favorite: boolean;
  /** Physical console copies of the same game in the collection. */
  consoles: { platform: string; platformKey: string; title: string; copies: number; sealed: number }[];
}

/** What reading a Playnite backup or snapshot did. */
export interface PcReadOutcome {
  id: number;
  status: 'applied' | 'held' | 'unchanged' | 'failed';
  games: number;
  added: number;
  removed: number;
  message: string;
}

/** The PC library's state for its page and the setup checklist. */
export interface PcStatus {
  folder: string | null;
  /** The Playnite reader is in this installation (the Docker image has it). */
  readerAvailable: boolean;
  newestBackup: { fileName: string; writtenAt: string } | null;
  lastRead: { id: number; readAt: string; fileName: string; backupAt: string | null; status: string; games: number; added: number; removed: number; message: string | null } | null;
  held: { id: number; readAt: string; fileName: string; games: number; message: string | null } | null;
  records: number;
  families: number;
  owned: number;
  byStorefront: { storefront: string; records: number; owned: number; subscription: number; historical: number }[];
  playtimeHours: number;
  installed: number;
  audit: number;
}

const json = <T>(text: string | null, fallback: T): T => (text ? (JSON.parse(text) as T) : fallback);

/**
 * The PC library (phase 5): Playnite's library read from its backups by the Playnite reader, one record
 * per game per storefront. Each reading replaces the library (games gone since stay, inactive), unless it
 * would lose more games than the safety setting allows: then it's held for confirmation. Ownership comes
 * from the storefront's default (Settings > PC library) unless the owner's audit says otherwise.
 */
export class PcService {
  /** Fires when the PC library or how it counts changed (for the wishlist and other pages built on it), and when a reading is held for the owner. */
  readonly events = new EventEmitter<{ changed: []; held: [message: string] }>();
  private cache: { families: PcFamily[]; byKey: Map<string, PcFamily> } | null = null;
  /** Steam's achievements by app id (Steam achievements, 0.28.0), given by the app once both are built. */
  private achievementsOf: (() => Map<string, PcAchievements>) | null = null;

  useAchievements(of: () => Map<string, PcAchievements>): void {
    this.achievementsOf = of;
  }

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly env: Env,
    private readonly log: Logger,
    private readonly readerPath: string | null = envVar('PLAYNITE_READER') ?? null,
  ) {}

  /** Settings > Features > PC library: off, Squirrelcade has no PC games anywhere (the readings stay, unused). */
  enabled(): boolean {
    return this.settings.get('features.pc');
  }

  /** Forgets what was worked out from the library (after a reading, an audit or a settings change). */
  invalidate(): void {
    this.cache = null;
    this.events.emit('changed');
  }

  /** The Playnite backup folder: the setting, or /playnite in Docker; null when there's none. */
  folder(): string | null {
    return this.settings.get('pc.playniteFolder') || (this.env.inDocker ? '/playnite' : null);
  }

  private readerAvailable(): boolean {
    return Boolean(this.readerPath && existsSync(this.readerPath));
  }

  /** The newest backup ZIP in the folder, or null. */
  newestBackup(): { name: string; path: string; writtenAt: Date } | null {
    const folder = this.folder();
    if (!folder || !existsSync(folder)) return null;
    let best: { name: string; path: string; writtenAt: Date } | null = null;
    for (const name of readdirSync(folder)) {
      if (!/\.zip$/i.test(name)) continue;
      const path = join(folder, name);
      const at = statSync(path).mtime;
      if (!best || at > best.writtenAt) best = { name, path, writtenAt: at };
    }
    return best;
  }

  /**
   * Reads the newest Playnite backup with the Playnite reader and applies it, unless it's the backup
   * the last reading had (or `force`). Returns what happened, as the task's message.
   */
  async readBackup(force = false): Promise<string> {
    const folder = this.folder();
    if (!folder) return 'No Playnite backup folder is set (Settings > PC library).';
    if (!existsSync(folder)) throw new Error(`The Playnite backup folder ${folder} doesn't exist (in Docker, mount it at /playnite).`);
    if (!this.readerAvailable()) throw new Error('The Playnite reader is not part of this installation (the Docker image has it); upload a snapshot on the PC library page instead.');
    const newest = this.newestBackup();
    if (!newest) return `No Playnite backup (a .zip file) in ${folder} yet.`;
    const last = this.db.select().from(pcReads).where(eq(pcReads.source, 'backup')).orderBy(desc(pcReads.id)).get();
    if (!force && last && last.fileName === newest.name && last.backupAt === newest.writtenAt.toISOString() && last.status !== 'failed') {
      return `No newer backup than ${newest.name}.`;
    }
    const dir = mkdtempSync(join(tmpdir(), 'squirrelcade-playnite-'));
    const out = join(dir, 'snapshot.json');
    try {
      await new Promise<void>((resolve, reject) => {
        execFile(this.readerPath!, ['--backup-dir', folder, '--output', out], { timeout: 30 * 60_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, _stdout, stderr) => {
          if (!err) return resolve();
          // The reader explains itself on stderr as JSON: { ok: false, error }.
          const said = /"error":"((?:[^"\\]|\\.)*)"/.exec(stderr)?.[1];
          reject(new Error(said ? JSON.parse(`"${said}"`) : err.message));
        });
      });
      const outcome = this.applySnapshot(parsePlayniteSnapshot(readFileSync(out, 'utf8')), 'backup', { backupAt: newest.writtenAt.toISOString() });
      return outcome.message;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.db
        .insert(pcReads)
        .values({ readAt: new Date().toISOString(), source: 'backup', fileName: newest.name, backupAt: newest.writtenAt.toISOString(), fingerprint: '', games: 0, storefronts: '{}', status: 'failed', message })
        .run();
      throw err;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * Applies a reading: every record is kept (new ones added, changed ones updated, games no longer in
   * Playnite marked inactive). One that would lose more than the safety setting's share of the games is
   * held instead, until confirmed.
   */
  applySnapshot(snapshot: PlayniteSnapshot, source: 'backup' | 'upload', options: { backupAt?: string; confirmed?: boolean } = {}): PcReadOutcome {
    const now = new Date().toISOString();
    const before = new Set(this.db.select({ key: pcGames.recordKey }).from(pcGames).where(eq(pcGames.active, true)).all().map((r) => r.key));
    const incoming = new Set(snapshot.records.map((r) => r.recordKey));
    const removed = [...before].filter((k) => !incoming.has(k)).length;
    const added = [...incoming].filter((k) => !before.has(k)).length;
    const base = {
      readAt: now,
      source,
      fileName: snapshot.source.fileName,
      backupAt: options.backupAt ?? snapshot.source.lastWriteUtc ?? null,
      fingerprint: snapshot.source.fingerprint,
      games: snapshot.records.length,
      storefronts: JSON.stringify(snapshot.statistics.bySource),
      added,
      removed,
    };
    const maxDrop = this.settings.get('pc.maxDropPercent');
    if (!options.confirmed && before.size > 0 && (removed / before.size) * 100 > maxDrop) {
      const message = `Held: this reading would take ${removed} of your ${before.size} PC games away (more than ${maxDrop}%). Confirm it on the PC library page if that's right.`;
      const row = this.db.insert(pcReads).values({ ...base, status: 'held', message, snapshot: JSON.stringify(snapshot) }).returning({ id: pcReads.id }).get();
      this.log.warn({ context: 'pc' }, message);
      this.events.emit('held', message);
      return { id: row.id, status: 'held', games: snapshot.records.length, added, removed, message };
    }
    const id = this.db.transaction((tx) => {
      tx.update(pcGames).set({ active: false }).run();
      for (const r of snapshot.records) {
        const values = {
          playniteId: r.playniteId,
          storefront: r.sourceName ?? 'Unclassified',
          storefrontGameId: r.storefrontGameId,
          name: r.name,
          familyKey: pcFamilyKey(r.name),
          platforms: JSON.stringify(r.platforms),
          genres: JSON.stringify(r.genres),
          series: JSON.stringify(r.series),
          completionStatus: r.completionStatus ?? null,
          releaseYear: r.releaseYear ?? null,
          addedAt: r.addedUtc ?? null,
          lastActivityAt: r.lastActivityUtc ?? null,
          playtimeSeconds: Math.round(r.playtimeSeconds),
          playCount: Math.round(r.playCount),
          favorite: r.favorite,
          hidden: r.hidden,
          installed: r.installed,
          criticScore: r.criticScore == null ? null : Math.round(r.criticScore),
          communityScore: r.communityScore == null ? null : Math.round(r.communityScore),
          links: JSON.stringify(r.links),
          lastSeenAt: now,
          active: true,
        };
        tx.insert(pcGames)
          .values({ recordKey: r.recordKey, firstSeenAt: now, ...values })
          .onConflictDoUpdate({ target: pcGames.recordKey, set: values })
          .run();
      }
      const message = `Read ${snapshot.source.fileName}: ${snapshot.records.length} PC games, ${added} new, ${removed} gone.`;
      return tx.insert(pcReads).values({ ...base, status: 'applied', message }).returning({ id: pcReads.id }).get().id;
    });
    this.log.info({ context: 'pc' }, `PC library from ${snapshot.source.fileName}: ${snapshot.records.length} games (${added} new, ${removed} gone)`);
    this.invalidate();
    return { id, status: 'applied', games: snapshot.records.length, added, removed, message: `Read ${snapshot.source.fileName}: ${snapshot.records.length} PC games, ${added} new, ${removed} gone.` };
  }

  /** Applies a held reading (the owner confirmed it); null when there's no such held reading. */
  confirm(id: number): PcReadOutcome | null {
    const row = this.db.select().from(pcReads).where(and(eq(pcReads.id, id), eq(pcReads.status, 'held'))).get();
    if (!row?.snapshot) return null;
    const outcome = this.applySnapshot(JSON.parse(row.snapshot) as PlayniteSnapshot, row.source as 'backup' | 'upload', { backupAt: row.backupAt ?? undefined, confirmed: true });
    this.db.update(pcReads).set({ status: 'confirmed', snapshot: null }).where(eq(pcReads.id, id)).run();
    return outcome;
  }

  /** Throws a held reading away; false when there's no such held reading. */
  discard(id: number): boolean {
    return this.db.update(pcReads).set({ status: 'discarded', snapshot: null }).where(and(eq(pcReads.id, id), eq(pcReads.status, 'held'))).run().changes > 0;
  }

  private auditEntries(): PcAuditEntry[] {
    return this.db
      .select()
      .from(pcAudit)
      .all()
      // The owner's own answers on a game come before the audit file's.
      .sort((a, b) => (a.source === b.source ? 0 : a.source === 'user' ? -1 : 1))
      .map((a) => ({ storefront: a.storefront, storefrontGameId: a.storefrontGameId, title: a.title, ownership: a.ownership as PcOwnership, verifiedAt: a.verifiedAt, notes: a.notes }));
  }

  /** The active records with their ownership (hidden games left out when Settings > PC library says so). */
  records(): PcRecord[] {
    const defaults = storefrontOwnership(this.settings.get('pc.storefrontOwnership'));
    const audit = this.auditEntries();
    const includeHidden = this.settings.get('pc.includeHidden');
    return this.db
      .select()
      .from(pcGames)
      .where(eq(pcGames.active, true))
      .all()
      .filter((g) => includeHidden || !g.hidden)
      .map((g) => {
        const { ownership, audited } = pcOwnership({ sourceName: g.storefront, storefrontGameId: g.storefrontGameId, name: g.name }, defaults, audit);
        return {
          recordKey: g.recordKey,
          storefront: g.storefront,
          storefrontGameId: g.storefrontGameId,
          name: g.name,
          familyKey: g.familyKey,
          ownership,
          audited,
          platforms: json<string[]>(g.platforms, []),
          genres: json<string[]>(g.genres, []),
          series: json<string[]>(g.series, []),
          completionStatus: g.completionStatus,
          releaseYear: g.releaseYear,
          addedAt: g.addedAt,
          lastActivityAt: g.lastActivityAt,
          playtimeSeconds: g.playtimeSeconds,
          favorite: g.favorite,
          hidden: g.hidden,
          installed: g.installed,
          links: json<{ name: string; url: string }[]>(g.links, []),
        };
      });
  }

  /** Physical console copies in the current collection by family key: platform, copies and sealed copies. */
  private consoleCopies(): Map<string, { platform: string; platformKey: string; title: string; copies: number; sealed: number }[]> {
    const out = new Map<string, { platform: string; platformKey: string; title: string; copies: number; sealed: number }[]>();
    const rows = this.db
      .select({ title: copies.title, platform: platforms.name, platformKey: platforms.key, quantity: copies.quantity, sealed: copies.sealed })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    for (const r of rows) {
      const key = pcFamilyKey(r.title);
      const list = out.get(key) ?? [];
      let entry = list.find((e) => e.platform === r.platform);
      if (!entry) {
        // The console and title the game drawer opens (the first copy's title on that console).
        entry = { platform: r.platform, platformKey: r.platformKey, title: r.title, copies: 0, sealed: 0 };
        list.push(entry);
      }
      entry.copies += r.quantity;
      if (r.sealed) entry.sealed += r.quantity;
      out.set(key, list);
    }
    return out;
  }

  /** The PC library by game: each family of records across storefronts, with the console copies of the same game. */
  families(): PcFamily[] {
    if (!this.enabled()) return [];
    if (this.cache) return this.cache.families;
    const consoles = this.consoleCopies();
    const byKey = new Map<string, PcFamily>();
    for (const r of this.records()) {
      let f = byKey.get(r.familyKey);
      if (!f) {
        f = { key: r.familyKey, title: r.name, records: [], owned: false, playtimeHours: 0, lastActivityAt: null, genres: [], series: [], installed: false, favorite: false, consoles: consoles.get(r.familyKey) ?? [] };
        byKey.set(r.familyKey, f);
      }
      f.records.push(r);
      f.owned ||= r.ownership === 'permanent';
      f.playtimeHours = playtimeHours(f.records.reduce((n, x) => n + x.playtimeSeconds, 0));
      if (r.lastActivityAt && (!f.lastActivityAt || r.lastActivityAt > f.lastActivityAt)) f.lastActivityAt = r.lastActivityAt;
      f.genres = [...new Set([...f.genres, ...r.genres])];
      f.series = [...new Set([...f.series, ...r.series])];
      f.installed ||= r.installed;
      f.favorite ||= r.favorite;
      // The shortest name is usually the plain title ("Hades", not "Hades: Deluxe Edition").
      if (r.name.length < f.title.length) f.title = r.name;
    }
    const families = [...byKey.values()].sort((a, b) => a.title.localeCompare(b.title));
    this.cache = { families, byKey };
    return families;
  }

  /** The PC family a title belongs to, when the PC library has it (any storefront). */
  familyOf(title: string): PcFamily | undefined {
    if (!this.enabled()) return undefined;
    this.families();
    return this.cache!.byKey.get(pcFamilyKey(title));
  }

  /** The storefronts a title is owned in for good ("Steam", "GOG"), for "owned on PC" notes elsewhere. */
  ownedOnPc(title: string): string[] {
    const f = this.familyOf(title);
    return f ? [...new Set(f.records.filter((r) => r.ownership === 'permanent').map((r) => r.storefront))] : [];
  }

  status(): PcStatus {
    const lastRow = this.db.select().from(pcReads).orderBy(desc(pcReads.id)).get();
    const heldRow = this.db.select().from(pcReads).where(eq(pcReads.status, 'held')).orderBy(desc(pcReads.id)).get();
    const records = this.records();
    const byStore = new Map<string, PcStatus['byStorefront'][number]>();
    for (const r of records) {
      const s = byStore.get(r.storefront) ?? { storefront: r.storefront, records: 0, owned: 0, subscription: 0, historical: 0 };
      s.records++;
      if (r.ownership === 'permanent') s.owned++;
      else s[r.ownership]++;
      byStore.set(r.storefront, s);
    }
    const newest = this.newestBackup();
    return {
      folder: this.folder(),
      readerAvailable: this.readerAvailable(),
      newestBackup: newest ? { fileName: newest.name, writtenAt: newest.writtenAt.toISOString() } : null,
      lastRead: lastRow ? { id: lastRow.id, readAt: lastRow.readAt, fileName: lastRow.fileName, backupAt: lastRow.backupAt, status: lastRow.status, games: lastRow.games, added: lastRow.added, removed: lastRow.removed, message: lastRow.message } : null,
      held: heldRow ? { id: heldRow.id, readAt: heldRow.readAt, fileName: heldRow.fileName, games: heldRow.games, message: heldRow.message } : null,
      records: records.length,
      families: this.families().length,
      owned: this.families().filter((f) => f.owned).length,
      byStorefront: [...byStore.values()].sort((a, b) => b.records - a.records),
      playtimeHours: playtimeHours(records.reduce((n, r) => n + r.playtimeSeconds, 0)),
      installed: records.filter((r) => r.installed).length,
      audit: this.db.select().from(pcAudit).all().length,
    };
  }

  /**
   * What the health check says about the PC library once it's in use (a Playnite folder chosen, or a
   * backup read before): the folder to list on System > Status, and a folder that went empty or a newest
   * backup older than Settings > PC library allows, so the library can't fall behind unnoticed.
   */
  health(): { folder: string | null; problems: { level: 'warning'; message: string }[] } {
    if (!this.enabled()) return { folder: null, problems: [] };
    const folder = this.folder();
    const lastRead = this.db.select({ id: pcReads.id }).from(pcReads).where(eq(pcReads.source, 'backup')).orderBy(desc(pcReads.id)).get();
    if (!folder || (!this.settings.get('pc.playniteFolder') && !lastRead)) return { folder: null, problems: [] };
    if (!existsSync(folder)) return { folder, problems: [] };
    let newest: ReturnType<PcService['newestBackup']>;
    try {
      newest = this.newestBackup();
    } catch {
      // An unreadable folder is reported with the other folders.
      return { folder, problems: [] };
    }
    if (!newest) {
      return {
        folder,
        problems: lastRead ? [{ level: 'warning', message: `The Playnite backup folder ${folder} has no backups any more (is the share still mounted?); the PC library stays as it was last read.` }] : [],
      };
    }
    const staleDays = this.settings.get('pc.staleBackupDays');
    const age = Math.floor((Date.now() - newest.writtenAt.getTime()) / 86_400_000);
    if (staleDays > 0 && age > staleDays) {
      return { folder, problems: [{ level: 'warning', message: `The newest Playnite backup (${newest.name}) is ${age} days old; check Playnite's automatic backups (Playnite > Settings > Backup).` }] };
    }
    return { folder, problems: [] };
  }

  /** The PC library's totals for dashboards (GET /api/v1/stats): games (families), those owned for good, and hours played. */
  stats(): { pcGames: number; pcOwned: number; pcHours: number } {
    const families = this.families();
    return { pcGames: families.length, pcOwned: families.filter((f) => f.owned).length, pcHours: playtimeHours(families.reduce((n, f) => n + f.records.reduce((m, r) => m + r.playtimeSeconds, 0), 0)) };
  }

  /** Readings, newest first. */
  reads(limit = 20) {
    return this.db
      .select({ id: pcReads.id, readAt: pcReads.readAt, source: pcReads.source, fileName: pcReads.fileName, backupAt: pcReads.backupAt, games: pcReads.games, status: pcReads.status, message: pcReads.message, added: pcReads.added, removed: pcReads.removed })
      .from(pcReads)
      .orderBy(desc(pcReads.id))
      .limit(limit)
      .all();
  }

  /** A page of the PC library by game, filtered and sorted. */
  /** The PC library's games, filtered and sorted, a page at a time; `all` gives every match at once (the spreadsheet download). */
  list(query: { q?: string; storefront?: string; ownership?: string; installed?: string; played?: string; view?: string; achievements?: string; sort?: string; dir?: 'asc' | 'desc'; page?: number; pageSize?: number; all?: boolean; noAchievements?: boolean }) {
    const q = query.q ? normalizeTitle(query.q) : '';
    // noAchievements: for a viewer who doesn't see what the owner played (their filter is ignored too).
    const steam = query.noAchievements ? new Map<string, PcAchievements>() : (this.achievementsOf?.() ?? new Map<string, PcAchievements>());
    // Steam's records carry their Steam app id (the storefront is named as Playnite names it: "Steam").
    const achievementsOf = (r: PcRecord) => (r.storefront.toLowerCase() === 'steam' ? (steam.get(r.storefrontGameId) ?? null) : null);
    let rows = this.families().filter((f) => {
      // Steam achievements: games completed on Steam, or with at least one.
      if (!query.noAchievements && query.achievements === 'completed' && !f.records.some((r) => achievementsOf(r)?.completed)) return false;
      if (!query.noAchievements && query.achievements === 'started' && !f.records.some((r) => (achievementsOf(r)?.earned ?? 0) > 0)) return false;
      // A title found as the header's search finds one too: numbers written either way ("Mafia 2" finds "Mafia II").
      const found = (title: string) => normalizeTitle(title).includes(q) || searchRank(title, query.q!) > 0;
      if (q && !found(f.title) && !f.records.some((r) => found(r.name))) return false;
      if (query.storefront && !f.records.some((r) => r.storefront === query.storefront)) return false;
      if (query.ownership && !f.records.some((r) => r.ownership === query.ownership)) return false;
      if (query.installed === 'yes' && !f.installed) return false;
      if (query.played === 'yes' && f.playtimeHours === 0) return false;
      if (query.played === 'no' && f.playtimeHours > 0) return false;
      // The ownership matrix's views: owned on PC and a console, PC only, or a sealed console copy without an owned PC copy.
      if (query.view === 'both' && !(f.owned && f.consoles.length > 0)) return false;
      if (query.view === 'pc-only' && f.consoles.length > 0) return false;
      return true;
    });
    const dir = query.dir === 'desc' ? -1 : 1;
    const by: Record<string, (a: PcFamily, b: PcFamily) => number> = {
      title: (a, b) => a.title.localeCompare(b.title),
      playtime: (a, b) => a.playtimeHours - b.playtimeHours || a.title.localeCompare(b.title),
      played: (a, b) => (a.lastActivityAt ?? '').localeCompare(b.lastActivityAt ?? '') || a.title.localeCompare(b.title),
      storefronts: (a, b) => a.records.length - b.records.length || a.title.localeCompare(b.title),
    };
    rows = [...rows].sort((a, b) => dir * (by[query.sort ?? 'title'] ?? by.title!)(a, b));
    const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 500);
    const page = Math.max(query.page ?? 1, 1);
    const items = (query.all ? rows : rows.slice((page - 1) * pageSize, page * pageSize)).map((f) => ({ ...f, records: f.records.map((r) => ({ ...r, achievements: achievementsOf(r) })) }));
    return { total: rows.length, page, pageSize, items };
  }

  /**
   * Console games owned physically but not on PC, where a copy is sealed: the old system's "sealed
   * physical play copy" (keep the box sealed, play it on PC), for the PC wishlist and the matrix.
   */
  sealedWithoutPc(): { title: string; key: string; consoles: { platform: string; platformKey: string; title: string; copies: number; sealed: number }[] }[] {
    const owned = new Set(this.families().filter((f) => f.owned).map((f) => f.key));
    const out: { title: string; key: string; consoles: { platform: string; platformKey: string; title: string; copies: number; sealed: number }[] }[] = [];
    const titles = new Map<string, string>();
    for (const r of this.db.select({ title: copies.title, sealed: copies.sealed }).from(copies).where(isNull(copies.goneAt)).all()) {
      if (r.sealed) titles.set(pcFamilyKey(r.title), r.title);
    }
    const onConsoles = this.consoleCopies();
    for (const [key, title] of titles) if (!owned.has(key)) out.push({ title, key, consoles: onConsoles.get(key) ?? [] });
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Replaces the audit from a CSV (the owner's answers on single games stay). */
  setAudit(csv: string): { entries: number; problems: string[] } {
    const { entries, problems } = parsePcAudit(csv);
    if (entries.length === 0) return { entries: 0, problems: problems.length > 0 ? problems : ['No audit rows were found.'] };
    this.db.transaction((tx) => {
      tx.delete(pcAudit).where(eq(pcAudit.source, 'list')).run();
      for (const e of entries) tx.insert(pcAudit).values({ storefront: e.storefront, storefrontGameId: e.storefrontGameId ?? null, title: e.title, ownership: e.ownership, verifiedAt: e.verifiedAt ?? null, notes: e.notes ?? null, source: 'list' }).run();
    });
    this.log.info({ context: 'pc' }, `PC ownership audit: ${entries.length} entries from a file`);
    this.invalidate();
    return { entries: entries.length, problems };
  }

  /** Removes the audit from a file (the owner's answers on single games stay); false when there was none. */
  removeAudit(): boolean {
    const removed = this.db.delete(pcAudit).where(eq(pcAudit.source, 'list')).run().changes > 0;
    if (removed) this.invalidate();
    return removed;
  }

  /** Sets how one storefront game counts (null goes back to the audit file or the storefront's default); false for an unknown game. */
  setOwnership(recordKey: string, ownership: PcOwnership | null): boolean {
    const game = this.db.select().from(pcGames).where(eq(pcGames.recordKey, recordKey)).get();
    if (!game) return false;
    const same = and(eq(pcAudit.source, 'user'), eq(pcAudit.storefront, game.storefront), game.storefrontGameId ? eq(pcAudit.storefrontGameId, game.storefrontGameId) : eq(pcAudit.title, game.name));
    this.db.transaction((tx) => {
      tx.delete(pcAudit).where(same).run();
      if (ownership) tx.insert(pcAudit).values({ storefront: game.storefront, storefrontGameId: game.storefrontGameId || null, title: game.name, ownership, verifiedAt: new Date().toISOString().slice(0, 10), notes: null, source: 'user' }).run();
    });
    this.log.info({ context: 'pc' }, `${game.name} on ${game.storefront}: ${ownership ? PC_OWNERSHIP_LABELS[ownership] : 'back to the default'}`);
    this.invalidate();
    return true;
  }
}

/** The PC library's API: status, games, readings (run, upload, confirm, discard), the audit and single games' ownership. */
export function registerPcRoutes(app: FastifyInstance, pc: PcService, tasks: TaskRunner, settings: SettingsService): void {
  app.get('/api/v1/pc', async () => pc.status());

  app.get('/api/v1/pc/games', async (request) => {
    // ?achievements=completed|started (Steam achievements) with the other filters, for those who see what the owner played.
    const q = request.query as Record<string, string | undefined>;
    return pc.list({ ...q, dir: q.dir === 'desc' ? 'desc' : 'asc', page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 100, noAchievements: !sees(request, settings).play });
  });

  /**
   * The PC library as a spreadsheet, with the page's filters (?q=, storefront=, ownership=, installed=,
   * played=, view=): each game with its storefronts and how each counts, playtime, and its console copies.
   */
  app.get('/api/v1/pc/export', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>;
    const { items } = pc.list({ ...q, dir: 'asc', all: true });
    const rows = [
      ['Title', 'Owned for good', 'Storefronts', 'Playtime (hours)', 'Last played', 'Installed', 'Genres', 'Series', 'Console copies'],
      ...items.map((f) => [
        f.title,
        f.owned ? 'yes' : '',
        f.records.map((r) => `${r.storefront} (${PC_OWNERSHIP_LABELS[r.ownership].toLowerCase()})`).join('; '),
        f.playtimeHours,
        f.lastActivityAt?.slice(0, 10) ?? '',
        f.installed ? 'yes' : '',
        f.genres.join('; '),
        f.series.join('; '),
        f.consoles.map((c) => `${c.platform}${c.copies > 1 ? ` x${c.copies}` : ''}${c.sealed > 0 ? ` (${c.sealed} sealed)` : ''}`).join('; '),
      ]),
    ];
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="squirrelcade-pc-library-${new Date().toISOString().slice(0, 10)}.csv"`)
      .send(toCsv(rows));
  });

  app.get('/api/v1/pc/reads', async () => pc.reads());

  /** Reads the newest Playnite backup now, in the background. */
  app.post('/api/v1/pc/read', async (_request, reply) => {
    tasks.enqueue('pc-read');
    return reply.code(202).send({ queued: true });
  });

  /** A snapshot file the Playnite reader wrote (for setups where Squirrelcade can't run the reader itself). */
  app.post('/api/v1/pc/snapshot', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no-file', message: 'Choose the snapshot file the Playnite reader wrote.' });
    try {
      const snapshot = parsePlayniteSnapshot((await file.toBuffer()).toString('utf8'));
      return reply.code(201).send(pc.applySnapshot(snapshot, 'upload'));
    } catch (err) {
      if (err instanceof SnapshotError) return reply.code(400).send({ error: 'invalid-snapshot', message: err.message });
      throw err;
    }
  });

  app.post('/api/v1/pc/reads/:id/apply', async (request, reply) => {
    const outcome = pc.confirm(Number((request.params as { id: string }).id));
    if (!outcome) return reply.code(409).send({ error: 'not-held', message: 'Only a held reading can be applied.' });
    return outcome;
  });

  app.post('/api/v1/pc/reads/:id/discard', async (request, reply) => {
    if (!pc.discard(Number((request.params as { id: string }).id))) return reply.code(409).send({ error: 'not-held', message: 'Only a held reading can be discarded.' });
    return { ok: true };
  });

  app.put('/api/v1/pc/audit', async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: 'no-file', message: 'Choose the audit CSV.' });
    const result = pc.setAudit((await file.toBuffer()).toString('utf8'));
    if (result.entries === 0) return reply.code(400).send({ error: 'invalid-audit', message: result.problems.join(' ') });
    return result;
  });

  app.delete('/api/v1/pc/audit', async (_request, reply) => {
    if (!pc.removeAudit()) return reply.code(404).send({ error: 'not-found', message: 'There is no audit file to remove.' });
    return { removed: true };
  });

  /** How one storefront game counts: { ownership: "permanent" | "subscription" | "historical" | null }. */
  app.patch('/api/v1/pc/games/:recordKey', async (request, reply) => {
    const body = (request.body ?? {}) as { ownership?: unknown };
    const ownership = body.ownership === null ? null : typeof body.ownership === 'string' && ['permanent', 'subscription', 'historical'].includes(body.ownership) ? (body.ownership as PcOwnership) : undefined;
    if (ownership === undefined) return reply.code(400).send({ error: 'invalid', message: 'ownership must be permanent, subscription, historical or null.' });
    if (!pc.setOwnership(decodeURIComponent((request.params as { recordKey: string }).recordKey), ownership)) return reply.code(404).send({ error: 'not-found', message: 'No such PC game.' });
    return { ok: true };
  });

  app.get('/api/v1/pc/sealed', async () => pc.sealedWithoutPc());
}
