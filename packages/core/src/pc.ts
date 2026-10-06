import { baseTitle, editionBase } from './catalog.js';
import { parseCsv } from './csv.js';
import { matchKey } from './text.js';

/**
 * The PC library: the games in the user's PC storefronts as Playnite's library knows them, one record
 * per game per storefront, read from Playnite's backups by the Playnite reader (tools/playnite-reader).
 * Owning a game on PC is its own thing: it never counts as owning a console game (docs/PLAN.md, "Exact
 * ownership"), but it shows as related wherever that helps, and it keeps the game off the PC wishlist.
 */

/** The snapshot format the Playnite reader writes. */
export const PLAYNITE_SCHEMA = 'vgcm-playnite-library-v1';

/** How a storefront record counts: bought or claimed for good, reachable through a subscription, or not verified. */
export type PcOwnership = 'permanent' | 'subscription' | 'historical';

/** Ownership types for the interface. */
export const PC_OWNERSHIP_LABELS: Record<PcOwnership, string> = {
  permanent: 'Owned',
  subscription: 'Subscription',
  historical: 'Not verified',
};

/** One game in one storefront, as the Playnite reader gives it. */
export interface PlayniteRecord {
  /** Stable across readings: "<storefront id>|<storefront game id>". */
  recordKey: string;
  playniteId: string;
  storefrontGameId: string;
  /** The storefront (Playnite's "source"): Steam, GOG, Epic, Xbox... */
  sourceName?: string | null;
  name: string;
  platforms: string[];
  genres: string[];
  series: string[];
  completionStatus?: string | null;
  releaseDate?: string | null;
  releaseYear?: number | null;
  addedUtc?: string | null;
  lastActivityUtc?: string | null;
  favorite: boolean;
  hidden: boolean;
  installed: boolean;
  playtimeSeconds: number;
  playCount: number;
  criticScore?: number | null;
  communityScore?: number | null;
  links: { name: string; url: string }[];
}

/** A reading of Playnite's library: which backup it came from, its counts and its records. */
export interface PlayniteSnapshot {
  schemaVersion: string;
  generatedAtUtc: string;
  source: { fileName: string; lastWriteUtc?: string | null; fingerprint: string; sizeBytes?: number | null };
  statistics: { gameRecords: number; bySource: Record<string, number> };
  records: PlayniteRecord[];
}

/** A snapshot that can't be used, with a message for the user. */
export class SnapshotError extends Error {}

const str = (v: unknown) => (typeof v === 'string' ? v : null);
const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Reads and checks a Playnite reader snapshot (its schema, and the fields each record needs). */
export function parsePlayniteSnapshot(text: string): PlayniteSnapshot {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new SnapshotError('This is not a Playnite reader snapshot (not JSON).');
  }
  if (raw.schemaVersion !== PLAYNITE_SCHEMA) throw new SnapshotError(`This is not a Playnite reader snapshot (expected the ${PLAYNITE_SCHEMA} format).`);
  if (!Array.isArray(raw.records)) throw new SnapshotError('The snapshot has no records.');
  const source = (raw.source ?? {}) as Record<string, unknown>;
  const records: PlayniteRecord[] = [];
  for (const r of raw.records as Record<string, unknown>[]) {
    const recordKey = str(r.recordKey);
    const name = str(r.name)?.trim();
    if (!recordKey || !name) continue;
    records.push({
      recordKey: recordKey.toLowerCase(),
      playniteId: str(r.playniteId) ?? '',
      storefrontGameId: str(r.storefrontGameId) ?? '',
      sourceName: str(r.sourceName),
      name,
      platforms: arr(r.platforms),
      genres: arr(r.genres),
      series: arr(r.series),
      completionStatus: str(r.completionStatus),
      releaseDate: str(r.releaseDate),
      releaseYear: typeof r.releaseYear === 'number' ? r.releaseYear : null,
      addedUtc: str(r.addedUtc),
      lastActivityUtc: str(r.lastActivityUtc),
      favorite: r.favorite === true,
      hidden: r.hidden === true,
      installed: r.installed === true,
      playtimeSeconds: num(r.playtimeSeconds),
      playCount: num(r.playCount),
      criticScore: typeof r.criticScore === 'number' ? r.criticScore : null,
      communityScore: typeof r.communityScore === 'number' ? r.communityScore : null,
      links: Array.isArray(r.links)
        ? (r.links as Record<string, unknown>[]).map((l) => ({ name: str(l.name) ?? 'Link', url: str(l.url) ?? '' })).filter((l) => /^https?:\/\//i.test(l.url))
        : [],
    });
  }
  const bySource: Record<string, number> = {};
  for (const r of records) bySource[r.sourceName ?? 'Unclassified'] = (bySource[r.sourceName ?? 'Unclassified'] ?? 0) + 1;
  return {
    schemaVersion: PLAYNITE_SCHEMA,
    generatedAtUtc: str(raw.generatedAtUtc) ?? new Date().toISOString(),
    source: { fileName: str(source.fileName) ?? 'snapshot', lastWriteUtc: str(source.lastWriteUtc), fingerprint: str(source.fingerprint) ?? '', sizeBytes: typeof source.sizeBytes === 'number' ? source.sizeBytes : null },
    statistics: { gameRecords: records.length, bySource },
    records,
  };
}

/**
 * The storefronts whose games don't count as owned by default (Settings > PC library), as "Storefront:
 * type" lines. The old system's Source Registry: EA app, Ubisoft Connect and Xbox mix subscription games
 * into their libraries, so their games wait as not verified until an audit says otherwise; every other
 * storefront's library lists what was bought or claimed.
 */
