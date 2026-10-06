/** An all-day event for a calendar file: a game's release. */
export interface CalendarEvent {
  /** Stable across downloads, so importing the file again updates the event instead of adding another. */
  uid: string;
  /** YYYY-MM-DD. */
  date: string;
  summary: string;
  description?: string;
}

/** Text as an iCalendar value: backslashes, commas, semicolons and line breaks escaped. */
function text(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** A content line folded at 75 octets, continued on lines that start with a space (RFC 5545). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  let limit = 75;
  while (Buffer.byteLength(rest) > limit) {
    let cut = limit;
    while (Buffer.byteLength(rest.slice(0, cut)) > limit) cut--;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
    limit = 74;
  }
  out.push(rest);
  return out.join('\r\n ');
}

/**
 * A calendar file (iCalendar) of all-day events, one per release; events whose date isn't a full day
 * (YYYY-MM-DD) are left out. Lines end in CRLF, as the format asks.
 */
export function calendarFile(name: string, events: CalendarEvent[], now = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Squirrelcade//Coming soon//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${text(name)}`];
  for (const e of events) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
    const day = new Date(`${e.date}T00:00:00Z`);
    if (Number.isNaN(day.getTime())) continue;
    const next = new Date(day.getTime() + 86_400_000).toISOString().slice(0, 10);
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${e.date.replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${next.replace(/-/g, '')}`,
      `SUMMARY:${text(e.summary)}`,
      ...(e.description ? [`DESCRIPTION:${text(e.description)}`] : []),
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** A day as YYYY-MM-DD in a time zone (an install's, so "today" is the owner's day); UTC's for a zone the runtime doesn't know. */
export function dayIn(timeZone: string, at = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** A day (YYYY-MM-DD) moved by some days, earlier when negative. */
export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The same day some years earlier (a February 29 lands on March 1 in a year without one). */
export function yearsBefore(day: string, years: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y! - years, m! - 1, d!)).toISOString().slice(0, 10);
}
