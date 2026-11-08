# Set up YouTube videos on game pages in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: YouTube videos on game pages. Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 10 minutes; give it 25 (Light alone: about 2 minutes; give it 5)"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

With **Videos on a game's page** on (**Settings > Roots**; off to start), a game's page shows videos, played right there. **Light** needs no key and no setup: IGDB's trailers, videos pasted onto the game, the ones its Wikipedia article cites, a YouTube search link, and each video channel's newest uploads (Squirrelcade reads each channel's public feed at night, about its latest 15 videos, so a game's videos build up over time). It means fewer videos. **Deep** uses a free YouTube key and reads each channel's whole list, and **Find its videos** on a game's page searches the channels for older reviews. The setting **How much of YouTube to use** (`roots.youtubeMode`) is Automatic (Deep when a key is set, Light when none is), Light or Deep.

## Have ready

- For Light: nothing. For Deep: a **Google account**, and about ten minutes in Google Cloud's console. Ask me: Light only, or Deep too? (Light is a fine start; the key can come later.)

## Steps

**Light:**
1. **Settings > Roots > Videos on a game's page:** turn it on. That's all: leave **How much of YouTube to use** on Automatic or set it to Light.

**Deep (a YouTube key), after the above:**
1. I go to https://console.cloud.google.com and sign in. In the project picker at the top, **New project**, name it Squirrelcade, **Create**, and choose it.
2. **APIs & Services > Library**: search **YouTube Data API v3**, open it, **Enable**.
3. **APIs & Services > Credentials > Create credentials > API key.** I copy the key.
4. I click the key to edit it: under **API restrictions** choose **Restrict key**, tick **YouTube Data API v3**, **Save**.
5. In Squirrelcade: **Settings > Sources > YouTube (videos)**: I paste it into **YouTube API key** myself and save.
6. Each channel's whole list is read once (a big channel takes a while, and a few thousand of the day's 10,000 free units); Squirrelcade stays under **YouTube's units Squirrelcade may use a day** (8,000, in Settings > Roots), so the nightly reading always has room. A channel costs 100 units each time **Find its videos** searches it.

## Check that it works

- **System > Status > Integrations:** the YouTube line says Light or Deep, and is green (Deep also shows today's units left).
- Open a game from the 1990s or 2000s: its **Videos** tab shows videos (Light: some of them at first, more as nights pass).

## How long it takes

about 10 minutes; give it 25 (Light alone: about 2 minutes; give it 5). The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- Deep says it's set to Deep but works as Light: the key isn't saved yet, or was mistyped.
- Yellow "units nearly used": they come back at midnight, Pacific time.
- A key refused: check the API restriction lists **YouTube Data API v3**. Help > Roots (A YouTube key) has the clicks.
