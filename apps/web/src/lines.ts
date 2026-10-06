import { KNOWN_PLATFORMS, platformInText } from '@squirrelcade/core';

/** Whether typed text is a barcode (8 to 14 digits, spaces and dashes allowed) rather than a title. */
export const isBarcode = (text: string) => /^[\d\s-]{8,20}$/.test(text.trim()) && text.replace(/\D/g, '').length >= 8;

/** A line of a pasted list: the title asked about and the console named in it, if any; or a barcode. */
export interface Line {
  text: string;
  title: string;
  platformKey: string | null;
  barcode?: string;
}

/**
 * A line's title and console: "Chrono Trigger (SNES)", "Chrono Trigger [Super Nintendo]" and
 * "Chrono Trigger - SNES" name the console; a line without one asks about every console. A line of digits
 * is a barcode (what a handheld scanner types).
 */
export function parseLine(text: string): Line {
  const line = text.trim();
  if (isBarcode(line)) return { text: line, title: line, platformKey: null, barcode: line.replace(/\D/g, '') };
  const parts = /^(.*?)\s*(?:\(([^()]*)\)|\[([^[\]]*)\]|\s[-–—|]\s+(.*))$/.exec(line);
  const tail = parts ? (parts[2] ?? parts[3] ?? parts[4] ?? '') : '';
  const key = tail ? platformInText(tail, KNOWN_PLATFORMS) : null;
  if (parts && key && parts[1]!.trim()) return { text: line, title: parts[1]!.trim(), platformKey: key };
  return { text: line, title: line, platformKey: null };
}
