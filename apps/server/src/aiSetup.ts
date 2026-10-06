import { CHANNEL_NAMES, CHANNEL_SWITCHES, CHANNELS, FEATURE_SETTINGS, FEATURE_SETUP, settingDefinitions, SETTINGS_PAGES, type Channel, type FeatureKey, type SettingDefinition, type SettingKey } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import type { AuthService } from './auth.js';
import type { BackupService } from './backups.js';
import type { CatalogService } from './catalogs.js';
import type { CollectionService } from './collection.js';
import { APP_VERSION, type Env } from './env.js';
import type { PcService } from './pc.js';
import type { SettingsService } from './settings.js';
import type { ShareService } from './share.js';
import type { TaskRunner } from './tasks.js';

/** The task that shows whether each optional part works (its last run), if it has one. */
const FEATURE_TASK: Partial<Record<FeatureKey, string>> = {
  igdb: 'igdb-sync',
  pc: 'pc-read',
  romm: 'romm-sync',
  itad: 'pc-prices',
  mail: 'mail-import',
  retroachievements: 'ra-sync',
  xbox: 'xbox-sync',
  playstation: 'psn-sync',
  steam: 'steam-sync',
};

/** What each way of sending messages needs before it sends (its other fields are optional). */
const CHANNEL_NEEDS: Record<Channel, SettingKey[]> = {
  email: ['notifications.smtpHost', 'notifications.smtpUser', 'notifications.smtpPassword', 'notifications.emailTo'],
  pushover: ['notifications.pushoverToken', 'notifications.pushoverUser'],
  pushbullet: ['notifications.pushbulletToken'],
  ntfy: ['notifications.ntfyServer', 'notifications.ntfyTopic'],
  gotify: ['notifications.gotifyServer', 'notifications.gotifyToken'],
  discord: ['notifications.discordWebhook'],
  telegram: ['notifications.telegramToken', 'notifications.telegramChatId'],
  slack: ['notifications.slackWebhook'],
  webhook: ['notifications.webhookUrl'],
  apprise: ['notifications.appriseUrl'],
};

/** The settings the brief links to beyond the parts' switches and the ways to send messages, in the order it lists them. */
const LINKED: SettingKey[] = [
  'general.publicUrl',
  'general.timeZone',
  'security.authMethod',
  'security.trustedProxies',
  'security.viewersSeePaid',
  'security.publicCheck',
  'storage.backupCopyFolder',
  'storage.backupRetention',
  'collection.dropFolderEnabled',
  'collection.exportReminderDays',
  'sources.barcodeLookup',
  'sources.upcDatabaseKey',
  'collection.goal',
  'selling.ebayFeePercent',
  'collection.ripConsoles',
];

/** The pages the brief links to. */
const PAGES: [string, string][] = [
  ['/welcome', 'The welcome guide (your games in, consoles, catalogs, covers, the wishlist)'],
  ['/collection/add', 'Acorns > Add a game (a game typed in by hand)'],
  ['/updates', 'Stash > Stash updates (upload an export; Send to PriceCharting)'],
  ['/system/status', 'System > Status (health, the setup checklist, the support file)'],
  ['/system/tasks', 'System > Tasks (each background job, and why one failed)'],
  ['/system/logs', 'System > Logs'],
  ['/system/backups', 'System > Backups (Back up now, restore)'],
  ['/system/users', 'System > Users (Invite someone)'],
  ['/wishlist', 'Acorns > Acorns wishlist (Share makes a gift link)'],
  ['/store', 'Store Mode'],
  ['/help', 'Help (the guides)'],
];

/** An email address in a message becomes "(an email address)": the brief goes to someone else's AI. */
const scrub = (text: string) => text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '(an email address)');

const has = (value: unknown) => (Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? value.trim() !== '' : value !== null && value !== undefined);

/** "http://nas:7575" from what the page gives (its own address), else the setting, else nothing (relative links). */
export function briefAddress(given: unknown, publicUrl: string): string {
  const pick = (s: string) => {
    try {
      const u = new URL(s);
      return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
    } catch {
      return '';
    }
  };
  return (typeof given === 'string' && pick(given)) || pick(publicUrl) || '';
}

export interface BriefDeps {
  env: Env;
  settings: SettingsService;
  collection: CollectionService;
  catalogs: CatalogService;
  backups: BackupService;
  tasks: TaskRunner;
  pc: PcService;
  auth: AuthService;
  shares: ShareService;
  /** System > Status's problems (folders, space, backups, the parts' own). */
  health: () => { level: 'warning' | 'error'; message: string }[];
}

