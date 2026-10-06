import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { exportCsv, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterAll(async () => {
  await g?.cleanup();
});

/** Every route in the server's source ("app.get('/api/v1/...')"), as the route coverage finds them. */
const routes: { method: string; path: string; file: string }[] = [];
for (const f of readdirSync(__dirname).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
  const text = readFileSync(join(__dirname, f), 'utf8');
  for (const m of text.matchAll(/app\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) routes.push({ method: m[1]!.toUpperCase(), path: m[2]!, file: f });
}
/** Calls that would end the test's own access (its session, its API key), or start over. */
const SKIP = [/\/auth\/logout$/, /\/auth\/password$/, /\/auth\/apikey$/, /\/auth\/sessions/, /\/setup$/];

describe('bad input', () => {
  it('gets an answer that says what was wrong (4xx), never a failure (5xx), from every route', async () => {
    g = await testApp({ features: ['igdb', 'history', 'pc', 'romm', 'itad', 'mail', 'retroachievements', 'xbox', 'playstation', 'steam'] });
    const cookies = await setUp(g);
    g.collection.importText(exportCsv([['11', 'Okami', 'Playstation 2', 1500, 'Item Only'], ['12', 'Journey', 'Playstation 3', 900]]), { fileName: 'collection.csv', source: 'upload' });
    const { apiKey } = (await g.app.inject({ url: '/api/v1/auth/apikey', cookies })).json() as { apiKey: string };
    const headers = { 'x-api-key': apiKey };
    const params = ['abc', '0', '-1', '99999999', '1.5', 'caf%C3%A9', '%20', '1'];
    const queries = ['', '?page=abc&pageSize=-5&q=%25_&sort=zzz&dir=x&platform=zzz&limit=abc&year=abc&month=13&from=abc&to=abc&days=abc&kind=zzz&marketplace=zzz&id=abc&title=&platformKey=zzz&format=zzz&achievements=zzz'];
    const bodies: unknown[] = [
      undefined,
      {},
      [],
      { a: 1 },
      'text',
      42,
      { id: 'x', ids: 'x', title: 5, platformKey: 5, platform: 5, completeness: 5, costCents: 'x', soldCents: -1, answer: 'x', kind: 5, name: 5, value: {}, key: 5, text: 5, url: 5, code: 5, status: 5, rating: 'x', note: 5, notes: 5, tags: 'x', location: 5, days: 'x', settings: 'x' },
      { ids: [1, 'x', null], title: 'x'.repeat(10000), platformKey: 'playstation-2', completeness: 'loose', costCents: 1e20, datePurchased: '2026-13-45' },
    ];
    const failures: string[] = [];
    let calls = 0;
    for (const r of routes) {
      if (SKIP.some((s) => s.test(r.path))) continue;
      for (const p of r.path.includes(':') ? params : ['']) {
        const path = r.path.replace(/:[a-zA-Z]+/g, p);
        for (const q of queries) {
          for (const body of r.method === 'GET' ? [undefined] : bodies) {
            const res = await g.app.inject({
              method: r.method as 'GET',
              url: path + q,
              headers: { ...headers, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
              payload: body === undefined ? undefined : JSON.stringify(body),
            });
            calls++;
            if (res.statusCode >= 500) {
              // The error behind it, from the log.
              const log = (await g.app.inject({ url: '/api/v1/system/logs?limit=1&level=error', headers })).body.slice(0, 500);
              failures.push(`${r.method} ${path + q} ${JSON.stringify(body)?.slice(0, 80)}: ${res.statusCode} (${r.file}) ${log}`);
            }
          }
        }
      }
    }
    expect(routes.length).toBeGreaterThan(200);
    expect(calls).toBeGreaterThan(5000);
    expect(failures).toEqual([]);
  }, 120_000);
});
