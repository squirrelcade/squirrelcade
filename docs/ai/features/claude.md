# Set up Claude and AI apps (the connector) in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: Claude and AI apps (the connector). Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 10 minutes; give it 25"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

Squirrelcade can let **Claude** (or another AI app that speaks MCP) look up my collection and answer "do I have this game?", read-only. It can also read my own **buying rules** (what a copy must have, how I judge a deal), which I write on Acorns > Your buying rules, through its tool get_buying_rules. Two ways in: **the plugin** for the Claude app (Cowork and Claude Code on my computers at home; it carries its own key), or a key for **Claude Code** alone with a command. Claude's own apps (claude.ai, the desktop and phone apps) from the internet also need the sign-in for apps on the internet, which is a larger step (see Help > Claude and AI apps). Nothing in Squirrelcade needs any of this.

## Have ready

- An AI app I use: **Claude** (the desktop app, Claude Code) or another that supports MCP. Ask me which, and whether it runs on a computer at home or I want it away from home too.
- For the plugin: Node.js on that computer.

## Steps

1. In Squirrelcade: **Settings > Claude and AI apps:** turn on **Let AI apps read your collection**.
2. **The plugin:** **Download the plugin** gives a file for the Claude app (Customize > Plugins > Add > Upload plugin). It carries its own key; the key never goes into a chat. Tick **This plugin may also put games on On the way** before downloading only if I want Claude, or a task of mine that reads my orders, to tell Squirrelcade about games I've bought: they wait on On the way, and it never changes my collection.
3. **Claude Code alone:** the page shows the command that adds the connector (this Squirrelcade's address followed by `/mcp`), with a key I make there myself.
4. **What answers include:** **Settings > Claude and AI apps > What answers include**: what I paid and my notes are left out unless I tick them (answers leave Squirrelcade for the AI app's servers).
5. From the internet (optional, larger): see Help > Claude and AI apps (Claude's apps from the internet, and Behind Cloudflare Access).

## Check that it works

- In Claude: ask "Do I own Okami?" (or any game): it answers from my collection.
- **System > Status > Integrations:** Claude's plugin keys light is green once a key has been used.

## How long it takes

about 10 minutes; give it 25. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- Claude doesn't see the connector: the plugin wasn't uploaded, or Let AI apps read your collection is off.
- A refused key: make a new one on the page (and revoke the old).
- Help > Claude and AI apps has the long version.
