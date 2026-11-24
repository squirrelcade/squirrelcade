import { baseTitle, findPlatforms, normalizeTitle, KNOWN_PLATFORMS, markOrder, markSvg, matchKey, numbersDiffer, priceChartingUrl, readListing, surenessOf, type ListingFlag, type Sureness } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import { AiToolError, type AiTools, type AiView } from './aiTools.js';
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
  ) {}

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
    return items.map((item) => {
      const read = readListing(item.title, KNOWN_PLATFORMS, item.platform);
      const known = read.platformKey ? KNOWN_PLATFORMS.find((p) => p.key === read.platformKey) ?? null : null;
      const r = this.ask(read.title, known?.name ?? null);
      const result = r.result;
      const filtered = r.filtered;
      const owned = result.matches.filter((m) => m.held === 'owned');
      const elsewhere = (result.elsewhere ?? []).filter((m) => m.held === 'owned');
      const best = owned[0] ?? result.matches[0] ?? null;
      // A near miss with other numbers is another game of the series ("WWE 2K25" for "WWE 2K26"), not this one.
      const near = result.near_misses.find((m) => !numbersDiffer(read.title, m.title)) ?? null;
      const answer: DealCheckAnswer['answer'] = owned.length > 0 ? 'own' : elsewhere.length > 0 ? 'elsewhere' : near ? 'maybe' : 'need';
      const sure = surenessOf({ owned: owned.length > 0, confidence: best?.confidence ?? null, nearMiss: near?.confidence ?? null, consoleKnown: filtered, sureAt, unsureAt });
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
        why: whyOf(answer, sure, best, near, read.platformFrom, filtered, ownedOn),
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
}
