import { ShelfMatcher, type ShelfDoubt, type ShelfRead } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import { CHECK_ANSWERS, type CheckAnswer } from './check.js';
import type { LookupService, OfflineGame } from './lookup.js';
import type { SettingsService } from './settings.js';
import { MAX_PIECE_CHARS, MAX_PIECES, VisionError, type VisionClient, type VisionJob } from './vision.js';

/**
 * Check a shelf (D147). Signed in, the phone reads the photo and matches it against Store Mode's copy itself; the
 * server only has pieces of the photo read by the vision model when it's on (POST /api/v1/shelf/read starts a job,
 * GET /api/v1/shelf/read/:id gives its titles when done). Not signed in (Settings > Security, with checking a game),
 * the visitor's phone reads the photo and sends the text it read: the server matches it here and answers only for the
 * games read, as the one-game check does, so the collection itself never leaves; if the owner allows it, the pieces
 * go to the vision model too, and GET /api/v1/check/shelf/:id answers again with what it read. Visitors have limits
 * of their own: shelves an hour, games answered an hour (so made-up shelves can't read the collection), lines per
 * shelf, the photo's size, and the model's pieces a day. With the owner's key (a start page of their own passing
 * friends' checks on) it answers the same way whatever the sign-in page shows, without those limits (the start page
 * keeps its own); the vision model still goes by "Check a shelf without signing in".
 */

/** At most this many lines read in one shelf check: signed in (the owner's start page passing friends' checks on), and not. */
const MAX_READS = 800;
const VISITOR_READS = 300;
const HOUR_MS = 60 * 60_000;
/** Pieces of a photo with everything else in the request (a visitor's is checked against less before it's read). */
const BODY_LIMIT = MAX_PIECES * MAX_PIECE_CHARS + 1_000_000;
/** The settings' test waits this long for an answer, under a proxy's time limit (Cloudflare's is 100 seconds). */
const TEST_WAIT_MS = 80_000;
/** A 64-pixel white square: what the test sends. */
const BLANK =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAXklEQVR4nO3PMQ0AMAzAsPInvYLYYVWKESTzjhsd8KsBrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BrQGtAa0BbQHKU9LC7/CP1AAAAABJRU5ErkJggg==';

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

function readsOf(value: unknown, max: number): ShelfRead[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: ShelfRead[] = [];
  for (const r of value) {
    const x = r as { text?: unknown; score?: unknown };
    if (!x || typeof x.text !== 'string' || x.text.length > 300 || typeof x.score !== 'number' || !(x.score >= 0 && x.score <= 1)) return null;
    out.push({ text: x.text, score: x.score });
  }
  return out;
}

/** A job as its asker sees it. */
function jobView(job: VisionJob, left: number | null) {
  return { id: job.id, state: job.state, titles: job.titles, error: job.error, sent: job.sent, left };
}

/** Who a visitor is for the limits: their address, or for IPv6 its /64 (one home's whole range). */
export function visitorOf(ip: string): string {
  if (ip.includes('.')) return ip.slice(ip.lastIndexOf(':') + 1);
  return ip.split(':').slice(0, 4).join(':');
}

/** Amounts in a sliding hour, per visitor: an amount is allowed while the hour's total stays within the limit. */
class HourlyBudget {
  private readonly spent = new Map<string, { at: number; n: number }[]>();

  spend(who: string, n: number, limit: number): boolean {
    const now = Date.now();
    const list = (this.spent.get(who) ?? []).filter((x) => now - x.at < HOUR_MS);
    const total = list.reduce((sum, x) => sum + x.n, 0);
    if (total + n > limit) {
      this.spent.set(who, list);
      return false;
    }
    list.push({ at: now, n });
    this.spent.set(who, list);
    if (this.spent.size > 5000) for (const [k, l] of this.spent) if (l.every((x) => now - x.at >= HOUR_MS)) this.spent.delete(k);
    return true;
  }
}

