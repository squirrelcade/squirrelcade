import { describe, expect, it } from 'vitest';
import { isUnwantedRom, mapPlatforms, oneGame, pickRom, regionOrder, romShortTitleKey, romTitleKeys, rommOverrides, titleMatchKeys, type RommRom } from './romm.js';
import { matchKey } from './text.js';

const rom = (id: number, fsName: string, regions: string[], extra: Partial<RommRom> = {}): RommRom => ({
  id,
  platformId: 1,
  igdbId: 3186,
  name: 'Street Fighter II',
  fsName,
  regions,
  tags: [],
  playable: false,
  ...extra,
});

describe('choosing the ROM to link to', () => {
  const order = regionOrder('north-america');

  it('prefers the home region, then World, Europe and Japan', () => {
    expect(order).toEqual(['usa', 'world', 'europe', 'japan']);
    const japan = rom(1, 'Street Fighter II (Japan).sfc', ['Japan']);
    const europe = rom(2, 'Street Fighter II (Europe).sfc', ['Europe']);
    const world = rom(3, 'Street Fighter II (World).sfc', ['World']);
    const usa = rom(4, 'Street Fighter II (USA).sfc', ['USA']);
    expect(pickRom([japan, europe, world, usa], order)?.id).toBe(4);
    expect(pickRom([japan, europe, world], order)?.id).toBe(3);
    expect(pickRom([japan, europe], order)?.id).toBe(2);
    // A ROM for several regions counts with its best one; the short forms work too.
    expect(pickRom([europe, rom(5, 'Street Fighter II (USA, Europe).sfc', ['Europe', 'U'])], order)?.id).toBe(5);
    // Other home regions put their own region first.
    expect(pickRom([japan, usa], regionOrder('japan'))?.id).toBe(1);
    expect(pickRom([usa, japan], regionOrder('north-america', ['Japan']))?.id).toBe(1);
  });

  it('skips betas, prototypes, demos and hacks unless nothing else is there', () => {
    const beta = rom(1, 'Street Fighter II (USA) (Beta).sfc', ['USA'], { tags: ['Beta'] });
    const hack = rom(2, 'Street Fighter II (USA) [h1].sfc', ['USA']);
    const demo = rom(3, 'Street Fighter II (USA) (Demo).sfc', ['USA']);
    const japan = rom(4, 'Street Fighter II (Japan).sfc', ['Japan']);
    expect([beta, hack, demo].every((r) => isUnwantedRom(r))).toBe(true);
    expect(isUnwantedRom(japan)).toBe(false);
    expect(pickRom([beta, hack, demo, japan], order)?.id).toBe(4);
    expect(pickRom([hack, beta], order)?.id).toBe(1);
    expect(pickRom([], order)).toBeNull();
  });

  it('breaks ties toward ROMs playable in the browser, then the lowest id', () => {
    const a = rom(7, 'Street Fighter II (USA).sfc', ['USA']);
    const b = rom(9, 'Street Fighter II (USA) (Rev 1).sfc', ['USA'], { playable: true });
    expect(pickRom([a, b], order)?.id).toBe(9);
    expect(pickRom([b, { ...a, playable: true }], order)?.id).toBe(7);
  });

  it('reads the title from the file name as No-Intro writes it', () => {
    const keys = romTitleKeys({ name: 'Zelda DX', fsName: "Legend of Zelda, The - Link's Awakening (USA, Europe) (Rev 2).gb" });
    expect(keys).toEqual([matchKey('Zelda DX'), matchKey("The Legend of Zelda - Link's Awakening")]);
  });

  it('matches titles only by names in the Latin alphabet with more than one character to their key', () => {
    // RomM and IGDB name many Japanese games in Japanese; their keys would be only the digits ("2").
    expect(romTitleKeys({ name: 'デッドオアアライブ2', fsName: 'Dead or Alive 2 - Limited Edition (Japan)' })).toEqual([matchKey('Dead or Alive 2 - Limited Edition')]);
    expect(titleMatchKeys(['Tony Hawk 2', 'トニー・ホーク 2', 'エフゼロ X'])).toEqual([matchKey('Tony Hawk 2')]);
    // A file named only "X" says nothing about the game; accents and full-width letters are still Latin.
    expect(romTitleKeys({ name: 'X', fsName: 'X' })).toEqual([]);
    expect(titleMatchKeys(['Pokémon Stadium', 'ＵＮ Squadron', 'Romancing Sa·Ga 3'])).toEqual([matchKey('Pokemon Stadium'), matchKey('UN Squadron'), matchKey('Romancing Sa Ga 3')]);
    // PriceCharting's editions in brackets count with and without them.
    expect(titleMatchKeys(['Sonic the Hedgehog [Not for Resale]'])).toEqual([matchKey('Sonic the Hedgehog [Not for Resale]'), matchKey('Sonic the Hedgehog')]);
  });

  it('knows a file name without its subtitle, and when ROMs are one game', () => {
    const rockman = { fsName: 'Rockman 7 - Shukumei no Taiketsu! (Japan).sfc', igdbId: 1234 };
    expect(romShortTitleKey(rockman)).toBe(matchKey('Rockman 7'));
    expect(romShortTitleKey({ fsName: "Legend of Zelda, The - Link's Awakening (USA).gb" })).toBe(matchKey('The Legend of Zelda'));
    expect(romShortTitleKey({ fsName: 'Super Mario World (USA).sfc' })).toBe('');
    // Regions and revisions of one game are one game; different subtitles are different games, unless IGDB says otherwise.
    expect(oneGame([rockman, { fsName: 'Rockman 7 - Shukumei no Taiketsu! (Japan) (Rev 1).sfc', igdbId: null }])).toBe(true);
    const butouden = { fsName: 'Dragon Ball Z - Super Butouden (Japan).sfc', igdbId: 2001 };
    expect(oneGame([butouden, { fsName: 'Dragon Ball Z - Super Butouden 2 (Japan).sfc', igdbId: 2002 }])).toBe(false);
    expect(oneGame([butouden, { fsName: 'Dragon Ball Z - Super Butoden (France).sfc', igdbId: 2001 }])).toBe(true);
    expect(oneGame([])).toBe(false);
  });
});

