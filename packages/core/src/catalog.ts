import { matchKey, matchTokens, romajiKey, romajiTokens } from './text.js';

/**
 * Catalog matching: which of a platform's catalog targets the collection owns.
 * Matching is deterministic. A target counts as owned only through an exact
 * (normalized) title, a PriceCharting edition variant of it, a reviewed mapping
 * or a link the user confirmed. Anything that merely looks similar becomes a
 * suggestion for review, never an automatic match.
 */

/**
 * unconfirmed: a list names the game but nothing shows it had a physical release yet (a game the list
 * marks as a download title, or any game on consoles whose lists include download-only games). Listed,
 * but not counted or recommended until confirmed.
 * upcoming: not out yet, when Settings > Catalogs and matching keeps such games apart (by default they count as missing).
 * Listed, but not counted or recommended until the release date passes.
 */
export type TargetStatus = 'required' | 'optional' | 'review' | 'excluded' | 'unconfirmed' | 'upcoming' | 'extra';
/** A catalog game after matching: owned, missing, waiting for a review answer, excluded, not confirmed as a physical release, or not out yet. */
export type MatchStatus = 'owned' | 'missing' | 'review' | 'excluded' | 'unconfirmed' | 'upcoming' | 'extra';

/**
 * Whether a catalog game is still to come on a day (YYYY-MM-DD): announced without a date ("TBA" in a
 * list), or dated after that day. A partial date counts from its first day: "2026-12" is upcoming in
 * September 2026, "2026" only before 2026 (a game dated just by the current year may be out already).
 * Games without a date count as out.
 */
export function isUpcoming(releaseDate: string | null | undefined, today: string): boolean {
  const d = releaseDate?.trim();
  if (!d) return false;
  if (/^(tba|tbd|tbc|to be announced|to be determined|coming soon|upcoming|announced)$/i.test(d)) return true;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(d);
  return m !== null && `${m[1]}-${m[2] ?? '01'}-${m[3] ?? '01'}` > today;
}

/** Whether a catalog game's format (a list's Format column) is a Nintendo Switch 2 Game-Key Card: a cartridge holding only a download key. */
export function isGameKeyCard(format: string | null | undefined): boolean {
  return /game[\s-]*key[\s-]*card/i.test(format ?? '');
}
/**
 * How an owned copy counts as a catalog game. exact: the same title; variant: an edition of it;
 * alias: one of the game's other names (a retitle, another region's title); spelling: the same Japanese
 * title romanized differently ("Jikkyou" / "Jikkyō"), on catalogs of Japanese titles; short: the title without
 * its subtitle, when Settings > Catalogs and matching counts those ("Doraemon 2" for "Doraemon 2: Nobita no..."); mapping: a reviewed
 * mapping; confirmed: the user said so; pending: bought (marked in Store Mode) and not yet in a collection export.
 */
export type MatchMethod = 'exact' | 'variant' | 'alias' | 'spelling' | 'short' | 'mapping' | 'confirmed' | 'pending' | 'crossgen';

/** A game in a console's catalog, as matching sees it. */
export interface CatalogTarget {
  id: number;
  title: string;
  status: TargetStatus;
  /** Other names the game goes by (another region's title, a retitle): owning any of them is owning the game. */
  altTitles?: readonly string[];
}

/** A product in the collection: every copy of one PriceCharting product. */
export interface OwnedProduct {
  productId: string;
  title: string;
  copies: number;
}

/** A reviewed rule that an owned product counts as a catalog game, such as one part of a compilation. */
export interface OwnershipMapping {
  /** Title of the owned product, as in the collection. */
  ownedTitle: string;
  /** Catalog title it satisfies. */
  satisfies: string;
  /** "yes" counts as owned; "conditional" goes to review; "no" is ignored. */
  counts: 'yes' | 'conditional' | 'no';
}

/** The user's answer about a catalog game and an owned product: the same game, or not. */
export interface Decision {
  targetId: number;
  productId: string;
  decision: 'confirmed' | 'rejected';
}