export function registerShelfRoutes(app: FastifyInstance, lookup: LookupService, settings: SettingsService, vision: VisionClient): void {
  const consoleNames = () => new Set(lookup.offlineCopy(false).copy.platforms.map((p) => p.name));

  // What the vision model can do now, for the phone deciding whether to send pieces.
  app.get('/api/v1/shelf/model', async () => ({
    available: vision.ready(),
    left: vision.left(),
    pieces: settings.get('sources.visionPieces'),
    helper: settings.get('sources.visionApi') === 'helper' ? vision.helperThere() : null,
  }));

  // Starts reading pieces of a photo; the phone asks for the titles until they're there.
  app.post('/api/v1/shelf/read', { bodyLimit: BODY_LIMIT }, async (request, reply) => {
    const body = request.body as { pieces?: unknown; console?: unknown } | null;
    const pieces = piecesOf(body?.pieces);
    if (!pieces || pieces.length === 0) return reply.code(400).send({ error: 'invalid', message: `Send 1 to ${MAX_PIECES} pieces of the photo as images.` });
    // Only a console Squirrelcade knows goes into the model's prompt, never other text.
    const consoleName = typeof body?.console === 'string' && consoleNames().has(body.console) ? body.console : null;
    try {
      return jobView(vision.start(pieces, consoleName), vision.left());
    } catch (err) {
      if (err instanceof VisionError) return reply.code(502).send({ error: 'vision', message: err.message });
      throw err;
    }
  });
  app.get('/api/v1/shelf/read/:id', async (request, reply) => {
    const job = vision.job((request.params as { id: string }).id);
    if (!job) return reply.code(404).send({ error: 'not-found', message: 'That photo is no longer being read.' });
    return jobView(job, vision.left());
  });

  // Settings > Sources > Vision model's test (the owner's): a small blank image, to see the service answer.
  app.post('/api/v1/shelf/test', async () => {
    try {
      const job = await vision.wait(vision.start([BLANK], null), TEST_WAIT_MS);
      if (job.state === 'done') return { ok: true, message: settings.get('sources.visionApi') === 'helper' ? 'The helper answered.' : `${settings.get('sources.visionModel')} answered.` };
      if (job.state === 'failed') return { ok: false, message: job.error ?? "The vision model didn't answer." };
      return { ok: false, message: 'No answer within 80 seconds: it may be reading another photo. Try again in a minute.' };
    } catch (err) {
      if (err instanceof VisionError) return { ok: false, message: err.message };
      throw err;
    }
  });

  // Each visitor's shelf checks, and the games they were answered for, in the last hour (not signed in).
  const shelves = new HourlyBudget();
  const answered = new HourlyBudget();
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
  const consoleNameOf = (platformKey: string) => lookup.offlineCopy(false).copy.platforms.find((p) => p.key === platformKey)?.name ?? null;

  /** A visitor's answer: the games read, the unsure ones, and how the vision model is doing. */
  const answerFor = (platformKey: string, reads: ShelfRead[], job: VisionJob | null, modelError: string | null) => {
    const found = matcherFor(platformKey)!;
    const lines: ShelfRead[] = [...reads];
    if (job?.state === 'done') lines.push(...job.titles.map((text) => ({ text, score: 1, model: true })));
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
    const model = modelError ? { id: null, state: 'failed', titles: 0, sent: 0, error: modelError } : job ? { id: job.id, state: job.state, titles: job.titles.length, sent: job.sent, error: job.error } : null;
    return { platform: consoleNameOf(platformKey), games, unsure, reads: result.reads, model };
  };
  type Answer = ReturnType<typeof answerFor>;
  // A visitor's shelf being read by the vision model: what they sent, and the answer as it stands (worked out once for
  // each state of the model's job, not for every ask).
  const visits = new Map<string, { platformKey: string; reads: ShelfRead[]; at: number; visitor: string | null; counted: number; state: string; answer: Answer }>();

  // The consoles a visitor can pick: those with a catalog or copies.
  app.get('/api/v1/check/consoles', async (request, reply) => {
    if (!request.auth && !shelfOn()) return reply.code(404).send({ error: 'off', message: 'Checking a shelf without signing in is off.' });
    const { copy } = lookup.offlineCopy(false);
    const used = new Set(copy.games.filter((g) => g.a !== 'not-tracked').map((g) => g.p));
    const consoles = copy.platforms.filter((_, i) => used.has(i)).sort((a, b) => a.name.localeCompare(b.name));
    return { consoles, model: modelForVisitors(), pieces: settings.get('sources.visionPieces') };
  });

  app.post(
    '/api/v1/check/shelf',
    {
      bodyLimit: BODY_LIMIT,
      // A visitor is turned away before the photo's pieces are read in: when it's off, too big, or too often.
      onRequest: async (request, reply) => {
        if (request.auth) return;
        if (!shelfOn()) return reply.code(404).send({ error: 'off', message: 'Checking a shelf without signing in is off.' });
        const most = (modelForVisitors() ? settings.get('sources.visionPieces') * MAX_PIECE_CHARS : 0) + 200_000;
        if (Number(request.headers['content-length'] ?? 0) > most) return reply.code(413).send({ error: 'too-big', message: 'That photo is too big to check.' });
        if (!shelves.spend(visitorOf(request.ip), 1, settings.get('security.publicShelfLimit'))) return reply.code(429).send({ error: 'too-many', message: 'That was a lot of shelves. Try again in an hour.' });
      },
    },
    async (request, reply) => {
      const visitor = request.auth ? null : visitorOf(request.ip);
      const body = request.body as { platformKey?: unknown; reads?: unknown; pieces?: unknown } | null;
      const reads = readsOf(body?.reads ?? [], visitor ? VISITOR_READS : MAX_READS);
      const sent = piecesOf(body?.pieces);
      if (typeof body?.platformKey !== 'string' || !reads || !sent) return reply.code(400).send({ error: 'invalid', message: 'Send the console and what was read on the photo.' });
      const platformKey = body.platformKey;
      if (!matcherFor(platformKey)) return reply.code(400).send({ error: 'invalid', message: 'Pick one of the consoles.' });
      // As many pieces as Squirrelcade cuts a photo into, no more.
      const pieces = sent.slice(0, settings.get('sources.visionPieces'));
      let job: VisionJob | null = null;
      let modelError: string | null = null;
      if (pieces.length > 0 && modelForVisitors()) {
        try {
          job = vision.start(pieces, consoleNameOf(platformKey), visitor !== null);
        } catch (err) {
          if (!(err instanceof VisionError)) throw err;
          modelError = err.message;
        }
      }
      const answer = answerFor(platformKey, reads, job, modelError);
      // Each game answered counts against the visitor's hour, so made-up shelves can't read the collection.
      const counted = answer.games.length + answer.unsure.length;
      if (visitor && !answered.spend(visitor, counted, settings.get('security.publicShelfGames'))) {
        return reply.code(429).send({ error: 'too-many', message: 'That was a lot of games. Try again in an hour.' });
      }
      if (job) {
        for (const [id, v] of visits) if (Date.now() - v.at > 20 * 60_000) visits.delete(id);
        visits.set(job.id, { platformKey, reads, at: Date.now(), visitor, counted, state: job.state, answer });
      }
      return answer;
    },
  );

  // The same shelf again once the vision model has read it (or failed): what's read so far, and its state.
  app.get('/api/v1/check/shelf/:id', async (request, reply) => {
    if (!request.auth && !shelfOn()) return reply.code(404).send({ error: 'off', message: 'Checking a shelf without signing in is off.' });
    const id = (request.params as { id: string }).id;
    const visit = visits.get(id);
    const job = vision.job(id);
    if (!visit || !job || !matcherFor(visit.platformKey)) return reply.code(404).send({ error: 'not-found', message: 'That shelf is no longer being read.' });
    if (visit.state !== job.state) {
      const answer = answerFor(visit.platformKey, visit.reads, job, null);
      // The games the model added count too (once); past the hour's limit, the visitor keeps what the phone read.
      const more = Math.max(0, answer.games.length + answer.unsure.length - visit.counted);
      if (visit.visitor && more > 0 && !answered.spend(visit.visitor, more, settings.get('security.publicShelfGames'))) {
        visit.answer = { ...visit.answer, model: { id: job.id, state: 'failed', titles: 0, sent: job.sent, error: "That's a lot of games this hour: the phone's reading is all for now." } };
      } else {
        visit.answer = answer;
        visit.counted += more;
      }
      visit.state = job.state;
    }
    return visit.answer;
  });
}
