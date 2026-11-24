import { consoleEditionIn, platformInText } from './catalogList.js';
import { PLATFORM_SHORT_NAMES } from './platforms.js';
import { romanNumerals } from './text.js';

/**
 * Deal check (D245): a store's listing title ("WWE 2K26 - Nintendo Switch 2 Standard Edition", "Super Mario Odyssey
 * (Nintendo Switch, 2017) Brand New Sealed") read into the game's title, the console it names and what kind of copy
 * it says it is, so the browser extension and the Deal check page can ask the matcher about the game itself.
 */

/** What a listing says about the copy, beside the game. */
export type ListingFlag = 'game-key-card' | 'code-in-box' | 'digital';

export const LISTING_FLAG_LABELS: Record<ListingFlag, string> = {
  'game-key-card': 'Game-Key Card',
  'code-in-box': 'Code in box',
  digital: 'Digital',
};

export interface ListingRead {
  /** The game's title, without the console, the store's words and the copy's kind. */
  title: string;
  /** The console the listing (or the page's hint) names, when it names one. */
  platformKey: string | null;
  /** Where the console came from: the title itself, the page's hint, or nowhere. */
  platformFrom: 'title' | 'hint' | null;
  flags: ListingFlag[];
}

type PlatformLike = { key: string; name: string; labels?: readonly string[] };

const GAME_KEY_CARD = /game[\s-]*key[\s-]*card/i;
const CODE_IN_BOX = /code[\s-]+in[\s-]+(?:a[\s-]+)?box/i;
const DIGITAL = /\b(?:digital(?:\s+(?:code|download|edition|version|copy|key))?|download\s+code|e-?mail(?:ed)?\s+delivery|online\s+game\s+code)\b/i;

/** Words a store adds that aren't the game's ("Standard Edition", "Physical", "Brand New Sealed", "Rated T"). */
const STORE_WORDS = new Set(
  [
    'standard', 'edition', 'physical', 'video', 'videogame', 'game', 'games', 'version', 'disc', 'disk', 'cartridge', 'cart',
    'card', 'key', 'code', 'in', 'box', 'boxed', 'a', 'for', 'the', 'and', 'with', 'of', 'on',
    'rated', 'esrb', 'e', 'e10', 't', 'm', 'rp', 'everyone', 'teen', 'mature', '10',
    'english', 'us', 'usa', 'u', 's', 'north', 'america', 'american', 'ntsc', 'region', 'free', 'import', 'version',
    'new', 'brand', 'sealed', 'factory', 'mint', 'sealed', 'complete', 'cib', 'tested', 'works', 'great', 'condition',
    'used', 'pre', 'owned', 'preowned', 'refurbished', 'only', 'included', 'includes', 'digital', 'download', 'delivery',
    'email', 'online', 'console', 'exclusive', 'nintendo', 'sony', 'microsoft', 'sega', 'xbox', 'playstation',
  ].map((w) => w.toLowerCase()),
);

const norm = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** Every name a console goes by, longest first, for taking them out of a piece of a title. */
function consoleNames(platforms: readonly PlatformLike[]): string[] {
  const names = new Set<string>();
  for (const p of platforms) for (const n of [p.name, ...(p.labels ?? []), ...(PLATFORM_SHORT_NAMES[p.key] ?? [])]) {
    const w = norm(n).trim();
    if (w) names.add(w);
  }
  return [...names].sort((a, b) => b.length - a.length);
}

/** True when a piece of a listing's title is only a console's name and the store's words ("Nintendo Switch 2, 2025"). */
function storeOnly(piece: string, names: readonly string[]): boolean {
  let t = norm(piece);
  for (const n of names) t = t.split(` ${n} `).join(' ');
  return t
    .trim()
    .split(' ')
    .filter(Boolean)
    .every((w) => STORE_WORDS.has(w) || /^(19|20)\d\d$/.test(w) || /^\d+(gb|tb)$/.test(w));
}

/**
 * A listing's title read into the game, its console and the kind of copy. `hint` is a console the page names around
 * the listing (Amazon's "Nintendo Switch 2" under a result, a search for "switch 2 games"); a console the title itself
 * names wins over it.
 */