export const STOREFRONT_OWNERSHIP_DEFAULT: string[] = ['EA app: historical', 'Ubisoft Connect: historical', 'Xbox: historical'];

/** Ownership words from lists and the old workbook: "Permanent / Claimed", "Subscription Access", "Historical / Unverified". */
export function ownershipOf(text: string): PcOwnership | null {
  const t = text.trim().toLowerCase();
  if (/^(permanent|owned|claimed|purchased|bought)/.test(t)) return 'permanent';
  if (/^(subscription|access|game pass|ea play|ubisoft\+|pass)/.test(t)) return 'subscription';
  if (/^(historical|unverified|not verified|unknown)/.test(t)) return 'historical';
  return null;
}

/** The "Storefront: type" lines as a map by storefront (lowercase); lines that don't parse are left out. */
export function storefrontOwnership(lines: readonly string[]): Map<string, PcOwnership> {
  const out = new Map<string, PcOwnership>();
  for (const line of lines) {
    const at = line.lastIndexOf(':');
    if (at <= 0) continue;
    const type = ownershipOf(line.slice(at + 1));
    if (type) out.set(line.slice(0, at).trim().toLowerCase(), type);
  }
  return out;
}

/** What the owner verified about a storefront game: the old workbook's PC Ownership Audit tab, or their own answer. */
export interface PcAuditEntry {
  storefront: string;
  storefrontGameId?: string | null;
  title: string;
  ownership: PcOwnership;
  verifiedAt?: string | null;
  notes?: string | null;
}

/** The key a PC game shares with its copies in other storefronts and with console games: its title without edition marks, compared as matching compares titles. */
export function pcFamilyKey(title: string): string {
  return matchKey(editionBase(baseTitle(title)));
}

/** A record's storefront, lowercase ("steam"), or "unclassified". */
const storefrontKey = (r: { sourceName?: string | null }) => (r.sourceName ?? 'unclassified').trim().toLowerCase();

/**
 * How a record counts: the owner's audit entry for it (by storefront game id, or else by the same title
 * within the storefront: exactly, since "Mass Effect Legendary Edition" is another product than "Mass
 * Effect") wins; otherwise the storefront's default (owned when the settings don't name it).
 */
export function pcOwnership(
  record: Pick<PlayniteRecord, 'sourceName' | 'storefrontGameId' | 'name'>,
  defaults: Map<string, PcOwnership>,
  audit: readonly PcAuditEntry[],
): { ownership: PcOwnership; audited: boolean } {
  const store = storefrontKey(record);
  const forStore = audit.filter((a) => a.storefront.trim().toLowerCase() === store);
  const byId = record.storefrontGameId ? forStore.find((a) => a.storefrontGameId && a.storefrontGameId === record.storefrontGameId) : undefined;
  const hit = byId ?? forStore.find((a) => matchKey(a.title) === matchKey(record.name));
  if (hit) return { ownership: hit.ownership, audited: true };
  return { ownership: defaults.get(store) ?? 'permanent', audited: false };
}

const AUDIT_COLUMNS = {
  storefront: /^(source|storefront|store|launcher)$/,
  storefrontGameId: /^(storefront game id|game id|store id)$/,
  title: /^(source title|title|game|name)$/,
  ownership: /^(ownership status|ownership|ownership type|status)$/,
  active: /^active$/,
  verifiedAt: /^(verified at|verified|checked)$/,
  notes: /^notes?$/,
} as const;

/**
 * Reads an ownership audit from CSV: storefront, title and ownership columns (the old workbook's PC
 * Ownership Audit tab works as it is, title rows above the header included), and optionally the
 * storefront game id, Active (No leaves the row out), when it was verified and notes.
 */
export function parsePcAudit(text: string): { entries: PcAuditEntry[]; problems: string[] } {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim()));
  const headerAt = rows.findIndex((r) => r.some((c) => AUDIT_COLUMNS.ownership.test(c.trim().toLowerCase())) && r.some((c) => AUDIT_COLUMNS.storefront.test(c.trim().toLowerCase())));
  if (headerAt < 0) return { entries: [], problems: ['No header row with a storefront (Source) and an Ownership Status column.'] };
  const header = rows[headerAt]!.map((c) => c.trim().toLowerCase());
  const col = (k: keyof typeof AUDIT_COLUMNS) => header.findIndex((h) => AUDIT_COLUMNS[k].test(h));
  const at = { storefront: col('storefront'), id: col('storefrontGameId'), title: col('title'), ownership: col('ownership'), active: col('active'), verifiedAt: col('verifiedAt'), notes: col('notes') };
  const entries: PcAuditEntry[] = [];
  let unreadable = 0;
  for (const r of rows.slice(headerAt + 1)) {
    const cell = (i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
    const storefront = cell(at.storefront);
    const title = cell(at.title);
    if (!storefront || !title) continue;
    if (/^(no|false|0)$/i.test(cell(at.active))) continue;
    const ownership = ownershipOf(cell(at.ownership));
    if (!ownership) {
      unreadable++;
      continue;
    }
    entries.push({ storefront, storefrontGameId: cell(at.id) || null, title, ownership, verifiedAt: cell(at.verifiedAt) || null, notes: cell(at.notes) || null });
  }
  const problems = unreadable > 0 ? [`${unreadable} row(s) had an ownership Squirrelcade doesn't know (use Permanent, Subscription or Historical) and were left out.`] : [];
  return { entries, problems };
}

/** Hours of play, rounded to one decimal ("12.5"). */
export function playtimeHours(seconds: number): number {
  return Math.round((seconds / 3600) * 10) / 10;
}
