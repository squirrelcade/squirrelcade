import { inferFranchise, inferGenre, inferStyle } from './inference.js';
import type { PercentTiers, SettingsValues } from './settings.js';
import { shapeAt, type PointShape } from './shapes.js';
import { normalizeTitle } from './text.js';

/**
 * Wishlist scoring (the old system's v3.4 model, rules WR-001 to WR-030 and
 * WR-038). Every point value comes from ScoringConfig, which the settings pages
 * edit; nothing about one person's taste is written here.
 */

export interface Tier {
  /** Applies when the count is at most this. */
  max: number;
  points: number;
}

/** The wishlist's points, tiers and limits, from Wishlist > Scoring. */
export interface ScoringConfig {
  /** Points per platform key; platforms not listed get otherPlatformPoints. */
  platformPoints: Record<string, number>;
  otherPlatformPoints: number;
  /** Points per genre and per subgenre/style, keyed by name (compared case-insensitively). */
  genrePoints: Record<string, number>;
  stylePoints: Record<string, number>;
  homeRegionPoints: number;
  importRegionPoints: number;
  /** Console completion: points by eligible games still missing on that console. */
  completionTiers: Tier[];
  /** Series proximity: points by games left in the series. */
  seriesTiers: Tier[];
  personalInterestPoints: Record<string, number>;
  releaseClassPoints: Record<string, number>;
  campaignPlatforms: string[];
  campaignPoints: number;
  significancePoints: Record<string, number>;
  marketUrgencyPoints: Record<string, number>;
  offbeatJapanesePoints: number;
  tieInPoints: number;
  /** Applied when the same game is owned physically on another platform (WR-038). */
  ownedElsewherePoints: number;
  ownedOnPcPoints: number;
  /** Applied when the game is in one of the owner's sets (Sets). */
  setPoints: number;
  /** Owner preference modifiers; a preference missing here excludes the game. */
  preferencePoints: Record<string, number>;
  priorityHigh: number;
  priorityMedium: number;
  masterSize: number;
  perPlatformMax: number;
  consoleDiversityPenalty: number;
  franchiseDiversityPenalty: number;
  inferGenres: boolean;
  /** How a game's several IGDB genres count: only the first in the fixed order (RPG first), or their points averaged. */
  genreBlend?: 'first' | 'average';
  /** Reviews: IGDB's rating turned into points, from nothing at reviewFrom up to reviewTop at reviewTo, along reviewShape. Off when reviewTop is 0 or unset. */
  reviewTop?: number;
  reviewFrom?: number;
  reviewTo?: number;
  reviewShape?: PointShape;
  /** What an unrated game counts as, and how many ratings it takes before a game's own rating fully counts. */
  reviewPrior?: number;
  reviewTrust?: number;
  /** Points by the games you own in the same series (their count, "up to" as in the other tiers). */
  seriesOwnedTiers?: Tier[];
  /** The highest score a game can have (the rest is shown as capped); 0 or unset means no cap. */
  maxScore?: number;
  /** Fit the scores to the scale when the fitRank-th best game lands far from its top (auto), or never (off, and when unset). */
  fitScale?: 'auto' | 'off';
  /** The place on the list the fit looks at (10: the top ten), and where it lands, in percent of the highest score (90). */
  fitRank?: number;
  fitTarget?: number;
  /** Console completion by percent complete (completionPercentTiers) or by games left (completionTiers, the default when unset). */
  completionBy?: 'percent' | 'left';
  completionPercentTiers?: PercentTiers;
}

/** What scoring learns from the collection: owned games per series, by normalized series name. */
export interface ScoringContext {
  ownedInSeries?: Map<string, number>;
  /** How complete each console is (percent of its counting catalog games owned), by platform key. */
  completion?: Map<string, number>;
}

