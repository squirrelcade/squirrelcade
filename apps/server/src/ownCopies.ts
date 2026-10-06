import { COMPLETENESS_LABELS, dayIn, normalizeTitle, type Completeness } from '@squirrelcade/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { CatalogService } from './catalogs.js';
import { CopyError, type CollectionService } from './collection.js';
import type { CopyDetailsService } from './copyDetails.js';
import type { Db } from './db/index.js';
import { copies, platforms } from './db/schema.js';
import type { IgdbService } from './igdb.js';
import { catalogTarget } from './games.js';
import type { SettingsService } from './settings.js';

/** A copy as the pages get it back after adding or changing it. */
function view(c: typeof copies.$inferSelect) {
  return {
    id: c.id,
    key: c.key,
    title: c.title,
    consoleLabel: c.consoleLabel,
    completeness: c.completeness,
    condition: COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness,
    costCents: c.costCents,
    estimatedCents: c.estimatedCents,
    datePurchased: c.datePurchased,
    notes: c.notes,
    source: c.source,
    addedAt: c.addedAt,
    sentAt: c.sentAt,
  };
}

const ids = (body: unknown): number[] | null => {
  const list = (body as { ids?: unknown } | null)?.ids;
  return Array.isArray(list) && list.every((x) => Number.isInteger(x)) ? (list as number[]) : null;
};

/**
 * Copies of Squirrelcade's own (0.20.0, D83): adding one (a game's drawer, and "I bought it" in Store Mode and the drawer),
 * changing one's condition, price paid, day bought and notes, taking one out (sold or removed, or undone just after),
 * and PriceCharting's side of the hub: the lines for its paste importer, and what to remove there.
 */
