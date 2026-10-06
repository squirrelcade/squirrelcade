import {
  baseTitle,
  COMPLETENESS_LABELS,
  findPlatforms,
  matchKey,
  matchTokens,
  NEAR_MISS_AT,
  normalizeTitle,
  pcFamilyKey,
  platformFamily,
  PLATFORM_SHORT_NAMES,
  REGION_LABELS,
  SAME_GAME_AT,
  TitleMatcher,
  titleShape,
  type Completeness,
  type Region,
  type ScoredCandidate,
  type TitleMatch,
} from '@squirrelcade/core';
import { eq, isNull } from 'drizzle-orm';
import { z } from 'zod';
import type { AiPerson } from './aiAuth.js';
import type { ClaimedLicense, CopyDetailsService } from './copyDetails.js';
import type { Db } from './db/index.js';
import { copies, copyGroups, platforms } from './db/schema.js';
import type { HistoryService } from './history.js';
import type { IgdbService } from './igdb.js';
import type { NotesService } from './notes.js';
import type { PcFamily, PcService } from './pc.js';
import type { SettingsService } from './settings.js';
import type { WishlistService } from './wishlist.js';

/**
 * What Claude and other AI apps can ask (0.55.0, D127): four read-only tools over the collection, each answer
 * structured JSON. A game is a title across consoles and PC, grouped as Collection › Copies groups them (the
 * owner's answers there included); its copies on each console, its storefronts on PC, and digital licenses claimed
 * with discs (D129). What a person sees follows their account (a viewer's view as on the web), or a guest's
 * (a viewer's, never prices paid or notes); prices paid and notes come only when Settings › Claude and AI apps
 * lets them in.
 */

/** What a person sees through an AI app. */
export interface AiView {
  paid: boolean;
  notes: boolean;
  pc: boolean;
  play: boolean;
  details: boolean;
}

/** Who sees what: the owner everything (prices paid and notes when let in), a viewer as on the web, a guest less. */
export function aiViewOf(person: AiPerson, settings: SettingsService): AiView {
  const viewer = {
    paid: settings.get('security.viewersSeePaid'),
    notes: settings.get('security.viewersSeeNotes'),
    pc: settings.get('security.viewersSeePc'),
    play: settings.get('security.viewersSeePlay'),
    details: settings.get('security.viewersSeeCopyDetails'),
  };
  if (person.kind === 'guest') return { ...viewer, paid: false, notes: false };
  const sharePaid = settings.get('ai.sharePaid');
  const shareNotes = settings.get('ai.shareNotes');
  if (person.role === 'owner') return { paid: sharePaid, notes: shareNotes, pc: true, play: true, details: true };
  return { ...viewer, paid: viewer.paid && sharePaid, notes: viewer.notes && shareNotes };
}

interface CopyRow {
  id: number;
  key: string;
  productId: string;
  title: string;
  region: string;
  valueCents: number | null;
  costCents: number | null;
  conditionString: string;
  completeness: string;
  sealed: boolean;
  hasBox: boolean;
  hasManual: boolean;
  gradingCompany: string;
  gradingCertId: string;
  notes: string;
  addedAt: string;
  datePurchased: string | null;
}

/** One console's copies of one product (PriceCharting's), and licenses claimed with its discs. */
interface ConsoleEntry {
  kind: 'console';
  key: string;
  groupKey: string;
  platformKey: string;
  platform: string;
  productId: string;
  title: string;
  copies: CopyRow[];
  claims: ClaimedLicense[];
}

/** A PC game across its storefronts. */
interface PcEntry {
  kind: 'pc';
  key: string;
  groupKey: string;
  title: string;
  family: PcFamily;
}

type Entry = ConsoleEntry | PcEntry;

interface Game {
  key: string;
  title: string;
  entries: Entry[];
}

interface Snapshot {
  at: number;
  platforms: { key: string; name: string }[];
  games: Map<string, Game>;
  entries: Entry[];
  matcher: TitleMatcher<Entry>;
  /** Each entry's words and key, for search. */
  words: Map<Entry, { tokens: string[]; key: string }>;
}