/** What the wishlist knows about a game (from the user, from IGDB, or guessed from its title), for its points. */
export interface GameDetails {
  genre?: string;
  /** Every genre the game has (IGDB's, in the wishlist's names), for blending their points. */
  genres?: string[];
  /** IGDB's rating (0–100) and how many ratings it rests on. */
  rating?: number;
  ratingCount?: number;
  style?: string;
  seriesCompletes?: boolean;
  seriesRemaining?: number;
  tieIn?: boolean;
  japaneseDeveloped?: boolean;
  offbeat?: boolean;
  naPhysical?: boolean;
  personalInterest?: string;
  /** Exact target, Acceptable variant, Needs review, Physical homebrew / aftermarket, Physical proof pending, Exclude */
  releaseClass?: string;
  significance?: string;
  marketUrgency?: string;
  franchise?: string;
  physicalProof?: string;
  notes?: string;
  /** 'igdb' when every value came from IGDB rather than the user. */
  source?: 'igdb';
  /** Fields filled from IGDB, for the score explanation. */
  fromIgdb?: string[];
}

/** A missing catalog game the wishlist may recommend. */
export interface WishlistCandidate {
  platformKey: string;
  platformName: string;
  title: string;
  /** True when the target is in the user's home region. */
  homeRegion: boolean;
  details?: GameDetails;
  /** Other platforms where the same game is owned physically. */
  ownedOn?: string[];
  /** PC storefronts where the same game is owned for good (the PC library). */
  ownedOnPc?: string[];
  /** The owner's sets the game is in ("Limited Run Games"). */
  inSets?: string[];
  preference?: string;
}

/** One line of a game's score: what the points are for, and how many. */
export interface ScoreComponent {
  label: string;
  points: number;
}

/** A candidate with its score, its priority band and the lines that add up to the score. */
export interface ScoredCandidate extends WishlistCandidate {
  score: number;
  priority: 'High' | 'Medium' | 'Low';
  components: ScoreComponent[];
  flags: string[];
  franchise: string;
  /** Component points used to break ties, in the old system's order. */
  tie: number[];
}

/** A game on the master list: its rank, and its score after the diversity penalties. */
export interface MasterEntry extends ScoredCandidate {
  rank: number;
  masterScore: number;
  consolePenalty: number;
  franchisePenalty: number;
}

/** The scoring configuration the settings pages describe. */
export function scoringConfig(s: SettingsValues): ScoringConfig {
  return {
    platformPoints: s['wishlist.platformPoints'],
    otherPlatformPoints: s['wishlist.otherPlatformPoints'],
    genrePoints: s['wishlist.genrePoints'],
    stylePoints: s['wishlist.stylePoints'],
    homeRegionPoints: s['wishlist.homeRegionPoints'],
    importRegionPoints: s['wishlist.importRegionPoints'],
    completionTiers: s['wishlist.completionTiers'],
    seriesTiers: s['wishlist.seriesTiers'],
    personalInterestPoints: s['wishlist.personalInterestPoints'],
    releaseClassPoints: s['wishlist.releaseClassPoints'],
    campaignPlatforms: s['wishlist.campaignPlatforms'],
    campaignPoints: s['wishlist.campaignPoints'],
    significancePoints: s['wishlist.significancePoints'],
    marketUrgencyPoints: s['wishlist.marketUrgencyPoints'],
    offbeatJapanesePoints: s['wishlist.offbeatJapanesePoints'],
    tieInPoints: s['wishlist.tieInPoints'],
    ownedElsewherePoints: s['wishlist.ownedElsewherePoints'],
    ownedOnPcPoints: s['wishlist.ownedOnPcPoints'],
    setPoints: s['wishlist.setPoints'],
    preferencePoints: s['wishlist.preferencePoints'],
    priorityHigh: s['wishlist.priorityHigh'],
    priorityMedium: s['wishlist.priorityMedium'],
    masterSize: s['wishlist.masterSize'],
    perPlatformMax: s['wishlist.perPlatformMax'],
    consoleDiversityPenalty: s['wishlist.consoleDiversityPenalty'],
    franchiseDiversityPenalty: s['wishlist.franchiseDiversityPenalty'],
    inferGenres: s['wishlist.inferGenres'],
    genreBlend: s['wishlist.genreBlend'],
    reviewTop: s['wishlist.reviewTop'],
    reviewFrom: s['wishlist.reviewFrom'],
    reviewTo: s['wishlist.reviewTo'],
    reviewShape: s['wishlist.reviewShape'],
    reviewPrior: s['wishlist.reviewPrior'],
    reviewTrust: s['wishlist.reviewTrust'],
    seriesOwnedTiers: s['wishlist.seriesOwnedTiers'],
    maxScore: s['wishlist.maxScore'],
    fitScale: s['wishlist.fitScale'],
    fitRank: s['wishlist.fitRank'],
    fitTarget: s['wishlist.fitTarget'],
    completionBy: s['wishlist.completionBy'],
    completionPercentTiers: s['wishlist.completionPercentTiers'],
  };
}

