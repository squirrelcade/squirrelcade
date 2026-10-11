import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { roleOf } from './access.js';

/**
 * Work for a helper of the owner's own (D147): a program that asks Squirrelcade for work with the owner's key
 * (GET /api/v1/helper/next, waiting up to 25 seconds) and answers (POST /api/v1/helper/answer). On the owner's server
 * it's Claude Code signed in with their own plan, say (tools/shelf-helper). Two kinds of work: a shelf photo's pieces
 * to read ("shelf"), and a turn of Talk to answer ("talk", D148). A job waits a minute to be taken and ten minutes for
 * its answer.
 */

/** How long work waits for a helper to take it, and then for its answer. */
const TAKE_MS = 60_000;
const ANSWER_MS = 10 * 60_000;
/** A helper that asked for work this recently is there. */
const SEEN_MS = 90_000;

export class HelperError extends Error {}

/** What a helper answers: what it read (titles, or text), an answer object (talk), or what went wrong. */
export interface HelperAnswer {
  titles?: unknown;
  text?: unknown;
  answer?: unknown;
  error?: unknown;
}

interface Work {
  id: string;
  kind: 'shelf' | 'talk';
  payload: Record<string, unknown>;
  createdAt: number;
  takenAt: number | null;
  done: (answer: HelperAnswer | null, error: string | null) => void;
}

export class HelperQueue {
  private readonly work: Work[] = [];
  private readonly waiting: ((work: Work | null) => void)[] = [];
  private seenAt = 0;

  /** Whether a helper asked for work lately. */
  there(): boolean {
    return Date.now() - this.seenAt < SEEN_MS || this.waiting.length > 0;
  }

  private sweep() {
    const now = Date.now();
    for (const w of [...this.work]) {
      if (w.takenAt === null && now - w.createdAt > TAKE_MS) this.end(w, null, 'No helper took it: is the helper running?');
      else if (w.takenAt !== null && now - w.takenAt > ANSWER_MS) this.end(w, null, "The helper didn't answer in time.");
    }
  }

  private end(w: Work, answer: HelperAnswer | null, error: string | null) {
    const i = this.work.indexOf(w);
    if (i >= 0) this.work.splice(i, 1);
    w.done(answer, error);
  }

  /** Hands work to a helper and waits for its answer (a HelperError when none comes). */
  ask(kind: Work['kind'], payload: Record<string, unknown>): Promise<HelperAnswer> {
    this.sweep();
    if (!this.there()) return Promise.reject(new HelperError("The helper isn't asking for work: is it running?"));
    return new Promise((resolve, reject) => {
      const w: Work = {
        id: randomUUID(),
        kind,
        payload,
        createdAt: Date.now(),
        takenAt: null,
        done: (answer, error) => {
          clearInterval(check);
          if (answer) resolve(answer);
          else reject(new HelperError(error ?? "The helper didn't answer."));
        },
      };
      const check = setInterval(() => this.sweep(), 5_000);
      check.unref?.();
      this.work.push(w);
      const helper = this.waiting.shift();
      if (helper) helper(w);
    });
  }

  /** A helper asking for work: the oldest waiting, or null after waitMs with none. */
  next(waitMs: number): Promise<{ id: string; kind: string } & Record<string, unknown> | null> {
    this.sweep();
    this.seenAt = Date.now();
    const give = (w: Work | null) => {
      this.seenAt = Date.now();
      if (!w) return null;
      w.takenAt = Date.now();
      return { ...w.payload, id: w.id, kind: w.kind };
    };
    const free = this.work.find((w) => w.takenAt === null);
    if (free) return Promise.resolve(give(free));
    return new Promise((resolve) => {
      const hand = (w: Work | null) => {
        clearTimeout(timer);
        resolve(give(w));
      };
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(hand);
        if (i >= 0) this.waiting.splice(i, 1);
        resolve(give(null));
      }, waitMs);
      this.waiting.push(hand);
    });
  }

  /** A helper's answer to taken work; false when no such work is waiting for one. */
  answer(id: string, answer: HelperAnswer): boolean {
    const w = this.work.find((x) => x.id === id && x.takenAt !== null);
    if (!w) return false;
    if (typeof answer.error === 'string' && answer.error) this.end(w, null, `The helper couldn't do it: ${answer.error.slice(0, 300)}`);
    else this.end(w, answer, null);
    return true;
  }
}

/** How long a helper's request for work waits for one, at most (under proxies' time limits). */
const WAIT_MS = 25_000;

/** The helper's two routes, for the owner's key or sign-in only. */
export function registerHelperRoutes(app: FastifyInstance, helpers: HelperQueue): void {
  const ownerOnly = (request: FastifyRequest, reply: FastifyReply) => {
    if (roleOf(request) !== 'owner') {
      void reply.code(403).send({ error: 'owner-only', message: 'Only the owner’s key can be a helper.' });
      return false;
    }
    return true;
  };
  app.get('/api/v1/helper/next', async (request, reply) => {
    if (!ownerOnly(request, reply)) return reply;
    const asked = Number((request.query as { wait?: string }).wait ?? WAIT_MS);
    const work = await helpers.next(Number.isFinite(asked) ? Math.min(WAIT_MS, Math.max(0, asked)) : WAIT_MS);
    if (!work) return reply.code(204).send();
    return work;
  });
  app.post('/api/v1/helper/answer', { bodyLimit: 1_000_000 }, async (request, reply) => {
    if (!ownerOnly(request, reply)) return reply;
    const body = (request.body ?? {}) as HelperAnswer & { id?: unknown };
    if (typeof body.id !== 'string' || !helpers.answer(body.id, body)) return reply.code(404).send({ error: 'not-found', message: 'Nothing is waiting for that answer.' });
    return { ok: true };
  });
}
