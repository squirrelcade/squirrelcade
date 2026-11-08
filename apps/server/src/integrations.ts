import { youtubeModeOf } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import { isNull } from 'drizzle-orm';
import type { Db } from './db/index.js';
import { aiKeys } from './db/schema.js';
import type { SettingsService } from './settings.js';
import type { TaskInfo, TaskRunner } from './tasks.js';

/**
 * The integrations' lights on System > Status (T-202, D204): one line per outside part Squirrelcade talks to, from what
 * the server already records (each part's task runs, its settings, what it last said), so the card opens at once. The
 * checks themselves run in the background on their schedule, or on Check now (the part's task, run now).
 */

/** Green: on, and its last check worked. Yellow: needs attention soon. Red: on and failing. Grey: off or not set up. */
export type Light = 'green' | 'yellow' | 'red' | 'grey';

export interface IntegrationLine {
  key: string;
  name: string;
  light: Light;
  /** What's going on, in plain words ("Read 5,712 PC games", "IGDB answered 401: its keys were refused"). */
  says: string;
  /** When it last worked, and when it last ran at all. */
  lastOk: string | null;
  lastRun: string | null;
  /** Where it's set up (a settings page), and its section in Help > Integrations (the help card's words). */
  settings: string;
  help: string;
  /** The task Check now runs; null when there's nothing to run. */
  check: string | null;
  /** Grey because nothing needs it (not a missing step): its link says Settings, not Set it up. */
  notNeeded?: boolean;
}

/** An outside part: its tasks (on when one of them is scheduled, as their settings decide) and how to judge it besides. */
interface Definition {
  key: string;
  name: string;
  tasks: string[];
  settings: string;
  /** More to say, or a light of its own (a part without a task, a token running out). notNeeded: off because nothing needs it. */
  extra?: (d: Deps, tasks: TaskInfo[]) => { on?: boolean; light?: Light; says?: string; notNeeded?: boolean } | null;
}

/** What the lights read besides the tasks. */
export interface Deps {
  db: Db;
  settings: SettingsService;
  tasks: TaskRunner;
  /** Today's YouTube units (Find its videos, the channels' reading). */
  youtubeUnits?: () => { used: number; budget: number; left: number };
  /** The optional parts' own problems (PlayStation's sign-in running out). */
  problems?: () => { level: 'warning' | 'error'; message: string }[];
  /** Each notification channel's last sending. */
  notified?: () => Map<string, { at: string; ok: boolean; error?: string }>;
  /** Whether the owner's AI helper asked for work lately (the AI model set to a helper). */
  helperThere?: () => boolean;
  /** Frankfurter's last answer, when it was asked for an exchange rate. */
  ratesLast?: () => { at: string; ok: boolean } | null;
  /** Friends' live links (D214): one line each, from when each was last read and what it said. */
  friendLinks?: () => { id: number; name: string; link: string; readAt: string | null; checkedAt: string | null; error: string | null }[];
  /** The email accounts (Settings > Email), each with what it last did: one line each. */
  mailAccounts?: () => { id: number; name: string; reads: boolean; sends: boolean; state: { read?: { at: string; ok: boolean; message: string }; send?: { at: string; ok: boolean; message: string } } }[];
  /** Your live friend files: how many friends you share with live, the folder, the last writing. */
  friendLive?: () => { sharing: number; folder: string; writtenAt: string | null } | null;
}

const NOTIFY_CHANNELS = ['email', 'pushover', 'pushbullet', 'ntfy', 'gotify', 'discord', 'telegram', 'slack', 'webhook', 'apprise'] as const;