/** A game's id: opaque to the app, its group's key underneath. */
export const gameId = (groupKey: string) => `g_${Buffer.from(groupKey).toString('base64url')}`;
const groupOf = (id: string) => (/^g_[A-Za-z0-9_-]{1,700}$/.test(id) ? Buffer.from(id.slice(2), 'base64url').toString() : null);

const STOP = new Set(['the', 'of', 'a', 'an', 'and', 'to', 'in', 'on', 'for']);
/** A minute: a copy's details (a license claimed) show by then; the collection and PC library changing clear it at once. */
const SNAPSHOT_MS = 60_000;

/** How a PC game is held: owned for good, through a subscription (Game Pass), or no more. */
const held = (ownership: string) => (ownership === 'permanent' ? 'owned' : ownership === 'subscription' ? 'subscription' : 'previously');

export interface AiToolDeps {
  db: Db;
  settings: SettingsService;
  pc: PcService;
  details: CopyDetailsService;
  wishlist: WishlistService;
  igdb: IgdbService;
  history: HistoryService;
  notes: NotesService;
}

/** Why a tool's call can't be answered: said to the app as the tool's error. */
export class AiToolError extends Error {}

export class AiTools {
  private cache = new Map<boolean, Snapshot>();
  private wishCache: { at: string; matcher: TitleMatcher<{ platformKey: string; platform: string; title: string; key: string }> } | null = null;

  constructor(private readonly d: AiToolDeps) {}

  invalidate(): void {
    this.cache.clear();
  }

  /** The collection as the tools see it (worked out again after a minute, or when it changes). */
  private snapshot(withPc: boolean): Snapshot {
    const cached = this.cache.get(withPc);
    if (cached && Date.now() - cached.at < SNAPSHOT_MS) return cached;
    const { db } = this.d;
    const moved = new Map(
      db
        .select()
        .from(copyGroups)
        .all()
        .map((r) => [r.copyKey, r.groupKey]),
    );
    const rows = db
      .select({
        id: copies.id,
        key: copies.key,
        productId: copies.productId,
        title: copies.title,
        region: copies.region,
        valueCents: copies.valueCents,
        costCents: copies.costCents,
        conditionString: copies.conditionString,
        completeness: copies.completeness,
        sealed: copies.sealed,
        hasBox: copies.hasBox,
        hasManual: copies.hasManual,
        gradingCompany: copies.gradingCompany,
        gradingCertId: copies.gradingCertId,
        notes: copies.notes,
        addedAt: copies.addedAt,
        datePurchased: copies.datePurchased,
        platformKey: platforms.key,
        platform: platforms.name,
      })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    const consoles = new Map<string, ConsoleEntry>();
    const consoleEntry = (platformKey: string, platform: string, productId: string, title: string) => {
      const key = `${platformKey}|${productId}`;
      let e = consoles.get(key);
      if (!e) {
        e = { kind: 'console', key, groupKey: moved.get(`console|${platformKey}|${title}`) ?? pcFamilyKey(title), platformKey, platform, productId, title, copies: [], claims: [] };
        consoles.set(key, e);
      }
      return e;
    };
    for (const r of rows) consoleEntry(r.platformKey, r.platform, r.productId, r.title).copies.push(r);
    for (const c of this.d.details.claims()) if (c.platformKey && c.platform) consoleEntry(c.platformKey, c.platform, c.productId, c.title).claims.push(c);
    const entries: Entry[] = [...consoles.values()];
    if (withPc && this.d.pc.enabled()) {
      for (const f of this.d.pc.families()) entries.push({ kind: 'pc', key: `pc|${f.key}`, groupKey: moved.get(`pc|${f.key}`) ?? f.key, title: f.title, family: f });
    }
    const games = new Map<string, Game>();
    for (const e of entries) {
      let g = games.get(e.groupKey);
      if (!g) {
        g = { key: e.groupKey, title: e.title, entries: [] };
        games.set(e.groupKey, g);
      }
      g.entries.push(e);
    }
    for (const g of games.values()) {
      // The title a console copy goes by, when there is one (as the Copies page names a game).
      g.title = g.entries.find((e) => e.kind === 'console')?.title ?? g.title;
      g.entries.sort((a, b) => (a.kind === b.kind ? (a.kind === 'console' ? a.platform.localeCompare((b as ConsoleEntry).platform) : 0) : a.kind === 'console' ? -1 : 1));
    }
    const matcher = new TitleMatcher(entries, (e) => (e.kind === 'pc' ? [e.title, ...e.family.records.map((r) => r.name)] : [e.title]));
    const words = new Map(entries.map((e) => [e, { tokens: matchTokens(baseTitle(e.title)), key: matchKey(e.title) }] as const));
    const platformRows = db.select({ key: platforms.key, name: platforms.name }).from(platforms).all();
    const snap: Snapshot = { at: Date.now(), platforms: platformRows, games, entries, matcher, words };
    this.cache.set(withPc, snap);
    return snap;
  }

