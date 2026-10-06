import {
  IGDB_GAME_FIELDS,
  igdbDetails,
  igdbGameFromApi,
  igdbGenresFor,
  normalizeTitle,
  pcFamilyKey,
  pcScoringConfig,
  scorePcCandidates,
  toCsv,
  type IgdbGame,
  type PcCandidate,
  type ScoredPcCandidate,
  type SettingsValues,
  type SteamReviews,
} from '@squirrelcade/core';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { appState, pcCandidates, pcControls } from './db/schema.js';
import { APP_VERSION } from './env.js';
import type { FetchLike, IgdbService } from './igdb.js';
import type { PcPrice } from './itad.js';
import type { PcService } from './pc.js';
import type { SettingsService } from './settings.js';
import type { TaskRunner } from './tasks.js';
import type { WishlistService } from './wishlist.js';

/** IGDB's platform number for PC (Windows). */
const IGDB_PC = 6;
/** IGDB game types a PC wishlist game can be: main game, standalone expansion, remake, remaster, expanded game, port. */
const GAME_TYPES = '(0,4,8,9,10,11)';
/** IGDB's external game source for Steam. */
const STEAM = 1;
/** At most this many Steam review summaries per search, one request every 1.1 seconds; each is kept for a month. */
const STEAM_PER_RUN = 300;
const STEAM_MAX_AGE_MS = 30 * 86_400_000;
/**
 * Sealed console games looked up on IGDB per search, at most: those never looked up first, then the oldest
 * answers. Each title's answer (its PC game, or none) is kept for a month, so later searches are quick.
 */
const SEALED_PER_RUN = 1000;
const SEALED_MAX_AGE_MS = 30 * 86_400_000;
/** app_state key: each sealed title's PC game on IGDB (by family key), or null for none, and when it was looked up. */
const SEALED_MEMO = 'pc.wishlist.sealedIds';
/** The series searched: the ones you own the most of. */
const SERIES_PER_RUN = 20;

/** The PC wishlist as the page shows it. */
export interface PcWishlistResult {
  generatedAt: string;
  /** Games found by the last search, and when it ran. */
  found: number;
  searchedAt: string | null;
  /** Found games left out because you own them for good on PC, or hid or snoozed them. */
  owned: number;
  hidden: number;
  items: ScoredPcCandidate[];
}

