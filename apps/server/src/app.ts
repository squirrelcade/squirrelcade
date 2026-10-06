import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { FEATURE_SETTINGS, normalizeTitle, settingDefinitions, type FeatureKey, type SettingDefinition } from '@squirrelcade/core';
import { eq } from 'drizzle-orm';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { AiAuthService, registerAiAuthRoutes } from './aiAuth.js';
import { AiTools } from './aiTools.js';
import { AuthService, registerAuth } from './auth.js';
import { BackupService, registerBackupRoutes } from './backups.js';
import { CatalogService, registerCatalogRoutes } from './catalogs.js';
import { registerOwnCopyRoutes } from './ownCopies.js';
import { CopyCareService, registerCopyCareRoutes } from './copyCare.js';
import { registerSellingRoutes, SellingService } from './selling.js';
import { registerRommRoutes, RommClient, RommService } from './romm.js';
import { CollectionService, registerCollectionRoutes } from './collection.js';
import { applyPendingRestore, openDatabase, type Db } from './db/index.js';
import { appState } from './db/schema.js';
import { APP_VERSION, readEnv, type Env } from './env.js';
import { IgdbClient, IgdbService, registerIgdbRoutes, type FetchLike } from './igdb.js';
import { CatalogBuilder, registerCatalogSourceRoutes, WikipediaClient } from './wikipedia.js';
import { AddedSources, registerAddedSourceRoutes } from './addedSources.js';
import { NintendoLifeSource } from './nintendolife.js';
import { PcService, registerPcRoutes } from './pc.js';
import { PcWishlistService, registerPcWishlistRoutes } from './pcWishlist.js';
import { LookupService, registerLookupRoutes, type BarcodePacing, type ProductNameLookup } from './lookup.js';
import { createLogger, type AppLogger } from './logger.js';
import { NotificationService, registerNotificationRoutes, type Transports } from './notifications.js';
import { computeHealth, importFolder, registerSettingsRoutes, registerSystemRoutes } from './routes.js';
import { registerAiSetupRoutes } from './aiSetup.js';
import { SettingsError, SettingsService } from './settings.js';
import { registerCheckRoutes } from './check.js';
import { CopiesService, registerCopiesRoutes } from './copies.js';
import { CopyDetailsService, registerCopyDetailRoutes } from './copyDetails.js';
import { catalogTarget, registerGameRoutes } from './games.js';
import { ItadClient, PcPriceService, registerPcPriceRoutes, type PcPrice } from './itad.js';
import { GgDealsService, ggAsPcPrice, type GgPrice } from './ggdeals.js';
import { registerRetroAchievementsRoutes, RetroAchievementsService } from './retroachievements.js';
import { AchievementsService, registerAchievementRoutes, xboxHttpsGet, type PsnApi, type XboxGet } from './achievements.js';
import { psnApi } from './psn.js';
import { MailImportService, registerMailRoutes, type ExportDownloader, type MailboxOpener } from './mailImport.js';
import { registerMcpRoute } from './mcp.js';
import { FriendsService, registerFriendRoutes } from './friends.js';
import { GameOfTheDayService, registerGotdRoutes } from './gotd.js';
import { DealsService, registerDealRoutes } from './deals.js';
import { registerTodayRoutes } from './today.js';
import { PlayService, registerPlayRoutes } from './play.js';
import { registerReportRoutes } from './reports.js';
import { registerShareRoutes, ShareService } from './share.js';
import { HistoryService, registerHistoryRoutes } from './history.js';
import { TitleIndex } from './titleIndex.js';
import { NotesService } from './notes.js';
import { RELEASE_CHECK_MS, ReleaseReminders } from './reminders.js';
import { registerSeriesRoutes, SeriesService } from './series.js';
import { registerCollectionExport } from './collectionExport.js';
import { registerSetRoutes, SetsService } from './sets.js';
import { registerTaskRoutes, TaskRunner } from './tasks.js';
import { registerWishlistRoutes, WishlistService } from './wishlist.js';

/** The API of each optional part (Settings > Features), refused while the part is off. */
const FEATURE_ROUTES: [RegExp, FeatureKey, string][] = [
  [/^\/api\/v1\/pc(\/|$)/, 'pc', 'The PC library'],
  [/^\/api\/v1\/pc\/prices(\/|$)/, 'itad', 'PC game prices'],
  [/^\/api\/v1\/sources\/romm(\/|$)/, 'romm', 'RomM'],
  [/^\/api\/v1\/sources\/igdb(\/|$)/, 'igdb', 'IGDB'],
  [/^\/api\/v1\/history(\/|$)/, 'history', 'Top 100 lists and console history'],
  [/^\/api\/v1\/sources\/retroachievements(\/|$)/, 'retroachievements', 'RetroAchievements'],
  [/^\/api\/v1\/sources\/xbox(\/|$)/, 'xbox', 'Xbox achievements'],
  [/^\/api\/v1\/sources\/playstation(\/|$)/, 'playstation', 'PlayStation trophies'],
  [/^\/api\/v1\/sources\/steam(\/|$)/, 'steam', 'Steam achievements'],
];

/** app_state key: the health problems already alerted, so each is sent once until it clears. */
const HEALTH_ALERTED = 'health.alerted';

