import { bannerMarks } from '@squirrelcade/core';
import { describe, expect, it } from 'vitest';
import { chestLabel, markLabel, playablePhrase } from './ConsoleMark';

describe("the console marks' and the chest's hover text (1.5.1)", () => {
  it('says owned or unowned where a mark says whether you have the game, the name alone where it only names a console', () => {
    expect(markLabel('Wii U', true)).toBe('Wii U (owned)');
    expect(markLabel('Wii U', false)).toBe('Wii U (unowned)');
    expect(markLabel('PC · Steam', true)).toBe('PC · Steam (owned)');
    expect(markLabel('Wii U')).toBe('Wii U');
    expect(chestLabel(true)).toBe('Stash (owned)');
    expect(chestLabel(false)).toBe('Stash (unowned)');
  });

  it("labels a one-console cover's banner with its own console first", () => {
    // The game of the day's Mega Man 2 (NES), not yours anywhere: "Nintendo Entertainment System (unowned)" first.
    const marks = bannerMarks([], ['wii', 'wii-u', 'nintendo-entertainment-system'], 2, 'nintendo-entertainment-system');
    expect(marks.map((m) => markLabel(m.key, m.owned))).toEqual(['nintendo-entertainment-system (unowned)', 'wii-u (unowned)']);
  });
});

describe("the chest of a game you can play another way (1.5.1)", () => {
  it('says so in its hover text', () => {
    expect(chestLabel(false, playablePhrase([{ kind: 'collection' }]))).toBe('Stash (unowned; playable in a collection you have)');
    expect(chestLabel(false, playablePhrase([{ kind: 'remaster' }]))).toBe('Stash (unowned; playable as a remaster you have)');
    expect(chestLabel(true, playablePhrase([{ kind: 'collection' }]))).toBe('Stash (owned)');
    expect(chestLabel(false, playablePhrase([]))).toBe('Stash (unowned)');
  });
});