/**
 * Help > AI-assisted setup (0.29.0, D93): the two parts of the setup brief (docs/ai/setup-prompt.md) that only this
 * install knows, in Markdown. "My Squirrelcade now": the version, the collection, backups, each optional part (on, set up,
 * its last run), messages, sign-in and sharing, and what needs attention. "Where things are": a link to each place on
 * this install. Never a password, key or token (only whether one is set), and email addresses are left out.
 */
export function setupBrief(deps: BriefDeps, address: string, now = new Date()): { state: string; links: string } {
  const { settings } = deps;
  const values = settings.all() as Record<string, unknown>;
  const on = (k: FeatureKey) => settings.get(FEATURE_SETTINGS[k]) === true;
  const label = (k: SettingKey) => (settingDefinitions[k] as SettingDefinition).label;
  // A choice as Settings shows it ("Only from outside the local network"), else the value.
  const shown = (k: SettingKey) => {
    const v = settings.get(k);
    const options = (settingDefinitions[k] as { options?: { value: unknown; label: string }[] }).options;
    return options?.find((o) => o.value === v)?.label ?? String(v);
  };
  const summary = deps.collection.summary();
  const catalogs = deps.catalogs.summary();
  const catalogGames = catalogs.reduce((sum, p) => sum + (p.targets ?? 0), 0);
  const backups = deps.backups.list();
  const tasks = new Map(deps.tasks.list().map((t) => [t.name, t]));
  const users = deps.auth.users();
  const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : 'never');
  // A part's task: when it last worked, or why it failed (its message only then: a success's is just counts).
  const lastRun = (name: string | undefined) => {
    const run = name ? tasks.get(name)?.lastRun : null;
    if (!run) return 'not run yet';
    if (run.status === 'failed') return `failed on ${day(run.startedAt)}: ${scrub(run.message ?? 'no message').slice(0, 200)}`;
    return run.status === 'running' ? 'running now' : `last run ${day(run.startedAt)}: ${run.status}`;
  };

  const lines: string[] = [];
  lines.push(`Summarized by Squirrelcade on ${day(now.toISOString())}. It never includes passwords, keys or tokens: only whether each is set.`);
  lines.push('');
  lines.push(`- **Installed:** yes, version ${APP_VERSION}${deps.env.inDocker ? ', in Docker' : ''} (${process.platform} ${process.arch}).`);
  lines.push(`- **Address:** ${address || 'not known'}${settings.get('general.publicUrl') ? '' : ` (Settings > General > ${label('general.publicUrl')} isn't set)`}.`);
  lines.push(`- **Region, currency and time zone:** ${shown('general.homeRegion')}, ${settings.get('general.currency')}, ${settings.get('general.timeZone') || 'no time zone set'}.`);
  const current = summary.currentImport;
  lines.push(
    summary.totals.copies > 0
      ? `- **Collection:** ${summary.totals.copies} copies (${summary.totals.games} games) on ${summary.totals.platforms} consoles; the last update from a file ${current?.appliedAt ? `on ${day(current.appliedAt)}` : 'never'}.`
      : '- **Collection:** empty: the welcome guide comes next (an export, or games typed in with Add a game).',
  );
  lines.push(catalogs.length > 0 ? `- **Catalogs:** ${catalogs.length} consoles, ${catalogGames} games.` : '- **Catalogs:** none yet (built after the first collection update).');
  lines.push(
    `- **Backups:** ${backups.length > 0 ? `${backups.length}, the newest ${day(backups[0]!.createdAt)}` : 'none yet'}; second backup folder ${deps.backups.copyFolder() ? 'set' : 'not set'}.`,
  );
  lines.push(`- **Watched folder:** ${settings.get('collection.dropFolderEnabled') ? 'on' : 'off'}.`);
  lines.push('- **Optional parts** (Settings > Features):');
  for (const k of Object.keys(FEATURE_SETTINGS) as FeatureKey[]) {
    const name = label(FEATURE_SETTINGS[k] as SettingKey);
    if (!on(k)) {
      lines.push(`  - ${name}: off.`);
      continue;
    }
    const missing = FEATURE_SETUP[k].filter((key) => !has(values[key])).map((key) => label(key));
    if (k === 'pc') {
      // The PC library reads Playnite's backups from its folder, or takes a reading uploaded by hand.
      const pc = deps.pc.status();
      const read = pc.lastRead ? `the last reading ${day(pc.lastRead.readAt)}: ${pc.lastRead.status}${pc.lastRead.status === 'failed' && pc.lastRead.message ? ` (${scrub(pc.lastRead.message).slice(0, 200)})` : ''}` : 'no reading yet';
      lines.push(`  - ${name}: on, ${missing.length === 0 ? 'its folder set' : `no ${missing.join(', ')} set (readings uploaded by hand only)`}; ${pc.families} games; ${read}.`);
      continue;
    }
    lines.push(`  - ${name}: on, ${missing.length === 0 ? 'set up' : `still needs: ${missing.join(', ')}`}${FEATURE_TASK[k] ? `; ${lastRun(FEATURE_TASK[k])}` : ''}.`);
  }
  // The ways of sending that are on, and what each still needs.
  const channels = CHANNELS.filter((c) => values[CHANNEL_SWITCHES[c]] === true).map((c) => {
    const missing = CHANNEL_NEEDS[c].filter((key) => !has(values[key])).map((key) => label(key));
    return missing.length === 0 ? CHANNEL_NAMES[c] : `${CHANNEL_NAMES[c]} (still needs: ${missing.join(', ')})`;
  });
  lines.push(`- **Messages:** ${channels.length > 0 ? channels.join('; ') : 'none set up'}.`);
  lines.push(`- **Barcodes:** ${shown('sources.barcodeLookup')}${settings.get('sources.upcDatabaseKey') ? ' (UPC Database key set)' : ''}.`);
  lines.push(
    `- **Sign-in and sharing:** login required: ${shown('security.authMethod').toLowerCase()}; trusted proxies ${(settings.get('security.trustedProxies') as string[]).length > 0 ? 'set' : 'not set'}; checking a game without signing in: ${shown('security.publicCheck').toLowerCase()}; ${users.filter((u) => u.role === 'viewer').length} viewers; ${deps.shares.list().length} share links.`,
  );
  const goal = settings.get('collection.goal');
  if (goal > 0) lines.push(`- **Goal:** ${goal} ${settings.get('collection.goalCounts')}.`);
  const problems = deps.health();
  const failing = [...tasks.values()].filter((t) => t.lastRun?.status === 'failed');
  if (problems.length > 0 || failing.length > 0) {
    lines.push('- **Needs attention:**');
    for (const p of problems) lines.push(`  - ${p.level === 'error' ? 'Error' : 'Warning'}: ${scrub(p.message)}`);
    for (const t of failing) lines.push(`  - The task "${t.title}" failed on ${day(t.lastRun!.startedAt)}: ${scrub(t.lastRun!.message ?? 'no message').slice(0, 200)}`);
  } else lines.push('- **Needs attention:** nothing.');

  const link = (path: string) => `${address}${path}`;
  const settingLink = (k: SettingKey) => {
    const d = settingDefinitions[k] as SettingDefinition;
    return link(`${d.page === 'wishlist' ? '/acorns' : `/settings/${d.page}`}#setting-${k}`);
  };
  const out: string[] = [];
  out.push('Links on this install. Each part is set up on its card (Settings > Sources; the email account on Settings > Email), its switch included; advanced settings show with "Show advanced".');
  out.push('');
  out.push('**Optional parts** (turn one on, then fill in what shows under it, and press Save and test):');
  out.push('');
  for (const k of Object.keys(FEATURE_SETTINGS) as FeatureKey[]) {
    const fields = FEATURE_SETUP[k].map((key) => label(key));
    out.push(`- ${label(FEATURE_SETTINGS[k] as SettingKey)}: ${settingLink(FEATURE_SETTINGS[k] as SettingKey)}${fields.length > 0 ? ` (then: ${fields.join(', ')})` : ''}`);
  }
  out.push('');
  out.push('**Messages** (turn one on, then fill in what shows under it; Send a test message is at the bottom):');
  out.push('');
  for (const c of CHANNELS) out.push(`- ${CHANNEL_NAMES[c]}: ${settingLink(CHANNEL_SWITCHES[c] as SettingKey)}`);
  out.push('');
  out.push('**Other settings:**');
  out.push('');
  for (const k of LINKED) {
    const d = settingDefinitions[k] as SettingDefinition;
    out.push(`- ${d.label} (Settings > ${SETTINGS_PAGES.find((p) => p.id === d.page)?.title ?? d.page} > ${d.section}${d.advanced ? ', advanced' : ''}): ${settingLink(k)}`);
  }
  out.push('');
  out.push('**Pages:**');
  out.push('');
  for (const [path, what] of PAGES) out.push(`- ${what}: ${link(path)}`);
  return { state: lines.join('\n'), links: out.join('\n') };
}

/** Help > AI-assisted setup's summary of this install (the owner's only: viewers are refused, as for every System page). */
export function registerAiSetupRoutes(app: FastifyInstance, deps: BriefDeps): void {
  app.get('/api/v1/system/ai-setup', async (request) => {
    const address = briefAddress((request.query as { address?: unknown }).address, deps.settings.get('general.publicUrl'));
    return setupBrief(deps, address);
  });
}
