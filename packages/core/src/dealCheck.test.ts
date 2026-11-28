import { describe, expect, it } from 'vitest';
import { listingKind, numbersDiffer, readListing, surenessOf } from './dealCheck.js';
import { KNOWN_PLATFORMS } from './platforms.js';

const read = (text: string, hint?: string) => readListing(text, KNOWN_PLATFORMS, hint);

describe('readListing', () => {
  it('reads Amazon titles', () => {
    expect(read('WWE 2K26 - Nintendo Switch 2 Standard Edition')).toMatchObject({ title: 'WWE 2K26', platformKey: 'nintendo-switch-2', flags: [] });
    expect(read('SONIC X SHADOW GENERATIONS - Nintendo Switch 2')).toMatchObject({ title: 'SONIC X SHADOW GENERATIONS', platformKey: 'nintendo-switch-2' });
    expect(read('Hollow Knight: Silksong - Nintendo Switch 2 Edition')).toMatchObject({ title: 'Hollow Knight: Silksong', platformKey: 'nintendo-switch-2' });
  });

  it('reads Walmart and eBay titles', () => {
    expect(read('LEGO Harry Potter Collection, Warner Bros, Nintendo Switch')).toMatchObject({ title: 'LEGO Harry Potter Collection', platformKey: 'nintendo-switch' });
    expect(read('LEGO Harry Potter: Collection Years 1 to 4 & Years 5 to 7, LEGO Harry Potter, Physical/Nintendo Switch, Adventure,Action,Shooter, Parental Controls')).toMatchObject({
      title: 'LEGO Harry Potter: Collection Years 1 to 4 & Years 5 to 7',
      platformKey: 'nintendo-switch',
    });    expect(read('LEGO Harry Potter Collection - Nintendo Switch')).toMatchObject({ title: 'LEGO Harry Potter Collection', platformKey: 'nintendo-switch' });
    expect(read('Super Mario Odyssey (Nintendo Switch, 2017) Brand New Sealed')).toMatchObject({ title: 'Super Mario Odyssey', platformKey: 'nintendo-switch' });
    expect(read('Halo 3 Xbox 360 Complete CIB Tested')).toMatchObject({ title: 'Halo 3', platformKey: 'xbox-360' });
    expect(read('Pokemon Legends: Arceus Nintendo Switch Role-Playing Game Cards, RPG, Action, Adventure, Parental Controls')).toMatchObject({ title: 'Pokemon Legends: Arceus', platformKey: 'nintendo-switch' });
    expect(read('Nintendo Switch Sports - Nintendo Switch').title).toBe('Nintendo Switch Sports');
    expect(read('DRAGON QUEST III HD-2D Remake (NSW)')).toMatchObject({ title: 'DRAGON QUEST III HD-2D Remake', platformKey: 'nintendo-switch' });
    expect(read('Mario Kart World (NS2)')).toMatchObject({ title: 'Mario Kart World', platformKey: 'nintendo-switch-2' });
    expect(read('NSW - PERSONA 4 GOLDEN (STANDARD - SWITCH)')).toMatchObject({ title: 'PERSONA 4 GOLDEN', platformKey: 'nintendo-switch' });
    expect(read('PS3 Teslagrad (Sony PlayStation 3, 2015)')).toMatchObject({ title: 'Teslagrad', platformKey: 'playstation-3' });
    expect(read('Teslagrad (Sony PlayStation 3, 2014) PS3, Tested')).toMatchObject({ title: 'Teslagrad', platformKey: 'playstation-3' });
    expect(read('NES Remix Pack - Wii U').title).toBe('NES Remix Pack');
    expect(read('Sony PlayStation 3 PS3 Yakuza 4 Brand New ** Factory Sealed **')).toMatchObject({ title: 'Yakuza 4', platformKey: 'playstation-3' });
    expect(read('Microsoft Xbox 360 Halo 3 Complete')).toMatchObject({ title: 'Halo 3', platformKey: 'xbox-360' });
    expect(read('Nintendo Switch Sports - Nintendo Switch').title).toBe('Nintendo Switch Sports');
    expect(read('Sega Genesis Classics - PlayStation 4').title).toBe('Sega Genesis Classics');
    expect(read('LEGO DC Super-Villains - Nintendo Switch').title).toBe('LEGO DC Super-Villains');
    expect(read('Grand Theft Auto V (GTA 5) - PS3, M Mature, Manual Included')).toMatchObject({ title: 'Grand Theft Auto V', platformKey: 'playstation-3' });
    expect(read('Halo 3 (ODST) - Xbox 360').title).toBe('Halo 3 (ODST)');
    expect(read('Red Dead Redemption (with Undead Nightmare DLC) - PlayStation 5')).toMatchObject({ title: 'Red Dead Redemption', platformKey: 'playstation-5' });
    expect(read('Uncharted 2: Among Thieves PS3 T-Teen NTSC-U/C 2009')).toMatchObject({ title: 'Uncharted 2: Among Thieves', platformKey: 'playstation-3' });
    expect(read('Uncharted 2: Among Thieves PS3 [Game of the Year Greatest Hits]').title).toBe('Uncharted 2: Among Thieves [Game of the Year Greatest Hits]');
  });

  it('keeps an edition that is the game', () => {
    expect(read('Persona 5 Royal Steelbook Launch Edition - PlayStation 4').title).toBe('Persona 5 Royal Steelbook Launch Edition');
    expect(read('Cyberpunk 2077: Ultimate Edition - Nintendo Switch 2').title).toBe('Cyberpunk 2077: Ultimate Edition');
  });

  it('flags the kind of copy', () => {
    expect(read('Star Wars Outlaws - Nintendo Switch 2 [Game-Key Card]')).toMatchObject({ title: 'Star Wars Outlaws', flags: ['game-key-card'] });
    expect(read('Mortal Kombat 1 (Code in Box) - Nintendo Switch').flags).toEqual(['code-in-box']);
    expect(read('Minecraft - Nintendo Switch [Digital Code]').flags).toEqual(['digital']);
  });

  it('takes the console from the page when the title names none', () => {
    expect(read('Donkey Kong Bananza', 'Nintendo Switch 2')).toMatchObject({ title: 'Donkey Kong Bananza', platformKey: 'nintendo-switch-2', platformFrom: 'hint' });
    expect(read('Donkey Kong Bananza', 'NS2').platformKey).toBe('nintendo-switch-2');
    expect(read('Donkey Kong Bananza')).toMatchObject({ platformKey: null, platformFrom: null });
    expect(read('Mario Kart 8 Deluxe - Nintendo Switch', 'PlayStation 5')).toMatchObject({ platformKey: 'nintendo-switch', platformFrom: 'title' });
  });
});

