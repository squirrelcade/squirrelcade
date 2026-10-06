import { COMPLETENESS_LABELS, normalizeTitle, PLAY_LABELS, REGION_LABELS, type Completeness, type PlayStatus, type Region } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import { shown, type Sees } from './access.js';
import type { CatalogService } from './catalogs.js';
import type { CollectionService } from './collection.js';
import type { CopyDetailsService } from './copyDetails.js';
import type { CopyCareService } from './copyCare.js';
import type { Db } from './db/index.js';
import { catalogEntries } from './db/schema.js';
import type { HistoryService } from './history.js';
import type { IgdbService } from './igdb.js';
import type { NotesService } from './notes.js';
import type { PcService } from './pc.js';
import type { PlayService } from './play.js';
import type { SettingsService } from './settings.js';
import type { WishlistService } from './wishlist.js';
import { buildWorkbook, type Cell, type Sheet } from './xlsx.js';

/** What the reports read from the rest of Squirrelcade. */
export interface ReportDeps {
  db: Db;
  settings: SettingsService;
  collection: CollectionService;
  catalogs: CatalogService;
  wishlist: WishlistService;
  igdb: IgdbService;
  notes: NotesService;
  play: PlayService;
  details: CopyDetailsService;
  pc: PcService;
  history: HistoryService;
  /** Estimates of what copies without a price paid cost (copyCare.ts). */
  care?: CopyCareService;
}

/** A count by something (a console, a condition, a decade...), for a bar of a chart. */
export interface Bar {
  label: string;
  count: number;
  cents?: number;
}

/** The Statistics page (GET /api/v1/collection/statistics). */
export interface Statistics {
  currency: string;
  totals: { games: number; copies: number; valueCents: number; costCents: number | null; sealed: number; consoles: number };
  /** The owner's estimates of the prices they don't know, together (D85): null when prices paid aren't shown. */
  estimated: { cents: number; copies: number } | null;
  consoles: (Bar & { key: string | null; games: number })[];
  conditions: Bar[];
  regions: Bar[];
  /** Games by the decade they came out (IGDB's first release on the console); games IGDB doesn't know are left out. */
  decades: Bar[];
  genres: Bar[];
  /** Copies by the year they were added to the collection. */
  added: Bar[];
  /** What was paid, by the year bought (with what the owner paid shown). */
  spending: Bar[] | null;
  mostValuable: { title: string; platform: string; condition: string; valueCents: number }[];
  /** Games by play status, and the ones finished each year (with what they played shown). */
  play: { statuses: Bar[]; finished: Bar[] } | null;
}

/** The printable report (GET /api/v1/collection/report): every copy by console, with totals. */
export interface CollectionReport {
  instanceName: string;
  generatedAt: string;
  pricesAsOf: string | null;
  currency: string;
  totals: { games: number; copies: number; valueCents: number; costCents: number | null };
  consoles: {
    platform: string;
    games: number;
    copies: number;
    valueCents: number;
    costCents: number | null;
    items: { title: string; condition: string; region: string; quantity: number; valueCents: number | null; costCents: number | null; location: string | null; photos: number }[];
  }[];
}

const bump = <K>(map: Map<K, Bar>, key: K, label: string, count = 1, cents = 0) => {
  const bar = map.get(key) ?? { label, count: 0, cents: 0 };
  bar.count += count;
  bar.cents = (bar.cents ?? 0) + cents;
  map.set(key, bar);
};
const byCount = (a: Bar, b: Bar) => b.count - a.count || a.label.localeCompare(b.label);
const byLabel = (a: Bar, b: Bar) => a.label.localeCompare(b.label);

type Item = ReturnType<CollectionService['items']>['items'][number];

/** The collection's copies, every one, by console and title. */
const allItems = (deps: ReportDeps): Item[] => deps.collection.items({ all: true, sort: 'platform' }).items;

/** The title a copy counts as in its console's catalog (for IGDB, play status and notes), or its own. */
const titleOf = (deps: ReportDeps, item: Item) => (item.platformKey ? (deps.catalogs.titlesOfOwned(item.platformKey, item.productId)[0] ?? item.title) : item.title);

