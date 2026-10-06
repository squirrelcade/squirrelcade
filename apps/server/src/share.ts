import { priceChartingUrl, shopLinksFor, SHOPS_IN_LISTS, shopUrl } from '@squirrelcade/core';
import { desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { shareLinks } from './db/schema.js';
import type { SettingsService } from './settings.js';

/** What a share link shows. */
export type ShareKind = 'wishlist' | 'sale';

/** A game on a shared wishlist. */
export interface SharedWish {
  rank: number;
  title: string;
  platform: string;
  coverId: string | null;
  priority: string;
  /** Where to look for it: PriceCharting and the owner's shop links for its console. */
  links: { name: string; url: string }[];
}

/** A copy on a shared list of games for sale or trade. */
export interface SharedSale {
  title: string;
  platform: string;
  condition: string;
  quantity: number;
  /** sale or trade */
  kind: string;
  askingCents: number | null;
  note: string | null;
  coverId: string | null;
}

/** What a share link's page shows (GET /api/v1/share/:token). */
export interface SharedPage {
  kind: ShareKind;
  name: string | null;
  instanceName: string;
  currency: string;
  generatedAt: string;
  wishes?: SharedWish[];
  sales?: SharedSale[];
}

/** Where a share link's lists come from: the wishlist's top picks, and the copies for sale or trade. */
export interface ShareSources {
  wishes: (limit: number) => (Omit<SharedWish, 'links'> & { platformKey: string })[];
  sales: () => SharedSale[];
}

/** A share link, for the owner's list. */
export interface ShareLink {
  id: number;
  kind: ShareKind;
  name: string | null;
  path: string;
  createdAt: string;
  lastOpenedAt: string | null;
  opens: number;
}

const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
const WINDOW_MS = 10 * 60_000;

/**
 * Share links (0.6.0, D53): a page anyone with the link can open without signing in, showing the wishlist's top
 * picks (for gifts) or the copies marked for sale or trade. Nothing else: never prices paid, notes, values or the
 * collection itself. The owner makes, lists and removes links; each shows how often it was opened.
 */
export class ShareService {
  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly sources: ShareSources,
    private readonly log: Logger,
  ) {}

  list(): ShareLink[] {
    return this.db
      .select()
      .from(shareLinks)
      .orderBy(desc(shareLinks.id))
      .all()
      .map((r) => ({ id: r.id, kind: r.kind as ShareKind, name: r.name, path: `/share/${r.token}`, createdAt: r.createdAt, lastOpenedAt: r.lastOpenedAt, opens: r.opens }));
  }

  create(kind: ShareKind, name: string | null): ShareLink {
    const token = randomBytes(18).toString('base64url');
    const row = this.db
      .insert(shareLinks)
      .values({ token, kind, name: name?.trim().slice(0, 60) || null, createdAt: new Date().toISOString() })
      .returning()
      .get();
    this.log.info({ context: 'share' }, `Share link made: ${kind}${row.name ? ` (${row.name})` : ''}`);
    return this.list().find((l) => l.id === row.id)!;
  }

  remove(id: number): boolean {
    return this.db.delete(shareLinks).where(eq(shareLinks.id, id)).run().changes > 0;
  }

  /** A link's page, counting the visit; null for a link that doesn't exist (or was removed). */
  open(token: string): SharedPage | null {
    if (!TOKEN.test(token)) return null;
    const row = this.db.select().from(shareLinks).where(eq(shareLinks.token, token)).get();
    if (!row) return null;
    this.db
      .update(shareLinks)
      .set({ opens: sql`${shareLinks.opens} + 1`, lastOpenedAt: new Date().toISOString() })
      .where(eq(shareLinks.id, row.id))
      .run();
    const base = {
      kind: row.kind as ShareKind,
      name: row.name,
      instanceName: this.settings.get('general.instanceName') || 'Squirrelcade',
      currency: this.settings.get('general.currency'),
      generatedAt: new Date().toISOString(),
    };
    if (row.kind === 'sale') return { ...base, sales: this.sources.sales() };
    const shops = this.settings.get('interface.shopLinks');
    const wishes = this.sources.wishes(this.settings.get('wishlist.shareSize')).map((w) => ({
      rank: w.rank,
      title: w.title,
      platform: w.platform,
      coverId: w.coverId,
      priority: w.priority,
      links: [
        { name: 'PriceCharting', url: priceChartingUrl(w.title, w.platform) },
        ...shopLinksFor(shops, w.platformKey).slice(0, SHOPS_IN_LISTS).map((s) => ({ name: s.name, url: shopUrl(s.template, w.title, w.platform) })),
      ],
    }));
    return { ...base, wishes };
  }
}

/** Share links: the owner's list, making and removing them, and the page anyone with a link may open. */
export function registerShareRoutes(app: FastifyInstance, shares: ShareService, settings: SettingsService): void {
  app.get('/api/v1/shares', async () => shares.list());

  app.post('/api/v1/shares', async (request, reply) => {
    const b = request.body as { kind?: unknown; name?: unknown } | null;
    if (b?.kind !== 'wishlist' && b?.kind !== 'sale') return reply.code(400).send({ error: 'invalid', message: 'Send kind: "wishlist" or "sale", and a name if you like.' });
    return reply.code(201).send(shares.create(b.kind, typeof b.name === 'string' ? b.name : null));
  });

  app.delete('/api/v1/shares/:id', async (request) => ({ removed: shares.remove(Number((request.params as { id: string }).id)) }));

  // The page itself, without signing in: a limited number of opens per address in 10 minutes (Settings > Security).
  const recent = new Map<string, number[]>();
  app.get('/api/v1/share/:token', async (request, reply) => {
    const now = Date.now();
    const times = (recent.get(request.ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (times.length >= settings.get('security.shareOpenLimit')) return reply.code(429).send({ error: 'too-many', message: 'Too many visits from here; try again in a few minutes.' });
    recent.set(request.ip, [...times, now]);
    if (recent.size > 5000) for (const [key, list] of recent) if (list.every((t) => now - t >= WINDOW_MS)) recent.delete(key);
    const page = shares.open((request.params as { token: string }).token);
    if (!page) return reply.code(404).send({ error: 'not-found', message: 'This link doesn\'t work any more. Ask for a new one.' });
    return page;
  });
}
