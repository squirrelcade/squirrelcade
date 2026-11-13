import { ShelfMatcher, unsureNeeded, type ShelfDoubt, type ShelfRead, type ShelfResult } from '@squirrelcade/core';
import type { Answer } from './choices';
import type { OfflineCopy, OfflineGame } from './offline';

/**
 * Check a shelf (D147): the phone reads a photo of game spines (public/reader: PaddleOCR's open models, run in the
 * browser) and matches what it read against Store Mode's copy of the console's games, with the same matcher the
 * server uses for visitors (packages/core/src/shelf.ts). This file is the page's plain part: loading the reader,
 * and turning matches into a checklist.
 */

/** One line the reader read: its text, its confidence, the pass, and its four corners on the photo. */
export interface ReadLine {
  text: string;
  score: number;
  turn: string;
  box: [number, number][];
}

/** The reader's progress: downloading its files (the first time), finding text, reading it. */
export type ReaderProgress =
  | { stage: 'download'; done: number; total: number }
  | { stage: 'find'; pass: number; passes: number }
  | { stage: 'read'; pass: number; passes: number; done: number; total: number };

/** public/reader/photo.js, the reader's page side (plain JavaScript, so other pages can use it as it is). */
export interface PhotoReader {
  decodePhoto(file: Blob): Promise<HTMLCanvasElement>;
  readCanvas(canvas: HTMLCanvasElement, options: { turns: string[]; onProgress?: (p: ReaderProgress) => void }): Promise<{ lines: ReadLine[]; width: number; height: number }>;
  photoPieces(canvas: HTMLCanvasElement, count: number, maxSide?: number): string[];
  warmReader(onProgress?: (p: ReaderProgress) => void): Promise<unknown>;
}

let reader: Promise<PhotoReader> | null = null;

/** The reader, loaded once (its worker and models stay loaded for the next photo). */
export function photoReader(): Promise<PhotoReader> {
  reader ??= (import(/* @vite-ignore */ new URL('/reader/photo.js', window.location.href).href) as Promise<PhotoReader>).catch((err: unknown) => {
    reader = null;
    throw err;
  });
  return reader;
}

/** What the progress says, in words. */
export function progressText(p: ReaderProgress | null): string {
  if (!p) return 'Starting the reader…';
  if (p.stage === 'download') return `Getting the reader ready, the first time only: ${Math.round(p.done / 1e6)} of ${Math.round(p.total / 1e6)} MB`;
  const pass = p.passes > 1 ? ` (pass ${p.pass} of ${p.passes})` : '';
  if (p.stage === 'find') return `Finding the text${pass}…`;
  return `Reading ${p.done} of ${p.total}${pass}…`;
}

/** How far along, 0 to 100, for a progress bar. */
export function progressValue(p: ReaderProgress | null): number {
  if (!p) return 2;
  if (p.stage === 'download') return Math.round((p.done / p.total) * 100);
  const each = 100 / p.passes;
  const base = (p.pass - 1) * each;
  return Math.round(p.stage === 'find' ? base + each * 0.15 : base + each * (0.2 + (0.8 * p.done) / Math.max(1, p.total)));
}

/** The consoles a shelf can be checked for: those with games in the copy, by name. */
export function shelfConsoles(copy: OfflineCopy): { key: string; name: string; index: number }[] {
  const used = new Set(copy.games.filter((g) => g.a !== 'not-tracked').map((g) => g.p));
  return copy.platforms
    .map((p, index) => ({ ...p, index }))
    .filter((p) => used.has(p.index))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A console's games from the copy, and a matcher for them (keyed by each game's place in the copy); with the
 * console's full list (IGDB's games the copy doesn't have, GET /api/v1/shelf/titles), as games not on your list.
 */
export function shelfMatcher(copy: OfflineCopy, platformIndex: number, more: readonly string[] = []): { matcher: ShelfMatcher; games: Map<string, OfflineGame> } {
  const games = new Map<string, OfflineGame>();
  copy.games.forEach((g, i) => {
    if (g.p === platformIndex) games.set(String(i), g);
  });
  more.forEach((t, i) => games.set(`x${i}`, { p: platformIndex, t, a: 'not-tracked' }));
  return { matcher: new ShelfMatcher([...games].map(([key, g]) => ({ key, title: g.t }))), games };
}

