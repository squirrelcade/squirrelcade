import { describe, expect, it } from 'vitest';
import { importReport, releaseReminder, wishlistChanges, type SnapshotEntry } from './report.js';

const e = (key: string, rank: number, score = 50): SnapshotEntry => ({ key, title: key.toUpperCase(), platform: 'PS3', rank, score });

describe('wishlistChanges', () => {
  it('finds new entries, exits and big moves', () => {
    const changes = wishlistChanges([e('a', 1), e('b', 2), e('c', 30)], [e('a', 1), e('c', 3), e('d', 2)], 10);
    expect(changes.entered.map((x) => x.key)).toEqual(['d']);
    expect(changes.left.map((x) => x.key)).toEqual(['b']);
    expect(changes.movers).toEqual([{ entry: e('c', 3), from: 30 }]);
  });

  it('leaves out small moves and lists only the biggest', () => {
    const before = Array.from({ length: 60 }, (_, i) => e(`g${i}`, i + 1));
    const after = before.map((x, i) => ({ ...x, rank: i < 12 ? 60 - i : x.rank - 12 }));
    const changes = wishlistChanges(before, after);
    expect(changes.movers).toHaveLength(10);
    expect(changes.movers[0]).toEqual({ entry: { ...before[0]!, rank: 60 }, from: 1 });
    expect(wishlistChanges([e('a', 1)], [e('a', 20)]).movers).toEqual([]);
  });

  it('reports nothing the first time', () => {
    expect(wishlistChanges(null, [e('a', 1)])).toEqual({ entered: [], left: [], movers: [] });
  });
});

describe('importReport', () => {
  const base = {
    instanceName: 'Squirrelcade',
    fileName: 'collection_20260927.csv',
    removed: [],
    changedCount: 0,
    games: 100,
    copies: 120,
    top: [e('x', 1, 107)],
    changes: { entered: [], left: [], movers: [] },
    firstSnapshot: false,
    url: 'https://squirrelcade.example.test',
  };

  it('puts the additions first', () => {
    const r = importReport({ ...base, added: [{ title: 'Okami <HD>', consoleLabel: 'Playstation 3', after: 2 }] });
    expect(r.subject).toBe('Squirrelcade: 1 game added');
    expect(r.text.indexOf('WHAT WAS ADDED')).toBe(0);
    expect(r.text.indexOf('WHAT WAS ADDED')).toBeLessThan(r.text.indexOf('SUMMARY'));
    expect(r.text).toContain('- Okami <HD> (Playstation 3) (2 copies)');
    expect(r.html).toContain('Okami &lt;HD&gt;');
    expect(r.html.indexOf('What was added')).toBeLessThan(r.html.indexOf('Top picks'));
    expect(r.short).toBe('Added: Okami <HD>. Top pick: X (PS3).');
  });

  it('says so when nothing was added', () => {
    const r = importReport({ ...base, added: [] });
    expect(r.subject).toBe('Squirrelcade: collection updated');
    expect(r.text).toContain('No games were added in this update.');
  });

  it('keeps long lists short and does not list a first import game by game', () => {
    const added = Array.from({ length: 105 }, (_, i) => ({ title: `Game ${i}`, consoleLabel: 'Playstation 3', after: 1 }));
    const long = importReport({ ...base, added });
    expect(long.text).toContain('- Game 99 (Playstation 3)');
    expect(long.text).not.toContain('Game 100');
    expect(long.text).toContain('...and 5 more.');
    const first = importReport({ ...base, added, firstImport: true, games: 1, copies: 2 });
    expect(first.subject).toBe('Squirrelcade: collection added');
    expect(first.text).toContain('This was your first collection update: 1 game (2 copies) are now in Squirrelcade.');
    expect(first.text).not.toContain('Game 0');
    expect(first.short).toBe('Collection added: 1 game. Top pick: X (PS3).');
  });

  it('reminds about purchases the export does not include yet', () => {
    const r = importReport({ ...base, added: [], waitingPurchases: [{ title: 'Okami', platform: 'Wii' }] });
    expect(r.text).toContain('Marked as bought but not in this export yet (add them to PriceCharting): Okami (Wii).');
  });

  it('mentions platforms that just became tracked', () => {
    const r = importReport({ ...base, added: [], newlyTracked: [{ name: 'Nintendo DS', games: 6 }] });
    expect(r.text).toContain('Newly tracked: Nintendo DS (6 games).');
    expect(importReport({ ...base, added: [], newlyTracked: [] }).text).not.toContain('Newly tracked');
  });

  it('lists the biggest price moves after the summary', () => {
    const r = importReport({
      ...base,
      added: [],
      currency: 'USD',
      priceMoves: {
        up: [{ title: 'Uncharted', platform: 'PlayStation 3', beforeCents: 1000, nowCents: 1600, percent: 60 }],
        down: [{ title: 'Okami', platform: 'Wii', beforeCents: 2500, nowCents: 2000, percent: -20 }],
      },
    });
    expect(r.text).toContain('PRICE MOVES\n- Uncharted (PlayStation 3): $10.00 → $16.00 (+60%)\n- Okami (Wii): $25.00 → $20.00 (-20%)');
    expect(r.text.indexOf('SUMMARY')).toBeLessThan(r.text.indexOf('PRICE MOVES'));
    expect(r.text.indexOf('PRICE MOVES')).toBeLessThan(r.text.indexOf('TOP PICKS'));
    expect(importReport({ ...base, added: [], priceMoves: { up: [], down: [] } }).text).not.toContain('PRICE MOVES');
  });

  it('lists wishlist changes, or explains they start next time', () => {
    const changed = importReport({ ...base, added: [], changes: { entered: [e('n', 5)], left: [e('o', 9)], movers: [{ entry: e('m', 2), from: 40 }] } });
    expect(changed.text).toContain('- #5 N (PS3)');
    expect(changed.text).toContain('- O (PS3), was #9');
    expect(changed.text).toContain('- M (PS3): #40 → #2');
    expect(importReport({ ...base, added: [], firstSnapshot: true }).text).toContain('from the next update on');
  });
});

