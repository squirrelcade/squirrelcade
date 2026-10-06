import { and, desc, eq, gt, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { promisify } from 'node:util';
import type { Db } from './db/index.js';
import { envVar } from './env.js';
import { appState, invites, sessions, users } from './db/schema.js';
import type { SettingsService } from './settings.js';
import { roleOf, sees, viewerMay, type Role, type Sees } from './access.js';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;

/** The name of the sign-in cookie. */
export const SESSION_COOKIE = 'squirrelcade_session';

/** Who a request comes from: a signed-in user, a tool with the API key, or the local network when sign-in isn't required there. */
export type AuthContext = { kind: 'session'; userId: number; username: string; role: Role } | { kind: 'apikey' } | { kind: 'local' };

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
    /** What the requester may see of the owner's private details (see access.ts); null outside the API. */
    sees: Sees | null;
  }
}

const SCRYPT = { N: 16384, r: 8, p: 1 };

/** A password hash to store: scrypt with a random salt, its parameters written alongside. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Whether a password matches a stored hash, compared in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** True for loopback, private and link-local addresses (IPv4, IPv6 and IPv4-mapped IPv6). */
export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  let ip = address;
  if (ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4) ip = ip.slice(7);
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80');
  }
  return false;
}

const FORWARD_HEADERS = ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'];

/**
 * Whether a request comes from the local network. A request relayed by a proxy
 * that isn't in "Trusted proxies" (for example a Cloudflare Tunnel) counts as
 * external, so remote visitors can't skip the login.
 */
export function isLocalRequest(request: FastifyRequest): boolean {
  const forwarded = FORWARD_HEADERS.some((h) => request.headers[h] !== undefined);
  const peer = request.socket.remoteAddress;
  if (forwarded && request.ip === peer) return false;
  return isLocalAddress(request.ip);
}

