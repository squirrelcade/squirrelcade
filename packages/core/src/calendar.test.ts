import { describe, expect, it } from 'vitest';
import { calendarFile } from './calendar.js';

describe('calendarFile', () => {
  it('makes an all-day event per dated release, escaped and folded, and leaves out dates that are not a day', () => {
    const file = calendarFile(
      'Coming soon',
      [
        { uid: '1@squirrelcade', date: '2026-10-06', summary: 'Mega Man, Legacy; Collection (Nintendo Switch)', description: 'Missing, Game-Key Card' },
        { uid: '2@squirrelcade', date: '2026-11', summary: 'Month only' },
        { uid: '3@squirrelcade', date: '2026-12-31', summary: 'A '.repeat(60).trim() },
      ],
      new Date('2026-09-28T07:00:00.123Z'),
    );
    const lines = file.split('\r\n');
    expect(lines.slice(0, 5)).toEqual(['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Squirrelcade//Coming soon//EN', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Coming soon']);
    expect(file).toContain('DTSTART;VALUE=DATE:20261006\r\nDTEND;VALUE=DATE:20261007');
    expect(file).toContain('SUMMARY:Mega Man\\, Legacy\\; Collection (Nintendo Switch)');
    expect(file).toContain('DTSTAMP:20260928T070000Z');
    expect(file).not.toContain('Month only');
    // The year's last day ends on the next year's first; long lines fold at 75 octets.
    expect(file).toContain('DTEND;VALUE=DATE:20270101');
    expect(lines.every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
    expect(lines.some((l) => l.startsWith(' '))).toBe(true);
    expect(file.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});