/** How to build the app; tests replace the outside world (mail, Pushover, IGDB, Wikipedia, barcode lookups) through these. */
export interface BuildOptions {
  env?: Partial<Env>;
  /** Tests run without console or file logging. */
  quiet?: boolean;
  startTasks?: boolean;
  /** Replaces the barcode lookup service (tests use a fake one). */
  productNameLookup?: ProductNameLookup;
  /** How fast the barcode service may be asked (tests use a short window); UPCitemdb's 6 a minute otherwise. */
  barcodePacing?: BarcodePacing;
  /** Replaces UPC Database, the second barcode service (tests use a fake one). */
  upcDatabaseLookup?: ProductNameLookup;
  /** Replaces sending by email, Pushover and the other push and chat services (tests use fakes). */
  transports?: Transports;
  /** Replaces the network for RetroAchievements (tests use a fake). */
  raFetch?: FetchLike;
  /** Replace OpenXBL (Xbox achievements) and PlayStation's API (tests use fakes). */
  xboxGet?: XboxGet;
  psnApi?: PsnApi;
  /** Replaces Steam's Web API (Steam achievements; tests use a fake, with no pause between requests). */
  steamApiFetch?: FetchLike;
  /** Replaces the network for IGDB (tests use a fake). */
  igdbFetch?: FetchLike;
  /** Replaces the network for Wikipedia (tests use a fake). */
  wikipediaFetch?: FetchLike;
  rommFetch?: FetchLike;
  /** Replaces the network for Nintendo Life (tests use a fake). */
  nintendoLifeFetch?: FetchLike;
  /** Replaces the network for the online lists added as catalog sources (tests use a fake). */
  listFetch?: FetchLike;
  /** Replaces the network for Steam's review summaries (tests use a fake). */
  steamFetch?: FetchLike;
  /** Replaces the network for IsThereAnyDeal (tests use a fake). */
  itadFetch?: FetchLike;
  /** Replaces the network for GG.deals (tests use a fake). */
  ggdealsFetch?: FetchLike;
  /** Replace the mailbox and the export download of collection updates from email (tests use fakes). */
  mailbox?: MailboxOpener;
  exportDownload?: ExportDownloader;
  /** Replaces the network for AI apps' sign-in: apps' client metadata documents and Cloudflare Access's keys (tests use a fake). */
  aiFetch?: typeof fetch;
  /** Replace the Top 100 lists and history that ship with Squirrelcade (tests use small ones). */
  top100Data?: unknown;
  historyData?: unknown;
}

/** A running Squirrelcade: the web server and every service, for main.ts and the tests. */
export interface SquirrelcadeApp {
  app: FastifyInstance;
  env: Env;
  db: Db;
  logs: AppLogger;
  settings: SettingsService;
  auth: AuthService;
  tasks: TaskRunner;
  backups: BackupService;
  collection: CollectionService;
  catalogs: CatalogService;
  wishlist: WishlistService;
  lookup: LookupService;
  notifications: NotificationService;
  igdb: IgdbService;
  catalogBuilder: CatalogBuilder;
  pc: PcService;
  pcWishlist: PcWishlistService;
  sets: SetsService;
  history: HistoryService;
  play: PlayService;
  details: CopyDetailsService;
  shares: ShareService;
  pcPrices: PcPriceService;
  mail: MailImportService;
  gotd: GameOfTheDayService;
  ra: RetroAchievementsService;
  achievements: AchievementsService;
  aiAuth: AiAuthService;
  aiTools: AiTools;
  friends: FriendsService;
  close: () => Promise<void>;
}

/** Settings that change what a catalog is built from. */
const BUILD_SETTINGS = new Set([
  'general.homeRegion',
  'catalogs.listFill',
  'catalogs.ownedUnderList',
  'catalogs.includeDigitalOnly',
  'catalogs.downloadTitles',
  'catalogs.downloadCategories',
  'catalogs.includeUnlicensed',
  'catalogs.wikipediaPages',
  'sources.catalogOrder',
  'sources.datesFrom',
  'sources.formatsFrom',
]);

/**
 * Builds Squirrelcade: opens (and if needed restores or migrates) the database, creates the services,
 * registers the API routes and background tasks, and serves the web interface when it's built.
 */
