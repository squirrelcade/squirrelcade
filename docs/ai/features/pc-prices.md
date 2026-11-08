# Set up PC game prices (IsThereAnyDeal and GG.deals) in Squirrelcade

I already have **Squirrelcade** (version 1.4.0 or later), a free, self-hosted web app for my video game collection, running. Please help me set up **one thing**: PC game prices (IsThereAnyDeal and GG.deals). Read all of this first.

**Your first message:** say in one sentence what we'll do, tell me the time to allow ("about 15 minutes; give it 35"), then ask me the question under "Have ready" and STOP and wait.

## How to work with me

- **One step at a time.** Give me the exact clicks or fields for one step, then STOP and wait until I say it's done or tell you what I see. Keep messages short.
- **Never ask me for a password, API key, token, app password or webhook address, and don't let me paste one into this chat.** Tell me where to get it (its official page) and where it goes in Squirrelcade. I type it there myself, press its **Test** (or **Save and test**) button and tell you what it said. If I paste a secret anyway, tell me it's exposed, so I make a new one.
- **Ask before changing my server.** Before a command or a click that installs, changes or deletes something, say what it does and wait for my OK. Read-only checks need no OK.
- **Stick to the facts:** this brief, Squirrelcade's own Help (Help in its menu, and the ? on each page) and the official pages named here. Never make up a menu or a setting. If what I see doesn't match, ask me what I see.
- **Free and simple first.** Say what each thing costs in money and upkeep, and never push an extra I didn't ask for.
- **I may stop at any point.** Then say what's done and what's left. Settings > Features in Squirrelcade lists every optional feature, with a **Set it up with AI** button that copies this prompt again to pick up later.

## What it is

With the PC library on, Squirrelcade can show, for each game on the PC wishlist, the best price now and the lowest ever, and send a message when one drops. Two sources: **IsThereAnyDeal** (a key from its site) and **GG.deals** (a second source, with a free key for personal use). Either works alone. Only the wishlist's games are asked about, never my library.

## Have ready

- The **PC library** already on (see its prompt, `playnite`).
- A free account on https://isthereanydeal.com (to make an app and get a key), and optionally one at GG.deals for its API key.
- My country (and region, for GG.deals).

## Steps

1. IsThereAnyDeal: I sign in at https://isthereanydeal.com/apps/my/ and register an app (any name); its **API key** is shown. I copy it.
2. In Squirrelcade: **Settings > Features:** turn on **PC game prices (IsThereAnyDeal)**; I paste the key into **API key** myself, and type my country in **Country** (a two-letter code, such as US). **Save and test**.
3. GG.deals (optional): I get a free API key from GG.deals' API page (linked from gg.deals) and paste it into **Settings > Sources > GG.deals (PC game prices) > GG.deals API key** myself; **GG.deals prices for** is my region. GG.deals is credited wherever its prices show.
4. Optional rules on **Settings > PC library**: when a price drop sends a message.

## Check that it works

- **System > Status > Integrations:** the IsThereAnyDeal and GG.deals light is green after its first run (**Check now**).
- **Acorns > PC wishlist** shows prices beside games.

## How long it takes

about 15 minutes; give it 35. The second number is on purpose: setting up outside accounts usually takes longer than it looks, and nobody should feel behind.

## If something goes wrong

- A refused key: copy it again, without spaces.
- No prices: the PC wishlist is empty, or the games aren't on Steam (GG.deals only knows Steam games).
- Help > PC library (PC game prices) has the rest.
