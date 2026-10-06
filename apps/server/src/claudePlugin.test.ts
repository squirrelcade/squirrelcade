import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { pluginAddress, RELAY_SOURCE } from './claudePlugin.js';
import { seedCatalogs, setUp, testApp, type TestApp } from './test-helpers.js';
import { readZip } from './zip.js';

let g: TestApp;
let cookies: Record<string, string>;
const relays: { child: ChildProcessWithoutNullStreams; dir: string }[] = [];

beforeEach(async () => {
  g = await testApp();
  cookies = await setUp(g);
  seedCatalogs(g, { owned: [['1', 'Cars 2: The Video Game', 'Playstation 3']], catalogs: { 'playstation-3': ['Cars 2: The Video Game'] } });
  g.settings.update({ 'ai.enabled': true });
});
afterEach(async () => {
  for (const r of relays.splice(0)) {
    r.child.kill();
    rmSync(r.dir, { recursive: true, force: true });
  }
  await g.cleanup();
});

/** The plugin's relay, started as Claude Code or Cowork starts it: node with the address and key in its environment. */
function startRelay(env: { SQUIRRELCADE_URL: string; SQUIRRELCADE_KEY: string }) {
  const dir = mkdtempSync(join(tmpdir(), 'sq-relay-'));
  const file = join(dir, 'relay.mjs');
  writeFileSync(file, RELAY_SOURCE);
  const child = spawn(process.execPath, [file], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  relays.push({ child, dir });
  const waiting = new Map<number, (m: { id: number; result?: any; error?: { message: string } }) => void>();
  createInterface({ input: child.stdout }).on('line', (line) => {
    const m = JSON.parse(line);
    waiting.get(m.id)?.(m);
  });
  const ask = (id: number, method: string, params?: unknown) =>
    new Promise<{ id: number; result?: any; error?: { message: string } }>((resolve) => {
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const tell = (method: string) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { ask, tell };
}
const hello = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } };

describe('the plugin for Claude Code and Cowork', () => {
  it('is a zip with the relay, the address and a new key, and answers through the relay', async () => {
    const res = await g.app.inject({ method: 'POST', url: '/api/v1/ai/plugin', cookies, payload: { address: 'http://192.168.1.20:7575/' } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toBe('attachment; filename="squirrelcade-plugin.zip"');
    const files = new Map(readZip(res.rawPayload).map((e) => [e.name, e.read().toString('utf8')]));
    expect([...files.keys()].sort()).toEqual([
      'squirrelcade/.claude-plugin/plugin.json',
      'squirrelcade/.mcp.json',
      'squirrelcade/README.md',
      'squirrelcade/server/relay.mjs',
      'squirrelcade/skills/game-collection/SKILL.md',
    ]);
    expect(JSON.parse(files.get('squirrelcade/.claude-plugin/plugin.json')!)).toMatchObject({ name: 'squirrelcade', version: expect.stringMatching(/^\d+\.\d+\.\d+$/) });
    const server = JSON.parse(files.get('squirrelcade/.mcp.json')!).mcpServers.squirrelcade;
    expect(server).toMatchObject({ command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server/relay.mjs'], env: { SQUIRRELCADE_URL: 'http://192.168.1.20:7575' } });
    expect(server.env.SQUIRRELCADE_KEY).toMatch(/^sqk_/);
    expect(files.get('squirrelcade/server/relay.mjs')).toBe(RELAY_SOURCE);
    // The key is one of the keys, by its name, and revoked like the others.
    expect((await g.app.inject({ url: '/api/v1/ai/keys', cookies })).json().keys).toEqual([expect.objectContaining({ name: 'Claude plugin (Code and Cowork)' })]);

    // Claude starts the relay; it passes MCP to the connector and back.
    await g.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (g.app.server.address() as AddressInfo).port;
    const relay = startRelay({ SQUIRRELCADE_URL: `http://127.0.0.1:${port}`, SQUIRRELCADE_KEY: server.env.SQUIRRELCADE_KEY });
    const init = await relay.ask(1, 'initialize', hello);
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: expect.stringMatching(/squirrelcade/i) } });
    relay.tell('notifications/initialized');
    const tools = await relay.ask(2, 'tools/list');
    expect(tools.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['check_ownership', 'get_game', 'get_wishlist', 'list_platforms', 'search_games']);
    const check = await relay.ask(3, 'tools/call', { name: 'check_ownership', arguments: { titles: ['Cars 2'] } });
    expect(check.result.structuredContent.results[0]).toMatchObject({ status: 'owned' });
  });

  it('says in words when the key is wrong or Squirrelcade is out of reach', async () => {
    await g.app.listen({ port: 0, host: '127.0.0.1' });
    const port = (g.app.server.address() as AddressInfo).port;
    const wrong = await startRelay({ SQUIRRELCADE_URL: `http://127.0.0.1:${port}`, SQUIRRELCADE_KEY: 'sqk_not-a-key' }).ask(1, 'initialize', hello);
    expect(wrong.error?.message).toMatch(/\S/);
    expect(wrong.result).toBeUndefined();
    const away = await startRelay({ SQUIRRELCADE_URL: 'http://127.0.0.1:1', SQUIRRELCADE_KEY: 'sqk_x' }).ask(1, 'initialize', hello);
    expect(away.error?.message).toContain("can't be reached");
  });

  it('needs an address, the connector on, and the owner', async () => {
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/ai/plugin', cookies, payload: { address: 'not an address' } })).statusCode).toBe(400);
    g.settings.update({ 'ai.enabled': false });
    expect((await g.app.inject({ method: 'POST', url: '/api/v1/ai/plugin', cookies, payload: { address: 'http://nas.local:7575' } })).statusCode).toBe(409);
    expect(pluginAddress('http://10.0.0.5:7575/mcp')).toBe('http://10.0.0.5:7575');
    expect(pluginAddress('https://games.example.com/squirrel/')).toBe('https://games.example.com/squirrel');
    expect(pluginAddress('ftp://x')).toBeNull();
  });
});
