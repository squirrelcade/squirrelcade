import { afterEach, describe, expect, it } from 'vitest';
import type { PsnApi, PsnTrophyTitle, XboxGet } from './achievements.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

/** A fake OpenXBL: the key "right-key" is taken; answers wrapped as api.xbl.io wraps them. */
function fakeXbox(titles: Record<string, unknown>[]) {
  const calls: string[] = [];
  const get: XboxGet = async (path, key) => {
    calls.push(path);
    if (key !== 'right-key') return { status: 401, body: '{"error":"Unauthorized"}' };
    if (path === '/v2/account') return { status: 200, body: JSON.stringify({ content: { profileUsers: [{ id: '2533', settings: [{ id: 'Gamertag', value: 'Player One' }] }] }, code: 200 }) };
    if (path === '/v2/achievements') return { status: 200, body: JSON.stringify({ content: { xuid: '2533', titles }, code: 200 }) };
    return { status: 404, body: '{}' };
  };
  return { get, calls };
}

const xboxTitle = (titleId: string, name: string, devices: string[], a: Record<string, number>, type = 'Game') => ({
  titleId,
  name,
  type,
  devices,
  achievement: a,
  titleHistory: { lastTimePlayed: '2026-08-01T10:00:00Z', visible: true, canHide: false },
});

/** A fake PlayStation: the sign-in token "good-token" signs in; trophy lists in pages of two. */
function fakePsn(titles: PsnTrophyTitle[]) {
  const calls: string[] = [];
  const api: PsnApi = {
    signIn: async (npsso) => {
      calls.push(`sign-in ${npsso}`);
      if (npsso !== 'good-token' && npsso !== 'newer-token') throw new Error('There was a problem retrieving your PSN access code.');
      return { accessToken: 'access-1', refreshToken: 'refresh-1', refreshTokenExpiresIn: 60 * 24 * 3600 };
    },
    refresh: async (refreshToken) => {
      calls.push(`refresh ${refreshToken}`);
      return { accessToken: 'access-2', refreshToken, refreshTokenExpiresIn: 50 * 24 * 3600 };
    },
    titles: async (accessToken, offset) => {
      calls.push(`titles ${accessToken} ${offset}`);
      const page = titles.slice(offset, offset + 2);
      return { trophyTitles: page, totalItemCount: titles.length, nextOffset: offset + 2 < titles.length ? offset + 2 : undefined };
    },
  };
  return { api, calls };
}

const trophies = (id: string, name: string, platform: string, defined: Record<string, number>, earned: Record<string, number>, progress: number): PsnTrophyTitle => ({
  npCommunicationId: id,
  trophyTitleName: name,
  trophyTitlePlatform: platform,
  definedTrophies: defined,
  earnedTrophies: earned,
  progress,
  lastUpdatedDateTime: '2026-09-01T10:00:00Z',
});