  /** The consoles (and PC) a name stands for, among those with games; a name nothing fits is the app's error. */
  private platformFilter(snap: Snapshot, asked: string | undefined): ((e: Entry) => boolean) | null {
    if (!asked?.trim()) return null;
    const want = asked.trim().toLowerCase();
    if (['pc', 'windows', 'pc windows', 'computer'].includes(want)) return (e) => e.kind === 'pc';
    const inUse = snap.platforms.filter((p) => snap.entries.some((e) => e.kind === 'console' && e.platformKey === p.key));
    const found = new Set(findPlatforms(asked, inUse).map((p) => p.key));
    if (found.size === 0) throw new AiToolError(`No console called "${asked}" has games in this collection. list_platforms gives the consoles (and their keys).`);
    return (e) => e.kind === 'console' && found.has(e.platformKey);
  }

  private summary(e: Entry, view: AiView) {
    if (e.kind === 'pc') {
      return {
        platform: 'PC',
        title: e.title,
        format: 'digital' as const,
        storefronts: [...new Map(e.family.records.map((r) => [`${r.storefront}|${r.ownership}`, { storefront: r.storefront, held: held(r.ownership) }])).values()],
      };
    }
    const shape = titleShape(e.title);
    const edition = shape.edition ?? shape.reprint;
    const count = (pred: (c: CopyRow) => boolean) => e.copies.filter(pred).length;
    const claim = e.claims[0];
    return {
      platform: e.platform,
      platform_key: e.platformKey,
      title: e.title,
      ...(edition ? { edition } : {}),
      format: e.copies.length > 0 ? ('physical' as const) : ('digital' as const),
      copies: e.copies.length,
      sealed: count((c) => c.sealed),
      complete: count((c) => c.completeness === 'complete'),
      loose: count((c) => c.completeness === 'loose'),
      graded: count((c) => c.completeness === 'graded'),
      value_cents: e.copies.reduce((n, c) => n + (c.valueCents ?? 0), 0),
      ...(claim
        ? { digital_license: { claimed: true, ...(claim.store ? { store: claim.store } : {}), ...(claim.claimedAt ? { claimed_at: claim.claimedAt } : {}), disc_gone: e.claims.every((c) => c.discGone) } }
        : {}),
      ...(view.paid ? { paid_cents: e.copies.reduce((n, c) => n + (c.costCents ?? 0), 0) } : {}),
    };
  }

