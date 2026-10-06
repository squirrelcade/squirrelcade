import { blob, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/** One row per setting that differs from its default (see packages/core/src/settings.ts). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Small internal values such as the API key and the current collection import. */
export const appState = sqliteTable('app_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

/**
 * The accounts. One is the owner (the collection's, who can change anything and manage the others); the rest
 * are viewers, who can look at the collection but change nothing.
 */
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  username: text('username').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at').notNull(),
  /** owner or viewer. */
  role: text('role').notNull().default('viewer'),
});

/**
 * Links the owner sends to invite someone as a viewer, or to let an account choose a new password. Kept by the
 * SHA-256 of their token, never the token itself; each works once, until it expires.
 */
export const invites = sqliteTable('invites', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tokenHash: text('token_hash').notNull().unique(),
  /** Who it's for, as the owner wrote it ("Mom"), shown on the invite page. */
  name: text('name'),
  /** An existing account the link sets a new password for; null invites a new viewer. */
  userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
});

/** Sessions are stored by the SHA-256 of their token, never the token itself. */
export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [index('sessions_expires_idx').on(t.expiresAt)],
);

export const taskRuns = sqliteTable(
  'task_runs',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    task: text('task').notNull(),
    trigger: text('trigger').notNull(),
    status: text('status').notNull(),
    startedAt: text('started_at').notNull(),
    finishedAt: text('finished_at'),
    message: text('message'),
  },
  (t) => [index('task_runs_task_idx').on(t.task, t.startedAt)],
);

export const platforms = sqliteTable('platforms', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  /** builtin, auto (created from an unknown console name) or user. */
  source: text('source').notNull(),
  createdAt: text('created_at').notNull(),
});

/** How a PriceCharting console name maps to a platform and region. */
export const platformLabels = sqliteTable('platform_labels', {
  label: text('label').primaryKey(),
  platformId: integer('platform_id')
    .notNull()
    .references(() => platforms.id, { onDelete: 'cascade' }),
  region: text('region').notNull(),
  source: text('source').notNull(),
});

export const imports = sqliteTable(
  'imports',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** upload or folder */
    source: text('source').notNull(),
    fileName: text('file_name').notNull(),
    fileSha256: text('file_sha256').notNull(),
    fileBytes: integer('file_bytes').notNull(),
    /** applied, pending (waiting for confirmation), discarded, refused */
    status: text('status').notNull(),
    createdAt: text('created_at').notNull(),
    appliedAt: text('applied_at'),
    rowCount: integer('row_count').notNull(),
    copyCount: integer('copy_count').notNull(),
    /** Totals of the file, for the value history (null for refused files and imports made before they were recorded). */
    gameCount: integer('game_count'),
    valueCents: integer('value_cents'),
    costCents: integer('cost_cents'),
    /**
     * JSON: each platform's totals in this update ([{ key, name, games, copies, valueCents, costCents }]), for the
     * value by platform over time. Kept when old updates' rows are pruned; null for an update whose rows were gone
     * before these were kept.
     */
    platformTotals: text('platform_totals'),
    addedCount: integer('added_count').notNull(),
    removedCount: integer('removed_count').notNull(),
    changedCount: integer('changed_count').notNull(),
    /** JSON: { errors, warnings, excluded, diff } */
    report: text('report').notNull(),
    message: text('message'),
    /** What the file was: pricecharting (an export) or spreadsheet (the owner's own, or another app's export); null before 0.19.0. */
    format: text('format'),
  },
  (t) => [index('imports_sha_idx').on(t.fileSha256)],
);

/** The games a platform's collection aims to include. */
export const catalogEntries = sqliteTable(
  'catalog_entries',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    platformId: integer('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    /** Stable key within the platform, e.g. "nintendo-switch|north-america|splatoon-3". */
    key: text('key').notNull(),
    title: text('title').notNull(),
    /** JSON array of other names the game goes by (other regions, retitles), for matching. */
    altTitles: text('alt_titles'),
    format: text('format'),
    region: text('region').notNull(),
    /**
     * What the catalog's source says: required, optional, review or excluded; or unconfirmed, a download
     * title that counts once something shows a physical release.
     */
    targetStatus: text('target_status').notNull(),
    /** The user's own choice, which wins over the source's and survives catalog refreshes. */
    userStatus: text('user_status'),
    releaseDate: text('release_date'),
    notes: text('notes'),
    /** Where the game came from: list (the user's own list), wikipedia, or user (added by hand). */
    source: text('source').notNull(),
    /**
     * Why the catalog source counts it as a physical release: list (on the user's list), retail (on a
     * console whose list only has retail games). null: only IGDB, owning it or the user can confirm it.
     */
    evidence: text('evidence'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('catalog_entries_key_idx').on(t.platformId, t.key)],
);

/** The user's answers to match suggestions: this owned product is (or isn't) this catalog game. */
export const catalogDecisions = sqliteTable(
  'catalog_decisions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    entryId: integer('entry_id')
      .notNull()
      .references(() => catalogEntries.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    decision: text('decision').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('catalog_decisions_pair_idx').on(t.entryId, t.productId)],
);

/** Owned products the user said aren't catalog games, so they leave the "Not in catalog" list. */
export const ignoredProducts = sqliteTable(
  'ignored_products',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    platformId: integer('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    title: text('title').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [uniqueIndex('ignored_products_idx').on(t.platformId, t.productId)],
);

/** Reviewed rules that an owned title satisfies a catalog title (compilations, aliases, editions). */
export const ownershipMappings = sqliteTable('ownership_mappings', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platformId: integer('platform_id')
    .notNull()
    .references(() => platforms.id, { onDelete: 'cascade' }),
  ownedTitle: text('owned_title').notNull(),
  satisfiesTitle: text('satisfies_title').notNull(),
  type: text('type').notNull(),
  /** yes, conditional or no */
  counts: text('counts').notNull(),
  notes: text('notes'),
  source: text('source').notNull(),
});

/** Per-title decisions that change what the catalog and wishlist include. */
export const exclusions = sqliteTable('exclusions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  platformId: integer('platform_id').references(() => platforms.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  /** exclude (not a collecting target), hide (not recommended), defer (until a date), below-price */
  action: text('action').notNull(),
  until: text('until'),
  belowCents: integer('below_cents'),
  reason: text('reason'),
  active: integer('active', { mode: 'boolean' }).notNull(),
  source: text('source').notNull(),
});