describe('Xbox achievements', () => {
  it('reads your games, puts each on the console you own it on, shows it in the drawer, and can mark What you played', async () => {
    const xbox = fakeXbox([
      // An Xbox 360 game says no total of achievements, only gamerscore.
      xboxTitle('1', 'Halo 3', ['Xbox360'], { currentAchievements: 49, totalAchievements: 0, currentGamerscore: 1000, totalGamerscore: 1000, progressPercentage: 100 }),
      // Smart Delivery: on both consoles, and owned on the Xbox One.
      xboxTitle('2', 'Forza Horizon 4', ['XboxOne', 'XboxSeries'], { currentAchievements: 20, totalAchievements: 50, currentGamerscore: 400, totalGamerscore: 1000, progressPercentage: 40 }),
      xboxTitle('3', 'Gears 5', ['XboxOne', 'XboxSeries', 'PC'], { currentAchievements: 5, totalAchievements: 70, currentGamerscore: 50, totalGamerscore: 1000, progressPercentage: 5 }),
      xboxTitle('4', 'Netflix', ['XboxOne'], { currentAchievements: 0, totalAchievements: 0, currentGamerscore: 0, totalGamerscore: 0, progressPercentage: 0 }, 'App'),
      xboxTitle('5', 'Microsoft Flight Simulator', ['PC'], { currentAchievements: 3, totalAchievements: 90, currentGamerscore: 30, totalGamerscore: 1000, progressPercentage: 3 }),
    ]);
    g = await testApp({ features: ['xbox'], xboxGet: xbox.get });
    cookies = await setUp(g);
    seedCatalogs(g, {
      owned: [
        ['1', 'Halo 3', 'Xbox 360'],
        ['2', 'Forza Horizon 4', 'Xbox One'],
      ],
      catalogs: { 'xbox-360': ['Halo 3'], 'xbox-one': ['Forza Horizon 4'], 'xbox-series-x': ['Forza Horizon 4', 'Gears 5'] },
    });
    // The Test button, with a key OpenXBL doesn't take, then the right one.
    g.settings.update({ 'sources.xboxApiKey': 'wrong-key' });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/xbox/test', cookies })).json()).toMatchObject({ ok: false, message: expect.stringMatching(/didn't take the API key/) });
    g.settings.update({ 'sources.xboxApiKey': 'right-key' });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/xbox/test', cookies })).json()).toEqual({ ok: true, message: 'OpenXBL took the key: signed in as Player One.' });

    expect(await g.achievements.sync('xbox')).toBe('4 games (3 matched to your consoles, 1 completed)');
    const drawer = async (platform: string, title: string) => (await g.app.inject({ url: `/api/v1/game?platform=${platform}&title=${encodeURIComponent(title)}`, cookies })).json();
    expect((await drawer('xbox-360', 'Halo 3')).achievements).toEqual([
      { source: 'xbox', title: 'Halo 3', earned: 49, total: 0, pointsEarned: 1000, pointsTotal: 1000, progress: 100, platinum: null, completed: true, lastPlayedAt: '2026-08-01T10:00:00Z' },
    ]);
    // On the Xbox One, where it's owned; Gears 5 on the Series X, the console whose catalog has it.
    expect((await drawer('xbox-one', 'Forza Horizon 4')).achievements).toMatchObject([{ earned: 20, total: 50, progress: 40, completed: false }]);
    expect((await drawer('xbox-series-x', 'Forza Horizon 4')).achievements).toEqual([]);
    expect((await drawer('xbox-series-x', 'Gears 5')).achievements).toMatchObject([{ progress: 5 }]);
    expect((await g.app.inject({ url: '/api/v1/sources/xbox', cookies })).json()).toMatchObject({ on: true, configured: true, games: 4, matched: 3, completed: 1, signedInUntil: null });

    // What you played: left alone by default; marked Completed when chosen, never over a status of your own.
    expect((await drawer('xbox-360', 'Halo 3')).play).toBeNull();
    g.settings.update({ 'sources.xboxMarkPlayed': 'completed' });
    expect(await g.achievements.sync('xbox')).toMatch(/; 1 marked in What you played$/);
    expect((await drawer('xbox-360', 'Halo 3')).play).toMatchObject({ status: 'completed' });
    expect(xbox.calls.filter((c) => c === '/v2/achievements')).toHaveLength(2);
  });

  it('is off until turned on, and needs its key', async () => {
    g = await testApp({ xboxGet: fakeXbox([]).get });
    cookies = await setUp(g);
    expect((await g.app.inject({ url: '/api/v1/sources/xbox', cookies })).statusCode).toBe(404);
    expect(await g.achievements.sync('xbox')).toMatch(/are off/);
    g.settings.update({ 'features.xbox': true });
    expect(await g.achievements.sync('xbox')).toMatch(/need your OpenXBL API key/);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/xbox/test', cookies })).json()).toMatchObject({ ok: false });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/xbox/sync', cookies })).statusCode).toBe(202);
  });
});

