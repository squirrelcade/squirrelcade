import { addDays, COMPLETENESS_LABELS, dayIn, RIP_RESULTS, TEST_RESULTS, toCsv, type Completeness, type TestKind, type TestResult } from '@squirrelcade/core';
import { and, asc, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { shown } from './access.js';
import type { Db } from './db/index.js';
import { copies, copyDetails, copyPhotos, copyTests, loans, platforms } from './db/schema.js';
import type { NotificationService } from './notifications.js';
import type { SettingsService } from './settings.js';


export type SaleKind = 'sale' | 'trade';

/** A digital license that came with a disc (Xbox disc-to-digital, a code in the box): claimed, not yet, or not offered. */
export type DigitalClaim = 'claimed' | 'unclaimed' | 'not-eligible';
export const DIGITAL_CLAIMS: readonly DigitalClaim[] = ['claimed', 'unclaimed', 'not-eligible'];

/** The owner's details on a copy. */
export interface CopyDetail {
  location: string | null;
  tags: string[];
  sale: SaleKind | null;
  askingCents: number | null;
  saleNote: string | null;
  /** Its digital license (0.55.0, D129): null when not said. */
  digitalClaim: DigitalClaim | null;
  digitalClaimedAt: string | null;
  digitalStore: string | null;
}

/** A digital license claimed with a disc: the game stays owned digitally, the disc kept or not. */
export interface ClaimedLicense {
  copyKey: string;
  productId: string;
  title: string;
  platformKey: string | null;
  platform: string | null;
  claimedAt: string | null;
  store: string | null;
  /** The disc is no longer in the collection (sold or removed). */
  discGone: boolean;
}

/** A copy lent to someone. */
export interface Loan {
  id: number;
  copyKey: string;
  title: string;
  platformKey: string | null;
  platform: string | null;
  lentTo: string;
  lentAt: string;
  dueAt: string | null;
  returnedAt: string | null;
  note: string | null;
  /** Not back by the day it was due. */
  overdue: boolean;
}

export interface PhotoInfo {
  id: number;
  caption: string | null;
  /** The standard photo it is ("Box front"), or null for another photo. */
  slot: string | null;
  mime: string;
  bytes: number;
  createdAt: string;
}

/** A copy in the collection (each is one copy since 0.19.0, so quantity is 1). */
export interface OwnedCopy {
  /** The copy's id (its window's routes: Ready to sell). */
  id: number;
  copyKey: string;
  productId: string;
  title: string;
  platformKey: string | null;
  platform: string | null;
  completeness: Completeness;
  quantity: number;
  valueCents: number | null;
}

/** A copy marked for sale or trade (Collection > For sale, and a share link's page). */
export interface SaleItem extends OwnedCopy {
  condition: string;
  sale: SaleKind;
  askingCents: number | null;
  saleNote: string | null;
  coverId: string | null;
}

/** A test of a copy: when, whether it worked, and a note (0.21.0). */
export interface CopyTest {
  id: number;
  /** test (played) or rip (its disc read in full). */
  kind: TestKind;
  result: TestResult;
  note: string | null;
  testedAt: string;
}

/** What the Collection page shows of a copy's details, and filters by. */
export interface CopyExtras {
  details: Map<string, CopyDetail>;
  /** Who has each lent copy (its open loans' names). */
  lentTo: Map<string, string[]>;
  photos: Map<string, number>;
  /** Each tested copy's last test or rip. */
  tested: Map<string, { kind: TestKind; result: TestResult; testedAt: string }>;
}

/** Why a copy's details couldn't be saved. */
export class CopyDetailsError extends Error {}

const EMPTY: CopyDetail = { location: null, tags: [], sale: null, askingCents: null, saleNote: null, digitalClaim: null, digitalClaimedAt: null, digitalStore: null };
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** A photo made smaller in the browser is well under this; the limit keeps a mistake from filling the database. */
export const PHOTO_MAX_BYTES = 4 * 1024 * 1024;
const TAG_MAX = 30;
const TAGS_PER_COPY = 20;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether the bytes are the image they claim to be (JPEG, PNG or WebP). */
function looksLike(mime: string, data: Buffer): boolean {
  if (mime === 'image/jpeg') return data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (mime === 'image/png') return data.length > 8 && data.readUInt32BE(0) === 0x89504e47;
  return data.length > 12 && data.toString('latin1', 0, 4) === 'RIFF' && data.toString('latin1', 8, 12) === 'WEBP';
}

const text = (value: unknown, max: number, what: string): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new CopyDetailsError(`${what} is text.`);
  const t = value.trim().replace(/\s+/g, ' ');
  if (t.length > max) throw new CopyDetailsError(`${what} holds up to ${max} characters.`);
  return t || null;
};