export function statistics(deps: ReportDeps, may: Sees): Statistics {
  const items = allItems(deps);
  const consoles = new Map<string, Bar & { key: string | null; games: number; products: Set<string> }>();
  const conditions = new Map<string, Bar>();
  const regions = new Map<string, Bar>();
  const decades = new Map<string, Bar>();
  const genres = new Map<string, Bar>();
  const added = new Map<string, Bar>();
  const spending = new Map<string, Bar>();
  const products = new Set<string>();
  const games = new Set<string>();
  let copies = 0;
  let valueCents = 0;
  let costCents = 0;
  let sealed = 0;
  for (const item of items) {
    const value = (item.valueCents ?? 0) * item.quantity;
    products.add(item.productId);
    copies += item.quantity;
    valueCents += value;
    costCents += (item.costCents ?? 0) * item.quantity;
    if (item.sealed) sealed += item.quantity;
    const platform = item.platform ?? 'Other';
    const c = consoles.get(platform) ?? { label: platform, key: item.platformKey, count: 0, cents: 0, games: 0, products: new Set<string>() };
    c.count += item.quantity;
    c.cents = (c.cents ?? 0) + value;
    c.products.add(item.productId);
    consoles.set(platform, c);
    bump(conditions, item.completeness, COMPLETENESS_LABELS[item.completeness as Completeness] ?? item.completeness, item.quantity, value);
    bump(regions, item.region, REGION_LABELS[item.region as Region] ?? item.region, item.quantity, value);
    if (item.dateEntered) bump(added, item.dateEntered.slice(0, 4), item.dateEntered.slice(0, 4), item.quantity, value);
    const bought = item.datePurchased ?? item.dateEntered;
    if (may.paid && bought && item.costCents) bump(spending, bought.slice(0, 4), bought.slice(0, 4), item.quantity, item.costCents * item.quantity);
    // Decades and genres count games (a game once per console), from IGDB.
    if (item.platformKey) {
      const name = titleOf(deps, item);
      const key = `${item.platformKey}|${normalizeTitle(name)}`;
      if (games.has(key)) continue;
      games.add(key);
      const game = deps.igdb.findByKey(item.platformKey, name) ?? deps.igdb.findByKey(item.platformKey, item.title);
      const year = Number(game?.released?.slice(0, 4));
      if (year > 1900) bump(decades, `${Math.floor(year / 10) * 10}s`, `${Math.floor(year / 10) * 10}s`);
      for (const g of game?.genres ?? []) bump(genres, g, g);
    }
  }
  let play: Statistics['play'] = null;
  if (may.play) {
    const owned = deps.play.owned();
    const statuses = new Map<string, Bar>();
    const finished = new Map<string, Bar>();
    for (const g of owned) {
      bump(statuses, g.status ?? 'unmarked', g.status ? PLAY_LABELS[g.status as PlayStatus] : 'Not marked');
      if (g.finishedAt && (g.status === 'beaten' || g.status === 'completed')) bump(finished, g.finishedAt.slice(0, 4), g.finishedAt.slice(0, 4));
    }
    play = { statuses: [...statuses.values()].sort(byCount), finished: [...finished.values()].sort(byLabel) };
  }
  return {
    currency: deps.settings.get('general.currency'),
    totals: { games: products.size, copies, valueCents, costCents: may.paid ? costCents : null, sealed, consoles: consoles.size },
    estimated: may.paid && deps.care ? deps.care.estimatedTotal() : null,
    consoles: [...consoles.values()].map(({ products: p, ...c }) => ({ ...c, games: p.size })).sort(byCount),
    conditions: [...conditions.values()].sort(byCount),
    regions: [...regions.values()].sort(byCount),
    decades: [...decades.values()].sort(byLabel),
    genres: [...genres.values()].sort(byCount).slice(0, 15),
    added: [...added.values()].sort(byLabel),
    spending: may.paid ? [...spending.values()].sort(byLabel) : null,
    // Copies of the same product in the same condition are listed once (each copy is a row of its own since 0.19.0).
    mostValuable: [...new Map(items.map((i) => [`${i.productId}|${i.includeString}`, i])).values()]
      .filter((i) => (i.valueCents ?? 0) > 0)
      .sort((a, b) => (b.valueCents ?? 0) - (a.valueCents ?? 0))
      .slice(0, 10)
      .map((i) => ({ title: i.title, platform: i.platform ?? 'Other', condition: COMPLETENESS_LABELS[i.completeness as Completeness] ?? i.completeness, valueCents: i.valueCents ?? 0 })),
    play,
  };
}

