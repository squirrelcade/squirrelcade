import { IGDB_EXTRA_PLATFORM_IDS, IGDB_PLATFORM_IDS } from './igdb.js';
import { MAIL_PROVIDERS } from './notify.js';
import { EXPORT_LINK_HOSTS } from './mailImport.js';
import { NEW_GAME_PRICES, RIPPABLE_CONSOLES } from './copyCare.js';
import { REGION_LOCKED_DEFAULT } from './platforms.js';
import { STOREFRONT_OWNERSHIP_DEFAULT } from './pc.js';
import { POINT_SHAPES, type PointShape, type ShapeSpec } from './shapes.js';
import { type SettingsPageId } from './settingsPages.js';
import { SHOP_LINK } from './shops.js';
import { CATALOG_SOURCES, DEFAULT_SOURCE_ORDER, type SourceFact, type SourceSetting } from './sources.js';
import { z } from 'zod';

/**
 * Every user-facing choice in Squirrelcade is a setting defined here (see
 * "Settings" in docs/PLAN.md). The server validates and stores values; the web
 * app renders the settings pages from these definitions.
 */

export { SETTINGS_PAGES, type SettingsPageId } from './settingsPages.js';

/** How a setting is edited on its page and how its values are checked. */
export type SettingKind = 'text' | 'number' | 'boolean' | 'select' | 'secret' | 'list' | 'path' | 'points' | 'tiers' | 'percentTiers' | 'shapes' | 'sources';

/** One choice of a select setting. */
export interface SettingOption {
  value: string;
  label: string;
}

/** A setting: where it shows, what it means, its default, and the schema its values must pass. */
export interface SettingDefinition<T = unknown> {
  page: SettingsPageId;
  section: string;
  label: string;
  description: string;
  kind: SettingKind;
  default: T;
  schema: z.ZodType<T>;
  options?: readonly SettingOption[];
  unit?: string;
  min?: number;
  max?: number;
  /** Digits a number may have after its point (none unless said: a count, days, cents). */
  decimals?: number;
  /** Hidden until "Show advanced" is on. */
  advanced?: boolean;
  /** A list of platform keys, edited as checkboxes: of the tracked consoles, or of every console Squirrelcade knows. */
  platforms?: 'tracked' | 'known';
  /** Takes effect after a restart. */
  restartRequired?: boolean;
  /** Shown only while this switch (a boolean setting) is on, as the page has it: a service's fields under its switch. */
  shownWhen?: string;
}

type Common = Pick<SettingDefinition, 'page' | 'section' | 'label' | 'description' | 'advanced' | 'restartRequired' | 'shownWhen'>;

function text(def: Common & { default: string; maxLength?: number }): SettingDefinition<string> {
  return { ...def, kind: 'text', schema: z.string().trim().max(def.maxLength ?? 200) };
}

function path(def: Common & { default: string }): SettingDefinition<string> {
  return { ...def, kind: 'path', schema: z.string().trim().max(500) };
}

function num(def: Common & { default: number; min: number; max: number; unit?: string; decimals?: number }): SettingDefinition<number> {
  const places = def.decimals ?? 0;
  const schema = places > 0 ? z.number().min(def.min).max(def.max).refine((v) => Math.abs(Math.round(v * 10 ** places) - v * 10 ** places) < 1e-6, `At most ${places} digits after the point`) : z.number().int().min(def.min).max(def.max);
  return { ...def, kind: 'number', schema };
}

function bool(def: Common & { default: boolean }): SettingDefinition<boolean> {
  return { ...def, kind: 'boolean', schema: z.boolean() };
}

function select<const V extends string>(
  def: Common & { default: V; options: readonly { value: V; label: string }[] },
): SettingDefinition<V> {
  const values = def.options.map((o) => o.value) as [V, ...V[]];
  return { ...def, kind: 'select', schema: z.enum(values) as unknown as z.ZodType<V> };
}

function list(def: Common & { default: string[]; maxItems?: number; platforms?: 'tracked' | 'known' }): SettingDefinition<string[]> {
  return {
    ...def,
    kind: 'list',
    schema: z.array(z.string().trim().min(1).max(200)).max(def.maxItems ?? 200),
  };
}

/** A password or key: never sent back to the browser, never in settings exports. */
function secret(def: Common): SettingDefinition<string> {
  return { ...def, kind: 'secret', default: '', schema: z.string().max(500) };
}

const WEB_ADDRESS = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const webAddress = (value: string) => value === '' || WEB_ADDRESS.test(value);
const WEB_ADDRESS_MESSAGE = 'An address starting with http:// or https://';

/** A web address (a server of your own): empty, or http(s)://... */
function url(def: Common & { default: string }): SettingDefinition<string> {
  return { ...def, kind: 'text', schema: z.string().trim().max(500).refine(webAddress, WEB_ADDRESS_MESSAGE) };
}

/** A web address with a secret in it (a webhook's): kept like a password. */
function secretUrl(def: Common): SettingDefinition<string> {
  return { ...def, kind: 'secret', default: '', schema: z.string().trim().max(500).refine(webAddress, WEB_ADDRESS_MESSAGE) };
}

const pointValue = z.number().int().min(-1000).max(1000);

/** Named point values, such as points per genre or per platform. */
function points(def: Common & { default: Record<string, number>; keyLabel: string }): SettingDefinition<Record<string, number>> & { keyLabel: string } {
  return { ...def, kind: 'points', schema: z.record(z.string().trim().min(1).max(100), pointValue) };
}

/** Points by a percentage, such as how complete a console is: the highest tier the percentage reaches applies. */
export type PercentTiers = { min: number; points: number }[];

/** Points by a percentage: tiers of "at least this percent → these points". */
function percentTiers(def: Common & { default: PercentTiers; countLabel: string }): SettingDefinition<PercentTiers> & { countLabel: string } {
  return { ...def, kind: 'percentTiers', schema: z.array(z.object({ min: z.number().min(0).max(100), points: pointValue })).max(20) };
}

/** How each ranked list of acorns is shaped (see shapes.ts), by the setting's key: kept for the Acorns page, not a field of its own. */
function shapes(def: Common & { default: Record<string, ShapeSpec> }): SettingDefinition<Record<string, ShapeSpec>> {
  const shape = z.enum(POINT_SHAPES.map((s) => s.value) as [PointShape, ...PointShape[]]);
  return {
    ...def,
    kind: 'shapes',
    schema: z.record(z.string().max(100), z.object({ shape, top: pointValue, bottom: pointValue, order: z.array(z.string().trim().min(1).max(100)).max(500) })),
  };
}

/** The choices for trusting a source first for one fact: the order as it is, or one of the sources that give that fact. */
const trustFirst = (fact: SourceFact) => [{ value: '', label: 'The order above' }, ...CATALOG_SOURCES.filter((s) => s.provides.includes(fact)).map((s) => ({ value: s.id, label: s.name }))];

/** The catalog sources in the order they're trusted, each on or off (see sources.ts). */
function sources(def: Common & { default: SourceSetting[] }): SettingDefinition<SourceSetting[]> {
  return { ...def, kind: 'sources', schema: z.array(z.object({ id: z.string().trim().min(1).max(50), on: z.boolean() })).max(50) };
}

/** Points by count, for tier settings such as console completion: the first tier whose "up to" covers the count applies. */
export type Tiers = { max: number; points: number }[];

/** Points by count: the first tier whose "up to" covers the count applies. */
function tiers(def: Common & { default: Tiers; countLabel: string }): SettingDefinition<Tiers> & { countLabel: string } {
  return {
    ...def,
    kind: 'tiers',
    schema: z.array(z.object({ max: z.number().int().min(1).max(100000), points: pointValue })).max(20),
  };
}