/** A setup code's letters: no 0 and O, 1 and I, so it reads right from a log. */
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newSetupCode = () => Array.from({ length: 8 }, (_, i) => (i === 4 ? '-' : '') + CODE_LETTERS[randomInt(CODE_LETTERS.length)]).join('');
/** A setup code as typed: its letters and digits, in capitals ("abcd efgh" is ABCD-EFGH). */
const plainCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Accounts, sign-ins and the API key: password checks with a pause after repeated failures, sessions, and the key for other tools. */
export class AuthService {
  private failures = new Map<string, { count: number; resetAt: number }>();
  private firstRunCode: string | null = null;
  /** Called with the account's id when its password changes (its AI apps' connections end, 0.55.0). */
  readonly passwordChanged = new Set<(userId: number) => void>();

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
  ) {}

  hasUsers(): boolean {
    return this.db.select({ id: users.id }).from(users).limit(1).all().length > 0;
  }

  /**
   * The code first-run setup asks for from outside the home network (0.60.0), so someone who finds a new install on the
   * internet can't make its owner account: made while there's no account (or SQUIRRELCADE_SETUP_CODE), written to the
   * log at startup, and gone once the first account exists. From the home network, setup needs no code.
   */
  setupCode(): string | null {
    if (this.hasUsers()) return null;
    this.firstRunCode ??= envVar('SETUP_CODE')?.trim() || newSetupCode();
    return this.firstRunCode;
  }

  /** Whether a code typed at setup is the setup code (letters and digits only, any case). */
  setupCodeMatches(given: unknown): boolean {
    const code = this.setupCode();
    if (!code || typeof given !== 'string') return false;
    const a = Buffer.from(plainCode(given));
    const b = Buffer.from(plainCode(code));
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async createUser(username: string, password: string, role: Role = 'viewer'): Promise<{ id: number; username: string }> {
    const passwordHash = await hashPassword(password);
    const row = this.db
      .insert(users)
      .values({ username, passwordHash, createdAt: new Date().toISOString(), role })
      .returning({ id: users.id, username: users.username })
      .get();
    return row;
  }

  /** Every account, the owner first, with when each last used Squirrelcade. */
  users(): { id: number; username: string; role: Role; createdAt: string; lastSeenAt: string | null }[] {
    const seen = new Map<number, string>();
    for (const s of this.db.select({ userId: sessions.userId, lastSeenAt: sessions.lastSeenAt }).from(sessions).all()) {
      if ((seen.get(s.userId) ?? '') < s.lastSeenAt) seen.set(s.userId, s.lastSeenAt);
    }
    return this.db
      .select({ id: users.id, username: users.username, role: users.role, createdAt: users.createdAt })
      .from(users)
      .all()
      .map((u) => ({ ...u, role: u.role as Role, lastSeenAt: seen.get(u.id) ?? null }))
      .sort((a, b) => (a.role === b.role ? a.username.localeCompare(b.username) : a.role === 'owner' ? -1 : 1));
  }

  /** Removes a viewer's account (and signs them out); the owner's can't be removed. */
  removeUser(id: number): boolean {
    return this.db.delete(users).where(and(eq(users.id, id), eq(users.role, 'viewer'))).run().changes > 0;
  }

  /** Hands the collection to another account: it becomes the owner, and the owner until now a viewer. */
  makeOwner(id: number): boolean {
    const user = this.db.select({ id: users.id }).from(users).where(eq(users.id, id)).get();
    if (!user) return false;
    this.db.transaction((tx) => {
      tx.update(users).set({ role: 'viewer' }).where(eq(users.role, 'owner')).run();
      tx.update(users).set({ role: 'owner' }).where(eq(users.id, id)).run();
    });
    return true;
  }

  /**
   * A link to invite a viewer, or (with userId) to let an account choose a new password: the token is returned
   * once, and only its SHA-256 kept. It works once, for Settings > Security > "Invite links work for".
   */
  createInvite(name: string | null, userId: number | null = null): { id: number; token: string; expiresAt: string } {
    const token = randomBytes(24).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.settings.get('security.inviteDays') * 86_400_000).toISOString();
    const row = this.db
      .insert(invites)
      .values({ tokenHash: sha256(token), name: name?.trim() || null, userId, createdAt: now.toISOString(), expiresAt })
      .returning({ id: invites.id })
      .get();
    return { id: row.id, token, expiresAt };
  }

  /** The links not used yet and not expired, newest first (never their tokens). */
  openInvites(): { id: number; name: string | null; username: string | null; createdAt: string; expiresAt: string }[] {
    const now = new Date().toISOString();
    return this.db
      .select({ id: invites.id, name: invites.name, username: users.username, createdAt: invites.createdAt, expiresAt: invites.expiresAt })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.userId))
      .where(and(isNull(invites.usedAt), gt(invites.expiresAt, now)))
      .orderBy(desc(invites.createdAt))
      .all();
  }

  revokeInvite(id: number): boolean {
    return this.db.delete(invites).where(eq(invites.id, id)).run().changes > 0;
  }

  /** A link's invite while it still works: who it's for, and the account it's for when it sets a new password. */
  inviteOf(token: string): { id: number; name: string | null; userId: number | null; username: string | null; expiresAt: string } | null {
    const row = this.db
      .select({ id: invites.id, name: invites.name, userId: invites.userId, username: users.username, expiresAt: invites.expiresAt, usedAt: invites.usedAt })
      .from(invites)
      .leftJoin(users, eq(users.id, invites.userId))
      .where(eq(invites.tokenHash, sha256(token)))
      .get();
    if (!row || row.usedAt || row.expiresAt <= new Date().toISOString()) return null;
    return { id: row.id, name: row.name, userId: row.userId, username: row.username, expiresAt: row.expiresAt };
  }

  /**
   * Uses a link: a new viewer's account with the username and password chosen, or a new password for the account
   * it's for. Null when the link doesn't work (any more); 'taken' when another account has the username.
   */
  async acceptInvite(token: string, username: string, password: string): Promise<{ id: number; username: string } | null | 'taken'> {
    const invite = this.inviteOf(token);
    if (!invite) return null;
    const now = new Date().toISOString();
    if (invite.userId !== null) {
      this.db.update(users).set({ passwordHash: await hashPassword(password) }).where(eq(users.id, invite.userId)).run();
      this.db.update(invites).set({ usedAt: now }).where(eq(invites.id, invite.id)).run();
      this.db.delete(sessions).where(eq(sessions.userId, invite.userId)).run();
      for (const f of this.passwordChanged) f(invite.userId);
      return { id: invite.userId, username: invite.username ?? username };
    }
    if (this.db.select({ id: users.id }).from(users).where(eq(users.username, username)).get()) return 'taken';
    const user = await this.createUser(username, password, 'viewer');
    this.db.update(invites).set({ usedAt: now }).where(eq(invites.id, invite.id)).run();
    return user;
  }

  async verifyLogin(username: string, password: string): Promise<{ id: number; username: string } | null> {
    const user = this.db.select().from(users).where(eq(users.username, username)).get();
    if (!user) {
      await hashPassword(password); // Same timing as a real check.
      return null;
    }
    return (await verifyPassword(password, user.passwordHash)) ? { id: user.id, username: user.username } : null;
  }

  /**
   * Whether a value is the password of one of Squirrelcade's accounts. A password manager could fill a sign-in password
   * into key boxes on the settings pages, and the daily price check would send it to IsThereAnyDeal as the key (0.60.0):
   * the settings refuse such a value (registerSettingsRoutes).
   */
  async isAccountPassword(value: string): Promise<boolean> {
    if (!value) return false;
    for (const user of this.db.select({ passwordHash: users.passwordHash }).from(users).all()) {
      if (user.passwordHash && (await verifyPassword(value, user.passwordHash))) return true;
    }
    return false;
  }

  async changePassword(userId: number, current: string, next: string): Promise<boolean> {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user || !(await verifyPassword(current, user.passwordHash))) return false;
    this.db.update(users).set({ passwordHash: await hashPassword(next) }).where(eq(users.id, userId)).run();
    for (const f of this.passwordChanged) f(userId);
    return true;
  }

  /** Too many failed logins from one address lock it out for 15 minutes. */
  isLockedOut(ip: string): boolean {
    const f = this.failures.get(ip);
    return !!f && f.resetAt > Date.now() && f.count >= 10;
  }

  recordFailure(ip: string): void {
    const now = Date.now();
    const f = this.failures.get(ip);
    if (!f || f.resetAt <= now) this.failures.set(ip, { count: 1, resetAt: now + 15 * 60_000 });
    else f.count++;
  }

  createSession(userId: number, ip: string | undefined, userAgent: string | undefined): { token: string; expiresAt: Date } {
    const token = randomBytes(32).toString('base64url');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.settings.get('security.sessionDays') * 86_400_000);
    this.db
      .insert(sessions)
      .values({
        id: sha256(token),
        userId,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        lastSeenAt: now.toISOString(),
        ip: ip ?? null,
        userAgent: userAgent?.slice(0, 300) ?? null,
      })
      .run();
    return { token, expiresAt };
  }

  findSession(token: string): { userId: number; username: string; role: Role } | null {
    const row = this.db
      .select({ id: sessions.id, userId: sessions.userId, expiresAt: sessions.expiresAt, lastSeenAt: sessions.lastSeenAt, username: users.username, role: users.role })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.id, sha256(token)))
      .get();
    if (!row || row.expiresAt <= new Date().toISOString()) return null;
    if (Date.now() - Date.parse(row.lastSeenAt) > 60_000) {
      this.db.update(sessions).set({ lastSeenAt: new Date().toISOString() }).where(eq(sessions.id, row.id)).run();
    }
    return { userId: row.userId, username: row.username, role: row.role as Role };
  }

  deleteSession(token: string): void {
    this.db.delete(sessions).where(eq(sessions.id, sha256(token))).run();
  }

  deleteExpiredSessions(): number {
    return this.db.delete(sessions).where(lt(sessions.expiresAt, new Date().toISOString())).run().changes;
  }

  deleteOtherSessions(userId: number, keepToken: string): void {
    const keep = sha256(keepToken);
    for (const s of this.db.select({ id: sessions.id }).from(sessions).where(eq(sessions.userId, userId)).all()) {
      if (s.id !== keep) this.db.delete(sessions).where(and(eq(sessions.id, s.id), eq(sessions.userId, userId))).run();
    }
  }

  apiKey(): string {
    const row = this.db.select().from(appState).where(eq(appState.key, 'apiKey')).get();
    if (row) return row.value;
    return this.regenerateApiKey();
  }

  regenerateApiKey(): string {
    const key = randomBytes(16).toString('hex');
    this.db
      .insert(appState)
      .values({ key: 'apiKey', value: key })
      .onConflictDoUpdate({ target: appState.key, set: { value: key } })
      .run();
    return key;
  }
}