/** One catalog game after matching: its status, the owned products that count as it, and look-alikes to review. */
export interface TargetResult {
  target: CatalogTarget;
  status: MatchStatus;
  matches: { productId: string; title: string; method: MatchMethod }[];
  suggestions: { productId: string; title: string; reason: string }[];
  /** Owned products the user said are not this game (they would match as an edition or look-alike). */
  rejected?: { productId: string; title: string }[];
  /** Owned on a neighbor console instead, a cross-generation game (Settings > Catalogs and matching): that console's name. */
  via?: string;
}

/** A console's catalog after matching, with the owned products it doesn't cover and the counts behind completion. */
export interface CatalogMatch {
  targets: TargetResult[];
  /** Owned products that satisfy no target (not in the catalog, or only suggested). */
  unmatched: OwnedProduct[];
  counts: { targets: number; owned: number; missing: number; review: number; excluded: number; unconfirmed: number; upcoming: number; extra: number };
  /** Owned share of the targets that count (required and optional, not unconfirmed or upcoming), 0 to 100. */
  percent: number;
}

/** Matching rules that come from settings, plus the user's ignored products and just-bought marks. */
export interface MatchOptions {
  /**
   * Editions count as the game, both ways: an owned "Title [Greatest Hits]" or
   * "Title: Gold Edition" satisfies "Title", and owning "Title" satisfies a
   * catalog's "Title: Gold Edition" (the old system's "edition variants count").
   */
  variantsSatisfy?: boolean;
  /** Suggest similar titles for review. */
  suggest?: boolean;
  /**
   * Owned products the user said aren't catalog games (demo discs, bundles). They
   * still match a catalog entry with their title but are never listed as unmatched
   * or suggested as a look-alike.
   */
  ignored?: ReadonlySet<string>;
  /** Games marked as just bought, owned until the next export includes them. */
  pending?: { targetId: number; id: number; title: string }[];
  /**
   * The catalog's titles are Japanese (a console of Japan's own, such as the Super Famicom, or a home region
   * of Japan): titles romanized differently count as the same title ("Jikkyou Powerful Pro Yakyuu 3" /
   * "Jikkyō Powerful Pro Yakyū 3"). Elsewhere such pairs are only suggested, since English words fold too.
   */
  romaji?: boolean;
  /**
   * A copy titled like the start of exactly one catalog game, the rest a subtitle after ":" or " - " ("Doraemon 2"
   * for "Doraemon 2: Nobita no Toys Land Daibouken"), counts as that game when their numbers agree. Off by default:
   * such look-alikes are review questions.
   */
  shortTitles?: boolean;
}

/** Where a title's subtitles start: after ":" and after a spaced dash. */
const SUBTITLE_BREAK = /\s*:\s+|\s+[-–—]\s+/g;

/** A title's beginnings before each subtitle ("A: B: C" -> "A", "A: B"); none without a subtitle. */
export function titleStems(title: string): string[] {
  const stems: string[] = [];
  for (const m of baseTitle(title).matchAll(SUBTITLE_BREAK)) if (m.index > 0) stems.push(baseTitle(title).slice(0, m.index));
  return stems;
}

const BRACKET_SUFFIX = /\s*\[[^\]]*\]\s*$/;

/** An owned title suggested for more catalog games than this is too generic to suggest. */
const MAX_SUGGESTIONS_PER_PRODUCT = 5;

/** "Uncharted [Greatest Hits]" -> "Uncharted"; titles without a bracketed suffix are unchanged. */
export function baseTitle(title: string): string {
  let t = title;
  while (BRACKET_SUFFIX.test(t)) t = t.replace(BRACKET_SUFFIX, '');
  return t.trim() || title;
}

/** Words that name an edition when "Edition" follows them without a colon ("Just Dance 2017 Gold Edition"). */
const EDITION_WORDS =
  "gold|deluxe|digital deluxe|super deluxe|collectors|collector's|collector’s|limited|special|launch|day one|game of the year|goty|complete|premium|ultimate|anniversary|signature|standard|steelbook|platinum|legendary|definitive|enhanced|bonus";