  /** search_games: the collection's games by title words, console, format, storefront and condition. */
  search(input: { query?: string; platform?: string; format?: 'physical' | 'digital'; storefront?: string; condition?: 'sealed' | 'complete' | 'loose' | 'graded'; limit?: number; cursor?: string }, view: AiView) {
    const snap = this.snapshot(view.pc);
    const onPlatform = this.platformFilter(snap, input.platform);
    if (input.storefront && !view.pc) throw new AiToolError("The PC library isn't shared with you, so there are no storefronts to search.");
    const store = input.storefront?.trim().toLowerCase();
    const keep = (e: Entry) => {
      if (onPlatform && !onPlatform(e)) return false;
      if (input.format === 'physical' && (e.kind !== 'console' || e.copies.length === 0)) return false;
      if (input.format === 'digital' && e.kind === 'console' && e.claims.length === 0) return false;
      if (store && (e.kind !== 'pc' || !e.family.records.some((r) => r.storefront.toLowerCase().includes(store)))) return false;
      if (input.condition) {
        if (e.kind !== 'console') return false;
        const want = input.condition;
        if (!e.copies.some((c) => (want === 'sealed' ? c.sealed : c.completeness === want))) return false;
      }
      return true;
    };
    const query = (input.query ?? '').trim();
    const scored = new Map<string, { game: Game; score: number; match: TitleMatch | null; entries: Entry[] }>();
    const add = (e: Entry, score: number, match: TitleMatch | null) => {
      const game = snap.games.get(e.groupKey)!;
      const s = scored.get(game.key) ?? { game, score: 0, match: null, entries: [] };
      if (score > s.score) {
        s.score = score;
        s.match = match;
      }
      if (!s.entries.includes(e)) s.entries.push(e);
      scored.set(game.key, s);
    };
    if (!query) {
      for (const e of snap.entries) if (keep(e)) add(e, 0, null);
    } else {
      for (const f of snap.matcher.find(query, { filter: keep })) add(f.item, f.match.confidence, f.match);
      // Every word asked starting a word of the title ("yak" for Yakuza 0).
      const asked = matchTokens(query).filter((w) => !STOP.has(w));
      const askedKey = matchKey(query);
      if (asked.length > 0) {
        for (const e of snap.entries) {
          if (!keep(e)) continue;
          const w = snap.words.get(e)!;
          const hit = asked.every((a) => w.tokens.some((t) => t.startsWith(a))) || (askedKey.length >= 3 && w.key.includes(askedKey));
          if (hit) add(e, Math.round((0.5 + 0.3 * Math.min(1, askedKey.length / Math.max(1, w.key.length))) * 100) / 100, null);
        }
      }
    }
    const ranked = [...scored.values()].sort((a, b) => b.score - a.score || a.game.title.localeCompare(b.game.title));
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) : 0;
    if (!Number.isInteger(offset) || offset < 0) throw new AiToolError('That cursor is not one search_games gave.');
    const page = ranked.slice(offset, offset + limit);
    return {
      total: ranked.length,
      games: page.map((s) => ({
        id: gameId(s.game.key),
        title: s.game.title,
        ...(s.match ? { match: { confidence: s.match.confidence, kind: s.match.kind, why: s.match.why } } : {}),
        entries: s.entries.map((e) => this.summary(e, view)),
      })),
      ...(offset + limit < ranked.length ? { next_cursor: Buffer.from(String(offset + limit)).toString('base64url') } : {}),
    };
  }

  /** check_ownership: for each title, owned or not, how sure, near misses, the consoles it's on, and its wishlist place. */
  check(input: { titles: string[]; platforms?: string[] }, view: AiView) {
    const snap = this.snapshot(view.pc);
    const filters = (input.platforms ?? []).map((p) => this.platformFilter(snap, p)!).filter(Boolean);
    const onAsked = (e: Entry) => filters.length === 0 || filters.some((f) => f(e));
    return {
      results: input.titles.map((title) => {
        const found = snap.matcher.find(title, { min: NEAR_MISS_AT, limit: 15 });
        const describe = (f: (typeof found)[number]) => {
          const e = f.item;
          const how =
            e.kind === 'pc'
              ? e.family.owned
                ? 'owned'
                : e.family.records.some((r) => r.ownership === 'subscription')
                  ? 'subscription'
                  : 'previously'
              : e.copies.length > 0 || e.claims.length > 0
                ? 'owned'
                : 'previously';
          return { game_id: gameId(e.groupKey), held: how, confidence: f.match.confidence, match: f.match.kind, why: f.match.why, ...this.summary(e, view) };
        };
        const sure = found.filter((f) => f.match.confidence >= SAME_GAME_AT);
        const matches = sure.filter((f) => onAsked(f.item)).map(describe);
        const elsewhere = filters.length > 0 ? sure.filter((f) => !onAsked(f.item)).map(describe) : [];
        const near = found
          .filter((f) => f.match.confidence < SAME_GAME_AT && onAsked(f.item))
          .slice(0, 3)
          .map(describe);
        const status = matches.some((m) => m.held === 'owned') ? 'owned' : matches.some((m) => m.held === 'subscription') ? 'subscription' : near.length > 0 ? 'possible' : 'not_owned';
        return {
          title,
          status,
          matches,
          near_misses: near,
          ...(filters.length > 0 ? { elsewhere } : {}),
          ...(status !== 'owned' ? { wishlist: this.wishes(title) } : {}),
        };
      }),
    };
  }

  /** A title's places on the wishlist (acorns, rank), on any console. */
  private wishes(title: string) {
    const result = this.d.wishlist.compute();
    if (!this.wishCache || this.wishCache.at !== result.generatedAt) {
      const items = [...result.all.entries()].map(([key, c]) => ({ key, platformKey: c.platformKey, platform: c.platformName, title: c.title }));
      this.wishCache = { at: result.generatedAt, matcher: new TitleMatcher(items, (i) => [i.title]) };
    }
    return this.wishCache.matcher
      .find(title, { min: SAME_GAME_AT, limit: 3 })
      .map((f) => {
        const c = result.all.get(f.item.key)!;
        const rank = result.index.get(f.item.key)?.rank;
        return { platform: f.item.platform, title: f.item.title, acorns: Math.round(c.score), priority: c.priority, ...(rank ? { rank } : {}), why: whyOf(c) };
      });
  }

  /** get_game: one game's copies on each console (with their condition), its PC storefronts, reviews and Top 100 places. */
  game(input: { id: string }, view: AiView) {
    const key = groupOf(input.id);
    const snap = this.snapshot(view.pc);
    const game = key ? snap.games.get(key) : undefined;
    if (!game) throw new AiToolError('No game has that id. Ids come from search_games and check_ownership (and change when the collection does).');
    const historyOn = this.d.history.enabled();
    const detail = view.details || view.notes ? this.d.details.index() : null;
    const lent = view.details ? new Set(this.d.details.loans().open.map((l) => l.copyKey)) : null;
    return {
      id: input.id,
      title: game.title,
      entries: game.entries.map((e) => {
        if (e.kind === 'pc') {
          return {
            platform: 'PC',
            title: e.title,
            format: 'digital' as const,
            storefronts: e.family.records.map((r) => ({
              storefront: r.storefront,
              title: r.name,
              held: held(r.ownership),
              ...(view.play ? { playtime_hours: Math.round(r.playtimeSeconds / 360) / 10, completion: r.completionStatus } : {}),
            })),
          };
        }
        const shape = titleShape(e.title);
        const edition = shape.edition ?? shape.reprint;
        const reviews = this.d.igdb.reviewsOf(e.platformKey, e.title);
        const top100 = historyOn ? this.d.history.gameHistory(e.platformKey, [e.title]).top100 : null;
        const note = view.notes ? this.d.notes.of(e.platformKey, [e.title]) : null;
        return {
          platform: e.platform,
          platform_key: e.platformKey,
          title: e.title,
          ...(edition ? { edition } : {}),
          format: e.copies.length > 0 ? ('physical' as const) : ('digital' as const),
          reviews: reviews ? { rating: reviews.rating, count: reviews.count, source: 'IGDB' } : null,
          top100: top100 ? { rank: top100.rank, of: top100.of } : null,
          ...(note ? { note: note.text } : {}),
          copies: e.copies.map((c) => {
            const d = detail?.get(c.key);
            return {
              condition: COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness,
              sealed: c.sealed,
              box: c.hasBox,
              manual: c.hasManual,
              region: REGION_LABELS[c.region as Region] ?? c.region,
              graded: c.gradingCompany ? { company: c.gradingCompany, cert: c.gradingCertId || null } : null,
              value_cents: c.valueCents,
              added: c.addedAt.slice(0, 10),
              ...(view.paid ? { paid_cents: c.costCents || null, bought: c.datePurchased } : {}),
              ...(view.notes && c.notes ? { notes: c.notes } : {}),
              ...(view.details ? { kept_at: d?.location ?? null, tags: d?.tags ?? [], for_sale: d?.sale ?? null, lent_out: lent!.has(c.key) } : {}),
              ...(d?.digitalClaim ? { digital_license: { status: d.digitalClaim, store: d.digitalStore, claimed_at: d.digitalClaimedAt } } : {}),
            };
          }),
          ...(e.claims.length > 0 ? { digital_licenses: e.claims.map((c) => ({ store: c.store, claimed_at: c.claimedAt, disc_gone: c.discGone })) } : {}),
        };
      }),
    };
  }

  /**
   * get_wishlist (0.59.0): the Acorns wishlist, best first. Each game's acorns (how much the owner wants it), its priority,
   * its place on the main list and the rules that gave it the most. A console's whole list when one is asked for.
   */
  wishlist(input: { query?: string; platform?: string; priority?: string; limit?: number; cursor?: string }) {
    const result = this.d.wishlist.compute();
    let keys: Set<string> | null = null;
    if (input.platform?.trim()) {
      const found = findPlatforms(input.platform, result.platforms);
      if (found.length === 0) throw new AiToolError(`No console called "${input.platform}" has games on the wishlist. list_platforms gives the consoles (and their keys).`);
      keys = new Set(found.map((p) => p.key));
    }
    const rankOf = (c: ScoredCandidate) => result.index.get(`${c.platformKey}|${normalizeTitle(c.title)}`)?.rank ?? null;
    const best = (a: ScoredCandidate, b: ScoredCandidate) => b.score - a.score || a.title.localeCompare(b.title);
    let list: { c: ScoredCandidate; rank: number | null }[];
    const words = normalizeTitle(input.query ?? '').split(' ').filter(Boolean);
    if (words.length > 0) {
      // A game's acorns: every wishlist game whose title has the words, on any console (or the ones asked).
      list = [...result.all.values()]
        .filter((c) => (!keys || keys.has(c.platformKey)) && words.every((w) => ` ${normalizeTitle(c.title)} `.includes(` ${w} `)))
        .sort(best)
        .map((c) => ({ c, rank: rankOf(c) }));
    } else if (keys) {
      list = [...keys]
        .flatMap((k) => result.byPlatform.get(k) ?? [])
        .sort(best)
        .map((c) => ({ c, rank: rankOf(c) }));
    } else {
      list = result.master.map((m) => ({ c: m, rank: m.rank }));
    }
    if (input.priority) list = list.filter((x) => x.c.priority === input.priority);
    const offset = input.cursor ? Number(Buffer.from(input.cursor, 'base64url').toString()) || 0 : 0;
    const limit = input.limit ?? 25;
    // The main list mixes consoles and series (0.59.2): each game there is ranked by its acorns minus the variety in the
    // top picks (games of its console or series above it), as the Wishlist page shows.
    const onList = new Map(result.master.map((m) => [`${m.platformKey}|${normalizeTitle(m.title)}`, m]));
    return {
      total: list.length,
      games: list.slice(offset, offset + limit).map(({ c, rank }) => {
        const m = onList.get(`${c.platformKey}|${normalizeTitle(c.title)}`);
        const variety = m ? Math.round(m.consolePenalty + m.franchisePenalty) : 0;
        return {
          ...(rank ? { rank } : {}),
          title: c.title,
          platform: c.platformName,
          platform_key: c.platformKey,
          acorns: Math.round(c.score),
          ...(m ? { list_acorns: Math.round(m.masterScore) } : {}),
          priority: c.priority,
          why: [...whyOf(c), ...(variety > 0 ? [{ reason: 'Variety in the top picks: games of its console or series rank above it', acorns: -variety }] : [])],
        };
      }),
      ...(offset + limit < list.length ? { next_cursor: Buffer.from(String(offset + limit)).toString('base64url') } : {}),
    };
  }

  /** list_platforms: each console with games, its maker, short names and counts; the PC storefronts. */
  platforms(view: AiView) {
    const snap = this.snapshot(view.pc);
    const byKey = new Map<string, { key: string; name: string; games: number; copies: number; sealed: number; complete: number; value_cents: number }>();
    for (const e of snap.entries) {
      if (e.kind !== 'console') continue;
      const p = byKey.get(e.platformKey) ?? { key: e.platformKey, name: e.platform, games: 0, copies: 0, sealed: 0, complete: 0, value_cents: 0 };
      if (e.copies.length > 0) p.games++;
      p.copies += e.copies.length;
      p.sealed += e.copies.filter((c) => c.sealed).length;
      p.complete += e.copies.filter((c) => c.completeness === 'complete').length;
      p.value_cents += e.copies.reduce((n, c) => n + (c.valueCents ?? 0), 0);
      byKey.set(e.platformKey, p);
    }
    const stores = new Map<string, { storefront: string; games: number; owned: number; subscription: number }>();
    for (const e of snap.entries) {
      if (e.kind !== 'pc') continue;
      for (const r of e.family.records) {
        const s = stores.get(r.storefront) ?? { storefront: r.storefront, games: 0, owned: 0, subscription: 0 };
        s.games++;
        if (r.ownership === 'permanent') s.owned++;
        if (r.ownership === 'subscription') s.subscription++;
        stores.set(r.storefront, s);
      }
    }
    const list = [...byKey.values()].filter((p) => p.copies > 0).sort((a, b) => b.copies - a.copies || a.name.localeCompare(b.name));
    return {
      platforms: list.map((p) => ({ ...p, family: platformFamily(p.key, p.name), short_names: PLATFORM_SHORT_NAMES[p.key] ?? [] })),
      pc: view.pc && this.d.pc.enabled() ? { storefronts: [...stores.values()].sort((a, b) => b.games - a.games) } : null,
      totals: { games: list.reduce((n, p) => n + p.games, 0), copies: list.reduce((n, p) => n + p.copies, 0), value_cents: list.reduce((n, p) => n + p.value_cents, 0) },
    };
  }
}

