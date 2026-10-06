import { describe, expect, it } from 'vitest';
import { preferenceLevels } from './Preference';

describe('preference marks', () => {
  it('marks the levels by their points, most wanted first, with Do Not Recommend last', () => {
    expect(preferenceLevels({ 'Must Have': 20, 'Strong Interest': 10, 'Slight Interest': 5, 'No Adjustment': 0, 'Low Interest': -5 })).toEqual([
      { value: 'Must Have', mark: '🔥' },
      { value: 'Strong Interest', mark: '⭐' },
      { value: 'Slight Interest', mark: '👍' },
      { value: 'Low Interest', mark: '👎' },
      { value: 'Do Not Recommend', mark: '🚫' },
    ]);
  });

  it('keeps fitting marks for levels an owner renamed or added', () => {
    expect(preferenceLevels({ 'Buy it now': 30, Maybe: 0, Nope: -10, Someday: 3 })).toEqual([
      { value: 'Buy it now', mark: '🔥' },
      { value: 'Someday', mark: '⭐' },
      { value: 'Maybe', mark: '⚪' },
      { value: 'Nope', mark: '👎' },
      { value: 'Do Not Recommend', mark: '🚫' },
    ]);
  });
});