export async function buildApp(options: BuildOptions = {}): Promise<SquirrelcadeApp> {
  const env = readEnv(options.env);
  const restored = applyPendingRestore(env.configDir);
  const { db, updateBackup } = openDatabase(env.configDir, env.migrationsDir);
  const settings = new SettingsService(db);
  const logs = createLogger({ configDir: options.quiet ? undefined : env.configDir, level: settings.get('general.logLevel'), quiet: options.quiet });
  const log = logs.logger;
  if (restored) log.warn({ context: 'backup' }, `Restored a backup; the previous database was kept as squirrelcade.before-restore-${restored}.db`);
  if (updateBackup) {
    log.info({ context: 'backup' }, `Database updated (${updateBackup.migrations} change${updateBackup.migrations === 1 ? '' : 's'}); the version before is in ${updateBackup.name}`);
  }

  const trusted = settings.get('security.trustedProxies');
  const app = Fastify({
    loggerInstance: log as FastifyBaseLogger,
    // Requests aren't logged one by one; failures are logged by the error handler.
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: trusted.length > 0 ? trusted : false,
    bodyLimit: 5 * 1024 * 1024,
  });

  const auth = new AuthService(db, settings);
  const backups = new BackupService(db, env.configDir, settings);
  const collection = new CollectionService(db, settings, log);
  // Installs from before price history (and before the value by platform) start them from the updates they still keep.
  collection.backfillPrices();
  collection.backfillPlatformTotals();
  // 0.19.0: the collection's copies are Squirrelcade's own, started once from the current update (D81); 0.20.0: games marked
  // "I bought it" before are copies of Squirrelcade's own (D83).
  collection.startCopies();
  collection.startPurchases();
  const igdb = new IgdbService(db, settings, new IgdbClient(settings, options.igdbFetch, options.igdbFetch ? 0 : undefined), log);
  const catalogs = new CatalogService(db, settings, collection, log, igdb);
  const wishlist = new WishlistService(db, settings, catalogs, collection, log, igdb);
  const romm = new RommService(db, settings, new RommClient(settings, options.rommFetch), log);
  /** The RomM link for a game by the names it goes by: the IGDB game any of them is, on the platform's RomM platforms. */
  const rommLink = (platformKey: string, titles: string[]) => {
    if (!romm.enabled()) return null;
    const igdbId = titles.map((t) => igdb.findByKey(platformKey, t)?.id).find((id) => id !== undefined);
    return romm.link(platformKey, igdbId, titles);
  };
  const rommOfOwned = (platformKey: string, title: string, productId: string) => rommLink(platformKey, [title, ...catalogs.titlesOfOwned(platformKey, productId)]);
  catalogs.setRommLinks(rommLink);
  const nintendoLife = new NintendoLifeSource(db, log, options.nintendoLifeFetch);
  const wikipedia = new WikipediaClient(options.wikipediaFetch, options.wikipediaFetch ? 0 : undefined);
  // Catalog sources the user adds in Settings > Sources: an online list or a CSV file each.
  const addedSources = new AddedSources(db, log, options.listFetch);
  const catalogBuilder = new CatalogBuilder(db, settings, catalogs, collection, wikipedia, log, igdb, nintendoLife, addedSources);
  // Lists of games that aren't catalogs (sets, the Top 100 lists) find their games in the catalogs and the collection through this.
  const titles = new TitleIndex(db, catalogs, collection);
  const sets = new SetsService(db, titles, wikipedia, log);
  catalogs.setScorer((platformKey, title) => wishlist.compute().index.get(`${platformKey}|${normalizeTitle(title)}`));
  catalogs.setPreferences(() => wishlist.preferences());
  sets.setPreferences(() => wishlist.preferences());
  const upcDatabaseLookup = options.upcDatabaseLookup;
  const lookup = new LookupService(db, settings, catalogs, wishlist, log, options.productNameLookup, igdb, options.barcodePacing, upcDatabaseLookup ? () => upcDatabaseLookup : undefined);
  const notes = new NotesService(db, log);
  lookup.setRommLinks(rommLink);
  const tasks = new TaskRunner(db, log);
  const pc = new PcService(db, settings, env, log);
  const pcWishlist = new PcWishlistService(db, settings, pc, wishlist, igdb, log, options.steamFetch, options.steamFetch ? 0 : undefined);
  const notifications = new NotificationService(db, settings, collection, wishlist, log, options.transports, catalogs);
  // The owner's details on their copies (where each is kept, tags, for sale, loans, photos), and share links.
  const details = new CopyDetailsService(db, settings, notifications, log, (platformKey, title) => igdb.coverOf(platformKey, title));
  const shares = new ShareService(
    db,
    settings,
    {
      wishes: (limit) =>
        wishlist
          .compute()
          .master.slice(0, limit)
          .map((m) => ({ rank: m.rank, title: m.title, platform: m.platformName, platformKey: m.platformKey, coverId: igdb.coverOf(m.platformKey, m.title), priority: m.priority })),
      sales: () =>
        details.forSale().map((s) => ({ title: s.title, platform: s.platform ?? '', condition: s.condition, quantity: s.quantity, kind: s.sale, askingCents: s.askingCents, note: s.saleNote, coverId: s.coverId })),
    },
    log,
  );
  // PC game prices (optional, IsThereAnyDeal) for the PC wishlist.
  const pcPrices = new PcPriceService(db, settings, new ItadClient(settings, options.itadFetch), pcWishlist, notifications, log, options.itadFetch ? 0 : undefined);
  const ggdeals = new GgDealsService(db, settings, options.ggdealsFetch, log, options.ggdealsFetch ? 0 : undefined);
  // Every copy of each game across consoles and PC (the Copies page).
  const copies = new CopiesService(db, pc, { link: rommLink, enabled: () => romm.enabled() }, log);
  collection.events.on('changed', () => copies.invalidate());
  collection.events.on('remapped', () => copies.invalidate());
  pc.events.on('changed', () => copies.invalidate());
  // What the owner played (0.6.0): kept under the catalog game a copy counts as, else the copy's own title.
  const play = new PlayService(db, settings, igdb, log, (platformKey, productId, title) => catalogs.titlesOfOwned(platformKey, productId)[0] ?? title);
  const playOfNames = (platformKey: string, names: string[]) => {
    const found = play.of(platformKey, names);
    return found ? { status: found.status, rating: found.rating } : null;
  };
  const history = new HistoryService(db, settings, titles, { igdb, wishlist, pc, romm: rommLink, rommEnabled: () => romm.enabled(), play: playOfNames }, log, { top100: options.top100Data, history: options.historyData });
  collection.events.on('imported', (outcome) => {
    if (outcome.import.status === 'applied') {
      catalogs.clearFulfilledPurchases();
      // Consoles the import made tracked get their catalogs soon, not at the next daily run.
      tasks.soon('catalog-build');
    }
    notifications.imported(outcome);
  });
  // Copies moved to another console (Settings > Platforms > Region-locked consoles): everything
  // worked out per console starts over, and consoles of their own get their catalogs soon.
  collection.events.on('remapped', () => {
    catalogs.invalidate();
    wishlist.invalidate();
    romm.invalidate();
    igdb.forgetPlatforms();
    tasks.soon('catalog-build');
  });
  tasks.events.on('failed', (task, message) => notifications.taskFailed(task.name, task.title, message));
  tasks.events.on('succeeded', (task) => notifications.taskSucceeded(task.name, task.title));
  // Console copies are part of the PC library's matrix; PC ownership shows on the wishlist.
  collection.events.on('changed', () => pc.invalidate());
  // A game owned on PC is related, never the console game: the wishlist, Store Mode and console pages say so.
  wishlist.setPcOwnership((title) => pc.ownedOnPc(title));
  lookup.setPcOwnership((title) => pc.ownedOnPc(title));
  // Store Mode names the sets a game is in, and finds a set's missing games outside console catalogs.
  lookup.setSets(sets);
  lookup.setNotes(() => notes.index());
  wishlist.setSets((platformKey, titles) => sets.setsOf(platformKey, titles));
  sets.events.on('changed', () => wishlist.invalidate());
  catalogs.setPcOwnership((title) => pc.ownedOnPc(title));
  pc.events.on('changed', () => {
    wishlist.invalidate();
    pcWishlist.invalidate();
  });
  // A reading that would lose too many PC games waits for the owner, like a collection update does.
  pc.events.on('held', (message) => notifications.pcReadHeld(message));
  collection.events.on('changed', () => pcWishlist.invalidate());
  collection.events.on('changed', () => {
    titles.invalidate();
    sets.invalidate();
  });
  // Copies moved to another console (region-locked consoles) change sets without a new collection update.
  collection.events.on('remapped', () => {
    titles.invalidate();
    sets.invalidate();
  });
  const startedAt = new Date();

  // Default folders inside the config folder are created on start. Chosen folders
  // (and /imports in Docker, which should be a mount) are left alone so a missing
  // share shows up as a health warning instead of silently filling the container.
  const defaults = [!settings.get('storage.backupFolder') && join(env.configDir, 'backups'), !settings.get('storage.importFolder') && !env.inDocker && join(env.configDir, 'imports')];
  for (const dir of defaults) if (dir) mkdirSync(dir, { recursive: true });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 1 } });

  // Basic protections for a site that may be reachable from the internet: no MIME sniffing,
  // no framing by other sites, no page addresses sent to other sites, and API answers never cached.
  app.addHook('onSend', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'SAMEORIGIN');
    reply.header('Referrer-Policy', 'same-origin');
    if (request.url.startsWith('/api/') && !reply.hasHeader('cache-control')) reply.header('Cache-Control', 'no-store');
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof SettingsError) {
      return reply.code(400).send({ error: 'invalid-settings', message: 'Some settings are not valid.', issues: error.issues });
    }
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) {
      request.log.error({ err: error, context: 'http' }, `${request.method} ${request.url} failed`);
      return reply.code(500).send({ error: 'internal', message: 'Something went wrong. The details are in the logs.' });
    }
    return reply.code(status).send({ error: 'bad-request', message: error instanceof Error ? error.message : 'Bad request.' });
  });

  registerAuth(app, auth, settings);
  // An optional part that's off answers as if it weren't there (after the sign-in check, which comes first).
  app.addHook('onRequest', async (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    const hit = FEATURE_ROUTES.find(([pattern, feature]) => pattern.test(path) && !settings.get(FEATURE_SETTINGS[feature]));
    if (hit) {
      return reply.code(404).send({ error: 'feature-off', message: `${hit[2]} is off (Settings > Features).` });
    }
  });
  registerSettingsRoutes(app, settings, (value) => auth.isAccountPassword(value));
  registerSystemRoutes(app, { env, settings, backups, logs: logs.buffer, startedAt, pc, tasks, problems: () => achievements.problems() });
  registerTaskRoutes(app, tasks);
  registerBackupRoutes(app, backups);
  // The standard photos, estimates and Collection > Improve (0.21.0).
  const care = new CopyCareService(db, settings, details, igdb, catalogs);
  // Play status and the owner's details on each copy, for the Collection page's rows, filters and download.
  const itemExtras = {
    play: () => {
      const index = play.index();
      return (platformKey: string, productId: string, title: string) => {
        const found = play.ofCopy(index, platformKey, productId, title);
        return found ? { status: found.status, rating: found.rating } : null;
      };
    },
    details: () => details.extras(),
  };
  registerCollectionRoutes(
    app,
    collection,
    (platformKey, title) => igdb.coverOf(platformKey, title),
    rommOfOwned,
    () => ({ ...pc.stats(), backlog: play.list({}).counts.backlog ?? 0, lent: details.loans().open.length, forSale: details.forSale().length }),
    itemExtras,
  );
  registerRommRoutes(app, romm, tasks, () => {
    let matched = 0;
    let possible = 0;
    const owned = collection.ownedProducts();
    for (const p of owned) {
      const link = rommOfOwned(p.platformKey, p.title, p.productId);
      if (link?.possible) possible++;
      else if (link) matched++;
    }
    return { matched, possible, owned: owned.length };
  });
  registerCatalogRoutes(app, catalogs);
  registerCatalogSourceRoutes(app, catalogBuilder, tasks);
  registerAddedSourceRoutes(app, addedSources, (keys) => {
    if (catalogBuilder.requestBuilt(keys).length > 0) tasks.enqueue('catalog-build');
  });
  // A console tracked through games added here (Add a game, I bought it) gets its catalog soon, as after an export,
  // not at the next daily run (0.60.0), and so does one a lower "Unique games to track a console" tracks now. Each
  // console is asked for once a run, so one without a list isn't asked again.
  const catalogAsked = new Set<string>();
  const catalogsSoon = () => {
    const fresh = catalogBuilder.unbuiltTracked().filter((k) => !catalogAsked.has(k));
    if (fresh.length === 0) return;
    for (const k of fresh) catalogAsked.add(k);
    catalogBuilder.request(fresh);
    tasks.soon('catalog-build');
  };
  collection.events.on('changed', catalogsSoon);
  settings.events.on('changed', (keys) => {
    if (keys.includes('platforms.minUniqueGames')) catalogsSoon();
  });
  registerWishlistRoutes(app, wishlist, () => notes.index());
  registerLookupRoutes(app, lookup);
  registerCheckRoutes(app, lookup, settings);
  registerNotificationRoutes(app, notifications, settings, options.transports?.post);
  registerIgdbRoutes(app, igdb);
  registerPcRoutes(app, pc, tasks, settings);
  // The PC wishlist's prices: IsThereAnyDeal's and GG.deals', the source Settings > Sources puts first shown where it
  // has a price, the other filling in.
  const pcPriceOf = (): Map<string, PcPrice> | null => {
    if (!pcPrices.enabled()) return null;
    const itad = pcPrices.prices();
    const gg = ggdeals.configured() ? ggdeals.prices() : new Map<number, GgPrice>();
    if (gg.size === 0) return itad;
    const ggFirst = settings.get('sources.pcPriceFirst') === 'ggdeals';
    const priced = (p: PcPrice | null | undefined): p is PcPrice => Boolean(p && !p.missing && p.currentCents !== null);
    const out = new Map<string, PcPrice>();
    for (const item of pcWishlist.compute().items) {
      const a = itad.get(item.key);
      const found = item.steamAppId ? gg.get(item.steamAppId) : undefined;
      const b = found ? ggAsPcPrice(found) : undefined;
      const [first, second] = ggFirst ? [b, a] : [a, b];
      const pick = priced(first) ? first : priced(second) ? second : (first ?? second);
      if (pick) out.set(item.key, pick);
    }
    return out;
  };
  registerPcWishlistRoutes(app, pcWishlist, tasks, pcPriceOf);
  registerPcPriceRoutes(app, pcPrices, tasks);
  const mail = new MailImportService(db, settings, collection, log, notifications, options.mailbox, options.exportDownload);
  registerMailRoutes(app, mail, tasks);
  // Settings > Email's one test: sending from your account, and reading its mailbox.
  app.post('/api/v1/email/test', async () => ({ send: await notifications.testEmail(), read: await mail.test() }));
  const deals = new DealsService(settings, mail, catalogs, wishlist, igdb, notifications);
  mail.onNewDeals(async (added) => {
    await deals.alert(added);
  });
  registerDealRoutes(app, deals, settings);
  const gotd = new GameOfTheDayService(db, settings, wishlist, igdb, history, notifications, deals);
  registerGotdRoutes(app, gotd);
  registerTodayRoutes(app, { settings, gotd, deals, catalogs, details, collection, history, sets });
  registerSetRoutes(app, sets);
  // RetroAchievements' games are matched to the games Squirrelcade knows by title, as Store Mode compares titles.
  const ra = new RetroAchievementsService(
    db,
    settings,
    log,
    (platformKey, title) => {
      const found = lookup.search(title, { platformKey, sameTitle: true, brief: true, limit: 1 })[0];
      return found ? { title: found.title, owned: found.answer === 'own' || found.answer === 'own-not-in-catalog' } : null;
    },
    play,
    options.raFetch,
  );
  registerRetroAchievementsRoutes(app, ra, tasks);
  // Xbox's and PlayStation's games go on the console the owner has a copy on, else the first that knows the game.
  const achievements = new AchievementsService(
    db,
    settings,
    log,
    (platformKey, title) => {
      const found = lookup.search(title, { platformKey, sameTitle: true, brief: true, limit: 1 })[0];
      return found ? { title: found.title, owned: found.answer === 'own' || found.answer === 'own-not-in-catalog' } : null;
    },
    play,
    options.xboxGet ?? xboxHttpsGet,
    options.psnApi ?? psnApi,
    options.steamApiFetch ?? fetch,
    options.steamApiFetch ? 0 : 250,
  );
  registerAchievementRoutes(app, achievements, tasks);
  // The PC library's Steam games show their achievements.
  pc.useAchievements(() => achievements.steamProgress());
  registerGameRoutes(app, {
    db,
    settings,
    catalogs,
    collection,
    wishlist,
    igdb,
    pc,
    sets,
    romm: rommLink,
    notes,
    history,
    play,
    details,
    care,
    ra: (key, titles) => ra.forGame(key, titles),
    achievements: (key, titles) => achievements.forGame(key, titles),
  });
  registerPlayRoutes(app, play, (platformKey, title) => catalogTarget(catalogs, platformKey, title)?.target.title ?? null);
  registerCopyDetailRoutes(app, details, settings);
  registerOwnCopyRoutes(app, { collection, catalogs, details, settings, db, igdb });
  registerCopyCareRoutes(app, care);
  // Selling (0.22.0): listing kits for eBay and Mercari, the sales, and what to sell next.
  registerSellingRoutes(app, new SellingService(db, settings, collection, details, care, igdb, catalogs, play, log));
  registerShareRoutes(app, shares, settings);
  // Help > AI-assisted setup (0.29.0): what the setup prompt says about this install, and its links.
  registerAiSetupRoutes(app, { env, settings, collection, catalogs, backups, tasks, pc, auth, shares, health: () => computeHealth({ env, settings, backups, pc, problems: () => achievements.problems() }).health });
  registerReportRoutes(app, { db, settings, collection, catalogs, wishlist, igdb, notes, play, details, pc, history, care });
  registerHistoryRoutes(app, history);
  registerCopiesRoutes(app, copies);
  registerSeriesRoutes(app, new SeriesService(catalogs, igdb, settings, () => wishlist.preferences(), (title) => pc.ownedOnPc(title).length > 0));
  registerCollectionExport(app, { collection, catalogs, igdb, settings, notes: () => notes.index(), extras: itemExtras });
  // Claude and other AI apps (0.55.0, D127): their sign-in (with guests) and the connector's read-only tools at /mcp.
  const aiAuth = new AiAuthService(db, settings, auth, notifications, log, options.aiFetch);
  auth.passwordChanged.add((userId) => aiAuth.endAccount(userId));
  const aiTools = new AiTools({ db, settings, pc, details, wishlist, igdb, history, notes });
  collection.events.on('changed', () => aiTools.invalidate());
  collection.events.on('remapped', () => aiTools.invalidate());
  pc.events.on('changed', () => aiTools.invalidate());
  await registerAiAuthRoutes(app, aiAuth, auth);
  registerMcpRoute(app, aiAuth, aiTools, { db, settings, log });
  // Friends' collections (0.56.0, D131): share files, the comparison and trades.
  const friendsService = new FriendsService(db, settings, details, wishlist, log);
  registerFriendRoutes(app, friendsService);

  tasks.register({
    name: 'ra-sync',
    title: 'Read RetroAchievements',
    description: 'Reads your progress on RetroAchievements (Settings > Sources > RetroAchievements): what you beat and mastered, for each game.',
    interval: () => (ra.enabled() && ra.configured() ? settings.get('tasks.achievementsReadDays') * 86_400_000 : null),
    firstRunDelayMs: 3 * 60_000,
    run: async (_log, progress) => ra.sync(progress),
  });
  tasks.register({
    name: 'xbox-sync',
    title: 'Read Xbox achievements',
    description: 'Reads your Xbox achievements through OpenXBL (Settings > Sources > Xbox achievements): how far you got in each game.',
    interval: () => (achievements.enabled('xbox') && achievements.configured('xbox') ? settings.get('tasks.achievementsReadDays') * 86_400_000 : null),
    firstRunDelayMs: 4 * 60_000,
    run: async (_log, progress) => achievements.sync('xbox', progress),
  });
  tasks.register({
    name: 'psn-sync',
    title: 'Read PlayStation trophies',
    description: 'Reads your PlayStation trophies (Settings > Sources > PlayStation trophies): how far you got in each game, and the platinums.',
    interval: () => (achievements.enabled('playstation') && achievements.configured('playstation') ? settings.get('tasks.achievementsReadDays') * 86_400_000 : null),
    firstRunDelayMs: 5 * 60_000,
    run: async (_log, progress) => achievements.sync('playstation', progress),
  });
  tasks.register({
    name: 'steam-sync',
    title: 'Read Steam achievements',
    description: 'Reads your Steam achievements (Settings > Sources > Steam achievements): each game you played since the last read.',
    interval: () => (achievements.enabled('steam') && achievements.configured('steam') ? settings.get('tasks.achievementsReadDays') * 86_400_000 : null),
    firstRunDelayMs: 6 * 60_000,
    run: async (_log, progress) => achievements.sync('steam', progress),
  });
  tasks.register({
    name: 'backup',
    title: 'Back up database',
    description: 'Copies the database into the backup folder and removes the oldest automatic backups.',
    interval: () => settings.get('tasks.backupIntervalDays') * 86_400_000,
    firstRunDelayMs: 10 * 60_000,
    run: async () => {
      const b = await backups.create('scheduled');
      // A copy that couldn't reach the second backup folder fails the task, so it's alerted.
      if (b.copyError) throw new Error(`${b.name} was made, but copying it to the second backup folder failed: ${b.copyError}`);
      return `${b.name} (${Math.round(b.bytes / 1024)} KB)${backups.copyFolder() ? ', copied to the second backup folder' : ''}`;
    },
  });
  tasks.register({
    name: 'import-folder',
    title: 'Check the watched folder',
    description: 'Updates your collection from new PriceCharting exports in the watched folder.',
    interval: () => (settings.get('collection.dropFolderEnabled') ? settings.get('tasks.importScanMinutes') * 60_000 : null),
    firstRunDelayMs: 30_000,
    run: async () => collection.scanFolder(importFolder(env, settings)),
    quiet: (m) => m === 'No new files.',
  });
  tasks.register({
    name: 'mail-import',
    title: 'Check your email for exports',
    description: "Updates your collection from PriceCharting's export emails in your mailbox (Settings > Email > Stash updates from your email).",
    interval: () => (mail.enabled() ? settings.get('mail.checkMinutes') * 60_000 : null),
    firstRunDelayMs: 60_000,
    run: async () => mail.check(),
    quiet: (m) => /^No (new )?export emails/.test(m ?? ''),
  });
  tasks.register({
    name: 'game-of-the-day',
    title: 'Send the game of the day',
    description: "Picks the day's game from your wishlist and sends it at the hour you chose (Settings > Notifications > Game of the day).",
    interval: () => (gotd.enabled() ? 30 * 60_000 : null),
    firstRunDelayMs: 3 * 60_000,
    run: async () => gotd.send(),
    quiet: (m) => !/^(Sent|Today's game):/.test(m ?? ''),
  });
  tasks.register({
    name: 'export-reminder',
    title: 'Remind me to export',
    description: 'Sends a message when your newest PriceCharting export is older than Settings > Collection > Reminders says.',
    interval: () => (settings.get('collection.exportReminderDays') > 0 ? 6 * 3_600_000 : null),
    firstRunDelayMs: 15 * 60_000,
    run: async () => mail.remind(),
    quiet: (m) => !/^Reminded:/.test(m ?? ''),
  });
  tasks.register({
    name: 'housekeeping',
    title: 'Clean up',
    description: 'Removes expired sign-ins, old task history and the rows of old collection updates, and starts a new log file when it gets large.',
    interval: () => settings.get('tasks.housekeepingIntervalHours') * 3_600_000,
    firstRunDelayMs: 5 * 60_000,
    run: async () => {
      const sessions = auth.deleteExpiredSessions();
      const runs = tasks.pruneHistory(settings.get('tasks.historyDays'));
      const rows = collection.pruneOldImports();
      const rotated = logs.rotate();
      const baseline = notifications.ensureBaseline();
      return `${sessions} sessions, ${runs} task runs and ${rows} rows of old updates removed${rotated ? '; log file rotated' : ''}${baseline ? '; first wishlist snapshot saved' : ''}`;
    },
  });

  tasks.register({
    name: 'health-check',
    title: 'Check health',
    description: 'Looks for problems such as missing folders or old backups, and sends an alert for new ones.',
    interval: () => settings.get('tasks.healthCheckHours') * 3_600_000,
    firstRunDelayMs: 30 * 60_000,
    run: async () => {
      const { health } = computeHealth({ env, settings, backups, pc, problems: () => achievements.problems() });
      const current = health.map((h) => h.message);
      const row = db.select().from(appState).where(eq(appState.key, HEALTH_ALERTED)).get();
      const alerted = row ? (JSON.parse(row.value) as string[]) : [];
      const fresh = current.filter((m) => !alerted.includes(m));
      notifications.healthProblems(fresh);
      db.insert(appState)
        .values({ key: HEALTH_ALERTED, value: JSON.stringify(current) })
        .onConflictDoUpdate({ target: appState.key, set: { value: JSON.stringify(current) } })
        .run();
      return current.length === 0 ? 'No problems' : `${current.length} problem(s), ${fresh.length} new`;
    },
    quiet: (m) => m === 'No problems' || /, 0 new$/.test(m ?? ''),
  });
  tasks.register({
    name: 'catalog-build',
    title: 'Build catalogs',
    description: "Builds each tracked console's catalog from Wikipedia's list of its games, and refreshes catalogs when they're due (Settings > Catalogs and matching).",
    interval: () => (settings.get('catalogs.refreshDays') > 0 ? 86_400_000 : null),
    firstRunDelayMs: 3 * 60_000,
    run: async (_log, progress) => {
      const message = await catalogBuilder.run(progress);
      // A console that just got its first catalog gets its IGDB data soon, not at the next IGDB update.
      if (igdb.client.configured() && igdb.status().platforms.some((p) => p.igdbId && !p.syncedAt)) tasks.soon('igdb-sync');
      return message;
    },
  });
  tasks.register({
    name: 'romm-sync',
    title: 'Update the RomM index',
    description: "Reads the ROMs in your RomM on the platforms Squirrelcade knows, for the links from owned games to RomM (Settings > Sources).",
    interval: () => (romm.client.configured() && settings.get('sources.rommRefreshHours') > 0 ? settings.get('sources.rommRefreshHours') * 3_600_000 : null),
    firstRunDelayMs: 60_000,
    run: async (_log, progress) => romm.sync(progress),
  });
  tasks.register({
    name: 'pc-read',
    title: 'Read the PC library',
    description: "Reads the newest Playnite backup (Settings > PC library) when there's one newer than the last reading.",
    interval: () => (pc.enabled() && settings.get('pc.readDays') > 0 && pc.folder() ? settings.get('pc.readDays') * 86_400_000 : null),
    firstRunDelayMs: 10 * 60_000,
    run: async () => pc.readBackup(),
  });
  tasks.register({
    name: 'pc-discover',
    title: 'Look for PC games',
    description: 'Searches IGDB for PC games for the PC wishlist (Settings > PC library), and reads Steam review summaries.',
    interval: () => (pc.enabled() && igdb.client.configured() && settings.get('pc.discoverDays') > 0 ? settings.get('pc.discoverDays') * 86_400_000 : null),
    firstRunDelayMs: 20 * 60_000,
    run: async (_log, progress) => pcWishlist.discover(progress),
  });
  tasks.register({
    name: 'loan-reminders',
    title: 'Remind about lent games',
    description: "Sends a message when a game you lent isn't back by the day it was due (Settings > Notifications), once per loan.",
    interval: () => (settings.get('notifications.loanReminders') ? 6 * 3_600_000 : null),
    firstRunDelayMs: 20 * 60_000,
    run: async () => details.remindOverdue(),
    quiet: (m) => m === 'No lent game is overdue' || m === 'Loan reminders are off',
  });
  tasks.register({
    name: 'pc-prices',
    title: 'Check PC game prices',
    description: "Reads the PC wishlist's prices from IsThereAnyDeal and sends a message when one drops (Settings > PC library > Prices).",
    interval: () => (pcPrices.enabled() && (pcPrices.client.configured() || ggdeals.configured()) ? settings.get('pc.pricesRefreshHours') * 3_600_000 : null),
    firstRunDelayMs: 25 * 60_000,
    run: async (_log, progress) => {
      const lines = [pcPrices.client.configured() ? await pcPrices.refresh(progress) : null];
      // GG.deals, a second source (Settings > Sources), for the PC wishlist's Steam games.
      if (ggdeals.configured()) {
        progress('GG.deals');
        lines.push(await ggdeals.read(pcWishlist.compute().items.flatMap((i) => (i.steamAppId ? [i.steamAppId] : []))));
      }
      return lines.filter(Boolean).join('; ');
    },
  });
  const reminders = new ReleaseReminders(db, settings, catalogs, wishlist, notifications, log);
  tasks.register({
    name: 'release-reminders',
    title: 'Remind about new releases',
    description: "Sends a message when games you don't have yet come out on the consoles you collect (Settings > Notifications > Release reminders).",
    interval: () => (settings.get('notifications.releaseReminders') ? RELEASE_CHECK_MS : null),
    firstRunDelayMs: 15 * 60_000,
    run: async () => reminders.run(),
    quiet: (m) => m === 'No game due a reminder' || m === 'Release reminders are off',
  });
  tasks.register({
    name: 'igdb-sync',
    title: 'Update IGDB data',
    description: 'Downloads the IGDB game lists (covers, genres, series) of the platforms that have a catalog.',
    interval: () => (igdb.client.configured() ? settings.get('sources.igdbRefreshDays') * 86_400_000 : null),
    firstRunDelayMs: 2 * 60_000,
    run: async (_log, progress) => igdb.sync(undefined, progress),
  });

  settings.events.on('changed', (keys) => {
    if (keys.includes('general.logLevel')) log.level = settings.get('general.logLevel');
    if (keys.includes('platforms.regionLocked') || keys.includes('general.homeRegion')) collection.remapLabels();
    // An optional part turned on or off (Settings > Features): what's worked out from it starts over, its tasks follow.
    if (keys.some((k) => k.startsWith('features.'))) {
      pc.invalidate();
      pcWishlist.invalidate();
      romm.invalidate();
      catalogs.invalidate();
      wishlist.invalidate();
      tasks.rescheduleAll();
      if (keys.includes('features.romm') && settings.get('features.romm')) tasks.soon('romm-sync');
      if (keys.includes('features.igdb') && settings.get('features.igdb')) tasks.soon('igdb-sync');
      if (keys.includes('features.itad') && settings.get('features.itad')) tasks.soon('pc-prices');
      if (keys.includes('features.mail') && settings.get('features.mail')) tasks.soon('mail-import');
      if (keys.includes('features.retroachievements') && settings.get('features.retroachievements')) tasks.soon('ra-sync');
      if (keys.includes('features.xbox') && settings.get('features.xbox')) tasks.soon('xbox-sync');
      if (keys.includes('features.playstation') && settings.get('features.playstation')) tasks.soon('psn-sync');
      if (keys.includes('features.steam') && settings.get('features.steam')) tasks.soon('steam-sync');
    }
    // Cross-generation games on or off, or a new window: every console's owned games are worked out again.
    if (keys.includes('catalogs.crossGen') || keys.includes('catalogs.crossGenYears')) {
      catalogs.invalidate();
      wishlist.invalidate();
    }
    if (keys.some((k) => k.startsWith('pc.'))) pc.invalidate();
    if (keys.some((k) => k.startsWith('pc.') || k.startsWith('wishlist.'))) pcWishlist.invalidate();
    if (keys.includes('pc.discoverDays')) tasks.rescheduleAll();
    if (keys.includes('notifications.releaseReminders') || keys.includes('notifications.loanReminders') || keys.includes('gotd.enabled')) tasks.rescheduleAll();
    // A new IsThereAnyDeal key or store country reads the prices soon; a new interval takes effect now.
    if (keys.includes('pc.pricesRefreshHours') || keys.some((k) => k.startsWith('sources.itad'))) tasks.rescheduleAll();
    if (keys.includes('sources.itadKey') || keys.includes('sources.itadCountry')) tasks.soon('pc-prices');
    // A new RetroAchievements account (or "What you played" choice) reads the progress soon.
    if (keys.some((k) => k.startsWith('sources.ra'))) {
      tasks.rescheduleAll();
      tasks.soon('ra-sync');
    }
    // A new Xbox key or PlayStation sign-in token (or "What you played" choice) reads them soon.
    if (keys.some((k) => k.startsWith('sources.xbox'))) {
      tasks.rescheduleAll();
      tasks.soon('xbox-sync');
    }
    if (keys.some((k) => k.startsWith('sources.psn'))) {
      tasks.rescheduleAll();
      tasks.soon('psn-sync');
    }
    if (keys.some((k) => k.startsWith('sources.steam'))) {
      tasks.rescheduleAll();
      tasks.soon('steam-sync');
    }
    if (keys.includes('pc.readDays') || keys.includes('pc.playniteFolder')) tasks.rescheduleAll();
    if (keys.includes('pc.playniteFolder')) tasks.soon('pc-read');
    if (keys.some((k) => k.startsWith('catalogs.') || k === 'general.homeRegion' || k === 'platforms.regionLocked')) catalogs.invalidate();
    if (keys.some((k) => k.startsWith('wishlist.') || k.startsWith('catalogs.') || k === 'general.homeRegion' || k === 'platforms.regionLocked')) wishlist.invalidate();
    if (keys.some((k) => k.startsWith('sources.igdb'))) wishlist.invalidate();
    if (keys.some((k) => k.startsWith('tasks.') || k.startsWith('collection.') || k.startsWith('sources.igdb') || k.startsWith('sources.romm') || k === 'catalogs.refreshDays')) tasks.rescheduleAll();
    // The RomM index depends on the platform mapping and region order; a new address or token reads RomM soon.
    if (keys.some((k) => k.startsWith('sources.romm') || k === 'sources.igdbPlatformIds' || k === 'sources.igdbExtraPlatformIds' || k === 'general.homeRegion')) romm.invalidate();
    // Other IGDB platforms for a platform mean other game lists: download them soon.
    if (keys.includes('sources.igdbPlatformIds') || keys.includes('sources.igdbExtraPlatformIds')) tasks.soon('igdb-sync');
    if (keys.includes('sources.rommUrl') || keys.includes('sources.rommToken') || keys.includes('sources.rommPlatforms')) tasks.soon('romm-sync');
    if (keys.some((k) => (settingDefinitions[k] as SettingDefinition).restartRequired)) log.info({ context: 'settings' }, 'Some changes take effect after a restart.');
    // Settings that change what catalogs are built from rebuild them soon.
    if (keys.some((k) => BUILD_SETTINGS.has(k))) {
      catalogBuilder.requestAll();
      tasks.soon('catalog-build');
    }
  });

  if (env.webDir && existsSync(join(env.webDir, 'index.html'))) {
    // The build keeps Brotli and gzip copies of the interface's files (apps/web/scripts/compress.mjs); browsers that accept them get those.
    await app.register(fastifyStatic, { root: env.webDir, wildcard: true, preCompressed: true });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'not-found', message: 'Not found.' });
    });
  } else {
    app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'not-found', message: 'Not found.' }));
  }

  // Console names recognized before the region-locked setting (or under other settings) move where they count now.
  const remapped = collection.remapLabels().length > 0;

  if (options.startTasks !== false) {
    tasks.start();
    // Consoles of their own made just now get their catalogs a few minutes after the start (asking before the
    // start doesn't count), once an updater's before-and-after checks of the catalogs are done.
    if (remapped) tasks.soon('catalog-build', 5 * 60_000);
    // Work out completion and the wishlist once in the background, so the first page doesn't wait for it.
    setTimeout(() => {
      try {
        catalogs.summary();
        wishlist.compute();
      } catch (err) {
        log.warn({ err, context: 'startup' }, 'Warming up the catalogs failed');
      }
    }, 1000).unref();
    // And again just after the copies change (I bought it in a store, say), while the phone shows the change: the next
    // search then finds the wishlist worked out (a second or two on a collection of thousands) instead of waiting for it.
    let rewarm: NodeJS.Timeout | null = null;
    collection.events.on('changed', () => {
      if (rewarm) clearTimeout(rewarm);
      rewarm = setTimeout(() => {
        rewarm = null;
        try {
          catalogs.summary();
          wishlist.compute();
        } catch (err) {
          log.warn({ err, context: 'collection' }, 'Working out the wishlist after a change failed');
        }
      }, 250);
      rewarm.unref();
    });
  }
  log.info({ context: 'startup' }, `Squirrelcade ${APP_VERSION} ready (config folder ${env.configDir})`);
  // A new install: how to make the first account, and the code it takes from outside the home network (0.60.0).
  const setupCode = auth.setupCode();
  if (setupCode) log.warn({ context: 'startup' }, `No account yet: open Squirrelcade from your home network to create the first one. From anywhere else, first-run setup asks for this setup code: ${setupCode}`);

  return {
    app,
    env,
    db,
    logs,
    settings,
    auth,
    tasks,
    backups,
    collection,
    catalogs,
    wishlist,
    lookup,
    notifications,
    igdb,
    catalogBuilder,
    pc,
    pcWishlist,
    sets,
    history,
    play,
    details,
    shares,
    pcPrices,
    mail,
    gotd,
    ra,
    achievements,
    aiAuth,
    aiTools,
    friends: friendsService,
    close: async () => {
      lookup.stop();
      await tasks.stop();
      await app.close();
      await notifications.idle();
      db.$client.close();
    },
  };
}
