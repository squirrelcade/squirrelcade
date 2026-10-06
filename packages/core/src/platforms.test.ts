import { describe, expect, it } from 'vitest';
import { consoleFor, findPlatforms, consoleInUse, consoleRegion, forPlatform, parseConsoleLabel, platformFamily, REGION_LOCKED_DEFAULT, regionalConsole } from './platforms.js';

describe('parseConsoleLabel', () => {
  it('splits region prefixes from the platform', () => {
    expect(parseConsoleLabel('PAL Playstation 3')).toMatchObject({ platformKey: 'playstation-3', region: 'europe' });
    expect(parseConsoleLabel('JP Nintendo Switch')).toMatchObject({ platformKey: 'nintendo-switch', region: 'japan' });
    expect(parseConsoleLabel('Asian English Switch')).toMatchObject({ platformKey: 'nintendo-switch', region: 'asia' });
  });

  it('treats unprefixed names as North American releases', () => {
    expect(parseConsoleLabel('Playstation 3')).toMatchObject({ platformKey: 'playstation-3', region: 'north-america' });
  });

  it('knows regional names of the same console', () => {
    expect(parseConsoleLabel('Super Famicom')).toMatchObject({ platformKey: 'super-nintendo', region: 'japan' });
    expect(parseConsoleLabel('Super Nintendo')).toMatchObject({ platformKey: 'super-nintendo', region: 'north-america' });
  });

  it('keeps PC Engine separate from PC', () => {
    expect(parseConsoleLabel('PC Engine')).toMatchObject({ platformKey: 'turbografx-16', region: 'japan' });
  });

  it('suggests a key for unknown consoles', () => {
    expect(parseConsoleLabel('JP Pippin')).toMatchObject({ platform: null, platformKey: 'pippin', platformName: 'Pippin', region: 'japan' });
  });
});

describe('consoleFor', () => {
  const snes = { key: 'super-nintendo', name: 'Super Nintendo' };
  const switch1 = { key: 'nintendo-switch', name: 'Nintendo Switch' };

  it("gives another region's copies of a region-locked console a console of their own", () => {
    expect(consoleFor(snes, 'japan', 'north-america', REGION_LOCKED_DEFAULT)).toEqual({ key: 'super-famicom', name: 'Super Famicom' });
    expect(consoleFor({ key: 'nintendo-entertainment-system', name: 'Nintendo Entertainment System' }, 'japan', 'north-america', REGION_LOCKED_DEFAULT)).toEqual({ key: 'famicom', name: 'Famicom' });
    expect(consoleFor({ key: 'nintendo-64', name: 'Nintendo 64' }, 'japan', 'north-america', REGION_LOCKED_DEFAULT)).toEqual({ key: 'nintendo-64-japan', name: 'Nintendo 64 (Japan)' });
    expect(consoleFor(snes, 'europe', 'north-america', REGION_LOCKED_DEFAULT)).toEqual({ key: 'super-nintendo-pal', name: 'Super Nintendo (PAL)' });
    expect(consoleFor({ key: 'sega-genesis', name: 'Sega Genesis' }, 'europe', 'north-america', REGION_LOCKED_DEFAULT)).toEqual({ key: 'mega-drive-pal', name: 'Mega Drive (PAL)' });
  });

  it('keeps home-region copies, and every region of a region-free console, on the one console', () => {
    expect(consoleFor(snes, 'north-america', 'north-america', REGION_LOCKED_DEFAULT)).toEqual(snes);
    expect(consoleFor(switch1, 'japan', 'north-america', REGION_LOCKED_DEFAULT)).toEqual(switch1);
    expect(consoleFor(snes, 'japan', 'north-america', [])).toEqual(snes);
  });

  it('follows the home region', () => {
    expect(consoleFor(snes, 'japan', 'japan', REGION_LOCKED_DEFAULT)).toEqual(snes);
    expect(consoleFor(snes, 'north-america', 'japan', REGION_LOCKED_DEFAULT)).toEqual({ key: 'super-nintendo-north-america', name: 'Super Nintendo (North America)' });
  });
});

