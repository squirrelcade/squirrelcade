/**
 * For an owner who can't sign in any more: prints a link that works once to choose a new password, the same kind of
 * link System > Users makes for other accounts (it signs the account out everywhere when used). Run it where
 * Squirrelcade's config folder is, while Squirrelcade runs or not:
 *
 *   docker exec -it squirrelcade node server/dist/reset-link.js [username]
 *
 * With no username it's for the owner. Nothing is printed but the link and how long it works.
 */
import { eq } from 'drizzle-orm';
import { AuthService } from './auth.js';
import { openDatabase, type Db } from './db/index.js';
import { users } from './db/schema.js';
import { readEnv } from './env.js';
import { SettingsService } from './settings.js';

export function resetLink(argv: string[]): { ok: boolean; message: string } {
  const env = readEnv();
  const { db } = openDatabase(env.configDir, env.migrationsDir);
  try {
    return linkFor(db, argv, env.port);
  } finally {
    db.$client.close();
  }
}

function linkFor(db: Db, argv: string[], port: number): { ok: boolean; message: string } {
  const settings = new SettingsService(db);
  const auth = new AuthService(db, settings);
  const wanted = argv[0]?.trim();
  const user = wanted
    ? db.select({ id: users.id, username: users.username }).from(users).where(eq(users.username, wanted)).get()
    : db.select({ id: users.id, username: users.username }).from(users).where(eq(users.role, 'owner')).get();
  if (!user) return { ok: false, message: wanted ? `No account is called "${wanted}".` : 'There is no account yet: open Squirrelcade to make the owner\'s.' };
  const invite = auth.createInvite(null, user.id);
  const base = settings.get('general.publicUrl').trim().replace(/\/+$/, '') || `http://<your server>:${port}`;
  return {
    ok: true,
    message: `To choose a new password for ${user.username}, open this link (it works once, until ${invite.expiresAt.slice(0, 16).replace('T', ' ')} UTC):\n\n  ${base}/join/${invite.token}\n`,
  };
}

// Run as a command (not when a test imports it).
if (process.argv[1] && /reset-link\.(js|ts)$/.test(process.argv[1])) {
  const { ok, message } = resetLink(process.argv.slice(2));
  (ok ? console.log : console.error)(message);
  process.exit(ok ? 0 : 1);
}
