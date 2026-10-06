import { describe, expect, it } from 'vitest';
import { inferFranchise, inferGenre, inferStyle } from './inference.js';
import { fitFactor, scoreCandidates, selectMaster, topByPlatform, type ScoredCandidate, type ScoringConfig, type WishlistCandidate } from './wishlist.js';

const config: ScoringConfig = {
  platformPoints: { 'playstation-3': 12, 'nintendo-switch': 10, 'wii-u': 3 },
  otherPlatformPoints: 2,
  genrePoints: { RPG: 30, Platformer: 28, Fighting: 5 },
  stylePoints: { JRPG: 9, 'Western RPG': 10 },
  homeRegionPoints: 5,
  importRegionPoints: 0,
  completionTiers: [
    { max: 3, points: 60 },
    { max: 5, points: 45 },
    { max: 10, points: 25 },
  ],
  seriesTiers: [
    { max: 1, points: 30 },
    { max: 2, points: 18 },
  ],
  personalInterestPoints: { Essential: 20, High: 12, Interested: 5, Neutral: 0 },
  releaseClassPoints: { 'Exact target': 6, 'Acceptable variant': 3, 'Physical homebrew / aftermarket': -12 },
  campaignPlatforms: ['wii-u'],
  campaignPoints: 15,
  significancePoints: { Cornerstone: 8, Notable: 4 },
  marketUrgencyPoints: { High: 8, Moderate: 4 },
  offbeatJapanesePoints: 15,
  tieInPoints: -8,
  ownedElsewherePoints: -20,
  ownedOnPcPoints: -10,
  setPoints: 0,
  preferencePoints: { 'Must Have': 20, 'Strong Interest': 10, 'No Adjustment': 0, 'Low Interest': -5 },
  priorityHigh: 85,
  priorityMedium: 65,
  masterSize: 200,
  perPlatformMax: 20,
  consoleDiversityPenalty: 5,
  franchiseDiversityPenalty: 3,
  inferGenres: true,
};

const candidate = (over: Partial<WishlistCandidate> = {}): WishlistCandidate => ({
  platformKey: 'playstation-3',
  platformName: 'PlayStation 3',
  title: 'Some Game',
  homeRegion: true,
  ...over,
});

describe('inference', () => {
  it('guesses genre, style and franchise only from well-known names', () => {
    expect(inferGenre('Final Fantasy XIII')).toEqual({ genre: 'RPG', evidence: 'final fantasy' });
    expect(inferStyle('Final Fantasy XIII', 'RPG')?.style).toBe('JRPG');
    expect(inferGenre("Assassin's Creed III")?.genre).toBe('Action-adventure');
    expect(inferStyle("Assassin's Creed III", 'Action-adventure')?.style).toBe('Open-world');
    expect(inferFranchise('Mega Man 11')).toBe('mega man');
    expect(inferGenre('Some Unknown Game')).toBeNull();
  });
});

