import { ShelfMatcher, type ShelfDoubt, type ShelfRead } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import { CHECK_ANSWERS, type CheckAnswer } from './check.js';
import type { LookupService, OfflineGame } from './lookup.js';
import type { SettingsService } from './settings.js';
import { MAX_PIECE_CHARS, MAX_PIECES, VisionError, type VisionClient } from './vision.js';

/**
 * Check a shelf (D147). Signed in, the phone reads the photo and matches it against Store Mode's copy itself; the
 * server only passes pieces of the photo to the vision model when it's on (POST /api/v1/shelf/read). Not signed in
 * (Settings > Security, with checking a game), the visitor's phone reads the photo and sends the text it read: the
 * server matches it here and answers only for the games read, as the one-game check does, so the collection itself
 * never leaves; and, if the owner allows it, the pieces go to the vision model too. With the owner's key (a start page
 * of their own passing friends' checks on) it answers the same way whatever the sign-in page shows, without the
 * hourly limit; the vision model still goes by "Check a shelf without signing in".
 */

/** A 64-pixel white square: what the test sends. */
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3PMQ0AMAzAsPInvYLYYVWKESTzjhsd8KsBrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BbQHKU9LC7/CP1AAAAABJRU5ErkJggg==';

/** At most this many lines read in one shelf check. */
const MAX_READS = 800;
const HOUR_MS = 60 * 60_000;
/** Pieces of a photo with everything else in the request: up to nine pieces of a few megabytes. */
const BODY_LIMIT = MAX_PIECES * MAX_PIECE_CHARS + 1_000_000;

/** One game read on a shelf, as someone not signed in sees it. */
export interface ShelfAnswer {
  title: string;
  answer: CheckAnswer['answer'];
  ownedOn: string[];
  wishlist: { priority: string; rank: number | null } | null;
  /** What was read. */
  read: string;
}

/** A spine read that could be a game, but not surely: the best guess, and why it's unsure. */
export interface ShelfGuess {
  title: string;
  read: string;
  doubt: ShelfDoubt;
  other: string | null;
}

/** The pieces in a request, checked: data URLs of images, not too many, not too big. */
function piecesOf(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_PIECES) return null;
  for (const p of value) if (typeof p !== 'string' || p.length > MAX_PIECE_CHARS || !p.startsWith('data:image/')) return null;
  return value as string[];
}

function readsOf(value: unknown): ShelfRead[] | null {
  if (!Array.isArray(value) || value.length > MAX_READS) return null;
  const out: ShelfRead[] = [];
  for (const r of value) {
    const x = r as { text?: unknown; score?: unknown };
    if (!x || typeof x.text !== 'string' || x.text.length > 300 || typeof x.score !== 'number' || !(x.score >= 0 && x.score <= 1)) return null;
    out.push({ text: x.text, score: x.score });
  }
  return out;
}

