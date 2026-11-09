import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp } from './test-helpers.js';

let cookies: Record<string, string>;

// R12 (1.5.0): the wishlist's false gaps the owner saw, a twin pack named with its series twice and a reboot that
// shares its namesake's number.
let g: Awaited<ReturnType<typeof testApp>>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [
      ['1', 'Final Fantasy VII & VIII Remastered Twin Pack', 'Nintendo Switch'],
      ['2', 'Call of Duty Modern Warfare 2', 'Playstation 3'],
      ['3', 'Call of Duty Modern Warfare 2', 'Xbox 360'],
      ['4', 'Call of Duty Modern Warfare 3', 'Playstation 3'],
      ['5', 'Call of Duty: Modern Warfare III', 'Playstation 5'],
      ['6', 'Call of Duty Ghosts', 'Playstation 3'],
    ],
    catalogs: {
      'nintendo-switch': [{ title: 'Final Fantasy VII & Final Fantasy VIII Remastered Twin Pack', targetStatus: 'required' as const, evidence: 'list', releaseDate: '2020-09-03' }, { title: 'Octopath Traveler', targetStatus: 'required' as const, evidence: 'list', releaseDate: '2018-07-13' }],
      'playstation-3': [
        { title: 'Call of Duty: Modern Warfare 2', targetStatus: 'required' as const, evidence: 'list', releaseDate: '2009-11-10' },
        { title: 'Call of Duty: Modern Warfare 3', targetStatus: 'required' as const, evidence: 'list', releaseDate: '2011-11-08' },
        { title: 'Call of Duty: Ghosts', targetStatus: 'required' as const, evidence: 'list', releaseDate: '2013-11-05' },
      ],
      'playstation-5': [
        { title: 'Call of Duty: Modern Warfare II', targetStatus: 'required' as const, evidence: 'list', releaseDate: '2022-10-28' },
        { title: 'Call of Duty: Modern Warfare III', targetStatus: 'required' as const, evidence: 'list', releaseDate: '2023-11-10' },
      ],
      'playstation-4': [{ title: 'Call of Duty: Modern Warfare II', targetStatus: 'required' as const, evidence: 'list', releaseDate: '2022-10-28' }],
      'xbox-one': [{ title: 'Call of Duty: Ghosts', targetStatus: 'required' as const, evidence: 'list', releaseDate: '2013-11-22' }],
    },
  });
});
afterEach(async () => {
  await g.cleanup();
});

const view = { paid: true, notes: true, pc: false, play: true, details: true };

describe('the wishlist\'s false gaps (R12)', () => {
  it('counts a twin pack named with its series twice as the one you have', () => {
    const switchGames = g.catalogs.allMatches().find((p) => p.key === 'nintendo-switch')!;
    const pack = switchGames.match.targets.find((t) => t.target.title.startsWith('Final Fantasy'))!;
    expect(pack.status).toBe('owned');
    const wishes = [...g.wishlist.compute().all.values()].map((c) => c.title);
    expect(wishes).not.toContain('Final Fantasy VII & Final Fantasy VIII Remastered Twin Pack');
    expect(wishes).toContain('Octopath Traveler');
  });

  it("doesn't take 2022's Modern Warfare II for the 2009 Modern Warfare 2 you have", () => {
    const all = [...g.wishlist.compute().all.values()];
    const mwII = all.filter((c) => c.title === 'Call of Duty: Modern Warfare II');
    expect(mwII.map((c) => c.platformKey).sort()).toEqual(['playstation-4', 'playstation-5']);
    for (const c of mwII) expect(c.ownedOn ?? []).toEqual([]);
    // The same game on another console of its years still counts as yours elsewhere.
    expect(all.find((c) => c.title === 'Call of Duty: Ghosts')?.ownedOn).toEqual(['PlayStation 3']);
  });

  it("answers Claude's check_ownership without the namesake, and keeps a reboot and its namesake apart", () => {
    const [mwII, mw2] = g.aiTools.check({ titles: ['Call of Duty: Modern Warfare II', 'Call of Duty: Modern Warfare 2'] }, view).results;
    expect(mwII!.status).not.toBe('owned');
    expect(mwII!.near_misses[0]).toMatchObject({ match: 'similar', why: 'Another game of that name (yours came out in 2009)' });
    expect(mw2!.status).toBe('owned');
    // Modern Warfare III (2023) and Modern Warfare 3 (2011) are two games with an id each.
    const [mw3] = g.aiTools.check({ titles: ['Call of Duty Modern Warfare 3'] }, view).results;
    const [mwIII] = g.aiTools.check({ titles: ['Call of Duty: Modern Warfare III'] }, view).results;
    expect(mw3!.status).toBe('owned');
    expect(mwIII!.status).toBe('owned');
    expect(mw3!.matches[0]!.game_id).not.toBe(mwIII!.matches[0]!.game_id);
  });

  it("says the same on a game's page (1.5.1)", async () => {
    const page = async (platform: string, title: string) => (await g.app.inject({ url: `/api/v1/game?platform=${platform}&title=${encodeURIComponent(title)}`, cookies })).json();
    expect((await page('playstation-5', 'Call of Duty: Modern Warfare II')).ownedOn).toEqual([]);
    expect((await page('xbox-one', 'Call of Duty: Ghosts')).ownedOn).toEqual(['PlayStation 3']);
  });
});