/** Curated or looked-up facts about a game on a platform, used for scoring. */
export const gameDetails = sqliteTable(
  'game_details',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    platformId: integer('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** normalizeTitle(title), for matching. */
    titleKey: text('title_key').notNull(),
    /** JSON GameDetails (see packages/core/src/wishlist.ts). */
    details: text('details').notNull(),
    /** user, or a lookup source */
    source: text('source').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('game_details_key_idx').on(t.platformId, t.titleKey)],
);

/** The user's preference for a game on the wishlist ("Must Have", "Do Not Recommend"...). */
export const ownerPreferences = sqliteTable(
  'owner_preferences',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    platformId: integer('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    titleKey: text('title_key').notNull(),
    preference: text('preference').notNull(),
    note: text('note'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('owner_preferences_key_idx').on(t.platformId, t.titleKey)],
);

/** The main wishlist as it stood after an import, for reporting what changed next time. */
export const wishlistSnapshots = sqliteTable('wishlist_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  importId: integer('import_id'),
  createdAt: text('created_at').notNull(),
  /** JSON SnapshotEntry[] */
  entries: text('entries').notNull(),
});

/** Games marked as bought in Store Mode, owned until a collection export includes them. */
export const pendingPurchases = sqliteTable('pending_purchases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  entryId: integer('entry_id')
    .notNull()
    .references(() => catalogEntries.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
});

