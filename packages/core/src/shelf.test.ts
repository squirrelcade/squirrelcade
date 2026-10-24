import { describe, expect, it } from 'vitest';
import { matchShelf, ShelfMatcher, shelfReadKey, withoutEdition } from './shelf.js';

const GAMES = [
  "Assassin's Creed II",
  "Assassin's Creed III",
  'Uncharted: Drake’s Fortune',
  'Uncharted 2: Among Thieves',
  'Uncharted 3: Drake’s Deception',
  'Darksiders',
  'Darksiders II',
  'Remember Me',
  'Nintendo Switch Sports',
  'Kirby and the Forgotten Land - Nintendo Switch 2 Edition + Star-Crossed World',
  'EA SPORTS Madden NFL 26',
  'Disco Elysium - The Final Cut',
  "Sid Meier's Civilization VII",
  'Halo 3',
].map((title, i) => ({ key: String(i), title }));

const read = (text: string, model = false) => ({ text, score: 0.9, ...(model ? { model } : {}) });
const one = (text: string, model = false) => matchShelf([read(text, model)], GAMES);
const sureOf = (text: string, model = false) => one(text, model).sure.map((m) => m.title);

describe('matchShelf', () => {
  it('ignores spaces and forgives small slips', () => {
    expect(sureOf('ASSASINS CREED III')).toEqual(["Assassin's Creed III"]);
    expect(sureOf('DISCO ELYSIUM-THE FINALCUT')).toEqual(['Disco Elysium - The Final Cut']);
    expect(sureOf('SIDMEIER\'SCIVILIZATIONVII')).toEqual(["Sid Meier's Civilization VII"]);
  });

  it('never forgives a number', () => {
    // III is never II, and II could be III with its last I cut off: unsure (a model reads the whole spine).
    expect(sureOf('ASSASSINSCREEDIII')).toEqual(["Assassin's Creed III"]);
    expect(one('ASSASSINSCREEDII').unsure[0]).toMatchObject({ title: "Assassin's Creed II", doubt: 'cut-off', other: "Assassin's Creed III" });
    expect(sureOf('ASSASSINSCREEDII', true)).toEqual(["Assassin's Creed II"]);
    expect(sureOf('HALO 2')).toEqual([]);
    const r = one('UNCHARTED 4');
    expect(r.sure).toEqual([]);
  });

  it('finds titles as spines print them: without the console edition, the brand or the edition', () => {
    expect(sureOf('KIRBY AND THE FORGOTTEN LAND')).toEqual(['Kirby and the Forgotten Land - Nintendo Switch 2 Edition + Star-Crossed World']);
    expect(sureOf('MADDEN NFL 26')).toEqual(['EA SPORTS Madden NFL 26']);
    expect(sureOf('REMEMBER ME DELUXE EDITION')).toEqual(['Remember Me']);
  });

  it('takes the start of one title, but not a brand alone', () => {
    expect(sureOf('REMEMBER')).toEqual(['Remember Me']);
    expect(one('NINTENDO').sure).toEqual([]);
  });

  it('keeps a read that could be the cut-off start of another game unsure', () => {
    const r = one('DARKSIDERS');
    expect(r.sure).toEqual([]);
    expect(r.unsure[0]).toMatchObject({ title: 'Darksiders', doubt: 'cut-off', other: 'Darksiders II' });
    // A vision model reads whole spines, so its read isn't doubted that way.
    expect(sureOf('DARKSIDERS', true)).toEqual(['Darksiders']);
  });

  it('leaves out weak and short reads, and counts each game once', () => {
    expect(matchShelf([{ text: 'REMEMBER ME', score: 0.3 }], GAMES).reads).toBe(0);
    expect(matchShelf([read('ABC')], GAMES).reads).toBe(0);
    const r = matchShelf([read('HALO 3'), read('HAL0 3'), read('HALO3')], GAMES);
    expect(r.sure.map((m) => m.title)).toEqual(['Halo 3']);
    expect(r.reads).toBe(3);
  });

  it('reuses one list for several photos', () => {
    const m = new ShelfMatcher(GAMES);
    expect(m.match([read('REMEMBER ME')]).sure).toHaveLength(1);
    expect(m.match([read('UNCHARTED 2 AMONG THIEVES')]).sure.map((x) => x.key)).toEqual(['3']);
  });

  it('takes a remembered fix over matching: a read you said is a game, or not a game', () => {
    const m = new ShelfMatcher(GAMES);
    // "UNCHARTED" alone is unsure; fixed, it is the game you said, whatever the spacing of the next read.
    expect(m.match([read('UNCHARTED')]).sure).toEqual([]);
    const fixes = new Map<string, string | null>([[shelfReadKey('UNCHARTED'), 'Uncharted 2: Among Thieves'], [shelfReadKey('HALO 3'), null]]);
    const r = m.match([read('Un charted'), read('HALO 3')], fixes);
    expect(r.sure).toEqual([{ key: '3', title: 'Uncharted 2: Among Thieves', read: 'Un charted', likeness: 1, fixed: true }]);
    expect(r.unsure).toEqual([]);
    // A key is its own key (a phone sends a fix it kept by its key).
    for (const t of ['HALO 3', 'll3 Iio1', 'UNCHARTED']) expect(shelfReadKey(shelfReadKey(t))).toBe(shelfReadKey(t));
    // A fix to a game not on the list is left out: the read is matched as usual.
    expect(m.match([read('REMEMBER ME')], new Map([[shelfReadKey('REMEMBER ME'), 'Not On This Console']])).sure.map((x) => x.title)).toEqual(['Remember Me']);
  });
});

describe('withoutEdition', () => {
  it('drops an edition at the end', () => {
    expect(withoutEdition('Snoopy & the Great Mystery Club Deluxe Edition')).toBe('Snoopy & the Great Mystery Club');
    expect(withoutEdition('Persona 5 Royal')).toBe('Persona 5 Royal');
    expect(withoutEdition('Kingdom Come: Deliverance - Royal Edition')).toBe('Kingdom Come: Deliverance');
  });
});
