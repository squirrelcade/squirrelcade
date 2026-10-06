import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportCsv, makeZip, multipartFile, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

// Two Squirrelcades, as two friends have: Ana's and Ben's.
let a: TestApp;
let b: TestApp;
let ac: Record<string, string>;
let bc: Record<string, string>;

const LIST = { 'xbox-360': ['Halo 3', 'Gears of War', 'Fable II', 'Mass Effect'], 'playstation-3': ['Cars 2: The Video Game'] };

beforeEach(async () => {
  a = await testApp();
  ac = await setUp(a, 'ana');
  b = await testApp();
  bc = await setUp(b, 'ben');
  const imported = (g: TestApp, rows: [string, string, string, number, string?][]) => {
    const outcome = g.collection.importText(exportCsv(rows), { source: 'upload', fileName: 'collection_20260101.csv' });
    if (outcome.import.status !== 'applied') throw new Error(`The collection was ${outcome.import.status}`);
  };
  imported(a, [
    ['1', 'Halo 3', 'Xbox 360', 2000, 'Item, Box, and Manual'],
    ['1', 'Halo 3', 'Xbox 360', 1200, 'Item Only'],
    ['2', 'Gears of War', 'Xbox 360', 1500],
    ['3', 'Cars 2: The Video Game', 'Playstation 3', 900],
  ]);
  imported(b, [
    ['10', 'Fable II', 'Xbox 360', 1300],
    ['11', 'Mass Effect', 'Xbox 360', 1000],
    ['2', 'Gears of War', 'Xbox 360', 1500],
  ]);
  seedCatalogs(a, { owned: [], catalogs: LIST });
  seedCatalogs(b, { owned: [], catalogs: LIST });
  a.settings.update({ 'friends.myName': 'Ana' });
  b.settings.update({ 'friends.myName': 'Ben' });
});
afterEach(async () => {
  await a.cleanup();
  await b.cleanup();
});

/** Ben marks a Fable II for trade. */
async function benTradesFable() {
  const items = (await b.app.inject({ url: '/api/v1/collection/items?pageSize=50', cookies: bc })).json().items as { title: string; copyKey?: string; key?: string }[];
  const fable = items.find((i) => i.title === 'Fable II')!;
  const put = await b.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies: bc, payload: { key: fable.copyKey ?? fable.key, sale: 'trade' } });
  expect(put.statusCode).toBe(200);
}

/** Ana adds Ben and sends a file; Ben brings it in (making Ana a friend) and sends one back; Ana brings that in. */
async function befriend() {
  const ben = (await a.app.inject({ method: 'POST', url: '/api/v1/friends', cookies: ac, payload: { name: 'Ben', email: 'ben@example.com' } })).json();
  const anaFile = (await a.app.inject({ url: `/api/v1/friends/${ben.id}/file`, cookies: ac })).body;
  const anaFriend = (await b.app.inject({ method: 'POST', url: '/api/v1/friends/from-file', cookies: bc, payload: { text: anaFile } })).json();
  const benFile = (await b.app.inject({ url: `/api/v1/friends/${anaFriend.friend.id}/file`, cookies: bc })).body;
  const brought = await a.app.inject({ method: 'POST', url: `/api/v1/friends/${ben.id}/file`, cookies: ac, payload: { text: benFile } });
  return { ben, anaFriend: anaFriend.friend, anaFile, benFile, brought };
}

