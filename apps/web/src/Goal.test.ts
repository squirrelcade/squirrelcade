import { describe, expect, it } from 'vitest';
import { overGoalNote } from './Goal';

describe('one in, one out', () => {
  it('adds a sentence to a copy added at or over the goal, and nothing otherwise', () => {
    expect(overGoalNote({ overGoal: null })).toBe('');
    expect(overGoalNote({ id: 1, key: 'c-1' })).toBe('');
    expect(overGoalNote(undefined)).toBe('');
    expect(overGoalNote({ overGoal: 0 })).toBe(" That's your goal reached: one in, one out from here (Acorns > Sales has what to sell).");
    expect(overGoalNote({ overGoal: 1200 })).toBe(" That's 1,200 over your goal: Acorns > Sales has what to sell.");
  });
});