describe('reviews, blended genres and series you collect', () => {
  const cfg: ScoringConfig = {
    ...config,
    genreBlend: 'average',
    reviewTop: 25,
    reviewFrom: 55,
    reviewTo: 90,
    reviewShape: 'linear',
    reviewPrior: 65,
    reviewTrust: 10,
    seriesOwnedTiers: [
      { max: 1, points: 4 },
      { max: 3, points: 8 },
      { max: 1000, points: 15 },
    ],
  };
  const igdb = (over: Record<string, unknown>) => ({ source: 'igdb' as const, genre: 'RPG', genres: ['RPG'], ...over, fromIgdb: ['genre', 'genres', ...Object.keys(over)] });

  it('turns IGDB ratings into points, trusting a rating only once enough people gave one', () => {
    const [classic, obscure, unrated] = scoreCandidates(
      [
        candidate({ title: 'Classic', details: igdb({ rating: 92, ratingCount: 400 }) }),
        candidate({ title: 'Obscure', details: igdb({ rating: 95, ratingCount: 2 }) }),
        candidate({ title: 'Unrated', details: igdb({}) }),
      ],
      new Map(),
      cfg,
    );
    const reviews = (c: ScoredCandidate) => c.components.find((x) => x.label.startsWith('Reviews'));
    expect(reviews(classic!)).toEqual({ label: 'Reviews: 92 on IGDB (400 ratings)', points: 25 });
    // Two ratings of 95 count as about 70 (the unrated 65 still weighs in); no ratings count as 65.
    expect(reviews(obscure!)).toEqual({ label: 'Reviews: 95 on IGDB (2 ratings)', points: 11 });
    expect(reviews(unrated!)).toEqual({ label: 'Reviews: not rated on IGDB', points: 7 });
    expect(classic!.score - unrated!.score).toBe(18);
  });

  it('averages the points of several IGDB genres and rewards the series you collect', () => {
    const [racer, tales] = scoreCandidates(
      [
        candidate({ title: 'Kart RPG', details: igdb({ genres: ['RPG', 'Racing'] }) }),
        candidate({ title: 'Tales of Something', details: igdb({ franchise: 'Tales' }) }),
      ],
      new Map(),
      cfg,
      { ownedInSeries: new Map([['tales', 5]]) },
    );
    // RPG 30 and Racing (not listed) 0.
    expect(racer!.components).toContainEqual({ label: 'RPG, Racing (IGDB, averaged)', points: 15 });
    expect(tales!.components).toContainEqual({ label: 'Series you collect (5 owned)', points: 15 });
    // The old rule, only the first genre, is still there.
    const [first] = scoreCandidates([candidate({ details: igdb({ genres: ['RPG', 'Racing'] }) })], new Map(), { ...cfg, genreBlend: 'first' });
    expect(first!.components).toContainEqual({ label: 'RPG (IGDB)', points: 30 });
  });

  it('gives completion points by percent complete, so big and small consoles compare fairly', () => {
    const percentConfig: ScoringConfig = { ...cfg, completionBy: 'percent', completionPercentTiers: [{ min: 98, points: 25 }, { min: 80, points: 10 }] };
    const [wiiU, ps3, xbox] = scoreCandidates(
      [candidate({ platformKey: 'wii-u', platformName: 'Wii U', title: 'A' }), candidate({ title: 'B' }), candidate({ platformKey: 'xbox', platformName: 'Xbox', title: 'C' })],
      new Map([['wii-u', 1], ['playstation-3', 190], ['xbox', 866]]),
      percentConfig,
      { completion: new Map([['wii-u', 99.4], ['playstation-3', 82.6], ['xbox', 3]]) },
    );
    expect(wiiU!.components).toContainEqual({ label: 'Near complete (99.4% owned)', points: 25 });
    expect(ps3!.components).toContainEqual({ label: 'Near complete (82.6% owned)', points: 10 });
    expect(xbox!.components.some((x) => x.label.startsWith('Near complete'))).toBe(false);
  });

  it('breaks equal scores by reviews, never by title', () => {
    const scored = scoreCandidates(
      [
        candidate({ title: 'A Weak Game', details: igdb({ rating: 58, ratingCount: 300 }) }),
        candidate({ title: 'B Strong Game', details: igdb({ rating: 58.1, ratingCount: 300 }) }),
      ],
      new Map(),
      cfg,
    );
    expect(scored[0]!.score).toBe(scored[1]!.score);
    expect(topByPlatform(scored, cfg).get('playstation-3')!.map((c) => c.title)).toEqual(['B Strong Game', 'A Weak Game']);
  });
});

describe('scoreCandidates', () => {
  it('adds up the components and explains them', () => {
    const [s] = scoreCandidates(
      [
        candidate({
          title: 'Tales of Graces f',
          details: { genre: 'RPG', style: 'JRPG', personalInterest: 'High', releaseClass: 'Exact target', marketUrgency: 'High', seriesRemaining: 2, japaneseDeveloped: true, offbeat: true, naPhysical: true },
        }),
      ],
      new Map([['playstation-3', 4]]),
      config,
    );
    // 12 platform + 5 region + 30 RPG + 9 JRPG + 45 completion (4 left) + 18 series + 8 market + 15 offbeat + 12 interest + 6 release class
    expect(s!.score).toBe(160);
    expect(s!.priority).toBe('High');
    expect(s!.components.map((c) => c.label)).toContain('Near complete (4 left)');
    expect(s!.flags).toEqual([]);
  });

  it('guesses the genre when there are no details, and says so', () => {
    const [s] = scoreCandidates([candidate({ title: 'Final Fantasy XIII' })], new Map(), config);
    // 12 + 5 + 30 RPG + 9 JRPG + 6 exact target
    expect(s!.score).toBe(62);
    expect(s!.priority).toBe('Low');
    expect(s!.flags).toEqual(['No game details yet', 'Genre guessed from "final fantasy"']);
  });

  it('applies campaigns, imports, tie-ins, ownership elsewhere and preferences', () => {
    const [wiiu] = scoreCandidates([candidate({ platformKey: 'wii-u', platformName: 'Wii U', details: { genre: 'Platformer' } })], new Map([['wii-u', 2]]), config);
    expect(wiiu!.score).toBe(3 + 5 + 28 + 60 + 15 + 6);
    const [imp] = scoreCandidates([candidate({ homeRegion: false, details: {} })], new Map(), config);
    expect(imp!.flags).toContain('Import: check region');
    const [tie] = scoreCandidates([candidate({ details: { genre: 'Fighting', tieIn: true } })], new Map(), config);
    expect(tie!.score).toBe(12 + 5 + 5 - 8 + 6);
    const [dup] = scoreCandidates([candidate({ details: { genre: 'RPG' }, ownedOn: ['Xbox 360'] })], new Map(), config);
    expect(dup!.components.find((c) => c.label === 'Owned on Xbox 360')?.points).toBe(-20);
    const [must] = scoreCandidates([candidate({ details: { genre: 'RPG' }, preference: 'Must Have' })], new Map(), config);
    expect(must!.score).toBe(12 + 5 + 30 + 6 + 20);
  });

  it('never goes below zero', () => {
    const [s] = scoreCandidates([candidate({ platformKey: 'x', platformName: 'X', details: { tieIn: true }, ownedOn: ['PS4'], preference: 'Low Interest' })], new Map(), { ...config, homeRegionPoints: 0 });
    expect(s!.score).toBe(0);
  });

  it('leaves out what the rules keep off the wishlist', () => {
    const out = scoreCandidates(
      [
        candidate({ title: 'Kiosk', details: { releaseClass: 'Exclude' } }),
        candidate({ title: 'Announced', details: { releaseClass: 'Physical proof pending' } }),
        candidate({ title: 'Homebrew, no proof', details: { releaseClass: 'Physical homebrew / aftermarket' } }),
        candidate({ title: 'Homebrew, shipped', details: { releaseClass: 'Physical homebrew / aftermarket', physicalProof: 'https://example.test/shipped' } }),
        candidate({ title: 'Do not recommend', preference: 'Do Not Recommend' }),
      ],
      new Map([['playstation-3', 2]]),
      config,
    );
    expect(out.map((s) => s.title)).toEqual(['Homebrew, shipped']);
    // Homebrew gets no completion points and a release-class penalty.
    expect(out[0]!.score).toBe(12 + 5 - 12);
  });
});

