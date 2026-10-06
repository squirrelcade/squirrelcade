# Claude and AI apps

Claude, and other AI apps that speak MCP (the Model Context Protocol), can read your collection once you connect them. Ask "do I have Cars 2?", paste the titles from a garage-sale photo and ask which ones you don't have, or ask what's sealed on your PS3 shelf. It's read-only: nothing an app asks changes anything.

## Two ways in

- **A key, for Claude on your computers at home:** Claude Code and Cowork with the plugin, or Claude Code alone with a command. Nothing is opened to the internet. This is the one to start with.
- **The sign-in, for Claude's own apps from anywhere (claude.ai, and chats in Claude's desktop and phone apps).** Those call from Anthropic's servers, never from your computer, so Squirrelcade has to be reachable from the internet. It's off until you turn it on.

## Claude Code and Cowork with the plugin

The plugin works in the Claude app's Cowork and Claude Code on your computer, with no command line. It carries a key and a small relay that runs on the computer, so it reaches Squirrelcade on your home network (Claude's own servers can't). The relay needs Node.js 18 or later (nodejs.org).

1. **Settings > Claude and AI apps:** turn on **Let AI apps read your collection** and save.
2. Under **Claude Code and Cowork on your network**, check **Squirrelcade's address on your home network**: the page fills in the address you opened it at, and warns when that's an address on the internet. Then click **Download the plugin**: squirrelcade-plugin.zip lands in your downloads.
3. **In the Claude app:** Customize › Plugins › Add › Upload plugin, and choose squirrelcade-plugin.zip. It's added to your Claude account, so Cowork has it, and Claude Code on your computers gets it at its next session.
4. Start a new Cowork task or Claude Code session, and ask "Do I have Halo 3?"

The plugin's key is listed on the page as "Claude plugin (Code and Cowork)". It's kept in your Claude account with the plugin, and like every key it only reads and works from your home network only: **Revoke** it to switch the plugin off, and download a new plugin to switch it on again (remove the old one in Customize › Plugins first). Away from home, the relay says it can't reach Squirrelcade.

## Claude Code with a command

For Claude Code alone, on a computer with the claude command:

1. **Settings > Claude and AI apps:** turn on **Let AI apps read your collection** and save.
2. Under **Claude Code and Cowork on your network**, check the address, say what the key is for ("Claude Code on the PC") and click **Make a key**. It's shown once, with the command that adds Squirrelcade to Claude Code in every folder:

   `claude mcp add --scope user --transport http squirrelcade http://your-squirrelcade:7575/mcp --header "Authorization: Bearer sqk_..."`

3. Run the command on the computer with Claude Code, then start a new session and ask away.

A key only reads, and answers as the account that made it. It works from your home network only unless **Settings > Claude and AI apps > Keys work from** says otherwise, so a copied key is useless elsewhere. At home Squirrelcade is usually plain http, so the key crosses your home network unencrypted: fine there, never over the internet. **Revoke** ends a key at once. Other MCP apps (a script, another MCP client) send the same header.

## Claude's apps from the internet (optional)

Think it over first: these addresses become reachable by anyone on the internet, guarded only by Squirrelcade's own sign-in (they answer nothing without it, and they're limited per address).

