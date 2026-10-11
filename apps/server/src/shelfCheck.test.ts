import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FetchLike } from './igdb.js';
import { seedCatalogs, setUp, testApp } from './test-helpers.js';
import { titlesOf } from './vision.js';

let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
let asked: { url: string; headers: Record<string, string>; body: { model: string; messages: { content: unknown[] }[] } }[];
let answer: string;

const visionFetch: FetchLike = async (url, init) => {
  asked.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
  const anthropic = url.endsWith('/messages');
  return new Response(JSON.stringify(anthropic ? { content: [{ type: 'text', text: answer }] } : { choices: [{ message: { content: answer } }] }), { status: 200 });
};
const PIECE = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

beforeEach(async () => {
  asked = [];
  answer = '1. Darksiders\n- Okami\nHere are the titles:';
  g = await testApp({ visionFetch });
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [
      ['1', 'Okami', 'Wii'],
      ['2', 'Darksiders', 'PlayStation 3'],
    ],
    catalogs: { wii: ['Okami', 'Xenoblade Chronicles'], 'playstation-3': ['Darksiders', 'Darksiders II'] },
  });
});
afterEach(async () => g.cleanup());

const shelf = (payload: unknown, withCookies = false) => g.app.inject({ method: 'POST', url: '/api/v1/check/shelf', payload: payload as object, ...(withCookies ? { cookies } : {}) });

describe('checking a shelf without signing in', () => {
  it('is off with the one-game check, and answers only for the games read', async () => {
    expect((await g.app.inject({ url: '/api/v1/check/consoles' })).statusCode).toBe(404);
    expect((await shelf({ platformKey: 'wii', reads: [] })).statusCode).toBe(404);
    g.settings.update({ 'security.publicCheck': 'everywhere' });
    const consoles = (await g.app.inject({ url: '/api/v1/check/consoles' })).json();
    expect(consoles.consoles.map((c: { key: string }) => c.key)).toEqual(['playstation-3', 'wii']);
    expect(consoles.model).toBe(false);
    const res = (
      await shelf({
        platformKey: 'wii',
        reads: [
          { text: 'XENOBLADE CHRONICLES', score: 0.9 },
          { text: 'OKAMI', score: 0.95 },
          { text: 'noise', score: 0.2 },
        ],
      })
    ).json();
    expect(res.games).toEqual([
      { title: 'Xenoblade Chronicles', answer: 'need', ownedOn: [], wishlist: { priority: 'High', rank: 2 }, read: 'XENOBLADE CHRONICLES' },
      { title: 'Okami', answer: 'own', ownedOn: [], wishlist: null, read: 'OKAMI' },
    ]);
    expect(res.reads).toBe(2);
    // On the PS3, a spine read as DARKSIDERS could be Darksiders II with its number cut off: unsure, never "you have it".
    const ps3 = (await shelf({ platformKey: 'playstation-3', reads: [{ text: 'DARKSIDERS', score: 0.9 }] })).json();
    expect(ps3.games).toEqual([]);
    expect(ps3.unsure).toEqual([{ title: 'Darksiders', read: 'DARKSIDERS', doubt: 'cut-off', other: 'Darksiders II' }]);
  });

  it('turns away bad requests, and too many from one address', async () => {
    g.settings.update({ 'security.publicCheck': 'everywhere', 'security.publicShelfLimit': 2 });
    expect((await shelf({ platformKey: 'nes', reads: [] })).statusCode).toBe(400);
    expect((await shelf({ platformKey: 'wii', reads: [{ text: 5, score: 1 }] })).statusCode).toBe(400);
    expect((await shelf({ platformKey: 'wii', reads: [], pieces: ['https://example.com/x.jpg'] })).statusCode).toBe(400);
    expect((await shelf({ platformKey: 'wii', reads: [] })).statusCode).toBe(200);
    expect((await shelf({ platformKey: 'wii', reads: [] })).statusCode).toBe(200);
    expect((await shelf({ platformKey: 'wii', reads: [] })).statusCode).toBe(429);
    // Signed in (or with the owner's key, as a start page passing checks on has it): no limit.
    expect((await shelf({ platformKey: 'wii', reads: [] }, true)).statusCode).toBe(200);
    g.settings.update({ 'security.publicShelf': 'off' });
    expect((await g.app.inject({ url: '/api/v1/check/consoles' })).statusCode).toBe(404);
  });

  it("sends a visitor's pieces to the vision model only when the owner allows it", async () => {
    g.settings.update({ 'security.publicCheck': 'everywhere', 'features.vision': true, 'sources.visionUrl': 'https://api.example.com/v1', 'sources.visionModel': 'reader-1', 'sources.visionKey': 'k' });
    await shelf({ platformKey: 'playstation-3', reads: [], pieces: [PIECE] });
    expect(asked).toHaveLength(0);
    g.settings.update({ 'security.publicShelf': 'model' });
    expect((await g.app.inject({ url: '/api/v1/check/consoles' })).json().model).toBe(true);
    const res = (await shelf({ platformKey: 'playstation-3', reads: [], pieces: [PIECE] })).json();
    // A model reads whole spines: its Darksiders is Darksiders, not the cut-off start of Darksiders II.
    expect(res.games).toEqual([{ title: 'Darksiders', answer: 'own', ownedOn: [], wishlist: null, read: 'Darksiders' }]);
    expect(res.model).toEqual({ sent: 1, titles: 2 });
    expect(asked[0]!.url).toBe('https://api.example.com/v1/chat/completions');
    expect(asked[0]!.headers.authorization).toBe('Bearer k');
    expect(asked[0]!.body.model).toBe('reader-1');
  });
});