describe('fitting scores to the scale (D43)', () => {
  const tens = (tenth: number) => [200, 150, 140, 130, 120, 110, 100, 99, 98, tenth, 10, 5];

  it('leaves the scores when the tenth best lands between 85% and 100% of the top', () => {
    const auto = { maxScore: 100, fitScale: 'auto' as const };
    expect(fitFactor(tens(88), auto)).toBe(1);
    expect(fitFactor(tens(85), auto)).toBe(1);
    expect(fitFactor(tens(100), auto)).toBe(1);
    // Off, unset, or without a cap: never.
    expect(fitFactor(tens(40), { maxScore: 100, fitScale: 'off' })).toBe(1);
    expect(fitFactor(tens(40), { maxScore: 100 })).toBe(1);
    expect(fitFactor(tens(40), { maxScore: 0, fitScale: 'auto' })).toBe(1);
  });

  it('looks at the place and lands it where the settings say', () => {
    const five = { maxScore: 100, fitScale: 'auto' as const, fitRank: 5, fitTarget: 80 };
    // The fifth best at 60 is fitted to 80 (x 1.33); at 78, within 5 of 80, it isn't; at 160, over the top, it's halved.
    expect(fitFactor([100, 90, 80, 70, 60, 50], five)).toBeCloseTo(80 / 60);
    expect(fitFactor([100, 95, 90, 85, 78, 50], five)).toBe(1);
    expect(fitFactor([200, 190, 180, 170, 160], five)).toBeCloseTo(0.5);
  });

  it('puts the tenth best at 90% of the top when it lands far off, or the last game of a shorter list', () => {
    expect(fitFactor(tens(60), { maxScore: 100, fitScale: 'auto' })).toBeCloseTo(1.5);
    expect(fitFactor([200, 190, 180, 170, 160, 150, 140, 130, 125, 120], { maxScore: 100, fitScale: 'auto' })).toBeCloseTo(0.75);
    expect(fitFactor([45, 30], { maxScore: 100, fitScale: 'auto' })).toBe(3);
    expect(fitFactor([], { maxScore: 100, fitScale: 'auto' })).toBe(1);
  });

  it('adds a line to each score, keeps the order and caps after fitting', () => {
    const fitting = { ...config, maxScore: 100, fitScale: 'auto' as const };
    const games = ['Final Fantasy XIII', 'Some Game', 'Another Game'].map((title, i) => candidate({ title, details: { genre: i === 0 ? 'RPG' : 'Fighting' } }));
    const plain = scoreCandidates(games, new Map(), { ...fitting, fitScale: 'off' });
    const fitted = scoreCandidates(games, new Map(), fitting);
    // The last of three is the anchor: 12 + 5 + 5 Fighting + 6 exact target = 28, fitted to 90.
    expect(plain.map((s) => s.score)).toEqual([53, 28, 28]);
    expect(fitted.map((s) => s.score)).toEqual([100, 90, 90]);
    const best = fitted[0]!;
    expect(best.components.slice(-2)).toEqual([
      { label: 'Fitted to the scale (×3.21)', points: 117 },
      { label: 'Capped at 100', points: -70 },
    ]);
    expect(best.components.reduce((sum, c) => sum + c.points, 0)).toBe(100);
    expect(best.priority).toBe('High');
  });
});

