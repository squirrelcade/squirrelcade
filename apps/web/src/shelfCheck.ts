import { ShelfMatcher, type ShelfDoubt, type ShelfRead, type ShelfResult } from '@squirrelcade/core';
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

/** A console's games from the copy, and a matcher for them (keyed by each game's place in the copy). */
export function shelfMatcher(copy: OfflineCopy, platformIndex: number): { matcher: ShelfMatcher; games: Map<string, OfflineGame> } {
  const games = new Map<string, OfflineGame>();
  copy.games.forEach((g, i) => {
    if (g.p === platformIndex) games.set(String(i), g);
  });
  return { matcher: new ShelfMatcher([...games].map(([key, g]) => ({ key, title: g.t }))), games };
}

/** A game found on the shelf, with Store Mode's answer for it. */
export interface ShelfFound {
  key: string;
  title: string;
  answer: Answer;
  read: string;
  game: OfflineGame;
}

/** A spine that could be a game, not surely. */
export interface ShelfUnsure {
  title: string;
  read: string;
  doubt: ShelfDoubt;
  other: string | null;
  /** Store Mode's answer if the guess is right (the page's own list only). */
  answer?: Answer;
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
    if (game) out[GROUP[game.a]].push({ key: m.key, title: game.t, answer: game.a, read: m.read, game });
  }
  // The wishlist's order first (its rank, then its acorns), then the rest by title.
  out.need.sort((a, b) => (a.game.w?.rank ?? 1e9) - (b.game.w?.rank ?? 1e9) || (b.game.w?.score ?? -1) - (a.game.w?.score ?? -1) || a.title.localeCompare(b.title));
  out.unsure = result.unsure.map((m) => ({ title: m.title, read: m.read, doubt: m.doubt!, other: m.other ?? null, ...(games.get(m.key) ? { answer: games.get(m.key)!.a } : {}) }));
  return out;
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
