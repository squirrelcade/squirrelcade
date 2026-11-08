import { parseShareFile, ShareFileError, type ShareFile } from '@squirrelcade/core';
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { gunzipSync, gzipSync } from 'node:zlib';

/**
 * Live friend files (1.4.0, D214): a friend's Squirrelcade reads yours again from a link (a cloud folder's shared file:
 * Google Drive, Dropbox, anything that serves a file over https), so comparisons and trades stay current without
 * sending files by hand.
 *
 * The file says what it is in plain JSON (the format, its version, who it's from, the friendship's id, when it was
 * made), and carries the share file encrypted (AES-256-CTR) and checked (HMAC-SHA256 over the header and the
 * encrypted body) with keys made from the friendship's code. The code itself is never in the file: it goes to the
 * friend once, in the invite. So a leaked link shows nothing, and a wrong, broken or someone else's file is never read.
 */

export const LIVE_FORMAT = 'squirrelcade-friend-live';
export const LIVE_VERSION = 1;
export const LIVE_CIPHER = 'aes-256-ctr+hmac-sha256';
export const INVITE_PREFIX = 'squirrelcade-invite:';
/** A live file bigger than this isn't one (a whole collection of 30,000 games packs to a few MB). */
export const MAX_LIVE_BYTES = 40 * 1024 * 1024;
const MAX_UNPACKED = 200 * 1024 * 1024;

export interface LiveEnvelope {
  format: typeof LIVE_FORMAT;
  version: number;
  from: string;
  /** Made from the friendship's code (it doesn't give the code away), so each side knows whose file it is. */
  friendship: string;
  madeAt: string;
  cipher: typeof LIVE_CIPHER;
  salt: string;
  iv: string;
  body: string;
  mac: string;
}

/** Why a live file or link was refused, in plain words. */
export class LiveFileError extends Error {}

/** The friendship's id: the same on both sides (both have the code), and no way back to the code. */
export function friendshipId(code: string): string {
  return createHash('sha256').update(`squirrelcade-friendship:${code}`).digest('base64url').slice(0, 22);
}

function keysOf(code: string, salt: Buffer): { enc: Buffer; mac: Buffer } {
  const k = Buffer.from(hkdfSync('sha256', Buffer.from(code, 'utf8'), salt, 'squirrelcade-friend-live-1', 64));
  return { enc: k.subarray(0, 32), mac: k.subarray(32) };
}

/** What the HMAC covers: every field but the HMAC, in a fixed order, so changing the header breaks it too. */
function macInput(e: Omit<LiveEnvelope, 'mac'>): Buffer {
  return Buffer.from(JSON.stringify([e.format, e.version, e.from, e.friendship, e.madeAt, e.cipher, e.salt, e.iv, e.body]), 'utf8');
}

