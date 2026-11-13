import { describe, expect, it } from 'vitest';
import { answersByGame, consoleWeights, FOLDED_CONSOLES, foldedConsoles, pageOfGames, searchGameKey } from './searchGames.js';

const answer = (title: string, platformKey: string) => ({ title, platformKey, platform: platformKey.toUpperCase() });

describe('a search by game (T-407)', () => {
  it('puts a game\'s answers together as catalogs compare titles, notes in square brackets left out', () => {
    expect(searchGameKey('Call of Duty Black Ops')).toBe(searchGameKey('Call of Duty: Black Ops'));
    expect(searchGameKey('Call of Duty 3 [Platinum Hits]')).toBe(searchGameKey('Call of Duty 3'));
    expect(searchGameKey('Call of Duty: Black Ops II')).not.toBe(searchGameKey('Call of Duty: Black Ops'));
    const games = answersByGame([answer('Black Ops', 'xbox-360'), answer('Ghosts', 'xbox-one'), answer('Black Ops', 'playstation-3')]);
    expect(games.map((g) => [g.key, g.answers.map((a) => a.platformKey)])).toEqual([
      ['blackops', ['xbox-360', 'playstation-3']],
      ['ghosts', ['xbox-one']],
    ]);
  });

  it('keeps every console of the games on a page, and counts every game and console beyond it', () => {
    // A game on many consoles, its last answers far down the search's order (behind other games' answers).
    const sorted = [
      ...['a', 'b', 'c', 'd', 'e', 'f'].map((k) => answer('Many', `console-${k}`)),
      ...Array.from({ length: 40 }, (_, i) => answer(`Other ${i}`, 'console-x')),
      answer('Many', 'playstation-3'),
    ];
    const page = pageOfGames(sorted, 2);
    expect(page.results.filter((r) => r.title === 'Many').map((r) => r.platformKey)).toEqual(['console-a', 'console-b', 'console-c', 'console-d', 'console-e', 'console-f', 'playstation-3']);
    expect(page.results.map((r) => r.title)).toContain('Other 0');
    expect(page.results).toHaveLength(8);
    expect(page.games).toBe(41);
    expect(page.consoles[0]).toEqual({ platformKey: 'console-x', platform: 'CONSOLE-X', count: 40 });
    expect(page.consoles.find((c) => c.platformKey === 'playstation-3')).toEqual({ platformKey: 'playstation-3', platform: 'PLAYSTATION-3', count: 1 });
    expect(pageOfGames(sorted, 0).results).toEqual([]);
  });
});

describe("a game's first consoles (T-407)", () => {
  const weights = consoleWeights({
    'playstation-3': { recent: 72, copies: 1205 },
    'nintendo-switch': { recent: 19, copies: 1171 },
    'xbox-360': { recent: 0, copies: 240 },
    'super-famicom': { recent: 0, copies: 290, opened: 6 },
  });

  it('weighs what you did lately most, then the size of what you have', () => {
    expect(weights.get('playstation-3')).toBeCloseTo(1.5);
    expect(weights.get('nintendo-switch')!).toBeGreaterThan(weights.get('xbox-360')!);
    // Games opened lately count as much as copies added.
    expect(weights.get('super-famicom')!).toBeGreaterThan(weights.get('nintendo-switch')!);
    expect(consoleWeights({})).toEqual(new Map());
    expect(consoleWeights({ wii: { recent: 0, copies: 0 } }).get('wii')).toBe(0);
  });

  it('shows 2 to 4: the shown console first, then the most active, then the search\'s order', () => {
    const consoles = ['nintendo-ds', 'wii', 'xbox-360', 'playstation-3', 'xbox-360', 'nintendo-switch'];
    expect([...foldedConsoles(consoles, 'nintendo-ds', weights, 3)]).toEqual(['nintendo-ds', 'playstation-3', 'nintendo-switch']);
    expect([...foldedConsoles(consoles, 'wii', new Map(), 3)]).toEqual(['wii', 'nintendo-ds', 'xbox-360']);
    for (const n of [-1, 0, 1, 2, 3, 4, 5, 9, Number.NaN]) {
      const shown = foldedConsoles(consoles, 'wii', weights, n);
      expect(shown.size).toBeGreaterThanOrEqual(FOLDED_CONSOLES.min);
      expect(shown.size).toBeLessThanOrEqual(FOLDED_CONSOLES.max);
      expect(shown.has('wii')).toBe(true);
    }
    // A game you have shows a console you have it on, even one you're not busy on.
    expect([...foldedConsoles(consoles, 'nintendo-ds', weights, 3, new Set(['wii']))]).toEqual(['nintendo-ds', 'wii', 'playstation-3']);
    expect([...foldedConsoles(consoles, 'wii', weights, 3, new Set(['wii', 'xbox-360']))]).toEqual(['wii', 'playstation-3', 'nintendo-switch']);
    expect([...foldedConsoles(consoles, 'nintendo-ds', weights, 3, new Set(['playstation-3']))]).toEqual(['nintendo-ds', 'playstation-3', 'nintendo-switch']);
    // A game on fewer consoles shows what it has.
    expect([...foldedConsoles(['wii'], 'wii', weights, 3)]).toEqual(['wii']);
  });
});
