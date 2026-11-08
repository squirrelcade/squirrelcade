# Set up Xbox achievements in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: Xbox achievements. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 5 minutes; give it 15"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

OpenXBL (https://xbl.io) is a free service that lets Squirrelcade read my Xbox achievements. Squirrelcade then shows how far I got in each game on Xbox 360, One and Series X and S, in the game's page and, if I like, in What you played.

## Have ready

- A **Microsoft account** (the one my Xbox uses).

## Steps

1. I sign in at https://xbl.io with my Microsoft account (in a regular browser) and open my profile page: it shows an **API key**. I copy it.
2. In Squirrelcade: **Settings > Features:** turn on **Xbox achievements**; I paste the key into **OpenXBL API key** myself. **Save and test**.
3. Optional on **Settings > Sources > Xbox achievements:** **In What you played** (whether a game with achievements counts as played).

## Check that it works

- **System > Status > Integrations:** the Xbox achievements light is green after its first run (**Check now**).
- An Xbox game I've played shows its achievements.

## How long it takes

about 5 minutes; give it 15. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- Refused or empty: the key was mistyped; copy it again from xbl.io.
- Help > What you played (Xbox achievements and PlayStation trophies) has the rest.
