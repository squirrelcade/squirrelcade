import { describe, expect, it } from 'vitest';
import { HelperError, HelperQueue } from './helper.js';

describe('the helper queue', () => {
  it('hands work to a waiting helper and gives its answer back', async () => {
    const q = new HelperQueue();
    const asking = q.next(1000);
    const answer = q.ask('shelf', { pieces: ['x'] });
    const work = (await asking)!;
    expect(work).toMatchObject({ kind: 'shelf', pieces: ['x'] });
    expect(q.answer(work.id, { titles: ['Okami'] })).toBe(true);
    expect(await answer).toEqual({ titles: ['Okami'] });
    // Answered once only.
    expect(q.answer(work.id, { titles: [] })).toBe(false);
  });

  it('says at once when no helper is there', async () => {
    await expect(new HelperQueue().ask('talk', {})).rejects.toThrow(HelperError);
  });

  it("gives no work to a helper that hung up, and puts work it never got back in the queue", async () => {
    const q = new HelperQueue();
    const gone = new AbortController();
    const dropped = q.next(5000, gone.signal);
    gone.abort();
    expect(await dropped).toBeNull();
    // Seen a moment ago, so work is taken; the next helper to ask gets it.
    const answer = q.ask('shelf', { pieces: ['y'] });
    const work = (await q.next(1000))!;
    expect(work.pieces).toEqual(['y']);
    // Its connection was found closed before it got the work: back in the queue for the next one.
    q.release(work.id);
    const again = (await q.next(1000))!;
    expect(again.id).toBe(work.id);
    q.answer(again.id, { error: 'no luck' });
    await expect(answer).rejects.toThrow("The helper couldn't do it: no luck");
  });
});