/** Your share file for a friend, sealed with your friendship's code (which is left out of what's inside). */
export function sealLive(file: ShareFile, code: string): LiveEnvelope {
  const plain = gzipSync(Buffer.from(JSON.stringify({ ...file, code: '' }), 'utf8'));
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const { enc, mac } = keysOf(code, salt);
  const cipher = createCipheriv('aes-256-ctr', enc, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const head: Omit<LiveEnvelope, 'mac'> = {
    format: LIVE_FORMAT,
    version: LIVE_VERSION,
    from: file.from,
    friendship: friendshipId(code),
    madeAt: file.madeAt,
    cipher: LIVE_CIPHER,
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    body: body.toString('base64'),
  };
  return { ...head, mac: createHmac('sha256', mac).update(macInput(head)).digest('base64') };
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Reads a live file's header, refusing anything that isn't one with a reason a person can act on. */
export function readEnvelope(text: string): LiveEnvelope {
  const t = text.replace(/^﻿/, '').trimStart();
  if (t.startsWith('<')) throw new LiveFileError("This link gives a web page, not a Squirrelcade file (a sign-in page, or Google Drive's \"can't scan for viruses\" page?): share the file as Anyone with the link, and paste that link.");
  let raw: unknown;
  try {
    raw = JSON.parse(t);
  } catch {
    throw new LiveFileError("This link doesn't give a Squirrelcade file (what it gives isn't JSON).");
  }
  const e = (raw ?? {}) as Record<string, unknown>;
  if (typeof e !== 'object' || Array.isArray(e)) throw new LiveFileError("This link doesn't give a Squirrelcade file.");
  if (e.format === 'squirrelcade-friend') throw new LiveFileError('This is a friend file sent by hand, not a live one: bring it in with Bring in their file instead.');
  if (e.format !== LIVE_FORMAT) throw new LiveFileError("This link gives a file, but not a Squirrelcade live friend file.");
  if (typeof e.version !== 'number' || !Number.isInteger(e.version) || e.version < 1) throw new LiveFileError('This Squirrelcade file has no version: it was damaged.');
  if (e.version > LIVE_VERSION) throw new LiveFileError(`This live file is from a newer Squirrelcade (its format ${e.version}): update yours to read it.`);
  if (e.cipher !== LIVE_CIPHER) throw new LiveFileError('This live file is sealed in a way this Squirrelcade doesn\'t know: update yours to read it.');
  const s = (v: unknown) => (typeof v === 'string' ? v : '');
  const env: LiveEnvelope = {
    format: LIVE_FORMAT,
    version: e.version,
    from: s(e.from).slice(0, 80),
    friendship: s(e.friendship),
    madeAt: s(e.madeAt),
    cipher: LIVE_CIPHER,
    salt: s(e.salt),
    iv: s(e.iv),
    body: s(e.body),
    mac: s(e.mac),
  };
  if (!/^[\w-]{10,60}$/.test(env.friendship) || Number.isNaN(Date.parse(env.madeAt)) || !B64.test(env.salt) || !B64.test(env.iv) || !B64.test(env.mac) || !(env.body === '' || B64.test(env.body)))
    throw new LiveFileError('This Squirrelcade file is damaged (its header is incomplete).');
  return env;
}

/** Opens a live file with the friendship's code: only when its HMAC checks out. */
export function openLive(env: LiveEnvelope, code: string, friendName: string): ShareFile {
  const salt = Buffer.from(env.salt, 'base64');
  const { enc, mac } = keysOf(code, salt);
  const want = createHmac('sha256', mac).update(macInput(env)).digest();
  const got = Buffer.from(env.mac, 'base64');
  if (got.length !== want.length || !timingSafeEqual(got, want))
    throw new LiveFileError(`This file doesn't check out with your friendship's code with ${friendName}: it was changed or damaged on the way, or made with another code. Ask ${friendName} for a fresh invite.`);
  const decipher = createDecipheriv('aes-256-ctr', enc, Buffer.from(env.iv, 'base64'));
  const packed = Buffer.concat([decipher.update(Buffer.from(env.body, 'base64')), decipher.final()]);
  let text: string;
  try {
    text = gunzipSync(packed, { maxOutputLength: MAX_UNPACKED }).toString('utf8');
  } catch {
    throw new LiveFileError('This live file checks out but its contents are damaged.');
  }
  try {
    const inner = JSON.parse(text) as Record<string, unknown>;
    return parseShareFile(JSON.stringify({ ...inner, code }));
  } catch (err) {
    if (err instanceof ShareFileError) throw new LiveFileError(err.message);
    throw new LiveFileError('This live file checks out but its contents are damaged.');
  }
}

// ---- Invites ----

export interface Invite {
  from: string;
  code: string;
  link: string;
}

/** The invite you send a friend once: your live file's link and the friendship's code, in one line to paste. */
export function makeInvite(i: Invite): string {
  return INVITE_PREFIX + Buffer.from(JSON.stringify({ v: 1, from: i.from, code: i.code, link: i.link }), 'utf8').toString('base64url');
}

/** Reads an invite from what was pasted (an email's line breaks and spaces don't matter). */
export function readInvite(text: string): Invite {
  const t = typeof text === 'string' ? text : '';
  const at = t.indexOf(INVITE_PREFIX);
  if (at < 0) throw new LiveFileError('That isn\'t a Squirrelcade invite (it starts with "squirrelcade-invite:").');
  // An email may have wrapped it: its pieces are joined one more at a time until it reads (what follows it, a
  // signature, never makes it read, since the invite ends where its JSON ends).
  const pieces = t.slice(at + INVITE_PREFIX.length).split(/\s+/).slice(0, 40);
  let raw: Record<string, unknown> | null = null;
  let data = '';
  for (const piece of pieces) {
    const part = piece.match(/^[A-Za-z0-9_-]+/)?.[0] ?? '';
    data += part;
    try {
      const parsed = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        raw = parsed as Record<string, unknown>;
        break;
      }
    } catch {
      // Not whole yet.
    }
    if (part.length < piece.length) break;
  }
  if (!raw) throw new LiveFileError('That invite is incomplete: copy all of it (one long line).');
  if (raw.v !== 1) throw new LiveFileError('That invite is from a newer Squirrelcade: update yours to use it.');
  const code = typeof raw.code === 'string' ? raw.code : '';
  const link = typeof raw.link === 'string' ? raw.link : '';
  if (!/^[\w-]{8,100}$/.test(code) || !link) throw new LiveFileError('That invite is incomplete: copy all of it (one long line).');
  return { from: typeof raw.from === 'string' && raw.from.trim() ? raw.from.trim().slice(0, 60) : 'A friend', code, link: checkLink(link) };
}

/** A link a live file can be read from: http or https, as pasted. */
export function checkLink(link: unknown): string {
  const t = typeof link === 'string' ? link.trim() : '';
  let u: URL;
  try {
    u = new URL(t);
  } catch {
    throw new LiveFileError("That isn't a link (it should start with https://).");
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new LiveFileError('The link should start with https://.');
  if (t.length > 2000) throw new LiveFileError('That link is too long.');
  return u.toString();
}

// ---- Reading a link ----

/**
 * The address a shared link's file downloads from: a Google Drive share link ("…/file/d/ID/view") becomes its direct
 * download, a Dropbox link gets dl=1; any other link is read as it is.
 */
export function directLink(link: string): string {
  const u = new URL(link);
  const host = u.hostname.toLowerCase();
  if (host === 'drive.google.com' || host === 'docs.google.com' || host === 'drive.usercontent.google.com') {
    const id = u.pathname.match(/\/(?:file\/)?d\/([\w-]{10,})/)?.[1] ?? u.searchParams.get('id');
    if (id && /^[\w-]+$/.test(id)) return `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`;
  }
  if (host === 'www.dropbox.com' || host === 'dropbox.com') {
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  return u.toString();
}

/** Google Drive's "can't scan this file for viruses" page: its Download anyway form, as an address to read instead. */
export function driveConfirmLink(html: string): string | null {
  const form = html.match(/<form[^>]+id="download-form"[^>]*>([\s\S]*?)<\/form>/i);
  if (!form) return null;
  const action = form[0].match(/action="([^"]+)"/i)?.[1];
  if (!action) return null;
  let u: URL;
  try {
    u = new URL(action.replace(/&amp;/g, '&'), 'https://drive.usercontent.google.com/');
  } catch {
    return null;
  }
  if (!u.hostname.endsWith('google.com')) return null;
  for (const m of (form[1] ?? '').matchAll(/<input[^>]+type="hidden"[^>]*>/gi)) {
    const name = m[0].match(/name="([^"]+)"/i)?.[1];
    const value = m[0].match(/value="([^"]*)"/i)?.[1] ?? '';
    if (name) u.searchParams.set(name, value.replace(/&amp;/g, '&'));
  }
  return u.toString();
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

/** Reads what a live link gives (following Google Drive's virus page once), as text, with plain reasons when it can't. */
export async function fetchLink(link: string, fetchFn: FetchFn, timeoutMs = 30_000): Promise<string> {
  let url = directLink(link);
  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetchFn(url, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json, text/plain, */*', 'user-agent': 'Squirrelcade (friend link)' }, redirect: 'follow' });
    } catch (err) {
      const why = err instanceof Error && err.name === 'TimeoutError' ? `no answer in ${Math.round(timeoutMs / 1000)} s` : err instanceof Error ? err.message : String(err);
      throw new LiveFileError(`The link couldn't be read (${why}).`);
    }
    if (res.status === 404 || res.status === 410) throw new LiveFileError(`The link gives "not found" (${res.status}): the file was moved or removed, or the link changed. Ask for the link again.`);
    if (res.status === 401 || res.status === 403) throw new LiveFileError(`The link needs a sign-in (${res.status}): share the file as Anyone with the link.`);
    if (res.status === 429) throw new LiveFileError('The link answered "too many requests" (429): it will be read again later.');
    if (!res.ok) throw new LiveFileError(`The link answered ${res.status}${res.statusText ? ` (${res.statusText})` : ''}.`);
    const size = Number(res.headers.get('content-length') ?? 0);
    if (size > MAX_LIVE_BYTES) throw new LiveFileError(`The link gives a file of ${Math.round(size / 1048576)} MB: too big to be a Squirrelcade friend file.`);
    const data = Buffer.from(await res.arrayBuffer());
    if (data.length > MAX_LIVE_BYTES) throw new LiveFileError(`The link gives a file of ${Math.round(data.length / 1048576)} MB: too big to be a Squirrelcade friend file.`);
    const text = data.toString('utf8');
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type.includes('text/html') || text.trimStart().startsWith('<')) {
      const next = attempt === 0 ? driveConfirmLink(text) : null;
      if (next) {
        url = next;
        continue;
      }
    }
    return text;
  }
  throw new LiveFileError("This link gives a web page, not a Squirrelcade file (Google Drive's \"can't scan for viruses\" page?): share the file as Anyone with the link.");
}