// ---- The tools' schemas (inputs checked by the SDK; outputs described for the app) ----

const entrySummary = z
  .object({
    platform: z.string(),
    platform_key: z.string().optional(),
    title: z.string(),
    edition: z.string().optional(),
    format: z.enum(['physical', 'digital']),
    copies: z.number().optional(),
    sealed: z.number().optional(),
    complete: z.number().optional(),
    loose: z.number().optional(),
    graded: z.number().optional(),
    value_cents: z.number().optional(),
    paid_cents: z.number().optional(),
    storefronts: z.array(z.object({ storefront: z.string(), held: z.string() })).optional(),
    digital_license: z.object({ claimed: z.boolean(), store: z.string().optional(), claimed_at: z.string().optional(), disc_gone: z.boolean() }).optional(),
  })
  .passthrough();

const matchFields = { game_id: z.string(), held: z.enum(['owned', 'subscription', 'previously']), confidence: z.number(), match: z.string(), why: z.string() };

export const SEARCH_INPUT = {
  query: z.string().max(200).optional().describe('Words of the title ("yakuza", "mario kart"). Leave empty to list by the filters alone.'),
  platform: z.string().max(60).optional().describe('A console: its key, name or short name ("PS3", "Xbox 360", "Switch"), or "PC". list_platforms gives them.'),
  format: z.enum(['physical', 'digital']).optional().describe('physical: console copies; digital: the PC library and licenses claimed with discs.'),
  storefront: z.string().max(40).optional().describe('A PC storefront: Steam, Epic, GOG, Xbox, EA, Ubisoft...'),
  condition: z.enum(['sealed', 'complete', 'loose', 'graded']).optional().describe('Only games with a copy in this condition.'),
  limit: z.number().int().min(1).max(50).optional().describe('Games per page (20 unless said, at most 50).'),
  cursor: z.string().max(40).optional().describe('next_cursor from the page before.'),
};
export const SEARCH_OUTPUT = {
  total: z.number(),
  games: z.array(z.object({ id: z.string(), title: z.string(), match: z.object({ confidence: z.number(), kind: z.string(), why: z.string() }).optional(), entries: z.array(entrySummary) })),
  next_cursor: z.string().optional().describe('Give it as cursor for the next page; absent on the last.'),
};

