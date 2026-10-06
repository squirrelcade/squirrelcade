import { MEDIA_NAMES, type GameMedia, type TestResult } from './copyCare.js';
import type { Completeness } from './pricecharting.js';

/** The marketplaces Squirrelcade writes listings for (0.22.0, D86). */
export type Marketplace = 'ebay' | 'mercari';
export const MARKETPLACES: Record<Marketplace, string> = { ebay: 'eBay', mercari: 'Mercari' };

/** Both marketplaces cut a listing's title at 80 characters; Mercari's description at 1,000. */
export const TITLE_MAX = 80;
export const MERCARI_DESCRIPTION_MAX = 1000;

/** What a listing is written from: the game, the copy, and what's known about it. */
export interface ListingInput {
  title: string;
  platformName: string;
  year: number | null;
  completeness: Completeness | string;
  media: GameMedia;
  /** The copy's region, and the home region (a copy from elsewhere says so: PAL, Japan import). */
  region: string;
  homeRegion: string;
  gradingCompany?: string;
  /** Its last test (played) and its last rip (its disc read in full), when there are: testedAt is the day (YYYY-MM-DD, in the owner's time zone). */
  lastTest: { result: TestResult; testedAt: string } | null;
  lastRip: { result: TestResult; testedAt: string } | null;
  /** How the owner writes dates (Settings > General): a listing's days in words, in that order ("September 29, 2026"). */
  dateFormat?: 'us' | 'eu' | 'iso';
  /** The owner's note for buyers (Your copies > For sale). */
  saleNote?: string | null;
  genres?: string[];
  upc?: string | null;
  /** The standard photos taken of it. */
  photos: number;
  /** Settings > Collection > Selling > The end of every listing. */
  footer?: string;
}

export interface Listing {
  marketplace: Marketplace;
  title: string;
  description: string;
  /** eBay's item specifics (Mercari asks for fewer; the same names help there too). */
  specifics: { name: string; value: string }[];
  /** The marketplace's condition for it (eBay's with its id). */
  condition: { name: string; id?: number };
}

/** The container a console's games come in, as a listing calls it. */
const CONTAINER: Record<GameMedia, string> = { disc: 'case', cartridge: 'box', card: 'case', disk: 'case' };

const REGION_WORDS: Record<string, string> = { europe: 'PAL', japan: 'Japan Import', asia: 'Asia Import', 'north-america': 'NTSC-U/C' };
const REGION_CODES: Record<string, string> = { 'north-america': 'NTSC-U/C (US/Canada)', europe: 'PAL', japan: 'NTSC-J (Japan)', asia: 'NTSC-J (Asia)' };

/** The condition in a title's few words ("CIB Complete", "Disc Only"). */
function conditionWords(c: ListingInput): string {
  const media = MEDIA_NAMES[c.media];
  const container = CONTAINER[c.media] === 'box' ? 'Box' : 'Case';
  switch (c.completeness) {
    case 'sealed':
      return 'New Sealed';
    case 'complete':
      return 'CIB Complete';
    case 'item-box':
      return `${media} & ${container}`;
    case 'item-manual':
      return `${media} & Manual`;
    case 'loose':
      return `${media} Only`;
    case 'box-only':
      return `${container} Only`;
    case 'manual-only':
      return 'Manual Only';
    case 'graded':
      return c.gradingCompany ? `Graded ${c.gradingCompany}` : 'Graded';
    default:
      return '';
  }
}

/** What comes with the copy, in a sentence's words. */
function includes(c: ListingInput): string {
  const media = MEDIA_NAMES[c.media].toLowerCase();
  const container = CONTAINER[c.media];
  switch (c.completeness) {
    case 'sealed':
      return 'factory sealed, never opened';
    case 'complete':
      return `the ${media}, the ${container} and the manual`;
    case 'item-box':
      return `the ${media} and the ${container}, no manual`;
    case 'item-manual':
      return `the ${media} and the manual, no ${container}`;
    case 'loose':
      return `the ${media} only, no ${container} or manual`;
    case 'box-only':
      return `the ${container} only, no game`;
    case 'manual-only':
      return 'the manual only, no game';
    case 'graded':
      return c.gradingCompany ? `graded by ${c.gradingCompany}` : 'graded';
    default:
      return '';
  }
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A day (YYYY-MM-DD) as a buyer reads it: "September 29, 2026" (us), "29 September 2026" (eu), or as it is (iso). */
export function listingDay(value: string, format: 'us' | 'eu' | 'iso' = 'us'): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m || format === 'iso') return value.slice(0, 10);
  const [, y, mo, d] = m;
  const month = MONTH_NAMES[Number(mo) - 1];
  if (!month) return value.slice(0, 10);
  return format === 'eu' ? `${Number(d)} ${month} ${y}` : `${month} ${Number(d)}, ${y}`;
}

/** A title of at most 80 characters: the game, its console and year, its condition, its region, and "Tested" when it works. */
export function listingTitle(c: ListingInput): string {
  const region = c.region !== c.homeRegion ? REGION_WORDS[c.region] : undefined;
  const verified = c.lastRip?.result === 'works' || c.lastTest?.result === 'works';
  const parts = (withYear: boolean, withTested: boolean) =>
    [`${c.title} (${c.platformName}${withYear && c.year ? `, ${c.year}` : ''})`, conditionWords(c), region, withTested && verified ? 'Tested' : undefined]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  for (const [year, tested] of [
    [true, true],
    [true, false],
    [false, false],
  ] as const) {
    const t = parts(year, tested);
    if (t.length <= TITLE_MAX) return t;
  }
  // Still too long: the game's name gives way, at a word.
  const tail = ` (${c.platformName}) ${conditionWords(c)}`.trimEnd();
  const room = TITLE_MAX - tail.length;
  let name = c.title.slice(0, Math.max(room, 10));
  if (name.length < c.title.length) name = name.replace(/\s+\S*$/, '');
  return `${name}${tail}`.slice(0, TITLE_MAX);
}

