import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNT_PASSWORD_IN_KEY } from './routes.js';
import { setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

describe('settings API', () => {
  it('returns every setting with defaults', async () => {
    const { values } = (await g.app.inject({ url: '/api/v1/settings', cookies })).json() as { values: Record<string, unknown> };
    expect(values['general.instanceName']).toBe('Squirrelcade');
    expect(values['platforms.minUniqueGames']).toBe(6);
  });

  it('saves valid changes and refuses the whole batch if one is invalid', async () => {
    const ok = await g.app.inject({ method: 'PUT', url: '/api/v1/settings', cookies, payload: { changes: { 'general.instanceName': 'Mark’s games' } } });
    expect(ok.statusCode).toBe(200);
    const bad = await g.app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      cookies,
      payload: { changes: { 'general.instanceName': 'Other', 'interface.pageSize': 0 } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().issues[0].key).toBe('interface.pageSize');
    expect(g.settings.get('general.instanceName')).toBe('Mark’s games');
  });

  it("refuses a key box holding an account's password, as a password manager fills one in", async () => {
    const put = (changes: Record<string, unknown>) => g.app.inject({ method: 'PUT', url: '/api/v1/settings', cookies, payload: { changes } });
    // The owner's password (setUp's) in IsThereAnyDeal's key box, with another change in the same save: nothing is saved.
    const refused = await put({ 'general.instanceName': 'Other', 'sources.itadKey': 'correct horse' });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().issues).toEqual([{ key: 'sources.itadKey', message: ACCOUNT_PASSWORD_IN_KEY }]);
    expect(g.settings.get('sources.itadKey')).toBe('');
    expect(g.settings.get('general.instanceName')).toBe('Squirrelcade');
    // A viewer's password too, and in a settings file.
    await g.auth.createUser('family', 'their own phrase', 'viewer');
    expect((await put({ 'sources.upcDatabaseKey': ' their own phrase ' })).statusCode).toBe(400);
    const file = { format: 'squirrelcade-settings', version: 1, settings: { 'notifications.pushoverToken': 'correct horse' } };
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/settings/import', cookies, payload: file })).statusCode).toBe(400);
    expect(g.settings.get('notifications.pushoverToken')).toBe('');
    // A real key is saved.
    expect((await put({ 'sources.itadKey': '0123456789abcdef0123456789abcdef01234567' })).statusCode).toBe(200);
    expect(g.settings.get('sources.itadKey')).toBe('0123456789abcdef0123456789abcdef01234567');
  });

  it('keeps changes across restarts and resets to defaults', async () => {
    await g.app.inject({ method: 'PUT', url: '/api/v1/settings', cookies, payload: { changes: { 'tasks.importScanMinutes': 5 } } });
    await g.restart();
    expect(g.settings.get('tasks.importScanMinutes')).toBe(5);
    g.settings.reset(['tasks.importScanMinutes']);
    expect(g.settings.get('tasks.importScanMinutes')).toBe(15);
    await g.restart();
    expect(g.settings.get('tasks.importScanMinutes')).toBe(15);
  });

  it('tells listeners only about settings whose value changed', async () => {
    const seen: string[][] = [];
    g.settings.events.on('changed', (keys) => seen.push([...keys]));
    // The instance name is already the default: only the currency changes.
    g.settings.update({ 'general.instanceName': 'Squirrelcade', 'general.currency': 'EUR' });
    g.settings.update({ 'general.currency': 'EUR' });
    expect(seen).toEqual([['general.currency']]);
  });

  it('exports only changed settings and imports them back', async () => {
    await g.app.inject({ method: 'PUT', url: '/api/v1/settings', cookies, payload: { changes: { 'general.currency': 'EUR', 'interface.theme': 'light' } } });
    const file = (await g.app.inject({ url: '/api/v1/settings/export', cookies })).json();
    expect(file.format).toBe('squirrelcade-settings');
    expect(file.settings).toEqual({ 'general.currency': 'EUR', 'interface.theme': 'light' });
    await g.app.inject({ method: 'POST', url: '/api/v1/settings/reset', cookies, payload: { keys: ['general.currency', 'interface.theme'] } });
    await g.app.inject({ method: 'PUT', url: '/api/v1/settings', cookies, payload: { changes: { 'interface.pageSize': 50 } } });
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/settings/import', cookies, payload: file });
    expect(res.statusCode).toBe(200);
    expect(g.settings.get('general.currency')).toBe('EUR');
    // An import replaces everything: settings not in the file go back to their defaults.
    expect(g.settings.get('interface.pageSize')).toBe(100);
  });

  it('never sends saved secrets back or puts them in exports', async () => {
    const put = await g.app.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      cookies,
      payload: { changes: { 'notifications.smtpPassword': 'hunter2-app-password', 'notifications.smtpUser': 'me@example.test' } },
    });
    const body = put.json() as { values: Record<string, unknown>; secretsSet: string[] };
    expect(body.values['notifications.smtpPassword']).toBe('');
    expect(body.secretsSet).toEqual(['notifications.smtpPassword']);
    expect((await g.app.inject({ url: '/api/v1/settings', cookies })).body).not.toContain('hunter2');
    const file = (await g.app.inject({ url: '/api/v1/settings/export', cookies })).json();
    expect(file.settings).toEqual({ 'notifications.smtpUser': 'me@example.test' });
    // Importing a file (which has no secrets) keeps the saved password.
    await g.app.inject({ method: 'POST', url: '/api/v1/settings/import', cookies, payload: file });
    expect(g.settings.get('notifications.smtpPassword')).toBe('hunter2-app-password');
    // Sending an empty value clears it.
    await g.app.inject({ method: 'PUT', url: '/api/v1/settings', cookies, payload: { changes: { 'notifications.smtpPassword': '' } } });
    expect(g.settings.get('notifications.smtpPassword')).toBe('');
  });

  it('refuses files that are not settings exports', async () => {
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/settings/import', cookies, payload: { hello: 'world' } });
    expect(res.statusCode).toBe(400);
  });

  it('describes the settings pages for other clients', async () => {
    const schema = (await g.app.inject({ url: '/api/v1/settings/schema', cookies })).json();
    expect(schema.pages.length).toBeGreaterThan(3);
    expect(schema.settings.find((s: { key: string }) => s.key === 'general.currency').options.length).toBeGreaterThan(1);
  });
});
