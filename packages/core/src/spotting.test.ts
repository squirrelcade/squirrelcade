import { describe, expect, it } from 'vitest';
import type { PageWord } from './magazines.js';
import { scoresOn, spotContext, spotIndex, spotIssue, spotTitles, spotWindow, type SpotCandidate, type SpotPage } from './spotting.js';

/** Words in a row, each 10 pixels tall unless given ("Super:30" is 30 tall). */
function line(text: string, y = 100): PageWord[] {
  let x = 0;
  return text.split(' ').map((t) => {
    const cut = /:(\d+)$/.exec(t);
    const word = cut ? t.slice(0, cut.index) : t;
    const height = Number(cut?.[1] ?? 10);
    const w: PageWord = { text: word, box: [x, y, x + word.length * 8, y + height] };
    x += word.length * 8 + 6;
    return w;
  });
}

const game = (title: string, platformKey = 'playstation-2', day = '2004-01-01', names?: string[]): SpotCandidate => ({ platformKey, title, day, ...(names ? { names } : {}) });

/** What a line of text finds among some games: each title's confidence. */
const conf = (text: string, games: SpotCandidate[], context?: string) =>
  Object.fromEntries(spotTitles(line(text), games, '2004-06-01', context === undefined ? undefined : spotContext([line(context)])).map((f) => [f.title, f.confidence]));