export function registerOwnCopyRoutes(
  app: FastifyInstance,
  deps: { collection: CollectionService; catalogs: CatalogService; details: CopyDetailsService; settings: SettingsService; db: Db; igdb: IgdbService },
): void {
  const { collection } = deps;
  const fail = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, err: unknown) => {
    if (err instanceof CopyError) return reply.code(400).send({ error: 'invalid', message: err.message });
    throw err;
  };
  // A copy with details, loans or photos kept on it isn't simply undone: it's removed (sold or gone) instead.
  // One in, one out: how far over its goal the collection is after a copy came (0 at the goal), or null (under it, or no goal).
  const overGoal = () => {
    const goal = collection.goal();
    return goal && goal.remaining <= 0 ? -goal.remaining : null;
  };
  const hasExtras = (key: string) => {
    const d = deps.details.of(key);
    return d.loans.length > 0 || d.photos.length > 0 || d.details.location !== null || d.details.tags.length > 0 || d.details.sale !== null;
  };

  app.post('/api/v1/collection/copies', async (request, reply) => {
    const b = (request.body ?? {}) as Record<string, unknown>;
    if (typeof b.platformKey !== 'string' || typeof b.title !== 'string') {
      return reply.code(400).send({ error: 'invalid', message: 'Send platformKey, title and completeness, and costCents, datePurchased or notes if you like.' });
    }
    // Any console Squirrelcade knows, even one nothing was imported for yet (Add a game, 0.60.0).
    deps.catalogs.platform(b.platformKey);
    try {
      const copy = collection.addCopy({ platformKey: b.platformKey, title: b.title, completeness: b.completeness, costCents: b.costCents, datePurchased: b.datePurchased, notes: b.notes });
      return reply.code(201).send({ copy: view(copy), overGoal: overGoal() });
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Add a game (0.60.0): titles for what's typed on a console, from its catalog, IGDB's data (when set up) and the
  // collection, so a game added by hand matches the one the catalog and IGDB know. Words match at their start.
  app.get('/api/v1/collection/add/suggest', async (request) => {
    const q = request.query as { platform?: string; q?: string };
    const platformKey = String(q.platform ?? '');
    const words = normalizeTitle(String(q.q ?? '')).split(' ').filter(Boolean);
    if (!platformKey || words.length === 0) return { suggestions: [] };
    const fits = (title: string) => {
      const t = ` ${normalizeTitle(title)}`;
      return words.every((w) => t.includes(` ${w}`));
    };
    type Suggestion = { title: string; sources: ('collection' | 'catalog' | 'igdb')[]; owned: number; released: string | null };
    const found = new Map<string, Suggestion>();
    const add = (title: string, source: Suggestion['sources'][number], extra: Partial<Suggestion> = {}) => {
      const key = normalizeTitle(title);
      const s = found.get(key) ?? { title, sources: [], owned: 0, released: null };
      if (!s.sources.includes(source)) s.sources.push(source);
      s.owned += extra.owned ?? 0;
      s.released ??= extra.released ?? null;
      found.set(key, s);
    };
    const platform = deps.db.select().from(platforms).where(eq(platforms.key, platformKey)).get();
    if (platform) {
      for (const c of deps.db.select({ title: copies.title }).from(copies).where(and(eq(copies.platformId, platform.id), isNull(copies.goneAt))).all()) if (fits(c.title)) add(c.title, 'collection', { owned: 1 });
      for (const g of deps.igdb.games(platform.id)) if (fits(g.name)) add(g.name, 'igdb', { released: g.released });
    }
    for (const c of deps.catalogs.titles(platformKey) ?? []) if (fits(c.title)) add(c.title, 'catalog');
    // What starts with the words first, then what you have, then the catalog's, then the rest; shortest titles first.
    const first = normalizeTitle(String(q.q ?? ''));
    const score = (s: Suggestion) => (normalizeTitle(s.title).startsWith(first) ? 0 : 4) + (s.owned > 0 ? 0 : s.sources.includes('catalog') ? 1 : 2);
    const suggestions = [...found.values()].sort((a, b) => score(a) - score(b) || a.title.length - b.title.length || a.title.localeCompare(b.title)).slice(0, 15);
    return { suggestions };
  });

  app.put('/api/v1/collection/copies/:id', async (request, reply) => {
    try {
      const copy = collection.editCopy(Number((request.params as { id: string }).id), (request.body ?? {}) as Record<string, unknown>);
      return copy ? { copy: view(copy) } : reply.code(404).send({ error: 'not-found', message: "That copy isn't in your collection." });
    } catch (err) {
      return fail(reply, err);
    }
  });

  app.post('/api/v1/collection/copies/:id/remove', async (request, reply) => {
    const reason = (request.body as { reason?: unknown } | null)?.reason;
    if (reason !== 'sold' && reason !== 'removed') return reply.code(400).send({ error: 'invalid', message: 'Say why: sold or removed.' });
    return collection.removeCopy(Number((request.params as { id: string }).id), reason) ? { ok: true } : reply.code(404).send({ error: 'not-found', message: "That copy isn't in your collection." });
  });

  // "I bought it" (Store Mode, and a game's drawer): a copy of the catalog game in the condition Settings > Collection
  // gives a game just bought (or the one sent). A purchase sent twice the same day (a phone that was offline) counts once.
  app.get('/api/v1/purchases', async () =>
    collection.ownCopies().map((c) => ({
      id: c.id,
      key: c.key,
      entryId: c.platformKey ? (catalogTarget(deps.catalogs, c.platformKey, c.title)?.target.id ?? null) : null,
      title: c.title,
      platformKey: c.platformKey,
      platform: c.platform,
      condition: COMPLETENESS_LABELS[c.completeness as Completeness] ?? c.completeness,
      // What was paid (asked in Store Mode right after I bought it).
      costCents: c.costCents,
      createdAt: c.addedAt,
      sentAt: c.sentAt,
    })),
  );

  app.post('/api/v1/purchases', async (request, reply) => {
    const b = (request.body ?? {}) as { entryId?: unknown; completeness?: unknown };
    if (!Number.isInteger(b.entryId)) return reply.code(400).send({ error: 'invalid', message: 'Send the entryId of the catalog game.' });
    const entry = deps.catalogs.entry(b.entryId as number);
    if (!entry) return reply.code(404).send({ error: 'not-found', message: 'No such catalog game.' });
    const today = dayIn(deps.settings.get('general.timeZone'));
    const again = collection.ownCopies().find((c) => c.platformKey === entry.platformKey && c.title === entry.title && c.dateEntered === today && c.sentAt === null);
    if (again) return reply.code(200).send({ id: again.id, key: again.key });
    try {
      const given = b.completeness !== undefined;
      const copy = collection.addCopy({
        platformKey: entry.platformKey,
        title: entry.title,
        completeness: given ? b.completeness : deps.settings.get('collection.boughtCondition'),
        datePurchased: today,
        conditionGiven: given,
      });
      return reply.code(201).send({ id: copy.id, key: copy.key, overGoal: overGoal() });
    } catch (err) {
      return fail(reply, err);
    }
  });

  // Takes back a copy just added (a tap by mistake); one with details kept on it is removed instead.
  app.delete('/api/v1/purchases/:id', async (request) => ({ removed: collection.undoCopy(Number((request.params as { id: string }).id), hasExtras) }));

  app.get('/api/v1/send/pricecharting', async () => collection.forPriceCharting());

  app.post('/api/v1/send/pricecharting/sent', async (request, reply) => {
    const list = ids(request.body);
    return list ? { marked: collection.markSent(list) } : reply.code(400).send({ error: 'invalid', message: 'Send ids: the copies you pasted.' });
  });

  app.post('/api/v1/send/pricecharting/removed', async (request, reply) => {
    const list = ids(request.body);
    return list ? { marked: collection.markRemovedThere(list) } : reply.code(400).send({ error: 'invalid', message: 'Send ids: the copies you removed on PriceCharting.' });
  });
}
