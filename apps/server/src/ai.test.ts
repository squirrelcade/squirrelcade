import Ajv2020 from 'ajv/dist/2020.js';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportCsv, fakeTransports, multipartFile, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

const BASE = 'https://sq.example.com';
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback';
const TEAM = 'https://team.cloudflareaccess.com';
const AUD = 'aud-tag-1234';

// Cloudflare Access's signing key, and Claude's client metadata document, as the fake network serves them.
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
const DOC = 'https://claude.ai/oauth/test-client-metadata';
let fetched: string[] = [];
const aiFetch = (async (url: string) => {
  fetched.push(String(url));
  if (url === `${TEAM}/cdn-cgi/access/certs`) return Response.json({ keys: [jwk] });
  if (url === DOC) return Response.json({ client_id: DOC, client_name: 'Claude', redirect_uris: [CLAUDE], token_endpoint_auth_method: 'none' });
  throw new Error(`No network in tests: ${url}`);
}) as unknown as typeof fetch;

/** A token Cloudflare Access would put in Cf-Access-Jwt-Assertion. */
function accessJwt(email: string, claims: Record<string, unknown> = {}): string {
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({ iss: TEAM, aud: [AUD], email, exp: Math.floor(Date.now() / 1000) + 600, ...claims })).toString('base64url');
  return `${h}.${p}.${sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
}

let g: TestApp;
let cookies: Record<string, string>;
let mail: ReturnType<typeof fakeTransports>;
beforeEach(async () => {
  fetched = [];
  mail = fakeTransports();
  g = await testApp({ aiFetch, transports: mail.transports, features: ['pc'] });
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [
      ['1', 'Yakuza 0', 'Playstation 4'],
      ['2', 'Cars 2: The Video Game', 'Playstation 3'],
      ['3', "Tom Clancy's EndWar", 'Xbox 360'],
      ['4', 'Halo 3', 'Xbox 360'],
      ['5', 'Star Wars: Battlefront', 'Playstation 2'],
      ['6', 'Gears of War [Platinum Hits]', 'Xbox 360'],
    ],
    catalogs: { 'xbox-360': ['Halo 3', 'Halo Reach', "Tom Clancy's EndWar", 'Gears of War'], 'playstation-3': ['Cars 2: The Video Game', 'Demon\'s Souls'] },
  });
  g.settings.update({ 'ai.enabled': true, 'ai.internet': true, 'general.publicUrl': `${BASE}/` });
});
afterEach(async () => {
  await g.cleanup();
});

const form = (fields: Record<string, string>) => ({ payload: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const field = (html: string, name: string) => new RegExp(`name="${name}" value="([^"]+)"`).exec(html)?.[1] ?? '';

async function register(redirect = CLAUDE, extra: Record<string, unknown> = {}) {
  return g.app.inject({ method: 'POST', url: '/oauth/register', payload: { redirect_uris: [redirect], client_name: 'Test app', token_endpoint_auth_method: 'none', ...extra } });
}

/** Signs in through the page as the browser would (cookies or Access's header), and trades the code for tokens. */
async function connect(opts: { clientId?: string; redirect?: string; who?: { cookies?: Record<string, string>; headers?: Record<string, string> } } = {}) {
  const redirect = opts.redirect ?? CLAUDE;
  const clientId = opts.clientId ?? (await register(redirect)).json().client_id;
  const { verifier, challenge } = pkce();
  const query = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: 'S256', state: 'st-1', scope: 'collection:read offline_access', resource: `${BASE}/mcp` });
  const who = opts.who ?? { cookies };
  const page = await g.app.inject({ url: `/oauth/authorize?${query}`, cookies: who.cookies, headers: who.headers });
  const html = page.body;
  // The browser keeps the cookie that ties the sign-in to it.
  const tie = Object.fromEntries(page.cookies.map((c) => [c.name, c.value]));
  const answer = await g.app.inject({ method: 'POST', url: '/oauth/authorize', cookies: { ...who.cookies, ...tie }, ...form({ request: field(html, 'request'), csrf: field(html, 'csrf'), action: 'allow' }), headers: { ...form({}).headers, ...who.headers } });
  const location = answer.headers.location ? new URL(String(answer.headers.location)) : null;
  const code = location?.searchParams.get('code') ?? '';
  const tokens = await g.app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirect, client_id: clientId, resource: `${BASE}/mcp` }) });
  return { clientId, page, answer, location, code, verifier, tokens, access: tokens.json().access_token as string, refresh: tokens.json().refresh_token as string };
}

