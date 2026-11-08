import { SHARE_FORMAT, type ShareFile } from '@squirrelcade/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { directLink, driveConfirmLink, friendshipId, makeInvite, openLive, readEnvelope, readInvite, sealLive } from './friendLive.js';
import type { FetchLike } from './igdb.js';
import { exportCsv, setUp, testApp, type TestApp } from './test-helpers.js';

const FILE: ShareFile = {
  format: SHARE_FORMAT,
  version: 1,
  from: 'Ana',
  code: 'abcdefghijklmnop',
  madeAt: '2026-11-08T10:00:00.000Z',
  currency: 'USD',
  collection: [{ platformKey: 'xbox-360', platform: 'Xbox 360', productId: '1', title: 'Halo 3', copies: [{ condition: 'complete', valueCents: 2000 }] }],
};

describe('the live file (D214)', () => {
  it('says what it is in plain JSON, and never carries the code', () => {
    const env = sealLive(FILE, FILE.code);
    const text = JSON.stringify(env);
    expect(env.format).toBe('squirrelcade-friend-live');
    expect(env.version).toBe(1);
    expect(env.from).toBe('Ana');
    expect(env.friendship).toBe(friendshipId(FILE.code));
    expect(env.madeAt).toBe(FILE.madeAt);
    expect(text).not.toContain(FILE.code);
    expect(text).not.toContain('Halo');
    const opened = openLive(readEnvelope(text), FILE.code, 'Ana');
    expect(opened.collection?.[0]?.title).toBe('Halo 3');
    expect(opened.code).toBe(FILE.code);
  });

  it('is refused when its header was changed, or with another code', () => {
    const env = sealLive(FILE, FILE.code);
    expect(() => openLive({ ...env, madeAt: '2027-01-01T00:00:00.000Z' }, FILE.code, 'Ana')).toThrow(/doesn't check out/);
    expect(() => openLive(env, 'another-code-entirely', 'Ana')).toThrow(/doesn't check out/);
    const flipped = Buffer.from(env.body, 'base64');
    flipped[0] = (flipped[0] ?? 0) ^ 1;
    expect(() => openLive({ ...env, body: flipped.toString('base64') }, FILE.code, 'Ana')).toThrow(/doesn't check out/);
  });

  it('refuses what is not one, with a plain reason', () => {
    expect(() => readEnvelope('<!DOCTYPE html><html>Google Drive can\'t scan this file for viruses</html>')).toThrow(/web page, not a Squirrelcade file/);
    expect(() => readEnvelope('hello')).toThrow(/isn't JSON/);
    expect(() => readEnvelope(JSON.stringify({ ...FILE }))).toThrow(/sent by hand/);
    expect(() => readEnvelope(JSON.stringify({ format: 'something-else' }))).toThrow(/not a Squirrelcade live friend file/);
    expect(() => readEnvelope(JSON.stringify({ ...sealLive(FILE, FILE.code), version: 9 }))).toThrow(/newer Squirrelcade/);
    expect(() => readEnvelope(JSON.stringify({ ...sealLive(FILE, FILE.code), salt: '' }))).toThrow(/damaged/);
  });

  it('carries the code in the invite, read back from an email with its line breaks', () => {
    const invite = makeInvite({ from: 'Ana', code: FILE.code, link: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing' });
    expect(invite.startsWith('squirrelcade-invite:')).toBe(true);
    const wrapped = `Here it is:\n${invite.slice(0, 40)}\n${invite.slice(40)}\n\nMark`;
    expect(readInvite(wrapped)).toEqual({ from: 'Ana', code: FILE.code, link: 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing' });
    expect(() => readInvite('nothing here')).toThrow(/isn't a Squirrelcade invite/);
    expect(() => readInvite('squirrelcade-invite:abc')).toThrow(/incomplete/);
  });

  it("reads a Google Drive or Dropbox share link from its download address, and Drive's virus page's form", () => {
    expect(directLink('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')).toBe('https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t');
    expect(directLink('https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp')).toContain('id=1AbCdEfGhIjKlMnOp');
    expect(directLink('https://www.dropbox.com/scl/fi/xyz/f.json?rlkey=k&dl=0')).toContain('dl=1');
    expect(directLink('https://example.com/f.json')).toBe('https://example.com/f.json');
    const page = `<html><form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="1AbC"><input type="hidden" name="export" value="download"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="u-1"></form></html>`;
    expect(driveConfirmLink(page)).toBe('https://drive.usercontent.google.com/download?id=1AbC&export=download&confirm=t&uuid=u-1');
    expect(driveConfirmLink('<html>no form</html>')).toBeNull();
  });
});

// Two Squirrelcades: Ana shares live with Ben through a folder a cloud service would carry; Ben reads its link.
let a: TestApp;
let b: TestApp;
let ac: Record<string, string>;
let bc: Record<string, string>;
let served: { status: number; type: string; body: string } | null = null;
let page: string | null = null;
const LINK = 'https://drive.google.com/file/d/1AnaLiveFileForBen/view?usp=sharing';

const benFetch: FetchLike = async (url) => {
  if (page && !url.includes('uuid=')) return new Response(page, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
  if (!served) throw new Error('offline');
  return new Response(served.body, { status: served.status, headers: { 'content-type': served.type } });
};

beforeEach(async () => {
  a = await testApp();
  ac = await setUp(a, 'ana');
  b = await testApp({ friendsFetch: benFetch });
  bc = await setUp(b, 'ben');
  a.collection.importText(exportCsv([['1', 'Halo 3', 'Xbox 360', 2000, 'Item, Box, and Manual'], ['2', 'Gears of War', 'Xbox 360', 1500]]), { source: 'upload', fileName: 'collection_20260101.csv' });
  b.collection.importText(exportCsv([['10', 'Fable II', 'Xbox 360', 1300]]), { source: 'upload', fileName: 'collection_20260101.csv' });
  a.settings.update({ 'friends.myName': 'Ana', 'friends.liveFolder': join(a.dir, 'cloud') });
  b.settings.update({ 'friends.myName': 'Ben' });
  served = null;
  page = null;
});
afterEach(async () => {
  await a.cleanup();
  await b.cleanup();
});

/** What Ana's folder holds for Ben, as the cloud would serve it. */
const anaFile = () => {
  const dir = join(a.dir, 'cloud');
  const name = readdirSync(dir).find((n) => n.endsWith('.json'))!;
  return readFileSync(join(dir, name), 'utf8');
};

async function anaSharesWithBen() {
  const ben = (await a.app.inject({ method: 'POST', url: '/api/v1/friends', cookies: ac, payload: { name: 'Ben', email: 'ben@example.com' } })).json();
  const noLink = await a.app.inject({ url: `/api/v1/friends/${ben.id}/invite`, cookies: ac });
  expect(noLink.statusCode).toBe(409);
  const on = await a.app.inject({ method: 'PUT', url: `/api/v1/friends/${ben.id}/live`, cookies: ac, payload: { share: true } });
  expect(on.json().written.written).toBe(1);
  expect(readdirSync(join(a.dir, 'cloud'))).toEqual(['squirrelcade-ana-for-ben.json']);
  expect((await a.app.inject({ url: `/api/v1/friends/${ben.id}/invite`, cookies: ac })).statusCode).toBe(409);
  await a.app.inject({ method: 'PUT', url: `/api/v1/friends/${ben.id}/live`, cookies: ac, payload: { link: LINK } });
  const invite = (await a.app.inject({ url: `/api/v1/friends/${ben.id}/invite`, cookies: ac })).json().invite as string;
  served = { status: 200, type: 'application/octet-stream', body: anaFile() };
  return { ben, invite };
}

describe('live links between two Squirrelcades (D214)', () => {
  it("writes Ana's file for Ben, which Ben's Squirrelcade reads from the invite's link, and only when it's newer", async () => {
    const { invite } = await anaSharesWithBen();
    expect(anaFile()).not.toContain('Halo');
    const took = await b.app.inject({ method: 'POST', url: '/api/v1/friends/invite', cookies: bc, payload: { invite } });
    expect(took.statusCode).toBe(201);
    const { friend, result } = took.json();
    expect(friend.name).toBe('Ana');
    expect(result).toMatchObject({ ok: true, read: true, games: 2 });
    const cmp = (await b.app.inject({ url: `/api/v1/friends/${friend.id}/compare`, cookies: bc })).json();
    expect(JSON.stringify(cmp)).toContain('Halo 3');

    // The same file again: nothing new.
    const again = (await b.app.inject({ method: 'POST', url: `/api/v1/friends/${friend.id}/live/read`, cookies: bc })).json();
    expect(again).toMatchObject({ ok: true, read: false });
    expect(again.message).toMatch(/Nothing new/);

    // Ana adds a game: her file is written again with the same name, and Ben reads it.
    a.collection.importText(exportCsv([['1', 'Halo 3', 'Xbox 360', 2000, 'Item, Box, and Manual'], ['2', 'Gears of War', 'Xbox 360', 1500], ['3', 'Mass Effect', 'Xbox 360', 1000]]), { source: 'upload', fileName: 'collection_20260102.csv' });
    await new Promise((r) => setTimeout(r, 5));
    const run = await a.tasks.runNow('friends-live');
    expect(run?.message ?? '').toMatch(/1 live file written/);
    expect(readdirSync(join(a.dir, 'cloud'))).toEqual(['squirrelcade-ana-for-ben.json']);
    served = { status: 200, type: 'application/json', body: anaFile() };
    const newer = (await b.app.inject({ method: 'POST', url: `/api/v1/friends/${friend.id}/live/read`, cookies: bc })).json();
    expect(newer).toMatchObject({ ok: true, read: true, games: 3 });

    // Unchanged since: the task doesn't write it again.
    expect((await a.tasks.runNow('friends-live'))?.message).toMatch(/0 live files written, 1 unchanged/);

    // The status board has a line for Ana's link on Ben's side, and Ana's own files on hers.
    const linesB = (await b.app.inject({ url: '/api/v1/system/integrations', cookies: bc })).json().lines as { key: string; light: string; name: string }[];
    expect(linesB.find((l) => l.key === `friend-link-${friend.id}`)).toMatchObject({ light: 'green', name: "Ana's live link" });
    const linesA = (await a.app.inject({ url: '/api/v1/system/integrations', cookies: ac })).json().lines as { key: string; light: string }[];
    expect(linesA.find((l) => l.key === 'friends-live-files')?.light).toBe('green');
  });

  it('refuses a wrong, broken or unreachable file with a plain reason, and keeps the last good one', async () => {
    const { invite } = await anaSharesWithBen();
    const { friend } = (await b.app.inject({ method: 'POST', url: '/api/v1/friends/invite', cookies: bc, payload: { invite } })).json();
    const read = async () => (await b.app.inject({ method: 'POST', url: `/api/v1/friends/${friend.id}/live/read`, cookies: bc })).json();

    served = { status: 200, type: 'text/html', body: '<!DOCTYPE html><html><body>Sign in - Google Accounts</body></html>' };
    expect((await read()).message).toMatch(/web page, not a Squirrelcade file/);
    served = { status: 404, type: 'text/html', body: 'Not found' };
    expect((await read()).message).toMatch(/not found/);
    served = { status: 403, type: 'text/html', body: 'Denied' };
    expect((await read()).message).toMatch(/Anyone with the link/);

    // Another friendship's file (a code Ben's Squirrelcade doesn't know).
    served = { status: 200, type: 'application/json', body: JSON.stringify(sealLive({ ...FILE, madeAt: new Date(Date.now() + 60_000).toISOString() }, 'someone-elses-code-0001')) };
    expect((await read()).message).toMatch(/another friendship/);

    // The right friendship's id, but the body was changed on the way.
    const env = JSON.parse(anaFile());
    served = { status: 200, type: 'application/json', body: JSON.stringify({ ...env, madeAt: new Date(Date.now() + 60_000).toISOString() }) };
    expect((await read()).message).toMatch(/doesn't check out/);

    // A hand-sent file at the link.
    served = { status: 200, type: 'application/json', body: JSON.stringify({ ...FILE }) };
    expect((await read()).message).toMatch(/sent by hand/);

    // Through all of it, Ana's last good file stays, and the status board shows the failure.
    const cmp = (await b.app.inject({ url: `/api/v1/friends/${friend.id}/compare`, cookies: bc })).json();
    expect(JSON.stringify(cmp)).toContain('Halo 3');
    const line = ((await b.app.inject({ url: '/api/v1/system/integrations', cookies: bc })).json().lines as { key: string; light: string; says: string }[]).find((l) => l.key === `friend-link-${friend.id}`);
    expect(line).toMatchObject({ light: 'red' });
    expect(line?.says).toMatch(/sent by hand/);
  });

  it("follows Google Drive's can't-scan-for-viruses page to the file", async () => {
    const { invite } = await anaSharesWithBen();
    page = `<!DOCTYPE html><html><body>Google Drive can't scan this file for viruses.<form id="download-form" action="https://drive.usercontent.google.com/download" method="get"><input type="hidden" name="id" value="1AnaLiveFileForBen"><input type="hidden" name="confirm" value="t"><input type="hidden" name="uuid" value="abc"></form></body></html>`;
    const { result } = (await b.app.inject({ method: 'POST', url: '/api/v1/friends/invite', cookies: bc, payload: { invite } })).json();
    expect(result).toMatchObject({ ok: true, read: true });
  });

  it('gives an existing friend the invite: matched by its code, or the friend chosen takes it', async () => {
    const { invite } = await anaSharesWithBen();
    const ana = (await b.app.inject({ method: 'POST', url: '/api/v1/friends', cookies: bc, payload: { name: 'Ana B.' } })).json();
    const took = (await b.app.inject({ method: 'POST', url: '/api/v1/friends/invite', cookies: bc, payload: { invite, friendId: ana.id } })).json();
    expect(took.friend.id).toBe(ana.id);
    const again = (await b.app.inject({ method: 'POST', url: '/api/v1/friends/invite', cookies: bc, payload: { invite } })).json();
    expect(again.friend.id).toBe(ana.id);
    const list = (await b.app.inject({ url: '/api/v1/friends', cookies: bc })).json().friends as { live: { theirLink: string } }[];
    expect(list).toHaveLength(1);
    expect(list[0]?.live.theirLink).toBe(LINK);
  });
});
