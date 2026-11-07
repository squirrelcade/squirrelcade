import { baseTitle, matchKey } from '@squirrelcade/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
import { multipartFile, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

describe('which consoles each game is yours on, for its marks (D175)', () => {
  it('joins a game across consoles by its title, editions and all, and changes with the collection', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    seedCatalogs(g, {
      owned: [
        ['1', 'Okami', 'PlayStation 2'],
        ['2', 'Okami [Greatest Hits]', 'PlayStation 3'],
        ['3', 'Journey', 'PlayStation 3'],
      ],
      catalogs: { 'playstation-2': ['Okami'], 'playstation-3': ['Okami', 'Journey'] },
    });
    const marks = async () => (await g.app.inject({ url: '/api/v1/marks', cookies })).json().owned as Record<string, string[]>;
    const first = await marks();
    expect(first.okami?.sort()).toEqual(['playstation-2', 'playstation-3']);
    expect(first.journey).toEqual(['playstation-3']);
    const sotc = matchKey(baseTitle('Shadow of the Colossus'));
    expect(first[sotc]).toBeUndefined();
    // A copy added: the next read has it.
    await g.app.inject({ method: 'POST', url: '/api/v1/collection/copies', cookies, payload: { platformKey: 'playstation-2', title: 'Shadow of the Colossus', completeness: 'complete' } });
    expect((await marks())[sotc]).toEqual(['playstation-2']);
  });
});

describe('the PC mark for a PC game named with its edition (2026-11-07: Grand Theft Auto IV: The Complete Edition)', () => {
  it('lights the console game of the same name without edition words, unless the two came out decades apart', async () => {
    g = await testApp({ features: ['pc'] });
    const cookies = await setUp(g);
    seedCatalogs(g, {
      owned: [
        ['1', 'Grand Theft Auto IV', 'PlayStation 3'],
        ['2', 'SimCity', 'Super Famicom'],
      ],
      catalogs: { 'playstation-3': ['Grand Theft Auto IV'], 'super-famicom': ['SimCity'] },
    });
    // IGDB knows when the Super Famicom's SimCity came out (1991).
    const sfc = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, 'super-famicom')).get()!.id;
    g.db.insert(igdbGames).values({ platformId: sfc, igdbId: 1, data: JSON.stringify({ id: 1, name: 'SimCity', altNames: [], coverId: null, genres: [], themes: [], perspectives: [], franchise: null, japanese: true, released: '1991-04-26', gameType: 'Main Game' }) }).run();
    g.settings.update({ 'features.igdb': true });
    const record = (key: string, store: string, name: string, releaseYear: number) => ({ recordKey: key, playniteId: key, storefrontGameId: key, sourceName: store, name, releaseYear, platforms: [], genres: [], series: [], favorite: false, hidden: false, installed: false, playtimeSeconds: 0, playCount: 0, links: [] });
    const snapshot = JSON.stringify({
      schemaVersion: 'vgcm-playnite-library-v1',
      generatedAtUtc: '2026-11-07T12:00:00Z',
      source: { fileName: 'PlayniteBackup.zip', fingerprint: 'e' },
      statistics: { gameRecords: 2 },
      records: [record('steam|12210', 'Steam', 'Grand Theft Auto IV: The Complete Edition', 2008), record('steam|24780', 'Steam', 'SimCity Digital Deluxe Edition', 2013)],
    });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/pc/snapshot', cookies, ...multipartFile('s.json', Buffer.from(snapshot), 'application/json') })).statusCode).toBeLessThan(300);
    const owned = (await g.app.inject({ url: '/api/v1/marks', cookies })).json().owned as Record<string, string[]>;
    // The Complete Edition (2008, as Steam dates it) is Grand Theft Auto IV: its PC mark lights.
    expect(owned[matchKey(baseTitle('Grand Theft Auto IV'))]?.sort()).toEqual(['pc', 'playstation-3']);
    // SimCity of 2013 isn't the Super Famicom's of 1991: no PC mark there (its own full name still has one).
    expect(owned[matchKey(baseTitle('SimCity'))]).toEqual(['super-famicom']);
    expect(owned[matchKey(baseTitle('SimCity Digital Deluxe Edition'))]).toEqual(['pc']);
  });
});