const WORD_EDITION = new RegExp(`\\s+(?:${EDITION_WORDS})\\s+edition\\s*$`, 'i');

/** A title without an edition named right after it ("Mafia III Deluxe Edition" -> "Mafia III"); a subtitle before it stays. */
export function withoutEditionWords(title: string): string {
  const stripped = title.replace(WORD_EDITION, '').trim();
  return stripped.length >= 2 ? stripped : title;
}

const EDITION_SUFFIX = new RegExp(`(?:\\s*[:\\-–—]\\s*(?:the\\s+)?[^:\\-–—]{1,40}?\\s+edition|\\s+(?:${EDITION_WORDS})\\s+edition|\\s*[:\\-–—]\\s*director['’]?s\\s+cut)\\s*$`, 'i');

/**
 * The game an edition belongs to: "Just Dance 2016: Gold Edition" -> "Just
 * Dance 2016", "Just Dance 2017 Gold Edition" -> "Just Dance 2017", "Deadly
 * Premonition: Director's Cut" -> "Deadly Premonition". Other titles are unchanged.
 */
export function editionBase(title: string): string {
  const t = baseTitle(title);
  const stripped = t.replace(EDITION_SUFFIX, '').trim();
  return stripped.length >= 2 ? stripped : t;
}

interface Shape {
  compact: string;
  words: string[];
  tokens: Set<string>;
  numbers: string;
}

/** A title's words for comparing, with Japanese long vowels folded when `romaji` (see romajiKey). */
function shape(title: string, romaji = false): Shape {
  const plain = matchTokens(baseTitle(title));
  const words = romaji ? romajiTokens(plain) : plain;
  return { compact: words.join(''), words, tokens: new Set(words), numbers: words.filter((t) => /^\d+$/.test(t)).sort().join(',') };
}

/** Whether `part` is some run of whole words of `words` ("hawx" in tom clancys h a w x; not "moon" in moonstone). */
function containsWords(words: string[], part: string): boolean {
  for (let i = 0; i < words.length; i++) {
    let joined = '';
    for (let j = i; j < words.length && joined.length < part.length; j++) {
      joined += words[j];
      if (joined === part) return true;
    }
  }
  return false;
}

/** One title containing the other, as similarityReason reads it; null when neither does. */
function containment(x: Shape, y: Shape): string | null {
  const [short, long] = x.compact.length <= y.compact.length ? [x, y] : [y, x];
  if (short.compact.length >= 4 && containsWords(long.words, short.compact)) return 'One title contains the other';
  if (short.tokens.size >= 2 && [...short.tokens].every((t) => long.tokens.has(t))) return 'Every word of the shorter title is in the longer one';
  return null;
}

/**
 * Why two titles might be the same game, or null. Numbers must agree ("Doom" is
 * not "Doom 3"); then one title must contain the other ignoring spaces
 * ("HAWX" / "Tom Clancy's H.A.W.X"), or every word of the shorter must appear in
 * the longer ("Beijing 2008" / "Beijing Olympics 2008"). Japanese titles
 * romanized differently compare with their long vowels folded ("Super Kokou
 * Yakyuu" / "Super Kōkō Yakyū: Ichikyuu Jikkon").
 */
export function similarityReason(a: string, b: string): string | null {
  return similarityOf(shapesOf(a), shapesOf(b));
}

/** A title's shapes for similarityReason: as written, and with long vowels folded (worked out when first needed). */
interface TitleShapes {
  title: string;
  plain: Shape;
  folded?: Shape;
}

const shapesOf = (title: string): TitleShapes => ({ title, plain: shape(title) });

