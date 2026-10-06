import { afterEach, describe, expect, it } from 'vitest';
import { exportCsv, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g?.cleanup();
});

/** A signed-in viewer's session cookie. */
const cookieOf = (res: { cookies: { name: string; value: string }[] }) => ({ squirrelcade_session: res.cookies.find((c) => c.name === 'squirrelcade_session')!.value });

describe('AI-assisted setup', () => {
  it("summarizes the install for the setup prompt, with links to its settings, and never a secret or an email address", async () => {
    // Xbox's read fails with an email address in its error.
    g = await testApp({
      features: ['igdb', 'xbox', 'steam', 'pc'],
      xboxGet: async () => {
        throw new Error('No Xbox profile for player@example.com');
      },
    });
    const cookies = await setUp(g);
    g.collection.importText(exportCsv([['11', 'Okami', 'Playstation 2', 1500], ['12', 'Journey', 'Playstation 3', 900]]), { fileName: 'collection_2026-09-30.csv', source: 'upload' });
    g.settings.update({
      'sources.igdbClientId': 'client-id',
      'sources.igdbClientSecret': 'SECRET-igdb-1',
      'sources.xboxApiKey': 'SECRET-xbox-2',
      'sources.steamApiKey': 'SECRET-steam-3',
      'notifications.pushoverEnabled': true,
      'notifications.pushoverToken': 'SECRET-push-4',
      'notifications.pushoverUser': 'SECRET-push-5',
      'notifications.smtpPassword': 'SECRET-smtp-6',
      'mail.password': 'SECRET-mail-7',
      'notifications.emailTo': ['owner@example.com'],
    });
    await g.tasks.runNow('xbox-sync');

    const res = await g.app.inject({ url: '/api/v1/system/ai-setup?address=http%3A%2F%2Fnas.local%3A7575%2Fhelp%2Fai-setup', cookies });
    expect(res.statusCode).toBe(200);
    const { state, links } = res.json() as { state: string; links: string };
    const all = state + links;
    expect(all).not.toMatch(/SECRET-/);
    expect(all).not.toMatch(/@example\.com/);
    expect(state).toContain('- **Address:** http://nas.local:7575');
    expect(state).toContain('- **Collection:** 2 copies (2 games) on 2 consoles');
    expect(state).toMatch(/Covers and game details from IGDB: on, set up; (not run yet|last run)/);
    expect(state).toContain('Steam achievements: on, still needs: Your Steam profile');
    expect(state).toContain('RomM links: off.');
    expect(state).toContain('- **Messages:** Pushover.');
    g.settings.update({ 'notifications.telegramEnabled': true });
    expect((await g.app.inject({ url: '/api/v1/system/ai-setup', cookies })).json().state).toContain('- **Messages:** Pushover; Telegram (still needs: Bot token, Chat ID).');
    expect(state).toMatch(/Xbox achievements: on, set up; failed on \d{4}-\d{2}-\d{2}: No Xbox profile for \(an email address\)\./);
    expect(state).toContain('PC library (Playnite): on, no Playnite backup folder set (readings uploaded by hand only); 0 games; no reading yet.');
    expect(state).toMatch(/The task "[^"]+" failed on \d{4}-\d{2}-\d{2}: No Xbox profile for \(an email address\)/);
    expect(links).toContain('- Steam achievements: http://nas.local:7575/settings/features#setting-features.steam (then: Steam Web API key, Your Steam profile)');
    expect(links).toContain('- Pushover: http://nas.local:7575/settings/notifications#setting-notifications.pushoverEnabled');
    expect(links).toContain('- Trusted proxies (Settings > Security > Network, advanced): http://nas.local:7575/settings/security#setting-security.trustedProxies');
    expect(links).toContain('- System > Users (Invite someone): http://nas.local:7575/system/users');

    // An address that isn't a web address: the setting's, else links from the page's own address (relative).
    const bad = (await g.app.inject({ url: '/api/v1/system/ai-setup?address=javascript%3Aalert(1)', cookies })).json() as { state: string; links: string };
    expect(bad.links).toContain('- Steam achievements: /settings/features#setting-features.steam');
    expect(bad.state).toContain('- **Address:** not known');
    g.settings.update({ 'general.publicUrl': 'https://games.example.org' });
    expect((await g.app.inject({ url: '/api/v1/system/ai-setup', cookies })).json().links).toContain('https://games.example.org/system/status');

    // The owner's alone.
    const invite = await g.app.inject({ method: 'POST', url: '/api/v1/invites', payload: { name: 'Sam' }, cookies });
    const viewer = cookieOf(await g.app.inject({ method: 'POST', url: `/api/v1${invite.json().path}`, payload: { username: 'sam', password: 'kitchen table' } }));
    expect((await g.app.inject({ url: '/api/v1/system/ai-setup', cookies: viewer })).statusCode).toBe(403);
  });

  it('describes a new install: an empty collection, no catalogs, the parts off', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    const { state } = (await g.app.inject({ url: '/api/v1/system/ai-setup?address=http://10.0.0.5:7575', cookies })).json() as { state: string };
    expect(state).toContain('- **Collection:** empty: the welcome guide comes next (an export, or games typed in with Add a game).');
    expect(state).toContain('- **Catalogs:** none yet');
    expect(state).toContain('PC library (Playnite): off.');
    expect(state).toContain('- **Messages:** none set up.');
  });
});