/** Games IGDB lists for a platform, as core's IgdbGame (see packages/core/src/igdb.ts). */
export const igdbGames = sqliteTable(
  'igdb_games',
  {
    platformId: integer('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    igdbId: integer('igdb_id').notNull(),
    /** JSON IgdbGame */
    data: text('data').notNull(),
  },
  (t) => [uniqueIndex('igdb_games_idx').on(t.platformId, t.igdbId)],
);

/** When each platform's IGDB list was last downloaded, and how it went. */
/** A console's own catalog list (a CSV the user uploaded): the top layer of its catalog. */
export const catalogLists = sqliteTable('catalog_lists', {
  platformId: integer('platform_id')
    .primaryKey()
    .references(() => platforms.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  /** JSON array of { title, altTitles?, releaseDate?, region?, targetStatus?, notes? }. */
  entries: text('entries').notNull(),
  games: integer('games').notNull(),
  uploadedAt: text('uploaded_at').notNull(),
});

/**
 * Catalog sources the user added in Settings > Sources (0.41.0): an online list (its address, read again with the
 * catalog refresh) or a CSV file. Each has its own place in the order (sources.catalogOrder, as "added-" and its id).
 */
export const addedSources = sqliteTable('added_sources', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** link: an online list's address; file: a CSV file given once. */
  kind: text('kind').notNull(),
  url: text('url'),
  fileName: text('file_name'),
  /** The console every game is for, when the list has no console column. */
  platformKey: text('platform_key'),
  /** complete: its games count toward completion; owned: they count once owned, as other regions' releases do. */
  counts: text('counts').notNull().default('complete'),
  /** JSON Record<platform key, ListEntry[]>: its games, from the last good reading. */
  games: text('games').notNull(),
  total: integer('total').notNull(),
  readAt: text('read_at').notNull(),
  /** Why the last reading of an online list failed (its games stay those of the reading before), or null. */
  error: text('error'),
  createdAt: text('created_at').notNull(),
});

/** The last catalog build of each platform from its sources (the user's list, Nintendo Life, Wikipedia). */
export const catalogBuilds = sqliteTable('catalog_builds', {
  platformId: integer('platform_id')
    .primaryKey()
    .references(() => platforms.id, { onDelete: 'cascade' }),
  source: text('source').notNull(),
  builtAt: text('built_at').notNull(),
  /** JSON array of the pages read. */
  pages: text('pages').notNull(),
  games: integer('games').notNull(),
  /** JSON object: games left out and why (not released in the home region, download-only, unlicensed, unreleased). */
  skipped: text('skipped').notNull(),
  /** null when it worked, otherwise what went wrong. */
  error: text('error'),
  /** JSON array: what each catalog source gave the build, most trusted first (see sources.ts). */
  sources: text('sources').notNull().default('[]'),
  /** JSON array: where the sources disagreed about a game's date or format. */
  conflicts: text('conflicts').notNull().default('[]'),
});

export const igdbSyncs = sqliteTable('igdb_syncs', {
  platformId: integer('platform_id')
    .primaryKey()
    .references(() => platforms.id, { onDelete: 'cascade' }),
  syncedAt: text('synced_at').notNull(),
  games: integer('games').notNull(),
  /** null when it worked, otherwise what went wrong. */
  error: text('error'),
});

/**
 * What the barcode service called each barcode Squirrelcade asked it about, kept for good: each game costs one of its
 * lookups, ever. null when it didn't know the code (asked again after a week: its database grows). A barcode the user
 * confirmed (barcodes) wins over this.
 */
export const barcodeNames = sqliteTable('barcode_names', {
  code: text('code').primaryKey(),
  name: text('name'),
  /** The service that named it (Settings > Sources > Barcodes), such as upcitemdb. */
  source: text('source').notNull(),
  askedAt: text('asked_at').notNull(),
});

/** Barcodes the user has confirmed: this UPC/EAN is this game on this platform. */
export const barcodes = sqliteTable('barcodes', {
  code: text('code').primaryKey(),
  platformId: integer('platform_id')
    .notNull()
    .references(() => platforms.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  source: text('source').notNull(),
  createdAt: text('created_at').notNull(),
});

/** Rows of every kept import; the current collection is the rows of the current import. */
export const collectionItems = sqliteTable(
  'collection_items',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    importId: integer('import_id')
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    productId: text('product_id').notNull(),
    title: text('title').notNull(),
    consoleLabel: text('console_label').notNull(),
    platformId: integer('platform_id').references(() => platforms.id),
    region: text('region').notNull(),
    valueCents: integer('value_cents'),
    costCents: integer('cost_cents'),
    includeString: text('include_string').notNull(),
    conditionString: text('condition_string').notNull(),
    completeness: text('completeness').notNull(),
    sealed: integer('sealed', { mode: 'boolean' }).notNull(),
    hasBox: integer('has_box', { mode: 'boolean' }).notNull(),
    hasManual: integer('has_manual', { mode: 'boolean' }).notNull(),
    quantity: integer('quantity').notNull(),
    sku: text('sku').notNull(),
    notes: text('notes').notNull(),
    dateEntered: text('date_entered'),
    datePurchased: text('date_purchased'),
    gradingCompany: text('grading_company').notNull(),
    gradingCertId: text('grading_cert_id').notNull(),
    folder: text('folder').notNull(),
    line: integer('line').notNull(),
  },
  (t) => [
    index('collection_items_import_idx').on(t.importId, t.platformId),
    index('collection_items_product_idx').on(t.importId, t.productId),
  ],
);

/**
 * The collection (0.19.0, D81): one row per copy owned, kept by Squirrelcade. An update's file (PriceCharting's export, a
 * spreadsheet, another app's export) adds, updates and matches copies here instead of replacing the collection, and a
 * copy its file no longer has waits on Review unless Settings > Collection says to let it go. The updates' own rows
 * (collection_items) stay as they came, for comparing updates and the value history.
 */
export const copies = sqliteTable(
  'copies',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** What its details, loans and photos are kept under; never changes (a copy from before 0.19.0 kept its product and condition). */
    key: text('key').notNull(),
    /** PriceCharting's product id, or one Squirrelcade made for a copy without one ("s-..." from a spreadsheet). */
    productId: text('product_id').notNull(),
    title: text('title').notNull(),
    consoleLabel: text('console_label').notNull(),
    platformId: integer('platform_id').references(() => platforms.id),
    region: text('region').notNull(),
    valueCents: integer('value_cents'),
    costCents: integer('cost_cents'),
    includeString: text('include_string').notNull(),
    conditionString: text('condition_string').notNull(),
    completeness: text('completeness').notNull(),
    sealed: integer('sealed', { mode: 'boolean' }).notNull(),
    hasBox: integer('has_box', { mode: 'boolean' }).notNull(),
    hasManual: integer('has_manual', { mode: 'boolean' }).notNull(),
    /** Always 1: each copy is a row of its own (the column keeps totals written for the updates' rows working). */
    quantity: integer('quantity').notNull().default(1),
    sku: text('sku').notNull(),
    notes: text('notes').notNull(),
    dateEntered: text('date_entered'),
    datePurchased: text('date_purchased'),
    gradingCompany: text('grading_company').notNull(),
    gradingCertId: text('grading_cert_id').notNull(),
    folder: text('folder').notNull(),
    /** Whose files keep it up to date: pricecharting, spreadsheet, or squirrelcade (a copy no file has). */
    source: text('source').notNull(),
    /** JSON array of the fields the owner changed in Squirrelcade, which files don't overwrite. */
    ownFields: text('own_fields').notNull().default('[]'),
    addedAt: text('added_at').notNull(),
    /** The last applied update whose file had it, and when. */
    importId: integer('import_id'),
    seenAt: text('seen_at'),
    /** Since when its file no longer has it: it waits on Review, still counted. */
    missingSince: text('missing_since'),
    /** When it left the collection, and why: sold, removed, or gone (its file dropped it, Settings > Collection). */
    goneAt: text('gone_at'),
    goneReason: text('gone_reason'),
    /**
     * The include text its file last gave it, which the next file's rows are matched by (0.20.0): the copy's own
     * condition can be changed in Squirrelcade since. Null for a copy no file has had.
     */
    fileInclude: text('file_include'),
    /** A copy sold or removed here that its file still lists (pricecharting or spreadsheet): to remove there by hand (0.20.0). */
    listedOn: text('listed_on'),
    /** When a copy of Squirrelcade's own went into the list for PriceCharting's importer (0.20.0), until an export has it. */
    sentAt: text('sent_at'),
    /**
     * The owner's estimate of what a copy cost when they don't know the price paid (0.21.0, D85): set only by them
     * (typed, or Squirrelcade's suggestion taken), for their own view of what they spent; never a price paid, never in a
     * download or sent to another service, and no file sets it.
     */
    estimatedCents: integer('estimated_cents'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('copies_key_idx').on(t.key), index('copies_live_idx').on(t.goneAt, t.platformId), index('copies_product_idx').on(t.productId)],
);

/** RomM's platforms as last read, for mapping Squirrelcade's platforms to them (see romm.ts). */
export const rommPlatforms = sqliteTable('romm_platforms', {
  /** RomM's own platform id. */
  id: integer('id').primaryKey(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  igdbId: integer('igdb_id'),
  romCount: integer('rom_count').notNull().default(0),
});

/**
 * Squirrelcade's index of the ROMs in RomM on the platforms Squirrelcade maps, so pages can link owned
 * games to RomM without asking RomM; refreshed by the "Update the RomM index" task.
 */
export const rommRoms = sqliteTable(
  'romm_roms',
  {
    /** RomM's own ROM id, as in its links (/rom/<id>). */
    id: integer('id').primaryKey(),
    /** RomM's platform id. */
    platformId: integer('platform_id').notNull(),
    igdbId: integer('igdb_id'),
    name: text('name').notNull(),
    fsName: text('fs_name').notNull(),
    /** JSON arrays of RomM's region and tag names, read from the file name. */
    regions: text('regions').notNull().default('[]'),
    tags: text('tags').notNull().default('[]'),
    /** RomM can run it in the browser. */
    playable: integer('playable', { mode: 'boolean' }).notNull().default(false),
  },
  (t) => [index('romm_roms_platform_igdb_idx').on(t.platformId, t.igdbId)],
);

/** Each reading of Playnite's library (a backup read by the Playnite reader, or an uploaded snapshot) and what it did. */
export const pcReads = sqliteTable('pc_reads', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  readAt: text('read_at').notNull(),
  /** backup (the folder, by the reader) or upload (a snapshot file). */
  source: text('source').notNull(),
  fileName: text('file_name').notNull(),
  /** When Playnite wrote the backup. */
  backupAt: text('backup_at'),
  fingerprint: text('fingerprint').notNull(),
  games: integer('games').notNull(),
  /** JSON object: records per storefront. */
  storefronts: text('storefronts').notNull(),
  /** applied, held (waiting for confirmation: it would lose too many games), discarded or failed. */
  status: text('status').notNull(),
  message: text('message'),
  added: integer('added').notNull().default(0),
  removed: integer('removed').notNull().default(0),
  /** The snapshot itself while a reading is held, so it can be applied later; cleared after. */
  snapshot: text('snapshot'),
});

/** The PC library: one row per game per storefront, as the last applied reading had it (games gone since stay, inactive). */
export const pcGames = sqliteTable(
  'pc_games',
  {
    /** The reader's stable key: "<storefront id>|<storefront game id>". */
    recordKey: text('record_key').primaryKey(),
    playniteId: text('playnite_id').notNull(),
    storefront: text('storefront').notNull(),
    storefrontGameId: text('storefront_game_id').notNull(),
    name: text('name').notNull(),
    /** The title's key without edition marks, shared with its other storefronts and with console games (pcFamilyKey). */
    familyKey: text('family_key').notNull(),
    /** JSON arrays. */
    platforms: text('platforms').notNull().default('[]'),
    genres: text('genres').notNull().default('[]'),
    series: text('series').notNull().default('[]'),
    completionStatus: text('completion_status'),
    releaseYear: integer('release_year'),
    addedAt: text('added_at'),
    lastActivityAt: text('last_activity_at'),
    playtimeSeconds: integer('playtime_seconds').notNull().default(0),
    playCount: integer('play_count').notNull().default(0),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
    installed: integer('installed', { mode: 'boolean' }).notNull().default(false),
    criticScore: integer('critic_score'),
    communityScore: integer('community_score'),
    /** JSON array of { name, url }. */
    links: text('links').notNull().default('[]'),
    firstSeenAt: text('first_seen_at').notNull(),
    lastSeenAt: text('last_seen_at').notNull(),
    /** In the last applied reading. */
    active: integer('active', { mode: 'boolean' }).notNull().default(true),
  },
  (t) => [index('pc_games_family_idx').on(t.familyKey)],
);

/** What the owner verified about storefront games' ownership: from a CSV (list) or set on a game (user). */
export const pcAudit = sqliteTable('pc_audit', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  storefront: text('storefront').notNull(),
  storefrontGameId: text('storefront_game_id'),
  title: text('title').notNull(),
  /** permanent, subscription or historical. */
  ownership: text('ownership').notNull(),
  verifiedAt: text('verified_at'),
  notes: text('notes'),
  /** list (the audit CSV) or user (set on a game). */
  source: text('source').notNull(),
});