/** Routes anyone may call, signed in or not. */
const PUBLIC_ROUTES = new Set(['GET /api/v1/health', 'GET /api/v1/auth/session', 'POST /api/v1/auth/login', 'POST /api/v1/setup', 'GET /api/v1/check']);

/** An invite link's page and its answer (GET /api/v1/join/<token>, POST to use it): public too, the token being the key. */
const JOIN = /^\/api\/v1\/join\/[A-Za-z0-9_-]{16,64}$/;

/** A share link's page (GET /api/v1/share/<token>): the wishlist or the games for sale, for anyone with the link. */
const SHARE = /^\/api\/v1\/share\/[A-Za-z0-9_-]{16,64}$/;

function setSessionCookie(request: FastifyRequest, reply: FastifyReply, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
    expires: expiresAt,
  });
}

function validCredentials(body: unknown): { username: string; password: string } | null {
  const b = body as { username?: unknown; password?: unknown } | null;
  if (!b || typeof b.username !== 'string' || typeof b.password !== 'string') return null;
  const username = b.username.trim();
  if (username.length < 1 || username.length > 64 || b.password.length > 200) return null;
  return { username, password: b.password };
}

/**
 * Works out who each request comes from (session cookie, API key, or the local network when allowed) and
 * turns away the rest; adds the first-run setup, sign-in, sign-out, password and API key routes.
 */
