import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { articleDate, citationOf, eraOf, metacriticFor, plain, readArticle, reviewPlatformFits } from './roots.js';

const article = (name: string) => readFileSync(new URL(`./fixtures/wikipedia/${name}.wikitext`, import.meta.url), 'utf8');

describe("Roots: a game's article read for its time (D165)", () => {
  it('reads dates as articles write them', () => {
    expect(articleDate('April 22, 1994')).toBe('1994-04-22');
    expect(articleDate('22 April 1994')).toBe('1994-04-22');
    expect(articleDate('1994-04-22')).toBe('1994-04-22');
    expect(articleDate('June 1994')).toBe('1994-06');
    expect(articleDate('Sept. 2006')).toBe('2006-09');
    expect(articleDate('1987')).toBe('1987');
    expect(articleDate('the year after')).toBeNull();
  });

  it("sorts a source into At the time (to 18 months after release, previews a year before) or Looking back", () => {
    expect(eraOf('1994-06', '1994-03-19', 18)).toBe('time');
    expect(eraOf('1993-11-01', '1994-03-19', 18)).toBe('time');
    expect(eraOf('1996-01-01', '1994-03-19', 18)).toBe('later');
    expect(eraOf('2010-05-01', '1994-03-19', 18)).toBe('later');
    expect(eraOf('1994', '1994-03-19', 18)).toBe('time');
    expect(eraOf('1990-01-01', '1994-03-19', 18)).toBeNull();
    expect(eraOf(null, '1994-03-19', 18)).toBeNull();
  });

  it('turns wikitext into its words', () => {
    expect(plain("''[[Hyper (magazine)|Hyper]]''<ref>x</ref> {{nowrap|issue 8}}<br />[[Nintendo Power]]")).toBe('Hyper issue 8\nNintendo Power');
    expect(citationOf('{{cite magazine |magazine=[[Electronic Gaming Monthly]] |title=Review Crew |volume=7 |issue=6 |date=June 1994 |page=28}}')).toMatchObject({
      kind: 'cite magazine',
      work: 'Electronic Gaming Monthly',
      title: 'Review Crew',
      issue: '6',
      volume: '7',
      date: '1994-06',
      page: '28',
    });
    expect(citationOf('{{sfn|Edge|2013|p=85–89}}')).toMatchObject({ kind: 'sfn', work: 'Edge', date: '2013', page: '85–89' });
  });

  it("reads Super Metroid: its releases, 25 review rows with each magazine's issue and page, and what it led to", () => {
    const r = readArticle(article('super-metroid'), ['Super Metroid']);
    expect(r.firstRelease).toBe('1994-03-19');
    expect(r.releases.map((x) => [x.region, x.date])).toEqual([
      ['JP', '1994-03-19'],
      ['NA', '1994-04-18'],
      ['PAL', '1994-07-28'],
    ]);
    expect(r.reviews).toHaveLength(25);
    expect(r.reviews.find((x) => x.code === 'EGM')).toMatchObject({
      outlet: 'Electronic Gaming Monthly',
      scores: [{ platform: null, score: '9/10, 9/10, 9/10, 9/10' }],
      citation: { issue: '6', volume: '7', page: '28', date: '1994-06' },
    });
    // The magazine's own name over the site that reported its scores.
    expect(r.reviews.find((x) => x.code === 'Fam')).toMatchObject({ outlet: 'Weekly Famitsu', citation: { issue: '279', date: '1994-04-22' } });
    expect(r.reviews.find((x) => x.code === 'rev1')).toMatchObject({ outlet: 'Games World', scores: [{ score: '94/100' }] });
    expect(r.reviews.find((x) => x.code === 'Hyper')?.citation?.url).toMatch(/archive\.org\/details\/hyper-008/);
    expect(r.ledTo.map((m) => m.title)).toEqual(expect.arrayContaining(['Castlevania: Symphony of the Night', 'Shadow Complex', 'Axiom Verge']));
    expect(r.cameFrom.map((m) => m.title)).toContain('Metroid');
    // Magazines and the game itself aren't games it names.
    expect([...r.cameFrom, ...r.ledTo].map((m) => m.title)).not.toEqual(expect.arrayContaining(['Super Metroid', 'Nintendo Power', 'GamePro']));
    expect(r.sources.length).toBeGreaterThan(40);
  });

  it("reads Super Mario Bros.' two tables, contemporary and retrospective, a column for each platform", () => {
    const r = readArticle(article('super-mario-bros'), ['Super Mario Bros.']);
    expect(r.firstRelease).toBe('1985-09-13');
    expect(r.reviews.find((x) => x.code === 'ACE')).toMatchObject({ table: 'time', outlet: 'ACE', scores: [{ platform: 'NES', score: '955/1000' }], citation: { page: '144' } });
    expect(r.reviews.find((x) => x.code === 'rev1')).toMatchObject({ table: 'time', outlet: 'Top Score', scores: [{ platform: 'NES', score: '4/4' }] });
    expect(r.reviews.find((x) => x.code === 'GR')).toMatchObject({
      table: 'later',
      scores: [
        { platform: 'NES', score: '86%' },
        { platform: 'GBA', score: '80%' },
      ],
    });
    // Metacritic only for the platform it scored.
    expect(metacriticFor(r.reviews, 'game-boy-advance', 'Game Boy Advance')).toBe(84);
    expect(metacriticFor(r.reviews, 'nintendo-entertainment-system', 'NES')).toBeNull();
  });

  it("finds each console's Metacritic score, however the table writes the platform", () => {
    const okami = readArticle(article('okami'), ['Ōkami']).reviews;
    expect(metacriticFor(okami, 'playstation-2', 'PlayStation 2')).toBe(93);
    expect(metacriticFor(okami, 'wii', 'Wii')).toBe(90);
    expect(metacriticFor(okami, 'xbox-one', 'Xbox One')).toBe(87);
    expect(metacriticFor(okami, 'nintendo-switch', 'Nintendo Switch')).toBe(89);
    const hl2 = readArticle(article('half-life-2'), ['Half-Life 2']).reviews;
    expect(hl2.find((x) => x.code === 'MC')?.scores).toEqual([
      { platform: 'PC', score: '96/100' },
      { platform: 'Xbox', score: '90/100' },
    ]);
    expect(metacriticFor(hl2, 'pc', 'PC')).toBe(96);
    expect(metacriticFor(hl2, 'xbox', 'Xbox')).toBe(90);
    expect(reviewPlatformFits('X360', 'xbox-360', 'Xbox 360')).toBe(true);
    expect(reviewPlatformFits('NS', 'nintendo-switch', 'Nintendo Switch')).toBe(true);
    expect(reviewPlatformFits('NS', 'nintendo-switch-2', 'Nintendo Switch 2')).toBe(false);
  });
});