const DEFINITIONS: Definition[] = [
  { key: 'igdb', name: 'IGDB', tasks: ['igdb-sync'], settings: '/settings/sources' },
  // With accounts set up, each has its own line (mailboxLines); this one is what's left until the first is added.
  { key: 'mailbox', name: 'The mailbox (PriceCharting exports, purchase emails)', tasks: ['mail-import', 'orders-watch'], settings: '/settings/email' },
  {
    key: 'notifications',
    name: 'Notifications',
    tasks: [],
    settings: '/settings/notifications',
    extra: (d) => {
      const on = NOTIFY_CHANNELS.filter((c) => d.settings.get(`notifications.${c}Enabled` as 'notifications.emailEnabled') === true);
      if (on.length === 0) return { on: false };
      const sent = [...(d.notified?.() ?? new Map()).entries()].filter(([c]) => (on as readonly string[]).includes(c));
      const failed = sent.filter(([, r]) => !r.ok);
      if (failed.length > 0) return { on: true, light: 'red', says: failed.map(([, r]) => r.error ?? 'Sending failed').join(' ') };
      return { on: true, light: 'green', says: sent.length > 0 ? `${on.length} ${on.length === 1 ? 'channel' : 'channels'}; the last message went out` : `${on.length} ${on.length === 1 ? 'channel' : 'channels'} on; nothing sent since Squirrelcade started` };
    },
  },
  { key: 'romm', name: 'RomM', tasks: ['romm-sync'], settings: '/settings/sources' },
  { key: 'playnite', name: "Playnite's folder (the PC library)", tasks: ['pc-read'], settings: '/settings/pc' },
  {
    key: 'youtube',
    name: 'YouTube',
    tasks: ['videos-read'],
    settings: '/settings/roots',
    extra: (d) => {
      // Light (D215): no key, so nothing to run out of; green while videos are on. Deep: the key and today's units.
      const chosen = d.settings.get('roots.youtubeMode');
      const hasKey = Boolean(d.settings.get('sources.youtubeKey').trim());
      if (!d.settings.get('roots.videos')) return { on: false, says: "Off: Settings > Roots > Videos on a game's page turns it on" };
      if (youtubeModeOf(chosen, hasKey) === 'light') {
        if (chosen === 'deep') return { on: true, light: 'yellow', says: 'Set to Deep, but no YouTube key is set (Settings > Sources > YouTube): for now it works as Light' };
        return { on: true, light: 'green', says: 'Light: no key needed, fewer videos (each channel\'s newest uploads, gathered over time; Deep with a YouTube key reads whole channels)' };
      }
      const u = d.youtubeUnits?.();
      if (!u) return null;
      if (u.left < u.budget * 0.1) return { light: 'yellow', says: `Today's units nearly used: ${u.left.toLocaleString('en-US')} of ${u.budget.toLocaleString('en-US')} left (they come back at midnight, Pacific time)` };
      return { says: `Deep: ${u.left.toLocaleString('en-US')} of today's ${u.budget.toLocaleString('en-US')} units left` };
    },
  },
  { key: 'retroachievements', name: 'RetroAchievements', tasks: ['ra-sync'], settings: '/settings/sources' },
  { key: 'xbox', name: 'Xbox achievements', tasks: ['xbox-sync'], settings: '/settings/sources' },
  { key: 'steam', name: 'Steam', tasks: ['steam-sync'], settings: '/settings/sources' },
  {
    key: 'playstation',
    name: 'PlayStation trophies',
    tasks: ['psn-sync'],
    settings: '/settings/sources',
    extra: (d) => {
      const p = (d.problems?.() ?? []).find((x) => /playstation|psn/i.test(x.message));
      return p ? { light: p.level === 'error' ? 'red' : 'yellow', says: p.message } : null;
    },
  },
  { key: 'deals', name: 'IsThereAnyDeal and GG.deals (PC prices)', tasks: ['pc-prices'], settings: '/settings/sources' },
  { key: 'gamefly', name: 'GameFly', tasks: ['gamefly-prices'], settings: '/settings/sources' },
  {
    key: 'rates',
    name: 'Exchange rates (Frankfurter)',
    tasks: [],
    settings: '/settings/email',
    // Used for two things (2026-11-07: the light was grey while purchases in pounds were being turned into dollars):
    // showing dollar prices in another currency, and a purchase's price paid in another currency (On the way, D173).
    extra: (d) => {
      const home = d.settings.get('general.currency');
      const converts = d.settings.get('orders.exchangeRates') && d.settings.get('orders.page');
      if (home === 'USD' && !converts) return { on: false, notNeeded: true, says: "Not needed: your prices are in dollars, and a purchase in another currency keeps its own price (Settings > Email > On the way)" };
      const uses = [home !== 'USD' ? `prices in dollars are shown in ${home}` : null, converts ? `a purchase in another currency (a UK store's pounds) gets its price paid in ${home}, at the rate of its order's day` : null].filter((x): x is string => x !== null).join('; ');
      const last = d.ratesLast?.() ?? null;
      const when = (at: string) => at.slice(0, 16).replace('T', ' ') + ' UTC';
      if (last && !last.ok) return { on: true, light: 'yellow', says: `Frankfurter didn't give a rate at ${when(last.at)}: a purchase waiting for its rate gets it on a later look. On: ${uses}` };
      return { on: true, light: 'green', says: `On: ${uses}${last ? `. Last rate ${when(last.at)}` : ''}` };
    },
  },
  {
    key: 'barcodes',
    name: 'The barcode lookup',
    tasks: [],
    settings: '/settings/sources',
    extra: (d) => {
      const by = String(d.settings.get('sources.barcodeLookup'));
      return by === 'off' || by === 'none' ? { on: false } : { on: true, light: 'green', says: `Barcodes Squirrelcade doesn't know yet are asked of ${by === 'upcitemdb' ? 'UPCitemdb' : by}` };
    },
  },
  { key: 'wikipedia', name: 'Wikipedia and Wikidata', tasks: ['catalog-build', 'roots-read'], settings: '/settings/catalogs' },
  {
    key: 'ai-model',
    name: 'The AI model (Check a shelf, Talk)',
    tasks: [],
    settings: '/settings/ai',
    // A helper of the owner's own counts (2026-11-07: Claude Code on the owner's plan answered, and the light was grey).
    extra: (d) => {
      if (d.settings.get('sources.visionApi') === 'helper') {
        return d.helperThere?.()
          ? { on: true, light: 'green', says: 'A helper of your own answers (on your own plan, no API key here), and it is asking for work' }
          : { on: true, light: 'red', says: "Set to a helper of your own, but no helper is asking for work: is it running? (Help > Store Mode)" };
      }
      if (d.settings.get('sources.visionUrl') && d.settings.get('sources.visionModel')) return { on: true, light: 'green', says: `Set up: ${d.settings.get('sources.visionModel')}` };
      return { on: false, says: 'Optional, not set up: Check a shelf reads with the phone alone, and Talk needs it' };
    },
  },
  {
    key: 'claude-keys',
    name: "Claude's plugin keys",
    tasks: [],
    settings: '/settings/ai',
    extra: (d) => {
      if (!d.settings.get('ai.enabled')) return { on: false };
      const keys = d.db.select({ lastUsedAt: aiKeys.lastUsedAt }).from(aiKeys).where(isNull(aiKeys.revokedAt)).all();
      if (keys.length === 0) return { on: false };
      const last = keys.map((k) => k.lastUsedAt).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
      return { on: true, light: 'green', says: `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}${last ? `; last used ${last.slice(0, 10)}` : '; not used yet'}` };
    },
  },
  { key: 'magazines', name: 'The magazines folder and its night reader', tasks: ['magazines-scan', 'magazines-read', 'magazines-games'], settings: '/settings/magazines' },
  { key: 'backups', name: 'Backups', tasks: ['backup'], settings: '/system/backups' },
  {
    key: 'https',
    name: 'The HTTPS address',
    tasks: [],
    settings: '/settings/general',
    extra: (d) => {
      const url = d.settings.get('general.publicUrl').trim();
      if (!url) return { on: false, says: 'No address set: links in notifications use the one you open Squirrelcade at' };
      return url.startsWith('https://') ? { on: true, light: 'green', says: url } : { on: true, light: 'yellow', says: `${url} is plain http: a phone keeps Store Mode for no connection only over https` };
    },
  },
];