export const CHECK_INPUT = {
  titles: z.array(z.string().min(1).max(200)).min(1).max(50).describe('Up to 50 titles, as written anywhere (a list, a photo, a receipt).'),
  platforms: z.array(z.string().max(60)).max(10).optional().describe('Only these consoles (keys, names or short names, or "PC"); owned elsewhere is said apart.'),
};
export const CHECK_OUTPUT = {
  results: z.array(
    z.object({
      title: z.string(),
      status: z.enum(['owned', 'subscription', 'possible', 'not_owned']),
      matches: z.array(entrySummary.extend(matchFields)),
      near_misses: z.array(entrySummary.extend(matchFields)),
      elsewhere: z.array(entrySummary.extend(matchFields)).optional(),
      wishlist: z.array(z.object({ platform: z.string(), title: z.string(), acorns: z.number(), priority: z.string(), rank: z.number().optional(), why: z.array(z.object({ reason: z.string(), acorns: z.number() })) })).optional(),
    }),
  ),
};

export const GAME_INPUT = { id: z.string().min(3).max(800).describe('A game id from search_games or check_ownership.') };
export const GAME_OUTPUT = { id: z.string(), title: z.string(), entries: z.array(z.object({ platform: z.string(), title: z.string(), format: z.enum(['physical', 'digital']) }).passthrough()) };