export function registerAuth(app: FastifyInstance, auth: AuthService, settings: SettingsService): void {
  app.decorateRequest('auth', null);
  app.decorateRequest('sees', null);

  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (!path.startsWith('/api/')) return;
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      const session = auth.findSession(token);
      if (session) request.auth = { kind: 'session', ...session };
    }
    if (!request.auth) {
      const key = request.headers['x-api-key'] ?? (request.query as { apikey?: string } | undefined)?.apikey;
      if (typeof key === 'string' && key.length > 0) {
        const expected = auth.apiKey();
        if (key.length === expected.length && timingSafeEqual(Buffer.from(key), Buffer.from(expected))) request.auth = { kind: 'apikey' };
      }
    }
    if (!request.auth && auth.hasUsers() && settings.get('security.authMethod') === 'external' && isLocalRequest(request)) {
      request.auth = { kind: 'local' };
    }
    request.sees = sees(request, settings);
    if (PUBLIC_ROUTES.has(`${request.method} ${path}`) || ((request.method === 'GET' || request.method === 'POST') && JOIN.test(path))) return;
    if (request.method === 'GET' && SHARE.test(path)) return;
    if (!auth.hasUsers()) return reply.code(409).send({ error: 'setup-required', message: 'Create the first account first.' });
    if (!request.auth) return reply.code(401).send({ error: 'unauthorized', message: 'Sign in first.' });
    // Viewers look; everything else is the owner's (see access.ts).
    if (roleOf(request) === 'viewer' && !viewerMay(request.method, path, settings)) {
      return reply.code(403).send({ error: 'owner-only', message: 'Viewers can look at the collection, not change it.' });
    }
  });

  app.get('/api/v1/auth/session', async (request) => ({
    setupRequired: !auth.hasUsers(),
    // From outside the home network, first-run setup asks for the code in the log (0.60.0).
    setupCodeNeeded: !auth.hasUsers() && !isLocalRequest(request),
    authenticated: request.auth !== null,
    username: request.auth?.kind === 'session' ? request.auth.username : null,
    via: request.auth?.kind ?? null,
    role: roleOf(request),
    // Whether the sign-in page leads with checking a game (Settings > Security).
    publicCheck: auth.hasUsers() ? settings.get('security.publicCheck') : 'off',
  }));

  app.post('/api/v1/setup', async (request, reply) => {
    if (auth.hasUsers()) return reply.code(409).send({ error: 'already-set-up', message: 'An account already exists.' });
    if (!isLocalRequest(request)) {
      // From outside the home network, the code from Squirrelcade's log; wrong ones count like failed sign-ins.
      if (auth.isLockedOut(request.ip)) return reply.code(429).send({ error: 'locked', message: 'Too many wrong setup codes. Try again in 15 minutes.' });
      if (!auth.setupCodeMatches((request.body as { setupCode?: unknown } | null)?.setupCode)) {
        auth.recordFailure(request.ip);
        request.log.warn({ context: 'auth' }, `First-run setup refused from ${request.ip}: no or wrong setup code`);
        return reply.code(403).send({ error: 'setup-code', message: "That isn't the setup code. It's in Squirrelcade's log (the line that starts \"No account yet\")." });
      }
    }
    const creds = validCredentials(request.body);
    if (!creds) return reply.code(400).send({ error: 'invalid', message: 'Enter a username and a password.' });
    if (creds.password.length < 8) return reply.code(400).send({ error: 'weak-password', message: 'Use a password of at least 8 characters.' });
    const extra = (request.body as { settings?: Record<string, unknown> }).settings;
    if (extra && typeof extra === 'object') settings.update(extra);
    const user = await auth.createUser(creds.username, creds.password, 'owner');
    auth.apiKey();
    const { token, expiresAt } = auth.createSession(user.id, request.ip, request.headers['user-agent']);
    setSessionCookie(request, reply, token, expiresAt);
    request.log.info({ context: 'auth' }, `Account "${user.username}" created`);
    return reply.code(201).send({ username: user.username });
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    if (auth.isLockedOut(request.ip)) return reply.code(429).send({ error: 'locked', message: 'Too many failed sign-ins. Try again in 15 minutes.' });
    const creds = validCredentials(request.body);
    const user = creds ? await auth.verifyLogin(creds.username, creds.password) : null;
    if (!user) {
      auth.recordFailure(request.ip);
      request.log.warn({ context: 'auth' }, `Failed sign-in from ${request.ip}`);
      return reply.code(401).send({ error: 'invalid-login', message: 'Wrong username or password.' });
    }
    const { token, expiresAt } = auth.createSession(user.id, request.ip, request.headers['user-agent']);
    setSessionCookie(request, reply, token, expiresAt);
    return { username: user.username };
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) auth.deleteSession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/v1/auth/password', async (request, reply) => {
    if (request.auth?.kind !== 'session') return reply.code(403).send({ error: 'session-required', message: 'Sign in to change the password.' });
    const b = request.body as { currentPassword?: unknown; newPassword?: unknown } | null;
    if (typeof b?.currentPassword !== 'string' || typeof b.newPassword !== 'string' || b.newPassword.length < 8 || b.newPassword.length > 200) {
      return reply.code(400).send({ error: 'invalid', message: 'Use a new password of at least 8 characters.' });
    }
    if (!(await auth.changePassword(request.auth.userId, b.currentPassword, b.newPassword))) {
      return reply.code(400).send({ error: 'wrong-password', message: 'The current password is wrong.' });
    }
    auth.deleteOtherSessions(request.auth.userId, request.cookies[SESSION_COOKIE] ?? '');
    return { ok: true };
  });

  app.get('/api/v1/auth/apikey', async () => ({ apiKey: auth.apiKey() }));

  // System > Users (the owner's): the accounts, and links to invite viewers or to set a new password.
  app.get('/api/v1/users', async (request) => {
    const me = request.auth?.kind === 'session' ? request.auth.userId : null;
    return { users: auth.users().map((u) => ({ ...u, you: u.id === me })), invites: auth.openInvites() };
  });

  app.delete('/api/v1/users/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!auth.removeUser(id)) return reply.code(400).send({ error: 'invalid', message: "Only a viewer's account can be removed (hand the collection to someone else first to remove yours)." });
    request.log.info({ context: 'auth' }, `Account ${id} removed`);
    return { ok: true };
  });

  app.post('/api/v1/users/:id/owner', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!auth.makeOwner(id)) return reply.code(404).send({ error: 'not-found', message: 'No such account.' });
    request.log.info({ context: 'auth' }, `Account ${id} is the owner now`);
    return { ok: true };
  });

  app.post('/api/v1/invites', async (request, reply) => {
    const b = (request.body ?? {}) as { name?: unknown; userId?: unknown };
    const name = typeof b.name === 'string' ? b.name.slice(0, 60) : null;
    const userId = b.userId === undefined || b.userId === null ? null : Number(b.userId);
    if (userId !== null && !auth.users().some((u) => u.id === userId)) return reply.code(404).send({ error: 'not-found', message: 'No such account.' });
    const invite = auth.createInvite(name, userId);
    request.log.info({ context: 'auth' }, userId === null ? 'Invite link made' : `New-password link made for account ${userId}`);
    return reply.code(201).send({ id: invite.id, path: `/join/${invite.token}`, expiresAt: invite.expiresAt });
  });

  app.delete('/api/v1/invites/:id', async (request) => ({ removed: auth.revokeInvite(Number((request.params as { id: string }).id)) }));

  // The invite page: who the link is for, while it works.
  app.get('/api/v1/join/:token', async (request, reply) => {
    const invite = auth.inviteOf((request.params as { token: string }).token);
    if (!invite) return reply.code(404).send({ error: 'invalid-link', message: 'This link has been used or has expired. Ask for a new one.' });
    return { name: invite.name, username: invite.username, expiresAt: invite.expiresAt, instanceName: settings.get('general.instanceName') || 'Squirrelcade' };
  });

  // Using the link: a new viewer's account (or a new password for the account it's for), signed in.
  app.post('/api/v1/join/:token', async (request, reply) => {
    if (auth.isLockedOut(request.ip)) return reply.code(429).send({ error: 'locked', message: 'Too many tries. Try again in 15 minutes.' });
    const b = request.body as { username?: unknown; password?: unknown } | null;
    const username = typeof b?.username === 'string' ? b.username.trim() : '';
    const password = typeof b?.password === 'string' ? b.password : '';
    if (password.length < 8 || password.length > 200) return reply.code(400).send({ error: 'weak-password', message: 'Use a password of at least 8 characters.' });
    const token = (request.params as { token: string }).token;
    const forAccount = auth.inviteOf(token)?.userId ?? null;
    if (forAccount === null && (username.length < 1 || username.length > 64)) return reply.code(400).send({ error: 'invalid', message: 'Choose a username.' });
    const user = await auth.acceptInvite(token, username, password);
    if (user === null) {
      auth.recordFailure(request.ip);
      return reply.code(404).send({ error: 'invalid-link', message: 'This link has been used or has expired. Ask for a new one.' });
    }
    if (user === 'taken') return reply.code(409).send({ error: 'taken', message: 'Someone already has that username. Choose another.' });
    const { token: session, expiresAt } = auth.createSession(user.id, request.ip, request.headers['user-agent']);
    setSessionCookie(request, reply, session, expiresAt);
    request.log.info({ context: 'auth' }, forAccount === null ? `Viewer "${user.username}" joined` : `"${user.username}" chose a new password`);
    return reply.code(201).send({ username: user.username });
  });

  app.post('/api/v1/auth/apikey', async (request) => {
    request.log.info({ context: 'auth' }, 'API key regenerated');
    return { apiKey: auth.regenerateApiKey() };
  });
}