const mcp = (token: string, method: string, params?: unknown, headers: Record<string, string> = {}) =>
  g.app.inject({ method: 'POST', url: '/mcp', headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...headers }, payload: { jsonrpc: '2.0', id: 1, method, params } });
const call = async (token: string, name: string, args: Record<string, unknown> = {}) => (await mcp(token, 'tools/call', { name, arguments: args })).json().result;

describe('AI apps: off, and finding the sign-in', () => {
  it('is off by default, and needs an address', async () => {
    g.settings.update({ 'ai.enabled': false });
    expect((await g.app.inject({ method: 'POST', url: '/mcp', payload: {} })).statusCode).toBe(404);
    expect((await g.app.inject({ url: '/.well-known/oauth-protected-resource' })).statusCode).toBe(404);
    g.settings.update({ 'ai.enabled': true, 'general.publicUrl': 'http://sq.example.com' });
    // Plain http on the internet isn't an address tokens can be for.
    expect((await g.app.inject({ url: '/.well-known/oauth-authorization-server' })).statusCode).toBe(404);
    // The sign-in for apps on the internet is a choice of its own, off by default: then only keys work.
    g.settings.update({ 'general.publicUrl': `${BASE}/`, 'ai.internet': false });
    expect((await g.app.inject({ url: '/.well-known/oauth-authorization-server' })).statusCode).toBe(404);
    expect((await g.app.inject({ method: 'POST', url: '/oauth/token', payload: {} })).statusCode).toBe(404);
    const noToken = await g.app.inject({ method: 'POST', url: '/mcp', payload: {} });
    expect(noToken.statusCode).toBe(401);
    expect(noToken.headers['www-authenticate']).toBe('Bearer realm="Squirrelcade"');
  });

  it('answers a request without a token with 401 and where to sign in', async () => {
    const res = await g.app.inject({ method: 'POST', url: '/mcp', headers: { accept: 'application/json, text/event-stream' }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource/mcp", scope="collection:read"`);
    const prm = (await g.app.inject({ url: '/.well-known/oauth-protected-resource/mcp' })).json();
    expect(prm).toMatchObject({ resource: `${BASE}/mcp`, authorization_servers: [BASE], scopes_supported: ['collection:read'] });
    const as = (await g.app.inject({ url: '/.well-known/oauth-authorization-server' })).json();
    expect(as).toMatchObject({
      issuer: BASE,
      authorization_endpoint: `${BASE}/oauth/authorize`,
      token_endpoint: `${BASE}/oauth/token`,
      code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
    expect(as.token_endpoint_auth_methods_supported).toContain('none');
    expect(as.scopes_supported).toEqual(['collection:read', 'offline_access']);
  });
});

describe('AI apps: signing in', () => {
  it('registers apps only for the callbacks allowed', async () => {
    expect((await register()).statusCode).toBe(201);
    expect((await register('https://evil.example/callback')).json()).toMatchObject({ error: 'invalid_redirect_uri' });
    expect((await register('http://localhost:6274/oauth/callback')).statusCode).toBe(201);
    g.settings.update({ 'ai.allowLocalApps': false });
    expect((await register('http://localhost:6274/oauth/callback')).statusCode).toBe(400);
    // A registered app asking for a secret gets one, and needs it at the token endpoint.
    const confidential = (await register(CLAUDE, { token_endpoint_auth_method: 'client_secret_post' })).json();
    expect(confidential.client_secret).toBeTruthy();
  });

  it('signs the owner in with PKCE, and refuses codes and refresh tokens used twice', async () => {
    const c = await connect();
    expect(c.page.statusCode).toBe(200);
    expect(c.page.body).toContain('Connect Test app to Squirrelcade?');
    expect(c.page.body).toContain('claude.ai');
    expect(c.page.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(c.location?.origin + c.location!.pathname).toBe(CLAUDE);
    expect(c.location?.searchParams.get('state')).toBe('st-1');
    expect(c.location?.searchParams.get('iss')).toBe(BASE);
    expect(c.tokens.statusCode).toBe(200);
    expect(c.tokens.json()).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'collection:read offline_access' });
    expect((await mcp(c.access, 'tools/list')).statusCode).toBe(200);

    // The code again: refused, and the connection ends (its tokens with it).
    const again = await g.app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'authorization_code', code: c.code, code_verifier: c.verifier, redirect_uri: CLAUDE, client_id: c.clientId }) });
    expect(again.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await mcp(c.access, 'tools/list')).statusCode).toBe(401);

    // A refresh token works once; used again, the connection ends.
    const d = await connect();
    const refreshed = await g.app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: d.refresh, client_id: d.clientId }) });
    expect(refreshed.statusCode).toBe(200);
    const next = refreshed.json();
    expect(next.refresh_token).not.toBe(d.refresh);
    expect((await mcp(next.access_token, 'tools/list')).statusCode).toBe(200);
    const reused = await g.app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'refresh_token', refresh_token: d.refresh, client_id: d.clientId }) });
    expect(reused.json()).toMatchObject({ error: 'invalid_grant' });
    expect((await mcp(next.access_token, 'tools/list')).statusCode).toBe(401);

    // A new password ends the account's connections.
    const e = await connect();
    expect((await mcp(e.access, 'tools/list')).statusCode).toBe(200);
    const changed = await g.app.inject({ method: 'POST', url: '/api/v1/auth/password', cookies, payload: { currentPassword: 'correct horse', newPassword: 'another horse' } });
    expect(changed.statusCode).toBe(200);
    expect((await mcp(e.access, 'tools/list')).statusCode).toBe(401);
  });

  it('checks the verifier, the redirect address and the resource', async () => {
    const clientId = (await register()).json().client_id;
    const { challenge } = pkce();
    const base = { response_type: 'code', client_id: clientId, redirect_uri: CLAUDE, code_challenge: challenge, code_challenge_method: 'S256' };
    // An address the app didn't register: a page, never a redirect.
    const wrong = await g.app.inject({ url: `/oauth/authorize?${new URLSearchParams({ ...base, redirect_uri: 'https://claude.ai/elsewhere' })}`, cookies });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.headers.location).toBeUndefined();
    // No PKCE, or tokens for another address: back to the app with the error.
    const plain = await g.app.inject({ url: `/oauth/authorize?${new URLSearchParams({ ...base, code_challenge_method: 'plain' })}`, cookies });
    expect(new URL(String(plain.headers.location)).searchParams.get('error')).toBe('invalid_request');
    const other = await g.app.inject({ url: `/oauth/authorize?${new URLSearchParams({ ...base, resource: 'https://other.example/mcp' })}`, cookies });
    expect(new URL(String(other.headers.location)).searchParams.get('error')).toBe('invalid_target');
    // A wrong verifier.
    const c = await connect();
    const d = await connect({ clientId: c.clientId });
    const bad = await g.app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'authorization_code', code: d.code, code_verifier: 'x'.repeat(43), redirect_uri: CLAUDE, client_id: c.clientId }) });
    expect(bad.json()).toMatchObject({ error: 'invalid_grant' });
  });

  it("reads Claude's client metadata document from an allowed host only", async () => {
    const c = await connect({ clientId: DOC });
    expect(c.page.body).toContain('Connect Claude to');
    expect(c.tokens.statusCode).toBe(200);
    expect(fetched).toContain(DOC);
    g.settings.update({ 'ai.clientHosts': ['example.org'] });
    const refused = await g.app.inject({ url: `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'https://claude.ai/other-doc', redirect_uri: CLAUDE, code_challenge: pkce().challenge, code_challenge_method: 'S256' })}`, cookies });
    expect(refused.statusCode).toBe(400);
    expect(refused.body).toContain("isn't one this Squirrelcade lets in");
  });

  it('asks someone not signed in to sign in, and keeps viewers out when only the owner may connect', async () => {
    const clientId = (await register()).json().client_id;
    const page = await g.app.inject({ url: `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CLAUDE, code_challenge: pkce().challenge, code_challenge_method: 'S256' })}` });
    expect(page.body).toContain('Sign in to Squirrelcade');
    expect(page.body).toContain('/ai-sign-in?next=');
    expect(page.body).not.toContain('value="allow"');

    const invite = (await g.app.inject({ method: 'POST', url: '/api/v1/invites', cookies, payload: { name: 'Sam' } })).json();
    const joined = await g.app.inject({ method: 'POST', url: `/api/v1${invite.path}`, payload: { username: 'sam', password: 'a long password' } });
    const viewer = { squirrelcade_session: joined.cookies.find((k) => k.name === 'squirrelcade_session')!.value };
    const ok = await connect({ who: { cookies: viewer } });
    expect(ok.tokens.statusCode).toBe(200);
    g.settings.update({ 'ai.whoCanConnect': 'owner' });
    expect((await mcp(ok.access, 'tools/list')).statusCode).toBe(401);
    const refused = await connect({ who: { cookies: viewer } });
    expect(refused.page.body).toContain('Only the owner can connect');
    expect(refused.code).toBe('');
  });
});