/**
 * A game's rating as the wishlist counts it: IGDB's, pulled toward the "unrated" value until enough
 * people rated it (a Bayesian average), so one enthusiastic rating doesn't beat a classic.
 */
export function trustedRating(rating: number | undefined, count: number | undefined, config: Pick<ScoringConfig, 'reviewPrior' | 'reviewTrust'>): number {
  const prior = config.reviewPrior ?? 65;
  const trust = Math.max(1, config.reviewTrust ?? 10);
  const n = count ?? 0;
  return typeof rating === 'number' && n > 0 ? (rating * n + prior * trust) / (n + trust) : prior;
}

/** The review points for a trusted rating: none at reviewFrom or below, reviewTop at reviewTo or above, reviewShape in between. */
export function reviewPoints(rating: number, config: Pick<ScoringConfig, 'reviewTop' | 'reviewFrom' | 'reviewTo' | 'reviewShape'>): number {
  const top = config.reviewTop ?? 0;
  const from = config.reviewFrom ?? 50;
  const to = config.reviewTo ?? 90;
  if (top === 0 || rating <= from) return 0;
  return Math.round(top * shapeAt(config.reviewShape ?? 'linear', to > from ? (to - rating) / (to - from) : 0));
}

const lower = (map: Record<string, number>) => new Map(Object.entries(map).map(([k, v]) => [normalizeTitle(k), v]));

/** The points of the highest "at least" tier a percentage reaches. */
function percentPoints(tiers: PercentTiers, percent: number | undefined): number {
  if (percent === undefined || !Number.isFinite(percent)) return 0;
  return [...tiers].sort((a, b) => b.min - a.min).find((t) => percent >= t.min)?.points ?? 0;
}

/** Points from count tiers: the first tier whose "up to" covers the count (0 when none does, or no count). */
export function tierPoints(tiers: Tier[], count: number | undefined): number {
  if (count === undefined || !Number.isFinite(count) || count < 1) return 0;
  const tier = [...tiers].sort((a, b) => a.max - b.max).find((t) => count <= t.max);
  return tier?.points ?? 0;
}

/** The fit's defaults (Wishlist > Scoring): the scale's goal is a top ten at 90% or more of the highest score. */
export const FIT_RANK = 10;
export const FIT_TARGET = 90;

/**
 * How much the scores are fitted to the scale: the factor that puts the fitRank-th best total at fitTarget% of
 * the highest score, when it's more than 5 points of percent below that or above the top; 1 when it's already
 * in that band, with no cap, or with fitting off. The order of the games never changes.
 */
export function fitFactor(totals: number[], config: Pick<ScoringConfig, 'maxScore' | 'fitScale' | 'fitRank' | 'fitTarget'>): number {
  const top = config.maxScore ?? 0;
  if (config.fitScale !== 'auto' || top <= 0 || totals.length === 0) return 1;
  const rank = Math.max(1, Math.round(config.fitRank ?? FIT_RANK));
  const target = Math.min(100, Math.max(1, config.fitTarget ?? FIT_TARGET)) / 100;
  const anchor = [...totals].sort((a, b) => b - a)[Math.min(rank, totals.length) - 1]!;
  if (anchor <= 0 || (anchor >= top * (target - 0.05) && anchor <= top)) return 1;
  return (top * target) / anchor;
}

