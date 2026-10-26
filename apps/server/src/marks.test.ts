import { baseTitle, matchKey } from '@squirrelcade/core';
import { afterEach, describe, expect, it } from 'vitest';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g.cleanup();
});

describe('which consoles each game is yours on, for its marks (D175)', () => {
  it('joins a game across consoles by its title, editions and all, and changes with the collection', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    seedCatalogs(g, {
      owned: [
        ['1', 'Okami', 'PlayStation 2'],
        ['2', 'Okami [Greatest Hits]', 'PlayStation 3'],
        ['3', 'Journey', 'PlayStation 3'],
      ],
      catalogs: { 'playstation-2': ['Okami'], 'playstation-3': ['Okami', 'Journey'] },
    });
    const marks = async () => (await g.app.inject({ url: '/api/v1/marks', cookies })).json().owned as Record<string, string[]>;
    const first = await marks();
    expect(first.okami?.sort()).toEqual(['playstation-2', 'playstation-3']);
    expect(first.journey).toEqual(['playstation-3']);
    const sotc = matchKey(baseTitle('Shadow of the Colossus'));
    expect(first[sotc]).toBeUndefined();
    // A copy added: the next read has it.
    await g.app.inject({ method: 'POST', url: '/api/v1/collection/copies', cookies, payload: { platformKey: 'playstation-2', title: 'Shadow of the Colossus', completeness: 'complete' } });
    expect((await marks())[sotc]).toEqual(['playstation-2']);
  });
});
