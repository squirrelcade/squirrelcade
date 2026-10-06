import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { copyFileSync, createReadStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Db } from './db/index.js';
import { backupStamp as stamp, RESTORE_FILE } from './db/index.js';
import type { SettingsService } from './settings.js';

const BACKUP_NAME = /^squirrelcade-(\d{8})-(\d{6})(-manual|-update)?\.db$/;

/** A database backup in the backup folder. */
export interface BackupInfo {
  name: string;
  bytes: number;
  createdAt: string;
  /** update: made automatically before a new version changed the database (kept until deleted by hand). */
  kind: 'scheduled' | 'manual' | 'update';
  /** Why copying it to the second backup folder failed, when it did. */
  copyError?: string;
}

/**
 * Whether a backup is a sound database (SQLite's own quick check, about a second for a large collection), or what's
 * wrong with it. The backup becomes a file whole by itself first: a backup of the database is in WAL mode like it,
 * and opening one of those leaves -shm and -wal files beside it (two more every day, never pruned).
 */
export function checkBackup(path: string): string | null {
  let db: Database.Database;
  try {
    db = new Database(path, { fileMustExist: true });
  } catch (err) {
    return `the backup can't be opened (${err instanceof Error ? err.message : String(err)})`;
  }
  try {
    db.pragma('journal_mode = DELETE');
    const result = db.pragma('quick_check', { simple: true });
    return result === 'ok' ? null : `SQLite's check of the backup found a problem: ${String(result).slice(0, 200)}`;
  } catch (err) {
    return `SQLite couldn't check the backup (${err instanceof Error ? err.message : String(err)})`;
  } finally {
    db.close();
  }
}

/** Online copies of the database (SQLite's backup API), with retention and staged restore. */
export class BackupService {
  constructor(
    private readonly db: Db,
    private readonly configDir: string,
    private readonly settings: SettingsService,
  ) {}

  folder(): string {
    return this.settings.get('storage.backupFolder') || join(this.configDir, 'backups');
  }

  /** The second backup folder (Settings > Storage and backups), or null when copies are off. */
  copyFolder(): string | null {
    return this.settings.get('storage.backupCopyFolder') || null;
  }

  async create(kind: 'scheduled' | 'manual'): Promise<BackupInfo> {
    const dir = this.folder();
    mkdirSync(dir, { recursive: true });
    // Names carry the time to the second. One made within the newest backup's second takes the next second,
    // so the newest name is always the newest backup (and pruning never takes the one just made).
    const suffix = kind === 'manual' ? '-manual' : '';
    const newest = this.list()[0];
    let at = Date.now();
    if (newest && Date.parse(newest.createdAt) >= Math.floor(at / 1000) * 1000) at = Date.parse(newest.createdAt) + 1000;
    let name = `squirrelcade-${stamp(new Date(at))}${suffix}.db`;
    for (let i = 1; existsSync(join(dir, name)); i++) name = `squirrelcade-${stamp(new Date(at + i * 1000))}${suffix}.db`;
    await this.db.$client.backup(join(dir, name));
    // A backup counts only once SQLite's own check says it's sound: a bad one is set aside (".bad", never listed or
    // restored), and the older ones are kept, not pruned for it.
    const problem = checkBackup(join(dir, name));
    if (problem) {
      renameSync(join(dir, name), join(dir, `${name}.bad`));
      throw new Error(`The new backup failed its check, so it was set aside and the older ones kept: ${problem}.`);
    }
    this.prune();
    const info = this.info(name)!;
    const copyError = this.copy(name);
    return copyError ? { ...info, copyError } : info;
  }

