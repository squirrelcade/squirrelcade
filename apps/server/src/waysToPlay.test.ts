import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { igdbGames, platforms } from './db/schema.js';
import { seedCatalogs, setUp, testApp } from './test-helpers.js';

// A way to play a game the owner has (1.5.1, the owner: Mega Man 2 is in a Mega Man collection he has; the NES and SNES
// Final Fantasies are in the Pixel Remasters).
let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;

const game = (id: number, name: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, name, altNames: [], coverId: null, genres: [], themes: [], perspectives: [], franchise: null, japanese: null, released: '1990-01-01', gameType: 'Main Game', ...extra });

beforeEach(async () => {
  g = await testApp({ features: ['igdb'] });
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [
      ['1', 'Mega Man Legacy Collection 1 + 2', 'Nintendo Switch'],
      ['2', 'Final Fantasy I-VI Collection Pixel Remaster', 'Nintendo Switch'],
      ['3', 'Final Fantasy VII Remake', 'Playstation 4'],
      ['4', 'Super Mario Bros.', 'NES'],
    ],
    catalogs: {
      'nintendo-entertainment-system': ['Mega Man 2', 'Final Fantasy', 'DuckTales', 'Super Mario Bros.'],
      'super-nintendo': ['Final Fantasy VI'],
      playstation: ['Final Fantasy VII'],
    },
  });
  const id = (key: string) => g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, key)).get()!.id;
  const rows: [string, number, string, Record<string, unknown>?][] = [
    ['nintendo-entertainment-system', 1715, 'Mega Man 2', { bundles: [19874] }],
    ['nintendo-entertainment-system', 385, 'Final Fantasy', { remasters: [158980] }],
    ['nintendo-entertainment-system', 999, 'DuckTales'],
    ['super-nintendo', 386, 'Final Fantasy VI', { remasters: [158985] }],
    ['playstation', 427, 'Final Fantasy VII', { remakes: [11169] }],
    ['nintendo-switch', 19874, 'Mega Man Legacy Collection', { gameType: 'Bundle', bundles: [87782] }],
    ['nintendo-switch', 87782, 'Mega Man Legacy Collection 1 + 2', { gameType: 'Bundle' }],
    ['nintendo-switch', 158980, 'Final Fantasy', { gameType: 'Remaster', bundles: [159253] }],
    ['nintendo-switch', 158985, 'Final Fantasy VI', { gameType: 'Remaster', bundles: [159253] }],
    ['nintendo-switch', 159253, 'Final Fantasy: Pixel Remaster Collection', { gameType: 'Bundle', altNames: ['Final Fantasy I-VI Bundle'] }],
    ['playstation-4', 11169, 'Final Fantasy VII Remake', { gameType: 'Remake' }],
  ];
  g.db
    .insert(igdbGames)
    .values(rows.map(([key, igdbId, name, extra]) => ({ platformId: id(key), igdbId, data: game(igdbId, name, extra) })))
    .run();
  g.igdb.forgetPlatforms();
  // The PC library (owned for good on Steam).
  g.wishlist.setPcOwnership((title) => (title === 'Mega Man Legacy Collection' ? ['Steam'] : []));
  g.wishlist.invalidate();
});
afterEach(async () => {
  await g.cleanup();
});

const candidate = (platformKey: string, title: string) => [...g.wishlist.compute().all.values()].find((c) => c.platformKey === platformKey && c.title === title);

describe('a way to play it you have (1.5.1)', () => {
  it('finds Mega Man 2 in the collections you have, on Switch and on PC, and takes the acorns', async () => {
    expect(g.wishlist.waysToPlay('nintendo-entertainment-system', 'Mega Man 2')).toEqual([
      { kind: 'collection', title: 'Mega Man Legacy Collection', on: ['PC (Steam)'] },
      { kind: 'collection', title: 'Mega Man Legacy Collection 1 + 2', on: ['Nintendo Switch'] },
    ]);
    const mm2 = candidate('nintendo-entertainment-system', 'Mega Man 2')!;
    expect(mm2.components).toContainEqual({ label: 'You can play it in Mega Man Legacy Collection (PC (Steam)) and in Mega Man Legacy Collection 1 + 2 (Nintendo Switch)', points: -20 });
    // The game's page says so.
    const page = (await g.app.inject({ url: '/api/v1/game?platform=nintendo-entertainment-system&title=Mega%20Man%202', cookies })).json();
    expect(page.playable).toHaveLength(2);
    // A game in nothing you have: no line, no penalty.
    expect(g.wishlist.waysToPlay('nintendo-entertainment-system', 'DuckTales')).toEqual([]);
    expect(candidate('nintendo-entertainment-system', 'DuckTales')!.components.some((c) => c.label.startsWith('You can play it'))).toBe(false);
  });

  it('finds the NES and SNES Final Fantasies in the Pixel Remaster collection you have, by its name on the box', () => {
    expect(g.wishlist.waysToPlay('nintendo-entertainment-system', 'Final Fantasy')).toEqual([{ kind: 'remaster', title: 'Final Fantasy in Final Fantasy: Pixel Remaster Collection', on: ['Nintendo Switch'] }]);
    expect(g.wishlist.waysToPlay('super-nintendo', 'Final Fantasy VI')).toEqual([{ kind: 'remaster', title: 'Final Fantasy VI in Final Fantasy: Pixel Remaster Collection', on: ['Nintendo Switch'] }]);
    expect(candidate('super-nintendo', 'Final Fantasy VI')!.components.find((c) => c.label.startsWith('You can play it'))?.points).toBe(-20);
  });

  it("doesn't count a remake until Settings say so, and can leave such games off the wishlist", () => {
    expect(g.wishlist.waysToPlay('playstation', 'Final Fantasy VII')).toEqual([]);
    g.settings.update({ 'wishlist.playableRemakes': true });
    expect(g.wishlist.waysToPlay('playstation', 'Final Fantasy VII')).toEqual([{ kind: 'remake', title: 'Final Fantasy VII Remake', on: ['PlayStation 4'] }]);
    g.settings.update({ 'wishlist.playableAction': 'off-list', 'wishlist.playableRemakes': false });
    g.wishlist.invalidate();
    expect(candidate('nintendo-entertainment-system', 'Mega Man 2')).toBeUndefined();
    expect(g.wishlist.compute().offList.get('nintendo-entertainment-system|mega man 2')).toMatch(/^You can play it in Mega Man Legacy Collection/);
    expect(candidate('nintendo-entertainment-system', 'DuckTales')).toBeDefined();
  });
});
