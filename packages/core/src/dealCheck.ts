import { consoleEditionIn, platformInText } from './catalogList.js';
import { MARK_DRAWINGS } from './markDrawings.js';
import { consoleMark, markInk, markPixels } from './marks.js';
import { PLATFORM_SHORT_NAMES, regionalConsole } from './platforms.js';
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

/** Stores' own short names for consoles, beside PLATFORM_SHORT_NAMES ("DRAGON QUEST III HD-2D Remake (NSW)" on Amazon). */
const STORE_SHORT_NAMES: Record<string, string[]> = {
  'nintendo-switch': ['nsw', 'ns1', 'switch 1'],
  'nintendo-switch-2': ['nsw2', 'ns2', 'switch2'],
  'playstation-5': ['ps 5'],
  'playstation-4': ['ps 4'],
  'xbox-series-x': ['xbsx', 'xbox series x s', 'xbox series x|s'],
  'xbox-one': ['xb1', 'xbo'],
};

/** Every name a console goes by, longest first, for taking them out of a piece of a title. */
function consoleNames(platforms: readonly PlatformLike[]): string[] {
  const names = new Set<string>();
  for (const p of platforms) for (const n of [p.name, ...(p.labels ?? []), ...(PLATFORM_SHORT_NAMES[p.key] ?? []), ...(STORE_SHORT_NAMES[p.key] ?? [])]) {
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

/** True when `letters` are the first letters of words of `title`, in order ("GTA" in "Grand Theft Auto V"). */
function initialsOf(title: string, letters: string): boolean {
  const firsts = title.split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0]!.toLowerCase()).join('');
  let i = 0;
  for (const c of firsts) if (c === letters[i]?.toLowerCase()) i++;
  return i === letters.length && letters.length >= 2;
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
  // Sellers' decoration ("** Factory Sealed **") isn't words; a maker and its console before the title ("Sony PlayStation
  // 3 PS3 Yakuza 4") is the console (read below from the whole text): a game's name never starts with both.
  const whole = t;
  t = t.replace(/[*~!]{2,}|\s[*~!]+(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:sony\s+(?:playstation\s?[1-5]|ps\s?vita|playstation\s+vita)|microsoft\s+xbox(?:\s+(?:360|one|series\s+[xs](?:\s?\|\s?s)?))?|nintendo\s+(?:gamecube|wii\s?u|wii|3ds|ds|64))\b[\s:\-–|]+(?=\S)/i, '');
  t = t.replace(/^(ps[1-5]|ps ?vita|nsw2?|ns[12]|x360|xb1|xbo|xsx)\s+(?=\S)/i, '');

  // "Hollow Knight - Nintendo Switch 2 Edition": that edition is the console, not the title's words.
  let platformKey: string | null = null;
  const edition = consoleEditionIn(t, platforms);
  if (edition) {
    platformKey = edition.platformKey;
    t = edition.title;
  }
  const withNs2 = platforms.map((p) => (p.key === 'nintendo-switch-2' ? { ...p, labels: [...(p.labels ?? []), 'NS2', 'NSW2'] } : p));
  platformKey ??= platformInText(t, withNs2) ?? platformInText(whole, withNs2);
  const platformFrom: ListingRead['platformFrom'] = platformKey ? 'title' : hint && platformInText(hint, withNs2) ? 'hint' : null;
  if (!platformKey && hint) platformKey = platformInText(hint, withNs2);

  const names = consoleNames(platforms);
  t = t.replace(/\b(?:standard|physical|retail)\s+(?:edition|version|copy)\b/gi, ' ').replace(/\bvideo\s*games?\b/gi, ' ').replace(/\s+/g, ' ').trim();
  // Brackets that hold only a console and the store's words go: "(Nintendo Switch, 2017)", "[Game-Key Card]".
  t = t.replace(/\s*[([{]([^()[\]{}]*)[)\]}]/g, (whole, inside: string) => (storeOnly(inside, names) || GAME_KEY_CARD.test(inside) ? ' ' : whole));
  // What comes with the game in brackets ("(with Undead Nightmare DLC)", "(Includes Season Pass)", "(+ Bonus Disc)") is
  // the same game with extras.
  t = t.replace(/\s*[([](?:with|w\/|includes?|incl\.?|including|plus|\+)\s[^()[\]]*[)\]]|\s*[([][^()[\]]*(?:dlc|bonus|season pass|pre-?order)[^()[\]]*[)\]]/gi, ' ').replace(/\s+/g, ' ').trim();
  // A nickname in brackets made of the title's initials ("Grand Theft Auto V (GTA 5)", "(BOTW)") is the same name again.
  t = t.replace(/\s*\(([A-Za-z]{2,6})\s?(\d{0,2}|[IVX]{1,4})\)/g, (whole, letters: string, _n: string, at: number) => (initialsOf(t.slice(0, at), letters) ? ' ' : whole)).replace(/\s+/g, ' ').trim();
  // A title of several commas is a store's list of facts ("LEGO Harry Potter Collection, Warner Bros, Nintendo
  // Switch, Adventure, Action"): the game is the first of them.
  if ((t.match(/,\s/g) ?? []).length >= 2) t = t.slice(0, t.search(/,\s/));
  // Pieces after a dash, a bar or a comma go when they're only a console and the store's words.
  const pieces = t.split(/\s+[-–—|]\s+|\s*[|–—]\s*|,\s+/);
  // A first piece that's only a console ("NSW - PERSONA 4 GOLDEN", as eBay sellers write) goes too, when more follows.
  const first = pieces.length > 1 && storeOnly(pieces[0]!, names) ? pieces.slice(1) : pieces;
  // A console's short code before the title ("PS3 Teslagrad"): only codes no game's name starts with.
  first[0] = first[0]!.replace(/^(ps[1-5]|ps ?vita|nsw2?|ns[12]|x360|xb1|xbo|xsx)\s+(?=\S)/i, '');
  const kept = [first[0]!, ...first.slice(1).filter((p) => !storeOnly(p, names) && !GAME_KEY_CARD.test(p))];
  t = kept.join(' - ');
  // A console's full name in the middle of a title: what follows is a store's facts ("Pokemon Legends: Arceus Nintendo
  // Switch Role-Playing Game Cards"). A title that starts with one (Nintendo Switch Sports, Sega Genesis Classics) keeps
  // it, and short names (DS, DC) don't count here: they're words of titles too.
  const fullNames = [...new Set(platforms.flatMap((p) => [p.name, ...(p.labels ?? [])]).map((n) => norm(n).trim()).filter((n) => n.includes(' ')))];
  let cut = -1;
  for (const n of fullNames) {
    const m = new RegExp(`(^|[^a-z0-9])${n.split(' ').join('[^a-z0-9]+')}(?![a-z0-9])`, 'i').exec(t);
    if (m && t.slice(0, m.index).trim().split(/\s+/).length >= 2 && (cut < 0 || m.index < cut)) cut = m.index;
  }
  // So does a console's short code no game's name uses ("Uncharted 2: Among Thieves PS3 w/ Manual T-Teen 2009").
  const code = /(^|[\s:(\[\-–])(?:ps[1-5]|ps ?vita|nsw2?|ns[12]|x360|xb1|xbo|xsx)(?![a-z0-9])/i.exec(t);
  if (code && t.slice(0, code.index).trim().split(/\s+/).length >= 2 && (cut < 0 || code.index < cut)) cut = code.index;
  if (cut > 0) {
    // A printing's label in brackets after it stays: "[Game of the Year Greatest Hits]" is how the copy is matched.
    const label = [...t.slice(cut).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!).find((x) => /game of the year|greatest hits|platinum|player'?s choice|selects|essentials|playstation hits/i.test(x));
    t = t.slice(0, cut).replace(/[\s:,\-–—|(]+$/, '') + (label ? ` [${label}]` : '');
  }
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

/** A faded mark's grey (the web's --sc-mark-off in light mode). */
const MARK_OFF = '#b4b4b9';

/**
 * A console's mark as a standalone SVG, drawn as the web app's ConsoleMark draws it (D185): its drawing in its color
 * where you have the game, grey where you don't; the pixel mark for a console without a drawing. For pages that aren't
 * Squirrelcade's own (the Deal check extension), so a store's page shows the same marks. `size` is its height.
 */
export function markSvg(platformKey: string, name: string, owned: boolean, size = 14): string {
  const label = `${name} (${owned ? 'owned' : 'unowned'})`.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const drawing = MARK_DRAWINGS[platformKey] ?? MARK_DRAWINGS[regionalConsole(platformKey)?.base ?? ''];
  if (drawing) {
    const id = `m${platformKey.replace(/[^a-z0-9]/gi, '')}${owned ? 1 : 0}`;
    const body = (owned ? drawing.svg : (drawing.faded ?? drawing.svg).replace(/fill="#(?!fff"|000")[0-9a-f]{3,6}"/gi, 'fill="currentColor"')).replaceAll('__ID__', id);
    const width = Math.round((size / 24) * drawing.width * 10) / 10;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${drawing.width} 24" width="${width}" height="${size}" role="img" aria-label="${label}" style="color:${owned ? drawing.color : MARK_OFF};overflow:visible;flex:none"><title>${label}</title>${body}</svg>`;
  }
  const mark = consoleMark(platformKey, name);
  const rows = markPixels(mark);
  // The tile fills the mark's height, as a drawn mark and the Stash's chest do (D247).
  const height = rows.length;
  const width = Math.max(...rows.map((r) => r.length));
  const ink = markInk(mark.color);
  let cells = '';
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      let fill: string | null;
      if (mark.icon) fill = owned ? (mark.icon.colors['ABCDEFGH'.indexOf(ch)] ?? mark.color) : MARK_OFF;
      else if (owned) fill = ch === '+' ? ink : mark.color;
      else fill = ch === '+' ? null : MARK_OFF;
      if (fill) cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
    }),
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${Math.round((size / height) * width * 10) / 10}" height="${size}" role="img" aria-label="${label}" shape-rendering="crispEdges" style="flex:none"><title>${label}</title>${cells}</svg>`;
}

/** Consoles in the order a badge shows them: the newest first, PC at the right end (the marks' rule, D175). */
export function markOrder(keys: readonly string[]): string[] {
  const year = (k: string) => (k === 'pc' ? -1 : (consoleMark(k).year ?? 0));
  return [...new Set(keys)].sort((a, b) => year(b) - year(a) || a.localeCompare(b));
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
