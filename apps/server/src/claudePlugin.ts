import { writeZip } from './zip.js';

/**
 * The plugin for Claude on the owner's computer (0.57.0, D133): Claude Code and Cowork both load a plugin uploaded to the
 * person's Claude account (Customize › Plugins), and a plugin's local MCP server (a command the app starts) runs on that
 * computer, so it reaches Squirrelcade on the home network, where Claude's own servers can't. This one's server is a
 * relay with no dependencies: each MCP message read on stdin goes to this Squirrelcade's connector (POST <address>/mcp,
 * with the plugin's key), and the answer comes back on stdout. Cowork doesn't ask for values when a plugin is installed,
 * so the address and the key are written into the plugin.
 */

/** The relay (Node 18 or later), written into the plugin as server/relay.mjs. No backticks or template expressions in it. */
export const RELAY_SOURCE = String.raw`#!/usr/bin/env node
// Squirrelcade for Claude on this computer: a local MCP server (stdio) that passes each message to your Squirrelcade's
// connector (Streamable HTTP at <address>/mcp) with your key, and its answers back. Claude Code and Cowork start it from
// this plugin. It runs on this computer, so it reaches Squirrelcade on your home network. No dependencies: Node 18 or later.
import { createInterface } from 'node:readline';

const address = String(process.env.SQUIRRELCADE_URL || '').replace(/\/+$/, '');
const key = String(process.env.SQUIRRELCADE_KEY || '');
// The protocol version agreed at initialize (sent with every later request), and a session, if the server gives one.
let protocol = null;
let session = null;
let queue = Promise.resolve();

function write(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

/** A request's error answer, in words for the person; a notification's problem goes to the log. */
function fail(message, text) {
  if (message && message.id !== undefined && message.id !== null) write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: text } });
  else process.stderr.write('squirrelcade: ' + text + '\n');
}

function reason(body, status) {
  try {
    const b = JSON.parse(body);
    const text = b.error_description || b.message || (b.error && b.error.message) || b.error;
    if (typeof text === 'string' && text) return text;
  } catch (err) {
    // Not JSON.
  }
  return 'HTTP ' + status;
}

/** The JSON-RPC messages in an answer: plain JSON (one, or a list) or server-sent events. */
function messagesIn(body, type) {
  if (type.includes('text/event-stream')) {
    const out = [];
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
      if (data.trim()) out.push(JSON.parse(data));
    }
    return out;
  }
  const parsed = JSON.parse(body);
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function send(message) {
  if (!address || !key) return fail(message, "This plugin has no address or key: download it again from Squirrelcade's Settings › Claude and AI apps.");
  const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + key };
  if (protocol) headers['mcp-protocol-version'] = protocol;
  if (session) headers['mcp-session-id'] = session;
  let res;
  try {
    res = await fetch(address + '/mcp', { method: 'POST', headers, body: JSON.stringify(message), redirect: 'manual', signal: AbortSignal.timeout(60000) });
  } catch (err) {
    const why = err && err.name === 'TimeoutError' ? 'no answer in 60 seconds' : (err && err.cause && err.cause.code) || String(err && err.message);
    return fail(message, "Squirrelcade can't be reached at " + address + ' (' + why + '). It answers on your home network only: is this computer at home, and is Squirrelcade running?');
  }
  if (res.status >= 300 && res.status < 400) {
    return fail(message, 'Squirrelcade at ' + address + " answered with a redirect (a sign-in page in the way?): make the plugin again with Squirrelcade's address on your home network.");
  }
  session = res.headers.get('mcp-session-id') || session;
  const body = await res.text();
  if (res.status === 202 || res.status === 204 || !body.trim()) {
    if (!res.ok) fail(message, 'Squirrelcade answered HTTP ' + res.status + '.');
    return;
  }
  let answers;
  try {
    answers = messagesIn(body, res.headers.get('content-type') || '');
  } catch (err) {
    return fail(message, res.ok ? "Squirrelcade sent an answer that isn't MCP." : 'Squirrelcade: ' + reason(body, res.status));
  }
  for (const answer of answers) {
    if (!answer || answer.jsonrpc !== '2.0') {
      fail(message, res.ok ? "Squirrelcade sent an answer that isn't MCP." : 'Squirrelcade: ' + reason(body, res.status));
      continue;
    }
    // An error the server couldn't tie to the request (id null) is the request's.
    if ((answer.id === null || answer.id === undefined) && answer.error && message.id !== undefined) answer.id = message.id;
    if (message.method === 'initialize' && answer.result && answer.result.protocolVersion) protocol = answer.result.protocolVersion;
    write(answer);
  }
}

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
lines.on('line', (line) => {
  if (!line.trim()) return;
  let message;
  try {
    message = JSON.parse(line);
  } catch (err) {
    write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  // One at a time, in order: initialize finishes before anything after it.
  queue = queue.then(() => send(message)).catch((err) => fail(message, 'The Squirrelcade relay failed: ' + String(err && err.message)));
});
lines.on('close', () => {
  queue.then(() => process.exit(0));
});
`;