describe("friends' collections", () => {
  it('shares a file with what the settings share, never prices paid', async () => {
    const ben = (await a.app.inject({ method: 'POST', url: '/api/v1/friends', cookies: ac, payload: { name: 'Ben' } })).json();
    const res = await a.app.inject({ url: `/api/v1/friends/${ben.id}/file`, cookies: ac });
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="squirrelcade-\d{4}-\d{2}-\d{2}\.json"$/);
    const file = res.json();
    expect(file).toMatchObject({ format: 'squirrelcade-friend', version: 1, from: 'Ana', currency: 'USD' });
    expect(file.collection).toHaveLength(3);
    expect(file.collection.find((g: { title: string }) => g.title === 'Halo 3').copies).toHaveLength(2);
    // The loose second copy of Halo 3 is a spare, for trade.
    expect(file.forTrade).toEqual([expect.objectContaining({ title: 'Halo 3', condition: 'loose', valueCents: 1200, kind: 'spare' })]);
    expect(file.wishlist.map((w: { title: string }) => w.title).sort()).toEqual(['Fable II', 'Mass Effect']);
    expect(res.body).not.toMatch(/cost|paid|notes/i);
    // Values can stay home.
    a.settings.update({ 'friends.shareValues': false, 'friends.shareWishlist': 0 });
    const plain = (await a.app.inject({ url: `/api/v1/friends/${ben.id}/file`, cookies: ac })).json();
    expect(plain.collection[0].copies[0].valueCents).toBeNull();
    expect(plain.wishlist).toBeUndefined();
  });

  it("brings a friend's file in, by its code, and compares the collections console by console", async () => {
    await benTradesFable();
    const { ben, anaFriend, brought } = await befriend();
    expect(anaFriend.name).toBe('Ana');
    expect(brought.statusCode).toBe(201);
    expect(brought.json()).toMatchObject({ friend: { name: 'Ben' }, games: 3 });
    const list = (await a.app.inject({ url: '/api/v1/friends', cookies: ac })).json().friends;
    expect(list[0]).toMatchObject({ name: 'Ben', email: 'ben@example.com', file: { from: 'Ben', games: 3, forTrade: 1 } });

    const cmp = (await a.app.inject({ url: `/api/v1/friends/${ben.id}/compare?platform=xbox-360`, cookies: ac })).json();
    expect(cmp.consoles.find((c: { key: string }) => c.key === 'xbox-360')).toEqual({ key: 'xbox-360', name: 'Xbox 360', both: 1, onlyYou: 1, onlyThem: 2 });
    const row = (title: string) => cmp.rows.find((r: { title: string }) => r.title === title);
    expect(row('Gears of War')).toMatchObject({ mine: { copies: 1 }, theirs: { copies: 1 } });
    expect(row('Halo 3')).toMatchObject({ mine: { copies: 2 }, theirs: null, theyWant: { rank: expect.any(Number) } });
    expect(row('Fable II')).toMatchObject({ mine: null, theirsForTrade: true, youWant: { acorns: expect.any(Number) } });
  });

  it('finds trades that come out even, and what evens out one game picked', async () => {
    await benTradesFable();
    // Ana would trade Cars 2 too: Ben wants it for the wishlist, though not for missing it (Ben has no PlayStation 3 game).
    const anaItems = (await a.app.inject({ url: '/api/v1/collection/items?pageSize=50', cookies: ac })).json().items as { title: string; copyKey?: string; key?: string }[];
    const cars = anaItems.find((i) => i.title.startsWith('Cars 2'))!;
    expect((await a.app.inject({ method: 'PUT', url: '/api/v1/copy', cookies: ac, payload: { key: cars.copyKey ?? cars.key, sale: 'trade' } })).statusCode).toBe(200);
    const { ben } = await befriend();
    const trades = (await a.app.inject({ url: `/api/v1/friends/${ben.id}/trades`, cookies: ac })).json();
    expect(trades).toMatchObject({ margin: 20, sameCurrency: true });
    expect(trades.theyHaveYouWant.map((t: { title: string }) => t.title)).toEqual(['Fable II']);
    const wantedOfMine = (title: string) => trades.youHaveTheyWant.find((t: { title: string }) => t.title.startsWith(title));
    expect(trades.youHaveTheyWant).toHaveLength(2);
    expect(wantedOfMine('Halo 3')).toMatchObject({ condition: 'loose', kind: 'spare', missing: true, want: { acorns: expect.any(Number) } });
    expect(wantedOfMine('Cars 2')).toMatchObject({ kind: 'trade', missing: false, want: { rank: expect.any(Number) } });
    // Fable II (13.00) for the loose Halo 3 (12.00): within 20%.
    expect(trades.ideas[0]).toMatchObject({ get: { title: 'Fable II', valueCents: 1300 }, give: { items: [{ title: 'Halo 3' }], totalCents: 1200 } });

    // Any game of theirs: Mass Effect (10.00) is evened out by Cars 2 (9.00) or the loose Halo 3 (12.00), the closest first.
    const games = (await a.app.inject({ url: `/api/v1/friends/${ben.id}/games?platform=xbox-360`, cookies: ac })).json().games;
    const mass = games.find((g: { title: string }) => g.title === 'Mass Effect');
    const forIt = (await a.app.inject({ url: `/api/v1/friends/${ben.id}/trade-for?item=${encodeURIComponent(mass.key)}`, cookies: ac })).json();
    expect(forIt.target).toMatchObject({ title: 'Mass Effect', valueCents: 1000 });
    expect(forIt.offers.map((o: { items: { title: string }[]; diffPct: number }) => [o.items.map((i) => i.title).join(' + '), o.diffPct])).toEqual([
      ['Cars 2: The Video Game', -10],
      ['Halo 3', 20],
    ]);
  });

  it("takes a zip, and refuses a file with another friendship's code unless told it's theirs", async () => {
    const { ben, benFile } = await befriend();
    // A zip with the file in it, dropped on the page.
    const zip = makeZip({ 'squirrelcade.json': benFile });
    const zipped = await a.app.inject({ method: 'POST', url: `/api/v1/friends/${ben.id}/file`, cookies: ac, ...multipartFile('ben.zip', zip, 'application/zip') });
    expect(zipped.statusCode).toBe(201);
    const forged = JSON.stringify({ ...JSON.parse(benFile), code: '!first' });
    const refused = await a.app.inject({ method: 'POST', url: `/api/v1/friends/${ben.id}/file`, cookies: ac, payload: { text: forged } });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().message).toContain('another code');
    expect((await a.app.inject({ method: 'POST', url: `/api/v1/friends/${ben.id}/file`, cookies: ac, payload: { text: forged, force: true } })).statusCode).toBe(201);
    // Both sides keep the smaller code, so Ana's next file carries it (and Ben's Squirrelcade, forcing it, keeps it too).
    expect((await a.app.inject({ url: `/api/v1/friends/${ben.id}/file`, cookies: ac })).json().code).toBe('!first');
    const later = JSON.stringify({ ...JSON.parse(benFile), code: 'zz-later' });
    expect((await a.app.inject({ method: 'POST', url: `/api/v1/friends/${ben.id}/file`, cookies: ac, payload: { text: later, force: true } })).statusCode).toBe(201);
    expect((await a.app.inject({ url: `/api/v1/friends/${ben.id}/file`, cookies: ac })).json().code).toBe('!first');
    // A damaged zip is refused in plain words.
    const damaged = Buffer.concat([zip.subarray(0, 40), Buffer.alloc(30)]);
    const broken = await a.app.inject({ method: 'POST', url: `/api/v1/friends/${ben.id}/file`, cookies: ac, ...multipartFile('ben.zip', damaged, 'application/zip') });
    expect([broken.statusCode, broken.json().message]).toEqual([400, expect.stringMatching(/zip/i)]);
    // Not a share file.
    const junk = await a.app.inject({ method: 'POST', url: '/api/v1/friends/from-file', cookies: ac, payload: { text: '{"hello":1}' } });
    expect(junk.statusCode).toBe(400);
    expect(junk.json().message).toContain("isn't a Squirrelcade share file");
  });

  it("keeps friends from viewers, and asks for a file before comparing", async () => {
    const ben = (await a.app.inject({ method: 'POST', url: '/api/v1/friends', cookies: ac, payload: { name: 'Ben' } })).json();
    expect((await a.app.inject({ url: `/api/v1/friends/${ben.id}/compare`, cookies: ac })).statusCode).toBe(409);
    const invite = (await a.app.inject({ method: 'POST', url: '/api/v1/invites', cookies: ac, payload: { name: 'Sam' } })).json();
    const joined = await a.app.inject({ method: 'POST', url: `/api/v1${invite.path}`, payload: { username: 'sam', password: 'a long password' } });
    const viewer = { squirrelcade_session: joined.cookies.find((k) => k.name === 'squirrelcade_session')!.value };
    expect((await a.app.inject({ url: '/api/v1/friends', cookies: viewer })).statusCode).toBe(403);
    expect((await a.app.inject({ method: 'DELETE', url: `/api/v1/friends/${ben.id}`, cookies: ac })).json()).toEqual({ removed: true });
  });
});
