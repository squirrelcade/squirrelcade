import { describe, expect, it } from 'vitest';
import { collectionNameMatches, waysToPlayText } from './waysToPlay.js';

describe('a copy as one of IGDB\'s collections (1.5.1)', () => {
  it('matches a collection whose words the copy has, adding only package words', () => {
    expect(collectionNameMatches('Final Fantasy I-VI Collection Pixel Remaster', ['Final Fantasy: Pixel Remaster Collection', 'Final Fantasy I-VI Bundle'])).toBe(true);
    expect(collectionNameMatches('Mega Man Legacy Collection 1 + 2', ['Mega Man Legacy Collection 1 + 2'])).toBe(true);
    expect(collectionNameMatches('Megaman Legacy Collection', ['Mega Man Legacy Collection', 'Megaman Legacy Collection'])).toBe(true);
  });
  it('keeps other collections apart', () => {
    expect(collectionNameMatches('Mega Man X Legacy Collection', ['Mega Man Legacy Collection'])).toBe(false);
    expect(collectionNameMatches('Mega Man Legacy Collection 2', ['Mega Man Legacy Collection'])).toBe(false);
    expect(collectionNameMatches('Mega Man Legacy Collection', ['Mega Man Legacy Collection 2'])).toBe(false);
    expect(collectionNameMatches('Castlevania Anniversary Collection', ['Contra Anniversary Collection'])).toBe(false);
    // A name of one real word says too little.
    expect(collectionNameMatches('Tetris Collection', ['Tetris'])).toBe(false);
  });
  it('says the ways in words', () => {
    expect(waysToPlayText([{ kind: 'remaster', title: 'Final Fantasy VI', on: ['Nintendo Switch', 'PC (Steam)'] }])).toBe('You can play it as the remaster Final Fantasy VI (Nintendo Switch, PC (Steam))');
  });
});
