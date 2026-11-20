import { describe, expect, it } from 'vitest';
import { causePages, eraOf, missCause, scoreCited, scoreLabels, type CitedRow } from './score.js';

const pages = (...texts: string[]) => causePages(texts.map((t) => t.split(' ')));

describe('the Leaves yardstick (docs/leaves-yardstick.md)', () => {
  it('names a five-year era', () => {
    expect(eraOf(1994)).toBe('1990-94');
    expect(eraOf(1995)).toBe('1995-99');
    expect(eraOf(2000)).toBe('2000-04');
  });

  it("says why a game known to be in an issue wasn't found, from the issue's text", () => {
    expect(missCause('Lollipop Chainsaw', pages('you first get involved with Lollipop Chainsaw? Suda said'))).toBe('exact');
    // Another spelling: "and" for "&", a number written the other way, a possessive left out, a mark between words.
    expect(missCause('Sonic & Knuckles', pages('then Sonic and Knuckles arrived'))).toBe('variant');
    expect(missCause('Quake II', pages('we played Quake 2 all night'))).toBe('variant');
    expect(missCause("Tony Hawk's Pro Skater", pages('Tony Hawk Pro Skater is here'))).toBe('variant');
    expect(missCause('The Simpsons: Hit & Run', pages('Simpsons Hit & Run review'))).toBe('variant');
    expect(missCause('Need for Speed: ProStreet', pages('the new Need for Speed game'))).toBe('main-title');
    expect(missCause('Mega Man X', pages('Megaman X returns'))).toBe('run-together');
    expect(missCause('Spider-Man', pages('Spider-Man swings in'))).toBe('run-together');
    expect(missCause('Dynasty Warriors', pages('Dynasty Warrlors is back'))).toBe('one-off');
    expect(missCause('Mario Kart 64', pages('64 tracks of kart racing with Mario'))).toBe('scattered');
    expect(missCause('Earth Defense Force', pages('nothing of it here'))).toBe('absent');
    // A title of one word is an exact find as soon as the word is there: the spotter's question is whether it's the game.
    expect(missCause('Dishonored', pages('Dishonored (PS3, 360, PC)'))).toBe('exact');
  });

  it('counts the cited reviews found, those citing a page apart, and leaves out the ones it cannot judge', () => {
    const row = (over: Partial<CitedRow>): CitedRow => ({ magazine: 'EGM', year: 1994, title: 'Super Metroid', outcome: 'linked', pageCited: true, cause: null, inCandidates: true, pagesOff: 0, ...over });
    const score = scoreCited([
      row({}),
      row({ outcome: 'maybe', pagesOff: 6 }),
      row({ outcome: 'missed', cause: 'exact', pagesOff: null, title: 'Rampage' }),
      row({ outcome: 'missed', cause: 'absent', pagesOff: null, pageCited: false, magazine: 'GamePro', year: 2009, inCandidates: false }),
      row({ outcome: 'no-text' }),
      row({ outcome: 'wrong-issue' }),
    ]);
    expect(score.all.all).toEqual({ n: 4, linked: 1, maybe: 1, missed: 2 });
    expect(score.withPage.all).toEqual({ n: 3, linked: 1, maybe: 1, missed: 1 });
    expect(score.noText).toBe(1);
    expect(score.wrongIssue).toBe(1);
    expect(score.all.byMagazine['GamePro']).toEqual({ n: 1, linked: 0, maybe: 0, missed: 1 });
    expect(score.all.byEra['1990-94']!.n).toBe(3);
    expect(score.withPage.causes.exact).toEqual({ n: 1, candidate: 1, oneWord: 1 });
    expect(score.all.causes.absent).toEqual({ n: 1, candidate: 0, oneWord: 0 });
    expect(score.withPage.nearPage).toEqual({ found: 2, within2: 1 });
  });

  it('scores the pages whose every game is listed: how many linked are right, and how many of the games were found', () => {
    const labels = [
      { issueId: 1, page: 10, magazine: 'EGM', year: 1994, kind: 'review', games: [{ title: 'Super Metroid' }, { title: 'Final Fantasy III', aka: ['Final Fantasy VI'] }] },
      { issueId: 1, page: 11, magazine: 'EGM', year: 1994, kind: 'ad', games: [] },
    ];
    const score = scoreLabels(labels, [
      { issueId: 1, page: 10, title: 'Super Metroid', state: 'linked' },
      { issueId: 1, page: 10, title: 'Final Fantasy VI', state: 'suggested' },
      { issueId: 1, page: 10, title: 'Rampage', state: 'linked' },
      { issueId: 1, page: 11, title: 'Heat', state: 'suggested' },
    ]);
    expect(score.all.pages).toBe(2);
    expect(score.all.truth).toBe(2);
    // Linked: Super Metroid right, Rampage wrong; one of the two games linked.
    expect(score.all.linked).toEqual({ found: 2, right: 1, truthFound: 1 });
    // With the maybes: Final Fantasy VI is the page's Final Fantasy III by its other name; Heat is wrong.
    expect(score.all.withMaybes).toEqual({ found: 4, right: 2, truthFound: 2 });
    expect(score.byKind['ad']!.withMaybes).toEqual({ found: 1, right: 0, truthFound: 0 });
  });
});
