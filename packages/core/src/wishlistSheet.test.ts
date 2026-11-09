import { describe, expect, it } from 'vitest';
import { readWishlistSheet } from './wishlistSheet.js';

// The old spreadsheet's tabs, as CSV (made-up rows in its shapes).
describe('wishlist data from a spreadsheet (T-278)', () => {
  it('reads a tab of rules under a title line, with its rule types and status', () => {
    const csv = [
      'Wishlist Rules,,,,,,',
      'Use this tab to document the rules.,,,,,,',
      'Rule ID,Category,Wishlist rule,Applies to,Rule type,Status,Notes / exceptions',
      'WR-006,Condition,"Recommend only copies with the manual, ""CIB"" alone isn\'t enough.",Physical releases,Hard rule,Active,Owner-confirmed',
      'WR-040,Recent recommendation cooldown,Not the same game for 14 days.,Deals,Preference,Inactive,',
      'WR-099,,,,,,',
    ].join('\n');
    const r = readWishlistSheet(csv);
    expect(r.kind).toBe('rules');
    if (r.kind !== 'rules') return;
    expect(r.rows).toEqual([
      { ref: 'WR-006', title: 'Condition', text: 'Recommend only copies with the manual, "CIB" alone isn\'t enough.', kind: 'rule', area: 'Physical releases', notes: 'Owner-confirmed', active: true },
      { ref: 'WR-040', title: 'Recent recommendation cooldown', text: 'Not the same game for 14 days.', kind: 'preference', area: 'Deals', notes: '', active: false },
    ]);
    expect(r.skipped).toBe(1);
  });

  it('reads an ignore list with its actions, dates and prices', () => {
    const csv = [
      'Title,Console,Marketplace,Seller,Ignore Until,Reconsider Below,Reason,Action,Status',
      'Booster Grip,Atari 2600,,,,,Hardware,Exclude from collection target,Active',
      'Some Game,PS3,,,2026-12-01,,,Defer until date,Active',
      'Pricey Game,PS3,,,,$12.50,,Report only below price,Active',
      'Old Row,PS3,,,,,,Hide from wishlist only,Inactive',
      'No Action,PS3,,,,,,,Active',
    ].join('\n');
    const r = readWishlistSheet(csv);
    expect(r.kind).toBe('exclusions');
    if (r.kind !== 'exclusions') return;
    expect(r.rows.map((x) => [x.title, x.action, x.until, x.belowCents, x.active])).toEqual([
      ['Booster Grip', 'exclude', null, null, true],
      ['Some Game', 'defer', '2026-12-01', null, true],
      ['Pricey Game', 'below-price', null, 1250, true],
      ['Old Row', 'hide', null, null, false],
    ]);
    expect(r.skipped).toBe(1);
  });

  it('reads owner controls: a preference, its note, a review date and an exclusion', () => {
    const csv = [
      'Control Key,Console,Canonical Title,Edition / Region,Owner Preference,Score Modifier,Owner Note,Review After,Recommendation Exclusion?,Active,Last Updated',
      'k1,Nintendo Switch 2,Indiana Jones and the Great Circle,North America,Strong Interest,10,Prefer this release.,,No,Yes,2026-09-03',
      'k2,PS3,Skip Me,North America,Do Not Recommend,,,2027-01-01,Yes,No,2026-09-03',
    ].join('\n');
    const r = readWishlistSheet(csv);
    expect(r.kind).toBe('preferences');
    if (r.kind !== 'preferences') return;
    expect(r.rows).toEqual([
      { title: 'Indiana Jones and the Great Circle', console: 'Nintendo Switch 2', preference: 'Strong Interest', note: 'Prefer this release.', reviewAfter: null, exclude: false, active: true },
      { title: 'Skip Me', console: 'PS3', preference: 'Do Not Recommend', note: '', reviewAfter: '2027-01-01', exclude: true, active: false },
    ]);
  });

  it("reads candidate facts, leaving out values that say nothing", () => {
    const csv = [
      'Title,Console,Region,Release Format,Edition,Primary Genre,Subgenre / Style,Series Completion,Licensed Tie-in,CIB Market Value,Scarcity Tier,Japanese Developed,Offbeat,NA Physical,Evidence / Notes,Last Verified,Metadata Status,Personal Interest,Series Gap Remaining,Release Class,Platform Significance,Market Urgency,Franchise,Metadata Confidence,Physical Proof',
      'Mugen Souls Z,PS3,North America,Physical,Standard,RPG,JRPG,Yes,No,$20.58,Common,Yes,Yes,Yes,Compile Heart.,2026-07-28,Active,Neutral,,Exact target,Standard,Low,,High,',
      'A.R.T.I.,Atari 7800,North America,Physical,Standard,,,No,No,,,No,No,No,,,Active,Neutral,,Physical proof pending,Standard,Review,,Medium,',
      'Gone,PS3,,,,,,,,,,,,,,,Inactive,High,2,Exact target,Cornerstone,High,Series,,',
    ].join('\n');
    const r = readWishlistSheet(csv);
    expect(r.kind).toBe('details');
    if (r.kind !== 'details') return;
    expect(r.rows[0]).toEqual({
      title: 'Mugen Souls Z',
      console: 'PS3',
      active: true,
      details: { genre: 'RPG', style: 'JRPG', tieIn: false, japaneseDeveloped: true, offbeat: true, naPhysical: true, seriesCompletes: true, releaseClass: 'Exact target', marketUrgency: 'Low', notes: 'Compile Heart.' },
    });
    expect(r.rows[1]!.details).toEqual({ tieIn: false, japaneseDeveloped: false, offbeat: false, naPhysical: false, releaseClass: 'Physical proof pending' });
    expect(r.rows[2]).toMatchObject({ active: false, details: { personalInterest: 'High', seriesRemaining: 2, significance: 'Cornerstone', marketUrgency: 'High', franchise: 'Series' } });
  });

  it("says why a sheet isn't one it knows", () => {
    expect(readWishlistSheet('Name,Price\nA,1')).toMatchObject({ kind: null });
    expect(readWishlistSheet('Title,Console,Price\nA,PS3,1')).toMatchObject({ kind: null, problem: expect.stringContaining('Action column') });
  });
});
