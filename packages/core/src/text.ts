/**
 * Normalizes a game title for exact comparison: lowercase, accents removed,
 * "&" read as "and", punctuation dropped, spaces collapsed. Two titles that
 * normalize the same are treated as the same text, never as a fuzzy match.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Whether a title is written in the Latin alphabet (accented letters, digits and punctuation
 * included). Keys can't compare titles in other scripts: normalizing drops their letters and
 * keeps only digits or stray Latin letters ("デッドオアアライブ2" becomes "2").
 */
export function latinTitle(title: string): boolean {
  return !/\p{L}/u.test(title.replace(/\p{Script=Latin}/gu, ''));
}

const ROMAN: Record<string, number> = {
  ii: 2, iii: 3, iv: 4, vi: 6, vii: 7, viii: 8, ix: 9, xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16,
};
/** Words after which a lone I, V or X is a number ("Part I", "Chapter V"). */
const NUMBERED = new Set(['part', 'chapter', 'episode', 'volume', 'vol', 'act', 'book', 'disc']);

/**
 * A stricter key for deciding whether two titles are the same game written
 * differently, as catalogs and PriceCharting often do: "The Elder Scrolls V:
 * Skyrim" / "Elder Scrolls V: Skyrim", "Spiderman 3" / "Spider-Man 3", "Dragon
 * Age II" / "Dragon Age 2", "NASCAR 14" / "NASCAR 2014", "Warhammer 40,000" /
 * "Warhammer 40000", "Tony Hawk's Project 8" / "Tony Hawk Project 8", "Rock
 * Band 2 (game only)" / "Rock Band 2", "Tom Clancy's Rainbow Six: Vegas" /
 * "Rainbow Six Vegas". Only for comparing; stored keys use normalizeTitle.
 * A lone X is only a number after words like "Part", so "Mega Man X" never
 * meets "Mega Man 10".
 */
export function matchKey(title: string): string {
  return matchTokens(title).join('');
}

/** The words behind matchKey, with numbers written as digits ("Tomb Raider II" -> tomb, raider, 2). */
export function matchTokens(title: string): string[] {
  const prepared = title
    .replace(/['’`]s\b/gi, '')
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/\((?:game only|the)\)\s*$/i, '');
  const tokens = normalizeTitle(prepared).split(' ').filter(Boolean);
  if (tokens[0] === 'the' && tokens.length > 1) tokens.shift();
  if (tokens.at(-1) === 'the' && tokens.length > 1) tokens.pop();
  if (tokens[0] === 'tom' && tokens[1] === 'clancys' && tokens.length > 2) tokens.splice(0, 2);
  if (tokens[0] === 'tom' && tokens[1] === 'clancy' && tokens.length > 2) tokens.splice(0, 2);
  // PriceCharting leaves out "The Legend of" and the subtitle's article ("Zelda Minish Cap", "Zelda Link to the Past");
  // the first game keeps its whole name.
  if (tokens[0] === 'legend' && tokens[1] === 'of' && tokens[2] === 'zelda' && tokens.length > 3) tokens.splice(0, 2);
  if (tokens[0] === 'zelda' && (tokens[1] === 'the' || tokens[1] === 'a') && tokens.length > 2) tokens.splice(1, 1);
  const out = tokens.map((t, i) => {
    if (ROMAN[t]) return String(ROMAN[t]);
    const lone = t === 'i' ? 1 : t === 'v' ? 5 : t === 'x' ? 10 : 0;
    if (lone && (NUMBERED.has(tokens[i - 1] ?? '') || (i === tokens.length - 1 && i > 0 && t !== 'x'))) return String(lone);
    if (/^(19[7-9]\d|20[0-3]\d)$/.test(t)) return t.slice(2);
    return t;
  });
  return out;
}

/**
 * A looser key for Japanese titles romanized differently, for comparing only: long vowels written out
 * or not ("Chou Makaimura" / "Chō Makaimura" / "Cho Makaimura", "Yakyuu" / "Yakyū", "Oozumou" / "Ōzumō"),
 * n or m before b, m and p ("Ganbare" / "Gambare") and the particle "wo" written "o". matchKey already
 * drops the macrons; this also folds "ou", "oo" and "uu", which English words have too ("Soul", "Moon"),
 * so matching uses it on its own only where the titles are Japanese.
 */
export function romajiKey(title: string): string {
  return romajiTokens(matchTokens(title)).join('');
}

/** Words with Japanese long vowels, n before b, m and p, and the particle "wo" folded (see romajiKey). */
export function romajiTokens(tokens: readonly string[]): string[] {
  return tokens.map((t) => (t === 'wo' ? 'o' : t.replace(/ou|oo/g, 'o').replace(/uu/g, 'u').replace(/m(?=[bmp])/g, 'n')));
}

/** URL-safe key: "Nintendo Switch 2" -> "nintendo-switch-2". */
export function slugify(text: string): string {
  return normalizeTitle(text).replace(/ /g, '-');
}
