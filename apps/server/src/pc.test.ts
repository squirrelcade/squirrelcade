import { parsePlayniteSnapshot } from '@squirrelcade/core';
import { mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { exportCsv, fakeTransports, multipartFile, seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp({ features: ['pc'] });
  cookies = await setUp(g);
});
afterEach(async () => {
  await g.cleanup();
});

/** A Playnite reader snapshot with the given [storefront, id, title, playtime hours] records. */
function snapshot(records: [string, string, string, number?][], fileName = 'PlayniteBackup-2026-09-26.zip'): string {
  return JSON.stringify({
    schemaVersion: 'vgcm-playnite-library-v1',
    generatedAtUtc: '2026-09-27T12:00:00Z',
    source: { fileName, lastWriteUtc: '2026-09-26T12:53:59Z', fingerprint: fileName },
    statistics: { gameRecords: records.length },
    records: records.map(([store, id, name, hours]) => ({
      recordKey: `${store}|${id}`,
      playniteId: `p-${store}-${id}`,
      storefrontGameId: id,
      sourceName: store,
      name,
      platforms: ['PC (Windows)'],
      genres: ['Action'],
      series: [],
      favorite: false,
      hidden: false,
      installed: false,
      playtimeSeconds: (hours ?? 0) * 3600,
      playCount: 0,
      links: [],
    })),
  });
}

const LIBRARY: [string, string, string, number?][] = [
  ['Steam', '1', 'Hades', 40],
  ['Epic', 'a', 'Hades'],
  ['Steam', '2', 'Celeste: Farewell Edition', 12],
  ['Xbox', '9', 'Halo Infinite'],
  ['Xbox', '10', 'Forza Horizon 5'],
];

const upload = (text: string) => g.app.inject({ method: 'POST', url: '/api/v1/pc/snapshot', cookies, ...multipartFile('snapshot.json', Buffer.from(text), 'application/json') });
const games = async (query = '') => (await g.app.inject({ url: `/api/v1/pc/games?pageSize=500${query}`, cookies })).json();

