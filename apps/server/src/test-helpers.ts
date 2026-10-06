import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { eq } from 'drizzle-orm';
import { FEATURE_SETTINGS, type FeatureKey } from '@squirrelcade/core';
import { buildApp, type SquirrelcadeApp } from './app.js';
import type { SourceEntry } from './catalogs.js';
import { exclusions, ownershipMappings, platforms } from './db/schema.js';
import type { PsnApi, XboxGet } from './achievements.js';
import type { FetchLike } from './igdb.js';
import type { BarcodePacing, ProductNameLookup } from './lookup.js';
import type { MailMessage, PushMessage, Transports } from './notifications.js';
import type { ExportDownloader, MailboxOpener } from './mailImport.js';

export const HEADER =
  'id,product-name,console-name,price-in-pennies,include-string,condition-string,sku,notes,cost-basis-in-pennies,quantity,date-entered,date-purchased,grading-company,grading-cert-id,folder';

/** A small PriceCharting export: each game is [id, title, console, cents, include]. */
export function exportCsv(games: [string, string, string, number, string?][]): string {
  return [HEADER, ...games.map(([id, title, label, cents, inc]) => `${id},"${title}",${label},${cents},"${inc ?? 'Item, Box, and Manual'}",,,,0,1,2026-01-01,,,,`)].join('\n');
}

export interface CatalogSeed {
  /** Owned games: [product id, title, PriceCharting console name]. */
  owned: [string, string, string][];
  /** Catalog games by platform key: titles, or entries with a status, format and so on. */
  catalogs: Record<string, (string | SourceEntry)[]>;
  /** Owned titles that count as catalog games (compilations). */
  mappings?: { platform: string; owned: string; satisfies: string; counts?: 'yes' | 'conditional' | 'no' }[];
  /** Target and wishlist exclusions. */
  exclusions?: { platform: string; title: string; action: 'exclude' | 'hide' | 'defer' | 'below-price'; until?: string; belowCents?: number }[];
}

/** Imports a collection, then builds catalogs (as a catalog source would), mappings and exclusions. */
export function seedCatalogs(g: SquirrelcadeApp, seed: CatalogSeed): void {
  if (seed.owned.length > 0) {
    const csv = exportCsv(seed.owned.map(([id, title, label]): [string, string, string, number] => [id, title, label, 1000]));
    const outcome = g.collection.importText(csv, { source: 'upload', fileName: 'collection_20260101.csv' });
    if (outcome.import.status !== 'applied') throw new Error(`The seed collection was ${outcome.import.status}`);
  }
  for (const [platform, entries] of Object.entries(seed.catalogs)) {
    const result = g.catalogs.syncSource(platform, 'test', entries.map((e) => (typeof e === 'string' ? { title: e } : e)));
    if (!result) throw new Error(`Unknown platform ${platform}`);
  }
  const platformId = (key: string) => g.db.select({ id: platforms.id }).from(platforms).where(eq(platforms.key, key)).get()!.id;
  for (const m of seed.mappings ?? []) {
    g.db
      .insert(ownershipMappings)
      .values({ platformId: platformId(m.platform), ownedTitle: m.owned, satisfiesTitle: m.satisfies, type: 'Compilation', counts: m.counts ?? 'yes', notes: null, source: 'test' })
      .run();
  }
  for (const x of seed.exclusions ?? []) {
    g.db
      .insert(exclusions)
      .values({ platformId: platformId(x.platform), title: x.title, action: x.action, until: x.until ?? null, belowCents: x.belowCents ?? null, reason: null, active: true, source: 'test' })
      .run();
  }
  g.catalogs.invalidate();
  g.wishlist.invalidate();
}

export type TestApp = SquirrelcadeApp & {
  dir: string;
  /** Closes this instance and starts a new one on the same config folder, in place. */
  /** Closes this instance and starts a new one on the same config folder; history data can change, as in an update. */
  restart: (options?: { startTasks?: boolean; top100Data?: unknown; historyData?: unknown }) => Promise<void>;
  cleanup: () => Promise<void>;
};

/** Tests never reach the internet. */
const noNetwork: FetchLike = async (url) => {
  throw new Error(`No network in tests: ${url}`);
};

/** A request a push or chat service got: its address, headers and JSON body. */
export interface PostedRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Email, Pushover and web-service stand-ins that remember what they were asked to send. `fail.post` makes the web
 * services whose address contains its key answer 500 with its text.
 */
export function fakeTransports(fail: { email?: string; pushover?: string; post?: Record<string, string> } = {}) {
  const sent = { mail: [] as MailMessage[], push: [] as PushMessage[], posts: [] as PostedRequest[] };
  const transports: Transports = {
    sendMail: async (m) => {
      if (fail.email) throw new Error(fail.email);
      sent.mail.push(m);
    },
    pushover: async (m) => {
      if (fail.pushover) throw new Error(fail.pushover);
      sent.push.push(m);
    },
    post: async (url, init) => {
      const refusal = Object.entries(fail.post ?? {}).find(([key]) => url.includes(key));
      if (refusal) return new Response(refusal[1], { status: 500 });
      sent.posts.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      return Response.json({ ok: true });
    },
  };
  return { sent, transports };
}

