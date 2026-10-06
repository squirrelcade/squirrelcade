import { COMPLETENESS_LABELS, normalizeTitle, PLAY_LABELS, REGION_LABELS, toCsv, type Completeness, type Region } from '@squirrelcade/core';
import type { FastifyInstance } from 'fastify';
import { shown } from './access.js';
import type { CatalogService } from './catalogs.js';
import { extraFilters, type CollectionService, type ItemExtras } from './collection.js';
import type { IgdbService } from './igdb.js';
import type { SettingsService } from './settings.js';

const money = (cents: number | null) => (cents === null ? '' : (cents / 100).toFixed(2));

/**
 * The collection as a spreadsheet (GET /api/v1/collection/export): every copy in the current export with what
 * Squirrelcade adds to PriceCharting's columns: its console, region and condition, the catalog game it counts
 * as, its series, what you played of it, where the copy is kept (its tags, who has it, whether it's for sale) and your
 * note on that game, each as far as it's shown to the requester. A CSV that Google Sheets or Excel opens as it is. It
 * takes the Collection page's filters (?platform=, region=, completeness=, q=, duplicates=1, play=, location=, tag=,
 * lent=1, sale=), so the page's download is what it shows.
 */
export function registerCollectionExport(
  app: FastifyInstance,
  deps: { collection: CollectionService; catalogs: CatalogService; igdb: IgdbService; settings: SettingsService; notes: () => Map<string, string>; extras?: ItemExtras },
): void {
  app.get('/api/v1/collection/export', async (request, reply) => {
    const currency = deps.settings.get('general.currency') || 'USD';
    const may = shown(request);
    const q = request.query as Record<string, string | undefined>;
    const { keep, playOf, ex, key } = extraFilters(q, may, deps.extras ?? {}, deps.collection.backlogIncludesUnmarked());
    const rows: (string | number)[][] = [
      [
        'Title',
        'Console',
        'PriceCharting console',
        'Region',
        'Condition',
        'Sealed',
        'Copies',
        `Value each (${currency})`,
        `Paid each (${currency})`,
        'Added',
        'Bought',
        'Counts as',
        'Series',
        ...(playOf ? ['Played', 'Your rating'] : []),
        ...(ex ? ['Where it is', 'Tags', 'Lent to', 'For sale or trade'] : []),
        'Your note',
      ],
    ];
    {
      const notes = may.notes ? deps.notes() : new Map<string, string>();
      const { items } = deps.collection.items({
        platform: q.platform || undefined,
        region: q.region || undefined,
        completeness: q.completeness || undefined,
        q: q.q || undefined,
        duplicates: q.duplicates === '1' || q.duplicates === 'true',
        sort: 'platform',
        all: true,
        keep,
      });
      // Which catalog game each copy counts as, by console.
      const countsAs = new Map<string, Map<string, string>>();
      const catalogOf = (key: string) => {
        let map = countsAs.get(key);
        if (!map) {
          map = new Map();
          for (const t of deps.catalogs.matchOf(key)?.targets ?? []) for (const m of t.matches) if (!map.has(m.productId)) map.set(m.productId, t.target.title);
          countsAs.set(key, map);
        }
        return map;
      };
      for (const item of items) {
        const { platformKey, platform } = item;
        const counted = platformKey ? catalogOf(platformKey).get(item.productId) : undefined;
        const series = platformKey ? (deps.igdb.findByKey(platformKey, counted ?? item.title)?.franchise ?? '') : '';
        const play = playOf && platformKey ? playOf(platformKey, item.productId, item.title) : null;
        const d = ex?.details.get(key(item));
        rows.push([
          item.title,
          platform ?? '',
          item.consoleLabel,
          REGION_LABELS[item.region as Region] ?? item.region,
          COMPLETENESS_LABELS[item.completeness as Completeness] ?? item.includeString,
          item.sealed ? 'yes' : '',
          item.quantity,
          money(item.valueCents),
          may.paid ? money(item.costCents) : '',
          item.dateEntered ?? '',
          item.datePurchased ?? '',
          counted ?? (platformKey && deps.catalogs.matchOf(platformKey) ? 'not in the catalog' : ''),
          series,
          ...(playOf ? [play?.status ? PLAY_LABELS[play.status] : '', play?.rating ?? ''] : []),
          ...(ex ? [d?.location ?? '', (d?.tags ?? []).join(', '), (ex.lentTo.get(key(item)) ?? []).join(', '), d?.sale ?? ''] : []),
          (platformKey && notes.get(`${platformKey}|${normalizeTitle(counted ?? item.title)}`)) || '',
        ]);
      }
    }
    const date = new Date().toISOString().slice(0, 10);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="squirrelcade-collection-${date}.csv"`)
      .send(toCsv(rows));
  });
}
