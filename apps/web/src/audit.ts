import { COMPLETENESS_LABELS, normalizeTitle, type Completeness } from '@squirrelcade/core';
import type { ShelfChecklist, ShelfFound, ShelfUnsure } from './shelfCheck';

/**
 * The collection audit (1.5.0, R05), its plain part: what the server says about an audit, and how a shelf's checklist
 * (Check a shelf's reader, shelfCheck.ts) becomes the audit's groups: the copies to tick, the games to add, the ones you
 * have on another console, and the unsure. The pages are pages/Audit.tsx, AuditShelf.tsx and AuditLists.tsx.
 */

/** One console in the audit: its copies, and how many have been seen (or settled). */
export interface AuditConsole {
  key: string;
  name: string;
  copies: number;
  seen: number;
}

/** A shelf done: its name, console, how many spines were read, copies ticked, games not logged, and photos kept. */
export interface AuditShelfRow {
  id: number;
  name: string;
  platformKey: string;
  reads: number;
  seen: number;
  notLogged: { title: string; read?: string; added?: boolean }[];
  photos: number;
  createdAt: string;
}

/** GET /api/v1/audit's audit: the one going (or the last one finished), with how far it's got. */
export interface AuditSummary {
  id: number;
  name: string;
  startedAt: string;
  finishedAt: string | null;
  platforms: string[] | null;
  totals: { copies: number; marked: number; seen: number; added: number; gone: number; lent: number; shelves: number };
  consoles: AuditConsole[];
  shelves: AuditShelfRow[];
}

/** One of the audit's copies (GET /api/v1/audit/:id/copies). */
export interface AuditCopy {
  copyKey: string;
  id: number;
  title: string;
  platformKey: string;
  platform: string;
  completeness: string;
  quantity: number;
  addedAt: string | null;
  place: string | null;
  state: string | null;
  how: string | null;
}

/** A copy ticked: its key and its title in the collection. */
export interface SeenCopy {
  copyKey: string;
  title: string;
}

/** What became of a copy not seen. Sold, given away and lost take it out of the collection, as Remove does. */
export type Outcome = 'found' | 'sold' | 'lent' | 'given' | 'lost';

export const OUTCOMES: { value: Outcome; label: string; done: string; confirm: string; leaves: boolean }[] = [
  { value: 'found', label: 'Found it', done: 'Found', confirm: 'Found it', leaves: false },
  { value: 'sold', label: 'Sold', done: 'Sold: out of your collection', confirm: "Yes, it's sold", leaves: true },
  { value: 'lent', label: 'Lent', done: 'Lent', confirm: 'Lend it', leaves: false },
  { value: 'given', label: 'Gave away', done: 'Given away: out of your collection', confirm: 'Yes, I gave it away', leaves: true },
  { value: 'lost', label: 'Lost', done: 'Lost: out of your collection', confirm: "Yes, it's lost", leaves: true },
];

/** A shelf's checklist as the audit sees it. */
export interface AuditGroups {
  /** Read as games you have on this console: their copies are ticked as seen. */
  logged: ShelfFound[];
  /** Read as this console's games you have no copy of: each can be added. */
  notLogged: ShelfFound[];
  /** You have it on another console, or maybe have it (waiting for Review): shown apart, never ticked. */
  elsewhere: ShelfFound[];
  /** Spines read only partly: you say which game, or none. */
  unsure: ShelfUnsure[];
}

const byTitle = (a: ShelfFound, b: ShelfFound) => a.title.localeCompare(b.title);

export function auditGroups(list: ShelfChecklist): AuditGroups {
  return {
    logged: [...list.own].sort(byTitle),
    // Need it, need it if physical, not a collecting target, not tracked: on the shelf, and not in the collection.
    notLogged: [...list.need, ...list.other].sort(byTitle),
    elsewhere: [...list.elsewhere].sort(byTitle),
    unsure: list.unsure,
  };
}

/** The titles that tick a game read as yours: its copies' own titles when they aren't just the game's. */
export function seenTitles(f: ShelfFound): string[] {
  return f.game.as?.length ? f.game.as : [f.title];
}

/** What a shelf sends to the audit: the titles to tick, and the games on it that aren't logged. */
export function shelfBody(groups: AuditGroups): { seen: string[]; notLogged: { title: string; read: string }[] } {
  return {
    seen: [...new Set(groups.logged.flatMap(seenTitles))],
    notLogged: groups.notLogged.map((f) => ({ title: f.title, read: f.read })),
  };
}

/** The titles read as yours that haven't been sent yet (a shelf's next photo, an unsure spine said to be yours). */
export function unsent(groups: AuditGroups, sent: ReadonlySet<string>): string[] {
  return shelfBody(groups).seen.filter((t) => !sent.has(t));
}

/** Copies ticked, one line per game: "Blue Dragon · 2 copies". New ones join the list without doubling a copy. */
export function seenByTitle(seen: SeenCopy[]): { title: string; keys: string[] }[] {
  const out = new Map<string, string[]>();
  for (const s of seen) {
    const keys = out.get(s.title) ?? [];
    if (!keys.includes(s.copyKey)) keys.push(s.copyKey);
    out.set(s.title, keys);
  }
  return [...out].map(([title, keys]) => ({ title, keys })).sort((a, b) => a.title.localeCompare(b.title));
}

/** How far along, 0 to 100 for a bar: never 100 until every copy is seen. */
export function percent(seen: number, copies: number): number {
  if (copies <= 0) return 0;
  if (seen >= copies) return 100;
  return Math.min(99, Math.round((seen / copies) * 100));
}

/** A copy's condition in words ("Complete"). */
export function conditionText(completeness: string): string {
  return COMPLETENESS_LABELS[completeness as Completeness] ?? completeness;
}

/** When a copy was added, short: "added Sep 2024". */
export function addedText(addedAt: string | null): string | null {
  if (!addedAt) return null;
  const d = new Date(addedAt.length === 10 ? `${addedAt}T12:00:00` : addedAt);
  if (Number.isNaN(d.getTime())) return null;
  return `added ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`;
}

/** A shelf's kept photos, as the server names them. */
export function photoFiles(shelf: Pick<AuditShelfRow, 'id' | 'photos'>): string[] {
  return Array.from({ length: shelf.photos }, (_, i) => `${shelf.id}-${i + 1}.jpg`);
}

/** The copies whose title has these words, in any order (the search on Tick by hand and Not seen yet). */
export function findCopies<T extends { title: string }>(copies: T[], query: string): T[] {
  const words = normalizeTitle(query).split(' ').filter(Boolean);
  if (words.length === 0) return copies;
  return copies.filter((c) => {
    const title = normalizeTitle(c.title);
    return words.every((w) => title.includes(w));
  });
}

/** Copies by console, in the server's order (console, then title). */
export function byConsole<T extends { platformKey: string; platform: string }>(copies: T[]): { key: string; name: string; copies: T[] }[] {
  const out = new Map<string, { key: string; name: string; copies: T[] }>();
  for (const c of copies) {
    const group = out.get(c.platformKey) ?? { key: c.platformKey, name: c.platform, copies: [] };
    group.copies.push(c);
    out.set(c.platformKey, group);
  }
  return [...out.values()];
}