describe('PC library', () => {
  it('reads a snapshot into games across storefronts, with each storefront counting as the settings say', async () => {
    const res = await upload(snapshot(LIBRARY));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ status: 'applied', games: 5, added: 5, removed: 0 });
    const list = await games();
    expect(list.total).toBe(4);
    const hades = list.items.find((f: { title: string }) => f.title === 'Hades');
    expect(hades).toMatchObject({ owned: true, playtimeHours: 40 });
    expect(hades.records.map((r: { storefront: string }) => r.storefront).sort()).toEqual(['Epic', 'Steam']);
    // Xbox mixes subscription games in: its games wait as not verified until an audit says otherwise.
    const halo = list.items.find((f: { title: string }) => f.title === 'Halo Infinite');
    expect(halo).toMatchObject({ owned: false, records: [{ ownership: 'historical', audited: false }] });
    const status = (await g.app.inject({ url: '/api/v1/pc', cookies })).json();
    expect(status).toMatchObject({ records: 5, families: 4, owned: 2, playtimeHours: 52 });
    expect(status.byStorefront.find((s: { storefront: string }) => s.storefront === 'Xbox')).toEqual({ storefront: 'Xbox', records: 2, owned: 0, subscription: 0, historical: 2 });
    // A search finds numbers written either way, as the header's search does ("Forza Horizon V" is Forza Horizon 5).
    expect((await games('&q=forza%20horizon%20v')).items.map((f: { title: string }) => f.title)).toEqual(['Forza Horizon 5']);

    // The audit (the old workbook's tab works as it is) and a single answer on a game decide ownership.
    const audit = ['Source,Storefront Game ID,Source Title,Ownership Status,Active', 'Xbox,9,Halo Infinite,Subscription Access,Yes', 'Xbox,10,Forza Horizon 5,Permanent / Claimed,Yes'].join('\n');
    const put = await g.app.inject({ method: 'PUT', url: '/api/v1/pc/audit', cookies, ...multipartFile('audit.csv', Buffer.from(audit)) });
    expect(put.json()).toEqual({ entries: 2, problems: [] });
    expect((await games('&ownership=subscription')).items.map((f: { title: string }) => f.title)).toEqual(['Halo Infinite']);
    const patch = await g.app.inject({ method: 'PATCH', url: `/api/v1/pc/games/${encodeURIComponent('xbox|9')}`, cookies, payload: { ownership: 'permanent' } });
    expect(patch.statusCode).toBe(200);
    expect((await games('&q=halo')).items[0]).toMatchObject({ owned: true, records: [{ ownership: 'permanent', audited: true }] });
  });

  it('holds a reading that would lose too many games until it is confirmed', async () => {
    await upload(snapshot(LIBRARY));
    const res = await upload(snapshot(LIBRARY.slice(0, 2), 'PlayniteBackup-broken.zip'));
    expect(res.json()).toMatchObject({ status: 'held', removed: 3 });
    expect((await games()).total).toBe(4);
    const status = (await g.app.inject({ url: '/api/v1/pc', cookies })).json();
    expect(status.held).toMatchObject({ fileName: 'PlayniteBackup-broken.zip', games: 2 });
    const apply = await g.app.inject({ method: 'POST', url: `/api/v1/pc/reads/${status.held.id}/apply`, cookies });
    expect(apply.json()).toMatchObject({ status: 'applied', games: 2 });
    expect((await games()).total).toBe(1);
    expect((await g.app.inject({ url: '/api/v1/pc', cookies })).json().held).toBeNull();
    // A held reading can also be discarded: the library stays as it was. Only a held reading can be.
    await upload(snapshot(LIBRARY, 'PlayniteBackup-full.zip'));
    const held = await upload(snapshot([['Steam', '1', 'Hades']], 'PlayniteBackup-broken-again.zip'));
    expect(held.json()).toMatchObject({ status: 'held' });
    const heldId = (await g.app.inject({ url: '/api/v1/pc', cookies })).json().held.id;
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/pc/reads/${heldId}/discard`, cookies })).json()).toEqual({ ok: true });
    expect((await games()).total).toBe(4);
    expect((await g.app.inject({ method: 'POST', url: `/api/v1/pc/reads/${heldId}/discard`, cookies })).statusCode).toBe(409);
    // Reading the newest backup now is a task in the background.
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/pc/read', cookies })).statusCode).toBe(202);
  });

  it('shows the console copies of PC games, and sealed console games not owned on PC', async () => {
    const csv = exportCsv([
      ['1', 'Hades', 'Nintendo Switch', 2000],
      ['2', 'Hollow Knight', 'Nintendo Switch', 1500, 'New Item, Box, and Manual'],
    ]);
    g.collection.importText(csv, { source: 'upload', fileName: 'collection_20260927.csv' });
    await upload(snapshot(LIBRARY));
    const hades = (await games('&q=hades')).items[0];
    expect(hades.consoles).toEqual([{ platform: 'Nintendo Switch', platformKey: 'nintendo-switch', title: 'Hades', copies: 1, sealed: 0 }]);
    expect((await games('&view=both')).items.map((f: { title: string }) => f.title)).toEqual(['Hades']);
    const sealed = (await g.app.inject({ url: '/api/v1/pc/sealed', cookies })).json();
    expect(sealed).toEqual([{ title: 'Hollow Knight', key: 'hollowknight', consoles: [{ platform: 'Nintendo Switch', platformKey: 'nintendo-switch', title: 'Hollow Knight', copies: 1, sealed: 1 }] }]);

    // The PC library as a spreadsheet, with the page's filters.
    const res = await g.app.inject({ url: '/api/v1/pc/export?view=both', cookies });
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="squirrelcade-pc-library-\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = res.body.trim().split(/\r?\n/);
    expect(lines[0]).toBe('Title,Owned for good,Storefronts,Playtime (hours),Last played,Installed,Genres,Series,Console copies');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/^Hades,yes,/);
    expect(lines[1]).toMatch(/Nintendo Switch$/);
    const all = (await g.app.inject({ url: '/api/v1/pc/export', cookies })).body.trim().split(/\r?\n/);
    expect(all.length).toBeGreaterThan(2);
  });

  it('says where a console game is owned on PC: on its console page, the wishlist and in Store Mode, never counting it', async () => {
    seedCatalogs(g, {
      owned: [['1', 'Celeste', 'Nintendo Switch'], ['2', 'Cuphead', 'Nintendo Switch'], ['3', 'Hollow Knight', 'Nintendo Switch'], ['4', 'Ori', 'Nintendo Switch'], ['5', 'Gris', 'Nintendo Switch'], ['6', 'Tunic', 'Nintendo Switch']],
      catalogs: { 'nintendo-switch': [{ title: 'Hades', evidence: 'list' }, { title: 'Celeste', evidence: 'list' }] },
    });
    await upload(snapshot(LIBRARY));
    const detail = (await g.app.inject({ url: '/api/v1/catalogs/nintendo-switch', cookies })).json();
    const hades = detail.entries.find((e: { title: string }) => e.title === 'Hades');
    expect(hades).toMatchObject({ status: 'missing', pc: ['Steam', 'Epic'] });
    const wish = g.wishlist.compute().master.find((c) => c.title === 'Hades')!;
    expect(wish.components.find((c) => c.label.startsWith('Owned on PC'))).toEqual({ label: 'Owned on PC (Steam, Epic)', points: -10 });
    const found = (await g.app.inject({ url: '/api/v1/lookup?q=hades', cookies })).json();
    expect(found[0]).toMatchObject({ answer: 'need', ownedOnPc: ['Steam', 'Epic'] });
  });

  it('refuses what is not a snapshot, and says when there is no Playnite folder', async () => {
    const res = await upload('{"schemaVersion":"something else","records":[]}');
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Playnite reader snapshot/);
    expect(await g.pc.readBackup()).toBe('No Playnite backup folder is set (Settings > PC library).');
  });
});

describe('PC library health', () => {
  const status = async () => (await g.app.inject({ url: '/api/v1/system/status', cookies })).json() as { folders: { name: string; path: string; exists: boolean; writable: boolean; needsWrite: boolean }[]; health: { message: string }[] };
  const pcProblems = async () => (await status()).health.map((h) => h.message).filter((m) => /Playnite/.test(m));

  it('leaves the PC library out of the health check until it is used', async () => {
    const s = await status();
    expect(s.folders.map((f) => f.name)).not.toContain('Playnite backups');
    expect(await pcProblems()).toEqual([]);
  });

  it('warns when the chosen Playnite folder is missing, when its newest backup is old, and when it empties after a reading', async () => {
    const folder = join(g.env.configDir, 'playnite');
    g.settings.update({ 'pc.playniteFolder': folder });
    expect(await pcProblems()).toEqual([`Playnite backups folder ${folder} doesn't exist.`]);

    mkdirSync(folder);
    const zip = join(folder, 'PlayniteBackup-2026-09-01.zip');
    writeFileSync(zip, 'zip');
    const old = new Date(Date.now() - 20 * 86_400_000);
    utimesSync(zip, old, old);
    const s = await status();
    expect(s.folders.find((f) => f.name === 'Playnite backups')).toMatchObject({ path: folder, exists: true, writable: true, needsWrite: false });
    expect(await pcProblems()).toEqual(["The newest Playnite backup (PlayniteBackup-2026-09-01.zip) is 20 days old; check Playnite's automatic backups (Playnite > Settings > Backup)."]);
    g.settings.update({ 'pc.staleBackupDays': 0 });
    expect(await pcProblems()).toEqual([]);

    // Read once from the folder, then the share goes away (an empty mount point).
    g.pc.applySnapshot(parsePlayniteSnapshot(snapshot(LIBRARY)), 'backup', { backupAt: old.toISOString() });
    rmSync(zip);
    expect(await pcProblems()).toEqual([`The Playnite backup folder ${folder} has no backups any more (is the share still mounted?); the PC library stays as it was last read.`]);
  });

  it('adds the PC library to the dashboard stats', async () => {
    await upload(snapshot(LIBRARY));
    const stats = (await g.app.inject({ url: '/api/v1/stats', cookies })).json();
    expect(stats).toMatchObject({ pcGames: 4, pcOwned: 2, pcHours: 52 });
  });

  it('sends a message when a reading is held for you', async () => {
    await g.cleanup();
    const fake = fakeTransports();
    g = await testApp({ transports: fake.transports, features: ['pc'] });
    cookies = await setUp(g);
    g.settings.update({ 'general.publicUrl': 'https://squirrelcade.example.test', 'notifications.pushoverEnabled': true, 'notifications.pushoverToken': 'app-token', 'notifications.pushoverUser': 'user-key' });
    await upload(snapshot(LIBRARY));
    await upload(snapshot(LIBRARY.slice(0, 1), 'PlayniteBackup-broken.zip'));
    await g.notifications.idle();
    expect(fake.sent.push).toHaveLength(1);
    expect(fake.sent.push[0]).toMatchObject({ title: 'Squirrelcade: PC library reading waiting for you', url: 'https://squirrelcade.example.test/pc', priority: 0 });
    expect(fake.sent.push[0]!.message).toMatch(/^Held: this reading would take 4 of your 5 PC games away/);
  });
});