export function readListing(text: string, platforms: readonly PlatformLike[], hint?: string | null): ListingRead {
  const flags: ListingFlag[] = [];
  let t = text.replace(/[™®©]/g, '').replace(/\s+/g, ' ').trim();
  if (GAME_KEY_CARD.test(t)) flags.push('game-key-card');
  if (CODE_IN_BOX.test(t)) flags.push('code-in-box');
  else if (!flags.includes('game-key-card') && DIGITAL.test(t)) flags.push('digital');

  // "Hollow Knight - Nintendo Switch 2 Edition": that edition is the console, not the title's words.
  let platformKey: string | null = null;
  const edition = consoleEditionIn(t, platforms);
  if (edition) {
    platformKey = edition.platformKey;
    t = edition.title;
  }
  const withNs2 = platforms.map((p) => (p.key === 'nintendo-switch-2' ? { ...p, labels: [...(p.labels ?? []), 'NS2', 'NSW2'] } : p));
  platformKey ??= platformInText(t, withNs2);
  const platformFrom: ListingRead['platformFrom'] = platformKey ? 'title' : hint && platformInText(hint, withNs2) ? 'hint' : null;
  if (!platformKey && hint) platformKey = platformInText(hint, withNs2);

  const names = consoleNames(platforms);
  t = t.replace(/\b(?:standard|physical|retail)\s+(?:edition|version|copy)\b/gi, ' ').replace(/\bvideo\s*games?\b/gi, ' ').replace(/\s+/g, ' ').trim();
  // Brackets that hold only a console and the store's words go: "(Nintendo Switch, 2017)", "[Game-Key Card]".
  t = t.replace(/\s*[([{]([^()[\]{}]*)[)\]}]/g, (whole, inside: string) => (storeOnly(inside, names) || GAME_KEY_CARD.test(inside) ? ' ' : whole));
  // A title of several commas is a store's list of facts ("LEGO Harry Potter Collection, Warner Bros, Nintendo
  // Switch, Adventure, Action"): the game is the first of them.
  if ((t.match(/,\s/g) ?? []).length >= 2) t = t.slice(0, t.search(/,\s/));
  // Pieces after a dash, a bar or a comma go when they're only a console and the store's words.
  const pieces = t.split(/\s+[-–—|]\s+|\s*[|–—]\s*|,\s+/);
  const kept = [pieces[0]!, ...pieces.slice(1).filter((p) => !storeOnly(p, names) && !GAME_KEY_CARD.test(p))];
  t = kept.join(' - ');
  // A console's name or the store's words left at the end ("Super Mario Odyssey Nintendo Switch Brand New").
  for (let changed = true; changed; ) {
    changed = false;
    const lower = norm(t);
    for (const n of names) {
      if (lower.endsWith(` ${n} `) && lower.trim() !== n) {
        t = t.replace(new RegExp(`[\\s:,(\\[-]*${n.split(' ').join('[^a-z0-9]+')}[\\s)\\].]*$`, 'i'), '');
        changed = true;
        break;
      }
    }
    if (changed) continue;
    const last = /(?:^|\s)([A-Za-z0-9+]+)[\s.)\]]*$/.exec(t);
    if (last && t.trim().split(/\s+/).length > 1 && STORE_WORDS.has(last[1]!.toLowerCase()) && !/^(the|a|of|and|on|in|edition|version)$/i.test(last[1]!)) {
      t = t.slice(0, last.index).replace(/[\s:,\-–—|(]+$/, '');
      changed = true;
    }
  }
  const title = t.replace(/\s+/g, ' ').replace(/^[\s:,\-–—|]+|[\s:,\-–—|]+$/g, '').trim();
  return { title: title || text.trim(), platformKey, platformFrom, flags };
}

/**
 * True when two titles number different games ("WWE 2K26" and "WWE 2K25", "Final Fantasy VII" and "Final Fantasy
 * VIII"): both have numbers, and not the same ones. Such a near miss is another game, not this one under another name.
 */
export function numbersDiffer(a: string, b: string): boolean {
  const numbers = (t: string) => [...(t.match(/\d+/g) ?? []).map(Number), ...romanNumerals(t)].sort((x, y) => x - y).join(' ');
  const na = numbers(a);
  const nb = numbers(b);
  return na !== '' && nb !== '' && na !== nb;
}

/** How sure a deal check is of its answer: green, yellow or red on the page (D245). */
export type Sureness = 'sure' | 'likely' | 'unsure';

/**
 * How sure an answer is. Owned: by the best match's confidence (`sureAt` and up is sure). Not owned: by the closest
 * near miss on that console (none, or below `likelyAt`'s neighbour, is sure; a near miss at `likelyAt` or more could be
 * the game under another name, so unsure). Without a console to go by, never more than likely. Cut-offs are 0 to 1.
 */
export function surenessOf(a: { owned: boolean; confidence: number | null; nearMiss: number | null; consoleKnown: boolean; sureAt: number; unsureAt: number }): Sureness {
  let s: Sureness;
  if (a.owned) s = (a.confidence ?? 0) >= a.sureAt ? 'sure' : 'likely';
  else if (a.nearMiss === null) s = 'sure';
  else s = a.nearMiss >= a.unsureAt ? 'unsure' : 'likely';
  return s === 'sure' && !a.consoleKnown ? 'likely' : s;
}
