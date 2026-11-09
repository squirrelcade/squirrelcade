import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { commonsFilePage, consoleArticle } from '@squirrelcade/core';
import type { Logger } from 'pino';
import sharp from 'sharp';
import { APP_VERSION } from './env.js';
import type { FetchLike } from './igdb.js';
import type { SettingsService } from './settings.js';

/** What is known of one console's picture: when Wikipedia was asked, and the Commons file page it came from. */
interface PictureMeta {
  at: number;
  /** A picture is kept (config/console-pictures/<key>.webp). */
  ok: boolean;
  credit: string | null;
}

/** A picture is looked for again after about three months; a console that had none (or no network) is tried again after a day. */
const REFRESH_MS = 90 * 86_400_000;
const RETRY_MS = 86_400_000;
/** The width kept: small, for a card. */
const WIDTH = 320;

/**
 * Pictures of the consoles on Roots' cards (R16): the lead photo of each console's Wikipedia article (a Wikimedia Commons
 * photo; a non-free file or a logo is skipped), fetched once in the background, shrunk to a small webp and kept in the
 * config folder. A page asks only what's kept: nothing here is awaited by a request. Off (Settings > Roots) or offline,
 * the card shows Squirrelcade's own console mark.
 */
export class ConsolePictures {
  private meta: Record<string, PictureMeta> | null = null;
  private running = false;
  /** After Wikipedia couldn't be reached: no new try until then (in memory; a restart tries again). */
  private offlineUntil = 0;
  private readonly queue = new Map<string, string>();

  constructor(
    private readonly settings: SettingsService,
    private readonly dir: string,
    private readonly log: Logger,
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly pauseMs = 1000,
  ) {}

  enabled(): boolean {
    return this.settings.get('roots.consolePictures');
  }

  private metaFile(): string {
    return join(this.dir, 'meta.json');
  }

  private load(): Record<string, PictureMeta> {
    if (this.meta) return this.meta;
    try {
      this.meta = JSON.parse(readFileSync(this.metaFile(), 'utf8')) as Record<string, PictureMeta>;
    } catch {
      this.meta = {};
    }
    return this.meta;
  }

  private save(): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      writeFileSync(this.metaFile(), JSON.stringify(this.load()));
    } catch (err) {
      this.log.warn({ context: 'console-pictures' }, `Couldn't save the console pictures' list: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private fileOf(key: string): string {
    return join(this.dir, `${key}.webp`);
  }

  /** A console's kept picture (its address, with the day it was kept for the browser's cache) and its credit, or null. */
  info(key: string): { url: string; credit: string | null } | null {
    if (!this.enabled() || !/^[a-z0-9-]+$/.test(key)) return null;
    const m = this.load()[key];
    return m?.ok && existsSync(this.fileOf(key)) ? { url: `/api/v1/history/picture/${key}?v=${Math.floor(m.at / 86_400_000)}`, credit: m.credit } : null;
  }

  /** The kept picture's bytes, or null. */
  file(key: string): Buffer | null {
    if (!this.enabled() || !/^[a-z0-9-]+$/.test(key) || !this.load()[key]?.ok) return null;
    try {
      return readFileSync(this.fileOf(key));
    } catch {
      return null;
    }
  }

  /** Asks for the pictures of the consoles that have none (or an old one), without waiting: they come in the background, one at a time. */
  ensure(consoles: readonly { key: string; name: string }[]): void {
    if (!this.enabled() || Date.now() < this.offlineUntil) return;
    const meta = this.load();
    const now = Date.now();
    for (const c of consoles) {
      const m = meta[c.key];
      const due = !m || now - m.at > (m.ok ? REFRESH_MS : RETRY_MS);
      if (due && !this.queue.has(c.key)) this.queue.set(c.key, consoleArticle(c.key, c.name));
    }
    if (this.queue.size > 0 && !this.running) {
      this.running = true;
      void this.work();
    }
  }

  /** Resolves when the background work is done (tests). */
  async idle(): Promise<void> {
    while (this.running) await new Promise((r) => setTimeout(r, 10));
  }

  private async work(): Promise<void> {
    try {
      while (this.queue.size > 0) {
        const [key, title] = this.queue.entries().next().value as [string, string];
        this.queue.delete(key);
        if (!this.enabled()) break;
        let offline = false;
        try {
          const kept = await this.fetchOne(key, title);
          this.load()[key] = { at: Date.now(), ok: kept !== null, credit: kept };
        } catch (err) {
          offline = true;
          this.load()[key] = { at: Date.now(), ok: false, credit: null };
          this.log.info({ context: 'console-pictures' }, `No picture for ${key} this time: ${err instanceof Error ? err.message : String(err)}`);
        }
        this.save();
        if (offline) {
          // No network: the rest wait (ten minutes) instead of failing one by one.
          this.offlineUntil = Date.now() + 600_000;
          this.queue.clear();
          break;
        }
        if (this.queue.size > 0) await new Promise((r) => setTimeout(r, this.pauseMs));
      }
    } finally {
      this.running = false;
    }
  }

  /** The credit ("https://commons.wikimedia.org/wiki/File:X.jpg") of the picture kept for a console; null when the article has no usable photo. Throws when Wikipedia can't be reached. */
  private async fetchOne(key: string, title: string): Promise<string | null> {
    const headers = { 'User-Agent': `Squirrelcade/${APP_VERSION} (+https://github.com/squirrelcade/squirrelcade; self-hosted game collection app)`, 'Api-User-Agent': `Squirrelcade/${APP_VERSION}` };
    const res = await this.fetchImpl(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}?redirect=true`, { headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Wikipedia answered ${res.status}`);
    const page = (await res.json()) as { thumbnail?: { source?: string }; originalimage?: { source?: string } };
    const source = page.thumbnail?.source ?? page.originalimage?.source;
    if (!source) return null;
    // Commons photos only: a non-free file (a box or a logo kept on en.wikipedia) isn't ours to keep, and a logo isn't a picture of the console.
    const credit = commonsFilePage(source);
    if (!credit || /logo|wordmark|icon|symbol|emblem/i.test(decodeURIComponent(credit))) return null;
    const image = await this.fetchImpl(source, { headers });
    if (!image.ok) throw new Error(`Wikimedia answered ${image.status}`);
    const data = await sharp(Buffer.from(await image.arrayBuffer()), { failOn: 'none' })
      .resize({ width: WIDTH, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(this.fileOf(key), data);
    return credit;
  }
}
