import type { SettingsValues } from './settings.js';
import { normalizeTitle } from './text.js';
import { priorityFor, reviewPoints, tierPoints, trustedRating, type GameDetails, type ScoreComponent, type ScoringConfig } from './wishlist.js';

/**
 * The PC wishlist: PC games worth buying, found through IGDB (well-rated games in the genres you score
 * highest, games in series you collect, the PC versions of console games you keep sealed) and ranked on
 * the console wishlist's 0 to 100 scale with the same genre, style, review and series points, plus
 * points of its own for a sealed console copy and for a game you can already play through a subscription.
 * Games owned for good in any PC storefront are never candidates.
 */

/** Steam's review summary for a game: the share of positive reviews and how many there are. */
export interface SteamReviews {
  percent: number;
  total: number;
  /** Steam's own words: "Very Positive", "Mixed"... */
  summary: string;
}

/** A game found for the PC wishlist. */
export interface PcCandidate {
  /** The PC library's family key (pcFamilyKey) of its title. */
  key: string;
  title: string;
  igdbId: number;
  details: GameDetails;
  released?: string | null;
  coverId?: string | null;
  steamAppId?: number | null;
  steam?: SteamReviews | null;
  /** Why it was found: "Genre: RPG", "Series: Halo", "Sealed on Nintendo Switch". */
  sources: string[];
  /** Console platforms where the same game is kept sealed (and it's not owned on PC). */
  sealedOn?: string[];
  /** PC storefronts where it's playable through a subscription only. */
  subscription?: string[];
  /** The owner's preference for it (the console wishlist's preference names). */
  preference?: string;
}

/** A PC candidate with its score, every point explained, and its place in the list. */
export interface ScoredPcCandidate extends PcCandidate {
  score: number;
  priority: 'High' | 'Medium' | 'Low';
  components: ScoreComponent[];
  rank: number;
}

/** What the PC wishlist scores with: the console wishlist's genre, style, review, series and preference points, and its own. */
export interface PcScoringConfig
  extends Pick<
    ScoringConfig,
    'genrePoints' | 'stylePoints' | 'genreBlend' | 'reviewTop' | 'reviewFrom' | 'reviewTo' | 'reviewShape' | 'reviewPrior' | 'reviewTrust' | 'seriesOwnedTiers' | 'maxScore' | 'priorityHigh' | 'priorityMedium' | 'preferencePoints'
  > {
  /** Points when you keep the game sealed on a console and don't own it on PC (play it there, keep the box sealed). */
  sealedCopyPoints: number;
  /** Points (usually negative) when you can already play it through a subscription. */
  subscriptionPoints: number;
  /** Steam's reviews stand for the game's reviews once there are at least this many (IGDB's otherwise). */
  steamMinReviews: number;
  /** How many games the list keeps. */
  size: number;
}

/** The PC wishlist's scoring from the settings (Wishlist > Scoring for the shared points, Settings > PC library for its own). */
export function pcScoringConfig(s: SettingsValues, learned: { genrePoints?: Record<string, number> } = {}): PcScoringConfig {
  const genrePoints = Object.keys(s['wishlist.genrePoints']).length > 0 ? s['wishlist.genrePoints'] : (learned.genrePoints ?? {});
  return {
    genrePoints,
    stylePoints: s['wishlist.stylePoints'],
    genreBlend: s['wishlist.genreBlend'],
    reviewTop: s['wishlist.reviewTop'],
    reviewFrom: s['wishlist.reviewFrom'],
    reviewTo: s['wishlist.reviewTo'],
    reviewShape: s['wishlist.reviewShape'],
    reviewPrior: s['wishlist.reviewPrior'],
    reviewTrust: s['wishlist.reviewTrust'],
    seriesOwnedTiers: s['wishlist.seriesOwnedTiers'],
    maxScore: s['wishlist.maxScore'],
    priorityHigh: s['wishlist.priorityHigh'],
    priorityMedium: s['wishlist.priorityMedium'],
    preferencePoints: s['wishlist.preferencePoints'],
    sealedCopyPoints: s['pc.sealedCopyPoints'],
    subscriptionPoints: s['pc.subscriptionPoints'],
    steamMinReviews: s['pc.steamMinReviews'],
    size: s['pc.wishlistSize'],
  };
}