/** The priority band (High, Medium or Low) a score falls in. */
export function priorityFor(score: number, config: Pick<ScoringConfig, 'priorityHigh' | 'priorityMedium'>): ScoredCandidate['priority'] {
  return score >= config.priorityHigh ? 'High' : score >= config.priorityMedium ? 'Medium' : 'Low';
}

/**
 * Scores wishlist candidates. Candidates the rules keep off the wishlist
 * (not a standard physical target, homebrew without proof, "do not recommend")
 * are dropped. `remaining` is the number of eligible games still missing per
 * platform, for console-completion points.
 */
export function scoreCandidates(candidates: WishlistCandidate[], remaining: Map<string, number>, config: ScoringConfig, context: ScoringContext = {}): ScoredCandidate[] {
  const genres = lower(config.genrePoints);
  const styles = lower(config.stylePoints);
  const interest = lower(config.personalInterestPoints);
  const releaseClasses = lower(config.releaseClassPoints);
  const significance = lower(config.significancePoints);
  const urgency = lower(config.marketUrgencyPoints);
  const preferences = lower(config.preferencePoints);
  const campaigns = new Set(config.campaignPlatforms);
  const scored: ScoredCandidate[] = [];

  for (const c of candidates) {
    const d = c.details;
    const releaseClass = d?.releaseClass?.trim() || 'Exact target';
    const rc = releaseClass.toLowerCase();
    if (rc === 'exclude' || rc === 'physical proof pending') continue;
    const homebrew = rc === 'physical homebrew / aftermarket';
    if (homebrew && !d?.physicalProof) continue;
    const preference = c.preference?.trim();
    if (preference && !preferences.has(normalizeTitle(preference))) continue;

    const components: ScoreComponent[] = [];
    const flags: string[] = [];
    const add = (label: string, points: number, always = false) => {
      if (points !== 0 || always) components.push({ label, points });
      return points;
    };

    const platform = add(c.platformName, config.platformPoints[c.platformKey] ?? config.otherPlatformPoints, true);
    const region = add(c.homeRegion ? 'Home region' : 'Import', c.homeRegion ? config.homeRegionPoints : config.importRegionPoints);
    if (!c.homeRegion) flags.push('Import: check region');

    // Titles are only guessed from when nobody curated the game (IGDB's gaps can be guessed too).
    const guessable = config.inferGenres && (!d || d.source === 'igdb');
    const fromIgdb = new Set(d?.fromIgdb ?? []);
    const inferred = guessable && !d?.genre?.trim() ? inferGenre(c.title) : null;
    const genre = d?.genre?.trim() || inferred?.genre || '';
    const inferredStyle = guessable && !d?.style?.trim() && genre ? inferStyle(c.title, genre) : null;
    const style = d?.style?.trim() || inferredStyle?.style || '';
    const genreNote = inferred ? ' (guessed from title)' : fromIgdb.has('genre') ? ' (IGDB)' : '';
    // IGDB often gives a game several genres; averaged, an RPG that is also a racing game isn't simply an RPG.
    const blend = config.genreBlend === 'average' && fromIgdb.has('genres') && (!d?.genre?.trim() || fromIgdb.has('genre')) && d?.genres?.length ? d.genres : null;
    const genrePoints = blend
      ? add(
          `${blend.join(', ')} (IGDB${blend.length > 1 ? ', averaged' : ''})`,
          Math.round(blend.reduce((sum, g) => sum + (genres.get(normalizeTitle(g)) ?? 0), 0) / blend.length),
          true,
        )
      : genre
        ? add(`${genre}${genreNote}`, genres.get(normalizeTitle(genre)) ?? 0, true)
        : 0;
    if (!genre && !blend) components.push({ label: 'Genre unknown', points: 0 });
    const styleNote = inferredStyle ? ' (guessed)' : fromIgdb.has('style') ? ' (IGDB)' : '';
    add(`${style}${styleNote}`, style ? (styles.get(normalizeTitle(style)) ?? 0) : 0);
    if (!d) flags.push('No game details yet');
    if (inferred) flags.push(`Genre guessed from "${inferred.evidence}"`);

    const percent = context.completion?.get(c.platformKey);
    const completion = homebrew
      ? 0
      : config.completionBy === 'percent'
        ? add(`Near complete (${percent ?? 0}% owned)`, percentPoints(config.completionPercentTiers ?? [], percent))
        : add(`Near complete (${remaining.get(c.platformKey)} left)`, tierPoints(config.completionTiers, remaining.get(c.platformKey)));
    const campaign = add('Completion campaign', campaigns.has(c.platformKey) ? config.campaignPoints : 0);
    const seriesCount = d?.seriesRemaining ?? (d?.seriesCompletes ? 1 : undefined);
    const series = add('Series proximity', tierPoints(config.seriesTiers, seriesCount));
    const franchise = d?.franchise?.trim() || inferFranchise(c.title);
    const ownedInSeries = franchise ? (context.ownedInSeries?.get(normalizeTitle(franchise)) ?? 0) : 0;
    add(`Series you collect (${ownedInSeries} owned)`, tierPoints(config.seriesOwnedTiers ?? [], ownedInSeries));
    const trusted = config.reviewTop ? trustedRating(d?.rating, d?.ratingCount, config) : undefined;
    if (trusted !== undefined) {
      const rated = typeof d?.rating === 'number' && (d.ratingCount ?? 0) > 0;
      add(rated ? `Reviews: ${Math.round(d!.rating!)} on IGDB (${d!.ratingCount} rating${d!.ratingCount === 1 ? '' : 's'})` : 'Reviews: not rated on IGDB', reviewPoints(trusted, config));
    }
    add('Movie/TV tie-in', d?.tieIn ? config.tieInPoints : 0);
    const market = add('Market urgency', d?.marketUrgency ? (urgency.get(normalizeTitle(d.marketUrgency)) ?? 0) : 0);
    const offbeat = add('Offbeat Japanese release', d?.japaneseDeveloped && d.offbeat && d.naPhysical ? config.offbeatJapanesePoints : 0);
    const personal = add(`Personal interest: ${d?.personalInterest ?? ''}`, d?.personalInterest ? (interest.get(normalizeTitle(d.personalInterest)) ?? 0) : 0);
    add(`Release class: ${releaseClass}`, releaseClasses.get(normalizeTitle(releaseClass)) ?? 0);
    if (rc === 'needs review') flags.push('Release class needs review');
    const sig = add(`Platform significance: ${d?.significance ?? ''}`, d?.significance ? (significance.get(normalizeTitle(d.significance)) ?? 0) : 0);
    if (c.ownedOn && c.ownedOn.length > 0) add(`Owned on ${c.ownedOn.join(', ')}`, config.ownedElsewherePoints);
    if (c.ownedOnPc && c.ownedOnPc.length > 0) add(`Owned on PC (${c.ownedOnPc.join(', ')})`, config.ownedOnPcPoints);
    if (c.inSets && c.inSets.length > 0 && config.setPoints !== 0) add(`In your ${c.inSets.length === 1 ? 'set' : 'sets'} ${c.inSets.join(', ')}`, config.setPoints);
    if (preference) add(`Your preference: ${preference}`, preferences.get(normalizeTitle(preference)) ?? 0);

    const total = components.reduce((sum, x) => sum + x.points, 0);
    scored.push({
      ...c,
      // The points as they add up; finished below, once every game's total is known.
      score: total,
      priority: 'Low',
      components,
      flags,
      franchise,
      // Equal scores: the old system's order, then the better-reviewed game (never simply the title).
      tie: [total, completion, campaign, personal, series, sig, genrePoints, market, offbeat, platform, region, trusted ?? 0],
    });
  }

  // Fitted to the scale if need be (a line of its own), then kept on the scale's 0 to maxScore: points beyond
  // the top show as capped, so the lines still add up.
  const factor = fitFactor(scored.map((s) => s.score), config);
  for (const s of scored) {
    let total = s.score;
    if (factor !== 1) {
      const fitted = Math.round(total * factor);
      if (fitted !== total) s.components.push({ label: `Fitted to the scale (×${factor.toFixed(2)})`, points: fitted - total });
      total = fitted;
    }
    if (config.maxScore && total > config.maxScore) s.components.push({ label: `Capped at ${config.maxScore}`, points: config.maxScore - total });
    s.score = Math.max(0, Math.min(total, config.maxScore || total));
    s.priority = priorityFor(s.score, config);
    s.tie[0] = s.score;
  }
  return scored;
}

