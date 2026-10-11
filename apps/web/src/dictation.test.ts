import { describe, expect, it } from 'vitest';
import { joinWords, keyboardHint } from './dictation';

describe('dictation', () => {
  it('adds words with one space between', () => {
    expect(joinWords('', ' do I have ')).toBe('do I have');
    expect(joinWords('Do I have', 'Pac-Man')).toBe('Do I have Pac-Man');
    expect(joinWords('Do I have ', 'Pac-Man')).toBe('Do I have Pac-Man');
    expect(joinWords('Do I have', '   ')).toBe('Do I have');
  });

  it("says how to use the keyboard's dictation on each kind of device", () => {
    expect(keyboardHint('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)')).toMatch(/keyboard/);
    expect(keyboardHint('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/131.0')).toMatch(/Windows key \+ H/);
  });
});
