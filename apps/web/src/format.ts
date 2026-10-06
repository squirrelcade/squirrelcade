import type { SettingsValues } from '@squirrelcade/core';

/** An amount in cents as money in the given currency; a dash when there is none. */
export function money(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: currency === 'JPY' ? 0 : 2 }).format(
    currency === 'JPY' ? cents : cents / 100,
  );
}

/** An amount in cents as money without cents, for totals. */
export function wholeMoney(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).format(currency === 'JPY' ? cents : cents / 100);
}

/** A number with thousands separators. */
export function count(n: number): string {
  return new Intl.NumberFormat().format(n);
}

/** Formats a date (YYYY-MM-DD or ISO time) in the chosen date format. */
export function date(value: string | null | undefined, format: SettingsValues['general.dateFormat'] = 'us'): string {
  if (!value) return '—';
  const d = value.length === 10 ? new Date(`${value}T12:00:00`) : new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  if (format === 'iso') return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  if (format === 'eu') return `${String(day).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
  return `${m}/${day}/${y}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A catalog game's release date as precise as its source gave it: "2026", "Oct 2026" (2026-10 in the
 * ISO format), or a full date in the chosen format; words such as "TBA" as written. (Read as a full
 * date, "2026" would be midnight on January 1 in UTC: the last day of 2025 in the Americas.)
 */
export function releaseDate(value: string | null | undefined, format: SettingsValues['general.dateFormat'] = 'us'): string {
  if (!value) return '—';
  if (/^\d{4}$/.test(value)) return value;
  const month = /^(\d{4})-(\d{2})$/.exec(value);
  if (month) return format === 'iso' ? value : `${MONTHS[Number(month[2]) - 1] ?? month[2]} ${month[1]}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return date(value, format);
  return value;
}

/** A date and time in the chosen date format (Settings > General). */
export function dateTime(value: string | null | undefined, format: SettingsValues['general.dateFormat'] = 'us'): string {
  if (!value) return '—';
  const d = new Date(value);
  return `${date(value, format)} ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/** How long ago (or how soon) a moment is, in words: "5 minutes ago". */
export function timeAgo(value: string | null | undefined): string {
  if (!value) return 'never';
  const seconds = Math.round((Date.now() - Date.parse(value)) / 1000);
  const future = seconds < 0;
  const s = Math.abs(seconds);
  const [n, unit] =
    s < 60 ? [s, 'second'] : s < 3600 ? [Math.round(s / 60), 'minute'] : s < 86400 ? [Math.round(s / 3600), 'hour'] : [Math.round(s / 86400), 'day'];
  if (s < 10) return future ? 'in a moment' : 'just now';
  const text = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return future ? `in ${text}` : `${text} ago`;
}

/** A size in bytes as B, KB, MB, GB or TB. */
export function bytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

/** A task's schedule in words: "Every 15 minutes", or "Manual only". */
export function interval(ms: number | null): string {
  if (ms === null) return 'Manual only';
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `Every ${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `Every ${hours} hour${hours === 1 ? '' : 's'}`;
  return `Every ${Math.round(hours / 24)} days`;
}
