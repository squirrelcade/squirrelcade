import {
  evenOffers,
  normalizeTitle,
  parseShareFile,
  SAME_GAME_AT,
  ShareFileError,
  SHARE_FORMAT,
  SHARE_VERSION,
  sparesOf,
  TitleMatcher,
  type Completeness,
  type ShareFile,
  type ShareGame,
  type ShareTradeable,
  type TradeOffer,
} from '@squirrelcade/core';
import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { asc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Logger } from 'pino';
import type { CopyDetailsService } from './copyDetails.js';
import type { Db } from './db/index.js';
import { copies, friendFiles, friends, platforms } from './db/schema.js';
import type { SettingsService } from './settings.js';
import type { WishlistService } from './wishlist.js';
import { isZip, readZip, ZipError } from './zip.js';
import { checkLink, fetchLink, friendshipId, LiveFileError, makeInvite, openLive, readEnvelope, readInvite, sealLive, type FetchFn } from './friendLive.js';

/**
 * Friends' collections (0.56.0, D131): your share file for each friend, theirs brought in (by hand here; by email and
 * directly later), the two collections compared console by console, and trades that come out even by market value.
 * One collection per install; a friend is someone whose Squirrelcade shares with this one.
 */

/** Why something about a friend couldn't be done, in plain words. */
export class FriendsError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

/** One of your copies, as friends' comparisons and trades see it. */
interface MyCopy {
  copyKey: string;
  productId: string;
  title: string;
  platformKey: string;
  platform: string;
  completeness: Completeness;
  valueCents: number | null;
}

/** A product of yours on a console (its copies together). */
interface MyGame {
  key: string;
  productId: string;
  title: string;
  platformKey: string;
  platform: string;
  copies: MyCopy[];
}

/** Something one side would trade, with whether the other side wants it. */
export interface TradeItem {
  key: string;
  side: 'mine' | 'theirs';
  platformKey: string;
  platform: string;
  title: string;
  condition: Completeness;
  valueCents: number | null;
  kind: 'sale' | 'trade' | 'spare' | 'owned';
  askingCents: number | null;
  /** The other side wants it: on their wishlist (with its place and acorns), or a game they don't have on a console they collect. */
  wanted: boolean;
  want: { rank: number | null; acorns: number } | null;
  missing: boolean;
}

const KEEP_FILE_FOR_UNKNOWN = 60;
const code = () => randomBytes(12).toString('base64url');
/** A file name's part from a name: letters and digits, dashes between. */
const slug = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30) || 'friend';

/** What reading a friend's live link came to. */
export interface LinkResult {
  friendId: number;
  name: string;
  ok: boolean;
  /** A newer file was read (false: nothing new since the last one, or it failed). */
  read: boolean;
  message: string;
  games?: number;
}

export interface FriendsOptions {
  /** Squirrelcade's own folder: the live files go in its friends-live folder unless Settings › Friends says another. */
  configDir?: string;
  fetch?: FetchFn;
}

