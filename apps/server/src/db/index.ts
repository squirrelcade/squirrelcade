import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export const DB_FILE = 'squirrelcade.db';
export const RESTORE_FILE = 'restore-pending.db';

/** UTC time as YYYYMMDD-HHMMSS, for backup file names. */
export function backupStamp(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}-${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

/**
 * If a backup was staged for restore, swap it in before opening. The replaced
 * database is kept next to it so a restore can itself be undone.
 */
export function applyPendingRestore(configDir: string): string | null {
  const pending = join(configDir, RESTORE_FILE);
  if (!existsSync(pending)) return null;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const current = join(configDir, DB_FILE);
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(current + suffix)) renameSync(current + suffix, join(configDir, `squirrelcade.before-restore-${stamp}.db${suffix}`));
  }
  renameSync(pending, current);
  return stamp;
}

/**
 * How many migrations the database hasn't applied yet. Drizzle applies the
 * ones newer than the last it recorded; a brand-new database counts as none.
 */
export function pendingMigrations(client: Database.Database, migrationsDir: string): number {
  const journal = join(migrationsDir, 'meta', '_journal.json');
  if (!existsSync(journal)) return 0;
  const entries = (JSON.parse(readFileSync(journal, 'utf8')) as { entries: { when: number }[] }).entries;
  const recorded = client.prepare("select name from sqlite_master where type = 'table' and name = '__drizzle_migrations'").get();
  if (!recorded) return 0;
  const last = (client.prepare('select max(created_at) as last from __drizzle_migrations').get() as { last: number | null }).last ?? 0;
  return entries.filter((e) => e.when > last).length;
}

/** Copies the database into the backup folder before an update changes it. */
function backupBeforeUpdate(client: Database.Database, configDir: string): string {
  const name = `squirrelcade-${backupStamp()}-update.db`;
  const folders = [join(configDir, 'backups')];
  try {
    const row = client.prepare("select value from settings where key = 'storage.backupFolder'").get() as { value: string } | undefined;
    const chosen: unknown = row ? JSON.parse(row.value) : '';
    if (typeof chosen === 'string' && chosen) folders.unshift(chosen);
  } catch {
    // No settings yet: the default folder.
  }
  let lastError: unknown;
  for (const folder of folders) {
    try {
      mkdirSync(folder, { recursive: true });
      client.prepare('VACUUM INTO ?').run(join(folder, name));
      return name;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`Could not back up the database before updating it, so it was left unchanged: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export interface OpenedDatabase {
  db: Db;
  /** The backup made because this start updates the database, if it did. */
  updateBackup: { name: string; migrations: number } | null;
}

export function openDatabase(configDir: string, migrationsDir: string): OpenedDatabase {
  mkdirSync(configDir, { recursive: true });
  const client = new Database(join(configDir, DB_FILE));
  client.pragma('journal_mode = WAL');
  client.pragma('foreign_keys = ON');
  client.pragma('busy_timeout = 5000');
  client.pragma('synchronous = NORMAL');
  const pending = pendingMigrations(client, migrationsDir);
  const updateBackup = pending > 0 ? { name: backupBeforeUpdate(client, configDir), migrations: pending } : null;
  const db = drizzle(client, { schema });
  migrate(db, { migrationsFolder: migrationsDir });
  return { db: db as Db, updateBackup };
}