const lower = (points: Record<string, number>) => new Map(Object.entries(points).map(([k, v]) => [normalizeTitle(k), v]));

/**
 * Scores and ranks PC candidates, best first, keeping the list's size. Each game's points: its genres
 * (averaged, as on the console wishlist), its style, its reviews (Steam's once it has enough, IGDB's
 * otherwise, both trusted by how many there are), the series you collect, a sealed console copy, a
 * subscription that already covers it, and your preference. The score stays on the 0 to highest scale.
 */
export function scorePcCandidates(candidates: PcCandidate[], config: PcScoringConfig, context: { ownedInSeries?: Map<string, number> } = {}): ScoredPcCandidate[] {
  const genres = lower(config.genrePoints);
  const styles = lower(config.stylePoints);
  const preferences = lower(config.preferencePoints);
  const scored: Omit<ScoredPcCandidate, 'rank'>[] = [];
  for (const c of candidates) {
    const d = c.details;
    const components: ScoreComponent[] = [];
    const add = (label: string, points: number, always = false) => {
      if (points !== 0 || always) components.push({ label, points });
      return points;
    };
    const list = d.genres?.length ? d.genres : d.genre ? [d.genre] : [];
    if (list.length === 0) components.push({ label: 'Genre unknown', points: 0 });
    else if (config.genreBlend === 'average') add(`${list.join(', ')}${list.length > 1 ? ' (averaged)' : ''}`, Math.round(list.reduce((n, g) => n + (genres.get(normalizeTitle(g)) ?? 0), 0) / list.length), true);
    else add(list[0]!, genres.get(normalizeTitle(list[0]!)) ?? 0, true);
    if (d.style) add(d.style, styles.get(normalizeTitle(d.style)) ?? 0);
    if (config.reviewTop) {
      const steam = c.steam && c.steam.total >= config.steamMinReviews ? c.steam : null;
      const rating = steam ? steam.percent : d.rating;
      const count = steam ? steam.total : d.ratingCount;
      const label = steam
        ? `Reviews: ${steam.percent}% positive on Steam (${steam.total.toLocaleString('en-US')})`
        : typeof d.rating === 'number' && (d.ratingCount ?? 0) > 0
          ? `Reviews: ${Math.round(d.rating)} on IGDB (${d.ratingCount} rating${d.ratingCount === 1 ? '' : 's'})`
          : 'Reviews: not rated';
      add(label, reviewPoints(trustedRating(rating, count, config), config));
    }
    if (d.franchise) {
      const owned = context.ownedInSeries?.get(normalizeTitle(d.franchise)) ?? 0;
      add(`Series you collect: ${d.franchise} (${owned} owned)`, tierPoints(config.seriesOwnedTiers ?? [], owned));
    }
    if (c.sealedOn?.length) add(`Sealed on ${c.sealedOn.join(', ')}: play it on PC`, config.sealedCopyPoints);
    if (c.subscription?.length) add(`On your subscription (${c.subscription.join(', ')})`, config.subscriptionPoints);
    if (c.preference) add(`Your preference: ${c.preference}`, preferences.get(normalizeTitle(c.preference)) ?? 0);
    const total = components.reduce((n, x) => n + x.points, 0);
    if (config.maxScore && total > config.maxScore) components.push({ label: `Capped at ${config.maxScore}`, points: config.maxScore - total });
    const score = Math.max(0, Math.min(total, config.maxScore || total));
    scored.push({ ...c, score, priority: priorityFor(score, config), components });
  }
  // Best first; ties by the better reviews, then by title.
  const reviews = (c: PcCandidate) => (c.steam && c.steam.total >= config.steamMinReviews ? c.steam.percent : (c.details.rating ?? 0));
  return scored
    .sort((a, b) => b.score - a.score || reviews(b) - reviews(a) || a.title.localeCompare(b.title))
    .slice(0, Math.max(config.size, 0))
    .map((c, i) => ({ ...c, rank: i + 1 }));
}
