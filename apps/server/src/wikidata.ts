import { APP_VERSION } from './env.js';
import type { FetchLike } from './igdb.js';

/** A claim's value as Roots reads it: a string (an identifier) or an item ("Q123"), with its date if it has one. */
export interface WikidataValue {
  value: string;
  /** Its "point in time" qualifier (P585), as a year. */
  year: string | null;
}

/** An item's claims by property ("P11688") and its English label. */
export interface WikidataEntity {
  id: string;
  label: string | null;
  claims: Map<string, WikidataValue[]>;
}

export class WikidataError extends Error {}

/**
 * Wikidata, for Roots (D165): a game's identifiers on reference sites (MobyGames, GameFAQs...), each site's link format
 * ("formatter URL", P1630), and the awards the game received (P166). Asked politely, as Wikimedia asks: Squirrelcade's
 * User-Agent, at most a request a second, 50 items at a time.
 */
export class WikidataClient {
  private last = 0;

  constructor(
    private readonly fetchImpl: FetchLike = (url, init) => fetch(url, init),
    private readonly minIntervalMs = 1000,
    private readonly endpoint = 'https://www.wikidata.org/w/api.php',
  ) {}

  private async api(params: Record<string, string>, attempt = 1): Promise<Record<string, unknown>> {
    const wait = this.last + this.minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.last = Date.now();
    const url = `${this.endpoint}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', maxlag: '5' })}`;
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        headers: { 'User-Agent': `Squirrelcade/${APP_VERSION} (+https://github.com/squirrelcade/squirrelcade; self-hosted game collection app)`, 'Api-User-Agent': `Squirrelcade/${APP_VERSION}` },
      });
    } catch (err) {
      throw new WikidataError(`Couldn't reach Wikidata: ${err instanceof Error ? err.message : String(err)}`);
    }
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const after = Number.parseInt(res.headers.get('retry-after') ?? '', 10);
      await new Promise((r) => setTimeout(r, (Number.isFinite(after) ? Math.min(after, 60) : 5 * attempt) * 1000));
      return this.api(params, attempt + 1);
    }
    if (!res.ok) throw new WikidataError(`Wikidata answered ${res.status}`);
    const body = (await res.json()) as Record<string, unknown> & { error?: { code?: string; info?: string } };
    if (body.error?.code === 'maxlag' && attempt < 4) {
      await new Promise((r) => setTimeout(r, 5000 * attempt));
      return this.api(params, attempt + 1);
    }
    if (body.error) throw new WikidataError(body.error.info ?? body.error.code ?? 'Wikidata returned an error');
    return body;
  }

  /** Items' (or properties') claims and English labels, 50 at a time. Missing ids are left out. */
  async entities(ids: readonly string[]): Promise<Map<string, WikidataEntity>> {
    const out = new Map<string, WikidataEntity>();
    const unique = [...new Set(ids.filter((id) => /^[QP]\d+$/.test(id)))];
    for (let i = 0; i < unique.length; i += 50) {
      const batch = unique.slice(i, i + 50);
      type Snak = { datavalue?: { value?: unknown } };
      type Claim = { mainsnak?: Snak; qualifiers?: Record<string, Snak[]>; rank?: string };
      type Entity = { id?: string; missing?: string; labels?: { en?: { value?: string } }; claims?: Record<string, Claim[]> };
      const body = (await this.api({ action: 'wbgetentities', ids: batch.join('|'), props: 'claims|labels', languages: 'en' })) as { entities?: Record<string, Entity> };
      for (const [id, e] of Object.entries(body.entities ?? {})) {
        if (e.missing !== undefined) continue;
        const claims = new Map<string, WikidataValue[]>();
        for (const [prop, list] of Object.entries(e.claims ?? {})) {
          const values: WikidataValue[] = [];
          for (const c of list) {
            if (c.rank === 'deprecated') continue;
            const v = c.mainsnak?.datavalue?.value;
            const value = typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String((v as { id: unknown }).id) : null;
            if (!value) continue;
            const when = c.qualifiers?.P585?.[0]?.datavalue?.value as { time?: string } | undefined;
            values.push({ value, year: when?.time ? (/^[+-](\d{4})/.exec(when.time)?.[1] ?? null) : null });
          }
          if (values.length > 0) claims.set(prop, values);
        }
        out.set(id, { id, label: e.labels?.en?.value ?? null, claims });
      }
    }
    return out;
  }
}
