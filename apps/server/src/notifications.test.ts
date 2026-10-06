import { afterEach, describe, expect, it } from 'vitest';
import { exportCsv, fakeTransports, multipart, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
let sent: ReturnType<typeof fakeTransports>['sent'];

async function start(fail: Parameters<typeof fakeTransports>[0] = {}) {
  const fake = fakeTransports(fail);
  sent = fake.sent;
  g = await testApp({ transports: fake.transports });
  cookies = await setUp(g);
}
afterEach(async () => {
  await g.cleanup();
});

function turnOn() {
  g.settings.update({
    'general.publicUrl': 'https://squirrelcade.example.test/',
    'notifications.emailEnabled': true,
    'notifications.smtpHost': 'smtp.example.test',
    'notifications.smtpUser': 'me@example.test',
    'notifications.smtpPassword': 'app-password',
    'notifications.emailTo': ['me@example.test'],
    'notifications.pushoverEnabled': true,
    'notifications.pushoverToken': 'app-token',
    'notifications.pushoverUser': 'user-key',
  });
}

/** A collection and a PS3 catalog, so there is a wishlist to report on. */
async function loadCatalog() {
  seedCatalogs(g, {
    owned: [['1', 'Uncharted', 'Playstation 3']],
    catalogs: { 'playstation-3': ['Uncharted', 'Tales of Graces f', 'Okami HD', 'Ni no Kuni', 'Valkyria Chronicles'] },
  });
  await g.notifications.idle();
}

async function upload(games: [string, string, string, number][], fileName = 'collection_20260927.csv') {
  const { payload, headers } = multipart(fileName, exportCsv(games));
  const res = await g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, payload, headers });
  await g.notifications.idle();
  return res;
}

