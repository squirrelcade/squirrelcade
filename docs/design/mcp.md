# Squirrelcade in Claude: a proposal

Written 2026-10-05, for the owner to decide on. **Approved the same day (all six points, with guests and Claude making the Cloudflare change) and built in 0.55.0 (D127 to D129).** As built, the guide is docs/help/ai-apps.md; the sign-in page for guests behind Access is its own Access application with a one-time PIN for anyone, Squirrelcade letting in only accounts already signed in and the listed guests. **Changed the same evening (D130), on the owner's second thought about exposure:** the default way in is a key for apps on the home network (Claude Code), and the sign-in from the internet described below is an opt-in, off by default; on the owner's install the Cloudflare applications were deleted.

## What it's for

Claude (claude.ai, the desktop and phone apps, Claude Code) reads the collection through a **custom connector**: "do I own Cars 2?", "which of these 30 games from a garage-sale photo don't I have?", "what's sealed on my PS3 shelf?". Read-only: Claude can look, never change anything.

## What the data has today

| Asked about | Where it is | Notes |
|---|---|---|
| **Platform** | `copies.platformId` (a Squirrelcade platform: key, name; the maker's family from core `platformFamily`), plus PriceCharting's `consoleLabel` and `region` | PC games: `pc_games.platforms` (Playnite's list) |
| **Format** (physical/digital) | No field | Console copies are physical (they come from PriceCharting's collection or are added by hand); the PC library is digital. Console digital purchases (PlayStation Store, eShop, Microsoft Store) aren't recorded anywhere. Catalogs know a Switch 2 Game-Key Card (`catalog_entries.format`), copies don't. |
| **Storefront** | `pc_games.storefront` (Playnite's library: Steam, Epic, GOG, Xbox, EA, Ubisoft, Battle.net, Amazon, itch.io...), one row per game per storefront; `pc_audit` says how it's held: permanent, subscription (Game Pass) or historical | Console copies have none. `copies.source` is where the record came from (PriceCharting, a spreadsheet, added in Squirrelcade), not a store. |
| **Edition** | No field: it's in the title, and each edition is its own PriceCharting product (`productId`): "Halo 3 [Limited Edition]", "Mafia III Deluxe Edition" | Core already parses editions (`baseTitle`, `editionBase`, `withoutEditionWords`); `pc_games.familyKey` is the edition-free key shared with console games. |
| **Condition / sealed** | `copies.sealed`, `copies.completeness` (sealed, complete, item-box, item-manual, loose, box-only, manual-only, graded, unknown), `conditionString`, `includeString`, `gradingCompany`, `gradingCertId` | Read from PriceCharting's "New Item, Box, and Manual" style text. |
| **Manual** | `copies.hasManual` (and `hasBox`) | A sealed copy counts as having both. |
| **Disc-to-digital** (Xbox) | **Not recorded** | See "New fields" below. |

## What Claude needs (checked 2026-10-05)

- **Transport:** Streamable HTTP (one endpoint taking POST, and GET for a stream, which a server without one answers 405). The older SSE transport still works in Claude but is on its way out. Sources: [transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [remote MCP in Claude](https://claude.com/docs/connectors/custom/remote-mcp).
- **Protocol:** Claude follows the 2025-03-26, 2025-06-18 and 2025-11-25 revisions; the newest spec (2026-07-28) isn't needed. The official TypeScript SDK (`@modelcontextprotocol/sdk` 1.32.1) speaks 2025-11-25 down to 2024-11-05.
- **Sign-in:** OAuth 2.1 as the MCP authorization spec describes ([authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [Claude's side](https://claude.com/docs/connectors/building/authentication)):
  - The server answers an unsigned request with **401** and `WWW-Authenticate: Bearer resource_metadata="…", scope="…"` (Claude ignores the header on any other status).
  - **Protected Resource Metadata** (RFC 9728) whose `resource` is exactly the URL the user typed; Claude uses only the first authorization server listed.
  - **Authorization Server Metadata** (RFC 8414); PKCE with S256; the `resource` parameter (RFC 8707) and tokens checked against it; `iss` in the redirect (RFC 9207); refresh tokens rotated for public clients; tokens never in a URL and never passed on to another service.
  - **Client registration:** Claude uses a Client ID Metadata Document (its `client_id` is an https URL) when the metadata says `client_id_metadata_document_supported: true` and lists `none` among the token endpoint's auth methods; otherwise Dynamic Client Registration.
  - Claude's callback is `https://claude.ai/api/mcp/auth_callback`; Claude Code's is a loopback address (`http://localhost:<port>/callback` or 127.0.0.1, any port).
  - Discovery, registration and token calls must answer within 10 seconds (refresh within 30); the token endpoint takes form-encoded bodies and answers `invalid_grant` for a bad code or refresh token.
- **Where calls come from:** claude.ai's and the apps' connectors are called from Anthropic's servers (published range 160.79.104.0/21); Claude Code calls from the computer it runs on.
- **Limits:** a tool's result up to about 150,000 characters; a call may take up to 240 seconds. Tools, prompts and resources are supported; text and images in results.
- **Plans:** custom connectors work on Free (one connector), Pro, Max, Team and Enterprise.

## The plan

### Where it lives

Inside the Squirrelcade server, so every install gets it (nothing extra to run), off until the owner turns it on. The connector's address is **Settings > General > Address of this Squirrelcade** (`general.publicUrl`, already there for links in notifications) + `/mcp`; nothing about the address is built in.

- `/mcp`: the SDK's Streamable HTTP transport, **stateless** (a fresh server per request, plain JSON answers, no sessions to keep), behind a bearer-token check. Fastify hands it the raw request.
- Squirrelcade is its own **authorization server**: people sign in with their Squirrelcade account, as they do on the web.

### Sign-in

| Address | What it does | Behind Cloudflare Access? |
|---|---|---|
| `/.well-known/oauth-protected-resource` (and `…/mcp`) | Resource metadata: `resource` = the `/mcp` address, the authorization server, scope `collection:read` | No (Anthropic's servers read it) |
| `/.well-known/oauth-authorization-server` | Server metadata: S256, `client_id_metadata_document_supported: true`, auth methods `none` (+ `client_secret_post`/`basic` for registered clients that ask), `authorization_response_iss_parameter_supported: true`, scopes `collection:read` and `offline_access` | No |
| `/oauth/authorize` and the consent page | Checks the request; the person signs in to Squirrelcade if they aren't; a page says which app wants what ("Claude, returning to claude.ai, wants to **read** your collection: games, copies, conditions; prices paid and notes only if you've let them in") with Allow and Deny | **Yes**: a browser page, so Access stays in front |
| `/oauth/token` | Code for tokens (PKCE checked), refresh (rotated) | No |
| `/oauth/register` | Dynamic registration, only for the allowed callbacks (Claude's, loopback) | No |
| `/oauth/revoke` | A client giving up its token | No |

- **Clients:** a Client ID Metadata Document is fetched only from allowed hosts (a setting, `claude.ai` to start), https only, small, 5-second timeout, cached; its redirect addresses must match exactly (loopback: any port). Registration (for MCP Inspector and anything without a metadata document) is allowed for the same callbacks only.
- **Tokens:** random 256-bit values, stored only as hashes. Access tokens last an hour; refresh tokens 30 days from last use, rotated each time, and a reused one ends the whole connection. Each token is tied to its user, client, scope and the `/mcp` address (a token for anything else is refused). Codes last 10 minutes and work once.
- **Errors:** 401 with the `WWW-Authenticate` header above; 403 `insufficient_scope`; an `Origin` header from a browser page that isn't Squirrelcade's own is refused (DNS rebinding).
- The consent page can't be framed; its Allow is tied to the signed-in session; tokens and codes never reach a log.

### The tools

All read-only (`readOnlyHint`), each with an input and output schema; results are `structuredContent` (with the same JSON as text for older clients).

| Tool | Takes | Gives |
|---|---|---|
| `search_games` | `query`, `platform?` (a key, a name or a short name: PS3, 360, Switch, PC), `format?` (physical/digital), `storefront?` (Steam, Epic, GOG, Xbox...; an addition), `limit?` (20, at most 50), `cursor?` | Games in the collection, best matches first: `id`, title, edition, platform, format, storefronts, copies (count, sealed, complete, loose), reviews; `nextCursor` |
| `check_ownership` | `titles[]` (up to 50), `platforms?` | Per title, in order: `status` (owned / possible / not_owned), the matches with `confidence` and how they matched, `near_misses`, ownership on other platforms ("not on PS4, but on Steam"), and for a game not owned, its wishlist place and acorns (an addition) |
| `get_game` | `id` | One game: every copy (condition, sealed, box, manual, region, graded, market value, added), its storefronts and how they're held (PC), its reviews, Top 100 places; prices paid and notes only when turned on (below); lent out yes/no, never to whom |
| `list_platforms` | | Each platform with games and copies (and sealed, complete counts), its maker's family and key; the PC storefronts with their counts |

Ids are opaque and stable (a console product, or a PC game across its storefronts). Long answers stop at a safe size and give a cursor.

### Title matching

A new core module (`titleMatch.ts`) on top of the existing helpers (`normalizeTitle`, `matchKey`, the edition parsers, `romajiKey`):

1. **Same title, written differently: 1.0.** Case, punctuation, accents, ™ ® ©, quotes and dashes, "&"/"and", a leading "The", Roman numerals and digits (Final Fantasy VII = Final Fantasy 7).
2. **A generic subtitle: 0.95.** "Cars 2" = "Cars 2: The Video Game" (also "The Game", "The Official Game"); a bracketed variant ("[Platinum Hits]").
3. **A franchise name in front: 0.9.** "EndWar" = "Tom Clancy's EndWar" (a short list: Tom Clancy's, Sid Meier's, Disney's, Disney/Pixar, Marvel's, Clive Barker's...).
4. **Another edition: 0.9, marked as such.** "Yakuza 0 Director's Cut" against your "Yakuza 0": owned, "a different edition" (Director's Cut, Game of the Year, Complete, Definitive, Deluxe, Gold, Limited, Collector's...).
5. **Near misses (0.6 to 0.85), never counted as owned:** the same main title with a real subtitle ("Star Wars" against "Star Wars: Battlefront"), a remaster or remake ("Dark Souls Remastered"), words in common. Each says why.
6. **A different number is a different game:** Halo 2 is never Halo 3, FIFA 14 never FIFA 15 (at most 0.4, not listed).

Owned at 0.85 and above; "possible" from 0.6. Unit tests carry the three examples above and the traps (numbers, Star Wars, Cars against Cars 2).

### Who sees what

Every token belongs to one Squirrelcade account or one guest (below), and every answer is that person's view: the owner sees everything; a viewer sees what viewers see on the web (prices paid, notes, the PC library, play, copy details: the existing Security settings). On top of that, prices paid and notes stay out of Claude's answers unless a setting lets them in (off by default, for the owner too): answers leave the install for Anthropic's servers. Who may connect: the owner and viewers (a setting). One collection per install today; when friends' collections come, a tool can take which collection.

### Guests: known by name, no account

Claude never tells a connector who its user is: Anthropic's docs offer OAuth ("each user signs in to your service with their own account"), a key shared by a whole organization ("don't use it to identify which user is calling") or no sign-in. So Squirrelcade learns who is asking only at the sign-in step, and that step needn't be a Squirrelcade account:

- The owner adds a **guest** in Squirrelcade: a name and an email address, and what they see (a viewer's view, or less).
- When the guest connects Claude, they prove the email with a one-time code and approve. Their connection is "Justin (guest)"; every call in the log carries the name; the owner can disconnect or remove them any time. They never get the website.
- The code: where the sign-in page is behind Cloudflare Access, Access sends it (the page gets an Access application of its own that lets anyone prove an email; Squirrelcade checks the email Access signed and lets in only the people already signed in to Squirrelcade and the guests on its list; the rest of the site stays as it is). Without Access, Squirrelcade emails the code itself.
- The sign-in page is a small page of its own (none of the website's files), so a guest who can't open the website can still use it, and it has no password form: someone with an account signs in on the website first.
- It proves the email, not who's typing: a guest who lets someone else use their Claude account still shows as that guest.

### Limits and the log

- Per account: 60 calls a minute and 2,000 a day (settings); over that, the tool answers "too many requests, try again in N seconds". The token and registration addresses: 20 a minute per address.
- Every call goes in a log table: when, who, which app, which tool, how many titles or results, how long, ok or error (not the answers). Kept 90 days; shown in System > Logs ("Claude").
- **Settings > Security > Claude and AI apps:** on/off (off by default), who may connect, allowed client hosts, limits, and the **connected apps**: each with its account, app, callback host, when connected and last used, calls, and **Disconnect**. Deleting an account or changing its password ends its connections.

### Cloudflare (this install)

A second Access application on the same address, **Bypass for everyone**, on `/mcp`, `/.well-known/oauth-protected-resource`, `/.well-known/oauth-authorization-server`, `/oauth/token`, `/oauth/register` and `/oauth/revoke`. Access uses the most specific path, so everything else, `/oauth/authorize` and the consent page included, stays behind the existing application. With guests, a third application on `/oauth/authorize` lets anyone in who proves an email with Cloudflare's one-time code (Squirrelcade decides who gets further). If Bot Fight Mode or a challenge rule is on for the domain, the bypassed paths need a skip, or Anthropic's calls get a challenge page.

### Tests

- Core: the matcher (the examples, the traps, near misses and their order).
- Server: each tool through the SDK's in-memory client on a test collection (console, PC on two storefronts, an edition, a sealed copy, a viewer); sign-in end to end (metadata, 401, registration limits, metadata documents with a mock fetch, PKCE, a reused code, refresh rotation and reuse, the wrong audience, the wrong scope, the rate limit, the log).
- Web: the consent page and the connected apps list in the walkthrough (accessibility included).
- After release: MCP Inspector against the real address (the owner signs in at the consent step), then claude.ai's Add custom connector.

### Docs and release

README: "Use Squirrelcade from Claude" (turn it on, the address, the Access bypass, Add custom connector in claude.ai, what the tools do, disconnecting). Help, API.md, DECISIONS, CHANGELOG, STATUS; the home lab record gets the Access application. One release.

## New fields

- **Sealed, manual, condition:** already there; nothing to add.
- **A digital copy claimed from a disc** (Xbox disc-to-digital, and any game whose disc or code gives a digital license): on each copy's details, `digitalClaim` (unclaimed / claimed / not eligible / unknown, empty by default), `digitalClaimedAt` and `digitalStore` (Xbox, PlayStation, Nintendo, Steam...). Set in the game drawer's copy details, a filter in Collection > Copies. A claimed license outlives the disc: a sold copy whose claim is "claimed" still makes the game owned (digital), and `check_ownership` says so.
- **Format and edition:** no new columns; the tools give `format` (physical copy, digital PC library, claimed license) and `edition` (parsed from the title). If console digital purchases should count, that's a feature of its own (an import of the PlayStation, Nintendo and Microsoft libraries), later.

## For the owner to decide

1. The plan as a whole (inside the Squirrelcade server, its own sign-in, one release).
2. Who can connect: only people already behind Access (the owner today), or also **guests** known by a verified email, with no Squirrelcade account (above).
3. Registration for Claude's and loopback callbacks only (proposed; needed for MCP Inspector and Claude Code), or metadata documents only.
4. Limiting the bypassed paths to Anthropic's addresses (and home) with a Cloudflare rule: not proposed at first (it blocks Claude Code away from home, and the home address changes); OAuth and the limits guard them.
5. The disc-to-digital fields above.
6. The Cloudflare change: the owner makes the Bypass application, or Claude does it in the owner's browser with the owner's OK.
