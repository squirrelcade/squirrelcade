import pino from 'pino';
import { afterEach, describe, expect, it } from 'vitest';
import { dayIn } from '@squirrelcade/core';
import { ReleaseReminders } from './reminders.js';
import { fakeTransports, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

const inDays = (day: string, days: number) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe('release reminders', () => {
  it("reminds once about games you don't have that come out, as early as set, leaving out the ones you don't want", async () => {
    const fake = fakeTransports();
    g = await testApp({ transports: fake.transports });
    await setUp(g);
    const today = dayIn(g.settings.get('general.timeZone'));
    seedCatalogs(g, {
      owned: ['Celeste', 'Cuphead', 'Gris', 'Tunic', 'Ori', 'Inside', 'Owned Today'].map((t, i): [string, string, string] => [String(i + 1), t, 'Nintendo Switch']),
      catalogs: {
        'nintendo-switch': [
          { title: 'Out Today', evidence: 'list', releaseDate: today },
          { title: 'Owned Today', evidence: 'list', releaseDate: today },
          { title: 'Key Card Today', evidence: 'list', releaseDate: today, format: 'Game-Key Card' },
          { title: 'Next Week', evidence: 'list', releaseDate: inDays(today, 5) },
          { title: 'Someday', evidence: 'list', releaseDate: 'TBA' },
          { title: 'Celeste', evidence: 'list', releaseDate: '2018-01-25' },
        ],
      },
    });
    // The collection's own update summary goes (to no channel yet) before the reminders are tried.
    await g.notifications.idle();
    g.settings.update({ 'notifications.pushoverEnabled': true, 'notifications.pushoverToken': 'app-token', 'notifications.pushoverUser': 'user-key', 'general.publicUrl': 'https://squirrelcade.example.test' });
    const reminders = new ReleaseReminders(g.db, g.settings, g.catalogs, g.wishlist, g.notifications, pino({ level: 'silent' }));

    // Off by default.
    expect(await reminders.run()).toBe('Release reminders are off');
    g.settings.update({ 'notifications.releaseReminders': true });
    // On the day: the games out today you don't have, never the one you own.
    expect(reminders.due().map((x) => x.title)).toEqual(['Key Card Today', 'Out Today']);
    expect(await reminders.run()).toBe('Reminded about 2 game(s) by pushover');
    expect(fake.sent.push).toHaveLength(1);
    expect(fake.sent.push[0]).toMatchObject({ title: 'Squirrelcade: 2 games out today', url: 'https://squirrelcade.example.test/wishlist/coming-soon' });
    expect(fake.sent.push[0]!.message).toContain('Today: Out Today (Nintendo Switch)');
    // Each game once.
    expect(await reminders.run()).toBe('No game due a reminder');
    expect(fake.sent.push).toHaveLength(1);

    // A week ahead brings the game out in 5 days; not one without a date.
    g.settings.update({ 'notifications.releaseReminderDays': 7 });
    expect(reminders.due().map((x) => x.title)).toEqual(['Next Week']);
    // A game marked Do Not Recommend, or scoring under the least score set, is left out.
    g.wishlist.setPreference('nintendo-switch', 'Next Week', 'Do Not Recommend', null);
    expect(reminders.due()).toEqual([]);
    g.wishlist.setPreference('nintendo-switch', 'Next Week', null, null);
    g.settings.update({ 'notifications.releaseReminderMinScore': 100 });
    expect(reminders.due()).toEqual([]);
    g.settings.update({ 'notifications.releaseReminderMinScore': 0 });
    expect(reminders.due()[0]).toMatchObject({ title: 'Next Week', keyCard: false });

    // With no way to send, it says so instead of failing.
    g.settings.update({ 'notifications.pushoverEnabled': false });
    expect(await reminders.run()).toMatch(/^No way to send them/);
  });
});
