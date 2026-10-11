import { normalizeTitle } from '@squirrelcade/core';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { roleOf } from './access.js';
import { aiViewOf, AiToolError, type AiTools } from './aiTools.js';
import { HelperError, type HelperQueue } from './helper.js';
import type { LookupService } from './lookup.js';
import type { NotesService } from './notes.js';
import type { SettingsService } from './settings.js';
import type { VisionClient } from './vision.js';

/**
 * Talk to Squirrelcade (D148): a back-and-forth about the collection in plain words ("do I have Pac-Man?", "I just
 * bought Halo 3", "note on Okami: the case is cracked"), with the AI model set up for Check a shelf (Settings >
 * Features): any service, a model at home, or the owner's helper (Claude Code on their own plan). The model looks
 * things up with the connector's read-only tools (check_ownership, search_games, get_wishlist, get_game,
 * list_platforms), a few rounds at most, and answers with what to say and, when asked for a change, actions.
 * Squirrelcade only proposes them: the page does a small one at once with Undo (I bought it, a note) and asks first
 * for a major one (excluding a game from a checklist, or bringing it back), on the owner's page only. Each turn is a
 * job the page asks about until it's done, like a shelf photo's.
 */

const MAX_TURNS = 12;
const MAX_TEXT = 2000;
const MAX_ROUNDS = 3;
const MAX_LOOKUPS = 5;
/** A lookup's answer is cut to this many characters for the model. */
const MAX_RESULT = 6000;
const KEEP_MS = 15 * 60_000;

export interface TalkTurn {
  role: 'you' | 'squirrelcade';
  text: string;
}

/** A change the model proposes, checked against the collection. */
export interface TalkAction {
  kind: 'bought' | 'note' | 'exclude' | 'target' | 'open';
  platformKey: string;
  platform: string;
  title: string;
  entryId: number | null;
  /** A note's new text. */
  text?: string;
  /** The note before, for Undo. */
  before?: string | null;
  /** Asked before it's done (excluding or bringing back a game); a small one is done at once, with Undo. */
  major: boolean;
}

export interface TalkJob {
  id: string;
  state: 'reading' | 'done' | 'failed';
  reply: string;
  actions: TalkAction[];
  error: string | null;
  lookups: string[];
  createdAt: number;
  finishedAt: number | null;
}

const TOOLS = `check_ownership {"titles": ["..."], "platforms": ["..."]?}: whether each title is in the collection (owned, possible, not_owned), on which consoles, and its wishlist places if not owned.
search_games {"query": "..."?, "platform": "..."?, "condition": "sealed"|"complete"|"loose"|"graded"?, "limit": 20?}: games in the collection by words of the title, or by console or condition.
get_wishlist {"query": "..."?, "platform": "..."?, "priority": "High"|"Medium"|"Low"?, "limit": 25?}: the wishlist (games not owned yet), best first, with acorns (0 to 100: how much they want it).
get_game {"id": "..."}: one game's copies (condition, value), PC storefronts, reviews; the id comes from search_games or check_ownership.
list_platforms {}: each console with its games, copies and value, and the totals.`;

/** The answer the model gives, as JSON. */
const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    lookups: { type: 'array', items: { type: 'object', properties: { tool: { type: 'string' }, input: { type: 'object' } }, required: ['tool'] } },
    actions: {
      type: 'array',
      items: { type: 'object', properties: { kind: { type: 'string' }, platform: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' } }, required: ['kind', 'platform', 'title'] },
    },
  },
  required: ['reply'],
};

