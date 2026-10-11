import { randomUUID } from 'node:crypto';
import { HelperError, type HelperQueue } from './helper.js';
import type { FetchLike } from './igdb.js';
import type { SettingsService } from './settings.js';

/**
 * Check a shelf's optional vision model (D147): pieces of a shelf photo read by a model the owner chose, which returns
 * the titles it reads. Any service that takes OpenAI's chat format with images (OpenAI, Google Gemini, OpenRouter,
 * Ollama and LM Studio at home, and most others) or Anthropic's Messages API (Claude); or a helper of the owner's own,
 * a program that asks Squirrelcade for work and answers (GET /api/v1/helper/next, POST /api/v1/helper/answer): on the
 * owner's server, Claude Code signed in with their own plan, say. The model only reads: the titles go through the same
 * matcher as the phone's own reading, so it never decides what you own.
 *
 * Each photo is a job: started at once, read in the background, asked about until it's done (a phone's request
 * through a proxy can't wait minutes: Cloudflare gives up after 100 seconds).
 */

/** The service refused or failed, with a message to show. */
export class VisionError extends Error {}

/** A piece of a photo: a JPEG or PNG as a data URL. */
const DATA_URL = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/;
/** At most this many pieces in one request to Squirrelcade, and this large each (base64 characters: a piece 1,568
 * pixels long as a JPEG is well under a megabyte). */
export const MAX_PIECES = 9;
export const MAX_PIECE_CHARS = 2_000_000;
/** Two pieces at a time: a home model works one at a time anyway, and a service's rate limit stays clear. */
const AT_ONCE = 2;
/** A finished job is kept this long for its asker to collect; one not finished by then has failed. */
const KEEP_MS = 15 * 60_000;
const LONGEST_MS = 12 * 60_000;

/** What the model is asked, for each piece (and what a helper is given to ask). */
export function visionPrompt(consoleName: string | null): string {
  return [
    `This is part of a photo of video game shelves${consoleName ? ` (mostly ${consoleName} games)` : ''}.`,
    'List the title of every video game you can read on a spine, case or cover, one per line, exactly as printed, numbers and subtitles included.',
    "Leave out any you can't read with confidence, and anything that isn't a game title (prices, store labels, ratings). Write nothing else.",
  ].join(' ');
}

