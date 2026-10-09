import { describe, expect, it } from 'vitest';
import { barcodeForms, cleanProductTitle, normalizeBarcode, productNameWords, productPlatform, searchRank, wordOverlap } from './lookup.js';
import { priceChartingBarcodeUrl } from './shops.js';

describe('cleanProductTitle', () => {
  it('drops platform names and packaging words from retail product names', () => {
    expect(cleanProductTitle("Uncharted 3: Drake's Deception - PlayStation 3")).toBe('uncharted 3 drakes deception');
    expect(cleanProductTitle('Splatoon 3 (Nintendo Switch)')).toBe('splatoon 3');
    expect(cleanProductTitle('Halo 3 Xbox 360 Video Game')).toBe('halo 3');
    expect(cleanProductTitle('Mario Kart 8 Deluxe for Nintendo Switch')).toBe('mario kart 8 deluxe');
    expect(cleanProductTitle('Persona 5 Royal PS4 [Brand New]')).toBe('persona 5 royal');
  });

  it('drops an edition written after the title, reprint lines and a used copy\'s words', () => {
    // The user's scan (2026-09-28): the edition kept "deluxe" in the search, and nothing matched.
    expect(cleanProductTitle('Mafia III Deluxe Edition (Xbox One)')).toBe('mafia iii');
    expect(cleanProductTitle('Destiny: The Taken King Legendary Edition')).toBe('destiny the taken king');
    expect(cleanProductTitle('God of War III Greatest Hits PS3')).toBe('god of war iii');
    expect(cleanProductTitle('Pre-Owned Super Mario Galaxy Nintendo Selects Wii')).toBe('super mario galaxy');
    // A game called Deluxe keeps its name.
    expect(cleanProductTitle('Mario Kart 8 Deluxe - Nintendo Switch')).toBe('mario kart 8 deluxe');
  });
});

describe('productNameWords and productPlatform', () => {
  it("gives a product name's words for finding the title inside it, and the console it names", () => {
    expect(productNameWords("Microsoft Halo 5: Guardians - Xbox One [Refurbished]")).toEqual(['Microsoft', 'Halo', '5', 'Guardians', 'Xbox', 'One']);
    expect(productNameWords("Sony Uncharted 4 A Thief's End, Marvel's Spider-Man (PS4)")).toEqual(['Sony', 'Uncharted', '4', 'A', "Thief's", 'End', "Marvel's", 'Spider', 'Man']);
    expect(productPlatform('Mafia III Deluxe Edition (Xbox One)')).toBe('xbox-one');
    expect(productPlatform('Xenoblade Chronicles - Nintendo Wii')).toBe('wii');
    expect(productPlatform('The Last of Us Remastered PS4')).toBe('playstation-4');
    expect(productPlatform('Some Board Game')).toBeNull();
    // How much a name and a title share, leaving out words like "the" and "edition".
    expect(wordOverlap('Sony Uncharted 4 A Thiefs End', "Uncharted 4: A Thief's End")).toBeCloseTo(0.89, 2);
    expect(wordOverlap('destiny the taken king', 'Destiny: Taken King Legendary Edition')).toBeCloseTo(0.86, 2);
    expect(wordOverlap('destiny the taken king', 'Destiny')).toBe(0.5);
    expect(wordOverlap('uncharted 4', 'Uncharted 3')).toBe(0.5);
    expect(wordOverlap('the', 'The Game')).toBe(0);
  });
});

describe('searchRank', () => {
  it('prefers exact titles, then titles starting with the query, then all words', () => {
    expect(searchRank('Halo 3', 'halo 3')).toBe(3);
    expect(searchRank('Halo 3: ODST', 'halo 3')).toBe(2);
    expect(searchRank("Tom Clancy's H.A.W.X", 'hawx clancy')).toBe(0);
    expect(searchRank('Final Fantasy XIII-2', 'fantasy xiii')).toBe(1);
    expect(searchRank('Zelda', '')).toBe(0);
  });
});

describe('searchRank with numbers written either way', () => {
  it('finds a Roman numeral typed as a number, and a number typed as one', () => {
    expect(searchRank('Mafia II', 'mafia 2')).toBe(3);
    expect(searchRank('Mafia II: Definitive Edition', 'mafia 2')).toBe(2);
    expect(searchRank('Final Fantasy VII Remake', 'final fantasy 7')).toBe(2);
    expect(searchRank('Final Fantasy 7', 'final fantasy vii')).toBe(3);
    expect(searchRank('Mafia III', 'mafia 2')).toBe(0);
    // A lone X stays a letter: Mega Man X isn't Mega Man 10.
    expect(searchRank('Mega Man X', 'mega man 10')).toBe(0);
  });
});

describe('searchRank with Japanese titles', () => {
  it('finds a title typed with its long vowels written out, or not', () => {
    expect(searchRank('Jikkyō Powerful Pro Yakyū 3', 'Jikkyou Powerful Pro Yakyuu 3')).toBe(3);
    expect(searchRank('Super Kōkō Yakyū: Ichikyuu Jikkon', 'super kokou yakyuu')).toBe(2);
    expect(searchRank('Jikkyō Powerful Pro Yakyū 3', 'Jikkyou Powerful Pro Yakyuu 2')).toBe(0);
  });
});

describe('normalizeBarcode', () => {
  it('accepts UPC and EAN digits and ignores spaces', () => {
    expect(normalizeBarcode('0 45496 59003 6')).toBe('045496590036');
    expect(normalizeBarcode('4902370537338')).toBe('4902370537338');
    expect(normalizeBarcode('123')).toBeNull();
  });

  it('keeps one form of a UPC however the camera reads it, and knows the forms saved before', () => {
    // A UPC-A read as an EAN-13 (a zero in front), or as a GTIN-14.
    expect(normalizeBarcode('0710425498114')).toBe('710425498114');
    expect(normalizeBarcode('00710425498114')).toBe('710425498114');
    expect(normalizeBarcode('710425498114')).toBe('710425498114');
    // A real EAN-13 (a Japanese game) and an EAN-8 stay as they are.
    expect(normalizeBarcode('4902370537338')).toBe('4902370537338');
    expect(normalizeBarcode('96385074')).toBe('96385074');
    expect(barcodeForms('0710425498114')).toEqual(['710425498114', '0710425498114', '00710425498114']);
    expect(barcodeForms('4902370537338')).toEqual(['4902370537338', '04902370537338']);
    expect(barcodeForms('12')).toEqual([]);
    expect(priceChartingBarcodeUrl('0 71042 54981 14')).toBe('https://www.pricecharting.com/search-products?type=prices&q=071042549811' + '4');
  });
});
