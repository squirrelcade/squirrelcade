import { decodeEntities, wikiDate } from './wikipedia.js';

/**
 * Nintendo Life's lists of Nintendo Switch 2 physical releases, read as a catalog source (see
 * sources.ts): one guide lists the confirmed Game-Key Cards, the other the games with the full game
 * on the card. Nintendo Life adds only officially confirmed releases, not retailer listings.
 */

/** A Switch 2 card's format as Squirrelcade records it (the same words as a list's Format column). */
export type CardFormat = 'Game-Key Card' | 'Full Game Card';

/** Nintendo Life's two guide pages, and the format of the games each lists. */
export const NINTENDO_LIFE_PAGES: readonly { url: string; format: CardFormat }[] = [
  { url: 'https://www.nintendolife.com/guides/every-nintendo-switch-2-game-key-card-release', format: 'Game-Key Card' },
  { url: 'https://www.nintendolife.com/guides/every-nintendo-switch-2-physical-release-with-the-full-game-on-the-cart', format: 'Full Game Card' },
];

/** A confirmed Switch 2 physical release on one of Nintendo Life's lists. */
export interface NintendoLifeGame {
  title: string;
  format: CardFormat;
  /** As Squirrelcade stores dates ("2026-12-10", "2027-03"), "TBA", or null. */
  releaseDate: string | null;
  /** Listed as a Japanese release (it may be a full card elsewhere). */
  japan: boolean;
  /** Nintendo Life's note on it, such as "This is not a Game-Key release in the West". */
  note: string | null;
}

const text = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** "10th Dec 2026" -> 2026-12-10, "Mar 2027" -> 2027-03, "TBA" -> TBA. */
function nlDate(value: string): string | null {
  const t = value.trim();
  if (!t) return null;
  if (/^(tba|tbc|tbd)$/i.test(t)) return 'TBA';
  return wikiDate(t.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1'));
}

/**
 * The confirmed games on one of Nintendo Life's guide pages: the list items under a heading that says
 * "Confirmed" (the rumoured ones are left out), each a link to the game's Nintendo Life page followed
 * by its date and publisher ("10th Dec 2026 / Koei Tecmo"). A heading ending "(Japan)" holds Japanese
 * releases. The page's contents, related articles and questions are skipped.
 */
export function nintendoLifeGames(html: string, format: CardFormat): NintendoLifeGame[] {
  const out: NintendoLifeGame[] = [];
  let section: string | null = null;
  for (const m of html.matchAll(/<h([1-4])\b[^>]*>([\s\S]*?)<\/h\1>|<li\b[^>]*>([\s\S]*?)<\/li>/gi)) {
    if (m[2] !== undefined) {
      section = text(m[2]);
      continue;
    }
    if (!section || !/\bconfirmed\b/i.test(section) || /rumou?r/i.test(section)) continue;
    const link = /^\s*<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>([\s\S]*)$/i.exec(m[3] ?? '');
    if (!link || !/games\/nintendo-switch-2\//i.test(link[1]!)) continue;
    const title = text(link[2]!);
    if (!title) continue;
    const rest = link[3]!;
    const em = /<em\b[^>]*>([\s\S]*?)<\/em>/i.exec(rest);
    const note = /\(([^)]+)\)/.exec(text(rest.replace(/<em\b[^>]*>[\s\S]*?<\/em>/gi, '')))?.[1]?.trim();
    out.push({
      title,
      format,
      releaseDate: em ? nlDate(text(em[1]!).split(' / ')[0] ?? '') : null,
      japan: /\(japan\)/i.test(section),
      note: note && !/^switch 2$/i.test(note) ? note : null,
    });
  }
  return out;
}