function promptOf(turns: TalkTurn[], results: string[], owner: boolean, last: boolean, today: string): string {
  return [
    `You are Squirrelcade, the app ${owner ? 'the owner keeps their video game collection in' : "keeps the owner's video game collection; you're talking with someone they share it with"}. Today is ${today}.`,
    'Answer in a few friendly sentences, plainly, in the words a person would use. Never guess about the collection: look it up first. Say when something is unsure.',
    last
      ? 'Answer now with reply: no more lookups.'
      : `To look things up, give lookups (at most ${MAX_LOOKUPS}) and no reply yet; Squirrelcade runs them and asks you again with their results. When you know enough, give reply.`,
    `The lookups:\n${TOOLS}`,
    owner
      ? 'When the owner asks for a change, give actions too, only for games you looked up, with platform and title exactly as a lookup gave them: bought (they bought it: a copy is added), note (their note on the game becomes text), exclude (a game they don\'t want to collect leaves its console\'s checklist), target (an excluded game goes back on it), open (shows the game). Say in reply what will happen; Squirrelcade asks before excluding or bringing back.'
      : 'You can only answer questions: no changes.',
    'Answer with only a JSON object: {"reply": "...", "lookups": [{"tool": "...", "input": {...}}], "actions": [{"kind": "...", "platform": "...", "title": "...", "text": "..."}]} (leave out what you don\'t use).',
    '',
    'The conversation:',
    ...turns.map((t) => `${t.role === 'you' ? 'Them' : 'Squirrelcade'}: ${t.text}`),
    ...(results.length ? ['', 'Results of your lookups so far:', ...results] : []),
  ].join('\n');
}

/** The JSON object in a model's answer (alone, or in a code block, or among words). */
export function answerOf(text: string): { reply?: unknown; lookups?: unknown; actions?: unknown } | null {
  const tries = [text.trim(), text.replace(/^[\s\S]*?```(?:json)?\s*|\s*```[\s\S]*$/g, '').trim()];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) tries.push(text.slice(start, end + 1));
  for (const t of tries) {
    try {
      const v = JSON.parse(t) as unknown;
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as { reply?: unknown };
    } catch {
      // The next way.
    }
  }
  return null;
}

export class TalkService {
  private readonly jobs = new Map<string, TalkJob>();

  constructor(
    private readonly d: { settings: SettingsService; vision: VisionClient; helpers: HelperQueue; tools: AiTools; lookup: LookupService; notes: NotesService },
  ) {}

  ready(): boolean {
    return this.d.settings.get('features.talk') === true && this.d.vision.ready();
  }

  job(id: string): TalkJob | undefined {
    const now = Date.now();
    for (const [k, j] of this.jobs) if (j.finishedAt !== null && now - j.finishedAt > KEEP_MS) this.jobs.delete(k);
    return this.jobs.get(id);
  }

  start(turns: TalkTurn[], owner: boolean, viewOwner: Parameters<typeof aiViewOf>[0]): TalkJob {
    const job: TalkJob = { id: randomUUID(), state: 'reading', reply: '', actions: [], error: null, lookups: [], createdAt: Date.now(), finishedAt: null };
    this.jobs.set(job.id, job);
    void this.run(job, turns, owner, viewOwner);
    return job;
  }

  private async ask(prompt: string): Promise<{ reply?: unknown; lookups?: unknown; actions?: unknown }> {
    if (this.d.settings.get('sources.visionApi') === 'helper') {
      const a = await this.d.helpers.ask('talk', { prompt, schema: SCHEMA });
      if (a.answer && typeof a.answer === 'object') return a.answer as { reply?: unknown };
      const parsed = typeof a.text === 'string' ? answerOf(a.text) : null;
      if (!parsed) throw new HelperError("The helper's answer wasn't JSON.");
      return parsed;
    }
    const text = await this.d.vision.chat(prompt, this.d.settings.get('sources.talkModel') || null);
    const parsed = answerOf(text);
    if (!parsed) return { reply: text.trim() };
    return parsed;
  }