export class FriendsService {
  /** What each friend's live file last held (without its date), so an unchanged collection isn't written again. */
  private readonly liveWritten = new Map<number, string>();
  private liveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly details: CopyDetailsService,
    private readonly wishlist: WishlistService,
    private readonly log: Logger,
    private readonly options: FriendsOptions = {},
  ) {}

  // ---- Friends ----

  list() {
    const files = new Map(
      this.db
        .select()
        .from(friendFiles)
        .all()
        .map((f) => [f.friendId, f]),
    );
    return this.db
      .select()
      .from(friends)
      .orderBy(asc(friends.name))
      .all()
      .map((f) => {
        const file = this.fileOf(f.id, files.get(f.id));
        return {
          id: f.id,
          name: f.name,
          email: f.email,
          way: f.way,
          createdAt: f.createdAt,
          lastSentAt: f.lastSentAt,
          live: {
            share: f.liveShare,
            file: f.liveFile,
            writtenAt: f.liveWrittenAt,
            link: f.liveLink,
            theirLink: f.theirLink,
            readAt: f.theirLinkReadAt,
            checkedAt: f.theirLinkCheckedAt,
            error: f.theirLinkError,
          },
          file: file
            ? {
                from: file.data.from,
                madeAt: file.data.madeAt,
                receivedAt: file.receivedAt,
                games: file.data.collection?.length ?? 0,
                copies: (file.data.collection ?? []).reduce((n, g) => n + g.copies.length, 0),
                wishes: file.data.wishlist?.length ?? 0,
                forTrade: file.data.forTrade?.length ?? 0,
                currency: file.data.currency,
              }
            : null,
        };
      });
  }

  add(name: unknown, email: unknown, way: 'file' | 'email' | 'direct' | 'link' = 'file', withCode?: string) {
    const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
    if (!n || n.length > 60) throw new FriendsError("Give your friend's name (up to 60 characters).");
    const e = typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : null;
    if (e && !/^[^\s@<>"]{1,64}@[^\s@<>"]{1,190}\.[^\s@<>"]{2,}$/.test(e)) throw new FriendsError("That email address doesn't look right.");
    const row = this.db.insert(friends).values({ name: n, email: e, code: withCode ?? code(), way, createdAt: new Date().toISOString() }).returning().get();
    this.log.info({ context: 'friends' }, `Friend added: ${n}`);
    return row;
  }

  update(id: number, change: { name?: unknown; email?: unknown }) {
    const f = this.friend(id);
    const name = change.name === undefined ? f.name : typeof change.name === 'string' ? change.name.trim().replace(/\s+/g, ' ') : '';
    if (!name || name.length > 60) throw new FriendsError("Give your friend's name (up to 60 characters).");
    const email = change.email === undefined ? f.email : typeof change.email === 'string' && change.email.trim() ? change.email.trim().toLowerCase() : null;
    this.db.update(friends).set({ name, email }).where(eq(friends.id, id)).run();
    return { ...f, name, email };
  }

  remove(id: number): boolean {
    const removed = this.db.delete(friends).where(eq(friends.id, id)).run().changes > 0;
    if (removed) this.log.info({ context: 'friends' }, `Friend ${id} removed`);
    return removed;
  }

  private friend(id: number) {
    const f = this.db.select().from(friends).where(eq(friends.id, id)).get();
    if (!f) throw new FriendsError('No such friend.', 404);
    return f;
  }

  /** A friend's file while it's fresh enough (Settings › Friends), checked again as it's read. */
  private fileOf(friendId: number, row?: typeof friendFiles.$inferSelect): { receivedAt: string; data: ShareFile } | null {
    const r = row ?? this.db.select().from(friendFiles).where(eq(friendFiles.friendId, friendId)).get();
    if (!r) return null;
    const days = this.settings.get('friends.keepDays') ?? KEEP_FILE_FOR_UNKNOWN;
    if (Date.now() - Date.parse(r.receivedAt) > days * 86_400_000) return null;
    try {
      return { receivedAt: r.receivedAt, data: parseShareFile(r.data) };
    } catch {
      return null;
    }
  }

  private theirFile(friendId: number): ShareFile {
    this.friend(friendId);
    const file = this.fileOf(friendId);
    if (!file) throw new FriendsError("There's no file from this friend yet (or it's too old): bring theirs in first.", 409);
    return file.data;
  }

  // ---- Your collection, as friends see it ----

  private myCopies(): MyCopy[] {
    return this.db
      .select({
        copyKey: copies.key,
        productId: copies.productId,
        title: copies.title,
        platformKey: platforms.key,
        platform: platforms.name,
        completeness: copies.completeness,
        valueCents: copies.valueCents,
      })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all()
      .map((c) => ({ ...c, completeness: c.completeness as Completeness }));
  }

  private myGames(list = this.myCopies()): MyGame[] {
    const games = new Map<string, MyGame>();
    for (const c of list) {
      const key = `${c.platformKey}|${c.productId}`;
      const g = games.get(key) ?? { key, productId: c.productId, title: c.title, platformKey: c.platformKey, platform: c.platform, copies: [] };
      g.copies.push(c);
      games.set(key, g);
    }
    return [...games.values()];
  }

  /** What you'd trade: copies marked for sale or trade, and (Settings › Friends) the spares, with their asking price. */
  private myTradeable(list = this.myCopies()): (MyCopy & { kind: 'sale' | 'trade' | 'spare'; askingCents: number | null })[] {
    const marks = this.details.index();
    const out = new Map<string, MyCopy & { kind: 'sale' | 'trade' | 'spare'; askingCents: number | null }>();
    for (const c of list) {
      const d = marks.get(c.copyKey);
      if (d?.sale) out.set(c.copyKey, { ...c, kind: d.sale, askingCents: d.askingCents });
    }
    if (this.settings.get('friends.shareSpares')) for (const c of sparesOf(list)) if (!out.has(c.copyKey)) out.set(c.copyKey, { ...c, kind: 'spare', askingCents: null });
    return [...out.values()];
  }

  /** Your share file for a friend: what Settings › Friends shares, with your friendship's code. */
  myFile(friendId: number, opts: { sent?: boolean } = {}): ShareFile {
    const f = this.friend(friendId);
    const s = this.settings;
    const values = s.get('friends.shareValues');
    const list = this.myCopies();
    const file: ShareFile = {
      format: SHARE_FORMAT,
      version: SHARE_VERSION,
      from: s.get('friends.myName').trim() || s.get('general.instanceName').trim() || 'A Squirrelcade',
      code: f.code,
      madeAt: new Date().toISOString(),
      currency: s.get('general.currency') || 'USD',
    };
    if (s.get('friends.shareCollection')) {
      file.collection = this.myGames(list).map((g) => ({
        platformKey: g.platformKey,
        platform: g.platform,
        productId: g.productId.startsWith('s-') ? null : g.productId,
        title: g.title,
        copies: g.copies.map((c) => ({ condition: c.completeness, valueCents: values ? c.valueCents : null })),
      }));
    }
    const wishes = s.get('friends.shareWishlist');
    if (wishes > 0) {
      file.wishlist = this.wishlist
        .compute()
        .master.slice(0, wishes)
        .map((m) => ({ platformKey: m.platformKey, platform: m.platformName, title: m.title, rank: m.rank, acorns: Math.round(m.score), priority: m.priority }));
    }
    if (s.get('friends.shareForTrade') || s.get('friends.shareSpares')) {
      file.forTrade = this.myTradeable(list)
        .filter((t) => t.kind === 'spare' || s.get('friends.shareForTrade'))
        .map((t) => ({
          platformKey: t.platformKey,
          platform: t.platform,
          productId: t.productId.startsWith('s-') ? null : t.productId,
          title: t.title,
          condition: t.completeness,
          valueCents: values ? t.valueCents : null,
          kind: t.kind,
          askingCents: values ? t.askingCents : null,
        }));
    }
    if (opts.sent !== false) this.db.update(friends).set({ lastSentAt: file.madeAt }).where(eq(friends.id, friendId)).run();
    return file;
  }

  // ---- Bringing a friend's file in ----

  /** A file's text from what was sent: JSON, or a zip with one .json in it. */
  static textOf(data: Buffer): string {
    if (isZip(data)) {
      try {
        const entry = readZip(data).find((e) => e.name.toLowerCase().endsWith('.json'));
        if (!entry) throw new FriendsError('That zip has no share file (a .json) in it.');
        return entry.read().toString('utf8');
      } catch (err) {
        // A damaged zip, or one whose file unpacks too large.
        if (err instanceof ZipError) throw new FriendsError(err.message);
        throw err;
      }
    }
    return data.toString('utf8');
  }

  /** What a file is, before it's brought in: who it's from, when it was made, how much is in it. */
  preview(text: string) {
    const f = this.parse(text);
    const known = this.db.select({ id: friends.id, name: friends.name }).from(friends).where(eq(friends.code, f.code)).get();
    return { from: f.from, madeAt: f.madeAt, currency: f.currency, games: f.collection?.length ?? 0, wishes: f.wishlist?.length ?? 0, forTrade: f.forTrade?.length ?? 0, friend: known ?? null };
  }

  private parse(text: string): ShareFile {
    try {
      return parseShareFile(text);
    } catch (err) {
      if (err instanceof ShareFileError) throw new FriendsError(err.message);
      throw err;
    }
  }

  /**
   * Brings a friend's file in. A file carrying another code than the friendship's is refused unless `force` (the owner
   * said it's theirs). Forced, the friendship keeps the smaller of the two codes: when both of you added the other by
   * hand, each side makes the same choice, so the codes agree after one exchange instead of swapping back and forth.
   * With no friend given, a friend is made from the file, keeping its code.
   */
  bringIn(friendId: number | null, text: string, opts: { force?: boolean; name?: unknown; email?: unknown } = {}) {
    const file = this.parse(text);
    let friend = friendId === null ? null : this.friend(friendId);
    if (!friend) {
      const known = file.code ? this.db.select().from(friends).where(eq(friends.code, file.code)).get() : undefined;
      friend = known ?? this.add(typeof opts.name === 'string' && opts.name.trim() ? opts.name : file.from, opts.email, 'file', file.code || undefined);
    } else if (file.code !== friend.code) {
      if (!opts.force) throw new FriendsError(`This file carries another code than your files with ${friend.name}. If it really is theirs, bring it in anyway.`, 409);
      const agreed = file.code && file.code < friend.code ? file.code : friend.code;
      this.db.update(friends).set({ code: agreed }).where(eq(friends.id, friend.id)).run();
      friend = { ...friend, code: agreed };
    }
    const row = { receivedAt: new Date().toISOString(), madeAt: file.madeAt, data: JSON.stringify(file) };
    this.db.insert(friendFiles).values({ friendId: friend.id, ...row }).onConflictDoUpdate({ target: friendFiles.friendId, set: row }).run();
    this.log.info({ context: 'friends' }, `${friend.name}'s file brought in (${file.collection?.length ?? 0} games)`);
    return { friend: { id: friend.id, name: friend.name }, games: file.collection?.length ?? 0, wishes: file.wishlist?.length ?? 0, forTrade: file.forTrade?.length ?? 0 };
  }

  // ---- Live links (1.4.0, D214) ----

  /** Where the live files go: Settings › Friends' folder, else the friends-live folder in Squirrelcade's own folder. */
  liveFolder(): string {
    const set = this.settings.get('friends.liveFolder').trim();
    return set || join(this.options.configDir ?? '.', 'friends-live');
  }

  /** Turns live sharing with a friend on or off, and keeps the links (yours to give, theirs to read). */
  setLive(id: number, change: { share?: unknown; link?: unknown; theirLink?: unknown }) {
    const f = this.friend(id);
    const set: Partial<typeof friends.$inferInsert> = {};
    try {
      if (change.share !== undefined) set.liveShare = change.share === true;
      if (change.link !== undefined) set.liveLink = change.link === null || change.link === '' ? null : checkLink(change.link);
      if (change.theirLink !== undefined) {
        set.theirLink = change.theirLink === null || change.theirLink === '' ? null : checkLink(change.theirLink);
        if (set.theirLink !== f.theirLink) Object.assign(set, { theirLinkError: null, theirLinkCheckedAt: null });
      }
    } catch (err) {
      if (err instanceof LiveFileError) throw new FriendsError(err.message);
      throw err;
    }
    if (Object.keys(set).length > 0) this.db.update(friends).set(set).where(eq(friends.id, id)).run();
    if (set.liveShare === false) this.liveWritten.delete(id);
    return { ...f, ...set };
  }

  /**
   * Writes the live file of every friend you share with live (or just one), when what it holds changed. Written to a
   * temporary name and renamed, so whatever carries the folder to the cloud never takes half a file.
   */
  writeLive(onlyId?: number): { written: number; unchanged: number; folder: string; files: string[] } {
    const folder = this.liveFolder();
    const list = this.db
      .select()
      .from(friends)
      .all()
      .filter((f) => f.liveShare && (onlyId === undefined || f.id === onlyId));
    let written = 0;
    let unchanged = 0;
    const files: string[] = [];
    if (list.length === 0) return { written, unchanged, folder, files };
    mkdirSync(folder, { recursive: true });
    for (const f of list) {
      const file = this.myFile(f.id, { sent: false });
      const fingerprint = JSON.stringify({ ...file, madeAt: '' });
      const name = f.liveFile ?? `squirrelcade-${slug(file.from)}-for-${slug(f.name)}.json`;
      files.push(name);
      if (onlyId === undefined && this.liveWritten.get(f.id) === fingerprint && f.liveFile) {
        unchanged++;
        continue;
      }
      const path = join(folder, name);
      writeFileSync(`${path}.tmp`, JSON.stringify(sealLive(file, f.code)));
      renameSync(`${path}.tmp`, path);
      this.liveWritten.set(f.id, fingerprint);
      this.db.update(friends).set({ liveFile: name, liveWrittenAt: file.madeAt }).where(eq(friends.id, f.id)).run();
      written++;
    }
    if (written > 0) this.log.info({ context: 'friends' }, `Live friend files written: ${written} (${folder})`);
    return { written, unchanged, folder, files };
  }

  /** After a collection update: the live files are written a little later, once (several changes in a row write once). */
  collectionChanged(delayMs = 60_000): void {
    if (this.liveTimer) clearTimeout(this.liveTimer);
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null;
      try {
        this.writeLive();
      } catch (err) {
        this.log.warn({ context: 'friends', err }, `Live friend files couldn't be written: ${err instanceof Error ? err.message : String(err)}`);
      }
    }, delayMs);
    this.liveTimer.unref();
  }

  /** The invite for a friend: your live file's link and your friendship's code, in one line they paste. */
  invite(id: number): { invite: string; link: string; file: string | null } {
    const f = this.friend(id);
    if (!f.liveShare) throw new FriendsError(`Share live with ${f.name} first: Squirrelcade then writes their file in your live folder.`, 409);
    if (!f.liveLink) throw new FriendsError(`Paste the link of ${f.name}'s file first (share it from your cloud folder as Anyone with the link).`, 409);
    const s = this.settings;
    const from = s.get('friends.myName').trim() || s.get('general.instanceName').trim() || 'A Squirrelcade';
    return { invite: makeInvite({ from, code: f.code, link: f.liveLink }), link: f.liveLink, file: f.liveFile };
  }

  /**
   * Takes a friend's invite: their link is kept and read at once. The friend is the one whose friendship has the
   * invite's code, else the friend given (who takes the invite's code), else a new friend named as the invite says.
   */
  async acceptInvite(text: unknown, opts: { friendId?: number | null; name?: unknown; email?: unknown } = {}) {
    let inv: ReturnType<typeof readInvite>;
    try {
      inv = readInvite(typeof text === 'string' ? text : '');
    } catch (err) {
      if (err instanceof LiveFileError) throw new FriendsError(err.message);
      throw err;
    }
    let friend = this.db.select().from(friends).where(eq(friends.code, inv.code)).get() ?? null;
    if (!friend && opts.friendId) {
      friend = this.friend(opts.friendId);
      this.db.update(friends).set({ code: inv.code }).where(eq(friends.id, friend.id)).run();
      this.liveWritten.delete(friend.id);
    }
    friend ??= this.add(typeof opts.name === 'string' && opts.name.trim() ? opts.name : inv.from, opts.email, 'link', inv.code);
    this.db.update(friends).set({ theirLink: inv.link, theirLinkError: null, theirLinkCheckedAt: null }).where(eq(friends.id, friend.id)).run();
    const result = await this.readLink(friend.id);
    return { friend: { id: friend.id, name: friend.name }, result };
  }

  /**
   * Reads a friend's live link: refused, with a plain reason (and the last good file kept), unless it's a Squirrelcade
   * live file of this friendship that checks out and is newer than the file last read.
   */
  async readLink(id: number): Promise<LinkResult> {
    const f = this.friend(id);
    const now = new Date().toISOString();
    const done = (r: Omit<LinkResult, 'friendId' | 'name'>): LinkResult => {
      this.db
        .update(friends)
        .set({ theirLinkCheckedAt: now, theirLinkError: r.ok ? null : r.message, ...(r.ok ? { theirLinkReadAt: now } : {}) })
        .where(eq(friends.id, id))
        .run();
      if (!r.ok) this.log.warn({ context: 'friends' }, `${f.name}'s live link: ${r.message}`);
      return { friendId: id, name: f.name, ...r };
    };
    if (!f.theirLink) throw new FriendsError(`There's no live link from ${f.name}: paste their invite first.`, 409);
    try {
      const text = await fetchLink(f.theirLink, this.options.fetch ?? ((url, init) => fetch(url, init)));
      const env = readEnvelope(text);
      if (env.friendship !== friendshipId(f.code)) {
        const other = this.db
          .select({ name: friends.name, code: friends.code })
          .from(friends)
          .all()
          .find((x) => friendshipId(x.code) === env.friendship);
        throw new LiveFileError(
          other
            ? `This is the live file of your friendship with ${other.name}, not with ${f.name}: check the link.`
            : `This is a Squirrelcade file from another friendship (not yours with ${f.name}): ask ${f.name} for their invite again.`,
        );
      }
      const last = this.db.select({ madeAt: friendFiles.madeAt }).from(friendFiles).where(eq(friendFiles.friendId, id)).get();
      if (last && Date.parse(env.madeAt) <= Date.parse(last.madeAt)) {
        return done({ ok: true, read: false, message: `Nothing new: the file was made ${env.madeAt}, and the one you have is as new or newer.` });
      }
      const file = openLive(env, f.code, f.name);
      const row = { receivedAt: now, madeAt: file.madeAt, data: JSON.stringify(file) };
      this.db.insert(friendFiles).values({ friendId: id, ...row }).onConflictDoUpdate({ target: friendFiles.friendId, set: row }).run();
      const games = file.collection?.length ?? 0;
      this.log.info({ context: 'friends' }, `${f.name}'s live file read (${games} games)`);
      return done({ ok: true, read: true, message: `Read ${f.name}'s file of ${file.madeAt}: ${games} games.`, games });
    } catch (err) {
      if (err instanceof LiveFileError) return done({ ok: false, read: false, message: err.message });
      throw err;
    }
  }

  /** The scheduled task: your live files written (when they changed), then every friend's live link read. */
  async liveTask(): Promise<string> {
    const w = this.writeLive();
    const results: LinkResult[] = [];
    for (const f of this.db.select({ id: friends.id, link: friends.theirLink }).from(friends).all()) if (f.link) results.push(await this.readLink(f.id));
    const parts: string[] = [];
    if (w.written + w.unchanged > 0) parts.push(`${w.written} live file${w.written === 1 ? '' : 's'} written${w.unchanged ? `, ${w.unchanged} unchanged` : ''}`);
    const read = results.filter((r) => r.read).length;
    const failed = results.filter((r) => !r.ok);
    if (results.length > 0) parts.push(`${read} of ${results.length} friend${results.length === 1 ? "'s link" : "s' links"} had something new`);
    for (const r of failed) parts.push(`${r.name}: ${r.message}`);
    if (failed.length > 0 && failed.length === results.length && w.written + w.unchanged === 0) throw new Error(parts.join('; '));
    return parts.join('; ') || 'No live links';
  }

  /** The live links for the status board: one line per friend whose link is read. */
  linkLines(): { id: number; name: string; link: string; readAt: string | null; checkedAt: string | null; error: string | null }[] {
    return this.db
      .select()
      .from(friends)
      .all()
      .filter((f) => f.theirLink)
      .map((f) => ({ id: f.id, name: f.name, link: f.theirLink as string, readAt: f.theirLinkReadAt, checkedAt: f.theirLinkCheckedAt, error: f.theirLinkError }));
  }

  /** Your live files for the status board: how many, where, and when one was last written. */
  liveSummary(): { sharing: number; folder: string; writtenAt: string | null } {
    const rows = this.db.select({ share: friends.liveShare, at: friends.liveWrittenAt }).from(friends).all().filter((r) => r.share);
    return { sharing: rows.length, folder: this.liveFolder(), writtenAt: rows.map((r) => r.at).filter((x): x is string => Boolean(x)).sort().at(-1) ?? null };
  }

  // ---- Comparing ----

  /** Your games and a friend's on each console: both of you, only you, only them; theirs for trade, yours wanted. */
  compare(friendId: number, platformKey?: string) {
    const file = this.theirFile(friendId);
    const mine = this.myGames();
    const match = this.matcher(mine);
    const theirs = file.collection ?? [];
    const tradeKeys = new Set((file.forTrade ?? []).map((t) => tradeKey(t)));
    const myWishes = this.myWishes();
    const theirWishes = new TitleMatcher(file.wishlist ?? [], (w) => [w.title]);
    const matchedMine = new Set<string>();
    const rows: CompareRow[] = [];
    for (const g of theirs) {
      const m = match(g);
      if (m) matchedMine.add(m.key);
      rows.push({
        key: `t:${g.platformKey}|${g.productId ?? normalizeTitle(g.title)}`,
        platformKey: g.platformKey,
        platform: g.platform,
        title: m?.title ?? g.title,
        theirTitle: g.title,
        mine: m ? { copies: m.copies.length, conditions: m.copies.map((c) => c.completeness), valueCents: maxValue(m.copies.map((c) => c.valueCents)) } : null,
        theirs: { copies: g.copies.length, conditions: g.copies.map((c) => c.condition), valueCents: maxValue(g.copies.map((c) => c.valueCents)) },
        theirsForTrade: tradeKeys.has(tradeKey(g)),
        youWant: m ? null : myWishes(g.platformKey, g.title),
        theyWant: null,
      });
    }
    for (const g of mine) {
      if (matchedMine.has(g.key)) continue;
      const w = theirWishes.find(g.title, { min: SAME_GAME_AT, limit: 1, filter: (x) => x.platformKey === g.platformKey })[0]?.item;
      rows.push({
        key: `m:${g.key}`,
        platformKey: g.platformKey,
        platform: g.platform,
        title: g.title,
        theirTitle: null,
        mine: { copies: g.copies.length, conditions: g.copies.map((c) => c.completeness), valueCents: maxValue(g.copies.map((c) => c.valueCents)) },
        theirs: null,
        theirsForTrade: false,
        youWant: null,
        theyWant: w ? { rank: w.rank, acorns: w.acorns } : null,
      });
    }
    const consoles = new Map<string, { key: string; name: string; both: number; onlyYou: number; onlyThem: number }>();
    for (const r of rows) {
      const c = consoles.get(r.platformKey) ?? { key: r.platformKey, name: r.platform, both: 0, onlyYou: 0, onlyThem: 0 };
      if (r.mine && r.theirs) c.both++;
      else if (r.mine) c.onlyYou++;
      else c.onlyThem++;
      consoles.set(r.platformKey, c);
    }
    const list = [...consoles.values()].sort((a, b) => b.both + b.onlyThem + b.onlyYou - (a.both + a.onlyThem + a.onlyYou) || a.name.localeCompare(b.name));
    const chosen = platformKey && consoles.has(platformKey) ? platformKey : list[0]?.key;
    return {
      friend: this.friend(friendId).name,
      madeAt: file.madeAt,
      currency: file.currency,
      consoles: list,
      platformKey: chosen ?? null,
      rows: rows.filter((r) => r.platformKey === chosen).sort((a, b) => a.title.localeCompare(b.title)),
    };
  }

  /** Matches a friend's game to one of yours: the same PriceCharting product, else the same game by title on the console. */
  private matcher(mine: MyGame[]): (g: { platformKey: string; productId: string | null; title: string }) => MyGame | null {
    const byProduct = new Map(mine.map((g) => [`${g.platformKey}|${g.productId}`, g]));
    const titles = new TitleMatcher(mine, (g) => [g.title]);
    return (g) => {
      const exact = g.productId ? byProduct.get(`${g.platformKey}|${g.productId}`) : undefined;
      if (exact) return exact;
      return titles.find(g.title, { min: SAME_GAME_AT, limit: 1, filter: (m) => m.platformKey === g.platformKey })[0]?.item ?? null;
    };
  }

  /** Your wishlist, as a question: is this game on it (its place and acorns)? */
  private myWishes(): (platformKey: string, title: string) => { rank: number | null; acorns: number } | null {
    const result = this.wishlist.compute();
    const items = [...result.all.entries()].map(([key, c]) => ({ key, platformKey: c.platformKey, title: c.title, score: c.score }));
    const m = new TitleMatcher(items, (i) => [i.title]);
    return (platformKey, title) => {
      const hit = m.find(title, { min: SAME_GAME_AT, limit: 1, filter: (i) => i.platformKey === platformKey })[0]?.item;
      return hit ? { rank: result.index.get(hit.key)?.rank ?? null, acorns: Math.round(hit.score) } : null;
    };
  }

  // ---- Trades ----

  /** What each side would trade that the other wants, and trades that come out even (Settings › Friends › margin). */
  trades(friendId: number) {
    const file = this.theirFile(friendId);
    const { mine, theirs } = this.tradeItems(file);
    const margin = this.settings.get('friends.tradeMargin');
    const wantedTheirs = theirs.filter((t) => t.wanted).sort(byWant);
    const wantedMine = mine.filter((t) => t.wanted).sort(byWant);
    const ideas: { get: TradeItem; give: TradeOffer<TradeItem> }[] = [];
    for (const t of wantedTheirs) {
      if (ideas.length >= 15) break;
      const best = evenOffers(t.valueCents ?? 0, mine, margin, 1)[0];
      if (best) ideas.push({ get: t, give: best });
    }
    return {
      friend: this.friend(friendId).name,
      madeAt: file.madeAt,
      currency: file.currency,
      sameCurrency: file.currency === (this.settings.get('general.currency') || 'USD'),
      margin,
      theyHaveYouWant: wantedTheirs.slice(0, 100),
      youHaveTheyWant: wantedMine.slice(0, 100),
      theirForTrade: theirs.length,
      yourForTrade: mine.length,
      ideas,
    };
  }

  /** Even trades for one game of theirs (one they'd trade, or any copy in their collection): one of yours or a few. */
  tradeFor(friendId: number, itemKey: string) {
    const file = this.theirFile(friendId);
    const { mine, theirs } = this.tradeItems(file);
    let target = theirs.find((t) => t.key === itemKey) ?? null;
    if (!target) {
      // Any copy in their collection: "c:<game index>:<copy index>".
      const m = /^c:(\d+):(\d+)$/.exec(itemKey);
      const g = m ? file.collection?.[Number(m[1])] : undefined;
      const copy = g?.copies[Number(m?.[2])];
      if (g && copy) target = { key: itemKey, side: 'theirs', platformKey: g.platformKey, platform: g.platform, title: g.title, condition: copy.condition, valueCents: copy.valueCents, kind: 'owned', askingCents: null, wanted: true, want: null, missing: false };
    }
    if (!target) throw new FriendsError("That game isn't in your friend's file.", 404);
    const margin = this.settings.get('friends.tradeMargin');
    return { target, margin, currency: file.currency, offers: evenOffers(target.valueCents ?? 0, mine, margin, 10) };
  }

  /** Their games to pick from for tradeFor: each copy in their collection, by console and title. */
  pickable(friendId: number, platformKey?: string) {
    const file = this.theirFile(friendId);
    const out: { key: string; platformKey: string; platform: string; title: string; condition: Completeness; valueCents: number | null }[] = [];
    (file.collection ?? []).forEach((g, gi) => {
      if (platformKey && g.platformKey !== platformKey) return;
      g.copies.forEach((c, ci) => out.push({ key: `c:${gi}:${ci}`, platformKey: g.platformKey, platform: g.platform, title: g.title, condition: c.condition, valueCents: c.valueCents }));
    });
    return out.sort((a, b) => a.platform.localeCompare(b.platform) || a.title.localeCompare(b.title)).slice(0, 5000);
  }

  /** Both sides' tradeable items, each marked with whether the other side wants it. */
  private tradeItems(file: ShareFile): { mine: TradeItem[]; theirs: TradeItem[] } {
    const list = this.myCopies();
    const myGames = this.myGames(list);
    const match = this.matcher(myGames);
    const myWishes = this.myWishes();
    const theirWishes = new TitleMatcher(file.wishlist ?? [], (w) => [w.title]);
    const theirGames = new TitleMatcher(file.collection ?? [], (g) => [g.title]);
    const theirProducts = new Set((file.collection ?? []).filter((g) => g.productId).map((g) => `${g.platformKey}|${g.productId}`));
    const theyHave = (platformKey: string, productId: string, title: string) =>
      theirProducts.has(`${platformKey}|${productId}`) || theirGames.find(title, { min: SAME_GAME_AT, limit: 1, filter: (g) => g.platformKey === platformKey }).length > 0;
    // A game missing from a collection counts as wanted only on a console that side collects (has a game on).
    const myConsoles = new Set(list.map((c) => c.platformKey));
    const theirConsoles = new Set((file.collection ?? []).map((g) => g.platformKey));
    const mine: TradeItem[] = this.myTradeable(list).map((c) => {
      const w = theirWishes.find(c.title, { min: SAME_GAME_AT, limit: 1, filter: (x) => x.platformKey === c.platformKey })[0]?.item;
      const missing = theirConsoles.has(c.platformKey) && !theyHave(c.platformKey, c.productId, c.title);
      return {
        key: `m:${c.copyKey}`,
        side: 'mine' as const,
        platformKey: c.platformKey,
        platform: c.platform,
        title: c.title,
        condition: c.completeness,
        valueCents: c.valueCents,
        kind: c.kind,
        askingCents: c.askingCents,
        wanted: Boolean(w) || missing,
        want: w ? { rank: w.rank, acorns: w.acorns } : null,
        missing,
      };
    });
    const theirs: TradeItem[] = (file.forTrade ?? []).map((t, i) => {
      const want = myWishes(t.platformKey, t.title);
      const missing = myConsoles.has(t.platformKey) && !match({ platformKey: t.platformKey, productId: t.productId, title: t.title });
      return {
        key: `t:${i}`,
        side: 'theirs' as const,
        platformKey: t.platformKey,
        platform: t.platform,
        title: t.title,
        condition: t.condition,
        valueCents: t.valueCents,
        kind: t.kind,
        askingCents: t.askingCents,
        wanted: Boolean(want) || missing,
        want,
        missing,
      };
    });
    return { mine, theirs };
  }
}