describe('numbersDiffer', () => {
  it('tells another numbered game from an edition', () => {
    expect(numbersDiffer('WWE 2K26', 'WWE 2K25 [Code In Box]')).toBe(true);
    expect(numbersDiffer('Final Fantasy VII', 'Final Fantasy VIII')).toBe(true);
    expect(numbersDiffer('Halo 3', 'Halo 3 [Limited Edition]')).toBe(false);
    expect(numbersDiffer('Sonic Generations', 'Sonic X Shadow Generations')).toBe(false);
  });
});

describe('surenessOf', () => {
  const base = { sureAt: 0.95, unsureAt: 0.75, consoleKnown: true };
  it('is sure of an exact match and of a game with no near misses', () => {
    expect(surenessOf({ ...base, owned: true, confidence: 1, nearMiss: null })).toBe('sure');
    expect(surenessOf({ ...base, owned: false, confidence: null, nearMiss: null })).toBe('sure');
  });
  it('is less sure of an edition, a close name, or without a console', () => {
    expect(surenessOf({ ...base, owned: true, confidence: 0.9, nearMiss: null })).toBe('likely');
    expect(surenessOf({ ...base, owned: false, confidence: null, nearMiss: 0.65 })).toBe('likely');
    expect(surenessOf({ ...base, owned: false, confidence: null, nearMiss: 0.8 })).toBe('unsure');
    expect(surenessOf({ ...base, owned: true, confidence: 1, nearMiss: null, consoleKnown: false })).toBe('likely');
  });
});