/** similarityReason from the titles' shapes, worked out once to compare many titles with many (a match's suggestions). */
function similarityOf(a: TitleShapes, b: TitleShapes): string | null {
  const x = a.plain;
  const y = b.plain;
  if (x.numbers !== y.numbers || x.compact === y.compact) return null;
  const plain = containment(x, y);
  if (plain) return plain;
  const fx = (a.folded ??= shape(a.title, true));
  const fy = (b.folded ??= shape(b.title, true));
  if (fx.numbers !== fy.numbers) return null;
  if (fx.compact === fy.compact) return 'The same title, romanized differently';
  const folded = containment(fx, fy);
  return folded ? `${folded} (romanized differently)` : null;
}

/**
 * Matches a console's catalog against the owned products. A catalog game is owned through the user's
 * confirmations, just-bought marks, the same title written the same way (D21), an edition of it (D22)
 * or a reviewed mapping; a "not the same" answer overrules an edition match. Owned products left over
 * are suggested for games that look alike, as questions for the Review page, never as matches.
 * Excluded and not-confirmed games stay out of the completion counts.
 */
/** Each catalog game's names' shapes, kept with the game (a console's games stay the same objects between matches). */
const TARGET_SHAPES = new WeakMap<CatalogTarget, TitleShapes[]>();

