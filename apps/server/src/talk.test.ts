import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from './igdb.js';
import { answerOf } from './talk.js';
import { seedCatalogs, setUp, testApp } from './test-helpers.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
let prompts: string[];
let answers: string[];

/** A model that answers with the next of answers, keeping each prompt it was given. */
const visionFetch: FetchLike = async (_url, init) => {
  prompts.push(JSON.parse(String(init.body)).messages[0].content as string);
  return new Response(JSON.stringify({ choices: [{ message: { content: answers.shift() ?? '{"reply": "Done."}' } }] }), { status: 200 });
};

beforeEach(async () => {
  prompts = [];
  answers = [];
  g = await testApp({ visionFetch });
  cookies = await setUp(g);
  seedCatalogs(g, { owned: [['1', 'Okami', 'Wii']], catalogs: { wii: ['Okami', 'Xenoblade Chronicles', 'Pac-Man Party'] } });
  g.settings.update({ 'features.vision': true, 'features.talk': true, 'sources.visionUrl': 'https://api.example.com/v1', 'sources.visionModel': 'm', 'sources.talkModel': 'talker' });
});
afterEach(async () => g.cleanup());

/** Says something and asks for the answer until it's there, as the page does. */
async function talk(turns: { role: string; text: string }[], c = cookies) {
  const started = await g.app.inject({ method: 'POST', url: '/api/v1/talk', cookies: c, payload: { turns } });
  if (started.statusCode !== 200) return started.json();
  let job = started.json();
  for (let i = 0; i < 100 && job.state === 'reading'; i++) {
    await new Promise((r) => setTimeout(r, 10));
    job = (await g.app.inject({ url: `/api/v1/talk/${job.id}`, cookies: c })).json();
  }
  return job;
}

describe('Talk to Squirrelcade', () => {
  it('looks things up with the read-only tools, then answers', async () => {
    answers = ['{"lookups": [{"tool": "check_ownership", "input": {"titles": ["Okami"]}}]}', '```json\n{"reply": "Yes: Okami, on the Wii."}\n```'];
    const job = await talk([{ role: 'you', text: 'Do I have Okami?' }]);
    expect(job).toMatchObject({ state: 'done', reply: 'Yes: Okami, on the Wii.', actions: [], lookups: ['check_ownership'] });
    // The second round had the lookup's results; Talk's own model was asked.
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain('Results of your lookups so far');
    expect(prompts[1]).toContain('"status":"owned"');
  });

  it("proposes the owner's changes, checked against the collection: small ones done by the page, big ones asked", async () => {
    answers = [
      JSON.stringify({
        reply: 'Marked bought, and noted.',
        actions: [
          { kind: 'bought', platform: 'Wii', title: 'Xenoblade Chronicles' },
          { kind: 'note', platform: 'wii', title: 'Okami', text: 'Case cracked' },
          { kind: 'exclude', platform: 'Wii', title: 'Pac-Man Party' },
          { kind: 'bought', platform: 'Wii', title: 'Not A Real Game Anywhere' },
          { kind: 'launch', platform: 'Wii', title: 'Okami' },
        ],
      }),
    ];
    const job = await talk([{ role: 'you', text: 'I bought Xenoblade; note on Okami: case cracked; and drop Pac-Man Party' }]);
    expect(job.actions).toEqual([
      expect.objectContaining({ kind: 'bought', platformKey: 'wii', title: 'Xenoblade Chronicles', major: false, entryId: expect.any(Number) }),
      expect.objectContaining({ kind: 'note', title: 'Okami', text: 'Case cracked', before: null, major: false }),
      expect.objectContaining({ kind: 'exclude', title: 'Pac-Man Party', major: true }),
    ]);
  });

  it('answers in words when the model gives no JSON, and is off until turned on', async () => {
    answers = ['Just words, no JSON.'];
    expect((await talk([{ role: 'you', text: 'hi' }])).reply).toBe('Just words, no JSON.');
    expect((await talk([{ role: 'squirrelcade', text: 'hi' }])).error).toBe('invalid');
    g.settings.update({ 'features.talk': false });
    expect((await g.app.inject({ url: '/api/v1/talk/status', cookies })).json()).toEqual({ available: false });
    expect((await talk([{ role: 'you', text: 'hi' }])).error).toBe('off');
  });

  it('says when the model fails', async () => {
    const failing = await testApp({ visionFetch: async () => new Response('{"error": {"message": "bad key"}}', { status: 401 }) });
    const c = await setUp(failing);
    failing.settings.update({ 'features.vision': true, 'features.talk': true, 'sources.visionUrl': 'https://api.example.com/v1', 'sources.visionModel': 'm' });
    const started = (await failing.app.inject({ method: 'POST', url: '/api/v1/talk', cookies: c, payload: { turns: [{ role: 'you', text: 'hi' }] } })).json();
    let job = started;
    for (let i = 0; i < 100 && job.state === 'reading'; i++) {
      await new Promise((r) => setTimeout(r, 10));
      job = (await failing.app.inject({ url: `/api/v1/talk/${started.id}`, cookies: c })).json();
    }
    expect(job).toMatchObject({ state: 'failed', error: 'The AI model refused (401): bad key' });
    await failing.cleanup();
  });

  it("goes through the owner's helper, which answers with JSON", async () => {
    g.settings.update({ 'sources.visionApi': 'helper' });
    const key = (await g.app.inject({ url: '/api/v1/auth/apikey', cookies })).json().apiKey as string;
    const asking = g.app.inject({ url: '/api/v1/helper/next?wait=2000', headers: { 'x-api-key': key } });
    await new Promise((r) => setTimeout(r, 30));
    const started = (await g.app.inject({ method: 'POST', url: '/api/v1/talk', cookies, payload: { turns: [{ role: 'you', text: 'Do I have Okami?' }] } })).json();
    const work = (await asking).json();
    expect(work.kind).toBe('talk');
    expect(work.prompt).toContain('Do I have Okami?');
    expect(work.schema.required).toEqual(['reply']);
    await g.app.inject({ method: 'POST', url: '/api/v1/helper/answer', headers: { 'x-api-key': key }, payload: { id: work.id, answer: { reply: 'Yes, on the Wii.' } } });
    await new Promise((r) => setTimeout(r, 20));
    expect((await g.app.inject({ url: `/api/v1/talk/${started.id}`, cookies })).json()).toMatchObject({ state: 'done', reply: 'Yes, on the Wii.' });
  });
});

describe('answerOf', () => {
  it('finds the JSON in an answer', () => {
    expect(answerOf('{"reply": "a"}')).toEqual({ reply: 'a' });
    expect(answerOf('Sure!\n```json\n{"reply": "b"}\n```')).toEqual({ reply: 'b' });
    expect(answerOf('Here: {"reply": "c"} hope that helps')).toEqual({ reply: 'c' });
    expect(answerOf('no json')).toBeNull();
  });
});