  private async run(job: TalkJob, turns: TalkTurn[], owner: boolean, person: Parameters<typeof aiViewOf>[0]) {
    const view = aiViewOf(person, this.d.settings);
    const results: string[] = [];
    const today = new Date().toISOString().slice(0, 10);
    try {
      for (let round = 1; round <= MAX_ROUNDS; round++) {
        const answer = await this.ask(promptOf(turns, results, owner, round === MAX_ROUNDS, today));
        // Entries that aren't objects (a sloppy answer) are passed over, not fatal.
        const lookups = Array.isArray(answer.lookups) ? answer.lookups.filter(isObject).slice(0, MAX_LOOKUPS) : [];
        const reply = typeof answer.reply === 'string' ? answer.reply.trim() : '';
        // Lookups first, even with a reply beside them ("Let me check!"): the answer comes once they're done.
        if (lookups.length > 0 && round < MAX_ROUNDS) {
          for (const l of lookups) {
            const tool = typeof l.tool === 'string' ? l.tool : '';
            const input = l.input && typeof l.input === 'object' ? (l.input as Record<string, unknown>) : {};
            job.lookups.push(tool);
            results.push(`${tool} ${JSON.stringify(input).slice(0, 300)} → ${this.lookup(tool, input, view).slice(0, MAX_RESULT)}`);
          }
          continue;
        }
        job.reply = reply || "Sorry, I couldn't put an answer together. Try asking another way.";
        job.actions = owner ? this.actions(answer.actions, results.join('\n')) : [];
        job.state = 'done';
        break;
      }
      if (job.state !== 'done') throw new Error('No answer after its lookups.');
    } catch (err) {
      job.state = 'failed';
      job.error = String((err as Error)?.message ?? err).slice(0, 300);
    }
    job.finishedAt = Date.now();
  }

  /** One lookup, with the connector's read-only tools, as JSON text (or what went wrong). */
  private lookup(tool: string, input: Record<string, unknown>, view: ReturnType<typeof aiViewOf>): string {
    const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 200) : undefined);
    const num = (v: unknown, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(max, Math.round(v))) : undefined);
    const list = (v: unknown, max: number) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 200)).slice(0, max) : []);
    try {
      switch (tool) {
        case 'check_ownership': {
          const titles = list(input.titles, 20);
          if (titles.length === 0) return 'Give titles.';
          const platforms = list(input.platforms, 5);
          return JSON.stringify(this.d.tools.check({ titles, ...(platforms.length ? { platforms } : {}) }, view));
        }
        case 'search_games': {
          const condition = ['sealed', 'complete', 'loose', 'graded'].includes(input.condition as string) ? (input.condition as 'sealed') : undefined;
          return JSON.stringify(this.d.tools.search({ query: str(input.query), platform: str(input.platform), condition, limit: num(input.limit, 30) ?? 20 }, view));
        }
        case 'get_wishlist': {
          const priority = ['High', 'Medium', 'Low'].includes(input.priority as string) ? (input.priority as string) : undefined;
          return JSON.stringify(this.d.tools.wishlist({ query: str(input.query), platform: str(input.platform), priority, limit: num(input.limit, 40) ?? 25 }));
        }
        case 'get_game':
          return JSON.stringify(this.d.tools.game({ id: str(input.id) ?? '' }, view));
        case 'list_platforms':
          return JSON.stringify(this.d.tools.platforms(view));
        default:
          return `There's no lookup called ${tool}.`;
      }
    } catch (err) {
      return err instanceof AiToolError ? err.message : 'That lookup failed.';
    }
  }

  /**
   * The model's actions, each checked: a known kind, a game Squirrelcade knows on that console. Only a game named
   * exactly, and found by this turn's lookups, is changed without asking; anything else waits for a tap.
   */
  private actions(value: unknown, lookedUp: string): TalkAction[] {
    if (!Array.isArray(value)) return [];
    const { copy } = this.d.lookup.offlineCopy(false);
    // What the lookups said, as plain words (JSON's escapes, quotes and brackets gone) for finding a title in it.
    const seen = normalizeTitle(lookedUp.replace(/\\u[0-9a-f]{4}/gi, ' '));
    const out: TalkAction[] = [];
    for (const a of value.filter(isObject).slice(0, 5) as { kind?: unknown; platform?: unknown; title?: unknown; text?: unknown }[]) {
      const kind = a.kind as TalkAction['kind'];
      if (!['bought', 'note', 'exclude', 'target', 'open'].includes(kind) || typeof a.platform !== 'string' || typeof a.title !== 'string') continue;
      const p = normalizeTitle(a.platform);
      const platform = copy.platforms.find((x) => normalizeTitle(x.key) === p || normalizeTitle(x.name) === p);
      if (!platform) continue;
      const found = this.d.lookup.search(a.title, { platformKey: platform.key, limit: 5 });
      const exact = found.find((r) => normalizeTitle(r.title) === normalizeTitle(a.title as string));
      const game = exact ?? found[0];
      if (!game) continue;
      const sure = exact !== undefined && seen.includes(normalizeTitle(game.title));
      const entryId = game.entryId ?? null;
      if ((kind === 'bought' || kind === 'exclude' || kind === 'target') && entryId === null) continue;
      const action: TalkAction = { kind, platformKey: game.platformKey, platform: game.platform, title: game.title, entryId, major: kind === 'exclude' || kind === 'target' || (kind !== 'open' && !sure) };
      if (kind === 'note') {
        if (typeof a.text !== 'string' || !a.text.trim()) continue;
        action.text = a.text.trim().slice(0, 2000);
        action.before = this.d.notes.of(game.platformKey, [game.title])?.text ?? null;
      }
      out.push(action);
    }
    return out;
  }
}

