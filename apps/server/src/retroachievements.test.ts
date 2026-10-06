import { afterEach, describe, expect, it } from 'vitest';
import { raGameTitle, raPlatformKey } from './retroachievements.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

describe("RetroAchievements' titles and consoles", () => {
  it('reads a title as a game title, and leaves out hacks, homebrew and subsets', () => {
    expect(raGameTitle('Legend of Zelda, The - A Link to the Past')).toBe('The Legend of Zelda: A Link to the Past');
    expect(raGameTitle('Castlevania: Symphony of the Night')).toBe('Castlevania: Symphony of the Night');
    expect(raGameTitle('Pokemon - Red Version | Pokemon Red')).toBe('Pokemon: Red Version');
    expect(raGameTitle('~Unlicensed~ Action 52')).toBe('Action 52');
    expect(raGameTitle('~Hack~ Super Metroid: Redesign')).toBeNull();
    expect(raGameTitle('~Homebrew~ Micro Mages')).toBeNull();
    expect(raGameTitle('Super Mario World [Subset - Bonus]')).toBeNull();
  });

  it("maps RetroAchievements' console names to Squirrelcade's consoles", () => {
    expect(raPlatformKey('SNES/Super Famicom')).toBe('super-nintendo');
    expect(raPlatformKey('Genesis/Mega Drive')).toBe('sega-genesis');
    expect(raPlatformKey('PlayStation Portable')).toBe('psp');
    expect(raPlatformKey('PlayStation')).toBe('playstation');
    expect(raPlatformKey('Master System')).toBe('sega-master-system');
    expect(raPlatformKey('Arcade')).toBeNull();
  });
});

/** A fake RetroAchievements answering the progress of "player" with the key "right-key". */
function fakeRa(results: Record<string, unknown>[]) {
  const calls: string[] = [];
  const fetch = async (url: string) => {
    const u = new URL(url);
    calls.push(`${u.pathname} u=${u.searchParams.get('u')} c=${u.searchParams.get('c')} o=${u.searchParams.get('o')}`);
    if (u.searchParams.get('y') !== 'right-key') return new Response(JSON.stringify({ message: 'Unauthenticated.' }), { status: 401 });
    const count = Number(u.searchParams.get('c'));
    const offset = Number(u.searchParams.get('o'));
    const page = results.slice(offset, offset + count);
    return Response.json({ Count: page.length, Total: results.length, Results: page });
  };
  return { fetch, calls };
}

const game = (id: number, title: string, consoleName: string, awarded: number, max: number, award: string | null) => ({
  GameID: id,
  Title: title,
  ImageIcon: '/Images/000001.png',
  ConsoleID: 3,
  ConsoleName: consoleName,
  MaxPossible: max,
  NumAwarded: awarded,
  NumAwardedHardcore: awarded,
  MostRecentAwardedDate: '2026-09-01T10:00:00+00:00',
  HighestAwardKind: award,
  HighestAwardDate: award ? '2026-09-01T10:00:00+00:00' : null,
});