/** A row of the comparison: a game one of you (or both) has on the console. */
export interface CompareRow {
  key: string;
  platformKey: string;
  platform: string;
  title: string;
  theirTitle: string | null;
  mine: { copies: number; conditions: Completeness[]; valueCents: number | null } | null;
  theirs: { copies: number; conditions: Completeness[]; valueCents: number | null } | null;
  theirsForTrade: boolean;
  /** For a game only they have: it's on your wishlist. */
  youWant: { rank: number | null; acorns: number } | null;
  /** For a game only you have: it's on theirs. */
  theyWant: { rank: number | null; acorns: number } | null;
}

const tradeKey = (g: ShareGame | ShareTradeable) => `${g.platformKey}|${g.productId ?? normalizeTitle(g.title)}`;
const maxValue = (values: (number | null)[]) => values.reduce<number | null>((m, v) => (v !== null && (m === null || v > m) ? v : m), null);
/** Wanted most first: on a wishlist (more acorns first), then games the other side doesn't have, then by value. */
const byWant = (a: TradeItem, b: TradeItem) => (b.want?.acorns ?? -1) - (a.want?.acorns ?? -1) || Number(b.missing) - Number(a.missing) || (b.valueCents ?? 0) - (a.valueCents ?? 0);

/** Friends' routes (the owner's: viewers are refused the calls not meant for them). */
export function registerFriendRoutes(app: FastifyInstance, friendsService: FriendsService): void {
  const fail = (reply: FastifyReply, err: unknown) => {
    if (err instanceof FriendsError) return reply.code(err.status).send({ error: err.status === 409 ? 'conflict' : err.status === 404 ? 'not-found' : 'invalid', message: err.message });
    throw err;
  };
  /** A file from an upload (JSON or a zip) or pasted text ({"text": "..."}). */
  const textOf = async (request: FastifyRequest): Promise<{ text: string; fields: Record<string, string> }> => {
    if (request.isMultipart()) {
      const fields: Record<string, string> = {};
      let text: string | null = null;
      for await (const part of request.parts()) {
        if (part.type === 'file') text = FriendsService.textOf(await part.toBuffer());
        else fields[part.fieldname] = String(part.value ?? '');
      }
      if (text === null) throw new FriendsError("Choose your friend's share file.");
      return { text, fields };
    }
    const b = (request.body ?? {}) as { text?: unknown; name?: unknown; email?: unknown; force?: unknown };
    if (typeof b.text !== 'string' || !b.text.trim()) throw new FriendsError("Paste your friend's share file, or choose it.");
    return { text: b.text, fields: { name: typeof b.name === 'string' ? b.name : '', email: typeof b.email === 'string' ? b.email : '', force: b.force === true ? '1' : '' } };
  };
  const id = (request: FastifyRequest) => Number((request.params as { id: string }).id);

  app.get('/api/v1/friends', async () => ({ friends: friendsService.list() }));
  app.post('/api/v1/friends', async (request, reply) => {
    const b = (request.body ?? {}) as { name?: unknown; email?: unknown };
    try {
      const f = friendsService.add(b.name, b.email);
      return reply.code(201).send({ id: f.id, name: f.name, email: f.email });
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.put('/api/v1/friends/:id', async (request, reply) => {
    try {
      const f = friendsService.update(id(request), (request.body ?? {}) as { name?: unknown; email?: unknown });
      return { id: f.id, name: f.name, email: f.email };
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.delete('/api/v1/friends/:id', async (request) => ({ removed: friendsService.remove(id(request)) }));

  // Your file for a friend, as a download.
  app.get('/api/v1/friends/:id/file', async (request, reply) => {
    try {
      const file = friendsService.myFile(id(request));
      const name = `squirrelcade-${file.madeAt.slice(0, 10)}.json`;
      return reply.header('Content-Type', 'application/json; charset=utf-8').header('Content-Disposition', `attachment; filename="${name}"`).header('Cache-Control', 'no-store').send(JSON.stringify(file));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/friends/preview', async (request, reply) => {
    try {
      return friendsService.preview((await textOf(request)).text);
    } catch (err) {
      return fail(reply, err);
    }
  });
  // A friend's file: for a friend already listed, or (from-file) making the friend from it.
  app.post('/api/v1/friends/:id/file', async (request, reply) => {
    try {
      const { text, fields } = await textOf(request);
      return reply.code(201).send(friendsService.bringIn(id(request), text, { force: fields.force === '1' || (request.query as { force?: string }).force === '1' }));
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/friends/from-file', async (request, reply) => {
    try {
      const { text, fields } = await textOf(request);
      return reply.code(201).send(friendsService.bringIn(null, text, { name: fields.name, email: fields.email }));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/v1/friends/:id/compare', async (request, reply) => {
    try {
      return friendsService.compare(id(request), (request.query as { platform?: string }).platform);
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.get('/api/v1/friends/:id/trades', async (request, reply) => {
    try {
      return friendsService.trades(id(request));
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.get('/api/v1/friends/:id/games', async (request, reply) => {
    try {
      return { games: friendsService.pickable(id(request), (request.query as { platform?: string }).platform) };
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.get('/api/v1/friends/:id/trade-for', async (request, reply) => {
    try {
      return friendsService.tradeFor(id(request), String((request.query as { item?: string }).item ?? ''));
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Live links (D214): share live with a friend, your file's link, theirs; write now, read now; the invite.
  app.put('/api/v1/friends/:id/live', async (request, reply) => {
    try {
      const b = (request.body ?? {}) as { share?: unknown; link?: unknown; theirLink?: unknown };
      const f = friendsService.setLive(id(request), b);
      const written = b.share === true ? friendsService.writeLive(f.id) : null;
      return { id: f.id, share: f.liveShare, link: f.liveLink, theirLink: f.theirLink, written };
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/friends/:id/live/write', async (request, reply) => {
    try {
      return friendsService.writeLive(id(request));
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/friends/:id/live/read', async (request, reply) => {
    try {
      return await friendsService.readLink(id(request));
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.get('/api/v1/friends/:id/invite', async (request, reply) => {
    try {
      return friendsService.invite(id(request));
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.post('/api/v1/friends/invite', async (request, reply) => {
    try {
      const b = (request.body ?? {}) as { invite?: unknown; friendId?: unknown; name?: unknown; email?: unknown };
      return reply.code(201).send(await friendsService.acceptInvite(b.invite, { friendId: typeof b.friendId === 'number' ? b.friendId : null, name: b.name, email: b.email }));
    } catch (err) {
      return fail(reply, err);
    }
  });
  app.get('/api/v1/friends/live', async () => friendsService.liveSummary());
}