  /**
   * Copies a backup into the second backup folder and trims the old scheduled copies there; returns why it
   * failed, or null. The folder is never created: a missing share shouldn't fill the container instead.
   */
  private copy(name: string): string | null {
    const to = this.copyFolder();
    if (!to) return null;
    try {
      if (!existsSync(to)) throw new Error(`the folder ${to} doesn't exist`);
      copyFileSync(join(this.folder(), name), join(to, name));
      // The copy must be whole (a share that filled up or dropped mid-copy leaves a short file).
      if (statSync(join(to, name)).size !== statSync(join(this.folder(), name)).size) throw new Error(`the copy in ${to} came out incomplete`);
      const keep = this.settings.get('storage.backupRetention');
      const scheduled = readdirSync(to)
        .filter((n) => BACKUP_NAME.test(n) && !/-(manual|update)\.db$/.test(n))
        .sort()
        .reverse();
      for (const old of scheduled.slice(keep)) rmSync(join(to, old), { force: true });
      return null;
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  private info(name: string): BackupInfo | null {
    const m = BACKUP_NAME.exec(name);
    if (!m) return null;
    const path = join(this.folder(), name);
    if (!existsSync(path)) return null;
    const [, d, t, suffix] = m as unknown as [string, string, string, string | undefined];
    const createdAt = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
    return { name, bytes: statSync(path).size, createdAt, kind: suffix === '-manual' ? 'manual' : suffix === '-update' ? 'update' : 'scheduled' };
  }

  list(): BackupInfo[] {
    const dir = this.folder();
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .map((n) => this.info(n))
      .filter((b): b is BackupInfo => b !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Keeps the newest scheduled backups; manual backups are only removed by hand. */
  prune(): number {
    const keep = this.settings.get('storage.backupRetention');
    const scheduled = this.list().filter((b) => b.kind === 'scheduled');
    let removed = 0;
    for (const b of scheduled.slice(keep)) {
      rmSync(join(this.folder(), b.name), { force: true });
      removed++;
    }
    return removed;
  }

  path(name: string): string | null {
    return this.info(name) ? join(this.folder(), name) : null;
  }

  /** Copies a backup into place; it replaces the database the next time Squirrelcade starts. */
  stageRestore(name: string): boolean {
    const path = this.path(name);
    if (!path) return false;
    copyFileSync(path, join(this.configDir, RESTORE_FILE));
    return true;
  }

  restorePending(): boolean {
    return existsSync(join(this.configDir, RESTORE_FILE));
  }

  cancelRestore(): void {
    rmSync(join(this.configDir, RESTORE_FILE), { force: true });
  }

  delete(name: string): boolean {
    const path = this.path(name);
    if (!path) return false;
    rmSync(path, { force: true });
    return true;
  }
}

/** Backups: list, create, download, delete, and restore (applied at the next start). */
export function registerBackupRoutes(app: FastifyInstance, backups: BackupService): void {
  app.get('/api/v1/backups', async () => ({ folder: backups.folder(), copyFolder: backups.copyFolder(), restorePending: backups.restorePending(), backups: backups.list() }));

  app.post('/api/v1/backups', async (request) => {
    const backup = await backups.create('manual');
    request.log.info({ context: 'backup' }, `Manual backup ${backup.name} created`);
    return backup;
  });

  app.get('/api/v1/backups/:name', async (request, reply) => {
    const path = backups.path((request.params as { name: string }).name);
    if (!path) return reply.code(404).send({ error: 'not-found', message: 'No such backup.' });
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${(request.params as { name: string }).name}"`)
      .send(createReadStream(path));
  });

  app.post('/api/v1/backups/:name/restore', async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!backups.stageRestore(name)) return reply.code(404).send({ error: 'not-found', message: 'No such backup.' });
    request.log.warn({ context: 'backup' }, `Restore of ${name} staged; it takes effect when Squirrelcade restarts`);
    return { restartRequired: true };
  });

  app.delete('/api/v1/backups/restore', async () => {
    backups.cancelRestore();
    return { ok: true };
  });

  app.delete('/api/v1/backups/:name', async (request, reply) => {
    if (!backups.delete((request.params as { name: string }).name)) return reply.code(404).send({ error: 'not-found', message: 'No such backup.' });
    return { ok: true };
  });
}