export function matchCatalog(
  targets: CatalogTarget[],
  owned: OwnedProduct[],
  mappings: OwnershipMapping[] = [],
  decisions: Decision[] = [],
  options: MatchOptions = {},
): CatalogMatch {
  const variantsSatisfy = options.variantsSatisfy ?? true;
  const suggest = options.suggest ?? true;

  const byExact = new Map<string, OwnedProduct[]>();
  const byBase = new Map<string, OwnedProduct[]>();
  // Japanese catalogs: owned titles by their romanization-folded keys too.
  const byRomaji = new Map<string, OwnedProduct[]>();
  const add = (map: Map<string, OwnedProduct[]>, key: string, p: OwnedProduct) => {
    const list = map.get(key);
    if (list) list.push(p);
    else map.set(key, [p]);
  };
  for (const p of owned) {
    add(byExact, matchKey(p.title), p);
    if (variantsSatisfy) {
      add(byBase, matchKey(baseTitle(p.title)), p);
      add(byBase, matchKey(editionBase(p.title)), p);
    }
    if (options.romaji) {
      const keys = new Set([romajiKey(p.title), ...(variantsSatisfy ? [romajiKey(baseTitle(p.title)), romajiKey(editionBase(p.title))] : [])]);
      for (const k of keys) if (k) add(byRomaji, k, p);
    }
  }
  const mappingsBySatisfies = new Map<string, OwnershipMapping[]>();
  for (const m of mappings) {
    if (m.counts === 'no') continue;
    const key = matchKey(m.satisfies);
    mappingsBySatisfies.set(key, [...(mappingsBySatisfies.get(key) ?? []), m]);
  }
  const productById = new Map(owned.map((p) => [p.productId, p]));
  const confirmed = new Map<number, string[]>();
  const rejected = new Set<string>();
  // The "not the same game" answers by catalog game, for each game's list of them.
  const rejectedOf = new Map<number, string[]>();
  for (const d of decisions) {
    if (d.decision === 'confirmed') confirmed.set(d.targetId, [...(confirmed.get(d.targetId) ?? []), d.productId]);
    else {
      rejected.add(`${d.targetId}|${d.productId}`);
      rejectedOf.set(d.targetId, [...(rejectedOf.get(d.targetId) ?? []), d.productId]);
    }
  }


  // A copy whose own title (or its title without an edition in brackets) is a catalog game belongs to that game:
  // other games' alternative names don't claim it too. Ownership stays exact: the Super Famicom's Super Donkey
  // Kong, listed in its own right, doesn't make Donkey Kong Country owned; where a catalog has no entry of a
  // copy's own (a Japanese copy in a North American catalog), alternative names still find its game.
  const byOwnTitle = new Map<string, number[]>();
  for (const t of targets) {
    // Another region's release (it counts once owned) never keeps a copy from the catalog's own games.
    if (t.status === 'extra') continue;
    const k = matchKey(t.title);
    if (k) byOwnTitle.set(k, [...(byOwnTitle.get(k) ?? []), t.id]);
  }
  const hasOtherEntry = (p: OwnedProduct, targetId: number) =>
    [matchKey(p.title), ...(variantsSatisfy ? [matchKey(baseTitle(p.title))] : [])].some((k) => (byOwnTitle.get(k) ?? []).some((id) => id !== targetId));

  const used = new Set<string>();
  const results: TargetResult[] = targets.map((target) => {
    const matches: TargetResult['matches'] = [];
    const push = (p: OwnedProduct, method: MatchMethod) => {
      // "Not the same game" answers overrule edition, other-name, spelling and subtitle matches (never exact titles, mappings or confirmations).
      if ((method === 'variant' || method === 'alias' || method === 'spelling' || method === 'short') && rejected.has(`${target.id}|${p.productId}`)) return;
      if (!matches.some((m) => m.productId === p.productId)) matches.push({ productId: p.productId, title: p.title, method });
    };
    const names = [target.title, ...(target.altTitles ?? [])];
    const keys = [...new Set(names.map((n) => matchKey(n)).filter(Boolean))];
    const ownKey = matchKey(target.title);
    for (const id of confirmed.get(target.id) ?? []) {
      const p = productById.get(id);
      if (p) push(p, 'confirmed');
    }
    for (const b of options.pending ?? []) {
      if (b.targetId === target.id) push({ productId: `pending:${b.id}`, title: b.title, copies: 1 }, 'pending');
    }
    // By an alternative name, only copies without a catalog game of their own.
    const byName = (p: OwnedProduct, key: string) => key === ownKey || !hasOtherEntry(p, target.id);
    for (const key of keys) for (const p of byExact.get(key) ?? []) if (byName(p, key)) push(p, key === ownKey ? 'exact' : 'alias');
    if (variantsSatisfy) {
      const seen = new Set<string>();
      for (const name of names) {
        const key = matchKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        const method = key === ownKey ? 'variant' : 'alias';
        for (const p of byBase.get(key) ?? []) if (byName(p, key)) push(p, method);
        const edition = matchKey(editionBase(name));
        if (edition !== key) for (const p of [...(byExact.get(edition) ?? []), ...(byBase.get(edition) ?? [])]) if (byName(p, key)) push(p, method);
      }
    }
    // The same title romanized differently, on Japanese catalogs: only copies without a catalog game of their own.
    if (options.romaji) {
      const seen = new Set<string>();
      for (const name of names) {
        const key = romajiKey(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        for (const p of byRomaji.get(key) ?? []) if (!hasOtherEntry(p, target.id)) push(p, 'spelling');
      }
    }
    let conditional = false;
    for (const key of keys) {
      for (const m of mappingsBySatisfies.get(key) ?? []) {
        for (const p of byExact.get(matchKey(m.ownedTitle)) ?? []) {
          if (m.counts === 'yes') push(p, 'mapping');
          else conditional = true;
        }
      }
    }
    for (const m of matches) used.add(m.productId);
    let status: MatchStatus;
    if (target.status === 'excluded') status = 'excluded';
    else if (matches.length > 0) status = 'owned';
    // Another region's release on a console that isn't region-locked counts only once owned: else it's neither missing nor asked about.
    else if (target.status === 'extra') status = 'extra';
    else if (conditional || target.status === 'review') status = 'review';
    else if (target.status === 'unconfirmed') status = 'unconfirmed';
    else if (target.status === 'upcoming') status = 'upcoming';
    else status = 'missing';
    const said = (rejectedOf.get(target.id) ?? []).map((id) => productById.get(id));
    const result: TargetResult = { target, status, matches, suggestions: [] };
    if (said.some(Boolean)) result.rejected = said.filter((p): p is OwnedProduct => Boolean(p)).map((p) => ({ productId: p.productId, title: p.title }));
    return result;
  });
  // Another region's release takes only copies no other catalog game claims: IGDB's name for a game the list writes
  // differently is the same game, and the list's game keeps its copy.
  const claimed = new Set(results.filter((r) => r.target.status !== 'extra').flatMap((r) => r.matches.map((m) => m.productId)));
  for (const r of results) {
    if (r.target.status !== 'extra' || r.status !== 'owned') continue;
    r.matches = r.matches.filter((m) => !claimed.has(m.productId));
    if (r.matches.length === 0) r.status = 'extra';
  }

  // Titles without their subtitle: a copy nothing claimed, whose title is the start of exactly one catalog game.
  if (options.shortTitles) {
    const keyOf = (t: string) => (options.romaji ? romajiKey(t) : matchKey(t));
    const byStem = new Map<string, Set<TargetResult>>();
    for (const r of results) {
      if (r.status === 'excluded') continue;
      for (const name of [r.target.title, ...(r.target.altTitles ?? [])]) {
        for (const stem of titleStems(name)) {
          const k = keyOf(stem);
          if (k) byStem.set(k, (byStem.get(k) ?? new Set()).add(r));
        }
      }
    }
    const numbersOf = (t: string) => shape(t).numbers;
    for (const p of owned) {
      if (used.has(p.productId) || options.ignored?.has(p.productId)) continue;
      // The copy's whole title: "Overcooked [Special Edition]" is a product of its own, not the start of "Overcooked: All You Can Eat".
      const fits = [...(byStem.get(keyOf(p.title)) ?? [])];
      const unique = [...new Set(fits)];
      if (unique.length !== 1) continue;
      const r = unique[0]!;
      if (rejected.has(`${r.target.id}|${p.productId}`) || numbersOf(r.target.title) !== numbersOf(p.title)) continue;
      r.matches.push({ productId: p.productId, title: p.title, method: 'short' });
      r.status = 'owned';
      used.add(p.productId);
    }
  }

  const unmatched = owned.filter((p) => !used.has(p.productId) && !options.ignored?.has(p.productId));
  if (suggest && unmatched.length > 0) {
    const found = new Map<TargetResult, TargetResult['suggestions']>();
    const times = new Map<string, number>();
    // Each title's shapes once: the copies nothing claimed here, the catalog's games kept with them (the same games come
    // back from the catalog's cache after a copy is bought).
    const unclaimed = unmatched.map((p) => ({ p, shapes: shapesOf(p.title) }));
    for (const r of results) {
      // An owned game that looks like an unconfirmed or upcoming one is worth the question too: owning it proves the release.
      if (r.status !== 'missing' && r.status !== 'review' && r.status !== 'unconfirmed' && r.status !== 'upcoming') continue;
      let names = TARGET_SHAPES.get(r.target);
      if (!names) TARGET_SHAPES.set(r.target, (names = [r.target.title, ...(r.target.altTitles ?? [])].map(shapesOf)));
      const saidNot = rejectedOf.get(r.target.id);
      for (const { p, shapes } of unclaimed) {
        if (saidNot?.includes(p.productId)) continue;
        let reason: string | null = null;
        for (const name of names) reason ??= similarityOf(name, shapes);
        if (!reason) continue;
        found.set(r, [...(found.get(r) ?? []), { productId: p.productId, title: p.title, reason }]);
        times.set(p.productId, (times.get(p.productId) ?? 0) + 1);
      }
    }
    // An owned title that looks like many catalog games is a generic word ("E-Reader",
    // "Kinect"), not a sign of any one of them: it isn't suggested at all.
    for (const [r, list] of found) {
      r.suggestions = list.filter((s) => (times.get(s.productId) ?? 0) <= MAX_SUGGESTIONS_PER_PRODUCT);
      if (r.suggestions.length > 0) r.status = 'review';
    }
  }

  const counts = { targets: results.length, owned: 0, missing: 0, review: 0, excluded: 0, unconfirmed: 0, upcoming: 0, extra: 0 };
  for (const r of results) counts[r.status]++;
  const counting = counts.targets - counts.excluded - counts.unconfirmed - counts.upcoming - counts.extra;
  return { targets: results, unmatched, counts, percent: counting === 0 ? 0 : Math.round((counts.owned / counting) * 1000) / 10 };
}
