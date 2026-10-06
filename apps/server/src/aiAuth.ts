import { createHash, createPublicKey, randomBytes, randomInt, timingSafeEqual, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import type { Role } from './access.js';
import { isLocalRequest, SESSION_COOKIE, type AuthService } from './auth.js';
import { claudePluginZip, pluginAddress } from './claudePlugin.js';
import type { Db } from './db/index.js';
import { APP_VERSION } from './env.js';
import { aiCalls, aiGuests, aiKeys, oauthClients, oauthCodes, oauthGrants, oauthTokens, users } from './db/schema.js';
import { escapeHtml, type NotificationService } from './notifications.js';
import type { SettingsService } from './settings.js';
import { SQUIRREL_SVG } from './squirrelLogo.js';

/**
 * Sign-in for Claude and other AI apps (0.55.0, D127, D128). Squirrelcade is its own OAuth 2.1 authorization server,
 * as the MCP authorization spec asks: resource and server metadata, PKCE (S256) on every request, tokens for this
 * Squirrelcade's /mcp only, refresh tokens rotated (a second use of one ends the connection), codes and tokens kept
 * only as SHA-256. People sign in with their Squirrelcade account, or as a guest: someone the owner listed by name and
 * email, who proves the email with a code (Cloudflare Access's, or one Squirrelcade emails). Apps name themselves with
 * a client metadata document (Claude) or register (dynamic registration), only for the callbacks the settings allow.
 */

/** The one scope: reading the collection. offline_access asks for refresh tokens (issued either way). */
export const AI_SCOPE = 'collection:read';
const SCOPES = [AI_SCOPE, 'offline_access'];
const ACCESS_SECONDS = 3600;
const REFRESH_DAYS = 30;
const CODE_MS = 10 * 60_000;
const REQUEST_MS = 15 * 60_000;
const DOCUMENT_MS = 24 * 3600_000;
const MAX_REGISTERED = 200;

/** Who a connection belongs to: an account, or a guest the owner listed. */
export type AiPerson = { kind: 'account'; userId: number; username: string; role: Role } | { kind: 'guest'; guestId: number; name: string; email: string };

/** How a person is named in the list of calls and connections. */
export const personLabel = (p: AiPerson) => (p.kind === 'account' ? p.username : `${p.name} (guest)`);

/** An app that may sign people in. */
export interface AiClient {
  id: string;
  kind: 'document' | 'registered';
  name: string;
  redirectUris: string[];
  secretHash: string | null;
}

/** A token's connection (or a key's), as /mcp sees it. */
export interface AiCaller {
  /** The sign-in's connection, or null for a key. */
  grantId: number | null;
  /** The key, for a call with one. */
  keyId: number | null;
  person: AiPerson;
  client: { id: string; name: string };
  scope: string[];
}

/** One connection for Settings › Claude and AI apps. */
export interface AiConnection {
  id: number;
  who: string;
  guest: boolean;
  app: string;
  /** Where its sign-in went back to (claude.ai, localhost). */
  host: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  calls: number;
}

/** A sign-in on its way: what the app asked, until the person says yes or no (in memory: a restart asks again). */
interface Pending {
  id: string;
  csrf: string;
  client: AiClient;
  redirectUri: string;
  state: string | null;
  challenge: string;
  scope: string;
  expiresAt: number;
  /** A guest proving their email with a code Squirrelcade sent. */
  guest?: { email: string; codeHash: string | null; codeExpiresAt: number; tries: number; sends: number; verifiedId: number | null };
}

/** Why a sign-in request can't go on, said on the page (the app's address isn't trusted yet, so no redirect). */
class PageError extends Error {}

/** An OAuth error for the app (token, registration): its code and a description. */
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    description: string,
    readonly status = 400,
  ) {
    super(description);
  }
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');
/** What a key starts with, so /mcp tells keys from sign-in tokens. */
const KEY_PREFIX = 'sqk_';
const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
const sameText = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};
const nowIso = () => new Date().toISOString();
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);
/** The cookie that ties a waiting sign-in to the browser that started it (another browser can't finish it). */
export const AI_REQUEST_COOKIE = 'squirrelcade_ai_request';
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/;

/** Whether a redirect address is a loopback one (an app on the person's own computer). */
function loopback(url: URL): boolean {
  return url.protocol === 'http:' && LOOPBACK.has(url.hostname === '::1' ? '[::1]' : url.hostname);
}