export function collectionReport(deps: ReportDeps, may: Sees): CollectionReport {
  const items = allItems(deps);
  const extras = may.details ? deps.details.extras() : null;
  const summary = deps.collection.stats();
  const groups = new Map<string, CollectionReport['consoles'][number] & { products: Set<string> }>();
  const products = new Set<string>();
  let copies = 0;
  let valueCents = 0;
  let costCents = 0;
  for (const item of items) {
    const platform = item.platform ?? 'Other';
    const g = groups.get(platform) ?? { platform, games: 0, copies: 0, valueCents: 0, costCents: may.paid ? 0 : null, items: [], products: new Set<string>() };
    const key = item.key;
    g.products.add(item.productId);
    g.copies += item.quantity;
    g.valueCents += (item.valueCents ?? 0) * item.quantity;
    if (g.costCents !== null) g.costCents += (item.costCents ?? 0) * item.quantity;
    g.items.push({
      title: item.title,
      condition: COMPLETENESS_LABELS[item.completeness as Completeness] ?? item.completeness,
      region: REGION_LABELS[item.region as Region] ?? item.region,
      quantity: item.quantity,
      valueCents: item.valueCents,
      costCents: may.paid ? item.costCents : null,
      location: extras?.details.get(key)?.location ?? null,
      photos: extras?.photos.get(key) ?? 0,
    });
    groups.set(platform, g);
    products.add(item.productId);
    copies += item.quantity;
    valueCents += (item.valueCents ?? 0) * item.quantity;
    costCents += (item.costCents ?? 0) * item.quantity;
  }
  return {
    instanceName: deps.settings.get('general.instanceName') || 'Squirrelcade',
    generatedAt: new Date().toISOString(),
    pricesAsOf: summary.pricesAsOf,
    currency: deps.settings.get('general.currency'),
    totals: { games: products.size, copies, valueCents, costCents: may.paid ? costCents : null },
    consoles: [...groups.values()].map(({ products: p, ...g }) => ({ ...g, games: p.size })).sort((a, b) => a.platform.localeCompare(b.platform)),
  };
}

const money = (cents: number | null | undefined): Cell => ({ cents: cents ?? null });

