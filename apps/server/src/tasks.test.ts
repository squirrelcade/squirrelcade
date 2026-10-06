import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkBackup } from './backups.js';
import { taskRuns } from './db/schema.js';
import { spaceNeeded } from './routes.js';
import { exportCsv, setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

describe('tasks', () => {
  it('lists the built-in tasks with schedules from settings', async () => {
    const tasks = (await g.app.inject({ url: '/api/v1/tasks', cookies })).json() as { name: string; intervalMs: number | null }[];
    expect(tasks.map((t) => t.name).sort()).toEqual(['backup', 'catalog-build', 'export-reminder', 'game-of-the-day', 'health-check', 'housekeeping', 'igdb-sync', 'import-folder', 'loan-reminders', 'mail-import', 'pc-discover', 'pc-prices', 'pc-read', 'psn-sync', 'ra-sync', 'release-reminders', 'romm-sync', 'steam-sync', 'xbox-sync']);
    // Release reminders are checked only once they're turned on.
    expect(tasks.find((t) => t.name === 'release-reminders')!.intervalMs).toBeNull();
    // The PC wishlist's search runs only once IGDB's keys are set.
    expect(tasks.find((t) => t.name === 'pc-discover')!.intervalMs).toBeNull();
    // The PC library is read only once there's a Playnite folder (none outside Docker by default).
    expect(tasks.find((t) => t.name === 'pc-read')!.intervalMs).toBeNull();
    expect(tasks.find((t) => t.name === 'backup')!.intervalMs).toBe(7 * 86_400_000);
    // Catalogs are checked daily for refreshes, unless refreshes are off.
    expect(tasks.find((t) => t.name === 'catalog-build')!.intervalMs).toBe(24 * 3_600_000);
    // IGDB updates are scheduled only once keys are set.
    expect(tasks.find((t) => t.name === 'igdb-sync')!.intervalMs).toBeNull();
    // So is the RomM index, once its address and token are set.
    expect(tasks.find((t) => t.name === 'romm-sync')!.intervalMs).toBeNull();
    // Email and export reminders wait for their switch and setting.
    expect(tasks.find((t) => t.name === 'mail-import')!.intervalMs).toBeNull();
    expect(tasks.find((t) => t.name === 'export-reminder')!.intervalMs).toBeNull();
    g.settings.update({ 'collection.dropFolderEnabled': false, 'catalogs.refreshDays': 0 });
    const after = (await g.app.inject({ url: '/api/v1/tasks', cookies })).json() as { name: string; intervalMs: number | null }[];
    expect(after.find((t) => t.name === 'import-folder')!.intervalMs).toBeNull();
    expect(after.find((t) => t.name === 'catalog-build')!.intervalMs).toBeNull();
    g.settings.update({ 'notifications.releaseReminders': true });
    const reminding = (await g.app.inject({ url: '/api/v1/tasks', cookies })).json() as { name: string; intervalMs: number | null }[];
    expect(reminding.find((t) => t.name === 'release-reminders')!.intervalMs).toBe(6 * 3_600_000);
  });

  it('brings the catalog build forward after an import', async () => {
    await g.restart({ startTasks: true });
    const next = () => Date.parse(g.tasks.list().find((t) => t.name === 'catalog-build')!.nextRunAt!);
    // The first build waits a few minutes after start; an import makes it run within a minute.
    expect(next() - Date.now()).toBeGreaterThan(60_000);
    g.collection.importText(exportCsv([['1', 'Halo 3', 'Xbox 360', 1000]]), { source: 'upload', fileName: 'collection_20260101.csv' });
    expect(next() - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it('brings the catalog build forward when a console comes to be tracked by a game added here, or by a lower threshold', async () => {
    await g.restart({ startTasks: true });
    const next = () => Date.parse(g.tasks.list().find((t) => t.name === 'catalog-build')!.nextRunAt!);
    expect(next() - Date.now()).toBeGreaterThan(60_000);
    // One game on a console isn't enough to track it at 6 (the default), so nothing is asked for...
    const added = await g.app.inject({ method: 'POST', url: '/api/v1/collection/copies', cookies, payload: { platformKey: 'sega-saturn', title: 'Panzer Dragoon Saga', completeness: 'complete' } });
    expect(added.statusCode).toBe(201);
    expect(next() - Date.now()).toBeGreaterThan(60_000);
    // ...until "Unique games to track a console" comes down to 1.
    g.settings.update({ 'platforms.minUniqueGames': 1 });
    expect(next() - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it('runs a task on request and records it', async () => {
    const run = await g.tasks.runNow('housekeeping');
    expect(run).toMatchObject({ task: 'housekeeping', status: 'success', trigger: 'manual' });
    const history = (await g.app.inject({ url: '/api/v1/tasks/history?task=housekeeping', cookies })).json();
    expect(history).toHaveLength(1);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/tasks/nope/run', cookies })).statusCode).toBe(404);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/tasks/housekeeping/run', cookies })).statusCode).toBe(202);
  });

  it('runs a task again when it is asked for while running', async () => {
    let runs = 0;
    let release = () => {};
    g.tasks.register({
      name: 'slow',
      title: 'Slow',
      description: 'Waits for the test the first time.',
      interval: () => null,
      run: async () => {
        if (++runs === 1) await new Promise<void>((r) => (release = r));
        return `run ${runs}`;
      },
    });
    g.tasks.enqueue('slow');
    await new Promise((r) => setTimeout(r, 10));
    // Asked for twice while running: one more run, not two.
    g.tasks.enqueue('slow');
    g.tasks.enqueue('slow');
    release();
    await g.tasks.whenIdle();
    expect(runs).toBe(2);
  });

  it('says what a running task is doing', async () => {
    let release = () => {};
    g.tasks.register({
      name: 'steps',
      title: 'Steps',
      description: 'Reports its progress.',
      interval: () => null,
      run: async (_log, progress) => {
        progress('Step 2 of 3');
        await new Promise<void>((r) => (release = r));
      },
    });
    g.tasks.enqueue('steps');
    await new Promise((r) => setTimeout(r, 10));
    const running = (await g.app.inject({ url: '/api/v1/tasks', cookies })).json().find((t: { name: string }) => t.name === 'steps');
    expect(running).toMatchObject({ state: 'running', progress: 'Step 2 of 3', runningSince: expect.any(String) });
    release();
    await g.tasks.whenIdle();
    expect(g.tasks.list().find((t) => t.name === 'steps')).toMatchObject({ state: 'idle', progress: null, runningSince: null });
  });

  it('keeps a quiet check that found nothing out of the history, and still knows when it looked', async () => {
    let found = false;
    g.tasks.register({
      name: 'peek',
      title: 'Peek',
      description: 'A frequent check.',
      interval: () => 15 * 60_000,
      run: async () => (found ? 'Found one.' : 'Nothing new.'),
      quiet: (m) => m === 'Nothing new.',
    });
    const looked = await g.tasks.runNow('peek');
    expect(looked).toMatchObject({ status: 'success', message: 'Nothing new.' });
    expect(g.tasks.history(10, 'peek')).toHaveLength(0);
    const info = () => g.tasks.list().find((t) => t.name === 'peek')!;
    expect(info().lastLook).toMatchObject({ message: 'Nothing new.' });
    // The look counts as its last run: the next one is a full interval away, not at once.
    expect(Date.parse(info().nextRunAt!) - Date.now()).toBeGreaterThan(14 * 60_000);
    // Something to do: that run is in the history, and the quiet look is behind it.
    found = true;
    await g.tasks.runNow('peek');
    expect(g.tasks.history(10, 'peek').map((r) => r.message)).toEqual(['Found one.']);
    expect(info().lastLook).toBeNull();
  });

  it('records failures without stopping the runner', async () => {
    g.tasks.register({ name: 'broken', title: 'Broken', description: 'Always fails.', interval: () => null, run: async () => { throw new Error('boom'); } });
    const run = await g.tasks.runNow('broken');
    expect(run).toMatchObject({ status: 'failed', message: 'boom' });
    expect((await g.tasks.runNow('housekeeping'))!.status).toBe('success');
  });

  it('marks runs interrupted by a crash', async () => {
    // A run left "running" is what a crash leaves behind.
    g.db.insert(taskRuns).values({ task: 'backup', trigger: 'schedule', status: 'running', startedAt: new Date().toISOString() }).run();
    await g.restart({ startTasks: true });
    expect(g.tasks.history(10, 'backup')[0]).toMatchObject({ status: 'interrupted' });
    // It runs again soon, not a day (the backup's interval) after the interrupted run.
    const next = Date.parse(g.tasks.list().find((t) => t.name === 'backup')!.nextRunAt!);
    expect(next - Date.now()).toBeLessThan(3 * 60_000);
  });

  it('does not wait forever for a stuck task when stopping', async () => {
    g.tasks.register({ name: 'stuck', title: 'Stuck', description: 'Never finishes.', interval: () => null, run: () => new Promise(() => {}) });
    g.tasks.enqueue('stuck');
    const t0 = Date.now();
    await g.tasks.stop(200);
    expect(Date.now() - t0).toBeLessThan(2_000);
  });
});

describe('backups', () => {
  it('creates, lists, stages a restore and prunes old automatic backups', async () => {
    g.settings.update({ 'storage.backupRetention': 2 });
    const first = await g.tasks.runNow('backup');
    expect(first!.status).toBe('success');
    const manual = (await g.app.inject({ method: 'POST', url: '/api/v1/backups', cookies })).json();
    expect(manual.kind).toBe('manual');
    await g.backups.create('scheduled');
    await g.backups.create('scheduled');
    const list = (await g.app.inject({ url: '/api/v1/backups', cookies })).json();
    expect(list.backups.filter((b: { kind: string }) => b.kind === 'scheduled')).toHaveLength(2);
    expect(list.backups.filter((b: { kind: string }) => b.kind === 'manual')).toHaveLength(1);

    const download = await g.app.inject({ url: `/api/v1/backups/${manual.name}`, cookies });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');

    expect((await g.app.inject({ method: 'POST', url: `/api/v1/backups/${manual.name}/restore`, cookies })).json()).toEqual({ restartRequired: true });
    expect(existsSync(join(g.dir, 'restore-pending.db'))).toBe(true);
    // Changed your mind: the restore is called off before the restart.
    expect((await g.app.inject({ method: 'DELETE', url: '/api/v1/backups/restore', cookies })).json()).toEqual({ ok: true });
    expect(existsSync(join(g.dir, 'restore-pending.db'))).toBe(false);
    expect((await g.app.inject({ url: '/api/v1/backups/../squirrelcade.db', cookies })).statusCode).toBe(404);
  });

  it('copies each backup to the second backup folder, keeps as many there, and fails the task when the folder is missing', async () => {
    const copies = join(g.dir, 'copies');
    g.settings.update({ 'storage.backupRetention': 2, 'storage.backupCopyFolder': copies });
    // A missing folder (an unmounted share) is never created: the backup is made, the task fails and the health check says so.
    const missing = await g.tasks.runNow('backup');
    expect(missing).toMatchObject({ status: 'failed' });
    expect(missing!.message).toMatch(/was made, but copying it to the second backup folder failed: the folder .*copies doesn't exist/);
    expect(existsSync(copies)).toBe(false);
    const status = (await g.app.inject({ url: '/api/v1/system/status', cookies })).json();
    expect(status.health.map((h: { message: string }) => h.message)).toContain(`Second backup folder ${copies} doesn't exist.`);

    mkdirSync(copies);
    for (let i = 0; i < 3; i++) expect(await g.tasks.runNow('backup')).toMatchObject({ status: 'success' });
    const manual = await g.backups.create('manual');
    expect(manual.copyError).toBeUndefined();
    const there = readdirSync(copies).sort();
    expect(there.filter((n) => !n.endsWith('-manual.db'))).toHaveLength(2);
    expect(there).toContain(manual.name);
    expect((await g.app.inject({ url: '/api/v1/backups', cookies })).json().copyFolder).toBe(copies);
  });

  it("checks each backup with SQLite's own check: a sound one passes, a damaged or cut-short one is caught", async () => {
    const made = await g.backups.create('manual');
    const path = join(g.backups.folder(), made.name);
    expect(checkBackup(path)).toBeNull();
    // Whole by itself (a rollback-journal file, not WAL), and checking it leaves no -shm or -wal file beside it.
    expect(readFileSync(path)[18]).toBe(1);
    expect(readdirSync(g.backups.folder()).filter((n) => /-(shm|wal)$/.test(n))).toEqual([]);
    // Cut short (a disk that filled up), or not a database at all.
    const bytes = readFileSync(path);
    writeFileSync(join(g.dir, 'short.db'), bytes.subarray(0, Math.floor(bytes.length / 2)));
    expect(checkBackup(join(g.dir, 'short.db'))).toMatch(/problem|can't be opened|couldn't check/);
    writeFileSync(join(g.dir, 'junk.db'), 'not a database at all, just some text that is long enough to look like a file');
    expect(checkBackup(join(g.dir, 'junk.db'))).toMatch(/can't be opened|couldn't check|problem/);
  });

  it('swaps in a staged restore on the next start and keeps the old database', async () => {
    g.settings.update({ 'general.instanceName': 'Before backup' });
    const backup = await g.backups.create('manual');
    g.settings.update({ 'general.instanceName': 'After backup' });
    g.backups.stageRestore(backup.name);
    await g.restart();
    expect(g.settings.get('general.instanceName')).toBe('Before backup');
    expect(readdirSync(g.dir).some((f) => f.startsWith('squirrelcade.before-restore-'))).toBe(true);
    expect(g.backups.restorePending()).toBe(false);
  });
});

describe('system', () => {
  it('reports status and recent log lines', async () => {
    const status = (await g.app.inject({ url: '/api/v1/system/status', cookies })).json();
    expect(status.version).toBeTruthy();
    expect(status.folders.map((f: { name: string }) => f.name)).toEqual(['Config', 'Backups', 'Watched folder']);
    expect(status.health.some((h: { message: string }) => h.message === 'No backups yet.')).toBe(true);
    const logs = (await g.app.inject({ url: '/api/v1/system/logs?level=info', cookies })).json();
    expect(logs.some((l: { message: string }) => l.message.includes('ready'))).toBe(true);

    // The support file: everything above plus settings (never secrets), tasks and their runs.
    g.settings.update({ 'notifications.smtpPassword': 'app-password', 'general.instanceName': 'My games' });
    await g.tasks.runNow('housekeeping');
    const support = await g.app.inject({ url: '/api/v1/system/support', cookies });
    expect(support.headers['content-disposition']).toMatch(/^attachment; filename="squirrelcade-support-\d{4}-\d{2}-\d{2}\.json"$/);
    const file = support.json();
    expect(file).toMatchObject({ version: expect.any(String), health: expect.any(Array), settings: { settings: { 'general.instanceName': 'My games' } } });
    expect(support.body).not.toContain('app-password');
    expect(file.taskRuns.some((r: { task: string }) => r.task === 'housekeeping')).toBe(true);
    expect((await g.app.inject({ url: '/api/v1/system/support' })).statusCode).toBe(401);
  });

  it('wants room for a few more copies of the database on its disks, at least 500 MB', () => {
    expect(spaceNeeded(0)).toBe(500 * 1024 ** 2);
    expect(spaceNeeded(100 * 1024 ** 2)).toBe(500 * 1024 ** 2);
    expect(spaceNeeded(400 * 1024 ** 2)).toBe(1200 * 1024 ** 2);
  });

  it("logs the web pages' errors, a limited number at a time", async () => {
    const send = (n: number) => g.app.inject({ method: 'POST', url: '/api/v1/system/client-error', payload: { message: `boom ${n}`, stack: 'at Page', path: '/collection' }, cookies });
    expect((await send(0)).statusCode).toBe(204);
    const logged = () => (g.logs.buffer.recent(2000, 'error') as { message: string }[]).filter((l) => l.message.startsWith("A page couldn't be shown")).length;
    expect(logged()).toBe(1);
    for (let i = 1; i < 30; i++) await send(i);
    expect(logged()).toBe(20);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/system/client-error', payload: { message: 'x' } })).statusCode).toBe(401);
  });
});
