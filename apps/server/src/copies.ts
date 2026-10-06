import { normalizeTitle, pcFamilyKey, type Completeness } from '@squirrelcade/core';
import { eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { shown } from './access.js';
import type { RommLinker } from './catalogs.js';
import type { Db } from './db/index.js';
import { copies, copyGroups, platforms } from './db/schema.js';
import type { PcService } from './pc.js';
import type { RommLink } from './romm.js';

/** One console's copies of a game under one title, as the Copies page shows them. */
export interface ConsoleCopies {
  /** "console|<platform key>|<title as in the collection>": what the owner's answers are kept by. */
  copyKey: string;
  platformKey: string;
  platform: string;
  title: string;
  copies: number;
  sealed: number;
  /** How complete each copy is (one entry per copy). */
  completeness: Completeness[];
  /** The owner moved it here from the game its title would put it with, or out on its own. */
  moved: boolean;
}

/** A game in the PC library, across its storefronts. */
export interface PcCopies {
  copyKey: string;
  title: string;
  storefronts: { storefront: string; ownership: string }[];
  /** Owned for good in at least one storefront (not only through a subscription). */
  owned: boolean;
  moved: boolean;
}

/** A way to play a game without opening a sealed copy. */
export interface PlayWay {
  kind: 'pc' | 'copy' | 'romm';
  label: string;
  url?: string;
}

/** A game with every copy the owner has of it: on each console, and on PC. */
export interface CopiesGroup {
  key: string;
  title: string;
  consoles: ConsoleCopies[];
  pc: PcCopies[];
  /** Copies in all: console copies, plus one for each PC game owned for good. */
  total: number;
  sealed: number;
  /** For a game with a sealed copy: the ways to play it and keep that copy sealed. */
  playable: PlayWay[];
}

export type CopiesView = 'sealed-playable' | 'sealed-only' | 'repeats' | 'multiple' | 'all';
export const COPIES_VIEWS: readonly CopiesView[] = ['sealed-playable', 'sealed-only', 'repeats', 'multiple', 'all'];

/** Copies that can be played: in a box or loose, not a box or manual alone, not sealed or slabbed. */
const PLAYABLE: ReadonlySet<Completeness> = new Set(['complete', 'item-box', 'item-manual', 'loose']);

/** Why the owner's answer about a copy couldn't be saved. */
export class CopiesError extends Error {}

/**
 * The Copies page: each game the owner has, with every copy of it across consoles and (with the PC library on) PC,
 * grouped by title. Its main use: sealed console copies the owner can still play some other way (a PC copy, an
 * opened copy, or RomM with it on). The owner's answers move a copy to another game (a title that differs) or out
 * on its own (two games with one name); they're kept by copy in copy_groups.
 */
export class CopiesService {
  private cache: { at: number; groups: CopiesGroup[] } | null = null;

  constructor(
    private readonly db: Db,
    private readonly pc: PcService,
    private readonly romm: { link: RommLinker; enabled: () => boolean },
    private readonly log: Logger,
  ) {}

  invalidate(): void {
    this.cache = null;
  }

  private overrides(): Map<string, string> {
    return new Map(
      this.db
        .select()
        .from(copyGroups)
        .all()
        .map((r) => [r.copyKey, r.groupKey]),
    );
  }

  /** Every game's copies (worked out again after ten seconds, or when something changes). */
  private groups(withPc: boolean): CopiesGroup[] {
    if (withPc && this.cache && Date.now() - this.cache.at < 10_000) return this.cache.groups;
    const moved = this.overrides();
    const byKey = new Map<string, CopiesGroup>();
    const group = (key: string, title: string) => {
      let g = byKey.get(key);
      if (!g) {
        g = { key, title, consoles: [], pc: [], total: 0, sealed: 0, playable: [] };
        byKey.set(key, g);
      }
      return g;
    };
    const items = this.db
      .select({ title: copies.title, platformKey: platforms.key, platform: platforms.name, completeness: copies.completeness, sealed: copies.sealed, quantity: copies.quantity })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    for (const item of items) {
      const copyKey = `console|${item.platformKey}|${item.title}`;
      const g = group(moved.get(copyKey) ?? pcFamilyKey(item.title), item.title);
      let c = g.consoles.find((x) => x.copyKey === copyKey);
      if (!c) {
        c = { copyKey, platformKey: item.platformKey, platform: item.platform, title: item.title, copies: 0, sealed: 0, completeness: [], moved: moved.has(copyKey) };
        g.consoles.push(c);
      }
      c.copies += item.quantity;
      if (item.sealed) c.sealed += item.quantity;
      for (let i = 0; i < item.quantity; i++) c.completeness.push(item.completeness as Completeness);
    }
    if (withPc) {
      for (const f of this.pc.families()) {
        const copyKey = `pc|${f.key}`;
        const g = group(moved.get(copyKey) ?? f.key, f.title);
        g.pc.push({ copyKey, title: f.title, storefronts: f.records.map((r) => ({ storefront: r.storefront, ownership: r.ownership })), owned: f.owned, moved: moved.has(copyKey) });
      }
    }
    const groups = [...byKey.values()];
    for (const g of groups) {
      // The title a console copy goes by, when there is one (collection titles over storefront names).
      g.title = g.consoles[0]?.title ?? g.pc[0]?.title ?? g.title;
      g.consoles.sort((a, b) => a.platform.localeCompare(b.platform) || a.title.localeCompare(b.title));
      g.total = g.consoles.reduce((n, c) => n + c.copies, 0) + g.pc.filter((p) => p.owned).length;
      g.sealed = g.consoles.reduce((n, c) => n + c.sealed, 0);
    }
    groups.sort((a, b) => a.title.localeCompare(b.title));
    if (withPc) this.cache = { at: Date.now(), groups };
    return groups;
  }

  /** The ways to play a game with a sealed copy and keep it sealed: owned on PC, another copy that's open, RomM. */
  private playWays(g: CopiesGroup, may: { pc: boolean; romm: boolean }): PlayWay[] {
    if (g.sealed === 0) return [];
    const ways: PlayWay[] = [];
    if (may.pc) {
      for (const p of g.pc) {
        for (const s of new Set(p.storefronts.filter((x) => x.ownership === 'permanent').map((x) => x.storefront))) ways.push({ kind: 'pc', label: s });
      }
    }
    for (const c of g.consoles) {
      const open = c.completeness.filter((x) => PLAYABLE.has(x)).length;
      if (open > 0) ways.push({ kind: 'copy', label: `${open === 1 ? 'A copy' : `${open} copies`} on ${c.platform}` });
    }
    if (may.romm && this.romm.enabled()) {
      for (const c of g.consoles.filter((x) => x.sealed > 0)) {
        const link: RommLink | null = this.romm.link(c.platformKey, [c.title]);
        if (link) {
          ways.push({ kind: 'romm', label: `RomM (${c.platform})`, url: link.url });
          break;
        }
      }
    }
    return ways;
  }

  /** The Copies page: a view's games (searched, a page at a time) and how many games each view has. */
  list(query: { view?: string; how?: string; q?: string; page?: number; pageSize?: number }, may: { pc: boolean; romm: boolean }) {
    const view: CopiesView = COPIES_VIEWS.includes(query.view as CopiesView) ? (query.view as CopiesView) : 'sealed-playable';
    const withPc = may.pc && this.pc.enabled();
    const all = this.groups(withPc).map((g) => ({ ...g, playable: this.playWays(g, { pc: withPc, romm: may.romm }) }));
    const counts: Record<CopiesView, number> = { 'sealed-playable': 0, 'sealed-only': 0, repeats: 0, multiple: 0, all: 0 };
    const inView = (g: CopiesGroup, v: CopiesView) =>
      v === 'all' ||
      // The same game more than once on one console: the copies PriceCharting counts beyond the games.
      (v === 'repeats'
        ? g.consoles.some((c) => c.copies >= 2)
        : v === 'multiple'
          ? g.total >= 2
          : g.sealed > 0 && (v === 'sealed-playable' ? g.playable.length > 0 : g.playable.length === 0));
    for (const g of all) for (const v of COPIES_VIEWS) if (inView(g, v)) counts[v]++;
    const q = query.q ? normalizeTitle(query.q) : '';
    // Sealed games playable another way can be narrowed to one way (on PC, say).
    const how = view === 'sealed-playable' && ['pc', 'copy', 'romm'].includes(query.how ?? '') ? query.how : null;
    const rows = all.filter(
      (g) =>
        inView(g, view) &&
        (!how || g.playable.some((w) => w.kind === how)) &&
        (!q || [g.title, ...g.consoles.map((c) => c.title), ...g.pc.map((p) => p.title)].some((t) => normalizeTitle(t).includes(q))),
    );
    const pageSize = Math.min(Math.max(query.pageSize ?? 100, 1), 500);
    const page = Math.max(query.page ?? 1, 1);
    return { view, counts, total: rows.length, page, pageSize, pcOn: withPc, items: rows.slice((page - 1) * pageSize, page * pageSize) };
  }

  /** Games to move a copy to ("Same game as..."), by title. */
  search(q: string, withPc: boolean): { key: string; title: string; where: string }[] {
    const needle = normalizeTitle(q);
    if (!needle) return [];
    return this.groups(withPc && this.pc.enabled())
      .filter((g) => normalizeTitle(g.title).includes(needle))
      .slice(0, 20)
      .map((g) => ({ key: g.key, title: g.title, where: [...g.consoles.map((c) => c.platform), ...(g.pc.length > 0 ? ['PC'] : [])].join(', ') }));
  }

  /** The owner's answer about a copy: it belongs with another game (its key), on its own ("own"), or back where its title puts it (null). */
  move(copyKey: string, groupKey: string | null): void {
    if (!/^(console\|[a-z0-9-]+\||pc\|)./.test(copyKey) || copyKey.length > 500) throw new CopiesError('That is not a copy.');
    if (groupKey === null) {
      this.db.delete(copyGroups).where(eq(copyGroups.copyKey, copyKey)).run();
    } else {
      const key = groupKey === 'own' ? `own:${copyKey}` : groupKey.trim();
      if (!key || key.length > 520) throw new CopiesError('Choose the game it belongs with.');
      const row = { copyKey, groupKey: key, updatedAt: new Date().toISOString() };
      this.db.insert(copyGroups).values(row).onConflictDoUpdate({ target: copyGroups.copyKey, set: row }).run();
    }
    this.invalidate();
    this.log.info({ context: 'copies' }, `${copyKey}: ${groupKey === null ? 'back with its title' : groupKey === 'own' ? 'on its own' : `with ${groupKey}`}`);
  }
}

/** The Copies page's games, the search for "Same game as...", and the owner's answers. */
export function registerCopiesRoutes(app: FastifyInstance, copies: CopiesService): void {
  app.get('/api/v1/copies', async (request) => {
    const q = request.query as { view?: string; how?: string; q?: string; page?: string; pageSize?: string };
    const may = shown(request);
    return copies.list({ view: q.view, how: q.how, q: q.q, page: Number(q.page) || 1, pageSize: Number(q.pageSize) || 100 }, { pc: may.pc, romm: may.romm });
  });

  app.get('/api/v1/copies/search', async (request) => {
    const { q } = request.query as { q?: string };
    return copies.search(q ?? '', shown(request).pc);
  });

  app.put('/api/v1/copies/group', async (request, reply) => {
    const b = request.body as { copyKey?: unknown; groupKey?: unknown } | null;
    if (typeof b?.copyKey !== 'string' || (b.groupKey !== null && typeof b.groupKey !== 'string')) {
      return reply.code(400).send({ error: 'invalid', message: 'Send copyKey and groupKey (a game\'s key, "own", or null).' });
    }
    try {
      copies.move(b.copyKey, b.groupKey as string | null);
      return { ok: true };
    } catch (err) {
      if (err instanceof CopiesError) return reply.code(400).send({ error: 'invalid', message: err.message });
      throw err;
    }
  });
}
