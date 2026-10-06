import { describe, expect, it } from 'vitest';
import { scorePcCandidates, type PcCandidate, type PcScoringConfig } from './pcWishlist.js';

const config: PcScoringConfig = {
  genrePoints: { RPG: 22, Platformer: 18, Shooter: 4 },
  stylePoints: { JRPG: 6 },
  genreBlend: 'average',
  reviewTop: 31,
  reviewFrom: 55,
  reviewTo: 92,
  reviewShape: 'linear',
  reviewPrior: 65,
  reviewTrust: 10,
  seriesOwnedTiers: [
    { max: 1, points: 5 },
    { max: 3, points: 10 },
  ],
  maxScore: 100,
  priorityHigh: 85,
  priorityMedium: 60,
  preferencePoints: { 'Must Have': 20 },
  sealedCopyPoints: 25,
  subscriptionPoints: -15,
  steamMinReviews: 50,
  size: 2,
};

const game = (title: string, over: Partial<PcCandidate> = {}): PcCandidate => ({ key: title.toLowerCase(), title, igdbId: title.length, details: { source: 'igdb' }, sources: ['Genre: RPG'], ...over });

describe('scorePcCandidates', () => {
  it('scores genres, style, reviews, series, a sealed copy, a subscription and preferences, every point explained', () => {
    const [best] = scorePcCandidates(
      [
        game('Persona 5 Royal', {
          details: { source: 'igdb', genres: ['RPG'], style: 'JRPG', franchise: 'Persona', rating: 90, ratingCount: 400 },
          steam: { percent: 96, total: 50000, summary: 'Overwhelmingly Positive' },
          sealedOn: ['PlayStation 4'],
          preference: 'Must Have',
        }),
      ],
      config,
      { ownedInSeries: new Map([['persona', 2]]) },
    );
    expect(best!.components).toEqual([
      { label: 'RPG', points: 22 },
      { label: 'JRPG', points: 6 },
      { label: 'Reviews: 96% positive on Steam (50,000)', points: 31 },
      { label: 'Series you collect: Persona (2 owned)', points: 10 },
      { label: 'Sealed on PlayStation 4: play it on PC', points: 25 },
      { label: 'Your preference: Must Have', points: 20 },
      { label: 'Capped at 100', points: -14 },
    ]);
    expect(best).toMatchObject({ score: 100, priority: 'High', rank: 1 });
  });

  it("uses IGDB's reviews until Steam has enough, lowers what a subscription covers, and keeps the list's size", () => {
    const list = scorePcCandidates(
      [
        game('Few Steam Reviews', { details: { source: 'igdb', genres: ['Platformer'], rating: 80, ratingCount: 100 }, steam: { percent: 100, total: 3, summary: 'Positive' } }),
        game('On Game Pass', { details: { source: 'igdb', genres: ['Platformer'], rating: 80, ratingCount: 100 }, subscription: ['Xbox'] }),
        game('Shooter', { details: { source: 'igdb', genres: ['Shooter', 'RPG'] } }),
      ],
      config,
    );
    // The same game, but already on a subscription: 15 points lower; the list keeps two games.
    expect(list.map((c) => c.title)).toEqual(['Few Steam Reviews', 'On Game Pass']);
    expect(list[0]!.components.find((c) => c.label.startsWith('Reviews'))!.label).toBe('Reviews: 80 on IGDB (100 ratings)');
    expect(list[1]!.components.at(-1)).toEqual({ label: 'On your subscription (Xbox)', points: -15 });
    expect(list[0]!.score - list[1]!.score).toBe(15);
    const all = scorePcCandidates([game('Shooter', { details: { source: 'igdb', genres: ['Shooter', 'RPG'] } })], config);
    expect(all[0]!.components[0]).toEqual({ label: 'Shooter, RPG (averaged)', points: 13 });
  });
});
