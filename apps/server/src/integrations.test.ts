import { afterEach, describe, expect, it } from 'vitest';
import { setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g?.cleanup();
});

type Line = { key: string; light: string; says: string; check: string | null; settings: string; help: string; notNeeded?: boolean };

describe("the integrations' lights (T-202)", () => {
  it('shows every outside part, off ones grey; a failing one red first with what went wrong, and Health points to it', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    const lines = async () => (await g.app.inject({ url: '/api/v1/system/integrations', cookies })).json().lines as Line[];
    // A fresh install: nothing set up, every light grey (all of them optional).
    let all = await lines();
    expect(all.map((l) => l.key)).toEqual(expect.arrayContaining(['igdb', 'mailbox', 'notifications', 'romm', 'youtube', 'playstation', 'wikipedia', 'magazines', 'backups', 'https']));
    expect(all.find((l) => l.key === 'romm')).toMatchObject({ light: 'grey', check: null, settings: '/settings/sources', help: 'integrations#romm' });
    // Backups run on their own schedule: on, not run yet (yellow until the first one).
    expect(all.find((l) => l.key === 'backups')).toMatchObject({ light: 'yellow', check: 'backup' });

    // The magazines folder, on and locked: the night's scan fails, and its light turns red with the reason.
    g.settings.update({ 'features.magazines': true, 'magazines.folder': '/nowhere/at/all' });
    g.tasks.register({ name: 'magazines-scan', title: 'Read the magazines folder', description: '', interval: () => 86_400_000, run: async () => { throw new Error("Squirrelcade can't open the magazines folder"); } });
    await g.tasks.runNow('magazines-scan');
    all = await lines();
    expect(all[0]).toMatchObject({ key: 'magazines', light: 'red', check: 'magazines-scan' });
    expect(all[0]!.says).toMatch(/can't open the magazines folder/);
    const status = (await g.app.inject({ url: '/api/v1/system/status', cookies })).json();
    expect(status.health[0]).toEqual({ level: 'error', message: '1 integration needs you: see Integrations below.' });

    // A part without a task of its own is its own check: an https address green, a plain-http one yellow.
    g.settings.update({ 'general.publicUrl': 'https://games.example.com' });
    expect((await lines()).find((l) => l.key === 'https')).toMatchObject({ light: 'green', check: null });
    g.settings.update({ 'general.publicUrl': 'http://games.example.com' });
    expect((await lines()).find((l) => l.key === 'https')).toMatchObject({ light: 'yellow' });
    expect((await lines()).find((l) => l.key === 'barcodes')).toMatchObject({ light: 'green' });
  });

  it('exchange rates and the AI model say what they do: on for purchases in pounds; a helper of your own counts (2026-11-07)', async () => {
    g = await testApp();
    const cookies = await setUp(g);
    const line = async (key: string) => ((await g.app.inject({ url: '/api/v1/system/integrations', cookies })).json().lines as Line[]).find((l) => l.key === key)!;
    // On the way turns a purchase in another currency into yours (on to start): green, saying so.
    let rates = await line('rates');
    expect(rates).toMatchObject({ light: 'green', settings: '/settings/email' });
    expect(rates.says).toMatch(/pounds\) gets its price paid in USD/);
    // Turned off, with prices in dollars: grey because nothing needs it, so its link says Settings, not Set it up.
    g.settings.update({ 'orders.exchangeRates': false });
    rates = await line('rates');
    expect(rates).toMatchObject({ light: 'grey', notNeeded: true });
    expect(rates.says).toMatch(/^Not needed/);
    // The AI model: optional and not set up.
    let ai = await line('ai-model');
    expect(ai).toMatchObject({ light: 'grey', notNeeded: false });
    expect(ai.says).toMatch(/^Optional, not set up/);
    // Set to a helper of your own: red while none asks for work, green once one does.
    g.settings.update({ 'sources.visionApi': 'helper' });
    expect(await line('ai-model')).toMatchObject({ light: 'red' });
    expect((await g.app.inject({ url: '/api/v1/helper/next?wait=0', cookies })).statusCode).toBe(204);
    ai = await line('ai-model');
    expect(ai).toMatchObject({ light: 'green' });
    expect(ai.says).toMatch(/helper of your own answers/);
  });
});

