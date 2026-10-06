import { afterEach, describe, expect, it } from 'vitest';
import { resetLink } from './resetLink.js';
import { setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp | undefined;
const before = process.env.SQUIRRELCADE_CONFIG_DIR;
afterEach(async () => {
  process.env.SQUIRRELCADE_CONFIG_DIR = before;
  if (before === undefined) delete process.env.SQUIRRELCADE_CONFIG_DIR;
  await g?.cleanup();
  g = undefined;
});

describe('the reset link', () => {
  it("prints a link that lets the owner choose a new password, once, and signs them out elsewhere", async () => {
    g = await testApp();
    process.env.SQUIRRELCADE_CONFIG_DIR = g.dir;
    // No account yet: nothing to reset.
    expect(resetLink([])).toEqual({ ok: false, message: expect.stringContaining('no account yet') });
    const cookies = await setUp(g);
    expect(resetLink(['nobody'])).toEqual({ ok: false, message: 'No account is called "nobody".' });

    const printed = resetLink([]);
    expect(printed.ok).toBe(true);
    const token = /\/join\/([A-Za-z0-9_-]+)/.exec(printed.message)![1]!;
    expect((await g.app.inject({ url: `/api/v1/join/${token}` })).json()).toMatchObject({ username: 'admin' });
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/join/${token}`, payload: { password: 'a brand new one' } })).statusCode).toBe(201);
    // The old sign-in is over; the new password works; the link doesn't twice.
    expect((await g.app.inject({ url: '/api/v1/auth/session', cookies })).json().authenticated).toBe(false);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'admin', password: 'a brand new one' } })).statusCode).toBe(200);
    expect((await g.app.inject({ url: `/api/v1/join/${token}` })).statusCode).toBe(404);
  });
});
