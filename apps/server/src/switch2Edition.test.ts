import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { consoleEditionIn, ITEM_MATCH, KNOWN_PLATFORMS, orderItemScore, productPlatform, withoutConsoleEdition } from '@squirrelcade/core';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';

// Made-up barcodes, as a barcode service names the boxes.
const PRODUCTS: Record<string, string> = {
  '850000000011': 'Hollow Knight - Nintendo Switch 2 Edition',
  '850000000012': 'Hollow Knight: Silksong - Nintendo Switch 2 Edition',
  '850000000013': 'Spider-Man - PlayStation 4',
};

let g: TestApp;
let cookies: Record<string, string>;
beforeEach(async () => {
  g = await testApp({ productNameLookup: async (code) => PRODUCTS[code] ?? null });
  cookies = await setUp(g);
  // A made-up collection: the first game on the Switch, its sequel on the Switch 2. The Switch 2's catalog has the
  // sequel's Switch 2 Edition and not the first game's.
  seedCatalogs(g, {
    owned: [
      ['1', 'Hollow Knight', 'Nintendo Switch'],
      ['2', 'Hollow Knight: Silksong', 'Nintendo Switch 2'],
    ],
    catalogs: {
      'playstation-4': ['Hollow Knight', "Marvel's Spider-Man"],
      'nintendo-switch': ['Hollow Knight', 'Hollow Knight: Silksong'],
      'nintendo-switch-2': ['Hollow Knight: Silksong - Nintendo Switch 2 Edition', 'Xenoblade Chronicles 3 - Nintendo Switch 2 Edition', 'Mario Kart World'],
      playstation: ['Spider-Man'],
    },
  });
});
afterEach(async () => {
  await g.cleanup();
});

const scan = async (code: string) => (await g.app.inject({ url: `/api/v1/lookup/barcode/${code}`, cookies })).json();
const answers = (r: { results: { platformKey: string; title: string }[] }) => r.results.map((x) => `${x.platformKey}|${x.title}`);

