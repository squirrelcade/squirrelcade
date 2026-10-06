import { describe, expect, it } from 'vitest';
import { achievementTitle, parseSteamProfile, psnCompleted, psnPlatformKeys, trophyCount, xboxCompleted, xboxPlatformKeys } from './achievements.js';

describe('achievements from Xbox and PlayStation', () => {
  it("reads each service's consoles as Squirrelcade's", () => {
    expect(xboxPlatformKeys(['XboxOne', 'XboxSeries'])).toEqual(['xbox-one', 'xbox-series-x']);
    expect(xboxPlatformKeys(['Xbox360'])).toEqual(['xbox-360']);
    expect(xboxPlatformKeys(['PC', 'Win32', 'Mobile'])).toEqual([]);
    expect(psnPlatformKeys('PS3,PSVITA')).toEqual(['playstation-3', 'playstation-vita']);
    expect(psnPlatformKeys('PS5')).toEqual(['playstation-5']);
    expect(psnPlatformKeys('PSPC')).toEqual([]);
  });

  it("reads a service's title as a game's title", () => {
    expect(achievementTitle('DARK SOULS™ III')).toBe('DARK SOULS III');
    expect(achievementTitle("Marvel's Spider-Man")).toBe("Marvel's Spider-Man");
    expect(achievementTitle('Uncharted: Drake’s Fortune™ Trophies')).toBe('Uncharted: Drake’s Fortune');
    expect(achievementTitle('Horizon Zero Dawn™ (PS4)')).toBe('Horizon Zero Dawn');
    expect(achievementTitle('Sackboy™: A Big Adventure PS4 & PS5')).toBe('Sackboy: A Big Adventure');
    expect(achievementTitle('Persona 5 Royal (English)')).toBe('Persona 5 Royal');
    expect(achievementTitle('Forza Horizon 4 for Xbox One')).toBe('Forza Horizon 4');
    expect(achievementTitle('Gears 5 Xbox Series X|S')).toBe('Gears 5');
    expect(achievementTitle('Halo 3')).toBe('Halo 3');
  });

  it('reads a Steam profile however the owner gives it', () => {
    expect(parseSteamProfile('76561197960287930')).toEqual({ id64: '76561197960287930' });
    expect(parseSteamProfile('https://steamcommunity.com/profiles/76561197960287930/')).toEqual({ id64: '76561197960287930' });
    expect(parseSteamProfile('https://steamcommunity.com/id/gabelogannewell')).toEqual({ vanity: 'gabelogannewell' });
    expect(parseSteamProfile('steamcommunity.com/id/some_name/')).toEqual({ vanity: 'some_name' });
    expect(parseSteamProfile('some_name')).toEqual({ vanity: 'some_name' });
    expect(parseSteamProfile('')).toBeNull();
    expect(parseSteamProfile('https://example.com/a/b')).toBeNull();
  });

  it('says when a game is completed', () => {
    expect(xboxCompleted({ currentAchievements: 50, totalAchievements: 50, currentGamerscore: 1000, totalGamerscore: 1000, progressPercentage: 100 })).toBe(true);
    expect(xboxCompleted({ currentAchievements: 32, totalAchievements: 50, currentGamerscore: 650, totalGamerscore: 1000, progressPercentage: 65 })).toBe(false);
    // An Xbox 360 game gives no total of achievements, only gamerscore.
    expect(xboxCompleted({ currentAchievements: 49, totalAchievements: 0, currentGamerscore: 1000, totalGamerscore: 1000 })).toBe(true);
    expect(xboxCompleted({ currentAchievements: 0, totalAchievements: 0, currentGamerscore: 0, totalGamerscore: 0 })).toBe(false);
    expect(psnCompleted({ bronze: 40, silver: 10, gold: 3, platinum: 1 }, { bronze: 40, silver: 10, gold: 3, platinum: 1 }, 100)).toBe(true);
    // The platinum is earned before a DLC's trophies.
    expect(psnCompleted({ bronze: 50, silver: 12, gold: 4, platinum: 1 }, { bronze: 40, silver: 10, gold: 3, platinum: 1 }, 82)).toBe(true);
    expect(psnCompleted({ bronze: 12, silver: 2, gold: 1 }, { bronze: 12, silver: 2, gold: 1 }, 100)).toBe(true);
    expect(psnCompleted({ bronze: 40, silver: 10, gold: 3, platinum: 1 }, { bronze: 20 }, 30)).toBe(false);
    expect(trophyCount({ bronze: 40, silver: 10, gold: 3, platinum: 1 })).toBe(54);
  });
});
