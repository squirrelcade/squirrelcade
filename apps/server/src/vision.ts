import type { FetchLike } from './igdb.js';
import type { SettingsService } from './settings.js';

/**
 * Check a shelf's optional vision model (D147): pieces of a shelf photo sent to a model the owner chose, which
 * returns the titles it reads. Any service that takes OpenAI's chat format with images (OpenAI, Google Gemini,
 * OpenRouter, Ollama and LM Studio at home, and most others) or Anthropic's Messages API (Claude). The model only
 * reads: the titles go through the same matcher as the phone's own reading, so it never decides what you own.
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

function prompt(consoleName: string | null): string {
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

export class VisionClient {
  /** Pieces sent today (the server's day), for the daily limit; starts again after a restart. */
  private day = '';
  private used = 0;

  constructor(
    private readonly settings: SettingsService,
    private readonly fetcher: FetchLike = (url, init) => fetch(url, init),
  ) {}

  /** Whether the model is on and set up (an address and a model; a key only if the service needs one). */
  ready(): boolean {
    return this.settings.get('features.vision') === true && this.settings.get('sources.visionUrl') !== '' && this.settings.get('sources.visionModel') !== '';
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

  /** The titles the model reads on each piece (the pieces past today's limit aren't sent), all together. */
  async read(pieces: string[], consoleName: string | null): Promise<{ titles: string[]; sent: number }> {
    if (!this.ready()) throw new VisionError('The vision model is off or not set up (Settings > Features).');
    const left = this.left();
    const sending = left === null ? pieces : pieces.slice(0, left);
    if (sending.length === 0) throw new VisionError("Today's pieces for the vision model are used up (Settings > Sources > Vision model).");
    this.used += sending.length;
    const titles: string[] = [];
    let failure: unknown = null;
    for (let i = 0; i < sending.length; i += AT_ONCE) {
      const answers = await Promise.allSettled(sending.slice(i, i + AT_ONCE).map((p) => this.ask(p, consoleName)));
      for (const a of answers) {
        if (a.status === 'fulfilled') titles.push(...titlesOf(a.value));
        else failure ??= a.reason;
      }
    }
    // Some pieces read is an answer; none read is the service's error.
    if (titles.length === 0 && failure) throw failure instanceof VisionError ? failure : new VisionError(`The vision model didn't answer: ${String((failure as Error)?.message ?? failure)}`);
    return { titles, sent: sending.length };
  }

  /** Asks the model about one piece; returns its answer's text. */
  private async ask(piece: string, consoleName: string | null): Promise<string> {
    const m = DATA_URL.exec(piece);
    if (!m) throw new VisionError('A piece of the photo isn’t an image.');
    const base = this.settings.get('sources.visionUrl').replace(/\/+$/, '');
    const model = this.settings.get('sources.visionModel');
    const key = this.settings.get('sources.visionKey');
    const anthropic = this.settings.get('sources.visionApi') === 'anthropic';
    const text = prompt(consoleName);
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
