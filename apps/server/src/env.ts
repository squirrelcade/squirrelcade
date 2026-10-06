import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Outside Docker: the server package's version with -dev ("0.2.0-dev"), read from its package.json. */
function devVersion(): string {
  for (const file of [resolve(here, '../package.json'), resolve(here, '../../package.json')]) {
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as { name?: string; version?: string };
      if (pkg.name === '@squirrelcade/server' && pkg.version) return `${pkg.version}-dev`;
    } catch {
      // Not there (a built copy elsewhere): try the next.
    }
  }
  return '0.0.0-dev';
}

/** The version, stamped into the Docker image at build time (0.2.0-<commit>); in development, the package's version with -dev. */
export const APP_VERSION = envVar('VERSION') ?? devVersion();

/** An environment variable: SQUIRRELCADE_<name>. */
export function envVar(name: string): string | undefined {
  return process.env[`SQUIRRELCADE_${name}`];
}

function firstExisting(candidates: string[]): string | null {
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Where Squirrelcade runs: folders, address and port, from environment variables with defaults for Docker and development. */
export interface Env {
  /** Database, logs, backups and default folders live here (/config in Docker). */
  configDir: string;
  host: string;
  port: number;
  /** Built web interface to serve, if present. */
  webDir: string | null;
  migrationsDir: string;
  /** True when running inside the Docker image. */
  inDocker: boolean;
}

/** The environment: SQUIRRELCADE_* variables, falling back to /config in Docker or .dev-config in development. */
export function readEnv(overrides: Partial<Env> = {}): Env {
  const inDocker = existsSync('/.dockerenv') || envVar('DOCKER') === '1';
  const configDir = resolve(overrides.configDir ?? envVar('CONFIG_DIR') ?? (inDocker ? '/config' : '.dev-config'));
  const migrationsDir =
    overrides.migrationsDir ??
    envVar('MIGRATIONS_DIR') ??
    firstExisting([resolve(here, '../drizzle'), resolve(here, '../../drizzle')]);
  if (!migrationsDir) throw new Error('Database migrations folder not found; set SQUIRRELCADE_MIGRATIONS_DIR.');
  const webDir =
    overrides.webDir !== undefined
      ? overrides.webDir
      : (envVar('WEB_DIR') ?? firstExisting([resolve(here, '../../web/dist'), resolve(here, '../web')]));
  return {
    configDir,
    host: overrides.host ?? envVar('HOST') ?? '0.0.0.0',
    port: overrides.port ?? Number(envVar('PORT') ?? 7575),
    webDir,
    migrationsDir,
    inDocker,
  };
}
