import { baseTitle, findPlatforms, normalizeTitle, KNOWN_PLATFORMS, markOrder, markSvg, matchKey, numbersDiffer, priceChartingUrl, readListing, surenessOf, type ListingFlag, type Sureness } from '@squirrelcade/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { AiToolError, type AiTools, type AiView } from './aiTools.js';
import type { Db } from './db/index.js';
import { appState } from './db/schema.js';
import type { MarksService } from './marks.js';
import type { OnTheWay } from './orders.js';
import type { SettingsService } from './settings.js';
import type { WishlistService } from './wishlist.js';

/**
 * Deal check (D245): the titles on a store's page (sent by the browser extension when the owner presses its button),
 * each read into its game and console and answered from the collection: whether the owner has it, how sure that is
 * (green, yellow, red), its acorns when it's on the wishlist, what their copy is worth, and where to see its prices.
 * It reads only what it's sent; nothing is fetched from the store or from PriceCharting.
 */

/** At most this many listings in one check (a store's page of results). */
export const DEAL_CHECK_MAX = 50;

/** app_state key: the owner's corrections, by the listing's words (normalized). */
const CORRECTIONS = 'deal-check.corrections';

/**
 * What the owner said a listing is, from the extension's "Wrong game?" (2026-11-24): a game (its console and title as
 * Squirrelcade knows them), not a game at all, or a lot of several. Every later check of the same words uses it.
 */
export interface DealCheckCorrection {
  /** The listing's words as the store showed them. */
  listing: string;
  kind: 'game' | 'not-game' | 'lot';
  platformKey: string | null;
  title: string | null;
  /** What Squirrelcade had read it as before. */
  wasTitle: string | null;
  wasPlatformKey: string | null;
  at: string;
}

const correctionKey = (listing: string) => normalizeTitle(listing);

export interface DealCheckItem {
  /** The listing's title as the store shows it. */
  title: string;
  /** A console the page names around the listing, when the title doesn't. */
  platform?: string | null;
}

export interface DealCheckAnswer {
  /** The listing's title as sent. */
  listing: string;
  /** The game's title read from it. */
  title: string;
  platformKey: string | null;
  platform: string | null;
  /** own: on this console (or anywhere, without one); elsewhere: on another console or PC; maybe: only near misses; need: not at all. */
  answer: 'own' | 'elsewhere' | 'maybe' | 'need';
  sure: Sureness;
  /** Why it's as sure as it is, for the dot's hover text. */
  why: string;
  /** The game of the owner's it matched (or came closest to), with the match's confidence (0 to 1). */
  match: { title: string; platform: string; confidence: number; gameId: string } | null;
  /** The other consoles (and PC) they have it on. */
  ownedOn: string[];
  /** What their copy on this console is worth (PriceCharting, their last export). */
  valueCents: number | null;
  /** Its place on the wishlist on this console (or its best, without one). */
  wishlist: { acorns: number; priority: string; rank: number | null; platform: string } | null;
  flags: ListingFlag[];
  priceChartingUrl: string;
  /** The chest: filled (yours on this console), coming (on its way to you: soft red), half (yours on another console or PC) or grey. */
  chest: 'own' | 'coming' | 'elsewhere' | 'none';
  /** The order it's on, when the game is on On the way on this console. */
  onTheWay: { store: string; orderDate: string | null; paidCents: number | null } | null;
  /** Every console the game came out on (and those you have it on), newest first, PC last: in color where it's yours. */
  marks: { key: string; name: string; owned: boolean; svg: string }[];
  /** The game to open in the drawer (its console and title as Squirrelcade knows them), when there's one. */
  drawer: { platformKey: string; title: string } | null;
  /** Where your preference for it is kept (PUT /api/v1/wishlist/preferences), and what it is: for a game you don't have there. */
  preference: { platformKey: string; title: string; value: string | null } | null;
  /** What you told Squirrelcade this listing is ("Wrong game?"), when you did. */
  corrected: { kind: DealCheckCorrection['kind']; platformKey: string | null; title: string | null } | null;
}

/** A deal check's answer: the listings', and the preferences you can give a game (with the acorns each adds). */
export interface DealCheckResponse {
  results: DealCheckAnswer[];
  preferences: { name: string; acorns: number | null }[];
}

/** The owner's view of the collection, without prices paid or notes (the page shows neither). */
const OWNER_VIEW: AiView = { paid: false, notes: false, pc: true, play: true, details: true };

