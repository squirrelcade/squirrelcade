import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
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
    // Bad requests count against the hour too.
    g.settings.update({ 'security.publicCheck': 'everywhere', 'security.publicShelfLimit': 5 });
    expect((await shelf({ platformKey: 'nes', reads: [] })).statusCode).toBe(400);
    expect((await shelf({ platformKey: 'wii', reads: [{ text: 5, score: 1 }] })).statusCode).toBe(400);
    expect((await shelf({ platformKey: 'wii', reads: [], pieces: ['https://example.com/x.jpg'] })).statusCode).toBe(400);
    // A visitor sends at most 300 lines, and no photo pieces when the model isn't theirs to use.
    expect((await shelf({ platformKey: 'wii', reads: Array.from({ length: 301 }, () => ({ text: 'OKAMI', score: 0.9 })) })).statusCode).toBe(400);
    expect((await shelf({ platformKey: 'wii', reads: [], pieces: [`data:image/jpeg;base64,${'A'.repeat(300_000)}`] })).statusCode).toBe(413);
    expect((await shelf({ platformKey: 'wii', reads: [] })).statusCode).toBe(200);
    expect((await shelf({ platformKey: 'wii', reads: [] })).statusCode).toBe(429);
    // Signed in (or with the owner's key, as a start page passing checks on has it): no limit.
    expect((await shelf({ platformKey: 'wii', reads: [] }, true)).statusCode).toBe(200);
    g.settings.update({ 'security.publicShelf': 'off' });
    expect((await g.app.inject({ url: '/api/v1/check/consoles' })).statusCode).toBe(404);
    // The owner's own start page still checks shelves for friends with the key, the sign-in page's check off or on.
    g.settings.update({ 'security.publicCheck': 'off' });
    const key = (await g.app.inject({ url: '/api/v1/auth/apikey', cookies })).json().apiKey as string;
    expect((await g.app.inject({ url: '/api/v1/check/consoles', headers: { 'x-api-key': key } })).statusCode).toBe(200);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/check/shelf', headers: { 'x-api-key': key }, payload: { platformKey: 'wii', reads: [{ text: 'OKAMI', score: 0.9 }] } })).json().games[0].title).toBe('Okami');
  });

  it("sends a visitor's pieces to the vision model only when the owner allows it", async () => {
    g.settings.update({ 'security.publicCheck': 'everywhere', 'features.vision': true, 'sources.visionUrl': 'https://api.example.com/v1', 'sources.visionModel': 'reader-1', 'sources.visionKey': 'k' });
    await shelf({ platformKey: 'playstation-3', reads: [], pieces: [PIECE] });
    expect(asked).toHaveLength(0);
    g.settings.update({ 'security.publicShelf': 'model' });
    expect((await g.app.inject({ url: '/api/v1/check/consoles' })).json().model).toBe(true);
    const first = (await shelf({ platformKey: 'playstation-3', reads: [{ text: 'DARKSIDERS', score: 0.9 }], pieces: [PIECE] })).json();
    // The phone's reading answers at once (Darksiders unsure: it could be II, cut off); the model's comes after.
    expect(first.games).toEqual([]);
    expect(first.model).toMatchObject({ state: 'reading', sent: 1 });
    let res = first;
    for (let i = 0; i < 50 && res.model.state === 'reading'; i++) res = (await g.app.inject({ url: `/api/v1/check/shelf/${first.model.id}` })).json();
    // A model reads whole spines: its Darksiders is Darksiders, not the cut-off start of Darksiders II.
    expect(res.games).toEqual([{ title: 'Darksiders', answer: 'own', ownedOn: [], wishlist: null, read: 'Darksiders' }]);
    expect(res.model).toMatchObject({ state: 'done', sent: 1, titles: 2 });
    expect((await g.app.inject({ url: '/api/v1/check/shelf/00000000-0000-0000-0000-000000000000' })).statusCode).toBe(404);
    expect(asked[0]!.url).toBe('https://api.example.com/v1/chat/completions');
    expect(asked[0]!.headers.authorization).toBe('Bearer k');
    expect(asked[0]!.body.model).toBe('reader-1');
  });
});

