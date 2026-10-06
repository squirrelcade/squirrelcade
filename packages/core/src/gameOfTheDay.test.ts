import { describe, expect, it } from 'vitest';
import { aroundThisDate, dayRandom, pickOfTheDay, type DayCandidate, type DayPick } from './gameOfTheDay.js';

const RULES = { repeatDays: 30, seriesDays: 5, pastBonus: 10, windowDays: 7 };
const game = (title: string, score: number, franchise = '', released: string | null = null, platformKey = 'playstation-3'): DayCandidate => ({ platformKey, title, score, franchise, released });

describe('the game of the day', () => {
  it('is the same all day, and another try picks again', () => {
    const games = Array.from({ length: 40 }, (_, i) => game(`Game ${i}`, 50 + i));
    const first = pickOfTheDay(games, [], '2026-09-29', RULES);
    expect(pickOfTheDay(games, [], '2026-09-29', RULES)).toEqual(first);
    // Different days usually pick differently, and a second try gives another number.
    const days = new Set(Array.from({ length: 10 }, (_, i) => pickOfTheDay(games, [], `2026-10-${String(i + 1).padStart(2, '0')}`, RULES)!.title));
    expect(days.size).toBeGreaterThan(5);
    expect(dayRandom('2026-09-29', 1)).not.toBe(dayRandom('2026-09-29', 0));
    for (let i = 0; i < 50; i++) expect(dayRandom(`2026-01-${i}`)).toBeGreaterThanOrEqual(0);
  });

  it('favors higher scores', () => {
    const games = [game('Great', 90), game('Fine', 30)];
    const picks = Array.from({ length: 400 }, (_, i) => pickOfTheDay(games, [], `2027-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`, RULES, i)!.title);
    const great = picks.filter((t) => t === 'Great').length;
    // Weights 8,100 to 900: about nine in ten.
    expect(great / picks.length).toBeGreaterThan(0.8);
  });

  it("leaves out games picked lately, their series right after, and today's earlier picks", () => {
    const games = [game('Mega Man 2', 90, 'Mega Man'), game('Mega Man 3', 90, 'Mega Man'), game('Contra', 20, 'Contra')];
    const history: DayPick[] = [{ date: '2026-09-27', platformKey: 'playstation-3', title: 'Mega Man 2', franchise: 'Mega Man' }];
    // Two days after a Mega Man: no Mega Man, whatever the scores.
    expect(pickOfTheDay(games, history, '2026-09-29', RULES)!.title).toBe('Contra');
    // Six days after: Mega Man 3 may come back, Mega Man 2 not for 30 days.
    const later = Array.from({ length: 20 }, (_, i) => pickOfTheDay(games, history, '2026-10-03', RULES, i)!.title);
    expect(later).not.toContain('Mega Man 2');
    expect(later).toContain('Mega Man 3');
    // Passed over today: another one isn't the same game, but may be the same series.
    const today: DayPick[] = [{ date: '2026-10-03', platformKey: 'playstation-3', title: 'Mega Man 3', franchise: 'Mega Man', skipped: true }];
    expect(pickOfTheDay([game('Mega Man 3', 90, 'Mega Man'), game('Mega Man 4', 90, 'Mega Man')], today, '2026-10-03', RULES)!.title).toBe('Mega Man 4');
    // Everything picked lately: nothing.
    expect(pickOfTheDay([games[0]!], history, '2026-09-29', RULES)).toBeNull();
  });

  it('knows a game that came out around this date in a past year', () => {
    expect(aroundThisDate('2011-09-25', '2026-09-29', 7)).toBe(true);
    expect(aroundThisDate('2011-10-10', '2026-09-29', 7)).toBe(false);
    // Across New Year, and never this year's.
    expect(aroundThisDate('2019-12-30', '2026-01-02', 7)).toBe(true);
    expect(aroundThisDate('2026-09-28', '2026-09-29', 7)).toBe(false);
    expect(aroundThisDate(null, '2026-09-29', 7)).toBe(false);
    expect(aroundThisDate('2011', '2026-09-29', 7)).toBe(false);
  });
});
