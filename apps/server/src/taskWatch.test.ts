import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db/index.js';
import { readEnv } from './env.js';
import { TaskRunner } from './tasks.js';

let dir = '';
let runner: TaskRunner | null = null;
let close: (() => void) | null = null;
afterEach(async () => {
  await runner?.stop(1_000);
  runner = null;
  close?.();
  close = null;
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function setUpRunner(watch: ConstructorParameters<typeof TaskRunner>[2]) {
  dir = mkdtempSync(join(tmpdir(), 'squirrelcade-watch-'));
  const { db } = openDatabase(dir, readEnv({ configDir: dir }).migrationsDir);
  close = () => db.$client.close();
  const lines: { msg: string; [k: string]: unknown }[] = [];
  const log = pino({ level: 'info' }, { write: (s: string) => void lines.push(JSON.parse(s)) });
  runner = new TaskRunner(db, log, watch);
  return { runner, lines };
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

describe('the task runner watches itself (2026-11-07: the server stopped answering and the log said nothing)', () => {
  it('logs each run starting and finishing, and a long one still running', async () => {
    const { runner, lines } = setUpRunner({ heartbeatMs: 40 });
    runner.register({
      name: 'slow',
      title: 'Slow work',
      description: 'Takes a while.',
      interval: () => null,
      run: async (_log, progress) => {
        progress('page 3 of 9');
        await wait(130);
        return 'all done';
      },
    });
    await runner.runNow('slow');
    const msgs = lines.map((l) => l.msg);
    expect(msgs[0]).toBe('Slow work: started (manual)');
    expect(msgs.some((m) => /^Slow work: still running after \d+ min \(page 3 of 9\)$/.test(m))).toBe(true);
    expect(msgs.at(-1)).toMatch(/^Slow work: done in \d+ ms \(all done\)$/);
    expect(lines.every((l) => l.context === 'task:slow')).toBe(true);
  });

  it('names the task that kept the server from answering anything', async () => {
    const { runner, lines } = setUpRunner({ checkMs: 20, busyMs: 100, reportMs: 0, heartbeatMs: 60_000 });
    runner.register({
      name: 'hog',
      title: 'Hogging work',
      description: 'Never gives way.',
      interval: () => null,
      run: async () => {
        const until = Date.now() + 300;
        while (Date.now() < until) {
          // The one thread busy: no request (health check included) can be answered meanwhile.
        }
        await wait(80);
        return null;
      },
    });
    runner.watchBusy();
    await runner.runNow('hog');
    await wait(60);
    const busy = lines.find((l) => l.context === 'tasks');
    expect(busy?.msg).toMatch(/^The server couldn't answer anything for \d+\.\d s: busy with Hogging work \(hog\)$/);
    expect(busy?.busyMs as number).toBeGreaterThanOrEqual(100);
    expect(busy?.tasks).toEqual(['hog']);
  });

  it('says nothing while the server keeps answering', async () => {
    const { runner, lines } = setUpRunner({ checkMs: 20, busyMs: 200, reportMs: 0 });
    runner.register({ name: 'polite', title: 'Polite work', description: 'Gives way.', interval: () => null, run: async () => void (await wait(150)) });
    runner.watchBusy();
    await runner.runNow('polite');
    await wait(60);
    expect(lines.filter((l) => l.context === 'tasks')).toEqual([]);
  });
});
