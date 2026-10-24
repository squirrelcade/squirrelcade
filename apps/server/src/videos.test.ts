import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
import type { FetchLike } from './igdb.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

/** Stand-in for YouTube: oEmbed, the Data API (with the key "test-key"), the channel's page; every call recorded. */
function fakeYouTube() {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const u = new URL(url);
    if (u.pathname === '/oembed') return Response.json({ title: 'Super Metroid TV commercial (1994)', author_name: 'Old Ads' });
    if (u.hostname === 'www.googleapis.com') {
      if (u.searchParams.get('key') !== 'test-key') return Response.json({ error: { message: 'API key not valid.' } }, { status: 400 });
      if (u.pathname.endsWith('/channels')) return Response.json({ items: [{ id: 'UCKy1dAqELo0zrOtPkf0eTMw' }] });
      if (u.pathname.endsWith('/videos')) return Response.json({ items: [] });
      if (u.pathname.endsWith('/playlistItems')) {
        expect(u.searchParams.get('playlistId')).toBe('UUKy1dAqELo0zrOtPkf0eTMw');
        const item = (videoId: string, title: string, publishedAt: string) => ({ snippet: { title, publishedAt, resourceId: { videoId } } });
        return Response.json({ items: [item('REVIEW00001', 'Super Metroid Review - IGN', '1994-05-01T00:00:00Z'), item('LATER000001', 'Super Metroid Retrospective', '2014-03-19T00:00:00Z'), item('NOTAGAME001', 'Top 10 cats of 2014', '2014-01-01T00:00:00Z')] });
      }
    }
    return new Response('not found', { status: 404 });
  };
  return { calls, fetch };
}

/** Stand-in for Twitch and IGDB: Super Metroid's trailer. */
const igdbFetch: FetchLike = async (url) => {
  if (url.startsWith('https://id.twitch.tv/oauth2/token')) return Response.json({ access_token: 'token', expires_in: 5_000_000, token_type: 'bearer' });
  if (url === 'https://api.igdb.com/v4/game_videos') return Response.json([{ name: 'Trailer', video_id: 'TRAILER0001' }]);
  return new Response('[]', { status: 200 });
};

describe("Roots' videos (D168)", () => {
  it("shows a game's pasted videos, IGDB's trailers and the channels' videos about it, in its time or looking back", async () => {
    const yt = fakeYouTube();
    g = await testApp({ youtubeFetch: yt.fetch, igdbFetch });
    const cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Super Metroid', 'Super Nintendo']], catalogs: { 'super-nintendo': ['Super Metroid', 'Super Mario Kart'] } });
    const snes = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, 'super-nintendo')).get()!.id;
    g.db.insert(igdbGames).values({ platformId: snes, igdbId: 1103, data: JSON.stringify({ id: 1103, name: 'Super Metroid', altNames: [], coverId: null, genres: [], themes: [], perspectives: [], franchise: 'Metroid', japanese: true, released: '1994-03-19', gameType: 'Main Game' }) }).run();
    g.settings.update({ 'sources.igdbClientId': 'id', 'sources.igdbClientSecret': 'secret' });
    const page = async () => (await g.app.inject({ url: '/api/v1/game/videos?platform=super-nintendo&title=Super%20Metroid', cookies })).json();

    // Off until turned on (Settings > Roots), and nothing is asked of YouTube.
    expect(await page()).toMatchObject({ status: 'off' });
    g.settings.update({ 'roots.videos': true });

    // A pasted video, named by YouTube's oEmbed, put in its time by the owner; IGDB's trailer is of its time too.
    const pasted = await g.app.inject({ method: 'POST', url: '/api/v1/game/videos', cookies, payload: { platform: 'super-nintendo', title: 'Super Metroid', url: 'https://youtu.be/PASTED00001', era: 'time' } });
    expect(pasted.json()).toMatchObject({ videoId: 'PASTED00001', title: 'Super Metroid TV commercial (1994)', channel: 'Old Ads', source: 'pasted' });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/game/videos', cookies, payload: { platform: 'super-nintendo', title: 'Super Metroid', url: 'https://vimeo.com/1' } })).statusCode).toBe(400);
    let v = await page();
    expect(v.time.map((x: { videoId: string }) => x.videoId).sort()).toEqual(['PASTED00001', 'TRAILER0001']);
    expect(v.later).toEqual([]);

    // The channels: without a key their feeds are tried (none here); with one, the whole list, and only the videos about a game kept.
    g.settings.update({ 'roots.videoChannels': ['IGN | @IGN | on', 'GameSpot | @GameSpot | off'] });
    g.settings.update({ 'sources.youtubeKey': 'test-key' });
    const said = await g.videos.readChannels();
    expect(said).toBe('IGN: 3 videos read (the whole channel), 2 about your games');
    v = await page();
    expect(v.time.map((x: { videoId: string }) => x.videoId)).toContain('REVIEW00001');
    expect(v.later.map((x: { videoId: string; kind: string }) => [x.videoId, x.kind])).toEqual([['LATER000001', 'review']]);
    expect(v.keyed).toBe(true);
    // The key went only to YouTube's API, never to its other addresses.
    expect(yt.calls.filter((c) => c.includes('test-key')).every((c) => c.startsWith('https://www.googleapis.com/youtube/v3/'))).toBe(true);

    // Taken off.
    expect((await g.app.inject({ method: 'DELETE', url: '/api/v1/game/videos?platform=super-nintendo&title=Super%20Metroid&video=PASTED00001', cookies })).json()).toEqual({ removed: true });
    expect((await page()).time.map((x: { videoId: string }) => x.videoId)).not.toContain('PASTED00001');
  });
});