/** PC games found for the PC wishlist (IGDB searches), with Steam's review summary where known. */
export const pcCandidates = sqliteTable(
  'pc_candidates',
  {
    igdbId: integer('igdb_id').primaryKey(),
    /** The title's key without edition marks, as the PC library groups games (pcFamilyKey). */
    familyKey: text('family_key').notNull(),
    title: text('title').notNull(),
    /** JSON: the IGDB game as Squirrelcade keeps it (IgdbGame), for its genres, series and reviews. */
    game: text('game').notNull(),
    steamAppId: integer('steam_app_id'),
    /** JSON: Steam's review summary ({ percent, total, summary }), when read. */
    steam: text('steam'),
    steamAt: text('steam_at'),
    /** JSON array: why it was found ("Genre: RPG", "Series: Halo", "Sealed on Nintendo Switch"). */
    sources: text('sources').notNull(),
    foundAt: text('found_at').notNull(),
    seenAt: text('seen_at').notNull(),
  },
  (t) => [index('pc_candidates_family_idx').on(t.familyKey)],
);

/** The owner's choices on PC wishlist games: hidden, snoozed until a date, or a preference. */
export const pcControls = sqliteTable('pc_controls', {
  familyKey: text('family_key').primaryKey(),
  title: text('title').notNull(),
  /** hide, defer (until a date) or null. */
  action: text('action'),
  until: text('until'),
  /** A preference name from Wishlist > Scoring ("Must Have"...), or null. */
  preference: text('preference'),
  updatedAt: text('updated_at').notNull(),
});

