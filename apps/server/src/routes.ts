import { isViewer, viewerSettings } from './access.js';
import { settingDefinitions, SETTINGS_PAGES } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import { accessSync, constants, existsSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import type { BackupService } from './backups.js';
import { DB_FILE } from './db/index.js';
import { APP_VERSION, type Env } from './env.js';
import type { LogBuffer } from './logger.js';
import type { PcService } from './pc.js';
import { SettingsError, type SettingsService } from './settings.js';
import type { TaskRunner } from './tasks.js';

/** The watched folder for collection exports: the setting, or /imports in Docker, or imports in the config folder. */
export function importFolder(env: Env, settings: SettingsService): string {
  return settings.get('storage.importFolder') || (env.inDocker ? '/imports' : join(env.configDir, 'imports'));
}

/** What a key box says when it holds a Squirrelcade account's password. */
export const ACCOUNT_PASSWORD_IN_KEY = "That's a Squirrelcade sign-in password, not this service's key: a password manager probably filled it in. It wasn't saved. Paste the key itself.";

/**
 * Settings: read, change, reset, export and import, and the settings pages' layout for other clients. A secret (a key,
 * token or password for another service) is refused when it's one of the accounts' passwords (isAccountPassword).
 */
export function registerSettingsRoutes(app: FastifyInstance, settings: SettingsService, isAccountPassword: (value: string) => Promise<boolean> = async () => false): void {
  const refuseAccountPasswords = async (values: Record<string, unknown>) => {
    const issues = [];
    for (const [key, value] of Object.entries(values)) {
      if (settingDefinitions[key as keyof typeof settingDefinitions]?.kind !== 'secret' || typeof value !== 'string') continue;
      if (await isAccountPassword(value.trim())) issues.push({ key, message: ACCOUNT_PASSWORD_IN_KEY });
    }
    if (issues.length > 0) throw new SettingsError(issues);
  };

  // A viewer gets only what their pages need to show the collection (see access.ts).
  app.get('/api/v1/settings', async (request) => (isViewer(request) ? { values: viewerSettings(settings.forClient().values), secretsSet: [] } : settings.forClient()));

  app.put('/api/v1/settings', async (request) => {
    const changes = (request.body as { changes?: Record<string, unknown> } | null)?.changes ?? {};
    await refuseAccountPasswords(changes);
    settings.update(changes);
    request.log.info({ context: 'settings' }, `Settings changed: ${Object.keys(changes).join(', ')}`);
    return settings.forClient();
  });

  app.post('/api/v1/settings/reset', async (request) => {
    const keys = (request.body as { keys?: unknown } | null)?.keys;
    settings.reset(Array.isArray(keys) ? keys.map(String) : []);
    return settings.forClient();
  });

  app.get('/api/v1/settings/export', async (_request, reply) => {
    const date = new Date().toISOString().slice(0, 10);
    return reply.header('content-disposition', `attachment; filename="squirrelcade-settings-${date}.json"`).send(settings.export());
  });

  app.post('/api/v1/settings/import', async (request) => {
    const file = request.body as { settings?: unknown } | null;
    if (file && typeof file.settings === 'object' && file.settings !== null) await refuseAccountPasswords(file.settings as Record<string, unknown>);
    settings.import(request.body);
    request.log.info({ context: 'settings' }, 'Settings imported from a file');
    return settings.forClient();
  });

  /** Page and section layout for clients other than the bundled web app. */
  app.get('/api/v1/settings/schema', async () => ({
    pages: SETTINGS_PAGES,
    settings: Object.entries(settingDefinitions).map(([key, d]) => ({
      key,
      page: d.page,
      section: d.section,
      label: d.label,
      description: d.description,
      kind: d.kind,
      default: d.default,
      ...('options' in d ? { options: d.options } : {}),
      ...('unit' in d ? { unit: d.unit } : {}),
      ...('min' in d ? { min: d.min, max: d.max } : {}),
      advanced: 'advanced' in d ? d.advanced : false,
      restartRequired: 'restartRequired' in d ? d.restartRequired : false,
    })),
  }));
}

/** "Config folder", "Backups folder", "Watched folder". */
const folderName = (name: string) => (/folder$/i.test(name) ? name : `${name} folder`);

function folderInfo(name: string, path: string, needsWrite: boolean) {
  const exists = existsSync(path);
  let writable = false;
  let freeBytes: number | null = null;
  if (exists) {
    try {
      accessSync(path, needsWrite ? constants.W_OK : constants.R_OK);
      writable = true;
    } catch {
      writable = false;
    }
    try {
      const s = statfsSync(path);
      freeBytes = s.bavail * s.bsize;
    } catch {
      freeBytes = null;
    }
  }
  return { name, path, exists, writable, needsWrite, freeBytes };
}

/** The least free space a folder Squirrelcade writes to should have: room for a few more copies of the database (backups, an update's backup), at least 500 MB. */
export function spaceNeeded(databaseBytes: number): number {
  return Math.max(500 * 1024 ** 2, databaseBytes * 3);
}

/** "1.2 GB", "340 MB": a size for a health message. */
function size(n: number): string {
  return n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : `${Math.round(n / 1024 ** 2)} MB`;
}

/** Problems worth the owner's attention: folders, disk space, a staged restore, backups, the PC library's backups. Shown on System > Status and alerted by the health check. */
export function computeHealth(deps: { env: Env; settings: SettingsService; backups: BackupService; pc?: PcService; problems?: () => { level: 'warning' | 'error'; message: string }[] }) {
  const { env, settings, backups } = deps;
  const imports = importFolder(env, settings);
  const pc = deps.pc?.health();
  const folders = [
    folderInfo('Config', env.configDir, true),
    folderInfo('Backups', backups.folder(), true),
    ...(backups.copyFolder() ? [folderInfo('Second backup folder', backups.copyFolder()!, true)] : []),
    folderInfo('Watched folder', imports, settings.get('collection.afterImport') === 'move'),
    // Playnite's backups, once the PC library uses them (read only).
    ...(pc?.folder ? [folderInfo('Playnite backups', pc.folder, false)] : []),
  ];
  const health: { level: 'warning' | 'error'; message: string }[] = [];
  for (const f of folders) {
    if (f.name === 'Watched folder' && !settings.get('collection.dropFolderEnabled')) continue;
    if (!f.exists) health.push({ level: f.name === 'Config' ? 'error' : 'warning', message: `${folderName(f.name)} ${f.path} doesn't exist.` });
    else if (!f.writable) health.push({ level: 'warning', message: `${folderName(f.name)} ${f.path} ${f.needsWrite ? "isn't writable" : "can't be read"}.` });
  }
  // Room for the database's backups: a disk that fills up stops backups, and then updates.
  const dbPath = join(env.configDir, DB_FILE);
  const needed = spaceNeeded(existsSync(dbPath) ? statSync(dbPath).size : 0);
  const disks = new Set<number>();
  for (const f of folders) {
    if (!f.needsWrite || f.freeBytes === null || f.freeBytes >= needed || f.name === 'Watched folder') continue;
    // Folders on the same disk share one warning.
    if (disks.has(f.freeBytes)) continue;
    disks.add(f.freeBytes);
    health.push({ level: 'warning', message: `The disk with the ${folderName(f.name).toLowerCase()} has ${size(f.freeBytes)} free; backups need about ${size(needed)}.` });
  }
  if (backups.restorePending()) health.push({ level: 'warning', message: 'A backup restore is staged and will replace the database when Squirrelcade restarts.' });
  const lastBackup = backups.list()[0];
  // Old means a day past the schedule, so a weekly backup isn't old on its sixth day.
  const oldAfterDays = deps.settings.get('tasks.backupIntervalDays') + 1;
  if (!lastBackup || Date.now() - Date.parse(lastBackup.createdAt) > oldAfterDays * 86_400_000) {
    health.push({ level: 'warning', message: lastBackup ? `The newest backup is more than ${oldAfterDays} days old.` : 'No backups yet.' });
  }
  health.push(...(pc?.problems ?? []));
  // The optional parts' own (PlayStation's sign-in running out).
  health.push(...(deps.problems?.() ?? []));
  return { folders, health };
}

/** How many web page errors the log takes in each window (see the client-error route). */
const CLIENT_ERRORS_PER_WINDOW = 20;
const CLIENT_ERROR_WINDOW_MS = 10 * 60 * 1000;

/** System: health, status (version, uptime, database size, folders and problems) and the recent log lines. */
export function registerSystemRoutes(
  app: FastifyInstance,
  deps: { env: Env; settings: SettingsService; backups: BackupService; logs: LogBuffer; startedAt: Date; pc?: PcService; tasks?: TaskRunner; problems?: () => { level: 'warning' | 'error'; message: string }[] },
): void {
  app.get('/api/v1/health', async () => ({ status: 'ok', version: APP_VERSION }));

  app.get('/api/v1/system/status', async () => {
    const { env } = deps;
    const dbPath = join(env.configDir, DB_FILE);
    const { folders, health } = computeHealth(deps);
    return {
      version: APP_VERSION,
      startedAt: deps.startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      node: process.version,
      os: `${process.platform} ${process.arch}`,
      inDocker: env.inDocker,
      databaseBytes: existsSync(dbPath) ? statSync(dbPath).size : 0,
      folders,
      health,
    };
  });

  /**
   * A support file for reporting a problem: version and runtime, folders and health, the settings (passwords
   * and keys never included, as in a settings export), the tasks with their recent runs, and recent log lines.
   * Nothing is sent anywhere: the owner downloads it and decides whom to give it to.
   */
  app.get('/api/v1/system/support', async (_request, reply) => {
    const { env } = deps;
    const { folders, health } = computeHealth(deps);
    const body = {
      generatedAt: new Date().toISOString(),
      version: APP_VERSION,
      node: process.version,
      os: `${process.platform} ${process.arch}`,
      inDocker: env.inDocker,
      uptimeSeconds: Math.round(process.uptime()),
      folders,
      health,
      settings: deps.settings.export(),
      tasks: deps.tasks?.list() ?? [],
      taskRuns: deps.tasks?.history(200) ?? [],
      logs: deps.logs.recent(1000, 'info'),
    };
    return reply.header('content-disposition', `attachment; filename="squirrelcade-support-${body.generatedAt.slice(0, 10)}.json"`).send(body);
  });

  // What the web pages' error boundaries catch goes into the log (and so the support file); a page stuck in a
  // loop can't flood it: at most CLIENT_ERRORS_PER_WINDOW in each CLIENT_ERROR_WINDOW_MS.
  let clientErrors: number[] = [];
  app.post('/api/v1/system/client-error', async (request, reply) => {
    const b = request.body as { message?: unknown; stack?: unknown; path?: unknown } | null;
    const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
    const now = Date.now();
    clientErrors = clientErrors.filter((t) => now - t < CLIENT_ERROR_WINDOW_MS);
    if (clientErrors.length < CLIENT_ERRORS_PER_WINDOW) {
      clientErrors.push(now);
      request.log.error({ context: 'web', path: text(b?.path, 300), stack: text(b?.stack, 4000) }, `A page couldn't be shown: ${text(b?.message, 500) || 'unknown error'}`);
    }
    return reply.code(204).send();
  });

  app.get('/api/v1/system/logs', async (request) => {
    const q = request.query as { limit?: string; level?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? 200) || 200, 1), 2000);
    return deps.logs.recent(limit, q.level || 'debug');
  });
}
