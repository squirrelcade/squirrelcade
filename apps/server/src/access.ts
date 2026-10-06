import { settingDefinitions, type SettingKey, type SettingsPageId, type SettingsValues } from '@squirrelcade/core';
import type { FastifyRequest } from 'fastify';
import type { SettingsService } from './settings.js';

/**
 * Who may do what. The owner (the collection's) may do anything; viewers may look at the collection, its value,
 * the consoles' gaps, the wishlist, sets and series, and (settings) the PC library, what the owner played and
 * their copies' details, but change nothing: the
 * server refuses them every other call, whatever the interface shows. The API key and the local network (when
 * Settings > Security lets it skip the sign-in) act as the owner.
 */
export type Role = 'owner' | 'viewer';

/** The role behind a request, or null when nobody is signed in. */
export function roleOf(request: FastifyRequest): Role | null {
  const auth = request.auth;
  if (!auth) return null;
  return auth.kind === 'session' ? auth.role : 'owner';
}

export const isViewer = (request: FastifyRequest): boolean => roleOf(request) === 'viewer';

/**
 * What a requester may see of the owner's private details: prices paid, notes, the PC library, RomM links, what
 * they played (status, ratings, the backlog) and their copies' details (where each is kept, tags, photos, loans).
 */
export interface Sees {
  paid: boolean;
  notes: boolean;
  pc: boolean;
  romm: boolean;
  play: boolean;
  details: boolean;
}

const EVERYTHING: Sees = { paid: true, notes: true, pc: true, romm: true, play: true, details: true };

/** What the requester may see: all of it for the owner; for a viewer, what Settings > Security > Viewers shares. */
export function sees(request: FastifyRequest, settings: SettingsService): Sees {
  if (!isViewer(request)) return EVERYTHING;
  // A viewer's RomM links would point at the owner's RomM, which isn't theirs to open.
  return {
    paid: settings.get('security.viewersSeePaid'),
    notes: settings.get('security.viewersSeeNotes'),
    pc: settings.get('security.viewersSeePc'),
    romm: false,
    play: settings.get('security.viewersSeePlay'),
    details: settings.get('security.viewersSeeCopyDetails'),
  };
}

/** The reads a viewer may make (GET): the pages of the collection, never the owner's settings, system or reviews. */
const VIEWER_READS: RegExp[] = [
  /^\/api\/v1\/auth\/session$/,
  /^\/api\/v1\/health$/,
  /^\/api\/v1\/settings$/,
  /^\/api\/v1\/platforms$/,
  /^\/api\/v1\/catalogs$/,
  /^\/api\/v1\/catalogs\/(sources|source-status|upcoming|upcoming\.ics|past)$/,
  /^\/api\/v1\/catalogs\/[a-z0-9-]+$/,
  /^\/api\/v1\/catalogs\/[a-z0-9-]+\/export$/,
  /^\/api\/v1\/collection\/(summary|items|history|movers|export|statistics|report|upgrades|goal)$/,
  /^\/api\/v1\/copies$/,
  /^\/api\/v1\/copies\/search$/,
  /^\/api\/v1\/export\/workbook$/,
  /^\/api\/v1\/game$/,
  /^\/api\/v1\/game\/(summary|notes)$/,
  /^\/api\/v1\/history$/,
  /^\/api\/v1\/history\/(top100|consoles)\/[a-z0-9-]+$/,
  /^\/api\/v1\/history\/timeline$/,
  /^\/api\/v1\/gotd$/,
  /^\/api\/v1\/today$/,
  /^\/api\/v1\/deals$/,
  /^\/api\/v1\/lookup$/,
  /^\/api\/v1\/lookup\/barcode\/[^/]+$/,
  /^\/api\/v1\/lookup\/offline$/,
  /^\/api\/v1\/owned$/,
  /^\/api\/v1\/purchases$/,
  /^\/api\/v1\/series$/,
  /^\/api\/v1\/series\/games$/,
  /^\/api\/v1\/sets$/,
  /^\/api\/v1\/sets\/[^/]+$/,
  /^\/api\/v1\/sets\/[^/]+\/export$/,
  /^\/api\/v1\/wishlist$/,
  /^\/api\/v1\/wishlist\/export$/,
  /^\/api\/v1\/wishlist\/platforms\/[^/]+$/,
];

/** The PC library's reads, when viewers see it. */
const VIEWER_PC_READS: RegExp[] = [/^\/api\/v1\/pc$/, /^\/api\/v1\/pc\/(games|export|sealed|reads|wishlist|wishlist\/export|wishlist\/hidden)$/];

/** The Backlog page and "What to play next", when viewers see what the owner played. */
const VIEWER_PLAY_READS: RegExp[] = [/^\/api\/v1\/play$/, /^\/api\/v1\/play\/next$/];

/** Copies' details (where each is kept, tags, photos, loans, the games for sale), when viewers see them. */
const VIEWER_DETAIL_READS: RegExp[] = [/^\/api\/v1\/copy$/, /^\/api\/v1\/tags$/, /^\/api\/v1\/loans$/, /^\/api\/v1\/photos\/\d+$/, /^\/api\/v1\/sale$/, /^\/api\/v1\/sale\/export$/];

/** Spending by month, when viewers see what the owner paid. */
const VIEWER_PAID_READS: RegExp[] = [/^\/api\/v1\/collection\/spending$/];

/** The changes a viewer may make: their own sign-out and password, a question about ownership, and a page's error report. */
const VIEWER_WRITES = new Set(['POST /api/v1/auth/logout', 'POST /api/v1/auth/password', 'POST /api/v1/owned', 'POST /api/v1/system/client-error']);

/** Whether a viewer may make this call. */
export function viewerMay(method: string, path: string, settings: SettingsService): boolean {
  if (method === 'GET' || method === 'HEAD') {
    if (VIEWER_READS.some((r) => r.test(path))) return true;
    if (settings.get('security.viewersSeePc') && VIEWER_PC_READS.some((r) => r.test(path))) return true;
    if (settings.get('security.viewersSeePlay') && VIEWER_PLAY_READS.some((r) => r.test(path))) return true;
    if (settings.get('security.viewersSeeCopyDetails') && VIEWER_DETAIL_READS.some((r) => r.test(path))) return true;
    return settings.get('security.viewersSeePaid') && VIEWER_PAID_READS.some((r) => r.test(path));
  }
  return VIEWER_WRITES.has(`${method} ${path}`);
}

/** The settings pages whose values a viewer's pages read (dates, money, the interface, what's collected). */
const VIEWER_SETTING_PAGES = new Set<SettingsPageId>(['general', 'features', 'interface', 'collection', 'platforms', 'catalogs', 'wishlist']);

/** The settings that tell a viewer's interface what's shared with them. */
const VIEWER_SETTING_KEYS = new Set<SettingKey>(['security.viewersSeePaid', 'security.viewersSeeNotes', 'security.viewersSeePc', 'security.viewersSeePlay', 'security.viewersSeeCopyDetails']);

/** A viewer's share of the settings: what their pages need to show the collection, nothing about the server or its services. */
export function viewerSettings(values: SettingsValues): Partial<SettingsValues> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const def = settingDefinitions[key as SettingKey];
    if (def && def.kind !== 'secret' && (VIEWER_SETTING_PAGES.has(def.page) || VIEWER_SETTING_KEYS.has(key as SettingKey))) out[key] = value;
  }
  return out as Partial<SettingsValues>;
}

/** What this request's sender may see (set when the request came in; everything outside the API). */
export const shown = (request: FastifyRequest): Sees => request.sees ?? EVERYTHING;
