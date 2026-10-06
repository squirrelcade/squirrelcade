/**
 * Collection updates from email: PriceCharting emails a link to your export when you ask for one, and Squirrelcade
 * can watch your mailbox for that email and update your collection from it. These are the rules for which emails
 * and links count; the server reads the mailbox (read-only) and downloads the file.
 */

/** Where an export may be downloaded from, unless Settings > Collection says otherwise. */
export const EXPORT_LINK_HOSTS = ['storage.googleapis.com', 'pricecharting.com', 'vgpc.com'] as const;

/** PriceCharting's page with your collection, where its Export is. */
export const PRICECHARTING_COLLECTION_URL = 'https://www.pricecharting.com/my-collection';

/** Whether an address's host is one of the hosts, or under one ("www.pricecharting.com" is under "pricecharting.com"). */
export function hostAllowed(url: string, hosts: readonly string[]): boolean {
  let host: string;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    host = u.hostname.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((h) => {
    const want = h.trim().toLowerCase().replace(/^\*?\./, '');
    return want !== '' && (host === want || host.endsWith(`.${want}`));
  });
}

/**
 * The links in an export email that lead to the export itself: https addresses on an allowed host whose path ends in
 * .zip or .csv (PriceCharting's "Download Your Collection" is a collection.zip on Google's storage), each once, in order.
 * A link anywhere else is never followed, so an email pretending to be PriceCharting's can't send Squirrelcade elsewhere.
 */
export function exportLinks(html: string, text: string, hosts: readonly string[]): string[] {
  const found: string[] = [];
  const decode = (u: string) => u.replace(/&amp;/g, '&').replace(/&#x2F;/gi, '/').replace(/&#47;/g, '/');
  for (const m of `${html}\n${text}`.matchAll(/https:\/\/[^\s"'<>()]+/g)) {
    const url = decode(m[0]).replace(/[.,;]+$/, '');
    let path: string;
    try {
      path = new URL(url).pathname.toLowerCase();
    } catch {
      continue;
    }
    if (!/\.(zip|csv)$/.test(path) || !hostAllowed(url, hosts) || found.includes(url)) continue;
    found.push(url);
  }
  return found;
}

/** Whether an attachment's name is an export Squirrelcade takes (a CSV, or the collection.zip PriceCharting sends). */
export function exportAttachment(fileName: string): boolean {
  return /\.(zip|csv)$/i.test(fileName.trim());
}
