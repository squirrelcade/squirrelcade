import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase, pendingMigrations } from './index.js';

const MIGRATIONS = join(import.meta.dirname, '../../drizzle');

let dirs: string[] = [];
const temp = (prefix: string) => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

/** A copy of the migrations folder as an older version shipped it (without the newest one). */
function olderMigrations(): string {
  const dir = temp('squirrelcade-migrations-');
  cpSync(MIGRATIONS, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
  const newest = journal.entries.pop()!;
  writeFileSync(journalPath, JSON.stringify(journal));
  rmSync(join(dir, `${newest.tag}.sql`));
  return dir;
}

describe('database updates', () => {
  it('backs up an existing database before a new version changes it', () => {
    const config = temp('squirrelcade-db-');
    const first = openDatabase(config, olderMigrations());
    // A new database needs no backup.
    expect(first.updateBackup).toBeNull();
    first.db.$client.prepare("insert into app_state (key, value) values ('marker', 'kept')").run();
    first.db.$client.close();

    const second = openDatabase(config, MIGRATIONS);
    expect(second.updateBackup).toMatchObject({ migrations: 1 });
    expect(second.updateBackup!.name).toMatch(/^squirrelcade-\d{8}-\d{6}-update\.db$/);
    expect(pendingMigrations(second.db.$client, MIGRATIONS)).toBe(0);
    second.db.$client.close();
    expect(readdirSync(join(config, 'backups'))).toEqual([second.updateBackup!.name]);
    expect(existsSync(join(config, 'backups', second.updateBackup!.name))).toBe(true);

    // Opening again without new migrations makes no backup.
    const third = openDatabase(config, MIGRATIONS);
    expect(third.updateBackup).toBeNull();
    expect(third.db.$client.prepare("select value from app_state where key = 'marker'").get()).toEqual({ value: 'kept' });
    third.db.$client.close();
  });
});