type CheckResult = ReturnType<AiTools['check']>['results'][number];

export class DealCheckService {
  constructor(
    private readonly tools: AiTools,
    private readonly settings: SettingsService,
    private readonly wishlist?: WishlistService,
    private readonly marks?: MarksService,
    /** On the way's games, by "platform key|normalized title" (Store Mode's index). */
    private readonly coming?: () => Map<string, OnTheWay>,
    /** Where the owner's corrections are kept (none without it). */
    private readonly db?: Db,
  ) {}

  /** Every correction, newest first. */
  corrections(): DealCheckCorrection[] {
    return Object.values(this.correctionMap()).sort((a, b) => b.at.localeCompare(a.at));
  }

  /** Keeps what the owner said a listing is (replacing what they said before about the same words). */
  correct(c: Omit<DealCheckCorrection, 'at'>): DealCheckCorrection {
    const all = this.correctionMap();
    const saved: DealCheckCorrection = { ...c, at: new Date().toISOString() };
    all[correctionKey(c.listing)] = saved;
    this.saveCorrections(all);
    return saved;
  }

  /** Forgets a correction; false when there was none. */
  uncorrect(listing: string): boolean {
    const all = this.correctionMap();
    const key = correctionKey(listing);
    if (!(key in all)) return false;
    delete all[key];
    this.saveCorrections(all);
    return true;
  }

  private correctionMap(): Record<string, DealCheckCorrection> {
    if (!this.db) return {};
    const row = this.db.select().from(appState).where(eq(appState.key, CORRECTIONS)).get();
    return row ? (JSON.parse(row.value) as Record<string, DealCheckCorrection>) : {};
  }

  private saveCorrections(all: Record<string, DealCheckCorrection>): void {
    if (!this.db) throw new Error('Corrections need the database.');
    const value = JSON.stringify(all);
    this.db.insert(appState).values({ key: CORRECTIONS, value }).onConflictDoUpdate({ target: appState.key, set: { value } }).run();
  }

  /** The preferences a game can have, best first, with the acorns each adds (Do Not Recommend keeps it off the wishlist). */
  preferences(): DealCheckResponse['preferences'] {
    const points = this.settings.get('wishlist.preferencePoints') as Record<string, number>;
    return [
      ...Object.entries(points)
        .sort((a, b) => b[1] - a[1])
        .map(([name, acorns]) => ({ name, acorns })),
      { name: 'Do Not Recommend', acorns: null },
    ];
  }

  async check(items: readonly DealCheckItem[]): Promise<DealCheckAnswer[]> {
    const answers = this.answer(items);
    if (!this.marks) return answers.map((a) => a.answer);
    // The consoles each game came out on, asked for all the listings at once.
    const keyOf = (a: (typeof answers)[number]) => matchKey(baseTitle(a.markTitle));
    const released = await this.marks.released([...new Set(answers.map(keyOf))]);
    const owned = this.marks.owned(true);
    return answers.map((a) => {
      const key = keyOf(a);
      const mine = new Set([...(owned[key] ?? []), ...(a.answer.answer === 'own' && a.answer.platformKey ? [a.answer.platformKey] : [])]);
      const all = markOrder([...(released[key] ?? []), ...mine, ...(a.answer.platformKey ? [a.answer.platformKey] : [])]);
      const nameOf = (k: string) => (k === 'pc' ? 'PC' : (KNOWN_PLATFORMS.find((p) => p.key === k)?.name ?? k));
      return { ...a.answer, marks: all.map((k) => ({ key: k, name: nameOf(k), owned: mine.has(k), svg: markSvg(k, nameOf(k), mine.has(k)) })) };
    });
  }

