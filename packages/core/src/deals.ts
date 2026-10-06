/**
 * Deals from PriceCharting: with a PriceCharting wishlist, PriceCharting emails you when someone lists one of its
 * games on eBay below the market value ("[Wishlist Deal] Buy Okami below market price"). With collection updates
 * from email on, Squirrelcade reads those emails too (the same read-only look at PriceCharting's emails) and lists the
 * deals against its own wishlist. This reads one such email; nothing is fetched from PriceCharting or eBay.
 */

/** A deal PriceCharting emailed: the game, where it's listed, and the price. */
export interface PriceChartingDeal {
  /** The game as PriceCharting names it, and its console ("Xbox Live Arcade", "Xbox 360"). */
  title: string;
  console: string;
  /** The listing's price and how much below the market value it is, in cents (null when the email doesn't say). */
  priceCents: number | null;
  saveCents: number | null;
  /** The listing's own title and address (eBay), and its picture. */
  listingTitle: string | null;
  listingUrl: string | null;
  imageUrl: string | null;
  /** The game's PriceCharting page. */
  priceChartingUrl: string | null;
}

const decode = (text: string) =>
  text
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&raquo;/g, '»')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Cents from "$4.99" or "4.99" (a thousands comma allowed). */
function cents(text: string | undefined): number | null {
  const m = /([\d,]+(?:\.\d{1,2})?)/.exec(text ?? '');
  if (!m) return null;
  const value = Number(m[1]!.replace(/,/g, ''));
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/**
 * Reads a PriceCharting wishlist email ("[Wishlist Deal] ..." below the market value, or "[Wishlist] ..." any
 * listing): the game and console from "Someone listed <game> for <console>", the price and saving, the eBay listing.
 * Null for any other email.
 */
export function parseDealEmail(subject: string, html: string): PriceChartingDeal | null {
  if (!/^\s*\[Wishlist( Deal)?\]/i.test(subject)) return null;
  const listed = /Someone listed\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i.exec(html);
  if (!listed) return null;
  const named = decode(listed[2]!);
  // "<game> for <console>": the last " for " splits them (a title may have "for" in it: "Ready for Battle for Wii").
  const at = named.toLowerCase().lastIndexOf(' for ');
  if (at <= 0) return null;
  const title = named.slice(0, at).trim();
  const console = named.slice(at + 5).trim();
  const ebay = /href="(https:\/\/www\.ebay\.[a-z.]+\/itm\/[^"]+)"/i.exec(html)?.[1] ?? null;
  // The listing's title is the bold text of the second eBay link ("Title:").
  const listingTitle = /Title:[\s\S]*?<a[^>]*ebay[^>]*>([\s\S]*?)<\/a>/i.exec(html)?.[1];
  const price = /Price:\s*<\/span>\s*<span[^>]*>([^<]*)</i.exec(html)?.[1];
  const save = /Save:\s*<\/span>\s*<span[^>]*>([^<]*)</i.exec(html)?.[1];
  const image = /<img[^>]*src="(https:\/\/i\.ebayimg\.com\/[^"]+)"/i.exec(html)?.[1] ?? null;
  // The listing's address without the tracking that follows it.
  const clean = (url: string | null) => (url ? decode(url).replace(/[?].*$/, '') : null);
  return {
    title,
    console,
    priceCents: cents(price),
    saveCents: cents(save),
    listingTitle: listingTitle ? decode(listingTitle) : null,
    listingUrl: clean(ebay),
    imageUrl: image,
    priceChartingUrl: clean(listed[1]!),
  };
}

/** What can be listed without the game: a manual, a case, a box, its artwork and the like. */
const PART = String.raw`(?:instruction\s+)?(?:manuals?|instructions?|booklets?|inserts?|cases?|jewel\s*case|boxe?s?|cover\s*art|covers?|art\s*work|artwork|art|sleeves?|slip\s*covers?|steel\s*books?|labels?|posters?|maps?|dust\s*covers?|(?:kinect\s+)?calibration(?:\s+cards?)?)`;
const PARTS_ONLY = new RegExp(String.raw`\b${PART}(?:\s*(?:and|&|\+|/|,|with)\s*${PART})*\s*[-(]?\s*only\b|\bonly\s+(?:the\s+)?${PART}\b`, 'i');
/**
 * A title that ends with the manual by name and says nothing of the game ("... PS3 - INSTRUCTION MANUAL"). A plain
 * "Manual" at the end isn't enough: "... Xbox 360 NTSC-U/C T 2008 Manual" was the game, at $75.
 */
const ENDS_WITH_MANUAL = /\b(?:instruction|instructions|game)\s+(?:manual|booklet)\W*$/i;
const GAME_WORDS = /\b(?:disc|disk|cart|cartridge|game|complete|cib|sealed|new|tested|included)\b|\bw\/|\bwith\b/i;
const NO_GAME = /\b(?:no|without(?:\s+the)?)\s+(?:game|disc|disk|cart|cartridge)s?\b|\b(?:game|disc|cartridge)s?\s+not\s+included\b/i;
const EMPTY = new RegExp(String.raw`\b(?:empty|replacement)\s+(?:original\s+|oem\s+)?${PART}\b`, 'i');
const REPRO = new RegExp(String.raw`\brepro(?:duction)?\b(?!\s+(?:\w+\s+)?${PART}\b)`, 'i');
const GUIDE = /\b(?:strategy|game|player'?s|official)\s+guide\b|\bprima\b.*\bguide\b|\bbradygames\b/i;
const CODE = /\b(?:digital|download)\s+code\b|\bcode\s+only\b/i;

/**
 * What a listing is when its title says it isn't the game itself ("Case Only Civilization VII Switch 2", "Armored Core
 * For Answer Xbox 360 Manual Only", "No Game", a reproduction, a strategy guide): compared with a whole game's market
 * value, such a listing looks like a deal it isn't. Null for anything else, a disc or a cartridge alone included
 * ("Disc Only" is the game, loose), and a whole copy that lists its parts ("Manual/Case/Disc", "Manual Included").
 */
export function listingPart(listingTitle: string | null | undefined): string | null {
  const t = (listingTitle ?? '').replace(/\s+/g, ' ');
  if (!t) return null;
  const only = PARTS_ONLY.exec(t);
  if (only) {
    // The parts named just before "only" ("Case. Manual, and Kinect Calibration ONLY"): one kind names it, more are parts.
    const what = t.slice(Math.max(0, only.index - 40), only.index + only[0].length).toLowerCase();
    const kinds = [/manual|instruction|booklet/, /\bbox/, /case/, /art|cover|insert|sleeve|label|poster|steel/].filter((k) => k.test(what)).length;
    if (kinds > 1) return 'Parts only';
    if (/manual|instruction|booklet/.test(what)) return 'Manual only';
    if (/\bbox/.test(what)) return 'Box only';
    if (/case/.test(what)) return 'Case only';
    return 'Artwork only';
  }
  if (NO_GAME.test(t)) return 'No game';
  if (ENDS_WITH_MANUAL.test(t) && !GAME_WORDS.test(t.replace(ENDS_WITH_MANUAL, ''))) return 'Manual only';
  if (EMPTY.test(t)) return /manual|instruction|booklet/i.test(EMPTY.exec(t)![0]) ? 'Manual only' : 'Case only';
  if (GUIDE.test(t)) return 'Strategy guide';
  if (REPRO.test(t)) return 'Reproduction';
  if (CODE.test(t)) return 'Code only';
  return null;
}