const compare = (a: ScoredCandidate, b: ScoredCandidate, order: Map<string, number>) => {
  for (let i = 0; i < a.tie.length; i++) {
    const diff = (b.tie[i] ?? 0) - (a.tie[i] ?? 0);
    if (diff !== 0) return diff;
  }
  const oa = order.get(a.platformKey) ?? 999;
  const ob = order.get(b.platformKey) ?? 999;
  return oa - ob || a.title.localeCompare(b.title);
};

/** Platform order for ties: highest platform points first. */
function platformOrder(config: ScoringConfig): Map<string, number> {
  return new Map(
    Object.entries(config.platformPoints)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([k], i) => [k, i]),
  );
}

/** The best candidates per platform by score, for the per-console lists. */
export function topByPlatform(scored: ScoredCandidate[], config: ScoringConfig, limit = config.perPlatformMax): Map<string, ScoredCandidate[]> {
  const order = platformOrder(config);
  const groups = new Map<string, ScoredCandidate[]>();
  for (const c of scored) groups.set(c.platformKey, [...(groups.get(c.platformKey) ?? []), c]);
  for (const [key, list] of groups) groups.set(key, list.sort((a, b) => compare(a, b, order)).slice(0, limit));
  return groups;
}

/** A platform and franchise's candidates, best first; index is the next one not yet picked. */
interface Bucket {
  platformKey: string;
  franchise: string;
  rows: ScoredCandidate[];
  index: number;
}