/** The titles in a model's answer: one per line, without list marks, quotes or notes. */
export function titlesOf(answer: string): string[] {
  const out: string[] = [];
  for (const raw of answer.split('\n')) {
    const line = raw
      .replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '')
      .replace(/^["“'`]+|["”'`]+$/g, '')
      .replace(/\*\*/g, '')
      .trim();
    if (line.length < 2 || line.length > 150 || /^(?:here (?:are|is)|i can see|titles?:|the following)/i.test(line)) continue;
    out.push(line);
  }
  return out;
}

/** A photo's pieces being read. */
export interface VisionJob {
  id: string;
  pieces: string[];
  consoleName: string | null;
  state: 'waiting' | 'reading' | 'done' | 'failed';
  titles: string[];
  error: string | null;
  sent: number;
  createdAt: number;
  finishedAt: number | null;
}

export class VisionClient {
  /** Pieces sent today (the server's day), for the daily limit; starts again after a restart. */
  private day = '';
  private used = 0;
  /** Of them, the pieces of visitors not signed in (their own limit, Settings > Security). */
  private visitorsUsed = 0;
  private readonly jobs = new Map<string, VisionJob>();
  /** Each job's way to take back its work from the helper's queue, when it ends before a helper took it. */
  private readonly takeBack = new Map<string, AbortController>();

  constructor(
    private readonly settings: SettingsService,
    private readonly helpers: HelperQueue,
    private readonly fetcher: FetchLike = (url, init) => fetch(url, init),
  ) {}

  private helperMode(): boolean {
    return this.settings.get('sources.visionApi') === 'helper';
  }

  /** Whether the model is on and set up (an address and a model, or a helper; a key only if the service needs one). */
  ready(): boolean {
    if (this.settings.get('features.vision') !== true) return false;
    return this.helperMode() || (this.settings.get('sources.visionUrl') !== '' && this.settings.get('sources.visionModel') !== '');
  }

  /** Whether a helper asked for work lately (helper mode). */
  helperThere(): boolean {
    return this.helpers.there();
  }

  /** Pieces left today (null: no limit); for a visitor, also within the visitors' own limit. */
  left(visitor = false): number | null {
    this.rollDay();
    const limit = this.settings.get('sources.visionDailyLimit');
    const all = limit === 0 ? null : Math.max(0, limit - this.used);
    if (!visitor) return all;
    const theirs = this.settings.get('security.publicShelfPieces');
    const visitors = theirs === 0 ? null : Math.max(0, theirs - this.visitorsUsed);
    return all === null ? visitors : visitors === null ? all : Math.min(all, visitors);
  }

  private rollDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
      this.visitorsUsed = 0;
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.finishedAt !== null && now - job.finishedAt > KEEP_MS) this.jobs.delete(id);
      else if (job.finishedAt === null && now - job.createdAt > LONGEST_MS) this.finish(job, null, 'It took too long.');
    }
  }

  private finish(job: VisionJob, titles: string[] | null, error: string | null) {
    if (job.state === 'done' || job.state === 'failed') return;
    job.state = titles ? 'done' : 'failed';
    this.takeBack.get(job.id)?.abort();
    this.takeBack.delete(job.id);
    job.titles = titles ?? [];
    job.error = error;
    job.finishedAt = Date.now();
    // A helper is given the pieces once; they needn't be kept after.
    job.pieces = [];
  }

  /** Starts reading a photo's pieces (the ones past today's limit aren't sent); the job says when it's done. */
  start(pieces: string[], consoleName: string | null, visitor = false): VisionJob {
    this.sweep();
    if (!this.ready()) throw new VisionError('The vision model is off or not set up (Settings > Features).');
    if (this.helperMode() && !this.helperThere()) throw new VisionError("The helper isn't asking for work: is it running? (Settings > Sources > Vision model)");
    const left = this.left(visitor);
    const sending = left === null ? pieces : pieces.slice(0, left);
    if (sending.length === 0) throw new VisionError("Today's pieces for the vision model are used up (Settings > Sources > Vision model).");
    for (const p of sending) if (!DATA_URL.test(p)) throw new VisionError('A piece of the photo isn’t an image.');
    this.used += sending.length;
    if (visitor) this.visitorsUsed += sending.length;
    const job: VisionJob = { id: randomUUID(), pieces: sending, consoleName, state: 'waiting', titles: [], error: null, sent: sending.length, createdAt: Date.now(), finishedAt: null };
    this.jobs.set(job.id, job);
    job.state = 'reading';
    void (this.helperMode() ? this.readWithHelper(job) : this.readWithService(job));
    return job;
  }

  /** A job, while it's kept. */
  job(id: string): VisionJob | undefined {
    this.sweep();
    return this.jobs.get(id);
  }

  /** A job's end: its titles, or its error. */
  async wait(job: VisionJob, timeoutMs = LONGEST_MS): Promise<VisionJob> {
    const until = Date.now() + timeoutMs;
    while (job.state === 'waiting' || job.state === 'reading') {
      if (Date.now() > until) break;
      await new Promise((r) => setTimeout(r, 100));
      this.sweep();
    }
    return job;
  }

  /** start and wait together: the titles, or a VisionError. */
  async read(pieces: string[], consoleName: string | null): Promise<{ titles: string[]; sent: number }> {
    const job = await this.wait(this.start(pieces, consoleName));
    if (job.state !== 'done') throw new VisionError(job.error ?? "The vision model didn't answer.");
    return { titles: job.titles, sent: job.sent };
  }

  /** Has the owner's helper read a job's pieces. */
  private async readWithHelper(job: VisionJob): Promise<void> {
    try {
      const takeBack = new AbortController();
      this.takeBack.set(job.id, takeBack);
      const a = await this.helpers.ask('shelf', { prompt: visionPrompt(job.consoleName), console: job.consoleName, pieces: job.pieces }, takeBack.signal);
      if (Array.isArray(a.titles)) this.finish(job, titlesOf(a.titles.filter((t): t is string => typeof t === 'string').join('\n')), null);
      else if (typeof a.text === 'string') this.finish(job, titlesOf(a.text), null);
      else this.finish(job, null, "The helper's answer had no titles.");
    } catch (err) {
      this.finish(job, null, err instanceof HelperError ? `${err.message} (Settings > Sources > Vision model)` : String((err as Error)?.message ?? err));
    }
  }

  /** Reads a job's pieces with the service, two at a time. */
  private async readWithService(job: VisionJob): Promise<void> {
    const titles: string[] = [];
    let failure: unknown = null;
    const pieces = job.pieces;
    for (let i = 0; i < pieces.length; i += AT_ONCE) {
      const answers = await Promise.allSettled(pieces.slice(i, i + AT_ONCE).map((p) => this.ask(p, job.consoleName)));
      for (const a of answers) {
        if (a.status === 'fulfilled') titles.push(...titlesOf(a.value));
        else failure ??= a.reason;
      }
    }
    // Some pieces read is an answer; none read is the service's error.
    if (titles.length === 0 && failure) this.finish(job, null, failure instanceof VisionError ? failure.message : `The vision model didn't answer: ${String((failure as Error)?.message ?? failure)}`);
    else this.finish(job, titles, null);
  }

  /** A text-only question to the same service (Talk, D148), with another model if given; returns its answer's text. */
  async chat(prompt: string, model: string | null): Promise<string> {
    const base = this.settings.get('sources.visionUrl').replace(/\/+$/, '');
    const key = this.settings.get('sources.visionKey');
    const anthropic = this.settings.get('sources.visionApi') === 'anthropic';
    const name = model || this.settings.get('sources.visionModel');
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (anthropic) {
      headers['anthropic-version'] = '2023-06-01';
      if (key) headers['x-api-key'] = key;
    } else if (key) headers.authorization = `Bearer ${key}`;
    const body = anthropic
      ? { model: name, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] }
      : { model: name, max_tokens: 2000, temperature: 0.2, messages: [{ role: 'user', content: prompt }] };
    let res: Response;
    try {
      res = await this.fetcher(`${base}${anthropic ? '/messages' : '/chat/completions'}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    } catch (err) {
      throw new VisionError(`Couldn't reach the AI model at ${base}: ${String((err as Error)?.message ?? err)}`);
    }
    const data = (await res.json().catch(() => null)) as { error?: { message?: string } | string; content?: { type: string; text?: string }[]; choices?: { message?: { content?: string } }[] } | null;
    if (!res.ok) {
      const said = typeof data?.error === 'string' ? data.error : data?.error?.message;
      throw new VisionError(`The AI model refused (${res.status})${said ? `: ${said.slice(0, 300)}` : ''}`);
    }
    return anthropic ? (data?.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('\n') : (data?.choices?.[0]?.message?.content ?? '');
  }

  /** Asks the model about one piece; returns its answer's text. */
  private async ask(piece: string, consoleName: string | null): Promise<string> {
    const m = DATA_URL.exec(piece);
    if (!m) throw new VisionError('A piece of the photo isn’t an image.');
    const base = this.settings.get('sources.visionUrl').replace(/\/+$/, '');
    const model = this.settings.get('sources.visionModel');
    const key = this.settings.get('sources.visionKey');
    const anthropic = this.settings.get('sources.visionApi') === 'anthropic';
    const text = visionPrompt(consoleName);
    const url = anthropic ? `${base}/messages` : `${base}/chat/completions`;
    const body = anthropic
      ? { model, max_tokens: 1500, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text }] }] }
      : { model, max_tokens: 1500, temperature: 0, messages: [{ role: 'user', content: [{ type: 'text', text }, { type: 'image_url', image_url: { url: piece } }] }] };
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (anthropic) {
      headers['anthropic-version'] = '2023-06-01';
      if (key) headers['x-api-key'] = key;
    } else if (key) headers.authorization = `Bearer ${key}`;
    let res: Response;
    try {
      res = await this.fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
    } catch (err) {
      throw new VisionError(`Couldn't reach the vision model at ${base}: ${String((err as Error)?.message ?? err)}`);
    }
    const raw = await res.text();
    let data: unknown = null;
    try {
      data = JSON.parse(raw);
    } catch {
      // Not JSON: said below.
    }
    if (!res.ok) {
      const said = (data as { error?: { message?: string } | string } | null)?.error;
      const message = typeof said === 'string' ? said : said?.message;
      throw new VisionError(`The vision model refused (${res.status})${message ? `: ${message.slice(0, 300)}` : ''}`);
    }
    const answer = anthropic
      ? ((data as { content?: { type: string; text?: string }[] } | null)?.content ?? []).map((c) => (c.type === 'text' ? (c.text ?? '') : '')).join('\n')
      : ((data as { choices?: { message?: { content?: string | { type: string; text?: string }[] } }[] } | null)?.choices?.[0]?.message?.content ?? '');
    return typeof answer === 'string' ? answer : answer.map((c) => c.text ?? '').join('\n');
  }
}
