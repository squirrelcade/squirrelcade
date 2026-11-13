import { SAME_GAME_AT, matchTitles } from './titleMatch.js';
import { decodeEntities } from './wikipedia.js';

/**
 * A PriceCharting product by its ID, for Send to PriceCharting's check (the owner, 2026-11-12: "what you're calling the
 * game and for what system, and then what the price charting ID number says is that game in the system... one quick
 * final scan"). Its name and console come from the owner's own exports, or, when Settings > Collection > Sending to
 * PriceCharting allows it, from the product's public page, read once and kept.
 */

/** PriceCharting's page for a product by its ID: it leads to the product's own page ("/game/nintendo-switch/hollow-knight"). */
export function priceChartingProductUrl(id: string): string {
  return `https://www.pricecharting.com/game/${encodeURIComponent(id)}`;
}

/** A product's name and console as PriceCharting writes them ("Hollow Knight", "Nintendo Switch"), and the ID its page gives. */
export interface PriceChartingProduct {
  id: string | null;
  title: string;
  consoleName: string;
}

const text = (html: string) => decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/**
 * Reads a product page's name and console from its heading
 * (`<h1 id="product_name" title="58604">Hollow Knight <a href="/console/nintendo-switch">Nintendo Switch</a></h1>`),
 * else from its title ("Hollow Knight Prices Nintendo Switch | Compare Loose, CIB & New Prices"). Null when it has neither.
 */
export function readPriceChartingPage(html: string): PriceChartingProduct | null {
  const h1 = /<h1\b[^>]*\bid=["']product_name["'][^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (h1) {
    const id = /\btitle=["'](\d{1,12})["']/i.exec(/<h1\b[^>]*>/i.exec(h1[0])?.[0] ?? '')?.[1] ?? null;
    const anchor = /<a\b[^>]*>([\s\S]*?)<\/a>/i.exec(h1[1]!);
    const title = text(anchor ? h1[1]!.slice(0, anchor.index) : h1[1]!);
    const consoleName = anchor ? text(anchor[1]!) : '';
    if (title && consoleName) return { id, title, consoleName };
  }
  const head = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (head) {
    const words = text(head[1]!).replace(/\s*\|.*$/, '');
    const at = words.lastIndexOf(' Prices ');
    if (at > 0) {
      const title = words.slice(0, at).trim();
      const consoleName = words.slice(at + ' Prices '.length).trim();
      if (title && consoleName) return { id: null, title, consoleName };
    }
  }
  return null;
}

/** "nintendo-switch" -> "Nintendo Switch", "pal-playstation-4" -> "PAL Playstation 4": a slug's words, for a console name. */
function slugWords(slug: string): string {
  return decodeURIComponent(slug)
    .split('-')
    .filter(Boolean)
    .map((w) => (/^(pal|jp|ntsc)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * A product page's address read as its name and console ("/game/nintendo-switch/hollow-knight": "Hollow Knight",
 * "Nintendo Switch"): what the ID's page leads to, when the page itself can't be read. Its words lose their punctuation.
 */
export function priceChartingProductFromUrl(url: string): PriceChartingProduct | null {
  let path: string;
  try {
    path = new URL(url, 'https://www.pricecharting.com').pathname;
  } catch {
    return null;
  }
  const m = /^\/game\/([^/]+)\/([^/]+)\/?$/.exec(path);
  if (!m) return null;
  try {
    return { id: null, title: slugWords(m[2]!), consoleName: slugWords(m[1]!) };
  } catch {
    return null;
  }
}

/** A copy as the check sees it: its title, console and region. */
export interface CopySide {
  title: string;
  platformKey: string | null;
  region: string;
}

/** A PriceCharting product as the check sees it: its name, console name, and the console and region that name stands for. */
export interface ProductSide {
  title: string;
  consoleName: string;
  platformKey: string | null;
  region: string;
}

/**
 * What tells a copy and the PriceCharting product its ID names apart (D187): another game (below the title matcher's
 * same-game confidence), another edition, another console, or the same console's other region. Empty when they agree.
 */
export function productDisagreements(copy: CopySide, product: ProductSide): string[] {
  const why: string[] = [];
  const m = matchTitles(copy.title, product.title);
  if (!m || m.confidence < SAME_GAME_AT) why.push(`PriceCharting calls it "${product.title}"`);
  else if (m.kind === 'edition') why.push(`Another edition: "${product.title}"`);
  if (copy.platformKey !== null && product.platformKey !== null && product.platformKey !== copy.platformKey) why.push(`Another console: ${product.consoleName}`);
  else if (product.region !== copy.region) why.push(`Another region: ${product.consoleName}`);
  return why;
}