const quote = (text: string) => `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * The PC wishlist (phase 5): PC games worth buying, found through IGDB and ranked with the console
 * wishlist's points (see pcWishlist.ts in core). A weekly search (Settings > PC library) keeps the found
 * games; the list itself is worked out whenever something it depends on changes.
 */
export class PcWishlistService {
  private cache: { key: string; result: PcWishlistResult } | null = null;
  private revision = 0;
  private genreIds: { genres: Map<string, number>; themes: Map<string, number> } | null = null;

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly pc: PcService,
    private readonly wishlist: WishlistService,
    private readonly igdb: IgdbService,
    private readonly log: Logger,
    private readonly steamFetch: FetchLike = (url, init) => fetch(url, init),
    private readonly steamIntervalMs = 1100,
  ) {}

  /** Forgets the worked-out list (after a search, a choice on a game, or a change to what it's built from). */
  invalidate(): void {
    this.revision++;
    this.cache = null;
  }

  private async ids(): Promise<{ genres: Map<string, number>; themes: Map<string, number> }> {
    if (this.genreIds) return this.genreIds;
    const [genres, themes] = await Promise.all([
      this.igdb.client.query<{ id: number; name: string }>('genres', 'fields id,name; limit 500;'),
      this.igdb.client.query<{ id: number; name: string }>('themes', 'fields id,name; limit 500;'),
    ]);
    this.genreIds = { genres: new Map(genres.map((g) => [g.name.toLowerCase(), g.id])), themes: new Map(themes.map((t) => [t.name.toLowerCase(), t.id])) };
    return this.genreIds;
  }

  /** Owned games per series (normalized): the console collection's IGDB series and the PC library's Playnite series. */
  private ownedInSeries(): Map<string, number> {
    const out = new Map(this.wishlist.tastes().series);
    for (const f of this.pc.families()) {
      if (!f.owned) continue;
      for (const s of f.series) out.set(normalizeTitle(s), (out.get(normalizeTitle(s)) ?? 0) + 1);
    }
    return out;
  }

  /**
   * Searches IGDB for PC games you might want: the best-rated in the genres you score highest, the games
   * of the series you collect most, and the PC versions of console games you keep sealed. Then reads
   * Steam's review summaries (when on) for games that have none or an old one. Replaces the found games.
   */
  async discover(progress?: (text: string) => void): Promise<string> {
    if (!this.igdb.client.configured()) return "IGDB's keys are needed to look for PC games (Settings > Sources).";
    const s = this.settings.all() as SettingsValues;
    const config = pcScoringConfig(s, this.wishlist.learned(s));
    const found = new Map<number, { game: IgdbGame; steamAppId: number | null; sources: Set<string> }>();
    const fields = `${IGDB_GAME_FIELDS},external_games.uid,external_games.external_game_source`;
    const base = `platforms = (${IGDB_PC}) & game_type = ${GAME_TYPES}`;
    const now = Math.floor(Date.now() / 1000);
    const take = (rows: unknown[], source: string) => {
      for (const raw of rows) {
        const game = igdbGameFromApi(raw, IGDB_PC);
        if (!game) continue;
        const ext = ((raw as { external_games?: { uid?: string; external_game_source?: number }[] }).external_games ?? []).find((e) => e.external_game_source === STEAM && /^\d+$/.test(e.uid ?? ''));
        const entry = found.get(game.id) ?? { game, steamAppId: ext ? Number(ext.uid) : null, sources: new Set<string>() };
        entry.sources.add(source);
        found.set(game.id, entry);
      }
    };

    // The genres you score highest (yours, or learned from your collection).
    const ids = await this.ids();
    const genres = Object.entries(config.genrePoints)
      .filter(([, p]) => p > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, s['pc.discoverGenres'])
      .map(([g]) => g);
    for (const [i, g] of genres.entries()) {
      progress?.(`Genre ${g} (${i + 1} of ${genres.length})`);
      const q = igdbGenresFor(g);
      const gi = q.genres.map((n) => ids.genres.get(n.toLowerCase())).filter((x): x is number => x !== undefined);
      const ti = q.themes.map((n) => ids.themes.get(n.toLowerCase())).filter((x): x is number => x !== undefined);
      if (gi.length === 0 && ti.length === 0) continue;
      const by = gi.length > 0 ? `genres = (${gi.join(',')})` : `themes = (${ti.join(',')})`;
      take(await this.igdb.client.query('games', `fields ${fields}; where ${base} & ${by} & total_rating_count >= ${s['pc.minRatings']} & first_release_date < ${now}; sort total_rating desc; limit ${s['pc.discoverPerGenre']};`), `Genre: ${g}`);
    }

    // The series you own the most of.
    const series = [...this.ownedInSeries().entries()].sort((a, b) => b[1] - a[1]).slice(0, SERIES_PER_RUN);
    for (const [i, [name]] of series.entries()) {
      progress?.(`Series ${i + 1} of ${series.length}`);
      const [fr, co] = await Promise.all([
        this.igdb.client.query<{ id: number; name: string }>('franchises', `fields id,name; where name ~ ${quote(name)}; limit 3;`),
        this.igdb.client.query<{ id: number; name: string }>('collections', `fields id,name; where name ~ ${quote(name)}; limit 3;`),
      ]);
      const or = [fr.length > 0 && `franchises = (${fr.map((f) => f.id).join(',')})`, co.length > 0 && `collections = (${co.map((c) => c.id).join(',')})`].filter(Boolean);
      if (or.length === 0) continue;
      const label = fr[0]?.name ?? co[0]?.name ?? name;
      take(await this.igdb.client.query('games', `fields ${fields}; where ${base} & (${or.join(' | ')}) & first_release_date < ${now}; limit 100;`), `Series: ${label}`);
    }

    // The PC versions of console games you keep sealed (the same game by title, editions aside). Titles not
    // looked up yet (or a month ago) are searched; the games of all of them are then read in batches.
    const sealed = this.pc.sealedWithoutPc();
    const memo = this.sealedMemo();
    const stale = (key: string) => !memo[key] || Date.now() - Date.parse(memo[key].at) > SEALED_MAX_AGE_MS;
    const due = sealed
      .filter((g) => stale(g.key))
      .sort((a, b) => (memo[a.key]?.at ?? '').localeCompare(memo[b.key]?.at ?? ''))
      .slice(0, SEALED_PER_RUN);
    for (const [i, g] of due.entries()) {
      if (i % 25 === 0) progress?.(`Sealed games ${i + 1} of ${due.length}`);
      const rows = await this.igdb.client.query<{ id: number; name?: string }>('games', `search ${quote(g.title)}; fields id,name; where ${base}; limit 5;`);
      memo[g.key] = { id: rows.find((r) => pcFamilyKey(r.name ?? '') === g.key)?.id ?? null, at: new Date().toISOString() };
    }
    const sealedKeys = new Set(sealed.map((g) => g.key));
    this.settingState(SEALED_MEMO, JSON.stringify(Object.fromEntries(Object.entries(memo).filter(([k]) => sealedKeys.has(k)))));
    const sealedLabel = new Map<number, string>();
    for (const g of sealed) {
      const id = memo[g.key]?.id;
      if (id) sealedLabel.set(id, `Sealed on ${g.consoles.filter((c) => c.sealed > 0).map((c) => c.platform).join(', ') || 'a console'}`);
    }
    const sealedIds = [...sealedLabel.keys()];
    for (let i = 0; i < sealedIds.length; i += 500) {
      progress?.(`Sealed games' PC versions ${i + 1} of ${sealedIds.length}`);
      const rows = await this.igdb.client.query<{ id: number }>('games', `fields ${fields}; where ${base} & id = (${sealedIds.slice(i, i + 500).join(',')}); limit 500;`);
      for (const r of rows) take([r], sealedLabel.get(r.id) ?? 'Sealed on a console');
    }

    // Keep Steam's summaries already read; replace the found games.
    const old = new Map(this.db.select({ id: pcCandidates.igdbId, steam: pcCandidates.steam, steamAt: pcCandidates.steamAt, foundAt: pcCandidates.foundAt }).from(pcCandidates).all().map((r) => [r.id, r]));
    const at = new Date().toISOString();
    this.db.transaction((tx) => {
      tx.delete(pcCandidates).run();
      for (const [id, f] of found) {
        const was = old.get(id);
        tx.insert(pcCandidates)
          .values({
            igdbId: id,
            familyKey: pcFamilyKey(f.game.name),
            title: f.game.name,
            game: JSON.stringify(f.game),
            steamAppId: f.steamAppId,
            steam: was?.steam ?? null,
            steamAt: was?.steamAt ?? null,
            sources: JSON.stringify([...f.sources]),
            foundAt: was?.foundAt ?? at,
            seenAt: at,
          })
          .run();
      }
    });
    this.settingState('pc.wishlist.searchedAt', at);
    const reviews = s['pc.steamReviews'] ? await this.readSteamReviews(progress) : 0;
    this.invalidate();
    const message = `${found.size} PC games found (${genres.length} genres, ${series.length} series, ${sealed.length} sealed console games, ${due.length} of them looked up)${reviews ? `; ${reviews} Steam review summaries read` : ''}`;
    this.log.info({ context: 'pc' }, `PC wishlist search: ${message}`);
    return message;
  }

  /**
   * Reads Steam's review summary for found games that have none or a month-old one, politely and at most
   * a few hundred at a time: the games ranked highest first, so the top of the list has Steam's reviews.
   */
  private async readSteamReviews(progress?: (text: string) => void): Promise<number> {
    const order = new Map(this.ranked().map((id, i) => [id, i]));
    const due = this.db
      .select({ id: pcCandidates.igdbId, appId: pcCandidates.steamAppId, steamAt: pcCandidates.steamAt })
      .from(pcCandidates)
      .all()
      .filter((r) => r.appId !== null && (!r.steamAt || Date.now() - Date.parse(r.steamAt) > STEAM_MAX_AGE_MS))
      .sort((a, b) => (order.get(a.id) ?? Infinity) - (order.get(b.id) ?? Infinity))
      .slice(0, STEAM_PER_RUN);
    let read = 0;
    for (const [i, r] of due.entries()) {
      if (i % 25 === 0) progress?.(`Steam reviews ${i + 1} of ${due.length}`);
      try {
        const res = await this.steamFetch(`https://store.steampowered.com/appreviews/${r.appId}?json=1&language=all&purchase_type=all&num_per_page=0&filter=summary`, {
          headers: { 'User-Agent': `Squirrelcade/${APP_VERSION} (+https://github.com/squirrelcade/squirrelcade; self-hosted)` },
        });
        if (res.ok) {
          const body = (await res.json()) as { success?: number; query_summary?: { total_positive?: number; total_reviews?: number; review_score_desc?: string } };
          const q = body.query_summary;
          if (body.success === 1 && q && typeof q.total_reviews === 'number') {
            const steam: SteamReviews = { percent: q.total_reviews > 0 ? Math.round(((q.total_positive ?? 0) / q.total_reviews) * 100) : 0, total: q.total_reviews, summary: q.review_score_desc ?? '' };
            this.db.update(pcCandidates).set({ steam: JSON.stringify(steam), steamAt: new Date().toISOString() }).where(eq(pcCandidates.igdbId, r.id)).run();
            read++;
          }
        }
      } catch (err) {
        this.log.warn({ context: 'pc', err }, `Steam's reviews couldn't be read for app ${r.appId}`);
      }
      if (this.steamIntervalMs > 0) await new Promise((done) => setTimeout(done, this.steamIntervalMs));
    }
    return read;
  }

  /** Each sealed title's PC game on IGDB as last looked up (see SEALED_MEMO). */
  private sealedMemo(): Record<string, { id: number | null; at: string }> {
    const text = this.settingState(SEALED_MEMO, null);
    return text ? (JSON.parse(text) as Record<string, { id: number | null; at: string }>) : {};
  }

  /** A small value kept in app_state (not a setting: nothing to choose), set when given, and read. */
  private settingState(key: string, value: string | null): string | null {
    if (value !== null) this.db.insert(appState).values({ key, value }).onConflictDoUpdate({ target: appState.key, set: { value } }).run();
    return this.db.select().from(appState).where(eq(appState.key, key)).get()?.value ?? null;
  }

  /** Every found game's IGDB id, best-ranked first (the whole ranking, not just the list's size). */
  private ranked(): number[] {
    const s = this.settings.all() as SettingsValues;
    const { candidates } = this.candidates();
    const config = { ...pcScoringConfig(s, this.wishlist.learned(s)), size: candidates.length };
    return scorePcCandidates(candidates, config, { ownedInSeries: this.ownedInSeries() }).map((c) => c.igdbId);
  }

  /** The found games that can be on the list (not owned for good on PC, not hidden or snoozed), one per title family, and the counts left out. */
  private candidates(): { candidates: PcCandidate[]; found: number; owned: number; hidden: number } {
    const today = new Date().toISOString().slice(0, 10);
    const controls = new Map(this.db.select().from(pcControls).all().map((c) => [c.familyKey, c]));
    const sealed = new Map(this.pc.sealedWithoutPc().map((g) => [g.key, g.consoles.filter((c) => c.sealed > 0).map((c) => c.platform)]));
    const rows = this.db.select().from(pcCandidates).all();
    let owned = 0;
    let hidden = 0;
    // One game per title family: the best-rated IGDB entry when several share it (an original and its remaster).
    const byFamily = new Map<string, PcCandidate>();
    for (const r of rows) {
      const family = this.pc.familyOf(r.title);
      if (family?.owned) {
        owned++;
        continue;
      }
      const c = controls.get(r.familyKey);
      if (c?.action === 'hide' || (c?.action === 'defer' && (c.until ?? '') >= today)) {
        hidden++;
        continue;
      }
      const game = JSON.parse(r.game) as IgdbGame;
      const subscription = family ? [...new Set(family.records.filter((x) => x.ownership === 'subscription').map((x) => x.storefront))] : [];
      const candidate: PcCandidate = {
        key: r.familyKey,
        title: r.title,
        igdbId: r.igdbId,
        details: igdbDetails(game),
        released: game.released,
        coverId: game.coverId,
        steamAppId: r.steamAppId,
        steam: r.steam ? (JSON.parse(r.steam) as SteamReviews) : null,
        sources: JSON.parse(r.sources) as string[],
        sealedOn: sealed.get(r.familyKey),
        subscription: subscription.length > 0 ? subscription : undefined,
        preference: c?.preference ?? undefined,
      };
      const kept = byFamily.get(r.familyKey);
      if (!kept || (candidate.details.ratingCount ?? 0) > (kept.details.ratingCount ?? 0)) byFamily.set(r.familyKey, candidate);
    }
    return { candidates: [...byFamily.values()], found: rows.length, owned, hidden };
  }

  /** The PC wishlist: the found games you don't own for good on PC and haven't hidden or snoozed, scored and ranked. */
  compute(): PcWishlistResult {
    const s = this.settings.all() as SettingsValues;
    const key = `${this.revision}|${JSON.stringify(Object.entries(s).filter(([k]) => k.startsWith('wishlist.') || k.startsWith('pc.')))}`;
    if (this.cache?.key === key) return this.cache.result;
    const { candidates, found, owned, hidden } = this.candidates();
    const config = pcScoringConfig(s, this.wishlist.learned(s));
    const items = scorePcCandidates(candidates, config, { ownedInSeries: this.ownedInSeries() });
    const result: PcWishlistResult = { generatedAt: new Date().toISOString(), found, searchedAt: this.settingState('pc.wishlist.searchedAt', null), owned, hidden, items };
    this.cache = { key, result };
    return result;
  }

  /** Hides a game, snoozes it until a date, or sets a preference (null clears it). False for a game the search didn't find. */
  setControl(familyKey: string, change: { action?: 'hide' | 'defer' | null; until?: string | null; preference?: string | null }): boolean {
    const found = this.db.select({ title: pcCandidates.title }).from(pcCandidates).where(eq(pcCandidates.familyKey, familyKey)).get();
    const current = this.db.select().from(pcControls).where(eq(pcControls.familyKey, familyKey)).get();
    if (!found && !current) return false;
    const next = {
      title: current?.title ?? found!.title,
      action: change.action === undefined ? (current?.action ?? null) : change.action,
      until: change.until === undefined ? (current?.until ?? null) : change.until,
      preference: change.preference === undefined ? (current?.preference ?? null) : change.preference,
      updatedAt: new Date().toISOString(),
    };
    if (!next.action && !next.preference) this.db.delete(pcControls).where(eq(pcControls.familyKey, familyKey)).run();
    else this.db.insert(pcControls).values({ familyKey, ...next }).onConflictDoUpdate({ target: pcControls.familyKey, set: next }).run();
    this.invalidate();
    return true;
  }

  /** Games you hid or snoozed, to bring back. */
  hiddenGames() {
    return this.db.select().from(pcControls).where(sql`${pcControls.action} is not null`).all();
  }
}