/** The skill: when Claude should reach for Squirrelcade's tools, and how to read their answers. */
const SKILL = `---
name: game-collection
description: Answer questions about the user's video game collection from their own Squirrelcade. Use when they ask whether they own a game, which games of a list they have (a garage sale, a store shelf, a photo of games), what they have on a console, what's sealed or complete, what a copy is worth, or what's on their wishlist.
---

Squirrelcade is the user's own video game collection manager, running on their home network. Its tools, from the squirrelcade connector, only read:

- \`check_ownership\`: up to 50 titles at once, each with a console if known. Use it for every "do I have..." question and for lists (read the titles from a photo or a page first). It answers owned, possible or not owned, with a confidence, how the titles differ (an edition, a printing), the near misses, and a missing game's place on the wishlist.
- \`search_games\`: the collection by title words, console, physical or digital, PC storefront and condition, a page at a time.
- \`get_game\`: one game's copies: condition, sealed, box, manual, region, grading and value.
- \`get_wishlist\`: the wishlist (the Acorns wishlist), best first: each game's acorns (how much the user wants it, 0 to 100), priority and the rules behind it, for all consoles or one.
- \`list_platforms\`: the consoles, with how many games each has.

Say a game is owned only when the tool says so, and present near misses as maybes. Values are PriceCharting's market values in the collection's currency. When the tools can't be reached, Squirrelcade answers on the user's home network only: say so.
`;

const README = `# Squirrelcade

Your video game collection from your own Squirrelcade, in Claude Code and Cowork on this computer. Ask Claude whether you own a game, which games of a list or a photo you already have, what's sealed on a console, what a copy is worth, or what's on your wishlist.

## How it works

The plugin starts a small relay on this computer (server/relay.mjs, which needs Node.js 18 or later). The relay passes Claude's questions to your Squirrelcade on your home network, with a read-only key, and passes the answers back. Away from home it can't reach Squirrelcade.

## Data

Titles, consoles and filters from your questions go to your own Squirrelcade, and its answers go to Claude. The plugin carries the key that lets it in: the key only reads, works from your home network only (unless Squirrelcade's settings say otherwise), and is revoked on Squirrelcade's Settings › Claude and AI apps.
`;

export interface ClaudePluginInput {
  /** Squirrelcade's address on the home network ("http://192.168.1.20:7575"). */
  address: string;
  key: string;
  version: string;
}

/** The plugin as a zip with one folder, ready for Customize › Plugins › Add › Upload plugin. */
export function claudePluginZip({ address, key, version }: ClaudePluginInput, at = new Date()): Buffer {
  const manifest = {
    name: 'squirrelcade',
    displayName: 'Squirrelcade',
    version,
    description: "Your video game collection from your own Squirrelcade, in Claude Code and Cowork on this computer: do I have it, what's sealed, what's on my wishlist. Read-only.",
    author: { name: 'Squirrelcade', url: 'https://squirrelcade.com' },
    license: 'AGPL-3.0-only',
  };
  const mcp = {
    mcpServers: {
      squirrelcade: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/server/relay.mjs'], env: { SQUIRRELCADE_URL: address, SQUIRRELCADE_KEY: key } },
    },
  };
  const files: [string, string][] = [
    ['.claude-plugin/plugin.json', `${JSON.stringify(manifest, null, 2)}\n`],
    ['.mcp.json', `${JSON.stringify(mcp, null, 2)}\n`],
    ['server/relay.mjs', RELAY_SOURCE],
    ['skills/game-collection/SKILL.md', SKILL],
    ['README.md', README],
  ];
  return writeZip(
    files.map(([name, text]) => ({ name: `squirrelcade/${name}`, data: Buffer.from(text, 'utf8') })),
    at,
  );
}

/** The address a plugin uses: an http(s) address, without a trailing slash or /mcp. */
export function pluginAddress(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const u = new URL(value.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return `${u.origin}${u.pathname.replace(/\/+$/, '').replace(/\/mcp$/, '')}`;
  } catch {
    return null;
  }
}