function isTimeZone(value: string): boolean {
  if (value === '') return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Pushover's priorities, with what each does on the phone. */
const PUSHOVER_PRIORITIES = [
  { value: '-2', label: 'Lowest: no alert, only listed in the app' },
  { value: '-1', label: 'Quiet: shown without a sound' },
  { value: '0', label: 'Normal' },
  { value: '1', label: 'High: sounds even in quiet hours' },
  { value: '2', label: 'Emergency: Pushover repeats it every minute until you acknowledge it (up to an hour); the most urgent on ntfy and Gotify' },
] as const;

/** The optional parts of Squirrelcade (Settings > Features): each needs something outside Squirrelcade, or can simply be left out. */
export type FeatureKey = 'igdb' | 'history' | 'pc' | 'romm' | 'itad' | 'mail' | 'retroachievements' | 'xbox' | 'playstation' | 'steam';

/** Each optional part's switch. */
export const FEATURE_SETTINGS = {
  igdb: 'features.igdb',
  history: 'features.history',
  pc: 'features.pc',
  romm: 'features.romm',
  itad: 'features.itad',
  mail: 'features.mail',
  retroachievements: 'features.retroachievements',
  xbox: 'features.xbox',
  playstation: 'features.playstation',
  steam: 'features.steam',
} as const satisfies Record<FeatureKey, string>;

/**
 * Whether each optional part is on in a new install: the ones that work with nothing to set up, and IGDB (which
 * does nothing until it has its keys); the ones that need another program (Playnite, RomM) start off.
 */
export const FEATURE_DEFAULTS: Readonly<Record<FeatureKey, boolean>> = { igdb: true, history: true, pc: false, romm: false, itad: false, mail: false, retroachievements: false, xbox: false, playstation: false, steam: false };

/** Every setting Squirrelcade has, by key: the one list the settings pages, validation, defaults and exports are built from. */
export const settingDefinitions = {
  // General
  'general.instanceName': text({
    page: 'general',
    section: 'Instance',
    label: 'Instance name',
    description: 'Shown in the browser tab and in notifications.',
    default: 'Squirrelcade',
    maxLength: 60,
  }),
  'general.timeZone': {
    page: 'general',
    section: 'Localization',
    label: 'Time zone',
    description: 'Used for schedules and dates. Leave empty to use the server time zone (the TZ variable in Docker).',
    kind: 'text',
    default: '',
    schema: z.string().trim().refine(isTimeZone, 'Not a known time zone, for example America/Phoenix'),
  } satisfies SettingDefinition<string>,
  'general.currency': select({
    page: 'general',
    section: 'Localization',
    label: 'Currency',
    description:
      "The currency of your PriceCharting export's prices (PriceCharting's prices are in US dollars unless you set its currency). Squirrelcade shows the export's amounts in it, as they are: it doesn't convert between currencies.",
    default: 'USD',
    options: [
      { value: 'USD', label: 'US dollar' },
      { value: 'CAD', label: 'Canadian dollar' },
      { value: 'EUR', label: 'Euro' },
      { value: 'GBP', label: 'British pound' },
      { value: 'AUD', label: 'Australian dollar' },
      { value: 'JPY', label: 'Japanese yen' },
    ],
  }),
  'general.publicUrl': text({
    page: 'general',
    section: 'Instance',
    label: 'Address of this Squirrelcade',
    description: 'The web address you open Squirrelcade at, such as https://squirrelcade.example.com. Used for links in notifications.',
    default: '',
    maxLength: 300,
  }),
  'general.dateFormat': select({
    page: 'general',
    section: 'Localization',
    label: 'Date format',
    description: 'How dates are shown.',
    default: 'us',
    options: [
      { value: 'us', label: 'Month/day/year (9/27/2026)' },
      { value: 'eu', label: 'Day/month/year (27/09/2026)' },
      { value: 'iso', label: 'Year-month-day (2026-09-27)' },
    ],
  }),
  'general.homeRegion': select({
    page: 'general',
    section: 'Collecting',
    label: 'Home region',
    description: 'Your region. Releases from it are the default collecting targets; other regions count as imports.',
    default: 'north-america',
    options: [
      { value: 'north-america', label: 'North America' },
      { value: 'europe', label: 'Europe (PAL)' },
      { value: 'japan', label: 'Japan' },
      { value: 'asia', label: 'Asia' },
    ],
  }),
  'general.logLevel': select({
    page: 'general',
    section: 'Logging',
    label: 'Log level',
    description: 'How much detail goes into the logs. Debug is for troubleshooting.',
    default: 'info',
    advanced: true,
    options: [
      { value: 'debug', label: 'Debug' },
      { value: 'info', label: 'Info' },
      { value: 'warn', label: 'Warnings' },
      { value: 'error', label: 'Errors only' },
    ],
  }),

  // Interface
  'interface.theme': select({
    page: 'interface',
    section: 'Appearance',
    label: 'Theme',
    description: 'Color theme. Auto follows your device.',
    default: 'dark',
    options: [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
      { value: 'auto', label: 'Auto' },
    ],
  }),
  'interface.showCoverArt': bool({
    page: 'interface',
    section: 'Appearance',
    label: 'Show cover art',
    description: 'Show box art in lists when it is available.',
    default: true,
  }),
  'interface.preferenceStyle': select({
    page: 'interface',
    section: 'Appearance',
    label: 'Your preferences shown as',
    description:
      "How the wishlist, Coming soon, Past releases and a game's drawer show your preference for a game: its mark and the acorns it adds (🔥 +20), small; its mark and name (🔥 Must Have); or just its mark, which takes the least room. The mark follows the preference's acorns: 🔥 your top one, ⭐ the next, 👍 the others above zero, 👎 below zero, 🚫 Do Not Recommend.",
    default: 'acorns',
    options: [
      { value: 'acorns', label: 'Mark and acorns' },
      { value: 'full', label: 'Mark and name' },
      { value: 'compact', label: 'Mark only' },
    ],
  }),
  'interface.tableDensity': select({
    page: 'interface',
    section: 'Tables',
    label: 'Table density',
    description: 'Row spacing in tables.',
    default: 'compact',
    options: [
      { value: 'compact', label: 'Compact' },
      { value: 'comfortable', label: 'Comfortable' },
    ],
  }),
  'interface.pageSize': num({
    page: 'interface',
    section: 'Tables',
    label: 'Rows per page',
    description: 'How many rows a table shows at once.',
    default: 100,
    min: 25,
    max: 1000,
  }),
  'interface.regionBadges': select({
    page: 'interface',
    section: 'Tables',
    label: 'Region badges',
    description:
      'Which owned copies carry a region badge (JP, PAL, US...) on the Collection page, the consoles\' pages and in Store Mode, so a Super Famicom copy stands out from a Super Nintendo one.',
    default: 'other',
    options: [
      { value: 'other', label: 'Copies from other regions than your home region' },
      { value: 'all', label: 'Every copy, your home region too' },
      { value: 'off', label: 'None' },
    ],
  }),
  'interface.searchResults': num({
    page: 'interface',
    section: 'Navigation',
    label: 'Games the header search lists',
    description: 'How many games the search box at the top of every page shows, the best matches first.',
    default: 8,
    min: 3,
    max: 30,
  }),
  'interface.startPage': select({
    page: 'interface',
    section: 'Navigation',
    label: 'Start page',
    description: 'The page that opens first. Today is the home page: the squirrel at the top left always brings you back to it.',
    default: 'today',
    options: [
      { value: 'today', label: 'Today (the game of the day, deals, this week\'s releases, loans due)' },
      { value: 'collection', label: 'Stash' },
      { value: 'platforms', label: 'Platforms' },
      { value: 'wishlist', label: 'Acorns wishlist' },
    ],
  }),
  'interface.shopLinks': {
    ...list({
      page: 'interface',
      section: 'Game pages',
      label: 'Shop links',
      description:
        "Links to look for a game in a shop or on a price comparison site, in each game's drawer and on Past releases. Write each as a name, a bar and the site's search address, with {title} where the game's title goes and {platform} for its console, such as \"eBay | https://www.ebay.com/sch/i.html?_nkw={title}+{platform}\"; a second bar and consoles keep a link to those consoles (\"... | Nintendo Switch, Nintendo Switch 2\"). Empty shows none (PriceCharting's link is always there).",
      default: [
        'eBay | https://www.ebay.com/sch/i.html?_nkw={title}+{platform} | | Used marketplaces',
        'Mercari | https://www.mercari.com/search/?keyword={title}+{platform} | | Used marketplaces',
        'FB Marketplace | https://www.facebook.com/marketplace/search/?query={title}+{platform} | | Used marketplaces',
        'OfferUp | https://offerup.com/search?q={title}+{platform} | | Used marketplaces',
        'eStarland | https://www.estarland.com/search?q={title} | | Game stores',
        'DKOldies | https://www.dkoldies.com/search.php?search_query={title} | NES, Super Nintendo, Nintendo 64, Game Boy, Game Boy Color, Game Boy Advance, GameCube, Wii, Sega Genesis, PlayStation, PlayStation 2 | Game stores',
        'GameStop | https://www.gamestop.com/search/?q={title} | | Game stores',
        'Amazon | https://www.amazon.com/s?k={title}+{platform} | Nintendo Switch, Nintendo Switch 2, PlayStation 4, PlayStation 5, Xbox One, Xbox Series X | New games',
        'Best Buy | https://www.bestbuy.com/site/searchpage.jsp?st={title}+{platform} | Nintendo Switch, Nintendo Switch 2, PlayStation 4, PlayStation 5, Xbox One, Xbox Series X | New games',
        'Walmart | https://www.walmart.com/search?q={title}+{platform} | Nintendo Switch, Nintendo Switch 2, PlayStation 4, PlayStation 5, Xbox One, Xbox Series X | New games',
        'Target | https://www.target.com/s?searchTerm={title}+{platform} | Nintendo Switch, Nintendo Switch 2, PlayStation 4, PlayStation 5, Xbox One, Xbox Series X | New games',
        'Deku Deals | https://www.dekudeals.com/search?q={title} | Nintendo Switch, Nintendo Switch 2 | New games',
        'Play-Asia | https://www.play-asia.com/en/search/{title} | | Imports and PAL',
        'Solaris Japan | https://solarisjapan.com/search?q={title} | | Imports and PAL',
        'Limited Run Games | https://limitedrungames.com/search?q={title} | | Limited releases',
        'Super Rare Games | https://superraregames.com/search?q={title} | | Limited releases',
        'Whatnot | https://www.whatnot.com/search?query={title}+{platform} | | Off the beaten path',
        'ZenMarket (Japan) | https://zenmarket.jp/en/yahoo.aspx?q={title} | | Off the beaten path',
      ],
      maxItems: 40,
    }),
    schema: z.array(z.string().trim().max(400).regex(SHOP_LINK, 'Write each as "Name | https://...", with {title} where the title goes.')).max(40),
  },
  'interface.pastYears': num({
    page: 'interface',
    section: 'Past releases',
    label: 'Years back',
    description: 'Acorns > Past releases lists the games that came out around this time of year, one year at a time, back this many years. Games a few years old often cost less than at release.',
    default: 4,
    min: 1,
    max: 10,
    unit: 'years',
  }),
  'interface.pastWindowDays': num({
    page: 'interface',
    section: 'Past releases',
    label: 'Around this time: days either side',
    description: "How many days before and after today's date, in each of those years, count as around this time.",
    default: 30,
    min: 7,
    max: 182,
    unit: 'days',
  }),
  'interface.storeOffline': bool({
    page: 'interface',
    section: 'Store Mode',
    label: 'Answer without a connection',
    description:
      "Store Mode keeps a copy of its answers (your consoles' catalogs, what you own, your saved barcodes and notes) in the browser of the phone or computer it opens on, updated each time it opens, and answers from that copy when Squirrelcade can't be reached (no signal in a store, say). Signing out removes the copy. Off keeps nothing in the browser.",
    default: true,
  }),

  'interface.timelineGames': num({
    page: 'interface',
    section: 'Top 100 and history',
    label: 'Landmark games per console on the timeline',
    description: 'The timeline (Platforms > Timeline) shows the consoles by year and, for each, this many of the best games of its Top 100 list, plus its "Start here" games. 0 shows only the consoles.',
    default: 5,
    min: 0,
    max: 25,
  }),

  'interface.webSearch': select({
    page: 'interface',
    section: 'Help',
    label: 'Web searches',
    description:
      "Setup steps (for an app password, a push service's token...) link to the page it's done on, and to a web search that finds it if that page has moved. The search engine those searches use.",
    default: 'google',
    options: [
      { value: 'google', label: 'Google' },
      { value: 'duckduckgo', label: 'DuckDuckGo' },
      { value: 'bing', label: 'Bing' },
      { value: 'startpage', label: 'Startpage' },
    ],
  }),

  // Features: the optional parts. Only a collection (a PriceCharting export) is required.
  'features.igdb': bool({
    page: 'features',
    section: 'Optional features',
    label: 'Covers and game details from IGDB',
    description:
      "Box art, genres, series, release dates and developers from IGDB, a free game database, for the pages, the wishlist's acorns and catalogs. Needs a free Twitch developer application: with this on, enter its keys right below (they're in Settings > Sources > IGDB too). Off, Squirrelcade never contacts IGDB and shows no covers.",
    default: FEATURE_DEFAULTS.igdb,
  }),
  'features.history': bool({
    page: 'features',
    section: 'Optional features',
    label: 'Top 100 lists and console history',
    description:
      "Each console's best games in ranked order with what you have of them, each console's history with a few games to start with, why games matter, and a timeline of consoles and landmark games. Ships with Squirrelcade: nothing to set up.",
    default: FEATURE_DEFAULTS.history,
  }),
  'features.pc': bool({
    page: 'features',
    section: 'Optional features',
    label: 'PC library (Playnite)',
    description:
      "Your PC games from every storefront (Steam, GOG, Epic...), read from Playnite's backups: the PC library, a PC wishlist, and PC copies next to your console copies (on the Copies page, in the wishlist and in Store Mode). Needs Playnite on a Windows PC and its backup folder shared with Squirrelcade: turn this on, then name the folder right below (the rest is in Settings > PC library).",
    default: FEATURE_DEFAULTS.pc,
  }),
  'features.romm': bool({
    page: 'features',
    section: 'Optional features',
    label: 'RomM links',
    description:
      'Links from your games to your own RomM, a self-hosted game library that can play games in the browser. Needs a RomM server and an API token: turn this on, then enter them right below (the rest is in Settings > Sources > RomM).',
    default: FEATURE_DEFAULTS.romm,
  }),
  'features.itad': bool({
    page: 'features',
    section: 'Optional features',
    label: 'PC game prices (IsThereAnyDeal)',
    description:
      "The best current price and the lowest price ever of each game on the PC wishlist, from IsThereAnyDeal, and a message when one drops. Needs the PC library and a free IsThereAnyDeal API key: turn this on, then enter the key right below (when to be told is in Settings > PC library > Prices).",
    default: FEATURE_DEFAULTS.itad,
  }),
  'features.mail': bool({
    page: 'features',
    section: 'Optional features',
    label: 'Stash updates from your email',
    description:
      "PriceCharting emails you a link to your export when you ask for one (My Collection › Download (CSV)). With this on, Squirrelcade checks your mailbox for that email and updates your collection from it: you ask PriceCharting for the export, and the rest happens here. It looks only at PriceCharting's emails, never changes or deletes mail, and signs in with an app password (the one email notifications use works): turn this on, then fill in the account right below, or leave it empty to use the email notifications' account.",
    default: FEATURE_DEFAULTS.mail,
  }),
  'features.retroachievements': bool({
    page: 'features',
    section: 'Optional features',
    label: 'RetroAchievements',
    description:
      "What you've beaten, completed and mastered on RetroAchievements (retroachievements.org, achievements for classic games you play in emulators), on each of your games: in its drawer, and if you like in What you played. Needs your RetroAchievements username and its free web API key: turn this on, then enter them right below. Squirrelcade only reads.",
    default: FEATURE_DEFAULTS.retroachievements,
  }),
  'features.xbox': bool({
    page: 'features',
    section: 'Optional features',
    label: 'Xbox achievements',
    description:
      "Your achievements on Xbox 360, Xbox One and Xbox Series X|S, on each of your games: how many, the gamerscore and when you last played, in its drawer, and if you like in What you played. Xbox has no public API for them, so Squirrelcade reads them through OpenXBL (xbl.io), a free service you sign in to with your Microsoft account: turn this on, then enter its key right below. Squirrelcade only reads.",
    default: FEATURE_DEFAULTS.xbox,
  }),
  'features.playstation': bool({
    page: 'features',
    section: 'Optional features',
    label: 'PlayStation trophies',
    description:
      "Your trophies on PS3, PS4, PS5 and Vita, on each of your games: how many, the platinum and when you last earned one, in its drawer, and if you like in What you played. Sony has no public API for them: Squirrelcade uses the one the PlayStation App uses (unofficial, so it could stop working if Sony changes it), with a sign-in token you copy from your browser, which lasts about two months: turn this on, then enter it right below. Squirrelcade only reads.",
    default: FEATURE_DEFAULTS.playstation,
  }),
  'features.steam': bool({
    page: 'features',
    section: 'Optional features',
    label: 'Steam achievements',
    description:
      "Your achievements in the PC library's Steam games: how many of each game's you have, and a filter for the games you completed on Steam. Read through Steam's own Web API with a free key, once a day (only the games you played since). Needs the PC library, and your Steam profile's game details set to public: turn this on, then enter the key and your profile right below. Squirrelcade only reads.",
    default: FEATURE_DEFAULTS.steam,
  }),

  // Collection
  'collection.dropFolderEnabled': bool({
    page: 'collection',
    section: 'Watched folder',
    label: 'Watch a folder for exports',
    description: 'Update your collection from PriceCharting exports saved into the watched folder (see Storage and backups).',
    default: true,
  }),
  'collection.importFilePattern': text({
    page: 'collection',
    section: 'Watched folder',
    label: 'File name pattern',
    description:
      'Files to pick up from the watched folder; separate several patterns with ";". * matches anything. PriceCharting\'s export is collection_YYYYMMDD.csv, and it arrives as collection.zip, which works as it is.',
    default: 'collection_*.csv; collection*.zip',
    maxLength: 100,
  }),
  'collection.afterImport': select({
    page: 'collection',
    section: 'Watched folder',
    label: 'After using a file',
    description: 'What to do with a file from the watched folder once your collection has been updated from it.',
    default: 'move',
    options: [
      { value: 'move', label: 'Move it into a "done" subfolder' },
      { value: 'leave', label: 'Leave it (the same file is never used twice)' },
    ],
  }),
  'mail.username': text({
    page: 'email',
    section: 'A different mailbox for exports',
    label: 'Its address',
    description: "Only if PriceCharting's emails go to another mailbox than your account above: its address. Empty: your account above.",
    default: '',
    advanced: true,
  }),
  'mail.password': secret({
    page: 'email',
    section: 'A different mailbox for exports',
    label: 'Its app password',
    description: "That mailbox's app password. Empty: your account's above.",
    advanced: true,
  }),
  'mail.imapHost': text({
    page: 'email',
    section: 'A different mailbox for exports',
    label: 'Incoming mail server',
    description: "The IMAP server, such as imap.gmail.com. Empty: your provider's (Your email account).",
    default: '',
    advanced: true,
  }),
  'mail.imapPort': num({
    page: 'email',
    section: 'A different mailbox for exports',
    label: 'Incoming mail port',
    description: '993 (encrypted from the start) is what nearly every provider uses.',
    default: 993,
    min: 1,
    max: 65535,
    advanced: true,
  }),
  'mail.checkMinutes': num({
    page: 'email',
    section: 'Stash updates from your email',
    label: 'Check the mailbox every',
    description: "How often Squirrelcade looks for a new PriceCharting export email.",
    default: 30,
    min: 5,
    max: 1440,
    unit: 'minutes',
  }),
  'mail.sender': text({
    page: 'email',
    section: 'Stash updates from your email',
    label: 'Export emails come from',
    description: "PriceCharting sends exports from sales@vgpc.com; \"vgpc.com\" matches any address there.",
    default: 'vgpc.com',
    advanced: true,
  }),
  'mail.subject': text({
    page: 'email',
    section: 'Stash updates from your email',
    label: 'Export emails\' subject has',
    description: 'Words in the subject of the export email ("Your Exported Collection: Video Games"; exports of PriceCharting\'s other collections, such as cards, are left alone).',
    default: 'Exported Collection: Video Games',
    advanced: true,
  }),
  'mail.folder': text({
    page: 'email',
    section: 'Stash updates from your email',
    label: 'Folder to look in',
    description: "Empty: all your mail where the server has an All Mail folder (as Gmail does, so a filter that skips the inbox doesn't matter), else the inbox.",
    default: '',
    advanced: true,
  }),
  'mail.maxAgeDays': num({
    page: 'email',
    section: 'Stash updates from your email',
    label: 'Look at emails from the last',
    description: "Older export emails are left alone: PriceCharting's download link lasts 7 days.",
    default: 7,
    min: 1,
    max: 60,
    unit: 'days',
    advanced: true,
  }),
  'mail.linkHosts': list({
    page: 'email',
    section: 'Stash updates from your email',
    label: 'Download exports only from',
    description:
      "The sites an export email's link may lead to (PriceCharting keeps exports on Google's storage). A link anywhere else is ignored, so an email pretending to be PriceCharting's can't make Squirrelcade fetch other addresses.",
    default: [...EXPORT_LINK_HOSTS],
    maxItems: 10,
    advanced: true,
  }),
  'mail.deals': bool({
    page: 'email',
    section: "PriceCharting's deal emails",
    label: "Read PriceCharting's deal emails too",
    description:
      "With a wishlist on PriceCharting, it emails you when one of its games is listed on eBay below the market value. Squirrelcade reads those emails too and lists the deals on Acorns > Deals, next to your own wishlist's ranks; the game of the day favors a game with a fresh deal.",
    default: true,
  }),
  'mail.dealDays': num({
    page: 'email',
    section: "PriceCharting's deal emails",
    label: 'Keep deals for',
    description: 'A deal older than this leaves the list (an eBay listing below the market value rarely lasts long).',
    default: 7,
    min: 1,
    max: 60,
    unit: 'days',
    advanced: true,
  }),
  'mail.dealsLeaveOutParts': bool({
    page: 'email',
    section: "PriceCharting's deal emails",
    label: 'Leave out a manual, case or box listed alone',
    description:
      "PriceCharting's deal emails compare a listing with a whole game's market value, so a manual, a case, a box or artwork listed alone (\"Manual Only\", \"Case Only\", \"No Game\"), a reproduction or a strategy guide looks like a bargain it isn't. With this on, such listings (by their own titles) are left out of Deals, Today, the game of the day and the messages. A disc or cartridge alone is the game, and stays.",
    default: true,
  }),
  'mail.dealAlertRank': num({
    page: 'email',
    section: "PriceCharting's deal emails",
    label: 'Tell me about deals on my wishlist\'s top',
    description:
      "A message (on the ways set up in Settings > Notifications) when a new deal from PriceCharting's emails is on one of your top games here, with its rank, price and listing: PriceCharting emails every deal on its own wishlist, this picks out the ones your Squirrelcade wishlist ranks highest. 0: no messages.",
    default: 0,
    min: 0,
    max: 500,
    unit: 'games',
  }),
  'gotd.dealPoints': num({
    page: 'notifications',
    section: 'Game of the day',
    label: 'Acorns for a deal',
    description: "Extra acorns in the draw for a game with a fresh deal from PriceCharting's emails (collection updates from your email, with deal emails on).",
    default: 15,
    min: 0,
    max: 50,
    unit: 'acorns',
    shownWhen: 'gotd.enabled',
    advanced: true,
  }),
  'collection.exportReminderDays': num({
    page: 'collection',
    section: 'Reminders',
    label: 'Remind me to export after',
    description:
      "A message when your newest PriceCharting export is this many days old, with a link to PriceCharting's collection page (where you ask for the export). With collection updates from your email on, that one tap is all an update takes. 0: no reminders.",
    default: 0,
    min: 0,
    max: 365,
    unit: 'days',
  }),
  'collection.maxRemovalPercent': num({
    page: 'collection',
    section: 'Safety',
    label: 'Hold updates that remove more than',
    description: 'An update that would remove more than this share of your collection waits for you to confirm it. Protects against a cut-off or wrong file.',
    default: 10,
    min: 0,
    max: 100,
    unit: '%',
  }),
  'collection.boughtCondition': select({
    page: 'collection',
    section: 'Adding copies',
    label: 'Condition of a game you just bought',
    description:
      "What \"I bought it\" (Store Mode and a game's drawer) records a copy as, so one tap is enough in a store. Change a copy's condition, price paid and date in its drawer.",
    default: 'complete',
    options: [
      { value: 'sealed', label: 'Sealed (new)' },
      { value: 'complete', label: 'Complete in box' },
      { value: 'loose', label: 'Loose' },
    ],
  }),
  'collection.ripConsoles': list({
    page: 'collection',
    section: 'Your copies',
    label: 'Consoles whose games you rip',
    description:
      "A copy on these consoles can be marked ripped, with how the read went (read fully, read with errors, couldn't be read): a full read is the best test there is, and its listing says so (\"The disc was read in full and verified without errors\"). The defaults are the consoles whose discs a PC can rip in full with a Blu-ray drive flashed with OmniDrive (the ASUS BW-16D1HT, several LG drives) and redumper: PlayStation 1 to 5, the Xbox consoles, GameCube, Wii, Wii U, Sega CD, Saturn and 3DO. Not PSP or Dreamcast, whose discs a PC drive can't read. With a cartridge reader (the Open Source Cartridge Reader, say), add its consoles.",
    default: [...RIPPABLE_CONSOLES],
    maxItems: 100,
    platforms: 'known',
  }),
  'collection.goal': num({
    page: 'collection',
    section: 'Your goal',
    label: 'Your collection\'s goal',
    description:
      'How many copies (or games, below) you mean to have. Today and Statistics show how far you are, your pace over the last 12 months, and when you\'d get there; once you\'re there, how many are over it. 0 means no goal.',
    default: 0,
    min: 0,
    max: 1_000_000,
  }),
  'collection.goalCounts': select({
    page: 'collection',
    section: 'Your goal',
    label: 'The goal counts',
    description: 'Copies (each copy you own, two of a game counting twice) or games (a game on a console once, however many copies).',
    default: 'copies',
    options: [
      { value: 'copies', label: 'Copies' },
      { value: 'games', label: 'Games' },
    ],
  }),
  'selling.ebayFeePercent': num({
    page: 'collection',
    section: 'Selling',
    label: "eBay's fee",
    description: "What eBay keeps of a sale (the total, shipping the buyer pays included), for what a listing would bring you. 13.6% for video games in the US in 2026; check eBay's fees for your country.",
    default: 13.6,
    min: 0,
    max: 50,
    unit: '%',
    decimals: 2,
  }),
  'selling.ebayOrderFeeCents': num({
    page: 'collection',
    section: 'Selling',
    label: "eBay's fee per order",
    description: 'In cents: 40 in the US in 2026 for an order over $10 (30 for smaller ones).',
    default: 40,
    min: 0,
    max: 1000,
    unit: 'cents',
  }),
  'selling.mercariFeePercent': num({
    page: 'collection',
    section: 'Selling',
    label: "Mercari's fee",
    description: "What Mercari keeps of a sale, shipping the buyer pays included: 10% in the US in 2026 (it no longer charges for payment processing).",
    default: 10,
    min: 0,
    max: 50,
    unit: '%',
    decimals: 2,
  }),
  'selling.shippingCents': num({
    page: 'collection',
    section: 'Selling',
    label: 'What shipping a game costs you',
    description: "In cents, taken off what a sale brings when the buyer doesn't pay for shipping (a padded mailer and postage: about 500 in the US).",
    default: 500,
    min: 0,
    max: 10000,
    unit: 'cents',
  }),
  'selling.mealCents': num({
    page: 'collection',
    section: 'Selling',
    label: 'What a meal costs',
    description: "In cents: Sales counts what your sales brought in meals (a lunch, a dinner out) as well as money.",
    default: 1500,
    min: 100,
    max: 100000,
    unit: 'cents',
  }),
  'selling.keepTag': text({
    page: 'collection',
    section: 'Selling',
    label: 'The tag of a copy you keep',
    description: 'Copies with this tag (Your copies) are never suggested for selling. Empty: every copy can be.',
    default: 'Keeper',
    maxLength: 30,
  }),
  'selling.footer': text({
    page: 'collection',
    section: 'Selling',
    label: 'The end of every listing',
    description: 'A line or two added to each listing\'s description (how you ship, when, returns). Empty: nothing added.',
    default: '',
    maxLength: 500,
  }),
  'selling.ebaySite': text({
    page: 'collection',
    section: 'Selling',
    label: "eBay's address",
    description: 'The eBay of your country, for its sold listings and its selling form (www.ebay.co.uk, www.ebay.de...).',
    default: 'www.ebay.com',
    maxLength: 60,
  }),
  'collection.goneFromFile': select({
    page: 'collection',
    section: 'Safety',
    label: 'A copy the next update no longer has',
    description:
      "What happens when the next file of its kind (PriceCharting's export, your spreadsheet) no longer has a copy: it waits on Review, still counted, until you say whether you still have it (Squirrelcade keeps your collection); or it leaves your collection with that update (the file keeps it).",
    default: 'ask',
    options: [
      { value: 'ask', label: 'Ask me on Review' },
      { value: 'remove', label: 'Remove it with that update' },
    ],
  }),
  'collection.monthlyBudget': num({
    page: 'collection',
    section: 'Spending',
    label: 'Monthly budget for games',
    description:
      "What you mean to spend on games in a month, in your currency (Settings > General). The Collection page's spending chart draws it and says how this month compares. 0 means no budget.",
    default: 0,
    min: 0,
    max: 1_000_000,
    unit: 'a month',
  }),
  'collection.backlogIncludesUnmarked': bool({
    page: 'collection',
    section: 'Playing',
    label: 'Games you haven\'t marked count as not played',
    description:
      'Stash > Backlog and "What to play next" take your games marked "Not played yet", and, with this on, the games you haven\'t marked at all (not the ones marked playing, beaten, completed, dropped or "just for the shelf").',
    default: true,
  }),
  'collection.loanDays': num({
    page: 'collection',
    section: 'Your copies',
    label: 'Lend for',
    description: 'The day a game you lend is due back, counted from the day you lend it (you can change it each time). 0: no day is set.',
    default: 30,
    min: 0,
    max: 365,
    unit: 'days',
  }),
  'collection.photosPerCopy': num({
    page: 'collection',
    section: 'Your copies',
    label: 'Photos per copy',
    description: 'How many photos a copy can have (its box, its cart, its condition...). Photos are kept in the database, so they are in every backup.',
    default: 10,
    min: 1,
    max: 50,
  }),
  'collection.photoSlotsBox': list({
    page: 'collection',
    section: 'Your copies',
    label: 'Standard photos of the box',
    description: "The photos a copy with its box should have, each with its own place in the copy's photos (and on Improve your collection's list while it's missing).",
    default: ['Box front', 'Box back'],
    maxItems: 10,
  }),
  'collection.photoSlotsInside': list({
    page: 'collection',
    section: 'Your copies',
    label: 'Standard photos of the box opened',
    description: "For a copy with its box that isn't sealed.",
    default: ['Inside'],
    maxItems: 10,
  }),
  'collection.photoSlotsGame': list({
    page: 'collection',
    section: 'Your copies',
    label: 'Standard photos of the game itself',
    description: '"{game}" becomes Disc, Cartridge, Card or Disk by the console (a PlayStation 2 game\'s "Disc front", a Super Nintendo game\'s "Cartridge front"). Not for a sealed copy.',
    default: ['{game} front', '{game} back'],
    maxItems: 10,
  }),
  'collection.photoSlotsManual': list({
    page: 'collection',
    section: 'Your copies',
    label: 'Standard photos of the manual',
    description: "For a copy with its manual that isn't sealed; none unless you add some (\"Manual front\").",
    default: [],
    maxItems: 10,
  }),
  'collection.retestMonths': num({
    page: 'collection',
    section: 'Your copies',
    label: 'Test a copy again after',
    description: "A copy last tested longer ago than this is on Improve your collection's list again (a battery, a disc that ages). 0: once is enough.",
    default: 0,
    min: 0,
    max: 240,
    unit: 'months',
  }),
  'collection.estimates': bool({
    page: 'collection',
    section: 'Suggested estimates',
    label: 'Suggest an estimated price',
    description:
      "A copy's estimated price is yours, for when you don't know what you paid: empty unless you fill it in, never a price paid, never sent to another service or written into a download. This shows Suggest beside it, which proposes one from what's below; nothing is estimated unless you ask.",
    default: true,
  }),
  'collection.newGamePrices': list({
    page: 'collection',
    section: 'Suggested estimates',
    label: 'Usual price of a new game',
    description: 'What Suggest starts from for a copy with its box. One line per console: its name, a colon, the price in your currency ("PlayStation 2: 49.99"). The defaults are US prices of a standard edition; a console not listed gets no suggestion.',
    default: [...NEW_GAME_PRICES],
    maxItems: 200,
  }),
  'collection.usedShare': num({
    page: 'collection',
    section: 'Suggested estimates',
    label: 'A copy without its box, as a share of a new one',
    description: "A loose copy (or a box or manual alone) was most likely bought used: Suggest proposes this share of a new game's price for it.",
    default: 50,
    min: 0,
    max: 100,
    unit: '%',
  }),
  'collection.improvePaid': bool({
    page: 'collection',
    section: 'Improve your collection',
    label: 'Copies without a price paid',
    description: "On Stash > Improve's list, until you enter the price or, when you don't know it, an estimate.",
    default: true,
  }),
  'collection.improveDate': bool({
    page: 'collection',
    section: 'Improve your collection',
    label: 'Copies without the day they were bought',
    description: "On Stash > Improve's list.",
    default: true,
  }),
  'collection.improvePhotos': bool({
    page: 'collection',
    section: 'Improve your collection',
    label: 'Copies missing a standard photo',
    description: "On Stash > Improve's list (the standard photos are set above, under Your copies).",
    default: true,
  }),
  'collection.improveTested': bool({
    page: 'collection',
    section: 'Improve your collection',
    label: 'Copies never tested',
    description: "On Stash > Improve's list (and ones tested longer ago than Test a copy again after, when that's set).",
    default: true,
  }),
  'collection.improveLocation': bool({
    page: 'collection',
    section: 'Improve your collection',
    label: "Copies without where they're kept",
    description: "On Stash > Improve's list.",
    default: true,
  }),
  'collection.photoMaxSide': num({
    page: 'collection',
    section: 'Your copies',
    label: 'Photo size',
    description: "Photos are made smaller in your browser before they're sent, to at most this many pixels on their longest side (about 200 to 600 KB each at 1600).",
    default: 1600,
    min: 640,
    max: 4000,
    unit: 'pixels',
  }),
  'collection.seriesMinGames': num({
    page: 'collection',
    section: 'Series',
    label: 'Fewest games for a series',
    description: "Sets > Series lists a series once your consoles' catalogs hold at least this many of its games (and you own one of them).",
    default: 2,
    min: 1,
    max: 50,
  }),
  'collection.seriesHidden': list({
    page: 'collection',
    section: 'Series',
    label: 'Series you hid',
    description: 'Series left out of Sets > Series (its Set up button chooses them). Their games count everywhere else as before.',
    default: [],
    maxItems: 5000,
    advanced: true,
  }),
  'collection.seriesStoryOrder': {
    ...list({
      page: 'collection',
      section: 'Series',
      label: 'Story orders',
      description:
        "Series in the order their story goes (Yakuza 0 before Yakuza 1), set on Sets > Series with an opened series' Story order: each a series name, a bar and its titles in order, as a JSON list.",
      default: [],
      maxItems: 300,
      advanced: true,
    }),
    schema: z.array(z.string().trim().min(1).max(4000)).max(300),
  },
  'collection.customSeries': list({
    page: 'collection',
    section: 'Series',
    label: 'Your own series',
    description:
      'Series of your own, listed on Sets > Series with the others: each a name, a bar and the words its games\' titles have, separated by commas, such as "Yakuza | Yakuza, Like a Dragon". Its games come from your consoles\' catalogs. Sets > Series > Set up edits them too.',
    default: [],
    maxItems: 100,
  }),

  // Platforms
  'platforms.minUniqueGames': num({
    page: 'platforms',
    section: 'Eligibility',
    label: 'Unique games to track a console',
    description: 'A console gets a catalog and completion tracking once you own at least this many different games for it.',
    default: 6,
    min: 1,
    max: 1000,
    unit: 'games',
  }),
  'platforms.regionLocked': list({
    page: 'platforms',
    section: 'Recognition',
    label: 'Region-locked consoles',
    description:
      "Consoles that play only their own region's games (off the list, other regions' releases join a console's catalog, counting once you own one: IGDB, Settings > Sources). On these, copies from another region than your home region count as a console of their own (Super Famicom beside Super Nintendo, Famicom beside NES, \"Nintendo 64 (Japan)\"), with their own catalog and completion. On the others, copies from every region count toward the one console.",
    default: [...REGION_LOCKED_DEFAULT],
    platforms: 'known',
  }),
  'platforms.excludedLabels': list({
    page: 'platforms',
    section: 'Recognition',
    label: 'Never treat as a console',
    description: 'PriceCharting console names that are skipped when your collection is updated. PC games belong in the PC library, not the physical collection.',
    default: ['PC Games', 'PC'],
  }),

  // Catalogs and matching
  'catalogs.variantsSatisfy': bool({
    page: 'catalogs',
    section: 'Ownership',
    label: 'Editions count as the game',
    description:
      'Editions count as the game both ways: an owned "Title: Collector\'s Edition", "Title: Gold Edition" or "Title [Greatest Hits]" counts as owning "Title" and every other edition of it in the catalog, and owning "Title" covers a catalog\'s "Title: Gold Edition". Off means only the exact game counts: a collector\'s edition is then a game of its own.',
    default: true,
  }),
  'catalogs.crossGen': bool({
    page: 'catalogs',
    section: 'Ownership',
    label: 'Cross-generation games count for both consoles',
    description:
      'A game made for two generations of a console family counts as owned on both when you have it on either: Silksong on Switch 2 covers its Switch version, and the same for PlayStation 4 and 5, Xbox One and Series X|S, and the generations before them (Game Boy and Color, DS and 3DS, PSP and Vita too). It shows where you have it. Off: each version counts only on its own console.',
    default: true,
  }),
  'catalogs.crossGenYears': num({
    page: 'catalogs',
    section: 'Ownership',
    label: 'Cross-generation: released within',
    description: "How close the two versions' release years must be, where both are known, to count as one game (a port years later is a game of its own). 0: any years apart.",
    default: 2,
    min: 0,
    max: 10,
    unit: 'years',
    advanced: true,
    shownWhen: 'catalogs.crossGen',
  }),
  'catalogs.shortTitles': select({
    page: 'catalogs',
    section: 'Ownership',
    label: 'Titles without their subtitle',
    description:
      'PriceCharting often leaves a game\'s subtitle out, Japanese releases especially ("Doraemon 2" for "Doraemon 2: Nobita no Toys Land Daibouken"). Off, such copies are Review questions. Otherwise a copy counts as the one catalog game whose title is the copy\'s followed by a subtitle (after ":" or " - "), when exactly one catalog game fits and their numbers agree; it shows as "Without its subtitle", with "not the same" to undo it.',
    default: 'off',
    options: [
      { value: 'off', label: 'Off: ask on the Review page' },
      { value: 'japan', label: 'On consoles of Japanese releases (the Super Famicom...)' },
      { value: 'all', label: 'On every console' },
    ],
  }),
  'catalogs.otherRegionsCount': bool({
    page: 'catalogs',
    section: 'Ownership',
    label: 'Other-region copies count toward completion',
    description:
      'Copies from other regions (JP, PAL...) count as owning a home-region catalog game. Off means only home-region copies count. Region-locked consoles (Settings > Platforms) keep other regions apart either way: there, those copies make a console of their own.',
    default: true,
  }),
  'catalogs.suggestMatches': bool({
    page: 'catalogs',
    section: 'Review',
    label: 'Suggest possible matches',
    description: 'When a catalog game looks like one you own under a different name (for example "Cars 2" and "Cars 2: The Video Game"), ask instead of calling it missing.',
    default: true,
  }),
  'catalogs.refreshDays': num({
    page: 'catalogs',
    section: 'Catalog source',
    label: 'Refresh catalogs every',
    description:
      "How often each console's catalog is rebuilt from Wikipedia's list of its games, so new releases appear. Your answers and your own target choices are kept. 0 means only when you ask.",
    default: 30,
    min: 0,
    max: 365,
    unit: 'days',
  }),
  'catalogs.upcomingCount': bool({
    page: 'catalogs',
    section: 'Catalog source',
    label: 'Upcoming games count as missing',
    description:
      'Games not out yet (a release date after today, or "TBA" in your own list) count as missing: in completion, and on the wishlist. Off lists them as Upcoming instead, outside completion and the wishlist, until their release date passes.',
    default: true,
  }),
  'catalogs.includeDigitalOnly': bool({
    page: 'catalogs',
    section: 'Catalog source',
    label: 'Include download-only games',
    description: 'Also collect games that were only sold as downloads, where the list marks them. Off keeps catalogs to games that had a physical release.',
    default: false,
  }),
  'catalogs.gameKeyCards': bool({
    page: 'catalogs',
    section: 'Physical releases',
    label: 'Game-Key Cards count',
    description:
      "Nintendo Switch 2 Game-Key Cards (a cartridge that holds only a key to download the game) count like other physical releases. Off leaves them out, as excluded games. Squirrelcade knows a Game-Key Card from the Format column of your own list; Wikipedia's lists don't say which games are.",
    default: true,
  }),
  'catalogs.mixedListPlatforms': list({
    page: 'catalogs',
    section: 'Physical releases',
    label: 'Consoles whose lists include download-only games',
    description:
      "On these consoles a game from Wikipedia's list counts only with evidence of a physical release: your own list, an IGDB physical listing, owning it, or your confirmation. Until then it shows as not confirmed physical. On other consoles the lists are retail games. Console keys, one per line.",
    default: ['wii-u', 'nintendo-switch', 'nintendo-switch-2', 'nintendo-3ds', 'playstation-vita', 'playstation-4', 'playstation-5', 'xbox-one', 'xbox-series-x'],
    advanced: true,
    platforms: 'known',
  }),
  'catalogs.downloadTitles': select({
    page: 'catalogs',
    section: 'Physical releases',
    label: 'Games Wikipedia marks as download titles',
    description:
      'Games a Wikipedia list marks as sold for download without calling them download-only (an Xbox Live Arcade mark, for example), or whose Wikipedia article is in one of the download categories to check (an advanced setting). Most never came out on disc, but some did. With "Count them once shown physical" they wait as not confirmed physical until your own list, an IGDB physical listing, owning one or your confirmation shows a physical release. When "Include download-only games" is on, they count too.',
    default: 'confirm',
    options: [
      { value: 'confirm', label: 'Count them once shown physical' },
      { value: 'skip', label: 'Leave them out' },
      { value: 'count', label: 'Count them like other games' },
    ],
  }),
  'catalogs.downloadCategories': list({
    page: 'catalogs',
    section: 'Physical releases',
    label: 'Download categories to check',
    description:
      'For Wikipedia lists that mix in download games without marking all of them: a game on the console\'s list counts as a download title when the article it links to is in one of these Wikipedia categories. One line per console, "console key: Category" (several separated by ";"). Each catalog build asks Wikipedia about the linked articles, 50 at a time.',
    default: ['playstation-3: PlayStation Network games'],
    advanced: true,
  }),
  'catalogs.physicalRegion': select({
    page: 'catalogs',
    section: 'Physical releases',
    label: 'IGDB physical listings count from',
    description: 'IGDB records physical listings (mostly retailer listings) by country. Your home region only leaves out imports and other regions\' editions.',
    default: 'any',
    options: [
      { value: 'any', label: 'Any country' },
      { value: 'home', label: 'Your home region only' },
    ],
  }),
  'catalogs.includeUnlicensed': bool({
    page: 'catalogs',
    section: 'Catalog source',
    label: 'Include unlicensed and homebrew games',
    description: 'Also collect the unlicensed, homebrew and aftermarket releases a list names in its own section. Promotional and competition releases always come in as review questions.',
    default: false,
  }),
  'catalogs.listFill': select({
    page: 'catalogs',
    section: 'Catalog source',
    label: 'Under your own list, other sources add',
    description:
      "What Wikipedia and the other catalog sources (Settings > Sources) add to a console that has your own list. Your list is the truth for the games it covers; the other sources keep it current with new releases. Every game your list doesn't have also brings in games your list names differently.",
    default: 'newer',
    options: [
      { value: 'newer', label: 'Games released after your list (from a month before you gave it)' },
      { value: 'all', label: "Every game your list doesn't have" },
    ],
  }),
  'catalogs.ownedUnderList': bool({
    page: 'catalogs',
    section: 'Catalog source',
    label: 'Games you own that your list lacks come in',
    description:
      "With the other sources adding only newer games under your own list: an older game they list still comes in when you own a copy of it, so the copy counts. Off, such copies wait on the console's Not in catalog tab.",
    default: true,
  }),
  'catalogs.wikipediaPages': list({
    page: 'catalogs',
    section: 'Catalog source',
    label: 'Wikipedia lists to use',
    description:
      'Each console\'s catalog comes from Wikipedia\'s "List of … games" page (split pages such as "(A–C)" are found automatically). To use other pages, add a line "console key: Page title" (several pages separated by ";"), for example "playstation-3: List of PlayStation 3 games".',
    default: [],
    advanced: true,
  }),

  // Wishlist scoring (Acorns > Acorns ranking)
  'wishlist.shareSize': num({
    page: 'wishlist',
    section: 'Sharing',
    label: 'Games on a shared wishlist',
    description: 'How many of the wishlist\'s top picks a share link shows (Acorns wishlist > Share).',
    default: 50,
    min: 5,
    max: 300,
  }),
  'wishlist.platformPoints': points({
    page: 'wishlist',
    section: 'Your tastes',
    label: 'Acorns by platform',
    description:
      'How much you want games for each platform. Higher-ranked platforms also win ties. Left empty, it is learned from your collection: the consoles you added the most games to lately come first (see "Learning from your collection").',
    default: {},
    keyLabel: 'Platform',
  }),
  'wishlist.otherPlatformPoints': num({
    page: 'wishlist',
    section: 'Your tastes',
    label: 'Acorns for other platforms',
    description: 'Acorns for platforms not listed above.',
    default: 0,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'wishlist.genrePoints': points({
    page: 'wishlist',
    section: 'Your tastes',
    label: 'Acorns by genre',
    description:
      'A game gets the acorns of its genre (several IGDB genres count as set below). Left empty, it is learned from your collection: genres you own more of than the catalogs hold come first.',
    default: {},
    keyLabel: 'Genre',
  }),
  'wishlist.stylePoints': points({
    page: 'wishlist',
    section: 'Your tastes',
    label: 'Acorns by style',
    description: "Subgenres and styles, such as JRPG or open-world. A game gets the acorns of its style on top of its genre's.",
    default: {},
    keyLabel: 'Style',
  }),
  'wishlist.inferGenres': bool({
    page: 'wishlist',
    section: 'Your tastes',
    label: 'Guess genres from series names',
    description: 'For games without details, guess the genre and style from well-known series names (Final Fantasy is an RPG). Guesses are labeled.',
    default: true,
  }),
  'wishlist.genreBlend': select({
    page: 'wishlist',
    section: 'Your tastes',
    label: 'Several IGDB genres',
    description: 'IGDB often lists several genres for a game. Average their acorns, or count only the first in a fixed order that starts with RPG.',
    default: 'average',
    options: [
      { value: 'average', label: 'Average their acorns' },
      { value: 'first', label: 'Only the first (RPG first)' },
    ],
  }),
  'wishlist.seriesOwnedTiers': tiers({
    page: 'wishlist',
    section: 'Your tastes',
    label: 'Acorns for a series you collect',
    description: "Acorns when you own other games of the same series (IGDB's series, or a well-known series name), by how many you own. Fans of a series get more of it.",
    default: [
      { max: 1, points: 5 },
      { max: 3, points: 10 },
      { max: 6, points: 15 },
      { max: 1000, points: 20 },
    ],
    countLabel: 'Games you own',
  }),
  'wishlist.reviewTop': num({
    page: 'wishlist',
    section: 'Reviews',
    label: 'Acorns for the best-reviewed games',
    description: "Acorns for games IGDB's critics and players rate highest (from the IGDB data in Settings > Sources). 0 leaves reviews out.",
    default: 31,
    min: 0,
    max: 1000,
    unit: 'acorns',
  }),
  'wishlist.reviewFrom': num({
    page: 'wishlist',
    section: 'Reviews',
    label: 'No acorns at a rating of',
    description: 'Games rated this or lower (out of 100) get no acorns for their reviews.',
    default: 55,
    min: 0,
    max: 99,
  }),
  'wishlist.reviewTo': num({
    page: 'wishlist',
    section: 'Reviews',
    label: 'All the acorns from a rating of',
    description: 'Games rated this or higher (out of 100) get all the acorns for reviews.',
    default: 92,
    min: 1,
    max: 100,
  }),
  'wishlist.reviewShape': select({
    page: 'wishlist',
    section: 'Reviews',
    label: 'How review acorns grow',
    description: 'How the acorns grow between the two ratings: evenly, mostly near the top (exponential), or mostly near the bottom (logarithmic).',
    default: 'linear',
    options: [
      { value: 'linear', label: 'Straight line' },
      { value: 'exponential', label: 'Exponential: the best-rated stand out' },
      { value: 'logarithmic', label: 'Logarithmic: good ratings are nearly enough' },
      { value: 'steps', label: 'Three steps' },
    ],
  }),
  'wishlist.reviewPrior': num({
    page: 'wishlist',
    section: 'Reviews',
    label: 'Unrated games count as',
    description: 'The rating (out of 100) a game without IGDB ratings counts as. A game with only a few ratings is pulled toward it too.',
    default: 65,
    min: 0,
    max: 100,
    advanced: true,
  }),
  'wishlist.reviewTrust': num({
    page: 'wishlist',
    section: 'Reviews',
    label: 'Ratings before a rating counts fully',
    description: "With fewer ratings than this, a game counts partly as unrated (above), so one enthusiastic rating doesn't beat a classic.",
    default: 10,
    min: 1,
    max: 1000,
    unit: 'ratings',
    advanced: true,
  }),
  'wishlist.learnMonths': num({
    page: 'wishlist',
    section: 'Learning from your collection',
    label: 'Consoles you collect now: games added in the last',
    description: 'For acorns by platform learned from your collection: the consoles you added the most games to in this many months rank first.',
    default: 12,
    min: 1,
    max: 120,
    unit: 'months',
  }),
  'wishlist.learnMinGames': num({
    page: 'wishlist',
    section: 'Learning from your collection',
    label: 'Counts as collected now from',
    description: 'A console needs at least this many games added in that time to get learned platform acorns; the others get "Acorns for other platforms".',
    default: 5,
    min: 1,
    max: 1000,
    unit: 'games',
  }),
  'wishlist.completionBy': select({
    page: 'wishlist',
    section: 'Completion',
    label: 'Acorns for finishing a console, by',
    description: "How close a console is to finished: the share of its catalog you own (a console of 50 games and one of 2,500 compare fairly), or the number of games left.",
    default: 'percent',
    options: [
      { value: 'percent', label: 'Percent complete' },
      { value: 'left', label: 'Games left' },
    ],
  }),
  'wishlist.completionPercentTiers': percentTiers({
    page: 'wishlist',
    section: 'Completion',
    label: 'Acorns for finishing a console',
    description: 'Extra acorns for every missing game on a console you own most of, by how much of its catalog you own. Games waiting for review count as missing here.',
    default: [
      { min: 98, points: 25 },
      { min: 95, points: 20 },
      { min: 90, points: 15 },
      { min: 80, points: 10 },
      { min: 70, points: 5 },
    ],
    countLabel: 'Complete',
  }),
  'wishlist.completionTiers': tiers({
    page: 'wishlist',
    section: 'Completion',
    label: 'Acorns for finishing a console',
    description: 'Extra acorns for every missing game on a console with only a few left, by games left. Games waiting for review count as missing here.',
    default: [
      { max: 3, points: 25 },
      { max: 5, points: 20 },
      { max: 10, points: 12 },
      { max: 15, points: 8 },
      { max: 25, points: 4 },
    ],
    countLabel: 'Games left',
  }),
  'wishlist.campaignPlatforms': list({
    page: 'wishlist',
    section: 'Completion',
    label: 'Completion campaigns',
    description: 'The consoles you are actively trying to finish. Their games get the campaign acorns.',
    default: [],
    platforms: 'tracked',
  }),
  'wishlist.campaignPoints': num({
    page: 'wishlist',
    section: 'Completion',
    label: 'Campaign acorns',
    description: 'Acorns for games on a platform with a completion campaign.',
    default: 15,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'wishlist.seriesTiers': tiers({
    page: 'wishlist',
    section: 'Game details',
    label: 'Acorns for finishing a series',
    description: 'Acorns when a game brings you close to owning a whole series, by games left in the series (from game details).',
    default: [
      { max: 1, points: 30 },
      { max: 2, points: 18 },
      { max: 4, points: 10 },
      { max: 7, points: 5 },
    ],
    countLabel: 'Games left',
  }),
  'wishlist.personalInterestPoints': points({
    page: 'wishlist',
    section: 'Game details',
    label: 'Acorns by personal interest',
    description: "Acorns for the personal-interest level recorded in a game's details. Never guessed.",
    default: { Essential: 20, High: 12, Interested: 5, Neutral: 0 },
    keyLabel: 'Interest',
  }),
  'wishlist.releaseClassPoints': points({
    page: 'wishlist',
    section: 'Game details',
    label: 'Acorns by release class',
    description: 'Standard releases, acceptable variants and verified physical homebrew. Releases marked Exclude or "Physical proof pending" are never recommended.',
    default: { 'Exact target': 6, 'Acceptable variant': 3, 'Needs review': 0, 'Physical homebrew / aftermarket': -12 },
    keyLabel: 'Release class',
  }),
  'wishlist.significancePoints': points({
    page: 'wishlist',
    section: 'Game details',
    label: 'Acorns by platform significance',
    description: "How important the game is to its platform's library, from game details.",
    default: { Cornerstone: 8, Notable: 4, Standard: 0 },
    keyLabel: 'Significance',
  }),
  'wishlist.marketUrgencyPoints': points({
    page: 'wishlist',
    section: 'Game details',
    label: 'Acorns by market urgency',
    description: 'Price or supply pressure recorded in game details: buy sooner rather than later.',
    default: { High: 8, Moderate: 4, Low: 0 },
    keyLabel: 'Urgency',
  }),
  'wishlist.offbeatJapanesePoints': num({
    page: 'wishlist',
    section: 'Game details',
    label: 'Offbeat Japanese release',
    description: 'Acorns for eccentric Japanese-made games released physically in North America (all three marked in game details).',
    default: 0,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'wishlist.tieInPoints': num({
    page: 'wishlist',
    section: 'Game details',
    label: 'Movie or TV tie-in',
    description: 'Acorns (usually negative) for licensed movie and TV tie-ins.',
    default: 0,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'wishlist.homeRegionPoints': num({
    page: 'wishlist',
    section: 'Region and ownership',
    label: 'Home-region release',
    description: 'Acorns for releases from your home region.',
    default: 5,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'wishlist.importRegionPoints': num({
    page: 'wishlist',
    section: 'Region and ownership',
    label: 'Import release',
    description: 'Acorns for releases from other regions. Imports are flagged for review either way.',
    default: 0,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'wishlist.ownedOnPcPoints': num({
    page: 'wishlist',
    section: 'Region and ownership',
    label: 'Already owned on PC',
    description: 'Acorns (usually negative) when your PC library owns the same game for good in some storefront (not through a subscription). Editions aside, the same title counts.',
    default: -10,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'wishlist.setPoints': num({
    page: 'wishlist',
    section: 'Region and ownership',
    label: 'In one of your sets',
    description: 'Acorns for a missing game that belongs to one of your sets (Sets: a publisher\'s releases, a series, a theme you complete). 0 leaves sets out of the wishlist.',
    default: 0,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'wishlist.ownedElsewherePoints': num({
    page: 'wishlist',
    section: 'Region and ownership',
    label: 'Already owned on another console',
    description: 'Acorns (usually negative) when you own the same game physically on another platform. Only exact titles count.',
    default: -20,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'wishlist.preferencePoints': points({
    page: 'wishlist',
    section: 'Your overrides',
    label: 'Acorns by your preference',
    description: 'Preferences you set on a game. "Do Not Recommend" isn\'t listed: it always keeps the game off the wishlist.',
    default: { 'Must Have': 20, 'Strong Interest': 10, 'Slight Interest': 5, 'No Adjustment': 0, 'Low Interest': -5 },
    keyLabel: 'Preference',
  }),
  'wishlist.pointShapes': shapes({
    page: 'wishlist',
    section: 'Your tastes',
    label: 'Shapes of the acorn lists',
    description:
      'How each ranked list on the Acorns page shares out its acorns: a straight line, exponential, logarithmic or three steps from its most acorns down to its fewest, or your own numbers. The numbers themselves are what the acorns use; lists learned from your collection follow these shapes too.',
    default: {
      'wishlist.platformPoints': { shape: 'logarithmic', top: 22, bottom: 8, order: [] },
      'wishlist.genrePoints': { shape: 'linear', top: 22, bottom: 0, order: [] },
    },
  }),
  'wishlist.masterSize': num({
    page: 'wishlist',
    section: 'Lists',
    label: 'Games in the main wishlist',
    description: 'How many games the main wishlist holds.',
    default: 200,
    min: 10,
    max: 2000,
    unit: 'games',
  }),
  'wishlist.perPlatformMax': num({
    page: 'wishlist',
    section: 'Lists',
    label: 'Most games per platform',
    description: "The main wishlist takes at most this many games from one platform; each platform's own list is this long too.",
    default: 20,
    min: 1,
    max: 500,
    unit: 'games',
  }),
  'wishlist.consoleDiversityPenalty': num({
    page: 'wishlist',
    section: 'Lists',
    label: 'Variety: same platform',
    description: 'While building the main wishlist, acorns taken off for every game already picked from the same platform.',
    default: 5,
    min: 0,
    max: 100,
    unit: 'acorns',
    advanced: true,
  }),
  'wishlist.franchiseDiversityPenalty': num({
    page: 'wishlist',
    section: 'Lists',
    label: 'Variety: same franchise',
    description: 'While building the main wishlist, acorns taken off for every game already picked from the same franchise.',
    default: 3,
    min: 0,
    max: 100,
    unit: 'acorns',
    advanced: true,
  }),
  'wishlist.maxScore': num({
    page: 'wishlist',
    section: 'Lists',
    label: 'Most acorns',
    description: 'Acorns run from 0 to this; a game with more shows as capped (where its acorns come from is still listed). 0 means no cap.',
    default: 100,
    min: 0,
    max: 10000,
    unit: 'acorns',
    advanced: true,
  }),
  'wishlist.fitScale': select({
    page: 'wishlist',
    section: 'Lists',
    label: 'Fit acorns to the scale',
    description:
      "The scale is meant for a top ten between 90 and 100 acorns. When the tenth best game's acorns (the place and the acorns below) add up to more than 5 under that, or more than the most acorns, every game's acorns are multiplied so it lands there, and each game shows the change as a line of its own. The order never changes. Off: the acorns count as they add up.",
    default: 'auto',
    options: [
      { value: 'auto', label: 'When the top ten land far off' },
      { value: 'off', label: 'Off' },
    ],
    advanced: true,
  }),
  'wishlist.fitRank': num({
    page: 'wishlist',
    section: 'Lists',
    label: 'Fit: the place on the list it looks at',
    description: 'With "Fit acorns to the scale" on: the game at this place of the list (10: the tenth best) is the one fitted to the acorns below.',
    default: 10,
    min: 1,
    max: 500,
    advanced: true,
  }),
  'wishlist.fitTarget': num({
    page: 'wishlist',
    section: 'Lists',
    label: 'Fit: where that game lands',
    description: 'With "Fit acorns to the scale" on: that game\'s acorns after fitting, in percent of the most acorns (90: 90 of 100).',
    default: 90,
    min: 1,
    max: 100,
    unit: '%',
    advanced: true,
  }),
  'wishlist.priorityHigh': num({
    page: 'wishlist',
    section: 'Lists',
    label: 'High priority from',
    description: 'Games with this many acorns or more are High priority.',
    default: 85,
    min: 0,
    max: 1000,
    unit: 'acorns',
    advanced: true,
  }),
  'wishlist.priorityMedium': num({
    page: 'wishlist',
    section: 'Lists',
    label: 'Medium priority from',
    description: 'Games with this many acorns or more (and fewer than High) are Medium priority.',
    default: 65,
    min: 0,
    max: 1000,
    unit: 'acorns',
    advanced: true,
  }),

  // PC library
  'pc.playniteFolder': path({
    page: 'pc',
    section: 'Playnite',
    label: 'Playnite backup folder',
    description:
      "The folder Playnite saves its library backups to (Playnite > Settings > Backup; weekly is enough). Squirrelcade reads the newest backup, read-only, and never changes it. Empty means /playnite in Docker (mount the folder there) and no PC library elsewhere.",
    default: '',
  }),
  'pc.readDays': num({
    page: 'pc',
    section: 'Playnite',
    label: 'Look for a new backup every',
    description: 'How often Squirrelcade checks the folder for a newer backup and reads it. 0 means only when you ask (PC library > Read now).',
    default: 1,
    min: 0,
    max: 30,
    unit: 'days',
  }),
  'pc.maxDropPercent': num({
    page: 'pc',
    section: 'Playnite',
    label: 'Hold a reading that loses more than',
    description: 'A backup that suddenly has far fewer games (a broken Playnite library, a storefront that signed out) waits for your confirmation instead of replacing your PC library.',
    default: 20,
    min: 1,
    max: 100,
    unit: '% of games',
    advanced: true,
  }),
  'pc.staleBackupDays': num({
    page: 'pc',
    section: 'Playnite',
    label: 'Warn when the newest backup is older than',
    description:
      "Playnite's automatic backups can stop (a moved folder, a full disk, a share that's no longer mounted) and the PC library would quietly fall behind. After this long without a newer backup, System > Status and the health alert say so. 0 never warns.",
    default: 14,
    min: 0,
    max: 365,
    unit: 'days',
    advanced: true,
  }),
  'pc.storefrontOwnership': list({
    page: 'pc',
    section: 'Ownership',
    label: "Storefronts whose games aren't simply owned",
    description:
      'One line per storefront: "Storefront: subscription" when its library is subscription access, "Storefront: historical" when its games wait to be verified (their libraries mix in subscription games). Storefronts not named count as owned. Your audit on the PC library page decides single games.',
    default: [...STOREFRONT_OWNERSHIP_DEFAULT],
  }),
  'pc.wishlistSize': num({
    page: 'pc',
    section: 'PC wishlist',
    label: 'Games on the PC wishlist',
    description: 'How many PC games the PC wishlist ranks (PC library > PC wishlist).',
    default: 100,
    min: 1,
    max: 1000,
    unit: 'games',
  }),
  'pc.discoverDays': num({
    page: 'pc',
    section: 'PC wishlist',
    label: 'Look for PC games to recommend every',
    description: "How often Squirrelcade searches IGDB for PC games you might want: the best-rated games in the genres with the most acorns, games in series you collect, and the PC versions of console games you keep sealed. It needs IGDB's keys (Settings > Sources). 0 means only when you ask.",
    default: 7,
    min: 0,
    max: 90,
    unit: 'days',
  }),
  'pc.discoverGenres': num({
    page: 'pc',
    section: 'PC wishlist',
    label: 'Genres to search',
    description: 'How many of the genres with the most acorns the search covers (the Acorns page gives genres their acorns, or learns them from your collection).',
    default: 10,
    min: 1,
    max: 30,
    unit: 'genres',
    advanced: true,
  }),
  'pc.discoverPerGenre': num({
    page: 'pc',
    section: 'PC wishlist',
    label: 'Games per genre',
    description: 'How many of the best-rated PC games each genre search takes.',
    default: 100,
    min: 10,
    max: 500,
    unit: 'games',
    advanced: true,
  }),
  'pc.minRatings': num({
    page: 'pc',
    section: 'PC wishlist',
    label: 'Ratings a game needs to be found',
    description: "A game needs at least this many ratings on IGDB for the genre search to find it, so a few enthusiastic ratings don't carry an unknown game.",
    default: 50,
    min: 0,
    max: 10000,
    unit: 'ratings',
    advanced: true,
  }),
  'pc.steamReviews': bool({
    page: 'pc',
    section: 'PC wishlist',
    label: "Read Steam's review scores",
    description: "For games on Steam, read Steam's public review summary (the share of positive reviews), one game at a time and at most a few hundred per search, kept for a month. No account or key is needed.",
    default: true,
  }),
  'pc.steamMinReviews': num({
    page: 'pc',
    section: 'PC wishlist',
    label: "Steam reviews that count as the game's reviews",
    description: "From this many Steam reviews on, Steam's share of positive reviews stands for a game's reviews; below it, IGDB's rating does.",
    default: 50,
    min: 1,
    max: 100000,
    unit: 'reviews',
    advanced: true,
  }),
  'pc.sealedCopyPoints': num({
    page: 'pc',
    section: 'PC wishlist',
    label: 'Sealed on a console',
    description: "Acorns when you keep a game sealed on a console and don't own it on PC: play it on PC and keep the box sealed.",
    default: 15,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'pc.subscriptionPoints': num({
    page: 'pc',
    section: 'PC wishlist',
    label: 'Already on a subscription',
    description: 'Acorns (usually negative) when you can already play the game through a subscription in your PC library (EA Play, Game Pass...).',
    default: -15,
    min: -1000,
    max: 1000,
    unit: 'acorns',
  }),
  'pc.priceAlertRule': select({
    page: 'pc',
    section: 'Prices',
    label: 'Tell me when a PC wishlist game',
    description: "With PC game prices on (Settings > Features) and notifications set up: when a message is sent about a game's price. Each price is told once.",
    default: 'low',
    options: [
      { value: 'low', label: 'Is at its lowest price ever' },
      { value: 'cut', label: 'Is at least the discount below' },
      { value: 'off', label: 'Never (prices are only shown)' },
    ],
  }),
  'pc.priceAlertCut': num({
    page: 'pc',
    section: 'Prices',
    label: 'Discount worth a message',
    description: 'With "at least the discount below": how much off its regular price a game must be.',
    default: 50,
    min: 5,
    max: 95,
    unit: '%',
  }),
  'pc.pricesRefreshHours': num({
    page: 'pc',
    section: 'Prices',
    label: 'Check prices every',
    description: 'How often the PC wishlist\'s prices are read again from IsThereAnyDeal.',
    default: 24,
    min: 6,
    max: 168,
    unit: 'hours',
  }),
  'pc.includeHidden': bool({
    page: 'pc',
    section: 'Ownership',
    label: 'Count games hidden in Playnite',
    description: 'Games you hid in Playnite still count as owned (off leaves them out of the PC library and everything that uses it).',
    default: true,
  }),

  // Sources
  'sources.catalogOrder': sources({
    page: 'sources',
    section: 'Catalog sources',
    label: 'Catalog sources, most trusted first',
    description:
      "Where every console's catalog comes from, most trusted first. When sources disagree about a game (its release date or format), the higher one wins and the console's page shows the difference. Your own answers about games always stand. Most people never need to change this.",
    default: DEFAULT_SOURCE_ORDER,
  }),
  'sources.datesFrom': select({
    page: 'sources',
    section: 'Catalog sources',
    label: 'Release dates: trust first',
    description:
      "The source whose release date wins when sources disagree about one, ahead of the order above (the others keep that order). A source that follows delays can be more current than a list you keep.",
    advanced: true,
    default: '',
    options: trustFirst('dates'),
  }),
  'sources.formatsFrom': select({
    page: 'sources',
    section: 'Catalog sources',
    label: 'Formats: trust first',
    description: 'The source whose format (such as Game-Key Card, or the full game on the card) wins when sources disagree about one, ahead of the order above.',
    advanced: true,
    default: '',
    options: trustFirst('formats'),
  }),
  'sources.barcodeLookup': select({
    page: 'sources',
    section: 'Barcodes',
    label: 'Name unknown barcodes with',
    description:
      "When Store Mode scans a barcode it has never seen, ask this service what product it is, then let you pick the matching game. Each answer is kept, so a game costs one lookup, ever. UPCitemdb's free use allows 100 lookups a day and 6 a minute: Squirrelcade never asks faster, and a barcode over the limit waits its turn (Store Mode counts down and asks again). UPC Database (upcdatabase.org) needs a free account's key: 100 lookups a day free, more on its paid plans. Both: UPCitemdb first, then UPC Database for barcodes it doesn't know or once its lookups are used up.",
    default: 'upcitemdb',
    options: [
      { value: 'upcitemdb', label: 'UPCitemdb (free, no account)' },
      { value: 'upcdatabase', label: 'UPC Database (upcdatabase.org, with its key)' },
      { value: 'both', label: "UPCitemdb, then UPC Database for barcodes it doesn't know" },
      { value: 'off', label: 'Nothing (search by title instead)' },
    ],
  }),
  'sources.upcDatabaseKey': secret({
    page: 'sources',
    section: 'Barcodes',
    label: 'UPC Database key',
    description:
      'For UPC Database, chosen above: make a free account at upcdatabase.org, register an application in your dashboard, and copy its key here. Its free plan allows 100 lookups a day; paid plans more.',
  }),
  'sources.raUsername': text({
    page: 'sources',
    section: 'RetroAchievements',
    label: 'Username',
    description: 'Your RetroAchievements username: whose progress Squirrelcade shows.',
    default: '',
    maxLength: 60,
  }),
  'sources.raApiKey': secret({
    page: 'sources',
    section: 'RetroAchievements',
    label: 'Web API key',
    description: 'Free: sign in at retroachievements.org, open Settings, and copy your Web API Key from its Keys section. Squirrelcade only reads your progress.',
  }),
  'sources.raMarkPlayed': select({
    page: 'sources',
    section: 'RetroAchievements',
    label: 'In What you played',
    description:
      "A game you've beaten on RetroAchievements can be marked Beaten (Completed once you've mastered it) in What you played, when you haven't given it a status yourself. Checked at each sync (daily).",
    default: 'off',
    options: [
      { value: 'off', label: 'Leave What you played as it is' },
      { value: 'beaten', label: 'Mark beaten and mastered games (with no status of their own)' },
    ],
  }),
  'sources.xboxApiKey': secret({
    page: 'sources',
    section: 'Xbox achievements',
    label: 'OpenXBL API key',
    description:
      "Free: sign in at xbl.io with the Microsoft account you play Xbox with, then copy the API key from its profile page (xbl.io/profile). The free plan allows 150 requests an hour; Squirrelcade makes one a day.",
  }),
  'sources.xboxMarkPlayed': select({
    page: 'sources',
    section: 'Xbox achievements',
    label: 'In What you played',
    description: "A game with every achievement can be marked Completed in What you played, when you haven't given it a status yourself. Checked at each read (daily).",
    default: 'off',
    options: [
      { value: 'off', label: 'Leave What you played as it is' },
      { value: 'completed', label: 'Mark games with every achievement Completed (with no status of their own)' },
    ],
  }),
  'sources.psnToken': secret({
    page: 'sources',
    section: 'PlayStation trophies',
    label: 'Sign-in token (NPSSO)',
    description:
      'Sign in at playstation.com in your browser, then open ca.account.sony.com/api/v1/ssocookie in the same browser: it shows {"npsso":"..."}; copy the 64 characters between the quotes after npsso. It lasts about two months, and Squirrelcade tells you when it needs a new one. It signs in to your account, so keep it private, as a password.',
  }),
  'sources.psnMarkPlayed': select({
    page: 'sources',
    section: 'PlayStation trophies',
    label: 'In What you played',
    description: "A game with its platinum trophy (or every trophy, for one without a platinum) can be marked Completed in What you played, when you haven't given it a status yourself. Checked at each read (daily).",
    default: 'off',
    options: [
      { value: 'off', label: 'Leave What you played as it is' },
      { value: 'completed', label: 'Mark platinum and 100% games Completed (with no status of their own)' },
    ],
  }),
  'sources.steamApiKey': secret({
    page: 'sources',
    section: 'Steam achievements',
    label: 'Steam Web API key',
    description:
      "Free: sign in at steamcommunity.com/dev/apikey, give any domain name (your Squirrelcade's address works), and copy the key. Steam allows 100,000 requests a day; after the first read, Squirrelcade makes one for each game you played since the day before.",
  }),
  'sources.steamId': text({
    page: 'sources',
    section: 'Steam achievements',
    label: 'Your Steam profile',
    description:
      "Your profile's address (steamcommunity.com/id/yourname or steamcommunity.com/profiles/7656...), its custom name, or its 17-digit ID. Its game details must be public: Steam, your profile, Edit Profile, Privacy Settings, Game details: Public.",
    default: '',
    maxLength: 120,
  }),
  'sources.igdbClientId': text({
    page: 'sources',
    section: 'IGDB (game details and covers)',
    label: 'Client ID',
    description:
      'IGDB is free with a Twitch developer application: sign in at dev.twitch.tv/console/apps (a Twitch account with two-factor sign-in on), register an application (any name, OAuth redirect http://localhost, category Application Integration, client type Confidential), then copy its Client ID and make a secret with New Secret. RomM can use the same pair.',
    default: '',
  }),
  'sources.igdbClientSecret': secret({
    page: 'sources',
    section: 'IGDB (game details and covers)',
    label: 'Client secret',
    description: 'The client secret of the same Twitch application.',
  }),
  'sources.igdbDetails': bool({
    page: 'sources',
    section: 'IGDB (game details and covers)',
    label: 'Fill missing game details from IGDB',
    description:
      'Use IGDB genres, series and developer country where you gave none. The wishlist marks these acorns "(IGDB)". Your own details always win.',
    default: true,
  }),
  'sources.igdbRefreshDays': num({
    page: 'sources',
    section: 'IGDB (game details and covers)',
    label: 'Refresh IGDB data every',
    description: 'How often the "Update IGDB data" task downloads the game lists of platforms with a catalog again.',
    default: 7,
    min: 1,
    max: 90,
    unit: 'days',
    advanced: true,
  }),
  'sources.igdbPlatformIds': points({
    page: 'sources',
    section: 'IGDB (game details and covers)',
    label: 'IGDB platform numbers',
    description: "IGDB's number for each platform. The built-in ones are filled in; add one for a platform you created, or fix a wrong one.",
    default: IGDB_PLATFORM_IDS,
    keyLabel: 'Platform key',
    advanced: true,
  }),
  'sources.igdbExtraPlatformIds': points({
    page: 'sources',
    section: 'IGDB (game details and covers)',
    label: 'Second IGDB platform numbers',
    description:
      "Where IGDB keeps some of a platform's games under a platform of its own, that platform's number: its games join the platform's IGDB list, for covers, details and RomM links. Japan's Famicom and Super Famicom are filled in.",
    default: IGDB_EXTRA_PLATFORM_IDS,
    keyLabel: 'Platform key',
    advanced: true,
  }),
  'sources.rommUrl': text({
    page: 'sources',
    section: 'RomM (your ROM library)',
    label: 'RomM address',
    description:
      "Where Squirrelcade reaches your RomM, such as http://192.168.1.20:8080. An address on your own network is best: it's faster, and no sign-in page stands in the way. Empty turns the RomM links off.",
    default: '',
    maxLength: 300,
  }),
  'sources.rommToken': secret({
    page: 'sources',
    section: 'RomM (your ROM library)',
    label: 'API token',
    description: 'A RomM Client API token with the scopes roms.read and platforms.read, created in RomM. Squirrelcade only reads.',
  }),
  'sources.rommPublicUrl': text({
    page: 'sources',
    section: 'RomM (your ROM library)',
    label: 'RomM address for links',
    description: 'The address your browser opens RomM at, when it differs from the one above (a public address, for example). Empty uses the one above.',
    default: '',
    maxLength: 300,
  }),
  'sources.rommRefreshHours': num({
    page: 'sources',
    section: 'RomM (your ROM library)',
    label: 'Update the RomM index every',
    description: "How often Squirrelcade reads RomM's list of ROMs again, for the links. 0 means only when you ask.",
    default: 24,
    min: 0,
    max: 720,
    unit: 'hours',
  }),
  'sources.rommPlatforms': list({
    page: 'sources',
    section: 'RomM (your ROM library)',
    label: 'RomM platforms',
    description:
      'Which RomM platform a Squirrelcade platform is, where Squirrelcade can\'t tell by the IGDB platform number or the name: one line per platform, "platform key: RomM slug", several slugs separated by ";" (for example "super-nintendo: snes; sfam").',
    default: [],
    advanced: true,
  }),
  'sources.rommLinkUnowned': bool({
    page: 'sources',
    section: 'RomM (your ROM library)',
    label: "Link games you don't own",
    description:
      "Off, Squirrelcade links to RomM only for games in your collection. On, the Top 100 lists, a console's \"Start here\" games and the game drawer also link games you don't have. Squirrelcade doesn't endorse piracy: turning this on assumes you own these games, even though they aren't in your collection.",
    default: false,
  }),
  'sources.rommRegions': list({
    page: 'sources',
    section: 'RomM (your ROM library)',
    label: 'Preferred ROM regions',
    description:
      'When RomM has several ROMs of a game, the one from the first region here is linked. Empty follows your home region (for North America: USA, World, Europe, Japan). Betas, prototypes, demos and hacks come last either way.',
    default: [],
    advanced: true,
  }),

  'sources.itadKey': secret({
    page: 'sources',
    section: 'IsThereAnyDeal (PC game prices)',
    label: 'API key',
    description:
      'A free key: sign in at isthereanydeal.com, open My apps (isthereanydeal.com/apps/my), register an app and copy its API key (not its OAuth client ID or secret). Squirrelcade only reads prices.',
  }),
  'sources.itadCountry': text({
    page: 'sources',
    section: 'IsThereAnyDeal (PC game prices)',
    label: 'Country',
    description: 'The store country prices are for, as two letters (US, GB, DE, CA, AU, JP...).',
    default: 'US',
    maxLength: 2,
  }),  'sources.ggdealsKey': secret({
    page: 'sources',
    section: 'GG.deals (PC game prices)',
    label: 'GG.deals API key',
    description: "A second source of PC game prices: GG.deals' best price now and its lowest ever for the PC wishlist's Steam games, in retail stores and key shops. Free for personal use, with GG.deals credited wherever its prices show.",
  }),
  'sources.ggdealsRegion': select({
    page: 'sources',
    section: 'GG.deals (PC game prices)',
    label: 'GG.deals prices for',
    description: 'The region whose prices GG.deals gives.',
    default: 'us',
    options: [
      { value: 'us', label: 'United States' },
      { value: 'ca', label: 'Canada' },
      { value: 'gb', label: 'United Kingdom' },
      { value: 'eu', label: 'Europe (euro)' },
      { value: 'au', label: 'Australia' },
      { value: 'br', label: 'Brazil' },
      { value: 'de', label: 'Germany' },
      { value: 'fr', label: 'France' },
      { value: 'es', label: 'Spain' },
      { value: 'it', label: 'Italy' },
      { value: 'nl', label: 'Netherlands' },
      { value: 'pl', label: 'Poland' },
      { value: 'se', label: 'Sweden' },
      { value: 'no', label: 'Norway' },
      { value: 'dk', label: 'Denmark' },
      { value: 'fi', label: 'Finland' },
      { value: 'ch', label: 'Switzerland' },
      { value: 'ie', label: 'Ireland' },
      { value: 'be', label: 'Belgium' },
    ],
  }),
  'sources.pcPriceFirst': select({
    page: 'sources',
    section: 'GG.deals (PC game prices)',
    label: 'Which prices come first',
    description: 'Where both have a price, the one the PC wishlist shows; the other fills in where the first has none.',
    default: 'itad',
    options: [
      { value: 'itad', label: 'IsThereAnyDeal' },
      { value: 'ggdeals', label: 'GG.deals' },
    ],
  }),


  // Notifications
  'notifications.onImport': bool({
    page: 'notifications',
    section: 'When to notify',
    label: 'After a collection update',
    description: 'Send a summary after each collection update: what was added first, then wishlist changes and the top picks.',
    default: true,
  }),
  'notifications.onFailure': bool({
    page: 'notifications',
    section: 'When to notify',
    label: 'When something fails or needs you',
    description: 'Send a message when a background task fails, an export file is refused, or a collection update is held until you confirm it.',
    default: true,
  }),
  'notifications.topCount': num({
    page: 'notifications',
    section: 'What to include',
    label: 'Top picks in the summary',
    description: 'How many of the top wishlist games the update summary lists.',
    default: 10,
    min: 0,
    max: 50,
    unit: 'games',
  }),
  'notifications.comingSoonDays': num({
    page: 'notifications',
    section: 'What to include',
    label: 'Coming soon: the next',
    description: 'The update summary lists the games coming out in this many days on the consoles you collect (Acorns > Coming soon has them all). 0 leaves them out.',
    default: 30,
    min: 0,
    max: 365,
    unit: 'days',
  }),
  'notifications.loanReminders': bool({
    page: 'notifications',
    section: 'When to notify',
    label: 'When a lent game is overdue',
    description: 'A message (once per loan) when a game you lent isn\'t back by the day you set (Stash > Loans).',
    default: true,
  }),
  'gotd.enabled': bool({
    page: 'notifications',
    section: 'Game of the day',
    label: 'A game of the day',
    description:
      "Each day, one game you don't have from the top of your wishlist, with why it's there and a link to its price: on the Wishlist page, and as a message if you like. Picked by Squirrelcade's own rules (no AI, no outside service): the more acorns a game has, the likelier; games that came out around this date in a past year get a few more acorns; a game isn't picked again for a while, nor another of its series right after.",
    default: false,
  }),
  'gotd.send': bool({
    page: 'notifications',
    section: 'Game of the day',
    label: 'Send it as a message',
    description: 'On the ways to send messages that are on (below), once a day at the hour below.',
    default: true,
    shownWhen: 'gotd.enabled',
  }),
  'gotd.hour': num({
    page: 'notifications',
    section: 'Game of the day',
    label: 'Send it at',
    description: "The hour of the day (0 to 23, in Squirrelcade's time zone) the message goes out, or soon after.",
    default: 8,
    min: 0,
    max: 23,
    unit: 'hours',
    shownWhen: 'gotd.enabled',
  }),
  'gotd.pickFrom': num({
    page: 'notifications',
    section: 'Game of the day',
    label: 'Pick among the wishlist\'s top',
    description: 'How far down the main wishlist the pick may go.',
    default: 50,
    min: 5,
    max: 500,
    unit: 'games',
    shownWhen: 'gotd.enabled',
    advanced: true,
  }),
  'gotd.repeatDays': num({
    page: 'notifications',
    section: 'Game of the day',
    label: 'Not the same game again for',
    description: 'A game picked (or passed over with "Another one") waits this long before it can be picked again.',
    default: 30,
    min: 1,
    max: 365,
    unit: 'days',
    shownWhen: 'gotd.enabled',
    advanced: true,
  }),
  'gotd.seriesDays': num({
    page: 'notifications',
    section: 'Game of the day',
    label: 'Not the same series again for',
    description: 'After a game of a series, the next ones leave that series out this long.',
    default: 5,
    min: 0,
    max: 90,
    unit: 'days',
    shownWhen: 'gotd.enabled',
    advanced: true,
  }),
  'gotd.pastBonus': num({
    page: 'notifications',
    section: 'Game of the day',
    label: 'Acorns for an anniversary',
    description: 'Extra acorns in the draw for a game that came out within a week of this date in a past year (older games often cost less).',
    default: 10,
    min: 0,
    max: 50,
    unit: 'acorns',
    shownWhen: 'gotd.enabled',
    advanced: true,
  }),
  'notifications.releaseReminders': bool({
    page: 'notifications',
    section: 'Release reminders',
    label: 'Remind me when games come out',
    description:
      "A message (the ways to send them are set up below) when a game you don't have yet comes out on a console you collect: missing, not confirmed physical or waiting on Review. Never one you own, said isn't a target, snoozed or marked Do Not Recommend. Each game once for its release date (again if the date moves). Checked every few hours.",
    default: false,
  }),
  'notifications.releaseReminderDays': num({
    page: 'notifications',
    section: 'Release reminders',
    label: 'How early',
    description: '0 reminds on the day a game comes out; 7 a week before (the message lists every game out by then).',
    default: 0,
    min: 0,
    max: 30,
    unit: 'days',
  }),
  'notifications.releaseReminderMinScore': num({
    page: 'notifications',
    section: 'Release reminders',
    label: 'Only games with at least this many acorns',
    description: "Leaves out games with fewer acorns (a game that isn't on the wishlist has none). 0 reminds about every game.",
    default: 0,
    min: 0,
    max: 100,
  }),
  'notifications.moverPlaces': num({
    page: 'notifications',
    section: 'What to include',
    label: 'Report wishlist moves of at least',
    description:
      'A game counts as a mover when its place in the main wishlist changes by at least this much. One purchase shifts many games a little (the list spreads picks across consoles), so small moves are left out. The summary lists the 10 biggest.',
    default: 25,
    min: 1,
    max: 1000,
    unit: 'places',
    advanced: true,
  }),
  'notifications.emailEnabled': bool({
    page: 'email',
    section: 'Notifications by email',
    label: 'Send notifications by email',
    description: 'Notifications (after collection updates, when something fails) also come by email, sent from your account above.',
    default: false,
  }),
  'notifications.emailProvider': select({
    page: 'email',
    section: 'Your email account',
    label: 'Email provider',
    description: 'Choosing one fills in its mail servers, with the steps for its app password below. "Another provider" is for any other server.',
    default: 'custom',
    options: [...MAIL_PROVIDERS.map((m) => ({ value: m.id, label: m.name })), { value: 'custom', label: 'Another provider (fill in its server)' }],
  }),
  'notifications.smtpHost': text({
    page: 'email',
    section: 'Your email account',
    label: 'Outgoing mail server',
    description: 'The SMTP (outgoing) server, such as smtp.gmail.com. Filled in when you choose a provider.',
    default: '',
  }),
  'notifications.smtpPort': num({
    page: 'email',
    section: 'Your email account',
    label: 'Outgoing mail port',
    description: '587 for STARTTLS (most servers), 465 for TLS from the start. Filled in when you choose a provider.',
    default: 587,
    min: 1,
    max: 65535,
    advanced: true,
  }),
  'notifications.smtpUser': text({
    page: 'email',
    section: 'Your email account',
    label: 'Email address',
    description: 'The account Squirrelcade signs in to, usually your full email address. It sends your notifications and reads PriceCharting\'s emails.',
    default: '',
  }),
  'notifications.smtpPassword': secret({
    page: 'email',
    section: 'Your email account',
    label: 'App password',
    description: "Most providers want an app password here, not your account's own password: the steps above say how to get one. The same password sends and reads mail.",
  }),
  'notifications.emailFrom': text({
    page: 'email',
    section: 'Notifications by email',
    label: 'From',
    description: 'Sender address. Empty uses the username.',
    default: '',
    shownWhen: 'notifications.emailEnabled',
    advanced: true,
  }),
  'notifications.emailTo': list({
    page: 'email',
    section: 'Notifications by email',
    label: 'To',
    description: 'Who gets the notifications (yourself, usually: the same address works).',
    default: [],
    maxItems: 10,
    shownWhen: 'notifications.emailEnabled',
  }),
  'notifications.pushoverEnabled': bool({
    page: 'notifications',
    section: 'Pushover',
    label: 'Send Pushover messages',
    description: 'Short push notifications to your phone through Pushover (an app, a one-time purchase).',
    default: false,
  }),
  'notifications.pushoverToken': secret({
    page: 'notifications',
    section: 'Pushover',
    label: 'Application token',
    description: 'The API token of a Pushover application you created for Squirrelcade.',
    shownWhen: 'notifications.pushoverEnabled',
  }),
  'notifications.pushoverUser': secret({
    page: 'notifications',
    section: 'Pushover',
    label: 'User key',
    description: 'Your Pushover user (or group) key.',
    shownWhen: 'notifications.pushoverEnabled',
  }),
  'notifications.pushbulletEnabled': bool({
    page: 'notifications',
    section: 'Pushbullet',
    label: 'Send Pushbullet pushes',
    description: 'Push notifications to your phone and computer through Pushbullet (free for up to 500 pushes a month).',
    default: false,
  }),
  'notifications.pushbulletToken': secret({
    page: 'notifications',
    section: 'Pushbullet',
    label: 'Access token',
    description: 'From Pushbullet: Settings › Account › Create Access Token.',
    shownWhen: 'notifications.pushbulletEnabled',
  }),
  'notifications.ntfyEnabled': bool({
    page: 'notifications',
    section: 'ntfy',
    label: 'Send ntfy notifications',
    description: 'Push notifications through ntfy: free on ntfy.sh, or a server of your own, with apps for Android and iPhone.',
    default: false,
  }),
  'notifications.ntfyServer': url({
    page: 'notifications',
    section: 'ntfy',
    label: 'ntfy server',
    description: 'https://ntfy.sh, or the address of your own ntfy server.',
    default: 'https://ntfy.sh',
    shownWhen: 'notifications.ntfyEnabled',
  }),
  'notifications.ntfyTopic': text({
    page: 'notifications',
    section: 'ntfy',
    label: 'Topic',
    description: 'The topic you subscribe to in the ntfy app, such as squirrelcade-7f3k9q. On ntfy.sh anyone who knows a topic can read it: pick one nobody would guess.',
    default: '',
    maxLength: 64,
    shownWhen: 'notifications.ntfyEnabled',
  }),
  'notifications.ntfyToken': secret({
    page: 'notifications',
    section: 'ntfy',
    label: 'Access token',
    description: 'Only for a server that asks for one (tk_...). Empty for ntfy.sh topics anyone can use.',
    shownWhen: 'notifications.ntfyEnabled',
  }),
  'notifications.gotifyEnabled': bool({
    page: 'notifications',
    section: 'Gotify',
    label: 'Send Gotify messages',
    description: 'Push notifications through Gotify, a server you run yourself, with an Android app.',
    default: false,
  }),
  'notifications.gotifyServer': url({
    page: 'notifications',
    section: 'Gotify',
    label: 'Gotify server',
    description: 'The address of your Gotify server, such as https://gotify.example.com.',
    default: '',
    shownWhen: 'notifications.gotifyEnabled',
  }),
  'notifications.gotifyToken': secret({
    page: 'notifications',
    section: 'Gotify',
    label: 'Application token',
    description: 'The token of an application you created for Squirrelcade in Gotify (Apps › Create application).',
    shownWhen: 'notifications.gotifyEnabled',
  }),
  'notifications.discordEnabled': bool({
    page: 'notifications',
    section: 'Discord',
    label: 'Send Discord messages',
    description: 'Messages to a Discord channel, through a webhook of that channel.',
    default: false,
  }),
  'notifications.discordWebhook': secretUrl({
    page: 'notifications',
    section: 'Discord',
    label: 'Webhook URL',
    description: 'The channel webhook\'s address (https://discord.com/api/webhooks/...). Kept like a password: anyone with it can post to the channel.',
    shownWhen: 'notifications.discordEnabled',
  }),
  'notifications.telegramEnabled': bool({
    page: 'notifications',
    section: 'Telegram',
    label: 'Send Telegram messages',
    description: 'Messages from a Telegram bot of your own, to you or a group.',
    default: false,
  }),
  'notifications.telegramToken': secret({
    page: 'notifications',
    section: 'Telegram',
    label: 'Bot token',
    description: 'The token @BotFather gave you for your bot, such as 123456789:ABC-DEF...',
    shownWhen: 'notifications.telegramEnabled',
  }),
  'notifications.telegramChatId': text({
    page: 'notifications',
    section: 'Telegram',
    label: 'Chat ID',
    description: 'Your chat with the bot (a number), or a group\'s (a negative number). "Find my chat" fills it in once you\'ve sent the bot a message.',
    default: '',
    maxLength: 64,
    shownWhen: 'notifications.telegramEnabled',
  }),
  'notifications.slackEnabled': bool({
    page: 'notifications',
    section: 'Slack',
    label: 'Send Slack messages',
    description: 'Messages to a Slack channel, through an incoming webhook.',
    default: false,
  }),
  'notifications.slackWebhook': secretUrl({
    page: 'notifications',
    section: 'Slack',
    label: 'Webhook URL',
    description: 'The incoming webhook\'s address (https://hooks.slack.com/services/...). Kept like a password.',
    shownWhen: 'notifications.slackEnabled',
  }),
  'notifications.webhookEnabled': bool({
    page: 'notifications',
    section: 'Webhook',
    label: 'Send to a webhook',
    description: 'Each message as JSON to an address of your choice: n8n, Home Assistant, Node-RED, or anything that takes a web request.',
    default: false,
  }),
  'notifications.webhookUrl': secretUrl({
    page: 'notifications',
    section: 'Webhook',
    label: 'Webhook URL',
    description: 'Where to send the messages (a POST with JSON). Kept like a password, since such addresses often are one.',
    shownWhen: 'notifications.webhookEnabled',
  }),
  'notifications.webhookAuth': secret({
    page: 'notifications',
    section: 'Webhook',
    label: 'Authorization header',
    description: 'Sent as the Authorization header when the receiver checks one, such as "Bearer abc123". Empty sends none.',
    shownWhen: 'notifications.webhookEnabled',
  }),
  'notifications.appriseEnabled': bool({
    page: 'notifications',
    section: 'Apprise',
    label: 'Send through Apprise',
    description: 'Messages through Apprise API, a server you run yourself that passes them on to more than 100 services (Signal, Matrix, Microsoft Teams, SMS...).',
    default: false,
  }),
  'notifications.appriseUrl': url({
    page: 'notifications',
    section: 'Apprise',
    label: 'Apprise notify address',
    description: 'Your Apprise API\'s notify address for the key your services are saved under, such as http://apprise:8000/notify/squirrelcade.',
    default: '',
    shownWhen: 'notifications.appriseEnabled',
  }),
  'notifications.pushoverPrioritySummary': select({
    page: 'notifications',
    section: 'How urgent each message is',
    label: 'Update summaries',
    description: 'How Pushover, ntfy and Gotify deliver the summary after each collection update (Apprise and the webhook get it too).',
    default: '0',
    options: PUSHOVER_PRIORITIES,
  }),
  'notifications.pushoverPriorityWaiting': select({
    page: 'notifications',
    section: 'How urgent each message is',
    label: 'Updates waiting for you',
    description: 'How they deliver the news that a collection update was held for your confirmation, or refused.',
    default: '0',
    options: PUSHOVER_PRIORITIES,
  }),
  'notifications.pushoverPriorityProblem': select({
    page: 'notifications',
    section: 'How urgent each message is',
    label: 'Problems',
    description: 'How they deliver problems: a background task that failed (a backup, for example) or something the health check found.',
    default: '0',
    options: PUSHOVER_PRIORITIES,
  }),

  // Storage and backups
  'storage.importFolder': path({
    page: 'storage',
    section: 'Folders',
    label: 'Watched folder',
    description: 'Where to look for collection exports. Empty uses /imports in Docker, or "imports" in the config folder.',
    default: '',
  }),
  'storage.backupFolder': path({
    page: 'storage',
    section: 'Folders',
    label: 'Backup folder',
    description: 'Where automatic backups go. Empty uses "backups" in the config folder.',
    default: '',
  }),
  'storage.backupCopyFolder': path({
    page: 'storage',
    section: 'Folders',
    label: 'Second backup folder',
    description:
      "Another place each backup is copied to, such as a share on a NAS or another disk, so a copy survives losing this one. Empty means no copies. It must exist (in Docker, mount it, for example at /backup-copies): a missing folder is a health warning and a failed backup task, never a copy inside the container. It keeps as many backups as the backup folder.",
    default: '',
  }),
  'storage.backupRetention': num({
    page: 'storage',
    section: 'Backups',
    label: 'Backups to keep',
    description: 'Older automatic backups are deleted once there are more than this many.',
    default: 14,
    min: 1,
    max: 365,
  }),

  // Tasks
  'tasks.backupIntervalDays': num({
    page: 'tasks',
    section: 'Schedules',
    label: 'Back up the database every',
    description: 'How often an automatic backup is made: weekly suits most collections, daily while you change a lot. Backups to keep (Storage) counts backups, so weekly with 14 kept reaches back about three months.',
    default: 7,
    min: 1,
    max: 30,
    unit: 'days',
  }),
  'tasks.achievementsReadDays': num({
    page: 'tasks',
    section: 'Schedules',
    label: 'Read achievements every',
    description: 'How often RetroAchievements, Xbox, PlayStation and Steam are read for what you played, when they are on (Settings > Sources).',
    default: 1,
    min: 1,
    max: 30,
    unit: 'days',
  }),
  'tasks.importScanMinutes': num({
    page: 'tasks',
    section: 'Schedules',
    label: 'Check the watched folder every',
    description: 'How often the watched folder is checked for new collection exports.',
    default: 15,
    min: 1,
    max: 1440,
    unit: 'minutes',
  }),
  'tasks.housekeepingIntervalHours': num({
    page: 'tasks',
    section: 'Schedules',
    label: 'Clean up old history every',
    description: 'Removes expired sessions and old task history.',
    default: 24,
    min: 1,
    max: 720,
    unit: 'hours',
    advanced: true,
  }),
  'tasks.healthCheckHours': num({
    page: 'tasks',
    section: 'Schedules',
    label: 'Check health every',
    description: 'How often Squirrelcade looks for problems (missing folders, old backups) and sends an alert for new ones, when notifications are set up.',
    default: 6,
    min: 1,
    max: 168,
    unit: 'hours',
    advanced: true,
  }),
  'tasks.historyDays': num({
    page: 'tasks',
    section: 'History',
    label: 'Keep task history for',
    description: 'Task runs older than this are removed by the clean-up task.',
    default: 90,
    min: 1,
    max: 3650,
    unit: 'days',
    advanced: true,
  }),

  // Security
  'friends.myName': text({
    page: 'friends',
    section: 'What you share',
    label: 'Your name in what you share',
    description: "How your friends' Squirrelcades name you. Empty: this Squirrelcade's name (Settings › General).",
    default: '',
    maxLength: 60,
  }),
  'friends.shareCollection': bool({
    page: 'friends',
    section: 'What you share',
    label: 'Your collection',
    description: "Each game with its console and each copy's condition, for comparing.",
    default: true,
  }),
  'friends.shareValues': bool({
    page: 'friends',
    section: 'What you share',
    label: 'What your copies are worth',
    description: "PriceCharting's market value of each copy, so trades can be balanced. What you paid is never shared, nor your notes, where copies are kept, loans or what you played.",
    default: true,
  }),
  'friends.shareWishlist': num({
    page: 'friends',
    section: 'What you share',
    label: 'Games from your wishlist',
    description: 'The top of your wishlist, with acorns and priority, so friends see what you want. 0 shares none.',
    default: 50,
    min: 0,
    max: 500,
    unit: 'games',
  }),
  'friends.shareForTrade': bool({
    page: 'friends',
    section: 'What you share',
    label: "What you'd trade",
    description: 'Copies marked for sale or trade (Acorns › For sale), with your asking price.',
    default: true,
  }),
  'friends.shareSpares': bool({
    page: 'friends',
    section: 'What you share',
    label: 'Your spare copies',
    description: 'Second copies of a game (all but the best of each) count as for trade too.',
    default: true,
  }),
  'friends.tradeMargin': num({
    page: 'friends',
    section: 'Trades',
    label: 'An even trade is within',
    description: "How far apart the two sides' market values may be for a trade to count as even.",
    default: 20,
    min: 0,
    max: 100,
    unit: '%',
  }),
  'friends.keepDays': num({
    page: 'friends',
    section: "Friends' files",
    label: "Keep a friend's file for",
    description: 'A file older than this (the friend stopped sending) is dropped from comparisons and trades.',
    default: 60,
    min: 7,
    max: 730,
    unit: 'days',
    advanced: true,
  }),
  'ai.enabled': bool({
    page: 'ai',
    section: 'Connector',
    label: 'Let AI apps read your collection',
    description:
      "Claude Code, and other apps that speak MCP, can look up your games: read-only, so nothing they ask changes anything. Apps on your home network connect with a key you make below. Claude's own apps (claude.ai, the desktop and phone apps) also need the sign-in for apps on the internet. The connector is this Squirrelcade's address followed by /mcp; Help › Claude and AI apps has the steps.",
    default: false,
  }),
  'ai.keysFrom': select({
    page: 'ai',
    section: 'Connector',
    label: 'Keys work from',
    description: 'Where a request with a key may come from. Your home network only keeps a copied key useless anywhere else.',
    default: 'local',
    options: [
      { value: 'local', label: 'Your home network only' },
      { value: 'anywhere', label: 'Anywhere Squirrelcade can be reached' },
    ],
    shownWhen: 'ai.enabled',
  }),
  'ai.sharePaid': bool({
    page: 'ai',
    section: 'What answers include',
    label: 'What you paid',
    description: "On, answers include the price paid for each copy (for you, and viewers who see it on the web). Answers leave Squirrelcade for the AI app's servers. Guests never get it.",
    default: false,
    shownWhen: 'ai.enabled',
  }),
  'ai.shareNotes': bool({
    page: 'ai',
    section: 'What answers include',
    label: 'Your notes',
    description: 'On, answers include your notes on copies and games (for you, and viewers who see them on the web). Guests never get them.',
    default: false,
    shownWhen: 'ai.enabled',
  }),
  'ai.callsPerMinute': num({
    page: 'ai',
    section: 'Limits',
    label: 'Calls per minute',
    description: 'For each key and each person signed in; past it, the app is asked to wait.',
    default: 60,
    min: 5,
    max: 600,
    advanced: true,
    shownWhen: 'ai.enabled',
  }),
  'ai.callsPerDay': num({
    page: 'ai',
    section: 'Limits',
    label: 'Calls per day',
    description: 'For each key and each person signed in.',
    default: 2000,
    min: 50,
    max: 50000,
    advanced: true,
    shownWhen: 'ai.enabled',
  }),
  'ai.logDays': num({
    page: 'ai',
    section: 'Limits',
    label: 'Keep the list of calls for',
    description: 'Each call (when, who, which app, what it asked for) is kept this long, for the list below.',
    default: 90,
    min: 7,
    max: 730,
    unit: 'days',
    advanced: true,
    shownWhen: 'ai.enabled',
  }),
  'ai.internet': bool({
    page: 'ai',
    section: 'Apps on the internet',
    label: "Let Claude's apps sign in from the internet",
    description:
      "claude.ai and Claude's desktop and phone apps call from Anthropic's servers, never from your computer, so they need this Squirrelcade reachable from the internet: an https address (Settings › General), and its connector and sign-in addresses open in any access gate such as Cloudflare Access (Help › Claude and AI apps lists them). Off, only keys work, and those addresses answer \"not found\".",
    default: false,
    shownWhen: 'ai.enabled',
  }),
  'ai.whoCanConnect': select({
    page: 'ai',
    section: 'Apps on the internet',
    label: 'Who can sign in',
    description: 'Accounts that may sign in an app from the internet. Viewers get what they see on the web. Guests (below) can sign in either way.',
    default: 'everyone',
    options: [
      { value: 'owner', label: 'Only the owner' },
      { value: 'everyone', label: 'The owner and viewers' },
    ],
    shownWhen: 'ai.internet',
  }),
  'ai.clientHosts': list({
    page: 'ai',
    section: 'Apps that may connect',
    label: 'App addresses',
    description: "The addresses of the apps that may sign in (where sign-in sends you back). claude.ai covers Claude on the web and in its desktop and phone apps.",
    default: ['claude.ai'],
    maxItems: 20,
    advanced: true,
    shownWhen: 'ai.internet',
  }),
  'ai.allowLocalApps': bool({
    page: 'ai',
    section: 'Apps that may connect',
    label: 'Apps on your own computer',
    description: "Claude Code, MCP Inspector and other apps that finish signing in on your own computer (a localhost address). Keys don't need it.",
    default: true,
    advanced: true,
    shownWhen: 'ai.internet',
  }),
  'ai.accessTeam': text({
    page: 'ai',
    section: 'Guests',
    label: 'Cloudflare Access team address',
    description:
      "With the sign-in page behind Cloudflare Access: your team's address (https://<team>.cloudflareaccess.com). Guests then prove their email with Access's code. Left empty, Squirrelcade emails guests a code itself (Settings › Email).",
    default: '',
    maxLength: 200,
    advanced: true,
    shownWhen: 'ai.internet',
  }),
  'ai.accessAud': text({
    page: 'ai',
    section: 'Guests',
    label: "Access application's audience tag",
    description: "The Application Audience (AUD) tag of the Access application on /oauth/authorize, from its page in Cloudflare (Access › Applications).",
    default: '',
    maxLength: 128,
    advanced: true,
    shownWhen: 'ai.internet',
  }),
  'security.authMethod': select({
    page: 'security',
    section: 'Login',
    label: 'Login required',
    description: 'Whether signing in is required. Requests from outside your network always need a login.',
    default: 'always',
    options: [
      { value: 'always', label: 'Always' },
      { value: 'external', label: 'Only from outside the local network' },
    ],
  }),
  'security.sessionDays': num({
    page: 'security',
    section: 'Login',
    label: 'Stay signed in for',
    description: 'How long a sign-in lasts before you have to sign in again.',
    default: 30,
    min: 1,
    max: 365,
    unit: 'days',
  }),
  'security.trustedProxies': list({
    page: 'security',
    section: 'Network',
    label: 'Trusted proxies',
    description: 'Addresses or ranges (CIDR) of reverse proxies, such as a Cloudflare Tunnel container, whose forwarded client address can be trusted.',
    default: [],
    advanced: true,
    restartRequired: true,
  }),
  'security.inviteDays': num({
    page: 'security',
    section: 'Viewers',
    label: 'Invite links work for',
    description: 'How long a link from System > Users (to invite a viewer, or to let someone choose a new password) works. Each link works once.',
    default: 7,
    min: 1,
    max: 30,
    unit: 'days',
  }),
  'security.viewersSeePaid': bool({
    page: 'security',
    section: 'Viewers',
    label: 'Viewers see what you paid',
    description: 'Viewers can look at your collection, its value and your wishlist, but not change anything. On, they also see the price you paid for each copy and your spending by month.',
    default: false,
  }),
  'security.viewersSeeNotes': bool({
    page: 'security',
    section: 'Viewers',
    label: 'Viewers see your notes',
    description: 'On, viewers see your notes on games (read-only): useful when family shops for you ("the one with the art book").',
    default: false,
  }),
  'security.viewersSeePc': bool({
    page: 'security',
    section: 'Viewers',
    label: 'Viewers see the PC library',
    description: 'Off hides the PC library and the PC wishlist from viewers.',
    default: true,
  }),
  'security.viewersSeePlay': bool({
    page: 'security',
    section: 'Viewers',
    label: 'Viewers see what you played',
    description: 'Your play status and ratings (beaten, playing, 8/10...), and your backlog.',
    default: true,
  }),
  'security.viewersSeeCopyDetails': bool({
    page: 'security',
    section: 'Viewers',
    label: "Viewers see your copies' details",
    description: 'Where each copy is kept, your tags, photos of copies, and who has a game you lent.',
    default: false,
  }),
  'security.publicCheck': select({
    page: 'security',
    section: 'Checking a game without signing in',
    label: 'Check a game without signing in',
    description:
      "The sign-in page leads with scanning a game's barcode (or typing its title) and answers whether you have it or need it, for someone shopping for you who has no account. Anyone who can reach the sign-in page can use it, so keep Squirrelcade behind a sign-in of its own (such as Cloudflare Access) when it's on the internet.",
    default: 'off',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'phones', label: 'On phones and tablets' },
      { value: 'everywhere', label: 'Everywhere' },
    ],
  }),
  'security.publicCheckValue': bool({
    page: 'security',
    section: 'Checking a game without signing in',
    label: 'Show what your copy is worth',
    description: "Off answers only whether you have a game; on also shows what your copy is worth (PriceCharting's value in your last export).",
    default: false,
  }),
  'security.publicCheckLimit': num({
    page: 'security',
    section: 'Checking a game without signing in',
    label: 'Checks per 10 minutes',
    description: 'How many games one address can check without signing in in 10 minutes, so nobody can read your whole collection that way.',
    default: 60,
    min: 5,
    max: 1000,
    advanced: true,
  }),
  'security.shareOpenLimit': num({
    page: 'security',
    section: 'Share links',
    label: 'Share pages opened per 10 minutes',
    description: 'How many times one address can open share pages (your wishlist or your games for sale, made on those pages) in 10 minutes.',
    default: 60,
    min: 5,
    max: 1000,
    advanced: true,
  }),
} satisfies Record<string, SettingDefinition<any>>;

/**
 * What each optional part needs set up, shown right under its switch on Settings > Features as soon as it's turned
 * on (a part's settings are hidden elsewhere while it's off, so this is where it's set up): its keys, address or folder.
 */
export const FEATURE_SETUP: Readonly<Record<FeatureKey, readonly SettingKey[]>> = {
  igdb: ['sources.igdbClientId', 'sources.igdbClientSecret'],
  history: [],
  pc: ['pc.playniteFolder'],
  romm: ['sources.rommUrl', 'sources.rommToken'],
  itad: ['sources.itadKey', 'sources.itadCountry'],
  mail: ['mail.username', 'mail.password', 'mail.imapHost'],
  retroachievements: ['sources.raUsername', 'sources.raApiKey'],
  xbox: ['sources.xboxApiKey'],
  playstation: ['sources.psnToken'],
  steam: ['sources.steamApiKey', 'sources.steamId'],
};

/**
 * Where each optional part is set up: its switch, its steps, its keys and its test together (a service's card on Sources,
 * Email, the PC library's page). Settings > Features keeps a switch for each, with a link here; null: Features only.
 */
export const FEATURE_HOME: Readonly<Record<FeatureKey, SettingsPageId | null>> = {
  igdb: 'sources',
  history: null,
  pc: 'pc',
  romm: 'sources',
  itad: 'sources',
  mail: 'email',
  retroachievements: 'sources',
  xbox: 'sources',
  playstation: 'sources',
  steam: 'sources',
};

/** The part a Settings > Features switch turns on or off ("features.pc" is the PC library's), or null. */
export function featureOfSwitch(key: string): FeatureKey | null {
  return (Object.entries(FEATURE_SETTINGS) as [FeatureKey, string][]).find(([, k]) => k === key)?.[0] ?? null;
}

/**
 * The optional part a setting belongs to, so its settings hide while the part is off (they keep their values):
 * the PC library's page, the IGDB and RomM sections of Sources, and the settings elsewhere that only matter with them.
 */
export function settingFeature(key: string): FeatureKey | null {
  if (key.startsWith('features.')) return null;
  if (key.startsWith('pc.price') || key.startsWith('sources.itad') || key.startsWith('sources.ggdeals') || key === 'sources.pcPriceFirst') return 'itad';
  if (key.startsWith('pc.') || key === 'security.viewersSeePc' || key === 'wishlist.ownedOnPcPoints') return 'pc';
  if (key.startsWith('sources.romm')) return 'romm';
  if (key.startsWith('sources.igdb')) return 'igdb';
  if (key.startsWith('mail.')) return 'mail';
  if (key.startsWith('sources.ra')) return 'retroachievements';
  if (key.startsWith('sources.xbox')) return 'xbox';
  if (key.startsWith('sources.psn')) return 'playstation';
  if (key.startsWith('sources.steam')) return 'steam';
  if (key === 'interface.timelineGames') return 'history';
  return null;
}

/** The key of a setting, such as "general.currency". */
export type SettingKey = keyof typeof settingDefinitions;
/** The type of one setting's value. */
export type SettingValue<K extends SettingKey> = (typeof settingDefinitions)[K]['default'];
/** A value for every setting. */
export type SettingsValues = { [K in SettingKey]: SettingValue<K> };

/** Every setting key, in the order they are defined. */
export const settingKeys = Object.keys(settingDefinitions) as SettingKey[];

/** Whether a string names a setting. */
export function isSettingKey(key: string): key is SettingKey {
  return Object.prototype.hasOwnProperty.call(settingDefinitions, key);
}

/** Settings that hold passwords or keys. */
export const secretKeys = settingKeys.filter((k) => settingDefinitions[k].kind === 'secret');

/** Every setting at its default, as fresh copies that are safe to change. */
export function defaultSettings(): SettingsValues {
  const values = {} as Record<string, unknown>;
  for (const key of settingKeys) values[key] = structuredClone(settingDefinitions[key].default);
  return values as SettingsValues;
}

/** Why a setting value was refused, for the form to show next to it. */
export type SettingIssue = { key: string; message: string };

/** Validates a partial set of setting changes. Unknown keys and invalid values are reported, not applied. */
export function validateSettingChanges(changes: Record<string, unknown>): {
  valid: Partial<SettingsValues>;
  issues: SettingIssue[];
} {
  const valid: Record<string, unknown> = {};
  const issues: SettingIssue[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (!isSettingKey(key)) {
      issues.push({ key, message: 'Unknown setting' });
      continue;
    }
    const result = (settingDefinitions[key].schema as z.ZodType<unknown>).safeParse(value);
    if (result.success) valid[key] = result.data;
    else issues.push({ key, message: result.error.issues.map((i) => i.message).join('; ') });
  }
  return { valid: valid as Partial<SettingsValues>, issues };
}

/** What a settings file is marked with, so an import can tell it from any other file. */
export const SETTINGS_EXPORT_FORMAT = 'squirrelcade-settings';
/** The settings file version this Squirrelcade writes; files from newer versions are refused. */
export const SETTINGS_EXPORT_VERSION = 1;

/** A settings file: the settings that differ from their defaults, without passwords or keys. */
export interface SettingsExport {
  format: typeof SETTINGS_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  appVersion: string;
  settings: Partial<SettingsValues>;
}