/**
 * The master list: picks one game at a time, each time taking the highest
 * score after subtracting a penalty for every game already picked from the same
 * platform and franchise, with at most perPlatformMax games per platform (WR-028).
 */
export function selectMaster(scored: ScoredCandidate[], config: ScoringConfig): MasterEntry[] {
  const order = platformOrder(config);
  // Candidates in the same platform and franchise always get the same penalty, so
  // each bucket is sorted once and only its best remaining row competes.
  const buckets = new Map<string, Bucket>();
  for (const c of scored) {
    const key = `${c.platformKey}\u0000${c.franchise}`;
    const b = buckets.get(key) ?? { platformKey: c.platformKey, franchise: c.franchise, rows: [], index: 0 };
    b.rows.push(c);
    buckets.set(key, b);
  }
  for (const b of buckets.values()) b.rows.sort((a, c) => compare(a, c, order));
  const perPlatform = new Map<string, number>();
  const perFranchise = new Map<string, number>();
  const result: MasterEntry[] = [];
  while (result.length < config.masterSize) {
    let best: { bucket: Bucket; entry: MasterEntry } | null = null;
    for (const bucket of buckets.values()) {
      if (bucket.index >= bucket.rows.length) continue;
      const count = perPlatform.get(bucket.platformKey) ?? 0;
      if (count >= config.perPlatformMax) continue;
      const row = bucket.rows[bucket.index]!;
      const consolePenalty = count * config.consoleDiversityPenalty;
      const franchisePenalty = bucket.franchise ? (perFranchise.get(bucket.franchise) ?? 0) * config.franchiseDiversityPenalty : 0;
      const entry: MasterEntry = { ...row, rank: 0, masterScore: row.score - consolePenalty - franchisePenalty, consolePenalty, franchisePenalty };
      if (!best || entry.masterScore > best.entry.masterScore || (entry.masterScore === best.entry.masterScore && compare(entry, best.entry, order) < 0)) {
        best = { bucket, entry };
      }
    }
    if (!best) break;
    best.bucket.index++;
    perPlatform.set(best.bucket.platformKey, (perPlatform.get(best.bucket.platformKey) ?? 0) + 1);
    if (best.bucket.franchise) perFranchise.set(best.bucket.franchise, (perFranchise.get(best.bucket.franchise) ?? 0) + 1);
    result.push({ ...best.entry, rank: result.length + 1 });
  }
  return result;
}
