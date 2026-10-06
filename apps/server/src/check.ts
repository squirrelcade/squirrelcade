import { priceChartingBarcodeUrl, priceChartingUrl, shopLinksFor, SHOPS_IN_LISTS, shopUrl } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import type { LookupResult, LookupService } from './lookup.js';
import type { SettingsService } from './settings.js';

/**
 * Checking a game without signing in (Settings > Security, off by default): for someone shopping for the owner,
 * the sign-in page scans a barcode or takes a title and answers whether the owner has the game or needs it. It
 * tells only that: the title, console and cover, the answer, the wishlist's priority for a game the owner needs,
 * links to its prices, and (a setting) what an owned copy is worth. Never notes, prices paid or anything else, and
 * no more than Settings > Security > "Checks per 10 minutes" from one address.
 */

/** The answer to someone who isn't signed in. */
export interface CheckAnswer {
  platformKey: string;
  platform: string;
  title: string;
  /** own: they have it; elsewhere: on another console; need: they don't have it; maybe: something like it; not-collected. */
  answer: 'own' | 'elsewhere' | 'need' | 'maybe' | 'not-collected';
  /** The other consoles they have it on. */
  ownedOn: string[];
  coverId: string | null;
  /** What their copy is worth (PriceCharting, their last export), when that's shown. */
  valueCents: number | null;
  /** The wishlist's priority, for a game they need that's on it. */
  wishlist: { priority: string; rank: number | null } | null;
  /**
   * Where to see what it sells for: PriceCharting and the shop links for its console. For the game a scanned
   * barcode is, PriceCharting's link goes by the barcode, straight to that edition's prices.
   */
  links: { name: string; url: string }[];
}

const ANSWERS: Record<LookupResult['answer'], CheckAnswer['answer']> = {
  own: 'own',
  'own-not-in-catalog': 'own',
  'own-elsewhere': 'elsewhere',
  need: 'need',
  unconfirmed: 'need',
  check: 'maybe',
  'not-a-target': 'not-collected',
  'not-tracked': 'not-collected',
};

/** At most this many games answer one check. */
const MAX_RESULTS = 5;
const WINDOW_MS = 10 * 60_000;

export function registerCheckRoutes(app: FastifyInstance, lookup: LookupService, settings: SettingsService): void {
  // Each address's checks in the last 10 minutes.
  const recent = new Map<string, number[]>();
  const allow = (address: string): boolean => {
    const now = Date.now();
    const times = (recent.get(address) ?? []).filter((t) => now - t < WINDOW_MS);
    if (times.length >= settings.get('security.publicCheckLimit')) {
      recent.set(address, times);
      return false;
    }
    times.push(now);
    recent.set(address, times);
    if (recent.size > 5000) for (const [key, list] of recent) if (list.every((t) => now - t >= WINDOW_MS)) recent.delete(key);
    return true;
  };

  const answer = (r: LookupResult, barcode?: string): CheckAnswer => {
    const kind = ANSWERS[r.answer];
    const wanted = kind === 'need' || kind === 'elsewhere';
    const shops = settings.get('interface.shopLinks');
    return {
      platformKey: r.platformKey,
      platform: r.platform,
      title: r.title,
      answer: kind,
      ownedOn: r.ownedOn,
      coverId: r.coverId ?? null,
      valueCents: kind === 'own' && settings.get('security.publicCheckValue') ? (r.ownedValueCents ?? null) : null,
      wishlist: wanted && r.wishlist ? { priority: r.wishlist.priority, rank: r.wishlist.rank } : null,
      links: wanted
        ? [
            { name: 'PriceCharting', url: barcode ? priceChartingBarcodeUrl(barcode) : priceChartingUrl(r.title, r.platform) },
            ...shopLinksFor(shops, r.platformKey).slice(0, SHOPS_IN_LISTS).map((s) => ({ name: s.name, url: shopUrl(s.template, r.title, r.platform) })),
          ]
        : [],
    };
  };

  app.get('/api/v1/check', async (request, reply) => {
    if (settings.get('security.publicCheck') === 'off') return reply.code(404).send({ error: 'off', message: 'Checking a game without signing in is off.' });
    const q = request.query as { barcode?: string; q?: string };
    const barcode = q.barcode?.trim() ?? '';
    const title = q.q?.trim() ?? '';
    if (!barcode && title.length < 2) return reply.code(400).send({ error: 'invalid', message: 'Scan a barcode or type a title.' });
    if (!allow(request.ip)) return reply.code(429).send({ error: 'too-many', message: 'That was a lot of checks. Try again in a few minutes.' });
    const currency = settings.get('general.currency');
    if (barcode) {
      const found = await lookup.byBarcode(barcode);
      // The barcode is one product: its link goes to the game on the console it's for (the first answer otherwise).
      const scanned = found.results.find((r) => r.platformKey === (found.platformKey ?? found.results[0]?.platformKey));
      return {
        currency,
        productName: found.productName,
        searchedFor: found.searchedFor,
        // A barcode waiting its turn with the barcode service says so, and when to ask again.
        message: found.results.length > 0 ? null : found.retryInSeconds ? found.message : found.known ? null : "This barcode isn't one Squirrelcade knows yet. Type the game's title instead.",
        retryInSeconds: found.retryInSeconds ?? null,
        results: found.results.slice(0, MAX_RESULTS).map((r) => answer(r, r === scanned ? found.code : undefined)),
        // PriceCharting knows most games' barcodes: when Squirrelcade doesn't find the game, its page may.
        lookupUrl: priceChartingBarcodeUrl(found.code),
      };
    }
    return { currency, productName: null, searchedFor: title, message: null, results: lookup.search(title, { limit: MAX_RESULTS }).map((r) => answer(r)) };
  });
}
