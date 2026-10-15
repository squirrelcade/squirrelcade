import { describe, expect, it } from 'vitest';
import { labelAddress, placeOfLabel } from './places';

describe("places' labels", () => {
  it('names the place in a label and reads it back, whatever its characters', () => {
    for (const place of ['Bag 7', 'Black case #7', 'Étagère & co / 2', 'the office shelf?']) {
      const address = labelAddress(place, 'https://squirrelcade.example.com/');
      expect(address.startsWith('https://squirrelcade.example.com/store/pack?place=')).toBe(true);
      expect(placeOfLabel(address)).toBe(place);
    }
    // Squirrelcade under a path of its own, and a label printed from another address, still name their place.
    expect(placeOfLabel('http://192.0.2.10:7575/store/pack?place=Bag%2010')).toBe('Bag 10');
    expect(placeOfLabel(' https://example.com/apps/sc/store/pack/?place=%20Bag%20%2011%20 ')).toBe('Bag 11');
  });

  it('takes no other code for a label', () => {
    for (const text of ['012345678905', 'Bag 7', 'https://example.com/store?place=Bag%207', 'https://example.com/store/pack', 'https://example.com/store/pack?place=%20', 'not a url']) {
      expect(placeOfLabel(text)).toBeNull();
    }
    expect(placeOfLabel(`https://example.com/store/pack?place=${'x'.repeat(100)}`)).toHaveLength(80);
  });
});
