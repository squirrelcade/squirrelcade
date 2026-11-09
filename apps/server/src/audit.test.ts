import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { multipartFile, seedCatalogs, setUp, testApp } from './test-helpers.js';

// The collection audit (1.5.0, R05).
let g: Awaited<ReturnType<typeof testApp>>;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
  seedCatalogs(g, {
    owned: [
      ['1', 'Alan Wake', 'Xbox 360'],
      ['2', 'Bayonetta', 'Xbox 360'],
      ['3', 'Blue Dragon', 'Xbox 360'],
      ['4', 'Crackdown', 'Xbox 360'],
      ['5', 'Uncharted', 'Playstation 3'],
      ['6', 'Xbox 360 Console', 'Xbox 360'],
    ],
    catalogs: { 'xbox-360': ['Alan Wake', 'Bayonetta', 'Blue Dragon', 'Crackdown', 'Lost Odyssey'] },
  });
});
afterEach(async () => {
  await g.cleanup();
});

const get = async () => (await g.app.inject({ url: '/api/v1/audit', cookies })).json().audit;

describe('the collection audit', () => {
  it('ticks a shelf\'s copies, keeps what isn\'t logged, and lists what wasn\'t seen', async () => {
    expect(await get()).toBeNull();
    const started = (await g.app.inject({ method: 'POST', url: '/api/v1/audit', cookies, payload: { name: 'Thanksgiving' } })).json().audit;
    expect(started).toMatchObject({ name: 'Thanksgiving', finishedAt: null, totals: { copies: 5, marked: 0, shelves: 0 } });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/audit', cookies, payload: {} })).statusCode).toBe(409);

    // A shelf: two games read that you have (one in capitals), one you don't, one read that's nothing.
    const shelf = (
      await g.app.inject({
        method: 'POST',
        url: `/api/v1/audit/${started.id}/shelves`,
        cookies,
        payload: { platformKey: 'xbox-360', name: 'Office, case 3', reads: 12, seen: ['Alan Wake', 'BAYONETTA', 'Not A Game'], notLogged: [{ title: 'Lost Odyssey', read: 'LOST ODYSS' }] },
      })
    ).json();
    expect(shelf.seen.map((s: { title: string }) => s.title)).toEqual(['Alan Wake', 'Bayonetta']);
    expect(shelf.unmatched).toEqual(['Not A Game']);
    // The shelf's name became their place (Settings > Collection, on to start).
    const places = (await g.app.inject({ url: '/api/v1/places', cookies })).json();
    expect(JSON.stringify(places)).toContain('Office, case 3');

    // A tap and a barcode tick others; hardware isn't counted.
    const unseen = (await g.app.inject({ url: `/api/v1/audit/${started.id}/copies?platform=xbox-360`, cookies })).json().copies;
    expect(unseen.map((c: { title: string }) => c.title)).toEqual(['Blue Dragon', 'Crackdown']);
    const blue = unseen.find((c: { title: string }) => c.title === 'Blue Dragon');
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/audit/${started.id}/seen`, cookies, payload: { copyKeys: [blue.copyKey], how: 'hand' } })).json()).toEqual({ ticked: 1 });

    // What wasn't seen: one's lost (it leaves the collection), PS3's Uncharted lent.
    const crackdown = unseen.find((c: { title: string }) => c.title === 'Crackdown');
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/audit/${started.id}/settle`, cookies, payload: { copyKey: crackdown.copyKey, outcome: 'lost' } })).json()).toEqual({ settled: 'lost' });
    const ps3 = (await g.app.inject({ url: `/api/v1/audit/${started.id}/copies?platform=playstation-3`, cookies })).json().copies;
    await g.app.inject({ method: 'POST', url: `/api/v1/audit/${started.id}/settle`, cookies, payload: { copyKey: ps3[0].copyKey, outcome: 'lent', lentTo: 'Sam' } });
    const loans = (await g.app.inject({ url: '/api/v1/loans', cookies })).json();
    expect(JSON.stringify(loans)).toContain('Sam');

    const now = await get();
    expect(now.totals).toMatchObject({ copies: 4, marked: 4, seen: 3, gone: 1, lent: 1, shelves: 1 });
    expect(now.shelves[0]).toMatchObject({ name: 'Office, case 3', reads: 12, seen: 2, notLogged: [{ title: 'Lost Odyssey', read: 'LOST ODYSS' }] });
    expect(now.consoles.find((c: { key: string }) => c.key === 'xbox-360')).toMatchObject({ copies: 3, seen: 3 });

    // Finished, then picked up again.
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/audit/${started.id}/finish`, cookies })).json().audit.finishedAt).not.toBeNull();
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/audit/${started.id}/seen`, cookies, payload: { copyKeys: [] } })).statusCode).toBe(409);
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/audit/${started.id}/reopen`, cookies })).json().audit.finishedAt).toBeNull();
  });

  it("keeps a shelf's photo, smaller, and notes a copy added on the spot", async () => {
    const a = (await g.app.inject({ method: 'POST', url: '/api/v1/audit', cookies, payload: {} })).json().audit;
    expect(a.name).toMatch(/^Collection audit, /);
    const shelf = (await g.app.inject({ method: 'POST', url: `/api/v1/audit/${a.id}/shelves`, cookies, payload: { platformKey: 'xbox-360', seen: [], notLogged: [{ title: 'Lost Odyssey' }] } })).json().shelf;
    const jpeg = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#884422' } }).jpeg().toBuffer();
    const upload = multipartFile('shelf.jpg', jpeg, 'image/jpeg');
    const kept = (await g.app.inject({ method: 'POST', url: `/api/v1/audit/shelves/${shelf.id}/photos`, cookies, ...upload })).json();
    expect(kept).toEqual({ photos: 1, kept: true });
    const photo = await g.app.inject({ url: `/api/v1/audit/${a.id}/photos/${shelf.id}-1.jpg`, cookies });
    expect(photo.statusCode).toBe(200);
    expect((await sharp(photo.rawPayload).metadata()).width).toBe(1600);

    // Added from the shelf (as Store Mode adds it), then told to the audit.
    const added = (await g.app.inject({ method: 'POST', url: '/api/v1/collection/copies', cookies, payload: { platformKey: 'xbox-360', title: 'Lost Odyssey', completeness: 'complete' } })).json();
    const key = added.copy?.key ?? added.key;
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/audit/${a.id}/added`, cookies, payload: { copyKey: key, shelfId: shelf.id, title: 'Lost Odyssey' } })).json()).toEqual({ added: true });
    const now = await get();
    expect(now.totals).toMatchObject({ added: 1, marked: 1 });
    expect(now.shelves[0].notLogged).toEqual([{ title: 'Lost Odyssey', added: true }]);
  });
});