describe('RomM platforms', () => {
  const romm = [
    { id: 10, slug: 'snes', name: 'Super Nintendo Entertainment System', igdbId: 19 },
    { id: 11, slug: 'sfam', name: 'Super Famicom', igdbId: 58 },
    { id: 12, slug: 'ngage', name: 'N-Gage', igdbId: null },
    { id: 13, slug: 'arcade', name: 'Arcade', igdbId: 52 },
  ];

  it('maps by the setting first, then the IGDB platform number, then the name', () => {
    const mapped = mapPlatforms(
      [
        { key: 'super-nintendo', name: 'Super Nintendo', igdbId: 19 },
        { key: 'n-gage', name: 'N-Gage', igdbId: 42 },
        { key: 'nintendo-64', name: 'Nintendo 64', igdbId: 4 },
      ],
      romm,
    );
    expect(mapped.get('super-nintendo')).toEqual({ platforms: [romm[0]], via: 'igdb' });
    expect(mapped.get('n-gage')).toEqual({ platforms: [romm[2]], via: 'name' });
    expect(mapped.has('nintendo-64')).toBe(false);

    const overrides = rommOverrides(['super-nintendo: snes; sfam', 'not a line', 'nintendo-64:']);
    expect(overrides).toEqual({ 'super-nintendo': ['snes', 'sfam'] });
    const both = mapPlatforms([{ key: 'super-nintendo', name: 'Super Nintendo', igdbId: 19 }], romm, overrides);
    expect(both.get('super-nintendo')).toEqual({ platforms: [romm[0], romm[1]], via: 'setting' });
  });

  it("takes in RomM platforms with the platform's second IGDB number", () => {
    const mapped = mapPlatforms([{ key: 'super-nintendo', name: 'Super Nintendo', igdbId: 19, extraIgdbId: 58 }], romm);
    expect(mapped.get('super-nintendo')).toEqual({ platforms: [romm[0], romm[1]], via: 'igdb' });
  });
});