export class AiAuthService {
  private readonly pending = new Map<string, Pending>();
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private accessKeys: { team: string; at: number; keys: Map<string, KeyObject> } | null = null;
  private cleanedAt = 0;

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly auth: AuthService,
    private readonly notifications: NotificationService,
    private readonly log: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /** This Squirrelcade's address (Settings › General), without a trailing slash: https, or http on this computer. */
  base(): string | null {
    const raw = this.settings.get('general.publicUrl').trim().replace(/\/+$/, '');
    if (!raw) return null;
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' || loopback(url)) return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return null;
    }
    return null;
  }

  /** The connector is on (Settings › Claude and AI apps): keys work at /mcp. */
  on(): boolean {
    return this.settings.get('ai.enabled');
  }

  /** The sign-in for apps on the internet is on too, with an https address to be found at. */
  signInOn(): boolean {
    return this.on() && this.settings.get('ai.internet') && this.base() !== null;
  }

  /** The connector's address: the resource tokens are for. */
  resource(): string {
    return `${this.base()}/mcp`;
  }

  protectedResourceMetadata() {
    const base = this.base()!;
    return {
      resource: this.resource(),
      authorization_servers: [base],
      scopes_supported: [AI_SCOPE],
      bearer_methods_supported: ['header'],
      resource_name: this.settings.get('general.instanceName') || 'Squirrelcade',
    };
  }

  authorizationServerMetadata() {
    const base = this.base()!;
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ['code'],
      response_modes_supported: ['query'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      revocation_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: SCOPES,
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    };
  }

  /** The 401's header: where the resource metadata is and the scope to ask for (with the sign-in on), or just the realm. */
  challenge(error?: { code: 'invalid_token' | 'insufficient_scope'; description: string }): string {
    const parts = this.signInOn() ? [`resource_metadata="${this.base()}/.well-known/oauth-protected-resource/mcp"`, `scope="${AI_SCOPE}"`] : ['realm="Squirrelcade"'];
    if (error) parts.push(`error="${error.code}"`, `error_description="${error.description.replace(/"/g, "'")}"`);
    return `Bearer ${parts.join(', ')}`;
  }

  /** Counts a request against a limit per window (sign-in pages, tokens, registrations); false once past it. */
  hit(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + windowMs });
      if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.resetAt <= now) this.hits.delete(k);
      return true;
    }
    h.count++;
    return h.count <= limit;
  }

  /**
   * Whether a browser page may call the connector and its sign-in addresses: this Squirrelcade's own, the allowed
   * apps' (https), and pages on this computer when apps there are allowed (MCP Inspector). Others are refused.
   */
  originAllowed(origin: string): boolean {
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      return false;
    }
    const base = this.base();
    if (base && url.origin === new URL(base).origin) return true;
    if (url.protocol === 'https:' && this.allowedHosts().includes(url.hostname.toLowerCase())) return true;
    return loopback(url) && this.settings.get('ai.allowLocalApps');
  }

  /** The CORS headers for an allowed page (no cookies: tokens are sent by the app itself). */
  corsHeaders(origin: string): Record<string, string> {
    return {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID',
      'Access-Control-Expose-Headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
      'Access-Control-Max-Age': '600',
      Vary: 'Origin',
    };
  }

  /** The newest calls, for Settings › Claude and AI apps. */
  calls(limit = 100) {
    return this.db.select().from(aiCalls).orderBy(desc(aiCalls.id)).limit(limit).all();
  }

  // ---- Apps ----

  private allowedHosts(): string[] {
    return this.settings.get('ai.clientHosts').map((h) => h.trim().toLowerCase()).filter(Boolean);
  }

  /** Whether an app may send people back to this address: one it named, on an allowed host, or a loopback one if allowed. */
  redirectAllowed(client: AiClient, uri: string): boolean {
    let asked: URL;
    try {
      asked = new URL(uri);
    } catch {
      return false;
    }
    if (asked.hash) return false;
    if (loopback(asked)) {
      if (!this.settings.get('ai.allowLocalApps')) return false;
      // A loopback address matches whatever its port (RFC 8252), localhost and 127.0.0.1 alike.
      return client.redirectUris.some((r) => {
        try {
          const named = new URL(r);
          return loopback(named) && named.pathname === asked.pathname;
        } catch {
          return false;
        }
      });
    }
    return asked.protocol === 'https:' && this.allowedHosts().includes(asked.hostname.toLowerCase()) && client.redirectUris.includes(uri);
  }

  private rowToClient(row: typeof oauthClients.$inferSelect): AiClient {
    return { id: row.id, kind: row.kind as AiClient['kind'], name: row.name, redirectUris: JSON.parse(row.redirectUris) as string[], secretHash: row.secretHash };
  }

  /** An app by its client_id: one that registered, or one named by its metadata document (read again after a day). */
  async client(clientId: string): Promise<AiClient | null> {
    if (!clientId || clientId.length > 500) return null;
    const row = this.db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get();
    if (row && (row.kind === 'registered' || (row.fetchedAt && Date.now() - Date.parse(row.fetchedAt) < DOCUMENT_MS))) return this.rowToClient(row);
    let url: URL;
    try {
      url = new URL(clientId);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || url.hash || url.username || url.pathname === '/' || !this.allowedHosts().includes(url.hostname.toLowerCase())) return null;
    try {
      const res = await this.fetchImpl(clientId, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`${res.status}`);
      const text = await res.text();
      if (text.length > 64_000) throw new Error('too large');
      const doc = JSON.parse(text) as { client_id?: unknown; client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown };
      if (doc.client_id !== clientId) throw new Error('its client_id is another address');
      if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0 || doc.redirect_uris.some((r) => typeof r !== 'string' || r.length > 500)) throw new Error('no redirect_uris');
      if (doc.token_endpoint_auth_method !== undefined && doc.token_endpoint_auth_method !== 'none') throw new Error('not a public client');
      const name = typeof doc.client_name === 'string' && doc.client_name.trim() ? doc.client_name.trim().slice(0, 100) : url.hostname;
      const values = { kind: 'document', name, redirectUris: JSON.stringify((doc.redirect_uris as string[]).slice(0, 20)), secretHash: null, fetchedAt: nowIso() };
      this.db
        .insert(oauthClients)
        .values({ id: clientId, createdAt: nowIso(), ...values })
        .onConflictDoUpdate({ target: oauthClients.id, set: values })
        .run();
      return this.rowToClient(this.db.select().from(oauthClients).where(eq(oauthClients.id, clientId)).get()!);
    } catch (err) {
      this.log.warn({ context: 'ai' }, `Couldn't read the app description at ${clientId}: ${err instanceof Error ? err.message : String(err)}`);
      // A description read before still names the app while its address is down.
      return row ? this.rowToClient(row) : null;
    }
  }

  /** Dynamic client registration (RFC 7591), for the callbacks the settings allow. */
  register(body: unknown): Record<string, unknown> {
    const b = (body ?? {}) as { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown; grant_types?: unknown; response_types?: unknown };
    if (!Array.isArray(b.redirect_uris) || b.redirect_uris.length === 0 || b.redirect_uris.length > 10 || b.redirect_uris.some((r) => typeof r !== 'string' || r.length > 500)) {
      throw new OAuthError('invalid_redirect_uri', 'Give one to ten redirect_uris.');
    }
    const uris = b.redirect_uris as string[];
    const probe: AiClient = { id: '', kind: 'registered', name: '', redirectUris: uris, secretHash: null };
    const refused = uris.find((u) => !this.redirectAllowed(probe, u));
    if (refused) throw new OAuthError('invalid_redirect_uri', `This Squirrelcade doesn't let apps sign in with ${refused} (Settings › Claude and AI apps › Apps that may connect).`);
    const method = b.token_endpoint_auth_method ?? 'client_secret_basic';
    if (method !== 'none' && method !== 'client_secret_post' && method !== 'client_secret_basic') throw new OAuthError('invalid_client_metadata', 'token_endpoint_auth_method is none, client_secret_post or client_secret_basic.');
    const grants = b.grant_types ?? ['authorization_code'];
    if (!Array.isArray(grants) || !grants.includes('authorization_code') || grants.some((g) => g !== 'authorization_code' && g !== 'refresh_token')) {
      throw new OAuthError('invalid_client_metadata', 'grant_types are authorization_code and refresh_token.');
    }
    const responses = b.response_types ?? ['code'];
    if (!Array.isArray(responses) || responses.some((r) => r !== 'code')) throw new OAuthError('invalid_client_metadata', 'response_types is code.');
    const name = typeof b.client_name === 'string' && b.client_name.trim() ? b.client_name.trim().slice(0, 100) : 'An app';
    const id = `sq_${token(18)}`;
    const secret = method === 'none' ? null : token(32);
    const createdAt = nowIso();
    this.db.insert(oauthClients).values({ id, kind: 'registered', name, redirectUris: JSON.stringify(uris), secretHash: secret ? sha256(secret) : null, createdAt, fetchedAt: null }).run();
    this.trimRegistered();
    this.log.info({ context: 'ai' }, `App registered: ${name}`);
    return {
      client_id: id,
      client_id_issued_at: Math.floor(Date.parse(createdAt) / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: grants,
      response_types: ['code'],
      token_endpoint_auth_method: method,
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    };
  }

  /** Registered apps past the limit go, the oldest without a connection first. */
  private trimRegistered(): void {
    const registered = this.db.select({ id: oauthClients.id }).from(oauthClients).where(eq(oauthClients.kind, 'registered')).orderBy(asc(oauthClients.createdAt)).all();
    if (registered.length <= MAX_REGISTERED) return;
    const connected = new Set(this.db.select({ clientId: oauthGrants.clientId }).from(oauthGrants).where(isNull(oauthGrants.revokedAt)).all().map((g) => g.clientId));
    const extra = registered.filter((r) => !connected.has(r.id)).slice(0, registered.length - MAX_REGISTERED);
    if (extra.length > 0) this.db.delete(oauthClients).where(inArray(oauthClients.id, extra.map((r) => r.id))).run();
  }

  // ---- Guests ----

  guests(): { id: number; name: string; email: string; createdAt: string; connections: number }[] {
    const open = new Map<number, number>();
    for (const g of this.db.select({ guestId: oauthGrants.guestId }).from(oauthGrants).where(and(isNull(oauthGrants.revokedAt), isNotNull(oauthGrants.guestId))).all()) {
      open.set(g.guestId!, (open.get(g.guestId!) ?? 0) + 1);
    }
    return this.db
      .select()
      .from(aiGuests)
      .orderBy(asc(aiGuests.name))
      .all()
      .map((g) => ({ ...g, connections: open.get(g.id) ?? 0 }));
  }

  addGuest(name: unknown, email: unknown): { id: number; name: string; email: string } {
    const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!n || n.length > 60) throw new OAuthError('invalid', 'Give the guest a name (up to 60 characters).');
    if (!EMAIL.test(e)) throw new OAuthError('invalid', 'Give the email address they sign in with.');
    if (this.db.select({ id: aiGuests.id }).from(aiGuests).where(eq(aiGuests.email, e)).get()) throw new OAuthError('taken', 'That email is on the guest list already.');
    const row = this.db.insert(aiGuests).values({ name: n, email: e, createdAt: nowIso() }).returning().get();
    this.log.info({ context: 'ai' }, `Guest added: ${n}`);
    return { id: row.id, name: row.name, email: row.email };
  }

  /** Takes a guest off the list; their connections end with them. */
  removeGuest(id: number): boolean {
    const removed = this.db.delete(aiGuests).where(eq(aiGuests.id, id)).run().changes > 0;
    if (removed) this.log.info({ context: 'ai' }, `Guest ${id} removed`);
    return removed;
  }

  private guestByEmail(email: string) {
    return this.db.select().from(aiGuests).where(eq(aiGuests.email, email.toLowerCase())).get() ?? null;
  }

  // ---- Who's asking ----

  /** Whether an account may connect (Settings › Claude and AI apps › Who can connect). */
  private accountMay(role: Role): boolean {
    return role === 'owner' || this.settings.get('ai.whoCanConnect') === 'everyone';
  }

  /** The account signed in to Squirrelcade in this browser, if any. */
  private sessionPerson(request: FastifyRequest): AiPerson | null {
    const cookie = request.cookies[SESSION_COOKIE];
    const session = cookie ? this.auth.findSession(cookie) : null;
    return session ? { kind: 'account', userId: session.userId, username: session.username, role: session.role } : null;
  }

  /**
   * The email Cloudflare Access vouches for (its signed token in Cf-Access-Jwt-Assertion, checked against the team's
   * keys and the application's audience tag), when Settings › Claude and AI apps names them.
   */
  async accessEmail(request: FastifyRequest): Promise<string | null> {
    const team = this.settings.get('ai.accessTeam').trim().replace(/\/+$/, '');
    const aud = this.settings.get('ai.accessAud').trim();
    const jwt = request.headers['cf-access-jwt-assertion'];
    if (!team || !aud || typeof jwt !== 'string') return null;
    const [h, p, s] = jwt.split('.');
    if (!h || !p || !s) return null;
    try {
      const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as { alg?: string; kid?: string };
      if (header.alg !== 'RS256' || !header.kid) return null;
      const key = await this.accessKey(team, header.kid);
      if (!key || !verifySignature('RSA-SHA256', Buffer.from(`${h}.${p}`), key, Buffer.from(s, 'base64url'))) return null;
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as { iss?: string; aud?: string | string[]; exp?: number; nbf?: number; email?: string };
      const now = Date.now() / 1000;
      const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (claims.iss !== team || !audiences.includes(aud) || !claims.exp || claims.exp < now || (claims.nbf && claims.nbf > now + 60)) return null;
      return typeof claims.email === 'string' && EMAIL.test(claims.email) ? claims.email.toLowerCase() : null;
    } catch {
      return null;
    }
  }

  private async accessKey(team: string, kid: string): Promise<KeyObject | null> {
    const fresh = this.accessKeys && this.accessKeys.team === team && Date.now() - this.accessKeys.at < 3600_000;
    if (fresh && this.accessKeys!.keys.has(kid)) return this.accessKeys!.keys.get(kid)!;
    // A key not seen yet: read the team's keys again, at most once a minute.
    if (this.accessKeys && this.accessKeys.team === team && Date.now() - this.accessKeys.at < 60_000) return null;
    const res = await this.fetchImpl(`${team}/cdn-cgi/access/certs`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const keys = new Map<string, KeyObject>();
    for (const k of body.keys ?? []) if (k.kid && k.kty === 'RSA') keys.set(k.kid, createPublicKey({ key: k, format: 'jwk' }));
    this.accessKeys = { team, at: Date.now(), keys };
    return keys.get(kid) ?? null;
  }

  private accessOn(): boolean {
    return Boolean(this.settings.get('ai.accessTeam').trim() && this.settings.get('ai.accessAud').trim());
  }

  // ---- The sign-in page ----

  /**
   * GET /oauth/authorize: checks the app and where it sends people back before anything else (a wrong one gets a page,
   * never a redirect), then the rest (errors go back to the app), and keeps the request for the person's answer.
   */
  async start(query: Record<string, string | undefined>): Promise<{ pending: Pending } | { redirect: string }> {
    const clientId = query.client_id ?? '';
    const client = await this.client(clientId);
    if (!client) throw new PageError("This app isn't one this Squirrelcade lets in. If it should be, its address goes in Settings › Claude and AI apps › Apps that may connect.");
    const redirectUri = query.redirect_uri ?? '';
    if (!redirectUri || !this.redirectAllowed(client, redirectUri)) throw new PageError(`${client.name} asked to send you back to an address it didn't register, so this sign-in stops here.`);
    const back = (error: string, description: string) => ({ redirect: this.withParams(redirectUri, { error, error_description: description, state: query.state ?? null, iss: this.base() }) });
    if (query.response_type !== 'code') return back('unsupported_response_type', 'response_type is code.');
    if (!query.code_challenge || query.code_challenge_method !== 'S256' || !/^[A-Za-z0-9\-_]{43}$/.test(query.code_challenge)) return back('invalid_request', 'PKCE with S256 is required.');
    const asked = (query.scope ?? AI_SCOPE).split(' ').filter(Boolean);
    if (asked.some((s) => !SCOPES.includes(s))) return back('invalid_scope', `Scopes are ${SCOPES.join(' and ')}.`);
    if (query.resource !== undefined && query.resource.replace(/\/+$/, '') !== this.resource()) return back('invalid_target', `Tokens here are for ${this.resource()}.`);
    const scope = [AI_SCOPE, ...(asked.includes('offline_access') ? ['offline_access'] : [])].join(' ');
    const now = Date.now();
    for (const [k, v] of this.pending) if (v.expiresAt <= now) this.pending.delete(k);
    if (this.pending.size > 1000) throw new PageError('Too many sign-ins are waiting. Try again in a few minutes.');
    const pending: Pending = { id: token(18), csrf: token(18), client, redirectUri, state: query.state ?? null, challenge: query.code_challenge, scope, expiresAt: now + REQUEST_MS };
    this.pending.set(pending.id, pending);
    return { pending };
  }

  private withParams(uri: string, params: Record<string, string | null>): string {
    const url = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v);
    return url.toString();
  }

  /** A sign-in still waiting for its answer, in the browser that started it. */
  waiting(id: unknown, request: FastifyRequest): Pending | undefined {
    const pending = typeof id === 'string' ? this.pending.get(id) : undefined;
    const mine = typeof id === 'string' && request.cookies[AI_REQUEST_COOKIE] === id;
    return pending && mine && pending.expiresAt > Date.now() ? pending : undefined;
  }

  /** Ends every connection of an account (its password changed). */
  endAccount(userId: number): void {
    for (const g of this.db.select({ id: oauthGrants.id }).from(oauthGrants).where(and(eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt))).all()) {
      this.endGrant(g.id, 'its password changed');
    }
  }

  /** Who this sign-in is for: the signed-in account, the guest Access vouches for, or the guest who typed their code. */
  private async person(request: FastifyRequest, pending: Pending): Promise<{ person: AiPerson | null; refused?: string; email?: string }> {
    const account = this.sessionPerson(request);
    if (account && account.kind === 'account') {
      return this.accountMay(account.role) ? { person: account } : { person: null, refused: `Only the owner can connect AI apps to this Squirrelcade (you're signed in as ${account.username}).` };
    }
    const email = await this.accessEmail(request);
    if (email) {
      const guest = this.guestByEmail(email);
      return guest ? { person: { kind: 'guest', guestId: guest.id, name: guest.name, email: guest.email } } : { person: null, refused: `${email} isn't on this Squirrelcade's guest list. Ask its owner to add you.`, email };
    }
    const verified = pending.guest?.verifiedId;
    if (verified) {
      const guest = this.db.select().from(aiGuests).where(eq(aiGuests.id, verified)).get();
      if (guest) return { person: { kind: 'guest', guestId: guest.id, name: guest.name, email: guest.email } };
    }
    return { person: null };
  }

  /** The sign-in page for a request: who's asking and what for, with Allow and Deny, or how to say who you are. */
  async page(request: FastifyRequest, pending: Pending, note?: string): Promise<string> {
    const { person, refused } = await this.person(request, pending);
    const host = new URL(pending.redirectUri).host;
    const instance = escapeHtml(this.settings.get('general.instanceName') || 'Squirrelcade');
    const app = escapeHtml(pending.client.name);
    const hidden = `<input type="hidden" name="request" value="${pending.id}"><input type="hidden" name="csrf" value="${pending.csrf}">`;
    const deny = `<form method="post" action="/oauth/authorize">${hidden}<button class="quiet" name="action" value="deny">${person ? 'Deny' : 'Cancel'}</button></form>`;
    const local = loopback(new URL(pending.redirectUri));
    const parts: string[] = [`<h1>Connect ${app} to ${instance}?</h1>`];
    if (note) parts.push(`<p class="note">${escapeHtml(note)}</p>`);
    if (person) {
      const paid = person.kind === 'account' && this.settings.get('ai.sharePaid');
      const notes = person.kind === 'account' && this.settings.get('ai.shareNotes');
      parts.push(
        `<p>${app} wants to <strong>read</strong> ${person.kind === 'guest' ? 'the' : 'your'} collection: games, copies and their condition, consoles and the PC library${paid || notes ? `, ${[paid && 'prices paid', notes && 'notes'].filter(Boolean).join(' and ')}` : ''}. It can't change anything.</p>`,
        `<dl><dt>Signed in as</dt><dd>${escapeHtml(personLabel(person))}${person.kind === 'guest' ? ` · ${escapeHtml(person.email)}` : ''}</dd><dt>Sends you back to</dt><dd>${escapeHtml(host)}</dd></dl>`,
      );
      if (local) parts.push('<p class="note">That address is an app on this computer. Allow it only if you just started it (Claude Code, MCP Inspector).</p>');
      parts.push(`<div class="row"><form method="post" action="/oauth/authorize">${hidden}<button name="action" value="allow">Allow</button></form>${deny}</div>`);
    } else if (refused) {
      parts.push(`<p>${escapeHtml(refused)}</p>`, `<div class="row">${deny}</div>`);
    } else {
      const next = `/ai-sign-in?next=${encodeURIComponent(`/oauth/authorize?request=${pending.id}`)}`;
      parts.push(`<p>Sign in to Squirrelcade first, then come back to this page.</p><div class="row"><a class="button" href="${next}">Sign in to Squirrelcade</a>${deny}</div>`);
      // Guests without Cloudflare Access in front prove their email with a code Squirrelcade sends.
      if (!this.accessOn() && this.notifications.canEmail() && this.db.select({ id: aiGuests.id }).from(aiGuests).limit(1).get()) {
        if (pending.guest?.codeHash) {
          parts.push(
            `<h2>The code from your email</h2><form method="post" action="/oauth/authorize" class="stack">${hidden}<label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><div class="row"><button name="action" value="verify-code">Continue</button><button class="quiet" name="action" value="send-code">Send another</button></div><input type="hidden" name="email" value="${escapeHtml(pending.guest.email)}"></form>`,
          );
        } else {
          parts.push(
            `<h2>A guest?</h2><form method="post" action="/oauth/authorize" class="stack">${hidden}<label>Your email <input type="email" name="email" autocomplete="email" required maxlength="200"></label><div class="row"><button name="action" value="send-code">Email me a code</button></div></form>`,
          );
        }
      }
    }
    return pageHtml(`Connect ${pending.client.name}`, parts.join(''));
  }

  /** The person's answer on the sign-in page (and a guest's code): a redirect back to the app, or the page again. */
  async answer(request: FastifyRequest, body: Record<string, unknown>): Promise<{ redirect: string } | { html: string; status?: number }> {
    const id = typeof body.request === 'string' ? body.request : '';
    const pending = this.waiting(id, request);
    if (!pending) return { html: pageHtml('Start again', '<h1>Start again</h1><p>This sign-in waited too long, or was started in another browser. Start it again from the app.</p>'), status: 400 };
    if (typeof body.csrf !== 'string' || !sameText(body.csrf, pending.csrf)) return { html: pageHtml('Start again', '<h1>Start again</h1><p>This page is out of date. Start the sign-in again from the app.</p>'), status: 400 };
    const action = body.action;
    if (action === 'deny') {
      this.pending.delete(id);
      return { redirect: this.withParams(pending.redirectUri, { error: 'access_denied', error_description: 'The sign-in was cancelled.', state: pending.state, iss: this.base() }) };
    }
    if (action === 'send-code') {
      const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!EMAIL.test(email)) return { html: await this.page(request, pending, 'Give your email address.') };
      if ((pending.guest?.sends ?? 0) >= 3 || !this.hit(`code:${request.ip}`, 10, 3600_000)) return { html: await this.page(request, pending, 'Too many codes asked for. Try again in an hour.'), status: 429 };
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      pending.guest = { email, codeHash: sha256(`${pending.id}:${code}`), codeExpiresAt: Date.now() + CODE_MS, tries: 0, sends: (pending.guest?.sends ?? 0) + 1, verifiedId: null };
      const guest = this.guestByEmail(email);
      // The same answer whether or not the email is on the list: the page never says who's a guest.
      if (guest) {
        const instance = this.settings.get('general.instanceName') || 'Squirrelcade';
        this.notifications
          .emailTo(email, 'your sign-in code', `Your code to connect ${pending.client.name} to ${instance} is ${code}.\n\nIt works for 10 minutes. If you didn't ask for it, ignore this email.`)
          .catch((err: unknown) => this.log.warn({ context: 'ai' }, `A guest's code couldn't be emailed: ${err instanceof Error ? err.message : String(err)}`));
      }
      return { html: await this.page(request, pending, `If ${email} is on the guest list, a code is on its way. It works for 10 minutes.`) };
    }
    if (action === 'verify-code') {
      const g = pending.guest;
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      if (!g?.codeHash || g.codeExpiresAt <= Date.now() || g.tries >= 5) return { html: await this.page(request, pending, 'That code has expired. Ask for another.'), status: 400 };
      g.tries++;
      const guest = this.guestByEmail(g.email);
      if (!/^\d{6}$/.test(code) || !sameText(sha256(`${pending.id}:${code}`), g.codeHash) || !guest) return { html: await this.page(request, pending, "That code isn't the one we sent."), status: 400 };
      g.verifiedId = guest.id;
      g.codeHash = null;
      return { html: await this.page(request, pending) };
    }
    if (action !== 'allow') return { html: await this.page(request, pending), status: 400 };
    const { person } = await this.person(request, pending);
    if (!person) return { html: await this.page(request, pending, 'Say who you are first.'), status: 400 };
    this.pending.delete(id);
    const grantId = this.grant(person, pending.client, pending.scope);
    const code = token(32);
    this.db.insert(oauthCodes).values({ hash: sha256(code), grantId, redirectUri: pending.redirectUri, challenge: pending.challenge, expiresAt: new Date(Date.now() + CODE_MS).toISOString() }).run();
    this.log.info({ context: 'ai' }, `${personLabel(person)} connected ${pending.client.name}`);
    return { redirect: this.withParams(pending.redirectUri, { code, state: pending.state, iss: this.base() }) };
  }

  /** A new connection; the person's earlier one with the same app ends (a reconnect replaces it). */
  private grant(person: AiPerson, client: AiClient, scope: string): number {
    const mine = person.kind === 'account' ? eq(oauthGrants.userId, person.userId) : eq(oauthGrants.guestId, person.guestId);
    this.db
      .update(oauthGrants)
      .set({ revokedAt: nowIso() })
      .where(and(mine, eq(oauthGrants.clientId, client.id), isNull(oauthGrants.revokedAt)))
      .run();
    return this.db
      .insert(oauthGrants)
      .values({ clientId: client.id, userId: person.kind === 'account' ? person.userId : null, guestId: person.kind === 'guest' ? person.guestId : null, scope, resource: this.resource(), createdAt: nowIso() })
      .returning({ id: oauthGrants.id })
      .get().id;
  }

  // ---- Tokens ----

  /** The app's client authentication: Basic, or client_id (and client_secret) in the body. */
  private async authenticate(request: FastifyRequest, body: Record<string, unknown>): Promise<AiClient> {
    let id = typeof body.client_id === 'string' ? body.client_id : '';
    let secret = typeof body.client_secret === 'string' ? body.client_secret : null;
    const basic = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? '');
    if (basic) {
      const [u, p] = Buffer.from(basic[1]!, 'base64').toString().split(':');
      id = decodeURIComponent(u ?? '');
      secret = decodeURIComponent(p ?? '');
    }
    const client = await this.client(id);
    if (!client) throw new OAuthError('invalid_client', 'Unknown client_id.', 401);
    if (client.secretHash && (!secret || !sameText(sha256(secret), client.secretHash))) throw new OAuthError('invalid_client', 'The client secret is wrong.', 401);
    return client;
  }

  /** POST /oauth/token: a code for tokens (PKCE checked), or a refresh token for new ones. */
  async token(request: FastifyRequest, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const client = await this.authenticate(request, body);
    const resource = typeof body.resource === 'string' ? body.resource.replace(/\/+$/, '') : null;
    if (resource !== null && resource !== this.resource()) throw new OAuthError('invalid_target', `Tokens here are for ${this.resource()}.`);
    if (body.grant_type === 'authorization_code') {
      const code = typeof body.code === 'string' ? body.code : '';
      const row = this.db.select().from(oauthCodes).where(eq(oauthCodes.hash, sha256(code))).get();
      const grant = row ? this.db.select().from(oauthGrants).where(eq(oauthGrants.id, row.grantId)).get() : undefined;
      if (!row || !grant || grant.clientId !== client.id) throw new OAuthError('invalid_grant', 'The code is not valid.');
      if (row.usedAt) {
        // A code used twice: someone else may have it, so the connection ends.
        this.endGrant(grant.id, 'a sign-in code was used twice');
        throw new OAuthError('invalid_grant', 'The code was used already.');
      }
      if (row.expiresAt <= nowIso() || grant.revokedAt) throw new OAuthError('invalid_grant', 'The code has expired.');
      if (typeof body.redirect_uri !== 'string' || body.redirect_uri !== row.redirectUri) throw new OAuthError('invalid_grant', 'redirect_uri is not the one the code was given for.');
      const verifier = typeof body.code_verifier === 'string' ? body.code_verifier : '';
      if (!VERIFIER.test(verifier) || createHash('sha256').update(verifier).digest('base64url') !== row.challenge) throw new OAuthError('invalid_grant', 'The code_verifier does not match.');
      this.db.update(oauthCodes).set({ usedAt: nowIso() }).where(eq(oauthCodes.hash, row.hash)).run();
      return this.issue(grant.id, grant.scope);
    }
    if (body.grant_type === 'refresh_token') {
      const given = typeof body.refresh_token === 'string' ? body.refresh_token : '';
      const row = this.db.select().from(oauthTokens).where(and(eq(oauthTokens.hash, sha256(given)), eq(oauthTokens.kind, 'refresh'))).get();
      const grant = row ? this.db.select().from(oauthGrants).where(eq(oauthGrants.id, row.grantId)).get() : undefined;
      if (!row || !grant || grant.clientId !== client.id) throw new OAuthError('invalid_grant', 'The refresh token is not valid.');
      if (row.usedAt) {
        this.endGrant(grant.id, 'a refresh token was used twice');
        throw new OAuthError('invalid_grant', 'The refresh token was used already.');
      }
      if (row.expiresAt <= nowIso() || grant.revokedAt || !this.personOf(grant)) throw new OAuthError('invalid_grant', 'The refresh token has expired.');
      this.db.update(oauthTokens).set({ usedAt: nowIso() }).where(eq(oauthTokens.hash, row.hash)).run();
      return this.issue(grant.id, grant.scope);
    }
    throw new OAuthError('unsupported_grant_type', 'grant_type is authorization_code or refresh_token.');
  }

  private issue(grantId: number, scope: string): Record<string, unknown> {
    const access = token(32);
    const refresh = token(32);
    const now = Date.now();
    this.db
      .insert(oauthTokens)
      .values([
        { hash: sha256(access), grantId, kind: 'access', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + ACCESS_SECONDS * 1000).toISOString() },
        { hash: sha256(refresh), grantId, kind: 'refresh', createdAt: new Date(now).toISOString(), expiresAt: new Date(now + REFRESH_DAYS * 86_400_000).toISOString() },
      ])
      .run();
    this.db.update(oauthGrants).set({ lastUsedAt: new Date(now).toISOString() }).where(eq(oauthGrants.id, grantId)).run();
    this.cleanup();
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_SECONDS, refresh_token: refresh, scope };
  }

  /** POST /oauth/revoke (RFC 7009): a token given up; a refresh token takes its connection with it. */
  async revoke(request: FastifyRequest, body: Record<string, unknown>): Promise<void> {
    const client = await this.authenticate(request, body);
    const given = typeof body.token === 'string' ? body.token : '';
    const row = this.db.select().from(oauthTokens).where(eq(oauthTokens.hash, sha256(given))).get();
    if (!row) return;
    const grant = this.db.select().from(oauthGrants).where(eq(oauthGrants.id, row.grantId)).get();
    if (!grant || grant.clientId !== client.id) return;
    if (row.kind === 'refresh') this.endGrant(grant.id, 'the app gave it up');
    else this.db.delete(oauthTokens).where(eq(oauthTokens.hash, row.hash)).run();
  }

  private endGrant(id: number, why: string): void {
    this.db.update(oauthGrants).set({ revokedAt: nowIso() }).where(and(eq(oauthGrants.id, id), isNull(oauthGrants.revokedAt))).run();
    this.db.delete(oauthTokens).where(eq(oauthTokens.grantId, id)).run();
    this.log.info({ context: 'ai' }, `Connection ${id} ended: ${why}`);
  }

  /** The person behind a connection, while they may still connect (a viewer, once only the owner may, can't). */
  private personOf(grant: typeof oauthGrants.$inferSelect): AiPerson | null {
    if (grant.userId !== null) {
      const u = this.db.select({ id: users.id, username: users.username, role: users.role }).from(users).where(eq(users.id, grant.userId)).get();
      return u && this.accountMay(u.role as Role) ? { kind: 'account', userId: u.id, username: u.username, role: u.role as Role } : null;
    }
    if (grant.guestId !== null) {
      const g = this.db.select().from(aiGuests).where(eq(aiGuests.id, grant.guestId)).get();
      return g ? { kind: 'guest', guestId: g.id, name: g.name, email: g.email } : null;
    }
    return null;
  }

  /**
   * A bearer token's caller for /mcp, or why not: a 401's error, a 403 for a missing scope, or a 403 with a message for a
   * key used from outside the home network. A key ("sqk_...") answers as its account; anything else is a sign-in's token.
   */
  caller(authorization: string | undefined, request: FastifyRequest): AiCaller | { status: 401 | 403; error?: { code: 'invalid_token' | 'insufficient_scope'; description: string }; message?: string } {
    const m = /^Bearer\s+([A-Za-z0-9\-._~+/]+=*)$/i.exec(authorization ?? '');
    if (!m) return { status: 401 };
    if (m[1]!.startsWith(KEY_PREFIX)) return this.keyCaller(m[1]!, request);
    if (!this.signInOn()) return { status: 401, error: { code: 'invalid_token', description: 'Signing in from the internet is off here: use a key (Settings › Claude and AI apps).' } };
    const row = this.db.select().from(oauthTokens).where(and(eq(oauthTokens.hash, sha256(m[1]!)), eq(oauthTokens.kind, 'access'))).get();
    const grant = row ? this.db.select().from(oauthGrants).where(eq(oauthGrants.id, row.grantId)).get() : undefined;
    if (!row || !grant || grant.revokedAt) return { status: 401, error: { code: 'invalid_token', description: 'The access token is not valid.' } };
    if (row.expiresAt <= nowIso()) return { status: 401, error: { code: 'invalid_token', description: 'The access token has expired.' } };
    if (grant.resource !== this.resource()) return { status: 401, error: { code: 'invalid_token', description: 'The access token is for another address.' } };
    const person = this.personOf(grant);
    if (!person) return { status: 401, error: { code: 'invalid_token', description: 'This connection may no longer read the collection.' } };
    const scope = grant.scope.split(' ');
    if (!scope.includes(AI_SCOPE)) return { status: 403, error: { code: 'insufficient_scope', description: `The ${AI_SCOPE} scope is needed.` } };
    const client = this.db.select({ id: oauthClients.id, name: oauthClients.name }).from(oauthClients).where(eq(oauthClients.id, grant.clientId)).get();
    // lastUsedAt at most once a minute.
    if (!grant.lastUsedAt || Date.now() - Date.parse(grant.lastUsedAt) > 60_000) this.db.update(oauthGrants).set({ lastUsedAt: nowIso() }).where(eq(oauthGrants.id, grant.id)).run();
    return { grantId: grant.id, keyId: null, person, client: client ?? { id: grant.clientId, name: 'An app' }, scope };
  }

  /** A key's caller: its account, while the key stands and (by default) only from the home network. */
  private keyCaller(key: string, request: FastifyRequest): AiCaller | { status: 401 | 403; error?: { code: 'invalid_token'; description: string }; message?: string } {
    const row = this.db
      .select({ id: aiKeys.id, name: aiKeys.name, lastUsedAt: aiKeys.lastUsedAt, revokedAt: aiKeys.revokedAt, userId: users.id, username: users.username, role: users.role })
      .from(aiKeys)
      .innerJoin(users, eq(users.id, aiKeys.userId))
      .where(eq(aiKeys.hash, sha256(key)))
      .get();
    if (!row || row.revokedAt) return { status: 401, error: { code: 'invalid_token', description: 'The key is not valid.' } };
    if (this.settings.get('ai.keysFrom') !== 'anywhere' && !isLocalRequest(request)) {
      return { status: 403, message: 'Keys work from the home network only here (Settings › Claude and AI apps › Keys work from).' };
    }
    if (!row.lastUsedAt || Date.now() - Date.parse(row.lastUsedAt) > 60_000) this.db.update(aiKeys).set({ lastUsedAt: nowIso() }).where(eq(aiKeys.id, row.id)).run();
    return { grantId: null, keyId: row.id, person: { kind: 'account', userId: row.userId, username: row.username, role: row.role as Role }, client: { id: `key:${row.id}`, name: row.name }, scope: [AI_SCOPE] };
  }

  // ---- Keys for apps on the home network ----

  /** The keys not revoked, newest first, with their calls (never the keys themselves). */
  keys(): { id: number; name: string; username: string; createdAt: string; lastUsedAt: string | null; calls: number }[] {
    const calls = new Map(
      this.db
        .select({ keyId: aiCalls.keyId, n: sql<number>`count(*)` })
        .from(aiCalls)
        .where(isNotNull(aiCalls.keyId))
        .groupBy(aiCalls.keyId)
        .all()
        .map((r) => [r.keyId, r.n]),
    );
    return this.db
      .select({ id: aiKeys.id, name: aiKeys.name, username: users.username, createdAt: aiKeys.createdAt, lastUsedAt: aiKeys.lastUsedAt })
      .from(aiKeys)
      .innerJoin(users, eq(users.id, aiKeys.userId))
      .where(isNull(aiKeys.revokedAt))
      .orderBy(desc(aiKeys.id))
      .all()
      .map((k) => ({ ...k, calls: calls.get(k.id) ?? 0 }));
  }

  /** A new key for an account: the key itself is in this answer only (kept as its SHA-256). */
  makeKey(name: unknown, userId: number): { id: number; name: string; key: string; createdAt: string } {
    const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    if (!n || n.length > 60) throw new OAuthError('invalid', 'Name the key (what it is for), up to 60 characters.');
    if (this.keys().length >= 50) throw new OAuthError('invalid', 'That is 50 keys already: revoke one first.');
    const key = `${KEY_PREFIX}${token(32)}`;
    const createdAt = nowIso();
    const row = this.db.insert(aiKeys).values({ name: n, userId, hash: sha256(key), createdAt }).returning({ id: aiKeys.id }).get();
    this.log.info({ context: 'ai' }, `Key made: ${n}`);
    return { id: row.id, name: n, key, createdAt };
  }

  revokeKey(id: number): boolean {
    const revoked = this.db.update(aiKeys).set({ revokedAt: nowIso() }).where(and(eq(aiKeys.id, id), isNull(aiKeys.revokedAt))).run().changes > 0;
    if (revoked) this.log.info({ context: 'ai' }, `Key ${id} revoked`);
    return revoked;
  }

  // ---- Settings › Claude and AI apps ----

  connections(): AiConnection[] {
    const calls = new Map(
      this.db
        .select({ grantId: aiCalls.grantId, n: sql<number>`count(*)` })
        .from(aiCalls)
        .groupBy(aiCalls.grantId)
        .all()
        .map((r) => [r.grantId, r.n]),
    );
    const rows = this.db
      .select({ grant: oauthGrants, username: users.username, guestName: aiGuests.name, app: oauthClients.name, uris: oauthClients.redirectUris })
      .from(oauthGrants)
      .leftJoin(users, eq(users.id, oauthGrants.userId))
      .leftJoin(aiGuests, eq(aiGuests.id, oauthGrants.guestId))
      .leftJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .where(isNull(oauthGrants.revokedAt))
      .orderBy(desc(oauthGrants.createdAt))
      .all();
    const codes = new Map(this.db.select({ grantId: oauthCodes.grantId, uri: oauthCodes.redirectUri }).from(oauthCodes).all().map((c) => [c.grantId, c.uri]));
    return rows.map((r) => {
      const uri = codes.get(r.grant.id) ?? (r.uris ? (JSON.parse(r.uris) as string[])[0] : undefined);
      let host: string | null = null;
      try {
        host = uri ? new URL(uri).hostname : null;
      } catch {
        host = null;
      }
      return {
        id: r.grant.id,
        who: r.grant.guestId !== null ? `${r.guestName ?? 'A guest'} (guest)` : (r.username ?? 'An account'),
        guest: r.grant.guestId !== null,
        app: r.app ?? 'An app',
        host,
        createdAt: r.grant.createdAt,
        lastUsedAt: r.grant.lastUsedAt,
        calls: calls.get(r.grant.id) ?? 0,
      };
    });
  }

  disconnect(id: number): boolean {
    const open = this.db.select({ id: oauthGrants.id }).from(oauthGrants).where(and(eq(oauthGrants.id, id), isNull(oauthGrants.revokedAt))).get();
    if (!open) return false;
    this.endGrant(id, 'disconnected by the owner');
    return true;
  }

  /** Expired codes and tokens go, and connections ended a month ago (at most once an hour). */
  cleanup(force = false): void {
    if (!force && Date.now() - this.cleanedAt < 3600_000) return;
    this.cleanedAt = Date.now();
    const now = nowIso();
    this.db.delete(oauthCodes).where(lt(oauthCodes.expiresAt, now)).run();
    // Used refresh tokens stay until they expire: a second use of one is how a stolen one shows.
    this.db.delete(oauthTokens).where(lt(oauthTokens.expiresAt, now)).run();
    // A connection with no tokens left a day after it began is over (its app never came back, or let it lapse).
    const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
    this.db
      .update(oauthGrants)
      .set({ revokedAt: now })
      .where(and(isNull(oauthGrants.revokedAt), lt(oauthGrants.createdAt, dayAgo), sql`${oauthGrants.id} not in (select ${oauthTokens.grantId} from ${oauthTokens})`))
      .run();
    this.db.delete(oauthGrants).where(lt(oauthGrants.revokedAt, new Date(Date.now() - 30 * 86_400_000).toISOString())).run();
    this.db.delete(aiCalls).where(lt(aiCalls.at, new Date(Date.now() - this.settings.get('ai.logDays') * 86_400_000).toISOString())).run();
  }
}