/** The owner's own sets of games beyond consoles: a publisher's releases (Limited Run Games), a series, any theme. */
export const gameSets = sqliteTable('game_sets', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  key: text('key').notNull().unique(),
  name: text('name').notNull(),
  /** csv: from a file the owner uploaded; wikipedia: read from a Wikipedia list (page), again on request. */
  source: text('source').notNull(),
  page: text('page'),
  /** Only the set's games on consoles in the collection (a set such as Limited Run's spans many). */
  collectedOnly: integer('collected_only', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  builtAt: text('built_at'),
  /** What the last build said (games read, rows without a known console). */
  message: text('message'),
});

/** A game of a set on one console (a game on three consoles is three rows). */
export const setGames = sqliteTable(
  'set_games',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setId: integer('set_id')
      .notNull()
      .references(() => gameSets.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    platformKey: text('platform_key').notNull(),
    /** JSON array of the game's other names, when the list gives them. */
    altTitles: text('alt_titles'),
    notes: text('notes'),
  },
  (t) => [index('set_games_set_idx').on(t.setId)],
);

/** The owner's answers about a set's game and an owned copy that looks like it: the same game, or not. */
export const setLinks = sqliteTable(
  'set_links',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setId: integer('set_id')
      .notNull()
      .references(() => gameSets.id, { onDelete: 'cascade' }),
    platformKey: text('platform_key').notNull(),
    /** The set game's title key (matchKey), so answers survive reading the set's list again. */
    titleKey: text('title_key').notNull(),
    ownedTitle: text('owned_title').notNull(),
    /** same or different. */
    decision: text('decision').notNull(),
  },
  (t) => [uniqueIndex('set_links_unique').on(t.setId, t.platformKey, t.titleKey, t.ownedTitle)],
);

/** The owner's own changes to a set's list: games added by hand, and games taken out. Kept when the list is read again. */
export const setEdits = sqliteTable(
  'set_edits',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    setId: integer('set_id')
      .notNull()
      .references(() => gameSets.id, { onDelete: 'cascade' }),
    platformKey: text('platform_key').notNull(),
    title: text('title').notNull(),
    /** add or remove. */
    action: text('action').notNull(),
  },
  (t) => [index('set_edits_set_idx').on(t.setId)],
);

/**
 * Each copy's value over time: a point whenever an applied collection update gives a product, in one
 * condition, a value other than its last point's. Pruning old updates' rows leaves these, so a game's price
 * history goes back to the first update.
 */
export const pricePoints = sqliteTable(
  'price_points',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    productId: text('product_id').notNull(),
    /** PriceCharting's condition ("Item, Box, and Manual"): each condition has its own price. */
    includeString: text('include_string').notNull(),
    valueCents: integer('value_cents').notNull(),
    /** When the update that brought the value was applied. */
    recordedAt: text('recorded_at').notNull(),
    importId: integer('import_id').notNull(),
  },
  (t) => [index('price_points_product_idx').on(t.productId, t.includeString)],
);

/**
 * IGDB's summary of a game, asked for the first time the game's drawer opens (a whole console's list of
 * summaries would be megabytes), and kept; null when IGDB has none.
 */
export const igdbSummaries = sqliteTable('igdb_summaries', {
  igdbId: integer('igdb_id').primaryKey(),
  summary: text('summary'),
  fetchedAt: text('fetched_at').notNull(),
});

/**
 * Your own note on a game on a console ("the one with the poster", "ask at the flea market"), shown in its
 * drawer, in Store Mode and next to its title. One per game, under the catalog's title when the catalog has it.
 */