const ORDER: Record<Light, number> = { red: 0, yellow: 1, green: 2, grey: 3 };

/** A run's message made short for a line. */
const short = (m: string | null | undefined) => (m ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

/** Every line, red first, then yellow, green and grey (each kept in its own order). */
export function integrationLines(d: Deps): IntegrationLine[] {
  const all = new Map(d.tasks.list().map((t) => [t.name, t]));
  const lines = DEFINITIONS.map((def): IntegrationLine => {
    const tasks = def.tasks.map((n) => all.get(n)).filter((t): t is TaskInfo => Boolean(t));
    const scheduled = tasks.filter((t) => t.intervalMs !== null);
    const extra = def.extra?.(d, tasks) ?? null;
    const on = extra?.on ?? scheduled.length > 0;
    const base = { key: def.key, name: def.name, settings: def.settings, help: `integrations#${def.key}`, check: scheduled[0]?.name ?? null };
    if (!on) return { ...base, light: 'grey', says: extra?.says ?? 'Off, or not set up', notNeeded: extra?.notNeeded === true, lastOk: null, lastRun: null, check: null };
    // A part without a task of its own (notifications, the barcode lookup, the address) is what its own check says.
    if (scheduled.length === 0) return { ...base, light: extra?.light ?? 'green', says: extra?.says ?? 'On', lastOk: null, lastRun: null, check: null };
    // The newest run of its tasks (a quiet check's look counts), and the newest that worked.
    const runs = scheduled.flatMap((t) => [
      ...(t.lastRun ? [{ task: t, at: t.lastRun.startedAt, finished: t.lastRun.finishedAt, status: t.lastRun.status, message: t.lastRun.message }] : []),
      ...(t.lastLook ? [{ task: t, at: t.lastLook.at, finished: t.lastLook.at, status: 'success', message: t.lastLook.message }] : []),
    ]);
    runs.sort((a, b) => b.at.localeCompare(a.at));
    const failed = runs.find((r) => r.status === 'failed' && runs.filter((x) => x.task === r.task)[0] === r);
    const okRun = scheduled
      .flatMap((t) => d.tasks.history(20, t.name).filter((r) => r.status === 'success' || r.status === 'warning').slice(0, 1))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
    const lastOk = [okRun?.finishedAt ?? null, ...scheduled.map((t) => t.lastLook?.at ?? null)].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null;
    const latest = runs[0];
    let light: Light = 'green';
    let says = latest ? short(latest.message) || `${latest.task.title}: done` : 'Not run yet: it runs on its schedule, or now with Check now';
    if (failed) {
      light = 'red';
      says = `${failed.task.title} failed: ${short(failed.message)}`;
    } else if (!latest) light = 'yellow';
    else if (latest.status === 'warning') light = 'yellow';
    else {
      // Not run lately: three of its intervals (at least a day) without a run.
      const stale = scheduled.find((t) => {
        const last = runs.find((r) => r.task === t);
        return t.intervalMs !== null && (!last || Date.now() - Date.parse(last.at) > Math.max(3 * t.intervalMs, 86_400_000));
      });
      if (stale) {
        light = 'yellow';
        says = `${stale.title} hasn't run lately`;
      }
    }
    if (extra?.light && ORDER[extra.light] < ORDER[light]) light = extra.light;
    if (extra?.says && (extra.light || light === 'green')) says = extra.says;
    return { ...base, light, says, lastOk, lastRun: latest?.at ?? null };
  });
  if ((d.mailAccounts?.() ?? []).length > 0) lines.splice(lines.findIndex((l) => l.key === 'mailbox'), 1);
  lines.push(...mailboxLines(d));
  lines.push(...friendLinkLines(d));
  return lines.map((l, i) => ({ l, i })).sort((a, b) => ORDER[a.l.light] - ORDER[b.l.light] || a.i - b.i).map((x) => x.l);
}

/** A line for each email account (D218): its name, when it last read or sent, and whether that failed. */
function mailboxLines(d: Deps): IntegrationLine[] {
  const when = (at: string) => at.slice(0, 16).replace('T', ' ') + ' UTC';
  return (d.mailAccounts?.() ?? []).map((a) => {
    const { read, send } = a.state;
    const failing = [read, send].filter((x): x is { at: string; ok: boolean; message: string } => x !== undefined && !x.ok);
    const used = [read, send].filter((x): x is { at: string; ok: boolean; message: string } => x !== undefined);
    const ok = used.filter((x) => x.ok).map((x) => x.at).sort().at(-1) ?? null;
    const run = used.map((x) => x.at).sort().at(-1) ?? null;
    const parts = [read?.ok ? `read ${when(read.at)}` : null, send?.ok ? `sent ${when(send.at)}` : null].filter((x): x is string => x !== null);
    const light: Light = failing.length > 0 ? 'red' : used.length === 0 ? 'yellow' : 'green';
    const says = failing.length > 0 ? short(failing.map((f) => f.message).join(' ')) : used.length === 0 ? `Not used yet: it is read on its schedule, or test it on Settings > Email${a.reads ? '' : ' (it only sends)'}` : parts.join('; ').replace(/^./, (c) => c.toUpperCase());
    return { key: `mailbox-${a.id}`, name: `The mailbox: ${a.name}`, light, says, lastOk: ok, lastRun: run, settings: '/settings/email', help: 'integrations#mailbox', check: a.reads && d.settings.get('features.mail') ? 'mail-import' : null };
  });
}

/** Your live friend files, and a line for each friend's live link (D214): read lately, failing, or not read yet. */
function friendLinkLines(d: Deps): IntegrationLine[] {
  const base = { settings: '/friends', help: 'integrations#friends-live', check: 'friends-live' };
  const out: IntegrationLine[] = [];
  const mine = d.friendLive?.() ?? null;
  if (mine && mine.sharing > 0) {
    out.push({
      ...base,
      key: 'friends-live-files',
      name: 'Your live friend files',
      light: mine.writtenAt ? 'green' : 'yellow',
      says: mine.writtenAt ? `${mine.sharing} friend${mine.sharing === 1 ? '' : 's'}' files in ${mine.folder}, rewritten after each collection update` : `Not written yet (${mine.folder})`,
      lastOk: mine.writtenAt,
      lastRun: mine.writtenAt,
    });
  }
  const hours = d.settings.get('friends.liveReadHours');
  for (const f of d.friendLinks?.() ?? []) {
    const stale = f.readAt !== null && Date.now() - Date.parse(f.readAt) > Math.max(3 * hours * 3_600_000, 86_400_000);
    const light: Light = f.error ? 'red' : !f.readAt ? 'yellow' : stale ? 'yellow' : 'green';
    out.push({
      ...base,
      key: `friend-link-${f.id}`,
      name: `${f.name}'s live link`,
      light,
      says: f.error ?? (!f.readAt ? 'Not read yet: it is read on its schedule, or now with Check now' : stale ? 'Not read lately' : `Read ${f.readAt.slice(0, 16).replace('T', ' ')}`),
      lastOk: f.readAt,
      lastRun: f.checkedAt,
    });
  }
  return out;
}

export function registerIntegrationRoutes(app: FastifyInstance, deps: Deps): void {
  app.get('/api/v1/system/integrations', async () => ({ lines: integrationLines(deps) }));
}
