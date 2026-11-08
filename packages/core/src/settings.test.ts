import { describe, expect, it } from 'vitest';
import { SETTINGS_PAGES, defaultSettings, settingDefinitions, settingKeys, validateSettingChanges, youtubeModeOf } from './settings.js';

describe('setting definitions', () => {
  it('every setting belongs to a known page and its default is valid', () => {
    const pages = new Set(SETTINGS_PAGES.map((p) => p.id));
    for (const key of settingKeys) {
      const def = settingDefinitions[key];
      expect(pages.has(def.page), key).toBe(true);
      expect(def.schema.safeParse(def.default).success, key).toBe(true);
      expect(def.description.length, key).toBeGreaterThan(10);
    }
  });

  it('defaults are independent copies', () => {
    const a = defaultSettings();
    a['platforms.excludedLabels'].push('Changed');
    expect(defaultSettings()['platforms.excludedLabels']).not.toContain('Changed');
  });
});

describe("YouTube's Light and Deep (D215)", () => {
  it('starts on Automatic: Deep when a key is set, Light when none is; Light never uses a key; Deep without one is Light', () => {
    expect(defaultSettings()['roots.youtubeMode']).toBe('auto');
    expect(youtubeModeOf('auto', false)).toBe('light');
    expect(youtubeModeOf('auto', true)).toBe('deep');
    expect(youtubeModeOf('light', true)).toBe('light');
    expect(youtubeModeOf('deep', true)).toBe('deep');
    expect(youtubeModeOf('deep', false)).toBe('light');
  });

  it('says plainly that Light means fewer videos', () => {
    expect(settingDefinitions['roots.youtubeMode'].description).toMatch(/Light needs no key/);
    expect(settingDefinitions['roots.youtubeMode'].description).toMatch(/latest 15/);
    expect(validateSettingChanges({ 'roots.youtubeMode': 'deeper' }).issues).toHaveLength(1);
  });
});

describe('validateSettingChanges', () => {
  it('accepts valid values and reports invalid or unknown ones', () => {
    const { valid, issues } = validateSettingChanges({
      'general.instanceName': '  My Games ',
      'interface.pageSize': 5,
      'general.timeZone': 'Mars/Olympus',
      'general.currency': 'USD',
      'nope.nothing': 1,
    });
    expect(valid).toEqual({ 'general.instanceName': 'My Games', 'general.currency': 'USD' });
    expect(issues.map((i) => i.key).sort()).toEqual(['general.timeZone', 'interface.pageSize', 'nope.nothing']);
  });

  it('accepts real time zones and an empty value', () => {
    expect(validateSettingChanges({ 'general.timeZone': 'America/Phoenix' }).issues).toEqual([]);
    expect(validateSettingChanges({ 'general.timeZone': '' }).issues).toEqual([]);
  });

  it('rejects values of the wrong type', () => {
    const { issues } = validateSettingChanges({ 'interface.showCoverArt': 'yes', 'general.currency': 'DOGE' });
    expect(issues).toHaveLength(2);
  });
});