describe('the vision model, signed in', () => {
  const read = (payload: unknown) => g.app.inject({ method: 'POST', url: '/api/v1/shelf/read', cookies, payload: payload as object });

  it('reads pieces through OpenAI-style or Anthropic APIs, within the daily limit', async () => {
    expect((await g.app.inject({ url: '/api/v1/shelf/model', cookies })).json()).toEqual({ available: false, left: 100, pieces: 4 });
    expect((await read({ pieces: [PIECE] })).statusCode).toBe(502);
    g.settings.update({ 'features.vision': true, 'sources.visionApi': 'anthropic', 'sources.visionUrl': 'https://api.anthropic.com/v1/', 'sources.visionModel': 'claude-x', 'sources.visionKey': 'sk', 'sources.visionDailyLimit': 3 });
    expect((await read({ pieces: [PIECE, PIECE], console: 'Wii' })).json()).toEqual({ titles: ['Darksiders', 'Okami', 'Darksiders', 'Okami'], sent: 2, left: 1 });
    expect(asked[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(asked[0]!.headers['x-api-key']).toBe('sk');
    expect(asked[0]!.body.messages[0]!.content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg' } });
    expect(JSON.stringify(asked[0]!.body)).toContain('mostly Wii games');
    // Only what's left today goes; then none.
    expect((await read({ pieces: [PIECE, PIECE] })).json()).toMatchObject({ sent: 1, left: 0 });
    expect((await read({ pieces: [PIECE] })).json().message).toMatch(/used up/);
    expect((await read({ pieces: [] })).statusCode).toBe(400);
  });

  it('says what the service said when it refuses', async () => {
    const refusing = await testApp({ visionFetch: async () => new Response(JSON.stringify({ error: { message: 'model not found' } }), { status: 404 }) });
    const c = await setUp(refusing);
    refusing.settings.update({ 'features.vision': true, 'sources.visionUrl': 'http://localhost:11434/v1', 'sources.visionModel': 'qwen2.5vl' });
    const res = await refusing.app.inject({ method: 'POST', url: '/api/v1/shelf/read', cookies: c, payload: { pieces: [PIECE] } });
    expect(res.statusCode).toBe(502);
    expect(res.json().message).toBe('The vision model refused (404): model not found');
    await refusing.cleanup();
  });
});

describe('titlesOf', () => {
  it("keeps the titles from a model's answer", () => {
    expect(titlesOf('Here are the titles I can read:\n1. **Halo 3**\n- "Okami"\n\n• Darksiders II\nTitles:')).toEqual(['Halo 3', 'Okami', 'Darksiders II']);
  });
});