describe("a visitor's games an hour", () => {
  it('stops made-up shelves from reading the collection', async () => {
    g.settings.update({ 'security.publicCheck': 'everywhere', 'security.publicShelfGames': 20 });
    // One read of each game in the catalog, as a list of titles would be: the games answered count.
    const reads = ['OKAMI', 'XENOBLADE CHRONICLES'].map((text) => ({ text, score: 0.9 }));
    for (let i = 0; i < 10; i++) expect((await shelf({ platformKey: 'wii', reads })).statusCode).toBe(200);
    expect((await shelf({ platformKey: 'wii', reads })).json().message).toMatch(/a lot of games/);
    // Signed in: no such limit.
    expect((await shelf({ platformKey: 'wii', reads }, true)).statusCode).toBe(200);
  });

  it('turns a visitor over the limit away before their photo goes to the model', async () => {
    g.settings.update({ 'security.publicCheck': 'everywhere', 'security.publicShelf': 'model', 'security.publicShelfGames': 20, 'features.vision': true, 'sources.visionUrl': 'https://api.example.com/v1', 'sources.visionModel': 'm' });
    const reads = ['OKAMI', 'XENOBLADE CHRONICLES'].map((text) => ({ text, score: 0.9 }));
    for (let i = 0; i < 10; i++) await shelf({ platformKey: 'wii', reads });
    asked = [];
    expect((await shelf({ platformKey: 'wii', reads, pieces: [PIECE] })).statusCode).toBe(429);
    expect(asked).toHaveLength(0);
  });

  it('counts a visitor by address, and an IPv6 home by its /64', async () => {
    const { visitorOf } = await import('./shelfCheck.js');
    expect(visitorOf('203.0.113.9')).toBe('203.0.113.9');
    expect(visitorOf('::ffff:203.0.113.9')).toBe('203.0.113.9');
    expect(visitorOf('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2');
    // Written short or long, one /64 is one visitor.
    expect(visitorOf('2001:db8::1:2:3:4')).toBe('2001:db8:0:0');
    expect(visitorOf('2001:0db8:0000:0000:0005::9')).toBe('2001:db8:0:0');
    expect(visitorOf('::1')).toBe('0:0:0:0');
  });
});

describe('the vision model, signed in', () => {
  /** Starts a job and asks for it until it's done, as the phone does. */
  const read = async (payload: unknown) => {
    const started = await g.app.inject({ method: 'POST', url: '/api/v1/shelf/read', cookies, payload: payload as object });
    if (started.statusCode !== 200) return started;
    let job = started;
    for (let i = 0; i < 50 && ['waiting', 'reading'].includes(job.json().state); i++) {
      await new Promise((r) => setTimeout(r, 20));
      job = await g.app.inject({ url: `/api/v1/shelf/read/${started.json().id}`, cookies });
    }
    return job;
  };

  it('reads pieces through OpenAI-style or Anthropic APIs, within the daily limit', async () => {
    expect((await g.app.inject({ url: '/api/v1/shelf/model', cookies })).json()).toEqual({ available: false, left: 100, pieces: 4, helper: null });
    expect((await read({ pieces: [PIECE] })).statusCode).toBe(502);
    g.settings.update({ 'features.vision': true, 'sources.visionApi': 'anthropic', 'sources.visionUrl': 'https://api.anthropic.com/v1/', 'sources.visionModel': 'claude-x', 'sources.visionKey': 'sk', 'sources.visionDailyLimit': 3 });
    expect((await read({ pieces: [PIECE, PIECE], console: 'Wii' })).json()).toMatchObject({ state: 'done', titles: ['Darksiders', 'Okami', 'Darksiders', 'Okami'], sent: 2, left: 1 });
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
    const res = await refusing.app.inject({ method: 'POST', url: '/api/v1/shelf/test', cookies: c });
    expect(res.json()).toEqual({ ok: false, message: 'The vision model refused (404): model not found' });
    await refusing.cleanup();
  });

  it("hands photos to a helper of the owner's own, which answers with what it read", async () => {
    g.settings.update({ 'features.vision': true, 'sources.visionApi': 'helper' });
    // No helper asking for work: said at once.
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/shelf/read', cookies, payload: { pieces: [PIECE] } })).json().message).toMatch(/helper isn't asking/);
    const key = (await g.app.inject({ url: '/api/v1/auth/apikey', cookies })).json().apiKey as string;
    // A helper asks (and waits); a photo comes; the helper gets it, with the prompt.
    const asking = g.app.inject({ url: '/api/v1/helper/next?wait=2000', headers: { 'x-api-key': key } });
    await new Promise((r) => setTimeout(r, 50));
    const started = (await g.app.inject({ method: 'POST', url: '/api/v1/shelf/read', cookies, payload: { pieces: [PIECE], console: 'Wii' } })).json();
    expect(started.state).toBe('reading');
    const work = (await asking).json();
    expect(work).toMatchObject({ kind: 'shelf', console: 'Wii', pieces: [PIECE] });
    expect(work.prompt).toContain('mostly Wii games');
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/helper/answer', headers: { 'x-api-key': key }, payload: { id: work.id, titles: ['Okami', '1. Halo 3'] } })).json()).toEqual({ ok: true });
    expect((await g.app.inject({ url: `/api/v1/shelf/read/${started.id}`, cookies })).json()).toMatchObject({ state: 'done', titles: ['Okami', 'Halo 3'] });
    // Nothing waiting: the helper's ask ends empty; a second answer to the same photo is refused; viewers can't help.
    expect((await g.app.inject({ url: '/api/v1/helper/next?wait=10', headers: { 'x-api-key': key } })).statusCode).toBe(204);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/helper/answer', headers: { 'x-api-key': key }, payload: { id: work.id, titles: [] } })).statusCode).toBe(404);
    expect((await g.app.inject({ url: '/api/v1/helper/next?wait=10' })).statusCode).toBe(401);
  });
});