/**
 * The PC wishlist's API: the list, a new search, a CSV, and the owner's choices on a game. With PC game prices on,
 * each game carries its price (null before it's read), and pricesOn says so.
 */
export function registerPcWishlistRoutes(app: FastifyInstance, pcWishlist: PcWishlistService, tasks: TaskRunner, prices: () => Map<string, PcPrice> | null = () => null): void {
  app.get('/api/v1/pc/wishlist', async () => {
    const result = pcWishlist.compute();
    const known = prices();
    if (!known) return { ...result, pricesOn: false };
    return { ...result, pricesOn: true, items: result.items.map((i) => ({ ...i, price: known.get(i.key) ?? null })) };
  });

  app.get('/api/v1/pc/wishlist/hidden', async () => pcWishlist.hiddenGames());

  /** Searches for PC games now, in the background. */
  app.post('/api/v1/pc/wishlist/discover', async (_request, reply) => {
    tasks.enqueue('pc-discover');
    return reply.code(202).send({ queued: true });
  });

  app.get('/api/v1/pc/wishlist/export', async (_request, reply) => {
    const known = prices();
    const money = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2));
    const rows = pcWishlist.compute().items.map((c) => [
      c.rank,
      c.title,
      c.score,
      c.priority,
      c.steam ? `${c.steam.percent}% (${c.steam.total})` : '',
      (c.details.genres ?? []).join(', '),
      c.sources.join('; '),
      c.steamAppId ? `https://store.steampowered.com/app/${c.steamAppId}/` : '',
      c.components.map((x) => `${x.label} ${x.points >= 0 ? '+' : ''}${x.points}`).join('; '),
      ...(known ? [money(known.get(c.key)?.currentCents), money(known.get(c.key)?.lowCents), known.get(c.key)?.shop ?? ''] : []),
    ]);
    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="pc-wishlist.csv"')
      .send(toCsv([['Rank', 'Game', 'Acorns', 'Priority', 'Steam reviews', 'Genres', 'Found by', 'Steam', 'Where the acorns come from', ...(known ? ['Best price now', 'Lowest ever', 'Store'] : [])], ...rows]));
  });

  /** { action?: "hide" | "defer" | null, until?: "YYYY-MM-DD" | null, preference?: string | null } */
  app.put('/api/v1/pc/wishlist/:key', async (request, reply) => {
    const b = (request.body ?? {}) as { action?: unknown; until?: unknown; preference?: unknown };
    const action = b.action === null || b.action === 'hide' || b.action === 'defer' ? b.action : undefined;
    if (b.action !== undefined && action === undefined) return reply.code(400).send({ error: 'invalid', message: 'action must be hide, defer or null.' });
    const until = typeof b.until === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.until) ? b.until : b.until === null ? null : undefined;
    const preference = typeof b.preference === 'string' ? b.preference.slice(0, 100) : b.preference === null ? null : undefined;
    if (!pcWishlist.setControl(decodeURIComponent((request.params as { key: string }).key), { action, until, preference })) return reply.code(404).send({ error: 'not-found', message: 'No such PC wishlist game.' });
    return { ok: true };
  });
}