/**
 * The owner's details on their copies (0.6.0, D54): where each is kept, their own tags, whether it's for sale or
 * trade (and for how much), who it's lent to, and photos of it. PriceCharting's export doesn't carry them, so they're
 * kept under the copy's key (one copy since 0.19.0; before, a product in one condition) and stay through every update.
 */
export class CopyDetailsService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationService,
    private readonly log: Logger,
    private readonly coverOf: (platformKey: string, title: string) => string | null = () => null,
  ) {}

  private today(): string {
    return dayIn(this.settings.get('general.timeZone'));
  }

  /** The collection's copies by key. */
  owned(): Map<string, OwnedCopy> {
    const out = new Map<string, OwnedCopy>();
    const rows = this.db
      .select({
        id: copies.id,
        key: copies.key,
        productId: copies.productId,
        title: copies.title,
        platformKey: platforms.key,
        platform: platforms.name,
        completeness: copies.completeness,
        quantity: copies.quantity,
        valueCents: copies.valueCents,
      })
      .from(copies)
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .orderBy(asc(copies.id))
      .all();
    for (const r of rows) {
      out.set(r.key, { id: r.id, copyKey: r.key, productId: r.productId, title: r.title, platformKey: r.platformKey, platform: r.platform, completeness: r.completeness as Completeness, quantity: r.quantity, valueCents: r.valueCents });
    }
    return out;
  }

  private ownedCopy(copyKey: string): OwnedCopy {
    const copy = typeof copyKey === 'string' ? this.owned().get(copyKey) : undefined;
    if (!copy) throw new CopyDetailsError("That copy isn't in your collection.");
    return copy;
  }

  /** Every copy's details. */
  index(): Map<string, CopyDetail> {
    return new Map(
      this.db
        .select()
        .from(copyDetails)
        .all()
        .map((r) => [
          r.copyKey,
          {
            location: r.location,
            tags: JSON.parse(r.tags) as string[],
            sale: r.sale as SaleKind | null,
            askingCents: r.askingCents,
            saleNote: r.saleNote,
            digitalClaim: r.digitalClaim as DigitalClaim | null,
            digitalClaimedAt: r.digitalClaimedAt,
            digitalStore: r.digitalStore,
          },
        ]),
    );
  }

  /** The digital licenses claimed with discs, the discs still here or not (they outlive the disc). */
  claims(): ClaimedLicense[] {
    return this.db
      .select({
        copyKey: copyDetails.copyKey,
        productId: copyDetails.productId,
        claimedAt: copyDetails.digitalClaimedAt,
        store: copyDetails.digitalStore,
        title: copies.title,
        goneAt: copies.goneAt,
        platformKey: platforms.key,
        platform: platforms.name,
      })
      .from(copyDetails)
      .innerJoin(copies, eq(copies.key, copyDetails.copyKey))
      .leftJoin(platforms, eq(platforms.id, copies.platformId))
      .where(eq(copyDetails.digitalClaim, 'claimed'))
      .all()
      .map((r) => ({ copyKey: r.copyKey, productId: r.productId, title: r.title, platformKey: r.platformKey, platform: r.platform, claimedAt: r.claimedAt, store: r.store, discGone: r.goneAt !== null }));
  }

  /** What the Collection page shows of each copy: its details, who has it, and how many photos it has. */
  extras(): CopyExtras {
    const lentTo = new Map<string, string[]>();
    for (const l of this.db.select({ copyKey: loans.copyKey, lentTo: loans.lentTo }).from(loans).where(isNull(loans.returnedAt)).all()) {
      lentTo.set(l.copyKey, [...(lentTo.get(l.copyKey) ?? []), l.lentTo]);
    }
    const photos = new Map(
      this.db
        .select({ copyKey: copyPhotos.copyKey, n: sql<number>`count(*)` })
        .from(copyPhotos)
        .groupBy(copyPhotos.copyKey)
        .all()
        .map((r) => [r.copyKey, r.n]),
    );
    return { details: this.index(), lentTo, photos, tested: this.lastTests() };
  }

  /** Each tested copy's last test or rip (kind: one of them only), by the copy's key. */
  lastTests(kind?: TestKind): Map<string, { kind: TestKind; result: TestResult; testedAt: string }> {
    const out = new Map<string, { kind: TestKind; result: TestResult; testedAt: string }>();
    for (const t of this.db
      .select()
      .from(copyTests)
      .where(kind ? eq(copyTests.kind, kind) : undefined)
      .orderBy(asc(copyTests.testedAt), asc(copyTests.id))
      .all()) {
      out.set(t.copyKey, { kind: t.kind as TestKind, result: t.result as TestResult, testedAt: t.testedAt });
    }
    return out;
  }

  /** A copy's tests, the newest first. */
  tests(copyKey: string): CopyTest[] {
    return this.db
      .select()
      .from(copyTests)
      .where(eq(copyTests.copyKey, copyKey))
      .orderBy(desc(copyTests.testedAt), desc(copyTests.id))
      .all()
      .map((t) => ({ id: t.id, kind: t.kind as TestKind, result: t.result as TestResult, note: t.note, testedAt: t.testedAt }));
  }

  /** Records a test of a copy, or a rip of it (kind rip): how it went, when (now unless said), and a note. */
  addTest(copyKey: string, input: { kind?: unknown; result?: unknown; note?: unknown; testedAt?: unknown }): CopyTest {
    const copy = this.ownedCopy(copyKey);
    const kind = input.kind === undefined || input.kind === null ? 'test' : input.kind;
    if (kind !== 'test' && kind !== 'rip') throw new CopyDetailsError('A test is "test" (played) or "rip" (its disc read in full).');
    if (typeof input.result !== 'string' || !(input.result in TEST_RESULTS)) throw new CopyDetailsError('Say how it went: works, issues or broken.');
    let testedAt = new Date().toISOString();
    if (input.testedAt !== undefined && input.testedAt !== null) {
      if (typeof input.testedAt !== 'string' || Number.isNaN(Date.parse(input.testedAt))) throw new CopyDetailsError('When it was tested is a date and time.');
      testedAt = new Date(input.testedAt).toISOString();
    }
    const row = this.db
      .insert(copyTests)
      .values({ copyKey, kind, result: input.result, note: text(input.note, 200, 'A note'), testedAt })
      .returning()
      .get();
    const said = (kind === 'rip' ? RIP_RESULTS : TEST_RESULTS)[input.result as TestResult].toLowerCase();
    this.log.info({ context: 'tests' }, `${copy.title} ${kind === 'rip' ? 'ripped' : 'tested'}: ${said}`);
    return { id: row.id, kind: row.kind as TestKind, result: row.result as TestResult, note: row.note, testedAt: row.testedAt };
  }

  removeTest(id: number): boolean {
    return this.db.delete(copyTests).where(eq(copyTests.id, id)).run().changes > 0;
  }

  /** A copy's details, its loans (open first, then the newest) and its photos. */
  of(copyKey: string): { copyKey: string; details: CopyDetail; loans: Loan[]; photos: PhotoInfo[]; tests: CopyTest[] } {
    return {
      copyKey,
      details: this.index().get(copyKey) ?? EMPTY,
      loans: this.loanRows(eq(loans.copyKey, copyKey)),
      photos: this.photos(copyKey),
      tests: this.tests(copyKey),
    };
  }

  /** Saves a copy's details (the ones given; the rest stay). With none left, the copy has no details kept. */
  set(
    copyKey: string,
    change: { location?: unknown; tags?: unknown; sale?: unknown; askingCents?: unknown; saleNote?: unknown; digitalClaim?: unknown; digitalClaimedAt?: unknown; digitalStore?: unknown },
  ): CopyDetail {
    const copy = this.ownedCopy(copyKey);
    const before = this.index().get(copyKey) ?? EMPTY;
    let tags = before.tags;
    if (change.tags !== undefined) {
      if (!Array.isArray(change.tags) || change.tags.some((t) => typeof t !== 'string')) throw new CopyDetailsError('Tags are a list of words.');
      const seen = new Set<string>();
      tags = [];
      for (const raw of change.tags as string[]) {
        const t = raw.trim().replace(/\s+/g, ' ');
        if (!t) continue;
        if (t.length > TAG_MAX) throw new CopyDetailsError(`A tag holds up to ${TAG_MAX} characters.`);
        if (seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        tags.push(t);
      }
      if (tags.length > TAGS_PER_COPY) throw new CopyDetailsError(`A copy can have up to ${TAGS_PER_COPY} tags.`);
    }
    const sale = change.sale === undefined ? before.sale : change.sale;
    if (sale !== null && sale !== 'sale' && sale !== 'trade') throw new CopyDetailsError('For sale is "sale", "trade" or nothing.');
    const asking = change.askingCents === undefined ? before.askingCents : change.askingCents;
    if (asking !== null && (typeof asking !== 'number' || !Number.isInteger(asking) || asking < 0 || asking > 100_000_000)) throw new CopyDetailsError('An asking price is an amount in cents.');
    const claim = change.digitalClaim === undefined ? before.digitalClaim : change.digitalClaim;
    if (claim !== null && !DIGITAL_CLAIMS.includes(claim as DigitalClaim)) throw new CopyDetailsError('A digital license is "claimed", "unclaimed", "not-eligible" or nothing.');
    const claimedAt = claim === 'claimed' ? (change.digitalClaimedAt === undefined ? before.digitalClaimedAt : change.digitalClaimedAt) : null;
    if (claimedAt !== null && (typeof claimedAt !== 'string' || !DAY.test(claimedAt))) throw new CopyDetailsError('When it was claimed is a day (YYYY-MM-DD).');
    const next: CopyDetail = {
      location: change.location === undefined ? before.location : text(change.location, 80, 'Where it is kept'),
      tags,
      sale: sale as SaleKind | null,
      askingCents: sale ? (asking as number | null) : null,
      saleNote: sale ? (change.saleNote === undefined ? before.saleNote : text(change.saleNote, 200, 'A note for buyers')) : null,
      digitalClaim: claim as DigitalClaim | null,
      digitalClaimedAt: claimedAt as string | null,
      digitalStore: claim ? (change.digitalStore === undefined ? before.digitalStore : text(change.digitalStore, 40, 'The store')) : null,
    };
    if (!next.location && next.tags.length === 0 && !next.sale && !next.digitalClaim) {
      this.db.delete(copyDetails).where(eq(copyDetails.copyKey, copyKey)).run();
    } else {
      const row = {
        productId: copy.productId,
        location: next.location,
        tags: JSON.stringify(next.tags),
        sale: next.sale,
        askingCents: next.askingCents,
        saleNote: next.saleNote,
        digitalClaim: next.digitalClaim,
        digitalClaimedAt: next.digitalClaimedAt,
        digitalStore: next.digitalStore,
        updatedAt: new Date().toISOString(),
      };
      this.db.insert(copyDetails).values({ copyKey, ...row }).onConflictDoUpdate({ target: copyDetails.copyKey, set: row }).run();
    }
    return next;
  }

  /** Every tag and place in use, with how many copies have it (the most first), for suggestions and filters. */
  vocabulary(): { tags: { name: string; copies: number }[]; locations: { name: string; copies: number }[] } {
    const tags = new Map<string, { name: string; copies: number }>();
    const locations = new Map<string, { name: string; copies: number }>();
    for (const d of this.index().values()) {
      for (const t of d.tags) {
        const k = t.toLowerCase();
        tags.set(k, { name: tags.get(k)?.name ?? t, copies: (tags.get(k)?.copies ?? 0) + 1 });
      }
      if (d.location) {
        const k = d.location.toLowerCase();
        locations.set(k, { name: locations.get(k)?.name ?? d.location, copies: (locations.get(k)?.copies ?? 0) + 1 });
      }
    }
    const order = (a: { name: string; copies: number }, b: { name: string; copies: number }) => b.copies - a.copies || a.name.localeCompare(b.name);
    return { tags: [...tags.values()].sort(order), locations: [...locations.values()].sort(order) };
  }

  private loanRows(where: SQL | undefined): Loan[] {
    const today = this.today();
    const names = new Map(this.db.select({ key: platforms.key, name: platforms.name }).from(platforms).all().map((p) => [p.key, p.name]));
    return this.db
      .select()
      .from(loans)
      .where(where)
      .orderBy(sql`case when ${loans.returnedAt} is null then 0 else 1 end`, desc(loans.lentAt), desc(loans.id))
      .all()
      .map((r) => ({
        id: r.id,
        copyKey: r.copyKey,
        title: r.title,
        platformKey: r.platformKey,
        platform: r.platformKey ? (names.get(r.platformKey) ?? null) : null,
        lentTo: r.lentTo,
        lentAt: r.lentAt,
        dueAt: r.dueAt,
        returnedAt: r.returnedAt,
        note: r.note,
        overdue: r.returnedAt === null && r.dueAt !== null && r.dueAt < today,
      }));
  }

  /** The Loans page: games lent now (overdue first), and the ones given back. */
  loans(): { open: Loan[]; returned: Loan[] } {
    const all = this.loanRows(undefined);
    const open = all.filter((l) => l.returnedAt === null).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'));
    return { open, returned: all.filter((l) => l.returnedAt !== null) };
  }

  /** Lends a copy: to whom, from which day (today) until which day (Settings > Collection > Lend for; none with 0). */
  lend(copyKey: string, input: { lentTo?: unknown; lentAt?: unknown; dueAt?: unknown; note?: unknown }): Loan {
    const copy = this.ownedCopy(copyKey);
    const lentTo = text(input.lentTo, 60, 'Who has it');
    if (!lentTo) throw new CopyDetailsError('Say who you lent it to.');
    const day = (value: unknown, fallback: string | null) => {
      if (value === undefined) return fallback;
      if (value === null || value === '') return null;
      if (typeof value !== 'string' || !DAY.test(value)) throw new CopyDetailsError('A day is YYYY-MM-DD.');
      return value;
    };
    const lentAt = day(input.lentAt, this.today()) ?? this.today();
    const days = this.settings.get('collection.loanDays');
    const dueAt = day(input.dueAt, days > 0 ? addDays(lentAt, days) : null);
    if (dueAt && dueAt < lentAt) throw new CopyDetailsError("It can't be due back before it was lent.");
    const row = this.db
      .insert(loans)
      .values({ copyKey, productId: copy.productId, title: copy.title, platformKey: copy.platformKey, lentTo, lentAt, dueAt, note: text(input.note, 200, 'A note') })
      .returning()
      .get();
    this.log.info({ context: 'loans' }, `${copy.title} lent${dueAt ? ` until ${dueAt}` : ''}`);
    return this.loanRows(eq(loans.id, row.id))[0]!;
  }

  /** Marks a lent game given back (today, or the day given); null when there's no such loan. */
  giveBack(id: number, day?: unknown): Loan | null {
    const row = this.db.select().from(loans).where(eq(loans.id, id)).get();
    if (!row) return null;
    if (day !== undefined && day !== null && (typeof day !== 'string' || !DAY.test(day))) throw new CopyDetailsError('A day is YYYY-MM-DD.');
    this.db
      .update(loans)
      .set({ returnedAt: (day as string | undefined) ?? this.today() })
      .where(eq(loans.id, id))
      .run();
    return this.loanRows(eq(loans.id, id))[0] ?? null;
  }

  /** Changes a loan's due day or note, or takes back "given back" (returnedAt: null). */
  updateLoan(id: number, change: { dueAt?: unknown; note?: unknown; lentTo?: unknown; returnedAt?: unknown }): Loan | null {
    const row = this.db.select().from(loans).where(eq(loans.id, id)).get();
    if (!row) return null;
    const set: Partial<typeof loans.$inferInsert> = {};
    for (const k of ['dueAt', 'returnedAt'] as const) {
      const v = change[k];
      if (v === undefined) continue;
      if (v !== null && (typeof v !== 'string' || !DAY.test(v))) throw new CopyDetailsError('A day is YYYY-MM-DD.');
      set[k] = v as string | null;
      // A new due day can be reminded about again.
      if (k === 'dueAt') set.remindedAt = null;
    }
    if (change.note !== undefined) set.note = text(change.note, 200, 'A note');
    if (change.lentTo !== undefined) {
      const lentTo = text(change.lentTo, 60, 'Who has it');
      if (!lentTo) throw new CopyDetailsError('Say who you lent it to.');
      set.lentTo = lentTo;
    }
    if (Object.keys(set).length > 0) this.db.update(loans).set(set).where(eq(loans.id, id)).run();
    return this.loanRows(eq(loans.id, id))[0] ?? null;
  }

  removeLoan(id: number): boolean {
    return this.db.delete(loans).where(eq(loans.id, id)).run().changes > 0;
  }

  /** Sends one message about lent games not back by their day and not reminded about yet (Settings > Notifications). */
  async remindOverdue(): Promise<string> {
    if (!this.settings.get('notifications.loanReminders')) return 'Loan reminders are off';
    const today = this.today();
    const due = this.db
      .select()
      .from(loans)
      .where(and(isNull(loans.returnedAt), isNull(loans.remindedAt), sql`${loans.dueAt} is not null and ${loans.dueAt} < ${today}`))
      .orderBy(asc(loans.dueAt))
      .all();
    if (due.length === 0) return 'No lent game is overdue';
    if (this.notifications.channels().length === 0) return `${due.length} lent game(s) overdue; no way to send a reminder (Settings > Notifications)`;
    const names = new Map(this.db.select({ key: platforms.key, name: platforms.name }).from(platforms).all().map((p) => [p.key, p.name]));
    const line = (l: (typeof due)[number]) => `${l.title}${l.platformKey && names.get(l.platformKey) ? ` (${names.get(l.platformKey)})` : ''}, lent to ${l.lentTo} on ${l.lentAt}, due back ${l.dueAt}`;
    const body = due.length === 1 ? `A game you lent is overdue: ${line(due[0]!)}.` : `${due.length} games you lent are overdue: ${due.map(line).join('; ')}.`;
    const results = await this.notifications.notice(due.length === 1 ? 'a lent game is overdue' : 'lent games are overdue', body, '/collection/loans');
    if (!results.some((r) => r.ok)) throw new Error(`The reminder couldn't be sent: ${results.map((r) => `${r.channel}: ${r.error ?? 'failed'}`).join('; ')}`);
    const now = new Date().toISOString();
    for (const l of due) this.db.update(loans).set({ remindedAt: now }).where(eq(loans.id, l.id)).run();
    return `Reminded about ${due.length} overdue game(s)`;
  }

  photos(copyKey: string): PhotoInfo[] {
    return this.db
      .select({ id: copyPhotos.id, caption: copyPhotos.caption, slot: copyPhotos.slot, mime: copyPhotos.mime, bytes: copyPhotos.bytes, createdAt: copyPhotos.createdAt })
      .from(copyPhotos)
      .where(eq(copyPhotos.copyKey, copyKey))
      .orderBy(asc(copyPhotos.id))
      .all();
  }

  /**
   * Keeps a photo of a copy (JPEG, PNG or WebP, made smaller in the browser), up to Settings > Collection > Photos per
   * copy. A standard photo (its slot: "Box front") takes the place of the one it had.
   */
  addPhoto(copyKey: string, mime: string, data: Buffer, caption: unknown, slot?: unknown): PhotoInfo {
    const copy = this.ownedCopy(copyKey);
    if (!PHOTO_TYPES.has(mime) || !looksLike(mime, data)) throw new CopyDetailsError('A photo is a JPEG, PNG or WebP image.');
    if (data.length > PHOTO_MAX_BYTES) throw new CopyDetailsError(`A photo can be up to ${PHOTO_MAX_BYTES / 1024 / 1024} MB.`);
    const slotName = text(slot, 60, 'A photo\'s place');
    const replaced = slotName ? this.photos(copyKey).find((p) => p.slot === slotName) : undefined;
    const limit = this.settings.get('collection.photosPerCopy');
    if (!replaced && this.photos(copyKey).length >= limit) throw new CopyDetailsError(`A copy can have ${limit} photos (Settings > Collection > Photos per copy).`);
    if (replaced) this.db.delete(copyPhotos).where(eq(copyPhotos.id, replaced.id)).run();
    const row = this.db
      .insert(copyPhotos)
      .values({ copyKey, productId: copy.productId, caption: text(caption, 100, 'A caption') ?? slotName, slot: slotName, mime, bytes: data.length, data, createdAt: new Date().toISOString() })
      .returning({ id: copyPhotos.id, caption: copyPhotos.caption, slot: copyPhotos.slot, mime: copyPhotos.mime, bytes: copyPhotos.bytes, createdAt: copyPhotos.createdAt })
      .get();
    this.log.info({ context: 'photos' }, `Photo of ${copy.title} kept (${Math.round(data.length / 1024)} KB)`);
    return row;
  }

  photo(id: number): { mime: string; data: Buffer } | null {
    return this.db.select({ mime: copyPhotos.mime, data: copyPhotos.data }).from(copyPhotos).where(eq(copyPhotos.id, id)).get() ?? null;
  }

  /** Changes a photo's caption, or which standard photo it is (null: another photo); the one that had that place loses it. */
  setPhoto(id: number, change: { caption?: unknown; slot?: unknown }): boolean {
    const photo = this.db.select({ copyKey: copyPhotos.copyKey }).from(copyPhotos).where(eq(copyPhotos.id, id)).get();
    if (!photo) return false;
    const set: Partial<typeof copyPhotos.$inferInsert> = {};
    if (change.caption !== undefined) set.caption = text(change.caption, 100, 'A caption');
    if (change.slot !== undefined) {
      set.slot = text(change.slot, 60, 'A photo\'s place');
      if (set.slot) this.db.update(copyPhotos).set({ slot: null }).where(and(eq(copyPhotos.copyKey, photo.copyKey), eq(copyPhotos.slot, set.slot))).run();
    }
    return Object.keys(set).length === 0 || this.db.update(copyPhotos).set(set).where(eq(copyPhotos.id, id)).run().changes > 0;
  }

  removePhoto(id: number): boolean {
    return this.db.delete(copyPhotos).where(eq(copyPhotos.id, id)).run().changes > 0;
  }

  /** The copies marked for sale or trade that are still in the collection, by console and title. */
  forSale(): SaleItem[] {
    const owned = this.owned();
    const out: SaleItem[] = [];
    for (const [copyKey, d] of this.index()) {
      const copy = owned.get(copyKey);
      if (!copy || !d.sale) continue;
      out.push({
        ...copy,
        condition: COMPLETENESS_LABELS[copy.completeness] ?? copy.completeness,
        sale: d.sale,
        askingCents: d.askingCents,
        saleNote: d.saleNote,
        coverId: copy.platformKey ? this.coverOf(copy.platformKey, copy.title) : null,
      });
    }
    return out.sort((a, b) => (a.platform ?? '').localeCompare(b.platform ?? '') || a.title.localeCompare(b.title));
  }

  /** Games owned more than once (the same product), with each copy and whether it's marked already: ones you could sell or trade. */
  duplicates(): { productId: string; title: string; platform: string | null; copies: number; items: (OwnedCopy & { condition: string; sale: SaleKind | null })[] }[] {
    const details = this.index();
    const byProduct = new Map<string, OwnedCopy[]>();
    for (const c of this.owned().values()) byProduct.set(c.productId, [...(byProduct.get(c.productId) ?? []), c]);
    return [...byProduct.values()]
      .filter((list) => list.reduce((n, c) => n + c.quantity, 0) > 1)
      .map((list) => ({
        productId: list[0]!.productId,
        title: list[0]!.title,
        platform: list[0]!.platform,
        copies: list.reduce((n, c) => n + c.quantity, 0),
        items: list.map((c) => ({ ...c, condition: COMPLETENESS_LABELS[c.completeness] ?? c.completeness, sale: details.get(c.copyKey)?.sale ?? null })),
      }))
      .sort((a, b) => (a.platform ?? '').localeCompare(b.platform ?? '') || a.title.localeCompare(b.title));
  }
}

