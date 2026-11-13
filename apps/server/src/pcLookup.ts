import { priceChartingProductFromUrl, priceChartingProductUrl, readPriceChartingPage } from '@squirrelcade/core';
import { inArray } from 'drizzle-orm';
import type { Logger } from 'pino';
import type { Db } from './db/index.js';
import { appState } from './db/schema.js';
import { APP_VERSION } from './env.js';
import type { FetchLike } from './igdb.js';
import type { SettingsService } from './settings.js';

/** What a product's page said, kept in app_state under "pc-product:<id>": found, no such product, or a read that failed. */
export type KeptProduct =
  | { status: 'found'; title: string; consoleName: string; at: string }
  | { status: 'missing'; at: string }
  | { status: 'failed'; message: string; at: string };

const KEY = (id: string) => `pc-product:${id}`;
const ID = /^\d{1,12}$/;
/** A read that failed is tried again when the page is opened this long after. */
const RETRY_MS = 3 * 3_600_000;
/** At most this much of a page is read: its heading comes in the first 60 KB or so. */
const MAX_BYTES = 600_000;

/**
 * Send to PriceCharting's check, where the owner's exports don't name a product (the owner, 2026-11-12: "one page that
 * has Squirrelcade do the lookup for it and have it on a table"): the name and console of a PriceCharting ID, read from
 * its public page on pricecharting.com when Settings > Collection > Sending to PriceCharting allows it (off by default:
 * PriceCharting's terms keep its data for its own site). Gently: in the background, one page at a time with a pause
 * between them, only as far as its heading, once per ID (kept for good: an ID's product doesn't change), with a
 * plain User-Agent; a refusal or an error stops the run and is tried again hours later.
 */
export class PriceChartingPages {
  private queue: string[] = [];
  private current: string | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly db: Db,
    private readonly settings: SettingsService,
    private readonly log: Logger,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly pauseMs = 2500,
  ) {}

  /** Whether the owner lets Squirrelcade read PriceCharting's pages (Settings > Collection > Sending to PriceCharting). */
  on(): boolean {
    return this.settings.get('collection.pcLookup') === true;
  }

  /** What's kept for these IDs. */
  kept(ids: readonly string[]): Map<string, KeptProduct> {
    const out = new Map<string, KeptProduct>();
    const list = [...new Set(ids.filter((id) => ID.test(id)))];
    if (list.length === 0) return out;
    for (const row of this.db.select().from(appState).where(inArray(appState.key, list.map(KEY))).all()) {
      try {
        out.set(row.key.slice('pc-product:'.length), JSON.parse(row.value) as KeptProduct);
      } catch {
        // A value that can't be read is as if none were kept: it's read again.
      }
    }
    return out;
  }

  /** Whether an ID is waiting to be read, or being read. */
  pending(id: string): boolean {
    return this.current === id || this.queue.includes(id);
  }

  /**
   * Reads these IDs' pages in the background, when the setting is on: those not kept yet, and those whose read failed a
   * while ago (or now, with `again`: Try again).
   */
  want(ids: readonly string[], again = false): void {
    if (!this.on()) return;
    const kept = this.kept(ids);
    for (const id of new Set(ids)) {
      if (!ID.test(id) || this.pending(id)) continue;
      const k = kept.get(id);
      if (k && (k.status !== 'failed' || (!again && Date.now() - Date.parse(k.at) < RETRY_MS))) continue;
      this.queue.push(id);
    }
    if (this.queue.length > 0 && !this.running) {
      this.running = this.work().finally(() => {
        this.running = null;
      });
    }
  }

  /** Resolves once nothing is waiting (tests, and a clean stop). */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private save(id: string, value: KeptProduct): void {
    const text = JSON.stringify(value);
    this.db.insert(appState).values({ key: KEY(id), value: text }).onConflictDoUpdate({ target: appState.key, set: { value: text } }).run();
  }

  private async work(): Promise<void> {
    while (this.queue.length > 0) {
      const id = this.queue.shift()!;
      this.current = id;
      const result = await this.read(id);
      this.current = null;
      // Don't overwrite a good reading with a failure (the setting turned on twice, a retry racing a read).
      if (result.status !== 'failed' || this.kept([id]).get(id)?.status !== 'found') this.save(id, result);
      if (result.status === 'failed' && /refused|busy/.test(result.message)) {
        // PriceCharting asked us to slow down: the rest waits for the next time the page is opened, hours later.
        const rest = this.queue.splice(0);
        for (const other of rest) this.save(other, { status: 'failed', message: result.message, at: result.at });
        this.log.warn({ context: 'pricecharting-pages' }, `PriceCharting refused a page (${result.message}); ${rest.length} more wait`);
        break;
      }
      if (this.queue.length > 0 && this.pauseMs > 0) await new Promise((r) => setTimeout(r, this.pauseMs));
    }
  }

  /** Reads one ID's page as far as its heading. */
  async read(id: string): Promise<KeptProduct> {
    const at = new Date().toISOString();
    try {
      const res = await this.fetchImpl(priceChartingProductUrl(id), {
        headers: { 'user-agent': `Squirrelcade/${APP_VERSION} (+https://squirrelcade.com; self-hosted, one page at a time)`, accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20_000),
      });
      if (res.status === 404 || res.status === 410) return { status: 'missing', at };
      if (res.status === 429 || res.status === 403) return { status: 'failed', message: `PriceCharting refused (${res.status})`, at };
      if (res.status >= 500) return { status: 'failed', message: `PriceCharting is busy (${res.status})`, at };
      if (!res.ok) return { status: 'failed', message: `PriceCharting answered ${res.status}`, at };
      const html = await headOf(res);
      const found = readPriceChartingPage(html) ?? (res.url ? priceChartingProductFromUrl(res.url) : null);
      if (!found) return { status: 'failed', message: "PriceCharting's page couldn't be read (it may have changed)", at };
      this.log.info({ context: 'pricecharting-pages' }, `PriceCharting #${id} is ${found.title} (${found.consoleName})`);
      return { status: 'found', title: found.title, consoleName: found.consoleName, at };
    } catch (err) {
      const message = err instanceof Error && err.name === 'TimeoutError' ? 'PriceCharting took too long to answer' : `Couldn't reach PriceCharting: ${err instanceof Error ? err.message : String(err)}`;
      return { status: 'failed', message: message.slice(0, 200), at };
    }
  }
}

/** A page's text as far as the product's heading (or MAX_BYTES), then the rest of the download is dropped. */
async function headOf(res: Response): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, MAX_BYTES);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      const h1 = text.indexOf('id="product_name"');
      if ((h1 >= 0 && text.indexOf('</h1>', h1) >= 0) || bytes >= MAX_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}