describe('coming soon in the update summary', () => {
  it('lists the games out soon, marking the ones already owned', () => {
    const report = importReport({
      instanceName: 'Squirrelcade',
      fileName: 'collection_20260927.csv',
      added: [],
      removed: [],
      changedCount: 0,
      games: 1,
      copies: 1,
      top: [],
      changes: { entered: [], left: [], movers: [] },
      firstSnapshot: true,
      comingSoon: [
        { title: 'Soon Game', platform: 'Nintendo Switch 2', releaseDate: '2026-10-01', owned: false },
        { title: 'Preordered', platform: 'PlayStation 5', releaseDate: '2026-10-06', owned: true },
      ],
      url: '',
    });
    expect(report.text).toContain('COMING SOON\n- 2026-10-01: Soon Game (Nintendo Switch 2)\n- 2026-10-06: Preordered (PlayStation 5), you have it');
    expect(report.html).toContain('<h3>Coming soon</h3>');
  });
});

describe('the release reminder', () => {
  const game = (title: string, releaseDate: string, score: number | null = null, keyCard = false) => ({ title, platform: 'Nintendo Switch 2', releaseDate, score, keyCard });

  it('names one game in the subject, and says when each is out', () => {
    const one = releaseReminder({ instanceName: 'Squirrelcade', today: '2026-10-06', games: [game('Soon Game', '2026-10-06', 88)], url: 'https://g.example.test/wishlist/coming-soon' });
    expect(one.subject).toBe('Squirrelcade: Soon Game is out today');
    expect(one.text).toContain('- Today: Soon Game (Nintendo Switch 2), wishlist 88');
    expect(one.text).toContain('Coming soon in Squirrelcade: https://g.example.test/wishlist/coming-soon');
    expect(releaseReminder({ instanceName: 'Squirrelcade', today: '2026-10-01', games: [game('Soon Game', '2026-10-06')], url: '' }).subject).toBe('Squirrelcade: Soon Game is out on 2026-10-06');
  });

  it('lists several soonest first, then by wishlist score, with Game-Key Cards marked', () => {
    const r = releaseReminder({
      instanceName: 'Squirrelcade',
      today: '2026-10-01',
      games: [game('Later', '2026-10-06', 90), game('Low', '2026-10-01', 40), game('Card', '2026-10-01', 70, true)],
      url: '',
    });
    expect(r.subject).toBe('Squirrelcade: 3 games coming out');
    expect(r.short).toBe('Today: Card (Nintendo Switch 2)\nToday: Low (Nintendo Switch 2)\n2026-10-06: Later (Nintendo Switch 2)');
    expect(r.html).toContain('<li>Today: Card (Nintendo Switch 2), Game-Key Card, wishlist 70</li>');
    expect(r.text).not.toContain('Coming soon in Squirrelcade');
    expect(releaseReminder({ instanceName: 'G', today: '2026-10-01', games: [game('A', '2026-10-01'), game('B', '2026-10-01')], url: '' }).subject).toBe('G: 2 games out today');
  });
});