export function registerShelfRoutes(app: FastifyInstance, lookup: LookupService, settings: SettingsService, vision: VisionClient): void {
  // What the vision model can do now, for the phone deciding whether to send pieces.
  app.get('/api/v1/shelf/model', async () => ({ available: vision.ready(), left: vision.left(), pieces: settings.get('sources.visionPieces') }));

  app.post('/api/v1/shelf/read', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const body = request.body as { pieces?: unknown; console?: unknown } | null;
    const pieces = piecesOf(body?.pieces);
    if (!pieces || pieces.length === 0) return reply.code(400).send({ error: 'invalid', message: `Send 1 to ${MAX_PIECES} pieces of the photo as images.` });
    const consoleName = typeof body?.console === 'string' ? body.console.slice(0, 80) : null;
    try {
      const { titles, sent } = await vision.read(pieces, consoleName);
      return { titles, sent, left: vision.left() };
    } catch (err) {
      if (err instanceof VisionError) return reply.code(502).send({ error: 'vision', message: err.message });
      throw err;
    }
  });

  // Settings > Sources > Vision model's test (the owner's): a small blank image, to see the service answer.
  app.post('/api/v1/shelf/test', async () => {
    try {
      await vision.read([BLANK], null);
      return { ok: true, message: `${settings.get('sources.visionModel')} answered.` };
    } catch (err) {
      if (err instanceof VisionError) return { ok: false, message: err.message };
      throw err;
    }
  });

  // Each address's shelf checks in the last hour (not signed in).
  const recent = new Map<string, number[]>();
  const allow = (address: string): boolean => {
    const now = Date.now();
    const times = (recent.get(address) ?? []).filter((t) => now - t < HOUR_MS);
    if (times.length >= settings.get('security.publicShelfLimit')) {
      recent.set(address, times);
      return false;
    }
    times.push(now);
    recent.set(address, times);
    if (recent.size > 5000) for (const [key, list] of recent) if (list.every((t) => now - t >= HOUR_MS)) recent.delete(key);
    return true;
  };
  const shelfOn = () => settings.get('security.publicCheck') !== 'off' && settings.get('security.publicShelf') !== 'off';
  const modelForVisitors = () => settings.get('security.publicShelf') === 'model' && vision.ready();

  // The matcher for a console, kept while Store Mode's copy is the same.
  let kept: { etag: string; platformKey: string; matcher: ShelfMatcher; games: Map<string, OfflineGame> } | null = null;
  const matcherFor = (platformKey: string) => {
    const { copy, etag } = lookup.offlineCopy(false);
    if (kept && kept.etag === etag && kept.platformKey === platformKey) return kept;
    const place = copy.platforms.findIndex((p) => p.key === platformKey);
    if (place < 0) return null;
    const games = new Map<string, OfflineGame>();
    copy.games.forEach((g, i) => {
      if (g.p === place) games.set(String(i), g);
    });
    kept = { etag, platformKey, matcher: new ShelfMatcher([...games].map(([key, g]) => ({ key, title: g.t }))), games };
    return kept;
  };

  // The consoles a visitor can pick: those with a catalog or copies.
  app.get('/api/v1/check/consoles', async (request, reply) => {
    if (!request.auth && !shelfOn()) return reply.code(404).send({ error: 'off', message: 'Checking a shelf without signing in is off.' });
    const { copy } = lookup.offlineCopy(false);
    const used = new Set(copy.games.filter((g) => g.a !== 'not-tracked').map((g) => g.p));
    const consoles = copy.platforms.filter((_, i) => used.has(i)).sort((a, b) => a.name.localeCompare(b.name));
    return { consoles, model: modelForVisitors(), pieces: settings.get('sources.visionPieces') };
  });

  app.post('/api/v1/check/shelf', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    if (!request.auth && !shelfOn()) return reply.code(404).send({ error: 'off', message: 'Checking a shelf without signing in is off.' });
    const body = request.body as { platformKey?: unknown; reads?: unknown; pieces?: unknown } | null;
    const reads = readsOf(body?.reads ?? []);
    const pieces = piecesOf(body?.pieces);
    if (typeof body?.platformKey !== 'string' || !reads || !pieces) return reply.code(400).send({ error: 'invalid', message: 'Send the console and what was read on the photo.' });
    const found = matcherFor(body.platformKey);
    if (!found) return reply.code(400).send({ error: 'invalid', message: 'Pick one of the consoles.' });
    if (!request.auth && !allow(request.ip)) return reply.code(429).send({ error: 'too-many', message: 'That was a lot of shelves. Try again in an hour.' });
    const consoleName = lookup.offlineCopy(false).copy.platforms.find((p) => p.key === body.platformKey)?.name ?? null;
    let model: { sent: number; titles: number } | { error: string } | null = null;
    const lines: ShelfRead[] = [...reads];
    if (pieces.length > 0 && modelForVisitors()) {
      try {
        const { titles, sent } = await vision.read(pieces, consoleName);
        lines.push(...titles.map((text) => ({ text, score: 1, model: true })));
        model = { sent, titles: titles.length };
      } catch (err) {
        if (!(err instanceof VisionError)) throw err;
        model = { error: err.message };
      }
    }
    const result = found.matcher.match(lines);
    const order: Record<CheckAnswer['answer'], number> = { need: 0, maybe: 1, elsewhere: 2, own: 3, 'not-collected': 4 };
    const games: ShelfAnswer[] = result.sure
      .map((m) => {
        const g = found.games.get(m.key)!;
        const answer = CHECK_ANSWERS[g.a];
        const wanted = answer === 'need' || answer === 'elsewhere';
        return { title: g.t, answer, ownedOn: g.on ?? [], wishlist: wanted && g.w ? { priority: g.w.priority, rank: g.w.rank } : null, read: m.read };
      })
      .sort((a, b) => order[a.answer] - order[b.answer] || (a.wishlist?.rank ?? 1e9) - (b.wishlist?.rank ?? 1e9) || a.title.localeCompare(b.title));
    const unsure: ShelfGuess[] = result.unsure.map((m) => ({ title: m.title, read: m.read, doubt: m.doubt!, other: m.other ?? null }));
    return { platform: consoleName, games, unsure, reads: result.reads, model };
  });
}
