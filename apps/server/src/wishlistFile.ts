import { igdbCoverUrl } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import type { FetchLike } from './igdb.js';
import type { SettingsService } from './settings.js';
import type { WishlistService } from './wishlist.js';

/** One game on the page: only what a wishlist shows. */
export interface FileGame {
  place: number;
  title: string;
  console: string;
  acorns: number;
  priority: string;
  coverId: string | null;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Covers kept once fetched (a data: URI is a few KB), so a second file doesn't fetch them again. */
const coverCache = new Map<string, string>();
const COVER_CACHE_MAX = 600;
const COVER_MAX_BYTES = 40_000;

/**
 * Small embedded covers (IGDB's 90x128 thumbnails) as data: URIs, by cover id. One that can't be fetched in time
 * (offline, slow, too big) is left out, and its game shows without a cover; the file never fails over a cover.
 */
export async function embedCovers(ids: string[], fetchImpl: FetchLike = (url, init) => fetch(url, init), budgetMs = 8000): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const todo: string[] = [];
  for (const id of new Set(ids)) {
    const hit = coverCache.get(id);
    if (hit) out.set(id, hit);
    else todo.push(id);
  }
  const deadline = Date.now() + budgetMs;
  let next = 0;
  const worker = async () => {
    while (next < todo.length && Date.now() < deadline) {
      const id = todo[next++]!;
      try {
        const res = await fetchImpl(igdbCoverUrl(id, 'cover_small'), { signal: AbortSignal.timeout(Math.max(500, Math.min(4000, deadline - Date.now()))) });
        if (!res.ok) continue;
        const type = (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]!.trim();
        if (!/^image\/(jpeg|png|webp)$/.test(type)) continue;
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length === 0 || bytes.length > COVER_MAX_BYTES) continue;
        const uri = `data:${type};base64,${bytes.toString('base64')}`;
        if (coverCache.size >= COVER_CACHE_MAX) coverCache.delete(coverCache.keys().next().value as string);
        coverCache.set(id, uri);
        out.set(id, uri);
      } catch {
        // No cover for this one.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(10, todo.length) }, worker));
  return out;
}

const possessive = (name: string) => (/s$/i.test(name) ? `${name}'` : `${name}'s`);

/** The wishlist as one self-contained page: no script but the print button, no server address, light and dark, printable. */
export function wishlistPage(o: { owner: string; console: string | null; madeAt: Date; games: FileGame[]; covers: Map<string, string> }): string {
  const title = o.owner ? `${possessive(o.owner)} wishlist` : 'Wishlist';
  const heading = o.console ? `${title}: ${o.console}` : title;
  const date = o.madeAt.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const rows = o.games
    .map((g) => {
      const cover = g.coverId && o.covers.get(g.coverId);
      return `<tr><td class="n">${g.place}</td><td class="c">${cover ? `<img src="${cover}" width="36" height="51" alt="">` : ''}</td><td><b>${esc(g.title)}</b><br><span class="sub">${esc(g.console)}</span></td><td class="a">&#127792; ${g.acorns}</td><td class="p p-${esc(g.priority.toLowerCase())}">${esc(g.priority)}</td></tr>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(heading)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1c1b1a;--dim:#6b6762;--line:#e4e0da;--accent:#a8591c;--chip:#f3efe9}
@media (prefers-color-scheme:dark){:root{--bg:#1b1a19;--fg:#ece8e2;--dim:#a29d95;--line:#383532;--accent:#e2994f;--chip:#2a2826}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 40px}
h1{margin:0;font-size:1.7rem}
.meta{color:var(--dim);margin:4px 0 16px;font-size:.9rem}
button{font:inherit;padding:6px 14px;border:1px solid var(--line);border-radius:6px;background:var(--chip);color:var(--fg);cursor:pointer}
table{width:100%;border-collapse:collapse;margin-top:16px}
td{padding:6px 8px;border-top:1px solid var(--line);vertical-align:middle}
td.n{width:2.5em;color:var(--dim);text-align:right}
td.c{width:44px;padding-right:0}
td.c img{display:block;border-radius:3px}
td.a{white-space:nowrap;text-align:right;font-weight:600}
td.p{white-space:nowrap;font-size:.85rem;color:var(--dim)}
td.p-high{color:var(--accent);font-weight:600}
.sub{color:var(--dim);font-size:.85rem}
footer{margin-top:24px;color:var(--dim);font-size:.8rem}
@media print{:root{--bg:#fff;--fg:#000;--dim:#555;--line:#bbb;--accent:#000}.noprint{display:none}main{max-width:none;padding:0}tr{break-inside:avoid}body{font-size:12pt}}
</style></head><body><main>
<h1>${esc(heading)}</h1>
<div class="meta">${esc(date)} &middot; the top ${o.games.length} game${o.games.length === 1 ? '' : 's'}, best first</div>
<button class="noprint" type="button" onclick="window.print()">Print / Save as PDF</button>
<table><tbody>
${rows}
</tbody></table>
<footer>Made with Squirrelcade</footer>
</main></body></html>
`;
}

/** Share as a file: the wishlist as one page to send to anyone (D216), from the list already worked out. */
export function registerWishlistFileRoutes(app: FastifyInstance, wishlist: WishlistService, settings: SettingsService, imageFetch?: FetchLike): void {
  app.get('/api/v1/wishlist/file', async (request, reply) => {
    const platform = (request.query as { platform?: string }).platform?.trim() || null;
    const r = wishlist.compute();
    const limit = settings.get('wishlist.fileGames');
    let consoleName: string | null = null;
    let games: FileGame[];
    if (platform) {
      const p = r.platforms.find((x) => x.key === platform);
      if (!p) return reply.code(404).send({ error: 'not-found', message: 'No wishlist for that console.' });
      consoleName = p.name;
      games = (r.byPlatform.get(platform) ?? []).slice(0, limit).map((c, i) => ({ place: i + 1, title: c.title, console: c.platformName, acorns: Math.round(c.score), priority: c.priority, coverId: wishlist.coverOf(c.platformKey, c.title) }));
    } else {
      games = r.master.slice(0, limit).map((m) => ({ place: m.rank, title: m.title, console: m.platformName, acorns: Math.round(m.masterScore ?? m.score), priority: m.priority, coverId: wishlist.coverOf(m.platformKey, m.title) }));
    }
    const covers = settings.get('wishlist.fileCovers') ? await embedCovers(games.flatMap((g) => (g.coverId ? [g.coverId] : [])), imageFetch) : new Map<string, string>();
    const owner = settings.get('friends.myName').trim() || settings.get('general.instanceName').trim();
    const madeAt = new Date();
    return reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('content-disposition', `attachment; filename="wishlist-${madeAt.toISOString().slice(0, 10)}${platform ? `-${platform}` : ''}.html"`)
      .header('cache-control', 'no-store')
      .send(wishlistPage({ owner, console: consoleName, madeAt, games, covers }));
  });
}