const money = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));

/**
 * Copies' details, loans and photos: the owner changes them; viewers see them only when Settings > Security > Viewers
 * shares them. The games for sale have their own list and download.
 */
export function registerCopyDetailRoutes(app: FastifyInstance, details: CopyDetailsService, settings: SettingsService): void {
  const hidden = { error: 'not-shared', message: "The owner doesn't share their copies' details." };
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) => {
    if (err instanceof CopyDetailsError) return reply.code(400).send({ error: 'invalid', message: err.message });
    throw err;
  };

  app.get('/api/v1/copy', async (request, reply) => {
    if (!shown(request).details) return reply.code(403).send(hidden);
    const { key } = request.query as { key?: string };
    if (!key) return reply.code(400).send({ error: 'invalid', message: 'Give the copy (key).' });
    return details.of(key);
  });

  app.put('/api/v1/copy', async (request, reply) => {
    const b = request.body as { key?: unknown; location?: unknown; tags?: unknown; sale?: unknown; askingCents?: unknown; saleNote?: unknown; digitalClaim?: unknown; digitalClaimedAt?: unknown; digitalStore?: unknown } | null;
    if (typeof b?.key !== 'string') return reply.code(400).send({ error: 'invalid', message: 'Send key, and location, tags, sale, askingCents, saleNote, digitalClaim, digitalClaimedAt or digitalStore.' });
    try {
      return { details: details.set(b.key, b) };
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/v1/tags', async (request, reply) => (shown(request).details ? details.vocabulary() : reply.code(403).send(hidden)));

  app.get('/api/v1/loans', async (request, reply) => (shown(request).details ? details.loans() : reply.code(403).send(hidden)));

  app.post('/api/v1/loans', async (request, reply) => {
    const b = request.body as { key?: unknown; lentTo?: unknown; lentAt?: unknown; dueAt?: unknown; note?: unknown } | null;
    if (typeof b?.key !== 'string') return reply.code(400).send({ error: 'invalid', message: 'Send key and lentTo, and lentAt, dueAt or a note if you like.' });
    try {
      return reply.code(201).send(details.lend(b.key, b));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/loans/:id/return', async (request, reply) => {
    try {
      const loan = details.giveBack(Number((request.params as { id: string }).id), (request.body as { day?: unknown } | null)?.day);
      return loan ?? reply.code(404).send({ error: 'not-found', message: 'No such loan.' });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.put('/api/v1/loans/:id', async (request, reply) => {
    try {
      const loan = details.updateLoan(Number((request.params as { id: string }).id), (request.body ?? {}) as Record<string, unknown>);
      return loan ?? reply.code(404).send({ error: 'not-found', message: 'No such loan.' });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/v1/loans/:id', async (request) => ({ removed: details.removeLoan(Number((request.params as { id: string }).id)) }));

  // Tests of a copy: recorded (works, issues, broken; now unless said), or taken back.
  app.post('/api/v1/copy/tests', async (request, reply) => {
    const b = request.body as { key?: unknown; kind?: unknown; result?: unknown; note?: unknown; testedAt?: unknown } | null;
    if (typeof b?.key !== 'string') return reply.code(400).send({ error: 'invalid', message: 'Send key and result (works, issues or broken), and a note if you like.' });
    try {
      return reply.code(201).send(details.addTest(b.key, b));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/v1/copy/tests/:id', async (request) => ({ removed: details.removeTest(Number((request.params as { id: string }).id)) }));

  // A photo, uploaded as a form with the copy's key (and a caption, or the standard photo it is), made smaller in the browser first.
  app.post('/api/v1/photos', async (request, reply) => {
    const file = await request.file({ limits: { fileSize: PHOTO_MAX_BYTES + 1 } });
    if (!file) return reply.code(400).send({ error: 'no-file', message: 'Choose a photo.' });
    const field = (name: string) => {
      const f = file.fields[name] as { value?: unknown } | undefined;
      return typeof f?.value === 'string' ? f.value : undefined;
    };
    const data = await file.toBuffer();
    if (file.file.truncated) return reply.code(400).send({ error: 'invalid', message: `A photo can be up to ${PHOTO_MAX_BYTES / 1024 / 1024} MB.` });
    try {
      return reply.code(201).send(details.addPhoto(field('key') ?? '', file.mimetype, data, field('caption'), field('slot')));
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.get('/api/v1/photos/:id', async (request, reply) => {
    if (!shown(request).details) return reply.code(403).send(hidden);
    const photo = details.photo(Number((request.params as { id: string }).id));
    if (!photo) return reply.code(404).send({ error: 'not-found', message: 'No such photo.' });
    // A photo never changes (a new one gets a new number), so the browser may keep it.
    return reply.header('content-type', photo.mime).header('cache-control', 'private, max-age=31536000, immutable').send(photo.data);
  });

  app.put('/api/v1/photos/:id', async (request, reply) => {
    try {
      const b = (request.body ?? {}) as { caption?: unknown; slot?: unknown };
      const ok = details.setPhoto(Number((request.params as { id: string }).id), b);
      return ok ? { ok } : reply.code(404).send({ error: 'not-found', message: 'No such photo.' });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.delete('/api/v1/photos/:id', async (request) => ({ removed: details.removePhoto(Number((request.params as { id: string }).id)) }));

  // The games for sale or trade, and the games owned more than once that could be.
  app.get('/api/v1/sale', async (request, reply) => {
    if (!shown(request).details) return reply.code(403).send(hidden);
    return { currency: settings.get('general.currency'), items: details.forSale(), duplicates: details.duplicates() };
  });

  app.get('/api/v1/sale/export', async (request, reply) => {
    if (!shown(request).details) return reply.code(403).send(hidden);
    const currency = settings.get('general.currency') || 'USD';
    const rows: (string | number)[][] = [['Title', 'Console', 'Condition', 'Copies', 'Sale or trade', `Asking (${currency})`, `Value each (${currency})`, 'Note']];
    for (const s of details.forSale()) rows.push([s.title, s.platform ?? '', s.condition, s.quantity, s.sale, money(s.askingCents), money(s.valueCents), s.saleNote ?? '']);
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="squirrelcade-for-sale-${date}.csv"`)
      .send(toCsv(rows));
  });
}
