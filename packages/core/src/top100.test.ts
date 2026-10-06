import { describe, expect, it } from 'vitest';
import { FEATURE_DEFAULTS, FEATURE_SETTINGS, settingDefinitions, settingFeature, settingKeys } from './settings.js';
import { firstLaunchYear, lastYear, parseHistory, parseTop100, TOP100_PLATFORMS } from './top100.js';

describe('parseTop100', () => {
  it("reads the lists best first, under Squirrelcade's platform keys (a slug it doesn't know stays as it is)", () => {
    const data = parseTop100({
      version: '2026-09-27',
      platforms: [
        { platform: 'snes', name: 'Super Nintendo', list: [{ rank: 2, title: 'Super Metroid', alt: [], year: 1994 }, { rank: 1, title: 'Final Fantasy VI', alt: [' Final Fantasy III ', ''], year: 1994 }] },
        { platform: 'vectrex', name: 'Vectrex', list: [{ rank: 1, title: 'Mine Storm', year: null }] },
      ],
    });
    expect(data.lists.map((l) => l.platformKey)).toEqual(['super-nintendo', 'vectrex']);
    expect(data.lists[0]!.entries).toEqual([
      { rank: 1, title: 'Final Fantasy VI', altTitles: ['Final Fantasy III'], year: 1994 },
      { rank: 2, title: 'Super Metroid', altTitles: [], year: 1994 },
    ]);
    expect(data.lists[1]!.entries[0]).toEqual({ rank: 1, title: 'Mine Storm', altTitles: [], year: null });
    expect(() => parseTop100({ version: '1', platforms: [{ platform: 'x', name: 'X', list: [{ rank: 0, title: 'Bad' }] }] })).toThrow();
    // Every mapped key is one of Squirrelcade's.
    expect(Object.values(TOP100_PLATFORMS).every((k) => /^[a-z0-9-]+$/.test(k))).toBe(true);
  });
});

describe('parseHistory', () => {
  const console0 = {
    platformKey: 'playstation-3',
    profile: { manufacturer: 'Sony', generation: 7, launches: [{ region: 'JP', date: '2006-11-11' }], discontinued: null, unitsSold: null, hardware: [], competitors: [], story: null, firsts: [], endOfLife: null },
    startHere: [],
    sources: ['https://en.wikipedia.org/wiki/PlayStation_3'],
    status: 'draft',
    asOf: null,
  };
  it('reads consoles and games, and refuses a launch that is not a date or a source that is not an address', () => {
    expect(parseHistory({ version: '1', consoles: [console0], games: [] }).consoles).toHaveLength(1);
    expect(() => parseHistory({ version: '1', consoles: [{ ...console0, profile: { ...console0.profile, launches: [{ region: 'JP', date: 'Nov 2006' }] } }], games: [] })).toThrow();
    expect(() => parseHistory({ version: '1', consoles: [{ ...console0, sources: ['wikipedia'] }], games: [] })).toThrow();
    expect(() => parseHistory({ version: '1', consoles: [], games: [{ platformKey: 'x', title: 'Y', text: 'Z', sources: [], status: 'checked' }] })).toThrow();
  });

  it('knows the first year a console came out and the last year it was made', () => {
    expect(firstLaunchYear({ launches: [{ region: 'NA', date: '1991-08-23' }, { region: 'JP', date: '1990-11-21' }] })).toBe(1990);
    expect(firstLaunchYear({ launches: [] })).toBeNull();
    expect(lastYear('March 2016 (Europe), October 2016 (North America), May 29, 2017 (Japan)')).toBe(2017);
    expect(lastYear('Around 2013 (no date given)')).toBe(2013);
    expect(lastYear(null)).toBeNull();
  });
});

describe('features', () => {
  it('has a switch for each optional part, off by default only for the ones that need another program', () => {
    for (const [feature, key] of Object.entries(FEATURE_SETTINGS)) {
      expect(settingDefinitions[key].default).toBe(FEATURE_DEFAULTS[feature as keyof typeof FEATURE_DEFAULTS]);
      expect(settingDefinitions[key].page).toBe('features');
    }
    expect(FEATURE_DEFAULTS).toEqual({ igdb: true, history: true, pc: false, romm: false, itad: false, mail: false, retroachievements: false, xbox: false, playstation: false, steam: false });
  });

  it("hides a part's settings while it's off, and never the switches themselves", () => {
    expect(settingFeature('pc.playniteFolder')).toBe('pc');
    expect(settingFeature('security.viewersSeePc')).toBe('pc');
    expect(settingFeature('sources.rommLinkUnowned')).toBe('romm');
    expect(settingFeature('sources.igdbClientId')).toBe('igdb');
    expect(settingFeature('interface.timelineGames')).toBe('history');
    expect(settingFeature('mail.password')).toBe('mail');
    expect(settingFeature('sources.xboxApiKey')).toBe('xbox');
    expect(settingFeature('sources.psnMarkPlayed')).toBe('playstation');
    expect(settingFeature('features.pc')).toBeNull();
    expect(settingFeature('general.currency')).toBeNull();
    // PC game prices are a part of their own, inside the PC library's settings.
    expect(settingFeature('pc.priceAlertRule')).toBe('itad');
    expect(settingFeature('sources.itadKey')).toBe('itad');
    // Every other PC library setting belongs to the PC library part.
    expect(settingKeys.filter((k) => settingDefinitions[k].page === 'pc').every((k) => settingFeature(k) === (k.startsWith('pc.price') ? 'itad' : 'pc'))).toBe(true);
  });
});