describe('regionalConsole', () => {
  it("tells which console another region's own console is a version of", () => {
    expect(regionalConsole('super-famicom')).toEqual({ base: 'super-nintendo', region: 'japan', name: 'Super Famicom' });
    expect(regionalConsole('nintendo-64-japan')).toEqual({ base: 'nintendo-64', region: 'japan', name: 'Nintendo 64 (Japan)' });
    expect(regionalConsole('mega-drive-pal')).toEqual({ base: 'sega-genesis', region: 'europe', name: 'Mega Drive (PAL)' });
    expect(regionalConsole('super-nintendo')).toBeNull();
    expect(regionalConsole('sega-pico-japan')).toBeNull();
  });

  it("falls back to the base console in per-platform maps, and gives the console's region", () => {
    expect(forPlatform({ 'nintendo-64': 4 }, 'nintendo-64-japan')).toBe(4);
    expect(forPlatform({ 'super-nintendo': 19, 'super-famicom': 58 }, 'super-famicom')).toBe(58);
    expect(forPlatform({ 'nintendo-64': 4 }, 'wii-japan')).toBeUndefined();
    expect(consoleRegion('super-famicom', 'north-america')).toBe('japan');
    expect(consoleRegion('wii', 'north-america')).toBe('north-america');
  });

  it('counts another region\'s own console only while its base console is region-locked and away from home', () => {
    expect(consoleInUse('super-famicom', 'north-america', REGION_LOCKED_DEFAULT)).toBe(true);
    expect(consoleInUse('super-famicom', 'north-america', [])).toBe(false);
    expect(consoleInUse('super-famicom', 'japan', REGION_LOCKED_DEFAULT)).toBe(false);
    expect(consoleInUse('nintendo-switch', 'north-america', [])).toBe(true);
  });
});

describe('platformFamily', () => {
  it('colors known consoles by maker, other regions by their base console', () => {
    expect(platformFamily('playstation-3')).toBe('playstation');
    expect(platformFamily('psp')).toBe('playstation');
    expect(platformFamily('xbox-series-x')).toBe('xbox');
    expect(platformFamily('nintendo-switch-2')).toBe('nintendo');
    expect(platformFamily('super-famicom')).toBe('nintendo');
    expect(platformFamily('nintendo-64-japan')).toBe('nintendo');
    expect(platformFamily('sega-saturn')).toBe('other');
  });

  it('reads the name of a console added by hand', () => {
    expect(platformFamily('ps-vita-tv', 'PS Vita TV')).toBe('playstation');
    expect(platformFamily('xbla', 'Xbox Live Arcade')).toBe('xbox');
    expect(platformFamily('nds-lite', 'Nintendo DS Lite')).toBe('nintendo');
    expect(platformFamily('dsiware', 'DS')).toBe('nintendo');
    expect(platformFamily('pc-engine', 'PC Engine')).toBe('other');
  });
});

describe('findPlatforms', () => {
  const owned = [
    { key: 'playstation-3', name: 'PlayStation 3' },
    { key: 'xbox-360', name: 'Xbox 360' },
    { key: 'nintendo-switch', name: 'Nintendo Switch' },
    { key: 'nintendo-switch-2', name: 'Nintendo Switch 2' },
    { key: 'super-nintendo', name: 'Super Nintendo' },
  ];
  it('takes keys, names, short names and PriceCharting console names', () => {
    expect(findPlatforms('playstation-3', owned).map((p) => p.key)).toEqual(['playstation-3']);
    expect(findPlatforms('PlayStation 3', owned).map((p) => p.key)).toEqual(['playstation-3']);
    expect(findPlatforms('PS3', owned).map((p) => p.key)).toEqual(['playstation-3']);
    expect(findPlatforms('360', owned).map((p) => p.key)).toEqual(['xbox-360']);
    expect(findPlatforms('Switch', owned).map((p) => p.key)).toEqual(['nintendo-switch']);
    expect(findPlatforms('Switch 2', owned).map((p) => p.key)).toEqual(['nintendo-switch-2']);
    expect(findPlatforms('SNES', owned).map((p) => p.key)).toEqual(['super-nintendo']);
    expect(findPlatforms('PAL Playstation 3', owned).map((p) => p.key)).toEqual(['playstation-3']);
    expect(findPlatforms('Dreamcast', owned)).toEqual([]);
    expect(findPlatforms('', owned)).toEqual([]);
  });
});