  private answer(items: readonly DealCheckItem[]): { answer: DealCheckAnswer; markTitle: string }[] {
    const sureAt = this.settings.get('dealCheck.sureAt') / 100;
    const unsureAt = this.settings.get('dealCheck.unsureAt') / 100;
    const corrections = this.correctionMap();
    return items.map((item) => {
      const fix = corrections[correctionKey(item.title)] ?? null;
      const corrected = fix ? { kind: fix.kind, platformKey: fix.platformKey, title: fix.title } : null;
      const first = readListing(item.title, KNOWN_PLATFORMS, item.platform);
      // You said which game it is: that game, on that console, whatever the words say.
      const read = fix?.kind === 'game' && fix.title ? { ...first, title: fix.title, platformKey: fix.platformKey ?? first.platformKey, platformFrom: 'title' as const } : first;
      const known = read.platformKey ? KNOWN_PLATFORMS.find((p) => p.key === read.platformKey) ?? null : null;
      if (fix && fix.kind !== 'game') return { answer: notOneGame(item.title, read, known, fix.kind, corrected), markTitle: read.title };
      const r = this.ask(read.title, known?.name ?? null);
      const result = r.result;
      const filtered = r.filtered;
      let owned = result.matches.filter((m) => m.held === 'owned');
      const elsewhere = (result.elsewhere ?? []).filter((m) => m.held === 'owned');
      // A near miss with other numbers is another game of the series ("WWE 2K25" for "WWE 2K26"), not this one.
      let near = result.near_misses.find((m) => !numbersDiffer(read.title, m.title)) ?? null;
      // The listing is the start of your game's name and the rest is only its subtitle or edition ("Tiger Woods PGA Tour
      // 12" for your "Tiger Woods PGA Tour 12: The Masters"), on this console: yours, pretty sure. "Halo" isn't "Halo 3".
      const stem = owned.length === 0 && filtered && near && near.held === 'owned' && (subtitleOf(read.title, near.title) || sameWords(read.title, near.title));
      if (stem && near) {
        owned = [near];
        near = null;
      }
      const best = owned[0] ?? result.matches[0] ?? null;
      const answer: DealCheckAnswer['answer'] = owned.length > 0 ? 'own' : elsewhere.length > 0 ? 'elsewhere' : near ? 'maybe' : 'need';
      const sure = fix ? 'sure' : stem ? 'likely' : surenessOf({ owned: owned.length > 0, confidence: best?.confidence ?? null, nearMiss: near?.confidence ?? null, consoleKnown: filtered, sureAt, unsureAt });
      const shown = best ?? near ?? elsewhere[0] ?? null;
      const ownedOn = [...new Set([...owned, ...elsewhere].map((m) => m.platform).filter((p) => p !== known?.name))];
      const valueCents = owned.reduce<number | null>((n, m) => ('value_cents' in m && typeof m.value_cents === 'number' ? (n ?? 0) + m.value_cents : n), null);
      const wish = answer === 'own' ? null : this.wishOf(result, known);
      // The drawer opens your copy's game, or the wishlist's (its catalog title), or what the listing says.
      const consoleMatch = [...owned, ...elsewhere].find((m) => 'platform_key' in m && typeof m.platform_key === 'string') as { platform_key: string; title: string } | undefined;
      const drawer = consoleMatch
        ? { platformKey: consoleMatch.platform_key, title: consoleMatch.title }
        : wish && known
          ? { platformKey: known.key, title: wish.title }
          : known
            ? { platformKey: known.key, title: read.title }
            : null;
      const prefTitle = wish?.title ?? read.title;
      const preference = answer !== 'own' && known ? { platformKey: known.key, title: prefTitle, value: this.wishlist?.preferenceOf(known.key, prefTitle) ?? null } : null;
      // On its way to you: by the game the drawer opens, the wishlist's title or the listing's, on this console.
      const way = answer !== 'own' && known ? this.onTheWay(known.key, [drawer?.title, wish?.title, read.title]) : null;
      const chest: DealCheckAnswer['chest'] = answer === 'own' ? 'own' : way ? 'coming' : answer === 'elsewhere' ? 'elsewhere' : 'none';
      const out: DealCheckAnswer = {
        listing: item.title,
        title: read.title,
        platformKey: read.platformKey,
        platform: known?.name ?? null,
        answer,
        sure,
        why: stem && best ? `Pretty sure: ${subtitleOf(read.title, best.title) ? `the listing is the start of your ${best.title} (${best.platform}), whose name goes on with its subtitle` : `the listing has the same words as your ${best.title} (${best.platform})`}.` : fix ? `You told Squirrelcade this is ${read.title}${known ? ` (${known.name})` : ''}; ${whyOf(answer, sure, best, near, read.platformFrom, filtered, ownedOn).replace(/^[^:]+: /, '')}` : whyOf(answer, sure, best, near, read.platformFrom, filtered, ownedOn),
        match: shown ? { title: shown.title, platform: shown.platform, confidence: shown.confidence, gameId: shown.game_id } : null,
        ownedOn,
        valueCents,
        wishlist: wish ? { acorns: wish.acorns, priority: wish.priority, rank: wish.rank, platform: wish.platform } : null,
        flags: read.flags,
        priceChartingUrl: priceChartingUrl(read.title, known?.name ?? ''),
        chest,
        marks: [],
        drawer,
        preference,
        onTheWay: way,
        corrected,
      };
      return { answer: out, markTitle: shown?.title ?? read.title };
    });
  }