export const gameNotes = sqliteTable(
  'game_notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    platformId: integer('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    /** normalizeTitle(title), as the wishlist's preferences are keyed. */
    titleKey: text('title_key').notNull(),
    note: text('note').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('game_notes_key_idx').on(t.platformId, t.titleKey)],
);

/**
 * The owner's own version of a history text (D49): a console's history, or why a game matters on a console. What
 * ships with Squirrelcade (apps/server/data/history.json) stays apart; this row wins over it, and the hash of the
 * shipped version it started from tells when Squirrelcade's own text changed since.
 */
export const historyNotes = sqliteTable(
  'history_notes',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** console or game */
    kind: text('kind').notNull(),
    platformKey: text('platform_key').notNull(),
    /** matchKey of the game's title; empty for a console. */
    titleKey: text('title_key').notNull().default(''),
    title: text('title'),
    /** JSON: a console's { profile, startHere, asOf }, or a game's { text }. */
    data: text('data').notNull(),
    /** JSON array of web addresses. */
    sources: text('sources').notNull().default('[]'),
    /** draft or verified */
    status: text('status').notNull(),
    shippedHash: text('shipped_hash'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('history_notes_key_idx').on(t.kind, t.platformKey, t.titleKey)],
);

/**
 * The owner's answers on the Copies page: a copy that belongs with another game than its title says (the Japanese
 * title of a game, a PC version named differently), or on its own (two games of the same name). A console copy is
 * "console|platform key|title as in the collection", a PC game "pc|its family key".
 */
export const copyGroups = sqliteTable('copy_groups', {
  copyKey: text('copy_key').primaryKey(),
  /** The group it belongs to: another game's key, or "own:" and its copy key to stand on its own. */
  groupKey: text('group_key').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** The owner's play status and rating for a game on a console, kept by the platform and normalizeTitle(title), like notes. */
export const playStatus = sqliteTable(
  'play_status',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    platformId: integer('platform_id')
      .notNull()
      .references(() => platforms.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    titleKey: text('title_key').notNull(),
    /** backlog, playing, beaten, completed, dropped or shelf; null with only a rating. */
    status: text('status'),
    /** 1 to 10. */
    rating: integer('rating'),
    startedAt: text('started_at'),
    finishedAt: text('finished_at'),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('play_status_key_idx').on(t.platformId, t.titleKey)],
);

/** Links anyone may open without signing in, to see the wishlist or the games for sale; the owner can remove them. */
export const shareLinks = sqliteTable('share_links', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** The link's secret part; shown to the owner again, since it opens nothing but that list. */
  token: text('token').notNull().unique(),
  /** wishlist or sale */
  kind: text('kind').notNull(),
  name: text('name'),
  createdAt: text('created_at').notNull(),
  lastOpenedAt: text('last_opened_at'),
  opens: integer('opens').notNull().default(0),
});

/**
 * The owner's details on a copy: where it's kept, their tags, and whether it's for sale or trade. A copy is a product
 * in one condition, "<product id>|<PriceCharting's include string>", the key the collection's rows keep across updates.
 */
export const copyDetails = sqliteTable('copy_details', {
  copyKey: text('copy_key').primaryKey(),
  productId: text('product_id').notNull(),
  location: text('location'),
  /** JSON array of the owner's tags. */
  tags: text('tags').notNull().default('[]'),
  /** sale or trade; null when it's neither. */
  sale: text('sale'),
  askingCents: integer('asking_cents'),
  saleNote: text('sale_note'),
  /**
   * A digital license claimed with the disc (0.55.0, D129; Xbox disc-to-digital, a code in the box): claimed,
   * unclaimed or not-eligible, null when not said. A claimed one outlives the disc: the game stays owned, digitally.
   */
  digitalClaim: text('digital_claim'),
  digitalClaimedAt: text('digital_claimed_at'),
  /** The store it's claimed on ("Xbox", "PlayStation", "Steam"). */
  digitalStore: text('digital_store'),
  updatedAt: text('updated_at').notNull(),
});

/** Copies lent to someone: open until returned, then kept as history. */
export const loans = sqliteTable(
  'loans',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    copyKey: text('copy_key').notNull(),
    productId: text('product_id').notNull(),
    /** The game and console when it was lent, for the history after the copy is gone. */
    title: text('title').notNull(),
    platformKey: text('platform_key'),
    lentTo: text('lent_to').notNull(),
    lentAt: text('lent_at').notNull(),
    dueAt: text('due_at'),
    returnedAt: text('returned_at'),
    note: text('note'),
    /** When a reminder that it's overdue was sent (once per loan). */
    remindedAt: text('reminded_at'),
  },
  (t) => [index('loans_copy_idx').on(t.copyKey)],
);

/** Photos of copies, made smaller in the browser before they're sent, and kept in the database so backups hold them. */
export const copyPhotos = sqliteTable(
  'copy_photos',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    copyKey: text('copy_key').notNull(),
    productId: text('product_id').notNull(),
    caption: text('caption'),
    /** The standard photo it is ("Box front", "Disc back": Settings > Collection), or null for another photo (0.21.0). */
    slot: text('slot'),
    mime: text('mime').notNull(),
    bytes: integer('bytes').notNull(),
    data: blob('data', { mode: 'buffer' }).notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('copy_photos_copy_idx').on(t.copyKey)],
);