describe('AI apps: the tools', () => {
  let token: string;
  beforeEach(async () => {
    token = (await connect()).access;
  });

  it('lists five read-only tools with schemas', async () => {
    const res = await mcp(token, 'tools/list');
    const tools = res.json().result.tools as { name: string; annotations: { readOnlyHint: boolean }; outputSchema?: unknown }[];
    expect(tools.map((t) => t.name).sort()).toEqual(['check_ownership', 'get_game', 'get_wishlist', 'list_platforms', 'search_games']);
    expect(tools.every((t) => t.annotations.readOnlyHint && t.outputSchema)).toBe(true);
  });

  it("describes its tools in JSON Schema 2020-12, which every answer passes (Cowork refused draft-07's)", async () => {
    const tools = (await mcp(token, 'tools/list')).json().result.tools as { name: string; inputSchema: Record<string, unknown>; outputSchema: Record<string, unknown> }[];
    expect(tools.flatMap((t) => [t.inputSchema.$schema, t.outputSchema.$schema]).filter(Boolean)).toEqual([]);
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const asked: Record<string, Record<string, unknown>> = {
      check_ownership: { titles: ['Cars 2', 'Halo Reach', 'Nothing Like It'] },
      search_games: { query: 'halo' },
      get_game: {},
      get_wishlist: {},
      list_platforms: {},
    };
    for (const t of tools) {
      const validate = ajv.compile(t.outputSchema);
      let args = asked[t.name]!;
      if (t.name === 'get_game') args = { id: (await call(token, 'search_games', { query: 'halo' })).structuredContent.games[0].id };
      const r = await call(token, t.name, args);
      expect([t.name, r.isError ?? false]).toEqual([t.name, false]);
      expect([t.name, validate(r.structuredContent), validate.errors ?? null]).toEqual([t.name, true, null]);
    }
  });

  it('lists the wishlist with acorns, best first, a console at a time, and why', async () => {
    const all = (await call(token, 'get_wishlist')).structuredContent;
    expect(all.total).toBeGreaterThan(0);
    expect(all.games[0]).toMatchObject({ rank: 1, acorns: expect.any(Number), priority: expect.stringMatching(/High|Medium|Low/) });
    // The main list is in order of its list acorns (acorns minus the variety in the top picks), never above the acorns.
    const listed = all.games.map((g: { list_acorns: number }) => g.list_acorns);
    expect(listed).toEqual([...listed].sort((a, b) => b - a));
    for (const g of all.games) expect(g.list_acorns).toBeLessThanOrEqual(g.acorns);
    expect(all.games[0].why.length).toBeGreaterThan(0);
    const ps3 = (await call(token, 'get_wishlist', { platform: 'PS3' })).structuredContent;
    expect(ps3.games.map((g: { title: string }) => g.title)).toContain("Demon's Souls");
    expect(ps3.games.every((g: { platform_key: string }) => g.platform_key === 'playstation-3')).toBe(true);
    const page = (await call(token, 'get_wishlist', { limit: 1 })).structuredContent;
    expect(page.games).toHaveLength(1);
    expect(page.next_cursor === undefined).toBe(all.total <= 1);
    expect((await call(token, 'get_wishlist', { platform: 'Atari Jaguar' })).isError).toBe(true);
    // One game's acorns, and why: by its title, and through check_ownership.
    const reach = (await call(token, 'get_wishlist', { query: 'halo reach' })).structuredContent;
    expect(reach.games).toEqual([expect.objectContaining({ title: 'Halo Reach', platform_key: 'xbox-360', acorns: expect.any(Number), why: expect.arrayContaining([expect.objectContaining({ reason: expect.any(String) })]) })]);
    expect((await call(token, 'get_wishlist', { query: 'halo 3' })).structuredContent.games).toEqual([]);
    const checked = (await call(token, 'check_ownership', { titles: ['Halo Reach'] })).structuredContent.results[0];
    expect(checked.wishlist[0]).toMatchObject({ title: 'Halo Reach', acorns: reach.games[0].acorns, why: reach.games[0].why });
  });

  it('checks ownership through editions, subtitles and franchise names, with near misses', async () => {
    const r = await call(token, 'check_ownership', { titles: ["Yakuza 0 Director's Cut", 'Cars 2', 'EndWar', 'Halo 2', 'Star Wars', 'Gears of War', 'Halo Reach'] });
    expect(r.isError).toBeFalsy();
    const [yakuza, cars, endwar, halo2, starWars, gears, reach] = r.structuredContent.results;
    expect(yakuza).toMatchObject({ status: 'owned', matches: [{ title: 'Yakuza 0', platform: 'PlayStation 4', match: 'edition', confidence: 0.9 }] });
    expect(yakuza.matches[0].why).toBe("A different edition: not the Director's Cut");
    expect(cars).toMatchObject({ status: 'owned', matches: [{ title: 'Cars 2: The Video Game', match: 'subtitle', confidence: 0.95 }] });
    expect(endwar).toMatchObject({ status: 'owned', matches: [{ title: "Tom Clancy's EndWar", platform: 'Xbox 360' }] });
    expect(halo2).toMatchObject({ status: 'not_owned', matches: [], near_misses: [] });
    expect(starWars).toMatchObject({ status: 'possible', matches: [], near_misses: [{ title: 'Star Wars: Battlefront', match: 'stem' }] });
    expect(gears).toMatchObject({ status: 'owned', matches: [{ match: 'reprint', edition: 'Platinum Hits' }] });
    // Not owned: its wishlist place and acorns, when it's a catalog game.
    expect(reach.status).toBe('not_owned');
    expect(reach.wishlist[0]).toMatchObject({ platform: 'Xbox 360', title: 'Halo Reach' });
    expect(typeof reach.wishlist[0].acorns).toBe('number');
    // The same as text, for apps that read text.
    expect(JSON.parse(r.content[0].text)).toEqual(r.structuredContent);
  });

  it('says when a game is owned on another console than the ones asked', async () => {
    const r = (await call(token, 'check_ownership', { titles: ['Halo 3'], platforms: ['PS3'] })).structuredContent.results[0];
    expect(r).toMatchObject({ status: 'not_owned', matches: [], elsewhere: [{ platform: 'Xbox 360', title: 'Halo 3' }] });
    const bad = await call(token, 'check_ownership', { titles: ['Halo 3'], platforms: ['Dreamcast'] });
    expect(bad.isError).toBe(true);
    expect(bad.content[0].text).toContain('list_platforms');
  });

  it('searches by words, console and condition, a page at a time', async () => {
    const yak = (await call(token, 'search_games', { query: 'yak' })).structuredContent;
    expect(yak.games.map((x: { title: string }) => x.title)).toEqual(['Yakuza 0']);
    const xbox = (await call(token, 'search_games', { platform: '360', limit: 2 })).structuredContent;
    expect(xbox.total).toBe(3);
    expect(xbox.games).toHaveLength(2);
    const rest = (await call(token, 'search_games', { platform: '360', limit: 2, cursor: xbox.next_cursor })).structuredContent;
    expect(rest.games).toHaveLength(1);
    expect(rest.next_cursor).toBeUndefined();
    expect((await call(token, 'search_games', { condition: 'sealed' })).structuredContent.total).toBe(0);
  });

  it('gives one game in detail, prices paid only when let in, and the platforms', async () => {
    const id = (await call(token, 'search_games', { query: 'halo 3' })).structuredContent.games[0].id;
    const game = (await call(token, 'get_game', { id })).structuredContent;
    expect(game.title).toBe('Halo 3');
    expect(game.entries[0]).toMatchObject({ platform: 'Xbox 360', format: 'physical', copies: [{ condition: 'Complete in box', box: true, manual: true, value_cents: 1000 }] });
    expect(game.entries[0].copies[0].paid_cents).toBeUndefined();
    g.settings.update({ 'ai.sharePaid': true });
    expect((await call(token, 'get_game', { id })).structuredContent.entries[0].copies[0]).toHaveProperty('paid_cents');
    expect((await call(token, 'get_game', { id: 'g_nope' })).isError).toBe(true);
    const platforms = (await call(token, 'list_platforms')).structuredContent;
    expect(platforms.platforms[0]).toMatchObject({ key: 'xbox-360', name: 'Xbox 360', family: 'xbox', games: 3, copies: 3, short_names: ['360', 'x360'] });
    expect(platforms.totals).toMatchObject({ games: 6, copies: 6 });
  });

  it('counts calls against the limits and keeps a list of them', async () => {
    g.settings.update({ 'ai.callsPerMinute': 5 });
    for (let i = 0; i < 5; i++) expect((await call(token, 'list_platforms')).isError).toBeFalsy();
    const over = await call(token, 'list_platforms');
    expect(over.isError).toBe(true);
    expect(over.content[0].text).toContain('5 a minute');
    const calls = (await g.app.inject({ url: '/api/v1/ai/calls', cookies })).json().calls;
    expect(calls[0]).toMatchObject({ who: 'admin', client: 'Test app', tool: 'list_platforms', outcome: 'limited' });
    expect(calls.filter((c: { outcome: string }) => c.outcome === 'ok')).toHaveLength(5);
    const connections = (await g.app.inject({ url: '/api/v1/ai/connections', cookies })).json();
    expect(connections).toMatchObject({ on: true, signIn: true, address: `${BASE}/mcp`, connections: [{ who: 'admin', app: 'Test app', host: 'claude.ai', calls: 6 }] });
    // Disconnected: its token stops working.
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/ai/connections/${connections.connections[0].id}`, cookies })).json()).toEqual({ removed: true });
    expect((await mcp(token, 'tools/list')).statusCode).toBe(401);
  });

  it('takes browser pages only from allowed origins', async () => {
    expect((await mcp(token, 'tools/list', undefined, { origin: 'https://evil.example' })).statusCode).toBe(403);
    const local = await mcp(token, 'tools/list', undefined, { origin: 'http://localhost:6274' });
    expect(local.statusCode).toBe(200);
    expect(local.headers['access-control-allow-origin']).toBe('http://localhost:6274');
    const preflight = await g.app.inject({ method: 'OPTIONS', url: '/oauth/token', headers: { origin: 'http://localhost:6274' } });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:6274');
  });

  it('keeps a game owned through a digital license claimed with its disc, after the disc is sold', async () => {
    const copies = (await g.app.inject({ url: '/api/v1/collection/items?pageSize=50', cookies })).json();
    const halo = copies.items.find((i: { title: string }) => i.title === 'Halo 3');
    const key = halo.copyKey ?? halo.key;
    const put = await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key, digitalClaim: 'claimed', digitalClaimedAt: '2026-03-02', digitalStore: 'Xbox' } });
    expect(put.json()).toMatchObject({ details: { digitalClaim: 'claimed', digitalStore: 'Xbox' } });
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies, payload: { key, digitalClaim: 'maybe' } })).statusCode).toBe(400);
    // Collection › Copies keeps it under "Digital copy claimed".
    const claimed = (await g.app.inject({ url: '/api/v1/collection/items?digital=claimed', cookies })).json();
    expect(claimed.items.map((i: { title: string }) => i.title)).toEqual(['Halo 3']);
    const id = halo.copyId ?? halo.id;
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/collection/copies/${id}/remove`, cookies, payload: { reason: 'sold' } })).statusCode).toBe(200);
    g.aiTools.invalidate();
    const r = (await call(token, 'check_ownership', { titles: ['Halo 3'] })).structuredContent.results[0];
    expect(r).toMatchObject({ status: 'owned', matches: [{ format: 'digital', copies: 0, digital_license: { claimed: true, store: 'Xbox', claimed_at: '2026-03-02', disc_gone: true } }] });
  });
});

