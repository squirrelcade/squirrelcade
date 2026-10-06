import { desc, eq, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { taskRuns } from './db/schema.js';

/** A background task: what it's called, how often it runs, and the work it does. */
export interface TaskDefinition {
  name: string;
  title: string;
  description: string;
  /** Milliseconds between scheduled runs, read each time so settings apply at once; null means manual only. */
  interval: () => number | null;
  /** Delay before the first run when the task has never run. */
  firstRunDelayMs?: number;
  /** Returns a short result message. Throwing marks the run as failed. `progress` says what it's doing now. */
  run: (log: Logger, progress: (text: string) => void) => Promise<string | void>;
  /**
   * A frequent check (the watched folder, the mailbox, reminders): true for a result that found nothing to do. Such a
   * run leaves no row in the history, so it shows only what happened; the Tasks page still says when it last looked.
   */
  quiet?: (message: string | null) => boolean;
}

/** A task as the Tasks page and the activity indicator show it. */
export interface TaskInfo {
  name: string;
  title: string;
  description: string;
  intervalMs: number | null;
  state: 'idle' | 'queued' | 'running';
  /** While running: when it started, and what it's doing now (for example "PlayStation 4 (14 of 24)"). */
  runningSince: string | null;
  progress: string | null;
  nextRunAt: string | null;
  lastRun: { status: string; startedAt: string; finishedAt: string | null; message: string | null } | null;
  /** A quiet check's last look, when it found nothing (it isn't in the history): when, and what it said. */
  lastLook: { at: string; message: string | null } | null;
}

/** One recorded run of a task. */
export type TaskRun = typeof taskRuns.$inferSelect;

/** How soon after start-up a task interrupted by the last stop runs again. */
const INTERRUPTED_RERUN_MS = 2 * 60_000;

/**
 * Runs background jobs one at a time, so jobs never compete for the database.
 * Every run is recorded in task_runs.
 */
export class TaskRunner {
  /** Each quiet check's last look that found nothing (in memory: after a restart, the check simply looks once more). */
  private looked = new Map<string, { startedAt: string; finishedAt: string; message: string | null }>();
  readonly events = new EventEmitter<{ failed: [task: { name: string; title: string }, message: string]; succeeded: [task: { name: string; title: string }] }>();
  private readonly tasks = new Map<string, TaskDefinition>();
  private readonly nextRun = new Map<string, number>();
  /** Runs asked for with soon() that haven't started yet; they outlast a reschedule. */
  private readonly wanted = new Map<string, number>();
  private readonly queue: { name: string; trigger: string }[] = [];
  private running: string | null = null;
  private current: { startedAt: string; progress: string | null } | null = null;
  private timer: NodeJS.Timeout | null = null;
  private idle: Promise<void> = Promise.resolve();
  private stopped = false;
  private stopping: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly log: Logger,
  ) {}

  register(def: TaskDefinition): void {
    this.tasks.set(def.name, def);
  }

  /**
   * Marks runs left unfinished by a crash or a restart, then starts the scheduler. A scheduled task that was
   * interrupted runs again INTERRUPTED_RERUN_MS after start-up, instead of waiting for its next regular time (a
   * monthly catalog build would otherwise wait a month).
   */
  start(tickMs = 15_000): void {
    const interrupted = this.db
      .update(taskRuns)
      .set({ status: 'interrupted', finishedAt: new Date().toISOString(), message: 'Squirrelcade stopped while this was running.' })
      .where(eq(taskRuns.status, 'running'))
      .returning({ task: taskRuns.task })
      .all();
    for (const name of this.tasks.keys()) this.reschedule(name);
    for (const name of new Set(interrupted.map((r) => r.task))) this.soon(name, INTERRUPTED_RERUN_MS);
    this.timer = setInterval(() => this.tick(), tickMs);
    this.timer.unref();
  }

  /** Stops scheduling and waits for the running task, but not longer than `waitMs`. Later calls return the same wait. */
  stop(waitMs = 10_000): Promise<void> {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.queue.length = 0;
    let timeout: NodeJS.Timeout | undefined;
    this.stopping = Promise.race([this.idle, new Promise<void>((resolve) => (timeout = setTimeout(resolve, waitMs)))]).then(() => clearTimeout(timeout));
    return this.stopping;
  }

  /** Recomputes when a task runs next, from its last run and current interval. */
  reschedule(name: string): void {
    const def = this.tasks.get(name);
    if (!def) return;
    const interval = def.interval();
    if (interval === null) {
      this.nextRun.delete(name);
      return;
    }
    const last = this.lastRun(name);
    // A quiet check's last look counts as its last run: it left no row behind.
    const looked = this.looked.get(name);
    const lastAt = Math.max(last ? Date.parse(last.startedAt) : -Infinity, looked ? Date.parse(looked.startedAt) : -Infinity);
    const base = Number.isFinite(lastAt) ? lastAt : Date.now() + (def.firstRunDelayMs ?? 60_000) - interval;
    const wanted = this.wanted.get(name) ?? Infinity;
    this.nextRun.set(name, Math.max(Math.min(base + interval, wanted), Date.now() + 1_000));
  }

  /**
   * Brings a scheduled task's next run forward to within `delayMs`, also when it's running now (it runs
   * again after). A task without a schedule is left alone.
   */
  soon(name: string, delayMs = 30_000): void {
    const at = this.nextRun.get(name);
    if (at === undefined) return;
    const when = Date.now() + delayMs;
    this.wanted.set(name, Math.min(this.wanted.get(name) ?? when, when));
    this.nextRun.set(name, Math.min(at, when));
  }

  rescheduleAll(): void {
    for (const name of this.tasks.keys()) this.reschedule(name);
  }

  private tick(): void {
    const now = Date.now();
    for (const [name, at] of this.nextRun) {
      if (at <= now) this.enqueue(name, 'schedule');
    }
  }

  /**
   * Queues a task unless it is already queued. A task asked for while it runs runs again afterwards (it may
   * have work it didn't see, such as catalogs requested mid-build), except for the scheduler's own ticks.
   * Returns false for unknown tasks.
   */
  enqueue(name: string, trigger = 'manual'): boolean {
    if (!this.tasks.has(name) || this.stopped) return false;
    if (this.queue.some((q) => q.name === name) || (this.running === name && trigger === 'schedule')) return true;
    this.queue.push({ name, trigger });
    if (!this.running) this.idle = this.drain();
    return true;
  }

  /** Waits until the queue is empty (tests use it after starting tasks through the API). */
  async whenIdle(): Promise<void> {
    await this.idle;
  }

  /** Runs a task now and waits for it (used by tests and "run now" buttons that want the result). */
  async runNow(name: string, trigger = 'manual'): Promise<TaskRun | null> {
    if (!this.enqueue(name, trigger)) return null;
    await this.idle;
    const looked = this.looked.get(name);
    const last = this.lastRun(name);
    if (looked && (!last || looked.startedAt > last.startedAt)) {
      return { id: 0, task: name, trigger, status: 'success', startedAt: looked.startedAt, finishedAt: looked.finishedAt, message: looked.message };
    }
    return last;
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0 && !this.stopped) {
      const { name, trigger } = this.queue.shift()!;
      const def = this.tasks.get(name);
      if (!def) continue;
      this.running = name;
      this.wanted.delete(name);
      const startedAt = new Date().toISOString();
      const run = this.db.insert(taskRuns).values({ task: name, trigger, status: 'running', startedAt }).returning().get();
      const log = this.log.child({ context: `task:${name}` });
      const t0 = Date.now();
      const current = { startedAt, progress: null as string | null };
      this.current = current;
      try {
        const message = (await def.run(log, (text) => (current.progress = text.slice(0, 200)))) ?? null;
        const finishedAt = new Date().toISOString();
        if (def.quiet?.(message)) {
          // Nothing to do this time: no row in the history, only the time of the look.
          this.db.delete(taskRuns).where(eq(taskRuns.id, run.id)).run();
          this.looked.set(name, { startedAt, finishedAt, message });
        } else {
          this.db.update(taskRuns).set({ status: 'success', finishedAt, message }).where(eq(taskRuns.id, run.id)).run();
          this.looked.delete(name);
        }
        log.info(`${def.title}: done in ${Date.now() - t0} ms${message ? ` (${message})` : ''}`);
        this.events.emit('succeeded', { name: def.name, title: def.title });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.db.update(taskRuns).set({ status: 'failed', finishedAt: new Date().toISOString(), message }).where(eq(taskRuns.id, run.id)).run();
        log.error({ err }, `${def.title} failed`);
        this.events.emit('failed', { name: def.name, title: def.title }, message);
      } finally {
        this.running = null;
        this.current = null;
        this.reschedule(name);
      }
    }
  }

  lastRun(name: string): TaskRun | null {
    return this.db.select().from(taskRuns).where(eq(taskRuns.task, name)).orderBy(desc(taskRuns.id)).limit(1).get() ?? null;
  }

  list(): TaskInfo[] {
    return [...this.tasks.values()].map((def) => {
      const last = this.lastRun(def.name);
      const next = this.nextRun.get(def.name);
      return {
        name: def.name,
        title: def.title,
        description: def.description,
        intervalMs: def.interval(),
        state: this.running === def.name ? 'running' : this.queue.some((q) => q.name === def.name) ? 'queued' : 'idle',
        runningSince: this.running === def.name ? (this.current?.startedAt ?? null) : null,
        progress: this.running === def.name ? (this.current?.progress ?? null) : null,
        nextRunAt: next ? new Date(next).toISOString() : null,
        lastRun: last ? { status: last.status, startedAt: last.startedAt, finishedAt: last.finishedAt, message: last.message } : null,
        lastLook: (() => {
          const looked = this.looked.get(def.name);
          return looked && (!last || looked.startedAt > last.startedAt) ? { at: looked.finishedAt, message: looked.message } : null;
        })(),
      };
    });
  }

  history(limit = 100, task?: string): TaskRun[] {
    const q = this.db.select().from(taskRuns);
    return (task ? q.where(eq(taskRuns.task, task)) : q).orderBy(desc(taskRuns.id)).limit(limit).all();
  }

  pruneHistory(olderThanDays: number): number {
    const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
    return this.db.delete(taskRuns).where(lt(taskRuns.startedAt, cutoff)).run().changes;
  }
}

/** Tasks: the list with their state, the run history, and "run now". */
export function registerTaskRoutes(app: FastifyInstance, runner: TaskRunner): void {
  app.get('/api/v1/tasks', async () => runner.list());

  app.get('/api/v1/tasks/history', async (request) => {
    const q = request.query as { limit?: string; task?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 100) || 100, 1), 1000);
    return runner.history(limit, q.task || undefined);
  });

  app.post('/api/v1/tasks/:name/run', async (request, reply) => {
    const { name } = request.params as { name: string };
    if (!runner.enqueue(name, 'manual')) return reply.code(404).send({ error: 'not-found', message: `No task named ${name}.` });
    return reply.code(202).send({ queued: true });
  });
}