describe('RetroAchievements', () => {
  it("reads your progress, matches it to your games, shows it in a game's drawer, and can mark What you played", async () => {
    const ra = fakeRa([
      game(1, 'Legend of Zelda, The - A Link to the Past', 'SNES/Super Famicom', 72, 72, 'mastered'),
      game(2, 'Super Metroid', 'SNES/Super Famicom', 40, 55, 'beaten-hardcore'),
      game(3, 'Castlevania: Symphony of the Night', 'PlayStation', 12, 69, null),
      game(4, '~Hack~ Super Metroid: Redesign', 'SNES/Super Famicom', 3, 30, null),
      game(5, 'Metal Slug', 'Arcade', 10, 20, null),
    ]);
    g = await testApp({ features: ['retroachievements'], raFetch: ra.fetch });
    cookies = await setUp(g);
    seedCatalogs(g, {
      owned: [
        ['1', 'The Legend of Zelda: A Link to the Past', 'Super Nintendo'],
        ['2', 'Super Metroid', 'Super Nintendo'],
      ],
      catalogs: { 'super-nintendo': ['The Legend of Zelda: A Link to the Past', 'Super Metroid'], playstation: ['Castlevania: Symphony of the Night'] },
    });
    // The Test button, with a key RetroAchievements doesn't take, then the right one.
    g.settings.update({ 'sources.raUsername': 'player', 'sources.raApiKey': 'wrong-key' });
    const refused = (await g.app.inject({ method: 'POST', url: '/api/v1/sources/retroachievements/test', cookies })).json();
    expect(refused).toMatchObject({ ok: false, message: expect.stringMatching(/didn't take the web API key/) });
    g.settings.update({ 'sources.raApiKey': 'right-key' });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/retroachievements/test', cookies })).json()).toEqual({ ok: true, message: 'RetroAchievements took the key: player has progress in 5 games.' });

    expect(await g.ra.sync()).toBe('5 games with progress (3 matched to your consoles, 2 beaten or mastered)');
    const drawer = async (platform: string, title: string) => (await g.app.inject({ url: `/api/v1/game?platform=${platform}&title=${encodeURIComponent(title)}`, cookies })).json();
    expect((await drawer('super-nintendo', 'The Legend of Zelda: A Link to the Past')).retroAchievements).toEqual({
      gameId: 1,
      title: 'Legend of Zelda, The - A Link to the Past',
      numAwarded: 72,
      numAwardedHardcore: 72,
      maxPossible: 72,
      award: 'mastered',
      awardedAt: '2026-09-01T10:00:00+00:00',
      lastPlayedAt: '2026-09-01T10:00:00+00:00',
      url: 'https://retroachievements.org/game/1',
    });
    expect((await drawer('playstation', 'Castlevania: Symphony of the Night')).retroAchievements).toMatchObject({ numAwarded: 12, award: null });
    expect((await g.app.inject({ url: '/api/v1/sources/retroachievements', cookies })).json()).toMatchObject({ games: 5, matched: 3, beaten: 1, mastered: 1 });

    // What you played: left alone by default; marked when chosen, never over a status of your own.
    expect((await drawer('super-nintendo', 'Super Metroid')).play).toBeNull();
    await g.app.inject({ method: 'PUT', url: '/api/v1/play', cookies, payload: { platformKey: 'super-nintendo', title: 'Super Metroid', status: 'playing' } });
    g.settings.update({ 'sources.raMarkPlayed': 'beaten' });
    expect(await g.ra.sync()).toMatch(/; 1 marked in What you played$/);
    expect((await drawer('super-nintendo', 'The Legend of Zelda: A Link to the Past')).play).toMatchObject({ status: 'completed' });
    expect((await drawer('super-nintendo', 'Super Metroid')).play).toMatchObject({ status: 'playing' });
  });

  it("puts a game on another region's console of its own when that's where the owner has it (the Super Famicom)", async () => {
    const ra = fakeRa([game(1, 'Seiken Densetsu 3', 'SNES/Super Famicom', 30, 60, null), game(2, 'Super Metroid', 'SNES/Super Famicom', 40, 55, 'beaten-hardcore')]);
    g = await testApp({ features: ['retroachievements'], raFetch: ra.fetch });
    cookies = await setUp(g);
    // The Super Nintendo is region-locked (the default), so a Super Famicom copy is a console of its own.
    seedCatalogs(g, {
      owned: [
        ['1', 'Seiken Densetsu 3', 'Super Famicom'],
        ['2', 'Super Metroid', 'Super Nintendo'],
      ],
      catalogs: { 'super-nintendo': ['Super Metroid'], 'super-famicom': ['Seiken Densetsu 3', 'Super Metroid'] },
    });
    g.settings.update({ 'sources.raUsername': 'player', 'sources.raApiKey': 'right-key' });
    expect(await g.ra.sync()).toBe('2 games with progress (2 matched to your consoles, 1 beaten or mastered)');
    const drawer = async (platform: string, title: string) => (await g.app.inject({ url: `/api/v1/game?platform=${platform}&title=${encodeURIComponent(title)}`, cookies })).json();
    // Seiken Densetsu 3 is owned on the Super Famicom only: there; Super Metroid on the Super Nintendo, though the
    // Super Famicom's catalog has it too.
    expect((await drawer('super-famicom', 'Seiken Densetsu 3')).retroAchievements).toMatchObject({ gameId: 1, numAwarded: 30 });
    expect((await drawer('super-nintendo', 'Super Metroid')).retroAchievements).toMatchObject({ gameId: 2, award: 'beaten-hardcore' });
    expect((await drawer('super-famicom', 'Super Metroid')).retroAchievements).toBeNull();
  });

  it('is off until turned on, and needs its username and key', async () => {
    g = await testApp({ raFetch: fakeRa([]).fetch });
    cookies = await setUp(g);
    expect((await g.app.inject({ url: '/api/v1/sources/retroachievements', cookies })).statusCode).toBe(404);
    expect(await g.ra.sync()).toMatch(/is off/);
    g.settings.update({ 'features.retroachievements': true });
    expect(await g.ra.sync()).toMatch(/needs your username and web API key/);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/retroachievements/test', cookies })).json()).toMatchObject({ ok: false });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/retroachievements/sync', cookies })).statusCode).toBe(202);
  });
});
