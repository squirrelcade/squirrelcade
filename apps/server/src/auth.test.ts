import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isLocalAddress } from './auth.js';
import { setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  g = await testApp();
});
afterEach(async () => {
  await g.cleanup();
});

describe('first-run setup', () => {
  it('sends basic security headers and keeps API answers out of caches', async () => {
    const res = await g.app.inject({ url: '/api/v1/health' });
    expect(res.headers).toMatchObject({ 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'same-origin', 'cache-control': 'no-store' });
  });

  it('asks for setup until an account exists', async () => {
    const session = await g.app.inject({ url: '/api/v1/auth/session' });
    expect(session.json()).toMatchObject({ setupRequired: true, authenticated: false });
    const blocked = await g.app.inject({ url: '/api/v1/settings' });
    expect(blocked.statusCode).toBe(409);
  });

  it('creates the account, signs in and refuses a second setup', async () => {
    const cookies = await setUp(g);
    const me = await g.app.inject({ url: '/api/v1/auth/session', cookies });
    expect(me.json()).toMatchObject({ setupRequired: false, authenticated: true, username: 'admin', via: 'session' });
    const again = await g.app.inject({ method: 'POST', url: '/api/v1/setup', payload: { username: 'x', password: 'long enough' } });
    expect(again.statusCode).toBe(409);
  });

  it('rejects short passwords', async () => {
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/setup', payload: { username: 'admin', password: 'short' } });
    expect(res.statusCode).toBe(400);
  });

  it('asks for the setup code from outside the home network, and takes it in any case', async () => {
    const outside = { 'x-forwarded-for': '203.0.113.9' };
    expect((await g.app.inject({ url: '/api/v1/auth/session', headers: outside })).json()).toMatchObject({ setupRequired: true, setupCodeNeeded: true });
    expect((await g.app.inject({ url: '/api/v1/auth/session' })).json()).toMatchObject({ setupCodeNeeded: false });
    const account = { username: 'admin', password: 'long enough' };
    const without = await g.app.inject({ method: 'POST', url: '/api/v1/setup', headers: outside, payload: account });
    expect([without.statusCode, without.json().error]).toEqual([403, 'setup-code']);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/setup', headers: outside, payload: { ...account, setupCode: 'WRONG-CODE' } })).statusCode).toBe(403);
    const code = g.auth.setupCode()!;
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    const typed = code.toLowerCase().replace('-', ' ');
    const made = await g.app.inject({ method: 'POST', url: '/api/v1/setup', headers: outside, payload: { ...account, setupCode: typed } });
    expect(made.statusCode).toBe(201);
    // Once the account exists, there's no code any more.
    expect(g.auth.setupCode()).toBeNull();
  });

  it('stops guessing setup codes like failed sign-ins', async () => {
    const outside = { 'x-forwarded-for': '203.0.113.10' };
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await g.app.inject({ method: 'POST', url: '/api/v1/setup', headers: outside, payload: { username: 'admin', password: 'long enough', setupCode: `GUES-S${i}AB` } })).statusCode;
    expect(last).toBe(429);
  });

  it('can set settings during setup', async () => {
    const res = await g.app.inject({
      method: 'POST',
      url: '/api/v1/setup',
      payload: { username: 'admin', password: 'long enough', settings: { 'general.currency': 'CAD' } },
    });
    expect(res.statusCode).toBe(201);
    expect(g.settings.get('general.currency')).toBe('CAD');
  });
});

