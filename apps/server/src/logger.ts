import { mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pino, { type Logger } from 'pino';

/** A log line as System > Logs shows it. */
export interface LogEntry {
  time: string;
  level: string;
  message: string;
  context?: string;
}

const LEVEL_NAMES: Record<number, string> = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };

/** Keeps the most recent log lines in memory for the System > Logs page. */
export class LogBuffer {
  private entries: LogEntry[] = [];
  constructor(private readonly size = 2000) {}

  write(line: string): void {
    try {
      const o = JSON.parse(line) as { time?: number; level?: number; msg?: string; context?: string; err?: { message?: string } };
      const message = o.err?.message && o.msg !== o.err.message ? `${o.msg ?? ''}: ${o.err.message}` : (o.msg ?? '');
      this.entries.push({
        time: new Date(o.time ?? Date.now()).toISOString(),
        level: LEVEL_NAMES[o.level ?? 30] ?? 'info',
        message,
        ...(o.context ? { context: o.context } : {}),
      });
      if (this.entries.length > this.size) this.entries.splice(0, this.entries.length - this.size);
    } catch {
      // Not JSON; ignore.
    }
  }

  recent(limit = 200, minLevel = 'debug'): LogEntry[] {
    const order = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    const min = order.indexOf(minLevel);
    return this.entries.filter((e) => order.indexOf(e.level) >= min).slice(-limit).reverse();
  }
}

/** The logger, the recent lines kept in memory for System > Logs, and the log file's rotation. */
export interface AppLogger {
  logger: Logger;
  buffer: LogBuffer;
  /** Starts a new log file once the current one is over the size limit. */
  rotate(maxBytes?: number): boolean;
}

/** Logs as JSON lines to the console (unless quiet), to config/logs/squirrelcade.log, and to memory for System > Logs. */
export function createLogger(options: { configDir?: string; level?: string; quiet?: boolean }): AppLogger {
  const buffer = new LogBuffer();
  const streams: pino.StreamEntry[] = [{ level: 'trace', stream: { write: (line: string) => buffer.write(line) } }];
  let file: ReturnType<typeof pino.destination> | null = null;
  let filePath: string | null = null;
  if (!options.quiet) streams.push({ level: 'trace', stream: process.stdout });
  if (options.configDir) {
    const dir = join(options.configDir, 'logs');
    mkdirSync(dir, { recursive: true });
    filePath = join(dir, 'squirrelcade.log');
    file = pino.destination({ dest: filePath, sync: false, mkdir: true });
    streams.push({ level: 'trace', stream: file });
  }
  const logger = pino({ level: options.level ?? 'info', base: undefined }, pino.multistream(streams));

  function rotate(maxBytes = 10 * 1024 * 1024): boolean {
    if (!file || !filePath) return false;
    let size = 0;
    try {
      size = statSync(filePath).size;
    } catch {
      return false;
    }
    if (size < maxBytes) return false;
    const previous = `${filePath}.1`;
    rmSync(previous, { force: true });
    renameSync(filePath, previous);
    file.reopen();
    return true;
  }

  return { logger, buffer, rotate };
}
