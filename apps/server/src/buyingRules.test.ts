import { normalizeTitle } from '@squirrelcade/core';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exclusions, gameDetails, ownerPreferences, platforms } from './db/schema.js';
import { seedCatalogs, setUp, testApp } from './test-helpers.js';

// Your buying rules and bringing a spreadsheet's wishlist in (1.5.0, T-278).
let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

const owner = { paid: true, notes: true, pc: true, play: true, details: true };

describe('your buying rules', () => {
  it('adds, numbers, edits, orders, switches off and removes rules', async () => {
    const add = (payload: Record<string, unknown>) => g.app.inject({ method: 'POST', url: '/api/v1/wishlist/rules', cookies, payload });
    expect((await add({})).statusCode).toBe(400);
    const a = (await add({ title: 'The manual', text: 'Only copies with the manual.' })).json().rule;
    const b = (await add({ title: 'Sports', text: 'Sports games on Switch.', kind: 'preference' })).json().rule;
    expect([a.number, b.number, b.kind]).toEqual([1, 2, 'preference']);
    const put = await g.app.inject({ method: 'PUT', url: `/api/v1/wishlist/rules/${a.id}`, cookies, payload: { text: 'Only copies with the manual in the photos.', active: false } });
    expect(put.json().rule).toMatchObject({ text: 'Only copies with the manual in the photos.', active: false, number: null });
    let list = (await g.app.inject({ url: '/api/v1/wishlist/rules', cookies })).json().rules;
    expect(list.map((r: { number: number | null }) => r.number)).toEqual([null, 1]);
    list = (await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/rules/order', cookies, payload: { ids: [b.id, a.id] } })).json().rules;
    expect(list.map((r: { title: string }) => r.title)).toEqual(['Sports', 'The manual']);
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/wishlist/rules/${a.id}`, cookies })).json()).toEqual({ removed: true });
    expect((await g.app.inject({ method: 'DELETE', url: `/api/v1/wishlist/rules/${a.id}`, cookies })).statusCode).toBe(404);

    // Claude reads the ones that are on, numbered; someone not shown the owner's notes doesn't.
    const forClaude = g.aiTools.buyingRules(owner);
    expect(forClaude).toMatchObject({ shared: true, count: 1, rules: [{ number: 1, title: 'Sports', kind: 'preference' }] });
    expect(g.aiTools.buyingRules({ ...owner, notes: false })).toMatchObject({ shared: false, rules: [] });
  });
});

describe('bringing a spreadsheet in', () => {
  const RULES = [
    'Wishlist Rules,,,,,,',
    'Rule ID,Category,Wishlist rule,Applies to,Rule type,Status,Notes / exceptions',
    'WR-006,Condition,Only copies with the manual.,Physical releases,Hard rule,Active,Owner-confirmed',
    'WR-040,Cooldown,Not the same game for 14 days.,Deals,Preference,Active,',
    'WR-099,Old,An old rule.,All,Preference,Inactive,',
  ].join('\n');
  const IGNORE = [
    'Title,Console,Marketplace,Seller,Ignore Until,Reconsider Below,Reason,Action,Status',
    'Booster Grip,Atari 2600,,,,,Hardware,Exclude from collection target,Active',
    'Combat,Atari 2600,,,,,Already said,Exclude from collection target,Active',
    'Something,Vectrex 9000,,,,,,Exclude from collection target,Active',
  ].join('\n');
  const OWNER = [
    'Control Key,Console,Canonical Title,Edition / Region,Owner Preference,Score Modifier,Owner Note,Review After,Recommendation Exclusion?,Active',
    'k1,PS3,Tales of Graces f,North America,Strong Interest,10,Want it.,,No,Yes',
    'k2,PS3,Uncharted 2 - Among Thieves,North America,Must Have,20,,,No,Yes',
  ].join('\n');
  const FACTS = [
    'Title,Console,Primary Genre,Subgenre / Style,Licensed Tie-in,Personal Interest,Release Class,Platform Significance,Market Urgency,Franchise,Metadata Status',
    'Tales of Graces f,PS3,RPG,JRPG,No,High,Exact target,Cornerstone,High,tales of,Active',
    'Uncharted 2 Among Thieves,PS3,Action-adventure,,No,Neutral,Exact target,Standard,Review,,Active',
    'Homebrew Hero,Atari 2600,,,No,Neutral,Physical proof pending,Standard,Review,,Active',
  ].join('\n');
  const files = [
    { name: 'rules.csv', text: RULES },
    { name: 'ignore.csv', text: IGNORE },
    { name: 'owner.csv', text: OWNER },
    { name: 'facts.csv', text: FACTS },
    { name: 'other.csv', text: 'Name,Price\nA,1' },
  ];

  beforeEach(() => {
    seedCatalogs(g, {
      owned: [['1', 'Uncharted', 'Playstation 3']],
      catalogs: { 'playstation-3': ['Uncharted', 'Tales of Graces f', 'Uncharted 2: Among Thieves'], 'atari-2600': ['Booster Grip', 'Combat', 'Homebrew Hero'] },
      exclusions: [{ platform: 'atari-2600', title: 'Combat', action: 'exclude' }],
    });
    // Set by the owner since the sheet: kept as it is.
    g.wishlist.setPreference('playstation-3', 'Uncharted 2: Among Thieves', 'Slight Interest', null);
    const ps3 = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, 'playstation-3')).get()!.id;
    g.db.insert(gameDetails).values({ platformId: ps3, title: 'Tales of Graces f', titleKey: normalizeTitle('Tales of Graces f'), details: JSON.stringify({ personalInterest: 'Essential' }), source: 'user', updatedAt: new Date().toISOString() }).run();
  });

  it('previews each row, then adds only what the owner hasn\'t set', async () => {
    const preview = (await g.app.inject({ method: 'POST', url: '/api/v1/wishlist/bring-in', cookies, payload: { files } })).json();
    expect(preview.files.map((f: { kind: string | null }) => f.kind)).toEqual(['rules', 'exclusions', 'preferences', 'details', null]);
    expect(preview.rules.map((r: { ref: string; add: boolean }) => [r.ref, r.add])).toEqual([['WR-006', true], ['WR-040', true], ['WR-099', false]]);
    expect(preview.exclusions.map((r: { title: string; fate: string }) => [r.title, r.fate])).toEqual([['Booster Grip', 'add'], ['Combat', 'skip'], ['Something', 'unknown']]);
    // "Uncharted 2 - Among Thieves" is the catalog's "Uncharted 2: Among Thieves", which has the owner's own preference.
    expect(preview.preferences.map((r: { matched: string; fate: string }) => [r.matched, r.fate])).toEqual([['Tales of Graces f', 'add'], ['Uncharted 2: Among Thieves', 'skip']]);
    const tales = preview.details.find((r: { title: string }) => r.title === 'Tales of Graces f');
    expect(tales.fields).not.toContain('personalInterest');
    expect(tales.fields).toEqual(expect.arrayContaining(['genre', 'style', 'releaseClass', 'significance', 'marketUrgency', 'franchise']));
    expect(preview.details.find((r: { title: string }) => r.title === 'Homebrew Hero')).toMatchObject({ proofPending: true, fate: 'add' });
    expect((await g.app.inject({ url: '/api/v1/wishlist/rules', cookies })).json().rules).toEqual([]);

    // Only the rules picked; physical proof pending left out.
    const done = (await g.app.inject({ method: 'POST', url: '/api/v1/wishlist/bring-in', cookies, payload: { files, apply: { rules: ['WR-006'], proofPending: false } } })).json();
    expect(done.applied).toEqual({ rules: 1, exclusions: 1, preferences: 1, details: 3 });
    const rules = (await g.app.inject({ url: '/api/v1/wishlist/rules', cookies })).json().rules;
    expect(rules).toMatchObject([{ number: 1, ref: 'WR-006', title: 'Condition', kind: 'rule', source: 'import' }]);
    expect(g.db.select().from(exclusions).all().map((e) => [e.title, e.action, e.source])).toEqual([['Combat', 'exclude', 'test'], ['Booster Grip', 'exclude', 'import']]);
    const ps3 = g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, 'playstation-3')).get()!.id;
    const prefs = g.db.select().from(ownerPreferences).where(eq(ownerPreferences.platformId, ps3)).all();
    expect(prefs.map((p) => [p.title, p.preference]).sort()).toEqual([['Tales of Graces f', 'Strong Interest'], ['Uncharted 2: Among Thieves', 'Slight Interest']]);
    const talesDetails = JSON.parse(g.db.select().from(gameDetails).where(and(eq(gameDetails.platformId, ps3), eq(gameDetails.titleKey, normalizeTitle('Tales of Graces f')))).get()!.details);
    expect(talesDetails).toMatchObject({ personalInterest: 'Essential', genre: 'RPG', significance: 'Cornerstone', franchise: 'tales of' });
    // Its release class (physical proof pending) wasn't brought: it stays on the wishlist.
    const homebrew = g.db.select().from(gameDetails).all().find((d) => d.title === 'Homebrew Hero')!;
    expect(JSON.parse(homebrew.details)).toEqual({ tieIn: false });

    // Brought in twice: nothing more.
    const again = (await g.app.inject({ method: 'POST', url: '/api/v1/wishlist/bring-in', cookies, payload: { files, apply: {} } })).json();
    expect(again.applied).toMatchObject({ rules: 1, exclusions: 0, preferences: 0 });
    expect(again.rules.find((r: { ref: string }) => r.ref === 'WR-006')).toMatchObject({ add: false, why: 'Already on your list' });
  });

  it('refuses a call with no files, and keeps it from viewers', async () => {
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/wishlist/bring-in', cookies, payload: { files: [] } })).statusCode).toBe(400);
  });
});

describe("a game's own facts for its acorns", () => {
  it('sets, keeps and clears them, and the wishlist follows', async () => {
    seedCatalogs(g, { owned: [['1', 'Uncharted', 'Playstation 3']], catalogs: { 'playstation-3': ['Uncharted', 'Tales of Graces f'] } });
    const put = (details: Record<string, unknown>) => g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/details', cookies, payload: { platformKey: 'playstation-3', title: 'Tales of Graces f', details } });
    expect((await put({ personalInterest: 'Essential', tieIn: true, rating: 99 })).json().details).toEqual({ personalInterest: 'Essential', tieIn: true });
    expect((await put({ tieIn: null, marketUrgency: 'High' })).json().details).toEqual({ personalInterest: 'Essential', marketUrgency: 'High' });
    const got = (await g.app.inject({ url: '/api/v1/wishlist/details?platform=playstation-3&title=Tales%20of%20Graces%20f', cookies })).json();
    expect(got.details).toEqual({ personalInterest: 'Essential', marketUrgency: 'High' });
    const tales = [...g.wishlist.compute().all.values()].find((c) => c.title === 'Tales of Graces f')!;
    expect(JSON.stringify(tales.components)).toMatch(/interest/i);
    expect((await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/details', cookies, payload: { platformKey: 'nope', title: 'x', details: {} } })).statusCode).toBe(404);
  });
});

