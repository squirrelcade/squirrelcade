import { addDays, dayIn, isGameKeyCard, releaseReminder, type ReleaseLine } from '@squirrelcade/core';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { CatalogService } from './catalogs.js';
import type { Db } from './db/index.js';
import { appState } from './db/schema.js';
import type { NotificationService } from './notifications.js';
import type { SettingsService } from './settings.js';
import type { WishlistService } from './wishlist.js';

/** Where the games already reminded about are kept: "platform key|catalog entry id" → the release date reminded for. */
const REMINDED = 'notifications.releaseReminded';
/** How often the release reminder task looks for games coming out. */
export const RELEASE_CHECK_MS = 6 * 3_600_000;
/** Reminders older than this many days are forgotten (their games are out). */
const FORGET_DAYS = 60;


/**
 * Release reminders (Settings > Notifications > Release reminders): one message when games you don't have yet
 * come out on the consoles you collect, on the day or some days before, each game once for its release date.
 */
export class ReleaseReminders {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly catalogs: CatalogService,
    private readonly wishlist: WishlistService,
    private readonly notifications: NotificationService,
    private readonly log: Logger,
  ) {}

  /** The games due a reminder now, soonest first: out between today and the setting's days ahead, not reminded yet. */
  due(today = dayIn(this.settings.get('general.timeZone'))): (ReleaseLine & { key: string })[] {
    const until = addDays(today, this.settings.get('notifications.releaseReminderDays'));
    const minScore = this.settings.get('notifications.releaseReminderMinScore');
    const reminded = this.reminded();
    const snoozed = new Set(this.wishlist.snoozed().map((z) => `${z.platformKey}|${z.title.toLowerCase()}`));
    return this.catalogs
      .releasesBetween(today, until)
      .filter((g) => g.status !== 'owned')
      .filter((g) => reminded[`${g.platformKey}|${g.entryId}`] !== g.releaseDate)
      .filter((g) => minScore === 0 || (g.score ?? 0) >= minScore)
      .filter((g) => !snoozed.has(`${g.platformKey}|${g.title.toLowerCase()}`) && this.wishlist.preferenceOf(g.platformKey, g.title) !== 'Do Not Recommend')
      .map((g) => ({ key: `${g.platformKey}|${g.entryId}`, title: g.title, platform: g.platform, releaseDate: g.releaseDate, score: g.score, keyCard: isGameKeyCard(g.format) }));
  }

  /** Sends the reminder for the games due one; what it did, for the task's history. */
  async run(): Promise<string> {
    if (!this.settings.get('notifications.releaseReminders')) return 'Release reminders are off';
    if (this.notifications.channels().length === 0) return 'No way to send them: set one up in Settings > Notifications';
    const today = dayIn(this.settings.get('general.timeZone'));
    const games = this.due(today);
    if (games.length === 0) return 'No game due a reminder';
    const base = this.settings.get('general.publicUrl').replace(/\/+$/, '');
    const url = base ? `${base}/wishlist/coming-soon` : '';
    const report = releaseReminder({ instanceName: this.settings.get('general.instanceName') || 'Squirrelcade', today, games, url });
    const results = await this.notifications.send(report, url, 'summary');
    const sent = results.filter((r) => r.ok).map((r) => r.channel);
    if (sent.length === 0) throw new Error(`The reminder for ${games.length} game(s) couldn't be sent: ${results.map((r) => `${r.channel}: ${r.error ?? 'failed'}`).join('; ')}`);
    // Remembered once sent, so each game is reminded once for its date; old ones are forgotten.
    const keep = Object.entries(this.reminded()).filter(([, date]) => date >= addDays(today, -FORGET_DAYS));
    const next = Object.fromEntries([...keep, ...games.map((g): [string, string] => [g.key, g.releaseDate])]);
    this.db
      .insert(appState)
      .values({ key: REMINDED, value: JSON.stringify(next) })
      .onConflictDoUpdate({ target: appState.key, set: { value: JSON.stringify(next) } })
      .run();
    this.log.info({ context: 'notifications' }, `Release reminder for ${games.length} game(s) sent by ${sent.join(' and ')}`);
    return `Reminded about ${games.length} game(s) by ${sent.join(' and ')}`;
  }

  private reminded(): Record<string, string> {
    const row = this.db.select().from(appState).where(eq(appState.key, REMINDED)).get();
    try {
      return row ? (JSON.parse(row.value) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }
}
