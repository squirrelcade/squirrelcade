import { platformInText } from './catalogList.js';
import { KNOWN_PLATFORMS } from './platforms.js';

/**
 * Shop links (Settings > Interface > "Shop links"): links to look for a game in a shop or a price comparison
 * site. Each is written "Name | address", the address with {title} where the game's title goes and, if the
 * shop's search takes it, {platform} for its console; a third part can name the consoles it's for
 * ("Deku Deals | https://www.dekudeals.com/search?q={title} | Nintendo Switch, Nintendo Switch 2"), and a fourth the
 * group it shows in ("Mercari | https://... | | Used marketplaces": the consoles part left empty for every console).
 */

/** One shop link as the setting takes it: a short name, a bar, an http(s) address with {title}, and optionally a bar and its consoles. */
export const SHOP_LINK = /^[^|]{1,40}\|\s*https?:\/\/\S*\{title\}\S*\s*(\|[^|]{0,200})?(\|[^|]{1,40})?$/;

/** A shop link: its name, its address with {title} and {platform} still in it, the consoles it's for (null: every console), and its group. */
export interface ShopLink {
  name: string;
  template: string;
  platforms: string[] | null;
  /** The group it shows in, in a game's drawer ("Used marketplaces"); none: "Your links". */
  group?: string;
}

/** The shop links set; a line that isn't one is left out, and so is a console name that isn't one Squirrelcade knows. */
export function shopLinks(lines: readonly string[]): ShopLink[] {
  return lines
    .map((l) => l.trim())
    .filter((l) => SHOP_LINK.test(l))
    .map((l) => {
      const [name, template, consoles, group] = l.split('|').map((part) => part.trim());
      const keys = consoles
        ? [...new Set(consoles.split(',').map((c) => platformInText(c, KNOWN_PLATFORMS)).filter((k): k is string => k !== null))]
        : [];
      return { name: name!, template: template!, platforms: consoles ? keys : null, ...(group ? { group } : {}) };
    });
}

/** How many shop links a list shows (a game's drawer shows them all, by group). */
export const SHOPS_IN_LISTS = 3;

/** The shop links for a game on one console: the ones for every console, and the ones naming it. */
export function shopLinksFor(lines: readonly string[], platformKey: string): ShopLink[] {
  return shopLinks(lines).filter((s) => s.platforms === null || s.platforms.includes(platformKey));
}

/** A shop link's address for one game, with its title and console put in. */
export function shopUrl(template: string, title: string, platform: string): string {
  return template.replace(/\{title\}/g, encodeURIComponent(title)).replace(/\{platform\}/g, encodeURIComponent(platform));
}

/**
 * PriceCharting's price search for a barcode: it opens the product with that barcode (the edition itself, on its
 * console), so a scanned game's price is one tap away. Opened in the browser, as a link: never fetched by Squirrelcade.
 */
export function priceChartingBarcodeUrl(code: string): string {
  return `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(code.replace(/\D/g, ''))}`;
}

/** PriceCharting's price search for a game on a console (its console name), which every price list links to. */
export function priceChartingUrl(title: string, consoleName: string): string {
  return `https://www.pricecharting.com/search-products?type=prices&q=${encodeURIComponent(`${title} ${consoleName}`)}`;
}