  /** check_ownership for one title, on its console when the collection has that console; else anywhere. */
  private ask(title: string, platform: string | null): { result: CheckResult; filtered: boolean } {
    if (platform) {
      try {
        return { result: this.tools.check({ titles: [title], platforms: [platform] }, OWNER_VIEW).results[0]!, filtered: true };
      } catch (e) {
        // A console with none of the owner's games: everything they have of it is "elsewhere", so ask without it.
        if (!(e instanceof AiToolError)) throw e;
        const result = this.tools.check({ titles: [title] }, OWNER_VIEW).results[0]!;
        return { result: { ...result, elsewhere: result.matches, matches: [] }, filtered: true };
      }
    }
    return { result: this.tools.check({ titles: [title] }, OWNER_VIEW).results[0]!, filtered: false };
  }

  private comingIndex: Map<string, OnTheWay> | null = null;
  private comingAt = 0;
  /** The order a game is on, on On the way (the index read at most once every 30 seconds). */
  private onTheWay(platformKey: string, titles: (string | null | undefined)[]): DealCheckAnswer['onTheWay'] {
    if (!this.coming) return null;
    if (!this.comingIndex || Date.now() - this.comingAt > 30_000) {
      this.comingIndex = this.coming();
      this.comingAt = Date.now();
    }
    for (const t of titles) {
      const hit = t ? this.comingIndex.get(`${platformKey}|${normalizeTitle(t)}`) : undefined;
      if (hit) return { store: hit.store, orderDate: hit.orderDate, paidCents: hit.paidCents };
    }
    return null;
  }

  /** The wishlist's place on the listing's console, or the best one without a console. */
  private wishOf(result: CheckResult, known: { key: string; name: string } | null): { acorns: number; priority: string; rank: number | null; platform: string; title: string } | null {
    const wishes = result.wishlist ?? [];
    const pick = known ? wishes.find((w) => findPlatforms(w.platform, [known]).length > 0) : wishes[0];
    return pick ? { acorns: pick.acorns, priority: pick.priority, rank: pick.rank ?? null, platform: pick.platform, title: pick.title } : null;
  }
}

/** Words that don't make one game's name another's ("Grand Theft Auto: Trilogy - The Definitive Edition" is your "Grand Theft Auto: The Trilogy [Definitive Edition]"). */
const SMALL_WORDS = new Set(['the', 'a', 'an', 'of', 'and']);

/** True when the two names have the same words, leaving out "the", "a", "of", "and" and punctuation (order aside). */
export function sameWords(listing: string, mine: string): boolean {
  const words = (t: string) => t.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !SMALL_WORDS.has(w)).sort().join(' ');
  const a = words(listing);
  return a.split(' ').length >= 2 && a === words(mine);
}

