import { describe, expect, it } from 'vitest';
import { inBacklog, isPlayStatus, PLAY_LABELS, playDates } from './play.js';

describe('play status', () => {
  it('knows its statuses', () => {
    expect(isPlayStatus('beaten')).toBe(true);
    expect(isPlayStatus('finished')).toBe(false);
    expect(isPlayStatus(3)).toBe(false);
    expect(PLAY_LABELS.shelf).toBe('Just for the shelf');
  });

  it('counts games not played yet, and unmarked ones when the setting says so', () => {
    expect(inBacklog('backlog', false)).toBe(true);
    expect(inBacklog(null, true)).toBe(true);
    expect(inBacklog(null, false)).toBe(false);
    for (const status of ['playing', 'beaten', 'completed', 'dropped', 'shelf'] as const) expect(inBacklog(status, true)).toBe(false);
  });

  it('dates starting and finishing a game, keeping days already set', () => {
    const none = { startedAt: null, finishedAt: null };
    expect(playDates('playing', none, '2026-09-28')).toEqual({ startedAt: '2026-09-28', finishedAt: null });
    expect(playDates('playing', { startedAt: '2026-01-01', finishedAt: '2026-02-01' }, '2026-09-28')).toEqual({ startedAt: '2026-01-01', finishedAt: null });
    expect(playDates('beaten', { startedAt: '2026-01-01', finishedAt: null }, '2026-09-28')).toEqual({ startedAt: '2026-01-01', finishedAt: '2026-09-28' });
    expect(playDates('completed', { startedAt: null, finishedAt: '2026-03-03' }, '2026-09-28')).toEqual({ startedAt: null, finishedAt: '2026-03-03' });
    expect(playDates('backlog', { startedAt: '2026-01-01', finishedAt: '2026-02-01' }, '2026-09-28')).toEqual(none);
    expect(playDates('dropped', { startedAt: '2026-01-01', finishedAt: null }, '2026-09-28')).toEqual({ startedAt: '2026-01-01', finishedAt: null });
  });
});
