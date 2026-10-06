import { describe, expect, it } from 'vitest';
import { latinTitle, matchKey, normalizeTitle, romajiKey, slugify } from './text.js';

describe('normalizeTitle', () => {
  it('ignores case, accents, apostrophes and punctuation', () => {
    expect(normalizeTitle("Tom Clancy's H.A.W.X")).toBe('tom clancys h a w x');
    expect(normalizeTitle('Pokémon: Let’s Go, Pikachu!')).toBe('pokemon lets go pikachu');
  });

  it('reads & as "and"', () => {
    expect(normalizeTitle('Ratchet & Clank')).toBe(normalizeTitle('Ratchet and Clank'));
  });

  it('keeps different titles different (no fuzzy matching)', () => {
    expect(normalizeTitle('Cars 2')).not.toBe(normalizeTitle('Cars 2: The Video Game'));
    expect(normalizeTitle('Rise Of Argonauts')).not.toBe(normalizeTitle('Rise of the Argonauts'));
  });
});

describe('latinTitle', () => {
  it('tells titles in the Latin alphabet from titles in other scripts', () => {
    expect(latinTitle('Pokémon: Let’s Go, Pikachu!')).toBe(true);
    expect(latinTitle('The Sims™ 3')).toBe(true);
    expect(latinTitle('ＵＮ Squadron Ⅱ')).toBe(true);
    expect(latinTitle('デッドオアアライブ2')).toBe(false);
    expect(latinTitle('Sankyo Fever! フィーバー！')).toBe(false);
    expect(latinTitle('幻想水滸伝II')).toBe(false);
  });
});

describe('slugify', () => {
  it('makes URL keys', () => {
    expect(slugify('Nintendo Switch 2')).toBe('nintendo-switch-2');
    expect(slugify('Game & Watch')).toBe('game-and-watch');
  });
});

describe('matchKey', () => {
  const same = (a: string, b: string) => expect(matchKey(a), `${a} / ${b}`).toBe(matchKey(b));
  const different = (a: string, b: string) => expect(matchKey(a), `${a} / ${b}`).not.toBe(matchKey(b));

  it('treats the same game written differently as one title', () => {
    same('The Elder Scrolls V: Skyrim', 'Elder Scrolls V: Skyrim');
    same('Tomb Raider Trilogy (The)', 'Tomb Raider Trilogy');
    same('Spider-Man 3', 'Spiderman 3');
    same('Soulcalibur IV', 'Soul Calibur IV');
    same('Dragon Age 2', 'Dragon Age II');
    same('Unreal Tournament 3', 'Unreal Tournament III');
    same('Harry Potter and the Deathly Hallows: Part I', 'Harry Potter and the Deathly Hallows: Part 1');
    same('The Legend of Heroes: Trails of Cold Steel 2', 'Legend of Heroes: Trails of Cold Steel II');
    same('NASCAR 2014', 'NASCAR 14');
    same('NFL Head Coach 09', 'NFL Head Coach 2009');
    same('Warhammer 40,000: Space Marine', 'Warhammer 40000: Space Marine');
    same("Tony Hawk's Project 8", 'Tony Hawk Project 8');
    same('Rock Band 2', 'Rock Band 2 (game only)');
    same("Tom Clancy's Rainbow Six: Vegas", 'Rainbow Six Vegas');
    same('Grand Theft Auto V', 'Grand Theft Auto 5');
    // PriceCharting's Zelda titles leave out "The Legend of" (D44).
    same('The Legend of Zelda: Twilight Princess', 'Zelda Twilight Princess');
    same('The Legend of Zelda: Ocarina of Time 3D', 'Zelda Ocarina of Time 3D');
    same('The Legend of Zelda', 'Legend of Zelda');
    same('The Legend of Zelda: The Minish Cap', 'Zelda Minish Cap');
    same('The Legend of Zelda: A Link to the Past', 'Zelda Link to the Past');
    same('Zelda: The Wand of Gamelon', 'Zelda Wand of Gamelon');
    same('Zelda II: The Adventure of Link', 'Zelda II The Adventure of Link');
  });

  it('keeps different games apart', () => {
    different('Mega Man X', 'Mega Man 10');
    different('Tekken 3', 'Tekken 3D');
    different('Dragon Age 2', 'Dragon Age 3');
    different('Final Fantasy XIII', 'Final Fantasy XIII-2');
    different('Just Dance 3', 'Just Dance 4');
    different('The Last of Us', 'The Last of Us Part II');
    different('Street Fighter X Tekken', 'Street Fighter 10 Tekken');
    different('The Legend of Zelda', 'Zelda');
    different('Zelda II: The Adventure of Link', 'The Legend of Zelda');
  });
});

describe('romajiKey', () => {
  it('reads Japanese titles romanized differently as one', () => {
    expect(romajiKey('Jikkyou Powerful Pro Yakyuu 3')).toBe(romajiKey('Jikkyō Powerful Pro Yakyū 3'));
    expect(romajiKey('Chou Makaimura')).toBe(romajiKey('Cho Makaimura'));
    expect(romajiKey('Super Oozumou')).toBe(romajiKey('Super Ōzumō'));
    expect(romajiKey('Gambare Goemon')).toBe(romajiKey('Ganbare Goemon'));
    expect(romajiKey('Arashi wo Yobu Enji')).toBe(romajiKey('Arashi o Yobu Enji'));
    expect(romajiKey('Nintama Rantaro')).toBe(romajiKey('Nintama Rantarou'));
  });

  it('keeps numbers and other words apart', () => {
    expect(romajiKey('Jikkyou Powerful Pro Yakyuu 2')).not.toBe(romajiKey('Jikkyō Powerful Pro Yakyū 3'));
    expect(romajiKey('Super Kokou Yakyuu')).not.toBe(romajiKey('Super Kyousouba'));
  });
});