describe("a shelf's fixes and the console's full list", () => {
  it('remembers a read fixed to a game, or to no game, in the offline copy', async () => {
    const put = (payload: object) => g.app.inject({ method: 'PUT', url: '/api/v1/shelf/fixes', cookies, payload });
    expect((await put({ platform: 'wii', read: 'XENO  BLADE', title: 'Xenoblade Chronicles' })).json()).toEqual({ ok: true });
    expect((await put({ platform: 'wii', read: 'WII SPORTS', title: null })).json()).toEqual({ ok: true });
    expect((await put({ platform: 'wii', read: 'abc', title: 'Okami' })).statusCode).toBe(400);
    expect((await put({ platform: 'no-such-console', read: 'OKAMI', title: 'Okami' })).statusCode).toBe(400);
    const copy = (await g.app.inject({ url: '/api/v1/lookup/offline', cookies })).json();
    const wii = copy.platforms.findIndex((p: { key: string }) => p.key === 'wii');
    expect(copy.fixes).toEqual([
      [wii, 'xenoblade', 'Xenoblade Chronicles'],
      [wii, 'wiisports', null],
    ]);
    // Fixed again: replaced; forgotten: gone.
    await put({ platform: 'wii', read: 'xenoblade', title: 'Okami' });
    expect((await g.app.inject({ method: 'DELETE', url: '/api/v1/shelf/fixes?platform=wii&read=WII%20SPORTS', cookies })).json()).toEqual({ removed: true });
    expect((await g.app.inject({ url: '/api/v1/lookup/offline', cookies })).json().fixes).toEqual([[wii, 'xenoblade', 'Okami']]);
  });

  it("lists IGDB's games for the console that the checklist and your copies don't have", async () => {
    const wii = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, 'wii')).get()!.id;
    const game = (id: number, name: string, gameType: string | null = 'Main Game') => ({ platformId: wii, igdbId: id, data: JSON.stringify({ id, name, altNames: [], coverId: null, genres: [], themes: [], perspectives: [], franchise: null, japanese: null, released: null, gameType }) });
    g.db.insert(igdbGames).values([game(1, 'Okami'), game(2, 'Super Mario Galaxy'), game(3, 'Xenoblade Chronicles: Extra Pack', 'DLC'), game(4, 'Wii Sports')]).run();
    expect((await g.app.inject({ url: '/api/v1/shelf/titles/wii', cookies })).json()).toEqual({ titles: ['Super Mario Galaxy', 'Wii Sports'] });
    g.settings.update({ 'interface.shelfFullList': false });
    expect((await g.app.inject({ url: '/api/v1/shelf/titles/wii', cookies })).json()).toEqual({ titles: [] });
    expect((await g.app.inject({ url: '/api/v1/shelf/titles/no-such-console', cookies })).statusCode).toBe(404);
  });
});

describe('titlesOf', () => {
  it("keeps the titles from a model's answer", () => {
    expect(titlesOf('Here are the titles I can read:\n1. **Halo 3**\n- "Okami"\n\n• Darksiders II\nTitles:')).toEqual(['Halo 3', 'Okami', 'Darksiders II']);
  });
});