/** A console's fixes: the ones in the copy (saved in Squirrelcade), then this phone's own, which win. */
export function shelfFixes(copy: OfflineCopy, platformIndex: number, own: Readonly<Record<string, string | null>>): Map<string, string | null> {
  const fixes = new Map<string, string | null>();
  for (const [p, key, title] of copy.fixes ?? []) if (p === platformIndex) fixes.set(key, title);
  for (const [key, title] of Object.entries(own)) fixes.set(key, title);
  return fixes;
}

const OWN_FIXES = 'squirrelcade.shelfFixes';

/** This phone's own fixes, by console key: a viewer's, or the owner's made with no connection (sent when there's one). */
export function ownFixes(): Record<string, Record<string, string | null>> {
  try {
    const kept = JSON.parse(localStorage.getItem(OWN_FIXES) ?? '{}') as unknown;
    return kept && typeof kept === 'object' ? (kept as Record<string, Record<string, string | null>>) : {};
  } catch {
    return {};
  }
}

/** A fix kept on this phone (undefined forgets it); the fixes as they are now. */
export function keepOwnFix(platformKey: string, readKey: string, title: string | null | undefined): Record<string, Record<string, string | null>> {
  const all = ownFixes();
  const mine = { ...(all[platformKey] ?? {}) };
  if (title === undefined) delete mine[readKey];
  else mine[readKey] = title;
  const next = { ...all, [platformKey]: mine };
  if (Object.keys(mine).length === 0) delete next[platformKey];
  try {
    localStorage.setItem(OWN_FIXES, JSON.stringify(next));
  } catch {
    // Storage is off: the fix lasts for this page only.
  }
  return next;
}

/** A console's full list as last fetched, for shelves with no signal. */
export function keptTitles(platformKey: string): string[] | null {
  try {
    const kept = JSON.parse(localStorage.getItem(`squirrelcade.shelfTitles.${platformKey}`) ?? 'null') as unknown;
    return Array.isArray(kept) ? (kept as string[]) : null;
  } catch {
    return null;
  }
}

export function keepTitles(platformKey: string, titles: string[]): void {
  try {
    localStorage.setItem(`squirrelcade.shelfTitles.${platformKey}`, JSON.stringify(titles));
  } catch {
    // Too big or storage off: fetched again next time.
  }
}

/** A game found on the shelf, with Store Mode's answer for it. */
export interface ShelfFound {
  key: string;
  title: string;
  answer: Answer;
  read: string;
  /** Every text read as it (read first): its spines on the photo. */
  reads: string[];
  game: OfflineGame;
  /** Said by you (a fix remembered). */
  fixed?: boolean;
}

/** A spine that could be a game, not surely. */
export interface ShelfUnsure {
  title: string;
  read: string;
  /** Every text read as this guess (read first). */
  reads?: string[];
  doubt: ShelfDoubt;
  other: string | null;
  /** Store Mode's answer if the guess is right, and if it's the other game (the page's own list only). */
  answer?: Answer;
  otherAnswer?: Answer;
  /** You'd need it if it's the guess or the other game (T-406): "Unsure, but if it's this game you need it". */
  wanted?: boolean;
}

/** The checklist: games you need (the wishlist's first), have, have elsewhere or might have, the rest, and the unsure. */
export interface ShelfChecklist {
  need: ShelfFound[];
  own: ShelfFound[];
  elsewhere: ShelfFound[];
  other: ShelfFound[];
  unsure: ShelfUnsure[];
  reads: number;
}

const GROUP: Record<Answer, 'need' | 'own' | 'elsewhere' | 'other'> = {
  need: 'need',
  unconfirmed: 'need',
  own: 'own',
  'own-not-in-catalog': 'own',
  'own-elsewhere': 'elsewhere',
  check: 'elsewhere',
  'not-a-target': 'other',
  'not-tracked': 'other',
};

export function checklist(result: ShelfResult, games: Map<string, OfflineGame>): ShelfChecklist {
  const out: ShelfChecklist = { need: [], own: [], elsewhere: [], other: [], unsure: [], reads: result.reads };
  for (const m of result.sure) {
    const game = games.get(m.key);
    if (game) out[GROUP[game.a]].push({ key: m.key, title: game.t, answer: game.a, read: m.read, reads: m.reads, game, ...(m.fixed ? { fixed: true } : {}) });
  }
  // The wishlist's order first (its rank, then its acorns), then the rest by title.
  out.need.sort((a, b) => (a.game.w?.rank ?? 1e9) - (b.game.w?.rank ?? 1e9) || (b.game.w?.score ?? -1) - (a.game.w?.score ?? -1) || a.title.localeCompare(b.title));
  out.unsure = result.unsure.map((m) => {
    const guess = games.get(m.key);
    const other = m.otherKey !== undefined ? games.get(m.otherKey) : undefined;
    return {
      title: m.title,
      read: m.read,
      reads: m.reads,
      doubt: m.doubt!,
      other: m.other ?? null,
      ...(guess ? { answer: guess.a } : {}),
      ...(other ? { otherAnswer: other.a } : {}),
      wanted: unsureNeeded(m, (k) => games.get(k)),
    };
  });
  return out;
}

