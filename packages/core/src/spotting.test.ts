import { describe, expect, it } from 'vitest';
import type { PageWord } from './magazines.js';
import { scoresOn, spotTitles } from './spotting.js';

/** Words in a row, each 10 pixels tall unless given ("Super:30" is 30 tall). */
function line(text: string, y = 100): PageWord[] {
  let x = 0;
  return text.split(' ').map((t) => {
    const [word, h] = t.split(':') as [string, string | undefined];
    const height = Number(h ?? 10);
    const w: PageWord = { text: word, box: [x, y, x + word.length * 8, y + height] };
    x += word.length * 8 + 6;
    return w;
  });
}

describe('the games on a magazine page (D192)', () => {
  const candidates = [
    { platformKey: 'super-nintendo', title: 'Super Metroid', day: '1994-04-18' },
    { platformKey: 'super-nintendo', title: 'The Legend of Zelda: A Link to the Past', day: '1992-04-13' },
    { platformKey: 'nintendo-entertainment-system', title: 'Metroid', day: '1987-08-15' },
    { platformKey: 'sega-genesis', title: 'Rampage', day: '1988-01-01' },
    { platformKey: 'arcade', title: 'Super Metroid', day: '2010-01-01' },
  ];
  it('finds titles as runs of words, the longest winning, with their boxes', () => {
    const words = [...line('This month Super Metroid blasts onto the scene'), ...line('a rampage of action and A Link to the Past fans', 120)];
    const all = spotTitles(words, candidates, '1994-06-01');
    // "rampage" in small type is a word, not the game: too unsure to ask about.
    expect(all.find((f) => f.title === 'Rampage')!.confidence).toBeLessThan(0.6);
    const found = all.filter((f) => f.confidence >= 0.6);
    expect(found.map((f) => [f.platformKey, f.title, f.printed])).toEqual([
      ['super-nintendo', 'Super Metroid', 'Super Metroid'],
      ['super-nintendo', 'The Legend of Zelda: A Link to the Past', 'A Link to the Past'],
    ]);
    // Two words: likely; the subtitle alone, less so.
    expect(found[0]!.confidence).toBeCloseTo(0.78);
    expect(found[1]!.confidence).toBeCloseTo(0.63);
    expect(found[0]!.box).toEqual([84, 100, 186, 110]);
  });
  it('counts a heading, and a title named again', () => {
    const words = [...line('Super:30 Metroid:30'), ...line('In Super Metroid you play Samus', 140), ...line('RAMPAGE:30', 200)];
    const found = spotTitles(words, candidates, '1994-06-01');
    expect(found.find((f) => f.title === 'Super Metroid')!.confidence).toBeCloseTo(0.96);
    expect(found.find((f) => f.title === 'Rampage')!.confidence).toBeCloseTo(0.72);
  });
  it("is surer of a whole long title or a numbered one, less of a series' name or the start of a longer title", () => {
    const more = [
      { platformKey: 'playstation-2', title: 'Medal of Honor: Rising Sun', day: '2003-11-11' },
      { platformKey: 'playstation-2', title: 'Suikoden IV', day: '2004-08-19' },
      { platformKey: 'nintendo-entertainment-system', title: 'Final Fantasy', day: '1990-05-01' },
      { platformKey: 'super-nintendo', title: 'Final Fantasy VI', day: '1994-04-02' },
      { platformKey: 'playstation-2', title: 'Ridge Racer', day: '2004-01-01' },
    ];
    const conf = (text: string) => Object.fromEntries(spotTitles(line(text), more, '2004-06-01').map((f) => [f.title, f.confidence]));
    expect(conf('We loved Medal of Honor Rising Sun a lot')).toEqual({ 'Medal of Honor: Rising Sun': 0.9 });
    expect(conf('then Suikoden IV arrives')).toEqual({ 'Suikoden IV': 0.83 });
    // A series' name: unsure. The same words going on into a longer title (Ridge Racer V): less sure again.
    expect(conf('every Final Fantasy fan')).toEqual({ 'Final Fantasy': 0.63 });
    expect(conf('Ridge Racer V is here')).toEqual({ 'Ridge Racer': 0.63 });
  });
  it("reads EGM's Review Crew and Nintendo Power's ratings", () => {
    expect(scoresOn('SUPER METROID Ed 9.0 9.0 9.5 9.0 Danyon', 'Electronic Gaming Monthly')).toBe('9.0 / 9.0 / 9.5 / 9.0');
    expect(scoresOn('Page 28 of 1994 issue 59', 'Electronic Gaming Monthly')).toBeNull();
    expect(scoresOn('POWER METER G 4.5 P 4.0 C 3.5 T 4.5', 'Nintendo Power')).toBe('G 4.5 · P 4.0 · C 3.5 · T 4.5');
  });
});