export const PLATFORMS_OUTPUT = {
  platforms: z.array(z.object({ key: z.string(), name: z.string(), family: z.string(), short_names: z.array(z.string()), games: z.number(), copies: z.number(), sealed: z.number(), complete: z.number(), value_cents: z.number() })),
  pc: z.object({ storefronts: z.array(z.object({ storefront: z.string(), games: z.number(), owned: z.number(), subscription: z.number() })) }).nullable(),
  totals: z.object({ games: z.number(), copies: z.number(), value_cents: z.number() }),
};

export const WISHLIST_INPUT = {
  query: z.string().max(200).optional().describe('Words of a title, for one game\'s acorns ("halo reach"): every wishlist game with them, on any console (or the one asked).'),
  platform: z.string().max(60).optional().describe('Only this console\'s list: its key, name or short name ("PS3", "Xbox 360", "Switch").'),
  priority: z.enum(['High', 'Medium', 'Low']).optional().describe('Only games of this priority.'),
  limit: z.number().int().min(1).max(100).optional().describe('Games per page (25 unless said, at most 100).'),
  cursor: z.string().max(40).optional().describe('next_cursor from the page before.'),
};
export const WISHLIST_OUTPUT = {
  total: z.number(),
  games: z.array(
    z.object({
      rank: z.number().optional().describe("Its place on the main wishlist; absent for a game only on its console's list."),
      title: z.string(),
      platform: z.string(),
      platform_key: z.string(),
      acorns: z.number().describe('How much the owner wants it: the acorns its rules add up to, 0 to 100 (the most wanted near 100).'),
      list_acorns: z
        .number()
        .optional()
        .describe('On the main list: its acorns minus the variety in the top picks (games of its console or series above it). The main list is ordered by this, so it mixes consoles and series.'),
      priority: z.string(),
      why: z.array(z.object({ reason: z.string(), acorns: z.number() })).describe('The rules that gave (or took) the most acorns.'),
    }),
  ),
  next_cursor: z.string().optional().describe('Give it as cursor for the next page; absent on the last.'),
};

/** The rules that gave a wishlist game the most acorns (or took the most away). */
const whyOf = (c: ScoredCandidate) =>
  [...c.components]
    .filter((x) => Math.round(x.points) !== 0)
    .sort((a, b) => Math.abs(b.points) - Math.abs(a.points))
    .slice(0, 5)
    .map((x) => ({ reason: x.label, acorns: Math.round(x.points) }));

/** The normalized words of a title, for the call log's short "what was asked". */
export const askedOf = (text: string) => normalizeTitle(text).slice(0, 80);