describe('selectMaster', () => {
  const platforms = Array.from({ length: 24 }, (_, i) => `p${i}`);
  let seed = 123456789;
  const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const make = (i: number): ScoredCandidate => {
    const score = Math.floor(random() * 150);
    return {
      platformKey: platforms[i % platforms.length]!,
      platformName: platforms[i % platforms.length]!,
      title: `Game ${String(i).padStart(5, '0')}`,
      homeRegion: true,
      score,
      priority: 'Low',
      components: [],
      flags: [],
      franchise: i % 7 === 0 ? `series ${i % 90}` : '',
      tie: [score, i % 65, 0, i % 21, i % 31, i % 9, i % 17, i % 9, i % 6, 0, 0],
    };
  };
  const cfg = { ...config, platformPoints: Object.fromEntries(platforms.map((p, i) => [p, 100 - i])) };

  /** The plain version: rescan every remaining candidate for every pick. */
  function reference(all: ScoredCandidate[]) {
    const remaining = [...all];
    const perPlatform = new Map<string, number>();
    const perFranchise = new Map<string, number>();
    const order = new Map(platforms.map((p, i) => [p, i]));
    const out: [string, number][] = [];
    while (out.length < cfg.masterSize && remaining.length) {
      let bestIndex = -1;
      let best: { master: number; c: ScoredCandidate } | null = null;
      remaining.forEach((c, index) => {
        const count = perPlatform.get(c.platformKey) ?? 0;
        if (count >= cfg.perPlatformMax) return;
        const master = c.score - count * 5 - (c.franchise ? (perFranchise.get(c.franchise) ?? 0) * 3 : 0);
        let better = !best;
        if (best) {
          if (master !== best.master) better = master > best.master;
          else {
            let decided = false;
            for (let t = 0; t < c.tie.length; t++) {
              if (c.tie[t] !== best.c.tie[t]) {
                better = c.tie[t]! > best.c.tie[t]!;
                decided = true;
                break;
              }
            }
            if (!decided) {
              const oc = order.get(c.platformKey)!;
              const ob = order.get(best.c.platformKey)!;
              better = oc < ob || (oc === ob && c.title.localeCompare(best.c.title) < 0);
            }
          }
        }
        if (better) {
          best = { master, c };
          bestIndex = index;
        }
      });
      if (!best) break;
      const chosen: { master: number; c: ScoredCandidate } = best;
      remaining.splice(bestIndex, 1);
      perPlatform.set(chosen.c.platformKey, (perPlatform.get(chosen.c.platformKey) ?? 0) + 1);
      if (chosen.c.franchise) perFranchise.set(chosen.c.franchise, (perFranchise.get(chosen.c.franchise) ?? 0) + 1);
      out.push([chosen.c.title, chosen.master]);
    }
    return out;
  }

  it('matches the plain step-by-step selection on 18,856 candidates', () => {
    const all = Array.from({ length: 18_856 }, (_, i) => make(i));
    const t0 = performance.now();
    const master = selectMaster(all, cfg);
    const ms = performance.now() - t0;
    expect(master.map((m) => [m.title, m.masterScore])).toEqual(reference(all));
    expect(master).toHaveLength(200);
    const counts = new Map<string, number>();
    for (const m of master) counts.set(m.platformKey, (counts.get(m.platformKey) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeLessThanOrEqual(20);
    expect(master[0]!.rank).toBe(1);
    expect(ms).toBeLessThan(2000);
  });

  it('shows the diversity penalties it applied', () => {
    const three = [0, 1, 2].map((i) => ({ ...make(i), platformKey: 'p0', franchise: 'same', score: 100, tie: [100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], title: `T${i}` }));
    const master = selectMaster(three, cfg);
    expect(master.map((m) => [m.masterScore, m.consolePenalty, m.franchisePenalty])).toEqual([
      [100, 0, 0],
      [92, 5, 3],
      [84, 10, 6],
    ]);
  });
});

describe('topByPlatform', () => {
  it('keeps the best few per platform', () => {
    const scored = scoreCandidates(
      [1, 2, 3, 4].map((i) => candidate({ title: `G${i}`, details: { genre: i % 2 ? 'RPG' : 'Fighting' } })),
      new Map(),
      config,
    );
    const top = topByPlatform(scored, config, 2);
    expect(top.get('playstation-3')!.map((c) => c.title)).toEqual(['G1', 'G3']);
  });
});