/** True when `mine` is `listing` and then only a subtitle or edition: after a colon, a dash or a bracket. */
export function subtitleOf(listing: string, mine: string): boolean {
  const a = listing.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (a.split(' ').length < 2) return false;
  const words = a.split(' ');
  // Walk mine's words alongside the listing's, then look at what comes right after the last one in mine's own text.
  // The words are only letters and digits, so they go into the pattern as they are.
  const re = new RegExp(`^[^a-z0-9]*${words.join('[^a-z0-9]+')}(?![a-z0-9])`, 'i');
  const m = re.exec(mine);
  if (!m) return false;
  const rest = mine.slice(m[0].length);
  return /^\s*(?::|[-–—]\s|\[|\()/.test(rest) && rest.replace(/[^a-z0-9]/gi, '').length > 0;
}

/** A listing you said isn't one game: not a game at all (left out), or a lot (to look at yourself). */
function notOneGame(
  listing: string,
  read: { title: string; platformKey: string | null; flags: ListingFlag[] },
  known: { key: string; name: string } | null,
  kind: 'not-game' | 'lot',
  corrected: DealCheckAnswer['corrected'],
): DealCheckAnswer {
  return {
    listing,
    title: read.title,
    platformKey: read.platformKey,
    platform: known?.name ?? null,
    answer: kind === 'lot' ? 'maybe' : 'need',
    sure: kind === 'lot' ? 'unsure' : 'sure',
    why: kind === 'lot' ? 'You told Squirrelcade this is a lot of several games: look at which ones yourself.' : 'You told Squirrelcade this isn’t a game.',
    match: null,
    ownedOn: [],
    valueCents: null,
    wishlist: null,
    flags: read.flags,
    priceChartingUrl: priceChartingUrl(read.title, known?.name ?? ''),
    chest: 'none',
    onTheWay: null,
    marks: [],
    drawer: null,
    preference: null,
    corrected,
  };
}

function whyOf(
  answer: DealCheckAnswer['answer'],
  sure: Sureness,
  best: { title: string; platform: string; why: string; confidence: number } | null,
  near: { title: string; platform: string; why: string; confidence: number } | null,
  platformFrom: 'title' | 'hint' | null,
  filtered: boolean,
  ownedOn: string[],
): string {
  const lead = sure === 'sure' ? 'Sure' : sure === 'likely' ? 'Pretty sure' : 'Not sure';
  const parts: string[] = [];
  if (answer === 'own' && best) parts.push(`matched your ${best.title} (${best.platform}): ${best.why.toLowerCase()}`);
  else if (answer === 'elsewhere') parts.push(`you have it on ${ownedOn.join(', ')}, not this console`);
  else if (near) parts.push(`you have ${near.title} (${near.platform}), which is close: ${near.why.toLowerCase()}`);
  else parts.push('nothing of yours comes close');
  if (!filtered) parts.push('the listing names no console');
  else if (platformFrom === 'hint') parts.push('the console came from the page, not the title');
  return `${lead}: ${parts.join('; ')}.`;
}

function parseItems(body: unknown): DealCheckItem[] | null {
  const items = (body as { items?: unknown } | null)?.items;
  if (!Array.isArray(items) || items.length === 0 || items.length > DEAL_CHECK_MAX) return null;
  const out: DealCheckItem[] = [];
  for (const i of items as { title?: unknown; platform?: unknown }[]) {
    if (!i || typeof i.title !== 'string' || !i.title.trim() || i.title.length > 400) return null;
    if (i.platform !== undefined && i.platform !== null && (typeof i.platform !== 'string' || i.platform.length > 100)) return null;
    out.push({ title: i.title.trim(), platform: (i.platform as string | null | undefined) ?? null });
  }
  return out;
}

export function registerDealCheckRoutes(app: FastifyInstance, deals: DealCheckService): void {
  app.post('/api/v1/deal-check', async (request, reply) => {
    const items = parseItems(request.body);
    if (!items) return reply.code(400).send({ error: `Send {"items": [{"title": "...", "platform": "..."}]}, 1 to ${DEAL_CHECK_MAX} of them.` });
    const response: DealCheckResponse = { results: await deals.check(items), preferences: deals.preferences() };
    return response;
  });

  app.get('/api/v1/deal-check/corrections', async () => ({ corrections: deals.corrections() }));

  app.post('/api/v1/deal-check/corrections', async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() && v.length <= max ? v.trim() : null);
    const listing = text(b.listing, 400);
    const kind = b.kind === 'game' || b.kind === 'not-game' || b.kind === 'lot' ? b.kind : null;
    const title = text(b.title, 300);
    const platformKey = text(b.platformKey, 60);
    if (!listing || !kind) return reply.code(400).send({ error: 'Send {"listing": "...", "kind": "game" | "not-game" | "lot"}, with "title" and "platformKey" for a game.' });
    if (kind === 'game' && !title) return reply.code(400).send({ error: 'Which game? Send its "title" (and "platformKey").' });
    if (platformKey && !KNOWN_PLATFORMS.some((p) => p.key === platformKey)) return reply.code(400).send({ error: `No console "${platformKey}".` });
    const correction = deals.correct({
      listing,
      kind,
      title: kind === 'game' ? title : null,
      platformKey: kind === 'game' ? platformKey : null,
      wasTitle: text(b.wasTitle, 300),
      wasPlatformKey: text(b.wasPlatformKey, 60),
    });
    return { correction };
  });

  app.delete('/api/v1/deal-check/corrections', async (request, reply) => {
    const listing = (request.query as { listing?: string }).listing;
    if (!listing) return reply.code(400).send({ error: 'Which listing? ?listing=...' });
    return deals.uncorrect(listing) ? { removed: true } : reply.code(404).send({ error: 'No correction for that listing.' });
  });
}