1. **Settings > General > Address of this Squirrelcade:** the https address you reach Squirrelcade at from outside your home (a Cloudflare Tunnel's, say). The connector is that address followed by `/mcp`.
2. **Settings > Claude and AI apps:** turn on **Let Claude's apps sign in from the internet** and save. The page then shows the connector's address, with a Copy button.
3. If Squirrelcade is behind Cloudflare Access (or another sign-in gate), open the connector's addresses in it: see **Behind Cloudflare Access** below.
4. **In Claude:** Settings > Connectors > **Add custom connector**. Name it Squirrelcade, paste the connector's address, **Add**, then **Connect**. A Squirrelcade page opens: sign in if you aren't, check that it names Claude and sends you back to claude.ai, and **Allow**. You're back in Claude, connected. Custom connectors work on every Claude plan (one on the free plan).

Other MCP apps sign in the same way, if their addresses are allowed (**Settings > Claude and AI apps > Apps that may connect**: claude.ai and apps on your own computer, by default).

## What it can answer

Five tools, each answering with structured data:

- **check_ownership:** up to 50 titles at once. For each: **owned**, **subscription** (only through Game Pass or the like), **possible** (only near misses) or **not owned**, with how sure it is (a confidence from 0 to 1: 0.85 and up counts as the same game) and how the titles differ. It reads editions ("Yakuza 0 Director's Cut" against your "Yakuza 0": owned, a different edition), generic subtitles ("Cars 2" and "Cars 2: The Video Game"), franchise names in front ("EndWar" and "Tom Clancy's EndWar"), punctuation, accents, ™ and Roman numerals. A different number is always a different game: Halo 2 is never Halo 3. Near misses (a real subtitle, a remaster, a spelling) are listed but never counted. Given consoles, it says apart when you have the game on another one; a game you don't have comes with its place on your wishlist and its acorns.
- **search_games:** your games by words of their title, a page at a time, filtered by console (its name or a short name such as PS3, 360, Switch, or PC), physical or digital, PC storefront (Steam, Epic, GOG, Xbox...) and condition (sealed, complete, loose, graded).
- **get_game:** one game's copies on each console (condition, sealed, box, manual, region, grading, market value, when added), its PC storefronts and how each is held, digital copies claimed with discs, its IGDB reviews and its Top 100 place.
- **get_wishlist:** your Acorns wishlist, best first: each game's acorns (how much you want it, 0 to 100, from your own rules), its priority, its place on the main list and the rules that gave it the most acorns. Ask for a game by its title to get its acorns and why, for a console to get its whole list, or for a priority. So "what should I hunt for on the Switch?" and "why does Demon's Souls have 72 acorns?" have answers. A game you have has no acorns. The main list is in the order the Wishlist page shows: each game's acorns minus the variety in the top picks (a little less for each game of the same console or series above it), so Claude can say why a game with 100 acorns sits sixth.
- **list_platforms:** your consoles with their short names, games, copies (sealed and complete) and value; your PC storefronts.

A game is a title across consoles and PC, grouped as Stash > Copies groups it (your own answers there included).

## Who sees what

- **You, and your keys:** everything, except what you paid and your notes, which stay out of answers unless you turn them on (**Settings > Claude and AI apps > What answers include**). Answers leave Squirrelcade for the AI app's servers.
- **Viewers** (with the sign-in from the internet): what they see on the web (**Settings > Security > Viewers**). **Who can sign in** decides whether viewers may connect an AI app at all.
- **Guests:** people without an account; below.

## Guests

With the sign-in from the internet on, a guest connects their own Claude to your collection without an account here. Add them on **Settings > Claude and AI apps** under Guests, with a name and the email they use. When they connect, they prove that email with a one-time code:

- **Behind Cloudflare Access**, Access sends the code (fill in your team's address and the sign-in page's audience tag, in the advanced settings under Guests; see below).
- **Otherwise**, Squirrelcade emails it from your account (Settings > Email).

Guests get what viewers get, never what you paid or your notes. Every call they make is in the list of calls under their name. Remove a guest and their connections end. The code proves the email, not who's typing: a guest who lets someone else use their Claude still shows as that guest.

## Limits, the list of calls, disconnecting

- Each key, and each person signed in, may make 60 calls a minute and 2,000 a day (advanced settings); past that, the app is asked to wait.
- **Latest calls** on Settings > Claude and AI apps lists each call: when, who, which app or key, what it asked (in short) and how it went, never the answer. They're kept 90 days (a setting). They're in System > Logs too.
- **Revoke** beside a key ends it at once.
- **Connected apps** (with the sign-in from the internet) lists each connection: who, which app, when it connected, when it was last used and its calls. **Disconnect** ends one at once; connecting again needs a new sign-in. A sign-in lasts an hour and renews itself for 30 days.

## Behind Cloudflare Access

Only for Claude's apps from the internet. Claude's servers can't pass Cloudflare Access's sign-in, so a few addresses need to skip it. In Cloudflare Zero Trust, **Access > Applications > Add an application > Self-hosted**, on Squirrelcade's address, with these paths and a **Bypass** policy for everyone:

- `mcp`
- `.well-known/oauth-protected-resource`
- `.well-known/oauth-authorization-server`
- `oauth/token`, `oauth/register` and `oauth/revoke`

Everything else stays behind your existing application, the sign-in page (`oauth/authorize`) included: Access uses the most specific path.

For guests, give the sign-in page an application of its own: path `oauth/authorize`, a policy that allows everyone, and the **One-time PIN** login method, so anyone can prove an email (Squirrelcade then lets in only you and your guests). Copy that application's **Application Audience (AUD) tag** and your team's address (`https://<team>.cloudflareaccess.com`) into the advanced settings under Guests. Turn on that application's **Enforce cookie path attribute** (Additional settings > Cookie settings), so its sign-in doesn't replace the one for the rest of Squirrelcade.

If Bot Fight Mode or a challenge rule is on for your domain, give the bypassed paths a skip rule, or Claude's calls get a challenge page instead of an answer. Claude's servers call from Anthropic's published addresses (160.79.104.0/21). To stop it all, delete those applications (or turn the sign-in off: the addresses then answer "not found").

## A digital copy claimed with a disc

Some discs come with a digital license: Xbox's disc-to-digital, a code in the box. In a copy's details (its window from the game page), **Its digital copy** says Claimed (with the day and the store), Not claimed yet, or Not offered for this one. A claimed license outlives the disc: sell the disc and the game still counts as owned, digitally, in check_ownership's answers. **Collection** filters by it ("Digital copy claimed", "Digital copy not claimed yet").
