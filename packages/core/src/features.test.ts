import { describe, expect, it } from 'vitest';
import { everythingNowSentence, everythingNowTotals, FEATURE_LIST, featureLight, featurePromptUrl, featureTime, longTime, QUICK_START } from './features.js';
import { settingKeys } from './settings.js';
import { SETTINGS_PAGES } from './settingsPages.js';

describe('the features list', () => {
  it('has unique ids, padded estimates and every outside account named', () => {
    const ids = FEATURE_LIST.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of FEATURE_LIST) {
      expect(f.padded, f.id).toBeGreaterThanOrEqual(f.minutes * 2);
      expect(f.adds.length, f.id).toBeGreaterThan(10);
      expect(f.needs.length, f.id).toBeGreaterThan(3);
      expect(f.lights.length, f.id).toBeGreaterThan(0);
    }
  });

  it('covers what the owner asked for', () => {
    const ids = FEATURE_LIST.map((f) => f.id);
    for (const id of ['igdb', 'mail', 'notifications', 'romm', 'playnite', 'retroachievements', 'xbox', 'playstation', 'steam', 'pc-prices', 'gamefly', 'youtube', 'friends-live', 'magazines', 'claude', 'ai-model', 'https', 'backups', 'barcodes']) expect(ids).toContain(id);
  });

  it("points each feature at a settings page and, when it names one, a setting that exists", () => {
    const pages = new Set(SETTINGS_PAGES.map((p) => p.id as string));
    const keys = new Set<string>(settingKeys);
    for (const f of FEATURE_LIST) {
      const [path, hash] = f.settings.split('#');
      expect(path, f.id).toMatch(/^\/settings\/[a-z]+$/);
      expect(pages.has(path!.split('/')[2]!), f.id).toBe(true);
      if (hash) expect(keys.has(hash.replace('setting-', '')), f.id).toBe(true);
    }
  });

  it('words its times and sums the padded total', () => {
    expect(featureTime({ minutes: 10, padded: 20 })).toBe('about 10 minutes; give it 20');
    expect(longTime(45)).toBe('45 minutes');
    expect(longTime(530)).toBe('9 hours');
    const t = everythingNowTotals();
    expect(t.minutes).toBe(QUICK_START.minutes + FEATURE_LIST.reduce((n, f) => n + f.minutes, 0));
    expect(t.padded).toBeGreaterThan(t.minutes * 2);
    expect(everythingNowSentence()).toBe('about 4 hours if everything goes smoothly; give it 9 hours, spread over several days');
    expect(featurePromptUrl('igdb')).toBe('https://github.com/squirrelcade/squirrelcade/blob/main/docs/ai/features/igdb.md');
  });

  it("says whether a feature is set up from the status board's lines", () => {
    const f = { lights: ['friends-live-files', 'friend-link-'] };
    expect(featureLight(f, [{ key: 'igdb', light: 'green' }])).toBeNull();
    expect(featureLight(f, [{ key: 'friends-live-files', light: 'green' }, { key: 'friend-link-3', light: 'red' }])).toBe('red');
    expect(featureLight(f, [{ key: 'friend-link-3', light: 'grey' }])).toBe('grey');
    expect(featureLight({ lights: ['igdb'] }, [{ key: 'igdb', light: 'yellow' }, { key: 'xbox', light: 'red' }])).toBe('yellow');
  });
});