/** Each time a copy was tested (0.21.0): when, whether it worked (works, issues, broken), and a note; by the copy's key. */
export const copyTests = sqliteTable(
  'copy_tests',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    copyKey: text('copy_key').notNull(),
    /** test (played) or rip (its disc read in full, 0.22.0). */
    kind: text('kind').notNull().default('test'),
    result: text('result').notNull(),
    note: text('note'),
    testedAt: text('tested_at').notNull(),
  },
  (t) => [index('copy_tests_copy_idx').on(t.copyKey, t.testedAt)],
);

/**
 * Each copy sold (0.22.0, D86): where, when, for how much, the fees and shipping, and what it cost (its price paid, or
 * the owner's estimate, as they were then), kept after the copy leaves the collection: Collection > Sales.
 */
export const copySales = sqliteTable(
  'copy_sales',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    copyId: integer('copy_id').notNull(),
    copyKey: text('copy_key').notNull(),
    title: text('title').notNull(),
    platformKey: text('platform_key'),
    platform: text('platform'),
    completeness: text('completeness').notNull(),
    /** ebay, mercari, local or other. */
    marketplace: text('marketplace').notNull(),
    soldAt: text('sold_at').notNull(),
    soldCents: integer('sold_cents').notNull(),
    shippingChargedCents: integer('shipping_charged_cents').notNull().default(0),
    feesCents: integer('fees_cents').notNull().default(0),
    shippingCostCents: integer('shipping_cost_cents').notNull().default(0),
    paidCents: integer('paid_cents'),
    estimatedCents: integer('estimated_cents'),
    note: text('note'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('copy_sales_sold_idx').on(t.soldAt)],
);

/** IsThereAnyDeal's prices for the PC wishlist's games (with PC game prices on), by the wishlist's key for the game. */
export const pcPrices = sqliteTable('pc_prices', {
  key: text('key').primaryKey(),
  itadId: text('itad_id'),
  title: text('title').notNull(),
  currency: text('currency'),
  currentCents: integer('current_cents'),
  regularCents: integer('regular_cents'),
  cut: integer('cut'),
  shop: text('shop'),
  url: text('url'),
  lowCents: integer('low_cents'),
  /** Found no game on IsThereAnyDeal (by its Steam app id or title). */
  missing: integer('missing', { mode: 'boolean' }).notNull().default(false),
  fetchedAt: text('fetched_at').notNull(),
  /** The price last alerted about, so each drop is told once. */
  alertedCents: integer('alerted_cents'),
});

/**
 * The owner's RetroAchievements progress (0.18.0): one row per game with progress, as last read (replaced by each
 * read), matched to one of Squirrelcade's consoles and a game title when it could be (for the game's drawer).
 */
export const raProgress = sqliteTable(
  'ra_progress',
  {
    gameId: integer('game_id').primaryKey(),
    /** RetroAchievements' own title and console name. */
    title: text('title').notNull(),
    consoleName: text('console_name').notNull(),
    /** Squirrelcade's console and the game's normalized title (null when the console isn't one Squirrelcade knows). */
    platformKey: text('platform_key'),
    titleKey: text('title_key'),
    numAwarded: integer('num_awarded').notNull(),
    numAwardedHardcore: integer('num_awarded_hardcore').notNull(),
    maxPossible: integer('max_possible').notNull(),
    /** beaten-softcore, beaten-hardcore, completed (mastered in softcore) or mastered; null without one. */
    award: text('award'),
    awardedAt: text('awarded_at'),
    lastPlayedAt: text('last_played_at'),
    syncedAt: text('synced_at').notNull(),
  },
  (t) => [index('ra_progress_game_idx').on(t.platformKey, t.titleKey)],
);

/**
 * The owner's progress on Xbox and PlayStation (0.24.0, D88), replaced at each read of a service: one row per game
 * there, matched to a console and a game Squirrelcade knows when it can be.
 */
export const achievementProgress = sqliteTable(
  'achievement_progress',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** xbox, playstation or steam. */
    source: text('source').notNull(),
    /** The service's id for the game (Xbox's title id, PlayStation's trophy list id, Steam's app id). */
    externalId: text('external_id').notNull(),
    /** The service's own title, and its consoles as it writes them ("XboxOne,XboxSeries", "PS3,PSVITA"). */
    title: text('title').notNull(),
    platforms: text('platforms').notNull(),
    /** Squirrelcade's console and the game's normalized title (null when it isn't one Squirrelcade knows). */
    platformKey: text('platform_key'),
    titleKey: text('title_key'),
    earned: integer('earned').notNull(),
    /** 0 when the service doesn't say (an Xbox 360 game). */
    total: integer('total').notNull(),
    /** Xbox's gamerscore. */
    pointsEarned: integer('points_earned'),
    pointsTotal: integer('points_total'),
    progress: integer('progress').notNull(),
    /** PlayStation: its platinum earned; null for a game without one. */
    platinum: integer('platinum', { mode: 'boolean' }),
    completed: integer('completed', { mode: 'boolean' }).notNull(),
    lastPlayedAt: text('last_played_at'),
    syncedAt: text('synced_at').notNull(),
  },
  (t) => [index('achievement_progress_game_idx').on(t.platformKey, t.titleKey), uniqueIndex('achievement_progress_source_idx').on(t.source, t.externalId)],
);

