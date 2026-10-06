import { matchKey, NINTENDO_LIFE_PAGES, nintendoLifeGames, type LayerGame, type NintendoLifeGame } from '@squirrelcade/core';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { appState } from './db/schema.js';
import { APP_VERSION } from './env.js';
import type { FetchLike } from './igdb.js';

/** app_state key: the last reading of Nintendo Life's lists. */
const SNAPSHOT_KEY = 'source.nintendo-life';

/** The last reading of Nintendo Life's lists: the games, when, a fingerprint to tell changes, and the last error. */
export interface NintendoLifeSnapshot {
  readAt: string | null;
  games: NintendoLifeGame[];
  hash: string | null;
  /** Why the last attempt failed; the games of the last good reading stay. */
  error: string | null;
  attemptedAt: string | null;
}

/**
 * Nintendo Life's Switch 2 physical-release lists as a catalog source (sources.ts): read at most once
 * a day while the source is on, for the owner's own catalogs (their terms allow personal use). A
 * failed read keeps the last good lists, and so does a page that no longer has its confirmed list.
 */
export class NintendoLifeSource {
  constructor(
    private readonly db: Db,
    private readonly log: Logger,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
  ) {}

  snapshot(): NintendoLifeSnapshot {
    const row = this.db.select().from(appState).where(eq(appState.key, SNAPSHOT_KEY)).get();
    return row ? (JSON.parse(row.value) as NintendoLifeSnapshot) : { readAt: null, games: [], hash: null, error: null, attemptedAt: null };
  }

  private save(snapshot: NintendoLifeSnapshot): void {
    const value = JSON.stringify(snapshot);
    this.db.insert(appState).values({ key: SNAPSHOT_KEY, value }).onConflictDoUpdate({ target: appState.key, set: { value } }).run();
  }

  /** Reads both lists when the last reading is older than `maxAgeMs`. True when the games changed. */
  async refresh(maxAgeMs = 20 * 3_600_000): Promise<boolean> {
    const last = this.snapshot();
    const since = last.attemptedAt ?? last.readAt;
    if (since && Date.now() - Date.parse(since) < maxAgeMs) return false;
    const attemptedAt = new Date().toISOString();
    try {
      const games: NintendoLifeGame[] = [];
      for (const page of NINTENDO_LIFE_PAGES) {
        const res = await this.fetchImpl(page.url, { headers: { 'User-Agent': `Squirrelcade/${APP_VERSION} (+https://github.com/squirrelcade/squirrelcade; self-hosted, personal use)` } });
        if (!res.ok) throw new Error(`${page.url} answered ${res.status}`);
        const found = nintendoLifeGames(await res.text(), page.format);
        if (found.length === 0) throw new Error(`the page ${page.url} has no list of confirmed games any more (it may have changed)`);
        games.push(...found);
      }
      const hash = createHash('sha256').update(JSON.stringify(games)).digest('hex');
      this.save({ readAt: attemptedAt, games, hash, error: null, attemptedAt });
      const counts = NINTENDO_LIFE_PAGES.map((p) => `${games.filter((g) => g.format === p.format && !g.japan).length} ${p.format}s`).join(', ');
      this.log.info({ context: 'catalogs' }, `Nintendo Life read: ${counts}`);
      return hash !== last.hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.save({ ...last, error: message, attemptedAt });
      this.log.warn({ context: 'catalogs' }, `Nintendo Life couldn't be read: ${message}`);
      return false;
    }
  }

  /**
   * The Switch 2 games it lists as a catalog layer, or null when it has never been read. Its list of
   * Japanese releases counts only for a Japanese catalog (as releases elsewhere do on Wikipedia), where
   * it wins over the main lists for a game on both (a Game-Key Card in Japan, a full card elsewhere).
   */
  games(region: string): LayerGame[] | null {
    const snap = this.snapshot();
    if (!snap.readAt) return null;
    const byTitle = new Map<string, NintendoLifeGame>();
    for (const g of snap.games) {
      if (g.japan && region !== 'japan') continue;
      const k = matchKey(g.title);
      if (!byTitle.has(k) || g.japan) byTitle.set(k, g);
    }
    return [...byTitle.values()].map((g) => ({ title: g.title, format: g.format, releaseDate: g.releaseDate, region, targetStatus: 'required' as const, evidence: 'nintendo-life', notes: g.note }));
  }
}
