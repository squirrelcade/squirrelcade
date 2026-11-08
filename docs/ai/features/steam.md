# Set up Steam achievements in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: Steam achievements. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 10 minutes; give it 25"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

With the PC library on, Squirrelcade can show my Steam achievements beside each Steam game, with a filter for the games I've completed. It reads them through Steam's free Web API with my key.

## Have ready

- The **PC library** already on (see its prompt, `playnite`).
- A **Steam** account, with my profile's **game details set to public** (Steam > profile > Edit profile > Privacy settings > Game details: Public).
- My Steam profile's address (the number, or the custom name).

## Steps

1. I open https://steamcommunity.com/dev/apikey signed in to Steam. Any domain name works (such as `localhost`). I copy the key.
2. In Squirrelcade: **Settings > Features:** turn on **Steam achievements**; I paste the key into **Steam Web API key** myself and type my profile's address in **Your Steam profile**. **Save and test**.

## Check that it works

- **System > Status > Integrations:** the Steam light is green after its first run (**Check now**).
- **Stash > PC library:** a Steam game I've played shows its achievements.

## How long it takes

about 10 minutes; give it 25. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- Empty results: the profile's game details aren't public.
- "Needs the PC library": turn that on first.
- Help > PC library (Steam achievements) has the rest.