describe('notifications', () => {
  it('saves a wishlist snapshot for every applied import, even with messages off', async () => {
    await start();
    await loadCatalog();
    const first = g.notifications.lastSnapshot();
    expect(first?.entries.map((e) => e.title).sort()).toEqual(['Ni no Kuni', 'Okami HD', 'Tales of Graces f', 'Valkyria Chronicles']);
    await upload([['1', 'Uncharted', 'Playstation 3', 1000], ['2', 'Okami HD', 'Playstation 3', 2000]]);
    expect(g.notifications.lastSnapshot()?.entries.map((e) => e.title)).not.toContain('Okami HD');
    expect(sent.mail).toHaveLength(0);
    expect(sent.push).toHaveLength(0);
  });

  it('sends the additions-first summary by email and Pushover', async () => {
    await start();
    turnOn();
    await loadCatalog();
    // The first import says how many games arrived instead of listing them.
    expect(sent.mail[0]?.subject).toBe('Squirrelcade: collection added');
    expect(sent.mail[0]?.text).toContain('This was your first collection update: 1 game (1 copy) are now in Squirrelcade.');

    await upload([['1', 'Uncharted', 'Playstation 3', 1000], ['2', 'Okami HD', 'Playstation 3', 2000]]);
    const mail = sent.mail[1]!;
    expect(mail).toMatchObject({ host: 'smtp.example.test', port: 587, user: 'me@example.test', pass: 'app-password', from: '"Squirrelcade" <me@example.test>', to: ['me@example.test'] });
    expect(mail.subject).toBe('Squirrelcade: 1 game added');
    expect(mail.text.startsWith('WHAT WAS ADDED TO THE COLLECTION\n- Okami HD (Playstation 3)')).toBe(true);
    expect(mail.text).toContain('SUMMARY\ncollection_20260927.csv: 2 games, 2 copies.');
    expect(mail.text).toContain('TOP PICKS\n1. ');
    expect(mail.text).toMatch(/Gone:\n- Okami HD \(PlayStation 3\), was #\d/);
    expect(mail.text).toContain('Open Squirrelcade: https://squirrelcade.example.test');
    expect(mail.html).toContain('<a href="https://squirrelcade.example.test">');

    const push = sent.push[1]!;
    expect(push).toMatchObject({ token: 'app-token', user: 'user-key', title: 'Squirrelcade: 1 game added', url: 'https://squirrelcade.example.test' });
    expect(push.message.startsWith('Added: Okami HD. Top pick: ')).toBe(true);
  });

  it('mentions the biggest price moves', async () => {
    await start();
    turnOn();
    await loadCatalog();
    await upload([['1', 'Uncharted', 'Playstation 3', 1500], ['2', 'Okami HD', 'Playstation 3', 2000]]);
    expect(sent.mail.at(-1)!.text).toContain('PRICE MOVES\n- Uncharted (PlayStation 3): $10.00 → $15.00 (+50%)');
  });

  it('can be limited to problems only', async () => {
    await start();
    turnOn();
    g.settings.update({ 'notifications.onImport': false });
    await loadCatalog();
    await upload([['1', 'Uncharted', 'Playstation 3', 1000], ['2', 'Okami HD', 'Playstation 3', 2000]]);
    expect(sent.mail).toHaveLength(0);
    // A file with a missing column is refused, and that is worth a message.
    const { payload, headers } = multipart('collection_bad.csv', 'id,product-name\n1,Uncharted');
    await g.app.inject({ method: 'POST', url: '/api/v1/imports', cookies, payload, headers });
    await g.notifications.idle();
    expect(sent.mail).toHaveLength(1);
    expect(sent.mail[0]!.subject).toBe('Squirrelcade: collection update refused');
    expect(sent.mail[0]!.text).toContain('Your collection could not be updated from collection_bad.csv');
    expect(sent.mail[0]!.text).toContain('Open Squirrelcade: https://squirrelcade.example.test/updates');
  });

  it('alerts when an import is held for confirmation and when a task fails', async () => {
    await start();
    turnOn();
    g.settings.update({ 'notifications.onImport': false });
    await loadCatalog();
    await upload([['1', 'Uncharted', 'Playstation 3', 1000], ['2', 'Okami HD', 'Playstation 3', 2000], ['3', 'Ni no Kuni', 'Playstation 3', 2000]]);
    // Keeping only one of the three games removes 67%: held, with a message.
    await upload([['3', 'Ni no Kuni', 'Playstation 3', 2000]], 'collection_20260928.csv');
    expect(sent.mail.at(-1)!.subject).toBe('Squirrelcade: collection update waiting for you');
    expect(sent.mail.at(-1)!.text).toContain('collection_20260928.csv was not applied yet: Waiting for confirmation');

    g.tasks.register({ name: 'broken', title: 'Broken task', description: '', interval: () => null, run: async () => Promise.reject(new Error('disk full')) });
    await g.tasks.runNow('broken');
    await g.notifications.idle();
    expect(sent.push.at(-1)).toMatchObject({ title: 'Squirrelcade: broken task failed', message: 'Broken task failed: disk full' });

    g.settings.update({ 'notifications.onFailure': false });
    await g.tasks.runNow('broken');
    await g.notifications.idle();
    expect(sent.push.at(-1)!.message).toBe('Broken task failed: disk full');
    expect(sent.push.filter((p) => p.title.includes('broken task'))).toHaveLength(1);
  });

  it('sends each kind of message at its own Pushover priority', async () => {
    await start();
    turnOn();
    g.settings.update({ 'notifications.pushoverPrioritySummary': '-1', 'notifications.pushoverPriorityWaiting': '0', 'notifications.pushoverPriorityProblem': '1' });
    await loadCatalog();
    await upload([['1', 'Uncharted', 'Playstation 3', 1000], ['2', 'Okami HD', 'Playstation 3', 2000], ['3', 'Ni no Kuni', 'Playstation 3', 2000]]);
    expect(sent.push.at(-1)).toMatchObject({ title: 'Squirrelcade: 2 games added', priority: -1 });
    await upload([['3', 'Ni no Kuni', 'Playstation 3', 2000]], 'collection_20260928.csv');
    expect(sent.push.at(-1)).toMatchObject({ title: 'Squirrelcade: collection update waiting for you', priority: 0 });
    g.tasks.register({ name: 'broken', title: 'Broken task', description: '', interval: () => null, run: async () => Promise.reject(new Error('disk full')) });
    await g.tasks.runNow('broken');
    await g.notifications.idle();
    expect(sent.push.at(-1)).toMatchObject({ title: 'Squirrelcade: broken task failed', priority: 1 });
    // The test message always goes at normal priority.
    await g.notifications.test();
    expect(sent.push.at(-1)).toMatchObject({ title: 'Squirrelcade: test message', priority: 0 });
  });

  it('alerts once for each new health problem', async () => {
    await start();
    turnOn();
    g.settings.update({ 'storage.importFolder': '/nowhere/squirrelcade-imports' });
    const first = await g.tasks.runNow('health-check');
    await g.notifications.idle();
    expect(first?.message).toMatch(/problem\(s\), \d+ new/);
    const alert = sent.push.at(-1)!;
    expect(alert.title).toBe('Squirrelcade: needs attention');
    expect(alert.message).toContain("Watched folder /nowhere/squirrelcade-imports doesn't exist.");
    const count = sent.push.length;
    await g.tasks.runNow('health-check');
    await g.notifications.idle();
    expect(sent.push.length).toBe(count);
  });

  it('sends a test message and reports a channel that fails without stopping the other', async () => {
    await start({ email: 'Invalid login: 535 Authentication failed' });
    const none = await g.app.inject({ method: 'POST', url: '/api/v1/notifications/test', cookies });
    expect(none.statusCode).toBe(400);
    turnOn();
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/notifications/test', cookies });
    expect(res.json().results).toEqual([
      { channel: 'email', ok: false, error: 'Invalid login: 535 Authentication failed' },
      { channel: 'pushover', ok: true },
    ]);
    expect(sent.push[0]!.title).toBe('Squirrelcade: test message');
  });

  it('saves a starting snapshot during clean-up when an older install has none', async () => {
    await start();
    await loadCatalog();
    g.db.$client.prepare('delete from wishlist_snapshots').run();
    expect(g.notifications.lastSnapshot()).toBeNull();
    const run = await g.tasks.runNow('housekeeping');
    expect(run?.message).toContain('first wishlist snapshot saved');
    expect(g.notifications.lastSnapshot()?.entries.length).toBe(4);
    expect((await g.tasks.runNow('housekeeping'))?.message).not.toContain('snapshot');
  });

  it('keeps a limited number of snapshots', async () => {
    await start();
    await loadCatalog();
    for (let i = 0; i < 35; i++) g.db.$client.prepare("insert into wishlist_snapshots (import_id, created_at, entries) values (null, '2026-01-01', '[]')").run();
    await upload([['1', 'Uncharted', 'Playstation 3', 1000], ['2', 'Okami HD', 'Playstation 3', 2000]]);
    const count = g.db.$client.prepare('select count(*) as n from wishlist_snapshots').get() as { n: number };
    expect(count.n).toBe(30);
    expect(g.notifications.lastSnapshot()?.entries.length).toBeGreaterThan(0);
  });
});

describe('more ways to send messages', () => {
  /** Every push and chat service on and filled in, with made-up addresses and keys. */
  function allServices() {
    g.settings.update({
      'general.publicUrl': 'https://squirrelcade.example.test',
      'notifications.pushbulletEnabled': true,
      'notifications.pushbulletToken': 'pb-token',
      'notifications.ntfyEnabled': true,
      'notifications.ntfyServer': 'https://ntfy.example.test/',
      'notifications.ntfyTopic': 'squirrelcade-test',
      'notifications.ntfyToken': 'tk_test',
      'notifications.gotifyEnabled': true,
      'notifications.gotifyServer': 'https://gotify.example.test',
      'notifications.gotifyToken': 'gotify-token',
      'notifications.discordEnabled': true,
      'notifications.discordWebhook': 'https://discord.example.test/api/webhooks/1/secret',
      'notifications.telegramEnabled': true,
      'notifications.telegramToken': '123:bot-token',
      'notifications.telegramChatId': '42',
      'notifications.slackEnabled': true,
      'notifications.slackWebhook': 'https://hooks.slack.example.test/services/T/B/X',
      'notifications.webhookEnabled': true,
      'notifications.webhookUrl': 'https://n8n.example.test/webhook/squirrelcade',
      'notifications.webhookAuth': 'Bearer abc123',
      'notifications.appriseEnabled': true,
      'notifications.appriseUrl': 'http://apprise.example.test:8000/notify/squirrelcade',
    });
  }
  const posted = (part: string) => sent.posts.find((p) => p.url.includes(part))!;

  it('sends through each service it has, each its own way', async () => {
    await start();
    allServices();
    expect(g.notifications.channels()).toEqual(['pushbullet', 'ntfy', 'gotify', 'discord', 'telegram', 'slack', 'webhook', 'apprise']);
    const results = await g.notifications.test();
    expect(results.every((r) => r.ok)).toBe(true);
    expect(sent.posts).toHaveLength(8);
    const link = 'https://squirrelcade.example.test';
    expect(posted('pushbullet')).toMatchObject({ url: 'https://api.pushbullet.com/v2/pushes', headers: { 'Access-Token': 'pb-token' }, body: { type: 'link', title: 'Squirrelcade: test message', url: link } });
    expect(posted('ntfy')).toMatchObject({ url: 'https://ntfy.example.test/', headers: { Authorization: 'Bearer tk_test' }, body: { topic: 'squirrelcade-test', title: 'Squirrelcade: test message', priority: 3, click: link } });
    expect(posted('gotify')).toMatchObject({ url: 'https://gotify.example.test/message', headers: { 'X-Gotify-Key': 'gotify-token' }, body: { priority: 5, extras: { 'client::notification': { click: { url: link } } } } });
    expect(String(posted('discord').body.content)).toMatch(/^\*\*Squirrelcade: test message\*\*\nThis is a test message/);
    expect(posted('telegram')).toMatchObject({ url: 'https://api.telegram.org/bot123:bot-token/sendMessage', body: { chat_id: '42', link_preview_options: { is_disabled: true } } });
    expect(String(posted('slack').body.text)).toMatch(/^\*Squirrelcade: test message\*\n/);
    expect(posted('n8n')).toMatchObject({ headers: { Authorization: 'Bearer abc123' }, body: { app: 'Squirrelcade', kind: 'test', importance: 0, title: 'Squirrelcade: test message', url: link } });
    expect(posted('apprise')).toMatchObject({ body: { title: 'Squirrelcade: test message', type: 'info', format: 'text' } });
  });

  it('alerts a failing task once, at most daily while it keeps failing, and once when it works again', async () => {
    await start();
    turnOn();
    const subjects = () => sent.mail.map((m) => m.subject);
    const t0 = new Date('2026-10-04T12:00:00Z');
    const fail = (minutes: number) => g.notifications.taskFailed('mail-import', 'Check your email for exports', 'Invalid credentials', new Date(t0.getTime() + minutes * 60_000));
    fail(0);
    fail(30);
    fail(60 * 23);
    await g.notifications.idle();
    expect(subjects()).toEqual(['Squirrelcade: check your email for exports failed']);
    fail(60 * 25);
    await g.notifications.idle();
    expect(subjects()[1]).toBe('Squirrelcade: check your email for exports still fails');
    expect(sent.mail[1]!.text).toContain('failing since 2026-10-04');
    g.notifications.taskSucceeded('mail-import', 'Check your email for exports');
    g.notifications.taskSucceeded('mail-import', 'Check your email for exports');
    g.notifications.taskSucceeded('backup', 'Back up database');
    await g.notifications.idle();
    expect(subjects().slice(2)).toEqual(['Squirrelcade: check your email for exports works again']);
    // Failing again later starts over: one alert.
    fail(60 * 30);
    await g.notifications.idle();
    expect(subjects()).toHaveLength(4);
  });

  it('marks how urgent a message is where a service has that, and says what a refusing service answered', async () => {
    await start();
    allServices();
    g.settings.update({ 'notifications.pushoverPriorityProblem': '2' });
    g.notifications.taskFailed('backup', 'Backup', 'the disk is full');
    await g.notifications.idle();
    expect(posted('ntfy').body).toMatchObject({ priority: 5, title: 'Squirrelcade: backup failed' });
    expect(posted('gotify').body).toMatchObject({ priority: 10 });
    expect(posted('n8n').body).toMatchObject({ kind: 'problem', importance: 2 });
    expect(posted('apprise').body).toMatchObject({ type: 'failure' });
    // A service that refuses: its answer, never its address (which holds its secret).
    await g.cleanup();
    await start({ post: { 'discord.example.test': 'Unknown Webhook' } });
    allServices();
    const results = await g.notifications.test();
    const discord = results.find((r) => r.channel === 'discord')!;
    expect(discord).toEqual({ channel: 'discord', ok: false, error: 'Discord answered 500: Unknown Webhook' });
    expect(results.filter((r) => r.ok)).toHaveLength(7);
  });

  it("leaves out a service that's on but not filled in, and refuses addresses that aren't web addresses", async () => {
    await start();
    g.settings.update({ 'notifications.ntfyEnabled': true, 'notifications.gotifyEnabled': true, 'notifications.gotifyServer': 'https://gotify.example.test' });
    expect(g.notifications.channels()).toEqual([]);
    const bad = await g.app.inject({ method: 'PUT', url: '/api/v1/settings', cookies, payload: { changes: { 'notifications.ntfyServer': 'ntfy.example.test', 'notifications.discordWebhook': 'discord webhook' } } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().issues.map((i: { key: string }) => i.key).sort()).toEqual(['notifications.discordWebhook', 'notifications.ntfyServer']);
  });

  it('finds the chats a Telegram bot has had messages from, for its chat ID', async () => {
    const fake = fakeTransports();
    const plain = fake.transports.post!;
    fake.transports.post = async (url, init) => {
      if (!url.endsWith('/getUpdates')) return plain(url, init);
      if (url.includes('/botwrong/')) return new Response('{"ok":false}', { status: 401 });
      return Response.json({
        ok: true,
        result: [
          { update_id: 1, message: { chat: { id: 42, type: 'private', first_name: 'Sam', last_name: 'Doe' } } },
          { update_id: 2, message: { chat: { id: -100, type: 'group', title: 'Game night' } } },
          { update_id: 3, message: { chat: { id: 42, type: 'private', first_name: 'Sam', last_name: 'Doe' } } },
        ],
      });
    };
    sent = fake.sent;
    g = await testApp({ transports: fake.transports });
    cookies = await setUp(g);
    const find = () => g.app.inject({ method: 'POST', url: '/api/v1/notifications/telegram/chats', cookies });
    expect((await find()).json()).toMatchObject({ error: 'no-token' });
    g.settings.update({ 'notifications.telegramToken': 'wrong' });
    expect((await find()).json()).toMatchObject({ message: "Telegram didn't accept the bot token: copy it again from @BotFather." });
    g.settings.update({ 'notifications.telegramToken': '123:bot-token' });
    expect((await find()).json()).toEqual({
      chats: [
        { id: '42', name: 'Sam Doe', type: 'private' },
        { id: '-100', name: 'Game night', type: 'group' },
      ],
      message: null,
    });
  });
});