describe('listingKind', () => {
  const kinds = (titles: string[]) => titles.map((t) => [t, listingKind(t)]);
  const all = (titles: string[], kind: 'not-game' | 'lot' | null) => expect(kinds(titles)).toEqual(titles.map((t) => [t, kind]));

  it("reads a store page's own furniture as not a game", () => {
    all(['Sustainability features', 'Global Recycled Standard', 'GreenCircle Certified: Certified Environmental Facts Label', 'The Forest Stewardship Council'], 'not-game');
  });

  it('reads merchandise, gift cards, board games, tools and batteries as not a game', () => {
    all(
      [
        'Funko POP! Games: Silent Hill James Sunderland 4-in Vinyl Figure',
        'Funko Bitty POP! Sonic the Hedgehog 0.9-in Vinyl Figure Set 4-Pack',
        'Jakks Pacific The Super Mario Bros. Movie Donkey Kong Stadium Playset',
        'NECA Fortnite Halloween Michael Myers 7-in Scale Action Figure',
        'Squishmallows Sonic the Hedgehog Knuckles 8-in Little Plush',
        'Super Smash Bros. Donkey Kong amiibo',
        'SILENT HILL: Townfall 30oz Tumbler GameStop',
        'Nintendo eShop Physical Gift Card',
        '$50 Nintendo eShop Gift',
        'Roblox Digital Gift Card - 3,000 Robux',
        'Marriott eGift',
        'NEW Zombicide White Death Board Game Sealed CMON',
        'Zombicide White Death Avalanche Kickstarter Bundle',
        'Roblox Fisch Trading Card Booster Pack (Styles May Vary)',
        'Wera Tool-Check PLUS Imperial 1, 39-Pc Bit & Socket Set, Compact Case',
        'HW Double A Lithium Batteries Rechargeable 8-Pack, 1.5V 3600mWh USB-C',
        'APC Back-UPS Pro 1500VA UPS Battery Backup and Surge Protector',
        'CyberPower CP1500PFCLCD PFC Sinewave UPS System, 1500VA/1000W',
        'Disney Infinity 3.0 Edition Power Discs Series 1',
        'Diablo 4 Boosting - Leveling 1-60 Fast',
        'Switch 2 Pro Controller Accessories Bundle for Nintendo Switch 2',
      ],
      'not-game',
    );
  });

  it('reads controllers, guides, magazines, cases and adapters as not a game', () => {
    all(
      [
        'Sony DualSense Wireless Controller',
        'RedOctane Wireless Guitar Controller',
        'Guitar Hero World Tour Wireless Drum Kit Controller Xbox 360 No Pedal AS IS',
        'Battery Cover for Guitar Hero Xbox 360 PS3 Red Octane Sunburst (95451.805 95893)',
        'Official Guitar Hero Rechargeable Battery Kit RedOctane Xbox 360 PS3 PS2 Boxed',
        'Xbox 360 Guitar Hero Xplorer Guitar CARRYING CASE ONLY Black Bag w/ Strap',
        'MotionPlus Adapter (Styles May Vary)',
        'KontrolFreek FPS Precision Aim Thumbstick',
        'KontrolFreek Aim Boost Kit for PlayStation 5 and PlayStation 4 - Inferno Edition',
        "The Legend of Zelda: Tears of the Kingdom Collector's Edition Guide",
        'Halo 3 Official Strategy Guide Prima Games',
        'Game Informer Magazine Issue 300',
        'Nintendo Power Volume 1 Super Mario Bros 2',
        'Hard Case for Nintendo Switch 2',
      ],
      'not-game',
    );
  });

  it('reads lots and console bundles as a lot', () => {
    all(
      [
        'Guitar Hero Lot of 3 - Xbox 360 World Tour, Aerosmith, Legends of Rock',
        'Guitar Hero 5-Game Lot Xbox 360 II III Aerosmith World Tour 5 + Stickers',
        'Xbox 360 Games Bulk',
        'Nintendo Switch 2: Choose Your Game Bundle',
        'Nintendo Switch 2 Mario Kart World Bundle',
        'Nintendo Switch 2 Gaming Console with Donkey Kong Bananza Bundle',
        "Nintendo Switch Lite - Animal Crossing: New Horizons Bundle - Isabelle's Aloha Edition",
        'Slim Console Digital Edition - Fortnite Flowering Chaos Bundle',
        'Xbox 360 S 4GB Guitar Hero Bundle, Gibson, 5 Smash World Tour Metallica',
      ],
      'lot',
    );
  });

  it('keeps real games, a game sold with its DLC, and games named for an accessory word', () => {
    all(
      [
        'Donkey Kong Bananza Bundle (game + DK Island & Emerald Rush DLC) Standard - Nintendo Switch 2 [Digital Code]',
        'Donkey Kong Bananza Bundle: DK Island & Emerald Rush - Nintendo Switch 2 [Digital]',
        'Call of Duty: Modern Warfare II Cross-Gen Bundle - Xbox One and Xbox Series X/S',
        'Hello Kitty Island Adventure Switch 2 Edition: Friendship Bundle - Nintendo Switch 2',
        'Paw Patrol Dino World- Amazon Exclusive Poster - Nintendo Switch',
        'Bayonetta & Vanquish 10th Anniversary Bundle - PS4',
        'Turok Trilogy Bundle',
        'Guitar Hero Live [Bundle] Xbox One',
        'Star Fox Zero & Star Fox Guard Bundle - Wii U',
        'Animal Crossing: amiibo Festival - Wii U',
        'Funko Fusion - PS5',
        'Zombicide: Tactics & Shotguns - PC',
        'Disney Infinity 2.0 Edition - Wii U',
        'Mystery Case Files: MillionHeir - Nintendo DS',
        'The Silver Case - PS4',
        'A Guidebook Of Babel',
        'A-Train: All Aboard! Tourism [Guidebook Pack] - Nintendo Switch',
        'The Surge - PS4',
        'Pure - PS3',
        'Strategy-free: Halo 3 Xbox 360 Complete CIB Tested',
        'Sonic Classic Collection 2 Games in 1 - Nintendo DS',
        'Nintendo Switch Sports - Nintendo Switch',
        'Super Mario Maker [Book Bundle] - Wii U',
        'Halo 3 Xbox 360 Games',
      ],
      null,
    );
  });
});

describe("readListing: the listing's own console wins", () => {
  it("reads psvita over the page's PS3", () => {
    expect(read('amnesia world psvita', 'playstation-3')).toMatchObject({ platformKey: 'playstation-vita' });
  });
});
