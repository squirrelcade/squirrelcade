import { describe, expect, it } from 'vitest';
import { bytes, date, interval, money, releaseDate, timeAgo } from './format';

describe('dates', () => {
  it('writes a day in each date format, and a moment in local time', () => {
    expect(date('2026-09-27', 'us')).toBe('9/27/2026');
    expect(date('2026-09-27', 'eu')).toBe('27/09/2026');
    expect(date('2026-09-27', 'iso')).toBe('2026-09-27');
    expect(date(null)).toBe('—');
    expect(date('TBA')).toBe('TBA');
  });

  it('writes release dates as precisely as their source gives them', () => {
    expect(releaseDate('2026')).toBe('2026');
    expect(releaseDate('2026-10')).toBe('Oct 2026');
    expect(releaseDate('2026-10', 'iso')).toBe('2026-10');
    expect(releaseDate('2026-10-06', 'eu')).toBe('06/10/2026');
    expect(releaseDate('TBA')).toBe('TBA');
  });

  it('says how long ago a moment was, or how soon it is', () => {
    const at = (secondsAgo: number) => new Date(Date.now() - secondsAgo * 1000).toISOString();
    expect(timeAgo(at(2))).toBe('just now');
    expect(timeAgo(at(300))).toBe('5 minutes ago');
    expect(timeAgo(at(-7200))).toBe('in 2 hours');
    expect(timeAgo(null)).toBe('never');
  });
});

describe('amounts', () => {
  it('writes money from cents, yen whole, and a dash for none', () => {
    expect(money(123456, 'USD')).toMatch(/1,234\.56/);
    expect(money(1500, 'JPY')).toMatch(/1,500/);
    expect(money(1500, 'JPY')).not.toMatch(/\./);
    expect(money(null)).toBe('—');
  });

  it('writes sizes and intervals in words people read', () => {
    expect(bytes(1536)).toMatch(/1\.5 KB/);
    expect(interval(6 * 3_600_000)).toMatch(/6 hours/);
  });
});