describe('the games on a magazine page (D192, D242)', () => {
  const candidates = [
    game('Super Metroid', 'super-nintendo', '1994-04-18'),
    game('The Legend of Zelda: A Link to the Past', 'super-nintendo', '1992-04-13'),
    game('Metroid', 'nintendo-entertainment-system', '1987-08-15'),
    game('Rampage', 'sega-genesis', '1988-01-01'),
    game('Super Metroid', 'arcade', '2010-01-01'),
  ];
  it('finds titles as runs of words, the longest winning, with their boxes', () => {
    const words = [...line('This month Super Metroid blasts onto the scene'), ...line('a rampage of action and A Link to the Past fans', 120)];
    const all = spotTitles(words, candidates, '1994-06-01');
    // "rampage" written small is a word, not the game: too unsure to ask about.
    expect(all.find((f) => f.title === 'Rampage')!.confidence).toBeLessThan(0.6);
    const found = all.filter((f) => f.confidence >= 0.6);
    // Between consoles with the same title, the one whose release is nearest the cover's date.
    expect(found.map((f) => [f.platformKey, f.title, f.printed])).toEqual([
      ['super-nintendo', 'Super Metroid', 'Super Metroid'],
      ['super-nintendo', 'The Legend of Zelda: A Link to the Past', 'A Link to the Past'],
    ]);
    // Two words written as a title: sure; the subtitle alone, less so.
    expect(found[0]!.confidence).toBeCloseTo(0.86);
    expect(found[0]!.evidence).toMatchObject({ as: 'title', words: 2, times: 1, caps: true, big: false });
    expect(found[1]!.confidence).toBeCloseTo(0.71);
    expect(found[1]!.evidence.as).toBe('subtitle');
    expect(found[0]!.box).toEqual([84, 100, 186, 110]);
  });
  it("makes a big magazine's 20,000 candidates ready once, and a page then takes milliseconds (It stays snappy)", () => {
    const many = Array.from({ length: 20_000 }, (_, i) => game(`Game ${Math.floor(i / 4)}${i % 4 ? ` Part ${i % 4}` : ''}`));
    const t0 = performance.now();
    const index = spotIndex([...many, ...candidates], '1994-06-01');
    const page = Array.from({ length: 60 }, (_, k) => line('Super Metroid blasts onto the scene with Game 12 Part 2 and more', 100 + k * 20)).flat();
    const t1 = performance.now();
    for (let p = 0; p < 20; p++) spotTitles(page, index, '1994-06-01');
    const t2 = performance.now();
    expect(t1 - t0).toBeLessThan(1500);
    expect((t2 - t1) / 20).toBeLessThan(150);
    // "Game 12" begins "Game 12 Part 1": a series' name, found surer as the longer title.
    expect(spotTitles(page, index, '1994-06-01').find((f) => f.title === 'Game 12 Part 2')).toBeTruthy();
    expect(index.startsOthers.has('game 12')).toBe(true);
    expect(index.startsOthers.has('game 12 part 2')).toBe(false);
  });
  it('counts a heading, and a title named again', () => {
    const words = [...line('Super:30 Metroid:30'), ...line('In Super Metroid you play Samus', 140)];
    const found = spotTitles(words, candidates, '1994-06-01');
    expect(found.find((f) => f.title === 'Super Metroid')!.confidence).toBe(1);
    expect(found.find((f) => f.title === 'Super Metroid')!.evidence).toMatchObject({ times: 2, big: true });
    // Its box is where the page names it most surely: the heading.
    expect(found.find((f) => f.title === 'Super Metroid')!.box).toEqual([0, 100, 102, 130]);
  });
  it("is surer of a whole long title or a numbered one, less of a series' name or the start of a longer title", () => {
    const more = [game('Medal of Honor: Rising Sun'), game('Suikoden IV'), game('Final Fantasy', 'nintendo-entertainment-system', '1990-05-01'), game('Final Fantasy VI', 'super-nintendo', '1994-04-02'), game('Ridge Racer')];
    expect(conf('We loved Medal of Honor Rising Sun a lot', more)).toEqual({ 'Medal of Honor: Rising Sun': 0.9 });
    expect(conf('then Suikoden IV arrives', more)).toEqual({ 'Suikoden IV': 0.91 });
    // A series' name: unsure. The same words going on into a longer title (Ridge Racer V): less sure again.
    expect(conf('every Final Fantasy fan', more)).toEqual({ 'Final Fantasy': 0.71 });
    expect(conf('Ridge Racer V is here', more)).toEqual({ 'Ridge Racer': 0.71 });
    // "Super" before a title is another game's title.
    expect(conf('the first Super Ridge Racer', more)).toEqual({ 'Ridge Racer': 0.71 });
  });
  it('meets a title however the page spaces, joins or hyphenates it', () => {
    const games = [game('Spider-Man'), game('Mega Man X'), game('F-Zero GX'), game('ZombiU')];
    for (const text of ['Spider-Man swings in', 'Spiderman swings in', 'Spider Man swings in']) expect(Object.keys(conf(text, games)), text).toEqual(['Spider-Man']);
    expect(Object.keys(conf('then Megaman X returns', games))).toEqual(['Mega Man X']);
    expect(Object.keys(conf('F-ZERO GX and FZero GX', games))).toEqual(['F-Zero GX']);
    expect(Object.keys(conf('play Zombi U now', games))).toEqual(['ZombiU']);
    // A title broken across a line, with the hyphen the break left.
    expect(Object.keys(spotTitles([...line('the new Spider-'), ...line('Man game', 120)], games, '2004-06-01'))).toHaveLength(1);
    // Not from the middle of a hyphenated word: "X-Men" has no "Men in Black".
    expect(conf('the X-Men in Black suits', [game('Men in Black')])).toEqual({});
  });
  it('reads "&" and "and", "II" and "2", a misread "Il", the article and the possessive as the same', () => {
    const games = [game('Sonic & Knuckles'), game("Super Ghouls'n Ghosts"), game('Quake II'), game('The Quest for the Rings'), game("Tony Hawk's Pro Skater"), game("Tom Clancy's Ghost Recon Advanced Warfighter")];
    expect(Object.keys(conf('Sonic and Knuckles', games))).toEqual(['Sonic & Knuckles']);
    expect(Object.keys(conf("Super Ghouls 'N' Ghosts", games))).toEqual(["Super Ghouls'n Ghosts"]);
    for (const text of ['Quake 2 is out', 'Quake Il is out', 'Quake || is out', 'Quake ll is out']) expect(Object.keys(conf(text, games)), text).toEqual(['Quake II']);
    // "I'll" is not a number.
    expect(conf("Quake I'll play later", games)).toEqual({});
    expect(Object.keys(conf('five Quest for the Rings, four Weird Birds', games))).toEqual(['The Quest for the Rings']);
    expect(Object.keys(conf('Tony Hawk Pro Skater and Tony Hawks Pro Skater', games))).toEqual(["Tony Hawk's Pro Skater"]);
    expect(conf('In Ghost Recon Advanced Warfighter you lead', games)).toEqual({ "Tom Clancy's Ghost Recon Advanced Warfighter": 0.87 });
  });
  it("gives a game's words to the game, not to its edition, and an edition doesn't make its game a series", () => {
    const games = [game('Lollipop Chainsaw: Premium Edition'), game('Lollipop Chainsaw')];
    expect(conf('get involved with Lollipop Chainsaw? Suda said', games)).toEqual({ 'Lollipop Chainsaw': 0.86 });
    // The edition alone stands for its game.
    expect(conf('get involved with Lollipop Chainsaw? Suda said', [games[0]!])).toEqual({ 'Lollipop Chainsaw: Premium Edition': 0.84 });
  });
  it("doesn't run a title through the end of a sentence, or through a comma that isn't the title's", () => {
    const games = [game('Burnout 3'), game('Band Hero'), game('Super Mario Bros. 3'), game('Hey You, Pikachu!')];
    expect(conf('We loved Burnout. 3 more games followed', games)).toEqual({});
    expect(conf('Rock Band, Hero of the day', games)).toEqual({});
    expect(Object.keys(conf('Super Mario Bros. 3 and Hey You, Pikachu! are here', games))).toEqual(['Super Mario Bros. 3', 'Hey You, Pikachu!']);
  });
  it("takes a title of one word for a game when the issue's text never writes it small, or with more to go on", () => {
    const games = [game('Dishonored'), game('Rampage'), game('Saturn'), game('Halo'), game('Halo 2')];
    const text = 'they went on a rampage and the rampage went on';
    // Never written small: likely (a maybe); with a console named after it, or in a heading and named again: sure.
    expect(conf('then Dishonored arrived', games, text)).toEqual({ Dishonored: 0.72 });
    expect(conf('then Dishonored (PS3, 360) arrived', games, text)).toEqual({ Dishonored: 0.82 });
    expect(conf('Dishonored:30 is here and Dishonored (PS3) too', games, text).Dishonored).toBeGreaterThanOrEqual(0.85);
    // An ordinary word of the issue, a console's name, a series' name: not by a capital alone.
    expect(conf('then Rampage arrived', games, text).Rampage).toBeLessThan(0.6);
    expect(conf('the Saturn arrived', games, text).Saturn).toBeLessThan(0.6);
    expect(conf('then Halo arrived', games, text).Halo).toBeLessThan(0.6);
  });
  it("asks about two ordinary words written as a title, and is sure of two that aren't both ordinary", () => {
    const games = [game('Snail Mail'), game('Contra Force'), game('Darkwing Duck'), game('Hard Hat'), game('American Football'), game('Driver 2')];
    const text = 'send it by snail or by mail if the snail gets the mail to the driver before the other driver plays football or more football';
    expect(conf('BY SNAIL MAIL: 8840 Wilshire', games, text)).toEqual({ 'Snail Mail': 0.8 });
    expect(conf('Chessmaster Contra Force Darkwing Duck', games, text)).toEqual({ 'Contra Force': 0.86, 'Darkwing Duck': 0.86 });
    // A capital going on after it is another title's word, unless it begins a title of its own (a list of games).
    expect(conf('then Hard Hat Mack arrived', games, text)).toEqual({ 'Hard Hat': 0.78 });
    // A word always written with a capital says nothing by its capital.
    expect(conf('what it did for American Football fans', games, text)).toEqual({ 'American Football': 0.8 });
    expect(conf('then Driver 2 arrived', games, text)).toEqual({ 'Driver 2': 0.85 });
  });
  it("finds a game by its other names, when they're names of two real words", () => {
    const games = [game('Wonder Boy: The Dragon’s Trap', 'sega-master-system', '1989-01-01', ['Wonder Boy III', 'Monster World II']), game('Turnabout', 'playstation', '2000-04-06', ['U-SA'])];
    expect(conf('Psycho Fox and Wonderboy III)', games)).toEqual({ 'Wonder Boy: The Dragon’s Trap': 0.85 });
    expect(conf('Good at Best Buy stores in the USA only', games)).toEqual({});
  });
  it("leaves out a main title or a subtitle that several games share, but not a main title with its number", () => {
    const games = [game('Batman: The Video Game'), game('Spider: The Video Game'), game('Tomb Raider: Legend'), game('Tomb Raider: Anniversary'), game('Rayman 2: The Great Escape'), game('Rayman 2: Revolution', 'playstation-2', '2004-03-01')];
    expect(conf('Tomb Raider is back in The Video Game of the year', games)).toEqual({ 'Tomb Raider: Legend': 0.5, 'Batman: The Video Game': 0.5 });
    expect(conf('then Rayman 2 arrived', games)).toEqual({ 'Rayman 2: Revolution': 0.71 });
  });
  describe('what the rest of the issue settles (D242)', () => {
    const page = (n: number, ...lines: string[]): SpotPage => {
      const words = lines.flatMap((l, k) => line(l, 100 + k * 40));
      return { n, text: lines.map((l) => l.replace(/:\d+( |$)/g, '$1')).join('\n'), words };
    };
    const games = [game('Dead Space', 'playstation-3'), game('Contra Force', 'nintendo-entertainment-system'), game('Final Fantasy', 'nintendo-entertainment-system'), game('Final Fantasy VII', 'playstation'), game('Star Trek: The Next Generation', 'super-nintendo')];
    // The issue writes "dead" and "space" small: Dead Space is two ordinary words, a maybe by a capital alone.
    const small = page(40, 'the dead of space and the dead of night in space');
    const find = (pages: SpotPage[], over: Partial<Parameters<typeof spotIssue>[2]> = {}) =>
      spotIssue([...pages, small], spotIndex(games, '2004-06-01'), { magazine: 'Next Generation', coverDay: '2004-06-01', linkAt: 0.85, askAt: 0.6, rules: new Map(), ...over }).map((m) => [m.page, m.title, m.state, m.confidence]);

    it('links a maybe when another page of the issue is sure of the game, or a review of it is cited for the issue', () => {
      const alone = page(9, 'then Dead Space arrived');
      expect(find([alone])).toEqual([[9, 'Dead Space', 'suggested', 0.8]]);
      // Its review's heading, the title again under it: sure there, so sure on page 9 too.
      const review = page(5, 'DEAD:30 SPACE:30', 'In Dead Space you are alone');
      expect(find([review, alone])).toEqual([
        [5, 'Dead Space', 'linked', 0.98],
        [9, 'Dead Space', 'linked', 0.9],
      ]);
      expect(find([alone], { cited: new Set(['deadspace']) })).toEqual([[9, 'Dead Space', 'linked', 0.9]]);
      // Left as each page alone says, when the issue isn't asked.
      expect(find([review, alone], { evidence: false })[1]).toEqual([9, 'Dead Space', 'suggested', 0.8]);
    });

    it('holds a maybe likely on two lesser things, for an owner who links at a lower bar', () => {
      // Named on two pages, and this page names its console: likely, under the usual bar.
      const pages = [page(9, 'then Dead Space arrived on PlayStation 3'), page(12, 'and Dead Space again')];
      expect(find(pages)[0]).toEqual([9, 'Dead Space', 'suggested', 0.82]);
      expect(find(pages, { linkAt: 0.8 })[0]![2]).toBe('linked');
    });

    it("asks about two words found once with nothing else to go on, and is sure of them when another page names the game", () => {
      expect(find([page(9, 'Chessmaster and Contra Force here')])).toEqual([[9, 'Contra Force', 'suggested', 0.84]]);
      expect(find([page(9, 'Chessmaster and Contra Force here'), page(30, 'a Contra Force tip')]).map((m) => m[2])).toEqual(['linked', 'linked']);
    });

    it("leaves out a series' name beside a game of the series, and the magazine's own name", () => {
      expect(find([page(9, 'In Final Fantasy VII every Final Fantasy fan cries')])).toEqual([[9, 'Final Fantasy VII', 'linked', 0.95]]);
      expect(find([page(9, 'Next Generation investigates the launch')])).toEqual([]);
    });

    it("keeps the owner's answers over everything", () => {
      const rules = new Map([['deadspace|Next Generation', 'not'], ['contraforce|*', 'game:nintendo-entertainment-system|Contra Force']]);
      expect(find([page(9, 'then Dead Space arrived'), page(10, 'a Contra Force tip')], { rules })).toEqual([[10, 'Contra Force', 'linked', 1]]);
    });
  });

  it('checks an older issue for older games', () => {
    const w = (year: number) => spotWindow({ magazine: 'Computer and Video Games', year, month: 3 }, '2, 1', [], ['1989: 6, 1', '1994: 4, 1']);
    expect([w(1984).from, w(1984).to]).toEqual(['1978-03-01', '1985-03-28']);
    expect(w(1992).from).toBe('1988-03-01');
    expect(w(2004).from).toBe('2002-03-01');
    // A magazine about one company's consoles is checked for those only.
    const np = spotWindow({ magazine: 'Nintendo Power', year: 2004, month: 3 }, '2, 1', ['Nintendo Power: nintendo']);
    expect([np.keep('nintendo-gamecube'), np.keep('playstation-2')]).toEqual([true, false]);
  });
  it("reads EGM's Review Crew and Nintendo Power's ratings", () => {
    expect(scoresOn('SUPER METROID Ed 9.0 9.0 9.5 9.0 Danyon', 'Electronic Gaming Monthly')).toBe('9.0 / 9.0 / 9.5 / 9.0');
    expect(scoresOn('Page 28 of 1994 issue 59', 'Electronic Gaming Monthly')).toBeNull();
    expect(scoresOn('POWER METER G 4.5 P 4.0 C 3.5 T 4.5', 'Nintendo Power')).toBe('G 4.5 · P 4.0 · C 3.5 · T 4.5');
  });
});
