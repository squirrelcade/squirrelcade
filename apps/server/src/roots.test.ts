import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { catalogEntries } from './db/schema.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

const metroid = readFileSync(new URL('../../../packages/core/src/fixtures/wikipedia/super-metroid.wikitext', import.meta.url), 'utf8');

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

/** Wikipedia, standing in: Super Metroid's article, a search, revisions, and a best-selling list. */
function wikipedia(asked: string[]) {
  return async (url: string) => {
    const q = new URL(url).searchParams;
    asked.push(q.get('page') ?? q.get('srsearch') ?? q.get('titles') ?? q.get('action') ?? '');
    if (q.get('action') === 'parse' && q.get('page') === 'Super Metroid') return json({ parse: { title: 'Super Metroid', revid: 1381652227, wikitext: metroid, properties: { wikibase_item: 'Q1194825' } } });
    if (q.get('action') === 'parse' && q.get('page') === 'List of best-selling Super Nintendo Entertainment System video games') {
      return json({ parse: { title: q.get('page'), revid: 1, wikitext: '{| class="wikitable sortable"\n!scope="col" | Game\n|-\n| [[Super Mario World]]\n|-\n| [[Super Metroid]]\n|}', properties: {} } });
    }
    if (q.get('action') === 'parse') return json({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } });
    if (q.get('list') === 'search') return json({ query: { search: q.get('srsearch')?.includes('Mystery Quest') ? [] : [{ title: 'Super Metroid' }] } });
    if (q.get('prop') === 'revisions') return json({ query: { pages: [{ title: 'Super Metroid', revisions: [{ revid: 1381652227 }] }] } });
    return json({});
  };
}

/** Wikidata, standing in: the game's MobyGames identifier and an award, the award's name, MobyGames' link format. */
async function wikidata(url: string) {
  const ids = (new URL(url).searchParams.get('ids') ?? '').split('|');
  const claim = (value: unknown, year?: string) => ({ mainsnak: { datavalue: { value } }, ...(year ? { qualifiers: { P585: [{ datavalue: { value: { time: `+${year}-00-00T00:00:00Z` } } }] } } : {}) });
  const entities: Record<string, unknown> = {};
  for (const id of ids) {
    if (id === 'Q1194825') entities[id] = { id, labels: { en: { value: 'Super Metroid' } }, claims: { P11688: [claim('super-metroid')], P166: [claim({ id: 'Q900' }, '1994')] } };
    else if (id === 'Q900') entities[id] = { id, labels: { en: { value: 'Game of the Year award of a magazine' } }, claims: {} };
    else if (id === 'P11688') entities[id] = { id, claims: { P1630: [claim('https://www.mobygames.com/game/$1/')] } };
    else entities[id] = { id, missing: '' };
  }
  return json({ entities });
}

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

const roots = async (cookies: Record<string, string>, title: string) => (await g.app.inject({ url: `/api/v1/game/roots?platform=super-nintendo&title=${encodeURIComponent(title)}`, cookies })).json();

describe('Roots (D165)', () => {
  it("reads a game's article for its page: reviews of the time with issue and page, its sources, what it came from, its sites and awards", async () => {
    const asked: string[] = [];
    g = await testApp({ wikipediaFetch: wikipedia(asked), wikidataFetch: wikidata });
    const cookies = await setUp(g);
    seedCatalogs(g, {
      owned: ['Super Metroid', 'F-Zero', 'Pilotwings', 'Mario Paint', 'Star Fox', 'Stunt Race FX'].map((t, i): [string, string, string] => [String(i + 1), t, 'Super Nintendo']),
      catalogs: {
        'super-nintendo': [{ title: 'Super Metroid', evidence: 'list', releaseDate: '1994-04-18', wikiArticle: 'Super Metroid' }, 'F-Zero'],
        'nintendo-entertainment-system': ['Metroid'],
        playstation: ['Castlevania: Symphony of the Night'],
      },
    });
    const r = await roots(cookies, 'Super Metroid');
    expect(r).toMatchObject({ status: 'ready', article: { title: 'Super Metroid' }, firstRelease: '1994-03-19', months: 18 });
    expect(r.time.reviews.find((x: { outlet: string }) => x.outlet === 'Electronic Gaming Monthly')).toMatchObject({ score: '9/10, 9/10, 9/10, 9/10', issue: '6', page: '28', date: '1994-06', print: true });
    expect(r.time.magazines.length).toBeGreaterThan(10);
    // The games it names, found in the catalogs; the rest (magazines, the game itself) left out.
    expect(r.cameFrom).toEqual([expect.objectContaining({ title: 'Metroid', platformKey: 'nintendo-entertainment-system', owned: false, missing: true })]);
    expect(r.ledTo.map((m: { title: string }) => m.title)).toContain('Castlevania: Symphony of the Night');
    expect(r.sites).toEqual([
      { name: 'Wikipedia', url: 'https://en.wikipedia.org/wiki/Super_Metroid' },
      { name: 'MobyGames', url: 'https://www.mobygames.com/game/super-metroid/' },
    ]);
    expect(r.awards).toEqual([{ name: 'Game of the Year award of a magazine', year: '1994' }]);
    // Read once: opening it again asks Wikipedia nothing.
    const before = asked.length;
    await roots(cookies, 'Super Metroid');
    expect(asked.length).toBe(before);

    // The header: the award as a star, and its best-selling place once the night's reading has the list.
    await g.roots.readBestSelling('super-nintendo');
    const game = (await g.app.inject({ url: `/api/v1/game?platform=super-nintendo&title=${encodeURIComponent('Super Metroid')}`, cookies })).json();
    expect(game.stars.map((s: { label: string }) => s.label)).toEqual(expect.arrayContaining(['#2 best-selling', 'Game of the Year 1994']));

    // A game the catalogs don't link: looked up on Wikipedia once, and remembered (none found here).
    expect((await roots(cookies, 'Mystery Quest')).status).toBe('none');
    const searches = asked.filter((a) => a.includes('Mystery Quest')).length;
    await roots(cookies, 'Mystery Quest');
    expect(asked.filter((a) => a.includes('Mystery Quest')).length).toBe(searches);

    // Off (Settings > Roots), nothing is read.
    g.settings.update({ 'roots.read': false });
    expect((await roots(cookies, 'F-Zero')).status).toBe('off');
    expect(g.db.select().from(catalogEntries).where(eq(catalogEntries.title, 'Super Metroid')).get()?.wikiArticle).toBe('Super Metroid');
  });
});