describe('AI apps: keys for apps on the home network', () => {
  const makeKey = async (name = 'Claude Code') => (await g.app.inject({ method: 'POST', url: '/api/v1/ai/keys', cookies, payload: { name } })).json();

  it('lets Claude Code in with a key, without the sign-in or an address', async () => {
    g.settings.update({ 'ai.internet': false, 'general.publicUrl': '' });
    const made = await makeKey();
    expect(made.key).toMatch(/^sqk_[A-Za-z0-9_-]{43}$/);
    const list = await mcp(made.key, 'tools/list');
    expect(list.statusCode).toBe(200);
    const r = await call(made.key, 'check_ownership', { titles: ['Cars 2'] });
    expect(r.structuredContent.results[0]).toMatchObject({ status: 'owned' });
    // Each key keeps its calls, under the account that made it.
    const calls = (await g.app.inject({ url: '/api/v1/ai/calls', cookies })).json().calls;
    expect(calls[0]).toMatchObject({ who: 'admin', client: 'Claude Code', tool: 'check_ownership', keyId: made.id, grantId: null });
    const keys = (await g.app.inject({ url: '/api/v1/ai/keys', cookies })).json().keys;
    expect(keys).toEqual([expect.objectContaining({ id: made.id, name: 'Claude Code', username: 'admin', calls: 1 })]);
    expect(JSON.stringify(keys)).not.toContain(made.key);
    // A key isn't a sign-in: it never shows among the connected apps.
    expect((await g.app.inject({ url: '/api/v1/ai/connections', cookies })).json()).toMatchObject({ on: true, signIn: false, connections: [] });
  });

  it('takes a key only from the home network unless told otherwise, and never after it is revoked', async () => {
    const made = await makeKey('Claude Code on the PC');
    // A request relayed from outside (the forwarded address isn't one of the home network's).
    const outside = await mcp(made.key, 'tools/list', undefined, { 'x-forwarded-for': '203.0.113.9' });
    expect(outside.statusCode).toBe(403);
    expect(outside.json().error_description).toContain('home network only');
    g.settings.update({ 'ai.keysFrom': 'anywhere' });
    expect((await mcp(made.key, 'tools/list', undefined, { 'x-forwarded-for': '203.0.113.9' })).statusCode).toBe(200);
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/ai/keys/${made.id}`, cookies })).json()).toEqual({ revoked: true });
    expect((await mcp(made.key, 'tools/list')).statusCode).toBe(401);
    expect((await mcp('sqk_not-a-real-key-at-all', 'tools/list')).statusCode).toBe(401);
    expect((await g.app.inject({ url: '/api/v1/ai/keys', cookies })).json().keys).toEqual([]);
  });

  it('asks a key a name, and keeps keys from viewers', async () => {
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/ai/keys', cookies, payload: { name: '' } })).statusCode).toBe(400);
    const invite = (await g.app.inject({ method: 'POST', url: '/api/v1/invites', cookies, payload: { name: 'Sam' } })).json();
    const joined = await g.app.inject({ method: 'POST', url: `/api/v1${invite.path}`, payload: { username: 'sam', password: 'a long password' } });
    const viewer = { squirrelcade_session: joined.cookies.find((k) => k.name === 'squirrelcade_session')!.value };
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/ai/keys', cookies: viewer, payload: { name: 'Mine' } })).statusCode).toBe(403);
    expect((await g.app.inject({ url: '/api/v1/ai/keys', cookies: viewer })).statusCode).toBe(403);
  });
});

describe('AI apps: guests', () => {
  it('lets a guest in by the email Cloudflare Access vouches for, with a guest view', async () => {
    g.settings.update({ 'ai.accessTeam': TEAM, 'ai.accessAud': AUD, 'ai.sharePaid': true });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/ai/guests', cookies, payload: { name: 'Justin', email: 'Justin@Example.com' } })).statusCode).toBe(201);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/ai/guests', cookies, payload: { name: 'J2', email: 'justin@example.com' } })).statusCode).toBe(409);
    const c = await connect({ who: { headers: { 'cf-access-jwt-assertion': accessJwt('justin@example.com') } } });
    expect(c.page.body).toContain('Justin (guest)');
    expect(c.tokens.statusCode).toBe(200);
    const id = (await call(c.access, 'search_games', { query: 'halo 3' })).structuredContent.games[0].id;
    // A guest never gets prices paid, whatever the setting.
    expect((await call(c.access, 'get_game', { id })).structuredContent.entries[0].copies[0].paid_cents).toBeUndefined();
    const calls = (await g.app.inject({ url: '/api/v1/ai/calls', cookies })).json().calls;
    expect(calls[0].who).toBe('Justin (guest)');

    // Someone else, or a token Access didn't sign, isn't let in.
    const stranger = await connect({ who: { headers: { 'cf-access-jwt-assertion': accessJwt('someone@example.com') } } });
    expect(stranger.page.body).toContain("someone@example.com isn't on this Squirrelcade's guest list");
    const forged = accessJwt('justin@example.com').replace(/\.[^.]+$/, '.AAAA');
    expect((await connect({ who: { headers: { 'cf-access-jwt-assertion': forged } } })).page.body).toContain('Sign in to Squirrelcade');
    const expired = accessJwt('justin@example.com', { exp: Math.floor(Date.now() / 1000) - 10 });
    expect((await connect({ who: { headers: { 'cf-access-jwt-assertion': expired } } })).page.body).not.toContain('value="allow"');

    // Off the list: their connection ends.
    const guests = (await g.app.inject({ url: '/api/v1/ai/guests', cookies })).json().guests;
    expect(guests[0]).toMatchObject({ name: 'Justin', email: 'justin@example.com', connections: 1 });
    await g.app.inject({ method: 'DELETE', url: `/api/v1/ai/guests/${guests[0].id}`, cookies });
    expect((await mcp(c.access, 'tools/list')).statusCode).toBe(401);
  });

  it('lets a guest in with a code Squirrelcade emails, without Access', async () => {
    g.settings.update({ 'notifications.smtpUser': 'owner@example.com', 'notifications.smtpHost': 'smtp.example.com' });
    await g.app.inject({ method: 'POST', url: '/api/v1/ai/guests', cookies, payload: { name: 'Justin', email: 'justin@example.com' } });
    const clientId = (await register()).json().client_id;
    const { verifier, challenge } = pkce();
    const page = await g.app.inject({ url: `/oauth/authorize?${new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: CLAUDE, code_challenge: challenge, code_challenge_method: 'S256' })}` });
    expect(page.body).toContain('Email me a code');
    const ids = { request: field(page.body, 'request'), csrf: field(page.body, 'csrf') };
    const tie = Object.fromEntries(page.cookies.map((c) => [c.name, c.value]));
    // Another browser (without the sign-in's cookie) can't go on with it.
    expect((await g.app.inject({ method: 'POST', url: '/oauth/authorize', ...form({ ...ids, action: 'send-code', email: 'justin@example.com' }) })).body).toContain('started in another browser');
    // A stranger's email gets the same answer, and no email.
    const stranger = await g.app.inject({ method: 'POST', url: '/oauth/authorize', cookies: tie, ...form({ ...ids, action: 'send-code', email: 'nobody@example.com' }) });
    expect(stranger.body).toContain('If nobody@example.com is on the guest list');
    await new Promise((r) => setTimeout(r, 10));
    expect(mail.sent.mail).toHaveLength(0);
    await g.app.inject({ method: 'POST', url: '/oauth/authorize', cookies: tie, ...form({ ...ids, action: 'send-code', email: 'justin@example.com' }) });
    await new Promise((r) => setTimeout(r, 10));
    expect(mail.sent.mail).toHaveLength(1);
    expect(mail.sent.mail[0]!.to).toEqual(['justin@example.com']);
    const code = /is (\d{6})\./.exec(mail.sent.mail[0]!.text)![1]!;
    const wrong = await g.app.inject({ method: 'POST', url: '/oauth/authorize', cookies: tie, ...form({ ...ids, action: 'verify-code', code: code === '000000' ? '111111' : '000000' }) });
    expect(wrong.body).toContain("That code isn't the one we sent");
    const right = await g.app.inject({ method: 'POST', url: '/oauth/authorize', cookies: tie, ...form({ ...ids, action: 'verify-code', code }) });
    expect(right.body).toContain('Justin (guest)');
    const allowed = await g.app.inject({ method: 'POST', url: '/oauth/authorize', cookies: tie, ...form({ ...ids, action: 'allow' }) });
    const back = new URL(String(allowed.headers.location));
    const tokens = await g.app.inject({ method: 'POST', url: '/oauth/token', ...form({ grant_type: 'authorization_code', code: back.searchParams.get('code')!, code_verifier: verifier, redirect_uri: CLAUDE, client_id: clientId }) });
    expect(tokens.statusCode).toBe(200);
  });
});

describe('AI apps: the PC library', () => {
  it('finds PC games across storefronts, and says how each is held', async () => {
    const snapshot = JSON.stringify({
      schemaVersion: 'vgcm-playnite-library-v1',
      generatedAtUtc: '2026-09-27T12:00:00Z',
      source: { fileName: 'PlayniteBackup-2026-09-26.zip', lastWriteUtc: '2026-09-26T12:53:59Z', fingerprint: 'x' },
      statistics: { gameRecords: 2 },
      records: [
        ['Steam', '1', 'Yakuza 0'],
        ['Epic', 'a', 'Hades'],
      ].map(([store, id, name]) => ({ recordKey: `${store}|${id}`, playniteId: `p-${id}`, storefrontGameId: id, sourceName: store, name, platforms: ['PC (Windows)'], genres: [], series: [], favorite: false, hidden: false, installed: false, playtimeSeconds: 7200, playCount: 1, links: [] })),
    });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/pc/snapshot', cookies, ...multipartFile('snapshot.json', Buffer.from(snapshot), 'application/json') })).statusCode).toBe(201);
    const token = (await connect()).access;
    const r = (await call(token, 'check_ownership', { titles: ['Yakuza 0', 'Hades'], platforms: ['PC'] })).structuredContent.results;
    expect(r[0]).toMatchObject({ status: 'owned', matches: [{ platform: 'PC', format: 'digital', storefronts: [{ storefront: 'Steam', held: 'owned' }] }], elsewhere: [{ platform: 'PlayStation 4' }] });
    expect(r[1]).toMatchObject({ status: 'owned', matches: [{ storefronts: [{ storefront: 'Epic' }] }] });
    const steam = (await call(token, 'search_games', { storefront: 'steam' })).structuredContent;
    expect(steam.games.map((x: { title: string }) => x.title)).toEqual(['Yakuza 0']);
    // The same game on PS4 and PC is one game.
    expect(steam.games[0].entries).toHaveLength(1);
    const game = (await call(token, 'get_game', { id: steam.games[0].id })).structuredContent;
    expect(game.entries.map((e: { platform: string }) => e.platform)).toEqual(['PlayStation 4', 'PC']);
    expect(game.entries[1].storefronts[0]).toMatchObject({ storefront: 'Steam', held: 'owned', playtime_hours: 2 });
    const platforms = (await call(token, 'list_platforms')).structuredContent;
    expect(platforms.pc.storefronts.map((s: { storefront: string }) => s.storefront).sort()).toEqual(['Epic', 'Steam']);
  });
});

void exportCsv;
