# Set up RomM links in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: RomM links. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 10 minutes; give it 20"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

**RomM** is a self-hosted library of game backups that I already run. Squirrelcade only links to it: a **Play on RomM** button on games I have (and optionally games I don't). It doesn't scan or change RomM.

## Have ready

- A running **RomM** server, and its address as the Squirrelcade server reaches it (such as `http://<server>:8080`).
- An API token from RomM: my profile > **API tokens** > a new token with the `roms.read` and `platforms.read` scopes only.
- On a weak server, suggest RomM on another machine.

## Steps

1. In RomM, I make the token (above) and copy it.
2. In Squirrelcade: **Settings > Features:** turn on **RomM links**. The address and token fields show under the switch: I type the address, and paste the token myself. **Save and test**.
3. If my browser opens RomM at another address than the server does: **Settings > Sources > RomM > RomM address for links**.
4. To see **Play on RomM** on games I don't own too (Game of the Day, the wishlist): **Settings > Sources > RomM**, links for games you don't own.

## Check that it works

- A game I own that RomM has shows **Play on RomM** at the top of its page.
- **System > Status > Integrations:** the RomM light is green.

## How long it takes

about 10 minutes; give it 20. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- The test is refused: the token lacks a scope, or the address isn't reachable from the Squirrelcade server (use the server's address, not `localhost`).
- Help > RomM has the rest.
