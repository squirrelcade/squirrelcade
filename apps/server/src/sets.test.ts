import { afterEach, describe, expect, it } from 'vitest';
import type { FetchLike } from './igdb.js';
import { csvLines, multipartFile, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
afterEach(async () => {
  await g?.cleanup();
});

/** A fake Wikipedia with the given pages' HTML (action=parse); other pages don't exist. */
const wiki =
  (pages: Record<string, string>): FetchLike =>
  async (url) => {
    const u = new URL(url);
    if (u.searchParams.get('action') === 'parse') {
      const page = u.searchParams.get('page') ?? '';
      return pages[page] ? Response.json({ parse: { title: page, text: pages[page] } }) : Response.json({ error: { code: 'missingtitle', info: "The page you specified doesn't exist." } });
    }
    return Response.json({});
  };

/** Shaped like "List of Limited Run Games releases": the consoles in the "Limited run #" column. */
const LRG = `
<table class="wikitable sortable"><tbody>
<tr><th>Title</th><th>Limited run #</th><th>Developer(s)</th><th>Standard edition release date(s)</th></tr>
<tr><td><i>2064: Read Only Memories</i></td><td>105 (PS4)<br>161 (Vita)<br>054 (Switch)</td><td>MidBoss</td><td>November 17, 2017</td></tr>
<tr><td><i>8bit Music Power</i></td><td>Distro (NES)</td><td>RIKI</td><td>March 19, 2021</td></tr>
<tr><td><i>A-Train Express</i></td><td>264 (PSVR)</td><td>Artdink</td><td>May 22, 2019</td></tr>
<tr><td><i>Cars 2: The Video Game</i></td><td>Distro (Switch)</td><td>Someone</td><td>2020</td></tr>
<tr><td><i>Celeste</i></td><td>023 (Switch)<br>207 (PS4)</td><td>Maddy Makes Games</td><td>February 1, 2019</td></tr>
</tbody></table>
`;

const byTitle = <T extends { title: string; platformKey: string }>(games: T[]) => [...games].sort((a, b) => a.title.localeCompare(b.title) || a.platformKey.localeCompare(b.platformKey));

describe('sets', () => {
  it("reads a Wikipedia list and says where each game stands: by its console's catalog where it has the game, else by title", async () => {
    g = await testApp({ wikipediaFetch: wiki({ 'List of Limited Run Games releases': LRG }) });
    cookies = await setUp(g);
    seedCatalogs(g, {
      owned: [
        ['1', 'Celeste', 'Nintendo Switch'],
        ['2', '2064: Read Only Memories', 'Playstation 4'],
        ['3', 'Cars 2', 'Nintendo Switch'],
        ['4', 'Hollow Knight', 'Nintendo Switch'],
        ['5', 'A-Train Express: Deluxe', 'Playstation 4'],
        // Enough different games for the Switch to be tracked, so it has a wishlist.
        ['6', 'Cuphead', 'Nintendo Switch'],
        ['7', 'Gris', 'Nintendo Switch'],
        ['8', 'Tunic', 'Nintendo Switch'],
      ],
      // The Switch's catalog needs evidence of a physical release (its Wikipedia list mixes in downloads): a list is evidence.
      catalogs: { 'nintendo-switch': [{ title: '2064: Read Only Memories', evidence: 'list' }, 'Celeste', 'Cars 2: The Video Game', 'Hollow Knight'] },
    });

    const made = await g.app.inject({ method: 'POST', url: '/api/v1/sets', cookies, payload: { name: 'Limited Run Games', page: 'https://en.wikipedia.org/wiki/List_of_Limited_Run_Games_releases' } });
    expect(made.statusCode).toBe(201);
    expect(made.json().message).toBe('5 games from Wikipedia\'s "List of Limited Run Games releases".');

    // Only consoles in the collection (Switch and PS4): the Vita and NES games are left out.
    const detail = (await g.app.inject({ url: '/api/v1/sets/limited-run-games', cookies })).json();
    expect(byTitle(detail.games as { title: string; platformKey: string; status: string; inCatalog: boolean }[]).map((x) => [x.title, x.platformKey, x.status, x.inCatalog])).toEqual([
      ['2064: Read Only Memories', 'nintendo-switch', 'missing', true],
      ['2064: Read Only Memories', 'playstation-4', 'owned', false],
      ['A-Train Express', 'playstation-4', 'missing', false],
      // A look-alike on the Switch's catalog stays a question for its Review page.
      ['Cars 2: The Video Game', 'nintendo-switch', 'review', true],
      ['Celeste', 'nintendo-switch', 'owned', true],
      ['Celeste', 'playstation-4', 'missing', false],
    ]);
    // Missing on the PS4, owned on the Switch.
    expect(detail.games.find((x: { title: string; platformKey: string }) => x.title === 'Celeste' && x.platformKey === 'playstation-4').ownedOn).toEqual(['Nintendo Switch']);
    // A missing game its console's catalog has comes with your preference for it, kept under the catalog's title.
    const readOnly = (games: { title: string; platformKey: string; catalogTitle?: string }[]) => games.find((x) => x.title === '2064: Read Only Memories' && x.platformKey === 'nintendo-switch');
    expect(readOnly(detail.games)).toMatchObject({ catalogTitle: expect.any(String), preference: null });
    await g.app.inject({ method: 'PUT', url: '/api/v1/wishlist/preferences', cookies, payload: { platformKey: 'nintendo-switch', title: readOnly(detail.games)!.catalogTitle, preference: 'Must Have', note: null } });
    expect(readOnly((await g.app.inject({ url: '/api/v1/sets/limited-run-games', cookies })).json().games)).toMatchObject({ preference: 'Must Have' });
    // A game outside the catalog has none to keep.
    expect(detail.games.find((x: { title: string }) => x.title === 'A-Train Express').catalogTitle).toBeUndefined();
    expect(detail.set).toMatchObject({ name: 'Limited Run Games', source: 'wikipedia', games: 6, owned: 2, review: 1, percent: 33.3 });
    // Outside a console's catalog, an owned look-alike is pointed out, never counted.
    expect(detail.games.find((x: { title: string }) => x.title === 'A-Train Express')).toMatchObject({ status: 'missing', maybe: ['A-Train Express: Deluxe'] });
    expect(detail.set.platforms).toEqual([
      { key: 'nintendo-switch', name: 'Nintendo Switch', games: 3, owned: 1 },
      { key: 'playstation-4', name: 'PlayStation 4', games: 3, owned: 1 },
    ]);

    // Answering the look-alike: the same game counts (and survives reading the list again), "not it" stops asking.
    const answer = (decision: string | null) =>
      g.app.inject({ method: 'PUT', url: '/api/v1/sets/limited-run-games/answers', cookies, payload: { platformKey: 'playstation-4', title: 'A-Train Express', ownedTitle: 'A-Train Express: Deluxe', decision } });
    expect((await answer('same')).statusCode).toBe(200);
    await g.app.inject({ method: 'POST', url: '/api/v1/sets/limited-run-games/rebuild', cookies });
    const train1 = (await g.app.inject({ url: '/api/v1/sets/limited-run-games', cookies })).json().games.find((x: { title: string }) => x.title === 'A-Train Express');
    expect(train1).toMatchObject({ status: 'owned', ownedAs: ['A-Train Express: Deluxe'], linked: true });
    await answer('different');
    const train2 = (await g.app.inject({ url: '/api/v1/sets/limited-run-games', cookies })).json().games.find((x: { title: string }) => x.title === 'A-Train Express');
    expect(train2.status).toBe('missing');
    expect(train2.maybe).toBeUndefined();
    await answer(null);

    // Store Mode names the set, and finds its missing games that no console catalog has.
    const celeste = (await g.app.inject({ url: '/api/v1/lookup?q=celeste', cookies })).json();
    expect(celeste.find((r: { platformKey: string }) => r.platformKey === 'nintendo-switch')).toMatchObject({ answer: 'own', sets: ['Limited Run Games'] });
    // The game drawer links the set's page.
    expect((await g.app.inject({ url: '/api/v1/game?platform=nintendo-switch&title=Celeste', cookies })).json().sets).toEqual([{ key: 'limited-run-games', name: 'Limited Run Games' }]);
    const train = (await g.app.inject({ url: '/api/v1/lookup?q=a-train', cookies })).json();
    expect(train[0]).toMatchObject({ platformKey: 'playstation-4', title: 'A-Train Express', answer: 'need', sets: ['Limited Run Games'], maybe: ['A-Train Express: Deluxe'] });

    // With points for sets (Wishlist > Scoring), a missing game in a set says so on the wishlist.
    g.settings.update({ 'wishlist.setPoints': 5 });
    const pick = g.wishlist.compute().master.find((c) => c.title === '2064: Read Only Memories');
    expect(pick?.components).toContainEqual({ label: 'In your set Limited Run Games', points: 5 });

    // Every console the list names, and a download of what's missing.
    expect((await g.app.inject({ method: 'PATCH', url: '/api/v1/sets/limited-run-games', cookies, payload: { collectedOnly: false } })).statusCode).toBe(200);
    expect((await g.app.inject({ url: '/api/v1/sets', cookies })).json()[0]).toMatchObject({ key: 'limited-run-games', games: 8, owned: 2 });
    const csv = await g.app.inject({ url: '/api/v1/sets/limited-run-games/export?status=missing', cookies });
    expect(csvLines(csv.body)[0]).toBe('Title,Platform,Status,Owned as,Notes');
    expect(csvLines(csv.body)).toContain('8bit Music Power,Nintendo Entertainment System,missing,,');

    // A page Wikipedia doesn't have.
    const none = await g.app.inject({ method: 'POST', url: '/api/v1/sets', cookies, payload: { name: 'Nope', page: 'List of nothing' } });
    expect(none.statusCode).toBe(400);
    expect(none.json().message).toBe('Wikipedia has no page named "List of nothing".');
  });

  it('makes a set from your own CSV, reads it again from a new file, and removes it', async () => {
    g = await testApp();
    cookies = await setUp(g);
    seedCatalogs(g, { owned: [['1', 'Celeste', 'Nintendo Switch']], catalogs: {} });
    const made = await g.app.inject({ method: 'POST', url: '/api/v1/sets', cookies, payload: { name: 'Super Rare Games' } });
    expect(made.json()).toMatchObject({ set: { key: 'super-rare-games', source: 'csv', games: 0 }, message: "Upload the set's list (a CSV with Title and Platform columns), or add its games by hand." });
    const list = 'Title,Platform\nCeleste,Switch\nCuphead,Switch\nSome PC Game,PC';
    const put = await g.app.inject({ method: 'PUT', url: '/api/v1/sets/super-rare-games/list', cookies, ...multipartFile('srg.csv', Buffer.from(list)) });
    expect(put.json()).toMatchObject({ message: '2 games from your list. 1 row(s) had no console Squirrelcade knows (PC games, for example) and were left out.' });
    expect((await g.app.inject({ url: '/api/v1/sets/super-rare-games', cookies })).json().set).toMatchObject({ games: 2, owned: 1, percent: 50 });
    // By hand: add a game, take one of the list out (a new list keeps both changes), bring it back.
    const games = (action: string, title: string) => g.app.inject({ method: 'POST', url: '/api/v1/sets/super-rare-games/games', cookies, payload: { platformKey: 'nintendo-switch', title, action } });
    expect((await games('add', 'Hollow Knight')).statusCode).toBe(200);
    expect((await games('remove', 'Cuphead')).statusCode).toBe(200);
    const edited = (await g.app.inject({ url: '/api/v1/sets/super-rare-games', cookies })).json();
    expect(edited.games.map((x: { title: string }) => x.title)).toEqual(['Celeste', 'Hollow Knight']);
    expect(edited.games.find((x: { title: string }) => x.title === 'Hollow Knight')).toMatchObject({ byHand: true, status: 'missing' });
    expect(edited.set).toMatchObject({ games: 2, addedByHand: 1, takenOut: 1 });
    await g.app.inject({ method: 'PUT', url: '/api/v1/sets/super-rare-games/list', cookies, ...multipartFile('srg.csv', Buffer.from(list)) });
    expect((await g.app.inject({ url: '/api/v1/sets/super-rare-games', cookies })).json().set).toMatchObject({ games: 2, addedByHand: 1, takenOut: 1 });
    await g.app.inject({ method: 'POST', url: '/api/v1/sets/super-rare-games/restore', cookies });
    expect((await g.app.inject({ url: '/api/v1/sets/super-rare-games', cookies })).json().set).toMatchObject({ games: 3, takenOut: 0 });
    expect((await games('add', 'Nope')).statusCode).toBe(200);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sets/super-rare-games/games', cookies, payload: { platformKey: 'not-a-console', title: 'X', action: 'add' } })).statusCode).toBe(400);

    // Only a Wikipedia set can be read again; a second set of the same name gets its own key.
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sets/super-rare-games/rebuild', cookies })).statusCode).toBe(400);
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/sets', cookies, payload: { name: 'Super Rare Games' } })).json().set.key).toBe('super-rare-games-2');
    expect((await g.app.inject({ method: 'DELETE', url: '/api/v1/sets/super-rare-games', cookies })).statusCode).toBe(200);
    expect((await g.app.inject({ url: '/api/v1/sets/super-rare-games', cookies })).statusCode).toBe(404);
  });
});