describe('PlayStation trophies', () => {
  it('signs in with the token once, then refreshes; reads every page, and shows the platinum', async () => {
    const psn = fakePsn([
      trophies('NPWR1', 'Uncharted: Drake’s Fortune™ Trophies', 'PS3', { bronze: 34, silver: 10, gold: 3, platinum: 1 }, { bronze: 34, silver: 10, gold: 3, platinum: 1 }, 100),
      trophies('NPWR2', 'DARK SOULS™ III', 'PS4', { bronze: 30, silver: 8, gold: 4, platinum: 1 }, { bronze: 15, silver: 3 }, 45),
      trophies('NPWR3', 'Astro Bot', 'PS5', { bronze: 40, silver: 5, gold: 2, platinum: 1 }, { bronze: 40, silver: 5, gold: 2, platinum: 1 }, 100),
      trophies('NPWR4', 'A PC game', 'PSPC', { bronze: 10 }, { bronze: 2 }, 20),
    ]);
    g = await testApp({ features: ['playstation'], psnApi: psn.api });
    cookies = await setUp(g);
    seedCatalogs(g, {
      owned: [['1', "Uncharted: Drake's Fortune", 'Playstation 3']],
      catalogs: { 'playstation-3': ["Uncharted: Drake's Fortune"], 'playstation-4': ['Dark Souls III'], 'playstation-5': ['Astro Bot'] },
    });
    g.settings.update({ 'sources.psnToken': 'expired-token' });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/playstation/test', cookies })).json()).toMatchObject({ ok: false, message: expect.stringMatching(/didn't take the sign-in token; they last about two months/) });
    g.settings.update({ 'sources.psnToken': 'good-token' });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/playstation/test', cookies })).json()).toEqual({ ok: true, message: 'PlayStation took the sign-in token: 4 games with trophies.' });

    expect(await g.achievements.sync('playstation')).toBe('4 games (3 matched to your consoles, 2 completed)');
    const drawer = async (platform: string, title: string) => (await g.app.inject({ url: `/api/v1/game?platform=${platform}&title=${encodeURIComponent(title)}`, cookies })).json();
    expect((await drawer('playstation-3', "Uncharted: Drake's Fortune")).achievements).toEqual([
      { source: 'playstation', title: 'Uncharted: Drake’s Fortune™ Trophies', earned: 48, total: 48, pointsEarned: null, pointsTotal: null, progress: 100, platinum: true, completed: true, lastPlayedAt: '2026-09-01T10:00:00Z' },
    ]);
    expect((await drawer('playstation-4', 'Dark Souls III')).achievements).toMatchObject([{ earned: 18, total: 43, progress: 45, platinum: false, completed: false }]);
    // Signed in once (the test, then the read used the refresh token); every page read.
    expect(psn.calls.filter((c) => c.startsWith('sign-in'))).toEqual(['sign-in expired-token', 'sign-in good-token']);
    expect(psn.calls).toContain('refresh refresh-1');
    expect(psn.calls.filter((c) => c.startsWith('titles'))).toEqual(['titles access-1 0', 'titles access-1 2', 'titles access-2 0', 'titles access-2 2']);
    const status = (await g.app.inject({ url: '/api/v1/sources/playstation', cookies })).json();
    expect(status).toMatchObject({ games: 4, matched: 3, completed: 2 });
    expect(Date.parse(status.signedInUntil)).toBeGreaterThan(Date.now() + 40 * 24 * 3600_000);
    // System > Status warns a week before the sign-in runs out (the refresh left 50 days), and once it has.
    expect(g.achievements.problems()).toEqual([]);
    expect(g.achievements.problems(Date.now() + 44 * 24 * 3600_000)).toMatchObject([{ level: 'warning', message: expect.stringMatching(/^PlayStation trophies' sign-in runs out on \d{4}-\d{2}-\d{2}: /) }]);
    expect(g.achievements.problems(Date.now() + 55 * 24 * 3600_000)).toMatchObject([{ message: expect.stringMatching(/sign-in ran out on/) }]);
    // A new sign-in token signs in again.
    g.settings.update({ 'sources.psnToken': 'newer-token' });
    await g.achievements.sync('playstation');
    expect(psn.calls.filter((c) => c.startsWith('sign-in')).at(-1)).toBe('sign-in newer-token');
  });

  it('says when the sign-in token has run out', async () => {
    g = await testApp({ features: ['playstation'], psnApi: fakePsn([]).api });
    cookies = await setUp(g);
    g.settings.update({ 'sources.psnToken': 'expired-token' });
    await expect(g.achievements.sync('playstation')).rejects.toThrow(/copy the new token into Settings > Sources > PlayStation trophies/);
    // Read now: queued in the background.
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sources/playstation/sync', cookies })).statusCode).toBe(202);
  });
});