/** A JSON object (not null, not a list). */
const isObject = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/** At most this many turns of Talk an hour per person (each can be a few model calls). */
const TURNS_AN_HOUR = 60;

function turnsOf(value: unknown): TalkTurn[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 40) return null;
  const turns: TalkTurn[] = [];
  for (const t of value as { role?: unknown; text?: unknown }[]) {
    if (!t || (t.role !== 'you' && t.role !== 'squirrelcade') || typeof t.text !== 'string' || !t.text.trim()) return null;
    turns.push({ role: t.role, text: t.text.trim().slice(0, MAX_TEXT) });
  }
  if (turns[turns.length - 1]!.role !== 'you') return null;
  return turns.slice(-MAX_TURNS);
}

export function registerTalkRoutes(app: FastifyInstance, talk: TalkService): void {
  const recent = new Map<string, number[]>();
  app.get('/api/v1/talk/status', async () => ({ available: talk.ready() }));
  app.post('/api/v1/talk', async (request, reply) => {
    if (!talk.ready()) return reply.code(409).send({ error: 'off', message: 'Talk is off, or its AI model isn’t set up (Settings > Features).' });
    const who = request.auth?.kind === 'session' ? `u${request.auth.userId}` : request.auth?.kind ?? request.ip;
    const now = Date.now();
    const times = (recent.get(who) ?? []).filter((t) => now - t < 60 * 60_000);
    if (times.length >= TURNS_AN_HOUR) return reply.code(429).send({ error: 'too-many', message: 'That was a lot of talking for one hour. Try again a bit later.' });
    recent.set(who, [...times, now]);
    const turns = turnsOf((request.body as { turns?: unknown } | null)?.turns);
    if (!turns) return reply.code(400).send({ error: 'invalid', message: 'Send the conversation, ending with what you said.' });
    const role = roleOf(request);
    const person = request.auth?.kind === 'session' ? { kind: 'account' as const, userId: request.auth.userId, username: request.auth.username, role: role ?? 'viewer' } : { kind: 'account' as const, userId: 0, username: 'owner', role: role ?? 'viewer' };
    return talk.start(turns, role === 'owner', person);
  });
  app.get('/api/v1/talk/:id', async (request, reply) => {
    const job = talk.job((request.params as { id: string }).id);
    if (!job) return reply.code(404).send({ error: 'not-found', message: 'That answer is no longer kept.' });
    return job;
  });
}
