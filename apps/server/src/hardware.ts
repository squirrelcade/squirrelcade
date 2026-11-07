import { hardwareKind, type HardwareKind } from '@squirrelcade/core';
import { eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { Db } from './db/index.js';
import { appState, copies, platforms } from './db/schema.js';

/** The owner's word on PriceCharting products: this one is hardware, or this one is a game (T-217). */
const OVERRIDES = 'hardwareOverrides';

/** A piece of hardware you have (Your hardware): what it is, on which console, its condition and worth. */
export interface HardwareItem {
  productId: string;
  title: string;
  kind: HardwareKind;
  platformKey: string;
  platform: string;
  completeness: string;
  quantity: number;
  valueCents: number | null;
  costCents: number | null;
  /** The owner said so (else Squirrelcade read it from the name). */
  yours: boolean;
}

/**
 * Hardware in the collection (T-217, D205): consoles, controllers and accessories, read from PriceCharting's names
 * (core's hardwareKind) or the owner's word. They stay out of game counts, the catalogs' matching (so Review and
 * "owned, not in the catalog") and the game of the day, and show as Your hardware on a console's page and the Nutshell.
 */
export class HardwareService {
  private cache: Record<string, 'hardware' | 'game'> | null = null;
  private version = 0;
  /** Told when the owner's word changes, so the catalogs and counts work it out again. */
  onChange: () => void = () => undefined;

  constructor(private readonly db: Db) {}

  /** Changes with the owner's word (for answers worked out from it and kept). */
  stamp(): number {
    return this.version;
  }

  private overrides(): Record<string, 'hardware' | 'game'> {
    if (!this.cache) {
      const row = this.db.select().from(appState).where(eq(appState.key, OVERRIDES)).get();
      this.cache = row ? (JSON.parse(row.value) as Record<string, 'hardware' | 'game'>) : {};
    }
    return this.cache;
  }

  /** What a product is: hardware of a kind, or null for a game (the owner's word first). */
  kindOf(productId: string, title: string): HardwareKind | null {
    const said = this.overrides()[productId];
    if (said === 'game') return null;
    return hardwareKind(title) ?? (said === 'hardware' ? 'accessory' : null);
  }

  isHardware = (productId: string, title: string): boolean => this.kindOf(productId, title) !== null;

  /** This is hardware / This is a game, or null to go back to what its name says. */
  set(productId: string, is: 'hardware' | 'game' | null): void {
    const next = { ...this.overrides() };
    if (is === null) delete next[productId];
    else next[productId] = is;
    const value = JSON.stringify(next);
    this.db.insert(appState).values({ key: OVERRIDES, value }).onConflictDoUpdate({ target: appState.key, set: { value } }).run();
    this.cache = next;
    this.version++;
    this.onChange();
  }

  /** Your hardware, on one console or all, most valuable first. */
  list(platformKey?: string): HardwareItem[] {
    const said = this.overrides();
    const rows = this.db
      .select({ productId: copies.productId, title: copies.title, key: platforms.key, name: platforms.name, completeness: copies.completeness, quantity: copies.quantity, valueCents: copies.valueCents, costCents: copies.costCents })
      .from(copies)
      .innerJoin(platforms, eq(platforms.id, copies.platformId))
      .where(isNull(copies.goneAt))
      .all();
    return rows
      .filter((r) => !platformKey || r.key === platformKey)
      .flatMap((r) => {
        const kind = this.kindOf(r.productId, r.title);
        return kind ? [{ productId: r.productId, title: r.title, kind, platformKey: r.key, platform: r.name, completeness: r.completeness, quantity: r.quantity, valueCents: r.valueCents, costCents: r.costCents, yours: r.productId in said }] : [];
      })
      .sort((a, b) => (b.valueCents ?? 0) * b.quantity - (a.valueCents ?? 0) * a.quantity || a.title.localeCompare(b.title));
  }
}

export function registerHardwareRoutes(app: FastifyInstance, hardware: HardwareService): void {
  // Your hardware: ?platform=<key> for one console's.
  app.get('/api/v1/hardware', async (request) => {
    const items = hardware.list((request.query as { platform?: string }).platform || undefined);
    return { items, valueCents: items.reduce((n, i) => n + (i.valueCents ?? 0) * i.quantity, 0) };
  });
  // This is hardware / This is a game: { is: 'hardware' | 'game' | null }.
  app.put('/api/v1/hardware/:productId', async (request, reply) => {
    const { productId } = request.params as { productId: string };
    const is = (request.body as { is?: unknown } | null)?.is;
    if (!(is === 'hardware' || is === 'game' || is === null)) return reply.code(400).send({ error: 'invalid', message: "Send is: 'hardware', 'game' or null." });
    hardware.set(productId, is);
    return { ok: true };
  });
}
