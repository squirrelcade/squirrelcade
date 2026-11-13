import { describe, expect, it } from 'vitest';
import { marksToShow, oneLinePerGame, searchWeights } from './oneLine';

const on = (platformKey: string, answer = 'need', title = 'Call of Duty: Black Ops') => ({ platformKey, platform: platformKey, title, answer });

// T-407: a game on many consoles shows 2 to 4 of them folded ("+n more"), and every one of them open.
describe("a search's game line", () => {
  // In the search's order (a game you need first), as the search by game answers it: every console of the game.
  const line = oneLinePerGame([
    on('nintendo-ds'),
    on('wii', 'own-elsewhere'),
    on('xbox-360', 'own'),
    on('playstation-3', 'own', 'Call of Duty Black Ops'),
    on('playstation-2', 'not-a-target'),
    on('xbox-one', 'not-a-target'),
  ])[0]!;
  const weights = searchWeights({ 'playstation-3': { recent: 40, copies: 900 }, 'xbox-360': { recent: 0, copies: 100 } }, [{ platformKey: 'xbox-one' }]);

  it('keeps every console of the game reachable', () => {
    expect(line.consoles).toHaveLength(6);
    const open = marksToShow(line, line.first.platformKey, weights, 3, true);
    expect(open.marks.map((c) => c.platformKey).sort()).toEqual(['nintendo-ds', 'playstation-2', 'playstation-3', 'wii', 'xbox-360', 'xbox-one']);
    expect(open.hidden).toBe(0);
  });

  it('folds to 2 to 4: the shown console, then the ones you are most active on, oldest first', () => {
    const folded = marksToShow(line, 'nintendo-ds', weights, 3, false);
    expect(folded.marks.map((c) => c.platformKey)).toEqual(['nintendo-ds', 'playstation-3', 'xbox-one']);
    expect(folded.hidden).toBe(3);
    for (const n of [1, 2, 3, 4, 6]) {
      const { marks, hidden } = marksToShow(line, 'wii', weights, n, false);
      expect(marks.length).toBeGreaterThanOrEqual(2);
      expect(marks.length).toBeLessThanOrEqual(4);
      expect(marks.length + hidden).toBe(6);
      expect(marks.some((c) => c.platformKey === 'wii')).toBe(true);
    }
  });

  it('keeps a console you have it on among the first, so a game you have never looks like one you lack', () => {
    const quiet = oneLinePerGame([on('nintendo-ds'), on('wii'), on('xbox-360'), on('playstation-3'), on('nintendo-3ds', 'own')])[0]!;
    const { marks } = marksToShow(quiet, 'nintendo-ds', weights, 3, false);
    expect(marks.map((c) => c.platformKey)).toEqual(['nintendo-ds', 'playstation-3', 'nintendo-3ds']);
    expect(marks.some((c) => c.answer === 'own')).toBe(true);
  });

  it('shows a game on few consoles whole, with nothing to unfold', () => {
    const two = oneLinePerGame([on('wii'), on('playstation-3', 'own')])[0]!;
    expect(marksToShow(two, 'wii', weights, 3, false)).toMatchObject({ hidden: 0 });
    expect(marksToShow(two, 'wii', weights, 3, false).marks).toHaveLength(2);
  });

  it('shows a console once, as you have it, where the game has two answers there', () => {
    const twice = oneLinePerGame([on('nintendo-3ds'), on('xbox-360'), on('nintendo-3ds', 'own'), on('wii')])[0]!;
    const { marks } = marksToShow(twice, 'nintendo-3ds', weights, 3, true);
    expect(marks.map((c) => [c.platformKey, c.answer])).toEqual([
      ['xbox-360', 'need'],
      ['wii', 'need'],
      ['nintendo-3ds', 'own'],
    ]);
  });

  it('counts the games opened lately in this browser toward a console', () => {
    expect(weights.get('xbox-one')).toBe(1);
    expect(searchWeights(undefined, []).size).toBe(0);
  });
});
