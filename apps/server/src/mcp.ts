import { dayIn } from '@squirrelcade/core';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { CallToolResult, JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { FastifyInstance } from 'fastify';
import type { Logger } from 'pino';
import { personLabel, type AiAuthService, type AiCaller } from './aiAuth.js';
import { aiViewOf, AiToolError, askedOf, CHECK_INPUT, CHECK_OUTPUT, GAME_INPUT, GAME_OUTPUT, PLATFORMS_OUTPUT, SEARCH_INPUT, SEARCH_OUTPUT, WISHLIST_INPUT, WISHLIST_OUTPUT, type AiTools } from './aiTools.js';
import type { Db } from './db/index.js';
import { aiCalls } from './db/schema.js';
import { APP_VERSION } from './env.js';
import type { SettingsService } from './settings.js';

/**
 * The connector itself (0.55.0, D127): Streamable HTTP at /mcp, stateless (a fresh MCP server for each request, plain
 * JSON answers), for a bearer token from Squirrelcade's own sign-in (aiAuth.ts). Read-only tools; each call counted
 * against the person's limits (Settings › Claude and AI apps) and kept in the list of calls.
 */

/** Calls per person per minute and per day, kept in memory (a restart starts them over). */
class CallLimits {
  private minute = new Map<string, { n: number; resetAt: number }>();
  private day = new Map<string, { n: number; day: string }>();

  /** Counts a call; past a limit, what to tell the app instead. */
  take(who: string, perMinute: number, perDay: number, today: string): string | null {
    const now = Date.now();
    const m = this.minute.get(who);
    if (!m || m.resetAt <= now) this.minute.set(who, { n: 1, resetAt: now + 60_000 });
    else if (++m.n > perMinute) return `Too many requests: ${perMinute} a minute is the limit here. Try again in ${Math.ceil((m.resetAt - now) / 1000)} seconds.`;
    const d = this.day.get(who);
    if (!d || d.day !== today) this.day.set(who, { n: 1, day: today });
    else if (++d.n > perDay) return `Too many requests today: ${perDay} a day is the limit here. Try again tomorrow.`;
    return null;
  }
}

/** Answers past this are refused with advice to ask for less (Claude takes up to about 150,000 characters). */
const MAX_ANSWER = 120_000;

export interface McpDeps {
  db: Db;
  settings: SettingsService;
  log: Logger;
}

/** The MCP server for one request, its tools answering as the caller sees the collection. */
function buildServer(caller: AiCaller, tools: AiTools, deps: McpDeps, limits: CallLimits): McpServer {
  const { settings, db, log } = deps;
  const instance = settings.get('general.instanceName') || 'Squirrelcade';
  const currency = settings.get('general.currency');
  const server = new McpServer(
    { name: 'squirrelcade', title: instance, version: APP_VERSION },
    {
      instructions: `${instance}: one person's video game collection in Squirrelcade (consoles, and the PC library), read-only. check_ownership answers "do I have it?" for up to 50 titles at once: it reads editions, subtitles, franchise names and spellings, gives each match a confidence (0.85 and up counts as the same game) and lists near misses. search_games browses and filters (console, physical or digital, storefront, condition); get_game gives one game's copies; list_platforms gives the consoles and their keys. get_wishlist gives the Acorns wishlist: acorns are how much the owner wants a game they don't have yet (0 to 100, from their own rules; games they have have none), with the rules behind them; a title gives one game's acorns, and the main list is ordered by list_acorns (acorns minus the variety in the top picks). Money is in cents (${currency}).`,
    },
  );
  const view = aiViewOf(caller.person, settings);
  const who = personLabel(caller.person);
  // Limits per key, and per person signed in.
  const personKey = caller.keyId !== null ? `key:${caller.keyId}` : caller.person.kind === 'account' ? `account:${caller.person.userId}` : `guest:${caller.person.guestId}`;

  const run = <T extends Record<string, unknown>>(tool: string, asked: string | null, answer: () => T, count: (r: T) => number): CallToolResult => {
    const started = Date.now();
    const record = (outcome: 'ok' | 'error' | 'limited', results: number | null) => {
      const ms = Date.now() - started;
      db.insert(aiCalls).values({ at: new Date().toISOString(), grantId: caller.grantId, keyId: caller.keyId, who, client: caller.client.name, tool, asked, results, ms, outcome }).run();
      log.info({ context: 'ai', who, app: caller.client.name, tool, outcome, results, ms }, `${who} (${caller.client.name}): ${tool}${asked ? ` "${asked}"` : ''}, ${outcome}${results !== null ? `, ${results} found` : ''}`);
    };
    const limited = limits.take(personKey, settings.get('ai.callsPerMinute'), settings.get('ai.callsPerDay'), dayIn(settings.get('general.timeZone')));
    if (limited) {
      record('limited', null);
      return { isError: true, content: [{ type: 'text', text: limited }] };
    }
    try {
      const result = answer();
      const text = JSON.stringify(result);
      if (text.length > MAX_ANSWER) {
        record('error', null);
        return { isError: true, content: [{ type: 'text', text: 'That answer is too long to send. Ask for fewer titles or a smaller page (limit).' }] };
      }
      record('ok', count(result));
      return { structuredContent: result, content: [{ type: 'text', text }] };
    } catch (err) {
      if (err instanceof AiToolError) {
        record('error', null);
        return { isError: true, content: [{ type: 'text', text: err.message }] };
      }
      record('error', null);
      throw err;
    }
  };

  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool(
    'check_ownership',
    {
      title: 'Check whether games are in the collection',
      description:
        'Whether each title is in the collection, and how sure: owned (a match at 0.85 or more), subscription (only through Game Pass or the like), possible (only near misses) or not_owned. Reads editions ("Director\'s Cut", "[Greatest Hits]"), generic subtitles ("The Video Game"), franchise names ("Tom Clancy\'s"), punctuation and spelling; a different number is a different game. With platforms, ownership on other consoles comes apart (elsewhere). A game not owned comes with its wishlist places (acorns: how much the owner wants it).',
      inputSchema: CHECK_INPUT,
      outputSchema: CHECK_OUTPUT,
      annotations: { title: 'Check ownership', ...readOnly },
    },
    async ({ titles, platforms }) =>
      run(
        'check_ownership',
        titles
          .slice(0, 3)
          .map((t) => askedOf(t))
          .join(', ') + (titles.length > 3 ? ` (+${titles.length - 3})` : ''),
        () => tools.check({ titles, platforms }, view),
        (r) => r.results.filter((x) => x.status === 'owned').length,
      ),
  );

  server.registerTool(
    'search_games',
    {
      title: 'Search the collection',
      description:
        'Games in the collection by words of their title, the best matches first, a page at a time (next_cursor). Filters: a console (key, name or short name, or "PC"), physical or digital, a PC storefront, a condition (sealed, complete, loose, graded). With no query, lists what the filters keep, by title. Each game has an id for get_game.',
      inputSchema: SEARCH_INPUT,
      outputSchema: SEARCH_OUTPUT,
      annotations: { title: 'Search games', ...readOnly },
    },
    async (input) =>
      run(
        'search_games',
        [input.query ? askedOf(input.query) : null, input.platform, input.format, input.storefront, input.condition].filter(Boolean).join(', ') || null,
        () => tools.search(input, view),
        (r) => r.total,
      ),
  );

  server.registerTool(
    'get_game',
    {
      title: 'One game in detail',
      description:
        'One game (an id from search_games or check_ownership): its copies on each console with their condition (sealed, box, manual, region, grading) and market value, its PC storefronts and how each is held, digital licenses claimed with discs, IGDB reviews and its Top 100 place.',
      inputSchema: GAME_INPUT,
      outputSchema: GAME_OUTPUT,
      annotations: { title: 'Get game', ...readOnly },
    },
    async ({ id }) =>
      run(
        'get_game',
        id.slice(0, 40),
        () => tools.game({ id }, view),
        (r) => r.entries.length,
      ),
  );

  server.registerTool(
    'get_wishlist',
    {
      title: 'The Acorns wishlist',
      description:
        "The owner's wishlist (Acorns wishlist), best first: games they don't have yet, each with its acorns (how much the owner wants it, 0 to 100, from their own rules), its priority (High, Medium or Low), its place on the main list, and the rules that gave it the most acorns. The main list is ordered by list_acorns: acorns minus the variety in the top picks (games of the same console or series above), so it mixes consoles and series. With a query (title words), one game's acorns and why, on each console; with a console, that console's whole list; with a priority, only those. A page at a time (next_cursor). Games the owner has have no acorns: check_ownership says what's owned.",
      inputSchema: WISHLIST_INPUT,
      outputSchema: WISHLIST_OUTPUT,
      annotations: { title: 'Get wishlist', ...readOnly },
    },
    async (input) =>
      run(
        'get_wishlist',
        [input.query ? askedOf(input.query) : null, input.platform, input.priority].filter(Boolean).join(', ') || null,
        () => tools.wishlist(input),
        (r) => r.total,
      ),
  );

  server.registerTool(
    'list_platforms',
    {
      title: 'The consoles in the collection',
      description: 'Each console with games: its key, name, maker, short names, and how many games and copies (sealed, complete) and their value; the PC storefronts with their games; the totals.',
      outputSchema: PLATFORMS_OUTPUT,
      annotations: { title: 'List platforms', ...readOnly },
    },
    async () =>
      run(
        'list_platforms',
        null,
        () => tools.platforms(view),
        (r) => r.platforms.length,
      ),
  );

  return server;
}

/**
 * The tools' schemas in MCP's own dialect, JSON Schema 2020-12 (the default since the 2025-11-25 spec): the SDK's converter
 * marks each one draft-07 ("$schema"), and a client that validates with 2020-12 then refuses every answer (Cowork did,
 * 0.59.0). Without the mark the default applies; what the schemas use reads the same in both.
 */
export function withDefaultDialect(message: JSONRPCMessage): JSONRPCMessage {
  const result = (message as { result?: { tools?: unknown } }).result;
  if (!result || !Array.isArray(result.tools)) return message;
  const plain = (schema: unknown) => {
    if (!schema || typeof schema !== 'object') return schema;
    const { $schema: _dialect, ...rest } = schema as Record<string, unknown>;
    return rest;
  };
  const tools = (result.tools as Record<string, unknown>[]).map((t) => ({ ...t, inputSchema: plain(t.inputSchema), ...(t.outputSchema ? { outputSchema: plain(t.outputSchema) } : {}) }));
  return { ...message, result: { ...result, tools } } as JSONRPCMessage;
}

/** /mcp: the bearer check first (a 401 tells the app where to sign in), then the MCP request. */
export function registerMcpRoute(app: FastifyInstance, ai: AiAuthService, tools: AiTools, deps: McpDeps): void {
  const limits = new CallLimits();
  app.all('/mcp', async (request, reply) => {
    if (!ai.on()) return reply.code(404).send({ error: 'not-found', message: 'AI apps are off (Settings › Claude and AI apps).' });
    const origin = request.headers.origin;
    if (origin !== undefined) {
      // Browser pages: only this Squirrelcade's own, the allowed apps' and (when allowed) ones on this computer.
      if (!ai.originAllowed(origin)) return reply.code(403).send({ error: 'forbidden', message: 'Requests from that page are not accepted.' });
      for (const [k, v] of Object.entries(ai.corsHeaders(origin))) reply.raw.setHeader(k, v);
    }
    if (request.method === 'OPTIONS') return reply.code(204).send();
    const caller = ai.caller(request.headers.authorization, request);
    if ('status' in caller) {
      if (caller.message) return reply.code(caller.status).header('Cache-Control', 'no-store').send({ error: 'forbidden', error_description: caller.message });
      return reply
        .code(caller.status)
        .header('WWW-Authenticate', ai.challenge(caller.error))
        .header('Cache-Control', 'no-store')
        .send({ error: caller.error?.code ?? 'unauthorized', error_description: caller.error?.description ?? 'Sign in first: this connector needs an access token.' });
    }
    if (request.method !== 'POST') return reply.code(405).header('Allow', 'POST, OPTIONS').send({ error: 'method_not_allowed', message: 'This connector answers POST (stateless Streamable HTTP).' });
    const server = buildServer(caller, tools, deps, limits);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    const send = transport.send.bind(transport);
    transport.send = (message, options) => send(withDefaultDialect(message), options);
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(request.raw, reply.raw, request.body);
    } catch (err) {
      request.log.error({ err, context: 'ai' }, 'An MCP request failed');
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { 'Content-Type': 'application/json' });
        reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
      }
    }
  });
}