/** The sign-in page around its content: the squirrel, the brand's colors, nothing loaded from elsewhere. */
function pageHtml(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>
:root{--bg:#f6f4ef;--card:#ffffff;--text:#1d1b18;--soft:#3d3832;--muted:#6b655d;--line:#e3ded4;--deep:#16392a;--deep-ink:#ffffff;--accent:#1e7546;--focus:#c27a3f}
@media (prefers-color-scheme:dark){:root{--bg:#111111;--card:#1d1d1d;--text:#f2efea;--soft:#cbc6be;--muted:#9e988f;--line:#383838;--deep:#16392a;--deep-ink:#ffffff;--accent:#5bd08e}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}
main{max-width:520px;margin:48px auto;padding:0 16px}.card{background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden}
.strip{display:flex;align-items:center;gap:10px;background:var(--deep);color:var(--deep-ink);padding:12px 20px;font-weight:700;letter-spacing:.02em}.strip svg{width:28px;height:28px;image-rendering:pixelated}
.body{padding:20px 24px 24px}h1{font-size:22px;line-height:1.25;margin:0 0 12px}h2{font-size:16px;margin:24px 0 8px}p{margin:0 0 12px;color:var(--soft)}.note{color:var(--muted);font-size:14px}
dl{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0 0 16px;font-size:14px}dt{color:var(--muted)}dd{margin:0;font-weight:600;overflow-wrap:anywhere}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}.stack{display:grid;gap:10px}label{display:grid;gap:4px;font-size:14px;color:var(--soft)}
input{font:inherit;padding:9px 12px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--text)}
button,.button{font:inherit;font-weight:700;padding:9px 18px;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer;text-decoration:none;display:inline-block}
@media (prefers-color-scheme:dark){button,.button{color:#0b0b0b}}
button.quiet{background:transparent;color:var(--soft);border-color:var(--line)}form{margin:0}:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
</style></head><body><main><div class="card"><div class="strip">${SQUIRREL_SVG}<span>Squirrelcade</span></div><div class="body">${body}</div></div></main></body></html>`;
}

/** Sends a page: no framing, no outside resources, forms posting here (and to the app's address the answer redirects to). */
function sendPage(reply: FastifyReply, html: string, status = 200, formTarget?: string): FastifyReply {
  const target = formTarget ? ` ${formTarget}` : '';
  return reply
    .code(status)
    .header('Content-Type', 'text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('X-Frame-Options', 'DENY')
    .header('Content-Security-Policy', `default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'self'${target}; frame-ancestors 'none'; base-uri 'none'`)
    .send(html);
}

const formOrigin = (uri: string) => {
  try {
    const u = new URL(uri);
    return loopback(u) ? `${u.protocol}//${u.hostname}:*` : u.origin;
  } catch {
    return undefined;
  }
};

/**
 * The sign-in's addresses: the two metadata documents, the sign-in page and its answer, tokens, registration and
 * revocation. While AI apps are off (or the address isn't set), they answer 404.
 */
export async function registerAiAuthRoutes(app: FastifyInstance, ai: AiAuthService, auth: AuthService): Promise<void> {
  await app.register(async (scope) => {
    // OAuth's token, revocation and sign-in answers come as forms (registration as JSON).
    scope.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_request, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    });
    const off = (reply: FastifyReply) => reply.code(404).header('Cache-Control', 'no-store').send({ error: 'not-found', message: 'AI apps are off (Settings › Claude and AI apps).' });
    const oauthError = (reply: FastifyReply, err: unknown) => {
      if (!(err instanceof OAuthError)) throw err;
      if (err.status === 401) reply.header('WWW-Authenticate', 'Basic realm="Squirrelcade"');
      return reply.code(err.status).header('Cache-Control', 'no-store').send({ error: err.code, error_description: err.message });
    };
    // Browser pages (MCP Inspector) read the metadata and trade codes from another origin: CORS for the allowed ones.
    const CORS_PATHS = [
      '/.well-known/oauth-protected-resource',
      '/.well-known/oauth-protected-resource/mcp',
      '/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/mcp',
      '/oauth/token',
      '/oauth/register',
      '/oauth/revoke',
    ];
    scope.addHook('onSend', async (request, reply, payload) => {
      const origin = request.headers.origin;
      const path = request.url.split('?')[0] ?? '';
      if (origin && CORS_PATHS.includes(path) && ai.originAllowed(origin)) for (const [k, v] of Object.entries(ai.corsHeaders(origin))) reply.header(k, v);
      return payload;
    });
    for (const path of CORS_PATHS) scope.options(path, async (_request, reply) => reply.code(204).send());
    const limited = (request: FastifyRequest, reply: FastifyReply, what: string) => {
      if (ai.hit(`${what}:${request.ip}`, 30, 60_000)) return false;
      void reply.code(429).header('Retry-After', '60').send({ error: 'slow_down', error_description: 'Too many requests. Try again in a minute.' });
      return true;
    };

    for (const path of ['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp']) {
      scope.get(path, async (_request, reply) => (ai.signInOn() ? reply.header('Cache-Control', 'max-age=300').send(ai.protectedResourceMetadata()) : off(reply)));
    }
    for (const path of ['/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/mcp']) {
      scope.get(path, async (_request, reply) => (ai.signInOn() ? reply.header('Cache-Control', 'max-age=300').send(ai.authorizationServerMetadata()) : off(reply)));
    }

    scope.get('/oauth/authorize', async (request, reply) => {
      if (!ai.signInOn()) return sendPage(reply, pageHtml('Not available', '<h1>Not available</h1><p>AI apps are off on this Squirrelcade.</p>'), 404);
      if (!ai.hit(`page:${request.ip}`, 60, 60_000)) return sendPage(reply, pageHtml('Slow down', '<h1>Slow down</h1><p>Too many sign-ins from here. Try again in a minute.</p>'), 429);
      const query = request.query as Record<string, string | undefined>;
      try {
        // Back from signing in to Squirrelcade: the same request, now with a session.
        if (query.request !== undefined) {
          const back = ai.waiting(query.request, request);
          if (!back) return sendPage(reply, pageHtml('Start again', '<h1>Start again</h1><p>This sign-in waited too long, or was started in another browser. Start it again from the app.</p>'), 400);
          return sendPage(reply, await ai.page(request, back), 200, formOrigin(back.redirectUri));
        }
        const started = await ai.start(query);
        if ('redirect' in started) return reply.redirect(started.redirect, 302);
        reply.setCookie(AI_REQUEST_COOKIE, started.pending.id, { path: '/oauth', httpOnly: true, sameSite: 'lax', secure: request.protocol === 'https', maxAge: REQUEST_MS / 1000 });
        return sendPage(reply, await ai.page(request, started.pending), 200, formOrigin(started.pending.redirectUri));
      } catch (err) {
        if (err instanceof PageError) return sendPage(reply, pageHtml("Can't connect", `<h1>Can't connect</h1><p>${escapeHtml(err.message)}</p>`), 400);
        throw err;
      }
    });

    scope.post('/oauth/authorize', async (request, reply) => {
      if (!ai.signInOn()) return sendPage(reply, pageHtml('Not available', '<h1>Not available</h1><p>AI apps are off on this Squirrelcade.</p>'), 404);
      if (!ai.hit(`answer:${request.ip}`, 30, 60_000)) return sendPage(reply, pageHtml('Slow down', '<h1>Slow down</h1><p>Too many tries from here. Try again in a minute.</p>'), 429);
      const body = (request.body ?? {}) as Record<string, unknown>;
      const pending = ai.waiting(body.request, request);
      const result = await ai.answer(request, body);
      if ('redirect' in result) return reply.redirect(result.redirect, 302);
      return sendPage(reply, result.html, result.status ?? 200, pending ? formOrigin(pending.redirectUri) : undefined);
    });

    scope.post('/oauth/token', async (request, reply) => {
      if (!ai.signInOn()) return off(reply);
      if (limited(request, reply, 'token')) return reply;
      try {
        return reply.header('Cache-Control', 'no-store').header('Pragma', 'no-cache').send(await ai.token(request, (request.body ?? {}) as Record<string, unknown>));
      } catch (err) {
        return oauthError(reply, err);
      }
    });

    scope.post('/oauth/register', async (request, reply) => {
      if (!ai.signInOn()) return off(reply);
      if (limited(request, reply, 'register')) return reply;
      try {
        return reply.code(201).header('Cache-Control', 'no-store').send(ai.register(request.body));
      } catch (err) {
        return oauthError(reply, err);
      }
    });

    scope.post('/oauth/revoke', async (request, reply) => {
      if (!ai.signInOn()) return off(reply);
      if (limited(request, reply, 'revoke')) return reply;
      try {
        await ai.revoke(request, (request.body ?? {}) as Record<string, unknown>);
        return reply.code(200).header('Cache-Control', 'no-store').send({});
      } catch (err) {
        return oauthError(reply, err);
      }
    });

    // Settings › Claude and AI apps (the owner's: viewers are refused /api/ calls not meant for them).
    scope.get('/api/v1/ai/guests', async () => ({ guests: ai.guests() }));
    scope.post('/api/v1/ai/guests', async (request, reply) => {
      const b = (request.body ?? {}) as { name?: unknown; email?: unknown };
      try {
        return reply.code(201).send(ai.addGuest(b.name, b.email));
      } catch (err) {
        if (err instanceof OAuthError) return reply.code(err.code === 'taken' ? 409 : 400).send({ error: err.code, message: err.message });
        throw err;
      }
    });
    scope.delete('/api/v1/ai/guests/:id', async (request) => ({ removed: ai.removeGuest(Number((request.params as { id: string }).id)) }));
    scope.get('/api/v1/ai/connections', async () => ({ connections: ai.connections(), address: ai.base() ? ai.resource() : null, on: ai.on(), signIn: ai.signInOn() }));
    scope.get('/api/v1/ai/keys', async () => ({ keys: ai.keys() }));
    // A key answers as the account that made it; the API key and the home network act as the owner.
    const keyOwner = (request: FastifyRequest) => (request.auth?.kind === 'session' ? request.auth.userId : auth.users().find((u) => u.role === 'owner')?.id);
    scope.post('/api/v1/ai/keys', async (request, reply) => {
      const userId = keyOwner(request);
      if (userId === undefined) return reply.code(409).send({ error: 'no-owner', message: 'Create the first account first.' });
      try {
        return reply.code(201).send(ai.makeKey((request.body as { name?: unknown } | null)?.name, userId));
      } catch (err) {
        if (err instanceof OAuthError) return reply.code(400).send({ error: err.code, message: err.message });
        throw err;
      }
    });
    // The plugin for Claude Code and Cowork on a computer (0.57.0, D133): a new key, written into the plugin's zip.
    scope.post('/api/v1/ai/plugin', async (request, reply) => {
      const b = (request.body ?? {}) as { name?: unknown; address?: unknown };
      const address = pluginAddress(b.address);
      if (!address) return reply.code(400).send({ error: 'invalid', message: "Give Squirrelcade's address on your home network, such as http://192.168.1.20:7575." });
      if (!ai.on()) return reply.code(409).send({ error: 'off', message: 'Turn on "Let AI apps read your collection" first.' });
      const userId = keyOwner(request);
      if (userId === undefined) return reply.code(409).send({ error: 'no-owner', message: 'Create the first account first.' });
      let made: ReturnType<AiAuthService['makeKey']>;
      try {
        made = ai.makeKey(typeof b.name === 'string' && b.name.trim() ? b.name : 'Claude plugin (Code and Cowork)', userId);
      } catch (err) {
        if (err instanceof OAuthError) return reply.code(400).send({ error: err.code, message: err.message });
        throw err;
      }
      return reply
        .header('Content-Type', 'application/zip')
        .header('Content-Disposition', 'attachment; filename="squirrelcade-plugin.zip"')
        .header('Cache-Control', 'no-store')
        .send(claudePluginZip({ address, key: made.key, version: APP_VERSION.replace(/-.*$/, '') }));
    });
    scope.delete('/api/v1/ai/keys/:id', async (request) => ({ revoked: ai.revokeKey(Number((request.params as { id: string }).id)) }));
    scope.get('/api/v1/ai/calls', async () => ({ calls: ai.calls(100) }));
    scope.delete('/api/v1/ai/connections/:id', async (request) => ({ removed: ai.disconnect(Number((request.params as { id: string }).id)) }));
  });
}