/** The workbook's sheets: everything the requester may see, one tab each. */
export function workbookSheets(deps: ReportDeps, may: Sees): Sheet[] {
  const currency = deps.settings.get('general.currency') || 'USD';
  const items = allItems(deps);
  const sheets: Sheet[] = [];
  const extras = may.details ? deps.details.extras() : null;
  const plays = may.play ? deps.play.index() : null;
  const notes = may.notes ? deps.notes.index() : null;

  // Summary: each console's games, copies and value.
  const report = collectionReport(deps, may);
  sheets.push({
    name: 'Summary',
    header: ['Console', 'Games', 'Copies', `Value (${currency})`, ...(may.paid ? [`Paid (${currency})`] : [])],
    rows: [
      ...report.consoles.map((c) => [c.platform, c.games, c.copies, money(c.valueCents), ...(may.paid ? [money(c.costCents)] : [])]),
      ['All consoles', report.totals.games, report.totals.copies, money(report.totals.valueCents), ...(may.paid ? [money(report.totals.costCents)] : [])],
    ],
  });

  // Collection: every copy, with what Squirrelcade adds to PriceCharting's columns.
  sheets.push({
    name: 'Collection',
    header: [
      'Title',
      'Console',
      'PriceCharting console',
      'Region',
      'Condition',
      'Sealed',
      'Copies',
      `Value each (${currency})`,
      ...(may.paid ? [`Paid each (${currency})`] : []),
      'Added',
      'Bought',
      'Counts as',
      'Series',
      ...(plays ? ['Played', 'Your rating'] : []),
      ...(extras ? ['Where it is', 'Tags', 'Lent to', 'For sale or trade', `Asking (${currency})`, 'Photos'] : []),
      ...(notes ? ['Your note'] : []),
    ],
    rows: items.map((item) => {
      const counts = item.platformKey ? deps.catalogs.titlesOfOwned(item.platformKey, item.productId)[0] : undefined;
      const name = counts ?? item.title;
      const counted = counts ?? (item.platformKey && deps.catalogs.matchOf(item.platformKey) ? 'not in the catalog' : '');
      const d = extras?.details.get(item.key);
      const play = plays && item.platformKey ? deps.play.ofCopy(plays, item.platformKey, item.productId, item.title) : null;
      return [
        item.title,
        item.platform ?? '',
        item.consoleLabel,
        REGION_LABELS[item.region as Region] ?? item.region,
        COMPLETENESS_LABELS[item.completeness as Completeness] ?? item.includeString,
        item.sealed ? 'yes' : '',
        item.quantity,
        money(item.valueCents),
        ...(may.paid ? [money(item.costCents)] : []),
        item.dateEntered ?? '',
        item.datePurchased ?? '',
        counted,
        item.platformKey ? (deps.igdb.findByKey(item.platformKey, name)?.franchise ?? '') : '',
        ...(plays ? [play?.status ? PLAY_LABELS[play.status] : '', play?.rating ?? null] : []),
        ...(extras ? [d?.location ?? '', (d?.tags ?? []).join(', '), (extras.lentTo.get(item.key) ?? []).join(', '), d?.sale ?? '', money(d?.askingCents), extras.photos.get(item.key) ?? null] : []),
        ...(notes ? [(item.platformKey && notes.get(`${item.platformKey}|${normalizeTitle(name)}`)) || ''] : []),
      ];
    }),
  });

  // The wishlist, best first.
  const wishlist = deps.wishlist.compute();
  sheets.push({
    name: 'Wishlist',
    header: ['Rank', 'Title', 'Console', 'Priority', 'Acorns'],
    rows: wishlist.master.map((m) => [m.rank, m.title, m.platformName, m.priority, m.masterScore]),
  });

  // Each console's catalog games you don't have yet.
  const released = new Map(deps.db.select({ id: catalogEntries.id, releaseDate: catalogEntries.releaseDate }).from(catalogEntries).all().map((e) => [e.id, e.releaseDate]));
  const missing: Cell[][] = [];
  for (const c of deps.catalogs.summary()) {
    for (const t of deps.catalogs.matchOf(c.key)?.targets ?? []) {
      if (t.status !== 'missing') continue;
      const scored = wishlist.index.get(`${c.key}|${normalizeTitle(t.target.title)}`);
      missing.push([c.name, t.target.title, released.get(t.target.id) ?? '', scored?.priority ?? '', scored?.rank ?? null]);
    }
  }
  sheets.push({ name: 'Missing', header: ['Console', 'Title', 'Released', 'Wishlist priority', 'Wishlist rank'], rows: missing });

  if (plays) {
    sheets.push({
      name: 'Played',
      header: ['Title', 'Console', 'Status', 'Your rating', 'Started', 'Finished'],
      rows: deps.play
        .owned()
        .filter((g) => g.status || g.rating)
        .map((g) => [g.title, g.platform, g.status ? PLAY_LABELS[g.status] : '', g.rating, g.startedAt ?? '', g.finishedAt ?? '']),
    });
  }

  if (extras) {
    const { open, returned } = deps.details.loans();
    sheets.push({
      name: 'Loans',
      header: ['Title', 'Console', 'Lent to', 'Lent', 'Due back', 'Given back', 'Note'],
      rows: [...open, ...returned].map((l) => [l.title, l.platform ?? '', l.lentTo, l.lentAt, l.dueAt ?? '', l.returnedAt ?? (l.overdue ? 'overdue' : ''), l.note ?? '']),
    });
    sheets.push({
      name: 'For sale',
      header: ['Title', 'Console', 'Condition', 'Copies', 'Sale or trade', `Asking (${currency})`, `Value each (${currency})`, 'Note'],
      rows: deps.details.forSale().map((s) => [s.title, s.platform ?? '', s.condition, s.quantity, s.sale, money(s.askingCents), money(s.valueCents), s.saleNote ?? '']),
    });
  }

  if (notes) {
    sheets.push({
      name: 'Notes',
      header: ['Console', 'Title', 'Note', 'Changed'],
      rows: deps.notes.list().map((n) => [n.platform, n.title, n.note, n.updatedAt.slice(0, 10)]),
    });
  }

  if (may.pc && deps.pc.enabled()) {
    sheets.push({
      name: 'PC library',
      header: ['Title', 'Storefronts', 'Owned for good', 'Hours played', 'Last played', 'Console copies'],
      rows: deps.pc
        .families()
        .map((f) => [
          f.title,
          [...new Set(f.records.map((r) => r.storefront))].join(', '),
          f.owned ? 'yes' : '',
          f.playtimeHours || null,
          f.lastActivityAt?.slice(0, 10) ?? '',
          f.consoles.map((c) => c.platform).join(', '),
        ]),
    });
  }

  if (deps.history.enabled()) {
    const rows: Cell[][] = [];
    // The lists of the consoles you have games on (a list for a console you don't collect says little).
    const collected = new Set(deps.collection.summary().platforms.map((p) => p.key));
    for (const key of deps.history.available().top100.filter((k) => collected.has(k))) {
      const view = deps.history.top100View(key, { pc: may.pc, romm: false, play: may.play });
      if (!view) continue;
      for (const r of view.rows) rows.push([view.platform, r.rank, r.title, r.year, r.owned === 'owned' ? 'yes' : r.owned === 'review' || r.owned === 'maybe' ? 'maybe' : '', ...(may.play ? [r.play?.status ? PLAY_LABELS[r.play.status] : ''] : [])]);
    }
    if (rows.length > 0) sheets.push({ name: 'Top 100', header: ['Console', 'Rank', 'Title', 'Year', 'Owned', ...(may.play ? ['Played'] : [])], rows });
  }
  return sheets;
}

/** Statistics, the printable report and the workbook (Collection > Statistics, Report, and Download > Excel workbook). */
export function registerReportRoutes(app: FastifyInstance, deps: ReportDeps): void {
  app.get('/api/v1/collection/statistics', async (request) => statistics(deps, shown(request)));
  app.get('/api/v1/collection/report', async (request) => collectionReport(deps, shown(request)));
  app.get('/api/v1/export/workbook', async (request, reply) => {
    const data = buildWorkbook(workbookSheets(deps, shown(request)));
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="squirrelcade-${date}.xlsx"`)
      .send(data);
  });
}