/**
 * Claude and other AI apps (0.55.0, D127): the apps that may sign people in. Claude names itself by a client metadata
 * document (its client_id is the document's https address, read again after a day); other apps register themselves
 * (dynamic client registration) with redirect addresses Settings › Claude and AI apps allows.
 */
export const oauthClients = sqliteTable('oauth_clients', {
  /** The client_id: a document's address, or one Squirrelcade made at registration. */
  id: text('id').primaryKey(),
  /** document or registered. */
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  /** JSON array of the redirect addresses it may use. */
  redirectUris: text('redirect_uris').notNull(),
  /** A registered app that asked for a secret: its SHA-256 (null for public clients). */
  secretHash: text('secret_hash'),
  createdAt: text('created_at').notNull(),
  fetchedAt: text('fetched_at'),
});

/** People without an account who may connect an AI app (0.55.0, D128): known by an email they prove with a code. */
export const aiGuests = sqliteTable('ai_guests', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Lowercase. */
  email: text('email').notNull().unique(),
  createdAt: text('created_at').notNull(),
});

/** A connection: one person's yes to one app, until it's disconnected. Its codes and tokens hang off it. */
export const oauthGrants = sqliteTable(
  'oauth_grants',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    clientId: text('client_id').notNull(),
    /** An account's, or a guest's. */
    userId: integer('user_id').references(() => users.id, { onDelete: 'cascade' }),
    guestId: integer('guest_id').references(() => aiGuests.id, { onDelete: 'cascade' }),
    scope: text('scope').notNull(),
    /** The address its tokens are for (this Squirrelcade's /mcp). */
    resource: text('resource').notNull(),
    createdAt: text('created_at').notNull(),
    lastUsedAt: text('last_used_at'),
    revokedAt: text('revoked_at'),
  },
  (t) => [index('oauth_grants_user_idx').on(t.userId), index('oauth_grants_guest_idx').on(t.guestId)],
);

/** Sign-in codes, kept by their SHA-256: each works once, for 10 minutes, with the PKCE challenge it was asked with. */
export const oauthCodes = sqliteTable('oauth_codes', {
  hash: text('hash').primaryKey(),
  grantId: integer('grant_id')
    .notNull()
    .references(() => oauthGrants.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  challenge: text('challenge').notNull(),
  expiresAt: text('expires_at').notNull(),
  usedAt: text('used_at'),
});

/** Access and refresh tokens, kept by their SHA-256. A refresh token works once; a second try ends the connection. */
export const oauthTokens = sqliteTable(
  'oauth_tokens',
  {
    hash: text('hash').primaryKey(),
    grantId: integer('grant_id')
      .notNull()
      .references(() => oauthGrants.id, { onDelete: 'cascade' }),
    /** access or refresh. */
    kind: text('kind').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    /** A refresh token traded for new ones. */
    usedAt: text('used_at'),
  },
  (t) => [index('oauth_tokens_grant_idx').on(t.grantId), index('oauth_tokens_expires_idx').on(t.expiresAt)],
);

/**
 * Keys for AI apps on the home network (0.55.0, D130): Claude Code and others send one instead of signing in. Kept by
 * their SHA-256; each belongs to the account that made it and answers as that account, read-only, until revoked.
 */
export const aiKeys = sqliteTable('ai_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** What it's for ("Claude Code on the PC"). */
  name: text('name').notNull(),
  userId: integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  hash: text('hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
});

/** Each call an AI app made (0.55.0): when, who, which app and tool, what it asked (in short), how many answers, how long. */
export const aiCalls = sqliteTable(
  'ai_calls',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: text('at').notNull(),
    grantId: integer('grant_id'),
    /** The key it came with, for a call with a key. */
    keyId: integer('key_id'),
    /** The account's name, or the guest's name with "(guest)". */
    who: text('who').notNull(),
    client: text('client').notNull(),
    tool: text('tool').notNull(),
    /** What was asked, shortened: a search, the first titles checked, a game. */
    asked: text('asked'),
    results: integer('results'),
    ms: integer('ms').notNull(),
    /** ok, error or limited. */
    outcome: text('outcome').notNull(),
  },
  (t) => [index('ai_calls_at_idx').on(t.at), index('ai_calls_grant_idx').on(t.grantId)],
);

/**
 * Friends' collections (0.56.0, D131): people whose Squirrelcade shares with this one. A friendship has one code, made
 * by whoever added the other first and carried by every file between the two (the other side takes it from the first
 * file it brings in), so a file from a stranger, or one with another code, isn't taken for theirs.
 */
export const friends = sqliteTable('friends', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  /** Their email: where your file goes, and where theirs comes from. */
  email: text('email'),
  code: text('code').notNull(),
  /** How they share: by hand (file), by email, or directly. */
  way: text('way').notNull().default('file'),
  createdAt: text('created_at').notNull(),
  /** When your file last went to them (or was downloaded for them). */
  lastSentAt: text('last_sent_at'),
});

/** Each friend's last file, as it came (checked), for comparisons and trades. */
export const friendFiles = sqliteTable('friend_files', {
  friendId: integer('friend_id')
    .primaryKey()
    .references(() => friends.id, { onDelete: 'cascade' }),
  receivedAt: text('received_at').notNull(),
  madeAt: text('made_at').notNull(),
  data: text('data').notNull(),
});
