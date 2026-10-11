import { randomUUID } from 'node:crypto';
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
/** At most this many pieces in one request to Squirrelcade, and this large each (base64 characters). */
export const MAX_PIECES = 9;
export const MAX_PIECE_CHARS = 6_000_000;
/** Two pieces at a time: a home model works one at a time anyway, and a service's rate limit stays clear. */
const AT_ONCE = 2;
/** How long a job waits for a helper to take it, and then for its answer. */
const HELPER_TAKE_MS = 60_000;
const HELPER_ANSWER_MS = 10 * 60_000;
/** A finished job is kept this long for its asker to collect. */
const KEEP_MS = 15 * 60_000;
/** A helper that asked for work this recently is there. */
const HELPER_SEEN_MS = 90_000;

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
  private readonly jobs = new Map<string, VisionJob>();
  /** Helpers waiting for work, oldest first. */
  private readonly helpers: ((job: VisionJob | null) => void)[] = [];
  private helperSeenAt = 0;

  constructor(
    private readonly settings: SettingsService,
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
    return Date.now() - this.helperSeenAt < HELPER_SEEN_MS || this.helpers.length > 0;
  }

  /** Pieces left today (null: no limit). */
  left(): number | null {
    const limit = this.settings.get('sources.visionDailyLimit');
    if (limit === 0) return null;
    this.rollDay();
    return Math.max(0, limit - this.used);
  }

  private rollDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.used = 0;
    }
  }

  private sweep() {
    const now = Date.now();
    for (const [id, job] of this.jobs) {
      if (job.finishedAt !== null && now - job.finishedAt > KEEP_MS) this.jobs.delete(id);
      else if (job.state === 'waiting' && this.helperMode() && now - job.createdAt > HELPER_TAKE_MS) this.finish(job, null, 'No helper took the photo: is it running? (Settings > Sources > Vision model)');
      else if (job.state === 'reading' && now - job.createdAt > HELPER_ANSWER_MS) this.finish(job, null, "The helper didn't answer in time.");
    }
  }

  private finish(job: VisionJob, titles: string[] | null, error: string | null) {
    if (job.state === 'done' || job.state === 'failed') return;
    job.state = titles ? 'done' : 'failed';
    job.titles = titles ?? [];
    job.error = error;
    job.finishedAt = Date.now();
    // A helper is given the pieces once; they needn't be kept after.
    job.pieces = [];
  }

  /** Starts reading a photo's pieces (the ones past today's limit aren't sent); the job says when it's done. */
  start(pieces: string[], consoleName: string | null): VisionJob {
    this.sweep();
    if (!this.ready()) throw new VisionError('The vision model is off or not set up (Settings > Features).');
    if (this.helperMode() && !this.helperThere()) throw new VisionError("The helper isn't asking for work: is it running? (Settings > Sources > Vision model)");
    const left = this.left();
    const sending = left === null ? pieces : pieces.slice(0, left);
    if (sending.length === 0) throw new VisionError("Today's pieces for the vision model are used up (Settings > Sources > Vision model).");
    for (const p of sending) if (!DATA_URL.test(p)) throw new VisionError('A piece of the photo isn’t an image.');
    this.used += sending.length;
    const job: VisionJob = { id: randomUUID(), pieces: sending, consoleName, state: 'waiting', titles: [], error: null, sent: sending.length, createdAt: Date.now(), finishedAt: null };
    this.jobs.set(job.id, job);
    if (this.helperMode()) {
      const helper = this.helpers.shift();
      if (helper) {
        job.state = 'reading';
        helper(job);
      }
    } else {
      job.state = 'reading';
      void this.readWithService(job);
    }
    return job;
  }

  /** A job, while it's kept. */
  job(id: string): VisionJob | undefined {
    this.sweep();
    return this.jobs.get(id);
  }

  /** A job's end: its titles, or its error. */
  async wait(job: VisionJob, timeoutMs = HELPER_TAKE_MS + HELPER_ANSWER_MS): Promise<VisionJob> {
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

  /** A helper asking for work: the oldest waiting job, or null after waitMs with none. */
  next(waitMs: number): Promise<VisionJob | null> {
    this.sweep();
    this.helperSeenAt = Date.now();
    const waiting = [...this.jobs.values()].find((j) => j.state === 'waiting');
    if (waiting) {
      waiting.state = 'reading';
      return Promise.resolve(waiting);
    }
    return new Promise((resolve) => {
      const give = (job: VisionJob | null) => {
        clearTimeout(timer);
        this.helperSeenAt = Date.now();
        resolve(job);
      };
      const timer = setTimeout(() => {
        const i = this.helpers.indexOf(give);
        if (i >= 0) this.helpers.splice(i, 1);
        this.helperSeenAt = Date.now();
        resolve(null);
      }, waitMs);
      this.helpers.push(give);
    });
  }

  /** A helper's answer for a job: the text it read (one title a line, or a list), or what went wrong. */
  answer(id: string, answer: { titles?: unknown; text?: unknown; error?: unknown }): boolean {
    const job = this.jobs.get(id);
    if (!job || job.state !== 'reading') return false;
    if (typeof answer.error === 'string' && answer.error) this.finish(job, null, `The helper couldn't read it: ${answer.error.slice(0, 300)}`);
    else if (Array.isArray(answer.titles)) this.finish(job, titlesOf(answer.titles.filter((t): t is string => typeof t === 'string').join('\n')), null);
    else if (typeof answer.text === 'string') this.finish(job, titlesOf(answer.text), null);
    else return false;
    return true;
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