export async function testApp(
  options: {
    productNameLookup?: ProductNameLookup;
    barcodePacing?: BarcodePacing;
    upcDatabaseLookup?: ProductNameLookup;
    raFetch?: FetchLike;
    xboxGet?: XboxGet;
    psnApi?: PsnApi;
    steamApiFetch?: FetchLike;
    transports?: Transports;
    igdbFetch?: FetchLike;
    wikipediaFetch?: FetchLike;
    rommFetch?: FetchLike;
    nintendoLifeFetch?: FetchLike;
    listFetch?: FetchLike;
    steamFetch?: FetchLike;
    itadFetch?: FetchLike;
    ggdealsFetch?: FetchLike;
    mailbox?: MailboxOpener;
    exportDownload?: ExportDownloader;
    /** AI apps' sign-in: client metadata documents and Cloudflare Access's keys. */
    aiFetch?: typeof fetch;
    /** Optional parts to turn on (Settings > Features), such as the PC library. */
    features?: FeatureKey[];
    top100Data?: unknown;
    historyData?: unknown;
  } = {},
): Promise<TestApp> {
  const dir = mkdtempSync(join(tmpdir(), 'squirrelcade-test-'));
  const transports = options.transports ?? fakeTransports().transports;
  const build = (startTasks = false, data: { top100Data?: unknown; historyData?: unknown } = {}) =>
    buildApp({
      env: { configDir: dir, webDir: null },
      quiet: true,
      startTasks,
      productNameLookup: options.productNameLookup ?? (async () => null),
      barcodePacing: options.barcodePacing,
      upcDatabaseLookup: options.upcDatabaseLookup,
      raFetch: options.raFetch ?? noNetwork,
      steamApiFetch: options.steamApiFetch ?? noNetwork,
      xboxGet: options.xboxGet ?? (async () => {
        throw new Error('No network in tests');
      }),
      psnApi: options.psnApi ?? {
        signIn: async () => {
          throw new Error('No network in tests');
        },
        refresh: async () => {
          throw new Error('No network in tests');
        },
        titles: async () => {
          throw new Error('No network in tests');
        },
      },
      transports,
      igdbFetch: options.igdbFetch ?? noNetwork,
      wikipediaFetch: options.wikipediaFetch ?? noNetwork,
      rommFetch: options.rommFetch ?? noNetwork,
      nintendoLifeFetch: options.nintendoLifeFetch ?? noNetwork,
      listFetch: options.listFetch ?? noNetwork,
      steamFetch: options.steamFetch ?? noNetwork,
      itadFetch: options.itadFetch ?? noNetwork,
      ggdealsFetch: options.ggdealsFetch ?? noNetwork,
      mailbox: options.mailbox ?? (async () => {
        throw new Error('No mailbox in tests');
      }),
      exportDownload: options.exportDownload ?? (async () => {
        throw new Error('No network in tests');
      }),
      aiFetch: options.aiFetch ?? (noNetwork as unknown as typeof fetch),
      top100Data: data.top100Data ?? options.top100Data,
      historyData: data.historyData ?? options.historyData,
    });
  const holder = { ...(await build()), dir } as TestApp;
  if (options.features?.length) holder.settings.update(Object.fromEntries(options.features.map((f) => [FEATURE_SETTINGS[f], true])));
  holder.restart = async (restartOptions) => {
    await holder.close();
    Object.assign(holder, await build(restartOptions?.startTasks ?? false, { top100Data: restartOptions?.top100Data, historyData: restartOptions?.historyData }));
  };
  holder.cleanup = async () => {
    await holder.close();
    rmSync(dir, { recursive: true, force: true });
  };
  return holder;
}

/** A zip file holding the given files, deflated, the way PriceCharting sends collection.zip. */
export function makeZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const packed = deflateRawSync(data);
    const fileName = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    parts.push(local, fileName, packed);
    directory.push(central, fileName);
    offset += 30 + fileName.length + packed.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dir, end]);
}

/** The lines of a CSV download (without the byte-order mark). */
export function csvLines(body: string): string[] {
  return body.replace(/^\uFEFF/, '').trimEnd().split('\r\n');
}

/** Creates the first account and returns its session cookie. */
export async function setUp(g: SquirrelcadeApp, username = 'admin', password = 'correct horse'): Promise<Record<string, string>> {
  const res = await g.app.inject({ method: 'POST', url: '/api/v1/setup', payload: { username, password } });
  if (res.statusCode !== 201) throw new Error(`setup failed: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'squirrelcade_session');
  return { squirrelcade_session: cookie!.value };
}

/** Multipart body for a binary file upload. */
export function multipartFile(fileName: string, content: Buffer, contentType = 'application/octet-stream'): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----squirrelcade-test-boundary';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, content, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

/** Multipart body for a form: a file (its type given) and text fields beside it. */
export function multipartForm(fields: Record<string, string>, file: { name: string; content: Buffer; type: string }): { payload: Buffer; headers: Record<string, string> } {
  const boundary = '----squirrelcade-test-boundary';
  const line = (...parts: string[]) => Buffer.from(parts.join('\r\n'));
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(line(`--${boundary}`, `Content-Disposition: form-data; name="${name}"`, '', value, ''));
  parts.push(line(`--${boundary}`, `Content-Disposition: form-data; name="file"; filename="${file.name}"`, `Content-Type: ${file.type}`, '', ''), file.content, line('', `--${boundary}--`, ''));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

export function multipart(fileName: string, content: string): { payload: string; headers: Record<string, string> } {
  const boundary = '----squirrelcade-test-boundary';
  const payload = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
    'Content-Type: text/csv',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n');
  return { payload, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}
