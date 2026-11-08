import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const image = async () => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } });

async function start(fetchCovers: (url: string) => Promise<Response> = image, titles = ['Flower', 'Puppeteer', 'Tearaway Unfolded']) {
  g = await testApp({ igdbFetch: (url) => fetchCovers(url) });
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [['1', 'Uncharted', 'Playstation 3']],
    catalogs: { 'playstation-3': ['Uncharted', ...titles] },
  });
  g.settings.update({ 'friends.myName': "Mark" });
}

function giveCover(title: string, coverId: string, igdbId: number) {
  const platformId = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, 'playstation-3')).get()!.id;
  g.db
    .insert(igdbGames)
    .values({ platformId, igdbId, data: JSON.stringify({ id: igdbId, name: title, altNames: [], coverId, genres: [], themes: [], perspectives: [], franchise: null, japanese: false, released: '2012-01-01', gameType: 'Main Game' }) })
    .run();
  g.igdb.forgetPlatforms();
}

describe('wishlist as a file', () => {
  it("returns one self-contained page of the wishlist: titled with the owner's name, dated, with covers embedded", async () => {
    await start();
    giveCover('Flower', 'co_flower', 9001);
    g.wishlist.invalidate();
    const res = await g.app.inject({ url: '/api/v1/wishlist/file', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="wishlist-\d{4}-\d{2}-\d{2}\.html"$/);
    const html = res.body;
    expect(html).toContain("<title>Mark's wishlist</title>");
    expect(html).toContain('Flower');
    expect(html).toContain('Puppeteer');
    expect(html).not.toContain('Uncharted');
    expect(html).toContain('PlayStation 3');
    expect(html).toContain('Made with Squirrelcade');
    expect(html).toContain('@media print');
    expect(html).toContain('prefers-color-scheme:dark');
    expect(html).toContain('Print / Save as PDF');
    // Flower's cover is inside the page; nothing reaches out to a server (the cover came by data: URI).
    expect(html).toContain('src="data:image/jpeg;base64,');
    expect(html).not.toMatch(/(src|href)="https?:/);
    expect(html).not.toMatch(/localhost|127\.0\.0\.1/);
  });

  it('shows no prices paid, notes or other private fields, and uses the wishlist settings', async () => {
    await start();
    g.settings.update({ 'wishlist.fileGames': 5, 'wishlist.fileCovers': false });
    const html = (await g.app.inject({ url: '/api/v1/wishlist/file', cookies })).body;
    expect(html).not.toMatch(/paid|note|price|value|\$\d/i);
    expect(html).not.toContain('data:image');
    expect(html).toContain('the top 3 games');
  });

  it('keeps the file to the number of games the setting gives', async () => {
    await start(image, Array.from({ length: 12 }, (_, i) => `Game ${String.fromCharCode(65 + i)}`));
    g.settings.update({ 'wishlist.fileGames': 5 });
    const html = (await g.app.inject({ url: '/api/v1/wishlist/file', cookies })).body;
    expect(html.match(/<tr>/g)).toHaveLength(5);
  });

  it('leaves a cover out, and still makes the file, when covers cannot be fetched', async () => {
    await start(async () => {
      throw new Error('offline');
    });
    giveCover('Flower', 'co_offline', 9001);
    g.wishlist.invalidate();
    const res = await g.app.inject({ url: '/api/v1/wishlist/file', cookies });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Flower');
    expect(res.body).not.toContain('data:image');
  });

  it("can be one console's list, and says so for a console that isn't there", async () => {
    await start();
    const one = await g.app.inject({ url: '/api/v1/wishlist/file?platform=playstation-3', cookies });
    expect(one.statusCode).toBe(200);
    expect(one.body).toContain("<title>Mark's wishlist: PlayStation 3</title>");
    expect(one.headers['content-disposition']).toContain('-playstation-3.html');
    expect((await g.app.inject({ url: '/api/v1/wishlist/file?platform=nope', cookies })).statusCode).toBe(404);
  });

  it('escapes a name and titles', async () => {
    await start(image, ['<b>Evil</b> & Co']);
    g.settings.update({ 'friends.myName': 'A<script>' });
    const html = (await g.app.inject({ url: '/api/v1/wishlist/file', cookies })).body;
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt; &amp; Co');
  });
});