describe("a console's own edition (Nintendo Switch 2 Edition)", () => {
  it('reads the console from the edition, and leaves its words out of the title', () => {
    expect(productPlatform('Hollow Knight - Nintendo Switch 2 Edition')).toBe('nintendo-switch-2');
    expect(productPlatform('Hollow Knight Switch 2 Edition')).toBe('nintendo-switch-2');
    expect(consoleEditionIn('Hollow Knight - Nintendo Switch 2 Edition', KNOWN_PLATFORMS)).toEqual({ platformKey: 'nintendo-switch-2', title: 'Hollow Knight' });
    expect(consoleEditionIn('Hades II [Switch 2 Edition]', KNOWN_PLATFORMS)).toEqual({ platformKey: 'nintendo-switch-2', title: 'Hades II' });
    expect(consoleEditionIn('Minecraft: Xbox 360 Edition', KNOWN_PLATFORMS)).toEqual({ platformKey: 'xbox-360', title: 'Minecraft' });
    expect(withoutConsoleEdition('Hollow Knight: Silksong - Nintendo Switch™ 2 Edition')).toBe('Hollow Knight: Silksong');
    expect(withoutConsoleEdition('Kirby and the Forgotten Land - Nintendo Switch 2 Edition + Star-Crossed World')).toBe('Kirby and the Forgotten Land + Star-Crossed World');
    // Not a console's edition, or a console's name that is the game's own: unchanged.
    expect(withoutConsoleEdition('Just Dance 2016: Gold Edition')).toBe('Just Dance 2016: Gold Edition');
    expect(withoutConsoleEdition('Nintendo Switch Sports')).toBe('Nintendo Switch Sports');
  });

  it("doesn't take another game of the series for an item because both are Switch 2 Editions", () => {
    const item = 'Hollow Knight - Nintendo Switch 2 Edition - Nintendo Switch 2';
    expect(orderItemScore(item, 'Hollow Knight: Silksong - Nintendo Switch 2 Edition')).toBeLessThan(ITEM_MATCH);
    expect(orderItemScore(item, 'Hollow Knight')).toBe(1);
    expect(orderItemScore('Xenoblade Chronicles 2 - Nintendo Switch 2 Edition', 'Xenoblade Chronicles 3 - Nintendo Switch 2 Edition')).toBeLessThan(ITEM_MATCH);
    expect(orderItemScore('Xenoblade Chronicles 3 - Nintendo Switch 2 Edition', 'Xenoblade Chronicles 3 - Nintendo Switch 2 Edition')).toBe(1);
  });

  it('answers a scanned Switch 2 Edition with the first game on the Switch 2, before its sequel and the other consoles', async () => {
    const hollow = await scan('850000000011');
    expect(hollow).toMatchObject({ platformKey: 'nintendo-switch-2', searchedFor: 'Hollow Knight' });
    expect(hollow.results[0]).toMatchObject({ platformKey: 'nintendo-switch-2', platform: 'Nintendo Switch 2', title: 'Hollow Knight', answer: 'need', ownedOn: ['Nintendo Switch'] });
    // The sequel is still offered, after it; the PS4's and the Switch's come later.
    const list = answers(hollow);
    expect(list.indexOf('nintendo-switch-2|Hollow Knight: Silksong - Nintendo Switch 2 Edition')).toBeGreaterThan(0);
    expect(list.indexOf('playstation-4|Hollow Knight')).toBeGreaterThan(0);
    // The sequel's own Switch 2 Edition is still the sequel.
    expect((await scan('850000000012')).results[0]).toMatchObject({ platformKey: 'nintendo-switch-2', title: 'Hollow Knight: Silksong - Nintendo Switch 2 Edition', answer: 'own' });
    // A console's game that only shares the name's words, not as a sequel, still answers as before.
    expect((await scan('850000000013')).results[0]).toMatchObject({ platformKey: 'playstation-4', title: "Marvel's Spider-Man" });
  });

  it('puts a Switch 2 Edition bought on the way as the first game on the Switch 2, not its sequel', () => {
    const said = g.orders.recordOnTheWay({ title: 'Hollow Knight - Nintendo Switch 2 Edition', platform: 'Nintendo Switch 2', store: 'A shop', orderDate: '2026-05-28', priceCents: 3900 });
    expect(said.status).toBe('added');
    expect(said.item).toMatchObject({ platformKey: 'nintendo-switch-2', title: 'Hollow Knight', orderDate: '2026-05-28', itemCents: 3900 });
    expect(g.orders.gameOf('Hollow Knight: Silksong - Nintendo Switch 2 Edition - Nintendo Switch 2')).toEqual({ platformKey: 'nintendo-switch-2', title: 'Hollow Knight: Silksong - Nintendo Switch 2 Edition' });
  });

  it("answers with the console's own entry once its catalog has the edition", async () => {
    const added = await g.app.inject({ method: 'POST', url: '/api/v1/catalogs/nintendo-switch-2/entries', cookies, payload: { title: 'Hollow Knight - Nintendo Switch 2 Edition' } });
    expect(added.statusCode).toBe(201);
    const hollow = await scan('850000000011');
    expect(hollow.results[0]).toMatchObject({ platformKey: 'nintendo-switch-2', title: 'Hollow Knight - Nintendo Switch 2 Edition', entryId: added.json().id });
    expect(g.orders.gameOf('Hollow Knight - Nintendo Switch 2 Edition - Nintendo Switch 2')).toEqual({ platformKey: 'nintendo-switch-2', title: 'Hollow Knight - Nintendo Switch 2 Edition' });
    // Linked to it, the barcode answers with it.
    await g.app.inject({ method: 'POST', url: '/api/v1/barcodes', cookies, payload: { code: '850000000011', platformKey: 'nintendo-switch-2', title: 'Hollow Knight - Nintendo Switch 2 Edition' } });
    expect(await scan('850000000011')).toMatchObject({ known: true, results: [{ platformKey: 'nintendo-switch-2', title: 'Hollow Knight - Nintendo Switch 2 Edition' }] });
  });
});
