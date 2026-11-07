import { afterEach, describe, expect, it } from 'vitest';
import { setUp, testApp, type TestApp } from './test-helpers.js';

let g: TestApp;
afterEach(async () => {
  await g?.cleanup();
});

type Line = { key: string; light: string; says: string; check: string | null; settings: string; help: string };

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

    // A plain-http address works, with a yellow note about Store Mode offline.
    g.settings.update({ 'general.publicUrl': 'http://games.example.com' });
    expect((await lines()).find((l) => l.key === 'https')).toMatchObject({ light: 'yellow' });
  });
});