/** The marketplace's condition for a copy: new when sealed, for parts when it doesn't work, otherwise used (Mercari: good). */
export function listingCondition(c: ListingInput, marketplace: Marketplace): { name: string; id?: number } {
  const broken = c.lastTest?.result === 'broken' || c.lastRip?.result === 'broken';
  if (marketplace === 'ebay') {
    if (c.completeness === 'sealed') return { name: 'New', id: 1000 };
    if (broken) return { name: 'For parts or not working', id: 7000 };
    return { name: 'Used', id: 3000 };
  }
  if (c.completeness === 'sealed') return { name: 'New' };
  if (broken) return { name: 'Poor' };
  return { name: 'Good' };
}

/**
 * A listing for a marketplace: its title, a plain description (the game, what comes with it, how it was tested and
 * read, the owner's note, the photos, the footer), eBay's item specifics, and the condition. The owner reads it over
 * before posting it; nothing here is sent anywhere.
 */
export function writeListing(c: ListingInput, marketplace: Marketplace): Listing {
  const region = REGION_CODES[c.region];
  const day = (value: string) => listingDay(value, c.dateFormat);
  // What was ripped: the disc, or the cartridge or card of a console the owner rips with a cartridge reader.
  const media = MEDIA_NAMES[c.media].toLowerCase();
  const lines = [
    `${c.title} for ${c.platformName}${c.year ? ` (${c.year})` : ''}${region && c.region !== c.homeRegion ? `, ${region}` : ''}.`,
    includes(c) ? `What you get: ${includes(c)}.` : null,
    c.lastRip
      ? c.lastRip.result === 'works'
        ? `The ${media} was read in full and verified without errors on ${day(c.lastRip.testedAt)}.`
        : c.lastRip.result === 'issues'
          ? `A full read of the ${media} on ${day(c.lastRip.testedAt)} found some errors.`
          : `The ${media} couldn't be read on ${day(c.lastRip.testedAt)}.`
      : null,
    c.lastTest
      ? c.lastTest.result === 'works'
        ? `Tested and working on ${day(c.lastTest.testedAt)}.`
        : c.lastTest.result === 'issues'
          ? `Tested on ${day(c.lastTest.testedAt)}: it works, with some problems (see below).`
          : `Tested on ${day(c.lastTest.testedAt)}: it doesn't work. Sold for parts or repair.`
      : null,
    c.saleNote?.trim() || null,
    c.photos > 0 ? 'The photos show the copy you will receive.' : null,
    c.footer?.trim() || null,
  ].filter((l): l is string => Boolean(l));
  let description = lines.join('\n\n');
  if (marketplace === 'mercari' && description.length > MERCARI_DESCRIPTION_MAX) description = `${description.slice(0, MERCARI_DESCRIPTION_MAX - 1).replace(/\s+\S*$/, '')}…`;
  const specifics = [
    { name: 'Platform', value: c.platformName },
    { name: 'Game Name', value: c.title },
    region ? { name: 'Region Code', value: region } : null,
    c.year ? { name: 'Release Year', value: String(c.year) } : null,
    c.genres && c.genres.length > 0 ? { name: 'Genre', value: c.genres[0]! } : null,
    { name: 'UPC', value: c.upc || 'Does not apply' },
  ].filter((x): x is { name: string; value: string } => x !== null);
  return { marketplace, title: listingTitle(c), description, specifics, condition: listingCondition(c, marketplace) };
}

/**
 * What a sale brings, in cents: the price and the shipping the buyer paid, less the marketplace's fee (a share of both,
 * and eBay's per order), less what shipping costs the seller.
 */
export function netOfSale(p: { priceCents: number; shippingChargedCents?: number; feePercent: number; orderFeeCents?: number; shippingCostCents?: number }): { feesCents: number; netCents: number } {
  const total = p.priceCents + (p.shippingChargedCents ?? 0);
  const feesCents = Math.round((total * p.feePercent) / 100) + (p.orderFeeCents ?? 0);
  return { feesCents, netCents: total - feesCents - (p.shippingCostCents ?? 0) };
}

/** A search for the game's sold listings on eBay (its Video Games category), for what copies really sell for. */
export function ebaySoldUrl(site: string, title: string, platformName: string): string {
  return `https://${site.replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'www.ebay.com'}/sch/i.html?_nkw=${encodeURIComponent(`${title} ${platformName}`)}&_sacat=139973&LH_Sold=1&LH_Complete=1`;
}

/** Mercari's sold listings for the game. */
export function mercariSoldUrl(title: string, platformName: string): string {
  return `https://www.mercari.com/search/?keyword=${encodeURIComponent(`${title} ${platformName}`)}&status=sold_out`;
}

/** Each marketplace's page to start a listing. */
export function sellFormUrl(marketplace: Marketplace, ebaySite: string): string {
  return marketplace === 'ebay' ? `https://${ebaySite.replace(/^https?:\/\//, '').replace(/\/+$/, '') || 'www.ebay.com'}/sl/sell` : 'https://www.mercari.com/sell/';
}