/**
 * The unsure spines in their two lists (T-406): the ones you'd need if the guess (or the other game it could be) is
 * right, then the ones you have or don't need either way. The matcher's order (closest reads first) within each.
 */
export function unsureLists(unsure: readonly ShelfUnsure[]): { wanted: ShelfUnsure[]; rest: ShelfUnsure[] } {
  return { wanted: unsure.filter((u) => u.wanted), rest: unsure.filter((u) => !u.wanted) };
}

/** A rectangle on the photo, in its own pixels. */
export interface PhotoRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The lines read as any of a game's texts (the ones that can be drawn: read well enough), so it can be shown on the photo. */
export function linesFor(lines: readonly ReadLine[], reads: readonly string[]): ReadLine[] {
  const texts = new Set(reads);
  return lines.filter((l) => l.score >= 0.5 && l.box.length > 0 && texts.has(l.text));
}

/** The rectangle around some lines' boxes, or null when there are none. */
export function boundsOf(lines: readonly ReadLine[]): PhotoRect | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const l of lines)
    for (const [x, y] of l.box) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return x0 === Infinity ? null : { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/** How the photo is drawn in its frame: scaled by `scale` (1 is the frame's width) and moved by x and y, in CSS pixels. */
export interface PhotoView {
  scale: number;
  x: number;
  y: number;
}

/** At most this much bigger than the whole photo, so a zoomed spine stays sharp enough to judge. */
const MOST_ZOOM = 6;

/**
 * Where the photo sits in a frame of the page (T-406). With no rectangle, the whole photo, centered when the frame is
 * shorter than it (a tall photo in a frame of limited height). With one, zoomed so the rectangle and some of the shelf
 * around it fill the frame, centered on it but never past the photo's edges, so a tapped game's spine is in view.
 */
export function photoView(photo: { width: number; height: number }, frame: { width: number; height: number }, rect: PhotoRect | null): PhotoView {
  const f = frame.width / photo.width; // the photo's pixels in CSS pixels, at scale 1
  const tall = photo.height * f; // the photo's height at scale 1
  const fit = Math.min(1, frame.height / tall);
  const whole = { scale: fit, x: (frame.width - frame.width * fit) / 2, y: (frame.height - tall * fit) / 2 };
  if (!rect || frame.width <= 0 || frame.height <= 0) return whole;
  // Room around the spine: half its size again, at least an eighth of the frame.
  const w = rect.w * f * 1.5 + frame.width / 8;
  const h = rect.h * f * 1.5 + frame.height / 8;
  const scale = Math.max(fit, Math.min(MOST_ZOOM, frame.width / w, frame.height / h));
  const cx = (rect.x + rect.w / 2) * f * scale;
  const cy = (rect.y + rect.h / 2) * f * scale;
  // Centered on the spine, kept inside the photo (or centered, along a side where the photo is smaller than the frame).
  const place = (center: number, size: number, room: number) => (size <= room ? (room - size) / 2 : Math.min(0, Math.max(room - size, room / 2 - center)));
  return { scale, x: place(cx, frame.width * scale, frame.width), y: place(cy, tall * scale, frame.height) };
}

/** Why a spine is unsure, in words. */
export function doubtText(u: ShelfUnsure): string {
  switch (u.doubt) {
    case 'number':
      return "its number wasn't read clearly";
    case 'or':
      return `or ${u.other}`;
    case 'cut-off':
      return `or ${u.other}, if the end was cut off`;
    default:
      return 'only partly read';
  }
}

/** Reads from the reader and from a vision model, together for the matcher. */
export function allReads(lines: ReadLine[], modelTitles: string[]): ShelfRead[] {
  return [...lines.map((l) => ({ text: l.text, score: l.score })), ...modelTitles.map((text) => ({ text, score: 1, model: true }))];
}