describe('sign-in', () => {
  it('needs a session or API key once set up', async () => {
    await setUp(g);
    expect((await g.app.inject({ url: '/api/v1/settings' })).statusCode).toBe(401);
    expect((await g.app.inject({ url: '/api/v1/health' })).statusCode).toBe(200);
  });

  it('signs in and out', async () => {
    await setUp(g);
    const bad = await g.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    const good = await g.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'correct horse' } });
    expect(good.statusCode).toBe(200);
    const cookies = { squirrelcade_session: good.cookies.find((c) => c.name === 'squirrelcade_session')!.value };
    expect((await g.app.inject({ url: '/api/v1/settings', cookies })).statusCode).toBe(200);
    await g.app.inject({ method: 'POST', url: '/api/v1/auth/logout', cookies });
    expect((await g.app.inject({ url: '/api/v1/settings', cookies })).statusCode).toBe(401);
  });

  it('locks out an address after 10 failed sign-ins', async () => {
    await setUp(g);
    for (let i = 0; i < 10; i++) {
      await g.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'wrong' } });
    }
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'correct horse' } });
    expect(res.statusCode).toBe(429);
  });

  it('accepts the API key in a header or the query string', async () => {
    const cookies = await setUp(g);
    const { apiKey } = (await g.app.inject({ url: '/api/v1/auth/apikey', cookies })).json() as { apiKey: string };
    expect(apiKey).toMatch(/^[0-9a-f]{32}$/);
    expect((await g.app.inject({ url: '/api/v1/settings', headers: { 'x-api-key': apiKey } })).statusCode).toBe(200);
    expect((await g.app.inject({ url: `/api/v1/settings?apikey=${apiKey}` })).statusCode).toBe(200);
    expect((await g.app.inject({ url: '/api/v1/settings', headers: { 'x-api-key': 'wrong' } })).statusCode).toBe(401);
    const renewed = (await g.app.inject({ method: 'POST', url: '/api/v1/auth/apikey', cookies })).json() as { apiKey: string };
    expect(renewed.apiKey).not.toBe(apiKey);
    expect((await g.app.inject({ url: '/api/v1/settings', headers: { 'x-api-key': apiKey } })).statusCode).toBe(401);
  });

  it('changes the password', async () => {
    const cookies = await setUp(g);
    const wrong = await g.app.inject({ method: 'POST', url: '/api/v1/auth/password', cookies, payload: { currentPassword: 'x', newPassword: 'another secret' } });
    expect(wrong.statusCode).toBe(400);
    const ok = await g.app.inject({ method: 'POST', url: '/api/v1/auth/password', cookies, payload: { currentPassword: 'correct horse', newPassword: 'another secret' } });
    expect(ok.statusCode).toBe(200);
    const login = await g.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'another secret' } });
    expect(login.statusCode).toBe(200);
  });
});

describe('login only from outside the network', () => {
  it('lets local requests in without a session, but not relayed or remote ones', async () => {
    const cookies = await setUp(g);
    await g.app.inject({ method: 'PUT', url: '/api/v1/settings', cookies, payload: { changes: { 'security.authMethod': 'external' } } });
    expect((await g.app.inject({ url: '/api/v1/settings', remoteAddress: '192.168.1.20' })).statusCode).toBe(200);
    expect((await g.app.inject({ url: '/api/v1/settings', remoteAddress: '203.0.113.9' })).statusCode).toBe(401);
    // A tunnel on the LAN relays an internet visitor: not trusted, so treated as external.
    const relayed = await g.app.inject({ url: '/api/v1/settings', remoteAddress: '172.18.0.5', headers: { 'cf-connecting-ip': '203.0.113.9' } });
    expect(relayed.statusCode).toBe(401);
  });
});

describe('isLocalAddress', () => {
  it('recognizes private, loopback and mapped addresses', () => {
    for (const ip of ['10.20.30.40', '192.168.0.4', '172.16.0.1', '172.31.255.255', '127.0.0.1', '::1', '::ffff:10.0.0.8', 'fd12::1']) {
      expect(isLocalAddress(ip), ip).toBe(true);
    }
    for (const ip of ['8.8.8.8', '172.32.0.1', '2001:db8::1', '::ffff:8.8.8.8', 'nonsense', undefined]) {
      expect(isLocalAddress(ip), String(ip)).toBe(false);
    }
  });
});
