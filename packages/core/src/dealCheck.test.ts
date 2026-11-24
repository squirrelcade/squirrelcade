import { describe, expect, it } from 'vitest';
import { numbersDiffer, readListing, surenessOf } from './dealCheck.js';
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
